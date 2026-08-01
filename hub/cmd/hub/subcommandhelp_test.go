package main

import (
	"bytes"
	"github.com/vul-os/aql/hub/internal/devices/mqtt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/sealed"
)

// Every subcommand main dispatches must appear in the help an unknown one
// prints.
//
// # The failure this catches, which had already happened
//
// `verify-restore` was dispatched at the top of main and absent from
// knownCommands, so `aql-hub bogus` listed three commands and not that one. An
// operator reading that output concludes verify-restore does not exist — and
// verify-restore is the command whose whole purpose is answering "can this
// directory start a hub without losing anything" BEFORE a restore, which is the
// moment someone most needs to know it is there.
//
// Nothing could have noticed. The dispatch works, so no test of the command
// fails; the help renders, so no test of the output fails. Only the gap between
// them is wrong, and it is invisible from either side.
//
// # Direction
//
// This walks DISPATCH → HELP, the direction this repository keeps finding
// omissions in. The reverse — a help entry for a command that does not dispatch
// — is checked too, because an advertised command that does nothing is the
// worse of the two: the operator runs it, gets a hub booting against a backup
// directory, and that is the outage main's own comment describes.
func TestEveryDispatchedSubcommandIsInTheHelp(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}

	// `os.Args[1] == "x"` and `os.Args[2] == "y"` — the literal each dispatch
	// compares against.
	// [a-z0-9-] and not [a-z-]: the first version could not match `2fa`, and
	// the reverse check below caught it immediately by reporting a command as
	// undispatched that is dispatched.
	re := regexp.MustCompile(`os\.Args\[[12]\] == "([a-z0-9-]+)"`)
	got := map[string]bool{}
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		got[m[1]] = true
	}

	// The guard on the guard: one bad character above and this examines
	// nothing while passing.
	if len(got) < 4 {
		t.Fatalf("parsed %d dispatched tokens from main.go; the pattern has drifted "+
			"and this test is checking almost nothing", len(got))
	}

	help := strings.Join(knownCommands, "\n")
	for token := range got {
		if !strings.Contains(help, token) {
			t.Errorf("main dispatches %q and knownCommands never mentions it, so "+
				"`aql-hub <typo>` tells an operator the command does not exist", token)
		}
	}

	// And the reverse: every command advertised must actually dispatch.
	for _, line := range knownCommands {
		fields := strings.Fields(strings.TrimPrefix(line, "aql-hub "))
		if len(fields) == 0 {
			t.Errorf("empty entry in knownCommands")
			continue
		}
		if !got[fields[0]] {
			t.Errorf("knownCommands advertises %q, which main does not dispatch — an "+
				"operator running it would fall through to booting a hub against "+
				"whatever directory they pointed it at", fields[0])
		}
	}
}

// gen-data-key prints a key ParseKey accepts, and writes nothing.
//
// The point of the command is that an operator no longer has to invent the
// format, so the test that matters is that the product's own parser takes what
// its own generator produced — not that the string looks base64.
func TestGenDataKeyPrintsAKeyTheHubAccepts(t *testing.T) {
	dir := t.TempDir()
	before, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = w
	code := runGenDataKey(nil)
	w.Close()
	os.Stdout = saved

	out := make([]byte, 4096)
	n, _ := r.Read(out)
	key := strings.TrimSpace(string(out[:n]))

	if code != 0 {
		t.Fatalf("exit %d", code)
	}
	if key == "" {
		t.Fatal("printed nothing")
	}
	if strings.Contains(key, "\n") {
		t.Errorf("printed more than one line, which breaks `gen-data-key > secret`: %q", key)
	}
	if _, err := sealed.ParseKey(key); err != nil {
		t.Fatalf("the hub's own parser rejects the key its own generator produced: %v", err)
	}

	// Two runs must differ. A constant would pass every check above.
	r2, w2, _ := os.Pipe()
	os.Stdout = w2
	runGenDataKey(nil)
	w2.Close()
	os.Stdout = saved
	out2 := make([]byte, 4096)
	n2, _ := r2.Read(out2)
	if strings.TrimSpace(string(out2[:n2])) == key {
		t.Fatal("two runs produced the same key")
	}

	after, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Errorf("gen-data-key wrote to disk; it must only print")
	}
}

