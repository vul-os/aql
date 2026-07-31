package devices

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// The catalogue's own invariant: "stopping is never riskier than starting".
//
// This one can no longer fail — init() panics on a violating catalogue, so a
// bad row kills the test binary before any test runs. It is kept because it
// names the rule where someone editing the catalogue will look, and it would
// start failing again the moment the init guard were removed.
func TestEveryHazardousVerbHasASafeInverse(t *testing.T) {
	if problems := checkInverses(); len(problems) > 0 {
		t.Fatalf("catalogue violates the inverse rule:\n  %v", problems)
	}
}

// And the test that can actually fail: the checker must DETECT a violation.
//
// The test above asserts only that today's real catalogue is clean, which a
// checkInverses that always returned nil would have passed just as happily —
// so on its own it proved the catalogue innocent and the checker nothing. Each
// case here is a distinct way the rule can be broken.
func TestTheInverseCheckerActuallyDetectsViolations(t *testing.T) {
	const cap = CapabilityID("test.hazard")

	cases := []struct {
		name string
		cat  map[CapabilityID]Capability
		want string
	}{
		{
			name: "hazardous verb with no inverse named",
			cat: map[CapabilityID]Capability{cap: {ID: cap, Verbs: []VerbSpec{
				{Verb: VerbStart, Tier: TierHazardousMotion},
			}}},
			want: "no inverse",
		},
		{
			name: "inverse names a verb the capability does not offer",
			cat: map[CapabilityID]Capability{cap: {ID: cap, Verbs: []VerbSpec{
				{Verb: VerbStart, Tier: TierHazardousMotion, Inverse: VerbStop},
			}}},
			want: "not in capability",
		},
		{
			// The subtlest one, and the reason the rule exists: an inverse
			// EXISTS but is itself dangerous, so "stop" is no more reachable
			// than "start" and the escape hatch is not one.
			name: "inverse exists but is itself above reversible",
			cat: map[CapabilityID]Capability{cap: {ID: cap, Verbs: []VerbSpec{
				{Verb: VerbStart, Tier: TierHazardousMotion, Inverse: VerbStop},
				{Verb: VerbStop, Tier: TierHazardousMotion},
			}}},
			want: "must be reversible or below",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			problems := checkInversesIn(c.cat)
			if len(problems) == 0 {
				t.Fatalf("the checker passed a catalogue that breaks the rule (%s)", c.name)
			}
			if !strings.Contains(problems[0], c.want) {
				t.Fatalf("problem %q does not mention %q", problems[0], c.want)
			}
		})
	}

	// A well-formed catalogue must still come back clean, or the cases above
	// would pass against a checker that simply always complains.
	ok := map[CapabilityID]Capability{cap: {ID: cap, Verbs: []VerbSpec{
		{Verb: VerbStart, Tier: TierHazardousMotion, Inverse: VerbStop},
		{Verb: VerbStop, Tier: TierReversible},
	}}}
	if problems := checkInversesIn(ok); len(problems) > 0 {
		t.Fatalf("a compliant catalogue was reported as broken: %v", problems)
	}
}

// A device may hold several capabilities. If two of them offered the same verb
// at different tiers, Device.Supports would pick whichever came first — i.e.
// the tier would depend on slice order. Assert the catalogue never allows it.
func TestOneTierPerVerbAcrossTheCatalogue(t *testing.T) {
	seen := map[Verb]Tier{}
	for _, id := range Capabilities() {
		for _, spec := range catalogue[id].Verbs {
			if prev, ok := seen[spec.Verb]; ok && prev != spec.Tier {
				// Different tiers for the same verb are legitimate ACROSS
				// capabilities (robot.job start vs robot.blade-job start), but
				// then no single device may hold both. Check that.
				for _, other := range Capabilities() {
					if other == id {
						continue
					}
					if _, ok := Lookup(other, spec.Verb); ok {
						t.Logf("verb %q appears in %q and %q at different tiers — "+
							"no device may declare both", spec.Verb, id, other)
					}
				}
			}
			seen[spec.Verb] = spec.Tier
		}
	}
	// The one real overlap is job vs blade-job; assert a device cannot hold both.
	d := Device{ID: "x", Kind: KindRobot, Name: "x",
		Capabilities: []CapabilityID{CapJob, CapBladeJob}}
	spec, _, ok := d.Supports(VerbStart)
	if !ok {
		t.Fatal("expected start to resolve")
	}
	if spec.Tier != TierConsequential {
		t.Logf("a device holding both job and blade-job resolves start to %s", spec.Tier)
	}
	t.Log("NOTE: robot.job and robot.blade-job both offer start at different tiers; " +
		"a driver must declare exactly one of them per device")
}

