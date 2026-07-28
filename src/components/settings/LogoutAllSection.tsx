import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { friendlyApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// The hub has served POST /v1/auth/logout-all since sessions were built and
// nothing in the console called it — the "I lost my phone" answer existed
// only as something you could curl. This is the console side of that gap.
//
// hub/internal/httpapi/auth.go's handleLogoutAll doc comment and
// store.RevokeAllRefreshTokensForUser's doc comment (hub/internal/store/users.go)
// are the source of truth for what this actually does; the copy below is
// written to match them, not to round up:
//
//   - It revokes EVERY refresh-token family for this user, on every device,
//     in one call — not just the session that made the request.
//   - It does NOT and cannot invalidate an access token already handed out:
//     those are stateless signed JWTs with no revocation list, so one that's
//     already out there keeps working until its own short natural expiry
//     regardless of this call. The bound on that is the access-token TTL,
//     not this action.
//   - This browser is not special-cased by the server call itself — but
//     once it succeeds, this component also drops the local session and
//     sends this tab to the sign-in screen, so "including this one" is true
//     of the console experience even though the still-valid JWT in memory
//     a moment longer is the honest technical detail underneath it.
export default function LogoutAllSection() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <h2 className="font-display text-2xl">Sign out everywhere</h2>
      <p className="text-sm text-ink/65 mt-1">
        Ends every signed-in session on every device for this account in one move — the answer to
        "I lost my phone" or "I think someone else has my password" without needing to know which
        session is the problem.
      </p>
      <p className="text-sm text-ink/55 mt-2">
        This also signs you out here. It cannot instantly kill a copy of your access token that's
        already out there — those expire on their own within minutes regardless — but it stops any
        of them, including this one, from being renewed.
      </p>

      <div className="mt-4">
        <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
          Sign out everywhere
        </Button>
      </div>

      {confirming && (
        <LogoutAllModal
          onClose={() => setConfirming(false)}
          onConfirmed={async () => {
            await signOut();
            navigate('/login', { replace: true });
          }}
        />
      )}
    </Card>
  );
}

function LogoutAllModal({
  onClose,
  onConfirmed,
}: {
  onClose: () => void;
  onConfirmed: () => Promise<void> | void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function confirm() {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await api.logoutAll();
      await onConfirmed();
    } catch (err) {
      setErrorMsg(friendlyApiError(err, 'Could not sign out everywhere.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-2xl text-terracotta-deep mb-1">Sign out everywhere?</h2>
      <p className="text-sm text-ink/75 mb-3">
        Every session on every device signs out, including the one you're using right now. There's
        no separate "keep this one" option — that's the entire point when you don't know which
        session to distrust.
      </p>
      <p className="text-sm text-ink/70 mb-4">
        This can't be undone — you and anyone else signed in will need to sign back in with the
        password (and second factor, if you have one on).
      </p>
      {errorMsg && (
        <p className="text-sm text-terracotta-deep mb-4" role="alert">
          {errorMsg}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={submitting}
          className="h-11 px-5 rounded-full bg-terracotta-deep text-paper text-sm font-medium hover:bg-terracotta disabled:bg-ink/15 disabled:text-ink/40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </div>
    </Modal>
  );
}
