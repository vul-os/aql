package automations

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/store"
	_ "modernc.org/sqlite"
)

// --- test doubles -----------------------------------------------------------

// testDriver is a devices.Driver whose device set, capabilities, availability
// and readings can all be changed mid-test. The capability part is the point:
// the safety claim this package makes is that a stored rule is re-checked
// against TODAY's catalogue, and proving that needs a device that can change
// what it declares under a saved rule.
type testDriver struct {
	mu       sync.Mutex
	id       string
	devs     map[string]devices.Device
	readings map[string][]devices.Reading
	failWith error
	calls    []driverCall
}

type driverCall struct {
	DeviceID string
	Verb     devices.Verb
	Args     map[string]float64
}

func newTestDriver(id string) *testDriver {
	return &testDriver{id: id, devs: map[string]devices.Device{}, readings: map[string][]devices.Reading{}}
}

func (d *testDriver) ID() string { return d.id }

func (d *testDriver) Discover(context.Context) ([]devices.Device, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]devices.Device, 0, len(d.devs))
	for _, dev := range d.devs {
		out = append(out, dev)
	}
	return out, nil
}

func (d *testDriver) Execute(_ context.Context, deviceID string, v devices.Verb, args map[string]float64) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.failWith != nil {
		return d.failWith
	}
	dev, ok := d.devs[deviceID]
	if !ok {
		return devices.ErrUnknownDevice
	}
	if _, _, ok := dev.Supports(v); !ok {
		return devices.ErrUnsupported
	}
	d.calls = append(d.calls, driverCall{DeviceID: deviceID, Verb: v, Args: args})
	return nil
}

func (d *testDriver) Read(_ context.Context, deviceID string) ([]devices.Reading, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.failWith != nil {
		return nil, d.failWith
	}
	if _, ok := d.devs[deviceID]; !ok {
		return nil, devices.ErrUnknownDevice
	}
	return append([]devices.Reading(nil), d.readings[deviceID]...), nil
}

func (d *testDriver) Health(context.Context) devices.Health {
	return devices.Health{OK: d.failWith == nil, Detail: "test driver"}
}

func (d *testDriver) put(dev devices.Device) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.devs[dev.ID] = dev
}

func (d *testDriver) setCaps(id string, caps ...devices.CapabilityID) {
	d.mu.Lock()
	defer d.mu.Unlock()
	dev := d.devs[id]
	dev.Capabilities = caps
	d.devs[id] = dev
}

func (d *testDriver) setAvailability(id string, a devices.Availability) {
	d.mu.Lock()
	defer d.mu.Unlock()
	dev := d.devs[id]
	dev.Availability = a
	d.devs[id] = dev
}

func (d *testDriver) setReading(id, metric string, value float64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.readings[id] = []devices.Reading{{DeviceID: id, Metric: metric, Value: value}}
}

func (d *testDriver) setTextReading(id, metric, text string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.readings[id] = []devices.Reading{{DeviceID: id, Metric: metric, Text: text}}
}

func (d *testDriver) clearReadings(id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.readings[id] = nil
}

func (d *testDriver) fail(err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.failWith = err
}

func (d *testDriver) Calls() []driverCall {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]driverCall(nil), d.calls...)
}

// spyAuditor forwards to the real hash-chained choke point and records what it
// was asked to write, so a test can assert both the trail's content and (via
// store.VerifyHashChains) that the chain is still intact afterwards.
type spyAuditor struct {
	mu    sync.Mutex
	real  Auditor
	fail  error
	calls []auditCall
}

type auditCall struct {
	Actor, Action, TargetKind, TargetID string
	Allowed                             bool
	Detail                              map[string]any
}

func (a *spyAuditor) WriteAdminAudit(ctx context.Context, actor, action, targetKind, targetID string, allowed bool, detail any) error {
	a.mu.Lock()
	if a.fail != nil {
		err := a.fail
		a.mu.Unlock()
		return err
	}
	m, _ := detail.(map[string]any)
	a.calls = append(a.calls, auditCall{Actor: actor, Action: action, TargetKind: targetKind,
		TargetID: targetID, Allowed: allowed, Detail: m})
	real := a.real
	a.mu.Unlock()
	return real.WriteAdminAudit(ctx, actor, action, targetKind, targetID, allowed, detail)
}

func (a *spyAuditor) failWith(err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.fail = err
}

