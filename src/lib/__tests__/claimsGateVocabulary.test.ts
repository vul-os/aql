import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The claims gate's own headers describe where the docs' status vocabulary
 * lives. This holds those descriptions true.
 *
 * # Why this is worth a test
 *
 * `scripts/check-feature-claims.mjs` and its manifest both open by naming the
 * markers they mirror, and a reader trusts that to know which docs to keep in
 * step. Both said "README's ✅/🟢/🔨 status table" long after README was rebuilt
 * into prose carrying no marker at all, and both said site/index.html's `.soon`
 * badges when the class is `k-soon`.
 *
 * Nothing caught it, and nothing would have: the claims gate checks the
 * manifest against CODE, and this is the gate describing ITSELF. A guard's own
 * documentation is the one thing it structurally cannot verify, which is
 * exactly why it drifts — every green run is evidence about the product and no
 * evidence at all about the sentence at the top of the file.
 *
 * # What this does NOT check
 *
 * That the manifest's entries still match what those docs say. That link is
 * hand-maintained and the gate's header says so plainly (caveat 2). This only
 * holds the smaller, mechanical claim: that the VOCABULARY the headers point a
 * reader at is where they say it is.
 */

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf-8');

const MARKERS = /✅|🟢|🔨/g;
const countMarkers = (rel: string) => (read(rel).match(MARKERS) ?? []).length;

const gate = read('scripts/check-feature-claims.mjs');
const manifest = read('scripts/feature-claims.manifest.mjs');

describe("the claims gate's description of where status markers live", () => {
  it('finds markers in ARCHITECTURE.md, which is where both headers now point', () => {
    // The headers name ARCHITECTURE.md's repository tree and subsystem table.
    // If the markers were stripped from there too, both descriptions would be
    // pointing a reader at a vocabulary that no longer exists anywhere.
    expect(countMarkers('ARCHITECTURE.md')).toBeGreaterThan(5);
    expect(gate).toMatch(/ARCHITECTURE\.md/);
    expect(manifest).toMatch(/ARCHITECTURE\.md/);
  });

  it('finds none in README.md, which is what both headers now say', () => {
    // The correction that prompted this test. If README ever regains a status
    // table, both headers become wrong again in the other direction — they
    // would be telling a reader to ignore a real vocabulary — so this fails
    // and forces the sentence to be updated with the doc.
    expect(
      countMarkers('README.md'),
      'README.md has regained status markers; the claims-gate headers say it carries none',
    ).toBe(0);
  });

  it('uses the badge class the site actually ships', () => {
    // `.soon` for years in the headers; the class is `k-soon`. A reader
    // grepping for the documented one finds nothing and concludes the badges
    // were removed.
    expect(read('site/index.html')).toMatch(/k-soon/);
    expect(gate).toMatch(/k-soon/);
    expect(manifest).toMatch(/k-soon/);
    // And the stale spelling must not come back. Written as a boundary so
    // `k-soon` itself does not match.
    expect(gate).not.toMatch(/[^k-]`\.soon`/);
    expect(manifest).not.toMatch(/[^k-]`\.soon`/);
  });

  it('describes ROADMAP.md by the vocabulary it actually uses', () => {
    // ROADMAP carries no emoji markers; it uses checkboxes. The header says so
    // now, and this holds it: a ROADMAP that grew markers, or lost its
    // checkboxes, would leave the description wrong either way.
    expect(countMarkers('ROADMAP.md')).toBe(0);
    expect(read('ROADMAP.md')).toMatch(/^- \[[x ]\] /m);
    expect(gate).toMatch(/- \[x\]/);
  });
});
