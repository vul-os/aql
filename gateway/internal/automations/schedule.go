package automations

import (
	"time"
)

// Schedule is a time-of-day on chosen weekdays, in a named timezone.
//
// # Why this shape and not cron
//
// The brief for this package allowed a cron dependency with justification.
// There is none, for three reasons:
//
//   - A cron expression is a small language, and every field of it is a way to
//     say something nobody reviewed. "*/5 * * * *" on a rule that actuates is a
//     legitimate expression and a bad idea; a shape that cannot express it does
//     not need a policy against it. The same argument the verb catalogue makes.
//   - The state that survives a restart is not the expression, it is
//     "which occurrence have I already accounted for". That is
//     LastOccurrenceAt, and it is the same one line of state whether the
//     expression is cron or this. A cron library would not have carried it.
//   - The hub's clock discipline is already unix seconds everywhere
//     (store.now(), keys.ClockSkewSeconds, hub.LateAckWindow) plus an
//     injectable now() for tests (devices.Registry, httpdev.Driver). A cron
//     scheduler brings its own clock and its own goroutine, and the first
//     thing a test would have to do is take both away.
//
// So: one occurrence per selected weekday, at MinuteOfDay local time. No
// sub-daily intervals, no sunrise/sunset, no seconds field. Stated as a
// limitation, not sold as a feature — see the package report.
//
// # DST
//
// Occurrences are computed with time.Date in the schedule's own location, so a
// local minute maps to exactly ONE instant per calendar day. On a spring-forward
// day a 02:30 rule normalises forward to 03:30 (it runs, an hour late in
// absolute terms, at the right position in the day); on a fall-back day the
// repeated local hour yields the FIRST of the two instants and the rule runs
// once, not twice. A duplicate run is the failure mode that matters — the same
// action twice, unattended — so the tie is broken in that direction.
type Schedule struct {
	// MinuteOfDay is 0..1439, local to TZ. 0 is midnight.
	MinuteOfDay int `json:"minute_of_day"`
	// Days is a weekday bitmask, bit i = time.Weekday(i) (bit 0 = Sunday).
	// 0 is invalid rather than "every day": a zero value that meant "always"
	// would make a forgotten field the most permissive setting. EveryDay is
	// the explicit way to say it.
	Days uint8 `json:"days"`
	// TZ is an IANA name ("Africa/Johannesburg"). Empty means UTC. A schedule
	// written in local time keeps meaning the same thing across a DST shift,
	// which is what a resident means by "at seven".
	TZ string `json:"tz,omitempty"`
}

// EveryDay is the all-weekdays mask.
const EveryDay uint8 = 0x7f

// Weekdays returns the mask for a set of weekdays.
func Weekdays(days ...time.Weekday) uint8 {
	var m uint8
	for _, d := range days {
		m |= 1 << uint(d)
	}
	return m
}

// Validate fails closed on an out-of-range minute, an empty or out-of-range
// weekday mask, or a timezone this build cannot load (a schedule whose
// timezone silently fell back to UTC would fire at the wrong hour, which for
// an unattended actuation is not a cosmetic error).
func (s *Schedule) Validate() error {
	if s == nil {
		return refuse(ReasonInvalidSchedule, "no schedule")
	}
	if s.MinuteOfDay < 0 || s.MinuteOfDay > 1439 {
		return refuse(ReasonInvalidSchedule, "minute of day %d is not in 0..1439", s.MinuteOfDay)
	}
	if s.Days == 0 || s.Days&^EveryDay != 0 {
		return refuse(ReasonInvalidSchedule, "weekday mask %#x selects no valid day", s.Days)
	}
	if _, err := s.Location(); err != nil {
		return err
	}
	return nil
}

// Location resolves TZ. Empty is UTC; anything unloadable is a refusal, never
// a silent fallback.
func (s *Schedule) Location() (*time.Location, error) {
	if s.TZ == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(s.TZ)
	if err != nil {
		return nil, refuse(ReasonInvalidSchedule, "unknown timezone %q", s.TZ)
	}
	return loc, nil
}

// Selects reports whether the mask includes a weekday.
func (s *Schedule) Selects(d time.Weekday) bool { return s.Days&(1<<uint(d)) != 0 }

// NextAfter returns the first occurrence STRICTLY after t.
//
// Strictly-after is what makes the scheduler's catch-up loop terminate and
// makes an occurrence fire at most once: the loop advances its anchor to each
// occurrence it accounts for, so the same instant can never be returned twice.
func (s *Schedule) NextAfter(t time.Time) (time.Time, error) {
	if err := s.Validate(); err != nil {
		return time.Time{}, err
	}
	loc, err := s.Location()
	if err != nil {
		return time.Time{}, err
	}
	local := t.In(loc)
	y, m, d := local.Date()
	// Eight days, not seven: the candidate for day offset 0 may already have
	// passed, so a mask selecting only today's weekday needs offset 7.
	for i := 0; i <= 7; i++ {
		cand := time.Date(y, m, d+i, 0, s.MinuteOfDay, 0, 0, loc)
		if !s.Selects(cand.Weekday()) {
			continue
		}
		if cand.After(t) {
			return cand, nil
		}
	}
	// Unreachable for a validated mask; refuse rather than return a zero time
	// that a caller might treat as "now".
	return time.Time{}, refuse(ReasonInvalidSchedule, "no occurrence within 8 days")
}
