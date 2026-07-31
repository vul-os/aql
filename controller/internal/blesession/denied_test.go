package blesession_test

import (
	"encoding/json"
	"testing"

	"github.com/vul-os/aql/controller/internal/blesession"
	"github.com/vul-os/aql/controller/internal/framing"
	"github.com/vul-os/aql/controller/internal/grants"
)

// Both transports must record an ATTRIBUTABLE refusal.
//
// proto/events.md lists `denied` as the kind that drives security alerting, and
// the grant path emitted one only for a hardware failure after verification had
// already passed. A grant refused at the gate — wrong gate, outside its window,
// expired, revoked — left no trace anywhere: the person whose access was taken
// away is turned away and the operator has no record of it.
//
// This covers BLE, which is the transport with no hub in the loop at all and so
// the last one that should record nothing. The LAN half is in lanserver.
func TestBLERecordsAnAttributableRefusal(t *testing.T) {
	valid, env, x := fixture(t)

	// Refuse it for a reason reached only AFTER the signature verifies, so the
	// refusal is attributable. Lockdown is the simplest such reason that needs
	// no fixture surgery... except lockdown is checked BEFORE the signature, so
	// this uses a wrong device id, which is step 5.
	denyEnv := func() grants.Env {
		e := env()
		e.DeviceID = "some-other-controller"
		return e
	}

	conn := &memConn{}
	var gotID, gotReason string
	calls := 0
	sess := blesession.New(x, denyEnv, conn, nil, nil)
	sess.OnDenied = func(grantID, reason string) {
		calls++
		gotID, gotReason = grantID, reason
	}

	var ch grants.Challenge
	if err := json.Unmarshal(valid.Transcript.Challenge, &ch); err != nil {
		t.Fatal(err)
	}
	feed := func(msg []byte) {
		t.Helper()
		chunks, err := framing.Chunk(msg, 182)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range chunks {
			sess.HandleChunk(c)
		}
	}
	feed(valid.Transcript.Open.Object)
	feed(valid.Transcript.Proof.Object)

	if calls != 1 {
		t.Fatalf("OnDenied called %d times, want 1 — a refusal at the one gate with no hub "+
			"watching is the last one that should go unrecorded", calls)
	}
	if gotReason != "wrong_device" {
		t.Errorf("reason = %q, want wrong_device", gotReason)
	}
	if gotID == "" {
		t.Error("the refusal names no grant, so an operator cannot tell whose access was refused")
	}
}

// A refusal made BEFORE the signature verifies must record NOTHING.
//
// The audit queue is a bounded ring that evicts the oldest normal event when
// full. Recording unauthenticated refusals would hand anyone within reach of
// the gate a write into it: flood it with garbage and real events fall out the
// back. This is the guard against that, and it is the reason the exchange sets
// no grant id until the signature has passed.
func TestAnUnauthenticatedRefusalIsNotRecorded(t *testing.T) {
	_, env, x := fixture(t)
	conn := &memConn{}
	calls := 0
	sess := blesession.New(x, env, conn, nil, nil)
	sess.OnDenied = func(string, string) { calls++ }

	// Garbage that cannot be a signed grant.
	for _, junk := range [][]byte{
		[]byte(`{"v":0,"typ":"grant.open","grant":{"grant_id":"forged"},"access_point":"main"}`),
		[]byte(`{"v":0,"typ":"grant.proof","grant_id":"forged","cnonce":"x","ts":1}`),
	} {
		chunks, err := framing.Chunk(junk, 182)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range chunks {
			sess.HandleChunk(c)
		}
	}
	if calls != 0 {
		t.Errorf("OnDenied called %d times for unsigned garbage — anyone at the gate could "+
			"flood the audit ring and push real events out of it", calls)
	}
}
