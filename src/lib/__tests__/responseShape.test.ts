import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The gap routeParity cannot cover.
 *
 * routeParity asserts every frontend call targets a route the hub serves. It
 * says nothing about what comes BACK. So a route can exist, return 200, and
 * carry entirely different field names from the ones the console reads — and
 * every check in this repo stays green while the UI renders "unknown".
 *
 * That is not hypothetical. Removing email identity renamed the Go side to
 * `actor_username` and `user_username`; api.ts kept declaring `actor_email` and
 * `user_email`, four components read exactly what was declared, and every actor
 * in the admin audit view, the accounts view and the Overview activity feed
 * rendered as "—" for as long as it took someone to notice by eye. It
 * typechecked throughout, because the TypeScript types agreed with each other
 * and disagreed with the server. A compiler cannot catch that: nothing in the
 * frontend knows what the hub actually sends.
 *
 * This test closes the specific hole. It extracts the JSON keys the Go handlers
 * write and the snake_case fields api.ts declares, and fails when the console
 * expects a field no handler emits.
 *
 * WHAT IT DOES NOT PROVE, stated so nobody trusts it further than it goes:
 *   - It matches key NAMES, not types, nesting or nullability.
 *   - It cannot tell which endpoint emits a key, so a field emitted by any
 *     handler satisfies a field declared anywhere.
 *   - Request-body types legitimately name fields the server never emits;
 *     those live in REQUEST_ONLY below and must be justified when added.
 * It is a drift alarm, not a contract. A real contract needs generated types.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

/**
 * Fields api.ts declares that the hub does NOT emit, legitimately. Each needs a
 * reason — an unexplained entry here is how this test quietly stops working.
 */
const REQUEST_ONLY = new Map<string, string>([
  // Request bodies: the console sends these, the hub never returns them.
  ['current_password', 'request body — POST /auth/update-password'],
  ['new_password', 'request body — password reset and update'],
  ['claim_ttl_seconds', 'request body — device create'],
  ['access_point_id', 'request body on several calls; also emitted, but keep the reason explicit'],
  ['allow_private', 'request body — webhook create'],
  ['confirm', 'request body — engine execute, the hazardous-motion second act'],
  ['account_type', 'request body — POST /auth/register'],
  ['invite_token', 'request body — POST /auth/register'],
]);

/**
 * Fields belonging to endpoints the hub does not serve YET. These are console
 * screens ahead of their backend, which routeParity already tracks by route in
 * its KNOWN_UNAVAILABLE list — this map is the field-level counterpart, kept
 * separate from REQUEST_ONLY so the two reasons never get confused.
 *
 * An entry here is a promise that the route is in routeParity's gap list too.
 * When the endpoint lands, its fields start being emitted and the entry must be
 * deleted — leaving one behind would re-open exactly the hole this file exists
 * to close.
 */
const AWAITING_ENDPOINT = new Map<string, string>([
  ['performed_at', 'access-point maintenance — GET/POST /access-points/{id}/maintenance'],
  ['performed_by', 'access-point maintenance'],
  ['technician_name', 'access-point maintenance'],
  ['cost_zar_cents', 'access-point maintenance'],
  ['next_due_in_days', 'access-point maintenance'],
  ['movement_m_at_event', 'access-point maintenance'],
]);

function goEmittedKeys(): Set<string> {
  const dir = path.join(repo, 'gateway/internal/httpapi');
  const keys = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
    const src = readFileSync(path.join(dir, f), 'utf-8');
    // JSON keys as written in map[string]any literals and struct tags.
    // Map literals: {"key": value}
    for (const m of src.matchAll(/"([a-z][a-z0-9_]*)"\s*:/g)) keys.add(m[1]);
    // Struct tags: json:"key"
    for (const m of src.matchAll(/json:"([a-z][a-z0-9_]*)/g)) keys.add(m[1]);
    // Bracket assignment: m["key"] = value. Missed on the first draft of this
    // test, which reported opens_prev_7d as an orphan when analytics.go emits
    // it exactly this way — a false positive here trains people to exempt real
    // fields, which would be worse than having no test.
    for (const m of src.matchAll(/\[\s*"([a-z][a-z0-9_]*)"\s*\]\s*=/g)) keys.add(m[1]);
  }
  return keys;
}

function tsDeclaredFields(): Map<string, number> {
  const src = readFileSync(path.join(repo, 'src/lib/api.ts'), 'utf-8');
  const lines = src.split('\n');
  const fields = new Map<string, number>();
  lines.forEach((line, i) => {
    // A snake_case object field in a type literal. camelCase is skipped: those
    // are client-side shapes, not wire fields.
    const m = /^\s+([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\??\s*:/.exec(line);
    if (m) fields.set(m[1], i + 1);
  });
  return fields;
}

describe('response shape parity', () => {
  it('every snake_case field api.ts declares is emitted by some hub handler', () => {
    const emitted = goEmittedKeys();
    const declared = tsDeclaredFields();

    const orphans: string[] = [];
    for (const [field, line] of declared) {
      if (emitted.has(field)) continue;
      if (REQUEST_ONLY.has(field)) continue;
      if (AWAITING_ENDPOINT.has(field)) continue;
      orphans.push(`  ✗ ${field}  (api.ts:${line} — no hub handler emits this key)`);
    }

    expect(
      orphans.length,
      `${orphans.length} field(s) the console reads are never sent by the hub:\n\n` +
        orphans.join('\n') +
        `\n\nThis is the actor_email class of bug: it typechecks, the route exists, ` +
        `the call returns 200, and the UI renders empty. Either rename the field to ` +
        `match the hub, or add it to REQUEST_ONLY with a reason if it is a request body.\n`,
    ).toBe(0);
  });

  it('the Go side is reachable, so a silent zero-key scan cannot pass this file', () => {
    // A test that greps can pass by finding nothing. Assert the corpus is real.
    const emitted = goEmittedKeys();
    expect(emitted.size).toBeGreaterThan(100);
    expect(emitted.has('access_point_id')).toBe(true);
  });

  it('every exemption carries a reason', () => {
    for (const [field, reason] of [...REQUEST_ONLY, ...AWAITING_ENDPOINT]) {
      expect(reason.length, `${field} is exempted with no reason`).toBeGreaterThan(10);
    }
  });

  it('the maintenance endpoints are still genuinely unserved', () => {
    // AWAITING_ENDPOINT is a promise that routeParity tracks the same gap. If
    // the endpoint lands and nobody clears these, this file goes quiet about
    // fields it should be checking.
    const parity = readFileSync(path.join(here, 'routeParity.test.ts'), 'utf-8');
    expect(
      parity.includes('/access-points/{param}/maintenance'),
      'maintenance is no longer an acknowledged gap — clear AWAITING_ENDPOINT ' +
        'so its fields are checked again',
    ).toBe(true);
  });
});

// Keep the import used even if execFileSync is not needed, so the intent of
// running against the real tree stays obvious to the next reader.
void execFileSync;
