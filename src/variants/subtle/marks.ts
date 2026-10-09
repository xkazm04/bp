// Drawing primitives for the subtle variant: the shared glyph set and the shared line set of the
// standard (spec 8.6), drawn by NAME so any lens manifest can pick them, plus custom glyph paths.
// Everything is ink (status colours only for status meaning), a handful of strokes each, no allocation
// per call: patterns and custom paths are cached.
import type { Health } from '@/lib/data';
import type { GlyphName, LineName } from '@/lib/standard/types';
import type { Theme } from '../types';

/** Glyph colour = that lens's health. Ink when fine, amber to watch, red for trouble, faint when n/a or unmeasured. */
export function healthInk(th: Theme, h: Health, now: boolean): string {
  if (!now) return th.inkA(0.5);
  if (h === 'bad') return th.red;
  if (h === 'watch') return th.amber;
  if (h === 'na') return th.inkA(0.38);
  if (h === 'unmeasured') return th.inkA(0.3);
  return th.inkA(0.82);
}

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
 * check = a check mark. A custom path is stroked in its 16x16 box, scaled to the square.
 */
export function glyph(ctx: CanvasRenderingContext2D, g: GlyphSpec, x: number, y: number, s: number, col: string) {
  const lw = s < 9 ? 1.1 : Math.min(1.8, s * 0.13);
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

// -------------------------------------------------------------------------------------- line types
// Rails run for every visible segment on every raster of a lens tween (528 at ?scale=4), so they are
// built from solid fillRects and the theme's cached, world-anchored patterns: no paths, no line dashes.


// th.pattern() builds a key string per call; rails ask thousands of times per tween, so remember the
// handful they use per theme object (the theme's own cache still anchors them to the world).
let PT: Theme | null = null;
const PC = new Map<number, CanvasPattern | null>();
const KIND = { dots: 1, vlines: 2, back: 3 } as const;
function pat(th: Theme, kind: keyof typeof KIND, size: number, col: string, lw: number): CanvasPattern | null {
  if (th !== PT) { PT = th; PC.clear(); }
  const k = KIND[kind] * 1e6 + size * 1e3 + Math.round(lw * 10) + (col.length << 26);
  let p = PC.get(k);
  if (p === undefined) { p = th.pattern({ kind, size, color: col, lw }); PC.set(k, p); }
  return p;
}

/**
 * A line type over [x, x+len] in a band (y, h): the measured part of the evidence rail. The shared set:
 * solid = one continuous rule, double = a ledger's double underline, dotted = a guide line, comb =
 * ruler ticks, chain = a centre line (long dash, dot), hatched = a fire-rated wall, dimension = a rule
 * with end ticks.
 */
export function lineType(ctx: CanvasRenderingContext2D, th: Theme, l: LineName, x: number, y: number, len: number, h: number, col: string, u: number) {
  if (len < 0.5) return;
  const mid = Math.round(y + h / 2);
  ctx.fillStyle = col;
  switch (l) {
    case 'solid': {
      const lw = Math.max(1, Math.round(1.6 * u));
      ctx.fillRect(x, mid - (lw >> 1), len, lw);
      return;
    }
    case 'double': {
      const t = Math.round(y + h * 0.15), b = Math.max(t + 2, Math.round(y + h * 0.85) - 1);
      ctx.fillRect(x, t, len, 1); ctx.fillRect(x, b, len, 1);
      return;
    }
    case 'dotted': {
      const S = Math.max(3, Math.round(3 * u));
      const p = pat(th, 'dots', S, col, Math.max(0.9, Math.round(u * 8) / 10));
      if (p) { ctx.fillStyle = p; ctx.fillRect(x, mid - S / 2, len, S); }
      return;
    }
    case 'comb': {
      const b = Math.round(y + h) - 1;
      ctx.fillRect(x, b, len, 1);
      const p = pat(th, 'vlines', Math.max(3, Math.round(2.8 * u)), col, 1);
      if (p && b - Math.round(y) > 0) { ctx.fillStyle = p; ctx.fillRect(x, Math.round(y), len, b - Math.round(y)); }
      return;
    }
    case 'chain': {
      const lw = Math.max(1, Math.round(1.4 * u)), dash = Math.max(5, 6.5 * u), gap = Math.max(1.5, 1.8 * u), dot = Math.max(1.5, 1.6 * u);
      const end = x + len, yy = mid - (lw >> 1);
      for (let px = x; px < end; px += dash + dot + gap * 2) {
        ctx.fillRect(px, yy, Math.min(dash, end - px), lw);
        const dx = px + dash + gap;
        if (dx < end) ctx.fillRect(dx, yy, Math.min(dot, end - dx), lw);
      }
      return;
    }
    case 'hatched': {
      const t = Math.round(y), b = Math.round(y + h) - 1;
      const p = pat(th, 'back', Math.max(3, Math.round(3.5 * u)), col, 1);
      if (p && b - t > 1) { ctx.fillStyle = p; ctx.fillRect(x, t + 1, len, b - t - 1); ctx.fillStyle = col; }
      ctx.fillRect(x, t, len, 1); ctx.fillRect(x, b, len, 1);
      return;
    }
    case 'dimension': {
      const lw = Math.max(1, Math.round(1.3 * u)), t = Math.round(y), hh = Math.max(2, Math.round(h));
      ctx.fillRect(x, mid - (lw >> 1), len, lw);
      ctx.fillRect(x, t, 1, hh); ctx.fillRect(x + len - 1, t, 1, hh);
      return;
    }
  }
}

/** The unmeasured rest of a rail: one faint hairline, the same for every lens. */
export function railRest(ctx: CanvasRenderingContext2D, th: Theme, x0: number, x1: number, y: number, h: number) {
  if (x1 - x0 < 1) return;
  ctx.fillStyle = th.inkA(0.26);
  ctx.fillRect(x0, Math.round(y + h / 2), x1 - x0, 1);
}

/** A rail with nothing measured: a broken hairline (a few short dashes, fillRect only), not the measured-zero one. */
export function railNone(ctx: CanvasRenderingContext2D, th: Theme, x0: number, x1: number, y: number, h: number, u: number) {
  const w = x1 - x0;
  if (w < 1) return;
  const dash = Math.max(2, 2 * u), n = Math.max(1, Math.min(6, Math.floor(w / (dash * 3))));
  const step = w / n, yy = Math.round(y + h / 2);
  ctx.fillStyle = th.inkA(0.26);
  for (let i = 0; i < n; i++) ctx.fillRect(x0 + i * step, yy, Math.min(dash, step), 1);
}
