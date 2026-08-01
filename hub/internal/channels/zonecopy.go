package channels

import (
	"strconv"
	"strings"

	"github.com/vul-os/aql/hub/internal/devices"
)

// What to say when one message moved a whole zone.
//
// # Why a zone reply cannot be built out of the single-device replies
//
// ActuationDone names ONE device and says what state it is in. Sending N of
// those would be the obvious implementation and it is the wrong one: the member
// sent one message and would get a wall of them, and — worse — a run where two
// of three devices worked would arrive as two successes and one failure with
// nothing saying they were parts of the same command. The member's question is
// "did my command work", and N replies answer a question they did not ask.
//
// So a zone reply is always exactly one message, and it always carries the
// COUNT. A count is what makes the reply checkable against the member's own
// expectation: "3 devices in the Shed" is something they can disagree with,
// where "the Shed is now off" is not.

// ZoneActuationDone reports that every device in a zone was driven.
//
// The count comes first because it is the part that can surprise. A member who
// expected two lamps and reads "4 devices" has learned something, and burying
// that behind the zone name would be hiding the one number that describes the
// blast radius of what they just did.
func ZoneActuationDone(zone string, v devices.Verb, n int) string {
	return "Done — " + countOfDevices(n) + " in " + zone + " " + isAre(n) + " now " +
		verbPastTense(v) + "."
}

// ZoneActuationPartial reports a run where some devices took the command and
// others did not.
//
// This exists because a zone fan-out is the one actuation path with no
// all-or-nothing guarantee at EXECUTION. Every plan is resolved and
// tier-checked before anything is sent — that part is all-or-nothing — but once
// commands are going out there is no rollback, and a lamp that fails after two
// have already changed cannot un-change them.
//
// Reporting that as a plain failure would be a lie in the direction that
// matters most: the member would believe nothing moved when most of it did.
// Reporting it as success would be the same lie the other way. So it says both
// numbers and NAMES what did not take, because that is the part they have to go
// and deal with.
func ZoneActuationPartial(zone string, v devices.Verb, done int, failed []string) string {
	msg := "Partly done — " + countOfDevices(done) + " in " + zone + " " + isAre(done) +
		" now " + verbPastTense(v) + ", but "
	switch len(failed) {
	case 0:
		// Not reachable through the actuation path, which only calls this when
		// something failed. Worded rather than left to produce a dangling
		// sentence, because a copy function that can emit a fragment will
		// eventually emit one.
		return ZoneActuationDone(zone, v, done)
	case 1:
		return msg + failed[0] + " did not accept it."
	default:
		return msg + strings.Join(failed[:len(failed)-1], ", ") + " and " +
			failed[len(failed)-1] + " did not accept it."
	}
}

// ZoneActuationRefused explains why a whole zone did not move.
//
// Names the zone and the count, so a refusal that happened because ONE member
// of the zone could not take the command still tells the member how much was
// held back. "I did not turn off the Shed" without the count reads as though
// the zone were a single thing.
func ZoneActuationRefused(zone string, v devices.Verb, n int, why string) string {
	return "I did not " + string(v) + " the " + countOfDevices(n) + " in " + zone + " — " + why + "."
}

// ZoneAmbiguous asks which place was meant.
//
// Lists the zones rather than the devices. The member named two places;
// answering with every device in both would hand them a longer list than the
// one they could not choose from, which is the failure the device picker
// already avoids by listing only close candidates.
func ZoneAmbiguous(v devices.Verb, zones []string) string {
	if len(zones) == 0 {
		// Same reasoning as the empty branch above: no caller does this, and a
		// copy function that can emit a fragment eventually will.
		return "I could not tell which place you meant."
	}
	list := zones[0]
	if len(zones) > 1 {
		list = strings.Join(zones[:len(zones)-1], ", ") + " or " + zones[len(zones)-1]
	}
	return "Which place did you mean — " + list + "? I did not " + string(v) +
		" anything until I know."
}

// countOfDevices renders "1 device" or "3 devices".
//
// A zone fan-out never carries a count below 2 — ResolveZone refuses a
// single-member zone — but a PARTIAL result can, and "1 devices are now on"
// would be the sort of copy defect that makes a member distrust the number
// itself, which is the one thing this reply is for.
func countOfDevices(n int) string {
	if n == 1 {
		return "1 device"
	}
	return strconv.Itoa(n) + " devices"
}

func isAre(n int) string {
	if n == 1 {
		return "is"
	}
	return "are"
}
