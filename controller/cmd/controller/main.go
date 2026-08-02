// Command controller is the lintel reference controller agent: pairs to a
// gateway with a claim token on first run (persisting the PINNED gateway
// key), then maintains the outbound WSS connection, processes signed
// commands fail-closed, serves offline grants on the LAN (and BLE with
// `-tags ble` on Linux), and drains the durable event queue.
//
// First run:
//
//	controller --state /var/lib/aql --hub https://gate.example.com --claim-token …
//
// Subsequent runs need only --state; the pairing is durable.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/vul-os/aql/controller/internal/agent"
)

const firmware = "0.1.0"

func main() {
	var (
		stateDir = flag.String("state", "./controller-state", "durable state directory (identity, pairing, queue)")
		hub      = flag.String("hub", "", "hub base URL (first-run pairing only)")
		// Deprecated alias. A controller is a box screwed to a wall with a
		// service file someone wrote once; renaming its flag without keeping
		// the old one means the unit fails to start after an upgrade, on
		// hardware whose whole job is opening a door. The alias costs one
		// line and is resolved below.
		gatewayLegacy = flag.String("gateway", "", "deprecated alias for -hub")
		claimToken    = flag.String("claim-token", "", "single-use claim token (first-run pairing only)")
		lanAddr       = flag.String("lan", ":8737", "LAN grant listener address (empty to disable)")
		aps           = flag.String("access-points", "main", "comma-separated access points this controller serves")
		insecure      = flag.Bool("insecure", false, "allow ws:// and http:// hub endpoints (dev only)")
		ble           = flag.Bool("ble", false, "enable the BLE peripheral (requires a `-tags ble` build on Linux or Windows)")
		heldOpenAfter = flag.Duration("held-open-after", 0, "emit a `held_open` event when the position sensor has not reported the gate closed for this long (0 = off; needs a sensor, so a `-tags gpio` build with one configured)")
		relaySpec     = flag.String("relay", "", "GPIO relay, `<chip>:<line>[,active-low][,bias=pull-up|pull-down|disabled][,sensor=<line>[,sensor-active-low][,sensor-debounce=20ms]]` (requires a `-tags gpio` Linux build); empty uses the mock relay, which actuates nothing")
	)
	flag.Parse()

	// Positional arguments are always a mistake here, and a silent one.
	//
	// Go's flag package STOPS parsing at the first non-flag token, so
	// `controller pair -relay gpiochip0:17 -state /data` does not just ignore
	// "pair" — it ignores every flag after it and starts with defaults. Verified
	// by running it: the -state passed on that command line was dropped entirely.
	//
	// The default that gets restored is what makes this worth refusing rather
	// than warning. An empty -relay means the MOCK relay, which acks every open
	// as successful while nothing physically moves. A gate that reports itself
	// opening and does not open is the single worst failure this binary has, and
	// one stray token is enough to reach it.
	if flag.NArg() > 0 {
		fmt.Fprintf(os.Stderr, "aql-controller: unexpected argument %q\n\n", flag.Arg(0))
		fmt.Fprintln(os.Stderr, "This binary takes flags only and has no subcommands. Go stops parsing")
		fmt.Fprintln(os.Stderr, "flags at the first non-flag argument, so anything after it would have")
		fmt.Fprintln(os.Stderr, "been silently ignored — including -relay, whose default is the mock")
		fmt.Fprintln(os.Stderr, "relay that acks opens without moving anything.")
		fmt.Fprintln(os.Stderr, "\nUsage:")
		flag.PrintDefaults()
		os.Exit(2)
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)

	// -hub wins; -gateway still works and says so. Both set is an operator
	// mid-migration, and silently preferring one would be the worst outcome
	// of the three.
	if *hub == "" && *gatewayLegacy != "" {
		*hub = *gatewayLegacy
		log.Warn("-gateway is deprecated and will eventually be removed; use -hub")
	} else if *hub != "" && *gatewayLegacy != "" && *hub != *gatewayLegacy {
		log.Warn("both -hub and -gateway were given with different values; using -hub",
			"hub", *hub, "ignored_gateway", *gatewayLegacy)
	}

	// Before anything else. A controller that cannot drive the relay it was
	// told to drive must not reach the point of accepting commands — see
	// relay.go for why falling back to the mock is the one unacceptable
	// outcome.
	rel, err := openRelay(*relaySpec, log)
	if err != nil {
		fmt.Fprintln(os.Stderr, "controller:", err)
		os.Exit(1)
	}

	a, err := agent.New(agent.Options{
		StateDir:      *stateDir,
		GatewayURL:    *hub,
		ClaimToken:    *claimToken,
		LANAddr:       *lanAddr,
		AccessPoints:  splitNonEmpty(*aps),
		Log:           log,
		AllowInsecure: *insecure,
		Firmware:      firmware,
		EnableBLE:     *ble,
		HeldOpenAfter: *heldOpenAfter,
		Relay:         rel,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "controller:", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := a.Run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "controller:", err)
		os.Exit(1)
	}
}

func splitNonEmpty(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
