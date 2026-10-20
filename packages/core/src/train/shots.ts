// Where the ledger's compare panel loads a screenshot from: a live product's shot through its shots route (the same URL
// as src/lib/model/live.ts shotUrl, reimplemented so the train imports only scan types), Kettle's sample shots from
// public/ (sample-shots/*.svg, scripts/gen-sample-shots.mjs). Pure: Node checks import it.
import type { Shot } from '../scan/types.ts';

/** A shot's image URL: `/api/products/<slug>/shots/<path without shots/, each segment encoded>` for a live product,
 *  `/<path>` on Kettle (slug null), whose sample shots live under public/sample-shots/. */
export function shotSrc(slug: string | null, s: Pick<Shot, 'path'>): string {
  if (slug === null) return '/' + s.path.replace(/^\/+/, '');
  return '/api/products/' + encodeURIComponent(slug) + '/shots/' + s.path.replace(/^shots\//, '').split('/').map(encodeURIComponent).join('/');
}
