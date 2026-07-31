package automations

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Runner is the scheduler: one goroutine, one ticker, one pass per tick over
// every enabled rule.
//
// # Why one loop and not three
//
// A schedule is due when the clock passes an instant; a threshold has crossed
// when the current sample is on the other side of the bound from the last one;
// a device event has happened when the registry's availability for a device
// differs from the last time we looked. All three are the same operation —
// compare now against what we last saw — so they are the same loop, sampled at
// the same moment, and a rule can never see two different "nows" in one pass.
//
// # Surviving restart
//
// Schedule state is persisted (automation_rules.last_occurrence_at), so the
// scheduler resumes where it left off rather than from boot. Threshold and
// event state is NOT persisted, deliberately: both are EDGE triggers, and the
// only honest thing to say about the edge across a restart is that we did not
// see it. The first tick after boot establishes a baseline and fires nothing —
// a hub that reboots at 3am does not get to decide that the tank "just crossed"
// a level it has been sitting below for hours.
//
// # The missed-occurrence rule
//
// A scheduled occurrence the hub was down for is replayed only if it came due
// within MissedGrace. Older ones are recorded as skipped and stepped over. The
// alternative — replaying everything — means a hub that was off for a day comes
// back and fires a night's worth of automations at once, in daylight, with
// nobody expecting it.
type Runner struct {
	eng        *Engine
	interval   time.Duration
	grace      time.Duration
	maxCatchup int
	now        func() time.Time
	log        *slog.Logger

	clips ClipIndex

	mu sync.Mutex
	// clipAt is the newest clip instant last seen per rule. Per RULE rather
	// than per device, because two rules watching one camera must each get
	// their own first-observation seed — sharing it would let the second rule
	// inherit the first's memory and never fire on a clip it had not seen.
	clipAt map[string]int64
	// Which clip rules have already reported that this hub cannot see clips.
	// Per rule, so the notice lands once per outage rather than every tick.
	clipBlind map[string]bool
	// level is the threshold edge memo, keyed by rule id.
	level map[string]levelState
	// avail is the last observed availability per device key, shared by every
	// event rule. Empty means "not yet sampled": the first tick seeds it and
	// fires nothing.
	avail map[string]devices.Availability
}

type levelState struct {
	// known is false until a usable numeric sample has been seen. An unknown
	// previous state never fires: an edge needs two points.
	known     bool
	satisfied bool
	// unreadableReported keeps the "this sensor cannot be read" run row to ONE
	// per outage rather than one per tick.
	unreadableReported bool
}

// Defaults for the runner. The tick interval is the hub's polling granularity
// for every trigger kind; schedules resolve to a minute, so 30s is fine-grained
// enough to be on time and coarse enough not to poll a fleet of drivers raw.
const (
	DefaultInterval    = 30 * time.Second
	DefaultMissedGrace = 10 * time.Minute
	DefaultMaxCatchup  = 32
)

// RunnerConfig configures a Runner.
type RunnerConfig struct {
	Engine      *Engine
	Interval    time.Duration
	MissedGrace time.Duration
	// MaxCatchup bounds how many missed occurrences one tick will step over,
	// so a hub that was off for a year does not spend its first tick writing
	// history. The remainder is stepped over on subsequent ticks.
	MaxCatchup int
	Now        func() time.Time
	Log        *slog.Logger
	// Clips answers "when did this camera last record", for clip triggers. Nil
	// disables them: the rules still load, and each records a skip saying the
	// hub cannot see its clip index, rather than never firing in silence.
	Clips ClipIndex
}

// ClipIndex is the clip half of the store, as the runner needs it.
//
// An interface rather than the store itself, so this package keeps depending on
// nothing but the registry and its own tables — the same reason Notifier is one.
type ClipIndex interface {
	NewestClipAt(ctx context.Context, accountID, deviceKey string) (int64, bool, error)
}

