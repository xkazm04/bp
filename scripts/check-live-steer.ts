// Checks steering a live product (src/lib/model/live-steer.ts; docs/blueprint-ui.md, "Steering a live product"):
//   (a) Measure on a 5-feature target -> one selection scan per scannable lens, each over exactly the 5 slugs, and the
//       preview's slot arithmetic (start now / wait) is what the job registry then does;
//   (b) Stop -> exactly those jobs cancelled; a job outside the target is left alone;
//   (c) Build on a target with 2 approved + 3 proposed proposals -> ONE execute job over exactly the 2; the 3 stay
//       proposed (nothing is approved by it), an approved one outside the target is not taken; with nothing approved
//       the verb is unavailable with a reason;
//   (d) on a live sim the steer list offers no push/pause/resume/order and commitSample never calls sim.commit (a
//       sample sim's does: the spy works); Engine.ts reaches sim.commit only through commitSample and refuses a sample
//       preview on live;
//   (e) liveSwarm over Kettle's map routes a security proposal to jonas (queueFor('jonas').mine), a lens no person
//       reads to the feature's owner, and a map that names nobody to LIVE_DECIDER;
//   (f) after a feed no live agent is left paused, and the proposal its lens agent waits on holds 1 (others 0).
// (a)-(c) run the real routes and job registry over the fake Claude Code CLI (scripts/fixtures/fake-claude.mjs, as
// check-scan-jobs does), reached through the same scan actions the UI calls (a fetch stub hands the client's requests
// to the route handlers). Run: node scripts/check-live-steer.ts (scripts/overlays-loader.mjs transpiles src;
// BP_OVERLAYS_MUTATE seeds a defect, as in check-overlays). Exit 1 on any failure.
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
const LS = await imp('lib/model/live-steer.ts');
const J = await impCore('src/server/jobs.server.ts');
const { MAX_RUNNING, MAX_QUEUED } = await impCore('src/scan/jobs.ts');
const { snapshotOf } = await impCore('src/server/store.server.ts');
const { buildLiveModel, liveSwarm, liveDecider } = await impCore('src/model/live-feed.ts');
const { swarmFromScan } = await imp('lib/scan/client.ts');
const { LIVE_DECIDER, SwarmSim } = await impCore('src/model/sim.ts');
const { lineSuffix } = await impCore('src/model/product.ts');
const { emptyScan } = await impCore('src/scan/types.ts');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, detail = '') => { if (ok) held++; else failures.push(what + (detail ? ': ' + detail : '')); };

// ------------------------------------------------------------------ a live product over the fake CLI
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-live-steer-'));
const pr = path.join(dir, 'prod'), store = path.join(pr, '.ai/lens-scan');
fs.mkdirSync(store, { recursive: true });
const FEATS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'], TARGET = FEATS.slice(0, 5);
// four lenses the fake keeps running (`--lens slow...` sleeps until killed) and one without a scan method
const SLOW = ['slow.a', 'slow.b', 'slow.c', 'slow.d'];
const lensE = (id: string, scan?: object) => ({ id, version: '1.0.0', source: 'project', enabled: true, manifest: { id, ...(scan ? { scan } : {}) } });
const map = { $schema: 'app-structure/3', version: 3, project: { slug: 'prod', name: 'Prod' }, features: FEATS.map((s) => ({ slug: s, name: s.toUpperCase() })),
  lenses: [...SLOW.map((id) => lensE(id, { method: 'judgement', instructions: 'x' })), lensE('com.x.plain')] };
fs.writeFileSync(path.join(store, 'app-structure.json'), JSON.stringify(map, null, 2));
const w = new DatabaseSync(path.join(store, 'scan.db'));
w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
const T = '2026-10-18T09:00:00Z', at = (i: number) => new Date(Date.parse(T) + i * 1000).toISOString();
w.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r0', ?, ?, 'measure', 'done', '[]')").run(T, T);
const prop = w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES (?, 'r0', ?, 'slow.a', 't', 'fix', ?, ?, ?)");
// on the target: a2 approved before a1 (store order is created_at), p1..p3 proposed; off it: o1 approved
for (const [id, f, st, i] of [['a2', 'f2', 'approved', 1], ['a1', 'f1', 'approved', 2], ['p1', 'f3', 'proposed', 3], ['p2', 'f4', 'proposed', 4], ['p3', 'f5', 'proposed', 5], ['o1', 'f8', 'approved', 6]] as const) prop.run(id, f, st, at(i), at(i));
w.close();
fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'prod', name: 'Prod', root: pr }] }));
const cwd0 = process.cwd();
process.chdir(dir);

