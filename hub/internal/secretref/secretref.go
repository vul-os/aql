// Package secretref resolves indirect secret values in configuration.
//
// # Why this exists rather than a keychain
//
// The ROADMAP carried "OS-keychain-backed credential vault" for a long time,
// and it cannot serve the deployment this hub actually has. A container — the
// documented `docker run` path — has no keychain, no logged-in session and no
// Secret Service on the bus; and the binary is built `CGO_ENABLED=0` so it
// cannot bind macOS Security.framework even where one exists. A keychain
// integration would work on a developer's laptop and nowhere a hub runs.
//
// What every one of those deployments DOES have is files and environment
// variables: Docker secrets are files under /run/secrets, systemd's
// LoadCredential= is a file, Kubernetes mounts a secret as a file. So a config
// value may name where its secret lives instead of containing it, and the
// config file itself can go in version control with nothing sensitive in it.
//
// # The syntax, and why it is explicit
//
// `${env:NAME}` and `${file:/path}`. Anything else is returned unchanged — a
// password that happens to contain a brace is still a password. The prefix is
// required rather than inferred because the alternative is guessing whether a
// value is a path or a secret, and guessing wrong either leaks the path or
// authenticates with the wrong string.
//
// A reference that cannot be resolved is an ERROR, never an empty string. An
// empty credential does not fail loudly: MQTT brokers and ONVIF cameras both
// accept anonymous connections, so a typo'd variable name would silently
// downgrade an authenticated connection to an unauthenticated one and look
// like it worked.
package secretref

import (
	"fmt"
	"os"
	"strings"
)

const (
	envPrefix  = "${env:"
	filePrefix = "${file:"
)

// Resolve returns the secret a value refers to, or the value itself.
//
// The `where` string names the setting for the error message: a hub that
// refuses to start must say which line of the config it could not read, or an
// operator is left diffing a file against a stack trace.
func Resolve(where, value string) (string, error) {
	switch {
	case strings.HasPrefix(value, envPrefix) && strings.HasSuffix(value, "}"):
		name := value[len(envPrefix) : len(value)-1]
		// Message quality, not behaviour: LookupEnv("") is already not-ok, so
		// removing this changes the error text and nothing else. Said here so
		// nobody later tries to prove it with a tamper that cannot fail and
		// concludes the check is dead.
		if name == "" {
			return "", fmt.Errorf("%s: ${env:} names no variable", where)
		}
		v, ok := os.LookupEnv(name)
		if !ok {
			// LookupEnv rather than Getenv: an unset variable and one set to
			// the empty string are different mistakes, and only the second is
			// something an operator did on purpose.
			return "", fmt.Errorf("%s: environment variable %q is not set", where, name)
		}
		return v, nil

	case strings.HasPrefix(value, filePrefix) && strings.HasSuffix(value, "}"):
		path := value[len(filePrefix) : len(value)-1]
		// Same: ReadFile("") already fails. This only makes the reason legible.
		if path == "" {
			return "", fmt.Errorf("%s: ${file:} names no path", where)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("%s: %w", where, err)
		}
		// Trailing newline trimmed, because every way an operator produces one
		// of these files adds one — `echo secret > f`, a here-doc, an editor —
		// and a password with a newline on the end fails authentication with a
		// message about credentials rather than about whitespace.
		return strings.TrimRight(string(b), "\r\n"), nil

	default:
		return value, nil
	}
}

// ResolveMap resolves every value in a map, leaving keys alone.
//
// For httpdev's Headers, which is where its own config error tells an operator
// to put credentials rather than in the URL.
func ResolveMap(where string, in map[string]string) (map[string]string, error) {
	if in == nil {
		return nil, nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		r, err := Resolve(where+" header "+k, v)
		if err != nil {
			return nil, err
		}
		out[k] = r
	}
	return out, nil
}
