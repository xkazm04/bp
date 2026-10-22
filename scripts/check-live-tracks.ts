// Checks a live answer's track (src/lib/scan/track.ts, src/lib/model/live-tracks.ts; docs/blueprint-ui.md, "Answer
// tracks"): the marker a decided proposal leaves on its tile until the store has evidence for it.
//   (a) Approve reads `saving` while the POST is out and `approved` once it returns; a 409 shows the decision the store
//       holds (declined elsewhere); a reload (a new model from the store's snapshot) brings the same markers back;
//   (b) Build on a tile with 2 approved + 3 proposed -> the 2 markers read `building` with the job id; the 3 stay
//       proposed and have no marker;
//   (c) baseline 42, expected +10, branch 46 -> "built on branch 46 (expected 52)" and the product's current reading
//       stays 42 (an observation, never the branch's); a current 50 after the release -> "measured 50, expected 52",
//       not confirmed; 53 after it -> confirmed; a reading between the decision and the release is an observation;
//       no metric or no reading since -> unknown, never good;
//   (d) executing -> failed marks the same tile, once, and opens no question;
//   (e) the queue, J/K and the counts hold only proposed items.
// (a)-(b) run the real proposals, dispatch and scans routes and the job registry over the fake Claude Code CLI
// (scripts/fixtures/fake-claude.mjs), reached through the client calls the UI makes (a fetch stub hands them to the
// route handlers), with Kettle's map as the live product's. Run: node scripts/check-live-tracks.ts
// (scripts/overlays-loader.mjs transpiles src; BP_OVERLAYS_MUTATE seeds a defect). Exit 1 on any failure.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readStripped, stripComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_OVERLAYS_MUTATE || '[]') } });
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const TR = await impCore('src/scan/track.ts');
const LS = await imp('lib/model/live-steer.ts');
const J = await impCore('src/server/jobs.server.ts');
const { snapshotOf } = await impCore('src/server/store.server.ts');
const { buildLiveModel } = await impCore('src/model/live-feed.ts');
const { decideProposal } = await imp('lib/scan/client.ts');
const { emptyScan } = await impCore('src/scan/types.ts');
const { lineSuffix } = await impCore('src/model/product.ts');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, detail = '') => { if (ok) held++; else failures.push(what + (detail ? ': ' + detail : '')); };

const map: Any = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8');
const kf = (map.features as Any[]).map((f) => f.slug);
const [FA, FB, FC, FD] = kf;

// ------------------------------------------------------------------ a live product: Kettle's map over a store of its own
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-live-tracks-'));
const pr = path.join(dir, 'prod'), store = path.join(pr, '.ai/lens-scan'), db = path.join(store, 'scan.db');
fs.mkdirSync(store, { recursive: true });
fs.writeFileSync(path.join(store, 'app-structure.json'), JSON.stringify(map));
const T = new Date(Date.now() - 3600000).toISOString(), at = (i: number) => new Date(Date.parse(T) + i * 1000).toISOString();
const w = new DatabaseSync(db);
w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
w.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r0', ?, ?, 'measure', 'done', '[\"development\"]')").run(T, T);
const prop = w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES (?, 'r0', ?, 'development', ?, 'fix', ?, ?, ?)");
// q1 is approved here; q2 is declined by someone else before our approve lands (409); on FB: a1, a2 approved, p1..p3 proposed
for (const [id, f, st, i] of [['q1', FA, 'proposed', 1], ['q2', FA, 'proposed', 2], ['a1', FB, 'approved', 3], ['a2', FB, 'approved', 4],
  ['p1', FB, 'proposed', 5], ['p2', FB, 'proposed', 6], ['p3', FB, 'proposed', 7]] as const) prop.run(id, f, id.toUpperCase() + ' title', st, at(i), at(i));
w.prepare("UPDATE proposals SET decided_by = 'blueprint', decided_at = ? WHERE status = 'approved'").run(at(8));
w.close();
fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'prod', name: 'Prod', root: pr }] }));
const cwd0 = process.cwd();
process.chdir(dir);
const route = (rel: string) => imp('app/api/' + rel);
const props = await route('products/[slug]/proposals/[id]/route.ts'), disp = await route('products/[slug]/dispatch/route.ts');
const fetch0 = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input), 'http://localhost:3000');
  const req = new Request(u, { ...init, headers: { host: 'localhost:3000', ...(init?.headers as Record<string, string> | undefined) } });
  let m: RegExpMatchArray | null;
  if ((m = u.pathname.match(/^\/api\/products\/([^/]+)\/proposals\/([^/]+)$/))) return props.POST(req, { params: Promise.resolve({ slug: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) }) });
  if ((m = u.pathname.match(/^\/api\/products\/([^/]+)\/dispatch$/))) return disp.POST(req, { params: Promise.resolve({ slug: decodeURIComponent(m[1]) }) });
  throw new Error('unrouted request ' + u.pathname);
}) as typeof fetch;

