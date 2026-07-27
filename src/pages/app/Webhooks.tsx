// Webhooks — outbound event notifications to an address the operator chooses.
//
// The hub has served /accounts/{id}/webhooks since webhookdispatch.go was
// built (see that file's header) and nothing in this console could reach it —
// api.webhooks/webhookCreate/webhookDelete existed in src/lib/api.ts with no
// page calling them. This is that page.
//
// Three things this screen exists to get right, because the hub's own doc
// comments are explicit that a careless UI here undoes real security work:
//
//   1. The signing secret comes back EXACTLY ONCE, in the create response.
//      hub/internal/httpapi/webhooks.go says it plainly: there is no column
//      in the store's projection for it, so there can never be a "reveal"
//      endpoint later. Losing it means delete-and-recreate. That has to be
//      shown as a fact, not buried in a toast that times out.
//
//   2. A secret with no instructions is useless to a receiver. The signature
//      scheme (hub/internal/httpapi/webhookdispatch.go: HMAC-SHA256 over
//      "timestamp.body", hex, in X-Aql-Signature-256, with X-Aql-Timestamp
//      and X-Aql-Event alongside) is shown right next to the secret, once,
//      because that's the only moment a person configuring this is actually
//      looking at it.
//
//   3. allow_private is a real decision, not a convenience checkbox. It turns
//      off the SSRF guard in hub/internal/httpapi/webhooktarget.go — the
//      thing standing between "operator names a URL" and "hub POSTs signed
//      traffic to the router's admin page, a NAS, or 169.254.169.254". The
//      copy here says what's being switched off in those terms, not
//      "allow private addresses".
//
// A disabled webhook always carries a reason (the dispatcher only retires one
// after webhookMaxFailuresBeforeDisable consecutive failures) — an endpoint
// that went quiet without a reason shown would leave an operator with nothing
// to act on, so the row always surfaces disabled_reason when disabled_at is
// set.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from './AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { ApiError, api, friendlyApiError, type WebhookCreated, type WebhookRow } from '@/lib/api';
import { fromUnix } from '@/lib/time';

