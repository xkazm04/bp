// The lens-expression contract. A variant (src/variants/<id>/) implements `LensExpression`; the engine
// owns everything else (geometry, stage fills, the mix, text layout, culling, caching).
//
// The model: the view is a MIX of weights, General plus one per enabled lens (the registry: the map's
// `lenses[]` where `enabled` is true, in file order), each 0..1. Lens ids are plain strings.
//   General          general = 1, every lens = 1 -> all N channels drawn compact, side by side
//   Lens "security"  general = 0, security = 1, others = 0 -> only security remains, expanded
// Switching springs the weights; the other channels collapse while the chosen one grows into the
// space they leave. Lens -> lens passes through the shared base (see mix.ts for the derived values).
//
// The one hard rule: a tile's base fill is its lifecycle stage and the engine draws it. A lens never
// recolours a node. It speaks through shape, indicators, content, density, and (only in variants that
// go that far) a secondary accent and decoration.
import type { Feature, LensDef, Scalar, Stage } from '@/lib/data';
import type { Theme } from '../theme';

export type Density = 'simple' | 'standard' | 'dense';
export interface Rect { x: number; y: number; w: number; h: number }

/** A feature as the engine is about to draw it, in screen px. */
export interface TileGeom extends Rect {
  /** 'ribbon' = one segment of a bay strip (L0/L1), 'tile' = a full fixture (L2+). */
  form: 'ribbon' | 'tile';
  /** UI scale (1 at 1280x800, up to 1.5 on large screens). Multiply your px sizes by it. */
  u: number;
  /** Camera zoom (screen px per world unit). */
  k: number;
  /**
   * Tile anatomy (screen px). `strip` is the band along the top edge reserved for General's compact
   * indicators; `body` is the inset interior, the default rect a lone lens grows into. The engine
   * draws text in fixed rows: header (id left, evidence right) at strip bottom + ~12px, the name
   * below it, the stamp at the foot, agent chips over the foot.
   */
  strip: Rect;
  body: Rect;
  /** True when the engine will print id, evidence and name on this tile. */
  text: boolean;
}

/** What a channel is asked to draw. All geometry is screen px. */
export interface MarkArgs {
  ctx: CanvasRenderingContext2D;
  /** The rect this channel owns right now: its General slot, its expanded rect, or a blend. */
  r: Rect;
  /** Its General slot on this tile (from composeGeneral), or null when the tile has none for it. */
  slot: Rect | null;
  /** The lens (its manifest and what was resolved from it at load). */
  lens: LensDef;
  tile: TileGeom;
  f: Feature;
  /** Presence 0..1: multiply your alpha by it (General = 1 for every lens; a lens = 1 for itself). */
  w: number;
  /** Expansion 0..1: 0 = compact General form, 1 = this lens alone. */
  x: number;
  /** Convenience: x < 0.5. */
  compact: boolean;
  th: Theme;
  /** Stage at the viewed date (null = not on the drawing yet). */
  stage: Stage | null;
  /** True when the view is "now" (time travel shows stage only). */
  now: boolean;
  /** Live values that move with the simulation. */
  live: FeatureLive;
  /** The channel's accent resolved for the current theme (falls back to ink). */
  accent: string;
}

export interface FeatureLive {
  rolloutPct: number;
  progressPct: number;
  /** A lens field's value now: the simulation's live value for the few fields it moves, else the map's. */
  value(lens: string, key: string): Scalar | undefined;
}

export interface ChannelContent {
  /** Evidence line on the tile, right-aligned in its header (mono). Parts are dropped from the end to fit. */
  parts: string[];
  /** Optional stamp near the tile's foot (a warning in plain words). */
  stamp?: string;
}
export interface ChannelAggregate {
  /** What a room / wing / building says under this lens. Parts are dropped from the end to fit. */
  parts: string[];
  /** Optional "N in trouble"-style count for the label's right side. */
  trouble?: number;
}

export interface Viewport { x: number; y: number; w: number; h: number; k: number; u: number }

export interface LensChannel {
  /** Who reads this lens: design is simple, development is dense. The UI also consults it. */
  density: Density;
  /** Optional secondary colour for this lens's marks, per theme. Omit for ink only. */
  accent?: { dark: string; light: string };
  /** Tile outline for this lens, blended from the base rectangle by w (0..1). Add sub-paths to `p`. */
  shape?(p: Path2D, tile: TileGeom, f: Feature, w: number): void;
  /** Indicators inside `a.r`. Called compact in General and expanded when the lens stands alone. */
  marks(a: MarkArgs): void;
  /** What a tile says under this lens. */
  content(f: Feature, live: FeatureLive): ChannelContent;
  /** What a place (room, wing, building) says under this lens. */
  aggregate(fs: readonly Feature[]): ChannelAggregate;
  /** Optional decoration drawn under the plan, in screen space (bold variant). w = this lens's weight. */
  decor?(ctx: CanvasRenderingContext2D, view: Viewport, w: number, th: Theme): void;
}

export interface LensExpression {
  id: string;
  name: string;
  /** Channels the variant draws itself, by lens id. Lenses without one use `fallback`. */
  channels: Readonly<Record<string, LensChannel>>;
  /**
   * The channel for any lens the variant has no own channel for, built from the lens manifest alone
   * (glyph, line, measures, evidence). The subtle variant draws every lens this way; the shaped and bold
   * variants use it for lenses other than the six built-ins. Called once per lens and cached.
   */
  fallback?(lens: LensDef): LensChannel;
  /**
   * How the channels share a tile in General. `lenses` is the registry order (General's composition).
   * Return a rect per lens id (screen px) for the compact marks; omit a lens (or return {}) when the
   * tile is too small to show it. May return a reused object: the engine reads it immediately.
   */
  composeGeneral(tile: TileGeom, lenses: readonly string[]): Readonly<Record<string, Rect>>;
  /** The rect a lone lens grows into. Default: the tile body inset by 3 px. */
  expandedRect?(tile: TileGeom, lens: string): Rect;
  /** Spring for the lens tween (motion `animate`). Default stiffness 170, damping 26. */
  spring?: { stiffness: number; damping: number };
  /** Optional font for tile evidence text under a lens. Default mono. */
  evidenceFont?(lens: string): 'sans' | 'mono';
}
