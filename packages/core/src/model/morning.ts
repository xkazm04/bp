// The morning watch's reading: what happened since this reader last said "caught up", grouped by place, with the
// questions still open for them. Pure functions over plain rows (the sample's activity and its played hour, or a
// live product's store activity) plus a browser-local cursor per product and reader. The cursor is a convenience:
// every storage access is guarded, and without it the view falls back to a default (the sample's AWAY_SINCE; a
// live product shows everything it kept).
import type { ReplayType, ViewId } from '@bp/core/data';
import type { Activity, ActivityKind } from '@bp/core/scan/types';
import { AWAY_SINCE } from './constants';
import type { Model } from './index';
import { lineSuffix } from './product';
import type { SimDecision } from './sim';

/** One thing that happened at a place. `k` orders events: a live store row's id, else the time in ms. */
export interface WatchEvent { k: number; at: string; place: string | null; type: string; text: string }
/** Where a reader is caught up to: the last event they had seen (`k`) and its time. */
export interface WatchCursor { k: number; at: string }
export interface WatchQuestion { id: string; since: number }
export interface PlaceGroup { place: string | null; events: WatchEvent[] }
export interface MorningView<Q extends WatchQuestion> {
  /** Places with events in the window, latest first; their events newest first. */
  places: PlaceGroup[];
  /** Events in the window (after the cursor, up to `upto`). */
  total: number;
  /** Events that arrived after `upto`: held behind "N new" so the list in front of the reader never moves. */
  newCount: number;
  /** The window's end: the latest event when the view opened (or when the reader took the new ones in). */
  upto: WatchCursor | null;
  /** The kept history starts after the cursor: events before `retainedFrom` may be missing. */
  incomplete: boolean;
  retainedFrom: string | null;
  /** Every open question for the reader that had arrived by `upto`, whatever the cursor says. */
  open: Q[];
  /** Of those, the ones asked after the cursor. */
  askedSince: number;
}

const latest = (events: readonly WatchEvent[]): WatchCursor | null => {
  let m: WatchEvent | null = null;
  for (const e of events) if (!m || e.k > m.k) m = e;
  return m ? { k: m.k, at: m.at } : null;
};

/**
 * The view for one reader. `cursor` null = no mark (everything kept is shown). `upto` undefined = up to the latest
 * event. `oldest` = the oldest row still kept when the history may have been cut (a live store keeps its latest
 * rows only); omit it when the history is whole.
 */
export function morningView<Q extends WatchQuestion>(o: {
  events: readonly WatchEvent[]; cursor: WatchCursor | null; upto?: WatchCursor | null; questions: readonly Q[]; oldest?: WatchCursor | null;
}): MorningView<Q> {
  const upto = o.upto === undefined ? latest(o.events) : o.upto, lo = o.cursor ? o.cursor.k : -Infinity, hi = upto ? upto.k : -Infinity;
  const by = new Map<string | null, WatchEvent[]>();
  let total = 0, newCount = 0;
  for (const e of o.events) {
    if (e.k > hi) { newCount++; continue; }
    if (e.k <= lo) continue;
    total++;
    let g = by.get(e.place); if (!g) by.set(e.place, (g = []));
    g.push(e);
  }
  const places: PlaceGroup[] = [];
  for (const [place, events] of by) { events.sort((a, b) => b.k - a.k); places.push({ place, events }); }
  places.sort((a, b) => b.events[0].k - a.events[0].k);
  const oldest = o.oldest ?? null, incomplete = !!oldest && (!o.cursor || o.cursor.k < oldest.k);
  const uptoMs = upto ? Date.parse(upto.at) : Infinity, curMs = o.cursor ? Date.parse(o.cursor.at) : -Infinity;
  const open = o.questions.filter((q) => !(q.since > uptoMs));
  return { places, total, newCount, upto, incomplete, retainedFrom: oldest ? oldest.at : null, open, askedSince: open.filter((q) => q.since > curMs).length };
}

// ------------------------------------------------------------------------------------------- plain words
/**
 * Plain words for every event kind the watch can be handed, singular and plural. Split in two on purpose: the
 * first table is typed over the two vocabularies the CODE defines, so tsc - not a reviewer - fails the build when
 * a ReplayType or an ActivityKind is added and left unworded. The second is the map's own `activity[].type`, which
 * the schema leaves a free string, so only the sample data can say what belongs there (check-model.ts section (i)
 * reads the map and fails on a kind with no words). An unknown kind still reads as "3 events" rather than as its
 * slug - kindWords' fallback - but nothing in either vocabulary may reach it.
 */
