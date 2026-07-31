package keys

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadGeneratesAndPersists(t *testing.T) {
	dir := t.TempDir()
	k1, err := Load(dir)
	if err != nil {
		t.Fatalf("first Load: %v", err)
	}
	k2, err := Load(dir)
	if err != nil {
		t.Fatalf("second Load: %v", err)
	}
	if k1.PublicKeyB64() != k2.PublicKeyB64() {
		t.Error("key not stable across reloads")
	}
	if k1.PublicKeyB64() == "" {
		t.Error("empty public key")
	}
	// A different dir yields a different identity.
	k3, err := Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if k3.PublicKeyB64() == k1.PublicKeyB64() {
		t.Error("two boots generated the same key")
	}
}

func TestSignCommandVerifies(t *testing.T) {
	k, err := Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cause := map[string]any{"kind": "chat", "channel": "whatsapp", "member": "m-1", "event": "e-1"}
	e, err := k.SignCommand("open", "dev-1", "main", 30*time.Second, cause)
	if err != nil {
		t.Fatalf("SignCommand: %v", err)
	}
	if e.V != 0 || e.Typ != "cmd" || e.Cmd != "open" || e.Nonce == "" || e.Sig == "" {
		t.Errorf("envelope shape: %+v", e)
	}
	if e.EXP-e.IAT != 30 {
		t.Errorf("ttl: iat=%d exp=%d", e.IAT, e.EXP)
	}
	if err := VerifyEnvelope(k.Public(), e); err != nil {
		t.Errorf("verify: %v", err)
	}

	// Tamper with any signed field → verification fails.
	tampered := *e
	tampered.Cmd = "hold"
	if err := VerifyEnvelope(k.Public(), &tampered); err == nil {
		t.Error("tampered cmd verified")
	}
	tampered = *e
	tampered.EXP += 3600
	if err := VerifyEnvelope(k.Public(), &tampered); err == nil {
		t.Error("tampered exp verified")
	}
	tampered = *e
	tampered.DeviceID = "dev-2"
	if err := VerifyEnvelope(k.Public(), &tampered); err == nil {
		t.Error("tampered device_id verified")
	}

	// Wrong key → fails.
	other, _ := Load(t.TempDir())
	if err := VerifyEnvelope(other.Public(), e); err == nil {
		t.Error("verified with wrong key")
	}
}

func TestSignCommandClampsTTL(t *testing.T) {
	k, _ := Load(t.TempDir())
	e, err := k.SignCommand("open", "d", "main", 10*time.Minute, nil)
	if err != nil {
		t.Fatal(err)
	}
	if e.EXP-e.IAT > 60 {
		t.Errorf("ttl not clamped to spec max: %d", e.EXP-e.IAT)
	}
}

// Self-authored JCS-subset vectors (RFC 8785, envelope subset). The
// authoritative cross-implementation cases live in proto/vectors/ and are
// exercised by vectors_test.go; these remain for edge cases the shared
// vectors don't carry (unicode, control chars, empty object).
func TestJCSVectors(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want string
	}{
		{"key ordering", map[string]any{"b": 1, "a": 2, "aa": 3}, `{"a":2,"aa":3,"b":1}`},
		{"nested", map[string]any{"z": map[string]any{"y": "x"}, "a": []any{1, "2", true, nil}},
			`{"a":[1,"2",true,null],"z":{"y":"x"}}`},
		{"escapes", map[string]any{"s": "a\"b\\c\nd\te"}, `{"s":"a\"b\\c\nd\te"}`},
		{"control chars", map[string]any{"s": "x\x01y"}, `{"s":"x\u0001y"}`},
		{"unicode literal", map[string]any{"k": "héllo ✓"}, `{"k":"héllo ✓"}`},
		{"integral float", map[string]any{"n": float64(1789000000)}, `{"n":1789000000}`},
		{"empty", map[string]any{}, `{}`},
	}
	for _, c := range cases {
		got, err := Canonicalize(c.in)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if string(got) != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}

	// Envelope-shaped vector: matches proto/commands.md field set.
	env := map[string]any{
		"v": 0, "typ": "cmd", "cmd": "open",
		"device_id": "uuid", "access_point": "main",
		"nonce": "abc", "iat": 1789000000, "exp": 1789000030,
		"cause": map[string]any{"kind": "chat", "channel": "whatsapp"},
	}
	want := `{"access_point":"main","cause":{"channel":"whatsapp","kind":"chat"},"cmd":"open","device_id":"uuid","exp":1789000030,"iat":1789000000,"nonce":"abc","typ":"cmd","v":0}`
	got, err := Canonicalize(env)
	if err != nil || string(got) != want {
		t.Errorf("envelope vector: %v\n got %s\nwant %s", err, got, want)
	}
}

