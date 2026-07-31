package automations

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// DefaultFailureBudget is how many consecutive non-actuating runs a rule gets
// before it disables itself.
//
// THE POLICY, stated plainly, because "a rule that errors repeatedly must be
// able to stop itself" has more than one defensible answer and this is the one
// implemented:
//
//   - TRANSIENT failures — the driver said no, the driver could not tell, a
//     condition's sensor could not be read — spend one unit of budget each. A
//     success resets the counter to zero. At DefaultFailureBudget the rule
//     disables itself with disabled_reason "failure_budget" and stays disabled
//     until a human re-enables it (Engine.SetEnabled), which is also what
//     resets the counter. Nothing backs off and retries: the next tick is the
//     next attempt, and there are only three of them.
//   - STRUCTURAL failures — the action resolves above MaxActionTier, the
//     stored rule or its schedule is corrupt, or the audit trail could not be
//     written — disable the rule on the FIRST occurrence. See
//     structuralReasons for why those four and not the others.
//
// Three is chosen over one for the transient case because a mower that is out
// of radio range for one tick is not a broken rule, and over ten because ten
// unattended attempts at a physical action is already too many to be discovered
// by someone reading a log the next morning.
const DefaultFailureBudget = 3

// Config configures an Engine.
type Config struct {
	// Registry is the device engine. Every action goes through Resolve, so the
	// tier this package enforces is the tier the catalogue assigned — never one
	// carried on a rule row.
	Registry *devices.Registry
	// Store is the automations persistence layer (migration 0010).
	Store *Store
	// Audit is the hash-chained audit choke point (store.WriteAdminAudit).
	Audit Auditor
	// Now is swappable for tests; nil means time.Now.
	Now func() time.Time
	// Notifier receives alerts raised by notify actions. Nil means alerts are
	// recorded as runs and delivered nowhere, which is the honest behaviour for
	// a hub with no webhook configured — the rule still ran, and its record
	// says so.
	Notifier Notifier
	// FailureBudget overrides DefaultFailureBudget when > 0.
	FailureBudget int

	// DeviceOwner resolves which account has claimed a device, or reports
	// that nobody has. Nil disables the check, which is the behaviour this
	// engine had before ownership existed.
	//
	// Until this seam, a rule named a device key and NOTHING verified it
	// belonged to the rule's account — not at save, not at firing. On a
	// multi-account hub an admin of one account could write a rule that drove
	// another account's claimed device. The tier ceiling bounded what that
	// could do (MaxActionTier stops entry and hazardous motion) but bounded is
	// not the same as prevented.
	//
	// An UNCLAIMED device is allowed, for the same reason the energy poller
	// falls back: a hub with one household claims nothing, and requiring every
	// lamp to be claimed before a rule could touch it would break the
	// deployment this product is mostly for. An ERROR is refused, because a
	// lookup that failed has not established that a device is unclaimed and
	// actuating on that basis would be acting without authority.
	DeviceOwner OwnerFunc
}

// OwnerFunc reports the account that has claimed deviceKey. claimed=false
// means nobody has — a different answer from an error, and treated
// differently.
type OwnerFunc func(ctx context.Context, deviceKey string) (accountID string, claimed bool, err error)

// Engine evaluates rules, applies the tier policy, actuates through the
// registry, and records what happened.
type Engine struct {
	reg      *devices.Registry
	store    *Store
	audit    Auditor
	owner    OwnerFunc
	notifier Notifier
	now      func() time.Time
	budget   int
}

// SetNotifier installs the alert sink after construction.
//
// After, not at construction, because the engine is built before the HTTP
// server that owns the webhook dispatcher — and giving alerts their own
// dispatcher instead would mean two retirement counters and two delivery logs
// for one endpoint. An engine with no notifier records its alert runs and
// delivers nowhere, which is the honest state for a hub with no webhook.
func (e *Engine) SetNotifier(n Notifier) { e.notifier = n }

// Alert is what a notify action raises.
//
// It carries the rule and the trigger's device alongside the operator's own
// words, because a message on its own ("tank is low") is not actionable when
// three rules could have sent it. The hub adds the context and does not compose
// the sentence — a generated one would be about the device, and the useful
// sentence is about what the operator wants done.
type Alert struct {
	AccountID string
	RuleID    string
	RuleName  string
	Message   string
	Cause     Cause
	At        int64
	// TriggerDeviceKey is the device that made the rule ask to run, or "" for a
	// schedule.
	TriggerDeviceKey string
}

