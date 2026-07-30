package store

// What counts as proof that a controller's clock is fresh.
//
// The hub needs this because the controller refuses EVERY offline grant once
// its own clock is more than fourteen days stale, at the gate, during the
// outage those grants exist for. Nothing on the hub could see that coming.
//
// The tempting signals are both wrong:
//
//   · `devices.last_seen_at` is stamped on every long-poll request, so a
//     controller whose clock has not moved in a month reads as seen a minute
//     ago.
//   · An ack's `result` is "ok" for a ping AND for a config, so keying on it
//     counts a config acknowledgement as a clock sync.
//
// Both are right most of the time and wrong exactly when an operator relies on
// them. Only an ack whose NONCE matches a ping the hub itself minted is proof,
// and that is what these tests hold.

import (
	"context"
	"testing"
)

func clockFixture(t *testing.T) (*Store, context.Context, string, string) {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "clock@x.com", "hash", "C", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := s.CreateAccountWithOwner(ctx, u.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, "Gate", "hash-1", now()+3600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE devices SET paired_at = ?, public_key = 'x', status = 'active' WHERE id = ?`,
		now(), d.ID); err != nil {
		t.Fatal(err)
	}
	return s, ctx, acct.ID, d.ID
}

func TestAnAckForTheDispatchedPingProvesASync(t *testing.T) {
	s, ctx, acct, dev := clockFixture(t)

	// Before any ping, the honest answer is "never proved" — not "recently
	// synced", and not omitted from the report.
	fresh, err := s.ClockFreshnessByAccount(ctx, acct)
	if err != nil {
		t.Fatal(err)
	}
	if len(fresh) != 1 || fresh[0].SyncedAt != nil {
		t.Fatalf("a controller that has never acked a ping should report nil, got %+v", fresh)
	}

	if err := s.RecordPingDispatched(ctx, dev, "nonce-A"); err != nil {
		t.Fatal(err)
	}
	// Dispatching is not proof. Only the ack is.
	fresh, _ = s.ClockFreshnessByAccount(ctx, acct)
	if fresh[0].SyncedAt != nil {
		t.Error("a ping that was merely SENT was counted as a sync; a queued ping may sit " +
			"unread for hours and proves nothing")
	}

	ok, err := s.RecordAckIfPing(ctx, dev, "nonce-A")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("the ack for the dispatched ping was not recognised")
	}
	fresh, _ = s.ClockFreshnessByAccount(ctx, acct)
	if fresh[0].SyncedAt == nil {
		t.Error("an acked ping did not record a sync")
	}
}

// THE distinction. A config command acks with the same "ok" result a ping does,
// so anything keying on the result would count it — and an operator would be
// told a clock is fresh because somebody retuned a relay.
func TestAnAckForSomeOtherCommandIsNotASync(t *testing.T) {
	s, ctx, acct, dev := clockFixture(t)
	if err := s.RecordPingDispatched(ctx, dev, "ping-nonce"); err != nil {
		t.Fatal(err)
	}

	for _, other := range []string{"open-nonce", "config-nonce", "", "PING-NONCE"} {
		ok, err := s.RecordAckIfPing(ctx, dev, other)
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			t.Errorf("an ack for nonce %q was counted as a clock sync", other)
		}
	}
	fresh, _ := s.ClockFreshnessByAccount(ctx, acct)
	if fresh[0].SyncedAt != nil {
		t.Error(`a non-ping ack recorded a sync.

A ping and a config both ack with result "ok". Keying on the result rather than
the nonce is right most of the time and wrong exactly when an operator is
relying on it.`)
	}
}

// An ack that arrives twice, or long after its nonce was superseded, must not
// resurrect a stale proof.
func TestAReplayedOrSupersededAckDoesNotCount(t *testing.T) {
	s, ctx, _, dev := clockFixture(t)

	if err := s.RecordPingDispatched(ctx, dev, "n1"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.RecordAckIfPing(ctx, dev, "n1"); !ok {
		t.Fatal("first ack not recognised")
	}
	// The same ack again: the pending nonce was cleared, so there is nothing to
	// match. A second match would let one ping be counted repeatedly.
	if ok, _ := s.RecordAckIfPing(ctx, dev, "n1"); ok {
		t.Error("a replayed ack was counted a second time")
	}

	// A newer ping supersedes the old nonce, so an ack for the OLD one is no
	// longer proof of anything current.
	if err := s.RecordPingDispatched(ctx, dev, "n2"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.RecordAckIfPing(ctx, dev, "n1"); ok {
		t.Error("an ack for a superseded ping nonce was counted")
	}
	if ok, _ := s.RecordAckIfPing(ctx, dev, "n2"); !ok {
		t.Error("the current ping's ack was not recognised")
	}
}

// The report must include a controller with no record at all. Omitting it would
// hide the worst case — one that has never demonstrably synced since pairing.
func TestTheReportIncludesControllersWithNoRecord(t *testing.T) {
	s, ctx, acct, dev := clockFixture(t)

	fresh, err := s.ClockFreshnessByAccount(ctx, acct)
	if err != nil {
		t.Fatal(err)
	}
	if len(fresh) != 1 || fresh[0].DeviceID != dev {
		t.Fatalf("a paired controller with no clock-sync row was omitted: %+v", fresh)
	}
	if fresh[0].Label != "Gate" {
		t.Errorf("label = %q; an operator needs to know WHICH controller", fresh[0].Label)
	}

	// And never-synced sorts first, because it is the one to act on.
	if err := s.RecordPingDispatched(ctx, dev, "n"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecordAckIfPing(ctx, dev, "n"); err != nil {
		t.Fatal(err)
	}
	d2, err := s.CreateDeviceWithClaim(ctx, acct, mustLocation(t, s, ctx, acct), "Side", "h2", now()+3600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE devices SET paired_at = ?, public_key = 'y', status = 'active' WHERE id = ?`,
		now(), d2.ID); err != nil {
		t.Fatal(err)
	}
	fresh, _ = s.ClockFreshnessByAccount(ctx, acct)
	if len(fresh) != 2 {
		t.Fatalf("want 2 controllers, got %d", len(fresh))
	}
	if fresh[0].SyncedAt != nil {
		t.Error("the never-synced controller does not sort first; it is the one to act on")
	}
}

func mustLocation(t *testing.T, s *Store, ctx context.Context, accountID string) string {
	t.Helper()
	locs, err := s.LocationsByAccount(ctx, accountID)
	if err != nil || len(locs) == 0 {
		t.Fatalf("no location: %v", err)
	}
	return locs[0].ID
}