func (a *spyAuditor) actions(action string) []auditCall {
	a.mu.Lock()
	defer a.mu.Unlock()
	var out []auditCall
	for _, c := range a.calls {
		if c.Action == action {
			out = append(out, c)
		}
	}
	return out
}

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// --- harness ----------------------------------------------------------------

type harness struct {
	t         *testing.T
	ctx       context.Context
	st        *store.Store
	db        *sql.DB
	rules     *Store
	reg       *devices.Registry
	drv       *testDriver
	eng       *Engine
	audit     *spyAuditor
	clock     *fakeClock
	accountID string
	userID    string
}

// newHarness opens a real SQLite database through store.Open (which applies
// migration 0010 like production does), a second handle for the automations
// store, a registry over a test driver, and an engine wired to the real audit
// choke point.
func newHarness(t *testing.T) *harness {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	dsn := "file:" + filepath.Join(dir, "lintel.db") +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })

	ctx := context.Background()
	u, err := st.CreateUser(ctx, "owner@example.test", "x", "Owner", "ZA")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	acct, _, err := st.CreateAccountWithOwner(ctx, u.ID, "Test Estate", "ZA")
	if err != nil {
		t.Fatalf("CreateAccountWithOwner: %v", err)
	}

	drv := newTestDriver("test")
	drv.put(devices.Device{ID: "lamp-1", Kind: devices.KindLighting, Name: "Garden Lights",
		Zone: "Exterior", Capabilities: []devices.CapabilityID{devices.CapDimmable},
		Availability: devices.AvailOnline})
	drv.put(devices.Device{ID: "cam-1", Kind: devices.KindCamera, Name: "Yard Camera",
		Zone: "Exterior", Capabilities: []devices.CapabilityID{devices.CapCameraFeed},
		Availability: devices.AvailOnline})
	drv.put(devices.Device{ID: "bot-1", Kind: devices.KindRobot, Name: "Cleaning Bot",
		Zone: "Interior", Capabilities: []devices.CapabilityID{devices.CapJob},
		Availability: devices.AvailOnline})
	drv.put(devices.Device{ID: "mower-1", Kind: devices.KindRobot, Name: "Mower",
		Zone: "Lawn", Capabilities: []devices.CapabilityID{devices.CapBladeJob},
		Availability: devices.AvailOnline})
	drv.put(devices.Device{ID: "gate-1", Kind: devices.KindAccess, Name: "Front Gate",
		Zone: "Drive", Capabilities: []devices.CapabilityID{devices.CapBarrier},
		Availability: devices.AvailOnline})
	drv.put(devices.Device{ID: "tank-1", Kind: devices.KindSensor, Name: "Water Tank",
		Zone: "Utility", Capabilities: []devices.CapabilityID{devices.CapSensorReadCa},
		Availability: devices.AvailOnline})
	drv.setReading("tank-1", "percent", 80)

	reg := devices.NewRegistry()
	if err := reg.Register(drv); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := reg.Refresh(ctx); err != nil {
		t.Fatalf("Refresh: %v", err)
	}

	clock := &fakeClock{t: time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)}
	audit := &spyAuditor{real: st}
	rules := NewStore(db)
	eng, err := NewEngine(Config{Registry: reg, Store: rules, Audit: audit, Now: clock.Now})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	return &harness{t: t, ctx: ctx, st: st, db: db, rules: rules, reg: reg, drv: drv,
		eng: eng, audit: audit, clock: clock, accountID: acct.ID, userID: u.ID}
}

func (h *harness) refresh() {
	h.t.Helper()
	if err := h.reg.Refresh(h.ctx); err != nil {
		h.t.Fatalf("Refresh: %v", err)
	}
}

// rule builds a minimal valid rule in the harness's account.
func (h *harness) rule(name string, trig Trigger, act Action) Rule {
	return Rule{AccountID: h.accountID, Name: name, Enabled: true, CreatedBy: h.userID,
		Trigger: trig, Action: act}
}

func (h *harness) runs(ruleID string) []Run {
	h.t.Helper()
	rs, err := h.rules.ListRuns(h.ctx, h.accountID, ruleID, 0)
	if err != nil {
		h.t.Fatalf("ListRuns: %v", err)
	}
	return rs
}

func (h *harness) reload(id string) Rule {
	h.t.Helper()
	r, err := h.rules.RuleByID(h.ctx, h.accountID, id)
	if err != nil {
		h.t.Fatalf("RuleByID: %v", err)
	}
	return r
}

