// The companion's tool door (spark companion-upgrade, P3), end to end: apps/server on a free port in a temp working
// directory (its own bp.products.local.json) with a temp BP_HOME, and apps/mcp/bp-mcp.mjs spawned against it over stdio.
// Two registered products: `good` (a lens-scan store built from docs/standard/lens-scan-store.sql, a map, a waves file) and
// `bad` (a scan.db of garbage bytes). Kettle's sims (hosted by apps/server) carry the wave and card walk. It proves:
//   mcp       initialize echoes the protocolVersion and names the server bp; tools/list is the catalog by wire name, its
//             schemas, and ' [needs the person]' exactly on the GATED ones
//   auto      an AUTO call hits its route (wave_compose makes a Kettle wave; focus_show is on GET focus); an HTTP error is
//             isError with bp's error
//   gated     a GATED call (wave_dispatch) files a pending card and never hits its route (no execute job for the wave)
//   human     approving without the human token is 403 and runs nothing; with it, the route runs and the card is done;
//             a second answer is 409; human-token without (or with only one of) the Sec-Fetch headers is 403
//   policy    POST /policies without the token is 403; a grant for wave.dispatch on kettle makes the next GATED call run at
//             once with decidedBy 'policy' and the grant's id; policy.propose and AUTO tools cannot be granted; minTier,
//             product, expiry and policy.propose are honoured by policyFor (in process)
//   gaps      the formula (base x tier weight) on every reason and tier, and GET gaps on `good` answers exactly the
//             expected ranked list
//   inbox     two products, `bad` named in skipped with why; `good`'s open and triage items ranked tier, value, age
//   doc       tech-stack.md section 4 is the catalog (name, flags, class)
// Run: node scripts/check-companion-door.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const { TOOLS, classOf, wireName } = await import('../packages/core/src/companion/catalog.ts');
const rank = await import('../packages/core/src/server/api/companion/rank.ts');

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const j = (x: unknown) => JSON.stringify(x)?.slice(0, 400) ?? String(x);

// ------------------------------------------------------------------------------------------------ fixtures
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-check-companion-door-'));
const HOME = path.join(tmp, 'home'), HOME2 = path.join(tmp, 'home-inproc');
const NOW = Date.now(), H = 3600000, iso = (ms: number) => new Date(ms).toISOString();
function product(slug: string): string {
  const root = path.join(tmp, slug);
  fs.mkdirSync(path.join(root, '.ai', 'lens-scan', 'work'), { recursive: true });
  return root;
}
const good = product('good'), bad = product('bad');
fs.writeFileSync(path.join(tmp, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'good', name: 'Good', root: good }, { slug: 'bad', name: 'Bad', root: bad }] }));
fs.writeFileSync(path.join(bad, '.ai', 'lens-scan', 'scan.db'), 'this is not a sqlite database, only garbage bytes '.repeat(200));
fs.writeFileSync(path.join(good, '.ai', 'lens-scan', 'app-structure.json'), JSON.stringify({
  $schema: 'app-structure/3', version: 3,
  features: [{ slug: 'a', name: 'A', priority: 'P2' }, { slug: 'b', name: 'B' }, { slug: 'c', name: 'C' }],
  lenses: [{ id: 'dev', enabled: true }, { id: 'sec', enabled: true }, { id: 'off', enabled: false }],
}));
{
  const db = new DatabaseSync(path.join(good, '.ai', 'lens-scan', 'scan.db'));
  db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
  db.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r1', ?, ?, 'measure', 'done', '[\"dev\",\"sec\"]')").run(iso(NOW - 72 * H), iso(NOW - 72 * H));
  const p = db.prepare('INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, size, risk, tier, created_at, updated_at) VALUES (?, \'r1\', ?, \'dev\', ?, \'fix\', ?, ?, ?, ?, ?, ?)');
  // value = 0.5 x (11 - risk)/10 / size weight (no metric: gain 0.5)
  p.run('p1', 'b', 'Tier 0 open', 'proposed', 'S', 5, 0, iso(NOW - 48 * H), iso(NOW - 48 * H));   // 0.15
  p.run('p2', 'a', 'Untiered open', 'proposed', 'M', 5, null, iso(NOW - 120 * H), iso(NOW - 120 * H));
  p.run('p3', 'c', 'Built, to triage', 'done', 'M', 5, 2, iso(NOW - 96 * H), iso(NOW - 1 * H));
  p.run('p4', 'a', 'Tier 1 open, cheap', 'proposed', 'XS', 1, 1, iso(NOW - 2 * H), iso(NOW - 2 * H)); // 0.5
  p.run('p5', 'a', 'Accepted already', 'accepted', 'M', 5, 0, iso(NOW - 10 * H), iso(NOW - 10 * H));
  p.run('p6', 'b', 'Tier 1 open, dear', 'proposed', 'XL', 9, 1, iso(NOW - 200 * H), iso(NOW - 200 * H)); // 0.0125
  const m = db.prepare("INSERT INTO measurements (run_id, feature, lens, metric, value, measured_at) VALUES ('r1', ?, ?, 'm', 1, ?)");
  m.run('a', 'dev', iso(NOW - 1 * H));  // fresh
  m.run('b', 'dev', iso(NOW - 48 * H)); // stale
  m.run('c', 'off', iso(NOW - 1 * H));  // a disabled lens: no gap either way
  const c = db.prepare("INSERT INTO coverage (feature, standard, state, judged_at) VALUES (?, ?, ?, ?)");
  c.run('a', 'std/x', 'unknown', iso(NOW - 5 * H));
  c.run('c', 'std/y', 'deviation', iso(NOW - 5 * H));
  c.run('b', 'std/z', 'conformant', iso(NOW - 5 * H));
  db.close();
}
fs.writeFileSync(path.join(good, '.ai', 'lens-scan', 'work', 'bp-waves.json'), JSON.stringify({ version: 1, waves: [
  { id: 'w-t0', name: 'T0', status: 'draft', created_at: iso(NOW), packages: [{ id: 'pk-1', name: 'One', model: 'sonnet', effort: 'low', ids: ['p1'] }] },
  { id: 'w-t2', name: 'T2', status: 'draft', created_at: iso(NOW), packages: [{ id: 'pk-1', name: 'One', model: 'sonnet', effort: 'low', ids: ['p2', 'p3'] }] },
] }));

