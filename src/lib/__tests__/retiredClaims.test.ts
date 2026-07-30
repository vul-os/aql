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
  /**
   * Restrict the check to files whose repo-relative path matches.
   *
   * Some of these phrases are retired for ONE subject and perfectly honest for
   * another. "No code implements this" was false about the camera pipeline and
   * would be true of a design written before its code — which is a thing this
   * repository does on purpose. Without a scope this guard would punish a
   * document for being honest.
   */
  only?: RegExp;
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
    // Not anchored on "Status:". docs/README.md's index said "**Design only — no
    // code implements it.**" and slipped past the anchored version for two more
    // days, in the one file whose job is telling a reader which documents are
    // worth opening.
    //
    // SCOPED, because "design only" is retired for the CAMERA docs and is an
    // honest thing for a design written before its code — which this repository
    // does deliberately. Without the scope this guard punishes a document for
    // being accurate; verified by dropping a genuinely-unbuilt design doc in and
    // watching the unscoped version flag it.
    phrase: /design only|no code implements/i,
    only: /CAMERA-RETENTION\.md|docs\/README\.md|devices\.md/,
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
    // getting-started.md's Status block carried these for months — on the first
    // page a new user reads, which is the worst place for them. Each names a
    // subsystem that shipped.
    phrase: /not implemented:[^.\n]*\banalytics\b|\bthe entire device engine\b/i,
    truth:
      'The device engine ships with five drivers (off by default), and analytics and ' +
      'password reset both have routes. Google OAuth is the one that is genuinely absent.',
  },
  {
    phrase: /aql-gateway|Dockerfile`?\s*\n?\s*>?\s*in `gateway\//i,
    truth:
      'The backend was renamed to the hub. The Dockerfile is hub/Dockerfile and the ' +
      'image is ghcr.io/vul-os/aql-hub.',
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
    // Caught in site/docs/architecture.md's component table days after the
    // pipeline shipped, in the same cell that named the drivers — which is why
    // the driver LIST is guarded separately in docCounts: a stale cell tends to
    // be stale in more than one way at once.
    phrase: /no camera pipeline/i,
    truth:
      'RTSP media, depacketization, muxing, recording, retention and MSE live view all ' +
      'ship. What is true is that no camera has been involved.',
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
      else if (p.endsWith('.md') || p.endsWith('.html') || p.endsWith('.ts') || p.endsWith('.tsx')) {
        out.push(p);
      }
    }
  };
  for (const d of ['docs', 'site', 'proto']) walk(path.join(repo, d));
  // The console's own copy, which the feature-claims manifest calls out as "the
  // exact layer that lies" and excludes from EVIDENCE for that reason. Excluded
  // as evidence, included as a subject: src/lib/deviceKinds.ts told a reader
  // "Robot has no driver at all" and "receives no video" for days after both
  // stopped being true, and no guard looked because this walk stopped at .md.
  //
  // Tests are skipped — they quote retired claims on purpose, to prove the
  // patterns still fire.
  walk(path.join(repo, 'src'));
  for (const f of ['README.md', 'ROADMAP.md', 'ARCHITECTURE.md', 'SECURITY.md']) {
    out.push(path.join(repo, f));
  }
  // CHANGELOG is a dated record of what was true when written. Rewriting history
  // to match today is a different kind of dishonesty, so it is exempt.
  return out.filter((p) => !p.endsWith('CHANGELOG.md') && !p.includes('__tests__'));
}

/**
 * One flattened line per document, with a map back to source line numbers.
 *
 * Matching line by line was a hole. A claim that WRAPS is invisible to it, and
 * these are prose files where wrapping is the norm — so any pattern here could
 * be evaded by a paragraph reflow, accidentally. Found the honest way:
 * replacement text I wrote said "never received a frame from a camera", the
 * qualified form that is TRUE, and this guard flagged it because the line broke
 * between "frame" and "from". The same break would have hidden a real one.
 *
 * scripts/check-feature-claims.mjs already does this, for the same reason, and
 * explains it in a comment. This is that logic plus the offset-to-line map a
 * failure report needs to stay actionable.
 *
 * Markers a wrapped phrase runs into are stripped: `//` in Go, `*` in a block
 * comment, `>` in a markdown blockquote.
 */
function flatten(body: string): { text: string; lineAt: (offset: number) => number } {
  const starts: number[] = [];
  const parts: string[] = [];
  let cursor = 0;
  for (const raw of body.split('\n')) {
    const stripped = raw
      .replace(/^\s*(?:\/\/+|\*|>)+\s?/, '')
      .replace(/\s+/g, ' ')
      .trim();
    starts.push(cursor);
    parts.push(stripped);
    cursor += stripped.length + 1;
  }
  return {
    text: parts.join(' '),
    lineAt: (offset: number) => {
      let line = 0;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= offset) line = i;
        else break;
      }
      return line + 1;
    },
  };
}

/** A readable slice around a match, for the failure message. */
function excerpt(text: string, at: number): string {
  return text.slice(Math.max(0, at - 20), at + 110).trim();
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
      'Not implemented: analytics endpoints, Google OAuth',
      'the ghcr.io/vul-os/aql-gateway image',
      'Fragmenter has no production caller',
      'cameras give you discovery and readings but no video',
      'DEV["Device engine<br/>(NOT BUILT)<br/>camera"]',
      'and has never received a frame',
      'No Matter, no robot driver, no camera pipeline',
      'emergency: LAN / BLE (phone half not built)',
    ];
    for (const [i, sample] of samples.entries()) {
      expect(RETIRED[i].phrase.test(sample), `pattern ${i} no longer matches "${sample}"`).toBe(true);
    }
    expect(samples).toHaveLength(RETIRED.length);
  });

  it.each(RETIRED)('$phrase', ({ phrase, truth, only }) => {
    const hits: string[] = [];
    const scoped = only ? files.filter((f) => only.test(path.relative(repo, f))) : files;
    // A scope that matches nothing is a check that silently stopped running.
    expect(scoped.length, `the 'only' scope ${only} matched no document`).toBeGreaterThan(0);
    for (const file of scoped) {
      const flat = flatten(readFileSync(file, 'utf8'));
      phrase.lastIndex = 0;
      const m = phrase.exec(flat.text);
      if (m) {
        hits.push(
          `${path.relative(repo, file)}:${flat.lineAt(m.index)}: ${excerpt(flat.text, m.index)}`,
        );
      }
    }
    expect(
      hits,
      `This claim was retired by shipping the thing. ${truth}\n\nStill said in:\n${hits.join('\n')}`,
    ).toEqual([]);
  });
});
