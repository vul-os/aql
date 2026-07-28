# Accountless pairing + key pinning — the pattern

[`pairing.md`](pairing.md) is the wire contract: the messages, the fields, the
order. This document is the **discipline** those messages exist to enforce, and
it is written to be copied into a different product with different messages.

**Reference implementation:** `controller/internal/pairing/pairing.go` (the
ceremony), `controller/internal/state/state.go` (the enforcement).
**Held by:** `controller/internal/state/pinning_test.go`,
`controller/internal/state/unpinned_test.go`,
`controller/internal/command/command_vectors_test.go`.

---

## The claim

> The redeem response is the **only** moment a gateway key is accepted.
> Thereafter only a `repair` command signed by the **currently pinned key**, or
> a physical factory reset, can change it.

Everything below exists to make that sentence true in code rather than in a
comment.

## Why "accountless" is the interesting part

The device at the gate has no user account, no password, no login, and no way
for a human to intervene once it is in a wall. It cannot be asked to confirm
anything. So the entire trust relationship is established in one HTTP exchange
and then frozen:

1. An admin creates a device in the portal and gets a **claim token** — random
   ≥128 bits, stored **hashed** server-side, single-use, short TTL.
2. The device generates its own keypair **on device** at first boot. The
   private key never leaves it. There is no key escrow, no factory-provisioned
   secret, and therefore nothing a supply-chain attacker can copy.
3. The device POSTs the claim token plus its public key. The token is burned on
   redemption.
4. The response carries the gateway's public key. **The device pins it.**

After step 4 the device trusts exactly one key in the world. TLS is transport
privacy; the pinned key is the authority. A compromised or replaced gateway,
a hostile DNS answer, a proxy with a valid certificate — none of them can
command the device, because none of them hold the pinned key.

## The four rules

### 1. One acceptance moment

The key is accepted at redemption and nowhere else. Not on reconnect, not from
a config file, not from an mDNS announcement, not from a "recovery" endpoint.

### 2. Re-pairing may not rotate the key

A second redeem with a *different* key must be **refused**, not treated as a
re-pair. Otherwise anyone who can trigger a redeem against a gateway they
control takes ownership of a device somebody else already owns. A redeem with
the *same* key is allowed, so ws-url and poll-interval can be refreshed without
a factory reset.

```go
if cur != nil && cur.GatewayPubkey != p.GatewayPubkey {
    return ErrKeyChangeRefused
}
```

### 3. Rotation is a signed command, verified against the key being replaced

The only sanctioned rotation is a `repair` command whose signature verifies
against the **currently pinned** key. The swap function itself verifies
nothing — its contract is that the caller already did — which means the
contract lives in a comment, which means it needs the structural test in rule 4.

### 4. Factory reset is physical

Deleting the state directory. Not an API, not a command, not a magic payload.
If software can reset the pin, the pin is only as strong as the weakest path
into that software.

## Enforcing it: the test that is actually load-bearing

Rules 1–3 are behavioural and easy to test. The thing that breaks them later is
not a behaviour change — it is a **new call site**. `ApplyRepair` does not
verify anything; it is safe because exactly one caller exists and that caller
sits on the far side of a signature check. A second caller anywhere — a config
reload, an admin hook, a recovery path — rotates the trust root with no
signature, and *every existing behavioural test still passes*.

So the set of writers is asserted directly
(`TestOnlyTwoDoorsWriteThePinnedGatewayKey`):

- exactly **one** assignment to the pinned key field in the entire module, and
  it is inside `ApplyRepair`;
- exactly **one** caller of `ApplyRepair`, in the package that verifies the
  repair envelope;
- exactly **one** caller of `SavePairing`, in the pairing package.

Three details that matter if you copy this:

- **Scan build-tagged files too.** A `gpio`- or `ble`-only file that wrote the
  key would be just as much of a takeover, and excluding it because the default
  build skips it is how a tagged file becomes the place to hide things.
- **Skip comments, count code.** The false positive is a comment *explaining*
  the assignment; whoever hits it will weaken the test rather than fix the code.
- **Assert the scan found something.** `if len(files) < 20 { t.Fatal("the scan
  is broken, not the code") }`. A structural test whose walk silently returned
  nothing passes.

## An unpinned controller refuses

The state above has a third case that neither "paired" nor "unpaired" covers: a
device that *believes* it is paired but whose stored key will not decode — a
truncated write, a half-flushed SD card, a corrupted filesystem.

The answer must be **refuse everything**, including a valid command from the
real gateway. With no usable pinned key there is nothing to verify against, so
nothing can be authenticated, so nothing may be accepted. That is the pin taken
literally rather than softened.

The failure mode to check for when copying this: most Ed25519 libraries
**panic** on a wrong-sized public key rather than returning false.
`ed25519.Verify` in Go does (`ed25519: bad public key length: 0`). Every
wire-borne key normally arrives through a decoder that enforces the length; the
*pinned* key is the one that does not, because it came from disk. A controller
with a corrupt state file therefore crashed on the first command it received —
a daemon dying at a physical gate — instead of refusing it. Guard the length at
the verification primitive:

```go
if len(pub) != ed25519.PublicKeySize {
    return false
}
```

(`controller/internal/wire/wire.go`, held by
`TestAnUndecodablePinnedKeyRefusesInsteadOfPanicking`.)

## Fail-closed persistence

Pinning is a promise about durable state, so the persistence layer is part of
the security boundary, not plumbing underneath it:

- Write atomically (temp file + rename, mode 0600).
- A mutation that cannot be persisted **returns an error and rolls back
  memory**. Otherwise a failed disk write during a repair leaves the new key in
  memory and the old key on disk: the gateway gets an error ack and carries on
  signing with the old key, the device rejects it, and they disagree until the
  next reboot. A lockout produced by a guarantee the doc comment stated
  unconditionally.
- **The rollback snapshot must be deep for every reference field.** `prev :=
  s.data` copies the struct and *shares* its maps, slices and pointers with the
  live state. The pinned key lived behind a pointer, so the rollback restored
  everything except the one field that had actually changed. Snapshot fields no
  mutator shares today as well — a future one that assigns into a slice instead
  of replacing it would silently leave the rollback partial.

(`TestAFailedPersistRollsBackEveryField`.)

## Transport rules the ceremony depends on

- `ws_url` from the grant must be `wss://`. A plaintext downgrade is refused;
  the test-only escape hatch is an explicit flag on the client struct, never a
  default and never inferred from the environment.
- The redeem response body is read through a `LimitReader`. A hostile or broken
  gateway must not be able to exhaust a device's memory during the one exchange
  that happens before any authentication exists.
- The response `typ` is checked before anything is persisted.

## Checklist

- [ ] device keypair generated on device; private key never leaves it
- [ ] claim token ≥128 bits, stored hashed, single-use, short TTL, burned on redeem
- [ ] the pinned key is accepted at exactly one moment
- [ ] a redeem carrying a different key is refused, not treated as re-pair
- [ ] rotation requires a signature from the key being replaced
- [ ] factory reset is physical
- [ ] a test asserts the *set* of code paths that write the key, not just their behaviour
- [ ] verification refuses an unusable pinned key instead of panicking
- [ ] persistence is atomic, fail-closed, and rolls back deeply
