// Checks the build forecast: POST /dispatch and POST waves/[wave]/dispatch with `dry: true` answer what the real call
// would (the same guards, the same admission, the same refusals) and write NOTHING, and the ledger's label is made from it
// (apps/web/src/components/ledger/build-forecast.ts). Over temp products, the fake Claude Code CLI, a hold order and a full queue:
//   1 dry over [proposed, approved, declined] -> 200 { dry, approve, take, skipped, jobs: 1 }; the store rows and the job
//     registry are unchanged;
//   2 dry over a finding a queued execute job builds -> skipped `in-job`, nothing written;
//   3 dry with a live hold O-1 over one finding -> skipped `held:O-1`, `held` and `note` in the answer, and
//     work/bp-rules-log.jsonl is byte-identical (gateBuild logs every held REAL call);
//   4 dry with every id held -> 403 with the body the real call answers, nothing written;
//   5 dry with MAX_QUEUED jobs queued -> 429 with the forecast, and no finding moved to approved;
//   6 dry wave dispatch -> 200 with one row per package { id, model, effort, approve, take, skipped, jobs }; the wave
//     stays a draft and bp-waves.json is byte-identical;
//   7 parity: the real dispatch (and wave dispatch) right after a dry one answers approved == dry.approve, the same skipped;
//   8 build-forecast.ts (pure): the label and the block; Kettle's hosted sim answers a dry dispatch with its jobs unchanged,
//     and actions.ts forecasts on the sim plane with nothing approved.
// Run: node scripts/check-build-forecast.ts (Node's type stripping). Exit 1 on any failure. ~5 s.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const load = <T>(rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href) as Promise<T>;
const J = await load<typeof import('../packages/core/src/server/jobs.server.ts')>('packages/core/src/server/jobs.server.ts');
const { ScanSim } = await load<typeof import('../packages/core/src/model/scan-sim.ts')>('packages/core/src/model/scan-sim.ts');
const K = await load<typeof import('../packages/core/src/server/kettle-sim.server.ts')>('packages/core/src/server/kettle-sim.server.ts');
const A = await load<Any>('apps/web/src/lib/scan/actions.ts');
const BF = await load<Any>('apps/web/src/components/ledger/build-forecast.ts').catch((e) => ({ missing: (e as Error).message }));

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const j = (x: unknown) => JSON.stringify(x)?.slice(0, 400) ?? String(x);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = '2026-11-07T10:00:00.000Z';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-forecast-'));

const mkProduct = (name: string, proposals: [string, string, string?][]) => {
  const root = path.join(dir, name), store = path.join(root, '.ai/lens-scan');
  fs.mkdirSync(path.join(store, 'work'), { recursive: true });
  const db = new DatabaseSync(path.join(store, 'scan.db'));
  db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
  db.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r0', ?, ?, 'measure', 'done', '[]')").run(T, T);
  const ins = db.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES (?, 'r0', ?, 'development', 't', 'fix', ?, ?, ?)");
  for (const [id, s, f] of proposals) ins.run(id, f ?? 'a', s, T, T);
  db.close();
  return { root, store: path.join(store, 'scan.db'), waves: path.join(store, 'work/bp-waves.json'), rules: path.join(store, 'work/bp-rules.json'), log: path.join(store, 'work/bp-rules-log.jsonl') };
};
/** Every proposal row, as text: the byte-compare of what the store holds. */
const rows = (file: string) => { const d = new DatabaseSync(file, { readOnly: true }); try { return JSON.stringify(d.prepare('SELECT * FROM proposals ORDER BY id').all()); } finally { d.close(); } };
const status = (file: string, id: string) => { const d = new DatabaseSync(file, { readOnly: true }); try { return (d.prepare('SELECT status FROM proposals WHERE id = ?').get(id) as { status: string }).status; } finally { d.close(); } };
const text = (file: string) => { try { return fs.readFileSync(file, 'utf8'); } catch { return '(none)'; } };
const jobsOf = (slug: string) => JSON.stringify(J.list(slug).map((x) => x.id + ':' + x.status));

