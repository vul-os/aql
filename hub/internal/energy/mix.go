package energy

import (
	"context"
	"database/sql"
	"sort"
	"time"
)

// SourceTotal is one source-and-direction's contribution over a period.
type SourceTotal struct {
	Source Source
	Flow   Flow
	KWh    float64
	// EstimatedKWh is how much of KWh was interpolated across a gap. KWh minus
	// this is the measured floor.
	EstimatedKWh float64
	// CoverageSeconds and ExpectedSeconds are summed across every channel in
	// the group. Expected is the FULL window per channel, not the span of the
	// rows that happen to exist — a meter that was down for the whole period
	// has to show as a gap, not as absent.
	CoverageSeconds int64
	ExpectedSeconds int64
	ResetCount      int64
	Channels        int
}

// GapSeconds is unobserved channel-seconds in the group.
func (t SourceTotal) GapSeconds() int64 {
	g := t.ExpectedSeconds - t.CoverageSeconds
	if g < 0 {
		return 0
	}
	return g
}

// CoverageRatio is observed over expected, 0..1.
func (t SourceTotal) CoverageRatio() float64 {
	if t.ExpectedSeconds <= 0 {
		return 0
	}
	r := float64(t.CoverageSeconds) / float64(t.ExpectedSeconds)
	if r > 1 {
		return 1
	}
	return r
}

// Complete reports whether this group's figure can be quoted without a caveat.
func (t SourceTotal) Complete() bool {
	return t.GapSeconds() == 0 && t.ResetCount == 0 && t.EstimatedKWh == 0
}

// MeasuredKWh is the floor: the part of KWh that was measured rather than
// interpolated. With ResetCount > 0 even this is a floor, because energy
// before a counter restart is unrecoverable.
func (t SourceTotal) MeasuredKWh() float64 {
	m := t.KWh - t.EstimatedKWh
	if m < 0 {
		return 0
	}
	return m
}

// Mix is source-mix accounting over a period: how much energy the site drew
// from each source and how much it sent back or stored.
//
// A site draws from grid, solar and battery at the same time and the split
// between them is only as good as the meters that were up. Everything here is
// therefore reported WITH its coverage, and [Mix.Share] refuses to call a
// percentage exact when it is not.
type Mix struct {
	// From and To are the ALIGNED window actually accounted for: From is
	// rounded down and To up to hour boundaries in TZ, because hour rollups
	// are the smallest unit the summaries hold. A caller asking for
	// 09:30–10:30 gets 09:00–11:00 and is told so.
	From, To time.Time
	TZ       string

	Totals []SourceTotal

	// SupplyKWh is energy that arrived: grid import + solar + battery
	// discharge + generator. Sub-meters and unclassified channels are excluded
	// — a sub-meter's energy is already counted at the source that supplied
	// it, and counting it again would inflate the denominator of every share.
	SupplyKWh float64
	// SinkKWh is energy that left or was stored: grid export + battery charge.
	SinkKWh float64
	// NetConsumptionKWh is SupplyKWh - SinkKWh: what the site actually used.
	NetConsumptionKWh float64
	// UnattributedKWh is energy on channels nobody has classified. It is NOT
	// folded into any source. A non-zero value means the mix below does not
	// account for all the metered energy, and Attributed is false.
	UnattributedKWh float64
	// SubMeterKWh is SourceLoad channels, reported for completeness and never
	// summed into the mix.
	SubMeterKWh float64

	EstimatedKWh    float64
	CoverageSeconds int64
	ExpectedSeconds int64
	ResetCount      int64
	Channels        int

	// Complete is true when every contributing channel was fully covered, no
	// counter reset falls in the window, and nothing was interpolated.
	Complete bool
	// Attributed is true when no metered energy in the window sits on an
	// unclassified channel.
	Attributed bool
}

// CoverageRatio is observed channel-seconds over expected, 0..1.
func (m Mix) CoverageRatio() float64 {
	if m.ExpectedSeconds <= 0 {
		return 0
	}
	r := float64(m.CoverageSeconds) / float64(m.ExpectedSeconds)
	if r > 1 {
		return 1
	}
	return r
}

// GapSeconds is unobserved channel-seconds across the window.
func (m Mix) GapSeconds() int64 {
	g := m.ExpectedSeconds - m.CoverageSeconds
	if g < 0 {
		return 0
	}
	return g
}

