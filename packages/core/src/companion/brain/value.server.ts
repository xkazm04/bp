// What one memory is worth to one recall: rank = match x confidence x fade x (1 + min(uses, 10) x 0.05), each axis clamped.
// fade = 0.5^(ageDays / halfLife) with a half-life per kind (user 180, project 60, world 120 days; anything else, episodes and
// procedurals included, the declared default 60) so a new kind is never silently immortal. Fade ranks a memory lower and never
// hides it; importance decides who is in the always tier, not the order. Pure arithmetic: no clock read, no I/O.
if (typeof window !== 'undefined') throw new Error('value.server.ts is server-only');

export const HALF_LIFE_DAYS: Record<string, number> = { user: 180, project: 60, world: 120 };
export const DEFAULT_HALF_LIFE_DAYS = 60;
/** Any keyword match is worth at least this share of the page's best (athena's floor: between one and two half-lives). */
export const MATCH_FLOOR = 0.4;
export const DEFAULT_CONFIDENCE = 0.7;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function fade(ageDays: number, kind: string): number {
  const h = HALF_LIFE_DAYS[kind] ?? DEFAULT_HALF_LIFE_DAYS;
  return Math.pow(0.5, Math.max(0, Number.isFinite(ageDays) ? ageDays : 0) / h);
}

/** BM25 (lower is better) as a share of the page's best, in [MATCH_FLOOR, 1]; no spread means every row is a full match. */
export function matchStrength(score: number, best: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(best) || best >= 0) return 1;
  return MATCH_FLOOR + (1 - MATCH_FLOOR) * clamp(score / best, 0, 1);
}

export function rank(o: { match?: number; confidence?: number; ageDays: number; kind: string; uses?: number }): number {
  const match = clamp(Number.isFinite(o.match) ? (o.match as number) : 1, 0, 1);
  const trust = clamp(Number.isFinite(o.confidence) ? (o.confidence as number) : DEFAULT_CONFIDENCE, 0, 1);
  const uses = Math.min(Math.max(0, o.uses ?? 0), 10);
  return match * trust * fade(o.ageDays, o.kind) * (1 + uses * 0.05);
}