// mqtt-scan refuses without a broker, and says which of the two problems it is.
//
// Both refusals are argument errors rather than failures, so they exit 2 and
// name the fix. The distinction matters because they have different fixes: no
// -device-config means the operator has not said where the file is, while a
// file with no `mqtt` object means they pointed at a real config for a hub that
// does not use MQTT at all.
func TestMQTTScanRefusesWithoutABroker(t *testing.T) {
	if code := runMQTTScan(nil); code != 2 {
		t.Errorf("no -device-config: exit %d, want 2", code)
	}

	path := filepath.Join(t.TempDir(), "devices.json")
	if err := os.WriteFile(path, []byte(`{"http":{"devices":[]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if code := runMQTTScan([]string{"-device-config", path}); code != 2 {
		t.Errorf("config without an mqtt object: exit %d, want 2", code)
	}

	// A path that does not exist is a real failure, not a usage error.
	if code := runMQTTScan([]string{"-device-config", filepath.Join(t.TempDir(), "missing.json")}); code != 1 {
		t.Errorf("missing file: exit %d, want 1", code)
	}
}

// What mqtt-scan prints must be config the hub accepts.
//
// README says the scanner "reads a zigbee2mqtt device list so you don't type
// forty of them", and ROADMAP describes it printing what an operator pastes.
// Both claims are about the OUTPUT, and until now the only tests were about
// exit codes on refusal — the command could have printed valid-looking JSON
// that loadDeviceFile rejects and every test would have stayed green.
//
// The check is deliberately the real parser rather than a second decode into
// the same struct. loadDeviceFile sets DisallowUnknownFields, so a key that
// drifts between what the scanner writes and what the hub reads becomes a
// refusal at startup — after the operator has pasted it and restarted, which is
// the worst moment to find out.
func TestWhatMQTTScanPrintsIsConfigTheHubAccepts(t *testing.T) {
	// Fields is what the bridge said this device publishes, and it is what
	// SuggestedConfig turns into State entries — a candidate without it
	// produces a device that subscribes to nothing, which is what the first
	// version of this test asserted against and was right to catch in its own
	// fixture.
	candidates := []mqtt.Candidate{
		{
			Bridge: "zigbee2mqtt", Topic: "zigbee2mqtt/Kitchen lamp",
			Name: "Kitchen lamp", Model: "TRADFRI bulb", Vendor: "IKEA",
			Fields: []string{"state", "brightness"},
		},
		{
			Bridge: "zwave-js-ui", Topic: "zwave/Garage door",
			Name: "Garage door", Model: "GD00Z", Vendor: "Linear",
			Fields: []string{"state"},
		},
	}

	var buf bytes.Buffer
	if err := writeScanConfig(&buf, candidates); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "devices.json")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	file, err := loadDeviceFile(path)
	if err != nil {
		t.Fatalf("the hub's own config parser rejects what its own scanner printed: %v\n\n%s",
			err, buf.String())
	}
	if file.MQTT == nil {
		t.Fatal("parsed, but with no mqtt object — the wrapper key is wrong")
	}
	if len(file.MQTT.Devices) != len(candidates) {
		t.Fatalf("%d device(s) survived the round trip, want %d:\n%s",
			len(file.MQTT.Devices), len(candidates), buf.String())
	}
	// The topic is the part that cannot be re-derived by hand: it is where the
	// bridge publishes, spaces and all. A round trip that keeps the count but
	// loses the topic would leave an operator with entries that point nowhere.
	for i, d := range file.MQTT.Devices {
		if len(d.State) == 0 {
			t.Errorf("device %d came back with no state topics, so it subscribes to nothing", i)
			continue
		}
		if d.State[0].Topic != candidates[i].Topic {
			t.Errorf("device %d state topic = %q, want %q", i, d.State[0].Topic, candidates[i].Topic)
		}
	}

	// An empty scan must still print a file that parses, or "no candidates" and
	// "a file you cannot use" become the same experience.
	var empty bytes.Buffer
	if err := writeScanConfig(&empty, nil); err != nil {
		t.Fatal(err)
	}
	emptyPath := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(emptyPath, empty.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadDeviceFile(emptyPath); err != nil {
		t.Errorf("an empty scan printed something the hub will not load: %v\n%s", err, empty.String())
	}
}

// The scan output alone is a fragment, and the hub says so rather than starting.
//
// mqtt-scan's summary now tells an operator to merge the array into their `mqtt`
// object because on its own the hub refuses it with "broker address is empty".
// That sentence is a claim about another package's behaviour, so it is checked
// here: a message promising a specific refusal, next to code free to change it,
// is how a helpful instruction becomes a wrong one.
func TestTheScanFragmentIsRefusedWithTheMessageTheSummaryPromises(t *testing.T) {
	var buf bytes.Buffer
	if err := writeScanConfig(&buf, []mqtt.Candidate{{
		Bridge: "zigbee2mqtt", Topic: "zigbee2mqtt/lamp", Name: "lamp",
		Fields: []string{"state"},
	}}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "devices.json")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	file, err := loadDeviceFile(path)
	if err != nil || file.MQTT == nil {
		t.Fatalf("fragment did not parse: %v", err)
	}

	_, err = mqtt.New(*file.MQTT)
	if err == nil {
		t.Fatal("the hub accepted a device config with no broker; mqtt-scan's summary " +
			"tells operators it will be refused")
	}
	if !strings.Contains(err.Error(), "broker address is empty") {
		t.Errorf("refusal is %q, but mqtt-scan's summary quotes \"broker address is empty\"", err)
	}
}
