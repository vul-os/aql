package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/sealed"
)

func jwtDataKey(t *testing.T) []byte {
	t.Helper()
	s, err := sealed.NewKey()
	if err != nil {
		t.Fatal(err)
	}
	k, err := sealed.ParseKey(s)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// The session HMAC key signs every token, so anyone holding it can mint one for
// any user. Losing it is harmless; leaking it is not, and a stolen backup is
// exactly where the second matters.
func TestTheJWTSecretIsSealedWhenADataKeyIsSet(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jwt_secret")
	key := jwtDataKey(t)

	first, err := loadOrCreateSecret(path, key)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !sealed.IsSealed(raw) {
		t.Fatal("the secret was written in plaintext despite a data key")
	}

	again, err := loadOrCreateSecret(path, key)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if !bytes.Equal(first, again) {
		t.Fatal("the secret changed across a reopen — every session would end for no reason")
	}
}

// Refusing rather than regenerating. Minting a replacement would be harmless in
// itself, and would turn "you forgot AQL_DATA_KEY" into "everyone was logged
// out and nobody knows why".
func TestASealedJWTSecretWithNoDataKeyRefusesRatherThanRegenerating(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jwt_secret")
	key := jwtDataKey(t)
	if _, err := loadOrCreateSecret(path, key); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	got, err := loadOrCreateSecret(path, nil)
	if err == nil {
		t.Fatal("a sealed secret with no data key was replaced silently")
	}
	if got != nil {
		t.Error("a secret was returned alongside the refusal")
	}
	if !strings.Contains(err.Error(), "AQL_DATA_KEY") {
		t.Errorf("err = %q — it should name the variable that is missing", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("the refusal overwrote the sealed secret")
	}
}

// Turning it on is setting a variable, and the secret must survive the step —
// sealing it must not end every session.
func TestAPlaintextJWTSecretIsSealedInPlaceWithoutChanging(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jwt_secret")
	plain, err := loadOrCreateSecret(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if sealed.IsSealed(raw) {
		t.Fatal("sealed with no data key")
	}

	key := jwtDataKey(t)
	afterSeal, err := loadOrCreateSecret(path, key)
	if err != nil {
		t.Fatalf("seal in place: %v", err)
	}
	if !bytes.Equal(plain, afterSeal) {
		t.Fatal("sealing changed the secret — every session would end")
	}
	raw2, _ := os.ReadFile(path)
	if !sealed.IsSealed(raw2) {
		t.Fatal("the plaintext secret was not sealed in place")
	}
}

// The control: with no data key, nothing changes for an existing deployment.
func TestNoDataKeyLeavesTheJWTSecretExactlyAsItWas(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jwt_secret")
	a, err := loadOrCreateSecret(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if sealed.IsSealed(raw) {
		t.Fatal("a secret was sealed with no data key configured")
	}
	b, err := loadOrCreateSecret(path, nil)
	if err != nil || !bytes.Equal(a, b) {
		t.Fatalf("reload: %v", err)
	}
}
