// The findings ledger's performance budgets, counted, never timed (ai-registry/skills/contest/references/port-quality.md, Q4):
//   1. the chunk: nothing `/` imports statically reaches the ledger page or the release train (src/components/ledger/
//      LedgerPage.tsx, src/components/ledger/train/**); Phone.tsx's LedgerPageLazy is the one door, a dynamic import;
//   2. the DOM at 10x: a synthetic snapshot of 1,000 backlog findings and 120 pack items in 10 packs (every item with
//      before/after readings and four screens, every fifth measured in three baseline runs) is server-rendered through
//      the real components (PackTable, Triage, ComparePanel with its diff closed) against the Kettle map; each element
//      count must stay within its budget (the measured value when set, plus ~10 % headroom);
//   3. --bundle <distDir> [--before <distDir>]: a production build's first-load assets of `/` (the scripts and styles
//      server/app/index.html names) must not carry the ledger's code (the marker `tr-cmp`, the compare panel's class,
//      which only the ledger has); prints their bytes (raw and gzip), the ledger's own chunks, and the change against
//      a build of the commit before. Build with `NEXT_DIST_DIR=.next-wp5b npx next build` (then restore tsconfig.json,
//      which the build edits).
// The J/K render count (a step re-renders the two rows involved, nothing else) needs a browser: docs/blueprint-ui.md
// "Findings ledger" names how it was counted.
// Run: node scripts/check-train-budget.ts [--bundle <distDir> [--before <distDir>]]  (Node's type stripping;
// scripts/overlays-loader.mjs transpiles src/**/*.tsx). Exit 1 when a budget is broken.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { stripComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// ------------------------------------------------------------------------------------------- 1. the static import graph
const EXT = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;   // a package
  for (const e of EXT) { const p = base + e; if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; }
  return null;
}
/** Static value imports and re-exports (`import type` and `export type` erase); the regex is anchored per line. */
function statIn(file: string, src: string): string[] {
  const stat: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
    if (m[2]) continue;
    if (m[1] === 'export' && !m[3]) continue;
    const r = resolveSpec(file, m[4]); if (r) stat.push(r);
  }
  return stat;
}
/** The split points: every `import('./x')`. */
const dynIn = (file: string, src: string): string[] => [...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].flatMap((m) => resolveSpec(file, m[1]) ?? []);
/**
 * The two sides are read differently on purpose.
 *   dyn  is an expectation that must MATCH (`doors.has(LEDGER)`), so it reads the source with its comments removed
 *        (scripts/lib/source.ts): over raw text a commented-out `import('./ledger/LedgerPage')` is counted as the
 *        door, and the check passes for a tree whose only door has been deleted. The control below proves that.
 *   stat feeds an expectation that must NOT match (nothing reaches the ledger statically), where a comment can only
 *        ADD a reach - strictly conservative - and the shared stripper drops the newlines inside a block comment,
 *        which would unanchor the per-line regex and HIDE a real static import. So it reads the file as written.
 */
const staticDeps = (file: string, raw = fs.readFileSync(file, 'utf8')): { stat: string[]; dyn: string[] } =>
  ({ stat: statIn(file, raw), dyn: dynIn(file, stripComments(raw)) });
