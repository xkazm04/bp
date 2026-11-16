// Checks the outcome tally (packages/core/src/scan/outcome.ts) the Trust panel reads:
//   1 one rule     every count is a trackOf stage read through mainOutcome: the tally over a fixture equals the tally of
//                  trackOf + mainOutcome row by row, and outcome.ts compares no reading with an expected value itself
//   2 deciders     grouped by triaged_by (who accepted) and by decided_by (who approved for building); unsigned rows say
//                  so; only items on main count (released, or accepted and landed); accepted and not landed does not
//   3 method       judgement outcomes counted apart from static and probe; a rate only from 10 measured, per method
//   4 predictor    predicted accept against the final status (open rows are not settled) and the outcome on main
//   5 slices       the same tally by trust.ts sliceOf
//   6 panel        TrustPanel renders the Outcome column and the decider lists from outcomeOf
// Also: node scripts/check-outcome.ts --root <repo> prints the panel's numbers for that repo's store (read-only) and the
// landings git gives.
// Run: node scripts/check-outcome.ts   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const core = (p: string) => pathToFileURL(path.join(ROOT, 'packages/core/src', p)).href;
const TR = await import(core('scan/track.ts')) as typeof import('../packages/core/src/scan/track.ts');
const O = await import(core('scan/outcome.ts')) as typeof import('../packages/core/src/scan/outcome.ts');
const TS = await import(core('scan/trust.ts')) as typeof import('../packages/core/src/scan/trust.ts');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const at = process.argv.indexOf('--root');
if (at >= 0) {
  const root = path.resolve(process.argv[at + 1] ?? '.');
  const S = await import(core('server/store.server.ts')) as typeof import('../packages/core/src/server/store.server.ts');
  const R = await import(core('server/release.server.ts')) as typeof import('../packages/core/src/server/release.server.ts');
  const scan = S.snapshotOf(path.join(root, '.ai/lens-scan/scan.db'));
  const l = await R.landings(root, scan);
  let lenses: { id?: string; manifest?: { fields?: { key?: string; min?: number; max?: number }[] } }[] = [];
  try { lenses = JSON.parse(fs.readFileSync(path.join(root, '.ai/lens-scan/app-structure.json'), 'utf8')).lenses ?? []; } catch { /* no map: no bounds */ }
  const r = O.outcomeOf(scan, TR.evidenceOpts(l, lenses));
  console.log(`Outcome on main for ${root}${l.state === 'known' ? ` (${l.ref} at ${l.head.slice(0, 7)})` : ` (landings unknown: ${l.why})`}: ${O.tallyWords(r.all)}`);
  for (const d of r.accepted) console.log(`  accepted by ${d.by}: ${O.tallyWords(d.tally)}`);
  for (const d of r.approved) console.log(`  approved by ${d.by}: ${O.tallyWords(d.tally)}`);
  console.log('  ' + (O.predictorWords(r.predictor) ?? 'no predictions'));
  process.exit(0);
}

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

