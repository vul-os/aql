import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every repo file a document cites has to exist.
 *
 * # What went wrong without this
 *
 * `docs/DESIGN-SYSTEM.md` carried 104 citations under a `lintel/` prefix — the
 * repository this frontend was folded in from. After the fold not one of those
 * paths resolved, and three of them named components that had since been
 * deleted outright (`Accordion.tsx`, `Hero.tsx`, `WhatsAppDemo.tsx`), so the
 * document described UI that does not exist. `docs/CHAT-COMMANDS.md` cited
 * `src/lib/demoData.ts` eight times while one line of the same file noted the
 * file was gone.
 *
 * None of that is catchable by reading. A stale citation looks exactly like a
 * live one, and the reader who would notice is the one who follows the link —
 * by which point the document has already misled them.
 *
 * # What this does NOT check
 *
 * Line numbers. They were dropped from DESIGN-SYSTEM.md rather than corrected,
 * because they cannot be verified in bulk and the failure is silent:
 * `AccessPoints.tsx:94` was within the file and pointed at unrelated code. A
 * citation that looks precise and is not is worse than one that does not
 * pretend. If a line ever matters, quote the code instead — a quote can be
 * checked, a number cannot.
 *
 * Citations into SIBLING REPOSITORIES (the EXTERNAL_REPOS list below). Those
 * paths cannot be resolved from here — kotva/ and ephor/ are not checked out in
 * CI — so they are skipped, and it is worth saying why no guard covers them
 * rather than leaving that looking like an oversight.
 *
 * A guard that verified them WHEN the sibling repo happened to be present would
 * skip every citation in CI and print PASS. That is the exact shape of the
 * hollow gate this repository keeps finding: a check whose subject is absent,
 * reporting success. Making it fail when the repos are missing breaks CI for
 * everyone; making it opt-in means CI never runs it. There is no version of it
 * that is both honest and green.
 *
 * So they were verified ONCE, by hand, on 2026-08-01, against the local
 * checkouts: 78 unique external citations, all resolving except two deliberate
 * ones (EPHOR-CHAT-SEAM.md §0.1 cites `ephor/coordinator/CONTRACT.md` precisely
 * to establish that it does not exist). Quote-and-line pairs were then checked
 * by script, which flagged thirteen — of which twelve were the script
 * mis-pairing a quote with the next citation in the paragraph, and ONE was
 * real: the §7.11.2 open-relay sentence was cited at `kotva/07-gateway.md:876-878`
 * and lives at 886-887, with 876-878 holding unrelated text. It now cites the
 * SECTION, which is stable, greppable and does not drift when a paragraph is
 * inserted above it.
 *
 * That is the durable lesson, and it is the same one that made this file drop
 * line numbers from DESIGN-SYSTEM.md rather than correct them: for a target
 * nothing can check, a section reference is worth more than a line range,
 * because it degrades honestly instead of pointing confidently at the wrong
 * paragraph.
 *
 * It also does not check that the SURROUNDING CLAIM is true. Every value in the
 * design system's type-scale table pointed at a file that existed and stated a
 * size the file had not used since the site was redesigned. This test would not
 * have caught that, and saying so here is the point: a green run means the
 * paths resolve, not that the document is right.
 */

const root = resolve(__dirname, '../../..');

/**
 * Other repositories in the Vulos suite. Aql's docs reference them deliberately
 * — the Ephor seam and the Kotva alignment notes are about work that lives
 * elsewhere — and those paths cannot be checked from here. Listed by PREFIX so
 * a new file under one of them needs no change, and listed explicitly so
 * "unresolvable" never quietly becomes "ignored".
 */
const EXTERNAL_REPOS = [
  'pier/',
  'kotva/',
  'substrate/',
  'flowstock/',
  'crates/',
  'coordinator/',
  'adapters/',
  'bindings/',
  'vectors/',
  'lintel/',
  // The retired Cloudflare Workers backend's own layout. hub/README's porting
  // map is a two-column table — their file, our file — so its left column is
  // full of paths from a codebase that has been deleted. Same category as
  // lintel/: another repository, not a broken reference.
  'routes/',
  'lib/rate-limit',
];