const live = { slug: 'prod', decide: (id: string, body: Any) => decideProposal('prod', id, body) };
const snap = () => snapshotOf(db);
const model = () => { const M = buildLiveModel(map, events, snap(), live, 1, () => 0); M.tracks.feed(snap(), J.list('prod')); return M; };
const marks = (M: Any) => M.tracks.list.map((t: Any) => t.id + ':' + t.stage + ':' + t.label).sort().join(' | ');

try {
  // ---------------------------------------------------------------- (a) saving -> approved; 409; reload
  const M = model();
  expect(!M.tracks.T.q1 && M.sim.decisions.some((d: Any) => d.base === 'q1' && d.open), '(a) before the answer q1 is a question, not a track');
  const sent = M.tracks.decide('q1', { decision: 'approve' }, live.decide);
  expect(M.tracks.T.q1?.stage === 'saving' && M.tracks.T.q1.label.startsWith('saving'), '(a) while the POST is out the tile reads saving', JSON.stringify(M.tracks.T.q1?.label));
  const p = await sent;
  expect(p.status === 'approved' && M.tracks.T.q1?.stage === 'approved' && M.tracks.F[FA]?.[0]?.id === 'q1', '(a) once the POST returns: approved, on its tile', M.tracks.T.q1?.stage);
  // someone else declines q2 first; our approve gets the store's row back with a 409
  const w2 = new DatabaseSync(db); w2.prepare("UPDATE proposals SET status = 'declined', decided_by = 'user:ines', decided_at = ?, updated_at = ? WHERE id = 'q2'").run(at(20), at(20)); w2.close();
  let st409 = 0;
  await M.tracks.decide('q2', { decision: 'approve' }, live.decide).catch((e: Any) => { st409 = e.status; });
  const t2 = M.tracks.T.q2;
  expect(st409 === 409 && t2?.stage === 'declined' && t2.lines.some((l: string) => /Declined by user:ines/.test(l)), '(a) a 409 shows the decision the store holds: declined by user:ines', st409 + ' ' + JSON.stringify(t2 && [t2.stage, t2.lines[0]]));
  M.tracks.feed(snap(), J.list('prod')); // the stream catches up
  const before = marks(M), M2 = model(); // a reload: a new model from the snapshot
  expect(before === marks(M2) && !!M2.tracks.T.q1 && !!M2.tracks.T.q2, '(a) after a reload the same markers come back from the snapshot', before + ' vs ' + marks(M2));
  const failed = await M.tracks.decide('nope', { decision: 'approve' }, live.decide).then(() => 'ok', (e: Any) => e.status);
  expect(failed === 404 && !M.tracks.T.nope && !M.tracks.pending('nope'), '(a) a refusal without a row leaves no marker', String(failed));

  // ---------------------------------------------------------------- (b) build -> building with the job id
  // three slow scans hold the running slots, so the execute job waits queued and its hold is observable
  for (let i = 0; i < 3; i++) J.enqueueMeasure('prod', pr, 'slow', { kind: 'all', label: 'Everything', features: [] });
  M2.tracks.feed(snap(), J.list('prod'));
  const ta = M2.tracks.T.a1;
  expect(ta?.stage === 'approved' && ta.next === 'build', '(b) an approved one offers Build in place', JSON.stringify(ta && [ta.stage, ta.next]));
  const plan = LS.trackPlan(M2.P, ta, J.list('prod'), snap().proposals);
  expect(plan && !plan.off && plan.verb === 'build' && plan.build.join() === 'a1,a2' && plan.title.startsWith('Build what is approved here'), '(b) the next verb is the live Build over its tile: exactly a1 and a2', JSON.stringify(plan && plan.build));
  const res = await LS.runLivePlan({ slug: 'prod', sim: null }, plan);
  const job = J.list('prod').find((j: Any) => j.kind === 'execute');
  M2.tracks.feed(snap(), J.list('prod'));
  const b1 = M2.tracks.T.a1, b2 = M2.tracks.T.a2;
  expect(!!job && res.strong === 'Building 2 approved proposals' && b1?.stage === 'building' && b2?.stage === 'building' && b1.job === job.id && b1.label === 'building · ' + job.id && b2.label === 'building · ' + job.id,
    '(b) the 2 markers read building with the job id', JSON.stringify([res, b1?.label, b2?.label, job?.id]));
  expect(b1.next === 'stop', '(b) a building one offers Stop work here');
  expect(['p1', 'p2', 'p3'].every((id) => !M2.tracks.T[id] && snap().proposals.find((x: Any) => x.id === id).status === 'proposed'), '(b) the 3 proposed stay proposed, with no marker');
  expect(['p1', 'p2', 'p3'].every((id) => TR.trackOf(snap(), id, { jobs: J.list('prod') }) === null), '(b) trackOf: a proposed row is a question, never a track');
  expect(M2.tracks.F[FB].length === 2 && M2.tracks.tileLabel[FB].endsWith('· +1'), '(b) one glyph per tile: the newest, "+1" for the other', M2.tracks.tileLabel[FB]);
} finally {
  for (const j of J.list('prod')) J.cancel('prod', j.id);
  globalThis.fetch = fetch0;
  process.chdir(cwd0);
}

