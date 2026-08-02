// How the console presents the automations and energy surfaces — and, as with
// engineState.ts, how it presents their ABSENCE.
//
// This is the same job engineState.ts does for the device fleet, extended to
// the two runtimes that only recently became reachable over HTTP. It lives
// beside it, and next to DemoMarks.tsx, because all three are honesty logic:
// the kind of thing that quietly rots into a lie once it is spread across
// several screens.
//
// # The distinction every screen here has to keep
//
// A hub with no rule engine and a hub whose rule list failed to load are
// different sentences, and neither is "there are no rules". The API was built
// to make that easy — an unconfigured runtime answers 503 with a NAMED code
// (`automations_not_configured`, `energy_not_configured`) rather than 404 or an
// empty list, precisely so a console can say which happened. Throwing that
// distinction away here would waste the only part of the design that makes the
// difference visible.
//
// # The one that is easy to miss
//
// `scheduler_running: false` is NOT an absent engine. Rules can be written with
// the scheduler off — useful when setting a hub up — and they are stored,
// listed and editable, and will not fire. A list of rules that silently never
// runs looks exactly like a list that works. Nothing else in the console can
// tell a reader that; the flag has to be rendered.
//
// Pure and dependency-light (no React) so all of it can be unit-tested.

import {
  api,
  ApiError,
  isUnavailable,
  friendlyApiError,
  type AutomationRule,
  type AutomationsListResponse,
  type EnergyBucket,
  type EnergyMixResponse,
  type EnergySeriesResponse,
} from '@/lib/api';

// ── the shape every runtime fetch narrows to ────────────────────────────────

/**
 * Why `absent` and `forbidden` are separate from `error`.
 *
 * `absent` — the hub answered, and the answer was "no such runtime here". The
 * DEFAULT for a hub with no rule engine or no meter. Not a failure.
 *
 * `forbidden` — the runtime exists and this person may not see it. Automations
 * reads are admin-only, so an ordinary member hits this on a perfectly healthy
 * hub. Rendering it as an error would tell a member their hub is broken.
 *
 * `unsupported` — the hub predates the route, so the SPA fallback answered with
 * HTML instead of JSON. An upgrade, not a configuration change.
 *
 * `error` — a genuine failure. The one case where "we do not know" is honest.
 */
export type RuntimeStatus = 'live' | 'absent' | 'forbidden' | 'unsupported' | 'error';

export type AutomationsState =
  | { status: 'live'; rules: AutomationRule[]; schedulerRunning: boolean; maxActionTier: string }
  | { status: Exclude<RuntimeStatus, 'live'>; rules: []; message?: string };

export type EnergyState =
  | { status: 'live'; series: EnergySeriesResponse; mix: EnergyMixResponse | null }
  | { status: Exclude<RuntimeStatus, 'live'>; series: null; mix: null; message?: string };

/**
 * Classify a thrown ApiError into the non-live statuses.
 *
 * `notConfiguredCode` is passed in rather than matched loosely, so an energy
 * screen cannot accidentally treat `automations_not_configured` as its own
 * absence — the two runtimes are independently configurable and a hub can
 * genuinely have one without the other.
 */
export function classifyRuntimeError(
  err: unknown,
  notConfiguredCode: string,
): { status: Exclude<RuntimeStatus, 'live'>; message?: string } {
  if (isUnavailable(err)) return { status: 'unsupported' };
  if (err instanceof ApiError) {
    if (err.status === 503 && err.code === notConfiguredCode) return { status: 'absent' };
    if (err.status === 403) return { status: 'forbidden' };
  }
  return { status: 'error', message: friendlyApiError(err, 'The hub could not be reached.') };
}

// ── automations ─────────────────────────────────────────────────────────────

/**
 * Fetch the rule list, narrowing every outcome. Never throws: an absent engine,
 * a forbidden read and a broken one all have to be RENDERED, and a screen that
 * has to try/catch to tell them apart usually ends up rendering neither.
 */
export async function automationsState(accountId: string): Promise<AutomationsState> {
  try {
    const res: AutomationsListResponse = await api.automations(accountId);
    if (!res || !Array.isArray(res.rules)) {
      return { status: 'error', rules: [], message: 'The hub sent an answer this console could not read.' };
    }
    return {
      status: 'live',
      rules: res.rules,
      schedulerRunning: res.scheduler_running === true,
      // Taken from the hub, never hard-coded here. The ceiling is a
      // compile-time constant in the engine; a copy in the console is a copy
      // that can disagree with the thing actually enforcing it.
      maxActionTier: res.max_action_tier ?? '',
    };
  } catch (err) {
    return { ...classifyRuntimeError(err, 'automations_not_configured'), rules: [] };
  }
}

