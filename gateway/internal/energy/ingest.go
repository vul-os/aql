package energy

import (
	"context"
	"database/sql"
	"sort"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// wrapTolerance is how far a candidate rollover may exceed the channel's
// declared MaxKW before the engine stops believing it was a rollover. 1.5×
// leaves room for a meter's own rounding and a short burst above nameplate
// without letting an arbitrary backwards jump be laundered into a plausible
// wrap.
const wrapTolerance = 1.5

// IngestResult is what one ingest batch did. It is deliberately explicit about
// what was NOT stored: a silently dropped reading is how a metering system
// starts lying.
type IngestResult struct {
	// Accepted is samples newly stored.
	Accepted int
	// Duplicate is samples whose instant was already stored. The stored value
	// wins: the archive is immutable, so a device re-reporting an instant with
	// a different value cannot rewrite history.
	Duplicate int
	// Skipped is readings whose metric this package does not recognise as
	// energy, or whose channel is disabled.
	Skipped int
	// Channels is how many distinct channels the batch touched.
	Channels int
	// Deltas is energy differences written or re-derived.
	Deltas int
	// Resets is counter restarts detected in this batch. Every one of them
	// makes a period a lower bound rather than a total.
	Resets int
	// Wraps is register rollovers resolved against a declared CounterMax.
	Wraps int
	// GapSpanning is deltas whose interval exceeded the channel's tolerance —
	// periods nobody observed.
	GapSpanning int
	// DirtyBuckets is hour buckets queued for re-rollup.
	DirtyBuckets int
}

func (r *IngestResult) add(o IngestResult) {
	r.Accepted += o.Accepted
	r.Duplicate += o.Duplicate
	r.Skipped += o.Skipped
	r.Channels += o.Channels
	r.Deltas += o.Deltas
	r.Resets += o.Resets
	r.Wraps += o.Wraps
	r.GapSpanning += o.GapSpanning
	r.DirtyBuckets += o.DirtyBuckets
}

// SamplesFromReadings converts a driver's readings for one device into
// samples, under the registry's global device key.
//
// A reading with a zero At is stamped with the gateway's clock and marked
// AtSourceGateway. It is not dropped — a meter that does not timestamp its own
// readings is common — but the weaker provenance is recorded rather than
// hidden, because a dispute over a specific hour turns on exactly that.
func SamplesFromReadings(deviceKey string, readings []devices.Reading, now time.Time) []Sample {
	out := make([]Sample, 0, len(readings))
	for _, r := range readings {
		s := Sample{
			DeviceKey: deviceKey,
			Metric:    r.Metric,
			At:        r.At,
			Text:      r.Text,
			AtSource:  AtSourceDevice,
		}
		if s.At.IsZero() {
			s.At = now
			s.AtSource = AtSourceGateway
		}
		// Reading.Value is ignored when Text is set — driver.go's contract.
		if r.Text == "" {
			s.Value, s.HasValue = r.Value, true
		}
		out = append(out, s)
	}
	return out
}

// Ingest stores samples, re-derives the energy deltas around them, and queues
// the affected hour buckets for rollup.
//
// Samples need not be ordered and need not be new. A sample landing between
// two already-processed ones re-derives exactly the pair it splits, and
// nothing else.
func (s *Store) Ingest(ctx context.Context, accountID string, samples []Sample) (IngestResult, error) {
	var res IngestResult
	if accountID == "" {
		return res, errInvalid("account id is empty")
	}
	if len(samples) == 0 {
		return res, nil
	}

	type key struct{ device, metric string }
	groups := map[key][]Sample{}
	for _, sm := range samples {
		if sm.DeviceKey == "" || sm.Metric == "" || sm.At.IsZero() {
			res.Skipped++
			continue
		}
		k := key{sm.DeviceKey, sm.Metric}
		groups[k] = append(groups[k], sm)
	}

	// Deterministic order so a batch touching several channels behaves the
	// same on every run — the delta re-derivation is per channel and
	// independent, but a stable order makes failures reproducible.
	keys := make([]key, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].device != keys[j].device {
			return keys[i].device < keys[j].device
		}
		return keys[i].metric < keys[j].metric
	})

	for _, k := range keys {
		ch, err := s.ensureChannel(ctx, accountID, k.device, k.metric)
		if err != nil {
			if IsInvalid(err) {
				// Not an energy metric. Not an error: a meter reporting
				// "percent" alongside "kwh" is normal.
				res.Skipped += len(groups[k])
				continue
			}
			return res, err
		}
		if !ch.Enabled {
			res.Skipped += len(groups[k])
			continue
		}
		res.Channels++
		sub, err := s.ingestChannel(ctx, accountID, ch, groups[k])
		if err != nil {
			return res, err
		}
		res.add(sub)
	}
	return res, nil
}

