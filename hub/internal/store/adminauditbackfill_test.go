package store

import (
	"context"
	"testing"
)

// The admin_audit_log backfill's rowid-bounded anchor — the untested half of a
// matched pair.
//
// # Why this is a gap rather than a missing nicety
//
// There are two hash chains in this file and they are written as mirror images:
// lastAccessLogRowHash / lastAccessLogRowHashBefore alongside
// lastAdminAuditRowHash / lastAdminAuditRowHashBefore, and a backfill for each.
// The access-log side has a test for exactly this scenario, which names
// lastAccessLogRowHashBefore and explains what the naive anchor gets wrong. The
// admin-audit side had none: coverage put lastAdminAuditRowHashBefore at 0.0%
// against its twin's 71.4%, and backfillAdminAuditHashChain at 34.4% against
// 65.8%.
//
// That is this repository's recurring shape — a pair written together and
// checked in one direction — and it is worth naming rather than quietly fixing,
// because the same asymmetry is what the sibling tests were added to catch
// elsewhere.
//
// # What the anchor does
//
// Backfill hashes every row with a NULL row_hash, in rowid order, chaining each
// to the one before. The anchor question is what the FIRST pending row chains
// to. `lastAdminAuditRowHash` — the last hashed row in the whole table — is the
// wrong answer whenever any hashed row sits AFTER the gap: the recomputed hash
// would not be the one the following row's stored prev_hash already expects,
// and the chain would verify broken from that point on. The rowid-bounded
// variant asks for the last hashed row strictly BEFORE the gap, which is the
// row that actually precedes it.
//
// In production backfill only ever meets a contiguous prefix of un-hashed rows,
// since every row predates migration 0007 uniformly. A hole in the middle is
// the harder case and the one that distinguishes the two anchors, which is why
// the access-log test uses it and why this does too.
func TestAdminAuditBackfillAnchorsToTheRowBeforeTheGapNotTheLastRowInTheTable(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "aab@x.com", "h", "A", "")
	if err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 3; i++ {
		if err := s.WriteAdminAudit(ctx, u.ID, "act", "kind", "target", true,
			map[string]any{"i": i}); err != nil {
			t.Fatal(err)
		}
	}
	var ids []string
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM admin_audit_log ORDER BY rowid ASC`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) != 3 {
		t.Fatalf("expected 3 audit rows, got %d", len(ids))
	}

	// Roll the MIDDLE row back to its pre-migration shape, leaving hashed rows
	// on both sides. Recomputing row 2 from its unchanged content and its TRUE
	// predecessor (row 1) must reproduce the hash it always had, which is what
	// row 3's already-stored prev_hash expects. Anchoring on the last hashed
	// row in the table instead would pick row 3 — after the gap — and produce a
	// chain that no longer verifies.
	dropAdminAuditTrigger(t, s)
	if _, err := s.db.Exec(
		`UPDATE admin_audit_log SET prev_hash = NULL, row_hash = NULL,
		        actor_user_id_snapshot = NULL WHERE id = ?`, ids[1]); err != nil {
		t.Fatal(err)
	}

	if err := s.backfillHashChains(ctx); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	res, err := s.VerifyAdminAuditHashChain(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK {
		t.Fatalf("the chain does not verify after backfill: %+v.\nThat is what the "+
			"rowid-bounded anchor exists to prevent — chaining the refilled row to the "+
			"last hashed row in the TABLE rather than the last one before the gap.", res)
	}
	if res.RowsChecked != 3 {
		t.Errorf("verified %d rows, want 3", res.RowsChecked)
	}

	// The snapshot column is repopulated too, not merely the hashes: it is part
	// of what the row commits to, and a backfill that left it NULL would verify
	// clean today and stop verifying the moment the actor is deleted.
	var snap string
	if err := s.db.QueryRow(
		`SELECT coalesce(actor_user_id_snapshot,'') FROM admin_audit_log WHERE id = ?`,
		ids[1]).Scan(&snap); err != nil {
		t.Fatal(err)
	}
	if snap != u.ID {
		t.Errorf("actor snapshot is %q after backfill, want %q", snap, u.ID)
	}

	// A second Open() re-runs backfill. It must be a no-op rather than a
	// re-hash that breaks the chain it just repaired.
	if err := s.backfillHashChains(ctx); err != nil {
		t.Fatalf("idempotent re-backfill: %v", err)
	}
	if res, err := s.VerifyAdminAuditHashChain(ctx); err != nil || !res.OK {
		t.Errorf("chain after idempotent re-backfill: %v %+v", err, res)
	}
}

// dropAdminAuditTrigger removes the append-only trigger so a test can
// manufacture a pre-migration row.
//
// Same reasoning as dropAccessLogsTrigger: the trigger is defence in depth
// against the running application, not against someone with direct database
// access, who could drop it as easily as edit a row. Only the hash chain
// defends against that, and it is what this test is exercising.
func dropAdminAuditTrigger(t *testing.T, s *Store) {
	t.Helper()
	if _, err := s.db.Exec(`DROP TRIGGER admin_audit_log_immutable`); err != nil {
		t.Fatalf("drop trigger (test setup): %v", err)
	}
}
