package httpapi

// Playback and the permission in front of it.
//
// The properties pinned here are the ones whose failure hands somebody's
// footage to the wrong person, or hands it to the right person without a
// record. Both are worse than the feature not existing.

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/vul-os/aql/hub/internal/recording"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// ---------------------------------------------------------------------------
// Live view
// ---------------------------------------------------------------------------
//
// The clip route is thoroughly covered above. The LIVE route repeats the same
// two security properties in its own code — the camera:view check and the audit
// write — and had no tests at all, because Config.Live is nil in every harness
// and the handler returns 404 before reaching any of it.
//
// That is the identical shape as the chat actuation gap: a rule proved on one
// path and duplicated, unexercised, on another. §2.4 and §2.5 are the whole
// defensibility of footage in this product, and a live stream is the more
// sensitive of the two surfaces — it is watching someone now, rather than
// afterwards.

// liveFootageServer is footageFixture with a broadcaster attached.
func liveFootageServer(t *testing.T) (http.Handler, *store.Store, *recording.Broadcaster, string, string, string) {
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
	live := recording.NewBroadcaster()
	s := New(Config{
		Version:        "test",
		JWTSecret:      []byte("0123456789abcdef0123456789abcdef"),
		RecordingsRoot: filepath.Join(dir, "recordings"),
		Live:           live,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := s.Router()

	access, _ := register(t, h, "live-owner")
	acct, _ := tenantIDs(t, h, access)
	key := "camera:front"
	me := userIDOf(t, h, access)
	if err := st.ClaimDevice(t.Context(), key, acct, me, "Front gate"); err != nil {
		t.Fatal(err)
	}
	return h, st, live, access, acct, key
}

// The rule §2.4 rests on, restated on the live path: owning the account is not
// permission to watch.
func TestOwnerCannotWatchLiveWithoutAGrant(t *testing.T) {
	h, st, _, access, acct, key := liveFootageServer(t)

	// A DEADLINE, not a background context. If the grant check ever regresses,
	// this request is served — and the live handler streams until its context
	// ends, so a plain httptest request would HANG rather than fail. Found by
	// tampering: the first version of this test hung for ten minutes instead of
	// reporting that an owner had just watched a camera without permission. A
	// test that hangs on a real defect reads as an infrastructure problem.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req := httptest.NewRequest("GET", "/v1/accounts/"+acct+"/cameras/"+key+"/live", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+access)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("owner watched live without a grant: %d", rec.Code)
	}
	// And the attempt is recorded — §2.5's "who tried and could not".
	rows, err := st.CameraAccessLog(t.Context(), acct, 10)
	if err != nil {
		t.Fatal(err)
	}
	// Distinguished by the reason the handler records, since the row shape
	// exposes Detail rather than the allowed flag. Matching on the REASON is
	// the point: a row that merely exists would also be written by a
	// successful view, and this test must not pass on one of those.
	found := false
	for _, r := range rows {
		if r.DeviceKey == key && r.Action == store.CameraViewAction &&
			strings.Contains(r.Detail, "no_camera_view_grant") && strings.Contains(r.Detail, "live") {
			found = true
		}
	}
	if !found {
		t.Errorf("a refused live view was not audited with its reason: %+v", rows)
	}
}

// A granted member gets the stream, the watching is audited, and the response
// says how far behind live it is.
func TestAGrantedMemberWatchesLiveAndItIsAudited(t *testing.T) {
	h, st, live, access, acct, key := liveFootageServer(t)
	me := userIDOf(t, h, access)
	if err := st.GrantCameraView(t.Context(), acct, me, key, me, nil, nil); err != nil {
		t.Fatal(err)
	}

	// The handler streams until the request context ends, so the request
	// carries a deadline and the assertions run on what arrived before it.
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("GET", "/v1/accounts/"+acct+"/cameras/"+key+"/live", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+access)
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		h.ServeHTTP(rec, req)
		close(done)
	}()

	// Publish after the subscriber is attached. Retried rather than slept on:
	// a fixed sleep is a race dressed as a delay.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		live.PublishFragment(key, []byte("fragment-bytes"))
		if rec.Body.Len() > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	<-done

	if rec.Code != http.StatusOK {
		t.Fatalf("granted member got %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Errorf("Content-Type %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Errorf("Cache-Control %q — live footage must not sit in a shared cache", cc)
	}
	// The honesty header: this stream is a window behind, and says so in a
	// number rather than leaving it to the UI.
	if d := rec.Header().Get("X-Aql-Live-Delay-Seconds"); d == "" || d == "0" {
		t.Errorf("X-Aql-Live-Delay-Seconds %q — the delay is real and must be stated", d)
	}
	if rec.Body.Len() == 0 {
		t.Error("no fragment reached the viewer")
	}

	rows, err := st.CameraAccessLog(t.Context(), acct, 10)
	if err != nil {
		t.Fatal(err)
	}
	watched := false
	for _, r := range rows {
		if r.DeviceKey == key && r.Action == store.CameraViewAction &&
			strings.Contains(r.Detail, "live") && !strings.Contains(r.Detail, "reason") {
			watched = true
		}
	}
	if !watched {
		t.Errorf("a live view was served with no audit row: %+v", rows)
	}
}

// A camera belonging to another account is not watchable, even with a grant on
// your own — the clip path has this test and the live path did not.
func TestLiveCannotBeWatchedThroughAnotherAccount(t *testing.T) {
	h, st, _, access, acct, key := liveFootageServer(t)
	me := userIDOf(t, h, access)
	if err := st.GrantCameraView(t.Context(), acct, me, key, me, nil, nil); err != nil {
		t.Fatal(err)
	}
	other, _ := register(t, h, "live-stranger")
	otherAcct, _ := tenantIDs(t, h, other)

	// Same reason as above: a regression here would stream rather than refuse.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req := httptest.NewRequest("GET", "/v1/accounts/"+otherAcct+"/cameras/"+key+"/live", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+access)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("watched a camera through another account: %d", rec.Code)
	}
}

