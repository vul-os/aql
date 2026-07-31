package grants_test

import (
	"crypto/ed25519"
	"encoding/json"
	"testing"
	"time"

	"github.com/vul-os/aql/controller/internal/grants"
	"github.com/vul-os/aql/controller/internal/vectorfile"
	"github.com/vul-os/aql/controller/internal/wire"
)

func gatewayPub(t *testing.T) (string, ed25519.PublicKey) {
	t.Helper()
	dir, err := vectorfile.FindDir("")
	if err != nil {
		t.Fatal(err)
	}
	keys, err := vectorfile.LoadKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := wire.DecodePub(keys.Keys["gateway"].PublicKeyB64u)
	if err != nil {
		t.Fatal(err)
	}
	return dir, pub
}

func envFrom(c vectorfile.Check, pub ed25519.PublicKey) grants.Env {
	env := grants.Env{
		Now:             c.Now,
		LastGatewaySync: c.LastGatewaySync,
		DeviceID:        c.DeviceID,
		Lockdown:        c.Lockdown,
		GatewayKey:      pub,
	}
	// Only when the vector carries a list. Leaving Revoked nil otherwise is
	// what makes "absence is never denial" the DEFAULT the corpus exercises:
	// every vector written before this field existed still runs against a
	// controller that has never received a deny-list.
	if len(c.Revoked) > 0 {
		revoked := make(map[string]int64, len(c.Revoked))
		for _, e := range c.Revoked {
			revoked[e.GrantID] = e.EXP
		}
		now := c.Now
		env.Revoked = func(id string) bool {
			exp, ok := revoked[id]
			return ok && (exp == 0 || exp >= now)
		}
	}
	return env
}

// TestGrantVectorsThroughExchange replays every grants.json transcript
// (grant + open + fixed challenge + proof) through the shared Exchange —
// the exact verification core the LAN listener and BLE session use —
// asserting the accept/deny verdict and the single-fault reason, including
// the 2-step cnonce-replay flow.
func TestGrantVectorsThroughExchange(t *testing.T) {
	dir, pub := gatewayPub(t)
	f, err := vectorfile.Load(dir, "grants.json")
	if err != nil {
		t.Fatal(err)
	}
	ran := 0
	for _, v := range f.Vectors {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			x := grants.NewExchange()
			env := envFrom(v.Check, pub)
			var open grants.Open
			if err := json.Unmarshal(v.Transcript.Open.Object, &open); err != nil {
				t.Fatal(err)
			}
			var ch grants.Challenge
			if err := json.Unmarshal(v.Transcript.Challenge, &ch); err != nil {
				t.Fatal(err)
			}
			x.InjectChallenge(&open, ch)

			assert := func(proofRaw json.RawMessage, expect, reason string) {
				t.Helper()
				res, g, p := x.HandleProof(proofRaw, env)
				if expect == "accept" {
					if res.Result != "opened" {
						t.Fatalf("expected opened, got %s(%s)", res.Result, res.Detail)
					}
					if g == nil || p == nil {
						t.Fatal("accept must return the verified grant + proof")
					}
				} else {
					if res.Result != "denied" || res.Detail != reason {
						t.Fatalf("expected denied(%s), got %s(%s)", reason, res.Result, res.Detail)
					}
					if g != nil {
						t.Fatal("deny must not return a grant")
					}
				}
			}
			if len(v.Steps) > 0 {
				for _, st := range v.Steps {
					assert(st.Proof.Object, st.Expect, st.Reason)
				}
			} else {
				assert(v.Transcript.Proof.Object, v.Expect, v.Reason)
			}
			ran++
		})
	}
	// Exact, not a floor: a vector silently dropped from the corpus is the
	// failure this counts against, and a floor would not see it.
	if ran != 18 {
		t.Errorf("expected 18 grant vectors, ran %d", ran)
	}
}

