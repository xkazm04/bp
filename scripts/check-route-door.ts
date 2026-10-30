// Checks the route door (packages/core/src/server/route-door.server.ts): one admission order for the migrated API routes,
// guard -> json -> product -> params -> body -> kettle -> store -> live, with the guard derived from the verb.
//   1 every migrated write verb: Host evil.example -> 403; a body verb with Content-Type text/plain -> 415; an unknown slug
//     with a body that is not JSON -> 404 (product before body); a known product + a body that is not JSON -> 400 "body must
//     be JSON"; a store verb on a product without a store + a valid body -> 404 "no scan store for <slug>"
//   2 a scan.db of garbage bytes: GET scan, GET releases/suggest and GET commits/<sha> each -> 503 "cannot read the scan store: ..."
//   3 Kettle with no sim hosted: every Kettle-declared verb -> 405 (unknownProduct's body); after hostKettle(stub) the stub
//     answers through simAnswer at the verb's status, a stub refusal { status 409, body } -> 409 with that body; a verb that
//     declares no Kettle still answers 405 with the sim hosted
//   4 check-route-guards accepts the door form (`return <door>.VERB(req, ctx);`) on the migrated routes and its seeded
//     controls bite: a statement before the return, a door verb other than the handler's, a raw handler without localOnly
//   5 mount parity: each migrated file exports the same methods as before the migration (scripts/lib/mounts.ts)
//   6 the door registry (DOORS): >= 10 routes, every exported method of the migrated files has a row, and each row's guard is
//     derived from its verb (GET -> localHost, others -> localOnly; json only where a body is declared)
// Run: node scripts/check-route-door.ts  (Node's type stripping). Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { exportedMethods } from './lib/mounts.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'packages/core/src/server/api');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

type Spec = { file: string; verb: string; params: Record<string, string>; body?: unknown; store?: boolean; kettle?: unknown; kettleStatus?: number };
// The migrated verbs, with a body each accepts past the door's stages (the live handler may still refuse it).
const SPECS: Spec[] = [
  { file: 'products/[slug]/scan', verb: 'GET', params: {}, kettle: { snap: 1 } },
  { file: 'products/[slug]/scans', verb: 'GET', params: {}, kettle: [{ job: 1 }] },
  { file: 'products/[slug]/scans', verb: 'POST', params: {}, body: { lens: 'development', scope: { kind: 'all', label: 'All', features: [] } }, kettle: { started: 1 }, kettleStatus: 202 },
  { file: 'products/[slug]/scans/[job]', verb: 'DELETE', params: { job: 'j1' }, kettle: { cancelled: 'j1' } },
  { file: 'products/[slug]/waves', verb: 'GET', params: {}, kettle: { waves: [{ w: 1 }] } },
  { file: 'products/[slug]/waves', verb: 'POST', params: {}, body: { name: 'W', packages: [] }, store: true, kettle: { wave: { w: 'new' } }, kettleStatus: 201 },
  { file: 'products/[slug]/waves/[wave]', verb: 'PATCH', params: { wave: 'w1' }, body: { name: 'W2' }, store: true, kettle: { wave: { w: 'patched' } } },
  { file: 'products/[slug]/waves/[wave]', verb: 'DELETE', params: { wave: 'w1' }, store: true, kettle: { id: 'w1' } },
  { file: 'products/[slug]/waves/[wave]/dispatch', verb: 'POST', params: { wave: 'w1' }, body: {}, store: true, kettle: { dispatched: 1 }, kettleStatus: 202 },
  { file: 'products/[slug]/proposals/[id]', verb: 'POST', params: { id: 'p1' }, body: { decision: 'approve' }, store: true },
  { file: 'products/[slug]/proposals/[id]/veto', verb: 'POST', params: { id: 'p1' }, body: { reason: 'not this one' }, store: true },
  { file: 'products/[slug]/triage', verb: 'POST', params: {}, body: { ids: ['p1'], decision: 'accept' }, store: true },
  { file: 'products/[slug]/releases/suggest', verb: 'GET', params: {} },
  { file: 'products/[slug]/commits/[sha]', verb: 'GET', params: { sha: 'abcdef1' }, store: true },
  { file: 'products/[slug]/dispatch', verb: 'POST', params: {}, body: { ids: ['p1'] }, store: true, kettle: { job: { id: 'j1' }, approved: ['p1'], skipped: [] }, kettleStatus: 202 },
  { file: 'products/[slug]/lenses', verb: 'POST', params: {}, body: { manifest: { id: 'com.example.x' } } },
  { file: 'products/[slug]/lenses/[id]', verb: 'PATCH', params: { id: 'com.example.x' }, body: { enabled: false } },
  { file: 'products/[slug]/lenses/[id]', verb: 'DELETE', params: { id: 'com.example.x' } },
  { file: 'products/[slug]/lenses/[id]/execute', verb: 'POST', params: { id: 'development' }, body: {} },
  { file: 'products/[slug]/releases', verb: 'POST', params: {}, body: { version: '1.0.0' }, store: true },
  { file: 'products/[slug]/releases/[id]/finish', verb: 'POST', params: { id: 'rel-1.0.0' }, body: {}, store: true },
];
const FILES = [...new Set(SPECS.map((s) => s.file))];
// what each file exported before the migration (5: mount parity)
const BEFORE: Record<string, string[]> = Object.fromEntries(FILES.map((f) => [f, SPECS.filter((s) => s.file === f).map((s) => s.verb)]));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-route-door-'));
const mk = (slug: string, store: 'sql' | 'garbage' | 'none') => {
  const root = path.join(dir, slug), sd = path.join(root, '.ai/lens-scan');
  fs.mkdirSync(sd, { recursive: true });
  if (store === 'sql') { const db = new DatabaseSync(path.join(sd, 'scan.db')); db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8')); db.close(); }
  if (store === 'garbage') fs.writeFileSync(path.join(sd, 'scan.db'), Buffer.from('this is not a sqlite database, only garbage bytes '.repeat(200)));
  return { slug, name: slug, root };
};
fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [mk('live', 'sql'), mk('bare', 'none'), mk('junk', 'garbage')] }));
const cwd = process.cwd();
process.chdir(dir);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mods = new Map<string, any>();
for (const f of FILES) mods.set(f, await import(pathToFileURL(path.join(API, f, 'route.ts')).href));
const LOCAL = { host: 'localhost:3000', 'content-type': 'application/json' };
const call = async (s: Spec, slug: string, o: { headers?: Record<string, string>; raw?: string; body?: unknown } = {}) => {
  const fn = mods.get(s.file)[s.verb] as (req: Request, ctx: unknown) => Promise<Response>;
  const text = o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : s.body !== undefined ? JSON.stringify(s.body) : undefined);
  const res = await fn(new Request('http://localhost:3000/x', { method: s.verb, headers: o.headers ?? LOCAL, ...(text === undefined || s.verb === 'GET' ? {} : { body: text }) }), { params: Promise.resolve({ slug, ...s.params }) });
  let body: unknown = null; try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body: body as Record<string, unknown> | null };
};
const name = (s: Spec) => `${s.verb} ${s.file}`;
const show = (r: unknown) => JSON.stringify(r).slice(0, 200);

