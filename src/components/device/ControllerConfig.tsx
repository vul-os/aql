import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ApiError, api, type ConfigReportResponse, type ReportedConfigEntry } from '@/lib/api';
import { describeDelivery } from '@/components/access/delivery';

/**
 * Retune a paired controller without visiting it.
 *
 * # Why the numbers here are dangerous
 *
 * `pulse_ms` is how long the relay fires on an open. The relay bounds that
 * duration and REFUSES a pulse outside its range rather than clamping it — so
 * a value that is too large does not open the gate for longer, it makes every
 * subsequent open fail at the hardware call. Nothing in that failure points
 * back at this form.
 *
 * The hub enforces the real bounds (it is the only place that can — the
 * controller stores whatever it is sent). This screen states them rather than
 * silently accepting a number the hub will reject, and when the hub does
 * reject one it shows the hub's own explanation instead of "invalid".
 *
 * # Queued is not applied
 *
 * A controller that is offline gets the command when it reconnects. That is
 * reported as it is, because "saved" would be a claim about a device this
 * console has not spoken to.
 */

type Field = {
  key: string;
  label: string;
  unit: string;
  help: string;
};

// Mirrors the hub's closed set (httpapi/deviceconfig.go's configBounds). The
// hub decides; this is only so the form does not offer a key that would be
// refused, and so each field can say what it does.
const FIELDS: Field[] = [
  {
    key: 'pulse_ms',
    label: 'Open pulse',
    unit: 'ms',
    help: 'How long the relay fires on an open. Too large and the relay refuses the pulse outright, which stops the gate opening at all.',
  },
  {
    key: 'hold_max',
    label: 'Maximum hold',
    unit: 's',
    help: 'The longest a hold may last before the controller releases it anyway. This is a safety limit, not a preference — it is what stops a barrier being left up overnight.',
  },
];

// `sensor_debounce_ms` was here, and was removed rather than captioned.
//
// The controller accepts it, stores it, and never reads it — the debounce that
// applies is part of the relay wiring (`-relay …,sensor-debounce=20ms`), set
// where the controller runs. So the form took a number, the hub signed a
// command, the controller acked it, and the gate behaved exactly as before. A
// warning beside a working input would not have helped: the affordance itself
// is the claim. The hub no longer accepts the key either, and says where the
// setting really lives if something sends it anyway.

