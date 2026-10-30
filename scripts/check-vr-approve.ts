// Checks the VR approve (ROADMAP D12, owner 2026-10-31: "Pinching approve in VR should approve the target decisions"): the
// device verb POST /api/products/<slug>/proposals/<id>/approve, on a throwaway portfolio (scripts/morning-demo.mjs into a
// temp registry, plus scripts/brief-demo-seed.mjs --morning on kettle-web). Pins:
//   - the guards: a foreign Host 403, a non-JSON body 415, a body that is no object 400, no `x-bp-device` 400 (a device
//     call), BP_WRITES=off 403; an unknown proposal or product 404; nothing written by any of them;
//   - the pinch, through the real LAN door (apps/server/src/lan-door.ts) as a device paired with `decide` (named at
//     approve): 200, and the store's row is `approved`, signed and noted exactly as the web Morning Watch's Approve signs
//     and notes one (POST /api/companion/morning, verdict approve, the human path: the same `steer`); one steering-log row;
//   - no job is queued by it (the web deck's Approve queues none either: building stays a plan verb);
//   - a device paired without `decide` is refused at the door; a forged x-bp-device is dropped there;
//   - again: 409 (already approved); a repeat declined first through the decline verb: 409 (already declined);
//   - the morning deck keeps the card in its slot, marked approved.
// Run: node --import @bp/core/register scripts/check-vr-approve.ts. Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-vr-approve-'));
const REG = path.join(TMP, 'products.json');
Object.assign(process.env, { BP_PRODUCTS_FILE: REG, BP_HOME: path.join(TMP, 'home'), BP_GH_BIN: path.join(ROOT, 'scripts/fixtures/fake-gh.mjs'), BP_CLAUDE_BIN: path.join(ROOT, 'scripts/fixtures/fake-claude.mjs') });
delete process.env.BP_WRITES;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/morning-demo.mjs'), '--root', TMP], { encoding: 'utf8' });
const hist = spawnSync(process.execPath, [path.join(ROOT, 'scripts/brief-demo-seed.mjs'), '--dir', path.join(TMP, 'kettle-web'), '--morning'], { encoding: 'utf8' });
check('the portfolio and the labelled decision history seed into a temp registry', seed.status === 0 && hist.status === 0 && fs.existsSync(REG), seed.stderr + hist.stderr);

const { POST } = await import('../packages/core/src/server/api/products/[slug]/proposals/[id]/approve/route.ts');
const decline = await import('../packages/core/src/server/api/products/[slug]/proposals/[id]/decline/route.ts');
const morning = await import('../packages/core/src/server/api/companion/morning/route.ts');
const { humanToken } = await import('../packages/core/src/server/api/companion/door.server.ts');
const { HUMAN_HEADER } = await import('../packages/core/src/companion/contract.ts');
const jobs = await import('../packages/core/src/server/jobs.server.ts');
const { listener, loadRoutes } = await import('../apps/server/src/mount.ts');
const { LanDoor } = await import('../apps/server/src/lan-door.ts');
type Deck = import('../packages/core/src/companion/morning.ts').MorningDeck;

const at = (id: string, h: Record<string, string> = {}, body: string | undefined = '{}', slug = 'kettle-web') =>
  POST(new Request(`http://127.0.0.1:3413/api/products/${slug}/proposals/${id}/approve`, { method: 'POST', headers: { host: '127.0.0.1:3413', 'content-type': 'application/json', ...h }, body }),
    { params: Promise.resolve({ slug, id }) });
const DEV = { 'x-bp-device': 'vr-table' };
const deck = async (): Promise<Deck> => (await (await morning.GET(new Request('http://127.0.0.1:3413/api/companion/morning', { headers: { host: '127.0.0.1:3413' } }))).json()) as Deck;
const open = (await deck()).cards.filter((c) => c.product === 'kettle-web' && c.decision).map((c) => c.decision!.proposal);
check('the seed: kettle-web has the plain card, the repeat and a third open decision on the deck', ['find-kettle-web-1', 'brief-o2'].every((id) => open.includes(id)) && open.length >= 3, JSON.stringify(open));
// the web's twin: the third open card, approved by the Morning Watch's own Approve, signs the row the pinch must match
const twin = open.find((id) => id !== 'find-kettle-web-1' && id !== 'brief-o2')!;

