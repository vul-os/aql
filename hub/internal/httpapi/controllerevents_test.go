package httpapi

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// End-to-end: a controller-signed event over the real websocket must reach
// the audit log.
//
// This test exists because of the shape of the defect it covers. The store
// method could be perfectly correct and perfectly tested while nothing on the
// wire ever called it — which is EXACTLY what was wrong before: the
// controller's queue, signing, reserved partition and overflow log were all
// present and tested, and the hub's handler for the frame they produced was
// `s.log.Info("controller event")`. A unit test of the store would have been
// green throughout.
//
// So the assertion deliberately starts at the socket and ends at the table an
// operator reads, with no in-process shortcut between them.

func signEvent(t *testing.T, priv ed25519.PrivateKey, deviceID, eventID, kind string, data map[string]any) []byte {
	t.Helper()
	m := map[string]any{
		"v": 0, "typ": "event", "event_id": eventID, "device_id": deviceID,
		"kind": kind, "ts": time.Now().Unix(), "data": data,
	}
	canonical, err := keys.Canonicalize(m)
	if err != nil {
		t.Fatal(err)
	}
	m["sig"] = base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, canonical))
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// authedWS pairs nothing new: it dials, completes the ws.auth handshake and
// hands back a live connection ready for uplink frames.
func authedWS(t *testing.T, ts *httptest.Server, priv ed25519.PrivateKey, deviceID string) (*websocket.Conn, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)

	conn := dialWS(t, ts)
	t.Cleanup(func() { conn.Close(websocket.StatusNormalClosure, "done") })

	_, raw, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var ch struct {
		Cnonce string `json:"cnonce"`
	}
	if err := json.Unmarshal(raw, &ch); err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageText,
		signAuth(t, priv, deviceID, ch.Cnonce, time.Now().Unix())); err != nil {
		t.Fatal(err)
	}
	return conn, ctx
}

func TestSignedControllerEventReachesTheAuditLog(t *testing.T) {
	ts, _, st := newLiveServer(t)
	access, accountID, locationID, deviceID, priv := pairDevice(t, ts)

	code, out := liveJSON(t, ts, "POST", "/v1/access-points", access, map[string]any{
		"location_id": locationID, "name": "Gate", "kind": "gate", "device_id": deviceID,
	})
	if code != http.StatusCreated {
		t.Fatalf("ap create: %d %v", code, out)
	}

	conn, ctx := authedWS(t, ts, priv, deviceID)
	ev := signEvent(t, priv, deviceID, "ev-e2e-1", "grant_redeemed", map[string]any{
		"grant_id": "g-1", "cnonce": "abcd", "access_point": "main",
	})
	if err := conn.Write(ctx, websocket.MessageText, ev); err != nil {
		t.Fatal(err)
	}

	logs := waitForAccessLogs(t, st, accountID, 1)
	if logs[0].Source != store.SourceOfflineGrant {
		t.Errorf("source = %q, want %q", logs[0].Source, store.SourceOfflineGrant)
	}
	if !logs[0].Success || logs[0].Command != "open" {
		t.Errorf("row = %q success=%v, want open/true", logs[0].Command, logs[0].Success)
	}
}

