package httpapi

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// Dispatching the repairs that carry a fleet onto a new gateway key.
//
// The store's half of rotation is well tested — what a controller pins, which
// nonce moves it, when a rotation may complete. The ORCHESTRATION had no tests
// at all: dispatchRepairs, noteRepairAck and the sweep were at zero coverage.
//
// The property that matters most is one line of comment in dispatchRepairs:
//
//	Signed with the key this controller PINS, which during a rotation is the
//	retained one. A repair signed with the new key is a repair the controller
//	cannot verify — it has never seen that key.
//
// Getting that wrong compiles, signs, dispatches and looks entirely healthy.
// Every controller would reject its repair, no rotation would ever complete,
// and the fleet would keep running on the retained key until someone removed it
// — at which point nothing opens. It is only visible by verifying the envelope
// against the key the controller actually holds, which is what this does.

func rotationServer(t *testing.T, deviceCount int) (*Server, *store.Store, *keys.Keys, []string) {
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
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef")},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))

	ctx := context.Background()
	u, err := st.CreateUser(ctx, "rot@x.com", "hash", "R", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := st.CreateAccountWithOwner(ctx, u.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for i := 0; i < deviceCount; i++ {
		d, err := st.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, "Gate", "hash-"+string(rune('a'+i)), 1<<40)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := st.DB().Exec(
			`UPDATE devices SET paired_at = ?, public_key = 'x', status = 'active' WHERE id = ?`,
			1, d.ID); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, d.ID)
	}
	return srv, st, ks, ids
}

func mustPub(t *testing.T, b64 string) ed25519.PublicKey {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("decode pub %q: %v", b64, err)
	}
	return ed25519.PublicKey(raw)
}

// The one that matters. Every dispatched repair must verify under the key its
// controller pins — the RETAINED key — and must not verify under the new one.
func TestARepairIsSignedWithTheKeyTheControllerPins(t *testing.T) {
	srv, st, ks, ids := rotationServer(t, 2)
	ctx := context.Background()

	oldPub := ks.PublicKeyB64()
	newPub, err := ks.Rotate()
	if err != nil {
		t.Fatal(err)
	}
	if newPub == oldPub {
		t.Fatal("rotation produced the same key")
	}
	rot, err := st.BeginKeyRotation(ctx, store.NewID(), oldPub, newPub, "test")
	if err != nil {
		t.Fatal(err)
	}

	if n := srv.dispatchRepairs(ctx, rot); n != len(ids) {
		t.Fatalf("dispatched %d repairs for %d controllers", n, len(ids))
	}

	// The envelopes the code ACTUALLY dispatched, taken off the queue the
	// controllers are offline on.
	//
	// The first version of this test rebuilt an envelope by calling
	// SignCommandForPin itself and verified that — which is a test of the
	// signer, not of dispatchRepairs. It passed against a tamper that signed
	// every repair with the new key, because the reconstruction still used the
	// pinned one. Reading what was really sent is the only thing that catches
	// it.
	checked := 0
	for _, id := range ids {
		queued := srv.hub.DrainQueue(id)
		if len(queued) != 1 {
			t.Fatalf("controller %s has %d queued commands, want 1", id, len(queued))
		}
		var env keys.Envelope
		if err := json.Unmarshal(queued[0], &env); err != nil {
			t.Fatal(err)
		}
		if env.Cmd != "repair" {
			t.Fatalf("queued %q, want repair", env.Cmd)
		}
		// Verifying under BOTH keys is the point. "Verifies under the retained
		// key" alone would pass if the code somehow signed with both.
		if err := keys.VerifyEnvelope(mustPub(t, oldPub), &env); err != nil {
			t.Errorf("a repair does not verify under the key its controller pins: %v", err)
		}
		if err := keys.VerifyEnvelope(mustPub(t, newPub), &env); err == nil {
			t.Error("a repair verifies under the NEW key — the controller has never seen it, so it would reject this and the rotation would never finish")
		}
		if env.Payload["next_pubkey"] != newPub {
			t.Errorf("repair payload does not carry the new key: %+v", env.Payload)
		}
		checked++
	}
	if checked != len(ids) {
		t.Fatalf("checked %d envelopes for %d controllers", checked, len(ids))
	}
}

