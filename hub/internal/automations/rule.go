package automations

import (
	"encoding/json"
	"strings"

	"github.com/vul-os/aql/hub/internal/devices"
)

// TriggerKind is what makes a rule ask to run. The set is CLOSED, for the same
// reason the verb catalogue is closed: an open-ended trigger space cannot be
// reviewed, and every one of these ends in an actuation.
type TriggerKind string

const (
	// TriggerSchedule — a time of day, on chosen weekdays, in a named zone.
	TriggerSchedule TriggerKind = "schedule"
	// TriggerThreshold — a device metric CROSSING a bound. Edge-triggered, not
	// level-triggered: a tank that is already below 20% when the hub boots does
	// not fire a rule written for "when it drops below 20%". See Runner.
	TriggerThreshold TriggerKind = "threshold"
	// TriggerEvent — a device changing availability (online/offline/degraded).
	// This is the only "event" the device engine actually has today; it is
	// derived from the registry's own index rather than from a bus that does
	// not exist, and it is named narrowly so nobody mistakes it for one.
	TriggerEvent TriggerKind = "event"
)

// CompareOp is the comparison a threshold or condition makes. Closed set; the
// zero value is invalid and every evaluation fails closed on it.
type CompareOp string

const (
	OpAbove   CompareOp = "above"
	OpBelow   CompareOp = "below"
	OpAtLeast CompareOp = "at_least"
	OpAtMost  CompareOp = "at_most"
)

// Valid reports whether op was explicitly set to a known comparison.
func (op CompareOp) Valid() bool {
	switch op {
	case OpAbove, OpBelow, OpAtLeast, OpAtMost:
		return true
	}
	return false
}

// Holds evaluates the comparison. An unset or unknown op reports false — an
// automation that cannot say what it is comparing does not get to actuate.
func (op CompareOp) Holds(value, bound float64) bool {
	switch op {
	case OpAbove:
		return value > bound
	case OpBelow:
		return value < bound
	case OpAtLeast:
		return value >= bound
	case OpAtMost:
		return value <= bound
	}
	return false
}

// Threshold is a numeric bound on one device metric. Metric names come from
// the capability's own vocabulary, the same strings devices.Reading uses
// ("level", "celsius", "kw", "percent").
type Threshold struct {
	DeviceKey string    `json:"device_key"`
	Metric    string    `json:"metric"`
	Op        CompareOp `json:"op"`
	Value     float64   `json:"value"`
}

// EventName is a device-availability transition.
type EventName string

const (
	EventOnline   EventName = "online"
	EventOffline  EventName = "offline"
	EventDegraded EventName = "degraded"
)

// Availability maps an event name onto the registry's own vocabulary.
func (e EventName) Availability() (devices.Availability, bool) {
	switch e {
	case EventOnline:
		return devices.AvailOnline, true
	case EventOffline:
		return devices.AvailOffline, true
	case EventDegraded:
		return devices.AvailDegraded, true
	}
	return "", false
}

// Event is "this device entered this availability state".
type Event struct {
	DeviceKey string    `json:"device_key"`
	Name      EventName `json:"name"`
}

// Trigger is the WHEN half of a rule. Exactly one of the three payloads is
// populated, chosen by Kind.
type Trigger struct {
	Kind      TriggerKind `json:"kind"`
	Schedule  *Schedule   `json:"schedule,omitempty"`
	Threshold *Threshold  `json:"threshold,omitempty"`
	Event     *Event      `json:"event,omitempty"`
}

// DeviceKey returns the device this trigger watches, or "" for a schedule.
func (t Trigger) DeviceKey() string {
	switch t.Kind {
	case TriggerThreshold:
		if t.Threshold != nil {
			return t.Threshold.DeviceKey
		}
	case TriggerEvent:
		if t.Event != nil {
			return t.Event.DeviceKey
		}
	}
	return ""
}

