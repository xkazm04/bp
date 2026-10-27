// Checks the ledger waves (src/lib/scan/waves.ts, waves.server.ts, the /waves routes, the scan sim's waves):
//   - the pure rules: checkWaveBody refusals, waveState for every state (a pruned job counts as done), waveOfId (the newest
//     wave wins), and the shared steps (create / patch / remove: taken, not a draft, MAX_WAVES);
//   - the Kettle path end to end over the scan sim and a Map standing in for localStorage: create, 409 taken, dispatch with two
//     packages -> two jobs each carrying its own model, effort, wave and package, patch / delete of a dispatched wave 409,
//     delete of a draft, 429 mid-way carrying what was queued, a wave dispatched in an earlier visit reads as a draft again;
//   - the live path over the routes and the fake Claude Code CLI (scripts/fixtures/fake-claude.mjs prints its argv):
//     `--model opus --effort xhigh` and `--model sonnet --effort low` reach their own child, a model outside the allow-list
//     (enqueueExecute, the create route, a hand-edited waves file) is refused before anything spawns, a finding in two draft
//     waves is 409 taken, 429 mid-way records the jobs queued so far in wave.jobs, a corrupt waves file survives a GET.
// Run: node scripts/check-waves.ts  (Node's type stripping; no build step). Exit 1 on any failure. ~10 s.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT); // resolves '@/' in the routes
const FAKE = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');
process.env.BP_CLAUDE_BIN = FAKE;

const load = <T>(rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href) as Promise<T>;
const W = await load<typeof import('../packages/core/src/scan/waves.ts')>('packages/core/src/scan/waves.ts');
const J = await load<typeof import('../packages/core/src/server/jobs.server.ts')>('packages/core/src/server/jobs.server.ts');
const WS = await load<typeof import('../packages/core/src/server/waves.server.ts')>('packages/core/src/server/waves.server.ts');
const { ScanSim } = await load<typeof import('../packages/core/src/model/scan-sim.ts')>('packages/core/src/model/scan-sim.ts');
const A = await load<typeof import('../apps/web/src/lib/scan/actions.ts')>('apps/web/src/lib/scan/actions.ts');
type ScanJob = import('../packages/core/src/scan/jobs.ts').ScanJob;
type Proposal = import('../packages/core/src/scan/types.ts').Proposal;
type Wave = import('../packages/core/src/scan/waves.ts').Wave;
type Manifest = import('../packages/core/src/standard/types.ts').LensManifest;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 30000): Promise<boolean> { const t = Date.now() + ms; while (Date.now() < t) { if (pred()) return true; await sleep(50); } return pred(); }
const job = (slug: string, id: string): ScanJob | undefined => J.list(slug).find((j) => j.id === id);
const err = async (fn: () => unknown): Promise<{ status?: number; message: string; body?: any }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  try { await fn(); return { message: 'ok' }; } catch (e) { return e as { status?: number; message: string; body?: unknown }; }
};

type Pkg = Omit<import('../packages/core/src/scan/waves.ts').WavePackage, 'id'>;
/** A package body; `model` and `effort` are loose so the refusals can be fed bad values. */
const pkg = (name: string, ids: string[], model = 'opus', effort = 'high'): Pkg => ({ name, model, effort, ids } as Pkg);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-waves-'));

