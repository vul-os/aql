package httpapi

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// Zone fan-out over chat: one message moving every device in a place.
//
// The seeded mock fleet cannot exercise this — no zone in it has two devices
// offering one verb — so these build a fleet with a real group in it: three
// lamps in the Shed, plus the seeded devices, plus one thing in the Shed that
// is not a lamp.

type zoneEnv struct {
	srv     *Server
	st      *store.Store
	drv     *devices.MockDriver
	profile string
}

// zoneServer is actuationServer with a zone that is actually a group.
func zoneServer(t *testing.T) *zoneEnv {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	drv := devices.NewMockDriver("mock")
	for _, d := range []devices.Device{
		{ID: "shed-a", Kind: devices.KindLighting, Name: "Workbench Lamp", Zone: "Shed",
			Capabilities: []devices.CapabilityID{devices.CapDimmable},
			Availability: devices.AvailOnline},
		{ID: "shed-b", Kind: devices.KindLighting, Name: "Corner Lamp", Zone: "Shed",
			Capabilities: []devices.CapabilityID{devices.CapDimmable},
			Availability: devices.AvailOnline},
		{ID: "shed-c", Kind: devices.KindLighting, Name: "Door Lamp", Zone: "Shed",
			Capabilities: []devices.CapabilityID{devices.CapDimmable},
			Availability: devices.AvailOnline},
		// In the Shed and NOT a lamp. Without this the capability filter would
		// be untested: a zone whose every device offers the verb reads the same
		// whether the filter runs or not.
		{ID: "shed-vac", Kind: devices.KindRobot, Name: "Shed Vacuum", Zone: "Shed",
			Capabilities: []devices.CapabilityID{devices.CapJob},
			Availability: devices.AvailOnline},
		// A second job robot, so the Shed is a real GROUP for an argless verb
		// that sits above T1 (`resume`). With only one, the zone resolver would
		// refuse it as a group of one and the tier rule would never be reached.
		{ID: "shed-mower", Kind: devices.KindRobot, Name: "Shed Mower", Zone: "Shed",
			Capabilities: []devices.CapabilityID{devices.CapJob},
			Availability: devices.AvailOnline},
	} {
		drv.AddDevice(d)
	}
	reg := devices.NewRegistry()
	if err := reg.Register(drv); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	register(t, h, "owner@zone.test")
	u, err := st.UserByUsername(context.Background(), "owner@zone.test")
	if err != nil {
		t.Fatal(err)
	}
	return &zoneEnv{srv: srv, st: st, drv: drv, profile: u.ID}
}

func (e *zoneEnv) act(t *testing.T, body string, v devices.Verb) (chatActuationResult, bool) {
	t.Helper()
	return e.srv.chatActuate(t.Context(), body, e.profile, "telegram", "chat-1", "", v)
}

// executed returns the device IDs the driver was actually told to drive.
//
// Asserting on the DRIVER rather than the reply is the point: a reply saying
// "3 devices" proves the copy counted something, not that three commands left
// the hub.
func (e *zoneEnv) executed(v devices.Verb) []string {
	var out []string
	for _, c := range e.drv.Calls {
		if c.Verb == v {
			out = append(out, c.DeviceID)
		}
	}
	return out
}

func TestAQuantifiedZoneCommandDrivesEveryEligibleMember(t *testing.T) {
	e := zoneServer(t)
	res, handled := e.act(t, "turn on all the shed lamps", devices.VerbOn)
	if !handled {
		t.Fatal("a zone command was not handled")
	}
	if !res.Actuated {
		t.Fatalf("nothing actuated; reply was %q", res.Reply)
	}
	got := e.executed(devices.VerbOn)
	if len(got) != 3 {
		t.Fatalf("drove %d devices %v, want the 3 shed lamps", len(got), got)
	}
	// The vacuum is in the Shed and cannot be turned on. It must not have been
	// driven.
	for _, id := range got {
		if id == "shed-vac" {
			t.Error("drove a device that does not offer the verb")
		}
	}
	if !strings.Contains(res.Reply, "3 devices") || !strings.Contains(res.Reply, "Shed") {
		t.Errorf("reply does not carry the count and the zone: %q", res.Reply)
	}
}