// Notifier delivers alerts. Implemented outside this package so the engine does
// not learn about webhooks, chat rails or anything else a delivery mechanism
// might become.
type Notifier interface {
	Alert(ctx context.Context, a Alert)
}

// NewEngine validates its dependencies. Every one of them is required: an
// engine with no auditor would actuate without a trail, and an engine with no
// registry would have nothing to apply the tier ladder to.
func NewEngine(cfg Config) (*Engine, error) {
	if cfg.Registry == nil {
		return nil, errors.New("automations: no device registry")
	}
	if cfg.Store == nil {
		return nil, errors.New("automations: no store")
	}
	if cfg.Audit == nil {
		return nil, errors.New("automations: no auditor")
	}
	e := &Engine{reg: cfg.Registry, store: cfg.Store, audit: cfg.Audit, notifier: cfg.Notifier,
		owner: cfg.DeviceOwner, now: cfg.Now, budget: cfg.FailureBudget}
	if e.now == nil {
		e.now = time.Now
	}
	if e.budget <= 0 {
		e.budget = DefaultFailureBudget
	}
	return e, nil
}

// Store exposes the persistence layer for read-only surfaces (a console
// listing rules and runs). Writes still belong to the engine's own methods,
// which is where the tier gate is.
func (e *Engine) Store() *Store { return e.store }

func (e *Engine) nowUnix() int64 { return unixNow(e.now) }

// checkActionTier is THE safety rule, in one function so that the save-time
// call and the execution-time call are provably the same check.
//
// devices.Registry.Resolve has already refused TierUnset and TierRefused by
// the time we see a Plan; the Allowed() line below is kept anyway, because a
// check that depends on someone else having already checked is not a check.
func checkActionTier(t devices.Tier) error {
	if !t.Allowed() {
		return refuse(ReasonTierTooHigh, "tier %s is never actuable", t)
	}
	if t > MaxActionTier {
		return refuse(ReasonTierTooHigh,
			"tier %s is above %s: an automation fires with nobody watching, so it may not %s",
			t, MaxActionTier, tierProse(t))
	}
	return nil
}

// checkDeviceOwnership refuses a device claimed by a different account.
//
// Fail-closed on a lookup error: not knowing whose a device is, is not a
// licence to actuate it. Unclaimed is permitted — see Config.DeviceOwner.
func (e *Engine) checkDeviceOwnership(ctx context.Context, ruleAccount, deviceKey string) error {
	if e.owner == nil {
		return nil
	}
	owner, claimed, err := e.owner(ctx, deviceKey)
	if err != nil {
		return refuse(ReasonForeignDevice,
			"could not establish who owns %s, so it was not actuated: %v", deviceKey, err)
	}
	if claimed && owner != ruleAccount {
		// The message names neither the owning account nor that one exists:
		// a rule author must not learn the shape of another tenant's fleet
		// from a refusal.
		return refuse(ReasonForeignDevice,
			"%s is not this account's device", deviceKey)
	}
	return nil
}

func tierProse(t devices.Tier) string {
	switch t {
	case devices.TierPhysicalAccess:
		return "grant entry to a space"
	case devices.TierHazardousMotion:
		return "move something that can injure"
	}
	return "actuate at this tier"
}

// resolvePlans turns an action into the concrete, registry-validated plans it
// would execute. A single-device action is one plan; a zone action is one plan
// per member of that zone that offers the verb.
//
// Zone semantics, chosen deliberately:
//   - A member that does not offer the verb is SKIPPED, not an error. "Turn the
//     exterior off" means the lights, not the thermostat that has no off.
//   - A member that offers the verb but fails to resolve (argument out of
//     range, tier not actuable) refuses the WHOLE action. That failure is
//     about the rule, not about one device, and half an automation is a state
//     nobody wrote down.
//   - Zero members is a refusal, never a silent no-op. A rule that quietly
//     stopped matching anything is exactly the failure a resident does not
//     notice.
func (e *Engine) resolvePlans(a Action) ([]devices.Plan, error) {
	if err := a.Validate(); err != nil {
		return nil, err
	}
	if a.DeviceKey != "" {
		plan, err := e.reg.Resolve(a.DeviceKey, a.Verb, a.Args)
		if err != nil {
			return nil, refuse(ReasonUnresolvable, "%s: %v", a.DeviceKey, err)
		}
		return []devices.Plan{plan}, nil
	}
	var plans []devices.Plan
	// Registry.Devices is sorted by key, so a zone fan-out is deterministic.
	for _, d := range e.reg.Devices() {
		if !strings.EqualFold(strings.TrimSpace(d.Device.Zone), strings.TrimSpace(a.Zone)) {
			continue
		}
		if _, _, ok := d.Device.Supports(a.Verb); !ok {
			continue
		}
		plan, err := e.reg.Resolve(d.Key, a.Verb, a.Args)
		if err != nil {
			return nil, refuse(ReasonUnresolvable, "zone %q member %s: %v", a.Zone, d.Key, err)
		}
		plans = append(plans, plan)
	}
	if len(plans) == 0 {
		return nil, refuse(ReasonNoTargets, "zone %q has no device offering %q", a.Zone, string(a.Verb))
	}
	return plans, nil
}

