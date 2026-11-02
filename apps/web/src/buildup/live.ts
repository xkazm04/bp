// The live source: build-up events from a running onboarding, read over Server-Sent Events. The feed resends every
// event since `begin` to each new connection, so a late subscriber catches up and a dropped connection loses nothing.
// The feed is the onboarding route (`/api/products/<slug>/onboarding`, its `/events` beside it) or, in the lab and for
// tape demos, any origin that serves `/events` (scripts/buildup/onboard-live.ts, scripts/buildup/replay-tape.ts).
//
// Catch-up (contract.ts BuildupListener `past`): what a connection sends in its first burst is history. On a reconnect
// the resent prefix this source already delivered is dropped (the build-up keeps going, nothing re-runs); anything new
// in the burst, and the whole burst of a first connection (a page opened mid-run), is delivered as `past`.
import type { BuildupEvent, BuildupListener, BuildupSource } from './contract';

/** A message that follows the previous one's handling within this many ms is still the connection's opening burst. */
const BURST_GAP = 80;

export type LiveState = 'connecting' | 'open' | 'retrying';
export interface LiveOptions {
  /** Appended to the events URL (`job=<id>`), without the `?`. */
  query?: string;
  /** Connection state, for a screen that says it lost the feed. */
  onState?: (s: LiveState) => void;
}

export function liveSource(feed: string, opts: LiveOptions = {}): BuildupSource {
  const url = feed.replace(/\/$/, '') + '/events' + (opts.query ? '?' + opts.query : '');
  const listeners = new Set<BuildupListener>();
  let played: BuildupEvent[] = [];
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined, backoff = 1000;
  // per connection: the resent prefix still being matched against `played`, and the opening burst
  let prev: string[] = [], cursor = 0, burst = true, lastEnd = 0;
  const state = (s: LiveState) => opts.onState?.(s);
  const close = () => { clearTimeout(retry); es?.close(); es = null; };
  const emit = (e: BuildupEvent, past: boolean) => {
    if (e.type === 'begin') played = [];
    played.push(e);
    listeners.forEach((fn) => fn(e, past));
  };
  const connect = () => {
    close();
    state('connecting');
    const src = new EventSource(url);
    es = src;
    // a reconnect (ours or the browser's own) starts a new burst that resends from `begin`
    src.onopen = () => { prev = played.map((x) => JSON.stringify(x)); cursor = 0; burst = true; lastEnd = 0; backoff = 1000; state('open'); };
    src.onmessage = (m) => {
      let e: BuildupEvent;
      try { e = JSON.parse(m.data) as BuildupEvent; } catch { return; }
      const now = performance.now();
      if (burst && lastEnd && now - lastEnd > BURST_GAP) burst = false;
      if (cursor < prev.length) {
        if (m.data === prev[cursor] || JSON.stringify(e) === prev[cursor]) { cursor++; lastEnd = performance.now(); return; }
        cursor = prev.length; // a different history (another run): from here it is delivered as it comes
      }
      emit(e, burst);
      lastEnd = performance.now();
    };
    // the browser retries a dropped connection by itself; a refused one (server restarting, 404 before the job exists)
    // closes the source for good, so this one comes back on its own, slower each time
    src.onerror = () => {
      if (src.readyState === EventSource.CLOSED && es === src) {
        state('retrying');
        retry = setTimeout(connect, backoff);
        backoff = Math.min(15000, backoff * 2);
      } else state('retrying');
    };
  };
  const restart = () => { played = []; connect(); };
  return {
    kind: 'live',
    subscribe(fn) { for (const e of played) fn(e, true); listeners.add(fn); return () => { listeners.delete(fn); }; },
    start: restart,
    replay: restart,
    dispose() { close(); listeners.clear(); played = []; },
  };
}

/**
 * The run's clock, in run seconds, followed from the events' `at` (ms since the run started) and the wall clock: between
 * events it runs on at the feed's pace (1 live, the speed of a tape replay), measured over the whole live stretch rather
 * than event to event, so it neither drifts nor jitters. It never steps back; at `done` or `failed` it stops.
 */
export interface RunClock {
  see(e: BuildupEvent, past: boolean, wall: number): void;
  /** Run seconds at `wall` (performance.now()). */
  now(wall: number): number;
  /** The feed's pace: run ms per wall ms, 0.25 to 8. */
  readonly rate: number;
  readonly ended: boolean;
}

export function runClock(): RunClock {
  let at = 0, wall = 0, shown = 0, end = Infinity, rate = 1;
  let anchor: { at: number; wall: number } | null = null;
  const clock: RunClock = {
    see(e, past, w) {
      if (e.type === 'begin') { at = e.at; wall = w; shown = 0; end = Infinity; rate = 1; anchor = past ? null : { at: e.at, wall: w }; return; }
      if (!past) {
        if (!anchor) anchor = { at: e.at, wall: w };
        else if (w - anchor.wall > 400 && e.at > anchor.at) rate = Math.min(8, Math.max(0.25, (e.at - anchor.at) / (w - anchor.wall)));
      }
      if (e.at >= at) { at = e.at; wall = w; }
      if (e.type === 'done' || e.type === 'failed') end = Math.max(shown, e.at);
    },
    now(w) {
      const v = Number.isFinite(end) ? end : at + Math.max(0, w - wall) * rate;
      shown = Math.max(shown, v);
      return shown / 1000;
    },
    get rate() { return rate; },
    get ended() { return Number.isFinite(end); },
  };
  return clock;
}
