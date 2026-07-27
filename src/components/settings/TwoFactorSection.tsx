import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ApiError, api, friendlyApiError, rateLimitInfo, type TwoFactorEnrollment, type TwoFactorStatus } from '@/lib/api';

// The hub has served /v1/auth/2fa[/enroll|/activate|/disable] since
// hub/internal/httpapi/twofactor.go landed and nothing in the console called
// any of it — a working security control that no one could reach. This is
// the console side of that gap.
//
// Read twofactor.go's doc comment before touching this file; it argues from
// first principles for every choice below and this component exists to
// render those choices honestly, not to reinterpret them.

// ── copy-to-clipboard, shared by the secret and every recovery code ────────
//
// No generic CopyButton exists elsewhere in src/ (Devices.tsx's claim-token
// modal and CodeBlock.tsx each inline their own), so this follows the same
// shape: write the raw value, flash "Copied" briefly, never fail loudly — a
// clipboard write that's blocked by the browser is not worth an error banner
// over a value that's still fully visible and selectable on screen.
function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = useCallback((key: string, value: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1400);
      })
      .catch(() => {});
  }, []);
  return { copiedKey, copy };
}

function CopyButton({ label, keyName, value, copy, copiedKey }: {
  label: string;
  keyName: string;
  value: string;
  copy: (key: string, value: string) => void;
  copiedKey: string | null;
}) {
  return (
    <button
      type="button"
      onClick={() => copy(keyName, value)}
      className="shrink-0 px-3 py-1.5 rounded-full border border-ink/15 hover:border-ink text-xs text-ink/75 hover:text-ink"
    >
      {copiedKey === keyName ? 'Copied' : label}
    </button>
  );
}