// SaveRule validates, tier-checks and persists a rule. It is the ONLY way a
// rule reaches the database through this package's public surface.
//
// SAVE-TIME TIER GATE: the action is resolved through the registry and every
// resulting plan is checked against MaxActionTier. A rule that would start a
// mower's blades or open a gate is refused here and never becomes a row. That
// is not the last word — Fire re-checks, because the catalogue can change under
// a stored rule — but it means the hazardous rule does not exist to be
// re-checked in the first place.
//
// It also requires every device the rule NAMES (trigger, conditions, and a
// single-device action) to exist in the registry now. Fail-closed: a rule
// watching a device the hub has never heard of cannot be evaluated, and a rule
// that silently never fires is worse than one that refused to be created.
func (e *Engine) SaveRule(ctx context.Context, r Rule) (Rule, error) {
	now := e.nowUnix()

	fail := func(err error) (Rule, error) {
		// Best-effort: the save did not happen, so a failed audit write cannot
		// leave the trail disagreeing with the world. Contrast with Fire,
		// where an unwritable audit row disables the rule.
		_ = e.audit.WriteAdminAudit(ctx, r.CreatedBy, AuditSaveRefused, "automation_rule", r.ID, false,
			map[string]any{
				"account_id": r.AccountID,
				"name":       r.Name,
				"reason":     RefusalReason(err),
				"detail":     err.Error(),
				"verb":       string(r.Action.Verb),
				"device_key": r.Action.DeviceKey,
				"zone":       r.Action.Zone,
			})
		return Rule{}, err
	}

	if err := r.Validate(); err != nil {
		return fail(err)
	}
	for _, key := range r.DeviceKeys() {
		if _, ok := e.reg.Get(key); !ok {
			return fail(refuse(ReasonUnresolvable, "no such device %q", key))
		}
	}
	// An alert resolves to no device, so there is nothing to resolve, tier or
	// own — and it falls through to the SAME persistence below rather than
	// getting a second save path. Its tier is TierRead: it observes and changes
	// nothing, and leaving the field unset would make a saved alert
	// indistinguishable from a rule whose tier nobody worked out.
	tier := devices.TierRead
	if !r.Action.IsNotify() {
		tier = devices.TierUnset
		plans, err := e.resolvePlans(r.Action)
		if err != nil {
			return fail(err)
		}
		for _, p := range plans {
			if err := checkActionTier(p.Tier); err != nil {
				return fail(err)
			}
			// A courtesy, not the boundary. Refusing here means an admin naming
			// another account's device is told immediately, instead of saving a
			// rule that looks fine and is refused every time it fires. The check
			// that actually protects the device is the one in the run path, which
			// re-asks because ownership can change under a stored rule.
			if err := e.checkDeviceOwnership(ctx, r.AccountID, p.Key); err != nil {
				return fail(err)
			}
			if p.Tier > tier {
				tier = p.Tier
			}
		}
	}
	r.ActionTier = tier
	r.UpdatedAt = now

	created := r.ID == ""
	if created {
		r.ID = newID()
		r.CreatedAt = now
		r.CreatedBySnapshot = r.CreatedBy
		r.LastOutcome = ""
		r.ConsecutiveFailures = 0
		r.DisabledReason = ""
		r.DisabledAt = 0
		if err := e.store.InsertRule(ctx, r); err != nil {
			return Rule{}, err
		}
	} else {
		cur, err := e.store.RuleByID(ctx, r.AccountID, r.ID)
		if err != nil {
			return Rule{}, err
		}
		// Scheduler position and history belong to the engine, not to the
		// editor: carry them forward rather than letting a save rewind the
		// clock and replay an occurrence.
		r.CreatedAt = cur.CreatedAt
		r.CreatedBySnapshot = cur.CreatedBySnapshot
		r.LastOccurrenceAt = cur.LastOccurrenceAt
		r.LastFiredAt = cur.LastFiredAt
		r.LastOutcome = cur.LastOutcome
		r.ConsecutiveFailures = cur.ConsecutiveFailures
		r.DisabledReason = cur.DisabledReason
		r.DisabledAt = cur.DisabledAt
		if r.Enabled {
			// Deliberately re-arming: an edited, re-enabled rule is a fresh
			// intent, so it gets a fresh budget. The edit is in the audit
			// trail, so this is a recorded decision, not a silent reset.
			r.ConsecutiveFailures = 0
			r.DisabledReason = ""
			r.DisabledAt = 0
		}
		if err := e.store.UpdateRule(ctx, r); err != nil {
			return Rule{}, err
		}
		if err := e.store.SaveRuleState(ctx, r); err != nil {
			return Rule{}, err
		}
	}

	_ = e.audit.WriteAdminAudit(ctx, r.CreatedBy, AuditSave, "automation_rule", r.ID, true,
		map[string]any{
			"account_id":   r.AccountID,
			"name":         r.Name,
			"created":      created,
			"enabled":      r.Enabled,
			"trigger":      string(r.Trigger.Kind),
			"verb":         string(r.Action.Verb),
			"device_key":   r.Action.DeviceKey,
			"zone":         r.Action.Zone,
			"tier":         r.ActionTier.String(),
			"conditions":   len(r.Conditions),
			"min_interval": r.MinIntervalS,
		})
	return r, nil
}

