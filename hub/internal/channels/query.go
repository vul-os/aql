package channels

import (
	"fmt"
	"strings"
	"time"
)

// Answering a question about a gate — docs/CHAT-COMMANDS.md §4.
//
// question.go stopped questions from actuating. This is the other half: saying
// something true in reply, from what the hub actually knows.
//
// # The one that cannot be answered
//
// "Is the gate closed?" is the obvious question and the hub genuinely cannot
// answer it. proto/commands.md has no read command; `ping` returns liveness and
// a clock, not position. Real position needs the `held_open` event, which needs
// a sensor the controller does not have. So the reply names the last acked
// command and then says plainly that the current state is unknown — never "the
// gate is closed", which would be a guess about a physical barrier.
//
// That distinction is the reason this file classifies at all. A single "here is
// what I know" reply would blur "it was opened at 12:04" into "it is open".
//
// # What a reply may contain (§4.3, §4.4)
//
// A command reply says "Opening Main gate…". A query reply can hand the chat
// platform a map of the property, so:
//
//   - Only gates the caller could open anyway. A device you cannot command is a
//     device you cannot see, and the caller's authorized set is the same one the
//     picker is built from.
//   - Capped at PickerCapacity and the truncation is STATED. "3 of 12" is a
//     different fact from "3", and a member who is not told about the other nine
//     will believe they have seen everything.
//   - No timestamps finer than a minute, no counts of who, no coordinates. The
//     open history is an occupancy record and the point is to answer the
//     question, not to export the log.

// QueryKind is what a question is asking for. It is resolved only for a body
// question.go has already classified as IntentQuestion, so nothing here can
// cause an actuation whatever it decides.
type QueryKind int

const (
	// QueryUnknown — a question about a gate whose subject is not one of the
	// three below. Answered honestly as "not something I can tell you", never
	// with the nearest thing that happens to be in the database.
	QueryUnknown QueryKind = iota
	// QueryLastOpen — "when was the gate last opened". Answerable from
	// access_logs.
	QueryLastOpen
	// QueryOnline — "is the controller online". Answerable from
	// devices.last_seen_at.
	QueryOnline
	// QueryPosition — "is the gate closed". NOT answerable, and the whole
	// reason this enum has a fourth value: it is a question the hub must
	// refuse specifically rather than generically, because a generic refusal
	// reads as "I did not understand" when the truth is "no sensor exists".
	QueryPosition
)

func (k QueryKind) String() string {
	switch k {
	case QueryLastOpen:
		return "last-open"
	case QueryOnline:
		return "online"
	case QueryPosition:
		return "position"
	}
	return "unknown"
}

// onlineWords ask about the controller's reachability rather than the gate's
// position. Checked FIRST: "is the gate online" contains "open"-adjacent
// framing in several phrasings and would otherwise land on position, which is
// the one answer that has to say "I cannot know" — answering a question the hub
// CAN answer with a refusal is its own kind of wrong.
var onlineWords = map[string]bool{
	"online": true, "offline": true, "connected": true, "disconnected": true,
	"reachable": true, "responding": true, "alive": true, "up": true, "down": true,
}

// positionWords ask what the barrier is doing right now.
var positionWords = map[string]bool{
	"closed": true, "shut": true, "ajar": true, "position": true,
}

// historyWords ask about the past. "Last" and "when" are the two that carry it;
// both are useless on their own ("when is dinner") and are only consulted for a
// body already known to be asking about a gate.
var historyWords = map[string]bool{
	"last": true, "when": true, "recently": true, "history": true, "log": true,
}

// whoWords ask which PERSON, and are refused rather than answered with
// something nearby.
var whoWords = map[string]bool{"who": true, "whom": true, "whose": true}

// "who" is deliberately absent from historyWords. "Who opened the gate?" is a
// history question whose answer names a person, and no rule in §4.4 authorises
// chat to do that — a member with access to a shared gate would be able to
// track another resident's comings and goings from their phone. It falls to
// QueryUnknown, whose reply states what CAN be answered ("when a gate was last
// opened") without ever offering the who. That is a refusal by omission, so it
// is written down here rather than left to be re-derived as a missing word.

// ClassifyGateQuestion resolves what a gate question is asking.
//
// The verb comes from TextGateIntent and disambiguates what the history words
// refer to, so "when was it last closed" reports the last close rather than the
// last open.
func ClassifyGateQuestion(body string) QueryKind {
	words := fields(body)
	has := func(m map[string]bool) bool {
		for _, w := range words {
			if m[w] {
				return true
			}
		}
		return false
	}
	switch {
	// FIRST, ahead of everything answerable. "Who closed the gate?" contains
	// "closed" and would otherwise be classified as a position question and
	// answered with the last close time — a confident answer to a question
	// nobody asked, which reads as an evasion of the one they did. A question
	// about a person is refused as such.
	case has(whoWords):
		return QueryUnknown
	case has(onlineWords):
		return QueryOnline
	case has(historyWords):
		return QueryLastOpen
	case has(positionWords):
		return QueryPosition
	}
	// "is the gate open" — a state question with no history word and no
	// position word, because "open" is the gate verb rather than a position
	// word here. It is the same unanswerable question as "is it closed".
	if len(words) > 0 && leadingAuxiliaries[words[0]] {
		return QueryPosition
	}
	return QueryUnknown
}

