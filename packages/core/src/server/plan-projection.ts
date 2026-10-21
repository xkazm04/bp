// The derived plan as a flat, serializable projection (GET /api/products/[slug]/plan, schema plan-1). The layout is
// core's (model/layout) and every health reading is the loader's (standard/load), so the web, the server and the VR
// client read one answer. Layout nodes point back to their parents, so the projection carries ids, never references.
// Pure: no React, DOM or Next.
import { loadStructure } from '@bp/core/standard/load';
import { layoutProduct } from '@bp/core/model/layout';
import { buildProduct } from '@bp/core/model/product';

export interface PlanBox { x: number; y: number; w: number; h: number }
interface PlanNode { id: string; name: string; order: number; box: PlanBox }
export interface PlanWing extends PlanNode { /** The wing's letter in chronological order (A, B, ...). */ letter: string }
export interface PlanRoom extends PlanNode { parentId: string }
export interface PlanBay extends PlanNode { parentId: string }
export interface PlanTile extends PlanNode {
  parentId: string;
  /** Each enabled lens's reading, by lens id. */
  health: Record<string, string>;
  /** General health: worst of the enabled lenses. */
  general: string;
}
export interface Plan {
  rev: string;
  /** The enabled lens ids, in registry order: the keys of every tile's `health`. */
  lenses: string[];
  wings: PlanWing[];
  rooms: PlanRoom[];
  bays: PlanBay[];
  tiles: PlanTile[];
}

const box = (n: PlanBox): PlanBox => ({ x: n.x, y: n.y, w: n.w, h: n.h });

/** The plan of one map (the standard's v3/v2 document) and its events log: one product line, the map's own lens toggle. */
export function projectPlan(raw: unknown, eventsText: string | null, rev: string): Plan {
  const S = loadStructure(raw, eventsText);
  const L = layoutProduct(buildProduct(S, 1));
  const lenses = S.lenses.map((d) => d.id);
  return {
    rev, lenses,
    wings: L.wings.map((w, order) => ({ id: w.id, name: w.def.name, order, box: box(w), letter: w.def.letter })),
    rooms: L.rooms.map((r) => ({ id: r.id, parentId: r.wing.id, name: r.d.name, order: r.wing.rooms.indexOf(r), box: box(r) })),
    bays: L.bays.map((b) => ({ id: b.id, parentId: b.room.id, name: b.cap.name, order: b.room.bays.indexOf(b), box: box(b) })),
    tiles: L.tiles.map((t) => ({
      id: t.id, parentId: t.bay.id, name: t.f.name, order: t.bi, box: box(t),
      health: Object.fromEntries(lenses.map((id) => [id, t.f.lens[id]?.h ?? 'unmeasured'])), general: t.f.health,
    })),
  };
}
