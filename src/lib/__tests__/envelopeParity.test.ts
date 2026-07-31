import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The gap responseShape leaves open, closed per endpoint.
 *
 * responseShape asks whether a field name is emitted by ANY handler. That is
 * useful and it is not enough, and its own header says so — it cannot tell
 * which endpoint emits a key, so a field emitted anywhere satisfies a field
 * declared anywhere.
 *
 * That limitation has teeth. `api.ts` declared the time-window and geofence
 * lists as `{ rules: … }` while the hub sends `{ time_windows: … }` and
 * `{ geofences: … }`. `rules` IS a real key — the automations list emits it —
 * so the name-only check passed, tsc passed, every test passed, and both
 * screens would have rendered an empty list forever with no error anywhere.
 *
 * The fix is correlation rather than a bigger word list: `routegen` now reports,
 * per route, the handler it is bound to and the TOP-LEVEL keys that handler
 * writes in a `writeJSON(..., map[string]any{...})` literal. This test matches
 * each `apiFetch<{ … }>` inline envelope against the envelope of the route it
 * actually calls.
 *
 * WHAT IT STILL DOES NOT PROVE:
 *   - Only INLINE object types are checked. `apiFetch<AutomationRule>` names a
 *     declared type and is skipped — resolving those needs a TypeScript AST,
 *     not a regex.
 *   - Only handlers whose body is a literal map are checked. One that builds a
 *     variable first reports no envelope and is skipped rather than guessed at.
 *   - It says nothing about nested shapes or types.
 * It closes one specific hole exactly: the wrong envelope around right fields.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

type Route = { method: string; path: string; handler?: string; envelope?: string[] };

// Memoised and warmed in a hook, like routeParity and routeCoverage.
//
// This file looked fast — 353ms — plausibly because those two run first and
// leave Go's build cache warm; worker ordering is not guaranteed. Two compiles
// where one will do is worth removing on its own. What this is NOT is a
// demonstrated timeout fix: see routeParity's note for why that causal claim
// could not be reproduced.
let routesCache: Route[] | null = null;

