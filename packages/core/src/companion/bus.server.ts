// The companion's in-process event bus: what GET /api/companion/stream fans out to every open page. The runtime publishes turn
// events, the card and focus routes publish theirs, and the last FOCUS_KEEP focus commands stay readable for a client that
// polls instead of streaming (VR's BpLink: GET /api/companion/focus?since=<id>). One bus per server process; the companion is
// served by one process (apps/server is canonical), so nothing here is shared across processes.
import type { CompanionEvent, FocusCommand } from './contract.ts';

if (typeof window !== 'undefined') throw new Error('bus.server.ts is server-only');

export const FOCUS_KEEP = 20;

type Listener = (e: CompanionEvent) => void;
const g = globalThis as unknown as { __bpCompanionBus?: { listeners: Set<Listener>; focus: FocusCommand[] } };
const bus = (g.__bpCompanionBus ??= { listeners: new Set(), focus: [] });

export function publish(e: CompanionEvent): void {
  if (e.type === 'focus') {
    bus.focus.push(e.focus);
    if (bus.focus.length > FOCUS_KEEP) bus.focus.splice(0, bus.focus.length - FOCUS_KEEP);
  }
  for (const l of bus.listeners) {
    try { l(e); } catch { /* one dead page must not stop the others */ }
  }
}

/** Subscribe; returns the unsubscribe. */
export function subscribe(l: Listener): () => void {
  bus.listeners.add(l);
  return () => { bus.listeners.delete(l); };
}

/** Focus commands newer than `since` (an id), newest first; all kept ones when `since` is unknown or omitted. */
export function focusSince(since?: string): FocusCommand[] {
  const i = since ? bus.focus.findIndex((f) => f.id === since) : -1;
  return bus.focus.slice(i + 1).reverse();
}
