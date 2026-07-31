// Route-parity test — the safeguard against the exact bug that motivated
// this test's existence: src/lib/api.ts (the frontend client) drifting from
// the routes hub/internal/httpapi/server.go actually serves.
//
// The hub is the product that ships (embedded into the hub binary as the
// portal, reused by the Tauri desktop shell). Route shapes were inherited
// from a Cloudflare Workers backend that used to live in backend/; it was
// deleted, so this test checks api.ts against the hub's own routes and there
// is nothing else left to check against.
//
// How it works:
//  1. Parse api.ts's own source with the TypeScript compiler API (not
//     regex) to find every `apiFetch(path, init)` call, extracting the
//     method (from `init.method`, default GET) and the path — including
//     resolving template-literal path params (`${id}`) to a placeholder.
//  2. Shell out to `go run ./cmd/routegen` inside hub/, which parses
//     server.go's Router() with go/ast and prints every registered
//     "METHOD /v1/..." pattern as JSON. That's the single source of truth
//     for what the gateway serves — see hub/cmd/routegen/main.go.
//  3. Diff: every frontend call must have a matching gateway route, UNLESS
//     it's in KNOWN_UNAVAILABLE below (an endpoint the gateway genuinely
//     doesn't implement yet, where the frontend is expected to degrade
//     gracefully — see api.ts's per-function doc comments for why each one
//     is there). Anything else unmatched is a real drift bug and fails loudly.
import { beforeAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_VERSION_PREFIX } from '../api';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const apiTsPath = path.join(repoRoot, 'src/lib/api.ts');
const hubDir = path.join(repoRoot, 'hub');

type FrontendCall = {
  method: string;
  rawPath: string;
  normalizedPath: string;
  line: number;
};

type GatewayRoute = { method: string; path: string };

// ── frontend extraction (TypeScript AST, not regex) ────────────────────────

/**
 * Normalize a path-argument AST node to a pathname with `{param}` in place
 * of every dynamic segment, and query-string-producing expressions dropped
 * entirely.
 *
 * Heuristic for template literals: a substitution immediately after a `/`
 * (i.e. the accumulated literal text so far ends with '/') is a path
 * parameter ("/access-points/${id}" -> "/access-points/{param}"). A
 * substitution that does NOT follow a trailing slash is a query-string
 * suffix ("/grants${qs}", "/admin/accounts${adminListQs(q)}") and
 * contributes nothing to the pathname — which matches how the gateway's
 * mux patterns work (query strings are never part of the registered
 * pattern).
 */
function normalizeTemplate(node: ts.TemplateExpression): string {
  let out = node.head.text;
  for (const span of node.templateSpans) {
    if (out.endsWith('/')) {
      out += '{param}';
    }
    out += span.literal.text;
  }
  return out;
}

function pathArgToString(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text; // StringLiteral | NoSubstitutionTemplateLiteral
  if (ts.isTemplateExpression(node)) return normalizeTemplate(node);
  // `\`/a/${id}/runs\` + (limit ? \`?limit=${limit}\` : '')` — a concatenation,
  // not a template. The pathname is whatever the left side contributes; the
  // right side is a query suffix, which is never part of a mux pattern.
  //
  // Skipping these was harmless while this file only asked "does every call
  // have a route?" — a dropped call is one fewer check. It stopped being
  // harmless when the reverse question arrived: a call the extractor cannot
  // see makes its route look like it has no caller at all, and the orphan
  // test would report a wired-up feature as unreachable.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return pathArgToString(node.left);
  }
  if (ts.isParenthesizedExpression(node)) return pathArgToString(node.expression);
  return null;
}

function methodOf(args: readonly ts.Expression[]): string {
  if (args.length < 2) return 'GET';
  const init = args[1];
  if (!ts.isObjectLiteralExpression(init)) return 'GET';
  for (const prop of init.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'method' &&
      ts.isStringLiteralLike(prop.initializer)
    ) {
      return prop.initializer.text;
    }
  }
  return 'GET';
}

