// Checks the Morning Watch end to end on a throwaway portfolio: scripts/morning-demo.mjs seeds three demo products into a
// temp dir (registry BP_PRODUCTS_FILE there, never bp.products.local.json); the deck (GET /api/companion/morning) must say
// the night plainly - what was built and failed, a release whose readings confirm it, one that fell short, a quiet product,
// the top three blockers stop-ship first, every place card naming a product and a target; steering (POST) must keep the
// human path, write approve to the store and every verdict to the steering log, take a deferred decision off the deck and
// keep a held one marked, and refuse approve under BP_WRITES=off. Then the shared focus through a REAL apps/server: the
// headless VR stand-in (scripts/focus-standin.ts --once) follows, the deck's card is published, and the stand-in must
// frame that card's room on its own plan.
// Run: node --import @bp/core/register scripts/check-morning-watch.ts. Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-morning-'));
const REG = path.join(TMP, 'products.json');
Object.assign(process.env, { BP_PRODUCTS_FILE: REG, BP_HOME: path.join(TMP, 'home'), BP_GH_BIN: path.join(ROOT, 'scripts/fixtures/fake-gh.mjs'), BP_CLAUDE_BIN: path.join(ROOT, 'scripts/fixtures/fake-claude.mjs') });
delete process.env.BP_WRITES;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/morning-demo.mjs'), '--root', TMP], { encoding: 'utf8' });
check('morning-demo seeds three products into a temp registry', seed.status === 0 && fs.existsSync(REG), seed.stderr);
check('...and never the real registry', !seed.stdout.includes('bp.products.local.json -') && JSON.parse(fs.readFileSync(REG, 'utf8')).products.length === 3);

const { GET, POST } = await import('../packages/core/src/server/api/companion/morning/route.ts');
const { humanToken } = await import('../packages/core/src/server/api/companion/door.server.ts');
type Deck = import('../packages/core/src/companion/morning.ts').MorningDeck;
const U = 'http://127.0.0.1:3313/api/companion/morning';
const req = (method: string, body?: unknown, h: Record<string, string> = {}) =>
  new Request(U, { method, headers: { host: '127.0.0.1:3313', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...h }, body: body !== undefined ? JSON.stringify(body) : undefined });
const deck = async (): Promise<Deck> => (await (await GET(req('GET'))).json()) as Deck;

let d = await deck();
const kinds = d.cards.map((c) => c.kind);
check('the deck opens with the portfolio and closes with the morning', kinds[0] === 'open' && kinds[kinds.length - 1] === 'close', kinds.join(','));
const built = d.cards.find((c) => c.id === 'built:kettle-web');
check('what agents built overnight, with what failed, in one plain line', !!built && /agents built 4 items overnight; 1 build failed\./.test(built.headline), built?.headline);
check('a release whose readings after it confirm it', d.cards.some((c) => c.kind === 'release' && c.product === 'kettle-web' && /both items confirmed/.test(c.headline)));
check('a release that fell short says so', d.cards.some((c) => c.kind === 'release' && c.product === 'kettle-phone' && /fell short: 1 of 2/.test(c.headline) && c.tone === 'bad'));
check('a quiet night is said once, calmly', d.cards.some((c) => c.kind === 'quiet' && c.product === 'kettle-desk' && c.tone === 'calm'));
const dec = d.cards.filter((c) => c.kind === 'decision');
check('the top three blockers across products, stop-ship first', dec.length === 3 && dec[0].decision?.tier === 0 && new Set(dec.map((c) => c.product)).size === 3, dec.map((c) => c.product + ':' + c.decision?.tier).join(' '));
check('every place card names a product and a target', d.cards.filter((c) => c.place).every((c) => c.place!.product === c.product && !!c.place!.target || c.kind === 'quiet'));
check('every headline is one line', d.cards.every((c) => !c.headline.includes('\n') && c.headline.length <= 140));
check('the open card counts the night', /2 products of 3 moved: 6 items built, 1 failed/.test(d.cards[0].lines[0]?.text ?? ''), d.cards[0].lines[0]?.text);