// assertChainIntact proves the audit rows this package wrote went through the
// hash-chained choke point rather than around it.
func (h *harness) assertChainIntact() {
	h.t.Helper()
	results, err := h.st.VerifyHashChains(h.ctx)
	if err != nil {
		h.t.Fatalf("VerifyHashChains: %v", err)
	}
	for _, res := range results {
		if !res.OK {
			h.t.Fatalf("%s chain broken at %d: %s", res.Table, res.Break.Index, res.Break.Reason)
		}
	}
}

func dailyAt(minute int) Trigger {
	return Trigger{Kind: TriggerSchedule, Schedule: &Schedule{MinuteOfDay: minute, Days: EveryDay}}
}

// --- THE SAFETY RULE --------------------------------------------------------

// A rule that would start a mower's blades must not be storable. This is the
// save-time half of the tier gate.
func TestHazardousRuleCannotBeSaved(t *testing.T) {
	h := newHarness(t)
	r := h.rule("mow at dawn", dailyAt(6*60),
		Action{DeviceKey: "test:mower-1", Verb: devices.VerbStart})

	saved, err := h.eng.SaveRule(h.ctx, r)
	if err == nil {
		t.Fatalf("SaveRule accepted a hazardous rule: %+v", saved)
	}
	if !IsRefusal(err) || RefusalReason(err) != ReasonTierTooHigh {
		t.Fatalf("expected a %s refusal, got %v", ReasonTierTooHigh, err)
	}
	// It must not have reached the database.
	list, err := h.rules.ListRules(h.ctx, h.accountID)
	if err != nil {
		t.Fatalf("ListRules: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("hazardous rule was persisted: %+v", list)
	}
	// And the attempt is in the tamper-evident trail.
	refused := h.audit.actions(AuditSaveRefused)
	if len(refused) != 1 {
		t.Fatalf("expected one %s audit row, got %d", AuditSaveRefused, len(refused))
	}
	if refused[0].Allowed {
		t.Error("a refused save must be recorded as not allowed")
	}
	if refused[0].Detail["reason"] != ReasonTierTooHigh {
		t.Errorf("audit reason = %v, want %s", refused[0].Detail["reason"], ReasonTierTooHigh)
	}
	h.assertChainIntact()
}

// Every verb above TierConsequential in the catalogue must be unsavable, not
// just the mower's. A new hazardous row added to the catalogue later fails
// here rather than in someone's garden.
func TestNoHazardousVerbIsSavable(t *testing.T) {
	h := newHarness(t)
	cases := []struct {
		key  string
		verb devices.Verb
		args map[string]float64
	}{
		{"test:mower-1", devices.VerbStart, nil},
		{"test:mower-1", devices.VerbResume, nil},
		{"test:gate-1", devices.VerbOpen, nil},
		{"test:gate-1", devices.VerbHold, map[string]float64{"seconds": 30}},
	}
	for _, tc := range cases {
		r := h.rule("t", dailyAt(60), Action{DeviceKey: tc.key, Verb: tc.verb, Args: tc.args})
		if _, err := h.eng.SaveRule(h.ctx, r); RefusalReason(err) != ReasonTierTooHigh {
			t.Errorf("%s %s: expected %s, got %v", tc.key, tc.verb, ReasonTierTooHigh, err)
		}
	}
	// The safe inverses of those same verbs must still be savable: refusing to
	// automate "stop" would be a safety rule that made things less safe.
	for _, tc := range []struct {
		key  string
		verb devices.Verb
	}{
		{"test:mower-1", devices.VerbStop},
		{"test:mower-1", devices.VerbDock},
		{"test:gate-1", devices.VerbClose},
	} {
		r := h.rule("t", dailyAt(60), Action{DeviceKey: tc.key, Verb: tc.verb})
		if _, err := h.eng.SaveRule(h.ctx, r); err != nil {
			t.Errorf("%s %s: expected the safe inverse to be savable, got %v", tc.key, tc.verb, err)
		}
	}
}

// The execution-time half, and the reason it exists: a rule saved when its
// device declared robot.job (start = TierConsequential) must refuse when the
// device re-declares robot.blade-job (start = TierHazardousMotion) — WITHOUT
// the rule ever being re-saved.
func TestStoredRuleRefusesWhenTheCatalogueMovesUnderIt(t *testing.T) {
	h := newHarness(t)
	saved, err := h.eng.SaveRule(h.ctx, h.rule("start the bot", dailyAt(6*60),
		Action{DeviceKey: "test:bot-1", Verb: devices.VerbStart}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	if saved.ActionTier != devices.TierConsequential {
		t.Fatalf("saved tier = %s, want consequential", saved.ActionTier)
	}
	// Prove it would otherwise run.
	if run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0); err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("baseline run: outcome=%s err=%v", run.Outcome, err)
	}
	before := len(h.drv.Calls())

	// The device now declares blades. Nothing about the rule changed.
	h.drv.setCaps("bot-1", devices.CapBladeJob)
	h.refresh()

	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if run.Outcome != OutcomeRefused {
		t.Fatalf("outcome = %s, want refused", run.Outcome)
	}
	if RefusalReason(err) != ReasonTierTooHigh {
		t.Fatalf("reason = %v (%v), want %s", RefusalReason(err), err, ReasonTierTooHigh)
	}
	if got := len(h.drv.Calls()); got != before {
		t.Fatalf("driver was called %d extra times; a refused run must not actuate", got-before)
	}
	// The rule stops itself: a stored rule that now resolves hazardous is not
	// left armed waiting for the next tick.
	after := h.reload(saved.ID)
	if after.Enabled {
		t.Error("rule should have disabled itself after a tier refusal")
	}
	if after.DisabledReason != ReasonTierTooHigh {
		t.Errorf("disabled_reason = %q, want %q", after.DisabledReason, ReasonTierTooHigh)
	}
	// Recorded in both places: the run history and the hash-chained trail.
	runs := h.runs(saved.ID)
	if len(runs) == 0 || runs[0].Outcome != OutcomeRefused {
		t.Fatalf("run history did not record the refusal: %+v", runs)
	}
	if !runs[0].Audited {
		t.Error("a refused run must still be audited")
	}
	var found bool
	for _, c := range h.audit.actions(AuditRun) {
		if !c.Allowed && c.Detail["reason"] != nil && c.Detail["outcome"] == string(OutcomeRefused) {
			found = true
		}
	}
	if !found {
		t.Error("no audit row recorded the refused run")
	}
	h.assertChainIntact()
}

// A zone action is refused whole when ANY member resolves above the ceiling —
// doing the safe part of an automation is a state nobody wrote down.
func TestZoneActionRefusesIfAnyMemberIsHazardous(t *testing.T) {
	h := newHarness(t)
	// "Lawn" holds only the mower today; add a lamp so the zone has a member
	// that WOULD be safe to actuate.
	h.drv.put(devices.Device{ID: "lawnlamp-1", Kind: devices.KindLighting, Name: "Lawn Light",
		Zone: "Lawn", Capabilities: []devices.CapabilityID{devices.CapSwitch},
		Availability: devices.AvailOnline})
	h.refresh()

	// `on` is not offered by the mower at all, so a zone-wide "on" is fine.
	safe, err := h.eng.SaveRule(h.ctx, h.rule("lawn on", dailyAt(19*60),
		Action{Zone: "Lawn", Verb: devices.VerbOn}))
	if err != nil {
		t.Fatalf("SaveRule(zone on): %v", err)
	}
	if run, err := h.eng.Fire(h.ctx, h.reload(safe.ID), CauseManual, 0); err != nil || run.TargetCount != 1 {
		t.Fatalf("zone on: targets=%d err=%v (only the lamp offers `on`)", run.TargetCount, err)
	}

	// `start` IS offered by the mower, hazardously. Saving must refuse.
	if _, err := h.eng.SaveRule(h.ctx, h.rule("lawn start", dailyAt(6*60),
		Action{Zone: "Lawn", Verb: devices.VerbStart})); RefusalReason(err) != ReasonTierTooHigh {
		t.Fatalf("zone start: expected %s, got %v", ReasonTierTooHigh, err)
	}
}

// --- fail closed ------------------------------------------------------------

func TestUnknownDeviceAndUnknownVerbAreRefusedAtSave(t *testing.T) {
	h := newHarness(t)
	if _, err := h.eng.SaveRule(h.ctx, h.rule("ghost", dailyAt(60),
		Action{DeviceKey: "test:nope", Verb: devices.VerbOn})); RefusalReason(err) != ReasonUnresolvable {
		t.Errorf("unknown device: got %v", err)
	}
	if _, err := h.eng.SaveRule(h.ctx, h.rule("invented", dailyAt(60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.Verb("levitate")})); RefusalReason(err) != ReasonUnresolvable {
		t.Errorf("unknown verb: got %v", err)
	}
	if _, err := h.eng.SaveRule(h.ctx, h.rule("out of range", dailyAt(60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbSet,
			Args: map[string]float64{"level": 400}})); RefusalReason(err) != ReasonUnresolvable {
		t.Errorf("out-of-range argument: got %v", err)
	}
	if _, err := h.eng.SaveRule(h.ctx, h.rule("empty zone", dailyAt(60),
		Action{Zone: "Nowhere", Verb: devices.VerbOn})); RefusalReason(err) != ReasonNoTargets {
		t.Errorf("empty zone: got %v", err)
	}
}

func TestDeviceVanishingRefusesAtExecution(t *testing.T) {
	h := newHarness(t)
	saved, err := h.eng.SaveRule(h.ctx, h.rule("lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	delete(h.drv.devs, "lamp-1")
	h.refresh()

	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if run.Outcome != OutcomeRefused || RefusalReason(err) != ReasonUnresolvable {
		t.Fatalf("outcome=%s err=%v, want refused/%s", run.Outcome, err, ReasonUnresolvable)
	}
	if len(h.drv.Calls()) != 0 {
		t.Error("a vanished device must not be actuated")
	}
}

// A condition whose sensor cannot be read, or reads as text, or reads twice,
// refuses the run. It never passes by default.
func TestAmbiguousConditionRefuses(t *testing.T) {
	h := newHarness(t)
	r := h.rule("water the lawn", dailyAt(6*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn})
	r.Conditions = []Condition{{DeviceKey: "test:tank-1", Metric: "percent", Op: OpAtLeast, Value: 20}}
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}

	// Met: it runs.
	if run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0); err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("condition met: outcome=%s err=%v", run.Outcome, err)
	}
	// Not met: it skips, quietly and without spending the budget.
	h.drv.setReading("tank-1", "percent", 5)
	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil || run.Outcome != OutcomeSkipped || run.Reason != ReasonConditionUnmet {
		t.Fatalf("condition unmet: outcome=%s reason=%s err=%v", run.Outcome, run.Reason, err)
	}
	// Ambiguous, three ways.
	calls := len(h.drv.Calls())
	for _, setup := range []func(){
		func() { h.drv.clearReadings("tank-1") },
		func() { h.drv.setTextReading("tank-1", "percent", "unknown") },
		func() {
			h.drv.mu.Lock()
			h.drv.readings["tank-1"] = []devices.Reading{
				{DeviceID: "tank-1", Metric: "percent", Value: 30},
				{DeviceID: "tank-1", Metric: "percent", Value: 70},
			}
			h.drv.mu.Unlock()
		},
	} {
		// Re-enable between iterations: the budget is small on purpose.
		if _, err := h.eng.SetEnabled(h.ctx, h.accountID, saved.ID, h.userID, true); err != nil {
			t.Fatalf("SetEnabled: %v", err)
		}
		setup()
		run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
		if run.Outcome != OutcomeRefused || RefusalReason(err) != ReasonAmbiguousState {
			t.Fatalf("ambiguous condition: outcome=%s err=%v", run.Outcome, err)
		}
	}
	if len(h.drv.Calls()) != calls {
		t.Error("an ambiguous condition must not actuate")
	}
}

