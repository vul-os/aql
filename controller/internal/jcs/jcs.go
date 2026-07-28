// Package jcs is the controller's handle on the shared RFC 8785 (JCS)
// canonicalizer in github.com/vul-os/aql/jcs.
//
// It carries NO algorithm of its own. It used to: ~170 lines of canonicalizer
// duplicated by hand from hub/internal/keys/jcs.go, on the argument that two
// independent implementations make the conformance vectors meaningful. The
// duplication outlived the argument — the third hand-copy, e2e/jcs.go, missed
// the json.Number rounding fix and silently canonicalised 2^53+1 to 2^53 for
// as long as it existed. The cross-implementation check that is real, and that
// the vectors still enforce, is Go against TypeScript (src/lib/offline/jcs.ts)
// against JavaScript (proto/vectors/lib.mjs). See proto/JCS-PROFILE.md.
//
// This package remains as the import path the controller's packages already
// use, and because its own tests (cases_test.go, jcs_vectors_test.go) are the
// controller-side proof that the shared canonicalizer reproduces every
// `canonical` field in proto/vectors/ — the layer-1 conformance check, run
// from inside the module that has to verify those signatures on a device.
package jcs

import shared "github.com/vul-os/aql/jcs"

// Canonicalize renders v as RFC 8785 (JCS) canonical JSON. See the shared
// package for the documented subset and the ±2^53 integer deviation.
func Canonicalize(v any) ([]byte, error) { return shared.Canonicalize(v) }

// CanonicalizeJSON canonicalizes a raw JSON document (parse, then re-render
// canonically).
func CanonicalizeJSON(raw []byte) ([]byte, error) { return shared.CanonicalizeJSON(raw) }
