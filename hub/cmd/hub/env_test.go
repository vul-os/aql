package main

import (
	"bytes"
	"log/slog"
	"testing"
)

// An env var is part of a running install's configuration. Renaming one
// without a fallback breaks every deployment on upgrade, with a symptom
// ("the energy poller stopped") that points nowhere near the cause
// ("a variable was renamed").
func TestLegacyNamesStillWork(t *testing.T) {
	resetLegacyEnv()
	t.Setenv("LINTEL_ENERGY_TZ", "Africa/Johannesburg")
	got := lookupEnv("AQL_ENERGY_TZ")
	if got != "Africa/Johannesburg" {
		t.Fatalf("lookupEnv = %q; the legacy variable was ignored, so every "+
			"existing install would silently lose this setting on upgrade", got)
	}
}

// The current name wins, so an operator who has migrated is not overridden by
// a stale variable they forgot to unset.
func TestCurrentNameTakesPrecedence(t *testing.T) {
	resetLegacyEnv()
	t.Setenv("LINTEL_ENV", "old")
	t.Setenv("AQL_ENV", "new")
	if got := lookupEnv("AQL_ENV"); got != "new" {
		t.Fatalf("lookupEnv = %q, want the AQL_ value to win", got)
	}
	// And using the current name must NOT be reported as legacy use.
	if len(legacyEnvSeen) != 0 {
		t.Errorf("using the supported name was reported as deprecated: %v", legacyEnvSeen)
	}
}

// A silent fallback would be almost as bad as no fallback: the install keeps
// working and nobody ever learns to migrate.
func TestLegacyUseIsReported(t *testing.T) {
	resetLegacyEnv()
	t.Setenv("LINTEL_DATA_DIR", "/var/lib/aql")
	_ = lookupEnv("AQL_DATA_DIR")

	var buf bytes.Buffer
	warnLegacyEnv(slog.New(slog.NewTextHandler(&buf, nil)))
	out := buf.String()
	if out == "" {
		t.Fatal("a deprecated variable was used and nothing said so")
	}
	// The operator needs both names to act on it.
	for _, want := range []string{"LINTEL_DATA_DIR", "AQL_DATA_DIR"} {
		if !bytes.Contains(buf.Bytes(), []byte(want)) {
			t.Errorf("the warning does not name %s, so it is not actionable: %s", want, out)
		}
	}
}

func TestNothingToWarnAboutStaysQuiet(t *testing.T) {
	resetLegacyEnv()
	var buf bytes.Buffer
	warnLegacyEnv(slog.New(slog.NewTextHandler(&buf, nil)))
	if buf.Len() != 0 {
		t.Fatalf("warned with no legacy variables in use: %s", buf.String())
	}
}

// A variable that is not ours is read verbatim. Not everything this binary
// reads is AQL_-prefixed — TZ, HOME, and the chat rails' vendor-named
// variables — and prefixing those would break them.
func TestNonPrefixedKeysAreReadVerbatim(t *testing.T) {
	resetLegacyEnv()
	t.Setenv("SOME_VENDOR_TOKEN", "abc")
	if got := lookupEnv("SOME_VENDOR_TOKEN"); got != "abc" {
		t.Fatalf("lookupEnv = %q, want abc", got)
	}
	if len(legacyEnvSeen) != 0 {
		t.Error("a non-AQL variable was treated as a legacy rename")
	}
}

func resetLegacyEnv() {
	legacyEnvMu.Lock()
	defer legacyEnvMu.Unlock()
	legacyEnvSeen = map[string]string{}
}
