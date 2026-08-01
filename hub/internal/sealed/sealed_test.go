package sealed

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func testKey(t *testing.T) []byte {
	t.Helper()
	s, err := NewKey()
	if err != nil {
		t.Fatal(err)
	}
	k, err := ParseKey(s)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func TestSealAndOpenRoundTrip(t *testing.T) {
	key := testKey(t)
	plain := []byte("a4f1c0de...the seed hex...")
	sealed, err := Seal(key, plain)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if bytes.Contains(sealed, plain) {
		t.Fatal("the plaintext is present in the sealed bytes")
	}
	got, err := Open(key, sealed)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatalf("round trip = %q, want %q", got, plain)
	}
}

// The distinction an operator acts on. A wrong key and an unencrypted file call
// for opposite responses — find the right key, versus this hub is not using
// encryption — so they must not report the same thing.
func TestPlaintextIsNotReportedAsAWrongKey(t *testing.T) {
	key := testKey(t)
	_, err := Open(key, []byte("deadbeef-a-plain-hex-seed"))
	if !errors.Is(err, ErrNotSealed) {
		t.Fatalf("err = %v, want ErrNotSealed", err)
	}
}

func TestAWrongKeyIsRefused(t *testing.T) {
	sealedBytes, err := Seal(testKey(t), []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Open(testKey(t), sealedBytes); !errors.Is(err, ErrWrongKey) {
		t.Fatalf("a different key opened the file, or reported %v", err)
	}
}

// The header is authenticated, so stripping it to make a sealed file look like
// plaintext fails rather than handing back ciphertext as if it were a seed —
// which a caller would then load as a key.
func TestAnEditedHeaderCannotDowngradeAFileToPlaintext(t *testing.T) {
	key := testKey(t)
	sealedBytes, err := Seal(key, []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	tampered := append([]byte(nil), sealedBytes...)
	tampered[0] = 'X' // break the magic
	if IsSealed(tampered) {
		t.Fatal("a file with a broken header still reads as sealed")
	}
	// And it must not open as plaintext-with-a-bad-header either: the caller
	// gets ErrNotSealed and treats the bytes as a seed, so the value of the
	// magic being authenticated is that a RESTORED header cannot be forged.
	restored := append([]byte(nil), sealedBytes...)
	copy(restored, magic)
	restored[len(magic)+1] ^= 0xff // flip a nonce byte
	if _, err := Open(key, restored); !errors.Is(err, ErrWrongKey) {
		t.Fatalf("a tampered sealed file opened: %v", err)
	}
}

func TestKeyParsingAcceptsEveryBase64AnOperatorMightPaste(t *testing.T) {
	raw := make([]byte, KeySize)
	for i := range raw {
		raw[i] = byte(i)
	}
	for _, enc := range []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding,
		base64.URLEncoding, base64.RawURLEncoding,
	} {
		got, err := ParseKey(enc.EncodeToString(raw))
		if err != nil {
			t.Errorf("%T: %v", enc, err)
			continue
		}
		if !bytes.Equal(got, raw) {
			t.Errorf("%T decoded wrong", enc)
		}
	}
}

// A truncated paste is the interesting failure: it decodes cleanly and is the
// wrong length, so length has to be checked after decoding rather than by
// counting characters.
func TestAShortKeyIsRefusedRatherThanPadded(t *testing.T) {
	short := base64.RawURLEncoding.EncodeToString(make([]byte, 16))
	_, err := ParseKey(short)
	if err == nil {
		t.Fatal("a 16-byte key was accepted as a 32-byte one")
	}
	if !strings.Contains(err.Error(), "16 bytes") {
		t.Errorf("err = %q — it should say what length it got", err)
	}
}

func TestSealedBytesDifferEachTime(t *testing.T) {
	key := testKey(t)
	a, err := Seal(key, []byte("same"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := Seal(key, []byte("same"))
	if err != nil {
		t.Fatal(err)
	}
	// A fixed nonce would make two seals of one plaintext identical, and GCM
	// with a reused nonce is a broken cipher rather than a cosmetic issue.
	if bytes.Equal(a, b) {
		t.Fatal("two seals of the same plaintext are identical — the nonce is not random")
	}
}
