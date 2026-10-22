// The athena host (wolf-plan L5.3, tech-stack.md section 4): this server registers bp's tools with an athena daemon as one host
// app (`app_id: "bp"`), answers a decision card through the daemon's POST /decisions/<id>, and runs each entry of the
// `execute` it returns against this server's own handlers (the same Route table the mount serves). Attached only when the
// operator opts in (main.ts: --athena <url>); without it nothing here is loaded and the server is unchanged.
// Two spellings the daemon requires (athena 9beaef31, measured by scripts/smoke-athena.mjs):
//   - page_origin: plain http is admitted only on the host `localhost` by exact name (athena's page_origin_admitted, ADR 0119);
//     `http://127.0.0.1:<port>` is refused 400 manifest_invalid. The default origin is http://localhost:<port>.
//   - tool names: the catalog refuses a dotted name ("not a slug"; it namespaces tools as host.<app>.<name>), so a tool
//     travels as `wave_dispatch` and is mapped back to the table's `wave.dispatch` here.
// Execution is idempotent per call_id: a replayed or duplicated execute entry answers the first run's result and runs nothing.
// A decline runs nothing, whatever the daemon's answer carries. The token is read from the daemon's own file
// ($ATHENA_HOME/daemon.json, named by the ready line) and is never printed or logged.
import fs from 'node:fs';
import { jsonOnly, localHost, localOnly } from '@bp/core/scan/local-only';
import type { Route } from './mount.ts';
import { isObj } from '@bp/core/standard/guards';

export type ToolClass = 'AUTO' | 'GATED';
export type SideEffects = 'none' | 'internal' | 'external';

export interface BpTool {
  /** The name tech-stack.md section 4 gives it. */
  name: string;
  description: string;
  reversible: boolean;
  side_effects: SideEffects;
  /** The class the section 4 table states; athena derives its own from the two flags, and the two must agree. */
  cls: ToolClass;
  params_schema: Record<string, unknown>;
}

const slug = { type: 'string', description: "the product's slug; kettle is the built-in sample" };

/** bp's tools, tech-stack.md section 4. */
export const BP_TOOLS: readonly BpTool[] = [
  { name: 'navigate', description: 'Fly the view to a wing, room or feature of the product.', reversible: true, side_effects: 'internal', cls: 'AUTO',
    params_schema: { type: 'object', properties: { target: { type: 'string', description: 'a wing, room or feature slug' } }, required: ['target'] } },
  { name: 'lens.set', description: 'Show the map through one lens.', reversible: true, side_effects: 'internal', cls: 'AUTO',
    params_schema: { type: 'object', properties: { lens: { type: 'string', description: 'a lens id' } }, required: ['lens'] } },
  { name: 'scan.place', description: 'Start a lens scan of a scope (feature, bay, room, wing or all).', reversible: true, side_effects: 'internal', cls: 'AUTO',
    params_schema: { type: 'object', properties: { slug, lens: { type: 'string' }, scope: { type: 'object', description: '{ kind, id?, label, features }' } }, required: ['lens', 'scope'] } },
  { name: 'wave.compose', description: 'Group findings into a draft wave of packages, each with a model and an effort.', reversible: true, side_effects: 'internal', cls: 'AUTO',
    params_schema: { type: 'object', properties: { slug, name: { type: 'string' }, packages: { type: 'array', maxItems: 20, items: { type: 'object', description: '{ name, model, effort, ids }' } } }, required: ['name', 'packages'] } },
  { name: 'wave.dispatch', description: "Dispatch a wave: queue its packages' build jobs, which spend money and edit code.", reversible: false, side_effects: 'external', cls: 'GATED',
    params_schema: { type: 'object', properties: { slug, wave: { type: 'string', description: "the wave's id" }, packages: { type: 'array', maxItems: 20, items: { type: 'string' }, description: 'package ids; default every package' } }, required: ['wave'] } },
  { name: 'decision.answer', description: "Answer one of the swarm's questions.", reversible: false, side_effects: 'internal', cls: 'GATED',
    params_schema: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] } },
  { name: 'finding.decline', description: 'Decline one finding (a proposed change).', reversible: true, side_effects: 'internal', cls: 'AUTO',
    params_schema: { type: 'object', properties: { slug, id: { type: 'string', description: "the finding's id" }, note: { type: 'string' } }, required: ['id'] } },
];

