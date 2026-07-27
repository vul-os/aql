package energy

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// DB is the narrow slice of database/sql this package uses. *sql.DB and
// *sql.Tx both satisfy it, so a caller can hand the engine a transaction.
type DB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// ErrNotFound is returned when a row does not exist within the caller's
// account scope. A row belonging to another account is indistinguishable from
// one that does not exist — that is the tenancy contract this package shares
// with internal/store.
var ErrNotFound = sql.ErrNoRows

type invalidError struct{ msg string }

func (e invalidError) Error() string { return e.msg }

func errInvalid(format string, a ...any) error {
	return invalidError{msg: "energy: " + fmt.Sprintf(format, a...)}
}

// IsInvalid reports whether err came from validation rather than from the
// database. Callers map it to 4xx; everything else is 5xx.
func IsInvalid(err error) bool {
	var e invalidError
	return errors.As(err, &e)
}

// Kind is how a channel's readings become energy.
type Kind string

const (
	// KindCounter is a cumulative kWh register. Energy is the difference
	// between consecutive readings, so a comms gap costs time resolution but
	// not energy.
	KindCounter Kind = "counter"
	// KindPower is an instantaneous kW reading. Energy is the trapezoid
	// between consecutive readings, so a comms gap loses the energy outright.
	KindPower Kind = "power"
)

// Source is where energy came from or went. It is DECLARED by an operator, not
// inferred from a device's name.
type Source string

const (
	SourceGrid      Source = "grid"
	SourceSolar     Source = "solar"
	SourceBattery   Source = "battery"
	SourceGenerator Source = "generator"
	// SourceLoad is a sub-meter measuring consumption downstream of a supply
	// point. Load channels are reported separately and are never summed into
	// the source mix: their energy is already counted at the source that
	// supplied it.
	SourceLoad Source = "load"
	// SourceUnattributed is a channel nobody has classified yet. Its energy is
	// recorded and reported as its own bucket rather than dropped or folded
	// into a source it might not belong to.
	SourceUnattributed Source = "unattributed"
)

func (s Source) valid() bool {
	switch s {
	case SourceGrid, SourceSolar, SourceBattery, SourceGenerator, SourceLoad, SourceUnattributed:
		return true
	}
	return false
}

// Flow is a channel's direction relative to the site.
type Flow string

const (
	// FlowSupply is energy arriving: grid import, solar production, battery
	// discharge.
	FlowSupply Flow = "supply"
	// FlowSink is energy leaving or being stored: grid export, battery charge.
	FlowSink Flow = "sink"
)

func (f Flow) valid() bool { return f == FlowSupply || f == FlowSink }

// Grain is a rollup bucket size.
type Grain string

const (
	GrainHour  Grain = "hour"
	GrainDay   Grain = "day"
	GrainMonth Grain = "month"
)

func (g Grain) valid() bool { return g == GrainHour || g == GrainDay || g == GrainMonth }

// DeltaQuality records how one energy difference was obtained. It is the audit
// trail: a bill dispute reads this, not a chart.
type DeltaQuality string

const (
	// DeltaMeasured — counter channel, both endpoints in one monotonic run.
	DeltaMeasured DeltaQuality = "measured"
	// DeltaWrap — the register rolled over a declared maximum.
	DeltaWrap DeltaQuality = "wrap"
	// DeltaReset — the register restarted. The figure is a LOWER BOUND;
	// energy accumulated before the reset instant is unrecoverable.
	DeltaReset DeltaQuality = "reset"
	// DeltaIntegrated — power channel, normal interval, trapezoidal.
	DeltaIntegrated DeltaQuality = "integrated"
	// DeltaEstimated — the figure did not come from two observed samples at
	// all. Reserved for imported or back-filled energy; this engine never
	// produces it, because everything it writes is derived from readings it
	// actually holds. It exists so an import path has somewhere honest to put
	// a number, rather than being tempted to call it measured.
	DeltaEstimated DeltaQuality = "estimated"
)

// Delta.Quality answers HOW a number was derived; Delta.SpansGap answers
// WHETHER the interval it covers was observed. They are orthogonal on purpose:
// a counter delta across a two-hour outage is genuinely `measured` — the
// register did not forget — while still spanning time nobody watched, and
// collapsing the two facts into one label would lose whichever one was asked
// about second.

// Quality is a rollup bucket's honesty label — the single field a renderer may
// branch on.
type Quality string

const (
	// QualityComplete — fully covered, no reset, nothing interpolated.
	QualityComplete Quality = "complete"
	// QualityPartial — a gap exists and was NOT filled, or a counter reset
	// falls inside. KWh is a floor; the true value is higher. Render the
	// missing span as absent, never as zero.
	QualityPartial Quality = "partial"
	// QualityEstimated — a gap exists and WAS filled by interpolation.
	// EstimatedKWh of the total is a guess about time nobody observed.
	QualityEstimated Quality = "estimated"
	// QualityEmpty — no evidence at all. KWh is nil.
	QualityEmpty Quality = "empty"
)

// AtSource says whose clock a sample's timestamp came from.
const (
	AtSourceDevice  = "device"
	AtSourceGateway = "gateway"
)

