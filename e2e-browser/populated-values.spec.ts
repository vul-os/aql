import { expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

// The same rendered-value check, but against pages that have something in them.
//
// # Why this is separate from rendered-values.spec.ts
//
// That one drives a brand-new account, so every page is in its empty state. It
// says so, and the limit is real: the defects it cannot see are the ones that
// need a row to appear — a date that formats to "Invalid Date", a count that
// divides by another count, an expiry rendered from a field the hub sends as
// null once the record exists.
//
// The analytics NaN was an empty-state defect. There is no reason to think the
// populated ones are rarer; there is only a reason they are harder to reach.
//
// # What it can populate, honestly
//
// This suite's hub runs with no device drivers, and faking a fleet to reach the
// device pages would test a hub nobody ships. What needs no hardware is the
// access/credential surface: an access point, an API token with scopes, and a
// temporary grant. Those are created HERE through the console's own forms — the
// same path a person uses — so what the pages then render came from the hub.

let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('populated');
});

test.afterAll(async () => {
  await gw.stop();
});

const BAD: Array<{ marker: string; hits: (body: string) => boolean }> = [
  { marker: 'NaN', hits: (b) => /\bNaN\b/.test(b) },
  { marker: '[object Object]', hits: (b) => b.includes('[object Object]') },
  { marker: 'Invalid Date', hits: (b) => b.includes('Invalid Date') },
  { marker: 'undefined', hits: (b) => /\bundefined\b/.test(b) },
];

async function assertClean(page: import('@playwright/test').Page, where: string) {
  const body = await page.locator('body').innerText();
  for (const { marker, hits } of BAD) {
    if (!hits(body)) continue;
    const at = body.indexOf(marker);
    throw new Error(
      `${where} rendered ${marker}: …${body.slice(Math.max(0, at - 80), at + 60).replace(/\n/g, ' ')}…`,
    );
  }
}

test('pages with real records in them render every value', async ({ page, cleanPage }) => {
  void cleanPage;
  test.setTimeout(300_000);

  await page.goto(gw.url('/signup'));
  await page.getByLabel('Your name', { exact: true }).fill('Populated Values');
  await page.getByLabel('Username', { exact: true }).fill(`e2e-pop-${Date.now()}`);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByLabel('Location name').fill('Populated House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();

  // An access point, which most other records hang off. The prompt lives on the
  // overview for an account that has none — money-path drives the same one.
  await page.goto(gw.url('/app'));
  await page.getByRole('button', { name: 'Add access point →', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Front Gate');
  await page.getByRole('button', { name: 'Add access point', exact: true }).click();
  await expect(page.getByText('Front Gate').first()).toBeVisible();
  await page.goto(gw.url('/app/access-points'));
  await expect(page.getByText('Front Gate').first()).toBeVisible();
  await assertClean(page, '/app/access-points with one access point');

  // An API token: a record with a created-at, an optional expiry and scopes —
  // three different shapes of value to get wrong.
  await page.goto(gw.url('/app/api-tokens'));
  await page.getByRole('button', { name: 'New token', exact: true }).click();
  await page.getByPlaceholder('e.g. Home Assistant').fill('E2E Token');
  // A token with no scope is refused by the form — deliberately, since a
  // credential that grants nothing is a credential someone will widen later.
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Create token', exact: true }).click();

  // The secret is shown once, behind an acknowledgement — the modal's Done
  // button stays disabled until you say you have stored it. Worth reading while
  // it is up: it renders the secret, the scopes and an expiry, and it is the one
  // screen a user cannot return to.
  await expect(page.getByRole('heading', { name: 'Token created' })).toBeVisible();
  await assertClean(page, 'the one-time token secret modal');
  await page.getByRole('checkbox').last().check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // Re-loaded rather than read through the modal's afterglow: a fresh fetch
  // proves the hub stored it, and renders the row from the hub's own JSON,
  // which is what this file is checking.
  await page.goto(gw.url('/app/api-tokens'));
  await expect(page.getByRole('cell', { name: 'E2E Token' })).toBeVisible();
  await assertClean(page, '/app/api-tokens with one token');

  // The overview and settings both summarise what now exists, so they are worth
  // re-reading once there is something to summarise.
  for (const path of ['', 'settings', 'analytics', 'members']) {
    await page.goto(gw.url(`/app/${path}`));
    await expect(page.locator('body')).toBeVisible();
    await page.waitForTimeout(600);
    await assertClean(page, `/app/${path || '(overview)'} after records exist`);
  }

  // And again at phone width, which renders DIFFERENT MARKUP.
  //
  // This is not thoroughness for its own sake. The tokens page draws a table on
  // a wide viewport and a stack of cards on a narrow one, and the two format
  // their dates in separate places — a tamper aimed at the card version was NOT
  // CAUGHT by everything above, because nothing here had ever been narrow.
  // README puts it plainly: "On a phone — the console at phone width, which is
  // where a gate gets opened."
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['api-tokens', 'access-points', '', 'members', 'settings']) {
    await page.goto(gw.url(`/app/${path}`));
    await expect(page.locator('body')).toBeVisible();
    await page.waitForTimeout(600);
    await assertClean(page, `/app/${path || '(overview)'} at phone width`);
  }
});
