package httpapi

// Playback and the permission in front of it.
//
// The properties pinned here are the ones whose failure hands somebody's
// footage to the wrong person, or hands it to the right person without a
// record. Both are worse than the feature not existing.

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// A server whose recordings root is a temp dir the test can write clips into.
func newFootageServer(t *testing.T) (http.Handler, *store.Store, string) {
	t.Helper()
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
	root := filepath.Join(dir, "recordings")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	s := New(Config{
		Version:        "test",
		JWTSecret:      []byte("0123456789abcdef0123456789abcdef"),
		RecordingsRoot: root,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router(), st, root
}

// footageFixture registers an owner, claims a camera, and writes one clip.
func footageFixture(t *testing.T) (h http.Handler, st *store.Store, access, acct, key, clipID string) {
	t.Helper()
	h, st, root := newFootageServer(t)
	access, _ = register(t, h, "footage-owner")
	acct, _ = tenantIDs(t, h, access)

	key = "camera:front"
	// Claiming is what makes the account the owner of this device key, and the
	// grant endpoint refuses a camera the account does not own.
	me := userIDOf(t, h, access)
	if err := st.ClaimDevice(t.Context(), key, acct, me, "Front gate"); err != nil {
		t.Fatal(err)
	}

	rel := filepath.Join(acct, key, "2026-01-01", "1000-2s.mp4")
	full := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
		t.Fatal(err)
	}
	body := []byte("not a real mp4, but real bytes")
	if err := os.WriteFile(full, body, 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := st.RecordClip(t.Context(), store.Clip{
		AccountID: acct, DeviceKey: key, StartedAt: 1000,
		DurationS: 2, SizeBytes: int64(len(body)), RelPath: rel,
	})
	if err != nil {
		t.Fatal(err)
	}
	return h, st, access, acct, key, c.ID
}

// The rule the whole design rests on: an account OWNER cannot watch without a
// grant. If this ever passes, `camera:view` has quietly become a role.
func TestOwnerCannotPlayWithoutAGrant(t *testing.T) {
	h, _, access, acct, key, clipID := footageFixture(t)
	rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/cameras/"+key+"/clips/"+clipID, access, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("owner without camera:view got %d, want 403", rec.Code)
	}
}

func TestPlaybackServesTheClipToAGrantedMember(t *testing.T) {
	h, st, access, acct, key, clipID := footageFixture(t)
	me := userIDOf(t, h, access)
	if err := st.GrantCameraView(t.Context(), acct, me, key, me, nil, nil); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/v1/accounts/"+acct+"/cameras/"+key+"/clips/"+clipID, nil)
	req.Header.Set("Authorization", "Bearer "+access)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("granted member got %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Errorf("Content-Type %q, want video/mp4", ct)
	}
	// Footage must not sit in a shared cache.
	if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Errorf("Cache-Control %q, want private, no-store", cc)
	}
	if rec.Body.Len() == 0 {
		t.Error("no bytes served")
	}
	// And the watching was recorded, which is the half that makes the
	// permission defensible rather than merely present.
	rows, err := st.CameraAccessLog(t.Context(), acct, 10)
	if err != nil {
		t.Fatal(err)
	}
	var played bool
	for _, r := range rows {
		if r.DeviceKey == key && r.Action == store.CameraViewAction {
			played = true
		}
	}
	if !played {
		t.Error("playback was served with no audit row; §2.5's claim is that watching is auditable")
	}
}

// A refused attempt is recorded too — "who tried and could not" is worth as
// much as who did.
func TestARefusedPlaybackIsAudited(t *testing.T) {
	h, st, access, acct, key, clipID := footageFixture(t)
	doJSON(t, h, "GET", "/v1/accounts/"+acct+"/cameras/"+key+"/clips/"+clipID, access, nil)
	rows, err := st.CameraAccessLog(t.Context(), acct, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("a refused playback left no audit row")
	}
}

// §2.6: gone and never-existed are different answers, and this is the one place
// the difference is the entire point.
func TestAnExpiredClipIs410WithItsReason(t *testing.T) {
	h, st, access, acct, key, clipID := footageFixture(t)
	me := userIDOf(t, h, access)
	if err := st.GrantCameraView(t.Context(), acct, me, key, me, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := st.MarkClipDeleted(t.Context(), clipID, store.ClipExpired); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/v1/accounts/"+acct+"/cameras/"+key+"/clips/"+clipID, nil)
	req.Header.Set("Authorization", "Bearer "+access)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("expired clip got %d, want 410 — a dropped evening must not read as never recorded", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["deleted_why"] != store.ClipExpired {
		t.Errorf("410 body says deleted_why=%v, want %q", out["deleted_why"], store.ClipExpired)
	}
}

// A clip id belonging to another camera must not be readable through a camera
// the caller DOES have a grant for.
func TestAClipCannotBeReadThroughADifferentCamera(t *testing.T) {
	h, st, access, acct, key, clipID := footageFixture(t)
	me := userIDOf(t, h, access)
	// Granted on a different camera, and that camera is claimed too.
	other := "camera:hallway"
	if err := st.ClaimDevice(t.Context(), other, acct, me, "Hallway"); err != nil {
		t.Fatal(err)
	}
	if err := st.GrantCameraView(t.Context(), acct, me, other, me, nil, nil); err != nil {
		t.Fatal(err)
	}
	_ = key

	rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/cameras/"+other+"/clips/"+clipID, access, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("a clip from another camera returned %d through a camera the caller may view, want 404", rec.Code)
	}
}
