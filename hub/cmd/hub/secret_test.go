package main

// The JWT secret's damage path.
//
// loadOrCreateSecret generates on an ABSENT file — first boot — and refuses a
// file that exists and does not decode. That asymmetry is the same one
// internal/keys makes for the gateway signing seed, and it is right for the same
// reason, at a smaller scale: regenerating would be silent.
//
// The blast radius differs and is worth stating rather than implying they are
// the same problem. A regenerated SIGNING key breaks pairing — every controller
// rejects every command, and the offline path fails identically. A regenerated
// JWT secret only invalidates sessions: everyone is logged out, with nothing
// said, on a restart that otherwise looks clean. Less severe, still wrong, and
// the kind of thing that gets "fixed" by making the corrupt case fall through to
// generation because logging people out seems friendlier than refusing to boot.
//
// It refuses. This is what says so.

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestACorruptJWTSecretRefusesRatherThanRegenerating(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content string
	}{
		{"not hex", "definitely not hex"},
		{"hex but too short", hex.EncodeToString([]byte("only-16-bytes!!!"))},
		{"empty", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "jwt_secret")
			if err := os.WriteFile(path, []byte(tc.content), 0o600); err != nil {
				t.Fatal(err)
			}

			if _, err := loadOrCreateSecret(path, nil); err == nil {
				t.Fatal(`loadOrCreateSecret accepted a corrupt secret.

If it generated a replacement, every session token signed with the old one stops
verifying: everyone is logged out on a restart that looks entirely normal, and
nothing anywhere says why.`)
			}

			// Untouched, for the same reason the gateway seed must be: the
			// damaged bytes are the only evidence of what happened.
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("the secret file is gone after a refused load: %v", err)
			}
			if string(after) != tc.content {
				t.Errorf("the file was rewritten on a refused load: %q became %q", tc.content, string(after))
			}
		})
	}
}

// The other half: absent means first boot, and the secret must be persisted so
// the NEXT boot reads it rather than minting another one.
func TestAnAbsentJWTSecretIsCreatedAndPersisted(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jwt_secret")

	first, err := loadOrCreateSecret(path, nil)
	if err != nil {
		t.Fatalf("first boot failed: %v", err)
	}
	if len(first) < 32 {
		t.Fatalf("generated secret is %d bytes, want at least 32", len(first))
	}

	second, err := loadOrCreateSecret(path, nil)
	if err != nil {
		t.Fatalf("second boot failed: %v", err)
	}
	if string(second) != string(first) {
		t.Error(`the secret changed between boots.

Every session issued before the restart stops verifying. The file exists to make
that not happen.`)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(raw)) == "" {
		t.Error("first boot wrote an empty secret file")
	}
}
