package state

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func revStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return s
}

// docs/GRANT-REVOCATION.md §3.3: "A controller holding no list behaves exactly
// as it does today." This is the property that makes the feature safe to
// deploy in any order, so it is the first thing pinned.
func TestNoListMeansNothingIsRevoked(t *testing.T) {
	s := revStore(t)
	if s.RevokedAt("grant-1", 1000) {
		t.Error("a controller that has never received a list refused a grant")
	}
	if got := s.Revocations(); got.Seq != 0 || len(got.Entries) != 0 {
		t.Errorf("empty store reports %+v", got)
	}
}

func TestARevokedGrantIsRefusedAndOthersAreNot(t *testing.T) {
	s := revStore(t)
	if err := s.SetRevocations(RevocationList{
		Seq: 1, IssuedAt: 900,
		Entries: []Revocation{{GrantID: "grant-1", EXP: 5000}},
	}, 1000); err != nil {
		t.Fatalf("SetRevocations: %v", err)
	}
	if !s.RevokedAt("grant-1", 1000) {
		t.Error("the revoked grant was not refused")
	}
	if s.RevokedAt("grant-2", 1000) {
		t.Error("a grant that is not on the list was refused — the list authorises nothing " +
			"and must deny nothing beyond what it names")
	}
}

// §3.5, the one security-critical rule: "the attack is not forging a list —
// the envelope signature stops that — but replaying an older, emptier one."
func TestAnOlderListIsRefusedSoARevocationCannotBeRolledBack(t *testing.T) {
	s := revStore(t)
	current := RevocationList{Seq: 7, Entries: []Revocation{{GrantID: "fired-worker", EXP: 9000}}}
	if err := s.SetRevocations(current, 1000); err != nil {
		t.Fatalf("SetRevocations: %v", err)
	}

	// The attack: a signed list the hub really did issue, from before the
	// revocation, replayed by someone holding the grant.
	older := RevocationList{Seq: 6, Entries: nil}
	if err := s.SetRevocations(older, 1000); !errors.Is(err, ErrRevocationRollback) {
		t.Fatalf("an older list was accepted (err=%v) — the grant is un-revoked", err)
	}
	// Equal seq is refused too: an attacker who cannot lower the number can
	// still resend the same one carrying different entries if equality passes.
	if err := s.SetRevocations(RevocationList{Seq: 7}, 1000); !errors.Is(err, ErrRevocationRollback) {
		t.Fatalf("a list at the same seq was accepted (err=%v)", err)
	}
	if !s.RevokedAt("fired-worker", 1000) {
		t.Fatal("the revocation did not survive the rollback attempt")
	}
	if got := s.Revocations().Seq; got != 7 {
		t.Errorf("stored seq = %d, want 7 — a refused list must leave the stored one alone", got)
	}
}

func TestANewerListReplacesTheStoredOne(t *testing.T) {
	s := revStore(t)
	if err := s.SetRevocations(RevocationList{Seq: 1,
		Entries: []Revocation{{GrantID: "a", EXP: 9000}}}, 1000); err != nil {
		t.Fatalf("first: %v", err)
	}
	// A member reinstated: the hub simply stops listing their grant.
	if err := s.SetRevocations(RevocationList{Seq: 2,
		Entries: []Revocation{{GrantID: "b", EXP: 9000}}}, 1000); err != nil {
		t.Fatalf("second: %v", err)
	}
	if s.RevokedAt("a", 1000) {
		t.Error("a grant dropped from the newer list is still refused — the list is " +
			"replaced, not accumulated")
	}
	if !s.RevokedAt("b", 1000) {
		t.Error("the newer list's entry was not applied")
	}
}

// §3.2: entries carry exp so the list is self-pruning.
func TestExpiredEntriesArePrunedOnWriteAndIgnoredOnRead(t *testing.T) {
	s := revStore(t)
	if err := s.SetRevocations(RevocationList{Seq: 1, Entries: []Revocation{
		{GrantID: "long-gone", EXP: 500},
		{GrantID: "still-live", EXP: 9000},
	}}, 1000); err != nil {
		t.Fatalf("SetRevocations: %v", err)
	}
	got := s.Revocations()
	if len(got.Entries) != 1 || got.Entries[0].GrantID != "still-live" {
		t.Errorf("stored entries = %+v, want only the unexpired one", got.Entries)
	}
	// And on read, for an entry stored while still live that has since expired.
	if s.RevokedAt("still-live", 99999) {
		t.Error("an entry past its own exp still refused — the validity step already " +
			"denies that grant, so the entry is dead weight, not a second opinion")
	}
}

// Seq 0 is the "never received one" sentinel. Accepting a list at 0 would make
// the stored state indistinguishable from absence, and every later list would
// look like the first — which is the rollback window reopened by accident.
func TestSeqZeroIsRefusedSoAbsenceStaysDistinguishable(t *testing.T) {
	s := revStore(t)
	err := s.SetRevocations(RevocationList{Seq: 0, Entries: []Revocation{{GrantID: "x", EXP: 9000}}}, 1000)
	if !errors.Is(err, ErrRevocationRollback) {
		t.Fatalf("a list at seq 0 was accepted (err=%v)", err)
	}
	if s.RevokedAt("x", 1000) {
		t.Error("a refused list was applied anyway")
	}
}

func TestTheListSurvivesARestart(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.SetRevocations(RevocationList{Seq: 3, IssuedAt: 800,
		Entries: []Revocation{{GrantID: "persisted", EXP: 9000}}}, 1000); err != nil {
		t.Fatalf("SetRevocations: %v", err)
	}
	// A controller reboots at the worst moment — power cut, the resident's
	// phone at the gate. The deny-list has to still be there.
	again, err := Open(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if !again.RevokedAt("persisted", 1000) {
		t.Error("the deny-list did not survive a restart")
	}
	if got := again.Revocations().Seq; got != 3 {
		t.Errorf("seq after restart = %d, want 3 — a lost seq reopens the rollback window", got)
	}
	// And it is actually on disk, not merely in a second process's memory.
	raw, err := os.ReadFile(filepath.Join(dir, stateFile))
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	if !contains(string(raw), "persisted") || !contains(string(raw), "revocation_seq") {
		t.Errorf("state file does not carry the list: %s", raw)
	}
}

func contains(hay, needle string) bool {
	return len(hay) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(hay); i++ {
			if hay[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}

// An entry with no grant id is dropped rather than stored. It is the filter
// that makes RevokedAt's loop sufficient on its own — without it an empty
// lookup would match an empty entry, and "this grant has no id" would become
// "this grant is revoked" for every malformed grant that reached the check.
func TestAnEntryWithNoGrantIDIsNotStored(t *testing.T) {
	s := revStore(t)
	if err := s.SetRevocations(RevocationList{Seq: 1, Entries: []Revocation{
		{GrantID: "", EXP: 9000},
		{GrantID: "real", EXP: 9000},
	}}, 1000); err != nil {
		t.Fatalf("SetRevocations: %v", err)
	}
	got := s.Revocations()
	if len(got.Entries) != 1 || got.Entries[0].GrantID != "real" {
		t.Fatalf("stored %+v, want only the entry with an id", got.Entries)
	}
	if s.RevokedAt("", 1000) {
		t.Error("an empty grant id matched the list")
	}
}
