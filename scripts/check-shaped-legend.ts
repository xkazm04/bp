// check:shaped-legend - the shaped legend is a finder, not a dictionary: each icon row of a lens says how many features
// on this plan carry that state and walks the plan to each one; and the icons are honest first: a feature nobody
// scanned under a lens gets no icon (iconFor -> null) and counts as "Not measured", not as "Code reviewed by a person".
// Cases (challenge card variants-bold-shaped/B):
//   1 security rows over [payment+passed, payment+pending, personal+pending, public+not-required, no facet]
//   2 iconFor is null for a facet-less feature under every built-in lens; the chip degrades to the health cell
//   3 partition: every built-in lens over a synthetic set covering each state, row counts + Not measured + Not applicable = all, ids in VOCAB
//   4 nextMatch walks a row's ids (wraps; a cursor outside the list starts at the first)
//   5 goNext flies to the next match with the highlight; Enter/Space are swallowed (the engine key handler stays out)
//   6 a 0-count row renders aria-disabled with "0" and pressing it does nothing; legend text is >= 12 px
// The browser journey (security tab, Plan flyout, Tab to a row, Enter twice) is the manual run of
// apps/web/src/variants/shaped/shots.py against a dev server; this gate needs no server.
// Run: node scripts/check-shaped-legend.ts   (Node's type stripping; scripts/overlays-loader.mjs transpiles src/**)
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_SHAPED_LEGEND_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href).catch((e) => ({ __err: (e as Error).message }));
const icons = await imp('variants/shaped/icons.ts');
const model = await imp('variants/shaped/legend-model.ts');
const { CHANNELS } = await imp('variants/shaped/channels.ts');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const fn = (o: Any, k: string) => (o && typeof o[k] === 'function' ? o[k] : null);
const legendRows = fn(model, 'legendRows'), nextMatch = fn(model, 'nextMatch'), goNext = fn(model, 'goNext');
expect(!model.__err, 'shaped/legend-model.ts loads: ' + (model.__err ?? ''));
const LENSES = ['business', 'design', 'development', 'operations', 'security', 'quality'];

let seq = 0;
const feat = (lens: Record<string, { v: Record<string, unknown>; h: string }>): Any => ({ id: 'f' + ++seq, stage: 'live', lens });
const none = (): Any => feat({});
const rowOf = (rows: Any[], key: string) => rows.find((r) => r.key === key);
const count = (rows: Any[], key: string) => rowOf(rows, key)?.ids.length ?? -1;

// ---- 1. security rows
{
  const sec = (dataClass: string, review: string) => feat({ security: { v: { dataClass, review }, h: 'good' } });
  const fs5 = [sec('payment', 'passed'), sec('payment', 'pending'), sec('personal', 'pending'), sec('public', 'not-required'), none()];
  const rows: Any[] = legendRows ? legendRows('security', fs5) : [];
  const got = ['lockCard', 'lockCardOpen', 'lockOpen', 'lock', 'unmeasured'].map((k) => k + '=' + count(rows, k)).join(' ');
  expect(got === 'lockCard=1 lockCardOpen=1 lockOpen=1 lock=1 unmeasured=1', 'security rows count one of each and one Not measured: ' + got);
  expect(rowOf(rows, 'unmeasured')?.words === 'Not measured' && rowOf(rows, 'unmeasured')?.ids[0] === fs5[4].id, 'the facet-less feature is the "Not measured" row, not "Review pending"');
}

