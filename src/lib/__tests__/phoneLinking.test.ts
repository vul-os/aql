import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The console side of docs/PHONE-LINKING.md.
 *
 * routeParity, requestShape and responseShape already prove the three phone
 * routes are wired correctly at the wire level. None of them can see whether
 * the SCREEN built on top says the right things — that the ceremony's own
 * wording is rendered rather than re-composed, that an unverified number
 * reads as different from a verified one (the whole reason this screen
 * exists: an unverified number is why a member's chat messages get ignored),
 * and that a number verified elsewhere is never presented as something the
 * user can fix themselves.
 *
 * Same technique as safetyCopy.test.ts: source-level string checks, because
 * this repo has no component tests and runs `environment: 'node'`. This
 * proves the copy is still IN THE SOURCE, not that it renders or is reachable.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function read(rel: string): string {
  return readFileSync(path.join(repo, rel), 'utf-8');
}

function flat(s: string): string {
  return s.replace(/\s+/g, ' ');
}

function settingsSrc(): string {
  return read('src/pages/app/Settings.tsx');
}

describe('Settings.tsx calls the real ceremony, not a rebuilt one', () => {
  const src = settingsSrc();

  it('calls all three phone routes', () => {
    expect(src.includes('api.phonesList()')).toBe(true);
    expect(src.includes('api.phoneLinkStart(')).toBe(true);
    expect(src.includes('api.phoneUnlink(')).toBe(true);
  });

  it('renders the server-supplied instruction rather than a client-composed one', () => {
    // Must render the field the hub sends...
    expect(/linkCode\.instruction/.test(src)).toBe(true);
    // ...and must not restate the ceremony's own sentence as a literal string
    // here — that duplication is exactly how a client-side paraphrase drifts
    // from the wording the chat rail actually recognises.
    expect(
      /send (this|the) code/i.test(flat(src)),
      'Settings.tsx appears to compose its own "send this code" sentence instead of ' +
        'rendering the hub-supplied instruction field verbatim.',
    ).toBe(false);
  });
});

describe('an unverified number is visibly distinguished from a verified one', () => {
  const src = flat(settingsSrc());

  it('renders both a verified and an unverified label', () => {
    expect(/Verified/.test(src)).toBe(true);
    expect(/Not verified/.test(src)).toBe(true);
  });

  it('says why an unverified number matters, not just that it exists', () => {
    expect(
      /ignored/i.test(src),
      'Settings.tsx no longer explains that messages from an unverified number are ' +
        'ignored on the chat rails — that is the entire reason this screen exists.',
    ).toBe(true);
  });
});

describe('a number verified elsewhere is never presented as user-resolvable', () => {
  const src = flat(settingsSrc());

  it('handles phone_verified_elsewhere by naming an administrator', () => {
    expect(src.includes('phone_verified_elsewhere')).toBe(true);
    expect(
      /administrator/i.test(src),
      'Settings.tsx no longer says an administrator is required to move a number ' +
        'verified on another account — without that, the message reads as something ' +
        'the user could retry their way past.',
    ).toBe(true);
  });
});

describe('no SMS, no email — this product sends neither', () => {
  it('Settings.tsx never suggests either channel for phone linking', () => {
    const src = settingsSrc();
    expect(/\bSMS\b/i.test(src)).toBe(false);
    expect(/\bemail\b/i.test(src)).toBe(false);
  });

  it('api.ts documents the three phone routes without suggesting SMS or email either', () => {
    const src = read('src/lib/api.ts');
    const start = src.indexOf('Phone linking (hub/internal/httpapi/phones.go');
    expect(start, 'the phone-linking doc block in api.ts has moved or been removed').toBeGreaterThan(-1);
    const end = src.indexOf('phoneUnlink:', start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(/\bSMS\b/i.test(block)).toBe(false);
    expect(/\bemail\b/i.test(block)).toBe(false);
  });
});

describe('the guard cannot pass on a file that vanished', () => {
  it('Settings.tsx is still present and substantial', () => {
    expect(settingsSrc().length).toBeGreaterThan(500);
  });
});

/**
 * The channel half (Telegram/Slack/Discord), whose security shape is NOT the
 * same as the phone half and whose copy therefore must not be the same either.
 *
 * A phone code names the number allowed to spend it. A channel code names
 * nothing — whoever sends it to the bot gets bound — so anyone who reads it off
 * a screen before the member uses it can attach their own account to this
 * profile and inherit its gate access. The screen has to say so, and it has to
 * say so ONLY here: applying the same alarm to the phone panel would be crying
 * wolf, and a warning that appears everywhere stops being read anywhere.
 */
describe('the chat-account section reflects the weaker binding', () => {
  const src = settingsSrc();

  it('calls all three channel routes', () => {
    for (const fn of ['channelLinkStart', 'channelIdentitiesList', 'channelIdentityUnlink']) {
      expect(src, `Settings.tsx never calls api.${fn}`).toContain(`api.${fn}(`);
    }
  });

  it('renders the server-supplied instruction rather than a client-composed one', () => {
    expect(src).toContain('{linkCode.instruction}');
  });

  it('warns that a channel code hands over gate access to whoever sends it', () => {
    const flatSrc = flat(src);
    expect(flatSrc.toLowerCase()).toContain('keep this code to yourself');
    // The REASON, not just the instruction. "Don't share it" without "because
    // anyone who does gets your gate access" is advice a person talks
    // themselves out of.
    expect(flatSrc).toMatch(/whoever sends it[^.]*gets linked/i);
    expect(flatSrc.toLowerCase()).toContain('gate access');
  });

  it('does not apply that alarm to the phone code panel', () => {
    // Both panels exist in this file, so the check is that the warning sits in
    // the channel one: it is defined below the phone panel and above
    // toApiMessage. If someone lifts it into a shared component used by both,
    // this fails and the asymmetry gets re-argued rather than lost.
    const phonePanel = src.slice(
      src.indexOf('function LinkCodePanel('),
      src.indexOf('// Telegram/Slack/Discord accounts'),
    );
    expect(phonePanel.length).toBeGreaterThan(200);
    expect(phonePanel.toLowerCase()).not.toContain('keep this code to yourself');
  });

  it('does not offer WhatsApp as a linkable chat account', () => {
    const list = src.slice(
      src.indexOf('const LINKABLE_CHANNELS'),
      src.indexOf('function channelLabel'),
    );
    expect(list.length).toBeGreaterThan(50);
    expect(list.toLowerCase()).not.toContain('whatsapp');
    for (const c of ['telegram', 'slack', 'discord']) {
      expect(list).toContain(`'${c}'`);
    }
  });

  it('handles unsupported_channel without implying the user can retry it', () => {
    expect(src).toContain('unsupported_channel');
    const flatSrc = flat(src);
    expect(flatSrc.toLowerCase()).toContain('whatsapp uses your verified phone number');
  });
});
