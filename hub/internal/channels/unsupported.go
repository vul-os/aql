package channels

import (
	"sort"
	"strings"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Saying "I can't do that" instead of offering a gate.
//
// docs/CHAT-COMMANDS.md §1.4 makes `not_implemented` a FIRST-CLASS outcome and
// is blunt about why: "a spec that lets 'turn off the garden lights' return OK
// would be a lie told by a system that opens doors." The same argument applies
// one step earlier, to the reply.
//
// Chat can actuate exactly two verbs — open and close, on an access point.
// Everything else fell through to the welcome menu, so a member who asked to
// turn on a light was shown a list of gates and an offer to open one. Nothing
// actuated, so this was never dangerous; it was misleading, which is the thing
// this product spends most of its effort not being. The member cannot tell
// "I did not understand you" from "that is not a thing I do", and one of those
// is worth reporting to whoever runs the hub.
//
// What this deliberately does NOT do is touch the open path. A body that names
// a gate verb is routed exactly as before, including a mixed message like
// "open the gate and turn on the light" — that still opens the gate. Refusing
// mixed intent is a real question (§2.3's progressive narrowing), and it is a
// change to the actuation path rather than to a fallback reply, so it does not
// belong in the same change as this.

// unsupportedVerbs maps the words a person actually types onto the engine's
// canonical verbs.
//
// The VALUES come from internal/devices, not from a list invented here: the
// verb space is closed precisely so it can be tiered (capability.go), and a
// chat-side vocabulary that drifted from it would describe capabilities the
// engine does not have. Access verbs are absent because chat DOES serve those
// — this table is only for the ones it cannot.
var unsupportedVerbs = map[string]devices.Verb{
	"turn on":    devices.VerbOn,
	"switch on":  devices.VerbOn,
	"turn off":   devices.VerbOff,
	"switch off": devices.VerbOff,
	"toggle":     devices.VerbToggle,
	"dim":        devices.VerbSet,
	"set":        devices.VerbSet,
	"start":      devices.VerbStart,
	"stop":       devices.VerbStop,
	"pause":      devices.VerbPause,
	"resume":     devices.VerbResume,
	"dock":       devices.VerbDock,
	"lock":       devices.VerbLock,
	"unlock":     devices.VerbUnlock,
	"arm":        devices.VerbArm,
	"disarm":     devices.VerbDisarm,
}

// UnsupportedVerb reports the canonical verb a message asked for, when that
// verb is one the chat rails cannot serve.
//
// It is only consulted AFTER TextGateVerb has found no open/close, so a
// message that asks for a gate is never diverted here. ok is false for
// ordinary chatter, which keeps its existing welcome menu — "thanks" is not a
// failed command and should not be answered as one.
func UnsupportedVerb(body string) (devices.Verb, bool) {
	b := strings.ToLower(strings.TrimSpace(body))

	// Longest phrase first, so "turn on" wins over a bare "on" that might
	// appear inside it, and the match is deterministic rather than dependent
	// on map iteration order — the same fail-open-by-slice-order mistake §2.2
	// records in the gate matcher.
	phrases := make([]string, 0, len(unsupportedVerbs))
	for p := range unsupportedVerbs {
		phrases = append(phrases, p)
	}
	sort.Slice(phrases, func(i, j int) bool {
		if len(phrases[i]) != len(phrases[j]) {
			return len(phrases[i]) > len(phrases[j])
		}
		return phrases[i] < phrases[j]
	})

	for _, p := range phrases {
		if wordPhraseIn(b, p) {
			return unsupportedVerbs[p], true
		}
	}
	return "", false
}

// wordPhraseIn matches a phrase on word boundaries, so "set" does not fire on
// "sunset" and "arm" does not fire on "alarm" — the latter being a word a
// resident is quite likely to use in a message about a gate.
func wordPhraseIn(body, phrase string) bool {
	for i := 0; i+len(phrase) <= len(body); i++ {
		if body[i:i+len(phrase)] != phrase {
			continue
		}
		if i > 0 && isWordByte(body[i-1]) {
			continue
		}
		if end := i + len(phrase); end < len(body) && isWordByte(body[end]) {
			continue
		}
		return true
	}
	return false
}

func isWordByte(c byte) bool {
	return c == '_' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

// UnsupportedVerbReply is what to say. It names the verb the member asked for,
// says plainly that chat does not do it, and does not offer a gate menu as a
// consolation — being handed a different capability than the one you asked for
// is how a person concludes the system is confused rather than limited.
//
// It also says where the thing they wanted DOES live, when that is true: the
// console actuates engine-backed devices today, so "not from chat" is the
// honest scope rather than "not at all".
func UnsupportedVerbReply(v devices.Verb, publicURL string) string {
	var b strings.Builder
	b.WriteString("I can only open and close gates from chat — I can't ")
	b.WriteString(string(v))
	b.WriteString(" anything from here.")
	if publicURL != "" {
		b.WriteString(" Lights, climate and the rest are in the console: ")
		b.WriteString(publicURL)
		b.WriteString(".")
	}
	b.WriteString(" Send \"menu\" for the gates you can reach.")
	return b.String()
}
