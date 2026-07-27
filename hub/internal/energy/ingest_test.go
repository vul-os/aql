package energy

import (
	"context"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

func TestCounterDeltasAreMeasured(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)

	// 0, 15, 30, 45, 60 minutes; 2 kWh per quarter hour.
	for i := 0; i <= 4; i++ {
		mustIngest(t, s, acc, sampleAt("mqtt:meter", "kwh", time.Duration(i)*15*time.Minute, float64(i)*2))
	}
	ds := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if len(ds) != 4 {
		t.Fatalf("expected 4 deltas, got %d", len(ds))
	}
	for _, d := range ds {
		if d.Quality != DeltaMeasured {
			t.Errorf("delta %v: quality %q, want measured", d.To, d.Quality)
		}
		if d.SpansGap {
			t.Errorf("delta %v: marked as spanning a gap at the configured interval", d.To)
		}
		approx(t, d.KWh, 2, "delta kwh")
	}

	mustRollup(t, s, acc)
	hs := hours(t, s, acc, "mqtt:meter", 2)
	wantKWh(t, hs[0], 8)
	wantQuality(t, hs[0], QualityComplete)
	if hs[0].GapSeconds() != 0 {
		t.Errorf("hour 0 gap %ds, want 0", hs[0].GapSeconds())
	}
	if hs[0].EstimatedKWh != 0 {
		t.Errorf("hour 0 estimated %v, want 0", hs[0].EstimatedKWh)
	}
}

// A meter reporting kWh-since-install restarts on power loss. The engine must
// record what accumulated since the restart as a LOWER BOUND, never a huge
// negative delta, and must flag the period.
func TestCounterResetIsNotNegativeEnergy(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)

	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 100),
		sampleAt("mqtt:meter", "kwh", 15*time.Minute, 102),
		// Power loss: the register restarts and has since accrued 0.5 kWh.
		sampleAt("mqtt:meter", "kwh", 30*time.Minute, 0.5),
	)
	ds := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if len(ds) != 2 {
		t.Fatalf("expected 2 deltas, got %d", len(ds))
	}
	if ds[1].Quality != DeltaReset {
		t.Fatalf("second delta quality %q, want reset", ds[1].Quality)
	}
	if ds[1].KWh < 0 {
		t.Fatalf("reset produced negative energy %v", ds[1].KWh)
	}
	approx(t, ds[1].KWh, 0.5, "post-reset lower bound")
	// The raw endpoints are retained so the figure can be re-derived in a
	// dispute.
	approx(t, ds[1].FromValue, 102, "reset from_value")
	approx(t, ds[1].ToValue, 0.5, "reset to_value")

	mustRollup(t, s, acc)
	h := hours(t, s, acc, "mqtt:meter", 1)[0]
	if h.ResetCount != 1 {
		t.Errorf("hour reset count %d, want 1", h.ResetCount)
	}
	// A reset makes the figure a floor, so the bucket must not claim to be
	// complete even though every second of it is covered.
	wantQuality(t, h, QualityPartial)
	wantKWh(t, h, 2.5)
}

func TestCounterWrapIsRecoveredWhenDeclared(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", func(c *Channel) {
		c.CounterMax = 999
		c.MaxKW = 100
	})
	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 990),
		sampleAt("mqtt:meter", "kwh", 15*time.Minute, 10),
	)
	ds := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if len(ds) != 1 {
		t.Fatalf("expected 1 delta, got %d", len(ds))
	}
	if ds[0].Quality != DeltaWrap {
		t.Fatalf("quality %q, want wrap", ds[0].Quality)
	}
	approx(t, ds[0].KWh, 19, "wrap kwh")
}

// Without a declared rollover point the two cases cannot be told apart, so the
// engine must take the conservative one rather than invent a maximum.
func TestBackwardsCounterWithoutDeclaredMaxIsAReset(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil) // CounterMax unset
	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 990),
		sampleAt("mqtt:meter", "kwh", 15*time.Minute, 10),
	)
	ds := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if ds[0].Quality != DeltaReset {
		t.Fatalf("quality %q, want reset — an undeclared rollover must not be assumed", ds[0].Quality)
	}
	approx(t, ds[0].KWh, 10, "reset lower bound")
}

