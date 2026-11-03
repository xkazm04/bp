// Compare two recorded dates on the same drawing: baseline A (pinned by the reader) against endpoint B (the travelled
// date, or now). Only what the data records is compared, and each value keeps its own date:
//   - the stage on each date (the events log: stageAt; at now the map's stage). A feature with no revisions has no
//     dated stage, so its stage is never "changed"; one not on the drawing yet at A and drawn at B is a change from
//     "not on the drawing yet";
//   - each numeric metric's last current reading on or before each date (metricHistory: a pack's `after` readings
//     never count; a reading taken after the date is in that date's future and never counts). A metric read by B but
//     not by A is a FIRST OBSERVATION, kept apart from a move: nothing is assumed before it, never a zero;
//   - lens health where both dates are past and healthAsOf replays both (today's rules over each date's readings).
// Pure; computed by the caller when an endpoint or the data changes, never per frame.
import type { Feature, Health, LensDef, Stage } from '@bp/core/data';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { NUMERIC } from '@bp/core/standard/present';
import { stageAt } from './aggregates';
import { metricHistory } from './live';
import { baseId } from './product';
import { healthAsOf } from './timeview';

/** A reading in force on a date: its value and the day it was taken. */
export interface DatedReading { value: number; measured: string }
export interface MetricChange { lens: string; key: string; label: string; unit: string }
/** A metric read on both dates whose value moved. */
export interface MetricMove extends MetricChange { a: DatedReading; b: DatedReading }
/** A metric first read after A and by B: no baseline. */
export interface FirstReading extends MetricChange { b: DatedReading }
export interface HealthMove { lens: string; a: Health; b: Health }
export interface CompareEntry {
  id: string;
  /** The stage on A and on B when they differ (null at A: not on the drawing yet); null when unchanged or not dated. */
  stage: { a: Stage | null; b: Stage | null } | null;
  moves: MetricMove[];
  firsts: FirstReading[];
  health: HealthMove[];
}
export interface Comparison {
  /** Baseline and endpoint dates as given (B at or after the data's now means now). */
  a: string; b: string;
  /** Only the features where something changed, by id; `ids` in model order. */
  byId: ReadonlyMap<string, CompareEntry>;
  ids: readonly string[];
  /** Features with a stage change, a metric move, a first observation, a replayed health move. */
  counts: { stage: number; moves: number; firsts: number; health: number };
}

/** The stage on `t` by the events log (the map's at now); undefined when it is not dated (no revisions). */
function stageOn(f: Feature, t: string, asOf: string): Stage | null | undefined {
  if (t >= asOf) return f.stage;
  if (!f.revs.length) return undefined;
  return stageAt(f, t, asOf);
}

/** The last current reading on or before the end of day `t` (any reading at or after `asOf`: now). */
export function readingOn(scan: ScanSnapshot | undefined, fid: string, lens: string, key: string, t: string, asOf: string): DatedReading | null {
  const cut = t >= asOf ? null : t;
  let hit: DatedReading | null = null;
  for (const m of metricHistory(scan, fid, lens, key)) {
    const day = m.measured_at.slice(0, 10);
    if (cut !== null && day > cut) break;
    if (typeof m.value === 'number' && Number.isFinite(m.value)) hit = { value: m.value, measured: day };
  }
  return hit;
}

/** Compare every feature between A and B. Features with nothing recorded as changed are absent. */
export function compareDates(features: readonly Feature[], lenses: readonly LensDef[], scan: ScanSnapshot | undefined, a: string, b: string, asOf: string): Comparison {
  const byId = new Map<string, CompareEntry>(), ids: string[] = [];
  const counts = { stage: 0, moves: 0, firsts: 0, health: 0 };
  const bothPast = a < asOf && b < asOf;
  for (const f of features) {
    const sa = stageOn(f, a, asOf), sb = stageOn(f, b, asOf);
    const stage = sa !== undefined && sb !== undefined && sa !== sb ? { a: sa, b: sb } : null;
    const moves: MetricMove[] = [], firsts: FirstReading[] = [], health: HealthMove[] = [];
    if (scan) {
      const id = baseId(f.id);
      for (const d of lenses) {
        for (const x of d.manifest?.fields ?? []) {
          if (x.source || !NUMERIC.has(x.type)) continue;
          const rb = readingOn(scan, id, d.id, x.key, b, asOf); if (!rb) continue;
          const ra = readingOn(scan, id, d.id, x.key, a, asOf);
          const c = { lens: d.id, key: x.key, label: x.label, unit: x.unit ?? '' };
          if (!ra) firsts.push({ ...c, b: rb });
          else if (ra.value !== rb.value) moves.push({ ...c, a: ra, b: rb });
        }
        if (bothPast) {
          const ha = healthAsOf(f, d, scan, a, asOf), hb = healthAsOf(f, d, scan, b, asOf);
          if (ha && hb && ha.health !== hb.health) health.push({ lens: d.id, a: ha.health, b: hb.health });
        }
      }
    }
    if (!stage && !moves.length && !firsts.length && !health.length) continue;
    byId.set(f.id, { id: f.id, stage, moves, firsts, health });
    ids.push(f.id);
    if (stage) counts.stage++;
    if (moves.length) counts.moves++;
    if (firsts.length) counts.firsts++;
    if (health.length) counts.health++;
  }
  return { a, b, byId, ids, counts };
}

/** How many of these features changed between the comparison's dates (a place's count on the plan). */
export function changedIn(c: Comparison, fs: readonly Feature[]): number {
  let n = 0;
  for (const f of fs) if (c.byId.has(f.id)) n++;
  return n;
}

/** One line of what changed on a feature, in words, with each value's own date. */
export interface CompareLine { kind: 'stage' | 'move' | 'first' | 'health'; text: string }
const num = (v: number) => String(Number.isInteger(v) ? v : +v.toFixed(2));
const withUnit = (v: number, unit: string) => num(v) + (unit ? (unit === '%' ? '%' : ' ' + unit) : '');
/** An endpoint as words: its date, or "now". */
export const endpointWord = (t: string, asOf: string) => (t >= asOf ? 'now' : t);

/**
 * The feature page's comparison lines: the stage on each date, each moved metric with both readings and the day each
 * was taken, each first observation labelled as such (nothing before it, never a zero), each replayed health move.
 */
export function compareLines(e: CompareEntry, lensName: (id: string) => string, stageWord: (s: Stage) => string, a: string, b: string, asOf: string): CompareLine[] {
  const out: CompareLine[] = [], A = endpointWord(a, asOf), B = endpointWord(b, asOf);
  if (e.stage) out.push({ kind: 'stage', text: 'Stage: ' + (e.stage.a ? stageWord(e.stage.a) : 'not on the drawing yet') + ' on ' + A + ' → ' + (e.stage.b ? stageWord(e.stage.b) : 'not on the drawing yet') + ' on ' + B });
  for (const m of e.moves) out.push({ kind: 'move', text: lensName(m.lens) + ' · ' + m.label + ': ' + withUnit(m.a.value, m.unit) + ' (read ' + m.a.measured + ') → ' + withUnit(m.b.value, m.unit) + ' (read ' + m.b.measured + ')' });
  for (const m of e.firsts) out.push({ kind: 'first', text: lensName(m.lens) + ' · ' + m.label + ': first observation ' + withUnit(m.b.value, m.unit) + ' (read ' + m.b.measured + '); nothing was recorded by ' + A });
  for (const h of e.health) out.push({ kind: 'health', text: lensName(h.lens) + ' health: ' + h.a + ' on ' + A + ' → ' + h.b + ' on ' + B + " (both replayed by today's rules)" });
  return out;
}