const db = new DatabaseSync(path.join(TMP, 'kettle-web', '.ai', 'lens-scan', 'scan.db'), { readOnly: true });
type Row = { status: string; decided_by: string | null; decision_note: string | null };
const st = (id: string) => db.prepare('SELECT status, decided_by, decision_note FROM proposals WHERE id = ?').get(id) as Row;
const jobsBefore = jobs.list('kettle-web').length;

// the guards
let r = await at('find-kettle-web-1', { ...DEV, host: 'evil.example' });
check('a foreign Host: 403', r.status === 403, String(r.status));
r = await at('find-kettle-web-1', { ...DEV, 'content-type': 'text/plain' });
check('a body that does not say JSON: 415', r.status === 415, String(r.status));
r = await at('find-kettle-web-1', DEV, '[]');
check('a body that is not a JSON object: 400', r.status === 400, String(r.status));
r = await at('find-kettle-web-1');
check('no x-bp-device: 400, a device call', r.status === 400 && /x-bp-device/.test(await r.text()), String(r.status));
process.env.BP_WRITES = 'off';
r = await at('find-kettle-web-1', DEV);
check('BP_WRITES=off: 403', r.status === 403, String(r.status));
delete process.env.BP_WRITES;
r = await at('nope', DEV);
check('an unknown proposal: 404', r.status === 404);
r = await at('find-kettle-web-1', DEV, '{}', 'no-such-product');
check('an unknown product: 404', r.status === 404);
check('nothing written so far', st('find-kettle-web-1').status === 'proposed' && st(twin).status === 'proposed');

// the web Morning Watch's Approve on the twin: the row a person's approve leaves
const web = await morning.POST(new Request('http://127.0.0.1:3413/api/companion/morning', { method: 'POST', headers: { host: '127.0.0.1:3413', 'content-type': 'application/json', [HUMAN_HEADER]: humanToken() },
  body: JSON.stringify({ product: 'kettle-web', proposal: twin, verdict: 'approve' }) }));
check("the web deck's Approve on the twin: 200, approved", web.status === 200 && st(twin).status === 'approved', `${web.status} ${JSON.stringify(st(twin))}`);

// the pinch, through the LAN door, as a device paired with `decide`
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');
const routes = await loadRoutes(API);
const loop = http.createServer(listener(routes));
await new Promise<void>((res) => loop.listen(0, '127.0.0.1', () => res()));
const LOOP = (loop.address() as { port: number }).port;
const PEER = 'x-check-peer', QUEST = '192.168.1.50';
const door = new LanDoor({ routes, loopbackPort: LOOP, host: '127.0.0.1', port: 0, home: path.join(TMP, 'home', 'lan'), log: () => {},
  peerOf: (req) => { const p = req.headers[PEER]; return typeof p === 'string' ? p : req.socket.remoteAddress; } });
