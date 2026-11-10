// Checks bp's Headsets page routes (apps/server/src/headsets.ts) and the decision log reader
// (packages/core/src/server/api/companion/decisions/route.ts); docs/concepts/vr-light-table/table-link-v2.md section 13.
// In-process: the real loopback mount (with the server's device hook, so a Bearer earns the device overlay and the decider
// seal exactly as on :3100), the headsets routes over a door switch shaped like main.ts's (off, then attached as --pair,
// then widened to Wi-Fi), and the real LanDoor on ephemeral loopback ports. It holds:
//   the gate     every headsets route refuses without the page's human token (403), with a wrong one, with a foreign Host,
//                a cross-site Origin, or a non-JSON write (415); a request carrying a paired headset's Bearer (a decide
//                pairing: the seal rides along) or x-bp-device is refused even WITH the human token; the routes are no LAN verb
//   off          the door is off: the page sees paired rows from disk, open/approve answer 409, revoke still works
//   ceremony     a headset asks over the cable; GET never carries the code or the nonce (asserted on the serialized body
//                while the request is pending); a wrong code is refused 404 after the door's fixed delay and counted; the
//                typed right code pairs, the scopes the page ticked are what the token holds, and the headset claims it
//   seal         the paired decide headset grants a policy and answers a stand-up card through the existing routes: both land
//                in the decision log as `vr` with the words shown, and in the grants list with grantedBy
//   decisions    the reader needs bp's own page (Sec-Fetch), filters by surface and device, refuses an unknown filter, says
//                how many matched, and never serves more than 200 rows
//   revoke       the page's revoke cuts the device (its Bearer is 401 at once); a decline by id refuses the claim
//   limit        5 wrong codes cancel every open request and shut the window; the right code then pairs nothing
//   wifi         the switch widens a cable-only door to the Wi-Fi listener
// Run: node --import @bp/core/register scripts/check-headsets.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { harness } from './lib/expect.ts';
import { listener, loadRoutes } from '../apps/server/src/mount.ts';
import { LanDoor, MAX_WRONG_CODES, REFUSAL_DELAY_MS, SCOPES, verbOf, registryFile } from '../apps/server/src/lan-door.ts';
import { loopbackDevice } from '../apps/server/src/device-auth.ts';
import { headsetGate, headsetRoutes, type DoorMode, type DoorSwitch } from '../apps/server/src/headsets.ts';
import { humanToken } from '../packages/core/src/server/api/companion/door.server.ts';
import { deciderSeal, DECIDER_SEAL_HEADER } from '../packages/core/src/server/decider.server.ts';

const { expect, done } = harness('check-headsets');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-headsets-'));
process.env.BP_HOME = tmp;
process.chdir(tmp); // no products file: Kettle answers from the built-in sample
const HOME = path.join(tmp, 'lan');
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');
const routes = await loadRoutes(API);
const loop = http.createServer(listener(routes, (a) => loopbackDevice(a, HOME)));
await new Promise<void>((r) => loop.listen(0, '127.0.0.1', () => r()));
const LOOP = (loop.address() as { port: number }).port;
const logs: string[] = [];

// the switch, shaped like main.ts's switchDoorOn: attach as --pair (or --lan), or widen a cable-only door
let door: LanDoor | null = null;
let mode: DoorMode = 'off';
const sw: DoorSwitch = {
  door: () => door, mode: () => mode, started: 'off', home: HOME,
  wifiAt: () => ({ address: '127.0.0.1', port: 0 }),
  switchOn: async (m) => {
    if (mode === 'lan' || mode === m) return null;
    if (!door) {
      door = new LanDoor({ routes, loopbackPort: LOOP, host: '127.0.0.1', port: 0, home: HOME, lan: m === 'lan', log: (s) => logs.push(s) });
      routes.push(...door.adminRoutes());
      await door.start();
    } else await door.widen('127.0.0.1', 0);
    mode = m;
    return null;
  },
};
routes.push(...headsetRoutes(sw));

