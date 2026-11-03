// Checks how a change already on the base branch is judged (packages/core/src/scan/track.ts, TrackOpts.landed): an
// accepted item git says landed is judged by the release's confirm rule, its landing time standing in for the release's.
//   1 parity      on identical readings the landed branch gives the released branch's stage, outcome and verdict words:
//                 held, short of expected, not measured since (no reading after, or only an observation before), no
//                 expected value; labels say 'landed · held / short of expected / not measured since', never "regressed"
//   2 time        git's committer time with an offset compares as UTC: a reading 30 min after a "+01:00" landing is evidence
//   3 scope       only `accepted` takes the landed branch: a landed done, failed or rework item keeps its stage; no landing
//                 keeps 'accepted · awaiting release'
//   4 note        R on a short landed item starts from "Short on master: <metric> <branch> on <pack branch> -> <now> on
//                 <day>, expected <x>"; nothing for held or unmeasured
//   5 record      priorRecord counts landed rows beside the released ones ("of 3 landed"), its entries say "Landed · held"
//   6 morning     buildDeck turns the items that landed in the window into one card, held / short / not measured since,
//                 counted in the product's confirmed and short
//   7 M fan-out   measureScopes: one selection scan per lens over that lens's items' features, each once, capped (the jobs
//                 themselves, on the sim and the live routes: check:train-parity 'measureItems over two lenses')
// Also: node scripts/check-on-main.ts --root <repo> prints that repo's In-packs chips (Held / Short / Not measured since)
// from its store (read-only), the landings and ancestry git gives and its map's lens bounds, through the same functions,
// with the short ids, the out-of-bounds targets, how many were judged by commit or by time, and the observation cohorts.
// Run: node scripts/check-on-main.ts   (Node type stripping; exit 1 on any failure)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const core = (p: string) => pathToFileURL(path.join(ROOT, 'packages/core/src', p)).href;
const TR = await import(core('scan/track.ts')) as typeof import('../packages/core/src/scan/track.ts');
const RC = await import(core('scan/record.ts')) as typeof import('../packages/core/src/scan/record.ts');
const JB = await import(core('scan/jobs.ts')) as typeof import('../packages/core/src/scan/jobs.ts');
const MW = await import(core('companion/morning.ts')) as typeof import('../packages/core/src/companion/morning.ts');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const at = process.argv.indexOf('--root');
if (at >= 0) {
  const root = path.resolve(process.argv[at + 1] ?? '.');
  const S = await import(core('server/store.server.ts')) as typeof import('../packages/core/src/server/store.server.ts');
  const R = await import(core('server/release.server.ts')) as typeof import('../packages/core/src/server/release.server.ts');
  const scan = S.snapshotOf(path.join(root, '.ai/lens-scan/scan.db'));
  const l = await R.landings(root, scan);
  if (l.state !== 'known') { console.log(`landings on ${root}: unknown (${l.why})`); process.exit(0); }
  let lenses: Any[] = [];
  try { lenses = JSON.parse((await import('node:fs')).readFileSync(path.join(root, '.ai/lens-scan/app-structure.json'), 'utf8')).lenses ?? []; } catch { /* no map: no bounds */ }
  const opts = TR.evidenceOpts(l, lenses);
  const tally: Record<string, string[]> = {}, judged: Any[] = [];
  for (const p of scan.proposals) {
    if (!p.pack_id) continue;
    const t = TR.trackOf(scan, p.id, opts), o = t && TR.mainOutcome(t);
    if (o) (tally[o] ??= []).push(p.id);
    if (o && t!.evidence) judged.push(t);
  }
  const n = (k: string) => tally[k]?.length ?? 0;
  console.log(`In packs on ${root} (${l.ref} at ${l.head.slice(0, 7)}): Held ${n('held')} · Short ${n('short')} · Not measured since ${n('unmeasured')}${n('no-target') ? ' · No expected value ' + n('no-target') : ''}${n('out-of-bounds') ? ' · Target out of bounds ' + n('out-of-bounds') : ''}`);
  const cohorts = TR.cohortsOf(judged), shared = [...cohorts.values()].filter((x) => x.length > 1);
  console.log(`  judged by a reading: ${judged.length} (by commit ${judged.filter((t) => t.by === 'commit').length}, by time ${judged.filter((t) => t.by === 'time').length}) in ${cohorts.size} observation cohort${cohorts.size === 1 ? '' : 's'}${shared.length ? '; shared: ' + shared.map((x) => x.join('+')).join(', ') : ''}; ancestry pairs ${Object.values(l.ancestry ?? {}).reduce((a, r) => a + Object.keys(r).length, 0)}`);
  for (const id of tally.short ?? []) {
    const t = TR.trackOf(scan, id, opts)!;
    console.log(`  short ${id}: ${t.label} (${t.currentMethod ?? 'method not recorded'}) · ${TR.shortNote(t, l.ref)}`);
  }
  for (const id of tally['out-of-bounds'] ?? []) console.log(`  out of bounds ${id}: ${TR.trackOf(scan, id, opts)!.label}`);
  for (const id of tally['no-target'] ?? []) console.log(`  no expected value ${id}: ${TR.trackOf(scan, id, opts)!.label}`);
  for (const id of tally.unmeasured ?? []) { const t = TR.trackOf(scan, id, opts)!; if (t.ineligible) console.log(`  not counted ${id}: ${t.ineligible}`); }
  process.exit(0);
}

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

