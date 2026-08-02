import { expect, test } from './fixtures/test';
import { startGateway, type LiveGateway } from './fixtures/hub';

// A browser opening the hub's own console must not be asked where the hub is.
//
// # What this covers
//
// The hub embeds this console and serves it, so on the documented path — one
// binary, open localhost:8080 — the address bar already contains the answer.
// The boot probe only tried a dev backend on :8787 though, so a release binary
// or the container image opened onto "Connect to your hub" with an empty field.
//
// It stayed invisible because no shipped artifact embedded the console until
// this week: every path that exercised the picker was a dev server or a Tauri
// shell, where being asked IS correct. The moment the image started carrying the
// real bundle, the first screen an operator sees became a form asking for the
// URL they typed to get there.
//
// # Why the assertion is the signup form and not the absence of a picker
//
// Asserting "no picker" would pass on a blank page, a crash, or a spinner that
// never resolves. What matters is that the console reached its first real
// screen against the hub that served it, so this waits for something only a
// connected console renders.
let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('first-run');
});

test.afterAll(async () => {
  await gw.stop();
});

test('the embedded console connects to the hub that served it', async ({ page, cleanPage }) => {
  void cleanPage;

  // A browser with nothing stored, which is every operator's first visit.
  await page.goto(gw.url('/signup'));

  // The signup form, not the gateway picker.
  await expect(page.getByLabel('Your name', { exact: true })).toBeVisible({ timeout: 15_000 });
  // Shadowed, and kept anyway.
  //
  // Forcing servingOrigin() to return null makes the picker render — and this
  // line never runs, because the assertion above it fails first. So the suite
  // going red does not prove THIS line works. Checked separately by flipping it
  // to toHaveCount(1) with the picker forced: it matched exactly one button, so
  // the locator is real and not the vacuous kind (a Field's hint lives inside
  // its <label>, which made an exact-match getByLabel elsewhere in this suite
  // match nothing and pass no matter what).
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);

  // And it settled on the serving origin rather than a dev port.
  const stored = await page.evaluate(() => window.localStorage.getItem('aql.gateway_url'));
  expect(stored, 'the console should remember the hub it found').toBe(gw.baseUrl);
});
