#!/usr/bin/env node
//
// check-external-citations.mjs — verify the citations Aql's docs make INTO
// sibling repos (pier/, kotva/).
//
// # Why this is a script and not a gate
//
// docCitations.test.ts resolves every cited path in every tracked document and
// exempts exactly these, because the sibling repos are not part of this
// checkout and a test that depends on them would fail in CI for a reason that
// has nothing to do with this repo. So they were never checked at all — 75
// citations in docs/PIER-CHAT-SEAM.md alone, several of them load-bearing for
// a design decision.
//
// The first run found two that had drifted (line numbers as they stood then,
// in the crate since renamed to `pier-conformance`): `broker-conformance/src/lib.rs`
// was cited at :166-169 for the lock-in verdict (that range holds the `Finding`
// struct; the verdict is at :225-226) and at :178-187 for the self-host verdict
// (that range holds `Report::is_conformant`; the verdict is at :233-251). Both
// claims were TRUE — only the references had moved, which is the failure mode
// that makes a citation worse than none: it sends a reader to code that does
// not say what they were told it says.
//
// # It refuses to pass when it cannot check
//
// A skipped check that prints nothing is indistinguishable from a passing one,
// and this repo has a written history of exactly that. So: absent siblings exit
// 2 with a message naming what went unchecked. Only a real, complete
// verification exits 0.
//
// Line ranges are checked for existence, not content. A range that exists but
// describes the wrong code is only findable by reading it — which is how the
// two above were caught, and why this prints every citation it verified when
// asked with --list.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siblings = resolve(repo, '..');
const wantList = process.argv.includes('--list');

/**
 * Repos cited from this one that live beside it rather than inside it.
 *
 * `pier` was renamed to `pier` on 2026-08-03 (pier commit c192ca4, "rename:
 * pier -> pier across the Rust workspace, crates included") — the repo did not
 * leave the tree, it changed name, and its crates were renamed with it
 * (`broker-economics` -> `pier-economics`, `gateway` -> `pier-gateway`,
 * `broker-conformance` -> `pier-conformance`). Reading this as an absence was
 * worse than reading it as a rename: `../pier` can never appear again, so the
 * partial-run path below would have exited 2 forever while 42 citations stayed
 * permanently unverified behind advice ("clone them next to aql/") that could
 * not be followed.
 */
const EXTERNAL = ['pier', 'kotva'];

const CITATION =
  /`((?:pier|kotva)\/[A-Za-z0-9_./-]+\.(?:rs|md|toml|go|ts))(?::(\d+)(?:-(\d+))?)?`/g;

// A bare `:148-160` — a line range with no path, meaning "the file I just
// named". PIER-CHAT-SEAM's conformance table is written almost entirely this
// way, so the first version of this script validated none of those rows.
//
// It resolves against the NEAREST PRECEDING fully-qualified external path,
// which is how the document actually reads: a row citing
// `.../visibility.rs:77-81, pinned by test at :135-142` means visibility.rs,
// while a row citing only `:206-218` inherits the path from the sentence that
// introduced the table. Both were wrong when this was added — COORD-1 pointed
// at the `Outcome` enum and COORD-5 at a range 60 lines above its clause.
//
// Only resolved when the nearest preceding path is EXTERNAL; a bare range
// following an in-repo path belongs to docCitations, not here.
const BARE_RANGE = /(?<!\/)`:(\d+)(?:-(\d+))?`/g;

