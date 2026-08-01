import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every documented `docker build` must be one that works.
//
// # What was wrong
//
// Three of the four documented build commands could not build anything, and one
// of them was in the header of the Dockerfile it was building:
//
//   hub/Dockerfile:5        docker build -t aql-hub hub
//   README.md:141           docker build -t aql-hub hub
//   site/docs/self-host.md  cd aql/hub && docker build -t aql-hub .
//
// All three pass `hub/` as the build CONTEXT. hub/go.mod carries
// `replace github.com/vul-os/aql/jcs => ../jcs`, and the Dockerfile copies that
// sibling module in, so a context of hub/ cannot see it:
//
//   ERROR: failed to compute cache key: "/jcs": not found
//
// That is not a hypothetical. The same mistake in the release workflow — a
// `context: hub` — left the published image unbuildable for three days, and the
// Dockerfile documents it at length at the COPY. The header three lines above
// that explanation then told every reader to make it again.
//
// Only CI and scripts/check.sh had it right, and neither is where a person
// looks. Someone self-hosting reads README or site/docs, runs what it says, and
// gets a checksum error naming a path that appears nowhere in the instructions.
//
// # Why this is anchored to the CAUSE
//
// The rule is not "the string must look like this". If the sibling-module COPY
// ever goes away — the jcs module is folded in, say — a hub/ context would
// become legal and this guard would be enforcing a dead constraint while
// sounding authoritative. So it reads the Dockerfile first and fails LOUDLY if
// the reason has disappeared, which sends whoever removed it here to decide,
// rather than silently continuing to demand the workaround for a solved problem.
//
// There is no exemption for prose quoting the WRONG command as a warning, and
// that is deliberate: any marker meaning "this one is only an example" is also
// the marker a genuinely broken instruction hides behind. A doc that needs to
// warn about the old form can describe the context instead of writing a command
// — which is what hub/Dockerfile's header now does.

const root = join(__dirname, '..', '..', '..');

function tracked(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** Lines that invoke docker build, with the preceding line for `cd x && …` forms. */
function buildCommands(): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  for (const rel of tracked()) {
    if (!/\.(md|ya?ml|sh)$|Dockerfile$/.test(rel)) continue;
    let body: string;
    try {
      body = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    body.split('\n').forEach((raw, i) => {
      // The comment marker is stripped so a Dockerfile/shell comment is held to
      // the same standard as a fenced code block: the header line that started
      // this was a comment, and a reader copies it just the same.
      const text = raw.replace(/^\s*#\s?/, '').trim();
      if (!/\bdocker build\b/.test(text)) return;
      // `- name: docker build` is a step label, not a command.
      if (/^-?\s*name:/.test(text)) return;
      out.push({ file: rel, line: i + 1, text });
    });
  }
  return out;
}

/**
 * A command is correct when it names the Dockerfile explicitly and passes the
 * repository root as context. Returns null when fine, else why not.
 */
function wrong(text: string): string | null {
  if (!/-f\s+hub\/Dockerfile/.test(text)) {
    return 'does not pass -f hub/Dockerfile, so the context is being used to find it';
  }
  // The context is the last bare argument. Anything but `.` — most of all a
  // bare `hub` — is the outage.
  // Trailing quote stripped: in scripts/check.sh the command is inside an
  // echo, so the last token is `."` and a naive comparison calls the
  // correct command wrong.
  const ctx = text.trim().split(/\s+/).pop()?.replace(/^["']|["']$/g, '');
  if (ctx !== '.') {
    return `builds with context ${ctx ?? '(none)'}; it must be the repository root`;
  }
  if (/\bcd\b[^&|]*\bhub\b[^&|]*&&/.test(text)) {
    return 'cds into hub/ first, which makes `.` the hub directory rather than the root';
  }
  return null;
}

describe('documented docker build commands', () => {
  it('still needs the root context — the sibling module is still copied in', () => {
    const dockerfile = readFileSync(join(root, 'hub', 'Dockerfile'), 'utf8');
    const copiesSibling = /^\s*COPY\s+jcs\//m.test(dockerfile);
    expect(
      copiesSibling,
      `hub/Dockerfile no longer copies the jcs/ sibling module, so a build context of
hub/ may now be legal and the rule this file enforces may be obsolete. Check
whether hub/go.mod still has its replace directive, then either update this
guard or delete it — do not leave it demanding a workaround for a problem that
no longer exists.`,
    ).toBe(true);
  });

  it('are all runnable as written', () => {
    const found = buildCommands();

    // The floor. A pattern that stops matching turns this into a test that
    // examines nothing and passes — the failure mode this repository keeps
    // finding in its own guards.
    expect(
      found.length,
      'found no docker build commands at all; the scan is broken, not the docs',
    ).toBeGreaterThanOrEqual(4);
    expect(new Set(found.map((f) => f.file)).size).toBeGreaterThanOrEqual(3);

    const bad = found
      .map((f) => ({ ...f, why: wrong(f.text) }))
      .filter((f) => f.why);

    expect(
      bad.map((f) => `${f.file}:${f.line} ${f.why}\n    ${f.text}`).join('\n'),
      `a documented build command cannot build. The context must be the repository
root, because hub/go.mod replaces the jcs module with ../jcs and the Dockerfile
copies it in — with a hub/ context, go mod download fails on "/jcs: not found".`,
    ).toBe('');
  });

  it('rejects each way of getting it wrong', () => {
    // The control. Without it, a `wrong()` that returned null unconditionally
    // would make the test above pass on any documentation at all.
    expect(wrong('docker build -t aql-hub hub')).toMatch(/-f hub\/Dockerfile/);
    expect(wrong('docker build -f hub/Dockerfile -t aql-hub hub')).toMatch(/context hub/);
    expect(wrong('cd aql/hub && docker build -f hub/Dockerfile -t x .')).toMatch(/cds into hub/);
    expect(wrong('docker build -f hub/Dockerfile -t aql-hub:ci .')).toBeNull();
    expect(wrong('docker build --build-arg VERSION=1 -f hub/Dockerfile -t x .')).toBeNull();
    // Quoted, as scripts/check.sh has it inside an echo.
    expect(wrong('echo "  docker build -f hub/Dockerfile -t aql-hub:ci ."')).toBeNull();
  });
});
