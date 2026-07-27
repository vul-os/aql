package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/energy"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// newEnergyTestServer is newTestServerWithStore with metering wired, so the
// routes answer for real rather than 503.
func newEnergyTestServer(t *testing.T) (http.Handler, *store.Store, *energy.Store) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	est := energy.NewStore(st.DB())
	s := New(Config{
		Version:   "test",
		JWTSecret: []byte("0123456789abcdef0123456789abcdef"),
		Energy:    est,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router(), st, est
}

// A hub with no meter is not a broken hub. The distinction matters to whoever
// is debugging: 404 sends them hunting for a typo in the URL, 503 with a named
// rec.Code sends them to their configuration, which is where the problem is.
func TestEnergyWithoutAMeterSays503NotFound(t *testing.T) {
	h := newTestServer(t, "") // no Energy in Config — the shipped default
	access, _ := register(t, h, "nometer")
	acct, _ := tenantIDs(t, h, access)

	for _, path := range []string{"/energy/channels", "/energy/series", "/energy/mix"} {
		rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+path, access, nil)
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("%s: status %d, want 503 — a route that exists but has no meter "+
				"behind it is unavailable, not missing", path, rec.Code)
		}
		if out["error"] != "energy_not_configured" {
			t.Errorf("%s: error %v, want a rec.Code that points at configuration", path, out["error"])
		}
	}
}

// Energy is account-scoped like everything else. A neighbour must not be able
// to read the household's consumption by guessing an id.
func TestEnergyIsAccountScoped(t *testing.T) {
	h, _, _ := newEnergyTestServer(t)
	accessA, _ := register(t, h, "energy-a")
	accessB, _ := register(t, h, "energy-b")
	acctA, _ := tenantIDs(t, h, accessA)

	for _, path := range []string{"/energy/channels", "/energy/series", "/energy/mix"} {
		rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acctA+path, accessB, nil)
		if rec.Code == http.StatusOK {
			t.Errorf("%s: account B read account A's energy", path)
		}
	}
}

// Every member reads, not just admins. Household consumption is not private
// between members of the same household, and an Energy view that is empty for
// most people is how a working feature gets remembered as broken.
func TestEnergyReadableByAnyMember(t *testing.T) {
	h, _, _ := newEnergyTestServer(t)
	access, _ := register(t, h, "energy-owner")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/energy/channels", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("channels: status %d", rec.Code)
	}
	if _, ok := out["channels"]; !ok {
		t.Error("no channels key; an empty fleet must still answer with an empty list")
	}
	if out["tz"] == "" || out["tz"] == nil {
		t.Error("no timezone; a bucket boundary is meaningless without one")
	}
}

// The grain vocabulary is closed. "week" quietly becoming "hour" would return
// a plausible chart of the wrong thing, which is worse than an error.
func TestUnknownGrainIsRefusedRatherThanDefaulted(t *testing.T) {
	h, _, _ := newEnergyTestServer(t)
	access, _ := register(t, h, "energy-grain")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "GET",
		"/v1/accounts/"+acct+"/energy/series?grain=week", access, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400 for an unknown grain", rec.Code)
	}
	if out["error"] != "unknown_grain" {
		t.Errorf("error %v, want unknown_grain", out["error"])
	}

	for _, g := range []string{"hour", "day", "month"} {
		rec, _ := doJSON(t, h, "GET",
			"/v1/accounts/"+acct+"/energy/series?grain="+g, access, nil)
		if rec.Code != http.StatusOK {
			t.Errorf("grain %q: status %d, want 200", g, rec.Code)
		}
	}
}

// A window that cannot be drawn is refused with a reason, not silently
// clamped: a caller who asked for ten years and got a week back would believe
// the ten years were empty.
func TestWindowValidation(t *testing.T) {
	h, _, _ := newEnergyTestServer(t)
	access, _ := register(t, h, "energy-window")
	acct, _ := tenantIDs(t, h, access)
	base := "/v1/accounts/" + acct + "/energy/series?"

	for _, tc := range []struct{ query, want string }{
		{"from=notanumber", "invalid_from"},
		{"to=notanumber", "invalid_to"},
		{"from=2000&to=1000", "empty_window"}, // backwards
		{"from=1000&to=1000", "empty_window"}, // zero-width
		{"from=0&to=99999999999", "window_too_large"},
	} {
		rec, out := doJSON(t, h, "GET", base+tc.query, access, nil)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", tc.query, rec.Code)
			continue
		}
		if out["error"] != tc.want {
			t.Errorf("%s: error %v, want %s", tc.query, out["error"], tc.want)
		}
	}
}

// The point of this whole file. internal/energy takes real trouble to never
// state a number it cannot support — Quality, EstimatedKWh, and a
// coverage/expected pair on every bucket; Complete and Attributed on a mix.
// Those must survive the trip through JSON, because a caller that receives a
// bare kWh figure has no way to know a meter was offline for half the window.
//
// This test names the fields explicitly so that dropping one "for a cleaner
// payload" fails here rather than showing up as a confidently wrong chart.
func TestHonestyFieldsSurviveSerialisation(t *testing.T) {
	h, _, _ := newEnergyTestServer(t)
	access, _ := register(t, h, "energy-honest")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/energy/mix", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("mix: status %d", rec.Code)
	}
	for _, field := range []string{
		"complete", "attributed", "estimated_kwh",
		"coverage_seconds", "expected_seconds", "reset_count", "channels",
		"unattributed_kwh", "supply_kwh", "sink_kwh", "net_consumption_kwh",
	} {
		if _, ok := out[field]; !ok {
			t.Errorf("mix response dropped %q — a renderer cannot tell a measured "+
				"total from a guessed one without it", field)
		}
	}

	rec, out = doJSON(t, h, "GET", "/v1/accounts/"+acct+"/energy/series", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("series: status %d", rec.Code)
	}
	for _, field := range []string{"buckets", "grain", "from", "to", "tz", "pending_rollups"} {
		if _, ok := out[field]; !ok {
			t.Errorf("series response has no %q", field)
		}
	}
}

// bucketJSON keeps kwh nullable. An hour nobody measured and an hour that used
// no electricity are different facts; a chart that draws them the same way
// hides an outage.
func TestUnmeasuredBucketIsNullNotZero(t *testing.T) {
	// Assert on the ENCODED bytes, not the map. A (*float64)(nil) stored in an
	// `any` is not untyped nil, so `m["kwh"] != nil` is true for a value that
	// JSON renders as null — the map comparison would pass while proving
	// nothing. What a caller receives is the contract.
	unmeasured, err := json.Marshal(bucketJSON(energy.Bucket{Quality: energy.QualityEmpty}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(unmeasured), `"kwh":null`) {
		t.Fatalf("an unmeasured bucket did not render kwh as null; an outage would "+
			"look identical to using nothing: %s", unmeasured)
	}
	zero := 0.0
	measured, err := json.Marshal(bucketJSON(energy.Bucket{KWh: &zero, Quality: energy.QualityComplete}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(measured), `"kwh":0`) {
		t.Fatalf("a measured zero did not render as 0: %s", measured)
	}
}
