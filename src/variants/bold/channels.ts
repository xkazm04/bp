// Bold's six lens channels: shape, marks, content and aggregates. Every lens draws an "instrument" in the
// tile's lower-right corner (a ledger, an artboard ladder, a terminal bar, a gauge, a seal, a checklist),
// plus at most one ornament around the tile (crop marks, a security perimeter). Marks are lines and small
// glyphs in the lens accent: they never fill the tile, so the stage fill stays the tile's colour.
// Budget: a handful of primitives per tile; no measureText; fonts are cached strings.
import type { Feature, Health } from '@/lib/data';
import { bl, ruled, type BuiltinLens } from '../base/legacy';
import { isLiveSt } from '@/lib/model';
import type { ChannelAggregate, LensChannel, MarkArgs, Rect, TileGeom, Theme } from '../types';
import { ACCENT } from './palette';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
const NODASH: number[] = [], DASH63 = [6, 3], DOT = [1.5, 3];
function count(fs: readonly Feature[], fn: (f: Feature) => boolean) { let n = 0; for (const f of fs) if (fn(f)) n++; return n; }
const kUsd = (n: number) => (n >= 1000 ? '$' + (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k' : '$' + n);

// ------------------------------------------------------------------------------------ fonts (cached)
const fontCache = new Map<string, string>();
/** A canvas font never below 12 px, cached per (size, weight, family). */
export function fontPx(th: Theme, px: number, wt = 600, mono = true): string {
  const p = Math.max(12, Math.round(px));
  const key = p + '|' + wt + '|' + (mono ? 1 : 0) + '|' + th.mono;
  let s = fontCache.get(key);
  if (!s) { s = wt + ' ' + p + 'px ' + (mono ? th.mono : th.sans); fontCache.set(key, s); }
  return s;
}

/** th.alpha without building a key string per call (marks run for every tile on every raster). */
const tints = new Map<string, Map<number, string>>();
export function tint(th: Theme, color: string, a: number): string {
  let m = tints.get(color);
  if (!m) { m = new Map(); tints.set(color, m); }
  let s = m.get(a);
  if (s == null) { s = th.alpha(color, a); m.set(a, s); }
  return s;
}

// ------------------------------------------------------------------------------------------ shared
/** General's compact cell: the lens's health, with a hairline cap in the lens accent along its top. */
function cell(a: MarkArgs, h: Health) {
  // while the cell flies to the instrument corner it keeps its strip size, so it never washes a tile
  const { ctx, th } = a, t = a.tile, x = a.r.x, y = a.r.y, w = Math.min(a.r.w, t.strip.w / 6), hh = Math.min(a.r.h, t.strip.h);
  if (h === 'bad') ctx.fillStyle = th.red;
  else if (h === 'watch') ctx.fillStyle = th.amber;
  else if (h === 'good') ctx.fillStyle = th.inkA(0.4);
  else ctx.fillStyle = th.inkA(0.1);
  ctx.fillRect(x, y, w, hh);
  if (hh >= 3 && a.x < 0.02) { ctx.fillStyle = a.accent; ctx.fillRect(x, y, w, 1); }
}

/** Crossfade: the General cell below, the lens instrument above; ribbons have no General cell. */
function forms(a: MarkArgs, h: Health, expanded: (a: MarkArgs) => void, ornament?: (a: MarkArgs) => void) {
  const { ctx } = a, ga = ctx.globalAlpha;
  if (a.tile.form === 'tile' && a.x < 0.6 && a.w > 0.03) { ctx.globalAlpha = ga * a.w * (1 - a.x / 0.6); cell(a, h); }
  if (a.x * a.w > 0.1) {
    ctx.globalAlpha = ga * a.w * a.x;
    expanded(a);
    if (ornament && a.tile.form === 'tile' && a.x * a.w > 0.25) { ctx.globalAlpha = ga * a.w * a.x; ornament(a); }
  }
  ctx.globalAlpha = ga;
}

/** Ribbon segments (L0/L1) and tiny tiles get one thin line at the foot of the band. */
function small(a: MarkArgs): boolean { return a.tile.form === 'ribbon' || a.r.h < 12 * a.tile.u || a.r.w < 34 * a.tile.u; }
function footLine(a: MarkArgs, frac: number, trackOnly = false) {
  const { ctx, r } = a, lh = Math.max(2, Math.min(4 * a.tile.u, r.h * 0.36)), y = r.y + r.h - lh;
  ctx.fillStyle = tint(a.th, a.accent, 0.32); ctx.fillRect(r.x, y, r.w, lh);
  if (!trackOnly && frac > 0) { ctx.fillStyle = a.accent; ctx.fillRect(r.x, y, r.w * clamp(frac, 0, 1), lh); }
}

// ------------------------------------------------------------------------------------------ shapes
/** Small fixtures keep the plain rectangle: a few px of outline would not read, and a curved clip per
 *  tile is the most expensive thing in a lens tween. */
function plain(p: Path2D, t: TileGeom): boolean {
  if (t.w >= 120 * t.u) return false;
  p.rect(t.x, t.y, t.w, t.h);
  return true;
}
function chamfer(p: CanvasPath, t: Rect, tl: number, tr: number, br: number, bl: number) {
  const { x, y, w, h } = t;
  p.moveTo(x + tl, y); p.lineTo(x + w - tr, y); p.lineTo(x + w, y + tr); p.lineTo(x + w, y + h - br);
  p.lineTo(x + w - br, y + h); p.lineTo(x + bl, y + h); p.lineTo(x, y + h - bl); p.lineTo(x, y + tl); p.closePath();
}
function rounded(p: Path2D, t: Rect, rad: number) {
  if (rad <= 0.01) { p.rect(t.x, t.y, t.w, t.h); return; }
  p.roundRect(t.x, t.y, t.w, t.h, rad);
}

// ---------------------------------------------------------------------------------------- business
const business: LensChannel = {
  density: 'standard',
  accent: ACCENT.business,
  shape(p, t, _f, w) {
    if (plain(p, t)) return;
    // a ticket: two half-round notches at mid-height, deeper as the lens takes over
    const r = Math.min(6 * t.u, t.h / 7) * w, cy = t.y + t.h / 2, { x, y } = t, X = x + t.w, Y = y + t.h;
    p.moveTo(x, y); p.lineTo(X, y); p.lineTo(X, cy - r);
    if (r > 0.05) p.arc(X, cy, r, -Math.PI / 2, Math.PI / 2, true);
    p.lineTo(X, Y); p.lineTo(x, Y); p.lineTo(x, cy + r);
    if (r > 0.05) p.arc(x, cy, r, Math.PI / 2, -Math.PI / 2, true);
    p.closePath();
  },
  marks(a) {
    forms(a, bl(a.f).business.health, (m) => {
      const b = bl(m.f).business, asks = clamp((b.customerRequests30d || 0) / 30, 0, 1);
      if (small(m)) { footLine(m, b.value / 5); return; }
      const { ctx, r, th } = m, u = m.tile.u;
      // value as five pips (filled = value), customer asks as a bar under them, $ when revenue is direct
      const s = Math.min(r.h * 0.42, 8 * u), gap = s * 0.55, y0 = r.y + 1;
      ctx.strokeStyle = m.accent; ctx.fillStyle = m.accent; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const px = r.x + i * (s + gap);
        if (i < b.value) ctx.fillRect(px, y0, s, s); else ctx.strokeRect(px + 0.5, y0 + 0.5, s - 1, s - 1);
      }
      const by = r.y + r.h - Math.max(2, 3 * u), bw = r.w;
      ctx.fillStyle = tint(th, m.accent, 0.25); ctx.fillRect(r.x, by, bw, Math.max(2, 3 * u));
      if (asks > 0) { ctx.fillStyle = m.accent; ctx.fillRect(r.x, by, bw * asks, Math.max(2, 3 * u)); }
      if (b.revenueLink === 'direct' && r.w > 5 * (s + gap) + 16 * u) {
        ctx.font = fontPx(th, 13 * u, 700); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('$', r.x + r.w, y0 + s + 1);
      }
    });
  },
  content(f) {
    const b = bl(f).business, asks = b.customerRequests30d || 0;
    const money = b.mrrImpactUsd ? kUsd(b.mrrImpactUsd) + '/mo' : b.revenueLink === 'none' ? 'no revenue link' : b.revenueLink;
    return {
      parts: [asks ? asks + (asks === 1 ? ' ask' : ' asks') : 'no asks', money, 'value ' + b.value + '/5'],
      stamp: ruled(f, 'business', 'customerRequests30d') ? 'Customers are waiting' : b.value >= 4 && (f.stage === 'idea' || f.stage === 'specified') ? 'High value, not started' : undefined,
    };
  },
  aggregate(fs): ChannelAggregate {
    const rq = fs.reduce((s, f) => s + (bl(f).business.customerRequests30d || 0), 0);
    const mrr = fs.reduce((s, f) => s + (bl(f).business.revenueLink === 'direct' ? bl(f).business.mrrImpactUsd || 0 : 0), 0);
    return { parts: [rq + ' customer asks', kUsd(mrr) + '/mo direct revenue', count(fs, (f) => bl(f).business.value >= 4) + ' high value'] };
  },
};

// ------------------------------------------------------------------------------------------ design
const FIDELITY: Record<string, number> = { none: 0, sketch: 1, wireframe: 2, 'hi-fi': 3, implemented: 4, polished: 5 };
const design: LensChannel = {
  density: 'simple',
  accent: ACCENT.design,
  shape(p, t, _f, w) { if (plain(p, t)) return; rounded(p, t, Math.min(12 * t.u, t.h / 5) * w); },
  marks(a) {
    forms(a, bl(a.f).design.health, (m) => {
      const de = bl(m.f).design, lv = FIDELITY[de.status];
      if (lv == null) return; // n/a
      if (small(m)) { footLine(m, lv / 5, lv === 0); return; }
      const { ctx, r, th } = m, u = m.tile.u;
      // the fidelity ladder: five little artboards, sketch -> polished; filled up to the current step
      const s = Math.min(r.h * 0.62, 11 * u), gap = s * 0.45, y0 = r.y + r.h - s - 1;
      ctx.lineWidth = 1; ctx.strokeStyle = m.accent; ctx.fillStyle = m.accent;
      if (lv === 0) ctx.setLineDash([2, 2]);
      for (let i = 0; i < 5; i++) {
        const px = r.x + r.w - (5 - i) * (s + gap) + gap;
        if (i < lv) ctx.fillRect(px, y0, s, s); else ctx.strokeRect(px + 0.5, y0 + 0.5, s - 1, s - 1);
      }
      ctx.setLineDash([]);
      if (de.a11y === 'fail' || de.specDrift) {
        // a red ring left of the ladder: fails accessibility (slashed) or built off-spec (open)
        const cx = r.x + r.w - 5 * (s + gap) - s * 0.2, cy = y0 + s / 2, rr = s * 0.5;
        ctx.strokeStyle = th.red; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU);
        if (de.a11y === 'fail') { ctx.moveTo(cx - rr * 0.7, cy + rr * 0.7); ctx.lineTo(cx + rr * 0.7, cy - rr * 0.7); }
        ctx.stroke();
      }
    }, (m) => {
      // crop marks just outside the tile's corners: every fixture reads as an artboard
      const t = m.tile, u = t.u, gap = 10 * t.k; if (t.w < 40 * u || gap < 8) return;
      const g = Math.min(3 * u, gap * 0.2), L = Math.min(7 * u, gap * 0.45), { ctx } = m, x0 = t.x, y0 = t.y, x1 = t.x + t.w, y1 = t.y + t.h;
      ctx.strokeStyle = m.accent; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(x0 - g - L, y0); ctx.lineTo(x0 - g, y0); ctx.moveTo(x0, y0 - g - L); ctx.lineTo(x0, y0 - g);
      ctx.moveTo(x1 + g, y0); ctx.lineTo(x1 + g + L, y0); ctx.moveTo(x1, y0 - g - L); ctx.lineTo(x1, y0 - g);
      ctx.moveTo(x0 - g - L, y1); ctx.lineTo(x0 - g, y1); ctx.moveTo(x0, y1 + g); ctx.lineTo(x0, y1 + g + L);
      ctx.moveTo(x1 + g, y1); ctx.lineTo(x1 + g + L, y1); ctx.moveTo(x1, y1 + g); ctx.lineTo(x1, y1 + g + L);
      ctx.stroke();
    });
  },
  content(f) {
    const de = bl(f).design;
    const words: Record<string, string> = { none: 'No design yet', sketch: 'Sketch', wireframe: 'Wireframe', 'hi-fi': 'Hi-fi design', implemented: 'Built to design', polished: 'Polished', 'n/a': 'No screen' };
    return {
      parts: [de.a11y === 'fail' ? 'Fails accessibility' : words[de.status] ?? de.status],
      stamp: de.a11y === 'fail' ? 'Fails accessibility' : de.specDrift ? 'Built off-spec' : undefined,
    };
  },
  aggregate(fs) {
    return { parts: [count(fs, (f) => bl(f).design.status === 'polished' || bl(f).design.status === 'implemented') + ' built to design', count(fs, (f) => bl(f).design.status === 'none' && f.stage !== 'idea') + ' without design', count(fs, (f) => bl(f).design.a11y === 'fail') + ' fail accessibility'] };
  },
};

