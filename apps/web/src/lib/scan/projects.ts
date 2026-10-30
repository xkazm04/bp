// The client side of the project registry: the list (`GET /api/products`, with readiness) in a tiny
// external store, and the writes (`POST /api/products`, `PATCH|DELETE /api/products/<slug>`). The header's
// project switcher and the manage dialog read it; nothing here touches the engine or the canvas.
import { useSyncExternalStore } from 'react';
import type { ProductInfo } from '@bp/core/scan/types';
import { REQUEST_TIMEOUT_MS } from './client.ts';
import { causeWords } from './refusal.ts';

/** `stale`: the open product was removed or got a new root; the running page still shows the old one until it reloads. */
export type Stale = 'removed' | 'root' | null;
export interface ProjectsState { list: ProductInfo[] | null; loading: boolean; error: string | null; stale: Stale }

let state: ProjectsState = { list: null, loading: false, error: null, stale: null };
const subs = new Set<() => void>();
const put = (p: Partial<ProjectsState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => state;

let inflight: Promise<ProductInfo[] | null> | null = null;
let seq = 0;
/**
 * Re-reads the list (the registry and the repos change outside the app). Concurrent plain calls share one
 * request; `fresh` (after a write) always issues its own, since a request already in flight may have been
 * answered from before the write. Only the newest request's answer is kept.
 */
export function refreshProjects(fresh = false): Promise<ProductInfo[] | null> {
  if (inflight && !fresh) return inflight;
  const my = ++seq;
  put({ loading: true });
  let p!: Promise<ProductInfo[] | null>;
  p = (async () => {
    try {
      const r = await fetch('/api/products', { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = (await r.json()) as ProductInfo[];
      if (my === seq) put({ list, loading: false, error: null });
      return list;
    } catch (e) {
      if (my === seq) put({ loading: false, error: 'Could not read the project list: ' + causeWords(e) });
      return null;
    } finally {
      if (inflight === p) inflight = null;
    }
  })();
  inflight = p;
  return p;
}

/**
 * Whether the registry says `slug` has a scan store: true/false when the list answered, `undefined` when it did not
 * (`refreshProjects` answers null on any failure, a timeout included). A list that failed to answer says nothing about
 * the product, so it must never read as "no store".
 */
export const storeFromList = (list: ProductInfo[] | null, slug: string): boolean | undefined => (list === null ? undefined : !!list.find((p) => p.slug === slug)?.live);
/** The header status for a store verdict: `loading` while it is unknown, `live` with a store, `missing` for a product that has none. */
export const statusOfStore = (hasStore: boolean | undefined): 'loading' | 'live' | 'missing' => (hasStore === undefined ? 'loading' : hasStore ? 'live' : 'missing');

/** Note that the open product's registry entry changed under the running page (shown with a Reload action). */
export function markStale(s: Stale) { put({ stale: s }); }

export function useProjects(): ProjectsState {
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * The one name for a product everywhere in the chrome: the registry's (what the person typed and the project
 * list shows) when the product is registered, else `fallback` (the map's own name for the header, the slug
 * while the list loads). Kettle has no entry and keeps its map name.
 */
export function useProductName(slug: string | null, fallback: string): string {
  const { list } = useProjects();
  return (slug && list?.find((p) => p.slug === slug)?.name) || fallback;
}

async function write(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<void> {
  const r = await fetch(url, {
    method, cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    throw Object.assign(new Error(j?.error || 'HTTP ' + r.status), { status: r.status });
  }
  await refreshProjects(true);
}

const one = (slug: string) => '/api/products/' + encodeURIComponent(slug);
export const addProject = (p: { slug: string; name: string; root: string }) => write('/api/products', 'POST', p);
export const patchProject = (slug: string, p: { name?: string; root?: string }) => write(one(slug), 'PATCH', p);
/** Unregisters only: the repo and its `.ai/lens-scan/` stay on disk. */
export const removeProject = (slug: string) => write(one(slug), 'DELETE');

/** Open another product in place, without a reload: the page pushes the URL (projectHref's, plus `params`) and BlueprintApp
 *  swaps the product, so the engine rebuilds while the tab, its stream connections and its shared-focus reader stay. */
export const SWITCH_EVENT = 'bp:switch-product';
export function switchProduct(slug: string | null, params: Record<string, string> = {}): void {
  const u = new URL(projectHref(slug), location.origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  try { history.pushState(null, '', u.pathname + u.search); } catch { location.assign(u.pathname + u.search); return; }
  dispatchEvent(new CustomEvent(SWITCH_EVENT, { detail: { slug } }));
}

/** The current URL with `?product` set to `slug` (null = the Kettle sample), keeping the route and every other parameter. */
export function projectHref(slug: string | null): string {
  const u = new URL(location.href);
  if (slug) u.searchParams.set('product', slug); else u.searchParams.delete('product');
  u.hash = ''; // the hash names places in the previous product's plan
  u.searchParams.delete('morning'); // the deck's card belongs to the page that showed it (switchProduct sets its own)
  return u.pathname + u.search;
}
