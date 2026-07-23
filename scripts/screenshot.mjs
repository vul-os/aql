#!/usr/bin/env node
/**
 * Real-app screenshotter (VULOS-PRODUCT-STANDARD).
 *
 * Captures every view of the shipped Svelte console running under plain
 * `vite dev`. The browser build uses the in-memory demo dataset
 * (src/lib/data.ts), so no Tauri/Rust backend is needed. Writes PNGs to
 * docs/screenshots/ (standard location; hero.png = overview.png) and mirrors
 * them into assets/screens/ for README/site references.
 *
 * Usage:  npm run screenshot          (starts vite itself on :1420)
 *         npm run dev  # elsewhere    (script reuses the running server)
 *
 * Aql is a dark operations console by design, so captures are dark-theme.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'docs', 'screenshots');
const MIRROR = join(root, 'assets', 'screens');
const BASE = 'http://localhost:1420';
const VIEWPORT = { width: 1440, height: 900 };

// view id in src/routes/+page.svelte  ->  screenshot filename
const VIEWS = [
  ['overview', 'overview'],
  ['devices', 'devices'],
  ['energy', 'energy'],
  ['automations', 'automations'],
];

async function serverUp() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
async function waitForServer(deadline = 40_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadline) {
    if (await serverUp()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite dev did not come up on ${BASE}`);
}

async function capture(page, view, name) {
  await page.goto(`${BASE}/?screenshot=1&view=${view}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600); // let entry state + fonts settle
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  copyFileSync(join(OUT, `${name}.png`), join(MIRROR, `${name}.png`));
  console.log(`  ✓ ${name}.png`);
}

async function main() {
  let vite = null;
  if (await serverUp()) {
    console.log(`Reusing dev server at ${BASE}`);
  } else {
    console.log('Starting vite dev…');
    vite = spawn('npx', ['vite', 'dev', '--port', '1420', '--strictPort'], {
      cwd: root,
      stdio: 'ignore',
      detached: true,
    });
    await waitForServer();
  }

  mkdirSync(OUT, { recursive: true });
  mkdirSync(MIRROR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    for (const [view, name] of VIEWS) await capture(page, view, name);
    // hero == overview
    copyFileSync(join(OUT, 'overview.png'), join(OUT, 'hero.png'));
    copyFileSync(join(OUT, 'overview.png'), join(MIRROR, 'hero.png'));
    console.log('  ✓ hero.png');
  } finally {
    await browser.close();
    if (vite && vite.pid) {
      try { process.kill(-vite.pid); } catch {}
    }
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
