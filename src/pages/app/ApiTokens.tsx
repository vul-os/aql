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
  isUnavailable,
  type ApiTokenCreated,
  type ApiTokenRow,
  type ApiTokenScope,
} from '@/lib/api';
import { fromUnix } from '@/lib/time';

// hub/internal/httpapi/tokens.go has served create/list/revoke since scoped
// tokens shipped; nothing in the console had a client for any of them, then
// api.ts grew api.apiTokens/apiTokenCreate/apiTokenRevoke with nothing
// rendering them. This page is that missing renderer.

// The closed scope set, in the hub's canonical order (store.APITokenScopes).
// Rendered as checkboxes, never a free-text field: the hub 400s on anything
// it doesn't recognise (store.ValidAPITokenScope), so letting someone type a
// scope name would just be a slower way to fail the request.
const ALL_SCOPES: ApiTokenScope[] = ['access:read', 'access:open'];

// Plain descriptions of what each scope actually permits, taken from
// store/tokens.go's own doc comments so this page can't drift from what the
// hub enforces. access:open is the one that moves hardware — the copy says
// so, because a checkbox with no consequence description invites checking
// everything "to be safe".
const SCOPE_INFO: Record<ApiTokenScope, string> = {
  'access:read':
    'List and read access points — status, meters, activity. Structurally incapable of opening anything: no route that moves hardware is registered under this scope.',
  'access:open':
    'Everything access:read can, plus sending open/close to a gate. This is the one that moves physical hardware — a token with it is a spare key.',
};

type TokenStatus = 'live' | 'expired' | 'revoked';

/**
 * A token can, in principle, be both past its expiry and revoked — revoking
 * an already-expired credential is allowed and not unusual (someone cleaning
 * up). Revoked wins in that case: it is the deliberate act, and it is the
 * more specific fact of the two. Expired-but-not-revoked and revoked mean
 * different things to whoever is reading the account's security history, so
 * this is the one place that distinction gets decided.
 */
function tokenStatus(t: ApiTokenRow, nowSec: number): TokenStatus {
  if (t.revoked_at !== null) return 'revoked';
  if (!t.never_expires && t.expires_at !== null && t.expires_at <= nowSec) return 'expired';
  return 'live';
}

const statusLabel: Record<TokenStatus, string> = {
  live: 'active',
  expired: 'expired',
  revoked: 'revoked',
};

const statusTone: Record<TokenStatus, string> = {
  live: 'bg-moss/15 text-moss',
  expired: 'bg-ink/5 text-ink/55',
  revoked: 'bg-terracotta/15 text-terracotta-deep',
};

const scopeChip: Record<ApiTokenScope, string> = {
  'access:read': 'bg-paper-warm text-ink border border-ink/10',
  'access:open': 'bg-terracotta/15 text-terracotta-deep border border-terracotta/25',
};

