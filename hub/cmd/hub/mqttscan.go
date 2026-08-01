package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/vul-os/aql/hub/internal/devices/mqtt"
)

// `aql-hub mqtt-scan -device-config FILE [-window 5s]` — read a zigbee2mqtt or
// zwave-js-ui bridge's device announcement and print the config an operator
// would paste.
//
// # Why this exists
//
// README advertises bridge discovery — "reads a zigbee2mqtt device list so you
// don't type forty of them" — and ROADMAP marks it shipped, describing exactly
// this design: "It writes no config and registers nothing: a capability decides
// which verbs the engine will route, so that stays a human's call."
//
// The scanner was built to that description and there was no way for the human
// to run it. mqtt.Scan and Candidate.SuggestedConfig had no caller anywhere
// outside their own package's tests, so the feature both documents claim was
// unreachable from the product. This is the missing half, and it is small
// precisely because the design was right: propose, print, stop.
//
// # What it does not do
//
// It does not write the device-config file, register anything, or touch the
// data directory. That is not caution — it is the documented design, and the
// reason is in ROADMAP's own sentence: a capability declares which verbs the
// engine will route to a device, and that is a safety decision. A scanner that
// guessed "this is a lock, give it unlock" would be choosing a tier ceiling on
// an operator's behalf from a bridge's free-text vocabulary.
//
// It also does not connect with the driver's client id. mqtt.Scan handles that
// — brokers evict an existing session when a second connects with the same id,
// so a careless scan would drop a live fleet's subscriptions.
func runMQTTScan(args []string) int {
	fs := flag.NewFlagSet("mqtt-scan", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	cfgPath := fs.String("device-config", envOr("AQL_DEVICE_CONFIG", ""),
		"path to the JSON device-driver configuration file (its `mqtt` object supplies the broker)")
	window := fs.Duration("window", 0,
		"how long to wait for retained announcements (default: the package's own)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: aql-hub mqtt-scan -device-config FILE [-window 5s]")
		fmt.Fprintln(os.Stderr, "\nReads a bridge's retained device announcement and prints candidates.")
		fmt.Fprintln(os.Stderr, "Writes nothing: what to add, and with which capabilities, stays your call.")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *cfgPath == "" {
		fmt.Fprintln(os.Stderr, "aql-hub mqtt-scan: -device-config is required (or set AQL_DEVICE_CONFIG)")
		return 2
	}

	file, err := loadDeviceFile(*cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "aql-hub mqtt-scan: %v\n", err)
		return 1
	}
	if file.MQTT == nil {
		fmt.Fprintf(os.Stderr, "aql-hub mqtt-scan: %s has no `mqtt` object, so there is no broker to scan\n", *cfgPath)
		return 2
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	res, err := mqtt.Scan(ctx, *file.MQTT, *window)
	if err != nil {
		fmt.Fprintf(os.Stderr, "aql-hub mqtt-scan: %v\n", err)
		return 1
	}

	// The bridge report comes FIRST and goes to stderr, so `mqtt-scan > devices.json`
	// captures only the candidates while an operator still sees what answered.
	//
	// "No devices" and "no bridge" are different answers, which is why Scan
	// separates seen from silent from unreadable — an operator debugging an
	// empty result needs to know which they got, and a bare empty list tells
	// them nothing.
	for _, b := range res.BridgesSeen {
		fmt.Fprintf(os.Stderr, "bridge %s: answered\n", b)
	}
	for _, b := range res.BridgesSilent {
		fmt.Fprintf(os.Stderr, "bridge %s: subscribed, nothing retained — the bridge may not be running\n", b)
	}
	for _, b := range res.BridgesUnreadable {
		fmt.Fprintf(os.Stderr, "bridge %s: answered with something this scanner cannot read\n", b)
	}
	if len(res.Candidates) == 0 {
		fmt.Fprintln(os.Stderr, "no candidates")
		return 0
	}

	// One DeviceConfig per candidate, as the `devices` array of an mqtt object,
	// so the output is the shape that goes into the config rather than a report
	// about it.
	devices := make([]mqtt.DeviceConfig, 0, len(res.Candidates))
	for _, c := range res.Candidates {
		devices = append(devices, c.SuggestedConfig())
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(map[string]any{"mqtt": map[string]any{"devices": devices}}); err != nil {
		fmt.Fprintf(os.Stderr, "aql-hub mqtt-scan: %v\n", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "%d candidate(s). Review the capabilities before adding them: "+
		"a capability decides which verbs the engine will route.\n", len(devices))
	return 0
}
