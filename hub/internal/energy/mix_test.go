package energy

import (
	"context"
	"testing"
	"time"
)

// feedHour writes a full hour of quarter-hourly counter samples rising by
// total/4 each step, so the channel ends the hour fully covered.
func feedHour(t *testing.T, s *Store, acc, dev, metric string, total float64) {
	t.Helper()
	for i := 0; i <= 4; i++ {
		mustIngest(t, s, acc, sampleAt(dev, metric, time.Duration(i)*15*time.Minute, total*float64(i)/4))
	}
}

func declare(t *testing.T, s *Store, acc, dev, metric string, src Source, flow Flow) {
	t.Helper()
	if err := s.UpsertChannel(context.Background(), acc, Channel{
		DeviceKey: dev, Metric: metric, Kind: KindCounter,
		Source: src, Flow: flow, Scale: 1,
		IntervalSeconds: 900, GapToleranceSeconds: 1800, Enabled: true,
	}); err != nil {
		t.Fatalf("UpsertChannel %s/%s: %v", dev, metric, err)
	}
}

func totalFor(m Mix, src Source, flow Flow) (SourceTotal, bool) {
	for _, t := range m.Totals {
		if t.Source == src && t.Flow == flow {
			return t, true
		}
	}
	return SourceTotal{}, false
}

