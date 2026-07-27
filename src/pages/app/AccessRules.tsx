// Access rules — WHEN and WHERE someone may open a gate: two independent
// restrictions that both live on the hub and are both enforced inside the
// open path's choke point (openpath.go → LogAccess), not anywhere in this
// console. Nothing here reaches the enforcement directly; every row below is
// a database record the open path itself reads on every actuation attempt.
// This screen only lets an admin write and remove those records — it cannot
// make a rule stricter or looser than what the hub already applies.
//
// Two DIFFERENT mechanisms, deliberately not one feature with two knobs:
//
//   - Geofences (hub/internal/httpapi/geofence.go, internal/store/geofence.go)
//     are a property of the DOOR: near/far, the same rule for everyone who
//     opens it. Read the honesty note in that section before building
//     anything on top of this — it is the single most important thing on
//     this page. A geofence is not a security control.
//   - Time windows (hub/internal/httpapi/timewindows.go,
//     internal/store/timewindows.go) are a property of the PERSON: one
//     member's schedule. The opposite privacy shape from a fence, on
//     purpose, and this page reflects that asymmetry rather than smoothing
//     it away.
//
// A THIRD thing that looks related but is not: the weekly windows carried
// inside an offline emergency grant (proto/grants.md, keys.GrantWindow) are
// evaluated by the CONTROLLER itself, on its own clock, with no hub involved
// at redemption. The time-window rules on this page are the ONLINE
// mechanism only — same Go type and JSON shape as an offline grant's window
// (deliberately one vocabulary, see timewindows.go's file comment) but a
// completely separate enforcement path. Do not read one as standing in for
// the other.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from './AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import {
  ApiError,
  api,
  friendlyApiError,
  type AccessPointDetail,
  type LocationRow,
  type AccountMemberRow,
  type GeofenceRule,
  type TimeWindowRule,
  type GrantWindow,
} from '@/lib/api';

type TargetKind = 'access_point' | 'location';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function segmentClass(active: boolean): string {
  return `h-9 px-4 rounded-full border text-xs transition-colors ${
    active ? 'bg-ink text-paper border-ink' : 'bg-paper-cool text-ink border-ink/15 hover:border-ink/35'
  }`;
}

/** Resolves a rule's target (exactly one of access_point_id/location_id) to a
 *  name a human recognises, falling back to the raw id if the lookup list
 *  hasn't loaded (or the target was since removed) — never hides the row. */
function targetLabel(
  accessPointId: string | null,
  locationId: string | null,
  accessPoints: AccessPointDetail[],
  locations: LocationRow[],
): string {
  if (accessPointId) {
    const ap = accessPoints.find((a) => a.id === accessPointId);
    return ap ? `${ap.name} · access point` : `Access point ${accessPointId}`;
  }
  if (locationId) {
    const loc = locations.find((l) => l.id === locationId);
    return loc ? `${loc.name} · whole location` : `Location ${locationId}`;
  }
  return 'Unknown target';
}

