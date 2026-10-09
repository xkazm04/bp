// Variant 1, "subtle: patterns". Every tile keeps its rectangle and its stage fill; a lens is a glyph
// and a line type. In General the six glyphs sit in fixed slots along a fixture's top edge, each with
// a short rail drawn in its lens's line type (the composition of all six). Choosing a lens lifts the
// other five off the drawing (they fade, shrink and rise a hair) while the chosen glyph slides to the
// head of the strip and its rail runs the full width: the tile's evidence line. On the site plan
// (ribbons) a lens draws its rail along each segment's foot and its glyph where that lens is unwell.
import type { Feature, Health, LensId } from '@/lib/data';
import { isLiveSt } from '@/lib/model';
import type { ChannelAggregate, ChannelContent, Density, FeatureLive, LensChannel, LensExpression, MarkArgs, Rect, TileGeom } from '../types';
import { ORDER, glyph, healthInk, lineType, railRest } from './marks';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const IDX: Record<LensId, number> = { business: 0, design: 1, development: 2, operations: 3, security: 4, quality: 5 };

// ------------------------------------------------------------------------------------------ layout
/** Height of the indicator band along a fixture's top edge (General slots and the lone lens's rail). */
const bandH = (t: TileGeom) => Math.min(t.strip.h + 2 * t.u, 9 * t.u);
/** Top of that band: a hair above the strip, clear of the id/evidence row the engine prints below. */
const bandY = (t: TileGeom) => t.strip.y - t.u;
const GAP = 3;
const slotW = (t: TileGeom) => (t.strip.w - 5 * GAP * t.u) / 6;
const hasSlots = (t: TileGeom) => t.form === 'tile' && slotW(t) >= 10 * t.u;
/** Foot band of a ribbon segment (site and wing plans). */
const ribRailH = (t: TileGeom) => clamp(t.h * 0.22, 2.5, 4.5 * t.u);

// composeGeneral / expandedRect run per tile per frame of a tween: hand back reused objects (the engine
// reads them immediately and never keeps them).
const SLOTS: Record<LensId, Rect> = { business: r0(), design: r0(), development: r0(), operations: r0(), security: r0(), quality: r0() };
const EMPTY: Partial<Record<LensId, Rect>> = {};
const EXP: Rect = r0();
function r0(): Rect { return { x: 0, y: 0, w: 0, h: 0 }; }

function composeGeneral(t: TileGeom): Partial<Record<LensId, Rect>> {
  if (!hasSlots(t)) return EMPTY;
  const sw = slotW(t), g = GAP * t.u, h = bandH(t);
  for (let i = 0; i < 6; i++) { const r = SLOTS[ORDER[i]]; r.x = t.strip.x + i * (sw + g); r.y = bandY(t); r.w = sw; r.h = h; }
  return SLOTS;
}
function expandedRect(t: TileGeom): Rect {
  if (t.form === 'tile') { EXP.x = t.strip.x; EXP.y = bandY(t); EXP.w = t.strip.w; EXP.h = bandH(t); }
  else { const h = ribRailH(t); EXP.x = t.body.x + 1; EXP.y = t.body.y + t.body.h - h; EXP.w = Math.max(0, t.body.w - 2); EXP.h = h; }
  return EXP;
}

// --------------------------------------------------------------------------------------- the lenses
interface Spec {
  density: Density;
  /** 0..1 along the rail; < 0 = nothing to measure (the rail stays a faint hairline). */
  measure(f: Feature, live: FeatureLive): number;
  /** Optional marks at the rail's end, for the standard and dense readers. Width they need in u. */
  endW?: number;
  end?(a: MarkArgs, x1: number, cy: number, s: number, col: string): void;
  content(f: Feature, live: FeatureLive): ChannelContent;
  aggregate(fs: readonly Feature[]): ChannelAggregate;
}

function count(fs: readonly Feature[], fn: (f: Feature) => boolean) { let n = 0; for (const f of fs) if (fn(f)) n++; return n; }
/** Keep the first part always, then only the parts that say something (non-zero counts). */
function said(parts: [string, number][]): string[] {
  const out: string[] = [];
  parts.forEach(([s, n], i) => { if (i === 0 || n > 0) out.push(s); });
  return out;
}
const sensitive = (f: Feature) => f.security.dataClass === 'payment' || f.security.dataClass === 'personal';
const unreviewed = (f: Feature) => f.security.review === 'not-started' || f.security.review === 'pending';

