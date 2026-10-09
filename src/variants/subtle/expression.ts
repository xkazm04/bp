// Variant 1, "subtle: patterns", driven by the lens manifests. Every tile keeps its rectangle and its
// stage fill; a lens is a glyph and a line type, both named by its manifest (`presentation.glyph`,
// `presentation.line`). In General one slot per enabled lens sits along a fixture's top edge, in
// registry order, each with a short rail in its lens's line type measuring `presentation.measures`
// (the composition of all lenses). Choosing a lens lifts the others off the drawing (they fade,
// shrink and rise a hair) while the chosen glyph slides to the head of the strip and its rail runs the
// full width: the tile's evidence line. On the site plan (ribbons) a lens draws its rail along each
// segment's foot and its glyph where that lens is unwell. Nothing here knows a lens id: any lens in
// the map, built-in or custom, is drawn from its manifest alone.
//
// The N-slot rule (General strip). The strip is the six-slot grid it always was: a fixture gets a strip
// when a slot of the six-slot grid, (strip - 5 gaps) / 6, is at least 10u wide. With up to six lenses
// every slot keeps that size and the slots sit left-aligned in registry order. With more than six, the
// slots shrink to share the strip: (strip - (N - 1) gaps) / N. A slot at least 10u wide shows glyph and
// rail; a narrower one shows the glyph only (down to 6 px). The strip never wraps (wrapping would cover
// the id row); the lens tabs and keys reach every lens.
import type { LensDef } from '@/lib/data';
import type { LensField } from '@/lib/standard/types';
import { lensLine } from '@/lib/standard/present';
import { lensAggregate, lensContent } from '@/lib/model/lens';
import type { FeatureLive, LensChannel, LensExpression, MarkArgs, Rect, TileGeom } from '../types';
import { glyph, healthInk, lineType, railRest } from './marks';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------------------------------ layout
/** Height of the indicator band along a fixture's top edge (General slots and the lone lens's rail). */
const bandH = (t: TileGeom) => Math.min(t.strip.h + 2 * t.u, 9 * t.u);
/** Top of that band: a hair above the strip, clear of the id/evidence row the engine prints below. */
const bandY = (t: TileGeom) => t.strip.y - t.u;
const GAP = 3;
const SIX = 6;
/** The six-slot width: the slot size every lens keeps while there are at most six. */
const sixW = (t: TileGeom) => (t.strip.w - (SIX - 1) * GAP * t.u) / SIX;
/** Slot width for n lenses (the N-slot rule above). */
const slotW = (t: TileGeom, n: number) => (n <= SIX ? sixW(t) : (t.strip.w - (n - 1) * GAP * t.u) / n);
const hasStrip = (t: TileGeom) => t.form === 'tile' && sixW(t) >= 10 * t.u;
/** Foot band of a ribbon segment (site and wing plans). */
const ribRailH = (t: TileGeom) => clamp(t.h * 0.22, 2.5, 4.5 * t.u);

// composeGeneral / expandedRect run per tile per frame of a tween: hand back reused objects (the engine
// reads them immediately and never keeps them). The registry is fixed per engine.
const SLOTS: Record<string, Rect> = {};
const EMPTY: Readonly<Record<string, Rect>> = {};
const EXP: Rect = r0();
function r0(): Rect { return { x: 0, y: 0, w: 0, h: 0 }; }

function composeGeneral(t: TileGeom, ids: readonly string[]): Readonly<Record<string, Rect>> {
  if (!hasStrip(t) || !ids.length) return EMPTY;
  const n = ids.length, sw = slotW(t, n), g = GAP * t.u, h = bandH(t);
  for (let i = 0; i < n; i++) {
    const r = SLOTS[ids[i]] ?? (SLOTS[ids[i]] = r0());
    r.x = t.strip.x + i * (sw + g); r.y = bandY(t); r.w = sw; r.h = h;
  }
  return SLOTS;
}
function expandedRect(t: TileGeom): Rect {
  if (t.form === 'tile') { EXP.x = t.strip.x; EXP.y = bandY(t); EXP.w = t.strip.w; EXP.h = bandH(t); }
  else { const h = ribRailH(t); EXP.x = t.body.x + 1; EXP.y = t.body.y + t.body.h - h; EXP.w = Math.max(0, t.body.w - 2); EXP.h = h; }
  return EXP;
}

