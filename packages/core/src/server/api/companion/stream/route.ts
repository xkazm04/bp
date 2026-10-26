// GET /api/companion/stream: Server-Sent Events of every CompanionEvent on this process's bus
// (packages/core/src/server/companion/bus.server.ts), `event: <type>` and `data: <the CompanionEvent json>`:
//   event: status  { type, busy, sleeping }: on connect, and when a turn starts or ends
//   event: turn    { type, conversationId, event: TurnEvent }: every turn's events, whoever started it
//   event: card    { type, card }: a GATED tool's card, as it is created and decided
//   event: focus   { type, focus }: a FocusCommand for the page to carry out
//   event: ping    { at } every 15 s, so proxies and the client know the stream is alive
// The response closes, and unsubscribes, when the request aborts.
// Runtime state (the bus, locks, running turns) is per process: apps/server (:3100) is the canonical host; `next dev` has its
// own bus, so a page on it does not hear apps/server's turns.
import { localHost } from '@bp/core/scan/local-only';
import { subscribe } from '@bp/core/server/companion/bus.server';
import { heldKeys } from '@bp/core/server/companion/runtime/locks.server';
import type { CompanionEvent } from '@bp/core/companion/contract';

const PING_MS = 15_000;

export async function GET(req: Request): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const enc = new TextEncoder();
  let done = false, unsubscribe: (() => void) | null = null, ping: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (done) return;
    done = true;
    unsubscribe?.(); unsubscribe = null;
    if (ping) clearInterval(ping);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (type: string, data: unknown) => {
        if (done) return;
        try { ctrl.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { stop(); }
      };
      const close = () => { stop(); try { ctrl.close(); } catch { /* already closed */ } };
      send('status', { type: 'status', busy: heldKeys(), sleeping: false } satisfies CompanionEvent);
      unsubscribe = subscribe((e) => send(e.type, e));
      ping = setInterval(() => send('ping', { at: new Date().toISOString() }), PING_MS);
      req.signal.addEventListener('abort', close);
      if (req.signal.aborted) close();
    },
    cancel() { stop(); },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
