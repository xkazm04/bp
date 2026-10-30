// Checks the fused morning: the Morning Watch's decision cards carry the decision brief, on a throwaway portfolio
// (scripts/morning-demo.mjs into a temp registry, plus scripts/brief-demo-seed.mjs --morning on kettle-web - the labelled
// decision history). Pins:
//   - every decision card carries the brief (cardBrief, companion/morning.ts) within the shared budget, and its lines are
//     the SAME lines the plan.brief door and GET .../proposals/<id>/brief answer (one brief, every reader);
//   - only the same idea filed again recommends Decline, with the "Repeats <id> ..." note; a like idea only asks (quoted,
//     no recommendation); a card with no decline behind it recommends nothing;
//   - a follower's lower third gets the brief's short line in the place's words (<= 280);
//   - Decline on the deck: refused on a likeness and on a plain card (409), taken on a repeat (200) and written to the
//     store through decide with the brief's note; the close card counts it;
//   - the agent trail: an agent's plan.brief read that met a quoted decline (x-bp-conversation) makes the opening card's line
//     and the agents card, with "Withdrew it".
// Run: node --import @bp/core/register scripts/check-morning-brief.ts. Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-morning-brief-'));
const REG = path.join(TMP, 'products.json');
Object.assign(process.env, { BP_PRODUCTS_FILE: REG, BP_HOME: path.join(TMP, 'home'), BP_GH_BIN: path.join(ROOT, 'scripts/fixtures/fake-gh.mjs'), BP_CLAUDE_BIN: path.join(ROOT, 'scripts/fixtures/fake-claude.mjs') });
delete process.env.BP_WRITES;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/morning-demo.mjs'), '--root', TMP], { encoding: 'utf8' });
const hist = spawnSync(process.execPath, [path.join(ROOT, 'scripts/brief-demo-seed.mjs'), '--dir', path.join(TMP, 'kettle-web'), '--morning'], { encoding: 'utf8' });
check('the portfolio and the labelled decision history seed into a temp registry', seed.status === 0 && hist.status === 0 && fs.existsSync(REG), seed.stderr + hist.stderr);

const { GET, POST } = await import('../packages/core/src/server/api/companion/morning/route.ts');
const brief = await import('../packages/core/src/server/api/companion/brief/route.ts');
const { humanToken } = await import('../packages/core/src/server/api/companion/door.server.ts');
const { BRIEF_LINES, BRIEF_WIDTH } = await import('../packages/core/src/scan/brief.ts');
const { TOOLS } = await import('../packages/core/src/companion/catalog.ts');
type Deck = import('../packages/core/src/companion/morning.ts').MorningDeck;
const H = { host: '127.0.0.1:3313' };
const req = (method: string, body?: unknown, h: Record<string, string> = {}) =>
  new Request('http://127.0.0.1:3313/api/companion/morning', { method, headers: { ...H, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...h }, body: body !== undefined ? JSON.stringify(body) : undefined });
const deck = async (): Promise<Deck> => (await (await GET(req('GET'))).json()) as Deck;
const human = { 'x-bp-human': humanToken() };

