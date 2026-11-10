// Checks onboarding from the headset (owner, 2026-11-10; docs/concepts/vr-light-table/table-link-v2.md section 14): the
// `onboard` scope, GET /api/onboarding/candidates, POST /api/onboarding/start, their bounds and their record, and watching an
// onboarding through the Wi-Fi door under `read`. In-process: the real loopback mount with the server's device hook (a
// Bearer earns the overlay and the seals exactly as on :3100), the real LanDoor on an ephemeral loopback port (a harness
// header stands in for a private-range peer, as check:lan-door does), the Headsets page's routes, and the adopt job over
// the fake CLI (scripts/fixtures/fake-adopt.mjs, a stub adopt-bp skill), so no model is called. A scratch registry
// (BP_PRODUCTS_FILE) whose one product sits in a folder named ES2PARENT beside its sibling git folders. It holds:
//   scope       `onboard` is a scope and named-only: a device asking for it gets it only when the approve names it; the seal
//               rides only on a pairing that holds it; `decide` does not imply it; the door's verbs need it
//   refused     a device without `onboard` is refused on candidates and start (the door's bare 403; on the cable the route's
//               403), and so is a plain loopback caller that names a device or forges the seal header (the mount strips it)
//   candidates  the offer: the sibling git folders and the registered-but-never-read product, not a plain folder, not a
//               hidden one, ids opaque; the serialized body holds no absolute path, drive letter, parent folder name,
//               backslash or this account's user name; a commit subject that names a path is replaced
//   start       an id the PC does not offer is 404, a path in its place 400, a body with more keys 400, no `shown` 400; a
//               start is 202 { slug, name, job }, registered under the folder's slug, the job is the page's (no model)
//   bounds      the second start while one runs is 409 with the running slug (from the same and another device), the
//               fourth in a day from one device is 429 with words and retryAfterS; another device still may
//   log         each start is in the decision log: kind onboard, surface vr, device, shown, target the slug, the job
//   watch       GET /api/onboarding and the feed pass the door under read with the VR app's exact query, a wider one is refused
//   page        the Headsets page lists the starts and STOPs a running one (human token only; a headset is refused)
// Run: node --import @bp/core/register scripts/check-onboard-door.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { harness } from './lib/expect.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { expect, done } = harness('check-onboard-door');

// ------------------------------------------------------------------------------------------------ the scratch world
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-onboard-')));
process.env.BP_HOME = tmp;
process.env.BP_PRODUCTS_FILE = path.join(tmp, 'products.json');
const SKILL = path.join(tmp, 'skill', 'adopt-bp');
fs.mkdirSync(path.join(SKILL, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(SKILL, 'SKILL.md'), '# adopt-bp (stub for check-onboard-door)\n');
// the stub check also stages the swap of S4 finding 5: when SWAP names a folder, it replaces that folder by a junction to
// another git folder WHILE the check runs (as a local program could in that window)
const SWAP = path.join(tmp, 'swap.json');
fs.writeFileSync(path.join(SKILL, 'scripts', 'adopt.mjs'), [
  "import fs from 'node:fs'; import path from 'node:path';",
  "const root = process.argv[process.argv.indexOf('--root') + 1];",
  `const swap = ${JSON.stringify(SWAP)};`,
  "if (fs.existsSync(swap)) { const s = JSON.parse(fs.readFileSync(swap, 'utf8')); if (path.basename(root) === s.name) { process.chdir(path.dirname(swap)); fs.unlinkSync(swap); fs.renameSync(root, root + '-old'); fs.symlinkSync(s.target, root, 'junction'); } }",
  "console.log(JSON.stringify({ items: [{ key: 'map', state: 'missing', detail: 'none' }] }));",
].join('\n') + '\n');
process.env.BP_ADOPT_SKILL = SKILL;
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts', 'fixtures', 'fake-adopt.mjs');
process.env.FAKE_ADOPT_MS = '30000'; // long enough that a started job is still running for the bounds below
delete process.env.BP_RUNNER;

const PARENT = path.join(tmp, 'ES2PARENT');
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const mkRepo = (name: string, subject: string, remote?: string) => {
  const r = path.join(PARENT, name);
  fs.mkdirSync(r, { recursive: true });
  fs.writeFileSync(path.join(r, 'README.md'), `# ${name}\n`);
  git(r, 'init', '-q'); git(r, 'config', 'user.email', 't@t'); git(r, 'config', 'user.name', 't'); git(r, 'add', '.'); git(r, 'commit', '-qm', subject);
  if (remote) git(r, 'remote', 'add', 'origin', remote);
  return r;
};
const anchor = mkRepo('anchor', 'the registered one');
mkRepo('alpha', 'Add the tide table export');
mkRepo('beta', `Move notes out of ${PARENT}`, 'https://example.invalid/someone/beta-remote.git');
mkRepo('gamma', 'A subject that runs well past sixty characters so the hint has to be clipped short');
mkRepo('delta', 'Fourth of the day');
fs.mkdirSync(path.join(PARENT, 'plain'), { recursive: true });
mkRepo('.hidden', 'hidden');
// held back from a headset (S4): a folder with its own MCP servers, one with its own hooks, one whose name the prompt cannot carry
const withMcp = mkRepo('epsilon', 'ships its own MCP server');
fs.writeFileSync(path.join(withMcp, '.mcp.json'), JSON.stringify({ mcpServers: { x: { command: 'node', args: ['x.js'] } } }));
const withHooks = mkRepo('zeta', 'ships its own hooks');
fs.mkdirSync(path.join(withHooks, '.claude'), { recursive: true });
fs.writeFileSync(path.join(withHooks, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [] } }));
const oddName = mkRepo('odd$(name)', 'a name with a dollar');
fs.writeFileSync(process.env.BP_PRODUCTS_FILE, JSON.stringify({ products: [{ slug: 'anchor', name: 'Anchor', root: anchor }] }));

