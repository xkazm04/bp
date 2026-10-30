#!/usr/bin/env node
// Gate: the decision brief (packages/core/src/scan/brief.ts) says each fact right, says thin evidence as thin, stays in
// its line budget, and reaches both doors. Fixtures are built here, by hand, so every number below is checkable:
//   1. no history: no precedent yet, nothing depends on it, risk class unknown, no build history, advice proceed;
//   2. not on the plan: blast radius unknown, no ids;
//   3. blast: the features whose depends_on name it, counted with their rooms, ids = their slugs;
//   4. precedent: same lens AND tier counts (a tier-2 row under the lens does not), "approved 5 of 6", 6 ids;
//   5. declines: the matching decline is quoted in the owner's words, latest first, one per standard; advice withdraw;
//   6. words: a draft "add retry to checkout" hears "Add retries to checkout payment calls"; one shared word plus the
//      feature's own name ("booking" ~ book-a-class) is NOT similar (the first run's false positive);
//   7. undo: money -> a revert may not undo it, reliability -> a revert PR, none -> unknown;
//   8. cost: 24 min execute run with 2 items in its pack -> about 12 min, under the lens, on its model; else any lens;
//   9. budget: at most BRIEF_LINES facts of at most BRIEF_WIDTH characters, a long note cut with an ellipsis;
//  10. same input, same brief (byte for byte), and facts == lines;
//  11. the doors: plan.brief is in the catalog, AUTO, on GET /api/companion/brief; both route modules and their web
//      mounts exist; the web decision card and Review detail render the brief through useBrief + BriefFacts;
//  12. the card's recommendation: briefAdvice (no map) agrees with the full brief; a repeat recommends Decline with a
//      note naming the decision it repeats (repeatNote, <= 500); the live feed uses it and Engine.decide carries it;
//  13. the agent trail: a draft that met a decline reads as heard + withdrew; a later approval on the same feature drops
//      the "withdrew"; a recommendation quoting a decline already shown names it by id; old sessions go; a product
//      filter keeps that product's rows; the slip polls it;
//  14. one map, two reads: briefMapOf (the raw document, the server) and briefMapOfStructure (the loaded map, the browser)
//      agree on Kettle's 133 features, rooms, wings and lenses, so the card and the routes count the same blast radius;
//  15. the wire: every brief built above validates against packages/schema decision-brief-1 (the schema BpLink's
//      FBpDecisionBrief and Personas' adoption read), and a brief with a sixth line or a null feature does not;
//  16. the golden file (docs/concepts/decision-brief/golden.json, the contract a port reproduces) is what brief.ts
//      computes now, and its briefs validate too.
// Run: node --import @bp/core/register scripts/check-decision-brief.ts
import fs from 'node:fs';
import path from 'node:path';
import { BRIEF_LINES, BRIEF_WIDTH, briefAdvice, briefFor, briefMapOf, briefMapOfStructure, repeatNote, subjectOf, type Brief, type BriefMap, type BriefSubject } from '../packages/core/src/scan/brief.ts';
import { TOOLS, classOf } from '../packages/core/src/companion/catalog.ts';
import { loadMap } from '../packages/core/src/data/index.ts';
import { GOLDEN, golden } from './brief-golden.ts';
import { TRAIL_WINDOW_MS, trailSessions, type TrailRow } from '../packages/core/src/companion/trail.ts';
import { emptyScan, type Pack, type Proposal, type Run, type ScanSnapshot } from '../packages/core/src/scan/types.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const failures: string[] = [];
let passed = 0;
const ok = (n: number, cond: boolean, what: string, got?: unknown) => { if (cond) passed++; else failures.push(`${n}. ${what}${got !== undefined ? '  (got ' + JSON.stringify(got) + ')' : ''}`); };
const built: Brief[] = [];
const fact = (b: Brief, key: string) => { if (!built.includes(b)) built.push(b); return b.facts.find((f) => f.key === key); };