// NewRunner builds a runner. Interval/grace/catchup fall back to the defaults.
func NewRunner(cfg RunnerConfig) (*Runner, error) {
	if cfg.Engine == nil {
		return nil, errors.New("automations: runner has no engine")
	}
	rn := &Runner{
		eng: cfg.Engine, interval: cfg.Interval, grace: cfg.MissedGrace,
		maxCatchup: cfg.MaxCatchup, now: cfg.Now, log: cfg.Log,
		clips:     cfg.Clips,
		level:     map[string]levelState{},
		avail:     map[string]devices.Availability{},
		clipAt:    map[string]int64{},
		clipBlind: map[string]bool{},
	}
	if rn.interval <= 0 {
		rn.interval = DefaultInterval
	}
	if rn.grace <= 0 {
		rn.grace = DefaultMissedGrace
	}
	if rn.maxCatchup <= 0 {
		rn.maxCatchup = DefaultMaxCatchup
	}
	if rn.now == nil {
		rn.now = cfg.Engine.now
	}
	return rn, nil
}

// Run ticks until the context is cancelled. It is the process-lifetime
// goroutine; a tick that errors is logged and the loop continues, because one
// unreadable rule must not stop the fleet's schedules.
//
// The first tick is one interval AFTER start, not immediately: at boot the
// drivers have not necessarily discovered anything yet, and a rule evaluated
// against an empty registry would refuse for a reason that is about the hub's
// startup, not about the rule. Tick guards that case as well.
func (rn *Runner) Run(ctx context.Context) error {
	t := time.NewTicker(rn.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			if err := rn.Tick(ctx); err != nil {
				if rn.log != nil {
					rn.log.Warn("automations tick", "err", err)
				}
			}
		}
	}
}

// Tick runs exactly one pass. Exported so tests drive the scheduler by hand
// with an injected clock rather than by sleeping.
func (rn *Runner) Tick(ctx context.Context) error {
	now := rn.now()
	rules, err := rn.eng.store.AllEnabledRules(ctx)
	if err != nil {
		return err
	}
	if len(rules) == 0 {
		return nil
	}

	// Availability snapshot for this tick, taken once and shared.
	indexed := rn.eng.reg.Devices()
	if len(indexed) == 0 {
		// No driver has reported yet. Evaluating now would refuse every rule
		// for "no such device" — a statement about the hub's startup, not
		// about the rules — so the pass is skipped entirely.
		if rn.log != nil {
			rn.log.Debug("automations tick skipped: device registry is empty")
		}
		return nil
	}
	cur := make(map[string]devices.Availability, len(indexed))
	for _, d := range indexed {
		cur[d.Key] = d.Device.Availability
	}

	rn.mu.Lock()
	prev := rn.avail
	seeded := len(prev) > 0
	rn.mu.Unlock()

	cache := &readCache{reg: rn.eng.reg, vals: map[string][]devices.Reading{}, errs: map[string]error{}}

	var problems []error
	live := make(map[string]bool, len(rules))
	for _, r := range rules {
		live[r.ID] = true
		var err error
		switch r.Trigger.Kind {
		case TriggerSchedule:
			err = rn.tickSchedule(ctx, r, now)
		case TriggerThreshold:
			err = rn.tickThreshold(ctx, r, cache)
		case TriggerEvent:
			err = rn.tickEvent(ctx, r, prev, cur, seeded)
		case TriggerClip:
			err = rn.tickClip(ctx, r)
		default:
			// A stored rule with an unknown kind cannot be evaluated. Fire it
			// so the engine refuses it, records why, and disables it, rather
			// than leaving a row nothing will ever look at again.
			_, err = rn.eng.Fire(ctx, r, CauseManual, 0)
		}
		if err != nil && !IsRefusal(err) {
			problems = append(problems, err)
		}
	}

	rn.mu.Lock()
	rn.avail = cur
	for id := range rn.level {
		if !live[id] {
			delete(rn.level, id)
		}
	}
	rn.mu.Unlock()

	return errors.Join(problems...)
}

