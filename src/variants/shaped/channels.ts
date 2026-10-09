// The six channels of the shaped variant. Each lens speaks through three things, in this order of
// weight: its OUTLINE (shapes.ts, morphing in with dominance), its ICON (a chip set into the tile's top
// edge: six side by side in General, one that widens into a tag with a small readout when the lens
// stands alone), and one ACCENT colour used only for its marks and words. Nothing here fills a tile.
import type { Feature, Health, LensId } from '@/lib/data';
import { isLiveSt } from '@/lib/model';
import type { ChannelAggregate, ChannelContent, LensChannel, MarkArgs, Rect, Theme, TileGeom } from '../types';
import { dialNeedle, drawIcon, iconFor } from './icons';
import {
  edgeComb, edgeCrops, edgeCut, edgeGauge, edgeSpines, edgeTicket, shapeBoard, shapeBracket, shapeComb, shapeCut, shapePill, shapeTicket, takeD,
} from './shapes';

/** Secondary accents: kept clear of the status colours (red, amber, mint) and of the blue ink. */
export const ACCENTS: Record<LensId, { dark: string; light: string }> = {
  business: { dark: '#c6ec6e', light: '#4f7a00' },
  design: { dark: '#ff9fd2', light: '#b42a76' },
  development: { dark: '#a9b5ff', light: '#3d48c9' },
  operations: { dark: '#45dcd8', light: '#007a80' },
  security: { dark: '#d4a8ff', light: '#7a36c8' },
  quality: { dark: '#7cc0ff', light: '#1f5fbf' },
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function count(fs: readonly Feature[], fn: (f: Feature) => boolean) { let n = 0; for (const f of fs) if (fn(f)) n++; return n; }
/** Aggregate parts: the first always stays; later parts that count nothing ('0 …') are dropped. */
function agg(parts: string[]): ChannelAggregate { return { parts: parts.filter((p, i) => p && (i === 0 || !p.startsWith('0 '))) }; }
function healthCol(th: Theme, h: Health) { return h === 'bad' ? th.red : h === 'watch' ? th.amber : h === 'good' ? th.inkA(0.66) : th.inkA(0.3); }

// ------------------------------------------------------------------------------ chip geometry
/** Chip side on a fixture: scales with the tile, capped so the header text row stays clear. */
export function chipSide(t: TileGeom) { return Math.min(18 * t.u, t.h * 0.17); }
/** The single tag a lone lens grows into: same height as the chips, wider, at the head of the row. */
export function homeRect(t: TileGeom): Rect {
  if (t.form !== 'tile') return t.body;
  const s = Math.max(chipSide(t), 7 * t.u);
  return { x: t.x + 7 * t.u, y: t.y - s / 2 + 0.5, w: clamp(s * 4.6, s, t.w - 34 * t.u), h: s };
}

// ------------------------------------------------------------------------- the shared painter
type Edge = (a: MarkArgs, d: number) => void;
type Readout = (a: MarkArgs, r: Rect) => void;
type Ribbon = (a: MarkArgs) => void;

function paint(l: LensId, a: MarkArgs, edge: Edge, readout: Readout, ribbon: Ribbon) {
  const { ctx, tile: t, f, th } = a;
  if (!a.stage) return;
  const ga = ctx.globalAlpha;
  if (t.form === 'ribbon') { if (a.w > 0.01) { ctx.globalAlpha = ga * a.w; ribbon(a); } return; }
  // 1. edge marks: exclusive, like the outline they ride on (dominance)
  const d = takeD(l, f);
  if (d > 0.01) { ctx.globalAlpha = ga * d; edge(a, d); ctx.globalAlpha = ga; }
  // 2. the chip / tag on the top edge (presence and expansion)
  const r = a.r, u = t.u;
  if (r.h < 6.5 * u || a.w < 0.01) return;
  const x = a.x, w = a.w, s = r.h, cy = r.y + s / 2;
  if (s < 10 * u) {
    // too small for a picture: the chip degrades to a plain health cell (General at mid zoom)
    if (x < 0.99) { ctx.globalAlpha = ga * w * (1 - x); ctx.fillStyle = healthCol(th, f[l].health); ctx.fillRect(r.x, r.y + s * 0.25, r.w, s * 0.5); }
    if (x > 0.01) { ctx.globalAlpha = ga * w * x; ctx.fillStyle = a.accent; ctx.fillRect(r.x, r.y + s * 0.25, r.w, s * 0.5); }
    ctx.globalAlpha = ga; return;
  }
  const tagW = Math.max(s, r.w);
  // knock the outline out behind the chip so the icon reads as set into the edge
  ctx.globalAlpha = ga * w;
  ctx.fillStyle = th.labelBg; ctx.fillRect(r.x - 1.5 * u, r.y, tagW + 3 * u, s);
  if (x > 0.01) {
    ctx.globalAlpha = ga * w * x; ctx.strokeStyle = a.accent; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(r.x - 1.5 * u) + 0.5, Math.round(r.y) + 0.5, Math.round(tagW + 3 * u) - 1, Math.round(s) - 1);
  }
  const is = s * (0.86 - 0.3 * (1 - w)), lw = clamp(is * 0.1, 1.1, 1.8), icx = r.x + s / 2, id = iconFor(l, f);
  const needle = l === 'operations' ? dialNeedle(f, a.live.rolloutPct) : null;
  if (x < 0.99) { ctx.globalAlpha = ga * w * (1 - x); drawIcon(ctx, id, icx, cy, is, healthCol(th, f[l].health), lw, needle); }
  if (x > 0.01) { ctx.globalAlpha = ga * w * x; drawIcon(ctx, id, icx, cy, is, a.accent, lw, needle); }
  const rw = tagW - s - 3 * u;
  if (x > 0.05 && rw > s * 0.9) {
    ctx.globalAlpha = ga * w * clamp((x - 0.05) / 0.6, 0, 1);
    readout(a, { x: r.x + s + 1.5 * u, y: r.y + s * 0.22, w: rw, h: s * 0.56 });
  }
  ctx.globalAlpha = ga;
}