// Share is one supply source's percentage of the site's supply.
//
// exact is false whenever the number cannot be defended: a gap in ANY
// contributing meter moves both the numerator and the denominator by an
// unknown amount, so a share computed over incomplete data is not a
// percentage with an error bar — it is a ratio of two floors. Callers must
// render an inexact share as approximate, and a surface that cannot do that
// should show the kWh figures and their coverage instead.
//
// It deliberately does not return bounds. Bounding a share from above requires
// knowing the maximum energy a source COULD have delivered during the gap,
// which needs a declared MaxKW on every channel and is not something the
// engine can assume it has.
func (m Mix) Share(src Source) (pct float64, exact bool) {
	if m.SupplyKWh <= 0 {
		return 0, false
	}
	var num float64
	var groupComplete = true
	found := false
	for _, t := range m.Totals {
		if t.Source != src || t.Flow != FlowSupply {
			continue
		}
		found = true
		num += t.KWh
		if !t.Complete() {
			groupComplete = false
		}
	}
	if !found {
		return 0, m.Complete && m.Attributed
	}
	return num / m.SupplyKWh * 100, m.Complete && m.Attributed && groupComplete
}

// SourceMix attributes consumption across sources over a period.
//
// It reads the hourly rollups, so it does not recompute anything; check
// [Store.PendingRollups] if the caller needs to know whether they are current.
func (s *Store) SourceMix(ctx context.Context, accountID string, from, to time.Time) (Mix, error) {
	var m Mix
	if accountID == "" {
		return m, errInvalid("account id is empty")
	}
	if !to.After(from) {
		return m, errInvalid("mix window is empty")
	}
	alignedFrom := bucketStart(from, GrainHour, s.loc)
	alignedTo := bucketStart(to, GrainHour, s.loc)
	if alignedTo.Before(to) {
		alignedTo = bucketEnd(alignedTo, GrainHour, s.loc)
	}
	m.From, m.To, m.TZ = alignedFrom, alignedTo, s.TZ()
	windowSeconds := alignedTo.Unix() - alignedFrom.Unix()

	chans, err := s.Channels(ctx, accountID)
	if err != nil {
		return m, err
	}

	type agg struct {
		kwh, est float64
		coverage int64
		resets   int64
	}
	sums := map[string]agg{}
	rows, err := s.db.QueryContext(ctx, `
		SELECT device_key, metric, sum(kwh), sum(estimated_kwh),
		       sum(coverage_seconds), sum(reset_count)
		FROM energy_rollups
		WHERE account_id = ? AND grain = 'hour' AND tz = ?
		  AND bucket_start >= ? AND bucket_start < ?
		GROUP BY device_key, metric`,
		accountID, s.TZ(), alignedFrom.Unix(), alignedTo.Unix())
	if err != nil {
		return m, err
	}
	for rows.Next() {
		var dk, met string
		var kwh, est sql.NullFloat64
		var cov, resets sql.NullInt64
		if err := rows.Scan(&dk, &met, &kwh, &est, &cov, &resets); err != nil {
			rows.Close()
			return m, err
		}
		sums[dk+"\x00"+met] = agg{kwh.Float64, est.Float64, cov.Int64, resets.Int64}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return m, err
	}

	type groupKey struct {
		source Source
		flow   Flow
	}
	groups := map[groupKey]*SourceTotal{}
	for _, ch := range chans {
		if !ch.Enabled {
			continue
		}
		a := sums[ch.DeviceKey+"\x00"+ch.Metric]
		gk := groupKey{ch.Source, ch.Flow}
		t, ok := groups[gk]
		if !ok {
			t = &SourceTotal{Source: ch.Source, Flow: ch.Flow}
			groups[gk] = t
		}
		t.KWh += a.kwh
		t.EstimatedKWh += a.est
		t.CoverageSeconds += a.coverage
		// Expected is the whole window for every enabled channel, whether or
		// not it produced a single row. A meter that was down for the entire
		// period is a full-window gap, not an absence.
		t.ExpectedSeconds += windowSeconds
		t.ResetCount += a.resets
		t.Channels++

		m.Channels++
		m.EstimatedKWh += a.est
		m.CoverageSeconds += a.coverage
		m.ExpectedSeconds += windowSeconds
		m.ResetCount += a.resets
	}

	for _, t := range groups {
		m.Totals = append(m.Totals, *t)
		switch t.Source {
		case SourceUnattributed:
			m.UnattributedKWh += t.KWh
		case SourceLoad:
			m.SubMeterKWh += t.KWh
		default:
			if t.Flow == FlowSupply {
				m.SupplyKWh += t.KWh
			} else {
				m.SinkKWh += t.KWh
			}
		}
	}
	sort.Slice(m.Totals, func(i, j int) bool {
		if m.Totals[i].Source != m.Totals[j].Source {
			return m.Totals[i].Source < m.Totals[j].Source
		}
		return m.Totals[i].Flow < m.Totals[j].Flow
	})

	m.NetConsumptionKWh = m.SupplyKWh - m.SinkKWh
	m.Complete = m.GapSeconds() == 0 && m.ResetCount == 0 && m.EstimatedKWh == 0 && m.Channels > 0
	m.Attributed = m.UnattributedKWh == 0
	return m, nil
}
