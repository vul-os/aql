package e2e

import (
	"net/http"
	"testing"
	"time"
)

// Revoking a grant stops it opening a REAL controller.
//
// Every piece of this is unit-tested in isolation: the store's deny-list query,
// the seq rule, the command handler, the verification step. What none of those
// can reach is the WIRING — the hub signing a `revoke` and dispatching it over
// a socket, a real controller verifying that envelope and applying it, and a
// later redemption being refused because of it.
//
// That seam is where this feature's one shipped bug lived. `denyListPayload`
// returned `[]map[string]any`, which the canonicaliser rejects, so signing
// failed, the loop logged and continued, and the operator got a cheerful 200
// with nothing sent. Unit tests all passed; only asserting the dispatch found
// it. This asserts the consequence instead, which is the thing an operator
// actually cares about.
func TestRevoke_StopsAGrantOpeningARealController(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "sim-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)

	s := startSim(t, gw, dev, claim)
	gw.waitDeviceConnected(t, ten, dev, 10*time.Second)

	appPriv, appPub := newAppKey(t)
	g := gw.issueOfflineGrant(t, ten, appPub, []string{ap})
	gid := grantIDOf(t, g)

	// It opens the gate before the revocation. Without this the test could
	// pass on a grant that never worked — proving the gate is shut, not that
	// revoking shut it.
	cn := grantOpen(t, s.controller, g, ap)
	if res, det := grantProof(t, s.controller, appPriv, gid, cn, ap, time.Now().Unix()); res != "opened" {
		t.Fatalf("before revocation: result=%q detail=%q, want opened", res, det)
	}

	// Revoke through the real route, which composes the deny-list, signs a
	// `revoke` command and dispatches it.
	st, body, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/offline-grants/"+gid+"/revoke", ten.token, map[string]any{})
	if st != http.StatusOK {
		t.Fatalf("revoke: %d %s", st, raw)
	}
	dispatched, _ := body["dispatched"].([]any)
	if len(dispatched) != 1 || dispatched[0] != dev {
		t.Fatalf("dispatched = %v, want [%s]", body["dispatched"], dev)
	}
	// `failed` distinguishes "the hub could not build the command" from "no
	// controller was reachable", and it is the field that would have named the
	// canonicaliser bug at the time.
	if failed, _ := body["failed"].([]any); len(failed) != 0 {
		t.Fatalf("hub could not build a revocation for %v", failed)
	}

	// The controller must now refuse it. A fresh exchange, because a cnonce is
	// single-use and reusing one would report cnonce_replay whatever the
	// deny-list says — a false green that looks exactly like success.
	deadline := time.Now().Add(10 * time.Second)
	var res, det string
	for time.Now().Before(deadline) {
		cn = grantOpen(t, s.controller, g, ap)
		res, det = grantProof(t, s.controller, appPriv, gid, cn, ap, time.Now().Unix())
		if res == "denied" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if res != "denied" || det != "revoked" {
		t.Fatalf("after revocation: result=%q detail=%q, want denied/revoked — the grant "+
			"still opens the gate, so the revocation reached nothing", res, det)
	}

	// And the relay never moved for the refused attempt.
	if got := s.logs.countLines("relay", "state=pulsing"); got != 1 {
		t.Fatalf("relay pulsed %d times, want exactly 1 (the pre-revocation open)", got)
	}
}

// A revocation lands while lockdown is latched.
//
// docs/GRANT-REVOCATION.md §3.8, over real binaries. The sequence an operator
// performs is: someone is fired, latch lockdown because it is the only instant
// lever, then narrow it to that one person so everybody else can get back in.
// If `revoke` were refused under lockdown, the only route to a targeted
// revocation would be to LIFT first — opening every gate to everyone, including
// the person just fired.
func TestRevoke_LandsWhileLockedDown(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "sim-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)

	s := startSim(t, gw, dev, claim)
	gw.waitDeviceConnected(t, ten, dev, 10*time.Second)

	appPriv, appPub := newAppKey(t)
	g := gw.issueOfflineGrant(t, ten, appPub, []string{ap})
	gid := grantIDOf(t, g)

	s.send(t, "lockdown")
	s.send(t, "status")
	if !s.logs.waitLines(1, 5*time.Second, "lockdown=true") {
		t.Fatalf("sim did not latch lockdown; log:\n%s", s.logs.String())
	}

	st, _, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/offline-grants/"+gid+"/revoke", ten.token, map[string]any{})
	if st != http.StatusOK {
		t.Fatalf("revoke under lockdown: %d %s", st, raw)
	}

	// Lift, and the grant must STILL be refused — the revocation landed during
	// the freeze rather than being swallowed by it. Without this the test would
	// pass on lockdown's own refusal, which proves nothing about the deny-list.
	s.send(t, "lift")
	s.send(t, "status")
	if !s.logs.waitLines(1, 5*time.Second, "lockdown=false") {
		t.Fatalf("sim did not lift; log:\n%s", s.logs.String())
	}

	deadline := time.Now().Add(10 * time.Second)
	var res, det string
	for time.Now().Before(deadline) {
		cn := grantOpen(t, s.controller, g, ap)
		res, det = grantProof(t, s.controller, appPriv, gid, cn, ap, time.Now().Unix())
		if det == "revoked" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if res != "denied" || det != "revoked" {
		t.Fatalf("after lifting: result=%q detail=%q, want denied/revoked — the revocation "+
			"was lost to the freeze it was meant to replace", res, det)
	}
}

// A real controller REPORTS which deny-list it is enforcing, and the hub serves
// it.
//
// docs/GRANT-REVOCATION.md §5. "Dispatched" and "applied" differ exactly when
// it matters — a command queued for a gate that never reconnects looks
// identical to one delivered — so the hub asking the gate is the only honest
// answer to "did my revocation land".
//
// Unit tests cover each half: the controller building the report block, the hub
// ingesting it, the hub comparing it against its own counter. None of them puts
// a ctl.report on a socket. This does.
func TestRevoke_ControllerReportsWhatItIsEnforcing(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "sim-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)

	s := startSim(t, gw, dev, claim)
	_ = s
	gw.waitDeviceConnected(t, ten, dev, 10*time.Second)

	report := func() map[string]any {
		t.Helper()
		st, body, raw := httpJSON(t, http.MethodGet, gw.url+"/v1/devices/"+dev+"/config-report", ten.token, nil)
		if st != http.StatusOK {
			t.Fatalf("config-report: %d %s", st, raw)
		}
		rev, _ := body["revocation"].(map[string]any)
		if rev == nil {
			t.Fatalf("config-report carries no revocation block: %v", body)
		}
		return rev
	}

	// Before anything is revoked the hub's counter is 0, and a controller
	// reporting seq 0 is a CONFIRMATION that it holds no list — distinct from
	// having said nothing, which is what an older firmware would look like.
	deadline := time.Now().Add(15 * time.Second)
	var rev map[string]any
	for time.Now().Before(deadline) {
		rev = report()
		if rev["reported"] == true {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if rev["reported"] != true {
		t.Fatalf("the controller never reported its deny-list state: %v — nothing can "+
			"confirm a revocation reached it", rev)
	}
	if rev["seq"] != float64(0) {
		t.Errorf("seq before any revocation = %v, want 0", rev["seq"])
	}

	appPriv, appPub := newAppKey(t)
	_ = appPriv
	g := gw.issueOfflineGrant(t, ten, appPub, []string{ap})
	gid := grantIDOf(t, g)
	st, _, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/offline-grants/"+gid+"/revoke", ten.token, map[string]any{})
	if st != http.StatusOK {
		t.Fatalf("revoke: %d %s", st, raw)
	}

	// The controller sends a fresh report when its deny-list changes, so the
	// hub's view catches up without being asked.
	deadline = time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		rev = report()
		if seq, _ := rev["seq"].(float64); seq >= 1 {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if seq, _ := rev["seq"].(float64); seq < 1 {
		t.Fatalf("after revoking, the gate still reports seq %v — it has not applied the "+
			"deny-list, or it has and never said so", rev["seq"])
	}
	if rev["up_to_date"] != true {
		t.Errorf("up_to_date = %v with hub_seq %v and gate seq %v — the hub cannot tell an "+
			"operator the revocation landed", rev["up_to_date"], rev["hub_seq"], rev["seq"])
	}
	if entries, _ := rev["entries"].(float64); entries != 1 {
		t.Errorf("entries = %v, want 1", rev["entries"])
	}
}
