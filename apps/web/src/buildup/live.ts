// The live source: build-up events from a running onboarding, read over Server-Sent Events. The feed resends every
// event since `begin` to each new connection, so `replay` is a reconnect and a late subscriber catches up. The feed's
// origin is given by the lab (`?source=live&feed=http://127.0.0.1:3300`); scripts/buildup/onboard-live.mjs serves one.
import type { BuildupEvent, BuildupListener, BuildupSource } from './contract';

export function liveSource(feed: string): BuildupSource {
  const listeners = new Set<BuildupListener>();
  let played: BuildupEvent[] = [];
  let es: EventSource | null = null;
  const close = () => { es?.close(); es = null; };
  const open = () => {
    close();
    played = [];
    es = new EventSource(feed.replace(/\/$/, '') + '/events');
    es.onmessage = (m) => {
      let e: BuildupEvent;
      try { e = JSON.parse(m.data) as BuildupEvent; } catch { return; }
      if (e.type === 'begin') played = [];
      played.push(e);
      listeners.forEach((fn) => fn(e));
    };
  };
  return {
    kind: 'live',
    subscribe(fn) { for (const e of played) fn(e); listeners.add(fn); return () => { listeners.delete(fn); }; },
    start: open,
    replay: open,
    dispose() { close(); listeners.clear(); played = []; },
  };
}
