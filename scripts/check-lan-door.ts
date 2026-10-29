// Checks the S8 LAN door (apps/server/src/lan-door.ts; docs/concepts/desk-to-table/plan.md D1). Three parts:
//   admission  privatePeer admits exactly 10/8, 172.16/12, 192.168/16 and 100.64/10 (IPv4-mapped too) and nothing else;
//              VERBS reaches none of the routes the door must never open (cards/<id>, human-token, dispatch, build, finish)
//   sequence   in-process: the real loopback mount and the real door on ephemeral loopback ports, with the door's peer read
//              from a header this harness sets (the door's peerOf option; the server never passes one). It drives the whole
//              ceremony and the place scope: pair, approve, claim once, claim again (410), the baton claimed, published and
//              returned through the door, a second device's forged x-bp-device and x-bp-human dropped, scope refusals, a
//              revoke, a corrupt registry (fails closed), expiry, the window closing the port and `pair open` reopening it.
//              Every refusal is collected, and they must all be byte-identical bare 403s; past admission each waits
//              REFUSAL_DELAY_MS, and the token never reaches paired.json or the ledger.
//   opt-in     the real `apps/server/src/main.ts` as a child: without --lan no door line, no /lan route, no $BP_HOME/lan;
//              with --lan (bound to 127.0.0.1, which is not a private range) the door listens and refuses its own machine
//              with the bare 403, and `pair list` reaches the owner routes; --lan-port without --lan is refused.
// Run: node --import @bp/core/register scripts/check-lan-door.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listener, loadRoutes } from '../apps/server/src/mount.ts';
import { LanDoor, privatePeer, verbOf, readRegistry, registryFile, REFUSAL_DELAY_MS, SCOPES } from '../apps/server/src/lan-door.ts';
import { humanToken } from '../packages/core/src/server/api/companion/door.server.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

// ------------------------------------------------------------------------------------------------ admission
for (const a of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.1.20', '100.64.0.1', '100.127.255.255', '::ffff:192.168.1.2', '::FFFF:10.1.2.3'])
  check(`admitted: ${a}`, privatePeer(a));
for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '8.8.8.8', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.169.0.1', '11.0.0.1', '169.254.1.1', '0.0.0.0', 'fe80::1', 'fd7a:115c:a1e0::1', '192.168.1.256', 'localhost', '', undefined])
  check(`refused: ${a === undefined ? 'undefined' : JSON.stringify(a)}`, !privatePeer(a));
const all = [...SCOPES];
for (const [m, p] of [['POST', '/api/companion/cards/c1'], ['GET', '/api/companion/cards/c1'], ['GET', '/api/companion/human-token'], ['POST', '/api/products/kettle/dispatch'],
  ['POST', '/api/products/kettle/releases/r1/build'], ['POST', '/api/products/kettle/releases/r1/finish'], ['POST', '/api/products/kettle/waves/w1/dispatch'],
  ['GET', '/lan/pair'], ['POST', '/lan/pair/approve'], ['GET', '/athena'], ['GET', '/api/companion/stream'], ['POST', '/api/products/kettle/scans']] as const)
  check(`no scope reaches ${m} ${p}`, verbOf(all, m, p) === null);
check('standup includes read', verbOf(['standup'], 'GET', '/api/products/kettle/plan') !== null && verbOf(['read'], 'POST', '/api/companion/turn') === null);
check('place is only the three baton verbs', verbOf(['place'], 'GET', '/api/session/place?claim=1') !== null && verbOf(['place'], 'GET', '/api/session/place') === null
  && verbOf(['place'], 'GET', '/api/products/kettle/structure') === null);
for (const t of ['/api/products/kettle/../structure', '/api/products/kettle/%73tructure', '/api/products//structure', '/api/products/kettle/structure?x=1', '/api/session/place?claim=1&x=1', 'api/products/kettle/plan'])
  check(`the grammar refuses ${t}`, verbOf(all, 'GET', t) === null);

// ------------------------------------------------------------------------------------------------ the sequence
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-lan-door-'));
process.env.BP_HOME = tmp;
process.chdir(tmp); // no products file: Kettle answers from the built-in sample
const HOME = path.join(tmp, 'lan');
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');
const routes = await loadRoutes(API);
const loop = http.createServer(listener(routes));
await new Promise<void>((r) => loop.listen(0, '127.0.0.1', () => r()));
const LOOP = (loop.address() as { port: number }).port;
let T = Date.parse('2026-10-29T09:00:00Z');
const logs: string[] = [];
const PEER = 'x-check-peer';
const door = new LanDoor({
  routes, loopbackPort: LOOP, host: '127.0.0.1', port: 0, home: HOME, now: () => T, log: (s) => logs.push(s),
  peerOf: (req) => { const p = req.headers[PEER]; return typeof p === 'string' ? p : req.socket.remoteAddress; },
});
routes.push(...door.adminRoutes());
await door.start();
check('start with nothing paired: a pairing window, and the door listens', door.listening && door.status().window !== null, JSON.stringify(door.status()));

interface Res { status: number; body: string; json: Record<string, unknown>; ms: number; sig: string }
function send(port: number, method: string, target: string, headers: Record<string, string>, body?: unknown): Promise<Res> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { ...headers, ...(text !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } : {}) } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (b: Buffer) => parts.push(b));
      res.on('end', () => {
        const b = Buffer.concat(parts).toString('utf8');
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(b) as Record<string, unknown>; } catch { /* not JSON */ }
        const h = res.headers;
        resolve({ status: res.statusCode ?? 0, body: b, json, ms: performance.now() - t0, sig: JSON.stringify([res.statusCode, b, h['content-type'] ?? null, h['content-length'], h['cache-control'], h.connection]) });
      });
    });
    req.on('error', reject);
    if (text !== undefined) req.write(text);
    req.end();
  });
}
const refusals: { name: string; r: Res }[] = [];
/** A request to the door from `peer`. */
const lan = (peer: string, method: string, target: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  send(door.port as number, method, target, { [PEER]: peer, ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) }, opts.body);
const admin = (method: string, target: string, body?: unknown, headers: Record<string, string> = {}) => send(LOOP, method, target, headers, body);
/** A refusal: recorded for the identity check, and it must be a 403. */
const refused = (name: string, r: Res, delayed = true) => {
  refusals.push({ name, r });
  check(`refused, 403: ${name}`, r.status === 403, `${r.status} ${r.body.slice(0, 120)}`);
  // past admission every refusal waits the fixed delay; at admission it is immediate, which also proves the request
  // never got as far as the token (a loopback peer with no token would otherwise pass as a delayed `no-token`)
  if (delayed) check(`refused after the fixed delay: ${name}`, r.ms >= REFUSAL_DELAY_MS - 5, `${r.ms.toFixed(0)} ms`);
  else check(`refused at admission, at once: ${name}`, r.ms < REFUSAL_DELAY_MS - 50, `${r.ms.toFixed(0)} ms`);
};
const nonce = () => randomBytes(18).toString('base64url'); // 24 chars, 144 bits
const QUEST = '192.168.1.50', OTHER = '10.0.0.7';

