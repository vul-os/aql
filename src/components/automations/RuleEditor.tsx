// The automation rule editor — the WHEN → DO form the hub's engine has been
// missing a client for since create/update shipped (hub/internal/automations,
// served by hub/internal/httpapi/automations.go). See that package's header
// before touching this file: EVERY safety property — the tier ceiling
// (automations.MaxActionTier), the cooldown, the failure breaker — lives in
// the engine and is re-checked there on every save AND again immediately
// before a driver call. This form's job is narrower than it looks:
//
//   - Assemble a Rule shaped exactly like automations.Rule.Validate() expects
//     (rule.go) — no more, no fewer checks than that function makes. Adding a
//     rule this form invents (e.g. "verbs must be reversible") would be a
//     second copy of policy that can silently drift from the one that
//     actually enforces it; omitting one Validate() already makes (e.g. the
//     weekday-mask-can't-be-zero check) would let an obviously-wrong rule
//     reach the hub with a confusing refusal instead of an honest inline one.
//   - NEVER filter, grey out, or otherwise predict which verbs the hub will
//     accept. MaxActionTier is a compile-time constant in the engine
//     precisely so nothing else — including this form — can move it or
//     second-guess it. Every verb is offered; the hub decides.
//   - Render a refusal the way it actually arrives: the engine's own reason
//     string as-is (hub/internal/httpapi/automations.go's writeRuleErr sends
//     it verbatim as `error`, with the engine's own message as `detail`), not
//     re-worded into this form's own vocabulary. The scheduler logs the same
//     reason names, so a person who learns them here recognises them there.
//
// A rule save is always a FULL REPLACE (see automations.go's own comment on
// handleAutomationUpdate): there is no partial-field PATCH on the wire, so
// editing loads the whole rule into this form and resubmits the whole thing,
// same as creating one.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  ApiError,
  api,
  friendlyApiError,
  type AutomationConditionState,
  type AutomationRule,
  type AutomationRuleInput,
  type EngineDevice,
} from '@/lib/api';
import {
  buildConditions as buildConditionRows,
  newConditionRow,
  toConditionRow,
  type ConditionKind,
  type ConditionRow,
} from '@/lib/automationConditions';
import { controlsFor, type EngineControl } from '@/components/device/engineState';

type TriggerKind = 'schedule' | 'threshold' | 'event';
type CompareOp = 'above' | 'below' | 'at_least' | 'at_most';
type EventName = 'online' | 'offline' | 'degraded';

const COMPARE_OPS: Array<{ value: CompareOp; label: string }> = [
  { value: 'above', label: 'is above' },
  { value: 'below', label: 'is below' },
  { value: 'at_least', label: 'is at least' },
  { value: 'at_most', label: 'is at most' },
];

const EVENT_NAMES: EventName[] = ['online', 'offline', 'degraded'];

// bit i = time.Weekday(i) — bit 0 is SUNDAY, not Monday. Both
// automations/rule.go's Trigger.DeviceKey() callers and schedule.go's
// Validate() key days off Go's time.Weekday numbering, and this index order
// IS that mapping: WEEKDAY_LABELS[0] must stay "Sun". Getting this backwards
// writes a rule that fires on the wrong days and still looks correct in this
// form — there's no compile error, no refusal, just a schedule that's wrong.
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Fallback metric hints, used only until a device is chosen.
//
// This list used to be the WHOLE vocabulary offered, and it had not grown as
// drivers did: the shipped drivers emit seventeen metric names and this named
// four, so nothing the camera driver reports — media_lost, media_flowing,
// stream_ok — could be discovered from the form at all. A hint list is a second
// copy of a vocabulary that lives somewhere else, and it rotted the way second
// copies do.
//
// So it is a fallback now. Once a device is selected the hints come from what
// THAT device has actually reported (see metricHints below), which cannot rot
// because it is not a copy. Still hints either way: Threshold.Validate() only
// requires a non-empty string, and the engine matches metrics by name, so a
// metric this form has never heard of remains typeable and works.
const METRIC_HINTS = ['level', 'celsius', 'kw', 'percent'];

