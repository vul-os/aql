package channels

import (
	"strings"
	"testing"
)

func TestGateQuestionsClassifyToWhatTheHubCanAnswer(t *testing.T) {
	cases := []struct {
		body string
		want QueryKind
	}{
		{"when was the gate last opened?", QueryLastOpen},
		{"when was the main gate last closed", QueryLastOpen},
		{"has the gate been opened recently", QueryLastOpen},
		{"show me the gate log", QueryLastOpen},

		{"is the controller online", QueryOnline},
		{"is the gate offline", QueryOnline},
		{"is the gate controller connected", QueryOnline},
		{"is the gate responding", QueryOnline},

		{"is the gate closed?", QueryPosition},
		{"is the gate shut", QueryPosition},
		{"is the gate open", QueryPosition},
		{"are the gates closed overnight", QueryPosition},

		// Deliberately unknown: the answer would name a person.
		{"who opened the front gate today", QueryUnknown},
		{"who closed the gate", QueryUnknown},
	}
	for _, c := range cases {
		if got := ClassifyGateQuestion(NormalizeText(c.body)); got != c.want {
			t.Errorf("%q classified %v, want %v", c.body, got, c.want)
		}
	}
}

// Online is checked before position because it is the one the hub CAN answer.
// Answering an answerable question with "I have no sensor" is its own failure.
func TestAnOnlineQuestionIsNotAnsweredAsAnUnknownPosition(t *testing.T) {
	for _, body := range []string{
		"is the gate online", "is the main gate online or offline",
	} {
		if got := ClassifyGateQuestion(NormalizeText(body)); got != QueryOnline {
			t.Errorf("%q classified %v, want online", body, got)
		}
	}
}

func facts() []GateFact {
	return []GateFact{{
		Name: "Main gate", LastOpenAt: 1_000_000, LastCloseAt: 999_000,
		LastSeenAt: 1_000_500, HasDevice: true,
	}}
}

// The position answer is the one §4.1 is written about: it must never claim a
// state, and it must say WHY it cannot.
func TestThePositionAnswerNeverClaimsTheGateIsOpenOrClosed(t *testing.T) {
	got := QueryAnswer(QueryPosition, VerbOpen, facts(), 1, 1_001_000, "")
	if !strings.Contains(got, "can't confirm") || !strings.Contains(got, "no position sensor") {
		t.Errorf("position answer does not say why it cannot know: %q", got)
	}
	// The claim shape that would be wrong is the gate NAMED as being in a
	// state. Checking for a bare "is open" would match the disclaimer's own
	// wording ("whether a gate is open or closed right now") and pass while
	// checking nothing.
	for _, claim := range []string{
		"Main gate is open", "Main gate is closed",
		"Main gate: open", "Main gate: closed",
	} {
		if strings.Contains(got, claim) {
			t.Errorf("position answer claims a state (%q): %q", claim, got)
		}
	}
	// It reports the last ACKED command, and says that is what it is.
	if !strings.Contains(got, "acked") {
		t.Errorf("position answer does not qualify the timestamp: %q", got)
	}
}

// An acked open is not a gate that moved — the same asymmetry proto/commands.md
// draws for `undelivered`. The qualifier is not decoration.
func TestTheHistoryAnswerDoesNotClaimTheGateMoved(t *testing.T) {
	got := QueryAnswer(QueryLastOpen, VerbOpen, facts(), 1, 1_001_000, "")
	if !strings.Contains(got, "not proof the gate moved") {
		t.Errorf("history answer presents an ack as movement: %q", got)
	}
}

// "When was it last CLOSED" must not be answered with the last open. A
// confident answer to a different question is worse than no answer.
func TestTheVerbDecidesWhichTimestampIsReported(t *testing.T) {
	f := []GateFact{{Name: "Main gate", LastOpenAt: 1_000_000, LastCloseAt: 900_000}}
	open := QueryAnswer(QueryLastOpen, VerbOpen, f, 1, 1_000_600, "")
	closed := QueryAnswer(QueryLastOpen, VerbClose, f, 1, 1_000_600, "")
	if !strings.Contains(open, "opened") || strings.Contains(open, "last closed") {
		t.Errorf("open question answered wrong: %q", open)
	}
	if !strings.Contains(closed, "closed") {
		t.Errorf("close question not answered with the close time: %q", closed)
	}
	// The two must not render identically — that would mean the verb was ignored.
	if open == closed {
		t.Errorf("verb ignored: both render %q", open)
	}
}

// §4.4 rule 2. A truncated list that does not say it is truncated tells a
// member they have seen everything.
func TestATruncatedAnswerSaysSo(t *testing.T) {
	got := QueryAnswer(QueryOnline, VerbOpen, facts(), 12, 1_001_000, "")
	if !strings.Contains(got, "Showing 1 of 12") {
		t.Errorf("truncation not stated: %q", got)
	}
	// And an untruncated one does not invent the disclaimer.
	if full := QueryAnswer(QueryOnline, VerbOpen, facts(), 1, 1_001_000, ""); strings.Contains(full, "Showing") {
		t.Errorf("untruncated answer claims truncation: %q", full)
	}
}