// admission over the wire: refused at once, before any delay
refused('a public peer', await lan('8.8.8.8', 'POST', '/pair', { body: { nonce: nonce(), device: 'quest3s' } }), false);
refused('a loopback peer (loopback callers use the loopback port)', await lan('127.0.0.1', 'GET', '/api/products/kettle/structure'), false);
refused('a link-local peer', await lan('169.254.3.4', 'GET', '/api/products/kettle/structure'), false);

// the ceremony
refused('a short nonce', await lan(QUEST, 'POST', '/pair', { body: { nonce: 'short', device: 'quest3s' } }));
refused('a device name the door would not echo', await lan(QUEST, 'POST', '/pair', { body: { nonce: nonce(), device: 'quest 3s<script>' } }));
refused('a scope that does not exist', await lan(QUEST, 'POST', '/pair', { body: { nonce: nonce(), device: 'quest3s', scopes: ['admin'] } }));
const NA = nonce();
let r = await lan(QUEST, 'POST', '/pair', { body: { nonce: NA, device: 'quest3s', scopes: ['place', 'read'] } });
const codeA = String(r.json.code);
check('a pairing request: 201 and a 6-character code', r.status === 201 && /^[A-HJ-NP-Z2-9]{6}$/.test(codeA), r.body);
check('the request answers nothing but its own code and expiry', Object.keys(r.json).sort().join() === 'code,expiresAt,state', r.body);
r = await lan(QUEST, 'POST', '/pair', { body: { nonce: NA, device: 'quest3s' } });
check('a retried request gets the same record back (no reset)', r.json.code === codeA, r.body);
refused('the same nonce from another peer', await lan(OTHER, 'POST', '/pair', { body: { nonce: NA, device: 'quest3s' } }));
r = await lan(QUEST, 'POST', '/pair/claim', { body: { nonce: NA } });
check('a claim before approval: 202 pending', r.status === 202 && r.json.state === 'pending', r.body);
check('the owner surface refuses a foreign Host (DNS rebinding)', (await admin('POST', '/lan/pair/approve', { code: codeA }, { host: 'evil.example' })).status === 403);
check('the owner surface refuses a cross-site page', (await admin('POST', '/lan/pair/approve', { code: codeA }, { origin: 'http://evil.example' })).status === 403);
check('approving a code nobody showed: 404', (await admin('POST', '/lan/pair/approve', { code: 'ZZZZZZ' })).status === 404);
r = await admin('POST', '/lan/pair/approve', { code: codeA.toLowerCase(), scopes: ['place', 'read'] });
check('the owner approves the code: 200, the scopes the owner chose', r.status === 200 && JSON.stringify(r.json.scopes) === '["place","read"]' && r.json.peer === QUEST, r.body);
refused('a claim from another peer (the claimant is the requester)', await lan(OTHER, 'POST', '/pair/claim', { body: { nonce: NA } }));
refused('a claim with a nonce never seen', await lan(QUEST, 'POST', '/pair/claim', { body: { nonce: nonce() } }));
r = await lan(QUEST, 'POST', '/pair/claim', { body: { nonce: NA } });
const tokenA = String(r.json.token), deviceA = String(r.json.device);
check('the claim: 200, a token once, the device id the door will use', r.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(tokenA) && /^quest3s:[0-9a-f]{8}$/.test(deviceA), r.body);
r = await lan(QUEST, 'POST', '/pair/claim', { body: { nonce: NA } });
check('a second claim: 410 claimed, no token (the theft alarm)', r.status === 410 && r.json.state === 'claimed' && !('token' in r.json), r.body);
const reg = fs.readFileSync(registryFile(HOME), 'utf8');
check('paired.json keeps the fingerprint, never the token', !reg.includes(tokenA) && reg.includes(createHash('sha256').update(tokenA).digest('hex')));
check('paired.json keeps the device, the scopes and the expiry (30 days by default)', (() => {
  const p = readRegistry(HOME)[0];
  return !!p && p.device === 'quest3s' && p.scopes.join() === 'place,read' && Date.parse(p.expiresAt) - T === 30 * 86_400_000;
})(), reg);

