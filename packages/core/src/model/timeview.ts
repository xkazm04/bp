// The feature page's read model for "as of a date". Only what the data records is shown for a past date:
// the stage (replayed from the events log by aggregates.stageAt) and a metric's reading (the scan keeps
// every measurement with its time). Anything else - health, other fields - has no history, so it says so:
// a now-value is never handed back for a date that is not now. Pure; no engine, no React.
import type { Feature, Stage } from '@bp/core/data';
import type { LensField } from '@bp/core/standard/types';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { stageAt } from './aggregates';
import { metricHistory } from './live';

export type StageAsOf =
  | { at: 'now'; stage: Stage | null }
  | { at: 'then'; stage: Stage }
  | { at: 'before' }       // the feature was not on the drawing yet
  | { at: 'unknown' };     // no stage recorded

/** The stage on `t` (the page's date); `asOf` is the data's own "now". */
export function stageView(f: Feature, t: string, asOf: string): StageAsOf {
  if (t >= asOf) return { at: 'now', stage: f.stage };
  const s = stageAt(f, t, asOf);
  if (s) return { at: 'then', stage: s };
  return f.revs.length ? { at: 'before' } : { at: 'unknown' };
}

export type ValueAsOf =
  | { at: 'now' }                                       // t is now: the caller reads the live value
  | { at: 'then'; value: number; measured: string }     // the last reading on or before t
  | { at: 'none' };                                     // nothing recorded for that date

/**
 * A lens field's value on `t`. Only a metric field with readings has a history; a reading counts when
 * it was taken on or before the end of day `t`. No reading by then (or no history) is `none`.
 */
export function valueView(scan: ScanSnapshot | undefined, baseFeatureId: string, lens: string, field: LensField, t: string, asOf: string): ValueAsOf {
  if (t >= asOf) return { at: 'now' };
  if (!field.metric) return { at: 'none' };
  let hit: { value: number; measured: string } | null = null;
  for (const m of metricHistory(scan, baseFeatureId, lens, field.key)) {
    if (m.measured_at.slice(0, 10) > t) break;
    hit = { value: m.value, measured: m.measured_at.slice(0, 10) };
  }
  return hit ? { at: 'then', ...hit } : { at: 'none' };
}

/** A metric's readings on or before `t`, oldest first (what a sparkline shows for that date). */
export function readingsUpTo(scan: ScanSnapshot | undefined, baseFeatureId: string, lens: string, key: string, t: string): number[] {
  const out: number[] = [];
  for (const m of metricHistory(scan, baseFeatureId, lens, key)) { if (m.measured_at.slice(0, 10) > t) break; out.push(m.value); }
  return out;
}

export const NOT_RECORDED = 'Not recorded for that date';
