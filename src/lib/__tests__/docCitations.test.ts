import { describe, expect, it } from 'vitest';
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
  'ephor/',
  'kotva/',
  'substrate/',
  'flowstock/',
  'crates/',
  'coordinator/',
  'adapters/',
  'bindings/',
  'vectors/',
  'camera/',
  'clock/',
  'components/',
  'lintel/',
];

/** Documents worth holding to this. Everything tracked, not a sample. */
function docFiles(): string[] {
  const out: string[] = ['ROADMAP.md', 'ARCHITECTURE.md', 'README.md'];
  for (const dir of ['docs', 'proto']) {
    for (const f of readdirSync(resolve(root, dir))) {
      if (f.endsWith('.md')) out.push(`${dir}/${f}`);
    }
  }
  return out.filter((f) => existsSync(resolve(root, f)));
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
 * Both of these appear inside passages the citing document explicitly marks as
 * historical — a record of what the code used to do, kept because the reasoning
 * still explains the shape of what replaced it. Rewriting them to point at
 * current files would falsify that record, which is worse than a dangling path.
 *
 * Keyed by document so a stale path cannot be laundered into a different file
 * by adding it here once. Neither file is coming back, so unlike the PENDING
 * entries in routeCoverage these are permanent rather than debt.
 */
const HISTORICAL: Record<string, Record<string, string>> = {
  'docs/CHAT-COMMANDS.md': {
    'src/lib/demoData.ts':
      'the demo dataset, deleted when the console moved to live engine state; ' +
      'cited in §2.2 and §4.3-4.4, which document behaviour as it was',
  },
  'docs/DESIGN-SYSTEM.md': {
    'src/app.css':
      "deleted in the lintel fold; §7 is explicitly the 'system that was replaced'",
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
    expect(checked, 'no citations parsed — the pattern has drifted').toBeGreaterThan(300);
    expect(broken, `${broken.length} citations point at files that do not exist`).toEqual([]);
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
    const offenders: string[] = [];
    for (const doc of docFiles()) {
      const text = readFileSync(resolve(root, doc), 'utf8');
      for (const m of text.matchAll(/`(lintel\/[A-Za-z0-9_./-]+)`/g)) {
        offenders.push(`${doc} cites ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
