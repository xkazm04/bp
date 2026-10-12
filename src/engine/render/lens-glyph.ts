// The lens glyph set of the standard (spec 8.6), drawn by NAME so any lens manifest can pick one, plus
// custom glyph paths. Shared by the subtle variant's strip (re-exported from src/variants/subtle/marks.ts)
// and the engine's trouble flags (render/flags.ts).
import type { GlyphName } from '@/lib/standard/types';

// A custom glyph is an SVG path in a 16x16 box from a manifest: untrusted input. It was checked at load
// (path commands and numbers only, at most 2048 characters) and is only ever parsed by Path2D.
const PATHS = new Map<string, Path2D | null>();
function customPath(d: string): Path2D | null {
  let p = PATHS.get(d);
  if (p === undefined) {
    try { p = d.length <= 2048 ? new Path2D(d) : null; } catch { p = null; }
    PATHS.set(d, p);
  }
  return p;
}
/** The glyph a manifest asked for: a shared name, a custom path, or null (drawn as a small ring). */
export type GlyphSpec = GlyphName | { path: string } | null;

// ------------------------------------------------------------------------------------------ glyphs
/**
 * One glyph in the square (x, y, s). The shared set, chosen to stay distinct at 7 px: bars = rising
 * bars, set-square = a drafting set square, brackets = < >, pulse = a pulse line, padlock = a padlock,
 * check = a check mark. A custom path is stroked in its 16x16 box, scaled to the square. `lwMax` caps
 * the stroke (1.8 for the strip; the large trouble flags pass more).
 */
export function glyph(ctx: CanvasRenderingContext2D, g: GlyphSpec, x: number, y: number, s: number, col: string, lwMax = 1.8) {
  const lw = s < 9 ? 1.1 : Math.min(lwMax, s * 0.13);
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (g === null || typeof g === 'object') {
    const p = g ? customPath(g.path) : null;
    if (p) {
      const k = s / 16;
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.lineWidth = lw / k; ctx.stroke(p); ctx.restore();
    } else { ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.36, 0, 6.2832); ctx.stroke(); }
    ctx.lineCap = 'butt';
    return;
  }
  ctx.beginPath();
  switch (g) {
    case 'bars': {
      const bw = s * 0.24, g = (s - bw * 3) / 2;
      ctx.rect(x, y + s * 0.58, bw, s * 0.42);
      ctx.rect(x + bw + g, y + s * 0.3, bw, s * 0.7);
      ctx.rect(x + 2 * (bw + g), y, bw, s);
      ctx.fill();
      return;
    }
    case 'set-square':
      ctx.moveTo(x + lw / 2, y + lw / 2); ctx.lineTo(x + lw / 2, y + s - lw / 2); ctx.lineTo(x + s - lw / 2, y + s - lw / 2); ctx.closePath();
      ctx.moveTo(x + s * 0.26, y + s * 0.5); ctx.lineTo(x + s * 0.26, y + s * 0.74); ctx.lineTo(x + s * 0.5, y + s * 0.74);
      break;
    case 'brackets':
      ctx.moveTo(x + s * 0.34, y + s * 0.12); ctx.lineTo(x + s * 0.02, y + s * 0.5); ctx.lineTo(x + s * 0.34, y + s * 0.88);
      ctx.moveTo(x + s * 0.66, y + s * 0.12); ctx.lineTo(x + s * 0.98, y + s * 0.5); ctx.lineTo(x + s * 0.66, y + s * 0.88);
      break;
    case 'pulse':
      ctx.moveTo(x, y + s * 0.55); ctx.lineTo(x + s * 0.26, y + s * 0.55); ctx.lineTo(x + s * 0.42, y + s * 0.05);
      ctx.lineTo(x + s * 0.6, y + s * 0.95); ctx.lineTo(x + s * 0.74, y + s * 0.55); ctx.lineTo(x + s, y + s * 0.55);
      break;
    case 'padlock':
      ctx.rect(x + s * 0.12, y + s * 0.46, s * 0.76, s * 0.54); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + s * 0.27, y + s * 0.48); ctx.lineTo(x + s * 0.27, y + s * 0.3);
      ctx.arc(x + s * 0.5, y + s * 0.3, s * 0.23, Math.PI, 0); ctx.lineTo(x + s * 0.73, y + s * 0.48);
      break;
    case 'check':
      ctx.moveTo(x + s * 0.06, y + s * 0.55); ctx.lineTo(x + s * 0.38, y + s * 0.88); ctx.lineTo(x + s * 0.96, y + s * 0.1);
      break;
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}