/** Small dots at the rail's end, right-aligned: n dots, the first `hot` in the status colour. */
function dots(a: MarkArgs, x1: number, cy: number, n: number, hot: number, col: string, hotCol: string) {
  const { ctx } = a, u = a.tile.u, r = Math.max(1.3, 1.5 * u), sp = 4.6 * u;
  for (let i = 0; i < Math.min(n, 4); i++) {
    ctx.fillStyle = i < hot ? hotCol : col;
    ctx.beginPath(); ctx.arc(x1 - r - i * sp, cy, r, 0, 6.2832); ctx.fill();
  }
}

const VALUE_WORD = ['', 'LOW VALUE', 'LOW VALUE', 'SOME VALUE', 'HIGH VALUE', 'TOP VALUE'];
const DESIGN_STEP: Record<string, number> = { none: 0, sketch: 0.2, wireframe: 0.4, 'hi-fi': 0.6, implemented: 0.8, polished: 1, 'n/a': -1 };
const DESIGN_WORD: Record<string, string> = { none: 'NO DESIGN', sketch: 'SKETCH', wireframe: 'WIREFRAME', 'hi-fi': 'HI-FI', implemented: 'BUILT AS DRAWN', polished: 'POLISHED', 'n/a': 'NO SCREEN' };
const DATA_STEP: Record<string, number> = { public: 0.25, internal: 0.5, personal: 0.75, payment: 1 };
const DATA_WORD: Record<string, string> = { public: 'PUBLIC', internal: 'INTERNAL', personal: 'PERSONAL DATA', payment: 'CARD DATA' };