// ------------------------------------------------------------------------------------------- fixtures
const map: BriefMap = briefMapOf({
  domains: [{ slug: 'booking', name: 'Booking & Attendance' }, { slug: 'payments', name: 'Payments' }],
  capabilities: [{ slug: 'booking.core', name: 'Booking', domain: 'booking' }, { slug: 'booking.waits', name: 'Waitlists', domain: 'booking' }, { slug: 'payments.billing', name: 'Billing', domain: 'payments' }],
  features: [
    { slug: 'book-a-class', id: 'BKG-01', name: 'Book a class', capability: 'booking.core', stage: 'live' },
    { slug: 'cancel', id: 'BKG-02', name: 'Cancel', capability: 'booking.core', depends_on: ['book-a-class'] },
    { slug: 'waitlist', id: 'BKG-04', name: 'Waitlist', capability: 'booking.waits', depends_on: ['book-a-class'] },
    { slug: 'promote', id: 'BKG-05', name: 'Auto-promote', capability: 'booking.waits', depends_on: ['waitlist', 'book-a-class'] },
    { slug: 'card-payments', id: 'PAY-07', name: 'Card payments', capability: 'payments.billing' },
    { slug: 'lonely', name: 'Lonely', capability: 'payments.billing' },
  ],
  lenses: [{ id: 'security', name: 'Security' }, { id: 'development', name: 'Development' }],
});
const day = (d: number) => new Date(Date.parse('2026-10-20T12:00:00Z') - d * 86400000).toISOString();
const P = (x: Partial<Proposal> & { id: string }): Proposal => ({ run_id: 'r0', feature: 'cancel', lens: 'security', title: x.id + ' title', standard: 'none', kind: 'fix', status: 'approved', created_at: day(30), updated_at: day(20), decided_at: day(20), decided_by: 'user:owner', ...x });
const scanOf = (proposals: Proposal[], runs: Run[] = [], packs: Pack[] = []): ScanSnapshot => ({ ...emptyScan(), proposals, runs, packs });