// ------------------------------------------------------------------------------------- development
function diamond(a: MarkArgs, ga0: number) {
  const { ctx, th, tile: t } = a, u = t.u, dv = bl(a.f).development;
  if (!(a.stage && a.now && dv.humanReviewed === false && t.form === 'tile' && t.w < 150 * u && t.w >= 26 * u)) return;
  const dx = t.x + t.w - 7 * u, dy = t.y + t.h - 7 * u, dd = Math.max(2.5 * u, Math.min(4.5 * u, t.w / 28));
  ctx.globalAlpha = ga0 * a.w; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(dx, dy - dd); ctx.lineTo(dx + dd * 0.8, dy); ctx.lineTo(dx, dy + dd); ctx.lineTo(dx - dd * 0.8, dy); ctx.closePath(); ctx.stroke();
}
const development: LensChannel = {
  density: 'dense',
  accent: ACCENT.development,
  shape(p, t, _f, w) { if (plain(p, t)) return; const c = Math.min(7 * t.u, t.h / 8) * w; chamfer(p, t, c, c, c, c); },
  marks(a) {
    const ga0 = a.ctx.globalAlpha;
    forms(a, bl(a.f).development.health, (m) => {
      const dv = bl(m.f).development, prog = m.live.progressPct / 100;
      if (small(m)) { footLine(m, prog); return; }
      const { ctx, r, th } = m, u = m.tile.u;
      // a terminal progress bar of block cells, and the agent-written share as a hairline under it
      const n = clamp(Math.floor(r.w / (8 * u)), 5, 14), gap = Math.max(1, 1.5 * u), cw = (r.w - gap * (n - 1)) / n;
      const ch = Math.min(r.h * 0.5, 9 * u), y0 = r.y + r.h - ch - 5 * u, on = Math.round(prog * n);
      for (let i = 0; i < n; i++) {
        const px = r.x + i * (cw + gap);
        if (i < on) { ctx.fillStyle = m.accent; ctx.fillRect(px, y0, cw, ch); }
        else { ctx.fillStyle = tint(th, m.accent, 0.22); ctx.fillRect(px, y0 + ch - 2, cw, 2); }
      }
      const ay = r.y + r.h - 2 * u;
      ctx.fillStyle = th.inkA(0.25); ctx.fillRect(r.x, ay, r.w, 1.5);
      ctx.fillStyle = m.accent; ctx.fillRect(r.x, ay - 0.5, r.w * dv.aiAuthoredPct / 100, 2.5);
    });
    diamond(a, ga0);
  },
  content(f, live) {
    const dv = bl(f).development;
    return {
      parts: [
        dv.progressPct < 100 ? Math.round(live.progressPct) + '%' : dv.status === 'merged' ? 'MERGED' : 'DONE',
        'AI ' + dv.aiAuthoredPct + '%',
        dv.unitCoveragePct != null && dv.progressPct > 0 ? 'COV ' + dv.unitCoveragePct : '',
        dv.openPRs ? dv.openPRs + ' PR' : dv.techDebt ? 'DEBT ' + dv.techDebt : '',
      ].filter(Boolean),
      stamp: dv.humanReviewed === false ? 'No human review' : dv.stalled ? 'Stalled' : undefined,
    };
  },
  aggregate(fs) {
    const prs = fs.reduce((s, f) => s + (bl(f).development.openPRs || 0), 0);
    return { parts: [count(fs, (f) => bl(f).development.humanReviewed === false) + ' unreviewed', Math.round(fs.reduce((s, f) => s + bl(f).development.aiAuthoredPct, 0) / Math.max(1, fs.length)) + '% agent-written', prs + ' open PRs', count(fs, (f) => (bl(f).development.unitCoveragePct ?? Infinity) < 50) + ' thin coverage'] };
  },
};

