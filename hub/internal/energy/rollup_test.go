package energy

import (
	"context"
	"testing"
	"time"
)

// The case this package exists for: a meter unreachable for two hours, then
// back. The counter did not forget, so the TOTAL across the gap is known — but
// nothing observed how it was distributed, so every hour it touches must say
// so rather than present a confident figure.
func TestGapSpanningARollupBoundaryIsMarkedEstimated(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)

	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 0),
		sampleAt("mqtt:meter", "kwh", 3*time.Hour, 30),
	)
	ds := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if len(ds) != 1 || !ds[0].SpansGap {
		t.Fatalf("expected one gap-spanning delta, got %+v", ds)
	}
	// The register did not forget: the derivation is genuinely measured even
	// though the interval was not observed. The two facts are separate fields.
	if ds[0].Quality != DeltaMeasured {
		t.Errorf("quality %q, want measured", ds[0].Quality)
	}

	mustRollup(t, s, acc)
	hs := hours(t, s, acc, "mqtt:meter", 4)

	for i := 0; i < 3; i++ {
		wantKWh(t, hs[i], 10)
		wantQuality(t, hs[i], QualityEstimated)
		approx(t, hs[i].EstimatedKWh, 10, "estimated portion")
		approx(t, hs[i].MeasuredKWh(), 0, "measured floor")
		if hs[i].CoverageSeconds != 0 {
			t.Errorf("hour %d claims %ds of coverage across an unobserved gap",
				i, hs[i].CoverageSeconds)
		}
		if hs[i].GapSeconds() != 3600 {
			t.Errorf("hour %d gap %ds, want 3600", i, hs[i].GapSeconds())
		}
	}
	// The hour after the closing reading has one sample and no energy.
	wantNilKWh(t, hs[3])
	wantQuality(t, hs[3], QualityPartial)
}

// With interpolation off the gap's energy is not attributed to any bucket at
// all. The buckets stay partial with a nil figure rather than gaining a guess.
func TestGapIsNotFilledWhenInterpolationIsOff(t *testing.T) {
	s, acc, _ := newStore(t, WithCounterGapInterpolation(false))
	counterChannel(t, s, acc, "mqtt:meter", nil)
	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 0),
		sampleAt("mqtt:meter", "kwh", 3*time.Hour, 30),
	)
	mustRollup(t, s, acc)
	hs := hours(t, s, acc, "mqtt:meter", 3)
	for i, h := range hs {
		wantNilKWh(t, h)
		if h.EstimatedKWh != 0 {
			t.Errorf("hour %d: estimated %v with interpolation off", i, h.EstimatedKWh)
		}
		wantQuality(t, h, QualityPartial)
	}
	// The energy is still on record in the delta table, so a long-period total
	// derived from evidence rather than from summaries stays correct.
	ds := deltaRows(t, s, acc, "mqtt:meter", "kwh")
	if len(ds) != 1 {
		t.Fatalf("expected the delta to be retained, got %d", len(ds))
	}
	approx(t, ds[0].KWh, 30, "retained delta")
}

// A partly covered hour is a floor, not a total.
func TestPartialHourIsAFloorNotATotal(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)
	// Only the first half hour is sampled; the meter then goes quiet for good.
	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 0),
		sampleAt("mqtt:meter", "kwh", 15*time.Minute, 2),
		sampleAt("mqtt:meter", "kwh", 30*time.Minute, 4),
	)
	mustRollup(t, s, acc)
	h := hours(t, s, acc, "mqtt:meter", 1)[0]
	wantKWh(t, h, 4)
	wantQuality(t, h, QualityPartial)
	if h.CoverageSeconds != 1800 || h.GapSeconds() != 1800 {
		t.Errorf("coverage %ds gap %ds, want 1800/1800", h.CoverageSeconds, h.GapSeconds())
	}
	approx(t, h.CoverageRatio(), 0.5, "coverage ratio")
	if h.Complete() {
		t.Error("a half-covered hour reported itself complete")
	}
}

