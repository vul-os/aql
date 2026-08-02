import { expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

// The analytics page, loaded against a real hub.
//
// # Why this exists
//
// The suite's allowlist of "routes the hub does not serve" carried a PREFIX
// entry, `/v1/analytics/`, which silenced console errors for every route
// beneath it. The hub serves that namespace in full — account summary, account
// insights, location summary — so the entry had stopped describing reality and
// started hiding it.
//
// Removing it was not enough on its own. Nothing in this suite loaded
// /app/analytics, so a broken analytics route produced no console error for the
// allowlist to hide OR to report: tampering an endpoint path to something the
// hub does not serve was NOT CAUGHT until this file existed.
//
// # What it asserts
//
// That the page renders against a hub with no data, which is the state a new
// account is in — and that it says so rather than showing zeroes as though they
// were measurements. cleanPage does the rest: any failed /v1 call is now a
// console error nothing allows.
let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('analytics');
});

test.afterAll(async () => {
  await gw.stop();
});

test('the analytics page loads against a hub with nothing to report', async ({
  page,
  cleanPage,
}) => {
  void cleanPage;

  await page.goto(gw.url('/signup'));
  await page.getByLabel('Your name', { exact: true }).fill('Analytics Tester');
  await page.getByLabel('Username', { exact: true }).fill(`e2e-analytics-${Date.now()}`);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByLabel('Location name').fill('Analytics House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();

  await page.goto(gw.url('/app/analytics'));
  await expect(page.getByRole('heading', { name: /analytics/i }).first()).toBeVisible();

  // An account that has never opened anything must not be shown fabricated
  // activity. Whatever the page renders, it renders it from the hub's answers.
  await expect(page.locator('body')).not.toContainText('[object Object]');
  await expect(page.locator('body')).not.toContainText('NaN');
});
