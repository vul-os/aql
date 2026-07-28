package jcs_test

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/vul-os/aql/controller/internal/jcs"
	"github.com/vul-os/aql/controller/internal/vectorfile"
)

// TestCanonicalBytesAllVectors is conformance layer 1 (proto/vectors/README):
// our JCS output over `object` minus top-level `sig` must byte-compare equal
// to every `canonical` field in every vectors file — including nested grant
// objects, transcript messages and multi-step flows.
func TestCanonicalBytesAllVectors(t *testing.T) {
	dir, err := vectorfile.FindDir("")
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	vectors := 0
	for _, name := range []string{"pairing.json", "commands.json", "grants.json", "events.json", "acks.json"} {
		f, err := vectorfile.Load(dir, name)
		if err != nil {
			t.Fatal(err)
		}
		for _, v := range f.Vectors {
			vectors++
			check := func(label string, obj json.RawMessage, canonical string) {
				t.Helper()
				if len(obj) == 0 || canonical == "" {
					return
				}
				got, sig, err := canonMinusSig(obj)
				_ = sig
				if err != nil {
					t.Errorf("%s/%s/%s: canonicalize: %v", name, v.Name, label, err)
					return
				}
				if got != canonical {
					t.Errorf("%s/%s/%s: canonical mismatch\n got: %s\nwant: %s", name, v.Name, label, got, canonical)
				}
				total++
			}
			check("object", v.Object, v.Canonical)
			if v.Grant != nil {
				check("grant", v.Grant.Object, v.Grant.Canonical)
			}
			if v.Transcript != nil {
				if v.Transcript.Open != nil {
					check("open", v.Transcript.Open.Object, v.Transcript.Open.Canonical)
				}
				if v.Transcript.Proof != nil {
					check("proof", v.Transcript.Proof.Object, v.Transcript.Proof.Canonical)
				}
			}
			for i, st := range v.Steps {
				check("step", st.Object, st.Canonical)
				if st.Proof != nil {
					check("step-proof", st.Proof.Object, st.Proof.Canonical)
				}
				_ = i
			}
		}
	}
	if vectors != 63 {
		t.Errorf("expected 63 vectors across the five files, saw %d", vectors)
	}
	if total < 61 {
		t.Errorf("expected ≥61 canonical comparisons, did %d", total)
	}
	t.Logf("byte-compared %d canonical encodings across %d vectors", total, vectors)
}

// canonMinusSig mirrors the signing rule: parse, drop top-level sig, JCS.
// For unsigned objects (no sig member) it is simply JCS of the whole object.
func canonMinusSig(raw []byte) (string, string, error) {
	var m map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return "", "", err
	}
	sig, _ := m["sig"].(string)
	delete(m, "sig")
	b, err := jcs.Canonicalize(m)
	return string(b), sig, err
}

