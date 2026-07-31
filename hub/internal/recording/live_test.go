package recording

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// The broadcaster under actual concurrency.
//
// Everything else in this package is single-threaded, so `go test -race` on it
// has been proving nothing: the detector only sees races on paths that genuinely
// run in parallel during the test. This type is the one built for concurrency —
// the capture loop publishes while HTTP handlers subscribe and leave — and until
// now no test had two goroutines touch it.
//
// What it is looking for is specific. sendLocked DROPS a slow viewer by deleting
// it and closing its channel, while that viewer may be unsubscribing at the same
// moment; a double close panics and would take the capture loop's goroutine with
// it. Subscribe also delivers the init segment while holding the lock, which
// deadlocks the whole broadcaster if that send can ever block.
func TestBroadcasterSurvivesConcurrentPublishSubscribeAndDrop(t *testing.T) {
	b := NewBroadcaster()
	const cameras = 3
	const viewers = 12
	const fragments = 200

	var wg sync.WaitGroup
	stop := make(chan struct{})

	// Publishers, one per camera, going as fast as they can.
	for c := 0; c < cameras; c++ {
		key := fmt.Sprintf("cam-%d", c)
		b.PublishInit(key, []byte{0, 1, 2})
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < fragments; i++ {
				b.PublishFragment(key, []byte{byte(i)})
				if i%50 == 0 {
					// A parameter-set change mid-stream: the real trigger for a
					// second init, and the one path that writes b.init.
					b.PublishInit(key, []byte{9, 9})
				}
			}
		}()
	}

	// Viewers that join, read a little, and leave — including some that read
	// nothing at all, which is what makes sendLocked drop them.
	for v := 0; v < viewers; v++ {
		v := v
		wg.Add(1)
		go func() {
			defer wg.Done()
			key := fmt.Sprintf("cam-%d", v%cameras)
			ch, cancel := b.Subscribe(key)
			if v%3 == 0 {
				// Never reads. Fills, gets dropped, then unsubscribes anyway —
				// the double-close path.
				cancel()
				return
			}
			// Bounded. `for range ch` blocks forever if the publishers finish
			// before this viewer has seen its quota — which they do, and which
			// hung the first version of this test. A real viewer is an HTTP
			// handler whose request context ends; nothing waits indefinitely for
			// a fragment that is not coming.
			deadline := time.After(10 * time.Second)
			read := 0
		drain:
			for read <= 5 {
				select {
				case _, open := <-ch:
					if !open {
						break drain // dropped by sendLocked, or already cancelled
					}
					read++
				case <-deadline:
					break drain
				}
			}
			cancel()
		}()
	}

	// Readers of the counters, concurrent with all of it.
	//
	// Deliberately NOT in wg. The first version of this test put it there and
	// deadlocked itself: this goroutine returns only when `stop` closes, and
	// `stop` closes only after wg.Wait() returns. The failure looked exactly
	// like a broadcaster deadlock, which is worth remembering — a concurrency
	// test that hangs is a claim about the test until proven otherwise.
	var counters sync.WaitGroup
	counters.Add(1)
	go func() {
		defer counters.Done()
		for {
			select {
			case <-stop:
				return
			default:
				_ = b.Dropped()
				_ = b.Viewers("cam-0")
			}
		}
	}()

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		// A deadlock here is the Subscribe-sends-under-lock hazard: if that send
		// can block, every publisher and every subscriber stops forever, and the
		// capture loop with them.
		t.Fatal("the broadcaster deadlocked under concurrent publish/subscribe")
	}
	close(stop)
	counters.Wait()

	// Unsubscribing everything must leave no subscriber behind, whichever way
	// each viewer left — dropped by sendLocked, or cancelled by itself.
	for c := 0; c < cameras; c++ {
		if n := b.Viewers(fmt.Sprintf("cam-%d", c)); n != 0 {
			t.Errorf("cam-%d still has %d viewers after every one returned", c, n)
		}
	}
}

// A viewer dropped for falling behind must be able to call its cancel func
// safely. sendLocked already closed and deleted it; a second close panics.
func TestCancellingAnAlreadyDroppedViewerIsSafe(t *testing.T) {
	b := NewBroadcaster()
	b.PublishInit("cam", []byte{1})
	_, cancel := b.Subscribe("cam")

	// Overflow it: the init plus enough fragments to exceed the buffer.
	for i := 0; i < liveBufferedFragments+5; i++ {
		b.PublishFragment("cam", []byte{byte(i)})
	}
	if b.Dropped() == 0 {
		t.Fatal("fixture: the viewer was never dropped, so the double-close path is untested")
	}
	// Must not panic.
	cancel()
	cancel()
}
