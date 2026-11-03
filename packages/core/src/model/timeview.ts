// The feature page's read model for "as of a date". Only what the data records is shown for a past date:
// the stage (replayed from the events log by aggregates.stageAt) and a metric's reading (the scan keeps
// every measurement with its time). Health has no stored history, but where a lens's rules read only metrics with
// a reading by then (and the replayed stage), healthAsOf re-runs TODAY's rules over THOSE readings and says so
// ("replayed by today's rules from N readings up to <date>"). Anything else - other fields, KPIs, overrides - has
// no history, so it says so: a now-value is never handed back for a date that is not now. Pure; no engine, no React.
import type { Feature, Health, LensDef, Stage } from '@bp/core/data';
import type { FacetValues, LensField } from '@bp/core/standard/types';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { NUMERIC, reasonOf } from '@bp/core/standard/present';
import { conditionFields, evaluateLens, fillReason } from '@bp/core/standard/health';
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
  | { at: 'replayed'; health: Health; why: string | null; label: string; readings: number; upTo: string; value: number | null; measured: string | null } // today's rules over that date's readings
  | { at: 'then'; health: 'unmeasured'; why: string; value: number; measured: string }   // the headline's reading by then
  | { at: 'none'; health: 'unmeasured'; why: string };                                   // nothing recorded for that date

/**
 * One lens on `t`. A past date whose rule inputs are all recorded is replayed (healthAsOf, labelled); otherwise health
 * has no history, so it is unmeasured with the headline's reading by then, if any.
 */
export function lensAsOf(f: Feature, d: LensDef, scan: ScanSnapshot | undefined, t: string, asOf: string): LensAsOf {
  if (t >= asOf) { const fl = f.lens[d.id]; return { at: 'now', health: fl?.h ?? 'unmeasured', why: fl ? reasonOf(fl) : null }; }
  const v: ValueAsOf = d.headline ? valueView(scan, baseId(f.id), d.id, d.headline, t, asOf) : { at: 'none' };
  const r = healthAsOf(f, d, scan, t, asOf);
  if (r) return { at: 'replayed', health: r.health, why: r.why, label: r.label, readings: r.readings, upTo: r.upTo, value: v.at === 'then' ? v.value : null, measured: v.at === 'then' ? v.measured : null };
  return v.at === 'then'
    ? { at: 'then', health: 'unmeasured', why: 'Read on ' + v.measured + '. Health is not recorded for that date.', value: v.value, measured: v.measured }
    : { at: 'none', health: 'unmeasured', why: NOT_RECORDED };
}

// ------------------------------------------------------------------ replayed health
/** A lens's health on a past date, re-run by today's rules over the readings in force then. */
export interface HealthReplay {
  health: Health;
  /** The matched rule's reason, filled with the replayed values; null when only the default applies. */
  why: string | null;
  /** "replayed by today's rules from N readings up to <date>": every replayed value carries it. */
  label: string;
  /** How many readings the facet was built from, and the newest one's date. */
  readings: number;
  upTo: string;
  /** The values the rules were run on (the readings, and the stage when a field is bound to it). */
  values: FacetValues;
}

/**
 * Today's rules over the readings in force on `t` (a past date; null at or after `asOf`). The facet is built FRESH:
 * each numeric, unbound field's last reading on or before the end of day `t` (metricHistory: a pack's `after`
 * readings never count), plus fields bound to the stage at `stageAt(f, t)`. The map's current facet values, its
 * overrides, its applicability marks and the KPIs are never carried into the past. A pair is replayed only when
 * every field the lens's usable rules and `applies_when` read is such a reading or the stage; anything else (an enum
 * judged by hand, a KPI, another feature field, a metric not yet read by then) leaves it null: not recorded.
 */
export function healthAsOf(f: Feature, d: LensDef, scan: ScanSnapshot | undefined, t: string, asOf: string): HealthReplay | null {
  const m = d.manifest;
  if (t >= asOf || !scan || !m?.health?.rules || !m.fields) return null;
  const F = new Map(m.fields.map((x) => [x.key, x] as const));
  const usable = (c: Parameters<typeof conditionFields>[0]) => conditionFields(c).every((k) => F.has(k));
  const reads = new Set<string>();
  for (const r of m.health.rules) if (usable(r.when)) for (const k of conditionFields(r.when)) reads.add(k);
  const aw = m.health.applies_when;
  if (aw && usable(aw)) for (const k of conditionFields(aw)) reads.add(k);
  const id = baseId(f.id), values: FacetValues = {};
  let readings = 0, upTo = '';
  for (const x of m.fields) {
    if (x.source || !NUMERIC.has(x.type)) continue;
    let hit: { value: number; day: string } | null = null;
    for (const r of metricHistory(scan, id, d.id, x.key)) {
      const day = r.measured_at.slice(0, 10);
      if (day > t) break;
      if (typeof r.value === 'number' && Number.isFinite(r.value)) hit = { value: r.value, day };
    }
    if (!hit) continue;
    values[x.key] = hit.value; readings++;
    if (hit.day > upTo) upTo = hit.day;
  }
  if (!readings) return null;
  const stage = stageAt(f, t, asOf);
  for (const k of reads) {
    const x = F.get(k)!;
    if (x.source) { if (!('feature' in x.source) || x.source.feature !== 'stage' || !stage) return null; continue; }
    if (values[k] === undefined) return null;
  }
  const e = evaluateLens(m, { values }, t, { feature: stage ? { stage } : {} });
  return {
    health: e.health, why: e.rule ? fillReason(e.rule.reason, e.values) : null,
    label: "replayed by today's rules from " + readings + ' reading' + (readings === 1 ? '' : 's') + ' up to ' + upTo,
    readings, upTo, values: e.values,
  };
}

/** The replayed health of every pair on one past date: feature id -> lens id -> health (see replayTable). */
export type ReplayTable = ReadonlyMap<string, ReadonlyMap<string, Health>>;

/**
 * The replayed health of every (feature, lens) pair on `t`, for drawing a past date. Only replayable pairs appear: a
 * missing entry is "not recorded", never "good". null at or after `asOf` (read the live model). A caller computes it
 * once per travelled date and scan table, never per frame.
 */
export function replayTable(features: readonly Feature[], lenses: readonly LensDef[], scan: ScanSnapshot | undefined, t: string, asOf: string): ReplayTable | null {
  if (t >= asOf) return null;
  const out = new Map<string, Map<string, Health>>();
  if (!scan) return out;
  for (const f of features) for (const d of lenses) {
    const r = healthAsOf(f, d, scan, t, asOf);
    if (!r) continue;
    let row = out.get(f.id);
    if (!row) out.set(f.id, (row = new Map()));
    row.set(d.id, r.health);
  }
  return out;
}