// tickSchedule accounts for every occurrence that has come due since the rule's
// last recorded one: firing the most recent if it is within the grace window,
// stepping over the older ones as skipped.
func (rn *Runner) tickSchedule(ctx context.Context, r Rule, now time.Time) error {
	sched := r.Trigger.Schedule
	if sched == nil {
		// Corrupt row; let the engine refuse and disable it.
		_, err := rn.eng.Fire(ctx, r, CauseSchedule, 0)
		return err
	}
	anchor := r.LastOccurrenceAt
	if anchor == 0 {
		// A rule that has never fired starts from when it was written, so
		// saving "every day at 07:00" at 09:00 does not immediately fire
		// today's 07:00.
		anchor = r.UpdatedAt
		if anchor == 0 {
			anchor = r.CreatedAt
		}
	}
	nowUnix := now.Unix()
	graceS := int64(rn.grace / time.Second)

	for i := 0; i < rn.maxCatchup; i++ {
		next, err := sched.NextAfter(time.Unix(anchor, 0))
		if err != nil {
			// An unloadable timezone or an impossible mask: refuse through the
			// engine so it is recorded and the rule stops.
			_, ferr := rn.eng.Fire(ctx, r, CauseSchedule, 0)
			return ferr
		}
		occ := next.Unix()
		if occ > nowUnix {
			return nil // not due yet
		}
		if nowUnix-occ > graceS {
			if err := rn.eng.RecordMissedOccurrence(ctx, r, occ); err != nil {
				return err
			}
			r.LastOccurrenceAt = occ
			anchor = occ
			continue
		}
		// Due, and recent enough to mean what it meant. One actuation per rule
		// per tick: anything else still outstanding is handled next tick, by
		// which time it is stale and will be stepped over.
		_, err = rn.eng.Fire(ctx, r, CauseSchedule, occ)
		return err
	}
	return nil
}

// tickThreshold fires on the EDGE: the previous usable sample did not satisfy
// the bound and the current one does. Level-triggering would re-fire every
// tick for as long as the condition held, which for an actuation means a
// device driven repeatedly by a sensor that has not changed.
func (rn *Runner) tickThreshold(ctx context.Context, r Rule, cache *readCache) error {
	th := r.Trigger.Threshold
	if th == nil {
		_, err := rn.eng.Fire(ctx, r, CauseThreshold, 0)
		return err
	}
	readings, rerr := cache.read(ctx, th.DeviceKey)
	var val float64
	var perr error
	if rerr != nil {
		perr = refuse(ReasonAmbiguousState, "%s: %v", th.DeviceKey, rerr)
	} else {
		val, perr = numericReading(readings, th.DeviceKey, th.Metric)
	}

	rn.mu.Lock()
	st := rn.level[r.ID]
	rn.mu.Unlock()

	if perr != nil {
		// The sensor cannot be read or does not say what the rule needs. The
		// rule cannot fire, and — because a rule that silently never fires is
		// the failure a resident does not notice — that is recorded ONCE per
		// outage rather than never or every tick. It is a skip, not a refusal:
		// nothing was going to actuate, so it does not spend the budget.
		report := !st.unreadableReported
		st = levelState{known: false, unreadableReported: true}
		rn.mu.Lock()
		rn.level[r.ID] = st
		rn.mu.Unlock()
		if !report {
			return nil
		}
		now := rn.eng.nowUnix()
		return rn.eng.store.InsertRun(ctx, Run{
			ID: newID(), RuleID: r.ID, RuleName: r.Name, AccountID: r.AccountID,
			Cause: CauseThreshold, Outcome: OutcomeSkipped, Reason: perr.Error(),
			DeviceKey: th.DeviceKey, StartedAt: now, FinishedAt: now,
		})
	}

	satisfied := th.Op.Holds(val, th.Value)
	fire := st.known && !st.satisfied && satisfied

	rn.mu.Lock()
	rn.level[r.ID] = levelState{known: true, satisfied: satisfied}
	rn.mu.Unlock()

	if !fire {
		return nil
	}
	_, err := rn.eng.Fire(ctx, r, CauseThreshold, 0)
	return err
}

