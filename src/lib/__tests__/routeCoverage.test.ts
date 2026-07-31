import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * routeParity, run backwards.
 *
 * routeParity asserts every call the console makes targets a route the hub
 * serves. It cannot see the opposite failure: a route the hub serves that the
 * console has no client for. So a whole feature can be built, tested, routed
 * and completely unreachable, with every check in this repo green.
 *
 * That is not hypothetical. Five surfaces were in exactly that state when this
 * file was written — scoped API tokens, two-factor, outbound webhooks,
 * time-window rules and geofence rules. All shipped on the gateway with
 * handlers and tests; api.ts declared nothing for any of them. The gap was only
 * visible by reading server.go against api.ts by eye.
 *
 * It is the same shape as three server-side instances found the same week: the
 * MQTT driver that nothing constructed, the energy engine with no HTTP surface,
 * and the automations engine with no HTTP surface. A component being complete
 * says nothing about whether anything reaches it.
 *
 * # This is an INVENTORY, not a gate
 *
 * Plenty of routes legitimately have no console caller — inbound chat
 * webhooks, health checks, the controller's own endpoints. Those live in
 * NO_CLIENT_NEEDED with a reason each. The test's real job is to make adding a
 * route a moment where someone decides which list it belongs in, rather than a
 * thing that silently lands with no way to use it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

/**
 * Routes with no client in api.ts. Each needs a reason, and there are two kinds.
 *
 * MOST are routes the console deliberately never calls — inbound rails, the
 * controller's own transport — and those reasons are permanent.
 *
 * A few are PENDING: the hub serves it, the console will call it, and the work
 * has not landed. Those say so and name where the remaining step is written
 * down, because "nobody wired this up yet" and "a browser is not a party to
 * this" are different facts and an inventory that blurs them stops being an
 * inventory. A pending entry that outlives its plan is the thing to look for
 * when this list is next read.
 *
 * Patterns match the normalized "METHOD /path" form, with `{param}` for any
 * path variable.
 */
const NO_CLIENT_NEEDED = new Map<string, string>([
  // Inbound chat rails. These are called BY WhatsApp, Slack and Telegram, not
  // by a browser — the console is not a party to them at all.
  ['GET /webhooks/whatsapp', 'inbound rail — Meta calls this to verify the subscription'],
  ['POST /webhooks/whatsapp', 'inbound rail — Meta delivers messages here'],
  ['POST /webhooks/slack', 'inbound rail — Slack delivers events here'],
  ['POST /webhooks/slack/interactions', 'inbound rail — Slack delivers block actions here'],
  ['POST /webhooks/telegram', 'inbound rail — Telegram delivers updates here'],

  // The controller rail. A door controller dials these; it is a separate
  // program on separate hardware and the browser is never a party to them.
  ['POST /api/controller/challenge', 'controller pairing handshake — controller/ dials this, not a browser'],
  ['POST /api/controller/poll', 'controller command poll — the dial-out long-poll fallback'],
  ['POST /api/controller/ack', 'controller reports a command outcome here'],
  ['GET /api/controller/ws', 'controller websocket — the primary dial-out transport'],
  ['POST /api/pair/redeem', 'controller redeems a pairing code; never a browser call'],
  ['POST /pair/redeem', 'unversioned alias of the same controller pairing route'],

  // Machine-to-machine and liveness.
  ['GET /health', 'liveness probe; the console uses it only through testGatewayUrl'],
  ['GET /v1/gateway/key', 'controllers and phones fetch the pinned hub key, not the console'],
]);

type Route = { method: string; path: string };

/** Every route the gateway registers, via its own routegen tool.
 *
 * Memoised: this shells out to a full Go compile and three tests here want the
 * same answer. One compile instead of three is right regardless of whether it
 * prevents a timeout — see routeParity for what is and is not demonstrable about
 * the timeout that prompted this. */
let routesCache: Route[] | null = null;

