// Pins "what clears it" knowing its proposals: coverStep (packages/core/src/standard/cover.ts) matches a step to the
// proposals on the same feature, lens and metric, applies now + expected delta (or a built item's after value) and
// re-runs the manifest's rules: clears / short by X / makes it worse / uncovered. It pins the verdicts on a fixture,
// the status set, that a step is judged with the rest of its path taken, and that the lens tab renders one chip per
// step. Lenses stay data: no lens id in cover.ts.
// Run: node scripts/check-clear-cover.ts  (scripts/overlays-loader.mjs transpiles src on the fly).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const core = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core/src', p)).href);
const { clearPath } = await core('standard/clear.ts');
const coverMod: Any = await core('standard/cover.ts').catch(() => ({}));
const coverStep = (...a: Any[]): Any => { try { return typeof coverMod.coverStep === 'function' ? coverMod.coverStep(...a) : undefined; } catch (e) { return { threw: (e as Error).message }; } };

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const J = (x: unknown) => JSON.stringify(x);
const pick = (c: Any) => c && { id: c.id, phase: c.phase, value: c.value, verdict: c.verdict, short: c.short };

const manifest: Any = {
  id: 'fixture', name: 'Fixture', version: '1.0.0',
  fields: [
    { key: 'latency', label: 'Latency', type: 'number', unit: 'ms', metric: { method: 'static', better: 'lower' } },
    { key: 'errors', label: 'Errors', type: 'integer', metric: { method: 'static', better: 'lower' } },
  ],
  health: { default: 'good', rules: [
    { when: { field: 'latency', gt: 400 }, health: 'bad', reason: 'Latency {latency} ms' },
    { when: { field: 'latency', gt: 300 }, health: 'watch', reason: 'Latency {latency} ms is slow' },
  ] },
};
const at = { feature: 'checkout', lens: 'fixture' };
const P = (id: string, x: Any): Any => ({ id, run_id: 'r1', feature: 'checkout', lens: 'fixture', metric: 'latency', title: 'Fix ' + id, standard: 'none', kind: 'improvement', status: 'proposed', created_at: '2026-10-01', updated_at: '2026-10-01', ...x });
const values = { latency: 420 };
const step = clearPath(manifest, values).steps[0];

// 1. the step the fixture solves to: latency 420 -> at most 400 (clears BAD); the watch rule is beyond it
expect(J(step && { field: step.field, now: step.now, target: step.target, op: step.op }) === J({ field: 'latency', now: 420, target: 400, op: 'at most' }), 'fixture: latency 420 -> at most 400 (got ' + J(step) + ')');

// 2. the four verdicts the scope names
{
  const A = coverStep(step, [P('A', { status: 'approved', expected_delta: -80 })], values, manifest, at);
  expect(A?.covered === true && J(pick(A.best)) === J({ id: 'A', phase: 'expected', value: 340, verdict: 'clears', short: 0 }), 'A (-80) clears (got ' + J(A) + ')');
  const B = coverStep(step, [P('B', { status: 'proposed', expected_delta: -10 })], values, manifest, at);
  expect(B?.covered === true && J(pick(B.best)) === J({ id: 'B', phase: 'expected', value: 410, verdict: 'short', short: 10 }), 'B (-10) is short by 10 (got ' + J(B) + ')');
  const C = coverStep(step, [P('C', { status: 'done', expected_delta: -5, after_value: 390 })], values, manifest, at);
  expect(C?.covered === true && J(pick(C.best)) === J({ id: 'C', phase: 'delivered', value: 390, verdict: 'clears', short: 0 }), 'C (done, after 390) delivered and cleared, judged on the after value not the delta (got ' + J(C) + ')');
  // the watch rule on the same field is its own step (at most 300): the same proposal falls 40 short of it
  const wst = clearPath(manifest, values).steps[1], A2 = wst && coverStep(wst, [P('A', { status: 'approved', expected_delta: -80 })], values, manifest, at);
  expect(wst?.rule === 'watch' && wst.target === 300 && A2?.best?.verdict === 'short' && A2.best.short === 40, 'A against the watch step (at most 300) is short by 40 (got ' + J(A2) + ')');
  const N = coverStep(step, [], values, manifest, at);
  expect(J(N) === J({ covered: false }), 'no proposal -> uncovered (got ' + J(N) + ')');
  const W = coverStep(step, [P('W', { expected_delta: 30 })], values, manifest, at);
  expect(W?.best?.verdict === 'worse', 'a delta the wrong way makes it worse (got ' + J(W) + ')');
  const U = coverStep(step, [P('U', {})], values, manifest, at);
  expect(U?.covered === true && U.best.phase === 'unsized' && U.best.verdict === null, 'no expected delta -> covered, unsized (got ' + J(U) + ')');
  // the delivered value is evidence about the proposal, never the feature's reading: values are left untouched
  expect(values.latency === 420, 'coverStep does not write the after value into the values');
}

