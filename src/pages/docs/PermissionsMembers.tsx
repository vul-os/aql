import { Link } from 'react-router-dom';
import { DocLead, DocSection, CodeBlock } from './DocsLayout';

export default function PermissionsMembers() {
  return (
    <>
      <DocLead
        kicker="02 · Concepts"
        title="Permissions & Members"
        intro="Members are people invited onto an account by username; a verified phone number is what lets them text the gate. Roles control what they can do beyond opening it."
      />

      <DocSection heading="The four roles">
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Owner</strong> — the account holder. Danger-zone settings, can transfer ownership. Exactly one per account.</li>
          <li><strong>Admin</strong> — can manage devices, members, and policies for the account.</li>
          <li><strong>Member</strong> — can open gates on the account. Can&rsquo;t change settings.</li>
          <li><strong>Viewer</strong> — read-only: sees locations, devices and activity but can&rsquo;t manage them.</li>
        </ul>
        <p className="text-ink/55 text-[14px]">
          Roles are account-wide today — there&rsquo;s no separate role per location or
          access point yet, and no built-in expiry on a membership. For one-off,
          time-bound access that shouldn&rsquo;t become a standing membership (a
          contractor, a weekend guest), use a temporary access grant instead — see the
          app&rsquo;s Grants page.
        </p>
      </DocSection>

      <DocSection heading="Inviting members">
        <ol className="list-decimal pl-6 space-y-3">
          <li>Members → <em>Invite</em>. You&rsquo;ll need a username for the invitee and their phone number — no email address, the hub doesn&rsquo;t have one for anybody.</li>
          <li>Pick a role: owner, admin, member or viewer.</li>
          <li>An accept token is generated, valid for 7 days. Accepting binds the invitee&rsquo;s phone number to the account, but leaves it <em>unverified</em> — accepting proves nothing about who holds that handset.</li>
          <li>The member then verifies the number themselves: <em>Settings &rarr; Phone numbers</em> mints a short <code>LINK-</code> code, which they send to the gate bot from that number. Until they do, the chat rails ignore their messages.</li>
        </ol>
        <div className="rounded-2xl border border-gold/40 bg-gold/[0.06] px-5 py-4 sm:px-6 sm:py-5 mt-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink/55 font-mono">
            Status: delivery not wired up
          </p>
          <p className="mt-2 text-[15px] text-ink/80 leading-relaxed">
            This hub sends nothing on its own — no email, no SMS, no WhatsApp
            message. By design the accept token is never handed back to the
            inviter (so an admin session can&rsquo;t mint itself accounts just by
            reading its own API response), and the reference gateway has no
            outbound channel wired in yet to hand it to the invitee either. The
            practical result: an invite created through the normal flow has no
            path to the invitee at all today — nobody, on either side, gets the
            accept link. It exists only as a hash in the database until a
            delivery seam ships (an operator with direct database access can
            recover it for a manual workaround; that&rsquo;s a dev/test escape
            hatch, not something a real install should rely on).
          </p>
        </div>
      </DocSection>

      <DocSection heading="Programmatic invites">
        <CodeBlock lang="bash">{`curl -X POST https://<your-hub>/v1/accounts/acc_oak/invites \\
  -H "Authorization: Bearer lintel_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "username": "lebogang",
    "phone_e164": "+27821234567",
    "role": "member"
  }'`}</CodeBlock>
        <CodeBlock lang="json">{`{
  "id": "inv_01HZ4D…",
  "username_sent": false,
  "whatsapp_sent": false
}`}</CodeBlock>
        <p>
          The accept token itself is never returned here, by design — it&rsquo;s
          meant to reach the invitee only, never the inviter.{' '}
          <code>username_sent</code> and <code>whatsapp_sent</code> report
          whether that delivery actually happened; today, on the reference
          gateway, there is no channel wired in for either one, so both always
          come back <code>false</code>. The invite is still created and
          stored — it just doesn&rsquo;t reach anyone yet. See the delivery note
          above.
        </p>
      </DocSection>

      <DocSection heading="Revoking access">
        <p>
          <code>DELETE /v1/accounts/{'{id}'}/members/{'{user_id}'}</code>, or the
          <em> Remove</em> action on the Members page. One request ends the membership;
          nothing else needs revoking separately.
        </p>
        <p>
          That is worth being precise about, because a membership is not the only thing
          the person holds. The hub re-reads it on every request, so all three of these
          stop at the same moment:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>the dashboard — every account-scoped route resolves the caller&rsquo;s role first;</li>
          <li>
            any <Link to="/docs/api-tokens" className="underline underline-offset-4 decoration-terracotta">API tokens</Link> they
            created — these outlive a session by design, and are re-checked against the
            membership on each call rather than swept;
          </li>
          <li>
            their phone — the chat lookups that decide which gates a number may open
            require an active membership, so texting the hub stops working too.
          </li>
        </ul>
        <p>
          The membership row is kept, marked revoked, rather than deleted: the roster still
          shows that they were here, and a later invite reactivates the same row. Any
          location-level rows are deleted outright, since those have no revoked state to
          sit in.
        </p>
        <p>
          Two refusals are deliberate. An account&rsquo;s last active owner cannot be
          removed (<code>409 last_owner</code>) — there is no route in the product that
          could give the account an owner back. And only an owner may remove an owner
          (<code>403 owner_removal_requires_owner</code>); admins hold every other power,
          so without that rule the two roles would be the same after one request.
        </p>
        <p className="text-ink/70">
          Temporary access <em>grants</em> are a separate mechanism with their own
          revocation — <code>POST /v1/grants/{'{id}'}/revoke</code>. Removing a member does
          not retroactively revoke grants they issued to visitors; revoke those directly.
        </p>
      </DocSection>
    </>
  );
}
