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
	// QueryEnergy — "how much solar today". §4.2's remaining answerable row.
	//
	// Permitted under §4.4 rule 3 ("no raw telemetry: no series, no
	// per-circuit breakdowns") because the answer is a single aggregate per
	// source over one day. A curve would be an appliance fingerprint and a
	// schedule (§4.3); a day's total is neither.
	QueryEnergy
)

func (k QueryKind) String() string {
	switch k {
	case QueryLastOpen:
		return "last-open"
	case QueryOnline:
		return "online"
	case QueryPosition:
		return "position"
	case QueryEnergy:
		return "energy"
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

// energyWords ask about generation or consumption. Checked FIRST, ahead of the
// gate vocabulary, because "how much solar have we made today" carries "how"
// and would otherwise be a gate question the hub cannot answer — and because an
// energy question names no gate, so the gate classifications would all miss and
// it would fall to QueryUnknown.
var energyWords = map[string]bool{
	"solar": true, "generated": true, "generation": true, "kwh": true,
	"grid": true, "battery": true, "energy": true, "power": true,
	"consumed": true, "consumption": true, "used": true, "usage": true,
}

// occupancyWords ask what is on, or who is in. §4.3: "which lights are on" is
// an occupancy question, and so is anything that reports an away-state.
var occupancyWords = map[string]bool{
	"lights": true, "light": true, "lamps": true, "occupied": true,
	"home": true, "away": true, "anyone": true, "anybody": true, "presence": true,
}

// ClassifyOccupancyQuestion reports whether a body asks something that
// discloses occupancy — the class §4.4 rule 6 puts behind a per-location
// opt-in.
//
// Deliberately broad. The cost of a false positive is a member being told the
// disclosure is off for their location, which is accurate and harmless; the
// cost of a false negative is answering an occupancy question for a household
// that never consented. Those are not symmetric, so this errs toward the
// refusal.
func ClassifyOccupancyQuestion(body string) bool {
	for _, w := range fields(body) {
		if occupancyWords[w] {
			return true
		}
	}
	return false
}

// OccupancyDisclosureOff explains why a question about lights or presence went
// unanswered, and where the switch is.
//
// It names the setting rather than saying "I can't". A member asking which
// lights are on has asked something the hub could answer, and being told the
// household has not turned that on is a different fact from being told the
// feature does not exist — the same distinction §4.1 draws for the gate sensor.
func OccupancyDisclosureOff(publicURL string) string {
	return "This home has not turned on occupancy answers over chat, so I won't say " +
		"which lights are on or whether anyone is in. An admin can enable it per " +
		"location in the console" + portalSuffix(publicURL)
}

// LightFact is one light the hub can speak for, or admit it cannot.
type LightFact struct {
	Name string
	// Active is meaningful only when Known is true. A caller that treats
	// !Active as "off" folds every unreported device into off, which is the
	// failure docs/DEVICE-STATE.md §3.3 exists to prevent.
	Active bool
	Known  bool
}

// LightsAnswer reports which lights are on.
//
// docs/CHAT-COMMANDS.md §4.2, behind §4.4 rule 6's consent, over
// DEVICE-STATE.md's declared states. Three rules meet here and all three are
// about admitting edges:
//
//   - §3.3: the count is over devices whose state the hub KNOWS, and it says
//     how many it could not speak for. "2 of 10 are on" when seven never
//     reported is a partial answer that reads as complete.
//   - §4.4 rule 2: capped, and the truncation is stated.
//   - §4.3: names and on/off, nothing else. No zones, no levels, no times — a
//     brightness curve is an appliance fingerprint and a room-by-room list is
//     a floor plan.
func LightsAnswer(facts []LightFact, total int, publicURL string) string {
	if len(facts) == 0 {
		return "You don't have any lights I can see, so there's nothing to report."
	}
	var on, unknown []string
	for _, f := range facts {
		switch {
		case !f.Known:
			unknown = append(unknown, f.Name)
		case f.Active:
			on = append(on, f.Name)
		}
	}
	known := len(facts) - len(unknown)

	var b strings.Builder
	switch {
	case known == 0:
		b.WriteString("None of these lights report whether they are on.")
	case len(on) == 0:
		fmt.Fprintf(&b, "None of the %d lights I can read are on.", known)
	default:
		fmt.Fprintf(&b, "%d of %d: %s.", len(on), known, strings.Join(on, ", "))
	}
	if len(unknown) > 0 {
		// Named rather than counted. An operator whose light never answers
		// needs to know WHICH one, and the name is what they configured.
		fmt.Fprintf(&b, "\n\n%d don't report their state: %s.",
			len(unknown), strings.Join(unknown, ", "))
	}
	if total > len(facts) {
		fmt.Fprintf(&b, "\n\nShowing %d of %d lights.", len(facts), total)
	}
	if publicURL != "" {
		b.WriteString(" All of them are in the console" + portalSuffix(publicURL))
	}
	return b.String()
}

// OccupancyEnabledButUnbuilt is the reply when a household HAS consented and
// the hub still cannot answer.
//
// This is the honest end of a half-built path, and it is deliberately not
// silence. A member who turned the setting on and then got nothing would
// reasonably conclude the switch is broken; telling them the consent is
// recorded and the answer is not built yet distinguishes "you did it wrong"
// from "we have not finished". The same distinction §4.1 makes about the gate
// sensor, applied to a feature rather than to hardware.
//
// The reason is named rather than hand-waved, because it is a real one and not
// a scheduling excuse. A device's state exists only as Device.Summary — free
// text a driver wrote for a human ("62% · warm", "warm white", "on") — which
// the model documents as "presentational; never parsed". Counting lights would
// mean guessing at each driver's vocabulary and reporting the guess as a fact
// about someone's home. It needs a machine-readable state on the device model,
// and devices/summarycontract_test.go keeps the shortcut closed until there is
// one.
func OccupancyEnabledButUnbuilt(consented, total int, publicURL string) string {
	var b strings.Builder
	b.WriteString("Occupancy answers are enabled for ")
	if consented == total {
		b.WriteString("this home")
	} else {
		fmt.Fprintf(&b, "%d of your %d locations", consented, total)
	}
	b.WriteString(", but I still can't say which lights are on: a device reports its " +
		"state as text for a person to read, not as something I can count. The console " +
		"shows each one" + portalSuffix(publicURL))
	return b.String()
}

// ClassifyEnergyQuestion reports whether a body is asking about energy at all.
//
// Separate from ClassifyGateQuestion because the two are answered from
// different stores and scoped differently — energy is per ACCOUNT, gates are
// per authorized access point — and folding them into one classifier would mean
// one function whose result the caller has to demultiplex anyway.
func ClassifyEnergyQuestion(body string) bool {
	for _, w := range fields(body) {
		if energyWords[w] {
			return true
		}
	}
	return false
}

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

// EnergyFact is a day's energy, in the shape §4.4 rule 3 permits: one number
// per source, no series, no per-circuit breakdown.
type EnergyFact struct {
	Source string
	KWh    float64
	// Complete is false when a meter was down for part of the window. The
	// number is still reported — a floor is more useful than silence — but it
	// is marked, because "we generated 12 kWh" and "at least 12 kWh, one meter
	// was down" are different claims.
	Complete bool
}

// EnergyAnswer renders a day's energy.
//
// Unattributed energy is stated rather than folded in. energy/mix.go keeps it
// out of every source deliberately, and a reply that quietly added it to
// "grid" would be inventing an attribution the meter never made — the same
// discipline the rest of this file applies to gates.
func EnergyAnswer(facts []EnergyFact, unattributedKWh float64, publicURL string) string {
	if len(facts) == 0 {
		return "This hub is not metering anything, so there is nothing to report. " +
			"Energy monitoring is set up in the console" + portalSuffix(publicURL)
	}
	var b strings.Builder
	b.WriteString("Today so far:")
	anyIncomplete := false
	for _, f := range facts {
		fmt.Fprintf(&b, "\n%s: %.1f kWh", f.Source, f.KWh)
		if !f.Complete {
			b.WriteString(" (at least — a meter was down for part of the day)")
			anyIncomplete = true
		}
	}
	if unattributedKWh > 0 {
		fmt.Fprintf(&b, "\n\n%.1f kWh is on channels nobody has classified, so it is not "+
			"counted under any source.", unattributedKWh)
	}
	if anyIncomplete {
		b.WriteString("\n\nWhere a meter was down the figure is a floor, not a total.")
	}
	b.WriteString("\n\nThe breakdown is in the console" + portalSuffix(publicURL))
	return b.String()
}

func portalSuffix(publicURL string) string {
	if publicURL == "" {
		return "."
	}
	return ": " + trimURL(publicURL) + "/app"
}