/** n pips across a readout rect; `fill` of them solid. Two paths, two draw calls. */
function pips(ctx: CanvasRenderingContext2D, r: Rect, n: number, fill: number, col: string, kind: 'dia' | 'sq' | 'dot') {
  const step = Math.min(r.w / n, r.h * 1.6), sz = Math.min(r.h, step * 0.72) / 2, cy = r.y + r.h / 2;
  const at = (p: Path2D | CanvasRenderingContext2D, i: number) => {
    const cx = r.x + step * (i + 0.5);
    if (kind === 'dia') { p.moveTo(cx, cy - sz); p.lineTo(cx + sz, cy); p.lineTo(cx, cy + sz); p.lineTo(cx - sz, cy); p.closePath(); }
    else if (kind === 'sq') p.rect(cx - sz * 0.85, cy - sz * 0.85, sz * 1.7, sz * 1.7);
    else { p.moveTo(cx + sz, cy); p.arc(cx, cy, sz, 0, 6.2832); }
  };
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.beginPath(); for (let i = 0; i < fill; i++) at(ctx, i); ctx.fill();
  ctx.beginPath(); for (let i = fill; i < n; i++) at(ctx, i); ctx.stroke();
}
function bar(ctx: CanvasRenderingContext2D, r: Rect, frac: number, col: string, rest?: string) {
  const h = Math.max(3, r.h * 0.6), y = r.y + (r.h - h) / 2;
  ctx.fillStyle = col; ctx.fillRect(r.x, y, r.w * clamp(frac, 0, 1), h);
  ctx.strokeStyle = rest ?? col; ctx.lineWidth = 1; ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(y) + 0.5, Math.round(r.w) - 1, Math.round(h) - 1);
}

