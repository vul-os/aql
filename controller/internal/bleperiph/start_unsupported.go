//go:build !ble || (ble && !linux && !windows)

package bleperiph

import "context"

// Start is unavailable here: without the `ble` build tag no bluetooth
// dependency is compiled in at all, and with it, this platform has no
// GATT-server backing.
//
// Which platforms those are is a fact about the library, and it was checked
// rather than assumed. tinygo.org/x/bluetooth v0.15.0 ships gatts_linux.go and
// gatts_windows.go — real peripheral implementations, 338 lines of WinRT in the
// Windows case — and gatts_other.go, a stub, for `!linux && !windows`. darwin
// has gattc_darwin.go (central/client) and no GATT server: CoreBluetooth
// exposes peripheral mode, but this library does not bind it.
//
// So the honest boundary is linux || windows, not linux. An earlier version of
// this comment said Linux only, which had stopped being true.
// BackendLinked reports whether a real GATT-server backend was compiled in.
//
// A compile-time constant, one per Start implementation, so a test can assert
// what this build actually contains instead of inferring it. The package claims
// exactly one of the two files is linked; before this existed, "it compiles"
// was the whole proof, and a test could not tell a stub build from a real one
// in order to assert the right thing about it.
const BackendLinked = false

func Start(ctx context.Context, cfg Config) error {
	return ErrUnsupported
}
