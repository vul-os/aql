import { DocLead, DocSection, CodeBlock } from './DocsLayout';

export default function ApiReference() {
  return (
    <>
      <DocLead
        kicker="03 · Reference"
        title="API reference"
        intro="The HTTP API isn't required to use Aql — most users only ever touch the WhatsApp interface. But if you're integrating with property management software, building a kiosk, or wiring a Slack bot, this is for you. JSON in, JSON out, REST-shaped, no GraphQL."
      />

      <DocSection heading="Base URL">
        <p>
          Aql is self-hosted, so the base URL is wherever <em>you</em> deployed the
          hub. Every example below uses a placeholder — substitute your own host.
        </p>
        <CodeBlock lang="plain">{`Your hub       https://<your-hub>/v1
Local dev      http://localhost:8080/v1  (default -listen for ./gateway)`}</CodeBlock>
      </DocSection>

      <DocSection heading="Authentication">
        <p>
          Tokens are scoped to specific locations and roles. Carry them in the{' '}
          <code>Authorization</code> header on every request. A{' '}
          <strong>Settings → API tokens</strong> screen in the dashboard is <em>planned</em> —
          until it lands, tokens are provisioned on the hub itself.
        </p>
        <CodeBlock lang="http" title="every request">{`Authorization: Bearer lintel_live_xxxxxxxxxxxxxxxx
Accept: application/json`}</CodeBlock>
        <p>
          Token prefixes:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li><code>lintel_live_</code> — production traffic, opens real gates.</li>
          <li><code>lintel_test_</code> — sandbox, never opens a real gate.</li>
          <li><code>lintel_dev_</code> — device-to-hub session token, cycles automatically.</li>
        </ul>
      </DocSection>

      <DocSection heading="Errors">
        <p>
          All errors share one shape. The <code>error</code> code is stable; the <code>detail</code>
          is human-readable and may change over time.
        </p>
        <CodeBlock lang="json">{`{
  "error": "invalid_token",
  "detail": "Token missing, malformed, or revoked."
}`}</CodeBlock>
        <p>Common codes you can program against:</p>
        <CodeBlock lang="plain">{`401  invalid_token              token missing, malformed, or revoked
403  not_account_admin          token doesn't have the required role
404  not_found                  lookup miss for an event / resource id
400  validation_error           shape doesn't match the schema (issues[] included)
429  rate_limited               cool down + retry; never affects opens
500  internal_error             check your hub logs; the request id is in X-Request-Id`}</CodeBlock>
      </DocSection>

      <DocSection heading="Open an access point">
        <p>The bread-and-butter endpoint. Same code path as a WhatsApp <em>open</em>.</p>
        <CodeBlock lang="bash" title="curl">{`curl -X POST https://<your-hub>/v1/access-points/ap_ABC123/open \\
  -H "Authorization: Bearer lintel_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "actor": { "phone": "+27825550144" }
  }'`}</CodeBlock>
        <CodeBlock lang="ts" title="TypeScript (fetch)">{`const r = await fetch(
  'https://<your-hub>/v1/access-points/ap_ABC123/open',
  {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${process.env.AQL_TOKEN}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      actor: { phone: '+27825550144' },
    }),
  },
);
const event = await r.json();`}</CodeBlock>
        <CodeBlock lang="python" title="Python (requests)">{`import os, requests

r = requests.post(
    "https://<your-hub>/v1/access-points/ap_ABC123/open",
    headers={"Authorization": f"Bearer {os.environ['AQL_TOKEN']}"},
    json={
        "actor": {"phone": "+27825550144"},
    },
    timeout=10,
)
r.raise_for_status()
event = r.json()`}</CodeBlock>
        <CodeBlock lang="go" title="Go (net/http)">{`package main

import (
    "bytes"
    "encoding/json"
    "net/http"
    "os"
)

func openGate() (*http.Response, error) {
    body, _ := json.Marshal(map[string]any{
        "actor": map[string]string{"phone": "+27825550144"},
    })
    req, _ := http.NewRequest(
        "POST",
        "https://<your-hub>/v1/access-points/ap_ABC123/open",
        bytes.NewReader(body),
    )
    req.Header.Set("Authorization", "Bearer "+os.Getenv("AQL_TOKEN"))
    req.Header.Set("Content-Type", "application/json")
    return http.DefaultClient.Do(req)
}`}</CodeBlock>
        <CodeBlock lang="json" title="200 OK">{`{
  "event_id": "ev_01HZ4B7Q2K7VJ",
  "status": "succeeded",
  "opened_at": "2026-05-14T14:02:11.842Z",
  "latency_ms": 1834
}`}</CodeBlock>
      </DocSection>

      <DocSection heading="List events">
        <p>
          Read-only feed of everything that has happened on a location, paginated. Filterable by
          <code> kind</code>, <code>actor</code>, <code>since</code>, <code>until</code>.
        </p>
        <CodeBlock lang="bash">{`curl -G https://<your-hub>/v1/events \\
  -H "Authorization: Bearer lintel_live_xxxxxxxxxxxxxxxx" \\
  --data-urlencode "location=loc_oak" \\
  --data-urlencode "since=2026-05-01" \\
  --data-urlencode "kind=open.succeeded"`}</CodeBlock>
        <CodeBlock lang="json">{`{
  "events": [
    {
      "id": "ev_01HZ4B7Q2K7VJ",
      "kind": "open.succeeded",
      "actor": { "phone": "+27825550144" },
      "access_point_id": "ap_ABC123",
      "at": "2026-05-04T14:02:11Z",
      "latency_ms": 1834
    }
  ],
  "next_cursor": "evc_01HZ4G…"
}`}</CodeBlock>
      </DocSection>

      <DocSection heading="Webhooks">
        <p>
          Outbound webhooks ship. Manage subscriptions at{' '}
          <code>GET/POST /v1/accounts/{'{id}'}/webhooks</code> and{' '}
          <code>DELETE /v1/accounts/{'{id}'}/webhooks/{'{webhookID}'}</code> (admin only).
          The event vocabulary is closed and currently has two members:{' '}
          <code>access.opened</code> and <code>access.denied</code>. The payload
          deliberately carries no member identity — a webhook target is an address on
          somebody else&rsquo;s network.
        </p>
        <p>
          The signature is HMAC-SHA256, lowercase hex, over{' '}
          <code>timestamp + &quot;.&quot; + rawBody</code> — the timestamp is{' '}
          <em>inside</em> the preimage, so it cannot be altered without invalidating the
          signature. Verify against the raw bytes before parsing. Delivery is at most 3
          attempts with linear backoff, redirects are never followed, and the response body
          is never read. Full profile, delivery semantics and executable vectors:{' '}
          <code>proto/WEBHOOK-PROFILE.md</code> and{' '}
          <code>proto/vectors/webhooks.json</code>.
        </p>
        <CodeBlock lang="ts" title="Verify a webhook (Node)">{`import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody must be the UNPARSED request body. If your framework already
// parsed and discarded the bytes, fix that first — you cannot verify without them.
export function verifyAqlWebhook(rawBody: string, headers: Headers, secret: string) {
  const ts = headers.get('X-Aql-Timestamp') ?? '';
  const signature = headers.get('X-Aql-Signature-256') ?? '';

  // Reject stale deliveries. The hub cannot enforce your tolerance for you.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const expected = createHmac('sha256', secret).update(\`\${ts}.\${rawBody}\`).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}`}</CodeBlock>
        <CodeBlock lang="python" title="Verify a webhook (Python / Flask)">{`import hmac, hashlib, time

def verify_aql_webhook(raw_body: bytes, headers, secret: str) -> bool:
    ts = headers.get("X-Aql-Timestamp", "")
    signature = headers.get("X-Aql-Signature-256", "")
    if not ts.isdigit() or abs(time.time() - int(ts)) > 300:
        return False
    preimage = ts.encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), preimage, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)`}</CodeBlock>
        <CodeBlock lang="json" title="access.opened payload">{`{
  "access_point": "ap_main",
  "command": "open",
  "event": "access.opened",
  "location": "loc_office",
  "log_id": "log_000000000001"
}`}</CodeBlock>
        <p>
          Retries re-sign with a fresh timestamp, so the same event arrives with a
          different signature each attempt. De-duplicate on <code>log_id</code>, not on the
          signature.
        </p>
      </DocSection>

      <DocSection heading="Rate limits">
        <p>
          The open path itself is rate-limited — cooldowns, hourly caps, and any admin-set
          daily quotas — enforced at one choke point shared by the portal, the API and every
          chat channel, so no path can be picked to bypass it. A denied open returns{' '}
          <code>429</code> with a <code>Retry-After</code> header; the reason lands in{' '}
          <code>error</code>. See <a
            href="https://github.com/vul-os/aql/blob/main/site/docs/limits.md"
            className="underline underline-offset-4 decoration-terracotta"
          >Rate limits &amp; quotas</a> for the exact defaults. A separate, generic
          per-token throttle across the rest of the HTTP API (with <code>X-RateLimit-*</code>{' '}
          headers) is a reasonable future addition but doesn&rsquo;t exist yet — don&rsquo;t
          program against those headers today.
        </p>
        <CodeBlock lang="http" title="response when the open path is limited">{`HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json

{ "error": "rate_limited", "detail": "Slow down and try again shortly." }`}</CodeBlock>
      </DocSection>

      <DocSection heading="SDK (preview)">
        <p>
          A first-party TypeScript SDK is planned. Until it lands in npm, the recommended path is
          a small wrapper around <code>fetch</code>:
        </p>
        <CodeBlock lang="ts" title="lib/aql.ts">{`export class Aql {
  constructor(
    private token: string,
    private base = 'https://<your-hub>/v1',
  ) {}

  async open(accessPointId: string, body: OpenBody): Promise<OpenEvent> {
    const r = await fetch(\`\${this.base}/access-points/\${accessPointId}/open\`, {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${this.token}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw await r.json();
    return await r.json();
  }
}

export interface OpenBody {
  actor: { phone: string };
}
export interface OpenEvent {
  event_id: string;
  status: 'succeeded' | 'denied' | 'queued';
  opened_at: string;
  latency_ms: number;
}`}</CodeBlock>
      </DocSection>
    </>
  );
}
