// Checks the Morning Watch end to end on a throwaway portfolio: scripts/morning-demo.mjs seeds three demo products into a
// temp dir (registry BP_PRODUCTS_FILE there, never bp.products.local.json); the deck (GET /api/companion/morning) must say
// the night plainly - what was built and failed, a release whose readings confirm it, one that fell short, a quiet product,
// the top three blockers stop-ship first, every place card naming a product and a target; steering (POST) must keep the
// human path, write approve to the store and every verdict to the steering log, take a deferred decision off the deck and
// keep a held one marked, and refuse approve under BP_WRITES=off. Then the shared focus through a REAL apps/server: the
// headless VR stand-in (scripts/focus-standin.ts --once) follows, the deck's card is published, and the stand-in must
// frame that card's room on its own plan, and --lead --keys drives it without a terminal.
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

// ------------------------------------------------------------------------- what yesterday's approvals became (ES1, roadmap E)
// morning-demo.mjs: three Kettle findings approved from the table yesterday morning on kettle-web, two built (with before and
// after screens), one failed with lens-scan's failure record; the server's join (outcomes.server.ts) makes one card of it.
{
  const oc = d.cards.find((c) => c.kind === 'outcomes'), xs = oc?.outcomes ?? [], by = (id: string) => xs.find((x) => x.proposal === id);
  const at = (id: string) => d.cards.findIndex((c) => c.id === id);
  check('outcomes: one card for kettle-web, after the open card and before what was built overnight', !!oc && oc.id === 'outcomes:kettle-web' && d.cards.filter((c) => c.kind === 'outcomes').length === 1 && at('outcomes:kettle-web') > at('open') && at('outcomes:kettle-web') < at('built:kettle-web'), kinds.join(','));
  check('outcomes: the headline counts them in words, the tone follows the failure', oc?.headline === '3 approved yesterday on Kettle Web: 2 built, 1 failed' && oc.tone === 'bad', oc?.headline);
  const k11 = by('kf-011');
  check('outcomes: a decided-then-built proposal is built, with its short commit and both screens', k11?.outcome === 'built' && k11.commit === 'de3011a' && k11.before === 'shots/demo-yesterday/finding-kf-011.png' && k11.after === 'shots/demo-yesterday/finding-kf-011-after.png' && k11.decided_by === 'vr' && k11.wave === 'w-demo-yesterday', JSON.stringify(k11));
  const k45 = by('kf-045');
  check("outcomes: a failed one says the failure record's stage and reason in one sentence, and has no commit or after screen", k45?.outcome === 'failed' && k45.reason === 'A check failed after the change: the new end-to-end test still fails because the total stays at 120.00 with the promo code applied.' && !('commit' in k45) && !('after' in k45), JSON.stringify(k45));
  check('outcomes: newest decision first', xs.map((x) => x.proposal).join() === 'kf-045,kf-041,kf-011', xs.map((x) => x.proposal).join());
  check('outcomes: no key carries null or an empty string', xs.every((x) => Object.values(x).every((v) => v !== null && v !== '')), JSON.stringify(xs));
  const { wire } = await import('./lib/wire-schema.ts');
  const deckOk = await wire('morning-deck-1', 'morningDeck');
  check('outcomes: the deck with the card is morning-deck-1', !deckOk(d), String(deckOk(d)));
  const withCard = (c: object) => ({ ...d, cards: d.cards.map((x) => (x.kind === 'outcomes' ? c : x)) });
  check('outcomes: a card with an unknown field is not', !!deckOk(withCard({ ...oc, extra: 1 })) && !!deckOk(withCard({ ...oc, outcomes: [{ ...xs[0], extra: 1 }] })));
  check('outcomes: an outcome with null for an absent key is not, nor an svg screen', !!deckOk(withCard({ ...oc, outcomes: [{ ...xs[1], reason: null }] })) && !!deckOk(withCard({ ...oc, outcomes: [{ ...xs[1], after: 'shots/x/after.svg' }] })));

}

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
const later = await morningDeck(undefined, Date.now() + 18 * 3600e3);
check('the next morning the approved one is gone and the deferred one is still off the deck', !later.cards.some((c) => c.decision?.proposal === d0.decision!.proposal || c.decision?.proposal === d1.decision!.proposal));
const held = later.cards.find((c) => c.decision?.proposal === d2.decision!.proposal);
check('...the held one is still there, marked held, after the top three', !!held && held.lines.some((l) => /^Held since/.test(l.text)) && later.cards.filter((c) => c.kind === 'decision').pop()?.id === held.id, ids(later));
check('...and the morning after that the deferred one is back', (await morningDeck(undefined, Date.now() + 22 * 3600e3)).cards.some((c) => c.decision?.proposal === d1.decision!.proposal));
const close = d.cards[d.cards.length - 1];
check('the close card says what was decided', /1 approved, 1 deferred to tomorrow, 1 held/.test(close.lines[0]?.text ?? ''), close.lines.map((l) => l.text).join(' | '));
// a decision taken this morning on the plan (or by Personas through its own path) is counted on the close card
const { decide } = await import('../packages/core/src/server/store.server.ts');
const other = d.cards.length && (await deck()) && (() => { const x = new DatabaseSync(path.join(root('kettle-phone'), 'scan.db'), { readOnly: true }); try { return x.prepare("SELECT id FROM proposals WHERE status = 'proposed' AND id NOT LIKE 'find-%' LIMIT 1").get() as { id: string }; } finally { x.close(); } })();
check('a second open finding to decide elsewhere', !!other);
if (other) decide(path.join(root('kettle-phone'), 'scan.db'), other.id, { decision: 'approve' }, 'user:personas');
const closed = (await deck()).cards.pop()!;
check('the close card counts what was decided elsewhere this morning, and by whom', closed.lines.some((l) => /elsewhere .*: 1\./.test(l.text)) && closed.lines.some((l) => /by user:personas/.test(l.text)), closed.lines.map((l) => l.text).join(' | '));
const md = fs.readFileSync(path.join(root(d0.product!), 'work', 'steering-log.md'), 'utf8');
check('the daily steering log is written next to the store', /# Daily steering log - /.test(md) && /Approved: /.test(md));
check('one jsonl row per verdict', [d0, d1, d2].every((c) => fs.readFileSync(path.join(root(c.product!), 'work', 'steering-log.jsonl'), 'utf8').includes(c.decision!.proposal)));

// ------------------------------------------------------------------------- news during the standup (roadmap C1)
{
  const q = (x: Deck, extra = '') => GET(new Request(`${U}?since=${encodeURIComponent(x.since)}${extra}`, { headers: { host: '127.0.0.1:3313' } }));
  const first = (await (await q(d)).json()) as Deck, opened = first.until;
  const ranked = (x: Deck) => x.cards.filter((c) => c.kind === 'decision' && !c.news).map((c) => c.id).join(' ');
  // a stop-ship finding raised after the deck was opened: it would rank first, so it is the hardest case for "no reshuffle"
  const w = new DatabaseSync(path.join(root('kettle-desk'), 'scan.db'));
  const feature = (w.prepare("SELECT feature FROM proposals WHERE id LIKE 'find-%' LIMIT 1").get() as { feature: string }).feature;
  w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, tier, risk, created_at, updated_at) VALUES ('news-1', 'run-night-measure', ?, 'security', 'A token leaks into the desk logs', 'fix', 'proposed', 0, 9, ?, ?)")
    .run(feature, new Date(Date.parse(opened) + 1).toISOString(), new Date(Date.parse(opened) + 1).toISOString());
  w.close();
  await new Promise((r) => setTimeout(r, 15));
  const later = (await (await q(d, '&opened=' + encodeURIComponent(opened))).json()) as Deck;
  const cards = later.cards, nw = cards.filter((c) => c.news);
  check('a finding raised mid-morning: the deck says 1 new', later.news?.count === 1 && later.news.since === opened, JSON.stringify(later.news));
  check('...without reshuffling the decided slots (the ranked decisions are the same cards in the same order)', ranked(later) === ranked(first) && ranked(first).length > 0, ranked(later) + ' / ' + ranked(first));
  check('...the new one comes at the end, before the close card, marked new', nw.length === 1 && nw[0].id === 'decision:kettle-desk:news-1' && cards[cards.length - 2].id === nw[0].id && /^New since you opened the deck/.test(nw[0].lines[0]?.text ?? ''));
  check('...and every card read before keeps its place', first.cards.slice(0, -1).every((c, i) => cards[i]?.id === c.id));
  const plain = (await (await q(d)).json()) as Deck;
  check('without `opened` there is no news: the deck is read as a new morning (the finding ranks)', !plain.news && plain.cards.some((c) => c.id === 'decision:kettle-desk:news-1' && !c.news));
  const seeded = spawnSync(process.execPath, [path.join(ROOT, 'scripts/morning-demo.mjs'), '--root', TMP, '--news', 'kettle-phone'], { encoding: 'utf8' });
  const again = (await (await q(d, '&opened=' + encodeURIComponent(opened))).json()) as Deck;
  check("the seeder's --news adds one finding to a seeded product: 2 new", seeded.status === 0 && again.news?.count === 2 && again.cards.filter((c) => c.news).length === 2 && ranked(again) === ranked(first), seeded.stderr || JSON.stringify(again.news));
  const { agentDeck } = await import('../packages/core/src/companion/morning.ts');
  check('the agent view says the same news', agentDeck(again).news?.count === 2 && agentDeck(again).cards.filter((c) => c.news).length === 2);
  const { wire } = await import('./lib/wire-schema.ts');
  const bad = [(await wire('morning-deck-1', 'morningDeck'))(again), (await wire('morning-deck-1', 'agentDeck'))(agentDeck(again))].filter(Boolean);
  check('a deck with news, and its agent view, are morning-deck-1', !bad.length, bad.join(' | '));
}

