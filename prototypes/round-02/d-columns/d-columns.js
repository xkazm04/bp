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
 *   banners and heads reserve their on-screen height at the fit (px / kFit), and ROW (24 to 64) grows to fill the stage
 *   height, so every class opens as a full composition. A resize that changes the stage by more than a few percent (or
 *   crosses the phone breakpoint) recomputes the layout and refits; anything smaller keeps the layout.
 *   Domain heads by the room a column gets at the fit: 'wide' (two-line names, 1440 and up), 'compact' (smaller two-line
 *   names, 1280) or 'tilt' (names angled above the columns, ending at their own column, for the 820 side panel and
 *   phones), always titles, never codes. Area banners put their state on a second line when any span is short.
 *
 * Labels are drawn at a constant screen size, anchored to their world boxes, and only when their box has room on
 * screen, so they never overlap. Sticky labels (areas, domains, modules, release bands) keep context at the top edge,
 * and a readout names area > domain > module at the centre of the view.
 *
 * Progressive disclosure on a continuous zoom k (thresholds per class, from the room on screen):
 *   L0  k < kL1  Domain heads: name, band glyph, score, attention and gate counters. Modules are heat bars: a tint of
 *                the module's band with a solid band edge and one segment per feature (n/a rows hatched).
 *   L1  < kL2    Module cards: name, band glyph and score, counters, and one pip per feature at its row.
 *   L2  < kL3    Feature rows: band tint, status glyph by form, gate and attention marks; module header strips.
 *   L3  < kL4    Feature names, current-lens score and band glyph, gate and attention marks.
 *   L4  >= kL4   Each row is a mini-detail inside its own reserved space: the 8-lens corona with the status inside,
 *                the lens headline, gates and release. Nothing moves.
 *   Every layer's alpha ramps over a zoom band, so the layers cross-fade instead of popping; the domain heads blend the
 *   same way into a detail head (all 8 lenses) once zoomed in.
 *
 * Timeline "Release stack": the same 17 columns at the same x and zoom; time runs down. One band per release (oldest at
 * the top) with its package items as chips in their domain column, a today line, the next release with readiness
 * glyphs, and dashed future bands. At rest each band names its biggest items in its header and counts each domain's
 * items under its stack; the next release adds a line naming what is at risk. Switching views keeps x and zoom and
 * animates only the vertical change.
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
  const shell = OK.mount({ root: app, variant: 'Orbit Columns', legend: legendHTML,
    keys: [['+ −', 'Zoom'], ['0', 'Fit'], [['←', '↑', '→', '↓'], 'Move between features']] });
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
  const PRI = { P0: 3, P1: 2, P2: 1, P3: 0 };
  const fWeight = (fi) => { const f = FEATS[fi]; return (PRI[f.priority] || 0) * 10 + BP.dependents(f.id).length * 2 + (f.workItems || []).length + (f.surfaces || []).length; };

  let L = null; // the current layout
  const namesFit = (fs, maxW) => DOMS.every((d) => wrapLines(lab(500, fs), d.name, maxW, 2).ok);
  /** Domain heads at the opening fit, by the room a column gets: 'wide' (two-line names at 10.5-12 px with the 8-lens
   *  strip), 'compact' (two-line names at 9.5-10 px) or 'tilt' (names angled above the columns, for the side panel
   *  and phones). Titles always; codes are only a fallback in the thin sticky strip. */
  function headMode(cw, phone, kx, mx) {
    if (!phone) {
      // the 8-lens strip under the counters needs a column of 100 px; narrower wide heads leave it out
      for (const fs of [12, 11.5, 11, 10.5]) if (namesFit(fs, cw - 14)) return { mode: 'wide', wide: true, h: cw >= 100 ? 108 : 88, fs };
      for (const fs of [10, 9.5]) if (namesFit(fs, cw - 10)) return { mode: 'compact', wide: false, h: 80, fs };
    }
    const t = tiltFor(kx, mx, phone);
    return { mode: 'tilt', wide: false, h: t.h + t.cap, fs: t.fs, tilt: t };
  }
  /** Angled names: each ends just above its column (at 3/4 of its width, or its right edge on phones) and runs up to
   *  the left, like a book spine tipped over. The angle starts at 45 degrees and steepens only as far as needed to keep
   *  every name on screen and the parallel names clear of each other. */
  function tiltFor(kx, mx, phone) {
    const fs = phone ? 9 : 11;
    const font = lab(500, fs);
    const at = phone ? 1 : 0.75;
    let pick = null;
    for (let deg = 45; deg <= 62.5; deg += 2.5) {
      const ca = Math.cos(deg * DEG), sa = Math.sin(deg * DEG);
      let ok = true, ext = 0;
      for (let i = 0; i < NC; i++) {
        const w = tw(font, DOMS[i].name);
        if (mx + (colX[i] + COL_W * at) * kx - w * ca < 3) ok = false;
        if (i && (colX[i] - colX[i - 1]) * kx * sa < fs * 1.3) ok = false;
        ext = Math.max(ext, w * sa);
      }
      pick = { deg, ext };
      if (ok) break;
    }
    const h = Math.ceil(pick.ext + fs * 0.75 * Math.cos(pick.deg * DEG) + (phone ? 8 : 10));
    return { deg: pick.deg, fs, at, h, cap: phone ? 56 : 62 };
  }
  function cwFor(fs, pad) {
    let lo = 30, hi = 260;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (namesFit(fs, mid - pad)) hi = mid; else lo = mid; }
    return hi;
  }
  const cwForWide = () => cwFor(10.5, 14);
  /** Area banners: name, band and score, attention and gates on one line when every area has room for it at the
   *  fit; otherwise the state moves to a second line for all of them (one rule for every banner). */
  function bannerRows(kx, phone) {
    if (phone) return 3;
    for (const A of AREAS) {
      const span = (colX[A.c1] + COL_W - colX[A.c0]) * kx - 8;
      const nm = tw(lab(500, 10), A.a.name.toUpperCase(), 1.2);
      const ro = BP.areaRollup(A.a.id);
      const need = nm + 10 + 40 + (ro.attention ? 30 : 0) + (gateTotal(ro.gates) ? 30 : 0);
      if (need > span) return 2;
    }
    return 1;
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
    const kw = (sw - 2 * mx) / W;
    // try the fullest header band first; a short stage trades header blocks for map scale
    let best = null;
    for (const variant of phone ? [0] : [0, 1, 2]) {
      let k = kw, heads, dial, ROW = 24, rows = 1, A = 24;
      for (let it = 0; it < 6; it++) {
        heads = headMode(k * COL_W, phone, k, mx + Math.max(0, (sw - 2 * mx - W * k) / 2));
        rows = bannerRows(k, phone);
        A = rows === 3 ? 44 : rows === 2 ? 38 : 24;
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
      if (!best || k > best.k * 1.01) best = { k, heads, dial, ROW, rows, A };
      if (k >= kw * 0.985) break;
    }
    const kf = best.k, heads = best.heads, dial = best.dial, ROW = best.ROW, A = best.A;
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
    // the detail head takes over once the head region is tall enough for it (narrow columns list the lenses in one column)
    th.hd = Math.max(200 / y.headH, 66 / COL_W, kf * 1.25);
    const layout = { phone, sw, sh, mx, my, mb, kf, heads, dial, ROW, y, rowY, fMod, mods, colMods, colBottom, H, th, rows: best.rows, stripPx: phone ? 46 : 52,
      cwWide: cwForWide(), cwCompact: cwFor(9.5, 10), cwSmall: cwFor(8.5, 10) };
    layout.tl = computeTimeline(layout);
    return layout;
  }

  // the release stack: the same columns; bands for releases, oldest at the top. Headers, paddings and gaps keep a
  // constant screen size; only the chip stacks scale with the zoom, so zooming in grows the items, not the labels.
  function computeTimeline(Lx) {
    const kf = Lx.kf, phone = Lx.phone;
    const AS = phone ? 28 : 18;
    // PADB keeps room under the tallest stack for its count (the item count at the end of each domain's bar)
    const HDR = phone ? 24 : 27, PADT = 2, PADB = 19, GAP = 6, TODAY = 34;
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
      // the next release gets a second header line naming what is at risk (its blocked items)
      b.risk = b.r.state === 'next' ? BP.releaseItems(b.r.id).filter((it) => it.kind === 'new' && BP.feature(it.feature).status === 'blocked').map((it) => fIdx.get(it.feature)) : [];
      b.hdr = HDR + (b.risk.length ? (phone ? 20 : 22) : 0);
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
      // the release's highlights, named in its header at rest: what is at risk first (blocked items of an unshipped
      // release), then new features before improvements, then the biggest (priority, dependents, work and surfaces)
      const risk = (c2) => (b.r.state !== 'shipped' && FEATS[c2.fi].status === 'blocked' ? 0 : 1);
      b.top = b.chips.filter((c2) => !(b.r.state === 'next' && risk(c2) === 0)).sort((p, q) => risk(p) - risk(q) || KIND_ORDER[p.kind] - KIND_ORDER[q.kind] || fWeight(q.fi) - fWeight(p.fi) || p.fi - q.fi).slice(0, 8);
      if (b.risk) b.risk.sort((p, q) => fWeight(q) - fWeight(p) || p - q);
      u += b.stackW;
      fx += b.hdr + PADT + PADB + GAP;
    });
    return { bands, U: u, FX: fx - GAP, cp, ch, AS, chipsOf, HDR, PADT, PADB, GAP, TODAY, nextIdx: nextIdx < 0 ? bands.length - 1 : nextIdx };
  }
  // screen positions in the release stack (oy is the screen y of the first band's top)
  const tlTop = (b, k, oy) => oy + b.u0 * k + b.fxTop;
  const tlChipsY = (b, k, oy) => tlTop(b, k, oy) + b.hdr + L.tl.PADT;
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
    const fx = b.fxTop + b.hdr + T.PADT;
    return { u, fx, off: sy - (oy + u * k + fx) };
  }
  /** The timeline header: the area row and the domain strip. In tilt classes the strip carries the angled names
   *  while the columns are too narrow for horizontal ones, and shrinks to the plain strip as they widen. */
  function tlTiltA(k) { return L.heads.tilt ? 1 - smooth(L.cwSmall * 0.96, L.cwSmall * 1.06, COL_W * k) : 0; }
  function tlTopPx(k) { return L.tl.AS + lerp(L.stripPx, L.heads.tilt ? L.heads.tilt.h + 28 : L.stripPx, tlTiltA(k)); }

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
      name, wrap, cv, ctx: cv.getContext('2d'), w: 0, h: 0, dpr: 1, dirty: true, rx: 0, ry: 0, tipSize: null, tipAt: null,
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
      const vh = v.h, ch = L.H * k - headShift(k);
      let y0 = vh * 0.5 - ch, y1 = vh * 0.5;
      if (ch < vh) { y0 = Math.min(L.my, (vh - ch) / 2); y1 = Math.max(vh - ch - 4, (vh - ch) / 2); }
      cam.y.map = clamp(cam.y.map, Math.min(y0, y1), Math.max(y0, y1));
    } else {
      const top = tlTopPx(k) + 6, bottom = v.h - L.mb;
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
    const top = tlTopPx(k) + 6, bottom = VT.h - L.mb;
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
    if (L.heads.tilt) out.push([(L.cwCompact * 0.96) / COL_W, (L.cwCompact * 1.06) / COL_W]);
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
  /** The camera y that puts map world y wy (a body point when below the heads) at screen y sy for zoom k. */
  function mapCamY(wy, sy, k) { return sy - wy * k + (wy >= L.y.body ? headShift(k) : 0); }
  /** The map world y under screen y (body mapping below the heads). */
  function mapWorldY(sy, k, oy) {
    const headBot = L.y.head * k + oy + headPx(k);
    return sy >= headBot ? (sy - oyBody(oy, k)) / k : (sy - oy) / k;
  }
  function zoomAt(v, sx, sy, k, animate, raw) {
    k = clamp(k, L.th.min, L.th.max);
    const wx = (sx - cam.x) / cam.k, wy = (sy - cam.y[v.name]) / cam.k;
    const to = { x: sx - wx * k, y: sy - wy * k, k };
    if (v === VM) { const wyM = mapWorldY(sy, cam.k, cam.y.map); to.y = mapCamY(wyM, sy, k); }
    if (v === VT) { const a = tlAnchor(sy, cam.k, cam.y.timeline); to.y = sy - a.off - a.u * k - a.fx; }
    if (animate) flyTo(v, to, raw ? 200 : 280, raw); else setCam(v, to.x, to.y, to.k);
    touched = true;
  }
  function zoomBy(v, f) {
    const r = freeRectCached();
    zoomAt(v, r.w / 2, (v === VT ? (tlTopPx(cam.k) + r.h) / 2 : r.h / 2), cam.k * f, true);
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
    if (tipPending) measureTip();
    if (needOrigin) {
      // both canvases fill the stage at the same origin; measure the one on show (the hidden view's canvas reads 0 x 0)
      needOrigin = false;
      const rc = active().cv.getBoundingClientRect();
      if (rc.width > 0 && rc.height > 0) [VM, VT].forEach((x) => { x.rx = rc.left; x.ry = rc.top; });
    }
    if (pendingBand) { const id = pendingBand; pendingBand = null; revealBand(id); }
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
    const oy = oy0, oyB = oyBody(oy0, k);
    const sx = (wx) => wx * k + ox, sy = (wy) => wy * k + oy;
    const vx0 = -ox / k, vx1 = (v.w - ox) / k;
    const cw = COL_W * k;
    const ha = headAlphas(k);
    const headH = headPx(k);
    const visCols = [];
    for (let i = 0; i < NC; i++) if (colX[i] + COL_W >= vx0 - 4 && colX[i] <= vx1 + 4) visCols.push(i);

    // column plates (in tilt classes they start under the angled names, at the state caps)
    const hd = ha.dA > 0.01 ? detailPlans(cw, headH, sy(L.y.head)) : null;
    const plateTop = sy(L.y.head) + headH - headContentH(ha, headH, hd) - 3;
    c.globalAlpha = 1;
    visCols.forEach((i) => {
      const x = sx(colX[i]), b = L.colBottom[i] * k + oyB;
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
    // domain heads, then the angled names (they cross the neighbouring columns)
    visCols.forEach((i) => drawHead(c, i, sx(colX[i]), sy(L.y.head), cw, headH, k, ha, baseA, hd, oyB));
    if (ha.tiltA > 0.01) drawTiltNames(c, VM, k, ox, sy(L.y.head) + headH - CAP_H(), baseA * ha.tiltA);

    // column bodies
    const vy0 = (0 - oyB - dropY) / k, vy1 = (v.h - oyB - dropY) / k;
    visCols.forEach((i) => {
      L.colMods[i].forEach((g) => {
        if (g.y + g.h < vy0 || g.y > vy1) return;
        drawModule(c, g, k, ox, oyB, lod, filtering, vy0, vy1, baseA);
      });
    });
    c.restore();
    c.globalAlpha = 1;

    drawSelection(c, k, ox, oyB, lod);
    drawLinks(c, k, ox, oyB, lod);
    drawStickyMap(c, k, ox, oy, lod, visCols, oyB);
  }

  // ── product header band: the instrument dial and the rollups ─────────────────────────────────────
  function drawDial(c, k, ox, oy) {
    const D = L.dial;
    // anchored to the map like any label: positions follow the zoom, sizes never grow past the opening fit
    const sp = k / L.kf, ss = Math.min(1, sp);
    const bx = ox - D.dx * k, by = L.y.dial * k + oy;
    if (by + D.h * sp < -10 || by > VM.h) return;
    const T0 = D.title;
    if (S.selection && S.selection.type === 'product') {
      // the product is selected (its inspector is open): the whole header band is outlined
      const x0 = bx + T0.x * sp - 8, y0 = by + T0.y * sp - 6;
      const x1 = Math.max(bx + T0.x * sp + T0.w * ss, ...D.blocks.map((b) => bx + b.x * sp + b.w * ss)) + 10;
      const y1 = Math.max(by + T0.y * sp + T0.h * ss, ...D.blocks.map((b) => by + b.y * sp + (b.h - 4) * ss)) + 6;
      rrect(c, x0, y0, x1 - x0, y1 - y0, 10);
      c.globalAlpha = 1; c.fillStyle = P.band; c.fill(); c.lineWidth = 1.5; c.strokeStyle = P.ink2; c.stroke();
    }
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
    const place = L.rows === 3 ? placeAreaNames(k, ox, lab(500, 8), 0.6, 2, VM.w) : null;
    AREAS.forEach((A, ai) => {
      const x0 = colX[A.c0] * k + ox, x1 = (colX[A.c1] + COL_W) * k + ox;
      if (x1 < 0 && (!place || place[ai].x + place[ai].w < 0)) return;
      if (x0 > VM.w) return;
      if (place) place[ai].limit = ai < AREAS.length - 1 ? place[ai + 1].x - 6 : VM.w - 4;
      drawAreaContent(c, A, x0, x1, y0, h, s, 1, place && place[ai]);
    });
  }
  /** Band glyph and score, attention and gates of an area, from x on baseline y; returns the end x. */
  function areaState(c, A, x, y, fs, maxX, noGates) {
    const r = BP.areaRating(A.a.id, S.lens), ro = BP.areaRollup(A.a.id);
    const gR = fs * 0.46, tight = fs < 9;
    const sf = mono(400, fs + 1), cf = mono(400, fs + 0.5);
    const ga = tight ? 3 : 4, gb = tight ? 7 : 10, ac = tight ? 9.5 : 11;
    gBand(c, r.band, x + gR, y - fs * 0.36, gR);
    txt(c, scoreOf(r), x + gR * 2 + ga, y, sf, P.ink2);
    x += gR * 2 + ga + tw(sf, scoreOf(r)) + gb;
    if (ro.attention && x + ac + tw(cf, String(ro.attention)) <= maxX) {
      gAttn(c, x + 4, y - fs * 0.36, fs * 0.42); txt(c, String(ro.attention), x + ac, y, cf, P.alarm);
      x += ac + tw(cf, String(ro.attention)) + 9;
    }
    const gsum = gateTotal(ro.gates);
    if (gsum && !noGates && x + 11 + tw(cf, String(gsum)) <= maxX) {
      gGate(c, gateKindOf(ro.gates), x + 4, y - fs * 0.36, fs * 0.42); txt(c, String(gsum), x + 11, y, cf, P.gate);
      x += 11 + tw(cf, String(gsum)) + 9;
    }
    return x;
  }
  function drawAreaContent(c, A, x0, x1, y0, h, s, alpha, place) {
    const a = A.a;
    const sel = S.selection && S.selection.type === 'area' && S.selection.id === a.id;
    c.globalAlpha = alpha;
    // rule with fine ticks (the chart's graticule)
    c.beginPath(); c.moveTo(x0, y0 + 0.5); c.lineTo(x1, y0 + 0.5); c.lineWidth = sel ? 2 : 1; c.strokeStyle = sel ? P.ink : P.ink3; c.stroke();
    c.beginPath();
    const step = 6;
    for (let x = x0; x <= x1; x += step) { const long = Math.round((x - x0) / step) % 5 === 0; c.moveTo(x + 0.5, y0); c.lineTo(x + 0.5, y0 + (long ? 4.5 : 2.5)); }
    c.lineWidth = 0.8; c.strokeStyle = P.rule; c.stroke();
    if (place) {
      // phones: the name in up to two lines (never cut, nudged clear of its neighbours), the state under it
      const font = lab(500, 8);
      place.lines.forEach((ln, j) => txt(c, ln, place.x, y0 + 13 + j * 10.5, font, P.ink, 'left', 0.6));
      areaState(c, A, place.x, y0 + 36.5, 8, Math.min(place.limit, Math.max(place.x + place.w, x1 - 2)), true);
      c.globalAlpha = 1;
      return;
    }
    const fs = 10 * Math.min(s, 1.4);
    const name = a.name.toUpperCase();
    const pad = 4;
    const left = Math.max(x0 + pad, 8), right = x1 - pad;
    const avail = right - left;
    // the name has priority: full tracking, then tighter tracking, then a smaller size; an ellipsis only as a last resort
    let f = fs, ls = f * 0.2;
    if (tw(lab(500, f), name, ls) > avail) ls = f * 0.08;
    if (tw(lab(500, f), name, ls) > avail) { f = Math.max(8.5, fs - 1.5); ls = f * 0.06; }
    const nm = fitText(lab(500, f), name, avail, ls);
    if (L.rows === 1) {
      const baseY = y0 + Math.min(h, 24 * Math.min(s, 1.4)) * 0.5 + 5.5;
      txt(c, nm, left, baseY, lab(500, f), P.ink, 'left', ls);
      areaState(c, A, left + tw(lab(500, f), nm, ls) + 10, baseY, f, right);
    } else {
      const baseY = y0 + 15 * Math.min(s, 1.2);
      txt(c, nm, left, baseY, lab(500, f), P.ink, 'left', ls);
      areaState(c, A, left, baseY + 15 * Math.min(s, 1.2), f, right);
    }
    c.globalAlpha = 1;
  }

  // ── domain heads ─────────────────────────────────────────────────────────────────────────────────
  /** The head renditions blend by the room a column has on screen: angled names (tilt classes), two-line compact
   *  names, wide heads, then the detail head. Each fades over a short zoom band, and the camera never rests inside one
   *  (zoom detents). Alphas sum to 1. */
  function headAlphas(k) {
    const cw = COL_W * k, base = L.heads.mode;
    const rc = base === 'tilt' ? smooth(L.cwCompact * 0.96, L.cwCompact * 1.06, cw) : 1;
    const rw = base === 'wide' ? 1 : smooth(L.cwWide * 0.96, L.cwWide * 1.06, cw);
    const dA = rampK(k, L.th.hd);
    const tiltA = (1 - rc) * (1 - dA), wideA = rw * (1 - dA), compA = Math.max(0, rc - rw) * (1 - dA);
    return { tiltA, compA, wideA, dA };
  }
  const CAP_H = () => (L.phone ? 56 : 58);
  /** The height the head content takes at the bottom of its region (heads sit on their columns; any extra room the
   *  zoom gives the region stays above them until the detail head fills it). */
  function headContentH(ha, h, hd) {
    return ha.tiltA * CAP_H() + ha.compA * 80 + ha.wideA * Math.min(h, 116) + ha.dA * (hd ? hd.H : h);
  }
  /** The head region never gets taller on screen than its tallest rendition needs: it grows with the zoom up to that
   *  height, then the column bodies follow right under it (they shift up by headShift). Below the heads every world y
   *  maps with oy - headShift(k); the dial, banners and heads map with oy. */
  function headNeed() {
    if (L.headNeed) return L.headNeed;
    let need = L.heads.h;
    for (const w of [64, 90, 120, 149, 150, 200, 260, 340, 440]) {
      const hd = detailPlansFull(w);
      need = Math.max(need, hd);
    }
    L.headNeed = need + 6;
    return L.headNeed;
  }
  function detailPlansFull(w) {
    const narrow = w < 150, pad = narrow ? 6 : 12, maxW = w - 2 * pad, maxLines = narrow ? 3 : 2;
    let nfs = narrow ? 9.5 : 15;
    for (const f of narrow ? [13.5, 12.5, 11.5, 10.5, 10, 9.5] : [19, 17, 15]) if (DOMS.every((d) => wrapLines(lab(500, f), d.name, maxW, maxLines).ok)) { nfs = f; break; }
    const slots = Math.max(...DOMS.map((d) => wrapLines(lab(500, nfs), d.name, maxW, maxLines).lines.length));
    const nm = { fs: nfs, lh: Math.round(nfs * 1.2 * 2) / 2, slots };
    return Math.max(...DOMS.map((d, i) => headDetailPlan(i, w, 1e6, nm).H));
  }
  const headPx = (k) => Math.min(L.y.headH * k, Math.max(L.heads.h, headNeed()));
  // the gap under the heads (it carries the link channel) grows a little with the zoom, never more
  const gapPx = (k) => Math.min((L.y.body - L.y.head - L.y.headH) * k, 24);
  const headShift = (k) => Math.max(0, (L.y.body - L.y.head) * k - headPx(k) - gapPx(k));
  /** The link channel: the middle of the gap under the heads, in body world units at zoom k. */
  const chanY = (k) => L.y.body - gapPx(k) / (2 * k);
  const oyBody = (oy, k) => oy - headShift(k);
  /** The detail heads of all 17 columns share one top, so their names, scores and lens lists line up across the map;
   *  they sit on their columns and drop the name while the sticky strip (which names them) covers the region top. */
  function detailPlans(w, h, y0) {
    const stripA = smooth(-6, -46, y0);
    const lim = Math.max(0, (L.tl.AS + L.stripPx + 4) * easeOut(stripA) - y0);
    // one name size and one number of name lines for every column, so the rows below line up across the map
    const narrow = w < 150, pad = narrow ? 6 : 12, maxW = w - 2 * pad;
    const maxLines = narrow ? 3 : 2;
    let nfs = narrow ? 9.5 : 15;
    for (const f of narrow ? [13.5, 12.5, 11.5, 10.5, 10, 9.5] : [19, 17, 15]) if (DOMS.every((d) => wrapLines(lab(500, f), d.name, maxW, maxLines).ok)) { nfs = f; break; }
    const slots = Math.max(...DOMS.map((d) => wrapLines(lab(500, nfs), d.name, maxW, maxLines).lines.length));
    const nm = { fs: nfs, lh: Math.round(nfs * 1.2 * 2) / 2, slots };
    let plans = DOMS.map((d, i) => headDetailPlan(i, w, h - lim, nm));
    let H = Math.max(...plans.map((p) => p.H));
    let noName = false;
    if (h - H < lim + 2) {
      noName = true;
      plans = DOMS.map((d, i) => headDetailPlan(i, w, h - lim, null));
      H = Math.max(...plans.map((p) => p.H));
    }
    return { plans, H: Math.min(H, h - lim), noName };
  }
  function headDetailPlan(i, w, avail, nm) {
    const d = DOMS[i];
    const narrow = w < 150;
    const pad = narrow ? 6 : 12, maxW = w - 2 * pad;
    const nameLines = nm ? wrapLines(lab(500, nm.fs), d.name, maxW, narrow ? 3 : 2).lines : [];
    let H = 6;
    if (nm) H += (narrow ? 0 : 18) + nm.slots * nm.lh + 8;
    H += narrow ? 50 : 34;
    H += 20;
    const cols = maxW >= 330 ? 4 : maxW >= 148 ? 2 : 1;
    const lensH = (8 / cols) * (cols === 1 ? 19 : 21) + 8;
    const sumLines = narrow ? [] : wrapLines(lab(400, 12.5), d.summary || '', maxW, 3).lines;
    let showLens = false, showDots = false, showGrid = false, showSum = false;
    if (H + lensH <= avail) { showLens = true; H += lensH; }
    else if (maxW >= 92 && H + 18 <= avail) { showDots = true; H += 18; }
    else if (maxW >= 44 && H + 36 <= avail) { showGrid = true; H += 36; }
    if (sumLines.length && H + sumLines.length * 17 + 8 <= avail) { showSum = true; H += sumLines.length * 17 + 8; }
    return { H, narrow, pad, maxW, nameLines, nm, sumLines, cols, showLens, showDots, showGrid, showSum };
  }
  function drawHead(c, i, x, y0, w, h, k, ha, baseA, hd, oyB) {
    if (y0 + h < -4 || y0 > VM.h + 4) return;
    const sel = S.selection && S.selection.type === 'domain' && S.selection.id === DOMS[i].id;
    const bottom = y0 + h;
    if (ha.tiltA > 0.01) { c.globalAlpha = baseA * ha.tiltA; drawHeadCap(c, i, x, bottom - CAP_H(), w); }
    if (ha.compA > 0.01) { c.globalAlpha = baseA * ha.compA; drawHeadCompact(c, i, x, bottom - 80, w); }
    if (ha.wideA > 0.01) { c.globalAlpha = baseA * ha.wideA; const hh = Math.min(h, 116); drawHeadWide(c, i, x, bottom - hh, w, hh); }
    if (ha.dA > 0.01 && hd) { c.globalAlpha = baseA * ha.dA; drawHeadDetail(c, i, x, bottom - hd.H, w, hd.plans[i]); }
    c.globalAlpha = baseA;
    const top = bottom - headContentH(ha, h, hd);
    // initiative coverage across the column head: covered, in progress, pending, finding (share of the domain)
    if (domCov && domCov[i].n) {
      const dc = domCov[i], total = COLS[i].feats.length;
      const bx0 = x + 5, bw0 = w - 10;
      let bx2 = bx0;
      c.fillStyle = P.rule2; c.fillRect(bx0, top + 2, bw0, 4);
      ['covered', 'in-progress', 'pending', 'finding'].forEach((st) => { const ww = bw0 * dc[st] / total; if (ww > 0) { c.fillStyle = P[COV_COLOR[st]]; c.fillRect(bx2, top + 2, ww, 4); bx2 += ww; } });
    }
    if (sel) { rrect(c, x + 1, top - 2, w - 2, (L.colBottom[i] * k + oyB) - top + 1, Math.min(8, w * 0.08)); c.lineWidth = 2; c.strokeStyle = P.ink; c.stroke(); }
  }
  /** Angled domain names above their columns (tilt classes): each ends just above its own column and runs up to the
   *  left, so the parallel names never touch. Drawn after the heads because they cross the neighbouring columns. */
  function drawTiltNames(c, v, k, ox, capTop, alpha, colorFor) {
    const T = L.heads.tilt;
    if (!T || alpha <= 0.01) return;
    const font = lab(500, T.fs);
    const a = T.deg * DEG, ca = Math.cos(a);
    for (let i = 0; i < NC; i++) {
      const ax = (colX[i] + COL_W * T.at) * k + ox, ay = capTop - 5;
      const w = tw(font, DOMS[i].name);
      if (ax + 8 < 0 || ax - w * ca > v.w + 8) continue;
      const sel = S.selection && S.selection.type === 'domain' && S.selection.id === DOMS[i].id;
      c.save();
      c.globalAlpha = alpha;
      c.translate(ax, ay);
      c.rotate(a);
      if (sel) { c.fillStyle = P.bandHi; rrect(c, -w - 5, -T.fs - 1, w + 9, T.fs + 6, 4); c.fill(); }
      txt(c, DOMS[i].name, 0, 0, sel ? lab(600, T.fs) : font, colorFor ? colorFor(i) : P.ink, 'right');
      c.restore();
    }
  }
  /** The angled name under a point (screen px), or -1. */
  function tiltHit(sx, sy, k, ox, capTop) {
    const T = L.heads.tilt;
    if (!T) return -1;
    const a = T.deg * DEG, ca = Math.cos(a), sa = Math.sin(a);
    const font = lab(500, T.fs);
    for (let i = 0; i < NC; i++) {
      const ax = (colX[i] + COL_W * T.at) * k + ox, ay = capTop - 5;
      const dx = sx - ax, dy = sy - ay;
      const along = dx * ca + dy * sa, across = -dx * sa + dy * ca; // the name's own frame: baseline along +x, glyphs at -y
      if (along <= 3 && along >= -tw(font, DOMS[i].name) - 3 && across <= 3 && across >= -T.fs - 2) return i;
    }
    return -1;
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
  const scoreOf = (r) => (r.band === 'na' ? '–' : OK.fmt.score(r.score));
  /** Wide head: the name on two lines, band glyph and score, counters, and the domain in all 8 lenses. */
  function drawHeadWide(c, i, x, y, w, h) {
    const d = DOMS[i];
    const r = BP.domainRating(d.id, S.lens);
    const px = x + 7;
    const fs = L.heads.wide ? L.heads.fs : 10.5;
    const font = lab(500, fs);
    const lines = wrapLines(font, d.name, w - 14, 2).lines;
    lines.forEach((ln, j) => txt(c, ln, px, y + 17 + j * fs * 1.22, font, P.ink));
    const gy = y + 17 + fs * 1.22 + 25;
    gBand(c, r.band, px + 9.5, gy, 9.5);
    txt(c, scoreOf(r), px + 25, gy + 6, mono(400, 18), r.band === 'na' ? P.ink3 : P.ink);
    domCounters(c, i, px, gy + 25, 11, x + w - 6, false);
    // the domain in all 8 lenses, in lens order (the current lens underlined)
    const ly = gy + 42;
    if (ly + 9 < y + h && w >= 100) {
      const step = Math.min(22, (w - 12) / 8), gr = Math.min(4.2, step * 0.4);
      LENS_IDS.forEach((id, j) => {
        const lx = px + gr + step * j;
        gBand(c, BP.domainRating(d.id, id).band, lx, ly, gr);
        if (id === S.lens) { c.fillStyle = P.ink; c.fillRect(lx - gr - 0.5, ly + gr + 2.3, gr * 2 + 1, 1.5); }
      });
    }
  }
  /** Compact head (mid-size stages): a smaller two-line name, band glyph and score, counters. */
  function drawHeadCompact(c, i, x, y, w) {
    const d = DOMS[i];
    const r = BP.domainRating(d.id, S.lens);
    const px = x + 5;
    const fs = L.heads.mode === 'compact' ? L.heads.fs : 9.5;
    const font = lab(500, fs);
    wrapLines(font, d.name, w - 10, 2).lines.forEach((ln, j) => txt(c, ln, px, y + 15 + j * fs * 1.2, font, P.ink));
    const gy = y + 15 + fs * 1.2 + 19;
    gBand(c, r.band, px + 7, gy, 7);
    txt(c, scoreOf(r), px + 19, gy + 5, mono(400, 14.5), r.band === 'na' ? P.ink3 : P.ink);
    domCounters(c, i, px, gy + 21, 10, x + w - 4, false);
  }
  /** The state cap under angled names: band glyph and score, then attention and gate counts. */
  function drawHeadCap(c, i, x, y, w) {
    const d = DOMS[i];
    const r = BP.domainRating(d.id, S.lens);
    const cx = x + w / 2;
    const sc = scoreOf(r);
    if (L.phone || w < 40) {
      const gr = clamp(w * 0.22, 4.4, 7);
      gBand(c, r.band, cx, y + 7 + gr, gr);
      txt(c, sc, cx, y + 7 + 2 * gr + 12, mono(400, w < 26 ? 10 : 11), r.band === 'na' ? P.ink3 : P.ink, 'center');
      stackCounters(c, i, cx, y + 7 + 2 * gr + 26, 8.5, w);
      return;
    }
    const sf = mono(400, 13);
    const gr = 6.5, tot = gr * 2 + 4 + tw(sf, sc);
    gBand(c, r.band, cx - tot / 2 + gr, y + 15, gr);
    txt(c, sc, cx - tot / 2 + gr * 2 + 4, y + 19.5, sf, r.band === 'na' ? P.ink3 : P.ink);
    stackCounters(c, i, cx, y + 36, 10, w);
  }
  /** Attention and gate counters centred under a narrow head: one line when they fit, else one under the other. */
  function stackCounters(c, i, cx, y, fs, w) {
    const ro = BP.domainRollup(DOMS[i].id);
    const gn = S.gates ? domGateN[i] : gateTotal(ro.gates);
    const font = mono(S.gates ? 500 : 400, fs);
    const r = fs * (fs < 9 ? 0.34 : 0.4);
    const items = [];
    if (ro.attention) items.push(['attn', ro.attention]);
    if (gn) items.push(['gate', gn]);
    const gp = fs < 9 ? 1.5 : 2;
    const wOf = (it) => r * 2 + gp + tw(font, String(it[1]));
    const one = items.reduce((sum, it) => sum + wOf(it), 0) + (items.length - 1) * 5;
    const lines = one <= w - 4 ? [items] : items.map((it) => [it]);
    lines.forEach((ln, li) => {
      const tot = ln.reduce((sum, it) => sum + wOf(it), 0) + (ln.length - 1) * 5;
      let x = cx - tot / 2;
      const yy = y + li * (fs + 3.5);
      ln.forEach((it) => {
        const sv = String(it[1]);
        if (it[0] === 'attn') { gAttn(c, x + r, yy - fs * 0.34, r * 1.1); txt(c, sv, x + r * 2 + gp, yy, font, P.alarm); }
        else { gGate(c, S.gates && S.gates !== 'any' ? S.gates : gateKindOf(ro.gates), x + r, yy - fs * 0.34, r * 1.05); txt(c, sv, x + r * 2 + gp, yy, font, P.gate); }
        x += wOf(it) + 5;
      });
    });
  }
  /** Detail head (zoomed in): counts, the name large, the lens score with its band, counters, the domain in all 8
   *  lenses (4, 2 or 1 to a row, or a row of glyphs when short of room) and the summary when the column is wide. */
  function drawHeadDetail(c, i, x, y, w, pl) {
    const d = DOMS[i];
    const lens = S.lens;
    const r = BP.domainRating(d.id, lens);
    const ro = BP.domainRollup(d.id);
    const narrow = pl.narrow;
    const px = x + pl.pad, maxW = pl.maxW;
    let bt = y + 6; // the top of the score block
    if (pl.nm) {
      const nm = pl.nm, nf = lab(500, nm.fs);
      let ny = y + 6 + nm.fs;
      if (!narrow) { txt(c, fitText(mono(400, 10.5), ro.count + ' features · ' + COLS[i].mods.length + ' modules', maxW), px, y + 18, mono(400, 10.5), P.ink3); ny += 18 + 4; }
      pl.nameLines.forEach((ln, j) => txt(c, ln, px, ny + j * nm.lh, nf, P.ink));
      bt = y + 6 + (narrow ? 0 : 18) + nm.slots * nm.lh + 8;
    }
    const gr = narrow ? 8.5 : 11, sf = mono(400, narrow ? 17 : 22);
    const gy = bt + gr + 3;
    gBand(c, r.band, px + gr, gy, gr);
    const sc = scoreOf(r);
    txt(c, sc, px + gr * 2 + 7, gy + (narrow ? 6 : 7.5), sf, r.band === 'na' ? P.ink3 : P.ink);
    let yy;
    if (narrow) {
      txt(c, fitText(lab(400, 11), OK.bandLabel(r.band), maxW), px, gy + gr + 17, lab(400, 11), P.ink2);
      yy = bt + 50;
    } else {
      const rated = OK.bandLabel(r.band) + (r.applicable != null ? ' · ' + r.applicable + ' of ' + ro.count + ' rated' : '');
      const lx = px + gr * 2 + 7 + tw(sf, sc) + 10;
      txt(c, fitText(lab(500, 9.5), OK.lens(lens).label.toUpperCase(), x + w - 12 - lx, 1.4), lx, gy - 2, lab(500, 9.5), P['lens_' + lens] || P.ink2, 'left', 1.4);
      txt(c, fitText(lab(400, 11.5), rated, x + w - 12 - lx), lx, gy + 12, lab(400, 11.5), P.ink2);
      yy = bt + 34;
    }
    domCounters(c, i, px, yy + 12, 11.5, x + w - 8, false);
    yy += 20;
    if (pl.showLens) {
      // all 8 lenses: band glyph, short name and (with room) the score
      const cols = pl.cols, per = Math.floor(maxW / cols), rh = cols === 1 ? 19 : 21;
      LENS_IDS.forEach((id, j) => {
        const rr3 = BP.domainRating(d.id, id);
        const lx2 = px + (j % cols) * per, ly2 = yy + 10 + Math.floor(j / cols) * rh;
        gBand(c, rr3.band, lx2 + 5, ly2 - 4, 5);
        const lf = lab(id === lens ? 500 : 400, per < 80 ? 11 : 11.5);
        const withScore = per >= 74;
        const sw2 = withScore ? tw(mono(400, 11), scoreOf(rr3)) + 6 : 0;
        txt(c, fitText(lf, OK.lens(id).short, per - 15 - sw2 - (cols === 1 ? 0 : 10)), lx2 + 15, ly2, lf, id === lens ? P.ink : P.ink2);
        if (withScore) txt(c, scoreOf(rr3), lx2 + per - (cols === 1 ? 2 : 12), ly2, mono(400, 11), P.ink3, 'right');
      });
      yy += (8 / cols) * rh + 8;
    } else if (pl.showDots) {
      const step = Math.min(20, maxW / 8);
      LENS_IDS.forEach((id, j) => {
        const lx = px + step * (j + 0.5);
        gBand(c, BP.domainRating(d.id, id).band, lx, yy + 4, Math.min(4.6, step * 0.38));
        if (id === lens) { c.fillStyle = P.ink; c.fillRect(lx - 4, yy + 10.5, 8, 1.6); }
      });
      yy += 18;
    } else if (pl.showGrid) {
      // the 8 lenses as two rows of four glyphs, in lens order (the current lens underlined)
      const step = Math.min(16, maxW / 4), gr = Math.min(4.6, step * 0.32);
      LENS_IDS.forEach((id, j) => {
        const lx = px + step * ((j % 4) + 0.5) - (step - gr * 2) / 2, ly = yy + 6 + Math.floor(j / 4) * 15;
        gBand(c, BP.domainRating(d.id, id).band, lx, ly, gr);
        if (id === lens) { c.fillStyle = P.ink; c.fillRect(lx - gr - 0.5, ly + gr + 2, gr * 2 + 1, 1.5); }
      });
      yy += 36;
    }
    if (pl.showSum) pl.sumLines.forEach((ln) => { txt(c, ln, px, yy + 4, lab(400, 12.5), P.ink2); yy += 17; });
  }

  // ── modules and features ─────────────────────────────────────────────────────────────────────────
  function drawModule(c, g, k, ox, oy, lod, filtering, vy0, vy1, baseA) {
    const m = g.m;
    const mx0 = g.x * k + ox, my0 = g.y * k + oy, mw = g.w * k, mh = g.h * k;
    const mr = BP.moduleRating(m.id, S.lens);
    const ro = BP.moduleRollup(m.id);
    const sel = S.selection && S.selection.type === 'module' && S.selection.id === m.id;
    const gk = S.gates;
    const gN = gk ? (modGateN.get(m.id) || 0) : 0;
    const allDim = filtering && !(modMatchN.get(m.id) > 0);
    // L0: a heat bar coloured by the module's band: a light tint with a solid band edge, one segment per feature
    // (paper hairlines between them, like an equaliser), n/a features hatched at their own rows
    const barA = 1 - lod.a1;
    const rowH = L.ROW * k;
    const vi = clamp(MG * k * 0.22, 0.5, 2);
    const bx = mx0, bw = mw, by = my0 + vi, bh = mh - 2 * vi;
    if (barA > 0.01) {
      const r = Math.min(5, bw * 0.14);
      const a0 = baseA * barA * (filtering ? 0.22 : 1);
      c.globalAlpha = a0;
      rrect(c, bx, by, bw, bh, r);
      if (mr.band === 'na') { c.fillStyle = P.naSoft; c.fill(); c.fillStyle = hatch || P.naSoft; c.fill(); c.setLineDash([3, 2.5]); c.lineWidth = 1; c.strokeStyle = P.na; c.stroke(); c.setLineDash([]); }
      else {
        c.fillStyle = P.paperHi; c.fill();
        c.globalAlpha = a0 * (P.dark ? 0.52 : 0.5); c.fillStyle = BC(mr.band); c.fill();
        c.save(); rrect(c, bx, by, bw, bh, r); c.clip();
        // features where the lens does not apply keep their own place on the bar, hatched
        g.fi.forEach((fi) => {
          if (fBand[fi] !== 'na') return;
          const ry = L.rowY[fi] * k + oy;
          c.globalAlpha = a0;
          c.fillStyle = P.paperHi; c.fillRect(bx, ry, bw, rowH);
          c.fillStyle = hatch || P.naSoft; c.fillRect(bx, ry, bw, rowH);
        });
        // segment hairlines between features, then the solid band edge
        if (rowH >= 5 && bw >= 12) {
          c.globalAlpha = a0 * (P.dark ? 0.7 : 0.9); c.fillStyle = P.paperHi;
          const lw = rowH >= 9 ? 1.5 : 1;
          g.fi.forEach((fi) => { const ry = L.rowY[fi] * k + oy; c.fillRect(bx, ry - lw / 2, bw, lw); });
        }
        c.globalAlpha = a0; c.fillStyle = BC(mr.band); c.fillRect(bx, by, clamp(bw * 0.07, 2, 4), bh);
        c.restore();
      }
      c.globalAlpha = baseA * barA;
      // filter ticks: the matching features, at their own rows, over the faded bars
      if (filtering) {
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
      if (sel) { rrect(c, bx - 1.5, by - 1.5, bw + 3, bh + 3, r + 1); c.lineWidth = 2; c.strokeStyle = P.ink; c.stroke(); }
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
    // lanes 2 px apart on screen inside the channel under the heads
    const yTop = chanY(cam.k) + ((lane % 5) - 2) * 2 / cam.k, yBot = below + 10 + lane * 2.2;
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
  /** Area names placed over their spans when a span is too short for its name (phones): wrapped at word breaks,
   *  centred, then nudged apart so no two touch and none leaves the stage. Returns [{ lines, x, w }] per area. */
  function placeAreaNames(k, ox, font, ls, maxLines, limitW) {
    const out = AREAS.map((A) => {
      const x0 = colX[A.c0] * k + ox, x1 = (colX[A.c1] + COL_W) * k + ox;
      const name = A.a.name.toUpperCase();
      const longest = Math.max(...name.split(/\s+/).map((wd) => tw(font, wd, ls)));
      const lines = maxLines === 1 ? [name] : wrapLines(font, name, Math.max(x1 - x0 - 4, longest + 1), maxLines, ls).lines;
      const w = Math.max(...lines.map((ln) => tw(font, ln, ls)));
      return { lines, w, x: Math.max(x0 + 2, (x0 + x1) / 2 - w / 2), x0, x1 };
    });
    // a name that fits its span starts at the span; a longer one is centred over it
    out.forEach((o) => { if (o.w <= o.x1 - o.x0 - 4) o.x = o.x0 + 2; });
    for (let i = 1; i < out.length; i++) out[i].x = Math.max(out[i].x, out[i - 1].x + out[i - 1].w + 7);
    let lim = limitW - 4;
    for (let i = out.length - 1; i >= 0; i--) { out[i].x = Math.min(out[i].x, lim - out[i].w); lim = out[i].x - 7; }
    out.fits = out[0].x >= 2;
    return out;
  }
  function drawStrip(c, v, k, ox, alpha, yOff, visCols) {
    const AS = L.tl.AS, SH = v === VT ? tlTopPx(k) - AS : L.stripPx;
    const top = yOff;
    c.globalAlpha = alpha;
    c.fillStyle = P.paperHi; c.globalAlpha = 1; c.fillRect(0, top, v.w, AS + SH);
    c.globalAlpha = alpha;
    c.beginPath(); c.moveTo(0, top + AS + SH + 0.5); c.lineTo(v.w, top + AS + SH + 0.5); c.lineWidth = 1; c.strokeStyle = P.rule; c.stroke();
    // areas: the name over its span (phones place them so none is cut)
    const afs = L.phone ? 8 : 9.5, als = L.phone ? 0.6 : afs * 0.18, afont = lab(500, afs);
    // names keep their full length when the strip can hold them all, nudged over the neighbouring spans if need be
    // (phones wrap them to two lines)
    const placed = placeAreaNames(k, ox, afont, als, L.phone ? 2 : 1, v.w);
    const useP = placed.fits && AREAS.some((A, ai) => tw(afont, A.a.name.toUpperCase(), als) > (colX[A.c1] + COL_W - colX[A.c0]) * k - 8);
    AREAS.forEach((A, ai) => {
      const x0 = colX[A.c0] * k + ox, x1 = (colX[A.c1] + COL_W) * k + ox;
      if (x1 < 0 || x0 > v.w) return;
      c.beginPath(); c.moveTo(x0, top + AS - 0.5); c.lineTo(x1, top + AS - 0.5); c.lineWidth = 1; c.strokeStyle = P.rule; c.stroke();
      const name = A.a.name.toUpperCase();
      if (useP) placed[ai].lines.forEach((ln, j) => txt(c, ln, placed[ai].x, top + (placed[ai].lines.length > 1 ? 11 + j * 10 : AS / 2 + 3.2), afont, P.ink2, 'left', als));
      else { const left = Math.max(x0, 6); txt(c, fitText(afont, name, x1 - left - 6, als), left + 2, top + AS / 2 + 3.5, afont, P.ink2, 'left', als); }
    });
    // domains: horizontal names when the columns have room; angled names in the timeline while they are narrow
    const cw = COL_W * k;
    const tiltA = v === VT ? tlTiltA(k) : 0;
    const wide = cw >= L.cwWide;
    const small = !wide && cw >= L.cwSmall;
    const y = top + AS;
    const bodyA = alpha * (1 - tiltA);
    visCols.forEach((i) => {
      const x = colX[i] * k + ox;
      const d = DOMS[i];
      const r = BP.domainRating(d.id, S.lens);
      const sel = S.selection && S.selection.type === 'domain' && S.selection.id === d.id;
      const sc = scoreOf(r);
      if (sel) { c.globalAlpha = alpha; c.fillStyle = P.bandHi; c.fillRect(x, y, cw, SH); }
      if (bodyA > 0.01) {
        c.globalAlpha = bodyA;
        if (wide) {
          const fs = 10.5;
          const lines = wrapLines(lab(500, fs), d.name, cw - 12 - (cw < 150 ? 0 : 34), 2).lines;
          if (cw >= 150) {
            txt(c, sc, x + cw - 6, y + 17, mono(400, 10.5), P.ink2, 'right');
            gBand(c, r.band, x + cw - 6 - tw(mono(400, 10.5), sc) - 9, y + 13.5, 4.5);
            lines.forEach((ln, j) => txt(c, ln, x + 6, y + 17 + j * 12.5, lab(500, fs), P.ink));
          } else {
            gBand(c, r.band, x + 10.5, y + 11, 4.5);
            txt(c, sc, x + 19, y + 14.5, mono(400, 10.5), P.ink2);
            lines.forEach((ln, j) => txt(c, ln, x + 6, y + 30 + j * 12.5, lab(500, fs), P.ink));
          }
        } else if (small) {
          const cx = x + cw / 2, sf = mono(400, 9.5);
          const tot = 9 + 3 + tw(sf, sc);
          gBand(c, r.band, cx - tot / 2 + 4.5, y + 10, 4.5);
          txt(c, sc, cx - tot / 2 + 12, y + 13.5, sf, P.ink2);
          const fs = cw - 10 >= tw(lab(500, 9.5), 'Subscriptions') ? 9.5 : 8.5;
          wrapLines(lab(500, fs), d.name, cw - 8, 2).lines.forEach((ln, j) => txt(c, ln, cx, y + 27 + j * (fs + 2), lab(500, fs), P.ink, 'center'));
        } else {
          // the fallback for columns too narrow for a name (the sticky strip of a map zoomed to the overview)
          const cx = x + cw / 2;
          txt(c, d.code, cx, y + 12, mono(500, cw < 26 ? 7.5 : 9), P.ink2, 'center');
          const gr = clamp(cw * 0.2, 3.5, 6.5);
          gBand(c, r.band, cx, y + 17 + gr, gr);
          if (SH >= 40 && cw >= 22) txt(c, sc, cx, y + 17 + 2 * gr + 11, mono(400, cw < 34 ? 8.5 : 10), P.ink2, 'center');
        }
      }
      if (tiltA > 0.01) {
        // under the angled names: band glyph and score for each column
        c.globalAlpha = alpha * tiltA;
        const cx = x + cw / 2, by = y + SH - 24;
        if (cw >= 34) {
          const sf = mono(400, 10.5), tot = 9 + 3 + tw(sf, sc);
          gBand(c, r.band, cx - tot / 2 + 4.5, by + 11, 4.5);
          txt(c, sc, cx - tot / 2 + 12, by + 14.5, sf, P.ink2);
        } else {
          gBand(c, r.band, cx, by + 7, 4);
          txt(c, sc, cx, by + 20, mono(400, 8.5), P.ink2, 'center');
        }
      }
      c.globalAlpha = alpha;
      if (i < NC - 1 && COLS[i + 1].d.areaId === d.areaId) { c.beginPath(); c.moveTo(x + cw + (GAP_D * k) / 2, y + SH - (tiltA > 0.5 ? 24 : SH - 4)); c.lineTo(x + cw + (GAP_D * k) / 2, y + SH - 4); c.lineWidth = 1; c.strokeStyle = P.rule2; c.stroke(); }
    });
    if (tiltA > 0.01) drawTiltNames(c, v, k, ox, y + SH - 24, alpha * tiltA);
    c.globalAlpha = 1;
  }
  function drawStickyMap(c, k, ox, oy, lod, visCols, oyB) {
    const headTop = L.y.head * k + oy;
    // the strip slides down as soon as the domain names have scrolled above the top edge
    const a = smooth(-6, -46, headTop);
    if (a <= 0.01) return;
    drawStrip(c, VM, k, ox, 1, -(1 - easeOut(a)) * (L.tl.AS + L.stripPx + 2), visCols);
    // modules whose header strip has scrolled under it keep their name in a pill
    if (lod.a2 < 0.3) return;
    const top = L.tl.AS + L.stripPx;
    const wy = (top - oyB) / k;
    visCols.forEach((i) => {
      const g = L.colMods[i].find((m) => m.y + MH < wy + 2 / k && m.y + m.h > wy + 26 / k);
      if (!g) return;
      const x = g.x * k + ox, w = g.w * k;
      c.globalAlpha = a * lod.a2;
      void oy;
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
    if (headTop < -30 && sy <= L.tl.AS + L.stripPx) {
      const ci = colAt(wx);
      if (sy <= L.tl.AS) { const A = AREAS.find((x) => ci >= x.c0 && ci <= x.c1); return A ? { type: 'area', id: A.a.id } : null; }
      return ci >= 0 ? { type: 'domain', id: DOMS[ci].id } : null;
    }
    // the product header band
    if (wy < L.y.area) {
      const D = L.dial, sp = k / L.kf, bx = ox - D.dx * k;
      const right = Math.max(D.title.x + D.title.w, ...D.blocks.map((b) => b.x + b.w));
      return sx >= bx && sx <= bx + right * sp && sy >= oy && sy <= oy + D.h * sp ? { type: 'product', id: BP.product.id } : null;
    }
    if (wy >= L.y.area && wy < L.y.head) {
      const ci = colAt(wx);
      const A = AREAS.find((x) => ci >= x.c0 && ci <= x.c1);
      return A ? { type: 'area', id: A.a.id } : null;
    }
    // angled names cross their neighbours' columns, so they are hit-tested in their own frame
    const ha = headAlphas(k);
    const headBot = L.y.head * k + oy + headPx(k);
    const capTop = headBot - CAP_H();
    if (ha.tiltA > 0.5 && sy < capTop) {
      const ti = tiltHit(sx, sy, k, ox, capTop);
      return ti >= 0 ? { type: 'domain', id: DOMS[ti].id } : null;
    }
    const ci = colAt(wx);
    if (ci < 0) return null;
    if (sy < headBot) return { type: 'domain', id: DOMS[ci].id };
    const wyB = (sy - oyBody(oy, k)) / k; // below the heads, the body mapping
    if (wyB < L.y.body) return { type: 'domain', id: DOMS[ci].id };
    return hitBody(sx, wyB, ci, k, ox, lod);
  }
  function hitBody(sx, wy, ci, k, ox, lod) {
    if (wy > L.colBottom[ci]) return null;
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
    if (sy <= tlTopPx(k)) {
      const ci = colAt(wx);
      if (sy <= T.AS) { const A = AREAS.find((x) => ci >= x.c0 && ci <= x.c1); return A ? { type: 'area', id: A.a.id } : null; }
      return ci >= 0 ? { type: 'domain', id: DOMS[ci].id } : null;
    }
    const b = T.bands.find((x) => sy >= tlTop(x, k, oy) && sy <= tlBottom(x, k, oy));
    if (!b) return null;
    // a highlight named in the band header
    const hl = (b.hl || []).concat(b.hl2 || []).find((q) => q.a > 0.5 && sx >= q.x0 && sx <= q.x1 && sy >= q.y0 && sy <= q.y1);
    if (hl) return { type: 'feature', id: FEATS[hl.chip.fi].id, chip: hl.chip };
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
    const top = tlTopPx(k);
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
      const right = Math.min(v.w, x1) - 12;
      let full = true;
      {
        // counts by kind (shipped) or readiness (next, future); when short of room, what is at risk is kept first
        const parts = relHeaderParts(b);
        const pw = (p) => 14 + tw(cntF, String(p.n)) + 4 + (ph ? 8 : tw(lblF, p.label) + 12);
        const pri = (p) => (p.status === 'blocked' ? 0 : p.status === 'ready' ? 1 : p.status === 'building' ? 2 : 3);
        let room = right - x + 12;
        const keep = new Set();
        parts.slice().sort((p, q) => pri(p) - pri(q)).forEach((p) => { if (pw(p) <= room) { keep.add(p); room -= pw(p); } else full = false; });
        parts.forEach((p) => {
          if (!keep.has(p)) return;
          if (p.kind) gKind(c, p.kind, x + 5, hy - 4, 5); else gStatus(c, p.status, x + 5, hy - 4, 5);
          txt(c, String(p.n), x + 14, hy, cntF, p.status === 'blocked' ? P.alarm : P.ink); x += 14 + tw(cntF, String(p.n)) + 4;
          if (!ph) { txt(c, p.label, x, hy, lblF, P.ink2); x += tw(lblF, p.label) + 12; } else x += 8;
        });
      }
      // highlights at rest: the release's biggest items (at-risk first) named after the counts, as many as fit whole
      b.hl = [];
      const hlA = 1 - smooth(8.5, 11, T.ch * k);
      if (full && hlA > 0.01 && x + 60 < right) {
        c.globalAlpha = baseA * hlA;
        c.beginPath(); c.moveTo(x + 0.5, hy - 10); c.lineTo(x + 0.5, hy + 2); c.lineWidth = 1; c.strokeStyle = P.rule; c.stroke();
        x += 12;
        const hf = lab(400, 12);
        for (const ch of b.top) {
          const f = FEATS[ch.fi];
          const w = 13 + tw(hf, f.name);
          if (x + w > right) break;
          const band = fBand[ch.fi], col = band === 'na' ? P.na : BC(band);
          const risk = r.state !== 'shipped' && f.status === 'blocked';
          rrect(c, x, hy - 7.5, 9, 6, 2);
          if (ch.kind === 'new') { c.fillStyle = col; c.fill(); } else { c.fillStyle = P.paperHi; c.fill(); c.lineWidth = 1; c.strokeStyle = col; c.stroke(); }
          if (risk) { c.fillStyle = P.alarm; c.fill(); }
          c.globalAlpha = baseA * hlA * (fDim[ch.fi] ? 0.35 : 1);
          txt(c, f.name, x + 13, hy, hf, risk ? P.alarm : P.ink2);
          c.globalAlpha = baseA * hlA;
          b.hl.push({ x0: x - 2, x1: x + w + 2, y0: hy - 12, y1: hy + 5, chip: ch, a: hlA });
          x += w + 14;
        }
        c.globalAlpha = baseA;
      }
    }
    // the next release: what is at risk, by name (the blocked items, biggest first), as many as fit whole
    if (b.risk.length && hh >= 10) {
      const ry = by + T.HDR + (ph ? 11 : 12);
      let rx = Math.max(x0 + 10, 10);
      const right = Math.min(v.w, x1) - 12;
      const lf = lab(500, ph ? 8.5 : 9), nf = lab(400, ph ? 11.5 : 12);
      gStatus(c, 'blocked', rx + 5, ry - 4, 5);
      txt(c, 'AT RISK', rx + 14, ry, lf, P.alarm, 'left', 1.2);
      rx += 14 + tw(lf, 'AT RISK', 1.2) + 10;
      b.hl2 = [];
      let shown = 0;
      for (const fi of b.risk) {
        const f = FEATS[fi];
        const more = b.risk.length - shown - 1;
        const tail = more > 0 ? tw(mono(400, 11), '+' + more) + 12 : 0;
        const w = tw(nf, f.name);
        if (rx + w + tail > right) break;
        c.globalAlpha = baseA * (fDim[fi] ? 0.35 : 1);
        txt(c, f.name, rx, ry, nf, P.ink);
        c.globalAlpha = baseA;
        const chip = b.chips.find((c2) => c2.fi === fi);
        b.hl2.push({ x0: rx - 2, x1: rx + w + 2, y0: ry - 12, y1: ry + 5, chip, a: 1 });
        rx += w;
        shown += 1;
        if (shown < b.risk.length) { txt(c, '·', rx + 5, ry, nf, P.ink3); rx += 14; }
      }
      if (shown < b.risk.length) txt(c, (shown ? '+' : '') + (b.risk.length - shown) + (shown ? ' more' : ' blocked items'), rx, ry, mono(400, 11), P.ink3);
    }
    // chips, and at rest each domain's count at the end of its bar
    const chH = T.ch * k;
    const cntA = 1 - smooth(8.5, 11, chH);
    const cntFont = mono(400, ph ? 8.5 : 9.5);
    visCols.forEach((ci) => {
      const list = b.cols[ci];
      for (let j = 0; j < list.length; j++) {
        const ch = list[j];
        const sy = chipY(ch, k, oy);
        if (sy > v.h || sy + chH < tlTopPx(k) - 30) continue;
        drawChip(c, ch, ch.x * k + ox, sy, ch.w * k, chH, r, baseA, selFi);
      }
      if (list.length && cntA > 0.01) {
        const ly = chipY(list[list.length - 1], k, oy) + chH + 10;
        if (ly < v.h + 10 && ly > tlTopPx(k)) {
          c.globalAlpha = baseA * cntA;
          txt(c, String(list.length), list[0].x * k + ox + list[0].w * k / 2, ly, cntFont, P.ink3, 'center');
          c.globalAlpha = baseA;
        }
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
    const cx = r.w / 2, cy = (v === VT ? tlTopPx(cam.k) + r.h : r.h) / 2;
    const wx = (cx - cam.x) / cam.k, wy = (cy - cam.y[v.name]) / cam.k;
    let lvl = '', path = '';
    if (v === VM) {
      const lod = lodOf(cam.k);
      lvl = 'Level ' + lod.level + ' · ' + levelName[lod.level];
      let ci = colAt(wx);
      if (ci < 0) { let best = Infinity; for (let i = 0; i < NC; i++) { const dd = Math.abs(colX[i] + COL_W / 2 - wx); if (dd < best) { best = dd; ci = i; } } }
      const d = DOMS[ci];
      const parts = [BP.area(d.areaId).name, d.name];
      const wyB = (cy - oyBody(cam.y.map, cam.k)) / cam.k;
      if (lod.level >= 1 && wyB > L.y.body) { const g = L.colMods[ci].find((m) => wyB >= m.y - MG && wyB <= m.y + m.h + MG); if (g) parts.push(g.m.name); }
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
    if (hit.type === 'product') {
      const pr = BP.productRating(lens);
      return { key: 'p' + lens, html: '<div class="dc-tip__h"><span>' + esc(BP.product.name) + '</span></div><div class="dc-tip__r">' + OK.html.band(pr.band, 12) + '<b class="ok-mono">' + (pr.band === 'na' ? '–' : OK.fmt.score(pr.score)) + '</b><span>' + esc(OK.lens(lens).label + ' · ' + OK.bandLabel(pr.band)) + '</span></div><div class="dc-tip__s">Click for the whole product</div>' };
    }
    if (hit.type === 'release') {
      const r = BP.release(hit.id);
      return { key: 'r' + r.id, html: '<div class="dc-tip__h"><span>' + esc(r.label + ' · ' + r.name) + '</span></div><div class="dc-tip__s">' + esc(OK.fmt.date(r.date) + ' · ' + OK.fmt.rel(r.date)) + '</div><div class="dc-tip__s">Click to open the release package</div>' };
    }
    return null;
  }
  /** The hover card: content is written in the handler, its size is measured in the next frame (never in the
   *  handler), and later moves reuse that size. */
  function showTip(v, sx, sy, hit) {
    const t = tipFor(v, hit);
    if (!t) { hideTip(v); return; }
    v.tipAt = { sx, sy };
    if (v.tipKey !== t.key) {
      v.tip.innerHTML = t.html; v.tipKey = t.key; v.tipSize = null;
      v.tip.style.visibility = 'hidden';
      v.tip.hidden = false;
      tipPending = v;
      schedule();
      return;
    }
    placeTip(v);
  }
  function placeTip(v) {
    if (!v.tipSize || !v.tipAt) return;
    const { sx, sy } = v.tipAt, tw2 = v.tipSize[0], th2 = v.tipSize[1];
    let x = sx + 16, y = sy + 18;
    if (x + tw2 > v.w - 8) x = sx - tw2 - 12;
    if (y + th2 > v.h - 8) y = sy - th2 - 12;
    v.tip.style.transform = 'translate(' + Math.round(Math.max(4, x)) + 'px,' + Math.round(Math.max(4, y)) + 'px)';
    v.tip.style.visibility = '';
  }
  let tipPending = null;
  function measureTip() {
    const v = tipPending;
    tipPending = null;
    if (!v || v.tip.hidden) return;
    v.tipSize = [v.tip.offsetWidth, v.tip.offsetHeight];
    placeTip(v);
  }
  function hideTip(v) { if (!v.tip.hidden) { v.tip.hidden = true; v.tipKey = ''; v.tipSize = null; } }

  // ══ pointer, wheel, keys ════════════════════════════════════════════════════════════════════════
  function attach(v) {
    const cv = v.cv;
    const ptrs = new Map();
    let drag = null, pinch = null, lastTap = null;
    // the canvas origin is cached in a frame after each resize, so handlers never read layout
    const local = (e) => ({ x: e.clientX - v.rx, y: e.clientY - v.ry });
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      hideTip(v);
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      ptrs.set(e.pointerId, local(e));
      flight = null;
      if (ptrs.size === 1) drag = { p0: local(e), x0: cam.x, y0: cam.y[v.name], moved: false, type: e.pointerType };
      else if (ptrs.size === 2) {
        const [a, b] = Array.from(ptrs.values());
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        pinch = { d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, k0: cam.k, wx: (mx - cam.x) / cam.k, wy: v === VM ? mapWorldY(my, cam.k, cam.y.map) : (my - cam.y[v.name]) / cam.k, ta: v === VT ? tlAnchor(my, cam.k, cam.y.timeline) : null };
        if (drag) drag.moved = true;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && L) {
          const p = local(e);
          const hit = v === VM ? hitMap(p.x, p.y) : hitTimeline(p.x, p.y);
          cv.classList.toggle('is-pointer', !!hit);
          showTip(v, p.x, p.y, hit);
        }
        return;
      }
      ptrs.set(e.pointerId, local(e));
      if (pinch && ptrs.size >= 2) {
        const [a, b] = Array.from(ptrs.values());
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const k = clamp(pinch.k0 * Math.hypot(b.x - a.x, b.y - a.y) / pinch.d0, L.th.min, L.th.max);
        setCam(v, mx - pinch.wx * k, pinch.ta ? my - pinch.ta.off - pinch.ta.u * k - pinch.ta.fx : mapCamY(pinch.wy, my, k), k);
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
      const p = local(e);
      zoomAt(v, p.x, p.y, cam.k * f, false);
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
  /** Where the inspector (desktop side panel) or the peek sheet (phones) will appear once it opens, in view px. */
  const PANEL = { w: 392, sheet: 0.62, top: 102 };
  function readPanel() {
    const cs = getComputedStyle(shell.root);
    const num = (n, d) => { const x = parseFloat(cs.getPropertyValue(n)); return isFinite(x) ? x : d; };
    PANEL.w = num('--ok-insp-w', PANEL.w);
    PANEL.sheet = num('--ok-insp-sheet', PANEL.sheet);
    PANEL.top = num('--ok-bar-h', 56) + num('--ok-filter-h', 46);
  }
  function underPanel(v, sx, sy) {
    if (shell.inspector.isOpen()) return false;
    if (L.phone) return sy > (v.h + PANEL.top) * (1 - PANEL.sheet) - PANEL.top - 8;
    return sx > v.w - 12 - PANEL.w - 10;
  }
  // A first tap on a spot the inspector is about to cover waits out the double-tap window before it peeks or inspects,
  // so the second tap of a double-click still reaches the map instead of the panel that just opened over it.
  let tapWait = null;
  function onTap(v, sx, sy, dbl) {
    if (!L) return;
    if (tapWait) { clearTimeout(tapWait.timer); const w = tapWait; tapWait = null; tapAction(w.v, w.sx, w.sy, false, w.hit); }
    const hit = v === VM ? hitMap(sx, sy) : hitTimeline(sx, sy);
    if (hit && !dbl && underPanel(v, sx, sy)) {
      tapWait = { v, sx, sy, hit, timer: setTimeout(() => { const w = tapWait; tapWait = null; if (w && active() === w.v && !S.page) tapAction(w.v, w.sx, w.sy, false, w.hit); }, 340) };
      return;
    }
    tapAction(v, sx, sy, dbl, hit);
  }
  function tapAction(v, sx, sy, dbl, hit) {
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
  let pendingReveal = null, pendingBand = null;
  /** Scroll the release stack so a band's header is in view (keeps the zoom). */
  function revealBand(id) {
    const b = L.tl.bands.find((x) => x.r.id === id);
    if (!b) return;
    const top = tlTopPx(cam.k) + 10, bottom = VT.h - L.mb;
    const y0 = tlTop(b, cam.k, cam.y.timeline), y1 = tlBottom(b, cam.k, cam.y.timeline);
    if (y0 >= top && Math.min(y1, y0 + 120) <= bottom) return;
    flyTo(VT, { x: cam.x, y: cam.y.timeline + (top - y0), k: cam.k }, 420);
  }
  // after a peek opens the inspector, pan just enough to keep the clicked row clear of it
  function revealPending() {
    if (!pendingReveal) return;
    const { v, fi, chip } = pendingReveal;
    pendingReveal = null;
    if (active() !== v) return;
    const r = shell.freeRectHint();
    lastFree = r;
    const k = cam.k;
    let x, y, w, h;
    if (v === VM) { const g = L.fMod[fi]; x = g.x * k + cam.x; w = g.w * k; y = L.rowY[fi] * k + oyBody(cam.y.map, k); h = L.ROW * k; }
    else { if (!chip) return; x = chip.x * k + cam.x; w = chip.w * k; y = chipY(chip, k, cam.y.timeline); h = L.tl.ch * k; }
    const m = 20;
    let dx = 0, dy = 0;
    if (x + Math.min(w, 120) > r.w - m) dx = r.w - m - (x + Math.min(w, 120));
    if (x < m) dx = m - x;
    if (y + h > r.h - m) dy = r.h - m - (y + h);
    const top = v === VT ? tlTopPx(k) + 8 : 8;
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
    } else if (hit.type === 'product') {
      fitView(VM, animate);
      return;
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
    // a box that starts above the bodies (an area or a domain) is shorter on screen by the head shift
    const hS = box.h * k - (box.y < L.y.body ? headShift(k) : 0);
    let y = r.h / 2 - hS / 2 - box.y * k + (box.y >= L.y.body ? headShift(k) : 0);
    if (hS > r.h - pad * 2) y = mapCamY(box.y, pad, k); // tall boxes: keep their top in view
    flyTo(VM, { x, y, k }, animate ? 560 : 0);
    touched = true;
  }
  function zoomToBand(id) {
    const b = L.tl.bands.find((x) => x.r.id === id);
    if (!b) return;
    const r = freeRectCached();
    const top = tlTopPx(cam.k) + 10;
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
    lastFree = shell.freeRectHint();
    if (S.view === 'timeline') {
      if (ref.type === 'feature') {
        const fi = fIdx.get(ref.id);
        const list = L.tl.chipsOf.get(fi);
        if (!list || !list.length) return;
        const ch = list[list.length - 1];
        const r = lastFree;
        const k = clamp(Math.max(cam.k, 18 / L.tl.cp, 110 / COL_W), L.th.min, L.th.max);
        const cy = (tlTopPx(k) + r.h) / 2;
        flyTo(VT, { x: r.w / 2 - (ch.x + ch.w / 2) * k, y: cy - L.tl.ch * k / 2 - (ch.band.u0 + ch.j * L.tl.cp) * k - ch.band.fxTop - ch.band.hdr - L.tl.PADT, k }, 520);
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
      flyTo(VM, { x: r.w / 2 - (g.x + g.w / 2) * k, y: mapCamY(L.rowY[fi] + L.ROW / 2, r.h / 2, k), k }, 620);
    } else zoomInto(ref, true);
  }

  // ══ legend ══════════════════════════════════════════════════════════════════════════════════════
  function legendHTML() {
    const sv = (inner, w, h) => '<svg width="' + (w || 26) + '" height="' + (h || 18) + '" viewBox="0 0 ' + (w || 26) + ' ' + (h || 18) + '" aria-hidden="true">' + inner + '</svg>';
    const row = (icon, text) => '<div class="ok-lg-row">' + icon + '<span>' + text + '</span></div>';
    return '<section class="ok-lg-sec"><h3>Columns map</h3>' +
      row(sv('<rect x="5" y="1" width="16" height="16" rx="2.5" fill="var(--ok-fair)" opacity=".5"/><rect x="5" y="1" width="2.5" height="16" fill="var(--ok-fair)"/><path d="M5 5.5h16M5 9.5h16M5 13.5h16" stroke="var(--ok-paper-hi)" stroke-width="1.2"/>'), 'Opening zoom: each module is a heat bar in its band for the current lens, one segment per feature; a domain column is a stack of them, so its height is its size.') +
      row(sv('<rect x="3" y="1" width="20" height="16" rx="2.5" fill="var(--ok-paper-hi)" stroke="var(--ok-rule)"/><circle cx="8" cy="6" r="2" fill="var(--ok-good)"/><circle cx="8" cy="11" r="2" fill="var(--ok-poor)"/><path d="M12 6h8" stroke="var(--ok-ink-3)" stroke-width="1.4"/>'), 'Zoom in: module cards with one pip per feature, then feature rows with marks, names and scores.') +
      row(sv('<g transform="translate(9 9)">' + OK.svg.corona(BP.features.find((f) => f.status === 'live'), 6, { status: true }) + '</g><path d="M18 7h6M18 11h4" stroke="var(--ok-ink-3)" stroke-width="1.3"/>'), 'Closest zoom: every row shows the 8-lens corona, the lens headline, gates and release.') +
      row(sv('<rect x="3" y="3" width="20" height="12" rx="2" fill="none" stroke="var(--ok-na)" stroke-dasharray="3 2"/><path d="M6 15l9-12M11 15l9-12M16 15l6-8" stroke="var(--ok-na)" stroke-width=".9" opacity=".7"/>'), '<b>Hatched and dashed</b>: the lens does not apply (n/a), for example Operations on a feature that is not live yet.') +
      row(sv('<path d="M2 5h8v8h10" fill="none" stroke="var(--ok-ink)" stroke-width="1.6"/><path d="M24 13l-4-2.4v4.8z" fill="var(--ok-ink)"/>'), 'Selected feature: solid lines to what it depends on, dashed lines from what depends on it.') +
      '</section><section class="ok-lg-sec"><h3>Release stack</h3>' +
      row(sv('<rect x="2" y="3" width="22" height="5" rx="1.5" fill="var(--ok-good)" opacity=".86"/><rect x="2" y="10" width="22" height="5" rx="1.5" fill="var(--ok-paper-hi)" stroke="var(--ok-good)"/>'), 'Each item is a chip in its domain column: filled when new, outlined when improved or fixed.') +
      row(sv('<path d="M1 9h24" stroke="var(--ok-ink)" stroke-width="1.4"/><rect x="5" y="5" width="16" height="8" rx="4" fill="var(--ok-ink)"/>'), 'Today. Time runs down: shipped releases above, the next release and the future below.') +
      row(sv('<rect x="3" y="2" width="20" height="4" rx="1.2" fill="var(--ok-good)"/><rect x="3" y="7" width="20" height="4" rx="1.2" fill="var(--ok-fair)"/><text x="13" y="17.5" font-size="6.5" text-anchor="middle" fill="var(--ok-ink-3)" font-family="DM Mono, monospace">2</text>'), 'At rest each release names its biggest items and counts each domain\'s items; the next release also names what is at risk.') +
      row(sv('<g transform="translate(6 9)">' + OK.svg.status('ready', 4.5) + '</g><g transform="translate(19 9)">' + OK.svg.status('building', 4.5) + '</g>'), 'Next release items show readiness: ready, in build or blocked.') +
      row(sv('<rect x="2" y="3" width="22" height="12" rx="2.5" fill="none" stroke="var(--ok-ink-3)" stroke-dasharray="4 3"/>'), 'Dashed bands are future releases.') +
      '</section><section class="ok-lg-sec"><h3>Navigate</h3><p class="ok-lg-note">Scroll or pinch to zoom, drag to pan. Double-click a domain, module or release to zoom into it. Click the product header for the whole product.</p></section>';
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
  let needOrigin = true;
  function onStage(w, h, force) {
    if (w < 10 || h < 10) return;
    stageW = w; stageH = h;
    needOrigin = true;
    const keepCenter = L && !force ? { wx: (w / 2 - cam.x) / cam.k, wyM: (h / 2 - cam.y.map) / cam.k, wyT: (h / 2 - cam.y.timeline) / cam.k, k: cam.k } : null;
    sizeCanvas(VM, w, h); sizeCanvas(VT, w, h);
    readPanel();
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
  shell.on('select', (p) => {
    VM.dirty = VT.dirty = true;
    // selections made by kit chrome (inspector rows, search results, the feature page) are brought into view;
    // the page's own clicks already are
    if (p && p.source && p.source !== 'variant' && L) {
      if (p.type === 'feature' && S.view === 'map') pendingReveal = { v: VM, fi: fIdx.get(p.id), far: true };
      else if (p.type === 'release' && S.view === 'timeline') pendingBand = p.id;
    }
    schedule();
  });
  shell.on('locate', (ref) => locate(ref));
  shell.on('theme', () => { readPalette(); VM.dirty = VT.dirty = true; schedule(); });
  // the free area beside the inspector from the kit's layout-free hint (no layout read in the handler)
  shell.on('inspector', () => { lastFree = shell.freeRectHint(); });
  shell.on('feature-close', () => { VM.dirty = VT.dirty = true; schedule(); });
  shell.on('view', (p) => {
    hideTip(VM); hideTip(VT);
    needOrigin = true; // the view just shown is measured in the next frame (pointer handlers never read layout)
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
  window.DC = { geom: () => ({ k: cam.k, kf: L.kf, heads: L.heads.mode, headPx: headPx(cam.k), headShift: headShift(cam.k), level: lodOf(cam.k).level }), bench: (n) => { const t0 = performance.now(); for (let i = 0; i < (n || 20); i++) { if (S.view === 'map') drawMap(performance.now()); else drawTimeline(performance.now()); } return (performance.now() - t0) / (n || 20); }, shell, cam, get L() { return L; }, zoomInto, zoomToLevel, zoomToBand, fitView: () => fitView(active(), false), VM, VT, hitMap, lodOf: () => lodOf(cam.k), setK: (k, sx, sy) => zoomAt(active(), sx == null ? active().w / 2 : sx, sy == null ? active().h / 2 : sy, k, false), focusFeature: (id, k) => { const fi = fIdx.get(id); const g = L.fMod[fi]; const kk = k || L.th.l3 * 1.3; setCam(VM, VM.w / 2 - (g.x + g.w / 2) * kk, mapCamY(L.rowY[fi] + L.ROW / 2, VM.h / 2, kk), kk); } };
})();
