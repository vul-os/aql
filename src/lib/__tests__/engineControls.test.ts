import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The console's capability→controls table, checked against the engine's own
 * catalogue.
 *
 * src/components/device/engineState.ts states its contract carefully: it is a
 * presentation table, it deliberately does NOT mirror tiers, and "the failure
 * mode of a stale row here is an offered button that the hub refuses, which is
 * visible".
 *
 * That is one failure mode. There is a second it does not name, and it is the
 * invisible one: a capability in the catalogue with NO row here renders no
 * buttons at all. The device looks read-only. Nobody sees an error, nobody
 * files a bug, and an actuatable device silently cannot be actuated from the
 * console — which is the same shape as the metric-hint list that had drifted
 * thirteen names behind the drivers.
 *
 * So this checks both directions, and one thing more: that a verb offered here
 * is a verb the catalogue actually declares. That failure IS visible, but it is
 * visible at a gate, and catching it in a unit test is cheaper.
 *
 * WHAT THIS DOES NOT CHECK, on purpose: tiers, and whether a verb needs
 * confirmation. engineState.ts declines to mirror those and gives the reason —
 * a stale mirrored tier fires a hazardous verb without a confirm, which is the
 * failure nobody sees. Checking them here would be the first step toward
 * mirroring them.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function read(rel: string): string {
  return readFileSync(path.join(repo, rel), 'utf-8');
}

/** Capability id → declared verbs, parsed out of the Go catalogue. */
function goCatalogue(): Map<string, Set<string>> {
  const src = read('hub/internal/devices/capability.go');

  // CapBarrier CapabilityID = "access.barrier"
  const idByConst = new Map<string, string>();
  for (const m of src.matchAll(/(Cap[A-Za-z]+)\s+CapabilityID\s*=\s*"([^"]+)"/g)) {
    idByConst.set(m[1], m[2]);
  }
  expect(idByConst.size, 'no CapabilityID constants were parsed').toBeGreaterThan(5);

  // VerbOpen Verb = "open"
  const verbByConst = new Map<string, string>();
  for (const m of src.matchAll(/(Verb[A-Za-z]+)\s+Verb\s*=\s*"([^"]+)"/g)) {
    verbByConst.set(m[1], m[2]);
  }
  expect(verbByConst.size, 'no Verb constants were parsed').toBeGreaterThan(5);

  const body = src.slice(src.indexOf('var catalogue = map[CapabilityID]Capability{'));
  const out = new Map<string, Set<string>>();
  // Each entry runs from `CapX: {ID: CapX, Verbs: []VerbSpec{` to the next one.
  const entries = [...body.matchAll(/(Cap[A-Za-z]+):\s*\{ID:/g)];
  for (let i = 0; i < entries.length; i++) {
    const start = entries[i].index!;
    const end = i + 1 < entries.length ? entries[i + 1].index! : body.length;
    const chunk = body.slice(start, end);
    const id = idByConst.get(entries[i][1]);
    if (!id) continue;
    const verbs = new Set<string>();
    for (const v of chunk.matchAll(/\{Verb:\s*(Verb[A-Za-z]+)([^}]*)\}/g)) {
      const name = verbByConst.get(v[1]);
      if (!name) continue;
      // TierRead verbs observe and change nothing, so they are not controls a
      // console withholds. Read from the CATALOGUE rather than matched against
      // a list of read-ish verb names here: `read` and `status` are both
      // TierRead today, and inventing a name list in this file would be the
      // same second-copy mistake the test exists to catch.
      //
      // This is the test reading Go directly, not the console mirroring tiers —
      // engineState.ts still declines to do that, for the reason it gives.
      if (/Tier:\s*TierRead\b/.test(v[2])) continue;
      verbs.add(name);
    }
    out.set(id, verbs);
  }
  expect(out.size, 'no catalogue entries were parsed').toBeGreaterThan(5);
  return out;
}

/** Capability id → verbs offered, parsed out of the console table. */
function consoleControls(): Map<string, Set<string>> {
  const src = read('src/components/device/engineState.ts');
  const body = src.slice(src.indexOf('const CAP_CONTROLS'));
  const out = new Map<string, Set<string>>();
  const entries = [...body.matchAll(/'([a-z][a-z.-]+)':\s*\[/g)];
  for (let i = 0; i < entries.length; i++) {
    const start = entries[i].index!;
    const end = i + 1 < entries.length ? entries[i + 1].index! : body.length;
    const verbs = new Set<string>();
    for (const v of body.slice(start, end).matchAll(/verb:\s*'([a-z-]+)'/g)) verbs.add(v[1]);
    out.set(entries[i][1], verbs);
  }
  expect(out.size, 'no CAP_CONTROLS entries were parsed').toBeGreaterThan(5);
  return out;
}

/**
 * Capabilities that intentionally offer no buttons.
 *
 * engineState.ts names these in a comment: "energy.meter, sensor.read and
 * camera.stream offer read/status only. A read-only device gets no buttons
 * rather than disabled ones — there is nothing to enable later."
 *
 * Listed here so that a NEW read-only capability is a deliberate addition to
 * this array rather than a silent omission from the table.
 */
const READ_ONLY = new Set(['energy.meter', 'sensor.read', 'camera.stream']);

describe('the console offers a control for every capability the engine has', () => {
  it('leaves no catalogue capability without either buttons or a read-only entry', () => {
    const go = goCatalogue();
    const ui = consoleControls();

    const unhandled: string[] = [];
    for (const [id, verbs] of go) {
      if (ui.has(id) || READ_ONLY.has(id)) continue;
      unhandled.push(`${id} (verbs: ${[...verbs].join(', ') || 'read-only'})`);
    }
    expect(
      unhandled,
      'these capabilities exist in devices/capability.go but the console draws nothing ' +
        'for them, so a device declaring one looks read-only and cannot be actuated ' +
        'from the UI. Add a CAP_CONTROLS row, or add it to READ_ONLY if that is ' +
        'deliberate:\n' + unhandled.join('\n'),
    ).toEqual([]);
  });

  it('offers no capability the engine does not have', () => {
    const go = goCatalogue();
    const stale = [...consoleControls().keys()].filter((id) => !go.has(id));
    expect(
      stale,
      'the console draws controls for capabilities the catalogue no longer declares; ' +
        'every button is refused by the hub:\n' + stale.join('\n'),
    ).toEqual([]);
  });

  it('offers only verbs the capability actually declares', () => {
    const go = goCatalogue();
    const wrong: string[] = [];
    for (const [id, verbs] of consoleControls()) {
      const declared = go.get(id);
      if (!declared) continue; // covered by the test above
      for (const v of verbs) {
        if (!declared.has(v)) wrong.push(`${id}: ${v}`);
      }
    }
    expect(
      wrong,
      'these buttons send a verb the capability does not declare, so the hub refuses ' +
        'them — at a gate, where finding out is expensive:\n' + wrong.join('\n'),
    ).toEqual([]);
  });

  it('keeps READ_ONLY honest — every entry is a real capability with no actuating verb', () => {
    const go = goCatalogue();
    for (const id of READ_ONLY) {
      const verbs = go.get(id);
      expect(verbs, `READ_ONLY names ${id}, which is not in the catalogue`).toBeDefined();
      expect(
        [...verbs!],
        `${id} is listed as read-only but declares actuating verbs; the console is ` +
          `hiding a control the engine would accept`,
      ).toEqual([]);
    }
  });
});
