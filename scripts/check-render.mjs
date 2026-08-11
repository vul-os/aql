/**
 * aql site/ render gate — renders index.html and docs.html in a real browser
 * and fails on the defects that static inspection cannot see.
 *
 * Why a browser: every bug this catches was invisible in the source. A
 * screenshot stretched to the wrong aspect ratio, both theme variants painted
 * on top of each other, a 1× image served to a 2× screen, an anchor pointing
 * at an id that no longer exists — the HTML reads fine in all four cases.
 *
 * Each check states what it measured, not just pass/fail, so a green run is
 * evidence rather than an assertion. Run:
 *
 *   node scripts/check-render.mjs                 # serves site/ itself
 *   node scripts/check-render.mjs --selftest      # prove the checks can fail
 */

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname, extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(__dirname, '..', 'site');

const VIEWPORTS = [
  { w: 1600, h: 900, label: 'desktop-wide' },
  { w: 1440, h: 900, label: 'desktop' },
  { w: 1280, h: 800, label: 'laptop' },
  { w: 1024, h: 768, label: 'tablet-landscape' },
  { w: 768,  h: 1024, label: 'tablet' },
  { w: 430,  h: 932, label: 'phone-large' },
  { w: 390,  h: 844, label: 'phone' },
  { w: 360,  h: 780, label: 'phone-small' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function serve(root) {
  return new Promise(ok => {
    const s = createServer(async (req, res) => {
      const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      let file = join(root, rel);
      if (!extname(file)) file = join(file, 'index.html');
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------
const findings = [];
const notes = [];
const fail = (check, where, detail) => findings.push({ check, where, detail });
const note = (s) => notes.push(s);

// ---------------------------------------------------------------------------
// Self-test plumbing. The docs checks below drive their own browser contexts
// and navigate several times each, so a mutation applied once after goto()
// would be wiped by the next navigation and the case would report a false
// MISSED. It is installed as an init script instead, which re-applies on every
// document in the context.
// ---------------------------------------------------------------------------
let SELFTEST_INJECT = null;

async function ctxPage(browser, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  if (SELFTEST_INJECT) {
    await page.addInitScript(inj => {
      if (inj.css) {
        const add = () => {
          const s = document.createElement('style');
          s.textContent = inj.css;
          document.documentElement.appendChild(s);
        };
        if (document.documentElement) add();
        else document.addEventListener('readystatechange', add, { once: true });
      }
      if (inj.js) {
        const run = () => { try { new Function(inj.js)(); } catch (e) {} };
        if (document.body) run();
        else document.addEventListener('DOMContentLoaded', run, { once: true });
      }
    }, SELFTEST_INJECT);
  }
  return [ctx, page];
}

// ---------------------------------------------------------------------------
// Per-viewport, per-theme DOM checks
// ---------------------------------------------------------------------------
async function inspect(page, opts = {}) {
  return page.evaluate(async ({ isRouter, isDark }) => {
    const out = { overflow: null, imgs: [], smallText: [], deadAnchors: [], hiddenPairs: [], themedShots: [] };

    // 1 · page-level horizontal overflow.
    // scrollWidth alone is not enough: html{overflow-x:clip} makes an
    // overflowing child report the clipped width, so measure the children too.
    const de = document.documentElement;
    const bleed = [];
    document.querySelectorAll('body *').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      // Deliberate designs that overflow their own scroll container are fine;
      // only flag elements that push the PAGE sideways.
      let p = el.parentElement, contained = false;
      while (p && p !== document.body) {
        const pcs = getComputedStyle(p);
        if (/auto|scroll|hidden|clip/.test(pcs.overflowX)) { contained = true; break; }
        p = p.parentElement;
      }
      if (contained) return;
      // Something parked wholly off-screen left (a skip link at -9999px) adds
      // no horizontal scroll — only content crossing the RIGHT edge does, plus
      // anything straddling the left edge and therefore partly unreachable.
      if (r.right <= 0) return;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        bleed.push({ tag: el.tagName, cls: String(el.className).slice(0, 50),
                     left: Math.round(r.left), right: Math.round(r.right) });
      }
    });
    out.overflow = { docW: de.scrollWidth, winW: window.innerWidth, bleed: bleed.slice(0, 6) };

    // 2 · every visible raster image at its true aspect ratio, and — on a 2×
    // context — actually resolving to a 2× source when one is offered.
    // naturalWidth is DENSITY-CORRECTED: a candidate picked via a "2x"
    // descriptor reports half its real pixel width, so comparing it against
    // the device pixels needed double-counts the ratio and every retina image
    // looks 2x too soft. Re-load currentSrc bare to get its true pixel size.
    const trueSize = async (url) => await new Promise(res => {
      const probe = new Image();
      probe.onload = () => res([probe.naturalWidth, probe.naturalHeight]);
      probe.onerror = () => res([0, 0]);
      probe.src = url;
    });
    for (const im of document.querySelectorAll('img')) {
      const r = im.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (!im.naturalWidth || !im.naturalHeight) continue;
      const rendered = r.width / r.height;
      const natural = im.naturalWidth / im.naturalHeight;
      const url = im.currentSrc || im.src;
      const [px, py] = await trueSize(url);
      // Only `fill` (the default) stretches pixels. cover/contain/none crop or
      // letterbox instead, so a box ratio that differs from the source ratio is
      // the intended design, not a defect — flagging it made every deliberately
      // cropped thumbnail look like a bug.
      const fit = getComputedStyle(im).objectFit;
      out.imgs.push({
        file: url.split('/').pop(),
        css: `${Math.round(r.width)}x${Math.round(r.height)}`,
        nat: `${im.naturalWidth}x${im.naturalHeight}`,
        realPx: `${px}x${py}`,
        skewPct: fit === 'fill' ? +(Math.abs(rendered / natural - 1) * 100).toFixed(1) : 0,
        objectFit: fit,
        offersSrcset: !!(im.srcset || im.closest('picture')?.querySelector('source[srcset]')),
        // >1 means the display asks for more pixels than the file has — the
        // exact cause of a soft-looking screenshot.
        upscale: px ? +(r.width * devicePixelRatio / px).toFixed(2) : 0,
      });
    }

    // 3 · legibility floor for real body copy.
    const TEXTY = new Set(['P', 'LI', 'DD', 'DT', 'TD', 'TH', 'SPAN', 'B', 'EM', 'STRONG', 'A', 'CODE']);
    document.querySelectorAll('main *, footer *').forEach(el => {
      if (!TEXTY.has(el.tagName)) return;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 12);
      if (!own) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.textTransform === 'uppercase') return;  // eyebrows/labels
      const size = parseFloat(cs.fontSize);
      if (size < 12) {
        out.smallText.push({ tag: el.tagName, size,
                             text: el.textContent.trim().slice(0, 40) });
      }
    });

    // 4 · every same-page fragment link resolves.
    // Skipped on the docs viewer: it is a hash ROUTER, so "#api" and
    // "#getting-started/first-run" name a chapter and a section within it,
    // not ids in the current document. checkDocs() validates those against
    // the real route table from docs/manifest.json instead.
    if (!isRouter) {
      document.querySelectorAll('a[href^="#"]').forEach(a => {
        const id = a.getAttribute('href').slice(1);
        if (!id) return;
        if (!document.getElementById(id) && !document.querySelector(`[name="${CSS.escape(id)}"]`)) {
          out.deadAnchors.push({ href: '#' + id, text: a.textContent.trim().slice(0, 30) });
        }
      });
    }

    // 5 · theme-aware screenshots, both mechanisms, decided from the DOM
    // relationship rather than the filename. Filename sniffing does not work:
    // in the ".only-light / .only-dark" model the LIGHT capture is the
    // unmarked one (hero.png beside hero-dark.png), so "no marker in the name"
    // means "the light variant", not "theme-neutral art".
    //
    //   a) paired elements — exactly one of .only-light / .only-dark may paint,
    //      and it must be the one matching the active theme;
    //   b) swapped src — an <img data-light data-dark> must be showing the
    //      attribute for the active theme.
    const painted = e => {
      const r = e.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden';
    };
    //      aql's landing uses a THIRD spelling of the paired model (.shot-l /
    //      .shot-d, 7 pairs of console screenshots). Before these selectors
    //      were added the two paired-model self-test cases reported "n/a" and
    //      every one of those pairs went unmeasured on every run — an
    //      inapplicable check reading exactly like a working one.
    const LIGHT_SEL = '.only-light, .shot-l';
    const DARK_SEL  = '.only-dark, .shot-d';
    out.hiddenPairs.push({
      scope: 'document',
      light: [...document.querySelectorAll(LIGHT_SEL)].filter(painted).length,
      dark:  [...document.querySelectorAll(DARK_SEL)].filter(painted).length,
    });

    document.querySelectorAll('img[data-light][data-dark]').forEach(im => {
      if (!painted(im)) return;
      const want = new URL(im.getAttribute(isDark ? 'data-dark' : 'data-light'), location.href).href;
      const got  = im.currentSrc || im.src || '';
      if (got && got !== want) {
        out.themedShots.push({ file: got.split('/').pop(), wanted: want.split('/').pop() });
      }
    });

    return out;
  }, { isRouter: !!opts.isRouter, isDark: !!opts.isDark });
}

async function checkPage(browser, base, path, theme, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, colorScheme: theme,
  });
  const page = await ctx.newPage();
  const where = `${path} ${vp.label}(${vp.w}) ${theme}`;

  const console404 = [];
  page.on('response', r => { if (r.status() >= 400) console404.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', e => fail('js-error', where, e.message));

  await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
  // reveal-on-scroll gates most of the page; force it so nothing is measured
  // while still at opacity 0 and translated.
  // Reveal-on-scroll gates most of these pages and the class name differs per
  // repo (.rv here, .reveal there). Force every variant: a fast programmatic
  // scroll does not reliably fire an IntersectionObserver, so anything still
  // hidden would be measured at opacity 0 and mid-transform.
  await page.evaluate(() =>
    document.querySelectorAll('.rv, .reveal, [data-reveal]').forEach(e => e.classList.add('in', 'is-in')));
  await page.evaluate(async () => {
    const H = document.body.scrollHeight;
    for (let y = 0; y < H; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);

  const r = await inspect(page, { isRouter: path === 'docs.html', isDark: theme === 'dark' });

  if (r.overflow.docW > r.overflow.winW + 1) {
    fail('h-overflow', where, `document is ${r.overflow.docW}px wide in a ${r.overflow.winW}px viewport`);
  }
  if (r.overflow.bleed.length) {
    fail('h-overflow', where,
      'elements pushing past the viewport: ' + r.overflow.bleed
        .map(b => `${b.tag}.${b.cls} [${b.left}→${b.right}]`).join('; '));
  }
  r.imgs.forEach(i => {
    if (i.skewPct > 1.5) {
      fail('img-distorted', where,
        `${i.file} drawn ${i.css} from a ${i.nat} source — ${i.skewPct}% off its true aspect ratio`);
    }
    // Vector art has no resolution to be short of — an SVG drawn at any size is
    // exactly as sharp. Only raster sources can be upscaled into softness.
    const isVector = /\.svgx?(\?|#|$)/i.test(i.file);
    if (!isVector && i.offersSrcset && i.upscale > 1.15) {
      fail('img-soft', where,
        `${i.file} drawn ${i.css} at dpr2 from a ${i.realPx} file — upscaled ${i.upscale}×`);
    }
  });
  r.smallText.forEach(t =>
    fail('text-too-small', where, `<${t.tag.toLowerCase()}> at ${t.size}px: “${t.text}”`));
  r.deadAnchors.forEach(a =>
    fail('dead-anchor', where, `${a.href} (“${a.text}”) matches no element on the page`));
  r.themedShots.forEach(s =>
    fail('screenshot-wrong-theme', where,
      `showing ${s.file} in ${theme} mode; the ${theme} variant is ${s.wanted}`));
  r.hiddenPairs.forEach(p => {
    const live = theme === 'dark' ? p.dark : p.light;
    const dead = theme === 'dark' ? p.light : p.dark;
    if (dead > 0) fail('both-themes-visible', where,
      `${p.scope}: ${dead} off-theme image(s) painted alongside ${live} on-theme`);
    if (live === 0 && dead === 0) return;   // page does not use the paired model
    if (live === 0) fail('no-image-visible', where, `${p.scope}: nothing painted for the ${theme} theme`);
  });
  console404.forEach(u => fail('http-error', where, u));

  await ctx.close();
  return r;
}

// ---------------------------------------------------------------------------
// Cross-page anchors: index.html ↔ docs.html
// ---------------------------------------------------------------------------
async function checkCrossPageAnchors(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const idsOf = async (p) => {
    await page.goto(`${base}/${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    return new Set(await page.evaluate(() => [...document.querySelectorAll('[id]')].map(e => e.id)));
  };
  const linksOf = async (p) => {
    await page.goto(`${base}/${p}`, { waitUntil: 'networkidle' });
    return page.evaluate(() => [...document.querySelectorAll('a[href*=".html#"]')]
      .map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 30) })));
  };

  const indexIds = await idsOf('index.html');
  const docsIds  = await idsOf('docs.html');
  const ids = { 'index.html': indexIds, 'docs.html': docsIds };

  for (const from of ['index.html', 'docs.html']) {
    for (const l of await linksOf(from)) {
      const [file, frag] = l.href.replace(/^\.\//, '').split('#');
      if (!ids[file]) continue;                       // external or unknown target
      if (file === 'docs.html') continue;             // hash-routed: "#api" is a doc slug, not an id
      if (!ids[file].has(frag)) {
        fail('dead-anchor', `${from} → ${l.href}`,
          `“${l.text}” points at #${frag}, which ${file} does not define`);
      }
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// The docs viewer: every chapter renders, and every LABELLED code block is
// actually coloured.
//
// The route shape is `#/slug`, not `#slug`. Getting that wrong does not throw:
// the router falls back to the first chapter, so a broken run measures the
// SAME default page N times over and reports a healthy-looking count for
// chapters it never opened. Every assertion below therefore checks that the
// chapter it asked for is the chapter it got, by title, and records per-chapter
// counts rather than a single total.
// ---------------------------------------------------------------------------
async function checkDocs(browser, base) {
  const [ctx, page] = await ctxPage(browser, { viewport: { width: 1440, height: 900 } });

  const manifest = await (await fetch(`${base}/docs/manifest.json`)).json();
  const pages = manifest.pages;
  const slugs = new Set(pages.map(p => p.id));

  // Links into the docs, from both pages, must name a slug that exists.
  for (const from of ['index.html', 'docs.html']) {
    await page.goto(`${base}/${from}`, { waitUntil: 'networkidle' });
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href*="docs.html#"]')].map(a => a.getAttribute('href')));
    for (const href of hrefs) {
      const slug = href.split('#')[1].replace(/^\//, '').split('#')[0];
      if (slug && !slugs.has(slug)) {
        fail('dead-doc-route', `${from} → ${href}`,
          `“${slug}” is not a published doc slug (${[...slugs].join(', ')})`);
      }
    }
  }

  let seenTitles = new Set();
  for (const p of pages) {
    await page.goto(`${base}/docs.html#/${p.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(450);
    const r = await page.evaluate(() => {
      const c = document.getElementById('content');
      const wraps = [...c.querySelectorAll('.codewrap')];
      return {
        title: (c.querySelector('h1') || {}).textContent || '',
        chars: c.textContent.trim().length,
        blocks: c.querySelectorAll('pre > code').length,
        wraps: wraps.length,
        labelled: wraps.filter(w => w.getAttribute('data-lang') !== 'text').length,
        highlighted: c.querySelectorAll('code.hljs').length,
        // a chip claiming a grammar over a block carrying no hljs markup
        lying: wraps.filter(w => w.getAttribute('data-lang') !== 'text' &&
                                 !w.querySelector('code.hljs')).length,
        copyBtns: c.querySelectorAll('.cw-copy').length,
        loading: !!c.querySelector('.loading'),
      };
    });

    if (r.loading || r.chars < 400) {
      fail('doc-not-rendered', `docs.html#/${p.id}`,
        `loading=${r.loading} textLength=${r.chars}`);
      continue;
    }
    // The chapter that loaded must be the chapter that was asked for.
    if (seenTitles.has(r.title)) {
      fail('doc-route-collapsed', `docs.html#/${p.id}`,
        `rendered “${r.title}”, which a previous route already rendered — the ` +
        `router is falling back instead of loading this chapter`);
    }
    seenTitles.add(r.title);

    if (r.wraps !== r.blocks) {
      fail('code-chrome-missing', `docs.html#/${p.id}`,
        `${r.blocks} code block(s) but only ${r.wraps} carry a language chip`);
    }
    if (r.copyBtns !== r.blocks) {
      fail('code-chrome-missing', `docs.html#/${p.id}`,
        `${r.blocks} code block(s) but only ${r.copyBtns} carry a copy button`);
    }
    if (r.lying) {
      fail('code-not-highlighted', `docs.html#/${p.id}`,
        `${r.lying} block(s) chipped with a grammar but carrying no hljs markup`);
    }
    note(`docs#/${p.id}: “${r.title}” ${r.chars} chars, ${r.blocks} code block(s), ` +
         `${r.labelled} labelled, ${r.highlighted} highlighted`);
  }

  if (seenTitles.size < pages.length) {
    fail('doc-route-collapsed', 'docs.html',
      `${pages.length} chapters requested but only ${seenTitles.size} distinct pages rendered`);
  }

  // Overflow, per chapter, at the widths where it actually bites.
  //
  // checkPage() renders `docs.html` with no hash, and the router serves the
  // first chapter for that. So every per-viewport check above it — overflow
  // included — has only ever examined `overview`, while the run reported
  // "docs.html" as covered. Seventeen of eighteen chapters were unmeasured.
  //
  // That is not hypothetical: it is why a `/v1/accounts/{id}/energy/{…}` chip
  // bleeding 376px inside a 390px viewport lived in `api` until someone
  // measured it by hand. Narrow widths only — this is 18 chapters and a full
  // matrix would be 288 renders for a defect class that does not appear at
  // 1440. The count is asserted so a router regression that collapses every
  // route to one page cannot pass this as coverage.
  const NARROW = [{ w: 390, h: 844, label: 'phone' }, { w: 320, h: 640, label: 'phone-min' }];
  let scanned = 0;
  for (const vp of NARROW) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const p of pages) {
      await page.goto(`${base}/docs.html#/${p.id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed') continue;
          const b = el.getBoundingClientRect();
          if (b.width <= 0 || b.right <= 0) continue;
          let a = el.parentElement, contained = false;
          while (a && a !== document.body) {
            if (/auto|scroll|hidden|clip/.test(getComputedStyle(a).overflowX)) { contained = true; break; }
            a = a.parentElement;
          }
          if (contained) continue;
          if (b.right > window.innerWidth + 1 || b.left < -1) {
            out.push(`${el.tagName}.${String(el.className).slice(0, 40)} [${Math.round(b.left)}→${Math.round(b.right)}]`);
          }
        }
        return { bleed: out.slice(0, 4), title: (document.querySelector('#content h1') || {}).textContent || '' };
      });
      scanned++;
      if (r.bleed.length) {
        fail('h-overflow', `docs.html#/${p.id} ${vp.label}(${vp.w})`,
          'elements pushing past the viewport: ' + r.bleed.join('; '));
      }
    }
  }
  const wantScans = NARROW.length * pages.length;
  if (scanned !== wantScans) {
    fail('doc-overflow-coverage', 'docs.html',
      `swept ${scanned} chapter/width pairs, expected ${wantScans}`);
  }
  note(`docs overflow: ${scanned} chapter×width pair(s) swept at ${NARROW.map(v => v.w).join('/')}px — ` +
       `every chapter, not just the default route`);

  await ctx.close();
}

// ---------------------------------------------------------------------------
// Docs layout: the reading invariants.
//
//   a) no <footer> — the suite chrome checker forbids one on a docs viewer;
//   b) the sidebar column stays pinned while the document scrolls;
//   c) the shell is packed LEFT on fixed tracks, so the on-this-page rail sits
//      beside the prose rather than being flung to the far edge by a `1fr`
//      middle track that keeps growing;
//   d) nothing important is hover-only — measured with hasTouch, which makes
//      @media(hover:none) match, not by reading the stylesheet. A media query
//      adds no specificity, so a rule inside one can lose to a later or deeper
//      selector and do exactly nothing while reading as correct.
// ---------------------------------------------------------------------------
async function checkDocsLayout(browser, base) {
  // a) no footer
  {
    const [ctx, page] = await ctxPage(browser, { viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/docs.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => document.querySelectorAll('footer').length);
    if (n > 0) fail('docs-footer', 'docs.html', `${n} <footer> element(s); the docs viewer must have none`);
    await ctx.close();
  }

  // b + c) sticky sidebar and left-packed shell, at every desktop width
  for (const w of [1024, 1280, 1440, 1600]) {
    const [ctx, page] = await ctxPage(browser, { viewport: { width: w, height: 900 } });
    await page.goto(`${base}/docs.html#/self-host`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(async () => {
      const col = document.getElementById('sideCol');
      const nav = document.getElementById('sidebar');
      const shell = document.querySelector('.shell');
      const cs = getComputedStyle(col);
      const before = col.getBoundingClientRect().top;
      window.scrollTo(0, 2400);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const after = col.getBoundingClientRect();
      const doc = document.querySelector('.doc').getBoundingClientRect();
      const toc = document.getElementById('toc');
      const tocVisible = getComputedStyle(toc).display !== 'none';
      return {
        position: cs.position, top: cs.top, height: cs.height,
        navOverflow: getComputedStyle(nav).overflowY,
        overscroll: getComputedStyle(nav).overscrollBehaviorY,
        scrollY: window.scrollY,
        colTop: Math.round(after.top), colBottom: Math.round(after.bottom),
        before: Math.round(before),
        justify: getComputedStyle(shell).justifyContent,
        cols: getComputedStyle(shell).gridTemplateColumns,
        docRight: Math.round(doc.right),
        tocLeft: tocVisible ? Math.round(toc.getBoundingClientRect().left) : null,
      };
    });
    const where = `docs.html ${w}px`;

    if (r.position !== 'sticky') {
      fail('sidebar-not-pinned', where, `.side-col computes position:${r.position}, expected sticky`);
    }
    if (r.top === 'auto') {
      // The exact defect this file was written for: `top:58px` followed by
      // `inset:auto` in the same block silently resets top, and a sticky box
      // with top:auto never sticks to anything.
      fail('sidebar-not-pinned', where, '.side-col has position:sticky but top:auto — it can never stick');
    }
    if (!/px/.test(r.height)) {
      fail('sidebar-not-pinned', where,
        `.side-col height computes “${r.height}”; a sticky column needs a real height or it has no room to slide`);
    }
    // The measurement that actually matters: after scrolling 2400px the column
    // must still be on screen. Before the fix it sat at -1109.
    if (r.scrollY > 400 && (r.colBottom <= 0 || r.colTop > 200)) {
      fail('sidebar-not-pinned', where,
        `after scrolling to y=${r.scrollY} the sidebar column is at top=${r.colTop} ` +
        `bottom=${r.colBottom} — it scrolled away with the page`);
    }
    if (r.navOverflow !== 'auto' && r.navOverflow !== 'scroll') {
      fail('sidebar-not-pinned', where, `sidebar nav overflow-y is ${r.navOverflow}; a pinned rail must scroll its own contents`);
    }
    if (r.overscroll !== 'contain') {
      fail('sidebar-not-pinned', where, `sidebar nav overscroll-behavior-y is ${r.overscroll}, expected contain`);
    }
    if (r.justify !== 'start' && r.justify !== 'flex-start') {
      fail('docs-shell-centred', where, `.shell justify-content is “${r.justify}” below 1900px; docs packs left`);
    }
    if (/\bfr\b/.test(r.cols)) {
      fail('docs-shell-centred', where, `.shell tracks are “${r.cols}” — a flexible track drags the rail away from the prose`);
    }
    // The rail must stay next to the text it indexes.
    if (r.tocLeft !== null && r.tocLeft - r.docRight > 120) {
      fail('docs-shell-centred', where,
        `on-this-page rail is ${r.tocLeft - r.docRight}px from the right edge of the prose`);
    }
    await ctx.close();
  }

  // d) hover-revealed controls on a touch device
  {
    const [ctx, page] = await ctxPage(browser, {
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    });
    await page.goto(`${base}/docs.html#/self-host`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const hoverNone = matchMedia('(hover: none)').matches;
      const alpha = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1;
                           const p = m[1].split(',').map(s => parseFloat(s)); return p.length > 3 ? p[3] : 1; };
      const probe = sel => [...document.querySelectorAll(sel)].map(e => {
        const cs = getComputedStyle(e);
        return { a: alpha(cs.color), vis: cs.visibility, disp: cs.display,
                 w: Math.round(e.getBoundingClientRect().width) };
      });
      return { hoverNone, copy: probe('.cw-copy'), anchors: probe('.doc h2 a.anchor') };
    });
    if (!r.hoverNone) {
      fail('hover-only-control', 'docs.html touch', 'the touch context did not match @media(hover:none); the probe is not measuring what it claims');
    }
    const invisible = (list) => list.filter(e => e.a < 0.05 || e.vis === 'hidden' || e.disp === 'none' || e.w < 4);
    if (!r.copy.length) {
      fail('hover-only-control', 'docs.html touch', 'no copy buttons found to measure');
    }
    for (const [label, list] of [['copy button', r.copy], ['section anchor', r.anchors]]) {
      const dead = invisible(list);
      if (list.length && dead.length) {
        fail('hover-only-control', 'docs.html touch',
          `${dead.length} of ${list.length} ${label}(s) are invisible under @media(hover:none) — a hover-only control does not exist on a phone`);
      }
    }
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// Syntax-token contrast, computed from the RENDERED colours.
//
// A palette that was correct when it was written is not evidence that the
// palette on the page today is correct — so this reads the colour the browser
// actually paints for each token class and the background it is painted on,
// and runs the WCAG relative-luminance formula over the pair. It asserts a
// coverage floor as well: a run that measured no tokens because highlighting
// silently broke would otherwise pass with nothing checked.
// ---------------------------------------------------------------------------
const MIN_TOKEN_CLASSES = 5;

async function checkCodeContrast(browser, base) {
  const manifest = await (await fetch(`${base}/docs/manifest.json`)).json();
  const seen = new Map();   // "theme|class" -> {ratio, fg, bg}

  for (const theme of ['light', 'dark']) {
    const [ctx, page] = await ctxPage(browser, { viewport: { width: 1440, height: 900 }, colorScheme: theme });
    for (const p of manifest.pages) {
      await page.goto(`${base}/docs.html#/${p.id}`, { waitUntil: 'networkidle' });
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(220);
      const rows = await page.evaluate(() => {
        const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const opaque = el => {           // walk up for the first non-transparent bg
          let e = el;
          while (e) {
            const c = getComputedStyle(e).backgroundColor;
            const p = (c.match(/[\d.]+/g) || []).map(Number);
            if (p.length >= 3 && (p.length < 4 || p[3] > 0.95)) return c;
            e = e.parentElement;
          }
          return 'rgb(255,255,255)';
        };
        const out = [];
        document.querySelectorAll('code.hljs span[class*="hljs-"]').forEach(s => {
          if (!s.textContent.trim()) return;
          const cls = [...s.classList].find(c => c.startsWith('hljs-'));
          if (!cls) return;
          out.push({ cls, fg: rgb(getComputedStyle(s).color), bg: rgb(opaque(s)) });
        });
        // the unhighlighted base colour of a code slab counts too
        document.querySelectorAll('.codewrap pre code').forEach(c => {
          out.push({ cls: 'base', fg: rgb(getComputedStyle(c).color), bg: rgb(opaque(c)) });
        });
        document.querySelectorAll('.cw-lang, .cw-copy').forEach(c => {
          out.push({ cls: 'chrome-' + (c.className.includes('lang') ? 'lang' : 'copy'),
                     fg: rgb(getComputedStyle(c).color), bg: rgb(opaque(c)) });
        });
        return out;
      });

      const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      for (const row of rows) {
        const l1 = lum(row.fg), l2 = lum(row.bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const key = `${theme}|${row.cls}`;
        const prev = seen.get(key);
        if (!prev || ratio < prev.ratio) seen.set(key, { ratio, fg: row.fg, bg: row.bg });
      }
    }
    await ctx.close();
  }

  const classes = new Set([...seen.keys()].map(k => k.split('|')[1]));
  if (classes.size < MIN_TOKEN_CLASSES) {
    fail('code-contrast', 'docs.html',
      `only ${classes.size} distinct token colour(s) measured (floor ${MIN_TOKEN_CLASSES}) — ` +
      `highlighting is probably not running, so this check examined almost nothing`);
  }
  let worst = { ratio: 99 };
  for (const [key, v] of seen) {
    if (v.ratio < worst.ratio) worst = { ...v, key };
    if (v.ratio < 4.5) {
      fail('code-contrast', key,
        `rgb(${v.fg}) on rgb(${v.bg}) is ${v.ratio.toFixed(2)}:1, under the 4.5:1 floor`);
    }
  }
  note(`code contrast: ${seen.size} colour/theme pairs over ${classes.size} token classes; ` +
       `weakest ${worst.key} at ${worst.ratio.toFixed(2)}:1`);
}

// ---------------------------------------------------------------------------
// Figures and code blocks wider than the column they sit in.
//
// Several drawings are authored on a 920px floor so their smallest label never
// renders below 12px, and the docs carry code fences and tables wider than a
// phone. All of them scroll — and scrolling with no affordance reads as a
// clipped layout, not a scrollable one. Three things have to hold, and the
// third is the one that makes the first two mean anything:
//
//   · overflowing  ⇒ the fade is painted and the hint is displayed
//   · fits exactly ⇒ NEITHER is shown. A fade over content that already fits
//     is itself the broken-layout signal, so this direction is a real failure
//     and not a nicety.
//   · scrolled to the end ⇒ both go, or the page claims there is more to see.
//
// The scroll is driven with behavior:'instant' and the offset it reached is
// asserted before anything is read: the site sets scroll-behavior:smooth in
// places, which turns scrollTo into an animation, and a measurement taken two
// frames into an animation is a measurement of nothing.
// ---------------------------------------------------------------------------
async function checkFigureAffordance(browser, base) {
  const seen = { cards: 0, overflowing: 0, fitting: 0, ended: 0 };

  for (const [path, hash] of [['index.html', ''], ['docs.html', '#/self-host'], ['docs.html', '#/api']]) {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const [ctx, page] = await ctxPage(browser, { viewport: vp, deviceScaleFactor: 2 });
      await page.goto(`${base}/${path}${hash}`, { waitUntil: 'networkidle' });
      await page.evaluate(() =>
        document.querySelectorAll('.rv, .reveal, [data-reveal]').forEach(e => e.classList.add('in', 'is-in')));
      await page.waitForTimeout(1000);
      const where = `${path}${hash} @${vp.width}`;

      const rows = await page.evaluate(async () => {
        const scrollerOf = c => c.querySelector('.illo-scroll, .illo-vp > pre, .illo-vp > table');
        const out = [];
        for (const card of document.querySelectorAll('.figscroll')) {
          const sc = scrollerOf(card);
          if (!sc) { out.push({ broken: 'no scroller inside .figscroll' }); continue; }
          const fade = card.querySelector('.illo-fade');
          const hint = card.querySelector('.illo-hint');
          if (!fade || !hint) { out.push({ broken: 'card has no fade or no hint element' }); continue; }
          const over = sc.scrollWidth - sc.clientWidth;
          const read = () => ({
            cls: card.classList.contains('is-scrollable'),
            end: card.classList.contains('at-end'),
            fade: parseFloat(getComputedStyle(fade).opacity),
            hint: getComputedStyle(hint).display,
            hintPx: parseFloat(getComputedStyle(hint).fontSize),
          });
          const rest = read();
          let atEnd = null, reached = null;
          if (over > 8) {
            // instant, and prove it landed — smooth scrolling would leave this
            // reading a position the browser is still animating towards.
            sc.scrollTo({ left: over, behavior: 'instant' });
            await new Promise(r => setTimeout(r, 350));
            reached = Math.round(sc.scrollLeft);
            atEnd = read();
            sc.scrollTo({ left: 0, behavior: 'instant' });
            await new Promise(r => setTimeout(r, 350));
          }
          out.push({
            id: (card.closest('section') || {}).id || card.className.split(/\s+/)[0],
            over, rest, atEnd, reached,
          });
        }
        return out;
      });

      for (const r of rows) {
        if (r.broken) { fail('figure-affordance', where, r.broken); continue; }
        seen.cards++;
        if (r.over > 8) {
          seen.overflowing++;
          if (!r.rest.cls) fail('figure-affordance', where,
            `${r.id} overflows by ${r.over}px but is not marked scrollable`);
          if (r.rest.fade < 0.5) fail('figure-affordance', where,
            `${r.id} overflows by ${r.over}px with no edge fade (opacity ${r.rest.fade})`);
          if (r.rest.hint === 'none') fail('figure-affordance', where,
            `${r.id} overflows by ${r.over}px with no visible hint`);
          if (r.rest.hintPx < 12) fail('text-too-small', where,
            `figure hint at ${r.rest.hintPx}px, under the 12px floor`);
          if (r.reached < r.over - 2) fail('figure-affordance', where,
            `${r.id}: scrollTo(${r.over}) only reached ${r.reached} — the end state was never measured`);
          else {
            seen.ended++;
            if (!r.atEnd.end) fail('figure-affordance', where,
              `${r.id} is scrolled to its end but still says there is more`);
            if (r.atEnd.hint !== 'none') fail('figure-affordance', where,
              `${r.id}: the hint survives being scrolled to the end`);
          }
        } else {
          seen.fitting++;
          if (r.rest.cls) fail('figure-affordance', where,
            `${r.id} fits (${r.over}px of overflow) but is marked scrollable`);
          if (r.rest.fade > 0.02) fail('figure-affordance', where,
            `${r.id} fits but paints an edge fade (opacity ${r.rest.fade}) — reads as clipped`);
          if (r.rest.hint !== 'none') fail('figure-affordance', where,
            `${r.id} fits but shows a "scroll for more" hint`);
        }
      }
      await ctx.close();
    }
  }

  // Coverage floors. Every assertion above is vacuous if the page stopped using
  // the mechanism, and a check over zero elements passes exactly like one that
  // works. Both DIRECTIONS need real examples or the pass proves only half of
  // the rule: fitting cards are the false-positive control for the fade.
  if (seen.overflowing < 6) fail('figure-affordance', 'coverage',
    `only ${seen.overflowing} genuinely overflowing figure(s) examined — the rule was barely exercised`);
  if (seen.fitting < 6) fail('figure-affordance', 'coverage',
    `only ${seen.fitting} figure(s) that FIT were examined — nothing controls the false-positive direction`);
  if (seen.ended < 6) fail('figure-affordance', 'coverage',
    `the scrolled-to-end state was only reached ${seen.ended} time(s)`);
  note(`figure affordance: ${seen.cards} card-instances — ${seen.overflowing} overflowing ` +
       `(${seen.ended} driven to their end), ${seen.fitting} fitting and correctly bare`);
}

// ---------------------------------------------------------------------------
// SVG label halos, and the surface they are drawn on.
//
// The connector wires in the figures are drawn before the labels and used to
// run straight through the glyphs, so every label paints a halo of the
// background colour behind itself (paint-order: stroke fill). That only works
// if the halo colour IS the colour of the surface underneath: --il-bg was
// declared one level up, on the section, and every figure on the page drew its
// labels inside a 4px outline of a colour the card was not — a pale smudge in
// light theme, a dark one in dark.
//
// Comparison is against the PAINTED background of the nearest opaque ancestor,
// resolved from computed styles, not against the token the author believed was
// in play. getScreenCTM is used for the geometry rather than getComputedStyle,
// which reports SVG lengths in nominal user units and would silently compare
// viewBox coordinates against CSS pixels.
// ---------------------------------------------------------------------------
async function checkLabelHalos(browser, base) {
  let examined = 0, crossed = 0;

  for (const theme of ['light', 'dark']) {
    for (const w of [1440, 1024, 390]) {
      const [ctx, page] = await ctxPage(browser, { viewport: { width: w, height: 900 } });
      await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await page.evaluate(() =>
        document.querySelectorAll('.rv, .reveal, [data-reveal]').forEach(e => e.classList.add('in', 'is-in')));
      await page.waitForTimeout(700);
      const where = `index.html ${theme} @${w}`;

      const r = await page.evaluate(() => {
        const rgb = c => { const m = String(c).match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
        // the first ancestor that actually paints something opaque
        const surfaceOf = el => {
          let e = el;
          while (e && e !== document.documentElement) {
            const m = String(getComputedStyle(e).backgroundColor).match(/[\d.]+/g);
            if (m && (m.length < 4 || Number(m[3]) > 0.92)) {
              return { c: m.slice(0, 3).map(Number), on: (e.className || '').toString().split(/\s+/)[0] || e.tagName };
            }
            e = e.parentElement;
          }
          const m = String(getComputedStyle(document.body).backgroundColor).match(/[\d.]+/g);
          return { c: m ? m.slice(0, 3).map(Number) : null, on: 'body' };
        };

        const bad = [], unprotected = [];
        let n = 0, hit = 0;

        document.querySelectorAll('svg').forEach(svg => {
          const ctm = svg.getScreenCTM && svg.getScreenCTM();
          if (!ctm) return;
          const boxes = [];
          svg.querySelectorAll('text').forEach(t => {
            if (!t.textContent.trim()) return;
            const cs = getComputedStyle(t);
            const sw = parseFloat(cs.strokeWidth) || 0;
            const halo = /stroke/.test(cs.paintOrder) && sw > 0 &&
                         cs.stroke !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(cs.stroke);
            const box = t.getBoundingClientRect();
            if (box.width > 0) boxes.push({ box, halo, txt: t.textContent.trim().slice(0, 26) });
            if (!halo) return;
            n++;
            const s = rgb(cs.stroke), surf = surfaceOf(t);
            if (!s || !surf.c) { bad.push({ txt: t.textContent.trim().slice(0, 26), why: 'unreadable colours' }); return; }
            const d = Math.max(...s.map((v, i) => Math.abs(v - surf.c[i])));
            if (d > 6) bad.push({ txt: t.textContent.trim().slice(0, 26),
              why: `halo rgb(${s.join(',')}) on a rgb(${surf.c.join(',')}) surface (.${surf.on}), Δ${d}` });
          });

          // Which labels a stroke actually runs through. Every stroked geometry
          // is walked with getPointAtLength and each sample mapped to screen
          // space through the SVG's own CTM, so a label is only reported as
          // crossed when the ink genuinely lands inside its glyph box.
          const pt = svg.createSVGPoint();
          svg.querySelectorAll('path,line,circle,rect,polyline,polygon').forEach(g => {
            const cs = getComputedStyle(g);
            if (!cs.stroke || cs.stroke === 'none') return;
            if (parseFloat(cs.strokeWidth) <= 0) return;
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return;
            let len = 0;
            try { len = g.getTotalLength ? g.getTotalLength() : 0; } catch (e) { return; }
            if (!len) return;
            const steps = Math.min(260, Math.max(12, Math.round(len / 3)));
            for (let i = 0; i <= steps; i++) {
              let sp;
              try { const p = g.getPointAtLength((len * i) / steps); pt.x = p.x; pt.y = p.y; sp = pt.matrixTransform(ctm); }
              catch (e) { return; }
              for (const b of boxes) {
                if (sp.x > b.box.left + 1.5 && sp.x < b.box.right - 1.5 &&
                    sp.y > b.box.top + 1.5 && sp.y < b.box.bottom - 1.5) {
                  hit++;
                  if (!b.halo) unprotected.push(`“${b.txt}” × ${g.getAttribute('class') || g.tagName}`);
                  i = steps + 1; break;
                }
              }
            }
          });
        });
        return { n, hit, bad, unprotected: [...new Set(unprotected)] };
      });

      examined += r.n; crossed += r.hit;
      [...new Set(r.bad.map(b => `“${b.txt}” — ${b.why}`))].forEach(m =>
        fail('label-halo', where, m));
      r.unprotected.forEach(m =>
        fail('label-halo', where, `${m}: a stroke runs through this label and it has no halo`));
      await ctx.close();
    }
  }

  // A halo check that finds no halos is not a passing halo check.
  if (examined < 200) fail('label-halo', 'coverage',
    `only ${examined} haloed label(s) examined across 2 themes × 3 widths`);
  if (crossed < 6) fail('label-halo', 'coverage',
    `no stroke was measured crossing a label — the collision half of this check proved nothing`);
  note(`label halos: ${examined} haloed labels measured against their painted surface ` +
       `(2 themes × 3 widths); ${crossed} stroke-through-label crossings, all haloed`);
}

// ---------------------------------------------------------------------------
// Layouts that draw a box round nothing.
//
// Two defects with one shape, both measured on this page: a grid stretching a
// short card to a tall sibling's height (the "Not built yet" ledger card was
// 1271px of border round 621px of list, and the five-step outage card 1050px
// round 503px), and a two-column section head where one column runs 227px past
// the other. Both read as "the layout is broken", and neither is visible in the
// source — the CSS says align-items and the copy says nothing at all.
//
// Ink is measured, not boxes: the union of every text run and every painted
// child, so padding is subtracted and a card that legitimately ends in
// whitespace is not accused of anything.
// ---------------------------------------------------------------------------
async function checkDeadSpace(browser, base) {
  let surfaces = 0, heads = 0;

  for (const w of [1440, 1280, 1024]) {
    const [ctx, page] = await ctxPage(browser, { viewport: { width: w, height: 900 } });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() =>
      document.querySelectorAll('.rv, .reveal, [data-reveal]').forEach(e => e.classList.add('in', 'is-in')));
    await page.waitForTimeout(600);
    const where = `index.html @${w}`;

    const r = await page.evaluate(() => {
      const inkBottom = (el) => {
        let b = -Infinity;
        const walk = n => {
          for (const c of n.childNodes) {
            if (c.nodeType === 3) {
              if (!c.textContent.trim()) continue;
              const rg = document.createRange(); rg.selectNodeContents(c);
              for (const rr of rg.getClientRects()) if (rr.height > 0) b = Math.max(b, rr.bottom);
            } else if (c.nodeType === 1) {
              const cs = getComputedStyle(c);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              if (/^(IMG|CANVAS|VIDEO|HR)$/.test(c.tagName) || c.tagName === 'svg') {
                b = Math.max(b, c.getBoundingClientRect().bottom);
              } else {
                const bg = cs.backgroundColor;
                if ((bg && bg !== 'rgba(0, 0, 0, 0)') || parseFloat(cs.borderTopWidth) > 0) {
                  b = Math.max(b, c.getBoundingClientRect().bottom);
                }
              }
              walk(c);
            }
          }
        };
        walk(el);
        return b;
      };

      const empties = [], imbalanced = [];
      let nSurfaces = 0, nHeads = 0;

      // 1 · painted surfaces with a tail of nothing under their own content
      document.querySelectorAll('div, section, article, aside, li').forEach(el => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.height < 160 || rect.width < 160) return;
        const bg = cs.backgroundColor;
        const painted = (bg && bg !== 'rgba(0, 0, 0, 0)') || parseFloat(cs.borderTopWidth) > 0;
        if (!painted) return;
        nSurfaces++;
        const ink = inkBottom(el);
        if (!isFinite(ink)) return;
        const tail = rect.bottom - ink - (parseFloat(cs.paddingBottom) || 0);
        if (tail > 120) empties.push({
          sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
               '.' + (el.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.'),
          tail: Math.round(tail), h: Math.round(rect.height),
        });
      });

      // 2 · two-column section heads whose columns end far apart
      document.querySelectorAll('.section-head').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display !== 'grid') return;
        if (cs.gridTemplateColumns.split(/\s+/).filter(Boolean).length < 2) return;
        const kids = [...el.children].filter(k => k.getBoundingClientRect().height > 8);
        if (kids.length < 2) return;
        nHeads++;
        const bots = kids.map(inkBottom).filter(isFinite);
        if (bots.length < 2) return;
        const spread = Math.max(...bots) - Math.min(...bots);
        if (spread > 200) imbalanced.push({
          sec: (el.closest('section') || {}).id || '?', spread: Math.round(spread),
        });
      });

      return { empties, imbalanced, nSurfaces, nHeads };
    });

    surfaces += r.nSurfaces; heads += r.nHeads;
    r.empties.forEach(e => fail('empty-surface', where,
      `${e.sel} is ${e.h}px tall and draws ${e.tail}px of empty box below its own last content`));
    r.imbalanced.forEach(e => fail('head-imbalance', where,
      `#${e.sec}: the two head columns end ${e.spread}px apart`));
    await ctx.close();
  }

  if (surfaces < 60) fail('empty-surface', 'coverage',
    `only ${surfaces} painted surface(s) examined over three widths`);
  if (heads < 12) fail('head-imbalance', 'coverage',
    `only ${heads} two-column section head(s) examined over three widths`);
  note(`dead space: ${surfaces} painted surfaces and ${heads} two-column heads measured ` +
       `at 1440/1280/1024, none drawing a box round nothing`);
}

// ---------------------------------------------------------------------------
// Two blocks in one section measuring to different widths.
//
// Every section on the landing puts its content inside a single .wrap, which is
// what gives the page one left edge and one right edge all the way down. The
// access-control screenshots were authored one closing </div> too late, so they
// sat OUTSIDE the wrap: at 1440 they drew 707px wide against the 587px of the
// steps immediately above them and ran their captions flat into the window
// edge. Nothing about that is visible in the source — the markup is well-formed
// and the CSS is correct — and every other check in this file passed while it
// was on the page: it is not an overflow (the block is inside the viewport),
// not a distorted image, and not a box drawn round nothing.
//
// The rule is structural, so it is checked structurally: a section's content
// lives in its .wrap. Deliberate full-bleed decoration opts out by NAME, so
// adding one is a decision someone writes down rather than a silent exemption.
// ---------------------------------------------------------------------------
async function checkColumnMeasure(browser, base) {
  let sections = 0, blocks = 0;

  for (const w of [1440, 1280, 1024, 768]) {
    const [ctx, page] = await ctxPage(browser, { viewport: { width: w, height: 900 } });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() =>
      document.querySelectorAll('.rv, .reveal, [data-reveal]').forEach(e => e.classList.add('in', 'is-in')));
    await page.waitForTimeout(400);
    const where = `index.html @${w}`;

    const r = await page.evaluate(() => {
      const escaped = [], out = { nSections: 0, nBlocks: 0 };
      document.querySelectorAll('section').forEach(sec => {
        const wrap = sec.querySelector(':scope > .wrap');
        if (!wrap) return;                       // section does not use the column model
        out.nSections++;
        const wr = wrap.getBoundingClientRect();
        [...sec.children].forEach(c => {
          if (c === wrap) return;
          if (c.hasAttribute('data-full-bleed')) return;   // declared decoration
          const cr = c.getBoundingClientRect();
          if (cr.width < 4 || cr.height < 4) return;
          if (getComputedStyle(c).display === 'none') return;
          out.nBlocks++;
          // Only a block that actually breaks the column is a defect; one that
          // happens to sit inside the measure is merely unusual markup.
          if (cr.left < wr.left - 2 || cr.right > wr.right + 2) {
            escaped.push({
              sec: sec.id || String(sec.className).slice(0, 20),
              el: c.tagName.toLowerCase() + '.' + String(c.className).trim().split(/\s+/)[0],
              got: `${Math.round(cr.left)}→${Math.round(cr.right)}`,
              want: `${Math.round(wr.left)}→${Math.round(wr.right)}`,
            });
          }
        });
      });
      return { escaped, ...out };
    });

    sections += r.nSections; blocks += r.nBlocks;
    r.escaped.forEach(e => fail('measure-escape', where,
      `#${e.sec}: ${e.el} spans ${e.got} while the section's column is ${e.want} — ` +
      `it is not inside the .wrap, so it measures to the viewport instead of the page`));
    await ctx.close();
  }

  // A structural rule checked over zero sections passes exactly like one that
  // works, so the section count is asserted rather than assumed.
  if (sections < 32) fail('measure-escape', 'coverage',
    `only ${sections} section-instances with a .wrap examined over four widths`);
  note(`column measure: ${sections} section-instances checked at 1440/1280/1024/768; ` +
       `${blocks} non-wrap block(s) examined, all inside the column`);
}