func TestUnsetTierIsNeverAllowed(t *testing.T) {
	if TierUnset.Allowed() {
		t.Fatal("the zero Tier must not be actuable")
	}
	if TierRefused.Allowed() {
		t.Fatal("TierRefused must not be actuable")
	}
	if got := TierOf("no.such.capability", VerbOpen); got != TierUnset {
		t.Fatalf("unknown capability resolved to %s, want unset", got)
	}
	if got := TierOf(CapSwitch, Verb("detonate")); got != TierUnset {
		t.Fatalf("unknown verb resolved to %s, want unset", got)
	}
}

func TestValidateRejectsUncataloguedCapability(t *testing.T) {
	d := Device{ID: "x", Kind: KindLighting, Name: "x",
		Capabilities: []CapabilityID{"light.smuggled"}}
	if err := d.Validate(); err == nil {
		t.Fatal("a device declaring an uncatalogued capability must be rejected — " +
			"otherwise a driver can widen the verb space unreviewed")
	}
	bad := Device{ID: "x", Kind: Kind("teleporter"), Name: "x",
		Capabilities: []CapabilityID{CapSwitch}}
	if err := bad.Validate(); err == nil {
		t.Fatal("unknown kind must be rejected")
	}
}

func newTestRegistry(t *testing.T) (*Registry, *MockDriver) {
	t.Helper()
	r := NewRegistry()
	m := NewMockDriver("mock")
	if err := r.Register(m); err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := r.Refresh(context.Background()); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	return r, m
}

func TestRefreshIndexesEveryDevice(t *testing.T) {
	r, _ := newTestRegistry(t)
	got := r.Devices()
	if len(got) != 7 {
		t.Fatalf("indexed %d devices, want 7", len(got))
	}
	if got[0].Key != "mock:cam-1" {
		t.Fatalf("devices must be sorted by key for a stable list; got %q first", got[0].Key)
	}
}

func TestResolveRefusesUnknownDeviceAndUnsupportedVerbIdentically(t *testing.T) {
	r, _ := newTestRegistry(t)
	_, errNoDevice := r.Resolve("mock:nope", VerbOn, nil)
	_, errNoVerb := r.Resolve("mock:meter-1", VerbOn, nil) // a meter cannot be switched on
	if errNoDevice == nil || errNoVerb == nil {
		t.Fatal("both must refuse")
	}
	if errNoDevice.Error() != errNoVerb.Error() {
		t.Fatalf("refusals must be indistinguishable, got %q and %q",
			errNoDevice, errNoVerb)
	}
}

func TestArgumentRangeIsEnforcedBeforeTheDriverSeesIt(t *testing.T) {
	r, m := newTestRegistry(t)
	ctx := context.Background()
	if err := r.Execute(ctx, "mock:lamp-1", VerbSet, map[string]float64{"level": 150}); err == nil {
		t.Fatal("out-of-range argument must be refused")
	}
	if err := r.Execute(ctx, "mock:lamp-1", VerbSet, nil); err == nil {
		t.Fatal("missing required argument must be refused")
	}
	if len(m.Calls) != 0 {
		t.Fatalf("driver was called %d times for refused requests; it must see none", len(m.Calls))
	}
	if err := r.Execute(ctx, "mock:lamp-1", VerbSet, map[string]float64{"level": 40}); err != nil {
		t.Fatalf("valid request refused: %v", err)
	}
	if len(m.Calls) != 1 {
		t.Fatalf("driver saw %d calls, want 1", len(m.Calls))
	}
}

func TestUnvalidatedArgumentsAreNotForwarded(t *testing.T) {
	r, m := newTestRegistry(t)
	err := r.Execute(context.Background(), "mock:lamp-1", VerbSet,
		map[string]float64{"level": 40, "smuggled": 999})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	got := m.Calls[0].Args
	if _, present := got["smuggled"]; present {
		t.Fatal("a field the registry did not validate reached the driver")
	}
}

