package energy

// Whose meter is this?
//
// Before ownership routing, PollOnce polled every CapMeter device the registry
// reported and wrote all of them under one process-wide -energy-account. That
// is exactly right for the single-household hub this product is mostly for,
// and wrong in BOTH directions the moment a second account exists: the account
// that claimed a meter saw nothing for it, while the configured account's
// Energy screen showed every meter on the hub including ones it never claimed.
//
// Nobody would notice either. A kWh figure has no tell — unlike a gate that
// fails to open, a wrong number is quietly believed.

import (
	"context"
	"errors"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

// ownerMap is a lookup over a fixed table, plus an optional key that always
// errors, so the error path can be exercised distinctly from "unclaimed".
func ownerMap(claims map[string]string, failFor string) OwnerFunc {
	return func(_ context.Context, deviceKey string) (string, bool, error) {
		if deviceKey == failFor {
			return "", false, errors.New("lookup unavailable")
		}
		if a, ok := claims[deviceKey]; ok {
			return a, true, nil
		}
		return "", false, nil
	}
}

// pollerFixture builds a poller over the mock driver's fleet, creating every
// account id the test will route to (they are foreign keys).
func pollerFixture(t *testing.T, defaultAccount string, accounts []string, opts ...PollerOption) (*Poller, *Store) {
	t.Helper()
	db := openTestDB(t)
	for _, a := range append([]string{defaultAccount}, accounts...) {
		newAccount(t, db, a)
	}
	st := NewStore(db)
	reg := devices.NewRegistry()
	if err := reg.Register(devices.NewMockDriver("mock")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	return NewPoller(reg, st, defaultAccount, opts...), st
}

func channelCount(t *testing.T, st *Store, accountID string) int {
	t.Helper()
	chans, err := st.Channels(context.Background(), accountID)
	if err != nil {
		t.Fatal(err)
	}
	return len(chans)
}

// With no lookup configured, nothing changes: every meter lands in the
// configured account. This is the deployment the product is mostly for, and a
// tenancy fix that made it claim every lamp before metering worked would be a
// worse product.
func TestWithoutAnOwnerLookupEveryMeterGoesToTheConfiguredAccount(t *testing.T) {
	p, st := pollerFixture(t, "acct-home", []string{"acct-other"})
	if _, err := p.PollOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := channelCount(t, st, "acct-home"); n == 0 {
		t.Fatal("the configured account has no channels; the poller wrote nothing")
	}
	if n := channelCount(t, st, "acct-other"); n != 0 {
		t.Errorf("an unrelated account has %d channels", n)
	}
}

// The fix: a claimed meter's history belongs to the account that claimed it,
// not to whichever account the operator happened to name on the command line.
func TestAClaimedMetersSamplesGoToItsOwner(t *testing.T) {
	meterKey := "mock:meter-1"
	p, st := pollerFixture(t, "acct-default", []string{"acct-claimer"},
		WithOwnerLookup(ownerMap(map[string]string{meterKey: "acct-claimer"}, "")))

	res, err := p.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Meters == 0 {
		t.Fatal("fixture: the mock driver reported no meters")
	}

	if n := channelCount(t, st, "acct-claimer"); n == 0 {
		t.Errorf(`the claiming account has no channels.

Its meter's readings went somewhere else — most likely the configured
-energy-account, which is the bug: an account that claimed a meter would see an
empty Energy screen for hardware it owns.`)
	}
	// And the configured account must NOT have picked it up.
	for _, ch := range mustChannels(t, st, "acct-default") {
		if ch.DeviceKey == meterKey {
			t.Errorf("the configured account holds a channel for a meter claimed by "+
				"someone else: %s", ch.DeviceKey)
		}
	}
}

// An unclaimed meter falls back to the configured account rather than being
// dropped. A hub that predates ownership has claimed nothing, and losing real
// metering history to be principled would be the wrong trade.
func TestAnUnclaimedMeterFallsBackToTheConfiguredAccount(t *testing.T) {
	p, st := pollerFixture(t, "acct-default", []string{"acct-other"},
		WithOwnerLookup(ownerMap(map[string]string{"mock:nothing-here": "acct-other"}, "")))

	if _, err := p.PollOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := channelCount(t, st, "acct-default"); n == 0 {
		t.Error("unclaimed meters were dropped instead of falling back to the configured account")
	}
}

// A lookup that ERRORED has not established that a meter is unclaimed. Filing
// it under the default account on that basis would invent an attribution, so
// those samples are skipped and counted.
func TestALookupFailureIsNotTreatedAsUnclaimed(t *testing.T) {
	meterKey := "mock:meter-1"
	p, st := pollerFixture(t, "acct-default", nil, WithOwnerLookup(ownerMap(nil, meterKey)))

	res, err := p.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Unattributed == 0 {
		t.Error("a failed ownership lookup was not counted; a persistent failure would be " +
			"invisible rather than showing as a meter that stopped reporting")
	}
	for _, ch := range mustChannels(t, st, "acct-default") {
		if ch.DeviceKey == meterKey {
			t.Error("a meter whose ownership could not be established was filed under the " +
				"default account anyway")
		}
	}
}

// Two accounts, two meters, one poll: each account sees only its own.
func TestTwoAccountsMetersDoNotMix(t *testing.T) {
	p, st := pollerFixture(t, "acct-default", []string{"acct-a"},
		WithOwnerLookup(ownerMap(map[string]string{"mock:meter-1": "acct-a"}, "")))
	if _, err := p.PollOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, ch := range mustChannels(t, st, "acct-a") {
		if ch.DeviceKey != "mock:meter-1" {
			t.Errorf("acct-a holds a channel for %s, which it did not claim", ch.DeviceKey)
		}
	}
}

func mustChannels(t *testing.T, st *Store, accountID string) []Channel {
	t.Helper()
	chans, err := st.Channels(context.Background(), accountID)
	if err != nil {
		t.Fatal(err)
	}
	return chans
}