// `camera/`, `clock/` and `components/` used to sit in that list. They are not
// other repositories — they are this one, abbreviated: `camera/rtsp.go` is
// hub/internal/devices/camera/rtsp.go and `components/device/X.tsx` is under
// src/. They were listed as external because the resolver could not follow
// those abbreviations, so every citation using them was skipped rather than
// checked. The resolver knows both now, and the entries are gone, which turns
// roughly a dozen skipped citations into checked ones.

// A changelog records what was true at a version, so it cites files that have
// since been deleted BY DESIGN — src/lib/gateway.ts and the gateway console
// gate went with the rename, demoData with the live-state migration. Rewriting
// those entries would falsify the record; checking them would fail forever.
const HISTORICAL_BY_NATURE = ['CHANGELOG.md'];

/** Documents worth holding to this. Everything tracked, not a sample. */
// Every tracked Markdown file, not a hand-listed few.
//
// This used to be ROADMAP, ARCHITECTURE, README and whatever sat directly in
// docs/ and proto/. Everything else was invisible to every check in this file:
// the module READMEs, CONTRIBUTING, SECURITY, and — worst — site/docs, which is
// the documentation actually published to readers.
//
// The cost was not theoretical. hub/README.md opened by calling a deleted
// directory the behavioural spec, the guard that exists to catch exactly that
// was added afterwards, and it never looked at the file: the tamper certifying
// it ran vitest from the wrong directory and reported a false CAUGHT, so
// nothing said the file was out of scope.
//
// git ls-files rather than a walk, so build output and node_modules cannot
// wander in.
function docFiles(): string[] {
  return execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.md'))
    .filter((f) => existsSync(resolve(root, f)));
}

/**
 * A citation is a backticked path with a source extension, optionally followed
 * by a line reference. Prose like `open` or `--ink` cannot match: the extension
 * is required, and so is a directory separator, because a bare `main.css` is
 * ambiguous between three files and was never meant as a path.
 */
const CITATION = /`([A-Za-z0-9_][A-Za-z0-9_./-]*\/[A-Za-z0-9_.-]+\.(?:go|ts|tsx|sql|mjs|js|css|html|svg|md|sh|yml|yaml|json|rs))(?::[0-9-]+)?`/g;

/**
 * Citations to files that are deliberately GONE.
 *
 * Both appear inside passages the citing document explicitly marks as
 * historical — a record of what the code used to do, kept because the reasoning
 * still explains the shape of what replaced it. Rewriting them to point at
 * current files would falsify that record, which is worse than a dangling path.
 *
 * # Why each carries a COUNT
 *
 * This exemption was per-document, and that is exactly how it failed. The entry
 * below said demoData.ts was cited "in §2.2 and §4.3-4.4, which document
 * behaviour as it was". §2.2 is genuinely historical and carries a NOTE saying
 * so. The rest were not: five citations sat in §4.3-4.5, which are the
 * present-tense disclosure rules — "No raw telemetry (src/lib/demoData.ts)",
 * "automation states that imply occupancy (src/lib/demoData.ts)". They cited a
 * deleted file as live evidence for rules the product is meant to follow today,
 * and one of them propped up an example the runtime can no longer express at
 * all: an `Away arm` automation triggered by "everyone leaves", when the trigger
 * set is closed and contains no presence trigger.
 *
 * A document-scoped exemption cannot tell those apart. Granted once for a real
 * historical passage, it launders every later citation of the same path anywhere
 * in the same file — including ones written years apart for opposite reasons.
 *
 * So the count is the exemption's real content. A new citation of an exempt path
 * fails this suite even though the path is exempt, which forces the question the
 * document-level entry let people skip: is this passage historical, or is it
 * live text quietly pointing at something that is not there?
 */
type Historical = { readonly count: number; readonly why: string };

const HISTORICAL: Record<string, Record<string, Historical>> = {
  'docs/CHAT-COMMANDS.md': {
    'src/lib/demoData.ts': {
      count: 2,
      why:
        'the demo dataset, deleted when the console moved to live engine state. ' +
        'Both remaining citations are in §2.2, which opens with a NOTE stating ' +
        'the file is gone and that the section describes superseded behaviour. ' +
        'The five that were in §4.3-4.5 now cite automations/rule.go, ' +
        'devices/model.go and the energy series route instead.',
    },
  },
  'docs/DESIGN-SYSTEM.md': {
    'src/app.css': {
      count: 6,
      why: "deleted in the lintel fold; §7 is explicitly the 'system that was replaced'",
    },
  },
};

