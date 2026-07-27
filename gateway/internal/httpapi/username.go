package httpapi

// Username validation.
//
// # Why this file exists
//
// Email identity was removed from this product deliberately: a hub runs in
// somebody's house, has no outbound mail, and requiring an email address to
// open your own front door makes an account depend on a service the household
// does not operate. The columns went, the sending went, the docs went.
//
// The VALIDATION did not. Three handlers — register, invite and recovery — kept
// `!strings.Contains(username, "@")`, so for as long as that stood, every
// username on a product that has no email still had to be shaped like an email
// address. Nothing failed; it simply quietly reimposed the requirement that had
// just been removed, and a build passes either way.
//
// That is the shape of the bug worth naming: removing a feature means removing
// what VALIDATES it, not only what stores it.
//
// # The rule
//
// Deliberately loose. A username here is a local handle in a household or an
// office, not a global identifier, so there is no registry to keep tidy and no
// reason to be strict about the character set. The constraints exist only to
// keep a username usable and unambiguous:
//
//   - length, so it fits in a UI and cannot be used to bloat a row
//   - no whitespace, because a name with a space in it cannot be typed into a
//     chat command without quoting, and the chat rail is a first-class surface
//   - no control characters, which nothing legitimate contains and which render
//     unpredictably in a terminal or an audit log
//
// An email address still passes all of these, so anyone who prefers one keeps
// using it and no existing account breaks. That is the point: this widens what
// is accepted rather than trading one arbitrary shape for another.

import (
	"strings"
	"unicode"
)

const (
	// usernameMinLen is short enough for "pat" and long enough to be a name.
	usernameMinLen = 2
	// usernameMaxLen bounds what lands in a row and in the audit trail. Well
	// past any real handle or email address.
	usernameMaxLen = 254
)

// validUsername reports whether a username is usable.
//
// It does NOT normalise — callers trim and lowercase where they already did,
// because changing that is a data-migration question and not this function's
// business.
func validUsername(u string) bool {
	if len(u) < usernameMinLen || len(u) > usernameMaxLen {
		return false
	}
	for _, r := range u {
		// Whitespace anywhere, not just at the ends: the ends are trimmed by
		// the callers, and an interior space breaks chat commands.
		if unicode.IsSpace(r) {
			return false
		}
		// Control characters, including the DEL range. These render
		// unpredictably in a terminal and in an audit log, which is precisely
		// where a username is read when something has gone wrong.
		if unicode.IsControl(r) {
			return false
		}
	}
	// A leading or trailing dot reads as a truncated name and is a common
	// copy-paste artefact; refusing it costs nobody anything.
	return !strings.HasPrefix(u, ".") && !strings.HasSuffix(u, ".")
}