// ---------------------------------------------------------------------------------- business
const business: LensChannel = {
  density: 'standard',
  accent: ACCENTS.business,
  shape: shapeTicket,
  marks(a) {
    paint('business', a, (m, d) => edgeTicket(m.ctx, m.tile, m.f, d, m.accent), (m, r) => pips(m.ctx, r, 5, m.f.business.value, m.accent, 'dia'), (m) => {
      // L0/L1: a ticket bite out of the segment's top edge, as deep as the value
      const { ctx, tile: t, f } = m, v = f.business.value;
      const rr = Math.min(t.w * 0.34, t.h * 0.42) * (0.25 + (0.75 * (v - 1)) / 4), cx = t.x + t.w / 2;
      if (rr < 1.2) return;
      ctx.fillStyle = m.th.paper; ctx.beginPath(); ctx.arc(cx, t.y, rr, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = m.accent; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, t.y, rr, 0, Math.PI); ctx.stroke();
    });
  },
  content(f): ChannelContent {
    const b = f.business, rev: Record<string, string> = { direct: 'direct revenue', retention: 'retention', indirect: 'indirect', none: '' };
    return {
      parts: ['Value ' + b.value + '/5', b.customerRequests30d ? b.customerRequests30d + ' asks' : '', rev[b.revenueLink] ?? ''].filter(Boolean),
      stamp: f.flags.includes('demand-waiting') ? 'Customers are waiting' : f.flags.includes('priority-not-started') ? 'Priority, not started' : undefined,
    };
  },
  aggregate(fs): ChannelAggregate {
    const asks = fs.reduce((s, f) => s + (f.business.customerRequests30d || 0), 0);
    const mrr = fs.reduce((s, f) => s + (f.business.mrrImpactUsd || 0), 0);
    return agg([count(fs, (f) => f.business.value >= 4) + ' high value', asks + ' asks', mrr ? '$' + (mrr >= 1000 ? Math.round(mrr / 100) / 10 + 'k' : mrr) + ' MRR' : '']);
  },
};

// ------------------------------------------------------------------------------------ design
const DSTEP: Record<string, number> = { none: 0, sketch: 1, wireframe: 2, 'hi-fi': 3, implemented: 4, polished: 5 };
const DWORD: Record<string, string> = { none: 'No design yet', sketch: 'Sketch', wireframe: 'Wireframe', 'hi-fi': 'Hi-fi mock', implemented: 'Built to design', polished: 'Polished', 'n/a': 'No interface' };
const design: LensChannel = {
  density: 'simple',
  accent: ACCENTS.design,
  shape: shapeBoard,
  marks(a) {
    paint('design', a, (m, d) => edgeCrops(m.ctx, m.tile, m.f, d, m.accent, m.th), (m, r) => {
      if (m.f.design.status === 'n/a') return;
      pips(m.ctx, r, 5, DSTEP[m.f.design.status] ?? 0, m.accent, 'sq');
    }, (m) => {
      // L0/L1: crop marks at the segment's corners, longer the further the design got
      const { ctx, tile: t } = m, k = (DSTEP[m.f.design.status] ?? 0) / 5;
      if (!k) return;
      const L = Math.min(t.w, t.h) * 0.42 * k + 1.5, g = 1.5;
      ctx.strokeStyle = m.f.design.a11y === 'fail' ? m.th.red : m.accent; ctx.lineWidth = 1.3; ctx.beginPath();
      ctx.moveTo(t.x - g, t.y - g + L); ctx.lineTo(t.x - g, t.y - g); ctx.lineTo(t.x - g + L, t.y - g);
      ctx.moveTo(t.x + t.w + g - L, t.y + t.h + g); ctx.lineTo(t.x + t.w + g, t.y + t.h + g); ctx.lineTo(t.x + t.w + g, t.y + t.h + g - L);
      ctx.stroke();
    });
  },
  content(f) {
    const de = f.design, built = isLiveSt(f.stage) || f.stage === 'in-review' || f.stage === 'in-dev';
    return {
      parts: [DWORD[de.status] ?? de.status],
      stamp: de.a11y === 'fail' ? 'Fails accessibility' : de.specDrift ? 'Built off the design' : de.status === 'none' && built ? 'Built without a design' : undefined,
    };
  },
  aggregate(fs) {
    const ui = fs.filter((f) => f.design.status !== 'n/a');
    return agg([count(ui, (f) => (DSTEP[f.design.status] ?? 0) >= 3) + ' of ' + ui.length + ' designed', count(ui, (f) => f.design.status === 'none') + ' no design']);
  },
};

