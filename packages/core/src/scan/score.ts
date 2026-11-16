// Pure: a finding's worth, the one order the ledger (apps/web useLedger.ts) and the companion's inbox (server/api/companion/
// rank.ts) both sort by. scan-finding/1: the skill STORES `score` (scan-score/1) and a reader never recomputes it, so:
//   scored     the stored `score` (one decimal), sorted descending;
//   estimated  a row without a score (a v4 store, an imported work item, a finding missing impact or effort) keeps the
//              blueprint's old value per effort `estValue` below, shown "est." and ranked after every scored row;
//   never 0    an unknown is never rendered as 0 (`worthText`).
// The order (docs/blueprint-ui.md "Tier first" and "One score"): tier first, untriaged after tier 3 (stop-ship stays on top,
// a documented deviation from the contract's "consumers sort by score"), then band ranked before reserve, then scored before
// estimated, then score (or the estimate) descending; the callers break ties by age and id.
import type { Band, Proposal, ProposalSize } from './types.ts';

/** Effort per size, the estimate's denominator (and the ledger's dispatch-bar effort). */
export const SIZE_W: Record<ProposalSize, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

/**
 * The pre-v5 value per effort, ONLY for rows without a stored score:
 *   est = gain x confidence / effort
 *   gain       = 0.25 + 0.75 x |expected_delta| / the largest |expected_delta| among the findings of the same lens and
 *                metric (normalised per metric); 0.5 when the finding names no metric or no delta
 *   confidence = (11 - risk) / 10, risk 1..10 (a missing risk reads 5)
 *   effort     = size weight XS 1, S 2, M 3, L 5, XL 8 (a missing size reads M)
 * Per proposal id, over one product's proposals (the normalisation needs the set).
 */
export function estValue(ps: readonly Proposal[]): Map<string, number> {
  const top = new Map<string, number>();
  for (const p of ps) if (p.metric && p.expected_delta !== undefined) { const k = p.lens + '\u0000' + p.metric; top.set(k, Math.max(top.get(k) ?? 0, Math.abs(p.expected_delta))); }
  const out = new Map<string, number>();
  for (const p of ps) {
    const t = p.metric && p.expected_delta !== undefined ? top.get(p.lens + '\u0000' + p.metric) ?? 0 : 0;
    const gain = t > 0 ? 0.25 + (0.75 * Math.abs(p.expected_delta!)) / t : 0.5;
    const risk = Math.min(10, Math.max(1, p.risk ?? 5));
    out.set(p.id, (gain * (11 - risk)) / 10 / (SIZE_W[p.size ?? 'M'] ?? SIZE_W.M));
  }
  return out;
}

/**
 * Whether a row was written under scan-finding/1: it carries any v5 judgement key. The wire omits NULL columns, so a v5 row
 * with none of them reads like a v4 row and gets the estimate; a v5 row that has them but no score (impact or effort
 * unknown) is `unscored`, as the contract says, never estimated.
 */
export const isV5 = (p: Proposal): boolean =>
  p.score !== undefined || p.impact !== undefined || p.effort !== undefined || p.confidence !== undefined || p.category !== undefined || p.predicted_verdict !== undefined || p.band !== undefined || p.mvp !== undefined;

/** How a row's worth is known: the stored score, the pre-v5 estimate, or not at all (a v5 row without a score). */
export type WorthKind = 'score' | 'est' | 'none';
/** What a row is worth for ordering: its stored score, else (a pre-v5 row) its estimate, else nothing; and its band. */
export interface Worth {
  kind: WorthKind;
  /** The stored score, or the estimate; absent for `none`. */
  value?: number;
  band: Band;
}
/** The worth of `p`, with `est` from estValue over the same product's proposals. */
export function worthOf(p: Proposal, est: ReadonlyMap<string, number>): Worth {
  const band: Band = p.band === 'reserve' ? 'reserve' : 'ranked';
  if (typeof p.score === 'number' && Number.isFinite(p.score)) return { kind: 'score', value: p.score, band };
  const e = est.get(p.id);
  return !isV5(p) && e !== undefined ? { kind: 'est', value: e, band } : { kind: 'none', band };
}
const KIND_RANK: Record<WorthKind, number> = { score: 0, est: 1, none: 2 };
/** Band ranked first, then scored, estimated, unscored, then value descending. 0 = equal (the caller's tie-break follows). */
export function byWorth(a: Worth, b: Worth): number {
  return (a.band === b.band ? 0 : a.band === 'ranked' ? -1 : 1) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || (b.value ?? 0) - (a.value ?? 0);
}

/** The worth as a row shows it: `42.5`, `est. 0.15` (the pre-v5 value per effort), or `unscored`. Never a 0 for unknown. */
export function worthText(w: Worth): string {
  if (w.kind === 'score') return w.value!.toFixed(1);
  if (w.kind === 'est') return 'est. ' + (w.value! < 0.1 ? w.value!.toFixed(3) : w.value!.toFixed(2));
  return 'unscored';
}
