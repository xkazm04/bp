// Checks the one build-admission rule (packages/core/src/scan/admit.ts; docs/blueprint-ui.md, "Scan jobs"): which findings a
// build may take, said once and used by every caller.
//   (1) admitForBuild: proposed -> approve and take, approved -> take, held by a queued or running execute job -> 'in-job',
//       anything else -> skipped with its status ('unknown' for an id the store lacks), in input order;
//   (2) each id is judged once;
//   (3) an id that fails SAFE_ID -> 'unsafe-id', never approved;
//   (4) buildChunks: one chunker of MAX_PROPOSALS (50) every caller uses;
//   (5) busyIds: only queued or running execute jobs hold findings;
//   (6) live POST /dispatch over an id a queued execute job holds -> 409 { error, skipped: [in-job] } and still ONE execute
//       job; ScanSim.dispatch in the same state refuses with the same status, error string and skipped list;
//   (7) parity: one 8-finding fixture through the live lens-execute route and ScanSim.executeLens, and one through the live
//       wave dispatch and the sim's -> the same approved and skipped sets and the same id list per job;
//   (8) planLive('build') takes exactly admit's approved takes, and the ledger's Finding.can is canBuild (truth table plus
//       the source: useLedger reads canBuild and MAX_PROPOSALS, not a copy of either).
// The live half runs the real routes and job registry over the fake Claude Code CLI (scripts/fixtures/fake-claude.mjs, as
// check-scan-jobs does); three `--lens slow` measure jobs fill the running slots so the execute jobs stay queued (a queued
// job holds its findings exactly as a running one does) and the sim is held the same way. Run: node scripts/check-build-admit.ts
// (Node's type stripping). Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT); // resolves '@/' in the routes
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const load = (rel: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, rel)).href);

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const J = await load('packages/core/src/server/jobs.server.ts');
const { MAX_PROPOSALS } = await load('packages/core/src/scan/jobs.ts');
const { ScanSim } = await load('packages/core/src/model/scan-sim.ts');
const { planLive } = await load('packages/core/src/scan/live-plan.ts');
let AD: Any = null;
try { AD = await load('packages/core/src/scan/admit.ts'); } catch (e) { check('packages/core/src/scan/admit.ts loads', false, (e as Error).message.split('\n')[0]); }
const has = (name: string) => typeof AD?.[name] === 'function';
const J1 = (x: unknown) => JSON.stringify(x);
const sk = (xs: { id: string; status: string }[] = []) => J1([...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
const set = (xs: string[] = []) => [...xs].sort().join();

// ------------------------------------------------------------------ (1)-(5) the pure rule
{
  const st: Record<string, string> = { a: 'proposed', b: 'approved', c: 'done', e: 'approved' };
  const r = has('admitForBuild') ? AD.admitForBuild(['a', 'b', 'c', 'd', 'e'], (id: string) => st[id], new Set(['e'])) : null;
  check('(1) admitForBuild: approve [a], take [a,b], skipped c done, d unknown, e in-job, in input order',
    !!r && r.approve.join() === 'a' && r.take.join() === 'a,b' && J1(r.skipped) === '[{"id":"c","status":"done"},{"id":"d","status":"unknown"},{"id":"e","status":"in-job"}]', J1(r));
  const r2 = has('admitForBuild') ? AD.admitForBuild(['a', 'a', 'b'], (id: string) => st[id]) : null;
  check('(2) admitForBuild: each id judged once', !!r2 && r2.take.join() === 'a,b' && r2.approve.join() === 'a' && !r2.skipped.length, J1(r2));
  const r3 = has('admitForBuild') ? AD.admitForBuild(['Bad id!', 'a'], (id: string) => (id === 'Bad id!' ? 'proposed' : st[id])) : null;
  check('(3) admitForBuild: a proposed id that fails SAFE_ID -> unsafe-id, never approved', !!r3 && r3.approve.join() === 'a' && r3.take.join() === 'a' && J1(r3.skipped) === '[{"id":"Bad id!","status":"unsafe-id"}]', J1(r3));
  const ids = Array.from({ length: 120 }, (_, i) => 'x' + i);
  const ch = has('buildChunks') ? AD.buildChunks(ids) : null;
  check('(4) buildChunks of 120 -> 50, 50, 20 in order, each <= MAX_PROPOSALS', !!ch && ch.map((c: string[]) => c.length).join() === '50,50,20' && ch.flat().join() === ids.join() && ch.every((c: string[]) => c.length <= MAX_PROPOSALS), J1(ch?.map((c: string[]) => c.length)));
  check('(4) buildChunks of none -> no chunk', !!ch && AD.buildChunks([]).length === 0);
  const jb = (id: string, kind: string, status: string, proposals?: string[]) => ({ id, kind, status, queued_at: 'T', ...(proposals ? { proposals } : {}) });
  const jobs = [jb('1', 'execute', 'queued', ['q']), jb('2', 'execute', 'running', ['r', 's']), jb('3', 'execute', 'done', ['d']), jb('4', 'execute', 'failed', ['f']),
    jb('5', 'execute', 'cancelled', ['c']), jb('6', 'measure', 'running', ['m']), jb('7', 'release', 'running', ['l'])];
  const busy = has('busyIds') ? AD.busyIds(jobs) : null;
  check('(5) busyIds: the proposals of queued or running execute jobs only', !!busy && set([...busy]) === 'q,r,s', J1(busy && [...busy]));
}

// ------------------------------------------------------------------ the fixtures, live and sim
const T = '2026-10-18T09:00:00Z', at = (i: number) => new Date(Date.parse(T) + i * 1000).toISOString();
const LENS = 'com.x.build';
/** The 8 findings, store order: proposed, approved, done, declined, approved (held by a queued build), proposed, executing,
 *  and a proposed id that may not reach a command line (the lens execute fixture only: a wave body refuses it). */
const ROWS: [string, string][] = [['b1', 'proposed'], ['b2', 'approved'], ['b3', 'done'], ['b4', 'declined'], ['b5', 'approved'], ['b6', 'proposed'], ['b7', 'executing'], ['Bad id!', 'proposed']];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-build-admit-'));
const mkProduct = (slug: string) => {
  const root = path.join(dir, slug), store = path.join(root, '.ai/lens-scan');
  fs.mkdirSync(store, { recursive: true });
  const lensE = (id: string) => ({ id, version: '1.0.0', source: 'project', enabled: true, manifest: { id, scan: { method: 'judgement', instructions: 'x' } } });
  fs.writeFileSync(path.join(store, 'app-structure.json'), JSON.stringify({ $schema: 'app-structure/3', version: 3, project: { slug, name: slug }, features: [{ slug: 'a', name: 'A' }], lenses: [lensE(LENS)] }, null, 2));
  const db = new DatabaseSync(path.join(store, 'scan.db'));
  db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
  db.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r0', ?, ?, 'measure', 'done', '[]')").run(T, T);
  const ins = db.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES (?, 'r0', 'a', ?, 't', 'fix', ?, ?, ?)");
  ROWS.forEach(([id, s], i) => ins.run(id, LENS, s, at(i), at(i)));
  db.close();
  return { slug, root };
};
const clock = Date.parse(T); // frozen: the sim's jobs start and never step
const mkSim = () => {
  const findings = ROWS.map(([id, status], i) => ({ id, run_id: 'r0', feature: 'a', lens: LENS, title: 't', standard: 'none', kind: 'fix', status, created_at: at(i), updated_at: at(i) }));
  const s = new ScanSim({ now: () => clock, findings });
  const man = { id: LENS, short: 'BLD', fields: [], scan: { method: 'judgement' } };
  s.bind({ order: ['a'], manifest: (l: string) => (l === LENS ? man : undefined), value: () => undefined });
  for (let i = 0; i < 3; i++) s.startScan(LENS, { kind: 'feature', id: 'a', label: 'A', features: ['a'] }); // the 3 running slots
  return s;
};
const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); }, removeItem: (k: string) => { ls.delete(k); } };
const simTry = (fn: () => Any): { status: number; body: Any } => { try { return { status: 202, body: fn() }; } catch (e) { const x = e as { status?: number; body?: Any; message: string }; return { status: x.status ?? 500, body: x.body ?? { error: x.message } }; } };

