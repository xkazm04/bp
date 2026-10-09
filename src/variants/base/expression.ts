// The base lens expression: A/1's lens behaviour, re-expressed under the no-recolour rule.
// A/1 recoloured whole tiles per lens; here the stage fill always stays and each lens speaks through
// an evidence band at the foot of the tile (hatches, bars, frames in its accent ink), its own evidence
// text and stamp, and its own place aggregates. In General each lens is one small health cell in the
// strip along the tile's top edge: the six cells together are the General reading.
import type { Feature, Health, LensId } from '@/lib/data';
import { isLiveSt } from '@/lib/model';
import type { ChannelAggregate, LensChannel, LensExpression, MarkArgs, Rect, TileGeom } from '../types';

export const LENS_ORDER: LensId[] = ['business', 'design', 'development', 'operations', 'security', 'quality'];

/** A/1's sheet accents, darkened for paper in the light theme. */
export const BASE_ACCENTS: Record<LensId, { dark: string; light: string }> = {
  business: { dark: '#93f0c6', light: '#11865a' },
  design: { dark: '#f2b6ff', light: '#9c3fb5' },
  development: { dark: '#8fd0ff', light: '#1f6fb2' },
  operations: { dark: '#7ff0e0', light: '#0f8a7c' },
  security: { dark: '#ffa58a', light: '#c4502c' },
  quality: { dark: '#cdbbff', light: '#6a4fc4' },
};

// ----------------------------------------------------------------------------------------- helpers
/** Compact General cell: the lens's health for this feature. */
export function healthCell(a: MarkArgs, h: Health) {
  const { ctx, r, th } = a;
  ctx.globalAlpha *= a.w;
  if (h === 'bad') ctx.fillStyle = th.red;
  else if (h === 'watch') ctx.fillStyle = th.amber;
  else if (h === 'good') ctx.fillStyle = th.inkA(0.42);
  else ctx.fillStyle = th.inkA(0.1);
  ctx.fillRect(r.x, r.y, r.w, r.h);
}
/** The evidence band: the lower part of the tile body (bottom half on small segments). */
export function band(tile: TileGeom): Rect {
  const b = tile.body;
  const f = tile.text ? 0.34 : 0.55;
  return { x: b.x, y: b.y + b.h * (1 - f), w: b.w, h: b.h * f };
}
/** Crossfade helper: compact (health cell) below x = 0.5, expanded marks above. */
function twoForms(a: MarkArgs, h: Health, expanded: (a: MarkArgs) => void) {
  const { ctx } = a;
  const ga = ctx.globalAlpha;
  if (a.x < 0.999) { ctx.globalAlpha = ga * (1 - a.x); healthCell(a, h); ctx.globalAlpha = ga; }
  if (a.x > 0.001) { ctx.globalAlpha = ga * a.x * a.w; expanded(a); ctx.globalAlpha = ga; }
}
function fillPat(a: MarkArgs, kind: 'diag' | 'back' | 'cross' | 'dots', size: number, lw: number, alpha = 0.9) {
  const p = a.th.pattern({ kind, size, color: a.th.alpha(a.accent, alpha), lw });
  if (!p) return;
  a.ctx.fillStyle = p; a.ctx.fillRect(a.r.x, a.r.y, a.r.w, a.r.h);
}
function frame(a: MarkArgs, lw: number) {
  const { ctx, r } = a;
  ctx.strokeStyle = a.accent; ctx.lineWidth = lw;
  ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, Math.max(0, r.w - lw), Math.max(0, r.h - lw));
}
function count(fs: readonly Feature[], fn: (f: Feature) => boolean) { let n = 0; for (const f of fs) if (fn(f)) n++; return n; }

// ---------------------------------------------------------------------------------------- channels
const business: LensChannel = {
  density: 'simple',
  accent: BASE_ACCENTS.business,
  marks(a) {
    twoForms(a, a.f.business.health, (m) => {
      const v = m.f.business.value, { ctx, r } = m;
      // value as the weight of an inset frame; customer demand as a bar along the band's foot
      frame(m, Math.max(0.8, Math.min(5 * m.tile.u, v * 0.9 * Math.min(1, r.w / 60))));
      const asks = Math.min(1, (m.f.business.customerRequests30d || 0) / 30);
      if (asks > 0) { ctx.fillStyle = m.accent; ctx.fillRect(r.x + 2, r.y + r.h - Math.max(2, r.h * 0.18), (r.w - 4) * asks, Math.max(2, r.h * 0.18)); }
    });
  },
  content(f) {
    const b = f.business;
    return { parts: ['VALUE ' + b.value, b.customerRequests30d ? b.customerRequests30d + ' ASKS' : '', b.revenueLink === 'direct' ? '$' : ''].filter(Boolean) };
  },
  aggregate(fs): ChannelAggregate {
    const rq = fs.reduce((s, f) => s + (f.business.customerRequests30d || 0), 0);
    return { parts: [rq + ' customer asks', count(fs, (f) => f.business.value >= 4) + ' high value'] };
  },
};

