# Security policy

Aql opens **physical gates, doors and barriers**. A security bug here is not a data leak
— it can let someone through a gate they should never pass, or lock out someone who must
get in. Please treat disclosure accordingly.

The intended posture, and an honest account of what is and is not defended today, is in
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Reporting a vulnerability

**Report privately. Do not open a public issue for anything exploitable.**

- Email: **vulosorg@gmail.com**
- Or use GitHub's private vulnerability reporting on
  [vul-os/aql](https://github.com/vul-os/aql/security/advisories/new)

Include what you can: affected component, reproduction steps, impact as you understand
it, and any suggested fix. You will get an acknowledgement, and we will work with you on a
fix and a coordinated disclosure timeline. Given the physical-safety angle, please allow
reasonable time for operators to update before publishing details.

There is **no bug bounty** — this is an open-source project with no billing system and no
revenue. What we offer is fast engagement and credit in the fix.

## Scope

In scope, roughly in order of severity:

1. **Controller protocol** ([`proto/`](proto/)) — anything that forges, replays or
   bypasses Ed25519-signed open commands, pairing, or offline grants: nonce reuse, expiry
   bypass, key-pinning escape, challenge-response weaknesses, or a conformance vector that
   the implementations and the spec disagree about.
2. **The hub** ([`gateway/`](gateway/)) — authn/authz bypass, tenant-isolation escapes,
   open-path choke-point bypass, rate-limit or quota evasion, channel-identity spoofing
   that leads to an open.

   **Audit-log tampering, specifically:** `access_logs` and `admin_audit_log` are
   hash-chained (migration `0007_audit_hash_chain.sql`) and the chain is walkable via
   `GET /v1/admin/audit/verify` or `gateway verify-audit`. A bug that lets an
   *authenticated request* forge, backdate or silently mutate an audit row without
   breaking that chain — or a bypass of the append-only DB triggers from application code
   — is in scope and worth a report. What is **not** a bug: someone with direct
   filesystem access to the box editing `lintel.db` and recomputing every downstream hash.
   That was always the trust boundary of a self-hosted single-file database; the hash
   chain turns *silent* tampering by that party into *detectable* tampering, and does not
   and cannot prevent it. Don't report "I have root on the box and can edit the database";
   do report anything that achieves the same result through the running application.
3. **Chat webhooks** — signature-verification flaws on channel ingress (Meta HMAC, Slack
   signing secret + replay window, Telegram secret token), and sender-identity spoofing
   that leads to an open.
4. **Console / web** ([`src/`](src/), [`site/`](site/)) — XSS, CSRF, token handling.
5. **The controller agent** ([`controller/`](controller/)) — anything that makes it accept
   a command or grant it should have refused, or that breaks its fail-closed ordering.

Out of scope: vulnerabilities in Meta, Slack or Telegram themselves; self-inflicted
misconfiguration of a self-hosted hub (e.g. publishing your `.env`, or binding a public
address with `-behind-proxy` and no proxy); and volumetric DoS.

**Known and documented, so not a finding:** the chat rail is not private — Meta, Slack and
Telegram see the plaintext of every message, because the hub must read it to act on it.
Geofencing and time-window rules do not exist, so there is nothing there to bypass. There
is no 2FA and no in-band recovery for a lost sole instance-admin password. See
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Physical safety vs. security

This policy is about *security* — code, protocol and cryptographic flaws that let someone
bypass or forge an open. **Physical installation safety** — fire-code egress compliance,
fail-safe wiring, why Aql must never be the only way out of a building — is a separate,
non-negotiable topic covered in [Safety](README.md#safety) in the main README. It's an
operator and compliance responsibility, not usually a code bug, but if you believe this
repo's own docs recommend something physically unsafe, report that here too: that's a
documentation defect worth fixing fast.

Related: the `-tags gpio` relay driver is an unimplemented stub that panics by design, and
the BLE radio layer has never been validated on hardware. Neither is a vulnerability —
both are documented gaps — but do not deploy either to a real gate expecting them to work.

## Supported versions

The `main` branch is the supported line. The wire contracts in `proto/` are versioned
additive-only; security fixes that require breaking a contract will be released as a new
contract major version with migration notes.
