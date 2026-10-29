// The companion's wire on the page: one EventSource on GET /api/companion/stream (the page's own origin, like every /api
// call in lib/scan/client.ts) with backoff, the turn POST read incrementally as SSE (EventSource cannot POST: the body is
// read off fetch's stream, athena apps/desktop/src/lib/api.ts's pattern), Stop, and the card answers with the human
// token. Everything writes into the store (store.ts); nothing here renders, and nothing here toasts: a stream that is down
// is `online:false`, which the lamp reads as a quiet "companion offline".
// `sseParser` and `readEvent` are pure (scripts/check-companion-web.ts feeds them split chunks); the rest touches the DOM
// only when called.
import type { Card, CompanionEvent, TurnEvent } from '@bp/core/companion/contract';
import type { PlaceBaton } from '@bp/core/session/place';
import type { SharedView } from '@bp/core/session/focus';
import { BUSY, PENDING, runningLocal, type CompanionStore } from './store.ts';

export const STREAM_URL = '/api/companion/stream';
const BACKOFF_MS = 500, BACKOFF_CAP_MS = 10000, BACKOFF_COLD_MS = 60000, COLD_AFTER = 6;
const CONV_KEY = 'bp.companion.conversation';
const HUMAN_HEADER = 'x-bp-human'; // contract.ts HUMAN_HEADER (a value import would pull the contract into Node's type-stripped check)

// ------------------------------------------------------------------------------------------- SSE
export interface SseMessage { event: string; data: string; id?: string }

/** An incremental SSE decoder (WHATWG event-stream): feed it chunks split anywhere (inside a line, between \r and \n),
 *  it calls `on` once per complete event. `end()` flushes nothing: an event without its blank line is not an event. */
export function sseParser(on: (m: SseMessage) => void): { push(chunk: string): void; end(): void } {
  let buf = '', event = '', data: string[] = [], id: string | undefined, cr = false;
  const line = (l: string) => {
    if (l === '') {
      if (data.length) on(id === undefined ? { event: event || 'message', data: data.join('\n') } : { event: event || 'message', data: data.join('\n'), id });
      event = ''; data = [];
      return;
    }
    if (l[0] === ':') return;
    const c = l.indexOf(':'), f = c < 0 ? l : l.slice(0, c);
    let v = c < 0 ? '' : l.slice(c + 1);
    if (v[0] === ' ') v = v.slice(1);
    if (f === 'event') event = v; else if (f === 'data') data.push(v); else if (f === 'id') id = v;
  };
  return {
    push(chunk) {
      for (const ch of chunk) {
        if (cr) { cr = false; if (ch === '\n') continue; }
        if (ch === '\r') { cr = true; line(buf); buf = ''; } else if (ch === '\n') { line(buf); buf = ''; } else buf += ch;
      }
    },
    end() { buf = ''; event = ''; data = []; },
  };
}