// 3. which proposals count: same feature, lens and metric; open or built statuses only
{
  const noise = [
    P('x1', { feature: 'other', expected_delta: -80 }), P('x2', { lens: 'other', expected_delta: -80 }), P('x3', { metric: 'errors', expected_delta: -80 }),
    P('x4', { status: 'declined', expected_delta: -80 }), P('x5', { status: 'failed', expected_delta: -80 }), P('x6', { status: 'descoped', expected_delta: -80 }), P('x7', { status: 'rework', expected_delta: -80 }),
  ];
  const r = coverStep(step, noise, values, manifest, at);
  expect(J(r) === J({ covered: false }), 'other feature / lens / metric and declined, failed, descoped, rework items do not cover (got ' + J(r) + ')');
  const ok = ['proposed', 'approved', 'executing', 'done', 'accepted', 'released'].map((s) => coverStep(step, [P('s', { status: s, expected_delta: -80 })], values, manifest, at)?.covered);
  expect(ok.every((x) => x === true), 'proposed, approved, executing, done, accepted and released items cover (got ' + J(ok) + ')');
  const all = coverStep(step, [P('B', { expected_delta: -10 }), P('W', { expected_delta: 30 }), P('A', { status: 'approved', expected_delta: -80 })], values, manifest, at);
  expect(all?.best?.id === 'A' && all.all.length === 3 && J(all.all.map((c: Any) => c.id)) === J(['A', 'B', 'W']), 'several: the clearing one is best, then short, then worse (got ' + J(all?.all?.map(pick)) + ')');
}

// 4. a step is judged with the rest of its path taken: an `any` rule over two fields needs both moved
{
  const m2: Any = { ...manifest, health: { default: 'good', rules: [{ when: { any: [{ field: 'latency', gt: 400 }, { field: 'errors', gt: 5 }] }, health: 'bad', reason: 'Slow or failing' }] } };
  const v2 = { latency: 420, errors: 9 }, steps = clearPath(m2, v2).steps, ls = steps.find((s: Any) => s.field === 'latency');
  const r = ls && coverStep(ls, [P('A', { expected_delta: -80 })], v2, m2, at);
  expect(steps.length === 2 && r?.best?.verdict === 'clears', 'any(latency, errors): the latency fix clears its step while errors is still unfixed (got ' + J(r) + ')');
}

// 5. the lens tab renders one chip per step (Kettle, server-rendered with the check-overlays stub engine)
{
  const { createRequire } = await import('node:module');
  const req = createRequire(path.join(ROOT, 'package.json'));
  const React: Any = req('react'), { renderToString }: Any = req('react-dom/server');
  const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
  const { buildModel } = await core('model/sample.ts');
  const M = buildModel(1, () => 0, null), KP = M.P;
  const { initialState } = await imp('engine/state.ts');
  const { EngineCtx, VariantCtx } = await imp('components/hooks.ts');
  const { getVariant } = await imp('variants/registry.ts');
  const { LensTab } = await imp('components/page/LensTab.tsx');
  const S = { ...initialState(1, KP.asOf), ready: true, view: 'design' };
  const E = {
    M, S, U: 1, SAFE: { l: 0, t: 0, r: 1280, b: 800 }, FW: 1280, FH: 800,
    store: { get: () => S, subscribe: () => () => {} },
    setHoverEl() {}, placeHover() {}, dirty() {}, onFrame: () => () => {}, onSimTime: () => () => {}, flyToFeature() {},
    placeById: () => null, lensIds: Object.keys(KP.LENS), lensAgg: () => ({ parts: [] }), channel: () => null, setView() {}, setTime() {},
  };
  const keep = console.error; console.error = () => {};
  let html = '';
  try { html = renderToString(React.createElement(VariantCtx.Provider, { value: getVariant('subtle') }, React.createElement(EngineCtx.Provider, { value: E }, React.createElement(LensTab, { lens: 'design', f: KP.F['email-password-sign-in'] })))).replace(/<!-- -->/g, ''); }
  catch (e) { html = 'THREW ' + (e as Error).message; } finally { console.error = keep; }
  const ol = (html.match(/<ol class="pg-clr">(.*?)<\/ol>/) || [])[1] ?? '';
  const lis = [...ol.matchAll(/<li>(.*?)<\/li>/g)].map((x) => x[1]);
  expect(lis.length > 0 && lis.every((li) => (li.match(/class="cov /g) ?? []).length === 1), 'the lens tab shows one cover chip per step (' + lis.length + ' steps: ' + J(lis.map((x) => x.replace(/<[^>]+>/g, ' '))) + ')');
}

// 6. lenses are data
{
  const src = fs.readFileSync(path.join(ROOT, 'packages/core/src/standard/cover.ts'), 'utf8');
  expect(!/business|design|development|operations|performance|quality|security/.test(src), 'cover.ts names no lens id');
}

if (failures.length) { console.error('FAIL check-clear-cover\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('check-clear-cover: ' + held + ' expectations held');
