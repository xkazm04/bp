// Pins the feature page's as-of read model: the stage replays from the events log (reusing stageAt), a metric
// reads its last reading on or before the date, and everything with no history is "none", never the now-value.
// It also pins CONSUMPTION: every feature-detail root renders <AsOfBar /> (see the last section).
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
const { stageView, valueView, readingsUpTo } = (await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/timeview.ts')).href)) as Any;

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

if (failures.length) { console.error('FAIL check-timeview\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('check-timeview: ' + held + ' expectations held');
