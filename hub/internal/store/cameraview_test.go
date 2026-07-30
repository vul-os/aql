package store

// The rule this file exists to hold: `camera:view` is NOT a role.
//
// docs/CAMERA-RETENTION.md §2.4 breaks this product's own pattern on purpose —
// everywhere else admin means "can configure the thing", and here it would mean
// "can watch the other residents". An owner who has not been granted it cannot
// watch, and a test says so, because that is precisely the check a future
// refactor would "simplify" into a role lookup.

import (
	"context"
	"testing"
)

func viewFixture(t *testing.T) (*Store, context.Context, string, string) {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "owner@x.com", "hash", "O", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, _, err := s.CreateAccountWithOwner(ctx, u.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	return s, ctx, acct.ID, u.ID
}

func TestCameraViewIsNotImpliedByOwnership(t *testing.T) {
	s, ctx, acct, owner := viewFixture(t)
	// The account's own OWNER, with no grant.
	ok, err := s.MayViewCamera(ctx, acct, owner, "camera:front", now())
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("the account owner could watch without a camera:view grant — " +
			"§2.4 requires this permission NOT be implied by owner or admin")
	}
}

func TestCameraViewGrantAndRevoke(t *testing.T) {
	s, ctx, acct, owner := viewFixture(t)
	if err := s.GrantCameraView(ctx, acct, owner, "camera:front", owner, nil, nil); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:front", now()); !ok {
		t.Fatal("a granted member cannot watch")
	}
	// Per CAMERA, not per account: the grant on one camera must not open another.
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:hallway", now()); ok {
		t.Error("a grant on one camera allowed watching a different one; the " +
			"permission is per camera precisely because a doorbell and a bedroom " +
			"hallway are not the same permission")
	}
	if err := s.RevokeCameraView(ctx, acct, owner, "camera:front"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:front", now()); ok {
		t.Error("a revoked grant still allows watching")
	}
	// The revoked row stays listed: "who could watch, between when and when" has
	// to stay answerable.
	grants, err := s.CameraViewGrants(ctx, acct)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].RevokedAt == nil {
		t.Errorf("revoked grants must remain listed, got %+v", grants)
	}
}

// §2.4: "An investigation is usually bounded and the permission should be too."
// The window is evaluated on read, so a grant that has run out stops working
// whether or not anything has swept it away.
func TestCameraViewWindowIsEnforcedOnRead(t *testing.T) {
	s, ctx, acct, owner := viewFixture(t)
	start := now() + 3600
	end := now() + 7200
	if err := s.GrantCameraView(ctx, acct, owner, "camera:front", owner, &start, &end); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:front", now()); ok {
		t.Error("a grant whose window has not opened yet already allows watching")
	}
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:front", start+60); !ok {
		t.Error("a grant inside its window does not allow watching")
	}
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:front", end); ok {
		t.Error("a grant is still live at its own end instant; the window is half-open")
	}
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:front", end+1); ok {
		t.Error("an expired grant still allows watching")
	}
}

// Re-granting replaces rather than stacks. Two overlapping grants with different
// windows is a question about which governs, and there is no good answer.
func TestReGrantingReplacesTheWindow(t *testing.T) {
	s, ctx, acct, owner := viewFixture(t)
	past := now() - 100
	if err := s.GrantCameraView(ctx, acct, owner, "camera:front", owner, nil, &past); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:front", now()); ok {
		t.Fatal("the expired grant is live")
	}
	if err := s.GrantCameraView(ctx, acct, owner, "camera:front", owner, nil, nil); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.MayViewCamera(ctx, acct, owner, "camera:front", now()); !ok {
		t.Error("re-granting did not replace the expired window")
	}
	grants, _ := s.CameraViewGrants(ctx, acct)
	if len(grants) != 1 {
		t.Errorf("re-granting stacked into %d rows; it must replace", len(grants))
	}
}