// --- the breaker ------------------------------------------------------------

func TestRepeatedDriverFailureDisablesTheRule(t *testing.T) {
	h := newHarness(t)
	saved, err := h.eng.SaveRule(h.ctx, h.rule("lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	h.drv.fail(devices.ErrUnreachable)

	for i := 1; i <= DefaultFailureBudget; i++ {
		run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
		if run.Outcome != OutcomeFailed {
			t.Fatalf("run %d: outcome=%s, want failed", i, run.Outcome)
		}
	}
	after := h.reload(saved.ID)
	if after.Enabled {
		t.Fatalf("rule should have stopped itself after %d failures", DefaultFailureBudget)
	}
	if after.DisabledReason != "failure_budget" {
		t.Errorf("disabled_reason = %q", after.DisabledReason)
	}
	// A disabled rule does not keep trying.
	run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if run.Outcome != OutcomeSkipped || run.Reason != ReasonDisabled {
		t.Errorf("disabled rule ran anyway: %s/%s", run.Outcome, run.Reason)
	}
	// A human re-enabling it is what re-arms the budget.
	if _, err := h.eng.SetEnabled(h.ctx, h.accountID, saved.ID, h.userID, true); err != nil {
		t.Fatalf("SetEnabled: %v", err)
	}
	if r := h.reload(saved.ID); !r.Enabled || r.ConsecutiveFailures != 0 || r.DisabledReason != "" {
		t.Errorf("re-enable did not re-arm the rule: %+v", r)
	}
}

func TestSuccessResetsTheFailureCount(t *testing.T) {
	h := newHarness(t)
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	h.drv.fail(devices.ErrUnreachable)
	h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if got := h.reload(saved.ID).ConsecutiveFailures; got != 1 {
		t.Fatalf("failures = %d, want 1", got)
	}
	h.drv.fail(nil)
	h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if got := h.reload(saved.ID).ConsecutiveFailures; got != 0 {
		t.Fatalf("failures = %d after a success, want 0", got)
	}
}

// An indeterminate outcome is neither a success nor a retry.
func TestIndeterminateIsRecordedAndNotRetried(t *testing.T) {
	h := newHarness(t)
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("bot", dailyAt(6*60),
		Action{DeviceKey: "test:bot-1", Verb: devices.VerbStart}))
	h.drv.fail(devices.ErrIndeterminate)
	run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if run.Outcome != OutcomeIndeterminate {
		t.Fatalf("outcome = %s, want indeterminate", run.Outcome)
	}
	if len(h.drv.Calls()) != 0 {
		t.Error("no retry may follow an indeterminate outcome")
	}
	if got := len(h.runs(saved.ID)); got != 1 {
		t.Errorf("expected exactly one run row, got %d", got)
	}
}

// A broken audit trail stops the rule. It cannot un-actuate what already
// happened; it stops the next one, and says so.
func TestAuditFailureDisablesTheRule(t *testing.T) {
	h := newHarness(t)
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	h.audit.failWith(errors.New("audit table is unavailable"))

	run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if run.Outcome != OutcomeExecuted {
		t.Fatalf("outcome = %s; the actuation itself succeeded", run.Outcome)
	}
	if run.Audited {
		t.Error("run must record that its audit row was not written")
	}
	after := h.reload(saved.ID)
	if after.Enabled || after.DisabledReason != ReasonAuditUnavailable {
		t.Fatalf("rule should be disabled with %s, got enabled=%v reason=%q",
			ReasonAuditUnavailable, after.Enabled, after.DisabledReason)
	}
}

// --- persistence and tenancy ------------------------------------------------

func TestRuleRoundTripsThroughSQLite(t *testing.T) {
	h := newHarness(t)
	r := h.rule("evening lights", Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
		DeviceKey: "test:tank-1", Metric: "percent", Op: OpBelow, Value: 20}},
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbSet, Args: map[string]float64{"level": 40}})
	r.Conditions = []Condition{{DeviceKey: "test:tank-1", Metric: "percent", Op: OpAtMost, Value: 90}}
	r.MinIntervalS = 300
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	got := h.reload(saved.ID)
	if got.Trigger.Kind != TriggerThreshold || got.Trigger.Threshold.Value != 20 ||
		got.Trigger.Threshold.Op != OpBelow || got.Trigger.Threshold.DeviceKey != "test:tank-1" {
		t.Errorf("trigger did not round-trip: %+v", got.Trigger)
	}
	if got.Action.Verb != devices.VerbSet || got.Action.Args["level"] != 40 {
		t.Errorf("action did not round-trip: %+v", got.Action)
	}
	if len(got.Conditions) != 1 || got.Conditions[0].Op != OpAtMost {
		t.Errorf("conditions did not round-trip: %+v", got.Conditions)
	}
	if got.MinIntervalS != 300 || got.ActionTier != devices.TierReversible || got.CreatedBy != h.userID {
		t.Errorf("scalars did not round-trip: %+v", got)
	}
}

