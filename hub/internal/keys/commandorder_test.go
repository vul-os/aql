package keys

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"
	"time"
)

// proto/commands.md §Verification is normative about ORDER, not just outcome:
// five numbered steps, "the first failure wins and is the reported reason".
//
// Nothing tested that. The conformance vectors present SINGLE faults, so they
// pin each step's reason and can say nothing about which one wins when two are
// wrong at once — exactly the gap the GRANT side closed with
// TestVerificationOrderOnMultipleFaults and the command side never did.
//
// It matters for the same reason it matters there, and the argument is worth
// restating rather than cross-referencing: the reason lands in the controller's
// event log and the hub's audit trail, and it is what an operator reads when a
// gate did not open. "expired" sends them to look at a clock. "badsig" sends
// them to look at a pairing. "lockdown" sends them to lift a freeze. A
// reordering swaps those diagnoses silently with every single-fault vector
// still green.
//
// This is also the SECOND implementation of that order — the controller has its
// own, and proto/vectors/verify.mjs a third — so a drift here is a drift
// between the hub's model of a controller and the controller itself.
func TestCommandVerificationOrderOnMultipleFaults(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 1)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	pub := priv.Public().(ed25519.PublicKey)

	const (
		device = "de71ce00-0000-4000-8000-000000000001"
		ap     = "main"
		now    = int64(1789000000)
	)

	// sign builds a valid envelope and then applies the faults.
	//
	// Note on the "expired" cases: they use a window INSIDE the 60-second TTL
	// bound (now-200 → now-150). An earlier draft used now-1000 → now-900,
	// which is 100 seconds wide, so `window_too_long` fired first and the test
	// failed — correctly. Step 3 has two checks in a fixed order and a fixture
	// that trips both cannot say anything about the step boundary it meant to.
	sign := func(t *testing.T, cmd string, mutate func(*Envelope), signKey ed25519.PrivateKey) *Envelope {
		t.Helper()
		e, err := signWith(priv, cmd, device, ap, nil, 30*time.Second, nil)
		if err != nil {
			t.Fatal(err)
		}
		e.IAT, e.EXP = now, now+30
		if mutate != nil {
			mutate(e)
		}
		// Re-sign AFTER mutating, so the only invalid signature is the one a
		// case asks for. A case that mutated a signed envelope without
		// re-signing would report badsig for every fault and pass this test
		// while proving nothing about order.
		e.Sig = ""
		raw, err := Canonicalize(e.signable())
		if err != nil {
			t.Fatal(err)
		}
		e.Sig = base64.RawURLEncoding.EncodeToString(ed25519.Sign(signKey, raw))
		return e
	}

	verify := func(t *testing.T, e *Envelope, ctx VerifyContext) string {
		t.Helper()
		err := VerifyCommand(pub, e, ctx)
		if err == nil {
			return ""
		}
		rej, ok := err.(*Reject)
		if !ok {
			t.Fatalf("non-Reject error: %v", err)
		}
		return rej.Reason
	}

	otherSeed := make([]byte, ed25519.SeedSize)
	for i := range otherSeed {
		otherSeed[i] = byte(200 - i)
	}
	attacker := ed25519.NewKeyFromSeed(otherSeed)

	cases := []struct {
		name string
		cmd  string
		env  func(*Envelope)
		ctx  func(*VerifyContext)
		key  ed25519.PrivateKey
		want string
		why  string
	}{
		{
			name: "bad signature and wrong device",
			cmd:  "open",
			env:  func(e *Envelope) { e.DeviceID = "someone-else" },
			key:  attacker,
			want: ReasonBadSig,
			why:  "step 1 before step 2 — unverified bytes say nothing about who a command is for",
		},
		{
			name: "bad signature and expired",
			cmd:  "open",
			env:  func(e *Envelope) { e.IAT, e.EXP = now-200, now-150 },
			key:  attacker,
			want: ReasonBadSig,
			why:  "step 1 before step 3",
		},
		{
			name: "wrong device and expired",
			cmd:  "open",
			env: func(e *Envelope) {
				e.DeviceID = "someone-else"
				e.IAT, e.EXP = now-200, now-150
			},
			want: ReasonWrongDevice,
			why:  "step 2 before step 3 — a command for another gate is not this gate's clock problem",
		},
		{
			name: "wrong access point and expired",
			cmd:  "open",
			env: func(e *Envelope) {
				e.AccessPoint = "not-served"
				e.IAT, e.EXP = now-200, now-150
			},
			want: ReasonWrongAccessPoint,
			why:  "step 2 before step 3",
		},
		{
			name: "window too long and expired",
			cmd:  "open",
			// 4100s wide AND long past. Both faults are inside step 3, and the
			// TTL bound is checked first.
			env:  func(e *Envelope) { e.IAT, e.EXP = now-5000, now-900 },
			want: ReasonWindowTooLong,
			why:  "within step 3, the TTL bound is checked before the clock bounds",
		},
		{
			name: "expired and replayed",
			cmd:  "open",
			env:  func(e *Envelope) { e.IAT, e.EXP = now-200, now-150 },
			ctx:  func(c *VerifyContext) { c.Seen = nil },
			want: ReasonExpired,
			why:  "step 3 before step 4 — an expired envelope is rejected before its nonce matters",
		},
		{
			name: "replayed and under lockdown",
			cmd:  "open",
			ctx: func(c *VerifyContext) {
				c.Seen = nil
				c.Lockdown = true
			},
			want: ReasonReplay,
			why:  "step 4 before step 5",
		},
		{
			name: "under lockdown, otherwise perfect",
			cmd:  "open",
			ctx:  func(c *VerifyContext) { c.Lockdown = true },
			want: ReasonLockdown,
			why:  "step 5 is reached only when everything before it passed",
		},
		{
			name: "revoke under lockdown is accepted",
			cmd:  "revoke",
			ctx:  func(c *VerifyContext) { c.Lockdown = true },
			want: "",
			why:  "the matrix lets a revocation land during a freeze (docs/GRANT-REVOCATION.md §3.8)",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			key := priv
			if tc.key != nil {
				key = tc.key
			}
			e := sign(t, tc.cmd, tc.env, key)
			ctx := VerifyContext{
				Now: now, DeviceID: device, AccessPoints: []string{ap},
				Seen: NonceSet{},
			}
			if tc.ctx != nil {
				tc.ctx(&ctx)
			}
			if got := verify(t, e, ctx); got != tc.want {
				t.Errorf("reported %q, want %q (%s)", got, tc.want, tc.why)
			}
		})
	}
}
