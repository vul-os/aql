package store

import (
	"context"
	"testing"
)

// §4.4 rule 6's switch: occupancy proxies are off unless an operator has said
// otherwise, per location.

func disclosureFixture(t *testing.T) (*Store, context.Context, string, string, string) {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "disc@x.com", "hash", "D", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := s.CreateAccountWithOwner(ctx, u.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateLocationFull(ctx, acct.ID, CreateLocationArgs{Name: "Cottage", Type: "house"})
	if err != nil {
		t.Fatal(err)
	}
	return s, ctx, u.ID, loc.ID, other
}

// The default, and the only one that matters if everything else is wrong.
func TestOccupancyDisclosureIsOffUntilSomebodyTurnsItOn(t *testing.T) {
	s, ctx, _, loc, _ := disclosureFixture(t)
	if s.OccupancyDisclosureAllowed(ctx, loc) {
		t.Error("a location nobody has configured discloses occupancy")
	}
	// An unknown location is off too, rather than erroring into a truthy value.
	if s.OccupancyDisclosureAllowed(ctx, "no-such-location") {
		t.Error("an unknown location discloses occupancy")
	}
	if s.OccupancyDisclosureAllowed(ctx, "") {
		t.Error("an empty location id discloses occupancy")
	}
}

func TestConsentIsPerLocationNotPerAccount(t *testing.T) {
	s, ctx, user, loc, other := disclosureFixture(t)
	if err := s.SetOccupancyDisclosure(ctx, loc, user, true); err != nil {
		t.Fatal(err)
	}
	if !s.OccupancyDisclosureAllowed(ctx, loc) {
		t.Error("the opted-in location is still off")
	}
	// The second location in the SAME account must not inherit it: a household
	// consenting for the main house has not consented for the cottage.
	if s.OccupancyDisclosureAllowed(ctx, other) {
		t.Error("consent for one location leaked to another in the same account")
	}
}

// Withdrawing removes the row, so off has exactly one representation.
func TestWithdrawingConsentLeavesNoRow(t *testing.T) {
	s, ctx, user, loc, _ := disclosureFixture(t)
	if err := s.SetOccupancyDisclosure(ctx, loc, user, true); err != nil {
		t.Fatal(err)
	}
	if err := s.SetOccupancyDisclosure(ctx, loc, user, false); err != nil {
		t.Fatal(err)
	}
	if s.OccupancyDisclosureAllowed(ctx, loc) {
		t.Error("consent survived being withdrawn")
	}
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM location_disclosure WHERE location_id = ?`, loc).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d rows remain after withdrawal — off must have one representation, not two", n)
	}
}

// Who turned it on is recorded, because a privacy control nobody can audit is
// not a control.
func TestWhoEnabledDisclosureIsRecorded(t *testing.T) {
	s, ctx, user, loc, _ := disclosureFixture(t)
	if err := s.SetOccupancyDisclosure(ctx, loc, user, true); err != nil {
		t.Fatal(err)
	}
	d, err := s.OccupancyDisclosureFor(ctx, loc)
	if err != nil {
		t.Fatal(err)
	}
	if !d.Enabled || !d.EnabledBy.Valid || d.EnabledBy.String != user {
		t.Errorf("consent record does not name who gave it: %+v", d)
	}
	if !d.EnabledAt.Valid || d.EnabledAt.Int64 == 0 {
		t.Errorf("consent record has no timestamp: %+v", d)
	}
}

// The batch reader answers only for the locations it was asked about, so a
// caller cannot widen its own scope by asking.
func TestTheBatchReaderAnswersOnlyForWhatItWasAsked(t *testing.T) {
	s, ctx, user, loc, other := disclosureFixture(t)
	if err := s.SetOccupancyDisclosure(ctx, loc, user, true); err != nil {
		t.Fatal(err)
	}
	if err := s.SetOccupancyDisclosure(ctx, other, user, true); err != nil {
		t.Fatal(err)
	}
	got, err := s.OccupancyDisclosureLocations(ctx, []string{loc})
	if err != nil {
		t.Fatal(err)
	}
	if !got[loc] {
		t.Error("the asked-for location is missing")
	}
	if got[other] {
		t.Error("a location that was not asked about came back")
	}
	if empty, err := s.OccupancyDisclosureLocations(ctx, nil); err != nil || len(empty) != 0 {
		t.Errorf("an empty request returned %v (%v)", empty, err)
	}
}