func TestRulesAreAccountScoped(t *testing.T) {
	h := newHarness(t)
	other, err := h.st.CreateUser(h.ctx, "other@example.test", "x", "Other", "ZA")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	otherAcct, _, err := h.st.CreateAccountWithOwner(h.ctx, other.ID, "Other Estate", "ZA")
	if err != nil {
		t.Fatalf("CreateAccountWithOwner: %v", err)
	}
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("mine", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))

	if _, err := h.rules.RuleByID(h.ctx, otherAcct.ID, saved.ID); !IsNotFound(err) {
		t.Errorf("another account could read the rule: %v", err)
	}
	if list, _ := h.rules.ListRules(h.ctx, otherAcct.ID); len(list) != 0 {
		t.Errorf("another account listed %d rules", len(list))
	}
	if err := h.eng.DeleteRule(h.ctx, otherAcct.ID, saved.ID, other.ID); !IsNotFound(err) {
		t.Errorf("another account could delete the rule: %v", err)
	}
	if _, err := h.eng.SetEnabled(h.ctx, otherAcct.ID, saved.ID, other.ID, false); !IsNotFound(err) {
		t.Errorf("another account could disable the rule: %v", err)
	}
	// The scheduler's cross-tenant read still sees it — that is its job.
	all, err := h.rules.AllEnabledRules(h.ctx)
	if err != nil || len(all) != 1 {
		t.Fatalf("AllEnabledRules: %d rules, err=%v", len(all), err)
	}
}

