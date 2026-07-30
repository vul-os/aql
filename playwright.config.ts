import { defineConfig, devices } from '@playwright/test';

// Real-browser E2E against a real gateway binary — see e2e-browser/README.md
// for why this lives here and not in e2e/ (that's a Go cross-module harness
// for gateway<->controller wire interop; this is Chromium against the
// embedded portal).
export default defineConfig({
  testDir: './e2e-browser',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e-browser/global-setup.ts',
  globalTeardown: './e2e-browser/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // FIVE spec files, each booting its own gateway process — the comment here
  // said "two" long after that stopped being true.
  //
  // Capped everywhere, not just in CI. Unbounded local workers default to the
  // core count, so a developer machine boots as many gateway processes as it
  // has cores and the sign-up flow starts timing out: a green suite becomes an
  // intermittently red one that passes on re-run. A verification step that is
  // only usually right is worse than a slow one, because the first instinct on
  // a red run is to blame the run rather than the code.
  workers: process.env.CI ? 2 : 2,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // These tests drive a REAL hub binary, and signing up or in pays argon2id at
  // the shipped cost: 64 MiB and three passes, single-threaded, per RFC 9106.
  // money-path.spec.ts pays it twice (sign up, then sign in) inside one test,
  // on top of real HTTP round trips and a location + access point.
  //
  // 45 seconds was not enough for that once the sign-up assertion was given an
  // honest allowance of its own — the failure simply moved from the assertion to
  // the test. Raising this is not hiding a slow test: a hung one still fails
  // here, and the cost being waited on is a security control working as
  // designed.
  timeout: 150_000,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // OpenGate.tsx / AccessPointAction.tsx ask for geolocation before
    // opening a gate. Grant a fixed real-world location deterministically
    // instead of leaving it to whatever the runner's permission-denial
    // timing happens to be.
    geolocation: { latitude: -33.9249, longitude: 18.4241 }, // Cape Town
    permissions: ['geolocation'],
    locale: 'en-ZA',
    timezoneId: 'Africa/Johannesburg',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