// the read scope, through the door into the loopback mount
r = await lan(QUEST, 'GET', '/api/products/kettle/structure', { token: tokenA });
check('read: the structure, through the door, as the loopback mount answers it', r.status === 200 && !!r.json.structure, `${r.status} ${r.body.slice(0, 120)}`);
refused('no token', await lan(QUEST, 'GET', '/api/products/kettle/structure'));
refused('an unknown token', await lan(QUEST, 'GET', '/api/products/kettle/structure', { token: randomBytes(32).toString('base64url') }));
refused('a token not in Bearer form', await lan(QUEST, 'GET', '/api/products/kettle/structure', { headers: { authorization: tokenA } }));
refused('a scope not granted (standup: cards)', await lan(QUEST, 'GET', '/api/companion/cards', { token: tokenA }));
refused('human-token, never through the door', await lan(QUEST, 'GET', '/api/companion/human-token', { token: tokenA }));
refused('dispatch, never through the door', await lan(QUEST, 'POST', '/api/products/kettle/dispatch', { token: tokenA, body: {} }));
refused('the owner routes, never through the door', await lan(QUEST, 'POST', '/lan/pair/approve', { token: tokenA, body: { code: codeA } }));
refused('a dot segment', await lan(QUEST, 'GET', '/api/products/kettle/x/../structure', { token: tokenA }));
refused('HEAD, a verb not on the list', await lan(QUEST, 'HEAD', '/api/products/kettle/structure', { token: tokenA }));

// the place scope: the page arms, the headset claims, publishes and returns through the door
const web = { product: 'kettle', hash: '#at=scheduling.appointments', level: 'L3', target: { kind: 'room', id: 'scheduling' }, from: 'web', at: '2026-10-29T09:00:00Z' };
const vr = (hash: string) => ({ ...web, hash, from: 'vr' });
r = await admin('POST', '/api/session/place', { place: web }, { 'x-bp-human': humanToken() });
check('the page arms the baton on the loopback mount', r.status === 201 && r.json.state === 'armed', r.body);
r = await lan(QUEST, 'GET', '/api/session/place?claim=1', { token: tokenA, headers: { 'x-bp-device': 'forged' } });
check('place: the headset claims; the door named the device from the token, not the header', r.status === 200 && r.json.state === 'claimed' && r.json.device === deviceA, r.body);
r = await lan(QUEST, 'POST', '/api/session/place', { token: tokenA, body: { place: vr('#at=scheduling.timetable') } });
check('place: the headset publishes its place: live', r.status === 200 && r.json.state === 'live', r.body);

