// The one x <-> time mapping of the two time sliders (the strip's hairline in Strip.tsx and the panel's revisions chart in
// BaseBar.tsx): history x for a date, hour x for a sim second, which zone a pointer x falls in, and what a drag at x
// means. Pure and React-free (no '@/' imports) so Node runs check-scrub.ts on it as-is.
import { HOUR } from '@bp/core/model/constants';

/** A pointer within this many px left of the hour zone still counts as the hour (the gap between the two axes is dead otherwise). */
export const HOUR_PAD = 6;
/** Within this many px of the history's right end the pointer snaps to now. */
export const NOW_SNAP = 3;

/** The slider's geometry in its own svg units. `d0`/`d1` are the first and last week as day numbers (dnum). */
export interface ScrubGeom { h0: number; h1: number; o0: number; o1: number; hour: boolean; d0: number; d1: number; weeks: readonly string[]; dn: readonly number[]; asOf: string }

/** x of a date (as a day number) on the history axis. With no span (one week of history) everything sits at "now", the right end:
 *  the same answer for the strip, the panel and the bars the panel draws. */
export const histX = (g: Pick<ScrubGeom, 'h0' | 'h1' | 'd0' | 'd1'>, d: number) => (g.d1 > g.d0 ? g.h0 + ((d - g.d0) / (g.d1 - g.d0)) * (g.h1 - g.h0) : g.h1);
/** x of sim second `s` on the hour axis (clamped to the hour). */
export const hourX = (g: Pick<ScrubGeom, 'o0' | 'o1'>, s: number) => g.o0 + (Math.max(0, Math.min(HOUR, s)) / HOUR) * (g.o1 - g.o0);
/** Sim second at x on the hour axis (clamped to the hour). */
export const hourAt = (g: Pick<ScrubGeom, 'o0' | 'o1'>, x: number) => Math.max(0, Math.min(HOUR, ((x - g.o0) / (g.o1 - g.o0)) * HOUR));
/** Whether x is over the hour ahead. */
export const inHour = (g: Pick<ScrubGeom, 'o0' | 'o1' | 'hour'>, x: number) => g.hour && x >= g.o0 - HOUR_PAD && x <= g.o1 + HOUR_PAD;
/** The history can move only with two or more weeks. */
export const canTravel = (weeks: readonly string[]) => weeks.length > 1;

/** What a drag at x means. `lock` is the zone the drag began in (a drag never changes zone). */
export type Scrub = { lock: 'h' | 'o'; date?: string; hourT?: number; back?: boolean };
export function scrubAt(g: ScrubGeom, x: number, lock: 'h' | 'o' | null, simT: number): Scrub | null {
  if (lock !== 'h' && inHour(g, x)) {
    const t = hourAt(g, x);
    // the sim replays events and cannot rewind: left of the head the head stays put and the drag says so
    return { lock: 'o', hourT: Math.max(t, simT), back: t < simT };
  }
  if (lock === 'o') return { lock: 'o', hourT: Math.max(hourAt(g, x), simT), back: hourAt(g, x) < simT };
  if (!canTravel(g.weeks)) return { lock: 'h', date: g.asOf };
  let best = g.weeks[0], bd = 1e9;
  for (let i = 0; i < g.weeks.length; i++) { const d = Math.abs(histX(g, g.dn[i]) - x); if (d < bd) { bd = d; best = g.weeks[i]; } }
  if (x > g.h1 - NOW_SNAP) best = g.asOf;
  return { lock: 'h', date: best };
}

/** What the sliders announce for the time position: one place so strip and panel never word it differently. */
export function valueText(now: boolean, rev: number, t: string, weeks: number, hour: boolean): string {
  let s = now ? 'Now, revision ' + rev : 'Revision ' + rev + ', ' + t;
  if (weeks < 2) s += '; one week of history, nothing earlier to travel to';
  if (hour) s += '; the simulated hour only moves forward';
  return s;
}

/** Key plan click -> the fraction of the box to fly to. A keyboard activation has no pointer (clientX/Y 0, detail 0): the
 *  box's centre, never a point off the plan. A pointer click is clamped into the box. */
export function keyPlanFrac(clientX: number, clientY: number, r: { left: number; top: number; width: number; height: number }, detail: number): [number, number] {
  if (!(r.width > 0 && r.height > 0)) return [0.5, 0.5];
  const fx = (clientX - r.left) / r.width, fy = (clientY - r.top) / r.height;
  if (detail === 0 || fx < 0 || fx > 1 || fy < 0 || fy > 1) return [0.5, 0.5];
  return [fx, fy];
}
