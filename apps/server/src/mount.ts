// Mount bp's API handlers (packages/core/src/server/api/**/route.ts, the functions apps/web's route files re-export)
// on a node:http server. The route table is the handler tree itself, read the way Next reads app/api: a directory per
// segment, `[name]` one segment, `[...name]` the rest. Each request becomes a web Request (Host and headers as sent,
// X-Forwarded-For set from the socket as Next does, a signal that aborts when the client goes away) and the handler's
// Response streams back unbuffered, so the SSE stream behaves as it does under Next.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
type Method = (typeof METHODS)[number];
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

/** The request listener: route, adapt, call, stream back. */
export function listener(routes: Route[]) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // A Host no URL can carry and a malformed percent-escape both throw here; uncaught, they would end the process.
    let url: URL, route: Route | undefined, params: Params | null = null;
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      for (const r of routes) if ((params = r.match(url.pathname))) { route = r; break; }
    } catch {
      return json(res, 400, { error: 'malformed request URL or Host' });
    }
    if (!route || !params) return json(res, 404, { error: `no route ${url.pathname}` });
    const method = (req.method ?? 'GET').toUpperCase() as Method;
    const handler = route.handlers[method];
    if (!handler) return json(res, 405, { error: `${method} not allowed on ${route.path}` }, { allow: route.methods.join(', ') });

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
    const remote = req.socket.remoteAddress ?? '';
    headers.set('x-forwarded-for', headers.has('x-forwarded-for') ? `${headers.get('x-forwarded-for')}, ${remote}` : remote);
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    const hasBody = method !== 'GET' && (req.headers['content-length'] !== undefined ? req.headers['content-length'] !== '0' : req.headers['transfer-encoding'] !== undefined);
    const request = new Request(url, {
      method, headers, signal: abort.signal,
      ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
    } as RequestInit);

    let response: Response;
    try { response = await handler(request, { params: Promise.resolve(params) }); } catch (e) {
      console.error(`${method} ${url.pathname}:`, e);
      return json(res, 500, { error: `handler failed: ${(e as Error).message}` });
    }
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((v, k) => { out[k] = k === 'set-cookie' ? response.headers.getSetCookie() : v; });
    res.writeHead(response.status, response.statusText, out);
    if (!response.body || method === ('HEAD' as Method)) { res.end(); return; }
    res.flushHeaders();
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
    res.on('close', () => body.destroy());
    body.on('error', () => res.destroy());
    body.pipe(res);
  };
}