function isHistorical(doc: string, path: string): boolean {
  return HISTORICAL[doc]?.[path] !== undefined;
}

function isExternal(path: string): boolean {
  return EXTERNAL_REPOS.some((p) => path.startsWith(p));
}

/**
 * Where a path may resolve from. A document under `proto/` naming
 * `vectors/verify.mjs` means `proto/vectors/verify.mjs`, and one naming
 * `internal/store/x.go` means `hub/internal/store/x.go` — module-relative
 * citation is the house style and predates this check.
 */
function resolvedPath(path: string, doc: string): string | null {
  const docDir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '';
  const candidates = [
    path,
    `hub/${path}`,
    `controller/${path}`,
    `e2e/${path}`,
    // The house style abbreviates from the package root: `channels/verb.go`
    // means `hub/internal/channels/verb.go`, and has since long before this
    // check. Rewriting every such citation to be absolute would be a far larger
    // and more churn-prone diff than teaching the resolver the convention.
    `hub/internal/${path}`,
    `controller/internal/${path}`,
    // The console abbreviates from src/, the same way Go docs abbreviate from
    // the package root: `components/device/X.tsx` and `lib/api.ts`.
    `src/${path}`,
    // And the device engine is one level deeper than internal/.
    `hub/internal/devices/${path}`,
    // Migrations are cited bare: `migrations/0007_audit_hash_chain.sql`.
    `hub/internal/store/${path}`,
  ];
  if (docDir) candidates.push(`${docDir}/${path}`);
  return candidates.find((c) => existsSync(resolve(root, c))) ?? null;
}

/** Whether a cited path resolves at all. */
function resolves(path: string, doc: string): boolean {
  return resolvedPath(path, doc) !== null;
}

