// Checks Kettle's sample release train (src/lib/model/train-sim.ts through the scan sim, the same path the ledger's
// actions take on Kettle) with a fake clock:
//   - the seed over the map's own values (no number the map shows changes; the sample's where the map has none): k-des-1 (moved, flat, worse, failed with a commit, a rework), k-des-2 (the rework's rebuild, its body
//     quoting the note), k-perf-1 (three baseline runs and an after per item, context readings); shapes as the live
//     types (pack_id + commit_sha on every pack item, proposal_id + phase + commit_sha on phased rows, no nulls), ids in
//     the real formats, units from the lens manifests, a run per pack and a committed row per item, light and dark shot
//     pairs whose files exist (the flat pair byte-identical), the failed item without shots;
//   - triage as store.mjs (and v3 reopen): each decision, 400, note-required, in-release, no-prior-status, rebuilt,
//     packs open <-> triaged, 409 with the result as body;
//   - suggest, create (400 / 409 nothing free / 409 version exists), build with each toggle (gh off 412; gate -> failed;
//     conflict -> the item with the most files back to rework by skill:lens-scan), merge, finish -> tagged, items
//     released, settled packs closed; one notify per tick; the build's timeline;
//   - commit diffs (message trailers, 20-120 line patches, 400 / 404) and shotSrc for a live and a Kettle shot.
// Run: node scripts/check-train-sim.ts  (Node's type stripping; no build step). Exit 1 on any failure. ~5 s.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ScanSim } from '../src/lib/model/scan-sim.ts';
import { SAMPLE_ITEMS } from '../src/lib/model/train-sim.ts';
import { compareOf, type LensFields } from '../src/lib/scan/compare.ts';
import { isJobNote, type ScanJob } from '../src/lib/scan/jobs.ts';
import { shotSrc } from '../src/lib/train/shots.ts';
import type { Proposal, Shot } from '../src/lib/scan/types.ts';
import type { LensManifest } from '../src/lib/standard/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT); // live.ts imports through '@/'
const { shotUrl } = await import(pathToFileURL(path.join(ROOT, 'src/lib/model/live.ts')).href) as typeof import('../src/lib/model/live.ts');

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Refusal = { status?: number; message?: string; body?: Record<string, unknown> };
const err = (fn: () => unknown): Refusal => { try { fn(); return {}; } catch (e) { return e as Refusal; } };