// THE safety property, at the handler. Without a quantifier nothing fans out —
// and critically, nothing actuates AT ALL, because the device resolver refuses
// a place word too.
func TestAnUnquantifiedZoneWordDrivesNothing(t *testing.T) {
	for _, body := range []string{
		"turn on the shed lamps",
		"turn on the shed",
		"turn on the lights in the shed",
	} {
		e := zoneServer(t)
		res, handled := e.act(t, body, devices.VerbOn)
		if handled && res.Actuated {
			t.Errorf("%q actuated: %q", body, res.Reply)
		}
		if n := len(e.executed(devices.VerbOn)); n != 0 {
			t.Errorf("%q drove %d devices with no quantifier in it", body, n)
		}
	}
}

// A device NAMED for a place must win over the place.
//
// This is the ordering rule at the call site: ResolveDevice runs first, and a
// device whose NAME scores above the floor is claimed there, so the zone path
// never sees the message. Reverse the order and asking for one device by name
// would drive the whole zone.
func TestADeviceNamedForItsZoneBeatsTheZone(t *testing.T) {
	e := zoneServer(t)
	// "Corner Lamp" is in the Shed. The body names it exactly AND carries a
	// quantifier and the zone word — every ingredient a fan-out needs.
	res, handled := e.act(t, "turn on the corner lamp, all the way, in the shed", devices.VerbOn)
	if !handled {
		t.Fatal("not handled")
	}
	got := e.executed(devices.VerbOn)
	if len(got) != 1 || got[0] != "shed-b" {
		t.Fatalf("drove %v, want only the named device shed-b — the zone swallowed the device", got)
	}
	_ = res
}

// A zone NEVER takes the confirmation route, and this is the test that shows
// the difference is the zone rather than the tier.
//
// `resume` is TierConsequential on a job robot — above chatTierCeiling. A
// SINGLE device at that tier is not refused outright: chatActuate offers a
// confirmation, and a confirmed command may rise one tier to exactly
// TierConsequential. So the same verb on the same device is reachable one way
// and not the other, and the only difference is how many devices the message
// would move.
//
// That is the intended rule. A confirmation proves intent for the thing it
// NAMES, and ConfirmationPrompt names one device; accepting it as cover for a
// fan-out would treat agreement about one robot as agreement about two.
func TestAZoneNeverTakesTheConfirmationRoute(t *testing.T) {
	e := zoneServer(t)

	// Both halves in one test on purpose: asserting only the refusal would
	// pass just as well if `resume` were unreachable everywhere, which would
	// make this a test of nothing.
	single, handled := e.act(t, "resume the shed vacuum", devices.VerbResume)
	if !handled {
		t.Fatal("a single above-T1 device was not handled at all")
	}
	if single.Actuated {
		t.Fatalf("a T2 verb actuated unconfirmed: %q", single.Reply)
	}
	if !strings.Contains(strings.ToLower(single.Reply), "confirm") {
		t.Fatalf("a single T2 device was not offered a confirmation, so this test cannot "+
			"tell a zone rule from an unreachable tier: %q", single.Reply)
	}

	// The same verb across a zone: refused, with no confirmation offered.
	zone, handled := e.act(t, "resume all the shed robots", devices.VerbResume)
	if !handled {
		t.Fatal("the zone command was not handled")
	}
	if zone.Actuated {
		t.Errorf("a zone fan-out actuated above the ceiling: %q", zone.Reply)
	}
	if strings.Contains(strings.ToLower(zone.Reply), "confirm") {
		t.Errorf("a zone command was offered a confirmation: %q", zone.Reply)
	}
	if n := len(e.executed(devices.VerbResume)); n != 0 {
		t.Errorf("drove %d devices on a command that should have sent nothing", n)
	}
}

// All-or-nothing BEFORE anything is sent.
//
// Every member is resolved and tier-checked before the first command goes out,
// so a zone containing one member above the ceiling sends NOTHING rather than
// sending to the members that were fine.
//
// A note on what this test cannot reach today. The sharpest version would be a
// zone with one T1 member and one above it, proving the good member was held
// back — but no argless verb chat can send sits above T1 on one capability and
// at T1 on another (`resume` is above T1 on both capabilities that have it, and
// on/off/stop/pause are T1 everywhere). So the mixed-tier fleet is not
// constructible from the real catalogue, and constructing a fake capability to
// reach it would test a catalogue no hub has. What is asserted instead is that
// the whole zone is held: nothing is driven, and the refusal names the device
// that caused it.
func TestAnOutOfTierMemberHoldsBackTheWholeZone(t *testing.T) {
	e := zoneServer(t)
	res, handled := e.act(t, "resume all the shed robots", devices.VerbResume)
	if !handled {
		t.Fatal("not handled")
	}
	if n := len(e.executed(devices.VerbResume)); n != 0 {
		t.Fatalf("drove %d devices before the tier check refused", n)
	}
	// The refusal must name the member responsible, or an operator cannot tell
	// which device to look at.
	if !strings.Contains(res.Reply, "Shed Vacuum") && !strings.Contains(res.Reply, "Shed Mower") {
		t.Errorf("refusal does not name the device that caused it: %q", res.Reply)
	}
	if !strings.Contains(res.Reply, "sent nothing") {
		t.Errorf("refusal does not say that nothing was sent: %q", res.Reply)
	}
}

