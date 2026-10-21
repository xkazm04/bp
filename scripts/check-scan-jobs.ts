// Checks the scan-job backend (docs/blueprint-ui.md, "Scan jobs") against a fake Claude Code CLI
// (scripts/fixtures/fake-claude.mjs; BP_CLAUDE_BIN points at it, the real `claude` never runs):
//   - the registry: 3 running per product and the 4th queued until one exits; done / failed (exit code, last stderr
//     line, log file, log_tail); exit 0 without a store run = failed with lens-scan's refusal line; cancel of a queued
//     and of a running job (its process is gone); the queue cap (429); a missing CLI;
//   - the prompt goes on stdin, never in argv; an unsafe lens id or feature is refused before anything spawns;
//   - attachRun by note (`bp-job:<id>` and `bp-job:<id> <more>`, never a bare prefix), and subscribe;
//   - the lens-draft parser (a valid block, an invalid one, none; project and temporary modes, a taken look) and the
//     onboarding chat route over the fake (`/lens-scan onboard --draft-only [--temporary]` on the first turn);
//   - the routes: scans (202 / unknown-lens / no-scan-method / bad-scope; a selection of 1..200 features), dispatch
//     (approve + one execute job, 409), lens execute (approve + jobs of 50 in store order, 409, 400), lenses (project
//     and temporary 201 / bad reverse DNS 400 / taken look 400 / 409 / PATCH and DELETE of project lenses / built-in
//     403, the map's key order and facets kept), and a map carrying the new temporary entry passes
//     validate-structure while a temporary entry with a reverse-DNS id does not;
//   - the release train: triage (through lens-scan store.mjs) and its undo (reopen: back to the status left, the pack
//     open again, refused in-release once the release left draft), releases POST, suggest, build/finish release jobs over
//     the fake (draft -> building -> pr-open -> tagged, run_id from the release-head measure run, 412 when gh is signed
//     out), and the commits route on a fixture git repo (200 with stat, numstat and the patch cut at 2000 lines; 404 for
//     a sha that is no item commit, even one the repo has; 400 for a bad sha), each 200 body through the parser door;
//   - Kettle parity: the scan sim's selection scans and lens execute, and addProjectLens over the browser's store.
// Checks that need WP1's full checkLensManifest (project mode, taken looks) print SKIP while it is the S0 stub.
// Run: node scripts/check-scan-jobs.ts  (Node's type stripping; no build step). Exit 1 on any failure. ~15 s.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the hooks module is plain JS without types: imported through a variable so tsc does not look for its declarations
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT); // resolves '@/' in the routes
const FAKE = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');
process.env.BP_CLAUDE_BIN = FAKE;

const J = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/jobs.server.ts')).href) as typeof import('../packages/core/src/server/jobs.server.ts');
const { parseDraftReply } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/lens-draft.ts')).href) as typeof import('../packages/core/src/scan/lens-draft.ts');
const { scopeFeatures } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/scope.ts')).href) as typeof import('../packages/core/src/scan/scope.ts');
const { checkLensManifest } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/manifest-check.ts')).href) as typeof import('../packages/core/src/scan/manifest-check.ts');
const { ScanSim } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/scan-sim.ts')).href) as typeof import('../packages/core/src/model/scan-sim.ts');
type ScanJob = import('../packages/core/src/scan/jobs.ts').ScanJob;
type ScanScope = import('../packages/core/src/scan/jobs.ts').ScanScope;
type Proposal = import('../packages/core/src/scan/types.ts').Proposal;

let failed = 0, passed = 0, skipped = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
/**
 * A check that needs the full checkLensManifest (project mode, taken looks). WP1 landed it, so a checker that
 * cannot do this is a FAILURE, not a skip: while this skipped, seven expectations could vanish from the run and
 * `check-scan-jobs: N checks passed` read exactly as it does now. The call stays lazy so a regressed checker is
 * reported rather than thrown out of.
 */
const checkIf = (ready: boolean, name: string, ok: () => boolean, detail = () => '') => {
  if (ready) { check(name, ok(), detail()); return; }
  failed++;
  console.log('FAIL ' + name + ': checkLensManifest cannot judge this (the S0 stub is back, or the mode was dropped)');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 30000): Promise<boolean> { const t = Date.now() + ms; while (Date.now() < t) { if (pred()) return true; await sleep(50); } return pred(); }
const job = (slug: string, id: string): ScanJob | undefined => J.list(slug).find((j) => j.id === id);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidOf = (j?: ScanJob) => Number(/^pid (\d+)$/m.exec(j?.log_tail ?? '')?.[1] ?? 0);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-scan-jobs-'));
const repo = (name: string) => { const r = path.join(dir, name); fs.mkdirSync(r, { recursive: true }); return r; };
const feat = (f: string[]): ScanScope => ({ kind: 'room', id: 'room-1', label: 'Room 1', features: f });
const ALL: ScanScope = { kind: 'all', label: 'Everything', features: [] };
const MANIFEST = {
  $schema: 'lens-manifest/1', id: 'tmp.money-migration', version: '1.0.0', name: 'Money migration', short: 'MIG', reader: { density: 'simple' },
  fields: [{ key: 'oldMoneySites', label: 'Old money sites', type: 'integer', headline: true, metric: { better: 'down', method: 'judgement' } }],
  health: { rules: [{ when: { field: 'oldMoneySites', gt: 0 }, health: 'watch', reason: '{oldMoneySites} sites left' }], default: 'good', rollup: { method: 'worst-of' } },
  presentation: { glyph: 'brackets', line: 'comb', measures: 'oldMoneySites' },
  scan: { method: 'judgement', instructions: 'Count the call sites of the old Money type; untouched features are no impact.' },
};
/** A permanent project lens: reverse-DNS id, a look of its own. */
const PROJECT = { ...MANIFEST, id: 'com.example.money', presentation: { glyph: 'padlock', line: 'chain', measures: 'oldMoneySites' } };
// feature tests on the checker: WP1 landed the full one, and the run now says so out loud rather than
// letting the seven checkIf expectations below quietly skip (scripts/check-lens-manifest.ts holds the checker itself)
const projectReady = checkLensManifest(PROJECT, { mode: 'project' }) === null;
const lookReady = checkLensManifest(MANIFEST, { mode: 'temporary', taken: [{ glyph: 'brackets', line: 'comb' }] }) !== null;
check('checkLensManifest judges project mode and a taken look (else the 7 checks that need it would not run)', projectReady && lookReady, `project ${projectReady}, look ${lookReady}`);