// "No controller paired", "never connected" and "offline" are three different
// problems for whoever has to fix them, and collapsing them wastes a callout.
func TestOnlineAnswerSeparatesNoDeviceFromNeverSeenFromStale(t *testing.T) {
	now := int64(1_000_000)
	cases := []struct {
		fact GateFact
		want string
	}{
		{GateFact{Name: "A", HasDevice: false}, "no controller is paired"},
		{GateFact{Name: "B", HasDevice: true, LastSeenAt: 0}, "never connected"},
		{GateFact{Name: "C", HasDevice: true, LastSeenAt: now - 30}, "controller online"},
		{GateFact{Name: "D", HasDevice: true, LastSeenAt: now - 7200}, "last seen"},
	}
	for _, c := range cases {
		got := QueryAnswer(QueryOnline, VerbOpen, []GateFact{c.fact}, 1, now, "")
		if !strings.Contains(got, c.want) {
			t.Errorf("%s: %q does not contain %q", c.fact.Name, got, c.want)
		}
	}
}

// Coarse on purpose (§4.3): a second-precision access record is a movement log.
func TestElapsedTimeIsReportedCoarsely(t *testing.T) {
	got := QueryAnswer(QueryLastOpen, VerbOpen, []GateFact{{Name: "G", LastOpenAt: 1_000_000}}, 1, 1_000_000+3*3600, "")
	if !strings.Contains(got, "about 3 h ago") {
		t.Errorf("not coarse: %q", got)
	}
	// A clock disagreement must not produce a time in the future.
	future := QueryAnswer(QueryLastOpen, VerbOpen, []GateFact{{Name: "G", LastOpenAt: 2_000_000}}, 1, 1_000_000, "")
	if strings.Contains(future, "-") {
		t.Errorf("negative elapsed rendered: %q", future)
	}
}

// A caller with no gates is told that, rather than shown an empty list that
// reads as "nothing has ever happened".
func TestNoAuthorizedGatesIsSaidPlainly(t *testing.T) {
	got := QueryAnswer(QueryLastOpen, VerbOpen, nil, 0, 1_000_000, "")
	if !strings.Contains(got, "don't have access to any gates") {
		t.Errorf("empty set answered wrongly: %q", got)
	}
}

// The unknown answer states what CAN be answered and never offers the who.
func TestTheUnknownAnswerNeverOffersToNameAPerson(t *testing.T) {
	got := QueryAnswer(QueryUnknown, VerbOpen, facts(), 1, 1_000_000, "")
	if !strings.Contains(got, "can't tell you that") {
		t.Errorf("unknown answer is not a refusal: %q", got)
	}
	for _, leak := range []string{"who", "Who"} {
		if strings.Contains(got, leak) {
			t.Errorf("unknown answer offers to name a person: %q", got)
		}
	}
}

// ---------------------------------------------------------------------------
// Energy — docs/CHAT-COMMANDS.md §4.2's remaining answerable row
// ---------------------------------------------------------------------------

func TestEnergyQuestionsAreRecognisedWithoutNamingAGate(t *testing.T) {
	for _, body := range []string{
		"how much solar today", "how much solar have we generated today",
		"what's the grid usage", "how much energy did we use",
		"battery today", "how many kwh",
	} {
		if !ClassifyEnergyQuestion(NormalizeText(body)) {
			t.Errorf("%q not recognised as an energy question", body)
		}
	}
	// And gate questions are not energy questions, or the energy path would
	// swallow them before the gate classifier ran.
	for _, body := range []string{
		"when was the gate last opened?", "is the gate closed", "open the gate",
		"turn on the porch light", "thanks",
	} {
		if ClassifyEnergyQuestion(NormalizeText(body)) {
			t.Errorf("%q read as an energy question", body)
		}
	}
}

// §4.4 rule 3: no series, no per-circuit breakdown. The answer is one number
// per source and says nothing about when any of it happened.
func TestTheEnergyAnswerIsAnAggregateNotACurve(t *testing.T) {
	got := EnergyAnswer([]EnergyFact{
		{Source: "solar", KWh: 12.4, Complete: true},
		{Source: "grid", KWh: 3.2, Complete: true},
	}, 0, testPortal)

	if !strings.Contains(got, "solar: 12.4 kWh") || !strings.Contains(got, "grid: 3.2 kWh") {
		t.Errorf("answer does not carry the totals: %q", got)
	}
	// A time-of-day breakdown would be the appliance fingerprint §4.3 warns
	// about. Nothing in the reply may look like one.
	for _, leak := range []string{":00", "hourly", "per hour", "peak at"} {
		if strings.Contains(got, leak) {
			t.Errorf("answer leaks a curve (%q): %q", leak, got)
		}
	}
}