// No broadcaster configured is a 404 and not a stream — the default deployment.
func TestLiveIsNotConfiguredByDefault(t *testing.T) {
	h, st, access, acct, key, _ := footageFixture(t)
	me := userIDOf(t, h, access)
	if err := st.GrantCameraView(t.Context(), acct, me, key, me, nil, nil); err != nil {
		t.Fatal(err)
	}
	rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/cameras/"+key+"/live", access, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("live with no broadcaster: %d, want 404", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// The permission-management routes
// ---------------------------------------------------------------------------
//
// Every camera test above issues its grant by calling the store directly. The
// ROUTES that grant, revoke, list and expose the access log had no test at all
// — found by asking which handlers a coverage run never enters, after the same
// question produced real defects on the chat and live paths.
//
// These are the routes §2.4 and §2.5 make their claims about: granting is "an
// admin action and lands in the hash-chained admin_audit_log, so 'who gave
// themselves the ability to watch, and when' is answerable later", and "every
// member of the account can read the camera-access log — not just admins".
// Both were unverified.

func TestGrantingCameraViewIsAdminOnlyAndAudited(t *testing.T) {
	h, st, access, acct, key, _ := footageFixture(t)
	memberID, memberAccess := inviteMember(t, h, st, access, acct, "cam-member@x.com", "+27821112222")

	// A plain member cannot hand out the ability to watch.
	rec, _ := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/camera-view-grants", memberAccess,
		map[string]any{"user_id": memberID, "device_key": key})
	if rec.Code == http.StatusOK {
		t.Fatal("a non-admin granted camera:view")
	}

	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/camera-view-grants", access,
		map[string]any{"user_id": memberID, "device_key": key})
	if rec.Code != http.StatusOK {
		t.Fatalf("admin grant: %d %v", rec.Code, out)
	}

	// §2.4: "who gave themselves the ability to watch, and when" has to be
	// answerable, which means the grant is in the ADMIN audit log — a different
	// log from the camera-access one, and the reason the claim is about
	// tamper-evidence rather than convenience.
	// Read from admin_audit_log directly: CameraAccessLog deliberately selects
	// only the WATCHING actions, so a grant is not in it — granting is an admin
	// act and belongs in the admin trail, which is the log §2.4's claim is about.
	if n := adminAuditRows(t, st, "camera_view_grant", memberID); n != 1 {
		t.Errorf("granting camera:view left %d admin-audit rows, want 1", n)
	}

	// And it works: the granted member can now list footage.
	rec, _ = doJSON(t, h, "GET", "/v1/accounts/"+acct+"/cameras/"+key+"/clips", memberAccess, nil)
	if rec.Code != http.StatusOK {
		t.Errorf("granted member cannot list clips: %d", rec.Code)
	}
}

// A grant naming a camera this account does not own is refused as not-found,
// so the route cannot be used to learn that some other account has a device.
func TestAGrantCannotNameAnotherAccountsCamera(t *testing.T) {
	h, st, access, acct, _, _ := footageFixture(t)
	memberID, _ := inviteMember(t, h, st, access, acct, "cam-member2@x.com", "+27821113333")

	rec, _ := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/camera-view-grants", access,
		map[string]any{"user_id": memberID, "device_key": "camera:someone-elses"})
	if rec.Code != http.StatusNotFound {
		t.Errorf("granting on an unowned camera: %d, want 404", rec.Code)
	}
}