// tickEvent fires when a device ENTERS the named availability state. The first
// tick after boot only seeds the baseline: an edge needs two observations, and
// inventing the first one would make every reboot look like every device just
// came online.
func (rn *Runner) tickEvent(ctx context.Context, r Rule, prev, cur map[string]devices.Availability, seeded bool) error {
	ev := r.Trigger.Event
	if ev == nil {
		_, err := rn.eng.Fire(ctx, r, CauseEvent, 0)
		return err
	}
	want, ok := ev.Name.Availability()
	if !ok {
		_, err := rn.eng.Fire(ctx, r, CauseEvent, 0)
		return err
	}
	if !seeded {
		return nil
	}
	was, known := prev[ev.DeviceKey]
	is, present := cur[ev.DeviceKey]
	if !known || !present {
		// The device appeared or disappeared from the index entirely. Neither
		// is the transition the rule asked about, and treating a device that
		// vanished as "offline" would fire a rule on a driver restart.
		return nil
	}
	if was == is || is != want {
		return nil
	}
	_, err := rn.eng.Fire(ctx, r, CauseEvent, 0)
	return err
}

// readCache holds one tick's readings so several rules watching the same
// device do not each poll its driver.
type readCache struct {
	reg  *devices.Registry
	vals map[string][]devices.Reading
	errs map[string]error
}

func (c *readCache) read(ctx context.Context, key string) ([]devices.Reading, error) {
	if err, ok := c.errs[key]; ok {
		return nil, err
	}
	if v, ok := c.vals[key]; ok {
		return v, nil
	}
	v, err := c.reg.Read(ctx, key)
	if err != nil {
		c.errs[key] = err
		return nil, err
	}
	c.vals[key] = v
	return v, nil
}

// tickClip fires when a camera has recorded since the last time this rule
// looked.
//
// The first observation SEEDS and does not fire, the same discipline
// tickThreshold and tickEvent follow: a hub restarting beside a week of footage
// must not alert about all of it, and "there are clips" is not the event —
// "there is a NEW clip" is.
//
// The memo is the newest clip's start instant rather than a count. A count
// falls when the retention sweep deletes an old clip, and a rule watching a
// count would fire on a DELETION — an alert saying a camera recorded, sent
// because footage was thrown away.
func (rn *Runner) tickClip(ctx context.Context, r Rule) error {
	cl := r.Trigger.Clip
	if cl == nil {
		_, err := rn.eng.Fire(ctx, r, CauseEvent, 0)
		return err
	}
	if rn.clips == nil {
		// No clip index wired, so the hub cannot see whether this camera
		// recorded. That is an unreadable input, NOT a malformed rule: the
		// distinction matters because Fire EXECUTES: routing this through it
		// would run the rule's action on every tick precisely because the hub
		// could not tell whether the trigger happened. So it takes
		// tickThreshold's path for an unreadable sensor — a recorded skip,
		// once per outage, that actuates nothing and still says why.
		rn.mu.Lock()
		reported := rn.clipBlind[r.ID]
		rn.clipBlind[r.ID] = true
		rn.mu.Unlock()
		if reported {
			return nil
		}
		now := rn.eng.nowUnix()
		return rn.eng.store.InsertRun(ctx, Run{
			ID: newID(), RuleID: r.ID, RuleName: r.Name, AccountID: r.AccountID,
			Cause: CauseEvent, Outcome: OutcomeSkipped,
			Reason:    "this hub has no clip index, so it cannot tell when the camera recorded",
			DeviceKey: cl.DeviceKey, StartedAt: now, FinishedAt: now,
		})
	}
	at, ok, err := rn.clips.NewestClipAt(ctx, r.AccountID, cl.DeviceKey)
	if err != nil {
		return err
	}
	if !ok {
		return nil // this camera has never recorded; nothing to compare against
	}

	rn.mu.Lock()
	seen, known := rn.clipAt[r.ID]
	rn.clipAt[r.ID] = at
	rn.mu.Unlock()

	if !known || at <= seen {
		return nil
	}
	_, err = rn.eng.Fire(ctx, r, CauseEvent, at)
	return err
}