describe('documentation citations', () => {
  it('every cited repo file exists', () => {
    const broken: string[] = [];
    let checked = 0;
    for (const doc of docFiles()) {
      const text = readFileSync(resolve(root, doc), 'utf8');
      if (HISTORICAL_BY_NATURE.includes(doc)) continue;
      for (const m of text.matchAll(CITATION)) {
        const path = m[1];
        if (isExternal(path)) continue;
        if (isHistorical(doc, path)) continue;
        checked++;
        if (!resolves(path, doc)) broken.push(`${doc} cites ${path}`);
      }
    }
    // A parser that matched nothing would pass this test forever. The count is
    // the guard on the guard.
    // 665 citations are really checked here; the floor was 300. "No citations
    // parsed" is not the only way a pattern drifts — matching half of them is
    // the more likely and more dangerous one. (665, not the ~835 a plain regex
    // sweep of the same files reports: external and historical citations are
    // resolved away before this counter increments. Worth measuring with the
    // test's own logic rather than an approximation of it.)
    expect(checked, 'the citation pattern has drifted').toBeGreaterThan(600);
    expect(broken, `${broken.length} citations point at files that do not exist`).toEqual([]);
  });

  it('no historical exemption covers more citations than it was granted for', () => {
    // The exemption is document-scoped, so without this it is a blanket licence
    // to cite a deleted file anywhere in that document forever. That is not
    // hypothetical: five live citations in §4.3-4.5 rode in on an entry written
    // for §2.2, and were found by a sweep from OUTSIDE this test rather than by
    // this test — which is the recurring lesson about exemption lists here.
    for (const [doc, paths] of Object.entries(HISTORICAL)) {
      const text = readFileSync(resolve(root, doc), 'utf8');
      for (const [path, { count }] of Object.entries(paths)) {
        const actual = [...text.matchAll(CITATION)].filter((m) => m[1] === path).length;
        expect(
          actual,
          `${doc} cites ${path} ${actual} times; the exemption covers ${count}. ` +
            `If the new one is in a passage marked historical, raise the count and ` +
            `say where. If it is live text, repoint it at a file that exists — a ` +
            `dangling path in a present-tense rule reads as evidence and is not.`,
        ).toBe(count);
      }
    }
  });

  // Two directory names that no longer exist, and must not be written as if
  // they do.
  //
  // ARCHITECTURE.md states the rule itself — "There is no `backend/`. […] Any
  // comment or doc still referring to it is stale" — and a sweep recorded in
  // CHANGELOG fixed a batch of them. Three survived that sweep and were still
  // there months later: hub/README opened by calling the deleted Workers
  // backend "the behavioral spec this is being ported from", cited a file inside
  // it, and e2e-browser/README listed `backend/` and `gateway/` among the
  // directories this repository is organised into.
  //
  // docCitations cannot see any of that: it requires a file EXTENSION, so a bare
  // directory reference is invisible to it. The gateway→hub rename is the same
  // shape, which is why both names are checked here.
  //
  // Files that explain the deletion, or record it as history, are exempt by name
  // — a rule that forbade the words outright would forbid saying they are gone.
  it('no document presents a deleted directory as one that exists', () => {
    const gone = ['backend/', 'gateway/'];
    const explains = new Set([
      'ARCHITECTURE.md', // states the rule
      'site/docs/architecture.md', // repeats it for the site
      'CHANGELOG.md', // records the deletion and the earlier sweep
      'docs/CHAT-COMMANDS.md', // §2.2's historical passages, already annotated
      'docs/EPHOR-CHAT-SEAM.md', // another repository's gateway/, cited as theirs
      // These three name a deleted directory in order to say it is deleted.
      // Exempting them by name would let a FALSE claim back into the same file,
      // so each is held to its explanation below rather than merely excused.
      'hub/README.md',
      'site/docs/faq.md',
      'site/docs/overview.md',
    ]);

    // The other half of that exemption: the sentence that earns it must still be
    // there. Without this, "hub/README.md is exempt" would permit exactly the
    // claim the guard exists to stop — which is how the file got the claim in
    // the first place.
    const mustExplain: Array<[string, RegExp]> = [
      ['hub/README.md', /There is no `backend\/`/],
      ['site/docs/faq.md', /renamed to `hub\/`/],
      ['site/docs/overview.md', /renamed from `gateway\/`/],
    ];
    for (const [doc, phrase] of mustExplain) {
      expect(
        readFileSync(resolve(root, doc), 'utf8'),
        `${doc} is exempt from the deleted-directory rule because it EXPLAINS the
deletion. That explanation is gone, so the exemption now covers nothing but the
mention itself.`,
      ).toMatch(phrase);
    }

    const offenders: string[] = [];
    let scanned = 0;
    for (const doc of docFiles()) {
      if (explains.has(doc)) continue;
      scanned++;
      readFileSync(resolve(root, doc), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const dir of gone) {
            if (line.includes('`' + dir + '`') || line.includes('`../' + dir + '`')) {
              offenders.push(`${doc}:${i + 1}  ${line.trim().slice(0, 100)}`);
            }
          }
        });
    }

    // The floor: this must be reading real documents, not an empty list.
    expect(scanned, 'no documents scanned').toBeGreaterThan(10);
    expect(
      offenders,
      `these name a directory that was deleted. ARCHITECTURE.md §2: "There is no
\`backend/\`. […] Any comment or doc still referring to it is stale." If the
mention is deliberately historical, say so in the sentence and add the file to
the exempt list with that reason.`,
    ).toEqual([]);
  });

  it('every historical exemption is still a file that does not exist', () => {
    // An exemption for a path that resolves again is an exemption doing
    // nothing, and the next reader would trust it as evidence the citation was
    // examined. Cheap to check, so checked.
    for (const [doc, paths] of Object.entries(HISTORICAL)) {
      for (const path of Object.keys(paths)) {
        expect(
          resolves(path, doc),
          `${path} exists again — drop the historical exemption in ${doc}`,
        ).toBe(false);
      }
    }
  });

  /**
   * A quoted citation must still say what the citing document claims it says.
   *
   * # The gap this closes
   *
   * Everything above checks that a cited PATH resolves. Nothing checked that a
   * quoted SENTENCE still exists in the file it is attributed to, and six had
   * drifted by the time this was written:
   *
   *   - Three quotes from `proto/events.md` said "gateway operator" / "the
   *     gateway never has it" where the file says "hub". The gateway→hub rename
   *     swept through quoted text along with the prose, so the documents went on
   *     attributing words to a file that does not contain them.
   *   - `docs/CHAT-COMMANDS.md` quoted a sentence about unlocking doors and
   *     moving machinery and credited it to `docs/THREAT-MODEL.md`. The threat
   *     model never contained it — the words were CHAT-COMMANDS' own, cited back
   *     to itself through another document's name. That is the worst shape of
   *     this defect: it manufactures external support for a claim.
   *   - The same file quoted a device-model definition from `ARCHITECTURE.md`
   *     that lives in `site/docs/devices.md`.
   *
   * # What it tolerates, and why each is not a hole
   *
   * A quote is compared after collapsing whitespace (so a reflowed paragraph
   * still matches), stripping comment and blockquote markers (so a quote from a
   * Go comment matches), unifying quote marks (documents routinely render a
   * source's " as ' when nesting), lowercasing (a sentence quoted mid-sentence
   * legitimately lowercases its first letter), and ignoring trailing commas and
   * full stops (whether punctuation sits inside or outside a closing quote is a
   * house-style question, not a claim about the source). `…` splits the quote
   * into fragments, each of which must appear — an elision is a real quoting
   * device and forbidding it would push authors to quote less.
   *
   * None of that can hide a changed WORD, which is the failure actually seen.
   *
   * External repos are skipped: this repository cannot verify a quote from a
   * tree it does not contain, and pretending otherwise would fail on every
   * machine that has not cloned the others.
   */
  it('every quoted citation still appears in the file it names', () => {
    // `*"…"*` followed by a backticked path. Emphasised-quote is the house
    // convention for quoting another document, used 135 times.
    const QUOTED = /\*"([^"]{12,240})"\*\s*\(`([^`]+)`\)/g;

    const flatten = (t: string) =>
      t
        .replace(/^\s*(?:\/\/+|\*|>|--)+\s?/gm, '')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/"/g, "'")
        .replace(/\*\*|\*|`|\\/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();

    const problems: string[] = [];
    let checked = 0;

    for (const doc of docFiles()) {
      const body = readFileSync(resolve(root, doc), 'utf8');
      // Matched against the raw text AND a newline-collapsed copy, because a
      // quote that wraps across lines is the common case, not the exception.
      const seen = new Set<string>();
      for (const source of [body, body.replace(/\n/g, ' ')]) {
        for (const m of source.matchAll(QUOTED)) {
          const key = `${m[1]}::${m[2]}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const cited = m[2].split(':')[0];
          if (isExternal(cited) || isHistorical(doc, cited)) continue;
          if (!resolves(cited, doc)) continue; // path checks above own this

          const target = resolvedPath(cited, doc);
          if (!target) continue;
          checked++;

          const hay = flatten(readFileSync(resolve(root, target), 'utf8'));
          const fragments = flatten(m[1])
            .split(/…|\.\.\./)
            .map((f) => f.trim().replace(/^[,;.]+|[,;.]+$/g, ''))
            .filter((f) => f.length >= 10);

          for (const fragment of fragments) {
            if (!hay.includes(fragment)) {
              problems.push(`${doc} quotes ${cited} as "${fragment.slice(0, 90)}…" — it does not say that`);
              break;
            }
          }
        }
      }
    }

    // A regex that matched nothing would pass forever. These documents quote
    // each other constantly; if this drops near zero the convention changed.
    expect(checked, 'no quoted citations parsed — the quoting convention moved').toBeGreaterThan(25);
    expect(problems, 'a document attributes words to a file that does not contain them').toEqual([]);
  });

  /**
   * The docs index must not contradict a document's own status line.
   *
   * `docs/README.md` is a table, and a table row is the cheapest thing in the
   * repository to leave behind. Two rows called shipped work "**Designed, not
   * built**" — CONTROLLER-CONFIG-REPORT, which is built end to end and says so
   * in its first sentence, and ACCESS-ON-THE-ENGINE, whose §3 decisions are
   * code. A reader deciding what to look at reads the index, not eleven status
   * lines, so the index is where "shipped work described as unbuilt" does the
   * most damage.
   *
   * Only this one direction is checked, and deliberately. Judging whether a
   * status line's prose ("mostly proposal, and no longer entirely") agrees with
   * an index summary is not mechanisable; a flat contradiction between "not
   * built" and "built" is.
   */
  it('the docs index does not call a document unbuilt when the document says otherwise', () => {
    const index = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    const problems: string[] = [];
    let rows = 0;

    for (const line of index.split('\n')) {
      const link = line.match(/\[`([A-Za-z0-9_.-]+\.md)`\]\(([^)]+)\)/);
      if (!link || !line.startsWith('|')) continue;
      const target = resolve(root, 'docs', link[1]);
      if (!existsSync(target)) continue;
      rows++;

      // What the ROW claims. Bounded to explicit unbuilt phrasings rather than
      // any appearance of "built", because "never run against a camera" and
      // "built end to end" both contain the word.
      const rowSaysUnbuilt = /\*\*(?:Designed, not built|Nothing in it is built|Not built)\.?\*\*/i.test(line);
      if (!rowSaysUnbuilt) continue;

      // What the DOCUMENT claims, from its own status line.
      const status = readFileSync(target, 'utf8').match(/\*\*Status:[^*]*\*\*/i);
      if (!status) continue;
      const text = status[0];
      const saysBuilt = /\bbuilt\b/i.test(text) && !/\bnot built\b|\bunbuilt\b|\bnothing\b/i.test(text);
      if (saysBuilt) {
        problems.push(`docs/README.md calls ${link[1]} unbuilt, but it says: ${text}`);
      }
    }

    expect(rows, 'no index rows parsed — the docs table changed shape').toBeGreaterThan(5);
    expect(problems, 'the docs index contradicts a document it links to').toEqual([]);
  });

  it('no document cites the pre-fold lintel/ layout as a path', () => {
    // The fold is done and those paths are gone. Kept as its own expectation
    // because EXTERNAL_REPOS has to list `lintel/` — a doc CAN legitimately
    // discuss the prefix in prose (this one does) — and without this, adding it
    // to that list would have silently re-permitted the whole broken set.
    // Documents whose subject IS the fold may name the old layout: the changelog
    // records the move, and two others explain the prefix in prose while telling
    // a reader not to use it. Widening this check from five files to every
    // tracked document brought them into scope, and the rule they break is one
    // they are describing.
    const explainsTheFold = new Set([
      'CHANGELOG.md',
      'ROADMAP.md',
      'docs/DESIGN-SYSTEM.md',
    ]);
    const offenders: string[] = [];
    for (const doc of docFiles()) {
      if (explainsTheFold.has(doc)) continue;
      const text = readFileSync(resolve(root, doc), 'utf8');
      for (const m of text.matchAll(/`(lintel\/[A-Za-z0-9_./-]+)`/g)) {
        offenders.push(`${doc} cites ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Source files that cite documentation, which until now nothing checked.
 *
 * Every test above scans Markdown. But the citation traffic runs the other way
 * too and runs heavier: 190 references to `docs/*.md` from 106 tracked source
 * files, against roughly the same number in the documents themselves. A doc
 * renamed or retired left every one of them pointing at nothing, silently.
 */
function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.go', '*.sh', '*.mjs'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => existsSync(resolve(root, f)));
}

/**
 * A documentation path as written in a comment: bare, not backticked, because
 * that is how source comments cite. `site/` is part of the match rather than
 * left to the tail. A pattern that anchors on the directory alone matches the
 * tail of a site-docs path and reports ten perfectly good citations as
 * dangling, which is what a looser version of this one did before it was
 * written down.
 */
const DOC_PATH = /(?:^|[^A-Za-z0-9_/-])((?:site\/)?docs\/[A-Za-z0-9_-]+\.md)/g;

/** A section number cited immediately beside the document it belongs to. */
const DOC_SECTION = /((?:site\/)?docs\/[A-Za-z0-9_-]+\.md)`?[^\u00a7\n]{0,40}\u00a7([0-9][0-9.]*)/g;

/** The numbered headings a document actually has. */
function sectionNumbers(doc: string): Set<string> {
  const found = new Set<string>();
  for (const line of readFileSync(resolve(root, doc), 'utf8').split('\n')) {
    const m = /^#{1,6}\s+\**([0-9][0-9.]*)\b/.exec(line);
    if (m) found.add(m[1].replace(/\.$/, ''));
  }
  return found;
}

describe('documentation cited from source', () => {
  it('every documentation path named in a source comment exists', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of sourceFiles()) {
      const text = readFileSync(resolve(root, file), 'utf8');
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(DOC_PATH)) {
          checked++;
          if (!existsSync(resolve(root, m[1]))) {
            offenders.push(`${file}:${i + 1} cites ${m[1]}, which does not exist`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
    // A floor, so deleting the scan or narrowing the pattern to nothing fails
    // rather than passing with an empty sweep.
    // 265 real citations behind it.
    expect(checked, 'the source-citation scan has narrowed').toBeGreaterThan(240);
  });

  it('every section number cited beside a document exists in it', () => {
    // Found one on the first run: a comment in the migration-number registry
    // cited `docs/CHAT-COMMANDS.md \u00a71248`, which is a LINE number wearing a
    // section sigil — and the wrong line at that. \u00a75.4 sits there, about
    // identifiers in chat payloads; the passage it meant is \u00a76.3. Nothing
    // could have caught it: the path resolves, the file exists, and no check
    // had ever read the number after it.
    const offenders: string[] = [];
    let checked = 0;
    for (const file of [...sourceFiles(), ...docFiles()]) {
      const text = readFileSync(resolve(root, file), 'utf8');
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(DOC_SECTION)) {
          const [, doc, section] = m;
          if (!existsSync(resolve(root, doc))) continue; // the test above owns that
          checked++;
          const have = sectionNumbers(doc);
          if (have.size === 0) continue; // an unnumbered document cannot be cited by number
          if (!have.has(section.replace(/\.$/, ''))) {
            offenders.push(`${file}:${i + 1} cites ${doc} \u00a7${section}, which has no such section`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
    // 96 real same-line pairs behind it.
    expect(checked, 'the section-citation scan has narrowed').toBeGreaterThan(90);
  });
});


describe('identifiers named beside the file they live in', () => {
  /**
   * A doc can name a function that no longer exists, and every check here will
   * still pass: the path resolves, the file exists, the line range is in
   * bounds. Only the NAME is dead.
   *
   * docs/CHAT-COMMANDS.md's migration table told an implementer to make
   * `TelegramGateKeyboard` generic. There is no such function — it was renamed
   * to `TelegramGatePicker` — so the instruction sent whoever picked it up
   * grepping for something that does not exist.
   *
   * Attribution is nearest-citation-to-the-right, because docs write
   * `Ident` (`file.go`), falling back to the left. The set of citations used
   * for attribution includes .md and .rs — files this never opens — because a
   * comparison table reads `Aql \`grant\` (\`grant.go\`) | KOTVA
   * \`CapabilityToken\` (\`18-wire-format.md\`)`, and an attribution blind to
   * the .md claims CapabilityToken for grant.go and reports a defect that is
   * not there. Same mistake the external checker made with bare line ranges.
   */
  const ANY_PATH = /`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:go|ts|tsx|md|sql|mjs|rs|toml))(?::\d+(?:-\d+)?)?`/g;
  const IDENT = /`([A-Za-z][A-Za-z0-9_]{4,})\(?\)?`/g;
  /** Looks like a code symbol rather than prose: camelCase or CamelCase. */
  const LOOKS_LIKE_SYMBOL = /^[a-z]+[A-Z]|^[A-Z][a-z]+[A-Z]/;
  const CHECKABLE = ['.go', '.ts', '.tsx'];

  it('every symbol named beside a source file exists in that file', () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const doc of docFiles()) {
      const text = readFileSync(resolve(root, doc), 'utf8');
      text.split('\n').forEach((line, i) => {
        const marks = [...line.matchAll(ANY_PATH)].map((m) => ({
          at: m.index ?? 0,
          path: m[1],
        }));
        if (!marks.length) return;

        for (const m of line.matchAll(IDENT)) {
          const ident = m[1];
          if (!LOOKS_LIKE_SYMBOL.test(ident)) continue;
          const at = m.index ?? 0;
          const right = marks.find((k) => k.at > at);
          const near = right ?? [...marks].reverse().find((k) => k.at < at);
          if (!near) continue;
          if (!CHECKABLE.some((e) => near.path.endsWith(e))) continue;
          const full = resolve(root, near.path);
          if (!existsSync(full)) continue; // the path check above owns that
          checked++;
          if (!readFileSync(full, 'utf8').includes(ident)) {
            offenders.push(`${doc}:${i + 1} names \`${ident}\`, which is not in ${near.path}`);
          }
        }
      });
    }

    expect(offenders).toEqual([]);
    // Near the real count (33), not a token floor. This scan is deliberately
    // narrow — it only fires on symbol-shaped names sitting beside a source
    // path — so a pattern that stops matching would otherwise look identical to
    // a clean sweep.
    expect(checked, 'the symbol/citation pairing has stopped matching').toBeGreaterThan(28);
  });
});