export default function TwoFactorSection() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Held only in memory, only for the life of this component instance. There
  // is no endpoint that returns either of these a second time — see
  // twofactor.go's "THE SECRET IS RECOVERABLE, AND CANNOT BE OTHERWISE" and
  // "RECOVERY CODES" sections. Losing this state (a refresh, a closed tab)
  // is exactly as final as it looks; that is the design, not a bug.
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const { copiedKey, copy } = useCopy();

  const refresh = useCallback(async () => {
    try {
      const s = await api.twoFactorStatus();
      setStatus(s);
      setLoadError(null);
    } catch (err) {
      setLoadError(friendlyApiError(err, 'Could not load two-factor status.'));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Card>
      <h2 className="font-display text-2xl">Two-factor authentication</h2>
      <p className="text-sm text-ink/65 mt-1">
        A code from an authenticator app, in addition to your password, before this console will
        let anyone in.
      </p>

      {loadError && (
        <p className="mt-4 text-sm text-terracotta-deep" role="alert">
          {loadError}
        </p>
      )}

      {status === null && !loadError && <p className="mt-6 text-sm text-ink/55">Loading…</p>}

      {status && recoveryCodes && (
        <RecoveryCodesPanel
          codes={recoveryCodes}
          copy={copy}
          copiedKey={copiedKey}
          onDone={() => setRecoveryCodes(null)}
        />
      )}

      {status && !recoveryCodes && status.active && (
        <ActivePanel status={status} onChanged={refresh} />
      )}

      {status && !recoveryCodes && !status.active && status.pending && (
        <PendingPanel
          enrollment={enrollment}
          copy={copy}
          copiedKey={copiedKey}
          onActivated={(codes) => {
            setRecoveryCodes(codes);
            setEnrollment(null);
            refresh();
          }}
          onCancelled={() => {
            setEnrollment(null);
            refresh();
          }}
        />
      )}

      {status && !recoveryCodes && !status.active && !status.pending && (
        <NotEnrolledPanel onEnrolled={(enr) => { setEnrollment(enr); refresh(); }} />
      )}
    </Card>
  );
}

// ── not enrolled ─────────────────────────────────────────────────────────

function NotEnrolledPanel({ onEnrolled }: { onEnrolled: (enr: TwoFactorEnrollment) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function start() {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const enr = await api.twoFactorEnroll();
      onEnrolled(enr);
    } catch (err) {
      setErrorMsg(friendlyApiError(err, 'Could not start enrolment.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5">
      <p className="text-sm text-ink/65">
        Not set up. Turning this on takes two steps: scan a code into an authenticator app, then
        prove it worked before it starts gating sign-in — see below.
      </p>
      {errorMsg && (
        <p className="mt-3 text-sm text-terracotta-deep" role="alert">
          {errorMsg}
        </p>
      )}
      <div className="mt-4">
        <Button type="button" variant="ink" disabled={submitting} onClick={start}>
          {submitting ? 'Starting…' : 'Set up two-factor authentication'}
        </Button>
      </div>
    </div>
  );
}

// ── pending: secret provisioned, not yet proven ─────────────────────────────

function PendingPanel({
  enrollment,
  copy,
  copiedKey,
  onActivated,
  onCancelled,
}: {
  enrollment: TwoFactorEnrollment | null;
  copy: (key: string, value: string) => void;
  copiedKey: string | null;
  onActivated: (codes: string[]) => void;
  onCancelled: () => void;
}) {
  const [code, setCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function activate(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!code.trim()) {
      setErrorMsg('Enter the code your authenticator app is showing.');
      return;
    }
    setActivating(true);
    try {
      const res = await api.twoFactorActivate(code.trim());
      onActivated(res.recovery_codes);
    } catch (err) {
      setErrorMsg(activateErrorMessage(err));
    } finally {
      setActivating(false);
    }
  }

  async function cancel() {
    setErrorMsg(null);
    setCancelling(true);
    try {
      await api.twoFactorEnrollCancel();
      onCancelled();
    } catch (err) {
      setErrorMsg(friendlyApiError(err, 'Could not cancel this attempt.'));
      setCancelling(false);
    }
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-xl bg-gold/10 border border-gold/40 px-4 py-3 text-sm text-ink/85">
        Not on yet. This enrolment is only gating anything once the code below verifies — until
        then, sign-in is unchanged.
      </div>

      {enrollment ? (
        <div className="space-y-3">
          <p className="text-sm text-ink/75">
            Scan this into your authenticator app (Google Authenticator, Aegis, 1Password,
            Bitwarden, …), or enter the key manually if it can't scan.{' '}
            <span className="text-ink/85 font-medium">
              This key is shown once, right now, and will not be shown again.
            </span>
          </p>

          <div className="rounded-xl bg-ink text-paper p-4">
            <div className="flex items-center justify-between gap-3">
              <code className="font-mono text-sm tracking-wider break-all">
                {groupSecret(enrollment.secret)}
              </code>
              <CopyButton label="Copy key" keyName="secret" value={enrollment.secret} copy={copy} copiedKey={copiedKey} />
            </div>
          </div>

          <details className="text-xs text-ink/55">
            <summary className="cursor-pointer select-none hover:text-ink/75">
              Setup URI (for apps that import a link instead of a key)
            </summary>
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-paper-cool border border-ink/10 px-4 py-3">
              <code className="font-mono text-[12px] break-all text-ink/75">{enrollment.otpauth_uri}</code>
              <CopyButton label="Copy" keyName="uri" value={enrollment.otpauth_uri} copy={copy} copiedKey={copiedKey} />
            </div>
          </details>

          <p className="text-xs text-ink/45">
            {enrollment.algorithm} · {enrollment.digits} digits · {enrollment.period_seconds}s codes
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink/65">
          You started setting this up earlier, in a session that's gone now — the key was only
          ever shown once and can't be shown again. If you already added it to your authenticator
          app, enter the current code below to finish. Otherwise, cancel and start over.
        </p>
      )}

      <form onSubmit={activate} className="flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="block flex-1 max-w-[220px]">
          <span className="text-sm font-medium text-ink/85 block mb-1.5">Code from your app</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123 456"
            className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] tracking-widest focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </label>
        <Button type="submit" variant="ink" disabled={activating}>
          {activating ? 'Verifying…' : 'Activate'}
        </Button>
        <button
          type="button"
          onClick={cancel}
          disabled={cancelling}
          className="h-11 px-4 rounded-full text-sm text-ink/65 hover:text-terracotta-deep underline underline-offset-4"
        >
          {cancelling ? 'Cancelling…' : 'Cancel setup'}
        </button>
      </form>

      {errorMsg && (
        <p className="text-sm text-terracotta-deep" role="alert">
          {errorMsg}
        </p>
      )}
    </div>
  );
}

// ── active ───────────────────────────────────────────────────────────────

function ActivePanel({ status, onChanged }: { status: TwoFactorStatus; onChanged: () => Promise<void> | void }) {
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const remaining = status.recovery_codes_remaining ?? null;
  // Below "half" is a UI nudge, not a security threshold — the number itself
  // is the fact that matters (see twofactor.go's sole-admin lockout note on
  // why this is surfaced at all).
  const remainingLow = remaining !== null && remaining <= 2;

  async function disable(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const totp = totpCode.trim();
    const recovery = recoveryCode.trim();
    if (totp && recovery) {
      setErrorMsg('Enter a code or a recovery code — not both.');
      return;
    }
    if (!totp && !recovery) {
      setErrorMsg('Turning this off requires a current code or a recovery code.');
      return;
    }
    setSubmitting(true);
    try {
      await api.twoFactorDisable(totp ? { totp_code: totp } : { recovery_code: recovery });
      setDone(true);
      setTotpCode('');
      setRecoveryCode('');
      await onChanged();
    } catch (err) {
      setErrorMsg(disableErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-xl bg-moss/10 border border-moss/30 px-4 py-3 text-sm text-ink/85">
        On. Signing in here now needs your password and a code.
      </div>

      <p className={`text-sm ${remainingLow ? 'text-terracotta-deep' : 'text-ink/65'}`}>
        {remaining === null
          ? 'Recovery codes: unknown.'
          : remaining === 0
            ? 'No recovery codes left. If you lose your authenticator, the only way back in is the operator disabling this from the machine — see the recovery note below.'
            : `${remaining} recovery code${remaining === 1 ? '' : 's'} left, from the ten issued when you activated.`}
      </p>

      <div className="rounded-xl border border-ink/10 bg-paper/45 p-4">
        <p className="text-sm font-medium text-ink/85 mb-3">Turn off two-factor authentication</p>
        <p className="text-sm text-ink/60 mb-3">
          Proof required either way — a live session here isn't enough on its own, on purpose. Use
          whichever you have: a current app code, or one of your recovery codes if your
          authenticator is gone.
        </p>
        <form onSubmit={disable} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-ink/85 block mb-1.5">Current code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="123 456"
              className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] tracking-widest focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink/85 block mb-1.5">Recovery code</span>
            <input
              type="text"
              autoComplete="off"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </label>

          {done && (
            <p className="sm:col-span-2 text-sm text-moss" role="status">
              Two-factor authentication is off.
            </p>
          )}
          {errorMsg && (
            <p className="sm:col-span-2 text-sm text-terracotta-deep" role="alert">
              {errorMsg}
            </p>
          )}

          <div className="sm:col-span-2">
            <Button type="submit" variant="outline" disabled={submitting}>
              {submitting ? 'Turning off…' : 'Turn off two-factor authentication'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── recovery codes: shown exactly once, right after activation ─────────────

function RecoveryCodesPanel({
  codes,
  copy,
  copiedKey,
  onDone,
}: {
  codes: string[];
  copy: (key: string, value: string) => void;
  copiedKey: string | null;
  onDone: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const allText = codes.join('\n');

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl bg-moss/10 border border-moss/30 px-4 py-3 text-sm text-ink/85">
        Two-factor authentication is on.
      </div>

      <div className="rounded-xl bg-ink text-paper p-4">
        <p className="text-sm font-medium mb-1">Your recovery codes</p>
        <p className="text-sm text-paper/70 mb-4">
          Ten single-use codes. Each one signs you in without your authenticator app, and any one
          of them can also turn two-factor authentication off outright.{' '}
          <span className="font-medium text-paper">
            They are shown once, right now. Save them somewhere safe — a password manager, printed
            and locked away — before you leave this page. There is no way to see them again; losing
            them means losing your fallback if your authenticator is ever lost.
          </span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => (
            <div key={c} className="flex items-center justify-between gap-2 rounded-lg bg-white/10 px-3 py-2">
              <span className="tracking-wide break-all">{c}</span>
              <CopyButton label="Copy" keyName={c} value={c} copy={copy} copiedKey={copiedKey} />
            </div>
          ))}
        </div>
        <div className="mt-4">
          <CopyButton label="Copy all ten" keyName="__all__" value={allText} copy={copy} copiedKey={copiedKey} />
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-sm text-ink/75">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5"
        />
        I've saved these recovery codes somewhere I can get to if I lose my authenticator.
      </label>

      <Button type="button" variant="ink" disabled={!acknowledged} onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

// ── shared formatting / error mapping ───────────────────────────────────────

// Display-only grouping for readability — copy still sends the raw,
// unspaced secret, since that's what an authenticator app's manual-entry
// field expects.
function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

// activate only ever answers with invalid_second_factor, rate_limited, or
// no_pending_enrollment/conflict (the enrolment vanished from under it — a
// cancel from another tab, or a factor that was already activated). Every
// other shape falls through to the generic message.
function activateErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const denial = rateLimitInfo(err);
    if (denial) return `Too many attempts — try again in ${denial.retryAfterS}s.`;
    if (err.code === 'invalid_second_factor') {
      return "That code didn't verify. Check your phone's clock and try again.";
    }
    if (err.code === 'no_pending_enrollment') {
      return 'This setup attempt is no longer valid. Refresh the page and start again.';
    }
  }
  return friendlyApiError(err, 'Could not activate two-factor authentication.');
}

// disable answers with invalid_second_factor, rate_limited, totp_not_active
// (already off, e.g. from another tab), second_factor_required or
// conflicting_second_factor — the latter two are also checked client-side
// above so the server should rarely be the one to say them.
function disableErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const denial = rateLimitInfo(err);
    if (denial) return `Too many attempts — try again in ${denial.retryAfterS}s.`;
    if (err.code === 'invalid_second_factor') {
      return "That code or recovery code didn't check out.";
    }
    if (err.code === 'totp_not_active') {
      return 'Two-factor authentication is already off.';
    }
  }
  return friendlyApiError(err, 'Could not turn off two-factor authentication.');
}