// ---- 2. iconFor null on a facet-less feature; the chip degrades to the health cell
{
  const said = LENSES.map((l) => l + '=' + String(icons.iconFor?.(l, none())));
  expect(said.every((s) => s.endsWith('=null')), 'iconFor gives a facet-less feature no icon under every built-in lens: ' + said.join(' '));
  const na = String(icons.iconFor?.('design', feat({ design: { v: {}, h: 'na' } })));
  expect(na === 'null', 'iconFor gives a not-applicable design facet no icon (it is not "Has a design"): ' + na);
  const ok = String(icons.iconFor?.('development', feat({ development: { v: { humanReviewed: true }, h: 'good' } })));
  expect(ok === 'code', 'GUARD: a measured, human-reviewed feature still gets the code icon: ' + ok);

  // a recording canvas: Path2D is stubbed so a drawn icon shows up as a stroke of a path
  (globalThis as Any).Path2D = class { d: string; constructor(d?: string) { this.d = d ?? ''; } };
  const chip = (f: Any, lens: string) => {
    const calls: string[] = [];
    const ctx: Any = new Proxy({ globalAlpha: 1 } as Any, {
      get: (t, k) => (k in t ? t[k as string] : (...a: Any[]) => { calls.push(String(k) + (k === 'fillRect' ? ':' + t.fillStyle : '') + (k === 'stroke' && a[0] ? ':path' : '')); }),
      set: (t, k, v) => { t[k as string] = v; return true; },
    });
    const th: Any = { red: 'RED', amber: 'AMBER', inkA: (a: number) => 'ink' + a, labelBg: 'BG' };
    const tile: Any = { form: 'tile', u: 1, k: 1, x: 0, y: 0, w: 160, h: 120, strip: { x: 0, y: 0, w: 160, h: 18 }, body: { x: 4, y: 4, w: 152, h: 112 }, text: true };
    const live: Any = { rolloutPct: 50, progressPct: 50, value: () => undefined };
    let threw = '';
    try { CHANNELS[lens].marks({ ctx, r: { x: 8, y: 0, w: 18, h: 18 }, slot: null, lens: { id: lens }, tile, f, w: 1, x: 0, compact: true, th, stage: 'live', now: true, live, accent: 'ACC' }); }
    catch (e) { threw = (e as Error).message; }
    return { calls, threw };
  };
  const blind = LENSES.map((l) => ({ l, ...chip(none(), l) })).filter((r) => r.threw || r.calls.includes('stroke:path') || !r.calls.includes('fillRect:ink0.3'));
  expect(blind.length === 0, 'a facet-less chip draws the plain health cell, not an icon: ' + blind.map((r) => r.l + (r.threw ? ' threw ' + r.threw : ' ' + r.calls.join(','))).join('; '));
  const drawn = chip(feat({ development: { v: { humanReviewed: true }, h: 'good' } }), 'development');
  expect(!drawn.threw && drawn.calls.includes('stroke:path'), 'GUARD: a measured chip still draws its icon: ' + (drawn.threw || drawn.calls.join(',')));
}

// ---- 3. partition over a synthetic set covering each state (the card said 12; one set serves all six lenses)
{
  const V = (l: string, v: Record<string, unknown>, h = 'good') => feat({ [l]: { v, h } });
  const set: Record<string, Any[]> = {
    business: [V('business', { value: 5 }), V('business', { value: 2 }), V('business', { value: 4 })],
    design: [V('design', { status: 'none' }), V('design', { status: 'polished' }), V('design', { status: 'sketch' }), V('design', {}, 'na')],
    development: [V('development', { humanReviewed: false }), V('development', { humanReviewed: true }), V('development', { status: 'in-progress' })],
    operations: [V('operations', { environment: 'production', alerting: false }), V('operations', { environment: 'production', alerting: true }), V('operations', { environment: 'staging' })],
    security: [V('security', { dataClass: 'payment', review: 'findings' }), V('security', { dataClass: 'internal', review: 'passed' }), V('security', { dataClass: 'personal', review: 'not-started' })],
    quality: [V('quality', { status: 'failing' }), V('quality', { status: 'passed' }), V('quality', { status: 'partial' }), V('quality', { status: 'testing' }), V('quality', { status: 'not-started' })],
  };
  const twelve = [...Object.values(set).flat(), none(), none()];   // 23: each lens sees the others' features as not measured
  for (const l of LENSES) {
    const rows: Any[] = legendRows ? legendRows(l, twelve) : [];
    const sum = rows.reduce((s, r) => s + r.ids.length, 0), ids = new Set(rows.flatMap((r) => r.ids));
    expect(sum === twelve.length && ids.size === twelve.length, `${l}: every feature falls in exactly one row (${sum} counted of ${twelve.length}, ${ids.size} distinct)`);
    const vocab = new Set((model.VOCAB?.[l] ?? []).map((v: Any) => v[0]));
    const stray = rows.filter((r) => r.key !== 'unmeasured' && r.key !== 'na' && !vocab.has(r.key));
    expect(vocab.size > 0 && stray.length === 0, `${l}: every icon row is one the legend names (stray: ${stray.map((r) => r.key).join(',') || 'none'})`);
    const iconless = twelve.filter((f) => icons.iconFor?.(l, f) != null && !vocab.has(icons.iconFor(l, f)));
    expect(iconless.length === 0, `${l}: no feature gets an icon the legend does not name (${iconless.length})`);
  }
  expect(count(legendRows ? legendRows('design', twelve) : [], 'na') === 1, 'design: the not-applicable feature is its own "Not applicable" row');
}

// ---- 4. nextMatch
{
  const nm = (ids: string[], cur: string | null) => (nextMatch ? nextMatch(ids, cur) : 'missing');
  const got = [nm([], null), nm(['a', 'b', 'c'], null), nm(['a', 'b', 'c'], 'a'), nm(['a', 'b', 'c'], 'c'), nm(['a', 'b', 'c'], 'x')].map(String).join(' ');
  expect(got === 'null a b a a', 'nextMatch: [] -> null, null -> a, a -> b, c -> a (wraps), x -> a: ' + got);
}

