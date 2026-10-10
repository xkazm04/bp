// GET /api/products/[slug]/stream: Server-Sent Events over the product's lens-scan store.
//   event: snapshot  a ScanSnapshot, on connect (empty arrays while the store does not exist; sent again
//                    when the store file appears)
//   event: delta     a ScanDelta: rows new since the last event (append-only tables by id, runs/proposals
//                    by updated_at, coverage by judged_at), checked each 1000 ms
//   event: ping      every 15 s, so proxies and the client know the stream is alive
// The change check is `PRAGMA data_version` on ONE long-lived read connection: it moves only when another
// connection (the skill, or a decision) commits, so an idle store costs one pragma a second.
import fs from 'node:fs';
import { findProduct, recovered, storeFile, warnOnce } from '@/lib/scan/products.server';
import { advance, close, dataVersion, isEmptyScan, newCursor, openRead, readDelta, readSnapshot, emptyScan, type Cursor } from '@/lib/scan/store.server';
import type { ScanSnapshot, StreamEvent } from '@/lib/scan/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TICK_MS = 1000, PING_MS = 15000;

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  const file = storeFile(p), enc = new TextEncoder(), logKey = `stream ${slug} (${file})`;
  let db: ReturnType<typeof openRead> = null, dv = -1, cur: Cursor = newCursor();
  let tick: ReturnType<typeof setInterval> | null = null, lastSent = Date.now(), done = false;

  const stop = () => {
    if (done) return;
    done = true;
    if (tick) clearInterval(tick);
    close(db); db = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (ev: StreamEvent, data: unknown) => {
        if (done) return;
        try { ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`)); lastSent = Date.now(); } catch { stop(); }
      };
      /** (Re)open the store and send it whole. data_version is read before the rows: a write in between shows up as a delta. */
      const connect = (): boolean => {
        if (!fs.existsSync(file)) return false;
        db = openRead(file);
        if (!db) return false;
        try {
          dv = dataVersion(db);
          const s: ScanSnapshot = readSnapshot(db);
          cur = newCursor(); advance(cur, s);
          send('snapshot', s);
          recovered(logKey);
          return true;
        } catch (e) { close(db); db = null; warnOnce(logKey, e); return false; }
      };
      if (!connect()) send('snapshot', emptyScan());
      tick = setInterval(() => {
        if (done) return;
        try {
          if (!db) connect();
          else {
            const v = dataVersion(db);
            if (v !== dv) {
              dv = v;
              const d = readDelta(db, cur);
              if (!isEmptyScan(d)) { advance(cur, d); send('delta', d); }
            }
          }
        } catch (e) { close(db); db = null; warnOnce(logKey, e); /* store replaced or locked past the timeout: reconnect next tick */ }
        if (Date.now() - lastSent >= PING_MS) send('ping', { at: new Date().toISOString() });
      }, TICK_MS);
      req.signal.addEventListener('abort', () => { stop(); try { ctrl.close(); } catch { /* already closed */ } });
    },
    cancel() { stop(); },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
