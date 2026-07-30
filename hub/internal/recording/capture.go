package recording

// The capture loop: the thing that finally runs the chain.
//
// Every component below this file was built and tested in isolation and
// reachable from nothing — camera.ConsumeMedia, camera.NewFragmenter and
// Recorder.WriteClip each had no production caller. docs/CAMERA-RETENTION.md's
// build order put them in that state deliberately (policy before footage), but
// "deliberate" only lasts while the consumer is actually coming. This is it.
//
// # One clip per window, not one continuous stream
//
// Each pass runs a full DESCRIBE/SETUP/PLAY/TEARDOWN and produces one clip of
// roughly CaptureWindow. A continuous recorder would hold one RTSP session open
// and cut segments from it, which is fewer requests and less session churn on a
// camera that supports few of them.
//
// It is not written that way, and the reason is the same one that has governed
// this package throughout: NOTHING HERE HAS MET A CAMERA. A long-lived session
// has to handle keepalives, mid-stream parameter-set changes, RTCP sender
// reports, and a server that drops the connection when it feels like it — none
// of which can be developed against an in-process fake without inventing the
// behaviour being handled. A session per window is worse on a real camera and
// honest about what has been verified; the seam for the better version is
// FetchFunc, and swapping it is a change to one field.
//
// # What a failure here must never do
//
// Delay or fail a gate opening. docs/CAMERA-RETENTION.md §2.3 is explicit, and
// this loop is on its own goroutine, holds no lock anything else wants, and
// swallows every error into a log line. A camera that has gone away, a disk
// under its floor and a stream that assembles nothing all look the same from
// the access path: nothing at all.

import (
	"context"
	"errors"
	"time"

	"github.com/vul-os/aql/hub/internal/devices/camera"
)

// CaptureWindow is how much media one pass collects, and therefore roughly how
// long each clip is.
//
// Ten seconds is short enough that a crash loses little and that a clip lands
// on disk while someone is still watching the log during setup, and long enough
// that the per-pass RTSP handshake is a small fraction of the work.
const CaptureWindow = 10 * time.Second

// CaptureTimeout bounds one pass, handshake included.
const CaptureTimeout = 30 * time.Second

// Source is one camera worth recording.
type Source struct {
	// DeviceKey is the engine's namespaced key, devices.Key(driver, id).
	DeviceKey string
	// AccountID owns the footage, and is the first path segment. A camera
	// nobody has claimed has no account, and is not recorded — see SourceFunc.
	AccountID string
	StreamURL string
	Cred      camera.Credential
}

// SourceFunc enumerates the cameras to record right now.
//
// Called every pass rather than once, so a camera claimed, unclaimed,
// reconfigured or discovered while the hub is running is picked up without a
// restart. It returns only claimed cameras: footage is written under an account
// id, and there is no correct directory for footage nobody owns.
type SourceFunc func(ctx context.Context) ([]Source, error)

// FetchFunc receives media from one camera. Defaults to camera.ConsumeMedia.
//
// Injectable so the capture loop can be tested without a socket. The socket half
// is not skipped by doing this — camera's own tests drive ConsumeMedia against
// an in-process RTSP server that writes its framing from RFC 2326 and RFC 3550
// independently. What this seam isolates is the decision-making above it.
type FetchFunc func(ctx context.Context, url string, cred camera.Credential,
	timeout, window time.Duration) (camera.StreamInfo, camera.MediaFlow, []camera.AccessUnit, *camera.Assembler, error)

// CaptureOnce records one clip from one camera.
//
// Returns nil when there was nothing to write. That covers several genuinely
// different situations, and they are distinguished in the log rather than in the
// return, because none of them is the caller's problem to handle:
//
//	the camera records nothing      retain_hours 0, live-view only
//	no picture assembled           packets arrived, none completed a picture
//	no parameter sets              no sprop-parameter-sets and none in-band yet
//	the disk is under its floor    WriteClip refuses; recording has stopped
func (r *Recorder) CaptureOnce(ctx context.Context, s Source) error {
	if !r.Records(s.DeviceKey) {
		return nil
	}
	fetch := r.cfg.Fetch
	if fetch == nil {
		fetch = camera.ConsumeMedia
	}

	_, flow, units, asm, err := fetch(ctx, s.StreamURL, s.Cred, CaptureTimeout, CaptureWindow)
	if err != nil {
		return err
	}
	if len(units) == 0 {
		// Packets can arrive without a picture completing — every one of them a
		// fragment whose remainder never came. Logged with the packet count
		// precisely because "nothing arrived" and "everything arrived and none
		// of it assembled" are different faults with different causes.
		r.cfg.Log.Info("recording: no complete picture in this window",
			"device", s.DeviceKey, "packets", flow.Packets)
		return nil
	}

	// Parameter sets come from the stream itself. A camera that advertises them
	// in sprop-parameter-sets has already had them read by Describe; one that
	// does not sends them in-band, and the assembler is where they land. Either
	// way they are the encoder's, not a guess.
	sps, pps := asm.SPS(), asm.PPS()
	if len(sps) == 0 || len(pps) == 0 {
		// Not an error: a stream legitimately sends parameter sets periodically
		// rather than in every window, so the next pass will have them.
		r.cfg.Log.Info("recording: no parameter sets yet; skipping this window",
			"device", s.DeviceKey, "pictures", len(units))
		return nil
	}

	// The last access unit has no duration — nothing has said when it ends —
	// and Samples refuses a zero-duration sample rather than inventing one. So
	// it is left for the next window rather than written with a guessed length.
	if len(units) > 0 && units[len(units)-1].Duration == 0 {
		units = units[:len(units)-1]
	}
	if len(units) == 0 {
		return nil
	}

	clip, err := r.WriteClip(ctx, s.AccountID, s.DeviceKey, sps, pps, units)
	if err != nil {
		if errors.Is(err, ErrBelowFloor) {
			return err // already logged loudly by ensureFreeSpace
		}
		return err
	}
	if clip.ID != "" {
		r.cfg.Log.Info("recording: clip written",
			"device", s.DeviceKey, "path", clip.RelPath,
			"seconds", clip.DurationS, "bytes", clip.SizeBytes)
	}
	return nil
}

// RunCapture records from every source, forever.
//
// Sources are re-enumerated each pass and captured in sequence rather than
// concurrently. Sequential is deliberate for now: a hub on a Pi with four
// cameras would otherwise hold four RTSP sessions and four muxers at once, and
// the memory ceiling of that has not been measured on the hardware this is meant
// to run on. Guessing it is how a recording feature takes down a gate.
func (r *Recorder) RunCapture(ctx context.Context, sources SourceFunc) {
	for {
		srcs, err := sources(ctx)
		if err != nil {
			r.cfg.Log.Error("recording: cannot enumerate cameras", "err", err)
		}
		for _, s := range srcs {
			if ctx.Err() != nil {
				return
			}
			if err := r.CaptureOnce(ctx, s); err != nil {
				// One camera's failure must not stop the others, and must not
				// stop the loop: a camera is unplugged, a disk fills, a stream
				// changes codec. Every one of those is a log line and the next
				// pass tries again.
				r.cfg.Log.Warn("recording: capture failed",
					"device", s.DeviceKey, "err", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
			// A short pause between sweeps rather than a long one: each pass
			// already spends CaptureWindow receiving, so this only bounds the
			// spin when there is nothing to record.
		}
	}
}
