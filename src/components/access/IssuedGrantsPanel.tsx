// What the HUB thinks you hold, and the button that takes it back.
//
// docs/GRANT-REVOCATION.md. Two different facts live on this screen and the
// distinction is the reason this panel is separate from the vault card above
// it: the vault holds the signed bytes ON THIS DEVICE, and this lists what the
// hub still considers live. A grant revoked from a different device reads as
// revoked here and is completely unchanged in the vault — the bytes are still
// valid-looking, and the CONTROLLER is what refuses them.
//
// The common reason to use it is a lost phone, which is why the holder can
// revoke their own grant without finding an admin first.

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ApiError, api, type OfflineGrantRow } from '@/lib/api';
import { fromUnix } from '@/lib/time';

function when(ts?: number): string {
  const d = ts ? fromUnix(ts) : null;
  return d ? d.toLocaleString() : 'an unknown time';
}

export function IssuedGrantsPanel() {
  const [rows, setRows] = useState<OfflineGrantRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (alive: () => boolean) => {
    try {
      const r = await api.offlineGrantsList();
      if (alive()) setRows(r.grants);
    } catch {
      // A hub too old to serve this has no record of issued grants, which is
      // the same as having none. Render nothing rather than an error: the
      // vault card above still works and is the part that matters.
      if (alive()) setRows([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void load(() => alive);
    return () => {
      alive = false;
    };
  }, [load]);

  async function revoke(grantId: string) {
    setBusy(grantId);
    setError(null);
    setNotice(null);
    try {
      const res = await api.offlineGrantRevoke(grantId);
      // Name the controllers, never just a count. A gate that did NOT get the
      // deny-list still opens for this grant until it reconnects, and that is
      // the gate someone may need to go and latch.
      // Three outcomes, said as three different things. "Sent to nothing" and
      // "the hub could not build the command" both leave the gate open and are
      // not the same problem: one is a network to check, the other is a hub
      // fault no amount of waiting fixes.
      const failed = res.failed ?? [];
      const parts: string[] = [];
      if (res.dispatched.length > 0) {
        parts.push(
          `Revoked, and sent to ${res.dispatched.length} controller` +
            `${res.dispatched.length === 1 ? '' : 's'}: ${res.dispatched.join(', ')}.` +
            ' A gate that was offline gets it when it reconnects.',
        );
      } else if (failed.length === 0) {
        parts.push(
          'Revoked, but this grant names no controller, so there is nothing to tell.',
        );
      }
      if (failed.length > 0) {
        parts.push(
          `The hub could not build a revocation for ${failed.join(', ')}. That is not a gate` +
            ' being offline — it will not fix itself, and those gates keep accepting this' +
            ' grant. Latch lockdown on them if it matters now.',
        );
      }
      setNotice(parts.join(' '));
      await load(() => true);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setError(
        e?.code === 'grant_not_revocable'
          ? 'That grant was already revoked.'
          : e?.code === 'grant_not_found'
            ? 'That grant no longer exists, or is not yours to revoke.'
            : err instanceof Error
              ? err.message
              : 'Could not revoke that grant.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (!rows || rows.length === 0) return null;

  return (
    <Card className="mt-6">
      <h2 className="font-display text-2xl text-ink">Grants this hub has issued you</h2>
      <p className="mt-2 text-sm text-ink/70">
        Revoking one tells every gate it named to stop accepting it. Gates that are reachable are told
        immediately; a gate that is offline is told when it next reaches the hub, and keeps accepting the
        grant until then. Nothing here reaches a phone — the copy on a lost device stays exactly as it is,
        and it is the gate that refuses it.
      </p>

      <ul className="mt-4 space-y-2" data-shot="issued-grants">
        {rows.map((g) => (
          <li
            key={g.grant_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/12 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="font-mono text-xs text-ink/70 truncate">{g.grant_id}</p>
              <p className="text-xs text-ink/55 mt-0.5">
                {g.revoked ? (
                  <span className="text-terracotta-deep">Revoked {when(g.revoked_at)}</span>
                ) : (
                  <>Expires {when(g.expires_at)}</>
                )}
              </p>
            </div>
            {!g.revoked && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy === g.grant_id}
                onClick={() => void revoke(g.grant_id)}
              >
                {busy === g.grant_id ? 'Revoking…' : 'Revoke'}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {notice && <p className="mt-3 text-sm text-ink/70">{notice}</p>}
      {error && <p className="mt-3 text-sm text-terracotta-deep">{error}</p>}
    </Card>
  );
}