const entries = ['app/page.tsx', 'app/layout.tsx'].map((p) => path.join(SRC, p)).filter((p) => fs.existsSync(p));
const reached = new Set<string>(), doors = new Map<string, string>();
for (const todo = [...entries]; todo.length; ) {
  const f = todo.pop()!;
  if (reached.has(f)) continue;
  reached.add(f);
  const d = staticDeps(f);
  todo.push(...d.stat);
  for (const x of d.dyn) if (!doors.has(x)) doors.set(x, f);
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
const LEDGER = path.join(SRC, 'components', 'ledger', 'LedgerPage.tsx'), TRAIN = path.join(SRC, 'components', 'ledger', 'train') + path.sep;
const leaked = [...reached].filter((p) => p === LEDGER || p.startsWith(TRAIN)).map(rel);
expect(!leaked.length, `\`/\` imports the ledger statically: ${leaked.slice(0, 6).join(', ')}${leaked.length > 6 ? ' …' : ''}`);
expect(doors.has(LEDGER), 'nothing imports ledger/LedgerPage.tsx dynamically: the ledger page cannot load');
console.log(`chunk   / reaches ${reached.size} modules statically, ${leaked.length ? leaked.length + ' of them the ledger page or train/**' : 'none of the ledger page or train/**'}; the ledger loads through ${doors.has(LEDGER) ? rel(doors.get(LEDGER)!) : '(nothing)'}`);
// The matcher stopped biting? The door is an expectation that must MATCH, so comment out the real `import()` in the
// file that holds it and leave the spelling in a comment: stripped, the door must be gone; raw, it survives (the blindness).
{
  const door = doors.get(LEDGER), raw = door ? fs.readFileSync(door, 'utf8') : '';
  const seeded = raw.replace(/import\((\s*['"][^'"]*LedgerPage['"]\s*)\)/, '/* import($1) */ noDoor()');
  // through staticDeps itself, so the control fails if the read ever stops stripping
  expect(!!door && seeded !== raw && dynIn(door, seeded).includes(LEDGER) && !staticDeps(door, seeded).dyn.includes(LEDGER),
    'control: a commented-out dynamic import of the ledger must not count as its door (the comments are stripped first)');
}

// ------------------------------------------------------------------------------------------- 3. the bundle (optional)
interface FirstLoad { files: { name: string; raw: number; gz: number; marker: boolean }[]; js: number; jsGz: number; css: number; cssGz: number; ledger: { name: string; raw: number; gz: number }[] }
const MARKER = 'tr-cmp';
function firstLoad(dist: string): FirstLoad {
  const html = fs.readFileSync(path.join(dist, 'server', 'app', 'index.html'), 'utf8');
  const names = [...new Set([...html.matchAll(/\/_next\/(static\/[^"'\s)]+?\.(?:js|css))/g)].map((m) => m[1]))];
  const size = (p: string) => { const b = fs.readFileSync(p); return { raw: b.length, gz: zlib.gzipSync(b, { level: 9 }).length, marker: b.includes(MARKER) }; };
  const files = names.map((n) => ({ name: n, ...size(path.join(dist, n)) }));
  const sum = (ext: string, k: 'raw' | 'gz') => files.filter((f) => f.name.endsWith(ext)).reduce((a, f) => a + f[k], 0);
  const chunks = path.join(dist, 'static', 'chunks');
  const ledger = fs.readdirSync(chunks).filter((n) => /\.(js|css)$/.test(n)).map((n) => ({ name: 'static/chunks/' + n, ...size(path.join(chunks, n)) })).filter((f) => f.marker).map(({ name, raw, gz }) => ({ name, raw, gz }));
  return { files, js: sum('.js', 'raw'), jsGz: sum('.js', 'gz'), css: sum('.css', 'raw'), cssGz: sum('.css', 'gz'), ledger };
}
const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';
const bundle = arg('--bundle');
if (bundle) {
  const after = firstLoad(path.resolve(bundle)), before = arg('--before') ? firstLoad(path.resolve(arg('--before')!)) : null;
  const carry = after.files.filter((f) => f.marker).map((f) => f.name);
  expect(!carry.length, `\`/\`'s first-load assets carry the ledger (${MARKER}): ${carry.join(', ')}`);
  expect(after.ledger.length > 0, `no chunk of ${bundle} carries ${MARKER}: is it a build of this repo?`);
  const line = (k: string, x: FirstLoad) => console.log(`bundle  ${k.padEnd(6)} / first load: JS ${kb(x.js)} (gzip ${kb(x.jsGz)}) in ${x.files.filter((f) => f.name.endsWith('.js')).length} files, CSS ${kb(x.css)} (gzip ${kb(x.cssGz)}); ${x.files.filter((f) => f.marker).length} carry ${MARKER}`);
  if (before) line('before', before);
  line('after', after);
  if (before) console.log(`bundle  change  JS ${kb(after.js - before.js)} (gzip ${kb(after.jsGz - before.jsGz)}), CSS ${kb(after.css - before.css)} (gzip ${kb(after.cssGz - before.cssGz)})`);
  for (const f of after.ledger) console.log(`bundle  ledger chunk ${f.name}  ${kb(f.raw)} (gzip ${kb(f.gz)}), loaded when the ledger opens`);
}

// ------------------------------------------------------------------------------------------- 2. the DOM at 10x
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
// the lens glyph draws into a canvas while it renders (LensGlyph's useMemo): a canvas that accepts every call stands in
const g = globalThis as Any;
const ctx2d: Any = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 6 }) : () => {}), set: () => true });
g.window ??= { devicePixelRatio: 1 };
g.document ??= { documentElement: {}, createElement: () => ({ getContext: () => ctx2d, toDataURL: () => 'data:image/png;base64,' }) };
g.getComputedStyle ??= () => ({ getPropertyValue: () => '' });

const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react'), { renderToString }: Any = req('react-dom/server');
const h = React.createElement;
const { buildModel } = await impCore('src/model/sample.ts');
const { initialState } = await imp('engine/state.ts');
const { EngineCtx, VariantCtx, LiveCtx } = await imp('components/hooks.ts');
const { getVariant } = await imp('variants/registry.ts');
const { useLedger, setLedgerUi, EMPTY_UI } = await imp('components/ledger/useLedger.ts');
const { PackTable } = await imp('components/ledger/train/PackTable.tsx');
const { Triage } = await imp('components/ledger/variants/Triage.tsx');
const { ComparePanel } = await imp('components/ledger/train/compare/ComparePanel.tsx');

const M = buildModel(1, () => 0, null), P = M.P;
const feats: string[] = P.base.features.map((f: Any) => f.slug), lenses: string[] = P.lenses.map((l: Any) => l.id);
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const at = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString();
const BACKLOG = ['proposed', 'approved', 'declined', 'done'] as const, ITEM = ['done', 'done', 'done', 'failed', 'accepted', 'rework', 'descoped'] as const;
const BODY = '## Summary\nThe row reads its state by shape.\n\n## Description\nA synthetic finding for the budget check.\n\n## Expected impact\nOne metric moves.';
const proposals: Any[] = [], packs: Any[] = [], measurements: Any[] = [], shots: Any[] = [];
for (let i = 0; i < 1000; i++) {
  proposals.push({ id: 'b-' + i, run_id: 'r-scan', feature: pick(feats), lens: pick(lenses), metric: 'm' + (i % 7), title: 'Backlog finding ' + i + ' on a synthetic feature',
    body: BODY, standard: 'house:rows/state-marks', expected_delta: 1 + (i % 9), size: pick(['XS', 'S', 'M', 'L'] as const), risk: 1 + (i % 10), kind: 'fix', status: pick(BACKLOG), created_at: at(i), updated_at: at(i) });
}
let mid = 0;
for (let k = 0; k < 10; k++) {
  const lens = lenses[k % lenses.length], id = 'k-syn-' + (k + 1);
  packs.push({ id, lens, n: k + 1, branch: 'pack/syn-' + (k + 1), base_ref: 'main', base_sha: 'abcdef1234567' + k, status: 'open', created_at: at(2000 + k), updated_at: at(2000 + k) });
  for (let j = 0; j < 12; j++) {
    const pid = id + '-' + j, feature = pick(feats), metric = 'm' + (j % 5), runs = j % 5 === 0 ? 3 : 1;
    proposals.push({ id: pid, run_id: 'r-exec', feature, lens, metric, title: 'Pack item ' + j + ' of ' + id, body: BODY, standard: 'house:rows/state-marks', expected_delta: 3, size: 'S', risk: 3, kind: 'fix',
      status: pick(ITEM), pack_id: id, commit_sha: (k * 100 + j).toString(16).padStart(7, '0') + 'deadbeef', created_at: at(3000 + k * 12 + j), updated_at: at(3000 + k * 12 + j) });
    for (let r = 0; r < runs; r++) measurements.push({ id: ++mid, run_id: 'r-exec', feature, lens, metric, value: 90 + r * 4, unit: 'ms', method: 'probe', measured_at: at(4000 + mid), proposal_id: pid, phase: 'before' });
    measurements.push({ id: ++mid, run_id: 'r-exec', feature, lens, metric, value: 70, unit: 'ms', method: 'probe', measured_at: at(4000 + mid), proposal_id: pid, phase: 'after' });
    for (const phase of ['before', 'after']) for (const theme of ['light', 'dark']) shots.push({ id: ++mid, run_id: 'r-exec', feature, path: `shots/r-exec/${feature}-${theme}-desktop-${phase}.png`, size: 'desktop', theme, captured_at: at(4000 + mid), proposal_id: pid, phase });
  }
}
const scan = { runs: [], measurements, proposals, activity: [], shots, coverage: [], packs, releases: [] };
const live = { slug: 'synthetic', product: { status: 'live', events: '', jobs: [], scan } };
const S = { ...initialState(1, P.asOf), ready: true, page: 'ledger', lv: 'triage' };
const E = { M, S, U: 1, store: { get: () => S, subscribe: () => () => {} }, dirty() {}, onFrame: () => () => {}, setPage() {}, flyToFeature() {}, openFeature() {}, lensAgg: () => ({ parts: [] }), channel: () => null };

function Host({ ui, what }: { ui: Any; what: 'packs' | 'backlog' }) {
  const L = useLedger(ui, setLedgerUi);
  return what === 'packs' ? h(PackTable, { L, sample: false, onLenses() {} }) : h(Triage, { L });
}
function render(el: Any): string {
  return renderToString(h(VariantCtx.Provider, { value: getVariant('subtle') }, h(EngineCtx.Provider, { value: E }, h(LiveCtx.Provider, { value: live }, el))));
}
/** Elements in an HTML string (comments and text are not nodes the budget counts). */
const nodes = (html: string) => (html.replace(/<!--[\s\S]*?-->/g, '').match(/<[a-zA-Z]/g) ?? []).length;

const first = proposals.find((p) => p.pack_id && p.metric === 'm1')!.id, perf = proposals.find((p) => p.pack_id && p.id.endsWith('-0'))!.id;
const noop = () => {};
// budget = the measured count when set (2026-10-15: 3,013 / 22,414 / 97 / 243, the same as a browser counts on a 10x
// store), plus ~10 %: a change that grows them past it says so here. The backlog is every row mounted (20 elements
// each, `content-visibility: auto` skips the off-screen ones' layout), J/K needs the focused row in the DOM.
const BUDGETS: [string, number, () => string, number][] = [
  ['In packs table, 120 items in 10 packs', 120, () => render(h(Host, { ui: { ...EMPTY_UI, scope: 'packs' }, what: 'packs' })), 3300],
  ['Backlog table, 1,120 findings', 1120, () => render(h(Host, { ui: { ...EMPTY_UI, scope: 'backlog' }, what: 'backlog' })), 24600],
  ['compare panel, an item with screens, diff closed', 1, () => render(h(ComparePanel, { id: first, view: EMPTY_UI.cmp, wide: false, phone: false, onView: noop, onWide: noop, onClose: noop })), 110],
  ['compare panel, a perf item (runs table), diff closed', 1, () => render(h(ComparePanel, { id: perf, view: EMPTY_UI.cmp, wide: false, phone: false, onView: noop, onWide: noop, onClose: noop })), 270],
];
for (const [what, rows, run, budget] of BUDGETS) {
  let n = -1, err = '';
  try { n = nodes(run()); } catch (e) { err = (e as Error).stack ?? String(e); }
  expect(!err, `${what}: the render threw: ${err.split('\n').slice(0, 4).join(' | ')}`);
  if (err) continue;
  expect(n <= budget, `${what}: ${n} elements, budget ${budget}`);
  console.log(`dom     ${what}: ${n} elements${rows > 1 ? ' (' + (n / rows).toFixed(1) + ' per row)' : ''}, budget ${budget}`);
}

if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(`check-train-budget: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-train-budget: ${held} held`);