const { listener, loadRoutes } = await import('../apps/server/src/mount.ts');
const { LanDoor, NAMED_ONLY, SCOPES, verbOf, writeRegistry, fingerprintOf, deviceId } = await import('../apps/server/src/lan-door.ts');
const { loopbackDevice, deviceOverlay } = await import('../apps/server/src/device-auth.ts');
const { headsetRoutes } = await import('../apps/server/src/headsets.ts');
const { humanToken } = await import('../packages/core/src/server/api/companion/door.server.ts');
const { ONBOARD_SEAL_HEADER, DECIDER_SEAL_HEADER, onboardSeal, readDecisions } = await import('../packages/core/src/server/decider.server.ts');
const { DEVICE_STARTS_PER_DAY, HINT_MAX, MAX_CANDIDATES, ASKS_PER_HOUR, ASK_TTL_MS, candidateId, askOf, confirmAsk } = await import('../packages/core/src/server/onboard-start.server.ts');
const { cancel, list, ADOPT_ARGS } = await import('../packages/core/src/server/jobs.server.ts');
type Scope = (typeof SCOPES)[number];

const HOME = path.join(tmp, 'lan');
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');
const routes = await loadRoutes(API);
const loop = http.createServer(listener(routes, (a) => loopbackDevice(a, HOME)));
await new Promise<void>((r) => loop.listen(0, '127.0.0.1', () => r()));
const LOOP = (loop.address() as { port: number }).port;
const PEER = 'x-check-peer';
const door = new LanDoor({
  routes, loopbackPort: LOOP, host: '127.0.0.1', port: 0, home: HOME, log: () => {},
  peerOf: (req) => { const p = req.headers[PEER]; return typeof p === 'string' ? p : req.socket.remoteAddress; },
});
routes.push(...door.adminRoutes());
routes.push(...headsetRoutes({ door: () => door, mode: () => 'lan', started: 'lan', home: HOME, wifiAt: () => ({ address: '127.0.0.1', port: 0 }), switchOn: async () => null }));

// three pairings written as the claim writes them: A may onboard, B may decide (not onboard), C may onboard too
const tok = () => randomBytes(32).toString('base64url');
const now = Date.now(), until = new Date(now + 86_400_000).toISOString();
const row = (id: string, device: string, scopes: Scope[], token: string) => ({ id, device, fingerprint: fingerprintOf(token).toString('hex'), scopes, createdAt: new Date(now).toISOString(), expiresAt: until });
const TA = tok(), TB = tok(), TC = tok();
const rows = [row('aaaa0001', 'quest3s', ['read', 'onboard'], TA), row('bbbb0002', 'quest3s', ['read', 'standup', 'decide', 'scan'], TB), row('cccc0003', 'questb', ['read', 'onboard'], TC)];
writeRegistry(rows, HOME);
const devA = deviceId(rows[0]), devC = deviceId(rows[2]);
await door.start();
const DOOR = door.port as number;

