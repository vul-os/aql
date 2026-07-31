package httpapi

// A controller's configuration report, from the wire to the API.
//
// The controller signs and sends ctl.report (controller/internal/transport); the
// hub verifies, stores and serves it. Each half has its own tests. This is the
// seam — a signed report arriving on a real session, and the same values coming
// back out of the route an operator's console will call.

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/vul-os/aql/hub/internal/keys"
)

// signReport builds the ctl.report a controller would send.
func signReport(t *testing.T, priv ed25519.PrivateKey, deviceID string, cfg map[string]any) []byte {
	t.Helper()
	m := map[string]any{
		"v": 0, "typ": "ctl.report", "device_id": deviceID,
		"ts": time.Now().Unix(), "firmware": "0.1.0", "config": cfg,
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

func TestAConfigReportIsStoredAndServed(t *testing.T) {
	ts, srv, _ := newLiveServer(t)
	access, _, _, deviceID, priv := pairDevice(t, ts)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	conn := dialWS(t, ts)
	defer conn.Close(websocket.StatusNormalClosure, "done")

	// challenge -> auth
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
	for !srv.Hub().Connected(deviceID) {
		time.Sleep(10 * time.Millisecond)
	}

	report := signReport(t, priv, deviceID, map[string]any{
		"pulse_ms": map[string]any{"value": 700, "source": "default"},
		"hold_max": map[string]any{"value": 45, "source": "config"},
	})
	if err := conn.Write(ctx, websocket.MessageText, report); err != nil {
		t.Fatal(err)
	}

	// Poll: the uplink is handled asynchronously on the server's read loop.
	var body map[string]any
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		code, out := liveJSON(t, ts, "GET", "/v1/devices/"+deviceID+"/config-report", access, nil)
		if code != http.StatusOK {
			t.Fatalf("config-report: %d %v", code, out)
		}
		if reported, _ := out["reported"].(bool); reported {
			body = out
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if body == nil {
		t.Fatal(`a signed ctl.report never reached the API.

The controller sends this on every connect. If the hub is not storing it, an
operator is still looking at a screen that cannot say what a gate is running.`)
	}

	cfg, ok := body["config"].(map[string]any)
	if !ok {
		t.Fatalf("config came back as %T", body["config"])
	}
	hold, ok := cfg["hold_max"].(map[string]any)
	if !ok {
		t.Fatalf("hold_max came back as %T, want an object", cfg["hold_max"])
	}
	if hold["value"] != float64(45) || hold["source"] != "config" {
		t.Errorf("hold_max = %v, want {value:45 source:config}", hold)
	}
	// source is the whole reason this is not just a number.
	pulse, _ := cfg["pulse_ms"].(map[string]any)
	if pulse["source"] != "default" {
		t.Errorf(`pulse_ms source = %v, want "default".

Losing the source makes 700-because-nobody-set-it indistinguishable from
700-because-someone-did, which is half of what the report answers.`, pulse["source"])
	}
	if body["firmware"] != "0.1.0" {
		t.Errorf("firmware = %v", body["firmware"])
	}
}

// A controller that has never reported must not be rendered as its defaults.
func TestAnUnreportedControllerSaysSoRatherThanGuessing(t *testing.T) {
	ts, _, _ := newLiveServer(t)
	access, _, _, deviceID, _ := pairDevice(t, ts)

	code, out := liveJSON(t, ts, "GET", "/v1/devices/"+deviceID+"/config-report", access, nil)
	if code != http.StatusOK {
		t.Fatalf(`an unreported controller answered %d.

"Has told us nothing" and "does not exist" are different answers, and every
controller predating ctl.report is in the first group.`, code)
	}
	if reported, _ := out["reported"].(bool); reported {
		t.Error("a controller that never reported came back as reported")
	}
	if _, present := out["config"]; present {
		t.Error(`the response carries a config for a controller that never sent one.

Filling in the firmware defaults shows numbers nobody confirmed — the exact
failure the console's honest placeholder exists to avoid.`)
	}
}
