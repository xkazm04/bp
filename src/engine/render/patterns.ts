// Body textures of the lens views (docs/blueprint-ui.md, "Lens fill and unknowns"): a lens's own line type
// laid as a fill across the fixture up to its measure, and the "?" over a feature no scan has measured yet.
// Both are ink only, faint enough that the tile's text reads over them in either theme. A pattern is built
// once per (theme, motif, device resolution, size bucket) and kept; a tile asks for one by number, so the
// per-tile path allocates nothing. Patterns are anchored to the rect they fill (the fill starts with a
// whole motif at the tile's left edge), not to the world like the theme's stage hatches.
import type { LineName } from '@/lib/standard/types';
import type { Theme } from '../theme';

/** Fill ink: a pattern at this alpha keeps 14 px text above it readable in both themes. */
export const FILL_A = 0.26;
/** The "?" texture's ink. A lone centred "?" (tile too small for the texture) gets more, so one glyph still reads. */
const Q_A = 0.18, Q_ONE_A = 0.34;

const LINE_NO: Record<LineName, number> = { solid: 1, double: 2, dotted: 3, comb: 4, chain: 5, hatched: 6, dimension: 7 };
const Q_NO = 9;
/** Per motif, so every lens's fill reads about equally dark: the sparse ones (dots, chain) carry more ink. */
const WEIGHT: Record<LineName, number> = { solid: 1, double: 0.9, dotted: 1.5, comb: 1, chain: 1.3, hatched: 0.9, dimension: 1.1 };

interface Per { res: number; pats: Map<number, CanvasPattern | null>; font: Map<number, string> }
// keyed by the theme object: a theme is rebuilt on every resolution, font or colour change, so its device
// resolution is fixed for its life, and the patterns die with it (the legend's own themes get their own)
const PER = new WeakMap<Theme, Per>();
function per(ctx: CanvasRenderingContext2D, th: Theme): Per {
  let p = PER.get(th);
  if (!p) {
    // once per theme: the drawing context's scale is the device resolution the bitmaps are built for
    const m = ctx.getTransform(), r = Math.hypot(m.a, m.b);
    p = { res: Math.min(4, Math.max(1, Math.round(r * 4) / 4 || 1)), pats: new Map(), font: new Map() };
    PER.set(th, p);
  }
  return p;
}

/** Size bucket from the UI scale: 4..8 (u 1..2 in quarter steps). */
const bucket = (u: number) => Math.min(8, Math.max(4, Math.round(u * 4)));
/** On-screen "?" size: never under the 12 px floor, 13 px at u = 1. */
const qSize = (u: number) => Math.max(12, Math.round(13 * u));
/** One cell of the "?" texture: two glyphs, staggered. */
const qW = (gs: number) => Math.round(gs * 2.6), qH = (gs: number) => Math.round(gs * 2.3);

function build(th: Theme, P: Per, no: number, sz: number): CanvasPattern | null {
  if (typeof document === 'undefined') return null;
  const s = sz / 4;
  let cw: number, ch: number;
  switch (no) {
    case 1: cw = 4; ch = Math.round(6 * s); break;                                  // solid: ruled lines
    case 2: cw = 4; ch = Math.round(10 * s); break;                                 // double: paired rules
    case 3: cw = ch = Math.round(6 * s); break;                                     // dotted: a dot grid
    case 4: cw = Math.round(5 * s); ch = Math.round(9 * s); break;                  // comb: ticks on a base
    case 5: cw = Math.round(15 * s); ch = Math.round(8 * s); break;                 // chain: dash, dot
    case 6: cw = ch = Math.round(6 * s); break;                                     // hatched: back diagonals
    case 7: cw = Math.round(14 * s); ch = Math.round(9 * s); break;                 // dimension: rule with end ticks
    default: cw = qW(sz); ch = qH(sz);                                              // "?" (sz = glyph px)
  }
  const r = P.res, c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * r)); c.height = Math.max(1, Math.round(ch * r));
  const g = c.getContext('2d')!;
  g.scale(c.width / cw, c.height / ch);
  g.fillStyle = th.ink; g.strokeStyle = th.ink; g.lineWidth = 1;
  switch (no) {
    case 1: g.fillRect(0, 0, cw, 1); break;
    case 2: g.fillRect(0, 0, cw, 1); g.fillRect(0, Math.max(2, Math.round(2.5 * s)), cw, 1); break;
    case 3: g.beginPath(); g.arc(cw / 2, ch / 2, 1.1 * s, 0, 6.2832); g.fill(); break;
    case 4: { const t = Math.round(ch * 0.45); g.fillRect(0, ch - 1, cw, 1); g.fillRect(0, t, 1, ch - t); break; }
    case 5: { const y = Math.round(ch / 2); g.fillRect(0, y, Math.round(8 * s), 1); g.fillRect(Math.round(10.5 * s), y, Math.max(1.5, Math.round(1.6 * s)), 1); break; }
    case 6: g.beginPath(); g.moveTo(0, 0); g.lineTo(cw, ch); g.moveTo(-1, ch - 1); g.lineTo(1, ch + 1); g.moveTo(cw - 1, -1); g.lineTo(cw + 1, 1); g.stroke(); break;
    case 7: { const y = Math.round(ch / 2), t = Math.round(2.5 * s); g.fillRect(0, y, cw, 1); g.fillRect(0, y - t, 1, 2 * t + 1); break; }
    default: {
      // two staggered glyphs per cell (a brick bond), so the texture never lines up into stripes
      g.font = '600 ' + sz + 'px ' + th.sans; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('?', cw * 0.25, ch * 0.27); g.fillText('?', cw * 0.75, ch * 0.77);
    }
  }
  const p = g.createPattern(c, 'repeat');
  if (p) p.setTransform?.(new DOMMatrix([cw / c.width, 0, 0, ch / c.height, 0, 0]));
  return p;
}

