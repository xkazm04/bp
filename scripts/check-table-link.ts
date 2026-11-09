// Checks table link v2 (docs/concepts/vr-light-table/table-link-v2.md; owner, 2026-11-09): the server side of stand-ups,
// scanners and decisions at the table. In-process, as check-lan-door.ts does: the real loopback mount (with apps/server's
// Bearer hook, device-auth.ts) and the real LAN door on ephemeral loopback ports, the door's peer read from a header this
// harness sets; a throwaway portfolio from scripts/morning-demo.mjs (BP_PRODUCTS_FILE, BP_HOME in a temp dir).
//   verbs      each new LAN verb is granted under the scope the doc names and refused without it (verbOf), and through
//              the real door a granted one reaches its route while an ungranted one is the bare 403
//   decisions  a Morning Watch verdict, a card answer and a policy grant succeed from a paired headset with `decide`, over
//              the LAN door and over the tether (a loopback Bearer), and are refused without it: a plain loopback call, a
//              forged x-bp-device, a forged seal header, a token without `decide`; each recorded decision carries surface
//              `vr` and the device, and a web decision carries `web`; a too-wide grant is refused 403 with the bound; a
//              table cannot answer a card that sets standing permissions; the revoke works
//   shots      Kettle's shots serve a PNG and refuse traversal
//   pairing    over the tether: /lan/where, /pair, the owner's approve, /pair/claim (202, 200 once, 410), /pair/me, a revoke
//              that turns the token into a 401; /api/health answers a boot id
// Run: node --import @bp/core/register scripts/check-table-link.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { harness } from './lib/expect.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-table-link-'));
const REG = path.join(TMP, 'products.json'), SHOTS = path.join(TMP, 'kettle-shots');
Object.assign(process.env, {
  BP_PRODUCTS_FILE: REG, BP_HOME: path.join(TMP, 'home'), BP_KETTLE_SHOTS: SHOTS,
  BP_GH_BIN: path.join(ROOT, 'scripts/fixtures/fake-gh.mjs'), BP_CLAUDE_BIN: path.join(ROOT, 'scripts/fixtures/fake-claude.mjs'),
});
delete process.env.BP_WRITES;
process.chdir(TMP);

const h = harness('check-table-link');
/** The harness's expect, named-first (the reading order of this file). */
const holds = (name: string, ok: boolean, detail = '') => h.expect(ok, name, detail);

const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/morning-demo.mjs'), '--root', TMP], { encoding: 'utf8' });
holds('morning-demo seeds a throwaway portfolio', seed.status === 0 && fs.existsSync(REG), seed.stderr);

const { listener, loadRoutes } = await import('../apps/server/src/mount.ts');
const { LanDoor, verbOf, SCOPES, readRegistry } = await import('../apps/server/src/lan-door.ts');
const { loopbackDevice } = await import('../apps/server/src/device-auth.ts');
const { hostKettleSims } = await import('../apps/server/src/kettle-sim.ts');
const { humanToken } = await import('../packages/core/src/server/api/companion/door.server.ts');
const { readDecisions, DECIDER_SEAL_HEADER, VR_POLICY_BOUND } = await import('../packages/core/src/server/decider.server.ts');