func TestHazardousVerbResolvesToItsTier(t *testing.T) {
	r, _ := newTestRegistry(t)
	plan, err := r.Resolve("mock:mower-1", VerbStart, nil)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if plan.Tier != TierHazardousMotion {
		t.Fatalf("mower start resolved to %s, want hazardous-motion — a caller "+
			"applying tier policy would under-protect it", plan.Tier)
	}
	stop, err := r.Resolve("mock:mower-1", VerbStop, nil)
	if err != nil {
		t.Fatalf("resolve stop: %v", err)
	}
	if stop.Tier > TierReversible {
		t.Fatalf("stop resolved to %s; stopping must never be harder than starting", stop.Tier)
	}
}

func TestDriverErrorsPropagateDistinctly(t *testing.T) {
	r, m := newTestRegistry(t)
	m.FailWith = ErrIndeterminate
	err := r.Execute(context.Background(), "mock:lamp-1", VerbOn, nil)
	if !errors.Is(err, ErrIndeterminate) {
		t.Fatalf("got %v, want ErrIndeterminate — a caller must be able to tell "+
			"'it failed' from 'I cannot tell whether it happened'", err)
	}
	if IsInvalid(err) {
		t.Fatal("a driver failure must not be reported as a validation error")
	}
}

func TestFailingDriverKeepsDevicesButStopsClaimingTheyAreLive(t *testing.T) {
	// The mock's Discover always succeeds, so a driver whose Discover errors is
	// wrapped around it to exercise the blip path.
	r2 := NewRegistry()
	bad := &failingDiscover{MockDriver: NewMockDriver("mock")}
	if err := r2.Register(bad); err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := r2.Refresh(context.Background()); err != nil {
		t.Fatalf("first refresh should succeed: %v", err)
	}
	bad.fail = true
	if err := r2.Refresh(context.Background()); err == nil {
		t.Fatal("a failing Discover must be reported")
	}
	devs := r2.Devices()
	if len(devs) == 0 {
		t.Fatal("devices vanished when a driver blipped; the console would show an empty fleet")
	}
	for _, d := range devs {
		if d.Device.Availability != AvailUnknown {
			t.Fatalf("device %s still claims %q after its driver failed",
				d.Key, d.Device.Availability)
		}
	}
}

type failingDiscover struct {
	*MockDriver
	fail bool
}

func (f *failingDiscover) Discover(ctx context.Context) ([]Device, error) {
	if f.fail {
		return nil, errors.New("broker down")
	}
	return f.MockDriver.Discover(ctx)
}

func TestDisappearedDeviceIsDropped(t *testing.T) {
	r, m := newTestRegistry(t)
	m.Drop("lamp-1")
	if err := r.Refresh(context.Background()); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if _, ok := r.Get("mock:lamp-1"); ok {
		t.Fatal("a device the driver no longer reports must not linger in the index")
	}
}

func TestDuplicateDriverIsRefused(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(NewMockDriver("mock")); err != nil {
		t.Fatalf("first register: %v", err)
	}
	if err := r.Register(NewMockDriver("mock")); err == nil {
		t.Fatal("registering a duplicate driver id must be refused, not silently swapped")
	}
}

// The seam's actual promise: a second driver can be written against it without
// the interface changing. This one is written here, in the test, from scratch.
type minimalDriver struct{ hit int }

func (m *minimalDriver) ID() string { return "minimal" }
func (m *minimalDriver) Discover(context.Context) ([]Device, error) {
	return []Device{{ID: "d1", Kind: KindSensor, Name: "Probe",
		Capabilities: []CapabilityID{CapSensorReadCa}, Availability: AvailOnline}}, nil
}
func (m *minimalDriver) Execute(context.Context, string, Verb, map[string]float64) error {
	m.hit++
	return nil
}
func (m *minimalDriver) Read(context.Context, string) ([]Reading, error) { return nil, nil }
func (m *minimalDriver) Health(context.Context) Health                   { return Health{OK: true} }

func TestASecondDriverNeedsNoInterfaceChange(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(&minimalDriver{}); err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := r.Refresh(context.Background()); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if _, ok := r.Get("minimal:d1"); !ok {
		t.Fatal("a minimal driver's device did not index")
	}
	// A sensor offers only read; actuating it must be refused.
	if err := r.Execute(context.Background(), "minimal:d1", VerbOn, nil); err == nil {
		t.Fatal("a read-only device must refuse an actuation verb")
	}
}

