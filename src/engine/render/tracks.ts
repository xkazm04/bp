// A live product's answer tracks on the plan (src/lib/model/live-tracks.ts): one stage glyph and a 12 px label at the
// bottom-left of each tile that has a decided proposal (the newest; "+N" when it has more), and a count per room at
// the overview levels, beside the room's question pin. Culled to the viewport like the pins; the labels and room
// counts are strings the tracks built once per change, so a frame allocates nothing.
import type { LiveTracks } from '@/lib/model/live-tracks';
import type { TrackStage } from '@/lib/scan/track';
import type { Engine } from '../Engine';
import type { Theme } from '../theme';
import { drawText } from '../text';
import { roomPinPos } from './dynamic';
import { onView, rs, type SRect, type View } from './view';

const sr: SRect = { x: 0, y: 0, w: 0, h: 0 };
const DASH = [3, 2.5], NONE: number[] = [];
const at = { x: 0, y: 0 };
/** Where a tile's track glyph stands (screen px), from the tile's screen rect. One shared record: read it at once. */
export function trackMarkPos(r: SRect, u: number): { x: number; y: number } { at.x = r.x + 10 * u; at.y = r.y + r.h - 10 * u; return at; }
/** Below this tile width (screen px / U) the glyph stands alone, without its label. */
export const TRACK_LABEL_W = 90;

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, dash: boolean) {
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash ? DASH : NONE); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke(); ctx.setLineDash(NONE);
}
function dot(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, r: number, col: string) {
  ctx.fillStyle = col; ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.stroke();
}
/** The stage's glyph: rings while the work is on its way, a filled mark once the store has a result. */
export function trackGlyph(ctx: CanvasRenderingContext2D, th: Theme, stage: TrackStage, x: number, y: number, u: number) {
  const r = 5.5 * u;
  switch (stage) {
    case 'saving': ring(ctx, x, y, r, th.ink, true); break;
    case 'approved': ring(ctx, x, y, r, th.accent, false); break;
    case 'building': ring(ctx, x, y, r, th.mint, false); dot(ctx, th, x, y, 2.2 * u, th.mint); break;
    case 'built': ring(ctx, x, y, r, th.mint, false); ctx.fillStyle = th.mint; ctx.beginPath(); ctx.arc(x, y, r, 0, 3.1416); ctx.fill(); break;
    case 'accepted': dot(ctx, th, x, y, r, th.ink); break;
    case 'confirmed':
      dot(ctx, th, x, y, r, th.mint);
      ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x - 2.6 * u, y); ctx.lineTo(x - 0.6 * u, y + 2.2 * u); ctx.lineTo(x + 2.8 * u, y - 2.2 * u); ctx.stroke();
      break;
    case 'not-confirmed': dot(ctx, th, x, y, r, th.amber); break;
    case 'failed': dot(ctx, th, x, y, r, th.red); break;
    case 'rework': ring(ctx, x, y, r, th.amber, false); break;
    case 'unknown': ring(ctx, x, y, r, th.inkA(0.7), true); break;
    default: ring(ctx, x, y, r, th.inkA(0.45), false); // declined, descoped
  }
}

/** Each tile label's width in the label font, measured once per change of the tracks or of the font (U, families). */
const WIDTHS = new WeakMap<LiveTracks, { v: number; font: string; w: Record<string, number> }>();
function labelWidths(E: Engine, T: LiveTracks, font: string): Record<string, number> {
  let c = WIDTHS.get(T);
  if (c && c.v === T.v && c.font === font) return c.w;
  const w: Record<string, number> = {};
  for (const fid in T.tileLabel) w[fid] = E.tx.w(T.tileLabel[fid], font);
  c = { v: T.v, font, w }; WIDTHS.set(T, c);
  return w;
}

const ROOMS = new WeakMap<LiveTracks, { v: number; n: number[]; label: string[] }>();
/** Tracks per room (counted once per change of the tracks). */
function roomCounts(E: Engine, T: LiveTracks): { n: number[]; label: string[] } {
  let c = ROOMS.get(T);
  if (c && c.v === T.v) return c;
  const n: number[] = E.M.L.rooms.map(() => 0);
  for (const fid in T.F) { const Ti = E.M.L.TILE[fid]; if (Ti) n[Ti.room.ri] += T.F[fid].length; }
  c = { v: T.v, n, label: n.map((k) => (k ? k + ' tracked' : '')) };
  ROOMS.set(T, c);
  return c;
}

export function drawTracks(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number) {
  const T = E.M.tracks; if (!T || !T.list.length || !E.isNow) return;
  const u = E.U, th = E.th, f12 = E.tx.f(12, 600, true);
  ctx.save();
  if (lod < 0.995) {
    const rc = roomCounts(E, T);
    ctx.globalAlpha = 1 - lod;
    for (let ri = 0; ri < rc.n.length; ri++) {
      if (!rc.n[ri]) continue;
      const r = rs(v, E.M.L.rooms[ri], sr); if (!onView(v, r, 30)) continue;
      const pp = roomPinPos(E, v, ri), x = pp.x - 6 * u, y = pp.y + 16 * u;
      trackGlyph(ctx, th, 'approved', x, y, u);
      ctx.textAlign = 'right'; drawText(ctx, rc.label[ri], x - 10 * u, y + 4 * u, f12, th.ink, th.halo); ctx.textAlign = 'left';
    }
  }
  if (lod > 0.005) {
    ctx.globalAlpha = lod;
    const lw = labelWidths(E, T, f12);
    for (const fid in T.F) {
      const Ti = E.M.L.TILE[fid]; if (!Ti) continue;
      const r = rs(v, Ti, sr); if (!onView(v, r, 20)) continue;
      const p = trackMarkPos(r, u), t = T.F[fid][0];
      trackGlyph(ctx, th, t.stage, p.x, p.y, u);
      // the label only where it fits left of the tile's question pins (they stand at its bottom-right, 18 px apart)
      const room = r.w - 20 * u - ((E.M.sim.DOF[fid]?.length ?? 0) * 18 + 8) * u;
      if (r.w >= TRACK_LABEL_W * u && lod > 0.5 && lw[fid] <= room) drawText(ctx, T.tileLabel[fid], p.x + 10 * u, p.y + 4 * u, f12, th.ink, th.halo);
    }
  }
  ctx.restore();
}
