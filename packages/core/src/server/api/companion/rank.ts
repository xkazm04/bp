// Pure: the companion's two orders (spark companion-upgrade, P3). The cross-product inbox ranks open decisions the way the
// ledger does within one product (docs/blueprint-ui.md "Tier first" and "Value per effort"): tier ascending, untriaged after
// tier 3 (derive.ts tierRank), then value per effort, highest first, then age, oldest first, then product and id. Coverage
// gaps rank by a base per reason times the feature's tier weight; scripts/check-companion-door.ts pins both formulas.
// The value formula is apps/web's ledger `rankValue` (useLedger.ts), restated here because core cannot import the web app;
// a change to one must be made to the other (the check pins this one's numbers).
import { tierRank } from '../../../scan/derive.ts';
import type { Proposal } from '../../../scan/types.ts';
import type { Gap, GapReason, InboxItem } from '../../../companion/contract.ts';

const SIZE_W: Record<string, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

/** ev = gain x confidence / effort, per proposal id, over one product's proposals (the ledger's rankValue). */
export function rankValue(ps: readonly Proposal[]): Map<string, number> {
  const top = new Map<string, number>();
  for (const p of ps) if (p.metric && p.expected_delta !== undefined) { const k = p.lens + '\u0000' + p.metric; top.set(k, Math.max(top.get(k) ?? 0, Math.abs(p.expected_delta))); }
  const out = new Map<string, number>();
  for (const p of ps) {
    const t = p.metric && p.expected_delta !== undefined ? top.get(p.lens + '\u0000' + p.metric) ?? 0 : 0;
    const gain = t > 0 ? 0.25 + (0.75 * Math.abs(p.expected_delta!)) / t : 0.5;
    const risk = Math.min(10, Math.max(1, p.risk ?? 5));
    out.set(p.id, (gain * (11 - risk)) / 10 / (SIZE_W[p.size ?? 'M'] ?? 3));
  }
  return out;
}

/** An inbox candidate before ranking: the item plus its value. */
export type Ranked = Omit<InboxItem, 'rank'> & { value: number };
/** Sorted and numbered: `rank` is the 1-based position. */
export function rankInbox(xs: readonly Ranked[]): InboxItem[] {
  return [...xs]
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.value - a.value || b.ageMs - a.ageMs || (a.product < b.product ? -1 : a.product > b.product ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ value: _v, ...x }, i) => ({ ...x, rank: i + 1 }));
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
