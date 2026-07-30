package energy

import (
	"context"
	"database/sql"
	"time"
)

// maxSeriesBuckets bounds a single Series call. A dense hour series over a
// decade is a mistake, not a request, and returning 90k rows quietly is how a
// mistake becomes a timeout somewhere else.
const maxSeriesBuckets = 200000

// RollupResult is what one rollup pass did.
type RollupResult struct {
	Hours  int
	Days   int
	Months int
	// Remaining is dirty buckets still queued after the pass, when a budget
	// cut it short.
	Remaining int
}

// Rollup drains the dirty queue: it recomputes the hour buckets ingest marked,
// then the days those hours belong to, then the months those days belong to.
//
// Reads never do this work. That is the point of the queue — a chart asking
// for last year does not re-derive last year, and a late sample for an hour in
// March re-derives that hour, that day and that month, and nothing else.
//
// budget caps how many hour buckets are recomputed in one pass; 0 means no
// cap. Day and month buckets are always finished for whatever hours the pass
// touched, so a budgeted pass never leaves a day summarising a half-updated
// set of hours.
func (s *Store) Rollup(ctx context.Context, accountID string, budget int) (RollupResult, error) {
	var res RollupResult
	if accountID == "" {
		return res, errInvalid("account id is empty")
	}
	n, err := s.drain(ctx, accountID, GrainHour, budget)
	if err != nil {
		return res, err
	}
	res.Hours = n
	if n, err = s.drain(ctx, accountID, GrainDay, 0); err != nil {
		return res, err
	}
	res.Days = n
	if n, err = s.drain(ctx, accountID, GrainMonth, 0); err != nil {
		return res, err
	}
	res.Months = n
	if res.Remaining, err = s.PendingRollups(ctx, accountID); err != nil {
		return res, err
	}
	return res, nil
}

