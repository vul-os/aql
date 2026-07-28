import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The rail disclosure panel, guarded on the two things that make it worth
 * having rather than decorative.
 *
 * The hub computes four KOTVA §26.3 fields per rail and, until now, no screen
 * showed them. For an ordinary feature that is a gap; for an honesty feature it
 * is worse than not building it, because the repo could point at a tested
 * disclosure endpoint while every real user chose a rail knowing none of it.
 *
 * Now that it renders, the two ways it could quietly become misleading are:
 *
 *   1. Dropping or paraphrasing the hub's `note`. The four fields cannot say
 *      the thing most likely to be misread — self-hosting removes the
 *      middleman OPERATOR, not the PLATFORM. Meta reads every WhatsApp message
 *      whoever runs the hub. A table without that sentence lets "you host it
 *      yourself" read as "nobody else sees your messages".
 *   2. Re-deriving `runs_behind_cgnat` from `inbound_transport` in the client.
 *      api.ts says not to, in as many words: the hub derives it, and a console
 *      that computes its own can disagree with the declaration it is rendering.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

const panel = readFileSync(
  path.join(repo, 'src/components/settings/RailDisclosureSection.tsx'),
  'utf-8',
);

describe('the rail disclosure panel renders the hub’s declaration, not its own', () => {
  it('is actually mounted in Settings', () => {
    const settings = readFileSync(path.join(repo, 'src/pages/app/Settings.tsx'), 'utf-8');
    expect(settings).toContain('<RailDisclosureSection />');
  });

  it('renders the hub’s note verbatim', () => {
    expect(panel).toContain('{note}');
  });

  it('never hides the note behind a toggle or an error state', () => {
    // Rendered whenever it is present, not gated on the table loading or on a
    // "show details" affordance — the sentence is the part someone skimming
    // most needs and would most easily skip.
    expect(panel).toMatch(/\{note && \(/);
  });

  it('takes runs_behind_cgnat from the hub rather than deriving it', () => {
    expect(panel).toContain('r.runs_behind_cgnat');
    // The give-away for a local re-derivation would be the client comparing
    // the transport string itself to decide reachability.
    expect(panel).not.toMatch(/inbound_transport\s*===\s*['"]/);
  });

  it('shows who reads the messages, per direction', () => {
    expect(panel).toContain('r.outbound.exposure');
    expect(panel).toContain('r.inbound.exposure');
  });

  it('shows the price shape both ways, because WhatsApp differs per direction', () => {
    expect(panel).toContain('r.inbound.price');
    expect(panel).toContain('r.outbound.price');
  });
});