// Validate fails closed: an unknown kind, or a kind whose payload is missing or
// belongs to a different kind, is a refusal.
func (t Trigger) Validate() error {
	switch t.Kind {
	case TriggerSchedule:
		if t.Schedule == nil {
			return refuse(ReasonInvalidRule, "schedule trigger has no schedule")
		}
		if t.Threshold != nil || t.Event != nil {
			return refuse(ReasonInvalidRule, "schedule trigger carries another kind's payload")
		}
		return t.Schedule.Validate()
	case TriggerThreshold:
		if t.Threshold == nil {
			return refuse(ReasonInvalidRule, "threshold trigger has no threshold")
		}
		if t.Schedule != nil || t.Event != nil {
			return refuse(ReasonInvalidRule, "threshold trigger carries another kind's payload")
		}
		if t.Threshold.DeviceKey == "" {
			return refuse(ReasonInvalidRule, "threshold trigger names no device")
		}
		if t.Threshold.Metric == "" {
			return refuse(ReasonInvalidRule, "threshold trigger names no metric")
		}
		if !t.Threshold.Op.Valid() {
			return refuse(ReasonInvalidRule, "threshold trigger has an unknown comparison %q", string(t.Threshold.Op))
		}
		return nil
	case TriggerEvent:
		if t.Event == nil {
			return refuse(ReasonInvalidRule, "event trigger has no event")
		}
		if t.Schedule != nil || t.Threshold != nil {
			return refuse(ReasonInvalidRule, "event trigger carries another kind's payload")
		}
		if t.Event.DeviceKey == "" {
			return refuse(ReasonInvalidRule, "event trigger names no device")
		}
		if _, ok := t.Event.Name.Availability(); !ok {
			return refuse(ReasonInvalidRule, "event trigger has an unknown event %q", string(t.Event.Name))
		}
		return nil
	}
	return refuse(ReasonInvalidRule, "unknown trigger kind %q", string(t.Kind))
}

// Condition is an AND-guard evaluated at fire time, against a reading taken
// then — not against the sample that fired the trigger. A condition that
// cannot be read, or that reads as text where a number was asked for, is
// AMBIGUOUS and refuses the run. It never passes by default.
type Condition struct {
	DeviceKey string `json:"device_key"`
	// Metric names the reading to compare, for a NUMERIC condition. Empty
	// means this is a STATE condition instead, judged by the catalogue's
	// declaration rather than by a number the author had to know.
	Metric string    `json:"metric,omitempty"`
	Op     CompareOp `json:"op,omitempty"`
	Value  float64   `json:"value,omitempty"`

	// State, when set, requires the device to be active or inactive.
	//
	// This exists because a numeric comparison cannot express a text state at
	// all. "The mower is docked" and "the porch light is on" are the two
	// commonest things a rule wants to check, and for a device whose driver
	// reports `state: "docked"` there was no way to say either — numericReading
	// refuses a text reading, correctly, and the author had no other tool.
	//
	// It is also more robust than the numeric form where both work. A rule
	// saying `level above 0` breaks if the operator renames their metric; one
	// saying `active` is resolved through the capability's declaration
	// (docs/DEVICE-STATE.md), so it keeps meaning the same thing.
	State ConditionState `json:"state,omitempty"`
}

// ConditionState is the semantic state a condition requires.
type ConditionState string

const (
	// StateRequireActive — the device must report itself active.
	StateRequireActive ConditionState = "active"
	// StateRequireInactive — the device must report itself INACTIVE, which is
	// not the same as failing to report. A device whose state is unknown
	// satisfies neither, and the rule refuses rather than guessing — the same
	// rule numericReading follows for a metric nobody sent.
	StateRequireInactive ConditionState = "inactive"
)

func (c ConditionState) valid() bool {
	return c == StateRequireActive || c == StateRequireInactive
}

// IsState reports whether this is a state condition rather than a numeric one.
func (c Condition) IsState() bool { return c.State != "" }

// Validate checks one condition's shape.
//
// The two forms are mutually exclusive, and saying so is worth a refusal: a
// condition carrying both a metric and a state has two possible meanings, and
// picking one would make a rule do something its author did not write.
func (c Condition) Validate() error {
	if c.DeviceKey == "" {
		return refuse(ReasonInvalidRule, "condition names no device")
	}
	if c.IsState() {
		if !c.State.valid() {
			return refuse(ReasonInvalidRule, "condition has an unknown state %q", string(c.State))
		}
		if c.Metric != "" || c.Op != "" {
			return refuse(ReasonInvalidRule,
				"condition asks for state %q AND a metric comparison — it can only mean one",
				string(c.State))
		}
		return nil
	}
	if c.Metric == "" {
		return refuse(ReasonInvalidRule, "condition names no metric")
	}
	if !c.Op.Valid() {
		return refuse(ReasonInvalidRule, "condition has an unknown comparison %q", string(c.Op))
	}
	return nil
}