func TestWindows(t *testing.T) {
	// 1789030800 = Thursday 2026-09-10 09:00:00 UTC (vector base).
	thu0900 := int64(1789030800)
	sun1000 := int64(1789293600)
	cases := []struct {
		name string
		w    grants.Window
		now  int64
		tz   *time.Location
		want bool
	}{
		{"always", grants.Window{Days: "mon-sun", From: "00:00", To: "24:00"}, thu0900, nil, true},
		{"weekday-in", grants.Window{Days: "mon-fri", From: "08:00", To: "17:00"}, thu0900, nil, true},
		{"weekday-sunday-out", grants.Window{Days: "mon-fri", From: "08:00", To: "17:00"}, sun1000, nil, false},
		{"to-exclusive", grants.Window{Days: "mon-sun", From: "08:00", To: "09:00"}, thu0900, nil, false},
		{"from-inclusive", grants.Window{Days: "mon-sun", From: "09:00", To: "10:00"}, thu0900, nil, true},
		{"single-day", grants.Window{Days: "thu", From: "00:00", To: "24:00"}, thu0900, nil, true},
		{"single-day-miss", grants.Window{Days: "fri", From: "00:00", To: "24:00"}, thu0900, nil, false},
		{"malformed-days", grants.Window{Days: "xyz", From: "00:00", To: "24:00"}, thu0900, nil, false},
		{"malformed-time", grants.Window{Days: "mon-sun", From: "0800", To: "1700"}, thu0900, nil, false},
		{"no-wraparound", grants.Window{Days: "sat-mon", From: "00:00", To: "24:00"}, sun1000, nil, false},
	}
	for _, c := range cases {
		if got := grants.InAnyWindow([]grants.Window{c.w}, c.now, c.tz); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
	// Timezone shifts the local wall clock: Thursday 09:00 UTC is Thursday
	// 11:00 in UTC+2, so an 08:00-10:00 window misses there.
	tz := time.FixedZone("SAST", 2*3600)
	w := grants.Window{Days: "mon-sun", From: "08:00", To: "10:00"}
	if grants.InAnyWindow([]grants.Window{w}, thu0900, tz) {
		t.Error("expected 11:00 local to fall outside 08:00-10:00")
	}
	if !grants.InAnyWindow([]grants.Window{w}, thu0900, time.UTC) {
		t.Error("expected 09:00 UTC inside 08:00-10:00")
	}
}

// TestStaleClockBoundary: exactly 14 d since last sync is still allowed;
// one second more refuses redemption; a never-synced clock refuses.
func TestStaleClockBoundary(t *testing.T) {
	dir, pub := gatewayPub(t)
	f, err := vectorfile.Load(dir, "grants.json")
	if err != nil {
		t.Fatal(err)
	}
	var valid *vectorfile.Vector
	for i := range f.Vectors {
		if f.Vectors[i].Name == "grant-redeem-valid" {
			valid = &f.Vectors[i]
			break
		}
	}
	run := func(lastSync int64) string {
		x := grants.NewExchange()
		var open grants.Open
		_ = json.Unmarshal(valid.Transcript.Open.Object, &open)
		var ch grants.Challenge
		_ = json.Unmarshal(valid.Transcript.Challenge, &ch)
		x.InjectChallenge(&open, ch)
		env := envFrom(valid.Check, pub)
		env.LastGatewaySync = lastSync
		res, _, _ := x.HandleProof(valid.Transcript.Proof.Object, env)
		if res.Result == "opened" {
			return "opened"
		}
		return res.Detail
	}
	now := valid.Check.Now
	if got := run(now - wire.StaleClockLimitSeconds); got != "opened" {
		t.Errorf("exactly 14d: got %s", got)
	}
	if got := run(now - wire.StaleClockLimitSeconds - 1); got != wire.ReasonStaleClock {
		t.Errorf("14d+1s: got %s", got)
	}
	if got := run(0); got != wire.ReasonStaleClock {
		t.Errorf("never synced: got %s", got)
	}
}

// TestStaleClockBackwardReset proves the guard fires when the wall clock
// has been reset BACKWARD past the last known gateway sync (the
// RTC-less-reboot case in proto/events.md "Clock after a power cut"),
// rather than relying on the presented grant's own iat/exp window to
// coincidentally catch it. We pick a LastGatewaySync far in this
// redemption's OWN future relative to `now` — exactly the state after a
// bad backward wall-clock reset — while `now` still falls inside the
// presented grant's own validity window (it is literally the
// "grant-redeem-valid" vector, unmodified), so nothing except the
// stale-clock guard itself is positioned to catch this. Before the fix,
// "now - lastSynced > limit" with a very negative elapsed never fires, and
// this test observes "opened" — a real bypass. After the fix it must
// observe denied(stale_clock).
func TestStaleClockBackwardReset(t *testing.T) {
	dir, pub := gatewayPub(t)
	f, err := vectorfile.Load(dir, "grants.json")
	if err != nil {
		t.Fatal(err)
	}
	var valid *vectorfile.Vector
	for i := range f.Vectors {
		if f.Vectors[i].Name == "grant-redeem-valid" {
			valid = &f.Vectors[i]
			break
		}
	}
	if valid == nil {
		t.Fatal("grant-redeem-valid vector not found")
	}
	x := grants.NewExchange()
	var open grants.Open
	if err := json.Unmarshal(valid.Transcript.Open.Object, &open); err != nil {
		t.Fatal(err)
	}
	var ch grants.Challenge
	if err := json.Unmarshal(valid.Transcript.Challenge, &ch); err != nil {
		t.Fatal(err)
	}
	x.InjectChallenge(&open, ch)
	env := envFrom(valid.Check, pub)
	// Backward reset: lastSynced sits far in "now"'s future, with a
	// magnitude well beyond the 14 d limit — a "> limit" only check never
	// fires here (the raw signed delta is very negative, not "> limit").
	env.LastGatewaySync = valid.Check.Now + 2*wire.StaleClockLimitSeconds

	res, g, _ := x.HandleProof(valid.Transcript.Proof.Object, env)
	if res.Result != "denied" || res.Detail != wire.ReasonStaleClock {
		t.Fatalf("backward clock reset: expected denied(%s), got %s(%s)",
			wire.ReasonStaleClock, res.Result, res.Detail)
	}
	if g != nil {
		t.Fatal("deny must not return a grant")
	}
}

// TestVerificationOrderOnMultipleFaults.
//
// proto/grants.md §"Verification order" is normative about ORDER, not just
// outcome: eleven numbered steps, "fail-closed — first failure wins". The
// vectors deliberately present SINGLE faults, so they pin every step's reason
// and can say nothing at all about which one wins when two are wrong at once.
//
// Order is not cosmetic here. The reason lands in the controller's event log
// and the hub's audit trail, and it is what an operator reads when a gate did
// not open. "expired" sends them to look at a clock; "badsig" sends them to
// look at a pairing. A reordering swaps those diagnoses silently, with every
// single-fault vector still green.
//
// It also has to hold across implementations — proto/vectors/verify.mjs
// evaluates the same order — so a drift here is a drift between the controller
// and the independent checker.
//
// Each case below breaks TWO rules and asserts the EARLIER step is reported.
func TestVerificationOrderOnMultipleFaults(t *testing.T) {
	dir, pub := gatewayPub(t)
	f, err := vectorfile.Load(dir, "grants.json")
	if err != nil {
		t.Fatal(err)
	}
	var valid *vectorfile.Vector
	for i := range f.Vectors {
		if f.Vectors[i].Name == "grant-redeem-valid" {
			valid = &f.Vectors[i]
			break
		}
	}
	if valid == nil {
		t.Fatal("grant-redeem-valid vector not found; this test has nothing to perturb")
	}

	// run replays the valid transcript with env perturbed by tweak.
	run := func(t *testing.T, tweak func(*grants.Env)) string {
		t.Helper()
		x := grants.NewExchange()
		var open grants.Open
		if err := json.Unmarshal(valid.Transcript.Open.Object, &open); err != nil {
			t.Fatal(err)
		}
		var ch grants.Challenge
		if err := json.Unmarshal(valid.Transcript.Challenge, &ch); err != nil {
			t.Fatal(err)
		}
		x.InjectChallenge(&open, ch)
		env := envFrom(valid.Check, pub)
		tweak(&env)
		res, _, _ := x.HandleProof(valid.Transcript.Proof.Object, env)
		if res.Result == "opened" {
			return "opened"
		}
		return res.Detail
	}

	// Sanity: unperturbed, this transcript opens. Without it, every assertion
	// below could be satisfied by a transcript that was already broken.
	if got := run(t, func(*grants.Env) {}); got != "opened" {
		t.Fatalf("the baseline transcript does not open (%s); the perturbations below "+
			"would prove nothing", got)
	}

	staleSync := valid.Check.Now - wire.StaleClockLimitSeconds - 1

	for _, tc := range []struct {
		name  string
		tweak func(*grants.Env)
		want  string
		why   string
	}{
		{
			name:  "stale clock and lockdown together report stale_clock",
			tweak: func(e *grants.Env) { e.LastGatewaySync = staleSync; e.Lockdown = true },
			want:  wire.ReasonStaleClock,
			why:   "step 1 precedes step 2",
		},
		{
			name:  "stale clock and a wrong hub key report stale_clock",
			tweak: func(e *grants.Env) { e.LastGatewaySync = staleSync; e.GatewayKey = otherKey(t) },
			want:  wire.ReasonStaleClock,
			why:   "step 1 precedes step 3; a controller that cannot trust its clock says so first",
		},
		{
			name:  "lockdown and a wrong hub key report lockdown",
			tweak: func(e *grants.Env) { e.Lockdown = true; e.GatewayKey = otherKey(t) },
			want:  wire.ReasonLockdown,
			why:   "step 2 precedes step 3",
		},
		{
			name: "lockdown and a device this grant does not name report lockdown",
			tweak: func(e *grants.Env) {
				e.Lockdown = true
				e.DeviceID = "de71ce00-0000-4000-8000-00000000ffff"
			},
			want: wire.ReasonLockdown,
			why:  "step 2 precedes step 5",
		},
		{
			name: "a wrong hub key and a device this grant does not name report badsig",
			tweak: func(e *grants.Env) {
				e.GatewayKey = otherKey(t)
				e.DeviceID = "de71ce00-0000-4000-8000-00000000ffff"
			},
			want: wire.ReasonBadSig,
			why:  "step 3 precedes step 5 — an unverified grant's contents are not evidence of anything",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := run(t, tc.tweak); got != tc.want {
				t.Errorf("reported %q, want %q (%s)", got, tc.want, tc.why)
			}
		})
	}
}

// otherKey is a valid Ed25519 public key that is not the pinned one.
func otherKey(t *testing.T) ed25519.PublicKey {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	return pub
}
