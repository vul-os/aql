package energy

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

// DefaultInterval is how often the poller reads a meter, and the value a
// newly-seen channel is registered with.
//
// Sixty seconds, for four reasons that all point the same way:
//
//   - Settlement. Utilities settle on 15- or 30-minute intervals and
//     time-of-use tariffs switch on the hour or half-hour. A 60s sample
//     resolves any of those boundaries to within one sample, so no billing
//     period ever depends on interpolation.
//   - Counter resolution. Meters report kWh to 0.01 or 0.001. At 60s a 3 kW
//     load accrues 0.05 kWh per sample — comfortably above the least
//     significant digit. Polling at 5s would put most deltas below the
//     counter's own quantum, producing a stair-step of zeros and jumps that
//     looks like signal and is not.
//   - Device tolerance. Meters are commonly Modbus or MQTT devices behind a
//     slow bridge; sub-10s polling of a fleet is how a bridge starts dropping
//     responses, which manufactures the gaps this package then has to report.
//   - Storage. One channel at 60s is ~525k rows a year, trivial for SQLite.
//     At 1s it is 31M, and raw samples would have to be discarded to stay
//     usable — which would mean discarding the evidence a dispute needs.
const DefaultInterval = 60 * time.Second

// DefaultSampleRetention bounds the raw samples table.
//
// Thirty days is chosen against what is actually lost: once a sample's hour
// bucket is rolled up, the delta carries the counter endpoints a bill dispute
// is argued from, and the raw reading underneath it is only useful for
// re-deriving a bucket. A month is long enough to notice a rollup was wrong
// and recompute it, and short enough that a meter polled every 60s does not
// quietly fill a Pi's SD card.
//
// It is a DEFAULT rather than an opt-in because the alternative is what
// existed before: PruneSamples written, carefully guarded, and never called
// by anything.
const DefaultSampleRetention = 30 * 24 * time.Hour

// DefaultGapTolerance is how long an interval between two consecutive samples
// may be before it stops counting as observed coverage: five missed polls at
// DefaultInterval. Below it, the span between two samples is treated as
// observed; above it, the interior is a gap and is reported as one.
const DefaultGapTolerance = 5 * DefaultInterval

// Store is the metering engine's persistence. Every method takes an accountID
// and scopes its SQL to it — the same app-layer tenancy contract as
// internal/store.
type Store struct {
	db DB
	// loc is the timezone rollup buckets are anchored to. A bill is a
	// local-time document: a "day" is midnight to midnight where the meter is,
	// and a DST day is 23 or 25 hours long.
	loc *time.Location
	now func() time.Time
	// interpolateCounterGaps spreads a counter's across-the-gap energy over
	// the buckets the gap covers, marking each estimated. Default true: with a
	// cumulative register the TOTAL across the gap is genuinely known, and
	// discarding it would make the month wrong in the other direction — a
	// silently low bill is no more honest than a silently high one. What is
	// unknown is the distribution, and that is what the estimated label says.
	//
	// It never applies to power channels; see the package doc.
	interpolateCounterGaps bool
}

// Option configures a Store.
type Option func(*Store)

// WithLocation anchors rollup buckets to a timezone. Default UTC.
func WithLocation(loc *time.Location) Option {
	return func(s *Store) {
		if loc != nil {
			s.loc = loc
		}
	}
}

// WithClock swaps the clock. For tests.
func WithClock(now func() time.Time) Option {
	return func(s *Store) {
		if now != nil {
			s.now = now
		}
	}
}

// WithCounterGapInterpolation turns gap-filling for counter channels on or
// off. When off, a gap's energy is still recorded in the delta table (so a
// long-period total from deltas stays correct) but is not attributed to any
// bucket, and the buckets stay QualityPartial.
func WithCounterGapInterpolation(on bool) Option {
	return func(s *Store) { s.interpolateCounterGaps = on }
}

