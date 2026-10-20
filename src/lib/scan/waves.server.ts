// The live waves of a product (waves.ts): `<root>/.ai/lens-scan/work/bp-waves.json` = { version: 1, waves }, read on every
// call (the file is tiny and the server may restart under it), written through a tmp file and a rename. A file that cannot
// be read is said once (warnOnce) and read as no waves; a READ never writes, and the write that follows moves the broken
// file to `bp-waves.corrupt.json` first, so nothing is lost. Also here: takeForBuild, the approve-and-take step /dispatch and
// a wave dispatch share, and dispatchWave (one execute job per package, each with its own model and effort).
// Server-only: route handlers import it. Everything is synchronous, so two calls cannot interleave.
import fs from 'node:fs';
import path from 'node:path';
import type { ProductEntry } from './types.ts';
import { MAX_PROPOSALS, busyProposals, enqueueExecute } from './jobs.server.ts';
import type { ScanJob } from './jobs.ts';
import { recovered, storeFile, warnOnce } from './products.server.ts';
import { decide, snapshotOf } from './store.server.ts';
import { WAVE_EFFORTS, WAVE_MODELS, createIn, packagesOf, patchIn, recordJobs, removeIn, type Wave, type WaveRefusal, type WaveStep } from './waves.ts';

if (typeof window !== 'undefined') throw new Error('waves.server.ts is server-only');

const waveFile = (root: string): string => path.join(root, '.ai', 'lens-scan', 'work', 'bp-waves.json');
const isWave = (w: unknown): w is Wave => {
  const x = w as Partial<Wave> | null;
  return !!x && typeof x.id === 'string' && typeof x.name === 'string' && (x.status === 'draft' || x.status === 'dispatched') && Array.isArray(x.packages);
};

/** The product's waves; no file = none; a broken file = none, said once. Never writes. */
export function listWaves(root: string): Wave[] {
  const file = waveFile(root);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnOnce(file, e);
    return [];
  }
  try {
    const xs = (JSON.parse(text) as { waves?: unknown })?.waves;
    if (!Array.isArray(xs)) throw new Error('no "waves" array');
    recovered(file);
    return xs.filter(isWave);
  } catch (e) { warnOnce(file, e); return []; }
}
/** Whether the file is there but cannot be read as waves: a write moves it aside before it makes a new one. */
function broken(root: string): boolean {
  const file = waveFile(root);
  try { return !Array.isArray((JSON.parse(fs.readFileSync(file, 'utf8')) as { waves?: unknown })?.waves); } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ENOENT'; }
}
function save(root: string, waves: Wave[]): void {
  const file = waveFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (broken(root)) fs.renameSync(file, file.replace(/\.json$/, '.corrupt.json'));
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, waves }, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** Create a draft wave from a create body. A refusal carries the route's status (400 body, 409 taken, 429 MAX_WAVES). */
export function createWave(root: string, body: unknown): { ok: true; wave: Wave } | WaveRefusal {
  const r = createIn(listWaves(root), body, new Date().toISOString());
  if (!r.ok) return r;
  save(root, r.waves);
  return { ok: true, wave: r.wave };
}
/** Patch a draft wave's name and/or packages (400 body, 404, 409 not a draft / taken). */
export function patchWave(root: string, id: string, patch: unknown): { ok: true; wave: Wave } | WaveRefusal {
  const r: WaveStep = patchIn(listWaves(root), id, patch);
  if (!r.ok) return r;
  save(root, r.waves);
  return { ok: true, wave: r.wave };
}
/** Delete a draft wave (404, 409 not a draft). */
export function removeWave(root: string, id: string): { ok: true } | WaveRefusal {
  const r = removeIn(listWaves(root), id);
  if (!r.ok) return r;
  save(root, r.waves);
  return { ok: true };
}

// ------------------------------------------------------------------------------------------- building
/** What taking findings for a build came to: `approved` = the ids this call approved, `go` = every id to build, `skipped` = the
 *  rest; `error` = the store stayed locked part-way (what was done stands, the caller answers 503). */
export interface Taken { approved: string[]; go: string[]; skipped: { id: string; status: string }[]; error?: string }

/**
 * The step /dispatch and a wave dispatch share: each `proposed` id is approved through the store's decision write (decided_by
 * 'blueprint'), an `approved` one is taken as it is, anything else is skipped with its status ('unknown' for an id the store
 * lacks; 'in-job' for one in `busy`, a queued or running execute job already builds it). Each id once.
 */
