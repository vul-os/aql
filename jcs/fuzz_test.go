package jcs_test

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/vul-os/aql/jcs"
)

// JCS canonicalisation, fuzzed for the properties that make a SIGNATURE mean
// something.
//
// This is the highest-stakes parser in the product and the least dramatic.
// Nothing here crashes a gate. What it does is decide which exact bytes a
// signature covers, on both sides of the wire — the hub signs over this
// canonical form, the controller verifies over it, and the app produces its
// own in TypeScript — so a canonicalisation that is merely INCONSISTENT is a
// signature that verifies when it should not, or fails when it should not.
//
// "Does not panic" is far too weak a property for that. The failures worth
// fearing are silent and well-formed:
//
//   - Not idempotent. If canonicalising an already-canonical document changes
//     it, then two parties agreeing on JCS can still sign different bytes,
//     because one of them canonicalised twice.
//   - Not value-preserving. Output that parses back to a DIFFERENT value means
//     the signature covers a document nobody sent.
//   - Not deterministic. Two runs over the same input must be byte-identical,
//     or the same document signs differently depending on map iteration order.
//
// proto/vectors checks 93 fixed documents byte-for-byte against the two
// JavaScript implementations, which is a stronger statement about those
// documents than anything here. This covers the arbitrary ones.
//
// It lives beside the implementation rather than in one of the three consuming
// modules. It used to live in controller/internal/jcs, which meant the hub's
// copy and the e2e harness's copy were fuzzed by a separate, smaller target or
// (for e2e) not at all.

func FuzzCanonicalizeJSONProperties(f *testing.F) {
	f.Add([]byte(`{"b":1,"a":2}`))
	f.Add([]byte(`{"v":0,"typ":"cmd","ts":1700000000}`))
	f.Add([]byte(`[]`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`"\u00e9"`))
	f.Add([]byte(`{"nested":{"z":[1,2,{"y":null}]}}`))
	f.Add([]byte(`{"k":"\ud83d\ude00"}`))        // surrogate pair
	f.Add([]byte(`{"a":9007199254740992}`))      // 2^53, the documented edge
	f.Add([]byte(`{"a":1.5}`))                   // refused by the deviation note
	f.Add([]byte(`{"dup":1,"dup":2}`))           // duplicate keys
	f.Add([]byte("{\"ctrl\":\"\u0001\u001f\"}")) // control characters
	f.Add([]byte(`{"":"empty key"}`))
	// Seeds inherited from the hub's own fuzz target (FuzzHubCanonicalizeJSON),
	// which fuzzed a hand-copy of this file until the copies were folded. They
	// are carried across so that folding the code did not quietly fold away
	// corpus.
	f.Add([]byte(`{"v":0,"typ":"cmd","cmd":"open","ts":1700000000}`))
	f.Add([]byte(`0e00`)) // a spelling of zero
	f.Add([]byte(`{"":""}`))
	f.Add([]byte(`{"a":9007199254740993}`)) // 2^53+1: refused, never rounded

	f.Fuzz(func(t *testing.T, raw []byte) {
		out, err := jcs.CanonicalizeJSON(raw)
		if err != nil {
			return // refusing is always allowed; the deviation note refuses reals
		}

		// 1. The output must itself be JSON. A canonicaliser that emits
		//    something unparseable has produced bytes no verifier can re-derive.
		var back any
		dec := json.NewDecoder(bytes.NewReader(out))
		dec.UseNumber()
		if err := dec.Decode(&back); err != nil {
			t.Fatalf("output is not valid JSON: %q (from %q): %v", out, raw, err)
		}

		// 2. Idempotent. Canonical input must canonicalise to itself, or two
		//    parties who both follow the spec can still sign different bytes.
		again, err := jcs.CanonicalizeJSON(out)
		if err != nil {
			t.Fatalf("canonical output was refused on a second pass: %q (from %q): %v", out, raw, err)
		}
		if !bytes.Equal(again, out) {
			t.Fatalf("not idempotent:\n once: %q\ntwice: %q\n from: %q", out, again, raw)
		}

		// 3. Deterministic. Go randomises map iteration, so a canonicaliser
		//    that forgot to sort passes single runs and fails in production
		//    against a peer that ordered differently.
		for i := 0; i < 4; i++ {
			rerun, err := jcs.CanonicalizeJSON(raw)
			if err != nil || !bytes.Equal(rerun, out) {
				t.Fatalf("not deterministic on run %d:\n first: %q\n  then: %q (err %v)", i, out, rerun, err)
			}
		}

		// 4. Value-preserving. The canonical form must parse back to the same
		//    value the input did — a signature over a document that says
		//    something else is the whole hazard.
		//
		// Compared NUMERICALLY, not as json.Number. The first version of this
		// used UseNumber on both sides and failed on the input `0e00`, which
		// is JSON for zero: canonicalising it to `0` is exactly correct, and
		// json.Number compares the strings "0e00" and "0". The test was wrong,
		// not the canonicaliser — and a value check that flags correct
		// canonicalisation of numbers would have to be relaxed until it flagged
		// nothing.
		//
		// float64 is lossless here because Canonicalize refuses anything
		// outside the ±2^53 integral range (the documented deviation), so the
		// comparison cannot silently lose precision it should have caught.
		orig, oerr := decodeNumeric(raw)
		if oerr != nil {
			return // input was not valid JSON; nothing to compare against
		}
		got, gerr := decodeNumeric(out)
		if gerr != nil {
			t.Fatalf("canonical output failed to re-decode: %q: %v", out, gerr)
		}
		if !reflect.DeepEqual(orig, got) {
			t.Fatalf("canonicalisation changed the value:\n  in: %#v\n out: %#v\nraw: %q", orig, got, raw)
		}
	})
}

// decodeNumeric parses JSON with numbers as float64, so that two spellings of
// the same number compare equal.
func decodeNumeric(b []byte) (any, error) {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, err
	}
	return v, nil
}

// Canonicalize takes a decoded value rather than bytes, which is the path the
// signing side uses. Same properties, reached differently: a map is the shape
// where key ordering can go wrong.
func FuzzCanonicalizeValue(f *testing.F) {
	f.Add(`{"b":1,"a":2}`)
	f.Add(`{"z":{"y":{"x":[1,2,3]}}}`)
	f.Add(`[true,false,null]`)

	f.Fuzz(func(t *testing.T, s string) {
		var v any
		dec := json.NewDecoder(bytes.NewReader([]byte(s)))
		dec.UseNumber()
		if err := dec.Decode(&v); err != nil {
			t.Skip()
		}
		out, err := jcs.Canonicalize(v)
		if err != nil {
			return
		}
		for i := 0; i < 8; i++ {
			again, err := jcs.Canonicalize(v)
			if err != nil {
				t.Fatalf("Canonicalize became an error on repeat: %v", err)
			}
			if !bytes.Equal(again, out) {
				t.Fatalf("Canonicalize is not deterministic across map iterations:\n"+
					" first: %q\n  then: %q\n input: %q", out, again, s)
			}
		}
	})
}
