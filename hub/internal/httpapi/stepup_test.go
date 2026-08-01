package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// T4 over chat, end to end: a request on one rail, an approval on another.
//
// The property every test here circles is the same one: a chat message NEVER
// moves a mower. Something moves only when a console session approves it, and
// only when all four of §3.3's requirements held at the moment it did.

type stepUpEnv struct {
	h       http.Handler
	st      *store.Store
	srv     *Server
	drv     *devices.MockDriver
	account string
	admin   string // console access token
	profile string // the same person's user id, used as the chat profile
}

func stepUpServer(t *testing.T) *stepUpEnv {
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
	drv := devices.NewMockDriver("mock")
	reg := devices.NewRegistry()
	if err := reg.Register(drv); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	srv := New(Config{
		Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	admin, _ := register(t, h, "t4flow@x.com")
	accountID, _ := tenantIDs(t, h, admin)
	u, err := st.UserByUsername(t.Context(), "t4flow@x.com")
	if err != nil {
		t.Fatal(err)
	}
	return &stepUpEnv{h: h, st: st, srv: srv, drv: drv, account: accountID, admin: admin, profile: u.ID}
}

// arm opens a window for the mower's `start` so the chat path can get past
// requirement (2).
func (e *stepUpEnv) arm(t *testing.T, verb string, maxUses int) {
	t.Helper()
	body := map[string]any{"device_key": "mock:mower-1", "verb": verb, "duration_s": 1800}
	if maxUses > 0 {
		body["max_uses"] = maxUses
	}
	rec, out := doJSON(t, e.h, "POST", "/v1/accounts/"+e.account+"/t4-windows", e.admin, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("arm: %d %v", rec.Code, out)
	}
}

// ask sends a chat message, replaying the confirmation once so the returned
// result is the one after requirement (3) is satisfied.
func (e *stepUpEnv) ask(t *testing.T, body string, v devices.Verb) chatActuationResult {
	t.Helper()
	res, _ := e.srv.chatActuate(t.Context(), body, e.profile, "telegram", "chat-1", "", v)
	if tok, ok := store.ConfirmationTokenIn(res.Reply); ok {
		res, _ = e.srv.chatActuate(t.Context(), body+" "+tok, e.profile, "telegram", "chat-1", tok, v)
	}
	return res
}

// started counts how many times the driver was actually told to start.
//
// The driver, not the reply and not the intent row: only this can tell "a
// record was written" from "a blade turned".
func (e *stepUpEnv) started(verb devices.Verb) int {
	n := 0
	for _, c := range e.drv.Calls {
		if c.Verb == verb {
			n++
		}
	}
	return n
}

func (e *stepUpEnv) pending(t *testing.T) []map[string]any {
	t.Helper()
	_, out := doJSON(t, e.h, "GET", "/v1/accounts/"+e.account+"/stepup-intents", e.admin, nil)
	raw, _ := out["stepup_intents"].([]any)
	var list []map[string]any
	for _, r := range raw {
		list = append(list, r.(map[string]any))
	}
	return list
}

// The whole flow, and the assertion that matters most is in the middle: after
// the chat message and before the approval, NOTHING has moved.
func TestAT4CommandMovesNothingUntilTheConsoleApproves(t *testing.T) {
	e := stepUpServer(t)
	e.arm(t, "start", 0)

	res := e.ask(t, "start the mower", devices.VerbStart)
	if res.Actuated {
		t.Fatalf("chat reported actuation: %q", res.Reply)
	}
	if n := e.started(devices.VerbStart); n != 0 {
		t.Fatalf("the mower was started by a chat message (%d calls)", n)
	}
	if !strings.Contains(res.Reply, "nothing has moved") {
		t.Errorf("the reply does not say plainly that nothing moved: %q", res.Reply)
	}
	if !strings.Contains(res.Reply, "console") {
		t.Errorf("the reply does not say where to approve: %q", res.Reply)
	}

	list := e.pending(t)
	if len(list) != 1 {
		t.Fatalf("expected one pending intent, got %d", len(list))
	}
	intent := list[0]
	if intent["status"] != "pending" || intent["verb"] != "start" {
		t.Fatalf("intent is %v", intent)
	}
	if intent["source"] != "telegram" {
		t.Errorf("the intent does not record which rail asked: %v", intent["source"])
	}

	// The approval, on the console rail.
	rec, out := doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/stepup-intents/"+intent["id"].(string)+"/decide",
		e.admin, map[string]any{"approve": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("approve: %d %v", rec.Code, out)
	}
	if out["outcome"] != "sent" {
		t.Fatalf("approved intent reports outcome %v (%v)", out["outcome"], out["outcome_detail"])
	}
	if n := e.started(devices.VerbStart); n != 1 {
		t.Fatalf("after approval the mower was started %d times, want 1", n)
	}
}

// Rejecting is a decision, not a timeout, and it must leave the device alone.
func TestARejectedIntentNeverActuates(t *testing.T) {
	e := stepUpServer(t)
	e.arm(t, "start", 0)
	e.ask(t, "start the mower", devices.VerbStart)
	intent := e.pending(t)[0]

	rec, out := doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/stepup-intents/"+intent["id"].(string)+"/decide",
		e.admin, map[string]any{"approve": false})
	if rec.Code != http.StatusOK || out["status"] != "rejected" {
		t.Fatalf("reject: %d %v", rec.Code, out)
	}
	if n := e.started(devices.VerbStart); n != 0 {
		t.Errorf("a rejected intent started the mower %d times", n)
	}
	// And it cannot then be approved.
	rec, _ = doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/stepup-intents/"+intent["id"].(string)+"/decide",
		e.admin, map[string]any{"approve": true})
	if rec.Code != http.StatusConflict {
		t.Errorf("a rejected intent was approvable: %d", rec.Code)
	}
	if n := e.started(devices.VerbStart); n != 0 {
		t.Errorf("approving a rejected intent started the mower")
	}
}

