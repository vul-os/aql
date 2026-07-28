import TwoFactorSection from '@/components/settings/TwoFactorSection';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from './AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Avatar, resolveAvatarUrl } from '@/components/ui/Avatar';
import {
  ApiError,
  api,
  friendlyApiError,
  isUnavailable,
  type ChannelLinkCode,
  type LinkableChannel,
  type LinkedChannelIdentity,
  type LinkedPhone,
  type LocationRow,
  type PhoneLinkCode,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getApiBaseUrl, getStoredGatewayUrl, isTauri, openGatewayPicker } from '@/lib/hub';

export default function Settings() {
  const { currentAccount, user } = useAuth();

  return (
    <>
      <PageHeader
        kicker="Settings"
        title={currentAccount?.name ?? 'Settings'}
        description={
          'Rename or remove this location, and manage your account password.'
        }
      />
      <div className="grid grid-cols-1 gap-6 max-w-3xl">
        <ProfileSection />
        <PhoneNumbersSection />
        <ChatAccountsSection />
        <LocationsSection />
        <PasswordSection />
        <TwoFactorSection />
        <GatewaySection />
      </div>
    </>
  );
}

// Which gateway this portal talks to. On desktop (and for anyone who has
// explicitly picked one) this is where you point the app somewhere else;
// changing it signs you out of the current gateway.
function GatewaySection() {
  const custom = getStoredGatewayUrl() !== null;
  return (
    <Card>
      <h2 className="font-display text-2xl">Hub</h2>
      <p className="text-sm text-ink/65 mt-1">
        {isTauri()
          ? 'The Aql hub this desktop app is connected to.'
          : 'The Aql hub this console is connected to.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <code className="rounded-xl bg-paper-cool border border-ink/10 px-4 py-2.5 text-[13.5px] text-ink/85 break-all">
          {getApiBaseUrl()}
        </code>
        <span className="text-xs text-ink/45">{custom ? 'custom' : 'default'}</span>
      </div>
      <p className="mt-3 text-sm text-ink/60">
        Switching hubs signs you out here — your account stays on its hub.
      </p>
      <div className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={openGatewayPicker}>
          Change hub
        </Button>
      </div>
    </Card>
  );
}

function ProfileSection() {
  const { user, refreshMe } = useAuth();
  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Keep local state in sync when the user record refreshes.
  useEffect(() => { setDisplayName(user?.name ?? ''); }, [user?.name]);
  useEffect(() => { setAvatarUrl(user?.avatar_url ?? ''); }, [user?.avatar_url]);

  const sourceLabel = user?.avatar_source === 'user' ? 'Set by you' : 'No avatar set';

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setErrorMsg(null);
    const trimmedName = displayName.trim();
    const trimmedUrl = avatarUrl.trim();

    if (trimmedName.length === 0) {
      setErrorMsg('Display name cannot be empty.');
      return;
    }
    if (trimmedUrl.length > 0 && !/^https:\/\//i.test(trimmedUrl)) {
      setErrorMsg('Avatar URL must start with https://');
      return;
    }

    setSaving(true);
    try {
      const body: { display_name?: string; avatar_url?: string | null } = {};
      if (trimmedName !== (user?.name ?? '')) body.display_name = trimmedName;
      if (trimmedUrl !== (user?.avatar_url ?? '')) {
        body.avatar_url = trimmedUrl.length === 0 ? null : trimmedUrl;
      }
      if (Object.keys(body).length === 0) {
        setMessage('Nothing to save.');
      } else {
        await api.profileUpdate(body);
        await refreshMe();
        setMessage('Profile saved.');
      }
    } catch (err) {
      setErrorMsg(toApiMessage(err, 'Could not save profile.'));
    } finally {
      setSaving(false);
    }
  }

  async function clearAvatar() {
    setMessage(null);
    setErrorMsg(null);
    setSaving(true);
    try {
      await api.profileUpdate({ avatar_url: null });
      await refreshMe();
      setMessage('Avatar cleared.');
    } catch (err) {
      setErrorMsg(toApiMessage(err, 'Could not clear the avatar.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-xl mb-1">Your profile</h2>
      <p className="text-sm text-ink/55 mb-5">
        How you appear inside Aql. Avatar can be any https URL — Gravatar, a hosted
        image, anywhere. The hub stores the URL, never the picture.
      </p>

      <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 gap-y-5 items-start">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <Avatar
            url={avatarUrl.trim() || resolveAvatarUrl(user) || null}
            name={displayName || user?.username || null}
            size="xl"
            toneClass="bg-ink text-paper"
          />
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/45 max-w-[160px] text-center sm:text-left leading-snug">
            {sourceLabel}
          </span>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-ink/85 block mb-1.5">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={80}
              className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink/40"
            />
          </label>

          {/* The hint sits OUTSIDE the label on purpose. Nested inside it, the
              accessible name of this field became "Avatar URL https only ·
              leave empty for none" — a screen reader announces the whole thing
              as the field's name, and nothing can address the field by the name
              a person would use. It belongs in aria-describedby, which is what
              a hint is for. */}
          <div className="block">
            <div className="flex items-baseline justify-between mb-1.5">
              <label htmlFor="avatar-url" className="text-sm font-medium text-ink/85">
                Avatar URL
              </label>
              <span id="avatar-url-hint" className="text-xs text-ink/45">
                https only · leave empty for none
              </span>
            </div>
            <input
              id="avatar-url"
              aria-describedby="avatar-url-hint"
              type="url"
              inputMode="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/me.png"
              maxLength={1024}
              className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] text-ink placeholder:text-ink/35 focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink/40"
            />
          </div>

          {message && <p className="text-sm text-moss" role="status">{message}</p>}
          {errorMsg && <p className="text-sm text-terracotta-deep" role="alert">{errorMsg}</p>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="submit" variant="ink" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
            {user?.avatar_source === 'user' && (
              <button
                type="button"
                onClick={clearAvatar}
                disabled={saving}
                className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
              >
                Clear avatar
              </button>
            )}
          </div>
        </div>
      </form>
    </Card>
  );
}

// Phone numbers: the ceremony that proves a number belongs to this account
// (docs/PHONE-LINKING.md, hub/internal/httpapi/phones.go).
//
// The hub has owned phone→member mapping since migration 0002 — it's how a
// WhatsApp message gets resolved to a member who may open a gate — but every
// chat-rail lookup requires a VERIFIED number (store/channels.go), and an
// unverified one is not a weaker version of a linked number: it does nothing.
// A member whose messages to the gate bot go silently ignored has almost
// always landed here first, which is why "verified" has to be impossible to
// miss rather than a footnote next to the number.
//
// The ceremony itself: mint a code here, send it to the gate bot from the
// phone being linked, the WhatsApp webhook redeems it. Nothing here can mark
// a number verified directly — that would be exactly the self-service
// shortcut PHONE-LINKING.md rules out (link it unverified and it's useless;
// link it verified and anyone can claim a neighbour's number).
const PHONE_E164 = /^\+[1-9][0-9]{6,14}$/;

function PhoneNumbersSection() {
  const [phones, setPhones] = useState<LinkedPhone[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [linking, setLinking] = useState<PhoneLinkCode | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.phonesList();
      setPhones(r.phones);
      setLoadError(null);
      setUnavailable(false);
    } catch (err) {
      if (isUnavailable(err)) {
        // An older, self-hosted hub build predating phone linking. Say so
        // rather than showing a form that can only 404.
        setUnavailable(true);
        setPhones([]);
        return;
      }
      setLoadError(friendlyApiError(err, 'Could not load linked numbers.'));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The ceremony completes over the WhatsApp webhook, not this tab — nothing
  // pushes this screen a notice when a code is redeemed, so while one is
  // outstanding, poll for it rather than making the member refresh the page
  // to find out whether their message arrived.
  useEffect(() => {
    if (!linking) return;
    const id = setInterval(async () => {
      try {
        const r = await api.phonesList();
        setPhones(r.phones);
        if (r.phones.some((p) => p.phone_e164 === linking.phone_e164 && p.verified)) {
          setLinking(null);
        }
      } catch {
        // A failed background poll isn't worth surfacing — the next tick, or
        // a manual refresh of the page, still catches up.
      }
    }, 4000);
    return () => clearInterval(id);
  }, [linking]);

  return (
    <Card>
      <h2 className="font-display text-2xl">Phone numbers</h2>
      <p className="text-sm text-ink/65 mt-1">
        The numbers this account is recognised by on WhatsApp and the other chat rails. A number
        only works once it&rsquo;s verified — an unverified one is why a message to the gate bot
        gets ignored.
      </p>

      {unavailable && (
        <p className="mt-4 text-sm text-ink/55">This hub doesn&rsquo;t serve phone linking yet.</p>
      )}

      {loadError && (
        <p className="mt-4 text-sm text-terracotta-deep" role="alert">
          {loadError}
        </p>
      )}

      {phones === null && !loadError && !unavailable && (
        <p className="mt-6 text-sm text-ink/55">Loading…</p>
      )}

      {phones && !unavailable && (
        <ul className="mt-6 divide-y divide-ink/10 -mx-1">
          {phones.length === 0 && (
            <li className="px-1 py-3 text-sm text-ink/65">No numbers linked yet.</li>
          )}
          {phones.map((p) => (
            <PhoneRowItem key={p.id} phone={p} onChanged={refresh} />
          ))}
        </ul>
      )}

      {!unavailable &&
        (linking ? (
          <LinkCodePanel linkCode={linking} onDone={() => setLinking(null)} />
        ) : (
          <StartLinkForm onStarted={setLinking} />
        ))}
    </Card>
  );
}

function PhoneRowItem({
  phone,
  onChanged,
}: {
  phone: LinkedPhone;
  onChanged: () => Promise<void> | void;
}) {
  const [unlinking, setUnlinking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function unlink() {
    setErrorMsg(null);
    setUnlinking(true);
    try {
      await api.phoneUnlink(phone.id);
      await onChanged();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError && err.code === 'phone_not_found'
          ? 'Already unlinked.'
          : friendlyApiError(err, 'Could not unlink this number.'),
      );
      setUnlinking(false);
    }
  }

  return (
    <li className="px-1 py-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink font-mono">{phone.phone_e164}</span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
              phone.verified ? 'bg-moss/15 text-moss' : 'bg-gold/20 text-ink/80'
            }`}
          >
            {phone.verified ? 'Verified' : 'Not verified'}
          </span>
          {phone.is_primary && (
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] bg-paper-warm text-ink border border-ink/10">
              Primary
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={unlink}
          disabled={unlinking}
          className="text-xs text-terracotta-deep hover:underline underline-offset-4 shrink-0"
        >
          {unlinking ? 'Unlinking…' : 'Unlink'}
        </button>
      </div>
      {!phone.verified && (
        <p className="mt-2 text-sm text-ink/60">
          Not verified — messages from this number to the gate bot are ignored until it is. Finish
          linking it below.
        </p>
      )}
      {errorMsg && (
        <p className="mt-2 text-sm text-terracotta-deep" role="alert">
          {errorMsg}
        </p>
      )}
    </li>
  );
}

function StartLinkForm({ onStarted }: { onStarted: (code: PhoneLinkCode) => void }) {
  const [phone, setPhone] = useState('+27');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const trimmed = phone.trim();
    if (!PHONE_E164.test(trimmed)) {
      setErrorMsg('Phone must be E.164 format, e.g. +27821234567.');
      return;
    }
    setSubmitting(true);
    try {
      const code = await api.phoneLinkStart(trimmed);
      onStarted(code);
    } catch (err) {
      setErrorMsg(linkStartErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 pt-6 border-t border-ink/10 flex flex-col sm:flex-row sm:items-end gap-3"
    >
      <label className="block flex-1 max-w-[240px]">
        <span className="text-sm font-medium text-ink/85 block mb-1.5">Link a number</span>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+27821234567"
          className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-ink"
        />
      </label>
      <Button type="submit" variant="ink" disabled={submitting}>
        {submitting ? 'Starting…' : 'Get a link code'}
      </Button>
      {errorMsg && (
        <p className="text-sm text-terracotta-deep sm:pb-2.5" role="alert">
          {errorMsg}
        </p>
      )}
    </form>
  );
}

function linkStartErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'invalid_phone') {
      return "That doesn't look like a valid phone number. Use E.164 format, e.g. +27821234567.";
    }
    if (err.code === 'phone_verified_elsewhere') {
      // Deliberately does not suggest retrying or contacting support in
      // general terms: moving a verified number is a decision an
      // administrator has to make, not something this screen can resolve.
      return 'That number is already verified on another account. Moving a verified number needs an administrator — this screen can’t do it for you.';
    }
    if (err.code === 'too_many_link_codes') {
      return 'Too many link codes requested for this account recently. Wait a while before trying again.';
    }
  }
  return friendlyApiError(err, 'Could not start linking this number.');
}

/** Seconds remaining until `expiresAt` (Unix seconds), ticking every second.
 *  Never negative, so callers can treat 0 as "expired" without a second check. */
function useCountdown(expiresAt: number): number {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
  );
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, expiresAt - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return remaining;
}

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function LinkCodePanel({ linkCode, onDone }: { linkCode: PhoneLinkCode; onDone: () => void }) {
  const remaining = useCountdown(linkCode.expires_at);
  const expired = remaining <= 0;
  const [copied, setCopied] = useState(false);

  function copyCode() {
    navigator.clipboard
      .writeText(linkCode.code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  }

  return (
    <div className="mt-6 pt-6 border-t border-ink/10 space-y-4">
      <div className="rounded-xl bg-ink text-paper p-4">
        <p className="text-sm font-medium mb-2">Your link code</p>
        <div className="flex items-center justify-between gap-3">
          <code className="font-mono text-2xl tracking-[0.2em]">{linkCode.code}</code>
          <button
            type="button"
            onClick={copyCode}
            className="shrink-0 px-3 py-1.5 rounded-full border border-white/25 hover:border-white text-xs"
          >
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
        {/* The hub's own wording — never re-composed here, so it can't drift
            from the number the chat rail is actually listening for. */}
        <p className="text-sm text-paper/80 mt-3">{linkCode.instruction}</p>
      </div>

      {expired ? (
        <p className="text-sm text-terracotta-deep" role="alert">
          This code has expired. Start over to get a new one.
        </p>
      ) : (
        <p className="text-sm text-ink/65">
          Waiting for that message to arrive — this updates on its own once it does, no need to
          refresh. Expires in {formatMmSs(remaining)}.
        </p>
      )}

      <button
        type="button"
        onClick={onDone}
        className="text-sm text-ink/65 hover:text-ink underline underline-offset-4"
      >
        {expired ? 'Start over' : 'Cancel'}
      </button>
    </div>
  );
}

// Telegram/Slack/Discord accounts (hub/internal/httpapi/channellink.go).
//
// WhatsApp is deliberately NOT offered here. Its identity is a verified phone
// number handled by PhoneNumbersSection above, and that ceremony is stronger:
// a phone code is bound to the number that may spend it. Offering WhatsApp a
// second, weaker route to the same access would be a downgrade wearing the
// same button.
const LINKABLE_CHANNELS: { value: LinkableChannel; label: string }[] = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'slack', label: 'Slack' },
  { value: 'discord', label: 'Discord' },
];

function channelLabel(channel: string): string {
  return LINKABLE_CHANNELS.find((c) => c.value === channel)?.label ?? channel;
}

function ChatAccountsSection() {
  const [identities, setIdentities] = useState<LinkedChannelIdentity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [linking, setLinking] = useState<ChannelLinkCode | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.channelIdentitiesList();
      setIdentities(r.identities);
      setLoadError(null);
      setUnavailable(false);
    } catch (err) {
      if (isUnavailable(err)) {
        setUnavailable(true);
        setIdentities([]);
        return;
      }
      setLoadError(friendlyApiError(err, 'Could not load linked chat accounts.'));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Same reason as the phone section: the ceremony completes on the rail, not
  // in this tab, so poll while a code is outstanding. Here the arriving row is
  // one we have never seen — the member's account id is what the message
  // teaches the hub — so watch for any new identity on that channel.
  useEffect(() => {
    if (!linking) return;
    const before = new Set((identities ?? []).map((i) => `${i.channel}:${i.external_id}`));
    const id = setInterval(async () => {
      try {
        const r = await api.channelIdentitiesList();
        setIdentities(r.identities);
        if (r.identities.some((i) => !before.has(`${i.channel}:${i.external_id}`))) {
          setLinking(null);
        }
      } catch {
        // A failed background poll is not worth surfacing.
      }
    }, 4000);
    return () => clearInterval(id);
    // `identities` is read once when the poll arms, deliberately: re-arming on
    // every list update would reset the baseline and the new row would never
    // look new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linking]);

  return (
    <Card>
      <h2 className="font-display text-2xl">Chat accounts</h2>
      <p className="text-sm text-ink/65 mt-1">
        Your Telegram, Slack and Discord accounts. Linking one lets you open gates from that chat.
        WhatsApp works off your verified phone number instead — see above.
      </p>

      {unavailable && (
        <p className="mt-4 text-sm text-ink/55">This hub doesn&rsquo;t serve chat linking yet.</p>
      )}

      {loadError && (
        <p className="mt-4 text-sm text-terracotta-deep" role="alert">
          {loadError}
        </p>
      )}

      {identities === null && !loadError && !unavailable && (
        <p className="mt-6 text-sm text-ink/55">Loading…</p>
      )}

      {identities && !unavailable && (
        <ul className="mt-6 divide-y divide-ink/10 -mx-1">
          {identities.length === 0 && (
            <li className="px-1 py-3 text-sm text-ink/65">No chat accounts linked yet.</li>
          )}
          {identities.map((i) => (
            <ChannelRowItem key={`${i.channel}:${i.external_id}`} identity={i} onChanged={refresh} />
          ))}
        </ul>
      )}

      {!unavailable &&
        (linking ? (
          <ChannelLinkCodePanel linkCode={linking} onDone={() => setLinking(null)} />
        ) : (
          <StartChannelLinkForm onStarted={setLinking} />
        ))}
    </Card>
  );
}

function ChannelRowItem({
  identity,
  onChanged,
}: {
  identity: LinkedChannelIdentity;
  onChanged: () => Promise<void> | void;
}) {
  const [unlinking, setUnlinking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function unlink() {
    setErrorMsg(null);
    setUnlinking(true);
    try {
      await api.channelIdentityUnlink(identity.channel, identity.external_id);
      await onChanged();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError && err.code === 'identity_not_found'
          ? 'Already unlinked.'
          : friendlyApiError(err, 'Could not unlink this account.'),
      );
      setUnlinking(false);
    }
  }

  return (
    <li className="px-1 py-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{channelLabel(identity.channel)}</span>
          {/* The raw account id, because it is the only thing that identifies
              which account this is — the hub never learns a display name. */}
          <span className="font-mono text-sm text-ink/60 truncate">{identity.external_id}</span>
        </div>
        <button
          type="button"
          onClick={unlink}
          disabled={unlinking}
          className="text-xs text-terracotta-deep hover:underline underline-offset-4 shrink-0"
        >
          {unlinking ? 'Unlinking…' : 'Unlink'}
        </button>
      </div>
      {errorMsg && (
        <p className="mt-2 text-sm text-terracotta-deep" role="alert">
          {errorMsg}
        </p>
      )}
    </li>
  );
}

function StartChannelLinkForm({ onStarted }: { onStarted: (code: ChannelLinkCode) => void }) {
  const [channel, setChannel] = useState<LinkableChannel>('telegram');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      onStarted(await api.channelLinkStart(channel));
    } catch (err) {
      setErrorMsg(channelLinkStartErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 pt-6 border-t border-ink/10 flex flex-col sm:flex-row sm:items-end gap-3"
    >
      <label className="block flex-1 max-w-[240px]">
        <span className="text-sm font-medium text-ink/85 block mb-1.5">Link a chat account</span>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as LinkableChannel)}
          className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
        >
          {LINKABLE_CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="ink" disabled={submitting}>
        {submitting ? 'Starting…' : 'Get a link code'}
      </Button>
      {errorMsg && (
        <p className="text-sm text-terracotta-deep sm:pb-2.5" role="alert">
          {errorMsg}
        </p>
      )}
    </form>
  );
}

function channelLinkStartErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'unsupported_channel') {
      return 'That chat platform can’t be linked this way. WhatsApp uses your verified phone number instead.';
    }
    if (err.code === 'too_many_link_codes') {
      return 'Too many link codes requested for this account recently. Wait a while before trying again.';
    }
  }
  return friendlyApiError(err, 'Could not start linking this account.');
}

// The channel code panel is deliberately louder than the phone one.
//
// A phone code names the number allowed to spend it, so someone who sees it
// gains nothing. A channel code names nothing: whoever sends it to the bot
// gets bound. Anyone who reads this code off a screen or a screenshot before
// the member uses it can link THEIR account to this profile and inherit its
// gate access. That asymmetry is real, so the warning is not applied evenly
// to both panels — the phone one would be crying wolf.
function ChannelLinkCodePanel({
  linkCode,
  onDone,
}: {
  linkCode: ChannelLinkCode;
  onDone: () => void;
}) {
  const remaining = useCountdown(linkCode.expires_at);
  const expired = remaining <= 0;
  const [copied, setCopied] = useState(false);

  function copyCode() {
    navigator.clipboard
      .writeText(linkCode.code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  }

  return (
    <div className="mt-6 pt-6 border-t border-ink/10 space-y-4">
      <div className="rounded-xl bg-ink text-paper p-4">
        <p className="text-sm font-medium mb-2">
          Your {channelLabel(linkCode.channel)} link code
        </p>
        <div className="flex items-center justify-between gap-3">
          <code className="font-mono text-xl sm:text-2xl tracking-[0.15em] break-all">
            {linkCode.code}
          </code>
          <button
            type="button"
            onClick={copyCode}
            className="shrink-0 px-3 py-1.5 rounded-full border border-white/25 hover:border-white text-xs"
          >
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
        {/* The hub's own wording, never re-composed here, so it cannot drift
            from what the rail actually listens for. It already carries the
            sharing warning; the panel below repeats it visually because this
            is the one code in this console that hands over gate access. */}
        <p className="text-sm text-paper/80 mt-3">{linkCode.instruction}</p>
      </div>

      <div className="rounded-xl border border-terracotta-deep/30 bg-terracotta-deep/[0.06] px-4 py-3">
        <p className="text-sm text-ink/85">
          <span className="font-medium">Keep this code to yourself.</span> Unlike a phone code, it
          isn&rsquo;t tied to one account — whoever sends it to the bot first gets linked, and gains
          whatever gate access this profile has.
        </p>
      </div>

      {expired ? (
        <p className="text-sm text-terracotta-deep" role="alert">
          This code has expired. Start over to get a new one.
        </p>
      ) : (
        <p className="text-sm text-ink/65">
          Waiting for that message to arrive — this updates on its own once it does, no need to
          refresh. Expires in {formatMmSs(remaining)}.
        </p>
      )}

      <button
        type="button"
        onClick={onDone}
        className="text-sm text-ink/65 hover:text-ink underline underline-offset-4"
      >
        {expired ? 'Start over' : 'Cancel'}
      </button>
    </div>
  );
}

function toApiMessage(err: unknown, fallback: string): string {
  return friendlyApiError(err, fallback);
}

function LocationsSection() {
  const { currentAccount, refreshMe } = useAuth();
  const [rows, setRows] = useState<LocationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const r = await api.locationsList(currentAccount.id);
      setRows(r.locations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locations.');
    }
  }, [currentAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!currentAccount) {
    return (
      <Card>
        <p className="text-ink/65 text-sm">No account loaded.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="font-display text-2xl">Locations</h2>
      <p className="text-sm text-ink/65 mt-1">
        Each location has its own access points, members, and devices. Use the account switcher in
        the top bar to add a new one.
      </p>

      {error && (
        <p className="mt-4 text-sm text-terracotta-deep" role="alert">
          {error}
        </p>
      )}

      {rows === null ? (
        <p className="mt-6 text-sm text-ink/55">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink/65">
          No locations yet. Use the account switcher to create one.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-ink/10 -mx-1">
          {rows.map((l) => (
            <LocationRowItem
              key={l.id}
              row={l}
              onChanged={refresh}
              afterDelete={async () => {
                await refreshMe();
                await refresh();
              }}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function LocationRowItem({
  row,
  onChanged,
  afterDelete,
}: {
  row: LocationRow;
  onChanged: () => Promise<void> | void;
  afterDelete: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <li className="px-1 py-4 flex items-center gap-4">
      <span className={`flex-none h-2 w-2 rounded-full ${KIND_DOT[row.type]}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink truncate">{row.name}</p>
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink/55 mt-0.5">
          {row.type}
          {row.address?.city ? ` · ${row.address.city}` : ''}
          {' · '}
          {row.access_point_count} pt{row.access_point_count === 1 ? '' : 's'} ·{' '}
          {row.member_count} member{row.member_count === 1 ? '' : 's'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-ink/65 hover:text-ink underline underline-offset-4"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={() => setDeleting(true)}
        className="text-xs text-terracotta-deep hover:underline underline-offset-4"
      >
        Delete
      </button>

      {editing && (
        <RenameLocationModal
          row={row}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      )}
      {deleting && (
        <DeleteLocationModal
          row={row}
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            setDeleting(false);
            await afterDelete();
          }}
        />
      )}
    </li>
  );
}

const KIND_DOT: Record<LocationRow['type'], string> = {
  house: 'bg-gold',
  complex: 'bg-terracotta',
  building: 'bg-moss',
  other: 'bg-slate',
};

function RenameLocationModal({
  row,
  onClose,
  onSaved,
}: {
  row: LocationRow;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState(row.name);
  const [city, setCity] = useState(typeof row.address?.city === 'string' ? row.address.city : '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim()) {
      setErrorMsg('Name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const trimmedCity = city.trim();
      const nextAddress = { ...(row.address ?? {}) };
      if (trimmedCity) nextAddress.city = trimmedCity;
      else delete nextAddress.city;
      await api.locationUpdate(row.id, {
        name: name.trim(),
        address: nextAddress,
      });
      await onSaved();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? (err.detail ?? err.code)
          : err instanceof Error
            ? err.message
            : 'Update failed.',
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-2xl mb-1">Rename location</h2>
      <p className="text-sm text-ink/60 mb-5">
        Updating the name only changes the label — members, devices, and access points stay attached.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-ink/85">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink/85">City (optional)</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Durban"
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
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteLocationModal({
  row,
  onClose,
  onDeleted,
}: {
  row: LocationRow;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const matches = confirmText.trim() === row.name;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await api.locationDelete(row.id);
      await onDeleted();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? (err.detail ?? err.code)
          : err instanceof Error
            ? err.message
            : 'Delete failed.',
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-2xl text-terracotta-deep mb-1">Delete location</h2>
      <p className="text-sm text-ink/75 mb-3">
        This permanently removes <span className="font-medium text-ink">{row.name}</span> and
        everything attached to it.
      </p>
      <ul className="text-sm text-ink/70 list-disc pl-5 mb-4 space-y-1">
        <li>{row.access_point_count} access point{row.access_point_count === 1 ? '' : 's'}, paired devices, and grants.</li>
        <li>{row.member_count} member{row.member_count === 1 ? '' : 's'} and their access history.</li>
        <li>If this is your last location, the account itself is dropped too.</li>
      </ul>
      <p className="text-sm text-ink/75 mb-4">
        This cannot be undone. Type <span className="font-mono text-ink">{row.name}</span> to confirm.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <input
          autoFocus
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={row.name}
          className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-terracotta"
        />
        {errorMsg && <p className="text-sm text-terracotta-deep">{errorMsg}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!matches || submitting}
            className="h-11 px-5 rounded-full bg-terracotta-deep text-paper text-sm font-medium hover:bg-terracotta disabled:bg-ink/15 disabled:text-ink/40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Deleting…' : 'Delete location'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordSection() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (next.length < 8) {
      setErrorMsg('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setErrorMsg('New passwords don’t match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.updatePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      // update-password answers with invalid_credentials (the current password
      // was wrong), weak_password, unauthorized or rate_limited — see
      // authrecovery.go. It has never emitted invalid_current_password,
      // same_password or no_password_set, so the three branches that used to be
      // here matched nothing and quietly fell through to the generic message.
      const msg =
        err instanceof ApiError && err.code === 'invalid_credentials'
          ? 'Current password is incorrect.'
          : err instanceof ApiError && err.code === 'weak_password'
            ? 'That password is too short. Use at least 8 characters.'
            : friendlyApiError(err, 'Could not update password.');
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function signOutEverywhere() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <Card>
      <h2 className="font-display text-2xl">Password</h2>
      <p className="text-sm text-ink/65 mt-1">
        Updating signs out every other session — this one stays.
      </p>

      {done && (
        <div className="mt-5 rounded-xl bg-moss/10 border border-moss/30 px-4 py-3 text-sm text-ink/85">
          Password updated. You stay signed in here; other sessions are gone.
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <Field
          label="Current password"
          value={current}
          onChange={setCurrent}
          type="password"
          autoComplete="current-password"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="New password"
            value={next}
            onChange={setNext}
            type="password"
            autoComplete="new-password"
            hint="8+ chars"
          />
          <Field
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            type="password"
            autoComplete="new-password"
          />
        </div>

        {errorMsg && (
          <p className="text-sm text-terracotta-deep" role="alert">
            {errorMsg}
          </p>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" variant="ink" disabled={submitting}>
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
          <button
            type="button"
            onClick={signOutEverywhere}
            className="h-11 px-5 rounded-full text-sm text-ink/65 hover:text-terracotta-deep underline underline-offset-4"
          >
            Sign out of this session
          </button>
        </div>
      </form>
    </Card>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-medium text-ink/85">{label}</span>
        {hint && <span className="text-xs text-ink/50">{hint}</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
      />
    </label>
  );
}
