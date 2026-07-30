// The hub's signing key, and rotating it.
//
// Every controller pins this key and verifies every command against it. It could
// not be changed: `repair` — the command that moves a controller onto a new key —
// had no sender, so a key believed compromised stayed authoritative until
// somebody physically reset each controller.
//
// Rotation is not instant and this screen does not pretend otherwise. It is a
// conversation with each controller in turn, and one that is offline holds the
// rotation open until it comes back. What the screen owes an operator is an
// honest view of which controllers have moved and which have not, because the
// ones that have not are the ones still pinning a key that is meant to be gone.

import { useCallback, useState } from 'react';

import { api, type KeyRotationPreview, type KeyRotationStatus } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConfirmModal, ErrorNote, LoadingRow, Td, Th, adminErrorMessage, useAdminLoad, useAdminToast } from './shared';

/** base64url keys are long and nobody reads the middle. */
function shortKey(k: string): string {
  return k.length <= 20 ? k : `${k.slice(0, 10)}…${k.slice(-6)}`;
}

function ago(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} hr`;
  return `${Math.floor(s / 86_400)} d`;
}

export default function AdminGatewayKey() {
  const toast = useAdminToast();
  const { data, error, loading, reload } = useAdminLoad<KeyRotationStatus>(
    () => api.gatewayKeyRotation(),
    [],
  );

  const [preview, setPreview] = useState<KeyRotationPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const openPreview = useCallback(async () => {
    setPreviewErr(null);
    try {
      setPreview(await api.gatewayKeyRotationPreview());
    } catch (err) {
      // Surfaced rather than swallowed: without the preview the confirmation
      // cannot state what a rotation costs, and a confirmation that cannot say
      // what it is about should not be shown at all.
      setPreviewErr(adminErrorMessage(err));
    }
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.gatewayKeyRotationStart(reason.trim());
      toast(`Rotation started — ${r.repairs_sent} repair(s) sent.`);
      setPreview(null);
      setReason('');
      await reload();
    } catch (err) {
      toast(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [reason, reload, toast]);

  const retry = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.gatewayKeyRotationRetry();
      toast(
        r.completed
          ? 'Every controller is on the new key. The previous key has been destroyed.'
          : `${r.repairs_sent} repair(s) re-sent.`,
      );
      await reload();
    } catch (err) {
      toast(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [reload, toast]);

  if (loading) return <LoadingRow label="Loading the signing key…" />;
  if (error) return <ErrorNote text={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Card>
        <div className="p-5 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Gateway signing key</h2>
            <p className="text-sm text-ink/70 mt-1">
              Every controller pins this key and verifies every command against it. Rotating it
              replaces the key across the fleet, one controller at a time.
            </p>
          </div>

          <dl className="text-sm">
            <dt className="text-ink/60">Current public key</dt>
            <dd className="font-mono text-xs break-all mt-1">{data.current_pubkey}</dd>
          </dl>

          {!data.rotating && (
            <div className="pt-2">
              <Button variant="ink" onClick={() => void openPreview()}>
                Rotate the signing key…
              </Button>
              {previewErr && <ErrorNote text={previewErr} />}
            </div>
          )}
        </div>
      </Card>

      {data.rotating && (
        <Card>
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">Rotation in progress</h3>
                <p className="text-sm text-ink/70 mt-1">
                  Started {ago(data.started_at)} ago
                  {data.reason ? ` — ${data.reason}` : ''}.{' '}
                  <strong>{data.repaired}</strong> of{' '}
                  <strong>{data.repaired + data.remaining}</strong> controllers moved.
                </p>
              </div>
              <Button onClick={() => void retry()} disabled={busy}>
                Retry outstanding
              </Button>
            </div>

            {data.remaining > 0 && (
              // The whole point of the screen. A controller still pinning the old
              // key is one that has not been reached, and the previous private
              // key stays on disk until it has been — so this is not a progress
              // bar, it is a list of what is keeping a superseded key alive.
              <p className="text-sm rounded-md bg-gold/20 px-3 py-2">
                The previous key is still held, because {data.remaining} controller
                {data.remaining === 1 ? '' : 's'} still pin{data.remaining === 1 ? 's' : ''} it. It
                is destroyed automatically once the last one is repaired — bring an offline
                controller back and it is repaired within five minutes, or press Retry outstanding.
              </p>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Controller</Th>
                  <Th>Key</Th>
                  <Th>Repair</Th>
                </tr>
              </thead>
              <tbody>
                {data.controllers.map((c) => (
                  <tr key={c.device_id}>
                    <Td>{c.label || c.device_id}</Td>
                    <Td>
                      {c.repaired ? (
                        <span className="text-moss">new key</span>
                      ) : (
                        <span className="text-terracotta-deep">previous key</span>
                      )}
                    </Td>
                    <Td>
                      {c.repaired
                        ? '—'
                        : c.pending_since
                          ? `sent ${ago(c.pending_since)} ago, no answer yet`
                          : 'not sent yet'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="text-xs text-ink/60 space-y-1">
              <div>
                <dt className="inline">Previous key: </dt>
                <dd className="inline font-mono">{shortKey(data.previous_pubkey)}</dd>
              </div>
              <div>
                <dt className="inline">New key: </dt>
                <dd className="inline font-mono">{shortKey(data.new_pubkey)}</dd>
              </div>
            </dl>
          </div>
        </Card>
      )}

      {preview && (
        <ConfirmModal
          title="Rotate the gateway signing key?"
          confirmLabel="Rotate the key"
          busy={busy}
          onClose={() => setPreview(null)}
          onConfirm={() => void start()}
          body={
            <div className="space-y-3 text-sm">
              <p>
                A new signing key is generated now. Each of the{' '}
                <strong>{preview.controllers_to_repair}</strong> paired controller
                {preview.controllers_to_repair === 1 ? '' : 's'} is then moved onto it
                individually. The previous key is kept until every one has moved — a controller
                that is offline holds the rotation open until it returns.
              </p>
              {/* The consequence people do not expect, stated before the act rather
                  than discovered afterwards at a gate. */}
              <p className="rounded-md bg-gold/20 px-3 py-2">
                <strong>
                  Up to {preview.offline_grants_invalidated_max} outstanding offline grant
                  {preview.offline_grants_invalidated_max === 1 ? '' : 's'} will stop working.
                </strong>{' '}
                An offline grant is verified against the key a controller pins, so grants signed
                with the old key are refused once that controller is repaired. This is an upper
                bound — the hub cannot see which are still held on a phone. If you are rotating
                because the old key is not trusted, this is the intended effect.
              </p>
              <label className="block">
                <span className="text-ink/70">Reason (recorded against the rotation)</span>
                <input
                  className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. suspected key compromise"
                />
              </label>
            </div>
          }
        />
      )}
    </div>
  );
}