export default function AccessRulesPage() {
  const { currentAccount, user } = useAuth();
  const isAdmin = currentAccount?.role === 'owner' || currentAccount?.role === 'admin';

  const [geofences, setGeofences] = useState<GeofenceRule[] | null>(null);
  const [geofenceError, setGeofenceError] = useState<string | null>(null);
  const [windows, setWindows] = useState<TimeWindowRule[] | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);

  // Target lookups, needed to show a name instead of a raw id on every row.
  // Reads on both rule kinds are open to (at least) every member, so these
  // are fetched unconditionally rather than gated on isAdmin.
  const [accessPoints, setAccessPoints] = useState<AccessPointDetail[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [targetsLoaded, setTargetsLoaded] = useState(false);

  // Member lookup, needed only to show OTHER members' names on the time-
  // window list — and only an admin ever sees another member's rule at all,
  // so this is fetched only for admins rather than handed to every member.
  const [members, setMembers] = useState<AccountMemberRow[]>([]);

  const [creatingGeofence, setCreatingGeofence] = useState(false);
  const [creatingWindow, setCreatingWindow] = useState(false);

  const refreshGeofences = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const r = await api.geofences(currentAccount.id);
      setGeofences(r.geofences);
      setGeofenceError(null);
    } catch (err) {
      setGeofenceError(friendlyApiError(err, 'Could not load geofences.'));
    }
  }, [currentAccount]);

  const refreshWindows = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const r = await api.timeWindows(currentAccount.id);
      setWindows(r.time_windows);
      setWindowError(null);
    } catch (err) {
      setWindowError(friendlyApiError(err, 'Could not load time windows.'));
    }
  }, [currentAccount]);

  useEffect(() => {
    refreshGeofences();
  }, [refreshGeofences]);

  useEffect(() => {
    refreshWindows();
  }, [refreshWindows]);

  useEffect(() => {
    if (!currentAccount) return;
    let cancelled = false;
    Promise.allSettled([
      api.accessPoints(currentAccount.id).then((r) => {
        if (!cancelled) setAccessPoints(r.access_points);
      }),
      api.locationsList(currentAccount.id).then((r) => {
        if (!cancelled) setLocations(r.locations);
      }),
    ]).then(() => {
      if (!cancelled) setTargetsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [currentAccount]);

  useEffect(() => {
    if (!currentAccount || !isAdmin) return;
    let cancelled = false;
    api
      .accountMembers(currentAccount.id)
      .then((r) => {
        if (!cancelled) setMembers(r.members);
      })
      .catch(() => {
        // Best-effort: worst case an admin sees a user id instead of a name
        // on someone else's row. That degrades a label, not a decision.
      });
    return () => {
      cancelled = true;
    };
  }, [currentAccount, isAdmin]);

  async function deleteGeofence(rule: GeofenceRule) {
    if (!currentAccount) return;
    await api.geofenceDelete(currentAccount.id, rule.id);
    await refreshGeofences();
  }

  async function deleteWindow(rule: TimeWindowRule) {
    if (!currentAccount) return;
    await api.timeWindowDelete(currentAccount.id, rule.id);
    await refreshWindows();
  }

  if (!currentAccount) {
    return (
      <>
        <PageHeader kicker="Access control" title="Access rules" />
        <Card>
          <p className="text-ink/65 text-sm">No account loaded.</p>
        </Card>
      </>
    );
  }

  const noTargets = targetsLoaded && accessPoints.length === 0 && locations.length === 0;

  return (
    <>
      <PageHeader
        kicker="Access control"
        title="Access rules"
        description="Two independent restrictions your hub checks on every open: where a request claims to come from, and when its owner may open at all. Both are enforced on the hub itself — nothing in this console can reach either check."
      />

      {/* ───────────────────────────── Geofences ───────────────────────────── */}
      <section className="mb-12">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-xl">Geofences</h2>
            <p className="text-sm text-ink/60 mt-1 max-w-2xl">
              Restrict a gate, or a whole location, to opens that claim to come from nearby.
              Applies to every member and every visitor grant alike — a fence is a property of
              the door, not of who is asking.
            </p>
          </div>
          {isAdmin && (
            <Button
              variant="ink"
              size="sm"
              onClick={() => setCreatingGeofence(true)}
              disabled={noTargets}
              title={noTargets ? 'Add an access point or a location first.' : undefined}
            >
              Add geofence
            </Button>
          )}
        </div>

        {/* THE THING THAT MATTERS MOST ON THIS PAGE. Visible on the section
            itself, not a tooltip, and shown to every member (not just the
            admins who can write a rule) — a fence binds everyone, so everyone
            reading its effect needs the same honest framing of what it is. */}
        <Card className="mb-4 border-gold/40 bg-gold/10">
          <p className="text-[10px] uppercase tracking-[0.18em] text-gold mb-2">
            Not a security control
          </p>
          <p className="text-sm text-ink/80 leading-relaxed">
            A geofence is checked against the position the requesting device claims — a phone's
            reading, sent up with the open request. Nothing here verifies that claim: there's no
            second source, no signature over it, and anyone who can call this hub's API can say
            they're standing at the gate from anywhere on earth, in one line, the same way every
            mock-location toggle on every phone does. What a fence actually buys is real — it
            stops you opening the gate at home by mistake from your desk across town, and it
            stops a shared login or a forgotten script firing from three cities away — but it
            stops nobody who is deliberately lying about where they are. Read it as a
            mistake-preventer, never as a lock.
          </p>
        </Card>

        {geofenceError ? (
          <Card className="border-terracotta/40">
            <p className="text-sm text-terracotta-deep">{geofenceError}</p>
          </Card>
        ) : geofences === null ? (
          <Card>
            <p className="text-ink/55 text-sm">Loading…</p>
          </Card>
        ) : geofences.length === 0 ? (
          <Card>
            <p className="text-ink/65 text-sm">
              No geofences yet — every open is allowed from anywhere, which is exactly how this
              hub behaved before this feature existed.
            </p>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <ul>
              {geofences.map((rule) => (
                <GeofenceRow
                  key={rule.id}
                  rule={rule}
                  isAdmin={isAdmin}
                  label={targetLabel(rule.access_point_id, rule.location_id, accessPoints, locations)}
                  onDelete={() => deleteGeofence(rule)}
                />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ────────────────────────── Time windows ──────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-xl">Time windows</h2>
            <p className="text-sm text-ink/60 mt-1 max-w-2xl">
              Restrict when ONE member may open a gate or a location. The opposite shape from a
              geofence:{' '}
              {isAdmin
                ? "a fence binds everyone the same way, a schedule is a statement about a single person, and as an admin you can see every member's below."
                : 'a fence binds everyone the same way, a schedule is a statement about a single person — you can only see the rules that name you, and nobody else can see yours either.'}
            </p>
          </div>
          {isAdmin && (
            <Button
              variant="ink"
              size="sm"
              onClick={() => setCreatingWindow(true)}
              disabled={noTargets || (targetsLoaded && members.length === 0)}
              title={noTargets ? 'Add an access point or a location first.' : undefined}
            >
              Add time window
            </Button>
          )}
        </div>

        {windowError ? (
          <Card className="border-terracotta/40">
            <p className="text-sm text-terracotta-deep">{windowError}</p>
          </Card>
        ) : windows === null ? (
          <Card>
            <p className="text-ink/55 text-sm">Loading…</p>
          </Card>
        ) : windows.length === 0 ? (
          <Card>
            <p className="text-ink/65 text-sm">
              {isAdmin
                ? 'No time-window rules yet — every member may open at any hour.'
                : "You have no time-window rule — you may open at any hour that isn't ruled out some other way."}
            </p>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <ul>
              {windows.map((rule) => (
                <TimeWindowRuleRow
                  key={rule.id}
                  rule={rule}
                  isAdmin={isAdmin}
                  isSelf={rule.user_id === user?.id}
                  memberLabel={
                    rule.user_id === user?.id
                      ? 'You'
                      : (members.find((m) => m.user_id === rule.user_id)?.display_name ??
                        members.find((m) => m.user_id === rule.user_id)?.username ??
                        rule.user_id)
                  }
                  targetLabel={targetLabel(rule.access_point_id, rule.location_id, accessPoints, locations)}
                  onDelete={() => deleteWindow(rule)}
                />
              ))}
            </ul>
          </Card>
        )}

        <p className="text-xs text-ink/45 leading-relaxed mt-4 max-w-2xl">
          These are the ONLINE rules — the hub checks them itself, on every open. Weekly windows
          carried inside an offline emergency grant are a different mechanism entirely: the
          controller evaluates those itself, on its own clock, with no hub involved at the moment
          someone redeems one. Changing a rule here has no effect on a grant already issued.
        </p>
      </section>

      {creatingGeofence && (
        <CreateGeofenceModal
          accountId={currentAccount.id}
          accessPoints={accessPoints}
          locations={locations}
          onClose={() => setCreatingGeofence(false)}
          onCreated={() => {
            setCreatingGeofence(false);
            refreshGeofences();
          }}
        />
      )}

      {creatingWindow && (
        <CreateTimeWindowModal
          accountId={currentAccount.id}
          accessPoints={accessPoints}
          locations={locations}
          members={members}
          onClose={() => setCreatingWindow(false)}
          onCreated={() => {
            setCreatingWindow(false);
            refreshWindows();
          }}
        />
      )}
    </>
  );
}

// ─────────────────────────────── Geofence row ────────────────────────────────

function GeofenceRow({
  rule,
  isAdmin,
  label,
  onDelete,
}: {
  rule: GeofenceRule;
  isAdmin: boolean;
  label: string;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allowance = rule.radius_m + rule.slack_m;
  const allows = rule.on_missing_location === 'allow';

  async function handleDelete() {
    if (
      !confirm(
        `Remove the geofence on ${label}? Opens claiming any location will be allowed there again immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onDelete();
    } catch (e) {
      // A 403 here means "you're not an admin" — the rule is still there and
      // the list above is still correct. This is a write failure, shown on
      // the row that tried to write, never folded into the section's
      // list-fetch error state above.
      setErr(
        e instanceof ApiError && e.status === 403
          ? "You need admin access to remove a geofence."
          : friendlyApiError(e, 'Could not remove this geofence.'),
      );
      setBusy(false);
    }
  }

  return (
    <li className="px-6 py-4 border-b border-ink/8 last:border-0 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink/60 mt-1">
          Allows a claimed position within {allowance.toLocaleString()} m of the pin (
          {rule.radius_m.toLocaleString()} m radius + {rule.slack_m.toLocaleString()} m forgiveness
          for ordinary GPS error)
        </p>
        <p className={`text-xs mt-1 ${allows ? 'text-gold' : 'text-ink/50'}`}>
          {allows
            ? 'A request with NO location at all is let through anyway — this fence does nothing against it.'
            : 'A request with no location at all is denied (the default).'}
        </p>
        {err && <p className="text-xs text-terracotta-deep mt-2">{err}</p>}
      </div>
      {isAdmin && (
        <button
          type="button"
          disabled={busy}
          onClick={handleDelete}
          className="text-xs text-ink/65 hover:text-terracotta-deep underline underline-offset-4 decoration-terracotta shrink-0"
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
      )}
    </li>
  );
}

// ────────────────────────────── Time window row ──────────────────────────────

function scheduleLine(rule: TimeWindowRule): string {
  if (rule.windows.length === 0) return 'no windows (this rule denies always)';
  return rule.windows
    .map((w) => `${w.days} ${w.from}–${w.to}`)
    .join(', ');
}

function TimeWindowRuleRow({
  rule,
  isAdmin,
  isSelf,
  memberLabel,
  targetLabel,
  onDelete,
}: {
  rule: TimeWindowRule;
  isAdmin: boolean;
  isSelf: boolean;
  memberLabel: string;
  targetLabel: string;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Deletion is admin-only, same as creation — but per timewindows.go's own
  // note, this is the escape hatch: a rule applies to admins and owners too,
  // including whoever wrote it, and they delete it here the same way anyone
  // else's rule is deleted, not through some separate "for myself" path.
  async function handleDelete() {
    if (
      !confirm(
        `Remove ${isSelf ? 'your' : `${memberLabel}'s`} time-window rule on ${targetLabel}? ${
          isSelf ? 'You' : memberLabel
        } will be able to open at any hour there again immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onDelete();
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 403
          ? "You need admin access to remove a time-window rule."
          : friendlyApiError(e, 'Could not remove this rule.'),
      );
      setBusy(false);
    }
  }

  return (
    <li className="px-6 py-4 border-b border-ink/8 last:border-0 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {memberLabel} <span className="text-ink/40 font-normal">on</span> {targetLabel}
        </p>
        <p className="text-xs text-ink/60 mt-1">
          {scheduleLine(rule)} <span className="text-ink/40">({rule.tz})</span>
        </p>
        {rule.note && <p className="text-xs text-ink/50 mt-1 italic">“{rule.note}”</p>}
        {err && <p className="text-xs text-terracotta-deep mt-2">{err}</p>}
      </div>
      {isAdmin && (
        <button
          type="button"
          disabled={busy}
          onClick={handleDelete}
          className="text-xs text-ink/65 hover:text-terracotta-deep underline underline-offset-4 decoration-terracotta shrink-0"
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
      )}
    </li>
  );
}

// ─────────────────────────────── Target picker ───────────────────────────────
// Shared between both create modals: every rule on this page names exactly
// one target, an access point or a whole location, never both.

function TargetPicker({
  accessPoints,
  locations,
  kind,
  setKind,
  targetId,
  setTargetId,
}: {
  accessPoints: AccessPointDetail[];
  locations: LocationRow[];
  kind: TargetKind;
  setKind: (k: TargetKind) => void;
  targetId: string;
  setTargetId: (id: string) => void;
}) {
  const options: Array<{ id: string; name: string }> = kind === 'access_point' ? accessPoints : locations;
  return (
    <div>
      <span className="text-sm font-medium text-ink/85">Applies to</span>
      <div className="flex gap-2 mt-1.5">
        <button
          type="button"
          onClick={() => {
            setKind('access_point');
            setTargetId('');
          }}
          className={segmentClass(kind === 'access_point')}
        >
          One access point
        </button>
        <button
          type="button"
          onClick={() => {
            setKind('location');
            setTargetId('');
          }}
          className={segmentClass(kind === 'location')}
        >
          A whole location
        </button>
      </div>
      <select
        required
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        className="mt-2 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
      >
        <option value="" disabled>
          {options.length === 0 ? 'None available' : 'Choose one…'}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-ink/50 mt-1">
        An access-point rule and a location rule can both apply to the same open — when they do,
        BOTH must allow it. Adding a rule only ever narrows access, never widens it.
      </p>
    </div>
  );
}

// ───────────────────────────── Create geofence modal ─────────────────────────

function CreateGeofenceModal({
  accountId,
  accessPoints,
  locations,
  onClose,
  onCreated,
}: {
  accountId: string;
  accessPoints: AccessPointDetail[];
  locations: LocationRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<TargetKind>(accessPoints.length > 0 ? 'access_point' : 'location');
  const [targetId, setTargetId] = useState('');
  const [lat, setLat] = useState('');
  const [long, setLong] = useState('');
  const [radiusM, setRadiusM] = useState('150');
  const [slackM, setSlackM] = useState('');
  const [onMissing, setOnMissing] = useState<'deny' | 'allow'>('deny');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!targetId) {
      setErrorMsg('Pick an access point or a location.');
      return;
    }
    const radius = Number(radiusM);
    if (!Number.isFinite(radius) || radius <= 0) {
      setErrorMsg('Radius must be a positive number of metres.');
      return;
    }
    if ((lat.trim() === '') !== (long.trim() === '')) {
      setErrorMsg('Set both latitude and longitude, or leave both blank.');
      return;
    }

    setSubmitting(true);
    try {
      await api.geofenceCreate(accountId, {
        ...(kind === 'access_point' ? { access_point_id: targetId } : { location_id: targetId }),
        ...(lat.trim() && long.trim() ? { lat: Number(lat), long: Number(long) } : {}),
        radius_m: radius,
        ...(slackM.trim() ? { slack_m: Number(slackM) } : {}),
        on_missing_location: onMissing,
        note: note.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === 'geofence_anchor_required'
            ? (err.detail ?? "This target has no map pin — enter latitude and longitude to place the fence.")
            : err.code === 'invalid_geofence'
              ? (err.detail ?? 'That geofence is not valid.')
              : err.code === 'geofence_rule_exists'
                ? 'A geofence already exists for this target — remove it first to change it.'
                : err.status === 403
                  ? 'You need admin access to create a geofence.'
                  : (err.detail ?? err.code)
          : err instanceof Error
            ? err.message
            : 'Could not create the geofence.';
      setErrorMsg(msg);
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="sm:max-w-lg">
      <h2 className="font-display text-2xl mb-1">Add a geofence</h2>
      <p className="text-sm text-ink/60 mb-5">
        A mistake-preventer, not a lock — see the note on the Geofences section for why. This
        restricts opens to positions near a pin; it does not verify who is asking.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <TargetPicker
          accessPoints={accessPoints}
          locations={locations}
          kind={kind}
          setKind={setKind}
          targetId={targetId}
          setTargetId={setTargetId}
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-ink/85">Anchor latitude (optional)</span>
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="from the target's pin"
              className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink/85">Anchor longitude (optional)</span>
            <input
              type="number"
              step="any"
              value={long}
              onChange={(e) => setLong(e.target.value)}
              placeholder="from the target's pin"
              className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </label>
        </div>
        <p className="text-[11px] text-ink/50 -mt-2">
          Leave both blank to use the pin already dropped on this target. Required if it has none
          — the hub refuses to guess rather than centre a fence on the ocean.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-ink/85">Radius (metres)</span>
            <input
              type="number"
              min={10}
              max={50000}
              required
              value={radiusM}
              onChange={(e) => setRadiusM(e.target.value)}
              className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
            />
            <span className="block text-[11px] text-ink/50 mt-1">10 m – 50 km</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink/85">Forgiveness (optional)</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={slackM}
              onChange={(e) => setSlackM(e.target.value)}
              placeholder="defaults to 75 m"
              className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
            />
            <span className="block text-[11px] text-ink/50 mt-1">
              Absorbs ordinary GPS error; the number actually tested against is radius + this.
            </span>
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink/85">If a request carries no location at all</span>
          <select
            value={onMissing}
            onChange={(e) => setOnMissing(e.target.value as 'deny' | 'allow')}
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          >
            <option value="deny">Deny (default)</option>
            <option value="allow">Allow</option>
          </select>
          {onMissing === 'allow' ? (
            <p className="text-xs text-terracotta-deep mt-2 leading-relaxed">
              This widens who gets in: anyone can skip this fence entirely just by not sending a
              location — which is what every chat-rail open (WhatsApp, Telegram, Slack, Discord)
              does today. Only choose Allow if this fence needs those to keep working.
            </p>
          ) : (
            <p className="text-[11px] text-ink/50 mt-1">
              Every chat-rail open sends no location today, so this denies all of them at this
              target until you change it.
            </p>
          )}
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink/85">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="e.g. front gate — resident phones only"
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </label>

        {errorMsg && <p className="text-sm text-terracotta-deep">{errorMsg}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
          >
            Cancel
          </button>
          <Button type="submit" variant="ink" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add geofence'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ────────────────────────── Create time window modal ─────────────────────────

type WindowRowState = {
  id: number;
  fromDay: number;
  toDay: number;
  from: string;
  to: string;
  endOfDay: boolean;
};

let windowRowSeq = 0;
function newWindowRow(): WindowRowState {
  windowRowSeq += 1;
  return { id: windowRowSeq, fromDay: 0, toDay: 4, from: '08:00', to: '17:00', endOfDay: false };
}

function rowDaysString(r: WindowRowState): string {
  return r.fromDay === r.toDay ? WEEKDAY_KEYS[r.fromDay] : `${WEEKDAY_KEYS[r.fromDay]}-${WEEKDAY_KEYS[r.toDay]}`;
}

function rowDaysLabel(r: WindowRowState): string {
  return r.fromDay === r.toDay
    ? WEEKDAY_LABELS[r.fromDay]
    : `${WEEKDAY_LABELS[r.fromDay]}–${WEEKDAY_LABELS[r.toDay]}`;
}

function defaultTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

// A short, non-exhaustive pick-list. This is a hint, not a validator — the
// hub is the one thing that decides whether a zone name is real
// (time.LoadLocation), same as it decides everything else on this page.
const COMMON_TZS = [
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
  'UTC',
];

function CreateTimeWindowModal({
  accountId,
  accessPoints,
  locations,
  members,
  onClose,
  onCreated,
}: {
  accountId: string;
  accessPoints: AccessPointDetail[];
  locations: LocationRow[];
  members: AccountMemberRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState<TargetKind>(accessPoints.length > 0 ? 'access_point' : 'location');
  const [targetId, setTargetId] = useState('');
  const [tz, setTz] = useState(defaultTz());
  const [rows, setRows] = useState<WindowRowState[]>([newWindowRow()]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function updateRow(id: number, patch: Partial<WindowRowState>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        // `days` is an inclusive mon..sun range in week order with no
        // wrap-around (timewindows.go) — constrain toDay here so the picker
        // can never express "fri-mon", rather than accept it and refuse it
        // later with a message about a concept the operator never chose.
        if (next.toDay < next.fromDay) next.toDay = next.fromDay;
        return next;
      }),
    );
  }

  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!userId) {
      setErrorMsg('Pick the member this rule applies to.');
      return;
    }
    if (!targetId) {
      setErrorMsg('Pick an access point or a location.');
      return;
    }
    if (!tz.trim()) {
      setErrorMsg('Timezone is required — a window with no zone is meaningless.');
      return;
    }
    if (rows.length === 0) {
      setErrorMsg('Add at least one window, or this rule would deny every open.');
      return;
    }
    for (const r of rows) {
      if (!r.from || (!r.endOfDay && !r.to)) {
        setErrorMsg(`The ${rowDaysLabel(r)} window needs both a start and an end time.`);
        return;
      }
      if (!r.endOfDay && r.from >= r.to) {
        setErrorMsg(
          `The ${rowDaysLabel(r)} window ends before it starts — a window across midnight is written as two windows instead (…–24:00 and 00:00–…).`,
        );
        return;
      }
    }

    const windows: GrantWindow[] = rows.map((r) => ({
      days: rowDaysString(r),
      from: r.from,
      to: r.endOfDay ? '24:00' : r.to,
    }));

    setSubmitting(true);
    try {
      await api.timeWindowCreate(accountId, {
        user_id: userId,
        ...(kind === 'access_point' ? { access_point_id: targetId } : { location_id: targetId }),
        tz: tz.trim(),
        windows,
        note: note.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === 'invalid_time_window'
            ? (err.detail ?? 'That time window is not valid.')
            : err.code === 'time_window_rule_exists'
              ? 'This member already has a rule for this target — remove it first to change it.'
              : err.status === 403
                ? 'You need admin access to create a time-window rule.'
                : (err.detail ?? err.code)
          : err instanceof Error
            ? err.message
            : 'Could not create the rule.';
      setErrorMsg(msg);
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="sm:max-w-2xl">
      <h2 className="font-display text-2xl mb-1">Add a time window</h2>
      <p className="text-sm text-ink/60 mb-5">
        Restricts ONE member to opening during the hours below. This is a statement about a
        person, not the door — nobody else's schedule is affected, and nobody but an admin (and
        the member themself) can see it.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-ink/85">Member</span>
          <select
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          >
            <option value="" disabled>
              {members.length === 0 ? 'None available' : 'Choose a member…'}
            </option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name ?? m.username} ({m.role})
              </option>
            ))}
          </select>
        </label>

        <TargetPicker
          accessPoints={accessPoints}
          locations={locations}
          kind={kind}
          setKind={setKind}
          targetId={targetId}
          setTargetId={setTargetId}
        />

        <label className="block">
          <span className="text-sm font-medium text-ink/85">Timezone</span>
          <input
            list="access-rules-tz-options"
            required
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="e.g. Africa/Johannesburg"
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-ink"
          />
          <datalist id="access-rules-tz-options">
            {COMMON_TZS.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <span className="block text-[11px] text-ink/50 mt-1">
            An IANA name. Every day/time below is read against THIS zone's local clock, correctly
            through daylight-saving changes.
          </span>
        </label>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink/85">When {userId ? 'they' : 'the member'} may open</span>
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, newWindowRow()])}
              className="text-xs underline underline-offset-4 decoration-terracotta text-ink/65 hover:text-ink"
            >
              + Add another window
            </button>
          </div>
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl border border-ink/15 bg-paper-cool p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={r.fromDay}
                    onChange={(e) => updateRow(r.id, { fromDay: Number(e.target.value) })}
                    className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  >
                    {WEEKDAY_LABELS.map((label, i) => (
                      <option key={label} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-ink/45">through</span>
                  <select
                    value={r.toDay}
                    onChange={(e) => updateRow(r.id, { toDay: Number(e.target.value) })}
                    className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  >
                    {WEEKDAY_LABELS.map((label, i) => (
                      <option key={label} value={i} disabled={i < r.fromDay}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      className="ml-auto text-xs text-ink/50 hover:text-terracotta-deep"
                      aria-label={`Remove the ${rowDaysLabel(r)} window`}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    required
                    value={r.from}
                    onChange={(e) => updateRow(r.id, { from: e.target.value })}
                    className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink"
                  />
                  <span className="text-xs text-ink/45">to</span>
                  <input
                    type="time"
                    required={!r.endOfDay}
                    disabled={r.endOfDay}
                    value={r.endOfDay ? '' : r.to}
                    onChange={(e) => updateRow(r.id, { to: e.target.value })}
                    className="h-9 rounded-lg bg-paper border border-ink/15 px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink disabled:opacity-40"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-ink/65 ml-1">
                    <input
                      type="checkbox"
                      checked={r.endOfDay}
                      onChange={(e) => updateRow(r.id, { endOfDay: e.target.checked })}
                      className="accent-ink"
                    />
                    until end of day
                  </label>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            Any window may match (OR); this rule and any location rule that also applies both have
            to allow the open (AND). A window spanning midnight isn't expressible directly — add a
            second window for the hours after 00:00 instead.
          </p>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink/85">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="e.g. cleaner — weekday mornings only"
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </label>

        {errorMsg && <p className="text-sm text-terracotta-deep">{errorMsg}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
          >
            Cancel
          </button>
          <Button type="submit" variant="ink" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add time window'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
