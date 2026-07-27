package automations

import (
	"testing"
	"time"
)

func TestScheduleValidationFailsClosed(t *testing.T) {
	cases := []struct {
		name string
		s    Schedule
	}{
		{"negative minute", Schedule{MinuteOfDay: -1, Days: EveryDay}},
		{"minute past midnight", Schedule{MinuteOfDay: 1440, Days: EveryDay}},
		{"empty weekday mask", Schedule{MinuteOfDay: 60, Days: 0}},
		{"mask with a bit that is not a weekday", Schedule{MinuteOfDay: 60, Days: 0x80}},
		{"unknown timezone", Schedule{MinuteOfDay: 60, Days: EveryDay, TZ: "Mars/Olympus"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.s.Validate()
			if err == nil {
				t.Fatal("expected a refusal")
			}
			if RefusalReason(err) != ReasonInvalidSchedule {
				t.Fatalf("reason = %q, want %s", RefusalReason(err), ReasonInvalidSchedule)
			}
		})
	}
}

// A zero weekday mask must not mean "every day". A forgotten field being the
// most permissive setting is the shape of bug the whole package avoids.
func TestZeroWeekdayMaskIsNotEveryDay(t *testing.T) {
	s := Schedule{MinuteOfDay: 7 * 60}
	if err := s.Validate(); err == nil {
		t.Fatal("a zero mask must be invalid, not 'every day'")
	}
}

func TestNextAfterIsStrictlyAfter(t *testing.T) {
	s := Schedule{MinuteOfDay: 19 * 60, Days: EveryDay}
	at19 := time.Date(2026, 7, 27, 19, 0, 0, 0, time.UTC)
	next, err := s.NextAfter(at19)
	if err != nil {
		t.Fatalf("NextAfter: %v", err)
	}
	if !next.After(at19) {
		t.Fatalf("NextAfter(%v) = %v, must be strictly after", at19, next)
	}
	if want := at19.Add(24 * time.Hour); !next.Equal(want) {
		t.Fatalf("next = %v, want %v", next, want)
	}
}

func TestNextAfterHonoursTheWeekdayMask(t *testing.T) {
	// Mondays only. 2026-07-27 is a Monday.
	s := Schedule{MinuteOfDay: 7 * 60, Days: Weekdays(time.Monday)}
	from := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC) // Monday noon
	next, err := s.NextAfter(from)
	if err != nil {
		t.Fatalf("NextAfter: %v", err)
	}
	if next.Weekday() != time.Monday {
		t.Fatalf("next = %v (%s), want a Monday", next, next.Weekday())
	}
	if want := time.Date(2026, 8, 3, 7, 0, 0, 0, time.UTC); !next.Equal(want) {
		t.Fatalf("next = %v, want %v (the following Monday, not today's past 07:00)", next, want)
	}
	// Weekends.
	we := Schedule{MinuteOfDay: 9 * 60, Days: Weekdays(time.Saturday, time.Sunday)}
	next, err = we.NextAfter(from)
	if err != nil {
		t.Fatalf("NextAfter: %v", err)
	}
	if next.Weekday() != time.Saturday {
		t.Fatalf("next = %v (%s), want Saturday", next, next.Weekday())
	}
}

func TestNextAfterIsLocalToTheScheduleTimezone(t *testing.T) {
	s := Schedule{MinuteOfDay: 7 * 60, Days: EveryDay, TZ: "Africa/Johannesburg"} // UTC+2, no DST
	from := time.Date(2026, 7, 27, 0, 0, 0, 0, time.UTC)
	next, err := s.NextAfter(from)
	if err != nil {
		t.Fatalf("NextAfter: %v", err)
	}
	// 07:00 SAST is 05:00 UTC.
	if want := time.Date(2026, 7, 27, 5, 0, 0, 0, time.UTC); !next.Equal(want) {
		t.Fatalf("next = %v, want %v", next.UTC(), want)
	}
}

