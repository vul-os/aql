package httpdev

import (
	"encoding/json"
	"strings"
	"testing"
)

func decode(t *testing.T, s string) any {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(s))
	dec.UseNumber()
	var doc any
	if err := dec.Decode(&doc); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return doc
}

// The whole path grammar, stated as tests so the doc comment on lookupPath can
// be checked rather than believed.
func TestLookupPath(t *testing.T) {
	doc := decode(t, `{
		"level": 62,
		"nested": {"deep": {"celsius": -3.5}},
		"list": [{"kw": 1.25}, {"kw": 2.5}],
		"0": "an object key that looks like an index",
		"flag": true,
		"nothing": null,
		"blank": ""
	}`)

	cases := []struct {
		path string
		ok   bool
		val  float64
		text string
	}{
		{path: "level", ok: true, val: 62},
		{path: "nested.deep.celsius", ok: true, val: -3.5},
		{path: "list.1.kw", ok: true, val: 2.5},
		{path: "list.0.kw", ok: true, val: 1.25},
		{path: "0", ok: true, text: "an object key that looks like an index"},
		{path: "flag", ok: true, val: 1},
		// Absent, null, empty-string and non-scalar values are all "not a
		// reading" — the metric is skipped rather than invented.
		{path: "missing"},
		{path: "nothing"},
		{path: "blank"},
		{path: "nested"},
		{path: "list"},
		// Walking past a scalar, and indexing an array with a non-index.
		{path: "level.deeper"},
		{path: "list.9.kw"},
		{path: "list.-1.kw"},
		{path: "list.first.kw"},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			v, found := lookupPath(doc, tc.path)
			if !found {
				if tc.ok {
					t.Fatalf("path %q did not resolve", tc.path)
				}
				return
			}
			val, text, ok := scalar(v)
			if ok != tc.ok {
				t.Fatalf("path %q: scalar ok = %v, want %v", tc.path, ok, tc.ok)
			}
			if ok && (val != tc.val || text != tc.text) {
				t.Fatalf("path %q = (%v, %q), want (%v, %q)", tc.path, val, text, tc.val, tc.text)
			}
		})
	}
}

func TestEmptyPathSelectsTheWholeDocument(t *testing.T) {
	v, ok := lookupPath(decode(t, `41.5`), "")
	if !ok {
		t.Fatal("the empty path must select the document")
	}
	val, _, ok := scalar(v)
	if !ok || val != 41.5 {
		t.Fatalf("scalar = %v, %v", val, ok)
	}
	if _, ok := lookupPath(decode(t, `null`), ""); ok {
		t.Fatal("a null document resolves to nothing")
	}
}

// A key containing a dot is not addressable. Stated as a test so the limitation
// is a decision rather than a bug someone rediscovers.
func TestDottedKeysAreNotAddressable(t *testing.T) {
	if _, ok := lookupPath(decode(t, `{"a.b": 1}`), "a.b"); ok {
		t.Fatal("a dotted key resolved; the grammar's documented limitation is wrong")
	}
}

func TestCheckPath(t *testing.T) {
	for _, good := range []string{"", "a", "a.b", "list.0.kw", "0"} {
		if err := checkPath(good); err != nil {
			t.Fatalf("checkPath(%q) = %v", good, err)
		}
	}
	for _, bad := range []string{".", ".a", "a.", "a..b"} {
		if err := checkPath(bad); err == nil {
			t.Fatalf("checkPath(%q) accepted an empty segment", bad)
		}
	}
}

// json.Number keeps precision that a float64 round-trip would not, which is why
// the decoder uses it.
func TestLargeNumbersSurvive(t *testing.T) {
	v, ok := lookupPath(decode(t, `{"kw": 1234567890123}`), "kw")
	if !ok {
		t.Fatal("not found")
	}
	val, _, ok := scalar(v)
	if !ok || val != 1234567890123 {
		t.Fatalf("value = %v", val)
	}
}
