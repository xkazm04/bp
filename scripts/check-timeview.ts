// Pins the feature page's as-of read model: the stage replays from the events log (reusing stageAt), a metric
// reads its last reading on or before the date, and everything with no history is "none", never the now-value.
// It pins the presenter every feature-detail surface reads (recordAsOf / lensAsOf), the phone document and the bold
// variant server-rendered on a past date, and CONSUMPTION: every feature-detail root renders <AsOfBar />, and no
// component renders a now-only record piece outside the presenter's now branch (see the last section).
// Run: node scripts/check-timeview.ts  (scripts/overlays-loader.mjs transpiles src on the fly).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const { buildModel } = (await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/sample.ts')).href)) as Any;
const { stageAt } = (await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/index.ts')).href)) as Any;
const { stageView, valueView, readingsUpTo, recordAsOf, lensAsOf, NOT_RECORDED } = (await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/timeview.ts')).href)) as Any;

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const P = buildModel(1, () => 0, null).P;
const f = P.features.find((x: Any) => x.revs.length >= 2) ?? P.features[0];
const first = f.revs[0], last = f.revs[f.revs.length - 1];
expect(stageView(f, P.asOf, P.asOf).at === 'now', 'at asOf the stage view is now');
const sv = stageView(f, first.date, P.asOf);
expect(sv.at === 'then' && sv.stage === stageAt(f, first.date, P.asOf), 'the stage on the first revision date is the replayed stage');
expect(stageView(f, '1999-01-01', P.asOf).at === 'before', 'before the first revision the feature is not on the drawing');
expect(last.date >= P.asOf || stageView(f, last.date, P.asOf).stage === last.stage, 'the last revision date reads its stage');

const field = { key: 'cov', metric: { method: 'harness' } }, plain = { key: 'x' };
const m = (id: number, at: string, value: number) => ({ id, run_id: 'r', feature: 'f', lens: 'l', metric: 'cov', value, measured_at: at });
const scan = { measurements: [m(1, '2026-03-01T10:00:00Z', 10), m(2, '2026-04-01T10:00:00Z', 20), m(3, '2026-05-01T10:00:00Z', 30)] };
expect(valueView(scan, 'f', 'l', field, '2026-10-12', '2026-10-12').at === 'now', 'now reads the live value');
const v = valueView(scan, 'f', 'l', field, '2026-04-15', '2026-10-12');
expect(v.at === 'then' && v.value === 20 && v.measured === '2026-04-01', 'the last reading on or before the date');
expect(valueView(scan, 'f', 'l', field, '2026-04-01', '2026-10-12').value === 20, 'a reading on the day counts');
expect(valueView(scan, 'f', 'l', field, '2026-02-01', '2026-10-12').at === 'none', 'before the first reading: not recorded');
expect(valueView(scan, 'f', 'l', plain, '2026-04-15', '2026-10-12').at === 'none', 'a field with no metric has no history');
expect(valueView(undefined, 'f', 'l', field, '2026-04-15', '2026-10-12').at === 'none', 'no scan: not recorded');
expect(readingsUpTo(scan, 'f', 'l', 'cov', '2026-04-15').join() === '10,20', 'readings up to the date');

// ------------------------------------------------------------------ the presenter: one as-of record for every surface
// recordAsOf (stage line, flagged line, lede) and lensAsOf (a lens's health, why and dated headline) are the as-of rule
// in one place; the General tab, the lens tab, the phone document and its lens panels render them.
const tryCall = (fn: () => Any): Any => { try { return fn(); } catch { return undefined; } };
const { STAGE_WORD } = (await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/constants.ts')).href)) as Any;
const ep = P.F['email-password-sign-in'], T0 = '2026-04-27';
{
  const r = typeof recordAsOf === 'function' ? tryCall(() => recordAsOf(ep, T0, P.asOf)) : undefined;
  const word = STAGE_WORD[stageAt(ep, T0, P.asOf)];
  expect(!!r && r.at === 'past' && r.stage === word + ' on ' + T0 && r.flagged === NOT_RECORDED && r.lede?.strong === word && /^on 2026-04-27\. /.test(r.lede?.rest ?? ''),
    'recordAsOf on ' + T0 + ': the replayed stage word dated, flagged not recorded, the dated lede (got ' + JSON.stringify(r) + ')');
  const n = typeof recordAsOf === 'function' ? tryCall(() => recordAsOf(ep, P.asOf, P.asOf)) : undefined;
  expect(!!n && n.at === 'now' && n.stage === STAGE_WORD[ep.stage] + ' · since ' + ep.stageSince && n.flagged === null && n.lede === null,
    "recordAsOf at now: the stage since, flagged and lede left to the caller's now branch (got " + JSON.stringify(n) + ')');
  const b = typeof recordAsOf === 'function' ? tryCall(() => recordAsOf(ep, '1999-01-01', P.asOf)) : undefined;
  expect(b?.stage === 'Not on the drawing yet on 1999-01-01', 'recordAsOf before the first revision: not on the drawing yet');
}
{
  const hf = { key: 'cov', label: 'Cov', metric: { method: 'harness' } };
  const lf = { id: 'f', lens: { l: { h: 'bad', why: 'rule says', ov: null, whyFields: [], facet: {} } } }, ld = { id: 'l', headline: hf };
  const call = (t: string) => (typeof lensAsOf === 'function' ? tryCall(() => lensAsOf(lf, ld, scan, t, '2026-10-12')) : undefined);
  const th = call('2026-04-15'), no = call('2026-02-01'), nw = call('2026-10-12');
  expect(th?.health === 'unmeasured' && th.at === 'then' && th.value === 20 && th.why === 'Read on 2026-04-01. Health is not recorded for that date.', 'lensAsOf on a past date with a reading: unmeasured, read on its date (got ' + JSON.stringify(th) + ')');
  expect(no?.health === 'unmeasured' && no.at === 'none' && no.why === NOT_RECORDED, 'lensAsOf on a past date with no reading: not recorded (got ' + JSON.stringify(no) + ')');
  expect(nw?.at === 'now' && nw.health === 'bad' && nw.why === 'rule says', 'lensAsOf at now: the lens health and its reason, unchanged (got ' + JSON.stringify(nw) + ')');
}

// ------------------------------------------------------------------ the phone and the lens tab, server-rendered on a past date
{
  const { createRequire } = await import('node:module');
  const req = createRequire(path.join(ROOT, 'package.json'));
  const React: Any = req('react'), { renderToString }: Any = req('react-dom/server');
  const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
  const { initialState } = await imp('engine/state.ts');
  const { EngineCtx, VariantCtx } = await imp('components/hooks.ts');
  // bold is a lazy chunk (variants/registry.ts): load it once, then getVariant reads it synchronously
  const { getVariant, loadVariant } = await imp('variants/registry.ts');
  await loadVariant('bold');
  const { Phone } = await imp('components/Phone.tsx');
  const { LensTab } = await imp('components/page/LensTab.tsx');
  const { MetricRows } = await imp('components/sheet/LensPanel.tsx');
  const { plainLine } = await imp('components/sheet/words.ts');
  const { HEALTH_TEXT } = (await import(pathToFileURL(path.join(ROOT, 'packages/core/src/standard/present.ts')).href)) as Any;
  const M = buildModel(1, () => 0, null);
  // the check-overlays stub engine (scripts/check-overlays.ts render())
  const render = (el: () => Any, patch: Record<string, unknown>, variant = 'subtle'): string => {
    const S = { ...initialState(1, M.P.asOf), ready: true, ...patch };
    const E = {
      M, S, U: 1, SAFE: { l: 0, t: 0, r: 1280, b: 800 }, FW: 1280, FH: 800,
      store: { get: () => S, subscribe: () => () => {} },
      setHoverEl() {}, placeHover() {}, dirty() {}, onFrame: () => () => {}, onSimTime: () => () => {}, flyToFeature() {},
      placeById: () => null, lensIds: Object.keys(M.P.LENS), lensAgg: () => ({ parts: [] }), channel: () => null,
    };
    const keep = console.error; console.error = () => {};
    try { return renderToString(React.createElement(VariantCtx.Provider, { value: getVariant(variant) }, React.createElement(EngineCtx.Provider, { value: E }, el()))); }
    catch (e) { return 'THREW ' + (e as Error).message; } finally { console.error = keep; }
  };
  const detail = (html: string) => html.slice(Math.max(0, html.indexOf('ph-detail')));
  const row = (html: string, l: string) => ((html.match(new RegExp('<span class="l">' + l + '</span>(.*?)</div>')) || [])[1] ?? '').replace(/<[^>]+>/g, '').replace(/<!-- -->/g, '');
  const fe = M.P.F['email-password-sign-in'];
  const past = detail(render(() => React.createElement(Phone), { phone: true, open: fe.id, t: T0 }));
  const word = STAGE_WORD[stageAt(fe, T0, M.P.asOf)];
  expect(row(past, 'Stage') === word + ' on ' + T0 && row(past, 'Flagged by') === NOT_RECORDED,
    'phone on ' + T0 + ': Stage reads "' + row(past, 'Stage') + '" (want "' + word + ' on ' + T0 + '"), Flagged by reads "' + row(past, 'Flagged by') + '"');
  const nowLine = plainLine(M.P, fe, M.sim).strong;
  expect(!/class="tens"/.test(past) && !past.includes(nowLine) && past.includes('How it was doing then is not recorded'),
    'phone on ' + T0 + ': no now-trouble line, no now sentence ("' + nowLine + '"), the dated lede');
  const heads = [...past.matchAll(/<h5>(.*?)<\/h5>/g)].map((x) => x[1]);
  const marked = heads.filter((h) => h.includes('>' + HEALTH_TEXT.bad.mark + '<') || h.includes('>' + HEALTH_TEXT.watch.mark + '<'));
  expect(heads.length > 0 && marked.length === 0 && !/<div class="r">/.test(past),
    'phone on ' + T0 + ': ' + heads.length + ' lens panels, ' + marked.length + ' carry a now health mark, field rows ' + (past.match(/<div class="r">/g) || []).length + ' (want 0)');
  const nowHtml = detail(render(() => React.createElement(Phone), { phone: true, open: fe.id }));
  expect(row(nowHtml, 'Stage') === STAGE_WORD[fe.stage] + ' · since ' + fe.stageSince && nowHtml.includes(nowLine) && nowHtml.includes('>' + HEALTH_TEXT.watch.mark + '<'),
    'guard: the phone at now reads the stage since ("' + row(nowHtml, 'Stage') + '"), the now sentence and the now health');

  // MetricRows takes the date window
  const mf = { key: 'cov', label: 'Cov', type: 'int', metric: { method: 'harness' } };
  const mscan = { measurements: [m(1, '2026-04-01T10:00:00Z', 1), m(2, '2026-04-02T10:00:00Z', 2), m(3, '2026-04-03T10:00:00Z', 3)] };
  const mh = renderToString(React.createElement(MetricRows, { def: { id: 'l', fields: [mf] }, f: { id: 'f', lens: {} }, model: M, scan: mscan, all: true, fl: undefined, on: { t: '2026-04-02', now: '2026-04-20' } }));
  expect(/title="2 readings, the latest 2/.test(mh), 'MetricRows on 2026-04-02 reads 2 readings, the latest 2 (got ' + (mh.match(/title="([^"]*)"/) || [])[1] + ')');

  // a variant panel is not mounted on a past date: the dated block is
  const bp = detail(render(() => React.createElement(Phone), { phone: true, open: fe.id, t: T0, view: 'development' }, 'bold'));
  const bn = detail(render(() => React.createElement(Phone), { phone: true, open: fe.id, view: 'development' }, 'bold'));
  expect(!/bd-panel/.test(bp) && /bd-panel/.test(bn), 'bold on the phone: a variant panel on ' + T0 + ' ' + /bd-panel/.test(bp) + ' (want false), at now ' + /bd-panel/.test(bn) + ' (want true)');
  const lp = render(() => React.createElement(LensTab, { lens: 'development', f: fe }), { t: T0, view: 'development' }, 'bold');
  const ln = render(() => React.createElement(LensTab, { lens: 'development', f: fe }), { view: 'development' }, 'bold');
  expect(!/bd-panel/.test(lp) && /pg-hero/.test(lp), 'bold lens tab on ' + T0 + ': the dated body, not the variant panel (' + lp.slice(0, 80) + ')');
  expect(/bd-panel/.test(ln), 'guard: the bold lens tab at now mounts the variant panel (' + ln.slice(0, 80) + ')');
}

// ------------------------------------------------------------------ consumption: who reads the as-of model
// The functions above are pinned; this pins that the surfaces USE them. `t` is global engine state, written into the URL
// (`#t=<date>`), so a travelled-back state is reachable on a phone by a link or a resize, and a surface that renders current
// records without saying the plan is in the past presents now-values as the record of that date.
// The surfaces are enumerated from the tree, not typed: every component file that defines a feature-detail root (a
// `SheetBody` or a feature `Page`) must render <AsOfBar /> (comments blanked first, so a comment cannot stand in for it) or
// carry `undated-by-design: <why>` in a comment.
const { blankComments } = (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/source.ts')).href)) as Any;
const ROOT_DEF = /(?:^|\n)\s*(?:export\s+)?function\s+(SheetBody|Page)\s*\(/;
const UNDATED = /undated-by-design:/;
const surfaceOk = (raw: string) => UNDATED.test(raw) || /<AsOfBar\s*\/>/.test(blankComments(raw));
const tsxIn = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsxIn(path.join(d, e.name)) : /\.tsx$/.test(e.name) ? [path.join(d, e.name)] : []));
const surfaces = tsxIn(path.join(SRC, 'components')).filter((p) => ROOT_DEF.test(blankComments(fs.readFileSync(p, 'utf8'))));
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/');
expect(surfaces.length >= 2, 'the consumption scan found the feature-detail roots (' + surfaces.map(rel).join(', ') + '): it stopped matching if fewer than 2');
for (const p of surfaces) expect(surfaceOk(fs.readFileSync(p, 'utf8')), rel(p) + ' renders a feature detail and neither renders <AsOfBar /> nor declares undated-by-design: a travelled-back plan would show now-values undated');
// control: the rule bites on a root with no marker, on a marker that is only a comment, and passes on a real one
expect(!surfaceOk('export function SheetBody() { return <div />; }'), 'control: a root with no AsOfBar is refused');
expect(!surfaceOk('// <AsOfBar />\nexport function SheetBody() { return <div />; }'), 'control: a comment naming AsOfBar does not satisfy the rule');
expect(!surfaceOk('/* <AsOfBar /> */ export function Page() { return null; }'), 'control: a block comment naming AsOfBar does not satisfy the rule');
expect(surfaceOk('export function SheetBody() { return <><AsOfBar /></>; }') && surfaceOk('// undated-by-design: a fixture\nexport function Page() { return null; }'), 'control: a rendered AsOfBar and a declared opt-out both pass');

// Now-only record pieces (the current flags, the stage since, the now sentence, the now-trouble lines) are rendered only
// inside the presenter's now branch: the same line carries `<x>.at === 'now' ?` (or `&&`) before the piece. Every
// component file is scanned, so the General tab and whatever else a root mounts are held too.
const NOW_ONLY = /<FlaggedBy\b|\bstageSince\(|\bplainLine\(|\.trouble\.filter\(.*?\)\.map\(\(\w+\)\s*=>\s*</g;
const NOW_GUARD = /\.at === 'now'\s*(?:\?|&&)/;
const nowLeaks = (raw: string): string[] => blankComments(raw).split('\n').flatMap((ln: string, i: number) =>
  [...ln.matchAll(NOW_ONLY)].filter((x) => !NOW_GUARD.test(ln.slice(0, x.index))).map((x) => i + 1 + ': ' + x[0]));
for (const p of tsxIn(path.join(SRC, 'components'))) {
  const l = nowLeaks(fs.readFileSync(p, 'utf8'));
  expect(!l.length, rel(p) + " renders a now-only record piece outside the presenter's now branch: " + l.join(', '));
}
expect(nowLeaks('export function SheetBody(){ return <><AsOfBar /><FlaggedBy f={f} /></> }').length > 0, 'control: a FlaggedBy under the banner but outside the now branch is refused');
expect(!nowLeaks("const x = rec.at === 'now' ? <FlaggedBy f={f} /> : rec.flagged;").length, 'control: a FlaggedBy in the now branch passes');
expect(surfaces.some((p) => /SheetBody\.tsx$/.test(p)) && surfaces.some((p) => /FeatureSheet\.tsx$/.test(p)), 'the consumption scan holds SheetBody.tsx and FeatureSheet.tsx');
expect((fs.readFileSync(path.join(SRC, 'components/page/General.tsx'), 'utf8').match(/Not on the drawing yet/g) || []).length === 0, 'General.tsx writes no inline stage word: the presenter does');

if (failures.length) { console.error('FAIL check-timeview\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('check-timeview: ' + held + ' expectations held');
