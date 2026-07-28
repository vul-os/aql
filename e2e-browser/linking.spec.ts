// The link ceremonies, driven through the real forms against a real hub.
//
// Until this shipped, no member could ever be recognised on a chat rail: every
// rail filters on a verified identity and nothing in production could write
// one, so WhatsApp, Telegram, Slack and Discord refused every open on every
// real deployment while looking entirely finished.
//
// The Go tests cover the rail half over the actual webhook — a signed inbound
// message spending a code, an attacker's code being refused, ordinary chatter
// not burning attempts. Source-level tests cover the console COPY. Neither can
// answer the question that keeps being the real defect here: is the form wired
// to the route at all?
//
// So this drives the buttons, watches the real responses, and RELOADS — a
// linked number that lives only in React state is not a linked number.

import { expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('linking');
});

test.afterAll(async () => {
  await gw.stop();
});

async function signUp(page: import('@playwright/test').Page, username: string): Promise<void> {
  await page.goto(gw.url('/signup'));
  await page.getByLabel('Hub URL', { exact: true }).fill(gw.baseUrl);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Linking Tester');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByLabel('Location name').fill('Linking House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();
  await expect(page).toHaveURL(`${gw.baseUrl}/app`);
}

test('minting a phone link code hits the real route and shows the hub’s own instruction', async ({
  page,
}) => {
  await signUp(page, `e2e-link-${Date.now()}`);
  await page.goto(gw.url('/app/settings'));

  const phone = '+27820001234';
  await page.getByLabel('Link a number', { exact: true }).fill(phone);

  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/v1/phones/me/link') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Get a link code', exact: true }).first().click(),
  ]);
  expect(res.status(), 'the mint route must answer 201 against a real hub').toBe(201);
  const body = await res.json();

  // The code the hub minted, on screen — not a placeholder, and not a code the
  // client invented.
  await expect(page.getByText(body.code, { exact: true })).toBeVisible();

  // The instruction is the hub's string. If the console composed its own, the
  // wording could drift from what the rail actually recognises, and nobody
  // would find out until a member's message was ignored.
  await expect(page.getByText(body.instruction)).toBeVisible();

  // Nothing is linked until the code is spent. A pending link that rendered as
  // a linked number would be the "success message followed by no capability"
  // that docs/PHONE-LINKING.md was written to prevent.
  const listed = await page.evaluate(async () => {
    const token = localStorage.getItem('aql.access_token');
    const base = localStorage.getItem('aql.gateway_url');
    const r = await fetch(`${base}/v1/phones/me/phones`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: r.status, body: await r.json() };
  });
  expect(listed.status).toBe(200);
  expect(listed.body.phones, 'minting a code must not create a phone row').toEqual([]);
});

test('a channel link code is longer than a phone code, and says not to share it', async ({
  page,
}) => {
  await signUp(page, `e2e-chan-${Date.now()}`);
  await page.goto(gw.url('/app/settings'));

  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/v1/channels/me/link') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Get a link code', exact: true }).last().click(),
  ]);
  expect(res.status()).toBe(201);
  const body = await res.json();

  await expect(page.getByText(body.code, { exact: true })).toBeVisible();

  // The asymmetry, checked on the wire rather than in the source: a phone code
  // is bound to the number that may spend it and can be short; a channel code
  // names no target, so whoever sends it gets bound, and the length is the only
  // thing standing between a stranger and this profile's gate access.
  const bare = body.code.replace(/^LINK-/, '').replace(/-/g, '');
  expect(bare.length, 'a channel code must not be shortened to phone length').toBeGreaterThan(6);

  // And the warning has to be on screen, not only in the API payload.
  await expect(page.getByText(/keep this code to yourself/i)).toBeVisible();
});

test('a pending code never masquerades as a linked number, across a reload', async ({ page }) => {
  await signUp(page, `e2e-pending-${Date.now()}`);
  await page.goto(gw.url('/app/settings'));

  await page.getByLabel('Link a number', { exact: true }).fill('+27820009999');
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/v1/phones/me/link') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Get a link code', exact: true }).first().click(),
  ]);
  expect(res.status()).toBe(201);

  // The state that matters: a code is outstanding and NOTHING is linked. A
  // console that showed the pending number in the list would be the "success
  // message followed by no capability" docs/PHONE-LINKING.md exists to prevent
  // — the member would believe they were done and their messages would still
  // be ignored.
  await expect(page.getByText('No numbers linked yet.')).toBeVisible();

  // And it must still be true after a reload, because the list is served by
  // the hub: anything that survived only in component state would disappear
  // here, and anything invented by the client would not.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Phone numbers' })).toBeVisible();
  await expect(page.getByText('No numbers linked yet.')).toBeVisible();
});