// A meter that was down makes the figure a FLOOR, and the reply says so. A
// number presented as a total when a meter was dark is the same class of
// falsehood as an acked open presented as a gate that moved.
func TestAnIncompleteEnergyFigureIsMarkedAsAFloor(t *testing.T) {
	got := EnergyAnswer([]EnergyFact{{Source: "solar", KWh: 9, Complete: false}}, 0, "")
	if !strings.Contains(got, "at least") || !strings.Contains(got, "floor") {
		t.Errorf("an incomplete figure is presented as a total: %q", got)
	}
	// A complete one carries no such hedge.
	if full := EnergyAnswer([]EnergyFact{{Source: "solar", KWh: 9, Complete: true}}, 0, ""); strings.Contains(full, "at least") {
		t.Errorf("a complete figure was hedged: %q", full)
	}
}

// Unattributed energy is stated, never folded into a source. energy/mix.go
// keeps it out of every total deliberately; a reply that added it to "grid"
// would invent an attribution the meter never made.
func TestUnattributedEnergyIsStatedNotFoldedIn(t *testing.T) {
	got := EnergyAnswer([]EnergyFact{{Source: "solar", KWh: 10, Complete: true}}, 2.5, "")
	if !strings.Contains(got, "2.5 kWh") || !strings.Contains(got, "not") {
		t.Errorf("unattributed energy is not reported: %q", got)
	}
	if !strings.Contains(got, "solar: 10.0 kWh") {
		t.Errorf("unattributed energy was folded into a source: %q", got)
	}
}

// A hub that meters nothing says so, rather than reporting zeros that would
// read as "we generated nothing today".
func TestAHubThatMetersNothingSaysSo(t *testing.T) {
	got := EnergyAnswer(nil, 0, testPortal)
	if !strings.Contains(got, "not metering anything") {
		t.Errorf("an unmetered hub answered: %q", got)
	}
	if strings.Contains(got, "0.0 kWh") {
		t.Errorf("an unmetered hub reported zeros: %q", got)
	}
}

// ---------------------------------------------------------------------------
// "Which lights are on" — §4.2's last row
// ---------------------------------------------------------------------------
//
// Three rules meet in this reply and all three are about admitting edges:
// DEVICE-STATE.md §3.3 (count only what is known, say what is not), §4.4 rule 2
// (cap and state the truncation), §4.3 (names and on/off, nothing more).

func TestTheLightsAnswerCountsOnlyWhatItKnows(t *testing.T) {
	got := LightsAnswer([]LightFact{
		{Name: "Porch", Active: true, Known: true},
		{Name: "Hall", Active: false, Known: true},
		{Name: "Shed", Known: false},
	}, 3, "")

	// The count denominator is the KNOWN devices, not the fleet. "1 of 3" would
	// be counting the shed as off.
	if !strings.Contains(got, "1 of 2") {
		t.Errorf("count is not over known devices: %q", got)
	}
	if !strings.Contains(got, "Porch") {
		t.Errorf("the light that is on is not named: %q", got)
	}
	// And the unreported one is named, because an operator whose light never
	// answers needs to know which.
	if !strings.Contains(got, "Shed") || !strings.Contains(got, "don't report") {
		t.Errorf("the unreported light is not disclosed: %q", got)
	}
}

// A fleet nothing reports for is not a fleet that is off.
func TestAFleetThatReportsNothingSaysSoRatherThanNone(t *testing.T) {
	got := LightsAnswer([]LightFact{{Name: "A"}, {Name: "B"}}, 2, "")
	if !strings.Contains(got, "None of these lights report") {
		t.Errorf("a silent fleet was reported as all-off: %q", got)
	}
	// Distinct from a fleet that reported and is genuinely all off.
	off := LightsAnswer([]LightFact{{Name: "A", Known: true}, {Name: "B", Known: true}}, 2, "")
	if !strings.Contains(off, "None of the 2 lights I can read are on") {
		t.Errorf("an all-off fleet: %q", off)
	}
	if off == got {
		t.Error("a silent fleet and an all-off fleet render identically")
	}
}

// §4.4 rule 2, and §4.3: the reply names lights and their state, and nothing
// that would build a floor plan or an appliance fingerprint.
func TestTheLightsAnswerStatesTruncationAndLeaksNothingElse(t *testing.T) {
	facts := make([]LightFact, 0, 10)
	for i := 0; i < 10; i++ {
		facts = append(facts, LightFact{Name: "Light " + string(rune('A'+i)), Known: true})
	}
	got := LightsAnswer(facts, 34, testPortal)
	if !strings.Contains(got, "Showing 10 of 34") {
		t.Errorf("truncation not stated: %q", got)
	}
	for _, leak := range []string{"%", "zone", "Zone", "kWh", ":00", "level"} {
		if strings.Contains(got, leak) {
			t.Errorf("reply leaks %q: %q", leak, got)
		}
	}
}

func TestNoLightsAtAllIsSaidPlainly(t *testing.T) {
	if got := LightsAnswer(nil, 0, ""); !strings.Contains(got, "don't have any lights") {
		t.Errorf("an empty fleet: %q", got)
	}
}