// 1 the write verbs' order
for (const s of SPECS.filter((x) => x.verb !== 'GET')) {
  const evil = await call(s, 'live', { headers: { host: 'evil.example', 'content-type': 'application/json' } });
  check(`1 ${name(s)}: Host evil.example -> 403`, evil.status === 403, show(evil));
  if (s.body === undefined) continue;
  const plain = await call(s, 'live', { headers: { host: 'localhost:3000', 'content-type': 'text/plain' } });
  check(`1 ${name(s)}: text/plain -> 415`, plain.status === 415, show(plain));
  const unknown = await call(s, 'nope', { raw: 'not json{' });
  check(`1 ${name(s)}: unknown slug + not JSON -> 404 (product before body)`, unknown.status === 404 && unknown.body?.error === 'unknown product nope', show(unknown));
  const notJson = await call(s, 'live', { raw: 'not json{' });
  check(`1 ${name(s)}: known product + not JSON -> 400 body must be JSON`, notJson.status === 400 && notJson.body?.error === 'body must be JSON', show(notJson));
}
for (const s of SPECS.filter((x) => x.store)) { // a store verb, read or write
  const r = await call(s, 'bare');
  check(`1 ${name(s)}: no store + a valid body -> 404 no scan store for bare`, r.status === 404 && r.body?.error === 'no scan store for bare', show(r));
}
for (const s of SPECS.filter((x) => x.verb === 'GET')) {
  const evil = await call(s, 'live', { headers: { host: 'evil.example' } });
  check(`1 ${name(s)}: Host evil.example -> 403`, evil.status === 403, show(evil));
}

// 2 an unreadable store is 503 on every read route
for (const s of SPECS.filter((x) => ['products/[slug]/scan', 'products/[slug]/releases/suggest', 'products/[slug]/commits/[sha]'].includes(x.file))) {
  const r = await call(s, 'junk');
  check(`2 ${name(s)}: garbage scan.db -> 503 cannot read the scan store`, r.status === 503 && String(r.body?.error).startsWith('cannot read the scan store: '), show(r));
}

