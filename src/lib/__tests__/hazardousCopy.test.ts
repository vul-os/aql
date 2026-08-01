import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The approval screen carries the one claim the T4 design rests on, and this
 * pins the parts of it that a redesign could quietly drop.
 *
 * # Why copy, and not behaviour
 *
 * The behaviour is held by the hub's own tests: a chat message never actuates,
 * only the decide route does, and both are tampered. What no Go test can hold is
 * whether the person pressing the button was told what pressing it does.
 *
 * That matters more here than on any other screen in this console. Every other
 * confirm() guards a configuration change. This one spins a mower blade, and it
 * is reached by an operator whose phone just buzzed — the worst conditions under
 * which to be reading carefully. If the screen ever stops saying that approving
 * is what runs the command, the security property still holds and the person no
 * longer knows it does, which is how a deliberate second rail gets treated as a
 * dismissable dialog.
 *
 * # What this does NOT check
 *
 * That the words are good. It checks that specific claims are present and that
 * one specific mistake is absent. A screen can pass this and still read badly.
 */

const source = readFileSync(
  resolve(__dirname, '../../pages/app/HazardousCommands.tsx'),
  'utf-8',
);

/**
 * The file with its COMMENTS REMOVED.
 *
 * This is not tidiness. The first version of this test read the raw file, and a
 * tamper proved it worthless: every claim it looks for also appears in the
 * page's own header comment, so a screen whose header explained the design
 * beautifully while the UI said none of it would have passed every assertion
 * below. The guard would have been checking that the file documents itself.
 *
 * Comments are stripped first, so what is asserted is what a person can
 * actually read on the screen.
 */
const page = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

describe('this guard reads the screen, not its comments', () => {
  it('strips comments before asserting anything', () => {
    // The header comment is long and says most of what the assertions look for.
    // If stripping ever breaks, every test below starts passing for free.
    expect(source).toMatch(/second rail/);
    expect(page).not.toMatch(/second rail/);
    // And it must not have stripped the page itself.
    expect(page.length).toBeGreaterThan(2000);
    expect(page).toMatch(/export default function HazardousCommands/);
  });
});

describe('the hazardous-commands screen', () => {
  it('says that a chat message does not run the command', () => {
    // The whole point, stated where an operator sees it. Without this the page
    // reads as a queue of things that are already happening.
    expect(page).toMatch(/does not run when the message arrives/);
  });

  it('says that approving here is what runs it', () => {
    expect(page).toMatch(/approving it here is what makes it run/i);
  });

  it('explains why the approval is not in the chat', () => {
    // The reason is the design. An operator who does not know WHY approval is
    // separate will experience it as an obstacle and look for a way around it.
    expect(page).toMatch(/phone can ask and cannot approve|can ask and cannot approve/i);
  });

  it('names the device, the verb and the rail in the approval dialog', () => {
    // Three facts, because they are what distinguishes "yes, that was me" from
    // "I did not send that". A dialog saying only "are you sure?" cannot be
    // answered correctly by someone who did not send the message.
    const confirmCall = page.slice(page.indexOf('window.confirm('));
    expect(confirmCall).toMatch(/intent\.verb/);
    expect(confirmCall).toMatch(/intent\.device_key|\$\{who\}/);
    expect(confirmCall).toMatch(/intent\.source/);
  });

  it('renders the status the hub derived rather than deriving its own', () => {
    // The hub derives active/expired/exhausted/disarmed from the timestamps and
    // the counter, and says so in t4window.go. A console that recomputed it
    // would be a second answer to one question, and the two would drift the
    // first time a rule changed — showing a closed window as live, which is the
    // one lie this feature cannot afford.
    expect(page).toMatch(/\{w\.status\}/);
    expect(page).toMatch(/\{i\.status\}/);
    // The countdown helper exists and is allowed, but it must not be what
    // decides whether a window is live: that branch reads the hub's field.
    expect(page).toMatch(/w\.status === 'active'/);
  });

  it('keeps requests nobody approved visible', () => {
    // A member saying "I asked and nothing happened" needs a row that says so.
    // An empty list would make a refused request indistinguishable from a
    // message that never arrived.
    expect(page).toMatch(/Recent requests/);
    expect(page).toMatch(/status !== 'pending'/);
  });

  it('tells an operator that a window grants nothing on its own', () => {
    // A window makes a verb ELIGIBLE to be asked for. An operator who read it as
    // a permission would arm one and believe the command was now available,
    // which is both wrong and the more dangerous direction to be wrong in.
    expect(page).toMatch(/does not grant anything|grants nothing/i);
  });
});
