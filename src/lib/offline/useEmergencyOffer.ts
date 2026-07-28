import { useEffect, useState } from 'react';
import { getHubReachability, subscribeHubReachability } from '../hubReachability';
import { allGateStatuses, loadState, reachableGates } from './service';

/**
 * Should the console offer offline emergency access right now?
 *
 * ROADMAP: "an emergency-access screen that appears when the hub is
 * unreachable and a paired controller is in range". Both halves are load
 * bearing, and the second one is what keeps this from becoming the kind of
 * banner AppLayout already deleted a pair of — ones that "could never succeed
 * and would have nagged on every page load forever".
 *
 * The conditions, in the order they are cheap to check:
 *
 *   1. The hub is observed unreachable. Not `unknown` — before the first
 *      request there is no evidence, and a cold start is not an emergency.
 *   2. This device actually holds a grant. With none, the emergency screen
 *      has nothing to show and the offer is a dead end.
 *   3. A controller answers. Without this the banner fires on a train, where
 *      the hub is unreachable for the ordinary reason that nothing is
 *      reachable, and where no gate is going to open however hard the user
 *      taps.
 *
 * Only 3 costs anything on the network, and it runs only when 1 and 2 hold.
 *
 * # What it does not claim
 *
 * `gatesInRange` counts gates whose ADDRESS answered a probe. probeController
 * cannot prove the thing that answered is the paired controller — nothing on
 * that request is signed — so the copy this feeds must say a controller is
 * answering, never that a gate is ready to open. The proof happens at
 * redemption, against the hub key the controller pinned.
 */
export type EmergencyOffer = {
  offer: boolean;
  gatesInRange: number;
};

const NONE: EmergencyOffer = { offer: false, gatesInRange: 0 };

export function useEmergencyOffer(memberId: string | null): EmergencyOffer {
  const [reachability, setReachability] = useState(getHubReachability);
  const [offer, setOffer] = useState<EmergencyOffer>(NONE);

  useEffect(() => subscribeHubReachability(setReachability), []);

  useEffect(() => {
    if (reachability !== 'unreachable' || !memberId) {
      setOffer(NONE);
      return;
    }
    // `cancelled` rather than an AbortController: the probes already bound
    // themselves with a short timeout, and what matters here is not stopping
    // them but never applying their result to a screen that has moved on —
    // the hub coming back while probes are in flight must not leave an
    // emergency banner behind.
    let cancelled = false;
    (async () => {
      try {
        const state = await loadState(memberId);
        if (cancelled) return;
        if (state.held.length === 0) {
          setOffer(NONE);
          return;
        }
        const gates = allGateStatuses(state.held, state.key?.publicKeyB64u ?? null, nowSec());
        const live = await reachableGates(gates);
        if (cancelled) return;
        setOffer(live.length > 0 ? { offer: true, gatesInRange: live.length } : NONE);
      } catch {
        // Reading the vault or probing can fail for reasons that are not this
        // feature's business. Staying silent is the honest default: the
        // emergency screen is still reachable from the sidebar, and a banner
        // raised on an error would be claiming something we did not observe.
        if (!cancelled) setOffer(NONE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reachability, memberId]);

  return offer;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
