// Package automations is Aql's rule runtime: a persisted rule object
// (when → do), a scheduler that survives restart, and an execution engine that
// resolves every action through the device registry, applies the safety-tier
// policy, actuates, and records the outcome.
//
// # Why this is not ordinary CRUD
//
// An automation is an UNATTENDED actuation. Nobody is watching when it fires,
// nobody is standing next to the machine, and there is no human in the loop to
// notice that "start" now means blades. Everything below follows from that one
// fact:
//
//   - The tier ladder (internal/devices/capability.go) is applied TWICE. Once
//     when a rule is saved, so a hazardous rule never reaches the database, and
//     again immediately before the driver is called, because the catalogue can
//     change under a stored rule. A device that re-declares robot.blade-job
//     where it used to declare robot.job turns a saved "start the bot" into a
//     saved "start the blades"; the save-time check cannot see that coming, so
//     it is not allowed to be the only check. MaxActionTier is the bound.
//   - Nothing is retried. A driver that returns devices.ErrIndeterminate is
//     saying "I cannot tell you whether that happened"; retrying an unknown
//     physical outcome is how a gate gets opened twice. The run is recorded as
//     indeterminate and the rule moves on.
//   - Refusals are recorded, not swallowed. An unresolvable device, an unknown
//     verb, a sensor that cannot be read — each produces a run row saying so,
//     and the ones that reached the point of nearly actuating also produce a
//     hash-chained audit row.
//   - A rule that keeps failing stops itself. See Engine's breaker.
//
// # What this package does NOT do
//
// It does not drive access points. Gates, doors and barriers are actuated by
// the hub's signed Ed25519 path, deliberately not routed through the device
// registry (see internal/devices' package doc) — and even if they were, every
// access verb in the catalogue sits at TierPhysicalAccess, above MaxActionTier,
// so an automation could not fire one. "Open the gate at 07:00 every weekday"
// is not expressible here, on purpose.
//
// It does not own an HTTP surface, and it does not reach into internal/store.
// It takes a database handle and the audit choke point as narrow interfaces
// (DB, Auditor) so it can be exercised end to end in tests without the server,
// and so it structurally cannot write to an audit table itself.
package automations

