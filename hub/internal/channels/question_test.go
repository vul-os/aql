package channels

import (
	"strings"
	"testing"
)

// The bodies that used to open a gate.
//
// Each was driven end to end through the WhatsApp webhook before the fix and
// produced a real audited open against a one-gate household. They are kept here
// verbatim rather than paraphrased: the defect was a substring match ("opened"
// contains "open"), so the exact wording IS the test.
func TestAQuestionAboutAGateIsNotACommand(t *testing.T) {
	questions := []string{
		"when was the gate last opened?",
		"when was the gate last opened",
		"who opened the front gate today",
		"has anyone opened the gate today",
		"is the gate closed?",
		"is the gate open",
		"did the gate close",
		"was the side gate opened last night",
		"why is the gate open",
		"how do i open the gate",
		"what time did the gate close",
		"which gate is open",
		"the gate opened by itself",
		"were the gates closed overnight",
		"do you know when the gate opened",
		"where is the gate that opened",
	}
	for _, q := range questions {
		if v, ok := TextGateVerb(NormalizeText(q)); ok {
			t.Errorf("%q would actuate %q — a question moved a gate", q, v)
		}
		if _, intent := TextGateIntent(NormalizeText(q)); intent != IntentQuestion {
			t.Errorf("%q classified %v, want IntentQuestion", q, intent)
		}
	}
}

// The control, and it is the half that matters most.
//
// A classifier that answered "question" to everything would pass the test above
// and leave a member standing at their gate unable to open it. Every phrasing
// here is one this product's members actually send, including the polite ones
// that are grammatically questions — "could you open the gate" is a request and
// must keep working.
func TestARequestToOpenStillOpens(t *testing.T) {
	type want struct {
		body string
		verb GateVerb
	}
	commands := []want{
		{"open", VerbOpen},
		{"open the gate", VerbOpen},
		{"please open the main gate", VerbOpen},
		{"can you open the gate", VerbOpen},
		{"can you open the gate?", VerbOpen},
		{"could you open the side gate please", VerbOpen},
		{"would you open the front gate", VerbOpen},
		{"will you open the gate", VerbOpen},
		{"gate open pls", VerbOpen},
		{"open up", VerbOpen},
		{"close", VerbClose},
		{"close the back gate", VerbClose},
		{"please close the gate", VerbClose},
		{"hold the gate open", VerbHold},
		{"leave it open", VerbHold},
		// A real imperative alongside a report still actuates. This is the
		// sawCommand branch, and without it "open the gate, it never opened
		// last time" would be refused.
		{"open the gate, it never opened last time", VerbOpen},
	}
	for _, c := range commands {
		v, ok := TextGateVerb(NormalizeText(c.body))
		if !ok {
			t.Errorf("%q no longer opens anything — a real request was refused", c.body)
			continue
		}
		if v != c.verb {
			t.Errorf("%q resolved %q, want %q", c.body, v, c.verb)
		}
	}
}

// Bodies about no gate at all keep their welcome menu. A question classifier
// that swallowed ordinary chatter would answer "thanks" with a refusal.
func TestChatterIsStillNeitherCommandNorQuestion(t *testing.T) {
	for _, body := range []string{
		"thanks", "hi", "hello", "ok", "see you at 6", "what time is dinner",
		"turn on the porch light",
	} {
		if _, intent := TextGateIntent(NormalizeText(body)); intent != IntentNone {
			t.Errorf("%q classified %v, want IntentNone", body, intent)
		}
	}
}

// The reply has to do two things, and the second is what makes a false positive
// survivable: it names the exact message that would have worked.
func TestGateQuestionReplySaysNothingMovedAndHowToMove(t *testing.T) {
	for _, v := range []GateVerb{VerbOpen, VerbClose, VerbHold} {
		got := GateQuestionReply(v, "https://hub.example")
		if !strings.Contains(got, "haven't touched it") {
			t.Errorf("%v reply does not say the gate was untouched: %q", v, got)
		}
		if !strings.Contains(got, `"`+string(v.Command())+`"`) {
			t.Errorf("%v reply does not name the message that would work: %q", v, got)
		}
		// It must never read as though the gate moved.
		for _, forbidden := range []string{"Opening", "Closing", "Holding open"} {
			if strings.Contains(got, forbidden) {
				t.Errorf("%v reply implies actuation (%q): %q", v, forbidden, got)
			}
		}
	}
	// Without a portal there is no dangling "the log is in the console:".
	if got := GateQuestionReply(VerbOpen, ""); strings.Contains(got, "console") {
		t.Errorf("reply offers a console with no URL configured: %q", got)
	}
}