try {
  // ------------------------------------------------------------------ checkWaveBody
  const ok1 = W.checkWaveBody({ name: '  Wave one  ', packages: [pkg('A', ['p1', 'p2']), pkg('B', ['p3'], 'sonnet', 'low')] });
  check('checkWaveBody: a good body -> trimmed name, the packages as given', ok1.ok && ok1.name === 'Wave one' && ok1.packages.length === 2 && ok1.packages[1].model === 'sonnet' && ok1.packages[1].effort === 'low', JSON.stringify(ok1));
  const refusals: [string, unknown, RegExp][] = [
    ['null body', null, /name/], ['no name', { packages: [pkg('A', ['p1'])] }, /name/], ['blank name', { name: '   ', packages: [pkg('A', ['p1'])] }, /name/],
    ['61-character name', { name: 'x'.repeat(61), packages: [pkg('A', ['p1'])] }, /name/],
    ['no packages', { name: 'w', packages: [] }, /packages/], ['packages not a list', { name: 'w', packages: 'x' }, /packages/],
    ['13 packages', { name: 'w', packages: Array.from({ length: 13 }, (_, i) => pkg('P' + i, ['id' + i])) }, /packages/],
    ['package without a name', { name: 'w', packages: [pkg('', ['p1'])] }, /package name/],
    ['model gpt', { name: 'w', packages: [pkg('A', ['p1'], 'gpt')] }, /model/], ['model haiku', { name: 'w', packages: [pkg('A', ['p1'], 'haiku')] }, /model/],
    ['effort max', { name: 'w', packages: [pkg('A', ['p1'], 'opus', 'max')] }, /effort/],
    ['no ids', { name: 'w', packages: [pkg('A', [])] }, /at least one/], ['an unsafe id', { name: 'w', packages: [pkg('A', ['p1; calc'])] }, /at least one/],
    ['an id twice in a package', { name: 'w', packages: [pkg('A', ['p1', 'p1'])] }, /twice/], ['an id in two packages', { name: 'w', packages: [pkg('A', ['p1']), pkg('B', ['p1'])] }, /twice/],
    ['401 findings', { name: 'w', packages: Array.from({ length: 9 }, (_, i) => pkg('P' + i, Array.from({ length: 50 }, (_, k) => `f${i}-${k}`))) }, /at most 400/],
  ];
  for (const [name, body, re] of refusals) { const r = W.checkWaveBody(body); check('checkWaveBody refuses ' + name, !r.ok && re.test(r.error), JSON.stringify(r)); }
  // The allow-lists are the ground truth (packages/core/src/scan/waves.ts), so the accepted side is DERIVED from them
  // rather than hand-listed: a model or effort added there is exercised the moment it is added, and the refusals above
  // are checked to be outside the lists, so neither direction can go stale quietly.
  {
    const pairs = W.WAVE_MODELS.flatMap((m) => W.WAVE_EFFORTS.map((e) => [m, e] as const));
    const nope = pairs.filter(([m, e]) => { const r = W.checkWaveBody({ name: 'w', packages: [pkg('A', ['p1'], m, e)] }); return !r.ok || r.packages[0].model !== m || r.packages[0].effort !== e; });
    check(`checkWaveBody accepts every allow-listed model x effort (${pairs.length} pairs of ${W.WAVE_MODELS.length} x ${W.WAVE_EFFORTS.length})`, pairs.length > 0 && nope.length === 0, nope.map((p) => p.join('/')).join());
    const inList = ['gpt', 'haiku', 'max'].filter((x) => (W.WAVE_MODELS as readonly string[]).includes(x) || (W.WAVE_EFFORTS as readonly string[]).includes(x));
    check('the refused samples above are outside the allow-lists (gpt, haiku, max)', inList.length === 0, inList.join());
  }

  // ------------------------------------------------------------------ waveState
  const mk = (statuses: (string | null)[], status: Wave['status'] = 'dispatched'): [Wave, ScanJob[]] => {
    const jobs = statuses.flatMap((s, i) => (s === null ? [] : [{ id: 'j' + i, kind: 'execute', status: s, queued_at: 't' } as ScanJob]));
    return [{ id: 'w-1', name: 'w', status, created_at: 't', packages: [], jobs: statuses.map((_, i) => ({ package: 'pk-1', job: 'j' + i })) }, jobs];
  };
  const table: [string, (string | null)[], string][] = [
    ['queued', ['queued', 'done'], 'queued'], ['running beats queued', ['queued', 'running', 'done'], 'running'], ['all done', ['done', 'done'], 'done'],
    ['a pruned job is done', [null, 'done'], 'done'], ['only pruned jobs', [null], 'done'], ['done and failed', ['done', 'failed'], 'partial'], ['done and cancelled', ['done', 'cancelled'], 'partial'],
    ['all failed', ['failed', 'failed'], 'failed'], ['all cancelled', ['cancelled'], 'cancelled'], ['failed and cancelled', ['failed', 'cancelled'], 'partial'],
  ];
  for (const [name, st, want] of table) { const [w, jobs] = mk(st); check(`waveState: ${name} -> ${want}`, W.waveState(w, jobs) === want, W.waveState(w, jobs)); }
  const [dw] = mk([], 'draft');
  check('waveState: a draft -> draft', W.waveState(dw, []) === 'draft');
  const [nj] = mk([], 'dispatched');
  check('waveState: dispatched without jobs -> draft', W.waveState({ ...nj, jobs: undefined }, []) === 'draft');

  // ------------------------------------------------------------------ waveOfId
  const wv = (id: string, at: string, ids: string[]): Wave => ({ id, name: id, status: 'draft', created_at: at, packages: [{ id: 'pk-1', name: 'a', model: 'opus', effort: 'high', ids }] });
  const of = W.waveOfId([wv('w-new', '2026-10-02', ['a', 'b']), wv('w-old', '2026-10-01', ['b', 'c'])]);
  check('waveOfId: the newest wave wins, whatever the list order', of.get('b')?.wave === 'w-new' && of.get('c')?.wave === 'w-old' && of.get('a')?.package === 'pk-1' && of.size === 3);
  const tie = W.waveOfId([wv('w-b', '2026-10-01', ['x']), wv('w-a', '2026-10-01', ['x'])]);
  check('waveOfId: the same time -> the greater id wins', tie.get('x')?.wave === 'w-b');

  // ------------------------------------------------------------------ the shared steps
  const T = '2026-10-13T10:00:00.000Z';
  const c1 = W.createIn([], { name: 'one', packages: [pkg('A', ['p1']), pkg('B', ['p2'])] }, T);
  check('createIn: a draft wave, packages numbered pk-1, pk-2, an id w-<base36>-<4>', c1.ok && c1.wave.status === 'draft' && c1.wave.packages.map((p) => p.id).join() === 'pk-1,pk-2' && /^w-[0-9a-z]+-[0-9a-z]{4}$/.test(c1.wave.id) && c1.wave.dispatched_at === undefined && c1.wave.jobs === undefined);
  const c2 = c1.ok ? W.createIn(c1.waves, { name: 'two', packages: [pkg('A', ['p2', 'p9'])] }, T) : c1;
  check('createIn: a finding in another draft wave -> 409 with taken', !c2.ok && c2.status === 409 && c2.taken?.join() === 'p2', JSON.stringify(c2));
  const maxed = Array.from({ length: W.MAX_WAVES }, (_, i) => wv('w-' + i, T, ['f' + i]));
  const c3 = W.createIn(maxed, { name: 'x', packages: [pkg('A', ['zz'])] }, T);
  check('createIn: at MAX_WAVES -> 429', !c3.ok && c3.status === 429);
  const dispatched = c1.ok ? { ...c1.wave, status: 'dispatched' as const, jobs: [{ package: 'pk-1', job: 'j1' }] } : wv('x', T, []);
  const c4 = W.createIn([dispatched], { name: 'again', packages: [pkg('A', ['p1'])] }, T);
  check('createIn: a finding of a DISPATCHED wave may join a new one', c4.ok);
  check('patchIn: a dispatched wave -> 409', (() => { const r = W.patchIn([dispatched], dispatched.id, { name: 'z' }); return !r.ok && r.status === 409; })());
  check('removeIn: a dispatched wave -> 409, an unknown one 404', (() => { const a = W.removeIn([dispatched], dispatched.id), b = W.removeIn([dispatched], 'w-no'); return !a.ok && a.status === 409 && !b.ok && b.status === 404; })());
  const p1 = c1.ok ? W.patchIn(c1.waves, c1.wave.id, { packages: [pkg('Only', ['p2', 'p5'])] }) : c1;
  check('patchIn: the packages replace the old ones and are numbered again; the name stays', p1.ok && p1.wave.name === 'one' && p1.wave.packages.length === 1 && p1.wave.packages[0].id === 'pk-1' && p1.wave.packages[0].ids.join() === 'p2,p5');
  const p2 = c1.ok ? W.patchIn(c1.waves, c1.wave.id, { packages: [pkg('A', ['p1'])] }) : c1;
  check('patchIn: its own findings are not taken', p2.ok);
  check('patchIn: nothing to change / a bad name -> 400', (() => { if (!c1.ok) return false; const a = W.patchIn(c1.waves, c1.wave.id, {}), b = W.patchIn(c1.waves, c1.wave.id, { name: ' ' }); return !a.ok && a.status === 400 && !b.ok && b.status === 400; })());
  check('packagesOf: all by default, the named ones in the wave order, an unknown one refused', (() => {
    if (!c1.ok) return false;
    const all = W.packagesOf(c1.wave), some = W.packagesOf(c1.wave, ['pk-2']), bad = W.packagesOf(c1.wave, ['pk-9']);
    return typeof all !== 'string' && all.length === 2 && typeof some !== 'string' && some.map((p) => p.id).join() === 'pk-2' && typeof bad === 'string';
  })());

  // ------------------------------------------------------------------ Kettle: the scan sim
  {
    const clock = Date.parse(T); // frozen: jobs start and never step
    const at = (i: number) => new Date(clock + i * 1000).toISOString();
    const fp = (id: string, status: Proposal['status'], i: number): Proposal => ({ id, run_id: 'r0', feature: 'a', lens: 'development', title: 't', standard: 'none', kind: 'fix', status, created_at: at(i), updated_at: at(i) });
    const findings = [...Array.from({ length: 12 }, (_, i) => fp('k' + String(i).padStart(2, '0'), 'proposed', i)), fp('ka', 'approved', 20), fp('kd', 'declined', 21)];
    const dev = { id: 'development', short: 'DEV', fields: [], scan: { method: 'judgement' } } as unknown as Manifest;
    const ls = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); }, removeItem: (k: string) => { ls.delete(k); } };
    const mkSim = () => { const s = new ScanSim({ now: () => clock, findings }); s.bind({ order: ['a', 'b'], manifest: (l) => (l === 'development' ? dev : undefined), value: () => undefined }); return s; };
    const sim = mkSim(), ctx = { slug: null, sim };
    try {
      check('sim: no waves at first', (await A.listWaves(ctx)).length === 0);
      const w1 = await A.createWave(ctx, { name: 'First', packages: [pkg('Deep', ['k00', 'k01', 'ka'], 'opus', 'xhigh'), pkg('Quick', ['k02'], 'sonnet', 'low')] });
      check('sim: create -> a draft wave with pk-1, pk-2', w1.status === 'draft' && w1.packages.map((p) => p.id).join() === 'pk-1,pk-2', JSON.stringify(w1));
      check('sim: the wave persists in localStorage bp.waves.kettle', (JSON.parse(ls.get('bp.waves.kettle') ?? '[]') as Wave[]).some((w) => w.id === w1.id));
      const taken = await err(() => A.createWave(ctx, { name: 'Second', packages: [pkg('X', ['k02', 'k03'])] }));
      check('sim: a finding in another draft wave -> 409 with taken', taken.status === 409 && taken.body?.taken?.join() === 'k02', JSON.stringify(taken.body));
      const bad = await err(() => A.createWave(ctx, { name: 'Bad', packages: [pkg('X', ['k03'], 'gpt')] }));
      check('sim: model gpt -> 400', bad.status === 400 && /model/.test(bad.message), bad.message);
      const d = await A.dispatchWave(ctx, w1.id);
      const [j1, j2] = d.jobs;
      check('sim: dispatch -> 202-shaped result, two jobs, ka taken as approved, k00 k01 k02 approved', d.jobs.length === 2 && d.approved.join() === 'k00,k01,k02' && d.wave.status === 'dispatched' && !!d.wave.dispatched_at && d.wave.jobs?.length === 2, JSON.stringify(d).slice(0, 300));
      check('sim: each job carries its own model, effort, wave and package', j1.model === 'opus' && j1.effort === 'xhigh' && j1.package === 'pk-1' && j1.wave === w1.id && j2.model === 'sonnet' && j2.effort === 'low' && j2.package === 'pk-2'
        && j1.proposals?.join() === 'k00,k01,ka' && j2.proposals?.join() === 'k02', JSON.stringify([j1, j2]));
      check('sim: the sim jobs are the ones the wave names', sim.jobs().filter((j) => j.wave === w1.id).map((j) => j.id).join() === d.wave.jobs?.map((x) => x.job).join());
      check('sim: the wave reads running from its jobs', W.waveState(d.wave, [...sim.jobs()]) === 'running');
      const again = await err(() => A.dispatchWave(ctx, w1.id));
      check('sim: dispatching again while its jobs run -> 409, skipped as in-job/executing', again.status === 409 && again.body?.skipped?.length === 4, JSON.stringify(again.body));
      const pu = await err(() => A.updateWave(ctx, w1.id, { name: 'Renamed' })), de = await err(() => A.deleteWave(ctx, w1.id));
      check('sim: patch and delete of a dispatched wave -> 409', pu.status === 409 && de.status === 409, pu.status + ',' + de.status);
      const w2 = await A.createWave(ctx, { name: 'Second', packages: [pkg('X', ['k03', 'k04'])] });
      const upd = await A.updateWave(ctx, w2.id, { name: 'Second!', packages: [pkg('Y', ['k03'], 'sonnet', 'medium')] });
      check('sim: patch a draft -> renamed, packages replaced', upd.name === 'Second!' && upd.packages.length === 1 && upd.packages[0].model === 'sonnet' && upd.packages[0].ids.join() === 'k03');
      check('sim: delete a draft -> its id, and it is gone', (await A.deleteWave(ctx, w2.id)).id === w2.id && (await A.listWaves(ctx)).every((w) => w.id !== w2.id));
      const nope = await err(() => A.dispatchWave(ctx, 'w-none')), nopk = await err(() => A.dispatchWave(ctx, w1.id, ['pk-9']));
      check('sim: an unknown wave 404, an unknown package 400', nope.status === 404 && nopk.status === 400, nope.status + ',' + nopk.status);
      const direct = sim.dispatch(['k05'], { model: 'sonnet', effort: 'medium' });
      check('sim: dispatch(ids, opts) stores model and effort on the job; a plain dispatch stores none', direct.job.model === 'sonnet' && direct.job.effort === 'medium' && direct.job.wave === undefined
        && !('model' in sim.dispatch(['k06']).job) && (await err(() => sim.dispatch(['k07'], { model: 'gpt' as never }))).message === 'bad-opts');
      // a wave dispatched in an earlier visit: this sim has none of its jobs, so it reads as a draft again
      const sim2 = mkSim();
      const back = await A.listWaves({ slug: null, sim: sim2 });
      check('sim: a wave dispatched in an earlier visit is a draft again (no stale job ids)', back.length === 1 && back[0].status === 'draft' && back[0].jobs === undefined && back[0].dispatched_at === undefined, JSON.stringify(back).slice(0, 200));
      sim2.dispose();
      // storage that refuses: memory holds the waves
      (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
      const sim3 = mkSim();
      const m1 = await A.createWave({ slug: null, sim: sim3 }, { name: 'Mem', packages: [pkg('M', ['k08'])] });
      check('sim: storage that throws -> the waves live in memory', (await A.listWaves({ slug: null, sim: sim3 })).some((w) => w.id === m1.id));
      sim3.dispose();
      (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); }, removeItem: (k: string) => { ls.delete(k); } };
    } finally { sim.dispose(); }

    // 429 mid-way: 3 running + 15 queued scans, then a wave of two packages: the first queues (16th), the second is refused
    ls.clear();
    const simQ = mkSim();
    try {
      for (let i = 0; i < 18; i++) simQ.startScan('development', { kind: 'selection', label: 'Selection (1)', features: ['a'] });
      const wq = simQ.createWave({ name: 'Q', packages: [pkg('One', ['k00']), pkg('Two', ['k01'])] });
      const r = await err(() => simQ.dispatchWave(wq.id));
      check('sim: 429 mid-way -> queue-full, the body carries the wave and the one job queued', r.status === 429 && r.message === 'queue-full' && r.body?.jobs?.length === 1 && r.body.wave?.jobs?.length === 1 && r.body.wave.status === 'dispatched'
        && r.body.approved.join() === 'k00,k01', JSON.stringify(r.body).slice(0, 300));
      check('sim: the 429 is recorded in the stored wave too', simQ.listWaves().find((w) => w.id === wq.id)?.jobs?.length === 1);
    } finally { simQ.dispose(); delete (globalThis as { localStorage?: unknown }).localStorage; }
  }

  // ------------------------------------------------------------------ live: routes over the fake CLI
  const mkProduct = (name: string, proposals: [string, string][]) => {
    const root = path.join(dir, name), store = path.join(root, '.ai/lens-scan');
    fs.mkdirSync(store, { recursive: true });
    const db = new DatabaseSync(path.join(store, 'scan.db'));
    db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
    db.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r0', ?, ?, 'measure', 'done', '[]')").run(T, T);
    const ins = db.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES (?, 'r0', 'a', 'development', 't', 'fix', ?, ?, ?)");
    for (const [id, s] of proposals) ins.run(id, s, T, T);
    db.close();
    return { root, file: path.join(root, '.ai/lens-scan/work/bp-waves.json'), store: path.join(store, 'scan.db') };
  };
  const live = mkProduct('live', [['p1', 'proposed'], ['p2', 'approved'], ['p3', 'proposed'], ['p4', 'proposed'], ['p5', 'proposed'], ['p6', 'done'], ['p7', 'proposed'], ['p8', 'proposed']]);
  const full = mkProduct('full', [['q1', 'proposed'], ['q2', 'proposed'], ['q3', 'proposed']]);
  const bent = mkProduct('bent', [['b1', 'proposed']]);
  fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [
    { slug: 'live', name: 'Live', root: live.root }, { slug: 'full', name: 'Full', root: full.root }, { slug: 'bent', name: 'Bent', root: bent.root }] }));
  process.chdir(dir);
  const route = (rel: string) => load<any>('apps/web/src/app/api/' + rel); // eslint-disable-line @typescript-eslint/no-explicit-any
  const H = { host: 'localhost:3000', 'content-type': 'application/json' };
  const call = async (fn: (req: Request, ctx: unknown) => Promise<Response>, method: string, params: object, body?: unknown, headers: Record<string, string> = H) => {
    const res = await fn(new Request('http://localhost:3000/x', { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve(params) });
    return { status: res.status, body: await res.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const waves = await route('products/[slug]/waves/route.ts'), one = await route('products/[slug]/waves/[wave]/route.ts'), disp = await route('products/[slug]/waves/[wave]/dispatch/route.ts');
  const status = (file: string, id: string) => { const d = new DatabaseSync(file, { readOnly: true }); try { return (d.prepare('SELECT status FROM proposals WHERE id = ?').get(id) as { status: string }).status; } finally { d.close(); } };
  const argvOf = (j?: ScanJob): string[] => { const m = /^argv (.*)$/m.exec(j?.log_tail ?? ''); try { return m ? JSON.parse(m[1]) : []; } catch { return []; } };

  const g0 = await call(waves.GET, 'GET', { slug: 'live' });
  check('GET waves: no file -> 200 { waves: [] }', g0.status === 200 && Array.isArray(g0.body.waves) && g0.body.waves.length === 0 && !fs.existsSync(live.file), JSON.stringify(g0));
  const mk1 = await call(waves.POST, 'POST', { slug: 'live' }, { name: 'Live one', packages: [pkg('Deep', ['p1', 'p2'], 'opus', 'xhigh'), pkg('Quick', ['p3'], 'sonnet', 'low')] });
  check('POST waves -> 201 { wave }, packages pk-1 pk-2, the file written', mk1.status === 201 && mk1.body.wave.packages.map((p: { id: string }) => p.id).join() === 'pk-1,pk-2' && JSON.parse(fs.readFileSync(live.file, 'utf8')).version === 1, JSON.stringify(mk1.body));
  const wid: string = mk1.body.wave?.id ?? '';
  check('the wave file is { version: 1, waves } and leaves no tmp file', JSON.parse(fs.readFileSync(live.file, 'utf8')).waves[0].id === wid && fs.readdirSync(path.dirname(live.file)).every((f) => !f.endsWith('.tmp')));
  const tk = await call(waves.POST, 'POST', { slug: 'live' }, { name: 'Rival', packages: [pkg('X', ['p3', 'p4'])] });
  check('POST waves: a finding already in another draft wave -> 409 { error, taken }', tk.status === 409 && tk.body.taken?.join() === 'p3' && /already in another draft wave/.test(tk.body.error), JSON.stringify(tk.body));
  const gpt = await call(waves.POST, 'POST', { slug: 'live' }, { name: 'Gpt', packages: [pkg('X', ['p4'], 'gpt')] });
  check('POST waves: model gpt -> 400 and nothing stored', gpt.status === 400 && /model/.test(gpt.body.error) && (await call(waves.GET, 'GET', { slug: 'live' })).body.waves.length === 1, JSON.stringify(gpt.body));
  const guards = await Promise.all([
    call(waves.POST, 'POST', { slug: 'live' }, { name: 'x', packages: [] }), call(waves.POST, 'POST', { slug: 'nope' }, { name: 'x', packages: [pkg('A', ['p4'])] }),
    call(waves.POST, 'POST', { slug: 'live' }, { name: 'x', packages: [pkg('A', ['p4'])] }, { host: 'evil.com', 'content-type': 'application/json' }),
    call(waves.POST, 'POST', { slug: 'live' }, { name: 'x', packages: [pkg('A', ['p4'])] }, { host: 'localhost:3000', 'content-type': 'text/plain' }),
    call(waves.GET, 'GET', { slug: 'live' }, undefined, { host: 'evil.com' }),
  ]);
  check('waves guards: empty packages 400, unknown product 404, foreign host 403, not JSON 415, a foreign GET 403', guards.map((g) => g.status).join() === '400,404,403,415,403', guards.map((g) => g.status).join());
  const patched = await call(one.PATCH, 'PATCH', { slug: 'live', wave: wid }, { name: 'Live one!' });
  check('PATCH waves/[wave]: a draft renamed -> 200 { wave }', patched.status === 200 && patched.body.wave.name === 'Live one!' && patched.body.wave.packages.length === 2, JSON.stringify(patched.body).slice(0, 200));
  const otherId: string = (await call(waves.POST, 'POST', { slug: 'live' }, { name: 'Other', packages: [pkg('O', ['p7'])] })).body.wave.id;
  const pt = await call(one.PATCH, 'PATCH', { slug: 'live', wave: otherId }, { packages: [pkg('O', ['p3'])] });
  check('PATCH waves/[wave]: onto a finding of another draft wave -> 409 taken', pt.status === 409 && pt.body.taken?.join() === 'p3', JSON.stringify(pt.body));
  const del = await call(one.DELETE, 'DELETE', { slug: 'live', wave: otherId });
  check('DELETE waves/[wave]: a draft -> 200 { id }', del.status === 200 && del.body.id === otherId && (await call(waves.GET, 'GET', { slug: 'live' })).body.waves.length === 1);
  const odd = await Promise.all([call(one.DELETE, 'DELETE', { slug: 'live', wave: 'w-none' }), call(one.PATCH, 'PATCH', { slug: 'live', wave: 'w-none' }, { name: 'x' }), call(one.DELETE, 'DELETE', { slug: 'live', wave: 'a b' }), call(disp.POST, 'POST', { slug: 'live', wave: 'w-none' }, {})]);
  check('wave routes: unknown wave 404 (delete, patch, dispatch), an unsafe id 400', odd.map((o) => o.status).join() === '404,404,400,404', odd.map((o) => o.status).join());
  const badPk = await call(disp.POST, 'POST', { slug: 'live', wave: wid }, { packages: ['pk-9'] }), badBody = await call(disp.POST, 'POST', { slug: 'live', wave: wid }, { packages: 'pk-1' });
  check('dispatch: an unknown package 400, packages not a list 400', badPk.status === 400 && badBody.status === 400, badPk.status + ',' + badBody.status);

  // the model allow-list, before any spawn
  const before = J.list('live').length;
  const g = J.enqueueExecute('live', live.root, ['p4'], { model: 'gpt' as never }), e = J.enqueueExecute('live', live.root, ['p4'], { effort: 'max' as never }), o = J.enqueueExecute('live', live.root, ['p4'], { wave: 'w; calc' });
  check('enqueueExecute: model gpt, effort max, an unsafe wave id -> 400 bad-opts, no job', [g, e, o].every((r) => !r.ok && r.status === 400 && r.error === 'bad-opts') && J.list('live').length === before);

  const dd = await call(disp.POST, 'POST', { slug: 'live', wave: wid }, {});
  check('POST waves/[wave]/dispatch -> 202, two jobs, p1 p3 approved, the wave dispatched', dd.status === 202 && dd.body.jobs.length === 2 && dd.body.approved.join() === 'p1,p3' && dd.body.wave.status === 'dispatched' && !!dd.body.wave.dispatched_at && dd.body.wave.jobs.length === 2, JSON.stringify(dd.body).slice(0, 300));
  const [a, b]: ScanJob[] = dd.body.jobs ?? [];
  check('the jobs carry model, effort, wave and package', a?.model === 'opus' && a.effort === 'xhigh' && a.package === 'pk-1' && a.wave === wid && b?.model === 'sonnet' && b.effort === 'low' && b.package === 'pk-2' && a.proposals?.join() === 'p1,p2' && b.proposals?.join() === 'p3', JSON.stringify([a, b]));
  check('both jobs finish', await until(() => !!a && !!b && ['done', 'failed'].includes(job('live', a.id)?.status ?? '') && ['done', 'failed'].includes(job('live', b.id)?.status ?? '')), J.list('live').map((j) => j.status).join());
  const base = ['-p', '--dangerously-skip-permissions', '--output-format', 'text'];
  check('`--model opus --effort xhigh` reached the first child', JSON.stringify(argvOf(job('live', a?.id))) === JSON.stringify([...base, '--model', 'opus', '--effort', 'xhigh']), JSON.stringify(argvOf(job('live', a?.id))));
  check('`--model sonnet --effort low` reached the second child', JSON.stringify(argvOf(job('live', b?.id))) === JSON.stringify([...base, '--model', 'sonnet', '--effort', 'low']), JSON.stringify(argvOf(job('live', b?.id))));
  check('a plain job reaches the child with the fixed flags only', await (async () => {
    const r = J.enqueueExecute('live', live.root, ['p8']);
    if (!r.ok) return false;
    await until(() => ['done', 'failed'].includes(job('live', r.job.id)?.status ?? ''));
    const j = job('live', r.job.id);
    return JSON.stringify(argvOf(j)) === JSON.stringify(base) && !('model' in r.job) && !('wave' in r.job);
  })());
  const logFile = path.join(live.root, '.ai/lens-scan/work/bp-jobs', a?.id + '.log');
  check('the log header names model, effort, wave and package', fs.readFileSync(logFile, 'utf8').includes(`# model opus · effort xhigh · wave ${wid} · package pk-1`), fs.readFileSync(logFile, 'utf8').slice(0, 300));
  check('the proposals were approved through the store (p1, p3) and p2 kept', ['p1', 'p3'].every((id) => status(live.store, id) !== 'proposed') && status(live.store, 'p2') !== 'proposed');
  check('GET waves reads the dispatched wave back with its jobs', (await call(waves.GET, 'GET', { slug: 'live' })).body.waves[0].jobs.length === 2);
  const pd = await call(one.PATCH, 'PATCH', { slug: 'live', wave: wid }, { name: 'z' }), dd2 = await call(one.DELETE, 'DELETE', { slug: 'live', wave: wid });
  check('PATCH and DELETE of a dispatched wave -> 409', pd.status === 409 && dd2.status === 409, pd.status + ',' + dd2.status);
  const rest = await call(disp.POST, 'POST', { slug: 'live', wave: wid }, { packages: ['pk-2'] });
  check('Dispatch remaining: only the named package -> 202, one more job appended to wave.jobs, dispatched_at kept', rest.status === 202 && rest.body.jobs.length === 1 && rest.body.jobs[0].package === 'pk-2' && rest.body.wave.jobs.length === 3
    && rest.body.wave.dispatched_at === dd.body.wave.dispatched_at, JSON.stringify(rest.body).slice(0, 300));
  await until(() => ['done', 'failed'].includes(job('live', rest.body.jobs?.[0]?.id)?.status ?? ''));
  // the fake CLI builds nothing; what a real run does to the findings (done) is written here, so nothing is left to build
  const sdb = new DatabaseSync(live.store);
  sdb.exec("UPDATE proposals SET status = 'done' WHERE id IN ('p1', 'p2', 'p3')");
  sdb.close();
  const nothing = await call(disp.POST, 'POST', { slug: 'live', wave: wid }, {});
  check('dispatching again with nothing buildable -> 409 { error, skipped }', nothing.status === 409 && Array.isArray(nothing.body.skipped) && nothing.body.skipped.length === 3 && nothing.body.skipped.every((x: { status: string }) => x.status === 'done'), JSON.stringify(nothing.body));

  // a hand-edited waves file with a model outside the allow-list: the dispatch refuses before any spawn
  const hand = { version: 1, waves: [{ id: 'w-hand', name: 'Hand', status: 'draft', created_at: T, packages: [{ id: 'pk-1', name: 'H', model: 'gpt', effort: 'high', ids: ['p5'] }] }] };
  const keep = fs.readFileSync(live.file, 'utf8');
  fs.writeFileSync(live.file, JSON.stringify(hand));
  const jn = J.list('live').length, hd = await call(disp.POST, 'POST', { slug: 'live', wave: 'w-hand' }, {});
  check('a model gpt in the file: dispatch -> 400 bad-opts, nothing approved, no job spawned, the wave stays a draft', hd.status === 400 && /bad-opts/.test(hd.body.error) && J.list('live').length === jn && status(live.store, 'p5') === 'proposed' && JSON.parse(fs.readFileSync(live.file, 'utf8')).waves[0].status === 'draft', JSON.stringify(hd.body).slice(0, 300));
  fs.writeFileSync(live.file, keep);

  // 429 mid-way: fill the queue (3 running slow scans + 15 queued), then dispatch two packages: one fits, the second is refused
  const slow = Array.from({ length: 18 }, () => J.enqueueMeasure('full', full.root, 'slow', { kind: 'all', label: 'Everything', features: [] }));
  check('the full product holds 3 running and 15 queued', slow.every((r) => r.ok) && J.list('full').filter((j) => j.status === 'queued').length === 15, J.list('full').map((j) => j.status).join());
  const fw = await call(waves.POST, 'POST', { slug: 'full' }, { name: 'Full', packages: [pkg('One', ['q1'], 'opus', 'high'), pkg('Two', ['q2'], 'sonnet', 'medium')] });
  const fd = await call(disp.POST, 'POST', { slug: 'full', wave: fw.body.wave.id }, {});
  check('429 mid-way -> { error, wave, jobs, approved, skipped }: one job queued, recorded in wave.jobs', fd.status === 429 && fd.body.jobs.length === 1 && fd.body.wave.jobs.length === 1 && fd.body.wave.jobs[0].package === 'pk-1' && fd.body.wave.status === 'dispatched'
    && fd.body.approved.join() === 'q1,q2' && /queued/.test(fd.body.error), JSON.stringify(fd.body).slice(0, 300));
  check('the 429 is in the stored wave too (status dispatched, one job)', JSON.parse(fs.readFileSync(full.file, 'utf8')).waves[0].jobs.length === 1 && status(full.store, 'q2') === 'approved');
  const fq = await call(waves.POST, 'POST', { slug: 'full' }, { name: 'Late', packages: [pkg('L', ['q3'])] });
  const fd0 = await call(disp.POST, 'POST', { slug: 'full', wave: fq.body.wave.id }, {});
  check('429 with nothing queued before it -> the wave stays a draft', fd0.status === 429 && fd0.body.jobs.length === 0 && fd0.body.wave.status === 'draft', JSON.stringify(fd0.body).slice(0, 200));
  for (const j of J.list('full').filter((x) => x.status === 'queued')) J.cancel('full', j.id);
  for (const j of J.list('full')) J.cancel('full', j.id);

  // a corrupt waves file survives a GET (and a POST moves it aside instead of overwriting it)
  fs.mkdirSync(path.dirname(bent.file), { recursive: true });
  fs.writeFileSync(bent.file, '{ nope');
  const gb = await call(waves.GET, 'GET', { slug: 'bent' }), gb2 = await call(waves.GET, 'GET', { slug: 'bent' });
  check('a corrupt waves file: GET -> 200 { waves: [] }, the file untouched', gb.status === 200 && gb.body.waves.length === 0 && gb2.status === 200 && fs.readFileSync(bent.file, 'utf8') === '{ nope');
  const pb = await call(waves.POST, 'POST', { slug: 'bent' }, { name: 'After', packages: [pkg('A', ['b1'])] });
  check('a POST over a corrupt file creates the wave and keeps the broken text in bp-waves.corrupt.json', pb.status === 201 && fs.readFileSync(bent.file.replace(/\.json$/, '.corrupt.json'), 'utf8') === '{ nope' && JSON.parse(fs.readFileSync(bent.file, 'utf8')).waves.length === 1);
  fs.writeFileSync(bent.file, JSON.stringify({ version: 1, waves: 'x' }));
  check('a waves file with no list reads as none', (await call(waves.GET, 'GET', { slug: 'bent' })).body.waves.length === 0);
} finally {
  process.chdir(os.tmpdir());
  for (const slug of ['live', 'full', 'bent']) for (const j of J.list(slug)) J.cancel(slug, j.id);
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
}
void WS;
console.log(failed ? `check-waves: ${failed} failed, ${passed} passed` : `check-waves: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
