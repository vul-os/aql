import { DocLead, DocSection, CodeBlock } from './DocsLayout';

export default function PermissionsMembers() {
  return (
    <>
      <DocLead
        kicker="02 · Concepts"
        title="Permissions & Members"
        intro="Members are people invited onto an account by username; their phone number is what lets them text the gate. Roles control what they can do beyond opening it."
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
          <li>An accept token is generated, valid for 7 days. Accepting binds the invitee&rsquo;s phone number to the account — that&rsquo;s what lets them text the gate.</li>
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
        <div className="rounded-2xl border border-gold/40 bg-gold/[0.06] px-5 py-4 sm:px-6 sm:py-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink/55 font-mono">
            Status: not implemented
          </p>
          <p className="mt-2 text-[15px] text-ink/80 leading-relaxed">
            There is currently no route to remove a member or revoke their access once
            they&rsquo;ve accepted an invite — not in the hub API, not in the
            reference backend, not in the app. (Temporary access <em>grants</em> are
            different and do revoke instantly — <code>POST /v1/grants/{'{id}'}/revoke</code> —
            this gap is specifically about standing memberships.) Until member
            offboarding ships, pulling a phone number&rsquo;s access means asking your
            instance admin to edit the <code>account_members</code> row directly on the
            hub&rsquo;s own database.
          </p>
        </div>
      </DocSection>
    </>
  );
}