// ------------------------------------------------------------------ the fixture: one item, a release or a landing at h(5)
const T0 = '2026-10-01T10:00:00.000Z', h = (n: number) => new Date(Date.parse(T0) + n * 3600000).toISOString();
let mid = 0;
const M = (value: number, measured_at: string, x: Any = {}) => ({ id: ++mid, run_id: 'r0', feature: 'f-a', lens: 'design', metric: 'standardsPct', value, unit: '%', method: 'judgement', measured_at, ...x });
const pack = { id: 'k-des-2', lens: 'design', n: 1, branch: 'pack/des-2', base_ref: 'master', base_sha: 'a'.repeat(40), status: 'open', created_at: h(2), updated_at: h(2) };
const item = { id: 'p-1', run_id: 'r0', feature: 'f-a', lens: 'design', metric: 'standardsPct', title: 'Hold the standard', standard: 'none', kind: 'fix', expected_delta: 50,
  decided_by: 'agent:director', decided_at: h(1), pack_id: 'k-des-2', commit_sha: 'b'.repeat(40), created_at: T0, updated_at: h(3) };
const rel = { id: 'rel-1.0.0', version: '1.0.0', branch: 'release/1.0.0', status: 'merged', created_at: h(4), updated_at: h(5) };
const before = [M(50, h(0.5)), M(50, h(1.5), { proposal_id: 'p-1', phase: 'before' }), M(100, h(2.5), { proposal_id: 'p-1', phase: 'after', commit_sha: 'b'.repeat(40) })];
const landing = { sha: 'c'.repeat(40), at: h(5), by: 'trailer' as const };
const scanOf = (status: string, extra: Any[], x: Any = {}) => ({ packs: [pack], releases: status === 'released' ? [rel] : [], measurements: [...before, ...extra], proposals: [{ ...item, status, ...(status === 'released' ? { release_id: rel.id } : {}), ...x }] }) as Any;
const asReleased = (extra: Any[], x?: Any) => TR.trackOf(scanOf('released', extra, x), 'p-1')!;
const asLanded = (extra: Any[], x?: Any, at = landing.at) => TR.trackOf(scanOf('accepted', extra, x), 'p-1', { landed: { 'p-1': { ...landing, at } } })!;