describe('a cited line range contains the symbol it is cited for', () => {
  /**
   * The guard above checks a symbol is in the cited FILE. It is not in the
   * cited RANGE that matters, and the difference is a whole class of drift:
   * the path resolves, the file is right, the line count is plausible, and the
   * reader lands a few lines above the thing they were promised.
   *
   * Found on 2026-08-03, by hand, after the same shape turned up in a kotva
   * citation: `parseGrant` cited at grant.ts:80-113 while declared at 78.
   * Reading the neighbours found four more, including ranges off by two
   * hundred lines — `waAccessCommand` cited at :137-181, declared at :364.
   *
   * ONLY lines with exactly one citation and one symbol. A migration table
   * writes `file:A-B`, `:C-D` | `symOne`/`symTwo`, and any positional pairing
   * of those is a guess — the loose version of this scan reported three such
   * lines as broken when all six ranges were correct. 23 unambiguous pairs is
   * a smaller net than the 26 the guess covers, and it does not cry wolf.
   */
  const CITATION_WITH_RANGE =
    /`([A-Za-z0-9_][A-Za-z0-9_./-]*\/[A-Za-z0-9_.-]+\.(?:go|ts|tsx|sql|mjs)):(\d+)(?:-(\d+))?`/g;
  const SYMBOL = /`([A-Za-z_][A-Za-z0-9_]{4,})(?:\(\))?`/g;
  const LOOKS_LIKE_SYMBOL = /^[a-z]+[A-Z]|^[A-Z][a-z]+[A-Z]|^[A-Z_]{4,}$/;

  it('every unambiguous symbol/range pair lands on the symbol', () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const doc of docFiles()) {
      const text = readFileSync(resolve(root, doc), 'utf8');
      text.split('\n').forEach((line, i) => {
        const cits = [...line.matchAll(CITATION_WITH_RANGE)];
        const syms = [...line.matchAll(SYMBOL)]
          .map((m) => m[1])
          .filter((x) => LOOKS_LIKE_SYMBOL.test(x));
        if (cits.length !== 1 || syms.length !== 1) return;

        // One line where a single citation and a single symbol belong to
        // DIFFERENT claims. reply.go:11-14 supports the DenialMessage quote
        // that began on the line above; TruncationNotice belongs to the claim
        // continuing onto the line below, and has its own citation there.
        //
        // Exempted by content rather than by line number, so moving the
        // paragraph does not silently move the exemption onto something else.
        // Requiring symbol-before-citation would also exclude it and takes the
        // population from 23 pairs to 7 — a rule that costs two thirds of the
        // coverage to avoid one known line is the worse trade.
        if (line.includes('TruncationNotice') && line.includes('reply.go:11-14')) return;

        const [, path, from, to] = cits[0];
        const full = resolve(root, path);
        if (!existsSync(full)) return; // the path guard owns that
        const lines = readFileSync(full, 'utf8').split('\n');
        const whole = lines.join('\n');
        if (!whole.includes(syms[0])) return; // the file guard owns that
        checked++;
        const range = lines.slice(Number(from) - 1, Number(to ?? from)).join('\n');
        if (!range.includes(syms[0])) {
          const at = lines.findIndex((l) => l.includes(syms[0])) + 1;
          offenders.push(
            `${doc}:${i + 1} cites ${path}:${from}${to ? `-${to}` : ''} for \`${syms[0]}\`, ` +
              `which is at line ${at}`,
          );
        }
      });
    }

    expect(offenders).toEqual([]);
    expect(checked, 'no symbol/range pairs parsed — the patterns have drifted').toBeGreaterThan(18);
  });
});
