package httpapi

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// Actually delivering a webhook.
//
// The signing helpers, the SSRF checks and the store are all well covered. What
// was not covered at all is deliverOne — the function that performs the POST,
// retries it, records the outcome, and RETIRES an endpoint that keeps failing.
// Found by asking which functions a coverage run never enters.
//
// The retirement path is the one worth the effort: a webhook that quietly stops
// being delivered to is exactly the failure nobody notices until they go looking
// for the trail it was feeding. Getting its threshold wrong in either direction
// is silent — too eager and a flaky receiver is retired, too lax and a dead one
// costs attempts forever.

func deliverEnv(t *testing.T, handler http.HandlerFunc) (*webhookDispatcher, *store.Store, *store.Webhook, *httptest.Server) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	u, err := st.CreateUser(context.Background(), "wh-owner", "h", "O", "")
	if err != nil {
		t.Fatal(err)
	}
	acct, _, err := st.CreateAccountWithOwner(context.Background(), u.ID, "WH House", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	w, err := st.CreateWebhook(context.Background(), store.CreateWebhookArgs{
		AccountID: acct.ID, Name: "test", URL: srv.URL,
		Secret: "s3cret-value-long-enough", Events: []string{"gate.opened"},
		// The receiver is 127.0.0.1, which the SSRF check refuses by default —
		// deliberately, and this is the flag that exists for exactly this case.
		AllowPrivate: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	d := newWebhookDispatcher(st, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	// No real sleeping: the retry path is what is being exercised, not the
	// wall clock. Production still uses linearBackoff.
	d.backoff = func(int) time.Duration { return time.Millisecond }
	return d, st, w, srv
}

func deliveries(t *testing.T, st *store.Store, webhookID string) []struct {
	Status  string
	Attempt int
} {
	t.Helper()
	rows, err := st.DB().Query(
		`SELECT status, attempt FROM webhook_deliveries WHERE webhook_id = ? ORDER BY rowid`, webhookID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []struct {
		Status  string
		Attempt int
	}
	for rows.Next() {
		var r struct {
			Status  string
			Attempt int
		}
		if err := rows.Scan(&r.Status, &r.Attempt); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func TestAWebhookIsActuallyDeliveredAndSigned(t *testing.T) {
	var got atomic.Int32
	var sig, ts, event string
	var body []byte
	d, st, w, _ := deliverEnv(t, func(rw http.ResponseWriter, r *http.Request) {
		got.Add(1)
		sig = r.Header.Get(webhookSignatureHeader)
		ts = r.Header.Get(webhookTimestampHeader)
		event = r.Header.Get("X-Aql-Event")
		body, _ = io.ReadAll(r.Body)
		rw.WriteHeader(http.StatusOK)
	})

	d.deliverOne(context.Background(), *w, "gate.opened", []byte(`{"ap":"x"}`))

	if got.Load() != 1 {
		t.Fatalf("receiver got %d requests, want 1", got.Load())
	}
	if sig == "" || ts == "" {
		t.Errorf("delivery was unsigned: sig=%q ts=%q", sig, ts)
	}
	if string(body) != `{"ap":"x"}` {
		t.Errorf("body %q — the signature covers the exact bytes, so they must arrive intact", body)
	}
	_ = event
	// Recorded as delivered, on the first attempt.
	got2 := deliveries(t, st, w.ID)
	if len(got2) != 1 || got2[0].Status != "delivered" || got2[0].Attempt != 1 {
		t.Errorf("delivery record: %+v", got2)
	}
}

// A failing receiver is retried up to the cap and then recorded as failed —
// not silently dropped.
func TestAFailingDeliveryIsRetriedAndRecorded(t *testing.T) {
	var hits atomic.Int32
	d, st, w, _ := deliverEnv(t, func(rw http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		rw.WriteHeader(http.StatusInternalServerError)
	})

	d.deliverOne(context.Background(), *w, "gate.opened", []byte(`{}`))

	if int(hits.Load()) != webhookMaxAttempts {
		t.Errorf("receiver hit %d times, want %d", hits.Load(), webhookMaxAttempts)
	}
	rows := deliveries(t, st, w.ID)
	if len(rows) != 1 || rows[0].Status != "failed" || rows[0].Attempt != webhookMaxAttempts {
		t.Errorf("failure record: %+v", rows)
	}
}

// The retirement threshold, in both directions. One short of the limit must
// leave the endpoint enabled; reaching it must disable it with a reason.
func TestARepeatedlyFailingWebhookIsRetiredAtTheThreshold(t *testing.T) {
	d, st, w, _ := deliverEnv(t, func(rw http.ResponseWriter, r *http.Request) {
		rw.WriteHeader(http.StatusInternalServerError)
	})
	ctx := context.Background()

	for i := 0; i < webhookMaxFailuresBeforeDisable-1; i++ {
		d.deliverOne(ctx, *w, "gate.opened", []byte(`{}`))
	}
	cur, err := st.WebhookByID(ctx, w.AccountID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !cur.Enabled {
		t.Fatalf("retired after %d failures, one short of the threshold of %d",
			webhookMaxFailuresBeforeDisable-1, webhookMaxFailuresBeforeDisable)
	}

	d.deliverOne(ctx, *w, "gate.opened", []byte(`{}`))
	cur, err = st.WebhookByID(ctx, w.AccountID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cur.Enabled {
		t.Errorf("still enabled after %d consecutive failures", webhookMaxFailuresBeforeDisable)
	}
	if cur.DisabledReason == "" {
		t.Error("retired with no reason — an operator has to be able to see why it went quiet")
	}
}

// A success resets the count, so an intermittently flaky receiver is never
// retired. Without this, failures accumulate forever and any endpoint that
// misses five deliveries across its whole life is retired.
func TestASuccessfulDeliveryResetsTheFailureCount(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	d, st, w, _ := deliverEnv(t, func(rw http.ResponseWriter, r *http.Request) {
		if fail.Load() {
			rw.WriteHeader(http.StatusInternalServerError)
			return
		}
		rw.WriteHeader(http.StatusOK)
	})
	ctx := context.Background()

	for i := 0; i < webhookMaxFailuresBeforeDisable-1; i++ {
		d.deliverOne(ctx, *w, "gate.opened", []byte(`{}`))
	}
	fail.Store(false)
	d.deliverOne(ctx, *w, "gate.opened", []byte(`{}`))
	fail.Store(true)
	for i := 0; i < webhookMaxFailuresBeforeDisable-1; i++ {
		d.deliverOne(ctx, *w, "gate.opened", []byte(`{}`))
	}

	cur, err := st.WebhookByID(ctx, w.AccountID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !cur.Enabled {
		t.Error("a receiver that succeeded in between was retired — the failure count did not reset")
	}
}