const KIND_CORE: Record<ActivityKind | ReplayType, [string, string]> = {
  commit: ['code change', 'code changes'], committed: ['code change', 'code changes'], 'tests-pass': ['check passed', 'checks passed'],
  'tests-fail': ['check failed', 'checks failed'], 'pr-open': ['change sent for review', 'changes sent for review'],
  'task-done': ['task finished', 'tasks finished'], 'review-pass': ['review passed', 'reviews passed'], 'review-changes': ['review asking for changes', 'reviews asking for changes'],
  deploy: ['release', 'releases'], 'flag-change': ['rollout change', 'rollout changes'],
  alert: ['alert', 'alerts'], 'spec-draft': ['plan drafted', 'plans drafted'],
  note: ['note', 'notes'], finding: ['problem found', 'problems found'], 'scan-clean': ['clean check', 'clean checks'],
  move: ['agent moved here', 'agents moved here'], 'decision-asked': ['question asked', 'questions asked'], reading: ['reading', 'readings'],
  measured: ['measurement', 'measurements'], proposed: ['suggestion', 'suggestions'], executing: ['work started', 'work started'], error: ['error', 'errors'],
};
/** The map's own activity vocabulary (`activity[].type`, a free string in the schema). */
const KIND_MAP: Record<string, [string, string]> = {
  'pr-opened': ['change sent for review', 'changes sent for review'], review: ['review', 'reviews'], flag: ['rollout change', 'rollout changes'],
  stage: ['stage move', 'stage moves'], incident: ['incident', 'incidents'], comment: ['comment', 'comments'],
};
const KIND: Record<string, [string, string]> = { ...KIND_CORE, ...KIND_MAP };
/** Every kind either vocabulary names, so a gate can read the set the code itself declares. */
export const WATCH_KINDS: readonly string[] = Object.keys(KIND);
/** "3 code changes · 1 question asked": a place's events counted by kind, in plain words, most frequent first. */
export function kindWords(events: readonly WatchEvent[], max = 3): string {
  const n = new Map<string, number>();
  for (const e of events) n.set(e.type, (n.get(e.type) ?? 0) + 1);
  const xs = [...n].sort((a, b) => b[1] - a[1]);
  const words = xs.slice(0, max).map(([t, c]) => { const w = KIND[t]; return c + ' ' + (w ? w[c === 1 ? 0 : 1] : c === 1 ? 'event' : 'events'); });
  const rest = xs.slice(max).reduce((s, x) => s + x[1], 0);
  return words.join(' · ') + (rest ? ' · ' + rest + ' other' : '');
}

// ------------------------------------------------------------------------------------------- the rows
/** The sample's events: the map's overnight activity and what the simulated hour has played so far (line 1 only). */
export function sampleWatchEvents(M: Model): WatchEvent[] {
  const sim = M.sim, sf = lineSuffix(M.P.scale, 0), out: WatchEvent[] = [];
  for (const a of M.P.base.activity) out.push({ k: Date.parse(a.at), at: a.at, place: a.feature ? a.feature + sf : null, type: a.type, text: a.text });
  if (!sim.live) {
    for (let i = 0; i < sim.i && i < sim.events.length; i++) {
      const e = sim.events[i]; if (sf && !e.f.endsWith(sf)) continue;
      const ms = sim.at0 + Math.round(e.t * 1000), A = sim.AG[e.agent];
      out.push({ k: ms, at: new Date(ms).toISOString(), place: e.f, type: e.type, text: (A ? A.base + ' ' : '') + e.text });
    }
  }
  return out;
}
/** The store snapshot and the client both keep a live product's latest 200 activity rows (store.server.ts, client.ts). */
export const LIVE_ACTIVITY_KEPT = 200;
/** A live product's events: its store activity rows (ids are the order). `oldest` is set when the kept rows may be cut. */
export function liveWatchEvents(rows: readonly Activity[], scale: number): { events: WatchEvent[]; oldest: WatchCursor | null } {
  const sf = lineSuffix(scale, 0), events = rows.map((r) => ({ k: r.id, at: r.at, place: r.feature ? r.feature + sf : null, type: r.kind, text: r.text }));
  let first: WatchEvent | null = null; for (const e of events) if (!first || e.k < first.k) first = e;
  return { events, oldest: first && rows.length >= LIVE_ACTIVITY_KEPT ? { k: first.k, at: first.at } : null };
}
/** Where a reader with no mark starts: the sample's evening before; a live product has no such default. */
export function defaultCursor(live: boolean): WatchCursor | null {
  return live ? null : { k: Date.parse(AWAY_SINCE), at: AWAY_SINCE };
}

// ------------------------------------------------------------------------------------------- the mark
export const cursorKey = (product: string, reader: string | null): string => 'bp.caughtUp.' + product + '.' + (reader ?? 'anyone');
/** The reader's "caught up" mark for a product, or null (none, unreadable, or storage blocked). */
export function readCursor(key: string): WatchCursor | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<WatchCursor> | null;
    return v && typeof v.k === 'number' && Number.isFinite(v.k) && typeof v.at === 'string' ? { k: v.k, at: v.at } : null;
  } catch { return null; }
}
/** Saves the mark; false when the browser keeps nothing (the view still works for this visit). */
export function writeCursor(key: string, c: WatchCursor): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify({ k: c.k, at: c.at }));
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------------------------------- one reader
/** The mark's storage key for the product on screen and this reader (a person, else "anyone"). */
export const watchKey = (M: Model, who: string | null): string => cursorKey(M.live?.slug ?? 'kettle', who);
/**
 * The reader's mark, else the default. A sample mark later than the simulated clock is dropped: the hour starts
 * over on every load, so a mark from a later minute of an earlier visit would hide the whole replay.
 */
export function cursorFor(M: Model, who: string | null): WatchCursor | null {
  let c = readCursor(watchKey(M, who));
  if (c && !M.sim.live && c.k > M.sim.clockMs()) c = null;
  return c ?? defaultCursor(M.sim.live);
}
/** The morning view for one reader: the product's events since `cursor`, and the open questions for them (all open ones with no reader). */
export function watchFor(M: Model, rows: readonly Activity[] | undefined, who: string | null, view: ViewId, cursor: WatchCursor | null, upto?: WatchCursor | null): MorningView<SimDecision> {
  const src = M.sim.live ? liveWatchEvents(rows ?? [], M.P.scale) : { events: sampleWatchEvents(M), oldest: null };
  const q = M.sim.queueFor(who, view);
  return morningView({ events: src.events, cursor, upto, questions: who ? q.mine : q.all, oldest: src.oldest });
}