// ------------------------------------------------------------------ 1 parity on identical readings
const cases: [string, Any[], Any, string, string][] = [
  ['a reading after meets the expected value', [M(100, h(6))], undefined, 'confirmed', 'held'],
  ['a reading after falls short', [M(50, h(6))], undefined, 'not-confirmed', 'short'],
  ['no reading after', [], undefined, 'unknown', 'unmeasured'],
  ['only an observation before', [M(100, h(4.5))], undefined, 'unknown', 'unmeasured'],
  ['no expected value', [M(100, h(6))], { expected_delta: undefined }, 'unknown', 'no-target'],
];
for (const [what, extra, x, stage, outcome] of cases) {
  const r = asReleased(extra, x), l = asLanded(extra, x);
  check(`1 ${what}: landed gives the released stage (${stage}) and outcome (${outcome})`, r.stage === stage && l.stage === stage && TR.mainOutcome(r) === outcome && TR.mainOutcome(l) === outcome && r.evidence === l.evidence && r.next === l.next,
    JSON.stringify([r.stage, l.stage, TR.mainOutcome(r), TR.mainOutcome(l), r.evidence, l.evidence]));
}
check('1 words: landed · held / short of expected / not measured since', asLanded([M(100, h(6))]).label === 'landed · held · measured 100 (expected 100)'
  && asLanded([M(50, h(6))]).label === 'landed · short of expected · measured 50, expected 100' && asLanded([]).label === 'landed · not measured since',
  JSON.stringify([asLanded([M(100, h(6))]).label, asLanded([M(50, h(6))]).label, asLanded([]).label]));
check('1 the released words are unchanged', asReleased([M(100, h(6))]).label === 'confirmed · measured 100 (expected 100)' && asReleased([M(50, h(6))]).label === 'measured 50, expected 100' && asReleased([]).label === 'released · not measured since');
check('1 the record says it from the landing, never "regressed"', asLanded([M(50, h(6))]).lines.some((x) => x === 'Short of expected: the reading after it landed falls short of the expected value')
  && asLanded([M(100, h(4.5))]).lines.some((x) => /observation from before it landed/.test(x)) && !asLanded([M(50, h(6))]).lines.some((x) => /regress/i.test(x)), asLanded([M(50, h(6))]).lines.join(' | '));
check('1 the method of the reading on main rides on the track', asLanded([M(50, h(6))]).currentMethod === 'judgement');

// ------------------------------------------------------------------ 2 git's offset time
const plus1 = '2026-10-01T16:00:00+01:00'; // 15:00Z
check('2 a reading 30 min after a "+01:00" landing is evidence; 30 min before is an observation',
  asLanded([M(100, '2026-10-01T15:30:00.000Z')], undefined, plus1).stage === 'confirmed' && asLanded([M(100, '2026-10-01T14:30:00.000Z')], undefined, plus1).stage === 'unknown');

// ------------------------------------------------------------------ 3 only accepted
for (const s of ['done', 'failed', 'rework']) {
  const plain = TR.trackOf(scanOf(s, [M(100, h(6))]), 'p-1')!, l = TR.trackOf(scanOf(s, [M(100, h(6))]), 'p-1', { landed: { 'p-1': landing } })!;
  check(`3 a landed ${s} item keeps its stage and label`, plain.stage === l.stage && plain.label === l.label && TR.mainOutcome(l) === null, JSON.stringify([plain.label, l.label]));
}
check('3 no landing: accepted · awaiting release', TR.trackOf(scanOf('accepted', [M(100, h(6))]), 'p-1')!.label === 'accepted · awaiting release');

// ------------------------------------------------------------------ 4 the rework note
check('4 short: the note names the branch reading, the reading on main and its day, the expected value',
  TR.shortNote(asLanded([M(50, h(30))]), 'master') === 'Short on master: standardsPct 100 % on pack/des-2 -> 50 % on 2026-10-02, expected 100 %', String(TR.shortNote(asLanded([M(50, h(30))]), 'master')));
check('4 held, unmeasured and released-short items start no note', TR.shortNote(asLanded([M(100, h(6))]), 'master') === null && TR.shortNote(asLanded([]), 'master') === null && TR.shortNote(asReleased([M(50, h(6))]), 'master') === null);