const DESIGN_PAT: Record<string, ['diag' | 'cross' | 'dots', number] | undefined> = { sketch: ['diag', 9], wireframe: ['diag', 5], 'hi-fi': ['cross', 4.5], implemented: ['dots', 5] };
const design: LensChannel = {
  density: 'simple',
  accent: BASE_ACCENTS.design,
  marks(a) {
    twoForms(a, a.f.design.health, (m) => {
      const st = m.f.design.status, p = DESIGN_PAT[st];
      if (p) fillPat(m, p[0], p[1], 0.8, 0.75);
      else if (st === 'polished') frame(m, 1.5);
      if (m.f.design.a11y === 'fail') { m.ctx.strokeStyle = m.th.red; m.ctx.lineWidth = 1.6; m.ctx.beginPath(); m.ctx.moveTo(m.r.x, m.r.y + m.r.h); m.ctx.lineTo(m.r.x + m.r.w, m.r.y); m.ctx.stroke(); }
    });
  },
  content(f) {
    const words: Record<string, string> = { none: 'NO DESIGN', sketch: 'SKETCH', wireframe: 'WIREFRAME', 'hi-fi': 'HI-FI', implemented: 'BUILT', polished: 'POLISHED', 'n/a': 'N/A' };
    return { parts: [words[f.design.status], f.design.a11y === 'fail' ? 'A11Y FAIL' : ''].filter(Boolean), stamp: f.design.a11y === 'fail' ? 'Fails accessibility' : f.design.specDrift ? 'Built off-spec' : undefined };
  },
  aggregate(fs) { return { parts: [count(fs, (f) => f.design.a11y === 'fail') + ' fail accessibility', count(fs, (f) => f.design.status === 'none' && f.stage !== 'idea') + ' without design'] }; },
};

const development: LensChannel = {
  density: 'dense',
  accent: BASE_ACCENTS.development,
  marks(a) {
    const { ctx, th } = a, dv = a.f.development, ga0 = ctx.globalAlpha;
    twoForms(a, dv.health, (m) => {
      ctx.fillStyle = th.alpha(m.accent, 0.55); ctx.fillRect(m.r.x, m.r.y + m.r.h - Math.max(2, m.r.h * 0.22), m.r.w * (m.live.progressPct / 100), Math.max(2, m.r.h * 0.22));
      const aw = Math.max(2, Math.min(5 * m.tile.u, m.r.w * 0.04));
      ctx.fillStyle = m.accent; ctx.fillRect(m.r.x + m.r.w - aw - 1, m.r.y + m.r.h - (m.r.h * dv.aiAuthoredPct) / 100, aw, (m.r.h * dv.aiAuthoredPct) / 100);
    });
    // the "no human review" diamond belongs to development; General shows it too (A/1)
    const t = a.tile, u = t.u;
    if (a.stage && a.now && dv.humanReviewed === false && t.form === 'tile' && t.w < 150 * u && t.w >= 26 * u) {
      const dx = t.x + t.w - 7 * u, dy = t.y + t.h - 7 * u, dd = Math.max(2.5 * u, Math.min(4.5 * u, t.w / 28));
      ctx.globalAlpha = ga0 * a.w; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(dx, dy - dd); ctx.lineTo(dx + dd * 0.8, dy); ctx.lineTo(dx, dy + dd); ctx.lineTo(dx - dd * 0.8, dy); ctx.closePath(); ctx.stroke();
    }
  },
  content(f, live) {
    const dv = f.development;
    return {
      parts: [dv.progressPct < 100 ? Math.round(live.progressPct) + '%' : '', 'AI ' + dv.aiAuthoredPct + '%', dv.unitCoveragePct != null && dv.progressPct > 0 ? 'COV ' + dv.unitCoveragePct : '', dv.openPRs ? dv.openPRs + ' PR' : ''].filter(Boolean),
      stamp: dv.humanReviewed === false ? 'No human review' : dv.stalled ? 'Stalled' : undefined,
    };
  },
  aggregate(fs) {
    return { parts: [count(fs, (f) => f.development.humanReviewed === false) + ' not human-reviewed', Math.round(fs.reduce((s, f) => s + f.development.aiAuthoredPct, 0) / Math.max(1, fs.length)) + '% by agents', count(fs, (f) => f.development.unitCoveragePct != null && f.development.unitCoveragePct < 50) + ' thin coverage'] };
  },
};

