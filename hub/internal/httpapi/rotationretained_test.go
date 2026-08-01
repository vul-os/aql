package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// The rotation status says whether the retained key is still there.
//
// It is the key that lets this hub sign for a controller that has NOT repaired
// yet. Lose it mid-rotation and signForDevice sees HasPrevious() false, leaves
// the pin empty, and signs everything with the CURRENT key — which every
// unrepaired controller rejects as badsig. They are then unreachable AND
// unrepairable, because the repair that would move them needs the same missing
// key.
//
// SignCommandForPin has a careful refusal for a pin it cannot match, with the
// reasoning written out. That refusal never runs here: the caller does not ask
// for a pin at all once HasPrevious() is false, so the protection is bypassed
// rather than defeated. Nothing reported the state.
func TestRotationStatusReportsWhetherTheRetainedKeyIsStillThere(t *testing.T) {
	h := engineServer(t, "op-token")
	access := claimAdmin(t, h, "rotation-owner")

	// No rotation: the field is absent, because "is the retained key there" is
	// not a question that has an answer outside one.
	rec, out := doJSON(t, h, "GET", "/v1/admin/gateway-key/rotation", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d %v", rec.Code, out)
	}
	if out["rotating"] != false {
		t.Fatalf("a fresh hub reports a rotation in flight: %v", out)
	}
	if _, present := out["retained_key_present"]; present {
		t.Errorf("retained_key_present is reported with no rotation open: %v — it would read "+
			"as a problem on every healthy hub", out)
	}

	// Start one. The retained key exists, so it must say so — a field that only
	// ever appeared when something was wrong would make its absence ambiguous
	// between "fine" and "this hub is too old to tell you".
	if rec, out := doJSON(t, h, "POST", "/v1/admin/gateway-key/rotation", access,
		map[string]any{"reason": "test"}); rec.Code != http.StatusOK {
		t.Fatalf("start rotation: %d %v", rec.Code, out)
	}
	rec, out = doJSON(t, h, "GET", "/v1/admin/gateway-key/rotation", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status after start: %d %v", rec.Code, out)
	}
	if out["rotating"] != true {
		t.Fatalf("no rotation reported after starting one: %v", out)
	}
	if out["retained_key_present"] != true {
		t.Errorf("retained_key_present = %v during a healthy rotation, want true",
			out["retained_key_present"])
	}
}

// And the state the field exists for: a rotation recorded with the retained key
// GONE from disk.
//
// Without this the field is only ever observed as `true`, and a hardcoded
// `true` would pass — which is exactly what tampering showed before this test
// existed. A status field that cannot report the bad case reports nothing.
func TestRotationStatusReportsAMissingRetainedKey(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	previous := ks.PublicKeyB64()
	newPub, err := ks.Rotate()
	if err != nil {
		t.Fatalf("Rotate: %v", err)
	}
	// The database records a rotation in flight...
	if _, err := st.BeginKeyRotation(t.Context(), "rot-1", previous, newPub, "test"); err != nil {
		t.Fatalf("BeginKeyRotation: %v", err)
	}
	// ...and the retained key is lost — a restore from a backup that predates
	// the rotation, or a half-copied data directory.
	if err := os.Remove(filepath.Join(dir, "gateway_ed25519.previous.seed")); err != nil {
		t.Fatalf("remove retained key: %v", err)
	}
	reloaded, err := keys.Load(dir)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.HasPrevious() {
		t.Fatal("the reloaded keys still report a retained key — this fixture is not " +
			"reproducing the state it means to")
	}

	s := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"),
		AdminClaimToken: "op-token"},
		st, reloaded, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := s.Router()
	access := claimAdmin(t, h, "broken-rotation-owner")

	rec, out := doJSON(t, h, "GET", "/v1/admin/gateway-key/rotation", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d %v", rec.Code, out)
	}
	if out["rotating"] != true {
		t.Fatalf("no rotation reported: %v", out)
	}
	if out["retained_key_present"] != false {
		t.Fatalf("retained_key_present = %v, want false — every controller that has not "+
			"repaired is unreachable and unrepairable, and nothing says so",
			out["retained_key_present"])
	}
}
