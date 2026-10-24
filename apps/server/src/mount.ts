// Mount bp's API handlers (packages/core/src/server/api/**/route.ts, the functions apps/web's route files re-export)
// on a node:http server. The route table is the handler tree itself, read the way Next reads app/api: a directory per
// segment, `[name]` one segment, `[...name]` the rest. Each request becomes a web Request (Host and headers as sent,
// X-Forwarded-For set from the socket as Next does, the body read whole up to MAX_BODY, a signal that aborts when the
// client goes away) and the handler's Response streams back unbuffered, so the SSE stream behaves as it does under Next.
// Two verbs no handler exports are answered here, as Next answers them, so a client sees the same API on either mount:
// HEAD runs the route's GET and sends its status and headers with the body dropped, and OPTIONS answers 204 with Allow.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isLoopbackAddr } from '@bp/core/scan/local-only';

/** The largest request body the server reads (bytes); a longer one answers 413. bp's writes are small JSON documents. */
export const MAX_BODY = 4 * 1024 * 1024;
export const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
type Method = (typeof METHODS)[number];
/** What a request may ask for. HEAD and OPTIONS are never exported by a handler module: Next answers them from the
 *  GET handler and from the route's verb list, and so does this mount, so the two agree. */
type Verb = Method | 'HEAD' | 'OPTIONS';
type Params = Record<string, string | string[]>;
type Handler = (req: Request, ctx: { params: Promise<Params> }) => Response | Promise<Response>;

export interface Route {
  /** `/api/products/[slug]/structure`, as the directory names it. */
  path: string;
  /** The module file. */
  file: string;
  methods: Method[];
  handlers: Partial<Record<Method, Handler>>;
  match: (pathname: string) => Params | null;
}

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'route.ts' ? [path.join(d, e.name)] : []));

function matcher(segments: string[]): (pathname: string) => Params | null {
  return (pathname) => {
    const parts = pathname.split('/').filter(Boolean);
    const out: Params = {};
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i], rest = /^\[\.\.\.(\w+)\]$/.exec(s), one = /^\[(\w+)\]$/.exec(s);
      if (rest) {
        if (i !== segments.length - 1 || parts.length <= i) return null;
        out[rest[1]] = parts.slice(i).map(decodeURIComponent);
        return out;
      }
      if (i >= parts.length) return null;
      if (one) out[one[1]] = decodeURIComponent(parts[i]);
      else if (s !== parts[i]) return null;
    }
    return parts.length === segments.length ? out : null;
  };
}

/** Every handler module under `apiDir` (the `api/` directory itself is the `/api` segment). Static segments sort
 *  before dynamic ones, so `/api/products/[slug]/releases/suggest` wins over `.../releases/[id]`. */
export async function loadRoutes(apiDir: string): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of walk(apiDir)) {
    const segments = ['api', ...path.relative(apiDir, path.dirname(file)).split(path.sep).filter(Boolean)];
    const mod = (await import(pathToFileURL(file).href)) as Partial<Record<Method, Handler>>;
    const methods = METHODS.filter((m) => typeof mod[m] === 'function');
    const handlers: Partial<Record<Method, Handler>> = {};
    for (const m of methods) handlers[m] = mod[m];
    routes.push({ path: '/' + segments.join('/'), file, methods, handlers, match: matcher(segments) });
  }
  const rank = (r: Route) => r.path.split('/').map((s) => (s.startsWith('[...') ? 2 : s.startsWith('[') ? 1 : 0));
  return routes.sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return y.length - x.length;
  });
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const TOO_LARGE = Symbol('too large');

/** The whole request body; TOO_LARGE as soon as it (declared or as read so far) passes MAX_BODY; null when the client goes away mid-body. */
function readBody(req: IncomingMessage): Promise<Buffer | typeof TOO_LARGE | null> {
  if (Number(req.headers['content-length']) > MAX_BODY) return Promise.resolve(TOO_LARGE);
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let size = 0;
    const onData = (b: Buffer) => {
      size += b.length;
      if (size > MAX_BODY) { req.off('data', onData); req.pause(); resolve(TOO_LARGE); } else parts.push(b);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', () => resolve(null));
    req.on('close', () => { if (!req.complete) resolve(null); });
  });
}

/** 413, then the connection closes: the rest of the body is never read. */
function tooLarge(res: ServerResponse): void {
  res.on('finish', () => res.socket?.destroySoon());
  json(res, 413, { error: `request body over ${MAX_BODY} bytes` }, { connection: 'close' });
}