func (s *Store) ingestChannel(ctx context.Context, accountID string, ch Channel, samples []Sample) (IngestResult, error) {
	var res IngestResult
	now := s.now().Unix()

	var minNumeric, maxNumeric int64
	haveNumeric := false
	for _, sm := range samples {
		at := sm.At.Unix()
		atSource := sm.AtSource
		if atSource != AtSourceGateway {
			atSource = AtSourceDevice
		}
		var val sql.NullFloat64
		if sm.HasValue {
			val = sql.NullFloat64{Float64: sm.Value, Valid: true}
		}
		r, err := s.db.ExecContext(ctx, `
			INSERT INTO energy_samples
			    (account_id, device_key, metric, at, value, text, at_source, received_at)
			VALUES (?,?,?,?,?,?,?,?)
			ON CONFLICT (account_id, device_key, metric, at) DO NOTHING`,
			accountID, ch.DeviceKey, ch.Metric, at, val, sm.Text, atSource, now)
		if err != nil {
			return res, err
		}
		n, _ := r.RowsAffected()
		if n == 0 {
			res.Duplicate++
			continue
		}
		res.Accepted++
		if sm.HasValue {
			if !haveNumeric || at < minNumeric {
				minNumeric = at
			}
			if !haveNumeric || at > maxNumeric {
				maxNumeric = at
			}
			haveNumeric = true
		}
	}
	if !haveNumeric {
		// Nothing numeric landed, so no pair in the delta chain changed.
		return res, nil
	}

	sub, err := s.rederiveDeltas(ctx, accountID, ch, minNumeric, maxNumeric)
	if err != nil {
		return res, err
	}
	res.add(sub)
	return res, nil
}