// GateFact is the disclosable state of one gate. Deliberately small: it carries
// what the three answerable questions need and nothing else, so widening what
// chat can leak means changing this type rather than passing a richer struct
// through and forgetting which fields get printed.
type GateFact struct {
	Name string
	// LastOpenAt / LastCloseAt are unix seconds, 0 for never.
	LastOpenAt  int64
	LastCloseAt int64
	// LastSeenAt is when the controller last spoke to the hub, 0 if it never
	// has or if the gate has no controller paired at all — the two are
	// distinguished by HasDevice, because "never connected" and "no device" are
	// different problems for whoever has to fix them.
	LastSeenAt int64
	HasDevice  bool
}

// OnlineWindow is how long after its last contact a controller is still called
// online.
//
// Two minutes, matching the clock-sync and liveness cadence rather than being
// chosen here. A window that is too generous reports a controller as online
// while an open silently queues; too tight and every reply says offline for a
// device that is fine.
const OnlineWindow = 2 * time.Minute

// QueryAnswer renders the reply for a classified question.
//
// total is how many gates the caller is authorized for; facts is at most
// PickerCapacity of them. The pair is what makes the truncation statable — a
// single slice cannot say "and nine more".
func QueryAnswer(kind QueryKind, verb GateVerb, facts []GateFact, total int, nowUnix int64, publicURL string) string {
	if len(facts) == 0 {
		return "You don't have access to any gates right now, so there's nothing I can tell you about one."
	}
	var b strings.Builder
	switch kind {
	case QueryLastOpen:
		writeLastOp(&b, verb, facts, nowUnix)
	case QueryOnline:
		writeOnline(&b, facts, nowUnix)
	case QueryPosition:
		writePosition(&b, facts, nowUnix)
	default:
		b.WriteString("I can't tell you that. I can say when a gate was last opened or closed, and whether its controller is online.")
	}
	if total > len(facts) {
		fmt.Fprintf(&b, "\n\nShowing %d of %d gates.", len(facts), total)
	}
	if publicURL != "" {
		b.WriteString(" The full log is in the console: " + trimURL(publicURL) + "/app")
	}
	return b.String()
}

func writeLastOp(b *strings.Builder, verb GateVerb, facts []GateFact, nowUnix int64) {
	// Which timestamp answers the question depends on the verb the member used.
	// "When was it last closed" reporting the last OPEN would be a confident
	// answer to a different question, which is worse than no answer.
	wantClose := verb == VerbClose
	word := "opened"
	if wantClose {
		word = "closed"
	}
	for i, f := range facts {
		if i > 0 {
			b.WriteString("\n")
		}
		ts := f.LastOpenAt
		if wantClose {
			ts = f.LastCloseAt
		}
		if ts == 0 {
			fmt.Fprintf(b, "%s: no successful %s has ever been recorded.", f.Name, strings.TrimSuffix(word, "ed"))
			continue
		}
		fmt.Fprintf(b, "%s: last %s %s.", f.Name, word, agoPhrase(nowUnix-ts))
	}
	// The qualifier is not optional. An acked open means the controller
	// reported success, not that the barrier moved — proto/commands.md is
	// explicit that undelivered is a dispatch outcome and not a negative
	// result, and the same asymmetry applies to success.
	b.WriteString("\n\nThat's when the command was acknowledged, not proof the gate moved.")
}

func writeOnline(b *strings.Builder, facts []GateFact, nowUnix int64) {
	for i, f := range facts {
		if i > 0 {
			b.WriteString("\n")
		}
		switch {
		case !f.HasDevice:
			fmt.Fprintf(b, "%s: no controller is paired to it.", f.Name)
		case f.LastSeenAt == 0:
			fmt.Fprintf(b, "%s: its controller has never connected.", f.Name)
		case nowUnix-f.LastSeenAt <= int64(OnlineWindow.Seconds()):
			fmt.Fprintf(b, "%s: controller online.", f.Name)
		default:
			fmt.Fprintf(b, "%s: controller last seen %s.", f.Name, agoPhrase(nowUnix-f.LastSeenAt))
		}
	}
}

// writePosition answers §4.1's unanswerable question, in §4.1's shape: what was
// last acked, then the limit, said plainly.
func writePosition(b *strings.Builder, facts []GateFact, nowUnix int64) {
	for i, f := range facts {
		if i > 0 {
			b.WriteString("\n")
		}
		last, word := f.LastOpenAt, "open"
		if f.LastCloseAt > last {
			last, word = f.LastCloseAt, "close"
		}
		if last == 0 {
			fmt.Fprintf(b, "%s: no command has ever been recorded for it.", f.Name)
			continue
		}
		fmt.Fprintf(b, "%s: last %s command acked %s.", f.Name, word, agoPhrase(nowUnix-last))
	}
	b.WriteString("\n\nI can't confirm whether a gate is open or closed right now — " +
		"these gates have no position sensor, so the hub only knows what it was last told to do.")
}

// agoPhrase renders an elapsed time coarsely and on purpose. A second-precision
// timestamp on an access record is a movement log; "about 3 hours ago" answers
// the question a person asked without handing the chat platform one.
func agoPhrase(elapsed int64) string {
	switch {
	case elapsed < 0:
		// A clock disagreement, not a time in the future. Saying "in 4 minutes"
		// about something that already happened would be worse than vague.
		return "just now"
	case elapsed < 90:
		return "just now"
	case elapsed < 3600:
		return fmt.Sprintf("about %d min ago", (elapsed+30)/60)
	case elapsed < 36*3600:
		return fmt.Sprintf("about %d h ago", (elapsed+1800)/3600)
	default:
		return fmt.Sprintf("about %d days ago", (elapsed+43200)/86400)
	}
}
