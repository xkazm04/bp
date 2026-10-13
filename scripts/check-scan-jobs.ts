// Checks the scan-job backend (docs/blueprint-ui.md, "Scan jobs") against a fake Claude Code CLI
// (scripts/fixtures/fake-claude.mjs; BP_CLAUDE_BIN points at it, the real `claude` never runs):
//   - the registry: 3 running per product and the 4th queued until one exits; done / failed (exit code, last stderr
//     line, log file, log_tail); exit 0 without a store run = failed with lens-scan's refusal line; cancel of a queued
//     and of a running job (its process is gone); the queue cap (429); a missing CLI;
//   - the prompt goes on stdin, never in argv; an unsafe lens id or feature is refused before anything spawns;
//   - attachRun by note (`bp-job:<id>` and `bp-job:<id> <more>`, never a bare prefix), and subscribe;
//   - the lens-draft parser (a valid block, an invalid one, none) and the onboarding chat route over the fake;
//   - the routes: scans (202 / unknown-lens / no-scan-method / bad-scope), dispatch (approve + one execute job, 409),
//     lenses (201 / 409 / PATCH / 403 / DELETE, the map's key order and facets kept), and a map carrying the new
//     temporary entry passes validate-structure while a temporary entry with a reverse-DNS id does not.
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

