# JCS profile — the canonicalisation subset, and where implementations diverge

Every signature in [`proto/`](README.md) is Ed25519 over
`JCS(message minus sig)`, never over raw byte concatenation. This document says
exactly which subset of RFC 8785 that means, which implementations exist, and
what holds them together.

**Corpus:** [`jcs-cases.json`](jcs-cases.json) (hand-derived edge cases) and
every `canonical` field in [`vectors/`](vectors/) (93 real documents).

---

## The implementations

| Implementation | Language | Role |
| --- | --- | --- |
| `jcs/jcs.go` | Go | the hub signs with it; the controller verifies with it; the e2e harness signs as both with it |
| `src/lib/offline/jcs.ts` | TypeScript | the app signs offline grant proofs |
| `proto/vectors/lib.mjs` | JavaScript | generates and re-verifies the conformance vectors |

**Three, not five.** There were five: the Go canonicalizer was hand-copied into
`hub/internal/keys`, `controller/internal/jcs` and `e2e/`, on the argument that
independent implementations make the conformance vectors meaningful.

That argument did not survive what happened to the copies. When the
`json.Number` rounding bug was found and fixed, it was fixed in two of the three
Go copies. The third — the e2e harness, which stands in for *both* sides of the
wire — kept canonicalising 2^53+1 to 2^53 for as long as it existed. Hand-copied
implementations are not independent implementations; they are one
implementation and some stale forks, and the fork that drifts is the one nobody
is looking at.

The Go copies were folded into one module (`jcs/`). The language boundary is
real and stays: TypeScript and JavaScript have their own number formatting,
their own string escaping and their own sort semantics, written by hand from
the RFC. That boundary is held closed by data, not by code review.

## The subset

Implemented per RFC 8785:

- **Object keys** sorted by **UTF-16 code units**. In JS this is what
  `Array#sort()` does for strings, verbatim §3.2.3. In Go it needs an explicit
  `utf16.Encode` comparison — byte order and UTF-16 order agree for BMP-only
  strings and diverge once one side has supplementary-plane characters. Every
  key in these contracts is ASCII, where a plain `strcmp` is sufficient; the
  full comparison is implemented anyway because "every key is ASCII" is a
  property of today's contracts, not of the format.
- **No insignificant whitespace.**
- **Strings**: the two-character escapes (`\" \\ \b \f \n \r \t`), `\u00xx` in
  **lowercase** hex for remaining control characters, everything else literal
  UTF-8. §3.2.2.2. An escaped surrogate pair in the input becomes literal UTF-8
  in the output.
- **Numbers**: ECMAScript `Number::toString` (§3.2.2.3 verbatim; in JS this is
  `JSON.stringify`). Non-finite numbers are rejected rather than emitted as
  `null`.
- **Literals** `true` / `false` / `null` emitted bare; **arrays** in order.

Signing rule, everywhere: remove the top-level `sig` member, JCS-serialise,
sign the UTF-8 bytes. Optional members are **omitted entirely** when absent
(never `null`) and are covered by the signature when present.

## Where the implementations diverge

They diverge in exactly one place, on numbers, and it is pinned rather than
tolerated.

**Go implements a documented deviation.** Full ECMAScript double formatting
(Ryu) is not implemented, because envelopes carry only integers — `iat`, `exp`,
`v`, `rssi` — and strings. `Canonicalize` accepts integral numbers within the
IEEE-754 safe range (|n| ≤ 2^53) and returns an **error** for anything else.

**JavaScript and TypeScript get correct double formatting for free**, because
`Number::toString` *is* the RFC rule. They accept what Go refuses.

`jcs-cases.json` records this per case: the `refused` entries carry both the Go
behaviour (refusal) and a `js_canonical` field pinning exactly what the JS side
produces. All three implementations are tested against that file, so the
divergence cannot move without a failing test.

### Is the divergence safe?

**For non-integers: yes, one-directionally.** Anything a JS signer can produce
that Go refuses fails **loudly** at the Go verifier — a signature that will not
verify, not a signature over different bytes. Nothing in `vectors/` contains a
non-integer number, and `vectors/README.md` says not to add one without
revisiting this.

**For integers above 2^53: no, and it is worth knowing why.**
`JSON.parse("9007199254740993")` returns `9007199254740992` *before* any
canonicaliser is called. No JS implementation can refuse what it never saw —
the value is already gone. Go refuses because it parses with `json.Number` and
applies the bound to the literal. The consequence, stated plainly: **never route
a JSON document carrying an integer above 2^53 through a JavaScript signer.**
The app does not (it builds proof objects from typed fields — Unix seconds and
short strings) and the generator does not.

This is also why the Go implementation checks `json.Number` for an exact
integer *before* touching `Float64()`. Going through float first rounds
2^53+1 to 2^53, at which point the range check sees a value inside the safe
range and emits the rounded number — signing a document that differs from the
one that arrived, silently, which is precisely what the deviation note promises
not to do.

## Not implemented, not exercised

Lone surrogates; non-finite numbers (rejected); extreme-magnitude doubles. If a
future contract field needs any of these, extend the implementations to full
RFC 8785 **first**, add vectors, and delete the corresponding paragraph here.

## What holds it together

| Layer | Where | Assertion |
| --- | --- | --- |
| 0 | `jcs/cases_test.go`, `src/lib/offline/__tests__/jcs.test.ts`, `proto/vectors/verify.mjs` | 14 hand-derived edge cases + 2 pinned divergences, from `jcs-cases.json` |
| 1 | `controller/internal/jcs/jcs_vectors_test.go`, `hub/internal/keys/vectors_test.go`, `src/lib/offline/__tests__/jcs.test.ts`, `proto/vectors/verify.mjs` | output == every `canonical` field in `vectors/` (93 documents) |
| — | `jcs/fuzz_test.go` | idempotence, determinism across Go's randomised map iteration, value preservation, output re-parses |
| — | `e2e/` | a grant the harness signs is accepted by the **real controller binary** over the wire |

The expected values in `jcs-cases.json` are derived from RFC 8785 **by hand**,
not captured from any implementation. Captured output would only prove an
implementation reproduces itself.

## Adding a fourth implementation

1. Byte-compare against every `canonical` field in `vectors/` — layer 1 first,
   because it fails with a readable diff.
2. Run `jcs-cases.json`. If your language cannot refuse the `refused` cases,
   pin what it *does* produce in a new field alongside `js_canonical` and say
   why in this document. Do not skip them.
3. Fuzz for idempotence, determinism and value preservation. Byte-equality on a
   fixed corpus says nothing about the documents nobody wrote down.