const SPECS: Record<LensId, Spec> = {
  // Mara and Sam: one plain fact. Rail = value (double rule).
  business: {
    density: 'simple',
    measure: (f) => f.business.value / 5,
    content(f) {
      const b = f.business;
      return {
        parts: [VALUE_WORD[clamp(b.value, 1, 5)], b.customerRequests30d ? b.customerRequests30d + ' ASKS' : ''].filter(Boolean),
        stamp: f.flags.includes('demand-waiting') ? 'Customers are waiting' : f.flags.includes('priority-not-started') ? 'Top priority, not started' : undefined,
      };
    },
    aggregate(fs) {
      return { parts: said([[count(fs, (f) => f.business.value >= 4) + ' high value', 1], [fs.reduce((s, f) => s + (f.business.customerRequests30d || 0), 0) + ' customer asks', 1], [count(fs, (f) => f.flags.includes('demand-waiting')) + ' customers waiting', count(fs, (f) => f.flags.includes('demand-waiting'))]]) };
    },
  },
  // Lea: one plain fact. Rail = how far the design got (dotted guide line).
  design: {
    density: 'simple',
    measure: (f) => DESIGN_STEP[f.design.status] ?? -1,
    content(f) {
      const d = f.design;
      const built = isLiveSt(f.stage) || f.stage === 'in-review';
      return {
        parts: [d.a11y === 'fail' ? 'FAILS A11Y' : d.specDrift ? 'OFF-SPEC' : DESIGN_WORD[d.status] ?? d.status.toUpperCase()],
        stamp: d.a11y === 'fail' ? 'Fails accessibility' : d.specDrift ? 'Built off-spec' : d.status === 'none' && built ? 'Built without design' : undefined,
      };
    },
    aggregate(fs) {
      const a11y = count(fs, (f) => f.design.a11y === 'fail'), none = count(fs, (f) => f.design.status === 'none' && f.stage !== 'idea'), drift = count(fs, (f) => f.design.specDrift);
      return { parts: said([[none + ' without design', 1], [a11y + ' fail accessibility', a11y], [drift + ' built off-spec', drift]]) };
    },
  },
  // Tomás: dense, terse, technical. Rail = build progress (comb); end = open PRs.
  development: {
    density: 'dense',
    measure: (f, L) => (f.development.status === 'not-started' ? 0 : L.progressPct / 100),
    endW: 20,
    end(a, x1, cy, _s, col) { dots(a, x1, cy, a.f.development.openPRs, 0, col, col); },
    content(f, L) {
      const dv = f.development;
      const st = dv.status === 'not-started' ? 'NOT STARTED' : dv.status === 'done' || dv.status === 'merged' ? 'MERGED' : Math.round(L.progressPct) + '%';
      return {
        parts: [st, 'AI ' + dv.aiAuthoredPct + '%', dv.unitCoveragePct != null ? 'COV ' + dv.unitCoveragePct + '%' : 'NO UNIT TESTS', dv.openPRs ? dv.openPRs + ' PR' : ''].filter(Boolean),
        stamp: dv.humanReviewed === false ? 'No human review' : dv.stalled ? 'Stalled' : dv.techDebt === 3 ? 'Heavy tech debt' : undefined,
      };
    },
    aggregate(fs) {
      const unrev = count(fs, (f) => f.development.humanReviewed === false), thin = count(fs, (f) => f.development.unitCoveragePct != null && f.development.unitCoveragePct < 50);
      const ai = Math.round(fs.reduce((s, f) => s + f.development.aiAuthoredPct, 0) / Math.max(1, fs.length));
      return { parts: [unrev + ' not human-reviewed', ai + '% by agents', thin + ' thin coverage', fs.reduce((s, f) => s + f.development.openPRs, 0) + ' open PRs'] };
    },
  },
  // Priya: dense. Rail = rollout in production (chain line); end = incidents, and a bar when unwatched.
  operations: {
    density: 'dense',
    measure: (f, L) => (f.operations.environment === 'production' ? (f.operations.flag ? L.rolloutPct : 100) / 100 : f.operations.environment === 'none' ? -1 : 0),
    endW: 20,
    end(a, x1, cy, s, col) {
      const op = a.f.operations, { ctx, th } = a, u = a.tile.u;
      let x = x1;
      if (op.environment === 'production' && !op.alerting) { ctx.fillStyle = th.red; ctx.fillRect(x - 2 * u, cy - s / 2, 2 * u, s); x -= 5 * u; }
      const n = Math.min(3, op.incidents30d), r = s * 0.28;
      ctx.strokeStyle = op.incidents30d ? th.red : col; ctx.lineWidth = 1.3; ctx.beginPath();
      for (let i = 0; i < n; i++) { const cx = x - r - i * (r * 2 + 2.5 * u); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); }
      ctx.stroke();
    },
    content(f, L) {
      const op = f.operations;
      if (op.environment !== 'production') return { parts: [op.environment === 'none' ? 'NOT DEPLOYED' : op.environment.toUpperCase()] };
      return {
        parts: [(op.flag ? L.rolloutPct : 100) + '% ON', op.p95ms != null ? 'P95 ' + op.p95ms + 'MS' : '', op.errorRatePct != null ? op.errorRatePct + '% ERR' : '', op.incidents30d ? op.incidents30d + ' INC' : ''].filter(Boolean),
        stamp: !op.alerting ? 'No alerting' : op.incidents30d ? 'Incident this month' : !op.runbook ? 'No runbook' : undefined,
      };
    },
    aggregate(fs) {
      const prod = count(fs, (f) => f.operations.environment === 'production');
      const blind = count(fs, (f) => f.operations.environment === 'production' && !f.operations.alerting), inc = count(fs, (f) => f.operations.incidents30d > 0);
      return { parts: [prod + ' in production', blind + ' without alerting', inc + ' with incidents'] };
    },
  },
  // Jonas: standard. Rail = how sensitive the data is (hatched, a fire-rated wall); end = review seal.
  security: {
    density: 'standard',
    measure: (f) => DATA_STEP[f.security.dataClass] ?? -1,
    endW: 9,
    end(a, x1, cy, s, col) {
      const se = a.f.security, { ctx, th } = a, u = a.tile.u, h = s * 0.5;
      ctx.lineWidth = 1.5;
      if (se.review === 'passed') { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x1 - 4 * u, cy - h); ctx.lineTo(x1, cy - h); ctx.lineTo(x1, cy + h); ctx.lineTo(x1 - 4 * u, cy + h); ctx.stroke(); }
      else if (se.review === 'findings') { ctx.strokeStyle = th.red; ctx.beginPath(); ctx.moveTo(x1 - 2 * h, cy - h); ctx.lineTo(x1, cy + h); ctx.moveTo(x1, cy - h); ctx.lineTo(x1 - 2 * h, cy + h); ctx.stroke(); }
      else if (sensitive(a.f) && unreviewed(a.f)) { ctx.strokeStyle = healthInk(th, a.f.security.health, true); ctx.beginPath(); ctx.moveTo(x1 - 4 * u, cy - h); ctx.lineTo(x1, cy - h); ctx.moveTo(x1, cy + h); ctx.lineTo(x1 - 4 * u, cy + h); ctx.stroke(); }
    },
    content(f, L) {
      const se = f.security;
      const rev: Record<string, string> = { 'not-required': 'NO REVIEW NEEDED', 'not-started': 'NOT REVIEWED', pending: 'REVIEW PENDING', passed: 'REVIEWED', findings: se.openFindings + ' FINDINGS' };
      const live = isLiveSt(f.stage) && L.rolloutPct > 0;
      return {
        parts: [DATA_WORD[se.dataClass] ?? se.dataClass.toUpperCase(), rev[se.review] ?? se.review.toUpperCase()],
        stamp: se.openFindings ? 'Open findings' : sensitive(f) && live && unreviewed(f) ? 'Live, unreviewed' : undefined,
      };
    },
    aggregate(fs) {
      return { parts: [count(fs, sensitive) + ' touch card or personal data', count(fs, (f) => sensitive(f) && unreviewed(f)) + ' of them unreviewed'] };
    },
  },
  // Ines: standard. Rail = end-to-end tests passing (dimension line); end = P1 bugs.
  quality: {
    density: 'standard',
    measure: (f) => (f.quality.e2eTests ? f.quality.e2ePassing / f.quality.e2eTests : isLiveSt(f.stage) ? 0 : -1),
    endW: 20,
    end(a, x1, cy, _s, col) { const b = a.f.quality.openBugs; dots(a, x1, cy, b.p1 + b.p2, b.p1, col, a.th.red); },
    content(f) {
      const q = f.quality, live = isLiveSt(f.stage);
      return {
        parts: [q.e2eTests ? q.e2ePassing + '/' + q.e2eTests + ' E2E' : live ? 'NO E2E' : 'UNTESTED', q.openBugs.p1 ? q.openBugs.p1 + ' P1' : q.openBugs.p2 ? q.openBugs.p2 + ' P2' : ''].filter(Boolean),
        stamp: q.status === 'failing' ? 'Tests failing' : q.openBugs.p1 ? 'Open P1 bug' : live && !q.e2eTests ? 'Live, untested' : undefined,
      };
    },
    aggregate(fs) {
      const failing = count(fs, (f) => f.quality.status === 'failing'), p1 = fs.reduce((s, f) => s + f.quality.openBugs.p1, 0);
      return { parts: said([[failing + ' failing tests', 1], [p1 + ' open P1 bugs', 1], [count(fs, (f) => isLiveSt(f.stage) && !f.quality.e2eTests) + ' live untested', count(fs, (f) => isLiveSt(f.stage) && !f.quality.e2eTests)]]) };
    },
  },
};