try {
  // ------------------------------------------------------------------ queue cap, done, stdin prompt, attach at exit
  const capRoot = repo('cap'), seen: ScanJob[][] = [];
  const unsub = J.subscribe('cap', (js) => seen.push(js));
  const four = [0, 1, 2, 3].map(() => J.enqueueMeasure('cap', capRoot, 'wait', feat(['a', 'b'])));
  const ids = four.map((r) => (r.ok ? r.job.id : ''));
  check('enqueue answers the job', four.every((r) => r.ok) && new Set(ids).size === 4 && ids.every((i) => /^j-[0-9a-z]+-[0-9a-z]{4}$/.test(i)), ids.join());
  const st = () => ids.map((i) => job('cap', i)?.status).join();
  check('3 run, the 4th waits', st() === 'running,running,running,queued', st());
  check('the 4th starts when one exits', await until(() => job('cap', ids[3])?.status !== 'queued' && job('cap', ids[0])?.status === 'done'), st());
  check('all 4 finish done', await until(() => ids.every((i) => job('cap', i)?.status === 'done')), st());
  const d0 = job('cap', ids[0]);
  check('done: exit 0, started/ended set', d0?.exit_code === 0 && !!d0.started_at && !!d0.ended_at && !d0.error, JSON.stringify(d0));
  check('done: run_id read from the store at exit (note bp-job:<id> · more)', d0?.run_id === 'run-' + ids[0], d0?.run_id);
  check('prompt reaches the CLI on stdin', /^stdin \/lens-scan measure --lens wait --scope a,b$/m.test(d0?.log_tail ?? ''), d0?.log_tail);
  const argvLine = /^argv (.*)$/m.exec(d0?.log_tail ?? '')?.[1] ?? '';
  check('argv is the fixed flags only (no lens id, no prompt)', argvLine === JSON.stringify(['-p', '--dangerously-skip-permissions', '--output-format', 'text']), argvLine);
  const logFile = path.join(capRoot, '.ai/lens-scan/work/bp-jobs', ids[0] + '.log');
  check('log file written', fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('stdin /lens-scan measure'), logFile);
  check('subscribe heard the changes', seen.length >= 4 && seen[seen.length - 1].every((j) => j.status === 'done'), String(seen.length));
  unsub();
  const n = seen.length; J.enqueueMeasure('cap', capRoot, 'x', ALL);
  check('unsubscribe stops the calls', seen.length === n);
  check('scope all: no --scope in the prompt', await until(() => /^stdin \/lens-scan measure --lens x$/m.test(J.list('cap').at(-1)?.log_tail ?? '')), J.list('cap').at(-1)?.log_tail);

  // ------------------------------------------------------------------ failed, refused, missing CLI
  const fr = repo('fail');
  const f1 = J.enqueueMeasure('fail', fr, 'fail', ALL), f2 = J.enqueueMeasure('fail', fr, 'refuse', ALL);
  await until(() => J.list('fail').every((j) => j.status !== 'queued' && j.status !== 'running'));
  const jf = f1.ok ? job('fail', f1.job.id) : undefined, jr = f2.ok ? job('fail', f2.job.id) : undefined;
  check('exit 3 -> failed, exit_code 3, error = last stderr line', jf?.status === 'failed' && jf.exit_code === 3 && jf.error === 'boom: failed on purpose', JSON.stringify(jf));
  check('failed: log_tail holds the last lines', (jf?.log_tail ?? '').includes('boom: failed on purpose') && (jf?.log_tail ?? '').split('\n').length <= 20);
  check('exit 0 without a run -> failed with the refusal line', jr?.status === 'failed' && jr.error === 'lens-scan refused: unknown slug' && jr.run_id === undefined, JSON.stringify(jr));
  process.env.BP_CLAUDE_BIN = path.join(dir, 'no-such-cli.mjs');
  const m1 = J.enqueueMeasure('fail', fr, 'x', ALL);
  await until(() => !!m1.ok && job('fail', m1.job.id)?.status === 'failed');
  check('missing CLI (.mjs) -> failed, CLI not found', m1.ok && job('fail', m1.job.id)?.error === J.CLI_MISSING, JSON.stringify(m1.ok && job('fail', m1.job.id)));
  process.env.BP_CLAUDE_BIN = 'bp-no-such-cli-' + process.pid;
  const m2 = J.enqueueMeasure('fail', fr, 'x', ALL);
  await until(() => !!m2.ok && job('fail', m2.job.id)?.status === 'failed');
  check('missing CLI (not on PATH) -> failed, CLI not found', m2.ok && job('fail', m2.job.id)?.error === J.CLI_MISSING, JSON.stringify(m2.ok && job('fail', m2.job.id)));
  process.env.BP_CLAUDE_BIN = FAKE;

  // ------------------------------------------------------------------ unsafe ids never spawn
  const before = J.list('safe').length;
  const u1 = J.enqueueMeasure('safe', repo('safe'), 'x; rm -rf', ALL), u2 = J.enqueueMeasure('safe', repo('safe'), 'ok', feat(['a', 'b c&calc'])), u3 = J.enqueueExecute('safe', repo('safe'), ['p1', '$(boom)']);
  check('unsafe lens id refused before spawn', !u1.ok && u1.status === 400 && u1.error === 'unknown-lens');
  check('unsafe feature refused before spawn', !u2.ok && u2.status === 400 && u2.error === 'bad-scope');
  check('unsafe proposal id refused before spawn', !u3.ok && u3.status === 400);
  check('a non-all scope without features is refused', !J.enqueueMeasure('safe', repo('safe'), 'ok', feat([])).ok);
  check('nothing was queued for refused jobs', J.list('safe').length === before);

  // ------------------------------------------------------------------ cancel queued and running, queue cap 429
  const cr = repo('cancel');
  const slow = [0, 1, 2, 3].map(() => J.enqueueMeasure('cancel', cr, 'slow', ALL));
  const sid = slow.map((r) => (r.ok ? r.job.id : ''));
  await until(() => sid.slice(0, 3).every((i) => pidOf(job('cancel', i)) > 0));
  const cq = J.cancel('cancel', sid[3]);
  check('cancel a queued job', cq?.status === 'cancelled' && !!cq.ended_at && job('cancel', sid[3])?.status === 'cancelled');
  const queued = Array.from({ length: J.MAX_QUEUED }, () => J.enqueueMeasure('cancel', cr, 'slow', ALL));
  const over = J.enqueueMeasure('cancel', cr, 'slow', ALL);
  check('16 queued are accepted, the 17th is 429', queued.every((r) => r.ok) && !over.ok && over.status === 429, JSON.stringify(over));
  for (const q of queued) if (q.ok) J.cancel('cancel', q.job.id);
  const pid = pidOf(job('cancel', sid[0]));
  check('the running fake is alive', pid > 0 && alive(pid), String(pid));
  const cr0 = J.cancel('cancel', sid[0]);
  check('cancel a running job answers cancelled', cr0?.status === 'cancelled');
  check('its process is gone', await until(() => !alive(pid), 8000), String(pid));
  check('it stays cancelled after the exit', await until(() => job('cancel', sid[0])?.status === 'cancelled' && J.list('cancel').filter((j) => j.status === 'running').length === 2));
  check('cancel of an unknown job is null', J.cancel('cancel', 'j-nope-0000') === null);
  for (const i of sid) J.cancel('cancel', i);
  await until(() => sid.slice(0, 3).every((i) => !alive(pidOf(job('cancel', i)))), 8000);

  // ------------------------------------------------------------------ attachRun
  const ar = J.enqueueMeasure('attach', repo('attach'), 'slow', ALL);
  const aid = ar.ok ? ar.job.id : '';
  check('attachRun: a bare prefix does not match', !J.attachRun('attach', 'run-p', 'bp-job:' + aid.slice(0, -1)) && !J.attachRun('attach', 'run-q', 'bp-job:' + aid + 'x'));
  check('attachRun: bp-job:<id> <more> attaches', J.attachRun('attach', 'run-1', 'bp-job:' + aid + ' · scan of room 1') && job('attach', aid)?.run_id === 'run-1');
  check('attachRun: same again changes nothing; other notes are ignored', !J.attachRun('attach', 'run-1', 'bp-job:' + aid) && !J.attachRun('attach', 'run-2', 'manual run'));
  J.cancel('attach', aid);

  // ------------------------------------------------------------------ scopeFeatures with a features list
  const fs3 = [{ id: 'a', domain: 'Pay', capability: 'c1' }, { id: 'b', domain: 'Pay', capability: 'c2' }, { id: 'c', domain: 'Ops', capability: 'c3' }];
  check('scopeFeatures: features list', scopeFeatures({ scope: { features: ['a', 'c'] } }, fs3).map((f) => f.id).join() === 'a,c');
  check('scopeFeatures: a list matching nothing falls back to all; proposals scope = all', scopeFeatures({ scope: { features: ['zz'] } }, fs3).length === 3 && scopeFeatures({ scope: { proposals: ['p1'] } }, fs3).length === 3);

  // ------------------------------------------------------------------ draft parser
  const block = (o: unknown) => 'Here it is.\n\n```lens-manifest\n' + JSON.stringify(o, null, 2) + '\n```\n\nSay if it fits.';
  const TMP = { mode: 'temporary' } as const;
  const ok = parseDraftReply(block(MANIFEST), TMP);
  check('draft: a valid block -> draft, reply without the block', !!ok.draft && ok.draft.id === 'tmp.money-migration' && !ok.error && ok.reply === 'Here it is.\n\nSay if it fits.', JSON.stringify(ok).slice(0, 200));
  const badId = parseDraftReply(block({ ...MANIFEST, id: 'com.x.money' }), TMP);
  check('draft: invalid manifest -> error says why', !badId.draft && /tmp\.<kebab>/.test(badId.error ?? ''), badId.error);
  const noScan = parseDraftReply(block({ ...MANIFEST, scan: undefined }), TMP);
  check('draft: no scan block -> error', !noScan.draft && /scan/.test(noScan.error ?? ''), noScan.error);
  const strField = parseDraftReply(block({ ...MANIFEST, fields: [{ key: 'oldMoneySites', label: 'x', type: 'string', metric: { better: 'down', method: 'judgement' } }] }), TMP);
  check('draft: a metric on a non-numeric field -> error', !strField.draft && /not numeric/.test(strField.error ?? ''), strField.error);
  const notJson = parseDraftReply('Here.\n```lens-manifest\n{ nope\n```', TMP);
  check('draft: a block that is not JSON -> error', !notJson.draft && /not valid JSON/.test(notJson.error ?? ''), notJson.error);
  const twice = parseDraftReply('First try.\n```lens-manifest\n' + JSON.stringify({ ...MANIFEST, id: 'com.x.money' }) + '\n```\nOne value was wrong; corrected:\n```lens-manifest\n' + JSON.stringify(MANIFEST) + '\n```', TMP);
  check('draft: two blocks -> the last (corrected) one wins, no block left in the reply', twice.draft?.id === 'tmp.money-migration' && !twice.error && !twice.reply.includes('```'), JSON.stringify(twice).slice(0, 200));
  checkIf(projectReady, 'draft: project mode takes a reverse-DNS id', () => parseDraftReply(block(PROJECT), { mode: 'project' }).draft?.id === 'com.example.money');
  checkIf(projectReady, 'draft: project mode refuses a tmp. id', () => !!parseDraftReply(block(MANIFEST), { mode: 'project' }).error);
  checkIf(lookReady, 'draft: a look another enabled lens draws is refused', () => !!parseDraftReply(block(MANIFEST), { mode: 'temporary', taken: [{ glyph: 'brackets', line: 'comb' }] }).error);
  const none = parseDraftReply('Which features does it touch?', TMP);
  check('draft: no block -> just the reply', !none.draft && !none.error && none.reply === 'Which features does it touch?');

  // ------------------------------------------------------------------ routes
  const pr = repo('prod'), store = path.join(pr, '.ai/lens-scan');
  fs.mkdirSync(store, { recursive: true });
  const lensE = (id: string, source: string, scan?: object, extra: object = {}) => ({ id, version: '1.0.0', source, enabled: true, ...extra, manifest: { id, ...(scan ? { scan } : {}) } });
  // 201 more features: one more than a selection may name
  const many = Array.from({ length: 201 }, (_, i) => 'f' + i);
  const map = { $schema: 'app-structure/3', version: 3, project: { slug: 'prod', name: 'Prod' }, features: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }, ...many.map((s) => ({ slug: s, name: s }))],
    lenses: [lensE('development', 'builtin'), lensE('com.x.plain', 'project'), lensE('com.x.off', 'project', { method: 'judgement', instructions: 'x' }, { enabled: false }),
      lensE('com.x.exec', 'project'), lensE('com.x.settled', 'project')],
    facets: { a: { 'tmp.gone': { values: { n: 1 } } } }, extensions: { 'com.x.keep': { k: 1 } } };
  fs.writeFileSync(path.join(store, 'app-structure.json'), JSON.stringify(map, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  const w = new DatabaseSync(path.join(store, 'scan.db'));
  w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
  const T = '2026-10-13T10:00:00Z';
  w.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r0', ?, ?, 'measure', 'done', '[]')").run(T, T);
  const prop = w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES (?, 'r0', 'a', 'development', 't', 'fix', ?, ?, ?)");
  for (const [id, s] of [['p1', 'proposed'], ['p2', 'approved'], ['p3', 'done']]) prop.run(id, s, T, T);
  // a lens backlog: 55 proposed (created in reverse id order, so the store's created_at order is checked), 1 approved,
  // 1 declined and 1 done; and a lens whose findings are all settled
  const lprop = w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES (?, 'r0', 'a', ?, 't', 'fix', ?, ?, ?)");
  const at = (i: number) => new Date(Date.parse(T) + i * 1000).toISOString();
  for (let i = 0; i < 55; i++) lprop.run('x' + String(54 - i).padStart(2, '0'), 'com.x.exec', 'proposed', at(i), at(i));
  lprop.run('xa', 'com.x.exec', 'approved', at(60), at(60));
  lprop.run('xd', 'com.x.exec', 'declined', at(61), at(61));
  lprop.run('xe', 'com.x.exec', 'done', at(62), at(62));
  lprop.run('s1', 'com.x.settled', 'done', T, T);
  w.close();
  fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'prod', name: 'Prod', root: pr }] }));
  process.chdir(dir);
  const route = async (rel: string) => import(pathToFileURL(path.join(ROOT, 'apps/web/src/app/api', rel)).href);
  const H = { host: 'localhost:3000', 'content-type': 'application/json' };
  const call = async (fn: (req: Request, ctx: unknown) => Promise<Response>, url: string, method: string, params: object, body?: unknown) => {
    const res = await fn(new Request('http://localhost:3000' + url, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve(params) });
    return { status: res.status, body: await res.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const scans = await route('products/[slug]/scans/route.ts');
  const room = { kind: 'room', id: 'r1', label: 'Room', features: ['a'] };
  const s202 = await call(scans.POST, '/api/products/prod/scans', 'POST', { slug: 'prod' }, { lens: 'development', scope: room });
  check('POST scans -> 202 job', s202.status === 202 && s202.body.kind === 'measure' && s202.body.lens === 'development', JSON.stringify(s202));
  const codes = await Promise.all([
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'nope', scope: room }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'com.x.off', scope: room }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'com.x.plain', scope: room }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: { ...room, features: ['zz'] } }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: { kind: 'all', label: 'All', features: ['a'] } }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: { ...room, kind: 'galaxy' } }),
    call(scans.POST, '/x', 'POST', { slug: 'nope' }, { lens: 'development', scope: room }),
  ]);
  check('POST scans refusals: unknown, disabled, no method, foreign feature, all+features, bad kind, unknown product',
    codes.map((c) => c.status + ':' + (c.body.error ?? '')).join() === '400:unknown-lens,400:unknown-lens,400:no-scan-method,400:bad-scope,400:bad-scope,400:bad-scope,404:unknown product nope',
    codes.map((c) => c.status + ':' + c.body.error).join());
  const sel = (features: string[], extra: object = {}) => ({ kind: 'selection', label: 'Selection (' + features.length + ')', features, ...extra });
  const s202sel = await call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: sel(['b', 'a']) });
  check('POST scans selection -> 202, no id, the features kept', s202sel.status === 202 && s202sel.body.scope.kind === 'selection' && s202sel.body.scope.id === undefined && s202sel.body.scope.features.join() === 'b,a', JSON.stringify(s202sel.body));
  check('selection: the prompt scopes exactly those features', await until(() => /^stdin \/lens-scan measure --lens development --scope b,a$/m.test(job('prod', s202sel.body.id)?.log_tail ?? '')), job('prod', s202sel.body.id)?.log_tail);
  const s200 = await call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: sel(many.slice(0, 200)) });
  check('selection of 200 features -> 202', s200.status === 202 && s200.body.scope.features.length === 200, String(s200.status));
  const selBad = await Promise.all([
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: sel([]) }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: sel(many) }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: sel(['a', 'zz']) }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: sel(['a'], { id: 'a' }) }),
    call(scans.POST, '/x', 'POST', { slug: 'prod' }, { lens: 'development', scope: sel(['a'], { label: ' ' }) }),
  ]);
  check('selection refusals: empty, 201 features, an unknown slug, an id, no label -> 400 bad-scope',
    selBad.map((c) => c.status + ':' + c.body.error).join() === Array(5).fill('400:bad-scope').join(), selBad.map((c) => c.status + ':' + c.body.error).join());
  const g = await call(scans.GET, '/x', 'GET', { slug: 'prod' });
  check('GET scans lists the job', g.status === 200 && g.body.some((j: ScanJob) => j.id === s202.body.id));
  const del = await route('products/[slug]/scans/[job]/route.ts');
  const d404 = await call(del.DELETE, '/x', 'DELETE', { slug: 'prod', job: 'j-nope' });
  check('DELETE an unknown job -> 404', d404.status === 404);
  await until(() => J.list('prod').every((j) => j.status !== 'running' && j.status !== 'queued'));

  const disp = await route('products/[slug]/dispatch/route.ts');
  const d = await call(disp.POST, '/x', 'POST', { slug: 'prod' }, { ids: ['p1', 'p2', 'p3', 'px'] });
  check('dispatch -> 202, p1 approved, one execute job over p1+p2, p3/px skipped', d.status === 202 && d.body.approved.join() === 'p1' && d.body.job.kind === 'execute'
    && d.body.job.proposals.join() === 'p1,p2' && JSON.stringify(d.body.skipped) === '[{"id":"p3","status":"done"},{"id":"px","status":"unknown"}]', JSON.stringify(d.body));
  const db = new DatabaseSync(path.join(store, 'scan.db'), { readOnly: true });
  const p1 = db.prepare("SELECT status, decided_by FROM proposals WHERE id = 'p1'").get() as { status: string; decided_by: string };
  db.close();
  check('dispatch approved p1 through the store (decided_by blueprint)', p1.status === 'approved' && p1.decided_by === 'blueprint', JSON.stringify(p1));
  check('the execute prompt names the proposals', await until(() => /^stdin \/lens-scan execute --proposals p1,p2$/m.test(job('prod', d.body.job.id)?.log_tail ?? '')), job('prod', d.body.job.id)?.log_tail);
  const d409 = await call(disp.POST, '/x', 'POST', { slug: 'prod' }, { ids: ['p3'] });
  check('dispatch with nothing buildable -> 409 with skipped', d409.status === 409 && d409.body.skipped[0]?.status === 'done', JSON.stringify(d409.body));
  check('dispatch bad body -> 400', (await call(disp.POST, '/x', 'POST', { slug: 'prod' }, { ids: [] })).status === 400 && (await call(disp.POST, '/x', 'POST', { slug: 'prod' }, { ids: ['a b'] })).status === 400);

  const exe = await route('products/[slug]/lenses/[id]/execute/route.ts');
  const ex = await call(exe.POST, '/x', 'POST', { slug: 'prod', id: 'com.x.exec' }, {});
  const exJobs: ScanJob[] = ex.body.jobs ?? [];
  const order = Array.from({ length: 55 }, (_, i) => 'x' + String(54 - i).padStart(2, '0')).concat('xa');
  check('execute a lens -> 202, 2 jobs of 50 and 6 in store order, 55 approved, declined/done skipped', ex.status === 202 && exJobs.length === 2
    && exJobs[0].proposals?.join() === order.slice(0, 50).join() && exJobs[1].proposals?.join() === order.slice(50).join()
    && ex.body.approved.length === 55 && !ex.body.approved.includes('xa') && JSON.stringify(ex.body.skipped) === '[{"id":"xd","status":"declined"},{"id":"xe","status":"done"}]',
  JSON.stringify(ex.body).slice(0, 400));
  const dbx = new DatabaseSync(path.join(store, 'scan.db'), { readOnly: true });
  const exRows = dbx.prepare("SELECT status, decided_by FROM proposals WHERE lens = 'com.x.exec' AND id LIKE 'x__'").all() as { status: string; decided_by: string }[];
  dbx.close();
  check('execute approved them through the store (decided_by blueprint)', exRows.length === 55 && exRows.every((r) => r.status === 'approved' && r.decided_by === 'blueprint'), JSON.stringify(exRows.slice(0, 2)));
  check('the execute jobs name their batch on stdin', await until(() => exJobs.length === 2 && exJobs.every((j) => (job('prod', j.id)?.log_tail ?? '').includes('stdin /lens-scan execute --proposals ' + j.proposals!.join(',')))), exJobs.map((j) => job('prod', j.id)?.log_tail).join(' | ').slice(0, 300));
  const exCodes = await Promise.all([
    call(exe.POST, '/x', 'POST', { slug: 'prod', id: 'com.x.settled' }, {}),
    call(exe.POST, '/x', 'POST', { slug: 'prod', id: 'com.x.nope' }, {}),
    call(exe.POST, '/x', 'POST', { slug: 'prod', id: 'com.x.off' }, {}),
    call(exe.POST, '/x', 'POST', { slug: 'nope', id: 'com.x.exec' }, {}),
  ]);
  check('execute refusals: all settled 409 (skipped), unknown 400, disabled 400, unknown product 404',
    exCodes.map((c) => c.status + ':' + c.body.error).join() === '409:nothing to execute,400:unknown-lens,400:unknown-lens,404:unknown product nope' && exCodes[0].body.skipped[0]?.status === 'done',
    exCodes.map((c) => c.status + ':' + c.body.error).join());
  await until(() => J.list('prod').every((j) => j.status !== 'running' && j.status !== 'queued'));

  const lenses = await route('products/[slug]/lenses/route.ts'), one = await route('products/[slug]/lenses/[id]/route.ts');
  const mapFile = path.join(store, 'app-structure.json');
  const l201 = await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: MANIFEST });
  const after = fs.readFileSync(mapFile, 'utf8'), mAfter = JSON.parse(after);
  check('POST lenses -> 201 temporary entry', l201.status === 201 && l201.body.temporary === true && l201.body.source === 'project' && l201.body.enabled === true && typeof l201.body.created_at === 'string', JSON.stringify(l201.body).slice(0, 200));
  check('the map keeps key order, unknown keys, facets and CRLF', Object.keys(mAfter).join() === Object.keys(map).join() && mAfter.extensions['com.x.keep'].k === 1 && mAfter.facets.a['tmp.gone'].values.n === 1 && after.includes('\r\n') && mAfter.lenses.at(-1).id === 'tmp.money-migration');
  check('POST the same id -> 409', (await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: MANIFEST })).status === 409);
  const l400 = await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: { ...MANIFEST, id: 'tmp.xx', presentation: { glyph: 'star', line: 'comb' } } });
  check('POST a bad manifest -> 400 with why', l400.status === 400 && /glyph/.test(l400.body.error), JSON.stringify(l400.body));
  const lt = await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: { ...MANIFEST, id: 'tmp.flagged', presentation: { glyph: 'pulse', line: 'dotted' } }, temporary: true });
  check('POST lenses temporary: true -> 201 temporary entry', lt.status === 201 && lt.body.temporary === true, JSON.stringify(lt.body).slice(0, 200));
  const lDup = await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: { ...MANIFEST, id: 'tmp.copycat' } });
  checkIf(lookReady, 'POST a lens repeating an enabled lens\'s glyph+line -> 400', () => lDup.status === 400 && !!lDup.body.error, () => JSON.stringify(lDup.body));
  if (lDup.status === 201) await call(one.DELETE, '/x', 'DELETE', { slug: 'prod', id: 'tmp.copycat' }); // the stub let it in
  const lp = await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: PROJECT });
  checkIf(projectReady, 'POST a project lens -> 201 permanent entry (source project, created_at, no temporary)', () => lp.status === 201 && lp.body.id === 'com.example.money' && lp.body.source === 'project'
    && lp.body.enabled === true && typeof lp.body.created_at === 'string' && !('temporary' in lp.body), () => JSON.stringify(lp.body).slice(0, 200));
  const lp409 = await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: PROJECT });
  checkIf(projectReady, 'POST the same project id -> 409', () => lp409.status === 409, () => JSON.stringify(lp409));
  const badDns = await Promise.all([
    call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: { ...PROJECT, id: 'money' } }),
    call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: { ...PROJECT, id: 'com.money' } }),
    call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: { ...PROJECT, id: 'Com.Example.Money' } }),
    call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: PROJECT, temporary: 'yes' }),
  ]);
  check('POST a project lens without a reverse-DNS id -> 400; temporary not a boolean -> 400', badDns.every((c) => c.status === 400 && !!c.body.error), badDns.map((c) => c.status + ':' + c.body.error).join(' | '));
  check('POST the id of a built-in or project lens -> 409', (await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: { ...MANIFEST, id: 'tmp.flagged', presentation: { glyph: 'check', line: 'double' } } })).status === 409);
  const pa = await call(one.PATCH, '/x', 'PATCH', { slug: 'prod', id: 'tmp.money-migration' }, { enabled: false });
  check('PATCH enabled false -> 200 retired', pa.status === 200 && pa.body.enabled === false && JSON.parse(fs.readFileSync(mapFile, 'utf8')).lenses.find((e: { id: string }) => e.id === 'tmp.money-migration').enabled === false);
  check('PATCH a built-in lens -> 403', (await call(one.PATCH, '/x', 'PATCH', { slug: 'prod', id: 'development' }, { enabled: false })).status === 403);
  check('PATCH a bad body -> 400', (await call(one.PATCH, '/x', 'PATCH', { slug: 'prod', id: 'tmp.money-migration' }, { enabled: 'no' })).status === 400);
  const pp = await call(one.PATCH, '/x', 'PATCH', { slug: 'prod', id: 'com.x.plain' }, { enabled: false });
  const pp2 = await call(one.PATCH, '/x', 'PATCH', { slug: 'prod', id: 'com.x.plain' }, { enabled: true });
  check('PATCH a permanent project lens -> 200 (retire, restore)', pp.status === 200 && pp.body.enabled === false && pp2.status === 200 && pp2.body.enabled === true, JSON.stringify([pp, pp2]));
  check('DELETE a built-in lens -> 403', (await call(one.DELETE, '/x', 'DELETE', { slug: 'prod', id: 'development' })).status === 403);
  const dp = await call(one.DELETE, '/x', 'DELETE', { slug: 'prod', id: 'com.x.plain' });
  check('DELETE a permanent project lens -> 200, entry gone', dp.status === 200 && !JSON.parse(fs.readFileSync(mapFile, 'utf8')).lenses.some((e: { id: string }) => e.id === 'com.x.plain'), JSON.stringify(dp));
  const dl = await call(one.DELETE, '/x', 'DELETE', { slug: 'prod', id: 'tmp.money-migration' });
  const m3 = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  check('DELETE a temporary lens -> 200, entry gone, facets kept', dl.status === 200 && dl.body.id === 'tmp.money-migration' && !m3.lenses.some((e: { id: string }) => e.id === 'tmp.money-migration') && m3.facets.a['tmp.gone'].values.n === 1);
  check('DELETE an unknown lens -> 404', (await call(one.DELETE, '/x', 'DELETE', { slug: 'prod', id: 'tmp.none' })).status === 404);
  fs.writeFileSync(mapFile, '{ broken');
  check('a map that does not parse -> 409, left as it is', (await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: MANIFEST })).status === 409 && fs.readFileSync(mapFile, 'utf8') === '{ broken');

  // the onboarding chat over the fake (json mode): first turn carries the contract, later turns resume
  const draft = await route('lens-draft/route.ts');
  const t1 = await call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'a lens for the money migration' });
  check('lens-draft first turn: question, session, `/lens-scan onboard --draft-only` sent, project by default', t1.status === 200 && t1.body.done === false && t1.body.session === 'abcdef12-3456-7890' && /onboard:yes kind:project resume:none/.test(t1.body.reply), JSON.stringify(t1.body));
  const t2 = await call(draft.POST, '/x', 'POST', {}, { product: 'prod', message: 'DRAFT-VALID please', session: t1.body.session });
  check('lens-draft resume: the message alone, --resume', t2.status === 200 && /onboard:no kind:project resume:abcdef12-3456-7890/.test(t2.body.reply) && !t2.body.reply.includes('```'), JSON.stringify(t2.body).slice(0, 300));
  checkIf(projectReady, 'lens-draft resume: a valid project block -> done with the draft', () => t2.body.done === true && t2.body.draft?.id === 'com.example.money', () => JSON.stringify(t2.body).slice(0, 300));
  const tt = await call(draft.POST, '/x', 'POST', {}, { product: 'prod', message: 'DRAFT-VALID', kind: 'temporary' });
  check('lens-draft kind temporary: `--temporary` sent, a tmp. draft -> done', tt.status === 200 && tt.body.done === true && tt.body.draft?.id === 'tmp.money-migration' && /onboard:yes kind:temporary resume:none/.test(tt.body.reply), JSON.stringify(tt.body).slice(0, 300));
  const t3 = await call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'DRAFT-INVALID', session: t1.body.session });
  check('lens-draft: invalid block -> done false with error', t3.status === 200 && t3.body.done === false && !t3.body.draft && !!t3.body.error, JSON.stringify(t3.body));
  const t4 = await call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'TEMPORARY DRAFT-INVALID', session: t1.body.session, kind: 'temporary' });
  check('lens-draft: an invalid temporary block -> error says why', t4.status === 200 && t4.body.done === false && /tmp\.<kebab>/.test(t4.body.error ?? ''), JSON.stringify(t4.body));
  const bads = await Promise.all([
    call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: '' }),
    call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'x'.repeat(4001) }),
    call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'hi', session: 'abc; calc' }),
    call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'hi', kind: 'forever' }),
    call(draft.POST, '/x', 'POST', {}, { product: 'nope', message: 'hi' }),
  ]);
  check('lens-draft refusals: empty, too long, bad session, bad kind, unknown product', bads.map((b) => b.status).join() === '400,400,400,400,404', bads.map((b) => b.status).join());
  process.env.BP_CLAUDE_BIN = 'bp-no-such-cli-' + process.pid;
  const t503 = await call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'hi' });
  check('lens-draft without the CLI -> 503', t503.status === 503 && t503.body.error === J.CLI_MISSING, JSON.stringify(t503));
  process.env.BP_CLAUDE_BIN = FAKE;

  // ------------------------------------------------------------------ the release train: triage, releases, release jobs
  // A product `rel` with a v2 store: pack k-dev-1 (a1, a2 done, a3 failed). Triage and release-create run lens-scan's own
  // store.mjs (BP_LENS_SCAN_DIR or ~/.claude/skills/lens-scan; SKIP and seed by SQL when it is not installed); gh is a fake
  // (BP_GH_BIN), signed in or out by FAKE_GH_OUT.
  {
    const RS = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/release.server.ts')).href) as typeof import('../packages/core/src/server/release.server.ts');
    const W = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/train/wire.ts')).href) as typeof import('../packages/core/src/train/wire.ts');
    const show = (what: string, x: unknown) => { if (process.env.BP_SHOW_EXAMPLES) console.log('EXAMPLE ' + what + '\n' + JSON.stringify(x, null, 1)); };
    const { jobLabel } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/jobs.ts')).href) as typeof import('../packages/core/src/scan/jobs.ts');
    const ghFake = path.join(dir, 'fake-gh.mjs');
    fs.writeFileSync(ghFake, "if (process.env.FAKE_GH_OUT === '1') { console.error('You are not logged into any GitHub hosts.'); process.exit(1); }\n"
      + "if (process.argv[2] === 'api') console.log('octocat');\nprocess.exit(0);\n");
    process.env.BP_GH_BIN = ghFake;
    delete (globalThis as { __bpGhBy?: unknown }).__bpGhBy;
    const rr = repo('rel'), rstore = path.join(rr, '.ai/lens-scan'), rdb = path.join(rstore, 'scan.db');
    fs.mkdirSync(rstore, { recursive: true });
    fs.writeFileSync(path.join(rr, 'package.json'), JSON.stringify({ name: 'rel', version: '2.3.0' }));
    const sw = new DatabaseSync(rdb);
    sw.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
    sw.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r0', ?, ?, 'execute', 'done', '[\"development\"]')").run(T, T);
    sw.prepare("INSERT INTO packs (id, lens, n, branch, base_ref, base_sha, run_id, status, created_at, updated_at) VALUES ('k-dev-1', 'development', 1, 'pack/dev-1', 'main', ?, 'r0', 'open', ?, ?)").run('a'.repeat(40), T, T);
    const ip = sw.prepare("INSERT INTO proposals (id, run_id, feature, lens, metric, title, kind, status, created_at, updated_at, pack_id, commit_sha) VALUES (?, 'r0', 'a', 'development', 'cov', ?, 'fix', ?, ?, ?, 'k-dev-1', ?)");
    for (const [id, st] of [['a1', 'done'], ['a2', 'done'], ['a3', 'failed']]) ip.run(id, 'item ' + id, st, at(Number(id[1])), at(Number(id[1])), id.repeat(20));
    sw.close();
    fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'prod', name: 'Prod', root: pr }, { slug: 'rel', name: 'Rel', root: rr }] }));
    const status = (table: string, id: string) => { const d = new DatabaseSync(rdb, { readOnly: true }); try { return (d.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id) as { status?: string } | undefined)?.status; } finally { d.close(); } };
    const relRow = (id: string) => { const d = new DatabaseSync(rdb, { readOnly: true }); try { return d.prepare('SELECT * FROM releases WHERE id = ?').get(id) as Record<string, string> | undefined; } finally { d.close(); } };

    const tri = await route('products/[slug]/triage/route.ts'), rels = await route('products/[slug]/releases/route.ts');
    const sug = await route('products/[slug]/releases/suggest/route.ts');
    const build = await route('products/[slug]/releases/[id]/build/route.ts'), fin = await route('products/[slug]/releases/[id]/finish/route.ts');
    const hasStoreMjs = RS.storeScript() !== null;
    const triBad = await Promise.all([
      call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a b'], decision: 'accept' }),
      call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a1'], decision: 'ship' }),
      call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: Array.from({ length: 201 }, (_, i) => 'p' + i), decision: 'accept' }),
      call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: [], decision: 'accept' }),
      call(tri.POST, '/x', 'POST', { slug: 'nope' }, { ids: ['a1'], decision: 'accept' }),
    ]);
    check('triage refusals: unsafe id, bad decision, 201 ids, none, unknown product', triBad.map((b) => b.status).join() === '400,400,400,400,404', triBad.map((b) => b.status).join());
    check('triage 400 names the four decisions', /'accept' \| 'rework' \| 'descope' \| 'reopen'/.test(triBad[1].body.error ?? ''), triBad[1].body.error);
    if (hasStoreMjs) {
      const t1 = await call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a1', 'a2'], decision: 'accept' });
      check('triage accept -> 200 through store.mjs, by user:<gh login>', t1.status === 200 && t1.body.triaged.join() === 'a1,a2' && t1.body.by === 'user:octocat' && t1.body.decision === 'accepted', JSON.stringify(t1.body));
      const t2 = await call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a3'], decision: 'accept' });
      check('triage accept of a failed item without a note -> 409, skipped note-required', t2.status === 409 && t2.body.skipped[0]?.reason === 'note-required', JSON.stringify(t2.body));
      const t3 = await call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a3'], decision: 'descope', note: 'not worth it' });
      check('triage descope -> 200, the pack settles open -> triaged', t3.status === 200 && t3.body.packs_triaged.join() === 'k-dev-1' && status('packs', 'k-dev-1') === 'triaged', JSON.stringify(t3.body));
      // the undo: each item back to the status it left, the pack open again; a second undo has nothing to go back to
      const t4 = await call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a3', 'a1'], decision: 'reopen' });
      show('POST /api/products/rel/triage {"ids":["a3","a1"],"decision":"reopen"} -> ' + t4.status, t4.body);
      const p4 = W.parseTriageResult(t4.body);
      check('triage reopen -> 200 reopened, a3 failed and a1 done again, the pack open', t4.status === 200 && p4.ok && p4.value.decision === 'reopened' && p4.value.triaged.join() === 'a3,a1'
        && status('proposals', 'a3') === 'failed' && status('proposals', 'a1') === 'done' && status('packs', 'k-dev-1') === 'open', JSON.stringify(t4.body) + (p4.ok ? '' : ' ' + p4.error));
      const t5 = await call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a1'], decision: 'reopen' });
      check('triage reopen of an untriaged item -> 409, skipped with its status', t5.status === 409 && t5.body.skipped[0]?.status === 'done' && t5.body.triaged.length === 0, JSON.stringify(t5.body));
      const t6 = await call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a1'], decision: 'accept' });
      const t7 = await call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a3'], decision: 'descope', note: 'not worth it' });
      check('triage after the undo: a1 accepted, a3 descoped, the pack triaged again', t6.status === 200 && t7.status === 200 && status('packs', 'k-dev-1') === 'triaged', JSON.stringify([t6.body, t7.body]));
    } else {
      skipped++; console.log('SKIP triage and release-create through store.mjs (lens-scan not installed; set BP_LENS_SCAN_DIR)');
      const d = new DatabaseSync(rdb);
      d.exec("UPDATE proposals SET status = 'accepted' WHERE id IN ('a1', 'a2'); UPDATE proposals SET status = 'descoped' WHERE id = 'a3'; UPDATE packs SET status = 'triaged'");
      d.close();
    }
    const sg = await call(sug.GET, '/x', 'GET', { slug: 'rel' });
    show('GET /api/products/rel/releases/suggest -> ' + sg.status, sg.body);
    check('suggest with no v* tag -> the manifest version as it stands', sg.status === 200 && sg.body.version === '2.3.0' && sg.body.from === 'package.json', JSON.stringify(sg.body));
    // the parser door on the REAL answer: check-train-wire.ts holds the same validators against samples hand-copied
    // from these bodies, which cannot notice the route drifting away from the copy. Here the answer itself is parsed.
    const pSug = W.parseVersionSuggestion(sg.body);
    check('the parser door takes the suggest answer', pSug.ok && pSug.value.version === '2.3.0' && pSug.value.from === 'package.json', pSug.ok ? '' : pSug.error);
    check('POST releases bad version -> 400', (await call(rels.POST, '/x', 'POST', { slug: 'rel' }, { version: 'v2.3.0' })).status === 400);
    check('POST releases with no accepted item among the ids -> 409', (await call(rels.POST, '/x', 'POST', { slug: 'rel' }, { version: '2.3.0', ids: ['a3'] })).status === 409);
    if (hasStoreMjs) {
      const c1 = await call(rels.POST, '/x', 'POST', { slug: 'rel' }, { version: '2.3.0' });
      show('POST /api/products/rel/releases {"version":"2.3.0"} -> ' + c1.status, c1.body);
      check('POST releases -> 201, a draft with every accepted item', c1.status === 201 && c1.body.release.id === 'rel-2.3.0' && c1.body.release.status === 'draft' && c1.body.release.created_by === 'user:octocat'
        && c1.body.added.join() === 'a1,a2' && c1.body.release.items.map((p: Proposal) => p.id).join() === 'a1,a2', JSON.stringify(c1.body).slice(0, 400));
      const pRel = W.parseReleaseCreated(c1.body);
      check('the parser door takes the releases answer', pRel.ok && pRel.value.release.items.length === 2 && pRel.value.added.join() === 'a1,a2', pRel.ok ? '' : pRel.error);
      const c2 = await call(rels.POST, '/x', 'POST', { slug: 'rel' }, { version: '2.3.1', ids: ['a1'] });
      check('POST releases of items already in one -> 409', c2.status === 409, JSON.stringify(c2.body));
    } else {
      const d = new DatabaseSync(rdb);
      d.prepare("INSERT INTO releases (id, version, branch, status, created_by, created_at, updated_at) VALUES ('rel-2.3.0', '2.3.0', 'release/2.3.0', 'draft', 'user:octocat', ?, ?)").run(T, T);
      d.exec("UPDATE proposals SET release_id = 'rel-2.3.0' WHERE id IN ('a1', 'a2')");
      d.close();
    }
    const sg2 = await call(sug.GET, '/x', 'GET', { slug: 'rel' });
    check('suggest passes over a version that has a release', sg2.body.version === '2.3.1', JSON.stringify(sg2.body));

    process.env.FAKE_GH_OUT = '1';
    const b412 = await call(build.POST, '/x', 'POST', { slug: 'rel', id: 'rel-2.3.0' }, {});
    check('build with gh signed out -> 412 gh not authenticated', b412.status === 412 && b412.body.error === 'gh not authenticated', JSON.stringify(b412));
    delete process.env.FAKE_GH_OUT;
    const bBad = await Promise.all([
      call(build.POST, '/x', 'POST', { slug: 'rel', id: 'rel-2.3.0;calc' }, {}),
      call(build.POST, '/x', 'POST', { slug: 'rel', id: 'rel-9.9.9' }, {}),
      call(fin.POST, '/x', 'POST', { slug: 'rel', id: 'rel-2.3.0' }, {}),
    ]);
    check('build/finish refusals: bad id 400, unknown release 404, finish of a draft 409', bBad.map((b) => b.status).join() === '400,404,409', bBad.map((b) => b.status + ':' + b.body.error).join());
    const b1 = await call(build.POST, '/x', 'POST', { slug: 'rel', id: 'rel-2.3.0' }, {});
    show('POST /api/products/rel/releases/rel-2.3.0/build -> ' + b1.status, b1.body);
    check('build -> 202 release job (kind release, step build)', b1.status === 202 && b1.body.kind === 'release' && b1.body.release === 'rel-2.3.0' && b1.body.version === '2.3.0' && b1.body.step === 'build', JSON.stringify(b1.body));
    check('a release job reads "Release 2.3.0 · build"', jobLabel(b1.body) === 'Release 2.3.0 · build', jobLabel(b1.body));
    const pJob = W.parseScanJob(b1.body);
    check('the parser door takes the release-job answer', pJob.ok && pJob.value.kind === 'release' && pJob.value.step === 'build' && pJob.value.release === 'rel-2.3.0', pJob.ok ? '' : pJob.error);
    const again = await call(build.POST, '/x', 'POST', { slug: 'rel', id: 'rel-2.3.0' }, {});
    check('a second build while one is queued or running -> 409', again.status === 409, JSON.stringify(again));
    check('build: the job ends done once the release is pr-open', await until(() => job('rel', b1.body.id)?.status === 'done' || job('rel', b1.body.id)?.status === 'failed'), JSON.stringify(job('rel', b1.body.id)));
    const jb = job('rel', b1.body.id);
    check('build: done, the release pr-open with its url, run_id = the release-head measure run (bp-job note)', jb?.status === 'done' && relRow('rel-2.3.0')?.status === 'pr-open' && !!relRow('rel-2.3.0')?.pr_url && jb.run_id === 'run-' + jb.id, JSON.stringify(jb));
    check('build: the prompt is /lens-scan release --id rel-2.3.0 on stdin', /^stdin \/lens-scan release --id rel-2\.3\.0$/m.test(jb?.log_tail ?? ''), jb?.log_tail);
    check('build of a pr-open release -> 409', (await call(build.POST, '/x', 'POST', { slug: 'rel', id: 'rel-2.3.0' }, {})).status === 409);
    if (hasStoreMjs) {
      const t8 = await call(tri.POST, '/x', 'POST', { slug: 'rel' }, { ids: ['a1'], decision: 'reopen' });
      show('POST /api/products/rel/triage {"ids":["a1"],"decision":"reopen"} (release pr-open) -> ' + t8.status, t8.body);
      check('triage reopen of an item whose release left draft -> 409 in-release', t8.status === 409 && t8.body.skipped[0]?.reason === 'in-release' && status('proposals', 'a1') === 'accepted', JSON.stringify(t8.body));
    }
    const f1 = await call(fin.POST, '/x', 'POST', { slug: 'rel', id: 'rel-2.3.0' }, {});
    check('finish -> 202 (step finish)', f1.status === 202 && f1.body.step === 'finish' && jobLabel(f1.body) === 'Release 2.3.0 · finish', JSON.stringify(f1.body));
    const pFin = W.parseScanJob(f1.body);
    check('the parser door takes the finish-job answer', pFin.ok && pFin.value.step === 'finish', pFin.ok ? '' : pFin.error);
    await until(() => job('rel', f1.body.id)?.status === 'done' || job('rel', f1.body.id)?.status === 'failed');
    const jf2 = job('rel', f1.body.id);
    check('finish: done with no run, the release tagged v2.3.0', jf2?.status === 'done' && jf2.run_id === undefined && relRow('rel-2.3.0')?.status === 'tagged' && relRow('rel-2.3.0')?.tag === 'v2.3.0', JSON.stringify(jf2));
    check('finish: the accepted items released, the pack closed', status('proposals', 'a1') === 'released' && status('proposals', 'a2') === 'released' && status('packs', 'k-dev-1') === 'closed', [status('proposals', 'a1'), status('packs', 'k-dev-1')].join());

    // a cut that fails its gates, an unknown release, a bad id: the registry directly
    const d = new DatabaseSync(rdb);
    d.prepare("INSERT INTO releases (id, version, branch, status, created_at, updated_at) VALUES ('rel-3.0.0-fail', '3.0.0-fail', 'release/3.0.0-fail', 'draft', ?, ?)").run(T, T);
    d.close();
    const e1 = J.enqueueRelease('rel', rr, 'rel-3.0.0-fail', '3.0.0-fail', 'build'), e2 = J.enqueueRelease('rel', rr, 'rel-9.9.9', '9.9.9', 'build');
    await until(() => [e1, e2].every((e) => e.ok && ['done', 'failed'].includes(job('rel', e.job.id)?.status ?? '')));
    const je1 = e1.ok ? job('rel', e1.job.id) : undefined, je2 = e2.ok ? job('rel', e2.job.id) : undefined;
    check('a cut whose gate fails -> failed with lens-scan\'s line, its measure run still attached', je1?.status === 'failed' && je1.error === 'lens-scan release failed: gate npm test: 1 failing' && je1.run_id === 'run-' + je1.id && relRow('rel-3.0.0-fail')?.status === 'failed', JSON.stringify(je1));
    check('an unknown release -> failed with the refusal', je2?.status === 'failed' && /^lens-scan refused:/.test(je2.error ?? ''), JSON.stringify(je2));
    const e3 = J.enqueueRelease('rel', rr, 'rel-1.0.0', '1.0.1', 'build'), e4 = J.enqueueRelease('rel', rr, 'release-1', '1', 'finish');
    check('enqueueRelease refuses an id that is not rel-<version> -> 400', !e3.ok && e3.status === 400 && !e4.ok && e4.status === 400);

    // the commits route: rr becomes a git repo with three commits; two are item commits (g1: a text and a binary file;
    // g2: 2100 lines, so the patch is cut), the third is in the repo but no item's
    const git = (...a: string[]) => { const r = spawnSync('git', ['-c', 'user.name=bp-check', '-c', 'user.email=bp-check@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { cwd: rr, encoding: 'utf8' });
      if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr); return r.stdout.trim(); };
    git('init', '-q');
    fs.mkdirSync(path.join(rr, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rr, 'src/x.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
    fs.writeFileSync(path.join(rr, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0, 3]));
    git('add', 'src/x.ts', 'logo.png'); git('commit', '-q', '-m', 'feat: x and a logo', '-m', 'Lens-Item: g1');
    const g1 = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(rr, 'src/big.ts'), Array.from({ length: 2100 }, (_, i) => 'export const v' + i + ' = ' + i + ';').join('\n') + '\n');
    git('add', 'src/big.ts'); git('commit', '-q', '-m', 'feat: a big file');
    const g2 = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(rr, 'src/x.ts'), 'export const a = 9;\n');
    git('add', 'src/x.ts'); git('commit', '-q', '-m', 'chore: not an item');
    const g3 = git('rev-parse', 'HEAD');
    const gd = new DatabaseSync(rdb);
    const gi = gd.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at, commit_sha) VALUES (?, 'r0', 'a', 'development', 't', 'fix', 'declined', ?, ?, ?)");
    gi.run('g1', T, T, g1); gi.run('g2', T, T, g2);
    gd.close();
    const commits = await route('products/[slug]/commits/[sha]/route.ts');
    const getCommit = (sha: string) => commits.GET(new Request('http://localhost:3000/x', { headers: { host: 'localhost:3000' } }), { params: Promise.resolve({ slug: 'rel', sha }) }) as Promise<Response>;
    const r1 = await getCommit(g1.slice(0, 7)), c1 = await r1.json(), d1 = W.parseCommitDiff(c1);
    show('GET /api/products/rel/commits/' + g1.slice(0, 7) + ' -> ' + r1.status + ' cache-control: ' + r1.headers.get('cache-control'), c1);
    const png = d1.ok ? d1.value.files.find((f) => f.path === 'logo.png') : undefined, xts = d1.ok ? d1.value.files.find((f) => f.path === 'src/x.ts') : undefined;
    check('commits: a 7-char prefix of an item commit -> 200, the full sha, message, stat, files (binary 0/0), cached an hour',
      r1.status === 200 && d1.ok && d1.value.sha === g1 && d1.value.message.startsWith('feat: x and a logo') && d1.value.message.includes('Lens-Item: g1')
      && /src\/x\.ts/.test(d1.value.stat) && /2 files changed/.test(d1.value.stat) && png?.add === 0 && png.del === 0 && xts?.add === 3 && xts.del === 0
      && !d1.value.truncated && d1.value.lines > 0 && d1.value.patch.includes('+export const b = 2;') && r1.headers.get('cache-control') === 'private, max-age=3600',
      JSON.stringify(c1).slice(0, 600) + (d1.ok ? '' : ' ' + d1.error));
    const r2 = await getCommit(g2), c2 = await r2.json(), d2 = W.parseCommitDiff(c2);
    check('commits: a patch over 2000 lines is cut at 2000, lines the full count', r2.status === 200 && d2.ok && d2.value.truncated && d2.value.lines > 2000 && d2.value.patch.split('\n').length === 2000
      && d2.value.files.length === 1 && d2.value.files[0].add === 2100, d2.ok ? JSON.stringify({ lines: d2.value.lines, truncated: d2.value.truncated, files: d2.value.files }) : d2.error);
    const misses = await Promise.all([getCommit('deadbeef'), getCommit(g3), getCommit(g3.slice(0, 10))]);
    check('commits: a sha that is no item commit -> 404, even one the repo has', misses.map((r) => r.status).join() === '404,404,404', misses.map((r) => r.status).join());
    const bads = await Promise.all([getCommit('abc123'), getCommit('xyz1234'), getCommit('a'.repeat(41)), getCommit(g1.slice(0, 7) + ';ls')]);
    check('commits: a bad sha -> 400 (short, not hex, too long, a shell char)', bads.map((r) => r.status).join() === '400,400,400,400', bads.map((r) => r.status).join());
    const unknown = await commits.GET(new Request('http://localhost:3000/x', { headers: { host: 'localhost:3000' } }), { params: Promise.resolve({ slug: 'nope', sha: g1 }) }) as Response;
    const remote = await commits.GET(new Request('http://evil.example/x', { headers: { host: 'evil.example' } }), { params: Promise.resolve({ slug: 'rel', sha: g1 }) }) as Response;
    check('commits: unknown product 404, a non-loopback Host 403', unknown.status === 404 && remote.status === 403, unknown.status + ',' + remote.status);
    delete process.env.BP_GH_BIN;
    delete (globalThis as { __bpGhBy?: unknown }).__bpGhBy;
  }

  // ------------------------------------------------------------------ jobProgress: `current` stays inside the job's scope
  {
    const { jobProgress } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/views.ts')).href) as typeof import('../packages/core/src/scan/views.ts');
    const row = (id: number, feature: string, kind: 'reading' | 'measured') => ({ id, run_id: 'pr1', at: T, feature, lens: 'development', kind, text: '' });
    const snap = (rows: ReturnType<typeof row>[]) => ({ runs: [{ id: 'pr1', note: 'bp-job:j1' }], measurements: [], activity: rows }) as unknown as import('../packages/core/src/scan/types.ts').ScanSnapshot;
    const pj = (scope: ScanScope) => ({ id: 'j1', kind: 'measure', lens: 'development', scope, run_id: 'pr1' }) as unknown as ScanJob;
    const inOnly: ScanScope = { kind: 'selection', label: 'Selection (1)', features: ['inside'] };
    const wide = [row(1, 'inside', 'reading'), row(2, 'OUTSIDE', 'reading')], outOnly = [row(1, 'OUTSIDE', 'reading')];
    const pAll = jobProgress(pj(ALL), snap(wide), 2), pWide = jobProgress(pj(inOnly), snap(wide), 2), pOut = jobProgress(pj(inOnly), snap(outOnly), 2);
    const pIn = jobProgress(pj(inOnly), snap([row(1, 'OUTSIDE', 'reading'), row(2, 'inside', 'reading')]), 2);
    // the control: the same rows under an unscoped job DO name OUTSIDE, so a scoped job staying off it is the guard, not an empty fixture
    check('jobProgress: an unscoped job names the latest reading (the fixture reads OUTSIDE)', pAll.current === 'OUTSIDE', String(pAll.current));
    check('jobProgress: a scoped job whose run also read outside its scope names a feature inside it', pWide.current === 'inside' && pWide.m === 1, String(pWide.current));
    check('jobProgress: a run that has only read outside the scope leaves `current` blank', pOut.current === undefined && pOut.n === 0, String(pOut.current));
    check('jobProgress: the latest in-scope reading wins over an earlier outside one', pIn.current === 'inside', String(pIn.current));
  }

  // ------------------------------------------------------------------ Kettle parity: the scan sim and the browser's lens store
  const clock = Date.parse(T); // frozen: the sim's jobs start and never step, so what is queued or running stays put
  const fprop = (id: string, lens: string, status: Proposal['status'], i: number): Proposal => ({ id, run_id: 'r0', feature: 'a', lens, title: 't', standard: 'none', kind: 'fix', status, created_at: at(i), updated_at: at(i) });
  const findings = [...Array.from({ length: 55 }, (_, i) => fprop('k' + String(54 - i).padStart(2, '0'), 'com.k.exec', 'proposed', i)), fprop('ka', 'com.k.exec', 'approved', 60), fprop('kd', 'com.k.exec', 'declined', 61), fprop('ks', 'com.k.settled', 'done', 62)];
  type Manifest = import('../packages/core/src/standard/types.ts').LensManifest;
  // the model's lenses, each with a look none of the lenses added below draws (but tmp.copy, which repeats tmp.known's)
  const km = (id: string, glyph: string, line: string) => ({ ...MANIFEST, id, presentation: { glyph, line } }) as unknown as Manifest;
  const known: Record<string, Manifest> = { 'com.k.exec': km('com.k.exec', 'bars', 'solid'), 'com.k.settled': km('com.k.settled', 'bars', 'double'),
    development: km('development', 'set-square', 'solid'), 'tmp.known': km('tmp.known', 'check', 'hatched') };
  const sim = new ScanSim({ now: () => clock, findings });
  sim.bind({ order: ['a', 'b', ...many], manifest: (l) => known[l], value: () => undefined,
    lenses: () => Object.entries(known).map(([id, manifest]) => ({ id, version: '1.0.0', source: 'project' as const, enabled: true, manifest })) });
  const simErr = (fn: () => unknown): string => { try { fn(); return 'ok'; } catch (e) { return (e as { status?: number }).status + ':' + (e as Error).message; } };
  try {
    const sj = sim.startScan('development', sel(['b', 'a']) as ScanScope);
    check('sim: a selection scan starts, features walked in layout order', sj.scope?.kind === 'selection' && sj.scope.features.join() === 'b,a' && sim.jobs().length === 1, JSON.stringify(sj));
    const simBad = [sel([]), sel(many), sel(['a', 'zz']), sel(['a'], { id: 'a' })].map((s) => simErr(() => sim.startScan('development', s as ScanScope)));
    check('sim: selection refusals: empty, 201, unknown slug, an id -> 400 bad-scope', simBad.every((x) => x === '400:bad-scope'), simBad.join());
    const se = sim.executeLens('com.k.exec');
    const korder = Array.from({ length: 55 }, (_, i) => 'k' + String(54 - i).padStart(2, '0')).concat('ka');
    check('sim: execute a lens -> 2 jobs of 50 and 6 in created_at order, 55 approved, declined skipped', se.jobs.length === 2 && se.jobs[0].proposals?.join() === korder.slice(0, 50).join()
      && se.jobs[1].proposals?.join() === korder.slice(50).join() && se.approved.length === 55 && JSON.stringify(se.skipped) === '[{"id":"kd","status":"declined"}]', JSON.stringify(se).slice(0, 300));
    // each running job has opened its first finding (executing); the rest wait approved
    check('sim: the approvals show in the snapshot (decided_by blueprint)', sim.snapshot().proposals.filter((p) => p.lens === 'com.k.exec' && (p.status === 'approved' || p.status === 'executing') && p.decided_by === 'blueprint').length === 55);
    let again: { status?: number; body?: { skipped?: { id: string; status: string }[] } } = {};
    try { sim.executeLens('com.k.exec'); } catch (e) { again = e as typeof again; }
    const sk = again.body?.skipped ?? [];
    check('sim: again while its jobs run -> 409, the waiting ones skipped as in-job', again.status === 409 && sk.length === 57 && sk.filter((x) => x.status === 'in-job').length === 54
      && sk.filter((x) => x.status === 'executing').length === 2, JSON.stringify(again.body).slice(0, 200));
    const simEx = [simErr(() => sim.executeLens('com.k.settled')), simErr(() => sim.executeLens('com.k.nope'))];
    check('sim: execute refusals: all settled 409, unknown lens 400', simEx.join() === '409:nothing to execute,400:unknown-lens', simEx.join());

    // addProjectLens's Kettle branch writes the browser's store (a Map stands in for localStorage)
    const ls = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); }, removeItem: (k: string) => { ls.delete(k); } };
    const A = await import(pathToFileURL(path.join(ROOT, 'apps/web/src/lib/scan/actions.ts')).href) as typeof import('../apps/web/src/lib/scan/actions.ts');
    const TL = await import(pathToFileURL(path.join(ROOT, 'apps/web/src/lib/scan/temp-lens.ts')).href) as typeof import('../apps/web/src/lib/scan/temp-lens.ts');
    const kctx = { slug: null, sim };
    const aErr = async (fn: () => Promise<unknown>): Promise<string> => { try { await fn(); return 'ok'; } catch (e) { return (e as { status?: number }).status + ':' + (e as Error).message; } };
    const kt = await A.addProjectLens(kctx, MANIFEST as unknown as Manifest, true);
    check('Kettle addProjectLens temporary -> a stored temporary entry', kt.temporary === true && kt.source === 'project' && TL.readTempLenses().some((e) => e.id === MANIFEST.id), JSON.stringify(kt).slice(0, 200));
    const kDup = await aErr(() => A.addProjectLens(kctx, MANIFEST as unknown as Manifest, true));
    const kKnown = await aErr(() => A.addProjectLens(kctx, { ...MANIFEST, id: 'tmp.known', presentation: { glyph: 'pulse', line: 'hatched' } } as unknown as Manifest, true));
    check('Kettle addProjectLens: a stored id or a model lens id -> 409', kDup.startsWith('409:') && kKnown.startsWith('409:'), kDup + ' | ' + kKnown);
    const kBad = await aErr(() => A.addProjectLens(kctx, { ...PROJECT, id: 'com.money' } as unknown as Manifest));
    check('Kettle addProjectLens: no reverse-DNS id -> 400', kBad.startsWith('400:'), kBad);
    const kLook = await aErr(() => A.addProjectLens(kctx, { ...MANIFEST, id: 'tmp.copy', presentation: { glyph: 'check', line: 'hatched' } } as unknown as Manifest, true));
    checkIf(lookReady, 'Kettle addProjectLens: a model lens\'s glyph+line -> 400', () => kLook.startsWith('400:'), () => kLook);
    const kp = await aErr(async () => { const e = await A.addProjectLens(kctx, PROJECT as unknown as Manifest); if (e.temporary !== undefined) throw new Error('temporary set'); });
    checkIf(projectReady, 'Kettle addProjectLens project -> a stored permanent entry (no temporary) the store reads back', () => kp === 'ok' && TL.readTempLenses().some((e) => e.id === PROJECT.id && e.temporary === undefined), () => kp);
    const ke = await A.executeLensBacklog(kctx, 'com.k.exec').catch((e: { status?: number }) => e.status);
    check('executeLensBacklog over the sim answers like the route (409 while its jobs run)', ke === 409, String(ke));
    const ks = await A.startSelectionScan(kctx, 'development', ['a']);
    check('startSelectionScan over the sim -> a selection job labelled "Selection (1)"', ks.scope?.kind === 'selection' && ks.scope.label === 'Selection (1)', JSON.stringify(ks.scope));
  } finally { sim.dispose(); delete (globalThis as { localStorage?: unknown }).localStorage; }

  // ------------------------------------------------------------------ the standard accepts the entry
  const valid = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/schema/schema/fixtures/valid-map.json'), 'utf8'));
  const entry = { id: MANIFEST.id, version: '1.0.0', source: 'project', enabled: true, temporary: true, created_at: '2026-10-13T10:00:00.000Z', manifest: MANIFEST };
  const vf = path.join(dir, 'tmp-lens-map.json'), wf = path.join(dir, 'tmp-lens-wrong.json');
  fs.writeFileSync(vf, JSON.stringify({ ...valid, lenses: [...valid.lenses, entry] }));
  fs.writeFileSync(wf, JSON.stringify({ ...valid, lenses: [...valid.lenses, { ...entry, id: 'com.x.money', manifest: { ...MANIFEST, id: 'com.x.money' } }] }));
  const v1 = spawnSync(process.execPath, [path.join(ROOT, 'scripts/validate-structure.mjs'), vf], { encoding: 'utf8' });
  check('validate-structure accepts a temporary entry with a scan block', v1.status === 0, (v1.stdout + v1.stderr).slice(-600));
  const v2 = spawnSync(process.execPath, [path.join(ROOT, 'scripts/validate-structure.mjs'), wf], { encoding: 'utf8' });
  check('validate-structure refuses a temporary entry without a tmp. id', v2.status === 1, (v2.stdout + v2.stderr).slice(-400));
} finally {
  process.chdir(os.tmpdir());
  for (const slug of ['cap', 'fail', 'cancel', 'attach', 'prod', 'rel']) for (const j of J.list(slug)) J.cancel(slug, j.id);
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
}
const skips = skipped ? `, ${skipped} skipped` : '';
console.log(failed ? `check-scan-jobs: ${failed} failed, ${passed} passed${skips}` : `check-scan-jobs: ${passed} checks passed${skips}`);
process.exit(failed ? 1 : 0);