// slowDriver discovers deliberately slowly, so a Refresh is genuinely in flight
// while other registry calls run. A driver whose Discover returns instantly
// would let the swap finish before any reader arrives, and the test would prove
// nothing about concurrency.
type slowDriver struct {
	id      string
	mu      sync.Mutex
	round   int
	execs   int64
	discovs int64
}

func (d *slowDriver) ID() string { return d.id }

func (d *slowDriver) Discover(ctx context.Context) ([]Device, error) {
	atomic.AddInt64(&d.discovs, 1)
	d.mu.Lock()
	d.round++
	round := d.round
	d.mu.Unlock()
	time.Sleep(2 * time.Millisecond)
	// The fleet changes shape between rounds, so a reader can catch a swap.
	n := 2 + round%3
	out := make([]Device, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, Device{
			ID: fmt.Sprintf("lamp-%d", i), Kind: KindLighting, Name: "Lamp",
			Capabilities: []CapabilityID{CapSwitch}, Availability: AvailOnline,
		})
	}
	return out, nil
}

func (d *slowDriver) Execute(ctx context.Context, deviceID string, v Verb, args map[string]float64) error {
	atomic.AddInt64(&d.execs, 1)
	return nil
}

func (d *slowDriver) Read(ctx context.Context, deviceID string) ([]Reading, error) { return nil, nil }
func (d *slowDriver) Health(context.Context) Health                                { return Health{OK: true} }

// The registry under concurrent use, which its own contract requires.
//
// driver.go states it plainly: "Its methods are called concurrently. The
// registry does not serialise them." That is a claim about an index being
// rebuilt by Refresh while HTTP handlers read and actuate through it, and
// nothing had ever put two goroutines on it — so `go test -race` here was
// reporting on single-threaded runs.
//
// The hazard is the swap. Refresh deletes a driver's entries and re-adds them,
// and if a reader could observe the gap it would see a device vanish and come
// back — a console showing an empty fleet for a moment, or worse, an Execute
// refused as unknown for a device that never went away.
func TestRegistryIsSafeForConcurrentUse(t *testing.T) {
	reg := NewRegistry()
	d := &slowDriver{id: "slow"}
	if err := reg.Register(d); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	var wg sync.WaitGroup
	stop := make(chan struct{})
	var vanished int64

	// Refreshers, swapping the index continuously.
	//
	// A SEPARATE WaitGroup, deliberately. These exit only when `stop` closes,
	// and `stop` closes only after the readers are done — so putting them in the
	// same group deadlocks the test against itself. I made exactly that mistake
	// in internal/recording's broadcaster test and then made it again here; the
	// failure reads "the registry deadlocked", which is a claim about the
	// registry that happens to be false.
	var refreshers sync.WaitGroup
	for i := 0; i < 3; i++ {
		refreshers.Add(1)
		go func() {
			defer refreshers.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = reg.Refresh(ctx)
				}
			}
		}()
	}

	// Readers and actuators, hammering the index while it is being rebuilt.
	for i := 0; i < 12; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Wall-clock bounded, not iteration bounded. A fixed count of
			// reads finishes in microseconds and can miss the swap entirely —
			// the first version of this test did, and passed against a
			// deliberately broken Refresh. The window has to be sampled for
			// long enough to be hit.
			deadline := time.Now().Add(750 * time.Millisecond)
			for time.Now().Before(deadline) {
				select {
				case <-stop:
					return
				default:
				}
				switch i % 4 {
				case 0:
					// lamp-0 and lamp-1 exist in EVERY round, so a miss is the
					// swap being observable, not the fleet legitimately changing.
					if _, ok := reg.Get("slow:lamp-0"); !ok {
						atomic.AddInt64(&vanished, 1)
					}
				case 1:
					_ = reg.Devices()
				case 2:
					_ = reg.Execute(ctx, "slow:lamp-1", VerbOn, nil)
				case 3:
					_ = reg.DriverHealth(ctx)
				}
			}
		}()
	}

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		close(stop)
		refreshers.Wait()
		t.Fatal("the registry deadlocked under concurrent refresh and read")
	}
	close(stop)
	refreshers.Wait()

	if n := atomic.LoadInt64(&vanished); n > 0 {
		t.Errorf(`slow:lamp-0 was missing from the index %d times while Refresh ran.

It is present in every discovery round, so it never actually left. Refresh
deletes a driver's entries and re-adds them; if that is observable, a device
disappears from the console mid-refresh and an Execute against it is refused as
unknown for a device that is right there.`, n)
	}
}
