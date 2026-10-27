// The deep link another tool opens bp with: `?product=<slug>&page=ledger&tab=<triage|matrix|release>` (Personas' Release
// card opens `&page=ledger&tab=release`, the Release tab at that product). bp's own URL state is the hash
// (Engine.hashOf / readHash: `#page=ledger&lv=release`); these two query keys are a one-shot door into it: on load the
// engine reads them as if the hash had said them (a hash that names a page wins), then drops them from the query, so a
// reload, back / forward and every later move follow the hash alone. Pure, so scripts/check-deep-link.ts imports it.
import type { LedgerVariant } from './state';

export const DEEP_LINK_KEYS = ['page', 'tab'] as const;
const TABS: readonly LedgerVariant[] = ['triage', 'matrix', 'release'];

/** The hash pairs a deep link's query stands for: `{ page: 'ledger', lv }`, `{ page: 'ledger' }` (no or an unknown tab:
 *  the ledger's default), or `{}` (no deep link, or a page bp does not know). */
export function deepLinkHash(search: string): { page?: 'ledger'; lv?: LedgerVariant } {
  const q = new URLSearchParams(search);
  if (q.get('page') !== 'ledger') return {};
  const tab = q.get('tab') ?? '';
  return (TABS as readonly string[]).includes(tab) ? { page: 'ledger', lv: tab as LedgerVariant } : { page: 'ledger' };
}

/** `search` without the deep link's keys (`''` when nothing is left), every other parameter in its order. */
export function withoutDeepLink(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of DEEP_LINK_KEYS) q.delete(k);
  const s = q.toString();
  return s ? '?' + s : '';
}

/** The deep link into a product's ledger tab, as another tool builds it (relative to bp's base URL). */
export function ledgerLink(slug: string, tab: LedgerVariant = 'release'): string {
  return '/?' + new URLSearchParams({ product: slug, page: 'ledger', tab }).toString();
}