// Action is the DO half of a rule: one capability verb, on one device or on
// one zone.
//
// Zone is the grouping field on devices.Device — free text, presentational,
// and it authorises nothing. Fanning a verb out over a zone does not widen what
// may be actuated: every member is resolved and tier-checked individually, and
// a single member resolving above MaxActionTier refuses the WHOLE run rather
// than doing the safe part of it. Doing most of an automation is not a safe
// state; it is a state nobody wrote down.
type Action struct {
	// Exactly one of DeviceKey, Zone and Notify is set.
	DeviceKey string       `json:"device_key,omitempty"`
	Zone      string       `json:"zone,omitempty"`
	Verb      devices.Verb `json:"verb,omitempty"`

	// Notify raises an alert instead of actuating anything.
	//
	// Until this existed a rule could only respond to its trigger by DRIVING
	// something, so "tell me when the tank is low" was inexpressible — the
	// nearest thing an operator could write was a rule that actuated a device
	// they did not want moved, purely to make a run happen. That is a
	// workaround that moves a physical thing to send a message.
	//
	// It actuates nothing, which is why it needs no tier ceiling, no ownership
	// check and no cooldown: there is no device on the other end of it. What it
	// does need is the same run record and audit row as any other rule, so an
	// alert that did not arrive is still visible as a run that happened.
	Notify *Notify `json:"notify,omitempty"`

	// Args carries the verb's single numeric argument when its VerbSpec
	// declares one. The registry validates presence and range; anything it did
	// not ask for is dropped before a driver sees it.
	Args map[string]float64 `json:"args,omitempty"`
}

// Notify is an alert raised by a rule.
type Notify struct {
	// Message is the operator's own words. The hub adds the rule name, the
	// trigger and the time; it does not compose the sentence, because a
	// generated one would be about the DEVICE and the useful sentence is about
	// what the operator wants done.
	Message string `json:"message"`
}

// Validate checks an alert's shape.
func (n Notify) Validate() error {
	if strings.TrimSpace(n.Message) == "" {
		return refuse(ReasonInvalidRule, "notify action has no message")
	}
	if len(n.Message) > NotifyMaxMessage {
		return refuse(ReasonInvalidRule,
			"notify message is %d characters, over the %d limit", len(n.Message), NotifyMaxMessage)
	}
	return nil
}

// NotifyMaxMessage bounds an alert's text. Generous for a sentence and far
// short of anything that would make a webhook body worth attacking with.
const NotifyMaxMessage = 500

// IsNotify reports whether this action alerts rather than actuating.
func (a Action) IsNotify() bool { return a.Notify != nil }

// Validate checks the action's shape. It does NOT check the tier — that needs
// the registry, and it happens in Engine.
func (a Action) Validate() error {
	// The three forms are mutually exclusive, and an action carrying two has
	// two meanings — picking one would make a rule do something its author did
	// not write. Same rule Condition applies to its two forms.
	if a.IsNotify() {
		if a.DeviceKey != "" || a.Zone != "" || a.Verb != "" {
			return refuse(ReasonInvalidRule, "action both alerts and drives a device")
		}
		return a.Notify.Validate()
	}
	if a.DeviceKey == "" && a.Zone == "" {
		return refuse(ReasonInvalidRule, "action names neither a device nor a zone")
	}
	if a.DeviceKey != "" && a.Zone != "" {
		return refuse(ReasonInvalidRule, "action names both a device and a zone")
	}
	if strings.TrimSpace(string(a.Verb)) == "" {
		return refuse(ReasonInvalidRule, "action names no verb")
	}
	return nil
}