// TestCanonicalizeJSONMatchesCanonicalize covers the raw-bytes entry point,
// which nothing in this module had ever run — not production, not a test. Found
// by sweeping for exported symbols with no caller.
//
// It matters more than the line count suggests: this package is one of two
// independent JCS implementations that the conformance vectors cross-check, and
// an entry point nobody runs is an entry point nobody has checked agrees with
// the one they do run.
//
// WHAT THIS COMPARES, AND WHY IT IS PHRASED THIS WAY. The vectors store each
// `object` in insertion order (v, typ, device_id, …), which is NOT canonical
// order. So feeding the ORIGINAL bytes to CanonicalizeJSON and comparing
// against Canonicalize over the decoded value is a real comparison: a
// CanonicalizeJSON that failed to canonicalize at all would return
// insertion-order bytes and fail here.
//
// The first version of this test re-marshalled the object through
// json.Marshal first, to strip `sig`. json.Marshal sorts map keys — so the
// input was already canonical, and the test passed with CanonicalizeJSON
// stubbed out to `return raw, nil`. It was comparing canonical input to
// canonical output. Neither side strips sig now; both canonicalize the whole
// document, which needs no re-marshalling and keeps the original bytes intact.
//
// WHAT IT STILL DOES NOT CATCH, stated so nobody concludes otherwise from a
// green run: removing UseNumber from CanonicalizeJSON's decoder passes this
// test. writeJCS renders an integral float64 without an exponent, and every
// number in the corpus is small, so json.Number and float64 agree here.
// UseNumber earns itself on inputs this corpus does not contain — an integer
// above 2^53, where float64 silently loses precision and the signature would
// be over different bytes than the sender produced. Do not remove it because
// the tests stay green.
func TestCanonicalizeJSONMatchesCanonicalize(t *testing.T) {
	dir, err := vectorfile.FindDir("")
	if err != nil {
		t.Fatal(err)
	}
	compared := 0
	compare := func(t *testing.T, where string, obj json.RawMessage) {
		t.Helper()
		if len(obj) == 0 {
			return
		}
		var v any
		dec := json.NewDecoder(bytes.NewReader(obj))
		dec.UseNumber()
		if err := dec.Decode(&v); err != nil {
			t.Fatalf("%s: decode: %v", where, err)
		}
		viaValue, err := jcs.Canonicalize(v)
		if err != nil {
			t.Fatalf("%s: Canonicalize: %v", where, err)
		}
		viaRaw, err := jcs.CanonicalizeJSON(obj)
		if err != nil {
			t.Fatalf("%s: CanonicalizeJSON: %v", where, err)
		}
		if !bytes.Equal(viaRaw, viaValue) {
			t.Errorf("%s: entry points disagree\n raw: %s\nval: %s", where, viaRaw, viaValue)
		}
		// Guards the comparison itself: if the input were already canonical,
		// the assertion above would hold for a CanonicalizeJSON that did
		// nothing at all. The vectors are stored in insertion order, so this
		// must differ for any object with more than one key out of order.
		if len(v.(map[string]any)) > 1 && bytes.Equal(obj, viaRaw) {
			t.Errorf("%s: the stored object was already canonical, so this "+
				"comparison proves nothing about CanonicalizeJSON", where)
		}
		compared++
	}

	for _, name := range []string{"pairing.json", "commands.json", "grants.json", "events.json", "acks.json"} {
		f, err := vectorfile.Load(dir, name)
		if err != nil {
			t.Fatal(err)
		}
		for _, v := range f.Vectors {
			at := name + "/" + v.Name
			// Every nested shape the sibling test canonicalizes, not just the
			// top-level object — grants.json carries NO top-level object at
			// all, so a first version of this skipped all fourteen of its
			// vectors and the count guard is what said so.
			compare(t, at+"/object", v.Object)
			if v.Grant != nil {
				compare(t, at+"/grant", v.Grant.Object)
			}
			if v.Transcript != nil {
				if v.Transcript.Open != nil {
					compare(t, at+"/open", v.Transcript.Open.Object)
				}
				if v.Transcript.Proof != nil {
					compare(t, at+"/proof", v.Transcript.Proof.Object)
				}
			}
			for _, st := range v.Steps {
				compare(t, at+"/step", st.Object)
				if st.Proof != nil {
					compare(t, at+"/step-proof", st.Proof.Object)
				}
			}
		}
	}
	// A guard against this test quietly comparing nothing, which is how a
	// corpus-driven test fails silently. Pinned to what the sibling test
	// byte-compares, so the two cannot drift into covering different corpora.
	if compared < 93 {
		t.Errorf("compared only %d documents; the corpus has 93 canonical encodings", compared)
	}
}

// withoutSig strips the top-level sig so both entry points see the same
// document — canonMinusSig removes it internally, and CanonicalizeJSON does
// not (it canonicalizes what it is given, by design).
func withoutSig(t *testing.T, raw []byte) []byte {
	t.Helper()
	var m map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		t.Fatal(err)
	}
	delete(m, "sig")
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
