package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/vul-os/aql/hub/internal/sealed"
)

// `aql-hub gen-data-key` — mint the key AQL_DATA_KEY wants.
//
// # Why this exists
//
// hub/README.md tells an operator to "set AQL_DATA_KEY to a base64 32-byte key"
// and never says how to get one. sealed.NewKey has existed the whole time, with
// a doc comment reading "returns a fresh random data key, base64 for an operator
// to store" — and nothing called it. The function that mints the key was
// unreachable from the binary that consumes it.
//
// So the operator's actual path was to invent one: `openssl rand -base64 32`,
// or `head -c 32 /dev/urandom | base64`, or whatever a search returned. Most of
// those produce something ParseKey accepts — it takes four base64 alphabets and
// checks the length after decoding — but "most" is the wrong standard for the
// key that decrypts a gate's signing identity, and an operator who gets it
// wrong finds out at the point the hub refuses to start.
//
// # What it deliberately does not do
//
// It does not write anywhere. No file, no data directory, no environment. It
// prints one line to stdout and exits, because the only correct destination for
// this value is wherever that deployment keeps secrets, and this command cannot
// know where that is. Printing means `aql-hub gen-data-key > /run/secrets/…`
// and `... | docker secret create` both work without this code learning about
// either.
//
// It also does not take -data. Nothing about generating a random key needs a
// hub directory, and accepting the flag would imply it touches one.
func runGenDataKey(args []string) int {
	fs := flag.NewFlagSet("gen-data-key", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: aql-hub gen-data-key")
		fmt.Fprintln(os.Stderr, "\nPrints one base64 32-byte key for AQL_DATA_KEY and exits.")
		fmt.Fprintln(os.Stderr, "Nothing is written to disk; redirect it wherever this deployment keeps secrets.")
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() > 0 {
		fs.Usage()
		return 2
	}

	key, err := sealed.NewKey()
	if err != nil {
		// crypto/rand failing is not a condition to paper over with a retry or
		// a fallback source: a key from a degraded generator is worse than no
		// key, because it would be accepted and used.
		fmt.Fprintf(os.Stderr, "aql-hub: could not generate a key: %v\n", err)
		return 1
	}
	fmt.Println(key)
	return 0
}