// ------------------------------------------------------------------ 5 the record before deciding
{
  const rows = [
    { ...item, id: 'p-1', status: 'accepted' }, { ...item, id: 'p-2', status: 'accepted', feature: 'f-b' }, { ...item, id: 'p-3', status: 'accepted', feature: 'f-c' },
    { ...item, id: 'p-4', status: 'accepted', feature: 'f-d' }, { ...item, id: 'p-open', status: 'proposed', decided_at: undefined },
  ];
  const ms = [...before, M(100, h(6)), M(50, h(0.5), { feature: 'f-b' }), M(50, h(1.5), { feature: 'f-b', proposal_id: 'p-2', phase: 'before' }), M(60, h(6), { feature: 'f-b' })];
  const scan = { packs: [pack], releases: [], measurements: ms, proposals: rows } as Any;
  const landed = { 'p-1': landing, 'p-2': landing, 'p-3': landing };
  const r = RC.priorRecord(scan, rows[4] as Any, { landed }), w = RC.recordWords(r, 'Design');
  check('5 priorRecord: 3 landed (1 held, 1 short, 1 not measured since), the unlanded one not counted', r.lens.landed === 3 && r.lens.released === 0 && r.lens.confirmed === 1 && r.lens.notConfirmed === 1 && r.lens.unknown === 1, JSON.stringify(r.lens));
  check('5 recordWords: "of 3 landed"', w.lens === 'Design: 1 confirmed, 1 not confirmed, 1 unknown of 3 landed since 2026-10-01', w.lens);
  { const x = RC.recordWords(RC.priorRecord(scan, rows[4] as Any), 'Design').lens; check('5 without landings it reads as before', x === 'Design: none of 4 decided released yet since 2026-10-01', x); }
  check('5 an entry on the same feature says "Landed · held"', w.same[0]?.startsWith('Landed · held 2026-10-01 by agent:director'), w.same.join(' | '));
}

// ------------------------------------------------------------------ 6 the Morning Watch
{
  const now = Date.parse(h(30)), since = h(4);
  const scan = { ...scanOf('accepted', [M(50, h(6))]), runs: [] };
  const facts = (landed?: Any) => [{ slug: 'bp', name: 'bp', scan, where: new Map(), ...(landed ? { landed } : {}) }] as Any;
  const d = MW.buildDeck(facts({ ref: 'master', items: { 'p-1': landing } }), [], since, now);
  const card = d.cards.find((c) => c.id === 'landed:bp');
  check('6 a landing in the window: one card, short of expected, counted short', !!card && card.kind === 'release' && card.tone === 'bad' && /1 of 1 item that landed on master is short/.test(card.headline) && d.products[0].short === 1 && d.products[0].confirmed === 0,
    JSON.stringify([card?.headline, d.products[0]]));
  check('6 its line says the numbers, not "after the release"', card?.lines[0]?.text === 'Hold the standard: expected 100 %, measured 50 %', card?.lines[0]?.text);
  check('6 the opening line counts it on the base branch', d.cards[0].lines.some((l) => l.text === 'Landed on the base branch: 0 items confirmed, 1 fell short.'), d.cards[0].lines.map((l) => l.text).join(' | '));
  const old = MW.buildDeck(facts({ ref: 'master', items: { 'p-1': { ...landing, at: h(1) } } }), [], since, now), none = MW.buildDeck(facts(), [], since, now);
  check('6 a landing before the window, or no landings: no card', !old.cards.some((c) => c.id === 'landed:bp') && !none.cards.some((c) => c.id === 'landed:bp'));
}

// ------------------------------------------------------------------ 7 M: one job per lens, scoped
{
  const items = [{ lens: 'design', feature: 'f-a' }, { lens: 'security', feature: 'f-a' }, { lens: 'design', feature: 'f-b' }, { lens: 'design', feature: 'f-a' }];
  check('7 one scope per lens, over its own items\' features, each once', JSON.stringify(JB.measureScopes(items)) === JSON.stringify([{ lens: 'design', features: ['f-a', 'f-b'] }, { lens: 'security', features: ['f-a'] }]), JSON.stringify(JB.measureScopes(items)));
  const many = Array.from({ length: JB.MAX_SELECTION + 5 }, (_, i) => ({ lens: 'design', feature: 'f-' + i }));
  check('7 a scope is capped at MAX_SELECTION features; nothing selected, no job', JB.measureScopes(many)[0].features.length === JB.MAX_SELECTION && JB.measureScopes([]).length === 0);
}

console.log(`check-on-main: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
