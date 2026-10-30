// The place baton ("The Desk Becomes the Table"): the one thing that crosses from the desk to the table. Today the web
// page's place lives only in its URL hash and the server knows nothing of it; the baton closes exactly that gap and no
// more. One record, two writers, never both at once: the page arms it (armed), one device claims it (claimed), the
// table leads while it is live (every place it posts is the newest), and the device hands it back (returned). An armed
// baton nobody claims is forgotten after its TTL (expired), with no error. A device that never hands back (a crash, a
// missed STOPPING) cannot lock the page out: the person may take the lead back from the page, explicitly (`takeBack`). Ids and hashes only, never "the selection".
// Pure: the server keeps the record (server/api/session/place), this module decides every move.

export type PlaceLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
import { PLACE_KINDS as KINDS } from '../standard/schema-vocab.ts';

/** shared-focus-1's placeKind: the schema is the one authority (schema-vocab.ts is generated from it). */
export type PlaceKind = (typeof KINDS)[number];
export const PLACE_KINDS: readonly PlaceKind[] = KINDS;

export interface Place {
  product: string;
  /** The page's own hash, as Engine.hashOf writes it ('#at=bkg-06&lens=perf'). */
  hash: string;
  level: PlaceLevel;
  /** The same kinds the companion's focus sends; the table maps L3/L4 to their room. */
  target?: { kind: PlaceKind; id: string };
  /** The desk's companion thread, so the lamp keeps talking. */
  conversationId?: string;
  from: 'web' | 'vr';
  at: string;
}

export type BatonState = 'armed' | 'claimed' | 'live' | 'returned' | 'expired';
export interface PlaceBaton {
  id: string;
  state: BatonState;
  /** The newest place, whoever wrote it. */
  place: Place;
  armedAt: string;
  ttlMs: number;
  /** The device that claimed it; only it may write while the baton is claimed or live. */
  device?: string;
}

export const BATON_TTL_MS = 120_000;

/** A Place from an untrusted body, or the reason it is not one. */
export function readPlace(v: unknown): Place | string {
  if (!v || typeof v !== 'object') return 'place must be an object';
  const p = v as Record<string, unknown>;
  if (typeof p.product !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.product)) return 'place.product must be a product slug';
  if (typeof p.hash !== 'string' || p.hash.length > 400 || (p.hash !== '' && !p.hash.startsWith('#'))) return "place.hash must be '' or a '#...' hash of at most 400 characters";
  if (typeof p.level !== 'string' || !/^L[0-4]$/.test(p.level)) return 'place.level must be L0..L4';
  if (p.target !== undefined) {
    const t = p.target as Record<string, unknown> | null;
    if (!t || typeof t !== 'object' || !PLACE_KINDS.includes(t.kind as PlaceKind) || typeof t.id !== 'string' || !t.id || t.id.length > 200) return `place.target must be { kind: ${PLACE_KINDS.join(' | ')}, id }`;
  }
  if (p.conversationId !== undefined && (typeof p.conversationId !== 'string' || p.conversationId.length > 100)) return 'place.conversationId must be a short string';
  if (p.from !== 'web' && p.from !== 'vr') return "place.from must be 'web' or 'vr'";
  return {
    product: p.product, hash: p.hash, level: p.level as PlaceLevel, from: p.from, at: typeof p.at === 'string' && p.at.length <= 40 ? p.at : new Date().toISOString(),
    ...(p.target ? { target: { kind: (p.target as { kind: PlaceKind }).kind, id: (p.target as { id: string }).id } } : {}),
    ...(typeof p.conversationId === 'string' ? { conversationId: p.conversationId } : {}),
  };
}

export type BatonMove =
  | { kind: 'arm'; place: Place; id: string; takeBack?: boolean }
  | { kind: 'claim'; device: string }
  | { kind: 'publish'; place: Place; device: string }
  | { kind: 'return'; device: string };

export interface BatonStep { baton: PlaceBaton | null; status: number; error?: string }

/** The baton as it stands at `now`: an armed one past its TTL has expired. */
export function current(b: PlaceBaton | null, now: number): PlaceBaton | null {
  if (b && b.state === 'armed' && now - Date.parse(b.armedAt) > b.ttlMs) return { ...b, state: 'expired' };
  return b;
}

/** One move on the baton at time `now` (ms). A refused move leaves the baton as it was and says why. */
export function step(b0: PlaceBaton | null, m: BatonMove, now: number): BatonStep {
  const b = current(b0, now);
  const no = (status: number, error: string): BatonStep => ({ baton: b, status, error });
  switch (m.kind) {
    case 'arm':
      // the page leads unless a device holds the baton: arming over a claimed or live one would make two writers
      if (b && (b.state === 'claimed' || b.state === 'live') && !m.takeBack) return no(409, `the baton is ${b.state} by a device; the table leads until it is returned (or the page takes the lead back)`);
      if (m.place.from !== 'web') return no(400, "the page arms the baton: place.from must be 'web'");
      return { status: 201, baton: { id: m.id, state: 'armed', place: m.place, armedAt: new Date(now).toISOString(), ttlMs: BATON_TTL_MS } };
    case 'claim':
      if (!b || b.state === 'returned') return no(404, 'no baton is armed');
      if (b.state === 'expired') return no(410, 'the baton expired before anyone claimed it');
      if (b.state !== 'armed') return b.device === m.device ? { status: 200, baton: b } : no(409, `the baton is already ${b.state} by another device`);
      return { status: 200, baton: { ...b, state: 'claimed', device: m.device } };
    case 'publish':
      if (!b || (b.state !== 'claimed' && b.state !== 'live')) return no(409, 'only a claimed baton takes places from the table');
      if (b.device !== m.device) return no(403, 'only the device that claimed the baton may write it');
      if (m.place.from !== 'vr') return no(400, "the table writes the place: place.from must be 'vr'");
      return { status: 200, baton: { ...b, state: 'live', place: m.place } };
    case 'return':
      if (!b || (b.state !== 'claimed' && b.state !== 'live')) return no(409, 'only a claimed or live baton can be returned');
      if (b.device !== m.device) return no(403, 'only the device that claimed the baton may return it');
      return { status: 200, baton: { ...b, state: 'returned' } };
  }
}