interface Res { status: number; body: string; json: Record<string, unknown>; ms: number }
function send(method: string, target: string, headers: Record<string, string> = {}, body?: unknown): Promise<Res> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: LOOP, method, path: target, headers: { host: `127.0.0.1:${LOOP}`, ...(text !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } : {}), ...headers } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (b: Buffer) => parts.push(b));
      res.on('end', () => {
        const b = Buffer.concat(parts).toString('utf8');
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(b) as Record<string, unknown>; } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, body: b, json, ms: performance.now() - t0 });
      });
    });
    req.on('error', reject);
    if (text !== undefined) req.write(text);
    req.end();
  });
}
const HUMAN = { 'x-bp-human': humanToken() };
const PAGE = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' };
/** A call as bp's own page: the human token, the browser's same-origin marks. */
const page = (method: string, p: string, body?: unknown, more: Record<string, string> = {}) => send(method, '/api/companion/headsets' + p, { ...HUMAN, ...PAGE, ...more }, body);
const nonce = () => randomBytes(18).toString('base64url');
const tether = (p: string, body: unknown) => send('POST', p, {}, body);
type State = { door: string; window: string | null; pending: { id: string; device: string; peer: string; state: string; requested: string[] }[]; paired: { id: string; device: string; scopes: string[] }[]; wrongCodes: { count: number; limit: number }; wifi: { listening: boolean } | null };
const state = async () => (await page('GET', '')).json as unknown as State;

// ------------------------------------------------------------------------------------------------ the gate (door off)
let r = await send('GET', '/api/companion/headsets', PAGE);
expect(r.status === 403 && /x-bp-human/.test(String(r.json.error)), 'GET without the human token: 403', `${r.status} ${r.body}`);
r = await send('GET', '/api/companion/headsets', { 'x-bp-human': 'f'.repeat(64) });
expect(r.status === 403, 'GET with a wrong human token: 403', r.status);
for (const n of ['open', 'approve', 'deny', 'revoke', 'door']) {
  r = await send('POST', `/api/companion/headsets/${n}`, {}, {});
  expect(r.status === 403, `POST ${n} without the human token: 403`, `${r.status} ${r.body}`);
}
r = await page('GET', '', undefined, { host: 'evil.example' });
expect(r.status === 403, 'a foreign Host (DNS rebinding): 403, token or not', r.status);
r = await page('POST', '/open', {}, { origin: 'http://evil.example' });
expect(r.status === 403, 'a cross-site Origin: 403', r.status);
r = await send('POST', '/api/companion/headsets/open', { ...HUMAN, 'content-type': 'text/plain' });
expect(r.status === 415, 'a write that is not JSON: 415', `${r.status} ${r.body}`);
r = await page('GET', '', undefined, { 'x-bp-device': 'quest3s:0badc0de' });
expect(r.status === 403 && /headset cannot/.test(String(r.json.error)), 'a request naming a device (x-bp-device) is refused even with the human token', r.body);
expect(verbOf([...SCOPES], 'GET', '/api/companion/headsets') === null && ['open', 'approve', 'deny', 'revoke', 'door'].every((n) => verbOf([...SCOPES], 'POST', `/api/companion/headsets/${n}`) === null),
  'no scope reaches a headsets route through the LAN door');
const sealed = new Request('http://127.0.0.1/api/companion/headsets', { headers: { host: '127.0.0.1', ...HUMAN, [DECIDER_SEAL_HEADER]: deciderSeal() } });
expect(headsetGate(sealed)?.status === 403, 'the gate refuses a request carrying the decider seal, even with the human token');

let s = await state();
expect(s.door === 'off' && s.window === null && s.pending.length === 0 && s.paired.length === 0, 'door off: the page sees it off, nothing pending, nothing paired', JSON.stringify(s));
r = await page('POST', '/open', {});
expect(r.status === 409, 'door off: opening pairing is 409 (switch it on first)', `${r.status} ${r.body}`);
r = await page('POST', '/approve', { code: 'ABCDEF', scopes: ['read'], days: 1 });
expect(r.status === 409, 'door off: approve is 409', r.status);

