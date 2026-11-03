// Checks that every outcome earns its evidence (packages/core/src/scan/track.ts eligibility, cohortsOf, boundsOf; the
// ancestry release.server.ts landings reads from git):
//   1 commit      a reading whose commit contains the landing judges it, 'by commit'; one on another branch (its commit
//                 does not contain the landing) or one git cannot place cannot judge: unknown, the reason in words, and
//                 the newest eligible reading judges instead when there is one
//   2 method      a reading whose method or unit differs from the baseline's cannot judge: unknown, "method changed"
//   3 by time     a reading with no commit is judged by time, as before, and the record says 'by time; commit not recorded'
//   4 cohort      four items judged by one reading form one observation cohort (cohortsOf: one id, four items, each its
//                 own target result); a second reading makes a second cohort
//   5 bounds      a target outside the metric's declared bounds (jankFrames min 0, expected -10) reads 'target out of
//                 bounds' and stays unresolved (mainOutcome 'out-of-bounds'), never short; inside the bounds it is short
//   6 readers     priorRecord and the Morning Watch read the same eligibility: a wrong-branch reading confirms in neither
//   7 git         on a temp repo, landings() answers `ancestry` for the store's readings: a descendant of the landing
//                 contains it, a commit on another branch does not, an unknown sha is left out (never "contains")
// Run: node scripts/check-outcome-evidence.ts   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const core = (p: string) => pathToFileURL(path.join(ROOT, 'packages/core/src', p)).href;
const TR = await import(core('scan/track.ts')) as typeof import('../packages/core/src/scan/track.ts');
const LD = await import(core('scan/landed.ts')) as typeof import('../packages/core/src/scan/landed.ts');
const RC = await import(core('scan/record.ts')) as typeof import('../packages/core/src/scan/record.ts');
const MW = await import(core('companion/morning.ts')) as typeof import('../packages/core/src/companion/morning.ts');
const R = await import(core('server/release.server.ts')) as typeof import('../packages/core/src/server/release.server.ts');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

// ------------------------------------------------------------------ the fixture: items landed at h(5) as LAND
const T0 = '2026-10-01T10:00:00.000Z', h = (n: number) => new Date(Date.parse(T0) + n * 3600000).toISOString();
const LAND = 'c'.repeat(40), MAIN = 'd'.repeat(40), OTHER = 'e'.repeat(40), LOST = 'f'.repeat(40);
let mid = 0;
const M = (value: number, measured_at: string, x: Any = {}) => ({ id: ++mid, run_id: 'r0', feature: 'f-a', lens: 'design', metric: 'standardsPct', value, unit: '%', method: 'judgement', measured_at, ...x });
const pack = { id: 'k-des-2', lens: 'design', n: 1, branch: 'pack/des-2', base_ref: 'master', base_sha: 'a'.repeat(40), status: 'open', created_at: h(2), updated_at: h(2) };
const item = (id: string, x: Any = {}) => ({ id, run_id: 'r0', feature: 'f-a', lens: 'design', metric: 'standardsPct', title: 'Hold the standard ' + id, standard: 'none', kind: 'fix', expected_delta: 50,
  status: 'accepted', decided_by: 'agent:director', decided_at: h(1), pack_id: 'k-des-2', commit_sha: 'b'.repeat(40), created_at: T0, updated_at: h(3), ...x });
const base = () => [M(50, h(0.5)), M(50, h(1.5), { proposal_id: 'p-1', phase: 'before' })];
const landing = { sha: LAND, at: h(5), by: 'trailer' as const };
const contains = (l: string, m: string) => (l !== LAND ? undefined : m === MAIN ? true : m === OTHER ? false : undefined);
const scanOf = (extra: Any[], items: Any[] = [item('p-1')]) => ({ packs: [pack], releases: [], runs: [], measurements: [...base(), ...extra], proposals: items }) as Any;
const tr = (extra: Any[], opts: Any = {}) => TR.trackOf(scanOf(extra), 'p-1', { landed: { 'p-1': landing }, contains, ...opts })!;

