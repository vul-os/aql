package energy

import (
	"context"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// DefaultReadTimeout bounds one device read. A meter that has stopped
// answering must not hold the whole poll cycle open behind it; the honest
// outcome of a timeout is a gap in that channel, and the other meters keep
// their coverage.
const DefaultReadTimeout = 10 * time.Second

// DeviceError is one device's failure during a poll.
type DeviceError struct {
	DeviceKey string
	Err       error
}

// PollResult is one poll cycle.
type PollResult struct {
	// Meters is devices declaring CapMeter at the time of the poll.
	Meters int
	// Read is meters that answered.
	Read int
	// Failed is meters that did not. Each one is a gap in its channels — the
	// poller writes NOTHING for a meter it could not reach, because a zero
	// sample from an unreachable meter is a fabricated observation and it
	// would be indistinguishable from a real zero forever after.
	Failed int
	// Foreign is readings a driver returned under a device id other than the
	// one that was asked for. They are dropped: attributing a reading to the
	// wrong meter is worse than losing it.
	Foreign int
	// Unattributed is meters skipped because their ownership could not be
	// established — the lookup errored. Counted rather than absorbed into the
	// default account, for the reason WithOwnerLookup gives: a failed lookup
	// has not shown a meter is unclaimed, and filing it under the configured
	// account on that basis would be inventing an attribution.
	Unattributed int
	Ingest       IngestResult
	Rollup       RollupResult
	// Pruned is raw samples deleted this cycle by the retention window.
	// Always 0 when retention is off.
	Pruned int64
	// PruneErr is why retention did not run, when it did not. Kept separate
	// from Errors because those are per-DEVICE gaps in the record, and a
	// failure to delete old rows is neither a device's fault nor a gap.
	PruneErr error
	Errors   []DeviceError
}

// Poller reads CapMeter devices through the registry on a fixed interval and
// feeds them to the store.
//
// It only ever calls Registry.Read. CapMeter offers a single verb, `read`, at
// TierRead (internal/devices/capability.go), so there is no path from here to
// anything that actuates.
type Poller struct {
	reg         *devices.Registry
	st          *Store
	accountID   string
	interval    time.Duration
	readTimeout time.Duration
	// rollupBudget caps hour buckets recomputed per cycle so one enormous
	// backfill cannot starve the polling loop. 0 means no cap.
	rollupBudget int

	// sampleRetention is how long raw samples are kept. Zero means keep them
	// forever, which was the ONLY behaviour before this existed: PruneSamples
	// was written, documented and never called, so a hub polling a meter every
	// few seconds grew its samples table without bound. On the Raspberry Pi
	// this product targets that is a disk that fills, silently, months in.
	//
	// Deltas are never pruned regardless — they are the evidence a bill
	// dispute is argued from. This only drops the bulk raw readings that
	// nothing needs once their deltas exist.
	sampleRetention time.Duration
	now             func() time.Time

	// owner resolves which account claimed a device, or reports that nobody
	// has. Nil means "do not ask", which is the behaviour this poller had
	// before ownership existed: every meter's samples go to accountID.
	//
	// See WithOwnerLookup for why the fallback is what it is.
	owner OwnerFunc
}

// OwnerFunc reports the account that has claimed deviceKey.
//
// claimed=false means nobody has, which is a different answer from an error
// and is treated differently: unclaimed meters fall back to the poller's
// configured account, an error does not.
type OwnerFunc func(ctx context.Context, deviceKey string) (accountID string, claimed bool, err error)

// WithOwnerLookup routes each meter's samples to the account that claimed it.
//
// Without this, PollOnce polled every CapMeter device the registry reported
// and wrote all of them under one process-wide -energy-account. On a hub
// serving one household that is exactly right and nothing changes. On a hub
// serving several it was wrong in both directions at once: an account that
// claimed a meter saw NOTHING for it, while the configured account's Energy
// screen showed every meter on the hub, including ones it had never claimed.
//
// The fallback for an UNCLAIMED meter is the configured account, deliberately.
// A hub that predates ownership has claimed nothing, and a hub whose operator
// has not got round to claiming is in the same position; dropping their
// samples on the floor to be principled would lose real metering history that
// nothing else records. An unclaimed meter is not evidence of a tenancy
// problem — it is evidence that nobody has said whose it is yet.
//
// An ERROR is different and is never absorbed: a lookup that failed has not
// established that a meter is unclaimed, and writing it to the default
// account on that basis would be inventing an attribution. Those samples are
// skipped and counted, so a persistent failure shows up as a meter that
// stopped reporting rather than as one silently filed under the wrong owner.
func WithOwnerLookup(fn OwnerFunc) PollerOption {
	return func(p *Poller) { p.owner = fn }
}

// PollerOption configures a Poller.
type PollerOption func(*Poller)

// WithInterval sets the polling interval. See DefaultInterval for why 60s.
func WithInterval(d time.Duration) PollerOption {
	return func(p *Poller) {
		if d > 0 {
			p.interval = d
		}
	}
}

// WithReadTimeout bounds one device read.
//
// Nothing in production calls this: the hub constructs the poller and takes the
// default. It is not a test seam like WithClock — the timeout is a real tunable
// and the tests that set it prove the bounded path works — it is a knob with no
// surface to turn it from. If a deployment ever needs a different value, the
// missing piece is a config field, not this function.
func WithReadTimeout(d time.Duration) PollerOption {
	return func(p *Poller) {
		if d > 0 {
			p.readTimeout = d
		}
	}
}

// WithRollupBudget caps hour buckets recomputed per cycle.
//
// Same standing as WithReadTimeout above: real tunable, exercised by tests,
// never set by the hub, no config surface reaching it.
func WithRollupBudget(n int) PollerOption {
	return func(p *Poller) { p.rollupBudget = n }
}

// WithSampleRetention keeps raw samples for d and drops older ones at the end
// of each cycle. Zero (the default) keeps them forever.
//
// Pruning runs AFTER the rollup in the same cycle, which is not incidental:
// PruneSamples refuses while any bucket at or before the cutoff is still
// dirty, so rolling up first is what lets the window actually advance instead
// of being permanently blocked by its own backlog.
func WithSampleRetention(d time.Duration) PollerOption {
	return func(p *Poller) {
		if d > 0 {
			p.sampleRetention = d
		}
	}
}

// NewPoller returns a poller for one account's meters.
func NewPoller(reg *devices.Registry, st *Store, accountID string, opts ...PollerOption) *Poller {
	p := &Poller{
		reg:          reg,
		st:           st,
		accountID:    accountID,
		interval:     DefaultInterval,
		readTimeout:  DefaultReadTimeout,
		rollupBudget: 2000,
		now:          st.now,
	}
	for _, o := range opts {
		o(p)
	}
	return p
}

// Interval is the configured polling interval.
func (p *Poller) Interval() time.Duration { return p.interval }

// PollOnce reads every CapMeter device once, ingests what came back, and
// drains the rollup queue.
//
// A device error is recorded and the poll continues: one unreachable meter
// must not cost the rest of the site its coverage.
func (p *Poller) PollOnce(ctx context.Context) (PollResult, error) {
	var res PollResult
	// Grouped by the account each meter's history belongs in, so one Ingest
	// per account rather than one per meter.
	byAccount := map[string][]Sample{}
	now := p.now()

	for _, d := range p.reg.Devices() {
		if !d.Device.Has(devices.CapMeter) {
			continue
		}
		res.Meters++
		rctx, cancel := context.WithTimeout(ctx, p.readTimeout)
		readings, err := p.reg.Read(rctx, d.Key)
		cancel()
		if err != nil {
			res.Failed++
			res.Errors = append(res.Errors, DeviceError{DeviceKey: d.Key, Err: err})
			continue
		}
		res.Read++
		kept := readings[:0:0]
		for _, r := range readings {
			if r.DeviceID != "" && devices.Key(d.Driver, r.DeviceID) != d.Key {
				res.Foreign++
				continue
			}
			kept = append(kept, r)
		}
		// Which account's history do these belong in? Without a lookup this
		// is the configured account for everything, which is what it always
		// was and is correct on a single-household hub.
		target := p.accountID
		if p.owner != nil {
			acct, claimed, err := p.owner(ctx, d.Key)
			switch {
			case err != nil:
				res.Unattributed++
				continue
			case claimed:
				target = acct
			}
		}
		byAccount[target] = append(byAccount[target], SamplesFromReadings(d.Key, kept, now)...)
	}

	for target, batch := range byAccount {
		if len(batch) == 0 {
			continue
		}
		ing, err := p.st.Ingest(ctx, target, batch)
		res.Ingest.Accepted += ing.Accepted
		res.Ingest.Duplicate += ing.Duplicate
		res.Ingest.Skipped += ing.Skipped
		res.Ingest.Channels += ing.Channels
		res.Ingest.Deltas += ing.Deltas
		if err != nil {
			return res, err
		}
	}
	roll, err := p.st.Rollup(ctx, p.accountID, p.rollupBudget)
	res.Rollup = roll
	if err != nil {
		return res, err
	}

	if p.sampleRetention > 0 {
		// A refusal here is not a cycle failure. PruneSamples declines while a
		// bucket at or before the cutoff is still dirty, which is the correct
		// answer and resolves itself once the rollup backlog clears — turning
		// it into an error would make a healthy hub look broken every time it
		// fell behind.
		res.Pruned, res.PruneErr = p.st.PruneSamples(ctx, p.accountID, now.Add(-p.sampleRetention))
	}
	return res, nil
}

// Run polls until ctx is cancelled. It polls immediately, then on the
// interval. A cycle that errors is reported through onCycle (when non-nil) and
// the loop continues: a transient database or driver failure should cost one
// cycle's samples, which shows up as a gap, not the whole metering service.
func (p *Poller) Run(ctx context.Context, onCycle func(PollResult, error)) error {
	t := time.NewTicker(p.interval)
	defer t.Stop()
	for {
		res, err := p.PollOnce(ctx)
		if onCycle != nil {
			onCycle(res, err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
	}
}
