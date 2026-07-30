package httpapi

// Why this package's tests hash cheaply, and what stops that reaching
// production.
//
// Every `register()` in this suite pays a full argon2id: 64 MiB and three
// passes, single-threaded, by design. With the number of tests here that added
// up past Go's TEN-MINUTE per-package timeout — the suite panicked inside
// argon2 partway through and reported FAIL after 603 seconds. CI runs a bare
// `go test ./...` with no -timeout, so it had stopped being able to finish
// there too.
//
// The three plausible responses, and why this one:
//
//   · Raise the timeout — buys nothing, hides the growth, and the next batch of
//     tests crosses the new line.
//   · Delete or trim tests — trades coverage for seconds.
//   · Hash cheaply in tests, and pin the shipped cost so that cannot leak.
//
// The third is the only one that keeps both the coverage and the guarantee. It
// is safe because of TestArgonDefaultsAreTheRFCProfile below, which reads the
// CONSTANTS rather than the vars TestMain lowers: weakening what ships fails
// that test no matter what the test cost happens to be.

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	// Enough to exercise the real code path — same function, same PHC encoding,
	// same verification — at a cost that does not dominate the suite. The
	// parameters travel inside each hash, so a hash made here verifies here.
	argonMemoryUsed = 8 * 1024 // KiB
	argonTimeUsed = 1
	os.Exit(m.Run())
}

// The guarantee the above rests on.
func TestArgonDefaultsAreTheRFCProfile(t *testing.T) {
	// Read the CONSTANTS, not argon*Used — those are lowered by TestMain, so
	// asserting on them would assert nothing about what ships.
	if argonTime != 3 || argonMemory != 64*1024 || argonThreads != 1 {
		t.Fatalf(`the shipped argon2id cost changed: t=%d m=%d p=%d, want t=3 m=65536 p=1.

This is the RFC 9106 low-memory profile and it is the whole security value of
the hash. Tests lower argonTimeUsed/argonMemoryUsed so the suite can finish;
nothing may lower these.`, argonTime, argonMemory, argonThreads)
	}
	if argonKeyLen != 32 || argonSaltLen != 16 {
		t.Errorf("key/salt length changed: key=%d salt=%d", argonKeyLen, argonSaltLen)
	}
}

// And the seam must not have broken hashing itself.
func TestHashAndVerifyStillRoundTripAtTestCost(t *testing.T) {
	h, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("correct horse battery staple", h) {
		t.Error("a hash made at test cost does not verify — the parameters written into the " +
			"PHC string are not the ones used to derive it")
	}
	if VerifyPassword("wrong password", h) {
		t.Fatal("a wrong password verified; the cheaper cost must not have weakened the comparison")
	}
	// A hash carrying PRODUCTION parameters must still verify while the test
	// cost is in force — real databases hold hashes made at the shipped cost,
	// and an upgrade path that could not read them would lock everyone out.
	prodTime, prodMem := argonTimeUsed, argonMemoryUsed
	argonTimeUsed, argonMemoryUsed = argonTime, argonMemory
	prod, err := HashPassword("shipped cost")
	argonTimeUsed, argonMemoryUsed = prodTime, prodMem
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("shipped cost", prod) {
		t.Error("a hash made at the SHIPPED cost does not verify under the test cost; " +
			"VerifyPassword must re-derive with the parameters in the hash, not the current ones")
	}
}
