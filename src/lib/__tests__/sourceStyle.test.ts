import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A formatter this repository does not use must not rewrite it.
 *
 * There is no prettier config here and prettier is not a dependency. The house
 * style is single-quoted strings and a wide print width, neither of which is
 * prettier's default — so running `npx prettier --write` on a file rewrites
 * every string and rewraps every line in it.
 *
 * That happened. A six-line change to Devices.tsx was committed as a 608-line
 * diff, with all eighteen of its imports converted from single to double quotes,
 * inside a commit whose message described the six lines. Nothing failed: the
 * types checked, the tests passed, and the reformat was invisible in a summary.
 * It was found only because a DIFFERENT test — engineControls, which parses
 * engineState.ts as text — broke when prettier rewrapped the table it reads.
 *
 * The cost of a stray reformat is not aesthetic. It buries the real change in
 * noise, so a reviewer cannot see what actually happened, and it makes every
 * later `git blame` on that file point at the reformat.
 *
 * # Why import quotes, specifically
 *
 * They are the one part of the style that is unambiguous. An ordinary string
 * containing an apostrophe is CORRECTLY double-quoted, so a blanket quote check
 * would fire on honest code. An import specifier never contains one, so this
 * check has no legitimate exception — which is what makes it worth having and
 * why it is not widened.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('source style survives a stray formatter', () => {
  const files = [
    ...sourceFiles(path.join(repo, 'src')),
    ...sourceFiles(path.join(repo, 'e2e-browser')),
  ];

  it('reads a plausible number of source files', () => {
    // A walk that returned nothing would pass the check below trivially.
    expect(files.length).toBeGreaterThan(50);
  });

  it('imports are single-quoted, because that is what this repo writes', () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // `from "…"` and bare side-effect `import "…"`. Both are unambiguous:
          // a module specifier never contains an apostrophe, so there is no
          // honest reason for one to be double-quoted here.
          if (/^\s*(import|export)[^'"]*from\s+"/.test(line) || /^\s*import\s+"/.test(line)) {
            offenders.push(`${path.relative(repo, file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(
      offenders,
      'these imports are double-quoted, which this repo does not write. The usual cause is ' +
        'running a formatter the repo does not use (there is no prettier config and prettier ' +
        'is not a dependency) — check whether the file was also rewrapped, because that buries ' +
        'the real change in noise and redirects every later git blame to the reformat.\n\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
