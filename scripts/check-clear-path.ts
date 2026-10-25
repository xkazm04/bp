// Pins "what clears it": clearPath (packages/core/src/standard/clear.ts) reads a lens manifest's rules and a feature's
// bound values and proposes, per matching rule worse than the default, the smallest change that stops it matching -
// verified by applying every target and re-running the rules - plus the margin to the next worse health. It pins the
// solver on hand-made values, a property over every unwell Kettle pair, the lens tab / General tile / phone panel
// server-rendered, and that lenses stay data (no lens id in the solver or the rendered block).
// Run: node scripts/check-clear-path.ts  (scripts/overlays-loader.mjs transpiles src on the fly).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const core = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core/src', p)).href);
const { buildModel } = await core('model/sample.ts');
const { matchRule, evaluateLens, evaluateCondition } = await core('standard/health.ts');
const clearMod: Any = await core('standard/clear.ts').catch(() => ({}));
const clearPath = (m: Any, v: Any): Any => { try { return typeof clearMod.clearPath === 'function' ? clearMod.clearPath(m, v) : undefined; } catch (e) { return { threw: (e as Error).message }; } };

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const J = (x: unknown) => JSON.stringify(x);
const pick = (s: Any) => s && { field: s.field, now: s.now, target: s.target, op: s.op, rule: s.rule };

const lens = (id: string): Any => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/standard/lenses', id + '.json'), 'utf8'));
const apply = (values: Any, steps: Any[]) => { const v = { ...values }; for (const s of steps) v[s.field] = s.target; return v; };
/** The facet and context evaluateLens needs for bound values: feature-bound fields from `v`, KPI-bound ones as KPIs. */
const evalWith = (m: Any, v: Any, today: string) => {
  const feature: Any = {}, kpis: Any[] = [];
  for (const x of m.fields) if (x.source && v[x.key] !== undefined) { if ('feature' in x.source) feature[x.source.feature] = v[x.key]; else kpis.push({ slug: x.source.kpi, current: { value: v[x.key] } }); }
  return evaluateLens(m, { values: v }, today, { feature, kpis }).health;
};

// 1. every matching rule, in rule order, each with its bound; applying them all reads the default
{
  const q = lens('quality'), v = { status: 'passed', openBugsP1: 2, brokenTests: 0, e2ePassPct: 92, e2eTests: 5, untestedPaths: 0 };
  const r = clearPath(q, v);
  const want = [{ field: 'openBugsP1', now: 2, target: 0, op: 'at most', rule: 'bad' }, { field: 'e2ePassPct', now: 92, target: 100, op: 'at least', rule: 'watch' }];
  expect(!!r && J((r.steps ?? []).map(pick)) === J(want) && r.blocked === null, 'case 1: two matching rules -> two steps in rule order (got ' + J(r) + ')');
  expect(!!r?.steps && evalWith(q, apply(v, r.steps), '2026-10-08') === 'good', 'case 1: every target applied -> evaluateLens reads good');
}
// 2. an `all` rule clears through a leaf that is not feature-bound
{
  const q = lens('quality'), v = { status: 'passed', stage: 'live', e2eTests: 1, e2ePassPct: 100 };
  const r = clearPath(q, v);
  expect(!!r && J((r.steps ?? []).map(pick)) === J([{ field: 'e2eTests', now: 1, target: 3, op: 'at least', rule: 'watch' }]), 'case 2: all(stage, e2eTests < 3) -> e2eTests 1 -> at least 3, never the stage (got ' + J(r) + ')');
}
// 3. enum: the last declared value no unwell rule matches; boolean: its other value
{
  const r = clearPath(lens('design'), { a11y: 'partial' });
  expect(!!r && J((r.steps ?? []).map(pick)) === J([{ field: 'a11y', now: 'partial', target: 'pass', op: 'set to', rule: 'watch' }]), 'case 3: a11y partial -> pass (got ' + J(r) + ')');
  const o = clearPath(lens('operations'), { alerting: false });
  expect(!!o && J((o.steps ?? []).map(pick)) === J([{ field: 'alerting', now: false, target: true, op: 'set to', rule: 'watch' }]), 'case 3: alerting false -> true (got ' + J(o) + ')');
}
// 4. the margin to the next worse health
{
  const p = lens('performance');
  const w = clearPath(p, { frameP95Ms: 41 }), g = clearPath(p, { frameP95Ms: 30 });
  expect(J(w?.worse) === J({ field: 'frameP95Ms', bound: 50, health: 'bad', margin: 9 }), 'case 4: frame p95 41 (watch) -> 9 from the bad bound 50 (got ' + J(w?.worse) + ')');
  expect(J(g?.worse) === J({ field: 'frameP95Ms', bound: 33.3, health: 'watch', margin: 3.3 }) && g?.steps?.length === 0 && g?.blocked === null, 'case 4: frame p95 30 (good) -> 3.3 from the watch bound 33.3, no steps (got ' + J(g) + ')');
}

