// check:switcher - the header's project switcher is a portfolio glance and switches in place (card app-shell:B).
// The rows come from apps/web/src/lib/scan/switcher.ts (pure): each says how many proposals wait for review and
// when the product was last scanned, the closed trigger counts the proposals waiting in the OTHER projects, and
// choosing one opens it through switchProduct (pushState + bp:switch-product: BlueprintApp rebuilds the engine with
// no reload) instead of location.assign.
//   1  a measured row: waiting 3, words "3 proposals · scanned 2 h ago", accessible name with "3 proposals waiting"
//   2  an unreadable store (proposals null): no count, never "0 proposals" (unknown is not zero)
//   3  triggerAttention counts only other projects; 0 elsewhere -> null (no badge)
//   4  switchPlan(b, 'a') -> {go:'b'}; switchProduct pushes ?product=b and dispatches bp:switch-product; source guard:
//      ProjectSwitcher's choose calls switchProduct and no location.assign is left in it
//   5  guard: a row that cannot be drawn (off) does not open
//   6  guard: the current row closes the menu
//   7  guard: Kettle -> {go:null}; projectHref(null) drops ?product, the hash and ?morning, keeps the rest
// Run: node scripts/check-switcher.ts   (Node's type stripping). Exit 1 on any failed case.
import fs from 'node:fs';
import path from 'node:path';
import { readStripped } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
const failures: string[] = [];
const cases: [string, () => void][] = [];
const test = (name: string, fn: () => void) => cases.push([name, fn]);
const expect = (ok: boolean, what: string) => { if (!ok) throw new Error(what); };

// a browser-ish global for projects.ts (switchProduct / projectHref read location, history and dispatchEvent)
const events: { type: string; detail: unknown }[] = [];
let pushed: string | null = null, assigned: string | null = null;
const loc = { href: 'http://bp.test/v/shaped?product=a&theme=light&morning=c1#f:auth', origin: 'http://bp.test', assign: (u: string) => { assigned = u; } };
const g = globalThis as unknown as Record<string, unknown>;
g.location = loc;
g.history = { pushState: (_s: unknown, _t: string, u: string) => { pushed = u; loc.href = 'http://bp.test' + u; } };
g.dispatchEvent = (e: { type: string; detail: unknown }) => { events.push({ type: e.type, detail: e.detail }); return true; };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let S: any = {}, P: any = {};
try { S = await import('../apps/web/src/lib/scan/switcher.ts'); } catch (e) { failures.push('switcher.ts does not load: ' + (e as Error).message.split('\n')[0]); }
try { P = await import('../apps/web/src/lib/scan/projects.ts'); } catch (e) { failures.push('projects.ts does not load: ' + (e as Error).message.split('\n')[0]); }

const H = 3600000, now = Date.parse('2026-11-07T12:00:00Z');
const R = (p: Record<string, unknown> = {}) => ({ rootExists: true, map: true, mapVersion: 3, events: false, store: true, features: 4, lenses: 3, measuredFacets: 9, proposals: 0, lastRunAt: null, ...p });
const PROD = (slug: string, r: Record<string, unknown> = {}) => ({ slug, name: slug.toUpperCase(), root: '/r/' + slug, live: true, readiness: R(r) });
const items = (list: unknown[], current: string | null) => S.switcherItems(list, current, now) as { slug: string | null; waiting: number | null; facts: string | null; aria: string; off?: boolean }[];
const row = (list: unknown[], slug: string | null, current: string | null = null) => items(list, current).find((x) => x.slug === slug)!;

test('1 a measured row says how many proposals wait and when it was scanned', () => {
  const it = row([PROD('a', { proposals: 3, lastRunAt: new Date(now - 2 * H).toISOString() })], 'a');
  expect(!!it, 'no item for a');
  expect(it.waiting === 3, 'waiting is ' + it.waiting + ', not 3');
  expect(it.facts === '3 proposals · scanned 2 h ago', 'the row says ' + JSON.stringify(it.facts));
  expect(/3 proposals waiting/.test(it.aria), 'the accessible name ' + JSON.stringify(it.aria) + ' does not say "3 proposals waiting"');
  expect(/^A\b/.test(it.aria), 'the accessible name does not start with the project name');
  const one = row([PROD('a', { proposals: 1, lastRunAt: new Date(now - 2 * H).toISOString() })], 'a');
  expect(one.facts === '1 proposal · scanned 2 h ago', 'one proposal reads ' + JSON.stringify(one.facts));
});

