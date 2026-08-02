import { expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

// The hazardous-commands console, loaded by a browser.
//
// # Why this exists
//
// This page is where a T4 command asked for over chat is approved or refused —
// the only place one actuates. Nothing loaded it. It had six type errors,
// including two that render a `Date` object straight into JSX, which React
// throws on: any real intent would have crashed the page. They were invisible
// because scripts/check.sh ran a `tsc --noEmit` against a solution tsconfig,
// which type-checks nothing, and because no test in this suite visited the
// route.
//
// The type errors are fixed and the gate now runs `tsc -b`. What types cannot
// tell you is whether the page renders at all — whether its imports resolve, its
// hooks run, and its two API calls answer for a signed-in admin. That is what
// this covers, and it is the part no gate here had.
//
// # What it deliberately does not do
//
// It does not seed an intent or a window. Both need a device in the registry
// with a hazardous verb, and this suite's hub runs with no device config on
// purpose — "no mocks: every test drives the real product" is the fixture's own
// rule. Faking a fleet to reach a row would test a hub nobody ships. The empty
// state is what an operator sees on a hub with nothing pending, which is most
// hubs most of the time, and it is reachable honestly.
//
// The cleanPage fixture is the sharp end: it fails the test on any console
// error, so a render crash, a failed API call or an unhandled rejection is a
// failure rather than a page that quietly shows less than it should.

let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('hazardous');
});

test.afterAll(async () => {
  await gw.stop();
});

async function signUpAsAdmin(
  page: import('@playwright/test').Page,
  username: string,
): Promise<void> {
  await page.goto(gw.url('/signup'));
  await page.getByLabel('Hub URL', { exact: true }).fill(gw.baseUrl);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Hazardous Tester');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByLabel('Location name').fill('Hazardous House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();
  await expect(page).toHaveURL(`${gw.baseUrl}/app`);
}

test('the hazardous-commands page renders for an admin', async ({ page, cleanPage }) => {
  void cleanPage;
  await signUpAsAdmin(page, `e2e-haz-${Date.now()}`);
  await page.goto(gw.url('/app/hazardous'));

  await expect(page.getByRole('heading', { name: 'Hazardous commands' })).toBeVisible();

  // The empty state, which is the honest one on a hub with no pending request.
  await expect(page.getByText(/Nothing is waiting/i)).toBeVisible();

  // A Date rendered into JSX shows up as this. React usually throws first and
  // cleanPage catches that, but a component that stringifies instead would slip
  // through silently, so the rendered text is checked too.
  await expect(page.locator('body')).not.toContainText('[object Object]');
  await expect(page.locator('body')).not.toContainText('Invalid Date');
});

// The nav entry must reach it. A page nobody can navigate to is the same defect
// this repository keeps finding in Go: complete code with no line that reaches
// it.
test('the page is reachable from the navigation, not just by URL', async ({ page, cleanPage }) => {
  void cleanPage;
  await signUpAsAdmin(page, `e2e-haz-nav-${Date.now()}`);

  await page.getByRole('link', { name: 'Hazardous commands' }).click();
  await expect(page).toHaveURL(`${gw.baseUrl}/app/hazardous`);
  await expect(page.getByRole('heading', { name: 'Hazardous commands' })).toBeVisible();
});
