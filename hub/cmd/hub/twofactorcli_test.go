package main

// `aql-hub 2fa disable` end to end, against a real database file.
//
// The store tests cover what the disable does. These cover the subcommand as
// an operator meets it: that it works with no server running, that it refuses
// to act without a recorded reason, and that its output says enough for the
// person running it to know what they just did.

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/store"
)

func seedLockedOutUser(t *testing.T, dir string) string {
	t.Helper()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "ada@x.com", "hash", "Ada", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	f, err := st.CreateTOTPEnrollment(ctx, u.ID, "SECRET", 6, 30)
	if err != nil {
		t.Fatal(err)
	}
	seeds := []store.RecoveryCodeSeed{{Salt: "s", CodeHash: "h"}}
	if err := st.ActivateTOTP(ctx, f.ID, u.ID, 100, seeds); err != nil {
		t.Fatal(err)
	}
	return u.ID
}

// The whole point: no server, no session, no claim — and the account comes
// back with its second factor off.
func TestTwoFactorDisableCLIAgainstAColdDatabase(t *testing.T) {
	dir := t.TempDir()
	userID := seedLockedOutUser(t, dir)

	out, code := captureStdout(t, func() int {
		return runTwoFactorDisable([]string{
			"-data", dir, "-user", "ada@x.com",
			"-reason", "phone stolen, identity confirmed in person",
		})
	})
	if code != 0 {
		t.Fatalf("exit %d: %s", code, out)
	}
	for _, want := range []string{"ada@x.com", userID, "re-enrol"} {
		if !strings.Contains(out, want) {
			t.Errorf("output does not mention %q — an operator needs to see what changed:\n%s", want, out)
		}
	}
	// One unspent recovery code existed, so the warning must fire: it is the
	// signal that the lockout story may be incomplete.
	if !strings.Contains(out, "recovery code") {
		t.Errorf("no warning about the outstanding recovery code:\n%s", out)
	}

	// And it actually took effect in the file, not just on screen.
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	status, err := st.TOTPStatus(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if status.Active {
		t.Error("the CLI reported success but 2FA is still active in the database")
	}
}

func TestTwoFactorDisableCLIRefusesIncompleteInvocations(t *testing.T) {
	dir := t.TempDir()
	seedLockedOutUser(t, dir)

	cases := []struct {
		name string
		args []string
	}{
		{"no user", []string{"-data", dir, "-reason", "because"}},
		// A blank reason is the one that matters: this subcommand's advantage
		// over a hand-written UPDATE is the record it leaves, and a record
		// that says nothing is the same as no record.
		{"no reason", []string{"-data", dir, "-user", "ada@x.com"}},
		{"whitespace reason", []string{"-data", dir, "-user", "ada@x.com", "-reason", "   "}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, code := captureStdout(t, func() int { return runTwoFactorDisable(c.args) })
			if code == 0 {
				t.Errorf("%s was accepted", c.name)
			}
		})
	}

	// Nothing was disabled by any of the refusals.
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	id, err := st.UserIDByUsernameForOperator(context.Background(), "ada@x.com")
	if err != nil {
		t.Fatal(err)
	}
	status, err := st.TOTPStatus(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Active {
		t.Error("a refused invocation disabled 2FA anyway")
	}
}

// An operator acting on a name that has no active factor must not be told
// "done" — the person they are helping is stuck on something else.
func TestTwoFactorDisableCLIReportsNothingToDo(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateUser(context.Background(), "no2fa@x.com", "hash", "N", "ZA"); err != nil {
		t.Fatal(err)
	}
	st.Close()

	_, code := captureStdout(t, func() int {
		return runTwoFactorDisable([]string{"-data", dir, "-user", "no2fa@x.com", "-reason", "reported locked out"})
	})
	if code == 0 {
		t.Error("reported success for a user with no active second factor")
	}

	_, code = captureStdout(t, func() int {
		return runTwoFactorDisable([]string{"-data", dir, "-user", "ghost@x.com", "-reason", "typo"})
	})
	if code == 0 {
		t.Error("reported success for a user that does not exist")
	}
}

// The dispatch in main(), proved by running the actual binary.
//
// Every test above calls runTwoFactorDisable directly, which would keep
// passing if the `2fa disable` arm of main() were never wired up or were
// spelled differently — a subcommand nobody can invoke, with a full test suite
// behind it. That is the same "built but unreachable" shape this codebase has
// hit repeatedly, so this one pays a compile to check the entry point itself.
func TestTwoFactorDisableIsReachableAsASubcommand(t *testing.T) {
	if testing.Short() {
		t.Skip("builds a binary")
	}
	bin := filepath.Join(t.TempDir(), "aql-hub-test")
	build := exec.Command("go", "build", "-o", bin, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}

	dir := t.TempDir()
	userID := seedLockedOutUser(t, dir)

	cmd := exec.Command(bin, "2fa", "disable", "-data", dir,
		"-user", "ada@x.com", "-reason", "reachability check")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("the binary could not run `2fa disable`: %v\n%s\n\n"+
			"runTwoFactorDisable exists and is tested; if this fails, main()'s "+
			"dispatch does not reach it and the subcommand does not exist as far "+
			"as an operator is concerned.", err, out)
	}
	if !strings.Contains(string(out), "ada@x.com") {
		t.Errorf("unexpected output from the subcommand:\n%s", out)
	}

	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	status, err := st.TOTPStatus(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if status.Active {
		t.Error("the binary exited 0 but 2FA is still active")
	}
}