// ------------------------------------------------------------------------------------------- marks
function drawTile(l: LensId, s: Spec, a: MarkArgs) {
  const { ctx, th, tile: t, f } = a, u = t.u, i = IDX[l];
  const e = smooth(a.x);
  // Where this lens sits: its General slot, the head of the strip, or a blend (own easing, so the five
  // that leave barely drift while they fade). Tiles too small for slots only ever show the lone lens.
  const H = bandH(t), slots = hasSlots(t), sw = slots ? slotW(t) : 0;
  const sx = slots ? t.strip.x + i * (sw + GAP * u) : t.strip.x, sW = slots ? sw : t.strip.w;
  const rx = lerp(sx, t.strip.x, e), rw = lerp(sW, t.strip.w, e);
  const lift = (1 - a.w) * 3 * u;                      // lifted off the drawing as it fades
  const gs = Math.max(6, lerp(Math.min(H - u, sW * 0.5, 8 * u), Math.min(H, 9 * u), e) * lerp(0.55, 1, a.w));
  const cy = bandY(t) + H / 2 - lift, gy = cy - gs / 2;
  const ga = ctx.globalAlpha * a.w;
  ctx.globalAlpha = ga;
  glyph(ctx, l, rx, gy, gs, healthInk(th, f[l].health, a.now));
  // on a large fixture the lone lens also leaves its glyph as a faint watermark in a fixed place
  // (right, below the middle): the quiet second echo that tells a glance which lens is up
  if (e > 0.01 && t.text && t.w >= 250 * u && t.h >= 120 * u) {
    const ws = Math.min(t.h * 0.24, 30 * u);
    ctx.globalAlpha = ga * e * (th.mode === 'dark' ? 0.3 : 0.24);
    glyph(ctx, l, t.x + t.w - 16 * u - ws, t.y + t.h * 0.6 - ws / 2, ws, th.ink);
    ctx.globalAlpha = ga;
  }
  if (!a.now) return;
  // the rail: this lens's line type over the measured part, a faint hairline over the rest
  const x0 = rx + gs + 3 * u;
  const endW = s.endW ? s.endW * u * smooth((a.x - 0.4) / 0.6) : 0;
  const x1 = rx + rw - endW - (endW ? 3 * u : 0);
  if (x1 - x0 < 3 * u) return;
  const rh = lerp(Math.min(3 * u, H * 0.4), Math.min(5 * u, H * 0.62), e), ry = cy - rh / 2;
  const m = s.measure(f, a.live);
  const len = m > 0 ? (x1 - x0) * Math.min(1, m) : 0;
  ctx.globalAlpha = ga * lerp(0.6, 1, e);
  railRest(ctx, th, x0 + len, x1, ry, rh);
  if (len > 0) lineType(ctx, th, l, x0, ry, len, rh, th.inkA(0.92), u);
  if (endW > 0.5 && s.end) { ctx.globalAlpha = ga * smooth((a.x - 0.5) / 0.5); s.end(a, rx + rw, cy, rh * 1.4, th.inkA(0.85)); }
}

