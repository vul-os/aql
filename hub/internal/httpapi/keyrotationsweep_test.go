package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// The key-rotation sweep, which was at 0% while the dispatch and completion
// logic under it was well covered.
//
// # The property that nothing else could ever notice
//
// RunKeyRotationSweep sweeps ONCE BEFORE its first tick, and its doc comment is
// entirely about why: a hub restarting mid-rotation is exactly the case where
// controllers are left pinning a key nobody is trying to move them off. Reorder
// the loop so the select comes first and every restart stalls the rotation for
// keyRotationSweepInterval — five minutes — with an open rotation meaning a
// superseded private key still on disk for that long.
//
// Nothing else in the suite would catch that. The interval is five minutes, so
// a test that merely waited would pass either way given enough patience and
// hang either way without it. What distinguishes the two is whether ANY progress
// happens promptly, which is what this asserts.
func TestTheSweepRunsOnceBeforeWaitingForItsFirstTick(t *testing.T) {
	srv, st, ks, ids := rotationServer(t, 2)
	ctx := context.Background()

	oldPub := ks.PublicKeyB64()
	newPub, err := ks.Rotate()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.BeginKeyRotation(ctx, store.NewID(), oldPub, newPub, "test"); err != nil {
		t.Fatal(err)
	}

	// Every controller has already moved to the new key, but the rotation was
	// never closed — the hub went down between the last ack and the completion.
	// Written straight to the pins rather than through noteRepairAck, because
	// that path completes the rotation itself and would leave nothing for the
	// sweep to do; this reproduces the restart, which is the case the sweep
	// exists for.
	for _, id := range ids {
		if _, err := st.DB().Exec(
			`UPDATE device_key_pins SET pinned_pub = ?, pending_nonce = NULL WHERE device_id = ?`,
			newPub, id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.OpenKeyRotation(ctx); err != nil {
		t.Fatalf("the fixture is wrong: the rotation must still be open before the sweep (%v)", err)
	}

	// Cancel almost immediately. With the sweep before the select this still
	// completes; with it after, nothing happens for five minutes.
	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		srv.RunKeyRotationSweep(runCtx)
	}()
	time.Sleep(150 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RunKeyRotationSweep did not return within 5s of cancellation")
	}

	if _, err := st.OpenKeyRotation(ctx); err == nil {
		t.Fatal("the rotation is still open after the sweep ran. Every controller had " +
			"already moved to the new key, so the first sweep should have closed it — " +
			"which it only does if the sweep runs BEFORE the first tick. Otherwise a hub " +
			"restarted mid-rotation leaves a superseded private key on disk for another " +
			"five minutes.")
	}
}

// A sweep with no rotation in flight does nothing and, in particular, does not
// panic.
//
// RunKeyRotationSweep is always on and runs against every hub on every
// interval, so the overwhelmingly common case is that there is no rotation at
// all. OpenKeyRotation returns a zero KeyRotation with ErrNoOpenRotation there;
// the sweep's only guard is that error check, and everything after it uses the
// value. If that contract ever became "nil, nil" — a natural-looking change if
// the return type became a pointer — the very next sweep on every hub in the
// fleet would dereference it, in a background goroutine, five minutes after
// boot.
func TestASweepWithNoRotationInFlightIsAQuietNoOp(t *testing.T) {
	srv, st, _, _ := rotationServer(t, 1)
	ctx := context.Background()

	if _, err := st.OpenKeyRotation(ctx); err == nil {
		t.Fatal("the fixture is wrong: no rotation should be open here")
	}
	// Must not panic, must not block.
	srv.sweepKeyRotation(ctx)

	if _, err := st.OpenKeyRotation(ctx); err == nil {
		t.Error("a sweep with nothing to do created or opened a rotation")
	}
}

// A rotation with a controller still on the old key is left open.
//
// The control. Everything above is satisfied by a sweep that closes rotations
// unconditionally, which would be much worse than one that never closes them:
// completion destroys the previous signing key, so closing early strands any
// controller still pinning it — it would reject every command the hub sends and
// there would no longer be a key to sign a repair with.
func TestTheSweepLeavesARotationOpenWhileAControllerStillPinsTheOldKey(t *testing.T) {
	srv, st, ks, ids := rotationServer(t, 2)
	ctx := context.Background()

	oldPub := ks.PublicKeyB64()
	newPub, err := ks.Rotate()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.BeginKeyRotation(ctx, store.NewID(), oldPub, newPub, "test"); err != nil {
		t.Fatal(err)
	}
	// Only the first controller moved.
	if _, err := st.DB().Exec(
		`UPDATE device_key_pins SET pinned_pub = ?, pending_nonce = NULL WHERE device_id = ?`,
		newPub, ids[0]); err != nil {
		t.Fatal(err)
	}

	srv.sweepKeyRotation(ctx)

	if _, err := st.OpenKeyRotation(ctx); err != nil {
		t.Fatalf("the sweep closed a rotation with a controller still on the old key (%v). "+
			"Completion destroys the previous signing key, so that controller would reject "+
			"every command and there would be no key left to sign its repair.", err)
	}
}
