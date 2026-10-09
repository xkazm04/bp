/* Orbit Atlas (round 2, variant C): Atlas's left-to-right card tree in the Orbit identity, plus release swimlanes.

   PLAN
   ────
   Layout (computed once per stage size class, then fixed; lens, filters, search, initiative, gates and selection never
   move or re-sort anything; only the user's own collapse and expand folds a branch and closes the gap)
   - A tidy tree read left to right: the product dial › 5 areas › 17 domains › 54 modules › feature cards.
   - World units: a feature card is 200 × 44 with 10-unit gutters. Each module owns a block of card rows; its features
     fill the rows in display order (never by lens). Rows are balanced (13 at a wrap of 9 is 7 + 6, never 9 + 4).
   - Modules stack inside their domain (14-unit gap), domains inside their area (34), and every area starts with a
     118-unit header gap that carries its engraved title and tick rule.
   - Columns: dial (diameter RD) › root trunk › area trunk › domain plates (DW) › domain trunk › module cards (MW) ›
     module trunk › feature columns. The dial sits on the vertical middle of the tree.
   - Size class: the wrap (3…13 cards per row) that gives the largest fit scale for the stage wins. Spare width (a wide
     screen is height-limited) widens the dial, the domain plates and the module cards; on tablets and desktops the
     domain plate is widened until a domain plaque (ring, name, counters) fits inside it at the opening fit. The class
     key is the wrap plus the column widths; a resize inside the same class only refits the camera.
   - Connectors are Orbit hairline elbows with rounded corners and junction dots, thinning by level
     (1.5 › 1.2 › 0.9 › 0.65 px) and fading from ink-2 to ink-4.

   Levels of detail (one continuous zoom, k = screen px per world unit, kFit = the opening fit; all ramps cross-fade)
   - L0 (k < t1 = max(1.4·kFit, 0.33)): the dial with eight lens gauges, area titles, domain plaques (band ring with the
     score, name, attention and gate counters), modules as compact band pills, and features as a soft band texture
     with attention asterisks. This is the opening state and the thumbnail.
   - L1 (k ≥ t1): module cards uncover (band glyph, name, score, counters). Domain plates grow a status bar and, when tall,
     a per-lens table.
   - L2 (k ≥ t2 = max(2.1·kFit, 0.46)): feature cards collapse to chips: a status mark (form = lifecycle, colour = band)
     and the name where the chip has room.
   - L3 (k ≥ t3 = max(1.85·t2, 0.95)): feature cards with name, status glyph, the current-lens band glyph, score and
     headline, gate rings and the attention asterisk.
   - L4 (k ≥ t4 = max(1.9·t3, 2)): the full card: the 8-lens corona with the status inside and the current lens ticked,
     status and release, the rating headline, its key facts, and the waiting gates.
   - Card text is set in screen pixels (it never scales with the zoom); boxes are world-sized, so detail uncovers as
     a card grows, as on a map. Domain and module labels are sticky inside their boxes; when the module column is off
     screen, module tags stick to the left edge; a readout shows area › domain › module for the middle of the view.

   Rendering: one Canvas 2D for the map (only what is in view is drawn), one for the minimap (cached base image).
   Lens and filter events only refresh per-feature arrays and schedule one frame: no DOM rebuild, no layout reads.

   Atlas tools, in Orbit dress: collapse and expand per node (toggles on the tree, Space), focus a branch (F; the rest
   dims), a minimap, keyboard tree navigation (arrows: up and down along a level, left to the parent, right to the
   first child), and a gates queue that steps through features waiting for a human, longest wait first ([ and ]).

   Timeline ("Release swimlanes"): a horizontal time axis with release dates to scale, a today line, the next release
   and the future columns. The lanes are the 17 domains in the tree's order, grouped by area, with sticky lane headers.
   Each release column holds one chip per package item of that domain (new, improved, fixed), tinted by the current
   lens; the next release shows readiness by status glyph. Release headers open the kit's release inspector; chips
   peek, double-click opens the feature page; a selected feature's chips are joined by a lifeline. */