/** One warn line per refusal the operator would want to know about: the status, why, the verb, the clipped and quoted
 *  target (JSON.stringify, so a hostile URL cannot forge a log line) and the socket peer. 404 and 405 stay quiet: a
 *  scanner probing paths would drown the 403s. */
function refused(req: IncomingMessage, status: number | string, why: string): void {
  console.warn(`refused ${status} (${why}) ${JSON.stringify(req.method ?? '?')} ${JSON.stringify((req.url ?? '').slice(0, 200))} from ${req.socket.remoteAddress ?? 'unknown peer'}`);
}

/** The request listener: route, adapt, call, stream back. */
export function listener(routes: Route[]) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The socket peer must be this machine (LOOPBACK_PEER was this mount's own copy of the rule; it is now the shared
    // isLoopbackAddr the X-Forwarded-For hop check uses). The handlers' guards check only headers, which any LAN client
    // sets (`Host: localhost`); under `--host 0.0.0.0` this is what keeps the reads local. An undefined address refuses.
    if (!isLoopbackAddr(req.socket.remoteAddress ?? '')) {
      refused(req, 403, 'peer is not this machine');
      return json(res, 403, { error: 'only served to this machine' });
    }
    // A Host no URL can carry and a malformed percent-escape both throw here; uncaught, they would end the process.
    let url: URL, route: Route | undefined, params: Params | null = null;
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      for (const r of routes) if ((params = r.match(url.pathname))) { route = r; break; }
    } catch {
      refused(req, 400, 'malformed URL or Host');
      return json(res, 400, { error: 'malformed request URL or Host' });
    }
    if (!route || !params) return json(res, 404, { error: `no route ${url.pathname}` });
    const method = (req.method ?? 'GET').toUpperCase() as Verb;
    // The verbs this route actually serves, as Next reports them: its exported ones, plus HEAD when it exports GET,
    // plus OPTIONS. `route.methods` stays the exported set, so the printed route table and check:server do not move.
    const allow = [...route.methods, ...(route.handlers.GET ? ['HEAD'] : []), 'OPTIONS'].join(', ');
    // Next implements OPTIONS itself: 204 and the Allow header, no handler involved.
    if (method === 'OPTIONS') { res.writeHead(204, { allow }); res.end(); return; }
    // ...and HEAD from the GET handler, with the body dropped (below, where the body would be piped).
    const handler = method === 'HEAD' ? route.handlers.GET : route.handlers[method];
    if (!handler) return json(res, 405, { error: `${method} not allowed on ${route.path}` }, { allow });

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
    const remote = req.socket.remoteAddress ?? '';
    headers.set('x-forwarded-for', headers.has('x-forwarded-for') ? `${headers.get('x-forwarded-for')}, ${remote}` : remote);
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    const hasBody = method !== 'GET' && method !== 'HEAD' && (req.headers['content-length'] !== undefined ? req.headers['content-length'] !== '0' : req.headers['transfer-encoding'] !== undefined);
    const reqBody = hasBody ? await readBody(req) : null;
    if (reqBody === TOO_LARGE) { refused(req, 413, `body over ${MAX_BODY} bytes`); return tooLarge(res); }
    if (hasBody && !reqBody) { refused(req, 'abort', 'client left mid-body'); res.destroy(); return; }
    const request = new Request(url, { method, headers, signal: abort.signal, ...(reqBody ? { body: new Uint8Array(reqBody) } : {}) });

    let response: Response;
    try { response = await handler(request, { params: Promise.resolve(params) }); } catch (e) {
      console.error(`${method} ${url.pathname}:`, e);
      return json(res, 500, { error: `handler failed (${method} ${route.path}); the server log has the detail` });
    }
    // The client left while the handler ran: res has closed already, so nothing below would ever cancel the body (an SSE
    // stream would keep its timers and subscriptions for good).
    if (abort.signal.aborted || res.destroyed) { void response.body?.cancel().catch(() => {}); return; }
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((v, k) => { out[k] = k === 'set-cookie' ? response.headers.getSetCookie() : v; });
    res.writeHead(response.status, response.statusText, out);
    if (!response.body || method === 'HEAD') { void response.body?.cancel().catch(() => {}); res.end(); return; }
    res.flushHeaders();
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
    res.on('close', () => body.destroy());
    body.on('error', () => res.destroy());
    body.pipe(res);
  };
}
