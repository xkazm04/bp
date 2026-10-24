// What changed each week of the revision history, so the hairline can say it before you travel there: the stage
// changes between one week and the next, replayed with the same stageAt the plan uses (window (weeks[i-1], weeks[i]],
// exactly what travelling from week i-1 to week i shows). Derived once per product, never per frame. Pure and
// React-free (no '@/' imports, no parameter properties) so Node runs check-changes.ts on it.
import type { Stage } from '@bp/core/data';
import { stageAt } from '@bp/core/standard/present';

export interface StageMove { id: string; code: string; from: Stage | null; to: Stage | null }
/** One week's changes. The first week is the baseline: nothing earlier to change from. */
export interface WeekChange { week: string; n: number; baseline: boolean; moves: StageMove[] }

type F = { id: string; code: string; stage: Stage | null; revs: readonly { stage: Stage; date: string }[] };

export function weekChanges(features: readonly F[], weeks: readonly string[], asOf: string): WeekChange[] {
  return weeks.map((week, i) => {
    if (i === 0) return { week, n: 0, baseline: true, moves: [] };
    const moves: StageMove[] = [];
    for (const f of features) {
      const from = stageAt(f, weeks[i - 1], asOf), to = stageAt(f, week, asOf);
      if (from !== to) moves.push({ id: f.id, code: f.code, from, to });
    }
    return { week, n: moves.length, baseline: false, moves };
  });
}

/** A mark per week with changes, weighted by how many features changed stage (`w` is n over the busiest week). */
export function changeMarks(c: readonly WeekChange[]): { week: string; n: number; w: number }[] {
  const max = Math.max(0, ...c.map((x) => x.n));
  return c.filter((x) => x.n > 0).map((x) => ({ week: x.week, n: x.n, w: x.n / max }));
}

/** The week's changes in plain words: "19 stage changes · 6 to live · 2 added", or "no stage changes" (said, not omitted). */
export function changeWords(c: WeekChange): string {
  if (c.baseline) return 'first revision';
  if (c.n === 0) return 'no stage changes';
  const live = c.moves.filter((m) => m.to === 'live' && m.from !== 'live').length, added = c.moves.filter((m) => m.from === null).length;
  return [c.n + (c.n === 1 ? ' stage change' : ' stage changes'), live ? live + ' to live' : '', added ? added + ' added' : ''].filter(Boolean).join(' · ');
}

/** The change of the week the plan shows at date `d` (the last week at or before it), or undefined before the first. */
export function changeOn(c: readonly WeekChange[], d: string): WeekChange | undefined {
  let hit: WeekChange | undefined;
  for (const x of c) { if (x.week > d) break; hit = x; }
  return hit;
}

/** What a slider adds to its announced value for date `d`: the week's words, nothing for the baseline. */
export function changeSummary(c: readonly WeekChange[] | undefined, d: string): string {
  const x = c && changeOn(c, d);
  return x && !x.baseline ? changeWords(x) : '';
}