const structure = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/kettle.app-structure.json'), 'utf8')) as { features: { slug: string }[]; lenses: { id: string; manifest: LensManifest }[]; facets: Record<string, Record<string, { values?: Record<string, unknown> }>> };
/** The map's value of a feature's lens field, as BlueprintApp's bindSim answers it. */
const mapValue = (f: string, l: string, k: string): number | undefined => { const v = structure.facets[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; };
const order = structure.features.map((f) => f.slug);
const manifests = new Map(structure.lenses.map((l) => [l.id, l.manifest]));
const lenses: LensFields[] = structure.lenses.map((l) => ({ id: l.id, manifest: l.manifest }));
let clock = Date.parse('2026-10-15T12:00:00.000Z');
// a proposal descoped before v3 (no triaged_from): reopen has no status to go back to
const legacy: Proposal = { id: 'p-0ld000', run_id: 'r0', feature: order[0], lens: 'design', title: 'An older descoped item', standard: 'none', kind: 'fix', status: 'descoped', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };
const sim = new ScanSim({ now: () => clock, findings: [legacy] });
sim.bind({ order, manifest: (l) => manifests.get(l), value: mapValue });
let notes = 0;
sim.subscribe(() => notes++);

const snap = () => sim.snapshot();
const byKey = new Map<string, Proposal>();
const idOf = (key: string) => byKey.get(key)!.id;
const prop = (key: string) => snap().proposals.find((p) => p.id === idOf(key))!;
const pack = (id: string) => snap().packs.find((k) => k.id === id)!;
const rel = (id: string) => snap().releases.find((r) => r.id === id)!;
/** Advance the fake clock one step at a time until the job settles; answers the release status after each step. */
async function run(job: ScanJob, step = 1000): Promise<{ timeline: string[]; job: ScanJob; ticks: number[] }> {
  const timeline: string[] = [], ticks: number[] = [];
  for (let i = 0; i < 40; i++) {
    const j = sim.jobs().find((x) => x.id === job.id)!;
    if (j.status !== 'running' && j.status !== 'queued') return { timeline, job: j, ticks };
    const before = notes;
    clock += step; await sleep(260);
    ticks.push(notes - before);
    const k = sim.jobs().find((x) => x.id === job.id)!;
    timeline.push(`+${(i + 1) * step / 1000}s ${rel(job.release!).status.padEnd(8)} ${k.log_tail?.split('\n').pop() ?? ''}`);
  }
  return { timeline, job: sim.jobs().find((x) => x.id === job.id)!, ticks };
}

try {
  // ------------------------------------------------------------------ the seed
  const s0 = snap();
  for (const it of SAMPLE_ITEMS) { const p = s0.proposals.find((x) => x.title === it.title && x.pack_id === it.pack && (it.attemptOf ? !!x.attempt_of : !x.attempt_of)); if (p) byKey.set(it.key, p); }
  check('seed: every sample item is a proposal', byKey.size === SAMPLE_ITEMS.length, [...byKey.keys()].join());
  check('seed: packs k-des-1 (5), k-des-2 (1), k-perf-1 (2), all open', s0.packs.map((k) => `${k.id}:${k.status}:${s0.proposals.filter((p) => p.pack_id === k.id).length}`).join() === 'k-des-1:open:5,k-des-2:open:1,k-perf-1:open:2', JSON.stringify(s0.packs.map((k) => k.id + k.status)));
  check('seed: pack branches, base ref and sha', s0.packs.every((k) => k.branch === 'pack/' + k.id.slice(2) && k.base_ref === 'main' && /^[0-9a-f]{40}$/.test(k.base_sha) && !!k.run_id));
  const items = s0.proposals.filter((p) => p.pack_id);
  check('seed: every pack item has pack_id and a 40-hex commit_sha, and a p-<6 hex> id', items.every((p) => !!p.pack_id && /^[0-9a-f]{40}$/.test(p.commit_sha ?? '') && /^p-[0-9a-f]{6}$/.test(p.id)) && items.length === 8);
  check('seed: statuses as sampled', SAMPLE_ITEMS.map((i) => prop(i.key).status).join() === 'done,done,done,failed,rework,done,done,done', SAMPLE_ITEMS.map((i) => prop(i.key).status).join());
  const phased = s0.measurements.filter((m) => m.phase);
  check('seed: phased readings carry proposal_id and commit_sha; before at the base, after at the item commit', phased.length > 0 && phased.every((m) => {
    const p = s0.proposals.find((x) => x.id === m.proposal_id), k = s0.packs.find((x) => x.id === p?.pack_id);
    return !!p && !!k && m.commit_sha === (m.phase === 'before' ? k.base_sha : p.commit_sha);
  }));
  check('seed: units from the manifests (states, ms, frames, callbacks/s)', phased.every((m) => m.unit === manifests.get(m.lens)?.fields.find((f) => f.key === m.metric)?.unit), [...new Set(phased.map((m) => m.metric + ':' + m.unit))].join());
  check('seed: methods judgement (design) and probe (performance), one-line evidence', phased.every((m) => m.method === (m.lens === 'performance' ? 'probe' : 'judgement') && !!m.evidence && !m.evidence.includes('\n') && /sample/.test(m.evidence)));
  const v = (key: string) => compareOf(snap(), idOf(key), lenses)!;
  check('seed: verdicts moved / flat / worse / (failed) moved / rebuild moved / perf moved',
    ['des1-booking', 'des1-waitlist', 'des1-card', 'des1-waiver', 'des2-kiosk', 'perf1-timetable'].map((k) => v(k).verdict).join() === 'moved,flat,worse,moved,moved,moved' && v('perf1-heatmap').verdict === 'flat',
    ['des1-booking', 'des1-waitlist', 'des1-card', 'des1-waiver', 'des2-kiosk', 'perf1-timetable'].map((k) => v(k).verdict).join());
  const fromTo = (k: string) => `${v(k).from?.value}>${v(k).to?.value}`;
  check('seed: before = the map\'s value (booking 2 -> 1, waitlist 2 -> 2, card 3 -> 4, waiver 2 -> 1); kiosk keeps the sample\'s 2 -> 1',
    ['des1-booking', 'des1-waitlist', 'des1-card', 'des1-waiver', 'des1-kiosk', 'des2-kiosk'].map(fromTo).join() === '2>1,2>2,3>4,2>1,2>1,2>1', ['des1-booking', 'des1-waitlist', 'des1-card', 'des1-waiver', 'des1-kiosk', 'des2-kiosk'].map(fromTo).join());
  const shown = SAMPLE_ITEMS.flatMap((it) => { const p = prop(it.key), cur = mapValue(p.feature, p.lens, p.metric!); return cur === undefined ? [] : [{ it, p, cur }]; });
  check('seed: every metric the map shows for a sample feature keeps its number (the latest before reading equals it)', shown.length >= 4
    && shown.every(({ p, cur }) => v(SAMPLE_ITEMS.find((i) => i.title === p.title && i.pack === p.pack_id)!.key).from?.value === cur), shown.map(({ it, cur }) => it.key + '=' + cur).join());
  const runsOf = (key: string, metric: string) => v(key).before.filter((m) => m.metric === metric).map((m) => m.value).join();
  check('seed: perf items have three before runs and one after', runsOf('perf1-timetable', 'interactionP95Ms') === '96,104,98' && v('perf1-timetable').after.map((m) => m.value).join() === '72'
    && runsOf('perf1-heatmap', 'interactionP95Ms') === '80,88,80' && v('perf1-heatmap').after.map((m) => m.value).join() === '76', runsOf('perf1-timetable', 'interactionP95Ms'));
  check('seed: perf context rows (frameP95Ms, blockingMs, jankFrames, idleWakeups) before', ['frameP95Ms', 'blockingMs', 'jankFrames', 'idleWakeups'].every((m) => v('perf1-timetable').before.some((x) => x.metric === m)));
  check('seed: the rework chain (rework + note -> attempt_of, body quoting the note)', prop('des1-kiosk').status === 'rework' && !!prop('des1-kiosk').triage_note && prop('des1-kiosk').triaged_from === 'done'
    && prop('des2-kiosk').attempt_of === idOf('des1-kiosk') && (prop('des2-kiosk').body ?? '').includes(prop('des1-kiosk').triage_note!));
  const shots = s0.shots;
  const shotKeys = SAMPLE_ITEMS.filter((i) => i.screen).length;
  check('seed: a light and a dark pair per design item with a screen, 1600x900, phase and proposal_id, report like the harness', shots.length === shotKeys * 4 && shots.every((s: Shot) => s.size === '1600x900' && !!s.phase && !!s.proposal_id
    && /^sample-shots\/.+\.svg$/.test(s.path) && s.report?.minTextPx === 14 && Array.isArray(s.report?.consoleErrors) && typeof s.report?.textElements === 'number'), String(shots.length));
  check('seed: the failed item has no shots (harness cannot render it)', !shots.some((s) => s.proposal_id === idOf('des1-waiver')) && v('des1-waiver').shots.length === 0);
  check('seed: every shot file exists under public/', shots.every((s) => fs.existsSync(path.join(ROOT, 'public', s.path))), shots.find((s) => !fs.existsSync(path.join(ROOT, 'public', s.path)))?.path);
  const flat = v('des1-waitlist').shots.find((p) => p.theme === 'light')!;
  check('seed: the flat item\'s pair is byte-identical, the moved item\'s differs', fs.readFileSync(path.join(ROOT, 'public', flat.before!.path)).equals(fs.readFileSync(path.join(ROOT, 'public', flat.after!.path)))
    && !fs.readFileSync(path.join(ROOT, 'public', v('des1-booking').shots[0].before!.path)).equals(fs.readFileSync(path.join(ROOT, 'public', v('des1-booking').shots[0].after!.path))));
  const execRuns = s0.runs.filter((r) => r.phase === 'execute');
  check('seed: an execute run per pack (r-<14 digits>-<4 hex>), a committed row per item', execRuns.length === 3 && s0.packs.every((k) => execRuns.some((r) => r.id === k.run_id)) && execRuns.every((r) => /^r-\d{14}-[0-9a-f]{4}$/.test(r.id))
    && items.every((p) => s0.activity.some((a) => a.kind === 'committed' && a.text.includes(p.commit_sha!.slice(0, 7)))));
  check('seed: no null anywhere in the snapshot (absent values are omitted)', !JSON.stringify(s0).includes('null'));
  sim.bind({ order, manifest: (l) => manifests.get(l), value: mapValue });
  check('seed: a rebind keeps the train (no second seed)', snap().packs.length === 3 && snap().proposals.filter((p) => p.pack_id).length === 8);

  // ------------------------------------------------------------------ triage
  const T = (ids: string[], decision: 'accept' | 'rework' | 'descope' | 'reopen', note?: string) => sim.triage(note === undefined ? { ids, decision } : { ids, decision, note });
  check('triage: a bad body -> 400', [err(() => T([], 'accept')), err(() => sim.triage({ ids: ['x'], decision: 'ship' as 'accept' })), err(() => T(['a b'], 'accept'))].every((e) => e.status === 400));
  const nr = err(() => T([idOf('des1-waiver')], 'accept'));
  check('triage: accepting a failed item with no note -> 409, skipped note-required, body = the result', nr.status === 409 && JSON.stringify((nr.body as { skipped?: unknown })?.skipped) === JSON.stringify([{ id: idOf('des1-waiver'), status: 'failed', reason: 'note-required' }]) && (nr.body as { decision?: string }).decision === 'accepted', JSON.stringify(nr.body));
  const a1 = T([idOf('des1-booking')], 'accept');
  check('triage: accept -> accepted, by user:sample, triaged_from done', a1.triaged.join() === idOf('des1-booking') && a1.by === 'user:sample' && prop('des1-booking').status === 'accepted' && prop('des1-booking').triaged_from === 'done' && !!prop('des1-booking').triaged_at && !prop('des1-booking').triage_note);
  T([idOf('des1-waitlist')], 'accept', 'Ships flat: the reason renders only when the waitlist is full, which the harness does not reach.');
  T([idOf('des1-waiver')], 'accept', 'Ships with the gate fixed by hand: the two Retry tests were wrong, not the component.');
  const k1 = T([idOf('des1-card')], 'descope', 'Worse by one state: the disabled Pay needs its own slow-authorisation state first.');
  check('triage: the last waiting item of k-des-1 settles it open -> triaged (a rework item is not waiting)', k1.packs_triaged.join() === 'k-des-1' && pack('k-des-1').status === 'triaged', JSON.stringify(k1));
  const ro = T([idOf('des1-card')], 'reopen');
  check('triage: reopen -> back to triaged_from (done), the pack back to open, not reported', ro.decision === 'reopened' && prop('des1-card').status === 'done' && pack('k-des-1').status === 'open' && ro.packs_triaged.length === 0 && !prop('des1-card').triage_note);
  T([idOf('des1-card')], 'descope', 'Worse by one state: the disabled Pay needs its own slow-authorisation state first.');
  check('triage: descoped again -> k-des-1 triaged', pack('k-des-1').status === 'triaged');
  const rb2 = err(() => T([idOf('des1-kiosk')], 'reopen'));
  check('triage: reopen of a rework item that has its rebuild -> 409 rebuilt', rb2.status === 409 && (rb2.body as { skipped: { reason?: string }[] }).skipped[0]?.reason === 'rebuilt', JSON.stringify(rb2.body));
  const np = err(() => T([legacy.id], 'reopen'));
  check('triage: reopen with no recorded prior status -> 409 no-prior-status', np.status === 409 && (np.body as { skipped: { reason?: string }[] }).skipped[0]?.reason === 'no-prior-status', JSON.stringify(np.body));
  const nf = err(() => T(['p-ffffff'], 'accept'));
  check('triage: an unknown id -> 409, skipped not-found', nf.status === 409 && (nf.body as { skipped: { status: string }[] }).skipped[0]?.status === 'not-found');
  const d2 = T([idOf('des2-kiosk')], 'accept');
  const p1 = T([idOf('perf1-timetable')], 'accept');
  const p2 = T([idOf('perf1-heatmap')], 'accept', 'Flat within run-to-run noise (80, 88, 80 -> 76), but cheaper by construction.');
  check('triage: k-des-2 and k-perf-1 settle to triaged', d2.packs_triaged.join() === 'k-des-2' && !p1.packs_triaged.length && p2.packs_triaged.join() === 'k-perf-1');

  // ------------------------------------------------------------------ suggest and create
  const sg = sim.suggestRelease();
  check('suggest: 0.1.0 from none with no tag', sg.version === '0.1.0' && sg.from === 'none' && sg.reason === 'no v* tag yet in the sample', JSON.stringify(sg));
  check('create: a bad version -> 400', err(() => sim.createRelease('v0.1')).status === 400 && err(() => sim.createRelease('0.1.0', [])).status === 400);
  check('create: no accepted item free among the ids -> 409', err(() => sim.createRelease('0.1.0', [idOf('des1-card')])).status === 409);
  const c1 = sim.createRelease('0.1.0');
  check('create: a draft rel-0.1.0 on release/0.1.0 with every free accepted item', c1.release.id === 'rel-0.1.0' && c1.release.branch === 'release/0.1.0' && c1.release.status === 'draft' && c1.added.length === 6 && c1.release.items.length === 6
    && c1.release.items.every((p) => p.release_id === 'rel-0.1.0') && c1.release.created_by === 'user:sample', JSON.stringify(c1.added));
  // reopen an accepted item in the draft: it leaves the release; accept it again: free, and 0.1.0 is taken
  T([idOf('des1-waitlist')], 'reopen');
  check('triage: reopen of an item in a draft release takes it out', prop('des1-waitlist').status === 'done' && prop('des1-waitlist').release_id === undefined);
  T([idOf('des1-waitlist')], 'accept', 'Ships flat: the reason renders only when the waitlist is full, which the harness does not reach.');
  const ex = err(() => sim.createRelease('0.1.0'));
  check('create: the version exists -> 409', ex.status === 409 && /already exists/.test(ex.message ?? ''), ex.message);
  check('suggest: a taken version is passed over', sim.suggestRelease().version === '0.1.1');

  // ------------------------------------------------------------------ build: gh off, gate, conflict
  sim.setTrainToggles({ ghOff: true, conflict: false, gateFails: false });
  check('build: gh off -> 412 gh not authenticated', err(() => sim.buildRelease('rel-0.1.0')).status === 412 && err(() => sim.buildRelease('rel-0.1.0')).message === 'gh not authenticated');
  check('build: a bad id -> 400, an unknown one -> 404', err(() => sim.buildRelease('nope')).status === 400 && err(() => sim.buildRelease('rel-9.9.9')).status === 404);
  check('finish: a draft -> 409', err(() => sim.finishRelease('rel-0.1.0')).status === 409);
  sim.setTrainToggles({ ghOff: false, conflict: false, gateFails: true });
  const g = sim.buildRelease('rel-0.1.0');
  check('build: a release job (kind release, step build, version), the release building', g.kind === 'release' && g.step === 'build' && g.version === '0.1.0' && g.release === 'rel-0.1.0' && rel('rel-0.1.0').status === 'building');
  check('build: a second job for the same release -> 409', err(() => sim.buildRelease('rel-0.1.0')).status === 409);
  const ir = err(() => T([idOf('des1-booking')], 'rework', 'changed my mind'));
  check('triage: a person cannot take an item out of a building release -> 409 in-release', ir.status === 409 && (ir.body as { skipped: { reason?: string }[] }).skipped[0]?.reason === 'in-release');
  const gr = await run(g);
  check('build with the gate failing -> release failed, job failed with the gate', rel('rel-0.1.0').status === 'failed' && rel('rel-0.1.0').error === 'gate failed: vitest (sample)' && gr.job.status === 'failed' && gr.job.error === 'gate failed: vitest (sample)', JSON.stringify(gr.job));
  const grun = snap().runs.find((r) => r.id === gr.job.run_id);
  check('build: its run (note bp-job:<id> · release rel-0.1.0 at <sha>) ends failed', !!grun && isJobNote(grun.note, g.id) && grun.note!.startsWith(`bp-job:${g.id} · release rel-0.1.0`) && grun.status === 'failed', grun?.note);

  sim.setTrainToggles({ ghOff: false, conflict: true, gateFails: false });
  const inRel = snap().proposals.filter((p) => p.release_id === 'rel-0.1.0').length;
  const bj = sim.buildRelease('rel-0.1.0');
  check('build: a failed release builds again (error cleared)', rel('rel-0.1.0').status === 'building' && rel('rel-0.1.0').error === undefined);
  const br = await run(bj);
  const r1 = rel('rel-0.1.0');
  check('build with a conflict -> pr-open with a sample PR, notes written', r1.status === 'pr-open' && /^https:\/\/github\.com\/sample\/kettle\/pull\/\d+$/.test(r1.pr_url ?? '') && br.job.status === 'done' && br.job.exit_code === 0, JSON.stringify(r1));
  const most = c1.release.items.reduce((a, b) => (SAMPLE_ITEMS.find((i) => i.title === b.title && i.pack === b.pack_id)!.files.length > SAMPLE_ITEMS.find((i) => i.title === a.title && i.pack === a.pack_id)!.files.length ? b : a));
  const back = snap().proposals.find((p) => p.id === most.id)!;
  check('build: the accepted item with the most files went back to rework by skill:lens-scan, out of the release', back.status === 'rework' && back.triaged_by === 'skill:lens-scan' && back.release_id === undefined
    && /^conflict on release\/0\.1\.0: src\//.test(back.triage_note ?? ''), JSON.stringify({ id: back.id, s: back.status, n: back.triage_note }));
  check('build: notes name each item (title, lens, feature, before -> after with unit, commit) and a flagged item\'s note', !!r1.notes && /Kettle 0\.1\.0 \(sample\)/.test(r1.notes)
    && snap().proposals.filter((p) => p.release_id === 'rel-0.1.0').every((p) => r1.notes!.includes(p.title) && r1.notes!.includes(p.commit_sha!.slice(0, 7)))
    && r1.notes.includes('undesignedStates 2 -> 1 states') && r1.notes.includes('Shipped flagged: Ships with the gate fixed by hand'), r1.notes);
  // the first sample also holds buildRelease's own notify (its microtask lands inside the first wait)
  check('build: one notify per tick, never more', br.ticks.slice(1).every((n) => n === 1), br.ticks.join());
  const bsecs = br.timeline.length;
  check('build: takes about 6-10 s on the sim clock', bsecs >= 6 && bsecs <= 11, String(bsecs));
  check('build: a cherry-pick activity row per item on the job\'s run', snap().activity.filter((a) => a.run_id === br.job.run_id && (a.kind === 'committed' || a.kind === 'error')).length === inRel, String(inRel));
  console.log('build timeline (conflict on):\n  ' + br.timeline.join('\n  '));

  // ------------------------------------------------------------------ merge and finish
  check('build: a pr-open release does not build again -> 409', err(() => sim.buildRelease('rel-0.1.0')).status === 409);
  sim.sampleMerge('rel-0.1.0');
  check('sampleMerge: pr-open -> merged; again -> 409', rel('rel-0.1.0').status === 'merged' && err(() => sim.sampleMerge('rel-0.1.0')).status === 409);
  sim.setTrainToggles({ ghOff: true, conflict: false, gateFails: false });
  check('finish: gh off -> 412', err(() => sim.finishRelease('rel-0.1.0')).status === 412);
  sim.setTrainToggles({ ghOff: false, conflict: false, gateFails: false });
  const fj = sim.finishRelease('rel-0.1.0');
  const fr = await run(fj);
  const shipped = snap().proposals.filter((p) => p.release_id === 'rel-0.1.0');
  check('finish -> tagged v0.1.0, every item released, the job done', rel('rel-0.1.0').status === 'tagged' && rel('rel-0.1.0').tag === 'v0.1.0' && shipped.length === 4 && shipped.every((p) => p.status === 'released') && fr.job.status === 'done' && fj.step === 'finish', JSON.stringify(fr.job));
  check('finish: k-des-2 and k-perf-1 closed; k-des-1 waits (an item back in rework, one accepted)', pack('k-des-2').status === 'closed' && pack('k-perf-1').status === 'closed' && pack('k-des-1').status !== 'closed');
  console.log('finish timeline:\n  ' + fr.timeline.join('\n  '));

  // the second release: the conflicted item reopened (rework -> accepted), the flat one, a clean run -> k-des-1 closes
  const sg2 = sim.suggestRelease();
  check('suggest after a tag: a patch bump from v0.1.0', sg2.version === '0.1.1' && sg2.from === 'v0.1.0', JSON.stringify(sg2));
  T([most.id], 'reopen');
  check('triage: reopen of the conflicted item -> accepted again (no rebuild)', snap().proposals.find((p) => p.id === most.id)!.status === 'accepted');
  const c2 = sim.createRelease(sg2.version);
  check('create 0.1.1 with the two free items', c2.added.length === 2, JSON.stringify(c2.added));
  await run(sim.buildRelease('rel-0.1.1'));
  // as the live route: finish may start from pr-open (the release run checks the merge first)
  await run(sim.finishRelease('rel-0.1.1'));
  check('0.1.1 tagged; every pack closed, k-des-1 with its reworked item still rework (its rebuild shipped)', prop('des1-kiosk').status === 'rework' &&
    rel('rel-0.1.1').status === 'tagged' && snap().packs.every((k) => k.status === 'closed'), snap().packs.map((k) => k.id + ':' + k.status).join());
  check('the snapshot still carries no null', !JSON.stringify(snap()).includes('null'));

  // ------------------------------------------------------------------ commit diffs
  for (const it of SAMPLE_ITEMS) {
    const p = prop(it.key), d = sim.commitDiff(p.commit_sha!);
    const ok = d.sha === p.commit_sha && d.message.includes(`Lens-Item: ${p.id}`) && d.message.includes(`Lens-Pack: ${p.pack_id}`) && /sample/i.test(d.message)
      && d.lines >= 20 && d.lines <= 120 && d.files.length === it.files.length && d.stat.startsWith('commit ' + p.commit_sha) && /files? changed/.test(d.stat) && !d.truncated && d.patch.split('\n').length === d.lines;
    check(`commitDiff ${it.key}: trailers, sample, ${d.lines} lines, ${d.files.length} files`, ok, `${d.lines} lines`);
  }
  check('commitDiff: a 7-char prefix finds the commit', sim.commitDiff(prop('des1-booking').commit_sha!.slice(0, 7)).sha === prop('des1-booking').commit_sha);
  check('commitDiff: not hex -> 400, unknown -> 404', err(() => sim.commitDiff('xyz')).status === 400 && err(() => sim.commitDiff('deadbeef')).status === 404);

  // ------------------------------------------------------------------ shotSrc
  const live: Shot = { id: 1, run_id: 'r', feature: 'f', path: 'shots/r-20261015150739-6052/p-c02a61-before/stage and depths-light-1600x900.png', captured_at: '' };
  check('shotSrc: a live shot = live.ts shotUrl', shotSrc('athena', live) === shotUrl('athena', live) && shotSrc('a b', live) === shotUrl('a b', live), shotSrc('athena', live));
  check('shotSrc: a Kettle shot = /<path>', shotSrc(null, { path: 'sample-shots/des1-booking-before-light.svg' }) === '/sample-shots/des1-booking-before-light.svg');
} finally { sim.dispose(); }

console.log(failed ? `check-train-sim: ${failed} failed, ${passed} passed` : `check-train-sim: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