/**
 * One sentence a screen can print verbatim for a non-live rule engine, and null
 * when it is live and the rows speak for themselves.
 *
 * Every one of these says what IS true. None is an empty list left to be
 * mistaken for a broken fetch.
 */
export function automationsNotice(state: AutomationsState): string | null {
  switch (state.status) {
    case 'absent':
      return 'No rule engine is running on this hub, so there are no automations to show. That is the default for a hub with no device driver configured — not an error, and not a failed load.';
    case 'forbidden':
      return 'Automation rules are visible to account admins only. A rule states what this hub does unattended, which is closer to the audit trail than to a device reading.';
    case 'unsupported':
      return "This hub doesn't serve the automations API yet — it's running a build from before those routes existed. Upgrade the hub to manage rules here.";
    case 'error':
      return `The rule engine could not be read: ${state.message} This is a failed request, not an empty rule list.`;
    case 'live':
      return state.rules.length === 0
        ? 'The rule engine is running and no rules have been created yet.'
        : null;
  }
}

/**
 * The warning that has no other home.
 *
 * Returns copy when rules exist but nothing will fire them, and null otherwise.
 * Separate from automationsNotice because it applies to a LIVE engine: the
 * fetch worked, the rules are real and editable, and they still do nothing.
 */
export function schedulerWarning(state: AutomationsState): string | null {
  if (state.status !== 'live' || state.schedulerRunning || state.rules.length === 0) return null;
  const enabled = state.rules.filter((r) => r.enabled).length;
  return `The rule scheduler is not running on this hub, so ${
    enabled === 1 ? 'the enabled rule' : `${enabled} enabled rules`
  } will not fire. Rules can be written with the scheduler off — they are saved and will run once it is started.`;
}

/**
 * Rules the failure breaker turned off, which is different from rules a person
 * turned off. A breaker-tripped rule always carries a reason; surfacing it is
 * the difference between a rule an admin can fix and one that just went quiet.
 */
export function trippedRules(state: AutomationsState): AutomationRule[] {
  if (state.status !== 'live') return [];
  return state.rules.filter((r) => (r.disabled_at ?? 0) > 0);
}

// ── energy ──────────────────────────────────────────────────────────────────

export async function energyState(
  accountId: string,
  q: { grain?: string; from?: number; to?: number } = {},
): Promise<EnergyState> {
  try {
    const series = await api.energySeries(accountId, q);
    if (!series || !Array.isArray(series.buckets)) {
      return { status: 'error', series: null, mix: null, message: 'The hub sent an answer this console could not read.' };
    }
    // The mix is a SEPARATE request and is allowed to fail on its own. A
    // working series with no source breakdown is a partial answer worth
    // showing; discarding it because the second call failed would be worse.
    let mix: EnergyMixResponse | null = null;
    try {
      mix = await api.energyMix(accountId, { from: q.from, to: q.to });
    } catch {
      mix = null;
    }
    return { status: 'live', series, mix };
  } catch (err) {
    return { ...classifyRuntimeError(err, 'energy_not_configured'), series: null, mix: null };
  }
}

export function energyNotice(state: EnergyState): string | null {
  switch (state.status) {
    case 'absent':
      return 'No energy metering is configured on this hub, so there is no consumption history to show. That is the default — not an error, and not a failed load.';
    case 'forbidden':
      return 'This account does not permit reading its energy history.';
    case 'unsupported':
      return "This hub doesn't serve the energy API yet — it's running a build from before those routes existed. Upgrade the hub to see live consumption here.";
    case 'error':
      return `Energy history could not be read: ${state.message} This is a failed request, not an empty meter.`;
    case 'live':
      return state.series.buckets.length === 0
        ? 'Energy metering is configured but has recorded nothing in this window yet.'
        : null;
  }
}

// ── the honesty helpers ─────────────────────────────────────────────────────

/**
 * How much of a window was actually observed, 0..1, or null when the engine did
 * not say.
 *
 * Coverage is the number a reader needs and the one no chart shows: a bucket
 * can carry a confident-looking kWh figure while half the hour went unmeasured.
 */