// A period with no samples at all must be a hole, not a row of zeros.
func TestEmptyPeriodIsNotZero(t *testing.T) {
	s, acc, ctx := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)
	// The channel exists and has never reported.
	mustRollup(t, s, acc)

	hs := hours(t, s, acc, "mqtt:meter", 24)
	for _, h := range hs {
		wantNilKWh(t, h)
		wantQuality(t, h, QualityEmpty)
		if h.CoverageSeconds != 0 {
			t.Errorf("empty bucket claims coverage %d", h.CoverageSeconds)
		}
		if h.ExpectedSeconds != 3600 {
			t.Errorf("empty bucket expected %d, want 3600", h.ExpectedSeconds)
		}
	}

	days, err := s.Series(ctx, acc, SeriesQuery{
		DeviceKey: "mqtt:meter", Grain: GrainDay,
		From: base, To: base.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("Series(day): %v", err)
	}
	if len(days) != 1 {
		t.Fatalf("expected 1 dense day bucket, got %d", len(days))
	}
	wantNilKWh(t, days[0])
	wantQuality(t, days[0], QualityEmpty)
}

func TestDayAndMonthRollUpFromHours(t *testing.T) {
	s, acc, ctx := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)

	// 24 hours, 1 kWh per quarter hour: a complete day of 96 kWh.
	var samples []Sample
	for i := 0; i <= 96; i++ {
		samples = append(samples, sampleAt("mqtt:meter", "kwh", time.Duration(i)*15*time.Minute, float64(i)))
	}
	mustIngest(t, s, acc, samples...)
	mustRollup(t, s, acc)

	days, err := s.Series(ctx, acc, SeriesQuery{
		DeviceKey: "mqtt:meter", Grain: GrainDay, From: base, To: base.Add(24 * time.Hour)})
	if err != nil {
		t.Fatalf("Series(day): %v", err)
	}
	if len(days) != 1 {
		t.Fatalf("expected 1 day, got %d", len(days))
	}
	wantKWh(t, days[0], 96)
	wantQuality(t, days[0], QualityComplete)
	if days[0].ExpectedSeconds != 86400 || days[0].CoverageSeconds != 86400 {
		t.Errorf("day coverage %d/%d, want 86400/86400", days[0].CoverageSeconds, days[0].ExpectedSeconds)
	}

	months, err := s.Series(ctx, acc, SeriesQuery{
		DeviceKey: "mqtt:meter", Grain: GrainMonth, From: base, To: base.Add(24 * time.Hour)})
	if err != nil {
		t.Fatalf("Series(month): %v", err)
	}
	if len(months) != 1 {
		t.Fatalf("expected 1 month, got %d", len(months))
	}
	wantKWh(t, months[0], 96)
	// March has 31 days; one complete day out of 31 is a partial month, and it
	// must not present as a complete one.
	wantQuality(t, months[0], QualityPartial)
	if months[0].ExpectedSeconds != 31*86400 {
		t.Errorf("month expected %d seconds, want %d", months[0].ExpectedSeconds, 31*86400)
	}
}