// a second device, paired for place only
const NB = nonce();
const codeB = String((await lan(OTHER, 'POST', '/pair', { body: { nonce: NB, device: 'quest-b', scopes: ['place'] } })).json.code);
check('a second device asks while the window is open', /^[A-HJ-NP-Z2-9]{6}$/.test(codeB));
check('the owner narrows its lifetime to 1 day', (await admin('POST', '/lan/pair/approve', { code: codeB, days: 1 })).status === 200);
r = await lan(OTHER, 'POST', '/pair/claim', { body: { nonce: NB } });
const tokenB = String(r.json.token), deviceB = String(r.json.device);
check('the second device claims its own token', r.status === 200 && deviceB.startsWith('quest-b:') && deviceB !== deviceA, r.body);
refused('the place scope alone does not read the plan', await lan(OTHER, 'GET', '/api/products/kettle/plan', { token: tokenB }));
r = await lan(OTHER, 'POST', '/api/session/place', { token: tokenB, body: { place: vr('#at=hijack') }, headers: { 'x-bp-device': deviceA } });
check("a forged x-bp-device is dropped: the second device cannot write the first one's baton (the route's 403)", r.status === 403, r.body);
r = await lan(OTHER, 'POST', '/api/session/place/return', { token: tokenB, body: {}, headers: { 'x-bp-device': deviceA } });
check('...nor return it', r.status === 403, r.body);
r = await lan(OTHER, 'POST', '/api/session/place', { token: tokenB, body: { place: web, takeBack: true }, headers: { 'x-bp-human': humanToken() } });
check("a forwarded x-bp-human is dropped: a device cannot arm or take back as the page", r.status === 403, r.body);
r = await admin('GET', '/api/session/place');
check('the baton is still the first device\'s, at its own place', r.json.device === deviceA && (r.json.place as { hash?: string })?.hash === '#at=scheduling.timetable', r.body);
r = await lan(QUEST, 'POST', '/api/session/place/return', { token: tokenA, body: {} });
check('place: the headset returns the baton', r.status === 200 && r.json.state === 'returned', r.body);

// revoke, a corrupt registry, expiry
const idA = deviceA.split(':')[1];
check('pair revoke on the owner surface: 200', (await admin('POST', '/lan/pair/revoke', { id: idA })).status === 200);
refused('a revoked token, at its next request', await lan(QUEST, 'GET', '/api/products/kettle/structure', { token: tokenA }));
check('the revoked pairing is gone from paired.json; the other stays', readRegistry(HOME).map((p) => p.device).join() === 'quest-b');
const good = fs.readFileSync(registryFile(HOME), 'utf8');
fs.writeFileSync(registryFile(HOME), '{ not json');
refused('a corrupt registry admits nobody (fails closed, re-read per request)', await lan(OTHER, 'GET', '/api/session/place?claim=1', { token: tokenB }));
fs.writeFileSync(registryFile(HOME), good);
check('the registry restored: the device is admitted again', (await lan(OTHER, 'GET', '/api/session/place?claim=1', { token: tokenB })).status === 404);

// the ceremony's other ends: deny, the pending cap, the window
const ND = nonce();
const codeD = String((await lan(OTHER, 'POST', '/pair', { body: { nonce: ND, device: 'tablet' } })).json.code);
check('pair deny: 200', (await admin('POST', '/lan/pair/deny', { code: codeD })).status === 200);
refused('a denied request cannot claim', await lan(OTHER, 'POST', '/pair/claim', { body: { nonce: ND } }));
refused('a denied request cannot be re-registered into pending', await lan(OTHER, 'POST', '/pair', { body: { nonce: ND, device: 'tablet' } }));
for (let i = 0; i < 4; i++) await lan(OTHER, 'POST', '/pair', { body: { nonce: nonce(), device: `spam${i}` } });
refused('a fifth open request (the pending cap)', await lan(OTHER, 'POST', '/pair', { body: { nonce: nonce(), device: 'spam9' } }));
T += 3 * 60_000;
refused('a pairing request after the window closed', await lan(OTHER, 'POST', '/pair', { body: { nonce: nonce(), device: 'late' } }));
check('a live pairing keeps the door open after the window', (await door.converge(), door.listening));
T += 86_400_000;
refused('an expired token', await lan(OTHER, 'GET', '/api/session/place?claim=1', { token: tokenB }));
await door.converge();
check('nothing live and no window: the door closes its port', !door.listening);
r = await admin('POST', '/lan/pair/open', {});
check('pair open: a new window, and the door listens again', r.status === 200 && door.listening && typeof r.json.window === 'string', r.body);