function normalizePath(p: string): string {
  const noQuery = p.split('?')[0];
  const trimmed = noQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function extractFrontendCalls(source: string): FrontendCall[] {
  const sf = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: FrontendCall[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'apiFetch' &&
      node.arguments.length > 0
    ) {
      const rawPath = pathArgToString(node.arguments[0]);
      if (rawPath !== null) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        calls.push({
          method: methodOf(node.arguments),
          rawPath,
          normalizedPath: normalizePath(rawPath),
          line: line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return calls;
}

// ── gateway extraction (shells out to the Go source of truth) ──────────────

// Memoised: `go run ./cmd/routegen` is a full Go compile, and five tests in this
// file need the same answer. Called per test it lands each of them on vitest's
// 5s budget — measured at 3.2s, 4.8s and one outright timeout — which reports
// "Test timed out" rather than naming any defect. Same shape already fixed twice
// in this repo, in naming.test.ts and in docCounts' exception check.
let gatewayRoutesCache: GatewayRoute[] | null = null;

function loadGatewayRoutes(): GatewayRoute[] {
  if (gatewayRoutesCache) return gatewayRoutesCache;
  const out = execFileSync('go', ['run', './cmd/routegen'], {
    cwd: hubDir,
    encoding: 'utf-8',
  });
  const routes = JSON.parse(out) as GatewayRoute[];
  gatewayRoutesCache = routes.map((r) => ({ method: r.method, path: normalizePath(r.path) }));
  return gatewayRoutesCache;
}

function normalizeGoPath(p: string): string {
  // Go 1.22 mux params are "{id}", "{token}", etc. — collapse to the same
  // placeholder the frontend normalizer emits.
  return p.replace(/\{[^/]+\}/g, '{param}');
}

// ── known, intentional gaps ────────────────────────────────────────────────
//
// EMPTY, and worth keeping that way. Every route src/lib/api.ts calls, the hub
// serves.
//
// It was not empty for a long time, and the entries were not harmless. Each
// one was a screen shipped ahead of its backend, degrading in a way somebody
// had reasoned about once and nobody had looked at since: a profile form that
// failed for every user, a maintenance panel that rendered an error, a country
// selector that fell back to one country, and a WhatsApp signup button that
// could not work. The list made all of that look managed.
//
// Adding an entry is therefore a real decision, not bookkeeping. It must come
// with a doc comment in api.ts saying why the call exists anyway and how the
// UI degrades — and preferably with a reason the route cannot simply be built.
const KNOWN_UNAVAILABLE: Array<{ method: string; path: string }> = [];

// ── the other direction ────────────────────────────────────────────────────
//
// The test above asks whether every call has a route. This table exists for
// the opposite question — whether every route has a caller — which is the one
// that has actually been failing.
//
// A route the console never calls is not a harmless spare. It is indexed as
// shipped, documented as available, counted in the API surface, and exercised
// by its own handler tests, all while being unreachable by any user. That has
// been found here five separate times: Telegram polling, phone verification,
// channel identity linking, sample pruning, queue compaction. Every one of
// them had tests that passed.
//
// So the routes below are the ones a browser is genuinely not supposed to
// reach, each with the client that does. Anything else must be callable from
// src/lib/api.ts.
const NON_CONSOLE_ROUTES: Array<{ method: string; path: string; reason: string }> = [
  { method: 'POST', path: '/api/controller/challenge', reason: 'controller firmware — device auth handshake' },
  { method: 'POST', path: '/api/controller/poll', reason: 'controller firmware — command long-poll' },
  { method: 'POST', path: '/api/controller/ack', reason: 'controller firmware — command result ack' },
  { method: 'GET', path: '/api/controller/ws', reason: 'controller firmware — websocket transport' },
  { method: 'POST', path: '/api/pair/redeem', reason: 'controller firmware — pairing redemption' },
  { method: 'POST', path: '/pair/redeem', reason: 'controller firmware — unversioned pairing alias' },
  { method: 'GET', path: '/health', reason: 'process probes and load balancers, not a user surface' },
  // The console DOES reach this — Footage.tsx puts it in a <video src> — but a
  // media element carries no method for the AST extraction above to find, and
  // api.cameraClipURL builds a URL rather than calling apiFetch. Listed here
  // rather than in UNREACHABLE_TODAY, which would be false: it is reachable,
  // it is simply not reachable through the mechanism this test can trace.
  {
    method: 'GET',
    path: '/v1/accounts/{id}/cameras/{key}/clips/{clip}',
    reason: 'console <video> element via api.cameraClipURL — a media element, not a fetch',
  },
  // Reached by LiveView.tsx, which fetches the stream and feeds it to a
  // SourceBuffer. api.cameraLiveURL builds the URL; the fetch is in the
  // component rather than in api.ts, because the response is an endless body
  // read incrementally rather than a JSON payload apiFetch could return.
  {
    method: 'GET',
    path: '/v1/accounts/{id}/cameras/{key}/live',
    reason: 'console LiveView.tsx streams this into a MediaSource — an incremental read, not an apiFetch',
  },
  { method: 'POST', path: '/webhooks/slack', reason: 'inbound provider callback (Slack)' },
  { method: 'POST', path: '/webhooks/slack/interactions', reason: 'inbound provider callback (Slack interactivity)' },
  { method: 'POST', path: '/webhooks/telegram', reason: 'inbound provider callback (Telegram)' },
  { method: 'GET', path: '/webhooks/whatsapp', reason: 'inbound provider callback (WhatsApp verify handshake)' },
  { method: 'POST', path: '/webhooks/whatsapp', reason: 'inbound provider callback (WhatsApp messages)' },
  {
    method: 'GET',
    path: '/v1/gateway/key',
    reason:
      'offline mode asks a LAN address which hub it is, via gatewayFetch in ' +
      'src/lib/offline/service.ts — it cannot go through apiFetch, whose base URL is ' +
      'the configured hub rather than the address being probed',
  },
];

// Routes that NO client can reach — not the console, and not an API token
// (server.go mounts exactly four tokenScoped routes; everything else is
// session-JWT-only). These are found, not excused.
//
// EMPTY, and it got there the honest way. The first run of this check found
// three: GET /v1/accounts/{id}, GET /v1/locations/{id} and
// GET /v1/accounts/{id}/automations/{ruleID}. Each was a single-resource GET
// duplicating a list endpoint the console does use, reachable by nothing —
// server.go mounts exactly four tokenScoped routes, so not by an API token
// either — and documented nowhere. They were deleted.
//
// What made that decision non-obvious is worth recording: the hub's own tests
// leaned on two of them as NEGATIVE space. tokens_test.go proved a scoped
// token could not reach GET /v1/locations/{id}; product_test.go used
// GET /v1/accounts/{id} as a cross-tenant 404 probe. Deleting a route can
// therefore delete coverage of a contract that has nothing to do with it, and
// the probes had to be re-anchored on routes that survive (/limits, /members)
// rather than simply dropped.
//
// This list is a RATCHET, not a parking lot. An addition means a route shipped
// that no user can reach, which is the bug this file exists to catch.
const UNREACHABLE_TODAY: Array<{ method: string; path: string }> = [];

// Pay the `go run ./cmd/routegen` compile ONCE, in a hook.
//
// Memoising alone was not enough: the FIRST caller still bore the whole
// compile, and that alone exceeded vitest's 5s per-test budget — the test
// then reports "Test timed out" instead of whatever it was checking. A hook
// has its own, separate budget, which is where setup this expensive belongs.
beforeAll(() => {
  loadGatewayRoutes();
});

describe('frontend/gateway route parity', () => {
  it('every apiFetch() call in src/lib/api.ts targets a route the gateway serves (or is an acknowledged gap)', () => {
    const source = readFileSync(apiTsPath, 'utf-8');
    const frontendCalls = extractFrontendCalls(source);
    expect(frontendCalls.length).toBeGreaterThan(20); // sanity: extraction actually ran

    const gatewayRoutes = loadGatewayRoutes();
    expect(gatewayRoutes.length).toBeGreaterThan(20); // sanity: routegen actually ran

    const gatewaySet = new Set(gatewayRoutes.map((r) => `${r.method} ${normalizeGoPath(r.path)}`));
    const unavailableSet = new Set(KNOWN_UNAVAILABLE.map((r) => `${r.method} ${r.path}`));

    const broken: string[] = [];
    const acknowledgedGaps: string[] = [];

    for (const call of frontendCalls) {
      // Every apiFetch call is sent with API_VERSION_PREFIX prepended (see
      // apiFetch in api.ts) — reproduce that here so the comparison is
      // against what actually goes over the wire.
      const wirePath = normalizePath(`${API_VERSION_PREFIX}${call.normalizedPath}`);
      const key = `${call.method} ${wirePath}`;
      // Path relative to API_VERSION_PREFIX, for the KNOWN_UNAVAILABLE table.
      const bareKey = `${call.method} ${call.normalizedPath}`;

      if (gatewaySet.has(key)) continue;
      if (unavailableSet.has(bareKey)) {
        acknowledgedGaps.push(`${bareKey}  (api.ts:${call.line} — "${call.rawPath}")`);
        continue;
      }
      broken.push(
        `${key}  (api.ts:${call.line} — apiFetch("${call.rawPath}") has no matching gateway route)`,
      );
    }

    if (broken.length > 0) {
      const gatewayList = gatewayRoutes.map((r) => `  ${r.method} ${r.path}`).join('\n');
      throw new Error(
        `${broken.length} frontend API call(s) target routes the gateway does not serve:\n\n` +
          broken.map((b) => `  ✗ ${b}`).join('\n') +
          `\n\nIf the gateway genuinely doesn't implement this yet (and the frontend degrades ` +
          `gracefully), add it to KNOWN_UNAVAILABLE in this test with a matching doc comment in ` +
          `api.ts. Otherwise this is route drift — fix the path in src/lib/api.ts.\n\n` +
          `Routes the gateway actually serves (hub/internal/httpapi/server.go):\n${gatewayList}\n`,
      );
    }

    // Not a failure, but surfaced so `vitest run --reporter=verbose` (and
    // anyone reading test output) can see the acknowledged-gap inventory
    // without having to go spelunking through api.ts comments.
    if (acknowledgedGaps.length > 0) {
      console.log(
        `\n[routeParity] ${acknowledgedGaps.length} frontend call(s) hit gateway routes that ` +
          `don't exist yet, intentionally (see KNOWN_UNAVAILABLE):\n` +
          acknowledgedGaps.map((g) => `  · ${g}`).join('\n') +
          '\n',
      );
    }
  });

  it('KNOWN_UNAVAILABLE has no stale entries (route now exists, or frontend call was removed)', () => {
    const source = readFileSync(apiTsPath, 'utf-8');
    const frontendCalls = extractFrontendCalls(source);
    const frontendKeys = new Set(frontendCalls.map((c) => `${c.method} ${c.normalizedPath}`));

    const gatewayRoutes = loadGatewayRoutes();
    const gatewaySet = new Set(gatewayRoutes.map((r) => `${r.method} ${normalizeGoPath(r.path)}`));

    const stale: string[] = [];
    for (const entry of KNOWN_UNAVAILABLE) {
      const key = `${entry.method} ${entry.path}`;
      const wireKey = `${entry.method} ${normalizePath(`${API_VERSION_PREFIX}${entry.path}`)}`;
      if (!frontendKeys.has(key)) {
        stale.push(`${key} — no apiFetch() call in api.ts uses this path anymore; remove the entry`);
      } else if (gatewaySet.has(wireKey)) {
        stale.push(`${key} — the gateway now serves this route; remove the entry and wire it up`);
      }
    }

    if (stale.length > 0) {
      throw new Error(
        `KNOWN_UNAVAILABLE in routeParity.test.ts has ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'}:\n` +
          stale.map((s) => `  ✗ ${s}`).join('\n'),
      );
    }
  });

  it('every gateway route is reachable from the console (or is an acknowledged non-console client)', () => {
    const source = readFileSync(apiTsPath, 'utf-8');
    const frontendCalls = extractFrontendCalls(source);
    expect(frontendCalls.length).toBeGreaterThan(20);

    const gatewayRoutes = loadGatewayRoutes();
    expect(gatewayRoutes.length).toBeGreaterThan(20);

    // What api.ts actually puts on the wire.
    const called = new Set(
      frontendCalls.map(
        (c) => `${c.method} ${normalizePath(`${API_VERSION_PREFIX}${c.normalizedPath}`)}`,
      ),
    );
    const allowed = new Set(NON_CONSOLE_ROUTES.map((r) => `${r.method} ${normalizePath(r.path)}`));
    const parked = new Set(UNREACHABLE_TODAY.map((r) => `${r.method} ${normalizePath(r.path)}`));

    const orphans: string[] = [];
    for (const r of gatewayRoutes) {
      const key = `${r.method} ${normalizeGoPath(r.path)}`;
      if (called.has(key) || allowed.has(`${r.method} ${r.path}`)) continue;
      if (parked.has(`${r.method} ${r.path}`)) continue;
      orphans.push(`${r.method} ${r.path}`);
    }

    if (orphans.length > 0) {
      throw new Error(
        `${orphans.length} gateway route(s) that no screen can reach:\n\n` +
          orphans.map((o) => `  ✗ ${o}`).join('\n') +
          `\n\nThe hub serving a route is not the same as the product having the feature. ` +
          `A route with no caller is documented, counted and tested while being unusable — ` +
          `that exact shape has shipped here five times.\n\n` +
          `Either wire it into src/lib/api.ts and a screen, or — if a different client speaks ` +
          `to it (controller firmware, a provider webhook, a probe) — add it to ` +
          `NON_CONSOLE_ROUTES in this test with the client named.\n`,
      );
    }
  });

  it('NON_CONSOLE_ROUTES has no stale entries and every entry names its client', () => {
    const gatewayRoutes = loadGatewayRoutes();
    const gatewaySet = new Set(gatewayRoutes.map((r) => `${r.method} ${r.path}`));

    const problems: string[] = [];

    // The ratchet only tightens if a wired-up route is taken off it. Without
    // this, parking an entry here would be permanent by default — the same
    // "looks managed" failure KNOWN_UNAVAILABLE grew.
    const source = readFileSync(apiTsPath, 'utf-8');
    const consoleCalls = new Set(
      extractFrontendCalls(source).map(
        (c) => `${c.method} ${normalizePath(`${API_VERSION_PREFIX}${c.normalizedPath}`)}`,
      ),
    );
    for (const e of UNREACHABLE_TODAY) {
      const key = `${e.method} ${normalizeGoPath(normalizePath(e.path))}`;
      if (consoleCalls.has(key)) {
        problems.push(
          `${e.method} ${e.path} — a screen calls this now; remove it from UNREACHABLE_TODAY`,
        );
      }
      if (!gatewaySet.has(`${e.method} ${normalizePath(e.path)}`)) {
        problems.push(`${e.method} ${e.path} — the gateway no longer serves this; remove the entry`);
      }
    }

    for (const e of NON_CONSOLE_ROUTES) {
      if (!gatewaySet.has(`${e.method} ${normalizePath(e.path)}`)) {
        problems.push(`${e.method} ${e.path} — the gateway no longer serves this; remove the entry`);
      }
      // A reason is what makes the entry auditable rather than a mute
      // exemption somebody added to make the suite green.
      if (e.reason.trim().length < 20) {
        problems.push(`${e.method} ${e.path} — reason is too thin to audit: "${e.reason}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});
