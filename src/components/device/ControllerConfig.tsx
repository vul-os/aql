import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ApiError, api } from '@/lib/api';

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
  {
    key: 'sensor_debounce_ms',
    label: 'Sensor debounce',
    unit: 'ms',
    help: 'How long a position or tamper input must settle before it is believed.',
  },
];

export function ControllerConfig({ deviceId }: { deviceId: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
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
      setResult(
        r.delivery === 'queued'
          ? {
              kind: 'queued',
              message:
                'Queued. This controller is not connected right now — it will apply these when it next reconnects, and not before.',
            }
          : { kind: 'ok', message: 'Sent, and the controller acknowledged it.' },
      );
      setValues({});
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
      {/* Said plainly rather than implied by empty inputs. A controller never
          reports its configuration back: the ack carries a result and a detail
          and nothing else, so the hub genuinely does not know what these are
          set to. Blank boxes on their own would read as "unset" or "zero" to a
          reasonable person, which is a different and wrong thing. */}
      <p className="mt-2 text-xs text-ink/55">
        This console cannot show the current values. A controller does not report its
        configuration back to the hub, so these boxes start empty whatever the device is
        set to — they are changes to send, not a reflection of what it holds now.
      </p>
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
      <div className="mt-4">
        <Button variant="ink" disabled={busy || changed.length === 0} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Send to controller'}
        </Button>
      </div>
    </div>
  );
}