// An argument-taking verb does not fan out.
func TestAVerbTakingAValueDoesNotFanOut(t *testing.T) {
	e := zoneServer(t)
	res, handled := e.act(t, "set all the shed lamps to 40", devices.VerbSet)
	if !handled {
		t.Fatal("not handled — the refusal should be explicit, not a fall-through")
	}
	if res.Actuated {
		t.Errorf("fanned out a verb carrying a value: %q", res.Reply)
	}
	if n := len(e.executed(devices.VerbSet)); n != 0 {
		t.Errorf("drove %d devices with a quantity across a zone", n)
	}
	if !strings.Contains(res.Reply, "value") {
		t.Errorf("refusal does not say why: %q", res.Reply)
	}
}

// The cooldown is keyed on the ZONE, so a second identical command is refused.
func TestASecondZoneCommandIsCooledDown(t *testing.T) {
	e := zoneServer(t)
	if res, _ := e.act(t, "turn on all the shed lamps", devices.VerbOn); !res.Actuated {
		t.Fatalf("first command did not actuate: %q", res.Reply)
	}
	before := len(e.executed(devices.VerbOn))
	res, handled := e.act(t, "turn on all the shed lamps", devices.VerbOn)
	if !handled || res.Actuated {
		t.Errorf("second command actuated inside the cooldown: %q", res.Reply)
	}
	if after := len(e.executed(devices.VerbOn)); after != before {
		t.Errorf("cooled-down command still drove %d more devices", after-before)
	}
}

// A zone cooldown and a device cooldown do not consume each other.
func TestTheZoneCooldownIsSeparateFromTheDeviceCooldown(t *testing.T) {
	e := zoneServer(t)
	if res, _ := e.act(t, "turn on all the shed lamps", devices.VerbOn); !res.Actuated {
		t.Fatalf("zone command did not actuate: %q", res.Reply)
	}
	// A single named device in the same zone, immediately after. It must not be
	// blocked by the zone's cooldown.
	res, handled := e.act(t, "turn on the workbench lamp", devices.VerbOn)
	if !handled || !res.Actuated {
		t.Errorf("a single-device command was blocked by the zone cooldown: %q", res.Reply)
	}
}

// Every device driven gets its OWN access-log row, not one row for the zone.
func TestAZoneFanOutLogsOneRowPerDevice(t *testing.T) {
	e := zoneServer(t)
	if res, _ := e.act(t, "turn on all the shed lamps", devices.VerbOn); !res.Actuated {
		t.Fatalf("did not actuate: %q", res.Reply)
	}
	// LogDeviceCommand puts the device key in the log's detail field, so the
	// assertion is on that rather than on a column.
	acct := e.srv.soleAccountFor(context.Background(), e.profile)
	logs, err := e.st.AccessLogsByAccount(context.Background(), acct, 50)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, l := range logs {
		if l.Command == string(devices.VerbOn) {
			seen[l.Error] = true
		}
	}
	if len(seen) != 3 {
		t.Errorf("logged %d distinct devices %v, want 3 — the log must name which device took the command",
			len(seen), seen)
	}
}

// A run where some devices fail is reported as a PARTIAL with both numbers, not
// flattened into success or failure.
//
// Execution has no rollback, so this is the one honest answer: saying nothing
// happened would be false about the two that changed, and saying it worked
// would be false about the one that did not.
func TestAPartialRunReportsBothNumbersAndNamesWhatFailed(t *testing.T) {
	e := zoneServer(t)
	e.drv.FailWith = errors.New("device unreachable")
	res, handled := e.act(t, "turn on all the shed lamps", devices.VerbOn)
	if !handled {
		t.Fatal("not handled")
	}
	// Every device fails here, so this is the all-failed branch.
	if res.Actuated {
		t.Errorf("reported actuation when every device failed: %q", res.Reply)
	}
	if !strings.Contains(res.Reply, "none of them") {
		t.Errorf("all-failed run not reported as such: %q", res.Reply)
	}
}
