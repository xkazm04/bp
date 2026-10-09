import type { Feature } from '@/lib/data';
import type { Product } from './product';

/** Ranked feature search: exact id, name prefix, word prefix, substring, summary, place. */
export function search(P: Product, raw: string, limit = 8): Feature[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const out: [number, Feature][] = [];
  const ws = q.split(/\s+/);
  for (const f of P.features) {
    const n = f.name.toLowerCase();
    let sc = 0;
    if (f.id.toLowerCase() === q) sc = 100;
    else if (n.startsWith(q)) sc = 80;
    else if (n.split(/[\s&\-/]+/).some((w) => w.startsWith(q))) sc = 60;
    else if (n.includes(q)) sc = 50;
    else if (f.id.toLowerCase().includes(q)) sc = 45;
    else if (f.summary.toLowerCase().includes(q)) sc = 30;
    else if (P.D[f.domain].name.toLowerCase().includes(q) || P.C[f.capability].name.toLowerCase().includes(q)) sc = 20;
    else if (ws.length > 1 && ws.every((w) => (n + ' ' + f.summary.toLowerCase()).includes(w))) sc = 25;
    if (sc) out.push([sc, f]);
  }
  out.sort((a, b) => b[0] - a[0] || (a[1].id < b[1].id ? -1 : 1));
  return out.slice(0, limit).map((x) => x[1]);
}
