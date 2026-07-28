import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ApiError, api, type EngineDevice } from '@/lib/api';

/**
 * Give a claimed device up.
 *
 * Release rather than transfer: a transfer would need the receiving account to
 * consent to something it cannot see yet, so a device changes hands by
 * becoming unclaimed and then being claimed again. On a sole-account hub this
 * does nothing useful — that hub sees everything regardless — which is why it
 * only appears where a claim actually gates anything.
 */
export function ReleaseDeviceButton({
  accountId,
  deviceKey,
  deviceName,
  onReleased,
}: {
  accountId: string;
  deviceKey: string;
  deviceName: string;
  onReleased: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function release() {
    setBusy(true);
    setError(null);
    try {
      await api.deviceRelease(accountId, deviceKey);
      onReleased();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setError(
        code === 'device_claim_not_found'
          ? 'This account does not hold a claim on that device.'
          : err instanceof Error
            ? err.message
            : 'Could not release that device.',
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-ink/10">
      {confirming ? (
        <>
          <p className="text-sm text-ink/75">
            Release “{deviceName}”? It becomes claimable by any account on this hub, and
            this account loses access to it until someone claims it back.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="ink" disabled={busy} onClick={() => void release()}>
              {busy ? 'Releasing…' : 'Release'}
            </Button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-terracotta-deep hover:underline underline-offset-2"
        >
          Release this device
        </button>
      )}
      {error && <p className="mt-2 text-sm text-terracotta-deep">{error}</p>}
    </div>
  );
}

/**
 * Devices the engine reports that no account has claimed yet.
 *
 * The hub cannot work out whose a device is: a driver discovers it from an
 * MQTT broker, a Modbus PLC or an ONVIF probe, and none of those carries a
 * tenant. So ownership is ASSERTED — an account admin says "this one is ours"
 * — and first claim wins.
 *
 * This panel is where that assertion is made, and it only earns its place on
 * screen when there is something to claim. On the single-household hub the
 * product is mostly for, the list is empty and nothing renders: that hub has
 * one account, sees its whole fleet without claiming anything, and should
 * never be asked to.
 *
 * # What it does not say
 *
 * Nothing here reveals who owns the devices that are missing from the list.
 * The hub answers the same way for "claimed by someone else" and "no such
 * device", because telling an outsider that a device is taken confirms it
 * exists on an account they cannot see.
 */
export function ClaimableDevices({
  accountId,
  onClaimed,
}: {
  accountId: string;
  onClaimed: () => void;
}) {
  const [devices, setDevices] = useState<EngineDevice[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.claimableDevices(accountId);
      setDevices(r.devices);
    } catch (err) {
      // A non-admin gets 404 here (the tenancy contract), and that is not a
      // fault worth a red box — they simply do not have this power. Render
      // nothing rather than an error nobody can act on.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setDevices([]);
        return;
      }
      setDevices([]);
      setError(err instanceof Error ? err.message : 'Could not read claimable devices.');
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function claim(d: EngineDevice) {
    setBusyKey(d.key);
    setError(null);
    try {
      await api.deviceClaim(accountId, { device_key: d.key, label: d.name });
      await refresh();
      onClaimed();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setError(
        code === 'device_already_claimed'
          ? `“${d.name}” was claimed by another account first. Claims cannot be taken over — ask them to release it.`
          : code === 'unknown_device'
            ? `The engine no longer reports “${d.name}”. It may have gone offline since this list was loaded.`
            : err instanceof Error
              ? err.message
              : 'Could not claim that device.',
      );
      // Whatever happened, the list is now stale.
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }

  // Nothing to claim is the normal state, and it renders as nothing at all.
  if (devices === null || devices.length === 0) {
    return error ? (
      <Card className="mb-6 border-terracotta/40">
        <p className="text-sm text-terracotta-deep">{error}</p>
      </Card>
    ) : null;
  }

  return (
    <Card className="mb-6 border-gold/50 bg-gold/[0.05]">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink/55 font-mono">
        Unclaimed devices
      </p>
      <p className="mt-2 text-[15px] text-ink/80 leading-relaxed">
        This hub&rsquo;s engine reports {devices.length} device
        {devices.length === 1 ? '' : 's'} no account has claimed. Claiming one makes it
        visible to this account and lets its members drive it. First claim wins — a device
        another account has already claimed cannot be taken over.
      </p>
      {error && <p className="mt-3 text-sm text-terracotta-deep">{error}</p>}
      <ul className="mt-4 divide-y divide-ink/10">
        {devices.map((d) => (
          <li key={d.key} className="py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{d.name || d.key}</p>
              <p className="text-xs text-ink/60 truncate mt-0.5 font-mono">{d.key}</p>
            </div>
            <Button variant="ink" disabled={busyKey === d.key} onClick={() => void claim(d)}>
              {busyKey === d.key ? 'Claiming…' : 'Claim'}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