function drawRibbon(l: LensId, s: Spec, a: MarkArgs) {
  if (!a.now) return;
  const { ctx, th, tile: t, f, r } = a, u = t.u;
  // on ribbons the five leaving lenses peak at a quarter of their weight mid-tween: not worth a raster
  if (r.w < 3 || a.w < 0.12) return;
  const e = smooth(a.x);
  ctx.globalAlpha *= a.w;
  // the rail along the segment's foot, growing in from the left as the lens comes up
  const m = s.measure(f, a.live), full = r.w * e, len = m > 0 ? full * Math.min(1, m) : 0;
  railRest(ctx, th, r.x + len, r.x + full, r.y, r.h);
  if (len > 0) lineType(ctx, th, l, r.x, r.y, len, r.h, th.inkA(0.92), u);
  // the glyph where this lens is unwell, on a small knockout so it reads over any stage fill
  const h = f[l].health;
  if (h !== 'bad' && h !== 'watch') return;
  const room = r.y - t.body.y - 1, gs = Math.min(room - 2, t.w - 5, 11 * u);
  if (gs < 7) return;
  const gx = t.x + (t.w - gs) / 2, gy = t.body.y + (room - gs) / 2;
  ctx.fillStyle = th.alpha(th.paper, 0.82); ctx.fillRect(gx - 1.5, gy - 1.5, gs + 3, gs + 3);
  const g2 = gs * lerp(0.6, 1, e), o = (gs - g2) / 2;
  glyph(ctx, l, gx + o, gy + o, g2, healthInk(th, h, true));
}

/** Development's "no human review" diamond (A/1, also in General): kept where the base drew it. */
function unreviewedDiamond(a: MarkArgs) {
  const t = a.tile, u = t.u, { ctx, th } = a;
  if (!a.stage || !a.now || a.f.development.humanReviewed !== false || t.form !== 'tile' || t.w >= 150 * u || t.w < 26 * u) return;
  const dx = t.x + t.w - 7 * u, dy = t.y + t.h - 7 * u, dd = Math.max(2.5 * u, Math.min(4.5 * u, t.w / 28));
  ctx.globalAlpha = a.w; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(dx, dy - dd); ctx.lineTo(dx + dd * 0.8, dy); ctx.lineTo(dx, dy + dd); ctx.lineTo(dx - dd * 0.8, dy); ctx.closePath(); ctx.stroke();
}

function channel(l: LensId): LensChannel {
  const s = SPECS[l];
  return {
    density: s.density,
    marks(a) {
      if (!a.stage || a.w < 0.03) return;
      const ga = a.ctx.globalAlpha;
      if (a.tile.form === 'tile') drawTile(l, s, a); else drawRibbon(l, s, a);
      if (l === 'development') { a.ctx.globalAlpha = ga; unreviewedDiamond(a); }
    },
    content: s.content,
    aggregate: s.aggregate,
  };
}

export const subtleExpression: LensExpression = {
  id: 'subtle',
  name: 'Subtle',
  channels: { business: channel('business'), design: channel('design'), development: channel('development'), operations: channel('operations'), security: channel('security'), quality: channel('quality') },
  composeGeneral,
  expandedRect: (t) => expandedRect(t),
  spring: { stiffness: 150, damping: 26 },
  evidenceFont: () => 'mono',
};

export { SPECS, bandH };
export type { Health };