// ------------------------------------------------------------------------- the steering log, read from the store (roadmap C3)
{
  const log = path.join(root('kettle-desk'), 'work', 'steering-log.jsonl');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), product: 'kettle-desk', proposal: 'news-1', verdict: 'hold', title: 'A token leaks into the desk logs', by: 'user:personas' }) + '\n');
  const after = await deck();
  const md = fs.readFileSync(path.join(root('kettle-desk'), 'work', 'steering-log.md'), 'utf8');
  check('steering-log.md shows a row another writer appended, with no bp steer (rendered on read)', /Held: A token leaks into the desk logs \(`news-1`, user:personas\)/.test(md), md);
  check('...and the close card counts it', /1 approved, 1 deferred to tomorrow, 2 held/.test(after.cards[after.cards.length - 1].lines[0]?.text ?? ''), after.cards[after.cards.length - 1].lines[0]?.text);
}

// ------------------------------------------------------------------------- every failed build is named (DW-224)
// The card's line budget must not spend itself on successes first: a failure the headline counts is a failure the card names.
{
  const { buildDeck } = await import('../packages/core/src/companion/morning.ts');
  const { wire } = await import('./lib/wire-schema.ts');
  const NOW = Date.parse('2026-10-20T08:00:00.000Z'), SINCE = '2026-10-19T16:00:00.000Z', OPENED = '2026-10-20T07:00:00.000Z', NIGHT = '2026-10-20T02:00:00.000Z', LATE = '2026-10-20T07:30:00.000Z';
  const item = (id: string, status: string, updated_at: string) => ({ id, run_id: 'r', feature: 'f', lens: 'development', title: `${status === 'done' ? 'Built' : 'Broke'} ${id}`, kind: 'fix', status, created_at: '2026-10-19T10:00:00.000Z', updated_at });
  const night = (ok: number, bad: number, at: string) => [...Array.from({ length: ok }, (_, i) => item('ok' + i, 'done', at)), ...Array.from({ length: bad }, (_, i) => item('bad' + i, 'failed', at))];
  const facts = (proposals: object[]) => [{ slug: 'a', name: 'A', scan: { proposals, measurements: [], packs: [], releases: [], runs: [] }, where: new Map() }] as never;
  const builtCard = (ok: number, bad: number) => buildDeck(facts(night(ok, bad, NIGHT)), [], SINCE, NOW).cards.find((c) => c.id === 'built:a');
  const lateCard = (ok: number, bad: number) => buildDeck(facts(night(ok, bad, LATE)), [], SINCE, NOW, [], OPENED).cards.find((c) => c.id === 'news-built:a');
  type C = { lines: { text: string }[] } | undefined;
  const namedFails = (c: C, bad: number) => Array.from({ length: bad }, (_, i) => `Failed: Broke bad${i}`).filter((t) => c?.lines.some((l) => l.text === t)).length;
  const texts = (c: C) => c?.lines.map((l) => l.text).join(' | ') ?? 'no card';
  const each = [['the built card', builtCard], ['the late card', lateCard]] as const;
  for (const [name, card] of each) {
    const six = card(6, 2), eight = card(3, 8), small = card(3, 1), calm = card(10, 0);
    check(`${name}: six built and two failed: the headline counts 2 builds failed`, /2 builds failed/.test((six as { headline?: string } | undefined)?.headline ?? ''), (six as { headline?: string } | undefined)?.headline);
    check(`${name}: six built and two failed: 2 of 2 failures named as "Failed: <title>" (DW-224)`, namedFails(six, 2) === 2, `${namedFails(six, 2)} named: ${texts(six)}`);
    check(`${name}: three built and eight failed: all 8 failures named (DW-224)`, namedFails(eight, 8) === 8, `${namedFails(eight, 8)} named: ${texts(eight)}`);
    check(`${name} control: three built and one failed: every item is named`, namedFails(small, 1) === 1 && [0, 1, 2].every((i) => small?.lines.some((l) => l.text.startsWith(`Built ok${i}`))), texts(small));
    check(`${name} control: ten built and none failed: at most 6 lines`, !!calm && calm.lines.length <= 6, texts(calm));
  }
  const late = lateCard(6, 2) as { kind?: string; news?: boolean } | undefined;
  check('the late card is kind built, marked news, when items land after the deck was opened', late?.kind === 'built' && late.news === true, JSON.stringify(late)?.slice(0, 200));
  const fails = [(await wire('morning-deck-1', 'morningDeck'))(buildDeck(facts(night(3, 8, NIGHT)), [], SINCE, NOW))].filter(Boolean);
  check('a card naming eight failures is still morning-deck-1', !fails.length, fails.join(' | '));
}

