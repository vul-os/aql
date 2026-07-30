package httpapi

// Remote controller configuration — the `config` command, which had no sender.
//
// proto/commands.md defines eight signed command types and the controller
// implements all eight. The hub could send two of them. `config` — retune a
// controller's actuation timings without physically visiting it — was built,
// conformance-tested on the receiving end, and unreachable.
//
// # Why the bounds live here and not on the controller
//
// The controller's `config` handler accepts ANY key whose value is a
// non-negative integer (`controller/internal/command/command.go`'s "config"
// case, which builds a map and calls `state.MergeConfig`). MergeConfig writes
// whatever it is given straight into the persisted config map. There is no
// allowlist and no range check anywhere on that side.
//
// That is not a controller bug — a device that second-guesses a signed command
// from its paired hub is a device that can be argued with — but it does mean
// the ONLY place a bad value can be stopped is here, before it is signed.
//
// # What a bad value actually does
//
// `pulse_ms` is how long the relay fires on an open
// (`command.go`: `d := time.Duration(cfgInt("pulse_ms", DefaultPulseMs)) *
// time.Millisecond`, then `p.Relay.Pulse(d)`). The GPIO relay bounds that
// duration and **refuses a pulse outside the range rather than clamping it**
// (`relay/gpio.go`: "A pulse outside the range is refused, not clamped",
// DefaultMaxPulse = 5s).
//
// So a `pulse_ms` above the relay's maximum does not produce a long pulse. It
// produces a controller where EVERY SUBSEQUENT OPEN FAILS at the hardware
// call — a gate that stops working, with nothing in the failure pointing at
// the config change that caused it. That is the failure mode these bounds
// exist to prevent, and it is why the ceiling here is deliberately below the
// relay's own default maximum rather than equal to it.

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// configBound is the accepted range for one controller config key.
type configBound struct {
	min, max int64
	// why is operator-facing: it goes into the refusal, because "invalid
	// value" tells someone nothing about which number to pick instead.
	why string
}

// configBounds is the closed set of keys the hub will send.
//
// Closed on purpose. MergeConfig would happily persist `pulse_msec` or
// `pluse_ms` forever, where it would sit looking like configuration and doing
// nothing — the typo is invisible because the controller reads its keys with
// defaults and a missing key is indistinguishable from an unset one.
var configBounds = map[string]configBound{
	// Below the relay's DefaultMaxPulse (5s) with room to spare: at or above
	// it, every open fails at the hardware call rather than pulsing long.
	"pulse_ms": {min: 50, max: 3000,
		why: "how long the relay fires on an open, in milliseconds. Above the relay's own " +
			"maximum every open fails outright rather than pulsing for longer, so this stays " +
			"well below it"},
	// A hold is a gate deliberately left open. The ceiling is a safety limit,
	// not a preference: the controller releases at hold_max whatever else
	// happens, and that is the last thing standing between "gate day mode"
	// and a barrier left up overnight.
	"hold_max": {min: 30, max: 4 * 3600,
		why: "the longest a hold may last before the controller releases it anyway, in seconds"},
	"sensor_debounce_ms": {min: 0, max: 5000,
		why: "how long a position/tamper input must settle before it is believed, in milliseconds"},
}

type deviceConfigReq struct {
	// Config is the subset of keys being changed. Absent keys are left alone
	// — the controller MERGES rather than replaces, so a partial update is
	// the natural shape and a full replace would be a footgun.
	Config map[string]int64 `json:"config"`
}

// PATCH /v1/devices/{id}/config — retune a paired controller.
//
// Account-admin only. Changing how long a relay fires is the same class of act
// as creating an access point, not the same class as reading a device list.
func (s *Server) handleDeviceConfig(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(r.PathValue("id"))
	accountID, err := s.store.DeviceAccountID(r.Context(), deviceID)
	if errors.Is(err, store.ErrNotFound) {
		// 404 for an unknown device AND for one in another account: the
		// tenancy contract, unchanged.
		writeErr(w, http.StatusNotFound, "device_not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if !s.requireAccountAdmin(w, r, accountID) {
		return
	}
	c := claimsFrom(r)

	var req deviceConfigReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	if len(req.Config) == 0 {
		writeErr(w, http.StatusBadRequest, "empty_config")
		return
	}

	payload := map[string]any{}
	for k, v := range req.Config {
		b, ok := configBounds[k]
		if !ok {
			writeErrDetail(w, http.StatusBadRequest, "unknown_config_key", map[string]any{
				"key": k,
				"message": "This hub will not send that key. A controller stores whatever it is " +
					"told, so an unrecognised key would persist forever doing nothing.",
				"accepted": acceptedConfigKeys(),
			})
			return
		}
		if v < b.min || v > b.max {
			writeErrDetail(w, http.StatusBadRequest, "config_out_of_range", map[string]any{
				"key": k, "min": b.min, "max": b.max, "message": b.why,
			})
			return
		}
		payload[k] = v
	}

	env, err := s.signForDevice(r.Context(), "config", deviceID, "", payload,
		30*time.Second, map[string]any{"source": "gateway", "actor": c.Sub})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	// No log id: a config change is not an access-log entry, and the late-ack
	// reconciler correctly does nothing with an empty one. The record of this
	// act is the admin audit row below.
	outcome := s.hub.Dispatch(r.Context(), deviceID, env, 5*time.Second, "")

	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "device_config", "device", deviceID, true,
		map[string]any{"account_id": accountID, "config": req.Config, "delivery": outcome.Delivery}); err != nil {
		s.log.Error("device config audit write failed", "device_id", deviceID, "err", err)
	}

	// Delivery is reported rather than flattened to success. "queued" means a
	// controller that is offline will apply this when it reconnects, which is
	// a materially different thing to tell an operator than "done".
	writeJSON(w, http.StatusOK, map[string]any{
		"delivery": outcome.Delivery,
		"config":   req.Config,
	})
}

// acceptedConfigKeys is what a refusal offers instead of the key it rejected.
// Sorted so the answer is stable, which matters for a message a person reads.
func acceptedConfigKeys() []string {
	out := make([]string, 0, len(configBounds))
	for k := range configBounds {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