func TestRunHistorySurvivesRuleDeletion(t *testing.T) {
	h := newHarness(t)
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err := h.eng.DeleteRule(h.ctx, h.accountID, saved.ID, h.userID); err != nil {
		t.Fatalf("DeleteRule: %v", err)
	}
	if got := h.runs(saved.ID); len(got) != 1 || got[0].RuleName != "lights" {
		t.Fatalf("run history did not survive the delete: %+v", got)
	}
}

// Editing must not rewind the scheduler and replay an occurrence.
func TestSaveDoesNotRewindSchedulerState(t *testing.T) {
	h := newHarness(t)
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	occ := h.clock.Now().Unix()
	if _, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseSchedule, occ); err != nil {
		t.Fatalf("Fire: %v", err)
	}
	edited := h.reload(saved.ID)
	edited.Name = "lights, renamed"
	edited.LastOccurrenceAt = 0 // a caller trying to rewind
	if _, err := h.eng.SaveRule(h.ctx, edited); err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	if got := h.reload(saved.ID); got.LastOccurrenceAt != occ {
		t.Errorf("last_occurrence_at = %d, want %d — a save must not rewind the scheduler", got.LastOccurrenceAt, occ)
	}
}

func TestCooldownSkipsARunWithoutSpendingTheBudget(t *testing.T) {
	h := newHarness(t)
	r := h.rule("lights", dailyAt(19*60), Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn})
	r.MinIntervalS = 600
	saved, _ := h.eng.SaveRule(h.ctx, r)
	if run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0); run.Outcome != OutcomeExecuted {
		t.Fatalf("first run: %s", run.Outcome)
	}
	h.clock.advance(time.Minute)
	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil || run.Outcome != OutcomeSkipped || run.Reason != ReasonCooldown {
		t.Fatalf("second run: %s/%s err=%v", run.Outcome, run.Reason, err)
	}
	if got := h.reload(saved.ID).ConsecutiveFailures; got != 0 {
		t.Errorf("a cooldown skip spent %d of the budget", got)
	}
	h.clock.advance(10 * time.Minute)
	if run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0); run.Outcome != OutcomeExecuted {
		t.Fatalf("after the cooldown: %s", run.Outcome)
	}
}

