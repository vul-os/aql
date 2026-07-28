package channels

import (
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

// A member who asks for something chat cannot do must be told that, not handed
// a gate menu. See unsupported.go for why: nothing actuated either way, so the
// old behaviour was misleading rather than dangerous — but a person cannot tell
// "I did not understand you" from "that is not a thing I do", and only one of
// those is worth reporting to whoever runs the hub.

func TestUnsupportedVerbRecognisesTheEnginesVocabulary(t *testing.T) {
	cases := []struct {
		body string
		want devices.Verb
	}{
		{"turn on the porch light", devices.VerbOn},
		{"switch off the garden lights", devices.VerbOff},
		{"TURN ON the light", devices.VerbOn}, // people shout
		{"start the mower", devices.VerbStart},
		{"stop the mower", devices.VerbStop},
		{"dock the robot", devices.VerbDock},
		{"lock the front door", devices.VerbLock},
		{"arm the alarm system", devices.VerbArm},
		{"set the temperature to 21", devices.VerbSet},
	}
	for _, c := range cases {
		got, ok := UnsupportedVerb(c.body)
		if !ok {
			t.Errorf("UnsupportedVerb(%q) found nothing, want %s", c.body, c.want)
			continue
		}
		if got != c.want {
			t.Errorf("UnsupportedVerb(%q) = %s, want %s", c.body, got, c.want)
		}
	}
}

// The failure that would make this feature worse than not having it: firing on
// an ordinary message and telling a resident their gate request was not
// supported.
func TestUnsupportedVerbLeavesOrdinaryChatterAlone(t *testing.T) {
	for _, body := range []string{
		"hi", "hello", "menu", "thanks", "thank you",
		"open the gate", "close the gate", // handled by TextGateVerb, never here
		"is the alarm on?",     // "alarm" must not match "arm"
		"lovely sunset today",  // "sunset" must not match "set"
		"the gate is charming", // "charming" must not match "arm"
		"my car is parked",
	} {
		if v, ok := UnsupportedVerb(body); ok {
			t.Errorf("UnsupportedVerb(%q) fired with %s; it must only answer a verb chat cannot serve", body, v)
		}
	}
}

// Longest-phrase-first, so the answer does not depend on map iteration order —
// the fail-open-by-ordering mistake §2.2 records in the gate matcher.
func TestUnsupportedVerbIsDeterministic(t *testing.T) {
	const body = "turn on the light"
	first, ok := UnsupportedVerb(body)
	if !ok {
		t.Fatal("expected a match")
	}
	for i := 0; i < 200; i++ {
		got, ok := UnsupportedVerb(body)
		if !ok || got != first {
			t.Fatalf("run %d returned %s/%v, first returned %s", i, got, ok, first)
		}
	}
}

func TestUnsupportedVerbReplyDoesNotOfferAGateInstead(t *testing.T) {
	msg := UnsupportedVerbReply(devices.VerbOn, "https://hub.example")

	// It must name what was asked for, so the member can see they were
	// understood and simply not served.
	if !strings.Contains(msg, "on") {
		t.Errorf("reply does not name the verb: %q", msg)
	}
	// It must say where the capability actually lives. "Not from chat" is the
	// honest scope; "not at all" would be false — the console does actuate
	// engine-backed devices.
	if !strings.Contains(msg, "https://hub.example") {
		t.Errorf("reply does not point at the console: %q", msg)
	}
	// And it must not claim to have done anything.
	for _, lie := range []string{"done", "turned on", "switched", "OK,"} {
		if strings.Contains(msg, lie) {
			t.Errorf("reply implies it acted (%q): %q", lie, msg)
		}
	}
}

// With no public URL configured the reply must still be honest rather than
// dangling a link to nowhere.
func TestUnsupportedVerbReplyWithoutAConsoleURL(t *testing.T) {
	msg := UnsupportedVerbReply(devices.VerbStart, "")
	if strings.Contains(msg, "console:") {
		t.Errorf("reply offers a console with no URL: %q", msg)
	}
	if !strings.Contains(msg, "start") {
		t.Errorf("reply does not name the verb: %q", msg)
	}
}
