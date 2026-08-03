package channels

import (
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

// The zone fan-out replies, which nothing asserted on.
//
// Every function in zonecopy.go is reached by the chat-zone tests, but no test
// checks WHAT any of them says — coverage put ZoneActuationPartial and
// ZoneAmbiguous at 0% outright, and the other two are executed incidentally
// while nothing pins their wording.
//
// That is a poor thing to leave unheld here, because this file is the one
// actuation path with no all-or-nothing guarantee at execution. Plans are
// resolved and tier-checked together, but once commands are going out there is
// no rollback: a lamp that fails after two have already changed cannot un-change
// them. ZoneActuationPartial's own comment states the stakes — "Reporting that
// as a plain failure would be a lie in the direction that matters most: the
// member would believe nothing moved when most of it did. Reporting it as
// success would be the same lie the other way."
//
// So the assertions are about the two numbers and the names, not about phrasing.

func TestAPartialFanOutReportsBothNumbersAndNamesWhatFailed(t *testing.T) {
	got := ZoneActuationPartial("the Shed", devices.VerbOff, 2, []string{"Bench lamp"})

	// The half that moved.
	if !strings.Contains(got, "2 devices") {
		t.Errorf("%q does not say how many took the command; a member told only about "+
			"the failure believes nothing moved when most of it did", got)
	}
	if !strings.Contains(got, "the Shed") {
		t.Errorf("%q does not name the zone", got)
	}
	// The half that did not, BY NAME, because that is the part they have to go
	// and deal with.
	if !strings.Contains(got, "Bench lamp") {
		t.Errorf("%q does not name what failed", got)
	}
}

func TestAPartialFanOutListsSeveralFailuresReadably(t *testing.T) {
	// Two and three, because the join is `a, b and c` and the two-item case is
	// where that kind of code produces `a and b` or `a, and b` by accident.
	two := ZoneActuationPartial("the Shed", devices.VerbOff, 1, []string{"Lamp A", "Lamp B"})
	if !strings.Contains(two, "Lamp A and Lamp B") {
		t.Errorf("two failures render as %q", two)
	}
	three := ZoneActuationPartial("the Shed", devices.VerbOff, 1, []string{"A", "B", "C"})
	if !strings.Contains(three, "A, B and C") {
		t.Errorf("three failures render as %q", three)
	}
	// Every name must appear whatever the count — a list that drops one sends a
	// member to fix two things when three are broken.
	for _, name := range []string{"A", "B", "C"} {
		if !strings.Contains(three, name) {
			t.Errorf("%q omits %q", three, name)
		}
	}
}

func TestAPartialWithNothingFailedDoesNotEmitAFragment(t *testing.T) {
	// The actuation path never calls this with an empty failure list, and the
	// branch exists anyway because — in the file's own words — "a copy function
	// that can emit a fragment will eventually emit one". This is that claim
	// checked rather than trusted.
	got := ZoneActuationPartial("the Shed", devices.VerbOff, 3, nil)
	if strings.HasSuffix(strings.TrimSpace(got), "but") || strings.Contains(got, ", but ") {
		t.Fatalf("%q is a dangling sentence", got)
	}
	if got != ZoneActuationDone("the Shed", devices.VerbOff, 3) {
		t.Errorf("with nothing failed this should read exactly as a completed run; got %q", got)
	}
}

func TestSingularAndPluralAgree(t *testing.T) {
	// "1 devices are now off" is the sort of defect that makes a member
	// distrust the number itself, which is the one thing this reply is for.
	// The count and the verb are separated by the zone name — "1 device in the
	// Shed is now off" — so these are asserted apart rather than as one phrase.
	// My first draft looked for "1 device is" contiguously and failed against
	// correct copy.
	one := ZoneActuationDone("the Shed", devices.VerbOff, 1)
	if !strings.Contains(one, "1 device ") || !strings.Contains(one, " is now ") {
		t.Errorf("singular reads %q", one)
	}
	if strings.Contains(one, "1 devices") || strings.Contains(one, " are now ") {
		t.Errorf("singular reads %q", one)
	}
	many := ZoneActuationDone("the Shed", devices.VerbOff, 4)
	if !strings.Contains(many, "4 devices ") || !strings.Contains(many, " are now ") {
		t.Errorf("plural reads %q", many)
	}
	if strings.Contains(many, " is now ") {
		t.Errorf("plural reads %q", many)
	}
}

func TestARefusedZoneStillSaysHowMuchWasHeldBack(t *testing.T) {
	// A refusal caused by ONE member of the zone still has to say how much did
	// not move. "I did not turn off the Shed" without the count reads as though
	// the zone were a single thing.
	got := ZoneActuationRefused("the Shed", devices.VerbOff, 5, "one of them is above your tier")
	if !strings.Contains(got, "5 devices") {
		t.Errorf("%q does not say how much was held back", got)
	}
	if !strings.Contains(got, "above your tier") {
		t.Errorf("%q does not carry the reason", got)
	}
}

func TestAmbiguityListsThePlacesAndActuatesNothing(t *testing.T) {
	got := ZoneAmbiguous(devices.VerbOff, []string{"the Shed", "the Studio"})
	if !strings.Contains(got, "the Shed") || !strings.Contains(got, "the Studio") {
		t.Errorf("%q does not list both places", got)
	}
	// The member has to know nothing happened while the question is open.
	if !strings.Contains(got, "did not") {
		t.Errorf("%q does not say that nothing was actuated", got)
	}
	three := ZoneAmbiguous(devices.VerbOff, []string{"A", "B", "C"})
	if !strings.Contains(three, "A, B or C") {
		t.Errorf("three places render as %q", three)
	}
	// And it must not offer a choice of one.
	one := ZoneAmbiguous(devices.VerbOff, []string{"the Shed"})
	if strings.Contains(one, " or ") {
		t.Errorf("a single candidate reads as a choice: %q", one)
	}
}

// No zone reply is ever empty, a fragment, or double-spaced.
//
// The family builds sentences by concatenation, which is where a missing
// separator or an unhandled count produces "Done —  in the Shed are now ." A
// member reading that learns nothing and trusts the next reply less. Two of
// these functions carry a comment saying a copy function that can emit a
// fragment eventually will; this is the sweep that would notice.
func TestNoZoneReplyIsAFragment(t *testing.T) {
	type call struct {
		name string
		out  string
	}
	var calls []call
	for _, n := range []int{0, 1, 2, 7} {
		calls = append(calls,
			call{"Done", ZoneActuationDone("the Shed", devices.VerbOff, n)},
			call{"Refused", ZoneActuationRefused("the Shed", devices.VerbOff, n, "a reason")},
		)
		for _, failed := range [][]string{nil, {"A"}, {"A", "B"}, {"A", "B", "C"}} {
			calls = append(calls, call{"Partial", ZoneActuationPartial("the Shed", devices.VerbOff, n, failed)})
		}
	}
	for _, zs := range [][]string{nil, {"A"}, {"A", "B"}, {"A", "B", "C"}} {
		calls = append(calls, call{"Ambiguous", ZoneAmbiguous(devices.VerbOff, zs)})
	}
	// A floor at the MEASURED count, not a guessed one: 4 counts x (Done +
	// Refused + 4 Partial) + 4 Ambiguous = 28. The first draft asserted 30,
	// which is the same invented-number mistake this file is meant to catch in
	// the copy.
	if len(calls) < 28 {
		t.Fatalf("only %d replies swept, want at least 28; the table is not being built", len(calls))
	}
	for _, c := range calls {
		switch {
		case strings.TrimSpace(c.out) == "":
			t.Errorf("%s produced an empty reply", c.name)
		case strings.Contains(c.out, "  "):
			t.Errorf("%s produced a double space: %q", c.name, c.out)
		case strings.HasSuffix(strings.TrimSpace(c.out), "but"),
			strings.HasSuffix(strings.TrimSpace(c.out), "and"),
			strings.HasSuffix(strings.TrimSpace(c.out), "—"):
			t.Errorf("%s produced a dangling sentence: %q", c.name, c.out)
		case !strings.ContainsAny(c.out, ".?"):
			t.Errorf("%s produced no sentence terminator: %q", c.name, c.out)
		}
	}
}
