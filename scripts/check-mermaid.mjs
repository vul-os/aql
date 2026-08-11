/**
 * aql docs/ diagram gate — renders every mermaid diagram in site/docs.html in a
 * real browser and measures what was actually painted.
 *
 * Why this exists as a separate gate: the defect it catches is invisible in the
 * source AND invisible to every static reading of the CSS. mermaid's default
 * useMaxWidth:true caps the svg at its natural width, so the browser scales the
 * whole drawing — glyphs included — down into whatever the column allows. The
 * declared font-size still reads 15px in the stylesheet and in
 * getComputedStyle; the painted glyph is 4px. Three sibling repos shipped that
 * bug on the same day in three different disguises, and in every one of them a
 * source review passed it. The only thing that catches it is measuring through
 * the screen CTM, which is what this file does.
 *
 * It also compares the PAINT of the expand-dialog's cloned svg against the
 * card's. That check earned its place the hard way: mermaid scopes its per-svg
 * <style> by the svg's id, so a clone that loses that id renders every shape in
 * SVG defaults — solid black fills, black-filled link paths — while every label
 * stays 15px and correctly coloured. No numeric assertion catches a silhouette.
 *
 * Each check states what it measured, not just pass/fail, so a green run is
 * evidence rather than an assertion. Run:
 *
 *   node scripts/check-mermaid.mjs                # serves site/ itself
 *   node scripts/check-mermaid.mjs --selftest     # prove the checks can fail
 */

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { resolve, dirname, extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(__dirname, '..', 'site');

/** Below this, a label is not being read, it is being squinted at. */
const MIN_PX = 12;

/** Chapters that carry a diagram. A chapter listed here and found bare fails:
 *  a diagram silently dropped from a chapter is exactly as bad as a broken one. */
const DIAGRAM_PAGES = [
  'architecture', 'channels', 'controllers', 'emergency-access',
  'limits', 'security', 'devices', 'ingress', 'linking-whatsapp',
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
    // Port 0: the OS picks a free one. Hard-coding a port collides with whatever
    // else is serving this directory, and a gate that measures the wrong server
    // is worse than one that does not run.
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

const failures = [];
const notes = [];
const fail = (kind, where, msg) => failures.push({ kind, where, msg });
const note = m => notes.push(m);

// ---------------------------------------------------------------------------
// Probes. Each returns raw measurements; the check* functions below turn those
// into failures. They are split so --selftest can drive the REAL check function
// over a deliberately broken page, rather than reimplementing the rule and
// proving only that the copy works.
// ---------------------------------------------------------------------------

/** Effective painted size of every diagram label, through the screen CTM.
 *  getComputedStyle is the wrong instrument here by construction: it reports the
 *  declared size, which stays correct while the drawing around it is scaled. */
const PROBE_LABELS = () => {
  const out = [];
  document.querySelectorAll('.doc .mermaid svg, .diagram-stage svg').forEach(svg => {
    const scaleOf = el => {
      const m = el.getScreenCTM();
      if (!m) return 1;
      // sqrt of |determinant| — the uniform scale the CTM applies, robust to
      // rotation and skew in a way that reading .a or .d alone is not.
      return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    };
    svg.querySelectorAll('text, tspan').forEach(t => {
      const s = (t.textContent || '').trim();
      if (!s) return;
      const declared = parseFloat(getComputedStyle(t).fontSize) || 0;
      if (!declared) return;
      out.push({ text: s.slice(0, 40), declared, effective: declared * scaleOf(t) });
    });
    // htmlLabels:true puts flowchart node labels in a foreignObject as real HTML.
    // The scale lives on the foreignObject; the font-size on the inner element.
    svg.querySelectorAll('foreignObject').forEach(fo => {
      const k = scaleOf(fo);
      fo.querySelectorAll('*').forEach(el => {
        if (el.children.length) return;                 // leaves only, no double count
        const s = (el.textContent || '').trim();
        if (!s) return;
        const declared = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (!declared) return;
        out.push({ text: s.slice(0, 40), declared, effective: declared * k });
      });
    });
  });
  return out;
};

function checkLabels(labels, where) {
  const out = [];
  if (!labels.length) {
    out.push({ kind: 'no-labels', where, msg: 'no measurable label text inside any diagram' });
    return out;
  }
  for (const l of labels) {
    if (l.effective < MIN_PX) {
      out.push({
        kind: 'label-too-small', where,
        msg: `“${l.text}” declared ${l.declared.toFixed(1)}px, PAINTED ${l.effective.toFixed(2)}px`,
      });
    }
  }
  return out;
}

const PROBE_DIAGRAMS = () => [...document.querySelectorAll('.doc .mermaid')].map(n => {
  const cs = getComputedStyle(n);
  const wrap = n.parentElement && n.parentElement.classList.contains('mermaid-wrap')
    ? n.parentElement : null;
  return {
    hasSvg: !!n.querySelector('svg'),
    stillSource: /^\s*(flowchart|graph|sequenceDiagram|stateDiagram)/.test((n.textContent || '').trim()),
    scrollW: n.scrollWidth, clientW: n.clientWidth, scrollLeft: n.scrollLeft,
    overflowX: cs.overflowX, justify: cs.justifyContent,
    expand: !!(wrap && wrap.querySelector('.mermaid-open')),
  };
});

function checkDiagrams(state, where) {
  const out = [];
  if (!state.length) {
    out.push({ kind: 'no-diagram', where, msg: 'chapter renders no .mermaid node at all' });
    return out;
  }
  state.forEach((s, i) => {
    const w = `${where} #${i + 1}`;
    if (!s.hasSvg) out.push({ kind: 'diagram-unpainted', where: w, msg: 'the .mermaid card holds no <svg> — mermaid did not paint it' });
    if (s.stillSource) out.push({ kind: 'diagram-source-visible', where: w, msg: 'the diagram source is showing as text' });
    if (!/auto|scroll/.test(s.overflowX)) out.push({ kind: 'diagram-not-pannable', where: w, msg: `overflow-x is “${s.overflowX}”` });
    // safe center, never plain center: text-align/margin-auto/justify-content:center
    // all centre by overhanging BOTH edges, and the left overhang sits before
    // scrollLeft:0 where no amount of scrolling can reach it.
    if (s.justify !== 'safe center') {
      out.push({
        kind: 'diagram-unsafe-centring', where: w,
        msg: `justify-content is “${s.justify}” — must be “safe center”, or the left overhang is unreachable`,
      });
    }
    const slack = s.scrollW - s.clientW;
    if (slack > 1) {
      if (s.scrollLeft < slack * 0.3) {
        out.push({
          kind: 'diagram-opens-on-margin', where: w,
          msg: `scrollLeft ${s.scrollLeft} of ${slack} slack — a flowchart draws its spine down the middle, so the reader opens on an empty margin`,
        });
      }
      if (!s.expand) out.push({ kind: 'diagram-no-expand', where: w, msg: 'overflows its card but offers no Expand control' });
    } else if (s.expand) {
      out.push({ kind: 'diagram-dead-expand', where: w, msg: 'offers an Expand control it does not need' });
    }
  });
  return out;
}

/** Geometric overflow. documentElement.scrollWidth is deliberately NOT consulted:
 *  with html,body{overflow-x:clip} that comparison passes vacuously while an
 *  element really is hanging past the edge. */
const PROBE_OVERFLOW = () => {
  const w = window.innerWidth, bleed = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.right <= w + 1 && r.left >= -1) return;
    let p = el.parentElement, clipped = false;
    while (p && p !== document.body) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) { clipped = true; break; }
      p = p.parentElement;
    }
    if (clipped) return;
    const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')
      .toString().trim().split(/\s+/)[0] || '-';
    bleed.push(`${el.tagName.toLowerCase()}.${cls} → ${Math.round(r.left)}..${Math.round(r.right)} of ${w}`);
  });
  return bleed.slice(0, 6);
};