// An indeterminate actuation must start the cooldown, so the rule cannot fire
// again on the next tick and repeat something that may already have happened.
//
// The package doc's whole argument for never retrying is that "retrying an
// unknown physical outcome is how a gate gets opened twice". Fire() honours it
// within a run — TestIndeterminateIsRecordedAndNotRetried covers that — but the
// scheduler calls Fire again on the very next occurrence, and the only thing
// standing between an unknown outcome and a second actuation is LastFiredAt
// being set, because MinIntervalS is gated on it.
//
// So "indeterminate counts as a fire" is load-bearing and looks like an
// oddity: a reasonable-sounding change is to only stamp LastFiredAt on
// success, since nothing was confirmed to have happened. That change reads as
// a correctness fix and is precisely the double-actuation this design exists
// to prevent.
func TestAnIndeterminateActuationStartsTheCooldown(t *testing.T) {
	h := newHarness(t)
	r := h.rule("gate", dailyAt(6*60), Action{DeviceKey: "test:bot-1", Verb: devices.VerbStart})
	r.MinIntervalS = 600
	saved, _ := h.eng.SaveRule(h.ctx, r)

	h.drv.fail(devices.ErrIndeterminate)
	run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if run.Outcome != OutcomeIndeterminate {
		t.Fatalf("first run: %s, want indeterminate", run.Outcome)
	}

	// The rule must now be inside its cooldown, exactly as if it had succeeded.
	if got := h.reload(saved.ID).LastFiredAt; got == 0 {
		t.Fatal("LastFiredAt was not stamped for an indeterminate outcome. The cooldown is " +
			"gated on it, so the next tick would actuate again — repeating an action the " +
			"driver could not confirm either way.")
	}

	h.drv.fail(nil) // clear the injected failure
	h.clock.advance(time.Minute)
	before := len(h.drv.Calls())
	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil {
		t.Fatal(err)
	}
	if run.Outcome != OutcomeSkipped || run.Reason != ReasonCooldown {
		t.Fatalf("second run: %s/%s, want skipped/cooldown", run.Outcome, run.Reason)
	}
	if got := len(h.drv.Calls()); got != before {
		t.Fatalf("the driver was called again %d time(s) while inside the cooldown", got-before)
	}

	// And once the cooldown genuinely expires the rule works normally: this is
	// a delay, not a latch.
	h.clock.advance(10 * time.Minute)
	if run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0); run.Outcome != OutcomeExecuted {
		t.Fatalf("after the cooldown: %s", run.Outcome)
	}
}