// Rollups are incremental: a read does no work, and a late sample re-rolls
// only the buckets it touches.
func TestRollupIsIncremental(t *testing.T) {
	s, acc, ctx := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)

	var samples []Sample
	for i := 0; i <= 96; i++ {
		samples = append(samples, sampleAt("mqtt:meter", "kwh", time.Duration(i)*15*time.Minute, float64(i)))
	}
	mustIngest(t, s, acc, samples...)
	first := mustRollup(t, s, acc)
	if first.Hours < 24 {
		t.Fatalf("first pass rolled %d hours, expected at least 24", first.Hours)
	}
	if first.Remaining != 0 {
		t.Fatalf("%d buckets still pending after a full pass", first.Remaining)
	}

	// A second pass has nothing to do: reads never recompute.
	second := mustRollup(t, s, acc)
	if second.Hours != 0 || second.Days != 0 || second.Months != 0 {
		t.Fatalf("a second pass recomputed %+v, expected no work", second)
	}

	// One late sample in hour 5 dirties that hour (and the pair around it),
	// its day and its month — not the other 23 hours.
	mustIngest(t, s, acc, sampleAt("mqtt:meter", "kwh", 5*time.Hour+7*time.Minute, 20.5))
	pending, err := s.PendingRollups(ctx, acc)
	if err != nil {
		t.Fatalf("PendingRollups: %v", err)
	}
	if pending == 0 || pending > 2 {
		t.Fatalf("a late sample marked %d hour buckets dirty, expected 1 or 2", pending)
	}
	third := mustRollup(t, s, acc)
	if third.Hours > 2 {
		t.Errorf("re-rolled %d hours for one late sample", third.Hours)
	}
	if third.Days != 1 || third.Months != 1 {
		t.Errorf("expected exactly one day and one month re-derived, got %d/%d", third.Days, third.Months)
	}
}

// A budgeted pass leaves the rest queued rather than silently dropping it.
func TestRollupBudgetLeavesTheRestQueued(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)
	var samples []Sample
	for i := 0; i <= 96; i++ {
		samples = append(samples, sampleAt("mqtt:meter", "kwh", time.Duration(i)*15*time.Minute, float64(i)))
	}
	mustIngest(t, s, acc, samples...)

	res, err := s.Rollup(context.Background(), acc, 5)
	if err != nil {
		t.Fatalf("Rollup: %v", err)
	}
	if res.Hours != 5 {
		t.Errorf("rolled %d hours under a budget of 5", res.Hours)
	}
	if res.Remaining == 0 {
		t.Error("budgeted pass reported nothing remaining")
	}
	// Draining to completion converges.
	for i := 0; i < 50; i++ {
		r, err := s.Rollup(context.Background(), acc, 5)
		if err != nil {
			t.Fatalf("Rollup: %v", err)
		}
		if r.Remaining == 0 {
			return
		}
	}
	t.Error("budgeted passes did not converge")
}

// Bucket arithmetic is timezone-anchored: a bill is a local-time document and
// a DST day is not 86400 seconds.
func TestDaylightSavingChangesBucketLength(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("tzdata unavailable:", err)
	}
	// 2026-03-08 is the US spring-forward: a 23-hour day.
	spring := time.Date(2026, 3, 8, 12, 0, 0, 0, loc)
	ds := bucketStart(spring, GrainDay, loc)
	de := bucketEnd(ds, GrainDay, loc)
	if got := de.Unix() - ds.Unix(); got != 23*3600 {
		t.Errorf("spring-forward day is %d seconds, want %d", got, 23*3600)
	}
	// 2026-11-01 is the fall-back: a 25-hour day.
	fall := time.Date(2026, 11, 1, 12, 0, 0, 0, loc)
	fs := bucketStart(fall, GrainDay, loc)
	fe := bucketEnd(fs, GrainDay, loc)
	if got := fe.Unix() - fs.Unix(); got != 25*3600 {
		t.Errorf("fall-back day is %d seconds, want %d", got, 25*3600)
	}
	// Hour buckets must still tile the transition without stalling.
	n := 0
	walkBuckets(ds, de, GrainHour, loc, func(start, end time.Time) bool {
		if !end.After(start) {
			t.Fatalf("non-advancing hour bucket at %v", start)
		}
		n++
		return n < 100
	})
	if n != 23 {
		t.Errorf("spring-forward day has %d hour buckets, want 23", n)
	}
}

