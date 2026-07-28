import { KEYS } from '@/lib/storageKeys';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { useAuth } from '@/lib/auth';
import { ApiError, api, friendlyApiError } from '@/lib/api';
import { COUNTRIES } from '@/lib/countries';

const PENDING_INVITE_KEY = KEYS.pendingInvite;
export const PENDING_WHATSAPP_PHONE_KEY = KEYS.pendingWhatsAppPhone;
const PHONE_E164_RE = /^\+[1-9]\d{6,14}$/;

// Mirrors hub/internal/httpapi/username.go's validUsername: 2-254 chars,
// no whitespace, no control characters, no leading/trailing dot. This is a
// UX pre-check only — the gateway is the authority and re-validates on
// submit — so it doesn't need to replicate Go's full Unicode classification,
// just keep an obviously-invalid username from round-tripping to a 400.
function isValidUsername(u: string): boolean {
  if (u.length < 2 || u.length > 254) return false;
  // eslint-disable-next-line no-control-regex -- mirrors the backend's control-char rejection
  if (/[\s\x00-\x1f\x7f]/.test(u)) return false;
  return !u.startsWith('.') && !u.endsWith('.');
}

type Step = 'auth' | 'kind' | 'location';
const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'auth', label: 'Account' },
  { key: 'kind', label: 'Type' },
  { key: 'location', label: 'Location' },
];