// Two approvals racing produce ONE actuation.
//
// A read-then-write claim passes every sequential test above and fails this
// one: both requests see `pending`, both decide to proceed, and a mower starts
// twice. That is the failure the atomic claim exists for.
func TestTwoSimultaneousApprovalsActuateOnce(t *testing.T) {
	e := stepUpServer(t)
	e.arm(t, "start", 0)
	e.ask(t, "start the mower", devices.VerbStart)
	id := e.pending(t)[0]["id"].(string)
	url := "/v1/accounts/" + e.account + "/stepup-intents/" + id + "/decide"

	const racers = 6
	var wg sync.WaitGroup
	codes := make([]int, racers)
	gate := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-gate
			rec, _ := doJSON(t, e.h, "POST", url, e.admin, map[string]any{"approve": true})
			codes[i] = rec.Code
		}(i)
	}
	close(gate)
	wg.Wait()

	won := 0
	for _, c := range codes {
		if c == http.StatusOK {
			won++
		}
	}
	if won != 1 {
		t.Errorf("%d of %d concurrent approvals succeeded", won, racers)
	}
	if n := e.started(devices.VerbStart); n != 1 {
		t.Errorf("the mower was started %d times by concurrent approvals, want 1", n)
	}
}

// With no window armed, the chat rail refuses and records nothing.
func TestWithNoArmedWindowNothingIsEvenRecorded(t *testing.T) {
	e := stepUpServer(t)
	res := e.ask(t, "start the mower", devices.VerbStart)
	if res.Actuated {
		t.Fatal("actuated with no window armed")
	}
	if !strings.Contains(res.Reply, "armed") {
		t.Errorf("the refusal does not say what is missing: %q", res.Reply)
	}
	if list := e.pending(t); len(list) != 0 {
		t.Errorf("%d intents were recorded with no window armed", len(list))
	}
	if n := e.started(devices.VerbStart); n != 0 {
		t.Errorf("the mower moved: %d", n)
	}
}