function pattern(ctx: CanvasRenderingContext2D, th: Theme, no: number, sz: number): CanvasPattern | null {
  const P = per(ctx, th), k = no * 1000 + sz;
  let p = P.pats.get(k);
  if (p === undefined) { p = build(th, P, no, sz); P.pats.set(k, p); }
  return p;
}

/** Fill a rect with a cached pattern whose first motif starts at the rect's top-left corner (snapped to a device pixel). */
function lay(ctx: CanvasRenderingContext2D, P: Per, p: CanvasPattern, x: number, y: number, w: number, h: number) {
  const r = P.res, tx = Math.round(x * r) / r, ty = Math.round(y * r) / r;
  ctx.translate(tx, ty);
  ctx.fillStyle = p; ctx.fillRect(x - tx, y - ty, w, h);
  ctx.translate(-tx, -ty);
}

/**
 * A lens's line type as a fill over (x, y, w, h): how far its measure goes, readable at a glance where a
 * thin rail is not. `alpha` is the composed alpha of the caller (tile alpha x lens weight); the fill's own
 * faintness is applied here. No allocation unless this motif was never built for this theme.
 */
export function lineFill(ctx: CanvasRenderingContext2D, th: Theme, line: LineName, x: number, y: number, w: number, h: number, u: number, alpha: number) {
  if (w < 0.5 || h < 1 || alpha <= 0.004) return;
  const p = pattern(ctx, th, LINE_NO[line], bucket(u)); if (!p) return;
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = Math.min(1, alpha * FILL_A * WEIGHT[line]);
  lay(ctx, PER.get(th)!, p, x, y, w, h);
  ctx.globalAlpha = ga;
}

/**
 * "Not scanned yet" over (x, y, w, h): a texture of "?" glyphs, each at least 12 px on screen. A rect too
 * small for one cell of the texture gets a single centred "?" instead; one too small for a 12 px glyph gets
 * nothing (the evidence line and the card still say NOT MEASURED).
 */
export function unknownFill(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, w: number, h: number, u: number, alpha: number) {
  if (alpha <= 0.004) return;
  const gs = qSize(u), ga = ctx.globalAlpha;
  if (w >= qW(gs) && h >= qH(gs) * 0.6) {
    const p = pattern(ctx, th, Q_NO, gs); if (!p) return;
    ctx.globalAlpha = Math.min(1, alpha * Q_A);
    lay(ctx, PER.get(th)!, p, x, y, w, h);
  } else if (w >= gs * 0.8 && h >= gs + 2) {
    const P = per(ctx, th);
    let f = P.font.get(gs);
    if (!f) { f = '600 ' + gs + 'px ' + th.sans; P.font.set(gs, f); }
    ctx.globalAlpha = Math.min(1, alpha * Q_ONE_A);
    ctx.font = f; ctx.fillStyle = th.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', x + w / 2, y + h / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  ctx.globalAlpha = ga;
}