// ------------------------------------------------------------------ 1 commit ancestry
{
  const t = tr([M(100, h(6), { commit_sha: MAIN })]);
  check('1 a descendant reading judges, by commit', t.stage === 'confirmed' && t.by === 'commit' && t.evidence === true && t.lines.some((l) => /by commit: ddddddd contains the landing/.test(l)), JSON.stringify([t.stage, t.by, t.lines]));
  const w = tr([M(100, h(6), { commit_sha: OTHER })]);
  check('1 a wrong-branch reading cannot confirm: unknown, the reason in words', w.stage === 'unknown' && !w.evidence && TR.mainOutcome(w) === 'unmeasured' && /does not contain the landing ccccccc \(another branch\)/.test(w.ineligible ?? '')
    && w.label === 'landed · not counted: ' + w.ineligible && w.lines.some((l) => l.startsWith('Not counted: 100 % measured 2026-10-01: measured at eeeeeee')), JSON.stringify([w.stage, w.label, w.lines]));
  const u = tr([M(100, h(6), { commit_sha: LOST })]);
  check('1 a commit git cannot place cannot confirm', u.stage === 'unknown' && /cannot place/.test(u.ineligible ?? ''), u.label);
  const none = TR.trackOf(scanOf([M(100, h(6), { commit_sha: MAIN })]), 'p-1', { landed: { 'p-1': landing } })!;
  check('1 no ancestry at all (no lookup): a recorded commit is not taken on trust', none.stage === 'unknown' && /cannot place/.test(none.ineligible ?? ''), none.label);
  const mix = tr([M(40, h(6), { commit_sha: MAIN }), M(100, h(7), { commit_sha: OTHER })]);
  check('1 a newer wrong-branch reading does not hide the eligible one: short by the main reading, the other named', mix.stage === 'not-confirmed' && mix.current === 40 && mix.by === 'commit' && !!mix.ineligible, JSON.stringify([mix.stage, mix.current, mix.ineligible]));
}

// ------------------------------------------------------------------ 2 method and unit
{
  const m = tr([M(100, h(6), { method: 'static', commit_sha: MAIN })]);
  check('2 a changed-method reading cannot confirm', m.stage === 'unknown' && m.ineligible === 'method changed: judgement at the baseline, static now', JSON.stringify([m.stage, m.ineligible]));
  const u = tr([M(100, h(6), { unit: 'pts' })]);
  check('2 a changed-unit reading cannot confirm', u.stage === 'unknown' && /^unit changed: % at the baseline, pts now/.test(u.ineligible ?? ''), String(u.ineligible));
  const n = tr([M(100, h(6), { method: undefined })]);
  check('2 a reading with no method recorded stays compatible (legacy)', n.stage === 'confirmed', n.label);
}

// ------------------------------------------------------------------ 3 judged by time
{
  const t = tr([M(100, h(6))]);
  check('3 no commit recorded: judged by time, as before, and labelled so', t.stage === 'confirmed' && t.by === 'time' && t.label === 'landed · held · measured 100 (expected 100)'
    && t.lines.some((l) => l === 'Product now: 100 %, measured 2026-10-01 after it landed (by time; commit not recorded)'), JSON.stringify(t.lines));
  const b = tr([M(100, h(4.5))]);
  check('3 a reading before the landing stays an observation', b.stage === 'unknown' && !b.evidence && !b.ineligible && b.lines.some((l) => /observation from before it landed/.test(l)));
}

// ------------------------------------------------------------------ 4 observation cohorts
{
  const ids = ['p-1', 'p-2', 'p-3', 'p-4'];
  const one = M(100, h(6), { commit_sha: MAIN });
  const exp = [50, 50, 60, 40];
  const items = ids.map((id, i) => item(id, { expected_delta: exp[i] }));
  const scan = scanOf([one], items), landed = Object.fromEntries(ids.map((id) => [id, landing]));
  const ts = ids.map((id) => TR.trackOf(scan, id, { landed, contains }));
  const c = TR.cohortsOf(ts);
  check('4 four items judged by one reading form one cohort', c.size === 1 && c.get('m:' + one.id)?.length === 4 && ts.every((t) => t!.cohort === 'm:' + one.id), JSON.stringify([...c]));
  check('4 each keeps its own target result', ts.map((t) => t!.stage).join() === 'confirmed,confirmed,not-confirmed,confirmed', ts.map((t) => t!.stage).join());
  const other = { ...item('p-5', { feature: 'f-b' }) }, scan2 = { ...scan, proposals: [...items, other], measurements: [...scan.measurements, M(100, h(6), { feature: 'f-b', commit_sha: MAIN })] };
  const ts2 = [...ids, 'p-5'].map((id) => TR.trackOf(scan2, id, { landed: { ...landed, 'p-5': landing }, contains }));
  check('4 a second reading is a second cohort; an unjudged item is in none', TR.cohortsOf(ts2).size === 2 && TR.cohortsOf([...ts2, tr([])]).size === 2);
}

