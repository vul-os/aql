import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Sentences that were true once, are false now, and keep coming back.
 *
 * This repository's documentation fails in a specific direction far more often
 * than the obvious one. Overclaiming — "feature X ships" with no code — is caught
 * by `check:claims`. The direction that actually keeps happening is the inverse:
 * a document saying something is UNBUILT after it shipped. That is worse, because
 * it tells a reader not to look at live code, and nothing about reading it feels
 * wrong.
 *
 * The camera pipeline alone produced six instances, found one at a time by hand:
 *
 *   - `rtsp.go`'s own file header said "No SETUP, no PLAY, no RTP" four hundred
 *     lines above the code doing all three.
 *   - `docs/CAMERA-RETENTION.md` led with "Status: design only. No code
 *     implements this" after all five of its steps had landed.
 *   - The claims manifest's own label read "there is no RTSP client and no pixel
 *     ever moves" — in the file whose job is catching exactly this.
 *   - `site/docs/devices.md` said "**No video**: no live view, no recording" in a
 *     table, seventy lines above a section documenting both.
 *   - The same file said the RTSP client "does exactly one thing: DESCRIBE".
 *   - ROADMAP left live view and recording unchecked.
 *
 * An agent then read one of those stale sentences and wrote its falsehood onto
 * the marketing page as fact, which is how a documentation error becomes a
 * product claim.
 *
 * # Why phrases and not evidence
 *
 * `check:claims` matches CODE. It cannot see a paragraph that contradicts the
 * paragraph below it, because both sit in the same file and neither is evidence
 * of anything. This checks the prose directly, and only for sentences already
 * proven to recur. It is a blocklist of specific retired claims, not a style
 * check — a general "don't say X is missing" rule would fire on every honest
 * limitation this project states on purpose, and those are the most valuable
 * sentences in the docs.
 *
 * # Adding to it
 *
 * When a claim is retired by shipping the thing, add the phrase here with what is
 * true instead. Do not add a phrase that is merely undesirable; the value of this
 * file is that every entry is a fact about the code.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

type Retired = {
  /** Matched case-insensitively against the prose. */
  phrase: RegExp;
  /** What is true instead — printed in the failure so the fix is obvious. */
  truth: string;
};

const RETIRED: Retired[] = [
  {
    phrase: /no (?:live view|recording)(?:,| and) no (?:recording|live view)/i,
    truth:
      'Both ship. hub/internal/recording/ writes and expires clips; ' +
      'src/components/camera/LiveView.tsx plays fragments over MSE.',
  },
  {
    phrase: /no SETUP, no PLAY/i,
    truth: 'ConsumeMedia in hub/internal/devices/camera/rtsp.go does SETUP, PLAY and interleaved RTP.',
  },
  {
    phrase: /(?:there is |it has )?no RTSP client/i,
    truth: 'hub/internal/devices/camera/rtsp.go is one, and it receives media rather than only describing it.',
  },
  {
    phrase: /no pixel ever moves/i,
    truth: 'Frames are depacketized, assembled and muxed to disk. What is still true is that no CAMERA has been involved.',
  },
  {
    phrase: /does exactly one thing: \*?\*?DESCRIBE/i,
    truth: 'The probe describes; ConsumeMedia receives media. Say which one the sentence is about.',
  },
  {
    phrase: /status: design only/i,
    truth: 'docs/CAMERA-RETENTION.md is built. It is "built, and never run against a camera", which is a different claim.',
  },
  {
    phrase: /(?:waits|waiting) for a real camera/i,
    truth:
      'Depacketization, SPS parsing, assembly and muxing are all built and tested against an ' +
      'in-process RTSP server. Hardware validation is what is outstanding — say that instead.',
  },
  {
    phrase: /no retention worker/i,
    truth: 'hub/internal/recording/recording.go has one, wired into the hourly sweep in cmd/hub/main.go.',
  },
  {
    phrase: /no `?camera:view`? permission/i,
    truth: 'store/cameraview.go and migration 0025. A grant per member per camera, not implied by owner or admin.',
  },
  {
    phrase: /geofencing is (?:designed|not built)|no geofencing code/i,
    truth: 'hub/internal/store/geofence.go is enforced inside LogAccess. It is a convenience, not a security control.',
  },
  {
    phrase: /Fragmenter has no production caller/i,
    truth: 'recording.WriteClip calls it.',
  },
  // These four escaped the first pass of this file, which is the argument for
  // the file: I retired the same claim in six places and still missed four more
  // wordings of it in a document I had already edited twice.
  {
    phrase: /(?:cameras? (?:give[ns]? you )?[^.\n]{0,40})?\bno video\b/i,
    truth: 'Recording, retention and MSE live view all ship. What is true is that no camera has been involved.',
  },
  {
    phrase: /device engine.{0,20}\(NOT BUILT\)/i,
    truth: 'The engine is built and default off. It has four drivers and the console executes verbs against it.',
  },
  {
    // The lookahead is the whole point. "Never received a frame FROM A CAMERA"
    // is true and is one of the most important sentences in these docs; the
    // unqualified form claims the code never receives one, which is false. A
    // pattern without the qualifier fired on three honest sentences the first
    // time it ran, which is the failure this file's header warns about.
    phrase: /never received a frame(?! from)/i,
    truth:
      'ConsumeMedia receives frames from an RTSP server. Qualify it — "never received a frame ' +
      'from a camera" — because the hardware is what is missing, not the code.',
  },
  {
    phrase: /phone half not built/i,
    truth:
      'src/pages/app/EmergencyAccess.tsx requests and stores a grant against a real hub. ' +
      'PRESENTING one still needs LAN or BLE, which is the half that is missing.',
  },
];

