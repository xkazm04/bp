// POST /api/companion/turn, body `TurnRequest` `{ conversationId?, product?, text }` (packages/core/src/companion/contract.ts):
// one companion turn as Server-Sent Events, `event: <TurnEvent type>` and `data: <TurnEvent json>`: start, text / tool /
// tool_result, then exactly one end (`done` | `interrupted` | `failed` with its failure class, and costUsd or null). The turn
// engine is packages/core/src/server/companion/runtime/turn.server.ts; this adapter only validates, maps ThreadBusy to **409**
// `{ error: 'thread_busy' }` (before any SSE header: the generator's first step takes the conversation's lock) and frames
// events. A client that goes away cancels the turn (its end still reaches /api/companion/stream and the ledger). **400** for
// a bad body. The MCP server the turn starts calls bp back at this request's origin.
// Runtime state (locks, running turns) is per process: apps/server (:3100) is the canonical host; `next dev` has its own.
import { localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { CONVERSATION_ID } from '@bp/core/server/companion/runtime/store.server';
import { ThreadBusy, cancelTurn, runTurn } from '@bp/core/server/companion/runtime/turn.server';
import type { TurnEvent, TurnRequest } from '@bp/core/companion/contract';

const MAX_TEXT = 8000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const KEYS = ['conversationId', 'product', 'text'];

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'body is { conversationId?, product?, text }' }, { status: 400 });
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !KEYS.includes(k));
  if (extra.length) return Response.json({ error: `unknown keys: ${extra.join(', ')}` }, { status: 400 });
  if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > MAX_TEXT) return Response.json({ error: `text must be 1..${MAX_TEXT} characters` }, { status: 400 });
  if (b.conversationId !== undefined && (typeof b.conversationId !== 'string' || !CONVERSATION_ID.test(b.conversationId))) return Response.json({ error: 'conversationId must be a conversation id' }, { status: 400 });
  if (b.product !== undefined && (typeof b.product !== 'string' || !SLUG.test(b.product))) return Response.json({ error: 'product must be a product slug' }, { status: 400 });
  const turnReq: TurnRequest = { text: b.text, ...(typeof b.conversationId === 'string' ? { conversationId: b.conversationId } : {}), ...(typeof b.product === 'string' ? { product: b.product } : {}) };

  const it = runTurn(turnReq, { origin: new URL(req.url).origin });
  let first: IteratorResult<TurnEvent>;
  try { first = await it.next(); } catch (e) {
    if (e instanceof ThreadBusy) return Response.json({ error: 'thread_busy' }, { status: 409 });
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  const turnId = !first.done && first.value.type === 'start' ? first.value.turnId : '';
  const enc = new TextEncoder();
  let closed = false;
  const leave = () => { if (!closed) { closed = true; if (turnId) cancelTurn(turnId); } };
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (e: TurnEvent) => { try { ctrl.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); } catch { leave(); } };
      req.signal.addEventListener('abort', leave);
      if (req.signal.aborted) leave();
      try {
        if (!first.done) send(first.value);
        for (let r = await it.next(); !r.done; r = await it.next()) send(r.value);
      } finally {
        closed = true;
        req.signal.removeEventListener('abort', leave);
        try { ctrl.close(); } catch { /* the client is gone */ }
      }
    },
    cancel() { leave(); },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
