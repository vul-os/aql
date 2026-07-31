package keys

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"
)

// Envelope is a signed command per proto/commands.md v0. sig is
// base64url(ed25519(gateway_key, JCS(envelope minus sig))).
//
// access_point is present only for open/hold/close (lockdown/lift/ping/
// config/repair carry none); optional fields are omitted entirely when
// absent — never null, never empty-string — because they are covered by the
// signature only when present (proto/vectors/README.md).
type Envelope struct {
	V           int            `json:"v"`
	Typ         string         `json:"typ"`
	Cmd         string         `json:"cmd"`
	DeviceID    string         `json:"device_id"`
	AccessPoint string         `json:"access_point,omitempty"`
	Nonce       string         `json:"nonce"`
	IAT         int64          `json:"iat"`
	EXP         int64          `json:"exp"`
	Payload     map[string]any `json:"payload,omitempty"`
	Cause       map[string]any `json:"cause,omitempty"`
	Sig         string         `json:"sig,omitempty"`
}

// The hub's side of the four wire constants published by every vectors
// document's `spec_constants` block. They live together in this one package
// because they had been spread across three — keys held two, hub/internal/hub
// restated the cnonce TTL as its own literal, and httpapi restated the stale
// clock limit as `14 * 24 * 60 * 60`. Each restatement was a place the hub could
// silently come to disagree with the controller that has to verify what it
// mints, and a disagreement only surfaces as a door refusing a legitimate
// command in the field.
//
// spec_constants_test.go checks all four against proto/vectors/. The controller
// checks its own copy the same way; the two implementations agree because they
// both agree with the vectors, not because anyone compared them.

// MaxCommandTTL is proto/commands.md's `exp - iat ≤ 60`.
const MaxCommandTTL = 60 * time.Second

// ClockSkewSeconds is the ±90 s allowance applied to BOTH validity bounds:
// iat − skew ≤ now ≤ exp + skew (proto/commands.md §Verification step 3).
const ClockSkewSeconds = 90

// CnonceTTLSeconds is pairing.md's 30 s grant.challenge / ws.challenge
// validity.
const CnonceTTLSeconds = 30

// StaleClockLimitSeconds is 14 d — twice the default grant TTL. A controller
// whose clock has not been confirmed for longer than this refuses offline
// redemption outright, so the hub uses the same figure to decide when to warn
// that one is at risk of doing so.
const StaleClockLimitSeconds = 14 * 24 * 60 * 60

// NewNonce returns base64url(128-bit random) per the envelope spec.
func NewNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// signable renders the envelope minus sig as the JCS map the signature covers.
func (e *Envelope) signable() map[string]any {
	m := map[string]any{
		"v":         e.V,
		"typ":       e.Typ,
		"cmd":       e.Cmd,
		"device_id": e.DeviceID,
		"nonce":     e.Nonce,
		"iat":       e.IAT,
		"exp":       e.EXP,
	}
	if e.AccessPoint != "" {
		m["access_point"] = e.AccessPoint
	}
	if e.Payload != nil {
		m["payload"] = e.Payload
	}
	if e.Cause != nil {
		m["cause"] = e.Cause
	}
	return m
}

// SignCommand builds and signs a command envelope. ttl is clamped to
// MaxCommandTTL, fail-closed at the controller anyway.
//
// For the commands that carry parameters — `config` and `repair`, whose
// payloads proto/commands.md §47 defines — use SignCommandWithPayload.
func (k *Keys) SignCommand(cmd, deviceID, accessPoint string, ttl time.Duration, cause map[string]any) (*Envelope, error) {
	return k.SignCommandWithPayload(cmd, deviceID, accessPoint, nil, ttl, cause)
}

// SignCommandWithPayload is SignCommand for the commands that carry one.
//
// The payload is covered by the signature — it goes through the same
// canonicalisation as every other field — which is the only reason a
// controller can trust a `config` that changes how long its relay fires, or a
// `repair` that replaces the key it verifies everything else against.
//
// This existed as a gap rather than a decision: the hub could once sign only
// bare commands, so four of proto/commands.md's eight types (hold, config,
// ping, repair) had no sender at all despite the controller implementing and
// conformance-testing every one of them.
//
// All four have one now — hold through the open path, config through
// deviceconfig.go, ping through clocksync.go's sweep, repair through
// keyrotation.go. The two without a hub sender are `lockdown` and `lift`, and
// that is deliberate rather than outstanding: they are controller-local, as
// offline_grants.go explains.
func (k *Keys) SignCommandWithPayload(cmd, deviceID, accessPoint string, payload map[string]any, ttl time.Duration, cause map[string]any) (*Envelope, error) {
	return signWith(k.priv, cmd, deviceID, accessPoint, payload, ttl, cause)
}

// signWith builds and signs an envelope with an explicit private key.
//
// Factored out rather than duplicated for the rotation path: an envelope signed
// with the retained key must be byte-identical in every respect except the
// signature, and two copies of this construction would drift the first time a
// field was added to one of them. Which key signs is the ONLY thing
// SignCommandForPin changes.
func signWith(priv ed25519.PrivateKey, cmd, deviceID, accessPoint string, payload map[string]any, ttl time.Duration, cause map[string]any) (*Envelope, error) {
	if ttl <= 0 || ttl > MaxCommandTTL {
		ttl = MaxCommandTTL
	}
	nonce, err := NewNonce()
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	e := &Envelope{
		V: 0, Typ: "cmd", Cmd: cmd,
		DeviceID: deviceID, AccessPoint: accessPoint,
		Nonce: nonce, IAT: now, EXP: now + int64(ttl/time.Second),
		Payload: payload, Cause: cause,
	}
	msg, err := Canonicalize(e.signable())
	if err != nil {
		return nil, err
	}
	e.Sig = b64.EncodeToString(ed25519.Sign(priv, msg))
	return e, nil
}