func TestJCSRejectsNonIntegerNumbers(t *testing.T) {
	if _, err := Canonicalize(map[string]any{"f": 1.5}); err == nil {
		t.Error("non-integer number accepted (documented deviation should reject)")
	}
}

func TestCanonicalizeJSONNormalizes(t *testing.T) {
	raw := []byte("{\n  \"b\": 1,\t\"a\": \"x\" }")
	got, err := CanonicalizeJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"a":"x","b":1}` {
		t.Errorf("got %s", got)
	}
}

// A corrupt gateway seed must refuse, and must not regenerate.
//
// Load generates a key when the file is ABSENT — correct, that is first boot.
// The branch next to it handles a file that exists and does not decode, and the
// difference between them is the whole safety of pairing: every controller pins
// this hub's public key at pairing and verifies every command against it. A hub
// that responded to a damaged seed by minting a fresh one would come up looking
// healthy, sign with a key nobody trusts, and have every controller reject every
// command — including the offline path, which verifies against the same pin.
//
// The retained (previous) key's corrupt path is covered in rotation_test.go.
// This one was not, and it is the one that decides whether the hub can be
// trusted to be the same hub after a restart.
func TestACorruptGatewaySeedRefusesAndDoesNotRegenerate(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content string
	}{
		{"not hex", "this is not a seed"},
		{"hex but too short", "aabbcc"},
		{"hex but too long", strings.Repeat("ab", ed25519.SeedSize+4)},
		{"empty", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "gateway_ed25519.seed")
			if err := os.WriteFile(path, []byte(tc.content), 0o600); err != nil {
				t.Fatal(err)
			}

			k, err := Load(dir)
			if err == nil {
				t.Fatalf(`Load accepted a corrupt seed and returned a key (%s).

If that key was GENERATED rather than read, the hub is now signing with something
no paired controller has ever seen. Every command is rejected, the offline grant
path fails the same way, and nothing about the hub looks wrong.`,
					base64.RawURLEncoding.EncodeToString(k.Public()))
			}

			// And the file must be untouched. Refusing but rewriting would
			// destroy the damaged bytes — the only evidence of what happened,
			// and the only chance of recovering the original seed by hand.
			after, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatalf("the seed file is gone after a refused load: %v", readErr)
			}
			if string(after) != tc.content {
				t.Errorf("the seed file was rewritten on a refused load: %q became %q",
					tc.content, string(after))
			}
		})
	}
}

// The other half of that branch: an ABSENT file is first boot and must generate.
// Asserted beside the refusal so a change that made corruption regenerate cannot
// be justified as "matching the absent case".
func TestAnAbsentSeedIsFirstBootAndGenerates(t *testing.T) {
	dir := t.TempDir()
	k, err := Load(dir)
	if err != nil {
		t.Fatalf("Load on an empty directory failed: %v", err)
	}
	if len(k.Public()) != ed25519.PublicKeySize {
		t.Fatalf("generated public key is %d bytes, want %d", len(k.Public()), ed25519.PublicKeySize)
	}
	if _, err := os.Stat(filepath.Join(dir, "gateway_ed25519.seed")); err != nil {
		t.Errorf("first boot did not persist the seed: %v", err)
	}
}
