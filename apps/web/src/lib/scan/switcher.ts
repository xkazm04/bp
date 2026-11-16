// What the header's project switcher shows and does, as pure functions (ProjectSwitcher.tsx renders them;
// scripts/check-switcher.ts pins them under Node's type stripping). Each row says where review work waits
// (the product's open proposals) and when it was last scanned, from the same GET /api/products answer that
// carries its readiness; the closed trigger counts the proposals waiting in the OTHER projects; choosing a row
// opens it in place (switchProduct) or does nothing / closes. Rows keep registry order: nothing reorders under
// the cursor. An unreadable store is an unknown count, never zero.
import { LEVEL_LABEL, LEVEL_TITLE, readinessLevel, type ReadinessLevel } from '@bp/core/scan/readiness';
import { ago } from '@bp/core/scan/liveness';
import type { ProductInfo } from '@bp/core/scan/types';

export interface SwitcherItem {
  /** null = the built-in Kettle sample. */
  slug: string | null;
  name: string;
  level: ReadinessLevel | 'sample';
  label: string;
  title: string;
  /** Cannot be drawn (no repo or no readable map): the row says why and does not open. */
  off?: boolean;
  /** Open proposals in the product's store; null when unknown (no readable store, or the sample). */
  waiting: number | null;
  /** The row's second line ("3 proposals · scanned 2 h ago"), or null when there is nothing to say. */
  facts: string | null;
  /** The row's accessible name: the name, the readiness word, and the waiting work in words. */
  aria: string;
}

const plural = (n: number, one: string) => n + ' ' + one + (n === 1 ? '' : 's');

/** The Kettle sample first, then every registered product in registry order. `now` in ms. */
export function switcherItems(list: readonly ProductInfo[] | null, current: string | null, now: number): SwitcherItem[] {
  void current; // the current row is marked by the renderer; its facts read the same as any other row's
  const out: SwitcherItem[] = [{ slug: null, name: 'Kettle (sample)', level: 'sample', label: 'Sample', title: 'The built-in sample product', waiting: null, facts: null, aria: 'Kettle (sample), Sample' }];
  for (const p of list ?? []) {
    const r = p.readiness, l = readinessLevel(r), off = l === 'missing';
    const waiting = off || r.proposals === null || r.proposals === undefined ? null : r.proposals;
    const t = r.lastRunAt ? Date.parse(r.lastRunAt) : NaN;
    const scanned = !off && Number.isFinite(t) ? 'scanned ' + ago(now - t) : null;
    const parts = [waiting ? plural(waiting, 'proposal') : null, scanned].filter((x): x is string => !!x);
    out.push({
      slug: p.slug, name: p.name, level: l, label: LEVEL_LABEL[l], off,
      title: LEVEL_TITLE[l] + (r.error ? ' (' + r.error + ')' : ''),
      waiting, facts: parts.length ? parts.join(' · ') : null,
      aria: [p.name, LEVEL_LABEL[l], waiting ? plural(waiting, 'proposal') + ' waiting' : null, scanned].filter(Boolean).join(', '),
    });
  }
  return out;
}

/** Proposals waiting in the projects other than `current`, and how many projects hold them; null at none (no badge).
 *  It falls as proposals are decided: the list is re-read on menu open and on every product change. */
export function triggerAttention(list: readonly ProductInfo[] | null, current: string | null): { n: number; projects: number } | null {
  let n = 0, projects = 0;
  for (const p of list ?? []) {
    if (p.slug === current || readinessLevel(p.readiness) === 'missing') continue;
    const k = p.readiness.proposals;
    if (typeof k === 'number' && k > 0) { n += k; projects++; }
  }
  return n ? { n, projects } : null;
}

/** The trigger's words for the badge ("5 proposals waiting in 2 other projects"). */
export const attentionWords = (a: { n: number; projects: number }): string =>
  plural(a.n, 'proposal') + ' waiting in ' + (a.projects === 1 ? '1 other project' : a.projects + ' other projects');

/** What choosing `item` does: close the menu (it is the open one), nothing (it cannot be drawn), or open `go` in place. */
export function switchPlan(item: Pick<SwitcherItem, 'slug' | 'off'>, current: string | null): 'close' | 'none' | { go: string | null } {
  if (item.slug === current) return 'close';
  if (item.off) return 'none';
  return { go: item.slug };
}
