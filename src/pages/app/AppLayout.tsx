import { useState, useEffect } from 'react';
import { Link, Navigate, Outlet } from 'react-router-dom';
import { AppSidebar } from '@/components/nav/AppSidebar';
import { AppTopBar } from '@/components/nav/AppTopBar';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { CreateLocationModal } from '@/components/locations/CreateLocationModal';
import { useEmergencyOffer } from '@/lib/offline/useEmergencyOffer';

export default function AppLayout() {
  const { signedIn, loading, currentAccount, setCurrentAccount, refreshMe, user } = useAuth();
  const emergency = useEmergencyOffer(user?.id ?? null);
  // null = still checking, false = has locations, true = needs setup
  const [needsLocationSetup, setNeedsLocationSetup] = useState<boolean | null>(null);

  useEffect(() => {
    if (!signedIn || !currentAccount) return;
    setNeedsLocationSetup(null);
    api.locationsList(currentAccount.id)
      .then(({ locations }) => setNeedsLocationSetup(locations.length === 0))
      .catch(() => setNeedsLocationSetup(false)); // fail open — don't block on network error
  }, [signedIn, currentAccount?.id]);

  // `needsLocationSetup` only ever leaves `null` inside the effect above,
  // which itself bails out for a signed-out user (no account to check) — so
  // gating on it here unconditionally would strand a signed-out visitor on
  // this loading screen forever, since the `!signedIn` redirect below would
  // never be reached. Resolve auth state (`loading`) and the signed-out
  // redirect first; only a signed-in user needs to wait on the locations
  // check.
  if (loading) {
    return (
      <div className="min-h-screen bg-paper grid place-items-center text-ink/50 text-sm">
        Loading…
      </div>
    );
  }
  if (!signedIn) return <Navigate to="/login" replace />;
  if (needsLocationSetup === null) {
    return (
      <div className="min-h-screen bg-paper grid place-items-center text-ink/50 text-sm">
        Loading…
      </div>
    );
  }

  if (needsLocationSetup && currentAccount) {
    return (
      <div className="min-h-screen bg-paper">
        <CreateLocationModal
          accountId={currentAccount.id}
          mode="current-account"
          forced
          onClose={() => {}}
          onCreated={async (accountId) => {
            await refreshMe();
            setCurrentAccount(accountId);
            setNeedsLocationSetup(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper flex">
      <AppSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <AppTopBar />
        <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-[1400px] w-full mx-auto">
          {/* The one banner that earns its place, and only under conditions it
              has actually observed: the hub is not answering, this device
              holds a grant, and a controller replied to a probe. See
              useEmergencyOffer for why all three are required — the second
              stops a dead-end offer, the third stops this firing on a train.

              The wording is bounded by what the probe can prove. Something is
              answering at that address; nothing here has verified it is the
              paired controller, because the probe carries no signature. So
              this says a controller is responding and stops short of saying
              the gate will open — that is settled at the gate, against the
              hub key the controller pinned. */}
          {emergency.offer && (
            <div
              role="alert"
              className="mb-6 rounded-2xl border border-gold/50 bg-gold/[0.08] px-5 py-4 sm:px-6 sm:py-5"
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-ink/55 font-mono">
                Hub not answering
              </p>
              <p className="mt-2 text-[15px] text-ink/85 leading-relaxed">
                This console can&rsquo;t reach your hub, but{' '}
                {emergency.gatesInRange === 1
                  ? 'a controller is responding'
                  : `${emergency.gatesInRange} controllers are responding`}{' '}
                on this network. You can open a gate directly with a grant this device already
                holds.
              </p>
              <Link
                to="/app/emergency"
                className="mt-3 inline-flex items-center rounded-full bg-ink text-paper px-4 h-10 text-sm"
              >
                Open emergency access
              </Link>
            </div>
          )}
          {/* WhatsApp-connect and Slack-identity nudge banners used to live
              here. Removed: they called client methods that pointed at routes
              the hub does not serve, so they could never succeed and would
              have nagged on every page load forever. Those methods are gone
              too now.
              Reinstating them needs more than a route: linking a phone
              requires proving the number belongs to the person claiming it,
              and both obvious ways to do that let someone squat a neighbour's
              number. See docs/PHONE-LINKING.md. */}
          {/* Children come from routes.tsx: Aql's four primary screens
              (Overview, Devices, Automations, Energy) and the access-control
              module's deep screens (access points, members, temp access,
              analytics, settings, admin).

              Both kinds of data share those screens. Access, members, grants
              and audit are hub-backed; the other six device kinds, the energy
              figures and the rule list come from the device engine, which is
              off unless the hub was started with -device-drivers. A screen
              with no engine behind it says so in words rather than rendering
              an empty list — "no engine" and "no devices" are different
              answers. Marks are per item, at the point of use
              (src/components/device/StatusMarks.tsx), and inert controls stay
              disabled with a note. Don't wire a shape to an endpoint that
              doesn't exist. */}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 sm:mb-10 pb-6 sm:pb-8 border-b border-ink/10 flex flex-wrap items-end gap-x-6 gap-y-3 sm:gap-x-8 sm:gap-y-4 justify-between">
      <div className="min-w-0">
        {kicker && (
          <span className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-ink/55">
            <span className="h-1 w-1 rounded-full bg-terracotta" aria-hidden />
            {kicker}
          </span>
        )}
        <h1 className="font-display-tight text-3xl sm:text-4xl lg:text-[40px] leading-[1.02] tracking-[-0.02em] mt-2">
          {title}
        </h1>
        {description && (
          <p className="mt-3 text-sm sm:text-[15px] text-ink/65 max-w-xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2 self-end">{actions}</div>}
    </header>
  );
}
