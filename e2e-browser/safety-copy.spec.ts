// The screens whose COPY is the safety control, rendered against a real hub.
//
// src/lib/__tests__/safetyCopy.test.ts pins these sentences at source level and
// says plainly what it cannot do: "It does NOT prove the sentence is rendered,
// reachable, or visible. A screen could keep the text and hide it behind a
// collapsed panel."
//
// This closes exactly that gap for the two screens where the wording is not
// decoration but the whole basis on which the feature is safe to ship. A
// geofence that reads as a lock, or an emergency-access page that lets someone
// believe a grant can be fetched during an outage, are wrong in a way no type
// and no unit test can catch.
//
// Everything below asserts VISIBILITY against a real hub binary and a real
// browser: reachable by navigation, on screen, not behind a disclosure.

import { allowExpectedConsoleError, expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('safety-copy');
});

test.afterAll(async () => {
  await gw.stop();
});

async function connectAndSignUp(
  page: import('@playwright/test').Page,
  username: string,
): Promise<void> {
  await page.goto(gw.url('/signup'));
  await page.getByLabel('Hub URL', { exact: true }).fill(gw.baseUrl);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Safety Copy Tester');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByLabel('Location name').fill('Safety Copy House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();
  await expect(page).toHaveURL(`${gw.baseUrl}/app`);
}

// A grant cannot be obtained during an outage — it has to already be on the
// device. That is the single fact a user must act on EARLY, and a page that
// buries it has failed at the only job it has before an emergency.
test('emergency access leads with "set this up before you need it"', async ({ page }) => {
  await connectAndSignUp(page, `e2e-safety-${Date.now()}`);
  await page.goto(gw.url('/app/emergency'));

  // The page's own heading, not a tooltip and not a footnote.
  await expect(
    page.getByRole('heading', { name: /before you need it/i }),
  ).toBeVisible();

  // And the reason, in prose the user actually sees.
  await expect(
    page.getByText(/cannot be requested during an outage/i).first(),
  ).toBeVisible();
});