const route = (rel: string) => imp('app/api/' + rel);
const scans = await route('products/[slug]/scans/route.ts'), del = await route('products/[slug]/scans/[job]/route.ts'), disp = await route('products/[slug]/dispatch/route.ts');
// the client's requests (src/lib/scan/client.ts send) go to the route handlers, as the dev server would route them
const fetch0 = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input), 'http://localhost:3000');
  const req = new Request(u, { ...init, headers: { host: 'localhost:3000', ...(init?.headers as Record<string, string> | undefined) } });
  let m: RegExpMatchArray | null;
  if ((m = u.pathname.match(/^\/api\/products\/([^/]+)\/scans$/))) return scans.POST(req, { params: Promise.resolve({ slug: decodeURIComponent(m[1]) }) });
  if ((m = u.pathname.match(/^\/api\/products\/([^/]+)\/scans\/([^/]+)$/))) return del.DELETE(req, { params: Promise.resolve({ slug: decodeURIComponent(m[1]), job: decodeURIComponent(m[2]) }) });
  if ((m = u.pathname.match(/^\/api\/products\/([^/]+)\/dispatch$/))) return disp.POST(req, { params: Promise.resolve({ slug: decodeURIComponent(m[1]) }) });
  throw new Error('unrouted request ' + u.pathname);
}) as typeof fetch;

const ctx = { slug: 'prod', sim: null };
const lenses = [...SLOW.map((id) => ({ id, name: id, ok: true })), { id: 'com.x.plain', name: 'Plain', ok: false }];
const facts = (features: string[]) => ({ label: 'Room 1', features, lenses, jobs: J.list('prod'), proposals: snapshotOf(path.join(store, 'scan.db')).proposals });
const statusOf = (id: string) => (snapshotOf(path.join(store, 'scan.db')).proposals as Any[]).find((p) => p.id === id);

