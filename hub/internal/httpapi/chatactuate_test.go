package httpapi

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// The first time a chat message drives something that is not a gate.
//
// docs/CHAT-COMMANDS.md §3 at T1 and no higher. Every test here is about a
// refusal except the first: the feature is mostly the set of things it will not
// do, and each of those is a branch that would be silently permissive if it
// were wrong.

type actEnv struct {
	srv     *Server
	st      *store.Store
	userID  string
	profile string
}

func actuationServer(t *testing.T) *actEnv {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	reg := devices.NewRegistry()
	if err := reg.Register(devices.NewMockDriver("mock")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	access, _ := register(t, h, "owner@act.test")
	_ = access
	u, err := st.UserByUsername(context.Background(), "owner@act.test")
	if err != nil {
		t.Fatal(err)
	}
	// One account on the hub, so the scope is soleAccount and the whole mock
	// fleet is visible — the household case this product is mostly for.
	return &actEnv{srv: srv, st: st, userID: u.ID, profile: u.ID}
}

func (e *actEnv) act(t *testing.T, body string, v devices.Verb) (chatActuationResult, bool) {
	t.Helper()
	return e.srv.chatActuate(context.Background(), body, e.profile, channels.KindWhatsApp, v)
}

func (e *actEnv) commands(t *testing.T, command string) int {
	t.Helper()
	rows, err := e.st.DB().Query(`SELECT count(*) FROM access_logs WHERE command = ?`, command)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	if rows.Next() {
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
	}
	return n
}

// The one that does something.
func TestAT1VerbActuatesAndIsAudited(t *testing.T) {
	e := actuationServer(t)
	res, handled := e.act(t, "turn on the garden lights", devices.VerbOn)
	if !handled || !res.Actuated {
		t.Fatalf("handled=%v actuated=%v reply=%q", handled, res.Actuated, res.Reply)
	}
	if !strings.Contains(res.Reply, "Garden Lights") || !strings.Contains(res.Reply, "now on") {
		t.Errorf("reply does not report what happened: %q", res.Reply)
	}
	// §3.8: the same table as a gate open, never a second log.
	if n := e.commands(t, "on"); n != 1 {
		t.Errorf("audited `on` rows: %d, want 1", n)
	}
}

// The ceiling, exercised by the verb that actually reaches it.
//
// This test first used `start`, and passed for the wrong reason: `start` is not
// in chatArgumentlessVerbs, so it never got as far as the tier check and the
// ceiling was untested. `resume` IS in that set, and `resume` on a mower's
// blade-job is TierHazardousMotion — resuming a mower spins blades. The ceiling
// is the only thing between a text message and that, which is precisely why it
// had to be tested by something that reaches it.
func TestAHazardousVerbIsRefusedFromChat(t *testing.T) {
	e := actuationServer(t)
	res, handled := e.act(t, "resume the mower", devices.VerbResume)
	if !handled {
		t.Fatal("not handled — the ceiling was never consulted, so this proves nothing")
	}
	if res.Actuated {
		t.Fatal("chat resumed a mower's blades")
	}
	if !strings.Contains(res.Reply, "hazardous-motion") {
		t.Errorf("refusal does not name the tier: %q", res.Reply)
	}
	if !strings.Contains(res.Reply, "console") {
		t.Errorf("refusal does not say where it CAN be done: %q", res.Reply)
	}
	if n := e.commands(t, "resume"); n != 0 {
		t.Errorf("a refused command was audited as sent: %d", n)
	}
}

// A consequential verb is refused too — the ceiling is T1, not "anything below
// hazardous". Resuming the cleaning bot costs time and power and is T2.
func TestAConsequentialVerbIsAlsoRefused(t *testing.T) {
	e := actuationServer(t)
	res, handled := e.act(t, "resume the cleaning bot", devices.VerbResume)
	if !handled || res.Actuated {
		t.Fatalf("handled=%v actuated=%v — T2 is above the chat ceiling", handled, res.Actuated)
	}
	if !strings.Contains(res.Reply, "consequential") {
		t.Errorf("refusal does not name the tier: %q", res.Reply)
	}
}

// `start` is refused earlier still: it is not a verb chat sends at all.
func TestStartIsNotAVerbChatSends(t *testing.T) {
	e := actuationServer(t)
	if _, handled := e.act(t, "start the mower", devices.VerbStart); handled {
		t.Error("chat claimed to handle `start`")
	}
}

// And the verb that IS reachable on the same device: §3.2 requires every
// hazardous verb to have a safe inverse, and stopping must never be harder
// than starting.
func TestStoppingIsReachableWhereStartingIsNot(t *testing.T) {
	e := actuationServer(t)
	res, handled := e.act(t, "stop the mower", devices.VerbStop)
	if !handled || !res.Actuated {
		t.Fatalf("stop refused: handled=%v reply=%q", handled, res.Reply)
	}
}

// Ambiguity actuates nothing — §3.5, and the reason the resolver refuses ties.
func TestAnAmbiguousBodyActuatesNothing(t *testing.T) {
	e := actuationServer(t)
	// "the light" names no device: below the floor on kind alone.
	if res, handled := e.act(t, "turn on the light", devices.VerbOn); handled && res.Actuated {
		t.Fatal("an unresolved body actuated a device")
	}
	if n := e.commands(t, "on"); n != 0 {
		t.Errorf("an unresolved body wrote an audit row: %d", n)
	}
}

// A genuine ambiguity — two devices with the same name, both able to do it —
// actuates NOTHING.
//
// The mock fleet has one device per name, so the earlier test only ever reached
// "resolved nothing". This registers the driver twice so "Garden Lights" exists
// on both, which is the realistic collision: two bridges, one lamp name. It is
// the case where taking the first candidate would be silently wrong, and where
// the member would be told the right device had been driven.
func TestATrueAmbiguityActuatesNothing(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, _ := keys.Load(dir)
	reg := devices.NewRegistry()
	for _, id := range []string{"mock", "mock2"} {
		if err := reg.Register(devices.NewMockDriver(id)); err != nil {
			t.Fatal(err)
		}
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	register(t, h, "amb@act.test")
	u, err := st.UserByUsername(context.Background(), "amb@act.test")
	if err != nil {
		t.Fatal(err)
	}

	res, handled := srv.chatActuate(context.Background(), "turn on the garden lights", u.ID,
		channels.KindWhatsApp, devices.VerbOn)
	if handled && res.Actuated {
		t.Fatal("actuated one of two identically named devices — the member would be told the right one moved")
	}
	var n int
	if err := st.DB().QueryRow(`SELECT count(*) FROM access_logs WHERE command = 'on'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("an ambiguous body wrote %d audit rows", n)
	}
}

// The cooldown §3.3's T1 row requires. A duplicate webhook delivery must not
// actuate twice.
func TestTheSameCommandTwiceIsCooledDown(t *testing.T) {
	e := actuationServer(t)
	if res, _ := e.act(t, "turn on the garden lights", devices.VerbOn); !res.Actuated {
		t.Fatal("first actuation failed")
	}
	res, handled := e.act(t, "turn on the garden lights", devices.VerbOn)
	if !handled {
		t.Fatal("second attempt was not handled")
	}
	if res.Actuated {
		t.Error("the same command actuated twice inside the cooldown")
	}
	if !strings.Contains(res.Reply, "give it a moment") {
		t.Errorf("cooldown refusal does not explain itself: %q", res.Reply)
	}
	if n := e.commands(t, "on"); n != 1 {
		t.Errorf("audited `on` rows: %d, want 1 — a cooled-down attempt was logged as sent", n)
	}
}

// The cooldown is per (subject, device, VERB). Turning a lamp on and then off
// is a legitimate sequence, not a repeat, and a member must not be told to wait.
func TestTheCooldownDoesNotBlockTheInverseVerb(t *testing.T) {
	e := actuationServer(t)
	if res, _ := e.act(t, "turn on the garden lights", devices.VerbOn); !res.Actuated {
		t.Fatal("on failed")
	}
	if res, _ := e.act(t, "turn off the garden lights", devices.VerbOff); !res.Actuated {
		t.Errorf("off was blocked by on's cooldown: %q", res.Reply)
	}
}

// And per DEVICE: one lamp's cooldown must not silence another device.
func TestTheCooldownIsPerDevice(t *testing.T) {
	e := actuationServer(t)
	if res, _ := e.act(t, "stop the mower", devices.VerbStop); !res.Actuated {
		t.Fatal("mower stop failed")
	}
	if res, _ := e.act(t, "stop the cleaning bot", devices.VerbStop); !res.Actuated {
		t.Errorf("one device's cooldown blocked another: %q", res.Reply)
	}
}

// A verb taking a value is not sent from chat at all, even at T1.
func TestAVerbWithAnArgumentIsNotSentFromChat(t *testing.T) {
	e := actuationServer(t)
	if _, handled := e.act(t, "set the thermostat to 21", devices.VerbSet); handled {
		t.Error("chat sent a verb that takes a value")
	}
}

// No engine configured is not an error and not an actuation.
func TestNoEngineMeansTheRailFallsThrough(t *testing.T) {
	h := newTestServer(t, "")
	_ = h
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, _ := keys.Load(dir)
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef")},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	if _, handled := srv.chatActuate(context.Background(), "turn on the lights", "nobody", channels.KindWhatsApp, devices.VerbOn); handled {
		t.Error("a hub with no engine claimed to handle an actuation")
	}
}