// SetEnabled turns a rule on or off, account-scoped. Enabling is what clears a
// tripped breaker: a human deciding the rule may run again is exactly the event
// the breaker was waiting for, and nothing else resets the counter.
func (e *Engine) SetEnabled(ctx context.Context, accountID, id, actorUserID string, enabled bool) (Rule, error) {
	r, err := e.store.RuleByID(ctx, accountID, id)
	if err != nil {
		return Rule{}, err
	}
	now := e.nowUnix()
	r.Enabled = enabled
	r.UpdatedAt = now
	if enabled {
		r.ConsecutiveFailures = 0
		r.DisabledReason = ""
		r.DisabledAt = 0
	} else {
		r.DisabledReason = "operator"
		r.DisabledAt = now
	}
	if err := e.store.SaveRuleState(ctx, r); err != nil {
		return Rule{}, err
	}
	_ = e.audit.WriteAdminAudit(ctx, actorUserID, AuditRuleDisabled, "automation_rule", r.ID, enabled,
		map[string]any{"account_id": r.AccountID, "name": r.Name, "enabled": enabled, "reason": r.DisabledReason})
	return r, nil
}

// DeleteRule removes a rule within its account and records the removal.
func (e *Engine) DeleteRule(ctx context.Context, accountID, id, actorUserID string) error {
	r, err := e.store.RuleByID(ctx, accountID, id)
	if err != nil {
		return err
	}
	if err := e.store.DeleteRule(ctx, accountID, id); err != nil {
		return err
	}
	_ = e.audit.WriteAdminAudit(ctx, actorUserID, AuditRuleDisabled, "automation_rule", id, false,
		map[string]any{"account_id": accountID, "name": r.Name, "deleted": true})
	return nil
}

// RunNow fires a rule on demand, account-scoped. It is a normal run: same
// conditions, same tier gate, same audit row. A "test run" that bypassed any of
// that would be a way to launder a hazardous action through a button.
func (e *Engine) RunNow(ctx context.Context, accountID, id string) (Run, error) {
	r, err := e.store.RuleByID(ctx, accountID, id)
	if err != nil {
		return Run{}, err
	}
	return e.Fire(ctx, r, CauseManual, 0)
}

