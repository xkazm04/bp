// The client side of the project registry: the list (`GET /api/products`, with readiness) in a tiny
// external store, and the writes (`POST /api/products`, `PATCH|DELETE /api/products/<slug>`). The header's
// project switcher and the manage dialog read it; nothing here touches the engine or the canvas.
import { useSyncExternalStore } from 'react';
import type { ProductInfo } from './types';

export interface ProjectsState { list: ProductInfo[] | null; loading: boolean; error: string | null }

let state: ProjectsState = { list: null, loading: false, error: null };
const subs = new Set<() => void>();
const put = (p: Partial<ProjectsState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => state;

let inflight: Promise<ProductInfo[] | null> | null = null;
/** Re-reads the list (the registry and the repos change outside the app). Concurrent calls share one request. */
export function refreshProjects(): Promise<ProductInfo[] | null> {
  if (inflight) return inflight;
  put({ loading: true });
  inflight = (async () => {
    try {
      const r = await fetch('/api/products', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = (await r.json()) as ProductInfo[];
      put({ list, loading: false, error: null });
      return list;
    } catch (e) {
      put({ loading: false, error: 'Could not read the project list: ' + (e as Error).message });
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useProjects(): ProjectsState {
  return useSyncExternalStore(subscribe, get, get);
}

async function write(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<void> {
  const r = await fetch(url, {
    method, cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error || 'HTTP ' + r.status);
  }
  await refreshProjects();
}

const one = (slug: string) => '/api/products/' + encodeURIComponent(slug);
export const addProject = (p: { slug: string; name: string; root: string }) => write('/api/products', 'POST', p);
export const patchProject = (slug: string, p: { name?: string; root?: string }) => write(one(slug), 'PATCH', p);
/** Unregisters only: the repo and its `.ai/lens-scan/` stay on disk. */
export const removeProject = (slug: string) => write(one(slug), 'DELETE');

/** The current URL with `?product` set to `slug` (null = the Kettle sample), keeping the route and every other parameter. */
export function projectHref(slug: string | null): string {
  const u = new URL(location.href);
  if (slug) u.searchParams.set('product', slug); else u.searchParams.delete('product');
  u.hash = ''; // the hash names places in the previous product's plan
  return u.pathname + u.search;
}
