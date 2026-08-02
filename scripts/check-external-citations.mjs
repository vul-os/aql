#!/usr/bin/env node
//
// check-external-citations.mjs — verify the citations Aql's docs make INTO
// sibling repos (ephor/, kotva/).
//
// # Why this is a script and not a gate
//
// docCitations.test.ts resolves every cited path in every tracked document and
// exempts exactly these, because the sibling repos are not part of this
// checkout and a test that depends on them would fail in CI for a reason that
// has nothing to do with this repo. So they were never checked at all — 75
// citations in docs/EPHOR-CHAT-SEAM.md alone, several of them load-bearing for
// a design decision.
//
// The first run found two that had drifted: `broker-conformance/src/lib.rs`
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

/** Repos cited from this one that live beside it rather than inside it. */
const EXTERNAL = ['ephor', 'kotva'];

const CITATION =
  /`((?:ephor|kotva)\/[A-Za-z0-9_./-]+\.(?:rs|md|toml|go|ts))(?::(\d+)(?:-(\d+))?)?`/g;

function trackedDocs() {
  return execFileSync('git', ['ls-files', '*.md'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.md') && existsSync(join(repo, f)));
}

const absent = EXTERNAL.filter((r) => !existsSync(join(siblings, r)));

const found = [];
for (const doc of trackedDocs()) {
  const text = readFileSync(join(repo, doc), 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(CITATION)) {
      found.push({ doc, line: i + 1, path: m[1], from: m[2], to: m[3] });
    }
  });
}

if (absent.length) {
  console.error(
    `NOT CHECKED — ${absent.join(', ')} ${absent.length === 1 ? 'is' : 'are'} not checked out beside this repo.\n` +
      `${found.length} external citations went unverified. Clone them next to aql/ and run this again.`,
  );
  process.exit(2);
}

const problems = [];
let verified = 0;
for (const c of found) {
  const full = join(siblings, c.path);
  if (!existsSync(full)) {
    // An absence can be the claim itself: EPHOR-CHAT-SEAM §0.1 is titled
    // "`ephor/coordinator/CONTRACT.md` does not exist" and says so twice on
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
if (verified < 70) {
  console.error(
    `only ${verified} external citations were verified — the pattern has drifted, ` +
      `since docs/EPHOR-CHAT-SEAM.md alone carries about 75.`,
  );
  process.exit(1);
}

console.log(
  `${verified} external citations resolve against ${EXTERNAL.join(', ')}.\n` +
    `Line ranges are checked for existence, not content — a range that exists but ` +
    `describes different code is only findable by reading it.`,
);
