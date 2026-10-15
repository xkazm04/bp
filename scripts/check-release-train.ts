// Checks the release train's pure helpers (lens-scan store v2) on hand-built snapshots:
//   - compareOf mirrors store.mjs `compare`: the item's before/after readings ordered (lens, metric, measured_at, id),
//     shots paired by (theme, size) with the latest capture of each phase, readings of other items left out;
//   - the verdict: moved / flat / worse / unmeasured from the lens field's `better` (the manifest), else the sign of the
//     expected delta; no metric or a missing side is unmeasured;
//   - packItems, releaseItems, unreleased and packGroups (counts per status per pack, as store.mjs `packs` reports them);
//   - the version suggestion (references/release.md): tag + patch/minor bump, the manifest version, 0.1.0, a taken version;
//   - an `after` reading is never the feature's current state: derive.ts latestReading and live.ts metricHistory skip it,
//     while before-readings and unlinked readings count.
// Run: node scripts/check-release-train.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FRAME_MS, runStats, betterOf, compareOf, packGroups, packItems, releaseItems, unreleased, awaitingTriage, type LensFields } from '../src/lib/scan/compare.ts';
import { bump, bumpOf, isVersion, suggestVersion, RELEASE_ID } from '../src/lib/scan/release.ts';
import { isCurrent, latestReading } from '../src/lib/scan/derive.ts';
import { emptyScan, type Measurement, type Pack, type Proposal, type Release, type ScanSnapshot, type Shot } from '../src/lib/scan/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// live.ts imports through '@/': the hooks resolve it
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const { metricHistory } = await import(pathToFileURL(path.join(ROOT, 'src/lib/model/live.ts')).href) as typeof import('../src/lib/model/live.ts');

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const T = (h: number, m = 0) => `2026-10-14T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
let mid = 0, sid = 0;
const ms = (feature: string, lens: string, metric: string, value: number, at: string, link?: { p: string; phase: 'before' | 'after' }): Measurement =>
  ({ id: ++mid, run_id: 'r1', feature, lens, metric, value, measured_at: at, ...(link ? { proposal_id: link.p, phase: link.phase } : {}) });
const shot = (p: string, phase: 'before' | 'after' | undefined, at: string, theme?: string, size?: string): Shot =>
  ({ id: ++sid, run_id: 'r1', feature: 'f1', path: `shots/r1/${sid}.png`, captured_at: at, ...(theme ? { theme } : {}), ...(size ? { size } : {}), ...(phase ? { proposal_id: p, phase } : {}) });
const prop = (id: string, o: Partial<Proposal> = {}): Proposal =>
  ({ id, run_id: 'r1', feature: 'f1', lens: 'dev', metric: 'cov', title: id, standard: 'none', kind: 'fix', status: 'done', created_at: T(1), updated_at: T(1), ...o });
const pack = (id: string, lens: string): Pack => ({ id, lens, n: 1, branch: 'pack/' + id.slice(2), base_ref: 'main', base_sha: 'abc', status: 'open', created_at: T(1), updated_at: T(1) });

const LENSES: LensFields[] = [
  { id: 'dev', manifest: { fields: [{ key: 'cov', metric: { better: 'up' } }, { key: 'dupSites', metric: { better: 'down' } }, { key: 'loc' }] } },
];

// ---- compareOf
{
  const scan: ScanSnapshot = {
    ...emptyScan(),
    proposals: [prop('p1'), prop('p2', { metric: 'dupSites' }), prop('p3', { metric: 'cov' }), prop('p4', { metric: undefined }), prop('p5', { metric: 'loc', expected_delta: -50 }), prop('p6', { metric: 'loc' }), prop('p7')],
    measurements: [
      ms('f1', 'dev', 'cov', 50, T(2), { p: 'p1', phase: 'before' }),
      ms('f1', 'dev', 'loc', 900, T(2), { p: 'p1', phase: 'before' }),
      ms('f1', 'dev', 'cov', 55, T(3), { p: 'p1', phase: 'before' }), // a later before wins
      ms('f1', 'dev', 'cov', 70, T(5), { p: 'p1', phase: 'after' }),
      ms('f1', 'dev', 'cov', 60, T(4), { p: 'p1', phase: 'after' }), // stored out of order: the later one (70) wins
      ms('f1', 'dev', 'cov', 99, T(6), { p: 'p9', phase: 'after' }), // another item's
      ms('f1', 'dev', 'cov', 40, T(7)), // unlinked
      ms('f1', 'dev', 'dupSites', 4, T(2), { p: 'p2', phase: 'before' }),
      ms('f1', 'dev', 'dupSites', 6, T(4), { p: 'p2', phase: 'after' }),
      ms('f1', 'dev', 'cov', 50, T(2), { p: 'p3', phase: 'before' }),
      ms('f1', 'dev', 'cov', 50, T(4), { p: 'p3', phase: 'after' }),
      ms('f1', 'dev', 'loc', 900, T(2), { p: 'p5', phase: 'before' }),
      ms('f1', 'dev', 'loc', 800, T(4), { p: 'p5', phase: 'after' }),
      ms('f1', 'dev', 'loc', 900, T(2), { p: 'p6', phase: 'before' }),
      ms('f1', 'dev', 'loc', 800, T(4), { p: 'p6', phase: 'after' }),
      ms('f1', 'dev', 'cov', 50, T(2), { p: 'p7', phase: 'before' }),
    ],
    shots: [
      shot('p1', 'before', T(2), 'dark', '1280'),
      shot('p1', 'after', T(4), 'dark', '1280'),
      shot('p1', 'after', T(5), 'dark', '1280'), // the latest after of (dark, 1280)
      shot('p1', 'before', T(2), 'light', '1280'),
      shot('p1', 'after', T(4)), // no theme or size: its own pair
      shot('p1', undefined, T(4), 'dark', '1280'), // a plain shot: not evidence
      shot('p2', 'after', T(4), 'dark', '1280'),
    ],
  };
  const c = compareOf(scan, 'p1', LENSES)!;
  check('compareOf: before readings ordered (lens, metric, measured_at, id)', c.before.map((m) => m.metric + '=' + m.value).join() === 'cov=50,cov=55,loc=900', c.before.map((m) => m.metric + '=' + m.value).join());
  check('compareOf: after readings of this item only, ordered', c.after.map((m) => m.value).join() === '60,70', c.after.map((m) => m.value).join());
  check('compareOf: verdict moved (cov better up, 55 -> 70), from/to named', c.verdict === 'moved' && c.from?.value === 55 && c.to?.value === 70, JSON.stringify({ v: c.verdict, f: c.from?.value, t: c.to?.value }));
  const pairs = c.shots.map((s) => `${s.theme ?? '-'}/${s.size ?? '-'}:${s.before?.id ?? '-'}>${s.after?.id ?? '-'}`).join(' ');
  check('compareOf: shots paired by (theme, size), the latest of each phase; plain shots and other items left out', pairs === 'dark/1280:1>3 light/1280:4>- -/-:->5', pairs);
  check('compareOf: a pair without theme or size omits the keys', c.shots[2] && !('theme' in c.shots[2]) && !('size' in c.shots[2]));
  check('verdict worse (dupSites better down, 4 -> 6)', compareOf(scan, 'p2', LENSES)?.verdict === 'worse');
  check('verdict flat (50 -> 50)', compareOf(scan, 'p3', LENSES)?.verdict === 'flat');
  check('verdict unmeasured: no metric', compareOf(scan, 'p4', LENSES)?.verdict === 'unmeasured');
  check('verdict: no manifest direction, the expected delta\'s sign (-50, 900 -> 800 moved)', compareOf(scan, 'p5', LENSES)?.verdict === 'moved');
  check('verdict unmeasured: no direction at all', compareOf(scan, 'p6', LENSES)?.verdict === 'unmeasured');
  check('verdict unmeasured: no after reading', compareOf(scan, 'p7', LENSES)?.verdict === 'unmeasured' && compareOf(scan, 'p7', LENSES)?.from === undefined);
  check('compareOf of an unknown id -> null', compareOf(scan, 'nope') === null);
  check('betterOf reads the manifest; a non-metric field is undefined', betterOf(LENSES, 'dev', 'cov') === 'up' && betterOf(LENSES, 'dev', 'loc') === undefined && betterOf(undefined, 'dev', 'cov') === undefined);

  // ---- the addendum: an `after` reading is not the feature's state
  check('isCurrent: after no, before and unlinked yes', !isCurrent({ phase: 'after' }) && isCurrent({ phase: 'before' }) && isCurrent({}));
  check('latestReading skips the after readings (the unlinked 40 at 07:00 is the latest current one)', latestReading(scan, 'f1', 'dev', 'cov')?.value === 40, String(latestReading(scan, 'f1', 'dev', 'cov')?.value));
  const onlyAfter: ScanSnapshot = { ...emptyScan(), measurements: [ms('f2', 'dev', 'cov', 50, T(2), { p: 'p1', phase: 'before' }), ms('f2', 'dev', 'cov', 80, T(9), { p: 'p1', phase: 'after' })] };
  check('latestReading: a newer after does not replace the before', latestReading(onlyAfter, 'f2', 'dev', 'cov')?.value === 50, String(latestReading(onlyAfter, 'f2', 'dev', 'cov')?.value));
  const hist = metricHistory(scan, 'f1', 'dev', 'cov').map((m) => m.value).join();
  check('metricHistory: before and unlinked readings, no after readings', hist === '50,50,50,55,40', hist);
}

// ---- baseline runs: the after against the runs' median, a change within their noise reads flat
{
  const PERF: LensFields[] = [{ id: 'perf', manifest: { fields: [{ key: 'p95', metric: { better: 'down' } }] } }];
  const runs = (p: string, before: number[], after: number) => [
    ...before.map((v, i) => ({ ...ms('f1', 'perf', 'p95', v, T(2, i), { p, phase: 'before' }), unit: 'ms' })),
    { ...ms('f1', 'perf', 'p95', after, T(4), { p, phase: 'after' }), unit: 'ms' },
  ];
  const scan: ScanSnapshot = {
    ...emptyScan(),
    proposals: ['a', 'b', 'c', 'd'].map((id) => prop(id, { lens: 'perf', metric: 'p95' })),
    // Athena's real experiment (80/88/80 -> 64 and 80/184/80 -> 88), the sample's real gain, one run
    measurements: [...runs('a', [80, 88, 80], 64), ...runs('b', [80, 184, 80], 88), ...runs('c', [96, 104, 98], 72), ...runs('d', [80], 76)],
  };
  check('runStats: median, spread, noise = max(spread, one frame) for ms', JSON.stringify(runStats([80, 88, 80], 'ms')) === JSON.stringify({ runs: [80, 80, 88], median: 80, spread: 8, noise: FRAME_MS }));
  check('runStats: no frame floor for a unit that is not ms, or one run', runStats([3, 3], 'states').noise === 0 && runStats([80], 'ms').noise === 0);
  check('runs: 80/88/80 -> 64 is flat (16 within one frame)', compareOf(scan, 'a', PERF)?.verdict === 'flat');
  check('runs: 80/184/80 -> 88 is flat (within the 104 spread)', compareOf(scan, 'b', PERF)?.verdict === 'flat');
  check('runs: 96/104/98 -> 72 moved (26 beyond the 16.7 noise)', compareOf(scan, 'c', PERF)?.verdict === 'moved');
  check('one run: 80 -> 76 moved, as before', compareOf(scan, 'd', PERF)?.verdict === 'moved');
}

// ---- packs and releases
{
  const rel: Release = { id: 'rel-1.0.0', version: '1.0.0', branch: 'release/1.0.0', status: 'draft', created_at: T(1), updated_at: T(1) };
  const scan: ScanSnapshot = {
    ...emptyScan(),
    packs: [pack('k-dev-1', 'dev'), pack('k-sec-1', 'sec'), pack('k-dev-2', 'dev')],
    releases: [rel],
    proposals: [
      prop('b2', { pack_id: 'k-dev-1', status: 'accepted', release_id: 'rel-1.0.0', created_at: T(2) }),
      prop('b1', { pack_id: 'k-dev-1', status: 'done', created_at: T(2) }),
      prop('b3', { pack_id: 'k-dev-1', status: 'failed', created_at: T(1) }),
      prop('b4', { pack_id: 'k-sec-1', lens: 'sec', status: 'accepted', created_at: T(3) }),
      prop('b5', { pack_id: 'k-sec-1', lens: 'sec', status: 'descoped', created_at: T(3) }),
      prop('b6', { status: 'proposed' }),
    ],
  };
  check('packItems: created_at then id', packItems(scan, 'k-dev-1').map((p) => p.id).join() === 'b3,b1,b2');
  check('releaseItems', releaseItems(scan, 'rel-1.0.0').map((p) => p.id).join() === 'b2');
  check('unreleased: accepted with no release', unreleased(scan).map((p) => p.id).join() === 'b4');
  const g = packGroups(scan);
  check('packGroups: every pack in snapshot order, an empty pack with no counts', g.map((x) => x.pack.id).join() === 'k-dev-1,k-sec-1,k-dev-2' && Object.keys(g[2].counts).length === 0);
  check('packGroups: counts per status', JSON.stringify(g[0].counts) === '{"failed":1,"done":1,"accepted":1}' && JSON.stringify(g[1].counts) === '{"accepted":1,"descoped":1}', JSON.stringify(g.map((x) => x.counts)));
  check('packGroups by lens', packGroups(scan, 'sec').map((x) => x.pack.id).join() === 'k-sec-1');
  check('awaitingTriage counts done + failed', awaitingTriage(g[0]) === 2 && awaitingTriage(g[1]) === 0);
}

// ---- the version suggestion
{
  const fix = { kind: 'fix' as const }, up = { kind: 'baseline-upgrade' as const }, cap = { kind: 'fix' as const, body: 'Summary\ncapability: new\n' };
  check('bumpOf: fixes patch, a baseline-upgrade or `capability: new` minor', bumpOf([fix, fix]) === 'patch' && bumpOf([fix, up]) === 'minor' && bumpOf([cap]) === 'minor' && bumpOf([]) === 'patch');
  check('bump drops a pre-release', bump('1.4.0', 'patch') === '1.4.1' && bump('1.4.3', 'minor') === '1.5.0' && bump('2.0.0-beta.1', 'patch') === '2.0.1');
  const s1 = suggestVersion(['v1.4.0', 'v1.3.9'], { version: '9.9.9', file: 'package.json' }, [fix]);
  check('suggest: the latest tag bumped patch', s1.version === '1.4.1' && s1.from === 'v1.4.0', JSON.stringify(s1));
  check('suggest: minor with a baseline-upgrade', suggestVersion(['v1.4.0'], undefined, [fix, up]).version === '1.5.0');
  check('suggest: a tag that is not semver is passed over', suggestVersion(['vNext', 'v0.3.0'], undefined, [fix]).version === '0.3.1');
  const s2 = suggestVersion([], { version: '2.3.0', file: 'src-tauri/Cargo.toml' }, [up]);
  check('suggest: no tag -> the manifest version as it stands', s2.version === '2.3.0' && s2.from === 'src-tauri/Cargo.toml', JSON.stringify(s2));
  check('suggest: nothing -> 0.1.0 from none', JSON.stringify(suggestVersion([], undefined, [])).includes('"version":"0.1.0","from":"none"'));
  const s3 = suggestVersion(['v1.4.0'], undefined, [fix], new Set(['1.4.1', '1.4.2']));
  check('suggest: a version that already has a release is passed over', s3.version === '1.4.3' && /already has a release/.test(s3.reason), JSON.stringify(s3));
  check('isVersion and RELEASE_ID', isVersion('1.4.1') && isVersion('1.0.0-rc.1') && !isVersion('v1.4.1') && !isVersion('1.4') && RELEASE_ID.test('rel-1.4.1') && !RELEASE_ID.test('rel-1.4.1;x') && !RELEASE_ID.test('1.4.1'));
}

console.log(`release train: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
