// Pins the Release tab's pre-flight (apps/web/src/components/ledger/train/release/preflight.ts) and the sample's dry
// build (packages/core/src/model/scan-sim.ts preflightRelease): what will refuse or fail is said BEFORE Build is pressed.
//   1 a draft holding an item with no commit_sha -> a block naming the item; Build leaves the available actions
//     (lens-scan release.md: such an item cannot ship, the run would fail the release naming it)
//   2 flagged and unmeasured items -> warns ("2 ship flagged" with their notes, "1 unmeasured"); Build stays (warns never block)
//   3 the probe's answer: 412 -> a block worded as the fix ("gh is not signed in: run gh auth login"), and the gate takes
//     Build and Retry away (the button and the B key both read the gated list); ready -> no block
//   4 building, pr-open, merged, tagged -> [] (pre-flight belongs to the statuses that offer a build: RELEASE_STATE's data)
//   5 Kettle's ScanSim: the "gh logged in" toggle off -> the dry build throws refuse(412), no job pushed, no notify; on ->
//     { ready: true }, still no job; a pr-open release -> the real build's 409 words
//   6 ReleaseView maps the checks as data and gates through `gated` (no `!m.items.length` gate left, no status id in the list)
// Run: node scripts/check-release-preflight.ts   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ScanSim } from '../packages/core/src/model/scan-sim.ts';
import type { LensManifest } from '../packages/core/src/standard/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const REL = 'apps/web/src/components/ledger/train/release';

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); }
};
type Refusal = { status?: number; message?: string };
const err = (fn: () => unknown): Refusal => { try { fn(); return {}; } catch (e) { return e as Refusal; } };

type Check = { id: string; verdict: 'block' | 'warn' | 'ok'; words: string };
type Mod = {
  preflightOf: (rel: { status: string; version: string } | undefined, items: unknown[], probe: unknown) => Check[];
  gated: (available: readonly string[], checks: readonly Check[]) => string[];
};
let M: Mod | null = null;
try { M = await import(pathToFileURL(path.join(ROOT, REL, 'preflight.ts')).href) as Mod; } catch (e) { check('preflight.ts loads', false, (e as Error).message.split('\n')[0]); }

const T0 = '2026-10-24T00:00:00.000Z';
const item = (id: string, title: string, o: { sha?: boolean; verdict?: string; flagged?: boolean; note?: string } = {}) => ({
  p: { id, title, run_id: 'r0', feature: 'f', lens: 'design', standard: 'none', kind: 'fix', status: 'accepted', created_at: T0, updated_at: T0,
    ...(o.sha === false ? {} : { commit_sha: id.padEnd(40, '0') }), ...(o.note ? { triage_note: o.note } : {}) },
  verdict: o.verdict ?? 'moved', flagged: !!o.flagged,
});
const draft = { status: 'draft', version: '1.2.0' };
const READY = { ready: true, gh: 'signed-in' };
const blocks = (cs: Check[]) => cs.filter((c) => c.verdict === 'block');
const warns = (cs: Check[]) => cs.filter((c) => c.verdict === 'warn');

if (M) {
  const { preflightOf, gated } = M;
  // 1 a commit-less item blocks, by name
  const c1 = preflightOf(draft, [item('p-aaaaaa', 'Booking card states'), item('p-bbbbbb', 'Waiver retry', { sha: false })], READY);
  check('1 a commit-less item -> one block naming its title', blocks(c1).length === 1 && blocks(c1)[0].words.includes('Waiver retry') && !blocks(c1)[0].words.includes('Booking card states'), JSON.stringify(c1));
  check('1 the block takes Build out of the available actions', gated(['build'], c1).length === 0 && gated(['retry'], c1).length === 0, JSON.stringify(gated(['build'], c1)));
  // 2 warns never block
  const c2 = preflightOf(draft, [
    item('p-000001', 'A', { flagged: true, verdict: 'flat', note: 'Ships flat: harness never reaches it.' }), item('p-000002', 'B', { flagged: true, verdict: 'worse', note: 'Worse by one state.' }),
    item('p-000003', 'C', { verdict: 'unmeasured' }), item('p-000004', 'D'), item('p-000005', 'E'), item('p-000006', 'F'),
  ], READY);
  const w = warns(c2);
  check('2 two flagged -> a warn "2 ship flagged" carrying their notes', w.some((c) => /\b2 ship flagged\b/.test(c.words) && c.words.includes('Ships flat: harness never reaches it.') && c.words.includes('Worse by one state.')), JSON.stringify(w));
  check('2 one unmeasured -> a warn "1 unmeasured"', w.some((c) => /\b1 unmeasured\b/.test(c.words)), JSON.stringify(w));
  check('2 warns never block: no block, Build stays available', blocks(c2).length === 0 && gated(['build'], c2).join() === 'build', JSON.stringify(c2));
  // 3 the probe
  const c3 = preflightOf(draft, [item('p-cccccc', 'Clean')], { status: 412, text: 'gh not authenticated' });
  check('3 probe 412 -> a block worded as the fix', blocks(c3).some((c) => c.words.includes('gh is not signed in: run gh auth login')), JSON.stringify(c3));
  check('3 probe 412 -> the gate starts nothing (button and B key read the same list)', gated(['build'], c3).length === 0 && gated(['retry'], c3).length === 0);
  const c3b = preflightOf(draft, [item('p-cccccc', 'Clean')], { status: 409, text: 'a release job for rel-1.2.0 is already queued or running' });
  check('3 probe 409 -> a block with the route\'s words', blocks(c3b).some((c) => c.words.includes('already queued or running')), JSON.stringify(c3b));
  const c3c = preflightOf(draft, [item('p-cccccc', 'Clean')], READY);
  check('3 probe ready -> no block, an ok check', blocks(c3c).length === 0 && c3c.some((c) => c.verdict === 'ok'), JSON.stringify(c3c));
  const c3d = preflightOf(draft, [item('p-cccccc', 'Clean')], null);
  check('3 probe not answered yet -> no block (a pending probe never holds Build)', blocks(c3d).length === 0, JSON.stringify(c3d));
  check('3 an empty draft blocks (the old items.length gate, as a reason)', blocks(preflightOf(draft, [], READY)).length === 1);
  // 4 only the statuses that offer a build
  const bad = [item('p-dddddd', 'X', { sha: false })];
  check('4 building, pr-open, merged, tagged -> []', ['building', 'pr-open', 'merged', 'tagged'].every((s) => preflightOf({ status: s, version: '1.2.0' }, bad, { status: 412, text: 'x' }).length === 0));
  check('4 failed is pre-flighted too', blocks(preflightOf({ status: 'failed', version: '1.2.0' }, bad, READY)).length === 1);
  check('4 no release -> []', preflightOf(undefined, bad, READY).length === 0);
  check('every check has an id, a verdict and words', [...c1, ...c2, ...c3, ...c3c].every((c) => !!c.id && ['block', 'warn', 'ok'].includes(c.verdict) && c.words.trim().length > 5));
}

