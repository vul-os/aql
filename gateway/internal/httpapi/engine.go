package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// The device engine's HTTP surface.
//
// Until this file existed the engine was invisible: drivers could be
// constructed at startup and could discover devices, and nothing outside the
// process could see or drive any of it. The console's device, energy and
// automation screens therefore had no choice but to render a demo fixture.
//
// # Why this is not simply "expose the registry"
//
// Reading is uninteresting; actuating is not. A verb reaching a device through
// here is the same class of action as a gate opening, so it goes through the
// same shape of decision the chat rails already use:
//
//   - The registry resolves (device, verb) to a Plan carrying a Tier. That
//     resolution is the authority — this layer never decides what a verb means
//     and never widens what a device offers.
//   - A tier above the ceiling is refused. HTTP has a person on the other end,
//     which is the whole difference from an automation firing at 3am, so the
//     ceiling here is higher than the automations runtime's. It is not absent.
//   - Every actuation writes an audit row.
//
// # The ceiling, and why hazardous motion is not simply allowed
//
// A person clicking a button in a console is attended, so TierPhysicalAccess —
// opening a gate — needs no ceremony beyond authentication; that is exactly
// what the existing open path already permits from the console.
//
// TierHazardousMotion is different. "Start the mower" from a phone means blades
// spinning somewhere the operator cannot see, and a mis-tap is
// indistinguishable from an intent. It requires an explicit confirm in the
// request body: not a permission, a second deliberate act. The refusal names
// the field so an honest client can offer a confirmation dialog, and a script
// that has not thought about it fails closed.
const (
	// engineTierCeiling is the highest tier this surface will actuate at all.
	engineTierCeiling = devices.TierHazardousMotion
	// engineConfirmAbove is the tier above which an explicit confirm is
	// required in addition to authentication.
	engineConfirmAbove = devices.TierPhysicalAccess
)

// registry returns the device engine, or nil when no driver was configured.
// A hub with no device config is the default and is not an error — it simply
// has no devices to report, which is different from failing.
func (s *Server) registry() *devices.Registry { return s.devices }

func (s *Server) handleEngineDevices(w http.ResponseWriter, r *http.Request) {
	reg := s.registry()
	if reg == nil {
		// Not 404 and not an error: an unconfigured engine honestly has an
		// empty fleet, and a console rendering "no devices" is correct.
		writeJSON(w, http.StatusOK, map[string]any{"devices": []any{}, "engine": false})
		return
	}
	out := make([]map[string]any, 0)
	for _, d := range reg.Devices() {
		out = append(out, engineDeviceJSON(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": out, "engine": true})
}

func engineDeviceJSON(d devices.IndexedDevice) map[string]any {
	caps := make([]string, 0, len(d.Device.Capabilities))
	for _, c := range d.Device.Capabilities {
		caps = append(caps, string(c))
	}
	return map[string]any{
		"key":          d.Key,
		"driver":       d.Driver,
		"kind":         string(d.Device.Kind),
		"name":         d.Device.Name,
		"zone":         d.Device.Zone,
		"capabilities": caps,
		// availability is reported verbatim, including the empty string the
		// engine uses for "not heard from since start". A console must be able
		// to distinguish that from offline; collapsing them here would make a
		// device that has never reported look like one that is known down.
		"availability": string(d.Device.Availability),
		"summary":      d.Device.Summary,
		"last_seen":    d.Device.LastSeen.Unix(),
	}
}

func (s *Server) handleEngineReadings(w http.ResponseWriter, r *http.Request) {
	reg := s.registry()
	if reg == nil {
		writeErr(w, http.StatusNotFound, "no_device_engine")
		return
	}
	key := strings.TrimSpace(r.PathValue("key"))
	readings, err := reg.Read(r.Context(), key)
	if err != nil {
		writeEngineErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(readings))
	for _, rd := range readings {
		m := map[string]any{"metric": rd.Metric, "at": rd.At.Unix()}
		if rd.Text != "" {
			m["text"] = rd.Text
		} else {
			m["value"] = rd.Value
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"readings": out})
}

type engineExecuteReq struct {
	Verb string             `json:"verb"`
	Args map[string]float64 `json:"args"`
	// Confirm must be true for a verb above engineConfirmAbove. It is a
	// deliberate second act, not a permission — see the file comment.
	Confirm bool `json:"confirm"`
}

func (s *Server) handleEngineExecute(w http.ResponseWriter, r *http.Request) {
	reg := s.registry()
	if reg == nil {
		writeErr(w, http.StatusNotFound, "no_device_engine")
		return
	}
	var req engineExecuteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	key := strings.TrimSpace(r.PathValue("key"))

	// Resolve first. The registry is the authority on what a verb means and
	// what tier it carries; this handler never second-guesses it and never
	// widens it.
	plan, err := reg.Resolve(key, devices.Verb(strings.TrimSpace(req.Verb)), req.Args)
	if err != nil {
		writeEngineErr(w, err)
		return
	}
	if plan.Tier > engineTierCeiling {
		writeErr(w, http.StatusForbidden, "tier_refused")
		return
	}
	if plan.Tier > engineConfirmAbove && !req.Confirm {
		// Named explicitly so a client can offer a confirmation step, and so a
		// script that has not considered it fails closed rather than starting
		// something with blades.
		writeErr(w, http.StatusConflict, "confirm_required")
		return
	}
	if err := reg.ExecutePlan(r.Context(), plan); err != nil {
		writeEngineErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "tier": plan.Tier.String()})
}

func (s *Server) handleEngineHealth(w http.ResponseWriter, r *http.Request) {
	reg := s.registry()
	if reg == nil {
		writeJSON(w, http.StatusOK, map[string]any{"engine": false, "drivers": map[string]any{}})
		return
	}
	out := map[string]any{}
	for id, h := range reg.DriverHealth(r.Context()) {
		out[id] = map[string]any{"ok": h.OK, "detail": h.Detail, "since": h.Since.Unix()}
	}
	writeJSON(w, http.StatusOK, map[string]any{"engine": true, "drivers": out})
}

// writeEngineErr maps the engine's error vocabulary onto status codes without
// losing the distinction the engine works hard to preserve.
//
// ErrIndeterminate is the one that matters: it means the driver could not
// establish whether the action happened. Reporting that as a failure would be
// a lie in the more dangerous direction — a client that retries a gate open it
// was told had failed, when it had not, opens it twice.
func writeEngineErr(w http.ResponseWriter, err error) {
	switch {
	case devices.IsInvalid(err):
		// Unknown device, unknown verb, and verb-not-offered are deliberately
		// indistinguishable in the engine, and stay that way here.
		writeErr(w, http.StatusBadRequest, "invalid_request")
	case errors.Is(err, devices.ErrUnsupported):
		writeErr(w, http.StatusBadRequest, "unsupported")
	case errors.Is(err, devices.ErrUnknownDevice):
		writeErr(w, http.StatusBadRequest, "invalid_request")
	case errors.Is(err, devices.ErrUnreachable):
		writeErr(w, http.StatusBadGateway, "unreachable")
	case errors.Is(err, devices.ErrIndeterminate):
		writeErr(w, http.StatusBadGateway, "indeterminate")
	default:
		writeErr(w, http.StatusBadGateway, "device_error")
	}
}
