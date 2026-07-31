package store

import (
	"context"
	"testing"
)

// rrStore opens a store with one REAL device.
//
// device_id is a foreign key, and a fixture that used a bare string would test
// the queries against a row shape the schema forbids — passing here and failing
// the first time a real controller reported.
func rrStore(t *testing.T) (*Store, context.Context, string) {
	t.Helper()
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "owner-rr@example.test", "x", "Owner", "ZA")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	acct, loc, err := st.CreateAccountWithOwner(ctx, u.ID, "Test Estate", "ZA")
	if err != nil {
		t.Fatalf("CreateAccountWithOwner: %v", err)
	}
	dev, err := st.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, "Front Gate", "hash", 0)
	if err != nil {
		t.Fatalf("CreateDeviceWithClaim: %v", err)
	}
	return st, ctx, dev.ID
}

// "Never told us" and "told us it holds nothing" are different facts, and the
// console shows different things for them. Collapsing them would report a gate
// running firmware that cannot say as one that has confirmed it holds no
// deny-list — the difference between "unknown" and "confirmed empty".
func TestNoReportIsDistinctFromAReportOfZero(t *testing.T) {
	s, ctx, dev := rrStore(t)

	_, ok, err := s.RevocationReportFor(ctx, dev)
	if err != nil {
		t.Fatalf("RevocationReportFor: %v", err)
	}
	if ok {
		t.Fatal("a controller that has reported nothing reads as having reported")
	}

	if err := s.SaveRevocationReport(ctx, dev, 0, 0, 1000); err != nil {
		t.Fatalf("SaveRevocationReport: %v", err)
	}
	rep, ok, err := s.RevocationReportFor(ctx, dev)
	if err != nil {
		t.Fatalf("RevocationReportFor: %v", err)
	}
	if !ok {
		t.Fatal("a controller that reported seq 0 reads as having reported nothing")
	}
	if rep.Seq != 0 {
		t.Errorf("seq = %d, want 0", rep.Seq)
	}
}

// A flaky link can deliver two reports out of order. Letting the older win
// would show a gate falling behind a revocation it had already applied — the
// one thing this table exists to get right.
func TestAnOlderReportDoesNotOverwriteANewerOne(t *testing.T) {
	s, ctx, dev := rrStore(t)
	if err := s.SaveRevocationReport(ctx, dev, 9, 3, 2000); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := s.SaveRevocationReport(ctx, dev, 4, 1, 1000); err != nil {
		t.Fatalf("second (older): %v", err)
	}
	rep, _, err := s.RevocationReportFor(ctx, dev)
	if err != nil {
		t.Fatalf("RevocationReportFor: %v", err)
	}
	if rep.Seq != 9 || rep.Entries != 3 {
		t.Errorf("report = %+v, want the newer one (seq 9, 3 entries)", rep)
	}
}

// A report at the SAME seq is stored: the entry count can legitimately fall as
// entries expire without the sequence moving, and refusing it would freeze a
// stale count on screen.
func TestAReportAtTheSameSeqStillUpdates(t *testing.T) {
	s, ctx, dev := rrStore(t)
	if err := s.SaveRevocationReport(ctx, dev, 5, 4, 1000); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := s.SaveRevocationReport(ctx, dev, 5, 2, 2000); err != nil {
		t.Fatalf("same seq: %v", err)
	}
	rep, _, err := s.RevocationReportFor(ctx, dev)
	if err != nil {
		t.Fatalf("RevocationReportFor: %v", err)
	}
	if rep.Entries != 2 || rep.ReportedAt != 2000 {
		t.Errorf("report = %+v, want the later one at the same seq", rep)
	}
}

func TestANewerReportReplacesAnOlderOne(t *testing.T) {
	s, ctx, dev := rrStore(t)
	if err := s.SaveRevocationReport(ctx, dev, 1, 1, 1000); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := s.SaveRevocationReport(ctx, dev, 8, 0, 3000); err != nil {
		t.Fatalf("newer: %v", err)
	}
	rep, _, err := s.RevocationReportFor(ctx, dev)
	if err != nil {
		t.Fatalf("RevocationReportFor: %v", err)
	}
	if rep.Seq != 8 || rep.Entries != 0 {
		t.Errorf("report = %+v, want seq 8 with no entries", rep)
	}
}