// ------------------------------------------------------------------------------- development
const development: LensChannel = {
  density: 'dense',
  accent: ACCENTS.development,
  shape: shapeBracket,
  marks(a) {
    paint('development', a, (m, d) => edgeSpines(m.ctx, m.tile, m.f, d, m.accent, m.th, m.live.progressPct), (m, r) => {
      // agent-written share (filled) against human-written (hollow); one tick per open PR above it
      const dv = m.f.development;
      bar(m.ctx, { x: r.x, y: r.y + r.h * 0.3, w: r.w, h: r.h * 0.7 }, dv.aiAuthoredPct / 100, m.accent);
      if (dv.openPRs) { m.ctx.fillStyle = m.accent; for (let i = 0; i < Math.min(dv.openPRs, 4); i++) m.ctx.fillRect(r.x + i * 4 * m.tile.u, r.y - r.h * 0.12, 2 * m.tile.u, r.h * 0.32); }
    }, (m) => {
      // L0/L1: a progress spine up the segment's left edge
      const { ctx, tile: t } = m, p = clamp(m.live.progressPct, 0, 100) / 100;
      if (p <= 0) return;
      const bw = Math.max(2, Math.min(3 * t.u, t.w * 0.18));
      ctx.fillStyle = m.accent; ctx.fillRect(t.x + 1, t.y + t.h * (1 - p), bw, t.h * p);
      if (m.f.development.humanReviewed === false && t.w > 9) { ctx.strokeStyle = m.accent; ctx.lineWidth = 1; ctx.strokeRect(t.x + 1.5, t.y + 0.5, bw, t.h - 1); }
    });
  },
  content(f, live) {
    const dv = f.development;
    return {
      parts: [dv.progressPct >= 100 ? 'DONE' : Math.round(live.progressPct) + '%', 'AI ' + dv.aiAuthoredPct + '%', dv.unitCoveragePct != null ? 'COV ' + dv.unitCoveragePct : '', dv.openPRs ? 'PR ' + dv.openPRs : '', dv.techDebt ? 'DEBT ' + dv.techDebt : ''].filter(Boolean),
      stamp: dv.humanReviewed === false ? 'No human review' : dv.stalled ? 'Stalled' : undefined,
    };
  },
  aggregate(fs) {
    const started = fs.filter((f) => f.development.status !== 'not-started');
    return agg([
        count(fs, (f) => f.development.humanReviewed === false) + ' unreviewed',
        Math.round(started.reduce((s, f) => s + f.development.aiAuthoredPct, 0) / Math.max(1, started.length)) + '% agent code',
        fs.reduce((s, f) => s + f.development.openPRs, 0) + ' PRs',
        count(fs, (f) => f.development.unitCoveragePct != null && f.development.unitCoveragePct < 50) + ' thin cov',
    ]);
  },
};

