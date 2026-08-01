package channels

import (
	"strconv"

	"github.com/vul-os/aql/hub/internal/devices"
)

// What to say about a T4 verb asked for over chat.
//
// # Every reply here is a refusal, and none of them may read like a dead end
//
// A member asking to start a mower over WhatsApp has done nothing wrong. Three
// different things can be missing — the role, an armed window, the approval —
// and they are three different situations with three different next steps. One
// generic "you can't do that from chat" would be technically true and would
// leave the member with no idea whether to ask an operator, wait, or open a
// laptop.
//
// So each names the specific thing that is missing and where to go. That is the
// same rule ActuationOutOfTier follows and for the same reason: the difference
// between a limit and a dead end is being told where the thing works.

// T4NotAnOperator refuses because the sender does not hold the role.
//
// Deliberately says nothing about whether a window is armed. A member without
// the role must not be able to probe what an operator has set up by sending
// messages and reading which refusal comes back.
func T4NotAnOperator(deviceName string, v devices.Verb, publicURL string) string {
	msg := "I will not " + string(v) + " " + deviceName + " — that is a hazardous command, " +
		"and it needs an operator on this account"
	return msg + consoleTail(publicURL)
}

// T4NoWindow refuses because nothing has armed this (device, verb).
//
// Names the device AND the verb, because a window is armed for the pair: an
// operator who armed `start` on the mower has not armed `resume`, and a message
// saying only "the mower is not armed" would send them looking for a fault that
// is not there.
func T4NoWindow(deviceName string, v devices.Verb, publicURL string) string {
	msg := "I will not " + string(v) + " " + deviceName + " — no one has armed `" +
		string(v) + "` on it for chat, so there is nothing for me to act on"
	return msg + consoleTail(publicURL)
}

// T4AwaitingApproval reports that the request was recorded and nothing moved.
//
// The wording works hardest here, because this is the reply most likely to be
// misread as success. It says plainly that the device has not moved, says where
// to approve, and gives the deadline — a member who reads "approve it in the
// console" and walks away has to know the request does not wait indefinitely.
func T4AwaitingApproval(deviceName string, v devices.Verb, minutes int, publicURL string) string {
	msg := "I have not " + string(v) + "ed " + deviceName + " — nothing has moved. " +
		"A hazardous command needs approving somewhere other than this chat, " +
		"so I have recorded the request and it is waiting for you in the console"
	if publicURL != "" {
		msg += ": " + trimURL(publicURL) + "/app"
	}
	return msg + ". It expires in " + strconv.Itoa(minutes) + " minutes."
}

// consoleTail points at the console when there is a URL to point at, and says
// so plainly when there is not.
//
// Shared by the two refusals above so they cannot drift into two different ways
// of saying the same thing.
func consoleTail(publicURL string) string {
	if publicURL != "" {
		return ". It is in the console: " + trimURL(publicURL) + "/app"
	}
	return ". It is in the console."
}
