package grants_test

import (
	"encoding/json"
	"testing"

	"github.com/vul-os/aql/controller/internal/grants"
	"github.com/vul-os/aql/controller/internal/vectorfile"
	"github.com/vul-os/aql/controller/internal/wire"
)

// Step 3a, the cached deny-list — docs/GRANT-REVOCATION.md.
//
// These replay the SHIPPED conformance transcripts rather than hand-building a
// grant, so what is exercised is the real verification core against real signed
// bytes; only Env changes between cases.

// replay runs one named vector's transcript through a fresh Exchange with the
// given Env mutation, and returns the verdict and reason.
func replay(t *testing.T, name string, mutate func(*grants.Env)) (string, string) {
	t.Helper()
	dir, pub := gatewayPub(t)
	f, err := vectorfile.Load(dir, "grants.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range f.Vectors {
		if v.Name != name {
			continue
		}
		x := grants.NewExchange()
		env := envFrom(v.Check, pub)
		if mutate != nil {
			mutate(&env)
		}
		var open grants.Open
		if err := json.Unmarshal(v.Transcript.Open.Object, &open); err != nil {
			t.Fatal(err)
		}
		var ch grants.Challenge
		if err := json.Unmarshal(v.Transcript.Challenge, &ch); err != nil {
			t.Fatal(err)
		}
		x.InjectChallenge(&open, ch)
		res, _, _ := x.HandleProof(v.Transcript.Proof.Object, env)
		return res.Result, res.Detail
	}
	t.Fatalf("vector %q not found", name)
	return "", ""
}

// grantIDOf reads the grant id out of a vector's presented grant, so a test
// revoking "the grant in this transcript" cannot drift from what it presents.
func grantIDOf(t *testing.T, name string) string {
	t.Helper()
	dir, _ := gatewayPub(t)
	f, err := vectorfile.Load(dir, "grants.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range f.Vectors {
		if v.Name != name {
			continue
		}
		var open struct {
			Grant json.RawMessage `json:"grant"`
		}
		if err := json.Unmarshal(v.Transcript.Open.Object, &open); err != nil {
			t.Fatal(err)
		}
		var g struct {
			GrantID string `json:"grant_id"`
		}
		if err := json.Unmarshal(open.Grant, &g); err != nil {
			t.Fatal(err)
		}
		if g.GrantID == "" {
			t.Fatalf("vector %q presents a grant with no id", name)
		}
		return g.GrantID
	}
	t.Fatalf("vector %q not found", name)
	return ""
}

// §3.3: "A controller holding no list behaves exactly as it does today."
// A nil lookup is the shipped-before-this-existed case and must still accept.
func TestNoDenyListLeavesTheHappyPathUntouched(t *testing.T) {
	got, detail := replay(t, "grant-redeem-valid", func(e *grants.Env) { e.Revoked = nil })
	if got != "opened" {
		t.Fatalf("a valid grant was denied with no deny-list: %s/%s", got, detail)
	}
}

// A list that does not name this grant must also change nothing. The list
// authorises nothing and denies nothing beyond what it names.
func TestADenyListThatDoesNotNameTheGrantAcceptsIt(t *testing.T) {
	got, detail := replay(t, "grant-redeem-valid", func(e *grants.Env) {
		e.Revoked = func(id string) bool { return id == "some-other-grant" }
	})
	if got != "opened" {
		t.Fatalf("a grant absent from the list was denied: %s/%s", got, detail)
	}
}

func TestARevokedGrantIsDenied(t *testing.T) {
	id := grantIDOf(t, "grant-redeem-valid")
	var asked []string
	got, detail := replay(t, "grant-redeem-valid", func(e *grants.Env) {
		e.Revoked = func(q string) bool { asked = append(asked, q); return q == id }
	})
	if got != "denied" || detail != wire.ReasonRevoked {
		t.Fatalf("verdict = %s/%s, want denied/%s", got, detail, wire.ReasonRevoked)
	}
	// The lookup must be asked about the GRANT's id. A step that consulted the
	// proof's id instead would be asking the attacker what to look up.
	if len(asked) == 0 || asked[0] != id {
		t.Errorf("deny-list was asked about %v, want the grant's own id %q", asked, id)
	}
}