// Mirrors hub/internal/httpapi/accounts.go's isAdminRole. Not imported from
// anywhere — it's one line of a client-side role string, kept local rather
// than invented as a shared helper for a single call site.
function isAccountAdmin(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

function formatDate(sec: number | null): string {
  return fromUnix(sec)?.toLocaleDateString() ?? '—';
}

// ── list-load state ─────────────────────────────────────────────────────────
//
// Same shape of honesty as src/components/demo/liveState.ts, sized to what
// this route can actually answer. There is no "not configured" state here —
// unlike automations or energy, scoped tokens aren't an optional runtime, so
// a 503 has no special meaning and just falls into `error`. `forbidden` and
// `unsupported` are kept distinct from a generic failure because they are
// different facts a reader needs: a 403 means the hub understands the
// request and refuses it; `unsupported` means this hub predates the route
// entirely (the SPA-fallback trap, see isUnavailable's doc comment in
// api.ts). Collapsing either into "loading failed" would hide which one
// actually happened.
type ListState =
  | { status: 'loading' }
  | { status: 'live'; tokens: ApiTokenRow[] }
  | { status: 'forbidden' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

function classifyListError(err: unknown): ListState {
  if (isUnavailable(err)) return { status: 'unsupported' };
  if (err instanceof ApiError && err.status === 403) return { status: 'forbidden' };
  return { status: 'error', message: friendlyApiError(err, 'The hub could not be reached.') };
}

export default function ApiTokensPage() {
  const { currentAccount, user } = useAuth();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<ApiTokenCreated | null>(null);

  const refresh = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const r = await api.apiTokens(currentAccount.id);
      setState({ status: 'live', tokens: r.api_tokens });
    } catch (err) {
      setState(classifyListError(err));
    }
  }, [currentAccount]);

  useEffect(() => {
    setState({ status: 'loading' });
    refresh();
  }, [refresh]);

  if (!currentAccount) {
    return (
      <>
        <PageHeader kicker="Security" title="API tokens" />
        <Card>
          <p className="text-ink/65 text-sm">No account loaded.</p>
        </Card>
      </>
    );
  }

  const viewerId = user?.id ?? null;
  const viewerIsAdmin = isAccountAdmin(currentAccount.role);

  return (
    <>
      <PageHeader
        kicker="Security"
        title="API tokens"
        description="Scoped credentials for scripts and devices — narrower than your password, and independently revocable. A token can never do more than you yourself can do right now."
        actions={
          <Button variant="ink" onClick={() => setCreating(true)}>
            New token
          </Button>
        }
      />

      {/* Every non-live status gets its own sentence. An empty list is never
          allowed to stand in for a failed, forbidden or unsupported fetch. */}
      {state.status === 'forbidden' && (
        <Card className="mb-6 border-terracotta/40">
          <p className="text-sm text-terracotta-deep">
            This account doesn't allow you to view its API tokens.
          </p>
        </Card>
      )}
      {state.status === 'unsupported' && (
        <Card className="mb-6">
          <p className="text-sm text-ink/65">
            This hub doesn't serve the API tokens routes yet — it's running a build from before
            they existed. Upgrade the hub to manage tokens here.
          </p>
        </Card>
      )}
      {state.status === 'error' && (
        <Card className="mb-6 border-terracotta/40">
          <p className="text-sm text-terracotta-deep">{state.message}</p>
        </Card>
      )}

      {state.status === 'loading' ? (
        <Card>
          <p className="text-ink/55 text-sm">Loading…</p>
        </Card>
      ) : state.status !== 'live' ? null : state.tokens.length === 0 ? (
        <Card>
          <p className="text-ink/65 text-sm">
            No tokens yet — create one to let a script or device authenticate as a narrower
            version of you.
          </p>
        </Card>
      ) : (
        <TokenList
          tokens={state.tokens}
          accountId={currentAccount.id}
          viewerId={viewerId}
          viewerIsAdmin={viewerIsAdmin}
          onChanged={refresh}
        />
      )}

      {creating && (
        <CreateTokenModal
          accountId={currentAccount.id}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setJustCreated(created);
            // Background refresh — the secret modal below owns the screen
            // now, but the row should already be there once it's dismissed.
            refresh();
          }}
        />
      )}

      {justCreated && (
        <TokenSecretModal created={justCreated} onDone={() => setJustCreated(null)} />
      )}
    </>
  );
}

// ── list ─────────────────────────────────────────────────────────────────────