// ------------------------------------------------------------------------------------------------ switched on, the ceremony
r = await page('POST', '/door', { mode: 'pair' });
s = r.json as unknown as State;
expect(r.status === 200 && s.door === 'pair' && typeof s.window === 'string' && s.wifi === null, 'the switch attaches the door as --pair: a window opens, no Wi-Fi', r.body);
const ledgerText = () => { try { return fs.readFileSync(path.join(HOME, 'ledger.jsonl'), 'utf8'); } catch { return ''; } };
const NA = nonce();
r = await tether('/pair', { nonce: NA, device: 'quest3s', scopes: ['standup', 'place', 'focus', 'decide', 'scan'] });
const codeA = String(r.json.code);
expect(r.status === 201 && /^[A-Z2-9]{6}$/.test(codeA), 'a headset asks over the cable: 201 and its code', r.body);
r = await page('GET', '');
s = r.json as unknown as State;
expect(r.status === 200 && s.pending.length === 1 && s.pending[0].device === 'quest3s' && s.pending[0].peer === 'loopback' && s.pending[0].requested.includes('decide'), 'GET lists the request: claimed name, peer, the scopes it asked for', r.body);
expect(!r.body.includes(codeA) && !r.body.includes(NA), 'GET never carries the pairing code or the nonce (serialized body, request pending)');
expect(!/"code"/.test(r.body), 'GET has no code field at all');
const wrong = codeA === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
r = await page('POST', '/approve', { code: wrong, scopes: ['read'], days: 1 });
expect(r.status === 404 && (r.json.wrong as { count: number }).count === 1 && /tries left/.test(String(r.json.error)), 'a wrong code: 404, said in words, counted', r.body);
expect(r.ms >= REFUSAL_DELAY_MS - 5, 'a wrong code answers after the door\'s fixed delay', `${r.ms.toFixed(0)} ms`);
s = await state();
expect(s.wrongCodes.count === 1 && s.wrongCodes.limit === MAX_WRONG_CODES && s.pending.length === 1, 'the count shows on the page; the request is still open', JSON.stringify(s.wrongCodes));
expect(/"event":"wrong-code"/.test(ledgerText()) && !ledgerText().includes(wrong) && !ledgerText().includes(codeA), 'the ledger records the wrong code as an event, never a code');
r = await page('POST', '/approve', { code: codeA, scopes: [], days: 7 });
expect(r.status === 400, 'approve with no permission ticked: 400', r.status);
r = await page('POST', '/approve', { code: codeA, scopes: ['standup', 'decide'], days: 31 });
expect(r.status === 400, 'approve past 30 days: 400', r.status);
r = await page('POST', '/approve', { code: codeA.toLowerCase(), scopes: ['standup', 'decide'], days: 7 });
expect(r.status === 200 && JSON.stringify(r.json.scopes) === '["standup","decide"]' && r.json.peer === 'loopback', 'the typed right code approves with the permissions the page ticked', r.body);
expect(/"event":"approve".*"by":"page"/.test(ledgerText()), 'the ledger says the page approved it');
r = await tether('/pair/claim', { nonce: NA });
const tokenA = String(r.json.token), devA = String(r.json.device);
expect(r.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(tokenA) && JSON.stringify(r.json.scopes) === '["standup","decide"]', 'the headset claims its token: the scopes the page granted, not what it asked', r.body.replace(tokenA, '<token>'));
const idA = devA.split(':')[1];
r = await page('GET', '');
s = r.json as unknown as State;
const fp = (JSON.parse(fs.readFileSync(registryFile(HOME), 'utf8')) as { pairings: { fingerprint: string }[] }).pairings[0].fingerprint;
expect(s.paired.length === 1 && s.paired[0].id === idA && s.paired[0].device === devA && s.pending.length === 0, 'the page lists the pairing', r.body);
expect(!r.body.includes(tokenA) && !r.body.includes(fp), 'GET never carries the token or its fingerprint');

