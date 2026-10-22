// Request guards for the localhost-only API routes. Pure (no fs), so scripts/check-local-only.ts imports it.
const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;
const isLoopbackAddr = (a: string): boolean => /^(127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3}|localhost)$/i.test(a.trim());
const hostOnly = (h: string): string => (h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]);

/** Reads: the Host must be a loopback name (stops DNS rebinding) and every `X-Forwarded-For` hop must be loopback, the
 *  same hop check writes get (a forwarded request carries the whole scan store out as readily as it carries a write in).
 *  Same-origin fetch/EventSource always pass. */
export function localHost(req: Request): string | null {
  const host = req.headers.get('host') ?? '';
  if (!LOOPBACK_HOST.test(hostOnly(host))) return `only served on localhost (Host: ${host || 'none'})`;
  const xff = req.headers.get('x-forwarded-for');
  if (xff && !xff.split(',').every(isLoopbackAddr)) return `only served on this machine (X-Forwarded-For: ${xff})`;
  return null;
}

/**
 * Writes come from this machine only (bp runs locally). The Host must be a loopback name (this
 * also stops DNS rebinding); a browser's Origin, when sent, must be loopback too, and `Sec-Fetch-Site`
 * must not be cross-site (no other page can post here); every `X-Forwarded-For` hop (localHost checks it; Next sets it from
 * the socket) must be loopback. Next does not expose the socket address to route handlers, so this is
 * the strongest check available at this layer.
 */
export function localOnly(req: Request): string | null {
  const h = req.headers, bad = localHost(req);
  if (bad) return bad.replace('only served', 'writes are only accepted');
  const origin = h.get('origin');
  if (origin && origin !== 'null') {
    let oh = '';
    try { oh = new URL(origin).hostname; } catch { /* unparseable: refused below */ }
    if (!LOOPBACK_HOST.test(oh)) return `writes are only accepted from a localhost page (Origin: ${origin})`;
  } else if (origin === 'null') return 'writes are not accepted from an opaque origin';
  if (h.get('sec-fetch-site') === 'cross-site') return 'cross-site writes are refused';
  return null; // the X-Forwarded-For hop check is in localHost, above, so reads and writes share it
}

/** A JSON body must say so: a cross-site "simple" POST (text/plain, form types) cannot set application/json without a preflight. */
export function jsonOnly(req: Request): string | null {
  const t = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return t === 'application/json' ? null : `body must be application/json (Content-Type: ${t || 'none'})`;
}
