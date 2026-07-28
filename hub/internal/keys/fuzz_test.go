package keys_test

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
)

// The SIGNING side of JCS.
//
// controller/internal/jcs carries the same properties on the verifying side.
// This is the half that decides which bytes the hub actually signs, and the two
// must agree byte-for-byte or every command fails verification at a gate — or,
// far worse, a document that differs from the one a human approved verifies
// anyway.
//
// The two implementations are INDEPENDENT, in separate modules, which is
// deliberate: proto/vectors checks them against each other over 93 fixed
// documents, and an implementation that shared code with its counterpart would
// make that agreement vacuous. The cost of that independence is that no single
// test can import both, so each side is held to the same PROPERTIES separately
// and the vectors do the cross-checking.
//
// Properties, and why each one is a signature hazard rather than a tidiness
// concern:
//
//   - Idempotent: two parties both following the spec can otherwise sign
//     different bytes, because one canonicalised twice.
//   - Deterministic: Go randomises map iteration, so a missing sort passes
//     every single-run test and fails against a peer that ordered differently.
//   - Value-preserving: a signature over a document that says something else.
//   - Output re-parses: bytes no verifier can re-derive.

func FuzzHubCanonicalizeJSON(f *testing.F) {
	f.Add([]byte(`{"v":0,"typ":"cmd","cmd":"open","ts":1700000000}`))
	f.Add([]byte(`{"b":1,"a":2}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`[]`))
	f.Add([]byte(`"\u00e9"`))
	f.Add([]byte(`{"k":"\ud83d\ude00"}`))        // surrogate pair
	f.Add([]byte(`{"a":9007199254740992}`))      // 2^53, the documented edge
	f.Add([]byte(`{"a":1.5}`))                   // refused by the deviation note
	f.Add([]byte(`0e00`))                        // a spelling of zero
	f.Add([]byte(`{"dup":1,"dup":2}`))           // duplicate keys
	f.Add([]byte("{\"ctrl\":\"\u0001\u001f\"}")) // control characters
	f.Add([]byte(`{"":""}`))

	f.Fuzz(func(t *testing.T, raw []byte) {
		out, err := keys.CanonicalizeJSON(raw)
		if err != nil {
			return // refusing is always allowed
		}

		if !json.Valid(out) {
			t.Fatalf("output is not valid JSON: %q (from %q)", out, raw)
		}

		again, err := keys.CanonicalizeJSON(out)
		if err != nil {
			t.Fatalf("canonical output was refused on a second pass: %q (from %q): %v", out, raw, err)
		}
		if !bytes.Equal(again, out) {
			t.Fatalf("not idempotent:\n once: %q\ntwice: %q\n from: %q", out, again, raw)
		}

		for i := 0; i < 4; i++ {
			rerun, err := keys.CanonicalizeJSON(raw)
			if err != nil || !bytes.Equal(rerun, out) {
				t.Fatalf("not deterministic on run %d:\n first: %q\n  then: %q (err %v)",
					i, out, rerun, err)
			}
		}

		// Numeric comparison, not by spelling. The controller-side version of
		// this test first compared json.Number and flagged `0e00` → `0` as
		// corruption; that is correct canonicalisation of zero. float64 is
		// lossless here because Canonicalize refuses anything outside the
		// ±2^53 integral range.
		orig, oerr := decodeNumeric(raw)
		if oerr != nil {
			return
		}
		got, gerr := decodeNumeric(out)
		if gerr != nil {
			t.Fatalf("canonical output failed to re-decode: %q: %v", out, gerr)
		}
		if !reflect.DeepEqual(orig, got) {
			t.Fatalf("canonicalisation changed the value:\n  in: %#v\n out: %#v\nraw: %q",
				orig, got, raw)
		}
	})
}

func decodeNumeric(b []byte) (any, error) {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, err
	}
	return v, nil
}