// The nonce is recorded BEFORE dispatch. A controller can ack faster than the
// write would otherwise happen, and an ack whose nonce is unrecorded proves
// nothing — the repair would be silently lost for the healthiest controllers.
func TestTheRepairNonceIsRecordedBeforeDispatch(t *testing.T) {
	srv, st, ks, ids := rotationServer(t, 1)
	ctx := context.Background()
	oldPub := ks.PublicKeyB64()
	newPub, err := ks.Rotate()
	if err != nil {
		t.Fatal(err)
	}
	rot, err := st.BeginKeyRotation(ctx, store.NewID(), oldPub, newPub, "test")
	if err != nil {
		t.Fatal(err)
	}
	srv.dispatchRepairs(ctx, rot)

	var nonce string
	if err := st.DB().QueryRow(
		`SELECT COALESCE(pending_nonce, '') FROM device_key_pins WHERE device_id = ?`, ids[0]).
		Scan(&nonce); err != nil {
		t.Fatal(err)
	}
	if nonce == "" {
		t.Error("no repair nonce was recorded — an ack arriving now could not be matched to anything")
	}
}

// A controller already on the new key is not sent another repair.
func TestARepairedControllerIsNotDispatchedAgain(t *testing.T) {
	srv, st, ks, ids := rotationServer(t, 2)
	ctx := context.Background()
	oldPub := ks.PublicKeyB64()
	newPub, _ := ks.Rotate()
	rot, err := st.BeginKeyRotation(ctx, store.NewID(), oldPub, newPub, "test")
	if err != nil {
		t.Fatal(err)
	}
	srv.dispatchRepairs(ctx, rot)

	// Move one controller across, the way an ack would.
	var nonce string
	if err := st.DB().QueryRow(
		`SELECT COALESCE(pending_nonce, '') FROM device_key_pins WHERE device_id = ?`, ids[0]).Scan(&nonce); err != nil {
		t.Fatal(err)
	}
	if _, err := st.RecordRepairAck(ctx, ids[0], nonce, newPub); err != nil {
		t.Fatal(err)
	}

	if n := srv.dispatchRepairs(ctx, rot); n != 1 {
		t.Errorf("dispatched %d repairs, want 1 — a repaired controller was sent another", n)
	}
}

// A rotation with nothing left outstanding completes; one with a controller
// still pinning the old key does not.
func TestARotationCompletesOnlyWhenEveryControllerHasMoved(t *testing.T) {
	srv, st, ks, ids := rotationServer(t, 2)
	ctx := context.Background()
	oldPub := ks.PublicKeyB64()
	newPub, _ := ks.Rotate()
	rot, err := st.BeginKeyRotation(ctx, store.NewID(), oldPub, newPub, "test")
	if err != nil {
		t.Fatal(err)
	}
	srv.dispatchRepairs(ctx, rot)

	ackOne := func(id string) {
		t.Helper()
		var nonce string
		if err := st.DB().QueryRow(
			`SELECT COALESCE(pending_nonce, '') FROM device_key_pins WHERE device_id = ?`, id).Scan(&nonce); err != nil {
			t.Fatal(err)
		}
		srv.noteRepairAck(ctx, id, nonce)
	}

	ackOne(ids[0])
	if _, err := st.OpenKeyRotation(ctx); err != nil {
		t.Fatal("the rotation closed with a controller still pinning the old key")
	}

	ackOne(ids[1])
	if _, err := st.OpenKeyRotation(ctx); err == nil {
		t.Error("every controller has moved and the rotation is still open")
	}
}