// 5 the sample's dry build
{
  const structure = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8')) as { features: { slug: string }[]; lenses: { id: string; manifest: LensManifest }[]; facets: Record<string, Record<string, { values?: Record<string, unknown> }>> };
  const manifests = new Map(structure.lenses.map((l) => [l.id, l.manifest]));
  const value = (f: string, l: string, k: string): number | undefined => { const v = structure.facets[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; };
  const sim = new ScanSim({ now: () => Date.parse('2026-10-24T12:00:00.000Z'), findings: [] });
  sim.bind({ order: structure.features.map((f) => f.slug), manifest: (l) => manifests.get(l), value });
  const done = sim.snapshot().proposals.filter((p) => p.pack_id && p.status === 'done').map((p) => p.id);
  sim.triage({ ids: done, decision: 'accept' });
  const id = sim.createRelease('0.1.0').release.id;
  await new Promise((r) => setTimeout(r, 0));
  let notes = 0;
  sim.subscribe(() => notes++);
  const dry = typeof sim.preflightRelease === 'function' ? (x: string): unknown => sim.preflightRelease(x) : undefined;
  check('5 ScanSim has preflightRelease', typeof dry === 'function');
  if (dry) {
    const jobs0 = sim.jobs().length;
    sim.setTrainToggles({ ghOff: true, conflict: false, gateFails: false });
    await new Promise((r) => setTimeout(r, 0));
    notes = 0;
    const e = err(() => dry(id));
    await new Promise((r) => setTimeout(r, 0));
    check('5 gh toggle off -> the dry build throws 412 gh not authenticated', e.status === 412 && e.message === 'gh not authenticated', JSON.stringify(e));
    check('5 ... with no job pushed and no notify', sim.jobs().length === jobs0 && notes === 0, `jobs ${sim.jobs().length} notes ${notes}`);
    sim.setTrainToggles({ ghOff: false, conflict: false, gateFails: false });
    await new Promise((r) => setTimeout(r, 0));
    notes = 0;
    const ok = dry(id) as { ready?: boolean };
    await new Promise((r) => setTimeout(r, 0));
    check('5 toggle on -> { ready: true }, still no job, no notify', ok?.ready === true && sim.jobs().length === jobs0 && notes === 0, JSON.stringify(ok));
    check('5 the dry build answers a bad id 400 and an unknown release 404, as the build does', err(() => dry('nope')).status === 400 && err(() => dry('rel-9.9.9')).status === 404);
  }
}

// 6 the view reads the checks as data and gates through them
{
  const src = fs.readFileSync(path.join(ROOT, REL, 'ReleaseView.tsx'), 'utf8');
  check('6 ReleaseView imports preflightOf and gated', /import\s*\{[^}]*\bpreflightOf\b[^}]*\bgated\b[^}]*\}\s*from\s*'\.\/preflight'/.test(src) || (/\bpreflightOf\b/.test(src) && /\bgated\b/.test(src) && /from '\.\/preflight'/.test(src)));
  check('6 the Build button is no longer gated on items.length alone', !/disabled=\{x === 'build' && !m\.items\.length\}/.test(src));
  check('6 the list maps the checks (no status id branched on in it)', /checks\.map\(/.test(src) && /data-role="tr-rel-pre"/.test(src));
}

console.log(`release-preflight: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