// ------------------------------------------------------------------------------ one lens, by manifest
interface Spec {
  d: LensDef;
  /** 0..1 along the rail; < 0 = nothing to measure (the rail stays a faint hairline). */
  measure(live: FeatureLive): number;
  /**
   * The rail's end marks, for standard and dense readers: dots counting the first evidence field that
   * is a plain count (an integer from 0 with no max and no unit, not the measured field). A dot takes the
   * lens's health colour when the rule that decided the health names that field.
   */
  count: LensField | null;
}

/** The field a lens's rail end counts in dots: the first plain count (integer from 0, no max, no unit) that is not the measured field. */
export function countField(d: LensDef): LensField | null {
  if (d.density === 'simple') return null;
  return d.evidence.find((f) => f.type === 'integer' && f.min === 0 && f.max === undefined && !f.unit && !f.source && f !== d.measures) ?? null;
}

function specOf(d: LensDef): Spec {
  const m = d.measures;
  const count = countField(d);
  return {
    d, count,
    measure: (live) => (m ? lensLine(m, live.value(d.id, m.key), d.measureMax) ?? -1 : -1),
  };
}

/** Small dots at the rail's end, right-aligned: n dots, the first `hot` in the status colour. Past four the count is capped, and says so: three dots and a '+'. */
function dots(a: MarkArgs, x1: number, cy: number, n: number, hot: number, col: string, hotCol: string) {
  const { ctx } = a, u = a.tile.u, r = Math.max(1.3, 1.5 * u), sp = 4.6 * u;
  const more = n > 4, shown = more ? 3 : n;
  for (let i = 0; i < shown; i++) {
    ctx.fillStyle = i < hot ? hotCol : col;
    ctx.beginPath(); ctx.arc(x1 - r - i * sp, cy, r, 0, 6.2832); ctx.fill();
  }
  if (more) {
    const px = x1 - r - 3 * sp, arm = Math.max(1, r * 0.55), t = Math.max(1, Math.round(u * 0.9));
    ctx.fillStyle = hot > 3 ? hotCol : col;
    ctx.fillRect(px - arm - t / 2, cy - t / 2, 2 * arm + t, t);
    ctx.fillRect(px - t / 2, cy - arm - t / 2, t, 2 * arm + t);
  }
}
const END_W = 20;

