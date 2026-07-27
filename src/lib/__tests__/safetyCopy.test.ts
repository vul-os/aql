import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The sentences that must not drift.
 *
 * Several screens in this console carry copy that is not decoration — it is the
 * only thing standing between a user and a wrong belief about what the product
 * guarantees. A geofence that reads as a lock. A relay mock that reads as a
 * relay. An indeterminate result that reads as a failure, sending someone to
 * press a gate button a second time.
 *
 * None of it is covered by a type, and none by a test. This repo has no
 * component tests at all and deliberately runs `environment: 'node'` — so
 * rather than add React Testing Library to assert on rendered text, these are
 * SOURCE-LEVEL invariants, the same technique naming.test.ts and the parity
 * alarms already use here.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT:
 *   - It proves a required sentence is still present in the source, and a
 *     forbidden one is still absent.
 *   - It does NOT prove the sentence is rendered, reachable, or visible. A
 *     screen could keep the text and hide it behind a collapsed panel.
 * It is a drift alarm for wording that was argued over, not a UI test. The
 * failure it prevents is the one this session hit repeatedly: copy that quietly
 * stopped being true and nothing noticed.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function read(rel: string): string {
  return readFileSync(path.join(repo, rel), 'utf-8');
}

/** Collapse whitespace so a reflowed line still matches. */
function flat(s: string): string {
  return s.replace(/\s+/g, ' ');
}

describe('a geofence is never presented as a security control', () => {
  // hub/internal/httpapi/geofence.go, at length: the position a fence is tested
  // against comes from the CLIENT and nothing verifies it. Anyone who can call
  // the API can claim any coordinates. It is a mistake-preventer; it stops
  // nobody who is trying.
  const src = flat(read('src/pages/app/AccessRules.tsx'));

  it('says outright that the position is unverified', () => {
    const admits =
      /nothing here verifies|nothing verifies that claim|no second source|position the requesting device claims/i.test(
        src,
      );
    expect(
      admits,
      'AccessRules.tsx no longer states that a geofence is checked against a position ' +
        'the client supplies and nothing verifies. That sentence is the entire reason ' +
        'the feature is safe to ship — without it the page reads as a lock.',
    ).toBe(true);
  });

  it('never calls a fence a lock, or secure, or enforced', () => {
    // The words that would turn a convenience into a promise. Checked near the
    // word "geofence" only, so unrelated copy elsewhere on the page is free.
    for (const claim of [
      /geofence[^.]{0,120}\b(secures?|protects?|prevents? (?:anyone|someone))/i,
      /\bsecure\b[^.]{0,60}geofence/i,
    ]) {
      expect(
        claim.test(src),
        `AccessRules.tsx describes a geofence with a word that implies verification ` +
          `(${claim}). The client supplies the position; the hub cannot check it.`,
      ).toBe(false);
    }
  });
});

describe('emergency access refuses rather than reassures', () => {
  const src = flat(read('src/pages/app/EmergencyAccess.tsx'));

  // A changed hub key means the thing answering is not the hub this device
  // enrolled with. There are innocent explanations and one that is not, and the
  // app cannot tell them apart — so it must not offer to proceed.
  it('offers no way to continue past a changed hub key', () => {
    // The affordance, not the phrase: a button or handler that proceeds anyway.
    const hasOverride =
      /continue anyway['"]?\s*[}>]|onClick=\{[^}]*proceedAnyway|ignoreKeyChange|acceptNewKey/i.test(
        src,
      );
    expect(
      hasOverride,
      'EmergencyAccess.tsx has gained a way to proceed past a changed hub key. ' +
        'The app cannot distinguish a rebuilt hub from something else answering at ' +
        'that address, so proceeding is a decision it has no basis to offer.',
    ).toBe(false);
  });

  // The middle outcome. A reply lost after the proof was sent is
  // indistinguishable from success, and someone told it FAILED presses again.
  it("says couldn't confirm, never failed, for an unconfirmed present", () => {
    expect(
      /couldn't confirm|could not confirm/i.test(src),
      'EmergencyAccess.tsx no longer distinguishes an unconfirmed result. A lost ' +
        'reply is not a failure — the gate may well have opened.',
    ).toBe(true);
  });

  // Requesting a grant needs the network. That is the whole point and the whole
  // trap, so the page must lead with it.
  it('tells the user to set it up before they need it', () => {
    expect(
      /before you need it|cannot be requested during an outage|already be on this device/i.test(src),
      'EmergencyAccess.tsx no longer leads with the fact that a grant cannot be ' +
        'obtained during an outage. That is the one thing a user must act on early.',
    ).toBe(true);
  });
});

