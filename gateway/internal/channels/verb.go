package channels

// The verb a menu renders — the second half of the machinery e10c06a started.
//
// That pass made ambiguity a three-state MatchOutcome so a caller could not
// silently act on "several gates matched", and gave PushAmbiguousGateMenu a
// verb so an unresolved "close the front gate" came back as rows that close.
// It left one branch behind, and said so in its own commit message: a close
// that resolved to NO gate fell through to PushGateMenu, which minted open_ap:
// rows unconditionally. A resident asking to shut a gate was handed buttons
// that open one.
//
// The shape of the fix is the same as the shape of the last one. The renderers
// do not read a verb out of the message text or default to one; they are TOLD,
// as a required argument, and the type is built so that not being told cannot
// come out as "open":
//
//   - Adding the parameter breaks every existing call site at COMPILE time, so
//     each one had to be read and given a verb deliberately. That is the same
//     forcing function that replacing the bool with MatchOutcome used.
//   - The zero value is verbUnset, not VerbOpen. Every method that turns a
//     GateVerb into something actionable returns the CLOSE form unless it was
//     explicitly handed VerbOpen. A future call site that forgets renders a
//     picker that closes: visibly wrong, never dangerous. The reverse — a
//     forgotten verb rendering "open" — is the defect this file exists to make
//     unreachable.
//
// Direction matters and only in one direction: a safety-reducing verb (open)
// silently becoming a safety-increasing one (close) is an annoyance; a
// safety-increasing verb silently becoming a safety-reducing one is the bug.
//
// This does NOT replace store/openpath.go's open/close allowlist, which stays
// the structural boundary. It sits above it, exactly as SelectionCommandVerb
// does.

import "strings"

// GateVerb is which way a rendered menu proposes to move a gate. It exists so
// a menu renderer cannot be called without saying so.
type GateVerb int

const (
	// verbUnset is the zero value and is never a valid verb. It is unexported
	// so this package never writes one deliberately, but a caller outside the
	// package can still reach it (`var v channels.GateVerb`), which is exactly
	// why every method below fails closed on it rather than trusting callers.
	verbUnset GateVerb = iota
	// VerbOpen renders a picker that opens: open_ap: rows, "Open X" buttons.
	VerbOpen
	// VerbClose renders a picker that closes: close_ap: rows, "Close X" buttons.
	VerbClose
)

// Valid reports whether this verb was explicitly set. Renderers do not need to
// call it — they already fail closed — but a handler that wants to refuse
// rather than render can.
func (v GateVerb) Valid() bool { return v == VerbOpen || v == VerbClose }

// SelectionCommand is the interactive-reply id prefix rows carry, from the
// SAME allowlist ParseSelection validates against (SelOpenAP / SelCloseAP) —
// no parallel id scheme. Fail-closed: ONLY an explicit VerbOpen mints open_ap.
func (v GateVerb) SelectionCommand() string {
	if v == VerbOpen {
		return SelOpenAP
	}
	return SelCloseAP
}

// LocationCommand is the id prefix a LOCATION row carries, so the verb survives
// the narrowing hop. A member with gates at two sites who texts "close the back
// gate" is asked which location first; without this the answer to that question
// arrived carrying no verb and the gate menu behind it re-defaulted to open —
// the same defect, one message later.
//
// SelSelectLoc keeps its exact wire value so location menus already sitting in
// residents' chat histories still resolve, and still resolve to open, which is
// what they were rendered to mean. Fail-closed the same way: only VerbOpen.
func (v GateVerb) LocationCommand() string {
	if v == VerbOpen {
		return SelSelectLoc
	}
	return SelSelectLocClose
}

// Command is the open-path command string ("open" / "close") — the vocabulary
// store.LogAccess accepts and the audit log records. Fail-closed: an unset verb
// yields "close", never "open".
func (v GateVerb) Command() string {
	if v == VerbOpen {
		return "open"
	}
	return "close"
}

// Title is the verb as it appears at the start of a button label ("Open Main
// gate" / "Close Main gate").
func (v GateVerb) Title() string {
	if v == VerbOpen {
		return "Open"
	}
	return "Close"
}

// Past is the verb in the past tense, for copy that states what did NOT happen
// ("so I haven't closed anything").
func (v GateVerb) Past() string {
	if v == VerbOpen {
		return "opened"
	}
	return "closed"
}

func (v GateVerb) String() string {
	if v.Valid() {
		return v.Command()
	}
	return "unset"
}

// GateVerbForCommand maps an open-path command string back to a GateVerb.
// ok is false for anything that is not exactly "open" or "close" — the same
// closed vocabulary as SelectionCommandVerb, read the other way round.
func GateVerbForCommand(command string) (GateVerb, bool) {
	switch command {
	case "open":
		return VerbOpen, true
	case "close":
		return VerbClose, true
	}
	return verbUnset, false
}

// LocationCommandVerb maps a location-NARROWING selection command to the verb
// the gate picker behind it must render. ok is false for anything else,
// including open_ap/close_ap: a narrowing id must never be read as an
// actuation, and an actuation id must never be read as a narrowing step.
// SelectionCommandVerb draws the same line from the other side.
func LocationCommandVerb(cmd string) (GateVerb, bool) {
	switch cmd {
	case SelSelectLoc:
		return VerbOpen, true
	case SelSelectLocClose:
		return VerbClose, true
	}
	return verbUnset, false
}

// TextGateVerb reads the verb a free-text body asks for.
//
// ok is false when the body names neither. There is no default verb
// (docs/CHAT-COMMANDS.md §3.5: "There is no most-likely-intent fallback. There
// is no default verb, no default target") — a body that names a gate and no
// action is a question, not a command, and the caller must ask rather than
// pick the more dangerous of the two.
//
// When a body names both ("close the gate, don't open it"), CLOSE wins. That is
// the pre-existing WhatsApp precedence (isClose was tested first) and it is the
// right way round: of the two readings, the one that leaves the gate shut is
// the one to guess.
func TextGateVerb(body string) (GateVerb, bool) {
	switch {
	case strings.Contains(body, "close"):
		return VerbClose, true
	case strings.Contains(body, "open"):
		return VerbOpen, true
	}
	return verbUnset, false
}
