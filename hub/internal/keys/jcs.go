// JCS canonicalization for the hub — the SIGNING side of every envelope,
// grant and audit-chain hash this gateway produces.
//
// The algorithm is not here. It is in github.com/vul-os/aql/jcs, a
// dependency-free module the gateway, the controller and the e2e harness all
// import. This file used to hold its own ~170-line copy, and the controller
// and the harness held two more; the argument for that was independence, and
// what independence produced in practice was a harness copy that never
// received the json.Number rounding fix. See the shared package's doc comment.
//
// Canonicalize stays part of package keys' surface because envelope.go,
// grant.go, hub.go and store/audithash.go call it by that name — four callers,
// checked rather than assumed.
//
// CanonicalizeJSON has NO production caller. This sentence used to name both
// functions and claim those four call "them", which was true of one and false
// of the other. It is reached only from keys_test.go and
// httpapi/offline_grants_test.go, which canonicalize a raw document rather than
// a Go value: the hub signs structs, so nothing in the signing path needs the
// document form.
//
// It stays because the tests that use it are checking THIS package's contract
// with the shared module, and rewriting them to call jcs.CanonicalizeJSON
// directly would test the module while claiming to test the delegation. That is
// a reason, not an oversight — which is the distinction the reachability guards
// in store/ and controller/ exist to force, and this symbol sits outside both
// of their scopes.
//
// The property fuzzing that used to live here (FuzzHubCanonicalizeJSON) moved
// to the shared module along with the code it was fuzzing; its seed corpus went
// with it. Fuzzing a three-line delegation twice would have looked like two
// checks and been one. vectors_test.go stays: it is the hub-side proof that the
// bytes this gateway SIGNS reproduce every `canonical` field in
// ../../../proto/vectors/.
package keys

import shared "github.com/vul-os/aql/jcs"

// Canonicalize renders v as RFC 8785 (JCS) canonical JSON, for the subset of
// values command envelopes use. See github.com/vul-os/aql/jcs for the subset
// and for the documented ±2^53 integer deviation.
func Canonicalize(v any) ([]byte, error) { return shared.Canonicalize(v) }

// CanonicalizeJSON canonicalizes a raw JSON document (parse, then re-render
// canonically).
func CanonicalizeJSON(raw []byte) ([]byte, error) { return shared.CanonicalizeJSON(raw) }
