import { allowExpectedConsoleError, expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

// No console page may show a computed value that failed to compute.
//
// # Why a sweep rather than a per-page assertion
//
// The analytics page rendered "Opens · 7d — 0 — NaN% week-over-week" to every
// account without a week of history, because a field the hub deliberately sends
// as null was typed as a number. Nothing caught it: the page loads, logs no
// console error, and looks entirely normal apart from the word NaN in the middle
// of a sentence. The check that would have caught it is not about that page — it
// is about the whole class, so it is applied to every page at once.
//
// # What "clean" is worth here
//
// This drives a brand-new account, so what it covers is EMPTY states — which is
// exactly where these defects live, because zero and null are the inputs nobody
// exercised by hand. It does not cover a populated fleet; seeding one for twenty
// pages would need devices, clips, energy samples and grants, and the suite's
// rule is to drive the real product rather than fake a fleet.
//
// A sweep reporting all-clean is indistinguishable from a broken sweep, so the
// first version of this was tampered against the original NaN and had to see it.

let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('rendered-values');
});

test.afterAll(async () => {
  await gw.stop();
});

const PAGES = [
  'devices', 'automations', 'footage', 'energy', 'open', 'access-points',
  'members', 'analytics', 'grants', 'emergency', 'access-rules', 'api-tokens',
  'webhooks', 'hazardous', 'settings', 'admin/accounts', 'admin/users',
  'admin/limits', 'admin/audit', 'admin/gateway-key',
];

// Markers of a value that reached the DOM without being a value.
//
// "undefined" and "null" are included as whole words only: a sentence may
// legitimately say a setting is undefined, but a rendered `${x}` never should.
const BAD: Array<{ marker: string; test: (body: string) => boolean }> = [
  { marker: 'NaN', test: (b) => /\bNaN\b/.test(b) },
  { marker: '[object Object]', test: (b) => b.includes('[object Object]') },
  { marker: 'Invalid Date', test: (b) => b.includes('Invalid Date') },
  { marker: 'undefined', test: (b) => /\bundefined\b/.test(b) },
];

test('no console page renders a value that failed to compute', async ({ page, cleanPage }) => {
  void cleanPage;
  test.setTimeout(300_000);

  // This suite's hub runs with no device drivers, so it has no automations
  // engine, and /v1/accounts/{id}/automations answers 503
  // `automations_not_configured`. That status is deliberate — automations.go
  // chose it over 404 because "'not found' sends a caller hunting for a typo in
  // their URL, 'unavailable' sends them to their configuration" — and
  // safety-copy.spec already proves the page says there is no rule engine
  // rather than showing an empty list.
  //
  // Chromium logs the 503 as a console error regardless. Allowed by URL AND
  // status so any other failing request still fails this test, and counted, so
  // the allowance cannot quietly cover nothing.
  // The URL comes from location(), not the message text — Chromium's "Failed to
  // load resource" line does not contain it, which the fixture documents and I
  // still got wrong on the first attempt.
  const allowed503: string[] = [];
  allowExpectedConsoleError(page, (text, locationUrl) => {
    const isEngine = locationUrl.includes('/automations') && text.includes('503');
    if (isEngine) allowed503.push(locationUrl);
    return isEngine;
  });

  await page.goto(gw.url('/signup'));
  await page.getByLabel('Your name', { exact: true }).fill('Rendered Values');
  await page.getByLabel('Username', { exact: true }).fill(`e2e-render-${Date.now()}`);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByLabel('Location name').fill('Rendered Values House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();

  const offences: string[] = [];
  let visited = 0;

  // Both widths, because a breakpoint can swap the markup entirely rather than
  // reflow it. Eleven components in this console do exactly that — the tokens
  // page draws a table on a wide viewport and a stack of cards on a narrow one,
  // formatting its dates in two separate places — and an injected bad date in
  // the card version was not caught by a desktop-only pass. The console at phone
  // width is not a courtesy here; README calls it "where a gate gets opened".
  const WIDTHS = [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ];

  for (const viewport of WIDTHS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const path of PAGES) {
      await page.goto(gw.url(`/app/${path}`));
      // Long enough for the page's own fetches to resolve and render; a page
      // asserted mid-load would pass by being empty.
      // Network idle, not a fixed pause after `body` exists.
      //
      // body is present the instant the document parses, so waiting on it and
      // sleeping measures whatever has rendered by then. phone-layout.spec.ts
      // was written that way and a planted 900px element went unseen — its
      // "clean" verdicts were partly about pages that had not drawn yet, and
      // nothing in the output distinguished the two.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      visited++;

      const body = await page.locator('body').innerText();
      for (const { marker, test: hits } of BAD) {
        if (!hits(body)) continue;
        const at = body.indexOf(marker);
        offences.push(
          `/app/${path} (${viewport.name}): ${marker} — …${body
            .slice(Math.max(0, at - 70), at + 50)
            .replace(/\n/g, ' ')}…`,
        );
      }
    }
  }

  // The guard on the guard: a loop that silently visited nothing would report
  // clean forever.
  expect(visited, 'the sweep visited no pages').toBe(PAGES.length * WIDTHS.length);
  expect(
    allowed503.length,
    'the automations 503 never happened — if the engine is configured in this ' +
      'suite now, drop the allowance rather than leaving it covering nothing',
  ).toBeGreaterThan(0);
  expect(
    offences.join('\n'),
    `a page rendered a value that failed to compute. This is what "NaN% week-over-week"
looked like: the page loads, logs no console error, and reads normally except for a
word in the middle of a sentence that no user should ever see.`,
  ).toBe('');
});