// DST, both directions. The property that matters is that a local schedule
// keeps producing exactly one occurrence per selected day, and never the same
// instant twice — a rule must not run twice because the clocks went back.
func TestScheduleAcrossDSTProducesOneOccurrencePerDay(t *testing.T) {
	for _, tc := range []struct {
		name   string
		minute int
		from   time.Time
	}{
		// US spring forward 2026-03-08: local 02:30 does not exist.
		{"spring forward", 2*60 + 30, time.Date(2026, 3, 6, 12, 0, 0, 0, time.UTC)},
		// US fall back 2026-11-01: local 01:30 happens twice.
		{"fall back", 1*60 + 30, time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Schedule{MinuteOfDay: tc.minute, Days: EveryDay, TZ: "America/New_York"}
			at := tc.from
			seen := map[int64]bool{}
			days := map[string]int{}
			for i := 0; i < 6; i++ {
				next, err := s.NextAfter(at)
				if err != nil {
					t.Fatalf("NextAfter: %v", err)
				}
				if !next.After(at) {
					t.Fatalf("occurrence %v did not advance past %v", next, at)
				}
				if seen[next.Unix()] {
					t.Fatalf("occurrence %v repeated", next)
				}
				seen[next.Unix()] = true
				days[next.In(next.Location()).Format("2006-01-02")]++
				at = next
			}
			for day, n := range days {
				if n != 1 {
					t.Fatalf("%s produced %d occurrences on one local day", day, n)
				}
			}
		})
	}
}

func TestCompareOpFailsClosedOnAnUnsetOperator(t *testing.T) {
	var op CompareOp
	if op.Valid() {
		t.Fatal("the zero CompareOp must not be valid")
	}
	if op.Holds(100, 1) || op.Holds(0, 1) {
		t.Fatal("an unset comparison must never hold")
	}
	if CompareOp("greater-ish").Holds(100, 1) {
		t.Fatal("an unknown comparison must never hold")
	}
}

func TestTriggerValidationFailsClosed(t *testing.T) {
	cases := []struct {
		name string
		trig Trigger
	}{
		{"no kind", Trigger{}},
		{"unknown kind", Trigger{Kind: "sunrise"}},
		{"schedule without a schedule", Trigger{Kind: TriggerSchedule}},
		{"threshold without a threshold", Trigger{Kind: TriggerThreshold}},
		{"event without an event", Trigger{Kind: TriggerEvent}},
		{"threshold with no device", Trigger{Kind: TriggerThreshold,
			Threshold: &Threshold{Metric: "percent", Op: OpBelow}}},
		{"threshold with no metric", Trigger{Kind: TriggerThreshold,
			Threshold: &Threshold{DeviceKey: "d", Op: OpBelow}}},
		{"threshold with an unset comparison", Trigger{Kind: TriggerThreshold,
			Threshold: &Threshold{DeviceKey: "d", Metric: "percent"}}},
		{"event with an unknown name", Trigger{Kind: TriggerEvent,
			Event: &Event{DeviceKey: "d", Name: "exploded"}}},
		{"payload from another kind", Trigger{Kind: TriggerSchedule,
			Schedule: &Schedule{MinuteOfDay: 60, Days: EveryDay},
			Event:    &Event{DeviceKey: "d", Name: EventOffline}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.trig.Validate(); err == nil {
				t.Fatal("expected a refusal")
			} else if !IsRefusal(err) {
				t.Fatalf("expected a Refusal, got %v", err)
			}
		})
	}
}

func TestActionValidationFailsClosed(t *testing.T) {
	cases := []struct {
		name string
		act  Action
	}{
		{"no target", Action{Verb: "on"}},
		{"both targets", Action{DeviceKey: "d", Zone: "z", Verb: "on"}},
		{"no verb", Action{DeviceKey: "d"}},
		{"blank verb", Action{DeviceKey: "d", Verb: "   "}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.act.Validate(); err == nil {
				t.Fatal("expected a refusal")
			}
		})
	}
}