let d = await deck();
const dec = d.cards.filter((c) => c.kind === 'decision');
check('the top three: the stop-ship secret, the re-filed declined idea, the like idea', dec.map((c) => c.decision?.proposal).join(' ') === 'find-kettle-web-1 brief-o2 brief-o4', dec.map((c) => c.decision?.proposal).join(' '));
check('every decision card carries its brief, within the shared budget', dec.every((c) => !!c.decision?.brief && c.decision.brief.lines.length > 0 && c.decision.brief.lines.length <= BRIEF_LINES && c.decision.brief.lines.every((l) => l.length <= BRIEF_WIDTH)));
check('...touches, undo and cost on every card', dec.every((c) => ['blast', 'undo', 'cost'].every((k) => c.decision!.brief!.facts.some((f) => f.key === k))));
const [plain, rep, like] = dec, R = rep.decision!.brief!, L = like.decision!.brief!, P = plain.decision!.brief!;
check('the repeat: Decline recommended, the decline it repeats quoted in the owner\'s words', R.recommend === 'decline' && R.advice.say === 'withdraw' && R.decline?.id === 'brief-h7' && /^Repeats brief-h7, declined \d{4}-\d\d-\d\d: "No retries until idempotency keys land/.test(R.note ?? '') && R.lines.some((l) => /brief-h7\): "No retries/.test(l)), JSON.stringify(R));
check('the like idea only asks: quoted, nothing recommended', L.advice.say === 'ask' && !L.recommend && !L.note && !!L.decline && /yours to decide/.test(L.short), JSON.stringify(L));
check('a card with no decline behind it recommends nothing', !P.recommend && P.advice.say === 'proceed');
check("a follower's lower third carries the brief's short line", rep.place!.say!.split('\n')[1]?.startsWith('Repeats your decline brief-h7') === true && dec.every((c) => (c.place?.say?.length ?? 0) <= 280), rep.place?.say);
// one brief, every reader: the plan.brief door and the proposal's brief route answer the same lines
for (const c of dec) {
  const r = await brief.GET(new Request(`http://127.0.0.1:3313/api/companion/brief?product=kettle-web&id=${c.decision!.proposal}`, { headers: H }));
  const j = (await r.json()) as { lines?: string[] };
  check(`plan.brief answers the card's own lines for ${c.decision!.proposal}`, r.status === 200 && JSON.stringify(j.lines) === JSON.stringify(c.decision!.brief!.lines), JSON.stringify(j.lines));
}
// the release card lands where the plan shows its reading: the tile's newest track is the release's (the demo pass found
// the card on one feature and the "confirmed · measured" tile on another)
const { tracksOf } = await import('../packages/core/src/scan/track.ts');
const { snapshotOf } = await import('../packages/core/src/server/store.server.ts');
const rel = d.cards.find((c) => c.kind === 'release' && c.product === 'kettle-web')!;
const top = tracksOf(snapshotOf(path.join(TMP, 'kettle-web', '.ai', 'lens-scan', 'scan.db')), Date.now()).find((t) => t.feature === rel.place?.target?.id);
check("the release card flies to a tile whose label is this release's reading, named first on the card", !!top && top.release === 'rel-1.4.0' && /^confirmed/.test(top.label) && rel.lines[0].text.startsWith(top.title), JSON.stringify({ place: rel.place?.target, top: top && [top.id, top.label], line: rel.lines[0]?.text }));
const mb = TOOLS.find((t) => t.name === 'morning.brief');
// the door: morning.brief asks for the agent view, which carries the same brief lines and fits the door's cap
const { toolRequest, RESULT_CAP } = await import('../packages/core/src/server/api/companion/tool-call.ts');
const tr = mb ? toolRequest(mb, {}) : { error: 'no tool' };
check('morning.brief asks for view=agent', 'path' in tr && tr.path === '/api/companion/morning?view=agent', JSON.stringify(tr));
const av = await (await GET(new Request('http://127.0.0.1:3313/api/companion/morning?view=agent', { headers: H }))).text();
const aj = JSON.parse(av) as { cards: { decision?: { proposal: string; brief?: { lines: string[]; recommend?: string; note?: string } } }[] };
check(`the agent view fits the door's ${RESULT_CAP}-char cap (${av.length})`, av.length <= RESULT_CAP);
check("...and carries every decision card's brief lines and the repeat's recommendation", dec.every((c) => JSON.stringify(aj.cards.find((x) => x.decision?.proposal === c.decision!.proposal)?.decision?.brief?.lines) === JSON.stringify(c.decision!.brief!.lines))
  && aj.cards.find((x) => x.decision?.proposal === 'brief-o2')?.decision?.brief?.recommend === 'decline');
check('morning.brief is the door to this deck (GET /api/companion/morning) and says it carries the brief', !!mb && mb.route.path === '/api/companion/morning' && /brief/.test(mb.description.slice(40)));

// ------------------------------------------------------------------------- the morning speaks about agents
check('no agent trail: no agents card, no agents line', !d.cards.some((c) => c.kind === 'agents') && !d.cards[0].lines.some((l) => /agents checked/.test(l.text)));
let res: Response;
const agentReq = (q: string) => new Request(`http://127.0.0.1:3313/api/companion/brief?${q}`, { headers: { ...H, 'x-bp-conversation': 'check-agent-1' } });
res = await brief.GET(agentReq('product=kettle-web&feature=card-payments&title=' + encodeURIComponent('Add retry to checkout')));
const heard = (await res.json()) as { advice?: { say: string }; declines?: { id: string }[] };
// a re-worded draft is a likeness: the advice asks, quoting the owner (the scripted agent's own policy then withdraws)
check("an agent's draft hears the owner's decline quoted (ask: a like idea)", res.status === 200 && heard.advice?.say === 'ask' && heard.declines?.[0]?.id === 'brief-h7', JSON.stringify(heard.advice));
await brief.GET(agentReq('product=kettle-web&id=brief-o4'));
d = await deck();
const openLine = d.cards[0].lines.find((l) => /agents checked/.test(l.text))?.text ?? '';
check('the opening card: agents checked your decisions 2 times, heard 1 decline, withdrew 1', /agents checked your decisions 2 times before proposing: they heard 1 decline of yours and withdrew 1 proposal\./.test(openLine) && d.agents?.withdrew === 1, openLine);
const ag = d.cards.find((c) => c.kind === 'agents');
check('the agents card, second, at the feature the agent stood down on', d.cards[1]?.kind === 'agents' && !!ag && ag.lines.some((l) => /Was about to propose "Add retry to checkout" on Card payments; read your decline brief-h7/.test(l.text)) && ag.lines.some((l) => /^Withdrew it/.test(l.text)) && ag.place?.target?.id === 'card-payments', JSON.stringify(ag));

