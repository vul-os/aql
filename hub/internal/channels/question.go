package channels

import "strings"

// A question about a gate must never move the gate.
//
// # The defect this exists to fix
//
// `TextGateVerb` matched `strings.Contains(body, "open")`, and "opened"
// contains "open". So on the free-text rails:
//
//	"when was the gate last opened?"  → VerbOpen → the gate opened
//	"is the gate closed?"             → VerbClose → the gate closed
//	"who opened the front gate today" → VerbOpen → the gate opened
//
// Not theoretical. Driven end to end through the WhatsApp webhook against a
// one-gate household, each produced a real audited open — because a body that
// names no gate collapses onto the only one when a household has exactly one
// location and one gate, which is the common case this product is for. DMTAP
// reaches the same branch when the question happens to name the gate.
//
// A resident asking their hub a question and hearing the gate swing open is the
// worst version of this codebase's recurring failure: the system did something
// other than what the person asked, and reported success.
//
// # Why the fix narrows the OLD door rather than adding a new one
//
// `TextGateVerb` keeps its name and its two return values and now answers `ok`
// only for a genuine command. Callers that know nothing about questions — every
// existing one, and every one written later by someone who has not read this
// file — get the safe behaviour without doing anything. A rail that wants to
// answer the question calls `TextGateIntent` deliberately.
//
// The alternative was an `IsQuestion` check bolted on at each call site, which
// is two rails today and is one forgotten line away from the same gate opening
// again. Guards you have to remember are guards that get forgotten; this
// codebase has a memory file full of them.
//
// # Which direction the errors run
//
// Both directions are wrong and they are not equally wrong. Refusing a genuine
// open leaves someone standing at a gate in the rain — bad, recoverable in one
// message, and the reply says exactly which message. Actuating on a question
// moves a physical barrier nobody asked to move. So the classifier is built to
// be sure about questions rather than exhaustive about them, and every rule
// below is one that cannot appear in an imperative.
//
// Deliberately NOT a rule: a trailing "?". "Can you open the gate?" is a
// question mark on a request, and this product's members write like that. A
// bare "?" would refuse the most polite phrasing of the one thing chat is for.
//
// Deliberately NOT interrogative auxiliaries: "can", "could", "will", "would",
// "should". Each forms a polite imperative far more often than a question here
// ("could you open the side gate"), and treating them as questions would refuse
// real opens. The cost is that "will the gate open at six" still resolves as a
// command; it needs a gate to resolve against and is answered by the menu on
// most fleets, and closing it properly is the read path's job, not a matcher's.

// Intent is what a free-text body is doing about a gate. Three states, because
// two could not tell "said nothing about a gate" from "asked about one" — and
// those want different replies.
type Intent int

const (
	// IntentNone — the body asks for no gate action at all. The welcome menu is
	// the honest reply; this is the zero value, and it actuates nothing.
	IntentNone Intent = iota
	// IntentCommand — the body asks for the gate to move. The only state that
	// may actuate.
	IntentCommand
	// IntentQuestion — the body asks or reports ABOUT a gate rather than
	// commanding one. Covers "when was it last opened" and the plain statement
	// "the gate opened", which are different sentences with the same correct
	// answer: do not touch the gate.
	IntentQuestion
)

// interrogatives ask for information and cannot begin or appear in an
// imperative. "How" is the one worth naming: "how do I open the gate" is a
// support question whose answer is not an open.
var interrogatives = map[string]bool{
	"when": true, "what": true, "whats": true, "who": true, "whom": true,
	"whose": true, "why": true, "how": true, "where": true, "which": true,
}

// leadingAuxiliaries turn a sentence into a yes/no question when they come
// FIRST. Position is the whole rule: "did the gate close" is a question and
// "close the gate, did you" is not something anyone writes. None of these can
// start a command, which is why this list is safe and "can"/"would" are not on
// it.
var leadingAuxiliaries = map[string]bool{
	"is": true, "are": true, "was": true, "were": true,
	"do": true, "does": true, "did": true,
	"has": true, "have": true, "had": true,
}

// reportWords are gate verbs in a form that cannot be an order. You can open a
// gate; you cannot "opened" one. A body carrying only these is describing
// something that happened.
var reportWords = map[string]bool{
	"opened": true, "closed": true, "held": true, "opening": true, "closing": true,
	"locked": true, "unlocked": true,
}

// commandWords are the imperative forms TextGateVerb resolves. Kept beside
// reportWords on purpose: the pair is the distinction the whole file rests on,
// and splitting them across files is how one gets extended without the other.
var commandWords = map[string]bool{
	"open": true, "close": true, "hold": true,
	"keep": true, "leave": true, "stay": true,
}

// TextGateIntent reads what a free-text body is doing about a gate.
//
// The verb it returns is meaningful for IntentCommand and for IntentQuestion —
// in the second case it is what the member was asking ABOUT, so a reply can say
// "I can't tell you when it was last opened" rather than something generic. It
// is unset for IntentNone.
func TextGateIntent(body string) (GateVerb, Intent) {
	verb, ok := textGateVerbRaw(body)
	if !ok {
		return verbUnset, IntentNone
	}
	if isGateQuestion(body) {
		return verb, IntentQuestion
	}
	return verb, IntentCommand
}

func isGateQuestion(body string) bool {
	words := fields(body)
	if len(words) == 0 {
		return false
	}
	if leadingAuxiliaries[words[0]] {
		return true
	}
	sawCommand, sawReport := false, false
	for _, w := range words {
		if interrogatives[w] {
			return true
		}
		if commandWords[w] {
			sawCommand = true
		}
		if reportWords[w] {
			sawReport = true
		}
	}
	// A body whose only gate word is a past or continuous form is describing,
	// not ordering. The command check has to be there: "open the gate, it never
	// opened last time" carries a real imperative and must still open.
	return sawReport && !sawCommand
}

// fields splits on anything that is not a word byte, so "opened?" and
// "(opened)" both yield "opened". strings.Fields would leave the punctuation
// attached and every lookup above would miss.
func fields(body string) []string {
	return strings.FieldsFunc(strings.ToLower(body), func(r rune) bool {
		return !(r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'))
	})
}
