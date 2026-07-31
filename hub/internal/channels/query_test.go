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