// NewStore returns a metering store over db.
func NewStore(db DB, opts ...Option) *Store {
	s := &Store{
		db:                     db,
		loc:                    time.UTC,
		now:                    time.Now,
		interpolateCounterGaps: true,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Location is the timezone rollups are anchored to.
func (s *Store) Location() *time.Location { return s.loc }

// TZ is the stored name of the rollup timezone.
func (s *Store) TZ() string { return s.loc.String() }

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

// counterMetrics maps the canonical cumulative-register metric names onto the
// scale that converts them to kWh. A metric outside this table and
// powerMetrics is not energy and is not ingested — the engine would rather
// drop a reading it cannot interpret than store it under a guess.
var counterMetrics = map[string]float64{
	"kwh":           1,
	"kwh_import":    1,
	"kwh_export":    1,
	"kwh_charge":    1,
	"kwh_discharge": 1,
	"kwh_produced":  1,
	"kwh_consumed":  1,
	"wh":            0.001,
	"wh_import":     0.001,
	"wh_export":     0.001,
}

// powerMetrics maps instantaneous-power metric names onto the scale that
// converts them to kW. "kw" is the vocabulary devices.Reading names for
// energy devices.
var powerMetrics = map[string]float64{
	"kw": 1,
	"w":  0.001,
}

// Classify reports how a metric name would be ingested: its kind, the unit
// scale, and the flow implied by the metric's own name. It returns false for a
// metric this package does not recognise as energy.
//
// Flow comes from the CANONICAL METRIC name (an "_export" or "_charge" suffix
// is energy leaving the site), never from a device label. Source is never
// inferred at all — an auto-registered channel is SourceUnattributed until an
// operator says otherwise.
func Classify(metric string) (kind Kind, scale float64, flow Flow, ok bool) {
	m := strings.ToLower(strings.TrimSpace(metric))
	flow = FlowSupply
	if strings.HasSuffix(m, "_export") || strings.HasSuffix(m, "_charge") {
		flow = FlowSink
	}
	if sc, found := counterMetrics[m]; found {
		return KindCounter, sc, flow, true
	}
	if sc, found := powerMetrics[m]; found {
		return KindPower, sc, flow, true
	}
	return "", 0, "", false
}

// UpsertChannel declares or corrects a channel's attribution. Re-declaring an
// existing channel updates it in place; the samples and deltas already stored
// under it are untouched, and because rollups do not copy the attribution, a
// correction takes effect on the next read of every report.
func (s *Store) UpsertChannel(ctx context.Context, accountID string, c Channel) error {
	if accountID == "" {
		return errInvalid("account id is empty")
	}
	if c.Scale == 0 {
		c.Scale = 1
	}
	if c.IntervalSeconds == 0 {
		c.IntervalSeconds = int64(DefaultInterval / time.Second)
	}
	if c.GapToleranceSeconds == 0 {
		c.GapToleranceSeconds = int64(DefaultGapTolerance / time.Second)
	}
	if err := c.validate(); err != nil {
		return err
	}
	t := s.now().Unix()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO energy_channels
		    (account_id, device_key, metric, kind, source, flow, label, scale,
		     counter_max, max_kw, interval_seconds, gap_tolerance_seconds,
		     enabled, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT (account_id, device_key, metric) DO UPDATE SET
		    kind = excluded.kind,
		    source = excluded.source,
		    flow = excluded.flow,
		    label = excluded.label,
		    scale = excluded.scale,
		    counter_max = excluded.counter_max,
		    max_kw = excluded.max_kw,
		    interval_seconds = excluded.interval_seconds,
		    gap_tolerance_seconds = excluded.gap_tolerance_seconds,
		    enabled = excluded.enabled,
		    updated_at = excluded.updated_at`,
		accountID, c.DeviceKey, c.Metric, string(c.Kind), string(c.Source), string(c.Flow),
		c.Label, c.Scale, nullPositive(c.CounterMax), nullPositive(c.MaxKW),
		c.IntervalSeconds, c.GapToleranceSeconds, boolInt(c.Enabled), t, t)
	return err
}

func nullPositive(v float64) sql.NullFloat64 {
	if v <= 0 {
		return sql.NullFloat64{}
	}
	return sql.NullFloat64{Float64: v, Valid: true}
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

const channelCols = `account_id, device_key, metric, kind, source, flow, label, scale,
	counter_max, max_kw, interval_seconds, gap_tolerance_seconds, enabled, created_at, updated_at`

func scanChannel(sc interface{ Scan(...any) error }) (Channel, error) {
	var c Channel
	var kind, source, flow string
	var cmax, maxkw sql.NullFloat64
	var enabled int
	var created, updated int64
	if err := sc.Scan(&c.AccountID, &c.DeviceKey, &c.Metric, &kind, &source, &flow, &c.Label,
		&c.Scale, &cmax, &maxkw, &c.IntervalSeconds, &c.GapToleranceSeconds, &enabled,
		&created, &updated); err != nil {
		return Channel{}, err
	}
	c.Kind, c.Source, c.Flow = Kind(kind), Source(source), Flow(flow)
	c.CounterMax, c.MaxKW = cmax.Float64, maxkw.Float64
	c.Enabled = enabled != 0
	c.CreatedAt = time.Unix(created, 0).UTC()
	c.UpdatedAt = time.Unix(updated, 0).UTC()
	return c, nil
}

// Channels lists every channel in the account, ordered by device then metric.
func (s *Store) Channels(ctx context.Context, accountID string) ([]Channel, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+channelCols+` FROM energy_channels WHERE account_id = ?
		 ORDER BY device_key, metric`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Channel
	for rows.Next() {
		c, err := scanChannel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ChannelByKey resolves one channel within the account.
func (s *Store) ChannelByKey(ctx context.Context, accountID, deviceKey, metric string) (Channel, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+channelCols+` FROM energy_channels
		 WHERE account_id = ? AND device_key = ? AND metric = ?`, accountID, deviceKey, metric)
	return scanChannel(row)
}

// ensureChannel returns the channel, auto-registering it as unattributed the
// first time a metric is seen. Auto-registration records energy the operator
// has not classified rather than dropping it; SourceUnattributed keeps it out
// of the grid/solar/battery mix until someone says where it belongs.
func (s *Store) ensureChannel(ctx context.Context, accountID, deviceKey, metric string) (Channel, error) {
	c, err := s.ChannelByKey(ctx, accountID, deviceKey, metric)
	if err == nil {
		return c, nil
	}
	if err != sql.ErrNoRows {
		return Channel{}, err
	}
	kind, scale, flow, ok := Classify(metric)
	if !ok {
		return Channel{}, errInvalid("metric %q is not a recognised energy metric", metric)
	}
	c = Channel{
		DeviceKey:           deviceKey,
		Metric:              metric,
		Kind:                kind,
		Source:              SourceUnattributed,
		Flow:                flow,
		Scale:               scale,
		IntervalSeconds:     int64(DefaultInterval / time.Second),
		GapToleranceSeconds: int64(DefaultGapTolerance / time.Second),
		Enabled:             true,
	}
	if err := s.UpsertChannel(ctx, accountID, c); err != nil {
		return Channel{}, err
	}
	return s.ChannelByKey(ctx, accountID, deviceKey, metric)
}