// ORDER, after the signature (step 3). This is the security-relevant half of
// §3.6: if 3a ran first, anyone could present arbitrary unsigned bytes carrying
// a victim's grant id and learn from the reason string whether it is revoked —
// and worse, a forged grant would be reported as "revoked" rather than as the
// forgery it is.
func TestAForgedGrantIsRejectedAsForgedNotAsRevoked(t *testing.T) {
	got, detail := replay(t, "grant-badsig", func(e *grants.Env) {
		// A deny-list that says yes to everything. If 3a ran before the
		// signature check, this would win.
		e.Revoked = func(string) bool { return true }
	})
	if got != "denied" {
		t.Fatalf("a forged grant was accepted: %s/%s", got, detail)
	}
	if detail != wire.ReasonBadSig {
		t.Errorf("reason = %q, want %q — the deny-list must not be consulted for bytes "+
			"that were never authenticated", detail, wire.ReasonBadSig)
	}
}

// ORDER, before the validity window (step 4). Not security-critical, but it is
// what the contract now says, and a reason string that says "expired" for a
// grant an operator explicitly revoked reads as the revocation not having
// worked.
func TestARevokedAndExpiredGrantReadsAsRevoked(t *testing.T) {
	got, detail := replay(t, "grant-expired", func(e *grants.Env) {
		e.Revoked = func(string) bool { return true }
	})
	if got != "denied" {
		t.Fatalf("verdict = %s", got)
	}
	if detail != wire.ReasonRevoked {
		t.Errorf("reason = %q, want %q", detail, wire.ReasonRevoked)
	}
}

// Lockdown (step 2) still outranks it. Both deny, so this is about the reason
// an operator reads: a controller in lockdown says so, because lifting is what
// they need to know about.
func TestLockdownStillOutranksTheDenyList(t *testing.T) {
	got, detail := replay(t, "grant-lockdown", func(e *grants.Env) {
		e.Revoked = func(string) bool { return true }
	})
	if got != "denied" || detail != wire.ReasonLockdown {
		t.Errorf("verdict = %s/%s, want denied/%s", got, detail, wire.ReasonLockdown)
	}
}

// The deny-list must be consulted about the id in the SIGNED grant, never the
// one in the proof.
//
// The proof is signed by the app key, which is exactly the key a revoked
// holder still has. If 3a looked up `proof.grant_id`, the holder of a revoked
// grant could name a different id in their own proof and walk past the
// deny-list — step 8 would still catch the mismatch today, so this is not
// currently exploitable, but the soundness of 3a rests on it consulting
// authenticated bytes and nothing else. A later reordering that moved step 8
// would turn this into a bypass silently.
//
// `grant-proof-wrong-grant` is the transcript where the two ids differ, which
// is the only place the distinction is observable.
func TestTheDenyListIsAskedAboutTheSignedGrantNotTheProof(t *testing.T) {
	id := grantIDOf(t, "grant-proof-wrong-grant")
	var asked []string
	got, detail := replay(t, "grant-proof-wrong-grant", func(e *grants.Env) {
		e.Revoked = func(q string) bool { asked = append(asked, q); return q == id }
	})
	if len(asked) == 0 {
		t.Fatal("the deny-list was never consulted")
	}
	if asked[0] != id {
		t.Errorf("deny-list asked about %q, want the signed grant's id %q", asked[0], id)
	}
	if got != "denied" || detail != wire.ReasonRevoked {
		t.Errorf("verdict = %s/%s, want denied/%s — the revocation should decide before "+
			"the proof's own mismatch does", got, detail, wire.ReasonRevoked)
	}
}
