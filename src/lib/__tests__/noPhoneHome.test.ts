import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * "No telemetry. The binaries emit no usage data anywhere."
 *
 * docs/THREAT-MODEL.md marks that Shipped, and README repeats it. It is the
 * kind of claim that breaks by ACCRETION rather than by decision: a version
 * check "just to warn about old builds", a crash reporter added while
 * debugging, a dependency that pings on init. Each is a small, reasonable
 * change, and any of them makes a sentence on the front page false.
 *
 * So every hard-coded external host in the two shipped binaries is listed here
 * with a reason. A new one fails until somebody writes down why it is there —
 * which is the whole mechanism, because the failure mode is nobody noticing
 * rather than nobody caring.
 *
 * # Why hosts and not "outbound calls"
 *
 * Most of what these binaries dial is OPERATOR-CONFIGURED and cannot be listed:
 * a broker address, a camera's RTSP URL, a Modbus PLC. Those are the product
 * working. What distinguishes a phone-home is that the destination is chosen by
 * US and compiled in, and that is exactly what a literal host in the source is.
 */

const root = resolve(__dirname, '../../..');

/**
 * Hosts that may appear literally in shipped Go, and why.
 *
 * Two kinds, deliberately not collapsed. XML NAMESPACE URIs are identifiers
 * that happen to look like URLs and are never dialled — ONVIF's own schema
 * names them. CHAT RAIL endpoints are real outbound calls, and they are not
 * phone-home because a rail only runs when an operator has configured a
 * credential for it, and README's "What the chat rails actually cost you"
 * says what using one gives away.
 */
const ALLOWED: Record<string, string> = {
  'www.onvif.org': 'XML namespace identifier (ONVIF schema) — never dialled',
  'docs.oasis-open.org': 'XML namespace identifier (WS-Security) — never dialled',
  'schemas.xmlsoap.org': 'XML namespace identifier (WS-Discovery) — never dialled',
  'www.w3.org': 'XML namespace identifier (SOAP/addressing) — never dialled',
  'api.telegram.org': 'Telegram chat rail — runs only with an operator-configured bot token',
  'slack.com': 'Slack chat rail — runs only with an operator-configured token',
  'graph.facebook.com': 'WhatsApp Cloud API rail — runs only with an operator-configured token',
  'discord.com': 'Discord chat rail — runs only with an operator-configured token',
};

/**
 * The roots that make up the shipped binaries.
 *
 * Named as a constant so each can be asserted SEPARATELY. The total-file floor
 * below cannot protect them: hub/ and controller/ alone clear it, so dropping
 * src-tauri/src from this list left every test green — verified by tampering,
 * which is the only reason it is a list rather than an inline literal.
 *
 * A global count says the walk found something. It says nothing about WHICH
 * subject it found, and a guard that stops looking at one binary is exactly as
 * quiet as one that stops looking at all of them.
 */
const SHIPPED_ROOTS = [
  'hub/internal',
  'hub/cmd',
  'controller/internal',
  'controller/cmd',
  'src-tauri/src',
] as const;

/**
 * Every non-test source file in the shipped binaries.
 *
 * THREE binaries, not two. This walked hub/ and controller/ and called them
 * "the two shipped binaries", but src-tauri/ is bundled as a desktop app
 * (tauri.conf.json's productName is "Aql") and reaches users' machines the same
 * way. A host compiled into its Rust would have shipped with the guard green
 * and README still saying no telemetry.
 *
 * It is clean today — main.rs contains no external host at all — which is the
 * cheapest moment to include it, because the rule starts life satisfied.
 */
function shippedGoFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const isGo = entry.endsWith('.go') && !entry.endsWith('_test.go');
      // Rust string literals are quoted the same way, so the host pattern below
      // reads them without change.
      const isRust = entry.endsWith('.rs');
      if (!isGo && !isRust) continue;
      out.push(full);
    }
  };
  for (const d of SHIPPED_ROOTS) {
    walk(resolve(root, d));
  }
  return out;
}

describe('no phone-home', () => {
  it('every hard-coded external host in the shipped binaries is a reviewed one', () => {
    const files = shippedGoFiles();
    // A walker that found nothing would pass forever.
    expect(files.length, 'no source found — the module layout moved').toBeGreaterThan(50);
    // The LIST itself, against a fixed expectation.
    //
    // Iterating SHIPPED_ROOTS to check SHIPPED_ROOTS is self-referential:
    // deleting an entry deletes its own check, so both "drop src-tauri" and
    // "drop controller/internal" passed. A guard cannot derive what it should
    // cover from the thing it is guarding — verified by tampering, twice, after
    // the per-root loop below was supposed to have fixed exactly that.
    for (const required of [
      'hub/internal',
      'hub/cmd',
      'controller/internal',
      'controller/cmd',
      'src-tauri/src',
    ]) {
      expect(
        SHIPPED_ROOTS as readonly string[],
        `${required} is no longer scanned — that binary ships to users unchecked`,
      ).toContain(required);
    }

    // And each must actually have contributed, because the total above is
    // satisfied by hub/ alone.
    for (const r of SHIPPED_ROOTS) {
      expect(
        files.filter((f) => f.startsWith(resolve(root, r))).length,
        `${r} contributed no files — that binary is no longer being scanned`,
      ).toBeGreaterThan(0);
    }

    const found: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/"https?:\/\/([a-zA-Z0-9.-]+)/g)) {
        const host = m[1];
        // Loopback and the documentation TLDs are not destinations.
        if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(host)) continue;
        if (/\.(example|test|invalid|local)$/.test(host) || host.endsWith('.example.com')) continue;
        if (ALLOWED[host]) continue;
        found.push(`${file.slice(root.length + 1)}  →  ${host}`);
      }
    }

    expect(
      found,
      'a host compiled into a shipped binary that nobody has justified. docs/THREAT-MODEL.md ' +
        'marks "no telemetry — the binaries emit no usage data anywhere" as Shipped, and ' +
        'README repeats it. If this destination is legitimate, add it to ALLOWED with the ' +
        'reason; if it is a version check, a crash reporter or an analytics ping, it makes ' +
        'that sentence false.',
    ).toEqual([]);
  });

  it('every allowed host is still actually used', () => {
    // An allowlist entry for a host nothing dials is an exemption nobody can
    // evaluate, and it is how the next real one gets waved through: the list
    // stops being a list of decisions and becomes a list of things somebody
    // once typed.
    const all = shippedGoFiles()
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const stale = Object.keys(ALLOWED).filter((h) => !all.includes(h)).sort();
    expect(stale, 'these are allowed and no longer appear in the source — drop them').toEqual([]);
  });
});
