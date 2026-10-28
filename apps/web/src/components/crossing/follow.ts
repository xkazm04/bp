// The page follows the table: the companion stream's `place` event (the place baton, published when the table writes it or
// hands it back) arrives here as a window event from the companion's chunk, and the page flies there with the machinery a
// focus command uses (the hash route restoreHash reads). It rides the lamp's own EventSource, so it follows wherever the
// live lamp runs (desktop, not the fixture). Only the table's writes are followed - a place the page armed
// itself is where it already is - and only for the product on the page. Small and in the main chunk: the crossing's host
// listens while the plan is up, whether or not the crossing's own overlay ever opened.
import type { PlaceBaton } from '@bp/core/session/place';
import type { Engine } from '@/engine/Engine';

export const PLACE_EVENT = 'bp:place';

/** bp's own page's human token (GET /api/companion/human-token), fetched once per page and shared by the card and the
 *  crossing; a refusal clears it so the next arm asks again. */
let tokenP: Promise<string> | null = null;
export function humanToken(): Promise<string> {
  tokenP ??= fetch('/api/companion/human-token', { cache: 'no-store' })
    .then(async (r) => { if (!r.ok) throw new Error('this page has no human token here'); return ((await r.json()) as { token: string }).token; })
    .catch((e) => { tokenP = null; throw e; });
  return tokenP;
}

/** The hash the page should fly to for a baton, or null when it is not the page's to follow. */
export function followHash(b: PlaceBaton, product: string): string | null {
  if (b.place.product !== product || b.place.from !== 'vr') return null;
  if (b.state !== 'live' && b.state !== 'returned') return null;
  return b.place.hash || '#';
}

/** What the crumb names: the place's room, bay, wing or feature, from its hash. */
export function placeName(E: Engine, hash: string): string {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const open = h.get('open'), at = h.get('at');
  if (open && E.M.P.F[open]) return E.M.P.F[open].name;
  if (at) {
    const L = E.M.L, bay = L.BAY[at], room = L.ROOM[at], wing = L.WING[at];
    if (bay) return bay.name + ' · ' + bay.room.name;
    if (room) return room.name;
    if (wing) return wing.def.name;
  }
  return E.M.P.name + ' · the whole site';
}