try {
  // ---------------------------------------------------------------- the slot arithmetic is the registry's
  const job = (status: string) => ({ id: 'x', kind: 'measure', status, queued_at: T });
  const sl = (r: number, q: number, n: number) => { const x = LS.slots([...Array(r).fill(0).map(() => job('running')), ...Array(q).fill(0).map(() => job('queued'))], n); return [x.now, x.wait, x.refused].join('/'); };
  expect(MAX_RUNNING === 3 && MAX_QUEUED === 16 && J.MAX_RUNNING === MAX_RUNNING && J.MAX_QUEUED === MAX_QUEUED, 'the registry and the plan read one set of limits (3 running, 16 queued)', `${MAX_RUNNING}/${MAX_QUEUED} vs ${J.MAX_RUNNING}/${J.MAX_QUEUED}`);
  expect(sl(0, 0, 4) === '3/1/0' && sl(2, 0, 4) === '1/3/0' && sl(3, 15, 4) === '0/1/3' && sl(1, 1, 1) === '1/0/0' && sl(3, 16, 1) === '0/0/1', 'slots: start now / wait / refused', [sl(0, 0, 4), sl(2, 0, 4), sl(3, 15, 4), sl(1, 1, 1), sl(3, 16, 1)].join(' '));

  // ---------------------------------------------------------------- (a) measure
  const pm = LS.planLive('measure', facts(TARGET));
  expect(!pm.off && pm.scans.length === 4 && pm.scans.every((x: Any) => x.features.join() === TARGET.join()) && pm.scans.map((x: Any) => x.lens).join() === SLOW.join(),
    '(a) measure plans one selection scan per scannable lens over the 5 slugs (the lens without a scan method left out)', JSON.stringify(pm.scans));
  expect(pm.lines.some((l: string) => l.startsWith('3 start now, 1 wait')) && pm.lines.some((l: string) => /left out: Plain/.test(l)), '(a) the preview says 3 start now, 1 waits, and which lens is left out', pm.lines.join(' | '));
  const tm = await LS.runLivePlan(ctx, pm);
  const mj = J.list('prod').filter((j: Any) => j.kind === 'measure');
  expect(tm.strong === 'Measuring 4 lenses', '(a) the toast says what started', JSON.stringify(tm));
  expect(mj.length === 4 && mj.every((j: Any) => j.scope.kind === 'selection' && j.scope.features.join() === TARGET.join() && j.scope.label === 'Selection (5)'), '(a) 4 measure jobs, each scope.features = the 5 slugs', JSON.stringify(mj.map((j: Any) => j.scope)));
  expect(mj.filter((j: Any) => j.status === 'running').length === 3 && mj.filter((j: Any) => j.status === 'queued').length === 1, '(a) the registry did what the preview said: 3 running, 1 queued', mj.map((j: Any) => j.status).join());
  const fullQ = LS.planLive('measure', { ...facts(TARGET), jobs: [...Array(3).fill(0).map(() => job('running')), ...Array(16).fill(0).map(() => job('queued'))] });
  expect(!!fullQ.off && /queue is full/.test(fullQ.off), '(a) with the queue full, measure is unavailable and says why', String(fullQ.off));
  expect(!!LS.planLive('measure', facts([])).off, '(a) an empty target plans nothing');

  // ---------------------------------------------------------------- (b) stop
  const outside = J.enqueueMeasure('prod', pr, 'slow.a', { kind: 'feature', id: 'f7', label: 'F7', features: ['f7'] });
  const ps = LS.planLive('stop', facts(TARGET));
  expect(!ps.off && ps.stop.slice().sort().join() === mj.map((j: Any) => j.id).sort().join() && !ps.stop.includes(outside.job.id), '(b) stop plans exactly the target\'s 4 jobs, not the one on f7', JSON.stringify(ps.stop));
  expect(ps.lines[0].startsWith('3 running and 1 queued jobs are cancelled'), '(b) the preview counts them', ps.lines[0]);
  const ts = await LS.runLivePlan(ctx, ps);
  const after = (id: string) => J.list('prod').find((j: Any) => j.id === id)?.status;
  expect(ts.strong === 'Stopped 4 jobs' && mj.every((j: Any) => after(j.id) === 'cancelled'), '(b) those 4 jobs are cancelled', JSON.stringify(ts) + ' ' + mj.map((j: Any) => after(j.id)).join());
  expect(after(outside.job.id) === 'running' || after(outside.job.id) === 'queued', '(b) the job outside the target still runs', String(after(outside.job.id)));
  J.cancel('prod', outside.job.id);
  const wideJ = J.enqueueMeasure('prod', pr, 'slow.b', { kind: 'all', label: 'Everything', features: [] });
  const pw = LS.planLive('stop', facts(['f6']));
  expect(pw.stop.join() === wideJ.job.id && pw.lines.some((l: string) => /outside the selection/.test(l)), '(b) a whole-product scan meets every target, and the preview says it stops elsewhere too', pw.lines.join(' | '));
  J.cancel('prod', wideJ.job.id);
  expect(!!LS.planLive('stop', facts(TARGET)).off, '(b) with nothing running here, stop is unavailable');

  // ---------------------------------------------------------------- (c) build
  const pb = LS.planLive('build', facts(TARGET));
  expect(!pb.off && pb.build.join() === 'a2,a1', '(c) build plans exactly the 2 approved on the target (store order), not o1 off it, none of the 3 proposed', JSON.stringify(pb.build));
  expect(pb.lines.some((l: string) => /3 proposals here are not approved/.test(l)), '(c) the preview says the 3 proposed stay as they are', pb.lines.join(' | '));
  const tb = await LS.runLivePlan(ctx, pb);
  const ej = J.list('prod').filter((j: Any) => j.kind === 'execute');
  expect(tb.strong === 'Building 2 approved proposals' && ej.length === 1 && ej[0].proposals.join() === 'a2,a1', '(c) one execute job over exactly the 2', JSON.stringify(tb) + ' ' + JSON.stringify(ej.map((j: Any) => j.proposals)));
  expect(['p1', 'p2', 'p3'].every((id) => statusOf(id)?.status === 'proposed' && !statusOf(id)?.decided_by), '(c) the 3 proposed stay proposed, undecided', ['p1', 'p2', 'p3'].map((id) => statusOf(id)?.status).join());
  expect(statusOf('o1')?.status === 'approved', '(c) the approved one off the target is untouched');
  const again = LS.planLive('build', facts(TARGET));
  expect(!!again.off && /Review queue/.test(again.off) && !again.build.length, '(c) while that build holds them, build is unavailable: only proposed ones are left, and approving is the Review queue\'s', String(again.off));
  const onlyProposed = LS.planLive('build', facts(['f3', 'f4']));
  expect(!!onlyProposed.off && onlyProposed.off.startsWith('nothing here is approved yet: 2 proposals'), '(c) a target with nothing approved: unavailable with a reason', String(onlyProposed.off));
} finally {
  for (const j of J.list('prod')) J.cancel('prod', j.id);
  globalThis.fetch = fetch0;
  process.chdir(cwd0);
}

