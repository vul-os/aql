package devices

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"
)

type invalidError struct{ msg string }

func (e invalidError) Error() string { return e.msg }

func errInvalid(format string, a ...any) error {
	return invalidError{msg: "devices: " + fmt.Sprintf(format, a...)}
}

// IsInvalid reports whether err came from validation rather than from a driver
// or a transport. Callers map it to 4xx; everything else is 5xx.
func IsInvalid(err error) bool {
	var e invalidError
	return errorsAs(err, &e)
}

func errorsAs(err error, target *invalidError) bool {
	for err != nil {
		if e, ok := err.(invalidError); ok {
			*target = e
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

// Registry holds the live drivers and the device index built from them. It is
// the only thing callers outside this package talk to.
//
// Safe for concurrent use: the hub is a live HTTP server and a driver's
// background telemetry loop refreshes the index while requests read it.
type Registry struct {
	mu      sync.RWMutex
	drivers map[string]Driver
	// index maps Key(driverID, deviceID) → device.
	index map[string]Device
	// now is swappable for tests.
	now func() time.Time
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{
		drivers: map[string]Driver{},
		index:   map[string]Device{},
		now:     time.Now,
	}
}

// Register adds a driver. It refuses a duplicate id rather than replacing:
// silently swapping a live driver would orphan devices that are still indexed
// under it.
func (r *Registry) Register(d Driver) error {
	if d == nil {
		return errInvalid("nil driver")
	}
	id := d.ID()
	if id == "" {
		return errInvalid("driver has empty id")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.drivers[id]; exists {
		return errInvalid("driver %q already registered", id)
	}
	r.drivers[id] = d
	return nil
}

// Refresh re-runs Discover on every driver and rebuilds the index.
//
// A driver that errors keeps its previously-indexed devices rather than having
// them vanish: a broker blipping should not make a resident's fleet disappear
// from the console. Those devices are marked AvailUnknown, because "we cannot
// currently confirm this" is the honest state and is distinct from both online
// and offline.
//
// Devices failing Validate are dropped and reported. Returns one error per
// failing driver, joined; the index is still updated for the drivers that
// succeeded.
func (r *Registry) Refresh(ctx context.Context) error {
	r.mu.RLock()
	drivers := make([]Driver, 0, len(r.drivers))
	for _, d := range r.drivers {
		drivers = append(drivers, d)
	}
	r.mu.RUnlock()

	type result struct {
		driverID string
		devices  []Device
		err      error
	}
	results := make([]result, 0, len(drivers))
	for _, d := range drivers {
		found, err := d.Discover(ctx)
		results = append(results, result{driverID: d.ID(), devices: found, err: err})
	}

	var problems []string
	r.mu.Lock()
	for _, res := range results {
		if res.err != nil {
			problems = append(problems, fmt.Sprintf("driver %s: %v", res.driverID, res.err))
			// Keep what we had, but stop asserting it is live.
			for k, dev := range r.index {
				if driverOf(k) == res.driverID {
					dev.Availability = AvailUnknown
					r.index[k] = dev
				}
			}
			continue
		}
		// Drop this driver's previous entries, then re-add the valid ones, so a
		// device that genuinely disappeared does not linger forever.
		for k := range r.index {
			if driverOf(k) == res.driverID {
				delete(r.index, k)
			}
		}
		for _, dev := range res.devices {
			if err := dev.Validate(); err != nil {
				problems = append(problems, fmt.Sprintf("driver %s: %v", res.driverID, err))
				continue
			}
			if dev.LastSeen.IsZero() {
				dev.LastSeen = r.now()
			}
			r.index[Key(res.driverID, dev.ID)] = dev
		}
	}
	r.mu.Unlock()

	if len(problems) > 0 {
		sort.Strings(problems)
		return errInvalid("refresh: %v", problems)
	}
	return nil
}

func driverOf(key string) string {
	for i := 0; i < len(key); i++ {
		if key[i] == ':' {
			return key[:i]
		}
	}
	return ""
}

// Devices returns every indexed device with its global key, sorted by key so
// the console's list is stable between polls.
func (r *Registry) Devices() []IndexedDevice {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]IndexedDevice, 0, len(r.index))
	for k, d := range r.index {
		out = append(out, IndexedDevice{Key: k, Driver: driverOf(k), Device: d})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// IndexedDevice is a device plus the key and driver it is indexed under.
type IndexedDevice struct {
	Key    string
	Driver string
	Device Device
}

// Get resolves a global key.
func (r *Registry) Get(key string) (IndexedDevice, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.index[key]
	if !ok {
		return IndexedDevice{}, false
	}
	return IndexedDevice{Key: key, Driver: driverOf(key), Device: d}, true
}

// Plan is the resolved, authorised form of "do this verb on this device". It
// exists so a caller can decide on tier BEFORE anything is actuated — a chat
// rail or an automation asks for the plan, applies its own policy to
// plan.Tier, and only then calls Execute.
type Plan struct {
	Key        string
	Driver     string
	Verb       Verb
	Capability CapabilityID
	Tier       Tier
	Args       map[string]float64
}

// Resolve validates a request without performing it: the device exists, it
// offers the verb, the tier is actuable, and the argument is present and in
// range. Every failure is an invalid-error, and none of them distinguishes
// "no such device" from "device does not offer that verb" — the correct
// response to both is the same refusal.
func (r *Registry) Resolve(key string, v Verb, args map[string]float64) (Plan, error) {
	dev, ok := r.Get(key)
	if !ok {
		return Plan{}, errInvalid("no such device")
	}
	spec, capID, ok := dev.Device.Supports(v)
	if !ok {
		return Plan{}, errInvalid("no such device")
	}
	if !spec.Tier.Allowed() {
		return Plan{}, errInvalid("verb %q is not actuable (%s)", string(v), spec.Tier)
	}
	clean := map[string]float64{}
	if spec.Arg != "" {
		val, present := args[spec.Arg]
		if !present {
			return Plan{}, errInvalid("verb %q requires argument %q", string(v), spec.Arg)
		}
		if val < spec.Min || val > spec.Max {
			return Plan{}, errInvalid("argument %q out of range: %v not in [%v,%v]", spec.Arg, val, spec.Min, spec.Max)
		}
		clean[spec.Arg] = val
	}
	// Anything the spec did not ask for is dropped rather than forwarded. A
	// driver must not receive a field the registry did not validate.
	return Plan{
		Key: key, Driver: dev.Driver, Verb: v,
		Capability: capID, Tier: spec.Tier, Args: clean,
	}, nil
}

// Execute resolves and performs a verb. Callers wanting to apply tier policy
// first should call Resolve, check Plan.Tier, then ExecutePlan.
func (r *Registry) Execute(ctx context.Context, key string, v Verb, args map[string]float64) error {
	plan, err := r.Resolve(key, v, args)
	if err != nil {
		return err
	}
	return r.ExecutePlan(ctx, plan)
}

// ExecutePlan performs an already-resolved plan. The plan is re-resolved
// first: a Plan is a value the caller may have held across a gap, and the
// device may have changed capabilities or disappeared in between. Re-resolving
// costs a map lookup and removes a whole class of stale-authorisation bug.
func (r *Registry) ExecutePlan(ctx context.Context, plan Plan) error {
	fresh, err := r.Resolve(plan.Key, plan.Verb, plan.Args)
	if err != nil {
		return err
	}
	if fresh.Tier != plan.Tier || fresh.Capability != plan.Capability {
		return errInvalid("device changed since the plan was made; re-resolve")
	}
	r.mu.RLock()
	d, ok := r.drivers[fresh.Driver]
	r.mu.RUnlock()
	if !ok {
		return errInvalid("no such device")
	}
	deviceID := fresh.Key[len(fresh.Driver)+1:]
	return d.Execute(ctx, deviceID, fresh.Verb, fresh.Args)
}

// Read returns current readings for a device.
func (r *Registry) Read(ctx context.Context, key string) ([]Reading, error) {
	dev, ok := r.Get(key)
	if !ok {
		return nil, errInvalid("no such device")
	}
	r.mu.RLock()
	d, ok := r.drivers[dev.Driver]
	r.mu.RUnlock()
	if !ok {
		return nil, errInvalid("no such device")
	}
	return d.Read(ctx, dev.Device.ID)
}

// DriverHealth reports every registered driver's health, sorted by driver id.
func (r *Registry) DriverHealth(ctx context.Context) map[string]Health {
	r.mu.RLock()
	drivers := make(map[string]Driver, len(r.drivers))
	for k, v := range r.drivers {
		drivers[k] = v
	}
	r.mu.RUnlock()
	out := make(map[string]Health, len(drivers))
	for id, d := range drivers {
		out[id] = d.Health(ctx)
	}
	return out
}

// Close closes every driver implementing Closer. Errors are joined.
func (r *Registry) Close() error {
	r.mu.Lock()
	drivers := make([]Driver, 0, len(r.drivers))
	for _, d := range r.drivers {
		drivers = append(drivers, d)
	}
	r.drivers = map[string]Driver{}
	r.index = map[string]Device{}
	r.mu.Unlock()

	var problems []string
	for _, d := range drivers {
		if c, ok := d.(Closer); ok {
			if err := c.Close(); err != nil {
				problems = append(problems, fmt.Sprintf("%s: %v", d.ID(), err))
			}
		}
	}
	if len(problems) > 0 {
		sort.Strings(problems)
		return fmt.Errorf("devices: close: %v", problems)
	}
	return nil
}