// ------------------------------------------------------------------ (c) the numbers: expected, branch, current, release
const T0 = '2026-10-01T10:00:00Z', h = (n: number) => new Date(Date.parse(T0) + n * 3600000).toISOString();
let mid = 0;
const M_ = (value: number, measured_at: string, x: Any = {}) => ({ id: ++mid, run_id: 'r0', feature: FC, lens: 'development', metric: 'score', value, measured_at, ...x });
const c1 = { id: 'c1', run_id: 'r0', feature: FC, lens: 'development', metric: 'score', title: 'Raise the score', standard: 'none', kind: 'fix', expected_delta: 10,
  status: 'done', decided_by: 'blueprint', decided_at: h(1), pack_id: 'k-dev-1', created_at: T0, updated_at: h(3) };
const base = { ...emptyScan(), packs: [{ id: 'k-dev-1', lens: 'development', n: 1, branch: 'pack/dev-1', base_ref: 'main', base_sha: 'a'.repeat(40), status: 'open', created_at: h(2), updated_at: h(2) }],
  measurements: [M_(42, h(0.5)), M_(42, h(1.5), { proposal_id: 'c1', phase: 'before' }), M_(46, h(2.5), { proposal_id: 'c1', phase: 'after', commit_sha: 'b'.repeat(40) })] };
const built = TR.trackOf({ ...base, proposals: [c1] }, 'c1');
expect(built?.stage === 'built' && built.label === 'built on branch 46 (expected 52)', '(c) built on branch 46 (expected 52)', built?.label);
expect(built.current === 42 && built.evidence === false && built.branch === 46 && built.branchName === 'pack/dev-1', '(c) the product\'s current reading stays 42; the branch reading is labelled with its branch', JSON.stringify([built.current, built.branch, built.branchName]));
expect(built.lines.some((l: string) => /Built on pack\/dev-1: 46 .*not the product/.test(l)) && built.lines.some((l: string) => /Product now: 42.*observation/.test(l)), '(c) the record keeps branch and product apart, the current one an observation', built.lines.join(' | '));
const rel = { id: 'rel-1.0.0', version: '1.0.0', branch: 'release/1.0.0', status: 'tagged', tag: 'v1.0.0', created_at: h(4), updated_at: h(5) };
const released = { ...c1, status: 'released', release_id: 'rel-1.0.0', updated_at: h(5) };
const obs = TR.trackOf({ ...base, releases: [rel], proposals: [released], measurements: [...base.measurements, M_(50, h(4.5))] }, 'c1');
expect(obs?.stage === 'unknown' && obs.evidence === false && obs.lines.some((l: string) => /observation from before the release/.test(l)), '(c) a reading between the decision and the release is an observation: unknown, not confirmed', JSON.stringify([obs?.stage, obs?.label]));
const short = TR.trackOf({ ...base, releases: [rel], proposals: [released], measurements: [...base.measurements, M_(50, h(6))] }, 'c1');
expect(short?.stage === 'not-confirmed' && short.label === 'measured 50, expected 52' && short.next === 'measure', '(c) a current 50 after the release: "measured 50, expected 52", not confirmed', JSON.stringify([short?.stage, short?.label]));
const good = TR.trackOf({ ...base, releases: [rel], proposals: [released], measurements: [...base.measurements, M_(53, h(6))] }, 'c1');
expect(good?.stage === 'confirmed' && good.next === null && good.evidence === true, '(c) 53 after the release meets 52: confirmed', JSON.stringify([good?.stage, good?.label]));
const noMetric = TR.trackOf({ ...base, releases: [rel], proposals: [{ ...released, metric: undefined }] }, 'c1');
expect(noMetric?.stage === 'unknown', '(c) no metric: unknown, never confirmed', noMetric?.stage);
const branchOnly = TR.trackOf({ ...base, releases: [rel], proposals: [released], measurements: [M_(42, h(0.5)), M_(60, h(6), { proposal_id: 'c1', phase: 'after' })] }, 'c1');
expect(branchOnly?.stage === 'unknown', '(c) a branch reading after the release is not the product: unknown', branchOnly?.stage);