// ------------------------------------------------------------------ Kettle's map as a live product
const map3: Any = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8');
const live = { slug: 'kettle-live', decide: async () => { throw new Error('unused'); } };
const kf = map3.features as Any[];
const f0 = kf[0].slug, f1 = kf[1].slug;
const P0 = (x: Any) => ({ run_id: 'r1', title: 't', standard: 'none', kind: 'fix', status: 'proposed', updated_at: T, ...x });
const scan = {
  ...emptyScan(),
  runs: [{ id: 'r1', started_at: T, updated_at: T, phase: 'measure', status: 'running', lenses: ['security', 'development'] }],
  proposals: [P0({ id: 'sec-1', feature: f0, lens: 'security', created_at: at(1) }), P0({ id: 'sec-2', feature: f1, lens: 'security', created_at: at(2) }),
    P0({ id: 'dev-1', feature: f1, lens: 'development', created_at: at(3) }), P0({ id: 'odd-1', feature: f0, lens: 'com.nobody.reads', created_at: at(4) })],
};
const M = buildLiveModel(map3, events, scan, live, 1, () => 0);
const sim = M.sim;

// ---------------------------------------------------------------- (d) no sample steer on live
const verbs = LS.steerVerbs(sim.live);
expect(sim.live && sim.has && !['push', 'pause', 'resume', 'order'].some((v) => verbs.includes(v)) && verbs.join() === 'measure,build,stop', '(d) on a live sim the steer list is measure, build, stop', verbs.join());
expect(LS.steerVerbs(false).join() === 'push,pause,resume,order', '(d) the sample keeps push, pause, resume, order');
let calls = 0;
const spy = (s: Any) => { const c = s.commit.bind(s); s.commit = (...a: Any[]) => { calls++; return c(...a); }; };
spy(sim);
const pv = (kind: string) => ({ kind, title: kind, moves: [], targets: { [f0]: 1 }, paused: [], lines: [], n: 0, text: 'x', label: 'x' });
const refused = ['push', 'pause', 'resume', 'order'].map((k) => LS.commitSample(sim, pv(k), 'jonas'));
expect(refused.every((r) => r === false) && calls === 0, '(d) commitSample refuses every sample kind on live: sim.commit ran 0 times', refused.join() + ' calls ' + calls);
const sample = new SwarmSim(M.P, liveSwarm(M.P, scan), () => 0);
spy(sample);
expect(!sample.live && LS.commitSample(sample, pv('pause'), 'jonas') === true && calls === 1, '(d) control: on a sample sim commitSample does call sim.commit (the spy counts)', 'calls ' + calls);
// Read with the comments removed (scripts/lib/source.ts, as the other source-guard checks do): these two
// expectations must MATCH, so over raw text a file that only TALKS about the rule in a comment satisfies them.
const eng = readStripped(path.join(SRC, 'engine/Engine.ts')).replace(/\r\n/g, '\n'); // a Windows checkout is CRLF
const COMMITS_THROUGH = /commitPreview\(\) \{[\s\S]{0,400}?commitSample\(this\.M\.sim/;
expect(!/\.commit\(/.test(eng.replace(/commitSample\(|commitPreview\(|commitLive\(/g, '')), '(d) Engine.ts never calls sim.commit directly (only through commitSample)');
expect(/preview\(kind[^\n]*\{\n\s*const sim = this\.M\.sim;\n\s*if \(sim\.live\) \{[^\n]*SAMPLE_REFUSED/.test(eng) && COMMITS_THROUGH.test(eng), '(d) Engine.preview refuses a sample steer on live first, and commitPreview commits through commitSample');
// the matcher stopped biting? A bypass whose only trace of commitSample is a comment must fail the guard above.
{
  const real = 'if (!commitSample(this.M.sim, p, this.signer()))';
  const seeded = eng.replace(real, 'if (!this.M.sim.commit(p)) /* ' + real + ' */');
  expect(seeded !== eng && COMMITS_THROUGH.test(seeded) && !COMMITS_THROUGH.test(stripComments(seeded)),
    '(d) control: a commitSample left only in a comment does not satisfy the guard (the comments are stripped first)');
  expect(!/^\s*\/\//m.test(eng) && !eng.includes('/*'), '(d) control: the source the guards read carries no comment at all');
}

// ---------------------------------------------------------------- (e) deciders from the map's people
const dec = (id: string) => sim.decisions.find((d: Any) => d.base === id);
const owner1 = kf[1].owner, owner0 = kf[0].owner;
expect(dec('sec-1')?.decider === 'jonas' && dec('sec-2')?.decider === 'jonas', '(e) a security proposal goes to jonas (field security), not the feature\'s owner ' + owner0, dec('sec-1')?.decider);
const mine = sim.queueFor('jonas', 'general').mine;
expect(mine.length === 2 && mine.every((d: Any) => d.lens === 'security'), '(e) queueFor(\'jonas\').mine holds the 2 security proposals', mine.map((d: Any) => d.id).join());
expect(dec('dev-1')?.decider === 'tomas', '(e) a development proposal goes to tomas (field development)', dec('dev-1')?.decider);
expect(dec('odd-1')?.decider === owner0 && !!owner0, '(e) a lens no person reads goes to the feature\'s owner', dec('odd-1')?.decider + ' vs ' + owner0);
const bare = { ...M.P, people: [], base: { ...M.P.base, features: M.P.base.features.map((f: Any) => ({ ...f, owner: '' })) } };
expect(liveDecider(bare, 'security', f0) === LIVE_DECIDER && liveSwarm(bare, scan).decisions.every((d: Any) => d.decider === LIVE_DECIDER), '(e) a map that names nobody: LIVE_DECIDER');
expect(liveDecider(M.P, 'development', f1) === (M.P.P[owner1]?.field === 'development' ? owner1 : 'tomas'), '(e) among several readers of the lens, the feature\'s owner goes first');

// ---------------------------------------------------------------- (f) the feed is the truth
const sw = swarmFromScan(scan, M.P.base.features);
const holds = Object.fromEntries(sw.decisions.map((d: Any) => [d.id, d.blocksAgents]));
expect(holds['sec-1'] === 1 && holds['dev-1'] === 1 && holds['sec-2'] === 0 && holds['odd-1'] === 0, '(f) the proposal a waiting lens agent stands on holds 1; the rest 0', JSON.stringify(holds));
expect(sim.blocksNow(dec('sec-1')) === 1 && sim.blocksNow(dec('sec-2')) === 0, '(f) the sim reads it: holds 1 agent');
const sa = sim.agents.find((a: Any) => a.wait === 'sec-1');
expect(!!sa && sa.status === 'waiting', '(f) the security agent waits on sec-1', JSON.stringify(sa && { st: sa.status, w: sa.wait }));
for (const a of sim.agents) a.paused = true; // what a sample steer used to leave behind
sim.applyFeed(liveSwarm(M.P, scan));
expect(sim.agents.length === 2 && sim.agents.every((a: Any) => !a.paused), '(f) after a feed no live agent is left paused', sim.agents.map((a: Any) => a.id + ':' + a.paused).join());

// ---------------------------------------------------------------- the target as base slugs (any ?scale)
const M2 = buildLiveModel(map3, events, scan, live, 2, () => 0);
const ids = { [f1 + lineSuffix(2, 1)]: 1, [f0 + lineSuffix(2, 0)]: 1, [f0 + lineSuffix(2, 1)]: 1 } as Record<string, 1>;
expect(LS.targetFeatures(M2.P, ids).join() === [f0, f1].join(), '(a) a ?scale=2 target reads as its base slugs, once each, in map order', LS.targetFeatures(M2.P, ids).join());
const kfacts = LS.steerFacts(M.P, { ids: { [f0]: 1 }, label: '' }, [], scan.proposals);
const scanOk = kfacts.lenses.filter((l: Any) => l.ok).map((l: Any) => l.id);
expect(scanOk.length > 0 && scanOk.every((id: string) => ['development', 'security', 'design', 'performance'].includes(id) || !!M.P.LENS[id].manifest.scan) && kfacts.label === 'the selection',
  '(a) on a live product only lenses with a scan method are measured', scanOk.join());

try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
// Self-proof, every run: seed a defect into the source this check transpiles (BP_OVERLAYS_MUTATE; the loader skips a mutation
// whose text no longer exists, so a child that passes means the mutation stopped biting) and require the child to fail on the
// rule that defect breaks: live-plan.ts build plans proposed items as well as approved ones.
if (!process.env.BP_OVERLAYS_MUTATE) {
  const seed = [["live-plan.ts", "p.status === 'approved' && !busy.has(p.id));", "(p.status === 'approved' || p.status === 'proposed') && !busy.has(p.id));"]];
  const child = spawnSync(process.execPath, [...process.execArgv, import.meta.filename], { env: { ...process.env, BP_OVERLAYS_MUTATE: JSON.stringify(seed) }, encoding: 'utf8', timeout: 120000 });
  expect(child.status === 1 && child.stdout.includes('(c) build plans exactly the 2 approved'),
    'self-proof: live-plan.ts build plans proposed items as well as approved ones: the check must fail on (c) build plans exactly the 2 approved (child exit ' + child.status + ')');
}

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-live-steer: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-live-steer: ${held} expectations held`);
process.exit(0);
