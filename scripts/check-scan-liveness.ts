// Pins the ONE scan-liveness verdict (packages/core/src/scan/liveness.ts): whether a live product's scan is alive,
// stalled, finished, offline or absent, how long it has been silent, and the words every surface says it with. The
// header pill, the phone pill, the timeline strip and clock, the plan's scan outlines and the Agents rail figure all
// read it, so a dead scan reads dead on every surface at the same minute (before this, two thresholds - 5 min in
// Header.tsx, 10 min in scan-views.ts - and two `lastSeen` copies made the five disagree for minutes 5 to 10).
//   1-6  the verdict, its words, the timeline form, the job form and the rail count, against one SILENT_MS
//   7    source pin: no surface under apps/web/src declares its own threshold or `lastSeen`, and the three status
//        surfaces import the verdict from '@bp/core/scan/liveness'
// Run: node scripts/check-scan-liveness.ts   (Node's type stripping). Exit 1 on any failed case.
import fs from 'node:fs';
import path from 'node:path';
import { readStripped } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
const failures: string[] = [];
let held = 0;
const cases: [string, () => void][] = [];
const test = (name: string, fn: () => void) => cases.push([name, fn]);
const expect = (ok: boolean, what: string) => { if (!ok) throw new Error(what); };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let L: any = {}, V: any = {};
try { L = await import('../packages/core/src/scan/liveness.ts'); } catch (e) { failures.push('liveness.ts does not load: ' + (e as Error).message.split('\n')[0]); }
try { V = await import('../apps/web/src/lib/scan/scan-views.ts'); } catch (e) { failures.push('scan-views.ts does not load: ' + (e as Error).message.split('\n')[0]); }

const MIN = 60000, now = Date.parse('2026-10-24T12:00:00Z');
const iso = (ms: number) => new Date(now + ms).toISOString();
const RUN = (p: Record<string, unknown> = {}) => ({ id: 'r1', started_at: iso(-60 * MIN), updated_at: iso(-11 * MIN), status: 'running', phase: 'measure', lenses: ['quality'], ...p });
const ACT = (ms: number, run_id = 'r1') => ({ id: 1, run_id, at: iso(ms), kind: 'reading', text: '' });
const SCAN = (runs: unknown[], activity: unknown[] = []) => ({ runs, activity, measurements: [], proposals: [], shots: [], coverage: [], packs: [], releases: [] });

