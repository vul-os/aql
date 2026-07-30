package keys_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/keys"
)

// The hub mints what the controller verifies, so the four numbers in
// envelope.go have to be the controller's numbers. Nothing checked that.
//
// The vectors are the authority both sides claim to restate, and the two Go
// modules cannot import each other — so each checks itself against the vectors
// on disk rather than against the other. The controller has the mirror of this
// test in controller/internal/wire/spec_constants_test.go.
//
// Note which direction each disagreement fails in, because none of them fail
// loudly: a hub with a wider skew than the controller mints commands that are
// rejected on arrival; a hub with a longer command window mints commands the
// controller calls window_too_long; a hub with a shorter stale-clock limit warns
// about controllers that are fine. All three look like intermittent hardware.
func TestSpecConstantsMatchTheVectors(t *testing.T) {
	dir := vectorsDir(t)
	raw, err := os.ReadFile(filepath.Join(dir, "commands.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		SpecConstants map[string]int `json:"spec_constants"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	// Absent the block, every lookup below yields 0 and each check becomes
	// "want 0, got 0" for a constant nobody published.
	if len(doc.SpecConstants) == 0 {
		t.Fatal("commands.json carries no spec_constants block; every check below " +
			"would compare against a zero-valued map lookup and pass")
	}

	for _, tc := range []struct {
		key  string
		got  int
		name string
	}{
		{"skew_seconds", keys.ClockSkewSeconds, "keys.ClockSkewSeconds"},
		// MaxCommandTTL is a time.Duration; the contract term is in seconds.
		{"max_cmd_window_seconds", int(keys.MaxCommandTTL / time.Second), "keys.MaxCommandTTL"},
		{"cnonce_ttl_seconds", keys.CnonceTTLSeconds, "keys.CnonceTTLSeconds"},
		{"stale_clock_limit_seconds", keys.StaleClockLimitSeconds, "keys.StaleClockLimitSeconds"},
	} {
		want, ok := doc.SpecConstants[tc.key]
		if !ok {
			t.Errorf("commands.json spec_constants has no %q, so %s restates a contract "+
				"term the vectors no longer publish", tc.key, tc.name)
			continue
		}
		if tc.got != want {
			t.Errorf("%s = %d but commands.json says %s = %d. The vectors are the "+
				"authority for both implementations; a hub that disagrees with them "+
				"mints commands the controller will not honour.", tc.name, tc.got, tc.key, want)
		}
	}
}

// MaxCommandTTL is the one constant declared as a duration rather than a count
// of seconds, and the conversion above is where that could go wrong quietly —
// a stray time.Millisecond would make the comparison pass against a value 1000×
// off. Pin the unit.
func TestMaxCommandTTLIsAWholeNumberOfSeconds(t *testing.T) {
	if keys.MaxCommandTTL%time.Second != 0 {
		t.Fatalf("keys.MaxCommandTTL = %v, which is not a whole number of seconds; "+
			"the wire field is an integer second count and the conversion truncates",
			keys.MaxCommandTTL)
	}
	if keys.MaxCommandTTL < time.Second {
		t.Fatalf("keys.MaxCommandTTL = %v — under a second, so the seconds conversion "+
			"would floor to 0 and every command would carry exp == iat", keys.MaxCommandTTL)
	}
}