routes.push(...door.adminRoutes());
await door.start();
const send = (port: number, method: string, target: string, headers: Record<string, string>, body?: unknown) => new Promise<{ status: number; json: Record<string, unknown>; body: string }>((resolve, reject) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const q = http.request({ host: '127.0.0.1', port, method, path: target, headers: { ...headers, ...(text !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } : {}) } }, (res) => {
    const parts: Buffer[] = [];
    res.on('data', (b: Buffer) => parts.push(b));
    res.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); let json = {}; try { json = JSON.parse(b); } catch { /* not JSON */ } resolve({ status: res.statusCode ?? 0, json, body: b }); });
  });
  q.on('error', reject);
  if (text !== undefined) q.write(text);
  q.end();
});
const pair = async (device: string, scopes: string[]) => {
  const nonce = randomBytes(18).toString('base64url');
  const code = String((await send(door.port as number, 'POST', '/pair', { [PEER]: QUEST }, { nonce, device, scopes })).json.code);
  await send(LOOP, 'POST', '/lan/pair/approve', {}, { code, scopes });
  const claim = await send(door.port as number, 'POST', '/pair/claim', { [PEER]: QUEST }, { nonce });
  return { token: String(claim.json.token), scopes: claim.json.scopes as string[] };
};
const reader = await pair('quest-read', ['read']);
const noDecide = await send(door.port as number, 'POST', '/api/products/kettle-web/proposals/find-kettle-web-1/approve', { [PEER]: QUEST, authorization: `Bearer ${reader.token}` }, {});
check('a headset paired without decide: the door refuses the approve (bare 403), nothing written', noDecide.status === 403 && noDecide.body === '' && st('find-kettle-web-1').status === 'proposed', `${noDecide.status} ${noDecide.body}`);
const quest = await pair('quest3s', ['read', 'decide']);
check('a headset paired with decide, named at approve', quest.scopes.includes('decide'), JSON.stringify(quest.scopes));
const pinch = await send(door.port as number, 'POST', '/api/products/kettle-web/proposals/find-kettle-web-1/approve', { [PEER]: QUEST, authorization: `Bearer ${quest.token}`, 'x-bp-device': 'forged' }, {});
check('the pinch: approved through the door, as the paired device (the forged x-bp-device dropped)', pinch.status === 200 && pinch.json.verdict === 'approve' && pinch.json.proposal === 'find-kettle-web-1' && /^quest3s:[0-9a-f]{8}$/.test(String(pinch.json.device)), pinch.body);
const row = st('find-kettle-web-1'), webRow = st(twin);
check("the store's row is approved", row.status === 'approved', JSON.stringify(row));
check("...signed and noted as the web Morning Watch's Approve signs and notes one (the same steer)", row.decided_by === webRow.decided_by && row.decision_note === webRow.decision_note && row.decision_note === 'Morning Watch' && /^user:/.test(row.decided_by ?? ''), `${JSON.stringify(row)} vs ${JSON.stringify(webRow)}`);
check('...and the repeat is untouched', st('brief-o2').status === 'proposed');
check('no job queued: an approve starts no build (as the web deck)', jobs.list('kettle-web').length === jobsBefore && !jobs.list('kettle-web').some((j) => j.kind === 'execute'), JSON.stringify(jobs.list('kettle-web')));
r = await at('find-kettle-web-1', DEV);
check('a second pinch: 409, already approved', r.status === 409 && /already approved/.test(await r.text()));
// a decided row is not open: the repeat declined through the decline verb, then a pinch on its Approve
const dec = await decline.POST(new Request('http://127.0.0.1:3413/api/products/kettle-web/proposals/brief-o2/decline', { method: 'POST', headers: { host: '127.0.0.1:3413', 'content-type': 'application/json', ...DEV }, body: '{}' }),
  { params: Promise.resolve({ slug: 'kettle-web', id: 'brief-o2' }) });
r = await at('brief-o2', DEV);
check('a pinch on a declined repeat: 409, already declined, the decline stands', dec.status === 200 && r.status === 409 && /already declined/.test(await r.text()) && st('brief-o2').status === 'declined');
const steerLog = fs.readFileSync(path.join(TMP, 'kettle-web', '.ai', 'lens-scan', 'work', 'steering-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { proposal: string; verdict: string; note?: string });
const mine = steerLog.filter((x) => x.proposal === 'find-kettle-web-1');
check('one steering-log row for the pinch, verdict approve, as the deck writes', mine.length === 1 && mine[0].verdict === 'approve' && mine[0].note === undefined, JSON.stringify(steerLog));
const md = fs.readFileSync(path.join(TMP, 'kettle-web', '.ai', 'lens-scan', 'work', 'steering-log.md'), 'utf8');
check("the day's steering-log.md says it", /Approved/.test(md) && md.includes(pinch.json.title as string), md.slice(0, 400));
const after = await deck();
check('the morning deck keeps the card in its slot, marked approved', after.cards.find((c) => c.decision?.proposal === 'find-kettle-web-1')?.decision?.steered?.verdict === 'approve');
db.close();
await door.stop();
await new Promise<void>((res) => { loop.close(() => res()); loop.closeAllConnections(); });

try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows may still hold it: the OS cleans it */ }
console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed (vr approve)`);
process.exit(failed ? 1 : 0);
