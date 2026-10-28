// The page follows the table: the companion stream's `place` event (the place baton, published when the table writes it or
// hands it back) arrives here as a window event from the companion's chunk, and the page flies there with the machinery a
// focus command uses (the hash route restoreHash reads). It rides the lamp's own EventSource, so it follows wherever the
// live lamp runs (desktop, not the fixture). Only the table's writes are followed - a place the page armed
// itself is where it already is - and only for the product on the page. Small and in the main chunk: the crossing's host
// listens while the plan is up, whether or not the crossing's own overlay ever opened.
import type { PlaceBaton } from '@bp/core/session/place';
import type { Engine } from '@/engine/Engine';
import { nameOf } from './place';

export const PLACE_EVENT = 'bp:place';

/** bp's own page's human token (GET /api/companion/human-token), fetched once per page and shared by the card and the
 *  crossing. `fresh` asks again: a server restart mints a new token, so a write refused with 403 retries once with a
 *  fresh one (as companion/stream.ts does for cards; that one lives in the companion's lazy chunk, this one in the main
 *  chunk, so they are two caches of the same token). */
let tokenP: Promise<string> | null = null;
export function humanToken(fresh = false): Promise<string> {
  if (fresh) tokenP = null;
  tokenP ??= fetch('/api/companion/human-token', { cache: 'no-store' })
    .then(async (r) => { if (!r.ok) throw new Error('this page has no human token here'); return ((await r.json()) as { token: string }).token; })
    .catch((e) => { tokenP = null; throw e; });
  return tokenP;
}
/** POST a JSON body as bp's own page (x-bp-human), retrying once with a fresh token when the server refuses the old one. */
export async function postHuman(url: string, body: unknown): Promise<Response> {
  const send = async (fresh: boolean) => fetch(url, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-bp-human': await humanToken(fresh) }, body: JSON.stringify(body) });
  const r = await send(false);
  return r.status === 403 ? send(true) : r;
}

/** The hash the page should fly to for a baton, or null when it is not the page's to follow. */
export function followHash(b: PlaceBaton, product: string): string | null {
  if (b.place.product !== product || b.place.from !== 'vr') return null;
  if (b.state !== 'live' && b.state !== 'returned') return null;
  return b.place.hash || '#';
}

/** What the crumb names: the place's room, bay, wing or feature, from its hash. */
export function placeName(E: Engine, hash: string): string {
  const h = new URLSearchParams(hash.replace(/^#/, '')), L = E.M.L;
  const open = h.get('open'), at = h.get('at') ?? '';
  if (open && E.M.P.F[open]) return E.M.P.F[open].name; // the feature (not only its tile at ?scale > 1)
  return nameOf(E, null, L.BAY[at] ?? null, L.ROOM[at] ?? null, L.WING[at] ?? null);
}