// ------------------------------------------------------------------------- Decline on the deck
res = await POST(req('POST', { product: 'kettle-web', proposal: 'brief-o4', verdict: 'decline' }, human));
check('Decline on a like idea: 409, nothing written', res.status === 409);
res = await POST(req('POST', { product: 'kettle-web', proposal: 'find-kettle-web-1', verdict: 'decline' }, human));
check('Decline on a card with no repeat: 409', res.status === 409);
res = await POST(req('POST', { product: 'kettle-web', proposal: 'brief-o2', verdict: 'decline' }));
check('Decline without the human token: 403', res.status === 403);
res = await POST(req('POST', { product: 'kettle-web', proposal: 'brief-o2', verdict: 'decline' }, human));
const row = (await res.json()) as { verdict?: string; note?: string };
check('Decline on the repeat: 200, the row carries the brief\'s note', res.status === 200 && row.verdict === 'decline' && row.note === R.note, JSON.stringify(row));
const db = new DatabaseSync(path.join(TMP, 'kettle-web', '.ai', 'lens-scan', 'scan.db'), { readOnly: true });
const st = (id: string) => db.prepare('SELECT status, decision_note FROM proposals WHERE id = ?').get(id) as { status: string; decision_note: string | null };
check("the store's row reads the repeat note, through decide", st('brief-o2').status === 'declined' && st('brief-o2').decision_note === R.note, JSON.stringify(st('brief-o2')));
check('...and the like idea and the plain card are untouched', st('brief-o4').status === 'proposed' && st('find-kettle-web-1').status === 'proposed');
db.close();
d = await deck();
const close = d.cards[d.cards.length - 1];
check('the close card counts the repeat declined', /0 approved, 0 deferred to tomorrow, 0 held, 1 declined as a repeat\./.test(close.lines[0]?.text ?? '') && close.lines.some((l) => /^Declined as a repeat: Add retry to the checkout payment calls/.test(l.text)), close.lines.map((l) => l.text).join(' | '));
check('the deck keeps the repeat in its slot, marked declined', d.cards.filter((c) => c.kind === 'decision').map((c) => c.decision?.proposal).join(' ') === 'find-kettle-web-1 brief-o2 brief-o4' && d.cards.find((c) => c.decision?.proposal === 'brief-o2')?.decision?.steered?.verdict === 'decline');
const md = fs.readFileSync(path.join(TMP, 'kettle-web', '.ai', 'lens-scan', 'work', 'steering-log.md'), 'utf8');
check('the steering log says it, with the note', /Declined as a repeat: Add retry to the checkout payment calls .* - Repeats brief-h7/.test(md), md);

// the wire: the deck (with a steered repeat and every card's brief), its agent view and a steering row conform to
// packages/schema/schema/morning-deck-1.schema.json, which references decision-brief-1 and shared-focus-1
{
  const { wire } = await import('./lib/wire-schema.ts');
  const { agentDeck } = await import('../packages/core/src/companion/morning.ts');
  const asDeck = await wire('morning-deck-1', 'morningDeck'), asAgent = await wire('morning-deck-1', 'agentDeck'), asRow = await wire('morning-deck-1', 'steerRow');
  const fails = [asDeck(d), asAgent(agentDeck(d)), asRow(row)].filter(Boolean);
  check('wire: the deck, its agent view and the steering row conform to morning-deck-1', !fails.length && d.cards.some((c) => c.decision?.brief?.recommend === 'decline'), fails.join(' | '));
  const dc = d.cards.find((c) => c.decision?.brief)!;
  check('wire control: a card of an unknown kind, a brief of six lines and a verdict of veto are refused',
    !!asDeck({ ...d, cards: [{ ...dc, kind: 'news' }] }) && !!asDeck({ ...d, cards: [{ ...dc, decision: { ...dc.decision, brief: { ...dc.decision!.brief, lines: ['1', '2', '3', '4', '5', '6'] } } }] }) && !!asRow({ ...row, verdict: 'veto' }));
}

try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows may still hold it: the OS cleans it */ }
console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed (morning brief)`);
process.exit(failed ? 1 : 0);
