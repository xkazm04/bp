// The release notes have one writer: packages/core/src/train/notes.ts releaseNotes(). The Release tab's preview
// (releaseState.ts notesPreview, mode "preview") and Kettle's sample run (train-sim.ts, mode "sample") both call it, so
// the collapsible that swaps from the preview to the stored notes after Build (NotesPreview.tsx) shows the same lines.
// Cases:
//   1. three items (flagged with a note, read 2.25 -> 1.75, unmeasured): preview and sample carry byte-identical item
//      lines, one number format ("2.3 -> 1.8"), "unmeasured", the "Shipped flagged: <note>" sub-line; and a Kettle
//      ScanSim build stores the same item lines the preview showed before Build;
//   2. a build with the "a cherry-pick conflicts" toggle on stores a "### Back to rework (cherry-pick conflict)" section
//      naming the conflicted item and its files, the same section the preview shows for that release;
//   3. a build with gates passing stores a "### Gates" section naming the gates the run logged (tsc, vitest); the
//      preview keeps its "lists them here" placeholder;
//   4. every item line names the pack it came from (release.md: the commit, and the pack it came from);
//   5. "preview" -> "## <product> <version> (preview)"; "sample" -> "## Kettle <version> (sample)" and the sample
//      disclaimer; everything after the header block is the same text;
//   6. the literal "Shipped flagged" appears once under apps/web/src and packages/core/src, in notes.ts;
//   7. notes.ts keeps the train's import rule (value imports only ./rules.ts and ../scan/*.ts, no React, <= 400 lines)
//      and check-train-quality passes over it.
//   GUARD g1: a preview with no conflict has no rework section and keeps the gates placeholder.
// Run: node scripts/check-release-notes.ts  (Node's type stripping; no build step). Exit 1 on any failure. ~6 s.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ScanSim } from '../packages/core/src/model/scan-sim.ts';
import { SAMPLE_ITEMS } from '../packages/core/src/model/train-sim.ts';
import type { LensFields } from '../packages/core/src/scan/compare.ts';
import type { ScanJob } from '../packages/core/src/scan/jobs.ts';
import type { Measurement, Proposal } from '../packages/core/src/scan/types.ts';
import type { LensManifest } from '../packages/core/src/standard/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const NOTES = path.join(ROOT, 'packages/core/src/train/notes.ts');
type NotesMod = typeof import('../packages/core/src/train/notes.ts');
type StateMod = typeof import('../apps/web/src/components/ledger/train/release/releaseState.ts');
const N: Partial<NotesMod> = fs.existsSync(NOTES) ? await import(pathToFileURL(NOTES).href) as NotesMod : {};
const S = await import(pathToFileURL(path.join(ROOT, 'apps/web/src/components/ledger/train/release/releaseState.ts')).href) as StateMod;

