import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DEVICE_KINDS,
  ENGINE_KINDS,
  ENGINE_ROW_SUPPRESSED,
  REAL_KIND,
  suppressEngineRow,
} from '../deviceKinds';

/**
 * The console's seven device kinds, pinned to the engine's own catalogue.
 *
 * This replaces an anti-drift argument that had stopped being true. The kind
 * list used to be derived from a demo fixture the console also rendered, so
 * the two could not disagree — then the console stopped rendering the fixture,
 * and the coupling survived as a comment claiming a guarantee it no longer
 * provided.
 *
 * The authority is hub/internal/devices/model.go, because that is what
 * actually routes verbs and rejects an unknown kind. If a kind is added there
 * and the console never hears about it, the landing page quietly under-sells
 * the product; if one is removed, the page advertises something the engine
 * will refuse.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT: it proves the two lists name the same
 * seven things. It says nothing about whether any of them has a working
 * driver — Robot has none at all, and Camera receives no video. Per-kind
 * status lives in site/docs/devices.md, deliberately in one place.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function hubKinds(): string[] {
  const src = readFileSync(path.join(repo, 'hub/internal/devices/model.go'), 'utf-8');
  // Kind constants are declared as `KindCamera Kind = "camera"`. Read the
  // string literal rather than the Go identifier: the wire value is what the
  // engine compares against, and it is what a rename would change.
  const kinds = [...src.matchAll(/Kind[A-Za-z]+\s+Kind\s*=\s*"([a-z]+)"/g)].map((m) => m[1]);
  // A regex that silently matched nothing would make every assertion below
  // pass against an empty set.
  expect(kinds.length, 'no Kind constants were extracted from model.go').toBeGreaterThan(5);
  return kinds;
}

describe('the console and the engine agree on the device kinds', () => {
  it('names exactly the seven the engine knows', () => {
    const fromHub = [...hubKinds()].sort();
    const fromConsole = DEVICE_KINDS.map((k) => k.toLowerCase()).sort();
    expect(
      fromConsole,
      'the console advertises a different set of device kinds than the engine will ' +
        'accept. A kind here that the engine does not know is a promise it will refuse; ' +
        'one the engine knows and this list omits is a capability nobody is told about.',
    ).toEqual(fromHub);
  });

  it('keeps access out of the engine kinds, because it does not go through the engine', () => {
    expect(ENGINE_KINDS).not.toContain(REAL_KIND);
    expect(DEVICE_KINDS).toContain(REAL_KIND);
    // Access last is a display decision, but a load-bearing one: the landing
    // page renders this order and marks the final entry as the kind that runs
    // end to end today.
    expect(DEVICE_KINDS[DEVICE_KINDS.length - 1]).toBe(REAL_KIND);
  });

  it('is still checked against a real file, not a stub', () => {
    // hubKinds() reads model.go at call time; if that file were moved, this
    // suite should fail loudly rather than silently stop guarding anything.
    expect(readFileSync(path.join(repo, 'hub/internal/devices/model.go'), 'utf-8').length)
      .toBeGreaterThan(500);
  });
});

describe('engine rows the console suppresses', () => {
  it('suppresses access, because the hub already contributes a richer row for it', () => {
    // The list in Devices.tsx is a concatenation of hub rows and engine rows.
    // Once the `access` driver is enabled the engine reports every gate too, so
    // without this filter a gate appears TWICE — which is the "two places
    // showing one thing" docs/ACCESS-ON-THE-ENGINE.md §5 set out to avoid.
    expect(suppressEngineRow(REAL_KIND)).toBe(true);
  });

  it('suppresses nothing else — every engine kind still draws a row', () => {
    for (const kind of ENGINE_KINDS) {
      expect(
        suppressEngineRow(kind),
        `${kind} is suppressed, so an operator who configured that driver sees ` +
          `no row for the devices it found`,
      ).toBe(false);
    }
  });

  it('every suppressed kind is a real kind, and is one the hub renders itself', () => {
    // A suppressed kind that the hub does NOT render separately would be a
    // device the console silently loses: the engine found it, the filter
    // dropped it, and nothing else draws it.
    for (const kind of ENGINE_ROW_SUPPRESSED) {
      expect(DEVICE_KINDS, `${kind} is suppressed but is not a device kind`).toContain(kind);
      expect(
        kind,
        `${kind} is suppressed but the hub has no row of its own for it, so the ` +
          `console would show nothing at all for those devices`,
      ).toBe(REAL_KIND);
    }
  });
});
