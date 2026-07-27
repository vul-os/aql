package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/vul-os/aql/gateway/internal/store"
)

// Webhook delivery.
//
// # The rule that shapes everything here
//
// A webhook is a notification about something that has ALREADY happened and
// has already been audited. Delivery therefore runs out of band and no failure
// in this file may ever affect whether a gate opens. Dispatch is called after
// the actuation, never before, and never on the request's own goroutine.
//
// # Why the URL is validated again
//
// webhooktarget.go checks a target when it is configured. That is not enough.
// A hostname that resolved to a public address when it was saved can resolve
// to 169.254.169.254 tomorrow — DNS belongs to whoever owns the name, not to
// us, and a webhook configured innocently in January is a request-forgery
// primitive in March. So the same check runs again immediately before each
// request, against a fresh resolution.
//
// # What the receiver is trusted with
//
// Nothing. The response body is never read, never parsed and never acted on;
// only the status code is recorded. A compromised endpoint can learn that a
// gate opened. It cannot steer the hub.
const (
	// webhookMaxAttempts bounds retries per event. Small on purpose: this is a
	// notification, not a queue, and an endpoint that has failed three times in
	// a row is down rather than briefly unlucky.
	webhookMaxAttempts = 3
	// webhookTimeout bounds one attempt. A slow receiver must not hold a
	// goroutine open behind every gate opening.
	webhookTimeout = 10 * time.Second
	// webhookMaxFailuresBeforeDisable is how many consecutive whole-event
	// failures retire an endpoint. A dead URL should stop costing attempts.
	webhookMaxFailuresBeforeDisable = 5
	// webhookSignatureHeader carries hex HMAC-SHA256 over the exact bytes sent.
	webhookSignatureHeader = "X-Aql-Signature-256"
	// webhookTimestampHeader is signed alongside the body so a captured
	// delivery cannot be replayed at a receiver indefinitely. Receivers should
	// reject a skew they consider stale; the hub cannot enforce that for them.
	webhookTimestampHeader = "X-Aql-Timestamp"
	webhookEventHeader     = "X-Aql-Event"
)

// Known event names. A closed vocabulary, validated when a subscription is
// created: an unknown name in config is an operator typo worth refusing, not a
// subscription that silently never fires.
const (
	EventAccessOpened = "access.opened"
	EventAccessDenied = "access.denied"
)

// KnownWebhookEvents is the closed set.
func KnownWebhookEvents() []string {
	return []string{EventAccessOpened, EventAccessDenied}
}

func knownWebhookEvent(e string) bool {
	for _, k := range KnownWebhookEvents() {
		if k == e {
			return true
		}
	}
	return false
}

// webhookDispatcher delivers events. Its zero value is unusable; use
// newWebhookDispatcher.
type webhookDispatcher struct {
	store  *store.Store
	log    *slog.Logger
	client *http.Client
	// failures counts consecutive whole-event failures per webhook id, so a
	// persistently dead endpoint can be retired.
	failures map[string]int
}