// ------------------------------------------------------------------ fixture: items landed at h(5), read at h(6)
const T0 = '2026-10-01T10:00:00.000Z', h = (n: number) => new Date(Date.parse(T0) + n * 3600000).toISOString();
let mid = 0;
const pack = { id: 'k-1', lens: 'design', n: 1, branch: 'pack/des-1', base_ref: 'master', base_sha: 'a'.repeat(40), status: 'triaged', created_at: h(2), updated_at: h(2) };
const landing = { sha: 'c'.repeat(40), at: h(5), by: 'trailer' as const };
const rows: Any[] = [], ms: Any[] = [], landed: Record<string, Any> = {};
/** One item on feature f-<id>: baseline 50, expected +50, a reading after its landing (or none), by `method`. */
function item(id: string, status: string, x: Any = {}, read?: number, method = 'judgement', land = true) {
  const f = 'f-' + id;
  rows.push({ id, run_id: 'r0', feature: f, lens: 'design', metric: 'standardsPct', title: id, standard: 'none', kind: 'fix', expected_delta: 50, status, pack_id: 'k-1',
    category: 'technical', risk_class: 'ux', size: 'S', decided_at: h(1), created_at: T0, updated_at: h(3), ...x });
  ms.push({ id: ++mid, run_id: 'r0', feature: f, lens: 'design', metric: 'standardsPct', value: 50, unit: '%', method, measured_at: h(0.5) });
  if (read !== undefined) ms.push({ id: ++mid, run_id: 'r0', feature: f, lens: 'design', metric: 'standardsPct', value: read, unit: '%', method, measured_at: h(6) });
  if (land) landed[id] = landing;
}
const dir = { triaged_by: 'agent:director', decided_by: 'machine:lens-scan', predicted_verdict: 'accept' };
const own = { triaged_by: 'human:kazdan', decided_by: 'machine:lens-scan', predicted_verdict: 'accept' };
for (let i = 0; i < 9; i++) item('d-h' + i, 'accepted', dir, 100);
item('d-hp', 'accepted', dir, 100, 'probe');
item('d-s1', 'accepted', dir, 60); item('d-s2', 'accepted', dir, 60, 'static');
item('d-u1', 'accepted', dir); item('d-nt', 'accepted', { ...dir, expected_delta: undefined }, 100);
item('k-h1', 'accepted', { ...own, decided_by: 'human:kazdan' }, 100); item('k-u1', 'accepted', own); item('k-u2', 'accepted', own);
item('k-wait', 'accepted', own, 100, 'judgement', false); // accepted, not landed: not on main
item('x-un', 'accepted', { decided_by: 'machine:lens-scan' }, 100, 'judgement');
item('p-desc', 'descoped', { triaged_by: 'human:kazdan', predicted_verdict: 'accept' }, undefined, 'judgement', false);
item('p-fail', 'failed', { predicted_verdict: 'accept' }, undefined, 'judgement', false);
item('p-open', 'approved', { predicted_verdict: 'accept' }, undefined, 'judgement', false);
item('p-rej', 'descoped', { predicted_verdict: 'reject', category: 'product' }, undefined, 'judgement', false);
const scan = { packs: [pack], releases: [], measurements: ms, proposals: rows } as Any;
const r = O.outcomeOf(scan, { landed });