/** The clone in the dialog must carry the same PAINT as the card, not merely the
 *  same text size. See the header note about id-scoped <style>. */
const PROBE_PAINT = () => {
  const grab = root => {
    if (!root) return null;
    const shape = root.querySelector('.node rect, .node polygon, .node path');
    const link = root.querySelector('path.flowchart-link, .edgePath path, path[class*="flowchart-link"]');
    const cs = shape && getComputedStyle(shape);
    const cl = link && getComputedStyle(link);
    return {
      fill: cs && cs.fill, stroke: cs && cs.stroke,
      linkFill: cl && cl.fill, linkStroke: cl && cl.stroke,
    };
  };
  return {
    card: grab(document.querySelector('.doc .mermaid svg')),
    dialog: grab(document.querySelector('.diagram-stage svg')),
  };
};

function checkPaint(paint, where) {
  const out = [];
  if (!paint.card || !paint.dialog) {
    out.push({ kind: 'expand-paint-unmeasured', where, msg: 'could not find a node shape in the card or the dialog' });
    return out;
  }
  for (const k of ['fill', 'stroke', 'linkFill', 'linkStroke']) {
    if (paint.card[k] && paint.dialog[k] !== paint.card[k]) {
      out.push({
        kind: 'expand-paint-lost', where,
        msg: `${k} is “${paint.dialog[k]}” in the dialog but “${paint.card[k]}” on the card — ` +
             `the clone lost mermaid's id-scoped <style> and is painting SVG defaults`,
      });
    }
  }
  if (/^rgb\(0, 0, 0\)/.test(paint.dialog.linkFill || '')) {
    out.push({ kind: 'expand-paint-lost', where, msg: 'link paths in the dialog are filled solid black' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoChapter(page, base, id) {
  await page.goto(`${base}/docs.html#/${id}`, { waitUntil: 'networkidle' });
  // Settle on EITHER outcome: painted svg, or the honest fallback docs.html
  // renders when the bundle fails to load. Waiting only for the svg meant a
  // missing bundle cost the full timeout on every chapter at every width — 36
  // loads, twelve minutes to report a failure it already knew about after the
  // first one. A gate nobody will wait for is a gate that gets skipped.
  await page.waitForFunction(() => {
    const n = [...document.querySelectorAll('.doc .mermaid')];
    if (n.length && n.every(d => d.querySelector('svg'))) return true;
    return !!document.querySelector('.doc .mermaid-fallback');
  }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);
}

/** Opens the expand dialog. Returns false rather than throwing when the control
 *  never appears: a diagram that failed to paint has no Expand button, and a
 *  raw Playwright timeout would abort the run with a stack trace *before* the
 *  failures already collected were printed — burying the actual diagnosis under
 *  a symptom of it. */
async function openDialog(page, base) {
  await gotoChapter(page, base, 'limits');
  const btn = await page.waitForSelector('.mermaid-open', { timeout: 8000 }).catch(() => null);
  if (!btn) return false;
  await btn.click();
  await page.waitForTimeout(400);
  return true;
}

// ---------------------------------------------------------------------------
// The real run
// ---------------------------------------------------------------------------

async function run(browser, base) {
  // 0 · the server under test is aql's. Every number below is meaningless if a
  //     different page answered, and that is a cheap mistake to make when more
  //     than one process serves this directory.
  {
    const page = await browser.newPage();
    await page.goto(`${base}/docs.html`, { waitUntil: 'networkidle' });
    const title = await page.title();
    if (!/aql/i.test(title)) {
      fail('wrong-server', base, `served <title> is “${title}” — not aql's`);
      await page.close();
      return;
    }
    note(`server: ${base} serving site/, docs.html <title> = “${title}”`);
    await page.close();
  }

  // 1 · zero off-origin requests. Vendored, never a CDN, and that is a checked
  //     property rather than a promise in a comment.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    const foreign = new Set();
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith(base + '/')) return;
      if (/^(data|blob|about):/.test(u)) return;
      foreign.add(u.slice(0, 120));
    });
    for (const id of DIAGRAM_PAGES) await gotoChapter(page, base, id);
    if (foreign.size) fail('off-origin', 'docs.html', [...foreign].join('\n      '));
    else note(`off-origin requests: 0 across ${DIAGRAM_PAGES.length} diagram chapters (allowed: ${base}, data:, blob:, about:)`);
    await ctx.close();
  }

  // 2 · every diagram, both themes, desktop and phone.
  let diagrams = 0;
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
      await ctx.addInitScript(t => { try { localStorage.setItem('aql.theme', t); } catch (e) {} }, theme);
      const page = await ctx.newPage();
      let minEff = Infinity, minWhere = '', measured = 0, scaled = 0;

      for (const id of DIAGRAM_PAGES) {
        const where = `docs#/${id} ${width}px ${theme}`;
        await gotoChapter(page, base, id);

        const state = await page.evaluate(PROBE_DIAGRAMS);
        checkDiagrams(state, where).forEach(f => failures.push(f));
        if (width === 1440 && theme === 'light') diagrams += state.length;

        const labels = await page.evaluate(PROBE_LABELS);
        checkLabels(labels, where).forEach(f => failures.push(f));
        for (const l of labels) {
          measured++;
          if (Math.abs(l.effective - l.declared) > 0.35) scaled++;
          if (l.effective < minEff) { minEff = l.effective; minWhere = `“${l.text}” in ${id}`; }
        }

        const bleed = await page.evaluate(PROBE_OVERFLOW);
        if (bleed.length) fail('h-overflow', where, bleed.join('\n      '));
      }

      if (measured < 100) fail('label-coverage', `${width}px ${theme}`, `only ${measured} labels measured; the probe is not reaching the diagrams`);
      note(`${width}px ${theme}: ${measured} labels measured, smallest PAINTED ${minEff.toFixed(2)}px (${minWhere}), ` +
           (scaled ? `${scaled} scaled away from their declared size` : 'none scaled away from its declared size'));
      await ctx.close();
    }
  }

  // 3 · Expand opens a full-size, correctly PAINTED diagram, and closes.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const opened = await openDialog(page, base);
    if (!opened) {
      fail('expand-missing', 'docs#/limits',
        'no Expand control appeared on a diagram that overflows its card — the dialog could not be exercised at all');
    } else {

    const open = await page.evaluate(() => {
      const d = document.querySelector('dialog.diagram-dialog');
      const stage = d && d.querySelector('.diagram-stage');
      return {
        isOpen: !!(d && d.open),
        hasSvg: !!(stage && stage.querySelector('svg')),
        justify: stage ? getComputedStyle(stage).justifyContent : null,
        align: stage ? getComputedStyle(stage).alignItems : null,
      };
    });
    if (!open.isOpen) fail('expand-dead', 'docs#/limits', 'clicking Expand opened no dialog');
    if (!open.hasSvg) fail('expand-empty', 'docs#/limits', 'the dialog opened with no diagram in it');
    if (open.justify !== 'safe center') fail('expand-unsafe-centring', 'docs#/limits', `stage justify-content is “${open.justify}”`);
    // align-items must not be stretch. The stage caps at 82vh, and an svg with a
    // viewBox honours preserveAspectRatio — so a stretched height scales the
    // WHOLE drawing, which is the tiny-label bug wearing a different hat.
    if (open.align === 'stretch' || open.align === 'normal') {
      fail('expand-stretched', 'docs#/limits',
        `stage align-items is “${open.align}” — the 82vh cap will scale the svg and shrink every glyph with it`);
    }

    const dl = await page.evaluate(PROBE_LABELS);
    const dmin = Math.min(...dl.map(l => l.effective));
    if (dmin < MIN_PX) fail('expand-label-too-small', 'docs#/limits', `smallest label in the dialog is ${dmin.toFixed(2)}px`);

    const paint = await page.evaluate(PROBE_PAINT);
    checkPaint(paint, 'docs#/limits').forEach(f => failures.push(f));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    if (!(await page.evaluate(() => !document.querySelector('dialog.diagram-dialog').open))) {
      fail('expand-wont-close', 'docs#/limits', 'Escape did not close the dialog');
    }
    note(`expand dialog: opens with the diagram, smallest label ${dmin.toFixed(2)}px, ` +
         `node fill ${paint.dialog && paint.dialog.fill} identical to the card, Escape closes it`);
    }
    await ctx.close();
  }

  // 4 · every heading reachable, every on-this-page anchor real.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    const manifest = JSON.parse(await readFile(join(SITE, 'docs', 'manifest.json'), 'utf8'));
    const pages = manifest.pages || manifest;
    const ids = (Array.isArray(pages) ? pages : Object.values(pages).flat()).map(p => p.id || p);
    let links = 0, ok = 0, heads = 0, withId = 0;
    for (const id of ids) {
      await page.goto(`${base}/docs.html#/${id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const hs = [...document.querySelectorAll('.doc h2, .doc h3')];
        const has = new Set(hs.map(h => h.id).filter(Boolean));
        const toc = [...document.querySelectorAll('.toc a[data-h]')].map(a => a.getAttribute('data-h'));
        return { heads: hs.length, withId: has.size, toc, good: toc.filter(t => has.has(t)).length };
      });
      heads += r.heads; withId += r.withId; links += r.toc.length; ok += r.good;
      if (r.heads !== r.withId) fail('heading-no-id', `docs#/${id}`, `${r.heads - r.withId} heading(s) carry no id`);
      if (r.toc.length !== r.good) fail('dead-nav-anchor', `docs#/${id}`, `${r.toc.length - r.good} on-this-page link(s) name no heading`);
      if (r.heads && !r.toc.length) fail('nav-empty', `docs#/${id}`, `${r.heads} headings but an empty on-this-page rail`);
    }
    note(`nav: ${ok}/${links} on-this-page anchors resolve to a real heading id; ` +
         `${withId}/${heads} headings across ${ids.length} chapters carry an id`);
    await ctx.close();
  }

  note(`${diagrams} diagram(s) across ${DIAGRAM_PAGES.length} chapters`);
}