const TURN_TYPES = new Set(['start', 'text', 'tool', 'tool_result', 'card', 'focus', 'end']);
const STREAM_TYPES = new Set(['turn', 'card', 'focus', 'status', 'place', 'shared']);
/** The record an SSE message carries: its data as JSON, typed by its own `type` or else by the event name. null: unreadable. */
function record(m: SseMessage, types: Set<string>): { type: string } | null {
  let v: unknown;
  try { v = JSON.parse(m.data); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, type = typeof o.type === 'string' ? o.type : m.event;
  return types.has(type) ? { ...o, type } : null;
}
/** A stream message as a CompanionEvent (null: unknown or malformed, skipped). */
export function readEvent(m: SseMessage): CompanionEvent | null {
  const r = record(m, STREAM_TYPES) as (CompanionEvent & Record<string, unknown>) | null;
  if (!r) return null;
  if (r.type === 'turn') return typeof r.conversationId === 'string' && r.event && typeof r.event === 'object' && TURN_TYPES.has((r.event as { type?: string }).type ?? '') ? r : null;
  if (r.type === 'card') return r.card && typeof r.card.id === 'string' ? r : null;
  if (r.type === 'focus') return r.focus && typeof r.focus.id === 'string' && r.focus.target ? r : null;
  if (r.type === 'place') return r.baton && typeof r.baton.state === 'string' && r.baton.place && typeof r.baton.place.hash === 'string' ? r : null;
  if (r.type === 'shared') return r.shared && typeof r.shared.rev === 'number' && Array.isArray(r.shared.readers) ? r : null;
  return Array.isArray(r.busy) ? r : { type: 'status', busy: [], sleeping: !!r.sleeping };
}
/** A turn POST body message as a TurnEvent. */
export function readTurnEvent(m: SseMessage): TurnEvent | null {
  return record(m, TURN_TYPES) as TurnEvent | null;
}

// ------------------------------------------------------------------------------------------- the stream
type ES = Pick<EventSource, 'addEventListener' | 'close'> & { onopen: ((e: Event) => void) | null; onerror: ((e: Event) => void) | null };
export interface ConnectOptions { url?: string; open?: (url: string) => ES; onOpen?(): void; /** The place baton moved (the crossing's host follows it; the lamp's store never sees it). */ onPlace?(b: PlaceBaton): void; /** The shared focus changed (the page's follow chip reads it; the lamp's store never sees it). */ onShared?(v: SharedView): void }

/** Open the stream and keep it open: on an error it is closed and reopened after 0.5 s doubling to 10 s (60 s after six
 *  failures in a row with no open, so a server without the companion is asked rarely). Returns the closer. */
export function connect(store: CompanionStore, o: ConnectOptions = {}): () => void {
  const url = o.url ?? STREAM_URL, open = o.open ?? ((u: string) => new EventSource(u) as unknown as ES);
  let es: ES | null = null, timer: ReturnType<typeof setTimeout> | undefined, delay = BACKOFF_MS, fails = 0, dead = false;
  const onMsg = (ev: Event) => {
    const m = ev as MessageEvent<string>, e = readEvent({ event: m.type, data: String(m.data) });
    if (e?.type === 'place') { o.onPlace?.(e.baton); return; }
    if (e?.type === 'shared') { o.onShared?.(e.shared); return; }
    if (e) store.dispatch({ type: 'event', e });
  };
  const start = () => {
    if (dead) return;
    const s = (es = open(url));
    for (const t of ['turn', 'card', 'focus', 'status', 'place', 'shared', 'message']) s.addEventListener(t, onMsg);
    s.onopen = () => { delay = BACKOFF_MS; fails = 0; store.dispatch({ type: 'online', on: true }); o.onOpen?.(); };
    s.onerror = () => {
      s.close(); if (es === s) es = null;
      store.dispatch({ type: 'online', on: false });
      if (dead) return;
      fails++;
      timer = setTimeout(start, fails >= COLD_AFTER ? BACKOFF_COLD_MS : delay);
      delay = Math.min(delay * 2, BACKOFF_CAP_MS);
    };
  };
  start();
  return () => { dead = true; clearTimeout(timer); es?.close(); es = null; store.dispatch({ type: 'online', on: false }); };
}

/** The pending cards the server holds (on every (re)connect, so a card raised while the page was away still asks). */
export async function loadCards(store: CompanionStore): Promise<void> {
  try {
    const r = await fetch('/api/companion/cards', { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return;
    const j = (await r.json()) as unknown;
    const list = Array.isArray(j) ? j : (j as { cards?: unknown })?.cards;
    if (Array.isArray(list)) store.dispatch({ type: 'cards', cards: list.filter((c): c is Card => !!c && typeof (c as Card).id === 'string' && typeof (c as Card).state === 'string') });
  } catch { /* the stream's own state says whether the server is there */ }
}

// ------------------------------------------------------------------------------------------- turns
export function readConversation(): string | undefined {
  try { return sessionStorage.getItem(CONV_KEY) || undefined; } catch { return undefined; }
}
function keepConversation(id: string): void {
  try { sessionStorage.setItem(CONV_KEY, id); } catch { /* private mode: the next turn starts a new conversation */ }
}

/** POST a turn and read its body into the store. A 409 thread_busy says "still answering the last one". */
export async function sendTurn(store: CompanionStore, text: string, product: string): Promise<void> {
  const conversationId = readConversation();
  store.dispatch({ type: 'posting', conversationId: conversationId ?? PENDING });
  try {
    const r = await fetch('/api/companion/turn', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(conversationId ? { conversationId, product, text } : { product, text }),
    });
    if (!r.ok || !r.body) {
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      store.dispatch({ type: 'notice', text: j?.error === 'thread_busy' ? BUSY : 'could not start that: ' + (j?.error || 'the server answered ' + r.status) });
      return;
    }
    const dec = new TextDecoder(), reader = r.body.getReader();
    const p = sseParser((m) => {
      const e = readTurnEvent(m); if (!e) return;
      if (e.type === 'start') keepConversation(e.conversationId);
      store.dispatch({ type: 'local', e });
    });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      p.push(dec.decode(value, { stream: true }));
    }
    p.push(dec.decode());
  } catch {
    store.dispatch({ type: 'notice', text: 'lost the answer on the way' });
  } finally {
    store.dispatch({ type: 'posting', conversationId: null });
  }
}

/** Stop this page's running turn (the server ends it with outcome interrupted). False: nothing to stop. */
export function stopTurn(store: CompanionStore): boolean {
  const t = runningLocal(store.get());
  if (!t?.turnId) return false;
  void fetch('/api/companion/turns/' + encodeURIComponent(t.turnId), { method: 'DELETE' }).catch(() => {});
  return true;
}

// ------------------------------------------------------------------------------------------- cards
let token: Promise<string> | null = null;
/** The human token, fetched once per page (and again after the server refuses it: a restarted server mints a new one). */
function humanToken(fresh = false): Promise<string> {
  if (fresh) token = null;
  return (token ??= fetch('/api/companion/human-token').then(async (r) => {
    const j = (await r.json().catch(() => null)) as { token?: string } | null;
    if (!r.ok || !j?.token) throw new Error(j && 'error' in j ? String((j as { error: unknown }).error) : 'no token');
    return j.token;
  }).catch((e) => { token = null; throw e; }));
}

/** Answer a card as the person. The answered card comes back on the stream; the returned one (when the route sends it) is
 *  applied at once. A refusal leaves the card pending and says so in a notice. */
export async function answerCard(store: CompanionStore, id: string, decision: 'approve' | 'decline'): Promise<void> {
  const post = async (fresh: boolean) => fetch('/api/companion/cards/' + encodeURIComponent(id), {
    method: 'POST', headers: { 'content-type': 'application/json', [HUMAN_HEADER]: await humanToken(fresh) }, body: JSON.stringify({ decision }),
  });
  try {
    let r = await post(false);
    if (r.status === 403) r = await post(true);
    const j = (await r.json().catch(() => null)) as { card?: Card; error?: string } | Card | null;
    if (!r.ok) { store.dispatch({ type: 'notice', text: 'that card was not answered: ' + ((j as { error?: string } | null)?.error || r.status) }); return; }
    const card = j && 'card' in j && j.card ? j.card : j && 'id' in j && 'state' in j ? (j as Card) : null;
    if (card) store.dispatch({ type: 'event', e: { type: 'card', card } });
  } catch {
    store.dispatch({ type: 'notice', text: 'that card was not answered: the server did not reply' });
  }
}
