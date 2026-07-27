package httpapi

// Energy read surface.
//
// # Why this file exists at all
//
// internal/energy has been complete and tested for some time: ingestion,
// counter-reset handling, hour/day/month rollups and source-mix accounting. It
// ran as a background poller and nothing could read it. A runtime with no way
// to reach it is not a shipped feature, and this is the second instance of that
// exact shape found in one sitting — see cmd/gateway/devicewiring_test.go for
// the first.
//
// # The one rule every handler here follows
//
// THE HONESTY FIELDS ARE NOT OPTIONAL.
//
// internal/energy goes to considerable trouble to never state a number it
// cannot support. A bucket carries Quality, EstimatedKWh, and a
// coverage/expected pair; a mix carries Complete and Attributed. Those exist
// because a meter that was offline for half the window still produces a kWh
// figure, and rendering it beside a fully-measured one is a lie by omission.
//
// So every response below emits them alongside the value, always, even when
// they are boring. A caller that wants a single confident number has to
// actively discard the evidence that it is not one, which is the correct amount
// of friction. Dropping them "for a cleaner payload" would undo the whole
// design of the package underneath.
//
// # Read-only, deliberately
//
// There is no write path here. Channels are configured where devices are
// configured, and samples arrive from the poller reading real meters — an HTTP
// endpoint that injects energy samples is a way to forge a bill, and nothing in
// the product needs one. Rollups are driven by the background worker on the
// same schedule for everyone; an on-demand recompute endpoint would let any
// member spend the hub's whole CPU budget on request.
//
// # Access
//
// Every member of the account can read. Household consumption is not private
// between members of the same household, and a resident who cannot see the
// bill they are paying towards has a worse problem than the one hiding it would
// solve. Admin-only would also make the Energy view empty for most people,
// which is how a working feature gets remembered as broken.

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/gateway/internal/energy"
)

const (
	// energyMaxWindow bounds a query. A month grain over ten years is a
	// perfectly reasonable-looking request that returns very little and costs a
	// lot; the ceiling is generous for any real dashboard and finite for a
	// scraper.
	energyMaxWindow = 400 * 24 * time.Hour
	// energyDefaultWindow is what a caller gets with no explicit range: enough
	// to draw the usual "this week" chart.
	energyDefaultWindow = 7 * 24 * time.Hour
)

// channelJSON renders one configured reading stream.
//
// Scale, CounterMax and the gap tolerance are included even though no UI shows
// them today. They are how a surprising number gets explained — "the meter
// wraps at 99999" is the answer to a support question that is otherwise
// unanswerable from outside the box.
func channelJSON(c energy.Channel) map[string]any {
	return map[string]any{
		"device_key":            c.DeviceKey,
		"metric":                c.Metric,
		"kind":                  string(c.Kind),
		"source":                string(c.Source),
		"flow":                  string(c.Flow),
		"label":                 c.Label,
		"scale":                 c.Scale,
		"counter_max":           c.CounterMax,
		"max_kw":                c.MaxKW,
		"interval_seconds":      c.IntervalSeconds,
		"gap_tolerance_seconds": c.GapToleranceSeconds,
		"enabled":               c.Enabled,
		"created_at":            c.CreatedAt.Unix(),
		"updated_at":            c.UpdatedAt.Unix(),
	}
}

// bucketJSON renders one rollup bucket.
//
// kwh is a POINTER in the model and stays nullable here. A bucket with no
// reading is null, never 0 — an hour nobody measured and an hour that used no
// electricity are different facts, and a chart that draws them the same way is
// wrong in the direction that hides an outage.
func bucketJSON(b energy.Bucket) map[string]any {
	m := map[string]any{
		"device_key":       b.DeviceKey,
		"metric":           b.Metric,
		"grain":            string(b.Grain),
		"tz":               b.TZ,
		"start":            b.Start.Unix(),
		"end":              b.End.Unix(),
		"kwh":              b.KWh, // nil renders as JSON null, on purpose
		"estimated_kwh":    b.EstimatedKWh,
		"coverage_seconds": b.CoverageSeconds,
		"expected_seconds": b.ExpectedSeconds,
		"sample_count":     b.SampleCount,
		"delta_count":      b.DeltaCount,
		"reset_count":      b.ResetCount,
		"quality":          string(b.Quality),
		"min_kw":           b.MinKW,
		"max_kw":           b.MaxKW,
		"mean_kw":          b.MeanKW,
	}
	return m
}

func (s *Server) handleEnergyChannels(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	if _, ok := s.memberRole(w, r, accountID); !ok {
		return
	}
	est, ok := s.energyStore(w)
	if !ok {
		return
	}
	chans, err := est.Channels(r.Context(), accountID)
	if err != nil {
		s.log.Error("energy channels could not be read", "account", accountID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(chans))
	for _, c := range chans {
		out = append(out, channelJSON(c))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"channels": out,
		"tz":       est.TZ(),
	})
}

