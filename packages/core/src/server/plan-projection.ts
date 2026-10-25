// The derived plan as a flat, serializable projection (GET /api/products/[slug]/plan, schema plan-1). The layout is
// core's (model/layout) and every health reading is the loader's (standard/load), so the web, the server and the VR
// client read one answer. Layout nodes point back to their parents, so the projection carries ids, never references.
// Pure: no React, DOM or Next.
import { loadStructure } from '@bp/core/standard/load';
import { layoutProduct } from '@bp/core/model/layout';
import { buildProduct } from '@bp/core/model/product';
import type { Health } from '@bp/core/standard/types';

export interface PlanBox { x: number; y: number; w: number; h: number }
interface PlanNode { id: string; name: string; order: number; box: PlanBox }
export interface PlanWing extends PlanNode { /** The wing's letter in chronological order (A, B, ...). */ letter: string }
export interface PlanRoom extends PlanNode { parentId: string }
export interface PlanBay extends PlanNode { parentId: string }
export interface PlanTile extends PlanNode {
  parentId: string;
  /** Each enabled lens's reading, by lens id. */
  health: Record<string, Health>;
  /** General health: worst of the enabled lenses. */
  general: Health;
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

/** The islands view's gap between neighbouring wings, in plan units: about one tile width (layout's TW). */
export const WING_GAP = 160;
/** The islands view's gap between neighbouring rooms of one wing, in plan units. */
export const ROOM_GAP = 40;

/**
 * The plan of one map (the standard's v3/v2 document) and its events log: one product line, the map's own lens toggle.
 * `islands` (VR's `?layout=islands`) answers the same plan with space between wings and between the rooms of a wing;
 * without it the boxes are the layout's own, edge to edge, as the web canvas draws them.
 */
export function projectPlan(raw: unknown, eventsText: string | null, rev: string, opts: { islands?: boolean } = {}): Plan {
  const S = loadStructure(raw, eventsText);
  const L = layoutProduct(buildProduct(S, 1));
  const lenses = S.lenses.map((d) => d.id);
  const plan: Plan = {
    rev, lenses,
    wings: L.wings.map((w, order) => ({ id: w.id, name: w.def.name, order, box: box(w), letter: w.def.letter })),
    rooms: L.rooms.map((r) => ({ id: r.id, parentId: r.wing.id, name: r.name, order: r.wing.rooms.indexOf(r), box: box(r) })),
    bays: L.bays.map((b) => ({ id: b.id, parentId: b.room.id, name: b.name, order: b.room.bays.indexOf(b), box: box(b) })),
    tiles: L.tiles.map((t) => ({
      id: t.id, parentId: t.bay.id, name: t.f.name, order: t.bi, box: box(t),
      health: Object.fromEntries(lenses.map((id) => [id, t.f.lens[id]?.h ?? 'unmeasured'])), general: t.f.health,
    })),
  };
  return opts.islands ? islands(plan) : plan;
}

/**
 * The plan pulled apart into islands: wing i (by order) moves right by i * WING_GAP; inside its wing, room j (by order)
 * moves down by j * ROOM_GAP, layout's stacking axis, and the wing grows by the gaps between its rooms. Bays and tiles
 * move with their room, so every box still contains its children. Shifts only: no size but the wings' heights changes.
 */
function islands(p: Plan): Plan {
  const at = (b: PlanBox, dx: number, dy: number): PlanBox => ({ ...b, x: b.x + dx, y: b.y + dy });
  const wingDx = new Map(p.wings.map((w) => [w.id, w.order * WING_GAP]));
  const roomAt = new Map(p.rooms.map((r) => [r.id, { dx: wingDx.get(r.parentId) ?? 0, dy: r.order * ROOM_GAP }]));
  const bayAt = new Map(p.bays.map((b) => [b.id, roomAt.get(b.parentId) ?? { dx: 0, dy: 0 }]));
  const move = <T extends PlanRoom | PlanBay | PlanTile>(n: T, s: { dx: number; dy: number } | undefined): T => ({ ...n, box: at(n.box, s?.dx ?? 0, s?.dy ?? 0) });
  return {
    ...p,
    wings: p.wings.map((w) => {
      const rooms = p.rooms.filter((r) => r.parentId === w.id).length;
      return { ...w, box: { ...at(w.box, wingDx.get(w.id) ?? 0, 0), h: w.box.h + Math.max(0, rooms - 1) * ROOM_GAP } };
    }),
    rooms: p.rooms.map((r) => move(r, roomAt.get(r.id))),
    bays: p.bays.map((b) => move(b, bayAt.get(b.id))),
    tiles: p.tiles.map((t) => move(t, bayAt.get(t.parentId))),
  };
}