// ------------------------------------------------------------------------------------------- marks
function drawTile(s: Spec, a: MarkArgs) {
  const { ctx, th, tile: t, f } = a, u = t.u, d = s.d, fl = f.lens[d.id];
  const e = smooth(a.x);
  // Where this lens sits: its General slot, the head of the strip, or a blend (own easing, so the ones
  // that leave barely drift while they fade). Tiles too small for slots only ever show the lone lens.
  const H = bandH(t), slot = a.slot;
  const sx = slot ? slot.x : t.strip.x, sW = slot ? slot.w : t.strip.w;
  const rx = lerp(sx, t.strip.x, e), rw = lerp(sW, t.strip.w, e);
  const lift = (1 - a.w) * 3 * u;                      // lifted off the drawing as it fades
  const gs = Math.max(6, lerp(Math.min(H - u, sW * 0.5, 8 * u), Math.min(H, 9 * u), e) * lerp(0.55, 1, a.w));
  const cy = bandY(t) + H / 2 - lift, gy = cy - gs / 2;
  const ga = ctx.globalAlpha * a.w;
  ctx.globalAlpha = ga;
  glyph(ctx, d.glyph, rx, gy, gs, healthInk(th, fl ? fl.h : 'unmeasured', a.now));
  // on a large fixture the lone lens also leaves its glyph as a faint watermark in a fixed place
  // (right, below the middle): the quiet second echo that tells a glance which lens is up
  if (e > 0.01 && t.text && t.w >= 250 * u && t.h >= 120 * u) {
    const ws = Math.min(t.h * 0.24, 30 * u);
    ctx.globalAlpha = ga * e * (th.mode === 'dark' ? 0.3 : 0.24);
    glyph(ctx, d.glyph, t.x + t.w - 16 * u - ws, t.y + t.h * 0.6 - ws / 2, ws, th.ink);
    ctx.globalAlpha = ga;
  }
  if (!a.now) return;
  // the rail: this lens's line type over the measured part, a faint hairline over the rest
  const x0 = rx + gs + 3 * u;
  const endW = s.count ? END_W * u * smooth((a.x - 0.4) / 0.6) : 0;
  const x1 = rx + rw - endW - (endW ? 3 * u : 0);
  if (x1 - x0 < 3 * u) return;
  const rh = lerp(Math.min(3 * u, H * 0.4), Math.min(5 * u, H * 0.62), e), ry = cy - rh / 2;
  const live = a.live, m = s.measure(live);
  const len = m > 0 ? (x1 - x0) * Math.min(1, m) : 0;
  ctx.globalAlpha = ga * lerp(0.6, 1, e);
  railRest(ctx, th, x0 + len, x1, ry, rh);
  if (len > 0) lineType(ctx, th, d.line, x0, ry, len, rh, th.inkA(0.92), u);
  if (endW > 0.5 && s.count && fl) {
    const n = live.value(d.id, s.count.key);
    if (typeof n === 'number' && n > 0) {
      ctx.globalAlpha = ga * smooth((a.x - 0.5) / 0.5);
      const hot = (fl.h === 'bad' || fl.h === 'watch') && fl.whyFields.includes(s.count.key) ? n : 0;
      dots(a, rx + rw, cy, n, hot, th.inkA(0.85), healthInk(th, fl.h, true));
    }
  }
}

function drawRibbon(s: Spec, a: MarkArgs) {
  if (!a.now) return;
  const { ctx, th, tile: t, f, r } = a, u = t.u, d = s.d;
  // on ribbons the leaving lenses peak at a quarter of their weight mid-tween: not worth a raster
  if (r.w < 3 || a.w < 0.12) return;
  const e = smooth(a.x);
  ctx.globalAlpha *= a.w;
  // the rail along the segment's foot, growing in from the left as the lens comes up
  const live = a.live, m = s.measure(live), full = r.w * e, len = m > 0 ? full * Math.min(1, m) : 0;
  railRest(ctx, th, r.x + len, r.x + full, r.y, r.h);
  if (len > 0) lineType(ctx, th, d.line, r.x, r.y, len, r.h, th.inkA(0.92), u);
  // the glyph where this lens is unwell, on a small knockout so it reads over any stage fill
  const h = f.lens[d.id]?.h;
  if (h !== 'bad' && h !== 'watch') return;
  const room = r.y - t.body.y - 1, gs = Math.min(room - 2, t.w - 5, 11 * u);
  if (gs < 7) return;
  const gx = t.x + (t.w - gs) / 2, gy = t.body.y + (room - gs) / 2;
  ctx.fillStyle = th.alpha(th.paper, 0.82); ctx.fillRect(gx - 1.5, gy - 1.5, gs + 3, gs + 3);
  const g2 = gs * lerp(0.6, 1, e), o = (gs - g2) / 2;
  glyph(ctx, d.glyph, gx + o, gy + o, g2, healthInk(th, h, true));
}

/** The channel for any lens, from its manifest alone. Also the fallback of the shaped and bold variants. */
export function manifestChannel(d: LensDef): LensChannel {
  const s = specOf(d);
  return {
    density: d.density,
    marks(a) {
      if (!a.stage || a.w < 0.03) return;
      if (a.tile.form === 'tile') drawTile(s, a); else drawRibbon(s, a);
    },
    content: (f, live) => lensContent(d, f.lens[d.id], live),
    aggregate: (fs) => lensAggregate(d, fs),
  };
}

export const subtleExpression: LensExpression = {
  id: 'subtle',
  name: 'Subtle',
  channels: {},
  fallback: manifestChannel,
  composeGeneral,
  expandedRect: (t) => expandedRect(t),
  spring: { stiffness: 150, damping: 26 },
  evidenceFont: () => 'mono',
};

export { bandH, slotW, sixW };
