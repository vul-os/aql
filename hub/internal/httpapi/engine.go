package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/devices/accessdev"
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

	// engineConsequentialCooldownS and engineHazardousCooldownS bound how often
	// ONE caller may repeat ONE verb on ONE device.
	//
	// The gap this closes: authentication and the tier ceiling both answer "may
	// this caller do this at all", and neither answers "may they do it two
	// hundred times a second". A holder of a valid session — a stolen token, a
	// script left running, a compromised client — could loop `start` on a mower
	// and nothing here would slow it. ROADMAP has carried that as "rate-limiting
	// and scoping on movement commands, so a compromised client cannot drive a
	// machine into a person"; the scoping half was built (engineScope), this is
	// the other half.
	//
	// Nothing at or below TierReversible is cooled down. A dimmer slider
	// legitimately sends a stream of `set`, and a lamp cannot injure anyone —
	// throttling it would break ordinary use to defend against nothing. The
	// cooldown starts where undoing costs something.
	engineConsequentialCooldownS = 3
	engineHazardousCooldownS     = 10
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
	scope, err := s.engineScopeForUser(r.Context(), claimsFrom(r).Sub)
	switch {
	case err == errNotEngineAuthority:
		writeErr(w, http.StatusForbidden, "not_engine_authority")
		return engineScope{}, false
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal")
		return engineScope{}, false
	}
	return scope, true
}

// errNotEngineAuthority separates "this caller may not" from "this failed",
// so the HTTP wrapper can answer 403 and 500 differently while the rule itself
// has no opinion about status codes.
var errNotEngineAuthority = errors.New("not engine authority")

// engineScopeForUser is the rule, with no HTTP in it.
//
// Extracted so a chat rail can ask the same question. The alternative — a
// second, chat-shaped scope function — is how the console and a rail end up
// disagreeing about which devices a member owns, and the direction that
// disagreement runs is not predictable: a parallel implementation is as likely
// to be wider as narrower.
func (s *Server) engineScopeForUser(ctx contextT, userID string) (engineScope, error) {
	u, err := s.store.UserByID(ctx, userID)
	if err != nil || u.Status != "active" {
		return engineScope{}, errNotEngineAuthority
	}
	if u.IsPlatformAdmin {
		return engineScope{admin: true}, nil
	}

	n, err := s.store.AccountCount(ctx)
	if err != nil {
		return engineScope{}, err
	}
	member, err := s.store.IsMemberOfAnyAccount(ctx, userID)
	if err != nil {
		return engineScope{}, err
	}
	if !member {
		return engineScope{}, errNotEngineAuthority
	}
	if n == 1 {
		return engineScope{soleAccount: true}, nil
	}

	// Several accounts: the caller sees exactly what their accounts have
	// claimed. An empty set is a legitimate answer — a member who has claimed
	// nothing has no devices, which is different from being refused outright
	// and is why this does not 403 here.
	accounts, err := s.store.AccountsForUser(ctx, userID)
	if err != nil {
		return engineScope{}, err
	}
	owned := map[string]bool{}
	for _, a := range accounts {
		keys, err := s.store.DeviceKeysForAccount(ctx, a.ID)
		if err != nil {
			return engineScope{}, err
		}
		for k := range keys {
			owned[k] = true
		}
		// Access points are engine devices too, via the read-only `access`
		// driver, and they have no device_ownership row — nothing claims them,
		// because they are already owned through their location's account.
		//
		// Without this they read as UNCLAIMED, which on a multi-account hub
		// means permits() denies them to everyone but the instance admin: a
		// member would not see their OWN gates in the engine fleet. Fail-closed
		// and therefore silent, which is why it is worth a test rather than a
		// comment. See docs/ACCESS-ON-THE-ENGINE.md §3.5 — the ownership is
		// DERIVED here, not stored, so there is still one source of truth for
		// who a gate belongs to.
		apIDs, err := s.store.AccessPointIDsForAccount(ctx, a.ID)
		if err != nil {
			return engineScope{}, err
		}
		for _, id := range apIDs {
			owned[devices.Key(accessdev.DriverID, id)] = true
		}
	}
	return engineScope{owned: owned}, nil
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

	// The device's resolved ACTIVE state, computed HERE rather than by the
	// caller.
	//
	// The rule lives in devices.ActiveFrom, which the chat read path also uses.
	// Re-deriving it in TypeScript would mean a second copy of the catalogue's
	// declarations in a language that cannot see them, and the two would
	// disagree the first time a capability gained a state — with the console
	// and a chat reply saying different things about the same lamp.
	//
	// Always present, including "unknown". A field that appeared only when the
	// answer was known would make absence ambiguous between "not supported by
	// this hub version" and "this device did not report", and the second is a
	// thing the console has to be able to show.
	body := map[string]any{"readings": out}
	if dev, ok := reg.Get(key); ok {
		st := devices.ActiveFrom(dev.Device.Capabilities, readings)
		body["active"] = st.String()
		// Whether this device COULD ever answer, which is a different question
		// from whether it did. An operator whose light never reports needs to
		// tell "nobody mapped its metric" from "it is offline right now".
		body["state_declared"] = devices.HasDeclaredState(dev.Device.Capabilities)
	}
	writeJSON(w, http.StatusOK, body)
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
	// Cooldown LAST among the checks, so a refused command never restarts
	// anyone's cooldown — the same ordering openpath.go uses, for the same
	// reason: a caller who was going to be told no should not also be told to
	// wait next time.
	if cd := engineCooldownFor(plan.Tier); cd > 0 {
		subject := "engine:" + claimsFrom(r).Sub + ":" + key + ":" + string(plan.Verb)
		claimed, err := s.store.ClaimActuationCooldown(r.Context(), subject, time.Now().Unix(), cd)
		if err != nil {
			// Fail CLOSED. openpath.go's limiter fails open by a reviewed
			// decision about a member standing at their own gate; there is no
			// equivalent argument for a machine with blades, and §3.5 of
			// docs/CHAT-COMMANDS.md names refusal as the direction the
			// generalised path diverges in.
			s.log.Error("engine cooldown", "err", err, "device", key)
			writeErr(w, http.StatusServiceUnavailable, "rate_limit_unavailable")
			return
		}
		if !claimed {
			w.Header().Set("Retry-After", strconv.FormatInt(cd, 10))
			writeErr(w, http.StatusTooManyRequests, "too_soon")
			return
		}
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

// engineCooldownFor is how long one caller must wait before repeating one verb
// on one device, by tier. Zero means no cooldown.
//
// Scaled rather than flat because the cost of the limit differs as much as the
// cost of the command. Three seconds on a cleaning bot is invisible to a person
// and ruinous to a script; ten on anything that moves under its own power is
// the difference between a mistake and a sequence of them.
func engineCooldownFor(t devices.Tier) int64 {
	switch {
	case t >= devices.TierPhysicalAccess:
		return engineHazardousCooldownS
	case t >= devices.TierConsequential:
		return engineConsequentialCooldownS
	}
	return 0
}
