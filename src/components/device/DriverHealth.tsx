import { useEffect, useState } from 'react';
import { api, friendlyApiError, isUnavailable, type EngineHealthResponse } from '@/lib/api';

/**
 * Per-DRIVER health for the device engine.
 *
 * The Devices screen already renders per-device state from engineDevices(), and
 * that is the wrong granularity for one specific failure: a driver that is down
 * as a whole. An unreachable MQTT broker does not present as "the MQTT driver
 * is down since 14:02" — it presents as a set of devices whose readings quietly
 * stop being fresh, which is indistinguishable from a quiet house until someone
 * goes looking.
 *
 * The hub has served GET /v1/engine/health all along and nothing rendered it.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It does not summarise `detail` into a friendlier phrase. That string is
 *     the driver's own account of what is wrong ("dial tcp 10.0.0.4:1883:
 *     connect: connection refused"), and it is the only part of this panel
 *     that tells an operator what to actually fix.
 *   - It does not render an empty driver map as healthy. No drivers configured
 *     and every driver fine are different states, and the difference is the
 *     whole question when a screen shows nothing.
 */
export function DriverHealth() {
  const [health, setHealth] = useState<EngineHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .engineHealth()
      .then((h) => live && setHealth(h))
      .catch((err) => {
        if (!live) return;
        if (isUnavailable(err)) {
          setUnsupported(true);
          return;
        }
        setError(friendlyApiError(err, 'Could not read driver health.'));
      });
    return () => {
      live = false;
    };
  }, []);

  // An older hub that does not serve this, or a hub with no engine at all —
  // neither is a failure worth an alarm, and neither is "everything is fine".
  if (unsupported) return null;
  if (health && !health.engine) return null;

  const drivers = Object.entries(health?.drivers ?? {});
  const failing = drivers.filter(([, d]) => !d.ok);

  if (error) {
    return (
      <p className="text-sm text-terracotta-deep" role="alert">
        {error}
      </p>
    );
  }
  if (!health) return null;

  return (
    <div className="rounded-2xl border border-ink/10 bg-paper-cool/60 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] uppercase tracking-[0.18em] text-ink/50">Drivers</span>
        {drivers.length === 0 ? (
          // Not "healthy" — there is nothing to be healthy.
          <span className="text-sm text-ink/65">None configured on this hub.</span>
        ) : (
          <span className="text-sm text-ink/70">
            {drivers.length - failing.length} of {drivers.length} reporting healthy
          </span>
        )}
      </div>

      {failing.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {failing.map(([id, d]) => (
            <li key={id} className="text-sm">
              <span className="font-mono text-ink">{id}</span>{' '}
              <span className="text-terracotta-deep">down</span>
              <span className="text-ink/50"> since {new Date(d.since * 1000).toLocaleString()}</span>
              {/* The driver's own words. Paraphrasing this is how an operator
                  loses the one line that says what to fix. */}
              {d.detail && (
                <div className="mt-0.5 font-mono text-xs text-ink/60 break-all">{d.detail}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
