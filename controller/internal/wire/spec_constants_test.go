package wire_test

import (
	"testing"

	"github.com/vul-os/aql/controller/internal/vectorfile"
	"github.com/vul-os/aql/controller/internal/wire"
)

// The four numbers in wire.go decide whether a door opens, and they are
// restated in three places that cannot import one another: the vectors JSON
// (the stated authority), hub/internal/keys and hub/internal/hub (which mint),
// and this package (which verifies). Nothing compared them.
//
// vectorfile.File has carried a SpecConstants field the whole time — parsed out
// of every vectors document and then read by absolutely nothing. So the
// authority was on disk, already loaded into memory, and ignored.
//
// The failure this invites is quiet and one-directional. Widen skew here but
// not in the hub and everything still works, because the verifier is the
// lenient one. Narrow max_cmd_window in the hub without narrowing it here and
// every command still verifies. The disagreement only shows up as a door that
// refuses a legitimate command in the field, at which point the two numbers are
// many commits apart and nothing points at either.
//
// A test that asserts the constants against literals would not help: it would
// just be a fourth restatement. This reads the vectors.
func TestWireConstantsMatchTheVectors(t *testing.T) {
	dir, err := vectorfile.FindDir("")
	if err != nil {
		t.Fatal(err)
	}
	f, err := vectorfile.Load(dir, "commands.json")
	if err != nil {
		t.Fatal(err)
	}

	// A missing spec_constants block would make every subtable below vacuous —
	// map lookups on an absent key return 0, and a "want 0, got 0" comparison
	// passes for a constant nobody declared. Floor it first.
	if len(f.SpecConstants) == 0 {
		t.Fatal("commands.json carries no spec_constants block; every check below " +
			"would compare against a zero-valued map lookup and pass")
	}

	for _, tc := range []struct {
		key  string
		got  int
		name string
	}{
		{"skew_seconds", wire.ClockSkewSeconds, "wire.ClockSkewSeconds"},
		{"max_cmd_window_seconds", wire.MaxCommandWindowSeconds, "wire.MaxCommandWindowSeconds"},
		{"cnonce_ttl_seconds", wire.CnonceTTLSeconds, "wire.CnonceTTLSeconds"},
		{"stale_clock_limit_seconds", wire.StaleClockLimitSeconds, "wire.StaleClockLimitSeconds"},
	} {
		want, ok := f.SpecConstants[tc.key]
		if !ok {
			t.Errorf("commands.json spec_constants has no %q, so %s is restating a "+
				"contract term that the vectors no longer publish", tc.key, tc.name)
			continue
		}
		if tc.got != want {
			t.Errorf("%s = %d but commands.json says %s = %d. The vectors are the "+
				"authority; a controller that disagrees with them rejects commands "+
				"the hub considers valid.", tc.name, tc.got, tc.key, want)
		}
	}
}

// Every vectors document repeats the same spec_constants block. If they drift
// from each other there is no authority left to check anything against — the
// test above would pass or fail depending on which file it happened to read.
func TestEveryVectorsFileAgreesOnTheConstants(t *testing.T) {
	dir, err := vectorfile.FindDir("")
	if err != nil {
		t.Fatal(err)
	}
	// keys.json holds only key material and carries no spec_constants block.
	names := []string{"commands.json", "acks.json", "events.json", "grants.json", "pairing.json", "webhooks.json"}

	ref := map[string]int{}
	refFrom := ""
	checked := 0
	for _, name := range names {
		f, err := vectorfile.Load(dir, name)
		if err != nil {
			t.Fatalf("load %s: %v", name, err)
		}
		if len(f.SpecConstants) == 0 {
			continue
		}
		checked++
		if refFrom == "" {
			ref, refFrom = f.SpecConstants, name
			continue
		}
		for k, want := range ref {
			got, ok := f.SpecConstants[k]
			if !ok {
				t.Errorf("%s omits spec_constants.%s, which %s declares as %d", name, k, refFrom, want)
				continue
			}
			if got != want {
				t.Errorf("spec_constants.%s is %d in %s and %d in %s — the vectors "+
					"contradict each other, so neither is an authority", k, want, refFrom, got, name)
			}
		}
		for k := range f.SpecConstants {
			if _, ok := ref[k]; !ok {
				t.Errorf("%s declares spec_constants.%s, which %s omits", name, k, refFrom)
			}
		}
	}
	// Without this the loop above is green when every file lacks the block, and
	// green again if `names` loses its entries.
	if checked < 4 {
		t.Fatalf("only %d vectors files carried a spec_constants block; expected the "+
			"contract documents to publish it, so this comparison checked almost nothing", checked)
	}
}
