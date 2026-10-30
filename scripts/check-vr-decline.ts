// Checks the VR decline (ROADMAP F8, owner 2026-10-30: "pinching decline should decline"): the device verb
// POST /api/products/<slug>/proposals/<id>/decline, on a throwaway portfolio (scripts/morning-demo.mjs into a temp registry,
// plus scripts/brief-demo-seed.mjs --morning on kettle-web: brief-o2 re-files brief-h7's declined idea, brief-o4 is only
// like it). Pins:
//   - the guards: a foreign Host 403, a non-JSON body 415, no `x-bp-device` 400 (a device call), BP_WRITES=off 403;
//   - Decline only on a repeat: the like idea and a plain card are 409, nothing written;
//   - the repeat, through the real LAN door (apps/server/src/lan-door.ts) as a device paired with `decide` (named at
//     approve): 200, and the store's row is `declined` with the card brief's note (`Repeats brief-h7, declined <day>: ...`),
//     the same note the web deck's Decline writes (cardBrief, companion/morning.ts); one steering-log row;
//   - again: 409 (already declined); the morning deck keeps it in its slot, marked declined.
// Run: node --import @bp/core/register scripts/check-vr-decline.ts. Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-vr-decline-'));
const REG = path.join(TMP, 'products.json');
Object.assign(process.env, { BP_PRODUCTS_FILE: REG, BP_HOME: path.join(TMP, 'home'), BP_GH_BIN: path.join(ROOT, 'scripts/fixtures/fake-gh.mjs'), BP_CLAUDE_BIN: path.join(ROOT, 'scripts/fixtures/fake-claude.mjs') });
delete process.env.BP_WRITES;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/morning-demo.mjs'), '--root', TMP], { encoding: 'utf8' });
const hist = spawnSync(process.execPath, [path.join(ROOT, 'scripts/brief-demo-seed.mjs'), '--dir', path.join(TMP, 'kettle-web'), '--morning'], { encoding: 'utf8' });
check('the portfolio and the labelled decision history seed into a temp registry', seed.status === 0 && hist.status === 0 && fs.existsSync(REG), seed.stderr + hist.stderr);

const { POST } = await import('../packages/core/src/server/api/products/[slug]/proposals/[id]/decline/route.ts');
const morning = await import('../packages/core/src/server/api/companion/morning/route.ts');
const { listener, loadRoutes } = await import('../apps/server/src/mount.ts');
const { LanDoor } = await import('../apps/server/src/lan-door.ts');
type Deck = import('../packages/core/src/companion/morning.ts').MorningDeck;

const at = (id: string, h: Record<string, string> = {}, body: string | undefined = '{}') =>
  POST(new Request(`http://127.0.0.1:3413/api/products/kettle-web/proposals/${id}/decline`, { method: 'POST', headers: { host: '127.0.0.1:3413', 'content-type': 'application/json', ...h }, body }),
    { params: Promise.resolve({ slug: 'kettle-web', id }) });
