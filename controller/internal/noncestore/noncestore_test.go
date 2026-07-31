package noncestore_test

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/vul-os/aql/controller/internal/noncestore"
)

func TestPersistenceAcrossReopen(t *testing.T) {
	dir := t.TempDir()
	s, err := noncestore.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Mark("nonce-a", 2000, 1000); err != nil {
		t.Fatal(err)
	}
	s2, err := noncestore.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !s2.Seen("nonce-a") {
		t.Fatal("nonce forgotten across reopen — replay window broken")
	}
}

func TestFullFailsClosedAndPrunes(t *testing.T) {
	dir := t.TempDir()
	s, err := noncestore.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := int64(1000)
	for i := 0; i < noncestore.Capacity; i++ {
		if err := s.Mark(fmt.Sprintf("live-%d", i), now+500, now); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Mark("one-more", now+500, now); !errors.Is(err, noncestore.ErrFull) {
		t.Fatalf("expected ErrFull, got %v", err)
	}
	// Once the horizon passes, expired entries are pruned and slots free up.
	later := now + 1000
	if err := s.Mark("fresh-after-expiry", later+500, later); err != nil {
		t.Fatalf("expected pruning to free a slot: %v", err)
	}
	if s.Len() != 1 {
		t.Fatalf("expected 1 live nonce after pruning, got %d", s.Len())
	}
}

func TestCorruptFileFailsClosed(t *testing.T) {
	dir := t.TempDir()
	s, err := noncestore.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Mark("x", 10, 1)
	// Corrupt the file.
	if err := os.WriteFile(dir+"/nonces.json", []byte("{corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := noncestore.Open(dir); err == nil {
		t.Fatal("corrupt nonce store must fail Open (fail-closed)")
	}
}

// Concurrent redemption of one nonce must accept exactly one.
//
// This store is the controller's replay protection, and its whole job is
// answering "have I seen this before" for a signed command that opens a gate.
// Seen() and Mark() lock separately, so a caller that checks then records —
// which is what verification does, deliberately, so a lockdown refusal does not
// burn the nonce — has a window where two verifications of the same envelope
// both pass and both actuate.
//
// Not reachable today: the transport runs one goroutine and the long-poll
// fallback only runs after the WebSocket session returns. But that makes this
// store's correctness depend on a property of a different package which nothing
// states and nothing enforces, and it would be lost the moment command handling
// is parallelised. MarkIfUnseen puts the invariant where it belongs.
func TestOnlyOneConcurrentRedemptionOfANonceSucceeds(t *testing.T) {
	const racers = 32
	for round := 0; round < 20; round++ {
		s, err := noncestore.Open(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		nonce := "n-" + strconv.Itoa(round)

		var wg sync.WaitGroup
		var accepted int64
		start := make(chan struct{})
		for i := 0; i < racers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start // release them together, to actually contend
				fresh, err := s.MarkIfUnseen(nonce, 2_000_000_000, 1_000_000_000)
				if err != nil {
					t.Errorf("MarkIfUnseen: %v", err)
					return
				}
				if fresh {
					atomic.AddInt64(&accepted, 1)
				}
			}()
		}
		close(start)
		wg.Wait()

		if got := atomic.LoadInt64(&accepted); got != 1 {
			t.Fatalf(`%d of %d concurrent redemptions of the same nonce were accepted, want exactly 1.

Every acceptance is a signed command allowed to actuate. More than one is a
replay getting through the store whose only purpose is stopping replays.`, got, racers)
		}
	}
}

// The check-then-act window this replaces, demonstrated against the old pair so
// the fix is not taken on faith. Seen() then Mark() lets every racer through.
func TestTheSeenThenMarkPairIsNotAtomic(t *testing.T) {
	s, err := noncestore.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const racers = 32
	var wg sync.WaitGroup
	var accepted int64
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if s.Seen("shared") {
				return
			}
			// The gap: verification does real work here — lockdown checks —
			// before recording.
			runtime.Gosched()
			if err := s.Mark("shared", 2_000_000_000, 1_000_000_000); err == nil {
				atomic.AddInt64(&accepted, 1)
			}
		}()
	}
	close(start)
	wg.Wait()

	if atomic.LoadInt64(&accepted) <= 1 {
		t.Skip("the interleaving did not occur on this run; the point stands in " +
			"TestOnlyOneConcurrentRedemptionOfANonceSucceeds")
	}
	// Reaching here IS the demonstration: the old pair admitted more than one.
	t.Logf("Seen()+Mark() admitted %d of %d concurrent redemptions — this is the window "+
		"MarkIfUnseen closes", atomic.LoadInt64(&accepted), racers)
}