test('1. a running run silent for 11 min is stalled, and its words say so', () => {
  const v = L.scanLiveness({ status: 'live', scan: SCAN([RUN()]), now });
  expect(v.state === 'stalled', `state ${v.state}, not stalled`);
  expect(v.silentMs >= 11 * MIN, `silentMs ${v.silentMs} < 11 min`);
  expect(L.livenessWords(v).text.startsWith('Stalled'), `words "${L.livenessWords(v).text}" do not start with Stalled`);
});
test('2. the newest sign of life is the max of run.updated_at and that run\'s activity rows', () => {
  const v = L.scanLiveness({ status: 'live', scan: SCAN([RUN()], [ACT(-30 * MIN), ACT(-1 * MIN), ACT(-20 * MIN), ACT(0, 'r0')]), now });
  expect(v.state === 'live', `state ${v.state}, not live`);
  expect(v.silentMs === MIN, `silentMs ${v.silentMs}, not 1 min (another run's row counted, or not the newest)`);
  expect(L.lastSignOfLife(SCAN([RUN()], [ACT(-3 * MIN)]), 'r1', now - 5 * MIN) === now - 3 * MIN, 'lastSignOfLife does not take the newer activity row');
  expect(L.lastSignOfLife(SCAN([RUN()], [ACT(-9 * MIN)]), 'r1', now - 5 * MIN) === now - 5 * MIN, 'lastSignOfLife drops the newer `since`');
});
test('3. a run that ended 2 h ago is finished; the phone form says "Last scan 2 h ago", not "Live scan"', () => {
  const v = L.scanLiveness({ status: 'live', scan: SCAN([RUN({ status: 'done', ended_at: iso(-120 * MIN), updated_at: iso(-120 * MIN) })]), now });
  expect(v.state === 'finished', `state ${v.state}, not finished`);
  const w = L.livenessWords(v, 'short');
  expect(w.text === 'Last scan 2 h ago', `short words "${w.text}"`);
  expect(L.livenessWords(v).text === 'Last scan 2 h ago', `full words "${L.livenessWords(v).text}"`);
  const f = L.scanLiveness({ status: 'live', scan: SCAN([RUN({ status: 'failed', ended_at: iso(-3 * MIN) })]), now });
  expect(f.state === 'failed' && L.livenessWords(f).text === 'Last scan failed 3 min ago' && L.livenessWords(f).cls === 'off', `failed run: ${f.state} / ${L.livenessWords(f).text}`);
});
test('4. the timeline form of the stalled run is STALLED with tone warn, not ● LIVE with tone on', () => {
  const v = L.scanLiveness({ status: 'live', scan: SCAN([RUN()]), now });
  const s = L.scanStatus(v);
  expect(s.base === 'STALLED' && s.tone === 'warn', `base ${s.base}, tone ${s.tone}`);
  const live = L.scanStatus(L.scanLiveness({ status: 'live', scan: SCAN([RUN({ updated_at: iso(-MIN) })]), now }));
  expect(live.base === '● LIVE · MEASURE' && live.tone === 'on' && live.label === live.base, `live run: ${live.label} / ${live.tone}`);
  const off = L.scanStatus(L.scanLiveness({ status: 'offline', scan: SCAN([RUN({ updated_at: iso(-MIN) })]), now }));
  expect(off.base === '● LIVE · MEASURE' && off.label === '● LIVE · MEASURE · RECONNECTING' && off.tone === 'warn', `offline keeps the last-known run: ${off.label} / ${off.tone}`);
  const none = L.scanStatus(L.scanLiveness({ status: 'live', scan: SCAN([]), now }));
  expect(none.base === 'NO RUN' && none.tone === '', `no run: ${none.base}`);
});
test('5. a running job silent for 1 h is stale for the rail count and the plan alike (one SILENT_MS)', () => {
  const job = { id: 'j1', kind: 'measure', lens: 'l', scope: { kind: 'all', label: 'Everything', features: [] }, status: 'running', queued_at: iso(-61 * MIN), started_at: iso(-60 * MIN), run_id: 'r1' };
  const scan = SCAN([RUN()], [ACT(-60 * MIN)]);
  expect(L.jobLiveness(job, scan, now) === 'stale', `jobLiveness ${L.jobLiveness(job, scan, now)}`);
  const fresh = { ...job, id: 'j2', run_id: 'r2', started_at: iso(-MIN) };
  expect(L.runningScans([job, fresh, { ...fresh, id: 'j3', status: 'queued' }], scan, now, null) === 1, 'runningScans counts the stale job (or a queued one)');
  expect(L.runningScans([fresh], scan, now, 'r2') === 0, 'runningScans counts the job of the run already on the plan');
  expect(V.STALE_MS === L.SILENT_MS, `scan-views STALE_MS ${V.STALE_MS} is not SILENT_MS ${L.SILENT_MS}`);
  const BLD = { id: 'b0', i: 0 };
  const GEO = { P: { base: { features: [{ id: 'f1' }] }, scale: 1, buildings: [{ sf: '' }] }, L: { TILE: { f1: { id: 'f1', wing: { bld: BLD } } }, blds: [BLD], bays: [], rooms: [], wings: [] } };
  const r = V.scanViews([job], scan, GEO, () => '#fff', now);
  expect(r.views[0]?.status === 'stale', `scanViews draws ${r.views[0]?.status}`);
  const edge = { ...job, started_at: iso(-L.SILENT_MS) };
  expect(L.jobLiveness(edge, undefined, now) === 'stale' && V.scanViews([edge], undefined, GEO, () => '#fff', now).views[0]?.status === 'stale', 'at exactly SILENT_MS the job and the plan disagree');
});
test('6. offline keeps the run, a store error carries the server text, Kettle is none', () => {
  const off = L.scanLiveness({ status: 'offline', scan: SCAN([RUN({ updated_at: iso(-MIN) })]), now });
  expect(off.state === 'offline' && off.run?.id === 'r1', `offline: ${off.state} / ${off.run?.id}`);
  const err = L.scanLiveness({ status: 'error', structure: {}, error: 'SQLITE_CORRUPT', scan: SCAN([RUN()]), now });
  expect(err.state === 'store-error' && err.error === 'SQLITE_CORRUPT', `error: ${err.state} / ${err.error}`);
  expect(L.livenessWords(err).text === 'Scan store error' && L.livenessWords(err).title === 'SQLITE_CORRUPT', 'store error words');
  expect(L.scanLiveness(null, now).state === 'none' && L.scanLiveness({ now }).state === 'none', 'Kettle (no live product) is not none');
  expect(L.scanLiveness({ status: 'missing', now }).state === 'no-store', 'missing store');
  expect(L.scanLiveness({ status: 'loading', now }).state === 'connecting', 'loading');
});
test('7. source pin: one threshold, one lastSeen, the surfaces import the verdict', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  const bad: string[] = [];
  for (const f of walk(SRC)) {
    const s = readStripped(f), rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (/\b\w*(STALL|STALE|SILENT)\w*\s*=\s*[\d(]/.test(s)) bad.push(rel + ': declares a stall/stale threshold');
    if (/function\s+lastSeen\b/.test(s)) bad.push(rel + ': declares its own lastSeen');
  }
  for (const f of ['components/Header.tsx', 'components/Phone.tsx', 'components/timeline/shared.ts', 'lib/scan/scan-views.ts', 'components/rail/panels.tsx', 'components/rail/wide/agents.tsx']) {
    if (!/from '@bp\/core\/scan\/liveness'/.test(readStripped(path.join(SRC, f)))) bad.push(f + ': does not import from @bp/core/scan/liveness');
  }
  expect(bad.length === 0, bad.join('; '));
});

for (const [name, fn] of cases) {
  try { fn(); held++; } catch (e) { failures.push(name + ': ' + (e as Error).message); }
}
if (failures.length) {
  console.error(`check-scan-liveness: ${failures.length} failure(s), ${held} of ${cases.length} cases held`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-scan-liveness: ${held} of ${cases.length} cases held (one verdict: pill, phone, timeline, plan and rail)`);
