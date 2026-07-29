import { useEffect, useState } from 'react';
import { api, friendlyApiError, isUnavailable, type EnergyChannel } from '@/lib/api';
import { Card } from '@/components/ui/Card';

/**
 * The meter channels the numbers above are derived from.
 *
 * The Energy screen renders series, totals and a source mix, and every one of
 * those rests on per-channel configuration that had no surface at all. That
 * matters most for the mix: `source` and `flow` are ASSIGNMENTS someone made,
 * not measurements. A solar meter tagged as grid produces a mix chart that is
 * confidently, invisibly wrong, and until now there was nowhere to look.
 *
 * The other two worth showing:
 *
 *   - `enabled`. A disabled channel contributes nothing, silently. Its absence
 *     from the chart looks exactly like a meter that read zero.
 *   - `interval_seconds` and `gap_tolerance_seconds`. These are what decide
 *     whether an hour is marked complete, partial or interpolated — the
 *     quality flags the screen already shows without ever saying where they
 *     come from.
 *
 * Read-only, deliberately. Editing a channel's source or scale rewrites what
 * historical buckets mean, and that is a decision with a paper trail, not a
 * dropdown on a dashboard.
 */
export function ChannelConfig({ accountId }: { accountId: string }) {
  const [channels, setChannels] = useState<EnergyChannel[] | null>(null);
  const [tz, setTz] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .energyChannels(accountId)
      .then((r) => {
        if (!live) return;
        setChannels(r.channels);
        setTz(r.tz);
      })
      .catch((err) => {
        if (!live) return;
        if (isUnavailable(err)) {
          setUnsupported(true);
          return;
        }
        setError(friendlyApiError(err, 'Could not load meter channels.'));
      });
    return () => {
      live = false;
    };
  }, [accountId]);

  if (unsupported) {
    // Said, not vanished. The rest of this console answers an unsupported hub
    // in words (engineNotice's `unsupported` state: "it's running a build from
    // before /v1/engine existed"), and a panel that silently disappears leaves
    // an operator looking for a screen the docs describe with no idea why it
    // is not there.
    //
    // The energy figures above are unaffected and stay honest on their own:
    // mixIsProportional/mixCaveat in Energy.tsx carry the source-attribution
    // caveat independently of this panel.
    return (
      <Card className="mt-6">
        <h2 className="font-display text-2xl">Meter channels</h2>
        <p className="text-sm text-ink/65 mt-1">
          This hub doesn&rsquo;t serve the meter-channel API — it&rsquo;s running a build from
          before it existed. Upgrade the hub to see and assign what the figures above are built
          from. The figures themselves are unaffected.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <h2 className="font-display text-2xl">Meter channels</h2>
      <p className="text-sm text-ink/65 mt-1">
        What the figures above are built from. <strong>Source and flow are assignments</strong>,
        not measurements — a meter tagged as the wrong source makes the mix wrong in a way no
        chart can show.
        {tz && <span className="text-ink/45"> Buckets are cut in {tz}.</span>}
      </p>

      {error && (
        <p className="mt-4 text-sm text-terracotta-deep" role="alert">
          {error}
        </p>
      )}

      {!channels && !error && <p className="mt-6 text-sm text-ink/55">Loading…</p>}

      {channels && channels.length === 0 && (
        <p className="mt-6 text-sm text-ink/65">
          No meter channels configured. Nothing above is being measured — that is different
          from a house that used nothing.
        </p>
      )}

      {channels && channels.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink/50">
                <th className="py-2 pr-4 font-normal">Meter</th>
                <th className="py-2 pr-4 font-normal">Counts as</th>
                <th className="py-2 pr-4 font-normal">Expected every</th>
                <th className="py-2 font-normal">State</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {channels.map((c) => (
                <tr key={`${c.device_key}:${c.metric}`} className="border-t border-ink/10">
                  <td className="py-3 pr-4">
                    <div className="text-ink">{c.label || c.device_key}</div>
                    <div className="font-mono text-xs text-ink/45">
                      {c.device_key} · {c.metric}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-ink/80">
                    {c.source} · {c.flow}
                    <div className="text-xs text-ink/50 mt-0.5">{c.kind}</div>
                  </td>
                  <td className="py-3 pr-4 text-ink/80">
                    {c.interval_seconds}s
                    {/* The pair that decides whether an hour reads complete,
                        partial or interpolated. The chart shows the verdict;
                        this is the rule behind it. */}
                    <div className="text-xs text-ink/50 mt-0.5">
                      gap tolerated to {c.gap_tolerance_seconds}s
                    </div>
                  </td>
                  <td className="py-3">
                    {c.enabled ? (
                      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] bg-moss/15 text-moss">
                        Enabled
                      </span>
                    ) : (
                      <>
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] bg-gold/20 text-ink/80">
                          Disabled
                        </span>
                        {/* Otherwise its absence from the chart is
                            indistinguishable from a meter reading zero. */}
                        <div className="text-xs text-ink/60 mt-1">
                          contributes nothing above
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
