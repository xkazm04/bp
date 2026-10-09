// Reader helpers that the spec defines but the evaluator does not need: the General health of a
// feature (spec 8.4, last paragraph), how many evidence fields a reader shows (8.6, `evidence`) and
// the measured length of a lens line (8.6, "The lens line"). Pure and dependency-free like health.ts,
// so Node's type stripping and a Rust port can follow it.
import type { ComputedHealth, Density, Health, LensField, Scalar } from './types.ts';

const SCORE: Record<ComputedHealth, number> = { good: 0, watch: 1, bad: 2 };

/**
 * A feature's health in a General view: the worst of its lenses' measured healths (bad over watch over
 * good), over enabled lenses only. `na` and `unmeasured` do not count; none measured: `unmeasured`.
 */
export function generalHealth(hs: Iterable<Health>): Health {
  let worst: ComputedHealth | null = null;
  for (const h of hs) {
    if (h !== 'good' && h !== 'watch' && h !== 'bad') continue;
    if (worst === null || SCORE[h] > SCORE[worst]) worst = h;
  }
  return worst ?? 'unmeasured';
}

/** How many evidence fields a reader of this density sees: 2 (simple), 3 (standard), 4 (dense). */
export const EVIDENCE_BY_DENSITY: Readonly<Record<Density, number>> = { simple: 2, standard: 3, dense: 4 };

const NUMERIC = new Set(['number', 'integer', 'percent', 'money']);

/**
 * The measured length of a lens line as a fraction 0..1 of the rail, or null when nothing is measured
 * (absent value, or a field that cannot be measured):
 * - numeric field: value / max, clamped to 0..1 (`percent` uses max 100 when none is given; a numeric
 *   field without `max` uses `fallbackMax`, e.g. the largest value the reader has seen, when given);
 * - enum field: the value's position / (number of values - 1), so the first value is an empty rail.
 */
export function lensLine(field: LensField | null | undefined, value: Scalar | null | undefined, fallbackMax?: number): number | null {
  if (!field || value === undefined || value === null) return null;
  if (field.type === 'enum') {
    if (typeof value !== 'string') return null;
    const i = field.values.indexOf(value);
    if (i < 0) return null;
    return field.values.length > 1 ? i / (field.values.length - 1) : 1;
  }
  if (!NUMERIC.has(field.type) || typeof value !== 'number' || Number.isNaN(value)) return null;
  const max = field.max ?? (field.type === 'percent' ? 100 : fallbackMax);
  if (max === undefined || !(max > 0)) return null;
  return Math.max(0, Math.min(1, value / max));
}