// ------------------------------------------------------------------------- the outcomes join's rules (ES1), after the steering checks:
// it approves and declines findings on kettle-phone, which the close card above would otherwise count as decided elsewhere
{
  const { outcomesFor } = await import('../packages/core/src/server/outcomes.server.ts');
  const { decisionsFile } = await import('../packages/core/src/server/decider.server.ts');
  const { findProduct } = await import('../packages/core/src/server/products.server.ts');
  const { snapshots } = await import('../packages/core/src/server/api/companion/views.server.ts');
  const P = findProduct('kettle-phone')!, file = path.join(root('kettle-phone'), 'scan.db'), now = Date.now(), H = 3600e3, iso = (ms: number) => new Date(ms).toISOString();
  // five findings the person approved over the last days (one declined since), written into the scratch store as a decision leaves them
  const [jb, wt, hd, old, gone] = ['oc-job', 'oc-wait', 'oc-held', 'oc-old', 'oc-gone'];
  {
    const w = new DatabaseSync(file), f = (w.prepare("SELECT feature, run_id FROM proposals WHERE id LIKE 'find-%' LIMIT 1").get() as { feature: string; run_id: string });
    const put = w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, decided_by, decided_at, created_at, updated_at) VALUES (?, ?, ?, 'design', ?, 'fix', ?, 'user:check', ?, ?, ?)");
    for (const id of [jb, wt, hd, old, gone]) put.run(id, f.run_id, f.feature, 'Check item ' + id, id === gone ? 'declined' : 'approved', iso(now - 30 * H), iso(now - 40 * H), iso(now - 30 * H));
    w.close();
  }
  const row = (id: string, verdict: string, ms: number, surface = 'web') => JSON.stringify({ at: iso(ms), kind: 'morning', surface, product: 'kettle-phone', target: id, verdict });
  fs.mkdirSync(path.dirname(decisionsFile()), { recursive: true });
  fs.appendFileSync(decisionsFile(), [row(jb, 'approve', now - 30 * H, 'vr'), row(wt, 'approve', now - 29 * H), row(hd, 'approve', now - 28 * H), row(hd, 'hold', now - 27 * H), row(old, 'approve', now - 8 * 24 * H), row(gone, 'approve', now - 26 * H), row(wt, 'approve', now - 1 * H)].join('\n') + '\n');
  const journal = path.join(TMP, 'kettle-phone', '.ai', 'lens-scan', 'work', 'bp-jobs', 'journal.jsonl');
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  const job = (id: string, status: string, ids: string[], ms: number) => JSON.stringify({ at: iso(ms), slug: 'kettle-phone', phase: status, job: { id, kind: 'execute', status, proposals: ids, queued_at: iso(ms) } });
  fs.writeFileSync(journal, [job('j-check-1', 'queued', [jb], now - 2 * H), job('j-check-1', 'running', [jb], now - 1 * H), job('j-check-stale', 'running', [wt], now - 13 * H)].join('\n') + '\n');
  const scan = snapshots('kettle-phone').read[0].scan, got = outcomesFor(P, scan, [], iso(now - 16 * H), now), o = (id: string) => got.find((x) => x.proposal === id);
  check('outcomes: building while an execute job naming it is queued or running', o(jb)?.outcome === 'building' && o(jb)?.decided_by === 'vr', JSON.stringify(o(jb)));
  check('outcomes: waiting when nothing builds it (a 13 h old running line is a lost process, not a build)', o(wt)?.outcome === 'waiting', JSON.stringify(o(wt)));
  check("outcomes: an approval made inside this morning's window is this morning's, not yesterday's (the earlier approve is kept)", o(wt)?.decided_at === iso(now - 29 * H), JSON.stringify(o(wt)));
  check('outcomes: a proposal held after its approval is dropped', !o(hd), JSON.stringify(got.map((x) => x.proposal)));
  check('outcomes: a decision older than 7 days is dropped', !o(old), JSON.stringify(got.map((x) => x.proposal)));
  check('outcomes: a proposal the store declined since is dropped', !o(gone), JSON.stringify(got.map((x) => x.proposal)));
  check('outcomes: a waiting one has no commit, reason, wave or screens: absent keys, never null', !!o(wt) && ['commit', 'reason', 'wave', 'before', 'after'].every((k) => !(k in o(wt)!)) && Object.values(o(wt)!).every((v) => v !== null && v !== ''), JSON.stringify(o(wt)));
  const later2 = await deck(), oc2 = later2.cards.find((c) => c.id === 'outcomes:kettle-phone');
  check("outcomes: the route's deck carries kettle-phone's card too: 2 approved yesterday, 1 building, 1 not built yet", oc2?.headline === '2 approved yesterday on Kettle Phone: 1 building, 1 not built yet' && oc2.tone === 'warn', oc2?.headline);
  fs.rmSync(journal, { force: true });
}

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
  for (let i = 0; i < 100 && !so.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100));
  const card = d.cards.find((c) => c.kind === 'built')!;
  const pub = await fetch(`${base}/api/session/focus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'publish', reader: 'web-check', surface: 'web', label: 'Web', place: card.place }) });
  check("the deck's card publishes over the real server: 201", pub.status === 201);
  const code = await Promise.race([done, new Promise<number>((r) => setTimeout(() => r(99), 15000))]);
  check('the headless VR stand-in followed and framed the card\'s room on its own plan', code === 0 && so.includes('Following Web') && so.includes('table framed on'), so.slice(-400));
  if (code === 99) standin.kill();
  // --lead without a terminal: the stand-in leads from a script of keys (--keys) and from stdin (--keys -), then exits
  const lead = (extra: string[], stdin: string | null) => new Promise<{ code: number; out: string }>((res) => {
    const c = spawn(process.execPath, ['--import', '@bp/core/register', path.join(ROOT, 'scripts/focus-standin.ts'), '--base', base, '--lead', '--keys-delay', '50', ...extra], { cwd: ROOT, stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let o = '';
    c.stdout!.on('data', (b) => { o += String(b); }); c.stderr!.on('data', (b) => { o += String(b); });
    if (stdin !== null) c.stdin!.end(stdin);
    const t = setTimeout(() => { c.kill(); res({ code: 99, out: o }); }, 15000);
    c.on('exit', (cd) => { clearTimeout(t); res({ code: cd ?? 1, out: o }); });
  });
  const focus = async () => (await (await fetch(`${base}/api/session/focus`)).json()) as { rev: number; shared: { reader: string; place: { target?: { kind: string } } } | null };
  const r0 = (await focus()).rev;
  const keyed = await lead(['--keys', 'n,n,x'], null), afterKeys = await focus();
  check('--lead --keys "n,n,x": two rooms published by the stand-in, the stray key skipped, exit 0', keyed.code === 0 && afterKeys.rev === r0 + 2 && afterKeys.shared?.reader === 'vr:standin' && afterKeys.shared.place.target?.kind === 'room' && (keyed.out.match(/The table leads/g) ?? []).length === 2 && keyed.out.includes('"x" is not a key'), keyed.out.slice(-400));
  const piped = await lead(['--keys', '-'], 'n\nq\nn\n'), afterPipe = await focus();
  check('--lead --keys - reads the keys from stdin and stops at q: one more room, exit 0', piped.code === 0 && afterPipe.rev === afterKeys.rev + 1 && (piped.out.match(/The table leads/g) ?? []).length === 1, piped.out.slice(-400));
  const bare = spawn(process.execPath, ['--import', '@bp/core/register', path.join(ROOT, 'scripts/focus-standin.ts'), '--base', base, '--lead', '--once'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let bo = ''; bare.stderr.on('data', (b) => { bo += String(b); });
  await new Promise((r) => setTimeout(r, 2500)); bare.kill();
  check('--lead with no terminal and no keys says what it needs instead of doing nothing silently', bo.includes('--lead needs a terminal'), bo.slice(-300));
}
const gone = new Promise((r) => server.once('exit', r));
server.kill();
await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* a temp dir Windows still holds: the OS cleans it */ }
console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed (morning watch)`);
process.exit(failed ? 1 : 0);