const live = mkProduct('live', [['p1', 'proposed'], ['p2', 'approved'], ['p3', 'declined'], ['p5', 'proposed', 'h'], ['p6', 'proposed'], ['p7', 'proposed'], ['p8', 'approved']]);
const busy = mkProduct('busy', [['q1', 'proposed'], ['q2', 'approved']]);
fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'live', name: 'Live', root: live.root }, { slug: 'busy', name: 'Busy', root: busy.root }] }));
// a live hold over feature `h` (p5): the owner's standing order O-1
fs.writeFileSync(live.rules, JSON.stringify({ version: 1, rules: [{ id: 'O-1', kind: 'hold', text: 'Hold h', by: 'user:owner', at: T, scope: { kind: 'feature', id: 'h', label: 'H', features: ['h'] } }] }));
process.chdir(dir);

const route = (rel: string) => load<Any>('apps/web/src/app/api/' + rel);
const H = { host: 'localhost:3000', 'content-type': 'application/json' };
const call = async (fn: (req: Request, ctx: unknown) => Promise<Response>, params: object, body: unknown) => {
  const res = await fn(new Request('http://localhost:3000/x', { method: 'POST', headers: H, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() as Any };
};

try {
  const disp = (await route('products/[slug]/dispatch/route.ts')).POST;
  const wdisp = (await route('products/[slug]/waves/[wave]/dispatch/route.ts')).POST;
  const wavesPost = (await route('products/[slug]/waves/route.ts')).POST;

  // ---------------------------------------------------------------- 1 the dry dispatch writes nothing
  {
    const r0 = rows(live.store), j0 = jobsOf('live');
    const d = await call(disp, { slug: 'live' }, { ids: ['p1', 'p2', 'p3'], dry: true });
    check('1 dry /dispatch -> 200 { dry, approve [p1], take [p1 p2], skipped [p3 declined], jobs 1 }', d.status === 200 && d.body.dry === true && j(d.body.approve) === j(['p1']) && j(d.body.take) === j(['p1', 'p2'])
      && j(d.body.skipped) === j([{ id: 'p3', status: 'declined' }]) && d.body.jobs === 1 && !('job' in d.body), d.status + ' ' + j(d.body));
    check('1 after the dry call p1 is still proposed and the store rows are byte-identical', status(live.store, 'p1') === 'proposed' && rows(live.store) === r0);
    check('1 after the dry call the job registry holds no new job', jobsOf('live') === j0, jobsOf('live'));
    const bad = await call(disp, { slug: 'live' }, { ids: ['p1'], dry: 'yes' });
    check('1 dry that is not a boolean -> 400', bad.status === 400, bad.status + ' ' + j(bad.body));
  }

  // ---------------------------------------------------------------- 2 + 5 in-job and the full queue (product busy)
  {
    // 3 slow scans hold every running slot, so the execute job over q2 stays queued
    const slow = () => J.enqueueMeasure('busy', busy.root, 'slow', { kind: 'all', label: 'Everything', features: [] });
    for (let i = 0; i < 3; i++) slow();
    await sleep(200);
    const ex = J.enqueueExecute('busy', busy.root, ['q2']);
    check('2 setup: an execute job over q2 is queued', ex.ok && J.list('busy').some((x) => x.kind === 'execute' && x.status === 'queued'), jobsOf('busy'));
    const r0 = rows(busy.store), j0 = jobsOf('busy');
    const d = await call(disp, { slug: 'busy' }, { ids: ['q1', 'q2'], dry: true });
    check('2 dry with q2 built by a queued execute job -> q2 skipped in-job', d.status === 200 && j(d.body.skipped) === j([{ id: 'q2', status: 'in-job' }]) && j(d.body.take) === j(['q1']), d.status + ' ' + j(d.body));
    check('2 nothing written (store rows, jobs)', rows(busy.store) === r0 && jobsOf('busy') === j0);
    for (let i = 0; i < 15; i++) slow();
    const queued = J.list('busy').filter((x) => x.status === 'queued').length;
    const r1 = rows(busy.store), j1 = jobsOf('busy');
    const f = await call(disp, { slug: 'busy' }, { ids: ['q1'], dry: true });
    check(`5 setup: ${J.MAX_QUEUED} jobs queued`, queued >= J.MAX_QUEUED, String(queued));
    check('5 dry with a full queue -> 429 carrying the forecast', f.status === 429 && f.body.dry === true && j(f.body.approve) === j(['q1']) && typeof f.body.error === 'string', f.status + ' ' + j(f.body));
    check('5 no finding moved to approved, no job', status(busy.store, 'q1') === 'proposed' && rows(busy.store) === r1 && jobsOf('busy') === j1);
    for (const x of J.list('busy')) J.cancel('busy', x.id);
  }

  // ---------------------------------------------------------------- 3 + 4 the hold, and the held log untouched
  {
    const log0 = text(live.log), r0 = rows(live.store);
    const d = await call(disp, { slug: 'live' }, { ids: ['p1', 'p5'], dry: true });
    check('3 dry with a hold O-1 over p5 -> p5 skipped held:O-1, with held and note', d.status === 200 && d.body.skipped?.some((s: Any) => s.id === 'p5' && s.status === 'held:O-1') && Array.isArray(d.body.held) && d.body.held[0]?.id === 'p5'
      && typeof d.body.note === 'string' && !!d.body.note && j(d.body.take) === j(['p1']), d.status + ' ' + j(d.body));
    check('3 work/bp-rules-log.jsonl is byte-identical around the dry call', text(live.log) === log0, text(live.log).slice(0, 200));
    const all = await call(disp, { slug: 'live' }, { ids: ['p5'], dry: true });
    check('4 dry with every id held -> 403 refusedBy', all.status === 403 && typeof all.body.error === 'string' && all.body.order?.id === 'O-1', all.status + ' ' + j(all.body));
    check('4 nothing written (store, held log)', text(live.log) === log0 && rows(live.store) === r0);
    const real = await call(disp, { slug: 'live' }, { ids: ['p5'] });
    check('4 the real call answers the same 403 body', real.status === 403 && j(real.body) === j(all.body), real.status + ' ' + j(real.body));
    check('4 (control) the real held call does log', text(live.log) !== log0);
  }

  // ---------------------------------------------------------------- 7 parity for /dispatch
  {
    const dry = await call(disp, { slug: 'live' }, { ids: ['p1', 'p2', 'p3'], dry: true });
    const real = await call(disp, { slug: 'live' }, { ids: ['p1', 'p2', 'p3'] });
    check('7 /dispatch: the real call after a dry one -> approved == dry.approve, the same skipped, job over dry.take',
      real.status === 202 && j(real.body.approved) === j(dry.body.approve) && j(real.body.skipped) === j(dry.body.skipped) && j(real.body.job?.proposals) === j(dry.body.take), j(dry.body) + ' / ' + j(real.body));
  }

  // ---------------------------------------------------------------- 6 + 7 the wave
  {
    const mk = await call(wavesPost, { slug: 'live' }, { name: 'W', packages: [{ name: 'Deep', model: 'opus', effort: 'high', ids: ['p6', 'p8'] }, { name: 'Quick', model: 'sonnet', effort: 'low', ids: ['p7'] }] });
    const wid: string = mk.body.wave?.id ?? 'w-none';
    const w0 = text(live.waves), r0 = rows(live.store), j0 = jobsOf('live'), l0 = text(live.log);
    const d = await call(wdisp, { slug: 'live', wave: wid }, { dry: true });
    const pk = d.body.packages ?? [];
    check('6 dry wave dispatch -> 200, one row per package { id, model, effort, approve, take, skipped, jobs }', d.status === 200 && d.body.dry === true && pk.length === 2
      && j(pk[0]) === j({ id: 'pk-1', model: 'opus', effort: 'high', approve: ['p6'], take: ['p6', 'p8'], skipped: [], jobs: 1 })
      && j(pk[1]) === j({ id: 'pk-2', model: 'sonnet', effort: 'low', approve: ['p7'], take: ['p7'], skipped: [], jobs: 1 }) && d.body.jobs === 2, d.status + ' ' + j(d.body));
    check('6 the wave stays a draft and bp-waves.json is byte-identical', d.body.wave?.status === 'draft' && text(live.waves) === w0);
    check('6 nothing else written (store rows, jobs, held log)', rows(live.store) === r0 && jobsOf('live') === j0 && text(live.log) === l0);
    const real = await call(wdisp, { slug: 'live', wave: wid }, {});
    check('7 wave: the real dispatch after a dry one -> approved == dry.approve, the same skipped', real.status === 202 && j(real.body.approved) === j(d.body.approve) && j(real.body.skipped) === j(d.body.skipped) && real.body.jobs?.length === d.body.jobs,
      j(real.body).slice(0, 300));
  }

  // ---------------------------------------------------------------- 8 the label, and Kettle's sim
  {
    const ok = typeof BF.forecastView === 'function';
    check('8 build-forecast.ts exports forecastView', ok, BF.missing ?? Object.keys(BF).join());
    if (ok) {
      const take = Array.from({ length: 9 }, (_, i) => 'f' + i);
      const v = BF.forecastView('Dispatch', { forecast: { take, skipped: [{ id: 'h1', status: 'held:O-1' }, { id: 'h2', status: 'held:O-1' }, { id: 'b1', status: 'in-job' }] } }, 12);
      check('8 label: Dispatch 9 · 2 held by O-1 · 1 in a job, not blocked', v.label === 'Dispatch 9 · 2 held by O-1 · 1 in a job' && v.block === false, j(v));
      const e = BF.forecastView('Dispatch', { forecast: { take: [], skipped: [{ id: 'h1', status: 'held:O-1' }] } }, 1);
      check('8 an empty take blocks', e.block === true && e.label === 'Dispatch 0 · 1 held by O-1', j(e));
      const none = BF.forecastView('Dispatch', null, 4);
      check('8 no forecast (yet, or it failed) -> today\'s label, not blocked', none.label === 'Dispatch 4' && none.block === false, j(none));
      const held = BF.forecastView('Dispatch', { refusal: { status: 403, message: 'refused: O-1', body: { held: [{ id: 'h1', order: { id: 'O-1' } }] } } }, 1);
      const full = BF.forecastView('Dispatch', { refusal: { status: 429, message: '16 jobs are already queued', body: { take: ['a', 'b'], skipped: [] } } }, 2);
      check('8 a 403 forecast blocks as held, a 429 as queue full', held.block && held.label === 'Dispatch 0 · 1 held by O-1' && full.block && full.label === 'Dispatch 2 · queue full', j([held, full]));
    }
    const at = Date.parse(T);
    const fp = (id: string, s: string) => ({ id, run_id: 'r0', feature: 'a', lens: 'development', title: 't', standard: 'none', kind: 'fix', status: s, created_at: T, updated_at: T });
    const sim = new ScanSim({ now: () => at, findings: [fp('k1', 'proposed'), fp('k2', 'approved'), fp('k3', 'declined')] as Any });
    sim.bind({ order: ['a'], manifest: () => undefined, value: () => undefined } as Any);
    try {
      K.hostKettle({ scan: sim, swarm: null as Any });
      const j0 = JSON.stringify(sim.jobs()), s0 = JSON.stringify(sim.snapshot().proposals);
      const d = await call(disp, { slug: 'kettle' }, { ids: ['k1', 'k2', 'k3'], dry: true });
      check('8 Kettle hosted + dry -> 200 forecast, sim jobs and findings unchanged', d.status === 200 && d.body.dry === true && j(d.body.approve) === j(['k1']) && j(d.body.take) === j(['k1', 'k2'])
        && JSON.stringify(sim.jobs()) === j0 && JSON.stringify(sim.snapshot().proposals) === s0, d.status + ' ' + j(d.body));
      const f = typeof A.forecastDispatch === 'function' ? await A.forecastDispatch({ slug: null, sim }, ['k1', 'k2']).catch((e: Error) => e) : null;
      check('8 actions.forecastDispatch on the sim plane -> the forecast, nothing approved', !!f && f.dry === true && j(f.take) === j(['k1', 'k2']) && sim.snapshot().proposals.find((p: Any) => p.id === 'k1')?.status === 'proposed', j(f));
      check('8 actions.ts exports forecastWave', typeof A.forecastWave === 'function');
    } finally { K.hostKettle(undefined as Any); sim.dispose(); }
  }
} finally {
  process.chdir(os.tmpdir());
  for (const slug of ['live', 'busy']) for (const x of J.list(slug)) J.cancel(slug, x.id);
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
}
console.log(failed ? `check-build-forecast: ${failed} failed, ${passed} passed` : `check-build-forecast: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