// 5 and 6. a property over every unwell Kettle pair, and the pairs where more than one rule matches
const M = buildModel(1, () => 0, null), P = M.P;
{
  let pairs = 0, listed = 0, blocked = 0, multi = 0, multiOk = 0;
  const bad: string[] = [];
  for (const f of P.features) for (const d of P.lenses) {
    const fl = f.lens[d.id];
    if (!fl || (fl.h !== 'watch' && fl.h !== 'bad') || fl.ov) continue;
    pairs++;
    const m = d.manifest, r = clearPath(m, fl.v), k = f.id + '/' + d.id;
    if (!r || !Array.isArray(r.steps)) { bad.push(k + ' no result ' + J(r)); continue; }
    const matched = m.health.rules.filter((x: Any) => evaluateCondition(x.when, fl.v)).length;
    if (r.steps.length) {
      listed++;
      const after = apply(fl.v, r.steps);
      if (r.blocked !== null || matchRule(m, after) !== null || evalWith(m, after, P.asOf) !== m.health.default) bad.push(k + ' steps ' + J(r.steps.map(pick)) + ' leave it unwell');
      if (r.steps.some((s: Any) => m.fields.find((x: Any) => x.key === s.field)?.source && 'feature' in m.fields.find((x: Any) => x.key === s.field).source)) bad.push(k + ' offers a feature-bound field');
    } else {
      blocked++;
      if (typeof r.blocked !== 'string' || !r.blocked) bad.push(k + ' has no steps and no blocked sentence');
    }
    if (matched > 1) { multi++; if (!r.steps.length || r.steps.length >= matched) multiOk++; else bad.push(k + ' matches ' + matched + ' rules, ' + r.steps.length + ' steps'); }
  }
  expect(pairs >= 140 && !bad.length, 'case 5: ' + pairs + ' unwell non-overridden Kettle pairs, every list verified (' + bad.slice(0, 5).join('; ') + (bad.length > 5 ? ' ... ' + bad.length : '') + ')');
  expect(listed >= 120, 'case 5: ' + listed + ' pairs get a non-empty list (want >= 120), ' + blocked + ' blocked');
  expect(multi >= 20 && multiOk === multi, 'case 6: ' + multi + ' pairs match more than one rule, ' + multiOk + ' list one step per matching rule');
}

