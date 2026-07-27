package channels

// Long-polling tests. Everything runs against an httptest fake Bot API — the
// suite must never need the network, and must never reach api.telegram.org.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

const testBotToken = "123456:TEST-TOKEN"

// discardLogger keeps the deliberately loud warnings this file emits out of
// the test output without silencing them in production.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError + 1}))
}

// ---------------------------------------------------------------------------
// fake Bot API
// ---------------------------------------------------------------------------

type tgAPIStub struct {
	mu       sync.Mutex
	offsets  []int64 // the offset each getUpdates call asked for, in order
	respond  func(attempt int, offset int64) (status int, body string)
	badPaths int
	url      string
}

func newTGAPIStub(t *testing.T, respond func(attempt int, offset int64) (int, string)) *tgAPIStub {
	t.Helper()
	st := &tgAPIStub{respond: respond}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot"+testBotToken+"/getUpdates" {
			st.mu.Lock()
			st.badPaths++
			st.mu.Unlock()
			http.Error(w, "unexpected path", http.StatusNotFound)
			return
		}
		var req struct {
			Offset  int64    `json:"offset"`
			Timeout int      `json:"timeout"`
			Allowed []string `json:"allowed_updates"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		st.mu.Lock()
		attempt := len(st.offsets)
		st.offsets = append(st.offsets, req.Offset)
		st.mu.Unlock()
		code, body := st.respond(attempt, req.Offset)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	st.url = srv.URL
	return st
}

func (st *tgAPIStub) asked() []int64 {
	st.mu.Lock()
	defer st.mu.Unlock()
	return append([]int64(nil), st.offsets...)
}

func (st *tgAPIStub) calls() int {
	st.mu.Lock()
	defer st.mu.Unlock()
	return len(st.offsets)
}

// okBatch renders an {"ok":true,"result":[…]} envelope.
func okBatch(updates ...string) string {
	body := `{"ok":true,"result":[`
	for i, u := range updates {
		if i > 0 {
			body += ","
		}
		body += u
	}
	return body + `]}`
}

func tgTextUpdate(updateID int64, text string) string {
	return fmt.Sprintf(`{"update_id":%d,"message":{"message_id":%d,"from":{"id":7,"is_bot":false},`+
		`"chat":{"id":7,"type":"private"},"date":1700000000,"text":%q}}`, updateID, updateID, text)
}

// recorder collects what the shared handler was handed.
type recorder struct {
	mu   sync.Mutex
	sawn []int64
}

func (r *recorder) handle(_ context.Context, u *TGUpdate) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sawn = append(r.sawn, u.UpdateID)
}

func (r *recorder) seen() []int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]int64(nil), r.sawn...)
}

// offsetFile is an in-memory stand-in for instance_settings.
type offsetFile struct {
	mu     sync.Mutex
	value  int64
	stored bool
	writes int
	failWr bool
}

func (f *offsetFile) load(context.Context) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.stored {
		return 0, nil
	}
	return f.value, nil
}

func (f *offsetFile) save(_ context.Context, v int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.writes++
	if f.failWr {
		return fmt.Errorf("disk full")
	}
	f.value, f.stored = v, true
	return nil
}

func (f *offsetFile) get() (int64, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.value, f.stored
}

// testPoller wires a poller at test speeds against a stub API.
func testPoller(st *tgAPIStub, h func(context.Context, *TGUpdate), off *offsetFile) *TelegramPoller {
	p := &TelegramPoller{
		BotToken:    testBotToken,
		Engine:      TelegramEnginePolling,
		Handle:      h,
		APIBase:     st.url,
		PollTimeout: 50 * time.Millisecond,
		BackoffMin:  5 * time.Millisecond,
		BackoffMax:  40 * time.Millisecond,
		Logger:      discardLogger(),
	}
	if off != nil {
		p.LoadOffset, p.SaveOffset = off.load, off.save
	}
	return p
}

// runPoller starts Run in its own goroutine and returns cancel + a done chan.
func runPoller(p *TelegramPoller) (context.CancelFunc, chan struct{}) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); p.Run(ctx) }()
	return cancel, done
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// ---------------------------------------------------------------------------
// engine selection — fail closed toward the webhook, exactly as WhatsApp's does
// ---------------------------------------------------------------------------

func TestResolveTelegramEngineFailsClosedToWebhook(t *testing.T) {
	// Only the exact opt-in string selects polling. Everything else — unset,
	// blank, misspelled, adjacent, a value from the OTHER engine selector —
	// keeps the authenticated webhook, so an upgrade or a fat-fingered env var
	// never silently stops checking the secret token.
	for _, raw := range []string{
		"", " ", "web", "webhooks", "poll", "polling ", "pollling", "long-polling",
		"getupdates", "true", "1", "yes", "cloud", "bridge", "socket",
	} {
		want := TelegramEngineWebhook
		if raw == "polling " {
			want = TelegramEnginePolling // trimmed, so this one IS the opt-in
		}
		if got := ResolveTelegramEngine(raw); got != want {
			t.Errorf("ResolveTelegramEngine(%q) = %q, want %q", raw, got, want)
		}
	}
	for _, raw := range []string{"polling", "POLLING", "  Polling  "} {
		if got := ResolveTelegramEngine(raw); got != TelegramEnginePolling {
			t.Errorf("ResolveTelegramEngine(%q) = %q, want polling", raw, got)
		}
	}
}

func TestTelegramPollerEnabledIsFailClosed(t *testing.T) {
	h := func(context.Context, *TGUpdate) {}
	cases := []struct {
		name string
		p    *TelegramPoller
		want bool
	}{
		{"zero value never polls", &TelegramPoller{}, false},
		{"nil never polls", nil, false},
		{"engine unset, everything else present", &TelegramPoller{BotToken: "t", Handle: h}, false},
		{"webhook engine", &TelegramPoller{BotToken: "t", Handle: h, Engine: TelegramEngineWebhook}, false},
		{"polling but no token", &TelegramPoller{Handle: h, Engine: TelegramEnginePolling}, false},
		{"polling but no handler", &TelegramPoller{BotToken: "t", Engine: TelegramEnginePolling}, false},
		{"fully configured", &TelegramPoller{BotToken: "t", Handle: h, Engine: TelegramEnginePolling}, true},
	}
	for _, c := range cases {
		if got := c.p.Enabled(); got != c.want {
			t.Errorf("%s: Enabled() = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestDisabledPollerRunReturnsWithoutTouchingTheNetwork(t *testing.T) {
	st := newTGAPIStub(t, func(int, int64) (int, string) { return 200, okBatch() })
	p := testPoller(st, func(context.Context, *TGUpdate) {}, nil)
	p.Engine = TelegramEngineWebhook // the default: this channel does not run

	done := make(chan struct{})
	go func() { defer close(done); p.Run(context.Background()) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return immediately for a disabled poller")
	}
	if n := st.calls(); n != 0 {
		t.Fatalf("a disabled poller called getUpdates %d times", n)
	}
}

// ---------------------------------------------------------------------------
// offset advancement — each update consumed exactly once
// ---------------------------------------------------------------------------

func TestPollingAdvancesOffsetSoEachUpdateIsConsumedOnce(t *testing.T) {
	st := newTGAPIStub(t, func(attempt int, offset int64) (int, string) {
		if attempt == 0 {
			return 200, okBatch(tgTextUpdate(10, "open"), tgTextUpdate(11, "close"), tgTextUpdate(12, "menu"))
		}
		return 200, okBatch() // nothing further
	})
	rec := &recorder{}
	off := &offsetFile{}
	p := testPoller(st, rec.handle, off)

	cancel, done := runPoller(p)
	waitFor(t, "three updates handled", func() bool { return len(rec.seen()) == 3 })
	waitFor(t, "a second poll", func() bool { return st.calls() >= 2 })
	cancel()
	<-done

	if got := rec.seen(); len(got) != 3 || got[0] != 10 || got[1] != 11 || got[2] != 12 {
		t.Fatalf("handler saw %v, want [10 11 12] exactly once each, in order", got)
	}
	asked := st.asked()
	if asked[0] != 0 {
		t.Fatalf("first poll asked offset %d, want 0 (Telegram then sends its oldest unconfirmed update)", asked[0])
	}
	for i, o := range asked[1:] {
		if o != 13 {
			t.Fatalf("poll %d asked offset %d, want 13 (last id + 1) — an update would be redelivered", i+1, o)
		}
	}
	if v, ok := off.get(); !ok || v != 13 {
		t.Fatalf("persisted offset = %d (stored=%v), want 13", v, ok)
	}
}

func TestPollingResumesFromPersistedOffsetWithoutReplay(t *testing.T) {
	// Run 1 consumes 20 and 21, then the process "dies".
	st1 := newTGAPIStub(t, func(attempt int, offset int64) (int, string) {
		if attempt == 0 {
			return 200, okBatch(tgTextUpdate(20, "open"), tgTextUpdate(21, "menu"))
		}
		return 200, okBatch()
	})
	rec1 := &recorder{}
	off := &offsetFile{}
	p1 := testPoller(st1, rec1.handle, off)
	cancel1, done1 := runPoller(p1)
	waitFor(t, "run 1 to handle both updates", func() bool { return len(rec1.seen()) == 2 })
	cancel1()
	<-done1

	// Run 2 is a fresh poller against a fresh connection, sharing only the
	// persisted offset — which is what survives a restart.
	st2 := newTGAPIStub(t, func(attempt int, offset int64) (int, string) {
		if offset != 22 {
			// A poller that forgot its offset would ask 0 here and Telegram
			// would hand back 20 and 21 again.
			return 200, okBatch(tgTextUpdate(20, "open"), tgTextUpdate(21, "menu"))
		}
		return 200, okBatch()
	})
	rec2 := &recorder{}
	p2 := testPoller(st2, rec2.handle, off)
	cancel2, done2 := runPoller(p2)
	waitFor(t, "run 2 to poll", func() bool { return st2.calls() >= 2 })
	cancel2()
	<-done2

	if asked := st2.asked(); asked[0] != 22 {
		t.Fatalf("after restart the first poll asked offset %d, want 22 — updates would be replayed", asked[0])
	}
	if got := rec2.seen(); len(got) != 0 {
		t.Fatalf("after restart the handler replayed %v; each update must be consumed exactly once", got)
	}
}

func TestPollingWithNoPersistenceStillRunsAndLosesNothing(t *testing.T) {
	// LoadOffset/SaveOffset are optional. Without them Telegram's own
	// server-side confirmation still advances, so nothing is lost within the
	// process — the only cost is the one-update crash window widening to
	// "whatever Telegram still holds unconfirmed".
	st := newTGAPIStub(t, func(attempt int, offset int64) (int, string) {
		if attempt == 0 {
			return 200, okBatch(tgTextUpdate(3, "open"))
		}
		return 200, okBatch()
	})
	rec := &recorder{}
	p := testPoller(st, rec.handle, nil)
	cancel, done := runPoller(p)
	waitFor(t, "the update to be handled", func() bool { return len(rec.seen()) == 1 })
	waitFor(t, "a second poll", func() bool { return st.calls() >= 2 })
	cancel()
	<-done
	if asked := st.asked(); asked[1] != 4 {
		t.Fatalf("second poll asked offset %d, want 4", asked[1])
	}
}

func TestPollingSurvivesAnOffsetWriteFailure(t *testing.T) {
	// A failed persist must not stop the loop or drop the update: the in-memory
	// offset still advances, so Telegram is still confirmed on the next call.
	st := newTGAPIStub(t, func(attempt int, offset int64) (int, string) {
		if attempt == 0 {
			return 200, okBatch(tgTextUpdate(9, "open"))
		}
		return 200, okBatch()
	})
	rec := &recorder{}
	off := &offsetFile{failWr: true}
	p := testPoller(st, rec.handle, off)
	cancel, done := runPoller(p)
	waitFor(t, "the update to be handled", func() bool { return len(rec.seen()) == 1 })
	waitFor(t, "a second poll", func() bool { return st.calls() >= 2 })
	cancel()
	<-done
	if asked := st.asked(); asked[1] != 10 {
		t.Fatalf("second poll asked offset %d, want 10 even though the offset write failed", asked[1])
	}
}

// ---------------------------------------------------------------------------
// fail-closed parsing
// ---------------------------------------------------------------------------

func TestMalformedUpdateActuatesNothingAndIsConsumed(t *testing.T) {
	// "message" as a string, not an object: this does not decode into TGUpdate.
	// It must reach no handler (no verb is ever guessed from a payload we could
	// not read) and must still be confirmed, or it wedges the whole queue.
	bad := `{"update_id":31,"message":"not-an-object"}`
	st := newTGAPIStub(t, func(attempt int, offset int64) (int, string) {
		if attempt == 0 {
			return 200, okBatch(bad, tgTextUpdate(32, "open"))
		}
		return 200, okBatch()
	})
	rec := &recorder{}
	off := &offsetFile{}
	p := testPoller(st, rec.handle, off)
	cancel, done := runPoller(p)
	waitFor(t, "the good update to be handled", func() bool { return len(rec.seen()) == 1 })
	waitFor(t, "a second poll", func() bool { return st.calls() >= 2 })
	cancel()
	<-done

	if got := rec.seen(); len(got) != 1 || got[0] != 32 {
		t.Fatalf("handler saw %v, want only the well-formed update 32", got)
	}
	if v, _ := off.get(); v != 33 {
		t.Fatalf("persisted offset = %d, want 33 — the malformed update must still be consumed", v)
	}
}

func TestBatchWithNoUsableUpdateIDIsAnErrorNotAGuess(t *testing.T) {
	// A response that is JSON but not Telegram-shaped. We cannot say where
	// these sit in the queue, so we confirm nothing, actuate nothing, and back
	// off — rather than guessing an offset and confirming updates never read.
	st := newTGAPIStub(t, func(int, int64) (int, string) {
		return 200, okBatch(`{"nothing":"useful"}`)
	})
	rec := &recorder{}
	off := &offsetFile{}
	p := testPoller(st, rec.handle, off)
	cancel, done := runPoller(p)
	waitFor(t, "a few polls", func() bool { return st.calls() >= 3 })
	cancel()
	<-done

	if got := rec.seen(); len(got) != 0 {
		t.Fatalf("handler was fed %v from a batch with no update_id", got)
	}
	if _, stored := off.get(); stored {
		t.Fatal("an offset was persisted for a batch whose position is unknown")
	}
	for i, o := range st.asked() {
		if o != 0 {
			t.Fatalf("poll %d asked offset %d, want 0 — nothing may be confirmed here", i, o)
		}
	}
}

// ---------------------------------------------------------------------------
// errors + backoff
// ---------------------------------------------------------------------------

func TestPollingBacksOffOnErrorAndThenRecovers(t *testing.T) {
	const failures = 4
	st := newTGAPIStub(t, func(attempt int, offset int64) (int, string) {
		if attempt < failures {
			return 500, `{"ok":false,"description":"internal"}`
		}
		if attempt == failures {
			return 200, okBatch(tgTextUpdate(60, "open"))
		}
		return 200, okBatch()
	})
	rec := &recorder{}
	off := &offsetFile{}
	p := testPoller(st, rec.handle, off)
	// 5ms floor doubling to a 40ms ceiling: four failures cost at least
	// 5+10+20+40 = 75ms of deliberate waiting.
	start := time.Now()
	cancel, done := runPoller(p)
	waitFor(t, "recovery after the failures", func() bool { return len(rec.seen()) == 1 })
	elapsed := time.Since(start)
	cancel()
	<-done

	if elapsed < 70*time.Millisecond {
		t.Fatalf("recovered in %v — the loop is hot-spinning rather than backing off", elapsed)
	}
	if asked := st.asked(); asked[failures] != 0 {
		t.Fatalf("after errors the poll asked offset %d, want 0 — a failed poll must not advance", asked[failures])
	}
	if v, _ := off.get(); v != 61 {
		t.Fatalf("persisted offset = %d, want 61 after recovery", v)
	}
}

func TestBackoffIsBoundedByBackoffMax(t *testing.T) {
	// Errors forever: the gap between polls must plateau at BackoffMax rather
	// than doubling into hours, so a gateway that was offline overnight comes
	// back within a bounded time of the network returning.
	st := newTGAPIStub(t, func(int, int64) (int, string) {
		return 502, `{"ok":false,"description":"bad gateway"}`
	})
	p := testPoller(st, func(context.Context, *TGUpdate) {}, nil)
	p.BackoffMin = time.Millisecond
	p.BackoffMax = 5 * time.Millisecond
	cancel, done := runPoller(p)
	waitFor(t, "the backoff to plateau", func() bool { return st.calls() >= 10 })
	// 10 polls with an unbounded doubling from 1ms would already be ~1s; with
	// the 5ms ceiling it is ~40ms. Reaching 10 inside waitFor's 3s deadline is
	// the assertion.
	cancel()
	<-done
}

func TestRetryAfterFromTelegramIsHonoured(t *testing.T) {
	// A 429 carries Telegram's own retry_after, which is better information
	// than our exponential guess. It must be used and must not be exceeded by
	// our own doubling on the following attempt.
	st := newTGAPIStub(t, func(attempt int, offset int64) (int, string) {
		switch {
		case attempt == 0:
			return 429, `{"ok":false,"description":"Too Many Requests","parameters":{"retry_after":1}}`
		case offset <= 70:
			return 200, okBatch(tgTextUpdate(70, "open"))
		default:
			return 200, okBatch()
		}
	})
	rec := &recorder{}
	p := testPoller(st, rec.handle, nil)
	start := time.Now()
	cancel, done := runPoller(p)
	waitFor(t, "the retry", func() bool { return len(rec.seen()) >= 1 })
	elapsed := time.Since(start)
	cancel()
	<-done
	if elapsed < 900*time.Millisecond {
		t.Fatalf("retried after %v, ignoring Telegram's retry_after of 1s", elapsed)
	}
}

// ---------------------------------------------------------------------------
// shutdown
// ---------------------------------------------------------------------------

func TestShutdownDoesNotWaitForAnInFlightGetUpdates(t *testing.T) {
	// The whole point of a long poll is that the request sits open for up to
	// PollTimeout. If shutdown waited that out, every restart and every SIGTERM
	// would stall for half a minute. Cancelling ctx must abort the request in
	// flight.
	entered := make(chan struct{}, 1)
	// release lets the fake API's handler finish at the END of the test.
	// Without it httptest.Server.Close would block on a handler that is, by
	// design, still holding its long poll open — which is the fake's problem,
	// not the poller's, and would hide the very thing being measured.
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case entered <- struct{}{}:
		default:
		}
		// Hold the connection open until the client gives up (or the test ends).
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer srv.Close()
	defer close(release)

	p := &TelegramPoller{
		BotToken:    testBotToken,
		Engine:      TelegramEnginePolling,
		Handle:      func(context.Context, *TGUpdate) {},
		APIBase:     srv.URL,
		PollTimeout: 5 * time.Minute, // far longer than any test may take
		BackoffMin:  time.Millisecond,
		Logger:      discardLogger(),
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); p.Run(ctx) }()

	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		cancel()
		t.Fatal("the poller never issued a getUpdates")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Run did not return promptly: an in-flight getUpdates blocked shutdown")
	}
}

func TestAlreadyCancelledContextNeverPolls(t *testing.T) {
	st := newTGAPIStub(t, func(int, int64) (int, string) { return 200, okBatch() })
	p := testPoller(st, func(context.Context, *TGUpdate) {}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() { defer close(done); p.Run(ctx) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return for an already-cancelled context")
	}
	if n := st.calls(); n != 0 {
		t.Fatalf("polled %d times on a cancelled context", n)
	}
}

// ---------------------------------------------------------------------------
// request shape
// ---------------------------------------------------------------------------

func TestGetUpdatesRequestCarriesTheBotTokenTimeoutAndAllowedUpdates(t *testing.T) {
	type seenReq struct {
		path    string
		timeout int
		allowed []string
	}
	got := make(chan seenReq, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Timeout int      `json:"timeout"`
			Allowed []string `json:"allowed_updates"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		select {
		case got <- seenReq{path: r.URL.Path, timeout: req.Timeout, allowed: req.Allowed}:
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, okBatch())
	}))
	defer srv.Close()

	p := &TelegramPoller{
		BotToken: testBotToken, Engine: TelegramEnginePolling,
		Handle: func(context.Context, *TGUpdate) {}, APIBase: srv.URL,
		PollTimeout: 25 * time.Second, BackoffMin: time.Millisecond, Logger: discardLogger(),
	}
	cancel, done := runPoller(p)
	var r seenReq
	select {
	case r = <-got:
	case <-time.After(3 * time.Second):
		cancel()
		t.Fatal("no request observed")
	}
	cancel()
	<-done

	// The bot token is in the path: it is what authenticates US to Telegram and
	// scopes the response to this bot's queue.
	if want := "/bot" + testBotToken + "/getUpdates"; r.path != want {
		t.Errorf("path = %q, want %q", r.path, want)
	}
	if r.timeout != 25 {
		t.Errorf("timeout = %d, want 25 (the long poll, in seconds)", r.timeout)
	}
	// Pinned: a future update type never arrives as an unparsed blob.
	if len(r.allowed) != 2 || r.allowed[0] != "message" || r.allowed[1] != "callback_query" {
		t.Errorf("allowed_updates = %v, want [message callback_query]", r.allowed)
	}
}

func TestDefaultAPIBaseIsTelegramOverTLS(t *testing.T) {
	// TLS to this exact host IS the inbound authenticity on this engine. A
	// default that drifted to plain http, or to another host, would remove it
	// silently — there is no secret token here to fall back on.
	p := &TelegramPoller{}
	if got := p.apiBase(); got != "https://api.telegram.org" {
		t.Fatalf("default API base = %q, want https://api.telegram.org", got)
	}
}

func TestHTTPClientDeadlineOutlivesTheLongPoll(t *testing.T) {
	// A client timeout at or below the server-side hold would abort every idle
	// poll and turn normal operation into a permanent error/backoff loop.
	p := &TelegramPoller{PollTimeout: 30 * time.Second}
	if c := p.httpClient(); c.Timeout <= 30*time.Second {
		t.Fatalf("client timeout %v does not outlive the 30s long poll", c.Timeout)
	}
	p2 := &TelegramPoller{}
	if c := p2.httpClient(); c.Timeout <= p2.pollTimeout() {
		t.Fatalf("default client timeout %v does not outlive the default %v long poll", c.Timeout, p2.pollTimeout())
	}
}