// ------------------------------------------------------------------------------------------------ verbs (the grammar)
type S = (typeof SCOPES)[number];
const others = (s: S | 'any'): S[] => SCOPES.filter((x) => x !== s && !(s === 'read' && x === 'standup'));
const K = '/api/products/kettle-web';
const VERB_TABLE: [S | 'any', string, string][] = [
  ['any', 'GET', '/api/health'],
  ['read', 'GET', '/api/products'],
  ['read', 'GET', '/api/products/kettle/shots/finding-kf-001.png'],
  ['read', 'GET', `${K}/shots/shots/run-1/home-dark-wide.png`],
  ['read', 'GET', `${K}/focuses`],
  ['read', 'GET', `${K}/scans`],
  ['standup', 'GET', '/api/companion/morning'],
  ['standup', 'GET', '/api/companion/morning?since=2026-11-09T06:00:00.000Z'],
  ['standup', 'GET', '/api/companion/morning?since=2026-11-09T06:00:00Z&opened=2026-11-09T07:00:00Z'],
  ['standup', 'GET', '/api/companion/inbox'],
  ['standup', 'GET', '/api/companion/inbox?limit=20'],
  ['standup', 'GET', '/api/companion/policies'],
  ['standup', 'POST', '/api/companion/listen'],
  ['standup', 'POST', '/api/companion/say'],
  ['decide', 'POST', '/api/companion/morning'],
  ['decide', 'POST', '/api/companion/cards/card_00abc123'],
  ['decide', 'POST', '/api/companion/policies'],
  ['decide', 'DELETE', '/api/companion/policies/pol_00abc123'],
  ['scan', 'POST', `${K}/scans`],
  ['scan', 'DELETE', `${K}/scans/j-12`],
];
for (const [scope, m, p] of VERB_TABLE) {
  if (scope === 'any') { holds(`${m} ${p}: any live pairing reaches it`, SCOPES.every((s) => verbOf([s], m, p) !== null)); continue; }
  holds(`${m} ${p}: granted under ${scope}`, verbOf([scope], m, p) !== null);
  const without = others(scope);
  holds(`${m} ${p}: refused without ${scope} (${without.join(',')})`, verbOf(without, m, p) === null);
}
for (const [m, p] of [['GET', '/api/companion/morning?view=agent'], ['GET', '/api/companion/morning?since=2026-11-09T06:00:00+01:00'], ['GET', '/api/companion/inbox?limit=1&x=2'],
  ['GET', '/api/products/kettle/shots/../structure'], ['GET', '/api/products/kettle/shots/a/b/c/d/e/f.png'], ['GET', '/api/products/kettle/shots/..%2Fx.png'],
  ['GET', '/api/companion/human-token'], ['POST', '/api/companion/policies/pol_1'], ['DELETE', '/api/companion/policies'], ['GET', '/lan/where'], ['POST', '/lan/pair/approve']] as const)
  holds(`no scope reaches ${m} ${p}`, verbOf([...SCOPES], m, p) === null);

// ------------------------------------------------------------------------------------------------ the servers
const HOME = path.join(TMP, 'home', 'lan');
hostKettleSims();
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');
const routes = await loadRoutes(API);
const loop = http.createServer(listener(routes, (a) => loopbackDevice(a, HOME)));
await new Promise<void>((r) => loop.listen(0, '127.0.0.1', () => r()));
const LOOP = (loop.address() as { port: number }).port;
const PEER = 'x-check-peer';
const door = new LanDoor({ routes, loopbackPort: LOOP, host: '127.0.0.1', port: 0, home: HOME, log: () => {}, peerOf: (req) => { const p = req.headers[PEER]; return typeof p === 'string' ? p : req.socket.remoteAddress; } });
routes.push(...door.adminRoutes());
await door.start();

