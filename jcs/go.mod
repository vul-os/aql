// The shared RFC 8785 (JCS) canonicalizer.
//
// Its own module, and not a package inside hub/ or controller/, for one
// mechanical reason: Go's internal/ rule forbids a sibling module from
// importing either module's packages, and the controller is a separate module
// on purpose (it is vendored onto devices without dragging in the gateway).
// A fourth, dependency-free module is the only shape all three can import.
//
// The `go` directive is deliberately the OLDEST of its three consumers
// (controller/go.mod says 1.23.8). A dependency that requires a newer
// toolchain than its consumer fails the build, so this line must never be
// raised above the lowest consumer.
//
// KNOWN CONSEQUENCE, stated rather than discovered later: each consumer wires
// this in with a RELATIVE `replace`. Relative replaces apply only to the main
// module, so `go install github.com/vul-os/aql/controller/cmd/controller@vX`
// from outside a checkout would not resolve it. That is fine today — this
// repository has no released Go module and no semver tags, so nothing consumes
// controller/ or hub/ as a dependency; everything builds from the working
// tree, which is how CI builds them too. If a module here is ever published,
// this one must be tagged (`jcs/vX.Y.Z`) and the relative replaces dropped in
// the same change.
module github.com/vul-os/aql/jcs

go 1.23.8
