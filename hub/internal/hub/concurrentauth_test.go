package hub

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"sync"
	"testing"
	"time"
)

// One poll challenge authenticates once, even when eight auths arrive together.
//
// # The defect this pins
//
// ConsumePollChallenge read the challenge — including its `consumed` flag —
// under the lock, released it, ran the full signature and freshness
// verification with that stale flag, and only then marked it consumed. Two
// auths carrying the same cnonce could both see it unconsumed, both verify, and
// both be accepted. Measured before the fix: eight concurrent calls, eight
// accepted.
//
// What that costs is the replay protection on the long-poll path. A captured
// ws.auth message could open more than one authenticated session, which is the
// single thing the cnonce exists to prevent.
//
// The third time this exact shape appeared in one week — after the relay hold
// timer and the offline grant exchange — so the assertion is deliberately about
// the property (exactly one acceptance) rather than about the code path.
func TestOnePollChallengeAuthenticatesOnce(t *testing.T) {
	h := New()
	pub, priv, _ := ed25519.GenerateKey(nil)
	now := time.Now().Unix()
	ch, err := h.IssuePollChallenge("dev-1", now)
	if err != nil {
		t.Fatal(err)
	}

	// v0, signed over the JCS form minus sig — the shape VerifyAuth checks.
	a := Auth{V: 0, Typ: "ws.auth", DeviceID: "dev-1", Cnonce: ch.Cnonce, TS: now}
	unsigned, _ := json.Marshal(a)
	msg, err := jcsMinusSig(unsigned)
	if err != nil {
		t.Fatal(err)
	}
	a.Sig = base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, msg))
	raw, _ := json.Marshal(a)

	const n = 8
	var wg sync.WaitGroup
	out := make([]string, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			out[i] = h.ConsumePollChallenge(pub, raw, "dev-1", now)
		}(i)
	}
	close(start)
	wg.Wait()
	accepted := 0
	for _, r := range out {
		if r == "" {
			accepted++
		}
	}
	if accepted != 1 {
		t.Fatalf("%d of %d concurrent auths were accepted for one cnonce: %v — a "+
			"single-use challenge must authenticate exactly once", accepted, n, out)
	}
	// And the losers say REPLAY, which is the true reason and the one a
	// controller can act on.
	for i, r := range out {
		if r != "" && r != "cnonce_replay" {
			t.Errorf("auth %d refused with %q, want cnonce_replay", i, r)
		}
	}
}