// -------------------------------------------------------------------------------------- operations
const operations: LensChannel = {
  density: 'dense',
  accent: ACCENT.operations,
  shape(p, t, _f, w) { if (plain(p, t)) return; rounded(p, t, Math.min(t.h / 2, 20 * t.u) * w); },
  marks(a) {
    forms(a, bl(a.f).operations.health, (m) => {
      const op = bl(m.f).operations, prod = op.environment === 'production';
      const rp = prod ? (op.flag ? m.live.rolloutPct : 100) / 100 : 0;
      if (small(m)) { if (op.environment !== 'none') footLine(m, prod ? rp : 1, !prod); return; }
      const { ctx, r, th } = m, u = m.tile.u;
      // a dial: rollout on a half-circle, with a needle; dashed when only on staging or preview
      const R = Math.max(5 * u, Math.min(r.h - 3 * u, r.w / 4, 15 * u)), cx = r.x + r.w - R - 1, cy = r.y + r.h - 1;
      ctx.lineWidth = Math.max(2, 2.5 * u); ctx.lineCap = 'butt';
      ctx.strokeStyle = tint(th, m.accent, op.environment === 'none' ? 0.18 : 0.3);
      if (!prod && op.environment !== 'none') ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, TAU); ctx.stroke(); ctx.setLineDash([]);
      if (prod) {
        ctx.strokeStyle = m.accent; ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, Math.PI + Math.PI * rp); ctx.stroke();
        const an = Math.PI + Math.PI * rp; ctx.lineWidth = 1.2; ctx.strokeStyle = th.ink;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(an) * R * 0.8, cy + Math.sin(an) * R * 0.8); ctx.stroke();
        // latency and errors as two ticks on a scale to the left of the dial
        const sx = r.x, sw = Math.max(0, cx - R - 6 * u - sx);
        if (sw > 14 * u) {
          const lat = clamp((op.p95ms ?? 0) / 800, 0, 1), err = clamp((op.errorRatePct ?? 0) / 2, 0, 1), h2 = Math.max(2, 2.5 * u);
          ctx.fillStyle = th.inkA(0.2); ctx.fillRect(sx, cy - h2 * 3.2, sw, h2); ctx.fillRect(sx, cy - h2, sw, h2);
          ctx.fillStyle = m.accent; ctx.fillRect(sx, cy - h2 * 3.2, sw * lat, h2);
          ctx.fillStyle = err > 0.5 ? th.red : m.accent; ctx.fillRect(sx, cy - h2, sw * err, h2);
        }
        if (!op.alerting) { ctx.strokeStyle = th.red; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(cx + R + 1, cy - R); ctx.lineTo(cx + R + 1, cy); ctx.stroke(); }
      }
    });
  },
  content(f, live) {
    const op = bl(f).operations;
    if (op.environment !== 'production') return { parts: [op.environment === 'none' ? 'NOT DEPLOYED' : op.environment.toUpperCase()] };
    return {
      parts: [(op.flag ? live.rolloutPct : 100) + '% OUT', op.p95ms != null ? 'P95 ' + op.p95ms : '', op.errorRatePct != null ? 'ERR ' + op.errorRatePct + '%' : '', op.incidents30d ? op.incidents30d + ' INC' : ''].filter(Boolean),
      stamp: !op.alerting ? 'Live, no alerting' : !op.runbook ? 'No runbook' : undefined,
    };
  },
  aggregate(fs) {
    return { parts: [count(fs, (f) => bl(f).operations.environment === 'production') + ' in production', count(fs, (f) => bl(f).operations.environment === 'production' && !bl(f).operations.alerting) + ' without alerting', fs.reduce((s, f) => s + (bl(f).operations.incidents30d || 0), 0) + ' incidents · 30 d'] };
  },
};

