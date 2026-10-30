// The shared focus ("Follow me"): the place the owner is looking at, which any surface may publish and any other may
// follow. It generalises the place baton (place.ts) without replacing it: the baton is a hand-off (one writer at a time,
// 120 s, in memory); the shared focus has no leader at all. Every surface is a reader with its own record (who it is, the
// place it last published, whom it follows, when it was last seen), and the shared focus is simply the newest place any
// reader published. Ids only (product, target kind and id, level, the page's hash), never a selection, so it is cheap,
// private-safe and the same in every surface - Personas' deep link speaks the same ids.
// The rules that keep it one hand moving rather than fighting cursors:
//   - a publish of the place that is already the shared focus changes nothing (no new rev, no event): a follower that flew
//     to a place and reports where it now is cannot bounce it back as news;
//   - a reader never applies its own publish (`toApply` skips events it wrote);
//   - a reader follows `*` (whoever moved last) or one named reader; following yourself is refused;
//   - following never blocks a writer: a crashed follower just stops being seen (LIVE_MS) and is forgotten after FORGET_MS;
//     nothing it held can lock anyone out, because it holds nothing.
// Pure: the server keeps the record (server/api/session/focus.server.ts), this module decides every move.
import { PLACE_KINDS, type PlaceKind, type PlaceLevel } from './place.ts';

export type Surface = 'web' | 'phone' | 'vr' | 'companion' | 'personas' | 'standin' | 'morning';
export const SURFACES: readonly Surface[] = ['web', 'phone', 'vr', 'companion', 'personas', 'standin', 'morning'];

export interface FocusPlace {
  product: string;
  /** The same kinds the baton and the companion's focus send. Absent: the product as a whole (the site). */
  target?: { kind: PlaceKind; id: string };
  level?: PlaceLevel;
  /** The publishing page's own hash, when it is a web page ('#at=bkg-06&lens=perf'); a follower on the same product may use it. */
  hash?: string;
  /** One plain line said with the place (the Morning Watch's headline, the lamp's `say`). */
  say?: string;
}

export interface Reader {
  id: string;
  surface: Surface;
  /** What other surfaces call it: 'Web', 'VR table (stand-in)', 'Glim'. */
  label: string;
  /** The place this reader last published, and the rev that publish made. */
  place?: FocusPlace;
  rev?: number;
  at?: string;
  /** '*' = whoever moved last; a reader id = only that reader; absent = not following. */
  follows?: string;
  seenAt: string;
}

export interface FocusRecord {
  rev: number;
  /** The reader whose publish is the shared focus (its `place`), or absent before anyone published. */
  lead?: string;
  readers: Reader[];
}

/** What a client sees: the shared place with who put it there, and every reader with whether it is still around. */
export interface SharedView {
  rev: number;
  shared: { place: FocusPlace; reader: string; surface: Surface; label: string; at: string } | null;
  readers: (Pick<Reader, 'id' | 'surface' | 'label' | 'follows' | 'seenAt'> & { live: boolean })[];
}

/** A reader not seen for this long is shown as gone (clients say hello every 15 s while open). */
export const LIVE_MS = 45_000;
/** A reader not seen for this long is dropped from the record. */
export const FORGET_MS = 24 * 3600_000;
export const MAX_READERS = 32;
export const EMPTY_RECORD: FocusRecord = { rev: 0, readers: [] };

const ID = /^[\w.:-]{1,80}$/, SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/; // SLUG: the registry's own rule (registry.server.ts)
export const isReaderId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