const COMMON_TZS = [
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
  'UTC',
];

function defaultTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function minuteToTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function timeToMinute(t: string): number {
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.min(1439, Math.max(0, h * 60 + m));
}

function daysToMask(days: Set<number>): number {
  let mask = 0;
  for (const d of days) mask |= 1 << d;
  return mask;
}

function maskToDays(mask: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < 7; i++) {
    if (mask & (1 << i)) out.add(i);
  }
  return out;
}

// Refusal reasons the engine can hand back on save (automations.go's
// vocabulary — ReasonTierTooHigh, ReasonInvalidRule, etc.). Each gets a
// sentence of CONTEXT here, never a reworded restatement: the reason code and
// the hub's own detail message are rendered verbatim alongside this, and this
// map only explains what the code MEANS, the way someone would explain a
// term they already looked up once.
const REFUSAL_CONTEXT: Record<string, string> = {
  tier_too_high:
    "An automation fires with nobody watching — that is the whole feature — so every verb above this hub's action ceiling is refused, unconditionally. The ceiling is a compile-time constant inside the engine; nothing on this form, and no setting anywhere in this console, can raise it. The fix is a different verb, or a different target whose verb resolves at or below the ceiling — not retrying the same save.",
  invalid_rule:
    'The assembled rule does not parse on the hub — usually a trigger or an action missing a field its kind requires, or one carrying a field that belongs to a different kind.',
  invalid_schedule:
    'The schedule could not be resolved. Check the time, that at least one weekday is checked (zero days means no days, not every day), and that the timezone is a real IANA name — "Africa/Johannesburg", not an abbreviation like "SAST".',
  unresolvable_target:
    'The device or zone named here is not one this hub currently knows about.',
  no_targets:
    'The zone named here currently has no member devices for the engine to resolve — a zone action needs at least one device carrying that zone.',
};

type ArgRow = { id: number; name: string; value: string };
let argRowSeq = 0;
function newArgRow(name = '', value = ''): ArgRow {
  argRowSeq += 1;
  return { id: argRowSeq, name, value };
}

function segmentClass(active: boolean): string {
  return `h-9 px-4 rounded-full border text-xs transition-colors ${
    active ? 'bg-ink text-paper border-ink' : 'bg-paper-cool text-ink border-ink/15 hover:border-ink/35'
  }`;
}

const inputClass =
  'mt-1 w-full h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink';