// ---------------------------------------------------------------------------------------- security
const SENS: Record<string, number> = { payment: 3, personal: 2, internal: 1, public: 0 };
const security: LensChannel = {
  density: 'standard',
  accent: ACCENT.security,
  shape(p, t, f, w) {
    if (plain(p, t)) return;
    // a shield: the top corners are cut, deeper for more sensitive data
    const c = Math.min(4 * SENS[bl(f).security.dataClass] * t.u, t.h / 5) * w;
    chamfer(p, t, c, c, 0, 0);
  },
  marks(a) {
    forms(a, bl(a.f).security.health, (m) => {
      const se = bl(m.f).security, lvl = SENS[se.dataClass] ?? 0;
      const { ctx, r, th } = m, u = m.tile.u;
      if (small(m)) {
        if (!lvl) return;
        // card data: a double rule; personal: a single rule; internal: a short rule (no dashes: cheap)
        const y = r.y + r.h - 2, lw = lvl === 1 ? r.w * 0.4 : r.w;
        ctx.fillStyle = m.accent; ctx.fillRect(r.x, y, lw, 1.5);
        if (lvl === 3) ctx.fillRect(r.x, y - 3, lw, 1.5);
        return;
      }
      if (se.review === 'not-required' && !lvl) return;
      // the seal: solid with a tick when review passed, a dashed ring while pending, red with the count on findings
      const R = Math.max(6 * u, Math.min(r.h / 2 - 1, 11 * u)), cx = r.x + r.w - R - 1, cy = r.y + r.h - R - 1;
      ctx.lineWidth = 1.5;
      if (se.review === 'passed') {
        ctx.fillStyle = m.accent; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
        ctx.strokeStyle = th.paper; ctx.lineWidth = Math.max(1.5, 1.8 * u); ctx.beginPath();
        ctx.moveTo(cx - R * 0.42, cy); ctx.lineTo(cx - R * 0.1, cy + R * 0.34); ctx.lineTo(cx + R * 0.45, cy - R * 0.36); ctx.stroke();
      } else if (se.review === 'findings') {
        ctx.strokeStyle = th.red; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
        if (R >= 8) { ctx.fillStyle = th.red2; ctx.font = fontPx(th, 12 * u, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(se.openFindings), cx, cy + 0.5); }
      } else if (se.review === 'pending' || se.review === 'not-started') {
        ctx.strokeStyle = m.accent; ctx.setLineDash(se.review === 'pending' ? [3, 2] : [1, 2.5]);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.35, 0, TAU); ctx.stroke();
      }
    }, (m) => {
      // the perimeter: a fence just inside the tile, double for card data, dashed for personal data
      const lvl = SENS[bl(m.f).security.dataClass] ?? 0; if (!lvl) return;
      const { ctx } = m, t = m.tile, u = t.u, i = 4 * u, c = Math.min(4 * lvl * u, t.h / 5) + i * 0.4;
      const x = t.x + i, y = t.y + i, w = t.w - 2 * i, h = t.h - 2 * i;
      if (w < 20 || h < 14) return;
      ctx.strokeStyle = m.accent; ctx.lineWidth = 1.2;
      const big = t.w >= 160 * u;
      ctx.setLineDash(lvl === 3 || !big ? NODASH : lvl === 2 ? DASH63 : DOT);
      if (!big && lvl < 3) ctx.globalAlpha *= lvl === 2 ? 0.8 : 0.45;
      ctx.beginPath(); chamfer(ctx, { x, y, w, h }, c, c, 0, 0); ctx.stroke();
      if (lvl === 3) { const j = 3 * u; ctx.setLineDash(big ? DASH63 : NODASH); ctx.beginPath(); chamfer(ctx, { x: x + j, y: y + j, w: w - 2 * j, h: h - 2 * j }, c, c, 0, 0); ctx.stroke(); }
      ctx.setLineDash(NODASH);
    });
  },
  content(f, live) {
    const se = bl(f).security;
    const cls: Record<string, string> = { payment: 'CARD DATA', personal: 'PERSONAL DATA', internal: 'INTERNAL', public: 'PUBLIC' };
    const rev: Record<string, string> = { 'not-required': 'NO REVIEW NEEDED', 'not-started': 'NOT REVIEWED', pending: 'REVIEW PENDING', passed: 'REVIEWED', findings: se.openFindings + ' FINDINGS' };
    const sensitive = se.dataClass === 'payment' || se.dataClass === 'personal';
    const liveNow = isLiveSt(f.stage) && live.rolloutPct > 0;
    return {
      parts: [cls[se.dataClass] ?? se.dataClass.toUpperCase(), rev[se.review] ?? se.review.toUpperCase()],
      stamp: se.review === 'findings' ? 'Open security findings' : sensitive && liveNow && (se.review === 'not-started' || se.review === 'pending') ? 'Live, unreviewed' : undefined,
    };
  },
  aggregate(fs) {
    return { parts: [count(fs, (f) => bl(f).security.dataClass === 'payment') + ' card data', count(fs, (f) => bl(f).security.dataClass === 'personal') + ' personal data', count(fs, (f) => (bl(f).security.dataClass === 'payment' || bl(f).security.dataClass === 'personal') && (bl(f).security.review === 'pending' || bl(f).security.review === 'not-started')) + ' unreviewed', fs.reduce((s, f) => s + bl(f).security.openFindings, 0) + ' findings'] };
  },
};

