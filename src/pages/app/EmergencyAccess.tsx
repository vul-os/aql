// Emergency access: get a grant while online, hold it, present it at a gate
// with everything else down.
//
// This screen exists for exactly one moment — someone standing at a gate,
// possibly in the dark, possibly in a hurry, with no hub and no internet —
// so it is built backwards from that moment rather than forwards from a
// settings-page instinct. The one thing that moment cannot do is REQUEST
// anything: a grant only exists if it was fetched earlier, while everything
// was still online. So "set this up now" is the loudest thing on this page,
// not a footnote under a list.
//
// Everything here is a thin view over src/lib/offline/service.ts, which owns
// every rule (per-hub isolation, hub-key pinning, fail-closed storage). This
// file adds no capability the library doesn't already have — see vault.ts's
// header and docs/MULTI-HUB.md for why that isolation matters and what it
// protects against.

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { PageHeader } from './AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { ArchMark } from '@/components/illustrations/ArchMark';
import { IssuedGrantsPanel } from '@/components/access/IssuedGrantsPanel';
import { useAuth } from '@/lib/auth';
import { api, type AccessPointDetail } from '@/lib/api';
import {
  loadState,
  requestGrant,
  refreshIfDue,
  presentAtGate,
  forgetGrant,
  forgetAll,
  normalizeControllerAddress,
  lanTransportAvailable,
  allGateStatuses,
  freshness,
  type OfflineState,
  type GateStatus,
} from '@/lib/offline/service';
import type { RedeemOutcome } from '@/lib/offline/redeem';

const nowSec = () => Math.floor(Date.now() / 1000);

// Both of these are decided entirely on THIS device, offline, from a stored
// grant — the hub's HTTP API never emits either of them (they come from
// vault.ts's HubKeyChangedError.code and grant.ts's Verdict 'warn' code for
// step 7, respectively). Named as constants, rather than compared inline as
// string literals, so they read distinctly from an `err.code === '…'` branch
// on a hub-emitted error code — the two vocabularies look identical but come
// from different authorities, and conflating them is exactly the mistake
// errorCodeParity.test.ts exists to catch for the other kind.
const HUB_KEY_CHANGED_CODE: 'hub_key_changed' = 'hub_key_changed';
const WINDOW_VERDICT_CODE: 'window' = 'window';

/** A local label for a hub — there is no user-chosen hub name in the store
 * yet (docs/MULTI-HUB.md proposes one; it isn't built), so this is built
 * honestly from what a GrantRecord actually carries: the address it last
 * answered on, plus enough of its pinned key to tell two hubs apart at a
 * glance. Never used for anything that decides access — display only. */
function hubLabel(gatewayUrl: string, hubPubkey: string): string {
  let host = gatewayUrl;
  try {
    host = new URL(gatewayUrl).hostname;
  } catch {
    /* keep the raw string */
  }
  return `${host} · key ${hubPubkey.slice(0, 10)}…`;
}

