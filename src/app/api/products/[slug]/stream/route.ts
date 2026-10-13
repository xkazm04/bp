// GET /api/products/[slug]/stream: Server-Sent Events over the product's lens-scan store.
//   event: snapshot  a ScanSnapshot, on connect (empty arrays while the store does not exist; sent again
//                    when the store file appears)
//   event: delta     a ScanDelta: rows new since the last event (append-only tables by id, runs/proposals
//                    by updated_at, coverage by judged_at), checked each 1000 ms
//   event: map       { rev }: the fingerprint of the map files (app-structure.json, events.jsonl), sent once the map exists and
//                    again whenever it changes (the skill writes metrics back into it): the client then refetches /structure
//   event: jobs      ScanJob[]: the blueprint's scan jobs for this product (src/lib/scan/jobs.server.ts), after each
//                    snapshot when there are any, and on every change of the job registry (log lines at most every
//                    400 ms). A run whose note is `bp-job:<id>` (in a snapshot or delta) is attached to that job.
//   event: ping      every 15 s, so proxies and the client know the stream is alive
//   event: error     { message }: the store file exists but cannot be read (corrupt, mid-migration, locked past
//                    the timeout). Sent once per distinct message; the route keeps retrying and a good read
//                    sends a snapshot. An absent store is NOT an error: it gets the empty snapshot.
// The change check is `PRAGMA data_version` on ONE long-lived read connection: it moves only when another
// connection (the skill, or a decision) commits, so an idle store costs one pragma a second.
import fs from 'node:fs';
import { findProduct, recovered, storeDir, storeFile, warnOnce } from '@/lib/scan/products.server';
import { localHost } from '@/lib/scan/local-only';
import { advance, close, dataVersion, isEmptyScan, mapRev, newCursor, openRead, readDelta, readSnapshot, emptyScan, type Cursor } from '@/lib/scan/store.server';
import type { ScanSnapshot, StreamEvent } from '@/lib/scan/types';
import { RUN_NOTE_PREFIX } from '@/lib/scan/jobs';
import { attachRun, list as listJobs, subscribe as onJobs } from '@/lib/scan/jobs.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TICK_MS = 1000, PING_MS = 15000;

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  const file = storeFile(p), enc = new TextEncoder(), logKey = `stream ${slug} (${file})`;
  let db: ReturnType<typeof openRead> = null, dv = -1, cur: Cursor = newCursor();
  const dir = storeDir(p);
  let rev = '';
  let tick: ReturnType<typeof setInterval> | null = null, lastSent = Date.now(), done = false, sentErr = '';
  let unsubscribe: (() => void) | null = null;

  const stop = () => {
    if (done) return;
    done = true;
    if (tick) clearInterval(tick);
    unsubscribe?.(); unsubscribe = null;
    close(db); db = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (ev: StreamEvent, data: unknown) => {
        if (done) return;
        try { ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`)); lastSent = Date.now(); } catch { stop(); }
      };
      /** Runs a blueprint job started (lens-scan wrote `bp-job:<id>` in the note) name their job. attachRun notifies: a jobs event follows. */
      const attach = (s: ScanSnapshot) => { for (const r of s.runs) if (r.note?.startsWith(RUN_NOTE_PREFIX)) attachRun(slug, r.id, r.note); };
      /** After a snapshot the client holds no jobs: send them when there are any (an empty list is what it already has). */
      const sendJobs = () => { const j = listJobs(slug); if (j.length) send('jobs', j); };
      /** (Re)open the store and send it whole. data_version is read before the rows: a write in between shows up as a delta. */
      const connect = (): boolean => {
        if (!fs.existsSync(file)) return false;
        db = openRead(file);
        if (!db) { fail(new Error('cannot open the scan store')); return false; }
        try {
          dv = dataVersion(db);
          const s: ScanSnapshot = readSnapshot(db);
          cur = newCursor(); advance(cur, s);
          send('snapshot', s);
          attach(s); sendJobs();
          recovered(logKey); sentErr = '';
          return true;
        } catch (e) { close(db); db = null; fail(e); return false; }
      };
      /** The file exists and cannot be read: log it once and tell the client once per distinct message. */
      const fail = (e: unknown) => {
        warnOnce(logKey, e);
        const message = e instanceof Error ? e.message : String(e);
        if (message !== sentErr) { sentErr = message; send('error', { message }); }
      };
      /** The map files changed (or appeared): say so once per change. Independent of the store: a map can exist before the first scan. */
      const watchMap = () => { const r = mapRev(dir); if (r && r !== rev) { rev = r; send('map', { rev }); } };
      if (!connect() && !sentErr) { send('snapshot', emptyScan()); sendJobs(); }
      watchMap();
      if (!done) unsubscribe = onJobs(slug, (jobs) => send('jobs', jobs));
      tick = setInterval(() => {
        if (done) return;
        watchMap();
        try {
          if (!db) connect();
          else {
            const v = dataVersion(db);
            if (v !== dv) {
              dv = v;
              const d = readDelta(db, cur);
              if (!isEmptyScan(d)) { advance(cur, d); send('delta', d); attach(d); }
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