// The closed event vocabulary (hub's KnownWebhookEvents in webhookdispatch.go).
// An unknown name is a hard 400 on the hub, so this is rendered as checkboxes
// against a fixed list, never as free text a person could mistype.
const EVENT_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: 'access.opened',
    label: 'access.opened',
    hint: 'Sent after a gate or door actually opens.',
  },
  {
    value: 'access.denied',
    label: 'access.denied',
    hint: 'Sent when an open attempt is refused (quota, suspension, rate limit, etc).',
  },
];

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export default function WebhooksPage() {
  const { currentAccount } = useAuth();
  const [webhooks, setWebhooks] = useState<WebhookRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<WebhookCreated | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdmin = currentAccount?.role === 'owner' || currentAccount?.role === 'admin';

  const refresh = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const r = await api.webhooks(currentAccount.id);
      setWebhooks(r.webhooks);
      setError(null);
      setForbidden(false);
    } catch (err) {
      // A 403 and a genuinely broken fetch are different sentences, and
      // conflating them would tell an ordinary member their hub is broken
      // when it's actually working exactly as designed (webhooks.go's
      // isAdminRole gate). Either way: never fall through to an empty list.
      if (isForbidden(err)) {
        setForbidden(true);
        setError(null);
      } else {
        setForbidden(false);
        setError(friendlyApiError(err, 'Could not load webhooks.'));
      }
      setWebhooks(null);
    }
  }, [currentAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onDelete(hook: WebhookRow) {
    if (!currentAccount) return;
    if (
      !confirm(
        `Delete "${hook.name}"? Its signing secret goes with it — there is no way to bring this webhook back, only to create a new one.`,
      )
    ) {
      return;
    }
    setDeletingId(hook.id);
    try {
      await api.webhookDelete(currentAccount.id, hook.id);
      await refresh();
    } catch (err) {
      alert(friendlyApiError(err, 'Could not delete webhook.'));
    } finally {
      setDeletingId(null);
    }
  }

  if (!currentAccount) {
    return (
      <>
        <PageHeader kicker="Integrations" title="Webhooks" />
        <Card>
          <p className="text-ink/65 text-sm">No account loaded.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker="Integrations"
        title="Webhooks"
        description="A standing instruction to POST a signed record of access events to a URL you choose. Admin-only: this reaches out into whatever network your hub sits on."
        actions={
          isAdmin && (
            <Button variant="ink" onClick={() => setCreating(true)}>
              New webhook
            </Button>
          )
        }
      />

      {forbidden && (
        <Card className="mb-6 border-terracotta/40">
          <p className="text-sm text-terracotta-deep font-medium">Admins only.</p>
          <p className="text-sm text-ink/60 mt-1">
            Your role on this account can't see or manage webhooks. Ask an owner or admin if you
            need one configured.
          </p>
        </Card>
      )}

      {error && (
        <Card className="mb-6 border-terracotta/40">
          <p className="text-sm text-terracotta-deep">{error}</p>
        </Card>
      )}

      {!forbidden && !error && webhooks === null && (
        <Card>
          <p className="text-ink/55 text-sm">Loading…</p>
        </Card>
      )}

      {!forbidden && !error && webhooks !== null && (
        webhooks.length === 0 ? (
          <Card>
            <p className="text-ink/65 text-sm">
              No webhooks yet. The hub has been able to deliver these since webhook dispatch
              shipped — nothing has been configured to receive one.
            </p>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-ink/8">
              {webhooks.map((w) => {
                const disabled = (w.disabled_at ?? 0) > 0;
                return (
                  <li key={w.id} className="p-6 flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{w.name}</span>
                        {disabled ? (
                          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] bg-terracotta/15 text-terracotta-deep">
                            Disabled by the hub
                          </span>
                        ) : w.enabled ? (
                          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] bg-paper-warm text-ink border border-ink/10">
                            Enabled
                          </span>
                        ) : null}
                        {w.allow_private && (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] bg-gold/30 text-ink"
                            title="The SSRF guard is off for this endpoint — it may target loopback, link-local, private, or carrier-grade-NAT addresses."
                          >
                            Private targets allowed
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm text-ink/70 font-mono break-all">{w.url}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {w.events.map((e) => (
                          <span
                            key={e}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] bg-ink/5 text-ink/70"
                          >
                            {e}
                          </span>
                        ))}
                      </div>
                      {/* disabled_at is present ONLY when the dispatcher retired this
                          endpoint after repeated failures, and always with a reason —
                          see webhooks.go's webhookJSON. Surfacing one without the
                          other would leave an operator nothing to act on. */}
                      {disabled && (
                        <p className="mt-2 text-xs text-terracotta-deep">
                          {w.disabled_reason || 'Disabled after repeated failed deliveries.'}
                          {w.disabled_at && (
                            <> &middot; {fromUnix(w.disabled_at)?.toLocaleString() ?? '—'}</>
                          )}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-ink/45">
                        Created {fromUnix(w.created_at)?.toLocaleDateString() ?? '—'}
                      </p>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => onDelete(w)}
                        disabled={deletingId === w.id}
                        className="shrink-0 h-9 px-4 rounded-full text-sm text-terracotta-deep border border-terracotta/30 hover:bg-terracotta/5 disabled:opacity-50"
                      >
                        {deletingId === w.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )
      )}

      {creating && (
        <CreateWebhookModal
          accountId={currentAccount.id}
          onClose={() => setCreating(false)}
          onCreated={(w) => {
            setCreating(false);
            setCreated(w);
            refresh();
          }}
        />
      )}

      {created && <SecretModal webhook={created} onClose={() => setCreated(null)} />}
    </>
  );
}

function CreateWebhookModal({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: (w: WebhookCreated) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<string>>(new Set(['access.opened']));
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function toggleEvent(value: string) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (events.size === 0) {
      setErrorMsg('Pick at least one event — a subscription to nothing never fires.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.webhookCreate(accountId, {
        name: name.trim(),
        url: url.trim(),
        events: Array.from(events),
        allow_private: allowPrivate,
      });
      onCreated(result);
    } catch (err) {
      setErrorMsg(friendlyApiError(err, 'Could not create webhook.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-2xl mb-1">New webhook</h2>
      <p className="text-sm text-ink/60 mb-5">
        The hub will POST a signed JSON body to this URL for every event you pick below. The
        signing secret is shown once, right after you create this — there is no way to see it
        again afterwards.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-ink/85">Name</span>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home Assistant"
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink/85">URL</span>
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/aql"
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-ink"
          />
          <p className="text-[11px] text-ink/50 mt-1">
            Must be reachable from the hub itself, not from your browser. http:// only works
            alongside "Allow private targets" below.
          </p>
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-ink/85 mb-2">Events</legend>
          <div className="space-y-2">
            {EVENT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-3 rounded-xl border border-ink/15 px-4 py-3 cursor-pointer hover:border-ink/30"
              >
                <input
                  type="checkbox"
                  checked={events.has(opt.value)}
                  onChange={() => toggleEvent(opt.value)}
                  className="mt-0.5 h-4 w-4 accent-ink"
                />
                <span>
                  <span className="block text-sm font-mono text-ink">{opt.label}</span>
                  <span className="block text-xs text-ink/55 mt-0.5">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-3 rounded-xl border border-gold/50 bg-gold/10 px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allowPrivate}
            onChange={(e) => setAllowPrivate(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-ink"
          />
          <span className="text-xs text-ink/75 leading-relaxed">
            <span className="block font-medium text-ink text-sm mb-0.5">
              Allow private targets
            </span>
            This turns off the hub's guard against targeting your own network: without it, the
            hub refuses URLs that point at loopback (127.0.0.1), link-local addresses (including
            169.254.169.254 — the cloud metadata address), private ranges (192.168.x.x,
            10.x.x.x, 172.16–31.x.x), and carrier-grade NAT (100.64.0.0/10). Turn this on only if
            you're deliberately pointing at something on your own LAN, like a Home Assistant
            instance — it's what lets the hub reach it, and it's also what an attacker would need
            to turn your hub into a forwarder against your own network.
          </span>
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
            {submitting ? 'Creating…' : 'Create webhook'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SecretModal({ webhook, onClose }: { webhook: WebhookCreated; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(webhook.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    // Not a dismissable toast, and no auto-close: this is the only moment
    // this secret will ever be on screen. onClose here only hides the modal —
    // it never re-fetches or re-derives the secret, because there is nowhere
    // to re-derive it from (see webhooks.go: the store's projection has no
    // column for it).
    <Modal open onClose={onClose}>
      <h2 className="font-display text-2xl mb-1">"{webhook.name}" created</h2>
      <p className="text-sm font-medium text-terracotta-deep mb-4">
        This is the only time the signing secret will ever be shown. It cannot be retrieved
        again — if you lose it, delete this webhook and create a new one.
      </p>

      <div className="rounded-xl bg-ink text-paper p-4 font-mono text-sm break-all">
        {webhook.secret}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-ink/55">256-bit, hex-encoded</span>
        <button
          type="button"
          onClick={copy}
          className="px-3 py-1.5 rounded-full border border-ink/15 hover:border-ink text-sm"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="mt-6 rounded-xl border border-ink/10 bg-paper-cool p-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink/55 mb-2">
          How to verify a delivery
        </p>
        <p className="text-sm text-ink/75 leading-relaxed">
          Every request the hub sends carries three headers:
        </p>
        <ul className="mt-2 space-y-1.5 text-sm font-mono text-ink/80">
          <li><span className="text-ink/50">X-Aql-Event:</span> the event name, e.g. access.opened</li>
          <li><span className="text-ink/50">X-Aql-Timestamp:</span> unix seconds when it was sent</li>
          <li><span className="text-ink/50">X-Aql-Signature-256:</span> hex HMAC-SHA256, see below</li>
        </ul>
        <p className="mt-3 text-sm text-ink/75 leading-relaxed">
          To check a delivery is genuine: compute HMAC-SHA256, keyed with the secret above, over
          the exact bytes{' '}
          <code className="font-mono text-ink bg-ink/5 rounded px-1">
            {'{timestamp}.{raw request body}'}
          </code>{' '}
          — the timestamp header, a literal period, then the request body exactly as received,
          unparsed. Hex-encode the result and compare it to X-Aql-Signature-256. The timestamp is
          inside the signed bytes, not just alongside them, so it can't be swapped without
          invalidating the signature.
        </p>
        <p className="mt-2 text-sm text-ink/75 leading-relaxed">
          The hub does not enforce a skew window on the receiving end — if you want replay
          protection, reject deliveries whose X-Aql-Timestamp is older than you're willing to
          accept. It's on your side to check.
        </p>
      </div>

      <div className="flex justify-end mt-6">
        <Button variant="ink" onClick={onClose}>
          I've saved it
        </Button>
      </div>
    </Modal>
  );
}
