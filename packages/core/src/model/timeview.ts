// The feature page's read model for "as of a date". Only what the data records is shown for a past date:
// the stage (replayed from the events log by aggregates.stageAt) and a metric's reading (the scan keeps
// every measurement with its time). Anything else - health, other fields - has no history, so it says so:
// a now-value is never handed back for a date that is not now. Pure; no engine, no React.
import type { Feature, Health, LensDef, Stage } from '@bp/core/data';
import type { LensField } from '@bp/core/standard/types';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { reasonOf } from '@bp/core/standard/present';
import { stageAt } from './aggregates';
import { STAGE_WORD } from './constants';
import { metricHistory } from './live';
import { baseId } from './product';

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

// ------------------------------------------------------------------ the presenter every feature-detail surface reads
// The as-of rule in one place: the desktop General and lens tabs, the phone document and its lens panels render these
// and never re-derive them. At now the presenter hands back only what it owns (the stage line, the lens health and
// reason); the now-only pieces with live inputs (the plain sentence, the flags) are the caller's now branch, which
// check-timeview holds every component file to.

export type RecordAsOf =
  | { at: 'now'; stage: string; flagged: null; lede: null }
  | { at: 'past'; stage: string; flagged: string; lede: { strong: string; rest: string } };

/** The record's dated lines on `t`: the stage (replayed), the flags (no history: not recorded) and the lede. */
export function recordAsOf(f: Feature, t: string, asOf: string): RecordAsOf {
  const sv = stageView(f, t, asOf);
  if (sv.at === 'now') return { at: 'now', stage: f.stage ? STAGE_WORD[f.stage] + ' · since ' + f.stageSince : 'Unknown', flagged: null, lede: null };
  const word = sv.at === 'then' ? STAGE_WORD[sv.stage] : sv.at === 'before' ? 'Not on the drawing yet' : 'Stage unknown';
  return { at: 'past', stage: word + ' on ' + t, flagged: NOT_RECORDED, lede: { strong: word, rest: 'on ' + t + '. How it was doing then is not recorded.' } };
}

export type LensAsOf =
  | { at: 'now'; health: Health; why: string | null }                                     // the caller reads the live values
  | { at: 'then'; health: 'unmeasured'; why: string; value: number; measured: string }   // the headline's reading by then
  | { at: 'none'; health: 'unmeasured'; why: string };                                   // nothing recorded for that date

/** One lens on `t`: health has no history, so a past date is unmeasured with the headline's reading by then, if any. */
export function lensAsOf(f: Feature, d: LensDef, scan: ScanSnapshot | undefined, t: string, asOf: string): LensAsOf {
  if (t >= asOf) { const fl = f.lens[d.id]; return { at: 'now', health: fl?.h ?? 'unmeasured', why: fl ? reasonOf(fl) : null }; }
  const v: ValueAsOf = d.headline ? valueView(scan, baseId(f.id), d.id, d.headline, t, asOf) : { at: 'none' };
  return v.at === 'then'
    ? { at: 'then', health: 'unmeasured', why: 'Read on ' + v.measured + '. Health is not recorded for that date.', value: v.value, measured: v.measured }
    : { at: 'none', health: 'unmeasured', why: NOT_RECORDED };
}