test('2 an unreadable store has no count, never "0 proposals"', () => {
  const it = row([PROD('a', { proposals: null, store: false, measuredFacets: 0, lastRunAt: null })], 'a');
  expect(it.waiting === null, 'waiting is ' + it.waiting + ', not null');
  expect(!/0 proposals/.test(String(it.facts)) && !/0 proposals/.test(it.aria), 'unknown reads as zero: ' + JSON.stringify([it.facts, it.aria]));
  expect(!/proposals? waiting/.test(it.aria), 'an unknown count is announced as waiting work');
  const z = row([PROD('a', { proposals: 0, lastRunAt: new Date(now - 2 * H).toISOString() })], 'a');
  expect(z.waiting === 0 && !/proposals? waiting/.test(z.aria), 'zero proposals are announced as waiting work');
  const k = row([], null);
  expect(!!k && k.waiting === null && !k.facts, 'the Kettle sample row carries scan facts');
});

test('3 the trigger counts proposals waiting in the other projects only', () => {
  const list = [PROD('a', { proposals: 3 }), PROD('b', { proposals: 2 }), PROD('c', { proposals: 0 }), PROD('d', { proposals: null })];
  const t = S.triggerAttention(list, 'a');
  expect(!!t && t.n === 2 && t.projects === 1, 'triggerAttention says ' + JSON.stringify(t) + ', not {n:2, projects:1}');
  expect(S.triggerAttention([PROD('a', { proposals: 3 }), PROD('c', { proposals: 0 })], 'a') === null, 'a badge with nothing waiting elsewhere');
  expect(S.triggerAttention(null, 'a') === null, 'a badge before the list answered');
  const k = S.triggerAttention(list, null);
  expect(!!k && k.n === 5 && k.projects === 2, 'from Kettle every product is another project: ' + JSON.stringify(k));
});

test('4 choosing another project switches in place', () => {
  const list = [PROD('a'), PROD('b')];
  const plan = S.switchPlan(row(list, 'b', 'a'), 'a');
  expect(plan && typeof plan === 'object' && plan.go === 'b', 'switchPlan(b, a) is ' + JSON.stringify(plan));
  events.length = 0; pushed = null; assigned = null;
  P.switchProduct('b');
  expect(pushed === '/v/shaped?product=b&theme=light', 'switchProduct pushed ' + JSON.stringify(pushed));
  expect(assigned === null, 'switchProduct reloaded the page');
  expect(events.length === 1 && events[0].type === P.SWITCH_EVENT && P.SWITCH_EVENT === 'bp:switch-product', 'no bp:switch-product event: ' + JSON.stringify(events));
  const src = readStripped(path.join(SRC, 'components/ProjectSwitcher.tsx'));
  expect(!/location\.assign/.test(src), 'ProjectSwitcher.tsx still calls location.assign');
  expect(/switchProduct\(\s*plan\.go\s*\)/.test(src), 'ProjectSwitcher.tsx does not open the chosen project with switchProduct(plan.go)');
  expect(/switchPlan\(/.test(src) && /switcherItems\(/.test(src) && /triggerAttention\(/.test(src), 'ProjectSwitcher.tsx does not render from switcher.ts');
});

test('5 guard: a project that cannot be drawn does not open', () => {
  const list = [PROD('a'), PROD('b', { map: false, store: false, measuredFacets: 0 })];
  const it = row(list, 'b', 'a');
  expect(it.off === true, 'a missing map is not off');
  expect(S.switchPlan(it, 'a') === 'none', 'switchPlan(off) is ' + JSON.stringify(S.switchPlan(it, 'a')));
});

test('6 guard: the current project closes the menu', () => {
  const list = [PROD('a')];
  expect(S.switchPlan(row(list, 'a', 'a'), 'a') === 'close', 'the current row does not close');
  expect(S.switchPlan(row(list, null, null), null) === 'close', 'the Kettle row on Kettle does not close');
});

test('7 guard: Kettle opens with no ?product, the hash and ?morning dropped', () => {
  const list = [PROD('a')];
  const plan = S.switchPlan(row(list, null, 'a'), 'a');
  expect(plan && typeof plan === 'object' && plan.go === null, 'switchPlan(Kettle, a) is ' + JSON.stringify(plan));
  loc.href = 'http://bp.test/v/shaped?product=a&theme=light&morning=c1&scale=4#f:auth';
  expect(P.projectHref(null) === '/v/shaped?theme=light&scale=4', 'projectHref(null) is ' + P.projectHref(null));
  expect(P.projectHref('b') === '/v/shaped?product=b&theme=light&scale=4', 'projectHref(b) is ' + P.projectHref('b'));
});

for (const [name, fn] of cases) { try { fn(); } catch (e) { failures.push(name + ': ' + (e as Error).message); } }
if (failures.length) { console.error('check:switcher FAILED (' + failures.length + ')\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('check:switcher ok (' + cases.length + ' cases)');
