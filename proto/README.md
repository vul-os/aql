# lintel wire contracts

These are the contracts that outlive binaries. Controllers get installed at physical
gates and stay there for years; the app ends up on phones we don't control. Everything
in this directory is **versioned, additive-only**: a field can be added, a message can
be added, nothing can be removed or change meaning within a major version.

| Contract | File | Parties |
| --- | --- | --- |
| Pairing | [pairing.md](pairing.md) | hub ⇄ controller |
| Signed commands | [commands.md](commands.md) | hub → controller |
| Offline grants | [grants.md](grants.md) | hub → app → controller |
| Controller events | [events.md](events.md) | controller → hub |
| Chat rail disclosure | [rails.md](rails.md) | hub ⇄ chat platform |
| Outbound webhooks | [WEBHOOK-PROFILE.md](WEBHOOK-PROFILE.md) | hub → operator's receiver |

`rails.md` is the odd one out: it is a **disclosure**, not a wire format. The four
contracts above say what bytes cross a link we control; `rails.md` says what a link we
*don't* control can and cannot do, and who reads the plaintext on it — the four fields
[KOTVA §26.3](https://github.com/vul-os/kotva/blob/main/26-legacy-adapters.md) requires
every adapter to declare. It lives here because it constrains the same boundary.

Status: **v0 draft** — to be implemented by the Go hub port. v1 freezes when the
first third-party controller firmware ships.

## Conventions

- All signatures are **Ed25519** over canonical JSON (JCS, RFC 8785) unless stated.
- All binary values are base64url without padding. All timestamps are Unix seconds (UTC).
- Every signed envelope carries `v` (contract major version) and `typ`.
- Controllers **pin the hub's public key at pairing** and reject anything else,
  regardless of transport. TLS is transport privacy; Ed25519 is the authority.
- Nonces are single-use per controller; controllers keep a small replay window and
  reject reused or expired material fail-closed.
- The signing rule, everywhere: remove the `sig` member, serialize the remaining
  object with JCS (RFC 8785), sign the resulting UTF-8 bytes; `sig` is the
  base64url (no padding) of the 64-byte Ed25519 signature. Optional members are
  **omitted entirely** when absent (never `null`) and are covered by the signature
  when present.
- Public keys on the wire are the raw 32-byte Ed25519 public key, base64url, no
  padding (no PEM/DER/multibase framing).
- Executable conformance vectors (fixed test keys, canonical bytes, accept/reject
  cases) live in [vectors/](vectors/) — implementations must pass them before
  claiming v0 conformance.

## Cross-cutting profiles

These are not wire contracts; they are the disciplines the contracts above
depend on, written so another product can reuse them.

| Profile | What it specifies |
| --- | --- |
| [JCS-PROFILE.md](JCS-PROFILE.md) | the RFC 8785 subset every signature is taken over, the three implementations, and the one place they diverge (pinned in [jcs-cases.json](jcs-cases.json)) |
| [PAIRING-PROFILE.md](PAIRING-PROFILE.md) | the accountless pairing + key-pinning ceremony behind [pairing.md](pairing.md), and how the pin is enforced rather than asserted |
| [WEBHOOK-PROFILE.md](WEBHOOK-PROFILE.md) | the outbound webhook wire format, delivery semantics and SSRF discipline, implementable from [vectors/webhooks.json](vectors/webhooks.json) alone |
| [vectors/HARNESS-PATTERN.md](vectors/HARNESS-PATTERN.md) | how this vector harness is built, for a repository that wants to copy the approach |
