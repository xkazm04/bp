/* Orbit Columns · round 2 variant D (Atlas family): a top-down column tree in the Orbit identity.
 *
 * PLAN
 * Engine: one <canvas> per view (map in shell.mapEl, timeline in shell.timelineEl). Lens, filter and selection events
 * only refresh small caches (band per feature, dim and hit flags) and request one frame; nothing is rebuilt or moved.
 * Every frame culls to the visible columns and rows, so a frame costs about the same at any zoom.
 *
 * World layout (computed once per stage size class; never re-sorted):
 *   x  17 domain columns side by side in blueprint order, COL_W = 240 world units wide, 8 apart inside an area and 30
 *      between areas (W = 4296). The timeline uses exactly the same column x.
 *   y  a product header band (an Orbit instrument dial with the product rollups), 5 area banners spanning their
 *      columns, the domain heads, a thin channel for dependency links, then each column body: module cards stacked
 *      top-down, each a header strip plus one row per feature (ROW world units).
 *   Size class: the opening fit scale kFit = (stage width - margins) / W, unless the height binds. The header band,
 *   banners and heads reserve their on-screen height at the fit (px / kFit), and ROW (24 to 72) grows to fill the stage
 *   height, so every class opens as a full composition. A resize that changes the stage by more than a few percent (or
 *   crosses the phone breakpoint) recomputes the layout and refits; anything smaller keeps the layout.
 *
 * Labels are drawn at a constant screen size, anchored to their world boxes, and only when their box has room on
 * screen, so they never overlap. Sticky labels (areas, domains, modules, release bands) keep context at the top edge,
 * and a readout names area > domain > module at the centre of the view.
 *
 * Progressive disclosure on a continuous zoom k (thresholds per class, from the room on screen):
 *   L0  k < kL1  Domain heads: name, big band glyph, score, attention and gate counters. Modules are bars coloured by
 *                band (a heat strip). Columns too narrow for a horizontal name write it up the column spine.
 *   L1  < kL2    Module cards: name, band glyph and score, counters, and one pip per feature at its row.
 *   L2  < kL3    Feature rows: band tint, status glyph by form, gate and attention marks; module header strips.
 *   L3  < kL4    Feature names, current-lens score and band glyph, gate and attention marks.
 *   L4  >= kL4   Each row is a mini-detail inside its own reserved space: the 8-lens corona with the status inside,
 *                the lens headline, gates and release. Nothing moves.
 *   Every layer's alpha ramps over a zoom band, so the layers cross-fade instead of popping.
 *
 * Timeline "Release stack": the same 17 columns at the same x and zoom; time runs down. One band per release (oldest at
 * the top) with its package items as chips in their domain column, a today line, the next release with readiness
 * glyphs, and dashed future bands. Switching views keeps x and zoom and animates only the vertical change.
 */