const [d0, d1, d2] = dec;
let res = await POST(req('POST', { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve' }));
check('steering without the human token: 403', res.status === 403);
const human = { 'x-bp-human': humanToken() };
res = await POST(req('POST', { product: d0.product, proposal: d0.decision!.proposal, verdict: 'maybe' }, human));
check('an unknown verdict: 400', res.status === 400);
process.env.BP_WRITES = 'off';
res = await POST(req('POST', { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve' }, human));
check('approve under BP_WRITES=off: 403, nothing written', res.status === 403);
delete process.env.BP_WRITES;
res = await POST(req('POST', { product: d0.product, proposal: d0.decision!.proposal, verdict: 'approve' }, human));
const row = (await res.json()) as { verdict?: string; by?: string };
check('approve: 200, signed through gh (here the demo stand-in)', res.status === 200 && row.verdict === 'approve' && row.by === 'user:morning-demo', JSON.stringify(row));
const root = (slug: string) => path.join(TMP, slug, '.ai', 'lens-scan');
const db = new DatabaseSync(path.join(root(d0.product!), 'scan.db'), { readOnly: true });
const st = db.prepare('SELECT status, decided_by, decision_note FROM proposals WHERE id = ?').get(d0.decision!.proposal) as { status: string; decided_by: string; decision_note: string };
db.close();
check("approve moved the finding to approved in the product's own store", st.status === 'approved' && st.decision_note === 'Morning Watch', JSON.stringify(st));
res = await POST(req('POST', { product: d0.product, proposal: d0.decision!.proposal, verdict: 'hold' }, human));
check('a decision already taken: 409', res.status === 409);
res = await POST(req('POST', { product: d1.product, proposal: d1.decision!.proposal, verdict: 'defer' }, human));
check('defer: 200', res.status === 200);
res = await POST(req('POST', { product: d2.product, proposal: d2.decision!.proposal, verdict: 'hold' }, human));
check('hold: 200', res.status === 200);
d = await deck();
const ids = (x: Deck) => x.cards.filter((c) => c.kind === 'decision').map((c) => c.id).join(' ');
check('this morning the deck keeps its three in place, each marked with its verdict', ids(d) === dec.map((c) => c.id).join(' ') && d.cards.filter((c) => c.kind === 'decision').every((c) => !!c.decision?.steered), ids(d));
const { morningDeck } = await import('../packages/core/src/server/api/companion/morning.server.ts');
const later = morningDeck(undefined, Date.now() + 18 * 3600e3);
check('the next morning the approved one is gone and the deferred one is still off the deck', !later.cards.some((c) => c.decision?.proposal === d0.decision!.proposal || c.decision?.proposal === d1.decision!.proposal));
const held = later.cards.find((c) => c.decision?.proposal === d2.decision!.proposal);
check('...the held one is still there, marked held, after the top three', !!held && held.lines.some((l) => /^Held since/.test(l.text)) && later.cards.filter((c) => c.kind === 'decision').pop()?.id === held.id, ids(later));
check('...and the morning after that the deferred one is back', morningDeck(undefined, Date.now() + 22 * 3600e3).cards.some((c) => c.decision?.proposal === d1.decision!.proposal));
const close = d.cards[d.cards.length - 1];
check('the close card says what was decided', /1 approved, 1 deferred to tomorrow, 1 held/.test(close.lines[0]?.text ?? ''), close.lines.map((l) => l.text).join(' | '));
const md = fs.readFileSync(path.join(root(d0.product!), 'work', 'steering-log.md'), 'utf8');
check('the daily steering log is written next to the store', /# Daily steering log - /.test(md) && /Approved: /.test(md));
check('one jsonl row per verdict', [d0, d1, d2].every((c) => fs.readFileSync(path.join(root(c.product!), 'work', 'steering-log.jsonl'), 'utf8').includes(c.decision!.proposal)));

// ------------------------------------------------------------------------- the shared focus through a real apps/server
const port = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', '@bp/core/register', path.join(ROOT, 'apps/server/src/main.ts'), '--port', String(port)], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
server.stdout.on('data', (b) => { out += String(b); });
const up = await (async () => { for (let i = 0; i < 100; i++) { if (out.includes('listening')) return true; await new Promise((r) => setTimeout(r, 150)); } return false; })();
check('apps/server starts on a free loopback port', up, out.slice(-300));
if (up) {
  const standin = spawn(process.execPath, ['--import', '@bp/core/register', path.join(ROOT, 'scripts/focus-standin.ts'), '--base', base, '--once'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let so = '';
  standin.stdout.on('data', (b) => { so += String(b); });
  const done = new Promise<number>((r) => standin.on('exit', (c) => r(c ?? 1)));
  for (let i = 0; i < 60 && !so.includes('nothing shared yet') && !so.includes('opening at'); i++) await new Promise((r) => setTimeout(r, 100));
  const card = d.cards.find((c) => c.kind === 'built')!;
  const pub = await fetch(`${base}/api/session/focus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'publish', reader: 'web-check', surface: 'web', label: 'Web', place: card.place }) });
  check("the deck's card publishes over the real server: 201", pub.status === 201);
  const code = await Promise.race([done, new Promise<number>((r) => setTimeout(() => r(99), 15000))]);
  check('the headless VR stand-in followed and framed the card\'s room on its own plan', code === 0 && so.includes('Following Web') && so.includes('table framed on'), so.slice(-400));
  if (code === 99) standin.kill();
}
server.kill();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed (morning watch)`);
process.exit(failed ? 1 : 0);
