// The companion's client state: one external store (useSyncExternalStore) that the stream (stream.ts) and the turn POST
// write into and only the host (CompanionLive) reads, so a stream event re-renders the lamp and nothing else of the chrome.
// Pure and DOM-free (scripts/check-companion-web.ts runs it under Node's type stripping): `reduce` folds an action into the
// state, `deriveLamp` turns the state plus the composer's focus into the lamp's state and caption.
// Two sources carry turn events: the stream (`turn`, every conversation) and the POST body of a turn this page started.
// While this page reads a POST body for a conversation (`local`), the stream's turn events for it are ignored, and the
// POST's `start` rebuilds the turn from nothing, so a delta seen on both is never shown twice. Cards and focus commands
// can also arrive on both: cards are upserted by id, a focus id is honoured once.
import type { Card, CompanionEvent, FocusCommand, LampState, TurnEvent } from '@bp/core/companion/contract';

/** How long a focus command keeps the lamp pointing after it arrives. */
export const POINT_MS = 6000;
/** How long a decided card stays on the slip (it fades out as it leaves). */
export const CARD_FADE_MS = 2000;
/** How long a notice ("still answering the last one") replaces the caption. */
export const NOTICE_MS = 4000;
/** The caption while the stream is down. */
export const OFFLINE = 'companion offline';
export const BUSY = 'still answering the last one';
/** The conversation key of a turn this page posted before the server named its conversation. */
export const PENDING = '';
const SEEN_KEEP = 64;

export interface TurnView {
  conversationId: string;
  turnId?: string;
  text: string;
  /** waiting: no text yet (or a tool answered and no text came before it); text: streaming; tool: a call is open. */
  phase: 'waiting' | 'text' | 'tool';
  open: readonly string[];
  done: boolean;
  outcome?: 'done' | 'interrupted' | 'failed';
}

export interface CompanionState {
  online: boolean;
  /** The latest turn of each conversation. */
  turns: Readonly<Record<string, TurnView>>;
  /** The conversation the lamp speaks for: the last one this page posted to, else the last one heard from. */
  active: string | null;
  /** The conversation whose POST body this page is reading (PENDING before the server names it); null: none. */
  local: string | null;
  /** Pending first, then newest first; a decided card stays CARD_FADE_MS (see `decided`). */
  cards: readonly Card[];
  /** Card id -> when it left `pending`. */
  decided: Readonly<Record<string, number>>;
  lastFocus: { focus: FocusCommand; at: number } | null;
  focusSeen: readonly string[];
  notice: { text: string; until: number } | null;
  busy: readonly string[];
  sleeping: boolean;
}

export const INITIAL: CompanionState = {
  online: false, turns: {}, active: null, local: null, cards: [], decided: {}, lastFocus: null, focusSeen: [], notice: null, busy: [], sleeping: false,
};

export type Action =
  | { type: 'online'; on: boolean }
  | { type: 'event'; e: CompanionEvent }
  /** A turn event from this page's own POST body. */
  | { type: 'local'; e: TurnEvent }
  /** This page posted a turn (conversationId as known, PENDING for a new one), or its POST body closed (null). */
  | { type: 'posting'; conversationId: string | null }
  | { type: 'notice'; text: string }
  /** The pending cards as the server lists them (on (re)connect). */
  | { type: 'cards'; cards: readonly Card[] }
  | { type: 'prune' };

const order = (a: Card, b: Card) => (a.state === 'pending' ? 0 : 1) - (b.state === 'pending' ? 0 : 1) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

function upsertCard(s: CompanionState, c: Card, now: number): CompanionState {
  const i = s.cards.findIndex((x) => x.id === c.id), prev = i >= 0 ? s.cards[i] : null;
  if (!prev && c.state !== 'pending') return s; // decided before this page saw it ask: nothing to show
  const cards = prev ? s.cards.map((x) => (x.id === c.id ? c : x)) : [...s.cards, c];
  const decided = c.state !== 'pending' && !(c.id in s.decided) ? { ...s.decided, [c.id]: now } : s.decided;
  return { ...s, cards: cards.sort(order), decided };
}

function focus(s: CompanionState, f: FocusCommand, now: number): CompanionState {
  if (s.focusSeen.includes(f.id)) return s;
  return { ...s, lastFocus: { focus: f, at: now }, focusSeen: [...s.focusSeen, f.id].slice(-SEEN_KEEP) };
}

function turn(s: CompanionState, conv: string, e: TurnEvent, now: number): CompanionState {
  if (e.type === 'card') return upsertCard(s, e.card, now);
  if (e.type === 'focus') return focus(s, e.focus, now);
  if (e.type === 'start') {
    const turns: Record<string, TurnView> = { ...s.turns, [e.conversationId]: { conversationId: e.conversationId, turnId: e.turnId, text: '', phase: 'waiting', open: [], done: false } };
    const mine = s.local !== null && s.local === conv; // this page's POST: the server names (or renames) its conversation
    if (mine && conv !== e.conversationId) delete turns[conv];
    return { ...s, turns, active: e.conversationId, local: mine ? e.conversationId : s.local };
  }
  const t: TurnView = s.turns[conv] ?? { conversationId: conv, text: '', phase: 'waiting', open: [], done: false };
  let n: TurnView;
  if (e.type === 'text') n = { ...t, text: t.text + e.delta, phase: t.open.length ? 'tool' : 'text' };
  else if (e.type === 'tool') n = { ...t, open: [...t.open, e.callId], phase: 'tool' };
  else if (e.type === 'tool_result') { const open = t.open.filter((x) => x !== e.callId); n = { ...t, open, phase: open.length ? 'tool' : t.text ? 'text' : 'waiting' }; }
  else n = { ...t, done: true, outcome: e.outcome, open: [] };
  return { ...s, turns: { ...s.turns, [conv]: n }, active: s.active ?? conv };
}