export default function Signup() {
  const [step, setStep] = useState<Step>('auth');

  // Step 1 — auth basics
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');

  // Step 2 — account kind
  const [kind, setKind] = useState<'personal' | 'business'>('personal');

  // Step 3 — first location
  const [locationName, setLocationName] = useState('');
  const [locationType, setLocationType] = useState<'house' | 'complex' | 'building' | 'other'>('house');
  const [country, setCountry] = useState('ZA');

  // Submission + flow
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedUsername, setSubmittedUsername] = useState<string | null>(null);
  const { registerWithPassword, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pendingInviteToken = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try { return sessionStorage.getItem(PENDING_INVITE_KEY); } catch { return null; }
  }, []);
  const isInviteSignup = Boolean(pendingInviteToken);
  const pendingWhatsAppPhone = useMemo(() => {
    const fromUrl = searchParams.get('wa_phone');
    const normalized = fromUrl?.replace(/\s+/g, '') ?? '';
    if (PHONE_E164_RE.test(normalized)) {
      try { sessionStorage.setItem(PENDING_WHATSAPP_PHONE_KEY, normalized); } catch {/**/}
      return normalized;
    }
    if (typeof window === 'undefined') return null;
    try {
      const stored = sessionStorage.getItem(PENDING_WHATSAPP_PHONE_KEY);
      return stored && PHONE_E164_RE.test(stored) ? stored : null;
    } catch {
      return null;
    }
  }, [searchParams]);

  // Smart default: personal account → "Home", business → user's name + " HQ"
  const placeholderForKind =
    kind === 'business' ? (name ? `${name} HQ` : 'Sunset Apartments') : 'Home';

  const canAdvanceFromAuth =
    name.trim().length > 0 &&
    isValidUsername(username.trim()) &&
    password.length >= 8 &&
    (phone.trim().length === 0 || PHONE_E164_RE.test(phone.trim()));

  async function submitSignup() {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await registerWithPassword({
        username,
        password,
        display_name: name,
        phone_e164: phone.trim() || undefined,
        // The gateway's /v1/auth/register always creates an anchor location
        // (there's no "join-only, no location" registration mode) — even
        // for invite signups, so a placeholder name is used there. The
        // invite is then accepted as a separate step inside
        // registerWithPassword (see lib/auth.tsx); the placeholder location
        // just becomes an extra location the new user owns.
        location_name: isInviteSignup ? 'My account' : (locationName.trim() || placeholderForKind).trim(),
        country_code: country,
        account_type: kind,
        invite_token: pendingInviteToken ?? undefined,
      });
      if (pendingInviteToken) {
        try { sessionStorage.removeItem(PENDING_INVITE_KEY); } catch {/**/}
        navigate('/app', { replace: true });
      } else {
        setSubmittedUsername(username);
      }
    } catch (err) {
      setErrorMsg(toMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function gotoNext() {
    setErrorMsg(null);
    if (step === 'auth') {
      if (!canAdvanceFromAuth) {
        setErrorMsg('Fill in your name, username, password (8+ chars), and use +27821234567 if you add a phone number.');
        return;
      }
      if (isInviteSignup) {
        void submitSignup();
        return;
      }
      setStep('kind');
    } else if (step === 'kind') {
      setStep('location');
    }
  }
  function gotoBack() {
    setErrorMsg(null);
    if (step === 'kind') setStep('auth');
    else if (step === 'location') setStep('kind');
  }

  async function onFinalSubmit(e: FormEvent) {
    e.preventDefault();
    await submitSignup();
  }

  return (
    <AuthLayout
      asideKicker={step === 'location' ? 'Almost there' : 'Get started'}
      asideTitle={
        step === 'auth'
          ? 'Your hub, your rules.'
          : step === 'kind'
            ? 'Personal or business?'
            : 'Name your first place.'
      }
      asideBody={
        <p>
          {step === 'auth' &&
            "Your account lives on this hub — nobody else's cloud. Three quick steps and you'll be ready to pair a device."}
          {step === 'kind' &&
            "It's only for dashboard hints — you can change it later in settings."}
          {step === 'location' &&
            'Each location is its own world: members, gates, devices. You can add more after you sign up.'}
        </p>
      }
    >
      {submittedUsername ? (
        <SuccessPanel
          username={submittedUsername}
          pendingWhatsAppPhone={pendingWhatsAppPhone}
          onContinue={() => navigate('/app', { replace: true })}
          onRedo={() => setSubmittedUsername(null)}
        />
      ) : (
        <>
          <Stepper current={step} />

          {/* ── Step 1: auth ───────────────────────────────────────────── */}
          {step === 'auth' && (
            <>
              <h1 className="font-display-tight text-2xl sm:text-3xl text-ink">Create your account</h1>
              <p className="mt-1 text-sm text-ink/60">
                {isInviteSignup ? 'Create your profile to accept this invite.' : 'Two minutes. Your account, on this hub.'}
              </p>

              {pendingWhatsAppPhone && !isInviteSignup && (
                <p className="mt-4 px-3 py-2 rounded-xl bg-terracotta/10 border border-terracotta/25 text-sm text-ink/80">
                  After signup, you can connect{' '}
                  <span className="font-mono text-ink">{pendingWhatsAppPhone}</span> for WhatsApp access.
                </p>
              )}

              <div className={`${isInviteSignup || pendingWhatsAppPhone ? 'mt-6' : 'mt-0'} space-y-3`}>
                <Field
                  label="Your name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g. Yusuf Adams"
                  autoComplete="name"
                  required
                />
                <Field
                  label="Username"
                  type="text"
                  value={username}
                  onChange={setUsername}
                  placeholder="pat"
                  autoComplete="username"
                  required
                />
                <Field
                  label="Password"
                  type="password"
                  hint="8+ characters"
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
                <Field
                  label="Phone number"
                  type="tel"
                  hint="Optional · E.164 (+27821234567)"
                  value={phone}
                  onChange={setPhone}
                  placeholder="+27..."
                  autoComplete="tel"
                />
              </div>

              {errorMsg && (
                <p className="mt-4 text-sm text-terracotta-deep" role="alert">
                  {errorMsg}
                </p>
              )}

              <Button
                type="button"
                variant="ink"
                size="lg"
                className="w-full mt-3"
                onClick={gotoNext}
                disabled={!canAdvanceFromAuth || submitting}
              >
                {submitting ? 'Creating account…' : isInviteSignup ? 'Create account and accept invite' : 'Continue →'}
              </Button>

              <p className="mt-2 text-sm text-ink/60">
                Already with us?{' '}
                <Link to="/login" className="underline underline-offset-4 decoration-terracotta">
                  Sign in
                </Link>
                .
              </p>
            </>
          )}

          {/* ── Step 2: account kind ───────────────────────────────────── */}
          {step === 'kind' && (
            <>
              <h1 className="font-display-tight text-2xl sm:text-3xl text-ink">What is this for?</h1>
              <p className="mt-1.5 text-sm text-ink/60">
                We tailor the dashboard a little. You can switch later.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-3">
                <KindCard
                  selected={kind === 'personal'}
                  onClick={() => setKind('personal')}
                  title="Personal"
                  body="A house, a cottage, a small place. Invite a few friends or your cleaner."
                  icon={
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 11 12 4l9 7" />
                      <path d="M5 10v10h14V10" />
                      <path d="M10 20v-5h4v5" />
                    </svg>
                  }
                />
                <KindCard
                  selected={kind === 'business'}
                  onClick={() => setKind('business')}
                  title="Business"
                  body="A complex, an office, a property you manage. Multiple gates, members, roles."
                  icon={
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="6" width="18" height="14" rx="1.5" />
                      <path d="M3 10h18" />
                      <path d="M9 14h2M13 14h2M9 17h2M13 17h2" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  }
                />
              </div>

              {errorMsg && <p className="mt-4 text-sm text-terracotta-deep">{errorMsg}</p>}

              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={gotoBack}
                  className="h-11 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
                >
                  ← Back
                </button>
                <Button
                  type="button"
                  variant="ink"
                  size="lg"
                  className="flex-1"
                  onClick={gotoNext}
                >
                  Continue →
                </Button>
              </div>
            </>
          )}

          {/* ── Step 3: first location ─────────────────────────────────── */}
          {step === 'location' && (
            <form onSubmit={onFinalSubmit}>
              <h1 className="font-display-tight text-2xl sm:text-3xl text-ink">Your first location</h1>
              <p className="mt-1.5 text-sm text-ink/60">
                Each location has its own gates, members and devices. You can add more after.
              </p>

              <div className="mt-5 space-y-3">
                <Field
                  label="Location name"
                  value={locationName}
                  onChange={setLocationName}
                  placeholder={placeholderForKind}
                  autoComplete="address-level2"
                  hint="what you'd call it day-to-day"
                  required={false}
                />

                <fieldset>
                  <legend className="text-sm font-medium text-ink/85 mb-2">Type</legend>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['house', 'complex', 'building', 'other'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setLocationType(t)}
                        className={`h-11 rounded-xl border text-sm capitalize transition-colors ${
                          locationType === t
                            ? 'bg-ink text-paper border-ink'
                            : 'bg-paper-cool text-ink border-ink/15 hover:border-ink/35'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="text-sm font-medium text-ink/85 block mb-1.5">Country</span>
                  <span className="relative block">
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="appearance-none w-full h-11 rounded-xl bg-paper-cool border border-ink/15 pl-3 pr-10 text-[15px] text-ink hover:border-ink/30 focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink/40 transition-colors"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.flag} {c.name}
                        </option>
                      ))}
                    </select>
                    <svg
                      viewBox="0 0 12 12"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-ink/45"
                      aria-hidden
                    >
                      <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </label>
              </div>

              {errorMsg && (
                <p className="mt-4 text-sm text-terracotta-deep" role="alert">
                  {errorMsg}
                </p>
              )}

              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={gotoBack}
                  className="h-11 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
                >
                  ← Back
                </button>
                <Button
                  type="submit"
                  variant="ink"
                  size="lg"
                  className="flex-1"
                  disabled={submitting}
                >
                  {submitting ? 'Creating account…' : 'Create account'}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </AuthLayout>
  );
}

// ─── pieces ──────────────────────────────────────────────────────────────

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="mb-2 flex items-center gap-2">
      {STEPS.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'active' : 'upcoming';
        return (
          <li key={s.key} className="flex items-center gap-2 flex-1">
            <span
              className={`flex-none grid place-items-center h-7 w-7 rounded-full text-xs font-medium ${
                state === 'done'
                  ? 'bg-terracotta text-paper'
                  : state === 'active'
                    ? 'bg-ink text-paper'
                    : 'bg-paper-cool text-ink/45 border border-ink/10'
              }`}
            >
              {state === 'done' ? (
                <svg viewBox="0 0 16 16" className="h-3 w-3"><path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
              ) : (
                i + 1
              )}
            </span>
            <span
              className={`text-[11px] uppercase tracking-[0.18em] ${
                state === 'upcoming' ? 'text-ink/35' : 'text-ink/65'
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={`hidden sm:block flex-1 h-px ${
                  state === 'done' ? 'bg-terracotta/40' : 'bg-ink/10'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function KindCard({
  selected,
  onClick,
  title,
  body,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl border p-5 transition-all ${
        selected
          ? 'border-ink bg-paper-cool ring-2 ring-ink/10'
          : 'border-ink/10 hover:border-ink/30 hover:bg-paper-cool/50'
      }`}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex-none grid place-items-center h-12 w-12 rounded-xl ${
            selected ? 'bg-ink text-paper' : 'bg-paper-cool text-ink/65'
          }`}
        >
          {icon}
        </div>
        <div className="flex-1">
          <p className="font-display text-xl">{title}</p>
          <p className="text-sm text-ink/65 mt-1">{body}</p>
        </div>
        <span
          className={`flex-none mt-1 grid place-items-center h-6 w-6 rounded-full border ${
            selected ? 'border-ink bg-ink' : 'border-ink/20'
          }`}
        >
          {selected && (
            <svg viewBox="0 0 16 16" className="h-3 w-3 text-paper">
              <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2.5" fill="none" />
            </svg>
          )}
        </span>
      </div>
    </button>
  );
}

function SuccessPanel({
  username,
  pendingWhatsAppPhone,
  onContinue,
  onRedo,
}: {
  username: string;
  pendingWhatsAppPhone: string | null;
  onContinue: () => void;
  onRedo: () => void;
}) {
  return (
    <>
      <h1 className="font-display-tight text-3xl sm:text-4xl text-ink">You're in.</h1>
      <p className="mt-3 text-sm text-ink/70">
        Signed up as <span className="font-medium text-ink">{username}</span>. Continue to your
        dashboard to add access points and invite members.
      </p>
      {/* Arrived from the WhatsApp nudge (SignupLinkForPhone adds ?wa_phone=).
          There WAS a "Connect number" button here that called api.phoneAdd() —
          a route the hub does not serve, so it failed for everyone who followed
          that link. Worse, nothing in the hub has ever VERIFIED a phone
          (store.AddVerifiedPhone has no callers), and access resolution
          requires verified_at, so even a working link would have granted
          nothing. Telling the user what to do instead beats a button that
          cannot work — see docs/PHONE-LINKING.md. */}
      {pendingWhatsAppPhone && (
        <div className="mt-4 rounded-xl border border-terracotta/25 bg-terracotta/10 px-4 py-4">
          <p className="text-sm font-medium text-ink">About that WhatsApp number</p>
          <p className="mt-1 text-sm text-ink/70">
            <span className="font-mono text-ink">{pendingWhatsAppPhone}</span> isn&rsquo;t linked to
            this account. The hub can&rsquo;t confirm on its own that the number is yours, so an
            account admin links it for you — ask whoever runs this hub to add it to your
            membership.
          </p>
        </div>
      )}
      <Button variant="ink" size="lg" className="mt-6 w-full" onClick={onContinue}>
        Go to dashboard
      </Button>
      <p className="mt-5 text-sm text-ink/60">
        Wrong username?{' '}
        <button
          type="button"
          onClick={onRedo}
          className="underline underline-offset-4 decoration-terracotta"
        >
          Sign up again
        </button>
        .
      </p>
    </>
  );
}

function toMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'username_taken') return 'That username is already in use. Try signing in.';
    if (err.code === 'invalid_credentials') return 'Could not sign in after registration.';
    if (err.code === 'invite_username_mismatch') return 'Use the same username this invitation was sent to.';
    if (err.code === 'invite_phone_mismatch') return 'Use the same WhatsApp number this invitation was sent to.';
    if (err.code === 'invite_used') return 'This invitation has already been accepted.';
    if (err.code === 'invite_expired') return 'This invitation has expired. Ask the sender to send a new one.';
    if (err.code === 'invite_revoked') return 'This invitation was revoked by the sender.';
    if (err.code === 'invite_not_found') return 'We could not find this invitation. The link may be wrong.';
  }
  return friendlyApiError(err);
}

