// The shaped legend's rows as data: for a lens, each icon state the plan draws, the features on the plan carrying it
// (in plan order), then the features the lens has not measured and, where any exist, those it does not apply to. Every
// feature lands in exactly one row, so the counts add up to the plan. Pure: check:shaped-legend runs it in node.
import type { Feature } from '@bp/core/data';
import { hof, type BuiltinLens } from '../base/legacy';
import { unscannedUnder } from '@/engine/lens/unknown';
import { iconFor, type IconId } from './icons';

/** The icon vocabulary per lens, in legend order: every id iconFor can return for that lens. */
export const VOCAB: Record<BuiltinLens, [IconId, string][]> = {
  business: [['ticketHi', 'High value (4 or 5)'], ['ticket', 'Value 1 to 3']],
  design: [['board', 'Has a design'], ['boardNone', 'No design yet']],
  development: [['code', 'Code reviewed by a person'], ['codeUnrev', 'No human review']],
  operations: [['dial', 'Needle: how far it is rolled out'], ['dialOff', 'Live without alerting']],
  security: [['lockCard', 'Card data, reviewed'], ['lockCardOpen', 'Card data, not reviewed'], ['lock', 'Reviewed or not needed'], ['lockOpen', 'Review pending']],
  quality: [['check', 'Tests pass'], ['checkPart', 'Partly passing'], ['checkFail', 'Failing'], ['checkNone', 'Untested']],
};

export interface LegendRow {
  /** The icon id, or 'unmeasured' (the plan's "?" set under this lens) or 'na'. */
  key: IconId | 'unmeasured' | 'na';
  icon: IconId | null;
  words: string;
  /** Feature ids in this state, in the order given. */
  ids: string[];
}

export function legendRows(lens: BuiltinLens, feats: readonly Feature[]): LegendRow[] {
  const rows: LegendRow[] = VOCAB[lens].map(([id, words]) => ({ key: id, icon: id, words, ids: [] }));
  const by = new Map<string, LegendRow>(rows.map((r) => [r.key, r]));
  const un: LegendRow = { key: 'unmeasured', icon: null, words: 'Not measured', ids: [] };
  const na: LegendRow = { key: 'na', icon: null, words: 'Not applicable', ids: [] };
  for (const f of feats) {
    if (unscannedUnder(f, lens)) { un.ids.push(f.id); continue; }
    if (hof(f, lens) === 'na') { na.ids.push(f.id); continue; }
    const id = iconFor(lens, f);
    (id && by.get(id))?.ids.push(f.id);
  }
  rows.push(un);
  if (na.ids.length) rows.push(na);
  return rows;
}

/** The match after `cur` in `ids`, wrapping; the first when `cur` is not among them; null for an empty row. */
export function nextMatch(ids: readonly string[], cur: string | null): string | null {
  if (!ids.length) return null;
  const i = cur == null ? -1 : ids.indexOf(cur);
  return ids[(i + 1) % ids.length];
}

/** A row press: fly to the next match with the highlight and return the new cursor (unchanged for an empty row). */
export function goNext(E: { flyToFeature(id: string, highlight?: boolean): void }, ids: readonly string[], cur: string | null): string | null {
  const next = nextMatch(ids, cur);
  if (next == null) return cur;
  E.flyToFeature(next, true);
  return next;
}
