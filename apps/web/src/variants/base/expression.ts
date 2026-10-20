// The base expression: what bold shares of A/1's lens behaviour under the no-recolour rule. It owns no
// channels (shaped and bold draw their own; every other lens is subtle's manifestChannel): only General's
// compact layout (one health cell slot per enabled lens along the top edge), the spring, and the
// "no human review" diamond bold's development channel draws.
import { bl } from './legacy';
import { manifestChannel } from '../subtle/expression';
import type { LensExpression, MarkArgs, Rect } from '../types';

/** The "no human review" diamond at a mid-sized fixture's foot-right corner; development owns it, General shows it too (A/1). */
export function reviewDiamond(a: MarkArgs, ga0: number) {
  const { ctx, th, tile: t } = a, u = t.u;
  if (!(a.stage && a.now && bl(a.f).development.humanReviewed === false && t.form === 'tile' && t.w < 150 * u && t.w >= 26 * u)) return;
  const dx = t.x + t.w - 7 * u, dy = t.y + t.h - 7 * u, dd = Math.max(2.5 * u, Math.min(4.5 * u, t.w / 28));
  ctx.globalAlpha = ga0 * a.w; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(dx, dy - dd); ctx.lineTo(dx + dd * 0.8, dy); ctx.lineTo(dx, dy + dd); ctx.lineTo(dx - dd * 0.8, dy); ctx.closePath(); ctx.stroke();
}
// composeGeneral runs per tile per frame of a tween: reused records (the registry is fixed per engine)
const SLOTS: Record<string, Rect> = {};
const NO_SLOTS: Readonly<Record<string, Rect>> = {};

export const baseExpression: LensExpression = {
  id: 'base',
  name: 'Base',
  channels: {},
  fallback: manifestChannel,
  composeGeneral(tile, ids) {
    // one health cell per enabled lens in the strip along the top edge; ribbons keep A/1's calm segments
    if (tile.form !== 'tile' || tile.strip.w < 60 * tile.u || !ids.length) return NO_SLOTS;
    const n = ids.length, s = tile.strip, gap = 2 * tile.u, w = (s.w - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const r = SLOTS[ids[i]] ?? (SLOTS[ids[i]] = { x: 0, y: 0, w: 0, h: 0 });
      r.x = s.x + i * (w + gap); r.y = s.y; r.w = w; r.h = s.h;
    }
    return SLOTS;
  },
  spring: { stiffness: 170, damping: 26 },
};
