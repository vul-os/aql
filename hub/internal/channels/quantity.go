package channels

import (
	"regexp"
	"strconv"
)

// Reading a quantity out of a chat message — docs/CHAT-COMMANDS.md §3.5's
// fail-closed rule applied to arguments.
//
// # Why this is allowed to exist now
//
// chatArgumentlessVerbs excluded every verb taking a value, on the grounds that
// "dim the lounge to 30" against "…to 30%" against "…30 percent" is a
// resolution problem of its own. That was a judgement about parsing difficulty,
// and it is solvable — all three of those phrasings contain exactly ONE number,
// and a parser that insists on exactly one handles them identically.
//
// What settled it was the tier table rather than the parser. `set` is
// TierReversible on a dimmer and TierConsequential on a thermostat, and chat's
// ceiling is TierReversible — so enabling it reaches a lamp's brightness and
// nothing else. The worst outcome of a misparse is a light at the wrong level,
// which is the definition of the tier it sits in. A thermostat stays out by
// machinery that was already there, not by this parser being careful.
//
// # The rule
//
// EXACTLY ONE number, or nothing. Two numbers is ambiguous — "dim lounge 2 to
// 30" names a device and a level and this cannot tell which is which — and
// ambiguity refuses, per §3.5. No number means the member did not supply one,
// which is a different refusal with a different fix.
//
// The range is NOT checked here. devices.Registry.Resolve validates against the
// catalogue's own Min/Max and produces the message naming them; re-checking
// would be a second copy of a bound that must not disagree with the first.
var quantityPattern = regexp.MustCompile(`\d+(?:\.\d+)?`)

// Quantity reports the single number a body supplies, and whether there was
// exactly one.
//
// A trailing `%` or the word "percent" is not required and not rejected: it is
// punctuation around the number, and the catalogue already knows what unit the
// verb takes. Demanding it would refuse "dim the lounge to 30", which is how
// people write.
func Quantity(body string) (float64, bool) {
	found := quantityPattern.FindAllString(body, -1)
	if len(found) != 1 {
		return 0, false
	}
	v, err := strconv.ParseFloat(found[0], 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

// QuantityCount reports how many numbers a body contains, so a refusal can say
// whether none were supplied or too many were.
func QuantityCount(body string) int {
	return len(quantityPattern.FindAllString(body, -1))
}
