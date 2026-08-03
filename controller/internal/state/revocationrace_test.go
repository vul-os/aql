package state_test

import (
	"errors"
	"sync"
	"testing"

	"github.com/vul-os/aql/controller/internal/state"
)

// The stored revocation seq must never go backwards, even when two callers
// install a list at the same moment.
//
// # What this is testing and why -race cannot
//
// SetRevocations used to read the stored seq under the lock, RELEASE it, and
// then call mutate, which takes the same lock again. Two callers could both
// pass the comparison against the same stored value and then write in either
// order, so the lower seq could land last and the stored seq would go
// backwards — the exact rollback the seq exists to prevent, arriving through
// the guard rather than around it.
//
// Both halves take the mutex correctly, so there is no data race and `-race`
// says nothing. The defect lives in the gap between two correctly-locked
// sections, which is a class of bug only an invariant assertion finds.
//
// # The shape, and how it was calibrated
//
// Each round releases `writers` goroutines simultaneously from a start barrier,
// each installing a distinct seq strictly newer than everything stored. All of
// them are admissible, so nothing but the interleaving decides the outcome, and
// the only correct end state is the highest one.
//
// The size of this is measured, not guessed. Against a deliberately
// reintroduced version of the bug:
//
//   - two goroutines, no start barrier: 0 failures in 200 rounds — they never
//     overlapped at all, the first finishing before the second was scheduled.
//     That version passed against the bug, which is how it was caught.
//   - two goroutines with a barrier: still 0 in 200. The losing window is a few
//     instructions wide.
//   - eight goroutines with a barrier: 1 in 200, and 8 in 2000.
//
// The fixed code produced 0 in 2000 in the same harness. So 2000 rounds of 8
// expects ~8 hits and misses entirely with probability about e^-8 — roughly one
// run in three thousand. That is the honest characterisation: this is a
// probabilistic test of a real interleaving, not a deterministic one, and it is
// sized from a measured rate rather than from taste.
func TestConcurrentRevocationListsNeverMoveTheSeqBackwards(t *testing.T) {
	if testing.Short() {
		t.Skip("2000 contended rounds; -short skips it")
	}
	st, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	const rounds, writers = 2000, 8
	stored := int64(0)
	for round := 1; round <= rounds; round++ {
		// All strictly newer than anything stored, so every one is admissible
		// and only the ordering can decide which survives.
		var highest int64
		start := make(chan struct{})
		var ready, wg sync.WaitGroup
		ready.Add(writers)
		for i := 0; i < writers; i++ {
			seq := stored + int64(i) + 1
			if seq > highest {
				highest = seq
			}
			wg.Add(1)
			go func(seq int64) {
				defer wg.Done()
				// Park every writer before releasing any of them. Without this
				// they run to completion one at a time and each later one is
				// correctly refused against an already-updated seq, so the
				// interleaving under test never occurs.
				ready.Done()
				<-start
				err := st.SetRevocations(state.RevocationList{
					Seq:     seq,
					Entries: []state.Revocation{{GrantID: "g1", EXP: 0}},
				}, 0)
				// A rollback refusal is the correct outcome for a loser.
				if err != nil && !errors.Is(err, state.ErrRevocationRollback) {
					t.Errorf("round %d seq %d: %v", round, seq, err)
				}
			}(seq)
		}
		ready.Wait()
		close(start)
		wg.Wait()

		got := st.Revocations().Seq
		if got != highest {
			t.Fatalf("round %d: %d writers installed seqs %d..%d concurrently and the "+
				"stored seq is %d, not %d — a lower list landed last and the seq moved "+
				"BACKWARDS, which is the rollback the seq exists to prevent",
				round, writers, stored+1, highest, got, highest)
		}
		stored = highest
	}
}

// The control: the ordinary sequential path still accepts and still refuses.
//
// The test above asserts an invariant that a SetRevocations rejecting
// everything would satisfy perfectly — nothing would ever be stored, so the seq
// could never go backwards, and the fleet would silently stop accepting
// revocations. This is what says the guard still admits a real list.
func TestSetRevocationsStillAcceptsAndStillRefuses(t *testing.T) {
	st, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	list := func(seq int64) state.RevocationList {
		return state.RevocationList{Seq: seq, Entries: []state.Revocation{{GrantID: "g1"}}}
	}

	if err := st.SetRevocations(list(5), 0); err != nil {
		t.Fatalf("a first real list was refused: %v", err)
	}
	if got := st.Revocations().Seq; got != 5 {
		t.Fatalf("stored seq %d, want 5", got)
	}
	if len(st.Revocations().Entries) != 1 {
		t.Fatal("the entries did not survive the write")
	}
	if err := st.SetRevocations(list(9), 0); err != nil {
		t.Fatalf("a newer list was refused: %v", err)
	}

	// And the refusals the guard exists for.
	for _, seq := range []int64{9, 4, 0, -1} {
		if err := st.SetRevocations(list(seq), 0); !errors.Is(err, state.ErrRevocationRollback) {
			t.Errorf("seq %d against a stored 9: want ErrRevocationRollback, got %v", seq, err)
		}
	}
	if got := st.Revocations().Seq; got != 9 {
		t.Fatalf("a refused list changed the stored seq to %d", got)
	}
}