interface Res { status: number; body: string; json: Record<string, unknown> }
function send(port: number, method: string, target: string, headers: Record<string, string> = {}, body?: unknown): Promise<Res> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, ...(text !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } : {}), ...headers } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (b: Buffer) => parts.push(b));
      res.on('end', () => {
        const b = Buffer.concat(parts).toString('utf8');
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(b) as Record<string, unknown>; } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, body: b, json });
      });
    });
    req.on('error', reject);
    if (text !== undefined) req.write(text);
    req.end();
  });
}
/** Over Wi-Fi: the door, a private-range peer, the device's Bearer. */
const wifi = (t: string, method: string, target: string, body?: unknown) => send(DOOR, method, target, { [PEER]: '192.168.1.50', authorization: `Bearer ${t}` }, body);
/** Over the cable: the loopback listener, the device's Bearer. */
const cable = (t: string, method: string, target: string, body?: unknown) => send(LOOP, method, target, { authorization: `Bearer ${t}` }, body);
const HUMAN = { 'x-bp-human': humanToken(), 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' };
type Cand = { id: string; name: string; hint: string; state: string };

// ------------------------------------------------------------------------------------------------ scope
expect((SCOPES as readonly string[]).includes('onboard') && NAMED_ONLY.includes('onboard' as Scope), 'onboard is a scope, and named-only');
door.openWindow('check');
const ask = door.requestPairing({ nonce: randomBytes(18).toString('base64url'), device: 'quest3s', scopes: ['read', 'onboard'] }, 'loopback');
const code = 'status' in ask ? String(ask.body.code) : '';
const plain = door.approve(code);
expect(plain.ok && !plain.scopes.includes('onboard') && plain.scopes.includes('read'), 'a device asking for onboard does not get it from a plain approve', JSON.stringify(plain));
const ask2 = door.requestPairing({ nonce: randomBytes(18).toString('base64url'), device: 'quest3s', scopes: ['read', 'onboard'] }, 'loopback');
const named = door.approve('status' in ask2 ? String(ask2.body.code) : '', ['read', 'onboard']);
expect(named.ok && named.scopes.includes('onboard'), 'an approve that names onboard grants it', JSON.stringify(named));
const ovA = deviceOverlay(rows[0] as never), ovB = deviceOverlay(rows[1] as never);
expect(ovA[ONBOARD_SEAL_HEADER] === onboardSeal() && !ovB[ONBOARD_SEAL_HEADER] && !!ovB[DECIDER_SEAL_HEADER] && !ovA[DECIDER_SEAL_HEADER], 'the onboard seal rides only on a pairing holding onboard; decide does not imply it, nor it decide');
expect(verbOf(['read', 'standup', 'decide', 'scan'], 'GET', '/api/onboarding/candidates') === null && verbOf(['read', 'standup', 'decide', 'scan'], 'POST', '/api/onboarding/start') === null, 'without onboard, no scope reaches candidates or start through the door');
expect(!!verbOf(['onboard'], 'GET', '/api/onboarding/candidates') && !!verbOf(['onboard'], 'POST', '/api/onboarding/start'), 'onboard reaches both');
expect(verbOf(['onboard'], 'POST', '/api/onboarding/check') === null && verbOf(['onboard'], 'POST', '/api/products') === null && verbOf(['onboard'], 'POST', '/api/products/alpha/onboard') === null, 'onboard reaches neither the folder check, the register nor the raw onboard route');

// ------------------------------------------------------------------------------------------------ refused
let r = await wifi(TB, 'GET', '/api/onboarding/candidates');
expect(r.status === 403 && r.body === '', 'Wi-Fi, no onboard: candidates is the bare 403', `${r.status} ${r.body}`);
r = await wifi(TB, 'POST', '/api/onboarding/start', { candidate: 'a'.repeat(24), shown: 'x' });
expect(r.status === 403 && r.body === '', 'Wi-Fi, no onboard: start is the bare 403', `${r.status} ${r.body}`);
r = await cable(TB, 'GET', '/api/onboarding/candidates');
expect(r.status === 403 && /Onboard/.test(String(r.json.error)), 'cable, no onboard (a decide pairing): candidates 403 in words', `${r.status} ${r.body}`);
r = await cable(TB, 'POST', '/api/onboarding/start', { candidate: 'a'.repeat(24), shown: 'x' });
expect(r.status === 403, 'cable, no onboard (a decide pairing): start 403', `${r.status} ${r.body}`);
r = await send(LOOP, 'POST', '/api/onboarding/start', { 'x-bp-device': devA, [ONBOARD_SEAL_HEADER]: onboardSeal() }, { candidate: 'a'.repeat(24), shown: 'x' });
expect(r.status === 403, 'a plain loopback caller naming a device and sending the seal header is refused (the mount strips the seal)', `${r.status} ${r.body}`);
r = await send(LOOP, 'GET', '/api/onboarding/candidates', { 'x-bp-device': devA });
expect(r.status === 403, 'a plain loopback caller naming a device, no seal: candidates 403', `${r.status} ${r.body}`);
r = await send(LOOP, 'POST', '/api/onboarding/start', {}, { candidate: 'a'.repeat(24) });
expect(r.status === 403, 'a plain loopback caller with no human token: start 403', `${r.status} ${r.body}`);

// ------------------------------------------------------------------------------------------------ candidates
r = await wifi(TA, 'GET', '/api/onboarding/candidates');
const list0 = r.json as { candidates: Cand[]; roots: number; held: number };
const names = list0.candidates?.map((c) => c.name) ?? [];
expect(r.status === 200 && list0.roots === 1 && JSON.stringify(names) === JSON.stringify(['alpha', 'anchor', 'beta', 'delta', 'gamma']), 'Wi-Fi with onboard: the sibling git folders and the never-read product, by name; not plain, not hidden, not held', r.body);
expect(list0.held === 3, 'held (S4): a folder with .mcp.json, one with .claude/settings.json and one whose name needed replacing are counted, never offered', String(list0.held));
for (const [dir, what] of [[withMcp, '.mcp.json'], [withHooks, '.claude/settings.json'], [oddName, 'a $( name']] as const) {
  const x = await wifi(TA, 'POST', '/api/onboarding/start', { candidate: candidateId(dir), shown: 'Read it now?' });
  expect(x.status === 403 && /agent settings/.test(String(x.json.error)) && !list(path.basename(dir)).length, `a held folder's id (${what}) is refused at start: 403 in words, nothing started`, `${x.status} ${x.body}`);
}
expect(ADOPT_ARGS.join(' ').includes('--setting-sources user') && ADOPT_ARGS.includes('--strict-mcp-config') && ADOPT_ARGS.includes('--dangerously-skip-permissions'), 'the adopt job loads only the user\'s settings and no MCP server (S4 1a: the target folder\'s hooks and .mcp.json do not load)', ADOPT_ARGS.join(' '));
expect(list0.candidates.every((c) => /^[0-9a-f]{24}$/.test(c.id) && c.hint.length <= HINT_MAX) && list0.candidates.length <= MAX_CANDIDATES, 'ids are 24 hex, hints at most 60 characters');
expect(list0.candidates.find((c) => c.name === 'anchor')?.state === 'registered' && list0.candidates.filter((c) => c.name !== 'anchor').every((c) => c.state === 'new'), 'states: anchor registered, the rest new');
const user = os.userInfo().username;
const leaks = [tmp, tmp.replace(/\\/g, '/'), 'ES2PARENT', os.tmpdir(), user.length >= 3 ? user : '\0'].filter((x) => r.body.toLowerCase().includes(x.toLowerCase()));
expect(!leaks.length && !/[A-Za-z]:[\\/]/.test(r.body) && !r.body.includes('\\\\') && !/"\/(?:Users|home|tmp)\//.test(r.body), 'the serialized body holds no absolute path, drive letter, parent folder name or user name', leaks.join(' | ') + ' ' + r.body.slice(0, 200));
const byName = (n: string) => list0.candidates.find((c) => c.name === n) as Cand;
expect(byName('alpha').hint === 'Add the tide table export', 'a hint is the last commit subject', byName('alpha').hint);
expect(byName('beta').hint === 'beta-remote', 'a commit subject that names a path is replaced by the remote repo name', byName('beta').hint);
expect(byName('gamma').hint.length <= HINT_MAX && byName('gamma').hint.length >= HINT_MAX - 2 &&byName('gamma').hint.endsWith('…'), 'a long subject is clipped', byName('gamma').hint);
expect(Object.keys(byName('alpha')).sort().join() === 'hint,id,name,state' && Object.keys(list0).sort().join() === 'candidates,held,roots', 'nothing else is sent');

// ------------------------------------------------------------------------------------------------ start: refusals
const shown = (n: string) => `Read ${n} now? This starts a paid agent run on your PC.`;
r = await wifi(TA, 'POST', '/api/onboarding/start', { candidate: 'f'.repeat(24), shown: shown('x') });
expect(r.status === 404 && typeof r.json.error === 'string', 'an id the PC does not offer: 404 in words', `${r.status} ${r.body}`);
r = await wifi(TA, 'POST', '/api/onboarding/start', { candidate: path.join(PARENT, 'alpha'), shown: shown('alpha') });
expect(r.status === 400, 'a path in place of an id: refused (400)', `${r.status} ${r.body}`);
r = await wifi(TA, 'POST', '/api/onboarding/start', { candidate: 'alpha', shown: shown('alpha') });
expect(r.status === 400, 'a name in place of an id: refused (400)', `${r.status} ${r.body}`);
r = await wifi(TA, 'POST', '/api/onboarding/start', { candidate: byName('alpha').id, shown: shown('alpha'), model: 'opus' });
expect(r.status === 400 && /model/.test(String(r.json.error)), 'a body with a model (or any other key): 400', `${r.status} ${r.body}`);
r = await wifi(TA, 'POST', '/api/onboarding/start', { candidate: byName('alpha').id });
expect(r.status === 400 && /shown/.test(String(r.json.error)), 'a start from the table without shown: 400', `${r.status} ${r.body}`);
expect(!list('alpha').length, 'none of the refusals started anything');

// ------------------------------------------------------------------------------------------------ the ask, the PC confirm, the log
// (owner, 2026-11-10: "the headset picks the folder; a confirm appears on the Headsets page naming the folder, and the run
// starts only after your click there")
const askFor = (t: string, n: string) => wifi(t, 'POST', '/api/onboarding/start', { candidate: byName(n).id, shown: shown(n) });
const readAsk = (t: string, id: string, q = '') => wifi(t, 'GET', `/api/onboarding/requests/${id}${q}`);
const confirm = (id: string, h: Record<string, string> = HUMAN) => send(LOOP, 'POST', '/api/companion/headsets/ask/confirm', h, { id });
const regHas = (slug: string) => (JSON.parse(fs.readFileSync(process.env.BP_PRODUCTS_FILE as string, 'utf8')) as { products: { slug: string; root: string }[] }).products.find((p) => p.slug === slug);
r = await askFor(TA, 'alpha');
const askA = String(r.json.request);
expect(r.status === 202 && /^[0-9a-f]{24}$/.test(askA) && r.json.name === 'alpha' && r.json.state === 'waiting' && Object.keys(r.json).sort().join() === 'name,request,state', 'a start from the table is an ask: 202 { request, name, state: waiting }', `${r.status} ${r.body}`);
expect(!list('alpha').length && !regHas('alpha'), 'an ask starts no job and registers nothing');
r = await readAsk(TA, askA);
expect(r.status === 200 && r.json.state === 'waiting' && r.json.request === askA && !('slug' in r.json) && !('job' in r.json), 'the asking pairing reads its ask: waiting, no slug or job yet', `${r.status} ${r.body}`);
r = await readAsk(TC, askA);
expect(r.status === 404, 'another pairing (holding onboard too) reads the ask as 404', `${r.status} ${r.body}`);
r = await readAsk(TB, askA);
expect(r.status === 403 && r.body === '', 'a pairing without onboard: the door\'s bare 403', `${r.status}`);
r = await readAsk(TA, askA, '?x=1');
expect(r.status === 403 && r.body === '', 'the requests verb takes no query', `${r.status}`);
r = await send(LOOP, 'GET', `/api/onboarding/requests/${askA}`);
expect(r.status === 404, 'a plain loopback caller (no device) reads it as 404', `${r.status}`);
r = await send(LOOP, 'GET', '/api/companion/headsets', HUMAN);
const asks0 = (r.json.asks ?? []) as { id: string; device: string; name: string; hint: string; shown: string; expiresAt: string }[];
expect(asks0.length === 1 && asks0[0].id === askA && asks0[0].device === devA && asks0[0].name === 'alpha' && asks0[0].hint === 'Add the tide table export' && asks0[0].shown === shown('alpha') && !!asks0[0].expiresAt, 'the Headsets page shows the open ask: device, the folder\'s name and hint as the PC knows them, the words shown', JSON.stringify(asks0));
r = await cable(TA, 'POST', '/api/companion/headsets/ask/confirm', { id: askA });
expect(r.status === 403 && !list('alpha').length, 'a confirm carrying a device\'s token is 403', `${r.status} ${r.body}`);
r = await send(LOOP, 'POST', '/api/companion/headsets/ask/confirm', { 'x-bp-device': devA, [ONBOARD_SEAL_HEADER]: onboardSeal(), ...HUMAN }, { id: askA });
expect(r.status === 403 && !list('alpha').length, 'a confirm carrying a device mark and seal (even beside the page token) is 403', `${r.status} ${r.body}`);
r = await send(LOOP, 'POST', '/api/companion/headsets/ask/confirm', {}, { id: askA });
expect(r.status === 403 && !list('alpha').length, 'a confirm without the page token is 403', `${r.status} ${r.body}`);
r = await confirm(askA);
const jobA = String(r.json.job);
expect(r.status === 200 && r.json.state === 'confirmed' && r.json.slug === 'alpha' && /^j-/.test(jobA), 'the page\'s CONFIRM starts it: 200 { state: confirmed, slug, job }', `${r.status} ${r.body}`);
expect(!!regHas('alpha') && path.resolve(regHas('alpha')!.root) === path.join(PARENT, 'alpha'), 'registered under the folder\'s slug, at the offered path');
const jA = list('alpha').find((j) => j.id === jobA);
expect(!!jA && jA.kind === 'adopt' && jA.model === undefined && !jA.resume, 'the adopt job is the page\'s first read: no model, no resume', JSON.stringify(jA));
r = await readAsk(TA, askA);
expect(r.status === 200 && r.json.state === 'confirmed' && r.json.slug === 'alpha' && r.json.job === jobA, 'the headset reads confirmed with the slug and job to watch', r.body);
r = await confirm(askA);
expect(r.status === 409, 'a second confirm of the same ask: 409', `${r.status} ${r.body}`);
let log = readDecisions().filter((x) => x.kind === 'onboard' || x.kind === 'onboard-ask');
expect(log.length === 2 && log[0].kind === 'onboard-ask' && log[0].surface === 'vr' && log[0].device === devA && log[0].target === 'alpha' && log[0].shown === shown('alpha') && log[0].request === askA
  && log[1].kind === 'onboard' && log[1].surface === 'web' && log[1].device === devA && log[1].verdict === 'confirm' && log[1].target === 'alpha' && log[1].job === jobA, 'two rows: the ask (vr, device, the folder\'s name, shown) and the confirm (web, the asking device, the slug, the job)', JSON.stringify(log));

// the in-flight bound at confirm; one open ask per pairing
r = await askFor(TC, 'delta');
const askC = String(r.json.request);
expect(r.status === 202, 'another headset may ask while a read runs', `${r.status} ${r.body}`);
r = await confirm(askC);
expect(r.status === 409 && r.json.state === 'declined' && /one at a time/.test(String(r.json.error)) && !list('delta').length, 'a confirm while a headset-asked read runs: 409 in words, the ask declined, nothing started', `${r.status} ${r.body}`);
r = await readAsk(TC, askC);
expect(r.json.state === 'declined' && /one at a time/.test(String(r.json.reason)), 'the headset reads declined with that sentence as the reason', r.body);
r = await askFor(TA, 'beta');
const askB1 = String(r.json.request);
r = await askFor(TA, 'gamma');
const askG = String(r.json.request);
r = await readAsk(TA, askB1);
expect(r.json.state === 'declined' && /replaced/.test(String(r.json.reason)), 'a second ask from one pairing replaces the first', r.body);
r = await send(LOOP, 'GET', '/api/companion/headsets', HUMAN);
expect(((r.json.asks ?? []) as { id: string }[]).map((a) => a.id).join() === askG, 'the page shows only the open ask', JSON.stringify(r.json.asks));
r = await wifi(TA, 'POST', '/api/onboarding/start', { candidate: byName('alpha').id, shown: shown('alpha') });
expect(r.status === 409 && r.json.slug === 'alpha', 'asking for the one being read: 409 with its slug, to watch', `${r.status} ${r.body}`);
r = await wifi(TA, 'GET', '/api/onboarding/candidates');
expect((r.json as { candidates: Cand[] }).candidates.find((c) => c.name === 'alpha')?.state === 'onboarding', 'the list now shows alpha onboarding');

// ------------------------------------------------------------------------------------------------ watch through the door
r = await wifi(TA, 'GET', '/api/onboarding');
expect(r.status === 200 && Array.isArray(r.json.items), 'GET /api/onboarding passes the door under read', `${r.status} ${r.body.slice(0, 120)}`);
r = await wifi(TA, 'GET', `/api/products/alpha/onboarding/feed?after=0&job=${jobA}`);
expect(r.status === 200 && Array.isArray(r.json.events) && (r.json.job as { id: string })?.id === jobA, 'the feed passes under read with the wrist\'s exact query', `${r.status} ${r.body.slice(0, 120)}`);
r = await wifi(TA, 'GET', `/api/products/alpha/onboarding/feed?after=3&job=${jobA}&layout=islands`);
expect(r.status === 200, 'and with the table\'s exact query (layout=islands)', `${r.status} ${r.body.slice(0, 120)}`);
for (const q of [`after=0`, `job=${jobA}&after=0`, `after=0&job=${jobA}&layout=islands&x=1`, `after=0&job=${jobA}&layout=grid`, `after=-1&job=${jobA}`, '']) {
  r = await wifi(TA, 'GET', `/api/products/alpha/onboarding/feed${q ? '?' + q : ''}`);
  expect(r.status === 403 && r.body === '', `a wider feed query is the bare 403: "${q}"`, `${r.status}`);
}
// reads are a projection (S4 finding 3): a device reads no absolute path, no log tail and no error of the job's own
{
  const { deviceJob, DEVICE_JOB_ERROR } = await import('../packages/core/src/server/device-view.server.ts');
  await new Promise((res) => setTimeout(res, 1500)); // let the fake run print a few lines into log_tail
  const dev = await wifi(TA, 'GET', '/api/onboarding'), page = await send(LOOP, 'GET', '/api/onboarding');
  const devJob = ((dev.json.items as { slug: string; job: Record<string, unknown> | null }[]) ?? []).find((x) => x.slug === 'alpha')?.job;
  const pageJob = ((page.json.items as { slug: string; job: Record<string, unknown> | null }[]) ?? []).find((x) => x.slug === 'alpha')?.job;
  expect(!!devJob && !('log_tail' in devJob) && typeof pageJob?.log_tail === 'string', 'GET /api/onboarding: a device reads the job without log_tail; the page still reads it', `${JSON.stringify(devJob)?.slice(0, 200)} | ${typeof pageJob?.log_tail}`);
  const feedDev = await wifi(TA, 'GET', `/api/products/alpha/onboarding/feed?after=0&job=${jobA}`);
  expect(!('log_tail' in ((feedDev.json.job ?? {}) as object)), 'the feed\'s job: no log_tail for a device');
  const scansDev = await wifi(TA, 'GET', '/api/products/alpha/scans');
  expect(scansDev.status !== 200 || ((scansDev.json as unknown as Record<string, unknown>[]) ?? []).every((j) => !('log_tail' in j)), 'GET .../scans: no log_tail for a device', `${scansDev.status} ${scansDev.body.slice(0, 160)}`);
  const prodDev = await wifi(TA, 'GET', '/api/products'), prodPage = await send(LOOP, 'GET', '/api/products');
  expect(prodDev.status === 200 && (prodDev.json as unknown as Record<string, unknown>[]).every((p) => !('root' in p)) && !prodDev.body.includes(PARENT.replace(/\\/g, '\\\\')) && (prodPage.json as unknown as Record<string, unknown>[]).every((p) => typeof p.root === 'string'), 'GET /api/products: a device reads no root; the page does', prodDev.body.slice(0, 200));
  const failed = deviceJob({ id: 'j-1', kind: 'adopt', status: 'failed', queued_at: '', error: `ENOENT ${PARENT}\\alpha\\.ai`, log_tail: 'x' });
  const timed = deviceJob({ id: 'j-2', kind: 'adopt', status: 'failed', queued_at: '', error: 'the CLI timed out after 600 s' });
  const stopped = deviceJob({ id: 'j-3', kind: 'adopt', status: 'cancelled', queued_at: '', error: 'cancelled by the operator' });
  expect(failed.error === DEVICE_JOB_ERROR.failed && !('log_tail' in failed) && timed.error === DEVICE_JOB_ERROR.timedOut && stopped.error === DEVICE_JOB_ERROR.stopped, 'a job\'s error reaches a device as fixed words by kind', JSON.stringify([failed, timed, stopped]));
}
r = await wifi(TA, 'GET', '/api/onboarding?all=1');
expect(r.status === 403, 'GET /api/onboarding with a query: the bare 403', r.status);
r = await wifi(TA, 'GET', '/api/products/alpha/onboarding/events');
expect(r.status === 403, 'the SSE build-up is not a door verb', r.status);

// ------------------------------------------------------------------------------------------------ the page: list, STOP
r = await send(LOOP, 'GET', '/api/companion/headsets', HUMAN);
const ob = (r.json.onboards ?? []) as { slug: string; job: string; status: string; device: string; shown?: string }[];
expect(r.status === 200 && ob.length === 1 && ob[0].slug === 'alpha' && ob[0].job === jobA && ob[0].status === 'running' && ob[0].device === devA && ob[0].shown === shown('alpha'), 'the Headsets page lists the confirmed read, running, with the words shown', r.body.slice(-400));
expect((r.json.scopes as string[]).includes('onboard') && (r.json.namedOnly as string[]).includes('onboard'), 'the page is offered the onboard scope, named-only');
r = await cable(TA, 'POST', '/api/companion/headsets/stop', { slug: 'alpha', job: jobA });
expect(r.status === 403, 'a headset cannot STOP through the page route', `${r.status} ${r.body}`);
r = await send(LOOP, 'POST', '/api/companion/headsets/stop', HUMAN, { slug: 'anchor', job: jobA });
expect(r.status === 404, 'STOP names a start the log knows, else 404', `${r.status} ${r.body}`);
r = await send(LOOP, 'POST', '/api/companion/headsets/stop', HUMAN, { slug: 'alpha', job: jobA });
expect(r.status === 200 && r.json.status === 'cancelled', 'the page STOPs it (the job cancel)', `${r.status} ${r.body}`);

// ------------------------------------------------------------------------------------------------ the daily bound (confirmed reads), the ask cap, expiry
const confirmAndStop = async (id: string) => { const x = await confirm(id); if (x.status === 200) cancel(String(x.json.slug), String(x.json.job)); return x; };
const s2 = await confirmAndStop(askG);
r = await askFor(TA, 'beta');
const s3 = await confirmAndStop(String(r.json.request));
expect(s2.status === 200 && s3.status === 200, 'once stopped, the next ones start on a confirm (the second and third today)', `${s2.status} ${s2.body} | ${s3.status} ${s3.body}`);
r = await askFor(TA, 'delta');
expect(r.status === 202, 'a fourth ask is still taken (the day bound counts confirmed reads)', `${r.status} ${r.body}`);
r = await confirm(String(r.json.request));
expect(r.status === 429 && r.json.state === 'declined' && /24 hours/.test(String(r.json.error)) && !list('delta').length, `the fourth confirm in a day for one headset: 429 in words, declined (bound ${DEVICE_STARTS_PER_DAY})`, `${r.status} ${r.body}`);
r = await askFor(TA, 'delta');
expect(r.status === 202, `the ${ASKS_PER_HOUR}th ask in an hour is taken`, `${r.status} ${r.body}`);
r = await askFor(TA, 'delta');
expect(r.status === 429 && typeof r.json.retryAfterS === 'number' && (r.json.retryAfterS as number) > 0 && /last hour/.test(String(r.json.error)), `the ${ASKS_PER_HOUR + 1}th ask in an hour: 429 with words and retryAfterS`, `${r.status} ${r.body}`);
r = await askFor(TC, 'delta');
r = await confirmAndStop(String(r.json.request));
expect(r.status === 200, 'another paired headset still may', `${r.status} ${r.body}`);
r = await askFor(TC, 'gamma');
const askOld = String(r.json.request);
const later = Date.now() + ASK_TTL_MS + 1000;
expect(askOf(askOld, devC, later)?.state === 'expired', 'an ask expires 10 minutes after it was made', JSON.stringify(askOf(askOld, devC, later)));
const late = await confirmAsk(askOld, later);
expect(late.status === 409 && !list('gamma').some((j) => j.status === 'queued' || j.status === 'running'), 'an expired ask cannot be confirmed', JSON.stringify(late));
log = readDecisions().filter((x) => x.kind === 'onboard');
const confirmed = log.filter((x) => x.verdict === 'confirm');
expect(confirmed.length === 4 && confirmed.every((x) => x.surface === 'web' && !!x.device && !!x.shown && !!x.job) && confirmed.filter((x) => x.device === devA).length === 3, 'every confirmed read is one confirm row, with the asking device and the job', JSON.stringify(confirmed.map((x) => [x.device, x.target])));
expect(log.filter((x) => x.verdict === 'decline').every((x) => x.surface === 'web' && !!x.device && !!x.reason && !x.job), 'every declined ask is one decline row with its reason', JSON.stringify(log.filter((x) => x.verdict === 'decline').map((x) => x.reason)));
expect(readDecisions().filter((x) => x.kind === 'onboard-ask' && x.device === devA).length === ASKS_PER_HOUR, 'every ask taken is one onboard-ask row (the refused one is not)');

// ------------------------------------------------------------------------------------------------ a swap during the check (S4 finding 5)
{
  const theta = mkRepo('theta', 'the one that gets swapped');
  const elsewhere = mkRepo(path.join('..', 'ELSEWHERE'), 'not offered: outside the parent');
  const x = await wifi(TC, 'POST', '/api/onboarding/start', { candidate: candidateId(theta), shown: shown('theta') });
  expect(x.status === 202, 'theta is offered and asked for', `${x.status} ${x.body}`);
  fs.writeFileSync(SWAP, JSON.stringify({ name: 'theta', target: elsewhere }));
  const y = await confirm(String(x.json.request));
  expect(y.status === 409 && /changed while this PC was checking/.test(String(y.json.error)) && !list('theta').length && !regHas('theta'), 'a folder replaced by a junction during the check: 409 in words, nothing registered or started', `${y.status} ${y.body}`);
}

// ------------------------------------------------------------------------------------------------ the page may start too
r = await send(LOOP, 'POST', '/api/onboarding/start', HUMAN, { candidate: byName('anchor').id });
expect(r.status === 202 && r.json.slug === 'anchor', 'bp\'s own page starts a read with its token (no shown needed)', `${r.status} ${r.body}`);
expect(readDecisions().some((x) => x.kind === 'onboard' && x.surface === 'web' && x.target === 'anchor'), 'recorded as surface web');
cancel('anchor', String(r.json.job));

await door.stop();
loop.close();
loop.closeAllConnections();
await new Promise((res) => setTimeout(res, 300)); // let the cancelled fake runs exit before the scratch folder goes
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a scratch dir: the OS cleans it */ }
done({ exit: true });