// a paired decide headset (its Bearer earns the seal) cannot manage headsets, even holding the page's token
const bearer = { authorization: `Bearer ${tokenA}` };
r = await page('GET', '', undefined, bearer);
expect(r.status === 403 && /headset cannot/.test(String(r.json.error)), 'a decide headset\'s Bearer (the seal rides along) is refused, even with the human token', `${r.status} ${r.body}`);
r = await page('POST', '/revoke', { id: idA }, bearer);
expect(r.status === 403, 'a headset cannot revoke through the page routes', r.status);
r = await send('POST', '/api/companion/headsets/approve', bearer, { code: codeA, scopes: ['read'], days: 1 });
expect(r.status === 403, 'a headset\'s Bearer alone is refused', r.status);

// ------------------------------------------------------------------------------------------------ what the table did
r = await send('POST', '/api/companion/policies', bearer, { product: 'kettle', tools: ['decision.answer'], minTier: 1, hours: 4, shown: 'Let it approve tier 1+ on Kettle for 4 hours?' });
const grantId = String(r.json.id);
expect(r.status === 201 && (r.json.grantedBy as { surface: string; device: string }).surface === 'vr' && (r.json.grantedBy as { device: string }).device === devA, 'the headset grants a policy with its seal: 201, granted by vr', r.body);
r = await send('POST', '/api/companion/policies', HUMAN, { product: 'kettle', tools: ['finding.decline'], hours: 2 });
expect(r.status === 201, 'the page grants one too (surface web)', r.body);
r = await send('DELETE', `/api/companion/policies/${grantId}`, bearer);
expect(r.status === 200, 'the headset revokes its grant', r.body);
r = await send('GET', '/api/companion/decisions', PAGE);
const all = r.json as { rows: { kind: string; surface: string; device?: string; shown?: string; target: string }[]; matched: number; total: number; limit: number; recorded: boolean };
expect(r.status === 200 && all.recorded && all.matched === 3 && all.rows[0].kind === 'policy-revoke', 'the log: three decisions, newest first', r.body.slice(0, 300));
r = await send('GET', '/api/companion/decisions?surface=vr', PAGE);
const vr = r.json as typeof all;
expect(vr.matched === 2 && vr.rows.every((x) => x.surface === 'vr' && x.device === devA), 'filtered to vr: only the headset\'s, with its device', r.body.slice(0, 300));
expect(vr.rows.some((x) => x.kind === 'policy-grant' && x.shown === 'Let it approve tier 1+ on Kettle for 4 hours?'), 'the grant row keeps the words the headset showed');
r = await send('GET', '/api/companion/decisions?surface=web', PAGE);
expect((r.json as typeof all).matched === 1 && (r.json as typeof all).rows.every((x) => x.surface === 'web'), 'filtered to web: only the page\'s', r.body.slice(0, 200));
r = await send('GET', `/api/companion/decisions?device=${encodeURIComponent(devA)}`, PAGE);
expect((r.json as typeof all).matched === 2, 'filtered by device', r.body.slice(0, 200));
r = await send('GET', '/api/companion/decisions');
expect(r.status === 403, 'the log needs bp\'s own page (Sec-Fetch): 403 without', r.status);
for (const q of ['surface=all', 'surface=VR', 'device=quest3s', 'limit=-1', 'limit=1000'])
  { r = await send('GET', `/api/companion/decisions?${q}`, PAGE); expect(r.status === 400, `an unknown filter is 400: ${q}`, `${r.status} ${r.body}`); }
