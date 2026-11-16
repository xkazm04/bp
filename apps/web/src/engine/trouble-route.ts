// The trouble route: N / Shift+N step through the features the current lens marks bad or watch (under General, every
// lens's), in the plan's room-walk order (M.L.walk), then bay and tile order inside a room. The route is captured on the
// first N and FROZEN while it is read: a feature that turns bad mid-route is not spliced in (the reader's place would
// jump); it is counted as "N new" and joins when the route is captured again (stepping past either end, or a lens
// switch). Health stays live and separate from the route: an arrival says the feature's health NOW, so a member that
// recovered reads "now good" rather than leaving a hole. Pure, so the order and the words are checked in Node.
import type { Feature, ViewId } from '@bp/core/data';
import { GENERAL } from '@bp/core/data/types';
import type { Layout, Product } from '@bp/core/model';

export interface TroubleRoute {
  /** The view the route was captured under. */
  view: ViewId;
  /** Feature ids in route order. */
  ids: string[];
  has: Set<string>;
  /** The cursor: -1 before the first arrival. */
  i: number;
}

/** Each feature's place in walk order: rooms as M.L.walk orders them, then their bays, then the bay's tiles. */
export function routeRank(L: Layout): Map<string, number> {
  const rank = new Map<string, number>();
  for (const R of L.walk) for (const B of R.bays) for (const T of B.tiles) if (!rank.has(T.id)) rank.set(T.id, rank.size);
  return rank;
}

/** A frozen route over `members` (the trouble index's list for the view), in walk order; features with no tile are left out. */
export function captureRoute(view: ViewId, members: readonly Feature[], rank: ReadonlyMap<string, number>): TroubleRoute {
  const ids = members.map((f) => f.id).filter((id) => rank.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)!);
  return { view, ids, has: new Set(ids), i: -1 };
}

/** The next cursor, or null when the step leaves the route (past the last going forward, before the first going back). */
export function stepRoute(r: TroubleRoute, dir: 1 | -1): number | null {
  if (!r.ids.length) return null;
  if (r.i < 0) return dir > 0 ? 0 : r.ids.length - 1;
  const j = r.i + dir;
  return j < 0 || j >= r.ids.length ? null : j;
}

/** Members in trouble now that the frozen route does not hold. */
export function newMembers(r: TroubleRoute, members: readonly Feature[]): number {
  let n = 0;
  for (const f of members) if (!r.has.has(f.id)) n++;
  return n;
}

const HWORD: Record<string, string> = { good: 'good', watch: 'watch', bad: 'bad', unmeasured: 'not measured', na: 'does not apply' };

/** What an arrival says: "3 of 8 · 1 new · Payments › Card vault · Security bad: 2 secrets found". */
export function routeWords(P: Product, L: Layout, f: Feature, view: ViewId, i: number, n: number, fresh: number): string {
  const T = L.TILE[f.id], where = T ? T.room.name + ' › ' : '';
  let health: string;
  if (view === GENERAL) {
    health = f.trouble.length
      ? f.trouble.map((t) => (P.LENS[t.lens]?.name ?? t.lens) + ' ' + t.h + ': ' + t.why).join('; ')
      : 'no trouble now';
  } else {
    const name = P.LENS[view]?.name ?? view, t = f.trouble.find((x) => x.lens === view);
    health = t ? name + ' ' + t.h + ': ' + t.why : name + ' now ' + (HWORD[f.lens[view]?.h ?? ''] ?? 'not measured');
  }
  return (i + 1) + ' of ' + n + (fresh ? ' · ' + fresh + ' new' : '') + ' · ' + where + f.name + ' · ' + health;
}
