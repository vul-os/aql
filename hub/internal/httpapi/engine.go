package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/vul-os/aql/hub/internal/devices"
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
// # Who may drive it — a question this file did not ask for too long
//
// The reasoning above is entirely about WHAT a verb does. It said nothing
// about WHOSE device it is, and neither did the routes: all four were
// `requireAuth`, so any signed-in user of any account on the hub could
// enumerate every device, turn on someone else's lamp, and — with `confirm` —
// start someone else's mower. That was demonstrated, not inferred: a second
// account registered on the same hub, with no relationship to the first, drove
// `mock:mower-1` at tier hazardous-motion.
//
// The confirm gate did not stop it and was never going to. Its own doc says
// what it is — "not a permission, a second deliberate act" — and a stranger is
// perfectly capable of a second deliberate act.
//
// # Why the fix is a hub-wide authority test rather than device scoping
//
// The obvious repair is to scope devices to accounts. There is nothing to
// scope them BY. A driver discovers devices from an MQTT broker, a Modbus PLC
// or an ONVIF probe; none of those carries a tenant, and inventing an
// attribution at the registry would be a guess wearing the costume of a
// permission. Giving the device model an owner is real product design (it is
// on the roadmap), not something to bolt on beneath a security fix.
//
// So the gate tests the honest invariant instead: THE ENGINE IS HUB-WIDE, SO
// AUTHORITY OVER IT MUST BE TOO. Two ways to hold that:
//
//   - be the instance admin, whose seat is hub-wide by definition; or
//   - be a member of the hub's ONLY account, in which case "everyone on this
//     hub" and "everyone in this account" are the same set of people and the
//     question this gate exists to ask does not arise.
//
// The common deployment — one household, one account — is unchanged. A hub
// serving several accounts stops handing each of them the others' devices,
// and says so with a distinct code rather than an empty fleet, because "you
// may not see these" and "there are none" are different answers.
const (
	// engineTierCeiling is the highest tier this surface will actuate at all.
	engineTierCeiling = devices.TierHazardousMotion
	// engineConfirmAbove is the tier above which an explicit confirm is
	// required in addition to authentication.
	engineConfirmAbove = devices.TierPhysicalAccess
)

// engineScope is what one caller may see and drive, resolved once per request.
//
// It replaces the blunt hub-wide test with the question that was always the
// right one — whose device is this — now that a device can answer it. See
// store/migrations/0021_device_ownership.sql for why ownership is a recorded
// claim rather than an inference.
type engineScope struct {
	// admin: the instance operator, whose seat is hub-wide by definition.
	// Sees and drives everything, claimed or not.
	admin bool
	// soleAccount: this hub has exactly one account and the caller is in it.
	// The single-household deployment, where "everyone on this hub" and
	// "everyone in this account" are the same people, so an UNCLAIMED device
	// has no one else it could belong to. Preserves the product's normal
	// case unchanged, including for hubs that predate ownership and have
	// claimed nothing.
	soleAccount bool
	// owned: device keys claimed by accounts this caller belongs to.
	owned map[string]bool
}

// permits reports whether this caller may see or drive one device.
//
// An UNCLAIMED device is permitted only on a sole-account hub or to the
// instance admin. That is the deliberate part: on a multi-account hub an
// unclaimed device belongs to nobody yet, and "nobody owns it" must not read
// as "anybody may drive it" — that is precisely the hole this replaced.
func (sc engineScope) permits(key string) bool {
	if sc.admin || sc.soleAccount {
		return true
	}
	return sc.owned[key]
}