// ---------------------------------------------------------------------------
// Side-by-side columns that end nowhere near each other.
//
// "The gate still opens" stacked a phone shot, its caption, a status card and a
// footnote into the right-hand column of a two-column row, which made that
// column 1050px tall against the five-step sequence's 507px — more empty gutter
// beside the sequence than the sequence itself occupied. checkDeadSpace() could
// not see it: it only looks at PAINTED surfaces with a tail of nothing inside
// their own border, and at .section-head. Here neither column is painted and
// the emptiness is between siblings, not inside one.
//
// Ink is measured rather than boxes, and only rows whose children genuinely sit
// side by side (a shared top) are considered, so a stacked grid at a narrow
// width is not accused of anything. A deliberately ragged pair opts out by NAME
// — the status ledger is two lists of honestly different lengths and is
// supposed to end unevenly.
// ---------------------------------------------------------------------------
const MAX_COLUMN_SPREAD = 320;

async function checkColumnBalance(browser, base) {
  let rows = 0;

  for (const w of [1440, 1280, 1024]) {
    const [ctx, page] = await ctxPage(browser, { viewport: { width: w, height: 900 } });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() =>
      document.querySelectorAll('.rv, .reveal, [data-reveal]').forEach(e => e.classList.add('in', 'is-in')));
    await page.waitForTimeout(500);
    const where = `index.html @${w}`;

    const r = await page.evaluate((LIMIT) => {
      const inkBottom = (el) => {
        let b = -Infinity;
        const walk = n => {
          for (const c of n.childNodes) {
            if (c.nodeType === 3) {
              if (!c.textContent.trim()) continue;
              const rg = document.createRange(); rg.selectNodeContents(c);
              for (const rr of rg.getClientRects()) if (rr.height > 0) b = Math.max(b, rr.bottom);
            } else if (c.nodeType === 1) {
              const cs = getComputedStyle(c);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              if (/^(IMG|CANVAS|VIDEO|HR)$/.test(c.tagName) || c.tagName === 'svg') {
                b = Math.max(b, c.getBoundingClientRect().bottom);
              } else {
                const bg = cs.backgroundColor;
                if ((bg && bg !== 'rgba(0, 0, 0, 0)') || parseFloat(cs.borderTopWidth) > 0) {
                  b = Math.max(b, c.getBoundingClientRect().bottom);
                }
              }
              walk(c);
            }
          }
        };
        walk(el);
        return b;
      };

      const bad = []; let n = 0;
      document.querySelectorAll('div, section, ul, ol').forEach(el => {
        if (el.hasAttribute('data-ragged')) return;          // declared uneven by design
        const cs = getComputedStyle(el);
        if (cs.display !== 'grid' && cs.display !== 'flex') return;
        if (cs.display === 'flex' && cs.flexDirection.startsWith('column')) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 320 || rect.height < 260) return;
        const kids = [...el.children].filter(k => {
          const kr = k.getBoundingClientRect();
          return kr.height > 20 && kr.width > 20 && getComputedStyle(k).display !== 'none';
        });
        if (kids.length < 2) return;
        // Genuinely side by side: one row, sharing a top. A stacked grid at a
        // narrow width has many tops and must not be measured as a row.
        const tops = kids.map(k => Math.round(k.getBoundingClientRect().top));
        if (new Set(tops).size !== 1) return;
        const bots = kids.map(inkBottom).filter(isFinite);
        if (bots.length < 2) return;
        n++;
        const spread = Math.max(...bots) - Math.min(...bots);
        if (spread > LIMIT) {
          bad.push({
            sel: el.tagName.toLowerCase() + '.' + (String(el.className).trim().split(/\s+/)[0] || '?'),
            sec: (el.closest('section') || {}).id || '?',
            spread: Math.round(spread), h: Math.round(rect.height),
          });
        }
      });
      return { bad, n };
    }, MAX_COLUMN_SPREAD);

    rows += r.n;
    r.bad.forEach(e => fail('column-imbalance', where,
      `#${e.sec} ${e.sel}: the columns end ${e.spread}px apart in a ${e.h}px row — ` +
      `the short one is left beside a column of empty gutter`));
    await ctx.close();
  }

  if (rows < 12) fail('column-imbalance', 'coverage',
    `only ${rows} side-by-side row(s) examined over three widths`);
  note(`column balance: ${rows} side-by-side row-instances measured at 1440/1280/1024, ` +
       `none ending more than ${MAX_COLUMN_SPREAD}px apart`);
}