(function () {
  'use strict';
  const BP = window.BP, OK = window.OK;
  const esc = OK.esc;
  const app = document.getElementById('app');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ramp = (v, a, b) => (v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reduceMQ.matches;
  const TAU = Math.PI * 2;
  const LENS_IDS = OK.lenses().map((l) => l.id);
  const BANDS = ['good', 'fair', 'poor', 'critical', 'na'];

  // ══ shell ══════════════════════════════════════════════════════════════════════════════════════
  const shell = OK.mount({ root: app, variant: 'Orbit Atlas', legend: legendHTML });
  const S = shell.state;

  // ══ data ═══════════════════════════════════════════════════════════════════════════════════════
  const FEATS = BP.features;
  const NF = FEATS.length;
  const FIDX = new Map(FEATS.map((f, i) => [f.id, i]));
  const fGates = FEATS.map((f) => BP.gates(f));
  const fAttn = FEATS.map((f) => BP.needsAttention(f));
  const fBand = new Array(NF).fill('na');
  const fDim = new Uint8Array(NF);
  const fHit = new Uint8Array(NF);
  const fCov = new Array(NF).fill(null);

  // ── tree nodes ──
  const N = [];
  function mk(type, id, data, parent) {
    const n = { type, id, data, parent, kids: [], i: N.length, x: 0, y: 0, w: 0, h: 0, vis: 1, tx: 0, ty: 0, tw: 0, th: 0, tvis: 1, fx: 0, fy: 0, fw: 0, fh: 0, fvis: 1, depth: 0 };
    if (parent) { parent.kids.push(n); n.depth = parent.depth + 1; }
    N.push(n);
    return n;
  }
  const ROOT = mk('product', BP.product.id, BP.product, null);
  const featNode = new Array(NF);
  BP.areas.forEach((a) => {
    const an = mk('area', a.id, a, ROOT);
    BP.domainsOf(a.id).forEach((d) => {
      const dn = mk('domain', d.id, d, an);
      BP.modulesOf(d.id).forEach((m) => {
        const mn = mk('module', m.id, m, dn);
        BP.featuresOf(m.id).forEach((f) => { const fn = mk('feature', f.id, f, mn); fn.fi = FIDX.get(f.id); featNode[fn.fi] = fn; });
      });
    });
  });
  const AREAS = ROOT.kids;
  const DOMS = N.filter((n) => n.type === 'domain');
  const MODS = N.filter((n) => n.type === 'module');
  const byKey = new Map(N.map((n) => [n.type + ':' + n.id, n]));
  const nodeOf = (ref) => (!ref ? null : ref.type === 'feature' ? featNode[FIDX.get(ref.id)] : ref.type === 'product' ? ROOT : byKey.get(ref.type + ':' + ref.id) || null);
  const isAncestor = (a, n) => { for (let p = n; p; p = p.parent) if (p === a) return true; return false; };

  // ══ geometry ═══════════════════════════════════════════════════════════════════════════════════
  const G = { CW: 200, CH: 44, GX: 10, GY: 10, MG: 20, DG: 34, AG: 118, PADB: 34 };
  const collapsed = new Set();
  const L = { P: null, c: null, key: '', kFit: 0.2, t1: 0.33, t2: 0.46, t3: 0.95, t4: 2, kMin: 0.1, kMax: 5.5, bounds: { x: 0, y: 0, w: 1, h: 1 }, pad: null };

  function columns(P) {
    const g = P.g;
    const xRT = P.RD + 64 * g;
    const xA = P.RD + 140 * g;
    const xD = xA + 60 * g;
    const xDT = xD + P.DW + 36 * g;
    const xM = xD + P.DW + 72 * g;
    const xMT = xM + P.MW + 28 * g;
    const xF = xM + P.MW + 56 * g;
    return { xRT, xA, xD, xDT, xM, xMT, xF };
  }
  function measure(P) {
    const c = columns(P);
    let y = 0, cols = 0;
    BP.areas.forEach((a) => {
      y += P.AG;
      BP.domainsOf(a.id).forEach((d, di) => {
        if (di) y += G.DG;
        let h = 0;
        BP.modulesOf(d.id).forEach((m, mi) => {
          if (mi) h += G.MG;
          const n = BP.featuresOf(m.id).length;
          const rows = Math.ceil(n / P.wrap);
          cols = Math.max(cols, Math.ceil(n / rows));
          h += rows * (G.CH + G.GY) - G.GY;
        });
        y += Math.max(h, P.DMIN);
      });
    });
    return { W: c.xF + cols * (P.CW + G.GX) - G.GX, H: Math.max(y + G.PADB, P.RD + 40) };
  }
  const PLAQUE_PX = 252; // ring + name + counters on one line, the widest domain at 13 px
  // Column widths grow together from BASE to WIDE to fill a wide (height-limited) stage.
  const BASE = { RD: 560, DW: 600, MW: 300, CW: 200, g: 1 };
  const WIDE = { RD: 1500, DW: 1240, MW: 560, CW: 252, g: 1.9 };
  // Phones get taller area gaps and a minimum plate height, so the domain plaques and area titles have room at the fit.
  let PHONE = false;
  const mixP = (t, wrap) => { const P = { wrap, AG: PHONE ? 190 : 118, DMIN: PHONE ? 300 : 0 }; Object.keys(BASE).forEach((k) => { P[k] = lerp(BASE[k], WIDE[k], t); }); return P; };
  function stagePad(sw) {
    const phone = sw <= 760;
    return phone ? { l: 10, r: 10, t: 48, b: 54 } : { l: 26, r: 26, t: 58, b: 58 };
  }
  function arrange(wrap, aw, ah, phone) {
    const at = (t) => { const P = mixP(t, wrap); const m = measure(P); return { P, m }; };
    const hLimited = (r) => aw / r.m.W >= ah / r.m.H;
    let best = at(0);
    if (hLimited(best)) {
      const top = at(1);
      if (hLimited(top)) best = top;
      else {
        let lo = 0, hi = 1;
        for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (hLimited(at(mid))) lo = mid; else hi = mid; }
        best = at(lo);
      }
    }
    if (!phone) {
      for (let it = 0; it < 10; it++) {
        const k = Math.min(aw / best.m.W, ah / best.m.H);
        if (best.P.DW * k >= PLAQUE_PX) break;
        best.P.DW = (PLAQUE_PX / k) * 1.02;
        best.m = measure(best.P);
      }
    }
    best.k = Math.min(aw / best.m.W, ah / best.m.H);
    return best;
  }
  function chooseArrangement(sw, sh) {
    const pad = stagePad(sw);
    const phone = sw <= 760;
    PHONE = phone;
    const aw = Math.max(200, sw - pad.l - pad.r), ah = Math.max(200, sh - pad.t - pad.b);
    let best = null;
    [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3].forEach((wrap) => {
      const r = arrange(wrap, aw, ah, phone);
      if (!best || r.k > best.k * 1.03) best = r;
    });
    const P = best.P;
    ['RD', 'DW', 'MW', 'CW'].forEach((key) => { P[key] = Math.round(P[key] / 4) * 4; });
    P.g = Math.round(P.g * 20) / 20;
    return { P, k: best.k, pad, key: [P.wrap, P.RD, P.DW, P.MW, P.CW, P.g, P.AG, P.DMIN].join('|') };
  }

  /** Writes target boxes for every node, honouring the collapsed set. Never looks at lens or filters. */
  function layoutTree(P) {
    const c = columns(P);
    L.c = c;
    const setT = (n, x, y, w, h, vis) => { n.tx = x; n.ty = y; n.tw = w; n.th = h; n.tvis = vis; };
    const hideUnder = (n, x, y, w, h) => { n.kids.forEach((k) => { setT(k, x, y, w, h, 0); hideUnder(k, x, y, w, h); }); };
    let y = 0, maxX = c.xF;
    AREAS.forEach((an) => {
      y += P.AG;
      const top = y;
      if (collapsed.has(an)) {
        hideUnder(an, c.xD, y, Math.min(P.DW, 260), G.CH);
        y += G.CH * 2 + G.GY;
      } else {
        an.kids.forEach((dn, di) => {
          if (di) y += G.DG;
          const y0 = y;
          if (collapsed.has(dn)) {
            hideUnder(dn, c.xM, y, P.MW, G.CH);
            y += G.CH * 2 + G.GY;
          } else {
            let ch = 0;
            dn.kids.forEach((mn, mi) => { if (mi) ch += G.MG; ch += collapsed.has(mn) ? G.CH : Math.ceil(mn.kids.length / P.wrap) * (G.CH + G.GY) - G.GY; });
            y += Math.max(0, (P.DMIN - ch) / 2);
            dn.kids.forEach((mn, mi) => {
              if (mi) y += G.MG;
              const fs = mn.kids, n = fs.length;
              if (collapsed.has(mn)) {
                fs.forEach((fn) => setT(fn, c.xF, y, P.CW, G.CH, 0));
                setT(mn, c.xM, y, P.MW, G.CH, 1);
                mn.rows = 1; mn.per = n;
                y += G.CH;
                return;
              }
              const rows = Math.ceil(n / P.wrap), per = Math.ceil(n / rows);
              fs.forEach((fn, i) => {
                const r = Math.floor(i / per), col = i % per;
                fn.row = r; fn.col = col;
                setT(fn, c.xF + col * (P.CW + G.GX), y + r * (G.CH + G.GY), P.CW, G.CH, 1);
                maxX = Math.max(maxX, c.xF + (col + 1) * (P.CW + G.GX) - G.GX);
              });
              const h = rows * (G.CH + G.GY) - G.GY;
              setT(mn, c.xM, y, P.MW, h, 1);
              mn.rows = rows; mn.per = per;
              y += h;
            });
          }
          y = Math.max(y, y0 + (collapsed.has(dn) ? 0 : P.DMIN));
          setT(dn, c.xD, y0, P.DW, y - y0, 1);
        });
      }
      setT(an, c.xA - 10, top, 20, y - top, 1);
    });
    const H = y + G.PADB;
    const cy = (P.AG + y) / 2;
    setT(ROOT, 0, cy - P.RD / 2, P.RD, P.RD, 1);
    const top = Math.min(P.AG * 0.4, cy - P.RD / 2 - 20);
    L.bounds = { x: -20, y: top, w: Math.max(maxX, c.xM + P.MW + 120) + 40, h: Math.max(H, cy + P.RD / 2 + 20) - top };
  }
  function applyLayout(animate) {
    layoutTree(L.P);
    const now = performance.now();
    N.forEach((n) => {
      if (animate) { n.fx = n.x; n.fy = n.y; n.fw = n.w; n.fh = n.h; n.fvis = n.vis; }
      else { n.x = n.tx; n.y = n.ty; n.w = n.tw; n.h = n.th; n.vis = n.tvis; }
    });
    anim.layout = animate ? { t0: now, dur: 340 } : null;
    computeDeps();
    mini.dirty = true;
    requestDraw();
  }
  function stepLayout(now) {
    const a = anim.layout;
    if (!a) return false;
    const t = reduced() ? 1 : clamp((now - a.t0) / a.dur, 0, 1);
    const e = ease(t);
    N.forEach((n) => {
      n.x = lerp(n.fx, n.tx, e); n.y = lerp(n.fy, n.ty, e); n.w = lerp(n.fw, n.tw, e); n.h = lerp(n.fh, n.th, e); n.vis = lerp(n.fvis, n.tvis, e);
    });
    if (t >= 1) { anim.layout = null; computeDeps(); return false; }
    return true;
  }
  function setLOD(kFit) {
    L.kFit = kFit;
    L.t1 = Math.max(kFit * 1.4, 0.33);
    L.t2 = Math.max(kFit * 2.1, 0.46);
    L.t3 = Math.max(L.t2 * 1.85, 0.95);
    // on phones the full card has to fit the screen's width
    L.t4 = SW <= 760 ? Math.max(L.t3 * 1.65, 1.6) : Math.max(L.t3 * 1.9, 2);
    L.kMin = kFit * 0.6;
    L.kMax = Math.max(L.t4 * 2.4, 5.5);
  }
  const LEVELS = [
    { id: 0, name: 'Domains', k: () => L.kFit },
    { id: 1, name: 'Modules', k: () => L.t1 * 1.18 },
    { id: 2, name: 'Features', k: () => L.t2 * 1.2 },
    { id: 3, name: 'Cards', k: () => L.t3 * 1.12 },
    { id: 4, name: 'Detail', k: () => L.t4 * 1.15 },
  ];
  function levelOf(k) { return k >= L.t4 ? 4 : k >= L.t3 ? 3 : k >= L.t2 ? 2 : k >= L.t1 ? 1 : 0; }
  function lodAlphas(k) {
    const a1 = ramp(k, L.t1 * 0.86, L.t1 * 1.08);
    const a2 = ramp(k, L.t2 * 0.86, L.t2 * 1.08);
    const a3 = ramp(k, L.t3 * 0.88, L.t3 * 1.06);
    const a4 = ramp(k, L.t4 * 0.88, L.t4 * 1.06);
    return { a1, a2, a3, a4 };
  }

  // ══ theme tokens ═══════════════════════════════════════════════════════════════════════════════
  let C = {};
  const FONT = { label: 'Jost, sans-serif', mono: '"DM Mono", monospace' };
  const rgbaCache = new Map();
  function rgba(col, a) {
    const key = col + '|' + a;
    let v = rgbaCache.get(key);
    if (v) return v;
    let r = 0, g = 0, b = 0, a0 = 1;
    if (col[0] === '#') {
      const h = col.length === 4 ? col.slice(1).split('').map((x) => x + x).join('') : col.slice(1, 7);
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    } else {
      const m = col.match(/[\d.]+/g) || [0, 0, 0, 1];
      r = +m[0]; g = +m[1]; b = +m[2]; a0 = m[3] != null ? +m[3] : 1;
    }
    v = 'rgba(' + r + ',' + g + ',' + b + ',' + Math.round(a * a0 * 1000) / 1000 + ')';
    rgbaCache.set(key, v);
    return v;
  }
  function readTokens() {
    const cs = getComputedStyle(shell.root);
    const g = (n) => cs.getPropertyValue('--ok-' + n).trim();
    C = {
      paper: g('paper'), paperHi: g('paper-hi'), skyA: g('sky-a'), ink: g('ink'), ink2: g('ink-2'), ink3: g('ink-3'), ink4: g('ink-4'), onInk: g('on-ink'),
      rule: g('rule'), rule2: g('rule-2'), band: g('band'), bandHi: g('band-hi'), shadow: g('shadow'), glow: g('glow'),
      good: g('good'), fair: g('fair'), poor: g('poor'), critical: g('critical'), na: g('na'),
      criticalSoft: g('critical-soft'), alarm: g('alarm'), alarmSoft: g('alarm-soft'), gate: g('gate'), gateSoft: g('gate-soft'), focus: g('focus'),
      lens: {},
    };
    LENS_IDS.forEach((id) => { C.lens[id] = g('lens-' + id); });
    FONT.label = g('f-label') || FONT.label;
    FONT.mono = g('f-mono') || FONT.mono;
    C.dark = shell.isDark();
    rgbaCache.clear();
  }
  const bandCol = (b) => C[b] || C.na;

  // ══ per-feature paint state (refreshed on lens and filter events only) ═════════════════════════
  function refreshLens() {
    const lens = S.lens;
    for (let i = 0; i < NF; i++) fBand[i] = BP.rating(FEATS[i], lens).band;
  }
  function refreshFilter() {
    const dim = shell.dimmedIds(), hit = shell.hitIds();
    const ini = S.initiative;
    for (let i = 0; i < NF; i++) {
      const id = FEATS[i].id;
      fDim[i] = dim.has(id) ? 1 : 0;
      fHit[i] = hit.has(id) ? 1 : 0;
      fCov[i] = ini ? BP.initiativeState(FEATS[i], ini) : null;
    }
  }

  // ══ DOM for the map ════════════════════════════════════════════════════════════════════════════
  const I = (name, px) => OK.svg.icon(name, px);
  shell.mapEl.innerHTML =
    '<div class="ca-map">' +
      '<canvas class="ca-cv" tabindex="0" role="application" aria-roledescription="product map" aria-label="Product map: a tree of areas, domains, modules and features" aria-describedby="ca-help"></canvas>' +
      '<p id="ca-help" class="ok-vh">Arrow keys move through the tree: up and down along a level, left to the parent, right to the first child. Enter opens the selection, Space folds or unfolds a branch, F focuses a branch, plus and minus zoom, 0 fits the whole product, and the square brackets step through the gates queue.</p>' +
      '<div class="ca-hud ca-hud--tl"><div class="ca-q ok-panel" role="group" aria-label="Gates queue"></div><div class="ca-node" hidden></div></div>' +
      '<div class="ca-hud ca-hud--bl"><div class="ca-loc" aria-live="off"><span class="ca-loc__lvl"></span><span class="ca-loc__path"></span></div></div>' +
      '<div class="ca-hud ca-hud--br">' +
        '<div class="ca-mini ok-panel is-off"><canvas class="ca-mini__cv" aria-label="Minimap: drag to move the view" role="img"></canvas></div>' +
        '<div class="ca-zoom ok-panel" role="group" aria-label="Zoom">' +
          '<button type="button" class="ca-zbtn" data-z="out" aria-label="Zoom out" title="Zoom out (−)"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>' +
          '<div class="ca-lvls" role="group" aria-label="Zoom level">' + LEVELS.map((l) => '<button type="button" class="ca-lvl" data-lvl="' + l.id + '" title="Zoom to ' + l.name.toLowerCase() + '" aria-label="Zoom to ' + l.name.toLowerCase() + '"><i></i></button>').join('') + '</div>' +
          '<button type="button" class="ca-zbtn" data-z="in" aria-label="Zoom in" title="Zoom in (+)"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>' +
          '<button type="button" class="ca-zbtn ca-zbtn--fit" data-z="fit" title="Fit the whole product (0)">Fit</button>' +
        '</div>' +
      '</div>' +
      '<div class="ca-tip ok-panel" role="tooltip" hidden></div>' +
    '</div>';
  const M = {
    root: shell.mapEl.querySelector('.ca-map'),
    cv: shell.mapEl.querySelector('.ca-cv'),
    node: shell.mapEl.querySelector('.ca-node'),
    q: shell.mapEl.querySelector('.ca-q'),
    loc: shell.mapEl.querySelector('.ca-loc'),
    locLvl: shell.mapEl.querySelector('.ca-loc__lvl'),
    locPath: shell.mapEl.querySelector('.ca-loc__path'),
    lvls: Array.from(shell.mapEl.querySelectorAll('.ca-lvl')),
    tip: shell.mapEl.querySelector('.ca-tip'),
    mini: shell.mapEl.querySelector('.ca-mini'),
    miniCv: shell.mapEl.querySelector('.ca-mini__cv'),
  };
  const ctx = M.cv.getContext('2d');
  let SW = 0, SH = 0, DPR = 1;
  let freeR = { x: 0, y: 0, w: 0, h: 0 };
  const cam = { k: 0.2, tx: 0, ty: 0 };
  const anim = { cam: null, layout: null, pulse: null };
  let atFit = true;
  let ready = false;

  // ══ text ═══════════════════════════════════════════════════════════════════════════════════════
  const twCache = new Map();
  const font = (w, px, mono) => w + ' ' + (Math.round(px * 2) / 2) + 'px ' + (mono ? FONT.mono : FONT.label);
  let curFont = '', curLS = '0px';
  function setFont(f, ls) {
    if (f !== curFont) { ctx.font = f; curFont = f; }
    const l = ls || '0px';
    if (l !== curLS) { ctx.letterSpacing = l; curLS = l; }
  }
  function tw(text, f, ls) {
    const key = f + '|' + (ls || '') + '|' + text;
    let w = twCache.get(key);
    if (w == null) {
      setFont(f, ls);
      w = ctx.measureText(text).width;
      if (twCache.size > 30000) twCache.clear();
      twCache.set(key, w);
    }
    return w;
  }
  const fitCache = new Map();
  function fitText(text, f, maxW, ls) {
    if (maxW < 8) return '';
    if (tw(text, f, ls) <= maxW) return text;
    const q = Math.floor(maxW / 3) * 3;
    const key = f + '|' + (ls || '') + '|' + q + '|' + text;
    let v = fitCache.get(key);
    if (v != null) return v;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tw(text.slice(0, mid).replace(/[\s·,&-]+$/, '') + '…', f, ls) <= q) lo = mid; else hi = mid - 1;
    }
    v = lo > 1 ? text.slice(0, lo).replace(/[\s·,&-]+$/, '') + '…' : '';
    if (fitCache.size > 20000) fitCache.clear();
    fitCache.set(key, v);
    return v;
  }
  function text(str, x, y, f, col, align, ls) {
    setFont(f, ls);
    ctx.fillStyle = col;
    ctx.textAlign = align || 'left';
    ctx.fillText(str, x, y);
  }

  // ══ glyphs (canvas twins of the kit's OK.svg primitives) ════════════════════════════════════════
  const swOf = (r) => clamp(r * 0.22, 1.1, 2.2);
  function astroidPath(x, y, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, rr = i % 2 ? r : R;
      const px = x + rr * Math.sin(a), py = y - rr * Math.cos(a);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU); }
  /** Status form; `col` replaces the ink (map marks are coloured by band), `bg` fills rings. */
  function gStatus(status, x, y, r, col, bg) {
    const w = swOf(r);
    ctx.setLineDash([]);
    if (status === 'live') { circle(x, y, r); ctx.fillStyle = col; ctx.fill(); return; }
    if (status === 'blocked') { astroidPath(x, y, r * 1.5, r * 0.42); ctx.fillStyle = C.alarm; ctx.fill(); return; }
    circle(x, y, r - w / 2);
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = w; ctx.strokeStyle = col;
    if (status === 'planned') ctx.setLineDash([r * 0.22, r * 0.36]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (status === 'ready') { circle(x, y, r * 0.36); ctx.fillStyle = col; ctx.fill(); }
    else if (status === 'building') { const rr = r - w / 2; ctx.beginPath(); ctx.moveTo(x, y - rr); ctx.arc(x, y, rr, -Math.PI / 2, Math.PI / 2, true); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); }
  }
  function pie(x, y, r, frac) { ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * frac); ctx.closePath(); }
  function gBand(band, x, y, r) {
    const w = swOf(r);
    ctx.setLineDash([]);
    if (band === 'good') { circle(x, y, r); ctx.fillStyle = C.good; ctx.fill(); return; }
    if (band === 'fair' || band === 'poor') {
      circle(x, y, r - 0.5); ctx.fillStyle = C.paperHi; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C.rule; ctx.stroke();
      pie(x, y, r, band === 'fair' ? 0.75 : 0.5); ctx.fillStyle = C[band]; ctx.fill();
      return;
    }
    if (band === 'critical') {
      circle(x, y, r - w / 2); ctx.fillStyle = C.criticalSoft; ctx.fill(); ctx.lineWidth = w; ctx.strokeStyle = C.critical; ctx.stroke();
      const k = r * 0.36;
      ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
      ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
      return;
    }
    circle(x, y, r - w / 2); ctx.lineWidth = w; ctx.strokeStyle = C.na; ctx.setLineDash([r * 0.42, r * 0.32]); ctx.stroke(); ctx.setLineDash([]);
  }
  function gGate(kind, x, y, r) {
    const w = swOf(r);
    const col = kind === 'changes' ? C.alarm : C.gate;
    circle(x, y, r - w / 2);
    ctx.lineWidth = w; ctx.strokeStyle = col;
    if (kind === 'triage') ctx.setLineDash([r * 0.42, r * 0.3]);
    ctx.stroke(); ctx.setLineDash([]);
    circle(x, y, r * 0.34); ctx.fillStyle = col; ctx.fill();
  }
  function gAttn(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.moveTo(x + r * 0.18 * Math.sin(a), y - r * 0.18 * Math.cos(a));
      ctx.lineTo(x + r * 0.98 * Math.sin(a), y - r * 0.98 * Math.cos(a));
    }
    ctx.lineWidth = clamp(r * 0.26, 1.3, 2.4); ctx.lineCap = 'round'; ctx.strokeStyle = C.alarm; ctx.stroke(); ctx.lineCap = 'butt';
  }
  function gCorona(f, x, y, r, w, lens) {
    circle(x, y, r); ctx.lineWidth = w; ctx.strokeStyle = C.rule2; ctx.stroke();
    const gap = 7;
    LENS_IDS.forEach((l, i) => {
      const band = BP.rating(f, l).band;
      const d0 = i * 45 + gap / 2, d1 = (i + 1) * 45 - gap / 2;
      ctx.beginPath(); ctx.arc(x, y, r, ((d0 - 90) * Math.PI) / 180, ((d1 - 90) * Math.PI) / 180);
      ctx.lineWidth = band === 'na' ? w * 0.5 : w; ctx.strokeStyle = band === 'na' ? C.ink4 : C[band]; ctx.stroke();
      if (lens === l) {
        const a = ((i * 45 + 22.5 - 90) * Math.PI) / 180, r0 = r + w * 0.9, r1 = r0 + Math.max(3, r * 0.28);
        ctx.beginPath(); ctx.moveTo(x + r0 * Math.cos(a), y + r0 * Math.sin(a)); ctx.lineTo(x + r1 * Math.cos(a), y + r1 * Math.sin(a));
        ctx.lineWidth = Math.max(1.2, w * 0.45); ctx.lineCap = 'round'; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.lineCap = 'butt';
      }
    });
    gStatus(f.status, x, y, r * 0.42, C.ink, C.paperHi);
  }
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  }
  /** A gauge ring: the track, then the score arc from the top in band colour, n/a dashed. */
  function gRing(rating, x, y, d, lw) {
    const r = d / 2 - lw / 2;
    circle(x, y, r); ctx.lineWidth = lw; ctx.strokeStyle = C.rule;
    if (rating.band === 'na') { ctx.setLineDash([2.5, 2.5]); ctx.strokeStyle = C.na; ctx.stroke(); ctx.setLineDash([]); return; }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(rating.score || 0, 0.02, 1));
    ctx.strokeStyle = C[rating.band]; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
  }
  const scoreTxt = (r) => (r.band === 'na' ? 'n/a' : OK.fmt.score(r.score));
  const gateTotal = (g) => (g.triage || 0) + (g.approval || 0) + (g.changes || 0);

  // ══ selection, focus, cursor ═══════════════════════════════════════════════════════════════════
  let selNode = null, hoverNode = null, cursorNode = null, kbdActive = false, focusNode = null, productOpen = false;
  let deps = []; // [{ pts: [[x,y]...], kind: 'dep'|'dent', other }]
  function nodeAlpha(n) {
    let a = n.vis;
    if (focusNode && n !== ROOT && !isAncestor(focusNode, n) && !isAncestor(n, focusNode)) a *= 0.14;
    return a;
  }
  function inFocusFeature(fn) { return !focusNode || isAncestor(focusNode, fn); }

  // ══ dependency routes: orthogonal, through the row gutters and the column gaps ═════════════════
  function computeDeps() {
    deps = [];
    if (!selNode || selNode.type !== 'feature' || selNode.tvis < 0.5) return;
    const S0 = selNode;
    const f = S0.data;
    const add = (from, to, kind, idx) => {
      if (!to || to.tvis < 0.5 || !from || from.tvis < 0.5) return;
      deps.push({ pts: route(from, to, idx), kind, other: kind === 'dep' ? to : from });
    };
    BP.dependencies(f).forEach((d, i) => add(S0, featNode[FIDX.get(d.id)], 'dep', i));
    BP.dependents(f).forEach((d, i) => add(featNode[FIDX.get(d.id)], S0, 'dent', i + 3));
  }
  function route(a, b, idx) {
    const off = ((idx % 5) - 2) * 1.6;
    const ax = a.tx + a.tw / 2 + off, bx = b.tx + b.tw / 2 + off;
    const down = b.ty > a.ty + 1, same = Math.abs(b.ty - a.ty) < 1;
    const ya0 = down ? a.ty + a.th : a.ty;
    const yaG = down ? a.ty + a.th + G.GY / 2 + off * 0.5 : a.ty - G.GY / 2 + off * 0.5;
    const yb0 = down || same ? b.ty : b.ty + b.th;
    const ybG = down ? b.ty - G.GY / 2 + off * 0.5 : same ? yaG : b.ty + b.th + G.GY / 2 + off * 0.5;
    if (same) return [[ax, ya0], [ax, yaG], [bx, yaG], [bx, yb0]];
    // vertical channel: the column gap beside the target, on the side facing the source
    const xc = (bx < ax ? b.tx + b.tw + G.GX / 2 : b.tx - G.GX / 2) + off;
    return [[ax, ya0], [ax, yaG], [xc, yaG], [xc, ybG], [bx, ybG], [bx, yb0]];
  }

  // ══ camera ═════════════════════════════════════════════════════════════════════════════════════
  const toSX = (x) => x * cam.k + cam.tx;
  const toSY = (y) => y * cam.k + cam.ty;
  const toWX = (x) => (x - cam.tx) / cam.k;
  const toWY = (y) => (y - cam.ty) / cam.k;
  function fitCam(box, rect, pad, maxK) {
    const p = pad || { l: 0, r: 0, t: 0, b: 0 };
    const aw = Math.max(40, rect.w - p.l - p.r), ah = Math.max(40, rect.h - p.t - p.b);
    const k = clamp(Math.min(aw / box.w, ah / box.h), L.kMin, maxK || L.kMax);
    return { k, tx: rect.x + p.l + (aw - box.w * k) / 2 - box.x * k, ty: rect.y + p.t + (ah - box.h * k) / 2 - box.y * k };
  }
  function clampCam(c) {
    const b = L.bounds;
    const minVis = 0.25;
    const bw = b.w * c.k, bh = b.h * c.k;
    const lo = (span, view) => -span + Math.min(span, view) * minVis;
    const sx = b.x * c.k + c.tx, sy = b.y * c.k + c.ty;
    const nx = clamp(sx, lo(bw, SW), SW - Math.min(bw, SW) * minVis);
    const ny = clamp(sy, lo(bh, SH), SH - Math.min(bh, SH) * minVis);
    c.tx += nx - sx; c.ty += ny - sy;
    return c;
  }
  function setCam(c) { cam.k = c.k; cam.tx = c.tx; cam.ty = c.ty; requestDraw(); }
  function flyTo(to, ms) {
    clampCam(to);
    if (reduced() || ms === 0) { anim.cam = null; setCam(to); return; }
    anim.cam = { from: { k: cam.k, tx: cam.tx, ty: cam.ty }, to, t0: performance.now(), dur: ms || 520 };
    requestDraw();
  }
  function stepCam(now) {
    const a = anim.cam;
    if (!a) return false;
    const t = clamp((now - a.t0) / a.dur, 0, 1), e = ease(t);
    // zoom in log space, keep the screen path smooth
    const k = Math.exp(lerp(Math.log(a.from.k), Math.log(a.to.k), e));
    const wcx0 = (SW / 2 - a.from.tx) / a.from.k, wcy0 = (SH / 2 - a.from.ty) / a.from.k;
    const wcx1 = (SW / 2 - a.to.tx) / a.to.k, wcy1 = (SH / 2 - a.to.ty) / a.to.k;
    const wcx = lerp(wcx0, wcx1, e), wcy = lerp(wcy0, wcy1, e);
    cam.k = k; cam.tx = SW / 2 - wcx * k; cam.ty = SH / 2 - wcy * k;
    if (t >= 1) { cam.k = a.to.k; cam.tx = a.to.tx; cam.ty = a.to.ty; anim.cam = null; return false; }
    return true;
  }
  function fitPad() { return SW <= 760 ? L.pad : { l: L.pad.l, r: L.pad.r, t: L.pad.t, b: L.pad.b }; }
  function fitAll(ms) {
    const r = { x: 0, y: 0, w: SW, h: SH };
    flyTo(fitCam(L.bounds, r, fitPad()), ms);
    atFit = true;
  }
  function zoomAt(px, py, factor, ms) {
    const k = clamp(cam.k * factor, L.kMin, L.kMax);
    const wx = toWX(px), wy = toWY(py);
    const to = { k, tx: px - wx * k, ty: py - wy * k };
    atFit = false;
    if (ms) flyTo(to, ms); else { anim.cam = null; setCam(clampCam(to)); }
  }
  function zoomToK(k, ms) {
    const r = freeRect();
    k = snapK(clamp(k, L.kMin, L.kMax));
    zoomAt(r.x + r.w / 2, r.y + r.h / 2, k / cam.k, ms == null ? 420 : ms);
  }
  function freeRect() { return freeR.w ? freeR : { x: 0, y: 0, w: SW, h: SH }; }
  function subtreeBox(n) {
    let x0 = n.tx, y0 = n.ty, x1 = n.tx + n.tw, y1 = n.ty + n.th;
    const walk = (m) => m.kids.forEach((k) => { if (k.tvis > 0.5) { x0 = Math.min(x0, k.tx); y0 = Math.min(y0, k.ty); x1 = Math.max(x1, k.tx + k.tw); y1 = Math.max(y1, k.ty + k.th); walk(k); } });
    walk(n);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function flyToBox(b, maxK, ms) {
    const r = freeRect();
    const pad = SW <= 760 ? { l: 12, r: 12, t: 20, b: 56 } : { l: 40, r: 40, t: 56, b: 70 };
    atFit = false;
    flyTo(fitCam(b, r, pad, maxK), ms);
  }
  /** Brings a node into the free view at a useful zoom: features at card level, nodes fitted with their branch. */
  /** The part of the free view that is not under the HUD rows (top: gates queue; bottom: readout and zoom). */
  function viewRect() {
    const r = freeRect();
    const top = 52, bot = SW <= 760 ? (shell.inspector.isOpen() ? 6 : 58) : 56;
    return { x: r.x, y: r.y + top, w: r.w, h: Math.max(80, r.h - top - bot) };
  }
  /** Moves a zoom target out of a cross-fade band, so the map never rests between two layers. */
  function snapK(k) {
    const bands = [[L.t1 * 0.86, L.t1 * 1.08], [L.t2 * 0.86, L.t2 * 1.08], [L.t3 * 0.88, L.t3 * 1.06], [L.t4 * 0.88, L.t4 * 1.06]];
    for (const [a, b] of bands) if (k > a && k < b) return (k - a) / (b - a) < 0.4 ? a * 0.995 : b * 1.005;
    return k;
  }
  function flyToNode(n, opts) {
    const o = opts || {};
    if (!n) return;
    const r = viewRect();
    if (n.type === 'feature') {
      const k0 = Math.max(cam.k, o.k || L.t3 * 1.12);
      // the card must fit the view's width (phones)
      const kk = snapK(clamp(Math.min(k0, (r.w * 0.86) / L.P.CW), L.kMin, L.kMax));
      const cx = n.tx + n.tw / 2, cy = n.ty + n.th / 2;
      atFit = false;
      flyTo({ k: kk, tx: r.x + r.w / 2 - cx * kk, ty: r.y + r.h / 2 - cy * kk }, o.ms);
    } else if (n.type === 'product') fitAll(o.ms);
    else {
      // a branch: fit its height at a level that reads; the parent's sticky label stays at the left edge
      const sb = subtreeBox(n);
      const cap = n.type === 'area' ? L.t2 * 0.95 : n.type === 'domain' ? L.t3 * 0.9 : L.t3 * 1.12;
      let k = Math.min((r.h - 40) / Math.max(sb.h, 1), o.maxK || cap);
      // a module shows its whole block of feature rows, at chip level at least
      if (n.type === 'module') k = Math.max(Math.min(k, (r.w - 60) / Math.max(sb.w + 80, 1)), L.t2 * 1.12);
      k = snapK(clamp(k, L.kMin, L.kMax));
      const x0 = n.type === 'area' ? L.c.xA - 50 / k : n.type === 'domain' ? Math.max(n.tx - 30 / k, L.c.xM - Math.min(SW <= 760 ? 150 : 300, r.w * 0.42) / k) : n.tx - (SW <= 760 ? 10 : 60) / k;
      const spanW = (sb.x + sb.w - x0) * k;
      const tx = spanW < r.w - 40 ? r.x + (r.w - spanW) / 2 - x0 * k : r.x + 16 - x0 * k;
      atFit = false;
      flyTo({ k, tx, ty: r.y + r.h / 2 - (sb.y + sb.h / 2) * k }, o.ms);
    }
    pulse(n);
  }
  function pulse(n) { anim.pulse = { n, t0: performance.now() }; requestDraw(); }
  function ensureVisible(n) {
    // unfold collapsed ancestors so a located node is on the map
    let changed = false;
    for (let p = n.parent; p; p = p.parent) if (collapsed.has(p)) { collapsed.delete(p); changed = true; }
    if (changed) { applyLayout(false); syncNodeBar(); }
  }
  function revealSelection() {
    // after the inspector opens, pan the selected feature out from under it
    if (!selNode || selNode.type !== 'feature' || !ready) return;
    const r = freeRect();
    const x0 = toSX(selNode.x), y0 = toSY(selNode.y), x1 = toSX(selNode.x + selNode.w), y1 = toSY(selNode.y + selNode.h);
    let dx = 0, dy = 0;
    const m = 16;
    if (x1 > r.x + r.w - m) dx = r.x + r.w - m - x1;
    if (x0 + dx < r.x + m) dx = r.x + m - x0;
    if (y1 > r.y + r.h - m) dy = r.y + r.h - m - y1;
    if (y0 + dy < r.y + m) dy = r.y + m - y0;
    if (dx || dy) { atFit = false; flyTo({ k: cam.k, tx: cam.tx + dx, ty: cam.ty + dy }, 360); }
  }

  // ══ frame loop ═════════════════════════════════════════════════════════════════════════════════
  let rafId = 0;
  function requestDraw() { if (!rafId) rafId = requestAnimationFrame(frame); }
  function frame(now) {
    rafId = 0;
    if (!ready || !SW || S.view !== 'map') return;
    const a = stepCam(now);
    const b = stepLayout(now);
    let c = false;
    if (anim.pulse) { if (now - anim.pulse.t0 > 1300) anim.pulse = null; else c = true; }
    draw(now);
    drawMini();
    syncHUD();
    if (a || b || c) requestDraw();
  }

  // ══ drawing ════════════════════════════════════════════════════════════════════════════════════
  let toggles = []; // screen hit targets for fold toggles, rebuilt each frame
  let VX0 = 0, VY0 = 0, VX1 = 0, VY1 = 0; // view in world units
  function draw(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, SW, SH);
    curFont = ''; curLS = '';
    setFont(font(400, 12), '0px');
    ctx.textBaseline = 'alphabetic';
    VX0 = toWX(0); VY0 = toWY(0); VX1 = toWX(SW); VY1 = toWY(SH);
    toggles = [];
    const k = cam.k;
    const A = lodAlphas(k);
    drawAreaHeaders(A);
    drawConnectors(A);
    drawDial();
    DOMS.forEach((dn) => drawDomain(dn, A));
    MODS.forEach((mn) => drawModule(mn, A));
    drawFeatures(A);
    drawFolded(A);
    drawDeps();
    drawMarks(A, now);
    if (plaqueQueue.length) { overlayPass = true; plaqueQueue.splice(0).forEach((dn) => drawDomain(dn, A)); overlayPass = false; }
    drawEdgeTags(A);
  }
  const inView = (x, y, w, h, m) => x + w >= VX0 - (m || 0) && x <= VX1 + (m || 0) && y + h >= VY0 - (m || 0) && y <= VY1 + (m || 0);

  // ── area titles: engraved caps on a tick rule ──
  function drawAreaHeaders() {
    const k = cam.k;
    const phone = SW <= 760;
    AREAS.forEach((an) => {
      const a = nodeAlpha(an);
      if (a < 0.02) return;
      const gapPx = L.P.AG * k;
      const yb = toSY(an.y) - clamp(gapPx * 0.36, 5, 22);
      if (yb < -20 || yb > SH + 20) return;
      const x0 = toSX(L.c.xA) - 6;
      ctx.globalAlpha = a;
      const fs = clamp(gapPx * 0.5, phone ? 9.5 : 10, 13);
      const f = font(500, fs);
      const ls = (fs * 0.2).toFixed(1) + 'px';
      const name = an.data.name.toUpperCase();
      text(name, x0, yb, f, C.ink, 'left', ls);
      let x = x0 + tw(name, f, ls) + 10;
      const rt = BP.areaRating(an.id, S.lens);
      const gr = clamp(fs * 0.42, 4, 5.5);
      gBand(rt.band, x + gr, yb - fs * 0.34, gr);
      x += gr * 2 + 5;
      const sf = font(400, fs * 0.95, true);
      text(scoreTxt(rt), x, yb, sf, C.ink, 'left');
      x += tw(scoreTxt(rt), sf) + 9;
      const roll = BP.areaRollup(an.id);
      if (!phone || gapPx > 16) {
        const cf = font(400, fs * 0.88, true);
        const t = roll.count + ' features';
        text(t, x, yb, cf, C.ink3, 'left');
        x += tw(t, cf) + 12;
      }
      // tick rule to the end of the area's cards
      const xEnd = toSX(Math.max(L.c.xF + L.P.CW * 2, maxRowX(an)));
      if (xEnd > x + 20) {
        const yr = yb - fs * 0.32;
        ctx.beginPath(); ctx.moveTo(x, yr); ctx.lineTo(xEnd, yr);
        ctx.lineWidth = 1; ctx.strokeStyle = C.rule; ctx.stroke();
        const step = clamp(160 * k, 10, 28);
        ctx.beginPath();
        for (let tx = xEnd; tx > x + 4; tx -= step) { ctx.moveTo(Math.round(tx) + 0.5, yr); ctx.lineTo(Math.round(tx) + 0.5, yr + 3.5); }
        ctx.strokeStyle = C.rule; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  }
  const maxRowCache = new Map();
  function maxRowX(an) {
    let v = maxRowCache.get(an);
    if (v == null) {
      v = 0;
      an.kids.forEach((dn) => dn.kids.forEach((mn) => mn.kids.forEach((fn) => { if (fn.tvis > 0.5) v = Math.max(v, fn.tx + fn.tw); })));
      maxRowCache.set(an, v);
    }
    return v;
  }

  // ── hairline elbow connectors, thinning by level ──
  function elbowTo(x0, y0, x1, y1, r) {
    // from a trunk point (x0, y0) vertically to y1, then right to x1
    if (Math.abs(y1 - y0) < 0.6) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); return; }
    const rr = Math.min(r, Math.abs(y1 - y0), Math.abs(x1 - x0) / 2);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1 - Math.sign(y1 - y0) * rr);
    ctx.quadraticCurveTo(x0, y1, x0 + rr, y1);
    ctx.lineTo(x1, y1);
  }
  function drawConnectors() {
    const c = L.c;
    const k = cam.k;
    const level = (parentX, parentY, trunkX, kids, kidX, width, col, dotR) => {
      if (!kids.length) return;
      const tx = toSX(trunkX), py = toSY(parentY);
      ctx.beginPath();
      ctx.moveTo(toSX(parentX), py); ctx.lineTo(tx, py);
      kids.forEach((kd) => elbowTo(tx, py, toSX(kidX(kd)), toSY(kd.y), clamp(18 * k, 3, 9)));
      ctx.lineWidth = width; ctx.strokeStyle = col; ctx.stroke();
      circle(tx, py, dotR); ctx.fillStyle = col; ctx.fill();
    };
    // root › areas
    const rootA = nodeAlpha(ROOT);
    ctx.globalAlpha = rootA;
    const rcx = ROOT.x + ROOT.w, rcy = ROOT.y + ROOT.h / 2;
    const areaPts = AREAS.map((an) => ({ y: areaMidY(an), a: nodeAlpha(an), an }));
    level(rcx, rcy, c.xRT, areaPts, () => c.xA, 1.5, rgba(C.ink2, 0.5), 2.2);
    // area trunks and junction rings
    AREAS.forEach((an) => {
      const a = nodeAlpha(an);
      if (a < 0.02) return;
      ctx.globalAlpha = a;
      const my = areaMidY(an);
      const kids = an.kids.filter((d) => d.vis > 0.02).map((d) => ({ y: d.y + d.h / 2 }));
      const x = toSX(c.xA);
      if (kids.length) {
        const yTop = toSY(an.y) - clamp(L.P.AG * k * 0.36, 5, 22) + 4;
        ctx.beginPath();
        ctx.moveTo(x, yTop); ctx.lineTo(x, toSY(kids[kids.length - 1].y) - clamp(18 * k, 3, 9));
        kids.forEach((kd) => { const yy = toSY(kd.y); elbowTo(x, yy - 0.01, toSX(c.xD), yy, clamp(18 * k, 3, 9)); });
        ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(C.ink3, 0.6); ctx.stroke();
        // junction ticks where each domain leaves the trunk
      }
      const rt = BP.areaRating(an.id, S.lens);
      circle(x, toSY(my), 4.6); ctx.fillStyle = C.paperHi; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = rt.band === 'na' ? C.na : C[rt.band]; ctx.stroke();
    });
    // domain › modules
    DOMS.forEach((dn) => {
      const a = nodeAlpha(dn);
      if (a < 0.02 || collapsed.has(dn)) return;
      const kids = dn.kids.filter((m) => m.vis > 0.02);
      if (!kids.length || !inView(dn.x, dn.y, c.xM - dn.x + 10, dn.h, 40)) return;
      ctx.globalAlpha = a;
      level(dn.x + dn.w, dn.y + dn.h / 2, c.xDT, kids.map((m) => ({ y: m.y + m.h / 2 })), () => c.xM, 0.9, rgba(C.ink3, 0.5), 1.7);
    });
    // module › feature rows
    MODS.forEach((mn) => {
      const a = nodeAlpha(mn);
      if (a < 0.02 || collapsed.has(mn) || mn.vis < 0.02) return;
      if (!inView(mn.x, mn.y, c.xF - mn.x + 10, mn.h, 40)) return;
      const rows = [];
      for (let r = 0; r < mn.rows; r++) { const fn = mn.kids[r * mn.per]; if (fn && fn.vis > 0.02) rows.push({ y: fn.y + fn.h / 2 }); }
      ctx.globalAlpha = a;
      level(mn.x + mn.w, mn.y + mn.h / 2, c.xMT, rows, () => c.xF, 0.65, rgba(C.ink3, 0.42), 1.3);
    });
    ctx.globalAlpha = 1;
  }
  function areaMidY(an) {
    const ks = an.kids.filter((d) => d.tvis > 0.5);
    if (!ks.length || collapsed.has(an)) return an.y + G.CH / 2;
    return (ks[0].y + ks[ks.length - 1].y + ks[ks.length - 1].h) / 2;
  }

  // ── the product dial: an Orbit instrument with eight lens gauges ──
  function drawDial() {
    const R = (ROOT.w / 2) * cam.k;
    const cx = toSX(ROOT.x + ROOT.w / 2), cy = toSY(ROOT.y + ROOT.h / 2);
    if (cx + R < -10 || cx - R > SW + 10 || cy + R < -10 || cy - R > SH + 10) return;
    ctx.globalAlpha = focusNode ? 0.5 : 1;
    const big = R > 70;
    // plate, bezel and ticks
    circle(cx, cy, R * 1.11); ctx.setLineDash([1.2, 4]); ctx.lineWidth = 1; ctx.strokeStyle = C.rule; ctx.stroke(); ctx.setLineDash([]);
    circle(cx, cy, R); ctx.fillStyle = C.paperHi; ctx.fill(); ctx.lineWidth = productOpen ? 2 : 1; ctx.strokeStyle = productOpen ? C.ink : C.rule; ctx.stroke();
    if (C.dark) { ctx.save(); ctx.shadowColor = C.glow; ctx.shadowBlur = 18; circle(cx, cy, R); ctx.strokeStyle = rgba(C.ink, 0.08); ctx.stroke(); ctx.restore(); }
    circle(cx, cy, R * 0.9); ctx.lineWidth = 1; ctx.strokeStyle = C.rule2; ctx.stroke();
    ctx.beginPath();
    const nT = R > 120 ? 120 : 72;
    for (let i = 0; i < nT; i++) {
      const a = (i / nT) * TAU, mj = i % (nT / 8) === 0;
      const r0 = R * (mj ? 0.9 : 0.935), r1 = R * 0.975;
      ctx.moveTo(cx + r0 * Math.sin(a), cy - r0 * Math.cos(a)); ctx.lineTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
    }
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.ink3, 0.55); ctx.stroke();
    // eight gauges: 270° from the lower left, clockwise; the current lens is drawn bold
    const A0 = (135 * Math.PI) / 180, SPAN = 1.5 * Math.PI;
    const r0 = R * 0.79, step = R * 0.058, lw = Math.max(1.6, R * 0.03);
    LENS_IDS.forEach((l, i) => {
      const r = r0 - i * step;
      const pr = BP.productRating(l);
      const cur = l === S.lens;
      ctx.beginPath(); ctx.arc(cx, cy, r, A0, A0 + SPAN);
      ctx.lineWidth = lw; ctx.strokeStyle = C.rule2; ctx.stroke();
      if (pr.band !== 'na') {
        ctx.beginPath(); ctx.arc(cx, cy, r, A0, A0 + SPAN * clamp(pr.score, 0.01, 1));
        ctx.lineWidth = cur ? lw * 1.7 : lw; ctx.strokeStyle = cur ? C[pr.band] : rgba(C[pr.band], 0.55); ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
      }
      // lens hue tick at the gauge start
      const sx = cx + r * Math.cos(A0), sy = cy + r * Math.sin(A0);
      ctx.beginPath(); ctx.moveTo(sx - Math.cos(A0 - Math.PI / 2) * 0, sy); circle(sx - 2.6, sy + 2.6, cur ? 1.9 : 1.3); ctx.fillStyle = C.lens[l]; ctx.fill();
      if (R > 190) {
        const lf = font(cur ? 600 : 500, clamp(R * 0.032, 8, 10.5));
        const lx = cx - r * 0.707 + 6, ly = cy + r * 0.707 + 3.5;
        text(OK.lens(l).short.toUpperCase(), lx, ly, lf, cur ? C.ink : C.ink3, 'left', '1px');
        text(scoreTxt(pr), cx + r * 0.707 - 6, ly, font(400, clamp(R * 0.032, 8, 10.5), true), cur ? C.ink : C.ink3, 'right');
      }
    });
    // centre: the current lens and its product score
    const pr = BP.productRating(S.lens);
    const rc = R * 0.33;
    circle(cx, cy, rc); ctx.fillStyle = C.paper; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C.rule2; ctx.stroke();
    const sf = clamp(R * 0.27, 15, 64);
    text(scoreTxt(pr), cx, cy + sf * 0.36, font(400, sf, true), C.ink, 'center');
    const lf = clamp(R * 0.068, 7.5, 13);
    if (R > 44) {
      const ln = OK.lens(S.lens).label.toUpperCase();
      text(ln, cx + lf * 0.08, cy - sf * 0.52, font(500, lf), C.ink2, 'center', (lf * 0.16).toFixed(1) + 'px');
      gBand(pr.band, cx, cy + sf * 0.36 + lf * 1.4, clamp(R * 0.035, 3, 6));
    }
    if (big) {
      const nf = clamp(R * 0.06, 9, 15);
      const name = BP.product.name.toUpperCase();
      text(name, cx + nf * 0.14, cy + R * 0.66, font(500, nf), C.ink, 'center', (nf * 0.28).toFixed(1) + 'px');
      if (R > 110) text('v' + BP.product.version + ' · ' + NF + ' features', cx, cy + R * 0.66 + nf * 1.45, font(400, nf * 0.78, true), C.ink3, 'center');
    }
    ctx.globalAlpha = 1;
  }

  // ── domain plates: band ring, name and counters, sticky inside the plate ──
  function stickyY(by, bh, ch, pad) {
    const top = Math.max(by + pad, 8);
    const bottom = Math.min(by + bh - pad, SH - 8);
    if (bh < ch + pad * 2) return by + (bh - ch) / 2;
    return clamp(top, by + pad, Math.max(by + pad, Math.min(bottom - ch, by + bh - ch - pad)));
  }
  function counters(roll, x, y, maxX, withCount) {
    const cf = font(400, 10.5, true);
    const gates = gateTotal(roll.gates);
    if (roll.attention) { gAttn(x + 4.5, y - 3.6, 4.6); x += 11; text(String(roll.attention), x, y, cf, C.alarm, 'left'); x += tw(String(roll.attention), cf) + 9; }
    if (gates) { gGate(roll.gates.changes ? 'changes' : 'approval', x + 4.5, y - 3.6, 4.6); x += 11; text(String(gates), x, y, cf, C.gate, 'left'); x += tw(String(gates), cf) + 9; }
    if (withCount) {
      const cnt = roll.count + ' features';
      if (x + tw(cnt, cf) < maxX) { text(cnt, x, y, cf, C.ink3, 'left'); x += tw(cnt, cf); }
      else if (x + tw(String(roll.count), cf) < maxX) { text(String(roll.count), x, y, cf, C.ink3, 'left'); x += tw(String(roll.count), cf); }
    }
    return x;
  }
  function countersW(roll) {
    const cf = font(400, 10.5, true);
    const gates = gateTotal(roll.gates);
    return (roll.attention ? 20 + tw(String(roll.attention), cf) : 0) + (gates ? 20 + tw(String(gates), cf) : 0);
  }
  function drawDomain(dn, A) {
    const a = nodeAlpha(dn);
    if (a < 0.02 || !inView(dn.x, dn.y, dn.w, dn.h, 60)) return;
    const k = cam.k;
    const phone = SW <= 760;
    const bx = toSX(dn.x), by = toSY(dn.y), bw = dn.w * k, bh = dn.h * k;
    ctx.globalAlpha = a;
    const sel = selNode === dn, hov = hoverNode === dn;
    if (!overlayPass) {
      rrect(bx, by, bw, bh, clamp(10 * k, 4, 12));
      ctx.fillStyle = C.dark ? rgba(C.paperHi, 0.82) : rgba(C.paperHi, 0.9); ctx.fill();
      ctx.lineWidth = sel ? 2 : 1; ctx.strokeStyle = sel ? C.ink : hov ? C.ink3 : C.rule; ctx.stroke();
    }
    const rt = BP.domainRating(dn.id, S.lens);
    const roll = BP.domainRollup(dn.id);
    // plaque: ring with the score, name, counters (sticky inside the plate)
    const d = phone && bh < 60 ? clamp(bh - 9, 17, 21) : clamp(Math.min(bh - 8, 46), 22, bh > 140 ? 46 : bh > 70 ? 38 : 32);
    const nameF = font(500, d >= 38 ? 15 : phone ? 11.5 : 13);
    const two = bh >= (phone ? 40 : 34);
    const ch = two ? Math.max(d, phone ? 25 : 28) : d;
    const nameW = tw(dn.data.name, nameF);
    const cw = countersW(roll);
    const cwid = d + 8 + (two ? Math.max(nameW, cw + 60) : nameW + (cw ? cw + 10 : 0));
    // sticky: the plaque slides with the visible part of the plate and never runs past its right edge
    let px = Math.max(bx + 8, Math.min(8, bx + bw - 8 - cwid));
    // when only a sliver of the plate is on screen, the plaque stays readable at the edge: on a halo where the
    // module column leaves room, else as the ring alone, else not at all (the module cards carry the context)
    let clipped = false, ringOnly = false;
    if (px < 6 && bx + bw > 36) {
      const modL = toSX(L.c.xM);
      if (modL - 14 >= 6 + cwid) { clipped = true; px = 6; }
      else if (bx + bw - 14 >= d) { ringOnly = true; px = 6; }
      else px = -1e4;
    }
    if (px < -1000) { if (overlayPass) { ctx.globalAlpha = 1; return; } }
    const py = stickyY(by, bh, ch, two ? 4 : 3);
    const rx = px + d / 2, ry = py + ch / 2;
    const tx = px + d + 8;
    const contentR = px + cwid;
    const room = bx + bw - 8;
    const overflow = !ringOnly && (bw - 16 < cwid || (clipped && contentR > room));
    if (px < -1000) { /* plaque off screen */ }
    else if (ringOnly) {
      if (!overlayPass) {
        const pr = d / 2;
        gRing(rt, px + pr, py + ch / 2, d, clamp(d * 0.11, 2.2, 4));
        const sfs = clamp(d * 0.36, 9, 15);
        text(scoreTxt(rt), px + pr, py + ch / 2 + sfs * 0.36, font(500, rt.band === 'na' ? sfs * 0.8 : sfs, true), C.ink, 'center');
      }
    } else if (overflow && !overlayPass) {
      // the label runs past a narrow plate (phones): it is drawn above the cards, on a halo panel
      plaqueQueue.push(dn);
    } else {
      if (overflow) {
        rrect(px - 5, py - 3, contentR - px + 14, ch + 6, 9);
        ctx.save(); ctx.shadowColor = C.shadow; ctx.shadowBlur = 8; ctx.fillStyle = C.paperHi; ctx.fill(); ctx.restore();
        ctx.lineWidth = 1; ctx.strokeStyle = C.rule; ctx.stroke();
      }
      plaque(dn, rt, roll, d, two, ch, px, py, rx, ry, tx, nameF, contentR, room);
    }
    if (overlayPass) { ctx.globalAlpha = 1; return; }
    // grown plates: the status mix beside the plaque, then every lens, while there is room
    if (bw > 420 && bh >= 34 && !ringOnly && px > -1000) {
      let x = contentR + 28;
      const right = bx + bw - 12;
      if (right - x >= 170) {
        statusBar(roll, x, py + Math.max(2, ch / 2 - 11), 160, 4);
        x += 160 + 28;
      }
      if (!lensGrid({ type: 'domain', id: dn.id }, x, py - 2, right - x, Math.max(ch + 4, Math.min(bh - 10, 72))) && bh > 150) {
        lensGrid({ type: 'domain', id: dn.id }, px, py + ch + 16, Math.min(right - px, 360), by + bh - (py + ch + 16) - 6);
      }
    }
    if (A.a1 > 0.3 && bh > 18) addToggle(dn, bx + bw, by + bh / 2, a * A.a1);
    ctx.globalAlpha = 1;
  }
  let overlayPass = false;
  const plaqueQueue = [];
  function plaque(dn, rt, roll, d, two, ch, px, py, rx, ry, tx, nameF, contentR, room) {
    gRing(rt, rx, ry, d, clamp(d * 0.11, 2.2, 4));
    const sfs = clamp(d * 0.36, 9, 15);
    text(scoreTxt(rt), rx, ry + sfs * 0.36, font(500, rt.band === 'na' ? sfs * 0.8 : sfs, true), C.ink, 'center');
    const maxX = Math.max(room, contentR + 6);
    const nameStr = fitText(dn.data.name, nameF, maxX - tx);
    if (two) {
      const ph = SW <= 760 && ch < 28;
      text(nameStr, tx, ry - (ph ? 1.5 : 2.5), nameF, C.ink, 'left');
      counters(roll, tx, ry + (ph ? 10 : 11), maxX, true);
    } else {
      text(nameStr, tx, ry + 4.5, nameF, C.ink, 'left');
      counters(roll, tx + tw(nameStr, nameF) + 10, ry + 4, maxX, false);
    }
  }
  function statusBar(roll, x, y, w, h) {
    const order = BP.STATUS_ORDER;
    let cx = x;
    const tot = roll.count || 1;
    order.forEach((s) => {
      const n = roll.byStatus[s] || 0;
      if (!n) return;
      const ww = (w * n) / tot;
      ctx.fillStyle = s === 'blocked' ? C.alarm : s === 'live' ? C.ink : s === 'ready' ? C.ink2 : s === 'building' ? C.ink3 : C.ink4;
      ctx.fillRect(cx, y, Math.max(1, ww - 1.5), h);
      cx += ww;
    });
    const f = font(400, 10.5, true);
    let tx = x;
    const ty = y + h + 13;
    order.forEach((s) => {
      const n = roll.byStatus[s] || 0;
      if (!n || tx > x + w - 20) return;
      gStatus(s, tx + 4.5, ty - 3.6, 4.2, C.ink, C.paperHi);
      text(String(n), tx + 11, ty, f, C.ink2, 'left');
      tx += 11 + tw(String(n), f) + 10;
    });
  }
  /** Every lens for a node: 8 × 1, 4 × 2 or 2 × 4 cells, whichever fits; false when nothing fits. */
  function lensGrid(ref, x, y, w, h) {
    const f = font(500, 8.5), sf = font(400, 10.5, true);
    const cellW = 14 + tw('OVERALL', f, '0.8px') + 8 + 18, rowH = 17;
    let cols = 0;
    if (w >= cellW * 8 && h >= rowH) cols = 8;
    else if (w >= cellW * 4 && h >= rowH * 2) cols = 4;
    else if (w >= cellW * 2 && h >= rowH * 4) cols = 2;
    if (!cols) return false;
    const cwid = Math.min(w / cols, cellW + 20);
    const rows = 8 / cols;
    const y0 = y + Math.max(0, (Math.min(h, rows * rowH + 6) - rows * rowH) / 2);
    LENS_IDS.forEach((l, i) => {
      const cx = x + (i % cols) * cwid, cy = y0 + Math.floor(i / cols) * rowH + 12;
      const r = ref.type === 'domain' ? BP.domainRating(ref.id, l) : BP.moduleRating(ref.id, l);
      const cur = l === S.lens;
      if (cur) { rrect(cx - 3, cy - 12, cwid - 4, 16, 8); ctx.fillStyle = C.bandHi; ctx.fill(); }
      gBand(r.band, cx + 5, cy - 3.8, 4.6);
      text(OK.lens(l).short.toUpperCase(), cx + 14, cy, f, cur ? C.ink : C.ink3, 'left', '0.8px');
      text(scoreTxt(r), cx + cwid - 8, cy, sf, cur ? C.ink : C.ink2, 'right');
    });
    return true;
  }
  function addToggle(n, x, y, a) {
    if (x < -10 || x > SW + 10 || y < -10 || y > SH + 10) return;
    const isC = collapsed.has(n);
    const hov = hoverToggle === n;
    const r = 6.5;
    ctx.globalAlpha = a;
    circle(x, y, r); ctx.fillStyle = isC ? C.ink : C.paperHi; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = isC ? C.ink : hov ? C.ink2 : C.ink4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); if (isC) { ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); }
    ctx.lineWidth = 1.3; ctx.strokeStyle = isC ? C.onInk : hov ? C.ink : C.ink3; ctx.stroke();
    toggles.push({ n, x, y, r: r + 5 });
  }
  let hoverToggle = null;

  // ── modules: band pills at the opening fit, cards from L1 ──
  function drawModule(mn, A) {
    const a = nodeAlpha(mn);
    if (a < 0.02 || !inView(mn.x, mn.y, mn.w, mn.h, 40)) return;
    const k = cam.k;
    const bx = toSX(mn.x), by = toSY(mn.y), bw = mn.w * k, bh = Math.max(2, mn.h * k);
    const rt = BP.moduleRating(mn.id, S.lens);
    const col = bandCol(rt.band);
    const sel = selNode === mn, hov = hoverNode === mn;
    const pillA = 1 - A.a1;
    if (pillA > 0.01) {
      // L0: a compact band bar per module
      ctx.globalAlpha = a * pillA;
      const ph = clamp(bh * 0.62, 3, 11);
      const pw = Math.max(16, bw * 0.86);
      const pxx = bx + bw - pw;
      rrect(pxx, by + (bh - ph) / 2, pw, ph, ph / 2);
      if (rt.band === 'na') { ctx.setLineDash([3, 2.5]); ctx.lineWidth = 1; ctx.strokeStyle = C.na; ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.fillStyle = rgba(col, C.dark ? 0.62 : 0.5); ctx.fill(); }
      if (sel || hov) { rrect(bx - 2, by - 2, bw + 4, bh + 4, Math.min(bh / 2 + 2, 8)); ctx.lineWidth = sel ? 2 : 1; ctx.strokeStyle = sel ? C.ink : C.ink3; ctx.stroke(); }
      // the connector reaches the bar
      ctx.beginPath(); ctx.moveTo(bx, by + bh / 2); ctx.lineTo(pxx, by + bh / 2); ctx.lineWidth = 0.9; ctx.strokeStyle = rgba(C.ink3, 0.5); ctx.stroke();
    }
    if (A.a1 > 0.01) {
      ctx.globalAlpha = a * A.a1;
      const rad = clamp(8 * k, 3, 9);
      rrect(bx, by, bw, bh, rad);
      ctx.fillStyle = C.paperHi; ctx.fill();
      ctx.lineWidth = sel ? 2 : 1; ctx.strokeStyle = sel ? C.ink : hov ? C.ink3 : C.rule; ctx.stroke();
      ctx.save(); rrect(bx, by, bw, bh, rad); ctx.clip();
      if (rt.band === 'na') { ctx.fillStyle = rgba(C.na, 0.3); ctx.fillRect(bx, by, 3.5, bh); }
      else { ctx.fillStyle = col; ctx.fillRect(bx, by, 3.5, bh); ctx.fillStyle = rgba(col, C.dark ? 0.12 : 0.08); ctx.fillRect(bx, by, bw, bh); }
      ctx.restore();
      if (bh >= 13 && bw > 60) {
        const roll = BP.moduleRollup(mn.id);
        const two = bh >= 38;
        const ch = two ? 30 : 14;
        const cy = stickyY(by, bh, ch, 4);
        const line1 = cy + (two ? 11 : 10.5);
        const nf = font(500, bh > 60 ? 13 : 12);
        gBand(rt.band, bx + 15, line1 - 4, 5);
        const sf = font(400, 11.5, true);
        const st = scoreTxt(rt);
        const nameW = tw(mn.data.name, nf);
        // the score sits after the name when the card is wide, else at its right end
        const wide = bw > 330;
        let rightEdge = bx + bw - 10;
        let nameMax;
        if (wide) nameMax = Math.min(nameW, bw * 0.45);
        else {
          text(st, rightEdge, line1, sf, C.ink, 'right');
          rightEdge -= tw(st, sf) + 8;
          if (!two) {
            // the name comes first; counters only when the whole name still fits
            const cw = countersW(roll);
            if (cw && nameW + cw + 8 <= rightEdge - (bx + 25)) { counters(roll, rightEdge - cw, line1, rightEdge, false); rightEdge -= cw + 4; }
          }
          nameMax = rightEdge - (bx + 25);
        }
        const ns = fitText(mn.data.name, nf, nameMax);
        text(ns, bx + 25, line1, nf, C.ink, 'left');
        let after = bx + 25 + tw(ns, nf) + 10;
        if (wide) {
          text(st, after, line1, sf, C.ink, 'left');
          after += tw(st, sf) + 12;
          if (!two) after = counters(roll, after, line1, bx + bw - 10, false) + 12;
        }
        if (two) {
          const end = counters(roll, bx + 25, line1 + 15, bx + bw - 8, true);
          after = Math.max(after, end + 12);
        }
        if (wide) {
          const gx = Math.max(after, bx + bw * 0.5), gw = bx + bw - 10 - gx;
          if (!lensGrid({ type: 'module', id: mn.id }, gx, cy - 3, gw, two ? bh - 8 : 16) && two && gw >= 170) statusBar(roll, gx, cy + 3, Math.min(gw, 220), 4);
        }
      }
    }
    if (A.a2 > 0.3 && bh > 16) addToggle(mn, bx + bw, by + bh / 2, a * A.a2);
    ctx.globalAlpha = 1;
  }

  // ── feature cards ──
  function drawFeatures(A) {
    const k = cam.k;
    const w = L.P.CW * k, h = G.CH * k;
    const texA = 1 - A.a2;
    const chipA = A.a2 * (1 - A.a3);
    const c3A = A.a3 * (1 - A.a4);
    const c4A = A.a4;
    for (let i = 0; i < NF; i++) {
      const fn = featNode[i];
      if (fn.vis < 0.02 || !inView(fn.x, fn.y, fn.w, fn.h, 4)) continue;
      let a = fn.vis;
      if (!inFocusFeature(fn)) a *= 0.14;
      if (fDim[i]) a *= 0.16;
      if (a < 0.01) continue;
      const x = toSX(fn.x), y = toSY(fn.y);
      const f = fn.data, band = fBand[i];
      if (texA > 0.01) { ctx.globalAlpha = a * texA; drawTexture(i, band, x, y, w, h); }
      if (chipA > 0.01) { ctx.globalAlpha = a * chipA; drawChip(i, f, band, x, y, w, h); }
      if (c3A > 0.01) { ctx.globalAlpha = a * c3A; drawCard3(i, f, band, x, y, w, h); }
      if (c4A > 0.01) { ctx.globalAlpha = a * c4A; drawCard4(i, f, band, x, y, w, h); }
      // coverage bar for the chosen initiative
      if (fCov[i]) { ctx.globalAlpha = a; covBar(fCov[i], x, y, w, h); }
    }
    ctx.globalAlpha = 1;
  }
  function covCol(s) { return s === 'covered' ? C.good : s === 'finding' ? C.alarm : s === 'in-progress' ? C.ink2 : C.ink4; }
  function covBar(s, x, y, w, h) {
    const bh = clamp(h * 0.1, 2, 4);
    ctx.save(); rrect(x, y, w, h, clamp(h * 0.18, 1.5, 7)); ctx.clip();
    if (s === 'pending') { ctx.beginPath(); ctx.moveTo(x, y + h - bh / 2); ctx.lineTo(x + w, y + h - bh / 2); ctx.setLineDash([4, 3]); ctx.lineWidth = bh; ctx.strokeStyle = covCol(s); ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.fillStyle = covCol(s); ctx.fillRect(x, y + h - bh, w, bh); }
    ctx.restore();
  }
  function drawTexture(i, band, x, y, w, h) {
    const r = clamp(h * 0.22, 1, 4);
    rrect(x + 0.5, y + 0.5, w - 1, h - 1, r);
    if (band === 'na') {
      ctx.fillStyle = rgba(C.na, C.dark ? 0.08 : 0.06); ctx.fill();
      ctx.setLineDash([2, 2]); ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.na, 0.75); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = rgba(C[band], C.dark ? 0.44 : 0.31); ctx.fill();
    }
    if (fStatusOf(i) === 'blocked' && h > 5) { ctx.fillStyle = C.alarm; ctx.fillRect(x + w - Math.max(2, w * 0.05), y + 1, Math.max(2, w * 0.05) - 1, h - 2); }
  }
  const fStatusOf = (i) => FEATS[i].status;
  function drawChip(i, f, band, x, y, w, h) {
    const r = Math.min(h / 2, 12);
    rrect(x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.fillStyle = C.paperHi; ctx.fill();
    if (band === 'na') { ctx.setLineDash([3, 2.5]); ctx.lineWidth = 1; ctx.strokeStyle = C.na; ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.fillStyle = rgba(C[band], C.dark ? 0.2 : 0.14); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = rgba(C[band], 0.9); ctx.stroke(); }
    const mr = clamp(h * 0.24, 3, 7.5);
    const mx = x + Math.max(mr + 4, h * 0.46);
    gStatus(f.status, mx, y + h / 2, mr, band === 'na' ? C.na : C[band], C.paperHi);
    let right = x + w - 6;
    const gr = clamp(h * 0.17, 3, 5.5);
    if (fAttn[i]) { gAttn(right - gr, y + h / 2, gr); right -= gr * 2 + 4; }
    if (fGates[i].length) { gGate(fGates[i][0].kind, right - gr, y + h / 2, gr); right -= gr * 2 + 4; }
    const fs = clamp(h * 0.4, 9.5, 13.5);
    const tx = mx + mr + 6;
    if (h >= 17 && right - tx >= 30) {
      const nf = font(500, fs);
      const s = fitText(f.name, nf, right - tx);
      if (s) text(s, tx, y + h / 2 + fs * 0.35, nf, C.ink, 'left');
    }
  }
  function cardBase(band, x, y, w, h) {
    const r = clamp(h * 0.14, 4, 9);
    rrect(x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.fillStyle = C.paperHi; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = C.rule; ctx.stroke();
    ctx.save(); rrect(x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.clip();
    const bw = clamp(w * 0.012, 3, 5);
    if (band === 'na') {
      ctx.beginPath(); ctx.moveTo(x + bw / 2 + 0.5, y); ctx.lineTo(x + bw / 2 + 0.5, y + h); ctx.setLineDash([3, 3]); ctx.lineWidth = bw; ctx.strokeStyle = rgba(C.na, 0.8); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = rgba(C[band], C.dark ? 0.075 : 0.07); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C[band]; ctx.fillRect(x, y, bw, h);
    }
    ctx.restore();
  }
  function gateMarks(i, xr, y, r) {
    let x = xr;
    if (fAttn[i]) { gAttn(x - r, y, r); x -= r * 2 + 5; }
    const kinds = [];
    fGates[i].forEach((g) => { if (!kinds.includes(g.kind)) kinds.push(g.kind); });
    kinds.forEach((kd) => { gGate(kd, x - r, y, r); x -= r * 2 + 4; });
    return x;
  }
  function drawCard3(i, f, band, x, y, w, h) {
    cardBase(band, x, y, w, h);
    const r = BP.rating(f, S.lens);
    const pad = clamp(w * 0.04, 9, 14);
    const y1 = y + h * 0.37, y2 = y + h * 0.76;
    const nfs = clamp(h * 0.27, 12, 14.5);
    gStatus(f.status, x + pad + 5, y1 - 0.5, 5.2, C.ink, C.paperHi);
    const right = gateMarks(i, x + w - pad + 2, y1 - 0.5, 5.5);
    const nf = font(500, nfs);
    text(fitText(f.name, nf, right - (x + pad + 16) - 4), x + pad + 16, y1 + nfs * 0.35, nf, C.ink, 'left');
    gBand(r.band, x + pad + 5, y2 - 0.5, 5);
    const sf = font(500, 11.5, true);
    const st = scoreTxt(r);
    text(st, x + pad + 16, y2 + 4, sf, C.ink, 'left');
    let tx = x + pad + 16 + tw(st, sf) + 7;
    const lf = font(500, 9.5), ls = '1.4px';
    const ln = OK.lens(S.lens).short.toUpperCase();
    if (tx + tw(ln, lf, ls) < x + w - pad) { text(ln, tx, y2 + 3.6, lf, C.ink3, 'left', ls); tx += tw(ln, lf, ls) + 7; }
    const hf = font(400, 11.5);
    const hs = fitText(r.headline || '', hf, x + w - pad - tx);
    if (hs) text(hs, tx, y2 + 4, hf, C.ink2, 'left');
  }
  function drawCard4(i, f, band, x, y, w, h) {
    cardBase(band, x, y, w, h);
    const r = BP.rating(f, S.lens);
    const pad = clamp(h * 0.09, 9, 16);
    const cr = clamp(h * 0.3, 16, 64);
    const ccx = x + pad + cr + 6, ccy = y + h / 2;
    gCorona(f, ccx, ccy, cr, clamp(cr * 0.2, 2.6, 8), S.lens);
    const tx = ccx + cr + clamp(cr * 0.55, 12, 28);
    const right = x + w - pad;
    const avail = right - tx;
    const lines = h > 150 ? 6 : h > 118 ? 5 : 4;
    const lh = Math.min((h - pad * 2) / lines, 30);
    const top = y + (h - lh * lines) / 2;
    const base = (n) => top + lh * (n + 0.72);
    const big = clamp(lh * 0.72, 13, 19);
    // 1: name, priority, gate and attention marks
    let rx = gateMarks(i, right + 2, base(0) - big * 0.34, clamp(big * 0.36, 5, 7));
    const pf = font(400, 11, true);
    text(f.priority, rx - 2, base(0), pf, C.ink3, 'right');
    rx -= tw(f.priority, pf) + 10;
    const nf = font(500, big);
    text(fitText(f.name, nf, rx - tx), tx, base(0), nf, C.ink, 'left');
    // 2: status, release, owner
    const rel = f.release ? BP.release(f.release) : null;
    const relT = rel ? (f.status === 'live' ? 'Shipped in ' + rel.label : 'Targets ' + rel.label) : 'Unscheduled';
    const meta = OK.statusLabel(f.status) + (f.status === 'building' || f.status === 'planned' ? ' · ' + f.progress + '%' : '') + ' · ' + relT + ' · ' + ((BP.team(f.owner) || {}).name || f.owner);
    const mf = font(400, clamp(lh * 0.5, 11, 13));
    text(fitText(meta, mf, avail), tx, base(1), mf, C.ink2, 'left');
    // 3: the current lens rating
    const gy = base(2) - 4;
    gBand(r.band, tx + 6, gy, 6);
    const sf = font(500, clamp(lh * 0.55, 12, 14), true);
    const st = scoreTxt(r);
    text(st, tx + 17, base(2), sf, C.ink, 'left');
    let x2 = tx + 17 + tw(st, sf) + 8;
    const lf = font(500, 10), ls = '1.5px';
    const ln = OK.lens(S.lens).label.toUpperCase();
    text(ln, x2, base(2) - 0.5, lf, C.ink3, 'left', ls);
    x2 += tw(ln, lf, ls) + 8;
    const hf = font(400, clamp(lh * 0.5, 11.5, 13));
    text(fitText(r.headline || '', hf, right - x2), x2, base(2), hf, C.ink, 'left');
    // 4: key facts
    const ff = font(400, clamp(lh * 0.46, 10.5, 12), true);
    let fx = tx;
    const facts = (r.facts || []).slice(0, 4);
    if (!facts.length && r.reasons && r.reasons[0]) text(fitText(r.reasons[0], hf, avail), tx, base(3), hf, C.ink3, 'left');
    facts.forEach((ft) => {
      if (fx > right - 40) return;
      const lab = ft.label + ' ';
      const lw2 = tw(lab, ff);
      const vw = tw(String(ft.value), ff);
      if (fx + lw2 + vw + 12 > right) return;
      if (ft.band) { circle(fx + 3, base(3) - 3.8, 2.8); ctx.fillStyle = bandCol(ft.band); ctx.fill(); fx += 9; }
      text(lab, fx, base(3), ff, C.ink3, 'left');
      text(String(ft.value), fx + lw2, base(3), ff, C.ink, 'left');
      fx += lw2 + vw + 14;
    });
    // 5–6: gates, coverage or reasons
    let ln5 = 4;
    const gf = font(400, clamp(lh * 0.48, 11, 12.5));
    fGates[i].slice(0, lines - 4).forEach((g) => {
      if (ln5 >= lines) return;
      gGate(g.kind, tx + 5, base(ln5) - 4, 5);
      const t = OK.labels.gate[g.kind].long + ' · ' + (g.waitingDays === 0 ? 'today' : g.waitingDays + ' days') + ' · ' + g.title;
      text(fitText(t, gf, avail - 16), tx + 16, base(ln5), gf, g.kind === 'changes' ? C.alarm : C.gate, 'left');
      ln5++;
    });
    if (ln5 < lines && fCov[i]) {
      const ini = BP.initiative(S.initiative);
      circle(tx + 5, base(ln5) - 4, 3.5); ctx.fillStyle = covCol(fCov[i]); ctx.fill();
      text(fitText((ini ? ini.name + ' · ' : '') + OK.labels.coverage[fCov[i]], gf, avail - 16), tx + 16, base(ln5), gf, C.ink2, 'left');
      ln5++;
    }
    if (ln5 < lines && f.status === 'blocked' && f.blockedReason) text(fitText(f.blockedReason, gf, avail), tx, base(ln5), gf, C.alarm, 'left');
  }

  // ── folded branches: a compact strip of what the fold hides ──
  function drawFolded() {
    const k = cam.k;
    collapsed.forEach((n) => {
      if (n.vis < 0.5 || nodeAlpha(n) < 0.05) return;
      const a = nodeAlpha(n);
      let x, y, items, label;
      const h = G.CH * k;
      if (n.type === 'module') { x = toSX(L.c.xF); y = toSY(n.y); items = n.kids.map((fn) => fBand[fn.fi]); label = n.kids.length + ' features folded'; }
      else if (n.type === 'domain') { x = toSX(L.c.xM); y = toSY(n.y); items = n.kids.map((m) => BP.moduleRating(m.id, S.lens).band); label = n.kids.length + ' modules · ' + BP.featuresOfDomain(n.id).length + ' features folded'; }
      else if (n.type === 'area') { x = toSX(L.c.xD); y = toSY(n.y); items = n.kids.map((d) => BP.domainRating(d.id, S.lens).band); label = n.kids.length + ' domains · ' + BP.featuresOfArea(n.id).length + ' features folded'; }
      else return;
      if (y > SH || y + h < 0) return;
      ctx.globalAlpha = a;
      const s = clamp(h * 0.42, 4, 13), gap = clamp(s * 0.35, 1.5, 4);
      const cy = y + h / 2;
      items.forEach((b, j) => {
        const xx = x + j * (s + gap);
        rrect(xx, cy - s / 2, s, s, Math.min(3, s / 3));
        if (b === 'na') { ctx.setLineDash([2, 2]); ctx.lineWidth = 1; ctx.strokeStyle = C.na; ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.fillStyle = rgba(C[b], 0.55); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C[b]; ctx.stroke(); }
      });
      if (h > 12) {
        const f = font(400, clamp(h * 0.3, 9.5, 12), true);
        text(label, x + items.length * (s + gap) + 8, cy + 4, f, C.ink3, 'left');
      }
      ctx.globalAlpha = 1;
    });
  }

  // ── dependency links of the selected feature ──
  function drawDeps() {
    if (!deps.length) return;
    const r = clamp(10 * cam.k, 3, 10);
    deps.forEach((d) => {
      const pts = d.pts.map((p) => [toSX(p[0]), toSY(p[1])]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length - 1; j++) {
        const p = pts[j], nx = pts[j + 1];
        const rr = Math.min(r, Math.hypot(p[0] - pts[j - 1][0], p[1] - pts[j - 1][1]) / 2, Math.hypot(nx[0] - p[0], nx[1] - p[1]) / 2);
        ctx.arcTo(p[0], p[1], nx[0], nx[1], rr);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0], last[1]);
      const col = d.kind === 'dep' ? C.ink : C.ink2;
      ctx.lineWidth = d.kind === 'dep' ? 1.6 : 1.3; ctx.strokeStyle = col;
      ctx.setLineDash(d.kind === 'dep' ? [] : [5, 3.5]);
      if (C.dark) { ctx.save(); ctx.shadowColor = C.glow; ctx.shadowBlur = 6; ctx.stroke(); ctx.restore(); } else ctx.stroke();
      ctx.setLineDash([]);
      // arrowhead into the end card, a dot at the start
      const pv = pts[pts.length - 2];
      const ang = Math.atan2(last[1] - pv[1], last[0] - pv[0]);
      const ah = 6;
      ctx.beginPath(); ctx.moveTo(last[0], last[1]);
      ctx.lineTo(last[0] - ah * Math.cos(ang - 0.45), last[1] - ah * Math.sin(ang - 0.45));
      ctx.lineTo(last[0] - ah * Math.cos(ang + 0.45), last[1] - ah * Math.sin(ang + 0.45)); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      circle(pts[0][0], pts[0][1], 2.4); ctx.fillStyle = col; ctx.fill();
      // ring the linked card
      const o = d.other;
      ringNode(o, d.kind === 'dep' ? C.ink : C.ink2, 1.3, 3, d.kind === 'dent');
    });
  }
  function ringNode(n, col, lw, off, dashed) {
    const k = cam.k;
    const x = toSX(n.x) - off, y = toSY(n.y) - off, w = n.w * k + off * 2, h = n.h * k + off * 2;
    if (n.type === 'product') { circle(toSX(n.x + n.w / 2), toSY(n.y + n.h / 2), n.w / 2 * k + off); }
    else rrect(x, y, w, h, n.type === 'feature' ? clamp(n.h * k * 0.18, 2, 10) + off : clamp(10 * k, 4, 12) + off);
    ctx.lineWidth = lw; ctx.strokeStyle = col; if (dashed) ctx.setLineDash([3, 2.5]);
    ctx.stroke(); ctx.setLineDash([]);
  }

  // ── signals on top: attention and gates at low zoom, search hits, selection, hover, keyboard cursor ──
  function drawMarks(A, now) {
    const k = cam.k;
    const lowA = 1 - A.a2;
    const gatesOn = !!S.gates;
    for (let i = 0; i < NF; i++) {
      const fn = featNode[i];
      if (fn.vis < 0.3 || !inView(fn.x, fn.y, fn.w, fn.h, 6)) continue;
      let a = fn.vis * (inFocusFeature(fn) ? 1 : 0.14) * (fDim[i] ? 0.16 : 1);
      const x = toSX(fn.x), y = toSY(fn.y), w = fn.w * k, h = fn.h * k;
      if (lowA > 0.01) {
        ctx.globalAlpha = a * lowA;
        const r = clamp(h * 0.42, 2.6, 4.6);
        let xr = x + w - r - 1.5;
        if (fAttn[i]) { gAttn(xr, y + h / 2, r); xr -= r * 2 + 2; }
        if (gatesOn && fGates[i].length) {
          const g = fGates[i].find((gg) => S.gates === 'any' || gg.kind === S.gates) || fGates[i][0];
          gGate(g.kind, xr, y + h / 2, r);
        }
      }
      if (fHit[i]) {
        ctx.globalAlpha = 1;
        rrect(x - 2.5, y - 2.5, w + 5, h + 5, clamp(h * 0.2, 2, 10) + 2);
        ctx.lineWidth = 1.8; ctx.strokeStyle = C.ink; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (hoverNode && hoverNode !== selNode && hoverNode.type === 'feature') ringNode(hoverNode, C.ink3, 1.2, 2);
    if (selNode && selNode.vis > 0.3) {
      if (C.dark) { ctx.save(); ctx.shadowColor = C.glow; ctx.shadowBlur = 14; ringNode(selNode, C.ink, 2.2, 3.5); ctx.restore(); }
      ringNode(selNode, C.ink, 2.2, 3.5);
    }
    if (kbdActive && cursorNode && cursorNode !== selNode) ringNode(cursorNode, C.focus, 2, 5, true);
    else if (kbdActive && cursorNode) ringNode(cursorNode, C.focus, 1.5, 7, true);
    if (anim.pulse) {
      const t = (now - anim.pulse.t0) / 1300;
      const n = anim.pulse.n;
      if (n.vis > 0.3) {
        ctx.globalAlpha = 1 - t;
        ringNode(n, C.ink, 2, 4 + t * 16);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ── context: module tags stick to the left edge once the module column is off screen ──
  function drawEdgeTags(A) {
    if (A.a2 < 0.2) return;
    const k = cam.k;
    const colRight = toSX(L.c.xM + L.P.MW);
    if (colRight > 30) return;
    const fr = freeRect();
    let lastY = -100;
    const th = 15;
    const f = font(500, 9), ls = '1.1px', sf = font(400, 10, true);
    ctx.globalAlpha = A.a2;
    MODS.forEach((mn) => {
      if (mn.vis < 0.5 || nodeAlpha(mn) < 0.3) return;
      const by = toSY(mn.y), bh = mn.h * k;
      if (by + bh < fr.y || by - 30 > fr.y + fr.h) return;
      // in the gutter above the module's first row; it sticks to the top while the module's rows are in view
      let y = by - (G.MG * k) / 2 - th / 2;
      const top = fr.y + 58;
      if (y < top) y = Math.min(top, by + bh - th - 2);
      if (y < lastY + th + 2 || y < fr.y + 54) return;
      lastY = y;
      const rt = BP.moduleRating(mn.id, S.lens);
      const first = mn.parent.kids[0] === mn;
      const t1 = first ? mn.parent.data.name.toUpperCase() + '  ›  ' : '';
      const t2 = mn.data.name.toUpperCase();
      const w1 = t1 ? tw(t1, f, ls) : 0, w2 = tw(t2, f, ls);
      const st = scoreTxt(rt);
      const x = fr.x + 8;
      const w = 22 + w1 + w2 + 8 + tw(st, sf) + 10;
      rrect(x, y, w, th, th / 2);
      ctx.fillStyle = rgba(C.paperHi, 0.96); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C.rule; ctx.stroke();
      gBand(rt.band, x + 11, y + th / 2, 4.3);
      if (t1) text(t1, x + 20, y + 10.8, f, C.ink3, 'left', ls);
      text(t2, x + 20 + w1, y + 10.8, f, C.ink, 'left', ls);
      text(st, x + 20 + w1 + w2 + 7, y + 11.2, sf, C.ink2, 'left');
    });
    ctx.globalAlpha = 1;
  }

  // ══ minimap ════════════════════════════════════════════════════════════════════════════════════
  const mini = { dirty: true, base: null, w: 0, h: 0, s: 1, ox: 0, oy: 0, ctx: M.miniCv.getContext('2d'), shown: false };
  function sizeMini() {
    const b = L.bounds;
    const maxW = SW < 1100 ? 150 : 196, maxH = SW < 1100 ? 108 : 136;
    const s = Math.min(maxW / b.w, maxH / b.h);
    mini.w = Math.round(b.w * s); mini.h = Math.round(b.h * s); mini.s = s;
    M.miniCv.style.width = mini.w + 'px'; M.miniCv.style.height = mini.h + 'px';
    M.miniCv.width = mini.w * DPR; M.miniCv.height = mini.h * DPR;
    mini.dirty = true;
  }
  function buildMiniBase() {
    const b = L.bounds, s = mini.s;
    const cv = mini.base || document.createElement('canvas');
    cv.width = mini.w * DPR; cv.height = mini.h * DPR;
    const c = cv.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, mini.w, mini.h);
    const X = (x) => (x - b.x) * s, Y = (y) => (y - b.y) * s;
    // dial
    c.beginPath(); c.arc(X(ROOT.tx + ROOT.tw / 2), Y(ROOT.ty + ROOT.th / 2), (ROOT.tw / 2) * s, 0, TAU); c.fillStyle = C.paperHi; c.fill(); c.strokeStyle = C.rule; c.lineWidth = 1; c.stroke();
    DOMS.forEach((dn) => {
      if (dn.tvis < 0.5) return;
      const rt = BP.domainRating(dn.id, S.lens);
      c.fillStyle = C.paperHi; c.fillRect(X(dn.tx), Y(dn.ty), dn.tw * s, Math.max(1, dn.th * s));
      c.fillStyle = rt.band === 'na' ? C.ink4 : C[rt.band]; c.fillRect(X(dn.tx), Y(dn.ty), Math.max(1.5, dn.tw * s * 0.18), Math.max(1, dn.th * s));
    });
    MODS.forEach((mn) => {
      if (mn.tvis < 0.5) return;
      const rt = BP.moduleRating(mn.id, S.lens);
      c.fillStyle = rt.band === 'na' ? rgba(C.na, 0.4) : rgba(C[rt.band], 0.6);
      c.fillRect(X(mn.tx), Y(mn.ty), mn.tw * s, Math.max(0.8, mn.th * s - 0.3));
    });
    for (let i = 0; i < NF; i++) {
      const fn = featNode[i];
      if (fn.tvis < 0.5) continue;
      const band = fBand[i];
      let a = fDim[i] ? 0.15 : 0.85;
      if (focusNode && !isAncestor(focusNode, fn)) a *= 0.2;
      c.fillStyle = band === 'na' ? rgba(C.na, a * 0.45) : rgba(C[band], a);
      c.fillRect(X(fn.tx), Y(fn.ty), Math.max(0.8, fn.tw * s - 0.6), Math.max(0.8, fn.th * s - 0.3));
    }
    mini.base = cv;
    mini.dirty = false;
  }
  function drawMini() {
    // the overview needs no minimap: it appears once the view no longer holds the whole product
    const want = mini.shown && cam.k > L.kFit * 1.22;
    if (want !== !M.mini.classList.contains('is-off')) M.mini.classList.toggle('is-off', !want);
    if (!want) return;
    if (mini.dirty) buildMiniBase();
    const c = mini.ctx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, mini.w, mini.h);
    c.drawImage(mini.base, 0, 0, mini.w, mini.h);
    const b = L.bounds, s = mini.s;
    const x0 = (VX0 - b.x) * s, y0 = (VY0 - b.y) * s, x1 = (VX1 - b.x) * s, y1 = (VY1 - b.y) * s;
    const rx = clamp(x0, -2, mini.w), ry = clamp(y0, -2, mini.h);
    const rw = clamp(x1, 0, mini.w + 2) - rx, rh = clamp(y1, 0, mini.h + 2) - ry;
    c.fillStyle = rgba(C.ink, 0.07); c.fillRect(rx, ry, rw, rh);
    c.lineWidth = 1.4; c.strokeStyle = C.ink; c.strokeRect(rx + 0.5, ry + 0.5, Math.max(3, rw - 1), Math.max(3, rh - 1));
  }
  (function bindMini() {
    let drag = false;
    const go = (e) => {
      const r = M.miniCv.getBoundingClientRect();
      const b = L.bounds;
      const wx = b.x + (e.clientX - r.left) / mini.s, wy = b.y + (e.clientY - r.top) / mini.s;
      const fr = freeRect();
      atFit = false;
      anim.cam = null;
      setCam(clampCam({ k: cam.k, tx: fr.x + fr.w / 2 - wx * cam.k, ty: fr.y + fr.h / 2 - wy * cam.k }));
    };
    M.miniCv.addEventListener('pointerdown', (e) => { drag = true; M.miniCv.setPointerCapture(e.pointerId); go(e); e.preventDefault(); });
    M.miniCv.addEventListener('pointermove', (e) => { if (drag) go(e); });
    M.miniCv.addEventListener('pointerup', () => { drag = false; });
    M.miniCv.addEventListener('pointercancel', () => { drag = false; });
  })();

  // ══ hit testing ════════════════════════════════════════════════════════════════════════════════
  function hitToggle(px, py) {
    for (let j = toggles.length - 1; j >= 0; j--) { const t = toggles[j]; if (Math.hypot(px - t.x, py - t.y) <= t.r) return t.n; }
    return null;
  }
  function hitNode(px, py, region) {
    const wx = toWX(px), wy = toWY(py);
    const m = 3 / cam.k;
    for (let i = 0; i < NF; i++) {
      const fn = featNode[i];
      if (fn.vis < 0.5) continue;
      if (wx >= fn.x - m && wx <= fn.x + fn.w + m && wy >= fn.y - m && wy <= fn.y + fn.h + m) return fn;
    }
    for (const mn of MODS) if (mn.vis > 0.5 && wx >= mn.x && wx <= mn.x + mn.w && wy >= mn.y && wy <= mn.y + mn.h) return mn;
    for (const dn of DOMS) if (dn.vis > 0.5 && wx >= dn.x && wx <= dn.x + dn.w && wy >= dn.y && wy <= dn.y + dn.h) return dn;
    // area titles and junctions
    for (const an of AREAS) {
      const yb = toSY(an.y);
      const x0 = toSX(L.c.xA) - 12;
      if (px >= x0 && px <= x0 + 360 && py >= yb - clamp(L.P.AG * cam.k * 0.72, 12, 34) && py <= yb) return an;
      if (Math.hypot(px - toSX(L.c.xA), py - toSY(areaMidY(an))) < 10) return an;
    }
    const R = (ROOT.w / 2) * cam.k;
    if (Math.hypot(px - toSX(ROOT.x + ROOT.w / 2), py - toSY(ROOT.y + ROOT.h / 2)) <= R) return ROOT;
    if (region) {
      // a tap between cards still lands in the module, domain or area whose band holds it
      for (const mn of MODS) if (mn.vis > 0.5 && wy >= mn.y - G.MG / 2 && wy <= mn.y + mn.h + G.MG / 2 && wx >= L.c.xM && wx <= L.bounds.x + L.bounds.w) return mn;
      for (const dn of DOMS) if (dn.vis > 0.5 && wy >= dn.y - G.DG / 2 && wy <= dn.y + dn.h + G.DG / 2 && wx >= L.c.xA) return dn;
    }
    return null;
  }

  // ══ actions ════════════════════════════════════════════════════════════════════════════════════
  const refOf = (n) => ({ type: n.type, id: n.id });
  function activate(n, how) {
    if (!n) return;
    if (n.type === 'feature') { shell.peek(n.id); return; }
    if (n.type === 'product') { openProduct(); return; }
    shell.inspect(refOf(n));
    if (how === 'tap') flyToNode(n);
  }
  function openProduct() {
    const pr = BP.productRollup();
    const g = pr.gates;
    shell.select(null);
    productOpen = true;
    shell.inspector.open({
      kicker: '<nav class="ok-crumb" aria-label="Breadcrumb"><span>Product</span></nav>',
      title: esc(BP.product.name),
      subtitle: OK.html.rating(BP.productRating(S.lens), { size: 'sm', label: OK.lens(S.lens).label }) + '<span class="ok-chip ok-chip--plain">' + NF + ' features</span><span class="ok-chip ok-chip--mono">v' + esc(BP.product.version) + ' → ' + esc(BP.product.nextVersion) + '</span>',
      body: '<p class="ok-summary">' + esc(BP.product.tagline) + '.</p>' +
        '<section class="ok-sec" style="margin-top:16px"><h3 class="ok-sec__h"><span>Status</span></h3>' + OK.blocks.statusBar(pr) + '</section>' +
        '<section class="ok-sec"><h3 class="ok-sec__h"><span>Every lens</span></h3>' + OK.blocks.ratingTable({ type: 'product' }, { lens: S.lens }) + '</section>' +
        (gateTotal(g) ? '<section class="ok-sec"><h3 class="ok-sec__h"><span>Waiting for a human</span><span class="ok-mono">' + gateTotal(g) + '</span></h3>' + OK.blocks.gates(FEATS, { limit: 8 }) + '</section>' : '') +
        '<section class="ok-sec"><h3 class="ok-sec__h"><span>Areas</span></h3><ul class="ok-flist">' + BP.areas.map((a) => '<li><button type="button" class="ok-frow" data-ok-inspect="area:' + esc(a.id) + '">' + OK.html.band(BP.areaRating(a.id, S.lens).band, 13) + '<span class="ok-frow__name">' + esc(a.name) + '<span class="ok-frow__sub">' + BP.domainsOf(a.id).length + ' domains · ' + BP.areaRollup(a.id).count + ' features</span></span><span class="ok-frow__end">' + scoreTxt(BP.areaRating(a.id, S.lens)) + '</span></button></li>').join('') + '</ul></section>',
      footer: '<span class="ok-muted" style="font-size:12px">' + esc(BP.product.stack.web) + '</span>',
      onClose: () => { productOpen = false; requestDraw(); },
    });
    requestDraw();
  }
  function toggleCollapse(n) {
    if (!n || n.type === 'feature' || n.type === 'product') return;
    if (collapsed.has(n)) collapsed.delete(n); else collapsed.add(n);
    maxRowCache.clear();
    applyLayout(true);
    syncNodeBar();
    shell.announce((collapsed.has(n) ? 'Folded ' : 'Unfolded ') + n.data.name);
  }
  function expandAll() { collapsed.clear(); maxRowCache.clear(); applyLayout(true); syncNodeBar(); shell.announce('Every branch unfolded'); }
  function setFocus(n) {
    focusNode = n && n.type !== 'feature' && n.type !== 'product' ? n : null;
    mini.dirty = true;
    syncNodeBar();
    if (focusNode) { flyToNode(focusNode); shell.announce('Focused on ' + focusNode.data.name + '; the rest of the map is dimmed'); }
    else shell.announce('Focus cleared');
    requestDraw();
  }

  // ══ pointer: pan, pinch, wheel, click, double-click, tap ══════════════════════════════════════
  const ptrs = new Map();
  let drag = null, pinch = null, lastTap = { t: 0, x: 0, y: 0 };
  const localXY = (e) => { const r = M.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  M.cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    M.cv.setPointerCapture(e.pointerId);
    const [x, y] = localXY(e);
    ptrs.set(e.pointerId, { x, y });
    hideTip();
    if (ptrs.size === 2) {
      const [p, q] = Array.from(ptrs.values());
      pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2, k: cam.k, tx: cam.tx, ty: cam.ty };
      drag = null;
    } else if (ptrs.size === 1) {
      drag = { x0: x, y0: y, tx: cam.tx, ty: cam.ty, moved: false, type: e.pointerType };
    }
    anim.cam = null;
  });
  M.cv.addEventListener('pointermove', (e) => {
    const [x, y] = localXY(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x, y });
    if (pinch && ptrs.size >= 2) {
      const [p, q] = Array.from(ptrs.values());
      const d = Math.hypot(p.x - q.x, p.y - q.y), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      const k = clamp(pinch.k * (d / Math.max(1, pinch.d)), L.kMin, L.kMax);
      const wx = (pinch.mx - pinch.tx) / pinch.k, wy = (pinch.my - pinch.ty) / pinch.k;
      atFit = false;
      setCam(clampCam({ k, tx: mx - wx * k, ty: my - wy * k }));
      return;
    }
    if (drag) {
      const dx = x - drag.x0, dy = y - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) > (drag.type === 'mouse' ? 3 : 7)) { drag.moved = true; M.cv.classList.add('is-dragging'); }
      if (drag.moved) { atFit = false; setCam(clampCam({ k: cam.k, tx: drag.tx + dx, ty: drag.ty + dy })); }
      return;
    }
    if (e.pointerType === 'mouse') hover(x, y, e);
  });
  function endPointer(e, cancel) {
    const had = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) { const pm = pinch; pinch = null; drag = null; scheduleSettle(pm.mx, pm.my); } return; }
    if (!drag || !had) return;
    const d = drag;
    drag = null;
    M.cv.classList.remove('is-dragging');
    if (cancel || d.moved) return;
    const [x, y] = localXY(e);
    if (d.type === 'mouse') click(x, y);
    else tap(x, y);
  }
  M.cv.addEventListener('pointerup', (e) => endPointer(e, false));
  M.cv.addEventListener('pointercancel', (e) => endPointer(e, true));
  M.cv.addEventListener('pointerleave', () => { if (!drag) { setHover(null); hideTip(); } });
  function click(x, y) {
    kbdActive = false;
    const t = hitToggle(x, y);
    if (t) { toggleCollapse(t); return; }
    const n = hitNode(x, y, false);
    if (n) { cursorNode = n; activate(n, 'click'); }
    else { shell.select(null); if (productOpen) shell.inspector.close(); }
  }
  function tap(x, y) {
    kbdActive = false;
    const now = performance.now();
    if (now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
      lastTap.t = 0;
      zoomAt(x, y, 2, 360);
      return;
    }
    lastTap = { t: now, x, y };
    const t = hitToggle(x, y);
    if (t) { toggleCollapse(t); return; }
    const marks = lodAlphas(cam.k).a2 > 0.5;
    let n = hitNode(x, y, !marks);
    if (n && n.type === 'feature' && !marks) n = n.parent; // too small to pick one: zoom into its module
    if (n) { cursorNode = n; activate(n, n.type === 'feature' ? 'click' : 'tap'); }
    else shell.select(null);
  }
  M.cv.addEventListener('dblclick', (e) => {
    const [x, y] = localXY(e);
    if (hitToggle(x, y)) return;
    const n = hitNode(x, y, false);
    if (n && n.type === 'feature') { shell.openFeature(n.id); return; }
    if (n && n.type !== 'product') { flyToNode(n); return; }
    zoomAt(x, y, 2, 360);
  });
  M.cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = localXY(e);
    hideTip();
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2 && e.deltaMode === 0) {
      atFit = false; anim.cam = null;
      setCam(clampCam({ k: cam.k, tx: cam.tx - e.deltaX, ty: cam.ty }));
      return;
    }
    const dy = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
    const f = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016));
    zoomAt(x, y, f, 0);
    scheduleSettle(x, y);
  }, { passive: false });
  // when a zoom gesture ends between two layers, glide to the nearer layer so cards never rest half-faded
  let settleT = 0;
  function scheduleSettle(x, y) {
    clearTimeout(settleT);
    settleT = setTimeout(() => {
      const k = snapK(cam.k);
      if (Math.abs(k - cam.k) > 1e-4) zoomAt(x, y, k / cam.k, 220);
    }, 200);
  }

  // ── hover tooltip ──
  function setHover(n) { if (n !== hoverNode) { hoverNode = n; requestDraw(); } }
  function hover(x, y, e) {
    const t = hitToggle(x, y);
    if (t !== hoverToggle) { hoverToggle = t; requestDraw(); }
    const n = t ? null : hitNode(x, y, false);
    setHover(n);
    M.cv.style.cursor = t || n ? 'pointer' : 'grab';
    if (t) { showTip((collapsed.has(t) ? 'Unfold ' : 'Fold ') + esc(t.data.name), x, y); return; }
    if (!n) { hideTip(); return; }
    const k = cam.k;
    // the card itself already says it all from card level on
    if (n.type === 'feature' && k >= L.t3 * 0.95) { hideTip(); return; }
    showTip(tipHTML(n), x, y);
  }
  let tipKey = '';
  function tipHTML(n) {
    const lens = S.lens, ln = OK.lens(lens).label;
    if (n.type === 'feature') {
      const f = n.data, r = BP.rating(f, lens);
      const g = fGates[n.fi];
      return '<div class="ca-tip__k">' + esc(BP.pathOf(f).module.name) + '</div><div class="ca-tip__t">' + OK.html.status(f.status, 12) + esc(f.name) + '</div>' +
        '<div class="ca-tip__r">' + OK.html.rating(r, { size: 'sm', label: ln }) + '<span>' + esc(r.headline || '') + '</span></div>' +
        (g.length ? '<div class="ca-tip__g">' + OK.html.gate(g[0].kind, 12) + esc(OK.labels.gate[g[0].kind].long + (g.length > 1 ? ' + ' + (g.length - 1) + ' more' : '')) + '</div>' : '') +
        (fAttn[n.fi] ? '<div class="ca-tip__a">' + OK.html.attention(12) + 'Needs attention</div>' : '');
    }
    if (n.type === 'product') return '<div class="ca-tip__k">Product</div><div class="ca-tip__t">' + esc(BP.product.name) + '</div><div class="ca-tip__r">' + OK.html.rating(BP.productRating(lens), { size: 'sm', label: ln }) + '<span>' + esc(ln) + ' across ' + NF + ' features</span></div>';
    const r = OK.nodeRating({ type: n.type, id: n.id }, lens), roll = OK.nodeRollup({ type: n.type, id: n.id });
    return '<div class="ca-tip__k">' + (n.type === 'area' ? 'Area' : n.type === 'domain' ? 'Domain' : 'Module') + ' · ' + roll.count + ' features</div><div class="ca-tip__t">' + esc(n.data.name) + '</div>' +
      '<div class="ca-tip__r">' + OK.html.rating(r, { size: 'sm', label: ln }) + '<span>' + r.counts.good + ' good · ' + r.counts.fair + ' fair · ' + r.counts.poor + ' poor · ' + r.counts.critical + ' critical</span></div>' +
      '<div class="ca-tip__h">Click to inspect, double-click to zoom in</div>';
  }
  function showTip(html, x, y) {
    if (html !== tipKey) { M.tip.innerHTML = html; tipKey = html; }
    M.tip.hidden = false;
    const left = x + 16 + 300 > SW ? x - 16 - 300 : x + 16;
    M.tip.style.transform = 'translate(' + Math.round(Math.max(6, left)) + 'px,' + Math.round(clamp(y + 14, 6, SH - 110)) + 'px)';
  }
  function hideTip() { if (!M.tip.hidden) M.tip.hidden = true; }

  // ══ keyboard: tree navigation, zoom, fold, focus, gates queue ══════════════════════════════════
  const ORDER = { area: AREAS, domain: DOMS, module: MODS };
  function visibleList(type) { return (ORDER[type] || []).filter((n) => n.tvis > 0.5); }
  function navigate(key) {
    let n = cursorNode || (selNode && selNode.vis > 0.5 ? selNode : null) || ROOT;
    let next = null;
    if (n.type === 'product') {
      if (key === 'ArrowRight' || key === 'ArrowDown') next = AREAS[0];
    } else if (n.type === 'feature') {
      const mn = n.parent;
      const idx = mn.kids.indexOf(n);
      if (key === 'ArrowLeft') next = n.col === 0 ? mn : mn.kids[idx - 1];
      else if (key === 'ArrowRight') next = mn.kids[idx + 1] && mn.kids[idx + 1].row === n.row ? mn.kids[idx + 1] : null;
      else {
        // the card in the row above or below, nearest by column, across module borders
        const rows = [];
        MODS.forEach((m) => { if (m.tvis < 0.5 || collapsed.has(m)) return; for (let r = 0; r < m.rows; r++) rows.push(m.kids.slice(r * m.per, (r + 1) * m.per)); });
        const ri = rows.findIndex((row) => row.includes(n));
        const target = rows[ri + (key === 'ArrowDown' ? 1 : -1)];
        if (target) next = target[Math.min(n.col, target.length - 1)];
      }
    } else {
      const list = visibleList(n.type);
      const i = list.indexOf(n);
      if (key === 'ArrowUp') next = list[i - 1];
      else if (key === 'ArrowDown') next = list[i + 1];
      else if (key === 'ArrowLeft') next = n.parent;
      else if (key === 'ArrowRight') {
        if (collapsed.has(n)) { toggleCollapse(n); }
        next = n.kids[0] || null;
      }
    }
    if (!next) return;
    moveCursor(next);
  }
  function moveCursor(n) {
    cursorNode = n;
    kbdActive = true;
    const follow = shell.inspector.isOpen();
    if (n.type === 'product') { if (follow) openProduct(); else shell.select(null); }
    else if (follow) activate(n, 'key');
    else shell.select(refOf(n));
    keepInView(n);
    shell.announce(describe(n));
    requestDraw();
  }
  function describe(n) {
    if (n.type === 'product') return BP.product.name + ', product. ' + OK.lens(S.lens).label + ' ' + scoreTxt(BP.productRating(S.lens));
    if (n.type === 'feature') { const r = BP.rating(n.data, S.lens); return n.data.name + ', ' + OK.statusLabel(n.data.status) + '. ' + OK.lens(S.lens).label + ' ' + (r.band === 'na' ? 'not applicable' : OK.bandLabel(r.band) + ' ' + scoreTxt(r)) + (fGates[n.fi].length ? '. ' + fGates[n.fi].length + ' waiting for a human' : ''); }
    const r = OK.nodeRating({ type: n.type, id: n.id }, S.lens);
    return n.data.name + ', ' + n.type + (collapsed.has(n) ? ', folded' : '') + '. ' + OK.lens(S.lens).label + ' ' + (r.band === 'na' ? 'not applicable' : OK.bandLabel(r.band) + ' ' + scoreTxt(r));
  }
  function keepInView(n) {
    const r = freeRect();
    const k = cam.k;
    if (n.type === 'feature' && k < L.t2) { flyToNode(n, { k: L.t3 * 1.05, ms: 380 }); return; }
    const x0 = toSX(n.x), y0 = toSY(n.y), x1 = toSX(n.x + n.w), y1 = toSY(n.y + n.h);
    const m = 30;
    let dx = 0, dy = 0;
    if (x1 > r.x + r.w - m) dx = r.x + r.w - m - x1;
    if (x0 + dx < r.x + m) dx = r.x + m - x0;
    if (y1 - y0 < r.h - m * 2) { if (y1 > r.y + r.h - m - 40) dy = r.y + r.h - m - 40 - y1; if (y0 + dy < r.y + m) dy = r.y + m - y0; }
    else if (y0 > r.y + r.h - m || y1 < r.y + m) dy = r.y + m - y0;
    if (dx || dy) { atFit = false; flyTo({ k, tx: cam.tx + dx, ty: cam.ty + dy }, 260); }
  }
  const typing = (t) => t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!e.defaultPrevented && S.view === 'map' && !S.page && focusNode) { setFocus(null); e.preventDefault(); }
      return;
    }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (typing(t) || S.page) return;
    if (t && t.closest && t.closest('.ok-insp, .ok-legend, .ok-sheet, .ok-search, .ok-ini-pop, .ok-page')) return;
    if (S.view === 'timeline') { tlKey(e); return; }
    const onBtn = t && t.closest && t.closest('button, a, [role="button"]');
    const k = e.key;
    if (k === '+' || k === '=') { zoomToK(cam.k * 1.6); e.preventDefault(); }
    else if (k === '-' || k === '_') { zoomToK(cam.k / 1.6); e.preventDefault(); }
    else if (k === '0') { fitAll(); e.preventDefault(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      if (onBtn && !t.closest('.ca-map')) return;
      if (onBtn && t.closest('.ca-zoom, .ca-q, .ca-node')) return;
      navigate(k); e.preventDefault();
    } else if ((k === 'f' || k === 'F') && !onBtn) {
      const n = cursorNode || selNode;
      if (focusNode && (!n || n === focusNode)) setFocus(null); else if (n && n.type !== 'feature' && n.type !== 'product') setFocus(n); else if (n && n.type === 'feature') setFocus(n.parent);
      e.preventDefault();
    } else if (k === ' ' && !onBtn) {
      const n = cursorNode || selNode;
      if (n && n.type === 'feature') shell.peek(n.id); else if (n) toggleCollapse(n);
      e.preventDefault();
    } else if (k === ']' || k === '[') { stepQueue(k === ']' ? 1 : -1); e.preventDefault(); }
    else if (k === 'Enter' && !onBtn) {
      const n = cursorNode || selNode;
      if (n && n.type !== 'feature') { if (n.type === 'product') openProduct(); else shell.inspect(refOf(n)); e.preventDefault(); }
    }
  });
  M.cv.addEventListener('focus', () => { if (!cursorNode) cursorNode = selNode || ROOT; kbdActive = true; requestDraw(); });
  M.cv.addEventListener('blur', () => { kbdActive = false; requestDraw(); });

  // ══ HUD: node bar, gates queue, location readout, zoom levels ══════════════════════════════════
  function syncNodeBar() {
    const n = selNode && selNode.type !== 'feature' ? selNode : null;
    let h = '';
    if (focusNode) {
      h = '<span class="ca-node__k">Focused on</span><span class="ca-node__t">' + esc(focusNode.data.name) + '</span>' +
        '<button type="button" class="ok-btn ok-btn--sm" data-ca="unfocus" title="Show the whole map again (F or Esc)">' + I('close', 11) + 'Clear focus</button>';
    } else if (n && n.type !== 'product') {
      h = '<span class="ca-node__k">' + (n.type === 'area' ? 'Area' : n.type === 'domain' ? 'Domain' : 'Module') + '</span><span class="ca-node__t">' + esc(n.data.name) + '</span>' +
        '<button type="button" class="ok-btn ok-btn--sm" data-ca="focus" title="Dim everything outside this branch (F)">' + I('locate', 12) + 'Focus branch</button>' +
        '<button type="button" class="ok-btn ok-btn--sm" data-ca="fold" title="Fold or unfold this branch (Space)">' + (collapsed.has(n) ? 'Unfold' : 'Fold') + '</button>';
    }
    if (collapsed.size) h += '<button type="button" class="ok-btn ok-btn--sm ok-btn--quiet" data-ca="expand-all" title="Unfold every branch">Unfold all <span class="ok-mono">' + collapsed.size + '</span></button>';
    if (h !== M.node.__h) { M.node.innerHTML = h; M.node.__h = h; }
    M.node.hidden = !h;
  }
  M.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ca]');
    if (!b) return;
    const what = b.getAttribute('data-ca');
    if (what === 'unfocus') setFocus(null);
    else if (what === 'focus' && selNode) setFocus(selNode);
    else if (what === 'fold' && selNode) toggleCollapse(selNode);
    else if (what === 'expand-all') expandAll();
  });

  // gates queue: features waiting for a human, longest wait first; narrowed by the gates filter
  let queue = [], qi = -1;
  function buildQueue() {
    const kind = S.gates && S.gates !== 'any' ? S.gates : null;
    const filtering = shell.filterActive();
    queue = [];
    for (let i = 0; i < NF; i++) {
      const gs = fGates[i];
      if (!gs.length) continue;
      const g = kind ? gs.find((x) => x.kind === kind) : gs[0];
      if (!g) continue;
      if (filtering && fDim[i]) continue;
      queue.push({ i, g, wait: g.waitingDays });
    }
    queue.sort((a, b) => b.wait - a.wait || a.i - b.i);
    const cur = selNode && selNode.type === 'feature' ? queue.findIndex((q) => q.i === selNode.fi) : -1;
    qi = cur;
    renderQueue();
  }
  function renderQueue() {
    const n = queue.length;
    const cur = qi >= 0 ? queue[qi] : null;
    const phone = SW && SW <= 760;
    let h = '<button type="button" class="ca-q__btn" data-q="-1" aria-label="Previous feature waiting for a human" title="Previous ([)"' + (n ? '' : ' disabled') + '>' + chev(-1) + '</button>' +
      '<button type="button" class="ca-q__main" data-q="0" title="Gates queue: features waiting for a human, longest wait first">' + OK.html.gate(cur ? cur.g.kind : 'approval', 14) +
      (cur ? '<span class="ca-q__pos ok-mono">' + (qi + 1) + '<i>/</i>' + n + '</span><span class="ca-q__cur"><b>' + esc(FEATS[cur.i].name) + '</b><span>' + esc(OK.labels.gate[cur.g.kind].long) + ' · ' + (cur.wait === 0 ? 'today' : cur.wait + ' d') + '</span></span>'
        : '<span class="ca-q__t">' + (phone ? 'Queue' : 'Gates queue') + '</span><span class="ca-q__n ok-mono">' + n + '</span>') + '</button>' +
      '<button type="button" class="ca-q__btn" data-q="1" aria-label="Next feature waiting for a human" title="Next (])"' + (n ? '' : ' disabled') + '>' + chev(1) + '</button>';
    if (h !== M.q.__h) { M.q.innerHTML = h; M.q.__h = h; }
    M.q.classList.toggle('is-active', !!cur);
  }
  const chev = (d) => '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="' + (d < 0 ? 'M10 3.5L5.5 8l4.5 4.5' : 'M6 3.5L10.5 8 6 12.5') + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function stepQueue(d) {
    if (!queue.length) return;
    qi = qi < 0 ? (d > 0 ? 0 : queue.length - 1) : (qi + d + queue.length) % queue.length;
    const q = queue[qi];
    const fn = featNode[q.i];
    ensureVisible(fn);
    cursorNode = fn;
    shell.peek(fn.id);
    renderQueue();
    requestAnimationFrame(() => { freeR = shell.freeRect(); flyToNode(fn, { k: L.t3 * 1.1 }); });
    shell.announce('Waiting for a human, ' + (qi + 1) + ' of ' + queue.length + ': ' + FEATS[q.i].name + ', ' + OK.labels.gate[q.g.kind].long.toLowerCase() + ', ' + q.wait + ' days');
  }
  M.q.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const d = +b.getAttribute('data-q');
    if (d === 0) { if (qi >= 0) { const fn = featNode[queue[qi].i]; flyToNode(fn, { k: L.t3 * 1.1 }); shell.peek(fn.id); } else stepQueue(1); }
    else stepQueue(d);
  });

  // location readout and zoom level dots
  let locKey = '', lvlKey = -1;
  function syncHUD() {
    const k = cam.k;
    const lvl = levelOf(k);
    if (lvl !== lvlKey) {
      lvlKey = lvl;
      M.lvls.forEach((b, i) => { b.classList.toggle('is-on', i <= lvl); b.setAttribute('aria-pressed', String(i === lvl)); });
      M.locLvl.textContent = LEVELS[lvl].name;
    }
    const r = freeRect();
    const wx = toWX(r.x + r.w / 2), wy = toWY(r.y + r.h / 2);
    let path = [];
    if (lvl === 0) path = [BP.product.name + ' · whole product'];
    else {
      let best = null;
      for (const mn of MODS) if (mn.vis > 0.5 && wy >= mn.y - G.MG && wy <= mn.y + mn.h + G.MG) { best = mn; break; }
      if (!best) for (const dn of DOMS) if (dn.vis > 0.5 && wy >= dn.y - G.DG && wy <= dn.y + dn.h + G.DG) { best = dn; break; }
      if (!best) for (const an of AREAS) if (wy >= an.y - L.P.AG && wy <= an.y + an.h) { best = an; break; }
      if (best && wx > L.c.xA - 40) { for (let p = best; p && p !== ROOT; p = p.parent) path.unshift(p.data.name); }
      else path = [BP.product.name];
    }
    const key = path.join('|');
    if (key !== locKey) {
      locKey = key;
      M.locPath.innerHTML = path.map((p, i) => (i ? '<i>›</i>' : '') + '<span>' + esc(p) + '</span>').join('');
    }
  }
  M.root.querySelector('.ca-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-z], [data-lvl]');
    if (!b) return;
    if (b.hasAttribute('data-lvl')) { const l = LEVELS[+b.getAttribute('data-lvl')]; if (l.id === 0) fitAll(); else zoomToK(l.k()); return; }
    const z = b.getAttribute('data-z');
    if (z === 'fit') fitAll(); else zoomToK(cam.k * (z === 'in' ? 1.6 : 1 / 1.6));
  });

  // ══ sizing and boot ════════════════════════════════════════════════════════════════════════════
  function resize(w, h) {
    if (!w || !h) return;
    const changed = w !== SW || h !== SH;
    SW = w; SH = h;
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    M.cv.width = Math.round(w * DPR); M.cv.height = Math.round(h * DPR);
    M.cv.style.width = w + 'px'; M.cv.style.height = h + 'px';
    const arr = chooseArrangement(w, h);
    L.pad = arr.pad;
    const first = !ready;
    if (arr.key !== L.key) {
      // a new size class: lay out again (positions are fixed within a class)
      const center = ready ? { x: toWX(SW / 2), y: toWY(SH / 2), rel: cam.k / L.kFit } : null;
      L.key = arr.key; L.P = arr.P;
      maxRowCache.clear();
      applyLayout(false);
      setLOD(fitCam(L.bounds, { x: 0, y: 0, w, h }, arr.pad).k);
      mini.shown = w > 760;
      sizeMini();
      ready = true;
      if (first || atFit || !center) fitAll(0);
      else { const k = clamp(center.rel * L.kFit, L.kMin, L.kMax); setCam(clampCam({ k, tx: SW / 2 - center.x * k, ty: SH / 2 - center.y * k })); }
    } else if (changed) {
      setLOD(fitCam(L.bounds, { x: 0, y: 0, w, h }, arr.pad).k);
      mini.shown = w > 760;
      sizeMini();
      if (atFit) fitAll(0); else { clampCam(cam); requestDraw(); }
    }
    freeR = { x: 0, y: 0, w: SW, h: SH };
    if (shell.inspector.isOpen()) requestAnimationFrame(() => { freeR = shell.freeRect(); });
    renderQueue();
    requestDraw();
  }
  const ro = new ResizeObserver((entries) => {
    entries.forEach((en) => {
      if (en.target === shell.mapEl) { const cr = en.contentRect; if (cr.width && cr.height) resize(Math.round(cr.width), Math.round(cr.height)); }
      else if (en.target === shell.timelineEl) tlResize(en.contentRect);
    });
  });
  ro.observe(shell.mapEl);
  ro.observe(shell.timelineEl);

  // ══ shell events ═══════════════════════════════════════════════════════════════════════════════
  shell.on('lens', () => { refreshLens(); mini.dirty = true; requestDraw(); tlPaintLens(); });
  shell.on('filter', () => { refreshFilter(); mini.dirty = true; buildQueue(); requestDraw(); tlPaintFilter(); });
  shell.on('select', (sel) => {
    const n = nodeOf(sel);
    selNode = n;
    if (n) cursorNode = n;
    if (sel && productOpen) productOpen = false;
    computeDeps();
    if (sel && sel.type === 'feature') { const qq = queue.findIndex((q) => q.i === FIDX.get(sel.id)); if (qq !== qi) { qi = qq; renderQueue(); } }
    else if (qi >= 0) { qi = -1; renderQueue(); }
    syncNodeBar();
    requestDraw();
    tlPaintSel();
  });
  shell.on('locate', (ref) => {
    const n = nodeOf(ref);
    if (!n) return;
    if (S.view !== 'map') { tlLocate(ref); return; }
    ensureVisible(n);
    // measure the free area after the inspector has opened, then fly
    requestAnimationFrame(() => { freeR = shell.freeRect(); flyToNode(n); });
  });
  shell.on('inspector', (p) => {
    if (!p.open) { freeR = { x: 0, y: 0, w: SW, h: SH }; if (productOpen) { productOpen = false; requestDraw(); } return; }
    requestAnimationFrame(() => { freeR = shell.freeRect(); revealSelection(); });
  });
  shell.on('theme', () => { readTokens(); mini.dirty = true; twCache.clear(); requestDraw(); });
  shell.on('view', (v) => {
    hideTip();
    if (v.view === 'map') { requestDraw(); }
    else tlEnsure();
  });
  shell.on('feature-close', () => { const n = nodeOf(S.selection); if (n !== selNode) { selNode = n; computeDeps(); requestDraw(); } });

  readTokens();
  refreshLens();
  refreshFilter();
  buildQueue();
  syncNodeBar();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { twCache.clear(); fitCache.clear(); requestDraw(); });
  // a font that arrives late (or a theme switched by the system) still repaints
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { twCache.clear(); fitCache.clear(); requestDraw(); });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ══ TIMELINE: release swimlanes ═══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const RELS = BP.releasesInOrder();
  const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
  const ASOF = BP.asOf || BP.data.meta.asOf;
  const D0 = dayNum(RELS[0].date) - 26, D1 = dayNum(RELS[RELS.length - 1].date) + 30;
  const NEXT = RELS.find((r) => r.state === 'next');
  // items per (domain, release) in package order: fixed, never re-sorted
  const cellItems = new Map();
  RELS.forEach((r) => {
    BP.releaseItems(r.id).forEach((it) => {
      const d = BP.pathOf(it.feature).domain.id;
      const key = d + '|' + r.id;
      if (!cellItems.has(key)) cellItems.set(key, []);
      cellItems.get(key).push(it);
    });
  });
  const TL = { built: false, zoom: 'fit', vw: 0, vh: 0, pxDay: 2, colW: 80, mode: 'sq', laneW: 196, chips: [], byF: new Map(), lanes: [], el: null, scroll: null, inner: null, svg: null, x: null, headH: 92 };
  const relMinGap = (() => { let g = 1e9; for (let i = 1; i < RELS.length; i++) g = Math.min(g, dayNum(RELS[i].date) - dayNum(RELS[i - 1].date)); return g; })();
  shell.timelineEl.innerHTML = '<div class="ca-tl"><div class="ca-tl__bar"><div class="ca-tl__title"><span class="ok-cap">Release swimlanes</span><span class="ca-tl__sub"></span></div>' +
    '<div class="ca-tl__ctl" role="group" aria-label="Time scale">' +
      '<button type="button" class="ca-seg" data-tz="fit" aria-pressed="true" title="Every release in view">Overview</button>' +
      '<button type="button" class="ca-seg" data-tz="detail" aria-pressed="false" title="Wider columns with feature names">Names</button>' +
    '</div></div><div class="ca-tl__scroll" tabindex="0" aria-label="Release swimlanes: domains as lanes, releases as columns"></div></div>';
  TL.el = shell.timelineEl.querySelector('.ca-tl');
  TL.scroll = shell.timelineEl.querySelector('.ca-tl__scroll');
  TL.sub = shell.timelineEl.querySelector('.ca-tl__sub');
  const shippedN = RELS.filter((r) => r.state === 'shipped').length;
  TL.sub.textContent = shippedN + ' shipped · ' + (NEXT ? NEXT.label + ' next on ' + OK.fmt.dateShort(NEXT.date) : '') + ' · ' + RELS.filter((r) => r.state === 'future').length + ' planned';

  function tlResize(cr) {
    const w = Math.round(cr.width), h = Math.round(cr.height);
    if (!w || !h) return;
    const changed = Math.abs(w - TL.vw) > 2;
    TL.vw = w; TL.vh = h;
    if (S.view === 'timeline' && (changed || !TL.built)) tlBuild();
  }
  function tlEnsure() { if (!TL.built && TL.vw) tlBuild(); }
  const tlX = (day) => TL.laneW + 18 + (day - D0) * TL.pxDay;
  function tlBuild() {
    const phone = TL.vw <= 760;
    TL.laneW = phone ? 112 : TL.vw < 1100 ? 168 : 188;
    const span = D1 - D0;
    const fitPx = (TL.vw - TL.laneW - 34) / span;
    if (TL.zoom === 'fit') TL.pxDay = phone ? Math.max(fitPx, 1.55) : Math.max(fitPx, 1.05);
    else TL.pxDay = Math.max(fitPx, phone ? 4.2 : 4.9);
    TL.colW = Math.floor(relMinGap * TL.pxDay - (phone ? 6 : 10));
    TL.mode = TL.colW >= 150 ? 'named' : 'sq';
    const s = TL.mode === 'named' ? 21 : TL.colW >= 100 ? 16 : TL.colW >= 50 ? 14 : 12;
    const gap = TL.mode === 'named' ? 3 : TL.colW >= 50 ? 3 : 2;
    const per = TL.mode === 'named' ? 1 : Math.max(1, Math.floor((TL.colW - 8 + gap) / (s + gap)));
    TL.s = s; TL.gap = gap; TL.per = per;
    // lanes: the 17 domains in tree order, grouped by area
    let y = 0;
    const lanes = [];
    const AH = phone ? 24 : 28;
    BP.areas.forEach((a) => {
      lanes.push({ kind: 'area', a, y, h: AH });
      y += AH;
      BP.domainsOf(a.id).forEach((d) => {
        let rows = 1;
        RELS.forEach((r) => { const n = (cellItems.get(d.id + '|' + r.id) || []).length; rows = Math.max(rows, Math.ceil(n / per)); });
        const h = Math.max(phone ? 44 : 40, rows * (s + gap) - gap + 18);
        lanes.push({ kind: 'domain', d, y, h });
        y += h;
      });
    });
    const bodyH = y + 24;
    const W = Math.max(TL.vw, Math.ceil(tlX(D1) + 16));
    TL.lanes = lanes;
    TL.W = W; TL.bodyH = bodyH;
    const headH = TL.headH = TL.mode === 'named' ? 128 : 100;
    // ── head: months, today, release headers ──
    let head = '<div class="ca-tl__corner" style="width:' + TL.laneW + 'px"><span class="ok-cap">Domains</span><span class="ca-tl__cornersub">Releases ›</span></div>';
    const m0 = new Date(D0 * 86400000);
    let mm = Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 1, 1) / 86400000;
    while (mm < D1) {
      const dt = new Date(mm * 86400000);
      const x = tlX(mm);
      const jan = dt.getUTCMonth() === 0;
      const lab = jan ? String(dt.getUTCFullYear()) : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
      const tX = tlX(dayNum(ASOF));
      const showLab = (TL.pxDay * 30 > 26 || jan) && (x < tX - 78 || x > tX + 48);
      head += '<span class="ca-tl__month' + (jan ? ' is-year' : '') + '" style="left:' + x.toFixed(1) + 'px">' + (showLab ? lab : '') + '</span>';
      mm = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / 86400000;
    }
    const todayX = tlX(dayNum(ASOF));
    head += '<span class="ca-tl__today-h" style="left:' + todayX.toFixed(1) + 'px"><b>Today</b> ' + esc(OK.fmt.dateShort(ASOF)) + '</span>';
    RELS.forEach((r) => {
      const cx = tlX(dayNum(r.date));
      const w = TL.colW;
      const items = BP.releaseItems(r.id);
      let inner;
      const wide = w >= 118, mid = w >= 56;
      if (wide) {
        inner = '<span class="ca-rh__v ok-mono">' + esc(r.label) + '</span><span class="ca-rh__n">' + esc(r.name) + '</span>' +
          '<span class="ca-rh__d ok-mono">' + esc(OK.fmt.dateShort(r.date)) + (r.date.slice(0, 4) !== '2026' ? ' ' + r.date.slice(2, 4) : '') + '</span><span class="ca-rh__d ok-mono">' + items.length + ' items</span>';
      } else if (mid) inner = '<span class="ca-rh__v ok-mono">' + esc(r.label) + '</span><span class="ca-rh__d ok-mono">' + esc(OK.fmt.dateShort(r.date)) + '</span><span class="ca-rh__d ok-mono">' + items.length + '</span>';
      else inner = '<span class="ca-rh__v ok-mono">' + esc(r.id) + '</span><span class="ca-rh__d ok-mono">' + items.length + '</span>';
      if (r.state === 'next') inner += wide ? readinessHTML(r) : readinessBar(r);
      head += '<button type="button" class="ca-rh is-' + r.state + '" data-rel="' + esc(r.id) + '" style="left:' + (cx - w / 2).toFixed(1) + 'px;width:' + w + 'px" title="' + esc(r.label + ' ' + r.name + ' · ' + OK.fmt.date(r.date) + ' · ' + (r.state === 'shipped' ? 'shipped' : r.state === 'next' ? 'next release' : 'planned') + ' · ' + items.length + ' items. Click to inspect the package.') + '">' +
        (r.state === 'next' ? '<span class="ca-rh__tag">Next</span>' : r.state === 'future' && wide ? '<span class="ca-rh__tag is-future">Planned</span>' : '') + inner + '</button>';
    });
    // ── lanes (sticky left) ──
    let lanesH = '';
    lanes.forEach((ln) => {
      if (ln.kind === 'area') lanesH += '<div class="ca-ln ca-ln--area" style="top:' + ln.y + 'px;height:' + ln.h + 'px"><span class="ok-cap">' + esc(ln.a.name) + '</span></div>';
      else lanesH += '<button type="button" class="ca-ln ca-ln--dom" data-ok-inspect="domain:' + esc(ln.d.id) + '" style="top:' + ln.y + 'px;height:' + ln.h + 'px" title="' + esc(ln.d.name + ': inspect the domain') + '"><span class="ca-ln__name">' + esc(ln.d.name) + '</span><span class="ca-ln__r" data-dr="' + esc(ln.d.id) + '"></span></button>';
    });
    // ── grid: column bands, lane stripes, today line, chips ──
    let grid = '';
    lanes.forEach((ln, i) => { if (ln.kind === 'area') grid += '<div class="ca-tg__area" style="top:' + ln.y + 'px;height:' + ln.h + 'px"></div>'; else if (i % 2 === 0) grid += '<div class="ca-tg__stripe" style="top:' + ln.y + 'px;height:' + ln.h + 'px"></div>'; });
    RELS.forEach((r) => {
      const cx = tlX(dayNum(r.date));
      grid += '<div class="ca-tg__col is-' + r.state + '" data-relcol="' + esc(r.id) + '" style="left:' + (cx - TL.colW / 2).toFixed(1) + 'px;width:' + TL.colW + 'px"></div>';
    });
    grid += '<div class="ca-tg__future" style="left:' + todayX.toFixed(1) + 'px"></div><div class="ca-tg__today" style="left:' + todayX.toFixed(1) + 'px"></div>';
    TL.chips = []; TL.byF = new Map();
    let chipsH = '';
    lanes.forEach((ln) => {
      if (ln.kind !== 'domain') return;
      RELS.forEach((r) => {
        const items = cellItems.get(ln.d.id + '|' + r.id) || [];
        const left = tlX(dayNum(r.date)) - TL.colW / 2 + 4;
        items.forEach((it, j) => {
          const col = j % per, row = Math.floor(j / per);
          const x = TL.mode === 'named' ? left : left + col * (s + gap);
          const yy = ln.y + 9 + row * (s + gap);
          const f = BP.feature(it.feature);
          const fi = FIDX.get(f.id);
          const showStatus = r.state !== 'shipped' && it.kind === 'new';
          const glyph = showStatus ? OK.html.status(f.status, TL.mode === 'named' ? 13 : Math.max(9, s - 3)) : OK.svg.wrap(OK.svg.releaseKind(it.kind, 5), 5.2, TL.mode === 'named' ? 13 : s - 2, 'ca-tc__k');
          const kindLab = OK.labels.releaseKind[it.kind];
          const title = f.name + ' · ' + kindLab + ' in ' + r.label + (showStatus ? ' · ' + OK.statusLabel(f.status) : '') + (it.note ? ' · ' + it.note : '');
          chipsH += '<button type="button" class="ca-tc is-' + r.state + (showStatus ? ' is-st is-' + f.status : '') + ' k-' + it.kind + '" data-f="' + esc(f.id) + '" data-band="' + fBand[fi] + '" style="left:' + x.toFixed(1) + 'px;top:' + yy + 'px' + (TL.mode === 'named' ? ';width:' + (TL.colW - 8) + 'px' : '') + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' + glyph +
            (TL.mode === 'named' ? '<span class="ca-tc__n">' + esc(f.name) + '</span>' : '') + '</button>';
          const c = { f: f.id, fi, x: x + (TL.mode === 'named' ? 9 : s / 2), y: yy + s / 2, rel: r.id };
          TL.chips.push(c);
          if (!TL.byF.has(f.id)) TL.byF.set(f.id, []);
          TL.byF.get(f.id).push(c);
        });
      });
    });
    TL.scroll.innerHTML = '<div class="ca-tl__inner ' + (TL.mode === 'named' ? 'is-named' : 'is-sq') + '" style="width:' + W + 'px;--tl-s:' + s + 'px">' +
      '<div class="ca-tl__head" style="width:' + W + 'px;height:' + headH + 'px">' + head + '</div>' +
      '<div class="ca-tl__body" style="width:' + W + 'px;height:' + bodyH + 'px">' +
        '<div class="ca-tl__lanes" style="width:' + TL.laneW + 'px;height:' + bodyH + 'px">' + lanesH + '</div>' +
        '<div class="ca-tl__grid" style="width:' + W + 'px;height:' + bodyH + 'px">' + grid + '<svg class="ca-tl__life" width="' + W + '" height="' + bodyH + '" aria-hidden="true"></svg>' + chipsH + '</div>' +
      '</div></div>';
    TL.inner = TL.scroll.firstChild;
    TL.svg = TL.scroll.querySelector('.ca-tl__life');
    TL.chipEls = Array.from(TL.scroll.querySelectorAll('.ca-tc'));
    TL.laneEls = Array.from(TL.scroll.querySelectorAll('[data-dr]'));
    TL.built = true;
    TL.el.querySelectorAll('[data-tz]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-tz') === TL.zoom)));
    tlPaintLens(); tlPaintFilter(); tlPaintSel();
    // open on the present: today, the next release and the future in view
    const want = tlX(dayNum(ASOF)) - TL.laneW - (TL.vw - TL.laneW) * 0.55;
    TL.scroll.scrollLeft = Math.max(0, Math.min(W - TL.vw, want));
  }
  function readiness(r) {
    const c = { ready: 0, building: 0, blocked: 0, planned: 0 };
    BP.releaseItems(r.id).forEach((it) => { if (it.kind !== 'new') return; const f = BP.feature(it.feature); c[f.status] = (c[f.status] || 0) + 1; });
    return c;
  }
  function readinessHTML(r) {
    const c = readiness(r);
    const part = (s) => (c[s] ? '<span class="ca-rd">' + OK.html.status(s, 10) + '<span class="ok-mono">' + c[s] + '</span></span>' : '');
    return '<span class="ca-rh__ready">' + part('ready') + part('building') + part('blocked') + part('planned') + '</span>';
  }
  /** Narrow columns: readiness as a segmented bar (ready, in build, blocked, planned). */
  function readinessBar(r) {
    const c = readiness(r);
    const tot = c.ready + c.building + c.blocked + c.planned || 1;
    return '<span class="ca-rbar" title="' + esc(c.ready + ' ready · ' + c.building + ' in build · ' + c.blocked + ' blocked' + (c.planned ? ' · ' + c.planned + ' planned' : '')) + '">' +
      ['ready', 'building', 'blocked', 'planned'].map((s) => (c[s] ? '<i class="is-' + s + '" style="width:' + (100 * c[s] / tot).toFixed(1) + '%"></i>' : '')).join('') + '</span>';
  }
  function tlPaintLens() {
    if (!TL.built) return;
    TL.chipEls.forEach((el, j) => el.setAttribute('data-band', fBand[TL.chips[j].fi]));
    TL.laneEls.forEach((el) => { const r = BP.domainRating(el.getAttribute('data-dr'), S.lens); el.innerHTML = OK.html.band(r.band, 12) + '<span class="ok-mono">' + scoreTxt(r) + '</span>'; });
  }
  function tlPaintFilter() {
    if (!TL.built) return;
    TL.chipEls.forEach((el, j) => { const i = TL.chips[j].fi; el.classList.toggle('is-dim', !!fDim[i]); el.classList.toggle('is-hit', !!fHit[i]); });
  }
  function tlPaintSel() {
    if (!TL.built) return;
    TL.scroll.querySelectorAll('.ca-tc.is-sel, .ca-rh.is-sel, .ca-tg__col.is-sel').forEach((el) => el.classList.remove('is-sel'));
    const sel = S.selection;
    let path = '';
    if (sel && sel.type === 'feature') {
      const cs = TL.byF.get(sel.id) || [];
      TL.chipEls.forEach((el, j) => { if (TL.chips[j].f === sel.id) el.classList.add('is-sel'); });
      if (cs.length > 1) {
        path = '<path d="M' + cs.map((c) => c.x.toFixed(1) + ' ' + c.y.toFixed(1)).join('L') + '" class="ca-life"/>' + cs.map((c) => '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="2" class="ca-life-dot"/>').join('');
      }
    } else if (sel && sel.type === 'release') {
      const h = TL.scroll.querySelector('.ca-rh[data-rel="' + sel.id + '"]');
      if (h) h.classList.add('is-sel');
      const rel = BP.release(sel.id);
      if (rel && S.view === 'timeline') {
        // after the inspector has opened, scroll the column out from under it (measured in the next frame)
        requestAnimationFrame(() => {
          const fr = shell.freeRect();
          const cx = tlX(dayNum(rel.date));
          const sl = TL.scroll.scrollLeft;
          const left = TL.laneW + 12, right = fr.w - 16;
          const x0 = cx - TL.colW / 2 - sl, x1 = cx + TL.colW / 2 - sl;
          if (x1 > right || x0 < left) TL.scroll.scrollTo({ left: Math.max(0, cx - TL.laneW - (right - TL.laneW) * 0.62), behavior: reduced() ? 'auto' : 'smooth' });
        });
      }
      const c = TL.scroll.querySelector('.ca-tg__col[data-relcol="' + sel.id + '"]');
      if (c) c.classList.add('is-sel');
    }
    TL.svg.innerHTML = path;
  }
  function tlLocate(ref) {
    if (!TL.built || ref.type !== 'feature') return;
    const cs = TL.byF.get(ref.id);
    if (!cs || !cs.length) return;
    const c = cs[cs.length - 1];
    TL.scroll.scrollTo({ left: Math.max(0, c.x - TL.laneW - (TL.vw - TL.laneW) / 2), top: Math.max(0, c.y + TL.headH - TL.vh / 2), behavior: reduced() ? 'auto' : 'smooth' });
  }
  function tlKey(e) {
    const k = e.key;
    if (k === '+' || k === '=') { tlZoom('detail'); e.preventDefault(); }
    else if (k === '-' || k === '_' || k === '0') { tlZoom('fit'); e.preventDefault(); }
  }
  function tlZoom(z) { if (TL.zoom === z) return; TL.zoom = z; tlBuild(); }
  TL.el.addEventListener('click', (e) => {
    const z = e.target.closest('[data-tz]');
    if (z) { tlZoom(z.getAttribute('data-tz')); return; }
    const rh = e.target.closest('[data-rel]');
    if (rh) { shell.inspect({ type: 'release', id: rh.getAttribute('data-rel') }); return; }
    const ch = e.target.closest('.ca-tc');
    if (ch) shell.peek(ch.getAttribute('data-f'));
  });
  TL.el.addEventListener('dblclick', (e) => {
    const ch = e.target.closest('.ca-tc');
    if (ch) shell.openFeature(ch.getAttribute('data-f'));
  });
  TL.el.addEventListener('keydown', (e) => {
    const ch = e.target.closest && e.target.closest('.ca-tc');
    if (ch && e.key === 'Enter' && e.shiftKey) { e.preventDefault(); shell.openFeature(ch.getAttribute('data-f')); }
  });

  // ══ legend ═════════════════════════════════════════════════════════════════════════════════════
  function legendHTML(state) {
    const sv = (inner, w, h, vb) => '<svg width="' + w + '" height="' + h + '" viewBox="' + vb + '" aria-hidden="true">' + inner + '</svg>';
    const row = (svg, html) => '<div class="ok-lg-row">' + svg + '<span>' + html + '</span></div>';
    const map = '<section class="ok-lg-sec"><h3>Atlas map</h3>' +
      row(sv('<circle r="10" fill="var(--ok-paper-hi)" stroke="var(--ok-rule)"/><path d="M-5.6 5.6A8 8 0 1 1 5.6 5.6" fill="none" stroke="var(--ok-rule-2)" stroke-width="2"/><path d="M-5.6 5.6A8 8 0 0 1 4 -6.9" fill="none" stroke="var(--ok-fair)" stroke-width="2.4" stroke-linecap="round"/><path d="M-3.8 3.8A5.4 5.4 0 1 1 3.8 3.8" fill="none" stroke="var(--ok-rule-2)" stroke-width="1.6"/><path d="M-3.8 3.8A5.4 5.4 0 0 1 5.3 -1" fill="none" stroke="var(--ok-good)" stroke-width="1.6" opacity=".6"/>', 24, 24, '-12 -12 24 24'), '<b>Product dial</b>: one gauge per lens; the current lens is bold and its score is in the centre.') +
      row(sv('<circle r="8" fill="none" stroke="var(--ok-rule)" stroke-width="2.4"/><path d="M0 -8A8 8 0 1 1 -7.6 2.5" fill="none" stroke="var(--ok-fair)" stroke-width="2.4" stroke-linecap="round"/>', 22, 22, '-11 -11 22 22'), '<b>Domain ring</b>: the domain\'s score in the current lens, filled and coloured by band, with attention and gate counts beside the name.') +
      row(sv('<rect x="-12" y="-4" width="24" height="8" rx="4" fill="var(--ok-good)" opacity=".45" stroke="var(--ok-good)"/>', 26, 14, '-13 -7 26 14'), '<b>Module</b>: a band pill at first, a card with its name as you zoom in.') +
      row(sv('<rect x="-12" y="-6" width="24" height="12" rx="6" fill="var(--ok-paper-hi)" stroke="var(--ok-poor)"/><path d="M-6 -3.4A3.4 3.4 0 0 0 -6 3.4Z" fill="var(--ok-poor)"/><circle cx="-6" r="3" fill="none" stroke="var(--ok-poor)" stroke-width="1.1"/>', 26, 16, '-13 -8 26 16'), '<b>Feature mark</b>: the form gives the status (filled live, ring with a dot ready, half in build, dotted planned, red cross-star blocked); the colour gives the band.') +
      row(sv('<rect x="-12" y="-6" width="24" height="12" rx="3" fill="none" stroke="var(--ok-na)" stroke-dasharray="2 2"/>', 26, 16, '-13 -8 26 16'), '<b>Dashed, no fill</b>: the lens does not apply, for example Operations before a feature is live.') +
      row(sv('<path d="M-11 4H-4V-4H4M4 -4V4H11" fill="none" stroke="var(--ok-ink)" stroke-width="1.4"/><path d="M8.5 2L11 4 8.5 6" fill="var(--ok-ink)"/>', 26, 14, '-13 -7 26 14'), '<b>Links</b> of the selected feature: solid to what it depends on, dashed from what depends on it.') +
      row(sv('<rect x="-12" y="-6" width="24" height="12" rx="3" fill="var(--ok-paper-hi)" stroke="var(--ok-rule)"/><rect x="-12" y="3.5" width="24" height="2.5" fill="var(--ok-good)"/>', 26, 16, '-13 -8 26 16'), '<b>Initiative bar</b> under each card: covered, in progress, pending (dashed) or a finding (red).') +
      '<p class="ok-lg-note">Zoom uncovers detail: domains › modules › feature marks › cards › full cards with the eight-lens corona. Nothing moves when you change lens or filters; only your own fold or unfold closes a gap.</p></section>';
    const tl = '<section class="ok-lg-sec"><h3>Release swimlanes</h3>' +
      '<div class="ok-lg-grid">' + ['new', 'improved', 'fixed'].map((k) => row(OK.svg.wrap(OK.svg.releaseKind(k, 5), 6, 16), OK.labels.releaseKind[k])).join('') + '</div>' +
      row(OK.html.status('building', 14), 'In the next release and later, new items show their status: ready, in build, blocked or planned.') +
      row(sv('<path d="M0 -8V8" stroke="var(--ok-ink)" stroke-width="1.5"/><circle cy="-8" r="2" fill="var(--ok-ink)"/>', 14, 18, '-7 -9 14 18'), '<b>Today</b>; the future is shaded. Chips take the band of the current lens.') + '</section>';
    const keys = '<section class="ok-lg-sec ok-lg-keys"><span class="ok-kbd">←</span><span class="ok-kbd">→</span><span class="ok-kbd">↑</span><span class="ok-kbd">↓</span> move through the tree · <span class="ok-kbd">Space</span> fold · <span class="ok-kbd">F</span> focus branch · <span class="ok-kbd">[</span> <span class="ok-kbd">]</span> gates queue · <span class="ok-kbd">+</span> <span class="ok-kbd">−</span> zoom · <span class="ok-kbd">0</span> fit</section>';
    return state && state.view === 'timeline' ? tl + map + keys : map + tl + keys;
  }

  window.CA = {
    shell, cam, L, zoomToLevel: (i) => { const l = LEVELS[i]; if (i === 0) fitAll(0); else zoomToK(l.k(), 0); },
    zoomTo: (k) => zoomToK(k, 0), fit: () => fitAll(0), level: () => levelOf(cam.k),
    locate: (type, id, ms) => { const n = nodeOf({ type, id }); if (n) { ensureVisible(n); freeR = shell.freeRect(); flyToNode(n, { ms: ms == null ? 0 : ms }); } },
    focus: (type, id) => setFocus(nodeOf({ type, id })), fold: (type, id) => toggleCollapse(nodeOf({ type, id })), expandAll,
    stepQueue, product: openProduct, tlZoom, home: () => { cursorNode = null; kbdActive = false; requestDraw(); },
    bench: (n) => { const t0 = performance.now(); for (let i = 0; i < (n || 20); i++) { draw(performance.now()); drawMini(); } return (performance.now() - t0) / (n || 20); },
    view: (type, id, lvl) => {
      const n = nodeOf({ type, id });
      if (!n) return;
      ensureVisible(n);
      freeR = shell.freeRect();
      const r = freeRect();
      const k = lvl === 0 ? L.kFit : LEVELS[lvl].k();
      const b = n.type === 'feature' ? { x: n.tx, y: n.ty, w: n.tw, h: n.th } : subtreeBox(n);
      atFit = false;
      flyTo({ k, tx: r.x + r.w / 2 - (b.x + b.w / 2) * k, ty: r.y + r.h / 2 - (b.y + b.h / 2) * k }, 0);
    },
    screenOf: (type, id) => { const n = nodeOf({ type, id }); return n ? [toSX(n.x + n.w / 2), toSY(n.y + n.h / 2)] : null; },
  };
})();
