package keys

// Key rotation with two-key retention.
//
// A controller pins this hub's public key at pairing and refuses to change it
// outside a `repair` command signed by the key it currently pins
// (controller/internal/state's ErrKeyChangeRefused). That makes rotation a
// per-controller conversation rather than a switch, and it cannot be made
// atomic:
//
//	A precondition — "every controller is online, go" — does not help. A
//	controller that drops between the check and its own repair is still pinning
//	the old key. If the hub has discarded that key, it can never sign another
//	repair for that controller. Nothing reaches it again short of a physical
//	factory reset, which for a gate controller means someone with a ladder.
//
// So both keys are kept, and each command is signed with whichever key its
// TARGET pins, until nothing pins the old one. That is what makes rotation
// interruptible: a hub can be restarted, a controller can be offline for a
// fortnight, and the repair is still deliverable when it comes back.
//
// # Where the seeds live, and why not in the database
//
// Beside it, in 0600 files, which is where this hub has always kept its signing
// seed. Moving them into the database would put the signing identity into every
// backup and every replica of it. Only public halves and bookkeeping go in the
// store (migration 0023).
//
// # The crash windows, and why one of them is benign by construction
//
// Rotate writes the OLD seed to the previous-key file before generating the
// new one, so the sequence is: current is safe on disk, current is also safe in
// the previous file, then current is replaced. Losing power at any point leaves
// a readable key for every controller:
//
//	before the previous file is written   nothing has changed
//	after it, before the new seed lands   previous and current hold the SAME
//	                                      key, which Load treats as no rotation
//	                                      in flight — see loadPrevious
//	after the rename                      the rotation is under way as intended
//
// The middle case is the one worth naming: without the dedupe, a hub would come
// back believing it was mid-rotation with a previous key identical to its
// current one, and would go on offering to repair controllers onto the key they
// already pin.

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// previousKeyFile holds the key controllers pinned before the rotation now in
// flight. Its presence IS the "a rotation is in flight" flag: there is no
// second place to disagree with.
const previousKeyFile = "gateway_ed25519.previous.seed"

// ErrRotationInFlight reports an attempt to start a rotation while one is
// already running.
//
// Refused rather than restarted, because starting a second rotation would
// discard the key some controllers still pin — the precise outcome this whole
// file exists to prevent.
var ErrRotationInFlight = errors.New("keys: a key rotation is already in flight; complete or abandon it first")

// ErrUnknownPin reports a request to sign for a controller pinning a key this
// hub does not hold.
var ErrUnknownPin = errors.New("keys: no signing key matches the pinned public key")

// HasPrevious reports whether a rotation is in flight.
func (k *Keys) HasPrevious() bool { return k.prevPriv != nil }

// PreviousPublicKeyB64 returns the retained previous public key, or "".
func (k *Keys) PreviousPublicKeyB64() string {
	if k.prevPub == nil {
		return ""
	}
	return b64.EncodeToString(k.prevPub)
}

// Rotate generates a new signing key, retaining the current one for controllers
// that have not yet been repaired onto the new one.
//
// Returns the new public key. The hub signs with it for everything that does
// not name a pin — new pairings, /v1/gateway/key — from this moment; existing
// controllers keep being signed for with the retained key until each
// acknowledges its repair.
func (k *Keys) Rotate() (string, error) {
	if k.HasPrevious() {
		return "", ErrRotationInFlight
	}
	if k.dir == "" {
		return "", errors.New("keys: this key was not loaded from a directory and cannot be rotated")
	}

	// The current seed is written to the previous-key file FIRST. Until that
	// file exists and is durable, nothing else may change: a crash here must
	// leave a hub that can still sign for every controller it has.
	seed := k.priv.Seed()
	if err := writeSeed(filepath.Join(k.dir, previousKeyFile), seed); err != nil {
		return "", fmt.Errorf("keys: retaining the current key: %w", err)
	}

	newSeed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(newSeed); err != nil {
		return "", err
	}
	if err := replaceSeed(filepath.Join(k.dir, keyFile), newSeed); err != nil {
		// The previous-key file now holds the same key as the current one. Load
		// dedupes that on the next boot, and so does the cleanup here.
		_ = os.Remove(filepath.Join(k.dir, previousKeyFile))
		return "", fmt.Errorf("keys: writing the new key: %w", err)
	}

	k.prevPriv, k.prevPub = k.priv, k.pub
	k.priv = ed25519.NewKeyFromSeed(newSeed)
	k.pub = k.priv.Public().(ed25519.PublicKey)
	return k.PublicKeyB64(), nil
}

