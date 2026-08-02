import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-pc-code-vulos/30a4ff9a-64f9-49d2-acb8-d1200d9c5c96/scratchpad/shots';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const jobs = JSON.parse(args[0]);
const b = await chromium.launch();
for (const j of jobs) {
  const ctx = await b.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(j.url, { waitUntil: 'networkidle' });
  if (j.theme) await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), j.theme);
  if (j.scroll) await p.evaluate(y => window.scrollTo(0, y), j.scroll);
  await p.waitForTimeout(j.wait ?? 700);
  await p.screenshot({ path: `${OUT}/${j.name}.png`, fullPage: !!j.full });
  await ctx.close();
}
await b.close();
console.log('shots done');