// engineScopeFor resolves the caller's scope, or writes the refusal and
// returns ok=false. Fail-closed at every branch: an error establishing the
// precondition means the precondition is not established.
func (s *Server) engineScopeFor(w http.ResponseWriter, r *http.Request) (engineScope, bool) {
	c := claimsFrom(r)
	u, err := s.store.UserByID(r.Context(), c.Sub)
	if err != nil || u.Status != "active" {
		writeErr(w, http.StatusForbidden, "not_engine_authority")
		return engineScope{}, false
	}
	if u.IsPlatformAdmin {
		return engineScope{admin: true}, true
	}

	n, err := s.store.AccountCount(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return engineScope{}, false
	}
	member, err := s.store.IsMemberOfAnyAccount(r.Context(), c.Sub)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return engineScope{}, false
	}
	if !member {
		writeErr(w, http.StatusForbidden, "not_engine_authority")
		return engineScope{}, false
	}
	if n == 1 {
		return engineScope{soleAccount: true}, true
	}

	// Several accounts: the caller sees exactly what their accounts have
	// claimed. An empty set is a legitimate answer — a member who has claimed
	// nothing has no devices, which is different from being refused outright
	// and is why this does not 403 here.
	accounts, err := s.store.AccountsForUser(r.Context(), c.Sub)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return engineScope{}, false
	}
	owned := map[string]bool{}
	for _, a := range accounts {
		keys, err := s.store.DeviceKeysForAccount(r.Context(), a.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal")
			return engineScope{}, false
		}
		for k := range keys {
			owned[k] = true
		}
	}
	return engineScope{owned: owned}, true
}

// requireEngineAuthority gates every engine route. See the note above for why
// it asks about the hub rather than about the device.
//
// Fail-closed at every branch: an error counting accounts denies, because a
// gate that cannot establish its precondition has not established it.
func (s *Server) requireEngineAuthority(w http.ResponseWriter, r *http.Request) bool {
	c := claimsFrom(r)
	u, err := s.store.UserByID(r.Context(), c.Sub)
	if err != nil || u.Status != "active" {
		writeErr(w, http.StatusForbidden, "not_engine_authority")
		return false
	}
	if u.IsPlatformAdmin {
		return true
	}

	n, err := s.store.AccountCount(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return false
	}
	if n == 1 {
		member, err := s.store.IsMemberOfAnyAccount(r.Context(), c.Sub)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal")
			return false
		}
		if member {
			return true
		}
	}

	writeErr(w, http.StatusForbidden, "not_engine_authority")
	return false
}

// registry returns the device engine, or nil when no driver was configured.
// A hub with no device config is the default and is not an error — it simply
// has no devices to report, which is different from failing.
func (s *Server) registry() *devices.Registry { return s.devices }

func (s *Server) handleEngineDevices(w http.ResponseWriter, r *http.Request) {
	scope, ok := s.engineScopeFor(w, r)
	if !ok {
		return
	}
	reg := s.registry()
	if reg == nil {
		// Not 404 and not an error: an unconfigured engine honestly has an
		// empty fleet, and a console rendering "no devices" is correct.
		writeJSON(w, http.StatusOK, map[string]any{"devices": []any{}, "engine": false})
		return
	}
	out := make([]map[string]any, 0)
	for _, d := range reg.Devices() {
		// Filtered, not merely un-actuable: a device someone else owns is not
		// this caller's business to know exists. Every other listing in this
		// hub is scoped the same way.
		if !scope.permits(d.Key) {
			continue
		}
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
	scope, ok := s.engineScopeFor(w, r)
	if !ok {
		return
	}
	reg := s.registry()
	if reg == nil {
		writeErr(w, http.StatusNotFound, "no_device_engine")
		return
	}
	key := strings.TrimSpace(r.PathValue("key"))
	if !scope.permits(key) {
		// Same code and status as an unknown device on purpose: a caller must
		// not be able to map the hub's fleet by watching which keys answer
		// "forbidden" and which answer "not found".
		writeErr(w, http.StatusForbidden, "not_engine_authority")
		return
	}
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
	scope, ok := s.engineScopeFor(w, r)
	if !ok {
		return
	}
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
	if !scope.permits(key) {
		writeErr(w, http.StatusForbidden, "not_engine_authority")
		return
	}

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

// Health keeps the hub-wide gate rather than the per-device scope, and that is
// deliberate. It reports DRIVER state — is the broker connected, is the PLC
// answering — which is a property of the hub's plumbing and not of any one
// device. There is no honest way to show a member "the half of the MQTT
// connection that carries your lamp". So it stays operator-facing: the
// instance admin, or the sole account whose hub this wholly is.
func (s *Server) handleEngineHealth(w http.ResponseWriter, r *http.Request) {
	if !s.requireEngineAuthority(w, r) {
		return
	}
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
