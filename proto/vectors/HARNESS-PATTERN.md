# The vector harness pattern

**Audience: another repository that wants to copy this.** This describes the
*shape* of `proto/vectors/`, not the aql contracts. Nothing here is
aql-specific except the examples.

The problem it solves: you have a wire format implemented more than once — a
signer and a verifier, two languages, a server and an SDK, a product and a
third-party firmware — and prose cannot keep them agreeing. Specs get read
differently. Tests written next to an implementation prove that implementation
reproduces itself.

---

## The three files

Copy this structure verbatim; the discipline is in the split.

| File | Role | Hard rule |
| --- | --- | --- |
| `generate.mjs` | **produces** the corpus | Running it twice must write byte-identical files. |
| `*.json` | **is** the corpus | Committed. Machine-written, human-reviewed in diffs. |
| `verify.mjs` | **re-derives** the corpus, independently | Exit 0 or the build fails. |
| `lib.mjs` | primitives both share | Node builtins only. No dependency, ever. |

`verify.mjs` is not a test of `generate.mjs`. It is a second implementation of
the *contract*, written from the prose spec, that happens to read the same
files. If it imported the generator's decision logic it would prove nothing.
(In this repo they share `lib.mjs` — the crypto and canonicalisation
primitives — and nothing else. `verify.mjs` re-implements every verification
rule from `../commands.md` / `../grants.md` / `../pairing.md` by hand, in the normative
order those documents state.)

## The rule that makes it work

> **The vector wins over the code.**

An implementation that disagrees with a vector is wrong. If the *vector* is
wrong, you fix the vector first, in its own commit, and then the code. Never
the other way around, and never "adjust the expected value until it passes" —
that is the single failure mode this whole structure exists to prevent, and it
looks exactly like ordinary maintenance in a diff.

Write it at the top of your README so it is a rule somebody can point at.

## Determinism, concretely

Byte-reproducibility is what lets a reviewer trust a 2,000-line generated JSON
diff. Everything that could vary must be pinned:

- **Fixed keys.** Derive test keys from a hardcoded constant (here: the seed is
  `sha256("<product>-test-vector:<name>")`, written out as hex so it never
  depends on the hash being recomputed).
- **Fixed clock.** One base timestamp constant, everything relative to it.
  Never `Date.now()`.
- **Fixed nonces / ids.** `Buffer.alloc(16, n)`, `uuid-…-000000000001`. Never
  random.
- **A deterministic signature scheme**, or a recorded one. Ed25519 (RFC 8032)
  is deterministic, so re-signing must reproduce the stored bytes exactly —
  which `verify.mjs` asserts. ECDSA is not; if you must use it, verify the
  signature instead of re-deriving it and say so.
- **Stable serialisation.** `JSON.stringify(doc, null, 2) + '\n'`.

Prove it in CI, not by assertion:

```sh
node vectors/generate.mjs && git diff --exit-code vectors/
```

## Vector shape

```jsonc
{
  "name": "cmd-open-expired",
  "desc": "…what a human needs to know…",
  "expect": "reject",          // or "accept"
  "reason": "expired",         // rejects only — the reason your impl must report
  "check":  { "now": 1789000010, "…verifier-side context…": "" },
  "signer": "gateway",         // which test key produced sig (null if unsigned/tampered)
  "object": { "…the wire message exactly as transmitted, incl. sig…": "" },
  "canonical": "{\"…\":\"exact bytes the signature covers\"}"
}
```

Four properties earn their keep:

1. **`canonical` as a separate field.** This is the single highest-value thing
   in the format. It lets an implementer byte-compare their serialiser *before
   any crypto runs*, which turns "signature doesn't verify" — undebuggable —
   into "your key ordering is wrong", visible in a diff. Publish the preimage
   for whatever your scheme signs over, always.
2. **`check`** carries the verifier-side context (clock, identity, state), so
   the corpus is consumable by a stateless test in any language. Without it,
   time-dependent vectors are only runnable by whoever knows the fixture.
3. **`reason` on every reject.** "It failed" is satisfied by an implementation
   that fails for a different reason than the one under test — including
   failing on a typo in the fixture. Assert the reason.
4. **Single-fault rejects.** Exactly one rule fails per reject vector, so the
   reason is unambiguous no matter what order an implementation checks in. Put
   the normative order in the prose spec and make `verify.mjs` follow it; the
   vectors then do not depend on it.

## Layers, and what each one is worth

State these explicitly for consumers, because each layer catches a different
class of bug and skipping one is invisible:

| Layer | Assertion | Catches |
| --- | --- | --- |
| 0 | hand-derived edge cases → your serialiser | key ordering, escaping, number spelling, encoding |
| 1 | your serialiser output == `canonical` | the above, on real documents |
| 2 | your signature over `canonical` == `object.sig` | key handling, encoding framing (raw vs DER vs PEM) |
| 3 | your full verifier + `check` == `expect`/`reason` | rule order, boundary conditions, replay handling |

Layer 0 lives in a separate file (`proto/jcs-cases.json` here) because it is
*hand-derived from the RFC*, not generated. Captured output only proves an
implementation reproduces itself. It is also where cross-language divergence
gets pinned when it cannot be eliminated — see `proto/JCS-PROFILE.md`.

## Multi-step flows

Replay and nonce-reuse need two messages, so a vector may carry `steps`: the
same signed object presented twice, step 0 accepting and step 1 rejecting.
Anything stateful (a nonce store, a used-challenge set) is created per vector
and threaded through the steps.

## Coverage counts are part of the harness

A corpus-driven test whose corpus fails to load reports **PASS while checking
nothing**. Every consumer of these files must assert how much it actually ran:

```js
if (!Array.isArray(doc.cases) || doc.cases.length < 14) fail('…');
…
if (ran !== expected) fail('…', `ran ${ran} of ${expected}`);
```

```go
if compared < 93 {
    t.Errorf("compared only %d documents; the corpus has 93 canonical encodings", compared)
}
```

This is not defensive padding. A gate reporting "24/24" while running zero
vectors has shipped in this suite before.

## What to tell consumers

Put this in the README, with your numbers:

- Run `node vectors/verify.mjs`; **exit 0 or you are not conformant**.
- Consume by byte-comparing at each layer, in order. Do not skip to layer 3
  because it is the one that looks like a real test.
- Key/binary format, stated with no room to guess: exactly what bytes, in
  exactly what encoding, with what framing (and what framing is *not* used).
- An honesty section naming the subset you implement and what you deliberately
  do not — see "JCS subset used" in the README here. An implementer who hits
  the unimplemented edge should find it written down, not discover it at a
  gate.

## Where this pattern is weakest

Say so out loud rather than letting a consumer over-trust it:

- The corpus only covers documents somebody thought to write. Pair it with
  property-based fuzzing of the same code (`jcs/fuzz_test.go` here:
  idempotence, determinism across map iteration order, value preservation).
- `verify.mjs` is independent of the *implementations*, not of the *spec
  author*. A misreading of the prose that both the generator and the verifier
  share is invisible. Layer 0's hand-derived cases are the partial answer; a
  genuinely third implementation is the full one.
- Byte-reproducibility is only checked if CI runs the regeneration diff. Add
  the step.