// 1. no history
{
  const b = briefFor({ feature: 'lonely', title: 'Tidy the lonely page', lens: 'security' }, scanOf([]), map);
  ok(1, fact(b, 'precedent')?.text === 'No precedent yet under Security', 'no precedent yet under the lens', fact(b, 'precedent')?.text);
  ok(1, /nothing depends on it/.test(fact(b, 'blast')?.text ?? ''), 'nothing depends on it', fact(b, 'blast')?.text);
  ok(1, /after release unknown \(no risk class\)/.test(fact(b, 'undo')?.text ?? ''), 'risk class unknown is said', fact(b, 'undo')?.text);
  ok(1, fact(b, 'cost')?.text === 'Cost: no build history yet' && b.cost.builds === 0, 'no build history yet', fact(b, 'cost')?.text);
  ok(1, b.advice.say === 'proceed' && b.advice.why === 'no precedent yet' && !fact(b, 'declined'), 'advice proceed, no declined line', b.advice);
}
// 2. not on the plan
{
  const b = briefFor({ feature: 'ghost', title: 'x' }, scanOf([]), map);
  ok(2, fact(b, 'blast')?.text === 'Touches ghost, which is not on the plan: blast radius unknown' && b.blast.feature === undefined && !('feature' in b.blast) && fact(b, 'blast')!.ids.length === 0, 'not on the plan', fact(b, 'blast'));
}
// 3. blast
{
  const b = briefFor({ feature: 'book-a-class', title: 'x', lens: 'security' }, scanOf([]), map);
  ok(3, fact(b, 'blast')?.text === 'Touches Book a class (BKG-01) in Booking · 3 features depend on it, in 2 rooms', 'dependents and rooms', fact(b, 'blast')?.text);
  ok(3, JSON.stringify(fact(b, 'blast')?.ids) === JSON.stringify(['cancel', 'waitlist', 'promote']) && b.blast.wing?.name === 'Booking & Attendance' && b.blast.stage === 'live', 'ids, wing, stage', b.blast);
}
// 4. precedent: same lens and tier
const sec = [
  P({ id: 'S1', tier: 1, status: 'released' }), P({ id: 'S2', tier: 1, status: 'accepted' }), P({ id: 'S3', tier: 1, status: 'done' }),
  P({ id: 'S4', tier: 1, status: 'approved' }), P({ id: 'S5', tier: 1, status: 'failed' }),
  P({ id: 'S6', tier: 1, status: 'declined', decision_note: 'Not while the auth rewrite is open.' }),
  P({ id: 'S7', tier: 2, status: 'declined' }), P({ id: 'D1', lens: 'development', tier: 1, status: 'declined' }),
];
{
  const o = P({ id: 'O1', feature: 'lonely', title: 'Add rate limits to the booking API', tier: 1, risk_class: 'reliability', status: 'proposed' });
  const b = briefFor(subjectOf(o), scanOf([...sec, o]), map);
  ok(4, fact(b, 'precedent')?.text === 'You approved 5 of 6 similar decisions under Security, tier 1 · declined 1', 'approved 5 of 6 under the lens and tier', fact(b, 'precedent')?.text);
  ok(4, fact(b, 'precedent')?.ids.length === 6 && !fact(b, 'precedent')!.ids.includes('S7') && !fact(b, 'precedent')!.ids.includes('D1'), 'evidence is the 6 rows, not the tier-2 or other-lens ones', fact(b, 'precedent')?.ids);
  ok(4, !fact(b, 'declined') && b.advice.say === 'proceed', 'a same-lens decline is precedent, not a stand against this idea', b.advice);
}
// 5. declines: quoted, latest first, one per standard
{
  const h8 = P({ id: 'H8', feature: 'card-payments', lens: 'development', title: 'Retry failed card captures in the job queue', standard: 'reliability/retry-backoff', status: 'declined', decided_at: day(9), decision_note: 'Same as checkout: idempotency first.' });
  const h7 = P({ id: 'H7', feature: 'card-payments', lens: 'development', title: 'Add retries to checkout payment calls', standard: 'reliability/retry-backoff', status: 'declined', decided_at: day(5), decision_note: 'No retries until idempotency keys land.' });
  const o = P({ id: 'O2', feature: 'card-payments', lens: 'development', title: 'Retry the payment webhook on timeout', standard: 'reliability/retry-backoff', status: 'proposed', risk_class: 'money' });
  const b = briefFor(subjectOf(o), scanOf([h8, h7, o]), map);
  ok(5, b.declines.length === 1 && b.declines[0].id === 'H7', 'one decline per standard, the latest', b.declines.map((d) => d.id));
  ok(5, fact(b, 'declined')?.text === `Declined ${day(5).slice(0, 10)} by owner: "No retries until idempotency keys land." (H7)`, "the owner's words, quoted", fact(b, 'declined')?.text);
  ok(5, b.advice.say === 'withdraw' && /No retries until idempotency keys land/.test(b.advice.why), 'advice withdraw, quoting', b.advice);
  ok(5, /money risk, a revert PR may not undo it/.test(fact(b, 'undo')?.text ?? ''), '7. money: a revert may not undo it', fact(b, 'undo')?.text);
  // 6. words
  const d = briefFor({ feature: 'card-payments', title: 'add retry to checkout' }, scanOf([h8, h7]), map);
  ok(6, d.declines[0]?.id === 'H7' && d.advice.say === 'withdraw', 'a draft hears the matching decline', d.declines.map((x) => x.id));
  const fp = P({ id: 'FP', feature: 'book-a-class', lens: 'development', title: 'Fold the duplicated date helpers in book-a-class', status: 'declined', decision_note: 'Not before the release' });
  const r = briefFor({ feature: 'book-a-class', title: 'Add rate limits to the booking API', lens: 'security' }, scanOf([fp]), map);
  ok(6, r.precedent.rows.length === 0 && r.advice.say === 'proceed', 'one shared word that is the feature name is not similar', r.precedent.rows.map((x) => x.id + ':' + x.match));
}
// 7. undo by risk class
{
  const u = (rc?: BriefSubject['risk_class']) => fact(briefFor({ feature: 'lonely', title: 'x', ...(rc ? { risk_class: rc } : {}) }, scanOf([]), map), 'undo')?.text ?? '';
  ok(7, /after release, a revert PR/.test(u('reliability')) && /secret risk, a revert PR may not undo it/.test(u('secret')) && /A decline is final/.test(u()), 'undo words per risk class', [u('reliability'), u('secret')]);
}
// 8. cost
{
  const run = (id: string, lens: string, min: number, model: string): Run => ({ id, started_at: day(13), updated_at: day(13), ended_at: new Date(Date.parse(day(13)) + min * 60000).toISOString(), phase: 'execute', status: 'done', lenses: [lens], model });
  const pack: Pack = { id: 'k-sec-1', lens: 'security', n: 1, branch: 'pack/sec-1', base_ref: 'main', base_sha: '0', run_id: 'E1', status: 'triaged', created_at: day(13), updated_at: day(12) };
  const items = [P({ id: 'I1', pack_id: 'k-sec-1' }), P({ id: 'I2', pack_id: 'k-sec-1' })];
  const s = scanOf(items, [run('E1', 'security', 24, 'sonnet'), run('E2', 'design', 40, 'opus')], [pack]);
  const b = briefFor({ feature: 'lonely', title: 'x', lens: 'security' }, s, map);
  ok(8, fact(b, 'cost')?.text === 'Cost: about 12 min per item, from 1 build under Security on sonnet' && JSON.stringify(b.cost.runs) === '["E1"]', 'cost under the lens', fact(b, 'cost')?.text);
  const any = briefFor({ feature: 'lonely', title: 'x', lens: 'development' }, s, map);
  ok(8, any.cost.basis === 'any lens' && /\(any lens\)/.test(fact(any, 'cost')?.text ?? ''), 'no build under the lens: any lens, said', fact(any, 'cost')?.text);
}
// 9. budget
{
  const long = P({ id: 'L1', feature: 'card-payments', lens: 'development', title: 'Add retries to checkout', status: 'declined', decision_note: 'word '.repeat(60) });
  const b = briefFor({ feature: 'card-payments', title: 'retries to checkout', lens: 'development' }, scanOf([long]), map);
  ok(9, b.facts.length <= BRIEF_LINES && b.lines.every((l) => l.length <= BRIEF_WIDTH), `<= ${BRIEF_LINES} lines of <= ${BRIEF_WIDTH}`, b.lines.map((l) => l.length));
  ok(9, (fact(b, 'declined')?.text ?? '').endsWith('…'), 'a long note is cut with an ellipsis', fact(b, 'declined')?.text);
}
// 10. deterministic, facts == lines
{
  const s = scanOf(sec), sub: BriefSubject = { feature: 'book-a-class', title: 'Rate limits', lens: 'security', tier: 1 };
  const a = briefFor(sub, s, map), b = briefFor(sub, s, map);
  ok(10, JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a.lines) === JSON.stringify(a.facts.map((f) => f.text)), 'same input, same brief; lines are the facts');
}
// 11. the doors
{
  const t = TOOLS.find((x) => x.name === 'plan.brief');
  ok(11, !!t && classOf(t) === 'AUTO' && t.route.method === 'GET' && t.route.path === '/api/companion/brief', 'plan.brief: AUTO, GET /api/companion/brief', t?.route);
  for (const f of ['packages/core/src/server/api/companion/brief/route.ts', 'packages/core/src/server/api/products/[slug]/proposals/[id]/brief/route.ts',
    'apps/web/src/app/api/companion/brief/route.ts', 'apps/web/src/app/api/products/[slug]/proposals/[id]/brief/route.ts']) ok(11, fs.existsSync(path.join(ROOT, f)), 'exists: ' + f);
  const src = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const card = src('apps/web/src/components/Overlays.tsx'), review = src('apps/web/src/components/rail/wide/review.tsx');
  ok(11, /useBrief\(/.test(card) && /<BriefFacts /.test(card), 'the plan decision card renders the brief');
  ok(11, /useBrief\(/.test(review) && /<BriefFacts /.test(review), 'the Review detail renders the brief');
  ok(11, /items\.filter\(\(d\) => d\.recNote\)/.test(review) && /if \(!armed\) \{ setArmRepeats\(repeats\.map\(\(d\) => d\.id\)\); return; \}/.test(review) && /for \(const d of armed\) E\.decide\(d\.id, 1, d\.recNote\)/.test(review),
    'Review declines the repeats it armed (the listed ones) on a second click, each with its repeat note');
  // 19. the person's own decline form never gets the repeat note: it sends '' for "no note", which Engine.decide keeps
  const phone = src('apps/web/src/components/Phone.tsx');
  ok(11, !/note\.trim\(\) \|\| undefined/.test(review) && !/note\.trim\(\) \|\| undefined/.test(phone) && /decide\(d, 1, note\.trim\(\)\)/.test(review) && /E\.decide\(d\.id, 1, note\.trim\(\)\)/.test(phone),
    "19. the decline note forms send '' for no note, so a repeat note is never added to the person's own decline");
}

// 12. the recommendation
{
  const h7 = P({ id: 'H7', feature: 'card-payments', lens: 'development', title: 'Add retries to checkout payment calls', standard: 'reliability/retry-backoff', status: 'declined', decided_at: day(5), decision_note: 'No retries until idempotency keys land.' });
  const o = P({ id: 'O2', feature: 'card-payments', lens: 'development', title: 'Retry the payment webhook on timeout', standard: 'reliability/retry-backoff', status: 'proposed' });
  const s = scanOf([h7, o]), a = briefAdvice(subjectOf(o), s), full = briefFor(subjectOf(o), s, map);
  ok(12, a.say === full.advice.say && a.why === full.advice.why && a.decline?.id === 'H7', 'briefAdvice is the brief advice', a);
  ok(12, a.decline ? repeatNote(a.decline) === `Repeats H7, declined ${day(5).slice(0, 10)}: "No retries until idempotency keys land."` : false, 'the repeat note', a.decline && repeatNote(a.decline));
  ok(12, repeatNote({ ...a.decline!, note: 'x'.repeat(900) }).length === 500, 'the note is bounded to 500');
  const none = briefAdvice({ feature: 'lonely', title: 'y', lens: 'security' }, s);
  ok(12, none.say === 'proceed' && !none.decline, 'no stand, no flip', none);
  const src = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(12, /briefAdvice\(/.test(src('packages/core/src/model/live-feed.ts')) && /recommended: 1, recommendedNote: repeatNote\(rep\)/.test(src('packages/core/src/model/live-feed.ts')), 'liveSwarm recommends Decline on a repeat');
  ok(12, /note \?\?= oi === d\.rec && oi === 1 \? d\.recNote/.test(src('apps/web/src/engine/Engine.ts')), 'Engine.decide carries the repeat note on the recommended Decline');
}

// 13. the agent trail
{
  const T0 = Date.parse('2026-10-20T12:00:00Z'), at = (s: number) => new Date(T0 + s * 1000).toISOString();
  const read = (c: string, s: number, x: Partial<TrailRow & { kind: 'brief' }> = {}): TrailRow => ({ at: at(s), conversation: c, kind: 'brief', product: 'p', feature: 'card-payments', featureName: 'Card payments', title: 'Add retry to checkout', advice: 'withdraw', declineId: 'H7', quoted: 'No retries until idempotency keys land.', ...x });
  const rows: TrailRow[] = [
    read('a', 1), read('a', 2, { id: 'O2', title: 'Retry the payment webhook on timeout' }),
    { at: at(3), conversation: 'a', kind: 'recommend', product: 'p', id: 'O2', verdict: 'decline', why: 'Repeats H7: "No retries until idempotency keys land."' },
    read('b', 4), read('b', 5, { id: 'O9', advice: 'proceed', feature: 'card-payments' }),
    { at: at(6), conversation: 'b', kind: 'recommend', product: 'p', id: 'O9', verdict: 'approve', why: 'fine' },
    read('c', 7, { advice: 'proceed' }),
  ];
  const ss = trailSessions(rows, T0 + 60000), by = (c: string) => ss.find((x) => x.conversation === c);
  const a = by('a')?.lines.map((l) => l.text) ?? [];
  ok(13, a.length === 3 && /^Was about to propose "Add retry to checkout" on Card payments; read your decline H7: "No retries until idempotency keys land\."$/.test(a[0]) && /^Withdrew it/.test(a[1]) && a[2] === 'Then recommended you decline O2 "Retry the payment webhook on timeout": it repeats your decline H7', 'heard, withdrew, the act by id', a);
  ok(13, !(by('b')?.lines ?? []).some((l) => /^Withdrew/.test(l.text)), 'a later approval on the same feature: no "withdrew"', by('b')?.lines);
  ok(13, by('c')?.lines[0]?.text === 'Read 1 brief; none met a standing decline', 'a quiet session says so', by('c')?.lines);
  ok(13, ss[0]?.conversation === 'c' && trailSessions(rows, T0 + TRAIL_WINDOW_MS + 60000).length === 0, 'newest first; old sessions go');
  ok(13, /AgentTrail/.test(fs.readFileSync(path.join(ROOT, 'apps/web/src/components/companion/CompanionLive.tsx'), 'utf8')) && fs.existsSync(path.join(ROOT, 'apps/web/src/app/api/companion/trail/route.ts')), 'the slip shows the trail; its route is mounted');
}

// 13b. product filter
{
  const r = (c: string, product: string): TrailRow => ({ at: '2026-10-20T12:00:00Z', conversation: c, kind: 'brief', product, feature: 'f', title: 't', advice: 'proceed' });
  const ss = trailSessions([r('x', 'kettle-live'), r('y', 'kettle')], Date.parse('2026-10-20T12:01:00Z'), 3, 'kettle');
  ok(13, ss.length === 1 && ss[0].conversation === 'y', 'the product filter keeps that product only', ss.map((x) => x.conversation));
}
// 14. one map, two reads
{
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
  type M = ReturnType<typeof briefMapOf>;
  const norm = (m: M) => JSON.stringify({ f: m.features.map((f) => [f.slug, f.id, f.name, f.capability, f.stage, (f.depends_on ?? []).join()]).sort(), c: m.capabilities.map((c) => [c.slug, c.name, c.domain]).sort(), d: m.domains.map((d) => [d.slug, d.name]).sort(), l: m.lenses.map((l) => [l.id, l.name]).sort() });
  const a = briefMapOf(raw), b = briefMapOfStructure(loadMap(raw, ''));
  ok(14, a.features.length === 133 && norm(a) === norm(b), 'briefMapOf and briefMapOfStructure agree on Kettle', [a.features.length, b.features.length]);
}

// 17. the same place is not the same idea: an unrelated decline on the same feature and lens is precedent, never a stand
{
  const other = P({ id: 'U1', feature: 'card-payments', lens: 'security', title: 'Rotate the payment keys monthly', standard: 'secrets/key-rotation', status: 'declined', decision_note: 'Not while the auth rewrite is open.' });
  const o = P({ id: 'U2', feature: 'card-payments', lens: 'security', title: 'Add CSRF tokens to the checkout form', standard: 'web/csrf', status: 'proposed' });
  const b = briefFor(subjectOf(o), scanOf([other, o]), map);
  ok(17, !fact(b, 'declined') && b.advice.say === 'proceed' && b.precedent.declined === 1 && b.precedent.rows[0]?.match === 'same lens', 'an unrelated decline on the same feature + lens: counted, not quoted, no flip', { advice: b.advice, rows: b.precedent.rows.map((r) => r.id + ':' + r.match) });
  const same = P({ id: 'U3', feature: 'card-payments', lens: 'security', title: 'Rotate the payment keys every week', standard: 'secrets/key-rotation', status: 'proposed' });
  const c = briefFor(subjectOf(same), scanOf([other, same]), map);
  ok(17, c.advice.say === 'withdraw' && c.declines[0]?.id === 'U1' && c.declines[0]?.match === 'same idea', 'the same idea on the same place still stands', c.declines.map((r) => r.id + ':' + r.match));
}
// 18. only the same idea stands (a decline is final, so the flip is held to the strictest reading)
{
  const mapX = briefMapOf({ domains: [{ slug: 'd', name: 'D' }], capabilities: [{ slug: 'c', name: 'C', domain: 'd' }],
    features: [{ slug: 'auth', name: 'Auth', capability: 'c' }, { slug: 'search', name: 'Search', capability: 'c' }, { slug: 'checkout', name: 'Checkout', capability: 'c' }], lenses: [] });
  const dec = (x: Partial<Proposal> & { id: string }) => P({ status: 'declined', decision_note: 'Not now.', ...x });
  const open = (x: Partial<Proposal> & { id: string }) => P({ status: 'proposed', ...x });
  const say = (o: Proposal, rows: Proposal[]) => briefFor(subjectOf(o), scanOf([...rows, o]), mapX);
  const a = say(open({ id: 'A2', feature: 'auth', title: 'Add CSRF protection to the login endpoint' }), [dec({ id: 'A1', feature: 'auth', title: 'Add rate limits to the login endpoint' })]);
  ok(18, a.advice.say !== 'withdraw' && !a.declines.length, 'same place, 2 of 6 words shared: not the same idea', a.declines.map((r) => r.id + ':' + r.match));
  const u = say(open({ id: 'U2', feature: 'checkout', title: 'Add unit tests for payment retry' }), [dec({ id: 'U1', feature: 'search', title: 'Add unit tests for search ranking' })]);
  ok(18, u.advice.say === 'proceed' && !u.declines.length, 'another feature, 2 of 6 words shared: nothing', u.advice);
  const w = say(open({ id: 'W2', feature: 'checkout', title: 'Describe the checkout images', standard: 'wcag/alt-text' }), [dec({ id: 'W1', feature: 'search', title: 'Describe the search thumbnails', standard: 'wcag/alt-text' })]);
  ok(18, w.advice.say === 'ask' && w.declines[0]?.id === 'W1' && !!fact(w, 'declined') && !briefAdvice(subjectOf(P({ id: 'W2', feature: 'checkout', title: 'Describe the checkout images', standard: 'wcag/alt-text', status: 'proposed' })), scanOf([dec({ id: 'W1', feature: 'search', title: 'Describe the search thumbnails', standard: 'wcag/alt-text' })])).say.startsWith('withdraw'),
    'the same standard on another feature: shown and asked about, never a stand', w.advice);
  const r = say(open({ id: 'R2', feature: 'checkout', title: 'Retry the checkout payment call on timeout' }), [dec({ id: 'R1', feature: 'checkout', title: 'Add retries to the checkout payment call' })]);
  ok(18, r.advice.say === 'withdraw' && r.declines[0]?.match === 'same idea', 'same place, the same idea in other words: a stand', r.declines.map((x) => x.id + ':' + x.match));
  // a run whose times do not read is left out of the cost, never NaN (the wire omits, never nulls)
  const bad: Run = { id: 'B1', started_at: 'not a time', updated_at: day(1), ended_at: day(1), phase: 'execute', status: 'done', lenses: ['security'] };
  const nb = briefFor({ feature: 'lonely', title: 'x', lens: 'security' }, scanOf([], [bad]), map);
  ok(18, nb.cost.builds === 0 && !JSON.stringify(nb).includes('null') && fact(nb, 'cost')?.text === 'Cost: no build history yet', 'an unreadable run: no build history, no null, no NaN', nb.cost);
}
// 20. the second review's matrix: on the same feature and lens, opposite or different actions never stand (declined
//     first, open second); real re-wordings still do (the positive controls)
{
  const mapY = briefMapOf({ domains: [{ slug: 'd', name: 'D' }], capabilities: [{ slug: 'c', name: 'C', domain: 'd' }], features: [{ slug: 'f', name: 'Thing', capability: 'c' }], lenses: [] });
  const pair = (a: string, b: string, std = 'none') => briefFor(subjectOf(P({ id: 'N', feature: 'f', title: b, standard: std, status: 'proposed' })), scanOf([P({ id: 'D', feature: 'f', title: a, standard: std, status: 'declined' })]), mapY).advice.say;
  const never: [string, string][] = [
    ['Disable caching for search results', 'Enable caching for search results'], ['Remove dark mode', 'Add dark mode'], ['Do not retry failed payments', 'Retry failed payments'],
    ['Retry failed payments', 'Stop retrying failed payments'], ['Increase request timeout', 'Decrease request timeout'], ['Raise rate limits', 'Lower rate limits'],
    ['Show error banner', 'Hide error banner'], ['Compress product images', 'Cache product images'], ['Cache search results', 'Paginate search results'],
    ['Log slow queries', 'Index slow queries'], ['Validate uploaded file size', 'Limit uploaded file size'],
  ];
  const bad = never.filter(([a, b]) => pair(a, b) === 'withdraw' || pair(a, b, 'perf/x') === 'withdraw');
  ok(20, bad.length === 0, `none of ${never.length} opposite or different-action pairs stands, with or without a shared standard`, bad);
  ok(20, pair('Add an empty state to the order list', 'Show a retry on the error state of the order list', 'design/state-coverage') === 'ask', 'a broad shared standard with a different action: ask, not a stand');
  const real: [string, string, string][] = [
    ['Add retries to checkout payment calls', 'Retry the payment webhook on timeout', 'reliability/retry-backoff'], ['Rotate the payment keys monthly', 'Rotate the payment keys every week', 'secrets/key-rotation'],
    ['Retry failed payments', 'Retry failed payments on timeout', 'none'], ['Add rate limits to the login endpoint', 'Rate-limit the login endpoint', 'api/rate-limits'],
  ];
  const missed = real.filter(([a, b, s]) => pair(a, b, s) !== 'withdraw');
  ok(20, missed.length === 0, `each of ${real.length} real re-wordings still stands`, missed);
}
// 14b. one map, two reads, on a rough non-Kettle map: long ids, a capability with an unknown domain, a dangling and a
//      self depends_on, a feature with no capability (the loader's Unplaced)
{
  const rough = { $schema: 'app-structure/3', version: 3, project: { slug: 'rough', name: 'Rough' },
    domains: [{ slug: 'shop', id: 'SHOP-DOMAIN-LONG', name: 'Shop' }, { slug: 'ops', id: 'OPS', name: 'Ops' }],
    capabilities: [{ slug: 'shop.cart', id: 'CART-CAPABILITY', name: 'Cart', domain: 'shop' }, { slug: 'ghost.cap', id: 'GH', name: 'Ghost', domain: 'nowhere' }, { slug: 'ops.run', id: 'RUN', name: 'Run', domain: 'ops' }],
    features: [
      { slug: 'checkout', id: 'feature-checkout-flow', name: 'Checkout', capability: 'shop.cart' },
      { slug: 'basket', id: 'B-1', name: 'Basket', capability: 'shop.cart', depends_on: ['checkout', 'missing', 'basket'] },
      { slug: 'haunted', id: 'H-1', name: 'Haunted', capability: 'ghost.cap', depends_on: ['checkout'] },
      { slug: 'loose', name: 'Loose', depends_on: ['checkout'] },
      { slug: 'deploy', id: 'D-1', name: 'Deploy', capability: 'ops.run' },
    ] };
  type M = ReturnType<typeof briefMapOf>;
  const norm = (m: M) => JSON.stringify({ f: m.features.map((f) => [f.slug, f.id ?? '', f.name, f.capability, f.stage ?? '', (f.depends_on ?? []).join()]).sort(), c: m.capabilities.map((c) => [c.slug, c.id ?? '', c.name, c.domain]).sort(), d: m.domains.map((d) => [d.slug, d.id ?? '', d.name]).sort() });
  const a = briefMapOf(rough), b = briefMapOfStructure(loadMap(rough, ''));
  ok(14, norm(a) === norm(b), 'briefMapOf and the loader agree on a rough map', [norm(a), norm(b)]);
  const sub = { feature: 'checkout', title: 'x' };
  ok(14, JSON.stringify(briefFor(sub, scanOf([]), a).facts) === JSON.stringify(briefFor(sub, scanOf([]), b).facts) && /Touches Checkout in Cart · 3 features depend on it, in 2 rooms/.test(briefFor(sub, scanOf([]), b).lines[0]),
    'the same blast line from either read (no long code; Unplaced counted as a room)', briefFor(sub, scanOf([]), b).lines[0]);
}
// 16. the golden file (before the wire, so its briefs are validated with the rest)
{
  const now = golden(), committed = fs.existsSync(GOLDEN) ? fs.readFileSync(GOLDEN, 'utf8').replace(/\r\n/g, '\n') : '';
  ok(16, committed === now, 'docs/concepts/decision-brief/golden.json is current (node scripts/brief-golden.ts --write)');
  const g = JSON.parse(now) as { cases: { brief: Brief }[] };
  for (const c of g.cases) built.push(c.brief);
  ok(16, g.cases.length === 5 && g.cases.some((c) => c.brief.advice.say === 'withdraw') && g.cases.some((c) => /No precedent yet/.test(c.brief.lines.join('\n'))), 'the golden covers a withdraw and a no-precedent case');
}
// 15. the wire
{
  const Ajv2020Module = await import('ajv/dist/2020.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const M = Ajv2020Module as any, Ajv2020 = M.default?.default ?? M.default ?? M;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/schema/schema/decision-brief-1.schema.json'), 'utf8')));
  const bad = built.filter((b) => !validate(JSON.parse(JSON.stringify(b))));
  ok(15, built.length >= 8 && bad.length === 0, `the ${built.length} briefs above validate against decision-brief-1`, bad[0] && validate(bad[0]) === false ? validate.errors?.slice(0, 2) : undefined);
  const b0 = JSON.parse(JSON.stringify(built[0]));
  ok(15, !validate({ ...b0, lines: [...b0.lines, 'a', 'b', 'c', 'd', 'e', 'f'] }) && !validate({ ...b0, blast: { ...b0.blast, feature: null } }), 'control: a sixth line, or a null feature, is refused');
}

console.log(`check-decision-brief: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('FAIL  ' + f); process.exit(1); }