// Fire evaluates and executes one rule.
//
// The order is the order it has to be in: cheap refusals first, the tier
// re-check immediately before the driver call, and the audit row and the
// persisted outcome last, once there is an outcome to record.
//
// The returned error is the Refusal for a refused run (so an HTTP surface can
// map it with IsRefusal); it is a plain error only when persistence itself
// failed. The Run is always returned populated.
func (e *Engine) Fire(ctx context.Context, r Rule, cause Cause, occurrenceAt int64) (Run, error) {
	start := e.nowUnix()
	run := Run{
		ID: newID(), RuleID: r.ID, RuleName: r.Name, AccountID: r.AccountID,
		Cause: cause, OccurrenceAt: occurrenceAt, StartedAt: start,
	}

	if !r.Enabled {
		return e.settle(ctx, r, run, OutcomeSkipped, ReasonDisabled, nil)
	}
	if r.MinIntervalS > 0 && r.LastFiredAt > 0 && start-r.LastFiredAt < r.MinIntervalS {
		return e.settle(ctx, r, run, OutcomeSkipped, ReasonCooldown, nil)
	}
	// A stored rule is re-validated on every run, not trusted because it was
	// valid when it was written: the row is data, and data can be edited by
	// something that is not this engine.
	if err := r.Validate(); err != nil {
		return e.settle(ctx, r, run, OutcomeRefused, RefusalReason(err), err)
	}

	met, err := e.evalConditions(ctx, r)
	if err != nil {
		return e.settle(ctx, r, run, OutcomeRefused, RefusalReason(err), err)
	}
	if !met {
		return e.settle(ctx, r, run, OutcomeSkipped, ReasonConditionUnmet, nil)
	}

	// An alert has no device on the other end, so it skips resolution, the tier
	// gate, the ownership check and execution — every one of which exists to
	// govern moving something. It keeps the run record and the audit row,
	// because an alert that did not arrive still has to be visible as a run
	// that happened.
	if r.Action.IsNotify() {
		run.TargetCount = 1
		run.Tier = devices.TierRead
		if e.notifier != nil {
			e.notifier.Alert(ctx, Alert{
				AccountID: r.AccountID, RuleID: r.ID, RuleName: r.Name,
				Message: r.Action.Notify.Message, Cause: cause, At: start,
				TriggerDeviceKey: r.Trigger.DeviceKey(),
			})
		}
		return e.settle(ctx, r, run, OutcomeExecuted, "", nil)
	}

	plans, err := e.resolvePlans(r.Action)
	if err != nil {
		return e.settle(ctx, r, run, OutcomeRefused, RefusalReason(err), err)
	}
	run.TargetCount = len(plans)
	run.Verb = r.Action.Verb
	if r.Action.DeviceKey != "" {
		run.DeviceKey = r.Action.DeviceKey
	} else {
		run.DeviceKey = "zone:" + r.Action.Zone
	}
	for _, p := range plans {
		if p.Tier > run.Tier {
			run.Tier = p.Tier
		}
	}

	// EXECUTION-TIME TIER GATE. This is not belt-and-braces for the save-time
	// check; it is the check that matters. The catalogue is compiled in and can
	// change with a release, a driver can re-declare a device's capabilities on
	// its next Discover, and a rule saved a year ago is evaluated against
	// today's tiers. A stored rule carries no authority of its own.
	for _, p := range plans {
		if err := checkActionTier(p.Tier); err != nil {
			return e.settle(ctx, r, run, OutcomeRefused, ReasonTierTooHigh, err)
		}
		// Ownership is checked HERE for exactly the reason the tier is: a rule
		// carries no authority of its own. A device claimed by this account
		// when the rule was written may have been released to another since,
		// and a save-time check alone would keep firing at it forever.
		if err := e.checkDeviceOwnership(ctx, r.AccountID, p.Key); err != nil {
			return e.settle(ctx, r, run, OutcomeRefused, ReasonForeignDevice, err)
		}
	}

	executed := 0
	for _, p := range plans {
		if err := e.reg.ExecutePlan(ctx, p); err != nil {
			// Nothing is retried, and the remaining targets are abandoned: a
			// fan-out that has started failing is not a fan-out to push harder
			// on. Which target failed is recorded.
			outcome, reason := classifyDriverError(err)
			detail := refuse(reason, "%s %s: %v (%d of %d done)", p.Key, string(p.Verb), err, executed, len(plans))
			run.TargetCount = executed
			return e.settle(ctx, r, run, outcome, reason, detail)
		}
		executed++
	}
	run.TargetCount = executed
	return e.settle(ctx, r, run, OutcomeExecuted, "", nil)
}

