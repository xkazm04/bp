// Request guards for the localhost-only API routes. Pure (no fs), so scripts/check-local-only.ts imports it.
// Each guard records its own refusal (refusals.ts): these are the one code both mounts run on every request, so a
// refusal is logged here once and never per route or per door.
import { recordRefusal, type RefusalReason } from './refusals.ts';
const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;
/** A loopback address (an X-Forwarded-For hop, a socket peer): 127.x.x.x, ::1, IPv4-mapped 127.x.x.x, or the name localhost. */
export const isLoopbackAddr = (a: string): boolean => /^(127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3}|localhost)$/i.test(a.trim());
const hostOnly = (h: string): string => (h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]);

type Verdict = { reason: RefusalReason; message: string } | null;
const no = (reason: RefusalReason, message: string): Verdict => ({ reason, message });
const pathOf = (url: string): string => { try { return new URL(url).pathname; } catch { return '?'; } };
/** The nearest X-Forwarded-For hop is loopback: apps/server appends the socket peer there, and Next fills it from the
 *  socket when the client sent none (a client-sent one survives, so under Next it is a claim). null with no hop. */
const nearestHop = (req: Request): boolean | null => {
  const last = (req.headers.get('x-forwarded-for') ?? '').split(',').pop()?.trim();
  return last ? isLoopbackAddr(last) : null;
};
/** Record the refusal (once) and hand back the string the handler answers with. */
function refuse(req: Request, status: number, v: Verdict): string | null {
  if (!v) return null;
  recordRefusal({ status, reason: v.reason, method: req.method, path: pathOf(req.url), peer: nearestHop(req) });
  return v.message;
}

function hostVerdict(req: Request): Verdict {
  const host = req.headers.get('host') ?? '';
  if (!LOOPBACK_HOST.test(hostOnly(host))) return no('foreign-host', `only served on localhost (Host: ${host || 'none'})`);
  const xff = req.headers.get('x-forwarded-for');
  if (xff && !xff.split(',').every(isLoopbackAddr)) return no('foreign-hop', `only served on this machine (X-Forwarded-For: ${xff})`);
  return null;
}

/** Reads: the Host must be a loopback name (stops DNS rebinding) and every `X-Forwarded-For` hop must be loopback, the
 *  same hop check writes get (a forwarded request carries the whole scan store out as readily as it carries a write in).
 *  Same-origin fetch/EventSource always pass. */
export function localHost(req: Request): string | null {
  return refuse(req, 403, hostVerdict(req));
}

/**
 * Writes come from this machine only (bp runs locally). The Host must be a loopback name (this
 * also stops DNS rebinding); a browser's Origin, when sent, must be loopback too, and `Sec-Fetch-Site`
 * must not be cross-site (no other page can post here); every `X-Forwarded-For` hop (localHost checks it) must be loopback.
 * These are all headers, and a client on the LAN sets every one: Next fills X-Forwarded-For from the socket only when
 * the client sent none (`??=`), and does not expose the socket address to route handlers. So under Next the boundary is
 * the socket: the web mount binds loopback (`-H 127.0.0.1`, gated by scripts/check-web-bind.mjs), and apps/server refuses
 * a non-loopback socket peer with isLoopbackAddr before routing. These guards stop browsers (rebinding, cross-site).
 */
export function localOnly(req: Request): string | null {
  return refuse(req, 403, writeVerdict(req));
}
/** localOnly's rule, unrecorded: it runs the host rule without localHost's record, so a refusal writes one line, not two. */
function writeVerdict(req: Request): Verdict {
  const h = req.headers, bad = hostVerdict(req);
  if (bad) return { reason: bad.reason, message: bad.message.replace('only served', 'writes are only accepted') };
  const origin = h.get('origin');
  if (origin && origin !== 'null') {
    let oh = '';
    try { oh = new URL(origin).hostname; } catch { /* unparseable: refused below */ }
    if (!LOOPBACK_HOST.test(oh)) return no('foreign-origin', `writes are only accepted from a localhost page (Origin: ${origin})`);
  } else if (origin === 'null') return no('opaque-origin', 'writes are not accepted from an opaque origin');
  if (h.get('sec-fetch-site') === 'cross-site') return no('cross-site', 'cross-site writes are refused');
  return null; // the X-Forwarded-For hop check is in hostVerdict, above, so reads and writes share it
}

/** A JSON body must say so: a cross-site "simple" POST (text/plain, form types) cannot set application/json without a preflight. */
export function jsonOnly(req: Request): string | null {
  const t = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return refuse(req, 415, t === 'application/json' ? null : no('not-json', `body must be application/json (Content-Type: ${t || 'none'})`));
}
