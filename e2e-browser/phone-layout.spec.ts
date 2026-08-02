import { allowExpectedConsoleError, expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

// Nothing a user needs may sit outside the phone viewport.
//
// # Why this cannot be seen the usual way
//
// main.css sets `html { overflow-x: clip }` as a deliberate guard, and explains
// itself: clip rather than hidden so it does not create a scroll container, to
// swallow "any stray decorative overflow (e.g. the fixed starfield) without
// cutting real content, which is laid out within the viewport".
//
// The last clause is a claim about every page, and clip is exactly what makes it
// unverifiable by ordinary means: the document cannot scroll sideways, so
// `scrollWidth > innerWidth` reports nothing, and a developer looking at a
// desktop browser sees nothing either. Content pushed past the right edge is
// simply gone — no scrollbar, no clue, and on the surface README calls "where a
// gate gets opened".
//
// So this measures per element instead: anything whose right edge lands beyond
// the viewport, that is not decoration and not inside something the user can
// scroll horizontally.
//
// # What is excluded, and why that is not a loophole
//
// Decoration: the starfield main.css names, identified by a fixed-position
// ancestor, and SVG internals, whose geometry is their own coordinate space.
// Both were the entire first result when this was written, which is what the CSS
// comment predicted.
//
// Scrollable containers: a wide table inside `overflow-x: auto` is reachable —
// that is what the container is for — so it is not clipped content.

let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('phone-layout');
});

test.afterAll(async () => {
  await gw.stop();
});

const PAGES = [
  'devices', 'automations', 'energy', 'open', 'access-points', 'members',
  'analytics', 'grants', 'emergency', 'access-rules', 'api-tokens', 'webhooks',
  'hazardous', 'settings', 'admin/audit',
];

test('no content is clipped outside the phone viewport', async ({ page, cleanPage }) => {
  void cleanPage;
  test.setTimeout(300_000);

  // Same allowance as rendered-values.spec.ts: this suite's hub has no device
  // drivers, so /automations answers 503 `automations_not_configured`, which is
  // deliberate and argued in automations.go. Matched by URL and status together,
  // and counted, so it cannot end up covering nothing.
  const allowed503: string[] = [];
  allowExpectedConsoleError(page, (text, locationUrl) => {
    const isEngine = locationUrl.includes('/automations') && text.includes('503');
    if (isEngine) allowed503.push(locationUrl);
    return isEngine;
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(gw.url('/signup'));
  await page.getByLabel('Your name', { exact: true }).fill('Phone Layout');
  await page.getByLabel('Username', { exact: true }).fill(`e2e-phone-${Date.now()}`);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByLabel('Location name').fill('Phone Layout House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();

  const offences: string[] = [];
  let visited = 0;

  for (const path of PAGES) {
    await page.goto(gw.url(`/app/${path}`));
    // Wait for the page's OWN fetches, not merely for a body to exist.
    //
    // The first version waited on `body` being visible plus 500ms, and a
    // deliberately 900px-wide list planted in the members page was NOT CAUGHT:
    // the measurement ran before the list rendered, so it measured a page that
    // was still empty. Every "clean" result it produced was worth nothing, and
    // nothing about the output said so — the sweep looked identical whether it
    // examined a rendered page or a blank one.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    visited++;

    const clipped = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const found: string[] = [];
      const hasAncestor = (el: Element | null, match: (s: CSSStyleDeclaration) => boolean) => {
        for (let n = el; n; n = n.parentElement) {
          if (match(getComputedStyle(n as Element))) return true;
        }
        return false;
      };
      document.querySelectorAll('body *').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (el.namespaceURI === 'http://www.w3.org/2000/svg') return;
        if (hasAncestor(el, (s) => s.position === 'fixed')) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        // One pixel of tolerance for sub-pixel rounding.
        if (r.right <= vw + 1) return;
        if (hasAncestor(el.parentElement, (s) => s.overflowX === 'auto' || s.overflowX === 'scroll')) {
          return;
        }
        const label = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
        found.push(`<${el.tagName.toLowerCase()}> right=${Math.round(r.right)} (viewport ${vw}) "${label}"`);
      });
      return found.slice(0, 5);
    });

    for (const c of clipped) offences.push(`/app/${path}: ${c}`);
  }

  expect(visited, 'the sweep visited no pages').toBe(PAGES.length);
  expect(
    allowed503.length,
    'the automations 503 never happened — drop the allowance rather than leaving ' +
      'it covering nothing',
  ).toBeGreaterThan(0);
  expect(
    offences.join('\n'),
    `content is laid out beyond the right edge of a phone screen. Because
main.css clips horizontal overflow rather than scrolling it, this is invisible:
there is no scrollbar and nothing to drag — the content is simply unreachable.`,
  ).toBe('');
});