function trackedDocs() {
  return execFileSync('git', ['ls-files', '*.md'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.md') && existsSync(join(repo, f)));
}

const absent = EXTERNAL.filter((r) => !existsSync(join(siblings, r)));

const found = [];
let lastQualifiedPath = null;
let lastDir = null;
for (const doc of trackedDocs()) {
  const text = readFileSync(join(repo, doc), 'utf8');
  // Any path-shaped citation, external or not, so an in-repo path correctly
  // shadows an earlier external one and its bare ranges are left alone.
  const ANY_PATH = /`([A-Za-z0-9_][A-Za-z0-9_./-]*\/[A-Za-z0-9_.-]+\.[a-z]{1,4})(?::\d+(?:-\d+)?)?`/g;
  text.split('\n').forEach((line, i) => {
    const marks = [];
    for (const m of line.matchAll(ANY_PATH)) marks.push({ at: m.index ?? 0, path: m[1] });
    // `kotva/…/adapters/` followed by a bare `mod.rs`. §0.3 names a directory
    // once and then its files by basename, so the ranges hanging off `mod.rs`
    // inherited whatever qualified path came last — BACKLOG.md, 59 lines long,
    // against a range ending at 333. Joining the two is what a reader does.
    const DIR = /`([A-Za-z0-9_][A-Za-z0-9_./-]*\/)`/g;
    const BARE_FILE = /`([A-Za-z0-9_][A-Za-z0-9_-]*\.[a-z]{1,4})`/g;
    const dirs = [...line.matchAll(DIR)].map((m) => ({ at: m.index ?? 0, dir: m[1] }));
    // The directory is often named a line or two above the files it holds, so
    // it carries the same way a qualified path does.
    for (const m of line.matchAll(BARE_FILE)) {
      const at = m.index ?? 0;
      const d = dirs.filter((x) => x.at < at).pop()?.dir ?? lastDir;
      if (d) marks.push({ at, path: d + m[1] });
    }
    if (dirs.length) lastDir = dirs[dirs.length - 1].dir;
    marks.sort((a, b) => a.at - b.at);
    for (const m of line.matchAll(CITATION)) {
      found.push({ doc, line: i + 1, path: m[1], from: m[2], to: m[3] });
    }
    for (const m of line.matchAll(BARE_RANGE)) {
      const at = m.index ?? 0;
      // Nearest qualified path to the left on this line, else the last one seen
      // anywhere above it.
      const onLine = marks.filter((k) => k.at < at).pop();
      const inherited = onLine?.path ?? lastQualifiedPath;
      if (!inherited || !EXTERNAL.some((r) => inherited.startsWith(`${r}/`))) continue;
      found.push({ doc, line: i + 1, path: inherited, from: m[1], to: m[2], inherited: true });
    }
    // A table ROW must not become the default for the row beneath it. The
    // conformance table's rows each cite their own files, and letting the last
    // path in one row carry into the next attributed COORD-2's range to
    // `crates/README.md` — the file the COORD-1 row happened to end with. The
    // default a bare range inherits is the one established by prose BEFORE the
    // table, which is how a reader reads it.
    if (marks.length && !line.trimStart().startsWith('|')) {
      lastQualifiedPath = marks[marks.length - 1].path;
    }
  });
}

// Check what IS here, and be loud about what is not.
//
// This refused outright when any sibling was missing, which was right about the
// honesty and wrong about the work: 100% of the citations went unverified to
// avoid overstating the fraction that could not be. Partial verification is
// worth having as long as the gap is stated in the same breath — the failure
// this guards against is a SKIP being mistaken for a PASS, and naming the count
// prevents that just as well as refusing does.
//
// It is NOT a substitute for keeping the names right, though. This path was
// introduced to absorb "pier is gone", when what had actually happened was a
// rename to `pier`; the partial run then reported a stable-looking 91/42 that
// no amount of cloning could ever resolve. A sibling that is genuinely absent
// is a transient condition; a sibling that has been renamed is a stale
// EXTERNAL entry, and only fixing the entry checks those citations again.
//
// Absence still exits non-zero. A run that could not see everything has not
// checked everything, whatever it managed.
const skipped = found.filter((c) => absent.some((r) => c.path.startsWith(`${r}/`)));
const checkable = found.filter((c) => !skipped.includes(c));

const problems = [];
let verified = 0;
for (const c of checkable) {
  const full = join(siblings, c.path);
  if (!existsSync(full)) {
    // An absence can be the claim itself: PIER-CHAT-SEAM §0.1 is titled
    // "`pier/coordinator/CONTRACT.md` does not exist" and says so twice on
    // purpose. Those are correct and must not be "fixed" into a live path.
    const context = readFileSync(join(repo, c.doc), 'utf8').split('\n')[c.line - 1] ?? '';
    if (/does not exist|is still absent|absent|no such file/i.test(context)) {
      verified++;
      if (wantList) console.log(`  absence asserted  ${c.path}  (${c.doc}:${c.line})`);
      continue;
    }
    problems.push(`${c.doc}:${c.line} cites ${c.path}, which does not exist`);
    continue;
  }
  if (c.from) {
    const total = readFileSync(full, 'utf8').split('\n').length;
    const hi = Number(c.to ?? c.from);
    if (hi > total) {
      problems.push(
        `${c.doc}:${c.line} cites ${c.path}:${c.from}${c.to ? `-${c.to}` : ''}, but that file has ${total} lines`,
      );
      continue;
    }
  }
  verified++;
  if (wantList) console.log(`  ok  ${c.path}${c.from ? `:${c.from}${c.to ? `-${c.to}` : ''}` : ''}  (${c.doc}:${c.line})`);
}

if (problems.length) {
  console.error(`${problems.length} external citation(s) do not resolve:\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// A floor, because "0 citations verified" would otherwise print the same
// cheerful line as a real sweep.




if (absent.length) {
  console.error(
    `\nPARTIAL — ${verified} citations verified against ${EXTERNAL.filter((r) => !absent.includes(r)).join(', ') || 'nothing'}, ` +
      `but ${skipped.length} into ${absent.join(', ')} went UNCHECKED: not checked out beside this repo.\n` +
      `Clone them next to aql/ and run this again. Exiting non-zero because a run that ` +
      `could not see everything has not checked everything.`,
  );
  process.exit(2);
}

// The floor only means anything when every sibling is present: with one
// missing, the checkable population is smaller by design and a fixed number
// would report drift that is really absence.
if (verified < 120) {
  console.error(
    `only ${verified} external citations were verified — the pattern has drifted. ` +
      `133 resolve today: about 75 fully-qualified, the rest bare \`:NNN\` ranges ` +
      `inheriting their file from the nearest preceding path.`,
  );
  process.exit(1);
}

console.log(
  `${verified} external citations resolve against ${EXTERNAL.join(', ')}.\n` +
    `Line ranges are checked for existence, not content — a range that exists but ` +
    `describes different code is only findable by reading it.`,
);