export default function RuleEditor({
  accountId,
  rule,
  devices,
  onClose,
  onSaved,
}: {
  accountId: string;
  /** null = creating; a rule = editing it. */
  rule: AutomationRule | null;
  /** Devices the engine knows about, for target and metric pickers. */
  devices: EngineDevice[];
  onClose: () => void;
  onSaved: (saved: AutomationRule) => void;
}) {
  const isEdit = rule !== null;

  const [name, setName] = useState(rule?.name ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  // ── trigger ────────────────────────────────────────────────────────────
  const [triggerKind, setTriggerKind] = useState<TriggerKind>(
    rule && (rule.trigger.kind === 'schedule' || rule.trigger.kind === 'threshold' || rule.trigger.kind === 'event')
      ? rule.trigger.kind
      : 'schedule',
  );

  const [scheduleTime, setScheduleTime] = useState(
    rule?.trigger.schedule ? minuteToTime(rule.trigger.schedule.minute_of_day) : '07:00',
  );
  const [scheduleDays, setScheduleDays] = useState<Set<number>>(
    rule?.trigger.schedule ? maskToDays(rule.trigger.schedule.days) : new Set([1, 2, 3, 4, 5]),
  );
  const [scheduleTz, setScheduleTz] = useState(rule?.trigger.schedule?.tz || defaultTz());

  const [thresholdDeviceKey, setThresholdDeviceKey] = useState(rule?.trigger.threshold?.device_key ?? '');
  const [thresholdMetric, setThresholdMetric] = useState(rule?.trigger.threshold?.metric ?? '');
  const [thresholdOp, setThresholdOp] = useState<CompareOp>(
    (rule?.trigger.threshold?.op as CompareOp) || 'below',
  );
  const [thresholdValue, setThresholdValue] = useState(
    rule?.trigger.threshold ? String(rule.trigger.threshold.value) : '',
  );

  const [eventDeviceKey, setEventDeviceKey] = useState(rule?.trigger.event?.device_key ?? '');
  const [eventName, setEventName] = useState<EventName>(
    (rule?.trigger.event?.name as EventName) || 'offline',
  );

  // ── conditions ─────────────────────────────────────────────────────────
  const [conditions, setConditions] = useState<ConditionRow[]>(() =>
    (rule?.conditions ?? []).map(toConditionRow),
  );
  function updateCondition(id: number, patch: Partial<ConditionRow>) {
    setConditions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // ── metric hints, from what the devices in this rule actually report ────
  //
  // Fetched rather than listed, because a hardcoded vocabulary is a second copy
  // of one that lives in the drivers, and the old four-item list had drifted
  // thirteen metrics behind them.
  //
  // Best-effort by construction: a failure leaves the fallback hints in place
  // and the field stays free text, so a hub with no engine, a slow reply or a
  // device that has reported nothing yet all degrade to exactly the behaviour
  // this form had before. Nothing here can prevent a rule being written.
  const [liveMetrics, setLiveMetrics] = useState<string[]>([]);
  const hintKeys = useMemo(() => {
    const keys = new Set<string>();
    if (thresholdDeviceKey.trim()) keys.add(thresholdDeviceKey.trim());
    for (const c of conditions) if (c.deviceKey.trim()) keys.add(c.deviceKey.trim());
    return [...keys].sort();
  }, [thresholdDeviceKey, conditions]);

  useEffect(() => {
    if (hintKeys.length === 0) {
      setLiveMetrics([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const found = new Set<string>();
      await Promise.all(
        hintKeys.map(async (key) => {
          try {
            const res = await api.engineReadings(key);
            for (const r of res.readings) found.add(r.metric);
          } catch {
            /* a device the engine does not know is not an error here */
          }
        }),
      );
      if (!cancelled) setLiveMetrics([...found].sort());
    })();
    return () => {
      cancelled = true;
    };
  }, [hintKeys]);

  const metricHints = liveMetrics.length > 0 ? liveMetrics : METRIC_HINTS;

  // ── action ─────────────────────────────────────────────────────────────
  const [actionKind, setActionKind] = useState<'device' | 'zone' | 'alert'>(
    rule?.action.notify ? 'alert' : rule?.action.zone ? 'zone' : 'device',
  );
  const [alertMessage, setAlertMessage] = useState(rule?.action.notify?.message ?? '');
  const [actionDeviceKey, setActionDeviceKey] = useState(rule?.action.device_key ?? '');
  const [actionZone, setActionZone] = useState(rule?.action.zone ?? '');
  const [verb, setVerb] = useState(rule?.action.verb ?? '');
  const [argRows, setArgRows] = useState<ArgRow[]>(() =>
    Object.entries(rule?.action.args ?? {}).map(([k, v]) => newArgRow(k, String(v))),
  );
  function updateArgRow(id: number, patch: Partial<ArgRow>) {
    setArgRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // ── cooldown ───────────────────────────────────────────────────────────
  const [minInterval, setMinInterval] = useState(String(rule?.min_interval_seconds ?? 0));

  // ── submit state ───────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [refusalCode, setRefusalCode] = useState<string | null>(null);
  const [refusalDetail, setRefusalDetail] = useState<string | null>(null);

  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices) if (d.zone) set.add(d.zone);
    return Array.from(set).sort();
  }, [devices]);

  // Verb suggestions only — a hint for the datalist, never a filter. Reuses
  // the presentation-only capability→verb table src/components/device/
  // engineState.ts already maintains for the live device-execute screen; that
  // table explicitly carries no tier information (see its own header
  // comment), which is exactly the property this form needs: it can suggest
  // "start" without pretending to know whether "start" is allowed.
  const verbSuggestions: EngineControl[] = useMemo(() => {
    const relevant =
      actionKind === 'device'
        ? devices.filter((d) => d.key === actionDeviceKey)
        : devices.filter((d) => actionZone && d.zone === actionZone);
    const seen = new Set<string>();
    const out: EngineControl[] = [];
    for (const d of relevant) {
      for (const c of controlsFor(d.capabilities)) {
        if (seen.has(c.verb)) continue;
        seen.add(c.verb);
        out.push(c);
      }
    }
    return out;
  }, [actionKind, actionDeviceKey, actionZone, devices]);

  const knownArg = verbSuggestions.find((c) => c.verb === verb)?.arg ?? null;

  function onVerbChange(v: string) {
    setVerb(v);
    const match = verbSuggestions.find((c) => c.verb === v);
    // Pre-fill the one argument the catalogue says this verb takes — but
    // only into an EMPTY args list, so picking a suggestion never clobbers
    // something the person already typed.
    if (match?.arg && argRows.length === 0) {
      setArgRows([newArgRow(match.arg.name, String(match.arg.initial))]);
    }
  }

  function toggleDay(i: number) {
    setScheduleDays((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // ── build the wire object, mirroring rule.go's Validate() exactly ───────

  function buildTrigger(): AutomationRule['trigger'] | null {
    switch (triggerKind) {
      case 'schedule': {
        if (scheduleDays.size === 0) {
          setFormError('Pick at least one weekday — an empty selection is an invalid schedule, not "every day".');
          return null;
        }
        if (!scheduleTz.trim()) {
          setFormError("A schedule needs a timezone — otherwise \"at seven\" doesn't survive a daylight-saving change.");
          return null;
        }
        return {
          kind: 'schedule',
          schedule: { minute_of_day: timeToMinute(scheduleTime), days: daysToMask(scheduleDays), tz: scheduleTz.trim() },
        };
      }
      case 'threshold': {
        if (!thresholdDeviceKey.trim() || !thresholdMetric.trim()) {
          setFormError('A threshold trigger needs both a device and a metric.');
          return null;
        }
        const value = Number(thresholdValue);
        if (!Number.isFinite(value)) {
          setFormError('The threshold value must be a number.');
          return null;
        }
        return {
          kind: 'threshold',
          threshold: { device_key: thresholdDeviceKey.trim(), metric: thresholdMetric.trim(), op: thresholdOp, value },
        };
      }
      case 'event': {
        if (!eventDeviceKey.trim()) {
          setFormError('An event trigger needs a device.');
          return null;
        }
        return { kind: 'event', event: { device_key: eventDeviceKey.trim(), name: eventName } };
      }
    }
    return null;
  }

  function buildConditions(): AutomationRule['conditions'] | null {
    const built = buildConditionRows(conditions);
    if (!built.ok) {
      setFormError(built.error);
      return null;
    }
    return built.conditions;
  }

  function buildAction(): AutomationRule['action'] | null {
    // An alert names no device and carries no verb, so it is built before the
    // target checks rather than being made to satisfy them.
    if (actionKind === 'alert') {
      const message = alertMessage.trim();
      if (!message) {
        setFormError('An alert needs something to say.');
        return null;
      }
      if (message.length > 500) {
        setFormError(`An alert message is at most 500 characters; this one is ${message.length}.`);
        return null;
      }
      return { notify: { message } };
    }
    const hasDevice = actionKind === 'device' && actionDeviceKey.trim() !== '';
    const hasZone = actionKind === 'zone' && actionZone.trim() !== '';
    if (!hasDevice && !hasZone) {
      setFormError('An action needs exactly one target — a device or a zone.');
      return null;
    }
    if (!verb.trim()) {
      setFormError('An action needs a verb.');
      return null;
    }
    const args: Record<string, number> = {};
    for (const row of argRows) {
      if (!row.name.trim()) continue;
      const v = Number(row.value);
      if (!Number.isFinite(v)) {
        setFormError(`The argument "${row.name}" needs a numeric value.`);
        return null;
      }
      args[row.name.trim()] = v;
    }
    return {
      ...(hasDevice ? { device_key: actionDeviceKey.trim() } : { zone: actionZone.trim() }),
      verb: verb.trim(),
      ...(Object.keys(args).length > 0 ? { args } : {}),
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setRefusalCode(null);
    setRefusalDetail(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Name is required.');
      return;
    }
    if (trimmedName.length > 120) {
      setFormError('Name is too long (120 characters max).');
      return;
    }
    const minIntervalNum = Number(minInterval);
    if (!Number.isFinite(minIntervalNum) || minIntervalNum < 0) {
      setFormError('Cooldown must be zero or a positive number of seconds.');
      return;
    }

    const trigger = buildTrigger();
    if (!trigger) return;
    const conds = buildConditions();
    if (!conds) return;
    const action = buildAction();
    if (!action) return;

    const body: AutomationRuleInput = {
      name: trimmedName,
      enabled,
      trigger,
      conditions: conds,
      action,
      min_interval_seconds: minIntervalNum,
    };

    setSubmitting(true);
    try {
      const saved = rule
        ? await api.automationUpdate(accountId, rule.id, body)
        : await api.automationCreate(accountId, body);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        // The reason IS the code (writeRuleErr sends automations.RefusalReason
        // verbatim as `error`), and detail is the engine's own message.
        // Rendered as-is below — see REFUSAL_CONTEXT's header comment.
        setRefusalCode(err.code);
        setRefusalDetail(err.detail ?? null);
      } else {
        setFormError(friendlyApiError(err, 'Could not save this rule.'));
      }
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="sm:max-w-2xl">
      <h2 className="font-display text-2xl mb-1">{isEdit ? 'Edit rule' : 'New rule'}</h2>
      <p className="text-sm text-ink/60 mb-5">
        Every safety property here belongs to the hub, not this form — the action-tier ceiling,
        the cooldown, the failure breaker. Nothing below filters or predicts what the hub will
        accept: pick freely, save, and read what comes back.
        {isEdit && ' Saving replaces the whole rule — there is no partial edit on the wire.'}
      </p>

      <datalist id="rule-editor-device-options">
        {devices.map((d) => (
          <option key={d.key} value={d.key}>
            {d.name}
          </option>
        ))}
      </datalist>
      <datalist id="rule-editor-metric-options">
        {metricHints.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="rule-editor-zone-options">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <datalist id="rule-editor-verb-options">
        {verbSuggestions.map((c) => (
          <option key={c.verb} value={c.verb}>
            {c.label}
          </option>
        ))}
      </datalist>
      <datalist id="rule-editor-tz-options">
        {COMMON_TZS.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-sm font-medium text-ink/85">Name</span>
            <input
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Evening lights"
              className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </label>
          <label className="flex items-center gap-2 h-11 px-1 select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-ink h-4 w-4"
            />
            <span className="text-sm text-ink/85">Enabled</span>
          </label>
        </div>

        {/* ─────────────────────────── Trigger ─────────────────────────── */}
        <div>
          <span className="text-sm font-medium text-ink/85">When</span>
          <div className="flex gap-2 mt-1.5">
            {(['schedule', 'threshold', 'event'] as TriggerKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setTriggerKind(k)} className={segmentClass(triggerKind === k)}>
                {k === 'schedule' ? 'Schedule' : k === 'threshold' ? 'Threshold' : 'Event'}
              </button>
            ))}
          </div>

          {triggerKind === 'schedule' && (
            <div className="mt-3 space-y-3 rounded-xl border border-ink/15 bg-paper-cool p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="text-xs text-ink/60">Time of day</span>
                  <input
                    type="time"
                    required
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className={`${inputClass} w-auto`}
                  />
                </label>
                <label className="block flex-1 min-w-[220px]">
                  <span className="text-xs text-ink/60">Timezone</span>
                  <input
                    list="rule-editor-tz-options"
                    required
                    value={scheduleTz}
                    onChange={(e) => setScheduleTz(e.target.value)}
                    placeholder="e.g. Africa/Johannesburg"
                    className={inputClass}
                  />
                </label>
              </div>
              <p className="text-[11px] text-ink/50">
                Local wall-clock time in this zone — "07:00" keeps meaning seven in the morning
                across a daylight-saving change, rather than sliding by an hour with it.
              </p>
              <div>
                <span className="text-xs text-ink/60">Days</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <button key={label} type="button" onClick={() => toggleDay(i)} className={segmentClass(scheduleDays.has(i))}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink/50 mt-1">
                  At least one day is required — none selected is an invalid rule, not "every day".
                </p>
              </div>
            </div>
          )}

          {triggerKind === 'threshold' && (
            <div className="mt-3 space-y-3">
              <Card className="border-gold/40 bg-gold/10">
                <p className="text-[10px] uppercase tracking-[0.18em] text-gold mb-1.5">
                  Edge-triggered, not level-triggered
                </p>
                <p className="text-sm text-ink/80 leading-relaxed">
                  This fires on the CROSSING, not on the state. A tank already below 20% when the
                  hub boots does not fire a rule written "when it drops below 20%" — the reading
                  has to cross the bound while the engine is watching. If you need to catch a
                  value that might already be past the bound, add a condition on the same reading
                  to a schedule instead; this trigger alone will stay silent on it.
                </p>
              </Card>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-ink/60">Device</span>
                  <input
                    list="rule-editor-device-options"
                    required
                    value={thresholdDeviceKey}
                    onChange={(e) => setThresholdDeviceKey(e.target.value)}
                    placeholder="device key"
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-ink/60">Metric</span>
                  <input
                    list="rule-editor-metric-options"
                    required
                    value={thresholdMetric}
                    onChange={(e) => setThresholdMetric(e.target.value)}
                    placeholder="e.g. level"
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-ink/60">Comparison</span>
                  <select
                    value={thresholdOp}
                    onChange={(e) => setThresholdOp(e.target.value as CompareOp)}
                    className={`${inputClass} font-sans`}
                  >
                    {COMPARE_OPS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-ink/60">Value</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={thresholdValue}
                    onChange={(e) => setThresholdValue(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
            </div>
          )}

          {triggerKind === 'event' && (
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-ink/60">Device</span>
                <input
                  list="rule-editor-device-options"
                  required
                  value={eventDeviceKey}
                  onChange={(e) => setEventDeviceKey(e.target.value)}
                  placeholder="device key"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-xs text-ink/60">Transition</span>
                <select
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value as EventName)}
                  className={`${inputClass} font-sans`}
                >
                  {EVENT_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {/* ────────────────────────── Conditions ────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink/85">Conditions (optional, all must hold)</span>
            <button
              type="button"
              disabled={conditions.length >= 8}
              onClick={() => setConditions((prev) => [...prev, newConditionRow()])}
              className="text-xs underline underline-offset-4 decoration-terracotta text-ink/65 hover:text-ink disabled:opacity-40 disabled:no-underline"
            >
              + Add condition
            </button>
          </div>
          {conditions.length === 0 ? (
            <p className="text-xs text-ink/45">No conditions — the action runs whenever the trigger fires.</p>
          ) : (
            <div className="space-y-2">
              {conditions.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-ink/15 bg-paper-cool p-3 grid sm:grid-cols-[auto_1fr_1fr_auto_1fr_auto] gap-2 items-center"
                >
                  <select
                    value={c.kind}
                    onChange={(e) => updateCondition(c.id, { kind: e.target.value as ConditionKind })}
                    aria-label="Condition kind"
                    className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  >
                    <option value="numeric">reading</option>
                    <option value="state">is on / is off</option>
                  </select>
                  <input
                    list="rule-editor-device-options"
                    required
                    value={c.deviceKey}
                    onChange={(e) => updateCondition(c.id, { deviceKey: e.target.value })}
                    placeholder="device key"
                    aria-label="Condition device"
                    className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink"
                  />
                  {c.kind === 'state' ? (
                    <select
                      value={c.state}
                      onChange={(e) =>
                        updateCondition(c.id, { state: e.target.value as AutomationConditionState })
                      }
                      aria-label="Required state"
                      className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink sm:col-span-3"
                    >
                      <option value="active">is on / running</option>
                      <option value="inactive">is off / idle</option>
                    </select>
                  ) : (
                    <>
                      <input
                        list="rule-editor-metric-options"
                        required
                        value={c.metric}
                        onChange={(e) => updateCondition(c.id, { metric: e.target.value })}
                        placeholder="metric"
                        aria-label="Condition metric"
                        className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink"
                      />
                      <select
                        value={c.op}
                        onChange={(e) => updateCondition(c.id, { op: e.target.value as CompareOp })}
                        aria-label="Comparison"
                        className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                      >
                        {COMPARE_OPS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="any"
                        required
                        value={c.value}
                        onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                        placeholder="value"
                        aria-label="Condition value"
                        className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink"
                      />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setConditions((prev) => prev.filter((r) => r.id !== c.id))}
                    className="text-xs text-ink/50 hover:text-terracotta-deep"
                    aria-label="Remove condition"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-ink/50 mt-1.5">
            Checked again at the moment the rule fires, against a fresh reading — not the sample
            that triggered it. A reading that can't be read, or reads as text where a number was
            asked for, refuses the run rather than passing by default.
          </p>
          <p className="text-[11px] text-ink/50 mt-1">
            <b>is on / is off</b> asks the device what it is doing, using its own capability's
            definition — so the rule keeps meaning the same thing if you later rename a metric.
            A device that has not reported, or that declares no state at all, satisfies neither:
            the run is refused rather than treated as off.
          </p>
        </div>

        {/* ───────────────────────────── Action ─────────────────────────── */}
        <div>
          <span className="text-sm font-medium text-ink/85">Do</span>
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => setActionKind('device')} className={segmentClass(actionKind === 'device')}>
              One device
            </button>
            <button type="button" onClick={() => setActionKind('zone')} className={segmentClass(actionKind === 'zone')}>
              A zone
            </button>
            {/* An alert drives nothing. Offered beside the two that do, because
                "tell me" is a peer of "do something" and not a lesser option —
                before it existed the only way to be told was to write a rule
                that moved a device you did not want moved. */}
            <button type="button" onClick={() => setActionKind('alert')} className={segmentClass(actionKind === 'alert')}>
              Just alert me
            </button>
          </div>

          {actionKind === 'alert' ? (
            <div className="mt-3">
              <label className="block">
                <span className="text-xs text-ink/60">Message</span>
                <textarea
                  required
                  rows={2}
                  maxLength={500}
                  value={alertMessage}
                  onChange={(e) => setAlertMessage(e.target.value)}
                  placeholder="e.g. the water tank is below 20%"
                  className={inputClass}
                />
              </label>
              <p className="text-[11px] text-ink/50 mt-2 leading-relaxed">
                Your words, sent to this account's webhooks when the rule fires. The hub adds
                which rule spoke, what triggered it and when — it does not write the sentence,
                because a generated one would be about the device and the useful sentence is
                about what you want done. With no webhook configured the rule still runs and
                its record says so, which is how you tell “no alert was raised” from “one was
                raised and did not reach you”.
              </p>
            </div>
          ) : (
          <>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {actionKind === 'device' ? (
              <label className="block">
                <span className="text-xs text-ink/60">Device</span>
                <input
                  list="rule-editor-device-options"
                  required
                  value={actionDeviceKey}
                  onChange={(e) => setActionDeviceKey(e.target.value)}
                  placeholder="device key"
                  className={inputClass}
                />
              </label>
            ) : (
              <label className="block">
                <span className="text-xs text-ink/60">Zone</span>
                <input
                  list="rule-editor-zone-options"
                  required
                  value={actionZone}
                  onChange={(e) => setActionZone(e.target.value)}
                  placeholder="zone name"
                  className={inputClass}
                />
              </label>
            )}
            <label className="block">
              <span className="text-xs text-ink/60">Verb</span>
              <input
                list="rule-editor-verb-options"
                required
                value={verb}
                onChange={(e) => onVerbChange(e.target.value)}
                placeholder="e.g. start, set, arm"
                className={inputClass}
              />
            </label>
          </div>

          <p className="text-[11px] text-ink/50 mt-2 leading-relaxed">
            A zone fans this verb out over every device carrying it — if even one member resolves
            above the hub's ceiling, the WHOLE run is refused rather than doing the safe part.
            This form does not grey out or predict which verbs the hub will accept: every verb is
            offered, and the refusal below (if any) is the hub's own answer, not a guess made here.
          </p>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-ink/85">Arguments (optional)</span>
              <button
                type="button"
                onClick={() => setArgRows((prev) => [...prev, newArgRow()])}
                className="text-xs underline underline-offset-4 decoration-terracotta text-ink/65 hover:text-ink"
              >
                + Add argument
              </button>
            </div>
            {argRows.length === 0 ? (
              <p className="text-xs text-ink/45">No arguments — most verbs (on, off, start, stop, lock…) take none.</p>
            ) : (
              <div className="space-y-2">
                {argRows.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateArgRow(row.id, { name: e.target.value })}
                      placeholder="name, e.g. level"
                      className="h-9 flex-1 rounded-lg bg-paper border border-ink/15 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink"
                    />
                    <input
                      type="number"
                      step="any"
                      value={row.value}
                      onChange={(e) => updateArgRow(row.id, { value: e.target.value })}
                      placeholder="value"
                      className="h-9 w-32 rounded-lg bg-paper border border-ink/15 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink"
                    />
                    <button
                      type="button"
                      onClick={() => setArgRows((prev) => prev.filter((r) => r.id !== row.id))}
                      className="text-xs text-ink/50 hover:text-terracotta-deep"
                      aria-label="Remove argument"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {knownArg && (
              <p className="text-[11px] text-ink/50 mt-1.5">
                This verb's catalogue entry takes "{knownArg.name}" ({knownArg.min}–{knownArg.max}
                {knownArg.unit}) — pre-filled above. Whatever you send here is validated by the
                hub; an argument a verb did not ask for is dropped before a driver ever sees it.
              </p>
            )}
          </div>
          </>
          )}
        </div>

        <label className="block max-w-xs">
          <span className="text-sm font-medium text-ink/85">Cooldown</span>
          <input
            type="number"
            min={0}
            step={1}
            required
            value={minInterval}
            onChange={(e) => setMinInterval(e.target.value)}
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-ink"
          />
          <span className="block text-[11px] text-ink/50 mt-1">
            Seconds. The shortest gap the engine allows between two runs of this rule, however it's
            asked to fire.
          </span>
        </label>

        {formError && <p className="text-sm text-terracotta-deep">{formError}</p>}

        {refusalCode && (
          <div className="rounded-xl border border-terracotta/40 bg-terracotta/5 p-4 space-y-1.5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-terracotta-deep">{refusalCode}</p>
            {REFUSAL_CONTEXT[refusalCode] && (
              <p className="text-sm text-ink/80 leading-relaxed">{REFUSAL_CONTEXT[refusalCode]}</p>
            )}
            {refusalDetail && <p className="text-xs font-mono text-ink/60">{refusalDetail}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink">
            Cancel
          </button>
          <Button type="submit" variant="ink" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create rule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
