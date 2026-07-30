// The fMP4 writer, checked against a demuxer nobody here wrote.
//
// hub/internal/devices/camera/fmp4_test.go compares the writer's output against
// box offsets computed in this repository, from this repository's reading of
// ISO/IEC 14496-12. Those tests are worth having and they are circular: writer
// and tests share one understanding of the standard, so a misreading satisfies
// both. Six tampers prove the tests notice when the writer changes; nothing in
// Go proves either agrees with a player.
//
// Chromium does. Its MP4 stream parser reads the boxes, pulls the SPS out of
// avcC and derives the coded size from it, checks the codec string against what
// it found, and refuses anything it dislikes — an independent implementation
// written by people who have met every camera. What it tells us here:
//
//   the init segment is accepted        the moov chain is structurally valid
//   videoWidth/videoHeight are right    Chromium's own SPS parser agrees with
//                                       sps.go, cropping included
//   buffered is one range of 1.000s     tfdt, trun durations and data_offset
//                                       were read, and the three fragments
//                                       joined with no gap between them
//
// A contiguous range is the strongest single assertion available: a wrong
// data_offset, a wrong sample size, or a decode time that failed to advance all
// show up as a gap, a short range, or no range at all.
//
// What this still does NOT prove, and the Go package says the same: no camera
// has been involved. The sample payloads are not decodable pictures — Chromium's
// container parser reads NAL length prefixes and headers and does not decode
// until playback, which is exactly why undecodable payloads still exercise
// everything above. A real stream may still break the writer in ways this
// cannot see.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

type Expected = {
  width: number;
  height: number;
  fragments: number;
  samplesPerFragment: number;
  timescale: number;
  durationSeconds: number;
  codec: string;
};

type Fixture = { init: string; frags: string[]; expected: Expected };

/**
 * Build the fixture by running the Go writer.
 *
 * Generated rather than committed. A committed init.mp4 would be a golden file
 * that keeps passing after the writer that produced it has broken — the bytes in
 * git would agree with Chromium forever while the code diverged from them. This
 * way the check runs against whatever fmp4.go emits today.
 *
 * Go is present in the e2e-browser CI job (it builds the real hub binary in
 * global-setup.ts), so this is not an extra dependency for the job that needs it.
 */
function buildFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'aql-fmp4-'));
  try {
    execFileSync(
      'go',
      ['test', './internal/devices/camera/', '-run', 'TestWriteBrowserFixture', '-count=1'],
      { cwd: path.join(repoRoot, 'hub'), env: { ...process.env, AQL_FMP4_FIXTURE_DIR: dir }, stdio: 'pipe' },
    );
    const expected = JSON.parse(readFileSync(path.join(dir, 'expected.json'), 'utf-8')) as Expected;
    const b64 = (name: string) => readFileSync(path.join(dir, name)).toString('base64');
    const frags = Array.from({ length: expected.fragments }, (_, i) => b64(`frag${i}.m4s`));
    return { init: b64('init.mp4'), frags, expected };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Feed bytes to a real MediaSource and report what Chromium made of them.
 *
 * Runs entirely inside the page: MSE has no out-of-page API, and the buffered
 * ranges have to be read from the same SourceBuffer that accepted the append.
 */
const MSE_PROBE = async ({ init, frags, codec }: { init: string; frags: string[]; codec: string }) => {
  const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const mime = `video/mp4; codecs="${codec}"`;
  if (!MediaSource.isTypeSupported(mime)) {
    return { supported: false as const, mime };
  }
  const video = document.createElement('video');
  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));
  const sb = ms.addSourceBuffer(mime);

  const append = (buf: Uint8Array) =>
    new Promise<void>((resolve, reject) => {
      const onError = () => reject(new Error('SourceBuffer raised error'));
      sb.addEventListener('updateend', () => resolve(), { once: true });
      sb.addEventListener('error', onError, { once: true });
      try {
        sb.appendBuffer(buf);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

  try {
    await append(decode(init));
    for (const f of frags) await append(decode(f));
  } catch (e) {
    return { supported: true as const, accepted: false as const, reason: String(e) };
  }
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < sb.buffered.length; i++) {
    ranges.push([sb.buffered.start(i), sb.buffered.end(i)]);
  }
  return {
    supported: true as const,
    accepted: true as const,
    ranges,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  };
};

test.describe('the fMP4 writer against Chromium', () => {
  test('Chromium accepts the container and reads back the writer’s own numbers', async ({ page }) => {
    const { init, frags, expected } = buildFixture();
    await page.goto('about:blank');

    const result = await page.evaluate(MSE_PROBE, { init, frags, codec: expected.codec });
    if (!result.supported) {
      // Not skipped. A Chromium without H.264 cannot check this writer, and a
      // silent skip would report a green gate for a check that never ran.
      throw new Error(
        `this Chromium does not support ${result.mime}, so the fMP4 writer went unchecked. ` +
          `Playwright's bundled Chromium ships the codec; a Chromium built without ` +
          `proprietary codecs does not.`,
      );
    }
    expect(result.accepted, `Chromium refused the segments: ${'reason' in result ? result.reason : ''}`).toBe(true);
    if (!result.accepted) return;

    // Chromium derived these by parsing the SPS inside avcC with its own parser.
    // Agreement here is sps.go's cropping arithmetic confirmed from outside this
    // repository — the 1088-versus-1080 class of bug, checked by a third party.
    expect(result.videoWidth).toBe(expected.width);
    expect(result.videoHeight).toBe(expected.height);

    // One range, not several: a gap would mean a fragment's decode time did not
    // continue from the previous one, or that data_offset sent Chromium to the
    // wrong bytes.
    expect(result.ranges.length, `buffered ranges: ${JSON.stringify(result.ranges)}`).toBe(1);
    const [start, end] = result.ranges[0];
    expect(start).toBeCloseTo(0, 3);
    // One timescale tick of tolerance. The boundary is exact in ticks and lands
    // on a repeating fraction in seconds — Chromium reports 0.999999 for exactly
    // 90000/90000 — so an equality assertion here would be testing float
    // formatting rather than the container.
    expect(end).toBeCloseTo(expected.durationSeconds, 3);
  });

  // The check above is only worth having if it can fail. A corrupted box length
  // is the specific thing Chromium's parser is being trusted to catch, so prove
  // it catches one — otherwise a permissive parser would make every assertion
  // above vacuous.
  test('a corrupted box length is refused, so the check above can fail', async ({ page }) => {
    const { init, frags, expected } = buildFixture();
    await page.goto('about:blank');

    // Overwrite the moov box's declared size with something absurd. The first
    // four bytes are ftyp's size; moov's header follows it.
    const raw = Buffer.from(init, 'base64');
    const ftypSize = raw.readUInt32BE(0);
    expect(raw.toString('ascii', ftypSize + 4, ftypSize + 8)).toBe('moov');
    raw.writeUInt32BE(0xfffffff0, ftypSize);

    const result = await page.evaluate(MSE_PROBE, {
      init: raw.toString('base64'),
      frags,
      codec: expected.codec,
    });
    expect(result.supported).toBe(true);
    expect(
      result.supported && result.accepted,
      'Chromium accepted an init segment whose moov declares a 4-gigabyte length, ' +
        'so its acceptance of the real segment proves less than the test above claims',
    ).toBe(false);
  });
});
