// What a place says in words: the hover card's place summary (Overlays.tsx HoverBody) and the sentence the plan's live
// region speaks when the camera rests on a place (a room walk, a zoom, a lens switch). One pure function, so the card a
// mouse reader sees and the sentence a screen reader hears are the same facts. Lens parts come from the lens's own
// place aggregate (LensChannel.aggregate, the label the plan draws), so a manifest lens is spoken with no code.
import type { Feature, ViewId } from '@bp/core/data';
import { GENERAL } from '@bp/core/data/types';
import { lensOf, type BayNode, type BldNode, type Counts, type RoomNode, type WingNode } from '@bp/core/model';
import type { Engine } from './Engine';
import { lensFailed } from './render/plan';

export type PlaceType = 'bld' | 'wing' | 'room' | 'bay';
export interface PlaceWords {
  type: PlaceType;
  /** The card's kicker line ("Room · wing B Payments") and the place's name. */
  kick: string; title: string;
  /** The card's one line under the name (the room's summary, a bay's features, a wing's rooms). */
  sub: string;
  /** The place's illustration key, or null. */
  art: string | null;
  /** Stage counts on the date shown (the card's bar). */
  counts: Counts;
  /** "12 features" then the lens's own parts (a lens view at now), else the stage parts. */
  parts: string[];
  /** Features bad under the view (General: bad overall); 0 on a past date. */
  bad: number;
  /** The first bad feature and its reason under the view, for the sentence; null when none. */
  first: { name: string; lens: string; why: string } | null;
  /** The view's lens name, or null under General. */
  lens: string | null;
  /** The place as spoken: "Room Payments · wing B", "Bay Checkout · room Payments", "Wing B Money". */
  name: string;
}

/** The parts a lens's place aggregate draws; a lens whose aggregate throws costs its parts only, logged once (plan.ts lensFailed). */
function lensParts(E: Engine, id: string, l: string, fs: readonly Feature[]): string[] | null {
  try { return E.lensAgg(id, l, fs).parts; } catch (err) { lensFailed(E, l, 'aggregate', err); return null; }
}

/** A place's summary under a view on a date (`delta`: the stage-change window, as the card counts it); null for an unknown place. */
export function placeWords(E: Engine, type: PlaceType, id: string, view: ViewId, t: string, delta: number): PlaceWords | null {
  const M = E.M, o = E.placeById(type, id); if (!o) return null;
  const now = t === M.P.asOf;
  let title = '', kick = '', sub = '', art: string | null = null;
  if (type === 'wing') { const w = o as WingNode; title = w.def.name; kick = 'Wing ' + w.def.letter + (M.P.scale > 1 ? ' · ' + w.bld.name : ''); sub = w.def.plain + '. ' + w.rooms.length + ' rooms: ' + w.rooms.map((r) => r.name).join(', ') + '.'; art = w.def.art; }
  else if (type === 'room') { const r = o as RoomNode; title = r.name; kick = 'Room · wing ' + r.wing.def.letter + ' ' + r.wing.def.name; sub = r.summary; art = r.d.base; }
  else if (type === 'bay') { const b = o as BayNode; title = b.name; kick = 'Bay · ' + b.room.name; sub = b.tiles.length + ' features: ' + b.tiles.map((T) => T.f.name).join(', ') + '.'; art = b.room.d.base; }
  else { const b = o as BldNode; title = b.name; kick = 'Building'; sub = b.wings.length + ' wings, ' + b.wings.reduce((n, w) => n + w.rooms.length, 0) + ' rooms'; }
  const name = type === 'room' ? 'Room ' + title + ' · wing ' + (o as RoomNode).wing.def.letter
    : type === 'bay' ? 'Bay ' + title + ' · room ' + (o as BayNode).room.name
    : type === 'wing' ? 'Wing ' + (o as WingNode).def.letter + ' ' + title : 'Building ' + title;
  const counts = M.agg.countsOf(o.id, o.feats, t, delta);
  const L = lensOf(M.P, view);
  const lp = L && now ? lensParts(E, o.id, view, o.feats) : null;
  const n = o.feats.length + ' feature' + (o.feats.length === 1 ? '' : 's');
  const parts = lp ? [n, ...lp] : [n, counts.live + counts.flagged + ' live', counts.build + ' building', counts.paper + ' on paper'];
  const bad = now ? M.agg.healthOf(o.id, o.feats, view).bad : 0;
  let first: PlaceWords['first'] = null;
  if (bad) for (const f of o.feats) {
    const tr = view === GENERAL ? (f.health === 'bad' ? f.trouble.find((x) => x.h === 'bad') : undefined) : f.trouble.find((x) => x.lens === view && x.h === 'bad');
    if (tr) { first = { name: f.name, lens: M.P.LENS[tr.lens]?.name ?? tr.lens, why: tr.why }; break; }
  }
  return { type, kick, title, sub, art, counts, parts, bad, first, lens: L ? L.name : null, name };
}

/** The spoken sentence: "Room Payments · wing B · 12 features · … · 3 in trouble under Security: Card vault, 2 secrets found". */
export function placeSentence(w: PlaceWords): string {
  let s = w.name + ' · ' + w.parts.join(' · ');
  if (w.bad) {
    s += ' · ' + w.bad + ' in trouble' + (w.lens ? ' under ' + w.lens : '');
    if (w.first) s += ': ' + w.first.name + ', ' + (w.lens ? '' : w.first.lens + ': ') + w.first.why;
  }
  return s;
}