// Asking does not SPEND a window use. Otherwise a member could exhaust an
// operator's window by asking repeatedly and never approving.
func TestAskingDoesNotSpendAWindowUse(t *testing.T) {
	e := stepUpServer(t)
	e.arm(t, "start", 1) // exactly one use

	for i := 0; i < 3; i++ {
		e.ask(t, "start the mower", devices.VerbStart)
	}
	if len(e.pending(t)) != 3 {
		t.Fatalf("expected three intents, got %d", len(e.pending(t)))
	}

	// The single use is still there: approving one of them works.
	id := e.pending(t)[0]["id"].(string)
	rec, out := doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/stepup-intents/"+id+"/decide",
		e.admin, map[string]any{"approve": true})
	if rec.Code != http.StatusOK || out["outcome"] != "sent" {
		t.Fatalf("three asks consumed the window: %d %v", rec.Code, out)
	}

	// And now it IS spent, so a second approval finds nothing to spend and says
	// so rather than actuating.
	id2 := e.pending(t)[1]["id"].(string)
	_, out2 := doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/stepup-intents/"+id2+"/decide",
		e.admin, map[string]any{"approve": true})
	if out2["outcome"] != "refused" {
		t.Errorf("a second approval against a one-use window reports %v", out2["outcome"])
	}
	if n := e.started(devices.VerbStart); n != 1 {
		t.Errorf("the mower started %d times against a one-use window", n)
	}
}

// A window disarmed between the request and the approval stops the command.
//
// The approval re-checks by SPENDING, not by trusting what was true when the
// message arrived.
func TestDisarmingBetweenRequestAndApprovalStopsIt(t *testing.T) {
	e := stepUpServer(t)
	e.arm(t, "start", 0)
	e.ask(t, "start the mower", devices.VerbStart)
	intentID := e.pending(t)[0]["id"].(string)

	_, wl := doJSON(t, e.h, "GET", "/v1/accounts/"+e.account+"/t4-windows", e.admin, nil)
	windowID := wl["t4_windows"].([]any)[0].(map[string]any)["id"].(string)
	rec, _ := doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/t4-windows/"+windowID+"/disarm", e.admin, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("disarm: %d", rec.Code)
	}

	_, out := doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/stepup-intents/"+intentID+"/decide",
		e.admin, map[string]any{"approve": true})
	if out["outcome"] != "refused" {
		t.Errorf("approving after a disarm reports %v", out["outcome"])
	}
	if n := e.started(devices.VerbStart); n != 0 {
		t.Errorf("the mower started after its window was disarmed: %d", n)
	}
}

// An expired intent is not approvable, and the expiry is derived rather than
// swept — so it holds with nothing running in the background.
func TestAnExpiredIntentCannotBeApproved(t *testing.T) {
	e := stepUpServer(t)
	e.arm(t, "start", 0)

	past := time.Now().Unix() - 3600
	planted, err := e.st.CreateStepUpIntent(t.Context(), store.StepUpIntentArgs{
		AccountID: e.account, RequestedByUserID: e.profile, Source: "telegram",
		DeviceKey: "mock:mower-1", Verb: "start",
		CreatedAt: past, ExpiresAt: past + 600,
	})
	if err != nil {
		t.Fatal(err)
	}
	// The premise: on disk it still says pending.
	if planted.Status != "pending" {
		t.Fatalf("the fixture is not the case this tests: %q", planted.Status)
	}

	rec, _ := doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/stepup-intents/"+planted.ID+"/decide",
		e.admin, map[string]any{"approve": true})
	if rec.Code != http.StatusConflict {
		t.Errorf("an expired intent was approvable: %d", rec.Code)
	}
	if n := e.started(devices.VerbStart); n != 0 {
		t.Errorf("an expired intent started the mower")
	}

	// And the list reports it as expired rather than as the stored column.
	for _, i := range e.pending(t) {
		if i["id"] == planted.ID && i["status"] != "expired" {
			t.Errorf("an expired intent is listed as %v", i["status"])
		}
	}
}