// A site drawing from grid, solar and battery at once, all meters healthy.
func TestSourceMixAttributesAcrossSources(t *testing.T) {
	s, acc, ctx := newStore(t)
	declare(t, s, acc, "mqtt:grid", "kwh", SourceGrid, FlowSupply)
	declare(t, s, acc, "mqtt:grid", "kwh_export", SourceGrid, FlowSink)
	declare(t, s, acc, "mqtt:pv", "kwh", SourceSolar, FlowSupply)
	declare(t, s, acc, "mqtt:batt", "kwh_discharge", SourceBattery, FlowSupply)

	feedHour(t, s, acc, "mqtt:grid", "kwh", 2)
	feedHour(t, s, acc, "mqtt:grid", "kwh_export", 1)
	feedHour(t, s, acc, "mqtt:pv", "kwh", 6)
	feedHour(t, s, acc, "mqtt:batt", "kwh_discharge", 2)
	mustRollup(t, s, acc)

	m, err := s.SourceMix(ctx, acc, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	approx(t, m.SupplyKWh, 10, "supply")
	approx(t, m.SinkKWh, 1, "sink")
	approx(t, m.NetConsumptionKWh, 9, "net consumption")
	approx(t, m.UnattributedKWh, 0, "unattributed")
	if !m.Complete {
		t.Errorf("mix reported incomplete with four fully covered meters: gap %ds, resets %d, est %v",
			m.GapSeconds(), m.ResetCount, m.EstimatedKWh)
	}
	if !m.Attributed {
		t.Error("mix reported unattributed energy where every channel is declared")
	}

	pct, exact := m.Share(SourceSolar)
	approx(t, pct, 60, "solar share")
	if !exact {
		t.Error("solar share reported inexact over complete data")
	}
	pct, _ = m.Share(SourceGrid)
	approx(t, pct, 20, "grid share")
	pct, _ = m.Share(SourceBattery)
	approx(t, pct, 20, "battery share")

	if got, ok := totalFor(m, SourceSolar, FlowSupply); !ok {
		t.Error("no solar supply total")
	} else {
		approx(t, got.CoverageRatio(), 1, "solar coverage")
		if !got.Complete() {
			t.Error("solar group not complete")
		}
	}
}

// The case a bill dispute turns on: one meter had a gap. The share of every
// source moves by an unknown amount, so no percentage in the period may be
// presented as exact.
func TestShareIsNotExactWhenAMeterHadAGap(t *testing.T) {
	s, acc, ctx := newStore(t)
	declare(t, s, acc, "mqtt:grid", "kwh", SourceGrid, FlowSupply)
	declare(t, s, acc, "mqtt:pv", "kwh", SourceSolar, FlowSupply)

	feedHour(t, s, acc, "mqtt:grid", "kwh", 4)
	// The inverter stops answering half way through and never comes back.
	mustIngest(t, s, acc,
		sampleAt("mqtt:pv", "kwh", 0, 0),
		sampleAt("mqtt:pv", "kwh", 15*time.Minute, 1),
		sampleAt("mqtt:pv", "kwh", 30*time.Minute, 2),
	)
	mustRollup(t, s, acc)

	m, err := s.SourceMix(ctx, acc, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	if m.Complete {
		t.Error("mix reported complete with a meter down for half the hour")
	}
	if m.GapSeconds() != 1800 {
		t.Errorf("mix gap %ds, want 1800", m.GapSeconds())
	}
	if _, exact := m.Share(SourceSolar); exact {
		t.Error("solar share reported exact over a gap")
	}
	if _, exact := m.Share(SourceGrid); exact {
		t.Error("grid share reported exact while the denominator is a floor")
	}
	solar, _ := totalFor(m, SourceSolar, FlowSupply)
	approx(t, solar.KWh, 2, "solar floor")
	approx(t, solar.CoverageRatio(), 0.5, "solar coverage")
	if solar.Complete() {
		t.Error("solar group claimed completeness over a half-covered hour")
	}
}

// Energy on a channel nobody classified must be visible and must not be folded
// into a source it might not belong to.
func TestUnattributedEnergyIsReportedSeparately(t *testing.T) {
	s, acc, ctx := newStore(t)
	declare(t, s, acc, "mqtt:grid", "kwh", SourceGrid, FlowSupply)
	feedHour(t, s, acc, "mqtt:grid", "kwh", 4)
	// A meter appears that no one has classified.
	feedHour(t, s, acc, "mqtt:mystery", "kwh", 3)
	mustRollup(t, s, acc)

	m, err := s.SourceMix(ctx, acc, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	approx(t, m.SupplyKWh, 4, "supply excludes unattributed energy")
	approx(t, m.UnattributedKWh, 3, "unattributed")
	if m.Attributed {
		t.Error("mix claimed full attribution with 3 kWh unclassified")
	}
	if _, exact := m.Share(SourceGrid); exact {
		t.Error("a share was called exact while 3 kWh sits unattributed")
	}

	// Classifying it moves the energy into the mix without re-ingesting
	// anything: rollups do not copy the attribution.
	declare(t, s, acc, "mqtt:mystery", "kwh", SourceSolar, FlowSupply)
	m, err = s.SourceMix(ctx, acc, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	approx(t, m.SupplyKWh, 7, "supply after classification")
	approx(t, m.UnattributedKWh, 0, "unattributed after classification")
	if !m.Attributed {
		t.Error("mix still reports unattributed energy after classification")
	}
}

// A sub-meter measures energy already counted at its source. Summing it into
// the mix would inflate every denominator.
func TestSubMetersAreExcludedFromTheMix(t *testing.T) {
	s, acc, ctx := newStore(t)
	declare(t, s, acc, "mqtt:grid", "kwh", SourceGrid, FlowSupply)
	declare(t, s, acc, "mqtt:geyser", "kwh", SourceLoad, FlowSupply)
	feedHour(t, s, acc, "mqtt:grid", "kwh", 4)
	feedHour(t, s, acc, "mqtt:geyser", "kwh", 3)
	mustRollup(t, s, acc)

	m, err := s.SourceMix(ctx, acc, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	approx(t, m.SupplyKWh, 4, "supply excludes the sub-meter")
	approx(t, m.SubMeterKWh, 3, "sub-meter total")
}

// A period nobody measured must not read as a period of no consumption.
func TestMixOverAPeriodWithNoSamples(t *testing.T) {
	s, acc, ctx := newStore(t)
	declare(t, s, acc, "mqtt:grid", "kwh", SourceGrid, FlowSupply)
	declare(t, s, acc, "mqtt:pv", "kwh", SourceSolar, FlowSupply)
	mustRollup(t, s, acc)

	m, err := s.SourceMix(ctx, acc, base, base.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	if m.Channels != 2 {
		t.Fatalf("expected 2 contributing channels, got %d", m.Channels)
	}
	approx(t, m.SupplyKWh, 0, "supply")
	if m.Complete {
		t.Error("a period with no samples reported itself complete")
	}
	if m.CoverageRatio() != 0 {
		t.Errorf("coverage ratio %v over an unmeasured day", m.CoverageRatio())
	}
	// Two meters, a full day each, entirely unobserved.
	if want := int64(2 * 24 * 3600); m.GapSeconds() != want {
		t.Errorf("gap %ds, want %ds", m.GapSeconds(), want)
	}
	if pct, exact := m.Share(SourceSolar); pct != 0 || exact {
		t.Errorf("Share over no data returned (%v, %v), want (0, false)", pct, exact)
	}
}

// A counter reset inside the window makes every figure derived from it a floor.
func TestMixCarriesResetsThrough(t *testing.T) {
	s, acc, ctx := newStore(t)
	declare(t, s, acc, "mqtt:grid", "kwh", SourceGrid, FlowSupply)
	mustIngest(t, s, acc,
		sampleAt("mqtt:grid", "kwh", 0, 500),
		sampleAt("mqtt:grid", "kwh", 15*time.Minute, 502),
		sampleAt("mqtt:grid", "kwh", 30*time.Minute, 1),
		sampleAt("mqtt:grid", "kwh", 45*time.Minute, 2),
		sampleAt("mqtt:grid", "kwh", 60*time.Minute, 3),
	)
	mustRollup(t, s, acc)
	m, err := s.SourceMix(ctx, acc, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	if m.ResetCount != 1 {
		t.Errorf("mix reset count %d, want 1", m.ResetCount)
	}
	if m.Complete {
		t.Error("mix reported complete across a counter reset")
	}
	grid, _ := totalFor(m, SourceGrid, FlowSupply)
	if grid.Complete() {
		t.Error("grid group reported complete across a counter reset")
	}
	// 2 measured before the reset, then 1 + 1 + 1 after it.
	approx(t, grid.KWh, 5, "post-reset floor")
}

// The accounted window is aligned to hour buckets and the caller is told.
func TestMixAlignsItsWindowToHourBuckets(t *testing.T) {
	s, acc, ctx := newStore(t)
	declare(t, s, acc, "mqtt:grid", "kwh", SourceGrid, FlowSupply)
	from := base.Add(30 * time.Minute)
	to := base.Add(90 * time.Minute)
	m, err := s.SourceMix(ctx, acc, from, to)
	if err != nil {
		t.Fatalf("SourceMix: %v", err)
	}
	if !m.From.Equal(base) {
		t.Errorf("From %v, want %v", m.From, base)
	}
	if want := base.Add(2 * time.Hour); !m.To.Equal(want) {
		t.Errorf("To %v, want %v", m.To, want)
	}
	if m.ExpectedSeconds != 2*3600 {
		t.Errorf("expected seconds %d, want %d", m.ExpectedSeconds, 2*3600)
	}
}

func TestMixRejectsAnEmptyWindow(t *testing.T) {
	s, acc, ctx := newStore(t)
	if _, err := s.SourceMix(ctx, acc, base, base); err == nil {
		t.Error("expected rejection of an empty window")
	}
}