export function ControllerConfig({ deviceId }: { deviceId: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ConfigReportResponse | null>(null);
  // Distinct from `report === null`: a hub too old to serve this route is not
  // the same as a controller that has not reported, and neither is an error
  // worth alarming about on a screen whose job is sending changes.
  const [reportUnavailable, setReportUnavailable] = useState(false);

  const loadReport = useCallback(
    (live: () => boolean) =>
      api
        .deviceConfigReport(deviceId)
        .then((r) => live() && setReport(r))
        .catch(() => live() && setReportUnavailable(true)),
    [deviceId],
  );

  useEffect(() => {
    let alive = true;
    void loadReport(() => alive);
    return () => {
      alive = false;
    };
  }, [loadReport]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'queued' | 'error'; message: string } | null>(
    null,
  );

  const changed = Object.entries(values).filter(([, v]) => v.trim() !== '');

  async function submit() {
    setBusy(true);
    setResult(null);
    const config: Record<string, number> = {};
    for (const [k, v] of changed) {
      const n = Number(v);
      if (!Number.isInteger(n)) {
        setResult({ kind: 'error', message: `${k} must be a whole number.` });
        setBusy(false);
        return;
      }
      config[k] = n;
    }
    try {
      const r = await api.deviceConfig(deviceId, config);
      // Every non-acked outcome, not just `queued`. This branch previously read
      // `queued ? … : acknowledged`, so `undelivered` and `no_device` both
      // claimed the controller had acknowledged a change it never saw — the
      // same bug the gate buttons had, in the same shape.
      const outcome = describeDelivery(r.delivery, 'applied');
      setResult(
        outcome.confirmed
          ? { kind: 'ok', message: 'Sent, and the controller acknowledged it.' }
          : { kind: 'queued', message: outcome.message },
      );
      // Only cleared on a confirmed apply. Wiping the fields after a queued or
      // unconfirmed send would leave an operator with no record of what they
      // asked for and no way to retype it.
      if (outcome.confirmed) {
        setValues({});
        // The controller sends a fresh ctl.report when its RESOLVED config
        // changes, so re-reading is how "did my change land" gets answered by
        // the device rather than by this form assuming its own success. A
        // report that has not arrived yet leaves the old values on screen,
        // which is true — they are what was last reported.
        void loadReport(() => true);
      }
    } catch (err) {
      // The hub's refusals carry the bound and the reason. Showing our own
      // wording instead would drop the one number the operator needs.
      const e = err instanceof ApiError ? err : null;
      const body = (e?.detail ?? null) as unknown;
      const msg =
        e && typeof body === 'string'
          ? body
          : e?.code === 'config_out_of_range' || e?.code === 'unknown_config_key'
            ? `${e.code.replace(/_/g, ' ')} — the hub refused this value. Check the range above.`
            : err instanceof Error
              ? err.message
              : 'Could not send that configuration.';
      setResult({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-ink/10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink/55 font-mono">
        Controller timings
      </p>
      <p className="mt-2 text-sm text-ink/70">
        Changes are signed by this hub and applied by the controller. Leave a field blank to
        leave it as it is — the controller merges rather than replaces.
      </p>
      {/* The boxes are still changes-to-send and start empty. What is in
          effect is stated per field below, from the controller's own signed
          `ctl.report` — never inferred, because a hub that fills in the
          firmware defaults is showing numbers nobody confirmed. */}
      {!reportUnavailable && report && !report.reported && (
        <p className="mt-2 text-xs text-ink/55">
          This controller has not reported its configuration. That is expected of firmware
          predating the report message — it does not mean the values below are unset. It is
          running something; this hub has not been told what.
        </p>
      )}
      {reportUnavailable && (
        <p className="mt-2 text-xs text-ink/55">
          Could not read what this controller is running. The boxes below still send changes.
        </p>
      )}
      <div className="mt-4 space-y-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-sm font-medium text-ink/85">
              {f.label} <span className="text-ink/50 font-normal">({f.unit})</span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder="unchanged"
              className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
            />
            <p className="text-[11px] text-ink/50 mt-1">{f.help}</p>
            <InEffect entry={report?.reported ? report.config?.[f.key] : undefined} field={f} />
          </label>
        ))}
      </div>
      {result && (
        <p
          className={`mt-3 text-sm ${
            result.kind === 'error' ? 'text-terracotta-deep' : 'text-ink/75'
          }`}
        >
          {result.message}
        </p>
      )}
      <UnknownReported report={report} />
      <RevocationState report={report} />
      <p className="mt-4 text-[11px] text-ink/45">
        Sensor debounce is not set from here. It belongs to the relay wiring and is configured
        where the controller runs.
      </p>
      <div className="mt-4">
        <Button variant="ink" disabled={busy || changed.length === 0} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Send to controller'}
        </Button>
      </div>
    </div>
  );
}

/**
 * What one field is actually set to on the device.
 *
 * Three distinct states, kept distinct because collapsing any two of them is the
 * failure this whole message exists to stop:
 *
 *   - reported, from a config command  → "now 900 ms"
 *   - reported, from the firmware      → "now 700 ms (firmware default)"
 *   - no report at all                 → say nothing here; the panel says why
 *
 * The second is the one worth the words. 700 and "700, because nobody set it"
 * answer different questions, and an operator debugging a gate needs the second.
 */
function InEffect({ entry, field }: { entry?: ReportedConfigEntry; field: Field }) {
  if (!entry) return null;
  return (
    <p className="text-[11px] text-ink/65 mt-1">
      Now {entry.value} {field.unit}
      {entry.source === 'default' && (
        <span className="text-ink/45"> (firmware default — never configured)</span>
      )}
    </p>
  );
}

/**
 * Keys the controller reports that this console has no field for.
 *
 * The hub stores the report verbatim precisely so a controller that learns a
 * tunable is not silenced by an older console. Dropping them here would undo
 * that at the last step, and the operator would have no way to see a setting
 * that is genuinely in effect on their gate.
 */
function UnknownReported({ report }: { report: ConfigReportResponse | null }) {
  const known = new Set(FIELDS.map((f) => f.key));
  const extra = Object.entries(report?.config ?? {}).filter(([k]) => !known.has(k));
  if (!report?.reported || extra.length === 0) return null;
  return (
    <div className="mt-4 pt-3 border-t border-ink/10">
      <p className="text-[11px] text-ink/55">
        This controller also reports settings this console does not know how to edit
        {report.firmware ? ` (firmware ${report.firmware})` : ''}:
      </p>
      <ul className="mt-1 space-y-0.5">
        {extra.map(([k, v]) => (
          <li key={k} className="text-[11px] text-ink/65">
            {k}: {v.value}
            {v.source === 'default' && <span className="text-ink/45"> (firmware default)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Which revocations this gate is actually enforcing.
 *
 * docs/GRANT-REVOCATION.md §5. The revoke button reports which controllers a
 * deny-list was DISPATCHED to, which is not the same claim: a command queued
 * for a gate that never reconnects looks identical to one delivered. This is
 * the gate answering for itself.
 *
 * Three states, deliberately worded as three different things. "This gate
 * cannot tell us" and "this gate confirms it holds nothing" are opposite
 * answers for someone deciding whether to go and latch lockdown, and rendering
 * them the same way is the failure this whole report exists to prevent.
 */
function RevocationState({ report }: { report: ConfigReportResponse | null }) {
  const rev = report?.revocation;
  if (!rev) return null;

  if (!rev.reported) {
    return (
      <p className="mt-3 text-sm text-ink/60" data-shot="revocation-state">
        <span className="font-medium text-ink/75">Revocations: not reported.</span>{' '}
        {rev.detail ??
          'This controller has not said which revocations it is enforcing, so nothing here can confirm one reached it.'}
      </p>
    );
  }

  if (rev.up_to_date) {
    return (
      <p className="mt-3 text-sm text-ink/70" data-shot="revocation-state">
        <span className="font-medium text-ink">Revocations: up to date.</span>{' '}
        {rev.entries === 0
          ? 'This gate is enforcing no revoked grants, and that is current.'
          : `This gate is enforcing ${rev.entries} revoked grant${rev.entries === 1 ? '' : 's'}.`}
      </p>
    );
  }

  // Behind. The number is not the point — that this gate would still open for a
  // grant somebody revoked is the point, so it is said in those words.
  return (
    <p className="mt-3 text-sm text-terracotta-deep" data-shot="revocation-state">
      <span className="font-medium">Revocations: behind.</span> This gate is enforcing list{' '}
      {rev.seq} and the hub is at {rev.hub_seq}, so a grant revoked since then will still open
      it. It catches up when it next reaches the hub; latch lockdown if that is not soon
      enough.
    </p>
  );
}