// A declared rollover that would imply an impossible amount of energy is not a
// rollover. MaxKW is what stops an arbitrary backwards jump being laundered
// into a plausible-looking wrap.
func TestImplausibleWrapFallsBackToReset(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", func(c *Channel) {
		c.CounterMax = 100000
		c.MaxKW = 1 // 0.25 kWh possible in 15 minutes
	})
	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 99999),
		sampleAt("mqtt:meter", "kwh", 15*time.Minute, 5),
	)
	ds := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if ds[0].Quality != DeltaReset {
		t.Fatalf("quality %q, want reset: a 6 kWh wrap is impossible at 1 kW over 15 minutes", ds[0].Quality)
	}
	approx(t, ds[0].KWh, 5, "reset lower bound")
}

// Samples do not arrive in order. A sample landing between two already
// processed ones must split exactly the pair it belongs to, leave the rest
// alone, and conserve the total.
func TestOutOfOrderSampleResplitsTheChain(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)

	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 0),
		sampleAt("mqtt:meter", "kwh", 30*time.Minute, 10),
		sampleAt("mqtt:meter", "kwh", 45*time.Minute, 12),
	)
	before := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if len(before) != 2 {
		t.Fatalf("expected 2 deltas before the late sample, got %d", len(before))
	}

	// The 15-minute sample arrives late.
	res := mustIngest(t, s, acc, sampleAt("mqtt:meter", "kwh", 15*time.Minute, 4))
	if res.Accepted != 1 {
		t.Fatalf("late sample not accepted: %+v", res)
	}
	after := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if len(after) != 3 {
		t.Fatalf("expected 3 deltas after the split, got %d", len(after))
	}
	approx(t, after[0].KWh, 4, "0→15m")
	approx(t, after[1].KWh, 6, "15m→30m")
	approx(t, after[2].KWh, 2, "30m→45m")
	// The pair beyond the insertion point must be untouched, not re-derived
	// into something different.
	if !after[2].From.Equal(before[1].From) || !after[2].To.Equal(before[1].To) {
		t.Errorf("delta beyond the insertion point was disturbed: %v→%v became %v→%v",
			before[1].From, before[1].To, after[2].From, after[2].To)
	}

	mustRollup(t, s, acc)
	h := hours(t, s, acc, "mqtt:meter", 1)[0]
	wantKWh(t, h, 12)
}

// A re-delivered sample must not rewrite the archive.
func TestDuplicateSampleIsIgnoredAndDoesNotRewriteHistory(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)
	mustIngest(t, s, acc, sampleAt("mqtt:meter", "kwh", 0, 5))
	res := mustIngest(t, s, acc, sampleAt("mqtt:meter", "kwh", 0, 999))
	if res.Duplicate != 1 || res.Accepted != 0 {
		t.Fatalf("re-delivery: %+v, want 1 duplicate and 0 accepted", res)
	}
	var v float64
	if err := s.db.QueryRowContext(context.Background(),
		`SELECT value FROM energy_samples WHERE account_id = ? AND at = ?`,
		acc, base.Unix()).Scan(&v); err != nil {
		t.Fatalf("read back: %v", err)
	}
	approx(t, v, 5, "stored value")
}

// A meter that only reports instantaneous kW loses energy outright across a
// gap: nothing later recovers it, so the engine must produce no delta rather
// than draw a shape across the missing period.
func TestPowerChannelProducesNoDeltaAcrossAGap(t *testing.T) {
	s, acc, _ := newStore(t)
	if err := s.UpsertChannel(context.Background(), acc, Channel{
		DeviceKey: "mqtt:inv", Metric: "kw", Kind: KindPower,
		Source: SourceSolar, Flow: FlowSupply, Scale: 1,
		IntervalSeconds: 60, GapToleranceSeconds: 300, Enabled: true,
	}); err != nil {
		t.Fatalf("UpsertChannel: %v", err)
	}
	mustIngest(t, s, acc,
		sampleAt("mqtt:inv", "kw", 0, 4),
		sampleAt("mqtt:inv", "kw", 2*time.Hour, 4),
	)
	if ds := deltaRows(t, s, acc, "mqtt:inv", "kw"); len(ds) != 0 {
		t.Fatalf("power channel invented %d deltas across a two-hour gap", len(ds))
	}
	mustRollup(t, s, acc)
	hs := hours(t, s, acc, "mqtt:inv", 3)
	for _, h := range hs {
		wantNilKWh(t, h)
	}
	wantQuality(t, hs[1], QualityEmpty)
}

