/* Orbit Plan (round 2, variant A): Cyanotype's containment plan, redrawn calmly in the Orbit identity.

   PLAN
   ────
   Shape: one plan sheet on Orbit paper (fine graticule, ink-blue hairlines, a tick scale on the frame). Areas are wings,
   domains are zones inside wings, modules are rooms inside zones, and every feature is a fixture on a regular cell grid
   inside its room (cell pitch CW × CH world units, the same everywhere, so room size reads as feature count).

   Layout (deterministic, computed once per stage size class, then fixed: nothing moves on lens, filter, search,
   initiative, gates or selection)
   - Size classes by stage aspect: wide (≥ 1.3, desktop), square (≥ 0.74, the 820 side panel) and tall (phone). Each
     class packs against a representative stage (1440×798, 820×852, 390×700), so a class always gets the same
     arrangement. Realising it on the actual stage stretches the sheet (by at most 25%) to the stage's proportions, so
     a 1920 or 1280 stage fills its width instead of leaving side margins; the arrangement itself never changes.
   - Rooms: every c × r grid that holds the module's features (no empty column), scored by empty cells and aspect.
   - Groups (rooms in a zone, zones in a wing, wings on the sheet) are packed by enumerating every split of the ordered
     children into consecutive rows (stacked) or columns (side by side). Each line picks, for every child, its
     narrowest candidate that fits the line's cross size. Candidates are kept on a Pareto front of (width, height,
     waste), where waste is empty floor plus aspect and minimum-width penalties for zones (zone labels need room).
   - The sheet candidate that gives the largest fitted scale after a waste penalty wins. Realising the tree hands any
     slack to children in proportion to their natural size; corridors (gaps) separate rooms, zones and wings.

   Levels of detail (continuous zoom; s = cell width on screen in px; thresholds relative to the opening fit sFit)
   - L0 (fit): wings with their names and the area's band and score right after the name; each room tinted by its
     module's band in the current lens (soft fill, stronger edge, hatched when n/a), so the plan itself carries state
     and a lens switch repaints it; each zone with a compact plaque at its top: the name in large tracked caps, the
     band glyph and score, a slim status bar, attention and gate counters (laid out once at the fit scale and drawn
     scaled with the zoom, so it never re-flows; the score is the last thing to go); a slim lens-rating gauge along
     the zone's foot. Attention marks are always visible; filters, gates (revision-cloud halos), initiatives (coverage
     dots) and search hits (pins) show as marks at the fixtures. Marks a plaque would cover ride on a rail just under
     it at their own column (clustered with a count), so none disappears and all stay clickable.
   - L1 (s ≥ t1 = max(1.3·sFit, 40)): room names and bands appear in room headers, with faint fixture placeholders;
     the zone label moves into the zone's header band. Both become sticky bands at the top edge when their header
     scrolls away, and shift or shorten to the visible part of their container.
   - L2 (s ≥ t2 = max(1.45·t1, 62)): fixtures: each cell tinted by its band (n/a hatched with a dashed edge), status by
     the Orbit glyph form; one-line names where they fit.
   - L3 (s ≥ t3 = max(1.75·t2, 112)): names on two lines, the current-lens score, gate and attention marks.
   - L4 (s ≥ t4 = max(2.1·t3, 240)): an on-canvas mini-detail: 8-lens corona with status, rating and headline,
     gates, status and release.
   - Layers cross-fade with zoom (the L0 plaques hand over to the L1 header labels in sequence, so they never stack);
     labels that stop fitting fade out over 160 ms. Labels are confined to their own container (wing header, zone,
     room header, fixture), so they never overlap; sticky labels sit on plates.

   Rendering: one Canvas 2D per view in screen space at device pixel ratio, colours read from the kit tokens and
   re-read on 'theme'. Lens and filter events refresh per-feature arrays and schedule one frame; nothing rebuilds.
   Dependency links of the selected feature are routed on a coarse grid (A*, 8 world units) that prefers corridors
   and avoids labels and fixtures; links sharing a stretch of corridor get parallel lanes a few px apart. HUD (zoom
   controls, corner readout whose location opens that node's inspector, tooltip) and the release ribbon are DOM.

   Timeline "Phasing": the same plan in the same place (the camera carries over), re-tinted by the release each
   feature first shipped in or targets, relative to the selected release (default: the latest shipped, v1.11):
   earlier releases faint (older fainter), the selected release luminous in its band colour for the current lens, the
   next outlined, later ones dashed, unscheduled dotted. The selected package's improved and fixed live features are
   half-lit in their band under a heavy band rim, and every package item gets a new / improved / fixed mark. Zone labels stay in the header bands with the
   package counts, so fixtures are never covered. A ribbon along the bottom spans v1.0 to v2.1 on a time axis with a
   today marker; packages are bars sized by item count (shipped: new, improved, fixed; next and future: ready, in
   build, blocked, planned). Clicking a release selects it and opens the kit's release inspector; arrow keys step;
   Play steps through every release. */