export const APP_ID = 'bp';
/** The name a tool travels under: athena's catalog takes a slug, not a dotted name. */
export const wireName = (name: string): string => name.replace(/\./g, '_');
/** athena's rule (README section 3.3): AUTO only when reversible and not external. */
export const classOf = (t: Pick<BpTool, 'reversible' | 'side_effects'>): ToolClass => (t.reversible && t.side_effects !== 'external' ? 'AUTO' : 'GATED');

/** The body of POST /manifest. */
export function manifestBody(pageOrigin: string, tools: readonly BpTool[] = BP_TOOLS) {
  return {
    app_id: APP_ID,
    app_version: '1',
    page_origin: pageOrigin,
    tools: tools.map((t) => ({ name: wireName(t.name), description: t.description, reversible: t.reversible, side_effects: t.side_effects, params_schema: t.params_schema })),
  };
}

/** Why `url` may not carry the token, or null. Plain http only to a loopback host (the token would cross the network in
 *  clear), and no user:password in it (the URL is printed and served by GET /athena). */
export function daemonUrlProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return `--athena is not a URL: ${JSON.stringify(url)}`; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `--athena is not an http URL: ${JSON.stringify(url)}`;
  if (u.username || u.password) return '--athena must not carry a user or password';
  if (u.protocol === 'http:' && !/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(u.hostname)) return `--athena over plain http must be a loopback host, not ${u.hostname} (the token would cross the network in clear)`;
  return null;
}