/** A FocusPlace from an untrusted body, or the reason it is not one. */
export function readFocusPlace(v: unknown): FocusPlace | string {
  if (!v || typeof v !== 'object') return 'place must be an object';
  const p = v as Record<string, unknown>;
  if (typeof p.product !== 'string' || !SLUG.test(p.product)) return 'place.product must be a product slug';
  if (p.target !== undefined) {
    const t = p.target as Record<string, unknown> | null;
    if (!t || typeof t !== 'object' || !PLACE_KINDS.includes(t.kind as PlaceKind) || typeof t.id !== 'string' || !t.id || t.id.length > 200) return `place.target must be { kind: ${PLACE_KINDS.join(' | ')}, id }`;
  }
  if (p.level !== undefined && (typeof p.level !== 'string' || !/^L[0-4]$/.test(p.level))) return 'place.level must be L0..L4';
  if (p.hash !== undefined && (typeof p.hash !== 'string' || p.hash.length > 400 || (p.hash !== '' && !p.hash.startsWith('#')))) return "place.hash must be '' or a '#...' hash of at most 400 characters";
  if (p.say !== undefined && (typeof p.say !== 'string' || p.say.length > 280)) return 'place.say must be at most 280 characters';
  const t = p.target as { kind: PlaceKind; id: string } | undefined;
  return {
    product: p.product,
    ...(t ? { target: { kind: t.kind, id: t.id } } : {}),
    ...(typeof p.level === 'string' ? { level: p.level as PlaceLevel } : {}),
    ...(typeof p.hash === 'string' && p.hash ? { hash: p.hash } : {}),
    ...(typeof p.say === 'string' && p.say ? { say: p.say } : {}),
  };
}

