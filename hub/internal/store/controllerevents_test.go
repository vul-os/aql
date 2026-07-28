package store

import (
	"context"
	"testing"
)

// The hub-side half of proto/events.md.
//
// The controller's durability machinery for these events is elaborate — a
// reserved never-evicted queue partition, an fsync'd overflow log, a
// record-before-actuate ordering with its own test — and every bit of it
// terminated in a log line here. These tests hold the receiving end to the
// two things the spec actually promises about it: the event is kept, and
// event_id dedupes a redelivery.

type eventFixture struct {
	s        *Store
	acct     *Account
	loc      *Location
	ap       *AccessPointDetail
	deviceID string
}

func newEventFixture(t *testing.T) *eventFixture {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "owner@events.com", "h", "O", "")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := s.CreateAccountWithOwner(ctx, u.ID, "Event House", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	dev, err := s.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, "gate ctrl", "tokenhash", now()+3600)
	if err != nil {
		t.Fatal(err)
	}
	ap, err := s.CreateAccessPointFull(ctx, acct.ID, loc.ID, "Main gate", "gate", dev.ID, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	return &eventFixture{s: s, acct: acct, loc: loc, ap: ap, deviceID: dev.ID}
}

func redeemed(deviceID, eventID string) ControllerEvent {
	return ControllerEvent{
		EventID:  eventID,
		DeviceID: deviceID,
		Kind:     "grant_redeemed",
		TS:       now(),
		Data:     map[string]any{"grant_id": "g-1", "cnonce": "abcd", "access_point": "main"},
		Sig:      "sig-placeholder",
		Envelope: []byte(`{"typ":"event","kind":"grant_redeemed"}`),
	}
}

// The one that matters. An offline emergency open has no hub in the loop, so
// the controller's event is the ONLY evidence it happened — and it has to
// reach the log a person reads, not just a table.
func TestOfflineGrantRedemptionReachesTheAuditLog(t *testing.T) {
	f := newEventFixture(t)
	ctx := context.Background()

	stored, logID, err := f.s.RecordControllerEvent(ctx, redeemed(f.deviceID, "ev-1"))
	if err != nil {
		t.Fatal(err)
	}
	if !stored {
		t.Fatal("a first-delivery event was not stored")
	}
	if logID == "" {
		t.Fatal("grant_redeemed produced no audit row; an offline open would be invisible")
	}

	logs, err := f.s.AccessLogsByAccount(ctx, f.acct.ID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("want 1 audit row, got %d", len(logs))
	}
	got := logs[0]
	if got.Source != SourceOfflineGrant {
		t.Errorf("source = %q, want %q — an operator must be able to tell an "+
			"offline redemption from a hub-authorised open", got.Source, SourceOfflineGrant)
	}
	if got.Command != "open" || !got.Success {
		t.Errorf("audit row = %q success=%v, want open/true", got.Command, got.Success)
	}
	if got.AccessPointID != f.ap.ID {
		t.Errorf("audit row points at %q, want the device's access point %q", got.AccessPointID, f.ap.ID)
	}
}