function TokenList({
  tokens,
  accountId,
  viewerId,
  viewerIsAdmin,
  onChanged,
}: {
  tokens: ApiTokenRow[];
  accountId: string;
  viewerId: string | null;
  viewerIsAdmin: boolean;
  onChanged: () => void;
}) {
  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <Card className="p-0 overflow-hidden">
      {/* Mobile: card list, same reasoning as Members.tsx — a six-column
          table doesn't survive a phone width. */}
      <ul className="md:hidden divide-y divide-ink/10">
        {tokens.map((t) => {
          const status = tokenStatus(t, nowSec);
          const canRevoke = viewerIsAdmin || t.user_id === viewerId;
          return (
            <li key={t.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{t.name}</p>
                  <p className="text-xs text-ink/60 mt-0.5 truncate">
                    {t.username}
                    {t.user_id === viewerId && ' · you'}
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${statusTone[status]}`}
                >
                  {statusLabel[status]}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.scopes.map((s) => (
                  <span
                    key={s}
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${scopeChip[s]}`}
                  >
                    {s}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/55">
                <span>Created {formatDate(t.created_at)}</span>
                <span>{t.never_expires ? 'Never expires' : `Expires ${formatDate(t.expires_at)}`}</span>
              </div>
              <div className="mt-3">
                <RevokeAction token={t} accountId={accountId} canRevoke={canRevoke} onChanged={onChanged} />
              </div>
            </li>
          );
        })}
      </ul>

      {/* md+: full table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10">
              {['Name', 'Scopes', 'Owner', 'Created', 'Expires', 'Status', ''].map((c) => (
                <th
                  key={c}
                  className="text-left px-6 py-4 text-[11px] uppercase tracking-[0.18em] text-ink/55 font-normal"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const status = tokenStatus(t, nowSec);
              const canRevoke = viewerIsAdmin || t.user_id === viewerId;
              return (
                <tr
                  key={t.id}
                  className="border-b border-ink/8 last:border-0 hover:bg-paper-warm/40 transition-colors"
                >
                  <td className="px-6 py-4 font-medium">{t.name}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {t.scopes.map((s) => (
                        <span
                          key={s}
                          className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${scopeChip[s]}`}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-ink/70">
                    {t.username}
                    {t.user_id === viewerId && <span className="text-ink/45"> · you</span>}
                  </td>
                  <td className="px-6 py-4 text-ink/65">{formatDate(t.created_at)}</td>
                  <td className="px-6 py-4 text-ink/65">
                    {t.never_expires ? (
                      <span className="text-terracotta-deep">never</span>
                    ) : (
                      formatDate(t.expires_at)
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${statusTone[status]}`}
                    >
                      {statusLabel[status]}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <RevokeAction token={t} accountId={accountId} canRevoke={canRevoke} onChanged={onChanged} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Revoked tokens are shown as revoked, not hidden — a token someone revoked
 * is part of the account's security history, same as a denied open in the
 * audit trail. So this renders a label for a revoked row and only offers the
 * action when there's something left to revoke.
 *
 * `canRevoke` mirrors handleAPITokenRevoke's own rule: the owner may always
 * kill their own token (the "I pasted it into a public repo" path must never
 * require finding an admin), and an account admin may kill any token on the
 * account. Anyone else sees nothing here — same as the hub, which answers
 * them with a 404 rather than a 403 to avoid confirming the token exists.
 */
function RevokeAction({
  token,
  accountId,
  canRevoke,
  onChanged,
}: {
  token: ApiTokenRow;
  accountId: string;
  canRevoke: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (token.revoked_at !== null) {
    return <span className="text-xs text-ink/40">Revoked {formatDate(token.revoked_at)}</span>;
  }
  if (!canRevoke) return <span className="text-ink/25">—</span>;

  async function revoke() {
    if (!confirm(`Revoke "${token.name}"? Anything using it stops authenticating immediately.`)) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.apiTokenRevoke(accountId, token.id);
      onChanged();
    } catch (e) {
      setErr(friendlyApiError(e, 'Could not revoke token.'));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={revoke}
        className="text-xs text-ink/65 hover:text-terracotta-deep underline underline-offset-4 decoration-terracotta disabled:opacity-50"
      >
        {busy ? 'Revoking…' : 'Revoke'}
      </button>
      {err && <span className="text-[11px] text-terracotta-deep">{err}</span>}
    </div>
  );
}

// ── create ───────────────────────────────────────────────────────────────────

function CreateTokenModal({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: (created: ApiTokenCreated) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiTokenScope>>(new Set());
  // Bounded expiry is the default SELECTION, matching defaultTokenTTLDays on
  // the hub — but "never" still has to be an explicit click, never a
  // fallback nobody chose. See the fieldset below.
  const [expiryMode, setExpiryMode] = useState<'days' | 'never'>('days');
  const [days, setDays] = useState('90');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function toggleScope(scope: ApiTokenScope) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setErrorMsg('Name the token so you can tell it apart later.');
      return;
    }
    if (scopes.size === 0) {
      setErrorMsg('Pick at least one scope — a token with none could authenticate but do nothing.');
      return;
    }
    let expiresInDays: number | undefined;
    if (expiryMode === 'days') {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        setErrorMsg('Expiry must be a whole number of days, 1–3650.');
        return;
      }
      expiresInDays = n;
    }

    setSubmitting(true);
    try {
      const created = await api.apiTokenCreate(accountId, {
        name: trimmed,
        scopes: Array.from(scopes),
        ...(expiryMode === 'never' ? { never_expires: true } : { expires_in_days: expiresInDays }),
      });
      onCreated(created);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === 'invalid_token_name'
            ? 'That name is empty or too long (120 characters max).'
            : err.code === 'invalid_scopes'
              ? 'One or more scopes were not recognised by this hub.'
              : err.code === 'invalid_expiry'
                ? 'Expiry must be a whole number of days, 1–3650.'
                : err.code === 'too_many_tokens'
                  ? 'This account already has the maximum number of tokens outstanding. Revoke one before minting another.'
                  : (err.detail ?? err.code)
          : err instanceof Error
            ? err.message
            : 'Could not create token.';
      setErrorMsg(typeof msg === 'string' ? msg : 'Could not create token.');
      setSubmitting(false);
    }
  }

  const neverWithOpen = expiryMode === 'never' && scopes.has('access:open');

  return (
    <Modal open onClose={onClose} className="sm:max-w-lg">
      <h2 className="font-display text-2xl mb-1">New API token</h2>
      <p className="text-sm text-ink/60 mb-5">
        Issued to you, scoped to exactly what you check below. Whatever holds this token can do
        no more than your own account can do right now.
      </p>
      <form onSubmit={onSubmit} className="space-y-5">
        <label className="block">
          <span className="text-sm font-medium text-ink/85">Name</span>
          <input
            type="text"
            required
            autoFocus
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home Assistant"
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-ink/85 mb-2">Scopes</legend>
          <div className="space-y-2">
            {ALL_SCOPES.map((scope) => (
              <label
                key={scope}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                  scopes.has(scope)
                    ? 'bg-ink/5 border-ink'
                    : 'bg-paper-cool border-ink/15 hover:border-ink/35'
                }`}
              >
                <input
                  type="checkbox"
                  checked={scopes.has(scope)}
                  onChange={() => toggleScope(scope)}
                  className="mt-0.5 accent-ink"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-mono">{scope}</span>
                  <span className="block text-xs text-ink/55 mt-0.5">{SCOPE_INFO[scope]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-ink/85 mb-2">Expiry</legend>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setExpiryMode('days')}
              className={`h-10 rounded-xl border text-xs transition-colors ${
                expiryMode === 'days'
                  ? 'bg-ink text-paper border-ink'
                  : 'bg-paper-cool text-ink border-ink/15 hover:border-ink/35'
              }`}
            >
              Expires after N days
            </button>
            <button
              type="button"
              onClick={() => setExpiryMode('never')}
              className={`h-10 rounded-xl border text-xs transition-colors ${
                expiryMode === 'never'
                  ? 'bg-terracotta text-paper border-terracotta'
                  : 'bg-paper-cool text-ink border-ink/15 hover:border-ink/35'
              }`}
            >
              Never expires
            </button>
          </div>
          {expiryMode === 'days' ? (
            <label className="block mt-3">
              <span className="text-xs text-ink/55">Days from now</span>
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="mt-1 w-28 h-10 rounded-xl bg-paper-cool border border-ink/15 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              />
            </label>
          ) : (
            <p className="text-xs text-terracotta-deep mt-3">
              This token will work until someone revokes it — there is no automatic expiry to
              fall back on if it leaks.
              {neverWithOpen &&
                ' Combined with access:open, that is a permanent way to open your gates. A long expiry is usually the safer choice.'}
            </p>
          )}
        </fieldset>

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
            {submitting ? 'Creating…' : 'Create token'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── the one-time secret ──────────────────────────────────────────────────────

/**
 * The single most important screen in this file. tokens.go's doc comment is
 * explicit: the plaintext exists in exactly one place — the body of this
 * 201 — and store/tokens.go's listing query does not even select the columns
 * that would let a "show it again" endpoint exist. If this component fails
 * to make the secret impossible to miss, the person has silently lost it and
 * their only recourse is to revoke and mint another.
 *
 * `onClose` is deliberately wired to a no-op, not to `onDone`: neither
 * Escape nor a backdrop click may dismiss this one by accident. The
 * checkbox + Done button is the only way out, same spirit as
 * TwoFactorActivated's recovery codes.
 */
function TokenSecretModal({ created, onDone }: { created: ApiTokenCreated; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable. The token is still
      // plainly visible and selectable below — that's the fallback, not a
      // failure worth its own error state.
    }
  }

  return (
    <Modal open onClose={() => {}} className="sm:max-w-lg">
      <h2 className="font-display text-2xl mb-1">Token created</h2>
      <p className="text-sm text-terracotta-deep font-medium mt-2">
        This is the only time this secret will ever be shown. There is no "view token" page to
        come back to — the hub never stores the plaintext, so there is nothing left to show you
        the second time. Copy it now.
      </p>

      <div className="mt-4 rounded-xl bg-ink text-paper p-4 font-mono text-sm break-all select-all">
        {created.token}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-ink/55 truncate">
          {created.name} · {created.scopes.join(', ')}
        </span>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 px-3 py-1.5 rounded-full border border-ink/15 hover:border-ink text-sm"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="text-xs text-ink/55 mt-4">
        {created.never_expires
          ? 'Set to never expire — it will keep working until you revoke it.'
          : `Expires ${fromUnix(created.expires_at)?.toLocaleString() ?? '—'}.`}
      </p>

      <label className="mt-5 flex items-start gap-2.5 text-sm text-ink/80 cursor-pointer">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 accent-ink"
        />
        <span>I've copied this token somewhere safe. I understand it won't be shown again.</span>
      </label>

      <div className="flex justify-end mt-6">
        <Button variant="ink" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
