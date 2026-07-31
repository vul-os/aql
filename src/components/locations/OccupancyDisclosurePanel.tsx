// The occupancy-disclosure switch for one location.
//
// docs/CHAT-COMMANDS.md §4.4 rule 6: "Occupancy proxies are opt-in per
// location, default off. Presence, away-state, and 'which lights are on' are
// off unless an operator enables them for that location."
//
// # Why this screen exists rather than a line in a settings list
//
// §4.3 is the argument: "which lights are on" is an occupancy question, and
// reporting an away-state automation reports occupancy whether or not anyone
// meant it to. A switch with that consequence should not sit unlabelled between
// two quotas — the person turning it on has to be able to read what it lets a
// chat platform learn about the people who live here.
//
// Off is the default and needs no action. The panel therefore leads with what
// turning it ON does, not with what it currently is.

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { ApiError, api } from '@/lib/api';
import { fromUnix } from '@/lib/time';

type State = {
  occupancy: boolean;
  enabledBy?: string;
  enabledAt?: number;
};

export function OccupancyDisclosurePanel({
  locationId,
  locationName,
}: {
  locationId: string;
  locationName?: string;
}) {
  const { currentAccount } = useAuth();
  // Same rule the limits panel uses: owner or admin on the account.
  const isAdmin = currentAccount?.role === 'owner' || currentAccount?.role === 'admin';
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (alive: () => boolean) =>
      api
        .locationDisclosure(locationId)
        .then((d) => {
          if (!alive()) return;
          setState({ occupancy: d.occupancy, enabledBy: d.enabled_by, enabledAt: d.enabled_at });
        })
        .catch(() => {
          // A hub too old to serve this has the feature off, which is the same
          // state as a location that never opted in. Rendering nothing is
          // wrong — an admin looking for the switch would conclude it does not
          // exist — so the panel shows the default and the toggle will report
          // its own failure if pressed.
          if (alive()) setState({ occupancy: false });
        }),
    [locationId],
  );

  useEffect(() => {
    let alive = true;
    void load(() => alive);
    return () => {
      alive = false;
    };
  }, [load]);

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.setLocationDisclosure(locationId, next);
      await load(() => true);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setError(
        e?.code === 'not_account_admin'
          ? 'Only an account admin can change this.'
          : err instanceof Error
            ? err.message
            : 'Could not change that setting.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <Card>
      <h2 className="font-display text-2xl text-ink">Occupancy over chat</h2>
      <p className="mt-2 text-sm text-ink/70">
        With this on, someone messaging {locationName ? <b>{locationName}</b> : 'this location'} from
        a linked chat account can ask which lights are on and whether anyone is in. That is a
        question about the people here, and the answer travels over WhatsApp, Telegram, Slack or
        Discord — platforms that can read every message they carry.
      </p>
      <p className="mt-2 text-sm text-ink/70">
        It is off unless you turn it on, and off is the right default for a shared home. Gate
        commands and “when was it last opened” are unaffected either way.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <span
          className={`text-sm font-medium ${state.occupancy ? 'text-ink' : 'text-ink/55'}`}
          data-shot="occupancy-state"
        >
          {state.occupancy ? 'On for this location' : 'Off'}
        </span>
        {isAdmin ? (
          <Button
            variant={state.occupancy ? 'ghost' : 'ink'}
            disabled={busy}
            onClick={() => void set(!state.occupancy)}
          >
            {busy ? 'Saving…' : state.occupancy ? 'Turn off' : 'Turn on'}
          </Button>
        ) : (
          <span className="text-xs text-ink/50">Only an admin can change this.</span>
        )}
      </div>

      {/* Who decided, not just what the switch says. A privacy control nobody
          can attribute is not one anybody can audit. */}
      {state.occupancy && state.enabledAt ? (
        <p className="mt-3 text-xs text-ink/55">
          Turned on {fromUnix(state.enabledAt)?.toLocaleString() ?? 'at an unknown time'}
          {state.enabledBy ? ' by a member of this account' : ''}.
        </p>
      ) : null}

      {error && <p className="mt-3 text-sm text-terracotta-deep">{error}</p>}
    </Card>
  );
}
