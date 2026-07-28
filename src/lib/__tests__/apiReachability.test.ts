import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The frontend twin of hub/internal/store/reachability_test.go.
 *
 * routeParity already proves every `api.X` call targets a route the hub serves.
 * Nothing proved the other direction: that a client method the console ships is
 * ever CALLED by a screen. A method nobody calls is a feature no user can
 * reach, and this repo has produced that shape repeatedly on both sides of the
 * wire — a verified phone nobody could obtain, a chat identity nothing could
 * bind, a retention window that never ran.
 *
 * The frontend version has its own flavour of the same defect: the hub serves
 * the route, api.ts wraps it, the docs describe it, and no screen offers it. It
 * looks finished from every angle except using it. "Log out everywhere" was
 * exactly that — a session-security control reachable only with curl.
 *
 * WHAT THIS CANNOT SEE. A method called from a component that no route renders
 * still counts as reached, and a method called inside dead branches counts too.
 * This catches "nothing anywhere calls it", which is the case that keeps
 * happening — not unreachability in general.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const apiPath = path.join(repo, 'src/lib/api.ts');

/**
 * Every entry is a claim that the console genuinely should not call this, and
 * needs a reason that still makes sense to whoever reads it next. "Not needed
 * yet" is not a reason — that is unfinished work, and it belongs in todo.
 *
 * This list started three entries longer. adminAccount and adminClaimState
 * were never uncalled at all: the scan that produced this list could not see
 * `api\n  .method()`, so I wrote reasons for two methods the admin screens
 * have always called. Fabricated exemptions are worse than none — they read as
 * a decision someone made. Both are gone, and callRe now matches the chained
 * form.
 */
const ALLOWED_UNCALLED: Record<string, string> = {
  refresh:
    'Redundant with the token-refresh the request interceptor performs itself: apiFetch ' +
    'retries a 401 by calling /auth/refresh through gatewayFetch directly (see api.ts, the ' +
    'refresh block near the top) rather than through this wrapper. Two ways to refresh a ' +
    'session, one of them unused — kept because it is part of the exported client surface, ' +
    'but no screen should grow a second refresh path.',
  grant:
    'Fetches ONE temporary-access grant by id. The Grants screen lists them with grants() ' +
    'and renders from that list; there is no single-grant detail route in the console.',
  accountsList:
    'The console resolves the caller’s accounts through the auth/me payload and its ' +
    'account context, not by listing them here.',
  accountCreate:
    'Account creation happens through registration (an account is created with its owner); ' +
    'there is no second path in the console that creates a bare account.',
};

/**
 * Matches `api.method(` INCLUDING the chained-on-a-new-line form:
 *
 *     api
 *       .railDisclosures()
 *
 * The first version of this file required `api.` to be contiguous, and that
 * was a real hole rather than a nicety. It did not just under-report calls —
 * it meant a method that had since been wired up still looked uncalled, so the
 * stale-allowlist check stayed quiet and the allowlist widened silently. Found
 * by writing exactly that call style in RailDisclosureSection.tsx and noticing
 * the rot check did not fire.
 */
function callRe(name: string): RegExp {
  return new RegExp(`\\bapi\\s*\\.\\s*${name}\\b`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && p !== apiPath) out.push(p);
  }
  return out;
}

describe('every api client method is reachable from the console', () => {
  const apiSrc = readFileSync(apiPath, 'utf-8');

  // Members of the exported `api` object: two-space indent, name, colon, arrow.
  const methods = [...apiSrc.matchAll(/^ {2}(\w+):\s*\(/gm)].map((m) => m[1]);

  it('extracted the client surface (a scan that found nothing would pass)', () => {
    expect(methods.length).toBeGreaterThan(60);
  });

  it('has no method that no screen calls', () => {
    const files = walk(path.join(repo, 'src'));
    expect(files.length, 'the source walk is broken, not the code').toBeGreaterThan(30);

    const bodies = files.map((f) => readFileSync(f, 'utf-8'));
    const called = new Set<string>();
    for (const name of methods) {
      const re = callRe(name);
      if (bodies.some((b) => re.test(b))) called.add(name);
    }

    const uncalled = methods.filter((m) => !called.has(m) && !(m in ALLOWED_UNCALLED)).sort();
    expect(
      uncalled,
      `these api methods are never called by any screen, so the feature behind each one ` +
        `cannot be reached by a user:\n  ${uncalled.join('\n  ')}\n\n` +
        `The hub serving the route and api.ts wrapping it is not the same as the console ` +
        `offering it. If the screen is unbuilt, that is work — put it in todo. If the ` +
        `console genuinely should never call it, add it to ALLOWED_UNCALLED with a reason.`,
    ).toEqual([]);

  });

  // Deliberately its own block. The first version of this test asserted
  // staleness AFTER the uncalled-methods assertion in the same `it`, so an
  // expect() failure there meant the rot check never ran at all — a check
  // hiding behind another check's failure, which is the exact shape this
  // repo keeps producing and this file exists to catch.
  it('has no stale allowlist entry', () => {
    const files = walk(path.join(repo, 'src'));
    const bodies = files.map((f) => readFileSync(f, 'utf-8'));
    const stale = Object.keys(ALLOWED_UNCALLED)
      .filter((m) => {
        if (!methods.includes(m)) return true;
        const re = callRe(m);
        return bodies.some((b) => re.test(b));
      })
      .sort();
    expect(
      stale,
      `ALLOWED_UNCALLED exempts methods that are now called (or no longer exist): ` +
        `${stale.join(', ')} — remove those entries, or the allowlist quietly widens ` +
        `what this test permits.`,
    ).toEqual([]);
  });

  it('every allowlist entry carries a real reason', () => {
    for (const [name, reason] of Object.entries(ALLOWED_UNCALLED)) {
      expect(reason.length, `${name}'s allowlist reason is too thin to be useful`).toBeGreaterThan(
        60,
      );
    }
  });
});