// ------------------------------------------------------------------ 5 declared bounds
{
  const bounds = TR.boundsOf([{ id: 'performance', manifest: { fields: [{ key: 'jankFrames', min: 0 }, { key: 'label' }] } }]);
  const perf = (extra: Any[], d: number) => {
    const p = item('p-1', { lens: 'performance', metric: 'jankFrames', expected_delta: d });
    const ms = [M(0, h(0.5), { lens: 'performance', metric: 'jankFrames', unit: 'frames', method: 'probe', value: 12 }), ...extra.map((x) => ({ ...x, lens: 'performance', metric: 'jankFrames', unit: 'frames', method: 'probe' }))];
    return TR.trackOf({ packs: [pack], releases: [], measurements: ms, proposals: [p] } as Any, 'p-1', { landed: { 'p-1': landing }, contains, bounds })!;
  };
  const o = perf([M(14, h(6))], -22);
  check('5 a target below min 0 reads "target out of bounds" and stays unresolved', o.stage === 'unknown' && TR.mainOutcome(o) === 'out-of-bounds' && o.label === 'landed · target out of bounds (expected -10 frames, min 0)'
    && o.lines.some((l) => /^Target out of bounds: expected -10 frames lies outside the declared bounds of jankFrames \(min 0\)/.test(l)) && TR.shortNote(o, 'master') === null, JSON.stringify([o.stage, o.label, o.lines]));
  const s = perf([M(14, h(6))], -8);
  check('5 inside the bounds the same reading is short', s.stage === 'not-confirmed' && TR.mainOutcome(s) === 'short' && !s.outOfBounds, s.label);
  check('5 boundsOf: a field without bounds has none', bounds('performance', 'label') === undefined && bounds('performance', 'jankFrames')?.min === 0);
}

// ------------------------------------------------------------------ 6 the readers agree
{
  const rows = [item('p-1', { feature: 'f-a' }), item('p-open', { status: 'proposed', decided_at: undefined })];
  const scan = scanOf([M(100, h(6), { commit_sha: OTHER })], rows);
  const r = RC.priorRecord(scan, rows[1] as Any, { landed: { 'p-1': landing }, contains });
  check('6 priorRecord: the wrong-branch reading confirms nothing (1 landed, 1 unknown)', r.lens.landed === 1 && r.lens.confirmed === 0 && r.lens.unknown === 1, JSON.stringify(r.lens));
  const facts = [{ slug: 'bp', name: 'bp', scan, where: new Map(), landed: { ref: 'master', items: { 'p-1': landing } }, evidence: { contains } }] as Any;
  const d = MW.buildDeck(facts, [], h(4), Date.parse(h(30)));
  const card = d.cards.find((c) => c.id === 'landed:bp');
  check('6 Morning Watch: not counted confirmed, its line says why', !!card && d.products[0].confirmed === 0 && /no eligible reading since it landed \(measured at eeeeeee/.test(card.lines[0]?.text ?? ''), JSON.stringify([card?.lines, d.products[0]]));
  const ok = MW.buildDeck([{ ...facts[0], scan: scanOf([M(100, h(6), { commit_sha: MAIN })], rows) }], [], h(4), Date.parse(h(30)));
  check('6 Morning Watch: a descendant reading confirms there too', ok.products[0].confirmed === 1, JSON.stringify(ok.products[0]));
}

// ------------------------------------------------------------------ 7 ancestry from git
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-evidence-'));
try {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=bp-check', '-c', 'user.email=bp-check@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr);
    return r.stdout.trim();
  };
  const commit = (f: string, msg: string) => { fs.writeFileSync(path.join(repo, f), msg + '\n'); git('add', f); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  git('init', '-q'); git('checkout', '-q', '-b', 'main');
  const b0 = commit('a.txt', 'base');
  git('checkout', '-q', '-b', 'side');
  const side = commit('s.txt', 'side work');
  git('checkout', '-q', 'main');
  const land = commit('c.txt', 'fix: the change\n\nLens-Item: p-1');
  const after = commit('d.txt', 'later on main');
  const pk = { ...pack, base_ref: 'main', base_sha: b0 };
  const ms = [M(1, h(6), { commit_sha: after }), M(1, h(6), { commit_sha: side }), M(1, h(6), { commit_sha: '0123456789abcdef0123456789abcdef01234567' }), M(1, h(6), { commit_sha: b0, proposal_id: 'p-1', phase: 'after' })];
  const scan = { packs: [pk], proposals: [item('p-1', { commit_sha: undefined })], measurements: ms } as Any;
  const l = await R.landings(repo, scan);
  check('7 the landing is read', l.state === 'known' && l.items['p-1']?.sha === land, JSON.stringify(l));
  const a = l.state === 'known' ? l.ancestry ?? {} : {};
  check('7 a descendant contains the landing; another branch does not; an unknown sha and a branch reading are not asked',
    a[after]?.[land] === true && a[side]?.[land] === false && Object.keys(a).length === 2, JSON.stringify(a));
  const c = LD.containsOf(l);
  check('7 containsOf is the lookup trackOf takes', !!c && c(land, after) === true && c(land, side) === false && c(land, b0) === undefined);
  check('7 ancestryAsks: nothing to ask without readings', LD.ancestryAsks(l.state === 'known' ? l.items : {}, { proposals: scan.proposals }).length === 0);
} catch (e) { check('7 git fixture', false, String(e)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }

console.log(`check-outcome-evidence: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