// 3 Kettle: 405 without a sim, the stub's answers with one
const KETTLE = SPECS.filter((s) => s.kettle !== undefined);
for (const s of KETTLE) {
  const r = await call(s, 'kettle');
  check(`3 ${name(s)}: kettle, no sim hosted -> 405`, r.status === 405 && String(r.body?.error).startsWith('kettle is the built-in sample'), show(r));
}
const ans = (file: string, verb: string) => SPECS.find((s) => s.file === file && s.verb === verb)!.kettle;
let refuse = false;
/** The stub method for one verb: its pinned answer (`pick` takes the part the route wraps itself), or the refusal. */
const answer = (file: string, verb: string, pick?: string) => () => {
  if (refuse) throw Object.assign(new Error('refused'), { status: 409, body: { error: 'stub refusal', skipped: [{ id: 'p1', status: 'in-job' }] } });
  const v = ans(file, verb) as Record<string, unknown>;
  return pick ? v[pick] : v;
};
const stub = {
  snapshot: answer('products/[slug]/scan', 'GET'), jobs: answer('products/[slug]/scans', 'GET'), startScan: answer('products/[slug]/scans', 'POST'),
  cancel: answer('products/[slug]/scans/[job]', 'DELETE'), listWaves: answer('products/[slug]/waves', 'GET', 'waves'),
  createWave: answer('products/[slug]/waves', 'POST', 'wave'), updateWave: answer('products/[slug]/waves/[wave]', 'PATCH', 'wave'),
  deleteWave: answer('products/[slug]/waves/[wave]', 'DELETE'), dispatchWave: answer('products/[slug]/waves/[wave]/dispatch', 'POST'),
  dispatch: answer('products/[slug]/dispatch', 'POST'),
};
const { hostKettle } = await import('@bp/core/server/kettle-sim.server') as typeof import('../packages/core/src/server/kettle-sim.server.ts');
hostKettle({ scan: stub, swarm: {} } as unknown as Parameters<typeof hostKettle>[0]);
for (const s of KETTLE) {
  const r = await call(s, 'kettle');
  check(`3 ${name(s)}: kettle, sim hosted -> the stub's answer at ${s.kettleStatus ?? 200}`, r.status === (s.kettleStatus ?? 200) && JSON.stringify(r.body) === JSON.stringify(s.kettle), show(r));
}
refuse = true;
for (const s of KETTLE) {
  const r = await call(s, 'kettle');
  check(`3 ${name(s)}: a stub refusal -> 409 with its body`, r.status === 409 && r.body?.error === 'stub refusal' && Array.isArray(r.body?.skipped), show(r));
}
refuse = false;
for (const s of SPECS.filter((x) => x.kettle === undefined)) {
  const r = await call(s, 'kettle');
  check(`3 ${name(s)}: no Kettle verb -> 405 with the sim hosted`, r.status === 405, show(r));
}
process.chdir(cwd);

// 4 check-route-guards: the door form passes, its seeded controls fail
const guards = (mut: unknown[] = []) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-route-guards.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, BP_ROUTE_GUARDS_MUTATE: JSON.stringify(mut) } });
const clean = guards();
const doors = Number(/(\d+) door handlers/.exec(clean.stdout)?.[1] ?? 0);
check('4 check-route-guards passes with the migrated routes in door form', clean.status === 0, (clean.stdout + clean.stderr).slice(-400));
check('4 check-route-guards counts >= 13 door handlers', doors >= SPECS.length, `counted ${doors}`);
const red = (what: string, mut: unknown[]) => { const r = guards(mut); check(`4 control: ${what} fails the gate`, r.status === 1, (r.stdout + r.stderr).slice(-300)); };
red('a statement before the door return', [['products/[slug]/scan/route.ts', 'return scan.GET(req, ctx);', 'const t0 = Date.now(); return scan.GET(req, ctx);']]);
red('a write verb answered by the door\'s read verb', [['products/[slug]/scans/route.ts', 'return scans.POST(req, ctx);', 'return scans.GET(req, ctx);']]);
red('a raw handler without localOnly', [['products/route.ts', 'localOnly(req)', 'null']]);

// 5 mount parity
for (const f of FILES) {
  const got = exportedMethods(fs.readFileSync(path.join(API, f, 'route.ts'), 'utf8'));
  check(`5 ${f}: exports ${BEFORE[f].join(',')}`, got.join(',') === BEFORE[f].join(','), got.join(','));
}

// 6 the registry
let DOORS: { route: string; verb: string; guard: string; json: boolean; store: boolean; kettle: boolean }[] = [];
try { ({ DOORS } = await import('@bp/core/server/route-door.server') as { DOORS: typeof DOORS }); } catch (e) { check('6 route-door.server.ts loads', false, (e as Error).message); }
const routes = new Set(DOORS.map((d) => d.route));
check('6 the registry holds >= 10 routes', routes.size >= 10, `${routes.size}: ${[...routes].join(' ')}`);
for (const s of SPECS) {
  const d = DOORS.find((x) => x.route === s.file && x.verb === s.verb);
  check(`6 ${name(s)}: a door row`, !!d);
  if (!d) continue;
  check(`6 ${name(s)}: guard derived from the verb`, d.guard === (s.verb === 'GET' ? 'localHost' : 'localOnly') && d.json === (s.body !== undefined) && d.store === !!s.store && d.kettle === (s.kettle !== undefined), JSON.stringify(d));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`check-route-door: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