import (
	"context"
	"errors"
	"fmt"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// MaxActionTier is the highest safety tier an unattended rule may actuate.
//
// TierConsequential is the line because everything above it is a decision a
// person should be present for: TierPhysicalAccess grants entry to a space,
// TierHazardousMotion moves something that can injure. A thermostat setpoint or
// an armed patrol route (both TierConsequential) is costly to undo and is
// exactly what an automation is for; a mower's blades are not.
//
// This is a CEILING, not a default: it is compared with `>` against the tier
// the registry resolved, and the registry has already refused TierUnset and
// TierRefused before we see them. A future tier inserted into the ladder above
// TierConsequential is therefore refused here without this file changing.
const MaxActionTier = devices.TierConsequential

// Outcome is what one run of a rule did. It is the closed vocabulary the
// automation_runs.outcome CHECK constraint enforces.
type Outcome string

const (
	// OutcomeExecuted — the driver reported that the action happened.
	OutcomeExecuted Outcome = "executed"
	// OutcomeRefused — policy said no BEFORE anything actuated.
	OutcomeRefused Outcome = "refused"
	// OutcomeFailed — the driver said the action did not happen.
	OutcomeFailed Outcome = "failed"
	// OutcomeIndeterminate — the driver could not tell whether it happened.
	// Distinct from failed because the honest operator-facing answer is "I
	// don't know", and because the two warrant different follow-up.
	OutcomeIndeterminate Outcome = "indeterminate"
	// OutcomeSkipped — nothing was attempted and nothing was wrong: the rule
	// is disabled, its cooldown has not elapsed, its condition did not hold,
	// or a scheduled occurrence was missed by more than the grace window.
	OutcomeSkipped Outcome = "skipped"
)

// Cause is what asked for a run.
type Cause string

const (
	CauseSchedule  Cause = "schedule"
	CauseThreshold Cause = "threshold"
	CauseEvent     Cause = "event"
	// CauseManual is an operator running a rule on demand. It is still an
	// automation run and still subject to every check — a "test run" that
	// bypassed the tier gate would be a way to launder a hazardous action.
	CauseManual Cause = "manual"
)

// Refusal reasons. A closed vocabulary so the console and the tests can match
// on them, and so a refusal can be classified as structural (the rule cannot
// work as written; stop it now) or transient (count it against the budget).
const (
	ReasonInvalidRule      = "invalid_rule"
	ReasonInvalidSchedule  = "invalid_schedule"
	ReasonTierTooHigh      = "tier_too_high"
	ReasonUnresolvable     = "unresolvable_target"
	ReasonNoTargets        = "no_targets"
	ReasonAmbiguousState   = "ambiguous_state"
	ReasonDriverError      = "driver_error"
	ReasonIndeterminate    = "indeterminate"
	ReasonAuditUnavailable = "audit_unavailable"

	// Skip reasons — not refusals, nothing was wrong.
	ReasonDisabled        = "disabled"
	ReasonCooldown        = "cooldown"
	ReasonConditionUnmet  = "condition_unmet"
	ReasonStaleOccurrence = "stale_occurrence"
)

// structuralReasons are the refusals that disable a rule on the FIRST
// occurrence rather than spending its failure budget.
//
// The line is drawn at "can this rule ever be right as written?", not at "did
// it work this time":
//
//   - tier_too_high — the rule's action now resolves above MaxActionTier. The
//     refusal itself is safe (nothing actuated), but a stored rule that would
//     start blades if the catalogue moved again is not a rule to leave armed.
//   - invalid_rule / invalid_schedule — the stored row cannot be parsed or its
//     schedule cannot be resolved. Ticking it again just re-reads the same row.
//   - audit_unavailable — the trail could not be written. An unattended
//     actuator nobody can reconstruct stops.
//
// Everything else — an unresolvable device, an empty zone, an unreadable
// sensor, a driver that said no — is transient-shaped and spends the budget
// instead: a broker that blipped for one tick is not a broken rule, and none
// of those paths actuated anything, so retrying them is not another swing at
// the physical world.
var structuralReasons = map[string]bool{
	ReasonInvalidRule:      true,
	ReasonInvalidSchedule:  true,
	ReasonTierTooHigh:      true,
	ReasonAuditUnavailable: true,
}

// Refusal is a refusal to act, carrying a reason from the vocabulary above.
// Every path that declines to actuate returns one of these, so the caller
// never has to distinguish "an error happened" from "we decided not to".
type Refusal struct {
	Reason string
	Detail string
}

func (r *Refusal) Error() string {
	if r.Detail == "" {
		return "automations: refused: " + r.Reason
	}
	return "automations: refused (" + r.Reason + "): " + r.Detail
}

func refuse(reason, format string, a ...any) error {
	return &Refusal{Reason: reason, Detail: fmt.Sprintf(format, a...)}
}

// IsRefusal reports whether err is a refusal rather than a transport or
// database failure. Callers map it to 4xx; everything else is 5xx.
func IsRefusal(err error) bool {
	var r *Refusal
	return errors.As(err, &r)
}

// RefusalReason returns the reason of a Refusal, or "" for any other error.
func RefusalReason(err error) string {
	var r *Refusal
	if errors.As(err, &r) {
		return r.Reason
	}
	return ""
}

// Auditor is the audit choke point, as a one-method interface: the automation
// engine writes its trail through *store.Store.WriteAdminAudit and has no
// other way to touch admin_audit_log. The audit tables are SHA-256
// hash-chained with append-only triggers (migration 0007); inserting into them
// directly would break the chain and trip those triggers, so this package is
// built so it cannot try.
//
// Declared here rather than imported so this package does not depend on
// internal/store at all — *store.Store satisfies it structurally.
type Auditor interface {
	WriteAdminAudit(ctx context.Context, actorUserID, action, targetKind, targetID string, allowed bool, detail any) error
}

// Audit actions this package writes. Closed set, so an operator reading the
// trail can grep for exactly these.
const (
	AuditRun          = "automation_run"
	AuditSave         = "automation_save"
	AuditSaveRefused  = "automation_save_refused"
	AuditRuleDisabled = "automation_disabled"
)