// PendingRollups is how many dirty buckets are queued. A non-zero count means
// stored rollups are behind the samples that have landed; a surface reading
// them should say so rather than present a figure that is quietly short.
func (s *Store) PendingRollups(ctx context.Context, accountID string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM energy_rollup_dirty WHERE account_id = ? AND tz = ?`,
		accountID, s.TZ()).Scan(&n)
	return n, err
}

type dirtyRow struct {
	deviceKey string
	metric    string
	start     int64
	markedAt  int64
}

func (s *Store) drain(ctx context.Context, accountID string, g Grain, budget int) (int, error) {
	limit := budget
	if limit <= 0 {
		limit = -1 // SQLite treats a negative LIMIT as no limit.
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT device_key, metric, bucket_start, marked_at
		FROM energy_rollup_dirty
		WHERE account_id = ? AND grain = ? AND tz = ?
		ORDER BY marked_at, device_key, metric, bucket_start
		LIMIT ?`, accountID, string(g), s.TZ(), limit)
	if err != nil {
		return 0, err
	}
	var work []dirtyRow
	for rows.Next() {
		var d dirtyRow
		if err := rows.Scan(&d.deviceKey, &d.metric, &d.start, &d.markedAt); err != nil {
			rows.Close()
			return 0, err
		}
		work = append(work, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	chans := map[string]Channel{}
	done := 0
	for _, d := range work {
		ck := d.deviceKey + "\x00" + d.metric
		ch, ok := chans[ck]
		if !ok {
			ch, err = s.ChannelByKey(ctx, accountID, d.deviceKey, d.metric)
			if err == sql.ErrNoRows {
				// The channel was deleted; the FK cascade will have taken the
				// dirty row too. Nothing to do.
				continue
			}
			if err != nil {
				return done, err
			}
			chans[ck] = ch
		}
		start := time.Unix(d.start, 0).In(s.loc)
		end := bucketEnd(start, g, s.loc)

		var b Bucket
		if g == GrainHour {
			b, err = s.computeHour(ctx, accountID, ch, start, end)
		} else {
			child := GrainHour
			if g == GrainMonth {
				child = GrainDay
			}
			b, err = s.computeFromChildren(ctx, accountID, ch, g, child, start, end)
		}
		if err != nil {
			return done, err
		}
		if err := s.writeBucket(ctx, accountID, b); err != nil {
			return done, err
		}
		// Mark the parent BEFORE clearing this row, so a crash in between
		// re-does work rather than losing a summary.
		if pg, ok := parentGrain(g); ok {
			ps := bucketStart(start, pg, s.loc)
			if err := s.markDirty(ctx, accountID, ch, pg, ps.Unix(), s.now().Unix()); err != nil {
				return done, err
			}
		}
		if _, err := s.db.ExecContext(ctx, `
			DELETE FROM energy_rollup_dirty
			WHERE account_id = ? AND device_key = ? AND metric = ? AND grain = ?
			  AND tz = ? AND bucket_start = ? AND marked_at <= ?`,
			accountID, d.deviceKey, d.metric, string(g), s.TZ(), d.start, d.markedAt); err != nil {
			return done, err
		}
		done++
	}
	return done, nil
}

// computeHour derives one hour bucket from the delta and sample tables.
//
// The two things this function exists to get right:
//
//   - A delta crossing the bucket boundary is apportioned by TIME. Within a
//     normal sampling interval that is a routine boundary allocation, not a
//     claim about missing data, and it lands in KWh. Across a gap it IS a
//     claim, and it lands in EstimatedKWh as well.
//   - A gap-spanning delta contributes NO coverage. Otherwise a two-hour
//     outage bracketed by two readings would present as a fully covered
//     period, which is precisely the confident wrong number this package
//     exists to prevent.
func (s *Store) computeHour(ctx context.Context, accountID string, ch Channel, start, end time.Time) (Bucket, error) {
	st, en := start.Unix(), end.Unix()
	b := Bucket{
		DeviceKey:       ch.DeviceKey,
		Metric:          ch.Metric,
		Grain:           GrainHour,
		TZ:              s.TZ(),
		Start:           start,
		End:             end,
		ExpectedSeconds: en - st,
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT from_at, to_at, kwh, quality, spans_gap
		FROM energy_deltas
		WHERE account_id = ? AND device_key = ? AND metric = ?
		  AND to_at > ? AND from_at < ?
		ORDER BY to_at`, accountID, ch.DeviceKey, ch.Metric, st, en)
	if err != nil {
		return b, err
	}
	var total, est float64
	attributed := false
	for rows.Next() {
		var fromAt, toAt int64
		var kwh float64
		var quality string
		var spans int
		if err := rows.Scan(&fromAt, &toAt, &kwh, &quality, &spans); err != nil {
			rows.Close()
			return b, err
		}
		ov := overlapSeconds(fromAt, toAt, st, en)
		if ov <= 0 {
			continue
		}
		b.DeltaCount++
		dur := toAt - fromAt
		portion := kwh * float64(ov) / float64(dur)
		if spans != 0 {
			if s.interpolateCounterGaps {
				total += portion
				est += portion
				attributed = true
			}
			// No coverage either way: the interior was never observed.
		} else {
			total += portion
			b.CoverageSeconds += ov
			attributed = true
		}
		if DeltaQuality(quality) == DeltaReset && toAt > st && toAt <= en {
			b.ResetCount++
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return b, err
	}

	if err := s.db.QueryRowContext(ctx, `
		SELECT count(*) FROM energy_samples
		WHERE account_id = ? AND device_key = ? AND metric = ? AND at >= ? AND at < ?`,
		accountID, ch.DeviceKey, ch.Metric, st, en).Scan(&b.SampleCount); err != nil {
		return b, err
	}

	if ch.Kind == KindPower {
		var mn, mx, avg sql.NullFloat64
		if err := s.db.QueryRowContext(ctx, `
			SELECT min(value), max(value), avg(value) FROM energy_samples
			WHERE account_id = ? AND device_key = ? AND metric = ?
			  AND value IS NOT NULL AND at >= ? AND at < ?`,
			accountID, ch.DeviceKey, ch.Metric, st, en).Scan(&mn, &mx, &avg); err != nil {
			return b, err
		}
		if mn.Valid {
			b.MinKW = fptr(mn.Float64 * ch.Scale)
		}
		if mx.Valid {
			b.MaxKW = fptr(mx.Float64 * ch.Scale)
		}
		if avg.Valid {
			// A plain mean of the samples in the bucket, not a time-weighted
			// one. Stated rather than implied: with an even sampling interval
			// they agree, and with an uneven one the time-weighted figure
			// would be a different quantity that a gap would silently distort.
			b.MeanKW = fptr(avg.Float64 * ch.Scale)
		}
	}

	if attributed {
		b.KWh = fptr(total)
		b.EstimatedKWh = est
	}
	b.Quality = qualityOf(b)
	return b, nil
}

// computeFromChildren derives a day from its hours, or a month from its days.
// Summaries are built from summaries so that a late sample re-rolls one hour
// and two parents, not a year of raw rows.
//
// Hours with no stored row contribute nothing — which is exactly right: they
// add no coverage, so they widen the day's gap and the day reports as partial.
func (s *Store) computeFromChildren(ctx context.Context, accountID string, ch Channel, g, child Grain, start, end time.Time) (Bucket, error) {
	st, en := start.Unix(), end.Unix()
	b := Bucket{
		DeviceKey:       ch.DeviceKey,
		Metric:          ch.Metric,
		Grain:           g,
		TZ:              s.TZ(),
		Start:           start,
		End:             end,
		ExpectedSeconds: en - st,
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT kwh, estimated_kwh, coverage_seconds, sample_count, delta_count,
		       reset_count, min_kw, max_kw, mean_kw, quality
		FROM energy_rollups
		WHERE account_id = ? AND device_key = ? AND metric = ? AND grain = ? AND tz = ?
		  AND bucket_start >= ? AND bucket_start < ?`,
		accountID, ch.DeviceKey, ch.Metric, string(child), s.TZ(), st, en)
	if err != nil {
		return b, err
	}
	var total, est, meanNum float64
	var meanDen int64
	attributed := false
	for rows.Next() {
		var kwh, mn, mx, mean sql.NullFloat64
		var e float64
		var cov, samples, deltas, resets int64
		var quality string
		if err := rows.Scan(&kwh, &e, &cov, &samples, &deltas, &resets, &mn, &mx, &mean, &quality); err != nil {
			rows.Close()
			return b, err
		}
		if kwh.Valid {
			total += kwh.Float64
			attributed = true
		}
		est += e
		b.CoverageSeconds += cov
		b.SampleCount += samples
		b.DeltaCount += deltas
		b.ResetCount += resets
		if mn.Valid && (b.MinKW == nil || mn.Float64 < *b.MinKW) {
			b.MinKW = fptr(mn.Float64)
		}
		if mx.Valid && (b.MaxKW == nil || mx.Float64 > *b.MaxKW) {
			b.MaxKW = fptr(mx.Float64)
		}
		if mean.Valid && samples > 0 {
			meanNum += mean.Float64 * float64(samples)
			meanDen += samples
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return b, err
	}
	if meanDen > 0 {
		b.MeanKW = fptr(meanNum / float64(meanDen))
	}
	if attributed {
		b.KWh = fptr(total)
		b.EstimatedKWh = est
	}
	b.Quality = qualityOf(b)
	return b, nil
}

// qualityOf assigns a bucket's honesty label.
//
// Precedence, and why:
//
//	empty     — nothing was recorded at all. KWh is nil.
//	partial   — a counter reset falls inside. This outranks the estimate label
//	            because a reset makes the figure a FLOOR, which is the stronger
//	            caveat: an estimate can be too high or too low, a post-reset
//	            total can only be too low.
//	estimated — a gap was filled by interpolation.
//	partial   — a gap exists and was not filled.
//	complete  — fully covered, no reset, nothing interpolated.
//
// The label is a summary. ResetCount and EstimatedKWh are always populated
// whatever it says, and a caller that needs both facts reads both fields.
func qualityOf(b Bucket) Quality {
	if b.SampleCount == 0 && b.DeltaCount == 0 {
		return QualityEmpty
	}
	if b.ResetCount > 0 {
		return QualityPartial
	}
	gap := b.GapSeconds()
	if gap > 0 && b.EstimatedKWh != 0 {
		return QualityEstimated
	}
	if gap > 0 {
		return QualityPartial
	}
	return QualityComplete
}

func (s *Store) writeBucket(ctx context.Context, accountID string, b Bucket) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO energy_rollups
		    (account_id, device_key, metric, grain, tz, bucket_start, bucket_end,
		     kwh, estimated_kwh, coverage_seconds, expected_seconds,
		     sample_count, delta_count, reset_count, min_kw, max_kw, mean_kw,
		     quality, computed_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT (account_id, device_key, metric, grain, tz, bucket_start) DO UPDATE SET
		    bucket_end = excluded.bucket_end,
		    kwh = excluded.kwh,
		    estimated_kwh = excluded.estimated_kwh,
		    coverage_seconds = excluded.coverage_seconds,
		    expected_seconds = excluded.expected_seconds,
		    sample_count = excluded.sample_count,
		    delta_count = excluded.delta_count,
		    reset_count = excluded.reset_count,
		    min_kw = excluded.min_kw,
		    max_kw = excluded.max_kw,
		    mean_kw = excluded.mean_kw,
		    quality = excluded.quality,
		    computed_at = excluded.computed_at`,
		accountID, b.DeviceKey, b.Metric, string(b.Grain), b.TZ, b.Start.Unix(), b.End.Unix(),
		toNull(b.KWh), b.EstimatedKWh, b.CoverageSeconds, b.ExpectedSeconds,
		b.SampleCount, b.DeltaCount, b.ResetCount,
		toNull(b.MinKW), toNull(b.MaxKW), toNull(b.MeanKW),
		string(b.Quality), s.now().Unix())
	return err
}

// SeriesQuery selects a dense run of buckets.
type SeriesQuery struct {
	// DeviceKey and Metric narrow the channels; empty means all of them.
	DeviceKey string
	Metric    string
	Grain     Grain
	From, To  time.Time
	// IncludeDisabled includes channels an operator has turned off.
	IncludeDisabled bool
}

// Series returns buckets for every matching channel over [From, To), DENSE:
// a bucket with no stored rollup is synthesised as QualityEmpty with a nil
// KWh rather than omitted.
//
// That is the whole reason this returns a dense run. A sparse series makes a
// two-hour outage indistinguishable from two hours of zero draw at the point
// where a chart interpolates between the surrounding points, and the resulting
// picture is a confident straight line across the part nobody measured.
//
// Series does not compute. Call [Store.Rollup] after ingesting, and check
// [Store.PendingRollups] if a surface needs to say whether it is current.
func (s *Store) Series(ctx context.Context, accountID string, q SeriesQuery) ([]Bucket, error) {
	if accountID == "" {
		return nil, errInvalid("account id is empty")
	}
	if !q.Grain.valid() {
		return nil, errInvalid("unknown grain %q", string(q.Grain))
	}
	if !q.To.After(q.From) {
		return nil, errInvalid("series window is empty")
	}
	chans, err := s.Channels(ctx, accountID)
	if err != nil {
		return nil, err
	}

	from := bucketStart(q.From, q.Grain, s.loc)
	var out []Bucket
	for _, ch := range chans {
		if q.DeviceKey != "" && ch.DeviceKey != q.DeviceKey {
			continue
		}
		if q.Metric != "" && ch.Metric != q.Metric {
			continue
		}
		if !ch.Enabled && !q.IncludeDisabled {
			continue
		}
		stored, err := s.storedBuckets(ctx, accountID, ch, q.Grain, from, q.To)
		if err != nil {
			return nil, err
		}
		var walkErr error
		walkBuckets(from, q.To, q.Grain, s.loc, func(start, end time.Time) bool {
			if len(out) >= maxSeriesBuckets {
				walkErr = errInvalid("series would exceed %d buckets; narrow the window or coarsen the grain", maxSeriesBuckets)
				return false
			}
			if b, ok := stored[start.Unix()]; ok {
				out = append(out, b)
				return true
			}
			out = append(out, Bucket{
				DeviceKey:       ch.DeviceKey,
				Metric:          ch.Metric,
				Grain:           q.Grain,
				TZ:              s.TZ(),
				Start:           start,
				End:             end,
				ExpectedSeconds: end.Unix() - start.Unix(),
				Quality:         QualityEmpty,
			})
			return true
		})
		if walkErr != nil {
			return nil, walkErr
		}
	}
	return out, nil
}

func (s *Store) storedBuckets(ctx context.Context, accountID string, ch Channel, g Grain, from, to time.Time) (map[int64]Bucket, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT bucket_start, bucket_end, kwh, estimated_kwh, coverage_seconds,
		       expected_seconds, sample_count, delta_count, reset_count,
		       min_kw, max_kw, mean_kw, quality
		FROM energy_rollups
		WHERE account_id = ? AND device_key = ? AND metric = ? AND grain = ? AND tz = ?
		  AND bucket_start >= ? AND bucket_start < ?`,
		accountID, ch.DeviceKey, ch.Metric, string(g), s.TZ(), from.Unix(), to.Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]Bucket{}
	for rows.Next() {
		var start, end int64
		var kwh, mn, mx, mean sql.NullFloat64
		var quality string
		b := Bucket{DeviceKey: ch.DeviceKey, Metric: ch.Metric, Grain: g, TZ: s.TZ()}
		if err := rows.Scan(&start, &end, &kwh, &b.EstimatedKWh, &b.CoverageSeconds,
			&b.ExpectedSeconds, &b.SampleCount, &b.DeltaCount, &b.ResetCount,
			&mn, &mx, &mean, &quality); err != nil {
			return nil, err
		}
		b.Start = time.Unix(start, 0).In(s.loc)
		b.End = time.Unix(end, 0).In(s.loc)
		b.KWh, b.MinKW, b.MaxKW, b.MeanKW = nullF(kwh), nullF(mn), nullF(mx), nullF(mean)
		b.Quality = Quality(quality)
		out[start] = b
	}
	return out, rows.Err()
}

// PruneSamples deletes raw samples older than before.
//
// Deltas are NEVER pruned: they are small, they carry the raw counter
// endpoints, and they are the evidence a bill dispute is argued from. Samples
// are the bulk and are reconstructible only in the sense that nothing needs
// them once the deltas exist.
//
// It refuses while any bucket at or before the cutoff is still dirty. Deleting
// the samples a queued rollup has not read yet would turn a pending
// recomputation into a permanently wrong bucket, and the wrongness would be
// invisible.
func (s *Store) PruneSamples(ctx context.Context, accountID string, before time.Time) (int64, error) {
	if accountID == "" {
		return 0, errInvalid("account id is empty")
	}
	var pending int
	if err := s.db.QueryRowContext(ctx, `
		SELECT count(*) FROM energy_rollup_dirty
		WHERE account_id = ? AND bucket_start < ?`, accountID, before.Unix()).Scan(&pending); err != nil {
		return 0, err
	}
	if pending > 0 {
		return 0, errInvalid("%d rollup buckets before the cutoff are still pending; run Rollup first", pending)
	}
	// Never delete a channel's most recent sample, however old it is.
	//
	// Deltas are derived from CONSECUTIVE samples: rederiveDeltas finds the
	// previous endpoint with `max(at) ... at < minAt` and pairs the two. So the
	// newest sample of every channel is the anchor the next reading pairs
	// against. Prune it and a meter that has been silent for longer than the
	// retention window comes back to find no predecessor — its consumption
	// produces no delta at all, and the loss is invisible because the reading
	// itself was accepted.
	//
	// The cost of keeping it is one row per channel, permanently. That is
	// nothing against the bulk this deletes, and it is what makes a retention
	// window safe to switch on by default rather than a trap for anyone whose
	// meter drops off for a month.
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM energy_samples
		 WHERE account_id = ? AND at < ?
		   AND (device_key, metric, at) NOT IN (
		         SELECT device_key, metric, max(at) FROM energy_samples
		          WHERE account_id = ? GROUP BY device_key, metric)`,
		accountID, before.Unix(), accountID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// SampleSpan reports the first and last retained sample for an account.
//
// "Retained" is the operative word. Samples are pruned on a window
// (PruneSamples, AQL_ENERGY_SAMPLE_RETENTION, 30 days by default), and rollups
// can only ever be rebuilt from samples that still exist. So this is not "when
// did this account start metering" — it is "how far back can anything be
// recomputed", which is the question a rebuild has to ask before it promises
// anything.
//
// ok is false when the account has no samples at all.
func (s *Store) SampleSpan(ctx context.Context, accountID string) (first, last time.Time, ok bool, err error) {
	var lo, hi sql.NullInt64
	err = s.db.QueryRowContext(ctx,
		`SELECT MIN(at), MAX(at) FROM energy_samples WHERE account_id = ?`, accountID).Scan(&lo, &hi)
	if err != nil {
		return time.Time{}, time.Time{}, false, err
	}
	if !lo.Valid || !hi.Valid {
		return time.Time{}, time.Time{}, false, nil
	}
	return time.Unix(lo.Int64, 0), time.Unix(hi.Int64, 0), true, nil
}

// MarkRangeDirty queues every hour bucket in [from, to] for recomputation under
// the store's CURRENT timezone, for every channel the account has.
//
// This is the missing half of a timezone change. Rollups carry their timezone in
// their identity, reads filter on the current one, and the incremental engine
// only ever recomputes what ingest marked — so after AQL_ENERGY_TZ changes, the
// history exists under the old zone and no query will ever ask for it again.
// Marking the range dirty makes the ordinary Rollup path rebuild it under the
// new zone, from the samples.
//
// Additive and idempotent. It writes no rollup itself, destroys nothing, and the
// buckets under the previous timezone are left exactly where they are — a rebuild
// that deleted them would turn a recoverable mistake into an unrecoverable one if
// the new zone were also wrong.
func (s *Store) MarkRangeDirty(ctx context.Context, accountID string, from, to time.Time) (int, error) {
	chans, err := s.Channels(ctx, accountID)
	if err != nil {
		return 0, err
	}
	if len(chans) == 0 {
		return 0, nil
	}
	start := bucketStart(from, GrainHour, s.loc)
	end := bucketStart(to, GrainHour, s.loc)
	now := s.now().Unix()

	// No transaction, deliberately. This package takes a narrow DB interface
	// with no BeginTx — a constraint that exists so it cannot reach past the
	// tables it owns — and widening it for convenience here would be the wrong
	// trade. It does not need one: every insert is ON CONFLICT DO NOTHING, so an
	// interrupted run leaves a prefix of the range marked and re-running finishes
	// the job. A half-marked range is not a corrupt state, it is a smaller one.
	marked := 0
	for _, ch := range chans {
		for t := start; !t.After(end); t = bucketStart(t.Add(90*time.Minute), GrainHour, s.loc) {
			// Advancing by 90 minutes and re-truncating rather than adding an
			// hour: a DST transition makes the next hour boundary 30, 45 or 60
			// minutes away depending on the zone, and adding a fixed hour would
			// skip or repeat a bucket at exactly the moment the arithmetic
			// matters most.
			res, err := s.db.ExecContext(ctx, `
				INSERT INTO energy_rollup_dirty
				    (account_id, device_key, metric, grain, tz, bucket_start, marked_at)
				VALUES (?,?,?,?,?,?,?)
				ON CONFLICT (account_id, device_key, metric, grain, tz, bucket_start) DO NOTHING`,
				accountID, ch.DeviceKey, ch.Metric, string(GrainHour), s.TZ(), t.Unix(), now)
			if err != nil {
				return 0, err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				marked++
			}
			if ctx.Err() != nil {
				return 0, ctx.Err()
			}
		}
	}
	return marked, nil
}