interface Res { status: number; body: string; json: Record<string, unknown>; type: string; bytes: Buffer }
function send(port: number, method: string, target: string, headers: Record<string, string>, body?: unknown): Promise<Res> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, ...headers, ...(text !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } : {}) } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (b: Buffer) => parts.push(b));
      res.on('end', () => {
        const bytes = Buffer.concat(parts), b = bytes.toString('utf8');
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(b) as Record<string, unknown>; } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, body: b, json, type: String(res.headers['content-type'] ?? ''), bytes });
      });
    });
    req.on('error', reject);
    if (text !== undefined) req.write(text);
    req.end();
  });
}
const QUEST = '192.168.1.50';
const lan = (method: string, target: string, token: string, body?: unknown, headers: Record<string, string> = {}) => send(door.port as number, method, target, { [PEER]: QUEST, authorization: `Bearer ${token}`, ...headers }, body);
const tether = (method: string, target: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) => send(LOOP, method, target, { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body);
const nonce = () => randomBytes(18).toString('base64url');

/** Pair one device over the LAN door (or the tether) with the scopes the owner names; answers its token and device id. */
async function pair(device: string, scopes: S[], via: 'lan' | 'tether'): Promise<{ token: string; device: string }> {
  const n = nonce(), go = (p: string, b: unknown) => (via === 'lan' ? send(door.port as number, 'POST', p, { [PEER]: QUEST }, b) : tether('POST', p, null, b));
  const a = await go('/pair', { nonce: n, device, scopes });
  const ap = await tether('POST', '/lan/pair/approve', null, { code: a.json.code, scopes });
  const c = await go('/pair/claim', { nonce: n });
  if (a.status !== 201 || ap.status !== 200 || c.status !== 200) throw new Error(`pairing ${device}: ${a.status} ${ap.status} ${c.status} ${c.body}`);
  return { token: String(c.json.token), device: String(c.json.device) };
}

// ------------------------------------------------------------------------------------------------ pairing over the tether
let r = await tether('GET', '/lan/where', null);
holds('/lan/where (loopback): the door address and port, listening, the open window', r.status === 200 && (r.json.door as { address?: string })?.address === '127.0.0.1' && typeof (r.json.door as { port?: number })?.port === 'number' && r.json.listening === true && typeof r.json.window === 'string' && r.json.pairing === true, r.body);
r = await send(door.port as number, 'GET', '/lan/where', { [PEER]: QUEST });
holds('/lan/where is not a LAN verb: the bare 403', r.status === 403 && r.body === '');
const tn = nonce();
r = await tether('POST', '/pair', null, { nonce: tn, device: 'quest3s', scopes: ['standup', 'decide'] });
holds('tether: POST /pair answers 201 pending with a 6-character code', r.status === 201 && r.json.state === 'pending' && /^[A-Z2-9]{6}$/.test(String(r.json.code)), r.body);
const tcode = String(r.json.code);
r = await tether('POST', '/pair/claim', null, { nonce: tn });
holds('tether: the claim waits, 202 pending', r.status === 202 && r.json.state === 'pending', r.body);
r = await send(door.port as number, 'POST', '/pair/claim', { [PEER]: QUEST }, { nonce: tn });
holds('tether: a claim of the tether request from the LAN is refused (bound to its transport)', r.status === 403 && r.body === '');
r = await tether('POST', '/pair', null, { nonce: 'short', device: 'quest3s' });
holds('tether: a bad pairing body is 403 naming its cause', r.status === 403 && r.json.error === 'pairing refused: pair-body', r.body);
r = await tether('POST', '/lan/pair/approve', null, { code: tcode, scopes: ['standup', 'decide'] });
holds("tether: the owner's approve names decide and grants it", r.status === 200 && JSON.stringify(r.json.scopes) === '["standup","decide"]', r.body);
r = await tether('POST', '/pair/claim', null, { nonce: tn });
const T = { token: String(r.json.token), device: String(r.json.device) };
holds('tether: the claim answers the token once, with device and scopes', r.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(T.token) && /^quest3s:[0-9a-f]{8}$/.test(T.device), r.body.replace(T.token, '<token>'));
r = await tether('POST', '/pair/claim', null, { nonce: tn });
holds('tether: a second claim is 410 claimed', r.status === 410 && r.json.state === 'claimed', r.body);
r = await tether('GET', '/pair/me', T.token);
holds('tether: GET /pair/me names the pairing (never the token)', r.status === 200 && r.json.device === T.device && JSON.stringify(r.json.scopes) === '["standup","decide"]' && !r.body.includes(T.token), r.body);
r = await lan('GET', '/pair/me', T.token);
holds('the same token works on the LAN door: GET /pair/me', r.status === 200 && r.json.device === T.device, r.body);
holds('the token never rests in paired.json', !fs.readFileSync(path.join(HOME, 'paired.json'), 'utf8').includes(T.token));

// ------------------------------------------------------------------------------------------------ liveness
r = await tether('GET', '/api/health', null);
const boot = String(r.json.boot);
holds('GET /api/health: 200 { ok, boot, at }, no-store', r.status === 200 && r.json.ok === true && /^[0-9a-f]{16}$/.test(boot) && typeof r.json.at === 'string', r.body);
const P = await pair('quest-place', ['place'], 'lan');
r = await lan('GET', '/api/health', P.token);
holds('GET /api/health through the door: any live pairing (place only), the same boot', r.status === 200 && r.json.boot === boot, r.body);

// ------------------------------------------------------------------------------------------------ read and standup verbs through the door
const R = await pair('quest-read', ['read'], 'lan');
const U = await pair('quest-standup', ['standup'], 'lan');
const D = await pair('quest-decide', ['standup', 'decide', 'scan'], 'lan');
r = await lan('GET', '/api/products', R.token);
holds('read: GET /api/products reaches the route (the throwaway portfolio)', r.status === 200 && Array.isArray(JSON.parse(r.body)) && JSON.parse(r.body).length === 3, r.body.slice(0, 120));
r = await lan('GET', '/api/products', P.token);
holds('place only: GET /api/products is the bare 403', r.status === 403 && r.body === '');
r = await lan('GET', '/api/companion/morning?since=2026-11-01T00:00:00Z', U.token);
const deck = r.json as { cards?: { kind: string; product?: string; decision?: { proposal: string } }[] };
holds('standup: GET /api/companion/morning?since=... reaches the deck', r.status === 200 && Array.isArray(deck.cards) && deck.cards.length > 0, `${r.status} ${r.body.slice(0, 120)}`);
r = await lan('GET', '/api/companion/morning', R.token);
holds('read only: the morning deck is the bare 403', r.status === 403 && r.body === '');
r = await lan('GET', '/api/companion/inbox?limit=20', U.token);
holds('standup: GET /api/companion/inbox?limit=20', r.status === 200 && Array.isArray(r.json.items), `${r.status} ${r.body.slice(0, 120)}`);
r = await lan('GET', '/api/companion/policies', U.token);
holds('standup: GET /api/companion/policies', r.status === 200 && Array.isArray(JSON.parse(r.body)), r.body.slice(0, 120));
r = await lan('POST', '/api/companion/say', U.token, { text: 'x' });
holds('standup: POST /api/companion/say passes the door (the route lands separately: its answer, not the bare 403)', r.status !== 403 || r.body !== '', `${r.status} ${r.body.slice(0, 80)}`);
r = await lan('POST', '/api/companion/say', R.token, { text: 'x' });
holds('read only: POST /api/companion/say is the bare 403', r.status === 403 && r.body === '');

// ------------------------------------------------------------------------------------------------ scans (scan scope) on Kettle's sim
const scope = { kind: 'all', label: 'everything', features: [] };
r = await lan('POST', '/api/products/kettle/scans', D.token, { lens: 'development', scope });
const job = String(r.json.id ?? '');
holds('scan: POST .../scans starts a Kettle sim scan (202 ScanJob)', r.status === 202 && !!job, `${r.status} ${r.body.slice(0, 120)}`);
r = await lan('DELETE', `/api/products/kettle/scans/${job}`, U.token);
holds('without scan: DELETE .../scans/<job> is the bare 403', r.status === 403 && r.body === '');
r = await lan('DELETE', `/api/products/kettle/scans/${job}`, D.token);
holds('scan: DELETE .../scans/<job> cancels it (200 ScanJob)', r.status === 200 && r.json.id === job, `${r.status} ${r.body.slice(0, 120)}`);

// ------------------------------------------------------------------------------------------------ a person's decisions from the table
const decisions = (d: (typeof deck.cards & object)[number][] | undefined) => (d ?? []).filter((c) => c.kind === 'decision' && c.decision && c.product);
const [d0, d1, d2] = decisions(deck.cards);
holds('the deck has three decisions to steer', !!d0 && !!d1 && !!d2);
const shown = 'Approve? kettle-web: the top blocker (stop-ship). Pinch to approve.';
// refused without the marker
r = await tether('POST', '/api/companion/morning', null, { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve', shown });
holds('a plain loopback call (no token): the verdict is refused 403', r.status === 403 && /paired headset's token with the decide scope/.test(r.body), r.body);
r = await tether('POST', '/api/companion/morning', null, { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve', shown }, { 'x-bp-device': 'quest3s:deadbeef', [DECIDER_SEAL_HEADER]: 'f'.repeat(64) });
holds('a loopback call with a forged device and a forged seal: still 403', r.status === 403, r.body);
r = await tether('POST', '/api/companion/morning', 'A'.repeat(43), { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve', shown });
holds('a loopback call with an unknown token: 401, pair again', r.status === 401 && /pair again/.test(r.body), r.body);
r = await lan('POST', '/api/companion/morning', U.token, { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve', shown });
holds('LAN, standup without decide: the verdict is the bare 403', r.status === 403 && r.body === '');
r = await lan('POST', '/api/companion/morning', D.token, { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve' });
holds('LAN, decide but no shown: 400 (a decision from the table says what it showed)', r.status === 400 && /must say what it showed/.test(r.body), r.body);
// succeed with it
r = await lan('POST', '/api/companion/morning', D.token, { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve', shown }, { 'x-bp-device': 'forged:00000000' });
holds('LAN, decide: the morning verdict succeeds, recorded as vr with the paired device (a forged x-bp-device dropped)', r.status === 200 && r.json.surface === 'vr' && r.json.device === D.device && r.json.shown === shown && r.json.verdict === 'approve', r.body);
r = await tether('POST', '/api/companion/morning', T.token, { product: d1.product, proposal: d1.decision!.proposal, verdict: 'defer', shown });
holds('tether, decide: the morning verdict succeeds as vr with the tethered device', r.status === 200 && r.json.surface === 'vr' && r.json.device === T.device, r.body);
r = await tether('POST', '/api/companion/morning', null, { product: d2.product, proposal: d2.decision!.proposal, verdict: 'hold' }, { 'x-bp-human': humanToken() });
holds("the web page's verdict still works; its row keeps the plain SteerRow shape (no surface means the page)", r.status === 200 && r.json.surface === undefined && r.json.device === undefined, r.body);
const root0 = (JSON.parse(fs.readFileSync(REG, 'utf8')) as { products: { slug: string; root: string }[] }).products.find((p) => p.slug === d0.product)!.root;
const steerLog = fs.readFileSync(path.join(root0, '.ai', 'lens-scan', 'work', 'steering-log.jsonl'), 'utf8');
holds("the product's steering log row carries surface vr and the device", steerLog.includes(`"surface":"vr","device":"${D.device}"`), steerLog.slice(-300));
r = await tether('GET', '/api/companion/morning', null);
holds('the deck still answers after table verdicts (the steered rows keep the deck shape)', r.status === 200, r.body.slice(0, 120));

// cards
const fileCard = async (tool: string, args: unknown) => (await tether('POST', '/api/companion/cards', null, { tool, args })).json as { id: string; state: string };
const c1 = await fileCard('finding.decline', { slug: d2.product, id: d2.decision!.proposal, note: 'not now' });
const c2 = await fileCard('finding.decline', { slug: d2.product, id: d2.decision!.proposal, note: 'later' });
const c3 = await fileCard('policy.propose', { product: d2.product, tools: ['decision.answer'], hours: 2 });
holds('cards filed (pending) for the test', c1.state === 'pending' && c2.state === 'pending' && c3.state === 'pending', JSON.stringify([c1, c2, c3]));
r = await tether('POST', `/api/companion/cards/${c1.id}`, null, { decision: 'decline', shown: 'Decline this card?' });
holds('card answer without the marker: 403', r.status === 403, r.body);
r = await lan('POST', `/api/companion/cards/${c1.id}`, U.token, { decision: 'decline', shown: 'Decline this card?' });
holds('card answer, LAN without decide: the bare 403', r.status === 403 && r.body === '');
r = await lan('POST', `/api/companion/cards/${c1.id}`, D.token, { decision: 'decline', shown: 'Decline this card?' });
holds('card answer, LAN with decide: declined, decidedBy human, surface vr, the device', r.status === 200 && r.json.state === 'declined' && r.json.decidedBy === 'human' && r.json.surface === 'vr' && r.json.device === D.device, r.body);
r = await tether('POST', `/api/companion/cards/${c2.id}`, T.token, { decision: 'decline', shown: 'Decline this card?' });
holds('card answer, tether with decide: declined as vr', r.status === 200 && r.json.state === 'declined' && r.json.surface === 'vr' && r.json.device === T.device, r.body);
r = await lan('POST', `/api/companion/cards/${c3.id}`, D.token, { decision: 'approve', shown: 'Let it grant?' });
holds("a card that sets standing permissions (policy.propose): refused from the table, 403, stays pending", r.status === 403 && /answer it on bp's page/.test(r.body), r.body);
r = await tether('GET', '/api/companion/cards', null);
holds('...and it is still pending', (JSON.parse(r.body) as { id: string; state: string }[]).find((c) => c.id === c3.id)?.state === 'pending');

// policies
const grant = { product: d0.product, tools: ['decision.answer', 'scan.directed'], minTier: 1, hours: 4, shown: 'Let the companion approve tier 1+ decisions and run directed scans on kettle-web for 4 hours?' };
r = await tether('POST', '/api/companion/policies', null, grant);
holds('policy grant without the marker: 403', r.status === 403, r.body);
r = await lan('POST', '/api/companion/policies', U.token, grant);
holds('policy grant, LAN without decide: the bare 403', r.status === 403 && r.body === '');
for (const [why, wide] of [['every product (*)', { ...grant, product: '*' }], ['a release tool', { ...grant, tools: ['release.build'] }], ['no minTier', { ...grant, minTier: undefined }],
  ['minTier 0 (stop-ship)', { ...grant, minTier: 0 }], ['24 hours', { ...grant, hours: 24 }]] as const) {
  r = await lan('POST', '/api/companion/policies', D.token, wide);
  holds(`a too-wide grant from the table is refused 403 with the bound: ${why}`, r.status === 403 && /bounded/.test(r.body) && JSON.stringify(r.json.bound) === JSON.stringify(VR_POLICY_BOUND), `${r.status} ${r.body.slice(0, 160)}`);
}
r = await lan('POST', '/api/companion/policies', D.token, grant);
const g = r.json as { id: string; tools: string[]; minTier: number; product: string; createdAt: string; expiresAt: string; hours: number; grantedBy: { surface: string; device: string; shown: string } };
holds('policy grant, LAN with decide: 201, exactly what was granted and until when', r.status === 201 && JSON.stringify(g.tools) === '["decision.answer","scan.directed"]' && g.minTier === 1 && g.product === d0.product && g.hours === 4
  && Date.parse(g.expiresAt) - Date.parse(g.createdAt) === 4 * 3600e3 && g.grantedBy?.surface === 'vr' && g.grantedBy.device === D.device && g.grantedBy.shown === grant.shown, r.body);
r = await tether('POST', '/api/companion/policies', T.token, { ...grant, hours: 12 });
const g2 = r.json as { id: string; grantedBy?: { surface: string; device: string } };
holds('policy grant, tether with decide: 201 at the 12-hour edge, as vr', r.status === 201 && g2.grantedBy?.surface === 'vr' && g2.grantedBy.device === T.device, r.body);
r = await tether('POST', '/api/companion/policies', null, { product: '*', tools: ['release.build'], hours: 48 }, { 'x-bp-human': humanToken() });
holds("the web page keeps its wider grant (*, a release tool, 48 h)", r.status === 201 && (r.json.grantedBy as { surface?: string })?.surface === 'web', r.body);
r = await lan('DELETE', `/api/companion/policies/${g.id}`, U.token);
holds('policy revoke, LAN without decide: the bare 403', r.status === 403 && r.body === '');
r = await tether('DELETE', `/api/companion/policies/${g.id}`, null);
holds('policy revoke without the marker: 403', r.status === 403, r.body);
r = await lan('DELETE', `/api/companion/policies/${g.id}`, D.token);
holds('policy revoke, LAN with decide: 200 { id }', r.status === 200 && r.json.id === g.id, r.body);
r = await tether('DELETE', `/api/companion/policies/${g2.id}`, T.token);
holds('policy revoke, tether with decide: 200', r.status === 200 && r.json.id === g2.id, r.body);

// the record
const rec = readDecisions();
const vr = rec.filter((x) => x.surface === 'vr'), web = rec.filter((x) => x.surface === 'web');
holds('decisions.jsonl: every table decision is recorded as vr with its device', vr.length === 8 && vr.every((x) => x.device === D.device || x.device === T.device), JSON.stringify(rec.map((x) => [x.kind, x.surface, x.device])));
holds('decisions.jsonl: the kinds morning, card, policy-grant, policy-revoke from the table', ['morning', 'card', 'policy-grant', 'policy-revoke'].every((k) => vr.some((x) => x.kind === k)));
holds('decisions.jsonl: what the headset showed is kept', vr.filter((x) => x.kind !== 'policy-revoke').every((x) => typeof x.shown === 'string' && x.shown.length > 0));
holds('decisions.jsonl: the web decisions are told apart (surface web, no device)', web.length === 2 && web.every((x) => x.device === undefined));
holds('no refused decision left a record', rec.length === 10, String(rec.length));

// ------------------------------------------------------------------------------------------------ Kettle shots
fs.mkdirSync(SHOTS, { recursive: true });
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
fs.writeFileSync(path.join(SHOTS, 'finding-kf-001.png'), PNG);
fs.writeFileSync(path.join(SHOTS, 'note.svg'), '<svg/>');
fs.writeFileSync(path.join(TMP, 'secret.png'), PNG);
r = await tether('GET', '/api/products/kettle/shots/finding-kf-001.png', null);
holds('Kettle shots: a PNG from the sample shots (image/png, the bytes)', r.status === 200 && r.type === 'image/png' && r.bytes.equals(PNG), `${r.status} ${r.type}`);
r = await lan('GET', '/api/products/kettle/shots/finding-kf-001.png', R.token);
holds('Kettle shots through the door (read)', r.status === 200 && r.type === 'image/png' && r.bytes.equals(PNG), `${r.status} ${r.type}`);
r = await tether('GET', '/api/products/kettle/shots/%2E%2E/secret.png', null);
holds('Kettle shots: an escaped dot segment never serves the file (the URL layer folds it: no route)', r.status === 404 && !r.bytes.equals(PNG), `${r.status} ${r.body}`);
for (const t of ['/api/products/kettle/shots/..%2Fsecret.png', '/api/products/kettle/shots/x/..%2F..%2Fsecret.png', '/api/products/kettle/shots/x/..%5C..%5Csecret.png']) {
  r = await tether('GET', t, null);
  holds(`Kettle shots refuse traversal: ${t}`, r.status === 403 && /outside the shots directory/.test(r.body), `${r.status} ${r.body}`);
}
r = await tether('GET', '/api/products/kettle/shots/note.svg', null);
holds('Kettle shots: an svg is 415 not an image', r.status === 415, `${r.status}`);
r = await tether('GET', '/api/products/kettle/shots/none.png', null);
holds('Kettle shots: a missing file is 404', r.status === 404, `${r.status}`);
delete process.env.BP_KETTLE_SHOTS;
const { kettleShotsDir } = await import('../packages/core/src/server/products.server.ts');
holds('Kettle shots default to apps/web/public/sample-shots', kettleShotsDir('kettle') === path.join(ROOT, 'apps', 'web', 'public', 'sample-shots'), String(kettleShotsDir('kettle')));

// ------------------------------------------------------------------------------------------------ revoke
const tid = T.device.split(':')[1];
r = await tether('POST', '/lan/pair/revoke', null, { id: tid });
holds('the owner revokes the tethered pairing', r.status === 200, r.body);
r = await tether('GET', '/pair/me', T.token);
holds('after the revoke, GET /pair/me on the tether: 401 pair again', r.status === 401 && /pair again/.test(r.body), r.body);
r = await tether('GET', '/api/health', T.token);
holds('after the revoke, any tether request with that token: 401', r.status === 401, r.body);
r = await lan('GET', '/pair/me', T.token);
holds('after the revoke, GET /pair/me on the LAN: the bare 403', r.status === 403 && r.body === '');
holds('the registry no longer holds it', !readRegistry(HOME).some((p) => p.id === tid));

await door.stop();
await new Promise<void>((res) => { loop.close(() => res()); loop.closeAllConnections(); });
process.chdir(ROOT);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* a handle Windows still holds: the temp dir is the OS's to sweep */ }
h.done({ exit: true });