// Fail-closed, over the wire. An event signed by a key the hub never enrolled
// must not reach the audit log — an attacker who can reach the websocket
// would otherwise be able to write "the gate opened" into an append-only,
// hash-chained record that a resident manager treats as evidence.
func TestUnsignedControllerEventIsRejectedBeforeStorage(t *testing.T) {
	ts, _, st := newLiveServer(t)
	access, accountID, locationID, deviceID, priv := pairDevice(t, ts)

	code, _ := liveJSON(t, ts, "POST", "/v1/access-points", access, map[string]any{
		"location_id": locationID, "name": "Gate", "kind": "gate", "device_id": deviceID,
	})
	if code != http.StatusCreated {
		t.Fatalf("ap create: %d", code)
	}

	conn, ctx := authedWS(t, ts, priv, deviceID)

	_, attacker, _ := ed25519.GenerateKey(nil)
	forged := signEvent(t, attacker, deviceID, "ev-forged", "grant_redeemed", map[string]any{"grant_id": "g-x"})
	if err := conn.Write(ctx, websocket.MessageText, forged); err != nil {
		t.Fatal(err)
	}

	// Then a genuine one, so the test waits on a real signal rather than on a
	// sleep: once the good event has landed, the forged one has certainly been
	// processed (same connection, same reader goroutine, in order).
	good := signEvent(t, priv, deviceID, "ev-genuine", "grant_redeemed", map[string]any{"grant_id": "g-ok"})
	if err := conn.Write(ctx, websocket.MessageText, good); err != nil {
		t.Fatal(err)
	}
	logs := waitForAccessLogs(t, st, accountID, 1)

	if len(logs) != 1 {
		t.Fatalf("want exactly 1 audit row (the genuine event), got %d", len(logs))
	}
	evs, err := st.ControllerEventsByDevice(context.Background(), deviceID, 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range evs {
		if e.EventID == "ev-forged" {
			t.Fatal("an event signed by an unenrolled key was stored")
		}
	}
}

// events.md's at-least-once delivery, exercised on the wire: the same event
// sent twice must produce one audit row. A redelivery is expected behaviour
// (no ack exists to prevent it), so double-logging a gate opening would be a
// defect visible to whoever reads the log.
func TestRedeliveredEventOverTheWireLogsOnce(t *testing.T) {
	ts, _, st := newLiveServer(t)
	access, accountID, locationID, deviceID, priv := pairDevice(t, ts)

	code, _ := liveJSON(t, ts, "POST", "/v1/access-points", access, map[string]any{
		"location_id": locationID, "name": "Gate", "kind": "gate", "device_id": deviceID,
	})
	if code != http.StatusCreated {
		t.Fatalf("ap create: %d", code)
	}

	conn, ctx := authedWS(t, ts, priv, deviceID)
	ev := signEvent(t, priv, deviceID, "ev-twice", "grant_redeemed", map[string]any{"grant_id": "g-1"})
	for i := 0; i < 2; i++ {
		if err := conn.Write(ctx, websocket.MessageText, ev); err != nil {
			t.Fatal(err)
		}
	}
	// A trailing distinct event gives a deterministic settle point.
	tail := signEvent(t, priv, deviceID, "ev-tail", "boot", map[string]any{"fw": "1.0"})
	if err := conn.Write(ctx, websocket.MessageText, tail); err != nil {
		t.Fatal(err)
	}
	waitForControllerEvents(t, st, deviceID, 2) // ev-twice + ev-tail, never 3

	logs, err := st.AccessLogsByAccount(context.Background(), accountID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("one gate opening produced %d audit rows after redelivery", len(logs))
	}
}

func waitForAccessLogs(t *testing.T, st *store.Store, accountID string, want int) []store.AccessLog {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		logs, err := st.AccessLogsByAccount(context.Background(), accountID, 50)
		if err != nil {
			t.Fatal(err)
		}
		if len(logs) >= want {
			return logs
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no audit row appeared within the deadline; the event never reached the log")
	return nil
}

func waitForControllerEvents(t *testing.T, st *store.Store, deviceID string, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		evs, err := st.ControllerEventsByDevice(context.Background(), deviceID, 50)
		if err != nil {
			t.Fatal(err)
		}
		if len(evs) >= want {
			// Settle briefly so a spurious extra insert would be visible.
			time.Sleep(100 * time.Millisecond)
			evs, err = st.ControllerEventsByDevice(context.Background(), deviceID, 50)
			if err != nil {
				t.Fatal(err)
			}
			if len(evs) != want {
				t.Fatalf("stored %d events, want exactly %d", len(evs), want)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("controller events never reached the store")
}

// The read side of the stored evidence.
//
// 0019 stores each event's envelope VERBATIM on the grounds that a signature
// is only re-checkable against the exact bytes it covered. That rationale is
// only true if the bytes can be got back out — a stored signature nobody can
// retrieve is decorative — so this route is part of the feature rather than a
// convenience on top of it.
func TestStoredEventsAreRetrievableWithTheirSignedBytes(t *testing.T) {
	ts, _, _ := newLiveServer(t)
	access, _, locationID, deviceID, priv := pairDevice(t, ts)

	code, out := liveJSON(t, ts, "POST", "/v1/access-points", access, map[string]any{
		"location_id": locationID, "name": "Gate", "kind": "gate", "device_id": deviceID,
	})
	if code != http.StatusCreated {
		t.Fatalf("ap create: %d %v", code, out)
	}

	conn, ctx := authedWS(t, ts, priv, deviceID)
	raw := signEvent(t, priv, deviceID, "ev-read-1", "grant_redeemed", map[string]any{"grant_id": "g-1"})
	if err := conn.Write(ctx, websocket.MessageText, raw); err != nil {
		t.Fatal(err)
	}

	var events []any
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		code, out = liveJSON(t, ts, "GET", "/v1/devices/"+deviceID+"/events", access, nil)
		if code != 200 {
			t.Fatalf("events: %d %v", code, out)
		}
		events, _ = out["events"].([]any)
		if len(events) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	ev, _ := events[0].(map[string]any)
	if ev["event_id"] != "ev-read-1" || ev["kind"] != "grant_redeemed" {
		t.Errorf("event: %v", ev)
	}
	// The exact bytes, not a re-rendering: an auditor verifies the signature
	// against these, so anything else makes the stored sig unusable.
	if env, _ := ev["envelope"].(string); env != string(raw) {
		t.Errorf("envelope is not the signed bytes:\n got %s\nwant %s", env, raw)
	}
}

// Signed evidence about one account's gates, behind a guessable device id.
func TestDeviceEventsAreAdminOnlyAndDoNotLeakExistence(t *testing.T) {
	ts, _, _ := newLiveServer(t)
	_, _, _, deviceID, _ := pairDevice(t, ts)

	// A second account with no relationship to that device.
	code, out := liveJSON(t, ts, "POST", "/v1/auth/register", "", map[string]any{
		"username": "outsider@events.com", "password": "hunter2hunter2", "location_name": "Elsewhere",
	})
	if code != http.StatusCreated {
		t.Fatalf("register outsider: %d %v", code, out)
	}
	other := out["tokens"].(map[string]any)["access_token"].(string)

	code, _ = liveJSON(t, ts, "GET", "/v1/devices/"+deviceID+"/events", other, nil)
	if code != http.StatusNotFound {
		t.Errorf("outsider got %d, want 404 (not 403 — a device they cannot see must be "+
			"indistinguishable from one that does not exist)", code)
	}
	// And an id that really does not exist answers the same way.
	code, _ = liveJSON(t, ts, "GET", "/v1/devices/does-not-exist/events", other, nil)
	if code != http.StatusNotFound {
		t.Errorf("unknown device: %d, want 404", code)
	}
}