func TestPowerChannelIntegratesWithinTolerance(t *testing.T) {
	s, acc, _ := newStore(t)
	if err := s.UpsertChannel(context.Background(), acc, Channel{
		DeviceKey: "mqtt:inv", Metric: "kw", Kind: KindPower,
		Source: SourceSolar, Flow: FlowSupply, Scale: 1,
		IntervalSeconds: 900, GapToleranceSeconds: 1800, Enabled: true,
	}); err != nil {
		t.Fatalf("UpsertChannel: %v", err)
	}
	for i := 0; i <= 4; i++ {
		mustIngest(t, s, acc, sampleAt("mqtt:inv", "kw", time.Duration(i)*15*time.Minute, 4))
	}
	ds := deltaRows(t, s, acc, "mqtt:inv", "kw")
	if len(ds) != 4 {
		t.Fatalf("expected 4 integrated deltas, got %d", len(ds))
	}
	for _, d := range ds {
		if d.Quality != DeltaIntegrated {
			t.Errorf("quality %q, want integrated", d.Quality)
		}
		approx(t, d.KWh, 1, "trapezoid over 15 minutes at 4 kW")
	}
	mustRollup(t, s, acc)
	h := hours(t, s, acc, "mqtt:inv", 1)[0]
	wantKWh(t, h, 4)
	wantQuality(t, h, QualityComplete)
	if h.MeanKW == nil || *h.MeanKW != 4 {
		t.Errorf("mean kW %v, want 4", h.MeanKW)
	}
}

// A reading with no clock of its own is stamped by the gateway, and the weaker
// provenance is recorded rather than hidden.
func TestUntimestampedReadingIsMarkedGatewayStamped(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)
	now := base.Add(7 * time.Minute)
	samples := SamplesFromReadings("mqtt:meter", []devices.Reading{
		{DeviceID: "meter", Metric: "kwh", Value: 3},
	}, now)
	if len(samples) != 1 || samples[0].AtSource != AtSourceGateway {
		t.Fatalf("expected a gateway-stamped sample, got %+v", samples)
	}
	if !samples[0].At.Equal(now) {
		t.Errorf("At %v, want %v", samples[0].At, now)
	}
	mustIngest(t, s, acc, samples...)
	var src string
	if err := s.db.QueryRowContext(context.Background(),
		`SELECT at_source FROM energy_samples WHERE account_id = ? AND at = ?`,
		acc, now.Unix()).Scan(&src); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if src != AtSourceGateway {
		t.Errorf("at_source %q, want %q", src, AtSourceGateway)
	}
}

// A non-numeric reading is stored but must not enter the energy chain — a
// "fault" state is not a counter value.
func TestNonNumericReadingDoesNotBreakTheChain(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)
	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 0),
		Sample{DeviceKey: "mqtt:meter", Metric: "kwh", At: base.Add(15 * time.Minute),
			Text: "fault", AtSource: AtSourceDevice},
		sampleAt("mqtt:meter", "kwh", 30*time.Minute, 6),
	)
	ds := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if len(ds) != 1 {
		t.Fatalf("expected 1 delta across the non-numeric sample, got %d", len(ds))
	}
	approx(t, ds[0].KWh, 6, "delta across a text reading")
}

// An unrecognised metric is skipped, not stored under a guessed meaning.
func TestUnknownMetricIsSkipped(t *testing.T) {
	s, acc, _ := newStore(t)
	res := mustIngest(t, s, acc, Sample{
		DeviceKey: "mqtt:meter", Metric: "percent", At: base, Value: 40, HasValue: true,
	})
	if res.Skipped != 1 || res.Accepted != 0 {
		t.Fatalf("%+v: an unrecognised metric must be skipped, not stored", res)
	}
	chans, err := s.Channels(context.Background(), acc)
	if err != nil {
		t.Fatalf("Channels: %v", err)
	}
	if len(chans) != 0 {
		t.Fatalf("auto-registered a channel for a non-energy metric: %+v", chans)
	}
}

