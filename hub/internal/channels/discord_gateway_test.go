package channels

// Discord Gateway protocol tests. Everything here runs against a FAKE gateway
// — an in-memory SocketConn for the deterministic protocol cases, and a real
// coder/websocket server on a local httptest listener for the end-to-end one.
// Nothing in this file touches the network, and no real token exists.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// discordConn is an in-memory SocketConn (the same shape socketmode_test.go's
// fakeConn has; kept separate so the two rails' tests cannot drift into each
// other).
type discordConn struct {
	toClient   chan []byte
	fromClient chan []byte
	closeOnce  sync.Once
	closed     chan struct{}
}

func newDiscordConn() *discordConn {
	return &discordConn{toClient: make(chan []byte, 16), fromClient: make(chan []byte, 16), closed: make(chan struct{})}
}

func (c *discordConn) Read(ctx context.Context) ([]byte, error) {
	select {
	case b := <-c.toClient:
		return b, nil
	case <-c.closed:
		return nil, context.Canceled
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *discordConn) Write(ctx context.Context, data []byte) error {
	cp := append([]byte(nil), data...)
	select {
	case c.fromClient <- cp:
		return nil
	case <-c.closed:
		return context.Canceled
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *discordConn) Close() { c.closeOnce.Do(func() { close(c.closed) }) }

// nextFrame reads one client→server frame, decoded.
// frameWait is how long to allow for a frame the code under test sends
// immediately; serveWait bounds the serve() call that produces it.
//
// frameWait must stay well INSIDE serveWait. Otherwise a frame that is merely
// slow to be scheduled fails on the context being cancelled — a different error
// in a different place, pointing at the wrong thing.
//
// Both are generous because both wait on the SCHEDULER, not on work. See
// TestDiscordAcknowledgedHeartbeatsKeepTheConnection for why one second was not
// enough under `go test ./...`.
const (
	frameWait = 5 * time.Second
	serveWait = 20 * time.Second
)

func nextFrame(t *testing.T, c *discordConn, within time.Duration) map[string]any {
	t.Helper()
	select {
	case raw := <-c.fromClient:
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("client sent undecodable frame %s: %v", raw, err)
		}
		return m
	case <-time.After(within):
		t.Fatal("client sent no frame")
		return nil
	}
}

func opOf(m map[string]any) int {
	f, _ := m["op"].(float64)
	return int(f)
}

func hello(intervalMS int) []byte {
	return []byte(`{"op":10,"d":{"heartbeat_interval":` + itoa(int64(intervalMS)) + `}}`)
}

// TestDiscordIdentifiesThenHeartbeatsAtTheServersInterval. Two properties in
// one: the rail IDENTIFIES with the token and its intents before doing
// anything else, and it beats at the interval the SERVER dictated in HELLO —
// never a number this client chose.
func TestDiscordIdentifiesThenHeartbeatsAtTheServersInterval(t *testing.T) {
	conn := newDiscordConn()
	d := &Discord{BotToken: "bot-token", FirstBeatFraction: 1}
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	var sess discordSession
	done := make(chan error, 1)
	go func() { done <- d.serve(ctx, conn, &sess) }()

	conn.toClient <- hello(40) // 40ms so the test does not sleep for real

	id := nextFrame(t, conn, frameWait)
	if opOf(id) != discordOpIdentify {
		t.Fatalf("first client frame was op %d, want IDENTIFY", opOf(id))
	}
	data, _ := id["d"].(map[string]any)
	if data["token"] != "bot-token" {
		t.Fatalf("identify did not carry the bot token: %+v", data)
	}
	if got, _ := data["intents"].(float64); int(got) != DiscordDefaultIntents {
		t.Fatalf("identify intents = %v, want %d", data["intents"], DiscordDefaultIntents)
	}

	// A dispatch arrives (recording its sequence), then the heartbeat must
	// carry that sequence — that is what makes a later RESUME able to ask for
	// exactly what was missed.
	conn.toClient <- []byte(`{"op":0,"s":7,"t":"READY","d":{"session_id":"sess-1","resume_gateway_url":"wss://resume.example"}}`)

	hb := nextFrame(t, conn, frameWait)
	if opOf(hb) != discordOpHeartbeat {
		t.Fatalf("expected a heartbeat, got op %d", opOf(hb))
	}
	if seq, _ := hb["d"].(float64); int64(seq) != 7 {
		t.Fatalf("heartbeat carried seq %v, want 7", hb["d"])
	}

	// An unacknowledged heartbeat means a zombie connection: the rail must
	// drop it rather than block on a socket nobody is serving.
	select {
	case err := <-done:
		if err != errDiscordZombie {
			t.Fatalf("want zombie drop, got %v", err)
		}
	case <-ctx.Done():
		t.Fatal("an unacknowledged heartbeat never dropped the connection")
	}

	// READY was recorded, so the next attempt can resume.
	if sess.id != "sess-1" || sess.resumeURL != "wss://resume.example" || sess.seq != 7 {
		t.Fatalf("session not captured for resume: %+v", sess)
	}
}

// TestDiscordAcknowledgedHeartbeatsKeepTheConnection: an ACKed beat is not a
// zombie, and the rail keeps beating.
func TestDiscordAcknowledgedHeartbeatsKeepTheConnection(t *testing.T) {
	conn := newDiscordConn()
	d := &Discord{BotToken: "tok", FirstBeatFraction: 1}
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	var sess discordSession
	done := make(chan error, 1)
	go func() { done <- d.serve(ctx, conn, &sess) }()

	conn.toClient <- hello(30)
	// A generous budget on purpose. These waits are for a goroutine to be
	// SCHEDULED, not for anything to compute, and one second of that is fine in
	// isolation and tight when `go test ./...` is running every package at
	// once — this test failed there while passing three times in a row alone.
	//
	// The property is unchanged: a heartbeat must be sent and acked. Allowing
	// more wall-clock does not weaken it, whereas asserting scheduler latency
	// as if it were behaviour makes the suite untrustworthy — and an
	// intermittently red suite gets its failures blamed on the run.
	nextFrame(t, conn, frameWait) // identify
	for i := 0; i < 3; i++ {
		hb := nextFrame(t, conn, frameWait)
		if opOf(hb) != discordOpHeartbeat {
			t.Fatalf("beat %d: op %d", i, opOf(hb))
		}
		conn.toClient <- []byte(`{"op":11}`)
	}
	select {
	case err := <-done:
		t.Fatalf("connection dropped despite ACKs: %v", err)
	default:
	}
}

// TestDiscordServerRequestedHeartbeat: op 1 from the server is answered at
// once, not at the next tick.
func TestDiscordServerRequestedHeartbeat(t *testing.T) {
	conn := newDiscordConn()
	d := &Discord{BotToken: "tok", FirstBeatFraction: 1}
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	var sess discordSession
	go d.serve(ctx, conn, &sess)

	conn.toClient <- hello(60_000) // a beat is a minute away
	nextFrame(t, conn, frameWait)  // identify
	conn.toClient <- []byte(`{"op":1}`)
	hb := nextFrame(t, conn, frameWait)
	if opOf(hb) != discordOpHeartbeat {
		t.Fatalf("server-requested beat unanswered, got op %d", opOf(hb))
	}
	if hb["d"] != nil {
		t.Errorf("with no dispatch seen yet the beat must carry null, got %v", hb["d"])
	}
}

// TestDiscordResumesAfterADrop. The whole point of tracking a session: the
// second connection RESUMES from the last sequence rather than identifying
// fresh and losing whatever arrived while the socket was down.
func TestDiscordResumesAfterADrop(t *testing.T) {
	d := &Discord{BotToken: "tok", FirstBeatFraction: 1}
	sess := discordSession{id: "sess-9", resumeURL: "wss://resume.example", seq: 41, haveSeq: true}

	conn := newDiscordConn()
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	go d.serve(ctx, conn, &sess)

	conn.toClient <- hello(60_000)
	f := nextFrame(t, conn, frameWait)
	if opOf(f) != discordOpResume {
		t.Fatalf("a live session must RESUME, got op %d", opOf(f))
	}
	data, _ := f["d"].(map[string]any)
	if data["session_id"] != "sess-9" {
		t.Errorf("resume carried session %v", data["session_id"])
	}
	if seq, _ := data["seq"].(float64); int64(seq) != 41 {
		t.Errorf("resume carried seq %v, want 41", data["seq"])
	}
	if data["token"] != "tok" {
		t.Errorf("resume did not carry the bot token")
	}
}

// TestDiscordInvalidSessionClearsUnresumableState. `d:false` means the session
// is gone: keeping it would make every reconnect ask to resume something the
// server has already discarded.
func TestDiscordInvalidSessionClearsUnresumableState(t *testing.T) {
	for _, tc := range []struct {
		frame     string
		wantKept  bool
		wantErrIs error
	}{
		{`{"op":9,"d":true}`, true, errDiscordInvalidSession},
		{`{"op":9,"d":false}`, false, errDiscordInvalidSession},
		{`{"op":7}`, true, errDiscordReconnect},
	} {
		conn := newDiscordConn()
		d := &Discord{BotToken: "tok", FirstBeatFraction: 1}
		sess := discordSession{id: "sess-x", resumeURL: "wss://r", seq: 5, haveSeq: true}
		ctx, cancel := context.WithTimeout(context.Background(), serveWait)
		done := make(chan error, 1)
		go func() { done <- d.serve(ctx, conn, &sess) }()
		conn.toClient <- hello(60_000)
		nextFrame(t, conn, frameWait) // resume
		conn.toClient <- []byte(tc.frame)
		select {
		case err := <-done:
			if err != tc.wantErrIs {
				t.Errorf("%s → %v, want %v", tc.frame, err, tc.wantErrIs)
			}
		case <-ctx.Done():
			t.Errorf("%s did not end the connection", tc.frame)
		}
		if kept := sess.id != ""; kept != tc.wantKept {
			t.Errorf("%s: session kept = %v, want %v", tc.frame, kept, tc.wantKept)
		}
		cancel()
	}
}

// TestDiscordDispatchReachesHandler: only the two events this rail asked for
// are handed on, and they are handed on verbatim.
func TestDiscordDispatchReachesHandler(t *testing.T) {
	conn := newDiscordConn()
	var mu sync.Mutex
	var seen []string
	d := &Discord{BotToken: "tok", FirstBeatFraction: 1, Handle: func(_ context.Context, evt string, data json.RawMessage) {
		mu.Lock()
		defer mu.Unlock()
		seen = append(seen, evt+":"+string(data))
	}}
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	var sess discordSession
	go d.serve(ctx, conn, &sess)

	conn.toClient <- hello(60_000)
	nextFrame(t, conn, frameWait) // identify
	conn.toClient <- []byte(`{"op":0,"s":1,"t":"READY","d":{"session_id":"s1"}}`)
	conn.toClient <- []byte(`{"op":0,"s":2,"t":"TYPING_START","d":{"user_id":"u1"}}`)
	conn.toClient <- []byte(`{"op":0,"s":3,"t":"MESSAGE_CREATE","d":{"id":"m1"}}`)
	conn.toClient <- []byte(`{"op":0,"s":4,"t":"INTERACTION_CREATE","d":{"id":"i1"}}`)

	// Same reasoning as frameWait: this polls for a goroutine to have run.
	deadline := time.Now().Add(frameWait)
	for {
		mu.Lock()
		n := len(seen)
		mu.Unlock()
		if n >= 2 || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 2 {
		t.Fatalf("handler saw %v; want exactly the two events this rail asked for", seen)
	}
	if seen[0] != `MESSAGE_CREATE:{"id":"m1"}` || seen[1] != `INTERACTION_CREATE:{"id":"i1"}` {
		t.Fatalf("dispatch payloads altered: %v", seen)
	}
}

// TestDiscordFailsClosedOnMalformedFrames. A frame that does not decode, a
// missing or unusable HELLO, or a HELLO mid-session: none are guessed at, and
// none reach the handler.
func TestDiscordFailsClosedOnMalformedFrames(t *testing.T) {
	for _, tc := range []struct {
		name   string
		frames []string
		want   error
	}{
		{"no hello", []string{`{"op":0,"t":"MESSAGE_CREATE","d":{}}`}, errDiscordNoHello},
		{"hello without an interval", []string{`{"op":10,"d":{}}`}, errDiscordBadHello},
		{"hello with a zero interval", []string{`{"op":10,"d":{"heartbeat_interval":0}}`}, errDiscordBadHello},
		{"ready without a session id", []string{`{"op":10,"d":{"heartbeat_interval":60000}}`, `{"op":0,"s":1,"t":"READY","d":{}}`}, errDiscordBadHello},
		{"hello mid-session", []string{`{"op":10,"d":{"heartbeat_interval":60000}}`, `{"op":10,"d":{"heartbeat_interval":100}}`}, errDiscordMidHello},
	} {
		conn := newDiscordConn()
		handled := 0
		d := &Discord{BotToken: "tok", FirstBeatFraction: 1, Handle: func(context.Context, string, json.RawMessage) { handled++ }}
		ctx, cancel := context.WithTimeout(context.Background(), serveWait)
		done := make(chan error, 1)
		var sess discordSession
		go func() { done <- d.serve(ctx, conn, &sess) }()
		for _, f := range tc.frames {
			conn.toClient <- []byte(f)
		}
		select {
		case err := <-done:
			if err != tc.want {
				t.Errorf("%s → %v, want %v", tc.name, err, tc.want)
			}
		case <-ctx.Done():
			t.Errorf("%s: connection was not dropped", tc.name)
		}
		if handled != 0 {
			t.Errorf("%s: %d event(s) reached the handler", tc.name, handled)
		}
		cancel()
	}

	// Undecodable JSON on an established connection ends it too.
	conn := newDiscordConn()
	d := &Discord{BotToken: "tok", FirstBeatFraction: 1}
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	done := make(chan error, 1)
	var sess discordSession
	go func() { done <- d.serve(ctx, conn, &sess) }()
	conn.toClient <- hello(60_000)
	nextFrame(t, conn, frameWait)
	conn.toClient <- []byte(`{"op":`)
	select {
	case err := <-done:
		if err == nil {
			t.Error("undecodable frame did not end the connection")
		}
	case <-ctx.Done():
		t.Error("undecodable frame did not end the connection")
	}
}

// TestDiscordUnknownOpcodesIgnored: forward compatibility, the same rule
// socketmode.go follows for unknown envelope types.
func TestDiscordUnknownOpcodesIgnored(t *testing.T) {
	conn := newDiscordConn()
	d := &Discord{BotToken: "tok", FirstBeatFraction: 1}
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	done := make(chan error, 1)
	var sess discordSession
	go func() { done <- d.serve(ctx, conn, &sess) }()
	conn.toClient <- hello(60_000)
	nextFrame(t, conn, frameWait)
	conn.toClient <- []byte(`{"op":42,"d":{"whatever":true}}`)
	select {
	case err := <-done:
		t.Fatalf("an unknown opcode ended the connection: %v", err)
	case <-time.After(150 * time.Millisecond):
	}
}

// TestDiscordRealWebSocket drives connectOnce against a fake Discord Gateway
// on a local listener (real coder/websocket transport), proving the zero-URL
// path end to end: URL discovery → dial → hello → identify → dispatch.
func TestDiscordRealWebSocket(t *testing.T) {
	gotIdentify := make(chan map[string]any, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "")
		ctx := r.Context()
		_ = c.Write(ctx, websocket.MessageText, hello(60_000))
		_, raw, err := c.Read(ctx)
		if err != nil {
			return
		}
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		gotIdentify <- m
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"op":0,"s":1,"t":"READY","d":{"session_id":"s1","resume_gateway_url":"wss://x"}}`))
		_ = c.Write(ctx, websocket.MessageText,
			[]byte(`{"op":0,"s":2,"t":"MESSAGE_CREATE","d":{"id":"m1","channel_id":"c1","content":"open","author":{"id":"u1"}}}`))
		<-ctx.Done()
	}))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	handled := make(chan string, 4)
	d := &Discord{
		BotToken:          "tok",
		FirstBeatFraction: 1,
		OpenConn:          func(context.Context) (string, error) { return wsURL, nil },
		Handle: func(_ context.Context, evt string, _ json.RawMessage) {
			handled <- evt
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	var sess discordSession
	go d.connectOnce(ctx, &sess)

	select {
	case id := <-gotIdentify:
		if opOf(id) != discordOpIdentify {
			t.Fatalf("server saw op %d, want IDENTIFY", opOf(id))
		}
	case <-ctx.Done():
		t.Fatal("server never received an identify over the real socket")
	}
	select {
	case evt := <-handled:
		if evt != DiscordEventMessageCreate {
			t.Fatalf("handled %q", evt)
		}
	case <-ctx.Done():
		t.Fatal("dispatch not handled over the real socket")
	}
}

// TestDiscordURLDiscoveryHidesTheToken. A refused token must produce an
// operator-readable error that does NOT contain the credential — an error
// string ends up in logs.
func TestDiscordURLDiscoveryHidesTheToken(t *testing.T) {
	const secret = "super-secret-bot-token"
	var sawAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"401: Unauthorized"}`))
	}))
	defer srv.Close()

	d := &Discord{BotToken: secret, APIBase: srv.URL}
	_, err := d.openViaDiscord(context.Background())
	if err == nil {
		t.Fatal("a 401 must be an error")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("the bot token leaked into an error string: %q", err)
	}
	if sawAuth != "Bot "+secret {
		t.Errorf("must authenticate with the bot scheme, sent %q", sawAuth)
	}

	// The happy path returns the URL Discord named.
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"url":"wss://gateway.discord.gg"}`))
	}))
	defer ok.Close()
	d2 := &Discord{BotToken: secret, APIBase: ok.URL}
	url, err := d2.openViaDiscord(context.Background())
	if err != nil || url != "wss://gateway.discord.gg" {
		t.Fatalf("discovery: %q %v", url, err)
	}
}

// TestDiscordRunStopsOnAFatalRejection: a refused token or a missing
// privileged intent cannot be fixed by reconnecting, so Run must stop and say
// why rather than hammer Discord forever.
func TestDiscordRunStopsOnAFatalRejection(t *testing.T) {
	for _, code := range []websocket.StatusCode{4004, 4013, 4014} {
		if discordFatalClose(websocket.CloseError{Code: code}) == "" {
			t.Errorf("close code %d should be fatal", code)
		}
	}
	if discordFatalClose(nil) != "" || discordFatalClose(context.Canceled) != "" {
		t.Error("an ordinary drop must stay retryable")
	}
	// 4000 (unknown error) is explicitly retryable.
	if discordFatalClose(websocket.CloseError{Code: 4000}) != "" {
		t.Error("close code 4000 is retryable")
	}
	// None of the operator-facing reasons may carry a credential shape.
	for _, code := range []websocket.StatusCode{4004, 4014} {
		if strings.Contains(discordFatalClose(websocket.CloseError{Code: code}), "Bot ") {
			t.Errorf("close reason for %d looks like it carries a token", code)
		}
	}

	// Run returns instead of looping when the dial is rejected fatally.
	d := &Discord{
		BotToken:     "tok",
		ReconnectMin: time.Millisecond,
		OpenConn:     func(context.Context) (string, error) { return "wss://x", nil },
		Dial: func(context.Context, string) (SocketConn, error) {
			return nil, websocket.CloseError{Code: 4004}
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), serveWait)
	defer cancel()
	done := make(chan struct{})
	go func() { d.Run(ctx); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("Run kept retrying a rejected credential")
	}
}

// TestDiscordRunSkipsAnUnconfiguredRail: fail-closed, never "runs
// unauthenticated".
func TestDiscordRunSkipsAnUnconfiguredRail(t *testing.T) {
	dialled := false
	d := &Discord{Dial: func(context.Context, string) (SocketConn, error) { dialled = true; return nil, nil }}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	d.Run(ctx)
	if dialled {
		t.Error("a rail with no bot token dialled out")
	}
}