func (s *Server) handleEnergySeries(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	if _, ok := s.memberRole(w, r, accountID); !ok {
		return
	}
	est, ok := s.energyStore(w)
	if !ok {
		return
	}

	q := r.URL.Query()
	grain := energy.Grain(strings.TrimSpace(q.Get("grain")))
	if grain == "" {
		grain = energy.GrainHour
	}
	switch grain {
	case energy.GrainHour, energy.GrainDay, energy.GrainMonth:
	default:
		// A closed vocabulary, refused by name. "week" silently becoming
		// "hour" would return a plausible chart of the wrong thing.
		writeErr(w, http.StatusBadRequest, "unknown_grain")
		return
	}

	from, to, err := energyWindow(q, est.Location())
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	buckets, err := est.Series(r.Context(), accountID, energy.SeriesQuery{
		DeviceKey: strings.TrimSpace(q.Get("device_key")),
		Metric:    strings.TrimSpace(q.Get("metric")),
		Grain:     grain,
		From:      from,
		To:        to,
		// Disabled channels are excluded. An operator who turned a meter off
		// does not want its history silently folded into a household total;
		// they can re-enable it if they do.
		IncludeDisabled: false,
	})
	if err != nil {
		s.log.Error("energy series could not be read", "account", accountID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	out := make([]map[string]any, 0, len(buckets))
	for _, b := range buckets {
		out = append(out, bucketJSON(b))
	}
	// pending is how many rollups the background worker still owes. A caller
	// that sees a non-zero count knows the tail of the series may still move,
	// which is the difference between "usage dropped" and "not summed yet".
	pending, err := est.PendingRollups(r.Context(), accountID)
	if err != nil {
		s.log.Warn("pending rollup count unavailable", "account", accountID, "err", err)
		pending = -1
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"buckets":         out,
		"grain":           string(grain),
		"from":            from.Unix(),
		"to":              to.Unix(),
		"tz":              est.TZ(),
		"pending_rollups": pending,
	})
}

func (s *Server) handleEnergyMix(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	if _, ok := s.memberRole(w, r, accountID); !ok {
		return
	}
	est, ok := s.energyStore(w)
	if !ok {
		return
	}
	from, to, err := energyWindow(r.URL.Query(), est.Location())
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	mix, err := est.SourceMix(r.Context(), accountID, from, to)
	if err != nil {
		s.log.Error("source mix could not be computed", "account", accountID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	totals := make([]map[string]any, 0, len(mix.Totals))
	for _, t := range mix.Totals {
		totals = append(totals, map[string]any{
			"source":           string(t.Source),
			"flow":             string(t.Flow),
			"kwh":              t.KWh,
			"estimated_kwh":    t.EstimatedKWh,
			"coverage_seconds": t.CoverageSeconds,
			"expected_seconds": t.ExpectedSeconds,
			"reset_count":      t.ResetCount,
			"channels":         t.Channels,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"from":   mix.From.Unix(),
		"to":     mix.To.Unix(),
		"tz":     mix.TZ,
		"totals": totals,

		"supply_kwh":          mix.SupplyKWh,
		"sink_kwh":            mix.SinkKWh,
		"net_consumption_kwh": mix.NetConsumptionKWh,
		"unattributed_kwh":    mix.UnattributedKWh,
		"sub_meter_kwh":       mix.SubMeterKWh,

		// The two flags a renderer must branch on before drawing a pie chart.
		// complete=false means some channel did not cover the window, so the
		// slices do not add up to the truth; attributed=false means there is
		// not enough source information to say where the energy came from. A
		// chart drawn without checking these is confidently wrong.
		"complete":         mix.Complete,
		"attributed":       mix.Attributed,
		"estimated_kwh":    mix.EstimatedKWh,
		"coverage_seconds": mix.CoverageSeconds,
		"expected_seconds": mix.ExpectedSeconds,
		"reset_count":      mix.ResetCount,
		"channels":         mix.Channels,
	})
}

// energyStore returns the store, or writes 503 and reports false when energy
// metering is not configured.
//
// Not 404: the route exists and the feature is real, it simply has no meter
// wired to it on this hub. A caller told "not found" goes looking for a typo in
// their URL; one told "unavailable" goes looking at their configuration.
func (s *Server) energyStore(w http.ResponseWriter) (*energy.Store, bool) {
	if s.energy == nil {
		writeErr(w, http.StatusServiceUnavailable, "energy_not_configured")
		return nil, false
	}
	return s.energy, true
}

// energyWindow parses from/to as Unix seconds, defaulting to the last week.
//
// The error strings are response codes rather than prose: they go straight to
// writeErr, and the console maps them to copy.
func energyWindow(q map[string][]string, loc *time.Location) (from, to time.Time, err error) {
	get := func(k string) string {
		if v, ok := q[k]; ok && len(v) > 0 {
			return strings.TrimSpace(v[0])
		}
		return ""
	}
	parse := func(raw string) (time.Time, bool) {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return time.Time{}, false
		}
		return time.Unix(n, 0).In(loc), true
	}

	now := time.Now().In(loc)
	to = now
	if raw := get("to"); raw != "" {
		t, ok := parse(raw)
		if !ok {
			return from, to, errors.New("invalid_to")
		}
		to = t
	}
	from = to.Add(-energyDefaultWindow)
	if raw := get("from"); raw != "" {
		t, ok := parse(raw)
		if !ok {
			return from, to, errors.New("invalid_from")
		}
		from = t
	}

	if !from.Before(to) {
		return from, to, errors.New("empty_window")
	}
	if to.Sub(from) > energyMaxWindow {
		return from, to, errors.New("window_too_large")
	}
	return from, to, nil
}