// ---- 5. goNext flies with the highlight; the row's keys never reach the engine
{
  const flown: Any[] = [];
  const E: Any = { flyToFeature: (id: string, hl: boolean) => flown.push([id, hl]) };
  const c1 = goNext ? goNext(E, ['a', 'b'], null) : 'missing', c2 = goNext ? goNext(E, ['a', 'b'], c1) : 'missing';
  expect(c1 === 'a' && c2 === 'b' && JSON.stringify(flown) === '[["a",true],["b",true]]', 'goNext flies to a then b, highlighting each: ' + JSON.stringify(flown));
  const c3 = goNext ? goNext(E, [], 'b') : 'missing';
  expect(c3 === 'b' && flown.length === 2, 'goNext on an empty row keeps the cursor and does not fly');
  const src = fs.readFileSync(path.join(SRC, 'variants/shaped/Legend.tsx'), 'utf8');
  expect(/onKeyDown=\{[^}]*swallow\(e\)/.test(src), 'Legend.tsx rows swallow Enter/Space (stopImmediatePropagation) so the engine key handler does not also act');
}

// ---- 6. SSR: a 0-count row is aria-disabled with "0"; legend text sizes
{
  const req = createRequire(path.join(ROOT, 'package.json'));
  const React: Any = req('react'), { renderToString }: Any = req('react-dom/server');
  const { EngineCtx, VariantCtx } = await imp('components/hooks.ts');
  const { initialState } = await imp('engine/state.ts');
  const L = await imp('variants/shaped/Legend.tsx');
  const f1 = feat({ security: { v: { dataClass: 'payment', review: 'pending' }, h: 'bad' } }), f2 = none();
  const P: Any = { features: [f1, f2], lenses: [{ id: 'security', name: 'Security', short: 'SEC', i: 0 }], LENS: { security: { id: 'security', name: 'Security', short: 'SEC', i: 0 } }, asOf: '2026-10-01' };
  const M: Any = { P, L: { TILE: { [f1.id]: {}, [f2.id]: {} } } };
  const S = { ...initialState(1, P.asOf), ready: true, view: 'security' };
  const E: Any = { M, S, store: { get: () => S, subscribe: () => () => {} }, flyToFeature() {}, lensIds: ['security'], lensAccent: () => 'x' };
  let html = '';
  try { html = renderToString(React.createElement(VariantCtx.Provider, { value: {} }, React.createElement(EngineCtx.Provider, { value: E }, React.createElement(L.ShapedLegend, { view: 'security' })))); }
  catch (e) { failures.push('ShapedLegend server render threw: ' + (e as Error).message); }
  const btn = (label: RegExp) => (html.match(/<button[^>]*>/g) ?? []).find((b) => label.test(b)) ?? '';
  const zero = btn(/aria-label="Card data, reviewed: 0 on this plan/), one = btn(/aria-label="Card data, not reviewed: 1 on this plan, go to next/);
  expect(/aria-disabled="true"/.test(zero), 'the 0-count "Card data, reviewed" row is an aria-disabled button: ' + (zero || '(no such button)'));
  expect(!!one && !/aria-disabled/.test(one), 'the 1-count "Card data, not reviewed" row is an enabled button labelled "…: 1 on this plan, go to next"');
  expect(/Not measured: 1 on this plan/.test(html), 'the facet-less feature is counted on a "Not measured" row');
  const counts = [...html.matchAll(/class="shp-n"[^>]*>(\d+)</g)].map((m) => m[1]);
  expect(counts.includes('0') && counts.includes('1'), 'each row prints its count, 0 included: ' + counts.join(','));
  const css = fs.readFileSync(path.join(SRC, 'variants/shaped/styles.css'), 'utf8');
  const small = [...css.matchAll(/\.shp-(?:lg|lens|fd|n)[^{]*\{[^}]*font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) < 12).map((m) => m[0].slice(0, 60));
  expect(small.length === 0 && /\.shp-n\b/.test(css), 'every legend text rule in shaped/styles.css is >= 12 px, the count included: ' + (small.join(' | ') || (/\.shp-n\b/.test(css) ? 'ok' : 'no .shp-n rule')));
}

if (failures.length) { console.error('check:shaped-legend FAILED\n' + failures.map((f) => '  - ' + f).join('\n') + `\n(${held} held)`); process.exit(1); }
console.log(`check:shaped-legend ok: ${held} expectations held`);
