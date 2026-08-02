// The two auth paths nobody had exercised against a real hub:
//   1. logout — does it actually kill the session (client AND server), or
//      just clear localStorage and hope?
//   2. 401 -> refresh -> retry — src/lib/api.ts's apiFetch() has a one-shot
//      "401, refresh, retry" path (see its doRequest/refreshAccessToken).
//      The original bug (RefreshResponse assumed flat tokens; the hub
//      nests them under `tokens`) would live exactly here: a real access
//      token expiring mid-session. Since the real TTL is 15 minutes
//      (hub/internal/httpapi/auth.go's accessTTL) and nobody's about to
//      wait that out in CI, this reproduces "expired access token, still-
//      valid refresh token" directly instead.
import { startGateway, type LiveGateway } from './fixtures/hub';
import { allowExpectedConsoleError, expect, test } from './fixtures/test';

test.describe.configure({ mode: 'serial' });

let gw: LiveGateway;

test.beforeAll(async () => {
  gw = await startGateway('auth-flows');
});

test.afterAll(async () => {
  await gw.stop();
});

async function connectAndSignUp(
  page: import('@playwright/test').Page,
  username: string,
): Promise<void> {
  await page.goto(gw.url('/signup'));
  await page.getByLabel('Your name', { exact: true }).fill('Auth Flow Tester');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple 1');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click(); // account-kind step
  await page.getByLabel('Location name').fill('Auth Flow House');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  // A longer timeout than the 5s default, because this one assertion waits on
  // argon2id: 64 MiB and three passes, single-threaded, per the RFC 9106
  // low-memory profile in httpapi/password.go. That cost is the point of the
  // hash, and with two Playwright workers two signups can be paying it at once
  // while vite and a hub binary are also competing — which made this the only
  // assertion in the suite that flaked under load.
  //
  // Not a weakened check: a broken signup fails this at any timeout. It is the
  // difference between allowing for work that is deliberately slow and
  // asserting that work is fast.
  await expect(page.getByRole('heading', { name: "You're in." })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Go to dashboard', exact: true }).click();
  await expect(page).toHaveURL(`${gw.baseUrl}/app`);
}

test('logout clears the session locally and server-side, and protected routes bounce to /login', async ({
  page,
}) => {
  await connectAndSignUp(page, `e2e-logout-${Date.now()}`);

  expect(await page.evaluate(() => localStorage.getItem('aql.access_token'))).not.toBeNull();

  const logoutResponsePromise = page.waitForResponse(
    (r) => r.url() === gw.url('/v1/auth/logout') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const logoutResponse = await logoutResponsePromise;
  expect(logoutResponse.status()).toBe(200);

  await expect(page).toHaveURL(`${gw.baseUrl}/login`);
  expect(await page.evaluate(() => localStorage.getItem('aql.access_token'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('aql.refresh_token'))).toBeNull();

  // Not just a client-side illusion: hitting a protected route again must
  // still bounce to /login (no stale in-memory auth state surviving nav).
  await page.goto(gw.url('/app'));
  await expect(page).toHaveURL(`${gw.baseUrl}/login`);
});

test('a stale access token triggers a transparent 401 -> refresh -> retry', async ({ page }) => {
  await connectAndSignUp(page, `e2e-refresh-${Date.now()}`);

  const originalRefresh = await page.evaluate(() => localStorage.getItem('aql.refresh_token'));
  expect(originalRefresh).not.toBeNull();

  // Everything that observes the refresh is armed BEFORE the token is
  // corrupted, and that ordering is load-bearing. Arming afterwards leaves a
  // window of several round-trips in which an in-flight request can 401,
  // trigger the refresh, and repair the token — so the reload below then
  // succeeds outright, no second refresh ever happens, and the wait times out
  // against a product that behaved correctly.
  //
  // 401s here are the test's deliberate premise, not bugs. Chromium logs every
  // non-2xx fetch to the console regardless of apiFetch handling it, and the
  // boot fires SEVERAL authenticated requests at once — /v1/auth/me and the
  // account's locations among them. Which of those loses the race to the
  // shared refresh is genuine nondeterminism, so any 401 from this hub is
  // allowed. Anything that is not a 401 still fails the run.
  allowExpectedConsoleError(page, (text, locationUrl) =>
    text.includes('401') && locationUrl.startsWith(gw.baseUrl),
  );

  const statuses = new Map<string, number[]>();
  page.on('response', (res) => {
    const p = new URL(res.url()).pathname;
    statuses.set(p, [...(statuses.get(p) ?? []), res.status()]);
  });

  // Intercepted rather than observed with waitForResponse, because reading a
  // response body after the page has navigated fails with "No resource with
  // given identifier found" — Chromium may evict it. Fetching the response
  // here means the bytes are ours and survive the navigation.
  let refreshBody: { tokens?: { access_token?: string; refresh_token?: string } } | null = null;
  let refreshStatus = 0;
  await page.route(gw.url('/v1/auth/refresh'), async (route) => {
    const res = await route.fetch();
    refreshStatus = res.status();
    const text = await res.text();
    try {
      refreshBody = JSON.parse(text);
    } catch {
      refreshBody = null;
    }
    await route.fulfill({ response: res, body: text });
  });

  // Corrupt the access token so the next authenticated request 401s, while
  // leaving the real refresh token in place — this is "access token expired
  // mid-session" without waiting out the real 15-minute TTL.
  //
  // Written as an init script rather than an evaluate on the live page, and
  // that matters. The running app holds its tokens in memory and rewrites
  // them to storage, so a value poked in from outside can be overwritten
  // before the reload ever reads it — the boot then sees a perfectly valid
  // token, never 401s, and the test fails against correct behaviour. An init
  // script runs on the NEW document before any application code, so the
  // corrupted token is what boot actually finds.
  await page.addInitScript(() => {
    localStorage.setItem('aql.access_token', 'corrupted.not-a-real.jwt');
  });

  // AuthProvider's boot effect calls GET /v1/auth/me on mount — reloading
  // with the corrupted token re-triggers it for real, exactly like an
  // access token expiring while the user is sitting on the page.
  await page.reload();

  await expect
    .poll(() => refreshStatus, {
      message: 'the app never refreshed after a 401 — it either gave up or signed the user out',
    })
    .toBe(200);

  // The exact historical bug this test targets: RefreshResponse assumed
  // flat tokens on the response; the hub nests them under `tokens`. If
  // that parsing regresses, refreshAccessToken() silently returns false,
  // tokens get cleared, and the assertions below fail loudly instead of the
  // user just getting logged out for no visible reason.
  expect(refreshBody!.tokens?.access_token).toEqual(expect.any(String));
  expect(refreshBody!.tokens?.refresh_token).toEqual(expect.any(String));

  // The app must recover silently — no forced logout, no crash, no stuck
  // spinner. Still a fresh account with a location but no access points, so
  // the onboarding view is the expected authenticated state.
  await expect(page).toHaveURL(`${gw.baseUrl}/app`);
  await expect(page.getByText('One more step before your first gate opens.')).toBeVisible();

  // A 401 really happened (the refresh was provoked, not spontaneous) and the
  // app really recovered. Which path 401'd is a race between concurrent boot
  // requests and deliberately not asserted; that /v1/auth/me ends up answering
  // 200 is the recovery itself.
  await expect
    .poll(() => [...statuses.values()].flat(), {
      message: 'nothing ever returned 401, so this test did not exercise the path it claims to',
    })
    .toContain(401);
  await expect
    .poll(() => statuses.get('/v1/auth/me') ?? [], {
      message: 'the session never recovered — /v1/auth/me never succeeded after the refresh',
    })
    .toContain(200);

  const newAccess = await page.evaluate(() => localStorage.getItem('aql.access_token'));
  const newRefresh = await page.evaluate(() => localStorage.getItem('aql.refresh_token'));
  expect(newAccess).not.toBe('corrupted.not-a-real.jwt');
  expect(newAccess).toEqual(expect.any(String));
  // Refresh tokens rotate on every use (family reuse-detection, per
  // hub/internal/httpapi/auth.go's handleRefresh) — the pre-corruption
  // refresh token must no longer be the active one.
  expect(newRefresh).not.toBe(originalRefresh);
});

// The upgrade path for everyone who was already running this.
//
// Browser storage keys moved from `lintel.*` to `aql.*` when the repo stopped
// being lintel. src/lib/storageKeys.ts migrates them forward on read, and
// src/lib/__tests__/storageKeys.test.ts covers that against an in-memory stub —
// but nothing had ever exercised it in a real browser against a real hub, which
// is where it actually has to work.
//
// The failure it guards against is silent and unpleasant: every existing user
// signed out on upgrade, their chosen hub forgotten, with no error anywhere to
// explain it. "It logged me out and forgot my server" is a bug report nobody
// would connect to a directory rename.
test('a browser holding the old lintel.* keys is migrated, not signed out', async ({ page }) => {
  await connectAndSignUp(page, `e2e-migrate-${Date.now()}`);

  // Take the real session this browser just established and put it back under
  // the OLD names, exactly as an install from before the rename would hold it.
  const session = await page.evaluate(() => {
    const access = localStorage.getItem('aql.access_token');
    const refresh = localStorage.getItem('aql.refresh_token');
    const hub = localStorage.getItem('aql.gateway_url');
    localStorage.clear();
    if (access) localStorage.setItem('lintel.access_token', access);
    if (refresh) localStorage.setItem('lintel.refresh_token', refresh);
    if (hub) localStorage.setItem('lintel.gateway_url', hub);
    return { access, refresh, hub };
  });
  expect(session.access, 'no session to migrate — the sign-up helper changed').not.toBeNull();
  expect(session.hub, 'no stored hub URL to migrate').not.toBeNull();

  await page.goto(gw.url('/app'));

  // Still signed in: the app read the legacy keys rather than finding nothing.
  await expect(page).toHaveURL(/\/app(\/|$)/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const after = await page.evaluate(() => ({
    newAccess: localStorage.getItem('aql.access_token'),
    oldAccess: localStorage.getItem('lintel.access_token'),
    newHub: localStorage.getItem('aql.gateway_url'),
  }));

  // Migrated FORWARD, not merely read. The old key is gone, so the fallback
  // runs at most once per browser rather than becoming permanent by neglect.
  expect(after.newAccess, 'the session was read but never rewritten under the new key').toBe(
    session.access,
  );
  expect(after.oldAccess, 'the legacy key survived; the fallback would run forever').toBeNull();
  expect(after.newHub, 'the chosen hub was not carried across').toBe(session.hub);
});

// The profile form, which until now could not save.
//
// The console shipped it pointed at PATCH /v1/auth/me/profile, a route the hub
// did not serve — so "Save profile" failed for every user, every time, and
// routeParity recorded it as an acknowledged gap rather than a bug. The hub
// serves it now (hub/internal/httpapi/profile.go, with its own Go tests
// covering validation and persistence).
//
// What those Go tests cannot show is that the FORM is wired to it. That is the
// failure this repo keeps finding: a component complete, tested, and reached by
// nothing. So this drives the real form in a real browser and then RELOADS,
// because a name that survives only in React state is not saved.
test('the profile form really saves, and the name survives a reload', async ({ page }) => {
  const username = `e2e-profile-${Date.now()}`;
  await connectAndSignUp(page, username);
  await page.goto(gw.url('/app/settings'));

  const name = page.getByLabel('Display name', { exact: true });
  await expect(name).toBeVisible();
  await name.fill('Thandiwe Ncube');

  const saved = page.waitForResponse(
    (r) => r.url() === gw.url('/v1/auth/me/profile') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: /Save profile/i }).click();
  expect((await saved).status(), 'the hub refused the profile update').toBe(200);

  // Reload: this is the assertion that distinguishes "saved" from "rendered".
  await page.reload();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Thandiwe Ncube');
});

// The form's own help text says "https only", and the console enforces it
// before asking the hub — so the interesting assertion is that the request is
// never sent AND the user is told why. A silent no-op would look identical to
// a save from the outside.
//
// The hub enforces the same rule independently (profile_test.go's
// TestProfileUpdateRejectsNonHTTPSAvatars), because a rule only the browser
// keeps is not a rule. Neither check stands in for the other.
test('a non-https avatar is refused in the console, without asking the hub', async ({ page }) => {
  await connectAndSignUp(page, `e2e-avatar-${Date.now()}`);
  await page.goto(gw.url('/app/settings'));

  // A THIRD enforcement joined the two this test describes: the hub now serves
  // a Content-Security-Policy with `img-src 'self' data: blob:`, so Chromium
  // refuses to fetch the image at all and logs a violation. That is the policy
  // working — an avatar URL that reached the DOM despite both checks still does
  // not load — but the violation is a console error, and this suite treats
  // console errors as failures.
  //
  // Allowed narrowly, by matching the directive rather than the word "image",
  // so a violation of any OTHER directive still fails the run.
  const cspBlocked: string[] = [];
  allowExpectedConsoleError(page, (text) => {
    const isBlock = text.includes('Content Security Policy') && text.includes("img-src 'self'");
    if (isBlock) cspBlocked.push(text);
    return isBlock;
  });

  let asked = false;
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/auth/me/profile')) asked = true;
  });

  await page.getByLabel('Avatar URL', { exact: true }).fill('http://example.com/me.png');
  await page.getByRole('button', { name: /Save profile/i }).click();

  await expect(page.getByRole('alert')).toHaveText(/https/i);
  expect(asked, 'the console sent a request it had already decided was invalid').toBe(false);

  // And the browser refused the fetch independently of either check. This is
  // the belt the other two do not provide: it holds even for an avatar that
  // arrived from somewhere this console never validated.
  expect(
    cspBlocked.length,
    'the CSP did not block a third-party image — check img-src in withSecurityHeaders',
  ).toBeGreaterThan(0);
});