// the cap: 250 more rows, a limit past the cap
const extra = Array.from({ length: 250 }, (_, i) => JSON.stringify({ at: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 1000).toISOString(), kind: 'morning', surface: 'web', product: 'kettle', target: `p${i}`, verdict: 'defer' })).join('\n') + '\n';
fs.appendFileSync(path.join(tmp, 'companion', 'decisions.jsonl'), extra + '{"torn\n');
r = await send('GET', '/api/companion/decisions?limit=999', PAGE);
expect(r.status === 200 && (r.json.rows as unknown[]).length === 200 && r.json.matched === 253 && r.json.limit === 200 && r.json.unreadable === 1, 'never past the cap: 200 rows of 253, a torn line counted', `${r.status} ${(r.json.rows as unknown[] | undefined)?.length} ${r.json.matched} ${r.json.unreadable}`);
r = await send('GET', '/api/companion/decisions', PAGE);
expect((r.json.rows as unknown[]).length === 100 && r.json.limit === 100, 'the default is the newest 100', `${(r.json.rows as unknown[]).length}`);
r = await send('GET', '/api/companion/policies');
expect(Array.isArray(r.json) || (r.status === 200 && r.body.startsWith('[')), 'the grants list answers', r.status);

// ------------------------------------------------------------------------------------------------ revoke, decline
r = await page('POST', '/revoke', { id: idA });
expect(r.status === 200, 'the page revokes the headset', r.body);
r = await send('GET', '/api/health', bearer);
expect(r.status === 401, 'the revoked headset\'s next request is 401 at once', `${r.status} ${r.body}`);
expect((await state()).paired.length === 0 && /"event":"revoke".*"by":"page"/.test(ledgerText()), 'gone from the page; the ledger says the page revoked it');
r = await page('POST', '/open', {});
expect(r.status === 200 && typeof (r.json as unknown as State).window === 'string', 'the page opens pairing again', r.body);
const NB = nonce();
await tether('/pair', { nonce: NB, device: 'quest3s' });
const idB = (await state()).pending[0]?.id;
r = await page('POST', '/deny', { id: idB });
expect(r.status === 200, 'the page declines a request by its id', r.body);
r = await tether('/pair/claim', { nonce: NB });
expect(r.status === 403 && /claim-denied/.test(String(r.json.error)), 'the declined headset\'s claim is refused', r.body);

// ------------------------------------------------------------------------------------------------ the wrong-code limit
const NC = nonce();
r = await tether('/pair', { nonce: NC, device: 'quest3s', scopes: ['read'] });
const codeC = String(r.json.code);
const bad = ['ZZZZZ2', 'ZZZZZ3', 'ZZZZZ4', 'ZZZZZ5', 'ZZZZZ6'].filter((c) => c !== codeC).slice(0, MAX_WRONG_CODES);
let last: Res | null = null;
for (const c of bad) last = await page('POST', '/approve', { code: c, scopes: ['read'], days: 1 });
s = await state();
expect(last?.status === 404 && /every open request was cancelled/.test(String(last.json.error)), `${MAX_WRONG_CODES} wrong codes: every open request is cancelled, said in words`, last?.body);
expect(s.pending.length === 0 && s.window === null && s.wrongCodes.count === 0, 'nothing is pending and pairing is shut', JSON.stringify(s));
r = await page('POST', '/approve', { code: codeC, scopes: ['read'], days: 1 });
expect(r.status === 404, 'the right code now pairs nothing', r.status);
r = await tether('/pair/claim', { nonce: NC });
expect(r.status === 403, 'and the cancelled headset\'s claim is refused', r.body);
expect(/"event":"wrong-code-limit"/.test(ledgerText()), 'the ledger records the limit');

// ------------------------------------------------------------------------------------------------ Wi-Fi on
r = await page('POST', '/open', {});
r = await page('POST', '/door', { mode: 'lan' });
s = r.json as unknown as State;
expect(r.status === 200 && s.door === 'lan' && s.wifi?.listening === true && sw.door()?.listening === true, 'the switch widens the cable-only door to Wi-Fi: the listener is up', r.body);
r = await page('POST', '/door', { mode: 'off' });
expect(r.status === 400, 'the switch never turns the door off (a restart does)', r.status);
expect(!logs.join('\n').includes(codeA) && !logs.join('\n').includes(codeC), 'the server log never carries a code');

await sw.door()?.stop();
loop.close();
loop.closeAllConnections();
process.chdir(os.tmpdir());
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a scratch dir: the OS cleans it */ }
done({ exit: true });
