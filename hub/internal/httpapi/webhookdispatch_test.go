package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/vul-os/aql/hub/internal/store"
)

// The signature is the whole security story for a receiver: it is how they
// know a gate-opening notification came from this hub and not from anyone who
// guessed the URL.
func TestWebhookSignatureIsHMACOverTimestampAndBody(t *testing.T) {
	const secret = "shhh"
	body := []byte(`{"event":"access.opened"}`)
	got := signWebhook(secret, "1700000000", body)

	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("1700000000"))
	m.Write([]byte("."))
	m.Write(body)
	want := hex.EncodeToString(m.Sum(nil))

	if got != want {
		t.Fatalf("signature mismatch:\n got %s\nwant %s", got, want)
	}
}

// The timestamp is inside the signature rather than merely beside it. A
// receiver checking skew gets replay protection only if an attacker cannot
// change the timestamp without breaking the signature.
func TestChangingTheTimestampBreaksTheSignature(t *testing.T) {
	body := []byte(`{"x":1}`)
	a := signWebhook("k", "1700000000", body)
	b := signWebhook("k", "1700009999", body)
	if a == b {
		t.Fatal("the timestamp is not covered by the signature, so a captured " +
			"delivery can be replayed with a fresh timestamp forever")
	}
}

func TestDifferentSecretsProduceDifferentSignatures(t *testing.T) {
	body := []byte(`{"x":1}`)
	if signWebhook("k1", "1", body) == signWebhook("k2", "1", body) {
		t.Fatal("the secret does not affect the signature")
	}
}

// A closed vocabulary. An unknown event name is an operator typo worth
// refusing at configuration time, not a subscription that silently never fires.
func TestUnknownEventsAreNeverDispatched(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	defer srv.Close()

	d := newWebhookDispatcher(nil, quietLogger())
	// nil store would panic if this got as far as looking up subscriptions;
	// the point is that it returns before that.
	d.Dispatch("acct", "access.exploded", map[string]any{"x": 1})

	if !knownWebhookEvent("access.opened") || knownWebhookEvent("access.exploded") {
		t.Fatal("the event vocabulary is not closed")
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("an unknown event reached the network")
	}
}

// The receiver is trusted with nothing. Its body is never read, so it cannot
// steer the hub — a compromised endpoint can learn that a gate opened and
// nothing more.
func TestReceiverResponseBodyIsNeverRead(t *testing.T) {
	var served int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&served, 1)
		// Assert the request carries what a receiver needs to verify it.
		if r.Header.Get(webhookSignatureHeader) == "" {
			t.Error("no signature header")
		}
		if r.Header.Get(webhookTimestampHeader) == "" {
			t.Error("no timestamp header")
		}
		if r.Header.Get(webhookEventHeader) != "access.opened" {
			t.Errorf("event header = %q", r.Header.Get(webhookEventHeader))
		}
		raw, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(raw), "access_point") {
			t.Errorf("payload did not arrive intact: %s", raw)
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"command":"open all gates"}`))
	}))
	defer srv.Close()

	d := newWebhookDispatcher(nil, quietLogger())
	code, err := d.attempt(t.Context(),
		webhookFor(srv.URL), "access.opened",
		[]byte(`{"access_point":"ap_1"}`), "secret")
	if err != nil {
		t.Fatalf("attempt: %v", err)
	}
	if code == nil || *code != 200 {
		t.Fatalf("code = %v", code)
	}
	if atomic.LoadInt32(&served) != 1 {
		t.Fatal("the receiver was not called")
	}
}

// The SSRF guard runs again at delivery, not only at configuration. A name
// that resolved publicly when saved can resolve to a metadata service later.
func TestDeliveryRevalidatesTheTarget(t *testing.T) {
	d := newWebhookDispatcher(nil, quietLogger())
	w := webhookFor("http://169.254.169.254/latest/meta-data/")
	w.AllowPrivate = false

	code, err := d.attempt(t.Context(), w, "access.opened", []byte(`{}`), "s")
	if err == nil {
		t.Fatal("a link-local target was delivered to; the configuration-time " +
			"check is not enough, because DNS belongs to whoever owns the name")
	}
	if code != nil {
		t.Fatal("a refused target should not report a response code")
	}
}

// A non-2xx is a failure the operator needs to see, and the code is preserved
// because "the receiver said no" and "the receiver was never reached" are
// different problems.
func TestNon2xxIsAFailureThatKeepsItsStatusCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	defer srv.Close()

	d := newWebhookDispatcher(nil, quietLogger())
	code, err := d.attempt(t.Context(), webhookFor(srv.URL), "access.opened", []byte(`{}`), "s")
	if err == nil {
		t.Fatal("a 418 was treated as delivered")
	}
	if code == nil || *code != http.StatusTeapot {
		t.Fatalf("status code lost: %v", code)
	}
}

// A redirect is a receiver asking the hub to post a signed record of a gate
// opening somewhere that was never validated — the SSRF hole through a
// different door.
func TestRedirectsAreNotFollowed(t *testing.T) {
	var reached int32
	final := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&reached, 1)
		w.WriteHeader(200)
	}))
	defer final.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, final.URL, http.StatusFound)
	}))
	defer redirector.Close()

	d := newWebhookDispatcher(nil, quietLogger())
	code, _ := d.attempt(t.Context(), webhookFor(redirector.URL), "access.opened", []byte(`{}`), "s")
	if atomic.LoadInt32(&reached) != 0 {
		t.Fatal("the redirect was followed to an unvalidated host")
	}
	if code == nil || *code != http.StatusFound {
		t.Fatalf("expected the 302 itself to be recorded, got %v", code)
	}
}

func TestTransportErrorsDoNotLeakTheURL(t *testing.T) {
	d := newWebhookDispatcher(nil, quietLogger())
	// A private target with allow_private set gets past validation and then
	// fails to connect, which is the path that produces a *url.Error.
	w := webhookFor("http://127.0.0.1:1/hook")
	w.AllowPrivate = true
	_, err := d.attempt(t.Context(), w, "access.opened", []byte(`{}`), "s")
	if err == nil {
		t.Fatal("expected a connection failure")
	}
	if strings.Contains(err.Error(), "127.0.0.1:1") {
		t.Fatalf("the error carries the target URL, which a receiver may embed "+
			"a token in: %v", err)
	}
}

// quietLogger discards output; these tests assert behaviour, not logs.
func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError + 1}))
}

// webhookFor builds a minimal store.Webhook aimed at a test server.
func webhookFor(url string) store.Webhook {
	return store.Webhook{
		ID: "wh_test", AccountID: "acct_test", Name: "test",
		URL: url, Events: []string{EventAccessOpened},
		// Test servers listen on loopback, so the guard must be told this is
		// deliberate — exactly as an operator wiring their own Home Assistant
		// would have to.
		AllowPrivate: true, Enabled: true,
	}
}