describe('the rule editor does not re-implement the safety ceiling', () => {
  const src = read('src/components/automations/RuleEditor.tsx');

  // MaxActionTier is a compile-time constant checked twice in the engine. A
  // form that predicted it would be a second copy — and the copy a user sees is
  // the one that would drift.
  it('never filters or disables a verb by tier', () => {
    const predicts =
      /(?:filter|disable|hide|exclude)[A-Za-z]*\([^)]*tier|tier\s*(?:>=?|<=?)\s*|aboveCeiling|isAllowedTier/i.test(
        src,
      );
    expect(
      predicts,
      'RuleEditor.tsx has started judging verbs by tier. The ceiling is enforced ' +
        'in the engine, twice; a second copy here can drift from it, and the copy ' +
        'the user sees is the wrong one to be wrong.',
    ).toBe(false);
  });

  // The engine's vocabulary, passed through. The scheduler logs the same names.
  it('explains refusals using the engine’s own reason codes', () => {
    const engine = read('hub/internal/automations/automations.go');
    const reasons = [...engine.matchAll(/Reason[A-Za-z]+\s*=\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(5);

    // Scope the extraction to the refusal map. A bare "every two-space-indented
    // key" scan also picks up the component's own props (`rule:`, `devices:`)
    // and reports them as invented reason codes — a false positive, and the
    // wrong one to answer with an exclusion list, since that would train the
    // next person to exempt a real finding.
    const mapStart = src.indexOf('REFUSAL_CONTEXT');
    expect(mapStart, 'RuleEditor.tsx no longer has a refusal-context map').toBeGreaterThan(0);
    const mapBody = src.slice(mapStart, src.indexOf('\n};', mapStart));
    const explained = [...mapBody.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
    expect(explained.length, 'no refusal codes were extracted').toBeGreaterThan(2);

    const invented = explained.filter((k) => !reasons.includes(k));
    expect(
      invented,
      `RuleEditor.tsx explains refusal codes the engine does not emit: ${invented.join(', ')}. ` +
        `A parallel vocabulary means the console explains a refusal it does not understand.`,
    ).toEqual([]);

    expect(
      explained.includes('tier_too_high'),
      'tier_too_high is the refusal a person writing a rule is most likely to hit ' +
        'and most likely to misread. It must carry an explanation.',
    ).toBe(true);
  });
});

describe('a webhook target names the guard it switches off', () => {
  const src = flat(read('src/pages/app/Webhooks.tsx'));

  // allow_private disables the SSRF guard for that endpoint. It is legitimate —
  // someone pointing at their own Home Assistant — but "allow private
  // addresses" tells a user nothing about what they are agreeing to.
  it('spells out what allow_private disables', () => {
    const explains =
      /169\.254\.169\.254|metadata|loopback|link-local|carrier-grade|192\.168/i.test(src);
    expect(
      explains,
      'Webhooks.tsx no longer says WHICH protection allow_private removes. Without ' +
        'the specifics it reads as a formatting option rather than a decision to let ' +
        'the hub reach its own network.',
    ).toBe(true);
  });
});

describe('a secret shown once says so', () => {
  // Three surfaces return a secret exactly once, with no read path that can
  // ever return it again. A user who dismisses the dialog has lost it.
  for (const [file, what] of [
    ['src/pages/app/ApiTokens.tsx', 'the API token'],
    ['src/pages/app/Webhooks.tsx', 'the webhook signing secret'],
    ['src/components/settings/TwoFactorSection.tsx', 'the 2FA secret and recovery codes'],
  ] as const) {
    it(`${file} warns that ${what} cannot be retrieved`, () => {
      const src = flat(read(file));
      const warns =
        /shown once|only time|never be shown again|cannot be retrieved|can't be retrieved|no way to see them again/i.test(
          src,
        );
      expect(
        warns,
        `${file} no longer warns that ${what} is shown once. There is no read path ` +
          `on the hub that can return it, so a user who dismisses this has silently ` +
          `lost it and must delete and recreate.`,
      ).toBe(true);
    });
  }
});

describe('discovery does not present found devices as trusted', () => {
  const src = flat(read('src/pages/app/Devices.tsx'));

  // mDNS is unauthenticated by construction. Anything on the LAN can answer.
  it('says a discovered controller is not to be trusted', () => {
    expect(
      /no authentication|anything on this network can answer|addresses to check, not devices to trust|unverified/i.test(
        src,
      ),
      'Devices.tsx no longer says that anything on the LAN can answer a discovery ' +
        'browse. A list of found devices is exactly where someone reaches for a ' +
        'one-click add.',
    ).toBe(true);
  });
});

describe('the guard cannot pass on a file that vanished', () => {
  // Every path above is read at module scope inside its describe. If one were
  // renamed, readFileSync throws and the suite fails loudly — but a future
  // refactor could wrap these in a try/catch and turn a missing screen into a
  // silent pass. Assert the files exist, separately and on purpose.
  it('every screen this file guards is still present', () => {
    for (const f of [
      'src/pages/app/AccessRules.tsx',
      'src/pages/app/EmergencyAccess.tsx',
      'src/pages/app/ApiTokens.tsx',
      'src/pages/app/Webhooks.tsx',
      'src/pages/app/Devices.tsx',
      'src/components/automations/RuleEditor.tsx',
      'src/components/settings/TwoFactorSection.tsx',
    ]) {
      expect(read(f).length, `${f} is empty or missing`).toBeGreaterThan(500);
    }
  });
});
