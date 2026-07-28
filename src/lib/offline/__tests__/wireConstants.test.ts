import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CLOCK_SKEW_SECONDS,
  CNONCE_TTL_SECONDS,
  GRANT_TTL_SECONDS,
  WIRE_VERSION,
} from '../grant';

/**
 * The wire constants this app enforces, pinned to the contract they come from.
 *
 * src/lib/offline/grant.ts declares four numbers that are not app preferences —
 * they are the wire contract, restated in TypeScript because a browser cannot
 * import Go. Their doc comments already name their sources
 * ("wire.ClockSkewSeconds", "keys.DefaultGrantTTL"), which is a claim nothing
 * checked.
 *
 * Two of the four had no reader at all when this was written, found by sweeping
 * exported values for ones nothing uses. That is what prompted the question: if
 * a constant is unused, nothing can notice it drifting — and the two that ARE
 * used are enforced against a live controller during an outage, which is the
 * worst possible place to discover the two sides disagree about how wide the
 * clock-skew window is.
 *
 * The failure this prevents is quiet and one-sided. Widen CLOCK_SKEW_SECONDS
 * here and the app signs proofs the controller refuses as not_yet_valid;
 * narrow it and the app refuses grants the controller would have honoured.
 * Either way the person is standing at a gate.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT: it proves the numbers agree with the
 * conformance corpus and the Go declarations. It does not prove either side
 * USES them correctly — proto/vectors and the Go suites cover that.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');

function read(rel: string): string {
  return readFileSync(path.join(repo, rel), 'utf-8');
}

/** The `spec_constants` block every vectors file carries. */
function specConstants(): Record<string, number> {
  const parsed = JSON.parse(read('proto/vectors/pairing.json')) as {
    spec_constants?: Record<string, number>;
  };
  const c = parsed.spec_constants;
  expect(
    c && Object.keys(c).length > 0,
    'pairing.json has no spec_constants block; this test would silently check nothing',
  ).toBe(true);
  return c!;
}

/** Pull `const Name = <int>` out of a Go source file. */
function goConst(rel: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*(\\d+)\\b`).exec(read(rel));
  expect(m, `${name} was not found in ${rel}; the constant moved or was renamed`).not.toBeNull();
  return Number(m![1]);
}

describe('the offline wire constants match the contract they claim to restate', () => {
  it('clock skew agrees with the vectors and with both Go implementations', () => {
    const spec = specConstants();
    expect(CLOCK_SKEW_SECONDS).toBe(spec.skew_seconds);
    // Both sides, because they are independent implementations: the hub mints
    // and the controller verifies, and a browser proof has to satisfy the
    // controller.
    expect(CLOCK_SKEW_SECONDS).toBe(goConst('hub/internal/keys/envelope.go', 'ClockSkewSeconds'));
    expect(CLOCK_SKEW_SECONDS).toBe(goConst('controller/internal/wire/wire.go', 'ClockSkewSeconds'));
  });

  it('the cnonce TTL agrees with the vectors and the controller', () => {
    expect(CNONCE_TTL_SECONDS).toBe(specConstants().cnonce_ttl_seconds);
    expect(CNONCE_TTL_SECONDS).toBe(goConst('controller/internal/wire/wire.go', 'CnonceTTLSeconds'));
  });

  it('the wire version agrees with the controller', () => {
    expect(WIRE_VERSION).toBe(goConst('controller/internal/wire/wire.go', 'Version'));
  });

  it('the grant TTL agrees with keys.DefaultGrantTTL', () => {
    // Declared in Go as a duration expression (7 * 24 * time.Hour) rather than
    // a bare integer, so it is matched as one rather than through goConst.
    const src = read('hub/internal/keys/grant.go');
    const m = /DefaultGrantTTL\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*time\.Hour/.exec(src);
    expect(m, 'DefaultGrantTTL is no longer a `N * M * time.Hour` expression').not.toBeNull();
    const goSeconds = Number(m![1]) * Number(m![2]) * 3600;
    expect(GRANT_TTL_SECONDS).toBe(goSeconds);
  });

  it('reads real files, so a bad path cannot make this suite vacuous', () => {
    // Every assertion above depends on reading a file. If one were renamed,
    // read() throws and this fails loudly — but a future refactor could wrap
    // them in try/catch and turn a missing contract into a silent pass.
    for (const f of [
      'proto/vectors/pairing.json',
      'hub/internal/keys/envelope.go',
      'hub/internal/keys/grant.go',
      'controller/internal/wire/wire.go',
    ]) {
      expect(read(f).length, `${f} is empty or missing`).toBeGreaterThan(200);
    }
  });
});