// Presenting a grant talks straight to the controller on the LAN, which a
// browser tab cannot do. Telling someone that AT the gate is too late, so the
// page must say it while they are still setting up.
test('emergency access admits a browser cannot present a grant', async ({ page }) => {
  await connectAndSignUp(page, `e2e-safety-present-${Date.now()}`);
  await page.goto(gw.url('/app/emergency'));

  await expect(
    page.getByText(/can't present a grant|cannot present a grant/i).first(),
  ).toBeVisible();
});

// The most important sentence in the product's UI.
//
// hub/internal/httpapi/geofence.go, at length: the position a fence is tested
// against comes from the CLIENT and nothing verifies it. Anyone who can call
// the API can claim any coordinates. A page that presents a fence as a lock is
// actively harmful — someone will rely on it.
test('a geofence is visibly described as unverified, above the rules', async ({ page }) => {
  await connectAndSignUp(page, `e2e-safety-fence-${Date.now()}`);
  await page.goto(gw.url('/app/access-rules'));

  const admission = page
    .getByText(/nothing (here )?verifies|position the requesting device claims/i)
    .first();
  await expect(admission).toBeVisible();

  // Visible without opening anything. A <details> the user never expands is the
  // same as no disclosure at all, and this is the disclosure the feature's
  // safety rests on.
  const insideDetails = await admission.evaluate(
    (el) => el.closest('details') !== null && !el.closest('details')!.open,
  );
  expect(
    insideDetails,
    'the geofence admission is inside a collapsed <details>. A user who never ' +
      'expands it reads the page as describing a lock, which is what the wording ' +
      'exists to prevent.',
  ).toBe(false);
});

// The tier ceiling is enforced in the engine and shown by the console. A rule
// list that omitted it would leave someone believing an automation could be
// given any verb.
test('the automations screen says there is no rule engine, rather than showing an empty list', async ({
  page,
}) => {
  // The hub under test runs with no device driver, so it has no rule engine and
  // answers 503 automations_not_configured. That is the DESIGNED answer — the
  // API returns a named 503 rather than a 404 or an empty array precisely so a
  // console can tell "no engine" from "no rules" — and Chromium logs any
  // non-2xx as a console error. Allowing this one specific response keeps the
  // suite's no-console-errors check meaningful instead of loosening it.
  allowExpectedConsoleError(
    page,
    (text, url) => url.includes('/automations') && text.includes('503'),
  );

  await connectAndSignUp(page, `e2e-safety-tier-${Date.now()}`);
  await page.goto(gw.url('/app/automations'));

  // A hub with no device driver has no rule engine, and the page says so rather
  // than rendering an empty list — which is itself one of the behaviours worth
  // pinning, since "no rules" and "no engine" are different answers.
  await expect(
    page.getByText(/no rule engine|rule engine is running|not configured/i).first(),
  ).toBeVisible();
});

// Requesting and storing a grant, against a real hub that really mints one.
//
// The offline library has unit tests against mocks; the screen renders; nothing
// had ever joined the two. A hub could have had a working issuance endpoint and
// an app that never successfully stored what it returned, and both suites would
// have stayed green — on the one path whose entire purpose is working later,
// when nobody can fix it.
//
// This covers the half that works in any build. PRESENTING a grant talks
// straight to the controller on the LAN, which a browser tab cannot do, and the
// screen says so rather than failing at a gate.
test('a grant is really issued by the hub and really stored on the device', async ({ page }) => {
  await connectAndSignUp(page, `e2e-grant-${Date.now()}`);

  // A grant is scoped to access points, so there has to be one. Created
  // through the API rather than the UI on purpose: money-path.spec.ts already
  // drives that form, and re-driving it here would make this test fail for
  // reasons that have nothing to do with grants.
  const created = await page.evaluate(async () => {
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
    // A grant is bound to the CONTROLLER that would redeem it, so the access
    // point needs a device. The hub refuses otherwise — correctly: a grant for
    // a gate with no controller could never open anything, and issuing one
    // would silently widen a signed document for nothing.
    const devRes = await fetch(`${base}/v1/devices`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: locId, label: 'Emergency Controller' }),
    });
    if (devRes.status !== 201) {
      return { status: devRes.status, body: 'device: ' + (await devRes.text()) };
    }
    const device = await devRes.json();

    const res = await fetch(`${base}/v1/access-points`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location_id: locId,
        name: 'Emergency Gate',
        kind: 'gate',
        device_id: device.id,
      }),
    });
    return { status: res.status, body: await res.text() };
  });
  expect(created.status, `could not create an access point: ${created.body}`).toBe(201);

  await page.goto(gw.url('/app/emergency'));

  // Pick the gate, then ask the hub. The response is watched directly so a
  // silent client-side failure cannot pass as success.
  await page.getByRole('button', { name: /Emergency Gate/ }).click();

  const issuePromise = page.waitForResponse(
    (r) => r.url() === gw.url('/v1/offline-grants') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Get emergency access/i }).click();
  const issued = await issuePromise;
  expect(issued.status(), 'the hub refused to mint a grant').toBe(201);

  // The hub minted one. The claim under test is that the APP kept it.
  await expect(page.getByText(/Saved\./i).first()).toBeVisible();

  // Stored in the vault, not merely rendered. This is the assertion that
  // matters: a grant that exists only in React state is gone the moment the
  // page reloads, which is exactly when it is needed.
  //
  // Read the RECORDS, not the database. The screen opens the vault on load, so
  // the database exists whether or not anything was ever written to it — an
  // earlier version of this test asserted only on indexedDB.databases() and
  // stayed green with the write commented out, which is the exact failure the
  // test was written to catch.
  const held = await page.evaluate<{ ids: string[]; err?: string }>(() => {
    return new Promise((resolve) => {
      const open = indexedDB.open('lintel.offline-access');
      open.onerror = () => resolve({ ids: [], err: 'the vault could not be opened' });
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('grants')) {
          resolve({ ids: [], err: 'the vault has no grants store' });
          return;
        }
        const req = db.transaction('grants', 'readonly').objectStore('grants').getAllKeys();
        req.onerror = () => resolve({ ids: [], err: 'the grants store could not be read' });
        req.onsuccess = () => resolve({ ids: req.result.map(String) });
      };
    });
  });
  expect(
    held.ids.length,
    `the hub minted a grant and the screen said "Saved.", but the vault holds no ` +
      `grant record${held.err ? ` (${held.err})` : ''}. It would not survive a ` +
      `reload, let alone the outage it exists for.`,
  ).toBeGreaterThan(0);
});