// ---------------------------------------------------------------------------
// Self-test: break each invariant on purpose and demand the check notices.
//
// Every case drives the SAME check function the real run uses, over a page
// mutated to carry the defect. Reimplementing the rule here would only prove
// the copy works. A case whose mechanism the page does not use reports "n/a"
// rather than passing silently — an inapplicable check must never read as a
// working one.
// ---------------------------------------------------------------------------
async function selftest(browser, base) {
  const results = [];
  const record = (name, caught, detail) => results.push({ name, caught, detail });

  // a) the whole reason this file exists: a scaled-down drawing.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    await gotoChapter(page, base, 'architecture');
    const before = Math.min(...(await page.evaluate(PROBE_LABELS)).map(l => l.effective));
    // Exactly what useMaxWidth:true does: cap the svg and let the browser scale
    // the drawing, glyphs and all, into the column.
    await page.addStyleTag({ content: '.doc .mermaid svg{max-width:100% !important}' });
    await page.waitForTimeout(200);
    const after = await page.evaluate(PROBE_LABELS);
    const hits = checkLabels(after, 'selftest');
    const min = Math.min(...after.map(l => l.effective));
    record('label-too-small', hits.length > 0, `smallest label ${before.toFixed(2)}px → ${min.toFixed(2)}px`);
    await ctx.close();
  }

  // b) centring that hides the left of the drawing behind scrollLeft:0.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    await gotoChapter(page, base, 'architecture');
    await page.addStyleTag({ content: '.doc .mermaid{justify-content:center !important}' });
    await page.waitForTimeout(200);
    const hits = checkDiagrams(await page.evaluate(PROBE_DIAGRAMS), 'selftest');
    record('diagram-unsafe-centring', hits.some(h => h.kind === 'diagram-unsafe-centring'), 'justify-content forced to plain center');
    await ctx.close();
  }

  // c) a pannable card that opens on an empty margin.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    await gotoChapter(page, base, 'architecture');
    const applicable = await page.evaluate(() => {
      const n = document.querySelector('.doc .mermaid');
      if (!n || n.scrollWidth - n.clientWidth <= 1) return false;
      n.scrollLeft = 0;
      return true;
    });
    if (!applicable) record('diagram-opens-on-margin', null, 'n/a — no diagram overflows at this width');
    else {
      const hits = checkDiagrams(await page.evaluate(PROBE_DIAGRAMS), 'selftest');
      record('diagram-opens-on-margin', hits.some(h => h.kind === 'diagram-opens-on-margin'), 'scrollLeft forced to 0');
    }
    await ctx.close();
  }

  // d) the silhouette. Stripping the clone's id is precisely the defect that
  //    shipped: mermaid's <style> is scoped to it, so every rule stops matching.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    await openDialog(page, base);
    const applicable = await page.evaluate(() => {
      const s = document.querySelector('.diagram-stage svg');
      if (!s || !s.querySelector('style')) return false;
      s.removeAttribute('id');
      return true;
    });
    if (!applicable) record('expand-paint-lost', null, 'n/a — the dialog svg carries no scoped <style>');
    else {
      await page.waitForTimeout(200);
      const hits = checkPaint(await page.evaluate(PROBE_PAINT), 'selftest');
      record('expand-paint-lost', hits.some(h => h.kind === 'expand-paint-lost'), "the clone's id removed");
    }
    await ctx.close();
  }

  // e) a single off-origin request.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const foreign = new Set();
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith(base + '/') || /^(data|blob|about):/.test(u)) return;
      foreign.add(u);
    });
    await gotoChapter(page, base, 'architecture');
    await page.evaluate(() => {
      const i = new Image();
      i.src = 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js';
    });
    await page.waitForTimeout(600);
    record('off-origin', foreign.size > 0, `${foreign.size} foreign request(s) seen`);
    await ctx.close();
  }

  // f) horizontal bleed straight onto <body>, so nothing can clip it.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    await gotoChapter(page, base, 'architecture');
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.cssText = 'width:3000px;height:20px;background:red';
      document.body.appendChild(d);
    });
    const bleed = await page.evaluate(PROBE_OVERFLOW);
    record('h-overflow', bleed.length > 0, `${bleed.length} bleeding element(s) seen`);
    await ctx.close();
  }

  let bad = 0;
  for (const r of results) {
    if (r.caught === null) { console.log(`  ~ n/a     ${r.name} — ${r.detail}`); continue; }
    if (r.caught) console.log(`  ✓ caught  ${r.name} — ${r.detail}`);
    else { console.log(`  ✗ MISSED  ${r.name} — ${r.detail}`); bad++; }
  }
  const live = results.filter(r => r.caught !== null).length;
  console.log('');
  if (bad) {
    console.log(`check-mermaid --selftest: ${bad} of ${live} mutation(s) went unnoticed — the gate is not checking what it claims`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-mermaid --selftest: all ${live} mutations caught`);
}

// ---------------------------------------------------------------------------

async function main() {
  const isSelftest = process.argv.includes('--selftest');
  const server = await serve(SITE);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    if (isSelftest) await selftest(browser, base);
    else await run(browser, base);
  } finally {
    await browser.close();
    server.close();
  }

  if (isSelftest) return;

  notes.forEach(n => console.log('  · ' + n));
  if (failures.length) {
    console.log('\ncheck-mermaid: FAIL\n');
    for (const f of failures) console.log(`  ✗ ${f.kind}  ${f.where}\n      ${f.msg}`);
    process.exitCode = 1;
    return;
  }
  console.log('\ncheck-mermaid: clean');
}

main().catch(e => { console.error(e); process.exit(1); });