// classifyDriverError maps a driver's error onto an outcome. The distinction
// devices.go draws between "it did not happen" and "I cannot tell" is kept all
// the way to the run history, because they warrant different follow-up and
// because collapsing them would let the engine claim a certainty it does not
// have.
func classifyDriverError(err error) (Outcome, string) {
	switch {
	case errors.Is(err, devices.ErrIndeterminate):
		return OutcomeIndeterminate, ReasonIndeterminate
	case devices.IsInvalid(err):
		// The device vanished or stopped offering the verb between Resolve and
		// ExecutePlan (which re-resolves). Nothing actuated.
		return OutcomeRefused, ReasonUnresolvable
	default:
		return OutcomeFailed, ReasonDriverError
	}
}

// evalConditions returns whether every condition holds. An error means the
// answer is not knowable — ambiguous sensor state — which refuses the run.
func (e *Engine) evalConditions(ctx context.Context, r Rule) (bool, error) {
	for _, c := range r.Conditions {
		readings, err := e.reg.Read(ctx, c.DeviceKey)
		if err != nil {
			return false, refuse(ReasonAmbiguousState, "condition device %s: %v", c.DeviceKey, err)
		}
		if c.IsState() {
			held, err := e.stateHolds(ctx, c, readings)
			if err != nil || !held {
				return held, err
			}
			continue
		}
		val, err := numericReading(readings, c.DeviceKey, c.Metric)
		if err != nil {
			return false, err
		}
		if !c.Op.Holds(val, c.Value) {
			return false, nil
		}
	}
	return true, nil
}

// numericReading extracts exactly one usable numeric sample for a metric.
//
// Every ambiguity is a refusal, never a default:
//   - no reading for that metric — the sensor did not say
//   - a text reading ("docked") where a number was asked for — the sensor said
//     something that is not comparable
//   - two readings for the same metric — the sensor said two things, and
//     averaging them would be the engine inventing a third
//   - NaN or ±Inf — arithmetic that no comparison can honestly answer
func numericReading(rs []devices.Reading, key, metric string) (float64, error) {
	found := false
	var val float64
	for _, rd := range rs {
		if rd.Metric != metric {
			continue
		}
		if rd.Text != "" {
			return 0, refuse(ReasonAmbiguousState, "%s: metric %q reads as text %q", key, metric, rd.Text)
		}
		if found {
			return 0, refuse(ReasonAmbiguousState, "%s: metric %q has more than one reading", key, metric)
		}
		val, found = rd.Value, true
	}
	if !found {
		return 0, refuse(ReasonAmbiguousState, "%s: no reading for metric %q", key, metric)
	}
	if math.IsNaN(val) || math.IsInf(val, 0) {
		return 0, refuse(ReasonAmbiguousState, "%s: metric %q is not a finite number", key, metric)
	}
	return val, nil
}

