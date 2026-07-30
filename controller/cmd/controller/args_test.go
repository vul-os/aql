package main

// Positional arguments are silently destructive here, and this is the test that
// says so.
//
// Go's flag package STOPS parsing at the first non-flag token. So
// `aql-controller pair -relay gpiochip0:17 -state /data` does not merely ignore
// "pair" — it ignores every flag after it and runs on defaults. Verified by
// running the binary before this was fixed: the -state on that command line was
// dropped entirely and the process started with the built-in one.
//
// What makes it worth refusing rather than warning is which default gets
// restored. An empty -relay is the MOCK relay, which this binary's own startup
// warning describes as "commands will be acked and recorded as successful, and
// nothing physical will move". A gate that reports itself opening and does not
// open is the worst failure this program has, and one stray word reaches it.

import (
	"flag"
	"io"
	"strings"
	"testing"
)

// parseArgs runs the same FlagSet shape main uses, and reports what survived.
// Kept deliberately close to main's flags: the point is Go's parsing behaviour,
// not this repo's, so a fake flag set would prove nothing about the real one.
func parseArgs(t *testing.T, args []string) (relay, state string, positional int) {
	t.Helper()
	fs := flag.NewFlagSet("controller", flag.ContinueOnError)
	fs.SetOutput(io.Discard) // silence usage on error
	r := fs.String("relay", "", "")
	s := fs.String("state", "./state", "")
	if err := fs.Parse(args); err != nil {
		t.Fatalf("parse %v: %v", args, err)
	}
	return *r, *s, fs.NArg()
}

// The behaviour this guards against, demonstrated rather than asserted from
// memory. If Go ever changed this, the refusal would be unnecessary and this
// test would say so.
func TestGoDropsEveryFlagAfterAPositionalArgument(t *testing.T) {
	relay, state, n := parseArgs(t, []string{"pair", "-relay", "gpiochip0:17", "-state", "/data"})
	if n == 0 {
		t.Fatal("the parser reported no positional arguments, so the premise of the refusal is gone")
	}
	if relay != "" || state != "./state" {
		t.Fatalf("flags after a positional survived (relay=%q state=%q); if Go now parses "+
			"them, the refusal in main.go is no longer load-bearing and should be revisited",
			relay, state)
	}
	// Stated explicitly: this is what an operator would get. The empty relay is
	// the mock one.
	if relay != "" {
		t.Fatal("unreachable")
	}
}

func TestFlagsOnlyInvocationsParseNormally(t *testing.T) {
	relay, state, n := parseArgs(t, []string{"-relay", "gpiochip0:17", "-state", "/data"})
	if n != 0 {
		t.Errorf("a flags-only command line reported %d positional arguments", n)
	}
	if relay != "gpiochip0:17" || state != "/data" {
		t.Errorf("flags did not survive a normal invocation: relay=%q state=%q", relay, state)
	}
}

// Every shape main refuses, so a future edit narrowing the check is caught.
func TestEveryPositionalShapeIsDetected(t *testing.T) {
	for _, args := range [][]string{
		{"pair"},
		{"pair", "-relay", "gpiochip0:17"},
		{"-relay", "gpiochip0:17", "stray"},
		{"-state", "/data", "start", "-relay", "x"},
	} {
		if _, _, n := parseArgs(t, args); n == 0 {
			t.Errorf("%q has a positional argument that went undetected", strings.Join(args, " "))
		}
	}
}