(function () {
  'use strict';
  const BP = window.BP, OK = window.OK;
  const esc = OK.esc;
  const app = document.getElementById('app');
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const now = () => (window.performance ? performance.now() : Date.now());

  // ══ geometry ═════════════════════════════════════════════════════════════════════════════════
  // World units. CW × CH is the fixture cell pitch; FI insets the fixture box inside its cell.
  const BASE = { CW: 64, CH: 44, FI: 4, RP: 8, RH: 26, RG: 12, ZP: 10, ZH: 34, ZB: 14, ZG: 20, WP: 14, WH: 40, SG: 40, SM: 30 };
  const CLASSES = {
    wide: { stage: [1440, 798], margin: [18, 22, 60, 22], G: {}, zoneMinW: 230, zoneAsp: [0.55, 2.6], maxName: 22 },
    square: { stage: [820, 852], margin: [16, 16, 58, 16], G: {}, zoneMinW: 250, zoneAsp: [0.55, 2.4], maxName: 19 },
    tall: { stage: [390, 700], margin: [10, 10, 48, 10], G: { WH: 104, SG: 44, ZB: 18 }, zoneMinW: 330, zoneAsp: [0.6, 2.4], maxName: 13 },
  };
  function classFor(w, h) { const a = w / Math.max(1, h); return a >= 1.3 ? 'wide' : a >= 0.74 ? 'square' : 'tall'; }

  function pareto(list, cap) {
    list.sort((a, b) => a.w - b.w || a.h - b.h || a.waste - b.waste);
    const out = [];
    for (const c of list) {
      let dom = false;
      for (const o of out) if (o.w <= c.w + 0.5 && o.h <= c.h + 0.5 && o.waste <= c.waste) { dom = true; break; }
      if (!dom) out.push(c);
    }
    if (out.length > cap) {
      out.sort((a, b) => a.waste / (a.w * a.h) - b.waste / (b.w * b.h));
      return out.slice(0, cap);
    }
    return out;
  }
  const PARTS = {};
  function partitions(n) {
    if (PARTS[n]) return PARTS[n];
    const res = [];
    (function rec(start, acc) {
      if (start === n) { res.push(acc.slice()); return; }
      for (let e = start + 1; e <= n; e++) { acc.push([start, e]); rec(e, acc); acc.pop(); }
    })(0, []);
    return (PARTS[n] = res);
  }
  function roomCands(id, n, G) {
    const out = [];
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      if (c > 1 && Math.ceil(n / (c - 1)) === r) continue;
      const empty = c * r - n;
      if (empty >= c) continue;
      const asp = (c * G.CW) / (r * G.CH);
      let waste = empty * G.CW * G.CH;
      if (asp > 3.4 || asp < 0.45) waste += n * G.CW * G.CH * 0.8;
      out.push({ kind: 'leaf', id, n, c, r, w: c * G.CW + 2 * G.RP, h: G.RH + r * G.CH + G.RP, waste });
    }
    return out;
  }
  function lineCands(lists, gap, horiz) {
    const cross = horiz ? 'h' : 'w', main = horiz ? 'w' : 'h';
    const sizes = Array.from(new Set([].concat.apply([], lists.map((l) => l.map((c) => c[cross]))))).sort((a, b) => a - b);
    const out = [];
    sizes.forEach((S) => {
      let m = (lists.length - 1) * gap, waste = 0;
      const picks = [];
      for (const l of lists) {
        let best = null;
        for (const c of l) if (c[cross] <= S && (!best || c[main] < best[main] || (c[main] === best[main] && c.waste < best.waste))) best = c;
        if (!best) return;
        picks.push(best);
        m += best[main];
        waste += best.waste + (S - best[cross]) * best[main];
      }
      const o = { kind: horiz ? 'row' : 'stack', parts: picks, waste, gap };
      o[main] = m; o[cross] = S;
      out.push(o);
    });
    return out;
  }
  function packGroup(childLists, pad, gap, cap, node) {
    const n = childLists.length;
    const all = [];
    partitions(n).forEach((parts) => {
      const rows = parts.map(([s, e]) => (e - s === 1 ? childLists[s] : pareto(lineCands(childLists.slice(s, e), gap, true), cap)));
      (rows.length === 1 ? rows[0] : lineCands(rows, gap, false)).forEach((c) => all.push(c));
      if (parts.length > 1 && parts.length < n) {
        const cols = parts.map(([s, e]) => (e - s === 1 ? childLists[s] : pareto(lineCands(childLists.slice(s, e), gap, false), cap)));
        lineCands(cols, gap, true).forEach((c) => all.push(c));
      }
    });
    return pareto(all.map((c) => ({ kind: 'box', node, w: c.w + pad.l + pad.r, h: c.h + pad.t + pad.b, waste: c.waste, inner: c, pad })), cap);
  }

  /** Packs the plan for a size class once (the arrangement is fixed per class). */
  const PACKS = {};
  function packClass(clsName) {
    if (PACKS[clsName]) return PACKS[clsName];
    const cls = CLASSES[clsName];
    const G = Object.assign({}, BASE, cls.G);
    const zoneLists = {};
    BP.domains.forEach((d) => {
      const rooms = BP.modulesOf(d.id).map((m) => roomCands(m.id, BP.featuresOf(m.id).length, G));
      zoneLists[d.id] = packGroup(rooms, { l: G.ZP, r: G.ZP, t: G.ZH, b: G.ZB }, G.RG, 60, { type: 'domain', id: d.id }).map((c) => {
        const a = c.w / c.h;
        let pen = 0;
        if (a > cls.zoneAsp[1]) pen = (a / cls.zoneAsp[1] - 1) * c.w * c.h * 0.6;
        if (a < cls.zoneAsp[0]) pen = (cls.zoneAsp[0] / a - 1) * c.w * c.h * 0.6;
        if (c.w < cls.zoneMinW) pen += (cls.zoneMinW - c.w) * c.h * 2;
        return Object.assign({}, c, { waste: c.waste + pen });
      });
    });
    const wingLists = BP.areas.map((a) => packGroup(BP.domainsOf(a.id).map((d) => zoneLists[d.id]), { l: G.WP, r: G.WP, t: G.WH, b: G.WP }, G.ZG, 60, { type: 'area', id: a.id }));
    const sheets = packGroup(wingLists, { l: G.SM, r: G.SM, t: G.SM, b: G.SM }, G.SG, 400, { type: 'product' });
    const [SW, SH] = cls.stage;
    const [mt, mr, mb, ml] = cls.margin;
    let best = null;
    sheets.forEach((c) => {
      const k = Math.min((SW - ml - mr) / c.w, (SH - mt - mb) / c.h);
      const score = (1 + 1.4 * c.waste / (c.w * c.h)) / (k * k);
      if (!best || score < best.score) best = { score, c, k };
    });
    return (PACKS[clsName] = { G, best });
  }
  // The class's arrangement is fixed; realising it stretches the sheet (by at most this much) to the stage's
  // proportions, so a 1920 or 1280 stage in the wide class uses its width instead of leaving side margins.
  const MAX_STRETCH = 1.25;
  /** Realises the fixed plan for a size class on a stage: wings, zones, rooms and fixture cells in world units. */
  function computePlan(clsName, stW, stH) {
    const cls = CLASSES[clsName];
    const { G, best } = packClass(clsName);
    const [mt, mr, mb, ml] = cls.margin;
    let sw = best.c.w, shh = best.c.h;
    if (stW > 0 && stH > 0) {
      const want = Math.max(1, stW - ml - mr) / Math.max(1, stH - mt - mb), have = sw / shh;
      if (want > have) sw = Math.min(shh * want, sw * MAX_STRETCH);
      else shh = Math.min(sw / want, shh * MAX_STRETCH);
    }
    const plan = { cls: clsName, G, repK: best.k, wings: [], zones: [], rooms: [], cells: new Array(BP.features.length), sheet: null, key: clsName + ':' + Math.round(sw) + 'x' + Math.round(shh) };
    const fIndex = new Map(BP.features.map((f, i) => [f.id, i]));
    let curWing = null, curZone = null;
    function realize(c, x, y, w, h) {
      if (c.kind === 'box') {
        const rect = { x, y, w, h };
        if (c.node.type === 'product') plan.sheet = rect;
        else if (c.node.type === 'area') { curWing = Object.assign(rect, { id: c.node.id, a: BP.area(c.node.id), zones: [], wi: plan.wings.length }); plan.wings.push(curWing); }
        else if (c.node.type === 'domain') { curZone = Object.assign(rect, { id: c.node.id, d: BP.domain(c.node.id), wing: curWing, rooms: [], zi: plan.zones.length }); curWing.zones.push(curZone); plan.zones.push(curZone); }
        realize(c.inner, x + c.pad.l, y + c.pad.t, w - c.pad.l - c.pad.r, h - c.pad.t - c.pad.b);
        return;
      }
      if (c.kind === 'leaf') {
        const room = { id: c.id, m: BP.module(c.id), x, y, w, h, c: c.c, r: c.r, zone: curZone, cells: [], ri: plan.rooms.length };
        const gw = c.c * G.CW, gh = c.r * G.CH;
        room.gx = x + (w - gw) / 2;
        room.gy = y + G.RH + Math.max(0, (h - G.RH - G.RP - gh) * 0.35);
        BP.featuresOf(c.id).forEach((f, j) => {
          const col = j % c.c, row = Math.floor(j / c.c);
          const i = fIndex.get(f.id);
          const cell = { f, i, room, col, row, x: room.gx + col * G.CW, y: room.gy + row * G.CH };
          cell.cx = cell.x + G.CW / 2; cell.cy = cell.y + G.CH / 2;
          plan.cells[i] = cell;
          room.cells.push(cell);
        });
        curZone.rooms.push(room);
        plan.rooms.push(room);
        return;
      }
      const horiz = c.kind === 'row';
      const nat = c.parts.reduce((s, p) => s + (horiz ? p.w : p.h), 0);
      const avail = (horiz ? w : h) - (c.parts.length - 1) * c.gap;
      let pos = horiz ? x : y;
      c.parts.forEach((p, j) => {
        const last = j === c.parts.length - 1;
        const size = last ? (horiz ? x + w : y + h) - pos : (horiz ? p.w : p.h) * avail / nat;
        if (horiz) realize(p, pos, y, size, h); else realize(p, x, pos, w, size);
        pos += size + c.gap;
      });
    }
    realize(best.c, 0, 0, sw, shh);
    plan.byModule = new Map(plan.rooms.map((r) => [r.id, r]));
    plan.byDomain = new Map(plan.zones.map((z) => [z.id, z]));
    plan.byArea = new Map(plan.wings.map((w) => [w.id, w]));
    return plan;
  }

  // ══ shell ════════════════════════════════════════════════════════════════════════════════════
  const shell = OK.mount({ root: app, variant: 'Orbit Plan', legend: legendHTML, keys: [['+ −', 'Zoom'], ['0', 'Fit the plan'], ['← ↑ → ↓', 'Pan (or step releases on the ribbon)']] });
  shell.root.classList.add('ap-root');
  const FEATS = BP.features;
  const N = FEATS.length;
  const REL = BP.releasesInOrder();
  const relIdx = new Map(REL.map((r, i) => [r.id, i]));
  const LATEST_SHIPPED = REL.reduce((m, r, i) => (r.state === 'shipped' ? i : m), 0);

  // per-feature static facts
  const F_GATES = FEATS.map((f) => BP.gates(f));
  const F_ATT = FEATS.map((f) => BP.needsAttention(f));
  const F_GATEKIND = F_GATES.map((g) => (!g.length ? null : g.some((x) => x.kind === 'changes') ? 'changes' : g.some((x) => x.kind === 'approval') ? 'approval' : 'triage'));
  const F_REL = FEATS.map((f) => (f.release && relIdx.has(f.release) ? relIdx.get(f.release) : -1));
  const DEPS = FEATS.map((f) => BP.dependencies(f).map((x) => x.id));
  const DEPENDENTS = FEATS.map((f) => BP.dependents(f).map((x) => x.id));
  const fIdx = new Map(FEATS.map((f, i) => [f.id, i]));

  // per-feature live state (refreshed on lens and filter events)
  const S = {
    band: new Array(N).fill('na'), score: new Array(N).fill(null), dim: new Uint8Array(N), hit: new Uint8Array(N),
    gateOn: new Uint8Array(N), cov: new Array(N).fill(null), filtering: false, overlay: null,
    zoneMatch: [], roomMatch: [], zoneRating: [], roomRating: [], wingRating: [],
    rel: LATEST_SHIPPED, pkg: new Map(), zonePkg: [], playing: false,
  };
  let PLAN = null;

  // ══ tokens and colours ════════════════════════════════════════════════════════════════════════
  const TOK = ['paper', 'paper-hi', 'sky-a', 'sky-b', 'ink', 'ink-2', 'ink-3', 'ink-4', 'on-ink', 'rule', 'rule-2', 'band', 'band-hi', 'shadow', 'glow',
    'good', 'fair', 'poor', 'critical', 'na', 'good-soft', 'fair-soft', 'poor-soft', 'critical-soft', 'na-soft', 'alarm', 'alarm-soft', 'gate', 'gate-soft', 'focus'];
  const C = {};
  const RGB = {};
  function parseColor(s) {
    s = String(s || '').trim();
    let m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
    m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) return [0, 1, 2].map((j) => parseInt(m[1][j] + m[1][j], 16)).concat([1]);
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    return [128, 128, 128, 1];
  }
  let DARK = false;
  function readTokens() {
    const cs = getComputedStyle(shell.root);
    TOK.forEach((t) => { const v = cs.getPropertyValue('--ok-' + t).trim(); C[t] = v || '#888'; RGB[t] = parseColor(v); });
    DARK = shell.isDark();
    VIEWS.forEach((v) => { v.hatch = null; });
  }
  const rgba = (tok, a) => { const c = RGB[tok]; return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * a).toFixed(3) + ')'; };
  const bandTok = (b) => (b === 'good' || b === 'fair' || b === 'poor' || b === 'critical' ? b : 'na');

  // ══ text ═════════════════════════════════════════════════════════════════════════════════════
  const FAM_L = '"Jost", "Futura", "Century Gothic", "Avenir Next", "Trebuchet MS", sans-serif';
  const FAM_M = '"DM Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const fl = (w, px) => w + ' ' + px.toFixed(1) + 'px ' + FAM_L;
  const fm = (w, px) => w + ' ' + px.toFixed(1) + 'px ' + FAM_M;
  const mctx = document.createElement('canvas').getContext('2d');
  const HAS_LS = 'letterSpacing' in mctx;
  const MCACHE = new Map();
  function setFont(ctx, font, ls) {
    if (ctx.font !== font) ctx.font = font;
    if (HAS_LS) { const v = (ls || 0).toFixed(2) + 'px'; if (ctx.letterSpacing !== v) ctx.letterSpacing = v; }
  }
  function tw(text, font, ls) {
    const key = font + '|' + (ls || 0).toFixed(2) + '|' + text;
    let w = MCACHE.get(key);
    if (w == null) { setFont(mctx, font, ls); w = mctx.measureText(text).width; if (MCACHE.size > 20000) MCACHE.clear(); MCACHE.set(key, w); }
    return w;
  }
  /** Greedy wrap into at most maxLines; returns null when a word cannot fit (strict) or lines with an ellipsis. */
  /** Greedy wrap into at most maxLines (maxW may be an array of per-line widths). Strict: null unless it all fits. */
  function wrap(text, font, ls, maxW, maxLines, strict) {
    const Wd = (j) => (Array.isArray(maxW) ? maxW[Math.min(j, maxW.length - 1)] : maxW);
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (tw(next, font, ls) <= Wd(lines.length)) { cur = next; continue; }
      if (!cur) { if (strict) return null; cur = w; continue; }
      lines.push(cur);
      cur = w;
    }
    if (cur) lines.push(cur);
    if (strict) {
      if (lines.length > maxLines) return null;
      for (let j = 0; j < lines.length; j++) if (tw(lines[j], font, ls) > Wd(j)) return null;
      return lines;
    }
    if (lines.length > maxLines) {
      const keep = lines.slice(0, maxLines);
      keep[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(' '), font, ls, Wd(maxLines - 1), true);
      return keep;
    }
    return lines.map((l, j) => ellipsize(l, font, ls, Wd(j)));
  }
  /** Fits a caps label and right-hand pieces into avail px. Keeps at least one piece if any size allows it
      (all pieces, then dropping from the end, then the first piece compact), then the name alone, then an ellipsis.
      fullFirst: the first piece (a score) keeps its full form at any of the sizes before it is made compact. */
  function fitHeader(name, sizes, lsK, weight, avail, pieces, gap, dropAll, fullFirst) {
    const tryFit = (minPieces, cmps) => {
      for (const fs of sizes) {
        const font = fl(weight, fs), ls = fs * lsK;
        const nw = tw(name, font, ls);
        if (nw > avail) continue;
        // the first piece (the score) keeps its full form while any piece can still be dropped from the end
        for (const cmp of cmps) {
          for (let n = pieces.length; n >= minPieces; n--) {
            if (cmp && (!n || !pieces[0].cw)) continue;
            let w = 0;
            for (let j = 0; j < n; j++) w += gap + (j === 0 && cmp ? pieces[0].cw(fs) : pieces[j].w(fs));
            if (nw + w <= avail) return { fs, font, ls, name, nameW: nw, n, cmp: !!cmp, piecesW: w };
          }
        }
      }
      return null;
    };
    const got = (pieces.length ? (fullFirst ? tryFit(1, [0]) || tryFit(1, [1]) : tryFit(1, [0, 1])) : null) || tryFit(0, [0]);
    if (got) return got;
    const fs = sizes[sizes.length - 1], font = fl(weight, fs), ls = fs * lsK;
    const keep = !dropAll && pieces.length && pieces[0].cw ? pieces[0].cw(fs) + gap : 0;
    const nm = ellipsize(name, font, ls, Math.max(10, avail - keep));
    return { fs, font, ls, name: nm, nameW: tw(nm, font, ls), n: keep ? 1 : 0, cmp: true, piecesW: keep, ellipsis: true };
  }
  function ellipsize(s, font, ls, maxW, force) {
    if (!force && tw(s, font, ls) <= maxW) return s;
    let t = s;
    while (t.length > 1 && tw(t + '…', font, ls) > maxW) t = t.slice(0, -1);
    return t.replace(/[\s,·&]+$/, '') + '…';
  }
  function text(ctx, s, x, y, font, color, align, ls) {
    setFont(ctx, font, ls);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.fillText(s, align === 'center' && HAS_LS && ls ? x + ls / 2 : x, y);
  }

  // ══ glyphs (canvas versions of the kit's primitives, same geometry) ══════════════════════════════
  function P(r, deg) { const a = deg * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; }
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function circle(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function pie(ctx, x, y, r, frac) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - r);
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.closePath();
  }
  function gStatus(ctx, st, x, y, r, inverse) {
    const w = clamp(r * 0.22, 1.1, 2.2);
    const ink = inverse ? C['on-ink'] : C.ink, ground = inverse ? C.ink : C['paper-hi'];
    ctx.setLineDash([]);
    if (st === 'live') { ctx.beginPath(); circle(ctx, x, y, r); ctx.fillStyle = ink; ctx.fill(); return; }
    if (st === 'ready' || st === 'building') {
      ctx.beginPath(); circle(ctx, x, y, r - w / 2); ctx.fillStyle = ground; ctx.fill(); ctx.lineWidth = w; ctx.strokeStyle = ink; ctx.stroke();
      ctx.beginPath();
      if (st === 'ready') circle(ctx, x, y, r * 0.36);
      else { ctx.moveTo(x, y - r + w / 2); ctx.arc(x, y, r - w / 2, -Math.PI / 2, Math.PI / 2, true); ctx.closePath(); }
      ctx.fillStyle = ink; ctx.fill();
      return;
    }
    if (st === 'planned') {
      ctx.beginPath(); circle(ctx, x, y, r - w / 2); ctx.fillStyle = ground; ctx.fill();
      ctx.setLineDash([r * 0.22 * 2.5, r * 0.36 * 2.2]); ctx.lineWidth = w; ctx.strokeStyle = inverse ? C['on-ink'] : C['ink-2']; ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    if (st === 'blocked') {
      ctx.beginPath();
      for (let j = 0; j < 8; j++) { const p = P(j % 2 ? r * 0.42 : r * 1.5, j * 45); if (j) ctx.lineTo(x + p[0], y + p[1]); else ctx.moveTo(x + p[0], y + p[1]); }
      // on a lit (inverse) fixture the alarm red would vanish into a critical fill
      ctx.closePath(); ctx.fillStyle = inverse ? C['on-ink'] : C.alarm; ctx.fill();
    }
  }
  function gBand(ctx, band, x, y, r) {
    const w = clamp(r * 0.22, 1.1, 2.2);
    ctx.setLineDash([]);
    if (band === 'good') { ctx.beginPath(); circle(ctx, x, y, r); ctx.fillStyle = C.good; ctx.fill(); return; }
    if (band === 'fair' || band === 'poor') {
      ctx.beginPath(); circle(ctx, x, y, r - 0.5); ctx.fillStyle = C['paper-hi']; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C.rule; ctx.stroke();
      pie(ctx, x, y, r, band === 'fair' ? 0.75 : 0.5); ctx.fillStyle = C[band]; ctx.fill();
      return;
    }
    if (band === 'critical') {
      const k = r * 0.36;
      ctx.beginPath(); circle(ctx, x, y, r - w / 2); ctx.fillStyle = C['critical-soft']; ctx.fill(); ctx.lineWidth = w; ctx.strokeStyle = C.critical; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
      return;
    }
    ctx.beginPath(); circle(ctx, x, y, r - w / 2); ctx.lineWidth = w; ctx.strokeStyle = C.na;
    const circ = 2 * Math.PI * (r - w / 2);
    const n = Math.max(4, Math.round(circ / (r * 0.74)));
    ctx.setLineDash([circ / n * 0.57, circ / n * 0.43]); ctx.stroke(); ctx.setLineDash([]);
  }
  function gGate(ctx, kind, x, y, r) {
    const w = clamp(r * 0.22, 1.1, 2.2);
    const col = kind === 'changes' ? C.alarm : C.gate;
    ctx.beginPath(); circle(ctx, x, y, r - w / 2); ctx.lineWidth = w; ctx.strokeStyle = col;
    if (kind === 'triage') ctx.setLineDash([r * 0.42, r * 0.3]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); circle(ctx, x, y, r * 0.34); ctx.fillStyle = col; ctx.fill();
  }
  function gAttention(ctx, x, y, r, col) {
    ctx.beginPath();
    for (let a = 0; a < 360; a += 60) { const p0 = P(r * 0.18, a), p1 = P(r * 0.98, a); ctx.moveTo(x + p0[0], y + p0[1]); ctx.lineTo(x + p1[0], y + p1[1]); }
    ctx.lineWidth = clamp(r * 0.26, 1.3, 2.4); ctx.lineCap = 'round'; ctx.strokeStyle = col || C.alarm; ctx.setLineDash([]); ctx.stroke(); ctx.lineCap = 'butt';
  }
  function gReleaseKind(ctx, kind, x, y, r) {
    const s = r - 0.6, k = r * 0.46;
    ctx.setLineDash([]);
    ctx.beginPath(); rr(ctx, x - s, y - s, 2 * s, 2 * s, r * 0.28);
    ctx.fillStyle = kind === 'new' ? C.ink : C['paper-hi']; ctx.fill(); ctx.lineWidth = 1.1; ctx.strokeStyle = kind === 'new' ? C.ink : C['ink-2']; ctx.stroke();
    ctx.beginPath();
    if (kind === 'new') { ctx.moveTo(x - k, y); ctx.lineTo(x + k, y); ctx.moveTo(x, y - k); ctx.lineTo(x, y + k); }
    else if (kind === 'improved') { ctx.moveTo(x - k, y + k * 0.45); ctx.lineTo(x, y - k * 0.55); ctx.lineTo(x + k, y + k * 0.45); }
    else { ctx.moveTo(x - k, y + k * 0.05); ctx.lineTo(x - k * 0.2, y + k * 0.7); ctx.lineTo(x + k, y - k * 0.6); }
    ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = kind === 'new' ? C['paper-hi'] : C.ink; ctx.stroke(); ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }
  const LENS_IDS = OK.lenses().map((l) => l.id);
  function gCorona(ctx, f, x, y, r, lens) {
    const w = clamp(r * 0.24, 1.8, 6), gap = 7;
    ctx.setLineDash([]);
    ctx.beginPath(); circle(ctx, x, y, r); ctx.lineWidth = w; ctx.strokeStyle = C['rule-2']; ctx.stroke();
    LENS_IDS.forEach((l, j) => {
      const band = BP.rating(f, l).band;
      const a0 = (j * 45 + gap / 2 - 90) * Math.PI / 180, a1 = ((j + 1) * 45 - gap / 2 - 90) * Math.PI / 180;
      ctx.beginPath(); ctx.arc(x, y, r, a0, a1);
      ctx.lineWidth = band === 'na' ? w * 0.5 : w; ctx.strokeStyle = band === 'na' ? C['ink-4'] : C[band]; ctx.stroke();
      if (l === lens) {
        const p0 = P(r + w * 0.9, j * 45 + 22.5), p1 = P(r + w * 0.9 + Math.max(3, r * 0.28), j * 45 + 22.5);
        ctx.beginPath(); ctx.moveTo(x + p0[0], y + p0[1]); ctx.lineTo(x + p1[0], y + p1[1]); ctx.lineWidth = Math.max(1.2, w * 0.45); ctx.lineCap = 'round'; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.lineCap = 'butt';
      }
    });
    gStatus(ctx, f.status, x, y, r * 0.42);
  }
  /** Revision cloud: scallops bulging outward along a rectangle (the gate halo). */
  function cloudRect(ctx, x, y, w, h, s) {
    const seg = (x0, y0, x1, y1, nx, ny) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.round(len / (s * 2)));
      for (let j = 0; j < n; j++) {
        const ax = x0 + (x1 - x0) * j / n, ay = y0 + (y1 - y0) * j / n;
        const bx = x0 + (x1 - x0) * (j + 1) / n, by = y0 + (y1 - y0) * (j + 1) / n;
        ctx.quadraticCurveTo((ax + bx) / 2 + nx * s * 1.1, (ay + by) / 2 + ny * s * 1.1, bx, by);
      }
    };
    ctx.moveTo(x, y);
    seg(x, y, x + w, y, 0, -1); seg(x + w, y, x + w, y + h, 1, 0); seg(x + w, y + h, x, y + h, 0, 1); seg(x, y + h, x, y, -1, 0);
  }
  function cloudCircle(ctx, x, y, r, n) {
    for (let j = 0; j < n; j++) {
      const a0 = j / n * Math.PI * 2, a1 = (j + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [x + r * Math.cos(a0), y + r * Math.sin(a0)], p1 = [x + r * Math.cos(a1), y + r * Math.sin(a1)];
      if (!j) ctx.moveTo(p0[0], p0[1]);
      ctx.quadraticCurveTo(x + r * 1.45 * Math.cos(am), y + r * 1.45 * Math.sin(am), p1[0], p1[1]);
    }
    ctx.closePath();
  }
  const COV_TOK = { covered: 'good', 'in-progress': 'ink-3', pending: 'ink-4', finding: 'alarm' };
  function gCov(ctx, state, x, y, r) {
    ctx.beginPath(); circle(ctx, x, y, r);
    if (state === 'pending') { ctx.fillStyle = C['paper-hi']; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = C['ink-3']; ctx.setLineDash([]); ctx.stroke(); }
    else { ctx.fillStyle = C[COV_TOK[state] || 'ink-3']; ctx.fill(); }
  }
  function gPin(ctx, x, y, r) {
    ctx.beginPath(); circle(ctx, x, y, r * 1.9); ctx.fillStyle = rgba('paper-hi', 0.85); ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = C.ink; ctx.setLineDash([]); ctx.stroke();
    ctx.beginPath(); circle(ctx, x, y, r * 0.85); ctx.fillStyle = C.ink; ctx.fill();
  }

  // ══ views ════════════════════════════════════════════════════════════════════════════════════
  const VIEWS = [];
  function makeView(container, mode) {
    const wrap = document.createElement('div');
    wrap.className = 'ap-view ap-view--' + mode;
    wrap.innerHTML = '<canvas class="ap-canvas" tabindex="0" role="img" aria-roledescription="plan" aria-label="' + esc(mode === 'map'
      ? 'Plan of ' + BP.product.name + ': ' + BP.areas.length + ' areas as wings, ' + BP.domains.length + ' domains as zones, ' + BP.modules.length + ' modules as rooms and ' + N + ' features as fixtures. Plus and minus zoom, arrow keys pan, 0 fits.'
      : 'Phasing plan: the same plan tinted by the release each feature shipped in or targets.') + '"></canvas>' +
      '<div class="ap-hud"><div class="ap-readout" aria-live="off"><div class="ap-ro__row"><span class="ap-ro__k">Level</span><span class="ap-ro__v" data-ro="level">Domains</span>' +
      '<span class="ap-ro__k ap-ro__k--scale">Scale</span><span class="ap-ro__scale"><i data-ro="bar"></i><span data-ro="scale">5 features</span></span></div><button type="button" class="ap-ro__loc" data-ro="loc" data-ok-inspect="product"></button></div>' +
      '<div class="ap-zoom" role="group" aria-label="Zoom"><button type="button" data-ap-zoom="out" aria-label="Zoom out" title="Zoom out (−)">' + minusIcon() + '</button>' +
      '<button type="button" data-ap-zoom="in" aria-label="Zoom in" title="Zoom in (+)">' + plusIcon() + '</button><button type="button" data-ap-zoom="fit" class="ap-zoom__fit" title="Fit the whole plan (0)">Fit</button></div></div>' +
      '<div class="ap-tip" hidden></div>';
    container.appendChild(wrap);
    const canvas = wrap.querySelector('canvas');
    const v = {
      mode, wrap, canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, dpr: 1, cam: { x: 0, y: 0, k: 1 }, fitK: 1, touched: false,
      T: { t1: 40, t2: 54, t3: 104, t4: 230 }, dirty: true, hatch: null, fades: new Map(), hover: null, bottom: 0, freeW: 0, freeH: 0,
      ro: { level: wrap.querySelector('[data-ro=level]'), scale: wrap.querySelector('[data-ro=scale]'), bar: wrap.querySelector('[data-ro=bar]'), loc: wrap.querySelector('[data-ro=loc]'), last: {} },
      tip: wrap.querySelector('.ap-tip'), fly: null,
    };
    VIEWS.push(v);
    bindInput(v);
    return v;
  }
  function plusIcon() { return '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }
  function minusIcon() { return '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }

  const mapV = makeView(shell.mapEl, 'map');
  // keyboard and screen-reader route into the plan: every area, domain and module opens its inspector and flies there
  (function () {
    let h = '<nav class="ok-vh ap-plan-nav" aria-label="Plan contents"><ul>';
    BP.areas.forEach((a) => {
      h += '<li><button type="button" data-ok-inspect="area:' + esc(a.id) + '">' + esc(a.name) + '</button><ul>';
      BP.domainsOf(a.id).forEach((d) => {
        h += '<li><button type="button" data-ok-inspect="domain:' + esc(d.id) + '">' + esc(d.name) + '</button><ul>' +
          BP.modulesOf(d.id).map((m) => '<li><button type="button" data-ok-inspect="module:' + esc(m.id) + '">' + esc(m.name) + ', ' + BP.featuresOf(m.id).length + ' features</button></li>').join('') + '</ul></li>';
      });
      h += '</ul></li>';
    });
    shell.mapEl.insertAdjacentHTML('beforeend', h + '</ul></nav>');
  })();
  const phaseV = makeView(shell.timelineEl, 'phase');
  const activeView = () => (shell.state.view === 'timeline' ? phaseV : mapV);

  // ══ frame loop ═══════════════════════════════════════════════════════════════════════════════
  let raf = 0;
  function invalidate(v) {
    if (v) v.dirty = true; else VIEWS.forEach((x) => { x.dirty = true; });
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(t) {
    raf = 0;
    const v = activeView();
    if (v.fly) stepFly(v, t);
    if (v.dirty && v.w > 0 && PLAN) { v.dirty = false; draw(v, t); }
    if (v.fly || v.animating) { v.dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
  }

  // ══ camera ═══════════════════════════════════════════════════════════════════════════════════
  function fitCam(v, rect, pad, area) {
    const m = CLASSES[PLAN.cls].margin;
    const W = area ? area.w : v.w, H = area ? area.h : v.h - v.bottom;
    const [mt, mr, mb, ml] = pad || [m[0], m[1], m[2], m[3]];
    const k = Math.min((W - ml - mr) / rect.w, (H - mt - mb) / rect.h);
    return { k, x: rect.x - (ml + (W - ml - mr - rect.w * k) / 2) / k, y: rect.y - (mt + (H - mt - mb - rect.h * k) / 2) / k };
  }
  function kLimits(v) { return [v.fitK * 0.72, 430 / PLAN.G.CW]; }
  function clampCam(v, c) {
    const [k0, k1] = kLimits(v);
    const k = clamp(c.k, k0, k1);
    const sh = PLAN.sheet;
    const W = v.w, H = v.h - v.bottom;
    const keep = 90;
    let x = c.x, y = c.y;
    const sx0 = (sh.x - x) * k, sx1 = (sh.x + sh.w - x) * k, sy0 = (sh.y - y) * k, sy1 = (sh.y + sh.h - y) * k;
    if (sx1 < keep) x -= (keep - sx1) / k;
    if (sx0 > W - keep) x += (sx0 - (W - keep)) / k;
    if (sy1 < keep) y -= (keep - sy1) / k;
    if (sy0 > H - keep) y += (sy0 - (H - keep)) / k;
    return { x, y, k };
  }
  function setCam(v, c) { v.cam = clampCam(v, c); invalidate(v); }
  function zoomAt(v, sx, sy, factor) {
    const c = v.cam;
    const [k0, k1] = kLimits(v);
    const k = clamp(c.k * factor, k0, k1);
    const wx = c.x + sx / c.k, wy = c.y + sy / c.k;
    v.touched = true;
    v.fly = null;
    setCam(v, { k, x: wx - sx / k, y: wy - sy / k });
  }
  function flyTo(v, target, ms) {
    target = clampCam(v, target);
    if (reduceMotion() || !v.w || shell.state.view !== (v.mode === 'map' ? 'map' : 'timeline')) { v.fly = null; v.cam = target; invalidate(v); return; }
    const a = v.cam;
    const cw = v.w / 2, ch = (v.h - v.bottom) / 2;
    v.fly = { t0: 0, ms: ms || 480, from: { cx: a.x + cw / a.k, cy: a.y + ch / a.k, lk: Math.log(a.k) }, to: { cx: target.x + cw / target.k, cy: target.y + ch / target.k, lk: Math.log(target.k) }, target };
    invalidate(v);
  }
  function stepFly(v, t) {
    const f = v.fly;
    if (!f.t0) f.t0 = t;
    const u = clamp((t - f.t0) / f.ms, 0, 1);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const lk = f.from.lk + (f.to.lk - f.from.lk) * e;
    const k = Math.exp(lk);
    // keep the zoom feeling even: move the centre in screen-space proportion
    const cx = f.from.cx + (f.to.cx - f.from.cx) * e, cy = f.from.cy + (f.to.cy - f.from.cy) * e;
    const cw = v.w / 2, ch = (v.h - v.bottom) / 2;
    v.cam = { k, x: cx - cw / k, y: cy - ch / k };
    if (u >= 1) { v.cam = f.target; v.fly = null; }
    v.dirty = true;
  }
  function fitView(v, animate) {
    v.touched = false;
    const c = fitCam(v, PLAN.sheet);
    if (animate) flyTo(v, c); else { v.fly = null; v.cam = c; invalidate(v); }
  }
  /** Fits the whole plan into the free part of the view (left of the inspector, above the phone sheet). */
  function fitFree(v) {
    if (!PLAN || !v.w) return;
    const m = CLASSES[PLAN.cls].margin;
    const W = v.freeW || v.w, H = Math.min(v.freeH || v.h, v.h - v.bottom);
    const pad = [m[0], 16, m[2], m[3]];
    const sh = PLAN.sheet, lim = kLimits(v);
    // never below the zoom-out limit, where the zone plaques still fit their zones
    const k = clamp(fitCam(v, sh, pad, { w: W, h: H }).k, lim[0], lim[1]);
    // centred in the free area; when even that is too wide (a narrow stage), aligned left so the rest runs under
    // the inspector instead of off the left edge
    const fw = W - pad[1] - pad[3];
    const x = sh.w * k <= fw ? sh.x + sh.w / 2 - (pad[3] + fw / 2) / k : sh.x - pad[3] / k;
    const cy = pad[0] + (H - pad[0] - pad[2]) / 2;
    v.touched = true;
    flyTo(v, { k, x, y: sh.y + sh.h / 2 - cy / k });
  }
  /** Camera that shows a world rect inside the free part of the view (left of the inspector, above a sheet). */
  function camFor(v, rect, padPx, minK) {
    const W = v.freeW || v.w, H = Math.min(v.freeH || v.h, v.h - v.bottom);
    const pad = padPx == null ? 36 : padPx;
    let k = Math.min((W - 2 * pad) / rect.w, (H - 2 * pad) / rect.h);
    if (minK) k = Math.max(k, minK);
    k = clamp(k, kLimits(v)[0], kLimits(v)[1]);
    return { k, x: rect.x + rect.w / 2 - W / 2 / k, y: rect.y + rect.h / 2 - H / 2 / k };
  }

  // ══ sizing ═══════════════════════════════════════════════════════════════════════════════════
  let stageW = 0, stageH = 0;
  function measureFree() {
    const fr = shell.freeRectHint();
    VIEWS.forEach((v) => { v.freeW = fr.w; v.freeH = fr.h; });
  }
  function onStageSize(w, h) {
    if (!w || !h) return;
    const sizeChanged = w !== stageW || h !== stageH;
    stageW = w; stageH = h;
    const cls = classFor(w, h);
    // a new class repacks (and refits); a new size in the same class re-realises the same arrangement, stretched
    const classChanged = !PLAN || PLAN.cls !== cls;
    if (classChanged || sizeChanged) {
      const next = computePlan(cls, w, h);
      if (!PLAN || next.key !== PLAN.key) { PLAN = next; ROUTER = null; LINKS = null; refreshAll(); scheduleLinks(); }
    }
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    VIEWS.forEach((v) => {
      v.w = w; v.h = h; v.dpr = dpr;
      v.canvas.width = Math.round(w * dpr); v.canvas.height = Math.round(h * dpr);
      v.canvas.style.width = w + 'px'; v.canvas.style.height = h + 'px';
      v.hatch = null;
      v.bottom = v.mode === 'phase' ? ribbonReserve() : 0;
      const fit = fitCam(v, PLAN.sheet);
      v.fitK = fit.k;
      if (classChanged || !v.touched) { v.cam = fit; v.touched = false; } else if (sizeChanged) v.cam = clampCam(v, v.cam);
    });
    PLAN.zones.forEach((z) => { z._pl = null; });
    // level thresholds come from the map's opening fit and are shared by both views
    const sFit = PLAN.G.CW * mapV.fitK;
    const t1 = Math.max(1.3 * sFit, 40), t2 = Math.max(1.45 * t1, 62), t3 = Math.max(1.75 * t2, 112), t4 = Math.max(2.1 * t3, 240);
    VIEWS.forEach((v) => { v.T = { t1, t2, t3, t4 }; v.freeW = w; v.freeH = h; });
    requestAnimationFrame(measureFree);
    layoutRibbon();
    invalidate();
  }
  const ro = new ResizeObserver((entries) => {
    const r = entries[0].contentRect;
    onStageSize(Math.round(r.width), Math.round(r.height));
  });
  ro.observe(shell.stageEl);

  // ══ state refresh (lens, filters, overlays, release) ══════════════════════════════════════════
  function refreshLens() {
    const lens = shell.state.lens;
    for (let i = 0; i < N; i++) { const r = BP.rating(FEATS[i], lens); S.band[i] = r.band; S.score[i] = r.score; }
    if (!PLAN) return;
    S.zoneRating = PLAN.zones.map((z) => BP.domainRating(z.id, lens));
    S.roomRating = PLAN.rooms.map((r) => BP.moduleRating(r.id, lens));
    S.wingRating = PLAN.wings.map((w) => BP.areaRating(w.id, lens));
  }
  function refreshFilter() {
    const st = shell.state;
    const dim = shell.dimmedIds(), hits = shell.hitIds();
    S.filtering = shell.filterActive();
    for (let i = 0; i < N; i++) { const id = FEATS[i].id; S.dim[i] = dim.has(id) ? 1 : 0; S.hit[i] = hits.has(id) ? 1 : 0; }
    const gk = st.gates;
    for (let i = 0; i < N; i++) S.gateOn[i] = gk && F_GATES[i].some((g) => gk === 'any' || g.kind === gk) ? 1 : 0;
    const ini = st.initiative;
    for (let i = 0; i < N; i++) S.cov[i] = ini ? BP.initiativeState(FEATS[i], ini) : null;
    S.overlay = st.query.trim() ? 'hits' : gk ? 'gates' : ini ? 'initiative' : S.filtering ? 'status' : null;
    if (!PLAN) return;
    S.zoneMatch = PLAN.zones.map((z) => z.rooms.reduce((s, r) => s + r.cells.reduce((t, c) => t + (S.dim[c.i] ? 0 : 1), 0), 0));
    S.roomMatch = PLAN.rooms.map((r) => r.cells.reduce((t, c) => t + (S.dim[c.i] ? 0 : 1), 0));
  }
  function refreshRelease() {
    S.pkg = new Map();
    const rel = REL[S.rel];
    BP.releaseItems(rel.id).forEach((it) => { const i = fIdx.get(it.feature); if (i != null) S.pkg.set(i, it.kind); });
    if (!PLAN) return;
    S.zonePkg = PLAN.zones.map((z) => {
      const c = { new: 0, improved: 0, fixed: 0 };
      z.rooms.forEach((r) => r.cells.forEach((cell) => { const k = S.pkg.get(cell.i); if (k) c[k]++; }));
      return c;
    });
  }
  function refreshAll() { refreshLens(); refreshFilter(); refreshRelease(); }

  // ══ drawing ══════════════════════════════════════════════════════════════════════════════════
  function hatchFor(v) {
    if (v.hatch) return v.hatch;
    const d = v.dpr, s = Math.round(6 * d);
    const pc = document.createElement('canvas'); pc.width = s; pc.height = s;
    const p = pc.getContext('2d');
    p.strokeStyle = rgba('na', DARK ? 0.55 : 0.5); p.lineWidth = Math.max(1, d * 0.9);
    p.beginPath(); p.moveTo(-1, s + 1); p.lineTo(s + 1, -1); p.moveTo(-1, 1); p.lineTo(1, -1); p.moveTo(s - 1, s + 1); p.lineTo(s + 1, s - 1); p.stroke();
    const pat = v.ctx.createPattern(pc, 'repeat');
    if (pat && pat.setTransform && window.DOMMatrix) pat.setTransform(new DOMMatrix().scale(1 / d));
    v.hatch = pat;
    return pat;
  }
  /** Time-based fade toward a target alpha for labels that appear or disappear at a fit threshold. */
  function fade(v, key, target, t) {
    if (reduceMotion()) return target;
    const rec = v.fades.get(key);
    if (!rec) { if (target > 0 && v.fadeReady) { v.fades.set(key, { a: 0, t }); v.animating = true; return 0; } v.fades.set(key, { a: target, t }); return target; }
    const dt = Math.max(0, t - rec.t);
    rec.t = t;
    if (rec.a < target) rec.a = Math.min(target, rec.a + dt / 160);
    else if (rec.a > target) rec.a = Math.max(target, rec.a - dt / 160);
    if (rec.a !== target) v.animating = true;
    return rec.a;
  }

  let VIEW_W = 1e6;
  const LEVEL_NAMES = ['Domains', 'Modules', 'Features', 'Feature names', 'Feature detail'];
  function draw(v, t) {
    const ctx = v.ctx, G = PLAN.G, cam = v.cam, k = cam.k;
    const W = v.w, H = v.h;
    const phase = v.mode === 'phase';
    v.animating = false;
    VIEW_W = v.w;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const X = (wx) => (wx - cam.x) * k, Y = (wy) => (wy - cam.y) * k;
    const s = G.CW * k;
    const T = v.T;
    // L0 -> L1 hands over in sequence (plaques fade out as the header labels fade in) so the two never stack up
    const a1 = smooth(T.t1 * 0.93, T.t1, s), a2 = smooth(T.t2 * 0.85, T.t2, s), a3 = smooth(T.t3 * 0.88, T.t3, s), a4 = smooth(T.t4 * 0.88, T.t4, s);
    const aPl = 1 - smooth(T.t1 * 0.86, T.t1 * 0.95, s);
    const level = s >= T.t4 ? 4 : s >= T.t3 ? 3 : s >= T.t2 ? 2 : s >= T.t1 ? 1 : 0;
    const vx0 = cam.x - 4 / k, vy0 = cam.y - 4 / k, vx1 = cam.x + (W + 4) / k, vy1 = cam.y + (H + 4) / k;
    const vis = (r) => r.x + r.w >= vx0 && r.x <= vx1 && r.y + r.h >= vy0 && r.y <= vy1;
    const sel = shell.state.selection;
    const hov = v.hover;

    // sheet
    const sh = PLAN.sheet;
    const sx = X(sh.x), sy = Y(sh.y), sw = sh.w * k, shh = sh.h * k;
    ctx.save();
    ctx.shadowColor = C.shadow; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
    ctx.fillStyle = C['paper-hi'];
    ctx.fillRect(sx, sy, sw, shh);
    ctx.restore();
    drawGraticule(ctx, v, sh, X, Y, k);
    if (sel && sel.type === 'product') selOutline(ctx, sx, sy, sw, shh, 0);

    // wings
    PLAN.wings.forEach((wg) => {
      if (!vis(wg)) return;
      const x = X(wg.x), y = Y(wg.y), w = wg.w * k, h = wg.h * k;
      ctx.fillStyle = rgba('ink', DARK ? 0.07 : 0.05);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = rgba('ink', DARK ? 0.28 : 0.22); ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
      if (sel && sel.type === 'area' && sel.id === wg.id) selOutline(ctx, x, y, w, h, 0);
      else if (hov && hov.type === 'area' && hov.id === wg.id) hoverOutline(ctx, x, y, w, h, 0);
    });

    // zones: fields, header bands, gauges
    PLAN.zones.forEach((z) => {
      if (!vis(z)) return;
      const x = X(z.x), y = Y(z.y), w = z.w * k, h = z.h * k;
      ctx.beginPath(); rr(ctx, x, y, w, h, Math.min(6, 4 * k));
      ctx.fillStyle = C['paper-hi']; ctx.fill();
      ctx.strokeStyle = rgba('ink-2', DARK ? 0.42 : 0.36); ctx.lineWidth = 1; ctx.stroke();
      const hbA = phase ? 1 : a1;
      if (hbA > 0) {
        ctx.save(); ctx.beginPath(); rr(ctx, x, y, w, h, Math.min(6, 4 * k)); ctx.clip();
        ctx.fillStyle = rgba('ink', (DARK ? 0.07 : 0.045) * hbA);
        ctx.fillRect(x, y, w, G.ZH * k);
        ctx.fillStyle = rgba('ink', 0.12 * hbA); ctx.fillRect(x, y + G.ZH * k - 0.5, w, 1);
        ctx.restore();
      }
      drawGauge(ctx, z, x, y, w, h, k, G, phase);
      if (sel && sel.type === 'domain' && sel.id === z.id) selOutline(ctx, x, y, w, h, Math.min(6, 4 * k));
      else if (hov && hov.type === 'domain' && hov.id === z.id) hoverOutline(ctx, x, y, w, h, Math.min(6, 4 * k));
    });

    // rooms: until fixtures arrive, each room is tinted by its module's band in the current lens (n/a hatched),
    // so the plan itself carries state at L0 and a lens switch repaints it
    const tintA = phase ? 0 : (1 - a2) * (1 - 0.35 * a1);
    const hatch0 = tintA > 0.01 ? hatchFor(v) : null;
    PLAN.rooms.forEach((r) => {
      if (!vis(r)) return;
      const x = X(r.x), y = Y(r.y), w = r.w * k, h = r.h * k;
      const ra = 0.45 + 0.55 * a1;
      const rad = Math.min(4, 3 * k);
      if (tintA > 0.01) {
        const rb = S.roomRating[r.ri].band;
        const fa = tintA * (S.filtering && S.roomMatch[r.ri] === 0 ? 0.3 : 1);
        ctx.beginPath(); rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, rad);
        if (rb === 'na') {
          ctx.globalAlpha = fa; ctx.fillStyle = hatch0 || C['na-soft']; ctx.fill();
          ctx.setLineDash([3, 2.5]); ctx.lineWidth = 1; ctx.strokeStyle = rgba('na', 0.85); ctx.stroke(); ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = rgba(rb, (DARK ? 0.25 : 0.2) * fa); ctx.fill();
          ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(rb, (DARK ? 0.8 : 0.7) * fa); ctx.stroke();
        }
      }
      ctx.beginPath(); rr(ctx, x, y, w, h, rad);
      ctx.strokeStyle = rgba('ink-2', (DARK ? 0.32 : 0.26) * ra * (1 - tintA * 0.6)); ctx.lineWidth = 1; ctx.stroke();
      if (a1 > 0.01) {
        ctx.fillStyle = rgba('ink', 0.09 * a1); ctx.fillRect(x + 6, y + G.RH * k, w - 12, 1);
      }
      if (sel && sel.type === 'module' && sel.id === r.id) selOutline(ctx, x, y, w, h, Math.min(4, 3 * k));
      else if (hov && hov.type === 'module' && hov.id === r.id) hoverOutline(ctx, x, y, w, h, Math.min(4, 3 * k));
    });

    // fixture placeholders: faint cell outlines uncover with the rooms, then cross-fade into fixtures
    const phA = phase ? 0 : a1 * (1 - a2);
    if (phA > 0.01) {
      ctx.beginPath();
      PLAN.rooms.forEach((room) => {
        if (!vis(room)) return;
        room.cells.forEach((c) => { const b = boxOf(c, X, Y, k); rr(ctx, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, Math.min(4, 3 * k)); });
      });
      ctx.lineWidth = 1; ctx.setLineDash([]); ctx.strokeStyle = rgba('ink', (DARK ? 0.14 : 0.1) * phA); ctx.stroke();
    }
    // fixtures
    const fxA = phase ? 1 : a2;
    if (fxA > 0.002) drawFixtures(v, ctx, X, Y, k, s, fxA, a3, a4, level, vis, t);
    // signal marks at fixture positions while fixtures are not drawn; marks under a zone label are left out whole
    if (!phase && fxA < 0.999) {
      // a plaque that is still mostly opaque masks the marks under it; the plaque counts them all
      PLAN.zones.forEach((z) => { z._plate = aPl > 0.5 && vis(z) ? plaqueRect(v, z) : null; });
      drawMarks(v, ctx, X, Y, k, s, 1 - fxA);
    } else PLAN.zones.forEach((z) => { z._plate = null; });

    // links of the selected feature
    if (sel && sel.type === 'feature' && LINKS && LINKS.id === sel.id) drawLinks(ctx, X, Y, k, s);

    // labels
    drawLabels(v, ctx, X, Y, k, s, a1, a2, a3, vis, t, phase, aPl);

    // selected feature target (above labels)
    if (sel && sel.type === 'feature' && fIdx.has(sel.id)) drawSelectedFeature(ctx, PLAN.cells[fIdx.get(sel.id)], X, Y, k, s, fxA);
    if (hov && hov.type === 'feature' && (!sel || sel.id !== FEATS[hov.i].id)) {
      const c = PLAN.cells[hov.i];
      if (fxA > 0.5) { const b = boxOf(c, X, Y, k); ctx.beginPath(); rr(ctx, b.x - 2, b.y - 2, b.w + 4, b.h + 4, 5); ctx.lineWidth = 1.5; ctx.strokeStyle = rgba('ink', 0.55); ctx.setLineDash([]); ctx.stroke(); }
      else { ctx.beginPath(); circle(ctx, X(c.cx), Y(c.cy), 8); ctx.lineWidth = 1.5; ctx.strokeStyle = rgba('ink', 0.6); ctx.setLineDash([]); ctx.stroke(); }
    }
    v.fadeReady = true;
    updateReadout(v, level, k, s);
  }

  function selOutline(ctx, x, y, w, h, r) {
    ctx.save();
    ctx.beginPath(); rr(ctx, x - 2, y - 2, w + 4, h + 4, r + 2);
    ctx.shadowColor = DARK ? rgba('ink', 0.5) : rgba('ink', 0.25); ctx.shadowBlur = 10;
    ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.setLineDash([]); ctx.stroke();
    ctx.restore();
  }
  function hoverOutline(ctx, x, y, w, h, r) {
    ctx.beginPath(); rr(ctx, x - 1, y - 1, w + 2, h + 2, r + 1);
    ctx.lineWidth = 1.5; ctx.strokeStyle = rgba('ink', 0.45); ctx.setLineDash([]); ctx.stroke();
  }

  function drawGraticule(ctx, v, sh, X, Y, k) {
    const x0 = X(sh.x), y0 = Y(sh.y), x1 = X(sh.x + sh.w), y1 = Y(sh.y + sh.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    let step = 32;
    while (step * k < 22) step *= 2;
    const major = step * 4;
    const gx0 = Math.max(sh.x, Math.floor((v.cam.x) / step) * step), gx1 = Math.min(sh.x + sh.w, v.cam.x + v.w / k);
    const gy0 = Math.max(sh.y, Math.floor((v.cam.y) / step) * step), gy1 = Math.min(sh.y + sh.h, v.cam.y + v.h / k);
    ctx.lineWidth = 1;
    ['minor', 'major'].forEach((pass) => {
      ctx.beginPath();
      for (let gx = gx0; gx <= gx1; gx += step) { const isM = Math.abs(gx % major) < 0.01; if ((pass === 'major') !== isM) continue; const px = Math.round(X(gx)) + 0.5; ctx.moveTo(px, y0); ctx.lineTo(px, y1); }
      for (let gy = gy0; gy <= gy1; gy += step) { const isM = Math.abs(gy % major) < 0.01; if ((pass === 'major') !== isM) continue; const py = Math.round(Y(gy)) + 0.5; ctx.moveTo(x0, py); ctx.lineTo(x1, py); }
      ctx.strokeStyle = rgba('ink', pass === 'major' ? (DARK ? 0.075 : 0.06) : (DARK ? 0.04 : 0.032));
      ctx.stroke();
    });
    ctx.restore();
    // frame: double hairline with a tick scale between, like the bezel of an instrument
    const inset = Math.min(PLAN.G.SM * k * 0.45, 12);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba('ink', DARK ? 0.32 : 0.26);
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0) - 1, Math.round(y1 - y0) - 1);
    if (inset >= 4) {
      ctx.strokeStyle = rgba('ink', DARK ? 0.18 : 0.14);
      ctx.strokeRect(Math.round(x0 + inset) + 0.5, Math.round(y0 + inset) + 0.5, Math.round(x1 - x0 - 2 * inset) - 1, Math.round(y1 - y0 - 2 * inset) - 1);
      let ts = 16;
      while (ts * k < 5) ts *= 2;
      ctx.beginPath();
      const tick = (len, horiz, p, base, dir) => { if (horiz) { ctx.moveTo(p, base); ctx.lineTo(p, base + dir * len); } else { ctx.moveTo(base, p); ctx.lineTo(base + dir * len, p); } };
      for (let gx = sh.x + ts; gx < sh.x + sh.w; gx += ts) {
        const px = Math.round(X(gx)) + 0.5;
        if (px < -2 || px > v.w + 2) continue;
        const len = Math.abs(gx % (ts * 4)) < 0.01 ? inset * 0.7 : inset * 0.38;
        tick(len, true, px, y0, 1); tick(len, true, px, y1, -1);
      }
      for (let gy = sh.y + ts; gy < sh.y + sh.h; gy += ts) {
        const py = Math.round(Y(gy)) + 0.5;
        if (py < -2 || py > v.h + 2) continue;
        const len = Math.abs(gy % (ts * 4)) < 0.01 ? inset * 0.7 : inset * 0.38;
        tick(len, false, py, x0, 1); tick(len, false, py, x1, -1);
      }
      ctx.strokeStyle = rgba('ink', DARK ? 0.3 : 0.24);
      ctx.stroke();
    }
  }

  const GAUGE_ORDER = ['good', 'fair', 'poor', 'critical', 'na'];
  function drawGauge(ctx, z, x, y, w, h, k, G, phase) {
    const zb = G.ZB * k;
    const th = clamp(zb * 0.34, 2.5, 6);
    if (zb < 5) return;
    const gx = x + Math.max(8, G.ZP * k), gw = w - 2 * Math.max(8, G.ZP * k);
    const gy = y + h - zb / 2 - th / 2;
    if (gw < 20) return;
    if (phase) {
      // phasing: share of the zone's features shipped by the selected release
      let shipped = 0, total = 0;
      z.rooms.forEach((r) => r.cells.forEach((c) => { total++; if (F_REL[c.i] >= 0 && F_REL[c.i] <= S.rel && REL[F_REL[c.i]].state === 'shipped') shipped++; }));
      ctx.beginPath(); rr(ctx, gx, gy, gw, th, th / 2); ctx.fillStyle = rgba('ink', 0.08); ctx.fill();
      if (shipped) { ctx.beginPath(); rr(ctx, gx, gy, gw * shipped / total, th, th / 2); ctx.fillStyle = rgba('ink', 0.55); ctx.fill(); }
      return;
    }
    const counts = S.zoneRating[z.zi].counts;
    const tot = GAUGE_ORDER.reduce((s2, b) => s2 + (counts[b] || 0), 0) || 1;
    ctx.save();
    ctx.beginPath(); rr(ctx, gx, gy, gw, th, th / 2); ctx.clip();
    let px = gx;
    GAUGE_ORDER.forEach((b) => {
      const n = counts[b] || 0;
      if (!n) return;
      const ww = gw * n / tot;
      if (b === 'na') { ctx.fillStyle = rgba('na', 0.22); ctx.fillRect(px, gy, ww, th); }
      else { ctx.fillStyle = C[b]; ctx.fillRect(px, gy, ww, th); }
      px += ww;
      if (px < gx + gw - 0.5) { ctx.fillStyle = C['paper-hi']; ctx.fillRect(px - 0.5, gy, 1, th); }
    });
    ctx.restore();
  }

  function boxOf(c, X, Y, k) {
    const G = PLAN.G;
    return { x: X(c.x + G.FI), y: Y(c.y + G.FI), w: (G.CW - 2 * G.FI) * k, h: (G.CH - 2 * G.FI) * k };
  }

  function phaseOf(i) {
    const ri = F_REL[i];
    if (ri < 0) return 'unscheduled';
    if (ri < S.rel) return 'earlier';
    if (ri === S.rel) return 'selected';
    if (ri === S.rel + 1) return 'next';
    return 'future';
  }

  function drawFixtures(v, ctx, X, Y, k, s, fxA, a3, a4, level, vis, t) {
    const G = PLAN.G, lens = shell.state.lens, phase = v.mode === 'phase';
    const hatch = hatchFor(v);
    const rad = Math.min(5, 3.2 * k);
    const glyphR = clamp((G.CH - 2 * G.FI) * k * 0.2, 2.6, 7);
    const showGlyph = phase ? smooth(v.T.t2 * 0.85, v.T.t2, s) : 1;
    PLAN.rooms.forEach((room) => {
      if (!vis(room)) return;
      room.cells.forEach((c) => {
        const i = c.i, f = c.f;
        const b = boxOf(c, X, Y, k);
        if (b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) return;
        const dim = S.dim[i];
        ctx.globalAlpha = fxA * (dim ? (DARK ? 0.16 : 0.14) : 1);
        const band = S.band[i];
        let inverse = false;
        if (!phase) {
          ctx.beginPath(); rr(ctx, b.x, b.y, b.w, b.h, rad);
          if (band === 'na') {
            ctx.fillStyle = hatch || C['na-soft']; ctx.fill();
            ctx.setLineDash([3, 2.5]); ctx.lineWidth = 1; ctx.strokeStyle = rgba('na', 0.9); ctx.stroke(); ctx.setLineDash([]);
          } else {
            ctx.fillStyle = rgba(band, DARK ? 0.2 : 0.17); ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = rgba(band, 0.75); ctx.stroke();
          }
        } else {
          const ph = phaseOf(i);
          const kind = S.pkg.get(i);
          const changed = kind && kind !== 'new';
          ctx.beginPath(); rr(ctx, b.x, b.y, b.w, b.h, rad);
          if (changed) {
            // a live feature improved or fixed in the selected release: lit in its band like the release's new work,
            // but at half strength under a heavy band rim, so it reads at the opening fit and stays distinct from new
            const tok = band === 'na' ? 'ink-2' : band;
            ctx.save();
            ctx.shadowColor = rgba(tok, DARK ? 0.6 : 0.35); ctx.shadowBlur = DARK ? 9 : 5;
            ctx.fillStyle = rgba(tok, DARK ? 0.5 : 0.42); ctx.fill();
            ctx.restore();
          } else if (ph === 'earlier') {
            const age = S.rel - F_REL[i];
            ctx.fillStyle = rgba('ink', (DARK ? 0.09 : 0.06) + (DARK ? 0.22 : 0.17) * clamp(1 - (age - 1) / Math.max(4, S.rel), 0, 1)); ctx.fill();
          } else if (ph === 'selected') {
            ctx.save();
            const tok = band === 'na' ? 'ink-2' : band;
            ctx.shadowColor = rgba(tok, DARK ? 0.75 : 0.45); ctx.shadowBlur = DARK ? 12 : 7;
            ctx.fillStyle = rgba(tok, DARK ? 0.92 : 0.86); ctx.fill();
            ctx.restore();
            ctx.lineWidth = 1; ctx.strokeStyle = rgba(tok, 1); ctx.stroke();
            inverse = true;
          } else if (ph === 'next') {
            ctx.fillStyle = C['paper-hi']; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = rgba('ink-2', 0.85); ctx.stroke();
          } else if (ph === 'future') {
            ctx.setLineDash([3.5, 3]); ctx.lineWidth = 1; ctx.strokeStyle = rgba('ink-3', 0.75); ctx.stroke(); ctx.setLineDash([]);
          } else {
            ctx.setLineDash([0.5, 3]); ctx.lineCap = 'round'; ctx.lineWidth = 1.4; ctx.strokeStyle = rgba('ink-3', 0.7); ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'butt';
          }
          if (changed) {
            const tok = band === 'na' ? 'ink' : band;
            ctx.beginPath(); rr(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, Math.max(0, rad - 1));
            ctx.lineWidth = clamp(s * 0.04, 2, 3); ctx.strokeStyle = C[tok]; ctx.stroke();
          }
          if (kind && s > 14) gReleaseKind(ctx, kind, b.x + b.w - clamp(s * 0.1, 3.5, 7) - 1, b.y + clamp(s * 0.1, 3.5, 7) + 1, clamp(s * 0.1, 3.5, 7));
        }
        // gate halo (revision cloud) when the gates overlay is on
        if (S.gateOn[i] && !dim) {
          ctx.beginPath(); cloudRect(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, clamp(s * 0.05, 2.2, 5));
          ctx.lineWidth = 1.4; ctx.strokeStyle = F_GATEKIND[i] === 'changes' && shell.state.gates !== 'triage' && shell.state.gates !== 'approval' ? C.alarm : C.gate; ctx.stroke();
        }
        if (S.hit[i]) { ctx.beginPath(); rr(ctx, b.x - 3.5, b.y - 3.5, b.w + 7, b.h + 7, rad + 3); ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke(); }
        if (S.cov[i] && !dim) {
          const cr = clamp(s * 0.06, 2.6, 5);
          gCov(ctx, S.cov[i], b.x + b.w - cr - 3, b.y + b.h - cr - 3, cr);
        }
        if (showGlyph <= 0.01) { ctx.globalAlpha = 1; return; }
        ctx.globalAlpha *= showGlyph;
        const pad = clamp(b.h * 0.12, 3, 9);
        // L3 -> L4: glyphs and the corona cross-fade, but text hands over in sequence (the L3 name and score fade out
        // over the first half, the L4 text fades in over the second), so two names never stack in one fixture
        const a4t = clamp(a4 * 2 - 1, 0, 1), l3t = 1 - clamp(a4 * 2, 0, 1);
        if (a4 > 0.01) drawDetail(v, ctx, c, b, a4, lens, inverse, t, a4t);
        if (a4 < 0.99) {
          const la = 1 - a4;
          const base = ctx.globalAlpha;
          ctx.globalAlpha = base * la;
          // L2: centred glyph and a one-line name where it fits; L3: glyph top-left, two-line name, score, marks.
          // L2 -> L3: the one-line name fades out while the glyph and the attention mark glide to their L3 spots (over
          // the first half), then the L3 name fades in beside them, so nothing pops at the hand-over
          const gr3 = clamp(b.h * 0.1, 4.2, 6.5), gx3 = b.x + pad + gr3, gy3 = b.y + pad + gr3 + 1;
          // Phasing: room for the package mark (new / improved / fixed) in the top-right corner
          const kOff = phase && s > 14 && S.pkg.get(i) ? 2 * clamp(s * 0.1, 3.5, 7) + 4 : 0;
          if (a3 <= 0.5) {
            const u = clamp(a3 * 2, 0, 1);
            const gr2 = glyphR, gx2 = b.x + Math.max(pad, b.w * 0.14) + gr2 * 0.4, gy2 = b.y + b.h / 2;
            const nameFont = fl(400, clamp(s * 0.12, 9.5, 11));
            const avail = b.w - (gx2 - b.x) - gr2 - 9 - 4 - kOff;
            const fits = avail > 18 && tw(f.name, nameFont, 0) <= avail;
            const nA = fade(v, 'n2:' + i, fits ? 1 : 0, t);
            // centred while there is no name; it slides left as a name fades in
            const px2 = b.x + b.w / 2 + (gx2 - b.x - b.w / 2) * clamp(nA, 0, 1);
            gStatus(ctx, f.status, px2 + (gx3 - px2) * u, gy2 + (gy3 - gy2) * u, gr2 + (gr3 - gr2) * u, inverse);
            if (nA > 0.01 && u < 1) {
              ctx.globalAlpha = base * la * nA * (1 - u);
              text(ctx, f.name, gx2 + gr2 + 6, gy2 + 3.6, nameFont, inverse ? C['on-ink'] : C.ink);
            }
            if (F_ATT[i]) {
              const mr = clamp(s * 0.06, 3, 5);
              // under the package mark at L2 (the fixture is narrow), beside it at L3
              const ax2 = b.x + b.w - mr - 2.5, ay2 = b.y + mr + 2.5 + (kOff ? kOff - 1 : 0), ax3 = b.x + b.w - pad - 5 - kOff;
              ctx.globalAlpha = base * la;
              gAttention(ctx, ax2 + (ax3 - ax2) * u, ay2 + (gy3 - ay2) * u, mr + (5.2 - mr) * u, inverse ? C['on-ink'] : null);
            }
          } else {
            const fa = clamp((a3 - 0.5) * 2, 0, 1);
            const gr = gr3, gx = gx3, gy = gy3;
            ctx.globalAlpha = base * la;
            gStatus(ctx, f.status, gx, gy, gr, inverse);
            ctx.globalAlpha = base * l3t * fa;
            const fs = clamp(s * 0.1, 11, 13.5);
            const nameFont = fl(inverse ? 500 : 400, fs);
            const markW = (F_ATT[i] ? 13 : 0) + (F_GATEKIND[i] ? 13 : 0) + kOff;
            const nx = gx + gr + 6;
            const fullW = b.x + b.w - pad - nx;
            const maxW = fullW - (markW ? markW + 2 : 0);
            const maxLines = b.h > fs * 4.4 ? 3 : 2;
            let lines = wrap(f.name, nameFont, 0, [Math.max(20, maxW), Math.max(20, fullW)], maxLines);
            // when the marks would cut the first word, the name takes the full width and the marks move to the foot
            const marksLow = markW > 0 && /…$/.test(lines[0]) && lines.length > 1;
            if (marksLow) lines = wrap(f.name, nameFont, 0, [Math.max(20, fullW - kOff), Math.max(20, fullW)], maxLines);
            const lh = fs * 1.17;
            const col = inverse ? C['on-ink'] : C.ink;
            lines.forEach((ln, j) => text(ctx, ln, nx, gy + 4 + j * lh, nameFont, col));
            let mx = b.x + b.w - pad - 5 - kOff;
            // the attention mark arrived at full strength from L2; it follows the name to the foot when that is needed
            const my2 = marksLow ? gy + (b.y + b.h - pad - 5 - gy) * fa : gy;
            if (F_ATT[i]) { ctx.globalAlpha = base * la; gAttention(ctx, mx, my2, 5.2, inverse ? C['on-ink'] : null); mx -= 13; }
            ctx.globalAlpha = base * la * fa;
            if (F_GATEKIND[i]) gGate(ctx, F_GATEKIND[i], mx, my2, 5.2);
            ctx.globalAlpha = base * l3t * fa;
            // score bottom-left
            if (!phase) {
              const sfont = fm(400, clamp(fs * 0.86, 10, 12));
              const by = b.y + b.h - pad - 1;
              if (by - (gy + 4 + (lines.length - 1) * lh) > fs * 0.9) {
                gBand(ctx, band, nx + 4, by - 4, 4.2);
                text(ctx, band === 'na' ? 'n/a' : OK.fmt.score(S.score[i]), nx + 12, by, sfont, band === 'na' ? C['ink-3'] : C['ink-2']);
              }
            } else {
              const by = b.y + b.h - pad - 1;
              if (by - (gy + 4 + (lines.length - 1) * lh) > fs * 0.9) {
                const r0 = F_REL[i] >= 0 ? REL[F_REL[i]] : null;
                text(ctx, r0 ? (f.status === 'live' ? 'v' + r0.id : '→ v' + r0.id) : 'Unscheduled', nx, by, fm(400, clamp(fs * 0.84, 10, 11.5)), inverse ? C['on-ink'] : C['ink-2']);
              }
            }
          }
          ctx.globalAlpha = base;
        }
        ctx.globalAlpha = 1;
      });
    });
    ctx.globalAlpha = 1;
  }

  /** L4: the on-canvas mini-detail inside the fixture. */
  /** L4: the on-canvas mini-detail inside the fixture: corona on the left, facts on the right. */
  function drawDetail(v, ctx, c, b, a4, lens, inverse, t, a4t) {
    const f = c.f, i = c.i;
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * a4;
    const pad = clamp(b.h * 0.09, 8, 14);
    const R = clamp(Math.min(b.h * 0.28, b.w * 0.155), 14, 54);
    const cx = b.x + pad + R + 4, cy = b.y + pad + R + 4;
    const col = inverse ? C['on-ink'] : C.ink, col2 = inverse ? C['on-ink'] : C['ink-2'];
    if (!inverse) { ctx.beginPath(); circle(ctx, cx, cy, R + 5); ctx.fillStyle = rgba('paper-hi', 0.92); ctx.fill(); }
    gCorona(ctx, f, cx, cy, R, lens);
    // the text arrives after the L3 name has gone (see drawFixtures)
    ctx.globalAlpha = base * (a4t == null ? a4 : a4t);
    if (ctx.globalAlpha <= 0.004) { ctx.globalAlpha = base; return; }
    const x1 = cx + R + 14, wMax = b.x + b.w - pad - x1;
    const yMax = b.y + b.h - pad;
    const fs = clamp(b.h * 0.095, 12.5, 19);
    const nameFont = fl(500, fs);
    let y = b.y + pad + fs * 0.95;
    wrap(f.name, nameFont, 0, wMax, 2).forEach((ln) => { text(ctx, ln, x1, y, nameFont, col); y += fs * 1.18; });
    const r = BP.rating(f, lens);
    const lf = clamp(fs * 0.8, 10.5, 12.5);
    y += 3;
    gBand(ctx, r.band, x1 + 5.5, y - lf * 0.34, 5.5);
    const sc = r.band === 'na' ? 'n/a' : OK.fmt.score(r.score);
    const scW = tw(sc, fm(500, lf), 0);
    text(ctx, sc, x1 + 15, y, fm(500, lf), col);
    const lbl = OK.lens(lens).label.toUpperCase() + ' · ' + OK.bandLabel(r.band).toUpperCase();
    text(ctx, ellipsize(lbl, fl(500, lf * 0.8), 1.1, wMax - 22 - scW), x1 + 21 + scW, y, fl(500, lf * 0.8), col2, 'left', 1.1);
    y += lf * 1.5;
    const small = fl(400, lf * 0.95);
    const lines = [];
    if (r.headline) wrap(r.headline, small, 0, wMax, b.h > 128 ? 2 : 1).forEach((ln) => lines.push({ s: ln, c: col2 }));
    if (r.facts && r.facts.length && b.h > 140) lines.push({ s: r.facts.slice(0, 3).map((x) => x.label + ' ' + x.value).join(' · '), c: col2 });
    const rel = f.release ? BP.release(f.release) : null;
    lines.push({ s: OK.statusLabel(f.status) + ' · ' + (rel ? (f.status === 'live' ? 'Shipped in ' : 'Targets ') + rel.label : 'Unscheduled'), c: col2 });
    lines.forEach((ln) => { if (y <= yMax) { text(ctx, ellipsize(ln.s, small, 0, wMax), x1, y, small, ln.c); y += lf * 1.3; } });
    y += 3;
    const bold = fl(500, lf * 0.92);
    if (F_ATT[i] && y <= yMax) { gAttention(ctx, x1 + 5, y - 4, 5, inverse ? C['on-ink'] : null); text(ctx, ellipsize('Needs attention', bold, 0, wMax - 14), x1 + 14, y, bold, inverse ? C['on-ink'] : C.alarm); y += lf * 1.35; }
    F_GATES[i].slice(0, 2).forEach((g) => {
      if (y > yMax) return;
      gGate(ctx, g.kind, x1 + 5, y - 4, 5);
      text(ctx, ellipsize(OK.labels.gate[g.kind].long + ' · ' + g.waitingDays + ' d', bold, 0, wMax - 14), x1 + 14, y, bold, inverse ? C['on-ink'] : g.kind === 'changes' ? C.alarm : C.gate);
      y += lf * 1.35;
    });
    ctx.globalAlpha = base;
  }
  /** L0 and L1 signal marks at fixture positions. A zone plaque never hides one: marks it would cover (and those just
      below it) ride on a rail under the plaque at their own column, clustered with a count when they share a column.
      Drawn positions are kept per view for hit tests. */
  function drawMarks(v, ctx, X, Y, k, s, ma) {
    const ov = S.overlay;
    const r = clamp(s * 0.15, 3.2, 5.6);
    // glyph radius of a mark (pins and clouds are wider than the attention asterisk)
    const gR = ov === 'hits' ? r * 1.65 : ov === 'gates' ? r * 1.55 : r * 1.05;
    if (!v.markX) { v.markX = new Float32Array(N); v.markY = new Float32Array(N); }
    v.markX.fill(NaN); v.markY.fill(NaN);
    ctx.globalAlpha = ma;
    const rails = new Map();
    for (let i = 0; i < N; i++) {
      const c = PLAN.cells[i];
      const x = X(c.cx), y = Y(c.cy);
      if (x < -10 || y < -10 || x > v.w + 10 || y > v.h + 10) continue;
      const dim = S.dim[i];
      const ovOn = !!(ov && !dim && (ov === 'hits' ? S.hit[i] : ov === 'gates' ? S.gateOn[i] : ov === 'initiative' ? S.cov[i] : true));
      const attOn = !!(F_ATT[i] && !(dim && S.filtering));
      if (!ovOn && !attOn) continue;
      const pl = c.room.zone._plate;
      if (pl && x > pl.x - gR && x < pl.x + pl.w + gR && y > pl.y - gR && y < pl.y + pl.h + 3 * gR + 6) {
        let list = rails.get(pl);
        if (!list) rails.set(pl, (list = []));
        list.push({ i, x: clamp(x, pl.x + gR + 2, pl.x + pl.w - gR - 2), ovOn, attOn });
        continue;
      }
      markAt(ctx, i, x, y, r, ovOn, attOn);
      v.markX[i] = x; v.markY[i] = y;
    }
    rails.forEach((list, pl) => {
      const ry = pl.y + pl.h + gR + 3;
      const cntFont = fm(500, 9.5);
      list.sort((p1, p2) => p1.x - p2.x || p1.i - p2.i);
      const clusters = [];
      list.forEach((m) => {
        const last = clusters[clusters.length - 1];
        const need = last ? 2 * gR + 3 + (last.items.length > 1 ? tw(String(last.items.length), cntFont, 0) + 3 : 0) : 0;
        if (last && m.x - last.x1 < need) { last.items.push(m); last.x1 = m.x; } else clusters.push({ x0: m.x, x1: m.x, items: [m] });
      });
      clusters.forEach((cl) => {
        const cx = (cl.x0 + cl.x1) / 2;
        const first = cl.items.find((m) => m.ovOn) || cl.items[0];
        markAt(ctx, first.i, cx, ry, r, cl.items.some((m) => m.ovOn), cl.items.some((m) => m.attOn));
        if (cl.items.length > 1) text(ctx, String(cl.items.length), cx + gR + 2, ry + gR * 0.75, cntFont, ov && first.ovOn ? C['ink-2'] : C.alarm);
        cl.items.forEach((m) => { v.markX[m.i] = cx; v.markY[m.i] = ry; });
      });
    });
    ctx.globalAlpha = 1;
  }
  function markAt(ctx, i, x, y, r, ovOn, attOn) {
    const ov = S.overlay;
    if (ovOn) {
      if (ov === 'hits') gPin(ctx, x, y, r * 0.85);
      else if (ov === 'gates') {
        const col = F_GATEKIND[i] === 'changes' && shell.state.gates === 'any' ? C.alarm : C.gate;
        ctx.beginPath(); cloudCircle(ctx, x, y, r * 1.05, 7); ctx.fillStyle = rgba('paper-hi', 0.9); ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = col; ctx.setLineDash([]); ctx.stroke();
        ctx.beginPath(); circle(ctx, x, y, r * 0.32); ctx.fillStyle = col; ctx.fill();
      } else if (ov === 'initiative') gCov(ctx, S.cov[i], x, y, r * 0.72);
      else gStatus(ctx, FEATS[i].status, x, y, r * 0.8);
    }
    if (attOn) {
      const off = ovOn && ov !== 'status' ? r * 1.1 : 0;
      gAttention(ctx, x + off, y - off, r);
    }
  }

  function drawSelectedFeature(ctx, c, X, Y, k, s, fxA) {
    if (!c) return;
    const b = boxOf(c, X, Y, k);
    ctx.save();
    ctx.setLineDash([]);
    if (fxA > 0.5) {
      ctx.beginPath(); rr(ctx, b.x - 4, b.y - 4, b.w + 8, b.h + 8, 7);
      ctx.shadowColor = DARK ? rgba('ink', 0.6) : rgba('ink', 0.3); ctx.shadowBlur = 12;
      ctx.lineWidth = 2.4; ctx.strokeStyle = C.ink; ctx.stroke();
    } else {
      const x = X(c.cx), y = Y(c.cy);
      ctx.beginPath(); circle(ctx, x, y, 10); ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.shadowColor = rgba('ink', 0.35); ctx.shadowBlur = 8; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x - 12, y); ctx.moveTo(x + 12, y); ctx.lineTo(x + 16, y); ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 12); ctx.moveTo(x, y + 12); ctx.lineTo(x, y + 16);
      ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); circle(ctx, x, y, 3.2); ctx.fillStyle = C.ink; ctx.fill();
    }
    ctx.restore();
  }

  // ── labels ──────────────────────────────────────────────────────────────────────────────────
  /** A label plate in the colour of the paper it sits on, so it only masks what is under the label. */
  function plate(ctx, x, y, w, h, a) {
    ctx.beginPath(); rr(ctx, x, y, w, h, Math.min(8, h / 2));
    ctx.fillStyle = rgba('paper-hi', 0.96 * a); ctx.fill();
  }
  /** A sticky header band: masks a strip across its container so content scrolls under it. */
  function stickyBand(ctx, x, y, w, h, r) {
    ctx.save();
    ctx.beginPath(); rr(ctx, x + 1, y, w - 2, h, r || 0);
    ctx.shadowColor = rgba('ink', DARK ? 0.4 : 0.12); ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    // opaque, so no ghost of a label scrolled under it shows through the band's own label
    ctx.fillStyle = C['paper-hi']; ctx.fill();
    ctx.restore();
    ctx.fillStyle = rgba('ink', 0.12); ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
  }
  function drawLabels(v, ctx, X, Y, k, s, a1, a2, a3, vis, t, phase, aPl) {
    const G = PLAN.G;
    // wing (area) labels in their header strips, the area's band and score right after the name;
    // on a narrow wing the name wraps onto two lines and the score follows the line that has room
    PLAN.wings.forEach((wg, wi) => {
      if (!vis(wg)) return;
      const x = X(wg.x), y = Y(wg.y), w = wg.w * k, hh = G.WH * k;
      // a header strip half under the top edge is left out (zone headers stick there and carry the context)
      if (y + hh * 0.45 < 0 || y > v.h) return;
      const padX = Math.max(G.WP * k, 8);
      const rt = S.wingRating[wi];
      const sc = rt.band === 'na' ? 'n/a' : OK.fmt.score(rt.score);
      // the area's score reads a step above its tracked-caps name, right after it
      const scF = (fs) => fm(500, fs * 1.14);
      const scW = (fs) => fs * 1.3 + 5 + tw(sc, scF(fs), 0);
      const pieces = phase ? [] : [{ w: scW, cw: (fs) => fs * 1.3 }];
      const base0 = clamp(hh * 0.42, 11, 17);
      const sizes = [];
      for (let fs = base0; fs >= 10; fs -= 0.5) sizes.push(fs);
      const name = wg.a.name.toUpperCase();
      const avail = w - 2 * padX;
      const scoreAt = (fs, px, by) => {
        const r0 = fs * 0.65;
        gBand(ctx, rt.band, px + r0, by - fs * 0.38, r0);
        text(ctx, sc, px + r0 * 2 + 5, by + fs * 0.06, scF(fs), rt.band === 'na' ? C['ink-3'] : C.ink);
      };
      const one = fitHeader(name, sizes, 0.24, 500, avail, pieces, 12);
      const oneLine = () => {
        const by = y + hh / 2 + one.fs * 0.36;
        const lx = x + padX < 8 ? Math.min(8, x + w - padX - one.nameW - one.piecesW) : x + padX;
        text(ctx, one.name, lx, by, one.font, C['ink-2'], 'left', one.ls);
        if (one.n) {
          if (one.cmp) { const r0 = one.fs * 0.65; gBand(ctx, rt.band, lx + one.nameW + 12 + r0, by - one.fs * 0.38, r0); }
          else scoreAt(one.fs, lx + one.nameW + 12, by);
        }
      };
      // one line when the name keeps its score beside it
      if (!one.ellipsis && (!pieces.length || (one.n && !one.cmp))) { oneLine(); return; }
      // otherwise two lines on a plate, overlapping the top of the wing's first zone (empty at this level), with the
      // score reserved on the last line; then one line with the band glyph; then two lines with the glyph; then none
      const fs0 = Math.min(10, Math.max(7.5, Math.floor((hh - 3) / 2.06 * 2) / 2));
      let fs = fs0, lines = null, font, ls, sw = 0, cmp = false;
      const tryLines = (reserve) => {
        for (fs = fs0; fs >= 7.5; fs -= 0.5) {
          font = fl(500, fs); ls = fs * 0.14;
          const r = reserve ? reserve(fs) : 0;
          lines = wrap(name, font, ls, r ? [avail, avail - 8 - r] : avail, 2, true);
          // a name that fits one line but leaves no room for the score breaks early instead
          if (lines && r && lines.length === 1 && tw(lines[0], font, ls) + 8 + r > avail) lines = wrap(name, font, ls, avail - 8 - r, 2, true);
          if (lines && (!r || lines.length === 2 || tw(lines[0], font, ls) + 8 + r <= avail)) { sw = r; return true; }
        }
        lines = null;
        return false;
      };
      if (!(pieces.length && tryLines(scW))) {
        if (!one.ellipsis && one.n) { oneLine(); return; }
        if (!(pieces.length && (cmp = tryLines((f) => f * 1.3)))) {
          cmp = false;
          if (!tryLines(null)) { fs = 8.5; font = fl(500, fs); ls = 1; lines = wrap(name, font, ls, avail, 2); }
        }
      }
      const lh = Math.min(fs * 1.15, Math.max(fs * 1.02, (hh - 3) / 2));
      const lw = lines.map((l) => tw(l, font, ls));
      const sj = sw ? lines.length - 1 : -1;
      const bw = Math.max.apply(null, lw.map((l, j) => l + (j === sj ? 8 + sw : 0)));
      plate(ctx, x + padX - 4, y + 1.5, bw + 8, lines.length * lh + 3, 1);
      lines.forEach((ln, j) => {
        const by = y + 1.5 + fs + j * lh;
        text(ctx, ln, x + padX, by, font, C['ink-2'], 'left', ls);
        if (j !== sj) return;
        if (cmp) { const r0 = fs * 0.65; gBand(ctx, rt.band, x + padX + lw[j] + 8 + r0, by - fs * 0.38, r0); }
        else scoreAt(fs, x + padX + lw[j] + 8, by);
      });
    });

    // zones: plaque at L0, header band label from L1 (sticky at the top edge)
    const stickyBottom = new Map();
    PLAN.zones.forEach((z) => {
      if (!vis(z)) return;
      const x = X(z.x), y = Y(z.y), w = z.w * k, h = z.h * k;
      const matchA = S.filtering && S.zoneMatch[z.zi] === 0 ? 0.45 : 1;
      if (phase) {
        // Phasing keeps the fixtures clear: zone labels stay in the fixture-free strip at the top of the zone
        const hb = G.ZH * k;
        const free = zoneFree(z) * k - 1;
        const sh = Math.min(Math.max(hb, Math.min(17, free)), 32);
        const sticky = y < 0 && y + h > sh + 40;
        const top = sticky ? Math.min(0, y + h - sh - 40) : y;
        if (sticky || hb < 17) stickyBand(ctx, x, top, w, sh, sticky ? 0 : Math.min(6, 4 * k));
        if (sticky) stickyBottom.set(z.zi, top + sh);
        ctx.globalAlpha = matchA;
        zoneHeader(ctx, z, x, top, w, sh, sticky, true, sticky ? sh : free);
        ctx.globalAlpha = 1;
        return;
      }
      if (aPl > 0.01) {
        ctx.globalAlpha = aPl * matchA;
        drawPlaque(v, ctx, z);
        ctx.globalAlpha = 1;
      }
      if (a1 > 0.01) {
        const hb = G.ZH * k;
        const sh = Math.min(hb, 32);
        const sticky = y < 0 && y + h > sh + 40;
        ctx.globalAlpha = a1;
        if (sticky) { const top = Math.min(0, y + h - sh - 40); stickyBand(ctx, x, top, w, sh, 0); stickyBottom.set(z.zi, top + sh); }
        ctx.globalAlpha = a1 * matchA;
        zoneHeader(ctx, z, x, sticky ? stickyBottom.get(z.zi) - sh : y, w, sticky ? sh : hb, sticky, phase);
        ctx.globalAlpha = 1;
      }
    });

    // rooms: header labels from L1 (sticky under the zone's sticky band)
    if (a1 > 0.01) {
      PLAN.rooms.forEach((r) => {
        if (!vis(r)) return;
        const x = X(r.x), y = Y(r.y), w = r.w * k, h = r.h * k;
        const hb = G.RH * k;
        const sh = Math.min(hb, 26);
        const zTop = stickyBottom.has(r.zone.zi) ? stickyBottom.get(r.zone.zi) : 0;
        let top = y, sticky = false;
        if (y < zTop && y + h > zTop + sh + 30) { top = Math.min(zTop, y + h - sh - 30); sticky = true; }
        const matchA = S.filtering && S.roomMatch[r.ri] === 0 ? 0.45 : 1;
        ctx.globalAlpha = a1;
        if (sticky) stickyBand(ctx, x, top, w, sh, 0);
        ctx.globalAlpha = a1 * matchA;
        roomHeader(v, ctx, r, x, top, w, sticky ? sh : hb, false, phase, t);
        ctx.globalAlpha = 1;
      });
    }
  }
  // ── zone plaque (L0) ─────────────────────────────────────────────────────────────────────────
  // A compact instrument at the top of each zone: the name in tracked caps, then the band glyph and score, the
  // status mix and the attention and gate counters. It is laid out once per plan at the opening-fit scale and then
  // drawn scaled with the zoom, like a label printed on the plan, so it never re-flows or jumps while zooming.
  // Fitting drops, in order: counter words, the status bar, the counters; the score is the last thing to go.
  const PL_SIZES = [28, 26, 24, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12.5, 12, 11.5, 11, 10.5, 10, 9.5, 9];
  const PL_LAYOUTS = [
    [['score', 'bar', 'cntw']], [['score', 'bar', 'cnt']], [['score', 'cntw']], [['score', 'cnt']],
    [['score', 'bar'], ['cntw']], [['score', 'bar'], ['cnt']], [['score'], ['cntw']], [['score'], ['cnt']], [['score', 'bar']], [['score']],
  ];
  const PL_Q = [1, 0.985, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.82, 0.8];
  function plaqueLayout(z) {
    if (z._pl) return z._pl;
    const k0 = mapV.fitK, cls = CLASSES[PLAN.cls], G = PLAN.G;
    const Wz = z.w * k0, Hz = z.h * k0;
    const out = clamp(Math.min(Wz, Hz) * 0.035, 3.5, 8);
    const ix = clamp(Wz * 0.035, 5, 10), iy = clamp(Hz * 0.03, 4, 8);
    const avW = Wz - 2 * out - 2 * ix;
    const avH = Math.min(Hz - G.ZB * k0 - out - 6, Math.max(Hz * 0.56, 52)) - 2 * iy;
    const name = z.d.name.toUpperCase();
    const roll = BP.domainRollup(z.id);
    const gates = roll.gates.triage + roll.gates.approval + roll.gates.changes;
    const cnt = [];
    if (roll.attention) cnt.push({ g: 'att', n: roll.attention, word: 'attention' });
    if (gates) cnt.push({ g: 'gate', n: gates, word: gates === 1 ? 'gate' : 'gates' });
    const maxName = cls.maxName * clamp(k0 / PLAN.repK, 0.9, 1.3);
    const maxLines = PLAN.cls === 'tall' ? 3 : 2;
    const metrics = (fs) => {
      const scFs = clamp(fs * 0.72, 11, 17), cFs = clamp(fs * 0.48, 10.5, 12.5);
      const m = { scFs, scFont: fm(500, scFs), gr: clamp(fs * 0.3, 4.6, 7.5), cFs, cFont: fm(400, cFs), barW: clamp(fs * 3, 28, 72), barH: fs >= 16 ? 5 : 4, gap: clamp(fs * 0.45, 7, 11), rowGap: clamp(fs * 0.26, 3.5, 6) };
      const cntW = (words) => cnt.reduce((acc, p) => acc + (acc ? m.gap : 0) + 13 + tw(p.n + (words ? ' ' + p.word : ''), m.cFont, 0), 0);
      m.pw = { score: m.gr * 2 + 5 + tw('100', m.scFont, 0), bar: m.barW, cnt: cntW(false), cntw: cntW(true) };
      m.ph = { score: Math.max(m.gr * 2, m.scFs), bar: m.barH, cnt: m.cFs * 1.1, cntw: m.cFs * 1.1 };
      return m;
    };
    const measure = (rows, m, nameW, nameH) => {
      let w = nameW, h = nameH;
      rows.forEach((row) => {
        w = Math.max(w, row.reduce((acc, p) => acc + (acc ? m.gap : 0) + m.pw[p], 0));
        h += m.rowGap + Math.max.apply(null, row.map((p) => m.ph[p]));
      });
      return { w, h };
    };
    let best = null;
    for (const fs of PL_SIZES) {
      if (fs > maxName) continue;
      if (best && fs < best.fs * 0.8) break;
      for (const lsK of fs <= 12 ? [0.14, 0.07] : [0.15]) {
        const font = fl(500, fs), ls = fs * lsK;
        const lines = wrap(name, font, ls, avW, maxLines, true);
        if (!lines) continue;
        const lh = fs * 1.1, m = metrics(fs);
        const nameW = Math.max.apply(null, lines.map((l) => tw(l, font, ls)));
        let pick = null;
        for (let li = 0; li < PL_LAYOUTS.length && !pick; li++) {
          const rows = PL_LAYOUTS[li].map((row) => row.filter((p) => cnt.length || (p !== 'cnt' && p !== 'cntw'))).filter((row) => row.length);
          const d = measure(rows, m, nameW, lines.length * lh);
          if (d.w <= avW && d.h <= avH) pick = { li, rows, w: d.w, h: d.h };
        }
        if (!pick) continue;
        const q = fs * PL_Q[pick.li] * (lines.length > 1 ? 0.97 : 1);
        if (!best || q > best.q) best = Object.assign({ q, fs, font, ls, lines, lh, rows: pick.rows, w: pick.w, h: pick.h }, m);
        break;
      }
    }
    if (!best) {
      // nothing fits: the name ellipsized at the smallest size, and the score kept under it
      const fs = 9, font = fl(500, fs), ls = 0.6, m = metrics(fs);
      const lines = [ellipsize(name, font, ls, Math.max(12, avW))];
      const d = measure([['score']], m, tw(lines[0], font, ls), fs * 1.1);
      best = Object.assign({ q: 0, fs, font, ls, lines, lh: fs * 1.1, rows: [['score']], w: d.w, h: d.h }, m);
    }
    return (z._pl = Object.assign(best, { out, ix, iy, cnt, roll, k0 }));
  }
  /** The plaque's screen rect at the current zoom (it scales with the plan, within limits). */
  function plaqueRect(v, z) {
    const L = plaqueLayout(z), u = clamp(v.cam.k / L.k0, 0.7, 1.45), k = v.cam.k;
    return { x: (z.x - v.cam.x) * k + L.out * u, y: (z.y - v.cam.y) * k + L.out * u, w: (L.w + 2 * L.ix) * u, h: (L.h + 2 * L.iy) * u, u, L };
  }
  function drawPlaque(v, ctx, z) {
    const P = z._plate || plaqueRect(v, z);
    const L = P.L, u = P.u;
    const rt = S.zoneRating[z.zi];
    const sc = rt.band === 'na' ? 'n/a' : OK.fmt.score(rt.score);
    ctx.save();
    ctx.beginPath(); rr(ctx, P.x, P.y, P.w, P.h, Math.min(7 * u, P.h / 2));
    ctx.shadowColor = DARK ? C.shadow : rgba('ink', 0.16); ctx.shadowBlur = 7; ctx.shadowOffsetY = 1.5;
    ctx.fillStyle = rgba('paper-hi', 0.97); ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1; ctx.strokeStyle = rgba('ink', DARK ? 0.24 : 0.15); ctx.setLineDash([]); ctx.stroke();
    const x0 = P.x + L.ix * u;
    let yy = P.y + L.iy * u;
    const font = fl(500, L.fs * u), ls = L.ls * u, lh = L.lh * u;
    L.lines.forEach((ln) => { yy += lh; text(ctx, ln, x0, yy - lh * 0.22, font, C.ink, 'left', ls); });
    L.rows.forEach((row) => {
      yy += L.rowGap * u;
      const rh = Math.max.apply(null, row.map((p) => L.ph[p])) * u;
      const my = yy + rh / 2;
      let px = x0;
      row.forEach((p, j) => {
        if (j) px += L.gap * u;
        if (p === 'score') {
          const gr = L.gr * u, scFont = fm(500, L.scFs * u);
          gBand(ctx, rt.band, px + gr, my, gr);
          text(ctx, sc, px + gr * 2 + 5 * u, my + L.scFs * u * 0.36, scFont, rt.band === 'na' ? C['ink-3'] : C.ink);
          px += gr * 2 + 5 * u + tw(sc, scFont, 0);
        } else if (p === 'bar') {
          statusBar(ctx, L.roll, px, my - L.barH * u / 2, L.barW * u, L.barH * u);
          px += L.barW * u;
        } else {
          const words = p === 'cntw', cFont = fm(400, L.cFs * u);
          L.cnt.forEach((c, ci) => {
            if (ci) px += L.gap * u;
            if (c.g === 'att') gAttention(ctx, px + 5 * u, my, 5 * u); else gGate(ctx, 'approval', px + 5 * u, my, 5 * u);
            const s2 = c.n + (words ? ' ' + c.word : '');
            text(ctx, s2, px + 13 * u, my + L.cFs * u * 0.36, cFont, c.g === 'att' ? C.alarm : C.gate);
            px += 13 * u + tw(s2, cFont, 0);
          });
        }
      });
      yy += rh;
    });
  }
  function statusBar(ctx, roll, x, y, w, h) {
    const order = ['live', 'ready', 'building', 'planned', 'blocked'];
    const tok = { live: 'ink', ready: 'ink-2', building: 'ink-3', planned: 'ink-4', blocked: 'alarm' };
    ctx.save();
    ctx.beginPath(); rr(ctx, x, y, w, h, h / 2); ctx.clip();
    ctx.fillStyle = rgba('ink', 0.08); ctx.fillRect(x, y, w, h);
    let px = x;
    order.forEach((st) => {
      const n = roll.byStatus[st] || 0;
      if (!n) return;
      const ww = w * n / roll.count;
      ctx.fillStyle = C[tok[st]]; ctx.fillRect(px, y, ww, h);
      px += ww;
      ctx.fillStyle = C['paper-hi']; ctx.fillRect(px - 0.5, y, 1, h);
    });
    ctx.restore();
  }
  /** Zone label in its header band (L1 and deeper). Returns the bottom of the drawn label in screen px. */
  /** Zone label in its header band (L1 and deeper). Returns the bottom of the drawn label in screen px. */
  /** Depth of the fixture-free strip at the top of a zone (world units): its header band and the room headers. */
  function zoneFree(z) {
    if (z._free == null) z._free = Math.min.apply(null, z.rooms.map((r) => r.gy + PLAN.G.FI)) - z.y;
    return z._free;
  }
  function zoneHeader(ctx, z, x, y, w, hb, sticky, phase, maxH) {
    const base0 = clamp(hb * 0.36, 11, 19);
    const kk = w / z.w;
    if (x < 0 || x + w > VIEW_W) { const x0 = Math.max(x, 0), x1 = Math.min(x + w, VIEW_W); x = x0; w = Math.max(0, x1 - x0); }
    // a zone that only shows a sliver at the screen edge gets no label (a lone "C…" is noise)
    if (w < 64) return y + hb;
    const rt = S.zoneRating[z.zi];
    const roll = BP.domainRollup(z.id);
    const gates = roll.gates.triage + roll.gates.approval + roll.gates.changes;
    const pad = Math.max(10, PLAN.G.ZP * kk);
    const sc = rt.band === 'na' ? 'n/a' : OK.fmt.score(rt.score);
    const scF = (fs) => fm(500, fs * 0.92), cF = (fs) => fm(400, fs * 0.82);
    const pieces = [];
    if (!phase) {
      pieces.push({ kind: 'score', w: (fs) => fs * 1.1 + 6 + tw(sc, scF(fs), 0), cw: (fs) => fs * 1.1 });
      if (roll.attention) pieces.push({ kind: 'att', n: roll.attention, w: (fs) => 13 + tw(String(roll.attention), cF(fs), 0) });
      if (gates) pieces.push({ kind: 'gate', n: gates, w: (fs) => 13 + tw(String(gates), cF(fs), 0) });
    } else {
      const pk = S.zonePkg[z.zi] || {};
      ['new', 'improved', 'fixed'].forEach((kk) => { if (pk[kk]) pieces.push({ kind: kk, n: pk[kk], w: (fs) => 14 + tw(String(pk[kk]), cF(fs), 0), cw: kk === 'new' ? (fs) => 14 + tw(String(pk[kk]), cF(fs), 0) : null }); });
    }
    const avail = w - 2 * pad;
    const sizes = [];
    for (let fs = base0; fs >= Math.max(phase ? 8 : 10, base0 - 3); fs -= phase ? 0.5 : 1) sizes.push(fs);
    // the map keeps the score (glyph only) when the name must shorten; Phasing gives the name the room
    const fit = fitHeader(z.d.name.toUpperCase(), sizes, phase ? 0.14 : 0.2, 500, avail, pieces, phase ? 8 : 12, phase, !phase);
    if (fit.ellipsis && phase && (maxH || 0) >= 22) {
      // two lines on a plate, when the fixture-free strip at the top of the zone is deep enough for them
      const av2 = w - 10, nm = z.d.name.toUpperCase();
      let font = fl(500, 8), ls = 0.2, lines = null, f2 = 8;
      for (const [fz, l2] of [[9, 0.9], [9, 0.4], [8.5, 0.3], [8, 0.2]]) {
        if (fz * 2.04 + 5 > maxH) continue;
        f2 = fz; font = fl(500, fz); ls = l2; lines = wrap(nm, font, ls, av2, 2, true);
        if (lines) break;
      }
      if (!lines) lines = wrap(nm, font, ls, av2, 2);
      const lh = Math.min(f2 * 1.17, (maxH - 5) / 2);
      const bw = Math.max.apply(null, lines.map((l) => tw(l, font, ls)));
      plate(ctx, x + 1, y + 2, bw + 8, lines.length * lh + 4, ctx.globalAlpha);
      lines.forEach((ln, j) => text(ctx, ln, x + 5, y + 2 + f2 + 0.5 + j * lh, font, C.ink, 'left', ls));
      return y + hb;
    }
    const fs = fit.fs;
    const lb = Math.min(hb, 44);
    const by = y + hb - lb / 2 + fs * 0.36;
    const lx = x + pad < 8 ? Math.min(8, x + w - pad - fit.nameW - fit.piecesW) : x + pad;
    text(ctx, fit.name, lx, by, fit.font, C.ink, 'left', fit.ls);
    let px = lx + fit.nameW + 12;
    const my = by - fs * 0.34;
    for (let j = 0; j < fit.n; j++) {
      const p = pieces[j];
      if (p.kind === 'score') {
        gBand(ctx, rt.band, px + fs * 0.55, my, fs * 0.55);
        if (!fit.cmp) text(ctx, sc, px + fs * 1.1 + 6, by, scF(fs), rt.band === 'na' ? C['ink-3'] : C.ink);
        px += (fit.cmp ? p.cw(fs) : p.w(fs)) + 12;
        continue;
      }
      if (p.kind === 'att') { gAttention(ctx, px + 5, my, 5); text(ctx, String(p.n), px + 13, by, cF(fs), C.alarm); }
      else if (p.kind === 'gate') { gGate(ctx, 'approval', px + 5, my, 5); text(ctx, String(p.n), px + 13, by, cF(fs), C.gate); }
      else { gReleaseKind(ctx, p.kind, px + 5, my, 5); text(ctx, String(p.n), px + 14, by, cF(fs), C['ink-2']); }
      px += p.w(fs) + 12;
    }
    return y + hb;
  }
  function roomHeader(v, ctx, r, x, y, w, hb, sticky, phase, t) {
    if (hb < 11) return;
    if (x < 0 || x + w > v.w) { const x0 = Math.max(x, 0), x1 = Math.min(x + w, v.w); x = x0; w = Math.max(0, x1 - x0); }
    const base0 = clamp(hb * 0.4, 9.5, 15);
    const pad = Math.max(7, PLAN.G.RP * v.cam.k);
    const rt = S.roomRating[r.ri];
    const roll = BP.moduleRollup(r.id);
    const gates = roll.gates.triage + roll.gates.approval + roll.gates.changes;
    const sc = rt.band === 'na' ? 'n/a' : OK.fmt.score(rt.score);
    const scF = (fs) => fm(400, fs * 0.95), cF = (fs) => fm(400, fs * 0.86);
    const pieces = [];
    if (!phase) {
      pieces.push({ kind: 'score', w: (fs) => fs + 4 + tw(sc, scF(fs), 0), cw: (fs) => fs });
      if (roll.attention) pieces.push({ kind: 'att', n: roll.attention, w: (fs) => 12 + tw(String(roll.attention), cF(fs), 0) });
      if (gates) pieces.push({ kind: 'gate', n: gates, w: (fs) => 12 + tw(String(gates), cF(fs), 0) });
    }
    const avail = w - 2 * pad;
    const sizes = [];
    for (let fs = base0; fs >= Math.max(8.5, base0 - 2); fs -= 0.5) sizes.push(fs);
    const fit = fitHeader(r.m.name.toUpperCase(), sizes, 0.13, 500, avail, pieces, 8, false, true);
    const ok = avail > 40 && fit.nameW > 26;
    const a = fade(v, 'rh:' + r.ri, ok ? 1 : 0, t);
    if (a <= 0.01) return;
    const base = ctx.globalAlpha;
    const fs = fit.fs;
    const lb = Math.min(hb, 34);
    const by = y + hb - lb / 2 + fs * 0.36;
    if (sticky) plate(ctx, x + pad - 5, y + 2, Math.min(avail + 10, fit.nameW + fit.piecesW + 12), hb - 4, base);
    ctx.globalAlpha = base * a;
    const lx = x + pad < 8 ? Math.min(8, x + w - pad - fit.nameW - fit.piecesW) : x + pad;
    text(ctx, fit.name, lx, by, fit.font, C['ink-2'], 'left', fit.ls);
    let px = x + w - pad - fit.piecesW + 8;
    const my = by - fs * 0.34;
    for (let j = 0; j < fit.n; j++) {
      const p = pieces[j];
      if (p.kind === 'score') {
        gBand(ctx, rt.band, px + fs * 0.5, my, fs * 0.5);
        if (!fit.cmp) text(ctx, sc, px + fs + 4, by, scF(fs), rt.band === 'na' ? C['ink-3'] : C['ink-2']);
        px += (fit.cmp ? p.cw(fs) : p.w(fs)) + 8;
        continue;
      }
      if (p.kind === 'att') { gAttention(ctx, px + 4.5, my, 4.5); text(ctx, String(p.n), px + 12, by, cF(fs), C.alarm); }
      else { gGate(ctx, 'approval', px + 4.5, my, 4.5); text(ctx, String(p.n), px + 12, by, cF(fs), C.gate); }
      px += p.w(fs) + 8;
    }
    ctx.globalAlpha = base;
  }
  // ── links ───────────────────────────────────────────────────────────────────────────────────
  let LINKS = null;
  const NO_OFF = [0, 0];
  function drawLinks(ctx, X, Y, k, s) {
    // links that share a corridor run in parallel lanes (assigned once per selection), a few px apart on screen
    const gap = clamp(k * 5, 3.5, 6);
    const paths = LINKS.paths.filter((p) => p.pts).map((p) => ({ p, pts: p.pts.map((q, j) => { const o = p.off ? p.off[j] : NO_OFF; return [X(q[0]) + o[0] * gap, Y(q[1]) + o[1] * gap]; }) }));
    const trace = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length - 1; j++) {
        const r0 = Math.min(10, Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]) / 2, Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]) / 2);
        ctx.arcTo(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], r0);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    };
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]);
    // halos first, so a halo never cuts a neighbouring lane
    paths.forEach(({ pts }) => { trace(pts); ctx.lineWidth = 4.5; ctx.strokeStyle = rgba('paper-hi', 0.85); ctx.stroke(); });
    paths.forEach(({ p, pts }) => {
      trace(pts); ctx.setLineDash(p.dir === 'dep' ? [] : [5, 4]); ctx.lineWidth = 1.7; ctx.strokeStyle = p.dir === 'dep' ? C.ink : C['ink-2']; ctx.stroke();
    });
    ctx.setLineDash([]);
    paths.forEach(({ p, pts }) => {
      // arrow toward the dependency, and a ring on the far feature
      const tip = p.dir === 'dep' ? pts[pts.length - 1] : pts[0];
      const prev = p.dir === 'dep' ? pts[pts.length - 2] : pts[1];
      if (prev) {
        const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
        const ax = tip[0] - Math.cos(ang) * 9, ay = tip[1] - Math.sin(ang) * 9;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(ang - 0.45) * 7, ay - Math.sin(ang - 0.45) * 7); ctx.lineTo(ax - Math.cos(ang + 0.45) * 7, ay - Math.sin(ang + 0.45) * 7); ctx.closePath();
        ctx.fillStyle = p.dir === 'dep' ? C.ink : C['ink-2']; ctx.fill();
      }
      const other = p.dir === 'dep' ? pts[pts.length - 1] : pts[0];
      ctx.beginPath(); circle(ctx, other[0], other[1], 3.4); ctx.fillStyle = C['paper-hi']; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = C.ink; ctx.stroke();
    });
    ctx.restore();
  }
  /** Gives links that share a stretch of corridor their own lanes: segments on the same grid line that overlap are
      coloured greedily and centred, and each point takes the lane of its horizontal and its vertical segment. */
  function assignLanes(paths) {
    const segs = [];
    paths.forEach((p, pi) => {
      p.off = p.pts.map(() => [0, 0]);
      for (let j = 0; j < p.pts.length - 1; j++) {
        const q0 = p.pts[j], q1 = p.pts[j + 1];
        const horiz = Math.abs(q1[1] - q0[1]) < 0.01, vert = Math.abs(q1[0] - q0[0]) < 0.01;
        if (horiz === vert) continue;
        const a = horiz ? Math.min(q0[0], q1[0]) : Math.min(q0[1], q1[1]), b = horiz ? Math.max(q0[0], q1[0]) : Math.max(q0[1], q1[1]);
        segs.push({ p, pi, j, horiz, c: horiz ? q0[1] : q0[0], a, b, lane: 0 });
      }
    });
    const lines = new Map();
    segs.forEach((sg) => { const key = (sg.horiz ? 'h' : 'v') + Math.round(sg.c * 2); if (!lines.has(key)) lines.set(key, []); lines.get(key).push(sg); });
    lines.forEach((list) => {
      if (list.length < 2) return;
      list.sort((s1, s2) => s1.a - s2.a || s1.pi - s2.pi);
      let cluster = [], end = -Infinity;
      const flush = () => {
        if (cluster.length > 1) {
          const lanes = [];
          cluster.forEach((sg) => {
            let l = 0;
            while (l < lanes.length && lanes[l] > sg.a + 0.5) l++;
            lanes[l] = sg.b; sg.lane = l;
          });
          const mid = (lanes.length - 1) / 2;
          cluster.forEach((sg) => { sg.lane -= mid; });
        }
        cluster = [];
      };
      list.forEach((sg) => { if (sg.a > end - 0.5) { flush(); end = -Infinity; } cluster.push(sg); end = Math.max(end, sg.b); });
      flush();
    });
    segs.forEach((sg) => {
      if (!sg.lane) return;
      const ax = sg.horiz ? 1 : 0;
      sg.p.off[sg.j][ax] = sg.lane; sg.p.off[sg.j + 1][ax] = sg.lane;
    });
  }

  // grid router: corridors are cheap, headers (labels) and fixtures are expensive, turns cost a little
  let ROUTER = null;
  const RES = 8;
  function buildRouter() {
    const G = PLAN.G, sh = PLAN.sheet;
    const gw = Math.ceil(sh.w / RES) + 1, gh = Math.ceil(sh.h / RES) + 1;
    const cost = new Uint8Array(gw * gh).fill(1);
    const paint = (x, y, w, h, c) => {
      const i0 = Math.max(0, Math.floor(x / RES)), i1 = Math.min(gw - 1, Math.ceil((x + w) / RES) - 1);
      const j0 = Math.max(0, Math.floor(y / RES)), j1 = Math.min(gh - 1, Math.ceil((y + h) / RES) - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cost[j * gw + i] = c;
    };
    PLAN.wings.forEach((w) => paint(w.x, w.y, w.w, G.WH, 5));
    PLAN.zones.forEach((z) => { paint(z.x, z.y, z.w, z.h, 2); paint(z.x, z.y, z.w, G.ZH, 7); });
    PLAN.rooms.forEach((r) => { paint(r.x, r.y, r.w, r.h, 3); paint(r.x, r.y, r.w, G.RH, 8); });
    PLAN.cells.forEach((c) => paint(c.x + G.FI + 2, c.y + G.FI + 2, G.CW - 2 * G.FI - 4, G.CH - 2 * G.FI - 4, 16));
    ROUTER = { gw, gh, cost };
  }
  function route(a, b) {
    if (!ROUTER) buildRouter();
    const { gw, gh, cost } = ROUTER;
    const G = PLAN.G;
    const cell = (c) => [clamp(Math.floor(c.cx / RES), 0, gw - 1), clamp(Math.floor(c.cy / RES), 0, gh - 1)];
    const [si, sj] = cell(a), [ti, tj] = cell(b);
    const inBox = (c, i, j) => { const x = i * RES + RES / 2, y = j * RES + RES / 2; return x >= c.x + G.FI && x <= c.x + G.CW - G.FI && y >= c.y + G.FI && y <= c.y + G.CH - G.FI; };
    const n = gw * gh;
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const dirA = new Int8Array(n).fill(-1);
    const heap = [];
    const push = (node, f) => { heap.push([f, node]); let q = heap.length - 1; while (q > 0) { const p = (q - 1) >> 1; if (heap[p][0] <= heap[q][0]) break; const tmp = heap[p]; heap[p] = heap[q]; heap[q] = tmp; q = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let q = 0; for (;;) { const l = 2 * q + 1, r = l + 1; let m = q; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === q) break; const tmp = heap[m]; heap[m] = heap[q]; heap[q] = tmp; q = m; } } return top; };
    const s0 = sj * gw + si, t0 = tj * gw + ti;
    g[s0] = 0;
    push(s0, 0);
    const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
    let steps = 0;
    while (heap.length && steps < 120000) {
      const [, node] = pop();
      steps++;
      if (node === t0) break;
      const i = node % gw, j = (node - i) / gw;
      for (let d = 0; d < 4; d++) {
        const ni = i + DX[d], nj = j + DY[d];
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const nn = nj * gw + ni;
        let c = cost[nn];
        if (c > 1 && (inBox(a, ni, nj) || inBox(b, ni, nj))) c = 1;
        const turn = dirA[node] >= 0 && dirA[node] !== d ? 3 : 0;
        const ng = g[node] + c + turn;
        if (ng < g[nn]) { g[nn] = ng; from[nn] = node; dirA[nn] = d; push(nn, ng + Math.abs(ni - ti) + Math.abs(nj - tj)); }
      }
    }
    if (from[t0] < 0 && t0 !== s0) return [[a.cx, a.cy], [b.cx, b.cy]];
    const cells = [];
    for (let q = t0; q >= 0; q = from[q]) { cells.push(q); if (q === s0) break; }
    cells.reverse();
    const pts = [[a.cx, a.cy]];
    let lastDir = null;
    for (let q = 1; q < cells.length - 1; q++) {
      const i0 = cells[q] % gw, j0 = (cells[q] - i0) / gw;
      const i1 = cells[q + 1] % gw, j1 = (cells[q + 1] - i1) / gw;
      const d = (i1 - i0) + ',' + (j1 - j0);
      if (d !== lastDir) { pts.push([i0 * RES + RES / 2, j0 * RES + RES / 2]); lastDir = d; }
    }
    pts.push([b.cx, b.cy]);
    // straighten the first and last legs onto the fixture centres
    if (pts.length > 2) {
      const p1 = pts[1], p0 = pts[0];
      if (Math.abs(p1[0] - p0[0]) < Math.abs(p1[1] - p0[1])) p1[0] = p0[0]; else p1[1] = p0[1];
      const q1 = pts[pts.length - 2], q0 = pts[pts.length - 1];
      if (pts.length > 3) { if (Math.abs(q1[0] - q0[0]) < Math.abs(q1[1] - q0[1])) q1[0] = q0[0]; else q1[1] = q0[1]; }
    }
    // start and end on the fixture edges, so a link never crosses the fixture's own name
    const boxOfCell = (c) => [c.x + G.FI, c.y + G.FI, c.x + G.CW - G.FI, c.y + G.CH - G.FI];
    const inside = (bx, q) => q[0] > bx[0] && q[0] < bx[2] && q[1] > bx[1] && q[1] < bx[3];
    const exitAt = (bx, p0, q) => {
      const dx = q[0] - p0[0], dy = q[1] - p0[1];
      const tx = dx > 0 ? (bx[2] - p0[0]) / dx : dx < 0 ? (bx[0] - p0[0]) / dx : Infinity;
      const ty = dy > 0 ? (bx[3] - p0[1]) / dy : dy < 0 ? (bx[1] - p0[1]) / dy : Infinity;
      const tt = clamp(Math.min(tx, ty), 0, 1);
      return [p0[0] + dx * tt, p0[1] + dy * tt];
    };
    const trim = (list, bx) => {
      let j = 0;
      while (j < list.length - 1 && inside(bx, list[j + 1])) j++;
      if (j >= list.length - 1) return list;
      const e = exitAt(bx, list[j], list[j + 1]);
      return [e].concat(list.slice(j + 1));
    };
    let out = trim(pts, boxOfCell(a));
    out = trim(out.slice().reverse(), boxOfCell(b)).reverse();
    return out.length >= 2 ? out : pts;
  }
  let linkTimer = 0;
  function scheduleLinks() {
    clearTimeout(linkTimer);
    const sel = shell.state.selection;
    if (!sel || sel.type !== 'feature' || !fIdx.has(sel.id)) { LINKS = null; return; }
    if (LINKS && LINKS.id === sel.id && LINKS.plan === PLAN) return;
    linkTimer = setTimeout(() => {
      const s2 = shell.state.selection;
      if (!s2 || s2.type !== 'feature' || !PLAN) return;
      const i = fIdx.get(s2.id);
      const me = PLAN.cells[i];
      const paths = [];
      DEPS[i].forEach((id) => { const c = PLAN.cells[fIdx.get(id)]; if (c) paths.push({ dir: 'dep', id, pts: route(me, c) }); });
      DEPENDENTS[i].forEach((id) => { const c = PLAN.cells[fIdx.get(id)]; if (c) paths.push({ dir: 'used', id, pts: route(c, me) }); });
      assignLanes(paths.filter((p) => p.pts && p.pts.length > 1));
      LINKS = { id: s2.id, plan: PLAN, paths };
      invalidate();
    }, 30);
  }

  // ══ readout ══════════════════════════════════════════════════════════════════════════════════
  function updateReadout(v, level, k, s) {
    const last = v.ro.last;
    const lv = LEVEL_NAMES[level];
    if (last.level !== lv) { v.ro.level.textContent = lv; last.level = lv; }
    // scale bar: N fixtures across
    let n = 1;
    for (const c of [1, 2, 5, 10, 20, 50]) { n = c; if (c * s >= 38) break; }
    const bw = Math.round(clamp(n * s, 12, 120));
    const sc = n + (n === 1 ? ' feature' : ' features');
    if (last.sc !== sc) { v.ro.scale.textContent = sc; last.sc = sc; }
    if (last.bw !== bw) { v.ro.bar.style.width = bw + 'px'; last.bw = bw; }
    // location at the centre of the free view
    const fw = v.freeW || v.w, fh = Math.min(v.freeH || v.h, v.h - v.bottom);
    const wx = v.cam.x + fw / 2 / k, wy = v.cam.y + fh / 2 / k;
    let loc = BP.product.name + ' · ' + BP.areas.length + ' areas · ' + BP.domains.length + ' domains', ref = 'product';
    // a selected node is where you are; otherwise the node at the centre of the free view
    const sel = shell.state.selection;
    const selRoom = sel && sel.type === 'feature' && fIdx.has(sel.id) ? PLAN.cells[fIdx.get(sel.id)].room : sel && sel.type === 'module' ? PLAN.byModule.get(sel.id) : null;
    const selZone = selRoom ? selRoom.zone : sel && sel.type === 'domain' ? PLAN.byDomain.get(sel.id) : null;
    const selWing = selZone ? selZone.wing : sel && sel.type === 'area' ? PLAN.byArea.get(sel.id) : null;
    const wg = selWing || (level > 0 ? PLAN.wings.find((w) => inRect(w, wx, wy)) : null);
    if (selWing) {
      loc = selWing.a.name; ref = 'area:' + selWing.id;
      if (selZone) { loc += ' › ' + selZone.d.name; ref = 'domain:' + selZone.id; }
      if (selRoom) { loc += ' › ' + selRoom.m.name; ref = 'module:' + selRoom.id; }
    } else if (wg) {
      loc = wg.a.name; ref = 'area:' + wg.id;
      const z = wg.zones.find((zz) => inRect(zz, wx, wy));
      if (z) {
        loc += ' › ' + z.d.name; ref = 'domain:' + z.id;
        const r = z.rooms.find((rm) => inRect(rm, wx, wy));
        if (r) { loc += ' › ' + r.m.name; ref = 'module:' + r.id; }
      }
    }
    if (last.loc !== loc) {
      v.ro.loc.textContent = loc; v.ro.loc.title = 'Open ' + loc.split(' › ').pop().split(' · ')[0] + ' in the inspector';
      v.ro.loc.setAttribute('data-ok-inspect', ref); last.loc = loc;
    }
  }
  const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  // ══ hit testing and input ════════════════════════════════════════════════════════════════════
  function hitTest(v, sx, sy) {
    if (!PLAN) return null;
    const G = PLAN.G, k = v.cam.k, s = G.CW * k;
    const wx = v.cam.x + sx / k, wy = v.cam.y + sy / k;
    const T = v.T;
    const fixtures = v.mode === 'phase' || s >= T.t2 * 0.92;
    const rooms = s >= T.t1 * 0.94;
    // marks at L0/L1 act as pins, at the positions they were drawn (a plaque's rail included)
    if (!fixtures && v.markX) {
      let best = null, bd = 11;
      for (let i = 0; i < N; i++) {
        const mx = v.markX[i];
        if (mx !== mx) continue;
        const d = Math.hypot(mx - sx, v.markY[i] - sy);
        if (d < bd) { bd = d; best = i; }
      }
      if (best != null) return { type: 'feature', i: best, id: FEATS[best].id };
    }
    const wg = PLAN.wings.find((w) => inRect(w, wx, wy));
    if (!wg) return null;
    if (wy < wg.y + G.WH) return { type: 'area', id: wg.id };
    const z = wg.zones.find((zz) => inRect(zz, wx, wy));
    if (!z) return { type: 'area', id: wg.id };
    if (!rooms && !fixtures) return { type: 'domain', id: z.id };
    if (wy < z.y + G.ZH) return { type: 'domain', id: z.id };
    const r = z.rooms.find((rm) => inRect(rm, wx, wy));
    if (!r) return { type: 'domain', id: z.id };
    if (fixtures) {
      const col = Math.floor((wx - r.gx) / G.CW), row = Math.floor((wy - r.gy) / G.CH);
      if (col >= 0 && row >= 0 && col < r.c) {
        const c = r.cells[row * r.c + col];
        if (c && wx >= c.x + G.FI - 2 && wx <= c.x + G.CW - G.FI + 2 && wy >= c.y + G.FI - 2 && wy <= c.y + G.CH - G.FI + 2) return { type: 'feature', i: c.i, id: c.f.id };
      }
    }
    if (!rooms) return { type: 'domain', id: z.id };
    return { type: 'module', id: r.id };
  }
  function nodeRect(ref) {
    if (!PLAN || !ref) return null;
    if (ref.type === 'feature') { const c = PLAN.cells[fIdx.get(ref.id)]; return c ? { x: c.x, y: c.y, w: PLAN.G.CW, h: PLAN.G.CH } : null; }
    if (ref.type === 'module') return PLAN.byModule.get(ref.id) || null;
    if (ref.type === 'domain') return PLAN.byDomain.get(ref.id) || null;
    if (ref.type === 'area') return PLAN.byArea.get(ref.id) || null;
    return null;
  }
  function activate(v, hit, opts) {
    if (!hit) { shell.select(null); return; }
    if (hit.type === 'feature') shell.peek(hit.id);
    else shell.inspect({ type: hit.type, id: hit.id });
    if (opts && opts.zoom && hit.type !== 'feature') zoomInto(v, hit);
  }
  function zoomInto(v, ref) {
    requestAnimationFrame(() => {
      measureFree();
      const r = nodeRect(ref);
      if (!r) return;
      v.touched = true;
      const pad = shell.isPhone() ? 14 : 30;
      const target = camFor(v, r, pad);
      // a module or domain should open at least one level deeper than it is now
      const G = PLAN.G;
      const minS = ref.type === 'area' ? v.T.t1 * 1.02 : ref.type === 'domain' ? v.T.t1 * 1.05 : v.T.t2 * 1.05;
      if (G.CW * target.k < minS) target.k = Math.min(minS / G.CW, kLimits(v)[1]);
      const W = v.freeW || v.w, H = Math.min(v.freeH || v.h, v.h - v.bottom);
      target.x = r.x + r.w / 2 - W / 2 / target.k; target.y = r.y + r.h / 2 - H / 2 / target.k;
      flyTo(v, target);
    });
  }
  function bindInput(v) {
    const cv = v.canvas;
    const ptrs = new Map();
    let down = null, pinch = null, lastTap = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or ended pointer */ }
      const p = pos(e);
      ptrs.set(e.pointerId, p);
      v.fly = null;
      if (ptrs.size === 1) down = { x: p[0], y: p[1], cam: Object.assign({}, v.cam), moved: false, type: e.pointerType, t: now() };
      else if (ptrs.size === 2) {
        const [a, b] = Array.from(ptrs.values());
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, cam: Object.assign({}, v.cam) };
        if (down) down.moved = true;
      }
      hideTip(v);
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (ptrs.has(e.pointerId)) {
        ptrs.set(e.pointerId, p);
        if (pinch && ptrs.size >= 2) {
          const [a, b] = Array.from(ptrs.values());
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          const c0 = pinch.cam;
          const [k0, k1] = kLimits(v);
          const k = clamp(c0.k * d / Math.max(10, pinch.d), k0, k1);
          const wx = c0.x + pinch.mx / c0.k, wy = c0.y + pinch.my / c0.k;
          v.touched = true;
          setCam(v, { k, x: wx - mx / k, y: wy - my / k });
          return;
        }
        if (down) {
          const dx = p[0] - down.x, dy = p[1] - down.y;
          if (!down.moved && Math.hypot(dx, dy) > (down.type === 'touch' ? 8 : 4)) { down.moved = true; cv.classList.add('is-dragging'); }
          if (down.moved) { v.touched = true; setCam(v, { k: down.cam.k, x: down.cam.x - dx / down.cam.k, y: down.cam.y - dy / down.cam.k }); }
        }
        return;
      }
      if (e.pointerType === 'mouse') hoverAt(v, p[0], p[1], e);
    });
    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      cv.classList.remove('is-dragging');
      if (ptrs.size === 1 && pinch) { pinch = null; const p = Array.from(ptrs.values())[0]; down = { x: p[0], y: p[1], cam: Object.assign({}, v.cam), moved: true, type: 'touch' }; return; }
      if (ptrs.size) return;
      pinch = null;
      if (down && !down.moved && e.type === 'pointerup') {
        const p = pos(e);
        const hit = hitTest(v, p[0], p[1]);
        const t = now();
        const dbl = lastTap && t - lastTap.t < 330 && Math.hypot(p[0] - lastTap.x, p[1] - lastTap.y) < 14;
        if (dbl) {
          lastTap = null;
          if (hit && hit.type === 'feature') shell.openFeature(hit.id);
          else if (hit) zoomInto(v, hit);
          else zoomAt(v, p[0], p[1], 2);
        } else {
          lastTap = { t, x: p[0], y: p[1] };
          activate(v, hit, { zoom: down.type === 'touch' });
        }
      }
      down = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size) { hideTip(v); if (v.hover) { v.hover = null; invalidate(v); } } });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0022));
      zoomAt(v, p[0], p[1], factor);
      hideTip(v);
    }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      const step = 90;
      const pan = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (pan) { e.preventDefault(); v.touched = true; setCam(v, { k: v.cam.k, x: v.cam.x + pan[0] / v.cam.k, y: v.cam.y + pan[1] / v.cam.k }); }
    });
    v.wrap.querySelector('.ap-zoom').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ap-zoom]');
      if (!b) return;
      const what = b.getAttribute('data-ap-zoom');
      if (what === 'fit') fitView(v, true);
      else zoomCenter(v, what === 'in' ? 1.6 : 1 / 1.6);
    });
  }
  function zoomCenter(v, f) {
    const c = v.cam;
    const fw = v.freeW || v.w, fh = Math.min(v.freeH || v.h, v.h - v.bottom);
    const [k0, k1] = kLimits(v);
    const k = clamp(c.k * f, k0, k1);
    const wx = c.x + fw / 2 / c.k, wy = c.y + fh / 2 / c.k;
    v.touched = true;
    flyTo(v, { k, x: wx - fw / 2 / k, y: wy - fh / 2 / k }, 260);
  }
  function hoverAt(v, x, y, e) {
    const hit = hitTest(v, x, y);
    const key = hit ? hit.type + ':' + (hit.id || hit.i) : '';
    const prev = v.hover ? v.hover.type + ':' + (v.hover.id || v.hover.i) : '';
    if (key !== prev) { v.hover = hit; invalidate(v); }
    v.canvas.style.cursor = hit ? 'pointer' : '';
    // tooltip when the label is not on the canvas
    const s = PLAN.G.CW * v.cam.k;
    let html = '';
    if (hit && hit.type === 'feature' && (s < v.T.t3 * 0.95)) html = tipFeature(v, hit.i);
    else if (hit && hit.type === 'module' && s < v.T.t1) html = tipModule(hit.id);
    if (!html) { hideTip(v); return; }
    const tip = v.tip;
    if (tip.getAttribute('data-k') !== key) { tip.innerHTML = html; tip.setAttribute('data-k', key); }
    tip.hidden = false;
    const tx = Math.min(x + 16, v.w - 270), ty = y + 18 > v.h - 90 ? y - 70 : y + 18;
    tip.style.transform = 'translate(' + Math.max(8, tx) + 'px,' + Math.max(8, ty) + 'px)';
  }
  function hideTip(v) { if (!v.tip.hidden) { v.tip.hidden = true; v.tip.removeAttribute('data-k'); } }
  function tipFeature(v, i) {
    const f = FEATS[i];
    const lens = shell.state.lens;
    const r = BP.rating(f, lens);
    const path = BP.pathOf(f);
    let h = '<div class="ap-tip__name">' + OK.html.status(f.status, 13) + '<b>' + esc(f.name) + '</b></div><div class="ap-tip__row">' + OK.html.rating(r, { size: 'sm', label: OK.lens(lens).label }) +
      '<span class="ap-tip__lens">' + esc(OK.lens(lens).label) + '</span><span class="ap-tip__muted">' + esc(OK.statusLabel(f.status)) + '</span></div>';
    if (v.mode === 'phase') {
      const rel = f.release ? BP.release(f.release) : null;
      const kind = S.pkg.get(i);
      h += '<div class="ap-tip__row ap-tip__muted">' + esc(rel ? (f.status === 'live' ? 'First shipped in ' : 'Targets ') + rel.label + ' · ' + OK.fmt.date(rel.date) : 'Unscheduled') + '</div>';
      if (kind) h += '<div class="ap-tip__row">' + OK.svg.wrap(OK.svg.releaseKind(kind, 5), 6, 13) + '<span>' + esc(OK.labels.releaseKind[kind] || kind) + ' in ' + esc(REL[S.rel].label) + '</span></div>';
    } else if (F_GATES[i].length || F_ATT[i]) {
      h += '<div class="ap-tip__row">' + (F_ATT[i] ? '<span class="ap-tip__alarm">' + OK.html.attention(12) + 'Needs attention</span>' : '') + (F_GATES[i].length ? '<span class="ap-tip__gate">' + OK.html.gate(F_GATES[i][0].kind, 12) + esc(F_GATES[i].length === 1 ? OK.labels.gate[F_GATES[i][0].kind].long : F_GATES[i].length + ' waiting for a human') + '</span>' : '') + '</div>';
    }
    h += '<div class="ap-tip__path">' + esc(path.domain.name + ' › ' + path.module.name) + '</div>';
    return h;
  }
  function tipModule(id) {
    const m = BP.module(id);
    const r = BP.moduleRating(id, shell.state.lens);
    return '<div class="ap-tip__name"><b>' + esc(m.name) + '</b></div><div class="ap-tip__row">' + OK.html.rating(r, { size: 'sm' }) + '<span class="ap-tip__lens">' + esc(OK.lens(shell.state.lens).label) + '</span><span class="ap-tip__muted">' + BP.featuresOf(id).length + ' features</span></div>';
  }

  // global keys: + − 0 (ignored while typing or on the feature page)
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (shell.state.page) return;
    const v = activeView();
    if (e.key === '+' || e.key === '=') { zoomCenter(v, 1.6); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { zoomCenter(v, 1 / 1.6); e.preventDefault(); }
    else if (e.key === '0') { fitView(v, true); e.preventDefault(); }
  });

  /** Brings a selected node back into the free part of the view (left of the inspector, above the phone sheet). */
  function ensureVisible(ref) {
    const v = activeView();
    if (!ref || v.fly || !PLAN) return;
    const r = nodeRect(ref);
    if (!r) return;
    const k = v.cam.k;
    const W = v.freeW || v.w, H = Math.min(v.freeH || v.h, v.h - v.bottom);
    const sx0 = (r.x - v.cam.x) * k, sy0 = (r.y - v.cam.y) * k, sx1 = sx0 + r.w * k, sy1 = sy0 + r.h * k;
    const m = 12, mt = PLAN.G.CW * k >= v.T.t1 ? 66 : 12;
    if (sx0 >= m && sy0 >= mt && sx1 <= W - m && sy1 <= H - m) return;
    if (ref.type !== 'feature' && r.w * k > W && r.h * k > H) return;
    let x = v.cam.x, y = v.cam.y;
    if (r.w * k <= W - 2 * m) { if (sx0 < m || sx1 > W - m) x = r.x + r.w / 2 - W / 2 / k; }
    if (r.h * k <= H - mt - m) { if (sy0 < mt || sy1 > H - m) y = r.y + r.h / 2 - (mt + (H - mt - m) / 2) / k; }
    if (x === v.cam.x && y === v.cam.y) return;
    v.touched = true;
    flyTo(v, { k, x, y }, 360);
  }

  // ══ locate ═══════════════════════════════════════════════════════════════════════════════════
  function locate(ref) {
    if (!ref || !PLAN) return;
    if (ref.type === 'release') { if (relIdx.has(ref.id)) setRelease(relIdx.get(ref.id)); return; }
    if (ref.type === 'product') { measureFree(); fitFree(activeView()); return; }
    const v = activeView();
    requestAnimationFrame(() => {
      measureFree();
      const r = nodeRect(ref.type === 'feature' ? { type: 'feature', id: ref.featureId || ref.id } : ref);
      if (!r) return;
      v.touched = true;
      if (ref.type === 'feature') {
        const G = PLAN.G;
        const s = G.CW * v.cam.k;
        const want = Math.max(s, v.T.t3 * 1.12);
        const k = Math.min(want / G.CW, kLimits(v)[1]);
        const W = v.freeW || v.w, H = Math.min(v.freeH || v.h, v.h - v.bottom);
        flyTo(v, { k, x: r.x + r.w / 2 - W / 2 / k, y: r.y + r.h / 2 - H / 2 / k }, 620);
      } else zoomInto(v, ref);
    });
  }

  // ══ timeline ribbon ══════════════════════════════════════════════════════════════════════════
  const rib = document.createElement('div');
  rib.className = 'ap-ribbon ok-panel';
  rib.setAttribute('role', 'group');
  rib.setAttribute('aria-label', 'Releases');
  rib.innerHTML = '<div class="ap-rib__head"><button type="button" class="ap-play" aria-label="Play through the releases" title="Play through the releases">' + playIcon(false) + '</button>' +
    '<div class="ap-rib__title"><span class="ap-rib__cap">Phasing</span><span class="ap-rib__sel"></span><span class="ap-rib__meta"></span></div></div>' +
    '<div class="ap-rib__axis"><svg class="ap-rib__svg" aria-hidden="false" role="list"></svg></div>';
  phaseV.wrap.appendChild(rib);
  const keySw = (inner) => '<svg width="20" height="13" viewBox="0 0 20 13" aria-hidden="true">' + inner + '</svg>';
  const key = document.createElement('div');
  key.className = 'ap-key';
  key.setAttribute('aria-label', 'Phasing key');
  key.innerHTML = [
    [keySw('<rect x="1.5" y="1.5" width="17" height="10" rx="2" fill="var(--ok-ink)" opacity=".18"/>'), 'Earlier'],
    [keySw('<rect x="1.5" y="1.5" width="17" height="10" rx="2" fill="var(--ok-good)"/>'), 'New in release'],
    [keySw('<rect x="1.5" y="1.5" width="17" height="10" rx="2" fill="var(--ok-good)" opacity=".42"/><rect x="2.5" y="2.5" width="15" height="8" rx="1.5" fill="none" stroke="var(--ok-good)" stroke-width="2"/>'), 'Improved or fixed'],
    [keySw('<rect x="1.5" y="1.5" width="17" height="10" rx="2" fill="var(--ok-paper-hi)" stroke="var(--ok-ink-2)" stroke-width="1.3"/>'), 'Next'],
    [keySw('<rect x="1.5" y="1.5" width="17" height="10" rx="2" fill="none" stroke="var(--ok-ink-3)" stroke-dasharray="3.5 3"/>'), 'Later'],
    [keySw('<rect x="1.5" y="1.5" width="17" height="10" rx="2" fill="none" stroke="var(--ok-ink-3)" stroke-dasharray=".5 3" stroke-linecap="round" stroke-width="1.4"/>'), 'Unscheduled'],
  ].map(([g, t]) => '<span>' + g + t + '</span>').join('');
  phaseV.wrap.querySelector('.ap-hud').insertBefore(key, phaseV.wrap.querySelector('.ap-zoom'));
  const ribSvg = rib.querySelector('.ap-rib__svg');
  const ribAxis = rib.querySelector('.ap-rib__axis');
  function playIcon(on) { return on ? '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3v10M11.5 3v10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' : '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L13 8Z" fill="currentColor"/></svg>'; }
  function ribbonReserve() { return shell.isPhone() ? 92 + 12 : 92 + 14; }
  const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
  const REL_STATS = REL.map((r) => {
    const items = BP.releaseItems(r.id);
    const c = { new: 0, improved: 0, fixed: 0, ready: 0, building: 0, blocked: 0, planned: 0, live: 0 };
    items.forEach((it) => { c[it.kind]++; if (it.kind === 'new') { const f = BP.feature(it.feature); c[f.status] = (c[f.status] || 0) + 1; } });
    return { total: items.length, c };
  });
  const MAX_ITEMS = Math.max.apply(null, REL_STATS.map((x) => x.total));
  function layoutRibbon() {
    if (!PLAN) return;
    requestAnimationFrame(renderRibbon);
  }
  function renderRibbon() {
    const narrow = shell.isPhone() || rib.clientWidth < 700;
    if (rib.classList.contains('is-narrow') !== narrow) rib.classList.toggle('is-narrow', narrow);
    const W = Math.round(ribAxis.clientWidth) - 8;
    const H = Math.round(ribAxis.clientHeight) - 8;
    if (W < 60 || H < 30) return;
    const phone = narrow;
    const d0 = dayNum(REL[0].date) - 24, d1 = dayNum(REL[REL.length - 1].date) + 24;
    const pad = 10;
    const xOf = (d) => pad + (W - 2 * pad) * (dayNum(d) - d0) / (d1 - d0);
    const base = H - 19;
    const top = 13;
    const barMax = base - top - 3;
    let h = '';
    // year bands and month ticks
    const y0 = new Date(REL[0].date + 'T00:00:00Z');
    const yEnd = new Date(REL[REL.length - 1].date + 'T00:00:00Z');
    for (let y = y0.getUTCFullYear(), m = y0.getUTCMonth(); y < yEnd.getUTCFullYear() || (y === yEnd.getUTCFullYear() && m <= yEnd.getUTCMonth() + 1); m++) {
      if (m > 11) { m = 0; y++; }
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-01';
      const x = xOf(ds);
      if (x < pad || x > W - pad) continue;
      const isY = m === 0;
      h += '<line class="ap-ax-tick' + (isY ? ' is-year' : '') + '" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (base - (isY ? 7 : 3)) + '" y2="' + (base + (isY ? 4 : 0)) + '"/>';
      const todayX = xOf(BP.asOf);
      if (isY && (x + 30 < todayX - 4 || x > todayX + 96)) h += '<text class="ap-ax-year" x="' + (x + 4).toFixed(1) + '" y="' + (top - 3) + '">' + y + '</text>';
    }
    h += '<line class="ap-ax-base" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + base + '" y2="' + base + '"/>';
    // today
    const tx = xOf(BP.asOf);
    h += '<line class="ap-ax-today" x1="' + tx.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y1="' + (top - 1) + '" y2="' + (base + 5) + '"/>' +
      '<text class="ap-ax-todayt" x="' + (tx + 4).toFixed(1) + '" y="' + (top - 3) + '">Today · ' + esc(OK.fmt.dateShort(BP.asOf)) + '</text>';
    // label culling: selected first, then ends, next, then the rest by order
    const bw = phone ? 7 : 12;
    const xs = REL.map((r) => xOf(r.date));
    const pri = REL.map((r, i) => i).sort((a, b) => score(b) - score(a));
    function score(i) { return (i === S.rel ? 100 : 0) + (i === 0 || i === REL.length - 1 ? 40 : 0) + (REL[i].state === 'next' ? 30 : 0) + (i % 2 === 0 ? 5 : 0) - i * 0.01; }
    const placed = [];
    const showLabel = new Array(REL.length).fill(false);
    pri.forEach((i) => {
      const lw = (REL[i].id.length + 1) * 6.4 + 4;
      const a = xs[i] - lw / 2, b2 = xs[i] + lw / 2;
      if (placed.some(([p, q]) => !(b2 < p - 3 || a > q + 3))) return;
      placed.push([a, b2]); showLabel[i] = true;
    });
    REL.forEach((r, i) => {
      const st = REL_STATS[i];
      const x = xs[i];
      const bh = Math.max(4, barMax * st.total / MAX_ITEMS);
      const sel = i === S.rel;
      const segs = r.state === 'shipped'
        ? [['new', st.c.new, 'ap-sg-new'], ['improved', st.c.improved, 'ap-sg-imp'], ['fixed', st.c.fixed, 'ap-sg-fix']]
        : [['ready', st.c.ready, 'ap-sg-ready'], ['building', st.c.building, 'ap-sg-build'], ['blocked', st.c.blocked, 'ap-sg-block'], ['planned', st.c.planned, 'ap-sg-plan'], ['improved', st.c.improved + st.c.fixed, 'ap-sg-imp']];
      let yy = base;
      let segH = '';
      segs.forEach(([, n, cls]) => {
        if (!n) return;
        const hh = bh * n / st.total;
        yy -= hh;
        segH += '<rect class="' + cls + '" x="' + (x - bw / 2).toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + bw + '" height="' + Math.max(0.5, hh - 0.6).toFixed(1) + '"/>';
      });
      const label = 'v' + r.id;
      const desc = r.label + ', ' + OK.fmt.date(r.date) + ', ' + (r.state === 'shipped' ? 'shipped' : r.state === 'next' ? 'next release' : 'future') + ', ' + st.total + ' items';
      const hw = Math.max(16, (W - 2 * pad) / REL.length);
      h += '<g class="ap-rel is-' + r.state + (sel ? ' is-sel' : '') + '" data-rel="' + esc(r.id) + '" role="listitem" tabindex="0" aria-label="' + esc(desc) + '" aria-current="' + (sel ? 'true' : 'false') + '">' +
        '<rect class="ap-rel__hit" x="' + (x - hw / 2).toFixed(1) + '" y="0" width="' + hw.toFixed(1) + '" height="' + H + '"/>' +
        (sel ? '<rect class="ap-rel__sel" x="' + (x - Math.max(bw / 2 + 5, 15)).toFixed(1) + '" y="' + (base - bh - 5).toFixed(1) + '" width="' + Math.max(bw + 10, 30) + '" height="' + (bh + 5 + 19).toFixed(1) + '" rx="5"/>' : '') +
        '<rect class="ap-rel__frame" x="' + (x - bw / 2 - 0.5).toFixed(1) + '" y="' + (base - bh - 0.5).toFixed(1) + '" width="' + (bw + 1) + '" height="' + (bh + 0.5).toFixed(1) + '" rx="1.5"/>' + segH +
        (showLabel[i] ? '<text class="ap-rel__t" x="' + x.toFixed(1) + '" y="' + (base + 13) + '" text-anchor="middle">' + esc(r.id) + '</text>' : '') + '</g>';
    });
    ribSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    ribSvg.setAttribute('width', W);
    ribSvg.setAttribute('height', H);
    ribSvg.innerHTML = h;
    // head
    const r = REL[S.rel], st = REL_STATS[S.rel];
    rib.querySelector('.ap-rib__sel').textContent = r.label + ' · ' + OK.fmt.date(r.date);
    const meta = r.state === 'shipped'
      ? st.total + ' items · ' + st.c.new + ' new · ' + st.c.improved + ' improved · ' + st.c.fixed + ' fixed'
      : st.total + ' items · ' + st.c.ready + ' ready · ' + st.c.building + ' in build' + (st.c.blocked ? ' · ' + st.c.blocked + ' blocked' : '') + (st.c.planned ? ' · ' + st.c.planned + ' planned' : '') + (st.c.improved + st.c.fixed ? ' · ' + (st.c.improved + st.c.fixed) + ' changes' : '');
    rib.querySelector('.ap-rib__cap').textContent = 'Phasing · ' + (r.state === 'shipped' ? 'shipped' : r.state === 'next' ? 'next release' : 'future');
    rib.querySelector('.ap-rib__meta').textContent = meta;
  }
  function setRelease(i, opts) {
    i = clamp(i, 0, REL.length - 1);
    const changed = i !== S.rel;
    S.rel = i;
    refreshRelease();
    renderRibbon();
    if (changed) shell.announce(REL[i].label + ' selected');
    if (opts && opts.inspect) shell.inspect({ type: 'release', id: REL[i].id });
    else if (opts && opts.follow) { const sel = shell.state.selection; if (sel && sel.type === 'release' && shell.inspector.isOpen()) shell.inspect({ type: 'release', id: REL[i].id }); }
    invalidate(phaseV);
  }
  ribSvg.addEventListener('click', (e) => {
    const g = e.target.closest('[data-rel]');
    if (!g) return;
    stopPlay();
    setRelease(relIdx.get(g.getAttribute('data-rel')), { inspect: true });
  });
  ribSvg.addEventListener('keydown', (e) => {
    const g = e.target.closest && e.target.closest('[data-rel]');
    if (!g) return;
    const i = relIdx.get(g.getAttribute('data-rel'));
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stopPlay(); setRelease(i, { inspect: true }); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      const j = clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, REL.length - 1);
      setRelease(j, { follow: true });
      const n = ribSvg.querySelector('[data-rel="' + REL[j].id + '"]');
      if (n) n.focus();
    }
  });
  let playTimer = 0;
  const playBtn = rib.querySelector('.ap-play');
  function stopPlay() { if (!S.playing) return; S.playing = false; clearInterval(playTimer); playBtn.innerHTML = playIcon(false); playBtn.setAttribute('aria-label', 'Play through the releases'); playBtn.classList.remove('is-on'); }
  function startPlay() {
    S.playing = true;
    playBtn.innerHTML = playIcon(true); playBtn.setAttribute('aria-label', 'Pause'); playBtn.classList.add('is-on');
    if (S.rel >= REL.length - 1) setRelease(0, { follow: true });
    playTimer = setInterval(() => {
      if (S.rel >= REL.length - 1) { stopPlay(); return; }
      setRelease(S.rel + 1, { follow: true });
    }, 1300);
  }
  playBtn.addEventListener('click', () => { if (S.playing) stopPlay(); else startPlay(); });

  // ══ legend ═══════════════════════════════════════════════════════════════════════════════════
  function legendHTML(state) {
    const sv = (inner, w, h) => '<svg width="' + (w || 26) + '" height="' + (h || 18) + '" viewBox="0 0 ' + (w || 26) + ' ' + (h || 18) + '" aria-hidden="true">' + inner + '</svg>';
    const cell = (fill, stroke, dash, extra) => sv('<rect x="2" y="3" width="22" height="12" rx="2.5" fill="' + fill + '" stroke="' + stroke + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>' + (extra || ''));
    if (state && state.view === 'timeline') {
      return '<section class="ok-lg-sec"><h3>Phasing</h3>' +
        '<div class="ok-lg-row">' + cell('rgba(128,140,160,.18)', 'none') + '<span>Shipped in an earlier release: faint, older is fainter</span></div>' +
        '<div class="ok-lg-row">' + cell('var(--ok-good)', 'var(--ok-good)') + '<span><b>New in the selected release</b> (shipped in it, or planned for it): lit in its band colour for the current lens</span></div>' +
        '<div class="ok-lg-row">' + cell('var(--ok-paper-hi)', 'var(--ok-ink-2)') + '<span>Next release after it: outlined</span></div>' +
        '<div class="ok-lg-row">' + cell('none', 'var(--ok-ink-3)', '3 2') + '<span>Later releases: dashed</span></div>' +
        '<div class="ok-lg-row">' + cell('none', 'var(--ok-ink-3)', '1 2.5') + '<span>Unscheduled: dotted</span></div>' +
        '<div class="ok-lg-row">' + sv('<rect x="3" y="4" width="20" height="11" rx="2.5" fill="var(--ok-good)" opacity=".42"/><rect x="3.5" y="4.5" width="19" height="10" rx="2" fill="none" stroke="var(--ok-good)" stroke-width="2"/>') + '<span><b>Improved or fixed</b> in the selected release: half-lit with a heavy rim, and marked</span></div>' +
        '<p class="ok-lg-note">The plan never moves: only the tint changes. Click a release on the ribbon to select it and open its package; Play steps through every release.</p></section>' +
        '<section class="ok-lg-sec"><h3>Ribbon</h3><div class="ok-lg-row">' + sv('<rect x="9" y="2" width="8" height="14" fill="var(--ok-ink)"/><rect x="9" y="2" width="8" height="5" fill="var(--ok-ink-3)"/>') + '<span>Bar height: items in the package (shipped: new, improved, fixed)</span></div>' +
        '<div class="ok-lg-row">' + sv('<rect x="9" y="2" width="8" height="5" fill="var(--ok-ink-2)"/><rect x="9" y="7" width="8" height="5" fill="var(--ok-ink-3)"/><rect x="9" y="12" width="8" height="4" fill="var(--ok-alarm)"/>') + '<span>Next and future: ready, in build, blocked, planned</span></div>' +
        '<div class="ok-lg-row">' + sv('<line x1="13" x2="13" y1="1" y2="17" stroke="var(--ok-ink)" stroke-dasharray="2 2"/>') + '<span>Today (' + esc(OK.fmt.date(BP.asOf)) + ')</span></div></section>';
    }
    return '<section class="ok-lg-sec"><h3>The plan</h3>' +
      '<div class="ok-lg-row">' + sv('<rect x="1.5" y="1.5" width="23" height="15" rx="2" fill="none" stroke="var(--ok-ink-3)"/><rect x="4" y="5" width="9" height="9" rx="1.5" fill="var(--ok-paper-hi)" stroke="var(--ok-ink-3)"/><rect x="14.5" y="5" width="7.5" height="9" rx="1.5" fill="none" stroke="var(--ok-ink-4)"/>') + '<span>Areas are <b>wings</b>, domains <b>zones</b>, modules <b>rooms</b>, and each feature is a <b>fixture</b> in its room. Room size is feature count. Nothing ever moves.</span></div>' +
      '<p class="ok-lg-note">Zoom in like a map: domains first, then modules, features, names and detail. Wheel or pinch, drag to pan, double-click a zone to zoom into it.</p>' +
      '<div class="ok-lg-row">' + sv('<rect x="1.5" y="2.5" width="11" height="13" rx="2" fill="var(--ok-good-soft)" stroke="var(--ok-good)" stroke-width="1.2"/><rect x="14" y="2.5" width="10.5" height="13" rx="2" fill="var(--ok-fair-soft)" stroke="var(--ok-fair)" stroke-width="1.2"/>') + '<span>Until features appear, each <b>room</b> is tinted by its module\'s band in the current lens (hatched when it does not apply), so a lens switch repaints the plan</span></div></section>' +
      '<section class="ok-lg-sec"><h3>Zone plaque</h3>' +
      '<div class="ok-lg-row">' + OK.html.band('fair', 16) + '<span>Band and score of the domain in the current lens: the last thing a small plaque gives up</span></div>' +
      '<div class="ok-lg-row">' + sv('<rect x="1" y="7" width="12" height="4" fill="var(--ok-ink)"/><rect x="13" y="7" width="4" height="4" fill="var(--ok-ink-2)"/><rect x="17" y="7" width="5" height="4" fill="var(--ok-ink-3)"/><rect x="22" y="7" width="3" height="4" fill="var(--ok-alarm)"/>') + '<span>Status mix: live, ready, in build, planned, blocked</span></div>' +
      '<div class="ok-lg-row">' + sv('<rect x="1" y="7" width="11" height="4" fill="var(--ok-good)"/><rect x="12" y="7" width="7" height="4" fill="var(--ok-fair)"/><rect x="19" y="7" width="3" height="4" fill="var(--ok-poor)"/><rect x="22" y="7" width="3" height="4" fill="var(--ok-na)" opacity=".35"/>') + '<span>Gauge along the zone foot: how its features rate in the current lens</span></div>' +
      '<div class="ok-lg-row">' + sv('<rect x="1.5" y="1.5" width="23" height="8" rx="2" fill="var(--ok-paper-hi)" stroke="var(--ok-rule)"/><path d="M7 11.5v5M4.8 12.7l4.4 2.6M4.8 15.3l4.4-2.6M17 11.5v5M14.8 12.7l4.4 2.6M14.8 15.3l4.4-2.6" stroke="var(--ok-alarm)" stroke-width="1.1" stroke-linecap="round"/>') + '<span>Marks a plaque would cover ride just under it, in their own column, with a count when they share one</span></div></section>' +
      '<section class="ok-lg-sec"><h3>Fixtures</h3>' +
      '<div class="ok-lg-row">' + cell('var(--ok-good-soft)', 'var(--ok-good)', '', '<circle cx="8" cy="9" r="3" fill="var(--ok-ink)"/>') + '<span>Tint: the feature\'s band in the current lens; glyph: its status</span></div>' +
      '<div class="ok-lg-row">' + cell('none', 'var(--ok-na)', '2.5 2', '<path d="M4 15l8-12M10 15l8-12M16 15l7-10" stroke="var(--ok-na)" stroke-width=".8" opacity=".7"/>') + '<span>Hatched with a dashed edge: the lens does not apply (n/a)</span></div>' +
      '<div class="ok-lg-row">' + sv('<path d="M3 9 q2.5 -6 5 0 q2.5 -6 5 0 q2.5 -6 5 0 q2.5 -6 5 0 M3 9 q2.5 6 5 0 q2.5 6 5 0 q2.5 6 5 0 q2.5 6 5 0" fill="none" stroke="var(--ok-gate)" stroke-width="1.3"/>') + '<span>Gate halo: with Human gates on, the features waiting for a human</span></div>' +
      '<div class="ok-lg-row">' + sv('<circle cx="13" cy="9" r="6.5" fill="none" stroke="var(--ok-ink)" stroke-width="1.6"/><circle cx="13" cy="9" r="2.6" fill="var(--ok-ink)"/>') + '<span>Search hit (a pin while fixtures are hidden)</span></div>' +
      '<div class="ok-lg-row">' + sv('<path d="M2 14h9V5h13" fill="none" stroke="var(--ok-ink)" stroke-width="1.6"/><path d="M2 17h22" stroke="var(--ok-ink-2)" stroke-width="1.4" stroke-dasharray="4 3"/>') + '<span>Selected feature: solid to what it depends on, dashed from what uses it</span></div></section>';
  }

  // ══ wiring ═══════════════════════════════════════════════════════════════════════════════════
  readTokens();
  refreshAll();
  shell.on('lens', () => { refreshLens(); invalidate(); });
  shell.on('filter', () => { refreshFilter(); invalidate(); });
  shell.on('select', (ref) => {
    // a release picked anywhere in the kit (inspector, search, page) moves the ribbon; our own picks already did
    if (ref && ref.type === 'release' && ref.source !== 'variant' && relIdx.has(ref.id)) setRelease(relIdx.get(ref.id));
    scheduleLinks();
    invalidate();
  });
  shell.on('locate', (ref) => locate(ref));
  shell.on('theme', () => { readTokens(); renderRibbon(); invalidate(); });
  shell.on('view', (p) => {
    const to = p.view === 'timeline' ? phaseV : mapV, from = to === phaseV ? mapV : phaseV;
    // the plan stays in place: carry the camera across unless the source view is at its fit
    if (from.touched && PLAN) { to.cam = clampCam(to, Object.assign({}, from.cam)); to.touched = true; }
    else if (PLAN) fitView(to, false);
    if (p.view !== 'timeline') stopPlay();
    hideTip(from);
    shell.legend.refresh();
    if (p.view === 'timeline') requestAnimationFrame(renderRibbon);
    invalidate(to);
  });
  shell.on('inspector', (p) => {
    const open = p && p.open;
    measureFree();
    invalidate();
    requestAnimationFrame(() => {
      if (shell.state.view === 'timeline') renderRibbon();
      const sel = shell.state.selection;
      if (open && sel && sel.type === 'product') fitFree(activeView());
      else if (open && sel && sel.type !== 'release') ensureVisible(sel);
    });
  });
  shell.on('legend', () => { if (shell.state.view === 'timeline') requestAnimationFrame(renderRibbon); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { MCACHE.clear(); VIEWS.forEach((v) => v.fades.clear()); if (PLAN) PLAN.zones.forEach((z) => { z._pl = null; }); invalidate(); renderRibbon(); });
  window.addEventListener('resize', () => { if (shell.state.view === 'timeline') layoutRibbon(); });
  // test hooks for the screenshot scenarios: real pointer events at a node's position
  function screenOf(v, ref) {
    const r = nodeRect(ref);
    if (!r) return null;
    const G = PLAN.G;
    let wx = r.x + r.w / 2, wy = r.y + r.h / 2;
    if (ref.type === 'module') wy = r.y + G.RH / 2;
    if (ref.type === 'domain') wy = r.y + G.ZH / 2;
    if (ref.type === 'area') wy = r.y + G.WH / 2;
    return [(wx - v.cam.x) * v.cam.k, (wy - v.cam.y) * v.cam.k];
  }
  function tap(ref, double) {
    const v = activeView();
    const p = screenOf(v, ref);
    if (!p) return false;
    const rc = v.canvas.getBoundingClientRect();
    const fire = (type) => v.canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: rc.left + p[0], clientY: rc.top + p[1] }));
    fire('pointerdown'); fire('pointerup');
    if (double) { fire('pointerdown'); fire('pointerup'); }
    return true;
  }
  function showAt(ref, s) {
    const v = activeView();
    const r = nodeRect(ref);
    const k = (s || v.T.t3 * 1.15) / PLAN.G.CW;
    const W = v.w, H = v.h - v.bottom;
    v.touched = true; v.fly = null;
    v.cam = clampCam(v, { k, x: r.x + r.w / 2 - W / 2 / k, y: r.y + r.h / 2 - H / 2 / k });
    invalidate(v);
  }
  window.APlan = {
    tap, showAt, levels: () => activeView().T,
    drawMs: () => { const v = activeView(); const t0 = performance.now(); for (let j = 0; j < 5; j++) draw(v, performance.now()); return (performance.now() - t0) / 5; }, shell, views: VIEWS, plan: () => PLAN, state: S, hitTest, setRelease, fit: (v) => fitView(v || activeView(), false), zoomTo: (s) => { const v = activeView(); const k = s / PLAN.G.CW; const fw = v.w, fh = v.h - v.bottom; const c = v.cam; const wx = c.x + fw / 2 / c.k, wy = c.y + fh / 2 / c.k; v.touched = true; setCam(v, { k, x: wx - fw / 2 / k, y: wy - fh / 2 / k }); } };
})();
