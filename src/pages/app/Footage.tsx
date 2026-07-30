// Recorded footage, and the record of who watched it.
//
// docs/CAMERA-RETENTION.md §2.4 and §2.5. Two things about this screen are
// deliberate and would look like bugs without the policy behind them:
//
//   1. Being an account owner does not let you watch. `camera:view` is a
//      per-member, per-camera grant, and it is NOT implied by owner or admin —
//      because "can configure the hub" and "can watch the other residents" are
//      different authorities, and the owner of a shared house's hub is usually
//      just whoever set it up. A 403 here is the design working.
//   2. The access log is visible to EVERY member, not only admins. The people
//      most affected by footage must not be the only ones who cannot check who
//      watched it.

import { useCallback, useEffect, useState } from 'react';

import {
  api,
  friendlyApiError,
  type AccountMemberRow,
  type CameraAccessEntry,
  type CameraClip,
  type CameraViewGrant,
  type EngineDevice,
} from '@/lib/api';
import { PageHeader } from '@/pages/app/AppLayout';
import { Card } from '@/components/ui/Card';
import { ListStateCard, listLoading, loadList, type ListState } from '@/components/ui/ListState';
import { useAuth } from '@/lib/auth';
import { LiveView } from '@/components/camera/LiveView';

function when(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return seconds % 60 ? `${m}m ${seconds % 60}s` : `${m}m`;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Footage() {
  const { currentAccount } = useAuth();
  const accountId = currentAccount?.id ?? null;

  const [cameras, setCameras] = useState<ListState<EngineDevice>>(listLoading);
  const [selected, setSelected] = useState<string | null>(null);
  const [clips, setClips] = useState<ListState<CameraClip>>(listLoading);
  const [denied, setDenied] = useState(false);
  const [access, setAccess] = useState<ListState<CameraAccessEntry>>(listLoading);
  const [grants, setGrants] = useState<CameraViewGrant[] | null>(null);
  const [members, setMembers] = useState<AccountMemberRow[]>([]);
  const [grantErr, setGrantErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const isAdmin = currentAccount?.role === 'owner' || currentAccount?.role === 'admin';

  const loadCameras = useCallback(async () => {
    setCameras(
      await loadList<EngineDevice>(
        async () => (await api.engineDevices()).devices.filter((d) => d.kind === 'camera'),
        'Could not load cameras.',
        friendlyApiError,
      ),
    );
  }, []);

  const loadClips = useCallback(async (acct: string, key: string) => {
    setDenied(false);
    setClips(listLoading);
    try {
      const res = await api.cameraClips(acct, key);
      setClips({ status: 'ready', items: res.clips });
    } catch (err) {
      // A 403 here is not a failure to report as one: it means this member has
      // no camera:view grant for this camera, which is the default state on a
      // fresh install and is what the policy intends.
      const code = (err as { code?: string })?.code;
      if (code === 'camera_view_required') {
        setDenied(true);
        setClips({ status: 'ready', items: [] });
        return;
      }
      setClips({ status: 'failed', message: 'Could not load this camera’s footage.' });
    }
  }, []);

  const loadAccess = useCallback(async (acct: string) => {
    setAccess(
      await loadList<CameraAccessEntry>(
        async () => (await api.cameraAccessLog(acct)).access,
        'Could not load the camera access log.',
        friendlyApiError,
      ),
    );
  }, []);

  // Admin-only, and it fails quietly for everyone else: a member seeing an
  // empty grants panel is correct, and a member seeing an error about a panel
  // that is not theirs is noise.
  const loadGrants = useCallback(async (acct: string) => {
    setGrantErr(null);
    try {
      const [g, m] = await Promise.all([api.cameraViewGrants(acct), api.accountMembers(acct)]);
      setGrants(g.grants);
      setMembers(m.members.filter((x) => x.status === 'active'));
    } catch {
      setGrants(null);
    }
  }, []);

  useEffect(() => {
    void loadCameras();
  }, [loadCameras]);

  useEffect(() => {
    if (accountId && isAdmin) void loadGrants(accountId);
  }, [accountId, isAdmin, loadGrants]);

  useEffect(() => {
    if (accountId) void loadAccess(accountId);
  }, [accountId, loadAccess]);

  useEffect(() => {
    if (accountId && selected) void loadClips(accountId, selected);
  }, [accountId, selected, loadClips]);

  return (
    <>
      <PageHeader
        kicker="Cameras"
        title="Footage"
        description="Recorded clips, and the record of who has watched them. Watching requires an explicit per-camera permission — being an account admin does not grant it."
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card>
          <div className="p-4">
            <h2 className="text-sm font-semibold mb-3">Cameras</h2>
            {cameras.status !== 'ready' || cameras.items.length === 0 ? (
              <ListStateCard
                state={cameras}
                loadingMessage="Loading cameras…"
                emptyMessage="No cameras. A camera appears here once a driver has discovered it and an admin has claimed it."
                onRetry={() => void loadCameras()}
              />
            ) : (
              <ul className="space-y-1">
                {cameras.items.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(c.key)}
                      className={`w-full text-left rounded-lg px-3 py-2 text-sm ${
                        selected === c.key ? 'bg-ink text-paper' : 'hover:bg-ink/5'
                      }`}
                    >
                      {c.name || c.key}
                      {c.zone && <span className="block text-xs opacity-70">{c.zone}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">
                {selected ? 'Clips' : 'Select a camera'}
              </h2>
              {selected && !denied && (
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => {
                    setLive((v) => !v);
                    setPlaying(null);
                  }}
                >
                  {live ? 'Stop live view' : 'Watch live'}
                </button>
              )}
            </div>

            {selected && live && accountId && !denied && (
              <div className="mb-3">
                <LiveView url={api.cameraLiveURL(accountId, selected)} />
              </div>
            )}

            {selected && denied && (
              // Stated as a permission fact, not as an error. On a fresh install
              // nobody has this permission, and recording with no viewer is a
              // valid state — the clips exist for an incident.
              <p className="text-sm rounded-md bg-gold/20 px-3 py-2">
                You do not have <code>camera:view</code> for this camera, so its footage is not
                shown. This permission is granted per member per camera by an account admin, and
                is deliberately not implied by being an owner or admin — an attempt to view was
                recorded.
              </p>
            )}

            {selected && !denied && (
              clips.status !== 'ready' || clips.items.length === 0 ? (
                <ListStateCard
                  state={clips}
                  loadingMessage="Loading footage…"
                  emptyMessage="No clips recorded for this camera yet."
                  onRetry={() => accountId && void loadClips(accountId, selected)}
                />
              ) : (
                <>
                {playing && accountId && selected && (
                  // A plain <video src>. Each clip is a self-contained
                  // fragmented MP4, which is the entire reason the muxer writes
                  // that container: no plugin, no transcode, no Media Source
                  // plumbing. The element issues Range requests and the hub
                  // answers them.
                  <video
                    key={playing}
                    src={api.cameraClipURL(accountId, selected, playing)}
                    controls
                    autoPlay
                    className="w-full rounded-lg bg-ink mb-3"
                  />
                )}
                <ul className="divide-y divide-ink/10 text-sm">
                  {clips.items.map((c) => (
                    <li key={c.id} className="py-2 flex items-baseline justify-between gap-3">
                      <span className={c.deleted_at ? 'text-ink/45' : ''}>
                        {when(c.started_at)}
                      </span>
                      {c.deleted_at ? (
                        // §2.6: a dropped evening reads as dropped. An empty list
                        // would be indistinguishable from a camera that never
                        // recorded, which is the thing the policy forbids.
                        <span className="text-xs text-ink/55">
                          {c.deleted_why === 'missing'
                            ? 'removed from disk'
                            : 'dropped by retention'}{' '}
                          · {when(c.deleted_at)}
                        </span>
                      ) : (
                        <span className="text-xs text-ink/55 flex items-center gap-3">
                          {duration(c.duration_s)} · {size(c.size_bytes)}
                          <button
                            type="button"
                            className="text-ink underline"
                            onClick={() => setPlaying(c.id)}
                          >
                            Watch
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                </>
              )
            )}
          </div>
        </Card>
      </div>

      {isAdmin && (
        <Card>
          <div className="p-4">
            <h2 className="text-sm font-semibold">Who may watch</h2>
            <p className="text-xs text-ink/60 mt-1 mb-3">
              <code>camera:view</code> is granted per member, per camera. It is deliberately not
              implied by owner or admin — including for you. Granting it is recorded in the audit
              log.
            </p>

            {selected ? (
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <label className="text-sm">
                  <span className="block text-xs text-ink/60">Member</span>
                  <select
                    id="grant-member"
                    className="mt-1 h-10 rounded-lg border border-ink/15 px-3 text-sm bg-paper-cool"
                  >
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name || m.username}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="h-10 rounded-lg bg-ink text-paper px-4 text-sm"
                  onClick={() => {
                    if (!accountId || !selected) return;
                    const el = document.getElementById('grant-member') as HTMLSelectElement | null;
                    if (!el?.value) return;
                    void api
                      .cameraViewGrant(accountId, { user_id: el.value, device_key: selected })
                      .then(() => loadGrants(accountId))
                      .catch((e) => setGrantErr(friendlyApiError(e, 'Could not grant access.')));
                  }}
                >
                  Grant on this camera
                </button>
              </div>
            ) : (
              <p className="text-xs text-ink/55 mb-3">Select a camera to grant access to it.</p>
            )}

            {grantErr && <p className="text-sm text-terracotta-deep mb-2">{grantErr}</p>}

            {grants && grants.length > 0 ? (
              <ul className="divide-y divide-ink/10 text-sm">
                {grants.map((g) => (
                  <li
                    key={`${g.user_id}-${g.device_key}`}
                    className="py-2 flex items-baseline justify-between gap-3"
                  >
                    <span className={g.revoked ? 'text-ink/45 line-through' : ''}>
                      {g.username || g.user_id} <span className="text-ink/55">· {g.device_key}</span>
                    </span>
                    {g.revoked ? (
                      // Revoked grants stay listed: "who could watch, and between
                      // when and when" has to remain answerable after the fact.
                      <span className="text-xs text-ink/55">revoked</span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-terracotta-deep"
                        onClick={() => {
                          if (!accountId) return;
                          void api
                            .cameraViewRevoke(accountId, g.user_id, g.device_key)
                            .then(() => loadGrants(accountId))
                            .catch((e) =>
                              setGrantErr(friendlyApiError(e, 'Could not revoke access.')),
                            );
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink/55">
                Nobody can watch any camera on this account. That is the default, and recording
                with no viewer is a valid state — the clips exist for an incident.
              </p>
            )}
          </div>
        </Card>
      )}

      <Card>
        <div className="p-4">
          <h2 className="text-sm font-semibold">Who has watched</h2>
          <p className="text-xs text-ink/60 mt-1 mb-3">
            Every view and every refused attempt, for every camera on this account. Visible to
            every member — not only admins.
          </p>
          {access.status !== 'ready' || access.items.length === 0 ? (
            <ListStateCard
              state={access}
              loadingMessage="Loading the access log…"
              emptyMessage="Nobody has viewed footage on this account."
              onRetry={() => accountId && void loadAccess(accountId)}
            />
          ) : (
            <ul className="divide-y divide-ink/10 text-sm">
              {access.items.map((a, i) => (
                <li key={`${a.at}-${i}`} className="py-2 flex items-baseline justify-between gap-3">
                  <span>
                    {a.username || 'a removed member'}{' '}
                    <span className="text-ink/55">· {a.device_key}</span>
                  </span>
                  <span className="text-xs text-ink/55">{when(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
