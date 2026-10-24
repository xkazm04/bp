// The refusal record: one line per request a guard turned away, on both mounts. The handler guards (local-only.ts) are
// the one code both mounts run on every request, so they record their own refusals; apps/server's mount.ts records its
// transport refusals (socket peer, malformed URL, body cap, client left) through the same formatter. Pure (no fs): the
// default sink is console.warn, looked up per line so a check that captures console.warn sees it.
//
// The line stores no more than an operator needs to count and place a refusal:
//   refused <status> (<reason>) "<VERB>" "<path>" peer=<loopback|foreign|unknown>[ (+N dropped)]
// No header value (Host, Origin, X-Forwarded-For), no query string, no body, no socket address. Verb and path are
// clipped and JSON-quoted, so a hostile target cannot forge a second line. The reason is a closed code, never prose.

/** Every reason a refusal can carry. Closed: a guard or mount emitting anything else is a type error and a throw. */
export const REFUSAL_REASONS = [
  'foreign-host', // Host is not a loopback name (DNS rebinding)
  'foreign-hop', // an X-Forwarded-For hop is not loopback
  'foreign-origin', // a write's Origin is not a loopback page
  'opaque-origin', // a write's Origin is `null`
  'cross-site', // a write's Sec-Fetch-Site is cross-site
  'not-json', // a body's Content-Type is not application/json
  'foreign-peer', // the socket peer is not this machine (apps/server)
  'body-too-large', // the body passed MAX_BODY (apps/server)
  'malformed-url', // a URL or Host no URL can carry (apps/server)
  'client-left', // the client went away mid-body (apps/server)
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export interface Refusal {
  /** The status answered; `abort` when the client left and nothing was answered. */
  status: number | 'abort';
  reason: RefusalReason;
  method: string;
  /** The path only; a caller strips the query. */
  path: string;
  /** Whether the peer is loopback: true, false, or null when nothing names it. */
  peer: boolean | null;
}

const CLIP = 200;
const quote = (s: string, n: number) => JSON.stringify(s.slice(0, n));

/** The one line for a refusal. Throws on a reason outside REFUSAL_REASONS (the type already forbids one). */
export function formatRefusal(r: Refusal): string {
  if (!(REFUSAL_REASONS as readonly string[]).includes(r.reason)) throw new Error(`refusal reason not in the vocabulary: ${JSON.stringify(r.reason)}`);
  const status = r.status === 'abort' ? 'abort' : String(Math.trunc(r.status));
  const peer = r.peer === null ? 'unknown' : r.peer ? 'loopback' : 'foreign';
  return `refused ${status} (${r.reason}) ${quote(r.method, 16)} ${quote(r.path, CLIP)} peer=${peer}`;
}

export interface RefusalLog { record(r: Refusal): void }
export interface RefusalLogOptions {
  /** Where a line goes. Default: console.warn. */
  sink?: (line: string) => void;
  /** The clock (ms). Default: Date.now. */
  now?: () => number;
  /** Lines per window; the rest are counted and the count rides on the next line written. Default 20. */
  cap?: number;
  /** Window length (ms). Default 60 000. */
  windowMs?: number;
}

/** A rate-capped refusal log. Recording never throws past the vocabulary check: a failing sink is swallowed, so a
 *  refusal is answered whatever the log does, and nothing is awaited. */
export function createRefusalLog(o: RefusalLogOptions = {}): RefusalLog {
  const sink = o.sink ?? ((l: string) => console.warn(l));
  const now = o.now ?? Date.now, cap = o.cap ?? 20, windowMs = o.windowMs ?? 60_000;
  let start = -Infinity, written = 0, dropped = 0;
  return {
    record(r) {
      const line = formatRefusal(r), t = now();
      if (t - start >= windowMs) { start = t; written = 0; }
      if (written >= cap) { dropped++; return; }
      written++;
      const tail = dropped ? ` (+${dropped} dropped)` : '';
      dropped = 0;
      try { sink(line + tail); } catch { /* the log is best-effort; the refusal itself stands */ }
    },
  };
}

let current: RefusalLog = createRefusalLog();
/** Swap the process's refusal log (a check injects a sink and a clock); returns the one it replaced. */
export function setRefusalLog(log: RefusalLog): RefusalLog { const was = current; current = log; return was; }
/** Record one refusal on the process's log. Under Next each route bundle may hold its own copy of this module, so the
 *  rate cap is per bundle there; on apps/server it is per process. */
export function recordRefusal(r: Refusal): void { current.record(r); }
