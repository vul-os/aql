package main

// The simulator has to say it is the simulator.
//
// controller-sim pairs with a REAL hub and answers REAL open commands, with a
// mock relay. That combination is fine — it is what a simulator is for — but it
// means every open reports success while no gate moves.
//
// Until this landed it said so only in a source comment and a --help line.
// Someone verifying a deployment with it would see opens succeeding end to end,
// with nothing on screen distinguishing that from a working installation. A test
// tool that makes a broken install look proven is the worst shape a test tool
// can have, and it is the same "a failure rendered as a fact" this repository
// keeps finding.
//
// The reference controller prints the equivalent line when it falls back to the
// mock relay. This asserts the simulator's, because a warning is one refactor
// away from being dropped and nothing else would notice.

import (
	"os"
	"strings"
	"testing"
)

func TestLiveModeAnnouncesThatItIsASimulator(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)

	i := strings.Index(body, "func runLive(")
	if i < 0 {
		t.Fatal("runLive is gone; this test is checking a function that no longer exists")
	}
	// Only the head of live mode counts. A warning printed after the agent is
	// already answering commands is not a warning.
	head := body[i:]
	if j := strings.Index(head, "relay.NewMock"); j >= 0 {
		head = head[:j]
	} else {
		t.Fatal("runLive no longer constructs a mock relay; if it drives a real one, this " +
			"test and the warning it guards both need rethinking")
	}

	for _, phrase := range []string{"SIMULATOR", "MOCK", "nothing physical"} {
		if !strings.Contains(head, phrase) {
			t.Errorf(`live mode does not announce %q before it starts.

Someone pointing this at a real hub sees every open succeed while no gate moves,
and nothing on screen says which of the two they are looking at.`, phrase)
		}
	}
}

// The offline and BLE demos need no such warning: they touch no hub and actuate
// nothing, so there is nothing to mistake them for. Asserted so that a future
// change moving them onto a real hub has to confront this file.
func TestTheDemosDoNotTouchAHub(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	i := strings.Index(body, "func runOfflineDemo(")
	if i < 0 {
		t.Skip("runOfflineDemo has moved")
	}
	demo := body[i:]
	if j := strings.Index(demo, "\nfunc "); j > 0 {
		demo = demo[:j]
	}
	for _, forbidden := range []string{"agent.New(", "GatewayURL"} {
		if strings.Contains(demo, forbidden) {
			t.Errorf("the offline demo now uses %q, so it reaches a hub — it needs the same "+
				"simulator warning live mode carries", forbidden)
		}
	}
}
