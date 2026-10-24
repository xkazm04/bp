// The performance comparison table's figures on top of compare.ts runStats (median, spread, noise): the after's change
// against the baseline median and its %, the outlier rule, and the range strip's scale. No second median: the verdict
// comes from compare.ts verdictOf, so the table and the item row always agree, and the change's tone and the sentence
// under the table are worded from that verdict (toneOf, reasonOf), never from a direction or noise test of their own.
// Pure: Node checks import it.
import { FRAME_MS, runStats, type RunStats, type Verdict } from '../scan/compare.ts';

export interface PerfFigures extends RunStats {
  lo: number;
  hi: number;
  /** One flag per run (in `runs` order, ascending): more than half the noise above the median. */
  outlier: boolean[];
  /** The noise is the one-frame floor, not the spread. */
  frame: boolean;
  after?: number;
  /** after - median, and that as a % of the median. */
  change?: number;
  pct?: number;
}

/**
 * A run more than half the noise away from the median, either way: the lucky-or-unlucky run a person should see
 * outlined. It is symmetric because the point is the run that DISTORTS the baseline, and a run that is far too
 * fast drags the median down and makes the after look worse by exactly as much as a slow one flatters it. The
 * table shows metrics in both directions (`atTarget` reads the field's `better`), so one side would be the wrong
 * side for half of them.
 */
export const isOutlier = (v: number, s: Pick<RunStats, 'median' | 'noise'>): boolean => s.noise > 0 && Math.abs(v - s.median) > s.noise / 2;

/** Baseline runs and an after reading as the table shows them. */
export function perfFigures(values: readonly number[], after: number | undefined, unit?: string): PerfFigures {
  const s = runStats(values, unit), n = s.runs.length;
  const f: PerfFigures = { ...s, lo: n ? s.runs[0] : NaN, hi: n ? s.runs[n - 1] : NaN, outlier: s.runs.map((v) => isOutlier(v, s)), frame: unit === 'ms' && n > 1 && s.spread < FRAME_MS };
  if (after !== undefined) {
    f.after = after;
    f.change = after - s.median;
    if (s.median) f.pct = (f.change / s.median) * 100;
  }
  return f;
}

/** Whether a change beyond the noise: the words under the table say why a verdict is what it is. */
export const beyondNoise = (f: Pick<PerfFigures, 'change' | 'noise'>): boolean => f.change !== undefined && Math.abs(f.change) > f.noise;

/** A figure as the table prints it (ui/tables num): whole, else one decimal. */
const num1 = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The change cell's tone, from the verdict alone: a green figure is a move, a red one is worse, anything else is plain. */
export const toneOf = (v: Verdict): '' | 'good' | 'bad' => (v === 'moved' ? 'good' : v === 'worse' ? 'bad' : '');

/** Why the verdict is what it is, in one sentence over the item's figures: the noise phrase from beyondNoise, the verb
 *  from the verdict, so the sentence never says "moved" beside a chip that does not. */
export function reasonOf(v: Verdict, f: Pick<PerfFigures, 'change' | 'noise' | 'runs'>, unit?: string): string {
  const u = unit ? ' ' + unit : '';
  if (f.change === undefined) return 'No after reading yet: the item cannot be judged.';
  const ch = `The change (${signed(f.change)}${u}) against the median of ${f.runs.length} baseline runs`;
  const noise = `the noise (±${num1(f.noise)}${u})`;
  if (!beyondNoise(f)) return `${ch} is not larger than ${noise}, so this is flat: a lucky run looks like this.`;
  if (v === 'unmeasured') return `${ch} is larger than ${noise}, but nothing states which way is better (the lens field gives no direction and the item no expected delta), so it is unmeasured.`;
  return `${ch} is larger than ${noise}, so this ${v === 'worse' ? 'got worse' : 'moved'}.`;
}

/** The range strip's scale: 0 at the left, the largest of the runs, the after, the target and the warn line, plus 8 %,
 *  at the right. `x` answers a CSS percentage (two decimals). */
export function rangeScale(f: Pick<PerfFigures, 'hi' | 'after'>, target?: number, warn?: number): { max: number; x(v: number): string } {
  const max = Math.max(f.hi, f.after ?? 0, target ?? 0, warn ?? 0) * 1.08 || 1;
  return { max, x: (v: number) => ((Math.max(0, Math.min(max, v)) / max) * 100).toFixed(2) + '%' };
}

/** A signed figure: + / − (a real minus) / ± for zero, one decimal unless whole. */
export function signed(v: number): string {
  const a = Math.abs(v), t = Number.isInteger(a) ? String(a) : a.toFixed(1);
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + t;
}

/** A unit as the table prints it next to a figure (a rate's long form shortened). */
export const shortUnit = (u: string | undefined): string => (u === 'callbacks/s' ? '/s' : u ?? '');

/** Whether a reading meets its target in the metric's direction. */
export const atTarget = (v: number, target: number, better: 'up' | 'down' = 'down'): boolean => (better === 'up' ? v >= target : v <= target);