const J = await import(pathToFileURL(path.join(ROOT, 'src/lib/scan/jobs.server.ts')).href) as typeof import('../src/lib/scan/jobs.server.ts');
const { parseDraftReply } = await import(pathToFileURL(path.join(ROOT, 'src/lib/scan/lens-draft.ts')).href) as typeof import('../src/lib/scan/lens-draft.ts');
const { scopeFeatures } = await import(pathToFileURL(path.join(ROOT, 'src/lib/scan/scope.ts')).href) as typeof import('../src/lib/scan/scope.ts');
type ScanJob = import('../src/lib/scan/jobs.ts').ScanJob;
type ScanScope = import('../src/lib/scan/jobs.ts').ScanScope;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 10000): Promise<boolean> { const t = Date.now() + ms; while (Date.now() < t) { if (pred()) return true; await sleep(50); } return pred(); }
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
  const ok = parseDraftReply(block(MANIFEST));
  check('draft: a valid block -> draft, reply without the block', !!ok.draft && ok.draft.id === 'tmp.money-migration' && !ok.error && ok.reply === 'Here it is.\n\nSay if it fits.', JSON.stringify(ok).slice(0, 200));
  const badId = parseDraftReply(block({ ...MANIFEST, id: 'com.x.money' }));
  check('draft: invalid manifest -> error says why', !badId.draft && /tmp\.<kebab>/.test(badId.error ?? ''), badId.error);
  const noScan = parseDraftReply(block({ ...MANIFEST, scan: undefined }));
  check('draft: no scan block -> error', !noScan.draft && /scan/.test(noScan.error ?? ''), noScan.error);
  const strField = parseDraftReply(block({ ...MANIFEST, fields: [{ key: 'oldMoneySites', label: 'x', type: 'string', metric: { better: 'down', method: 'judgement' } }] }));
  check('draft: a metric on a non-numeric field -> error', !strField.draft && /not numeric/.test(strField.error ?? ''), strField.error);
  const notJson = parseDraftReply('Here.\n```lens-manifest\n{ nope\n```');
  check('draft: a block that is not JSON -> error', !notJson.draft && /not valid JSON/.test(notJson.error ?? ''), notJson.error);
  const none = parseDraftReply('Which features does it touch?');
  check('draft: no block -> just the reply', !none.draft && !none.error && none.reply === 'Which features does it touch?');

  // ------------------------------------------------------------------ routes
  const pr = repo('prod'), store = path.join(pr, '.ai/lens-scan');
  fs.mkdirSync(store, { recursive: true });
  const lensE = (id: string, source: string, scan?: object, extra: object = {}) => ({ id, version: '1.0.0', source, enabled: true, ...extra, manifest: { id, ...(scan ? { scan } : {}) } });
  const map = { $schema: 'app-structure/3', version: 3, project: { slug: 'prod', name: 'Prod' }, features: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }],
    lenses: [lensE('development', 'builtin'), lensE('com.x.plain', 'project'), lensE('com.x.off', 'project', { method: 'judgement', instructions: 'x' }, { enabled: false })],
    facets: { a: { 'tmp.gone': { values: { n: 1 } } } }, extensions: { 'com.x.keep': { k: 1 } } };
  fs.writeFileSync(path.join(store, 'app-structure.json'), JSON.stringify(map, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  const w = new DatabaseSync(path.join(store, 'scan.db'));
  w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
  const T = '2026-10-13T10:00:00Z';
  w.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r0', ?, ?, 'measure', 'done', '[]')").run(T, T);
  const prop = w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES (?, 'r0', 'a', 'development', 't', 'fix', ?, ?, ?)");
  for (const [id, s] of [['p1', 'proposed'], ['p2', 'approved'], ['p3', 'done']]) prop.run(id, s, T, T);
  w.close();
  fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'prod', name: 'Prod', root: pr }] }));
  process.chdir(dir);
  const route = async (rel: string) => import(pathToFileURL(path.join(ROOT, 'src/app/api', rel)).href);
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

  const lenses = await route('products/[slug]/lenses/route.ts'), one = await route('products/[slug]/lenses/[id]/route.ts');
  const mapFile = path.join(store, 'app-structure.json');
  const l201 = await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: MANIFEST });
  const after = fs.readFileSync(mapFile, 'utf8'), mAfter = JSON.parse(after);
  check('POST lenses -> 201 temporary entry', l201.status === 201 && l201.body.temporary === true && l201.body.source === 'project' && l201.body.enabled === true && typeof l201.body.created_at === 'string', JSON.stringify(l201.body).slice(0, 200));
  check('the map keeps key order, unknown keys, facets and CRLF', Object.keys(mAfter).join() === Object.keys(map).join() && mAfter.extensions['com.x.keep'].k === 1 && mAfter.facets.a['tmp.gone'].values.n === 1 && after.includes('\r\n') && mAfter.lenses.at(-1).id === 'tmp.money-migration');
  check('POST the same id -> 409', (await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: MANIFEST })).status === 409);
  const l400 = await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: { ...MANIFEST, id: 'tmp.xx', presentation: { glyph: 'star', line: 'comb' } } });
  check('POST a bad manifest -> 400 with why', l400.status === 400 && /glyph/.test(l400.body.error), JSON.stringify(l400.body));
  const pa = await call(one.PATCH, '/x', 'PATCH', { slug: 'prod', id: 'tmp.money-migration' }, { enabled: false });
  check('PATCH enabled false -> 200 retired', pa.status === 200 && pa.body.enabled === false && JSON.parse(fs.readFileSync(mapFile, 'utf8')).lenses.at(-1).enabled === false);
  check('PATCH a permanent lens -> 403', (await call(one.PATCH, '/x', 'PATCH', { slug: 'prod', id: 'development' }, { enabled: false })).status === 403);
  check('PATCH a bad body -> 400', (await call(one.PATCH, '/x', 'PATCH', { slug: 'prod', id: 'tmp.money-migration' }, { enabled: 'no' })).status === 400);
  check('DELETE a permanent lens -> 403', (await call(one.DELETE, '/x', 'DELETE', { slug: 'prod', id: 'com.x.plain' })).status === 403);
  const dl = await call(one.DELETE, '/x', 'DELETE', { slug: 'prod', id: 'tmp.money-migration' });
  const m3 = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  check('DELETE a temporary lens -> 200, entry gone, facets kept', dl.status === 200 && dl.body.id === 'tmp.money-migration' && !m3.lenses.some((e: { id: string }) => e.id === 'tmp.money-migration') && m3.facets.a['tmp.gone'].values.n === 1);
  check('DELETE an unknown lens -> 404', (await call(one.DELETE, '/x', 'DELETE', { slug: 'prod', id: 'tmp.none' })).status === 404);
  fs.writeFileSync(mapFile, '{ broken');
  check('a map that does not parse -> 409, left as it is', (await call(lenses.POST, '/x', 'POST', { slug: 'prod' }, { manifest: MANIFEST })).status === 409 && fs.readFileSync(mapFile, 'utf8') === '{ broken');

  // the onboarding chat over the fake (json mode): first turn carries the contract, later turns resume
  const draft = await route('lens-draft/route.ts');
  const t1 = await call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'a lens for the money migration' });
  check('lens-draft first turn: question, session, contract sent', t1.status === 200 && t1.body.done === false && t1.body.session === 'abcdef12-3456-7890' && /contract:yes resume:none/.test(t1.body.reply), JSON.stringify(t1.body));
  const t2 = await call(draft.POST, '/x', 'POST', {}, { product: 'prod', message: 'DRAFT-VALID please', session: t1.body.session });
  check('lens-draft resume: valid block -> done with draft, no contract, --resume', t2.status === 200 && t2.body.done === true && t2.body.draft?.id === 'tmp.money-migration' && /contract:no resume:abcdef12-3456-7890/.test(t2.body.reply) && !t2.body.reply.includes('```'), JSON.stringify(t2.body).slice(0, 300));
  const t3 = await call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'DRAFT-INVALID', session: t1.body.session });
  check('lens-draft: invalid block -> done false with error', t3.status === 200 && t3.body.done === false && /tmp\.<kebab>/.test(t3.body.error ?? ''), JSON.stringify(t3.body));
  const bads = await Promise.all([
    call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: '' }),
    call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'x'.repeat(4001) }),
    call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'hi', session: 'abc; calc' }),
    call(draft.POST, '/x', 'POST', {}, { product: 'nope', message: 'hi' }),
  ]);
  check('lens-draft refusals: empty, too long, bad session, unknown product', bads.map((b) => b.status).join() === '400,400,400,404', bads.map((b) => b.status).join());
  process.env.BP_CLAUDE_BIN = 'bp-no-such-cli-' + process.pid;
  const t503 = await call(draft.POST, '/x', 'POST', {}, { product: 'kettle', message: 'hi' });
  check('lens-draft without the CLI -> 503', t503.status === 503 && t503.body.error === J.CLI_MISSING, JSON.stringify(t503));
  process.env.BP_CLAUDE_BIN = FAKE;

  // ------------------------------------------------------------------ the standard accepts the entry
  const valid = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/standard/schema/fixtures/valid-map.json'), 'utf8'));
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
  for (const slug of ['cap', 'fail', 'cancel', 'attach', 'prod']) for (const j of J.list(slug)) J.cancel(slug, j.id);
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
}
console.log(failed ? `check-scan-jobs: ${failed} failed, ${passed} passed` : `check-scan-jobs: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