// A plain member cannot get a T4 command out, and — the half that carries the
// weight — cannot APPROVE one.
//
// A note on what this does NOT reach. The request-side role check in
// chatRequestT4 is not exercised here, and the fixture is why: `inviteMember`
// registers the member (which creates their own account) and then adds them to
// the admin's, so they hold TWO accounts, `soleAccountFor` declines to guess
// between them, and the refusal comes from account resolution before the role
// is ever consulted. That refusal is correct and leaks nothing — but it is not
// the role gate, and asserting on the role gate here would be claiming coverage
// this test does not have.
//
// The approval gate below IS fully exercised, and it is the one that matters
// most: approval is where a device actually moves.
func TestAPlainMemberCannotRequestOrApprove(t *testing.T) {
	e := stepUpServer(t)
	e.arm(t, "start", 0)

	// The operator's request goes FIRST, while the hub still has one user.
	// Adding a second narrows the engine scope so unclaimed devices stop being
	// visible over chat — existing behaviour, unrelated to T4 — and after the
	// invite below the admin could not raise an intent to be approved.
	e.ask(t, "start the mower", devices.VerbStart)
	if len(e.pending(t)) != 1 {
		t.Fatalf("the operator's request did not produce an intent")
	}

	memberID, memberAccess := inviteMember(t, e.h, e.st, e.admin, e.account, "t4plain@x.com", "+27821110077")

	fleet := e.srv.registry().Devices()
	if len(fleet) == 0 {
		t.Fatal("no fleet to test against")
	}
	res, handled := e.srv.chatRequestT4(t.Context(), "start the mower", memberID,
		"telegram", "chat-9", "", devices.VerbStart, fleet)
	if !handled {
		t.Fatal("a T4 request from a plain member was not handled at all")
	}
	if res.Actuated {
		t.Fatal("a plain member actuated a T4 verb")
	}
	// Whatever the reason, the refusal must not disclose what an operator has
	// armed. This holds for the account refusal and for the role refusal alike.
	if strings.Contains(res.Reply, "armed") {
		t.Errorf("the refusal tells a non-operator what is armed: %q", res.Reply)
	}
	// The member's request added nothing: the one intent is still the
	// operator's.
	if list := e.pending(t); len(list) != 1 {
		t.Errorf("a plain member's request was recorded: %d intents now", len(list))
	}

	// And a plain member cannot approve the one an operator asked for. This is
	// the gate that stands in front of actuation.
	id := e.pending(t)[0]["id"].(string)
	rec, _ := doJSON(t, e.h, "POST",
		"/v1/accounts/"+e.account+"/stepup-intents/"+id+"/decide",
		memberAccess, map[string]any{"approve": true})
	if rec.Code != http.StatusForbidden {
		t.Errorf("a plain member approved a T4 intent: %d", rec.Code)
	}
	if n := e.started(devices.VerbStart); n != 0 {
		t.Errorf("the mower started for a plain member's approval")
	}
	// Nor read the list of what has been asked for.
	rec, _ = doJSON(t, e.h, "GET", "/v1/accounts/"+e.account+"/stepup-intents", memberAccess, nil)
	if rec.Code != http.StatusForbidden {
		t.Errorf("a plain member read the step-up intent list: %d", rec.Code)
	}
}

// The audit must distinguish asking from doing, and must attribute the
// actuation to the rail that carried it.
func TestTheAuditSeparatesTheRequestFromTheActuation(t *testing.T) {
	e := stepUpServer(t)
	e.arm(t, "start", 0)
	e.ask(t, "start the mower", devices.VerbStart)
	id := e.pending(t)[0]["id"].(string)
	doJSON(t, e.h, "POST", "/v1/accounts/"+e.account+"/stepup-intents/"+id+"/decide",
		e.admin, map[string]any{"approve": true})

	logs, err := e.st.AccessLogsByAccount(t.Context(), e.account, 50)
	if err != nil {
		t.Fatal(err)
	}
	var requested, actuated bool
	for _, l := range logs {
		switch l.Command {
		case "t4-request:start":
			requested = true
			if l.Source != "telegram" {
				t.Errorf("the request is attributed to %q, not the rail that asked", l.Source)
			}
		case "start":
			actuated = true
			// The command travelled the CONSOLE rail. Recording `telegram` here
			// would say a text message drove a mower, which is exactly what
			// this design prevents.
			if l.Source != "console" {
				t.Errorf("the actuation is attributed to %q, want console", l.Source)
			}
		}
	}
	if !requested {
		t.Error("the chat request was not audited")
	}
	if !actuated {
		t.Error("the actuation was not audited")
	}
}
