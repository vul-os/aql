package httpapi

import (
	"bytes"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
	"log/slog"
	"net/http"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Rate-limiting on the engine's actuation path.
//
// ROADMAP carried this as "rate-limiting and scoping on movement commands, so a
// compromised client cannot drive a machine into a person". The scoping half
// existed; there was no rate limit at all. Authentication and the tier ceiling
// both answer "may this caller do this", and neither answers "may they do it
// two hundred times a second" — so a stolen token could loop `start` on a mower
// and nothing on this path would slow it.

// The verb the whole thing is about. TierHazardousMotion needs the long
// cooldown, and a second attempt inside it is refused rather than queued.
func TestAHazardousVerbCannotBeRepeatedImmediately(t *testing.T) {
	h := engineServer(t, "")
	access, _ := register(t, h, "cooldown-owner")
	key := "mock:mower-1"

	body := map[string]any{"verb": "start", "confirm": true}
	if rec, out := doJSON(t, h, "POST", "/v1/engine/devices/"+key+"/execute", access, body); rec.Code != http.StatusOK {
		t.Fatalf("first start: %d %v", rec.Code, out)
	}
	rec, out := doJSON(t, h, "POST", "/v1/engine/devices/"+key+"/execute", access, body)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second start inside the cooldown: %d %v, want 429", rec.Code, out)
	}
	if out["error"] != "too_soon" {
		t.Errorf("error = %v, want too_soon", out["error"])
	}
	if ra := rec.Header().Get("Retry-After"); ra == "" || ra == "0" {
		t.Errorf("Retry-After = %q — a client cannot tell how long to wait", ra)
	}
}

// The control, and the reason the cooldown is tier-scaled rather than flat: a
// dimmer slider legitimately sends a stream of `set`, and a lamp cannot injure
// anyone. Throttling it would break ordinary use to defend against nothing.
func TestReversibleVerbsAreNotThrottled(t *testing.T) {
	h := engineServer(t, "")
	access, _ := register(t, h, "cooldown-lamp")
	key := "mock:lamp-1"

	for i := 0; i < 5; i++ {
		verb := "on"
		if i%2 == 1 {
			verb = "off"
		}
		rec, out := doJSON(t, h, "POST", "/v1/engine/devices/"+key+"/execute", access,
			map[string]any{"verb": verb})
		if rec.Code != http.StatusOK {
			t.Fatalf("lamp %s #%d: %d %v — a reversible verb was throttled", verb, i, rec.Code, out)
		}
	}
}

// Per (caller, device, VERB). Each part matters and each fails differently if
// dropped: a shared key would let one machine's cooldown silence another, and
// dropping the verb would stop somebody halting a machine they had just told to
// run — the inverse must never be harder to reach than the thing it undoes.
func TestTheCooldownIsPerDeviceAndPerVerb(t *testing.T) {
	h := engineServer(t, "")
	access, _ := register(t, h, "cooldown-scope")

	if rec, _ := doJSON(t, h, "POST", "/v1/engine/devices/mock:vac-1/execute", access,
		map[string]any{"verb": "start", "confirm": true}); rec.Code != http.StatusOK {
		t.Fatalf("bot start")
	}
	// A different device is unaffected.
	if rec, out := doJSON(t, h, "POST", "/v1/engine/devices/mock:mower-1/execute", access,
		map[string]any{"verb": "start", "confirm": true}); rec.Code != http.StatusOK {
		t.Errorf("one device's cooldown blocked another: %d %v", rec.Code, out)
	}
	// STOPPING the bot is not blocked by having started it — the catalogue's
	// "stopping is never riskier than starting" rule.
	//
	// This holds because `stop` is TierReversible and reversible verbs are
	// never cooled at all, NOT because of how the key is composed. Worth
	// separating: tampering the verb out of the key left this assertion green,
	// since the cooldown is never consulted for a verb whose tier maps to zero.
	if rec, out := doJSON(t, h, "POST", "/v1/engine/devices/mock:vac-1/execute", access,
		map[string]any{"verb": "stop"}); rec.Code != http.StatusOK {
		t.Errorf("stop was blocked by start's cooldown: %d %v — the inverse must stay reachable",
			rec.Code, out)
	}

	// The verb component of the key, tested by two verbs that ARE both cooled.
	// `start` and `resume` are each TierConsequential on robot.job, so only the
	// key can separate them — with the verb dropped, the second is refused.
	if rec, out := doJSON(t, h, "POST", "/v1/engine/devices/mock:vac-1/execute", access,
		map[string]any{"verb": "resume", "confirm": true}); rec.Code != http.StatusOK {
		t.Errorf("resume was blocked by start's cooldown: %d %v — the cooldown is keyed per "+
			"device and not per verb, so one consequential command silences every other",
			rec.Code, out)
	}
}

// One caller's cooldown is not another's. Two members of a household are two
// people, and one having just started something must not stop the other
// stopping it.
func TestTheCooldownIsPerCaller(t *testing.T) {
	// Two members of ONE account. Two separate registrations would make this a
	// multi-account hub, where neither caller owns the mock fleet and the
	// tenancy gate refuses both — a 403 that would look like the cooldown
	// working and prove nothing about it.
	h, st := engineServerWithStore(t)
	a, _ := register(t, h, "cooldown-a")
	acct, _ := tenantIDs(t, h, a)
	_, b := inviteMember(t, h, st, a, acct, "cooldown-b", "+27821119999")

	// Inviting registers the second member, which creates their own account —
	// so this hub now has two, and an UNCLAIMED device is denied to everyone.
	// That is the tenancy gate working, and it would have produced a 403 that
	// looked exactly like the cooldown refusing. Claiming the device is what a
	// multi-account hub actually requires.
	owner := userIDFor(t, st, "cooldown-a")
	if err := st.ClaimDevice(t.Context(), "mock:vac-1", acct, owner, "bot"); err != nil {
		t.Fatal(err)
	}

	body := map[string]any{"verb": "start", "confirm": true}
	if rec, _ := doJSON(t, h, "POST", "/v1/engine/devices/mock:vac-1/execute", a, body); rec.Code != http.StatusOK {
		t.Fatal("first caller start")
	}
	if rec, out := doJSON(t, h, "POST", "/v1/engine/devices/mock:vac-1/execute", b, body); rec.Code != http.StatusOK {
		t.Errorf("one member's cooldown blocked another: %d %v", rec.Code, out)
	}
}

// The tier bands, stated directly so the mapping cannot drift silently.
func TestTheCooldownScalesWithTier(t *testing.T) {
	if got := engineCooldownFor(devices.TierRead); got != 0 {
		t.Errorf("read tier cooldown = %d, want none", got)
	}
	if got := engineCooldownFor(devices.TierReversible); got != 0 {
		t.Errorf("reversible cooldown = %d, want none", got)
	}
	if got := engineCooldownFor(devices.TierConsequential); got != engineConsequentialCooldownS {
		t.Errorf("consequential cooldown = %d", got)
	}
	if got := engineCooldownFor(devices.TierHazardousMotion); got != engineHazardousCooldownS {
		t.Errorf("hazardous cooldown = %d", got)
	}
	// Hazardous must never be gentler than consequential, whatever the numbers
	// become.
	if engineHazardousCooldownS < engineConsequentialCooldownS {
		t.Error("the hazardous cooldown is shorter than the consequential one")
	}
}

// engineServerWithStore is engineServer with the store handed back, so a test
// can add a second member to the same account.
func engineServerWithStore(t *testing.T) (http.Handler, *store.Store) {
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
	s := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router(), st
}