// ------------------------------------------------------------------ 1 one rule
{
  const by: Record<string, Record<string, number>> = {};
  for (const p of rows) { const t = TR.trackOf(scan, p.id, { landed }), o = t && TR.mainOutcome(t); if (o) { const k = p.triaged_by ?? 'unsigned'; (by[k] ??= {})[o] = (by[k][o] ?? 0) + 1; } }
  const mine = Object.fromEntries(r.accepted.map((d) => [d.by, Object.fromEntries(Object.entries({ held: d.tally.held, short: d.tally.short, unmeasured: d.tally.unmeasured, 'no-target': d.tally.noTarget }).filter(([, n]) => n))]));
  check('1 the tally by decider equals trackOf + mainOutcome row by row', JSON.stringify(mine, Object.keys(mine).sort()) === JSON.stringify(by, Object.keys(by).sort()) && JSON.stringify(Object.keys(mine).sort()) === JSON.stringify(Object.keys(by).sort()), JSON.stringify([mine, by]));
  const src = fs.readFileSync(path.join(ROOT, 'packages/core/src/scan/outcome.ts'), 'utf8');
  check('1 outcome.ts reads mainOutcome and judges no reading itself', /mainOutcome\(/.test(src) && !/\.value\b|expected\s*[<>]=?|>=\s*expected|<=\s*expected/.test(src));
  check('1 record.ts reads its tracks through the same cache', /trackAt as track/.test(fs.readFileSync(path.join(ROOT, 'packages/core/src/scan/record.ts'), 'utf8')));
}

// ------------------------------------------------------------------ 2 deciders
{
  const d = r.accepted.find((x) => x.by === 'agent:director')!.tally, k = r.accepted.find((x) => x.by === 'human:kazdan')!.tally;
  check('2 accepted by the director: 10 held, 2 short, 1 not measured since, 1 no expected value', d.held === 10 && d.short === 2 && d.unmeasured === 1 && d.noTarget === 1 && JSON.stringify(d.shortIds) === '["d-s1","d-s2"]', JSON.stringify(d));
  check('2 accepted by the owner: 1 held, 2 not measured since; the unlanded accept and the descope not counted', k.held === 1 && k.short === 0 && k.unmeasured === 2 && O.onMain(k) === 3, JSON.stringify(k));
  check('2 an accept nobody signed is "unsigned"', r.accepted.some((x) => x.by === 'unsigned' && x.tally.held === 1));
  check('2 by approver: machine:lens-scan approved 17 on main, the owner 1', O.onMain(r.approved.find((x) => x.by === 'machine:lens-scan')!.tally) === 17 && O.onMain(r.approved.find((x) => x.by === 'human:kazdan')!.tally) === 1, JSON.stringify(r.approved.map((x) => [x.by, O.onMain(x.tally)])));
  check('2 the most on main first', r.accepted[0].by === 'agent:director');
}

// ------------------------------------------------------------------ 3 method and rate
{
  const d = r.accepted.find((x) => x.by === 'agent:director')!.tally;
  check('3 judgement apart: 9 held and 1 short by judgement; 1 held (probe) and 1 short (static) otherwise', d.byJudgement.held === 9 && d.byJudgement.short === 1, JSON.stringify(d.byJudgement));
  check('3 judgement has 10 measured: a rate (90%); static and probe has 2: none', O.ratesOf(d).judgement === 0.9 && O.ratesOf(d).measured === undefined, JSON.stringify(O.ratesOf(d)));
  check('3 the words: counts, the method split, the rate per method', O.tallyWords(d) === '10 held · 2 short (10 by judgement) · 1 not measured since · 1 no expected value · judgement 90% held', O.tallyWords(d));
  const k = r.accepted.find((x) => x.by === 'human:kazdan')!.tally;
  check('3 under 10 measured: counts alone', O.tallyWords(k) === '1 held (all by judgement) · 2 not measured since', O.tallyWords(k));
  check('3 nothing on main', O.tallyWords(O.emptyTally()) === 'nothing on main yet');
}

// ------------------------------------------------------------------ 4 predictor
{
  const p = r.predictor;
  check('4 predicted on 22 of 23 rows: 21 accept, 1 reject', p.predicted === 22 && p.rows === 23 && p.verdicts.accept === 21 && p.verdicts.reject === 1, JSON.stringify(p));
  check('4 of 20 settled predicted accepts, 2 not accepted (descoped, failed); the approved one is not settled', p.acceptSettled === 20 && JSON.stringify(p.notAccepted) === '{"descoped":1,"failed":1}' && JSON.stringify(p.notAcceptedIds) === '["p-desc","p-fail"]', JSON.stringify(p));
  check('4 the words', O.predictorWords(p) === 'Predicted accept on 21 of 22 predicted rows (1 reject); 2 of the 20 settled were not accepted (1 descoped, 1 failed); on main: 11 held · 2 short (11 by judgement) · 3 not measured since · 1 no expected value · judgement 91% held', String(O.predictorWords(p)));
  check('4 no prediction: no line', O.predictorWords(O.outcomeOf({ ...scan, proposals: rows.map((x) => ({ ...x, predicted_verdict: undefined })) }, { landed }).predictor) === null);
}

// ------------------------------------------------------------------ 5 slices
{
  const t = r.slices.get(TS.sliceOf(rows[0]))!;
  check('5 by slice: every item on main sits in technical|design|ux|S', O.onMain(t) === O.onMain(r.all) && O.onMain(r.all) === 18, JSON.stringify([O.onMain(t), O.onMain(r.all)]));
  check('5 without landings, accepted items are not on main', O.onMain(O.outcomeOf(scan).all) === 0);
}

// ------------------------------------------------------------------ 6 the panel
{
  const src = fs.readFileSync(path.join(ROOT, 'apps/web/src/components/ledger/TrustPanel.tsx'), 'utf8');
  check('6 TrustPanel: an Outcome column from outcomeOf, deciders both ways, the predictor line', /outcomeOf\(/.test(src) && /<th scope="col">Outcome<\/th>/.test(src) && /out\.accepted/.test(src) && /out\.approved/.test(src) && /predictorWords\(/.test(src));
  check('6 TrustPanel reads landings only while open (TrustBody mounts on open)', /\{open \? <TrustBody/.test(src) && /useTrain\(/.test(src.slice(src.indexOf('function TrustBody'))));
  check('6 TrustPanel builds its options as the chips do (landedOpts: landings, ancestry, bounds)', /outcomeOf\(\{ \.\.\.scan, proposals \}, opts\)/.test(src) && /landedOpts\(T\)/.test(src) && !/\{ landed: /.test(src));
}

// ------------------------------------------------------------------ 7 out of bounds, and every reader's options
{
  const t = { ...O.emptyTally(), held: 1, outOfBounds: 1 };
  check("7 an out-of-bounds target is its own count, on main, in words (never 'no expected value')", O.onMain(t) === 2 && /1 target out of bounds/.test(O.tallyWords(t)) && !/no expected value/.test(O.tallyWords(t)) && /1 out of bounds/.test(O.tallyWords(t, ' · ', true)), O.tallyWords(t));
  const bs = fs.readFileSync(path.join(ROOT, 'packages/core/src/server/brief.server.ts'), 'utf8');
  check("7 the server brief builds its options with evidenceOpts and the map's lenses", /evidenceOpts\(l, mapLenses\(src\.root\)\)/.test(bs) && !/\{ landed: l\.items \}/.test(bs));
}

console.log(`check-outcome: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