func newWebhookDispatcher(st *store.Store, log *slog.Logger) *webhookDispatcher {
	return &webhookDispatcher{
		store: st,
		log:   log,
		client: &http.Client{
			Timeout: webhookTimeout,
			// Redirects are not followed at all. A 302 is a receiver asking us
			// to send a signed record of a gate opening somewhere we never
			// validated, which is the SSRF hole re-opened by a different door.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		failures: map[string]int{},
	}
}

// Dispatch delivers one event to every subscribed endpoint, in the background.
//
// It returns immediately. Callers are on the open path and must not wait: a
// receiver that takes ten seconds must not add ten seconds to a resident
// standing at a gate.
func (d *webhookDispatcher) Dispatch(accountID, event string, payload map[string]any) {
	if d == nil || !knownWebhookEvent(event) {
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		d.log.Error("webhook payload could not be encoded; event dropped",
			"event", event, "err", err)
		return
	}
	go d.deliverAll(context.Background(), accountID, event, body)
}

func (d *webhookDispatcher) deliverAll(ctx context.Context, accountID, event string, body []byte) {
	hooks, err := d.store.EnabledWebhooksForEvent(ctx, accountID, event)
	if err != nil {
		d.log.Error("webhook subscriptions could not be read", "event", event, "err", err)
		return
	}
	for _, w := range hooks {
		d.deliverOne(ctx, w, event, body)
	}
}

func (d *webhookDispatcher) deliverOne(ctx context.Context, w store.Webhook, event string, body []byte) {
	secret, err := d.store.SigningSecret(ctx, w.ID)
	if err != nil {
		d.log.Error("webhook signing secret unavailable", "webhook", w.ID, "err", err)
		return
	}

	var lastErr string
	var lastCode *int
	for attempt := 1; attempt <= webhookMaxAttempts; attempt++ {
		code, err := d.attempt(ctx, w, event, body, secret)
		lastCode = code
		if err == nil {
			_ = d.store.RecordDelivery(ctx, w.AccountID, w.ID, event, string(body),
				attempt, "delivered", code, "")
			d.failures[w.ID] = 0
			return
		}
		lastErr = err.Error()
		if attempt < webhookMaxAttempts {
			// Linear backoff. Exponential would be over-engineering for three
			// attempts, and a notification that arrives late is worth less than
			// one that arrives soon.
			select {
			case <-time.After(time.Duration(attempt) * time.Second):
			case <-ctx.Done():
				return
			}
		}
	}

	_ = d.store.RecordDelivery(ctx, w.AccountID, w.ID, event, string(body),
		webhookMaxAttempts, "failed", lastCode, lastErr)

	d.failures[w.ID]++
	if d.failures[w.ID] >= webhookMaxFailuresBeforeDisable {
		reason := fmt.Sprintf("%d consecutive failed deliveries; last error: %s",
			d.failures[w.ID], lastErr)
		if err := d.store.DisableWebhook(ctx, w.ID, reason); err != nil {
			d.log.Error("webhook could not be disabled", "webhook", w.ID, "err", err)
			return
		}
		// Operator-facing, and deliberately loud: an endpoint going quiet is
		// exactly the kind of failure nobody notices until they need the audit
		// trail it was feeding.
		d.log.Warn("webhook disabled after repeated failures",
			"webhook", w.ID, "name", w.Name, "reason", reason)
		delete(d.failures, w.ID)
	}
}

// attempt performs one delivery. It returns the response status when there was
// one — a nil code means the request never got an answer, which the store
// keeps distinct from a 500.
func (d *webhookDispatcher) attempt(ctx context.Context, w store.Webhook, event string,
	body []byte, secret string) (*int, error) {
	// SSRF check number two. See the file comment: the first one was at
	// configuration time, against a resolution that may no longer hold.
	if _, err := validateWebhookURL(w.URL, w.AllowPrivate); err != nil {
		return nil, fmt.Errorf("target refused at delivery time: %w", err)
	}

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "aql-hub")
	req.Header.Set(webhookEventHeader, event)
	req.Header.Set(webhookTimestampHeader, ts)
	req.Header.Set(webhookSignatureHeader, signWebhook(secret, ts, body))

	resp, err := d.client.Do(req)
	if err != nil {
		// Never wrap the *url.Error: it stringifies the full URL, which can
		// carry a path-embedded token on a receiver that uses one.
		return nil, fmt.Errorf("delivery failed: %s", classifyWebhookErr(err))
	}
	defer resp.Body.Close()
	// The body is deliberately not read. A receiver is told things; it does
	// not tell the hub things.
	code := resp.StatusCode
	if code < 200 || code > 299 {
		return &code, fmt.Errorf("receiver returned %d", code)
	}
	return &code, nil
}

// signWebhook is HMAC-SHA256 over "timestamp.body", hex.
//
// The timestamp is inside the signature rather than beside it, so it cannot be
// altered without invalidating the whole thing. A receiver that checks skew
// gets replay protection; one that does not at least gets authenticity.
func signWebhook(secret, ts string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(ts))
	m.Write([]byte("."))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

// classifyWebhookErr reduces a transport error to a phrase safe to store and
// log. The full error is dropped on purpose — see the caller.
func classifyWebhookErr(err error) string {
	var nerr net.Error
	switch {
	case err == nil:
		return ""
	case errorsAsNet(err, &nerr) && nerr.Timeout():
		return "timeout"
	case isDNSErr(err):
		return "dns failure"
	default:
		return "connection error"
	}
}

func errorsAsNet(err error, target *net.Error) bool {
	if e, ok := err.(net.Error); ok {
		*target = e
		return true
	}
	type unwrapper interface{ Unwrap() error }
	if u, ok := err.(unwrapper); ok {
		return errorsAsNet(u.Unwrap(), target)
	}
	return false
}

func isDNSErr(err error) bool {
	for err != nil {
		if _, ok := err.(*net.DNSError); ok {
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