// A window that ends before it starts would grant nothing, silently.
func TestABackwardsGrantWindowIsRefused(t *testing.T) {
	h, st, access, acct, key, _ := footageFixture(t)
	memberID, _ := inviteMember(t, h, st, access, acct, "cam-member3@x.com", "+27821114444")

	rec, _ := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/camera-view-grants", access,
		map[string]any{"user_id": memberID, "device_key": key,
			"starts_at": 2000, "ends_at": 1000})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("a backwards window was accepted: %d", rec.Code)
	}
}

// Revoking withdraws the ability and is audited too.
func TestRevokingCameraViewStopsAccessAndIsAudited(t *testing.T) {
	h, st, access, acct, key, clipID := footageFixture(t)
	memberID, memberAccess := inviteMember(t, h, st, access, acct, "cam-member4@x.com", "+27821115555")

	doJSON(t, h, "POST", "/v1/accounts/"+acct+"/camera-view-grants", access,
		map[string]any{"user_id": memberID, "device_key": key})
	if rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/cameras/"+key+"/clips/"+clipID, memberAccess, nil); rec.Code != http.StatusOK {
		t.Fatalf("granted member cannot play: %d", rec.Code)
	}

	rec, out := doJSON(t, h, "DELETE",
		"/v1/accounts/"+acct+"/camera-view-grants?user_id="+memberID+"&device_key="+key, access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke: %d %v", rec.Code, out)
	}
	if rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/cameras/"+key+"/clips/"+clipID, memberAccess, nil); rec.Code == http.StatusOK {
		t.Error("a revoked member can still watch")
	}

	if n := adminAuditRows(t, st, "camera_view_revoke", memberID); n != 1 {
		t.Errorf("revoking camera:view left %d admin-audit rows, want 1", n)
	}
}

// The listing distinguishes "not yet" from "no longer" — the handler sends
// starts_at, ends_at and revoked separately for exactly that reason.
func TestTheGrantListingShowsWhyAGrantIsNotActive(t *testing.T) {
	h, st, access, acct, key, _ := footageFixture(t)
	memberID, _ := inviteMember(t, h, st, access, acct, "cam-member5@x.com", "+27821116666")

	doJSON(t, h, "POST", "/v1/accounts/"+acct+"/camera-view-grants", access,
		map[string]any{"user_id": memberID, "device_key": key})
	doJSON(t, h, "DELETE",
		"/v1/accounts/"+acct+"/camera-view-grants?user_id="+memberID+"&device_key="+key, access, nil)

	rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/camera-view-grants", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %v", rec.Code, out)
	}
	grants, _ := out["grants"].([]any)
	if len(grants) == 0 {
		t.Fatal("a revoked grant vanished from the listing — it is the record of who once could watch")
	}
	g := grants[0].(map[string]any)
	if g["revoked"] != true {
		t.Errorf("revoked grant not marked: %+v", g)
	}
}

// §2.5's unusual claim, and the one most worth pinning because it breaks the
// pattern of the rest of the product: EVERY member can read the camera-access
// log, not just admins. "The audit trail for footage is the one log whose
// subject has the strongest claim to it."
func TestEveryMemberCanReadTheCameraAccessLog(t *testing.T) {
	h, st, access, acct, key, clipID := footageFixture(t)
	memberID, memberAccess := inviteMember(t, h, st, access, acct, "cam-member6@x.com", "+27821117777")

	// The admin grants themselves the ability and watches. That is exactly the
	// event a resident has a claim to see.
	me := userIDOf(t, h, access)
	doJSON(t, h, "POST", "/v1/accounts/"+acct+"/camera-view-grants", access,
		map[string]any{"user_id": me, "device_key": key})
	doJSON(t, h, "GET", "/v1/accounts/"+acct+"/cameras/"+key+"/clips/"+clipID, access, nil)

	rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/camera-access-log", memberAccess, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("a plain member cannot read the camera-access log: %d — §2.5 says they can", rec.Code)
	}
	rows, _ := out["access"].([]any)
	if len(rows) == 0 {
		t.Fatal("the log is empty although a clip was just watched")
	}
	_ = memberID

	// And a non-member of the account still cannot.
	strangerAccess, _ := register(t, h, "cam-stranger@x.com")
	if rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/camera-access-log", strangerAccess, nil); rec.Code == http.StatusOK {
		t.Error("a non-member read another account's camera-access log")
	}
}

// adminAuditRows counts hash-chained admin-audit rows for an action mentioning
// a subject. Reads the table rather than a store helper because the helpers
// filter to particular action sets, and what is being verified here is that the
// row reached the trail at all.
func adminAuditRows(t *testing.T, st *store.Store, action, mentions string) int {
	t.Helper()
	rows, err := st.DB().Query(
		`SELECT count(*) FROM admin_audit_log WHERE action = ? AND detail LIKE ?`,
		action, "%"+mentions+"%")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	if rows.Next() {
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
	}
	return n
}
