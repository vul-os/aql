import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every page under src/pages/ must be reachable — routed, or imported by
 * something that is.
 *
 * # Why this matters more than "dead code is untidy"
 *
 * apiReachability.test.ts holds that no api.ts client exists without a screen
 * calling it, and that guarantee is only as good as the screens. A page nobody
 * routes still IMPORTS things: its `api.foo()` calls make `foo` look reached, so
 * a dead page does not merely sit there — it launders unreachable API surface
 * into apparently-live surface. The two guards have to run together or the
 * older one quietly weakens.
 *
 * It is the frontend twin of internal/httpapi's routed-handler test and
 * internal/store's reachability test, and the reasoning is the one those two
 * quote: every previous instance was a feature that did not work, whose tests
 * passed throughout because the code was correct and never executed.
 *
 * # Routed OR imported, because src/pages/ holds one thing that is not a page
 *
 * `pages/docs/CodeBlock.tsx` is a shared Prism wrapper used by five doc pages.
 * It has no route and never will, and a rule of "every file under pages/ must
 * be routed" would demand it be moved to satisfy a test rather than because
 * anybody wanted it moved. Reachability is the property worth holding; the
 * directory a component sits in is not.
 */

const root = resolve(__dirname, '../../..');
const pagesDir = resolve(root, 'src/pages');

/** Every .tsx under src/pages/, as repo-relative paths. */
function pageFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.tsx')) out.push(p.slice(root.length + 1));
    }
  })(pagesDir);
  return out.sort();
}

/** Everything that could reference a page: routes plus all other source. */
function referencingSources(): Map<string, string> {
  const out = new Map<string, string>();
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs)$/.test(entry)) out.set(p.slice(root.length + 1), readFileSync(p, 'utf-8'));
    }
  })(resolve(root, 'src'));
  return out;
}

describe('pages are reachable', () => {
  const pages = pageFiles();
  const sources = referencingSources();

  it('finds the pages at all', () => {
    // The guard on the guard: a walk that stopped seeing src/pages would make
    // every assertion below vacuous.
    expect(pages.length).toBeGreaterThan(25);
    expect(pages).toContain('src/pages/app/HazardousCommands.tsx');
  });

  it('every page is routed, or imported by something else', () => {
    const orphans: string[] = [];
    for (const page of pages) {
      // How an import names it: `@/pages/app/Devices`, `./Devices`, `../docs/X`.
      const stem = page.replace(/^src\//, '').replace(/\.tsx$/, ''); // pages/app/Devices
      const base = stem.slice(stem.lastIndexOf('/') + 1);

      let referenced = false;
      for (const [file, body] of sources) {
        if (file === page) continue;
        // Full path form, or a relative import ending in the basename. The
        // basename alone would false-negative nothing and false-POSITIVE on a
        // same-named symbol, so it is anchored to an import/lazy specifier.
        if (
          body.includes(`@/${stem}`) ||
          new RegExp(`from ['"][^'"]*/${base}['"]`).test(body) ||
          new RegExp(`import\\(['"][^'"]*/${base}['"]\\)`).test(body)
        ) {
          referenced = true;
          break;
        }
      }
      if (!referenced) orphans.push(page);
    }

    expect(
      orphans,
      `these pages are not routed and nothing imports them. A page nobody can ` +
        `reach still makes its api.ts calls look used, which weakens ` +
        `apiReachability — route it, import it, or delete it:\n  ` +
        orphans.join('\n  '),
    ).toEqual([]);
  });
});
