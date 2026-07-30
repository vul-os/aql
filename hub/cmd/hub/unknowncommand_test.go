package main

// A mistyped subcommand must not start a hub.
//
// It used to. `aql-hub 2fa disabel -user alice` — one transposed letter —
// matched no dispatch, and flag.Parse ignores positional arguments, so the
// binary booted: it generated a fresh Ed25519 signing key and a JWT secret,
// created the database, ran migrations and started the background workers.
//
// Against an empty directory that is surprising. Against the directory an
// operator meant only to INSPECT it is destructive, and that is not
// hypothetical — verify-audit is documented as working on a cold backup, so a
// backup is precisely where these commands get pointed. Booting there writes a
// new signing key into the artifact and migrates the database inside it.
//
// The default -listen is non-loopback and refuses to start, which is why nobody
// noticed. The deployment the docs recommend binds loopback, and there it starts
// cleanly.

import (
	"strings"
	"testing"
)

func TestAMistypedSubcommandIsRefusedRatherThanStartingTheHub(t *testing.T) {
	// Every one of these is a plausible slip, and each used to boot a hub.
	for _, args := range [][]string{
		{"2fa", "disabel", "-user", "alice"}, // transposed letters
		{"2fa"},                              // forgot the verb
		{"energy"},                           // forgot the verb
		{"energy", "rebucked", "-account", "x"},
		{"verify-audi", "-data", "./backup"}, // the cold-backup case
		{"help"},
		{"serve"}, // a command other tools have and this one does not
	} {
		msg, unknown := unknownCommand(args)
		if !unknown {
			t.Errorf("%q was accepted, so it falls through to starting the hub — which "+
				"generates a signing key and migrates whatever -data points at", strings.Join(args, " "))
			continue
		}
		// The refusal has to name the alternatives. These commands are reached
		// for about once a year; "unknown command" alone is a dead end.
		for _, want := range []string{"verify-audit", "2fa disable", "energy rebucket"} {
			if !strings.Contains(msg, want) {
				t.Errorf("the refusal for %q does not mention %q:\n%s",
					strings.Join(args, " "), want, msg)
			}
		}
	}
}

func TestTheServersOwnInvocationsAreNotRefused(t *testing.T) {
	// Flags only, which is what starting the hub looks like. A guard that
	// refused these would be worse than the bug it fixes.
	for _, args := range [][]string{
		{},
		{"-listen", "127.0.0.1:8080"},
		{"-data", "./data", "-behind-proxy"},
		{"-device-drivers", "access"},
		{"-help"},
	} {
		if _, unknown := unknownCommand(args); unknown {
			t.Errorf("%q was refused, but it is how the hub is started",
				strings.Join(args, " "))
		}
	}
}

// The real subcommands must reach their dispatch, not this refusal. The dispatch
// runs first in main, so this asserts the shape rather than the ordering — but a
// change that made one of these look unknown would be caught here rather than by
// an operator whose recovery command stopped working.
func TestEveryKnownCommandIsListedInItsOwnRefusal(t *testing.T) {
	msg, unknown := unknownCommand([]string{"nonsense"})
	if !unknown {
		t.Fatal("a nonsense command was accepted")
	}
	if len(knownCommands) < 3 {
		t.Fatalf("only %d known commands are listed; the list has lost entries", len(knownCommands))
	}
	for _, c := range knownCommands {
		if !strings.Contains(msg, c) {
			t.Errorf("knownCommands lists %q but the refusal does not print it", c)
		}
	}
}