// RetirePrevious destroys the retained key, ending the rotation.
//
// The caller is responsible for having established that nothing pins it. This
// function cannot check that itself — it holds no store — and the check is the
// entire safety property, so the one place that calls this says out loud what
// it verified first.
func (k *Keys) RetirePrevious() error {
	if !k.HasPrevious() {
		return nil
	}
	if err := os.Remove(filepath.Join(k.dir, previousKeyFile)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("keys: removing the retained key: %w", err)
	}
	k.prevPriv, k.prevPub = nil, nil
	return nil
}

// SignCommandForPin is SignCommandWithPayload, signed with whichever retained
// key the target controller pins.
//
// pinnedPub is the controller's pinned public key, base64url. An empty string
// means "whatever is current" — the case for a controller paired since the
// rotation, and for every controller when no rotation is in flight.
//
// A pin this hub cannot match is an ERROR, not a fallback to the current key.
// Falling back would produce a command the controller rejects as badsig, which
// looks like a broken controller rather than like the bookkeeping being wrong;
// and if the bookkeeping is wrong, the thing not to do is sign more commands on
// the strength of it.
func (k *Keys) SignCommandForPin(pinnedPub, cmd, deviceID, accessPoint string, payload map[string]any, ttl time.Duration, cause map[string]any) (*Envelope, error) {
	signer, err := k.signerFor(pinnedPub)
	if err != nil {
		return nil, err
	}
	return signWith(signer, cmd, deviceID, accessPoint, payload, ttl, cause)
}

// signerFor selects the private key matching a pinned public key.
func (k *Keys) signerFor(pinnedPub string) (ed25519.PrivateKey, error) {
	switch pinnedPub {
	case "", k.PublicKeyB64():
		return k.priv, nil
	case k.PreviousPublicKeyB64():
		// PreviousPublicKeyB64 is "" when no rotation is in flight, and the
		// empty case is already handled above, so this arm is unreachable
		// without a retained key rather than matching on a coincidence.
		return k.prevPriv, nil
	default:
		return nil, fmt.Errorf("%w: %s", ErrUnknownPin, pinnedPub)
	}
}

// writeSeed persists a seed with the same permissions and encoding Load
// expects, durably: an fsync before the caller is told it succeeded, because
// the whole point of writing this file is to survive the power loss that
// happens next.
func writeSeed(path string, seed []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write([]byte(hex.EncodeToString(seed))); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// replaceSeed writes a seed to a temporary file and renames it over path, so a
// crash mid-write cannot leave a truncated seed where the signing key belongs.
func replaceSeed(path string, seed []byte) error {
	tmp := path + ".tmp"
	if err := writeSeed(tmp, seed); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	// The rename itself needs the directory entry on disk before this returns.
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

// loadPrevious reads the retained key, if a rotation is in flight.
//
// A previous file holding the same key as the current one is treated as no
// rotation: that is the benign crash window described at the top of this file,
// and carrying on as though a rotation were under way would have the hub
// offering to repair controllers onto the key they already pin.
func loadPrevious(dir string, current ed25519.PrivateKey) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	raw, err := os.ReadFile(filepath.Join(dir, previousKeyFile))
	if os.IsNotExist(err) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	seed, err := hex.DecodeString(string(raw))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, nil, fmt.Errorf("keys: corrupt retained key file %s", filepath.Join(dir, previousKeyFile))
	}
	if bytes.Equal(seed, current.Seed()) {
		// Crashed between retaining the old key and writing the new one.
		if err := os.Remove(filepath.Join(dir, previousKeyFile)); err != nil && !os.IsNotExist(err) {
			return nil, nil, err
		}
		return nil, nil, nil
	}
	priv := ed25519.NewKeyFromSeed(seed)
	return priv, priv.Public().(ed25519.PublicKey), nil
}
