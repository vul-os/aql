import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { ApiError, api } from '@/lib/api';

/**
 * Which controllers are drifting toward refusing every offline grant.
 *
 * # The failure this makes visible
 *
 * A controller refuses EVERY offline emergency grant once its own clock is more
 * than fourteen days stale — checked before lockdown and before the grant is
 * even examined. That refusal lands at the gate, during exactly the outage
 * those grants exist for, and until now nothing on the hub could see it coming.
 *
 * The hub keeps controllers fresh with a six-hourly ping, so in normal
 * operation this panel has nothing to say. It appears when something has gone
 * wrong quietly: a controller that has been unreachable for a week, or one that
 * has never acked a ping since it was paired.
 *
 * # Why it renders nothing when everything is fine
 *
 * A panel that is always present teaches an operator to ignore it. The two
 * nudge banners this console used to carry were deleted for exactly that, and
 * their epitaph is still in AppLayout. This one appears only when a controller
 * is actually at risk.
 *
 * # What the numbers mean, precisely
 *
 * `proved: false` is NOT "very old" — it means no ping has ever been
 * acknowledged by that controller, so the hub has no evidence its clock has
 * moved since pairing. That is a different sentence and gets different words.
 *
 * `stale_after_s` comes from the hub rather than being written here, because
 * the real limit is a constant in the controller module and a copy in this file
 * would be one more thing to drift.
 */

type Row = {
  device_id: string;
  label: string;
  synced_at: number | null;
  proved: boolean;
  age_s?: number;
};

function humanAge(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  if (d >= 2) return `${d} days`;
  const h = Math.floor(seconds / 3600);
  if (h >= 2) return `${h} hours`;
  return 'under an hour';
}

export function ClockFreshness({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [staleAfter, setStaleAfter] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api.controllerClockFreshness(accountId);
      setRows(r.controllers);
      setStaleAfter(r.stale_after_s);
    } catch (err) {
      // A non-admin gets 404 (the tenancy contract) and an older hub 404s too.
      // Neither is a fault worth a red box on a screen about something else —
      // this panel simply has nothing it can say.
      if (err instanceof ApiError) {
        setRows([]);
        return;
      }
      setRows([]);
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!rows || staleAfter <= 0) return null;

  // Warn well before the cliff: a controller two-thirds of the way there has
  // days left, and telling somebody at the moment their grants stop working is
  // not a warning, it is a report.
  const warnAfter = Math.floor(staleAfter * (2 / 3));
  const atRisk = rows.filter((r) => !r.proved || (r.age_s ?? 0) >= warnAfter);
  if (atRisk.length === 0) return null;

  return (
    <Card className="mb-6 border-gold/50 bg-gold/[0.05]">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink/55 font-mono">
        Offline access at risk
      </p>
      <p className="mt-2 text-[15px] text-ink/80 leading-relaxed">
        A controller refuses every offline emergency grant once its clock is more than{' '}
        {humanAge(staleAfter)} out of sync with this hub. These have not been confirmed
        recently enough, so grants held for them may already be failing at the gate:
      </p>
      <ul className="mt-4 divide-y divide-ink/10">
        {atRisk.map((r) => (
          <li key={r.device_id} className="py-3">
            <p className="font-medium">{r.label || r.device_id}</p>
            <p className="text-sm text-ink/70 mt-0.5">
              {!r.proved
                ? // Distinct from "very old": the hub has no evidence at all.
                  'Never confirmed — this controller has not acknowledged a clock sync since it was paired.'
                : `Last confirmed ${humanAge(r.age_s ?? 0)} ago.`}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink/55">
        The hub confirms clocks every few hours over the controller&rsquo;s own connection, so
        this usually means the controller has been unreachable. Bringing it back online
        resolves it — no visit needed unless it has already passed the limit.
      </p>
    </Card>
  );
}