function gatewayRoutes(): Route[] {
  if (routesCache) return routesCache;
  const raw = execFileSync('go', ['run', './cmd/routegen'], {
    cwd: path.join(repo, 'hub'),
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as Array<{ method: string; path: string }>;
  routesCache = parsed.map((r) => ({
    method: r.method,
    // Collapse Go's named params to one placeholder, as routeParity does.
    path: r.path.replace(/\{[^/]+\}/g, '{param}'),
  }));
  return routesCache;
}

/**
 * Route paths api.ts calls, normalized the same way.
 *
 * Template interpolations (`${accountId}`) become `{param}`, and a query string
 * is dropped — `?grain=hour` is not part of the route.
 */
function clientPaths(): Set<string> {
  const src = readFileSync(path.join(repo, 'src/lib/api.ts'), 'utf-8');
  const paths = new Set<string>();
  // Every string or template literal in the file that LOOKS like an API path.
  //
  // Deliberately not anchored to `apiFetch<...>(`: several methods build the
  // path on the following line, or append a query string, and an
  // adjacency-based regex missed those and reported working endpoints as
  // unreachable. A false "you cannot reach this" is the failure that makes
  // people add exemptions for routes that are perfectly fine.
  //
  // Matching any path-shaped literal over-accepts slightly — a path in a
  // comment would count — which is the safe direction for an inventory whose
  // job is to surface things nobody wired up at all.
  // Any literal that starts with a slash and a letter. An allowlist of known
  // prefixes was tried first and was wrong immediately — it omitted
  // `/analytics` and `/grants`, so ten working endpoints were reported as
  // having no client. An inventory that cries wolf is one nobody reads.
  for (const m of src.matchAll(/[`'"](\/[a-z][^`'"]*)[`'"]/gi)) {
    paths.add(normalize(m[1]));
  }
  return paths;
}

function normalize(p: string): string {
  let out = p.replace(/\$\{[^}]*\}/g, '{param}');
  // A NESTED template literal truncates the capture mid-interpolation, e.g.
  // `/accounts/${id}/energy/series${qs ? ` leaves a dangling `${qs ? `. Cut at
  // any `$` that survived, so the route prefix still matches. Without this,
  // every method that appends an optional query string looked unreachable.
  const dangling = out.indexOf('$');
  if (dangling >= 0) out = out.slice(0, dangling);
  // A `{param}` that does NOT follow a slash came from a query-string builder
  // interpolated onto the end (`/admin/users${adminListQs(q)}`), not from a
  // path segment. Strip it, or the route reads as /admin/users{param} and
  // never matches the real /admin/users.
  out = out.replace(/(?<!\/)\{param\}$/, '');
  out = out.split('?')[0];
  // api.ts paths are version-relative; gateway paths carry the prefix.
  if (!out.startsWith('/v1') && !out.startsWith('/webhooks') && out !== '/health') {
    out = `/v1${out}`;
  }
  return out.replace(/\/+$/, '') || '/';
}

// Pay the `go run ./cmd/routegen` compile ONCE, in a hook.
//
// Memoising alone was not enough: the FIRST caller still bore the whole
// compile, and that alone exceeded vitest's 5s per-test budget — the test
// then reports "Test timed out" instead of whatever it was checking. A hook
// has its own, separate budget, which is where setup this expensive belongs.
beforeAll(() => {
  gatewayRoutes();
});

describe('route coverage', () => {
  it('every route the hub serves has a client, or a stated reason not to', () => {
    const routes = gatewayRoutes();
    expect(routes.length, 'routegen produced nothing').toBeGreaterThan(20);

    const called = clientPaths();
    expect(called.size, 'no apiFetch calls were extracted').toBeGreaterThan(20);

    const unreachable: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (NO_CLIENT_NEEDED.has(key)) continue;
      // Path-level, not method-level — and that is a REAL limitation with a
      // known cost, not a simplification worth glossing over.
      //
      // It let one through. `POST /accounts/{id}/automations` and
      // `PUT /accounts/{id}/automations/{ruleID}` had no client at all for
      // weeks, and this test stayed green the whole time because the GET on the
      // same path was called. The console could list, toggle and delete rules
      // and could not create or edit one.
      //
      // Method-level checking was tried and NOT kept: extracting a call's HTTP
      // method reliably needs a TypeScript AST, and the regex version reported
      // twenty-five pairs of which most were false — `GET /accounts/{id}/members`
      // among them, which plainly has a client. An inventory that cries wolf is
      // one people learn to silence, which would cost more than the gap it
      // closes.
      //
      // So the limitation stands, and is written down instead: this test proves
      // a route FAMILY is reachable, never that every verb on it is. A new
      // method on an existing path is not covered by anything here.
      if (called.has(r.path)) continue;
      unreachable.push(`  ✗ ${key}`);
    }

    expect(
      unreachable.length,
      `${unreachable.length} route(s) the hub serves have no client in api.ts:\n\n` +
        unreachable.join('\n') +
        `\n\nA feature can be built, tested, routed and completely unreachable ` +
        `with every other check green — that is how scoped API tokens, 2FA, ` +
        `webhooks, time windows and geofences all shipped with no way to use ` +
        `them. Either add a client method, or add the route to ` +
        `NO_CLIENT_NEEDED with a reason if the console is genuinely not the ` +
        `caller.\n`,
    ).toBe(0);
  });

  it('every exemption carries a reason', () => {
    for (const [route, reason] of NO_CLIENT_NEEDED) {
      expect(reason.length, `${route} is exempted with no reason`).toBeGreaterThan(10);
    }
  });

  it('no exemption outlives the route it describes', () => {
    // An exemption for a route that no longer exists is dead weight that makes
    // the list look more considered than it is.
    const live = new Set(gatewayRoutes().map((r) => `${r.method} ${r.path}`));
    for (const route of NO_CLIENT_NEEDED.keys()) {
      expect(live.has(route), `${route} is exempted but the hub no longer serves it`).toBe(true);
    }
  });
});