// ------------------------------------------------------------------ (d) executing -> failed, (e) proposed-only queue
const dprop = (id: string, status: string, f = FD) => ({ id, run_id: 'r1', feature: f, lens: 'development', title: id, standard: 'none', kind: 'fix', status, decided_at: h(1), created_at: h(0), updated_at: h(1) });
const run = { id: 'r1', started_at: h(0), updated_at: h(0), phase: 'execute', status: 'running', lenses: ['development'] };
const scan1 = { ...emptyScan(), runs: [run], proposals: [dprop('e1', 'executing'), dprop('o1', 'proposed'), dprop('o2', 'proposed', FC)] };
const MD = buildLiveModel(map, events, scan1, live, 2, () => 0);
MD.tracks.feed(scan1, []);
const e0 = MD.tracks.T.e1;
const scan2 = { ...scan1, proposals: [dprop('e1', 'failed'), dprop('o1', 'proposed'), dprop('o2', 'proposed', FC)] };
MD.tracks.feed(scan2, []);
MD.sim.applyFeed((await impCore('src/model/live-feed.ts')).liveSwarm(MD.P, scan2));
const e1 = MD.tracks.T.e1;
expect(e0?.stage === 'building' && e1?.stage === 'failed' && e1.feature === e0.feature && MD.tracks.list.filter((t: Any) => t.id === 'e1').length === 1, '(d) executing -> failed marks the same tile, once', JSON.stringify([e0?.stage, e1?.stage]));
expect(MD.tracks.F[FD + lineSuffix(2, 0)]?.[0]?.id === 'e1' && MD.tracks.F[FD + lineSuffix(2, 1)]?.[0]?.id === 'e1', '(d) at ?scale=2 the marker stands on every product line\'s copy', Object.keys(MD.tracks.F).join());
expect(!MD.sim.decisions.some((d: Any) => d.base === 'e1'), '(d) a failed build opens no question');
const q = MD.sim.queueFor(null, 'general'), bases = new Set(q.all.map((d: Any) => d.base));
expect(bases.size === 2 && bases.has('o1') && bases.has('o2') && MD.sim.cardOrder(null, 'general').every((d: Any) => d.base === 'o1' || d.base === 'o2'), '(e) the queue and J/K hold only the proposed ones', [...bases].join());
const stats = MD.sim.stats(MD.P.features, null, 'general');
expect(stats.asks === 4, '(e) the counts are the proposed ones (2 per product line at scale 2)', String(stats.asks));
const lineA = FD + lineSuffix(2, 0);
expect(!(MD.sim.DOF[lineA] ?? []).some((d: Any) => d.base === 'e1'), '(e) the tile\'s question pins carry no track');

