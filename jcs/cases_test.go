package jcs_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/jcs"
)

// proto/jcs-cases.json — the adversarial canonicalisation cases every
// implementation of the profile must agree on.
//
// There is now exactly ONE Go implementation (this module), so this file is no
// longer asserting Go-against-Go agreement. It is asserting Go against the
// hand-derived expectations in the shared file, which are the same
// expectations src/lib/offline/__tests__/jcs.test.ts and
// proto/vectors/verify.mjs hold their implementations to. The cross-language
// agreement is what the file buys; the Go halves of it were folded because
// they had already drifted (see the package doc).
//
// The expected values in that file are derived from RFC 8785 by hand, not
// captured from any implementation — captured output would only prove an
// implementation reproduces itself.

type jcsCases struct {
	Cases []struct {
		Name      string `json:"name"`
		Input     string `json:"input"`
		Canonical string `json:"canonical"`
	} `json:"cases"`
	Refused []struct {
		Name  string `json:"name"`
		Input string `json:"input"`
	} `json:"refused"`
}

func loadJCSCases(t *testing.T) jcsCases {
	t.Helper()
	// Walk up to the repo root; the test's working directory is the package.
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	var path string
	for i := 0; i < 6; i++ {
		p := filepath.Join(dir, "proto", "jcs-cases.json")
		if _, err := os.Stat(p); err == nil {
			path = p
			break
		}
		dir = filepath.Dir(dir)
	}
	if path == "" {
		t.Fatal("proto/jcs-cases.json not found walking up from the package directory")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var c jcsCases
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	// A file that parsed to nothing would make every assertion below vacuous.
	if len(c.Cases) < 14 || len(c.Refused) < 2 {
		t.Fatalf("loaded %d cases and %d refusals; the file looks truncated "+
			"(the corpus this gate was written against had 14 and 2)",
			len(c.Cases), len(c.Refused))
	}
	return c
}

func TestJCSSharedCases(t *testing.T) {
	c := loadJCSCases(t)
	ran, refused := 0, 0
	for _, tc := range c.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			got, err := jcs.CanonicalizeJSON([]byte(tc.Input))
			if err != nil {
				t.Fatalf("refused a case that must canonicalise: %v", err)
			}
			if string(got) != tc.Canonical {
				t.Errorf("canonical form differs from the shared expectation:\n got: %s\nwant: %s",
					got, tc.Canonical)
			}
		})
		ran++
	}
	for _, tc := range c.Refused {
		t.Run("refused/"+tc.Name, func(t *testing.T) {
			if got, err := jcs.CanonicalizeJSON([]byte(tc.Input)); err == nil {
				t.Errorf("accepted %s and produced %s; it must be refused rather than guessed at",
					tc.Input, got)
			}
		})
		refused++
	}
	// Coverage count, not a smoke test: a loop that silently iterated zero
	// entries would otherwise report PASS. This is the failure mode the suite
	// has actually shipped before.
	if ran != len(c.Cases) || refused != len(c.Refused) {
		t.Fatalf("ran %d/%d cases and %d/%d refusals", ran, len(c.Cases), refused, len(c.Refused))
	}
	t.Logf("checked %d canonicalisation cases and %d refusals from proto/jcs-cases.json", ran, refused)
}
