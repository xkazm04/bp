// Where the ledger's compare panel loads a screenshot from: a live product's shot through its shots route (the same URL
// as packages/core/src/model/live.ts shotUrl, reimplemented so the train imports only scan types), Kettle's sample
// shots from apps/web/public/sample-shots/*.svg (scripts/gen-sample-shots.mjs). Pure: Node checks import it.
import type { Shot } from '../scan/types.ts';

/** A shot's image URL: `/api/products/<slug>/shots/<path without shots/, each segment encoded>` for a live product,
 *  `/<path>` on Kettle (slug null), whose sample shots live under public/sample-shots/; a bare file name there (a finding's
 *  generated screen, `finding-<id>.png`, the name the Kettle shots route and the VR bundle use) is `/sample-shots/<file>`. */
export function shotSrc(slug: string | null, s: Pick<Shot, 'path'>): string {
  if (slug === null) { const p = s.path.replace(/^\/+/, ''); return '/' + (p.includes('/') ? p : 'sample-shots/' + p); }
  return '/api/products/' + encodeURIComponent(slug) + '/shots/' + s.path.replace(/^shots\//, '').split('/').map(encodeURIComponent).join('/');
}
