// Pins the hairline's foresight (timeline/changes.ts + scrub.ts hoverAt): what changed each week, shown before travel.
//   - weekChanges replays each week's stage changes from the same stageAt the plan uses (window (weeks[i-1], weeks[i]]),
//     the first week is the baseline, and it agrees with Kettle's own replay on every week and scales with ?scale=N;
//   - changeMarks marks churn the totals sparkline hides (a week whose total holds still while features move);
//   - changeWords says "no stage changes" rather than nothing, counts the moves to live and words a new feature as added;
//   - hoverAt reads a pointer x as a week by scrubAt's rule and is pure, so hovering can never travel;
//   - valueText carries the week's summary for keyboard / screen-reader users, and is unchanged without one;
//   - Strip.tsx draws from the digest (never reads f.revs itself) and useScrub's hover branch never moves time.
// Run: node apps/web/src/components/timeline/check-changes.ts  (scripts/overlays-loader.mjs transpiles src on the fly).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readStripped } from '../../../../../scripts/lib/source.ts';

const HERE = import.meta.dirname, ROOT = path.resolve(HERE, '../../../../..'), SRC = path.join(ROOT, 'apps/web/src');
register(pathToFileURL(path.join(ROOT, 'scripts/overlays-loader.mjs')).href, { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const C: Any = await import(pathToFileURL(path.join(HERE, 'changes.ts')).href).catch(() => null);
const SC: Any = await import(pathToFileURL(path.join(HERE, 'scrub.ts')).href);
const { buildModel } = (await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/sample.ts')).href)) as Any;
const { stageAt } = (await import(pathToFileURL(path.join(ROOT, 'packages/core/src/standard/present.ts')).href)) as Any;
const read = (p: string) => readStripped(path.join(HERE, p));

const cases: [string, () => void][] = [];
const test = (name: string, fn: () => void) => cases.push([name, fn]);
const expect = (ok: boolean, what: string) => { if (!ok) throw new Error(what); };
const mod = (): Any => { if (!C) throw new Error('timeline/changes.ts is missing'); return C; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const NOW = () => Date.parse('2026-10-08T09:00:00Z');
const K1 = buildModel(1, NOW, null), K4 = buildModel(4, NOW, null);

const W3 = ['2026-04-06', '2026-04-13', '2026-04-20'];
const FS = [
  { id: 'a', code: 'A-1', stage: 'in-dev', revs: [{ stage: 'idea', date: '2026-04-06' }, { stage: 'in-dev', date: '2026-04-15' }] },
  { id: 'b', code: 'B-1', stage: 'specified', revs: [{ stage: 'specified', date: '2026-04-06' }] },
];

test('1. synthetic: one move in week 3, none in week 2, week 1 is the baseline', () => {
  const c = mod().weekChanges(FS, W3, W3[2]);
  expect(c.length === 3, 'length ' + c.length);
  expect(c[0].baseline === true && c[0].n === 0, 'week 1: ' + JSON.stringify(c[0]));
  expect(c[1].n === 0 && !c[1].baseline, 'week 2: ' + JSON.stringify(c[1]));
  expect(same(c[2].moves.map((m: Any) => ({ id: m.id, from: m.from, to: m.to })), [{ id: 'a', from: 'idea', to: 'in-dev' }]) && c[2].n === 1, 'week 3: ' + JSON.stringify(c[2]));
});

test('2. Kettle ground truth: every week after the first agrees with the stageAt replay', () => {
  const P = K1.P, c = mod().weekChanges(P.features, P.weeks, P.asOf);
  let agree = 0;
  for (let i = 1; i < P.weeks.length; i++) {
    const want = P.features.filter((f: Any) => stageAt(f, P.weeks[i - 1], P.asOf) !== stageAt(f, P.weeks[i], P.asOf)).map((f: Any) => f.id).sort();
    if (same(c[i].moves.map((m: Any) => m.id).sort(), want) && c[i].n === want.length) agree++;
  }
  expect(agree === P.weeks.length - 1, `${agree} of ${P.weeks.length - 1} weeks agree`);
});

test('3. churn the sparkline hides: a flat-total week with stage changes gets a mark of weight n', () => {
  const P = K1.P, c = mod().weekChanges(P.features, P.weeks, P.asOf), marks = mod().changeMarks(c);
  const tot = new Map(P.snapshots.map((s: Any) => [s.week, s.total]));
  const flat = c.filter((w: Any, i: number) => i > 0 && w.n > 0 && tot.get(w.week) === tot.get(P.weeks[i - 1]));
  expect(flat.length >= 1, 'no flat-total week with changes on Kettle');
  for (const w of flat) { const m = marks.find((x: Any) => x.week === w.week); expect(!!m && m.n === w.n && m.n > 0 && m.w > 0, w.week + ': ' + JSON.stringify(m)); }
  expect(marks.every((m: Any) => m.n > 0 && m.w > 0 && m.w <= 1), 'a mark of weight 0 or above 1');
});

test('4. ?scale=4 multiplies every week\'s changes by 4', () => {
  const a = mod().weekChanges(K1.P.features, K1.P.weeks, K1.P.asOf), b = mod().weekChanges(K4.P.features, K4.P.weeks, K4.P.asOf);
  expect(a.length === b.length && a.every((w: Any, i: number) => b[i].n === 4 * w.n), a.map((w: Any, i: number) => w.n + '/' + b[i].n).join(' '));
});

test('5. changeWords: says "no stage changes", counts moves to live, words a new feature as added', () => {
  const w = mod().changeWords;
  expect(w({ week: 'x', n: 0, baseline: false, moves: [] }) === 'no stage changes', 'n 0: ' + w({ week: 'x', n: 0, baseline: false, moves: [] }));
  const moves = Array.from({ length: 19 }, (_, i) => ({ id: 'f' + i, code: 'F' + i, from: 'in-review', to: i < 6 ? 'live' : 'in-review' }));
  const s = w({ week: 'x', n: 19, baseline: false, moves });
  expect(s.startsWith('19 stage changes') && s.includes('6 to live'), '19/6: ' + s);
  const add = w({ week: 'x', n: 1, baseline: false, moves: [{ id: 'n', code: 'N', from: null, to: 'idea' }] });
  expect(add.includes('1 added') && !add.includes('null'), 'added: ' + add);
});

test('6. hoverAt: nearest week by scrubAt\'s rule, null over the hour or on an inert slider', () => {
  expect(typeof SC.hoverAt === 'function', 'scrub.ts has no hoverAt');
  const day = (d: string) => Date.parse(d + 'T00:00:00Z') / 864e5;
  const g = { h0: 4, h1: 300, o0: 314, o1: 596, hour: true, d0: day(W3[0]), d1: day(W3[2]), weeks: W3, dn: W3.map(day), asOf: W3[2] };
  for (const x of [4, 100, 160, 250, 299]) expect(SC.hoverAt(g, x) === SC.scrubAt(g, x, null, 0).date, 'x ' + x + ': ' + SC.hoverAt(g, x));
  expect(SC.hoverAt(g, 400) === null, 'the hour zone is not null');
  const one = { ...g, hour: false, h1: 596, weeks: ['2026-04-20'], dn: [day('2026-04-20')], d0: day('2026-04-20'), d1: day('2026-04-20'), asOf: '2026-04-20' };
  expect(SC.hoverAt(one, 100) === null, 'a one-week slider without an hour hovers a week');
  expect(SC.hoverAt.length === 2, 'hoverAt takes more than (g, x): it must not reach the engine');
});

// GUARD (green before by design): the 5-argument valueText reads exactly as on HEAD.
test('7a. guard: valueText without a summary is byte-identical', () => {
  const v = SC.valueText;
  expect(v(false, 2, '2026-04-13', 3, false) === 'Revision 2, 2026-04-13', '1');
  expect(v(true, 27, '2026-10-08', 27, true) === 'Now, revision 27; the simulated hour only moves forward', '2');
  expect(v(true, 1, '2026-04-20', 1, false) === 'Now, revision 1; one week of history, nothing earlier to travel to', '3');
});

test('7b. valueText carries the week\'s summary', () => {
  const s = SC.valueText(false, 2, '2026-04-13', 3, false, '19 stage changes');
  expect(s.includes('19 stage changes') && s.startsWith('Revision 2, 2026-04-13'), s);
});

test('8. source contract: Strip reads the digest, and hovering never travels', () => {
  const bad: string[] = [];
  const st = read('Strip.tsx');
  for (const s of ['weekChanges(', 'hoverAt(']) if (!st.includes(s)) bad.push('Strip.tsx does not call ' + s);
  if (st.includes('.revs')) bad.push('Strip.tsx reads .revs itself');
  const sh = read('shared.ts'), at = sh.indexOf('const hover =');
  if (at < 0) bad.push('useScrub has no hover branch (const hover =)');
  else {
    const body = sh.slice(at, sh.indexOf('};', at));
    if (!body.includes('onHover')) bad.push('the hover branch does not call onHover');
    for (const s of ['E.setTime(', 'E.seek(', 'apply(']) if (body.includes(s)) bad.push('the hover branch calls ' + s);
  }
  if (!/onPointerLeave:[^,]*onHover/.test(sh)) bad.push('useScrub does not clear the hover on pointerleave');
  if (!/onPointerMove:[^,]*hover\(/.test(sh)) bad.push('onPointerMove does not hover without a drag');
  expect(bad.length === 0, bad.join('; '));
});

let held = 0;
const failures: string[] = [];
for (const [name, fn] of cases) {
  try { fn(); held++; } catch (e) { failures.push(name + ': ' + (e as Error).message); }
}
if (failures.length) {
  console.error(`check-changes: ${failures.length} failure(s), ${held} of ${cases.length} cases held`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-changes: ${held} of ${cases.length} cases held (weekly digest vs Kettle replay, x4 scale, hidden churn, words, pure hover, valuetext summary, source contract)`);