// every refusal is the same bare 403, and the token is nowhere on disk
const sigs = new Set(refusals.map((x) => x.r.sig));
check(`every refusal (${refusals.length}) is byte-identical: a bare 403`, sigs.size === 1 && refusals.length > 25, [...sigs].join(' | '));
check('the bare 403 has no body and no content type', refusals[0].r.body === '' && JSON.parse(refusals[0].r.sig)[2] === null, refusals[0].r.sig);
const ledger = fs.readFileSync(path.join(HOME, 'ledger.jsonl'), 'utf8');
check('the ledger names each refusal\'s cause, where the caller cannot read it', ['"peer"', '"no-token"', '"unknown-token"', '"scope"', '"expired"', '"claim-unknown"'].every((c) => ledger.includes(c)));
check('the ledger records grant, claim, the theft alarm, deny and revoke', ['"approve"', '"claim"', '"claim-again"', '"deny"', '"revoke"'].every((e) => ledger.includes(`"event":${e}`)));
check('no token is in the ledger, the log or the registry', ![tokenA, tokenB].some((t) => ledger.includes(t) || logs.join('\n').includes(t) || fs.readFileSync(registryFile(HOME), 'utf8').includes(t)));
await door.stop();
await new Promise<void>((res) => { loop.close(() => res()); loop.closeAllConnections(); });

// ------------------------------------------------------------------------------------------------ opt-in, the real server
const MAIN = path.join(ROOT, 'apps/server/src/main.ts');
const REGISTER = pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href;
async function run(args: string[], home: string, until: RegExp | null, ms = 30_000): Promise<{ out: string; code: number | null; kill: () => void; match: RegExpExecArray | null }> {
  const child = spawn(process.execPath, ['--import', REGISTER, MAIN, ...args], { cwd: home, env: { ...process.env, BP_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve) => {
    const done = (match: RegExpExecArray | null) => { clearTimeout(timer); resolve({ out, code: child.exitCode, kill: () => child.kill(), match }); };
    const timer = setTimeout(() => { child.kill(); done(null); }, ms);
    const on = (d: Buffer) => { out += d; const m = until?.exec(out); if (m) done(m); };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.on('exit', () => setTimeout(() => done(until?.exec(out) ?? null), 50));
  });
}
const plainHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-lan-plain-'));
let p = await run(['--port', '0'], plainHome, /bp server listening on http:\/\/127\.0\.0\.1:(\d+)/);
await new Promise((res) => setTimeout(res, 300)); // anything the door would print comes right after the listening line
check('without --lan: the server starts as before', !!p.match, p.out.slice(-300));
check('without --lan: no door line, no /lan route', !/lan door|\/lan\//.test(p.out), p.out.split('\n').filter((l) => /lan/.test(l)).join(' | '));
check('without --lan: nothing under $BP_HOME/lan', !fs.existsSync(path.join(plainHome, 'lan')));
p.kill();
const lanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-lan-on-'));
p = await run(['--port', '0', '--lan', '--lan-host', '127.0.0.1', '--lan-port', '0'], lanHome, /lan door: listening on http:\/\/127\.0\.0\.1:(\d+)/);
check('with --lan: a pairing window and the door listening', !!p.match && /pairing window open/.test(p.out), p.out.slice(-400));
check('with --lan: the owner routes join the loopback mount', /route GET \/lan\/pair\b/.test(p.out) && /route POST \/lan\/pair\/approve/.test(p.out));
if (p.match) {
  const own = await send(Number(p.match[1]), 'GET', '/api/products/kettle/structure', {});
  check('the door refuses this machine (loopback is not a private range): the bare 403, at admission', own.sig === refusals[0].r.sig && own.ms < REFUSAL_DELAY_MS - 50, `${own.sig} ${own.ms.toFixed(0)} ms`);
  const loopPort = /bp server listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(p.out)?.[1];
  const cli = await run(['pair', 'list', '--port', String(loopPort)], lanHome, null);
  check('npm run server -- pair list reaches the owner routes', cli.code === 0 && /pairing window open until/.test(cli.out) && /nothing pending, nothing paired/.test(cli.out), cli.out);
}
p.kill();
p = await run(['--port', '0', '--lan-port', '3101'], plainHome, null);
check('--lan-port without --lan is refused, not ignored', p.code === 1 && /need --lan/.test(p.out), p.out);

console.log(`lan door: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
