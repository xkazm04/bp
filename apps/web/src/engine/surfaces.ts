// The plan's dismissable surfaces, declared once, top first. This one list is the Esc order (Engine.goUp closes
// escTarget), the Callout's paint order (calloutSeat) and the opening exclusions (openPatch: a surface opens over the
// others in its seat, and over the ones it names in `closes`). A new overlay is one row here; it gets Esc, paint and
// exclusion behaviour from its position and seat instead of edits in goUp, the Callout and each opener.
//
// A seat is one screen slot that shows one surface at a time (the timeline panel and the rail flyout share the space
// over the plan's right and bottom; the track record and "What is going on?" share the callout box; blast and readiness
// are one mode). A seat's rows sit together in the list, so the occupant painted on top is the row Esc closes.
// The ledger page is a barrier: what is below it is behind the page, and Esc never reaches it.
//
// Pure, no imports but types and no DOM, so scripts/check-surfaces.ts executes it.
import type { UIState } from './state';

/** A partial store state: only the fields a surface reads (tests pass a few of them). */
export type SurfaceState = { [K in keyof UIState]?: K extends 'tgt' ? { n: number } | UIState['tgt'] : UIState[K] };
export type SurfaceId = 'menu' | 'morning' | 'whoMenu' | 'tl' | 'dtab' | 'ledger' | 'open' | 'dec' | 'track' | 'info' | 'prev' | 'tgt' | 'blast' | 'ga' | 'key' | 'cmpA';
export interface Surface {
  id: SurfaceId;
  /** The screen slot it occupies: rows sharing a seat never stand open together (openPatch). */
  seat: string;
  isOpen(S: SurfaceState): boolean;
  /** The store patch that closes it (the engine adds a surface's side effects: closeFeature's hash write, setMode's). */
  close: Partial<UIState>;
  /** Surfaces of other seats that opening this one closes (the feature page covers the decision card, ...). */
  closes?: readonly SurfaceId[];
  /** Esc stops here: nothing below it moves (the ledger page covers the plan). */
  barrier?: boolean;
  /** It has a body in the plan's callout box (the Callout paints the first open one). */
  callout?: boolean;
}

export const SURFACES: readonly Surface[] = [
  { id: 'menu', seat: 'menu', isOpen: (S) => !!S.menu, close: { menu: null } },
  { id: 'morning', seat: 'morning', isOpen: (S) => !!S.morning, close: { morning: false } },
  { id: 'whoMenu', seat: 'whoMenu', isOpen: (S) => !!S.whoMenu, close: { whoMenu: false } },
  { id: 'tl', seat: 'side', isOpen: (S) => !!S.tl, close: { tl: false } },
  { id: 'dtab', seat: 'side', isOpen: (S) => !!S.dtab, close: { dtab: null } },
  { id: 'ledger', seat: 'page', isOpen: (S) => S.page === 'ledger', close: {}, closes: ['tl', 'dtab'], barrier: true },
  { id: 'open', seat: 'sheet', isOpen: (S) => !!S.open, close: { open: null }, closes: ['dec', 'morning', 'menu'] },
  { id: 'dec', seat: 'dec', isOpen: (S) => !!S.dec, close: { dec: null, hlOpt: null }, closes: ['morning'] },
  { id: 'track', seat: 'callout', isOpen: (S) => !!S.track, close: { track: null }, callout: true },
  { id: 'info', seat: 'callout', isOpen: (S) => !!S.info && !!S.tgt?.n, close: { info: false }, callout: true },
  { id: 'prev', seat: 'prev', isOpen: (S) => !!(S.prev || S.lprev), close: { prev: null, lprev: null } },
  { id: 'tgt', seat: 'tgt', isOpen: (S) => !!S.tgt?.n, close: { tgt: { ids: {}, n: 0, label: '' }, prev: null, lprev: null, ordMenu: false } },
  { id: 'blast', seat: 'mode', isOpen: (S) => !!S.blast, close: { blast: null }, closes: ['info'], callout: true },
  { id: 'ga', seat: 'mode', isOpen: (S) => !!S.ga, close: { ga: false, scope: null }, closes: ['info'], callout: true },
  { id: 'key', seat: 'key', isOpen: (S) => !!S.key, close: { key: null } },
  { id: 'cmpA', seat: 'cmp', isOpen: (S) => !!S.cmpA, close: { cmpA: null } },
];
const BY_ID = new Map(SURFACES.map((r) => [r.id, r]));
const RANK = new Map<string, number>();
for (let i = SURFACES.length - 1; i >= 0; i--) RANK.set(SURFACES[i].seat, i); // a seat ranks at its first row

export function surface(id: SurfaceId): Surface { return BY_ID.get(id)!; }

/** The open surface a seat shows (its first open row), or null. */
function occupant(seat: string, S: SurfaceState, shows: (r: Surface) => boolean = () => true): Surface | null {
  for (const r of SURFACES) if (r.seat === seat && r.isOpen(S) && shows(r)) return r;
  return null;
}

/** What is painted on top: the occupant of the highest-ranked seat that has one (a barrier counts: it covers the rest). */
export function topSurface(S: SurfaceState): SurfaceId | null {
  let best: Surface | null = null, rank = Infinity;
  for (const seat of RANK.keys()) {
    const r = RANK.get(seat)!; if (r >= rank) continue;
    const o = occupant(seat, S); if (o) { best = o; rank = r; }
  }
  return best ? best.id : null;
}

/** What Esc closes: the top surface, or null when nothing is open or the top is a barrier (the ledger). */
export function escTarget(S: SurfaceState): SurfaceId | null {
  const t = topSurface(S);
  return t && !surface(t).barrier ? t : null;
}

/**
 * The body the plan's callout box paints: the first open callout row (the track record over "What is going on?", over
 * blast, over readiness). `shows` lets the Callout skip a row it cannot draw (a track this map has no record of).
 */
export function calloutSeat(S: SurfaceState, shows: (id: SurfaceId) => boolean = () => true): SurfaceId | null {
  for (const r of SURFACES) if (r.callout && r.isOpen(S) && shows(r.id)) return r.id;
  return null;
}

/**
 * The patch that opening `id` adds: it closes the other rows of its seat and the rows it names in `closes`. Only the
 * fields that would change are in it (an empty patch when nothing it covers is open); the caller adds the field that
 * opens `id` itself.
 */
export function openPatch(id: SurfaceId, S: SurfaceState): Partial<UIState> {
  const me = surface(id), out: Record<string, unknown> = {}, cur = S as Record<string, unknown>;
  for (const r of SURFACES) {
    if (r.id === id || (r.seat !== me.seat && !me.closes?.includes(r.id))) continue;
    for (const [k, v] of Object.entries(r.close)) if (cur[k] !== v) out[k] = v;
  }
  return out as Partial<UIState>;
}