// ------------------------------------------------------------------------------------------------ the server
const server = spawn(process.execPath, ['--import', pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href, path.join(ROOT, 'apps/server/src/main.ts'), '--port', '0'],
  { cwd: tmp, env: { ...process.env, BP_HOME: HOME }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let out = '';
server.stdout!.on('data', (d) => (out += d));
server.stderr!.on('data', (d) => (out += d));
const port: number = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(0), 30000);
  const look = () => { const x = /listening on http:\/\/[^:]+:(\d+)/.exec(out); if (x) { clearTimeout(t); resolve(Number(x[1])); } };
  server.stdout!.on('data', look);
  server.on('exit', () => { clearTimeout(t); resolve(0); });
});
type Res = { status: number; json: any; raw: string; headers: http.IncomingHttpHeaders };
const req = (method: string, p: string, headers: Record<string, string> = {}, body?: unknown): Promise<Res> => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `localhost:${port}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
    let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { let json; try { json = JSON.parse(s); } catch { /* raw */ } resolve({ status: res.statusCode ?? 0, json, raw: s, headers: res.headers }); });
  });
  r.on('error', (e) => resolve({ status: 0, json: undefined, raw: e.message, headers: {} }));
  if (body !== undefined) r.write(JSON.stringify(body));
  r.end();
});

// ------------------------------------------------------------------------------------------------ the MCP client
let mcp: ChildProcess | null = null;
const waiting = new Map<number, (m: any) => void>();
let nextId = 1;
const rpc = (method: string, params?: unknown): Promise<any> => new Promise((resolve) => {
  const id = nextId++;
  const t = setTimeout(() => { waiting.delete(id); resolve({ error: { message: 'timeout' } }); }, 60000);
  waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
  mcp!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }) + '\n');
});
const call = async (name: string, args: unknown) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? '';
  let json; try { json = JSON.parse(text); } catch { /* text */ }
  return { isError: r.result?.isError === true, text, json, raw: r };
};
let mcpStdoutJunk = '';

try {
  check('apps/server starts on a free port', port > 0, out.trim().split('\n').slice(-5).join(' | '));
  if (!port) throw new Error('no server');
  for (const r of ['inbox', 'gaps', 'recommendations', 'cards', 'cards/[id]', 'policies', 'policies/[id]', 'focus', 'human-token']) {
    check(`apps/server mounts /api/companion/${r}`, new RegExp(`^route \\S+ /api/companion/${r.replace(/[[\]]/g, '\\$&')}$`, 'm').test(out));
  }

  mcp = spawn(process.execPath, [path.join(ROOT, 'apps/mcp/bp-mcp.mjs')], { cwd: tmp, env: { ...process.env, BP_URL: `http://127.0.0.1:${port}`, BP_CONVERSATION: 'conv-check' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  createInterface({ input: mcp.stdout! }).on('line', (line) => {
    let m; try { m = JSON.parse(line); } catch { mcpStdoutJunk += line; return; }
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
  mcp.stderr!.on('data', () => {});

  // -------------------------------------------------------------------------------------------- mcp
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'check', version: '0' } });
  check('initialize: echoes the protocolVersion, serverInfo bp, capabilities.tools', init.result?.protocolVersion === '2025-03-26' && init.result?.serverInfo?.name === 'bp' && !!init.result?.capabilities?.tools, j(init));
  mcp.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = (await rpc('tools/list')).result?.tools ?? [];
  const want = TOOLS.map((t: any) => ({ name: wireName(t.name), description: t.description + (classOf(t) === 'GATED' ? ' [needs the person]' : ''), inputSchema: t.params_schema }));
  check(`tools/list equals the catalog by wire name (${list.length} of ${TOOLS.length})`, JSON.stringify(list) === JSON.stringify(want), j(list.map((t: any) => t.name)));
  const unknown = await rpc('nonesuch/method');
  check('an unknown method is a JSON-RPC -32601', unknown.error?.code === -32601, j(unknown));

  // -------------------------------------------------------------------------------------------- auto
  const kscan = await req('GET', '/api/products/kettle/scan');
  const proposed: string[] = (kscan.json?.proposals ?? []).filter((p: any) => p.status === 'proposed').map((p: any) => p.id);
  check(`Kettle has proposed findings to build waves from (${proposed.length})`, proposed.length >= 3);
  let nWave = 0;
  const compose = async () => call('wave_compose', { slug: 'kettle', name: `Check ${++nWave}`, packages: [{ name: 'One', model: 'sonnet', effort: 'low', ids: [proposed[nWave - 1]] }] });
  const c1 = await compose();
  const w1: string = c1.json?.wave?.id;
  const waves = (await req('GET', '/api/products/kettle/waves')).json?.waves ?? [];
  check('auto: wave_compose hits POST /waves (the wave is listed)', !c1.isError && !!w1 && waves.some((w: any) => w.id === w1), j(c1));
  const f1 = await call('focus_show', { product: 'kettle', kind: 'feature', id: 'kettle-boil', say: 'here' });
  const fs1 = (await req('GET', '/api/companion/focus')).json ?? [];
  check('auto: focus_show hits POST /focus (GET focus lists it, newest first)', !f1.isError && fs1[0]?.id === f1.json?.id && fs1[0]?.target?.kind === 'feature', j({ f1: f1.json, fs1 }));
  const pf = await call('plan_find', { product: 'kettle', q: 'booking attendance' });
  const room = (pf.json?.matches ?? []).find((m: any) => m.kind === 'room');
  check('auto: plan_find names a Kettle room by its words, with a real id', !pf.isError && !!room && /booking/i.test(room.name) && typeof room.id === 'string', pf.text);
  const toc = await call('plan_find', { product: 'kettle' });
  check('auto: plan_find with no words lists only wings and rooms', !toc.isError && toc.json?.total > 0 && toc.json.matches.every((m: any) => m.kind === 'wing' || m.kind === 'room'), toc.text);
  const pf404 = await call('plan_find', { product: 'nonesuch', q: 'x' });
  check('auto: plan_find on an unknown product is isError', pf404.isError, pf404.text);
  const fs2 = (await req('GET', `/api/companion/focus?since=${f1.json?.id}`)).json;
  check('auto: GET focus?since=<newest> is empty', Array.isArray(fs2) && fs2.length === 0, j(fs2));
  const e1 = await call('decision_recommend', { slug: 'nonesuch', id: 'p1', verdict: 'approve', why: 'x' });
  check('auto: an HTTP error comes back isError with bp\'s error', e1.isError && /404 unknown product nonesuch/.test(e1.text), e1.text);
  const e2 = await call('finding_decline', { slug: 'good' });
  check('auto: a missing required param is isError and calls nothing', e2.isError && /missing id/.test(e2.text), e2.text);
  const r1 = await call('decision_recommend', { slug: 'good', id: 'p2', verdict: 'decline', why: 'stale idea' });
  check('auto: decision_recommend stores a recommendation', !r1.isError && r1.json?.verdict === 'decline', r1.text);

  // -------------------------------------------------------------------------------------------- gated
  const jobsOf = async (wave: string) => ((await req('GET', '/api/products/kettle/scans')).json ?? []).filter((x: any) => x.kind === 'execute' && x.wave === wave).length;
  const g1 = await call('wave_dispatch', { slug: 'kettle', wave: w1 });
  const cardId: string = g1.json?.card;
  check('gated: wave_dispatch answers { card, state: pending }', !g1.isError && g1.json?.state === 'pending' && /^card_/.test(cardId ?? ''), g1.text);
  check('gated: ... and never hit its route (no execute job for the wave)', (await jobsOf(w1)) === 0);
  const listed = (await req('GET', '/api/companion/cards')).json ?? [];
  check('gated: GET cards lists it pending, newest first', listed[0]?.id === cardId && listed[0]?.state === 'pending' && listed[0]?.tool === 'wave.dispatch' && listed[0]?.product === 'kettle', j(listed[0]));
  const auto = await req('POST', '/api/companion/cards', {}, { tool: 'wave_compose', args: { slug: 'kettle', name: 'x', packages: [] } });
  check('gated: an AUTO tool cannot be carded (400)', auto.status === 400, j(auto));

  // -------------------------------------------------------------------------------------------- human
  const noTok = await req('POST', `/api/companion/cards/${cardId}`, {}, { decision: 'approve' });
  const wrongTok = await req('POST', `/api/companion/cards/${cardId}`, { 'x-bp-human': 'f'.repeat(64) }, { decision: 'approve' });
  check('human: approve without the token is 403 and runs nothing', noTok.status === 403 && wrongTok.status === 403 && (await jobsOf(w1)) === 0, j({ noTok, wrongTok }));
  const tNone = await req('GET', '/api/companion/human-token');
  const tOne = await req('GET', '/api/companion/human-token', { 'sec-fetch-site': 'same-origin' });
  const tCross = await req('GET', '/api/companion/human-token', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' });
  check('human: human-token without the Sec-Fetch headers is 403', tNone.status === 403 && !tNone.json?.token, j(tNone));
  check('human: human-token with one header, or cross-site, is 403', tOne.status === 403 && tCross.status === 403, j({ tOne, tCross }));
  const tok = await req('GET', '/api/companion/human-token', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' });
  const TOKEN: string = tok.json?.token ?? '';
  check('human: human-token from bp\'s own page answers a token, no-store', tok.status === 200 && TOKEN.length === 64 && /no-store/.test(String(tok.headers['cache-control'])), j(tok));
  const yes = await req('POST', `/api/companion/cards/${cardId}`, { 'x-bp-human': TOKEN }, { decision: 'approve' });
  check('human: approve with the token runs the route and the card is done', yes.status === 200 && yes.json?.state === 'done' && yes.json?.decidedBy === 'human' && (await jobsOf(w1)) === 1, j(yes));
  const again = await req('POST', `/api/companion/cards/${cardId}`, { 'x-bp-human': TOKEN }, { decision: 'decline' });
  check('human: a second answer is 409 and runs nothing more', again.status === 409 && again.json?.card?.state === 'done' && (await jobsOf(w1)) === 1, j(again));
  const c2 = await compose(), w2: string = c2.json?.wave?.id;
  const g2 = await call('wave_dispatch', { slug: 'kettle', wave: w2 });
  const dec = await req('POST', `/api/companion/cards/${g2.json?.card}`, { 'x-bp-human': TOKEN }, { decision: 'decline' });
  check('human: decline runs nothing (card declined, no job)', dec.status === 200 && dec.json?.state === 'declined' && (await jobsOf(w2)) === 0, j(dec));
  check('mcp: the MCP process never wrote anything but JSON-RPC on stdout', mcpStdoutJunk === '', mcpStdoutJunk.slice(0, 200));

  // -------------------------------------------------------------------------------------------- policy
  const grantBody = { product: 'kettle', tools: ['wave_dispatch'], hours: 1 };
  const pNo = await req('POST', '/api/companion/policies', {}, grantBody);
  check('policy: POST /policies without the token is 403', pNo.status === 403, j(pNo));
  const pBad = await req('POST', '/api/companion/policies', { 'x-bp-human': TOKEN }, { product: '*', tools: ['policy.propose'], hours: 1 });
  const pAuto = await req('POST', '/api/companion/policies', { 'x-bp-human': TOKEN }, { product: '*', tools: ['wave.compose'], hours: 1 });
  check('policy: policy.propose and AUTO tools cannot be granted (400)', pBad.status === 400 && pAuto.status === 400, j({ pBad, pAuto }));
  const grant = await req('POST', '/api/companion/policies', { 'x-bp-human': TOKEN }, grantBody);
  check('policy: a grant with the token is 201, stored dotted', grant.status === 201 && grant.json?.tools?.[0] === 'wave.dispatch' && /^pol_/.test(grant.json?.id ?? ''), j(grant));
  const c3 = await compose(), w3: string = c3.json?.wave?.id;
  const g3 = await call('wave_dispatch', { slug: 'kettle', wave: w3 });
  check('policy: a covered GATED call runs at once, decidedBy policy with the grant id', !g3.isError && g3.json?.state === 'done' && g3.json?.decidedBy === 'policy' && g3.json?.policy === grant.json?.id && (await jobsOf(w3)) === 1, g3.text);
  const del = await req('DELETE', `/api/companion/policies/${grant.json?.id}`, {});
  const delTok = await req('DELETE', `/api/companion/policies/${grant.json?.id}`, { 'x-bp-human': TOKEN });
  const c4 = await compose(), w4: string = c4.json?.wave?.id;
  const g4 = await call('wave_dispatch', { slug: 'kettle', wave: w4 });
  check('policy: DELETE needs the token; once revoked the call is a pending card again', del.status === 403 && delTok.status === 200 && g4.json?.state === 'pending' && (await jobsOf(w4)) === 0, j({ del: del.status, delTok: delTok.status, g4: g4.text }));

  // in process: the grant's scope rules (policyFor), against the same products and a separate BP_HOME
  process.chdir(tmp);
  process.env.BP_HOME = HOME2;
  const door = await import('../packages/core/src/server/api/companion/door.server.ts');
  const { toolOf } = await import('../packages/core/src/server/api/companion/tool-call.ts');
  const wd = toolOf('wave.dispatch')!;
  const tiered = door.addPolicy({ product: 'good', tools: ['wave.dispatch'], minTier: 1, hours: 1 });
  check('policy: minTier 1 does not cover a wave holding a tier 0 (stop-ship) finding', door.policyFor(wd, { slug: 'good', wave: 'w-t0' }) === null);
  check('policy: minTier 1 covers a wave whose findings are tier 2', door.policyFor(wd, { slug: 'good', wave: 'w-t2' })?.id === tiered.id);
  check('policy: minTier with a wave it cannot read covers nothing', door.policyFor(wd, { slug: 'good', wave: 'w-none' }) === null);
  check('policy: another product is not covered', door.policyFor(wd, { slug: 'bad', wave: 'w-t2' }) === null);
  check('policy: an expired grant covers nothing', door.policyFor(wd, { slug: 'good', wave: 'w-t2' }, NOW + 2 * H) === null);
  const star = door.addPolicy({ product: '*', tools: ['policy.propose', 'release.build'], hours: 1 });
  check('policy: no grant ever covers policy.propose', door.policyFor(toolOf('policy.propose')!, { product: '*', tools: ['wave.dispatch'], hours: 1 }) === null);
  check('policy: a * grant covers any product', door.policyFor(toolOf('release.build')!, { slug: 'good', id: 'rel-1.0.0' })?.id === star.id);

  // -------------------------------------------------------------------------------------------- gaps
  const table = [0, 1, 2, 3, undefined].map((t) => (['unmeasured', 'unknown', 'stale', 'deviation'] as const).map((r) => rank.gapScore(r, t)).join(',')).join(' / ');
  check('gaps: score = base (unmeasured 3, unknown 2, stale 1, deviation 1) x tier weight (0:4 1:3 2:2 3:1 none:1)', table === '12,8,4,4 / 9,6,3,3 / 6,4,2,2 / 3,2,1,1 / 3,2,1,1', table);
  const gp = await req('GET', '/api/companion/gaps?product=good');
  const got = (gp.json?.gaps ?? []).map((g: any) => `${g.feature}/${g.lens}:${g.reason}:${g.score}`).join(' ');
  // a: tier 1 (p4, tier 1, beats its priority P2); b: tier 0 (p1); c: untiered (p3 is built, not open)
  const wantGaps = 'b/sec:unmeasured:12 a/sec:unmeasured:9 a/std/x:unknown:6 b/dev:stale:4 c/dev:unmeasured:3 c/sec:unmeasured:3 c/std/y:deviation:1';
  check('gaps: GET gaps on good answers exactly the expected ranked list', gp.status === 200 && got === wantGaps, got);
  const gAll = await req('GET', '/api/companion/gaps?limit=3');
  check('gaps: across products, limit 3, bad named in skipped', gAll.json?.gaps?.length === 3 && (gAll.json?.skipped ?? []).some((s: any) => s.product === 'bad'), j(gAll.json));
  const gScan = await call('scan_gaps', { slug: 'good', limit: 1 });
  check('gaps: the scan_gaps tool reaches it by slug', !gScan.isError && gScan.json?.gaps?.[0]?.score === 12, gScan.text);

  // -------------------------------------------------------------------------------------------- inbox
  const ib = await req('GET', '/api/companion/inbox');
  const items = ib.json?.items ?? [];
  const order = items.map((x: any) => `${x.product}:${x.id}:${x.kind}:${x.rank}`).join(' ');
  check('inbox: tier first, then value per effort, then age (accepted items left out)', order === 'good:p1:proposal:1 good:p4:proposal:2 good:p6:proposal:3 good:p3:triage:4 good:p2:proposal:5', order);
  check('inbox: the unreadable product is skipped and named with why', (ib.json?.skipped ?? []).some((s: any) => s.product === 'bad' && /cannot read the scan store/.test(s.why)), j(ib.json?.skipped));
  check('inbox: a recommendation rides on its item', items.find((x: any) => x.id === 'p2')?.recommendation?.verdict === 'decline', j(items.find((x: any) => x.id === 'p2')));
  check('inbox: ageMs measured from created_at (p2 ~120 h)', Math.abs((items.find((x: any) => x.id === 'p2')?.ageMs ?? 0) - 120 * H) < 10 * 60000);
  const ibl = await call('inbox_list', { limit: 2 });
  check('inbox: the inbox_list tool answers it, limited', !ibl.isError && ibl.json?.items?.length === 2, ibl.text);

  // -------------------------------------------------------------------------------------------- doc
  const doc = fs.readFileSync(path.join(ROOT, 'docs/concepts/vr-light-table/tech-stack.md'), 'utf8');
  const sec4 = doc.slice(doc.indexOf('## 4.'), doc.indexOf('## 5.'));
  const rows = [...sec4.matchAll(/^\| `([\w.]+)`[^|]*\| (yes|no) \| (none|internal|external) \| (AUTO|GATED) \|\r?$/gm)].map((m) => m.slice(1).join(':')).join(' ');
  const cat = TOOLS.map((t: any) => `${t.name}:${t.reversible ? 'yes' : 'no'}:${t.side_effects}:${classOf(t)}`).join(' ');
  check('doc: tech-stack.md section 4 is the catalog (name, flags, class, order)', rows === cat, rows);
} catch (e) {
  check('the walk ran to the end', false, (e as Error).stack ?? String(e));
} finally {
  mcp?.stdin?.end();
  mcp?.kill();
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a handle still closing on Windows */ }
}
console.log(`\ncheck-companion-door: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