export function takeForBuild(file: string, ids: readonly string[], busy?: ReadonlySet<string>): Taken {
  const approved: string[] = [], go: string[] = [], skipped: { id: string; status: string }[] = [];
  try {
    const status = new Map(snapshotOf(file).proposals.map((x) => [x.id, x.status]));
    for (const id of new Set(ids)) {
      const s = status.get(id);
      if (s !== 'proposed' && s !== 'approved') { skipped.push({ id, status: s ?? 'unknown' }); continue; }
      if (busy?.has(id)) { skipped.push({ id, status: 'in-job' }); continue; }
      if (s === 'approved') { go.push(id); continue; }
      const r = decide(file, id, { decision: 'approve' });
      if (r.ok) { approved.push(id); go.push(id); }
      else if (r.status === 409 && r.proposal.status === 'approved') go.push(id); // approved elsewhere a moment ago
      else skipped.push({ id, status: r.status === 409 ? r.proposal.status : 'unknown' });
    }
  } catch (e) { return { approved, go, skipped, error: (e as Error).message }; }
  return { approved, go, skipped };
}

/** The answer of dispatchWave: the route's status and body (202 and 429 carry `wave`, `jobs`, `approved`, `skipped`). */
export interface WaveDispatchAnswer { status: 202 | 400 | 404 | 409 | 429 | 503; body: Record<string, unknown> }

/**
 * Dispatch a wave (default: every package, else the named ones): per package, keep its proposed or approved findings that
 * no queued or running execute job builds, approve the proposed ones, and queue execute jobs of at most 50 with the
 * package's model and effort. The first job makes the wave `dispatched`; a later call ("Dispatch remaining") appends. A full
 * queue (429) stops it with what was queued so far recorded and the approvals standing; 409 when nothing could go.
 */
export function dispatchWave(slug: string, product: ProductEntry, waveId: string, packages?: readonly string[]): WaveDispatchAnswer {
  const waves = listWaves(product.root), wave = waves.find((w) => w.id === waveId);
  if (!wave) return { status: 404, body: { error: `no wave ${waveId}` } };
  const pkgs = packagesOf(wave, packages);
  if (typeof pkgs === 'string') return { status: 400, body: { error: pkgs } };
  const odd = pkgs.find((p) => !WAVE_MODELS.includes(p.model) || !WAVE_EFFORTS.includes(p.effort)); // a hand-edited file: refused before anything is approved
  if (odd) return { status: 400, body: { error: `bad-opts: package ${odd.id} has a model or effort outside the allow-list` } };
  const file = storeFile(product), busy = busyProposals(slug);
  const approved: string[] = [], skipped: { id: string; status: string }[] = [], jobs: ScanJob[] = [], refs: { package: string; job: string }[] = [];
  let stop: { status: 400 | 429 | 503; error: string } | undefined, went = 0;
  for (const pk of pkgs) {
    if (stop) break;
    const t = takeForBuild(file, pk.ids, busy);
    approved.push(...t.approved); skipped.push(...t.skipped); went += t.go.length;
    if (t.error) stop = { status: 503, error: `dispatch failed: ${t.error}` };
    for (let i = 0; i < t.go.length; i += MAX_PROPOSALS) {
      const r = enqueueExecute(slug, product.root, t.go.slice(i, i + MAX_PROPOSALS), { model: pk.model, effort: pk.effort, wave: wave.id, package: pk.id });
      if (!r.ok) { stop = { status: r.status, error: `${r.error}; ${jobs.length} execute job${jobs.length === 1 ? '' : 's'} queued` }; break; }
      jobs.push(r.job); refs.push({ package: pk.id, job: r.job.id });
      for (const id of r.job.proposals ?? []) busy.add(id);
    }
  }
  if (!jobs.length && !stop && !went) return { status: 409, body: { error: 'none of these findings can be built (only proposed or approved ones that no job is building can)', skipped } };
  let next = wave;
  if (jobs.length) {
    next = recordJobs(wave, refs, new Date().toISOString());
    try { save(product.root, waves.map((w) => (w.id === wave.id ? next : w))); } catch (e) {
      return { status: 503, body: { error: `jobs queued but the wave could not be saved: ${(e as Error).message}`, wave, jobs, approved, skipped } };
    }
  }
  const body = { wave: next, jobs, approved, skipped };
  return stop ? { status: stop.status, body: { error: stop.error, ...body } } : { status: 202, body };
}