// ----------------------------------------------------------------------------------------- quality
const quality: LensChannel = {
  density: 'standard',
  accent: ACCENT.quality,
  shape(p, t, _f, w) { if (plain(p, t)) return; const c = Math.min(10 * t.u, t.h / 5) * w; chamfer(p, t, c, 0, 0, c); },
  marks(a) {
    forms(a, bl(a.f).quality.health, (m) => {
      const q = bl(m.f).quality, pp = q.e2eTests ? q.e2ePassing / q.e2eTests : 0;
      if (small(m)) { if (q.e2eTests) footLine(m, pp); return; }
      const { ctx, r, th } = m, u = m.tile.u;
      // the checklist: one box per end-to-end test (up to 8), ticked when it passes, crossed when it fails
      const n = Math.min(q.e2eTests, 8), s = Math.min(r.h * 0.55, 9 * u), gap = s * 0.4, y0 = r.y + r.h - s - 1;
      const pass = q.e2eTests ? Math.round(n * pp) : 0;
      ctx.lineWidth = 1;
      if (!n) { ctx.strokeStyle = tint(th, m.accent, 0.7); ctx.setLineDash([2, 2]); ctx.strokeRect(r.x + r.w - s + 0.5, y0 + 0.5, s - 1, s - 1); ctx.setLineDash([]); }
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = r.x + r.w - (n - i) * (s + gap) + gap;
        if (px < r.x) continue;
        ctx.strokeStyle = m.accent; ctx.strokeRect(px + 0.5, y0 + 0.5, s - 1, s - 1);
        if (i < pass) { ctx.moveTo(px + s * 0.2, y0 + s * 0.52); ctx.lineTo(px + s * 0.42, y0 + s * 0.75); ctx.lineTo(px + s * 0.82, y0 + s * 0.25); }
      }
      ctx.lineWidth = 1.5; ctx.stroke();
      if (pass < n) {
        ctx.strokeStyle = th.red; ctx.beginPath();
        for (let i = pass; i < n; i++) { const px = r.x + r.w - (n - i) * (s + gap) + gap; if (px < r.x) continue; ctx.moveTo(px + s * 0.22, y0 + s * 0.22); ctx.lineTo(px + s * 0.78, y0 + s * 0.78); ctx.moveTo(px + s * 0.78, y0 + s * 0.22); ctx.lineTo(px + s * 0.22, y0 + s * 0.78); }
        ctx.stroke();
      }
      // open P1 bugs as red dots above the checklist
      const p1 = Math.min(q.openBugs.p1, 4);
      if (p1) { ctx.fillStyle = th.red; for (let i = 0; i < p1; i++) { ctx.beginPath(); ctx.arc(r.x + r.w - s / 2 - i * (s * 0.9), y0 - s * 0.55, Math.max(2, s * 0.24), 0, TAU); ctx.fill(); } }
    });
  },
  content(f) {
    const q = bl(f).quality, b = q.openBugs;
    return {
      parts: [q.e2eTests ? q.e2ePassing + '/' + q.e2eTests + ' E2E' : isLiveSt(f.stage) ? 'NO E2E' : 'UNTESTED', b.p1 ? b.p1 + ' P1' : b.p2 ? b.p2 + ' P2' : '0 BUGS'],
      stamp: q.status === 'failing' ? 'Tests failing' : b.p1 ? 'Open P1 bug' : undefined,
    };
  },
  aggregate(fs) {
    const t = fs.reduce((s, f) => s + bl(f).quality.e2eTests, 0), p = fs.reduce((s, f) => s + bl(f).quality.e2ePassing, 0);
    return { parts: [p + '/' + t + ' e2e passing', fs.reduce((s, f) => s + bl(f).quality.openBugs.p1, 0) + ' open P1', count(fs, (f) => bl(f).quality.status === 'untested' && isLiveSt(f.stage)) + ' live untested'] };
  },
};

export const CHANNELS: Record<BuiltinLens, LensChannel> = { business, design, development, operations, security, quality };

/** The rect a lone lens's instrument grows into: the tile's lower-right corner (the band on ribbons). */
export function instrumentRect(t: TileGeom): Rect {
  const b = t.body, u = t.u;
  if (t.form === 'ribbon') return { x: b.x, y: b.y + b.h * 0.5, w: b.w, h: b.h * 0.5 };
  if (!t.text) return { x: b.x + 2 * u, y: b.y + b.h * 0.58, w: b.w - 4 * u, h: b.h * 0.42 - 2 * u };
  const w = Math.min(b.w * 0.46, 150 * u), h = clamp(b.h * 0.3, 14 * u, 30 * u);
  return { x: b.x + b.w - w - 22 * u, y: b.y + b.h - h - 4 * u, w, h };
}
