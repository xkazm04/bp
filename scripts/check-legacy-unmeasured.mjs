// Checks that the shaped and bold prototypes never state a fact for a lens that was not measured
// (docs/blueprint-ui.md: lenses are data, 'unmeasured' is a health of its own):
//   1. bl() (src/variants/base/legacy.ts) on a feature with NO facet: no field may carry a default that
//      reads as a measurement ('PUBLIC' data, 'none' environment, value 1, ...). Unknown = '' (or 0 for the
//      1..5 value, which sits outside its scale). openBugs counts stay 0 (a count has no unknown), so the
//      census counts only the other fields.
//   2. content() of all 12 shaped and bold built-in channels on that feature: the only part is 'NOT MEASURED',
//      and there is no stamp.
//   3. the other arm: on a feature whose facets are all present and healthy, no channel says NOT MEASURED, and
//      with ONE facet present only that lens speaks.
// Run: node scripts/check-legacy-unmeasured.mjs   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// The variants import src/lib/model, which uses TypeScript parameter properties: strip-only mode cannot load
// them, so this check re-runs itself under --experimental-transform-types.
if (!process.execArgv.includes('--experimental-transform-types')) {
  const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooks = `
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = ${JSON.stringify(ROOT)};
const tryFile = (p) => { for (const c of [p, p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return null; };
export async function resolve(spec, ctx, next) {
  let base = null;
  if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2));
  else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:')) base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
  if (base) { const f = tryFile(base); if (f) return { url: pathToFileURL(f).href, shortCircuit: true, format: f.endsWith('.json') || f.endsWith('.jsonl') ? 'module' : undefined }; }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith('.json') || url.endsWith('.jsonl')) {
    const text = fs.readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', source: url.endsWith('.json') ? 'export default ' + text : 'export default ' + JSON.stringify(text), shortCircuit: true };
  }
  return next(url, { ...ctx, importAttributes: {} });
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { bl } = await imp('src/variants/base/legacy.ts');
const shaped = (await imp('src/variants/shaped/channels.ts')).CHANNELS;
const bold = (await imp('src/variants/bold/channels.ts')).CHANNELS;

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const LENSES = ['business', 'design', 'development', 'operations', 'security', 'quality'];
const feature = (lens) => ({ id: 'f', slug: 'f', name: 'F', stage: 'live', lens });
const live = { rolloutPct: 0, progressPct: 0, value: () => undefined };
const NM = 'NOT MEASURED';

// ---- 1. the field census on a feature with no facet
const empty = bl(feature({}));
const flat = [];
for (const [lens, o] of Object.entries(empty)) for (const [k, v] of Object.entries(o)) {
  if (k === 'health' || k === 'openBugs') continue; // health is 'unmeasured' already; counts stay 0
  flat.push([lens + '.' + k, v]);
}
// a field "asserts a value" when it is a non-empty string, or the rating `value` (1..5 scale) is not 0
const asserts = flat.filter(([k, v]) => (typeof v === 'string' && v !== '') || (k === 'business.value' && v !== 0));
check('bl(no facet): no field asserts a value', asserts.length === 0, `${asserts.length} of ${flat.length}: ` + asserts.map(([k, v]) => k + '=' + JSON.stringify(v)).join(', '));
check('bl(no facet): every health is unmeasured', LENSES.every((l) => empty[l].health === 'unmeasured'));

// ---- 2. content() on a feature with no facet
const bare = feature({});
let said = 0;
for (const [vn, ch] of [['shaped', shaped], ['bold', bold]]) for (const l of LENSES) {
  const c = ch[l].content(bare, live);
  const ok = c.parts.length === 1 && c.parts[0] === NM && c.stamp === undefined;
  if (!ok) said++;
  check(`${vn}.${l}.content(no facet) is only ${NM}`, ok, JSON.stringify(c));
}

// ---- 3. the measured arm
const VALUES = {
  business: { value: 4, customerRequests30d: 3, revenueLink: 'direct', mrrImpactUsd: 2000 },
  design: { status: 'hi-fi', a11y: 'pass' },
  development: { status: 'in-dev', progressPct: 40, aiAuthoredPct: 20, openPRs: 2, unitCoveragePct: 71 },
  operations: { environment: 'production', p95ms: 120, alerting: true },
  security: { dataClass: 'payment', review: 'passed' },
  quality: { status: 'passing', e2eTests: 10, e2ePassing: 9, openBugsP1: 1 },
};
const lensOf = (l) => ({ h: 'good', v: VALUES[l], whyFields: [], facet: l });
const full = feature(Object.fromEntries(LENSES.map((l) => [l, lensOf(l)])));
for (const [vn, ch] of [['shaped', shaped], ['bold', bold]]) for (const l of LENSES) {
  const c = ch[l].content(full, live);
  check(`${vn}.${l}.content(measured) speaks`, c.parts.length > 0 && !c.parts.includes(NM) && c.parts.every((p) => p !== ''), JSON.stringify(c));
}
const one = feature({ security: lensOf('security') });
for (const [vn, ch] of [['shaped', shaped], ['bold', bold]]) for (const l of LENSES) {
  const c = ch[l].content(one, live), nm = c.parts.length === 1 && c.parts[0] === NM;
  check(`${vn}.${l}.content(only security measured)`, l === 'security' ? !nm : nm, JSON.stringify(c));
}

console.log(`check-legacy-unmeasured: bl census ${asserts.length} of ${flat.length} fields assert a value; ${said} of 12 channels say more than ${NM} with no facet; ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
