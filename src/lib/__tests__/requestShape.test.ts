import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The other direction, and the one that fails hardest.
 *
 * responseShape.test.ts checks what comes BACK. This checks what goes OUT, and
 * the failure it guards against is strictly worse than a blank field.
 *
 * `readJSON` in hub/internal/httpapi/server.go calls
 * `json.Decoder.DisallowUnknownFields()`. So a request body carrying a key no
 * Go request struct declares does not get ignored — the WHOLE request is
 * refused with 400 invalid_json. One stale key breaks the entire endpoint.
 *
 * That is not hypothetical either. Removing email identity renamed the hub's
 * login and register fields to `username`; api.ts went on sending
 * `{ email, password }`. Every login and every registration returned 400. The
 * app could not be signed into at all, it typechecked throughout, the route
 * existed, and responseShape stayed green because it only ever looked at
 * response fields.
 *
 * WHAT THIS DOES NOT PROVE, stated so nobody trusts it further than it goes:
 *   - It matches key NAMES against the union of ALL Go request structs, not
 *     against the specific handler being called. A key accepted by any
 *     endpoint satisfies a key sent by any other.
 *   - It cannot see keys built dynamically or spread from a variable.
 *   - It says nothing about types, or about required-vs-optional.
 * It is a drift alarm for the one failure mode that takes a whole endpoint
 * down. A real contract needs generated types.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

/**
 * Keys api.ts sends that no Go request struct declares, legitimately. Each
 * needs a reason — an unexplained entry is how this test quietly stops working.
 */
const NOT_A_HUB_REQUEST_FIELD = new Map<string, string>([
  // Sent to routes the hub does not serve. api.ts documents each of these
  // inline as NOT IMPLEMENTED; routeParity tracks them by route.
  //
  // NOT here: token / new_password / current_password. Those looked like gaps
  // when this file was written, because api.ts still carried a stale "NOT
  // IMPLEMENTED" comment above them — but forgot-password, reset-password and
  // update-password are all served (authrecovery.go), so they are checked like
  // anything else. Exempting a field on the strength of an out-of-date comment
  // is how an alarm ends up covering less than it claims.
  //
  // NOT here either, and for the same reason one step later: avatar_url. It was
  // exempted as "no /auth/profile route on the hub" — and PATCH
  // /v1/auth/me/profile is served (profile.go declares `json:"avatar_url"`,
  // server.go wires it, api.ts's own comment says "Served by the hub"). The
  // exemption outlived the gap it described, which is why the test below now
  // fails on any entry here that the hub has since started accepting.
  ['slack_user_id', 'Slack profile link — no /auth/slack route on the hub'],
  ['slack_handle', 'Slack profile link — no /auth/slack route on the hub'],
  ['is_primary', 'phone add — the /phones routes take no is_primary on any body'],
]);

