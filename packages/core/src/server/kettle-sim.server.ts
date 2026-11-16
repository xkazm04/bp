// Kettle's sim host (wolf-plan L5.2): a process that hosts the sample's sims installs them here, and the scan, scans, waves,
// dispatch and stream routes answer Kettle from them, in memory only, never from or to a file. apps/server installs one
// ScanSim and one SwarmSim per process (apps/server/src/kettle-sim.ts); apps/web installs none (its browser runs the sample's
// own ScanSim), so there Kettle stays the read-only sample and those routes answer it unknownProduct's 405.
// The sim refuses with the routes' own statuses and bodies (an Error carrying `status` and `body`): simAnswer passes them on.
import type { ScanSim } from '../model/scan-sim.ts';
import type { SwarmSim } from '../model/sim.ts';
import { SCAN_TABLES, emptyScan, isEmptyScan, type ScanSnapshot, type StreamEvent } from '../scan/types.ts';
import { KETTLE_SLUG, findProduct } from './products.server.ts';

if (typeof window !== 'undefined') throw new Error('kettle-sim.server.ts is server-only');

export interface KettleHost { scan: ScanSim; swarm: SwarmSim }

// On globalThis, like the job registry (jobs.server.ts) and the cached gh login (release.server.ts): a dev-server module
// reload re-evaluates this file, and a module-level `let` would forget the host and let Kettle fall back to the 405.
const G = globalThis as typeof globalThis & { __bpKettleHost?: KettleHost };

/** Install this process's Kettle sims (once, at start). */
export function hostKettle(h: KettleHost): void { G.__bpKettleHost = h; }

/** The hosted Kettle scan sim when `slug` is the built-in sample (no product shadows it) and this process hosts one, else null. */
export function kettleSim(slug: string): ScanSim | null {
  const host = G.__bpKettleHost;
  return host && slug === KETTLE_SLUG && !findProduct(slug) ? host.scan : null;
}

/** `run()`'s result as JSON with `status`; a sim refusal as its own status and body. Anything else throws on (the mount's 500). */
export function simAnswer(run: () => unknown, status = 200): Response {
  try { return Response.json(run(), { status }); } catch (e) {
    const r = e as Error & { status?: unknown; body?: unknown };
    if (typeof r.status === 'number') return Response.json(r.body ?? { error: r.message }, { status: r.status });
    throw e;
  }
}

const PING_MS = 15000;

/**
 * The stream route's events over the hosted sim: `snapshot` on connect, then `jobs` when there are any; on every sim change
 * a `delta` of the rows not sent yet (the sim replaces a row it changes, so a row object is sent once) and `jobs` when the
 * job list changed; `ping` every 15 s. No `map` (Kettle's map never changes) and no `error` (nothing is read from a file).
 */
export function kettleStream(sim: ScanSim, req: Request): Response {
  const enc = new TextEncoder(), sent = new WeakSet<object>();
  let done = false, lastSent = Date.now(), jobs = sim.jobs();
  let ping: ReturnType<typeof setInterval> | null = null, unsubscribe: (() => void) | null = null;
  const stop = () => {
    if (done) return;
    done = true;
    if (ping) clearInterval(ping);
    unsubscribe?.(); unsubscribe = null;
  };
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (ev: StreamEvent, data: unknown) => {
        if (done) return;
        try { ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`)); lastSent = Date.now(); } catch { stop(); }
      };
      const s = sim.snapshot();
      for (const t of SCAN_TABLES) for (const r of s[t] ?? []) sent.add(r);
      send('snapshot', s);
      if (jobs.length) send('jobs', jobs);
      unsubscribe = sim.subscribe(() => {
        const now = sim.snapshot(), d = emptyScan() as Record<keyof ScanSnapshot, object[]>;
        for (const t of SCAN_TABLES) d[t] = ((now[t] ?? []) as object[]).filter((r) => !sent.has(r));
        if (!isEmptyScan(d as ScanSnapshot)) { for (const t of SCAN_TABLES) for (const r of d[t]) sent.add(r); send('delta', d); }
        const j = sim.jobs();
        if (j !== jobs) { jobs = j; send('jobs', j); }
      });
      ping = setInterval(() => { if (Date.now() - lastSent >= PING_MS) send('ping', { at: new Date().toISOString() }); }, 1000);
      req.signal.addEventListener('abort', () => { stop(); try { ctrl.close(); } catch { /* already closed */ } });
    },
    cancel() { stop(); },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