function gatewayRoutes(): Route[] {
  if (routesCache) return routesCache;
  const raw = execFileSync('go', ['run', './cmd/routegen'], {
    cwd: path.join(repo, 'hub'),
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
  routesCache = JSON.parse(raw) as Route[];
  return routesCache;
}

/** Normalize a path the way routeParity does, so the two agree. */
function normalize(p: string): string {
  let out = p.replace(/\$\{[^}]*\}/g, '{param}');
  const dangling = out.indexOf('$');
  if (dangling >= 0) out = out.slice(0, dangling);
  out = out.split('?')[0];
  out = out.replace(/(?<!\/)\{param\}$/, '');
  if (!out.startsWith('/v1') && !out.startsWith('/webhooks') && out !== '/health') {
    out = `/v1${out}`;
  }
  return out.replace(/\/+$/, '') || '/';
}

/**
 * Every `apiFetch<{ ... }>('path'...)` call with an INLINE object type, paired
 * with the top-level keys that type declares.
 */
function inlineEnvelopes(): Array<{ path: string; keys: string[]; line: number }> {
  const src = readFileSync(path.join(repo, 'src/lib/api.ts'), 'utf-8');
  const out: Array<{ path: string; keys: string[]; line: number }> = [];

  // apiFetch<{ ... }>( then, within the next few hundred characters, the path
  // literal. The type argument is matched by balancing braces so a nested
  // object inside it does not end the match early.
  const re = /apiFetch<\s*\{/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
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
    const typeBody = src.slice(open + 1, i);

    // The call's path literal: the first string or template after the type.
    const after = src.slice(i, i + 400);
    const pm = /[`'"](\/[^`'"]*)[`'"]/.exec(after);
    if (!pm) continue;

    // TOP-LEVEL keys only. A key inside a nested object belongs to that object.
    const keys: string[] = [];
    let nest = 0;
    let start = 0;
    for (let j = 0; j < typeBody.length; j++) {
      const ch = typeBody[j];
      if (ch === '{' || ch === '[' || ch === '(' || ch === '<') nest++;
      else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') nest--;
      else if (nest === 0 && ch === ':') {
        const raw = typeBody.slice(start, j).trim().replace(/\?$/, '');
        if (/^[a-z][a-z0-9_]*$/.test(raw)) keys.push(raw);
        // Skip to the next top-level `;` or `,`.
        let vnest = 0;
        for (j++; j < typeBody.length; j++) {
          const c = typeBody[j];
          if (c === '{' || c === '[' || c === '(' || c === '<') vnest++;
          else if (c === '}' || c === ']' || c === ')' || c === '>') vnest--;
          else if ((c === ';' || c === ',') && vnest === 0) break;
        }
        start = j + 1;
      }
    }
    if (keys.length === 0) continue;

    out.push({
      path: normalize(pm[1]),
      keys,
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

// Pay the routegen compile once, in a hook with its own budget.
beforeAll(() => {
  gatewayRoutes();
});

describe('response envelope parity', () => {
  it('every inline response envelope matches the route it actually calls', () => {
    const routes = gatewayRoutes();
    expect(routes.length, 'routegen produced nothing').toBeGreaterThan(20);

    // path -> union of every envelope key any method on that path emits.
    // Method-level would be stricter, but api.ts's inline types are not always
    // adjacent enough to their method to read reliably, and the bug this file
    // exists for is a path-level mismatch.
    const byPath = new Map<string, Set<string>>();
    for (const r of routes) {
      if (!r.envelope?.length) continue;
      const norm = r.path.replace(/\{[^/]+\}/g, '{param}');
      const set = byPath.get(norm) ?? new Set<string>();
      for (const k of r.envelope) set.add(k);
      byPath.set(norm, set);
    }
    expect(byPath.size, 'no envelopes were extracted').toBeGreaterThan(10);

    const mismatches: string[] = [];
    for (const call of inlineEnvelopes()) {
      const emitted = byPath.get(call.path);
      // No envelope known for that route — the handler does not build a literal
      // map, or the path is not one the hub serves (routeParity owns that).
      if (!emitted) continue;

      const missing = call.keys.filter((k) => !emitted.has(k));
      if (missing.length === call.keys.length) {
        // EVERY declared key is absent. That is the wrong-envelope bug, not a
        // partially-declared type: a caller reading any of these gets
        // undefined, and a list renders permanently empty.
        mismatches.push(
          `  ✗ ${call.path} (api.ts:${call.line})\n` +
            `      console reads: ${call.keys.join(', ')}\n` +
            `      hub sends:     ${[...emitted].sort().join(', ')}`,
        );
      }
    }

    expect(
      mismatches.length,
      `${mismatches.length} endpoint(s) are read under the wrong envelope:\n\n` +
        mismatches.join('\n') +
        `\n\nEvery key the console declares for these routes is absent from what ` +
        `the hub sends, so the response reads as undefined and a list renders ` +
        `empty forever — with no error anywhere. responseShape cannot catch this: ` +
        `the key names are real, just on a different endpoint.\n`,
    ).toBe(0);
  });

  it('routegen reports handlers and envelopes, so this file cannot pass on nothing', () => {
    const routes = gatewayRoutes();
    const withHandler = routes.filter((r) => r.handler).length;
    const withEnvelope = routes.filter((r) => r.envelope?.length).length;
    expect(withHandler, 'no route resolved to a handler name').toBeGreaterThan(50);
    expect(withEnvelope, 'no handler yielded an envelope').toBeGreaterThan(10);

    // The exact route whose mismatch prompted this file.
    const tw = routes.find((r) => r.path.endsWith('/time-windows') && r.method === 'GET');
    expect(tw?.envelope).toContain('time_windows');
  });
});