// A rollup in a non-UTC zone is stored under that zone, and a store reading
// UTC must not see it — otherwise two zones would silently overwrite each
// other's history.
func TestRollupsAreKeyedByTimezone(t *testing.T) {
	loc := time.FixedZone("TEST+0530", 5*3600+1800)
	db := openTestDB(t)
	acc := newAccount(t, db, "acct-tz")
	local := NewStore(db, WithLocation(loc))
	utc := NewStore(db)

	counterChannel(t, local, acc, "mqtt:meter", nil)
	mustIngest(t, local, acc,
		sampleAt("mqtt:meter", "kwh", 0, 0),
		sampleAt("mqtt:meter", "kwh", 15*time.Minute, 2),
	)
	mustRollup(t, local, acc)

	got, err := local.Series(context.Background(), acc, SeriesQuery{
		DeviceKey: "mqtt:meter", Grain: GrainHour, From: base, To: base.Add(time.Hour)})
	if err != nil {
		t.Fatalf("Series: %v", err)
	}
	if len(got) == 0 || got[0].KWh == nil {
		t.Fatalf("local-zone rollup missing: %+v", got)
	}
	// The +05:30 offset means the local hour bucket starts on the half hour.
	if got[0].Start.Unix()%3600 == 0 {
		t.Errorf("bucket %v is aligned to a UTC hour, not to the store's zone", got[0].Start)
	}

	utcSeries, err := utc.Series(context.Background(), acc, SeriesQuery{
		DeviceKey: "mqtt:meter", Grain: GrainHour, From: base, To: base.Add(time.Hour)})
	if err != nil {
		t.Fatalf("Series(utc): %v", err)
	}
	if len(utcSeries) != 1 || utcSeries[0].KWh != nil {
		t.Errorf("a UTC-anchored store read a +05:30 rollup: %+v", utcSeries)
	}
}

// Pruning raw samples must not run ahead of the rollups that still need them.
func TestPruneRefusesWhileBucketsArePending(t *testing.T) {
	s, acc, ctx := newStore(t)
	counterChannel(t, s, acc, "mqtt:meter", nil)
	mustIngest(t, s, acc,
		sampleAt("mqtt:meter", "kwh", 0, 0),
		sampleAt("mqtt:meter", "kwh", 15*time.Minute, 2),
	)
	if _, err := s.PruneSamples(ctx, acc, base.Add(time.Hour)); err == nil {
		t.Fatal("pruned samples a queued rollup had not read yet")
	} else if !IsInvalid(err) {
		t.Fatalf("expected an invalid-error, got %v", err)
	}

	mustRollup(t, s, acc)
	n, err := s.PruneSamples(ctx, acc, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("PruneSamples: %v", err)
	}
	// One of the two, not both: a channel's most recent sample is its ANCHOR
	// and is never pruned at any age. Deltas are derived from consecutive
	// samples, so without it a meter returning after a silence longer than the
	// retention window would have no predecessor to pair against and its
	// consumption would produce no delta — accepted, and invisibly lost.
	if n != 1 {
		t.Errorf("pruned %d samples, want 1 (the newest is the anchor)", n)
	}
	if got := sampleCount(t, s, acc); got != 1 {
		t.Errorf("%d samples remain, want the anchor and nothing else", got)
	}
	// The evidence survives: deltas are never pruned.
	if ds := deltaRows(t, s, acc, "mqtt:meter", "kwh"); len(ds) != 1 {
		t.Errorf("pruning destroyed the delta record: %d rows", len(ds))
	}
	// And so does the summary.
	h := hours(t, s, acc, "mqtt:meter", 1)[0]
	wantKWh(t, h, 2)
}

func TestSeriesRejectsAnEmptyWindowAndUnknownGrain(t *testing.T) {
	s, acc, ctx := newStore(t)
	if _, err := s.Series(ctx, acc, SeriesQuery{Grain: GrainHour, From: base, To: base}); err == nil {
		t.Error("expected rejection of an empty window")
	}
	if _, err := s.Series(ctx, acc, SeriesQuery{Grain: "fortnight", From: base, To: base.Add(time.Hour)}); err == nil {
		t.Error("expected rejection of an unknown grain")
	}
}
