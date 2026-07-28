import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { getApiBaseUrl, getStoredGatewayUrl, isTauri, openGatewayPicker } from '@/lib/hub';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { signInWithPassword } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await signInWithPassword(username, password);
      navigate('/app');
    } catch (err) {
      setErrorMsg(toMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      asideKicker="Welcome back"
      asideTitle="The gate is just inside."
      asideBody={
        <p>
          Sign in to open access points, manage members, and review activity from anywhere.
        </p>
      }
    >
      <h1 className="font-display-tight text-[34px] sm:text-[40px] leading-[1.02] tracking-[-0.02em] text-ink">
        Sign in
      </h1>
      <p className="mt-2 sm:mt-3 text-[15px] text-ink/65 leading-relaxed">
        Use your username and password to sign in.
      </p>

      <form onSubmit={onSubmit} className="space-y-3 sm:space-y-4" noValidate>
        <Field
          label="Username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={setUsername}
          placeholder="pat"
          required
          autoFocus
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          required
          labelTrailing={
            <Link
              to="/forgot-password"
              className="text-xs text-ink/60 hover:text-ink underline underline-offset-4 decoration-terracotta"
            >
              Forgot?
            </Link>
          }
        />

        {errorMsg && (
          <p className="text-sm text-terracotta-deep" role="alert">
            {errorMsg}
          </p>
        )}

        <Button type="submit" variant="ink" size="lg" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-5 sm:mt-6 text-sm text-ink/60">
        New here?{' '}
        <Link to="/signup" className="underline underline-offset-4 decoration-terracotta text-ink/85 hover:text-ink">
          Create an account
        </Link>
        .
      </p>

      {/* Desktop builds (or anyone who explicitly picked a gateway) can point
          this portal at a different gateway. Plain web deploys stay untouched. */}
      {(isTauri() || getStoredGatewayUrl() !== null) && (
        <p className="mt-3 text-xs text-ink/45">
          Hub: <span className="text-ink/60">{getApiBaseUrl()}</span>{' '}
          <button
            type="button"
            onClick={openGatewayPicker}
            className="underline underline-offset-4 decoration-terracotta text-ink/70 hover:text-ink"
          >
            change
          </button>
        </p>
      )}
    </AuthLayout>
  );
}

function toMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // The hub collapses every login failure into invalid_credentials — wrong
    // password, unknown username, disabled account, no password set. That is
    // deliberate (hub/internal/httpapi/auth.go): distinguishing them is an
    // account-state and user-enumeration oracle.
    //
    // So there is no `account_not_active` branch here any more. There used to
    // be, and it could never match; it read like a handled case while a
    // disabled user was told their password was wrong. If that copy is worth
    // showing, the hub has to be willing to say so first — and it is not.
    if (err.code === 'invalid_credentials') return 'That username and password don’t match.';
    return err.detail ?? err.code;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