/** Every JSON key a Go request struct will accept, across all handlers. */
function goAcceptedRequestKeys(): Set<string> {
  const dir = path.join(repo, 'hub/internal/httpapi');
  const keys = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
    const src = readFileSync(path.join(dir, f), 'utf-8');
    // `json:"key"` on any struct field. Deliberately not restricted to structs
    // whose names look like requests: a shared type used as a request body
    // would be missed, and a false "you cannot send this" is the failure that
    // trains people to add exemptions for valid keys.
    for (const m of src.matchAll(/json:"([a-z][a-z0-9_]*)/g)) keys.add(m[1]);
  }
  return keys;
}

/**
 * Keys api.ts puts in a request body.
 *
 * Two forms are read, because api.ts uses both: a typed `body: { ... }`
 * parameter, and a literal `body: { ... }` passed to apiFetch. Shorthand
 * (`{ refresh_token }`) counts as sending that key under that name, which is
 * exactly what it does at runtime.
 */
function tsSentKeys(): Map<string, number> {
  const src = readFileSync(path.join(repo, 'src/lib/api.ts'), 'utf-8');
  const sent = new Map<string, number>();

  // Scan characters, not lines. A line-based reader with a running brace depth
  // over-counts: `apiFetch<T>('/p', { method: 'POST', body: { refresh_token } })`
  // has braces belonging to the options object as well as to the body, and the
  // reader spills out of the body and starts reporting `method`, `ok` and
  // response-type fields as things the console sends. Exempting those would
  // have been the wrong fix — a drift alarm that reports real-looking
  // non-problems is one people learn to silence.
  //
  // So: find each `body:` followed by `{`, then walk forward balancing braces
  // and read only what is genuinely inside that one object.
  const bodyAt = /\bbody:\s*\{/g;
  for (let m = bodyAt.exec(src); m !== null; m = bodyAt.exec(src)) {
    const open = src.indexOf('{', m.index);
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = src.slice(open + 1, i);
    const lineOf = (offset: number) =>
      src.slice(0, open + 1 + offset).split('\n').length;

    // Only keys at the TOP level of this object. A nested object is a value,
    // and its keys are not keys of the request body.
    let nest = 0;
    let keyStart = 0;
    for (let j = 0; j < inner.length; j++) {
      const ch = inner[j];
      if (ch === '{' || ch === '[' || ch === '(' || ch === '<') nest++;
      else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') nest--;
      // `;` as well as `,`: api.ts writes bodies in two forms, and the TYPED
      // parameter form (`body: { username: string; password: string }`)
      // separates with semicolons. Reading only commas silently halved the
      // corpus — `password` was never seen at all.
      else if (nest === 0 && (ch === ',' || ch === ';' || ch === ':')) {
        const raw = inner.slice(keyStart, j).trim();
        // A bare identifier: `refresh_token` (shorthand) or the name before a
        // colon. Anything else — a string, a call, a spread — is not a key.
        if (/^[a-z][a-z0-9_]*$/.test(raw)) sent.set(raw, lineOf(keyStart));
        if (ch === ':') {
          // Skip the value: advance to the next top-level comma.
          let vnest = 0;
          for (j++; j < inner.length; j++) {
            const c = inner[j];
            if (c === '{' || c === '[' || c === '(' || c === '<') vnest++;
            else if (c === '}' || c === ']' || c === ')' || c === '>') vnest--;
            else if ((c === ',' || c === ';') && vnest === 0) break;
          }
        }
        keyStart = j + 1;
      }
    }
    const tail = inner.slice(keyStart).trim();
    if (/^[a-z][a-z0-9_]*$/.test(tail)) sent.set(tail, lineOf(keyStart));
  }
  return sent;
}

describe('request shape parity', () => {
  it('every key api.ts sends is a key some hub handler accepts', () => {
    const accepted = goAcceptedRequestKeys();
    const sent = tsSentKeys();

    const rejected: string[] = [];
    for (const [key, line] of sent) {
      if (accepted.has(key)) continue;
      if (NOT_A_HUB_REQUEST_FIELD.has(key)) continue;
      rejected.push(`  ✗ ${key}  (api.ts:${line} — no hub request struct declares this key)`);
    }

    expect(
      rejected.length,
      `${rejected.length} key(s) the console sends would be REFUSED by the hub:\n\n` +
        rejected.join('\n') +
        `\n\nreadJSON calls DisallowUnknownFields, so an unknown key does not get ` +
        `ignored — it 400s the entire request. This is the class of bug that made ` +
        `every login return invalid_json while the frontend typechecked. Either ` +
        `rename the key to match the hub, or add it to NOT_A_HUB_REQUEST_FIELD ` +
        `with a reason if it targets a route the hub does not serve.\n`,
    ).toBe(0);
  });

  it('both corpora are real, so a silent zero-key scan cannot pass this file', () => {
    // A test that greps can pass by finding nothing. Assert both sides parsed.
    expect(goAcceptedRequestKeys().size).toBeGreaterThan(50);
    const sent = tsSentKeys();
    expect(sent.size).toBeGreaterThan(20);
    // The specific keys whose absence caused the outage this file exists for.
    expect(sent.has('username'), 'api.ts no longer sends a username anywhere').toBe(true);
    expect(sent.has('password')).toBe(true);
  });

  it('the hub really does reject unknown request fields', () => {
    // The premise of the whole file. If readJSON ever stopped calling
    // DisallowUnknownFields, an unknown key would become harmless and this
    // test would be enforcing a rule that no longer exists — still worth
    // having, but for a much weaker reason, and the comments above would be
    // wrong. Assert the premise rather than assuming it.
    const server = readFileSync(
      path.join(repo, 'hub/internal/httpapi/server.go'),
      'utf-8',
    );
    expect(
      server.includes('DisallowUnknownFields()'),
      'readJSON no longer rejects unknown fields — re-read this file’s premise',
    ).toBe(true);
  });

  it('every exemption carries a reason', () => {
    for (const [key, reason] of NOT_A_HUB_REQUEST_FIELD) {
      expect(reason.length, `${key} is exempted with no reason`).toBeGreaterThan(10);
    }
  });

  it('every exemption is still a key the hub does not accept', () => {
    // An exemption is a statement about the hub, and the hub keeps changing.
    //
    // avatar_url sat here reading "no /auth/profile route on the hub" long
    // after PATCH /v1/auth/me/profile started serving it. Nothing failed:
    // an unnecessary exemption passes quietly, which is precisely why it
    // survived — and why the list slowly stops describing anything real.
    // Same shape as docCitations' "every historical exemption is still a file
    // that does not exist".
    const accepted = goAcceptedRequestKeys();
    const outdated = [...NOT_A_HUB_REQUEST_FIELD.keys()].filter((k) => accepted.has(k));
    expect(
      outdated,
      'the hub now accepts these — drop the exemption so the key is checked like any other',
    ).toEqual([]);
  });
});
