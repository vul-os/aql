package energy

import "time"

// Bucket boundaries are anchored to a timezone, not to UTC arithmetic, because
// a bill is a local-time document. Two consequences the rest of the package
// relies on:
//
//   - A day is not always 86400 seconds. Under DST it is 82800 or 90000, and
//     an hour bucket at the transition is not always 3600. So every rollup row
//     stores its own expected_seconds rather than assuming a constant, and
//     completeness is measured against that.
//   - Some zones are offset by 30 or 45 minutes, so even hour buckets differ
//     from UTC hours. tz is part of the rollup primary key for that reason.

// bucketStart truncates t down to the start of its grain in loc.
func bucketStart(t time.Time, g Grain, loc *time.Location) time.Time {
	lt := t.In(loc)
	switch g {
	case GrainHour:
		return time.Date(lt.Year(), lt.Month(), lt.Day(), lt.Hour(), 0, 0, 0, loc)
	case GrainDay:
		return time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, loc)
	case GrainMonth:
		return time.Date(lt.Year(), lt.Month(), 1, 0, 0, 0, 0, loc)
	}
	return lt
}

// bucketEnd is the exclusive end of the bucket starting at start.
//
// It advances by calendar unit rather than by a fixed duration so a DST day is
// 23 or 25 hours, and it guards against a transition producing a
// non-advancing bucket (which would be an infinite loop in any range walk).
func bucketEnd(start time.Time, g Grain, loc *time.Location) time.Time {
	lt := start.In(loc)
	var end time.Time
	switch g {
	case GrainHour:
		end = lt.Add(time.Hour)
		// Adding an hour across a spring-forward keeps the wall clock honest;
		// re-truncating is what makes a 23-hour day's hour buckets tile.
		end = bucketStart(end, GrainHour, loc)
		if !end.After(lt) {
			end = lt.Add(time.Hour)
		}
	case GrainDay:
		end = time.Date(lt.Year(), lt.Month(), lt.Day()+1, 0, 0, 0, 0, loc)
	case GrainMonth:
		end = time.Date(lt.Year(), lt.Month()+1, 1, 0, 0, 0, 0, loc)
	default:
		end = lt
	}
	if !end.After(lt) {
		end = lt.Add(time.Hour)
	}
	return end
}

// walkBuckets calls fn for every bucket of grain g whose start lies in
// [from, to). from is truncated down; the walk stops at the first bucket
// starting at or after to.
func walkBuckets(from, to time.Time, g Grain, loc *time.Location, fn func(start, end time.Time) bool) {
	cur := bucketStart(from, g, loc)
	for cur.Before(to) {
		end := bucketEnd(cur, g, loc)
		if !fn(cur, end) {
			return
		}
		cur = end
	}
}

// overlapSeconds is the length of [aStart,aEnd) ∩ [bStart,bEnd) in seconds.
func overlapSeconds(aStart, aEnd, bStart, bEnd int64) int64 {
	lo := aStart
	if bStart > lo {
		lo = bStart
	}
	hi := aEnd
	if bEnd < hi {
		hi = bEnd
	}
	if hi <= lo {
		return 0
	}
	return hi - lo
}

// parentGrain is the grain a bucket rolls up into: hours make days, days make
// months. Months have no parent.
func parentGrain(g Grain) (Grain, bool) {
	switch g {
	case GrainHour:
		return GrainDay, true
	case GrainDay:
		return GrainMonth, true
	}
	return "", false
}
