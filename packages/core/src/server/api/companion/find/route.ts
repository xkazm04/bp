// GET /api/companion/find?product=<slug>&q=<words>&limit=20: the places of a product's plan whose name matches `q` - wings,
// rooms, bays and features, each `{ kind, id, name, parent? }` - so the companion can aim focus.show at a real id instead of
// guessing one (the spark's end-to-end run: asked to show a room by name, it had no way to learn the room's id and refused).
// Every word of `q` must appear in the name (case-insensitive); an exact name ranks first, then wings > rooms > bays >
// features, then plan order. No `q`: the wings and rooms, the plan's table of contents. Answers `{ matches, total }`.
// The plan comes from the plan route itself (its Kettle sample and live-product reads, its 404s), never a second loader.
import { localHost } from '@bp/core/scan/local-only';
import { GET as planGET } from '../../products/[slug]/plan/route.ts';
import type { Plan } from '@bp/core/server/plan-projection';

export type PlaceKind = 'wing' | 'room' | 'bay' | 'feature';
export interface Place { kind: PlaceKind; id: string; name: string; parent?: string }

const RANK: Record<PlaceKind, number> = { wing: 0, room: 1, bay: 2, feature: 3 };
export const FIND_MAX = 50;

/** The matching places of a plan, ranked (exported for the door check). */
export function findPlaces(plan: Pick<Plan, 'wings' | 'rooms' | 'bays' | 'tiles'>, q: string): Place[] {
  const names = new Map<string, string>();
  for (const n of [...plan.wings, ...plan.rooms, ...plan.bays]) names.set(n.id, n.name);
  const all: (Place & { order: number })[] = [
    ...plan.wings.map((n) => ({ kind: 'wing' as const, id: n.id, name: n.name, order: n.order })),
    ...plan.rooms.map((n) => ({ kind: 'room' as const, id: n.id, name: n.name, parent: names.get(n.parentId), order: n.order })),
    ...plan.bays.map((n) => ({ kind: 'bay' as const, id: n.id, name: n.name, parent: names.get(n.parentId), order: n.order })),
    ...plan.tiles.map((n) => ({ kind: 'feature' as const, id: n.id, name: n.name, parent: names.get(n.parentId), order: n.order })),
  ];
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hits = words.length
    ? all.filter((p) => { const n = p.name.toLowerCase(); return words.every((w) => n.includes(w)); })
    : all.filter((p) => p.kind === 'wing' || p.kind === 'room');
  const exact = (p: Place) => (p.name.toLowerCase() === q.trim().toLowerCase() ? 0 : 1);
  hits.sort((a, b) => exact(a) - exact(b) || RANK[a.kind] - RANK[b.kind] || a.order - b.order);
  return hits.map(({ order: _o, ...p }) => (p.parent === undefined ? { kind: p.kind, id: p.id, name: p.name } : p));
}

export async function GET(req: Request): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const u = new URL(req.url);
  const product = u.searchParams.get('product') ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(product)) return Response.json({ error: 'product must be a product slug' }, { status: 400 });
  const limit = Math.min(FIND_MAX, Math.max(1, Number(u.searchParams.get('limit')) || 20));
  const res = await planGET(new Request(new URL(`/api/products/${product}/plan`, u), { headers: req.headers }), { params: Promise.resolve({ slug: product }) });
  if (!res.ok) return res;
  const matches = findPlaces((await res.json()) as Plan, u.searchParams.get('q') ?? '');
  return Response.json({ matches: matches.slice(0, limit), total: matches.length });
}
