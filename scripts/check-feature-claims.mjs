#!/usr/bin/env node
// check-feature-claims.mjs — catches the audit's failure mode: a doc marks a
// feature as SHIPPED and no code backs it up (nine times over, 2026-07-20:
// geofencing, offline-grant issuance, a hardware-validated GPIO fail-safe,
// recurring time windows, Discord, Tauri iOS/Android, outbound webhooks,
// gateway-side analytics, 2FA, CSV export — all documented as real,
// none of them existed). It also checks the reverse direction, because the
// same audit found the opposite mistake too: Slack Socket Mode, the
// Telegram channel and the Go gateway running the product core all
// shipped while the docs still undersold or denied them.
//
// route-parity (src/lib/__tests__/routeParity.test.ts) catches frontend/API
// drift. Nothing caught doc/code drift. This is that check, for the docs'
// own existing shipped-vs-planned vocabulary (README's ✅/🟢/🔨 status
// table, site/index.html's `.soon` badges, and the explicit "designed, not
// implemented" / "Status:" notices sprinkled through ARCHITECTURE.md and
// site/docs/). It does NOT invent a new vocabulary — see
// scripts/feature-claims.manifest.mjs, which is a hand-maintained mirror of
// what those docs currently say, one entry per claim.
//
// ============================================================================
// HOW IT WORKS (and it is exactly this simple — no doc parsing happens here)
// ============================================================================
// The manifest is the ground truth of "what the docs currently claim,"
// maintained BY HAND. This script does not read README.md or site/index.html
// at all — it has no way to know if the manifest still matches what they
// say. That link is a human's job every time a doc's status marker changes;
// this script only checks the OTHER link: manifest claim <-> code evidence.
//
// For each manifest entry:
//   - docStatus: 'shipped' → every evidence check must pass, or FAIL
//     ("doc claims it, code doesn't have it").
//   - docStatus: 'planned' → every evidence check must FAIL to pass (i.e.
//     the feature must still look unimplemented), or FAIL the other way
//     ("code now has it, doc still calls it planned — update the docs").
//
// ============================================================================
// WHAT THIS DOES NOT PROVE — READ THIS BEFORE TRUSTING A GREEN RUN
// ============================================================================
// 1. A green check is NOT proof a shipped feature actually works. Evidence
//    is "a symbol/file/route exists," which is necessary, not sufficient —
//    a function that exists and is wired up but is buggy, half-finished, or
//    dead code nobody calls will still show green here. This script cannot
//    run the feature. Only real tests (unit/integration/e2e/manual) can.
//
// 2. It only sees what's in the manifest. Nobody is forced to add an entry
//    when they add a new doc claim, so a brand-new eleventh overclaim in a
//    doc nobody wired into the manifest is invisible to this script. The
//    manifest is a checklist, not a doc scanner.
//
// 3. It only searches IMPLEMENTATION code (hub/,
//    controller/, proto/, src-tauri/ config) for evidence — deliberately
//    never src/ (the React portal's UI copy) or site/ (marketing). Scanning
//    UI copy for "evidence" would be circular, since that copy is exactly
//    the layer that lied nine times already. One concrete consequence:
//    while building this manifest (2026-07-20), src/pages/Security.tsx was
//    found still claiming geofencing works ("we accept WhatsApp shared
//    location or a live ping... outside the radius we deny the open") and
//    that the audit log is "Exportable as CSV" — both false, and NEITHER
//    of those two false claims is something this script can catch, because
//    they live in UI prose with no ✅/🟢/🔨/`.soon` marker for a human (or
//    this script) to key off. That page needs a manual fix; this script
//    will not find the next one like it either. Grep the whole tree for
//    suspiciously confident feature language periodically — this script is
//    not a substitute for that.
//
// 4. Regex evidence can false-positive (a comment mentioning a symbol name)
//    or false-negative (real code that just doesn't match the chosen
//    pattern, e.g. after a rename). Patterns here were hand-verified against
//    the tree on 2026-07-20; they will rot. When a check result surprises
//    you, go read the file — do not trust the regex over your own eyes.
//
// Bottom line: this is a tripwire for the specific, cheap, embarrassing
// failure mode of "we wrote docs for a feature and then never built it" (or
// its mirror, "we built it and the docs still call it vaporware"). It is
// not a correctness prover and was not built to look like one.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURES } from './feature-claims.manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const WALK_EXCLUDES = new Set([
  'node_modules', 'dist', '.git', 'target', 'gen', '.turbo', 'build', 'coverage',
]);

// ── evidence primitives ─────────────────────────────────────────────────