// -------------------------------------------------------------------------------- operations
const ENVS: Record<string, number> = { none: 0, preview: 1, staging: 2, production: 3 };
const operations: LensChannel = {
  density: 'dense',
  accent: ACCENTS.operations,
  shape: shapePill,
  marks(a) {
    paint('operations', a, (m, d) => edgeGauge(m.ctx, m.tile, m.f, d, m.accent, m.th, m.live.rolloutPct), (m, r) => {
      // how far it has travelled: preview, staging, production
      pips(m.ctx, { x: r.x, y: r.y, w: Math.min(r.w, r.h * 4.8), h: r.h }, 3, ENVS[m.f.operations.environment] ?? 0, m.accent, 'dot');
    }, (m) => {
      // L0/L1: a gauge line along the segment's foot, as long as the rollout
      const { ctx, tile: t } = m, op = m.f.operations;
      if (op.environment === 'none') return;
      const pc = op.environment === 'production' ? (op.flag ? m.live.rolloutPct / 100 : 1) : 0.3, bh = Math.max(2, Math.min(3 * t.u, t.h * 0.16));
      ctx.fillStyle = m.accent;
      if (op.environment === 'production') ctx.fillRect(t.x + 1, t.y + t.h - bh - 1, (t.w - 2) * pc, bh);
      else { ctx.globalAlpha *= 0.7; for (let xx = t.x + 1; xx < t.x + 1 + (t.w - 2) * pc; xx += bh * 2.2) ctx.fillRect(xx, t.y + t.h - bh - 1, bh, bh); }
    });
  },
  content(f, live) {
    const op = f.operations;
    if (op.environment !== 'production') return { parts: [op.environment === 'none' ? 'NOT DEPLOYED' : op.environment.toUpperCase()] };
    return {
      parts: [(op.flag ? live.rolloutPct : 100) + '%', op.p95ms != null ? 'P95 ' + op.p95ms + 'MS' : '', op.errorRatePct != null ? op.errorRatePct + '% ERR' : '', op.sloActual != null ? 'SLO ' + op.sloActual : '', op.incidents30d ? op.incidents30d + ' INC' : ''].filter(Boolean),
      stamp: !op.alerting ? 'Live without alerting' : op.incidents30d ? op.incidents30d + ' incident' + (op.incidents30d > 1 ? 's' : '') + ' in 30 days' : !op.runbook ? 'No runbook' : undefined,
    };
  },
  aggregate(fs) {
    const inc = count(fs, (f) => f.operations.incidents30d > 0);
    return agg([count(fs, (f) => f.operations.environment === 'production') + ' live', count(fs, (f) => f.operations.environment === 'production' && !f.operations.alerting) + ' no alerting', inc ? inc + ' had incidents' : '']);
  },
};