// ---------------------------------------------------------------------------
// Self-test: break each invariant on purpose and demand the check notices.
// A gate that has quietly stopped failing looks exactly like one that works.
//
// The mutations pick their targets from the page rather than naming selectors,
// so this file is portable across the suite's landing pages, which share no
// class names. A case whose mechanism the page does not use reports "n/a"
// rather than passing silently — an inapplicable check must not read as a
// working one.
// ---------------------------------------------------------------------------
async function selftest(browser, base) {
  const cases = ['img-distorted', 'both-themes-visible', 'text-too-small',
                 'h-overflow', 'screenshot-wrong-theme'];
  let allCaught = true;
  for (const name of cases) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.querySelectorAll('.rv,.reveal').forEach(e => e.classList.add('in', 'is-in')));
    await page.waitForTimeout(500);

    const applicable = await page.evaluate((which) => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 40; };
      if (which === 'img-distorted') {
        // Must be a DECODED image: the check skips anything with no intrinsic
        // size, so mutating a lazy image that has not loaded yet produces a
        // false MISSED rather than a real one.
        const im = [...document.querySelectorAll('img')]
          .filter(e => vis(e) && e.naturalWidth > 0 && e.naturalHeight > 0)
          .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
        if (!im) return false;
        // Squash it to a wrong ratio without changing its width. object-fit
        // must be forced to `fill` too: the check deliberately ignores skew
        // under cover/contain (those crop rather than stretch), so on a page
        // whose shots are cropped the mutation would be undetectable BY DESIGN
        // and this case would report a false MISSED.
        im.style.setProperty('object-fit', 'fill', 'important');
        im.style.setProperty('height', Math.round(im.getBoundingClientRect().width * 2) + 'px', 'important');
        im.style.setProperty('aspect-ratio', 'auto', 'important');
        return true;
      }
      if (which === 'text-too-small') {
        const p = [...document.querySelectorAll('main p, .pane p, section p, body p')]
          .find(e => e.textContent.trim().length > 40 && vis(e));
        if (!p) return false;
        p.style.setProperty('font-size', '9px', 'important');
        p.style.setProperty('text-transform', 'none', 'important');
        return true;
      }
      if (which === 'h-overflow') {
        // Straight onto <body>. The scan covers `body *`, and putting the
        // oversized element inside <main> is wrong wherever main is itself a
        // scroll container (envoir's reading pane): the check correctly treats
        // anything inside an overflow container as contained, so the mutation
        // could never be seen and the case reported a false MISSED.
        const host = document.body;
        const d = document.createElement('div');
        d.style.cssText = 'width:3000px;height:20px;background:red';
        host.appendChild(d);
        return true;
      }
      if (which === 'both-themes-visible') {
        if (!document.querySelector('.only-light, .shot-l') || !document.querySelector('.only-dark, .shot-d')) return false;
        document.querySelectorAll('.only-light, .shot-l, .only-dark, .shot-d')
          .forEach(e => e.style.setProperty('display', 'block', 'important'));
        return true;
      }
      if (which === 'screenshot-wrong-theme') {
        const swap = document.querySelectorAll('img[data-light][data-dark]');
        const pair = document.querySelector('.only-light, .shot-l') && document.querySelector('.only-dark, .shot-d');
        if (!swap.length && !pair) return false;
        swap.forEach(im => { im.removeAttribute('srcset'); im.src = im.getAttribute('data-light'); });
        if (pair) {
          document.querySelectorAll('.only-dark, .shot-d').forEach(e => e.style.setProperty('display', 'none', 'important'));
          document.querySelectorAll('.only-light, .shot-l').forEach(e => e.style.setProperty('display', 'block', 'important'));
        }
        return true;
      }
      return false;
    }, name);

    if (!applicable) {
      console.log(`  n/a      ${name} — this page does not use that mechanism`);
      await ctx.close();
      continue;
    }

    await page.waitForTimeout(400);
    const r = await inspect(page, { isDark: true });
    const caught =
      (name === 'img-distorted'       && r.imgs.some(i => i.skewPct > 1.5)) ||
      (name === 'both-themes-visible' && r.hiddenPairs.some(p => p.light > 0 && p.dark > 0)) ||
      (name === 'text-too-small'      && r.smallText.length > 0) ||
      (name === 'h-overflow'          && (r.overflow.docW > r.overflow.winW + 1 || r.overflow.bleed.length > 0)) ||
      (name === 'screenshot-wrong-theme' &&
         (r.themedShots.length > 0 || r.hiddenPairs.some(p => p.light > 0 && p.dark === 0)));
    console.log(`  ${caught ? 'caught  ' : 'MISSED  '} ${name}`);
    if (!caught) allCaught = false;
    await ctx.close();
  }

  // --- docs invariants -----------------------------------------------------
  // These run the real check functions against a mutated page and demand the
  // matching finding appears. A control run with no mutation goes first: if a
  // check fires on the UNBROKEN page its "caught" is meaningless, and this is
  // the false-positive guard that makes the rest of the phase load-bearing.
  const docCases = [
    { name: 'docs-footer', run: checkDocsLayout,
      inject: { js: "var f=document.createElement('footer');f.textContent='x';document.body.appendChild(f);" } },
    { name: 'sidebar-not-pinned', run: checkDocsLayout,
      inject: { css: '@media(min-width:1000px){#sideCol{position:static !important}}' } },
    { name: 'docs-shell-centred', run: checkDocsLayout,
      inject: { css: '@media(min-width:1000px){.shell{grid-template-columns:252px minmax(0,1fr) 208px !important;max-width:none !important}}' } },
    { name: 'hover-only-control', run: checkDocsLayout,
      inject: { css: '@media(hover:none){.cw-copy{color:transparent !important}}' } },
    { name: 'code-not-highlighted', run: checkDocs,
      inject: { js: "new MutationObserver(function(){document.querySelectorAll('code.hljs').forEach(function(c){c.classList.remove('hljs')})}).observe(document.documentElement,{childList:true,subtree:true});" } },
    { name: 'code-contrast', run: checkCodeContrast,
      inject: { css: 'code.hljs span[class*="hljs-"]{color:#2a2a2a !important}' } },

    // --- the affordance, broken in BOTH directions ------------------------
    // Suppressing it where it is needed and forcing it where it is not are
    // different bugs, and a check that only notices one of them is half a
    // check. The second case is what stops "always on" from grading clean.
    { name: 'figure-affordance', run: checkFigureAffordance,
      inject: { css: '.figscroll.is-scrollable .illo-hint{display:none !important}' } },
    { name: 'figure-affordance/always-on', run: checkFigureAffordance, expect: 'figure-affordance',
      inject: { css: '.figscroll .illo-hint{display:block !important}.figscroll .illo-fade{opacity:1 !important}' } },
    // and the end state: pin the class off so scrolling to the end changes
    // nothing, which is exactly what a stale listener would look like.
    { name: 'figure-affordance/never-ends', run: checkFigureAffordance, expect: 'figure-affordance',
      inject: { js: "new MutationObserver(function(){document.querySelectorAll('.figscroll.at-end').forEach(function(c){c.classList.remove('at-end')})}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class']});" } },

    // --- the halo, given a colour the surface is not ----------------------
    // The card paints itself with --il-bg, so overriding the token moves the
    // halo AND the surface together and breaks nothing. The mutation has to
    // move ONE of them — which is precisely the original defect: a card whose
    // background is not the colour its labels are outlined in.
    { name: 'label-halo', run: checkLabelHalos,
      inject: { css: '.illo,.how-illo{background:#ff00ff !important}' } },

    // --- the layouts that draw a box round nothing ------------------------
    // align-items:stretch is the exact declaration that was there: the mutation
    // is the bug, not an approximation of it.
    { name: 'empty-surface', run: checkDeadSpace,
      inject: { css: '@media(min-width:900px){.ledger{align-items:stretch !important}}' } },
    { name: 'head-imbalance', run: checkDeadSpace,
      inject: { css: '@media(min-width:1024px){.section-head>.lede{line-height:5.2 !important}}' } },

    // --- a block measuring to the viewport instead of the page --------------
    // The access-control shot pair sat outside its .wrap and drew full-bleed.
    // Re-parenting one block out of the wrap IS the bug, not a stand-in for it.
    { name: 'measure-escape', run: checkColumnMeasure,
      inject: { js: "var w=document.querySelector('#access .wrap');var p=w&&w.querySelector('.shot-pair');if(p)w.parentElement.appendChild(p);" } },

    // --- one column of a side-by-side row left far short of the other -------
    // Exactly the outage-section shape: the right column grows and the left is
    // stranded beside an empty gutter.
    // The check measures INK, so the mutation has to add ink: a tall margin
    // moves the box and nothing else, and grading that as "caught" would have
    // meant the check was passing on geometry it does not actually read.
    { name: 'column-imbalance', run: checkColumnBalance,
      inject: { js: "var s=document.querySelector('.off-grid > .off-side');if(s){var d=document.createElement('div');d.style.cssText='height:900px;border:1px solid #888;background:#eee';d.textContent='x';s.appendChild(d);}" } },
  ];

  const runIsolated = async (inject, fn) => {
    const before = findings.length;
    SELFTEST_INJECT = inject;
    try { await fn(browser, base); } catch (e) { console.log('   [threw] ' + String(e.message).split('\n')[0].slice(0, 200)); fail('selftest-threw', 'docs', String(e.message).slice(0, 120)); }
    SELFTEST_INJECT = null;
    const got = findings.splice(before).map(f => f.check);
    return got;
  };

  const control = await runIsolated(null, async (b, base) => {
    await checkDocsLayout(b, base);
    await checkCodeContrast(b, base);
    await checkFigureAffordance(b, base);
    await checkLabelHalos(b, base);
    await checkDeadSpace(b, base);
    await checkColumnMeasure(b, base);
    await checkColumnBalance(b, base);
  });
  if (control.length) {
    console.log(`  MISSED   control — the docs checks fire on the UNBROKEN page: ${[...new Set(control)].join(', ')}`);
    allCaught = false;
  } else {
    console.log('  caught   control — no docs check fires on the unbroken page');
  }

  for (const c of docCases) {
    const got = await runIsolated(c.inject, c.run);
    const hit = got.includes(c.expect || c.name);
    console.log(`  ${hit ? 'caught  ' : 'MISSED  '} ${c.name}` +
                (hit ? '' : `  (saw: ${[...new Set(got)].join(', ') || 'nothing'})`));
    if (!hit) allCaught = false;
  }

  return allCaught;
}

// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(join(SITE, 'index.html'))) {
    console.error(`check-render: no site/index.html under ${SITE}`);
    process.exit(2);
  }
  const server = await serve(SITE);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    if (process.argv.includes('--selftest')) {
      console.log('check-render self-test — each invariant is broken on purpose:\n');
      const ok = await selftest(browser, base);
      console.log(ok ? '\nSELF-TEST PASS — every check discriminates.'
                     : '\nSELF-TEST FAIL — a check did not notice its own defect.');
      process.exitCode = ok ? 0 : 1;
      return;
    }

    let sampled = 0;
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        for (const path of ['index.html', 'docs.html']) {
          const r = await checkPage(browser, base, path, theme, vp);
          sampled += r.imgs.length;
        }
      }
    }
    await checkCrossPageAnchors(browser, base);
    await checkDocs(browser, base);
    await checkDocsLayout(browser, base);
    await checkCodeContrast(browser, base);
    await checkFigureAffordance(browser, base);
    await checkLabelHalos(browser, base);
    await checkDeadSpace(browser, base);
    await checkColumnMeasure(browser, base);
    await checkColumnBalance(browser, base);

    console.log(`\nchecked ${VIEWPORTS.length} viewports × 2 themes × 2 pages; ` +
                `${sampled} rendered images measured\n`);
    notes.forEach(n => console.log('  · ' + n));

    if (findings.length) {
      console.error(`\ncheck-render: ${findings.length} finding(s)\n`);
      const byCheck = {};
      findings.forEach(f => (byCheck[f.check] ||= []).push(f));
      for (const [check, list] of Object.entries(byCheck)) {
        console.error(`  ${check} (${list.length})`);
        // Collapse the viewport dimension: the same defect at eight widths is
        // one defect, and printing it eight times buries the others.
        const seen = new Set();
        list.forEach(f => {
          const key = f.detail;
          if (seen.has(key)) return;
          seen.add(key);
          console.error(`    ${f.where}\n      ${f.detail}`);
        });
      }
      process.exitCode = 1;
    } else {
      console.log('\ncheck-render: clean');
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(2); });