// rederiveDeltas rebuilds the delta chain over the smallest window that can
// have changed: from the numeric sample immediately before the batch to the
// one immediately after it. Inserting a sample at X splits the pair (P,N) into
// (P,X) and (X,N); no other pair is affected, so no other pair is touched.
func (s *Store) rederiveDeltas(ctx context.Context, accountID string, ch Channel, minAt, maxAt int64) (IngestResult, error) {
	var res IngestResult

	lo := minAt
	var prev sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `
		SELECT max(at) FROM energy_samples
		WHERE account_id = ? AND device_key = ? AND metric = ? AND value IS NOT NULL AND at < ?`,
		accountID, ch.DeviceKey, ch.Metric, minAt).Scan(&prev); err != nil && err != sql.ErrNoRows {
		return res, err
	}
	if prev.Valid {
		lo = prev.Int64
	}
	hi := maxAt
	var next sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `
		SELECT min(at) FROM energy_samples
		WHERE account_id = ? AND device_key = ? AND metric = ? AND value IS NOT NULL AND at > ?`,
		accountID, ch.DeviceKey, ch.Metric, maxAt).Scan(&next); err != nil && err != sql.ErrNoRows {
		return res, err
	}
	if next.Valid {
		hi = next.Int64
	}

	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM energy_deltas
		WHERE account_id = ? AND device_key = ? AND metric = ? AND to_at > ? AND to_at <= ?`,
		accountID, ch.DeviceKey, ch.Metric, lo, hi); err != nil {
		return res, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT at, value FROM energy_samples
		WHERE account_id = ? AND device_key = ? AND metric = ?
		  AND value IS NOT NULL AND at >= ? AND at <= ?
		ORDER BY at`, accountID, ch.DeviceKey, ch.Metric, lo, hi)
	if err != nil {
		return res, err
	}
	type pt struct {
		at  int64
		val float64
	}
	var pts []pt
	for rows.Next() {
		var p pt
		if err := rows.Scan(&p.at, &p.val); err != nil {
			rows.Close()
			return res, err
		}
		pts = append(pts, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return res, err
	}

	now := s.now().Unix()
	markLo, markHi := lo, hi
	for i := 1; i < len(pts); i++ {
		d, ok := deriveDelta(ch, pts[i-1].at, pts[i-1].val, pts[i].at, pts[i].val)
		if !ok {
			// A power channel across a gap: the energy is genuinely lost and
			// nothing here can recover it. Writing a delta would be inventing
			// the shape of a period nobody observed.
			res.GapSpanning++
			continue
		}
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO energy_deltas
			    (account_id, device_key, metric, from_at, to_at, kwh, quality,
			     spans_gap, from_value, to_value, created_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?)
			ON CONFLICT (account_id, device_key, metric, to_at) DO UPDATE SET
			    from_at = excluded.from_at, kwh = excluded.kwh,
			    quality = excluded.quality, spans_gap = excluded.spans_gap,
			    from_value = excluded.from_value, to_value = excluded.to_value,
			    created_at = excluded.created_at`,
			accountID, ch.DeviceKey, ch.Metric, d.from, d.to, d.kwh, string(d.quality),
			boolInt(d.spansGap), d.fromValue, d.toValue, now); err != nil {
			return res, err
		}
		res.Deltas++
		switch d.quality {
		case DeltaReset:
			res.Resets++
		case DeltaWrap:
			res.Wraps++
		}
		if d.spansGap {
			res.GapSpanning++
		}
		if d.from < markLo {
			markLo = d.from
		}
		if d.to > markHi {
			markHi = d.to
		}
	}

	n, err := s.markDirtyHours(ctx, accountID, ch, markLo, markHi)
	if err != nil {
		return res, err
	}
	res.DirtyBuckets += n
	return res, nil
}

type derived struct {
	from, to           int64
	kwh                float64
	quality            DeltaQuality
	spansGap           bool
	fromValue, toValue float64
}

// deriveDelta turns two consecutive samples into one energy difference.
//
// This is where a counter that wraps or resets is caught. A cumulative
// register going backwards is never negative energy; it is one of two things,
// and the engine only claims the benign one when the channel has told it the
// rollover point:
//
//	wrap  — CounterMax is declared, and the implied rollover is plausible
//	        against MaxKW. The full amount is recovered.
//	reset — anything else. kwh is what has accumulated SINCE the restart,
//	        which is a lower bound: the energy between the previous reading
//	        and the reset instant is gone. Rollups containing it are flagged.
//
// Returns ok=false when no honest delta can be produced at all — a power
// channel across a gap, where nothing later recovers the missing energy.
func deriveDelta(ch Channel, fromAt int64, fromVal float64, toAt int64, toVal float64) (derived, bool) {
	dt := toAt - fromAt
	if dt <= 0 {
		return derived{}, false
	}
	d := derived{from: fromAt, to: toAt, fromValue: fromVal, toValue: toVal}
	d.spansGap = dt > ch.GapToleranceSeconds

	if ch.Kind == KindPower {
		if d.spansGap {
			// The interior was not observed and a power reading says nothing
			// about it. No delta.
			return derived{}, false
		}
		d.kwh = (fromVal + toVal) / 2 * float64(dt) / 3600 * ch.Scale
		d.quality = DeltaIntegrated
		return d, true
	}

	switch {
	case toVal >= fromVal:
		d.kwh = (toVal - fromVal) * ch.Scale
		d.quality = DeltaMeasured
	default:
		if ch.CounterMax > 0 && ch.CounterMax >= fromVal {
			cand := (ch.CounterMax - fromVal + toVal) * ch.Scale
			plausible := ch.MaxKW <= 0 || cand <= ch.MaxKW*float64(dt)/3600*wrapTolerance
			if plausible && cand >= 0 {
				d.kwh = cand
				d.quality = DeltaWrap
				return d, true
			}
		}
		// Reset. Everything before the restart instant is unrecoverable; what
		// remains is a floor, not a total.
		d.kwh = toVal * ch.Scale
		if d.kwh < 0 {
			d.kwh = 0
		}
		d.quality = DeltaReset
	}
	return d, true
}

// markDirtyHours queues every hour bucket between from and to for re-rollup.
// The marks are rows, not an in-memory set, so an ingest that lands and a
// process that dies before the roller runs still leaves the work to be found.
func (s *Store) markDirtyHours(ctx context.Context, accountID string, ch Channel, fromUnix, toUnix int64) (int, error) {
	if toUnix < fromUnix {
		fromUnix, toUnix = toUnix, fromUnix
	}
	from := time.Unix(fromUnix, 0)
	// Inclusive of the bucket containing `to`.
	to := time.Unix(toUnix, 0).Add(time.Second)
	now := s.now().Unix()
	n := 0
	var markErr error
	walkBuckets(from, to, GrainHour, s.loc, func(start, _ time.Time) bool {
		if err := s.markDirty(ctx, accountID, ch, GrainHour, start.Unix(), now); err != nil {
			markErr = err
			return false
		}
		n++
		return true
	})
	return n, markErr
}

func (s *Store) markDirty(ctx context.Context, accountID string, ch Channel, g Grain, bucketStartUnix, now int64) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO energy_rollup_dirty
		    (account_id, device_key, metric, grain, tz, bucket_start, marked_at)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT (account_id, device_key, metric, grain, tz, bucket_start) DO NOTHING`,
		accountID, ch.DeviceKey, ch.Metric, string(g), s.TZ(), bucketStartUnix, now)
	return err
}