const operations: LensChannel = {
  density: 'dense',
  accent: BASE_ACCENTS.operations,
  marks(a) {
    twoForms(a, a.f.operations.health, (m) => {
      const op = m.f.operations, { ctx, r } = m;
      if (op.environment === 'production') {
        const rp = op.flag ? m.live.rolloutPct : 100;
        ctx.fillStyle = m.th.alpha(m.accent, 0.5); ctx.fillRect(r.x, r.y, (r.w * rp) / 100, r.h);
        ctx.strokeStyle = m.accent; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        if (!op.alerting) { ctx.strokeStyle = m.th.red; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(r.x + r.w - 2, r.y); ctx.lineTo(r.x + r.w - 2, r.y + r.h); ctx.stroke(); }
      } else if (op.environment === 'staging' || op.environment === 'preview') fillPat(m, 'dots', 5, 0.9);
    });
  },
  content(f, live) {
    const op = f.operations;
    if (op.environment !== 'production') return { parts: [op.environment === 'none' ? 'NOT DEPLOYED' : op.environment.toUpperCase()] };
    return {
      parts: [(op.flag ? live.rolloutPct : 100) + '%', op.p95ms != null ? op.p95ms + 'MS' : '', op.errorRatePct != null ? op.errorRatePct + '% ERR' : '', op.incidents30d ? op.incidents30d + ' INC' : ''].filter(Boolean),
      stamp: !op.alerting ? 'No alerting' : !op.runbook ? 'No runbook' : undefined,
    };
  },
  aggregate(fs) { return { parts: [count(fs, (f) => f.operations.environment === 'production' && !f.operations.alerting) + ' live without alerting', count(fs, (f) => f.operations.incidents30d > 0) + ' with incidents'] }; },
};

const SEC_PAT: Record<string, ['cross' | 'back' | 'dots', number, number] | undefined> = { payment: ['cross', 4, 0.9], personal: ['back', 6, 1], internal: ['dots', 6, 0.9] };
const security: LensChannel = {
  density: 'standard',
  accent: BASE_ACCENTS.security,
  marks(a) {
    twoForms(a, a.f.security.health, (m) => {
      const p = SEC_PAT[m.f.security.dataClass];
      if (p) fillPat(m, p[0], p[1], p[2], 0.85);
      const se = m.f.security;
      if ((se.dataClass === 'payment' || se.dataClass === 'personal') && (se.review === 'not-started' || se.review === 'pending')) frame(m, 1.6);
    });
  },
  content(f, live) {
    const se = f.security;
    const rev: Record<string, string> = { 'not-required': 'NO REVIEW NEEDED', 'not-started': 'NO REVIEW', pending: 'PENDING', passed: 'PASSED', findings: se.openFindings + ' FINDINGS' };
    const sensitive = se.dataClass === 'payment' || se.dataClass === 'personal';
    const live2 = isLiveSt(f.stage) && live.rolloutPct > 0;
    return { parts: [se.dataClass.toUpperCase(), rev[se.review]], stamp: sensitive && live2 && (se.review === 'not-started' || se.review === 'pending') ? 'Live, unreviewed' : undefined };
  },
  aggregate(fs) { return { parts: [count(fs, (f) => f.security.dataClass === 'payment' || f.security.dataClass === 'personal') + ' touch card or personal data', count(fs, (f) => f.flags.includes('security-gap')) + ' review gaps'] }; },
};

const quality: LensChannel = {
  density: 'standard',
  accent: BASE_ACCENTS.quality,
  marks(a) {
    twoForms(a, a.f.quality.health, (m) => {
      const q = m.f.quality, { ctx, r, th } = m;
      if (q.e2eTests > 0) {
        const pp = q.e2ePassing / q.e2eTests;
        ctx.fillStyle = th.alpha(m.accent, 0.55); ctx.fillRect(r.x, r.y, r.w * pp, r.h);
        if (pp < 1) { const p = th.pattern({ kind: 'diag', size: 4, color: th.red, lw: 1 }); if (p) { ctx.fillStyle = p; ctx.fillRect(r.x + r.w * pp, r.y, r.w * (1 - pp), r.h); } }
      }
      const p1 = q.openBugs.p1;
      for (let i = 0; i < Math.min(p1, 4); i++) { ctx.fillStyle = th.red; ctx.beginPath(); ctx.arc(r.x + 5 + i * 7, r.y + 4, 2.4, 0, 7); ctx.fill(); }
    });
  },
  content(f) {
    const q = f.quality;
    return { parts: [q.e2eTests ? q.e2ePassing + '/' + q.e2eTests + ' E2E' : isLiveSt(f.stage) ? 'NO E2E' : 'UNTESTED', q.openBugs.p1 ? q.openBugs.p1 + ' P1' : ''].filter(Boolean), stamp: q.status === 'failing' ? 'Tests failing' : undefined };
  },
  aggregate(fs) { return { parts: [count(fs, (f) => f.quality.status === 'failing') + ' failing tests', fs.reduce((s, f) => s + f.quality.openBugs.p1, 0) + ' open P1 bugs'] }; },
};

export const baseExpression: LensExpression = {
  id: 'base',
  name: 'Base',
  channels: { business, design, development, operations, security, quality },
  composeGeneral(tile) {
    // six health cells in the strip along the top edge; ribbons keep A/1's calm segments
    if (tile.form !== 'tile' || tile.strip.w < 60 * tile.u) return {};
    const s = tile.strip, gap = 2 * tile.u, w = (s.w - gap * 5) / 6, out: Partial<Record<LensId, Rect>> = {};
    LENS_ORDER.forEach((l, i) => { out[l] = { x: s.x + i * (w + gap), y: s.y, w, h: s.h }; });
    return out;
  },
  expandedRect: (tile) => band(tile),
  spring: { stiffness: 170, damping: 26 },
};