// A metric nobody classified is recorded and made visible as unattributed —
// dropping it would hide real energy, and guessing a source would invent an
// attribution.
func TestUnseenMetricAutoRegistersAsUnattributed(t *testing.T) {
	s, acc, _ := newStore(t)
	mustIngest(t, s, acc, sampleAt("mqtt:new", "kwh", 0, 1))
	ch, err := s.ChannelByKey(context.Background(), acc, "mqtt:new", "kwh")
	if err != nil {
		t.Fatalf("ChannelByKey: %v", err)
	}
	if ch.Source != SourceUnattributed {
		t.Errorf("source %q, want unattributed", ch.Source)
	}
	if ch.Kind != KindCounter {
		t.Errorf("kind %q, want counter", ch.Kind)
	}
}

func TestClassify(t *testing.T) {
	cases := []struct {
		metric string
		kind   Kind
		scale  float64
		flow   Flow
		ok     bool
	}{
		{"kwh", KindCounter, 1, FlowSupply, true},
		{"KWh", KindCounter, 1, FlowSupply, true},
		{"wh", KindCounter, 0.001, FlowSupply, true},
		{"kwh_export", KindCounter, 1, FlowSink, true},
		{"kwh_charge", KindCounter, 1, FlowSink, true},
		{"kwh_discharge", KindCounter, 1, FlowSupply, true},
		{"kw", KindPower, 1, FlowSupply, true},
		{"w", KindPower, 0.001, FlowSupply, true},
		{"celsius", "", 0, "", false},
		{"", "", 0, "", false},
	}
	for _, c := range cases {
		k, sc, fl, ok := Classify(c.metric)
		if ok != c.ok {
			t.Errorf("Classify(%q) ok=%v, want %v", c.metric, ok, c.ok)
			continue
		}
		if !ok {
			continue
		}
		if k != c.kind || sc != c.scale || fl != c.flow {
			t.Errorf("Classify(%q) = %v/%v/%v, want %v/%v/%v", c.metric, k, sc, fl, c.kind, c.scale, c.flow)
		}
	}
}

func TestChannelValidationFailsClosed(t *testing.T) {
	s, acc, ctx := newStore(t)
	bad := []Channel{
		{DeviceKey: "", Metric: "kwh", Kind: KindCounter, Source: SourceGrid, Flow: FlowSupply},
		{DeviceKey: "d", Metric: "", Kind: KindCounter, Source: SourceGrid, Flow: FlowSupply},
		{DeviceKey: "d", Metric: "kwh", Kind: "made-up", Source: SourceGrid, Flow: FlowSupply},
		{DeviceKey: "d", Metric: "kwh", Kind: KindCounter, Source: "nuclear", Flow: FlowSupply},
		{DeviceKey: "d", Metric: "kwh", Kind: KindCounter, Source: SourceGrid, Flow: "sideways"},
		{DeviceKey: "d", Metric: "kwh", Kind: KindCounter, Source: SourceGrid, Flow: FlowSupply,
			IntervalSeconds: 600, GapToleranceSeconds: 60},
	}
	for i, c := range bad {
		if err := s.UpsertChannel(ctx, acc, c); err == nil {
			t.Errorf("case %d: expected rejection, got nil", i)
		} else if !IsInvalid(err) {
			t.Errorf("case %d: expected an invalid-error, got %v", i, err)
		}
	}
}

// Tenancy: two accounts, the same device key. Neither can see the other.
func TestTenancyIsolation(t *testing.T) {
	db := openTestDB(t)
	a := newAccount(t, db, "acct-a")
	b := newAccount(t, db, "acct-b")
	s := NewStore(db)
	ctx := context.Background()

	counterChannel(t, s, a, "mqtt:meter", nil)
	mustIngest(t, s, a, sampleAt("mqtt:meter", "kwh", 0, 0), sampleAt("mqtt:meter", "kwh", 15*time.Minute, 3))
	mustRollup(t, s, a)

	if _, err := s.ChannelByKey(ctx, b, "mqtt:meter", "kwh"); err != ErrNotFound {
		t.Errorf("account b resolved account a's channel: %v", err)
	}
	got, err := s.Series(ctx, b, SeriesQuery{Grain: GrainHour, From: base, To: base.Add(time.Hour)})
	if err != nil {
		t.Fatalf("Series: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("account b saw %d buckets of account a's data", len(got))
	}
	mix, err := s.SourceMix(ctx, b, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	if mix.SupplyKWh != 0 || mix.Channels != 0 {
		t.Errorf("account b's mix leaked account a's energy: %+v", mix)
	}
}