const cases = new Map<string, boolean>();
const check = (c: string, name: string, ok: boolean, detail = '') => { cases.set(c, (cases.get(c) ?? true) && ok); if (!ok) console.log(`FAIL case ${c}: ${name}${detail ? ': ' + detail : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The item lines: each "- **" line and the "  - " sub-lines under it, up to the next section. */
const itemLines = (t: string): string[] => { const out: string[] = []; let on = false; for (const l of t.split('\n')) { if (l.startsWith('- **')) on = true; else if (!l.startsWith('  - ')) on = false; if (on) out.push(l); } return out; };
const section = (t: string, head: string): string[] => { const ls = t.split('\n'), i = ls.indexOf(head); if (i < 0) return []; const out: string[] = []; for (const l of ls.slice(i + 1)) { if (l.startsWith('### ')) break; out.push(l); } return out.filter(Boolean); };
const afterHeader = (t: string): string => t.split('\n').slice(t.includes('(sample)') ? 4 : 2).join('\n');

// ------------------------------------------------------------------ 1, 4, 5: three items, both modes
const m = (value: number, phase: 'before' | 'after'): Measurement => ({ id: 1, run_id: 'r', feature: 'f', lens: 'design', metric: 'undesignedStates', value, unit: 'states', measured_at: '2026-10-01T00:00:00.000Z', phase });
const prop = (id: string, title: string, extra: Partial<Proposal> = {}): Proposal => ({ id, run_id: 'r', feature: 'booking', lens: 'design', title, standard: 'none', kind: 'fix', status: 'accepted', metric: 'undesignedStates', commit_sha: 'abcdef1234567890', pack_id: 'k-des-9', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', ...extra });
const three = [
  { p: prop('p-000001', 'Flagged one', { triage_note: 'Ships flat on purpose' }), verdict: 'flat' as const, from: m(2, 'before'), to: m(2, 'after'), flagged: true },
  { p: prop('p-000002', 'Fractional one'), verdict: 'moved' as const, from: m(2.25, 'before'), to: m(1.75, 'after'), flagged: false },
  { p: prop('p-000003', 'Unmeasured one', { pack_id: 'k-des-8' }), verdict: 'unmeasured' as const, flagged: false },
];
if (typeof N.releaseNotes === 'function') {
  const pre = N.releaseNotes({ product: 'Acme', version: '1.2.0', mode: 'preview', items: three, conflicts: [] });
  const smp = N.releaseNotes({ product: 'Kettle', version: '1.2.0', mode: 'sample', items: three, conflicts: [] });
  check('1', 'preview and sample item lines byte-identical', JSON.stringify(itemLines(pre)) === JSON.stringify(itemLines(smp)) && itemLines(pre).length === 4, itemLines(pre).join(' | '));
  check('1', 'one number format: 2.3 -> 1.8', itemLines(pre).some((l) => l.includes('undesignedStates 2.3 -> 1.8 states (moved)')), pre);
  check('1', 'unmeasured, and the Shipped flagged sub-line', itemLines(pre).some((l) => l.includes('Unmeasured one') && l.includes('unmeasured')) && itemLines(pre).includes('  - Shipped flagged: Ships flat on purpose'), pre);
  check('4', 'each item line names its pack', itemLines(pre).filter((l) => l.startsWith('- **')).every((l, i) => l.includes(three[i].p.pack_id!)), pre);
  check('5', 'preview header', pre.startsWith('## Acme 1.2.0 (preview)\n'), pre.split('\n')[0]);
  check('5', 'sample header and disclaimer', smp.startsWith('## Kettle 1.2.0 (sample)\n\nSample release notes: Kettle is the sample product, and nothing here shipped.\n\n'), smp.split('\n').slice(0, 3).join(' | '));
  check('5', 'everything after the header block is the same text', afterHeader(pre) === afterHeader(smp), afterHeader(pre) + '\n---\n' + afterHeader(smp));
  check('5', 'releaseState notesPreview delegates (same text as mode preview)', S.notesPreview('Acme', '1.2.0', three, []) === pre);
  check('g1', 'GUARD: no conflict -> no rework section, gates placeholder kept', !pre.includes('### Back to rework') && section(pre, '### Gates').join() === "The release job runs the product's gates on release/1.2.0 and lists them here.", pre);
} else for (const c of ['1', '4', '5']) check(c, 'packages/core/src/train/notes.ts exports releaseNotes', false);
{
  const pre = S.notesPreview('Acme', '1.2.0', three, []);
  check('g1', 'GUARD: no conflict -> no rework section, gates placeholder kept (releaseState)', !pre.includes('### Back to rework') && pre.includes('lists them here'), pre);
}

// ------------------------------------------------------------------ 1-4: a Kettle ScanSim build, with and without a conflict
const structure = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8')) as { features: { slug: string }[]; lenses: { id: string; manifest: LensManifest }[]; facets: Record<string, Record<string, { values?: Record<string, unknown> }>> };
const mapValue = (f: string, l: string, k: string): number | undefined => { const v = structure.facets[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; };
const manifests = new Map(structure.lenses.map((l) => [l.id, l.manifest]));
const lenses: LensFields[] = structure.lenses.map((l) => ({ id: l.id, manifest: l.manifest }));

async function build(conflict: boolean): Promise<{ preview: string; stored: string; after: string; back?: Proposal; log: string }> {
  let clock = Date.parse('2026-10-15T12:00:00.000Z');
  const sim = new ScanSim({ now: () => clock, findings: [] });
  sim.bind({ order: structure.features.map((f) => f.slug), manifest: (l) => manifests.get(l), value: mapValue });
  const s0 = sim.snapshot(), id = (key: string) => { const it = SAMPLE_ITEMS.find((i) => i.key === key)!; return s0.proposals.find((x) => x.title === it.title && x.pack_id === it.pack && !x.attempt_of)!.id; };
  sim.triage({ ids: [id('des1-booking')], decision: 'accept' });
  sim.triage({ ids: [id('des1-waiver')], decision: 'accept', note: 'Ships with the gate fixed by hand.' });
  sim.triage({ ids: [id('perf1-timetable')], decision: 'accept' });
  const c = sim.createRelease('0.1.0');
  const snapEv = () => { const s = sim.snapshot(), by = S.readingsBy(s.measurements); return { s, items: s.proposals.filter((p) => p.release_id === c.release.id).map((p) => S.evidenceOf(p, by, lenses)) }; };
  const preview = S.notesPreview('Kettle', '0.1.0', snapEv().items, []);
  sim.setTrainToggles({ ghOff: false, conflict, gateFails: false });
  const job = sim.buildRelease(c.release.id);
  let j: ScanJob | undefined, log = '';
  for (let i = 0; i < 40; i++) { j = sim.jobs().find((x) => x.id === job.id); if (j && j.status !== 'running' && j.status !== 'queued') break; clock += 1000; await sleep(260); log += (sim.jobs().find((x) => x.id === job.id)?.log_tail?.split('\n').pop() ?? '') + '\n'; }
  const { s, items } = snapEv(), r = s.releases.find((x) => x.id === c.release.id)!;
  const back = s.proposals.find((p) => p.status === 'rework' && S.isConflict(p));
  const after = S.notesPreview('Kettle', '0.1.0', items, N.conflictsIn ? N.conflictsIn(s.proposals, r.branch) : []);
  return { preview, stored: r.notes ?? '', after, back, log };
}

const clean = await build(false);
const kept = itemLines(clean.preview);
check('1', 'sim: the stored notes carry the preview\'s item lines byte for byte', kept.length >= 4 && JSON.stringify(itemLines(clean.stored)) === JSON.stringify(kept), '\npreview:\n' + kept.join('\n') + '\nstored:\n' + itemLines(clean.stored).join('\n'));
check('3', 'sim: the stored notes have a ### Gates section naming tsc and vitest', /gates passed: tsc, vitest/.test(clean.log) && section(clean.stored, '### Gates').some((l) => /\btsc\b/.test(l)) && section(clean.stored, '### Gates').some((l) => /\bvitest\b/.test(l)), clean.stored);
check('3', 'preview keeps its placeholder', section(clean.preview, '### Gates').join().includes('lists them here'), clean.preview);
check('4', 'sim: every item line in preview and stored names its pack', [clean.preview, clean.stored].every((t) => itemLines(t).filter((l) => l.startsWith('- **')).every((l) => / k-(des|perf)-\d/.test(l))), clean.stored);

const conf = await build(true);
const rw = section(conf.stored, '### Back to rework (cherry-pick conflict)');
check('2', 'sim with a conflict: a rework section naming the conflicted item and its files', !!conf.back && rw.some((l) => l.includes(conf.back!.title) && /src\//.test(l)), conf.stored);
check('2', 'sim with a conflict: the same section the preview shows for that release', rw.length > 0 && JSON.stringify(rw) === JSON.stringify(section(conf.after, '### Back to rework (cherry-pick conflict)')), conf.after);
check('1', 'sim with a conflict: stored item lines are the preview\'s minus the conflicted item', JSON.stringify(itemLines(conf.stored)) === JSON.stringify(itemLines(conf.after)) && !itemLines(conf.stored).some((l) => !!conf.back && l.includes(conf.back.title)), conf.stored);

// ------------------------------------------------------------------ 6, 7: one literal, the train's import rule
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const hits = ['apps/web/src', 'packages/core/src'].flatMap((d) => walk(path.join(ROOT, d))).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f: path.relative(ROOT, f).replace(/\\/g, '/'), i: i + 1, l })).filter((x) => x.l.includes('Shipped flagged')));
check('6', '"Shipped flagged" once, in packages/core/src/train/notes.ts', hits.length === 1 && hits[0].f === 'packages/core/src/train/notes.ts', hits.map((h) => `${h.f}:${h.i}`).join(', '));
if (fs.existsSync(NOTES)) {
  const src = fs.readFileSync(NOTES, 'utf8'), lines = src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
  const values = [...src.matchAll(/^import\s+(?!type\b)[^'"]*from\s+'([^']+)'/gm)].map((x) => x[1]);
  check('7', 'notes.ts: value imports only ./rules.ts and ../scan/*.ts, no React, <= 400 lines', lines <= 400 && !/from\s+'react/.test(src) && values.every((v) => v === './rules.ts' || /^\.\.\/scan\/[\w-]+\.ts$/.test(v)), `${lines} lines; ${values.join(', ')}`);
  const q = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-train-quality.mjs'), '--no-self-test'], { cwd: ROOT, encoding: 'utf8' });
  check('7', 'check-train-quality passes with notes.ts', q.status === 0, (q.stdout + q.stderr).split('\n').filter((l) => /FAIL|violation|notes\.ts/.test(l)).slice(0, 6).join(' | '));
} else check('7', 'packages/core/src/train/notes.ts exists', false);

const red = [...cases].filter(([, ok]) => !ok).map(([c]) => c);
console.log(`check-release-notes: ${cases.size - red.length}/${cases.size} cases green${red.length ? ' (red: ' + red.join(', ') + ')' : ''}`);
process.exit(red.length ? 1 : 0);
