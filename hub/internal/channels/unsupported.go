package channels

import (
	"sort"
	"strconv"
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

// UnsupportedVerbReplyFor is UnsupportedVerbReply with the device resolved.
//
// # Why the refusal does the resolving
//
// The resolver's failure mode is not "no answer" — it is the WRONG device, with
// a success message naming the right one. So its first consumer is a reply that
// changes nothing: a member asking to turn on the porch light is told which
// device was understood, and where it can actually be done. If the resolution
// is wrong, they see it is wrong, and nothing has moved.
//
// That is the order this seam has to be built in. When actuation does arrive it
// will pass through a resolver that has been answering in public, against real
// fleets and real phrasings, rather than one whose first outing is at a relay.
//
// The refusal itself is unchanged in force: chat still actuates nothing on the
// engine. Naming the device is not a step toward doing it, it is what makes the
// refusal legible.
func UnsupportedVerbReplyFor(m DeviceMatch, publicURL string) string {
	var b strings.Builder
	b.WriteString("I can only open and close gates from chat — I can't ")
	b.WriteString(string(m.Verb))
	b.WriteString(" anything from here.")

	switch {
	case m.Unique():
		// Confirms understanding while refusing. "I know which one you mean and
		// I still will not" is a different message from "I do not do that", and
		// only the first tells the member their phrasing was fine.
		b.WriteString(" You mean ")
		b.WriteString(m.Device.Device.Name)
		if z := m.Device.Device.Zone; z != "" {
			b.WriteString(" (")
			b.WriteString(z)
			b.WriteString(")")
		}
		b.WriteString(", which is in the console")
	case m.Ambiguous():
		// Said even though nothing would actuate. A member who thinks they
		// named one device and named three should learn that here rather than
		// the first time it matters.
		b.WriteString(" That name matches ")
		b.WriteString(itoa(int64(len(m.Candidates))))
		b.WriteString(" devices, so I could not tell which you meant")
	default:
		b.WriteString(" Lights, climate and the rest are in the console")
	}
	if publicURL != "" {
		b.WriteString(": ")
		b.WriteString(trimURL(publicURL))
		b.WriteString("/app")
	}
	b.WriteString(". Send \"menu\" for the gates you can reach.")
	return b.String()
}

// ---------------------------------------------------------------------------
// Actuation replies (docs/CHAT-COMMANDS.md §3)
// ---------------------------------------------------------------------------

// ActuationDone reports that a device was driven.
//
// Past tense and specific, naming the device. The gate path says "Opening Main
// gate…" because a gate takes seconds to move and the ack is separate; an
// engine command has already returned by the time this is written, so the
// present continuous would be a claim about a thing that has finished.
func ActuationDone(deviceName string, v devices.Verb) string {
	return "Done — " + deviceName + " is now " + verbPastTense(v) + "."
}

// ActuationDoneWithValue reports a device driven with a QUANTITY, echoing it.
//
// The echo is not decoration; it is the only evidence the member gets that the
// number was read correctly. `set` takes a value parsed out of free text
// (channels.Quantity), and "Done — Garden Lights is now updated" would be the
// same reply whether this understood 30 or 3. That is the same objection that
// keeps a quantity verb off the confirmation route — ConfirmationPrompt does
// not echo the argument either — and it would be inconsistent to refuse a
// confirmation for not showing the number and then not show it on success.
//
// The catalogue's own argument name is used rather than a unit: the catalogue
// declares `level` and `celsius` and declares no units, and inventing "%" here
// would be this file asserting something the authority does not say.
func ActuationDoneWithValue(deviceName string, arg string, value float64) string {
	return "Done — " + deviceName + " " + arg + " is now " + trimNumber(value) + "."
}

// trimNumber renders a float the way a person wrote it: 30, not 30.000000, and
// 21.5 when they meant 21.5.
func trimNumber(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// ActuationRefused explains why nothing happened, in the terms the member can
// act on. Every caller supplies a reason; there is no generic branch, because
// "I couldn't do that" is the reply this whole document exists to avoid.
func ActuationRefused(deviceName string, v devices.Verb, why string) string {
	return "I did not " + string(v) + " " + deviceName + " — " + why + "."
}

// ActuationOutOfTier refuses a verb chat will not send at all.
//
// It names the tier rather than saying "not allowed", because the member has
// done nothing wrong and the limit is a property of the SURFACE: the same
// person can do this from the console. Telling them where it works is the
// difference between a limit and a dead end.
func ActuationOutOfTier(deviceName string, v devices.Verb, tier, publicURL string) string {
	msg := "I will not " + string(v) + " " + deviceName + " from chat — that is a " + tier +
		" command, and chat only sends reversible ones"
	if publicURL != "" {
		return msg + ". It is in the console: " + trimURL(publicURL) + "/app"
	}
	return msg + ". It is in the console."
}

// verbPastTense renders the state a device is in after a verb.
//
// Fail-safe rather than fail-closed, the same choice ActingWord makes: an
// unrecognised verb yields a neutral phrasing rather than inventing a state.
// Claiming a device is "off" when the verb was something else is exactly the
// wrong-copy failure this file exists to prevent.
func verbPastTense(v devices.Verb) string {
	switch v {
	case devices.VerbOn:
		return "on"
	case devices.VerbOff:
		return "off"
	case devices.VerbToggle:
		return "switched"
	case devices.VerbStop:
		return "stopped"
	case devices.VerbPause:
		return "paused"
	case devices.VerbResume:
		return "running"
	}
	return "updated"
}

// ConfirmationPrompt asks for the second message §3.4 requires.
//
// It names the device and the verb, because the token is opaque and a member
// who has typed two commands needs to know which one they are about to
// authorize. It does NOT say "reply yes": a bare yes is replayable and, in a
// group, unattributable — the whole reason the token exists.
func ConfirmationPrompt(deviceName string, v devices.Verb, token string) string {
	return "That one needs confirming. To " + string(v) + " " + deviceName +
		", send this back within a minute:\n\n" + token +
		"\n\nIf you did not mean to, ignore this and nothing happens."
}

// ConfirmationRejected answers a token that is unknown, expired, spent, or from
// another conversation — deliberately without saying which.
//
// Distinguishing them would tell whoever is guessing how far they got, and the
// distinction changes nothing for a member: in every case the answer is to ask
// again.
func ConfirmationRejected(publicURL string) string {
	msg := "That confirmation is no longer valid — they last a minute and work once. Send the command again to get a new one"
	if publicURL != "" {
		return msg + ", or use the console: " + trimURL(publicURL) + "/app."
	}
	return msg + "."
}

// ConfirmationMismatch answers a VALID token presented against a different
// action — §3.4's interleaved-exchange case.
//
// It names what the token was for, because a member who has two commands in
// flight has confirmed the wrong one and needs to know which. The token is
// spent either way: it was authentic, it was used, and re-offering it would
// make a mis-aimed confirmation reusable.
func ConfirmationMismatch(mintedVerb, mintedDevice, askedName string, askedVerb devices.Verb) string {
	return "That confirmation was for " + mintedVerb + " on " + mintedDevice +
		", not " + string(askedVerb) + " " + askedName + ", so I did nothing. " +
		"Send the command you meant again to get a fresh confirmation."
}
