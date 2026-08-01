package recording

// Live view: the fragments the capture loop already produces, fanned out to
// whoever is watching.
//
// # What "live" means here, precisely, because it is not what the words suggest
//
// The capture loop records a window (CaptureWindow, ten seconds) and then muxes
// it. A viewer therefore sees a moment about one window after it happened. That
// is RECENT, not live, and everything here is named and worded so nobody
// discovers the difference while watching a gate.
//
// Getting to true low latency means holding one RTSP session open and cutting
// fragments from it continuously, and that is the thing this package has
// declined twice now for the same reason: keepalives, mid-stream parameter-set
// changes, RTCP sender reports and servers that drop when they feel like it are
// not developable against an in-process fake without inventing the behaviour
// being handled. The seam is FetchFunc and the shape of this file does not
// change when that lands — a subscriber still receives an init segment followed
// by fragments.
//
// # Why a broadcaster rather than a per-viewer capture
//
// Two people watching one camera must not open two RTSP sessions. Cheap cameras
// support very few, and the second viewer would take a slot from whatever is
// actually recording. So the capture loop is the only thing that talks to a
// camera, and viewers attach to what it already produces.
//
// # A slow viewer must not slow the recorder
//
// Each subscriber has a small buffered channel and is DROPPED from the fan-out
// when it fills. A phone on a bad connection would otherwise apply back-pressure
// through the broadcaster into the capture loop, and a camera stops being
// recorded because somebody's tab is struggling. Recording is the durable job;
// watching is the disposable one, and when they conflict the watcher loses.

import (
	"sync"
)

// liveBufferedFragments is how far behind a viewer may fall before it is
// dropped.
//
// Two, deliberately small. A viewer that cannot keep up with two fragments is
// not going to catch up, and holding more would mean a bigger stall when it
// finally reads — a viewer that reconnects gets a fresh init segment and the
// current moment, which is what someone watching a camera wants anyway.
const liveBufferedFragments = 2

// LiveSegment is one piece of a live stream.
type LiveSegment struct {
	// Init is true for the ftyp+moov a viewer must append before anything else.
	// A subscriber always receives one of these first, whenever it joined.
	Init bool
	Data []byte
}

// Broadcaster fans muxed fragments out to live viewers.
//
// The zero value is not usable; use NewBroadcaster.
type Broadcaster struct {
	mu sync.Mutex
	// subs is keyed by an opaque token so Unsubscribe cannot close another
	// viewer's channel.
	subs map[int]chan LiveSegment
	next int
	// init is the most recent init segment per camera. A viewer joining
	// mid-stream needs the moov before any fragment means anything, and the
	// capture loop only emits one when a stream's parameter sets change.
	init map[string][]byte
	// keyed subscriptions: a viewer watches one camera, not all of them.
	cameraOf map[int]string

	dropped int
}

// NewBroadcaster returns an empty broadcaster.
func NewBroadcaster() *Broadcaster {
	return &Broadcaster{
		subs:     map[int]chan LiveSegment{},
		init:     map[string][]byte{},
		cameraOf: map[int]string{},
	}
}

// Dropped counts viewers disconnected for falling behind.
//
// Exposed because "the picture keeps stopping" and "your connection cannot keep
// up with this camera" are different complaints, and only one of them is the
// hub's problem to fix.
func (b *Broadcaster) Dropped() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.dropped
}

// Subscribe attaches a viewer to one camera.
//
// The returned channel receives an init segment first when one is known, then
// fragments. It is closed when the viewer is dropped or unsubscribed, so a
// caller ranges over it and stops when it ends.
func (b *Broadcaster) Subscribe(deviceKey string) (<-chan LiveSegment, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.next
	b.next++
	// Room for the init segment plus the buffer, so delivering the init to a
	// brand-new subscriber cannot itself overflow and drop it immediately.
	ch := make(chan LiveSegment, liveBufferedFragments+1)
	b.subs[id] = ch
	b.cameraOf[id] = deviceKey
	if init := b.init[deviceKey]; len(init) > 0 {
		ch <- LiveSegment{Init: true, Data: init}
	}
	return ch, func() { b.unsubscribe(id) }
}

func (b *Broadcaster) unsubscribe(id int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ch, ok := b.subs[id]; ok {
		delete(b.subs, id)
		delete(b.cameraOf, id)
		close(ch)
	}
}

// PublishInit records a camera's init segment and sends it to its viewers.
//
// Stored as well as sent, because a viewer that joins between two fragments
// still needs the moov — without it a SourceBuffer rejects everything that
// follows, and the picture never starts for anyone who was not already watching.
func (b *Broadcaster) PublishInit(deviceKey string, data []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	stored := append([]byte(nil), data...)
	b.init[deviceKey] = stored
	b.sendLocked(deviceKey, LiveSegment{Init: true, Data: stored})
}

// PublishFragment sends one moof+mdat to a camera's viewers.
func (b *Broadcaster) PublishFragment(deviceKey string, data []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sendLocked(deviceKey, LiveSegment{Data: append([]byte(nil), data...)})
}

// sendLocked delivers to every viewer of one camera, dropping those that cannot
// keep up. Caller holds b.mu.
func (b *Broadcaster) sendLocked(deviceKey string, seg LiveSegment) {
	for id, ch := range b.subs {
		if b.cameraOf[id] != deviceKey {
			continue
		}
		select {
		case ch <- seg:
		default:
			// Full. Drop this viewer rather than block: the alternative is a
			// slow phone applying back-pressure into the capture loop, which
			// would stop a camera being RECORDED because somebody's tab is
			// struggling. Recording is the durable job.
			delete(b.subs, id)
			delete(b.cameraOf, id)
			close(ch)
			b.dropped++
		}
	}
}

// Viewers reports how many subscribers are attached.
//
// NOT, despite what this said, "for the capture loop to decide whether
// producing live output is worth anything". That optimisation cannot exist
// under the design recording.go chose: fragments are published from inside
// WriteClip, from the same muxer that writes the file, precisely so a viewer
// and the disk see identical bytes — "two muxers over one stream is two chances
// to disagree, and the disagreement would only show up as a picture that plays
// from a file and not from the live view".
//
// So the output is produced for the clip whether or not anyone is watching, and
// publishing it costs a map lookup that sendLocked drops immediately when there
// are no subscribers. There is nothing for a viewer count to save, and a
// capture loop that skipped publishing on zero viewers would only add a race
// against someone subscribing mid-fragment.
//
// What it is actually for: tests asserting subscribe/unsubscribe accounting,
// and anything that wants to report attachment without holding the lock itself.
func (b *Broadcaster) Viewers(deviceKey string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := 0
	for id := range b.subs {
		if b.cameraOf[id] == deviceKey {
			n++
		}
	}
	return n
}