// ---------------------------------------------------------------------------------- security
const CLASSN: Record<string, number> = { public: 0, internal: 1, personal: 2, payment: 3 };
const CLASSW: Record<string, string> = { public: 'PUBLIC', internal: 'INTERNAL', personal: 'PERSONAL DATA', payment: 'CARD DATA' };
const REVW: Record<string, string> = { 'not-required': 'NO REVIEW NEEDED', 'not-started': 'NOT REVIEWED', pending: 'REVIEW PENDING', passed: 'REVIEWED', findings: 'FINDINGS' };
const security: LensChannel = {
  density: 'standard',
  accent: ACCENTS.security,
  shape: shapeCut,
  marks(a) {
    paint('security', a, (m, d) => edgeCut(m.ctx, m.tile, m.f, d, m.accent), (m, r) => {
      // how sensitive: three steps, internal / personal / card data
      pips(m.ctx, { x: r.x, y: r.y, w: Math.min(r.w, r.h * 4.8), h: r.h }, 3, CLASSN[m.f.security.dataClass] ?? 0, m.accent, 'dia');
    }, (m) => {
      // L0/L1: the segment's corner is cut, deeper for card data; unreviewed sensitive data loses two
      const { ctx, tile: t } = m, se = m.f.security, n = CLASSN[se.dataClass] ?? 0;
      if (!n) return;
      const c = Math.min(t.w * 0.5, t.h * 0.6) * (n / 3), open = (n >= 2) && (se.review === 'pending' || se.review === 'not-started');
      ctx.fillStyle = m.th.paper; ctx.strokeStyle = m.accent; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(t.x + t.w - c, t.y - 0.5); ctx.lineTo(t.x + t.w + 0.5, t.y - 0.5); ctx.lineTo(t.x + t.w + 0.5, t.y + c); ctx.closePath(); ctx.fill();
      if (open) { ctx.beginPath(); ctx.moveTo(t.x - 0.5, t.y + t.h - c); ctx.lineTo(t.x - 0.5, t.y + t.h + 0.5); ctx.lineTo(t.x + c, t.y + t.h + 0.5); ctx.closePath(); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(t.x + t.w - c, t.y); ctx.lineTo(t.x + t.w, t.y + c);
      if (open) { ctx.moveTo(t.x, t.y + t.h - c); ctx.lineTo(t.x + c, t.y + t.h); }
      ctx.stroke();
    });
  },
  content(f, live) {
    const se = f.security, sensitive = se.dataClass === 'payment' || se.dataClass === 'personal';
    const isLive = isLiveSt(f.stage) && live.rolloutPct > 0;
    return {
      parts: [CLASSW[se.dataClass] ?? se.dataClass.toUpperCase(), se.review === 'findings' ? se.openFindings + ' FINDINGS' : REVW[se.review] ?? se.review.toUpperCase()],
      stamp: se.review === 'findings' ? 'Open security findings' : sensitive && isLive && (se.review === 'not-started' || se.review === 'pending') ? 'Live, not reviewed' : undefined,
    };
  },
  aggregate(fs) {
    const open = count(fs, (f) => (f.security.dataClass === 'payment' || f.security.dataClass === 'personal') && (f.security.review === 'pending' || f.security.review === 'not-started'));
    return agg([open + ' sensitive unreviewed', count(fs, (f) => f.security.dataClass === 'payment') + ' card data', count(fs, (f) => f.security.dataClass === 'personal') + ' personal']);
  },
};

// ----------------------------------------------------------------------------------- quality
const quality: LensChannel = {
  density: 'standard',
  accent: ACCENTS.quality,
  shape: shapeComb,
  marks(a) {
    paint('quality', a, (m, d) => edgeComb(m.ctx, m.tile, m.f, d, m.accent, m.th), (m, r) => {
      const q = m.f.quality;
      if (!q.e2eTests) { m.ctx.strokeStyle = m.accent; m.ctx.lineWidth = 1; m.ctx.setLineDash([2, 2]); m.ctx.strokeRect(r.x + 0.5, r.y + r.h * 0.2 + 0.5, r.w - 1, r.h * 0.6 - 1); m.ctx.setLineDash([]); return; }
      bar(m.ctx, r, q.e2ePassing / q.e2eTests, m.accent, q.e2ePassing < q.e2eTests ? m.th.red : m.accent);
    }, (m) => {
      // L0/L1: a ruled tick per quarter of the end-to-end tests that pass, down the segment's right edge
      const { ctx, tile: t } = m, q = m.f.quality;
      if (!q.e2eTests) return;
      const n = Math.round((4 * q.e2ePassing) / q.e2eTests), pitch = t.h / 4.6, tw = Math.max(3, Math.min(6 * t.u, t.w * 0.3));
      ctx.fillStyle = m.accent;
      for (let i = 0; i < n; i++) ctx.fillRect(t.x + t.w - tw - 1, t.y + pitch * (i + 0.55), tw, Math.max(1.2, pitch * 0.42));
      if (n < 4) { ctx.fillStyle = q.status === 'failing' ? m.th.red : m.th.alpha(m.accent, 0.35); for (let i = n; i < 4; i++) ctx.fillRect(t.x + t.w - tw - 1, t.y + pitch * (i + 0.55), tw, Math.max(1.2, pitch * 0.42)); }
    });
  },
  content(f) {
    const q = f.quality;
    return {
      parts: [q.e2eTests ? q.e2ePassing + '/' + q.e2eTests + ' E2E' : isLiveSt(f.stage) ? 'NO E2E' : 'UNTESTED', q.openBugs.p1 ? q.openBugs.p1 + ' P1' : '', q.openBugs.p2 ? q.openBugs.p2 + ' P2' : ''].filter(Boolean),
      stamp: q.status === 'failing' ? 'Tests failing' : q.openBugs.p1 ? 'Open P1 bug' : undefined,
    };
  },
  aggregate(fs) {
    const t = fs.reduce((s, f) => s + f.quality.e2eTests, 0), p = fs.reduce((s, f) => s + f.quality.e2ePassing, 0);
    const p1 = fs.reduce((s, f) => s + f.quality.openBugs.p1, 0);
    return agg([p + '/' + t + ' tests pass', count(fs, (f) => isLiveSt(f.stage) && !f.quality.e2eTests) + ' live untested', p1 ? p1 + ' P1' : '']);
  },
};

export const CHANNELS: Record<LensId, LensChannel> = { business, design, development, operations, security, quality };
