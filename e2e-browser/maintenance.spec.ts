// The maintenance log, driven through the real form against a real hub.
//
// The access-point screens have shipped a "Log service" button and a service
// history panel since long before the routes existed: GET rendered an error and
// POST failed for every user, every time. routeParity recorded that as an
// acknowledged gap rather than the bug it was.
//
// hub/internal/httpapi/maintenance.go serves them now, with Go tests covering
// validation, the admin-only write, tenant scoping and the due-date
// derivation. What those cannot reach is whether the FORM is wired to the
// route — which is this repo's most-repeated failure: a component complete,
// tested, and reached by nothing.
//
// So this drives the actual button, watches the actual response, and then
// RELOADS. A service that lives only in React state is not a service history.

import { expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('maintenance');
});

test.afterAll(async () => {
  await gw.stop();
});

async function signUpWithGate(
  page: import('@playwright/test').Page,
  username: string,
  gateName: string,
): Promise<void> {
  await page.goto(gw.url('/signup'));
  await page.getByLabel('Hub URL', { exact: true }).fill(gw.baseUrl);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Maintenance Tester');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByLabel('Location name').fill('Maintenance House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();
  await expect(page).toHaveURL(`${gw.baseUrl}/app`);

  // The access point is created through the API rather than the form on
  // purpose: money-path.spec.ts already drives that form, and re-driving it
  // here would make this test fail for reasons that have nothing to do with
  // maintenance.
  const created = await page.evaluate(async (name) => {
    const token = localStorage.getItem('aql.access_token');
    const base = localStorage.getItem('aql.gateway_url');
    const me = await (
      await fetch(`${base}/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    const locId = (
      await (
        await fetch(`${base}/v1/accounts/${me.accounts[0].id}/locations`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()
    ).locations[0].id;
    const res = await fetch(`${base}/v1/access-points`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: locId, name, kind: 'gate' }),
    });
    return { status: res.status, body: await res.text() };
  }, gateName);
  expect(created.status, `could not create an access point: ${created.body}`).toBe(201);
}

test('a logged service is really stored, and the access point says when the next one is due', async ({
  page,
}) => {
  const gate = `Service Gate ${Date.now()}`;
  await signUpWithGate(page, `e2e-maint-${Date.now()}`, gate);

  await page.goto(gw.url('/app/access-points'));
  const card = page.locator('article, div').filter({ hasText: gate }).last();

  // Before anything is logged the card says there is no schedule — which is a
  // different statement from "on track", and the one an operator needs.
  await expect(card.getByText(/no schedule/i)).toBeVisible();

  await card.getByRole('button', { name: /Log service/i }).click();

  // The dialog's own fields. Only the interval is filled: everything else is
  // optional and the hub must accept the minimum a real user would type.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Log maintenance/i)).toBeVisible();
  await dialog.getByLabel(/Next service after \(days\)/i).fill('90');

  const logged = page.waitForResponse(
    (r) =>
      /\/v1\/access-points\/[^/]+\/maintenance$/.test(r.url()) && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: /^Log|^Save/i }).last().click();
  expect((await logged).status(), 'the hub refused to log the service').toBe(201);

  // Reload: this is the assertion that separates "saved" from "rendered", and
  // it also proves the access-point listing derives its summary from the log
  // rather than from the hardcoded "nothing recorded" block it used to carry.
  await page.reload();
  const reloaded = page.locator('article, div').filter({ hasText: gate }).last();
  await expect(reloaded.getByText(/next service/i)).toBeVisible();
  await expect(reloaded.getByText(/no schedule/i)).toHaveCount(0);
});