// ------------------------------------------------------------------ the engine and the canvas use them as described
// Read with the comments removed (scripts/lib/source.ts, as the other source-guard checks do): these
// expectations must MATCH, so over raw text a comment naming the call stands in for the call.
const eng = readStripped(path.join(SRC, 'engine/Engine.ts')).replace(/\r\n/g, '\n');
const DECIDES = /tracks\.decide\(pid, body,/;
expect(DECIDES.test(eng), 'Engine.decide sends a live decision through LiveTracks.decide (saving, then the store\'s row)');
expect(/drawPins\(this, ctx, v, lod, now\); drawTracks\(this, ctx, v, lod\);/.test(eng), 'the track layer draws with the pins');
const lay = readStripped(path.join(SRC, 'engine/render/tracks.ts')).replace(/\r\n/g, '\n');
expect(/onView\(v, r, 20\)/.test(lay) && /onView\(v, r, 30\)/.test(lay), 'the track layer is culled to the viewport like the pins (tiles and rooms)');
expect(!/=>\s*\{/.test(lay.slice(lay.indexOf('export function drawTracks'))), 'drawTracks makes no closure per frame');
// the matcher stopped biting? A decide that bypasses the tracks and only names them in a comment must fail the guard.
{
  const real = 'tracks.decide(pid, body,';
  const seeded = eng.replace(real, '/* ' + real + ' */ noTracks(');
  expect(seeded !== eng && DECIDES.test(seeded) && !DECIDES.test(stripComments(seeded)),
    'control: a tracks.decide left only in a comment does not satisfy the guard (the comments are stripped first)');
  expect([eng, lay].every((s) => !/^\s*\/\//m.test(s) && !s.includes('/*')), 'control: the two sources the guards read carry no comment at all');
}

try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
// ------------------------------------------------------------------ tracksOf over a large store: the same answers, a bounded cost
// trackOf reads one proposal's readings; tracksOf asks it for every decided proposal, so a store of N proposals and M readings
// must not cost N x M row visits. The oracle below is the rule written plainly (baseline = the item's latest `before` reading,
// else the latest current one at or before the decision; current = the latest current reading of the feature's metric; branch =
// the latest `after` reading; every "latest" breaks a tie on measured_at by the higher id) and is compared with what tracksOf
// answers, over times drawn from a small set so ties are common. The timing is the cold first call over a fresh table, the minimum of 3.
{
  const gen = (nProps: number, nMeas: number) => {
    let sd = 11; const rnd = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648);
    const feats = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5'], mets = ['m0', 'm1', 'm2'], lns = ['development', 'security'];
    const t = (k: number) => new Date(Date.UTC(2026, 9, 1) + k * 3600000).toISOString();
    const proposals = Array.from({ length: nProps }, (_, i) => ({ id: 'g' + i, run_id: 'r', feature: feats[i % feats.length], lens: lns[i % 2], metric: i % 11 === 0 ? undefined : mets[i % 3], title: 't', standard: 'none', kind: 'fix',
      expected_delta: 5, status: (['done', 'accepted', 'approved', 'failed'] as const)[i % 4], decided_by: 'u', decided_at: t(40 + (i % 5)), created_at: t(0), updated_at: t(50) }));
    const measurements = Array.from({ length: nMeas }, (_, i) => ({ id: i + 1, run_id: 'r', feature: feats[Math.floor(rnd() * 6)], lens: lns[Math.floor(rnd() * 2)], metric: mets[Math.floor(rnd() * 3)],
      value: Math.floor(rnd() * 100), measured_at: t(Math.floor(rnd() * 90)), ...(rnd() < 0.5 ? { proposal_id: 'g' + Math.floor(rnd() * nProps), phase: rnd() < 0.5 ? 'before' : 'after' } : {}) }));
    return { ...emptyScan(), proposals, measurements };
  };
  const late = (xs: Any[]) => xs.reduce((r: Any, m: Any) => (!r || m.measured_at > r.measured_at || (m.measured_at === r.measured_at && m.id > r.id) ? m : r), undefined);
  const NOW = Date.UTC(2026, 9, 5), ms = (f: () => void) => { const a = performance.now(); f(); return performance.now() - a; };
  const small = gen(60, 1500), tr = TR.tracksOf(small, NOW);
  let bad = '';
  for (const t of tr) {
    const p = small.proposals.find((x: Any) => x.id === t.id)!;
    if (!p.metric) { if (t.baseline !== undefined || t.current !== undefined || t.branch !== undefined) bad = bad || t.id + ' has numbers without a metric'; continue; }
    const same = (m: Any) => m.lens === p.lens && m.metric === p.metric, mine = small.measurements.filter((m: Any) => same(m) && m.proposal_id === p.id);
    const cur = small.measurements.filter((m: Any) => same(m) && m.feature === p.feature && m.phase !== 'after');
    const before = late(mine.filter((m: Any) => m.phase === 'before')) ?? late(cur.filter((m: Any) => m.measured_at <= p.decided_at)), after = late(mine.filter((m: Any) => m.phase === 'after')), now = late(cur);
    const want = JSON.stringify([before?.value, now?.value, now?.measured_at, after?.value]), got = JSON.stringify([t.baseline, t.current, t.currentAt, t.branch]);
    if (want !== got) bad = bad || t.id + ': ' + got + ' is not ' + want;
  }
  expect(tr.length > 40 && !bad, 'tracksOf over a generated store (ties on the time) reads baseline, current and branch as the rule says', bad || String(tr.length));
  // cold: each timing is the first call over a fresh table, so the index build is inside it; the minimum of 3
  const run = (np: number, nm: number) => Math.min(...Array.from({ length: 3 }, () => { const sc = gen(np, nm); return ms(() => TR.tracksOf(sc, NOW)); }));
  const t1 = run(20, 500), t2 = run(100, 5000), t3 = run(200, 20000);
  console.log('tracksOf per call: 20 x 500 = ' + t1.toFixed(2) + ' ms, 100 x 5,000 = ' + t2.toFixed(2) + ' ms, 200 x 20,000 = ' + t3.toFixed(2) + ' ms');
  // A wall-clock budget is not an instrument on a machine someone else is working on. This read
  // ~10 ms cold when it was written and 34-36 ms about one run in five once a sibling session
  // started committing in this repo: it failed over contention it never examined, which is the
  // same shape as a gate passing over what it never examined. What the sentence actually claims
  // - ONE PASS over the readings, not one per proposal - is countable, so count it: wrap the
  // readings in a Proxy and count index reads. One pass is O(nMeas); a filter per proposal is
  // O(nProps x nMeas). The seeded control runs the same counter over a deliberately
  // per-proposal pass and requires it to blow the bound, so the counter cannot go blind.
  const visitsOf = (np: number, nm: number, f: (s: Any) => void): number => {
    const sc = gen(np, nm) as Any;
    let visits = 0;
    const raw = sc.measurements as Any[];
    sc.measurements = new Proxy(raw, { get(t: Any, k: Any) { if (typeof k === 'string' && /^[0-9]+$/.test(k)) visits++; return t[k]; } });
    f(sc);
    return visits;
  };
  const BOUND = 20000 * 10;
  const visits = visitsOf(200, 20000, (sc: Any) => { TR.tracksOf(sc, NOW); });
  const quad = visitsOf(200, 20000, (sc: Any) => { for (const p of sc.proposals) (sc.measurements as Any[]).filter((m: Any) => m.proposal_id === p.id); });
  const quadPrint = (): string => quad.toLocaleString();
  console.log('tracksOf reading visits: one pass = ' + visits.toLocaleString() + ', a per-proposal pass = ' + quadPrint() + ' (bound ' + BOUND.toLocaleString() + ')');
  expect(visits < BOUND, 'tracksOf visits the readings a bounded number of times (one pass, not one per proposal)', visits.toLocaleString() + ' visits over 20,000 readings, bound ' + BOUND.toLocaleString());
  expect(quad >= BOUND, 'SEEDED CONTROL: the visit counter catches a per-proposal pass over the readings', quad.toLocaleString() + ' visits');
  // kept as a CEILING, not a budget: it catches a catastrophic regression without failing over load
  expect(t3 < 250, 'tracksOf over 200 proposals x 20,000 readings is not catastrophically slow (the visit bound above is the real assertion)', t3.toFixed(1) + ' ms');
}

// Self-proof, every run: seed a defect into the source this check transpiles (BP_OVERLAYS_MUTATE; the loader skips a mutation
// whose text no longer exists, so a child that passes means the mutation stopped biting) and require the child to fail on the
// rule that defect breaks: track.ts an approved track no longer offers Build.
if (!process.env.BP_OVERLAYS_MUTATE) {
  const seed = [["scan/track.ts", "t.next = 'build'; }", "t.next = 'measure'; }"]];
  const child = spawnSync(process.execPath, [...process.execArgv, import.meta.filename], { env: { ...process.env, BP_OVERLAYS_MUTATE: JSON.stringify(seed) }, encoding: 'utf8', timeout: 120000 });
  expect(child.status === 1 && child.stdout.includes('(b) an approved one offers Build in place'),
    'self-proof: track.ts an approved track no longer offers Build: the check must fail on (b) an approved one offers Build in place (child exit ' + child.status + ')');
}

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-live-tracks: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-live-tracks: ${held} expectations held`);
process.exit(0);
