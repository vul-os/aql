package state

// Cached grant revocations — docs/GRANT-REVOCATION.md.
//
// The controller caches a deny-list while it can reach the hub and consults it
// while it cannot. Two properties from the design carry all the weight:
//
//   - ABSENCE IS NEVER DENIAL. No list means the behaviour shipped before this
//     existed. Nothing here can authorise a grant; it can only refuse one. That
//     is what makes the feature safe to roll out in any order, and why a
//     controller that never receives a list cannot strand a resident.
//   - THE ATTACK IS ROLLBACK, NOT FORGERY. Command envelopes are already signed
//     by the pinned hub key, so a list cannot be fabricated. It CAN be
//     withheld: an attacker replaying an older, emptier signed list would
//     un-revoke a grant they hold. `seq` is monotonic and a list at or below
//     the stored one is refused, which is the single rule this file exists for.

// Revocation is one revoked grant, with the expiry that makes it droppable.
//
// EXP is carried so the list is self-pruning: once a grant is past its own
// expiry the verification core denies it at the validity step anyway, so
// keeping the entry buys nothing. That bound is a property of the design
// rather than a limit an operator configures.
type Revocation struct {
	GrantID string `json:"grant_id"`
	EXP     int64  `json:"exp"`
}

// RevocationList is what a `revoke` command carries.
type RevocationList struct {
	// Seq is monotonic per hub. Higher wins; equal or lower is refused.
	Seq int64 `json:"seq"`
	// IssuedAt is for operator display ONLY and is deliberately not a
	// security input: a timestamp an attacker can influence must not decide
	// whether a revocation sticks. Seq does that.
	IssuedAt int64        `json:"issued_at"`
	Entries  []Revocation `json:"entries"`
}

// ErrRevocationRollback is returned when a list is not newer than the stored
// one. Named rather than a bare error because the transport reports it: an
// operator seeing repeated rollback refusals is seeing an attack or a hub that
// reset its counter, and both need saying out loud.
type revocationRollbackError struct{}

func (revocationRollbackError) Error() string {
	return "state: revocation list refused (seq is not newer than the stored one)"
}

// ErrRevocationRollback is the sentinel for the above.
var ErrRevocationRollback error = revocationRollbackError{}

// Revocations returns a copy of the cached list.
func (s *Store) Revocations() RevocationList {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := RevocationList{Seq: s.data.RevocationSeq, IssuedAt: s.data.RevocationIssuedAt}
	out.Entries = append([]Revocation(nil), s.data.Revocations...)
	return out
}

// SetRevocations replaces the cached list, refusing anything not strictly
// newer.
//
// Refusal is the interesting case and it is deliberately not silent: a caller
// that ignores this error and carries on has re-opened the rollback window the
// seq exists to close.
//
// `now` prunes entries already past their expiry as they are stored. Pruning on
// WRITE rather than on read means the persisted file stays small on its own,
// and a controller that sits offline for a month does not accumulate a list it
// will never consult.
//
// # Why the seq check is inside the mutation
//
// It used to read the stored seq under the lock, release the lock, prune, and
// then call mutate — which takes the same lock again. Two callers could
// therefore both pass the check against the same stored seq and then write in
// either order, so the LOWER one could land last and the stored seq would go
// backwards. That is precisely the rollback the seq exists to prevent, arriving
// through the guard rather than around it.
//
// It was not reachable: commands are dispatched from one goroutine, the
// WebSocket read loop, and the long-poll fallback only runs after that loop has
// returned. It is also invisible to `-race`, because both halves take the mutex
// correctly — the bug is in the gap between them, not in the access. So it
// would have gone live silently the day a second command path (BLE, LAN) began
// processing a `revoke`, with no test and no detector able to say so.
//
// Doing the comparison inside the mutation makes check and write one atomic
// step. The cost is a persist of unchanged state on a refusal, which is a
// wasted write of identical bytes.
func (s *Store) SetRevocations(list RevocationList, now int64) error {
	kept := make([]Revocation, 0, len(list.Entries))
	for _, e := range list.Entries {
		if e.GrantID == "" {
			continue
		}
		if e.EXP != 0 && e.EXP < now {
			continue // already denied by the validity step
		}
		kept = append(kept, e)
	}

	var refused bool
	err := s.mutate(func(d *persisted) {
		// Compared against `d`, the live state under the lock that will
		// perform this very write — not against a value read earlier.
		if list.Seq <= d.RevocationSeq && d.RevocationSeq != 0 {
			refused = true
			return
		}
		// A first list with seq 0 is refused too: seq 0 is the "never received
		// one" sentinel, so accepting it would make the stored state
		// indistinguishable from absence and every subsequent list would look
		// like the first.
		if list.Seq <= 0 {
			refused = true
			return
		}
		d.RevocationSeq = list.Seq
		d.RevocationIssuedAt = list.IssuedAt
		d.Revocations = kept
	})
	if refused {
		// Reported ahead of any persist error: nothing was changed, so a
		// failure to write the unchanged state is not what the caller needs to
		// hear about.
		return ErrRevocationRollback
	}
	return err
}

// RevokedAt reports whether a grant id is on the cached list at time `now`.
//
// Returns false when there is no list, which is the whole "absence is never
// denial" rule expressed in one line — and false for an entry already past its
// own expiry, so a list that outlived a pruning opportunity still answers the
// same as one that was pruned.
func (s *Store) RevokedAt(grantID string, now int64) bool {
	// No guard for an empty grantID. One was here and was deleted: entries
	// with an empty id are dropped at WRITE, so no stored entry can match one
	// and the loop already returns false. A branch that only repeats what the
	// code below does cannot be made to fail, and an untestable guard reads to
	// the next person as a checked case when it is not one.
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.data.Revocations {
		if e.GrantID != grantID {
			continue
		}
		if e.EXP != 0 && e.EXP < now {
			return false
		}
		return true
	}
	return false
}