/** The token in an athena token file (`daemon.json`, `{ token }`). Throws a message that never carries the token. */
export function readToken(file: string): string {
  let j: unknown;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read the athena token file ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`); }
  const t = (j as { token?: unknown } | null)?.token;
  if (typeof t !== 'string' || !t) throw new Error(`the athena token file ${file} holds no token`);
  return t;
}

export interface ExecuteEntry { call_id: string; name: string; params?: Record<string, unknown>; origin?: string; tier?: number; approval_id?: string }
export interface ExecResult { call_id: string; name: string; ok: boolean; status: number; output: unknown; replayed?: true }
export type Registered = { ok: true; tools: { name: string; class: string }[] } | { ok: false; status: number; reason: string; detail: string };
export interface Answered {
  ok: boolean; status: number; id: string; choice: string;
  /** The daemon's answer, as sent (a refusal's `reason` and `detail` included). */
  daemon: Record<string, unknown>;
  ran: ExecResult[];
}

export interface HostOptions {
  url: string;
  token: string;
  pageOrigin: string;
  /** This server's own route table: execute entries run through it. */
  routes: Route[];
  /** The Host header the in-process requests carry (a loopback name, so the write guards pass). */
  selfHost: string;
  tools?: readonly BpTool[];
}

const KNOWN_KEY = 1000;
/** A card id as the daemon mints them (`apr_` and 12 hex digits), with room to spare; never a dot segment. */
const CARD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export class AthenaHost {
  readonly url: string;
  readonly pageOrigin: string;
  readonly tools: readonly BpTool[];
  private readonly token: string;
  private readonly routes: Route[];
  private readonly selfHost: string;
  /** call_id -> its run, kept while running too, so a duplicate arriving mid-run waits for the same result. */
  private readonly done = new Map<string, Promise<ExecResult>>();
  registered: Registered | null = null;

  constructor(o: HostOptions) {
    const bad = daemonUrlProblem(o.url);
    if (bad) throw new Error(bad);
    this.url = o.url.replace(/\/+$/, '');
    this.token = o.token;
    this.pageOrigin = o.pageOrigin;
    this.routes = o.routes;
    this.selfHost = o.selfHost;
    this.tools = o.tools ?? BP_TOOLS;
  }

  private async call(method: string, p: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    try {
      const r = await fetch(this.url + p, {
        method,
        headers: { 'x-athena-token': this.token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        // never followed: fetch keeps X-Athena-Token across origins, so a 3xx would hand the token to its Location
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
      const text = await r.text();
      let json: unknown = null;
      try { json = JSON.parse(text); } catch { /* reported below */ }
      return { status: r.status, json: isObj(json) ? json : { ok: false, reason: 'not_json', detail: text.slice(0, 200) } };
    } catch (e) {
      return { status: 0, json: { ok: false, reason: 'unreachable', detail: `${(e as Error).name}: ${(e as Error).message}` } };
    }
  }

  /** POST /manifest. A refusal (any status but 200, or a body that is not ok) is returned, never thrown. */
  async register(): Promise<Registered> {
    const { status, json } = await this.call('POST', '/manifest', manifestBody(this.pageOrigin, this.tools));
    const tools = Array.isArray(json.tools) ? json.tools.filter(isObj).map((t) => ({ name: String(t.name), class: String(t.class) })) : [];
    this.registered = status === 200 && json.ok === true
      ? { ok: true, tools }
      : { ok: false, status, reason: String(json.reason ?? 'refused'), detail: [json.detail, ...(Array.isArray(json.problems) ? json.problems : [])].filter(Boolean).join('; ') };
    return this.registered;
  }

  /** Answer card `id` (POST /decisions/<id>) and, on an approve the daemon granted, run its `execute`. */
  async answer(id: string, choice: 'approve' | 'decline'): Promise<Answered> {
    // the id is the caller's: `.` and `..` survive encodeURIComponent and the URL parser folds them into another daemon path
    if (!CARD_ID.test(id)) return { ok: false, status: 400, id, choice, daemon: { ok: false, reason: 'bad_id', detail: 'a card id is letters, digits, _ and -' }, ran: [] };
    const { status, json } = await this.call('POST', `/decisions/${encodeURIComponent(id)}`, { choice, origin: this.pageOrigin });
    const ok = status === 200 && json.ok === true;
    // a decline runs nothing, whatever the answer carries
    const entries = ok && choice === 'approve' && Array.isArray(json.execute) ? json.execute : [];
    return { ok, status, id, choice, daemon: json, ran: await this.execute(entries) };
  }

  /** Run each execute entry once per call_id; a replayed one answers the first run's result, marked `replayed`. */
  async execute(entries: unknown[]): Promise<ExecResult[]> {
    const out: ExecResult[] = [];
    for (const e of entries) {
      if (!isObj(e) || !str(e.call_id) || !str(e.name)) { out.push({ call_id: String((e as { call_id?: unknown })?.call_id ?? ''), name: '', ok: false, status: 400, output: 'not an execute entry' }); continue; }
      const entry = e as unknown as ExecuteEntry;
      const seen = this.done.get(entry.call_id);
      if (seen) { out.push({ ...(await seen), replayed: true }); continue; }
      const run = this.runOne(entry);
      this.done.set(entry.call_id, run);
      if (this.done.size > KNOWN_KEY) this.done.delete(this.done.keys().next().value as string);
      out.push(await run);
    }
    return out;
  }

  private async runOne(e: ExecuteEntry): Promise<ExecResult> {
    const prefix = `host.${APP_ID}.`, base = { call_id: e.call_id, name: e.name };
    if ((e.origin !== undefined && e.origin !== `host:${APP_ID}`) || !e.name.startsWith(prefix)) return { ...base, ok: false, status: 403, output: `not a ${APP_ID} tool` };
    const tool = this.tools.find((t) => wireName(t.name) === e.name.slice(prefix.length));
    if (!tool) return { ...base, ok: false, status: 404, output: `no ${APP_ID} tool ${e.name}` };
    const p = isObj(e.params) ? e.params : {};
    const s = encodeURIComponent(str(p.slug) ?? 'kettle');
    switch (tool.name) {
      case 'wave.dispatch': {
        const w = str(p.wave);
        if (!w) return { ...base, ok: false, status: 400, output: 'wave.dispatch needs a wave id' };
        return { ...base, ...(await this.self('POST', `/api/products/${s}/waves/${encodeURIComponent(w)}/dispatch`, Array.isArray(p.packages) ? { packages: p.packages } : {})) };
      }
      case 'wave.compose': return { ...base, ...(await this.self('POST', `/api/products/${s}/waves`, { name: p.name, packages: p.packages })) };
      case 'scan.place': return { ...base, ...(await this.self('POST', `/api/products/${s}/scans`, { lens: p.lens, scope: p.scope })) };
      case 'finding.decline': {
        const id = str(p.id);
        if (!id) return { ...base, ok: false, status: 400, output: 'finding.decline needs a finding id' };
        return { ...base, ...(await this.self('POST', `/api/products/${s}/proposals/${encodeURIComponent(id)}`, { decision: 'decline', ...(str(p.note) ? { note: p.note } : {}) })) };
      }
      // navigate, lens.set and decision.answer have no handler on this server: the first two are the client's view, and the
      // swarm's questions are answered in the sim the client runs. Said so, never reported as done.
      default: return { ...base, ok: false, status: 501, output: `${tool.name} is not a server action` };
    }
  }

  /** One request to this server's own handler, in process, as the mount would make it. */
  private async self(method: 'POST', p: string, body: unknown): Promise<{ ok: boolean; status: number; output: unknown }> {
    const url = new URL(p, `http://${this.selfHost}`);
    // a param `.` or `..` (the model's) survives encodeURIComponent and the parser folds it into another route's path
    if (url.pathname !== p) return { ok: false, status: 400, output: `not a plain path: ${JSON.stringify(p)}` };
    let params: Record<string, string | string[]> | null = null;
    const route = this.routes.find((r) => (params = r.match(url.pathname)));
    const handler = route?.handlers[method];
    if (!route || !params || !handler) return { ok: false, status: 404, output: `no route ${method} ${url.pathname}` };
    const req = new Request(url, { method, headers: { host: this.selfHost, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    try {
      const r = await handler(req, { params: Promise.resolve(params) });
      const text = await r.text();
      let output: unknown = text;
      try { output = JSON.parse(text); } catch { /* text as it is */ }
      return { ok: r.ok, status: r.status, output };
    } catch (e) { return { ok: false, status: 500, output: `handler failed: ${(e as Error).message}` }; }
  }
}

/** The host's own routes, served under this mount (so its loopback-peer guard applies): GET /athena (what was registered)
 *  and POST /athena/decisions/[id] `{ choice: 'approve' | 'decline' }` (answer a card and run its execute). */
export function hostRoutes(host: AthenaHost): Route[] {
  const file = import.meta.filename;
  const status: Route = {
    path: '/athena', file, methods: ['GET'],
    handlers: {
      // the read guard every API GET runs: a DNS-rebound page comes from a loopback peer, so only its Host gives it away
      GET: (req) => {
        const denied = localHost(req);
        if (denied) return Response.json({ error: denied }, { status: 403 });
        return Response.json({ app_id: APP_ID, url: host.url, page_origin: host.pageOrigin, registered: host.registered, manifest: manifestBody(host.pageOrigin, host.tools) });
      },
    },
    match: (p) => (p === '/athena' ? {} : null),
  };
  const answer: Route = {
    path: '/athena/decisions/[id]', file, methods: ['POST'],
    handlers: {
      POST: async (req, ctx) => {
        const denied = localOnly(req) ?? jsonOnly(req);
        if (denied) return Response.json({ error: denied }, { status: denied.startsWith('body must') ? 415 : 403 });
        const { id } = (await ctx.params) as { id: string };
        let body: unknown;
        try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
        const choice = (body as { choice?: unknown } | null)?.choice;
        if (choice !== 'approve' && choice !== 'decline') return Response.json({ error: "body must be { choice: 'approve' | 'decline' }" }, { status: 400 });
        const a = await host.answer(id, choice);
        return Response.json(a, { status: a.ok ? 200 : a.status === 0 ? 502 : a.status });
      },
    },
    match: (p) => { const m = /^\/athena\/decisions\/([^/]+)$/.exec(p); return m ? { id: decodeURIComponent(m[1]) } : null; },
  };
  return [status, answer];
}