/** The page's own place id in a hash ('#at=bkg-06&lens=perf' -> 'bkg-06'), or undefined. */
const atOf = (h: string | undefined): string | undefined => { const m = h ? /[#&]at=([^&]*)/.exec(h) : null; return m ? decodeURIComponent(m[1]) : undefined; };
/** The same spot: one product and one target, and - where both sides say them - one level and one hash place (a bay has
 *  no place kind, so two bays of a room differ only there). The words never make it another place. */
export const sameSpot = (a: FocusPlace | undefined, b: FocusPlace | undefined): boolean => {
  if (!a || !b || a.product !== b.product || (a.target?.kind ?? '') !== (b.target?.kind ?? '') || (a.target?.id ?? '') !== (b.target?.id ?? '')) return false;
  if (a.level && b.level && a.level !== b.level) return false;
  const x = atOf(a.hash), y = atOf(b.hash);
  return !(x !== undefined && y !== undefined && x !== y);
};

export type FocusMove =
  | { kind: 'hello'; reader: string; surface: Surface; label: string }
  | { kind: 'publish'; reader: string; surface: Surface; label: string; place: FocusPlace }
  | { kind: 'follow'; reader: string; surface: Surface; label: string; of: string }
  | { kind: 'unfollow'; reader: string }
  | { kind: 'forget'; reader: string };

export interface FocusStep {
  record: FocusRecord;
  status: number;
  error?: string;
  /** The shared place moved (a new rev): followers are told. False for a presence-only change. */
  moved: boolean;
}

/** The record with readers unseen for FORGET_MS dropped, and at most MAX_READERS kept (the longest unseen go first). */
export function prune(r: FocusRecord, now: number): FocusRecord {
  let rs = r.readers.filter((x) => now - Date.parse(x.seenAt) < FORGET_MS || x.id === r.lead);
  // over the cap the longest unseen go first - never the lead, whose place IS the shared focus
  if (rs.length > MAX_READERS) rs = [...rs].sort((a, b) => (a.id === r.lead ? -1 : b.id === r.lead ? 1 : Date.parse(b.seenAt) - Date.parse(a.seenAt))).slice(0, MAX_READERS);
  return rs.length === r.readers.length ? r : { ...r, readers: rs };
}

/** One move on the record at `now` (ms). A refused move leaves the record as it was and says why. */
export function focusStep(r0: FocusRecord, m: FocusMove, now: number): FocusStep {
  const r = prune(r0, now), at = new Date(now).toISOString();
  const no = (status: number, error: string): FocusStep => ({ record: r, status, error, moved: false });
  const old = r.readers.find((x) => x.id === m.reader);
  const put = (x: Reader, extra: Partial<FocusRecord> = {}): FocusRecord => ({ ...r, ...extra, readers: [...r.readers.filter((y) => y.id !== x.id), x] });
  const seen = (surface: Surface, label: string): Reader => ({ ...(old ?? {}), id: m.reader, surface, label, seenAt: at });
  switch (m.kind) {
    case 'hello':
      return { record: put(seen(m.surface, m.label)), status: 200, moved: false };
    case 'publish': {
      const lead = r.readers.find((x) => x.id === r.lead);
      if (lead && sameSpot(lead.place, m.place)) {
        // already the shared focus: an echo, or the same spot said again. Keep the newer words and hash on the lead, never a new rev.
        const me = { ...seen(m.surface, m.label), ...(m.reader === r.lead ? { place: m.place } : {}) };
        return { record: put(me), status: 200, moved: false };
      }
      const rev = r.rev + 1;
      return { record: put({ ...seen(m.surface, m.label), place: m.place, rev, at }, { rev, lead: m.reader }), status: 201, moved: true };
    }
    case 'follow':
      if (m.of === m.reader) return no(400, 'a reader cannot follow itself');
      if (m.of !== '*' && !r.readers.some((x) => x.id === m.of)) return no(404, `no reader ${m.of} to follow`);
      return { record: put({ ...seen(m.surface, m.label), follows: m.of }), status: 200, moved: false };
    case 'unfollow': {
      if (!old) return no(404, `no reader ${m.reader}`);
      const { follows: _drop, ...rest } = old;
      return { record: put({ ...rest, seenAt: at }), status: 200, moved: false };
    }
    case 'forget':
      if (!old) return { record: r, status: 200, moved: false };
      // the lead's place IS the shared focus: a lead that leaves stays as the place's author, only no longer seen
      if (r.lead === m.reader) return { record: put({ ...old, seenAt: new Date(0).toISOString() }), status: 200, moved: false };
      return { record: { ...r, readers: r.readers.filter((x) => x.id !== m.reader) }, status: 200, moved: false };
  }
}

/** The record as a client sees it at `now`. */
export function viewOf(r: FocusRecord, now: number): SharedView {
  const lead = r.readers.find((x) => x.id === r.lead);
  return {
    rev: r.rev,
    shared: lead?.place ? { place: lead.place, reader: lead.id, surface: lead.surface, label: lead.label, at: lead.at ?? lead.seenAt } : null,
    readers: r.readers.map((x) => ({ id: x.id, surface: x.surface, label: x.label, ...(x.follows ? { follows: x.follows } : {}), seenAt: x.seenAt, live: now - Date.parse(x.seenAt) < LIVE_MS })),
  };
}

/** The place a reader should go to for a view it was sent, or null: not following, its own write, not whom it follows, or
 *  a rev it has already applied. */
export function toApply(v: SharedView, me: string, follows: string | undefined, appliedRev: number): FocusPlace | null {
  if (!follows || !v.shared || v.rev <= appliedRev) return null;
  if (v.shared.reader === me) return null;
  if (follows !== '*' && v.shared.reader !== follows) return null;
  return v.shared.place;
}

/** "Following Web, just now" / "Following Web, 12 s ago": who the shared place came from and how long since, in plain words. */
export function followingWords(v: SharedView, follows: string | undefined, now: number): string | null {
  if (!follows) return null;
  const whom = follows === '*' ? (v.shared?.label ?? 'whoever moves') : (v.readers.find((x) => x.id === follows)?.label ?? follows);
  if (!v.shared || (follows !== '*' && v.shared.reader !== follows)) return `Following ${whom}`;
  const s = Math.max(0, Math.round((now - Date.parse(v.shared.at)) / 1000));
  // under 5 s it says "just now": a deck read card by card re-leads every few seconds, and a clock stuck at "0 s ago" /
  // "1 s ago" read as frozen in the demo pass; a resting place counts on in seconds, then minutes
  return `Following ${whom}, ${s < 5 ? 'just now' : (s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h') + ' ago'}`;
}

/** The place's level from its target kind, when the publisher did not say (feature L4, room L2, wing L1, site L0). */
export const levelOf = (p: FocusPlace): PlaceLevel => p.level ?? (p.target?.kind === 'feature' ? 'L4' : p.target?.kind === 'room' ? 'L2' : p.target?.kind === 'wing' ? 'L1' : 'L0');
