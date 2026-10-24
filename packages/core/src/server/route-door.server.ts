// The route door: the one admission order every migrated API handler goes through (docs/blueprint-ui.md, "API").
// A route declares what it needs and the door runs, in this fixed order:
//   guard    the verb picks it, never the route: GET -> localHost, any other verb -> localOnly (403 `{ error }`)
//   json     a verb that declares a body -> jsonOnly (415) before anything reads it
//   product  findProduct, or Kettle's hosted sim when the verb declares `kettle`; neither -> unknownProduct (404, Kettle 405)
//   params   the route's own path-parameter check (its 400 / 404)
//   body     `req.json()` (400 "body must be JSON"), then the route's parse (a Response it returns is the refusal)
//   kettle   the sim answers through simAnswer: its value as JSON at the verb's status, a refusal as its own status + body
//   store    `store: 'required'` -> 404 "no scan store for <slug>" when the product has no scan.db
//   live     the handler; a throw out of `c.read(...)` is an unreadable store -> 503 "cannot read the scan store: ..."
// Route files keep `export async function VERB(req, ctx) { return <door>.VERB(req, ctx); }`, so the web mounts, the mount
// audit and apps/server's route table read the same methods; scripts/check-route-guards.mjs accepts exactly that form for a
// door handler, and scripts/check-route-door.ts walks DOORS (every door built, with its derived guard) against each route.
import { localHost, localOnly, jsonOnly } from '../scan/local-only.ts';
import type { ProductEntry } from '../scan/types.ts';
import type { ScanSim } from '../model/scan-sim.ts';
import { findProduct, hasStore, storeFile, unknownProduct } from './products.server.ts';
import { kettleSim, simAnswer } from './kettle-sim.server.ts';

if (typeof window !== 'undefined') throw new Error('route-door.server.ts is server-only');

export type Verb = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
/** Path params: the product slug, and any others the route's path names (wave, job, id, sha). */
export type Params = { slug: string } & Record<string, string>;
export interface RouteCtx { params: Promise<Params> }

/** What the sim and live handlers are given: the request, the path params and the parsed body. */
export interface DoorInput<B> { req: Request; slug: string; params: Params; body: B }
/** The live handler's view: the resolved product, and `read` for any store read whose throw means "unreadable" (503). */
export interface LiveInput<B> extends DoorInput<B> { product: ProductEntry; read<T>(fn: (file: string) => T): T }

export interface VerbSpec<B> {
  /** The route takes a JSON body: jsonOnly guards it and the door parses it. `true` passes the raw value on; a function
   *  returns the parsed body, or a Response that is the route's own refusal. */
  body?: true | ((raw: unknown) => B | Response);
  /** The path-parameter check, run after the product is resolved; a Response refuses. */
  params?: (p: Params) => Response | null;
  /** `required`: no scan.db -> 404 before the live handler runs. */
  store?: 'required';
  /** Kettle, where this process hosts its sim: the sim's answer (a value for simAnswer, or a Response as it is). */
  kettle?: (sim: ScanSim, c: DoorInput<B>) => unknown;
  /** The status a sim value answers with (default 200). */
  kettleStatus?: number;
  live: (c: LiveInput<B>) => Response | Promise<Response>;
}

/** One built door verb, as the registry keeps it: the guard and the stages are derived, never chosen by the route. */
export interface DoorRecord { route: string; verb: Verb; guard: 'localHost' | 'localOnly'; json: boolean; store: boolean; kettle: boolean }
/** Every door verb built in this process (one row per route and verb). */
export const DOORS: DoorRecord[] = [];

export const guardOf = (verb: Verb): DoorRecord['guard'] => (verb === 'GET' ? 'localHost' : 'localOnly');

/** The marker a `read` throw is rethrown as, so only a store read maps to 503. */
class StoreUnreadable extends Error {}

function simReply(run: () => unknown, status: number): Response {
  let direct: Response | null = null;
  const r = simAnswer(() => { const v = run(); if (v instanceof Response) { direct = v; return null; } return v; }, status);
  return direct ?? r;
}

type Handler = (req: Request, ctx: RouteCtx) => Promise<Response>;
type Door<S> = { [V in keyof S]-?: Handler };

/**
 * The per-verb handlers of one route. `route` is the handler path under packages/core/src/server/api (no `/route.ts`),
 * the registry's key. A verb's `body` is what its parse returned (the raw JSON for `body: true`, undefined with no body).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function door<S extends Partial<Record<Verb, VerbSpec<any>>>>(route: string, spec: S): Door<S> {
  const out = {} as Record<string, Handler>;
  for (const verb of Object.keys(spec) as Verb[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = spec[verb] as VerbSpec<any>;
    const guard = guardOf(verb);
    DOORS.push({ route, verb, guard, json: !!v.body, store: v.store === 'required', kettle: !!v.kettle });
    out[verb] = async (req, ctx) => {
      const denied = guard === 'localHost' ? localHost(req) : localOnly(req);
      if (denied) return Response.json({ error: denied }, { status: 403 });
      if (v.body) {
        const notJson = jsonOnly(req);
        if (notJson) return Response.json({ error: notJson }, { status: 415 });
      }
      const params = await ctx.params, slug = params.slug;
      const sim = v.kettle ? kettleSim(slug) : null, product = sim ? null : findProduct(slug);
      if (!sim && !product) return unknownProduct(slug);
      const bad = v.params?.(params);
      if (bad) return bad;
      let body: unknown;
      if (v.body) {
        let raw: unknown;
        try { raw = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
        body = v.body === true ? raw : v.body(raw);
        if (body instanceof Response) return body;
      }
      const input = { req, slug, params, body };
      if (sim) return simReply(() => v.kettle!(sim, input), v.kettleStatus ?? 200);
      const p = product!;
      if (v.store === 'required' && !hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
      const read = <T>(fn: (file: string) => T): T => {
        try { return fn(storeFile(p)); } catch (e) { throw new StoreUnreadable((e as Error).message); }
      };
      try { return await v.live({ ...input, product: p, read }); } catch (e) {
        if (e instanceof StoreUnreadable) return Response.json({ error: `cannot read the scan store: ${e.message}` }, { status: 503 });
        throw e;
      }
    };
  }
  return out as Door<S>;
}
