package jcs_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/controller/internal/jcs"
)

// proto/jcs-cases.json — the adversarial canonicalisation cases both
// implementations must agree on.
//
// hub/internal/keys is the other one. Go's internal/ rule forbids any single
// test from importing both, so their agreement is asserted against shared DATA
// rather than in code: this file and its counterpart in the hub read the same
// JSON and must produce the same bytes.
//
// The expected values in that file are derived from RFC 8785 by hand, not
// captured from either implementation — captured output would only prove each
// side reproduces itself.
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
	if len(c.Cases) < 10 || len(c.Refused) < 2 {
		t.Fatalf("loaded %d cases and %d refusals; the file looks truncated",
			len(c.Cases), len(c.Refused))
	}
	return c
}

func TestJCSSharedCases(t *testing.T) {
	c := loadJCSCases(t)
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
	}
	for _, tc := range c.Refused {
		t.Run("refused/"+tc.Name, func(t *testing.T) {
			if got, err := jcs.CanonicalizeJSON([]byte(tc.Input)); err == nil {
				t.Errorf("accepted %s and produced %s; it must be refused rather than guessed at",
					tc.Input, got)
			}
		})
	}
}