export function coverageRatio(b: {
  coverage_seconds: number;
  expected_seconds: number;
}): number | null {
  if (!b.expected_seconds || b.expected_seconds <= 0) return null;
  return Math.max(0, Math.min(1, b.coverage_seconds / b.expected_seconds));
}

/**
 * A short, plain label for a bucket's trustworthiness, or null when it is
 * fully measured and there is nothing to warn about.
 *
 * `quality` is the single field the engine says a renderer may branch on, so
 * this branches on that and nothing else — deriving trustworthiness from the
 * numbers here would be a second opinion that can disagree with the engine's.
 */
export function bucketCaveat(b: EnergyBucket): string | null {
  switch (b.quality) {
    case 'complete':
      return null;
    case 'partial': {
      const c = coverageRatio(b);
      return c === null
        ? 'part of this period was not measured'
        : `only ${Math.round(c * 100)}% of this period was measured`;
    }
    case 'estimated':
      return 'interpolated across a gap — not a measured reading';
    case 'empty':
      return 'nothing was measured in this period';
    default:
      // An unfamiliar quality label means a hub newer than this console. Say
      // so rather than rendering it as trustworthy, which is the one wrong
      // direction to guess in.
      return `unrecognised quality (“${b.quality}”) — treat with caution`;
  }
}

/**
 * Whether a source-mix breakdown may be drawn as a proportional chart.
 *
 * `complete: false` means some channel did not cover the window, so the slices
 * do not add up to the truth. `attributed: false` means there is not enough
 * source information to say where the energy came from. A pie chart drawn
 * without checking both is confidently wrong, so this exists to make the check
 * hard to skip.
 */
export function mixIsProportional(mix: EnergyMixResponse | null): boolean {
  return mix !== null && mix.complete === true && mix.attributed === true;
}

/** Why a mix may not be drawn proportionally, or null when it may. */
export function mixCaveat(mix: EnergyMixResponse | null): string | null {
  if (mix === null) return 'The source breakdown could not be read.';
  if (!mix.attributed) {
    return 'Not enough source information to say where this energy came from — the channels on this hub are not attributed to grid, solar or battery.';
  }
  if (!mix.complete) {
    const c = coverageRatio(mix);
    return c === null
      ? 'Some meters did not cover this whole period, so these totals are a floor rather than the full picture.'
      : `Meters covered ${Math.round(c * 100)}% of this period, so these totals are a floor rather than the full picture.`;
  }
  return null;
}

/**
 * Sum a series into one kWh figure, and say how much of it was guessed.
 *
 * `measuredKwh` is the floor — what the meters actually recorded. Returning it
 * alongside the total is the whole point: a single number that silently
 * includes interpolation is exactly what internal/energy refuses to produce,
 * and reproducing that here would undo it at the last step.
 *
 * `null` buckets are skipped, not counted as zero.
 */
export function seriesTotals(buckets: EnergyBucket[]): {
  totalKwh: number;
  measuredKwh: number;
  estimatedKwh: number;
  measuredBuckets: number;
  unmeasuredBuckets: number;
} {
  let totalKwh = 0;
  let estimatedKwh = 0;
  let measuredBuckets = 0;
  let unmeasuredBuckets = 0;
  for (const b of buckets) {
    if (b.kwh === null || b.kwh === undefined) {
      unmeasuredBuckets++;
      continue;
    }
    measuredBuckets++;
    totalKwh += b.kwh;
    estimatedKwh += b.estimated_kwh ?? 0;
  }
  return {
    totalKwh,
    measuredKwh: Math.max(0, totalKwh - estimatedKwh),
    estimatedKwh,
    measuredBuckets,
    unmeasuredBuckets,
  };
}

/**
 * What to say under a list the hub capped, or null when it did not cap.
 *
 * The hub fetches one row more than it will return so it can tell the
 * difference, and reports it. Saying nothing turns "the busiest twenty" into
 * "all of them" for anyone reading the screen, which is the reading a table
 * that simply ends invites.
 *
 * docs/CHAT-COMMANDS.md states the rule for the chat rails: "Aggregate, cap and
 * say so." It applies to a table as much as to a sentence.
 */
export function capNote(shown: number, truncated: boolean): string | null {
  if (!truncated) return null;
  return `Showing the busiest ${shown} — there are more.`;
}