export default function EmergencyAccess() {
  const { user, currentAccount } = useAuth();
  const memberId = user?.id ?? null;

  const [state, setState] = useState<OfflineState | null>(null);
  const [hubKeyChanged, setHubKeyChanged] = useState<{ message: string; hubPubkey: string | null } | null>(
    null,
  );
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!memberId) return;
    const s = await loadState(memberId);
    setState(s);
    // "Refreshes on every online launch, so revocation converges within the
    // TTL" is only true if this actually runs whenever the screen opens with
    // a connection. A failure here never touches the existing grant —
    // refreshIfDue guarantees that — it only ever narrates what happened.
    const result = await refreshIfDue(memberId, s);
    if (!result) return;
    if (result.ok) {
      setState(await loadState(memberId));
    } else if (result.code === HUB_KEY_CHANGED_CODE) {
      setHubKeyChanged({ message: result.message, hubPubkey: s.current?.record.hubPubkey ?? null });
    } else {
      setRefreshNotice(`Could not refresh emergency access with your current hub: ${result.message}`);
    }
  }, [memberId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── setup / renew for the hub the console is currently pointed at ────────
  const [accessPoints, setAccessPoints] = useState<AccessPointDetail[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    if (!currentAccount) {
      setAccessPoints(null);
      return;
    }
    api
      .accessPoints(currentAccount.id)
      .then((r) => setAccessPoints(r.access_points))
      .catch(() => setAccessPoints([]));
  }, [currentAccount]);

  // Default the picker to whatever is already enrolled, so "renew" doesn't
  // make someone re-pick every gate they already trusted this device with.
  useEffect(() => {
    if (!accessPoints || !state?.current || selected.size > 0) return;
    const already = new Set(state.current.record.accessPoints.map((a) => a.id));
    const usable = new Set(accessPoints.filter((a) => already.has(a.id)).map((a) => a.id));
    if (usable.size > 0) setSelected(usable);
  }, [accessPoints, state, selected.size]);

  function toggleAP(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onEnroll(e: FormEvent) {
    e.preventDefault();
    if (!memberId || !accessPoints || selected.size === 0) return;
    setEnrolling(true);
    setEnrollError(null);
    setEnrolled(false);
    const chosen = accessPoints.filter((a) => selected.has(a.id));
    const result = await requestGrant(memberId, chosen);
    setEnrolling(false);
    if (result.ok) {
      setEnrolled(true);
      setHubKeyChanged(null);
      setState(await loadState(memberId));
    } else if (result.code === HUB_KEY_CHANGED_CODE) {
      setHubKeyChanged({ message: result.message, hubPubkey: state?.current?.record.hubPubkey ?? null });
    } else {
      setEnrollError(result.message);
    }
  }

  // ── presenting at a gate ──────────────────────────────────────────────────
  const [presenting, setPresenting] = useState<GateStatus | null>(null);
  const [address, setAddress] = useState('');
  const [presentBusy, setPresentBusy] = useState(false);
  const [outcome, setOutcome] = useState<RedeemOutcome | null>(null);

  function openPresent(status: GateStatus) {
    setPresenting(status);
    setAddress(status.address);
    setOutcome(null);
  }

  function closePresent() {
    setPresenting(null);
    setOutcome(null);
  }

  async function doPresent(acceptWarning: boolean) {
    const key = state?.key;
    if (!presenting || !state || !key || !memberId) return;
    const held = state.held.find((h) => h.record.hubPubkey === presenting.hubPubkey);
    if (!held) return;
    const normalized = normalizeControllerAddress(address);
    if (!normalized) {
      setOutcome({ kind: 'refused', code: 'bad_address', message: 'That is not a usable controller address.' });
      return;
    }
    setPresentBusy(true);
    const result = await presentAtGate({
      record: held.record,
      grant: held.grant,
      key,
      accessPointId: presenting.accessPoint.id,
      address: normalized,
      acceptWarning,
    });
    setPresentBusy(false);
    setOutcome(result);
    // A real answer from a controller (open or a decoded denial) is worth
    // reloading for — it may have just remembered a working address.
    if (result.kind === 'opened' || result.kind === 'denied') {
      setState(await loadState(memberId));
    }
  }

  // ── forgetting ─────────────────────────────────────────────────────────────
  const [confirmForget, setConfirmForget] = useState<{ hubPubkey: string; label: string } | null>(null);
  const [confirmForgetAll, setConfirmForgetAll] = useState(false);

  async function doForgetGrant(hubPubkey: string) {
    await forgetGrant(hubPubkey);
    setConfirmForget(null);
    if (memberId) setState(await loadState(memberId));
  }

  async function doForgetAll() {
    await forgetAll();
    setConfirmForgetAll(false);
    if (memberId) setState(await loadState(memberId));
  }

  if (!user) {
    return (
      <>
        <PageHeader kicker="Emergency access" title="Emergency access" />
        <Card>
          <p className="text-ink/65 text-sm">Sign in to see or set up emergency access on this device.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker="Emergency access"
        title="Set this up before you need it."
        description="This is the one thing here that cannot be requested during an outage — it has to already be on this device, from before the hub, the internet or the Wi-Fi went down."
      />

      {!lanTransportAvailable() && (
        <Card className="mb-6 border-gold/40">
          <p className="text-sm text-ink/75">
            <span className="font-medium">This page can't present a grant.</span> Opening a gate here talks
            directly to the controller over your local network, in plain http. This console is served over
            https, so the browser blocks that as mixed content before the request is made — nothing on the
            controller can change it. Open this from the Aql desktop app when you're actually at a gate.
            Setting up and holding a grant still works fine here.
          </p>
        </Card>
      )}

      {hubKeyChanged && (
        <HubKeyChangedCard
          message={hubKeyChanged.message}
          onForget={
            hubKeyChanged.hubPubkey
              ? () => doForgetGrant(hubKeyChanged.hubPubkey as string)
              : undefined
          }
        />
      )}

      {refreshNotice && (
        <Card className="mb-6 border-gold/40">
          <p className="text-sm text-ink/70">{refreshNotice}</p>
        </Card>
      )}

      {state && state.problems.length > 0 && (
        <Card className="mb-6 border-gold/40">
          <p className="text-sm font-medium text-ink/85 mb-2">
            Some stored emergency-access data couldn't be used and was removed:
          </p>
          <ul className="space-y-1">
            {state.problems.map((p, i) => (
              <li key={i} className="text-sm text-ink/65">
                · {p}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!state ? (
        <Card>
          <p className="text-ink/55 text-sm">Loading…</p>
        </Card>
      ) : !state.support.ok ? (
        <Card className="border-terracotta/40">
          <p className="text-sm text-terracotta-deep">{state.support.message}</p>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Setup / renew — always first, always visible. The moment this
              screen is skimmed rather than read is exactly the moment it
              must already be obvious what to do. */}
          <Card tone="ink" className="p-0 overflow-hidden">
            <div className="relative p-8 sm:p-10">
              <div className="absolute inset-0 grid place-items-center pointer-events-none opacity-[0.06]">
                <ArchMark className="h-[320px] w-[320px] text-paper" />
              </div>
              <div className="relative">
                <p className="text-[11px] uppercase tracking-[0.22em] text-paper/55">
                  {state.current ? 'Renew on this hub' : 'Set up on this hub'}
                </p>
                <p className="font-display text-3xl sm:text-4xl mt-2 leading-tight">
                  {state.current
                    ? 'Keep this grant current while you still can.'
                    : "Get a grant now, so you're not stuck asking for one later."}
                </p>
                <p className="text-paper/70 mt-3 max-w-xl leading-relaxed">
                  This asks your hub, right now, which gates you're allowed into, and stores its signed answer
                  on this device. It works with no network the moment it's saved — which is also why it can't
                  be fetched the moment you actually need it.
                </p>

                {!currentAccount ? (
                  <p className="text-paper/70 mt-6 text-sm">Sign in to a hub to set up emergency access there.</p>
                ) : accessPoints === null ? (
                  <p className="text-paper/60 mt-6 text-sm">Loading your gates…</p>
                ) : accessPoints.length === 0 ? (
                  <p className="text-paper/70 mt-6 text-sm">You don't have any gates on this hub yet.</p>
                ) : (
                  <form onSubmit={onEnroll} className="mt-6 space-y-4">
                    <div className="space-y-2">
                      {accessPoints.map((a) => {
                        const on = selected.has(a.id);
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => toggleAP(a.id)}
                            className={`w-full text-left rounded-xl px-4 py-3.5 border transition-colors flex items-center justify-between gap-3 ${
                              on
                                ? 'bg-paper text-ink border-paper'
                                : 'bg-paper/5 text-paper border-paper/25 hover:border-paper/50'
                            }`}
                          >
                            <span>
                              <span className="font-medium">{a.name}</span>
                              <span className={`ml-2 text-xs ${on ? 'text-ink/55' : 'text-paper/55'}`}>
                                {a.kind}
                              </span>
                            </span>
                            <span
                              className={`h-5 w-5 rounded-md border grid place-items-center shrink-0 ${
                                on ? 'bg-ink border-ink' : 'border-paper/40'
                              }`}
                              aria-hidden
                            >
                              {on && <span className="h-2 w-2 rounded-sm bg-paper" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {enrollError && <p className="text-sm text-terracotta-soft">{enrollError}</p>}
                    {enrolled && !enrollError && (
                      <p className="text-sm text-paper/85">Saved. This will work with no network from now until it expires.</p>
                    )}
                    <Button
                      type="submit"
                      variant="paper"
                      size="lg"
                      disabled={enrolling || hubKeyChanged !== null || selected.size === 0}
                      className="w-full sm:w-auto"
                    >
                      {enrolling ? 'Asking your hub…' : state.current ? 'Renew emergency access' : 'Get emergency access'}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </Card>

          {/* Held grants — one section per hub, on purpose. A phone can hold
              a grant from home and from a friend's office at once; they are
              never merged, and this app refuses to present one against the
              other's record (service.ts's structural isolation). */}
          <section>
            <h2 className="font-display text-2xl mb-1">Your emergency access</h2>
            <p className="text-sm text-ink/60 mb-4 max-w-xl">
              Each hub below is separate. A grant from one only ever opens that hub's own gates, and this app
              never combines them, even on the same device.
            </p>

            {state.held.length === 0 ? (
              <Card>
                <p className="text-ink/60 text-sm">
                  Nothing held yet. Set up above, while you have a connection — there is nothing to show here
                  until you do.
                </p>
              </Card>
            ) : (
              <div className="space-y-5">
                {state.held.map((h) => {
                  const gates = allGateStatuses(state.held, state.key?.publicKeyB64u ?? null, nowSec()).filter(
                    (g) => g.hubPubkey === h.record.hubPubkey,
                  );
                  const fresh = freshness(h, nowSec());
                  return (
                    <Card key={h.record.id} className={fresh.unconfirmed ? 'border-gold/40' : undefined}>
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <div>
                          <p className="font-medium">{hubLabel(h.record.gatewayUrl, h.record.hubPubkey)}</p>
                          <p className={`text-sm mt-1 ${fresh.unconfirmed ? 'text-gold' : 'text-ink/60'}`}>
                            {fresh.message}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConfirmForget({
                              hubPubkey: h.record.hubPubkey,
                              label: hubLabel(h.record.gatewayUrl, h.record.hubPubkey),
                            })
                          }
                        >
                          Forget this hub
                        </Button>
                      </div>
                      <ul className="space-y-2">
                        {gates.map((g) => (
                          <li key={`${g.hubPubkey}::${g.accessPoint.id}`}>
                            <GateRow status={g} onPresent={() => openPresent(g)} />
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* What this can and can't do — stated plainly, not left for
              someone to discover the hard way at a gate. */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InfoCard title="This talks to the gate, not the hub">
              Presenting a grant is a direct exchange with the controller over your local Wi-Fi. No hub and no
              internet are involved — which is the entire point. Give, or confirm, the controller's address for
              each gate below; a guessed address is labelled as a guess, not a known-good one.
            </InfoCard>
            <InfoCard title="The gate's clock is what counts">
              The proof this app signs is timestamped using the controller's own clock, read from its own
              challenge — not this phone's. A phone whose clock drifted during a blackout can still open a gate
              it's entitled to open; freshness comes from a one-time challenge the controller issues, never from
              trusting this device's idea of the time.
            </InfoCard>
            <InfoCard title="No Bluetooth fallback here">
              The underlying protocol has a Bluetooth (BLE) path, but no browser — including the one this app is
              built on — can drive a Bluetooth radio. If the LAN attempt below fails, there is no second attempt
              inside this app to make. Use a keypad, a second remote, or a different channel to reach the gate
              itself.
            </InfoCard>
          </section>

          {/* Danger zone. */}
          <Card className="border-terracotta/25">
            <h3 className="font-display text-lg mb-1">This is not my device any more</h3>
            <p className="text-sm text-ink/60 mb-4 max-w-xl">
              Deletes every hub's grant and this device's emergency-access key, all at once. Use this when the
              phone is lost, sold, or handed back — not for an ordinary sign-out, which leaves other hubs'
              emergency access untouched.
            </p>
            <Button variant="outline" size="md" onClick={() => setConfirmForgetAll(true)}>
              Forget all emergency access
            </Button>
          </Card>
        </div>
      )}

      {presenting && (
        <PresentModal
          status={presenting}
          address={address}
          onAddressChange={setAddress}
          busy={presentBusy}
          outcome={outcome}
          transportAvailable={lanTransportAvailable()}
          onPresent={() => doPresent(false)}
          onTryAnyway={() => doPresent(true)}
          onClose={closePresent}
        />
      )}

      {confirmForget && (
        <ConfirmModal
          title={`Forget ${confirmForget.label}?`}
          body="This deletes the only copy of this hub's grant on this device. You will need a network connection to reach this hub again before you can get a new one — this cannot be undone offline."
          confirmLabel="Forget this hub"
          onConfirm={() => doForgetGrant(confirmForget.hubPubkey)}
          onCancel={() => setConfirmForget(null)}
        />
      )}

      {confirmForgetAll && (
        <ConfirmModal
          title="Forget all emergency access?"
          body="This deletes every hub's grant and this device's emergency-access key. A new one needs the network back — none of this can be recovered offline, from any hub, afterward."
          confirmLabel="Forget everything"
          onConfirm={doForgetAll}
          onCancel={() => setConfirmForgetAll(false)}
        />
      )}

      {/* What the HUB holds, as opposed to what this device holds. Placed last
          because it is the rarer question — until a phone goes missing, at
          which point it is the only one that matters. */}
      <IssuedGrantsPanel />
    </>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card tone="cream">
      <h3 className="font-medium text-sm mb-2">{title}</h3>
      <p className="text-sm text-ink/65 leading-relaxed">{children}</p>
    </Card>
  );
}

function verdictBadge(v: GateStatus['verdict']): { label: string; className: string } {
  switch (v.status) {
    case 'ok':
      return { label: 'Ready', className: 'bg-moss/15 text-moss' };
    case 'warn':
      return { label: 'May be refused', className: 'bg-gold/20 text-gold' };
    case 'deferred':
      return { label: 'Ready', className: 'bg-moss/15 text-moss' };
    case 'refuse':
    default:
      return { label: "Won't open", className: 'bg-terracotta/15 text-terracotta-deep' };
  }
}

function GateRow({ status, onPresent }: { status: GateStatus; onPresent: () => void }) {
  const badge = verdictBadge(status.verdict);
  const refused = status.verdict.status === 'refuse';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 bg-paper-cool px-4 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{status.accessPoint.name}</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        <p className="text-xs text-ink/55 mt-1">
          {status.accessPoint.kind} · controller at{' '}
          <span className="font-mono">{status.address || 'unknown'}</span>
          {status.address && !status.addressKnown && ' (guessed)'}
        </p>
        {status.verdict.status !== 'ok' && status.verdict.status !== 'deferred' && (
          <p className="text-xs text-ink/50 mt-1">{status.verdict.message}</p>
        )}
      </div>
      <Button variant={refused ? 'outline' : 'primary'} size="lg" onClick={onPresent} className="shrink-0">
        Open this gate
      </Button>
    </div>
  );
}

function HubKeyChangedCard({ message, onForget }: { message: string; onForget?: () => void }) {
  return (
    <Card className="mb-6 border-terracotta bg-terracotta/5">
      <h3 className="font-display text-xl text-terracotta-deep mb-2">This isn't the hub you enrolled with</h3>
      <p className="text-sm text-ink/80 mb-3">{message}</p>
      <p className="text-sm text-ink/70 leading-relaxed mb-3">
        There are two ordinary reasons this happens: the hub was rebuilt from scratch (a fresh install makes a
        new key), or it was restored from a backup taken before this device enrolled. There is also a reason
        that isn't ordinary: something else is answering at this address instead of your hub. This app can't
        tell those apart, so it won't guess for you — there is no "continue anyway" here.
      </p>
      <p className="text-sm text-ink/70 leading-relaxed mb-4">
        If you're certain this is your own hub after a rebuild or restore, forget the old record below and set
        up emergency access again once you're sure. If you're not certain, stop here and check the hub in
        person before doing anything else.
      </p>
      {onForget && (
        <Button variant="outline" size="md" onClick={onForget}>
          Forget this hub's old record
        </Button>
      )}
    </Card>
  );
}

function PresentModal({
  status,
  address,
  onAddressChange,
  busy,
  outcome,
  transportAvailable,
  onPresent,
  onTryAnyway,
  onClose,
}: {
  status: GateStatus;
  address: string;
  onAddressChange: (v: string) => void;
  busy: boolean;
  outcome: RedeemOutcome | null;
  transportAvailable: boolean;
  onPresent: () => void;
  onTryAnyway: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-2xl mb-1">{status.accessPoint.name}</h2>
      <p className="text-sm text-ink/60 mb-5">
        This sends your grant straight to the gate's controller over your local network — not to the hub, and
        not over the internet.
      </p>

      {!transportAvailable && (
        <p className="text-sm text-gold mb-4">
          This can't be attempted from a browser tab. Open the Aql app to actually present a grant at a gate.
        </p>
      )}

      <Field
        label="Controller address"
        hint={status.addressKnown ? 'Last address that worked here' : 'Guessed — confirm it before trying'}
        value={address}
        onChange={onAddressChange}
        placeholder="lintel-xxxxxxxx.local:8737"
        disabled={busy}
      />

      {outcome && <OutcomeBlock outcome={outcome} onTryAnyway={onTryAnyway} />}

      <div className="flex justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className="h-11 px-4 rounded-full text-sm text-ink/65 hover:text-ink">
          {outcome?.kind === 'opened' ? 'Done' : 'Close'}
        </button>
        {outcome?.kind !== 'opened' && (
          <Button variant="primary" size="lg" onClick={onPresent} disabled={busy || !transportAvailable}>
            {busy ? 'Presenting…' : 'Present grant'}
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** Every RedeemOutcome kind, rendered as the different thing it is — never
 * smoothed into one generic "error" state. */
function OutcomeBlock({ outcome, onTryAnyway }: { outcome: RedeemOutcome; onTryAnyway: () => void }) {
  if (outcome.kind === 'opened') {
    return (
      <div className="mt-4 rounded-xl bg-moss/10 border border-moss/30 px-4 py-3.5">
        <p className="text-sm font-medium text-moss">Opened.</p>
      </div>
    );
  }
  if (outcome.kind === 'denied') {
    // The controller gave a definite, reasoned "no" — it saw the grant and
    // judged it. Say so, and show the raw reason too: an unrecognised code
    // is information, not noise (see redeem.ts's DENIAL_TEXT comment).
    return (
      <div className="mt-4 rounded-xl bg-terracotta/10 border border-terracotta/30 px-4 py-3.5">
        <p className="text-sm font-medium text-terracotta-deep">The gate refused this.</p>
        <p className="text-sm text-ink/70 mt-1">{outcome.message}</p>
        <p className="text-xs text-ink/45 mt-1 font-mono">{outcome.detail}</p>
      </div>
    );
  }
  if (outcome.kind === 'refused') {
    // A refusal made on THIS device, before a single byte reached the gate —
    // a different fact from a denial, and worth saying plainly: nothing was
    // sent, so nothing at the gate saw this attempt at all.
    return (
      <div className="mt-4 rounded-xl bg-terracotta/10 border border-terracotta/30 px-4 py-3.5">
        <p className="text-sm font-medium text-terracotta-deep">Nothing was sent.</p>
        <p className="text-sm text-ink/70 mt-1">{outcome.message}</p>
        {outcome.code === WINDOW_VERDICT_CODE && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onTryAnyway}>
            The gate judges its own hours — try anyway
          </Button>
        )}
      </div>
    );
  }
  // 'transport' — the honest middle ground. This device never got a
  // well-formed answer, which is NOT the same as "it failed": the proof may
  // have already reached the controller and opened the gate before the
  // reply was lost. Telling someone "failed" here is the one thing that
  // would make them press again believing nothing happened.
  return (
    <div className="mt-4 rounded-xl bg-gold/10 border border-gold/30 px-4 py-3.5">
      <p className="text-sm font-medium text-gold">Couldn't confirm.</p>
      <p className="text-sm text-ink/70 mt-1">{outcome.message}</p>
      <p className="text-sm text-ink/60 mt-1">
        This may or may not have opened — the reply never arrived. Check the gate before trying again.
      </p>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open onClose={onCancel}>
      <h2 className="font-display text-2xl mb-2">{title}</h2>
      <p className="text-sm text-ink/65 leading-relaxed mb-6">{body}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-11 px-4 rounded-full text-sm text-ink/65 hover:text-ink">
          Cancel
        </button>
        <Button variant="outline" size="lg" onClick={onConfirm} className="border-terracotta text-terracotta-deep hover:bg-terracotta hover:text-paper">
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