// settle records an outcome: it applies the breaker, writes the audit row for
// anything that reached the point of actuating (or of refusing to), persists
// the run and the rule's state, and returns the run.
//
// AUDIT POLICY, and why it is stricter than the rest of the codebase's
// best-effort WriteAdminAudit call sites: an unattended actuator whose trail
// cannot be written is an unattended actuator nobody can reconstruct. So a
// failed audit write DISABLES the rule (reason "audit_unavailable"). It cannot
// undo the actuation that already happened — the honest sequence is act, then
// record, and there is no transaction across a physical device — but it stops
// the NEXT one, and the run row keeps audited=0 so the gap is visible.
//
// Skips (disabled, cooldown, condition not met) write no audit row. They are
// not executions and did not come close to being one; putting them in a
// hash-chained append-only table would bury the rows that matter under a rule
// that checks a sensor every thirty seconds.
func (e *Engine) settle(ctx context.Context, r Rule, run Run, outcome Outcome, reason string, cause error) (Run, error) {
	now := e.nowUnix()
	run.Outcome = outcome
	run.FinishedAt = now
	if cause != nil {
		run.Reason = cause.Error()
	} else {
		run.Reason = reason
	}

	// Rule state: scheduler position first, so an occurrence is accounted for
	// even when the run refused. A refused occurrence that stayed unaccounted
	// would be retried on the next tick, forever.
	if run.OccurrenceAt > 0 {
		r.LastOccurrenceAt = run.OccurrenceAt
	}
	if outcome != OutcomeSkipped {
		r.LastOutcome = outcome
	}
	switch outcome {
	case OutcomeExecuted:
		r.LastFiredAt = now
		r.ConsecutiveFailures = 0
	case OutcomeFailed, OutcomeIndeterminate:
		r.LastFiredAt = now
		r.ConsecutiveFailures++
		if r.ConsecutiveFailures >= e.budget {
			e.disable(&r, "failure_budget", now)
		}
	case OutcomeRefused:
		if structuralReasons[reason] {
			e.disable(&r, reason, now)
		} else {
			r.ConsecutiveFailures++
			if r.ConsecutiveFailures >= e.budget {
				e.disable(&r, "failure_budget", now)
			}
		}
	}

	if outcome != OutcomeSkipped {
		detail := map[string]any{
			"account_id":    r.AccountID,
			"rule":          r.Name,
			"cause":         string(run.Cause),
			"outcome":       string(outcome),
			"reason":        run.Reason,
			"device_key":    run.DeviceKey,
			"verb":          string(run.Verb),
			"tier":          run.Tier.String(),
			"targets":       run.TargetCount,
			"occurrence_at": run.OccurrenceAt,
			"disabled":      r.DisabledReason,
		}
		if err := e.audit.WriteAdminAudit(ctx, r.CreatedBy, AuditRun, "automation_rule", r.ID,
			outcome == OutcomeExecuted, detail); err != nil {
			run.Audited = false
			if r.Enabled {
				e.disable(&r, ReasonAuditUnavailable, now)
			}
		} else {
			run.Audited = true
		}
	}

	r.UpdatedAt = now
	if err := e.store.SaveRuleState(ctx, r); err != nil {
		return run, err
	}
	if err := e.store.InsertRun(ctx, run); err != nil {
		return run, err
	}
	return run, cause
}

func (e *Engine) disable(r *Rule, reason string, now int64) {
	r.Enabled = false
	r.DisabledReason = reason
	r.DisabledAt = now
}

// RecordMissedOccurrence accounts for a scheduled occurrence the hub was not
// running for, without actuating. See Runner's catch-up policy.
func (e *Engine) RecordMissedOccurrence(ctx context.Context, r Rule, occurrenceAt int64) error {
	now := e.nowUnix()
	r.LastOccurrenceAt = occurrenceAt
	r.UpdatedAt = now
	if err := e.store.SaveRuleState(ctx, r); err != nil {
		return err
	}
	return e.store.InsertRun(ctx, Run{
		ID: newID(), RuleID: r.ID, RuleName: r.Name, AccountID: r.AccountID,
		Cause: CauseSchedule, OccurrenceAt: occurrenceAt, Outcome: OutcomeSkipped,
		Reason: ReasonStaleOccurrence, StartedAt: now, FinishedAt: now,
	})
}

// stateHolds evaluates a state condition against a device's readings.
//
// An UNKNOWN state is a REFUSAL, not a false. The distinction decides whether a
// rule silently stops firing or tells somebody why:
//
//   - false means the device reported and the condition does not hold. The rule
//     simply does not run this tick, which is ordinary.
//   - a refusal means the device did not report, or nobody mapped its metric,
//     or its capability declares no state at all. The rule cannot be evaluated,
//     and ReasonAmbiguousState is how that reaches an operator.
//
// Treating unknown as false would make "turn the porch light on when it is off"
// fire against a light whose driver has gone silent — acting on an absence as
// though it were an observation. numericReading already refuses a metric nobody
// sent, for exactly this reason; this is the same rule for the state form.
func (e *Engine) stateHolds(ctx context.Context, c Condition, readings []devices.Reading) (bool, error) {
	dev, ok := e.reg.Get(c.DeviceKey)
	if !ok {
		return false, refuse(ReasonAmbiguousState, "condition device %s is not in the fleet", c.DeviceKey)
	}
	if !devices.HasDeclaredState(dev.Device.Capabilities) {
		return false, refuse(ReasonAmbiguousState,
			"condition device %s declares no state to test — see docs/DEVICE-STATE.md", c.DeviceKey)
	}
	st := devices.ActiveFrom(dev.Device.Capabilities, readings)
	if !st.Known() {
		return false, refuse(ReasonAmbiguousState,
			"condition device %s did not report its state", c.DeviceKey)
	}
	if c.State == StateRequireActive {
		return st == devices.StateActive, nil
	}
	return st == devices.StateInactive, nil
}
