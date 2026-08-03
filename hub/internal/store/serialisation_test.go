package store

import (
	"context"
	"errors"
	"sync"
	"testing"
)

// The store's pool is limited to one connection, and this pins that.
//
// # What rests on it, stated at the strength I could establish
//
// Two shapes of single-use claim live in this package:
//
//   - A GUARDED UPDATE — `UPDATE … SET consumed_at = ? WHERE … consumed_at IS
//     NULL` plus RowsAffected. Atomic at the statement level and correct at any
//     pool size. claimRecoveryToken and claimSecondFactorTx are these.
//   - A SELECT, a decision in Go, then an UPDATE, inside a transaction.
//     RedeemChannelLinkCode is this one.
//
// The second shape is the one whose atomicity is not self-evident from the SQL,
// and Open's comment gives the single connection as the reason it is safe.
//
// I could NOT demonstrate that raising the pool breaks it. With
// SetMaxOpenConns(8), 300 rounds of two goroutines racing to redeem one link
// code produced zero double-bindings — SQLite serialises writers itself, and a
// deferred transaction that reads and then cannot upgrade its lock fails rather
// than interleaving. So the single connection is defence in depth here, not the
// sole thing standing between this package and a double redemption, and this
// test does not claim otherwise.
//
// It is still worth pinning: it is a documented invariant that two comments in
// this package reason from (Open's, and audithash_test.go's), it is the reason
// the SELECT-then-UPDATE shape was considered acceptable in review, and a
// change to it should be a deliberate one that revisits those. That is a weaker
// claim than "this prevents a race" and it is the one the evidence supports.
func TestTheStoreIsLimitedToOneConnection(t *testing.T) {
	f := newLinkFixture(t)
	if got := f.s.DB().Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("the store's pool allows %d connections, not 1.\n"+
			"Open documents this and audithash_test.go reasons from it, and the "+
			"SELECT-then-decide-then-UPDATE transactions in this package "+
			"(RedeemChannelLinkCode) were accepted on the strength of it. Changing "+
			"it means revisiting those, not just this line.", got)
	}
}

// One link code, redeemed concurrently by two different platform identities,
// binds exactly once.
//
// This is the invariant itself rather than the mechanism behind it, which is
// why it is worth having separately from the test above: it stays meaningful
// whatever the pool size or the SQLite locking mode happen to be.
//
// Honest about its own power: it passes today, and it also passed with the pool
// raised to 8, so it is not evidence about the connection limit. It is a
// regression guard on the outcome — an identity bound to a profile whose owner
// never authorised it — and it would catch a rewrite of RedeemChannelLinkCode
// that dropped the transaction or the consumed_at guard.
func TestOneLinkCodeBindsExactlyOnceUnderConcurrentRedemption(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}

	// Two different Telegram accounts racing to spend the same code.
	const first, second = "111111111", "222222222"

	start := make(chan struct{})
	var ready, wg sync.WaitGroup
	ready.Add(2)
	var mu sync.Mutex
	var wins int
	var errs []error

	for _, ext := range []string{first, second} {
		wg.Add(1)
		go func(ext string) {
			defer wg.Done()
			// Both parked before either is released. Without this they run to
			// completion one at a time and the second is refused against an
			// already-consumed code, which is the correct answer reached
			// without ever exercising the concurrency.
			ready.Done()
			<-start
			_, err := f.s.RedeemChannelLinkCode(ctx, "telegram", ext, code.Code)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				wins++
			} else {
				errs = append(errs, err)
			}
		}(ext)
	}
	ready.Wait()
	close(start)
	wg.Wait()

	if wins != 1 {
		t.Fatalf("%d of 2 concurrent redemptions of one code succeeded, want exactly 1 "+
			"(errors: %v)", wins, errs)
	}
	// The loser must be refused for a reason meaning "not usable", not a
	// database-level failure that merely resembles one.
	for _, e := range errs {
		if !errors.Is(e, ErrChannelLinkNotFound) && !errors.Is(e, ErrChannelIdentityTaken) {
			t.Errorf("the losing redemption failed with %v, which is not a refusal — "+
				"a caller cannot tell that from an outage", e)
		}
	}
}

// The control for the test above: a code that nobody races is still redeemable,
// and a second attempt on it is still refused.
//
// Without this, a RedeemChannelLinkCode that refused everything would satisfy
// "exactly one of two wins" only by accident — it would fail that test with
// wins=0 — but a version that refused everything AFTER the first bind would
// pass both it and this one for the wrong reason, so this asserts the binding
// actually took effect rather than only that a call returned nil.
func TestAnUnracedLinkCodeStillBindsAndIsThenSpent(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	userID, err := f.s.RedeemChannelLinkCode(ctx, "telegram", "333333333", code.Code)
	if err != nil {
		t.Fatalf("an unraced code was refused: %v", err)
	}
	if userID != f.alice.ID {
		t.Fatalf("bound to %q, want %q", userID, f.alice.ID)
	}
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", "444444444", code.Code); err == nil {
		t.Fatal("the same code was spent twice")
	}
}
