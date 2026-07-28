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
	// VerbHold renders a picker that HOLDS: hold_ap: rows, "Hold X open"
	// buttons. A hold leaves the gate standing open until the controller's own
	// hold_max releases it, so it is the most permissive verb here and is
	// never a fallback — every method below reaches it only on an explicit
	// match, and every unmatched case still lands on close.
	VerbHold
)

// Valid reports whether this verb was explicitly set. Renderers do not need to
// call it — they already fail closed — but a handler that wants to refuse
// rather than render can.
func (v GateVerb) Valid() bool { return v == VerbOpen || v == VerbClose || v == VerbHold }

// SelectionCommand is the interactive-reply id prefix rows carry, from the
// SAME allowlist ParseSelection validates against (SelOpenAP / SelCloseAP) —
// no parallel id scheme. Fail-closed: ONLY an explicit VerbOpen mints open_ap.
func (v GateVerb) SelectionCommand() string {
	switch v {
	case VerbOpen:
		return SelOpenAP
	case VerbHold:
		return SelHoldAP
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
	switch v {
	case VerbOpen:
		return SelSelectLoc
	case VerbHold:
		return SelSelectLocHold
	}
	return SelSelectLocClose
}

// SlackActionCommand is the Block Kit action_id prefix a Slack gate button
// carries. Slack has its OWN id scheme (open_gate:) rather than the
// interactive-reply scheme WhatsApp and Telegram share (open_ap:), because that
// is what its buttons have always been minted with and buttons already sitting
// in workspace histories must keep meaning what they meant. Same allowlist
// discipline as SelectionCommand, same fail-closed rule: only an explicit
// VerbOpen mints open_gate, so an unset verb renders a button that closes.
func (v GateVerb) SlackActionCommand() string {
	switch v {
	case VerbOpen:
		return SlackActOpenGate
	case VerbHold:
		return SlackActHoldGate
	}
	return SlackActCloseGate
}

// Command is the open-path command string ("open" / "close") — the vocabulary
// store.LogAccess accepts and the audit log records. Fail-closed: an unset verb
// yields "close", never "open".
func (v GateVerb) Command() string {
	switch v {
	case VerbOpen:
		return "open"
	case VerbHold:
		return "hold"
	}
	return "close"
}

// Title is the verb as it appears at the start of a button label ("Open Main
// gate" / "Close Main gate").
func (v GateVerb) Title() string {
	switch v {
	case VerbOpen:
		return "Open"
	case VerbHold:
		return "Hold open"
	}
	return "Close"
}

// Past is the verb in the past tense, for copy that states what did NOT happen
// ("so I haven't closed anything").
func (v GateVerb) Past() string {
	switch v {
	case VerbOpen:
		return "opened"
	case VerbHold:
		return "held open"
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
// ok is false for anything outside the closed vocabulary — the same set as
// SelectionCommandVerb, read the other way round.
func GateVerbForCommand(command string) (GateVerb, bool) {
	switch command {
	case "open":
		return VerbOpen, true
	case "close":
		return VerbClose, true
	case "hold":
		return VerbHold, true
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
	case SelSelectLocHold:
		return VerbHold, true
	}
	return verbUnset, false
}

// TextGateVerb reads the verb a free-text body asks for.
//
// ok is false when the body names none of them. There is no default verb
// (docs/CHAT-COMMANDS.md §3.5: "There is no most-likely-intent fallback. There
// is no default verb, no default target") — a body that names a gate and no
// action is a question, not a command, and the caller must ask rather than
// pick the more dangerous of the two.
//
// When a body names more than one, CLOSE wins, then HOLD, then OPEN. Close
// first is the pre-existing WhatsApp precedence (isClose was tested first) and
// is the right way round: of the readings available, the one that leaves the
// gate shut is the one to guess.
//
// Hold before open is not a preference, it is a correctness requirement. The
// natural phrasings — "hold the gate open", "keep it open" — all contain the
// word "open", so checking open first would resolve every plain-English hold
// to a pulse, and the gate would swing shut in the face of whoever was told it
// would stay open. That is a worse failure than the reverse: a hold misread as
// an open is a promise broken at the gate, where a person is standing.
func TextGateVerb(body string) (GateVerb, bool) {
	switch {
	case strings.Contains(body, "close"):
		return VerbClose, true
	// BEFORE "open", and that ordering is the whole point: the natural way to
	// ask for this is "hold the gate open" or "keep it open", both of which
	// contain "open". Checked after open, every hold in plain English would
	// resolve to a pulse — the gate would swing shut in the face of whoever
	// was told it would stay open.
	case strings.Contains(body, "hold"), strings.Contains(body, "keep open"),
		strings.Contains(body, "keep it open"), strings.Contains(body, "leave open"),
		strings.Contains(body, "leave it open"), strings.Contains(body, "stay open"):
		return VerbHold, true
	case strings.Contains(body, "open"):
		return VerbOpen, true
	}
	return verbUnset, false
}

// ActingWord is the present-participle a rail prints while a command is in
// flight: "Opening Main gate...".
//
// It exists because five rails each hand-rolled `word := "Opening"; if command
// == "close" { word = "Closing" }`, and a third command made all five of them
// wrong in the same way at once — a hold answered with "Opening", which tells a
// member the gate will pulse when it will in fact stand open. Copy that
// describes a different action from the one taken is the failure this codebase
// spends most of its effort avoiding, and five copies of a two-branch
// conditional is how it happens.
//
// Fail-safe rather than fail-closed: an unrecognised command yields the neutral
// "Working on" rather than a claim about a direction. There is nothing safe to
// guess here — the actuation decision was made long before this, and inventing
// "Closing" for a command nobody recognises would be as wrong as inventing
// "Opening".
func ActingWord(command string) string {
	switch command {
	case "open":
		return "Opening"
	case "close":
		return "Closing"
	case "hold":
		return "Holding open"
	}
	return "Working on"
}
