// Ledger waves: findings grouped into named packages, each built by its own execute job with its own model and effort,
// prepared as a draft and dispatched as a whole later. Client-safe types and rules; the live file is waves.server.ts,
// the Kettle stand-in is lib/model/scan-sim.ts. Absent values are omitted, never null (the store's wire convention).
import { SAFE_ID, type ScanJob } from './jobs.ts';

/** The Claude Code CLI's own aliases: each always means the latest model of its family. */
export type WaveModel = 'sonnet' | 'opus';
export type WaveEffort = 'low' | 'medium' | 'high' | 'xhigh';
export const WAVE_MODELS: readonly WaveModel[] = ['sonnet', 'opus'];
export const WAVE_EFFORTS: readonly WaveEffort[] = ['low', 'medium', 'high', 'xhigh'];
export const MAX_WAVES = 50, MAX_PACKAGES = 12, MAX_WAVE_IDS = 400, MAX_NAME = 60;

export interface WavePackage {
  /** `pk-1`, `pk-2`..: unique inside the wave, assigned by whoever stores the wave. */
  id: string;
  name: string;
  model: WaveModel;
  effort: WaveEffort;
  /** Proposal ids, at least one. Dispatch builds them in execute jobs of at most MAX_PROPOSALS. */
  ids: string[];
}
export interface Wave {
  /** `w-<base36 ms>-<4 random>` */
  id: string;
  name: string;
  /** draft = editable, nothing queued yet; dispatched = at least one job was queued (more can follow: "Dispatch remaining"). */
  status: 'draft' | 'dispatched';
  created_at: string;
  dispatched_at?: string;
  packages: WavePackage[];
  /** Every execute job this wave queued, in order. */
  jobs?: { package: string; job: string }[];
}
/** What a wave reads as: derived from its jobs, never stored. */
export type WaveState = 'draft' | 'queued' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled';

export type WaveBody = { name: string; packages: Omit<WavePackage, 'id'>[] };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Check a create body `{ name, packages:[{ name, model, effort, ids }] }`. */
export function checkWaveBody(body: unknown): ({ ok: true } & WaveBody) | { ok: false; error: string } {
  const b = body as { name?: unknown; packages?: unknown } | null;
  const name = checkName(b?.name);
  if (!name) return bad(`name must be 1..${MAX_NAME} characters`);
  const packages = checkPackages(b?.packages);
  return typeof packages === 'string' ? bad(packages) : { ok: true, name, packages };
}
/** A name: trimmed, 1..MAX_NAME characters, else null. */
export function checkName(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= MAX_NAME ? s : null;
}
/** Packages of a body: the checked list, or the refusal text. A proposal id may appear once in a wave. */
export function checkPackages(v: unknown): Omit<WavePackage, 'id'>[] | string {
  if (!Array.isArray(v) || !v.length || v.length > MAX_PACKAGES) return `packages must be 1..${MAX_PACKAGES}`;
  const seen = new Set<string>(), out: Omit<WavePackage, 'id'>[] = [];
  for (const x of v as Record<string, unknown>[]) {
    const name = checkName(x?.name);
    if (!name) return `a package name must be 1..${MAX_NAME} characters`;
    if (!WAVE_MODELS.includes(x.model as WaveModel)) return `model must be one of ${WAVE_MODELS.join(', ')}`;
    if (!WAVE_EFFORTS.includes(x.effort as WaveEffort)) return `effort must be one of ${WAVE_EFFORTS.join(', ')}`;
    const ids = x.ids;
    if (!Array.isArray(ids) || !ids.length || ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i))) return `package "${name}" needs at least one proposal id`;
    for (const i of ids as string[]) { if (seen.has(i)) return `${i} is in the wave twice`; seen.add(i); }
    if (seen.size > MAX_WAVE_IDS) return `a wave holds at most ${MAX_WAVE_IDS} findings`;
    out.push({ name, model: x.model as WaveModel, effort: x.effort as WaveEffort, ids: [...(ids as string[])] });
  }
  return out;
}

/** The wave's state from the jobs the product has (the wave's own `jobs` pick them out by id). A job the registry has pruned
 *  counts as done: the proposals' own statuses say what happened. */
export function waveState(w: Wave, jobs: readonly ScanJob[]): WaveState {
  if (w.status === 'draft' || !w.jobs?.length) return 'draft';
  const by = new Map(jobs.map((j) => [j.id, j]));
  let queued = 0, running = 0, done = 0, failed = 0, cancelled = 0;
  for (const { job } of w.jobs) {
    const s = by.get(job)?.status ?? 'done';
    if (s === 'queued') queued++; else if (s === 'running') running++; else if (s === 'failed') failed++; else if (s === 'cancelled') cancelled++; else done++;
  }
  if (running) return 'running';
  if (queued) return 'queued';
  const n = w.jobs.length;
  if (done === n) return 'done';
  if (cancelled === n) return 'cancelled';
  if (failed === n) return 'failed';
  return 'partial';
}

/** Proposal id -> the newest wave (and package) that holds it. */
export function waveOfId(waves: readonly Wave[]): Map<string, { wave: string; package: string }> {
  const out = new Map<string, { wave: string; package: string }>();
  for (const w of [...waves].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))) {
    for (const p of w.packages) for (const id of p.ids) out.set(id, { wave: w.id, package: p.id });
  }
  return out;
}

/** What dispatching a wave answered. */
export interface WaveDispatchResult { wave: Wave; jobs: ScanJob[]; approved: string[]; skipped: { id: string; status: string }[] }
