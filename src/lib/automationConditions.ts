import type { AutomationConditionState, AutomationRule } from '@/lib/api';

/**
 * The condition row model, and the two conversions between it and the wire.
 *
 * These live here rather than inside RuleEditor because the invariant they hold
 * is worth testing directly: a condition that survives load → edit → save must
 * still mean what it meant. There is no component-test harness in this repo, so
 * a pure module is the only way these get asserted at all.
 *
 * A condition is one of TWO shapes on the hub and never both — the engine
 * refuses one carrying a metric AND a state, because it would have two possible
 * meanings (hub/internal/automations/rule.go, Condition.Validate). The row
 * therefore carries WHICH shape it is instead of inferring it. Inferring is the
 * bug: a state condition has no metric, so a row model with only the numeric
 * fields reads one back as an empty metric and writes it out as a numeric
 * condition — the rule changes meaning by being opened and saved, with nothing
 * on screen to show it happened.
 */

export type CompareOp = 'below' | 'at_most' | 'at_least' | 'above';

export type ConditionKind = 'numeric' | 'state';

export type ConditionRow = {
  id: number;
  kind: ConditionKind;
  deviceKey: string;
  metric: string;
  op: CompareOp;
  value: string;
  state: AutomationConditionState;
};

export type WireCondition = AutomationRule['conditions'][number];

let conditionRowSeq = 0;

export function newConditionRow(): ConditionRow {
  conditionRowSeq += 1;
  return {
    id: conditionRowSeq,
    kind: 'numeric',
    deviceKey: '',
    metric: '',
    op: 'below',
    value: '',
    state: 'active',
  };
}

/** Wire → row. */
export function toConditionRow(c: WireCondition): ConditionRow {
  conditionRowSeq += 1;
  // `state` being present is what makes it a state condition — the same test
  // the hub uses (Condition.IsState). NOT "metric is empty": a half-filled
  // numeric condition would then be silently reclassified as a state one.
  const isState = c.state === 'active' || c.state === 'inactive';
  return {
    id: conditionRowSeq,
    kind: isState ? 'state' : 'numeric',
    deviceKey: c.device_key,
    metric: c.metric ?? '',
    op: (c.op as CompareOp) || 'below',
    // A state condition carries no value; String(undefined) would put the
    // literal text "undefined" in a number input.
    value: c.value === undefined || c.value === null ? '' : String(c.value),
    state: isState ? (c.state as AutomationConditionState) : 'active',
  };
}

export type BuildResult =
  | { ok: true; conditions: WireCondition[] }
  | { ok: false; error: string };

/** Rows → wire, or the first reason it cannot be built. */
export function buildConditions(rows: ConditionRow[]): BuildResult {
  if (rows.length > 8) return { ok: false, error: 'At most 8 conditions per rule.' };

  const out: WireCondition[] = [];
  for (const c of rows) {
    if (!c.deviceKey.trim()) {
      return { ok: false, error: "Every condition needs a device — remove the row if you don't need it." };
    }
    // The two shapes are emitted separately and never merged: sending the
    // numeric fields alongside a state would make the hub refuse the save.
    if (c.kind === 'state') {
      out.push({ device_key: c.deviceKey.trim(), state: c.state });
      continue;
    }
    if (!c.metric.trim()) {
      return {
        ok: false,
        error: "Every reading condition needs a metric — switch the row to 'is on / is off' if you meant a state.",
      };
    }
    const value = Number(c.value);
    if (!Number.isFinite(value)) {
      return { ok: false, error: 'Every reading condition needs a numeric value.' };
    }
    out.push({ device_key: c.deviceKey.trim(), metric: c.metric.trim(), op: c.op, value });
  }
  return { ok: true, conditions: out };
}