// VerifyEnvelope checks the signature (and only the signature — the full
// fail-closed decision is VerifyCommand) of an envelope against a gateway
// public key.
func VerifyEnvelope(pub ed25519.PublicKey, e *Envelope) error {
	if e.Sig == "" {
		return fmt.Errorf("envelope: missing sig")
	}
	msg, err := Canonicalize(e.signable())
	if err != nil {
		return err
	}
	if !Verify(pub, msg, e.Sig) {
		return fmt.Errorf("envelope: bad signature")
	}
	return nil
}

// Reject reasons — the shared cmd.ack `detail` vocabulary
// (proto/commands.md §Acknowledgement).
const (
	ReasonBadSig           = "badsig"
	ReasonWrongDevice      = "wrong_device"
	ReasonWrongAccessPoint = "wrong_access_point"
	ReasonWindowTooLong    = "window_too_long"
	ReasonNotYetValid      = "not_yet_valid"
	ReasonExpired          = "expired"
	ReasonReplay           = "replay"
	ReasonLockdown         = "lockdown"
)

// Reject is the fail-closed verification verdict: Reason is the
// machine-readable detail reported in the cmd.ack / denied event.
type Reject struct{ Reason string }

func (r *Reject) Error() string { return "envelope rejected: " + r.Reason }

// NonceSet is a seen-nonce store for replay protection. The zero value is
// unusable on purpose: a nil set fails closed (every command is a replay).
type NonceSet map[string]struct{}

// Seen reports whether nonce was already accepted.
func (s NonceSet) Seen(nonce string) bool {
	_, ok := s[nonce]
	return ok
}

// Mark records nonce as accepted.
func (s NonceSet) Mark(nonce string) { s[nonce] = struct{}{} }

// VerifyContext is everything the fail-closed envelope decision needs beyond
// the envelope itself (proto/commands.md §Verification).
type VerifyContext struct {
	Now          int64    // verification-time clock, unix seconds
	DeviceID     string   // the verifying controller's own device_id
	AccessPoints []string // access points this controller serves
	Lockdown     bool     // lockdown latched?
	Seen         NonceSet // accepted nonces; nil fails closed
}

// lockdownAllowed is the lockdown matrix: while latched, only these commands
// are accepted (proto/commands.md §Verification step 5).
//
// `revoke` is included: it actuates nothing and can only ADD denials, so it
// cannot weaken the freeze. See the controller's copy of this map for the
// sequence that excluding it broke.
var lockdownAllowed = map[string]bool{
	"lift": true, "ping": true, "config": true, "repair": true, "revoke": true,
}

// needsAccessPoint lists the commands that actuate a specific access point.
var needsAccessPoint = map[string]bool{
	"open": true, "hold": true, "close": true,
}

// VerifyCommand runs the complete fail-closed controller-side verification of
// a command envelope, in the normative order (first failure wins): sig,
// device_id/access_point, window + iat/exp with ±ClockSkewSeconds on both
// bounds, nonce replay, lockdown matrix. On acceptance the nonce is recorded
// in ctx.Seen. Returns nil to actuate, or *Reject with the reported reason.
func VerifyCommand(pub ed25519.PublicKey, e *Envelope, ctx VerifyContext) error {
	// 1. Signature against the pinned gateway key.
	if err := VerifyEnvelope(pub, e); err != nil {
		return &Reject{ReasonBadSig}
	}
	// 2. Addressed to this controller, at an access point it serves.
	if e.DeviceID != ctx.DeviceID {
		return &Reject{ReasonWrongDevice}
	}
	if needsAccessPoint[e.Cmd] {
		served := false
		for _, ap := range ctx.AccessPoints {
			if ap == e.AccessPoint && ap != "" {
				served = true
				break
			}
		}
		if !served {
			return &Reject{ReasonWrongAccessPoint}
		}
	}
	// 3. Validity window: iat ≤ exp, exp − iat ≤ 60, skew on both bounds.
	if e.IAT > e.EXP || e.EXP-e.IAT > int64(MaxCommandTTL/time.Second) {
		return &Reject{ReasonWindowTooLong}
	}
	if ctx.Now < e.IAT-ClockSkewSeconds {
		return &Reject{ReasonNotYetValid}
	}
	if ctx.Now > e.EXP+ClockSkewSeconds {
		return &Reject{ReasonExpired}
	}
	// 4. Nonce never seen (nil store or empty nonce fails closed).
	if ctx.Seen == nil || e.Nonce == "" || ctx.Seen.Seen(e.Nonce) {
		return &Reject{ReasonReplay}
	}
	// 5. Lockdown matrix.
	if ctx.Lockdown && !lockdownAllowed[e.Cmd] {
		return &Reject{ReasonLockdown}
	}
	ctx.Seen.Mark(e.Nonce)
	return nil
}