(function () {
  'use strict';
  const BP = window.BP, OK = window.OK;
  const app = document.getElementById('app');
  if (!BP || !OK || !app) return;
  const esc = OK.esc;

  // ══ helpers ══════════════════════════════════════════════════════════════════════════════════════
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  /** 0 below th/1.08, 1 above th*1.05, smooth in log space: one layer's cross-fade around its zoom threshold. */
  const rampK = (k, th) => smooth(Math.log(th) - 0.075, Math.log(th) + 0.05, Math.log(k));
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => RM.matches;
  const DEG = Math.PI / 180;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

  // ══ data (fixed blueprint order) ═════════════════════════════════════════════════════════════════
  const LENSES = OK.lenses();
  const LENS_IDS = LENSES.map((l) => l.id);
  const DOMS = [];
  BP.areas.forEach((a) => BP.domainsOf(a.id).forEach((d) => DOMS.push(d)));
  const NC = DOMS.length;
  const colIdx = new Map(DOMS.map((d, i) => [d.id, i]));
  const COLS = DOMS.map((d, i) => ({ i, d, area: BP.area(d.areaId), mods: BP.modulesOf(d.id), feats: BP.featuresOfDomain(d.id) }));
  const featsOfMod = new Map(BP.modules.map((m) => [m.id, BP.featuresOf(m.id)]));
  const FEATS = BP.features;
  const NF = FEATS.length;
  const fIdx = new Map(FEATS.map((f, i) => [f.id, i]));
  const fCol = new Int16Array(NF);
  FEATS.forEach((f, i) => { fCol[i] = colIdx.get(BP.pathOf(f).domain.id); });
  const fAttn = new Uint8Array(NF);
  FEATS.forEach((f, i) => { fAttn[i] = BP.needsAttention(f) ? 1 : 0; });
  const fGates = FEATS.map((f) => BP.gates(f));
  const fBand = new Array(NF).fill('na');
  const fScore = new Array(NF).fill(null);
  const fDim = new Uint8Array(NF);
  const fHit = new Uint8Array(NF);
  const fCov = new Array(NF).fill(null);
  const AREAS = BP.areas.map((a) => { const cs = COLS.filter((c) => c.d.areaId === a.id); return { a, c0: cs[0].i, c1: cs[cs.length - 1].i }; });
  const RELS = BP.releasesInOrder();
  const NEXT = RELS.find((r) => r.state === 'next');
  const ASOF = BP.asOf || (BP.data && BP.data.meta && BP.data.meta.asOf);

  // ══ shell ════════════════════════════════════════════════════════════════════════════════════════
  const shell = OK.mount({ root: app, variant: 'Orbit Columns', legend: legendHTML });
  const S = shell.state;

  // ══ palette and type (read from the kit tokens; re-read on theme change) ═════════════════════════
  const P = {};
  const TOKENS = ['paper', 'paper-hi', 'sky-a', 'sky-b', 'ink', 'ink-2', 'ink-3', 'ink-4', 'on-ink', 'rule', 'rule-2', 'band', 'band-hi', 'panel-solid',
    'panel-edge', 'shadow', 'glow', 'good', 'fair', 'poor', 'critical', 'na', 'good-soft', 'fair-soft', 'poor-soft', 'critical-soft', 'na-soft',
    'alarm', 'alarm-soft', 'gate', 'gate-soft', 'focus'];
  const camel = (t) => t.replace(/-([a-z0-9])/g, (m, ch) => ch.toUpperCase());
  let FL = '"Jost", sans-serif', FM = '"DM Mono", monospace';
  let hatch = null, hatchStrong = null, hatchLight = null;
  function readPalette() {
    const cs = getComputedStyle(shell.root);
    TOKENS.forEach((t) => { P[camel(t)] = cs.getPropertyValue('--ok-' + t).trim(); });
    LENS_IDS.forEach((id) => { P['lens_' + id] = cs.getPropertyValue('--ok-lens-' + id).trim(); });
    FL = cs.getPropertyValue('--ok-f-label').trim() || FL;
    FM = cs.getPropertyValue('--ok-f-mono').trim() || FM;
    P.dark = shell.isDark();
    hatch = makeHatch(P.na, P.dark ? 0.55 : 0.5, 7);
    hatchStrong = makeHatch(P.na, P.dark ? 0.8 : 0.75, 6);
    hatchLight = makeHatch(P.na, P.dark ? 0.42 : 0.34, 7);
  }
  function makeHatch(color, alpha, step) {
    const cv = document.createElement('canvas');
    const d = Math.max(1, Math.round(window.devicePixelRatio || 1));
    cv.width = cv.height = step * d;
    const c = cv.getContext('2d');
    c.scale(d, d);
    c.strokeStyle = color; c.globalAlpha = alpha; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-1, step + 1); c.lineTo(step + 1, -1);
    c.moveTo(-1, 1); c.lineTo(1, -1);
    c.moveTo(step - 1, step + 1); c.lineTo(step + 1, step - 1);
    c.stroke();
    const pat = mc.createPattern(cv, 'repeat');
    if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(1 / d, 1 / d));
    return pat;
  }
  const BC = (b) => P[b] || P.na;
  const BS = (b) => P[b + 'Soft'] || P.naSoft;
  const COV_COLOR = { covered: 'good', 'in-progress': 'ink3', pending: 'ink4', finding: 'alarm' };
  const lab = (w, px) => w + ' ' + px + 'px ' + FL;
  const mono = (w, px) => w + ' ' + px + 'px ' + FM;

  // ══ text measuring, fitting and wrapping (cached; fonts are loaded before the first layout) ══════
  const mc = document.createElement('canvas').getContext('2d');
  const HAS_LS = 'letterSpacing' in mc;
  let wCache = new Map(), fitCache = new Map(), wrapCache = new Map();
  function tw(font, s, ls) {
    const key = font + '|' + (ls || 0) + '|' + s;
    let w = wCache.get(key);
    if (w == null) {
      mc.font = font;
      if (HAS_LS) mc.letterSpacing = (ls || 0) + 'px';
      w = mc.measureText(s).width;
      wCache.set(key, w);
    }
    return w;
  }
  function fitText(font, s, maxW, ls) {
    if (maxW < 6) return '';
    if (tw(font, s, ls) <= maxW) return s;
    const key = font + '|' + (ls || 0) + '|' + Math.floor(maxW / 2) + '|' + s;
    let r = fitCache.get(key);
    if (r != null) return r;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tw(font, s.slice(0, mid).trimEnd() + '…', ls) <= maxW) lo = mid; else hi = mid - 1; }
    r = lo > 0 ? s.slice(0, lo).trimEnd() + '…' : '';
    fitCache.set(key, r);
    return r;
  }
  /** Greedy word wrap into at most maxLines; ok is false when something had to be cut. */
  function wrapLines(font, s, maxW, maxLines, ls) {
    const key = font + '|' + (ls || 0) + '|' + Math.round(maxW) + '|' + maxLines + '|' + s;
    let r = wrapCache.get(key);
    if (r) return r;
    const words = String(s).split(/\s+/);
    const lines = [];
    let cur = '';
    let ok = true;
    for (const wd of words) {
      const t = cur ? cur + ' ' + wd : wd;
      if (!cur || tw(font, t, ls) <= maxW) cur = t;
      else { lines.push(cur); cur = wd; }
    }
    if (cur) lines.push(cur);
    let out = lines;
    if (lines.length > maxLines) { ok = false; out = lines.slice(0, maxLines); out[maxLines - 1] = fitText(font, lines.slice(maxLines - 1).join(' '), maxW, ls); }
    out = out.map((l) => { if (tw(font, l, ls) > maxW + 0.5) { ok = false; return fitText(font, l, maxW, ls); } return l; });
    r = { lines: out, ok };
    wrapCache.set(key, r);
    return r;
  }

  // ══ canvas drawing primitives (ports of the kit glyphs, same geometry) ═══════════════════════════
  function txt(c, s, x, y, font, color, align, ls) {
    if (!s) return;
    c.font = font;
    c.fillStyle = color;
    c.textAlign = align || 'left';
    if (HAS_LS) c.letterSpacing = (ls || 0) + 'px';
    c.fillText(s, x, y);
  }
  function rrect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  const sw = (r) => clamp(r * 0.22, 1.1, 2.2);
  const pt = (r, deg) => [r * Math.sin(deg * DEG), -r * Math.cos(deg * DEG)];
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); }
  function gStatus(c, st, x, y, r) {
    const w = sw(r);
    c.setLineDash([]);
    if (st === 'live') { circle(c, x, y, r); c.fillStyle = P.ink; c.fill(); return; }
    if (st === 'ready' || st === 'building') {
      circle(c, x, y, r - w / 2); c.fillStyle = P.paperHi; c.fill(); c.lineWidth = w; c.strokeStyle = P.ink; c.stroke();
      c.fillStyle = P.ink;
      if (st === 'ready') { circle(c, x, y, r * 0.36); c.fill(); return; }
      c.beginPath(); c.moveTo(x, y - (r - w / 2)); c.arc(x, y, r - w / 2, -Math.PI / 2, Math.PI / 2, true); c.closePath(); c.fill();
      return;
    }
    if (st === 'planned') {
      circle(c, x, y, r - w / 2); c.fillStyle = P.paperHi; c.fill();
      c.setLineDash([r * 0.22, r * 0.36]); c.lineWidth = w; c.strokeStyle = P.ink2; c.stroke(); c.setLineDash([]);
      return;
    }
    if (st === 'blocked') {
      c.beginPath();
      for (let i = 0; i < 8; i++) { const p = pt(i % 2 ? r * 0.42 : r * 1.5, i * 45); if (i) c.lineTo(x + p[0], y + p[1]); else c.moveTo(x + p[0], y + p[1]); }
      c.closePath(); c.fillStyle = P.alarm; c.fill();
    }
  }
  function pie(c, x, y, r, frac) {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - r); c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false); c.closePath();
  }
  function gBand(c, band, x, y, r) {
    const w = sw(r);
    c.setLineDash([]);
    if (band === 'good') { circle(c, x, y, r); c.fillStyle = P.good; c.fill(); return; }
    if (band === 'fair' || band === 'poor') {
      circle(c, x, y, r - 0.5); c.fillStyle = P.paperHi; c.fill(); c.lineWidth = 1; c.strokeStyle = P.rule; c.stroke();
      pie(c, x, y, r, band === 'fair' ? 0.75 : 0.5); c.fillStyle = BC(band); c.fill();
      return;
    }
    if (band === 'critical') {
      circle(c, x, y, r - w / 2); c.fillStyle = P.paperHi; c.fill(); c.fillStyle = P.criticalSoft; c.fill(); c.lineWidth = w; c.strokeStyle = P.critical; c.stroke();
      const k = r * 0.36;
      c.beginPath(); c.moveTo(x - k, y - k); c.lineTo(x + k, y + k); c.moveTo(x + k, y - k); c.lineTo(x - k, y + k); c.lineCap = 'round'; c.stroke(); c.lineCap = 'butt';
      return;
    }
    circle(c, x, y, r - w / 2); c.setLineDash([r * 0.42, r * 0.32]); c.lineWidth = w; c.strokeStyle = P.na; c.stroke(); c.setLineDash([]);
  }
  function gGate(c, kind, x, y, r) {
    const w = sw(r);
    circle(c, x, y, r - w / 2);
    c.lineWidth = w; c.strokeStyle = kind === 'changes' ? P.alarm : P.gate;
    if (kind === 'triage') c.setLineDash([r * 0.42, r * 0.3]);
    c.stroke(); c.setLineDash([]);
    circle(c, x, y, r * 0.34); c.fillStyle = kind === 'changes' ? P.alarm : P.gate; c.fill();
  }
  function gAttn(c, x, y, r) {
    c.beginPath();
    for (let a = 0; a < 360; a += 60) { const p0 = pt(r * 0.18, a), p1 = pt(r * 0.98, a); c.moveTo(x + p0[0], y + p0[1]); c.lineTo(x + p1[0], y + p1[1]); }
    c.lineWidth = clamp(r * 0.26, 1.3, 2.4); c.lineCap = 'round'; c.strokeStyle = P.alarm; c.stroke(); c.lineCap = 'butt';
  }
  function gKind(c, kind, x, y, r) {
    const s = r - 0.6, k = r * 0.46;
    rrect(c, x - s, y - s, 2 * s, 2 * s, r * 0.28);
    c.lineWidth = 1.1;
    if (kind === 'new') { c.fillStyle = P.ink; c.fill(); c.strokeStyle = P.ink; c.stroke(); } else { c.fillStyle = P.paperHi; c.fill(); c.strokeStyle = P.ink2; c.stroke(); }
    c.beginPath();
    if (kind === 'new') { c.moveTo(x - k, y); c.lineTo(x + k, y); c.moveTo(x, y - k); c.lineTo(x, y + k); }
    else if (kind === 'improved') { c.moveTo(x - k, y + k * 0.45); c.lineTo(x, y - k * 0.55); c.lineTo(x + k, y + k * 0.45); }
    else { c.moveTo(x - k, y + k * 0.05); c.lineTo(x - k * 0.2, y + k * 0.7); c.lineTo(x + k, y - k * 0.6); }
    c.lineWidth = 1.3; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = kind === 'new' ? P.paperHi : P.ink; c.stroke(); c.lineCap = 'butt'; c.lineJoin = 'miter';
  }
  /** The 8-lens corona: one arc per lens clockwise from the top, coloured by band; a tick marks the current lens. */
  function gCorona(c, fi, x, y, r, lens, withStatus) {
    const f = FEATS[fi];
    const w = clamp(r * 0.24, 1.8, 6);
    circle(c, x, y, r); c.lineWidth = w; c.strokeStyle = P.rule2; c.stroke();
    LENS_IDS.forEach((id, i) => {
      const band = BP.rating(f, id).band;
      const d0 = i * 45 + 3.5, d1 = (i + 1) * 45 - 3.5;
      c.beginPath(); c.arc(x, y, r, (d0 - 90) * DEG, (d1 - 90) * DEG, false);
      c.lineWidth = band === 'na' ? w * 0.5 : w; c.strokeStyle = band === 'na' ? P.ink4 : BC(band); c.stroke();
      if (lens === id) {
        const a = pt(r + w * 0.9, i * 45 + 22.5), b = pt(r + w * 0.9 + Math.max(3, r * 0.28), i * 45 + 22.5);
        c.beginPath(); c.moveTo(x + a[0], y + a[1]); c.lineTo(x + b[0], y + b[1]); c.lineWidth = Math.max(1.2, w * 0.45); c.lineCap = 'round'; c.strokeStyle = P.ink; c.stroke(); c.lineCap = 'butt';
      }
    });
    if (withStatus) gStatus(c, f.status, x, y, r * 0.42);
  }
  /** Pill with a mark and a count (badges on module bars and cards). */
  function badge(c, x, y, h, mark, n, color, align) {
    const font = mono(500, h >= 14 ? 10 : 9);
    const s = String(n);
    const w = h + tw(font, s) + 6;
    const bx = align === 'right' ? x - w : x;
    rrect(c, bx, y, w, h, h / 2); c.fillStyle = P.paperHi; c.fill(); c.lineWidth = 1; c.strokeStyle = color; c.stroke();
    mark(c, bx + h / 2 + 1, y + h / 2, h * 0.32);
    txt(c, s, bx + h + 1, y + h / 2 + 3.4, font, color);
    return w;
  }

  // ══ geometry: columns are class-independent; the vertical layout is computed per size class ═══════
  const COL_W = 240, GAP_D = 8, GAP_A = 30, PADX = 8, MH = 30, MPB = 6, MG = 12, BPT = 8, BPB = 10;
  const colX = new Float64Array(NC);
  let W = 0;
  COLS.forEach((c, i) => { if (i) W += COLS[i - 1].d.areaId === c.d.areaId ? GAP_D : GAP_A; colX[i] = W; W += COL_W; });
  const colOver = COLS.map((c) => BPT + BPB + c.mods.length * (MH + MPB) + (c.mods.length - 1) * MG);
  const colRows = COLS.map((c) => c.feats.length);
  const KIND_ORDER = { new: 0, improved: 1, fixed: 2 };

  let L = null; // the current layout
  function headMode(cw, phone) {
    if (phone) return { wide: false, h: 58, fs: 9 };
    for (const fs of [12, 11.5, 11, 10.5]) if (DOMS.every((d) => wrapLines(lab(500, fs), d.name, cw - 14, 2).ok)) return { wide: true, h: 108, fs };
    return { wide: false, h: 82, fs: 11 };
  }
  function cwForWide() {
    let lo = 40, hi = 260;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (DOMS.every((d) => wrapLines(lab(500, 10.5), d.name, mid - 14, 2).ok)) hi = mid; else lo = mid; }
    return hi;
  }
  // the product header band: a dial with the product name, then rollup blocks that flow beside and under it
  const DIAL_LABEL = (s) => s.toUpperCase();
  function dialBlocks(phone) {
    const lsL = 1.4;
    const labelW = (s) => tw(lab(500, 9), DIAL_LABEL(s), lsL);
    const cnt = (n) => tw(mono(400, 12.5), String(n));
    const roll = BP.productRollup();
    const out = [];
    if (!phone) {
      let w = 0;
      BP.STATUS_ORDER.forEach((s) => { w += 13 + 5 + cnt(roll.byStatus[s] || 0) + 13; });
      out.push({ id: 'status', w: Math.max(w - 13, labelW('Status')) });
      let bw = 0;
      ['good', 'fair', 'poor', 'critical', 'na'].forEach((b) => { bw += 11 + 4 + Math.max(...LENS_IDS.map((l) => cnt(BP.productRating(l).counts[b] || 0))) + 10; });
      out.push({ id: 'bands', w: Math.max(150, bw - 10, Math.max(...LENSES.map((l) => labelW(l.label + ' bands')))) });
    }
    let gw = 0;
    ['triage', 'approval', 'changes'].forEach((g) => { gw += 12 + 5 + cnt(roll.gates[g]) + 4 + tw(lab(400, 11), OK.labels.gate ? (OK.labels.gate[g].label || g) : g) + 12; });
    out.push({ id: 'gates', w: Math.max(gw - 12, labelW('Human gates')) });
    out.push({ id: 'attn', w: Math.max(12 + 5 + cnt(roll.attention) + 5 + tw(lab(400, 11), 'features'), labelW('Needs attention')) });
    if (NEXT) {
      const items = BP.releaseItems(NEXT.id);
      const st = { ready: 0, building: 0, blocked: 0 };
      items.forEach((it) => { if (it.kind === 'new') { const s = BP.feature(it.feature).status; if (st[s] != null) st[s] += 1; } });
      let rw = 0;
      [['ready', 'ready'], ['building', 'in build'], ['blocked', 'blocked']].forEach(([s, l]) => { rw += 12 + 5 + cnt(st[s]) + 4 + tw(lab(400, 11), l) + 11; });
      const l1 = tw(mono(500, 12), NEXT.label) + 6 + tw(lab(500, 12.5), NEXT.name) + 8 + tw(mono(400, 11), OK.fmt.dateShort(NEXT.date) + ' · ' + OK.fmt.rel(NEXT.date));
      out.push({ id: 'next', w: Math.max(l1, rw - 11, labelW('Next release')), st });
    }
    return out;
  }
  /** variant 0: every block, beside and under the dial; 1: one row beside the dial; 2: the dial with gates and
   *  attention only (short stages). */
  function layoutDial(bandW, phone, narrow, variant) {
    const pad = phone ? 4 : variant ? 4 : 8;
    const dd = phone ? 54 : variant === 2 ? 56 : narrow || variant ? 66 : 76;
    const nameW = tw(lab(600, phone ? 13 : 15), BP.product.name.toUpperCase(), phone ? 3.1 : 4.8);
    const verW = tw(mono(400, 11), 'v' + BP.product.version + ' → ' + BP.product.nextVersion);
    const lensW = Math.max(...LENSES.map((l) => tw(lab(500, 9.5), l.label.toUpperCase(), 1.4))) + 8 + tw(mono(400, 22), '100') + 8 + tw(lab(400, 11.5), 'Critical');
    const title = { x: pad, y: pad, h: dd, r: dd / 2, w: dd + 14 + Math.max(nameW, verW, lensW, phone ? 0 : tw(lab(400, 11), BP.features.length + ' features · ' + BP.modules.length + ' modules')) };
    let blocks = dialBlocks(phone);
    if (variant === 2) blocks = blocks.filter((b) => b.id === 'gates' || b.id === 'attn');
    const BH = 44, gapMin = phone ? 14 : 22, gapMax = 64;
    const placed = [];
    const rows = [];
    // region 1: beside the title (one row when the title is short); region 2: full width under it
    const r1x = title.x + title.w + (phone ? 12 : 26), r1w = bandW - pad - r1x;
    const r1rows = Math.max(0, Math.floor((dd + 4) / BH));
    let bi = 0;
    for (let r = 0; r < r1rows && bi < blocks.length; r++) {
      const row = { x: r1x, w: r1w, y: pad + (dd - r1rows * BH) / 2 + r * BH + 2, items: [] };
      let used = 0;
      while (bi < blocks.length && used + (row.items.length ? gapMin : 0) + blocks[bi].w <= r1w) { used += (row.items.length ? gapMin : 0) + blocks[bi].w; row.items.push(blocks[bi]); bi += 1; }
      if (row.items.length) rows.push(row); else break;
    }
    let y2 = pad + dd + 8;
    const r2max = variant ? 0 : 2;
    for (let r = 0; r < r2max && bi < blocks.length; r++) {
      const row = { x: pad, w: bandW - 2 * pad, y: y2, items: [] };
      let used = 0;
      while (bi < blocks.length && used + (row.items.length ? gapMin : 0) + blocks[bi].w <= row.w) { used += (row.items.length ? gapMin : 0) + blocks[bi].w; row.items.push(blocks[bi]); bi += 1; }
      if (!row.items.length) break;
      rows.push(row);
      y2 += BH;
    }
    rows.forEach((row) => {
      const sum = row.items.reduce((s, b) => s + b.w, 0);
      const n = row.items.length;
      const gap = n > 1 ? clamp((row.w - sum) / (n - 1), gapMin, gapMax) : 0;
      let x = row.x;
      row.items.forEach((b) => { placed.push(Object.assign({}, b, { x, y: row.y, h: BH })); x += b.w + gap; });
    });
    const bottom = Math.max(pad + dd, ...placed.map((b) => b.y + b.h - 4)) + pad;
    return { h: Math.ceil(bottom), title, blocks: placed, pad };
  }

  function computeLayout(sw0, sh0) {
    const phone = shell.isPhone();
    const sw = Math.max(200, sw0), sh = Math.max(200, sh0);
    const mx = phone ? 8 : 14, my = phone ? 8 : 10;
    const mb = phone ? 56 : 52; // the readout and zoom instrument live in this bottom strip at the fit
    const G1 = phone ? 6 : 8, G2 = 4, G3 = 12;
    const A = phone ? 28 : 24;
    const kw = (sw - 2 * mx) / W;
    // try the fullest header band first; a short stage trades header blocks for map scale
    let best = null;
    for (const variant of phone ? [0] : [0, 1, 2]) {
      let k = kw, heads, dial, ROW = 24;
      for (let it = 0; it < 6; it++) {
        heads = headMode(k * COL_W, phone);
        dial = layoutDial(Math.max(W * k, Math.min(sw - 2 * mx, W * kw)), phone, !heads.wide, variant);
        dial.bandW = Math.max(W * k, Math.min(sw - 2 * mx, W * kw));
        const avail = sh - my - mb - dial.h - G1 - A - G2 - heads.h - G3;
        const rowMax = phone ? 64 : heads.wide ? 40 : 56;
        const fitRow = Math.min(...COLS.map((c, i) => (avail / k - colOver[i]) / colRows[i]));
        if (fitRow >= 24) { ROW = Math.min(Math.floor(fitRow), rowMax); break; }
        ROW = 24;
        const k2 = Math.max(0.02, Math.min(...COLS.map((c, i) => avail / (colOver[i] + colRows[i] * 24))));
        if (k2 >= k * 0.995) break;
        k = k2;
      }
      if (!best || k > best.k * 1.01) best = { k, heads, dial, ROW };
      if (k >= kw * 0.985) break;
    }
    const kf = best.k, heads = best.heads, dial = best.dial, ROW = best.ROW;
    // when the height binds, the header band may use the stage width: its origin moves left of the first column
    dial.dx = Math.max(0, (dial.bandW - W * kf) / 2 / kf);
    const y = {};
    y.dial = 0; y.dialH = dial.h / kf;
    y.area = y.dialH + G1 / kf; y.areaH = A / kf;
    y.head = y.area + y.areaH + G2 / kf; y.headH = heads.h / kf;
    y.chan = y.head + y.headH + G3 / (2 * kf);
    y.body = y.head + y.headH + G3 / kf;
    const rowY = new Float64Array(NF);
    const fMod = new Array(NF);
    const mods = new Map();
    const colMods = COLS.map(() => []);
    const colBottom = new Float64Array(NC);
    COLS.forEach((c) => {
      let yy = y.body + BPT;
      c.mods.forEach((m, j) => {
        if (j) yy += MG;
        const fs = featsOfMod.get(m.id);
        const g = { m, ci: c.i, x: colX[c.i] + PADX, y: yy, w: COL_W - 2 * PADX, h: MH + fs.length * ROW + MPB, fi: fs.map((f) => fIdx.get(f.id)) };
        g.fi.forEach((fi, r) => { rowY[fi] = yy + MH + r * ROW; fMod[fi] = g; });
        mods.set(m.id, g);
        colMods[c.i].push(g);
        yy += g.h;
      });
      colBottom[c.i] = yy + BPB;
    });
    const H = Math.max(...colBottom);
    const th = {};
    th.l1 = Math.max(kf * 1.34, 64 / COL_W, 7 / ROW);
    th.l2 = Math.max(th.l1 * 1.3, 12 / ROW, 112 / COL_W);
    th.l3 = Math.max(th.l2 * 1.2, 17 / ROW, 180 / COL_W);
    th.l4 = Math.max(th.l3 * 1.45, 46 / ROW, 236 / COL_W);
    th.max = Math.max(th.l4 * 2.4, 3);
    th.min = kf * 0.7;
    th.hd = Math.max(236 / y.headH, 214 / COL_W);
    const layout = { phone, sw, sh, mx, my, mb, kf, heads, dial, ROW, y, rowY, fMod, mods, colMods, colBottom, H, th, cwWide: cwForWide(), spineFs: phone ? 9 : 11 };
    layout.tl = computeTimeline(layout);
    return layout;
  }

  // the release stack: the same columns; bands for releases, oldest at the top. Headers, paddings and gaps keep a
  // constant screen size; only the chip stacks scale with the zoom, so zooming in grows the items, not the labels.
  function computeTimeline(Lx) {
    const kf = Lx.kf, phone = Lx.phone;
    const stripPx = stripHeight(Lx), AS = phone ? 16 : 18;
    const topPx = AS + stripPx;
    const HDR = phone ? 24 : 27, PADT = 2, PADB = 8, GAP = 6, TODAY = 34;
    const bands = RELS.map((r) => {
      const per = COLS.map(() => []);
      BP.releaseItems(r.id).forEach((it) => { const fi = fIdx.get(it.feature); if (fi != null) per[fCol[fi]].push({ fi, kind: it.kind, note: it.note }); });
      per.forEach((list) => list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.fi - b.fi));
      return { r, per, max: Math.max(1, ...per.map((l) => l.length)), n: per.reduce((s2, l) => s2 + l.length, 0) };
    });
    const cp = (phone ? 9 : 8.5) / kf; // chip pitch: 8.5 px at the opening zoom
    const ch = cp * 0.8;
    let u = 0, fx = 0, nextIdx = -1;
    const chipsOf = new Map();
    bands.forEach((b, i) => {
      if (b.r.state !== 'shipped' && nextIdx < 0) { nextIdx = i; fx += TODAY; }
      b.i = i; b.u0 = u; b.fxTop = fx; b.stackW = b.max * cp;
      b.chips = [];
      b.cols = b.per.map((list, ci) => list.map((it, j) => {
        const chip = { fi: it.fi, kind: it.kind, note: it.note, ci, j, band: b, x: colX[ci] + PADX, w: COL_W - 2 * PADX };
        b.chips.push(chip);
        if (!chipsOf.has(it.fi)) chipsOf.set(it.fi, []);
        chipsOf.get(it.fi).push(chip);
        return chip;
      }));
      if (b.r.state !== 'shipped') {
        const st = { ready: 0, building: 0, blocked: 0, planned: 0, live: 0 };
        b.chips.forEach((c2) => { if (c2.kind === 'new') st[FEATS[c2.fi].status] = (st[FEATS[c2.fi].status] || 0) + 1; });
        b.st = st;
      }
      b.kinds = { new: 0, improved: 0, fixed: 0 };
      b.chips.forEach((c2) => { b.kinds[c2.kind] += 1; });
      u += b.stackW;
      fx += HDR + PADT + PADB + GAP;
    });
    return { bands, U: u, FX: fx - GAP, cp, ch, topPx, stripPx, AS, chipsOf, HDR, PADT, PADB, GAP, TODAY, nextIdx: nextIdx < 0 ? bands.length - 1 : nextIdx };
  }
  // screen positions in the release stack (oy is the screen y of the first band's top)
  const tlTop = (b, k, oy) => oy + b.u0 * k + b.fxTop;
  const tlChipsY = (b, k, oy) => tlTop(b, k, oy) + L.tl.HDR + L.tl.PADT;
  const tlBottom = (b, k, oy) => tlChipsY(b, k, oy) + b.stackW * k + L.tl.PADB;
  const tlHeight = (k) => L.tl.U * k + L.tl.FX;
  const chipY = (ch, k, oy) => tlChipsY(ch.band, k, oy) + ch.j * L.tl.cp * k;
  const todayLineY = (k, oy) => { const b = L.tl.bands[L.tl.nextIdx]; return tlTop(b, k, oy) - (L.tl.TODAY + L.tl.GAP) / 2; };
  /** The point of the stack under screen y, so a zoom keeps it in place: oy' = sy - off - u * k' - fx. */
  function tlAnchor(sy, k, oy) {
    const T = L.tl;
    let b = T.bands[0];
    for (const x of T.bands) if (tlTop(x, k, oy) <= sy) b = x;
    const c0 = tlChipsY(b, k, oy);
    const u = b.u0 + clamp((sy - c0) / k, 0, b.stackW);
    const fx = b.fxTop + T.HDR + T.PADT;
    return { u, fx, off: sy - (oy + u * k + fx) };
  }
  function stripHeight(Lx) { return Lx.phone ? 30 : Lx.heads.wide ? 52 : 42; }

  // ══ views, camera ═══════════════════════════════════════════════════════════════════════════════
  function makeView(host, name) {
    const wrap = document.createElement('div');
    wrap.className = 'dc-view dc-view--' + name;
    const label = name === 'map'
      ? 'Columns map of ' + BP.product.name + ': ' + BP.areas.length + ' areas, ' + NC + ' domain columns, ' + BP.modules.length + ' modules and ' + NF + ' features. Drag to pan, scroll or pinch to zoom, click a feature to peek, arrow keys move between features.'
      : 'Release stack: ' + RELS.length + ' releases, oldest at the top, with their package items in the domain columns. Click a release band to inspect it.';
    const ladder = name === 'map'
      ? '<div class="dc-ladder" role="group" aria-label="Zoom level">' + ['Domains', 'Modules', 'Feature marks', 'Feature names', 'Feature detail'].map((t, i) => '<button type="button" data-dc-level="' + i + '" title="Level ' + i + ': ' + t + '" aria-label="Zoom to level ' + i + ', ' + t.toLowerCase() + '" aria-pressed="' + (i === 0) + '"><i style="height:' + (5 + i * 2) + 'px"></i></button>').join('') + '</div>'
      : '';
    wrap.innerHTML = '<canvas class="dc-cv" tabindex="0" role="application" aria-roledescription="' + (name === 'map' ? 'map' : 'timeline') + '" aria-label="' + esc(label) + '"></canvas>' +
      '<div class="dc-zoom" role="group" aria-label="Zoom">' +
        '<button type="button" data-dc-zoom="out" aria-label="Zoom out" title="Zoom out (−)"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
        ladder +
        '<button type="button" data-dc-zoom="in" aria-label="Zoom in" title="Zoom in (+)"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
        '<span class="dc-zoom__sep" aria-hidden="true"></span>' +
        '<button type="button" data-dc-zoom="fit" aria-label="Fit the whole product" title="Fit (0)"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.8 5V1.8H5M9 1.8h3.2V5M12.2 9v3.2H9M5 12.2H1.8V9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '</div>' +
      '<div class="dc-readout" aria-hidden="true"><span class="dc-readout__lvl"></span><span class="dc-readout__path"></span></div>' +
      '<div class="dc-tip" role="tooltip" hidden></div>';
    host.appendChild(wrap);
    const cv = wrap.querySelector('canvas');
    return {
      name, wrap, cv, ctx: cv.getContext('2d'), w: 0, h: 0, dpr: 1, dirty: true,
      lvl: wrap.querySelector('.dc-readout__lvl'), path: wrap.querySelector('.dc-readout__path'), tip: wrap.querySelector('.dc-tip'),
      ladder: wrap.querySelectorAll('[data-dc-level]'), roText: '', tipKey: '',
    };
  }
  const VM = makeView(shell.mapEl, 'map');
  const VT = makeView(shell.timelineEl, 'timeline');
  const active = () => (S.view === 'timeline' ? VT : VM);

  // x and zoom are shared by both views (the columns stay put); each view keeps its own vertical offset
  const cam = { x: 0, k: 0.3, y: { map: 0, timeline: 0 } };
  let flight = null; // { v, from, to, t0, dur }
  let touched = false;
  function clampCam(v) {
    if (!L) return;
    cam.k = clamp(cam.k, L.th.min, L.th.max);
    const k = cam.k;
    const vw = v.w;
    const cw = W * k;
    // content may travel until its edge reaches the middle of the view; narrower content stays inside the view
    let x0 = vw * 0.5 - W * k, x1 = vw * 0.5;
    if (cw < vw) { x0 = 4 - (vw - cw) * 0.5 + Math.min(0, (vw - cw) * 0.5 - 4); x1 = vw - cw - 4; x0 = Math.min(x0, (vw - cw) / 2); x1 = Math.max(x1, (vw - cw) / 2); }
    cam.x = clamp(cam.x, Math.min(x0, x1), Math.max(x0, x1));
    if (v === VM) {
      const vh = v.h, ch = L.H * k;
      let y0 = vh * 0.5 - L.H * k, y1 = vh * 0.5;
      if (ch < vh) { y0 = Math.min(L.my, (vh - ch) / 2); y1 = Math.max(vh - ch - 4, (vh - ch) / 2); }
      cam.y.map = clamp(cam.y.map, Math.min(y0, y1), Math.max(y0, y1));
    } else {
      const top = L.tl.topPx + 6, bottom = v.h - L.mb;
      const hs = tlHeight(k);
      cam.y.timeline = hs <= bottom - top ? top : clamp(cam.y.timeline, bottom - hs, top);
    }
  }
  function fitCam(v) {
    const k = L.kf;
    if (v === VM) return { x: (v.w - W * k) / 2, y: L.my + (v.h - L.my - L.mb - L.H * k) / 2, k };
    return tlCamFor(k, (v.w - W * k) / 2);
  }
  function tlCamFor(k, x) {
    const top = L.tl.topPx + 6, bottom = VT.h - L.mb;
    const hs = tlHeight(k);
    if (hs <= bottom - top) return { x, y: top, k };
    // taller than the view: the last shipped releases, today, the next release and the future
    const want = top + (bottom - top) * 0.46;
    const y = want - (todayLineY(k, 0));
    return { x, y: clamp(y, bottom - hs, top), k };
  }
  function setCam(v, x, y, k) {
    cam.x = x; cam.k = k; cam.y[v.name] = y;
    clampCam(v);
    v.dirty = true;
    (v === VM ? VT : VM).dirty = true;
    schedule();
  }
  /** Zoom detents: the camera never rests inside a cross-fade band (two renditions half drawn). Any zoom that
   *  settles inside one eases to its nearer edge; flights aim outside them. */
  function fadeBands() {
    const T = L.th, out = [];
    [T.l1, T.l2, T.l3, T.l4, T.hd].forEach((th) => out.push([th * Math.exp(-0.075), th * Math.exp(0.05)]));
    if (!L.heads.wide) out.push([(L.cwWide * 0.96) / COL_W, (L.cwWide * 1.06) / COL_W]);
    return out;
  }
  function detentK(k) {
    for (const [lo, hi] of fadeBands()) if (k > lo && k < hi) return k / lo < hi / k ? lo * 0.995 : hi * 1.005;
    return k;
  }
  let settleTimer = 0;
  function settleSoon(v, delay) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (v !== VM || flight || !L || S.view !== 'map') return;
      const k2 = detentK(cam.k);
      if (Math.abs(k2 - cam.k) > 1e-6) { const r = freeRectCached(); zoomAt(VM, r.w / 2, r.h / 2, k2, true, true); }
    }, delay == null ? 220 : delay);
  }
  function flyTo(v, to, dur, raw) {
    if (v === VM && !raw && L) {
      const k2 = clamp(detentK(to.k), L.th.min, L.th.max);
      if (k2 !== to.k) { const cx = v.w / 2, cy = v.h / 2; const wx = (cx - to.x) / to.k, wy = (cy - to.y) / to.k; to = { x: cx - wx * k2, y: cy - wy * k2, k: k2 }; }
    }
    if (reduced() || !dur) { setCam(v, to.x, to.y, to.k); return; }
    flight = { v, from: { x: cam.x, y: cam.y[v.name], k: cam.k }, to, t0: performance.now(), dur };
    schedule();
  }
  function stepFlight(t) {
    if (!flight) return false;
    const f = flight;
    const u = easeInOut(clamp((t - f.t0) / f.dur, 0, 1));
    // travel the world point at the view centre so zoom and pan move together
    const cx = f.v.w / 2, cy = f.v.h / 2;
    const k0 = f.from.k, k1 = f.to.k;
    const k = Math.exp(lerp(Math.log(k0), Math.log(k1), u));
    const wx = lerp((cx - f.from.x) / k0, (cx - f.to.x) / k1, u), wy = lerp((cy - f.from.y) / k0, (cy - f.to.y) / k1, u);
    cam.k = k; cam.x = cx - wx * k; cam.y[f.v.name] = f.v === VT ? lerp(f.from.y, f.to.y, u) : cy - wy * k;
    if (u >= 1) { cam.x = f.to.x; cam.k = f.to.k; cam.y[f.v.name] = f.to.y; clampCam(f.v); flight = null; }
    f.v.dirty = true;
    (f.v === VM ? VT : VM).dirty = true;
    return !!flight;
  }
  function zoomAt(v, sx, sy, k, animate, raw) {
    k = clamp(k, L.th.min, L.th.max);
    const wx = (sx - cam.x) / cam.k, wy = (sy - cam.y[v.name]) / cam.k;
    const to = { x: sx - wx * k, y: sy - wy * k, k };
    if (v === VT) { const a = tlAnchor(sy, cam.k, cam.y.timeline); to.y = sy - a.off - a.u * k - a.fx; }
    if (animate) flyTo(v, to, raw ? 200 : 280, raw); else setCam(v, to.x, to.y, to.k);
    touched = true;
  }
  function zoomBy(v, f) {
    const r = freeRectCached();
    zoomAt(v, r.w / 2, (v === VT ? (L.tl.topPx + r.h) / 2 : r.h / 2), cam.k * f, true);
  }
  function fitView(v, animate) {
    const to = fitCam(v);
    if (animate) flyTo(v, to, 460); else setCam(v, to.x, to.y, to.k);
    touched = false;
  }

  // ══ frame loop ═══════════════════════════════════════════════════════════════════════════════════
  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
  function requestDraw(v) { (v || active()).dirty = true; schedule(); }
  function frame(t) {
    raf = 0;
    if (pendingLocate) doLocate();
    if (pendingReveal) revealPending();
    let more = stepFlight(t);
    const v = active();
    if (anim && t - anim.t0 < anim.dur) { v.dirty = true; more = true; } else if (anim) { anim = null; v.dirty = true; }
    if (v.dirty && L && !S.page) {
      v.dirty = false;
      if (v === VM) drawMap(t); else drawTimeline(t);
      updateReadout(v);
    }
    if (more) schedule();
  }
  let anim = null; // view-switch animation { view, t0, dur, fromY }

  // ══ caches refreshed by events (no drawing here) ═════════════════════════════════════════════════
  let modGateN = new Map(), modMatchN = new Map(), domGateN = new Array(NC).fill(0), domCov = null;
  function refreshLens() {
    const lens = S.lens;
    for (let i = 0; i < NF; i++) { const r = BP.rating(FEATS[i], lens); fBand[i] = r.band; fScore[i] = r.score; }
    l4Cache.clear();
  }
  function refreshFilter() {
    const dim = shell.dimmedIds(), hits = shell.hitIds();
    const ini = S.initiative;
    for (let i = 0; i < NF; i++) {
      const id = FEATS[i].id;
      fDim[i] = dim.has(id) ? 1 : 0;
      fHit[i] = hits.has(id) ? 1 : 0;
      fCov[i] = ini ? BP.initiativeState(FEATS[i], ini) : null;
    }
    modGateN = new Map(); modMatchN = new Map(); domGateN = new Array(NC).fill(0);
    domCov = ini ? COLS.map(() => ({ covered: 0, 'in-progress': 0, pending: 0, finding: 0, n: 0 })) : null;
    if (domCov) for (let i = 0; i < NF; i++) if (fCov[i]) { domCov[fCol[i]][fCov[i]] += 1; domCov[fCol[i]].n += 1; }
    const gk = S.gates;
    BP.modules.forEach((m) => {
      let g = 0, n = 0;
      featsOfMod.get(m.id).forEach((f) => {
        const i = fIdx.get(f.id);
        if (!fDim[i]) n += 1;
        if (gk) fGates[i].forEach((x) => { if (gk === 'any' || x.kind === gk) g += 1; });
      });
      modGateN.set(m.id, g); modMatchN.set(m.id, n);
      domGateN[colIdx.get(m.domainId)] += g;
    });
  }
  const gateTotal = (g) => g.triage + g.approval + g.changes;
  const gateKindOf = (g) => (g.changes ? 'changes' : g.approval ? 'approval' : 'triage');

  // ══ the map ══════════════════════════════════════════════════════════════════════════════════════
  function lodOf(k) {
    const T = L.th;
    const a1 = rampK(k, T.l1), a2 = rampK(k, T.l2), a3 = rampK(k, T.l3), a4 = rampK(k, T.l4);
    return { a1, a2, a3, a4, level: k >= T.l4 ? 4 : k >= T.l3 ? 3 : k >= T.l2 ? 2 : k >= T.l1 ? 1 : 0 };
  }
  const levelName = ['Domains', 'Modules', 'Feature marks', 'Feature names', 'Feature detail'];

  function drawMap(t) {
    const v = VM, c = v.ctx, k = cam.k, ox = cam.x, oy0 = cam.y.map;
    c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    c.clearRect(0, 0, v.w, v.h);
    c.textBaseline = 'alphabetic';
    const lod = lodOf(k);
    const filtering = shell.filterActive();
    // view-switch entry: bodies drop in from above while the columns stay put
    let dropY = 0, dropA = 1;
    if (anim && anim.view === 'map') { const u = easeOut((t - anim.t0) / anim.dur); dropY = -(1 - u) * 26; dropA = u; }
    const oy = oy0;
    const sx = (wx) => wx * k + ox, sy = (wy) => wy * k + oy;
    const vx0 = -ox / k, vx1 = (v.w - ox) / k;
    const cw = COL_W * k;
    const spineA = L.heads.wide ? 0 : 1 - smooth(L.cwWide * 0.96, L.cwWide * 1.06, cw);
    const wideA = 1 - spineA;
    const visCols = [];
    for (let i = 0; i < NC; i++) if (colX[i] + COL_W >= vx0 - 4 && colX[i] <= vx1 + 4) visCols.push(i);

    // column plates
    const plateTop = sy(L.y.head) - 3;
    c.globalAlpha = 1;
    visCols.forEach((i) => {
      const x = sx(colX[i]), b = sy(L.colBottom[i]);
      rrect(c, x, plateTop, cw, b - plateTop, Math.min(8, cw * 0.08));
      c.fillStyle = P.paperHi; c.globalAlpha = P.dark ? 0.32 : 0.6; c.fill();
      c.globalAlpha = 1; c.lineWidth = 1; c.strokeStyle = P.rule2; c.stroke();
    });

    drawDial(c, k, ox, oy);
    drawAreaBanners(c, k, ox, oy, visCols);

    c.save();
    if (dropY) c.translate(0, dropY);
    c.globalAlpha = dropA;
    const baseA = dropA;
    // domain heads
    visCols.forEach((i) => drawHead(c, i, sx(colX[i]), sy(L.y.head), cw, L.y.headH * k, k, wideA, baseA));

    // column bodies
    const vy0 = (0 - oy - dropY) / k, vy1 = (v.h - oy - dropY) / k;
    visCols.forEach((i) => {
      const colSx = sx(colX[i]);
      if (spineA > 0.01 && lod.a1 < 0.99) drawSpine(c, i, colSx, k, oy, spineA * (1 - lod.a1) * baseA);
      L.colMods[i].forEach((g) => {
        if (g.y + g.h < vy0 || g.y > vy1) return;
        drawModule(c, g, k, ox, oy, lod, spineA, filtering, vy0, vy1, baseA);
      });
    });
    c.restore();
    c.globalAlpha = 1;

    drawSelection(c, k, ox, oy, lod);
    drawLinks(c, k, ox, oy, lod);
    drawStickyMap(c, k, ox, oy, lod, visCols);
  }

  // ── product header band: the instrument dial and the rollups ─────────────────────────────────────
  function drawDial(c, k, ox, oy) {
    const D = L.dial;
    // anchored to the map like any label: positions follow the zoom, sizes never grow past the opening fit
    const sp = k / L.kf, ss = Math.min(1, sp);
    const bx = ox - D.dx * k, by = L.y.dial * k + oy;
    if (by + D.h * sp < -10 || by > VM.h) return;
    const T0 = D.title;
    c.save();
    c.translate(bx + T0.x * sp, by + T0.y * sp);
    c.scale(ss, ss);
    c.translate(-T0.x, -T0.y);
    const lens = S.lens;
    const pr = BP.productRating(lens);
    const roll = BP.productRollup();
    // dial: a graticule ring, the 8 lens arcs (product band per lens), the current lens ticked, its band glyph inside
    const T = D.title;
    const cx = T.x + T.r, cy = T.y + T.r, R = T.r - 1;
    c.globalAlpha = 1;
    circle(c, cx, cy, R); c.fillStyle = P.paperHi; c.fill(); c.lineWidth = 1; c.strokeStyle = P.rule; c.stroke();
    c.beginPath();
    for (let a = 0; a < 360; a += 6) { const long = a % 30 === 0; const p0 = pt(R - (long ? 5 : 3), a), p1 = pt(R - 0.5, a); c.moveTo(cx + p0[0], cy + p0[1]); c.lineTo(cx + p1[0], cy + p1[1]); }
    c.lineWidth = 0.8; c.strokeStyle = P.ink4; c.stroke();
    const rr2 = R - 10, w = Math.max(3.4, R * 0.1);
    LENS_IDS.forEach((id, i) => {
      const r = BP.productRating(id);
      const cur = id === lens;
      c.beginPath(); c.arc(cx, cy, rr2, (i * 45 + 4 - 90) * DEG, ((i + 1) * 45 - 4 - 90) * DEG, false);
      c.lineWidth = cur ? w * 1.55 : w; c.strokeStyle = r.band === 'na' ? P.ink4 : BC(r.band); c.stroke();
      if (cur) {
        const a = pt(rr2 + w * 1.2, i * 45 + 22.5), b = pt(R + 2.5, i * 45 + 22.5);
        c.beginPath(); c.moveTo(cx + a[0], cy + a[1]); c.lineTo(cx + b[0], cy + b[1]); c.lineWidth = 1.6; c.lineCap = 'round'; c.strokeStyle = P.ink; c.stroke(); c.lineCap = 'butt';
      }
    });
    circle(c, cx, cy, rr2 - w - 3); c.lineWidth = 0.8; c.strokeStyle = P.rule2; c.setLineDash([1.2, 2.2]); c.stroke(); c.setLineDash([]);
    gBand(c, pr.band, cx, cy, Math.max(7, R * 0.3));
    // name, version and the current lens score
    const tx = T.x + T.r * 2 + 14;
    const ph = L.phone;
    txt(c, BP.product.name.toUpperCase(), tx, T.y + (ph ? 15 : 17), lab(600, ph ? 13 : 15), P.ink, 'left', ph ? 3.1 : 4.8);
    if (T.h >= 62) txt(c, 'v' + BP.product.version + ' → ' + BP.product.nextVersion, tx, T.y + (ph ? 30 : 34), mono(400, 11), P.ink3);
    const ly = T.y + T.h - (ph ? 5 : 8);
    const L1 = OK.lens(lens);
    txt(c, L1.label.toUpperCase(), tx, ly - 3, lab(500, 9.5), P['lens_' + lens] || P.ink2, 'left', 1.4);
    let lx = tx + tw(lab(500, 9.5), L1.label.toUpperCase(), 1.4) + 8;
    txt(c, pr.band === 'na' ? '–' : OK.fmt.score(pr.score), lx, ly + 1, mono(400, ph ? 19 : 22), P.ink);
    lx += tw(mono(400, ph ? 19 : 22), pr.band === 'na' ? '–' : OK.fmt.score(pr.score)) + 7;
    txt(c, OK.bandLabel(pr.band), lx, ly - 2, lab(400, 11.5), P.ink2);
    c.restore();
    // rollup blocks
    D.blocks.forEach((b) => {
      c.save();
      c.translate(bx + b.x * sp, by + b.y * sp);
      c.scale(ss, ss);
      c.translate(-b.x, -b.y);
      drawDialBlock(c, b, lens, pr, roll);
      c.restore();
    });
  }
  function blockLabel(c, s, x, y) { txt(c, s.toUpperCase(), x, y, lab(500, 9), P.ink3, 'left', 1.4); }
  function drawDialBlock(c, b, lens, pr, roll) {
    const x = b.x, y = b.y + 10, vy = b.y + 31;
    if (b.id === 'status') {
      blockLabel(c, 'Status', x, y);
      let cx = x;
      BP.STATUS_ORDER.forEach((s) => {
        gStatus(c, s, cx + 6, vy - 4, 5.6);
        const n = String(roll.byStatus[s] || 0);
        txt(c, n, cx + 16, vy, mono(400, 12.5), P.ink);
        cx += 13 + 5 + tw(mono(400, 12.5), n) + 13;
      });
    } else if (b.id === 'bands') {
      blockLabel(c, OK.lens(lens).label + ' bands', x, y);
      const counts = pr.counts, total = NF;
      let bx = x;
      const bw = b.w;
      ['good', 'fair', 'poor', 'critical', 'na'].forEach((bd) => {
        const wv = bw * (counts[bd] || 0) / total;
        if (wv <= 0) return;
        c.fillStyle = bd === 'na' ? (hatchStrong || P.naSoft) : BC(bd);
        c.fillRect(bx, y + 5, Math.max(0, wv - 1), 5);
        bx += wv;
      });
      let cx = x;
      ['good', 'fair', 'poor', 'critical', 'na'].forEach((bd) => {
        gBand(c, bd, cx + 5, vy - 4, 4.8);
        const n = String(counts[bd] || 0);
        txt(c, n, cx + 13, vy, mono(400, 11.5), bd === 'na' ? P.ink3 : P.ink);
        cx += 11 + 4 + tw(mono(400, 12.5), n) + 9;
      });
    } else if (b.id === 'gates') {
      blockLabel(c, 'Human gates', x, y);
      let cx = x;
      ['triage', 'approval', 'changes'].forEach((g) => {
        gGate(c, g, cx + 6, vy - 4, 5.6);
        const n = String(roll.gates[g]);
        txt(c, n, cx + 16, vy, mono(400, 12.5), g === 'changes' ? P.alarm : P.gate);
        const lw = tw(mono(400, 12.5), n);
        const l = OK.labels.gate ? OK.labels.gate[g].label : g;
        txt(c, l, cx + 16 + lw + 5, vy, lab(400, 11), P.ink2);
        cx += 12 + 5 + lw + 4 + tw(lab(400, 11), l) + 12;
      });
    } else if (b.id === 'attn') {
      blockLabel(c, 'Needs attention', x, y);
      gAttn(c, x + 6, vy - 4, 6);
      const n = String(roll.attention);
      txt(c, n, x + 16, vy, mono(400, 12.5), P.alarm);
      txt(c, 'features', x + 16 + tw(mono(400, 12.5), n) + 5, vy, lab(400, 11), P.ink2);
    } else if (b.id === 'next' && NEXT) {
      blockLabel(c, 'Next release', x, y);
      txt(c, NEXT.label, x, vy - 12 + 9, mono(500, 12), P.ink);
      let cx = x + tw(mono(500, 12), NEXT.label) + 6;
      txt(c, NEXT.name, cx, vy - 3, lab(500, 12.5), P.ink);
      cx += tw(lab(500, 12.5), NEXT.name) + 8;
      txt(c, OK.fmt.dateShort(NEXT.date) + ' · ' + OK.fmt.rel(NEXT.date), cx, vy - 3, mono(400, 11), P.ink3);
      // readiness sits beside when there is no second line; the block is one value line high
    }
  }

  // ── area banners ─────────────────────────────────────────────────────────────────────────────────
  function drawAreaBanners(c, k, ox, oy, visCols) {
    const s = Math.min(k / L.kf, 1);
    const y0 = L.y.area * k + oy, h = L.y.areaH * k;
    if (y0 + h < -4 || y0 > VM.h) return;
    AREAS.forEach((A) => {
      const x0 = colX[A.c0] * k + ox, x1 = (colX[A.c1] + COL_W) * k + ox;
      if (x1 < 0 || x0 > VM.w) return;
      drawAreaContent(c, A, x0, x1, y0, h, s, 1);
    });
  }
  function drawAreaContent(c, A, x0, x1, y0, h, s, alpha) {
    const a = A.a;
    const sel = S.selection && S.selection.type === 'area' && S.selection.id === a.id;
    c.globalAlpha = alpha;
    // rule with fine ticks (the chart's graticule)
    c.beginPath(); c.moveTo(x0, y0 + 0.5); c.lineTo(x1, y0 + 0.5); c.lineWidth = sel ? 2 : 1; c.strokeStyle = sel ? P.ink : P.ink3; c.stroke();
    c.beginPath();
    const step = 6;
    for (let x = x0; x <= x1; x += step) { const long = Math.round((x - x0) / step) % 5 === 0; c.moveTo(x + 0.5, y0); c.lineTo(x + 0.5, y0 + (long ? 4.5 : 2.5)); }
    c.lineWidth = 0.8; c.strokeStyle = P.rule; c.stroke();
    if (L.phone && s <= 1.05) { drawAreaPhone(c, A, x0, x1, y0, h); c.globalAlpha = 1; return; }
    const fs0 = 10 * Math.min(s, 1.4);
    const name = a.name.toUpperCase();
    const r = BP.areaRating(a.id, S.lens);
    const ro = BP.areaRollup(a.id);
    const pad = 4;
    const left = Math.max(x0 + pad, 8), right = x1 - pad;
    const baseY = y0 + Math.min(h, 24 * Math.min(s, 1.4)) * 0.5 + 3.5 + 2;
    const avail = right - left;
    const scoreTxt = r.band === 'na' ? '–' : OK.fmt.score(r.score);
    const gR = 4.6 * Math.min(s, 1.3);
    // the name has priority: full tracking, then tighter tracking, then a smaller size, then an ellipsis
    let fs = fs0, ls = fs * 0.2;
    if (tw(lab(500, fs), name, ls) > avail) ls = fs * 0.08;
    if (tw(lab(500, fs), name, ls) > avail) { fs = Math.max(8.5, fs0 - 1.5); ls = fs * 0.06; }
    const scoreW = gR * 2 + 4 + tw(mono(400, fs + 1), scoreTxt);
    let nm = fitText(lab(500, fs), name, avail, ls);
    if (nm !== name && nm.length < name.length * 0.7) nm = ''; // a stub of a name reads as broken: leave the glyph and score
    let x = left;
    if (nm) { txt(c, nm, x, baseY, lab(500, fs), P.ink, 'left', ls); x += tw(lab(500, fs), nm, ls) + 10; }
    if (x + scoreW <= right + 1) {
      gBand(c, r.band, x + gR, baseY - 3.6, gR);
      txt(c, scoreTxt, x + gR * 2 + 4, baseY, mono(400, fs + 1), P.ink2);
      x += scoreW + 10;
    }
    const cfs = mono(400, fs + 0.5);
    if (ro.attention && x + 30 <= right) {
      gAttn(c, x + 4, baseY - 3.6, 4.2); txt(c, String(ro.attention), x + 11, baseY, cfs, P.alarm);
      x += 11 + tw(cfs, String(ro.attention)) + 9;
    }
    const gsum = gateTotal(ro.gates);
    if (gsum && x + 30 <= right) { gGate(c, gateKindOf(ro.gates), x + 4, baseY - 3.6, 4.2); txt(c, String(gsum), x + 11, baseY, cfs, P.gate); }
    c.globalAlpha = 1;
  }

  function drawAreaPhone(c, A, x0, x1, y0, h) {
    const a = A.a;
    const r = BP.areaRating(a.id, S.lens);
    const last = A.c1 === NC - 1;
    const right = last ? VM.w - 3 : x1 - 2;
    const fs = 8, ls = 0.5, font = lab(500, fs);
    const avail = right - (x0 + 11);
    let wr = wrapLines(font, a.name.toUpperCase(), avail, 2, ls);
    let tx = x0 + 11, glyphAfter = false;
    if (!wr.ok && !/\s/.test(a.name)) {
      // a single long word: hyphenate it after a vowel, as close to the middle as fits; the glyph moves after it
      const avail2 = right - (x0 + 3);
      const w0 = a.name.toUpperCase();
      for (let d = 0; d < w0.length / 2 && !wr.ok; d++) {
        for (const i of [Math.ceil(w0.length / 2) + d, Math.ceil(w0.length / 2) - d]) {
          if (i < 3 || i > w0.length - 3 || !/[AEIOU]/.test(w0[i - 1]) || /[AEIOU]/.test(w0[i])) continue;
          const l1 = w0.slice(0, i) + '-', l2 = w0.slice(i);
          if (tw(font, l1, ls) <= avail2 && tw(font, l2, ls) + 10 <= avail2) { wr = { lines: [l1, l2], ok: true }; tx = x0 + 3; glyphAfter = true; break; }
        }
      }
    }
    if (!glyphAfter) gBand(c, r.band, x0 + 5, y0 + 10, 3.6);
    else gBand(c, r.band, tx + tw(font, wr.lines[1], ls) + 6, y0 + 20, 3.6);
    if (wr.ok) wr.lines.forEach((ln, j) => txt(c, ln, tx, y0 + 13 + j * 10, font, P.ink, 'left', ls));
    else txt(c, r.band === 'na' ? '–' : OK.fmt.score(r.score), x0 + 11, y0 + 13, mono(400, 9), P.ink2);
  }

  // ── domain heads ─────────────────────────────────────────────────────────────────────────────────
  function drawHead(c, i, x, y0, w, h, k, wideA, baseA) {
    if (y0 + h < -4 || y0 > VM.h + 4) return;
    const sel = S.selection && S.selection.type === 'domain' && S.selection.id === DOMS[i].id;
    const dA = rampK(k, L.th.hd);
    // while the sticky strip covers the top of the head region, its content slides down inside the region
    const stripA = smooth(-6, -46, y0);
    const cover = (L.tl.AS + L.tl.stripPx + 4) * easeOut(stripA) - y0;
    // under the strip (which names the domain) the detail head drops its own name line
    const noName = cover > 8;
    const contentH = dA > 0.5 ? (noName ? 214 : 286) : L.heads.wide ? 118 : 86;
    const y = y0 + clamp(cover, 0, Math.max(0, h - contentH));
    if (L.phone && w < 60) { c.globalAlpha = baseA; drawHeadPhone(c, i, x, y, w, h); }
    else {
      if (wideA < 0.99) { c.globalAlpha = baseA * (1 - wideA); drawHeadNarrow(c, i, x, y, w, h); }
      if (wideA > 0.01 && dA < 0.99) { c.globalAlpha = baseA * wideA * (1 - dA); drawHeadWide(c, i, x, y, w, h); }
      if (dA > 0.01) { c.globalAlpha = baseA * dA; drawHeadDetail(c, i, x, y, w, h - (y - y0), noName); }
    }
    c.globalAlpha = baseA;
    // initiative coverage across the column head: covered, in progress, pending, finding (share of the domain)
    if (domCov && domCov[i].n) {
      const dc = domCov[i], total = COLS[i].feats.length;
      const bx0 = x + 5, bw0 = w - 10;
      let bx2 = bx0;
      c.fillStyle = P.rule2; c.fillRect(bx0, y + 3, bw0, 4);
      ['covered', 'in-progress', 'pending', 'finding'].forEach((st) => { const ww = bw0 * dc[st] / total; if (ww > 0) { c.fillStyle = P[COV_COLOR[st]]; c.fillRect(bx2, y + 3, ww, 4); bx2 += ww; } });
    }
    if (sel) { rrect(c, x + 1, y0 - 2, w - 2, (L.colBottom[i] - L.y.head) * k + 1, Math.min(8, w * 0.08)); c.lineWidth = 2; c.strokeStyle = P.ink; c.stroke(); }
  }
  function domCounters(c, i, x, y, fs, maxX, center) {
    const d = DOMS[i];
    const ro = BP.domainRollup(d.id);
    const items = [];
    if (ro.attention) items.push(['attn', ro.attention]);
    const gn = S.gates ? domGateN[i] : gateTotal(ro.gates);
    if (gn) items.push(['gate', gn, gateKindOf(ro.gates)]);
    const font = mono(S.gates ? 500 : 400, fs);
    const r = fs * 0.4;
    let total = 0;
    items.forEach((it) => { total += r * 2 + 3 + tw(font, String(it[1])) + 7; });
    let cx = center ? x - (total - 7) / 2 : x;
    items.forEach((it) => {
      const s = String(it[1]);
      if (cx + r * 2 + 3 + tw(font, s) > maxX + 1) return;
      if (it[0] === 'attn') { gAttn(c, cx + r, y - fs * 0.34, r * 1.15); txt(c, s, cx + r * 2 + 3, y, font, P.alarm); }
      else { gGate(c, S.gates && S.gates !== 'any' ? S.gates : it[2], cx + r, y - fs * 0.34, r * 1.1); txt(c, s, cx + r * 2 + 3, y, font, P.gate); }
      cx += r * 2 + 3 + tw(font, s) + 7;
    });
  }
  function drawHeadWide(c, i, x, y, w, h) {
    const d = DOMS[i];
    const r = BP.domainRating(d.id, S.lens);
    const ro = BP.domainRollup(d.id);
    const px = x + 7;
    txt(c, d.code, px, y + 15, mono(500, 10), P.ink3);
    const cnt = ro.count + (w >= 120 ? ' features' : '');
    if (tw(mono(400, 10), cnt) + tw(mono(500, 10), d.code) + 22 <= w) txt(c, cnt, x + w - 7, y + 15, mono(400, 10), P.ink3, 'right');
    const fs = L.heads.wide ? L.heads.fs : 10.5;
    const font = lab(500, fs);
    const lines = wrapLines(font, d.name, w - 14, 2).lines;
    lines.forEach((ln, j) => txt(c, ln, px, y + 33 + j * fs * 1.22, font, P.ink));
    const gy = y + 33 + 2 * fs * 1.22 + 13;
    gBand(c, r.band, px + 9.5, gy, 9.5);
    txt(c, r.band === 'na' ? '–' : OK.fmt.score(r.score), px + 25, gy + 6, mono(400, 18), r.band === 'na' ? P.ink3 : P.ink);
    domCounters(c, i, px, gy + 26, 11, x + w - 6, false);
    // the domain in all 8 lenses, in lens order, once the head has room (the current lens underlined)
    const ly = gy + 46;
    if (ly + 10 < y + h && w >= 96) {
      const step = Math.min(22, (w - 14) / 8);
      LENS_IDS.forEach((id, j) => {
        const lx = px + 5 + step * j;
        gBand(c, BP.domainRating(d.id, id).band, lx, ly, 4.4);
        if (id === S.lens) { c.fillStyle = P.ink; c.fillRect(lx - 4.5, ly + 7, 9, 1.6); }
      });
    }
  }
  function drawHeadNarrow(c, i, x, y, w, h) {
    const d = DOMS[i];
    const r = BP.domainRating(d.id, S.lens);
    const cx = x + w / 2;
    txt(c, d.code, cx, y + 13, mono(500, w < 30 ? 8.5 : 10), P.ink3, 'center');
    const gr = clamp(w * 0.25, 5, 11);
    gBand(c, r.band, cx, y + 20 + gr, gr);
    txt(c, r.band === 'na' ? '–' : OK.fmt.score(r.score), cx, y + 20 + 2 * gr + 14, mono(400, w < 34 ? 10 : 12), r.band === 'na' ? P.ink3 : P.ink, 'center');
    if (h >= 60) stackCounters(c, i, cx, y + 20 + 2 * gr + 29, 9.5, w);
  }
  /** Attention and gate counters centred under a narrow head: one line when they fit, else one under the other. */
  function stackCounters(c, i, cx, y, fs, w) {
    const ro = BP.domainRollup(DOMS[i].id);
    const gn = S.gates ? domGateN[i] : gateTotal(ro.gates);
    const font = mono(S.gates ? 500 : 400, fs);
    const r = fs * 0.4;
    const items = [];
    if (ro.attention) items.push(['attn', ro.attention]);
    if (gn) items.push(['gate', gn]);
    const wOf = (it) => r * 2 + 2 + tw(font, String(it[1]));
    const one = items.reduce((sum, it) => sum + wOf(it), 0) + (items.length - 1) * 5;
    const lines = one <= w - 4 ? [items] : items.map((it) => [it]);
    lines.forEach((ln, li) => {
      const tot = ln.reduce((sum, it) => sum + wOf(it), 0) + (ln.length - 1) * 5;
      let x = cx - tot / 2;
      const yy = y + li * (fs + 3);
      ln.forEach((it) => {
        const sv = String(it[1]);
        if (it[0] === 'attn') { gAttn(c, x + r, yy - fs * 0.34, r * 1.1); txt(c, sv, x + r * 2 + 2, yy, font, P.alarm); }
        else { gGate(c, S.gates && S.gates !== 'any' ? S.gates : gateKindOf(ro.gates), x + r, yy - fs * 0.34, r * 1.05); txt(c, sv, x + r * 2 + 2, yy, font, P.gate); }
        x += wOf(it) + 5;
      });
    });
  }
  function drawHeadPhone(c, i, x, y, w, h) {
    const d = DOMS[i];
    const r = BP.domainRating(d.id, S.lens);
    const cx = x + w / 2;
    txt(c, d.code, cx, y + 11, mono(500, w < 22 ? 7.5 : 8.5), P.ink3, 'center');
    const gr = clamp(w * 0.3, 4, 8);
    gBand(c, r.band, cx, y + 16 + gr, gr);
    txt(c, r.band === 'na' ? '–' : OK.fmt.score(r.score), cx, y + 16 + 2 * gr + 11, mono(400, w < 24 ? 8.5 : 10), P.ink, 'center');
    // attention stays visible even here: the count in alarm red under a small asterisk
    const ro = BP.domainRollup(d.id);
    if (h >= 50 && ro.attention) {
      const ay = y + 16 + 2 * gr + 17;
      gAttn(c, cx, ay + 2, 3);
      txt(c, String(ro.attention), cx, ay + 14, mono(500, w < 24 ? 8 : 9), P.alarm, 'center');
    }
  }
  function drawHeadDetail(c, i, x, y, w, h, noName) {
    const d = DOMS[i];
    const lens = S.lens;
    const r = BP.domainRating(d.id, lens);
    const ro = BP.domainRollup(d.id);
    const px = x + 12, maxW = w - 24;
    let yy = y + 18;
    if (!noName) {
      txt(c, fitText(mono(400, 10.5), d.code + ' · ' + ro.count + ' features · ' + COLS[i].mods.length + ' modules', maxW), px, yy, mono(400, 10.5), P.ink3);
      yy += 22;
      const nf = lab(500, 19);
      const nl = wrapLines(nf, d.name, maxW, 2).lines;
      nl.forEach((ln) => { txt(c, ln, px, yy, nf, P.ink); yy += 22; });
      yy += 6;
    } else yy -= 4;
    gBand(c, r.band, px + 11, yy + 3, 11);
    const sc = r.band === 'na' ? '–' : OK.fmt.score(r.score);
    txt(c, sc, px + 29, yy + 10, mono(400, 22), r.band === 'na' ? P.ink3 : P.ink);
    const lx = px + 29 + tw(mono(400, 22), sc) + 10;
    txt(c, fitText(lab(500, 9.5), OK.lens(lens).label.toUpperCase(), x + w - 12 - lx, 1.4), lx, yy + 1, lab(500, 9.5), P['lens_' + lens] || P.ink2, 'left', 1.4);
    txt(c, fitText(lab(400, 11.5), OK.bandLabel(r.band) + (r.applicable != null ? ' · ' + r.applicable + ' of ' + ro.count + ' rated' : ''), x + w - 12 - lx), lx, yy + 15, lab(400, 11.5), P.ink2);
    yy += 34;
    domCounters(c, i, px, yy, 11.5, x + w - 12, false);
    yy += 22;
    const sf = lab(400, 12.5);
    const sl = wrapLines(sf, d.summary || '', maxW, 3).lines;
    if (yy + sl.length * 17 < y + h - 46) sl.forEach((ln) => { txt(c, ln, px, yy, sf, P.ink2); yy += 17; });
    yy += 8;
    // all 8 lenses: band glyph, short name and score, 4 or 2 to a row
    const cols = maxW >= 330 ? 4 : 2;
    const per = Math.floor(maxW / cols);
    const rows = 8 / cols;
    if (yy + rows * 21 < y + h - 4 && per >= 74) {
      LENS_IDS.forEach((id, j) => {
        const rr3 = BP.domainRating(d.id, id);
        const lx2 = px + (j % cols) * per, ly2 = yy + 4 + Math.floor(j / cols) * 21;
        gBand(c, rr3.band, lx2 + 5, ly2 - 4, 5);
        const l = OK.lens(id);
        txt(c, l.short, lx2 + 15, ly2, lab(id === lens ? 500 : 400, 11.5), id === lens ? P.ink : P.ink2);
        txt(c, rr3.band === 'na' ? '–' : OK.fmt.score(rr3.score), lx2 + per - 12, ly2, mono(400, 11), P.ink3, 'right');
      });
    }
  }
  // the domain name written down the column spine when the column is too narrow for it
  function drawSpine(c, i, colSx, k, oy, a) {
    const d = DOMS[i];
    const top = (L.y.body + BPT) * k + oy, bottom = (L.colBottom[i] - BPB) * k + oy;
    const fs = L.spineFs;
    const font = lab(500, fs);
    const s = fitText(font, d.name, bottom - top - 6, 0.3);
    if (!s) return;
    c.save();
    c.globalAlpha = a;
    c.translate(colSx + PADX * k * 0.5 + fs * 0.5 + 1.5, top + 3);
    c.rotate(Math.PI / 2);
    txt(c, s, 0, 0, font, P.ink2, 'left', 0.3);
    c.restore();
  }
  const spineW = () => L.spineFs + 5;

  // ── modules and features ─────────────────────────────────────────────────────────────────────────
  function drawModule(c, g, k, ox, oy, lod, spineA, filtering, vy0, vy1, baseA) {
    const m = g.m;
    const mx0 = g.x * k + ox, my0 = g.y * k + oy, mw = g.w * k, mh = g.h * k;
    const mr = BP.moduleRating(m.id, S.lens);
    const ro = BP.moduleRollup(m.id);
    const sel = S.selection && S.selection.type === 'module' && S.selection.id === m.id;
    const gk = S.gates;
    const gN = gk ? (modGateN.get(m.id) || 0) : 0;
    const allDim = filtering && !(modMatchN.get(m.id) > 0);
    // L0: a bar coloured by the module's band
    const barA = 1 - lod.a1;
    if (barA > 0.01) {
      const inset = spineA * spineW() * (1 - lod.a1);
      const bx = mx0 + inset, bw = mw - inset;
      const r = Math.min(4, bw * 0.12);
      c.globalAlpha = baseA * barA * (filtering ? 0.22 : 1);
      rrect(c, bx, my0, bw, mh, r);
      if (mr.band === 'na') { c.fillStyle = P.naSoft; c.fill(); c.fillStyle = hatch || P.naSoft; c.fill(); c.setLineDash([3, 2.5]); c.lineWidth = 1; c.strokeStyle = P.na; c.stroke(); c.setLineDash([]); }
      else {
        c.fillStyle = BC(mr.band); c.globalAlpha *= P.dark ? 0.78 : 0.86; c.fill();
        // features where the lens does not apply keep their own place on the bar, hatched
        const rowH0 = L.ROW * k;
        c.save(); rrect(c, bx, my0, bw, mh, r); c.clip();
        g.fi.forEach((fi) => {
          if (fBand[fi] !== 'na') return;
          const ry = L.rowY[fi] * k + oy;
          c.globalAlpha = baseA * barA * (filtering ? 0.22 : 1);
          c.fillStyle = P.paperHi; c.fillRect(bx, ry, bw, rowH0);
          c.fillStyle = hatch || P.naSoft; c.fillRect(bx, ry, bw, rowH0);
        });
        c.restore();
      }
      c.globalAlpha = baseA * barA;
      // filter ticks: the matching features, at their own rows, over the faded bars
      if (filtering) {
        const rowH = L.ROW * k;
        g.fi.forEach((fi) => {
          if (fDim[fi]) return;
          const ry = L.rowY[fi] * k + oy;
          const cov = fCov[fi];
          c.fillStyle = cov ? P[COV_COLOR[cov]] : fBand[fi] === 'na' ? P.na : BC(fBand[fi]);
          c.fillRect(bx, ry + (rowH > 3 ? 0.5 : 0), bw, Math.max(1.4, rowH - (rowH > 3 ? 1 : 0)));
          if (fHit[fi]) { c.fillStyle = P.ink; c.fillRect(bx - 3, ry, 2, Math.max(2, rowH)); }
        });
      }
      // attention: a red asterisk at each feature's own row on the bar's edge; gated features get a gate ring
      const rowH = L.ROW * k;
      if (bw >= 12 && rowH >= 3.5) {
        const ar = clamp(rowH * 0.36, 2.6, 4.2);
        g.fi.forEach((fi) => {
          const ry = (L.rowY[fi] + L.ROW / 2) * k + oy;
          if (fAttn[fi]) {
            c.globalAlpha = baseA * barA * (filtering && fDim[fi] ? 0.3 : 1);
            circle(c, bx + bw - ar - 2.5, ry, ar + 1.3); c.fillStyle = P.paperHi; c.fill();
            gAttn(c, bx + bw - ar - 2.5, ry, ar);
          }
          if (gk && !fDim[fi] && fGates[fi].some((x) => gk === 'any' || x.kind === gk)) {
            c.globalAlpha = baseA * barA;
            const kd = gk === 'any' ? fGates[fi][0].kind : gk;
            circle(c, bx + ar + 2.5, ry, ar + 1.3); c.fillStyle = P.paperHi; c.fill();
            gGate(c, kd, bx + ar + 2.5, ry, ar);
          }
        });
        c.globalAlpha = baseA * barA;
      } else if (ro.attention) {
        g.fi.forEach((fi) => { if (!fAttn[fi]) return; const ry = L.rowY[fi] * k + oy; c.fillStyle = P.alarm; c.fillRect(bx + bw - 2, ry, 2, Math.max(1.5, rowH)); });
      }
      if (sel) { rrect(c, bx - 1.5, my0 - 1.5, bw + 3, mh + 3, r + 1); c.lineWidth = 2; c.strokeStyle = P.ink; c.stroke(); }
    }
    if (lod.a1 <= 0.01) { c.globalAlpha = baseA; return; }
    // L1+: the card
    const cardA = baseA * lod.a1 * (allDim ? 0.35 : 1);
    c.globalAlpha = cardA;
    rrect(c, mx0, my0, mw, mh, Math.min(6, mw * 0.05));
    c.fillStyle = P.paperHi; c.fill();
    if (mr.band !== 'na') { c.globalAlpha = cardA * (1 - lod.a2 * 0.6); c.fillStyle = BS(mr.band); c.fill(); c.globalAlpha = cardA; }
    c.lineWidth = sel ? 2 : 1; c.strokeStyle = sel ? P.ink : P.rule; c.stroke();
    // band edge on the left
    c.save(); rrect(c, mx0, my0, mw, mh, Math.min(6, mw * 0.05)); c.clip();
    if (mr.band === 'na') { c.fillStyle = hatchStrong || P.na; c.fillRect(mx0, my0, 3.5, mh); } else { c.fillStyle = BC(mr.band); c.fillRect(mx0, my0, 3, mh); }
    c.restore();
    const rowH = L.ROW * k;
    // L1: title, glyph, counters and pips
    const tA = lod.a1 * (1 - lod.a2);
    if (tA > 0.01) {
      c.globalAlpha = baseA * tA;
      drawModuleTitle(c, g, mx0, my0, mw, mh, mr, ro, gN);
      const pr = clamp(rowH * 0.3, 1.5, 4.2);
      const px = mx0 + Math.max(9, Math.min(13, mw * 0.08));
      g.fi.forEach((fi) => {
        const ry = (L.rowY[fi] + L.ROW / 2) * k + oy;
        if (ry < -10 || ry > VM.h + 10) return;
        c.globalAlpha = baseA * tA * (fDim[fi] ? 0.16 : 1);
        const b = fBand[fi];
        if (b === 'na') { circle(c, px, ry, pr - 0.4); c.lineWidth = 1; c.strokeStyle = P.na; c.setLineDash([1.3, 1.1]); c.stroke(); c.setLineDash([]); }
        else { circle(c, px, ry, pr); c.fillStyle = BC(b); c.fill(); }
        if (fAttn[fi]) { circle(c, px, ry, pr + 1.8); c.lineWidth = 1.1; c.strokeStyle = P.alarm; c.stroke(); }
        if (fHit[fi]) { circle(c, px, ry, pr + 3.2); c.lineWidth = 1.3; c.strokeStyle = P.ink; c.stroke(); }
        if (fCov[fi] && !fDim[fi]) { c.fillStyle = P[COV_COLOR[fCov[fi]]]; c.fillRect(px + pr + 3, ry - 1, 6, 2); }
      });
    }
    if (lod.a2 <= 0.01) { c.globalAlpha = baseA; return; }
    // L2+: header strip and rows
    const hA = baseA * lod.a2 * (allDim ? 0.35 : 1);
    c.globalAlpha = hA;
    drawModuleHeader(c, g, mx0, my0, mw, MH * k, mr, ro, gN);
    const j0 = Math.max(0, Math.floor((vy0 - g.y - MH) / L.ROW) - 1), j1 = Math.min(g.fi.length - 1, Math.ceil((vy1 - g.y - MH) / L.ROW) + 1);
    for (let j = j0; j <= j1; j++) drawRow(c, g.fi[j], g, k, ox, oy, lod, baseA);
    c.globalAlpha = baseA;
  }
  function drawModuleTitle(c, g, x, y, w, h, mr, ro, gN) {
    const m = g.m;
    const px = x + Math.max(20, Math.min(26, w * 0.12)), maxW = x + w - 8 - px;
    if (maxW < 30) return;
    let fs = maxW < 70 ? 11 : 12.5;
    let wr = wrapLines(lab(500, fs), m.name, maxW, 2);
    if (!wr.ok && fs > 10.5) { fs = Math.max(10.5, fs - 1.5); wr = wrapLines(lab(500, fs), m.name, maxW, 2); }
    const font = lab(500, fs);
    const lines = wr.lines;
    let yy = y + 8 + fs;
    for (const ln of lines) { if (yy > y + h - 4) return; txt(c, ln, px, yy, font, P.ink); yy += fs * 1.25; }
    yy += 7;
    if (yy + 4 > y + h - 2) return;
    gBand(c, mr.band, px + 5.5, yy - 4, 5.5);
    const sc = mr.band === 'na' ? '–' : OK.fmt.score(mr.score);
    txt(c, sc, px + 15, yy, mono(400, 12), mr.band === 'na' ? P.ink3 : P.ink);
    let cx = px + 15 + tw(mono(400, 12), sc) + 8;
    const fc = ro.count + ' features';
    if (cx + tw(lab(400, 11), fc) <= x + w - 8) txt(c, fc, cx, yy, lab(400, 11), P.ink3);
    yy += 17;
    if (yy > y + h - 3) return;
    cx = px;
    if (ro.attention) { gAttn(c, cx + 4, yy - 4, 4.4); txt(c, String(ro.attention), cx + 11, yy, mono(400, 11), P.alarm); cx += 11 + tw(mono(400, 11), String(ro.attention)) + 9; }
    const gn = S.gates ? gN : gateTotal(ro.gates);
    if (gn) { gGate(c, S.gates && S.gates !== 'any' ? S.gates : gateKindOf(ro.gates), cx + 4, yy - 4, 4.4); txt(c, String(gn), cx + 11, yy, mono(S.gates ? 500 : 400, 11), P.gate); cx += 11 + tw(mono(400, 11), String(gn)) + 9; }
    if (S.initiative) {
      let n = 0, fnd = 0;
      g.fi.forEach((fi) => { if (fCov[fi]) n += 1; if (fCov[fi] === 'finding') fnd += 1; });
      if (n) { const s = n + ' in initiative' + (fnd ? ' · ' + fnd + ' finding' + (fnd > 1 ? 's' : '') : ''); if (cx + 20 < x + w - 8) txt(c, fitText(lab(400, 11), s, x + w - 8 - cx), cx, yy, lab(400, 11), fnd ? P.alarm : P.ink2); }
    }
  }
  function drawModuleHeader(c, g, x, y, w, h, mr, ro, gN) {
    if (h < 9) return;
    const m = g.m;
    const cy = y + h / 2 + 3.4;
    const right = x + w - 9;
    gBand(c, mr.band, right - 5, cy - 3.6, 5);
    const sc = mr.band === 'na' ? '–' : OK.fmt.score(mr.score);
    txt(c, sc, right - 14, cy, mono(400, 11), mr.band === 'na' ? P.ink3 : P.ink, 'right');
    let rx = right - 14 - tw(mono(400, 11), sc) - 9;
    const gn = S.gates ? gN : gateTotal(ro.gates);
    if (gn && w > 190) { const s = String(gn); txt(c, s, rx, cy, mono(S.gates ? 500 : 400, 10.5), P.gate, 'right'); rx -= tw(mono(400, 10.5), s) + 3; gGate(c, S.gates && S.gates !== 'any' ? S.gates : gateKindOf(ro.gates), rx - 4, cy - 3.6, 4.2); rx -= 14; }
    if (ro.attention && w > 170) { const s = String(ro.attention); txt(c, s, rx, cy, mono(400, 10.5), P.alarm, 'right'); rx -= tw(mono(400, 10.5), s) + 3; gAttn(c, rx - 4, cy - 3.6, 4.2); rx -= 14; }
    txt(c, fitText(lab(500, 11.5), m.name, rx - (x + 12) - 4), x + 12, cy, lab(500, 11.5), P.ink);
  }
  // one feature row: band tint, status glyph, marks (L2); name and score (L3); mini-detail (L4)
  function drawRow(c, fi, g, k, ox, oy, lod, baseA) {
    const f = FEATS[fi];
    const rx = (g.x + 4) * k + ox, rw = (g.w - 8) * k;
    const ry = (L.rowY[fi] + 1) * k + oy, rh = (L.ROW - 2) * k;
    if (ry > VM.h || ry + rh < 0) return;
    const dim = fDim[fi];
    const a0 = baseA * lod.a2 * (dim ? 0.16 : 1);
    const band = fBand[fi];
    c.globalAlpha = a0;
    rrect(c, rx, ry, rw, rh, Math.min(4, rh * 0.25));
    if (band === 'na') { c.fillStyle = P.paperHi; c.fill(); c.fillStyle = hatchLight || P.naSoft; c.fill(); }
    else { c.fillStyle = BS(band); c.fill(); }
    c.fillStyle = band === 'na' ? P.na : BC(band);
    if (band === 'na') { c.fillRect(rx, ry + 1, 2, rh - 2); } else c.fillRect(rx, ry, 2.5, rh);
    const cov = fCov[fi];
    if (cov && !dim) {
      rrect(c, rx - 1, ry - 1, rw + 2, rh + 2, Math.min(5, rh * 0.3));
      c.lineWidth = 1.6; c.strokeStyle = P[COV_COLOR[cov]];
      if (cov === 'in-progress') c.setLineDash([4, 2.5]); else if (cov === 'pending') c.setLineDash([1.5, 2]);
      c.stroke(); c.setLineDash([]);
    }
    if (fHit[fi]) { rrect(c, rx - 2, ry - 2, rw + 4, rh + 4, Math.min(6, rh * 0.3)); c.lineWidth = 1.5; c.strokeStyle = P.ink; c.stroke(); }
    const cy = ry + rh / 2;
    const midA = a0 * (1 - lod.a4);
    const gates = fGates[fi];
    const gk = S.gates;
    // L2 and L3 marks
    if (midA > 0.01) {
      c.globalAlpha = midA;
      const gr = clamp(rh * 0.3, 2.6, 5.4);
      gStatus(c, f.status, rx + 11, cy, gr);
      const tA = lod.a3;
      const nameFs = rh >= 24 ? 13 : 12.5;
      let right = rx + rw - 8;
      let scoreW = 0;
      if (tA > 0.01 && rw > 90) {
        c.globalAlpha = midA * tA;
        const sc = band === 'na' ? '–' : OK.fmt.score(fScore[fi]);
        gBand(c, band, right - 4.5, cy, 5);
        txt(c, sc, right - 13, cy + 3.8, mono(400, 11), band === 'na' ? P.ink3 : P.ink2, 'right');
        scoreW = 13 + tw(mono(400, 11), sc) + 8;
      }
      // marks slide left as the score arrives
      let mxr = right - scoreW * tA;
      c.globalAlpha = midA;
      const mr = clamp(rh * 0.24, 2.4, 4.6);
      if (fAttn[fi] && rw > 40) { gAttn(c, mxr - mr, cy, mr * 1.1); mxr -= mr * 2 + 5; }
      if (gates.length && rw > 56) {
        const shown = gk && gk !== 'any' ? gates.filter((x) => x.kind === gk) : gates;
        if (shown.length) {
          gGate(c, shown[0].kind, mxr - mr, cy, mr);
          if (gk) { circle(c, mxr - mr, cy, mr + 2.2); c.lineWidth = 1; c.strokeStyle = shown[0].kind === 'changes' ? P.alarm : P.gate; c.stroke(); }
          mxr -= mr * 2 + 5;
        }
      }
      if (tA > 0.01 && rw > 90) {
        c.globalAlpha = midA * tA;
        const nx = rx + 21;
        const nm = fitText(lab(400, nameFs), f.name, mxr - nx - 4);
        txt(c, nm, nx, cy + nameFs * 0.34, lab(400, nameFs), P.ink);
      }
    }
    if (lod.a4 > 0.01) { c.globalAlpha = baseA * lod.a4 * (dim ? 0.16 : 1); drawRowDetail(c, fi, rx, ry, rw, rh); }
    c.globalAlpha = baseA;
  }
  const l4Cache = new Map();
  function rowFacts(fi) {
    let r = l4Cache.get(fi);
    if (r) return r;
    const f = FEATS[fi];
    const rt = BP.rating(f, S.lens);
    const rel = f.release ? BP.release(f.release) : null;
    const relTxt = !rel ? 'Unscheduled' : f.status === 'live' ? 'Shipped in ' + rel.label : 'Targets ' + rel.label;
    const team = BP.team(f.owner);
    const who = (OK.labels.builder[f.builtBy] || f.builtBy) + (team ? ' · ' + team.name : '') + ' · ' + f.priority;
    r = { headline: rt.headline || OK.bandLabel(rt.band), relTxt, status: OK.statusLabel(f.status), who, live: f.status === 'live' };
    l4Cache.set(fi, r);
    return r;
  }
  /** L4: the row becomes a mini-detail inside its own space: corona (8 lenses, status inside), name, score, gates,
   *  attention, release and the current lens headline; a third line (builder, owner, priority) when there is room. */
  function drawRowDetail(c, fi, rx, ry, rw, rh) {
    const f = FEATS[fi];
    const facts = rowFacts(fi);
    const R = clamp(rh * 0.33, 8, 21);
    const cx = rx + 9 + R + 2, cy = ry + rh / 2;
    gCorona(c, fi, cx, cy, R, S.lens, true);
    const x0 = cx + R + 13;
    const right = rx + rw - 9;
    const lines = rh >= 66 ? 3 : 2;
    const lh = 16.5;
    const y1 = cy - ((lines - 1) * lh) / 2 + 4.5;
    // line 1, right to left: score and band glyph, gates (glyph and waiting days), attention; then the name
    const band = fBand[fi];
    const sc = band === 'na' ? '–' : OK.fmt.score(fScore[fi]);
    gBand(c, band, right - 6, y1 - 4.6, 6);
    txt(c, sc, right - 16, y1, mono(400, 14), band === 'na' ? P.ink3 : P.ink, 'right');
    let rxe = right - 16 - tw(mono(400, 14), sc) - 12;
    const mf = mono(400, 10.5);
    fGates[fi].slice(0, 2).forEach((g) => {
      const lbl = (OK.labels.gate[g.kind].label) + ' ' + g.waitingDays + ' d';
      const wide = rw > 330;
      const wd = (wide ? tw(mf, lbl) + 4 : 0) + 11;
      if (rxe - wd < x0 + 90) return;
      if (wide) txt(c, lbl, rxe, y1, mf, g.kind === 'changes' ? P.alarm : P.gate, 'right');
      gGate(c, g.kind, rxe - (wide ? tw(mf, lbl) + 4 : 0) - 5, y1 - 4, 5);
      rxe -= wd + 9;
    });
    if (fAttn[fi] && rxe - 14 > x0 + 90) { gAttn(c, rxe - 5, y1 - 4, 5.2); rxe -= 17; }
    const nf = lab(500, rh >= 56 ? 14 : 13);
    txt(c, fitText(nf, f.name, rxe - x0 - 4), x0, y1, nf, P.ink);
    // line 2: release (mono) then the current lens headline
    const y2 = y1 + lh;
    const rel = facts.relTxt;
    const rf = lab(500, 11);
    txt(c, rel, x0, y2, rf, P.ink3);
    const hx = x0 + tw(rf, rel) + 10;
    if (hx < right - 40) txt(c, fitText(lab(400, 11.5), facts.headline, right - hx), hx, y2, lab(400, 11.5), P.ink2);
    if (lines === 3) txt(c, fitText(lab(400, 11), facts.who, right - x0), x0, y2 + lh, lab(400, 11), P.ink3);
  }

  // ── selection, search pins, dependency links ─────────────────────────────────────────────────────
  function featScreen(fi, k, ox, oy) {
    const g = L.fMod[fi];
    return { x: (g.x + 4) * k + ox, y: (L.rowY[fi] + 1) * k + oy, w: (g.w - 8) * k, h: (L.ROW - 2) * k };
  }
  function drawSelection(c, k, ox, oy, lod) {
    c.globalAlpha = 1;
    // search hits at the overview: pins on the column edge, so they read even when rows are hairlines
    if (lod.a2 < 0.6 && S.query && S.query.trim()) {
      for (let fi = 0; fi < NF; fi++) {
        if (!fHit[fi]) continue;
        const r = featScreen(fi, k, ox, oy);
        if (r.y < -8 || r.y > VM.h + 8 || r.x + r.w < -8 || r.x > VM.w + 8) continue;
        const px = r.x - 4, py = r.y + r.h / 2;
        c.beginPath(); c.moveTo(px - 5, py - 3.5); c.lineTo(px, py); c.lineTo(px - 5, py + 3.5); c.closePath();
        c.fillStyle = P.ink; c.fill();
      }
    }
    const sel = S.selection;
    if (!sel || sel.type !== 'feature') return;
    const fi = fIdx.get(sel.id);
    if (fi == null) return;
    const r = featScreen(fi, k, ox, oy);
    if (lod.a2 > 0.5) {
      rrect(c, r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5, Math.min(6, r.h * 0.35));
      c.lineWidth = 2.2; c.strokeStyle = P.ink; c.stroke();
      rrect(c, r.x - 4.5, r.y - 4.5, r.w + 9, r.h + 9, Math.min(8, r.h * 0.4));
      c.lineWidth = 1; c.strokeStyle = P.paperHi; c.stroke();
    } else {
      const px = r.x + Math.max(9, Math.min(13, r.w * 0.08)) - 4 * k, py = r.y + r.h / 2;
      circle(c, px, py, 7.5); c.fillStyle = P.paperHi; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
      c.lineWidth = 2; c.strokeStyle = P.ink; c.stroke();
      circle(c, px, py, 2.6); c.fillStyle = P.ink; c.fill();
      // a leader to the right edge of the column so the pin is easy to find on a heat strip
      const cr = (colX[fCol[fi]] + COL_W) * k + ox;
      c.beginPath(); c.moveTo(px + 7.5, py); c.lineTo(cr + 6, py); c.lineWidth = 1.2; c.strokeStyle = P.ink; c.stroke();
    }
  }
  let linkCache = { id: null, deps: [], dents: [] };
  function linksOf(id) {
    if (linkCache.id === id) return linkCache;
    linkCache = { id, deps: BP.dependencies(id).map((f) => fIdx.get(f.id)), dents: BP.dependents(id).map((f) => fIdx.get(f.id)) };
    return linkCache;
  }
  /** Orthogonal route in world units: along the gutters beside the columns, crossing other columns only in the
   *  channel under the domain heads (or under the shortest column bodies), so links stay off the labels. */
  function route(a, b, lane) {
    const ca = fCol[a], cb = fCol[b];
    const ya = L.rowY[a] + L.ROW / 2, yb = L.rowY[b] + L.ROW / 2;
    const ga = L.fMod[a], gb = L.fMod[b];
    const off = (lane % 4) * 1.6;
    if (ca === cb) {
      const xg = colX[ca] + 2.2 + off * 0.4;
      return [[ga.x + 4, ya], [xg, ya], [xg, yb], [gb.x + 4, yb]];
    }
    const right = cb > ca;
    const ea = right ? ga.x + ga.w - 4 : ga.x + 4, eb = right ? gb.x + 4 : gb.x + gb.w - 4;
    const xa = right ? colX[ca] + COL_W + (gapAfter(ca) / 2) + off - 2.4 : colX[ca] - gapAfter(ca - 1) / 2 - off + 2.4;
    const xb = right ? colX[cb] - gapAfter(cb - 1) / 2 - off + 2.4 : colX[cb] + COL_W + gapAfter(cb) / 2 + off - 2.4;
    if (Math.abs(ca - cb) === 1) { const xg = (xa + xb) / 2; return [[ea, ya], [xg, ya], [xg, yb], [eb, yb]]; }
    const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
    let below = 0;
    for (let i = lo + 1; i < hi; i++) below = Math.max(below, L.colBottom[i]);
    const yTop = L.y.chan - lane * 2.2, yBot = below + 10 + lane * 2.2;
    const yc = Math.abs(ya - yTop) + Math.abs(yb - yTop) <= Math.abs(ya - yBot) + Math.abs(yb - yBot) ? yTop : yBot;
    return [[ea, ya], [xa, ya], [xa, yc], [xb, yc], [xb, yb], [eb, yb]];
  }
  const gapAfter = (i) => (i < 0 || i >= NC - 1 ? GAP_A : COLS[i].d.areaId === COLS[i + 1].d.areaId ? GAP_D : GAP_A);
  function strokeRoute(c, pts, k, ox, oy) {
    const sp = pts.map((p) => [p[0] * k + ox, p[1] * k + oy]);
    const rad = 6;
    c.beginPath();
    c.moveTo(sp[0][0], sp[0][1]);
    for (let i = 1; i < sp.length - 1; i++) {
      const [x0, y0] = sp[i - 1], [x1, y1] = sp[i], [x2, y2] = sp[i + 1];
      const r = Math.min(rad, Math.hypot(x1 - x0, y1 - y0) / 2, Math.hypot(x2 - x1, y2 - y1) / 2);
      c.arcTo(x1, y1, x2, y2, r);
    }
    c.lineTo(sp[sp.length - 1][0], sp[sp.length - 1][1]);
    c.stroke();
    return sp;
  }
  function drawLinks(c, k, ox, oy, lod) {
    const sel = S.selection;
    if (!sel || sel.type !== 'feature') return;
    const fi = fIdx.get(sel.id);
    if (fi == null) return;
    const lk = linksOf(sel.id);
    if (!lk.deps.length && !lk.dents.length) return;
    c.globalAlpha = 1;
    const ends = [];
    // halo first, then the line, so crossings stay legible on any background
    const pass = (halo) => {
      lk.deps.forEach((d, i) => {
        const pts = route(fi, d, i);
        c.setLineDash([]);
        c.lineWidth = halo ? 4.5 : 1.7; c.strokeStyle = halo ? P.paperHi : P.ink; c.globalAlpha = halo ? 0.85 : 1;
        const sp = strokeRoute(c, pts, k, ox, oy);
        if (!halo) ends.push([sp[sp.length - 1], 'out', d]);
      });
      lk.dents.forEach((d, i) => {
        const pts = route(d, fi, i + lk.deps.length);
        c.setLineDash(halo ? [] : [5, 3.5]);
        c.lineWidth = halo ? 4.5 : 1.5; c.strokeStyle = halo ? P.paperHi : P.ink2; c.globalAlpha = halo ? 0.85 : 1;
        const sp = strokeRoute(c, pts, k, ox, oy);
        if (!halo) ends.push([sp[0], 'in', d]);
      });
    };
    pass(true); pass(false);
    c.setLineDash([]);
    c.globalAlpha = 1;
    ends.forEach(([p, dir, d]) => {
      if (dir === 'out') {
        // arrowhead into the dependency
        const fromLeft = fCol[d] > fCol[fi] || (fCol[d] === fCol[fi]);
        const s = fromLeft ? 1 : -1;
        c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] - s * 6.5, p[1] - 3.6); c.lineTo(p[0] - s * 6.5, p[1] + 3.6); c.closePath(); c.fillStyle = P.ink; c.fill();
      } else { circle(c, p[0], p[1], 3); c.fillStyle = P.paperHi; c.fill(); c.lineWidth = 1.4; c.strokeStyle = P.ink2; c.stroke(); }
      // linked rows get an outline once rows are visible
      if (lod.a2 > 0.4) { const r = featScreen(d, k, ox, oy); rrect(c, r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3, Math.min(5, r.h * 0.3)); c.lineWidth = 1.3; c.strokeStyle = dir === 'out' ? P.ink : P.ink2; c.stroke(); }
    });
  }

  // ── sticky context at the top edge: areas, domains and (at L2+) modules ──────────────────────────
  function drawStrip(c, v, k, ox, alpha, yOff, visCols) {
    const AS = L.tl.AS, SH = L.tl.stripPx;
    const top = yOff;
    c.globalAlpha = alpha;
    c.fillStyle = P.paperHi; c.globalAlpha = 1; c.fillRect(0, top, v.w, AS + SH);
    c.globalAlpha = alpha;
    c.beginPath(); c.moveTo(0, top + AS + SH + 0.5); c.lineTo(v.w, top + AS + SH + 0.5); c.lineWidth = 1; c.strokeStyle = P.rule; c.stroke();
    // areas
    AREAS.forEach((A) => {
      const x0 = colX[A.c0] * k + ox, x1 = (colX[A.c1] + COL_W) * k + ox;
      if (x1 < 0 || x0 > v.w) return;
      const left = Math.max(x0, 6), right = x1;
      c.beginPath(); c.moveTo(x0, top + AS - 0.5); c.lineTo(x1, top + AS - 0.5); c.lineWidth = 1; c.strokeStyle = P.rule; c.stroke();
      const fs = L.phone ? 8.5 : 9.5;
      const nm = fitText(lab(500, fs), A.a.name.toUpperCase(), right - left - 6, fs * 0.18);
      txt(c, nm, left + 2, top + AS / 2 + 3.5, lab(500, fs), P.ink2, 'left', fs * 0.18);
    });
    // domains
    const cw = COL_W * k;
    const wide = cw >= L.cwWide && !L.phone;
    visCols.forEach((i) => {
      const x = colX[i] * k + ox;
      const d = DOMS[i];
      const r = BP.domainRating(d.id, S.lens);
      const sel = S.selection && S.selection.type === 'domain' && S.selection.id === d.id;
      const y = top + AS;
      if (sel) { c.fillStyle = P.bandHi; c.fillRect(x, y, cw, SH); }
      if (wide) {
        txt(c, d.code, x + 6, y + 14, mono(500, 9.5), P.ink3);
        const sc = r.band === 'na' ? '–' : OK.fmt.score(r.score);
        txt(c, sc, x + cw - 6, y + 14, mono(400, 10.5), P.ink2, 'right');
        gBand(c, r.band, x + cw - 6 - tw(mono(400, 10.5), sc) - 9, y + 10.5, 4.5);
        const fs = 10.5;
        const lines = wrapLines(lab(500, fs), d.name, cw - 12, 2).lines;
        lines.forEach((ln, j) => txt(c, ln, x + 6, y + 28 + j * 12.5, lab(500, fs), P.ink));
      } else {
        const cx = x + cw / 2;
        txt(c, d.code, cx, y + 12, mono(500, cw < 26 ? 7.5 : 9), P.ink2, 'center');
        const gr = clamp(cw * 0.2, 3.5, 6.5);
        gBand(c, r.band, cx, y + 17 + gr, gr);
        if (SH >= 40 && cw >= 22) txt(c, r.band === 'na' ? '–' : OK.fmt.score(r.score), cx, y + 17 + 2 * gr + 11, mono(400, cw < 34 ? 8.5 : 10), P.ink2, 'center');
      }
      if (i < NC - 1 && COLS[i + 1].d.areaId === d.areaId) { c.beginPath(); c.moveTo(x + cw + (GAP_D * k) / 2, y + 4); c.lineTo(x + cw + (GAP_D * k) / 2, y + SH - 4); c.lineWidth = 1; c.strokeStyle = P.rule2; c.stroke(); }
    });
    c.globalAlpha = 1;
  }
  function drawStickyMap(c, k, ox, oy, lod, visCols) {
    const headTop = L.y.head * k + oy;
    // the strip slides down as soon as the domain names have scrolled above the top edge
    const a = smooth(-6, -46, headTop);
    if (a <= 0.01) return;
    drawStrip(c, VM, k, ox, 1, -(1 - easeOut(a)) * (L.tl.AS + L.tl.stripPx + 2), visCols);
    // modules whose header strip has scrolled under it keep their name in a pill
    if (lod.a2 < 0.3) return;
    const top = L.tl.AS + L.tl.stripPx;
    const wy = (top - oy) / k;
    visCols.forEach((i) => {
      const g = L.colMods[i].find((m) => m.y + MH < wy + 2 / k && m.y + m.h > wy + 26 / k);
      if (!g) return;
      const x = g.x * k + ox, w = g.w * k;
      c.globalAlpha = a * lod.a2;
      c.fillStyle = P.paperHi; c.fillRect(x, top, w, 25);
      c.beginPath(); c.moveTo(x, top + 25.5); c.lineTo(x + w, top + 25.5); c.lineWidth = 1; c.strokeStyle = P.rule2; c.stroke();
      rrect(c, x + 5, top + 4, w - 10, 18, 9);
      c.fillStyle = P.panelSolid; c.fill(); c.lineWidth = 1; c.strokeStyle = P.rule; c.stroke();
      const mr = BP.moduleRating(g.m.id, S.lens);
      gBand(c, mr.band, x + 15, top + 13, 4);
      txt(c, fitText(lab(500, 9), g.m.name.toUpperCase(), w - 36, 1.1), x + 24, top + 16.3, lab(500, 9), P.ink2, 'left', 1.1);
    });
    c.globalAlpha = 1;
  }

  // ══ hit testing ═════════════════════════════════════════════════════════════════════════════════
  function colAt(wx) {
    for (let i = 0; i < NC; i++) if (wx >= colX[i] - GAP_D / 2 && wx <= colX[i] + COL_W + GAP_D / 2) return i;
    return -1;
  }
  function hitMap(sx, sy) {
    if (!L) return null;
    const k = cam.k, ox = cam.x, oy = cam.y.map;
    const wx = (sx - ox) / k, wy = (sy - oy) / k;
    const lod = lodOf(k);
    // sticky strip
    const headTop = L.y.head * k + oy;
    if (headTop < -30 && sy <= L.tl.AS + L.tl.stripPx) {
      const ci = colAt(wx);
      if (sy <= L.tl.AS) { const A = AREAS.find((x) => ci >= x.c0 && ci <= x.c1); return A ? { type: 'area', id: A.a.id } : null; }
      return ci >= 0 ? { type: 'domain', id: DOMS[ci].id } : null;
    }
    if (wy >= L.y.area && wy < L.y.head) {
      const ci = colAt(wx);
      const A = AREAS.find((x) => ci >= x.c0 && ci <= x.c1);
      return A ? { type: 'area', id: A.a.id } : null;
    }
    const ci = colAt(wx);
    if (ci < 0) return null;
    if (wy >= L.y.head && wy < L.y.body) return { type: 'domain', id: DOMS[ci].id };
    if (wy < L.y.body || wy > L.colBottom[ci]) return null;
    const cw = COL_W * k;
    const spineA = L.heads.wide ? 0 : 1 - smooth(L.cwWide * 0.96, L.cwWide * 1.06, cw);
    const colSx = colX[ci] * k + ox;
    if (spineA > 0.5 && lod.a1 < 0.5 && sx < colSx + PADX * k + spineW()) return { type: 'domain', id: DOMS[ci].id };
    const g = L.colMods[ci].find((m) => wy >= m.y - MG / 2 && wy <= m.y + m.h + MG / 2);
    if (!g) return { type: 'domain', id: DOMS[ci].id };
    const rowIdx = clamp(Math.floor((wy - g.y - MH) / L.ROW), 0, g.fi.length - 1);
    const inRows = wy >= g.y + MH;
    if (lod.level >= 2 && inRows) return { type: 'feature', id: FEATS[g.fi[rowIdx]].id };
    if (lod.level === 1 && inRows) {
      const px = g.x * k + ox + Math.max(9, Math.min(13, g.w * k * 0.08));
      if (Math.abs(sx - px) <= Math.max(9, L.ROW * k * 0.5)) return { type: 'feature', id: FEATS[g.fi[rowIdx]].id };
    }
    if (lod.level === 0 && shell.filterActive() && inRows) {
      // a filter tick under the pointer (within a few px) is a feature
      const fi = g.fi[rowIdx];
      if (!fDim[fi]) return { type: 'feature', id: FEATS[fi].id };
    }
    return { type: 'module', id: g.m.id };
  }
  function hitTimeline(sx, sy) {
    if (!L) return null;
    const T = L.tl, k = cam.k, ox = cam.x, oy = cam.y.timeline;
    const wx = (sx - ox) / k;
    if (sy <= T.topPx) {
      const ci = colAt(wx);
      if (sy <= T.AS) { const A = AREAS.find((x) => ci >= x.c0 && ci <= x.c1); return A ? { type: 'area', id: A.a.id } : null; }
      return ci >= 0 ? { type: 'domain', id: DOMS[ci].id } : null;
    }
    const b = T.bands.find((x) => sy >= tlTop(x, k, oy) && sy <= tlBottom(x, k, oy));
    if (!b) return null;
    const c0 = tlChipsY(b, k, oy);
    if (sy >= c0) {
      const ci = colAt(wx);
      if (ci >= 0) {
        const j = Math.floor((sy - c0) / (T.cp * k));
        const chip = b.cols[ci][j];
        if (chip && wx >= chip.x - 2 && wx <= chip.x + chip.w + 2) return { type: 'feature', id: FEATS[chip.fi].id, chip };
      }
    }
    return { type: 'release', id: b.r.id };
  }

  // ══ timeline: the release stack ═════════════════════════════════════════════════════════════════
  function drawTimeline(t) {
    const v = VT, c = v.ctx, k = cam.k, ox = cam.x, oy = cam.y.timeline;
    const T = L.tl;
    c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    c.clearRect(0, 0, v.w, v.h);
    c.textBaseline = 'alphabetic';
    const vx0 = -ox / k, vx1 = (v.w - ox) / k;
    const visCols = [];
    for (let i = 0; i < NC; i++) if (colX[i] + COL_W >= vx0 - 4 && colX[i] <= vx1 + 4) visCols.push(i);
    const cw = COL_W * k;
    // view switch: the bands unroll downward in sequence while the columns stay put
    let u = 1, stripFrom = 0;
    if (anim && anim.view === 'timeline') { u = clamp((t - anim.t0) / anim.dur, 0, 1); stripFrom = anim.fromY || 0; }
    const top = T.topPx;
    // column guides through the whole stack
    const gTop = Math.max(top, tlTop(T.bands[0], k, oy) - 4), gBot = Math.min(v.h, tlBottom(T.bands[T.bands.length - 1], k, oy) + 4);
    c.fillStyle = P.paperHi; c.globalAlpha = P.dark ? 0.22 : 0.42;
    visCols.forEach((i) => { c.fillRect(colX[i] * k + ox, gTop, cw, gBot - gTop); });
    c.globalAlpha = 1;
    const sel = S.selection;
    const selFi = sel && sel.type === 'feature' ? fIdx.get(sel.id) : null;
    T.bands.forEach((b, bi) => {
      const by = tlTop(b, k, oy), bb = tlBottom(b, k, oy);
      if (by > v.h || bb < top - 2) return;
      const e = easeOut(clamp((u * anim_dur() - bi * 22) / 360, 0, 1));
      c.save();
      c.translate(0, (1 - e) * -30);
      c.globalAlpha = e;
      drawBand(c, b, k, ox, oy, visCols, selFi);
      c.restore();
    });
    // the selected feature's thread: its chips across releases, joined down its column
    if (selFi != null && T.chipsOf.has(selFi)) {
      const list = T.chipsOf.get(selFi);
      if (list.length > 1) {
        const x = (list[0].x + 6) * k + ox;
        const y0 = chipY(list[0], k, oy) + T.ch * k / 2, y1 = chipY(list[list.length - 1], k, oy) + T.ch * k / 2;
        c.globalAlpha = u;
        c.beginPath(); c.moveTo(x - 6, y0); c.lineTo(x - 6, y1); c.lineWidth = 1.6; c.strokeStyle = P.ink; c.setLineDash([2, 3]); c.stroke(); c.setLineDash([]);
        list.forEach((ch) => { circle(c, x - 6, chipY(ch, k, oy) + T.ch * k / 2, 2.6); c.fillStyle = P.ink; c.fill(); });
      }
    }
    // today line
    const ty = todayLineY(k, oy);
    if (ty > top && ty < v.h) {
      c.globalAlpha = u;
      const x0 = Math.max(0, ox - 8), x1 = Math.min(v.w, W * k + ox + 8);
      c.beginPath(); c.moveTo(x0, ty); c.lineTo(x1, ty); c.lineWidth = 1.4; c.strokeStyle = P.ink; c.stroke();
      const lbl = 'TODAY · ' + OK.fmt.date(ASOF).toUpperCase();
      const f = lab(500, 9.5);
      const lw = tw(f, lbl, 1.5) + 18;
      const lx = Math.max(x0 + 4, 8);
      rrect(c, lx, ty - 9, lw, 18, 9); c.fillStyle = P.ink; c.fill();
      txt(c, lbl, lx + 9, ty + 3.4, f, P.onInk, 'left', 1.5);
      c.globalAlpha = 1;
    }
    // sticky band label when the band's header has scrolled under the strip
    const cur = T.bands.find((b) => tlTop(b, k, oy) < top && tlBottom(b, k, oy) > top + 30);
    if (cur) {
      c.globalAlpha = 1;
      c.fillStyle = P.paper; c.fillRect(0, top, v.w, 34);
      c.fillStyle = cur.r.state === 'next' ? P.bandHi : P.band; c.fillRect(0, top, v.w, 34);
      c.beginPath(); c.moveTo(0, top + 34.5); c.lineTo(v.w, top + 34.5); c.lineWidth = 1; c.strokeStyle = P.rule2; c.stroke();
      const f = lab(500, 11.5);
      const s2 = cur.r.label + ' · ' + cur.r.name + ' · ' + OK.fmt.date(cur.r.date);
      const w = tw(f, s2) + 22;
      rrect(c, 8, top + 6, w, 22, 11); c.fillStyle = P.panelSolid; c.fill(); c.lineWidth = 1; c.strokeStyle = cur.r.state === 'next' ? P.ink2 : P.rule; c.stroke();
      txt(c, s2, 19, top + 21, f, P.ink);
    }
    // the domain strip stays at the top; while switching it slides up from where the map's heads were
    drawStrip(c, v, k, ox, 1, lerp(stripFrom, 0, easeOut(u * 1.25)), visCols);
    c.globalAlpha = 1;
  }
  const anim_dur = () => (anim ? anim.dur : 600);
  function relHeaderParts(b) {
    const r = b.r;
    const parts = [];
    if (r.state === 'shipped') {
      ['new', 'improved', 'fixed'].forEach((kd) => { if (b.kinds[kd]) parts.push({ kind: kd, n: b.kinds[kd], label: kd }); });
    } else {
      [['ready', 'ready'], ['building', 'in build'], ['blocked', 'blocked'], ['planned', 'planned']].forEach(([s, l]) => { if (b.st[s]) parts.push({ status: s, n: b.st[s], label: l }); });
      const imp = b.kinds.improved + b.kinds.fixed;
      if (imp) parts.push({ kind: 'improved', n: imp, label: 'improved or fixed' });
    }
    return parts;
  }
  function drawBand(c, b, k, ox, oy, visCols, selFi, e) {
    const v = VT;
    const r = b.r;
    const x0 = -8 + ox, x1 = W * k + ox + 8;
    const T = L.tl;
    const by = tlTop(b, k, oy), bh = tlBottom(b, k, oy) - by, hh = T.HDR;
    const isSel = S.selection && S.selection.type === 'release' && S.selection.id === r.id;
    const baseA = c.globalAlpha;
    // band plate
    rrect(c, x0, by, x1 - x0, bh, 6);
    if (r.state === 'next') { c.fillStyle = P.bandHi; c.fill(); }
    else if (r.state === 'shipped') { c.fillStyle = P.band; c.fill(); }
    if (r.state === 'future') { c.setLineDash([5, 4]); c.lineWidth = 1.2; c.strokeStyle = P.ink3; c.stroke(); c.setLineDash([]); }
    else { c.lineWidth = r.state === 'next' ? 1.4 : 1; c.strokeStyle = r.state === 'next' ? P.ink2 : P.rule; c.stroke(); }
    if (isSel) { rrect(c, x0 - 2, by - 2, x1 - x0 + 4, bh + 4, 8); c.lineWidth = 2.2; c.strokeStyle = P.ink; c.stroke(); }
    // header: version, name, date, counts (left-anchored to the view)
    const hy = by + hh / 2 + 5;
    let x = Math.max(x0 + 10, 10);
    const ph = L.phone;
    const verF = mono(500, ph ? 11 : 12), nameF = lab(500, ph ? 12 : 13.5), dateF = mono(400, ph ? 10 : 11), cntF = mono(400, 11), lblF = lab(400, 11.5);
    if (hh >= 10) {
      txt(c, r.label, x, hy, verF, P.ink); x += tw(verF, r.label) + 7;
      txt(c, r.name, x, hy, nameF, P.ink); x += tw(nameF, r.name) + 10;
      const when = OK.fmt.date(r.date) + (ph ? '' : ' · ' + OK.fmt.rel(r.date));
      txt(c, when, x, hy, dateF, P.ink3); x += tw(dateF, when) + 12;
      if (r.state !== 'shipped') {
        const tag = r.state === 'next' ? 'NEXT' : 'PLANNED';
        const tf = lab(500, 8.5);
        const tw2 = tw(tf, tag, 1.3) + 12;
        rrect(c, x, hy - 11, tw2, 15, 7.5);
        if (r.state === 'next') { c.fillStyle = P.ink; c.fill(); txt(c, tag, x + 6, hy - 0.5, tf, P.onInk, 'left', 1.3); }
        else { c.setLineDash([2.5, 2]); c.lineWidth = 1; c.strokeStyle = P.ink3; c.stroke(); c.setLineDash([]); txt(c, tag, x + 6, hy - 0.5, tf, P.ink2, 'left', 1.3); }
        x += tw2 + 12;
      }
      const tot = b.n + ' items';
      txt(c, tot, x, hy, cntF, P.ink2); x += tw(cntF, tot) + 12;
      if (!ph || r.state === 'next') {
        relHeaderParts(b).forEach((p) => {
          if (x > v.w) return;
          if (p.kind) gKind(c, p.kind, x + 5, hy - 4, 5); else gStatus(c, p.status, x + 5, hy - 4, 5);
          txt(c, String(p.n), x + 14, hy, cntF, p.status === 'blocked' ? P.alarm : P.ink); x += 14 + tw(cntF, String(p.n)) + 4;
          if (!ph) { txt(c, p.label, x, hy, lblF, P.ink2); x += tw(lblF, p.label) + 12; } else x += 8;
        });
      }
    }
    // chips
    const chH = T.ch * k;
    visCols.forEach((ci) => {
      const list = b.cols[ci];
      for (let j = 0; j < list.length; j++) {
        const ch = list[j];
        const sy = chipY(ch, k, oy);
        if (sy > v.h || sy + chH < T.topPx - 30) continue;
        drawChip(c, ch, ch.x * k + ox, sy, ch.w * k, chH, r, baseA, selFi);
      }
    });
    // the selected feature's thread through the releases it appears in
    if (selFi != null && T.chipsOf.has(selFi)) {
      const list = T.chipsOf.get(selFi).filter((ch) => ch.band === b);
      list.forEach((ch) => {
        const sx = ch.x * k + ox, sy = chipY(ch, k, oy);
        rrect(c, sx - 2.5, sy - 2.5, ch.w * k + 5, chH + 5, 4); c.lineWidth = 2; c.strokeStyle = P.ink; c.stroke();
      });
    }
  }
  function drawChip(c, ch, x, y, w, h, r, baseA, selFi) {
    const fi = ch.fi;
    const f = FEATS[fi];
    const band = fBand[fi];
    const dim = fDim[fi];
    c.globalAlpha = baseA * (dim ? 0.15 : 1);
    const hh = Math.max(1.4, h);
    const solid = 1 - smooth(9, 15, hh);
    const future = r.state === 'future';
    const rad = Math.min(3.5, hh * 0.3);
    rrect(c, x, y, w, hh, rad);
    if (future) {
      c.fillStyle = P.paperHi; c.fill();
      if (hh < 10) { c.fillStyle = band === 'na' ? P.naSoft : BS(band); c.fill(); c.fillStyle = band === 'na' ? P.na : BC(band); c.globalAlpha *= 0.7; c.fillRect(x, y, 2, hh); c.globalAlpha = baseA * (dim ? 0.15 : 1); }
      else { c.setLineDash([3, 2]); c.lineWidth = 1; c.strokeStyle = band === 'na' ? P.na : BC(band); c.stroke(); c.setLineDash([]); }
    } else if (ch.kind === 'new') {
      const col = band === 'na' ? P.na : BC(band);
      if (solid > 0.01) { c.globalAlpha = baseA * (dim ? 0.15 : 1) * solid * (P.dark ? 0.8 : 0.85); c.fillStyle = col; c.fill(); c.globalAlpha = baseA * (dim ? 0.15 : 1); }
      if (solid < 0.99) { c.globalAlpha = baseA * (dim ? 0.15 : 1) * (1 - solid); c.fillStyle = band === 'na' ? P.paperHi : BS(band); c.fill(); if (band === 'na') { c.fillStyle = hatchLight || P.naSoft; c.fill(); } c.fillStyle = col; c.fillRect(x, y, 2.5, hh); c.globalAlpha = baseA * (dim ? 0.15 : 1); }
    } else {
      c.fillStyle = P.paperHi; c.fill();
      c.lineWidth = 1; c.strokeStyle = band === 'na' ? P.na : BC(band); c.stroke();
    }
    // unshipped new items carry their readiness (status glyph); at the overview the fill shows it
    const unshipped = r.state !== 'shipped' && ch.kind === 'new';
    if (unshipped && hh < 7) {
      if (f.status === 'building') { c.fillStyle = P.paperHi; c.globalAlpha *= 0.75; c.fillRect(x + w / 2, y, w / 2, hh); c.globalAlpha = baseA * (dim ? 0.15 : 1); }
      if (f.status === 'blocked') { c.fillStyle = P.alarm; c.fillRect(x, y, w, hh); }
    }
    if (hh >= 7 && w > 24) {
      const cy = y + hh / 2;
      let nx = x + 5;
      if (hh >= 9) { const kr = Math.min(hh * 0.34, 5.5); gKind(c, ch.kind, x + 4 + kr, cy, kr); nx = x + 8 + kr * 2 + 4; }
      let right = x + w - 4;
      if (unshipped) { const sr = clamp(hh * 0.3, 2.6, 5.5); gStatus(c, f.status, right - sr - 1, cy, sr); right -= sr * 2 + 6; }
      if (fAttn[fi] && hh >= 11 && w > 80) { gAttn(c, right - 4, cy, 4.2); right -= 12; }
      if (hh >= 12 && w >= 86) {
        const fs = hh >= 22 ? 13 : hh >= 16 ? 12.5 : 11.5;
        const ny = hh >= 30 && ch.note ? y + hh / 2 - 2 : cy + fs * 0.34;
        txt(c, fitText(lab(400, fs), f.name, right - nx - 2), nx, ny, lab(400, fs), P.ink);
        if (hh >= 30 && ch.note) txt(c, fitText(lab(400, 10.5), ch.note, right - nx - 2), nx, ny + 14, lab(400, 10.5), P.ink3);
      }
    }
    if (fHit[fi]) { rrect(c, x - 2, y - 2, w + 4, hh + 4, rad + 1.5); c.lineWidth = 1.4; c.strokeStyle = P.ink; c.stroke(); }
    c.globalAlpha = baseA;
  }

  // ══ readout ═════════════════════════════════════════════════════════════════════════════════════
  function updateReadout(v) {
    if (!L) return;
    const r = freeRectCached();
    const cx = r.w / 2, cy = (v === VT ? L.tl.topPx + r.h : r.h) / 2;
    const wx = (cx - cam.x) / cam.k, wy = (cy - cam.y[v.name]) / cam.k;
    let lvl = '', path = '';
    if (v === VM) {
      const lod = lodOf(cam.k);
      lvl = 'Level ' + lod.level + ' · ' + levelName[lod.level];
      let ci = colAt(wx);
      if (ci < 0) { let best = Infinity; for (let i = 0; i < NC; i++) { const dd = Math.abs(colX[i] + COL_W / 2 - wx); if (dd < best) { best = dd; ci = i; } } }
      const d = DOMS[ci];
      const parts = [BP.area(d.areaId).name, d.name];
      if (lod.level >= 1 && wy > L.y.body) { const g = L.colMods[ci].find((m) => wy >= m.y - MG && wy <= m.y + m.h + MG); if (g) parts.push(g.m.name); }
      path = parts.join(' › ');
      if (cam.k <= L.kf * 1.08) path = L.phone ? 'Whole product' : 'Whole product · ' + BP.areas.length + ' areas · ' + NC + ' domains · ' + NF + ' features';
      v.ladder.forEach((b, i) => { const on = i === lod.level; if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on)); });
    } else {
      const T = L.tl;
      const b = T.bands.find((x) => cy <= tlBottom(x, cam.k, cam.y.timeline) + T.GAP) || T.bands[T.bands.length - 1];
      lvl = 'Release stack';
      path = b.r.label + ' · ' + b.r.name + ' · ' + OK.fmt.date(b.r.date) + (b.r.state === 'next' ? ' · next' : b.r.state === 'future' ? ' · planned' : '');
    }
    const key = lvl + '|' + path;
    if (key !== v.roText) { v.roText = key; v.lvl.textContent = lvl; v.path.textContent = path; }
  }

  // ══ tooltips ════════════════════════════════════════════════════════════════════════════════════
  function tipFor(v, hit) {
    if (!hit) return null;
    const lens = S.lens;
    if (hit.type === 'feature') {
      const lod = lodOf(cam.k);
      if (v === VM && lod.level >= 3) return null;
      if (v === VT && L.tl.ch * cam.k >= 12 && COL_W * cam.k >= 90) return null;
      const f = BP.feature(hit.id);
      const p = BP.pathOf(f);
      const r = BP.rating(f, lens);
      const g = BP.gates(f);
      let h = '<div class="dc-tip__h">' + OK.html.status(f.status, 12) + '<span>' + esc(f.name) + '</span></div>' +
        '<div class="dc-tip__s">' + esc(p.module.name + ' · ' + p.domain.name) + '</div>' +
        '<div class="dc-tip__r">' + OK.html.band(r.band, 12) + '<b class="ok-mono">' + (r.band === 'na' ? '–' : OK.fmt.score(r.score)) + '</b><span>' + esc(r.headline || OK.bandLabel(r.band)) + '</span></div>';
      if (hit.chip) h += '<div class="dc-tip__s">' + esc(OK.labels.releaseKind ? (OK.labels.releaseKind[hit.chip.kind] || hit.chip.kind) : hit.chip.kind) + ' in ' + esc(hit.chip.band.r.label) + (hit.chip.note ? ' · ' + esc(hit.chip.note) : '') + '</div>';
      if (g.length || BP.needsAttention(f)) h += '<div class="dc-tip__m">' + (BP.needsAttention(f) ? '<span class="is-alarm">' + OK.html.attention(10) + 'Needs attention</span>' : '') + g.slice(0, 2).map((x) => '<span class="is-gate">' + OK.html.gate(x.kind, 10) + esc((OK.labels.gate ? OK.labels.gate[x.kind].long : x.kind) + ' · ' + x.waitingDays + ' d') + '</span>').join('') + '</div>';
      return { key: 'f' + hit.id + lens, html: h };
    }
    if (hit.type === 'module' && v === VM && lodOf(cam.k).level === 0) {
      const m = BP.module(hit.id);
      const r = BP.moduleRating(m.id, lens), ro = BP.moduleRollup(m.id);
      return { key: 'm' + m.id + lens, html: '<div class="dc-tip__h"><span>' + esc(m.name) + '</span></div><div class="dc-tip__r">' + OK.html.band(r.band, 12) + '<b class="ok-mono">' + (r.band === 'na' ? '–' : OK.fmt.score(r.score)) + '</b><span>' + ro.count + ' features' + (ro.attention ? ' · ' + ro.attention + ' need attention' : '') + '</span></div><div class="dc-tip__s">Double-click to zoom in</div>' };
    }
    if (hit.type === 'release') {
      const r = BP.release(hit.id);
      return { key: 'r' + r.id, html: '<div class="dc-tip__h"><span>' + esc(r.label + ' · ' + r.name) + '</span></div><div class="dc-tip__s">' + esc(OK.fmt.date(r.date) + ' · ' + OK.fmt.rel(r.date)) + '</div><div class="dc-tip__s">Click to open the release package</div>' };
    }
    return null;
  }
  function showTip(v, sx, sy, hit) {
    const t = tipFor(v, hit);
    if (!t) { hideTip(v); return; }
    if (v.tipKey !== t.key) { v.tip.innerHTML = t.html; v.tipKey = t.key; }
    v.tip.hidden = false;
    const tw2 = v.tip.offsetWidth, th2 = v.tip.offsetHeight;
    let x = sx + 16, y = sy + 18;
    if (x + tw2 > v.w - 8) x = sx - tw2 - 12;
    if (y + th2 > v.h - 8) y = sy - th2 - 12;
    v.tip.style.transform = 'translate(' + Math.round(Math.max(4, x)) + 'px,' + Math.round(Math.max(4, y)) + 'px)';
  }
  function hideTip(v) { if (!v.tip.hidden) { v.tip.hidden = true; v.tipKey = ''; } }

  // ══ pointer, wheel, keys ════════════════════════════════════════════════════════════════════════
  function attach(v) {
    const cv = v.cv;
    const ptrs = new Map();
    let drag = null, pinch = null, lastTap = null, rect = null;
    const local = (e) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      rect = cv.getBoundingClientRect();
      hideTip(v);
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      ptrs.set(e.pointerId, local(e));
      flight = null;
      if (ptrs.size === 1) drag = { p0: local(e), x0: cam.x, y0: cam.y[v.name], moved: false, type: e.pointerType };
      else if (ptrs.size === 2) {
        const [a, b] = Array.from(ptrs.values());
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        pinch = { d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, k0: cam.k, wx: (mx - cam.x) / cam.k, wy: (my - cam.y[v.name]) / cam.k, ta: v === VT ? tlAnchor(my, cam.k, cam.y.timeline) : null };
        if (drag) drag.moved = true;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && L) {
          const p = { x: e.offsetX, y: e.offsetY };
          const hit = v === VM ? hitMap(p.x, p.y) : hitTimeline(p.x, p.y);
          cv.classList.toggle('is-pointer', !!hit);
          showTip(v, p.x, p.y, hit);
        }
        return;
      }
      if (!rect) rect = cv.getBoundingClientRect();
      ptrs.set(e.pointerId, local(e));
      if (pinch && ptrs.size >= 2) {
        const [a, b] = Array.from(ptrs.values());
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const k = clamp(pinch.k0 * Math.hypot(b.x - a.x, b.y - a.y) / pinch.d0, L.th.min, L.th.max);
        setCam(v, mx - pinch.wx * k, pinch.ta ? my - pinch.ta.off - pinch.ta.u * k - pinch.ta.fx : my - pinch.wy * k, k);
        touched = true;
        return;
      }
      if (drag) {
        const p = local(e);
        const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
        if (!drag.moved && Math.hypot(dx, dy) > (drag.type === 'mouse' ? 4 : 8)) { drag.moved = true; cv.classList.add('is-panning'); }
        if (drag.moved) { setCam(v, drag.x0 + dx, drag.y0 + dy, cam.k); touched = true; }
      }
    });
    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const p = ptrs.get(e.pointerId);
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) { if (pinch) settleSoon(v, 120); pinch = null; }
      if (ptrs.size === 0) {
        cv.classList.remove('is-panning');
        if (drag && !drag.moved && e.type === 'pointerup') {
          const t = performance.now();
          const dbl = lastTap && t - lastTap.t < 340 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 14;
          lastTap = dbl ? null : { t, x: p.x, y: p.y };
          onTap(v, p.x, p.y, dbl);
        }
        drag = null;
      } else if (ptrs.size === 1 && drag) {
        const q = Array.from(ptrs.values())[0];
        drag = { p0: q, x0: cam.x, y0: cam.y[v.name], moved: true, type: drag.type };
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { hideTip(v); });
    cv.addEventListener('wheel', (e) => {
      if (!L) return;
      e.preventDefault();
      hideTip(v);
      flight = null;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) { setCam(v, cam.x - e.deltaX * unit, cam.y[v.name], cam.k); touched = true; return; }
      if (e.shiftKey && !e.ctrlKey) { setCam(v, cam.x - e.deltaY * unit, cam.y[v.name], cam.k); touched = true; return; }
      if (v === VT && !e.ctrlKey) { setCam(v, cam.x, cam.y.timeline - e.deltaY * unit, cam.k); touched = true; return; }
      const f = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018));
      zoomAt(v, e.offsetX, e.offsetY, cam.k * f, false);
      settleSoon(v);
    }, { passive: false });
    v.wrap.querySelector('.dc-zoom').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !L) return;
      const z = b.getAttribute('data-dc-zoom');
      if (z === 'in') zoomBy(v, 1.6);
      else if (z === 'out') zoomBy(v, 1 / 1.6);
      else if (z === 'fit') fitView(v, true);
      else if (b.hasAttribute('data-dc-level')) zoomToLevel(+b.getAttribute('data-dc-level'));
    });
  }
  function zoomToLevel(n) {
    const T = L.th;
    const ks = [L.kf, T.l1 * 1.12, T.l2 * 1.08, T.l3 * 1.15, T.l4 * 1.2];
    if (n === 0) { fitView(VM, true); return; }
    const r = freeRectCached();
    zoomAt(VM, r.w / 2, r.h / 2, ks[n], true);
  }
  function onTap(v, sx, sy, dbl) {
    if (!L) return;
    const hit = v === VM ? hitMap(sx, sy) : hitTimeline(sx, sy);
    if (!hit) {
      if (dbl) zoomAt(v, sx, sy, cam.k * 1.8, true);
      else if (S.selection) shell.select(null);
      return;
    }
    if (hit.type === 'feature') {
      if (dbl) { shell.openFeature(hit.id); return; }
      shell.peek(hit.id);
      pendingReveal = { v, fi: fIdx.get(hit.id), chip: hit.chip || null };
      schedule();
      return;
    }
    if (dbl && v === VM) { zoomInto(hit, true); return; }
    if (dbl && v === VT && hit.type === 'release') { zoomToBand(hit.id); return; }
    shell.inspect({ type: hit.type, id: hit.id });
    if (hit.type === 'release') requestDraw(VT);
  }
  let pendingReveal = null;
  // after a peek opens the inspector, pan just enough to keep the clicked row clear of it
  function revealPending() {
    if (!pendingReveal) return;
    const { v, fi, chip } = pendingReveal;
    pendingReveal = null;
    if (active() !== v) return;
    const r = shell.freeRect();
    lastFree = r;
    const k = cam.k;
    let x, y, w, h;
    if (v === VM) { const g = L.fMod[fi]; x = g.x * k + cam.x; w = g.w * k; y = L.rowY[fi] * k + cam.y.map; h = L.ROW * k; }
    else { if (!chip) return; x = chip.x * k + cam.x; w = chip.w * k; y = chipY(chip, k, cam.y.timeline); h = L.tl.ch * k; }
    const m = 20;
    let dx = 0, dy = 0;
    if (x + Math.min(w, 120) > r.w - m) dx = r.w - m - (x + Math.min(w, 120));
    if (x < m) dx = m - x;
    if (y + h > r.h - m) dy = r.h - m - (y + h);
    const top = v === VT ? L.tl.topPx + 8 : 8;
    if (y < top) dy = top - y;
    if (dx || dy) flyTo(v, { x: cam.x + dx, y: cam.y[v.name] + dy, k }, 320);
  }
  function zoomInto(hit, animate) {
    const r = freeRectCached();
    const T = L.th;
    let box, kMin, kMax;
    if (hit.type === 'area') {
      const A = AREAS.find((x) => x.a.id === hit.id);
      const x0 = colX[A.c0], x1 = colX[A.c1] + COL_W;
      let bot = 0; for (let i = A.c0; i <= A.c1; i++) bot = Math.max(bot, L.colBottom[i]);
      box = { x: x0, y: L.y.area, w: x1 - x0, h: bot - L.y.area };
      kMin = L.kf * 1.2; kMax = T.l2 * 1.05;
    } else if (hit.type === 'domain') {
      const i = colIdx.get(hit.id);
      box = { x: colX[i], y: L.y.head, w: COL_W, h: L.colBottom[i] - L.y.head };
      kMin = T.l1 * 1.1; kMax = T.l3 * 1.1;
    } else if (hit.type === 'module') {
      const g = L.mods.get(hit.id);
      box = { x: g.x, y: g.y, w: g.w, h: g.h };
      kMin = T.l2 * 1.05; kMax = T.l4 * 0.95;
    } else if (hit.type === 'feature') {
      const fi = fIdx.get(hit.id);
      const g = L.fMod[fi];
      box = { x: g.x, y: L.rowY[fi] - L.ROW * 2, w: g.w, h: L.ROW * 5 };
      kMin = Math.max(cam.k, T.l3 * 1.25); kMax = Math.max(cam.k, T.l3 * 1.6);
    } else return;
    const pad = L.phone ? 14 : 36;
    let k = Math.min((r.w - pad * 2) / box.w, (r.h - pad * 2) / box.h);
    k = clamp(k, Math.min(kMin, kMax), Math.max(kMin, kMax));
    k = clamp(k, T.min, T.max);
    let x = r.w / 2 - (box.x + box.w / 2) * k;
    let y = r.h / 2 - (box.y + box.h / 2) * k;
    if (box.h * k > r.h - pad * 2) y = pad - box.y * k; // tall boxes: keep their top in view
    flyTo(VM, { x, y, k }, animate ? 560 : 0);
    touched = true;
  }
  function zoomToBand(id) {
    const b = L.tl.bands.find((x) => x.r.id === id);
    if (!b) return;
    const r = freeRectCached();
    const top = L.tl.topPx + 10;
    // big enough to read the item names, and the band's top under the strip
    const k = clamp(Math.max(cam.k, Math.min(16 / L.tl.cp, 150 / COL_W), 120 / COL_W), L.th.min, L.th.max);
    const wx = (r.w / 2 - cam.x) / cam.k;
    flyTo(VT, { x: r.w / 2 - wx * k, y: top - b.u0 * k - b.fxTop, k }, 520);
    touched = true;
  }
  // keys: + - 0 zoom; arrows move between features (or pan)
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !L) return;
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (S.page) return;
    const v = active();
    const k = e.key;
    if (k === '+' || k === '=') { zoomBy(v, 1.5); e.preventDefault(); return; }
    if (k === '-' || k === '_') { zoomBy(v, 1 / 1.5); e.preventDefault(); return; }
    if (k === '0') { fitView(v, true); e.preventDefault(); return; }
    if (!k.startsWith('Arrow')) return;
    if (t && t.closest && t.closest('.ok-insp, .ok-legend, .ok-sheet, .ok-pop, .ok-lenses, .ok-viewsw')) return;
    const sel = S.selection;
    if (v === VM && sel && sel.type === 'feature') { moveSelection(k, fIdx.get(sel.id)); e.preventDefault(); return; }
    const step = 90;
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[k];
    if (d) { flyTo(v, { x: cam.x + d[0], y: cam.y[v.name] + d[1], k: cam.k }, 200); e.preventDefault(); }
  });
  function moveSelection(key, fi) {
    if (fi == null) return;
    const ci = fCol[fi];
    const list = COLS[ci].feats.map((f) => fIdx.get(f.id));
    const pos = list.indexOf(fi);
    let next = null;
    if (key === 'ArrowUp' && pos > 0) next = list[pos - 1];
    else if (key === 'ArrowDown' && pos < list.length - 1) next = list[pos + 1];
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const nc = ci + (key === 'ArrowLeft' ? -1 : 1);
      if (nc >= 0 && nc < NC) {
        const y = L.rowY[fi];
        let best = Infinity;
        COLS[nc].feats.forEach((f) => { const j = fIdx.get(f.id); const dd = Math.abs(L.rowY[j] - y); if (dd < best) { best = dd; next = j; } });
      }
    }
    if (next == null) return;
    shell.peek(FEATS[next].id);
    pendingReveal = { v: VM, fi: next };
    schedule();
  }

  // ══ locate (search Enter, "Show on map", breadcrumbs) ═══════════════════════════════════════════
  let pendingLocate = null;
  function locate(ref) {
    if (!ref || !L) return;
    pendingLocate = ref;
    schedule();
  }
  function doLocate() {
    const ref = pendingLocate;
    pendingLocate = null;
    if (!ref) return;
    lastFree = shell.freeRect();
    if (S.view === 'timeline') {
      if (ref.type === 'feature') {
        const fi = fIdx.get(ref.id);
        const list = L.tl.chipsOf.get(fi);
        if (!list || !list.length) return;
        const ch = list[list.length - 1];
        const r = lastFree;
        const k = clamp(Math.max(cam.k, 18 / L.tl.cp, 110 / COL_W), L.th.min, L.th.max);
        const cy = (L.tl.topPx + r.h) / 2;
        flyTo(VT, { x: r.w / 2 - (ch.x + ch.w / 2) * k, y: cy - L.tl.ch * k / 2 - (ch.band.u0 + ch.j * L.tl.cp) * k - ch.band.fxTop - L.tl.HDR - L.tl.PADT, k }, 520);
      }
      return;
    }
    if (ref.type === 'feature') {
      const fi = fIdx.get(ref.id);
      if (fi == null) return;
      const r = lastFree;
      const T = L.th;
      const k = cam.k >= T.l3 * 1.05 ? cam.k : clamp(T.l3 * 1.35, T.min, T.l4 * 0.98);
      const g = L.fMod[fi];
      flyTo(VM, { x: r.w / 2 - (g.x + g.w / 2) * k, y: r.h / 2 - (L.rowY[fi] + L.ROW / 2) * k, k }, 620);
    } else zoomInto(ref, true);
  }

  // ══ legend ══════════════════════════════════════════════════════════════════════════════════════
  function legendHTML() {
    const sv = (inner, w, h) => '<svg width="' + (w || 26) + '" height="' + (h || 18) + '" viewBox="0 0 ' + (w || 26) + ' ' + (h || 18) + '" aria-hidden="true">' + inner + '</svg>';
    const row = (icon, text) => '<div class="ok-lg-row">' + icon + '<span>' + text + '</span></div>';
    return '<section class="ok-lg-sec"><h3>Columns map</h3>' +
      row(sv('<rect x="5" y="1" width="16" height="7" rx="1.5" fill="var(--ok-good)"/><rect x="5" y="9.5" width="16" height="7.5" rx="1.5" fill="var(--ok-fair)"/>'), 'Opening zoom: each module is a bar coloured by its band in the current lens; a domain column is a stack of them.') +
      row(sv('<rect x="3" y="1" width="20" height="16" rx="2.5" fill="var(--ok-paper-hi)" stroke="var(--ok-rule)"/><circle cx="8" cy="6" r="2" fill="var(--ok-good)"/><circle cx="8" cy="11" r="2" fill="var(--ok-poor)"/><path d="M12 6h8" stroke="var(--ok-ink-3)" stroke-width="1.4"/>'), 'Zoom in: module cards with one pip per feature, then feature rows with marks, names and scores.') +
      row(sv('<g transform="translate(9 9)">' + OK.svg.corona(BP.features.find((f) => f.status === 'live'), 6, { status: true }) + '</g><path d="M18 7h6M18 11h4" stroke="var(--ok-ink-3)" stroke-width="1.3"/>'), 'Closest zoom: every row shows the 8-lens corona, the lens headline, gates and release.') +
      row(sv('<rect x="3" y="3" width="20" height="12" rx="2" fill="none" stroke="var(--ok-na)" stroke-dasharray="3 2"/><path d="M6 15l9-12M11 15l9-12M16 15l6-8" stroke="var(--ok-na)" stroke-width=".9" opacity=".7"/>'), '<b>Hatched and dashed</b>: the lens does not apply (n/a), for example Operations on a feature that is not live yet.') +
      row(sv('<path d="M2 5h8v8h10" fill="none" stroke="var(--ok-ink)" stroke-width="1.6"/><path d="M24 13l-4-2.4v4.8z" fill="var(--ok-ink)"/>'), 'Selected feature: solid lines to what it depends on, dashed lines from what depends on it.') +
      '</section><section class="ok-lg-sec"><h3>Release stack</h3>' +
      row(sv('<rect x="2" y="3" width="22" height="5" rx="1.5" fill="var(--ok-good)" opacity=".86"/><rect x="2" y="10" width="22" height="5" rx="1.5" fill="var(--ok-paper-hi)" stroke="var(--ok-good)"/>'), 'Each item is a chip in its domain column: filled when new, outlined when improved or fixed.') +
      row(sv('<path d="M1 9h24" stroke="var(--ok-ink)" stroke-width="1.4"/><rect x="5" y="5" width="16" height="8" rx="4" fill="var(--ok-ink)"/>'), 'Today. Time runs down: shipped releases above, the next release and the future below.') +
      row(sv('<g transform="translate(6 9)">' + OK.svg.status('ready', 4.5) + '</g><g transform="translate(19 9)">' + OK.svg.status('building', 4.5) + '</g>'), 'Next release items show readiness: ready, in build or blocked.') +
      row(sv('<rect x="2" y="3" width="22" height="12" rx="2.5" fill="none" stroke="var(--ok-ink-3)" stroke-dasharray="4 3"/>'), 'Dashed bands are future releases.') +
      '</section><section class="ok-lg-sec"><h3>Navigate</h3><p class="ok-lg-note">Scroll or pinch to zoom, drag to pan. Double-click a domain, module or release to zoom into it. Keys: <span class="ok-kbd">+</span> <span class="ok-kbd">−</span> zoom, <span class="ok-kbd">0</span> fit, arrows move between features.</p></section>';
  }

  // ══ sizing, events, boot ════════════════════════════════════════════════════════════════════════
  let lastFree = { x: 0, y: 0, w: 800, h: 600 };
  function freeRectCached() { return lastFree.w > 0 ? lastFree : { x: 0, y: 0, w: VM.w, h: VM.h }; }
  let classKey = '';
  let stageW = 0, stageH = 0;
  function sizeCanvas(v, w, h) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    v.w = w; v.h = h; v.dpr = dpr;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (v.cv.width !== pw) v.cv.width = pw;
    if (v.cv.height !== ph) v.cv.height = ph;
    v.dirty = true;
  }
  function onStage(w, h, force) {
    if (w < 10 || h < 10) return;
    stageW = w; stageH = h;
    const keepCenter = L && !force ? { wx: (w / 2 - cam.x) / cam.k, wyM: (h / 2 - cam.y.map) / cam.k, wyT: (h / 2 - cam.y.timeline) / cam.k, k: cam.k } : null;
    sizeCanvas(VM, w, h); sizeCanvas(VT, w, h);
    lastFree = { x: 0, y: 0, w, h };
    const phone = shell.isPhone();
    const key = (phone ? 'p' : 'd') + Math.round(Math.log(w) / Math.log(1.05)) + ':' + Math.round(Math.log(h) / Math.log(1.07));
    if (force || key !== classKey || !L) {
      const wasFit = !touched;
      classKey = key;
      wCache = new Map(); fitCache = new Map(); wrapCache = new Map();
      L = computeLayout(w, h);
      linkCache = { id: null, deps: [], dents: [] };
      const f = fitCam(VM);
      cam.x = f.x; cam.k = f.k; cam.y.map = f.y;
      cam.y.timeline = tlCamFor(f.k, f.x).y;
      if (!wasFit && keepCenter) { /* a new size class always reopens at the fit: positions are per class */ }
      touched = false;
    } else if (keepCenter) {
      cam.x = w / 2 - keepCenter.wx * cam.k;
      cam.y.map = h / 2 - keepCenter.wyM * cam.k;
      cam.y.timeline = h / 2 - keepCenter.wyT * cam.k;
      clampCam(VM); clampCam(VT);
    }
    VM.dirty = VT.dirty = true;
    schedule();
  }
  const ro = new ResizeObserver((entries) => {
    const e = entries[entries.length - 1];
    const r = e.contentRect;
    onStage(Math.round(r.width), Math.round(r.height));
  });

  shell.on('lens', () => { refreshLens(); VM.dirty = VT.dirty = true; schedule(); });
  shell.on('filter', () => { refreshFilter(); VM.dirty = VT.dirty = true; schedule(); });
  shell.on('select', () => { VM.dirty = VT.dirty = true; schedule(); });
  shell.on('locate', (ref) => locate(ref));
  shell.on('theme', () => { readPalette(); VM.dirty = VT.dirty = true; schedule(); });
  shell.on('inspector', (p) => {
    // measure the free area in the next frame (never synchronously in the handler)
    requestAnimationFrame(() => { lastFree = shell.freeRect(); });
  });
  shell.on('feature-close', () => { VM.dirty = VT.dirty = true; schedule(); });
  shell.on('view', (p) => {
    hideTip(VM); hideTip(VT);
    if (!L) return;
    if (p.view === 'timeline') {
      const fromY = clamp(L.y.head * cam.k + cam.y.map, 0, VT.h * 0.6);
      const to = tlCamFor(cam.k, cam.x);
      cam.y.timeline = to.y;
      clampCam(VT);
      anim = reduced() ? null : { view: 'timeline', t0: performance.now(), dur: 620, fromY };
    } else {
      clampCam(VM);
      anim = reduced() ? null : { view: 'map', t0: performance.now(), dur: 420 };
    }
    VM.dirty = VT.dirty = true;
    schedule();
  });

  attach(VM); attach(VT);
  readPalette();
  refreshLens();
  refreshFilter();
  function boot() {
    const r = shell.stageEl.getBoundingClientRect();
    onStage(Math.round(r.width), Math.round(r.height), true);
    ro.observe(shell.stageEl);
  }
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  let booted = false;
  const go = () => { if (booted) return; booted = true; boot(); };
  fontsReady.then(go, go);
  setTimeout(go, 1500);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if (booted) onStage(stageW, stageH, true); });
  window.DC = { bench: (n) => { const t0 = performance.now(); for (let i = 0; i < (n || 20); i++) { if (S.view === 'map') drawMap(performance.now()); else drawTimeline(performance.now()); } return (performance.now() - t0) / (n || 20); }, shell, cam, get L() { return L; }, zoomInto, zoomToLevel, zoomToBand, fitView: () => fitView(active(), false), VM, VT, hitMap, lodOf: () => lodOf(cam.k), setK: (k, sx, sy) => zoomAt(active(), sx == null ? active().w / 2 : sx, sy == null ? active().h / 2 : sy, k, false), focusFeature: (id, k) => { const fi = fIdx.get(id); const g = L.fMod[fi]; const kk = k || L.th.l3 * 1.3; setCam(VM, VM.w / 2 - (g.x + g.w / 2) * kk, VM.h / 2 - (L.rowY[fi] + L.ROW / 2) * kk, kk); } };
})();
