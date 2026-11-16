// Pure: the companion's two orders (spark companion-upgrade, P3). The cross-product inbox ranks open decisions the way the
// ledger does within one product (docs/blueprint-ui.md "Tier first" and "One score"): tier ascending, untriaged after tier 3
// (derive.ts tierRank), then the finding's worth (scan/score.ts: band ranked before reserve, the STORED scan-score/1 score
// descending, then the pre-v5 estimate for rows without one, then unscored rows), then age, oldest first, then product and
// id. The ledger and this file share scan/score.ts, so there is one formula and no restated copy. Coverage gaps rank by a
// base per reason times the feature's tier weight; scripts/check-companion-door.ts pins both orders.
import { tierRank } from '../../../scan/derive.ts';
import { byWorth, estValue, type Worth } from '../../../scan/score.ts';
import type { Gap, GapReason, InboxItem } from '../../../companion/contract.ts';

/** The pre-v5 estimate per proposal id (scan/score.ts estValue; kept under its old name for the companion's callers). */
export const rankValue = estValue;

/** An inbox candidate before ranking: the item plus its worth. */
export type Ranked = Omit<InboxItem, 'rank'> & { worth: Worth };
/** Sorted and numbered: `rank` is the 1-based position. */
export function rankInbox(xs: readonly Ranked[]): InboxItem[] {
  return [...xs]
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || byWorth(a.worth, b.worth) || b.ageMs - a.ageMs || (a.product < b.product ? -1 : a.product > b.product ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ worth: _w, ...x }, i) => ({ ...x, rank: i + 1 }));
}

/** A gap's base by reason. */
export const GAP_BASE: Record<GapReason, number> = { unmeasured: 3, unknown: 2, stale: 1, deviation: 1 };
/** A feature's tier weight: tier 0 -> 4, 1 -> 3, 2 -> 2, 3 or untiered -> 1. */
export const tierWeight = (tier: number | undefined): number => (tier === 0 ? 4 : tier === 1 ? 3 : tier === 2 ? 2 : 1);
export const gapScore = (reason: GapReason, tier: number | undefined): number => GAP_BASE[reason] * tierWeight(tier);

/** Score descending, then product, feature, lens, reason: deterministic for equal scores. */
export function rankGaps(xs: readonly Gap[]): Gap[] {
  const c = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...xs].sort((a, b) => b.score - a.score || c(a.product, b.product) || c(a.feature, b.feature) || c(a.lens, b.lens) || c(a.reason, b.reason));
}