const DEV = { 'x-bp-device': 'vr-table' };
const deck = async (): Promise<Deck> => (await (await morning.GET(new Request('http://127.0.0.1:3413/api/companion/morning', { headers: { host: '127.0.0.1:3413' } }))).json()) as Deck;
const rep = (await deck()).cards.find((c) => c.decision?.proposal === 'brief-o2')?.decision?.brief;
check('the seed: brief-o2 repeats a decline, and its card recommends Decline with the note', rep?.recommend === 'decline' && /^Repeats brief-h7, declined \d{4}-\d\d-\d\d: "/.test(rep?.note ?? ''), JSON.stringify(rep));

const db = new DatabaseSync(path.join(TMP, 'kettle-web', '.ai', 'lens-scan', 'scan.db'), { readOnly: true });
const st = (id: string) => db.prepare('SELECT status, decision_note FROM proposals WHERE id = ?').get(id) as { status: string; decision_note: string | null };

// the guards
let r = await at('brief-o2', { ...DEV, host: 'evil.example' });
check('a foreign Host: 403', r.status === 403, String(r.status));
r = await at('brief-o2', { ...DEV, 'content-type': 'text/plain' });
check('a body that does not say JSON: 415', r.status === 415, String(r.status));
r = await at('brief-o2');
check('no x-bp-device: 400, a device call', r.status === 400 && /x-bp-device/.test(await r.text()), String(r.status));
process.env.BP_WRITES = 'off';
r = await at('brief-o2', DEV);
check('BP_WRITES=off: 403', r.status === 403, String(r.status));
delete process.env.BP_WRITES;
// only a repeat
r = await at('brief-o4', DEV);
check('the like idea (ask): 409, the plan keeps the free Decline', r.status === 409 && /does not repeat a declined idea/.test(await r.text()));
r = await at('find-kettle-web-1', DEV);
check('a card with no decline behind it: 409', r.status === 409);
r = await at('nope', DEV);
check('an unknown proposal: 404', r.status === 404);
check('nothing written so far', st('brief-o2').status === 'proposed' && st('brief-o4').status === 'proposed' && st('find-kettle-web-1').status === 'proposed');

// the repeat, through the LAN door, as a device paired with `decide`
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
const nonce = randomBytes(18).toString('base64url');
const code = String((await send(door.port as number, 'POST', '/pair', { [PEER]: QUEST }, { nonce, device: 'quest3s', scopes: ['read', 'decide'] })).json.code);
const ok = await send(LOOP, 'POST', '/lan/pair/approve', {}, { code, scopes: ['read', 'decide'] });
const claim = await send(door.port as number, 'POST', '/pair/claim', { [PEER]: QUEST }, { nonce });
const token = String(claim.json.token);
check('a headset paired with decide, named at approve', ok.status === 200 && claim.status === 200 && (claim.json.scopes as string[]).includes('decide'), claim.body.slice(0, 200));
const brief = await send(door.port as number, 'GET', '/api/products/kettle-web/proposals/brief-o2/brief', { [PEER]: QUEST, authorization: `Bearer ${token}` });
check('the headset reads the brief through the door (F7): the same lines the deck shows', brief.status === 200 && JSON.stringify(brief.json.lines) === JSON.stringify(rep?.lines), brief.body.slice(0, 200));
const dec = await send(door.port as number, 'POST', '/api/products/kettle-web/proposals/brief-o2/decline', { [PEER]: QUEST, authorization: `Bearer ${token}`, 'x-bp-device': 'forged' }, {});
check('the pinch: the repeat declined through the door, as the paired device', dec.status === 200 && dec.json.verdict === 'decline' && /^quest3s:[0-9a-f]{8}$/.test(String(dec.json.device)) && dec.json.note === rep?.note, dec.body);
check("the store's row is declined with the repeat note, through decide", st('brief-o2').status === 'declined' && st('brief-o2').decision_note === rep?.note, JSON.stringify(st('brief-o2')));
check('...and the like idea and the plain card are untouched', st('brief-o4').status === 'proposed' && st('find-kettle-web-1').status === 'proposed');
r = await at('brief-o2', DEV);
check('a second pinch: 409, already declined', r.status === 409 && /already declined/.test(await r.text()));
const steerLog = fs.readFileSync(path.join(TMP, 'kettle-web', '.ai', 'lens-scan', 'work', 'steering-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { proposal: string; verdict: string; note?: string });
check('one steering-log row, the same the deck writes', steerLog.filter((x) => x.proposal === 'brief-o2').length === 1 && steerLog[0].verdict === 'decline' && steerLog[0].note === rep?.note, JSON.stringify(steerLog));
const after = await deck();
check('the morning deck keeps the repeat in its slot, marked declined', after.cards.find((c) => c.decision?.proposal === 'brief-o2')?.decision?.steered?.verdict === 'decline');
db.close();
await door.stop();
await new Promise<void>((res) => { loop.close(() => res()); loop.closeAllConnections(); });

try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows may still hold it: the OS cleans it */ }
console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed (vr decline)`);
process.exit(failed ? 1 : 0);