const LX = mkProduct('lx'), LW = mkProduct('lw');
fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'lx', name: 'LX', root: LX.root }, { slug: 'lw', name: 'LW', root: LW.root }] }));
const cwd0 = process.cwd();
process.chdir(dir);
const route = (rel: string) => load('apps/web/src/app/api/' + rel);
const H = { host: 'localhost:3000', 'content-type': 'application/json' };
const call = async (fn: (req: Request, ctx: unknown) => Promise<Response>, params: object, body: unknown) => {
  const res = await fn(new Request('http://localhost:3000/x', { method: 'POST', headers: H, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() as Any };
};
const execs = (slug: string) => J.list(slug).filter((j: Any) => j.kind === 'execute');

try {
  const disp = await route('products/[slug]/dispatch/route.ts'), exe = await route('products/[slug]/lenses/[id]/execute/route.ts');
  const waves = await route('products/[slug]/waves/route.ts'), wdisp = await route('products/[slug]/waves/[wave]/dispatch/route.ts');
  for (const p of [LX, LW]) for (let i = 0; i < 3; i++) J.enqueueMeasure(p.slug, p.root, 'slow', { kind: 'all', label: 'Everything', features: [] });
  const simX = mkSim(), simW = mkSim();

  // ---------------------------------------------------------------- (6) /dispatch refuses what a build already holds
  const first = await call(disp.POST, { slug: 'lx' }, { ids: ['b5'] }), sFirst = simTry(() => simX.dispatch(['b5']));
  check('(6) setup: /dispatch [b5] -> 202, one queued execute job holds it (live and sim)', first.status === 202 && sFirst.status === 202 && execs('lx').length === 1 && execs('lx')[0].status === 'queued',
    first.status + ' ' + sFirst.status + ' ' + J1(execs('lx').map((j: Any) => j.status)));
  const again = await call(disp.POST, { slug: 'lx' }, { ids: ['b5'] });
  check('(6) live: /dispatch [b5] again -> 409 { error, skipped: [b5 in-job] }', again.status === 409 && typeof again.body.error === 'string' && J1(again.body.skipped) === '[{"id":"b5","status":"in-job"}]', again.status + ' ' + J1(again.body).slice(0, 200));
  check('(6) live: the registry still holds exactly one execute job', execs('lx').length === 1, String(execs('lx').length));
  const sAgain = simTry(() => simX.dispatch(['b5']));
  check('(6) sim: dispatch [b5] again -> 409 with the same error string and skipped list as the live route', sAgain.status === 409 && sAgain.body.error === again.body.error && J1(sAgain.body.skipped) === J1(again.body.skipped),
    sAgain.status + ' ' + J1(sAgain.body).slice(0, 200) + ' vs ' + J1(again.body).slice(0, 200));
  check('(6) sim: still exactly one execute job', simX.jobs().filter((j: Any) => j.kind === 'execute').length === 1, String(simX.jobs().filter((j: Any) => j.kind === 'execute').length));

  // ---------------------------------------------------------------- (7) parity: lens execute
  const lx = await call(exe.POST, { slug: 'lx', id: LENS }, {}), sx = simTry(() => simX.executeLens(LENS));
  const want = { approved: 'b1,b6', skipped: sk([{ id: 'b3', status: 'done' }, { id: 'b4', status: 'declined' }, { id: 'b5', status: 'in-job' }, { id: 'b7', status: 'executing' }, { id: 'Bad id!', status: 'unsafe-id' }]), jobs: J1([['b1', 'b2', 'b6']]) };
  const jl = (b: Any) => J1((b?.jobs ?? []).map((j: Any) => j.proposals));
  check('(7) live lens execute: 202, approved b1 b6, one job b1 b2 b6, the rest skipped with why (unsafe-id included)', lx.status === 202 && set(lx.body.approved) === want.approved && sk(lx.body.skipped) === want.skipped && jl(lx.body) === want.jobs, lx.status + ' ' + J1(lx.body).slice(0, 400));
  check('(7) sim executeLens answers the same: approved, skipped (unsafe-id included), the id list per job', sx.status === lx.status && set(sx.body.approved) === set(lx.body.approved) && sk(sx.body.skipped) === sk(lx.body.skipped) && jl(sx.body) === jl(lx.body),
    sx.status + ' ' + J1({ approved: sx.body.approved, skipped: sx.body.skipped, jobs: jl(sx.body) }).slice(0, 400));

  // ---------------------------------------------------------------- (7) parity: wave dispatch
  const wbody = { name: 'Parity', packages: [{ name: 'One', model: 'opus', effort: 'high', ids: ['b1', 'b2', 'b3', 'bx'] }, { name: 'Two', model: 'sonnet', effort: 'low', ids: ['b4', 'b5', 'b6', 'b7'] }] };
  await call(disp.POST, { slug: 'lw' }, { ids: ['b5'] }); simTry(() => simW.dispatch(['b5'])); // b5 held, as above
  const mk = await call(waves.POST, { slug: 'lw' }, wbody), sw = simW.createWave(wbody);
  const lwd = await call(wdisp.POST, { slug: 'lw', wave: mk.body.wave?.id }, {}), swd = simTry(() => simW.dispatchWave(sw.id));
  const wantW = { approved: 'b1,b6', skipped: sk([{ id: 'b3', status: 'done' }, { id: 'bx', status: 'unknown' }, { id: 'b4', status: 'declined' }, { id: 'b5', status: 'in-job' }, { id: 'b7', status: 'executing' }]), jobs: J1([['b1', 'b2'], ['b6']]) };
  check('(7) live wave dispatch: 202, approved b1 b6, jobs [b1 b2] [b6], the rest skipped with why', lwd.status === 202 && set(lwd.body.approved) === wantW.approved && sk(lwd.body.skipped) === wantW.skipped && jl(lwd.body) === wantW.jobs, lwd.status + ' ' + J1(lwd.body).slice(0, 400));
  check('(7) sim wave dispatch answers the same', swd.status === lwd.status && set(swd.body.approved) === set(lwd.body.approved) && sk(swd.body.skipped) === sk(lwd.body.skipped) && jl(swd.body) === jl(lwd.body),
    swd.status + ' ' + J1({ approved: swd.body.approved, skipped: swd.body.skipped, jobs: jl(swd.body) }).slice(0, 400));
} finally {
  process.chdir(cwd0);
  for (const slug of ['lx', 'lw']) for (const j of J.list(slug)) J.cancel(slug, j.id);
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
}

// ------------------------------------------------------------------ (8) the plan and the ledger read the same rule
{
  const STATUSES = ['proposed', 'approved', 'executing', 'done', 'failed', 'declined'];
  const props = STATUSES.flatMap((s, i) => [0, 1].map((b) => ({ id: `p${i}${b}`, run_id: 'r0', feature: 'a', lens: LENS, title: 't', standard: 'none', kind: 'fix', status: s, created_at: at(i * 2 + b), updated_at: at(i * 2 + b) })));
  const held = props.filter((p) => p.id.endsWith('1')).map((p) => p.id);
  const jobs = [{ id: 'j1', kind: 'execute', status: 'running', queued_at: T, proposals: held }];
  const plan = planLive('build', { label: 'Here', features: ['a'], lenses: [{ id: LENS, name: 'B', ok: true }], jobs, proposals: props });
  const st = new Map(props.map((p) => [p.id, p.status]));
  const take = has('admitForBuild') ? AD.admitForBuild(props.map((p) => p.id), (id: string) => st.get(id), new Set(held)).take.filter((id: string) => st.get(id) === 'approved') : null;
  check('(8) planLive build plans exactly admit\'s take restricted to approved', !!take && plan.build.join() === take.join() && plan.build.join() === 'p10', J1(plan.build) + ' vs ' + J1(take));
  const cells = has('canBuild') ? STATUSES.flatMap((s) => [false, true].map((b) => `${s}/${b}:${AD.canBuild(s, b)}`)) : [];
  check('(8) canBuild: true exactly for proposed or approved and not held', cells.filter((c) => c.endsWith(':true')).join() === 'proposed/false:true,approved/false:true' && cells.length === 12, cells.join(' '));
  // read raw: the file's header names `waves/*`, which a block-comment stripper would read as an opening comment
  const led = fs.readFileSync(path.join(ROOT, 'apps/web/src/components/ledger/useLedger.ts'), 'utf8');
  check('(8) useLedger: Finding.can is canBuild(status, held), chunks are buildChunks / MAX_PROPOSALS (no CHUNK = 50, no OPEN copy)',
    /can:\s*canBuild\(status,\s*!!job\)/.test(led) && /\bbuildChunks\(/.test(led) && !/CHUNK\s*=\s*50/.test(led) && !/\bOPEN\.has\(/.test(led) && /from '@bp\/core\/scan\/admit'/.test(led));
}

console.log(failed ? `check-build-admit: ${failed} failed, ${passed} passed` : `check-build-admit: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