// events.md line 31: "The hub dedupes on event_id." That is the ONLY
// mitigation the spec offers for its two acknowledged delivery gaps (no event
// ack, no sequence number), so it has to be real before anything leans on it.
// Before this change it was false in the strongest sense: nothing was stored,
// so nothing could be deduped.
func TestRedeliveredEventIsDedupedOnEventID(t *testing.T) {
	f := newEventFixture(t)
	ctx := context.Background()

	if _, _, err := f.s.RecordControllerEvent(ctx, redeemed(f.deviceID, "ev-dup")); err != nil {
		t.Fatal(err)
	}
	stored, logID, err := f.s.RecordControllerEvent(ctx, redeemed(f.deviceID, "ev-dup"))
	if err != nil {
		t.Fatalf("a redelivery must be quietly ignored, not an error: %v", err)
	}
	if stored {
		t.Error("the same event_id was stored twice")
	}
	if logID != "" {
		t.Error("a redelivery produced a second audit row")
	}

	logs, err := f.s.AccessLogsByAccount(ctx, f.acct.ID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("one gate opening produced %d audit rows after redelivery", len(logs))
	}
	evs, err := f.s.ControllerEventsByDevice(ctx, f.deviceID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 {
		t.Fatalf("stored %d copies of one event", len(evs))
	}
}

// The audit log is hash-chained (migrations/0007). Rows appended by this path
// must extend that chain like any other, or the first controller event would
// break verification for every row after it.
func TestEventAuditRowsExtendTheTamperEvidentChain(t *testing.T) {
	f := newEventFixture(t)
	ctx := context.Background()

	for _, id := range []string{"ev-a", "ev-b", "ev-c"} {
		if _, _, err := f.s.RecordControllerEvent(ctx, redeemed(f.deviceID, id)); err != nil {
			t.Fatal(err)
		}
	}
	res, err := f.s.VerifyAccessLogHashChain(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK {
		t.Fatalf("controller events broke the audit hash chain: %+v", res)
	}
	if res.RowsChecked < 3 {
		t.Fatalf("chain covers %d rows, want at least the 3 event rows", res.RowsChecked)
	}
}

// A failed actuation is an access event too, and the reason has to survive:
// "the gate was authorised and the hardware refused" is a maintenance signal,
// not a security one, and the log is where the difference shows.
func TestDeniedEventIsLoggedAsAFailureWithItsReason(t *testing.T) {
	f := newEventFixture(t)
	ctx := context.Background()

	ev := redeemed(f.deviceID, "ev-denied")
	ev.Kind = "denied"
	ev.Data = map[string]any{"reason": "hw:relay stuck", "ref": "g-1"}
	if _, _, err := f.s.RecordControllerEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}

	logs, err := f.s.AccessLogsByAccount(ctx, f.acct.ID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("want 1 audit row, got %d", len(logs))
	}
	if logs[0].Success {
		t.Error("a denied event was logged as a success")
	}
	if logs[0].Error != "hw:relay stuck" {
		t.Errorf("error = %q, want the controller's reason", logs[0].Error)
	}
}

// Selectivity. `boot` is worth keeping as evidence but is not an access
// event; putting it in the access log would dilute the one view an operator
// scans after an incident.
func TestBootIsStoredWithoutAnAccessLogRow(t *testing.T) {
	f := newEventFixture(t)
	ctx := context.Background()

	ev := redeemed(f.deviceID, "ev-boot")
	ev.Kind = "boot"
	ev.Data = map[string]any{"fw": "1.2.3", "reason": "start"}
	stored, logID, err := f.s.RecordControllerEvent(ctx, ev)
	if err != nil {
		t.Fatal(err)
	}
	if !stored {
		t.Fatal("boot was not stored")
	}
	if logID != "" {
		t.Error("boot produced an access-log row")
	}
	logs, err := f.s.AccessLogsByAccount(ctx, f.acct.ID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 0 {
		t.Errorf("boot added %d rows to the access log", len(logs))
	}
}

// The access point is resolved from the DEVICE, never from the payload. The
// payload is controller-supplied, and a controller must not be able to write
// audit rows against a gate it does not drive — the data here names a
// different access point on purpose.
func TestAccessPointComesFromTheDeviceNotThePayload(t *testing.T) {
	f := newEventFixture(t)
	ctx := context.Background()

	other, err := f.s.CreateAccessPointFull(ctx, f.acct.ID, f.loc.ID, "Side door", "door", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	ev := redeemed(f.deviceID, "ev-claim")
	ev.Data = map[string]any{"access_point": other.ID, "grant_id": "g-1"}
	if _, _, err := f.s.RecordControllerEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}

	logs, err := f.s.AccessLogsByAccount(ctx, f.acct.ID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("want 1 audit row, got %d", len(logs))
	}
	if logs[0].AccessPointID == other.ID {
		t.Fatal("the event's payload chose the access point; a controller could " +
			"forge audit rows against a gate it does not drive")
	}
	if logs[0].AccessPointID != f.ap.ID {
		t.Fatalf("audit row points at %q, want the device's own AP %q", logs[0].AccessPointID, f.ap.ID)
	}
}

// A device not yet attached to an access point still has its events kept.
// Losing the evidence because the operator has not finished configuring the
// site would be the same defect this whole file exists to fix, one step later.
func TestEventFromAnUnplacedDeviceIsStillStored(t *testing.T) {
	f := newEventFixture(t)
	ctx := context.Background()

	dev, err := f.s.CreateDeviceWithClaim(ctx, f.acct.ID, f.loc.ID, "spare", "tokenhash2", now()+3600)
	if err != nil {
		t.Fatal(err)
	}
	stored, logID, err := f.s.RecordControllerEvent(ctx, redeemed(dev.ID, "ev-unplaced"))
	if err != nil {
		t.Fatal(err)
	}
	if !stored {
		t.Fatal("an unplaced device's event was discarded")
	}
	if logID != "" {
		t.Error("an unplaced device produced an audit row against some other AP")
	}
	evs, err := f.s.ControllerEventsByDevice(ctx, dev.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 {
		t.Fatalf("stored %d events for the unplaced device, want 1", len(evs))
	}
}

// The envelope is stored verbatim so the signature stays re-verifiable later.
// Re-serialising the parsed columns would not reproduce the signed bytes,
// which would leave the stored sig decorative.
func TestSignedEnvelopeIsStoredVerbatim(t *testing.T) {
	f := newEventFixture(t)
	ctx := context.Background()

	raw := []byte(`{"v":0,"typ":"event","event_id":"ev-raw","kind":"grant_redeemed","ts":17,"sig":"zz"}`)
	ev := redeemed(f.deviceID, "ev-raw")
	ev.Envelope = raw
	if _, _, err := f.s.RecordControllerEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}
	evs, err := f.s.ControllerEventsByDevice(ctx, f.deviceID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 {
		t.Fatalf("want 1 event, got %d", len(evs))
	}
	if string(evs[0].Envelope) != string(raw) {
		t.Errorf("envelope round-trip changed the signed bytes:\n got %s\nwant %s", evs[0].Envelope, raw)
	}
}
