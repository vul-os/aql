// Package e2e — canonical JSON for the offline GRANT and grant.proof objects
// this harness signs as the "gateway" and the "app" (proto/grants.md).
//
// The controller re-canonicalizes the presented bytes minus `sig` and
// verifies, so the harness's canonical form MUST match the controller's
// byte-for-byte. It used to match by being a hand-copy of it, and that is
// exactly how it stopped matching: this file kept a json.Number path that
// rounded 2^53+1 to 2^53 long after both production copies had been fixed to
// refuse it. Nothing noticed, because the documents the harness signs are all
// small integers.
//
// It now imports the one canonicalizer, github.com/vul-os/aql/jcs — which is
// a shared MODULE precisely so that a sibling module blocked by Go's internal/
// rule (see README.md, "Why subprocess, not in-process") can still use it.
// Importing a canonicalizer is not importing the gateway or the controller:
// the harness still speaks to both only over the real wire.
package e2e

import "github.com/vul-os/aql/jcs"

// canonicalize renders v as RFC 8785 (JCS) canonical JSON (integers + strings
// + bools + arrays + objects subset the aql contracts use).
func canonicalize(v any) ([]byte, error) { return jcs.Canonicalize(v) }