// 7. the lens tab, the General tile and the phone panel, server-rendered with the check-overlays stub engine
{
  const { createRequire } = await import('node:module');
  const req = createRequire(path.join(ROOT, 'package.json'));
  const React: Any = req('react'), { renderToString }: Any = req('react-dom/server');
  const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
  const { initialState } = await imp('engine/state.ts');
  const { EngineCtx, VariantCtx } = await imp('components/hooks.ts');
  const { getVariant } = await imp('variants/registry.ts');
  const { LensTab } = await imp('components/page/LensTab.tsx');
  const { GeneralTab } = await imp('components/page/General.tsx');
  const { DefaultLensPanel } = await imp('components/sheet/LensPanel.tsx');
  const render = (el: () => Any, patch: Record<string, unknown>): string => {
    const S = { ...initialState(1, P.asOf), ready: true, ...patch };
    const E = {
      M, S, U: 1, SAFE: { l: 0, t: 0, r: 1280, b: 800 }, FW: 1280, FH: 800,
      store: { get: () => S, subscribe: () => () => {} },
      setHoverEl() {}, placeHover() {}, dirty() {}, onFrame: () => () => {}, onSimTime: () => () => {}, flyToFeature() {},
      placeById: () => null, lensIds: Object.keys(P.LENS), lensAgg: () => ({ parts: [] }), channel: () => null, setView() {}, setTime() {},
    };
    const keep = console.error; console.error = () => {};
    try { return renderToString(React.createElement(VariantCtx.Provider, { value: getVariant('subtle') }, React.createElement(EngineCtx.Provider, { value: E }, el()))).replace(/<!-- -->/g, ''); }
    catch (e) { return 'THREW ' + (e as Error).message; } finally { console.error = keep; }
  };
  const text = (h: string) => h.replace(/<[^>]+>/g, '');
  const clr = (html: string) => (html.match(/<ol class="pg-clr">(.*?)<\/ol>/) || [])[1];
  const fe = P.F['email-password-sign-in'];
  const now = render(() => React.createElement(LensTab, { lens: 'design', f: fe }), { view: 'design' });
  const items = [...(clr(now) ?? '').matchAll(/<li>(.*?)<\/li>/g)].map((x) => text(x[1]));
  const cp = clearPath(P.LENS.design.manifest, fe.lens.design.v);
  expect(fe.lens.design.h === 'watch' && /What clears it/.test(now) && items.length === (cp?.steps?.length ?? -1) && items.length > 0 && items[0].startsWith('Accessibility: partial → pass'),
    'case 7: the design tab at now lists "What clears it", one <li> per step (got ' + J(items) + ')');
  expect(now.includes('Accessibility only partly passes'), 'guard: the why line still names the first matching rule');
  const past = render(() => React.createElement(LensTab, { lens: 'design', f: fe }), { view: 'design', t: '2026-04-27' });
  expect(/pg-hero/.test(past) && !/What clears it|pg-clr/.test(past), 'case 7: on a past date the list is absent (health is not recorded)');
  const fo = P.F['failed-payment-dunning'];
  const ov = render(() => React.createElement(LensTab, { lens: 'security', f: fo }), { view: 'security' });
  expect(!!fo.lens.security.ov && /The rules alone ask for/.test(ov) && !/What clears it/.test(ov) && !!clr(ov), 'case 7: under an override the list is headed "The rules alone ask for"');
  // the General tile says how many steps when more than one, and the phone's expanded panel carries the list
  const multi = P.features.find((x: Any) => (clearPath(P.LENS.quality.manifest, x.lens.quality?.v ?? {})?.steps?.length ?? 0) > 1 && x.lens.quality?.h !== 'good' && !x.lens.quality?.ov);
  const gen = multi ? render(() => React.createElement(GeneralTab, { f: multi }), { view: 'general' }) : '';
  const n = multi ? clearPath(P.LENS.quality.manifest, multi.lens.quality.v).steps.length : 0;
  expect(!!multi && gen.includes('· ' + n + ' steps to clear'), 'case 7: the General tile adds "· ' + n + ' steps to clear" (' + (multi?.id ?? 'no multi-step feature') + ')');
  const ph = render(() => React.createElement(DefaultLensPanel, { lens: 'design', def: P.LENS.design, f: fe, model: M, density: 'dense', expanded: true, view: 'design' }), {});
  expect(!!clr(ph) && text(clr(ph)).includes('Accessibility: partial → pass'), 'case 7: the phone panel (expanded) carries the same list');
}

// 8. lenses are data: no lens id in the solver or the rendered block; page.css on tokens
{
  const IDS = /business|design|development|operations|performance|quality|security/;
  const cl = path.join(ROOT, 'packages/core/src/standard/clear.ts');
  const clSrc = fs.existsSync(cl) ? fs.readFileSync(cl, 'utf8') : '';
  const lp = fs.readFileSync(path.join(SRC, 'components/sheet/LensPanel.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const block = (lp.match(/\/\/ -+ what clears it\n[\s\S]*?\n\/\/ -+ end what clears it/) || [])[0] ?? '';
  expect(!!clSrc && !IDS.test(clSrc), 'case 8: clear.ts exists and names no lens id');
  expect(!!block && !IDS.test(block) && /<ol className="pg-clr">/.test(block), 'case 8: the ClearSteps block in LensPanel.tsx exists and names no lens id');
  const css = fs.readFileSync(path.join(SRC, 'components/page.css'), 'utf8');
  const rules = [...css.matchAll(/[^}]*\.pg-clr[^{]*\{[^}]*\}/g)].map((x) => x[0]);
  expect(rules.length > 0 && rules.every((r) => !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(r) && !/font-size:(?!\s*var\(--fs-)|font:\s*\d+\s+(?!var\(--fs-)/.test(r)), 'case 8: the .pg-clr rules use colour tokens and --fs-* sizes only (' + rules.length + ' rules)');
}

if (failures.length) { console.error('FAIL check-clear-path\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('check-clear-path: ' + held + ' expectations held');
