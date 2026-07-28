// Module e2e is the cross-module integration harness for lintel: it drives
// the REAL gateway and controller BINARIES over the real wire (HTTP + RFC 6455
// WebSocket + LAN grant HTTP) and asserts they interoperate on the proto/
// contracts.
//
// It deliberately depends on NOTHING from the gateway/controller modules as Go
// imports — see README.md ("Why subprocess, not in-process") for the reason
// (Go's internal/ rule forbids a sibling module from importing either module's
// packages). Everything here is standard library.
module github.com/vul-os/aql/e2e

go 1.25.6

require github.com/vul-os/aql/jcs v0.0.0

// The shared canonicalizer lives in this repo, alongside this module. There
// is no published version of it and there does not need to be: every consumer
// is in the same working tree.
replace github.com/vul-os/aql/jcs => ../jcs