function readSafe(absPath) {
  try {
    return readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

/** Recursively yield absolute file paths under `absRoot`, skipping junk dirs. */
function* walk(absRoot) {
  let entries;
  try {
    entries = readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (WALK_EXCLUDES.has(entry.name)) continue;
    const abs = path.join(absRoot, entry.name);
    if (entry.isDirectory()) {
      yield* walk(abs);
    } else if (entry.isFile()) {
      yield abs;
    }
  }
}

/**
 * Evaluate one evidence item. Returns { ok, detail } where `detail` is a
 * short human-readable explanation used in failure output.
 */
function checkItem(item) {
  if (item.root !== undefined) {
    const absRoot = path.join(repoRoot, item.root);
    if (!existsSync(absRoot)) {
      // expectMissing marks a path whose ABSENCE is the intended signal —
      // a directory something else would generate if the feature were set up
      // (src-tauri/gen/apple, say). Without the marker a missing path is
      // treated as a broken manifest, because that is what it usually is, and
      // the two are indistinguishable from the outside.
      return item.expectMissing
        ? { ok: false, detail: `${item.root} is absent, as this claim expects` }
        : { ok: false, broken: true, detail: `root ${item.root} does not exist` };
    }
    const re = new RegExp(item.pattern, item.flags ?? '');
    for (const abs of walk(absRoot)) {
      const content = readSafe(abs);
      if (content !== null && re.test(content)) {
        return { ok: true, detail: `matched /${item.pattern}/ in ${path.relative(repoRoot, abs)}` };
      }
    }
    return { ok: false, detail: `no file under ${item.root} matches /${item.pattern}/` };
  }

  // single-file item
  const absFile = path.join(repoRoot, item.file);
  if (!existsSync(absFile)) {
    return item.expectMissing
      ? { ok: false, detail: `${item.file} is absent, as this claim expects` }
      : { ok: false, broken: true, detail: `${item.file} does not exist` };
  }
  if (item.pattern === undefined && item.patternAbsent === undefined) {
    return { ok: true, detail: `${item.file} exists` };
  }
  const content = readSafe(absFile) ?? '';
  if (item.pattern !== undefined) {
    const re = new RegExp(item.pattern, item.flags ?? 'm');
    if (!re.test(content)) {
      return { ok: false, detail: `${item.file} does not match /${item.pattern}/` };
    }
  }
  if (item.patternAbsent !== undefined) {
    const re = new RegExp(item.patternAbsent, item.flags ?? 'm');
    if (re.test(content)) {
      return { ok: false, detail: `${item.file} still matches /${item.patternAbsent}/ (expected it gone)` };
    }
  }
  return { ok: true, detail: `${item.file} satisfies evidence` };
}

/** One manifest evidence slot: a single item, or an OR-array of items. */
function checkSlot(slot) {
  if (Array.isArray(slot)) {
    const results = slot.map(checkItem);
    const hit = results.find((r) => r.ok);
    if (hit) return hit;
    // A broken path inside an OR-slot still breaks the slot, even though the
    // slot legitimately allows misses: "we looked in three places and one of
    // them does not exist" is not the same statement as "we looked in three
    // places and found nothing".
    const broken = results.filter((r) => r.broken);
    return {
      ok: false,
      broken: broken.length > 0,
      detail: `none of: ${results.map((r) => r.detail).join('; ')}`,
    };
  }
  return checkItem(slot);
}

/** A feature is "implemented" iff every evidence slot is satisfied (AND). */
function evaluateFeature(feature) {
  const results = feature.evidence.map((slot) => ({ slot, result: checkSlot(slot) }));
  const implemented = results.every((r) => r.result.ok);
  const broken = results.filter((r) => r.result.broken);
  return { implemented, results, broken };
}

// ── main ─────────────────────────────────────────────────────────────────

// ── docRef rot ──────────────────────────────────────────────────────────
//
// docRefs are prose: "README.md § Energy metering", 'ARCHITECTURE.md §8 —
// "designed, not started"'. Nothing used to read them, so they rotted exactly
// as prose does — several went on quoting sentences that had been rewritten,
// including three describing subsystems as unbuilt after they shipped. A
// reader trusting this manifest was told the docs said something they no
// longer said.
//
// Two things are checkable without pretending a paraphrase is a quote:
//
//   1. The file a ref names must exist. Catches renames and deletions.
//   2. Any DOUBLE-QUOTED span inside a ref must actually appear in that file.
//      A ref that quotes the docs is making a checkable claim and should be
//      held to it; a ref that only paraphrases is left alone, because forcing
//      exact quotes everywhere would make the manifest brittle enough that
//      the next person stops updating it.
//
// Whitespace is collapsed on both sides so a reflowed paragraph still matches.
function checkDocRefs(feature) {
  const problems = [];
  for (const ref of feature.docRefs) {
    const named = ref.match(/^([A-Za-z0-9_./-]+\.(?:md|html|json|ts|tsx|go))/);
    if (!named) continue; // a ref that names no file, e.g. a bare note
    const rel = named[1];
    const body = readSafe(path.join(repoRoot, rel));
    if (body === null) {
      problems.push(`names ${rel}, which does not exist`);
      continue;
    }
    // Flatten for matching, stripping the markers that a WRAPPED quote runs
    // into: `//` in Go, `*` in a block comment, `>` in a markdown blockquote.
    //
    // Whitespace alone was not enough. A claim quoted from a source comment
    // that wraps across two lines becomes "... unknown // physical ..." once
    // the newline collapses, so the quote never matched and the only remedy
    // was to shorten every quote until it fitted on one line. That happened
    // three times in one sitting, each time silently narrowing what the
    // reference actually pinned — which is the opposite of the point.
    const flat = body
      .split('\n')
      .map((line) => line.replace(/^\s*(?:\/\/+|\*|>)+\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    for (const [, quoted] of ref.matchAll(/"([^"]{12,})"/g)) {
      if (!flat.includes(quoted.replace(/\s+/g, ' '))) {
        problems.push(`quotes ${JSON.stringify(quoted)} but ${rel} does not contain it`);
      }
    }
  }
  return problems;
}

function main() {
  const failures = [];
  const passes = [];

  for (const feature of FEATURES) {
    if (!feature.evidence || feature.evidence.length === 0) {
      failures.push({
        feature,
        reason: `manifest bug: "${feature.id}" has no evidence entries (would vacuously pass) — fix the manifest`,
      });
      continue;
    }

    const { implemented, results, broken } = evaluateFeature(feature);

    // Checked BEFORE the status branches, because a broken path is not an
    // answer about the feature at all. It matters most for 'planned' claims,
    // where absence is the expected result: a mistyped filename makes the
    // claim pass forever and report "planned, no evidence (correct)". That is
    // how a claim asserting Linux was the only BLE peripheral backing stayed
    // green after Windows support landed — its evidence named a file that
    // does not exist.
    if (broken.length > 0) {
      failures.push({
        feature,
        reason:
          `evidence points at something that does not exist, so this claim has been ` +
          `checking nothing:\n` +
          broken.map((r) => `      - ${r.result.detail}`).join('\n'),
      });
      continue;
    }

    if (feature.docStatus === 'shipped' && !implemented) {
      const failing = results.filter((r) => !r.result.ok);
      failures.push({
        feature,
        reason:
          `docs claim this SHIPPED but evidence is missing:\n` +
          failing.map((r) => `      - ${JSON.stringify(r.slot)} → ${r.result.detail}`).join('\n'),
      });
    } else if (feature.docStatus === 'planned' && implemented) {
      failures.push({
        feature,
        reason:
          `docs still call this PLANNED but evidence now exists — it may have shipped; update the docs (or this manifest is stale):\n` +
          results.map((r) => `      - ${JSON.stringify(r.slot)} → ${r.result.detail}`).join('\n'),
      });
    } else {
      passes.push(feature);
    }

    const refProblems = checkDocRefs(feature);
    if (refProblems.length > 0) {
      failures.push({
        feature,
        reason:
          `the doc references for this claim have rotted:\n` +
          refProblems.map((p) => `      - ${p}`).join('\n'),
      });
    }
  }

  console.log(`check-feature-claims: ${FEATURES.length} claim(s) checked\n`);

  for (const feature of passes) {
    const tag = feature.docStatus === 'shipped' ? 'shipped, evidence found' : 'planned, no evidence (correct)';
    console.log(`  ✓ ${feature.id}  (${tag})`);
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} claim(s) FAILED:\n`);
    for (const { feature, reason } of failures) {
      console.log(`  ✗ ${feature.id} — ${feature.label}`);
      console.log(`    docStatus: ${feature.docStatus}`);
      console.log(`    ${reason}`);
      console.log(`    doc references:`);
      for (const ref of feature.docRefs) console.log(`      · ${ref}`);
      console.log('');
    }
    console.log(
      'See this script\'s header for what a failure here does and does not mean, and\n' +
        'scripts/feature-claims.manifest.mjs for the claim list.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\nAll feature claims match their evidence (see header for what that does not prove).');
}

main();
