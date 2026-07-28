import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The meter-channel panel, guarded on the three statements that make it worth
 * showing at all.
 *
 * The Energy screen's series, totals and source mix all rest on per-channel
 * configuration that had no surface. The mix is the sharpest case: `source` and
 * `flow` are ASSIGNMENTS somebody made, not measurements, so a solar meter
 * tagged as grid produces a chart that is confidently and invisibly wrong.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const panel = readFileSync(
  path.join(repo, 'src/components/energy/ChannelConfig.tsx'),
  'utf-8',
);

function flat(s: string): string {
  return s.replace(/\s+/g, ' ');
}

describe('the meter channel panel', () => {
  it('is mounted on the Energy screen', () => {
    const page = readFileSync(path.join(repo, 'src/pages/app/Energy.tsx'), 'utf-8');
    expect(page).toContain('<ChannelConfig');
  });

  it('says source and flow are assignments rather than measurements', () => {
    // Without this the mix reads as something the hub measured.
    expect(flat(panel).toLowerCase()).toContain('source and flow are assignments');
  });

  it('says a disabled channel contributes nothing', () => {
    // Its absence from the chart is otherwise indistinguishable from a meter
    // that read zero.
    //
    // Asserted on the RENDERED phrase, not on "contributes nothing" alone: that
    // shorter string also appears in this component's own doc comment, so the
    // first version of this test passed against a version with the user-facing
    // line deleted. A guard that a comment can satisfy is not a guard — the
    // same mistake turned up in the automations tests earlier and is worth
    // catching the same way twice.
    expect(panel).toContain('c.enabled');
    expect(flat(panel)).toContain('contributes nothing above');
  });

  it('does not present "no channels" as a house that used nothing', () => {
    expect(flat(panel).toLowerCase()).toContain(
      'different from a house that used nothing',
    );
  });

  it('shows the interval and gap tolerance behind the quality flags', () => {
    expect(panel).toContain('c.interval_seconds');
    expect(panel).toContain('c.gap_tolerance_seconds');
  });
});