// Channel is one reading stream and its attribution.
type Channel struct {
	AccountID string
	DeviceKey string // devices.Key(driverID, deviceID), e.g. "mqtt:meter-main"
	Metric    string // devices.Reading.Metric, e.g. "kwh", "kw"

	Kind   Kind
	Source Source
	Flow   Flow
	Label  string
	// Scale converts the device's raw units into kWh (counter) or kW (power).
	// 1 for a meter reporting kWh/kW, 0.001 for one reporting Wh/W.
	Scale float64
	// CounterMax is the value at which a cumulative register rolls over. Zero
	// means unknown, and unknown means a backwards step is treated as a reset
	// rather than a guessed rollover.
	CounterMax float64
	// MaxKW is a plausibility ceiling used only to sanity-check a candidate
	// wrap. Zero disables the check.
	MaxKW float64
	// IntervalSeconds is how often a sample is expected.
	IntervalSeconds int64
	// GapToleranceSeconds is how long an interval between two consecutive
	// samples may be before it stops counting as observed coverage.
	GapToleranceSeconds int64
	Enabled             bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (c Channel) validate() error {
	if c.DeviceKey == "" {
		return errInvalid("channel device key is empty")
	}
	if c.Metric == "" {
		return errInvalid("channel metric is empty")
	}
	if c.Kind != KindCounter && c.Kind != KindPower {
		return errInvalid("channel %s/%s: unknown kind %q", c.DeviceKey, c.Metric, string(c.Kind))
	}
	if !c.Source.valid() {
		return errInvalid("channel %s/%s: unknown source %q", c.DeviceKey, c.Metric, string(c.Source))
	}
	if !c.Flow.valid() {
		return errInvalid("channel %s/%s: unknown flow %q", c.DeviceKey, c.Metric, string(c.Flow))
	}
	if c.Scale <= 0 {
		return errInvalid("channel %s/%s: scale must be positive", c.DeviceKey, c.Metric)
	}
	if c.CounterMax < 0 || c.MaxKW < 0 {
		return errInvalid("channel %s/%s: counter max and max kw must not be negative", c.DeviceKey, c.Metric)
	}
	if c.IntervalSeconds <= 0 {
		return errInvalid("channel %s/%s: interval must be positive", c.DeviceKey, c.Metric)
	}
	if c.GapToleranceSeconds < c.IntervalSeconds {
		return errInvalid("channel %s/%s: gap tolerance must be at least the sampling interval", c.DeviceKey, c.Metric)
	}
	return nil
}

// Sample is one stored observation, in the device's own units.
type Sample struct {
	DeviceKey string
	Metric    string
	At        time.Time
	// Value is the raw reading. HasValue is false for a non-numeric reading,
	// which is stored (as Text) but produces no energy.
	Value    float64
	HasValue bool
	Text     string
	AtSource string
}

// Delta is one energy difference between two consecutive samples, with the raw
// endpoints that produced it retained so the figure can be re-derived.
type Delta struct {
	DeviceKey string
	Metric    string
	From, To  time.Time
	KWh       float64
	Quality   DeltaQuality
	// SpansGap marks a delta whose interval exceeds the channel's tolerance.
	// It contributes energy but NO coverage: its interior was not observed and
	// must keep showing as a gap.
	SpansGap  bool
	FromValue float64
	ToValue   float64
}

// Bucket is one rollup row.
//
// KWh is a pointer on purpose. A period with no evidence is nil, not 0, so a
// renderer cannot accidentally draw "the meter was unreachable" as "the site
// used nothing".
type Bucket struct {
	DeviceKey string
	Metric    string
	Grain     Grain
	TZ        string
	Start     time.Time
	End       time.Time

	KWh          *float64
	EstimatedKWh float64

	CoverageSeconds int64
	ExpectedSeconds int64

	SampleCount int64
	// DeltaCount counts deltas overlapping the bucket. A delta crossing a
	// boundary is counted in both buckets it touches; it is a diagnostic, not
	// a conserved quantity.
	DeltaCount int64
	// ResetCount > 0 means KWh is a lower bound however complete the coverage
	// looks.
	ResetCount int64

	// Power statistics, populated only for KindPower channels: a counter has
	// no instantaneous reading to take a minimum of, and deriving one from
	// kWh/hours would be a different quantity wearing the same name.
	MinKW  *float64
	MaxKW  *float64
	MeanKW *float64

	Quality Quality
}

// GapSeconds is how much of the bucket was not observed.
func (b Bucket) GapSeconds() int64 {
	g := b.ExpectedSeconds - b.CoverageSeconds
	if g < 0 {
		return 0
	}
	return g
}

// CoverageRatio is observed seconds over expected seconds, 0..1.
func (b Bucket) CoverageRatio() float64 {
	if b.ExpectedSeconds <= 0 {
		return 0
	}
	r := float64(b.CoverageSeconds) / float64(b.ExpectedSeconds)
	if r > 1 {
		return 1
	}
	return r
}

// MeasuredKWh is the part of KWh that was actually measured — the floor below
// which the true figure cannot be. Returns 0 for an empty bucket, but callers
// rendering a value must branch on KWh being nil first: 0 here means "no
// measured energy", which is not the same claim as "no energy".
func (b Bucket) MeasuredKWh() float64 {
	if b.KWh == nil {
		return 0
	}
	m := *b.KWh - b.EstimatedKWh
	if m < 0 {
		return 0
	}
	return m
}

// Complete reports whether the bucket is a figure that can be billed on
// without a caveat.
func (b Bucket) Complete() bool { return b.Quality == QualityComplete }

func fptr(v float64) *float64 { return &v }

func nullF(n sql.NullFloat64) *float64 {
	if !n.Valid {
		return nil
	}
	return fptr(n.Float64)
}

func toNull(p *float64) sql.NullFloat64 {
	if p == nil {
		return sql.NullFloat64{}
	}
	return sql.NullFloat64{Float64: *p, Valid: true}
}
