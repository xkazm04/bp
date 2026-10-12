import type { Feature } from '@/lib/data';
import { baseId, type Product } from './product';

/** Score tiers: exact slug or code, name prefix, word prefix, substring, id/code part, summary, place. A feature scores its best tier. */
const word = /[\s&\-/]+/;

function score(P: Product, f: Feature, q: string, ws: string[]): number {
  const n = f.name.toLowerCase(), id = f.id.toLowerCase(), code = (f.code || '').toLowerCase(), sum = f.summary.toLowerCase();
  const dom = P.D[f.domain].name.toLowerCase(), cap = P.C[f.capability].name.toLowerCase();
  let sc = 0;
  if (id === q || (code && code === q)) sc = 100;
  if (n.startsWith(q)) sc = Math.max(sc, 80);
  if (n.split(word).some((w) => w.startsWith(q))) sc = Math.max(sc, 60);
  if (n.includes(q)) sc = Math.max(sc, 50);
  if (id.includes(q) || code.includes(q)) sc = Math.max(sc, 45);
  if (sum.includes(q)) sc = Math.max(sc, 30);
  if (dom.includes(q) || cap.includes(q)) sc = Math.max(sc, 20);
  if (ws.length > 1) {
    if (ws.every((w) => n.includes(w))) sc = Math.max(sc, 48);
    else if (ws.every((w) => (n + ' ' + sum + ' ' + dom + ' ' + cap).includes(w))) sc = Math.max(sc, 25);
  }
  return sc;
}

/** Every match, best first: ties by name, then id. At ?scale>1 a source feature appears once: its best clone, the one in line `prefer` on a tie, else the first. */
export function searchAll(P: Product, raw: string, prefer?: number): Feature[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const ws = q.split(/\s+/), hits: [number, Feature][] = [];
  for (const f of P.features) { const sc = score(P, f, q, ws); if (sc) hits.push([sc, f]); }
  let out = hits;
  if (P.scale > 1) {
    const best = new Map<string, [number, Feature]>();
    for (const h of hits) {
      const k = baseId(h[1].id), cur = best.get(k);
      if (!cur || h[0] > cur[0] || (h[0] === cur[0] && prefer !== undefined && P.D[h[1].domain].bld === prefer && P.D[cur[1].domain].bld !== prefer)) best.set(k, h);
    }
    out = [...best.values()];
  }
  return out.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name) || (a[1].id < b[1].id ? -1 : 1)).map((x) => x[1]);
}

/** The first `limit` matches and how many there are in all. */
export function searchPage(P: Product, raw: string, limit = 8, prefer?: number): { hits: Feature[]; total: number } {
  const all = searchAll(P, raw, prefer);
  return { hits: all.slice(0, limit), total: all.length };
}

/** Ranked feature search (the first `limit` of `searchAll`). */
export function search(P: Product, raw: string, limit = 8, prefer?: number): Feature[] {
  return searchAll(P, raw, prefer).slice(0, limit);
}
