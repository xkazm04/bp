// The icon vocabulary of the shaped variant. One source of truth: SVG path strings on a 16-unit grid,
// used as <path d> in the DOM (sheet, legend) and as cached Path2D objects on the canvas. Each lens has
// a base icon that names it plus a few state variants, so a General tile reads as six small pictures.
import type { Feature, LensId } from '@/lib/data';

export interface IconDef { s: string; f?: string }

export const ICONS = {
  // business: an admission ticket (side notches, perforated stub); a filled diamond = high value
  ticket: { s: 'M2 4H14V6.6A1.4 1.4 0 0 0 14 9.4V12H2V9.4A1.4 1.4 0 0 0 2 6.6Z M10.6 4.8V5.6M10.6 7.6V8.4M10.6 10.4V11.2' },
  ticketHi: { s: 'M2 4H14V6.6A1.4 1.4 0 0 0 14 9.4V12H2V9.4A1.4 1.4 0 0 0 2 6.6Z M10.6 4.8V5.6M10.6 7.6V8.4M10.6 10.4V11.2', f: 'M6.2 5.9L8.3 8L6.2 10.1L4.1 8Z' },
  // design: an artboard with crop marks; with no design yet only the crop marks are there
  board: { s: 'M5 5H11V11H5Z M5 1.5V3.3M1.5 5H3.3M11 1.5V3.3M12.7 5H14.5M5 12.7V14.5M1.5 11H3.3M11 12.7V14.5M12.7 11H14.5' },
  boardNone: { s: 'M5 1.5V3.3M1.5 5H3.3M11 1.5V3.3M12.7 5H14.5M5 12.7V14.5M1.5 11H3.3M11 12.7V14.5M12.7 11H14.5 M7 8H9' },
  // development: angle brackets; the slash is code, the diamond is code no human has reviewed
  code: { s: 'M5.4 3.8L1.8 8L5.4 12.2 M10.6 3.8L14.2 8L10.6 12.2 M9.2 3.6L6.8 12.4' },
  codeUnrev: { s: 'M5.4 3.8L1.8 8L5.4 12.2 M10.6 3.8L14.2 8L10.6 12.2', f: 'M8 5.2L10.2 8L8 10.8L5.8 8Z' },
  // operations: a dial (the needle is drawn live, its angle is the rollout)
  dial: { s: 'M2.2 11.6A5.8 5.8 0 0 1 13.8 11.6 M1.6 13.8H14.4' },
  dialOff: { s: 'M2.2 11.6A5.8 5.8 0 0 1 13.8 11.6 M1.6 13.8H14.4', f: 'M6.9 10.6H9.1V12.8H6.9Z' },
  // security: a padlock, closed when reviewed, open when not; card data adds the keyhole
  lock: { s: 'M3.6 7.4H11.4L12.4 8.4V14H3.6Z M5.4 7.4V5.4A2.6 2.6 0 0 1 10.6 5.4V7.4' },
  lockOpen: { s: 'M3.6 7.4H11.4L12.4 8.4V14H3.6Z M10.6 7.4V4.6A2.6 2.6 0 0 0 5.4 4.6V5.2' },
  lockCard: { s: 'M3.6 7.4H11.4L12.4 8.4V14H3.6Z M5.4 7.4V5.4A2.6 2.6 0 0 1 10.6 5.4V7.4', f: 'M7.1 9.6H8.9V12.2H7.1Z' },
  lockCardOpen: { s: 'M3.6 7.4H11.4L12.4 8.4V14H3.6Z M10.6 7.4V4.6A2.6 2.6 0 0 0 5.4 4.6V5.2', f: 'M7.1 9.6H8.9V12.2H7.1Z' },
  // quality: a checklist box: ticked, crossed (failing), half (partial), empty (untested)
  check: { s: 'M2.6 2.6H13.4V13.4H2.6Z M5 8.3L7.1 10.4L11 5.8' },
  checkFail: { s: 'M2.6 2.6H13.4V13.4H2.6Z M5.4 5.4L10.6 10.6M10.6 5.4L5.4 10.6' },
  checkPart: { s: 'M2.6 2.6H13.4V13.4H2.6Z M5 8H11' },
  checkNone: { s: 'M2.6 2.6H13.4V13.4H2.6Z' },
} satisfies Record<string, IconDef>;
export type IconId = keyof typeof ICONS;

/** The icon a lens shows for a feature. */
export function iconFor(l: LensId, f: Feature): IconId {
  switch (l) {
    case 'business': return f.business.value >= 4 ? 'ticketHi' : 'ticket';
    case 'design': return f.design.status === 'none' ? 'boardNone' : 'board';
    case 'development': return f.development.humanReviewed === false ? 'codeUnrev' : 'code';
    case 'operations': return f.operations.environment === 'production' && !f.operations.alerting ? 'dialOff' : 'dial';
    case 'security': {
      const se = f.security, shut = se.review === 'passed' || se.review === 'not-required';
      return se.dataClass === 'payment' ? (shut ? 'lockCard' : 'lockCardOpen') : shut ? 'lock' : 'lockOpen';
    }
    default: {
      const q = f.quality;
      return q.status === 'failing' ? 'checkFail' : q.status === 'passed' ? 'check' : q.status === 'partial' || q.status === 'testing' ? 'checkPart' : 'checkNone';
    }
  }
}
/** The lens's name icon (legend, tabs, sheet headers). */
export const LENS_ICON: Record<LensId, IconId> = { business: 'ticket', design: 'board', development: 'code', operations: 'dial', security: 'lock', quality: 'check' };

/** Needle angle for the operations dial (0..1 of the half turn), or null for no needle. */
export function dialNeedle(f: Feature, rolloutPct: number): number | null {
  const op = f.operations;
  if (op.environment === 'production') return op.flag ? rolloutPct / 100 : 1;
  if (op.environment === 'staging' || op.environment === 'preview') return 0.08;
  return null;
}

// ------------------------------------------------------------------------------------ canvas side
const cache = new Map<IconId, { s: Path2D; f: Path2D | null }>();
function paths(id: IconId) {
  let p = cache.get(id);
  if (!p) { const d: IconDef = ICONS[id]; p = { s: new Path2D(d.s), f: d.f ? new Path2D(d.f) : null }; cache.set(id, p); }
  return p;
}

/**
 * Draw an icon of side `s` px centred at (cx, cy). The caller sets globalAlpha; `lw` is the stroke in
 * screen px. The extra needle (operations) is drawn in the same transform.
 */
export function drawIcon(ctx: CanvasRenderingContext2D, id: IconId, cx: number, cy: number, s: number, color: string, lw: number, needle: number | null = null) {
  const p = paths(id), k = s / 16;
  ctx.save();
  ctx.translate(cx - s / 2, cy - s / 2); ctx.scale(k, k);
  ctx.lineWidth = lw / k; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
  ctx.strokeStyle = color; ctx.stroke(p.s);
  if (p.f) { ctx.fillStyle = color; ctx.fill(p.f); }
  if (needle != null) {
    const a = Math.PI + needle * Math.PI;
    ctx.beginPath(); ctx.moveTo(8, 11.6); ctx.lineTo(8 + Math.cos(a) * 4.6, 11.6 + Math.sin(a) * 4.6); ctx.stroke();
  }
  ctx.restore();
}
