#!/usr/bin/env node
// Integration and speed check for any page that mounts the Orbit kit (the kit demo or a round 2 variant).
//
//   node scripts/kit-check.mjs <page.html> [--width 1440 --height 900]      (npm run kit-check -- <page.html>)
//
// Drives the mounted shell (OK.shell) through the real data: every primitive on every feature, every block on
// every node, every lens, every filter, every inspector, and the feature page of every feature in all three
// tabs, with the page's own event listeners attached, so a variant's repaint code runs too. It also checks
// the declarative data-ok-* hooks, the gate decisions and the round 2 polish hooks (product inspector, select
// source, legend state, layout-free inspector hints, external theme changes). Prints the timings and exits 1 when anything throws,
// logs an error, or a lens change, a filter change or a feature page (95th percentile) takes longer than its budget.
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log('usage: node scripts/kit-check.mjs <page.html> [--width 1440 --height 900]');
  process.exit(0);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : def;
};
const target = path.resolve(args[0]);
const W = +opt('--width', 1440);
const H = +opt('--height', 900);
// Budgets for the JS work of one change (kit plus the page's listeners), at full CPU speed.
const BUDGET = { lens: 40, filter: 60, page: 60 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 3).join(' | ')));
await page.goto(pathToFileURL(target).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await page.waitForTimeout(300);

const r = await page.evaluate(async () => {
  const out = { fails: [], t: {}, events: {} };
  const fail = (what, e) => out.fails.push(what + ': ' + (e && e.message ? e.message : e));
  const frame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
  const time = (fn) => { const t0 = performance.now(); try { fn(); } catch (e) { fail('call', e); } return performance.now() - t0; };
  const sh = window.OK && window.OK.shell;
  if (!sh) { out.fails.push('OK.shell is not mounted'); return out; }
  ['lens', 'view', 'filter', 'select', 'locate', 'theme', 'feature-open', 'feature-close', 'inspector', 'legend'].forEach((ev) => sh.on(ev, () => { out.events[ev] = (out.events[ev] || 0) + 1; }));
  const BP = window.BP, OK = window.OK;

  // Primitives and blocks.
  try {
    BP.features.forEach((f) => {
      OK.html.corona(f, 40, { lens: 'dev' });
      OK.lenses().forEach((l) => { const x = BP.rating(f, l.id); OK.html.rating(x, { size: 'sm' }); OK.html.rating(x, { size: 'md', label: l.label }); OK.html.rating(x, { size: 'lg' }); });
      OK.html.releaseChip(f); OK.html.statusChip(f.status); BP.gates(f).forEach((g) => OK.html.gateChip(g));
    });
    const refs = [{ type: 'product' }].concat(BP.areas.map((a) => ({ type: 'area', id: a.id })), BP.domains.map((d) => ({ type: 'domain', id: d.id })), BP.modules.map((m) => ({ type: 'module', id: m.id })));
    refs.forEach((ref) => { OK.blocks.ratingTable(ref); OK.blocks.statusBar(OK.nodeRollup(ref)); OK.blocks.featureList(OK.nodeFeatures(ref), { path: true }); OK.blocks.gates(OK.nodeFeatures(ref)); });
    BP.releases.forEach((x) => OK.blocks.releasePackage(x.id));
  } catch (e) { fail('primitives and blocks', e); }

  // Lenses, then filters (each with the page's listeners).
  const lens = [];
  for (const l of ['dev', 'ops', 'biz', 'sec', 'comp', 'ux', 'cost', 'overall']) { lens.push(time(() => sh.setLens(l))); await frame(); }
  const filters = {};
  const f = async (name, fn) => { filters[name] = time(fn); await frame(); };
  for (const s of BP.STATUS_ORDER) await f('status ' + s, () => sh.setStatuses([s]));
  await f('clear', () => sh.clearFilters());
  for (const ini of BP.initiatives) await f('initiative ' + ini.id, () => sh.setInitiative(ini.id));
  await f('initiative off', () => sh.setInitiative(null));
  for (const g of ['any', 'triage', 'approval', 'changes']) await f('gates ' + g, () => sh.setGates(g));
  await f('gates off', () => sh.setGates(null));
  await f('attention', () => sh.setAttention(true));
  await f('attention off', () => sh.setAttention(false));
  for (const q of ['c', 'ch', 'checkout', 'card payments', 'zzz', '']) await f('query "' + q + '"', () => sh.setQuery(q));
  out.t.lensMax = Math.max(...lens);
  out.t.filterMax = Math.max(...Object.values(filters));
  out.t.filterSlowest = Object.entries(filters).sort((a, b) => b[1] - a[1])[0][0];

  // Inspectors.
  out.t.peekAvg = time(() => BP.features.forEach((x) => sh.peek(x.id))) / BP.features.length;
  out.t.inspectAvg = time(() => [...BP.areas.map((a) => ['area', a.id]), ...BP.domains.map((d) => ['domain', d.id]), ...BP.modules.map((m) => ['module', m.id]), ...BP.releases.map((x) => ['release', x.id])].forEach(([type, id]) => sh.inspect({ type, id }))) / (BP.areas.length + BP.domains.length + BP.modules.length + BP.releases.length);
  sh.inspect({ type: 'area', id: BP.areas[0].id });
  out.t.lensWithAreaInspector = time(() => sh.setLens('sec'));
  sh.setLens('overall');
  sh.select(null);
  let closed = 0;
  sh.inspector.open({ kicker: 'K', title: 'T', body: '<p>B</p>', onClose: () => { closed += 1; } });
  sh.inspector.close();
  if (closed !== 1) fail('custom inspector onClose', closed);

  // The feature page of every feature, in every tab.
  const pages = [];
  for (const x of BP.features) {
    for (const tab of ['overview', 'work', 'ledger']) {
      pages.push(time(() => sh.openFeature(x.id, tab)));
      const panel = document.querySelector('.ok-page [data-ok-panel="' + tab + '"]');
      if (!panel || panel.hidden) fail('feature page ' + x.id, tab + ' panel not shown');
    }
  }
  sh.closeFeature();
  pages.sort((a, b) => a - b);
  out.t.pageMedian = pages[Math.floor(pages.length / 2)];
  out.t.pageP95 = pages[Math.floor(pages.length * 0.95)];
  out.t.pageMax = pages[pages.length - 1]; // a few thousand opens in a row: the max includes garbage-collection pauses

  // Gate decisions and the ledger filters on a feature with gates.
  const gf = BP.features.find((x) => BP.gates(x).some((g) => g.kind === 'triage')) || BP.features[0];
  sh.openFeature(gf.id, 'work');
  const click = (sel) => { const el = document.querySelector(sel); if (el) el.click(); else fail('missing control', sel); };
  click('[data-ok-triage$=":backlog"]');
  const ag = BP.features.find((x) => BP.gates(x).some((g) => g.kind === 'approval'));
  sh.openFeature(ag.id, 'work');
  click('[data-ok-approve]');
  sh.openFeature(ag.id, 'ledger');
  document.querySelectorAll('[data-ok-lf-lens]').forEach((b) => { const el = document.querySelector('[data-ok-lf-lens="' + b.getAttribute('data-ok-lf-lens') + '"]'); if (el) el.click(); });
  sh.closeFeature();

  // Declarative hooks.
  const host = document.createElement('div');
  host.innerHTML = '<button data-ok-peek="' + BP.features[1].id + '"></button><button data-ok-open="' + BP.features[2].id + '" data-ok-tab="ledger"></button><button data-ok-inspect="domain:' + BP.domains[0].id + '"></button><button data-ok-setlens="ux"></button>';
  sh.mapEl.appendChild(host);
  host.children[0].click(); if (!sh.state.selection || sh.state.selection.id !== BP.features[1].id) fail('data-ok-peek', JSON.stringify(sh.state.selection));
  host.children[1].click(); if (!sh.state.page || sh.state.page.tab !== 'ledger') fail('data-ok-open', JSON.stringify(sh.state.page));
  sh.closeFeature();
  host.children[2].click(); if (!sh.state.selection || sh.state.selection.type !== 'domain') fail('data-ok-inspect', JSON.stringify(sh.state.selection));
  host.children[3].click(); if (sh.state.lens !== 'ux') fail('data-ok-setlens', sh.state.lens);
  host.remove();
  sh.setLens('overall'); sh.select(null);
  sh.setView('timeline'); sh.setView('map');

  // Product inspector (API and markup) and the select payload's source.
  const sels = [];
  const offSel = sh.on('select', (p) => sels.push(p));
  const lastSel = () => sels[sels.length - 1];
  out.t.productInspect = time(() => sh.inspect({ type: 'product' }));
  if (!sh.state.selection || sh.state.selection.type !== 'product' || !sh.state.selection.id) fail('inspect product', JSON.stringify(sh.state.selection));
  if (!sh.inspector.isOpen() || !document.querySelector('.ok-insp .ok-rtable') || !document.querySelector('.ok-insp .ok-gsum')) fail('inspect product', 'standard product inspector not shown');
  if (!lastSel() || lastSel().type !== 'product' || lastSel().source !== 'variant') fail('select source, API', JSON.stringify(lastSel()));
  if ('source' in sh.state.selection) fail('state.selection', 'must stay { type, id }');
  out.t.lensWithProductInspector = time(() => sh.setLens('dev'));
  if (!document.querySelector('.ok-insp .ok-rtable tr.is-current [data-ok-setlens="dev"]')) fail('product inspector', 'not re-rendered for the lens');
  sh.setLens('overall');
  sh.select(null);
  if (sh.inspector.isOpen()) fail('select(null)', 'product inspector still open');
  const host2 = document.createElement('div');
  host2.innerHTML = '<button data-ok-inspect="product"></button><button data-ok-inspect="product:"></button>';
  sh.mapEl.appendChild(host2);
  for (const b of Array.from(host2.children)) {
    b.click();
    if (!sh.state.selection || sh.state.selection.type !== 'product') fail(b.outerHTML, JSON.stringify(sh.state.selection));
    else if (!lastSel() || lastSel().source !== 'variant') fail(b.outerHTML + ' source', JSON.stringify(lastSel()));
    sh.select(null);
  }
  host2.remove();
  sh.inspect({ type: 'area', id: BP.areas[0].id });
  const inspRow = document.querySelector('.ok-insp [data-ok-peek]');
  if (!inspRow) fail('area inspector', 'no feature row');
  else { inspRow.click(); if (!lastSel() || lastSel().type !== 'feature' || lastSel().source !== 'inspector') fail('select source, inspector row', JSON.stringify(lastSel())); }
  sh.select(null);
  sh.openFeature(BP.features[4].id);
  click('.ok-page .ok-crumb [data-ok-inspect^="module:"]');
  if (!lastSel() || lastSel().type !== 'module' || lastSel().source !== 'page') fail('select source, feature page breadcrumb', JSON.stringify(lastSel()));
  sh.select(null);
  sh.setQuery('checkout');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  const sr = document.querySelector('.ok-search__results [data-ok-sr]');
  if (!sr) fail('search', 'no result rows');
  else { sr.click(); if (!lastSel() || lastSel().source !== 'search') fail('select source, search', JSON.stringify(lastSel())); }
  sh.setQuery('');
  sh.select(null);
  offSel();

  // Layout-free inspector hints: the event's width/sheet and freeRectHint() against the measured freeRect().
  const phone = sh.isPhone();
  const tok = (n) => parseFloat(getComputedStyle(sh.root).getPropertyValue(n));
  const ins = [];
  const offIns = sh.on('inspector', (p) => ins.push({ open: p.open, width: p.width, sheet: p.sheet }));
  if (sh.inspector.isOpen()) sh.inspector.close();
  await frame();
  const near = (a, b) => Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2;
  let hint = sh.freeRectHint(), real = sh.freeRect();
  if (!near(hint, real)) fail('freeRectHint, closed', JSON.stringify({ hint, real }));
  sh.peek(BP.features[5].id);
  await frame();
  hint = sh.freeRectHint(); real = sh.freeRect();
  if (!near(hint, real)) fail('freeRectHint, open', JSON.stringify({ hint, real }));
  const pOpen = ins[ins.length - 1];
  const wantOpen = phone ? { width: 0, sheet: tok('--ok-insp-sheet') } : { width: tok('--ok-insp-w'), sheet: 0 };
  if (!pOpen || !pOpen.open || pOpen.width !== wantOpen.width || pOpen.sheet !== wantOpen.sheet) fail('inspector payload, open', JSON.stringify({ got: pOpen, want: wantOpen }));
  sh.select(null);
  const pClosed = ins[ins.length - 1];
  if (!pClosed || pClosed.open || pClosed.width !== 0 || pClosed.sheet !== 0) fail('inspector payload, closed', JSON.stringify(pClosed));
  out.freeRectHint = { open: hint, measured: real };
  offIns();

  // Legend state hook: class and event on desktop; phones use the modal menu sheet (no class, no event).
  const lg = [];
  const offLg = sh.on('legend', (p) => lg.push(p));
  sh.legend.toggle(true);
  if (phone) { if (sh.root.classList.contains('ok-has-legend') || lg.length) fail('legend on a phone', JSON.stringify(lg)); }
  else {
    if (!sh.root.classList.contains('ok-has-legend') || !sh.legend.isOpen()) fail('legend open', 'no ok-has-legend');
    if (!lg[0] || lg[0].open !== true || lg[0].width !== tok('--ok-legend-w')) fail('legend event, open', JSON.stringify(lg[0]));
  }
  sh.legend.toggle(false);
  if (!phone && (sh.root.classList.contains('ok-has-legend') || !lg[1] || lg[1].open !== false || lg.length !== 2)) fail('legend event, closed', JSON.stringify(lg));
  offLg();

  // External theme changes: <html data-theme> set or removed outside the shell; the kit's own setTheme emits once.
  if (sh.state.theme !== 'light') { sh.setTheme('light'); await frame(); }
  const th = [];
  const offTh = sh.on('theme', (p) => th.push(p.theme + (p.dark ? '/dark' : '/light')));
  let stored0 = null;
  try { stored0 = localStorage.getItem('orbit-kit.theme'); } catch (e) { /* storage unavailable */ }
  document.documentElement.setAttribute('data-theme', 'dark');
  await frame();
  if (sh.state.theme !== 'dark' || !sh.isDark() || th.join() !== 'dark/dark') fail('external theme, set dark', sh.state.theme + ' ' + th.join());
  document.documentElement.removeAttribute('data-theme');
  await frame();
  if (sh.state.theme !== 'light' || sh.isDark() || th.join() !== 'dark/dark,light/light') fail('external theme, removed', sh.state.theme + ' ' + th.join());
  let stored1 = null;
  try { stored1 = localStorage.getItem('orbit-kit.theme'); } catch (e) { /* storage unavailable */ }
  if (stored1 !== stored0) fail('external theme', 'was saved to localStorage');
  sh.setTheme('dark');
  await frame();
  sh.setTheme('light');
  await frame(); await frame();
  if (th.join() !== 'dark/dark,light/light,dark/dark,light/light') fail('setTheme must emit once per call', th.join());
  if (document.documentElement.getAttribute('data-theme') !== 'light') fail('setTheme', 'did not write data-theme');
  offTh();
  out.domNodes = document.getElementsByTagName('*').length;
  return out;
});
await browser.close();

const ms = (x) => (x == null ? '–' : x.toFixed(1) + ' ms');
console.log(`kit-check ${path.relative(process.cwd(), target)} at ${W}x${H}`);
console.log(`  lens switch       max ${ms(r.t.lensMax)}  (budget ${BUDGET.lens} ms, kit + page listeners)`);
console.log(`  filter change     max ${ms(r.t.filterMax)}  (${r.t.filterSlowest}; budget ${BUDGET.filter} ms)`);
console.log(`  lens, inspector   ${ms(r.t.lensWithAreaInspector)} with an area inspector open`);
console.log(`  peek / inspect    ${ms(r.t.peekAvg)} / ${ms(r.t.inspectAvg)} average`);
console.log(`  product inspector ${ms(r.t.productInspect)}, lens switch with it open ${ms(r.t.lensWithProductInspector)}`);
if (r.freeRectHint) console.log(`  free rect, open   hint ${r.freeRectHint.open.w}x${r.freeRectHint.open.h} · measured ${r.freeRectHint.measured.w}x${r.freeRectHint.measured.h}`);
console.log(`  feature page      median ${ms(r.t.pageMedian)}, 95th percentile ${ms(r.t.pageP95)} (budget ${BUDGET.page} ms), max ${ms(r.t.pageMax)}`);
console.log(`  events            ${Object.entries(r.events || {}).map(([k, v]) => k + ' ' + v).join(' · ')}`);
console.log(`  DOM               ${r.domNodes} elements`);
const problems = [...(r.fails || []), ...errors];
if (r.t.lensMax > BUDGET.lens) problems.push(`lens switch took ${ms(r.t.lensMax)} (budget ${BUDGET.lens} ms)`);
if (r.t.filterMax > BUDGET.filter) problems.push(`filter change took ${ms(r.t.filterMax)} (budget ${BUDGET.filter} ms)`);
if (r.t.pageP95 > BUDGET.page) problems.push(`feature page took ${ms(r.t.pageP95)} at the 95th percentile (budget ${BUDGET.page} ms)`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  problems.slice(0, 40).forEach((x) => console.error('  - ' + x));
  process.exit(1);
}
console.log('\n✓ Kit check passed.');