export function reduce(s: CompanionState, a: Action, now: number): CompanionState {
  switch (a.type) {
    case 'online': return a.on === s.online ? s : { ...s, online: a.on };
    case 'notice': return { ...s, notice: { text: a.text, until: now + NOTICE_MS } };
    case 'cards': { let n = s; for (const c of a.cards) if (c.state === 'pending') n = upsertCard(n, c, now); return n; }
    case 'posting': {
      if (a.conversationId === null) {
        // the body closed: a turn it never ended reads interrupted, and a provisional turn that never started goes
        const turns = { ...s.turns }, c = s.local;
        delete turns[PENDING];
        if (c && turns[c] && !turns[c].done) turns[c] = { ...turns[c], done: true, outcome: 'interrupted', open: [] };
        return { ...s, local: null, turns, active: s.active === PENDING ? null : s.active };
      }
      const c = a.conversationId;
      return { ...s, local: c, active: c, turns: { ...s.turns, [c]: { conversationId: c, text: '', phase: 'waiting', open: [], done: false } } };
    }
    case 'local': return turn(s, s.local ?? PENDING, a.e, now);
    case 'event': {
      const e = a.e;
      if (e.type === 'card') return upsertCard(s, e.card, now);
      if (e.type === 'focus') return focus(s, e.focus, now);
      if (e.type === 'status') return { ...s, busy: e.busy, sleeping: e.sleeping };
      if (e.type === 'place') return s; // the crossing's host follows the place; the lamp does not
      if (s.local !== null && (e.conversationId === s.local || s.local === PENDING)) return s; // the POST body carries it
      return turn(s, e.conversationId, e.event, now);
    }
    case 'prune': {
      const gone = s.cards.filter((c) => c.state !== 'pending' && (s.decided[c.id] ?? 0) + CARD_FADE_MS <= now);
      const notice = s.notice && s.notice.until <= now ? null : s.notice;
      if (!gone.length && notice === s.notice) return s;
      const decided = { ...s.decided };
      for (const c of gone) delete decided[c.id];
      return { ...s, cards: s.cards.filter((c) => !gone.includes(c)), decided, notice };
    }
  }
}

/** The next time the derived state changes on its own (a pointing window ends, a card or notice expires); null: never. */
export function nextDeadline(s: CompanionState, now: number): number | null {
  const ts: number[] = [];
  if (s.lastFocus && s.lastFocus.at + POINT_MS > now) ts.push(s.lastFocus.at + POINT_MS);
  if (s.notice) ts.push(s.notice.until);
  for (const c of s.cards) if (c.state !== 'pending') ts.push((s.decided[c.id] ?? now) + CARD_FADE_MS);
  return ts.length ? Math.min(...ts) : null;
}

export const pendingCards = (s: CompanionState): Card[] => s.cards.filter((c) => c.state === 'pending');
/** The turn the lamp speaks for, if any. */
export const activeTurn = (s: CompanionState): TurnView | undefined => (s.active !== null ? s.turns[s.active] : undefined);
/** A turn this page started and has not seen end (what Stop acts on). */
export const runningLocal = (s: CompanionState): TurnView | undefined => { const t = s.local !== null ? s.turns[s.local] : undefined; return t && !t.done ? t : undefined; };

/** `product`: the page's (a slug, or 'kettle'); a focus command for another product is a notice, not pointing. */
export interface LampInputs { now: number; composerFocused: boolean; composerEmpty: boolean; jobsRunning: boolean; product?: string }

/** The lamp's state and caption. First match wins: stream down, card pending, focus in flight, a turn waiting for text,
 *  streaming, a tool or scan job running, the composer focused and empty, else idle. */
export function deriveLamp(s: CompanionState, i: LampInputs): { state: LampState; caption?: string } {
  if (!s.online) return { state: 'idle', caption: OFFLINE };
  const t = activeTurn(s), live = t && !t.done ? t : undefined;
  const f = s.lastFocus, pointing = f && i.now - f.at < POINT_MS && (!i.product || f.focus.product === i.product) ? f.focus : null;
  const notice = s.notice && s.notice.until > i.now ? s.notice.text : undefined;
  const caption = notice ?? (pointing?.say || t?.text || undefined);
  const out = (state: LampState, c = caption) => (c ? { state, caption: c } : { state });
  const pending = pendingCards(s);
  if (pending.length) return out('asking', caption ?? pending[0].summary);
  if (pointing) return out('pointing');
  if (live?.phase === 'waiting') return out('thinking');
  if (live?.phase === 'text') return out('speaking');
  if (live?.phase === 'tool' || i.jobsRunning) return out('working');
  if (i.composerFocused && i.composerEmpty) return out('listening');
  return out('idle');
}

/** A tiny external store over `reduce`. `now` is injectable for tests. */
export interface CompanionStore { get(): CompanionState; subscribe(fn: () => void): () => void; dispatch(a: Action): void }
export function createStore(now: () => number = Date.now, init: CompanionState = INITIAL): CompanionStore {
  let s = init;
  const subs = new Set<() => void>();
  return {
    get: () => s,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    dispatch: (a) => { const n = reduce(s, a, now()); if (n === s) return; s = n; for (const fn of [...subs]) fn(); },
  };
}