// Every access verb sits above the ceiling — pinned directly, against the
// catalogue, rather than inferred from access points being absent.
//
// Today an automation cannot open a gate for TWO independent reasons: access
// points are not in the device registry at all, so no rule can name one, and
// every access verb's tier is above MaxActionTier. docs/ACCESS-ON-THE-ENGINE.md
// proposes folding access into the engine, which would remove the FIRST reason
// and leave only the second.
//
// That is the whole cost of that fold, and this is what pays for it. A tier
// lowered by a future edit to capability.go — `open` marked TierConsequential
// because someone wanted a scheduled unlock — is caught here and nowhere else
// once the fold lands. Written before the fold deliberately: a compensating
// control added at the same time as the thing it compensates for is one review
// away from being dropped as noise.
//
// Asserted against the catalogue rather than a hand-written list of verbs, so a
// NEW access verb is covered the day it is added rather than the day somebody
// remembers this test.
func TestNoAccessVerbIsEverActuableByAnAutomation(t *testing.T) {
	// The capabilities that grant or deny entry to a space. If a third is added
	// to the catalogue, add it here — the sub-test below fails loudly if this
	// list stops covering what the catalogue calls access.
	accessCaps := []devices.CapabilityID{devices.CapBarrier, devices.CapLock}

	// Verbs that are genuinely safe for a rule: closing and locking REDUCE
	// access, and status reads nothing. Naming them explicitly means the loop
	// below can demand that everything else is refused, instead of just
	// checking that something is.
	permitted := map[devices.Verb]bool{
		devices.VerbClose: true, devices.VerbLock: true, devices.VerbStatus: true,
	}

	checked := 0
	for _, capID := range accessCaps {
		verbs := devices.VerbsOf(capID)
		if len(verbs) == 0 {
			t.Fatalf("capability %q is not in the catalogue", capID)
		}
		for _, vs := range verbs {
			checked++
			err := checkActionTier(vs.Tier)
			if permitted[vs.Verb] {
				if err != nil {
					t.Errorf("%s.%s (tier %v) is refused to automations, but closing or "+
						"locking REDUCES access and should stay available to a rule", capID, vs.Verb, vs.Tier)
				}
				continue
			}
			if err == nil {
				t.Errorf("%s.%s is at tier %v, which an automation MAY actuate. Every verb "+
					"that grants entry must sit above MaxActionTier (%v): an automation fires "+
					"with nobody watching, and once access is folded into the device engine "+
					"this ceiling is the ONLY thing standing between a rule and an open gate. "+
					"See docs/ACCESS-ON-THE-ENGINE.md §2.1.",
					capID, vs.Verb, vs.Tier, MaxActionTier)
			}
		}
	}

	// Without this the test would pass if the catalogue lookup silently returned
	// nothing — the shape that makes a guard look green while checking air.
	if checked < 6 {
		t.Errorf("only %d access verbs were checked; the catalogue has more than that, so "+
			"this test is not covering what it claims to", checked)
	}
}
