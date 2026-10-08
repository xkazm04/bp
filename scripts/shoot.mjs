#!/usr/bin/env node
// Screenshot + smoke-test harness for prototype pages.
//
//   node scripts/shoot.mjs <page.html> [--out <dir>] [--scenarios <file.json | inline JSON>]
//
// Without --scenarios it runs the default set: desktop light/dark and phone light/dark.
// A scenario file is a JSON array of scenarios:
//   [{ "name": "desk-dev", "viewport": [1440, 900], "colorScheme": "dark", "mobile": false,
//      "steps": [ { "wait": 400 }, { "shot": "overview" }, { "click": "[data-lens=dev]" }, { "shot": "dev" } ] }]
// Steps:
//   { "wait": ms }                      { "shot": "name" }               { "shot": "name", "fullPage": true }
//   { "click": "css selector" }         { "clickAt": [x, y] }            { "hover": "css selector" }
//   { "key": "Escape" }                 { "type": ["#search", "text"] }  { "wheel": [x, y, deltaY] }
//   { "drag": [[x1, y1], [x2, y2]] }    { "eval": "js expression" }      { "theme": "light" | "dark" }
//   { "viewport": [w, h] }
// Prints a JSON report: console errors, page errors, CSP-violating requests, horizontal overflow,
// eval results and the screenshot paths. Exit code 1 when the page throws or logs errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log('usage: node scripts/shoot.mjs <page.html> [--out <dir>] [--scenarios <file.json|json>]');
  process.exit(0);
}
const target = path.resolve(args[0]);
const opt = (name) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
};
const slug = path.basename(path.dirname(target));
const outDir = path.resolve(opt('--out') || path.join(ROOT, '.shots', slug));
fs.mkdirSync(outDir, { recursive: true });

const DEFAULT_SCENARIOS = [
  { name: 'desk-light', viewport: [1440, 900], colorScheme: 'light', steps: [{ wait: 600 }, { shot: 'overview' }] },
  { name: 'desk-dark', viewport: [1440, 900], colorScheme: 'dark', steps: [{ wait: 600 }, { shot: 'overview' }] },
  { name: 'phone-light', viewport: [390, 844], colorScheme: 'light', mobile: true, steps: [{ wait: 600 }, { shot: 'overview' }] },
  { name: 'phone-dark', viewport: [390, 844], colorScheme: 'dark', mobile: true, steps: [{ wait: 600 }, { shot: 'overview' }] },
];

let scenarios = DEFAULT_SCENARIOS;
const scenArg = opt('--scenarios');
if (scenArg) {
  const raw = fs.existsSync(scenArg) ? fs.readFileSync(scenArg, 'utf8') : scenArg;
  scenarios = JSON.parse(raw);
  if (!Array.isArray(scenarios)) scenarios = [scenarios];
}

// Hosts a published Artifact may load from (CSP). Anything else is flagged.
const ALLOWED = [/^https:\/\/cdnjs\.cloudflare\.com\//, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];
const D3_LOCAL = path.join(ROOT, 'node_modules', 'd3', 'dist', 'd3.min.js');

const browser = await chromium.launch();
const report = { page: path.relative(ROOT, target), outDir: path.relative(ROOT, outDir), scenarios: [] };
let failed = false;

for (const sc of scenarios) {
  const [w, h] = sc.viewport || [1440, 900];
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: sc.mobile ? 2 : 1,
    isMobile: !!sc.mobile,
    hasTouch: !!sc.mobile,
    colorScheme: sc.colorScheme || 'light',
    reducedMotion: sc.reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const rec = { name: sc.name, viewport: [w, h], colorScheme: sc.colorScheme || 'light', consoleErrors: [], pageErrors: [], blocked: [], shots: [], evals: [] };

  // The network policy here blocks cdnjs, so serve the pinned d3 build locally.
  await page.route(/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/d3\/7\.9\.0\/d3(\.min)?\.js$/, (route) =>
    route.fulfill({ path: D3_LOCAL, contentType: 'application/javascript' }),
  );
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    if (!ALLOWED.some((re) => re.test(u))) rec.blocked.push(u);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') rec.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)));

  await page.goto(pathToFileURL(target).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});

  for (const st of sc.steps || [{ wait: 600 }, { shot: 'overview' }]) {
    try {
      if ('wait' in st) await page.waitForTimeout(st.wait);
      else if ('shot' in st) {
        const file = path.join(outDir, `${sc.name}-${st.shot}.png`);
        await page.screenshot({ path: file, fullPage: !!st.fullPage });
        rec.shots.push(path.relative(ROOT, file));
      } else if ('click' in st) await page.click(st.click, { timeout: 3000 });
      else if ('clickAt' in st) await page.mouse.click(st.clickAt[0], st.clickAt[1]);
      else if ('hover' in st) await page.hover(st.hover, { timeout: 3000 });
      else if ('key' in st) await page.keyboard.press(st.key);
      else if ('type' in st) await page.fill(st.type[0], st.type[1], { timeout: 3000 });
      else if ('wheel' in st) {
        await page.mouse.move(st.wheel[0], st.wheel[1]);
        await page.mouse.wheel(0, st.wheel[2]);
      } else if ('drag' in st) {
        const [[x1, y1], [x2, y2]] = st.drag;
        await page.mouse.move(x1, y1);
        await page.mouse.down();
        await page.mouse.move(x2, y2, { steps: 12 });
        await page.mouse.up();
      } else if ('eval' in st) rec.evals.push({ expr: st.eval, value: await page.evaluate(st.eval) });
      else if ('theme' in st) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), st.theme);
      else if ('viewport' in st) await page.setViewportSize({ width: st.viewport[0], height: st.viewport[1] });
    } catch (e) {
      rec.pageErrors.push(`step ${JSON.stringify(st)} failed: ${String(e.message || e).split('\n')[0]}`);
    }
  }

  rec.layout = await page.evaluate(() => {
    const de = document.documentElement;
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    return {
      horizontalOverflow: de.scrollWidth > de.clientWidth + 1,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      bodyBackground: bodyBg,
      title: document.title,
    };
  });
  if (rec.layout.bodyBackground === 'rgba(0, 0, 0, 0)') rec.pageErrors.push('body background is transparent');
  if (rec.pageErrors.length || rec.consoleErrors.length) failed = true;
  report.scenarios.push(rec);
  await context.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