/** Prose the project publishes or ships. Not code, and not tests. */
function docFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.md') || p.endsWith('.html')) out.push(p);
    }
  };
  for (const d of ['docs', 'site', 'proto']) walk(path.join(repo, d));
  for (const f of ['README.md', 'ROADMAP.md', 'ARCHITECTURE.md', 'SECURITY.md']) {
    out.push(path.join(repo, f));
  }
  // CHANGELOG is a dated record of what was true when written. Rewriting history
  // to match today is a different kind of dishonesty, so it is exempt.
  return out.filter((p) => !p.endsWith('CHANGELOG.md'));
}

describe('retired claims do not come back', () => {
  const files = docFiles();

  it('reads a plausible set of documents', () => {
    // Without this, a walk that silently returned nothing would pass everything.
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.endsWith('README.md'))).toBe(true);
    expect(files.some((f) => f.includes('CAMERA-RETENTION'))).toBe(true);
  });

  it('the matcher actually matches', () => {
    // A blocklist that has stopped matching anything is indistinguishable from
    // clean docs. Prove each pattern still fires on the sentence it retired.
    const samples = [
      'No video: no live view, no recording',
      'No SETUP, no PLAY, no RTP',
      'there is no RTSP client',
      'no pixel ever moves',
      'it does exactly one thing: **DESCRIBE**',
      'Status: design only. No code implements this',
      'so it waits for a real camera',
      'there is no retention worker',
      'no `camera:view` permission',
      'there is no geofencing code in the Go hub',
      'Fragmenter has no production caller',
      'cameras give you discovery and readings but no video',
      'DEV["Device engine<br/>(NOT BUILT)<br/>camera"]',
      'and has never received a frame',
      'emergency: LAN / BLE (phone half not built)',
    ];
    for (const [i, sample] of samples.entries()) {
      expect(RETIRED[i].phrase.test(sample), `pattern ${i} no longer matches "${sample}"`).toBe(true);
    }
    expect(samples).toHaveLength(RETIRED.length);
  });

  it.each(RETIRED)('$phrase', ({ phrase, truth }) => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (phrase.test(line)) hits.push(`${path.relative(repo, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      hits,
      `This claim was retired by shipping the thing. ${truth}\n\nStill said in:\n${hits.join('\n')}`,
    ).toEqual([]);
  });
});