// Rule is the persisted when → do object.
type Rule struct {
	ID        string
	AccountID string
	Name      string
	Enabled   bool
	// CreatedBy is the member who authorised this unattended actuation. It is
	// the actor on every audit row the rule's runs write. The column is
	// ON DELETE SET NULL, so it empties if that user is ever deleted;
	// CreatedBySnapshot is the permanent insert-time copy, the same
	// live-pointer + snapshot pattern migration 0007 uses for audit actors.
	CreatedBy         string
	CreatedBySnapshot string

	Trigger    Trigger
	Conditions []Condition
	Action     Action

	// ActionTier is the tier the action resolved to when the rule was saved.
	// A record, for the console and for forensics — never the authority at
	// execution time, which re-resolves. See Engine.Fire.
	ActionTier devices.Tier

	// MinIntervalS is the flap guard: the shortest gap between two runs of
	// this rule, whatever fires them.
	MinIntervalS int64

	// Scheduler state. LastOccurrenceAt is the SCHEDULED instant most recently
	// accounted for — fired or deliberately skipped as stale — which is what
	// makes a restart neither replay a missed evening nor swallow one.
	LastOccurrenceAt int64
	LastFiredAt      int64
	LastOutcome      Outcome

	// Breaker state.
	ConsecutiveFailures int
	DisabledReason      string
	DisabledAt          int64

	CreatedAt int64
	UpdatedAt int64
}

// Validate checks everything about a rule that can be checked without the
// device registry. Engine.SaveRule runs this first and then the tier gate.
func (r Rule) Validate() error {
	if r.AccountID == "" {
		return refuse(ReasonInvalidRule, "rule has no account")
	}
	if strings.TrimSpace(r.Name) == "" {
		return refuse(ReasonInvalidRule, "rule has no name")
	}
	if len(r.Name) > 120 {
		return refuse(ReasonInvalidRule, "rule name is too long")
	}
	if r.MinIntervalS < 0 {
		return refuse(ReasonInvalidRule, "negative min interval")
	}
	if err := r.Trigger.Validate(); err != nil {
		return err
	}
	if len(r.Conditions) > 8 {
		return refuse(ReasonInvalidRule, "too many conditions")
	}
	for _, c := range r.Conditions {
		if err := c.Validate(); err != nil {
			return err
		}
	}
	return r.Action.Validate()
}

// DeviceKeys returns every device key the rule names, trigger and action, for
// the console and for the save-time existence check. A zone action contributes
// nothing here — its members are resolved live.
func (r Rule) DeviceKeys() []string {
	seen := map[string]bool{}
	var out []string
	add := func(k string) {
		if k == "" || seen[k] {
			return
		}
		seen[k] = true
		out = append(out, k)
	}
	add(r.Trigger.DeviceKey())
	add(r.Action.DeviceKey)
	for _, c := range r.Conditions {
		add(c.DeviceKey)
	}
	return out
}

// --- JSON column codecs -----------------------------------------------------
//
// The three json columns are encoded here rather than in the store so that a
// row can never be written with a payload that did not go through Validate.

func encodeTrigger(t Trigger) (string, error) {
	raw, err := json.Marshal(t)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeTrigger(s string) (Trigger, error) {
	var t Trigger
	if s == "" {
		return t, refuse(ReasonInvalidRule, "stored rule has an empty trigger")
	}
	if err := json.Unmarshal([]byte(s), &t); err != nil {
		return Trigger{}, refuse(ReasonInvalidRule, "stored rule has an unreadable trigger")
	}
	return t, nil
}

func encodeConditions(cs []Condition) (string, error) {
	if cs == nil {
		cs = []Condition{}
	}
	raw, err := json.Marshal(cs)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeConditions(s string) ([]Condition, error) {
	if s == "" {
		return nil, nil
	}
	var cs []Condition
	if err := json.Unmarshal([]byte(s), &cs); err != nil {
		return nil, refuse(ReasonInvalidRule, "stored rule has unreadable conditions")
	}
	return cs, nil
}

func encodeAction(a Action) (string, error) {
	raw, err := json.Marshal(a)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeAction(s string) (Action, error) {
	var a Action
	if s == "" {
		return a, refuse(ReasonInvalidRule, "stored rule has an empty action")
	}
	if err := json.Unmarshal([]byte(s), &a); err != nil {
		return Action{}, refuse(ReasonInvalidRule, "stored rule has an unreadable action")
	}
	return a, nil
}
