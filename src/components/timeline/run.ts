// A live product's scan run as the timeline tells it: the run's lenses (one guarded accessor), how many features it has
// measured against its scope, its duration and its age. Pure and React-free (no '@/' imports) so Node runs check-run.ts on
// it as-is; the wording of the age is the header pill's `ago`, passed in.

import { scopeFeatures } from '../../lib/scan/scope.ts';

interface RunLike { id: string; started_at: string; updated_at: string; ended_at?: string; status: string; lenses?: string[]; scope?: Record<string, unknown> }
interface MeasLike { run_id: string; feature: string }
interface FeatLike { id: string; domain: string; capability: string }

/** The one guarded read of a run's lenses (a row written by an older skill may lack them). */
export const runLenses = (run: Pick<RunLike, 'lenses'> | null | undefined): string[] => (run && Array.isArray(run.lenses) ? run.lenses : []);

export { scopeFeatures };

/** Features this run has measured so far (distinct, by run id) against its scope. `total` is never below `done`. */
export function runProgress(run: RunLike, measurements: readonly MeasLike[], features: readonly FeatLike[]): { done: number; total: number } {
  const seen = new Set<string>();
  for (const m of measurements) if (m.run_id === run.id) seen.add(m.feature);
  return { done: seen.size, total: Math.max(seen.size, scopeFeatures(run, features).length) };
}

/** Milliseconds the run took (or has taken so far): to ended_at, else to now while running, else to its last update. */
export function runMs(run: RunLike, nowMs: number): number {
  const s = Date.parse(run.started_at), e = run.ended_at ? Date.parse(run.ended_at) : run.status === 'running' ? nowMs : Date.parse(run.updated_at);
  return Math.max(0, (isNaN(e) ? nowMs : e) - (isNaN(s) ? nowMs : s));
}
/** "38 s", "41 min", "1 h 05 min". */
export function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return s + ' s';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}
/** When the run finished, as the header pill words it: ended_at, else the last update. */
export const runAgeMs = (run: RunLike, nowMs: number) => nowMs - Date.parse(run.ended_at ?? run.updated_at);

/** The run's two short facts: `progress` ("12 / 40 features") and `time` ("6 min elapsed" running, "2 h ago · 41 min" otherwise). */
export function runFacts(run: RunLike, p: { done: number; total: number }, nowMs: number, ago: (ms: number) => string): { progress: string; time: string } {
  const dur = fmtDur(runMs(run, nowMs));
  return { progress: p.done + ' / ' + p.total + ' features', time: run.status === 'running' ? dur + ' elapsed' : ago(runAgeMs(run, nowMs)) + ' · ' + dur };
}
