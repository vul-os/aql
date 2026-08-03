import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The last unheld link in the hazardous-motion confirm ceremony.
//
// Three things stand between an unconsidered tap and a mower's blades, and two
// of them are properly tested:
//
//   1. The hub refuses a verb above the confirm ceiling without `confirm: true`
//      — engineconfirm_test.go, four cases, each asserting what the DRIVER
//      received rather than the status code, "because a 409 that still actuated
//      would look identical from the response".
//   2. api.engineExecute sends `confirm: false` unless the caller asks
//      otherwise — engineApi.test.ts, whose comment says why: "a client that
//      pre-confirms defeats the whole mechanism".
//   3. Devices.tsx passes `false` on the first press and `true` only from the
//      confirmation prompt. Nothing checked this.
//
// Link 3 is where the ceremony can be lost without anything noticing. The hub
// cannot tell "the operator confirmed" from "the client always sends true" —
// that is the one distinction it is structurally unable to make — so if the
// button were changed to send `true` on the first press, every hazardous verb
// would fire on one tap and all four hub tests would still pass.
//
// # Why this is a source-shape assertion, which is a weak kind
//
// The honest test is a rendered one: click the control, assert no actuation,
// assert a prompt, click confirm, assert actuation. This repository has no
// React testing library and no DOM environment (vitest runs in `node`), and the
// browser suite starts its hub with no `-device-drivers`, so there is no engine
// device to press. Reaching this properly means either adding test
// dependencies or putting a test-only driver into the shipped allowlist, and
// the second of those is a production hazard created to make a test possible.
//
// So this reads the source instead. It cannot prove the button behaves; it can
// prove nobody quietly pre-confirmed it, which is the regression that matters.
// Comments are stripped first — a guard that matches its own explanatory prose
// is a recurring defect in this repository.

function code(path: string): string {
  return readFileSync(join(repo, path), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the confirm ceremony survives in the console', () => {
  const src = code('src/pages/app/Devices.tsx');

  it('sends every control press unconfirmed', () => {
    // The device control buttons. Each must ask the hub first and let it
    // decide whether a confirmation is owed.
    const unconfirmed = [...src.matchAll(/send\(\s*c\s*,\s*false\s*\)/g)];
    expect(
      unconfirmed.length,
      'no control button sends an unconfirmed execute — either the call was renamed ' +
        'or the first press now pre-confirms',
    ).toBeGreaterThanOrEqual(1);
  });

  it('confirms from the prompt and from nowhere else', () => {
    // The whole assertion. Exactly one call site may pass true, and it must be
    // the one reading the pending confirmation — a second `true` anywhere is a
    // path that skips the prompt.
    const confirmed = [...src.matchAll(/send\([^)]*,\s*true\s*\)/g)].map((m) => m[0]);
    expect(
      confirmed,
      'exactly one call may confirm, and only the pending-confirmation prompt may make it',
    ).toEqual(['send(awaitingConfirm.control, true)']);
  });

  it('still routes a 409 into the prompt rather than an error', () => {
    // If this stopped being wired, the prompt would never appear and the
    // ceremony would read as a plain failure — which is how someone concludes
    // the feature is broken and "fixes" it by pre-confirming.
    expect(src).toMatch(/described\.kind === 'confirm'/);
    expect(src).toMatch(/setAwaitingConfirm\(/);
  });

  it('the api client is the other half, and still defaults to false', () => {
    // Asserted here as well as in engineApi.test.ts because the two halves
    // only mean something together: a button that passes false into a client
    // that overrides it confirms nothing.
    expect(code('src/lib/api.ts')).toMatch(/confirm:\s*body\.confirm\s*\?\?\s*false/);
  });
});
