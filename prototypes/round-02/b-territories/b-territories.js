/* Orbit Territories (round 2, variant B): a hex-cell territory map of the product, plus a time-lapse timeline.

   PLAN
   ────
   Layout (computed once per stage size class, then fixed; nothing ever moves on lens, filter, search or selection)
   - One hex cell per feature on a pointy-top axial grid (world unit: hex radius R = 1, column pitch √3, row pitch 1.5).
   - Continents (areas) grow together from one seed each, like a weighted Voronoi growth: the continent that is
     furthest behind its size takes its best frontier cell next (distance to its seed over a smooth lobed radius, plus
     a little hashed noise, so coasts get bays and capes). A cell may join a continent only when no other continent
     has land within SEA cells, so every pair of continents is separated by a sea channel of at least SEA cells, and
     facing coasts run parallel like plates that drifted apart. Seeds sit on an arrangement per size class (wide,
     square, tall) shaped to the stage aspect, so the landmass fills the opening view. A cell with five land
     neighbours joins at once, so there are no lakes.
   - Regions (domains) and modules: recursive bisection of a continent's cells. For a group of children (in display
     order) every split point, 12 cut directions and both sides are tried; cells are sorted by their projection on the
     cut normal and cut by count, and the most compact pair wins (perimeter / √cells, plus a large penalty when a
     part is disconnected). Exact sizes, contiguous, compact. Domains first, then modules inside each domain.
   - Features fill their module's cells in reading order (row by row, left to right), in display order.
   - Outlines: each region's hex boundary is chained into a loop, Chaikin-smoothed and inset a little: cells are
     clipped to it, so regions read as plates with coastline-like outlines and a hairline gap between neighbours.
     The continent coast is the same loop offset outwards, with two water lines. Modules are separated by fine
     borders (a wider gap along their hex edges).
   - Label anchors: regions and modules use their pole of inaccessibility (the deepest cell, near the centroid) and
     a few runner-up cells; modules also have a "top edge" anchor for their boundary label when names fill the
     cells; area titles sit in the sea beyond their continent's outer coast.

   Levels of detail (continuous zoom; k = hex radius on screen in px; thresholds grow with the opening fit kFit)
   - L0 (fit): the band mosaic in calm fills (every cell filled by its band in the current lens, hatched when n/a;
     the colour reaches full strength with the features layer, and on the hovered or selected node at any layer),
     coasts and region borders, a small alarm mark in the corner of every cell that needs attention; area titles
     in the sea; the 17 region labels on quiet plates (name, band glyph and score, attention and gate counts).
     Region labels stay inside their own region and drop the counts, then the score, before they would drop a name.
   - L1 (k ≥ t1 = max(20, 1.2·kFit)): module names as city labels (band glyph, name, counts); region names recede to
     faint tracked watermarks that stay inside the visible part of their region.
   - L2 (k ≥ t2): status glyphs in every cell (form = lifecycle), gate halos; feature names where they fit.
   - L3 (k ≥ t3): every feature name, the current-lens score, gate and attention marks; module names move to small
     tabs on their module's top edge, between rows of names.
   - L4 (k ≥ t4): a mini-detail per cell: the 8-lens corona (OK.svg.corona geometry), status, name, current-lens
     rating and headline, gates and release.
   - Layers cross-fade over a zoom band. Labels are placed greedily by priority (area > region > module > feature)
     against the boxes already placed, culled when they collide, and fade in and out (160 ms) instead of popping.
     Once past L0, a location readout shows area › region › module for the middle of the free view.

   Rendering: one Canvas 2D per view (sea graticule, land, cells, borders, marks, labels, links), drawn in screen
   space at device pixel ratio. Token colours are read with getComputedStyle and re-read on the kit's 'theme' event
   (which also covers data-theme set outside the shell). Lens and filter events only refresh per-cell arrays and
   schedule one frame: no DOM rebuild. The free part of the stage comes from shell.freeRectHint() (no layout read).
   The HUD (zoom controls, readout, tooltip) and the timeline ribbon are a few DOM elements.

   Timeline ("Time-lapse"): the same territory in its own canvas, as of a chosen release: shipped cells solid,
   cells that ship later as faint "unexplored" outlines, the chosen release's package glowing (new, improved and
   fixed marks), next and future targets as dashed outlines. A ribbon (releases placed by date, package bars, today
   marker, scrubber, play and pause) drives it, and clicking a release opens the kit's release inspector. */
(function () {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ══ hex math and deterministic noise ═══════════════════════════════════════════════════════════
  const SQ3 = Math.sqrt(3);
  // neighbour directions by screen angle 0°, 60°, … (y down): east, south-east, south-west, west, north-west, north-east
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  // corner i sits between neighbour directions i-1 and i … corner at angle 60·i − 30 (pointy top)
  const CORNER = [];
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 30); CORNER.push([Math.cos(a), Math.sin(a)]); }
  const hx = (q, r) => SQ3 * (q + r / 2);
  const hy = (q, r) => 1.5 * r;
  const KO = 2048;
  const key = (q, r) => (q + KO) * 8192 + (r + KO);
  const unkey = (k) => [Math.floor(k / 8192) - KO, (k % 8192) - KO];
  function hexRound(fq, fr) {
    const fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr);
    const s = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    return [q, r];
  }
  function pixelToHex(x, y) { return hexRound((SQ3 / 3) * x - y / 3, (2 / 3) * y); }
  function hash2(q, r, seed) {
    let h = Math.imul(q | 0, 374761393) ^ Math.imul(r | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // exact key of a hex corner (corners sit on multiples of √3/2 in x and 1/2 in y)
  const vkey = (x, y) => Math.round(x / (SQ3 / 2)) * 100003 + Math.round(y * 2);
  const ringOffsets = (d) => {
    const out = [];
    for (let dq = -d; dq <= d; dq++) for (let dr = Math.max(-d, -dq - d); dr <= Math.min(d, -dq + d); dr++) out.push([dq, dr]);
    return out;
  };

  // ══ continents: simultaneous growth with sea channels ══════════════════════════════════════════
  const SEA = 2; // water cells between two coasts, at least
  // Seed anchors in units of the landmass half-extents (x: a, y: b), per size class.
  const ARRANGE = {
    wide: { aspect: 2.2, anchors: { shopper: [-0.64, -0.36], commerce: [0.02, -0.42], fulfillment: [0.68, -0.4], merchant: [-0.36, 0.52], foundation: [0.36, 0.56] } },
    square: { aspect: 1.05, anchors: { shopper: [-0.5, -0.56], commerce: [0.48, -0.52], merchant: [-0.56, 0.3], fulfillment: [0.54, 0.24], foundation: [0, 0.78] } },
    tall: { aspect: 0.6, anchors: { shopper: [-0.32, -0.74], commerce: [0.36, -0.34], fulfillment: [-0.36, 0.06], merchant: [0.34, 0.42], foundation: [-0.18, 0.8] } },
  };
  function growLandmass(areas, sizeClass) {
    const cfg = ARRANGE[sizeClass];
    const total = areas.reduce((s, a) => s + a.n, 0);
    const foot = total * 2.598 * 1.16; // land plus channels, in world units²
    const A = Math.sqrt((foot / Math.PI) * cfg.aspect), B = A / cfg.aspect;
    const owner = new Map(); // cell key → continent index
    const near = new Map(); // cell key → bitmask of continents with land within SEA cells
    const rings = ringOffsets(SEA);
    const conts = areas.map((a, i) => {
      const an = cfg.anchors[a.id] || [0, 0];
      const sx = an[0] * A, sy = an[1] * B;
      const [q0, r0] = pixelToHex(sx, sy);
      const seed = i * 7 + 3;
      const ph = [hash2(seed, 1, 7) * 6.283, hash2(seed, 2, 7) * 6.283, hash2(seed, 3, 7) * 6.283];
      const amp = [0.09 + hash2(seed, 4, 7) * 0.06, 0.05 + hash2(seed, 5, 7) * 0.05, 0.025 + hash2(seed, 6, 7) * 0.025];
      const scale = Math.sqrt(a.n);
      return {
        id: a.id, i, n: a.n, q0, r0, sx: hx(q0, r0), sy: hy(q0, r0), seed, scale, cells: [], front: new Map(),
        rho: (t) => 1 + amp[0] * Math.sin(2 * t + ph[0]) + amp[1] * Math.sin(3 * t + ph[1]) + amp[2] * Math.sin(5 * t + ph[2]),
      };
    });
    const prio = (c, q, r) => {
      const x = hx(q, r) - c.sx, y = hy(q, r) - c.sy;
      return Math.hypot(x, y) / (c.scale * c.rho(Math.atan2(y, x))) + hash2(q, r, c.seed) * 0.16;
    };
    const ownN = (c, q, r) => { let n = 0; for (const d of DIRS) if (owner.get(key(q + d[0], r + d[1])) === c.i) n++; return n; };
    const add = (c, q, r) => {
      const k = key(q, r);
      owner.set(k, c.i);
      c.cells.push({ q, r });
      c.front.delete(k);
      for (const [dq, dr] of rings) { const kk = key(q + dq, r + dr); near.set(kk, (near.get(kk) || 0) | (1 << c.i)); }
      for (const d of DIRS) {
        const nq = q + d[0], nr = r + d[1], nk = key(nq, nr);
        if (!owner.has(nk) && !c.front.has(nk)) c.front.set(nk, { q: nq, r: nr, k: nk, p: prio(c, nq, nr) });
      }
    };
    conts.forEach((c) => add(c, c.q0, c.r0));
    let guard = 0;
    while (conts.some((c) => c.cells.length < c.n) && guard++ < 100000) {
      // the continent furthest behind its size grows next
      let c = null;
      conts.forEach((x) => { if (x.cells.length < x.n && (!c || x.cells.length / x.n < c.cells.length / c.n)) c = x; });
      let best = null, bestP = Infinity, loose = null, looseP = Infinity;
      c.front.forEach((f) => {
        if (owner.has(f.k)) return;
        const on = ownN(c, f.q, f.r);
        // compact coasts: cells held by more of the continent go first, single-cell stalks last
        const p = on >= 5 ? -1 : f.p - 0.05 * on + (on <= 1 ? 0.12 : 0);
        const ok = ((near.get(f.k) || 0) & ~(1 << c.i)) === 0;
        if (ok) { if (p < bestP || (p === bestP && f.k < best.k)) { bestP = p; best = f; } }
        else if (p < looseP) { looseP = p; loose = f; }
      });
      const pick = best || loose; // a blocked continent may still grow (never happens with these arrangements)
      add(c, pick.q, pick.r);
    }
    return conts;
  }

  // ══ partition by recursive bisection ═══════════════════════════════════════════════════════════
  function perimeterOf(set) {
    let p = 0;
    set.forEach((c) => { for (const d of DIRS) if (!set.has(key(c.q + d[0], c.r + d[1]))) p++; });
    return p;
  }
  function connected(cells, set) {
    if (!cells.length) return true;
    const seen = new Set([key(cells[0].q, cells[0].r)]);
    const stack = [cells[0]];
    while (stack.length) {
      const c = stack.pop();
      for (const d of DIRS) { const k = key(c.q + d[0], c.r + d[1]); if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(set.get(k)); } }
    }
    return seen.size === cells.length;
  }
  const toSet = (cells) => { const m = new Map(); cells.forEach((c) => m.set(key(c.q, c.r), c)); return m; };
  function partition(cells, items, out) {
    if (items.length === 1) { out.push({ id: items[0].id, cells }); return out; }
    let best = null;
    const total = items.reduce((s, x) => s + x.size, 0);
    const pts = cells.map((c) => ({ c, x: hx(c.q, c.r), y: hy(c.q, c.r) }));
    for (let s = 1; s < items.length; s++) {
      const sizeA = items.slice(0, s).reduce((t, x) => t + x.size, 0);
      const balance = Math.abs(sizeA / total - 0.5);
      for (let ai = 0; ai < 12; ai++) {
        const a = (Math.PI / 12) * ai;
        const ux = Math.cos(a), uy = Math.sin(a);
        for (const side of [1, -1]) {
          const sorted = pts.slice().sort((p1, p2) => {
            const d = side * ((p1.x - p2.x) * ux + (p1.y - p2.y) * uy);
            if (Math.abs(d) > 1e-6) return d;
            return ((p1.x - p2.x) * -uy + (p1.y - p2.y) * ux);
          });
          const A = sorted.slice(0, sizeA).map((p) => p.c), B = sorted.slice(sizeA).map((p) => p.c);
          const sa = toSet(A), sb = toSet(B);
          let score = perimeterOf(sa) / Math.sqrt(A.length) + perimeterOf(sb) / Math.sqrt(B.length) + balance * 0.6;
          if (!connected(A, sa)) score += 1000;
          if (!connected(B, sb)) score += 1000;
          if (!best || score < best.score - 1e-9) best = { score, A, B, s };
        }
      }
    }
    partition(best.A, items.slice(0, best.s), out);
    partition(best.B, items.slice(best.s), out);
    return out;
  }

  // depth of every cell (rings from the border) and the label anchors: the pole, then runner-ups
  function anchorsOf(cells) {
    const set = toSet(cells);
    const dist = new Map();
    let ring = [];
    cells.forEach((c) => { if (DIRS.some((d) => !set.has(key(c.q + d[0], c.r + d[1])))) { dist.set(key(c.q, c.r), 0); ring.push(c); } });
    let lvl = 0;
    while (ring.length) {
      const next = [];
      lvl++;
      ring.forEach((c) => DIRS.forEach((d) => { const k = key(c.q + d[0], c.r + d[1]); if (set.has(k) && !dist.has(k)) { dist.set(k, lvl); next.push(set.get(k)); } }));
      ring = next;
    }
    let cx = 0, cy = 0;
    cells.forEach((c) => { cx += hx(c.q, c.r); cy += hy(c.q, c.r); });
    cx /= cells.length; cy /= cells.length;
    const scored = cells.map((c) => {
      const d = dist.get(key(c.q, c.r)), e = Math.hypot(hx(c.q, c.r) - cx, hy(c.q, c.r) - cy);
      return { q: c.q, r: c.r, s: d * 1.2 - e * 0.35, e };
    });
    scored.sort((a, b) => b.s - a.s || a.e - b.e || a.r - b.r || a.q - b.q);
    return { list: scored.slice(0, 10).map((x) => ({ q: x.q, r: x.r })), all: scored, cx, cy };
  }

  // ══ loops: chain directed boundary edges into closed loops ═════════════════════════════════════
  function boundaryLoops(cells, inSet) {
    // for each cell and side i whose neighbour is outside, the edge runs from corner i-1… corner i (clockwise)
    const startAt = new Map();
    const edges = [];
    cells.forEach((c) => {
      const x = hx(c.q, c.r), y = hy(c.q, c.r);
      DIRS.forEach((d, i) => {
        if (inSet(c.q + d[0], c.r + d[1])) return;
        // side i faces direction 60·i°: it spans corners at 60·i − 30 and 60·i + 30 → CORNER[i] and CORNER[i+1]
        const a = CORNER[i], b = CORNER[(i + 1) % 6];
        const e = { x0: x + a[0], y0: y + a[1], x1: x + b[0], y1: y + b[1], used: false };
        edges.push(e);
        startAt.set(vkey(e.x0, e.y0), e);
      });
    });
    const loops = [];
    edges.forEach((e0) => {
      if (e0.used) return;
      const pts = [];
      let e = e0;
      while (e && !e.used) { e.used = true; pts.push([e.x0, e.y0]); e = startAt.get(vkey(e.x1, e.y1)); }
      if (pts.length > 2) loops.push(pts);
    });
    return loops;
  }
  function signedArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  /** Offsets a closed loop by d (positive = outwards for an outer loop of either orientation). */
  function offsetLoop(p, d) {
    const n = p.length, out = [];
    const dir = signedArea(p) > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      let n1x = b[1] - a[1], n1y = -(b[0] - a[0]); const l1 = Math.hypot(n1x, n1y) || 1; n1x /= l1; n1y /= l1;
      let n2x = c[1] - b[1], n2y = -(c[0] - b[0]); const l2 = Math.hypot(n2x, n2y) || 1; n2x /= l2; n2y /= l2;
      let mx = n1x + n2x, my = n1y + n2y; const lm = Math.hypot(mx, my) || 1; mx /= lm; my /= lm;
      const cos = Math.max(0.55, mx * n1x + my * n1y);
      out.push([b[0] + dir * mx * d / cos, b[1] + dir * my * d / cos]);
    }
    return out;
  }
  function chaikin(p, it) {
    let pts = p;
    for (let k = 0; k < it; k++) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      pts = out;
    }
    return pts;
  }
  // neighbour averaging: removes the per-cell scallops of a smoothed hex outline (it shrinks the loop a little)
  function relax(p, passes) {
    let pts = p;
    for (let k = 0; k < passes; k++) {
      const n = pts.length;
      pts = pts.map((b, i) => { const a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n]; return [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]; });
    }
    return pts;
  }
  const flat = (pts) => { const f = new Float64Array(pts.length * 2); pts.forEach((p, i) => { f[2 * i] = p[0]; f[2 * i + 1] = p[1]; }); return f; };

  // ══ the world for one size class ═══════════════════════════════════════════════════════════════
  const WORLD_CACHE = {};
  function buildWorld(BP, sizeClass) {
    if (WORLD_CACHE[sizeClass]) return WORLD_CACHE[sizeClass];
    const areas = BP.areas.map((a) => ({ id: a.id, n: BP.featuresOfArea(a.id).length }));
    const conts = growLandmass(areas, sizeClass);
    const cells = [];
    const byKey = new Map();
    const byFid = new Map();
    const areaIdx = new Map(BP.areas.map((a, i) => [a.id, i]));
    const domIdx = new Map(BP.domains.map((d, i) => [d.id, i]));
    const modIdx = new Map(BP.modules.map((m, i) => [m.id, i]));
    conts.forEach((c) => {
      const doms = BP.domainsOf(c.id).map((d) => ({ id: d.id, size: BP.featuresOfDomain(d.id).length }));
      partition(c.cells, doms, []).forEach((dp) => {
        const mods = BP.modulesOf(dp.id).map((m) => ({ id: m.id, size: BP.featuresOf(m.id).length }));
        partition(dp.cells, mods, []).forEach((mp) => {
          const fs = BP.featuresOf(mp.id);
          const ordered = mp.cells.slice().sort((a, b) => (a.r - b.r) || (hx(a.q, a.r) - hx(b.q, b.r)));
          ordered.forEach((h, j) => {
            const f = fs[j];
            const cell = { i: cells.length, q: h.q, r: h.r, x: hx(h.q, h.r), y: hy(h.q, h.r), f, fid: f.id, mod: mp.id, dom: dp.id, area: c.id, mi: modIdx.get(mp.id), di: domIdx.get(dp.id), ai: areaIdx.get(c.id) };
            cells.push(cell);
            byKey.set(key(h.q, h.r), cell);
            byFid.set(f.id, cell);
          });
        });
      });
    });
    const at = (q, r) => byKey.get(key(q, r));
    // neighbour table and the fine module borders (hex edges between two modules of one region), per region
    const modEdges = new Map();
    cells.forEach((c) => {
      c.nb = DIRS.map((d) => { const n = at(c.q + d[0], c.r + d[1]); return n ? n.i : -1; });
      DIRS.forEach((d, i) => {
        if (i > 2) return; // each shared edge once
        const n = at(c.q + d[0], c.r + d[1]);
        if (n && n.dom === c.dom && n.mod !== c.mod) {
          const a = CORNER[i], b = CORNER[(i + 1) % 6];
          if (!modEdges.has(c.dom)) modEdges.set(c.dom, []);
          modEdges.get(c.dom).push(c.x + a[0], c.y + a[1], c.x + b[0], c.y + b[1]);
        }
      });
    });
    modEdges.forEach((v, k) => modEdges.set(k, new Float64Array(v)));
    // nodes: cells, bounds, anchors, outlines
    const nodes = new Map();
    const nodeOf = (type, id) => { const k = type + ':' + id; if (!nodes.has(k)) nodes.set(k, { type, id, cells: [] }); return nodes.get(k); };
    cells.forEach((c) => { nodeOf('area', c.area).cells.push(c); nodeOf('domain', c.dom).cells.push(c); nodeOf('module', c.mod).cells.push(c); });
    nodes.forEach((n) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      n.cells.forEach((c) => { x0 = Math.min(x0, c.x - SQ3 / 2); x1 = Math.max(x1, c.x + SQ3 / 2); y0 = Math.min(y0, c.y - 1); y1 = Math.max(y1, c.y + 1); });
      n.bounds = [x0, y0, x1, y1];
      const an = anchorsOf(n.cells);
      n.anchors = an.list.map((p) => at(p.q, p.r));
      // region labels may sit on any of the deeper cells, best first (see placeLabels)
      if (n.type === 'domain') n.labelCells = an.all.slice(0, 48).map((p) => at(p.q, p.r));
      n.pole = n.anchors[0];
      n.centroid = { x: an.cx, y: an.cy };
      const prop = n.type === 'area' ? 'area' : n.type === 'domain' ? 'dom' : 'mod';
      const raw = boundaryLoops(n.cells, (q, r) => { const o = at(q, r); return !!o && o[prop] === n.id; });
      n.rawLoops = raw;
      if (n.type === 'domain') n.outline = raw.map((l) => flat(offsetLoop(chaikin(l, 2), -0.09)));
      if (n.type === 'area') {
        const sm = raw.map((l) => relax(chaikin(l, 2), 10));
        n.coast = sm.map((l) => flat(offsetLoop(l, 0.5)));
        n.ripple1 = sm.map((l) => flat(offsetLoop(l, 0.86)));
        n.ripple2 = sm.map((l) => flat(offsetLoop(l, 1.3)));
      }
      if (n.type === 'module') {
        // boundary label anchors: centred over the module's top row (or under its bottom row), between rows of names
        const edge = (rr, dy) => {
          const row = n.cells.filter((c) => c.r === rr);
          let xa = Infinity, xb = -Infinity; row.forEach((c) => { xa = Math.min(xa, c.x); xb = Math.max(xb, c.x); });
          return { x: (xa + xb) / 2, y: hy(0, rr) + dy, w: xb - xa + SQ3 };
        };
        let rTop = Infinity, rBot = -Infinity; n.cells.forEach((c) => { rTop = Math.min(rTop, c.r); rBot = Math.max(rBot, c.r); });
        n.edges = [edge(rTop, -0.75), edge(rBot, 0.75)];
      }
    });
    let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
    cells.forEach((c) => { X0 = Math.min(X0, c.x - SQ3 / 2); X1 = Math.max(X1, c.x + SQ3 / 2); Y0 = Math.min(Y0, c.y - 1); Y1 = Math.max(Y1, c.y + 1); });
    // area titles: in the sea beyond the outer coast (above for the upper continents, below for the lower ones)
    const cyAll = (Y0 + Y1) / 2;
    BP.areas.forEach((a) => {
      const n = nodes.get('area:' + a.id);
      const below = n.centroid.y > cyAll + 0.5;
      // the title runs along the coast row nearest the outside, centred on that row's land
      const edgeR = below ? Math.max(...n.cells.map((c) => c.r)) : Math.min(...n.cells.map((c) => c.r));
      const rowCells = n.cells.filter((c) => Math.abs(c.r - edgeR) <= 1);
      const xs = rowCells.map((c) => c.x);
      n.title = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: below ? n.bounds[3] + 1.0 : n.bounds[1] - 1.0, below };
    });
    const world = {
      sizeClass, cells, byKey, byFid, at, nodes, modEdges,
      bounds: [X0, Y0, X1, Y1], centre: [(X0 + X1) / 2, (Y0 + Y1) / 2],
    };
    WORLD_CACHE[sizeClass] = world;
    return world;
  }

  W.BTerr = { buildWorld, growLandmass, partition, hx, hy, DIRS, CORNER, SQ3, key, pixelToHex };
  if (typeof document === 'undefined' || !W.OK || !W.BP) return;

  // ══ app ════════════════════════════════════════════════════════════════════════════════════════
  const BP = W.BP, OK = W.OK;
  const esc = OK.esc;
  const FEATS = BP.features;
  const NF = FEATS.length;
  const FIDX = new Map(FEATS.map((f, i) => [f.id, i]));
  const BANDS = ['good', 'fair', 'poor', 'critical', 'na'];
  const BI = { good: 0, fair: 1, poor: 2, critical: 3, na: 4 };
  const RELS = BP.releasesInOrder();
  const RIDX = new Map(RELS.map((r, i) => [r.id, i]));
  const GK = { triage: 1, approval: 2, changes: 3 };
  const GK_ID = ['', 'triage', 'approval', 'changes'];
  const LEVELS = ['Areas and domains', 'Modules', 'Features', 'Names and ratings', 'Detail'];
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (u) => u * u * (3 - 2 * u);
  /** 0 below 0.84·t, 1 from t up, smooth in log-zoom between. */
  const ramp = (k, t) => smooth(clamp((Math.log(k) - Math.log(t * 0.84)) / (Math.log(t) - Math.log(t * 0.84)), 0, 1));
  const reduceMotion = () => !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  // ══ colour ═════════════════════════════════════════════════════════════════════════════════════
  function parseColor(s) {
    s = (s || '').trim();
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    return [128, 128, 128, 1];
  }
  const rgba = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? c[3] : +a.toFixed(3)) + ')';
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
  const over = (base, c) => mix(base, c, c[3]);
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  /** Opening (L0, L1) fill strength per band: calmer than the features layer, still graded by band. */
  const FILL_SOFT = { light: { good: 0.32, fair: 0.42, poor: 0.56, critical: 0.72 }, dark: { good: 0.42, fair: 0.5, poor: 0.6, critical: 0.74 } };
  /** The palette for the canvas, read from the kit tokens on the shell. */
  let P = null;
  function readPalette(el) {
    const cs = getComputedStyle(el);
    const g = (n) => cs.getPropertyValue('--ok-' + n).trim();
    const p = {};
    ['paper', 'paper-hi', 'sky-a', 'sky-b', 'ink', 'ink-2', 'ink-3', 'ink-4', 'on-ink', 'rule', 'rule-2', 'band-hi', 'shadow', 'glow',
      'good', 'fair', 'poor', 'critical', 'na', 'critical-soft', 'alarm', 'alarm-soft', 'gate', 'gate-soft', 'focus', 'panel-solid'].forEach((n) => { p[n] = parseColor(g(n)); });
    p.fLabel = g('f-label') || 'Jost, sans-serif';
    p.fMono = g('f-mono') || 'monospace';
    p.dark = lum(p.paper) < 0.2;
    p.land = p.dark ? mix(p['paper-hi'], p.ink, 0.055) : p['paper-hi'];
    p.sea = mix(p['sky-a'], p['sky-b'], 0.5);
    // Full strength (features layer and deeper, hover, selection) and the calmer opening fill (L0 and L1). Both grow
    // with the band, so healthy land stays quiet and critical land stands out, in either strength.
    const strength = p.dark ? { good: 0.46, fair: 0.54, poor: 0.64, critical: 0.78 } : { good: 0.5, fair: 0.58, poor: 0.68, critical: 0.82 };
    const soft = p.dark ? FILL_SOFT.dark : FILL_SOFT.light;
    p.fill = BANDS.map((b) => (b === 'na' ? mix(p.land, p.na, p.dark ? 0.14 : 0.1) : mix(p.land, p[b], strength[b])));
    p.fillSoft = BANDS.map((b, i) => (b === 'na' ? p.fill[i] : mix(p.land, p[b], soft[b])));
    // text on a fill: whichever of the two inks reads better
    const darkInk = p.dark ? p.paper : p.ink, lightInk = p.dark ? p.ink : p['paper-hi'];
    p.textOn = p.fill.map((f, i) => (i === 4 ? p['ink-2'] : contrast(f, darkInk) >= contrast(f, lightInk) ? darkInk : lightInk));
    p.textOnLand = p.ink;
    p.hatch = rgba(p.na, p.dark ? 0.6 : 0.5);
    p.plateShadow = p.dark ? 'rgba(0,0,0,0.35)' : rgba(p.ink, 0.1);
    p.cov = { 1: p.good, 2: p['ink-3'], 3: p['ink-4'], 4: p.alarm };
    p.key = Math.random();
    return p;
  }

  // ══ shared per-feature state (repainted in place on lens and filter events) ═══════════════════
  const M = {
    band: new Uint8Array(NF), score: new Float32Array(NF), dim: new Uint8Array(NF), hit: new Uint8Array(NF),
    attn: new Uint8Array(NF), gate: new Uint8Array(NF), gateN: new Uint8Array(NF), ini: new Uint8Array(NF),
    gatesOn: false, iniOn: false, filtering: false, lens: 'overall', stat: new Map(), version: 0,
  };
  FEATS.forEach((f, i) => {
    M.attn[i] = BP.needsAttention(f) ? 1 : 0;
    const gs = BP.gates(f);
    M.gateN[i] = gs.length;
    gs.forEach((g) => { M.gate[i] = Math.max(M.gate[i], GK[g.kind] || 0); });
  });
  const NODE_REFS = [].concat(BP.areas.map((a) => ({ type: 'area', id: a.id })), BP.domains.map((d) => ({ type: 'domain', id: d.id })), BP.modules.map((m) => ({ type: 'module', id: m.id })));
  function refreshLens(lens) {
    M.lens = lens;
    FEATS.forEach((f, i) => { const r = BP.rating(f, lens); M.band[i] = BI[r.band]; M.score[i] = r.band === 'na' ? NaN : r.score; });
    NODE_REFS.forEach((ref) => {
      const r = OK.nodeRating(ref, lens), ro = OK.nodeRollup(ref);
      const g = ro.gates || {};
      M.stat.set(ref.type + ':' + ref.id, { band: r.band, score: r.score, attn: ro.attention, gates: (g.triage || 0) + (g.approval || 0) + (g.changes || 0), n: ro.count });
    });
    M.version++;
  }
  function refreshFilter(shell) {
    const S = shell.state;
    const dimmed = shell.dimmedIds(), hits = shell.hitIds();
    M.filtering = shell.filterActive();
    M.gatesOn = !!S.gates;
    M.iniOn = !!S.initiative;
    const COV = { covered: 1, 'in-progress': 2, pending: 3, finding: 4 };
    FEATS.forEach((f, i) => {
      M.dim[i] = dimmed.has(f.id) ? 1 : 0;
      M.hit[i] = hits.has(f.id) ? 1 : 0;
      M.ini[i] = S.initiative ? COV[BP.initiativeState(f, S.initiative)] || 0 : 0;
    });
    M.version++;
  }

  // ══ time-lapse state (shared by the timeline view and its ribbon) ══════════════════════════════
  const NEXT_IDX = RELS.findIndex((r) => r.state === 'next');
  const TL = { idx: NEXT_IDX >= 0 ? NEXT_IDX : RELS.length - 1, kind: new Uint8Array(NF), st: new Uint8Array(NF), appear: new Float64Array(NF), relIdx: new Int16Array(NF), live: 0, pkg: null };
  const KIND = { new: 1, improved: 2, fixed: 3 };
  const FPATH = FEATS.map((f) => { const p = BP.pathOf(f); return ['module:' + p.module.id, 'domain:' + p.domain.id, 'area:' + p.area.id]; });
  const KIND_ID = ['', 'new', 'improved', 'fixed'];
  FEATS.forEach((f, i) => { TL.relIdx[i] = f.release != null && RIDX.has(f.release) ? RIDX.get(f.release) : -1; });
  // cell states as of a release: 0 shipped, 1 ships later (unexplored), 2 planned for next or future, 3 in this package but not shipped yet
  function computeTL(idx, animate) {
    const rel = RELS[idx];
    const prev = TL.st.slice();
    TL.idx = idx;
    TL.kind.fill(0);
    BP.releaseItems(rel.id).forEach((it) => { const i = FIDX.get(it.feature); if (i != null) TL.kind[i] = KIND[it.kind] || 0; });
    let live = 0;
    const now = performance.now();
    FEATS.forEach((f, i) => {
      let st;
      if (f.status === 'live') st = TL.relIdx[i] <= idx ? 0 : 1;
      else st = TL.kind[i] ? 3 : 2;
      if (st === 0) live++;
      if (animate && st === 0 && prev[i] !== 0) TL.appear[i] = now; else if (!animate) TL.appear[i] = 0;
      TL.st[i] = st;
    });
    TL.live = live;
    // per node: features live as of the release, and how many are in its package
    const stat = new Map();
    FEATS.forEach((f, i) => {
      FPATH[i].forEach((k) => {
        let s = stat.get(k);
        if (!s) { s = { live: 0, pkg: 0, kinds: [0, 0, 0, 0] }; stat.set(k, s); }
        if (TL.st[i] === 0) s.live++;
        if (TL.kind[i]) { s.pkg++; s.kinds[TL.kind[i]]++; }
      });
    });
    stat.forEach((s) => { s.pkgKind = s.kinds[1] >= s.kinds[2] && s.kinds[1] >= s.kinds[3] ? 'new' : s.kinds[2] >= s.kinds[3] ? 'improved' : 'fixed'; });
    TL.stat = stat;
    M.version++;
  }
  computeTL(TL.idx, false);

  // ══ canvas glyphs: the kit's shapes (OK.svg.*), drawn at screen positions ══════════════════════
  const swOf = (r) => clamp(r * 0.22, 1.1, 2.2);
  function disc(ctx, x, y, r, col) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = col; ctx.fill(); }
  function gStatus(ctx, status, x, y, r) {
    const w = swOf(r);
    ctx.setLineDash([]);
    if (status === 'live') { disc(ctx, x, y, r, rgba(P.ink)); return; }
    if (status === 'blocked') {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * 45 * DEG, rr = i % 2 ? r * 0.42 : r * 1.5; const px = x + rr * Math.sin(a), py = y - rr * Math.cos(a); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath();
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, r * 0.35); ctx.strokeStyle = rgba(P.land, 0.95); ctx.stroke(); ctx.lineJoin = 'miter';
      ctx.fillStyle = rgba(P.alarm); ctx.fill();
      return;
    }
    ctx.beginPath(); ctx.arc(x, y, r - w / 2, 0, 2 * Math.PI);
    ctx.fillStyle = rgba(P['paper-hi']); ctx.fill();
    ctx.lineWidth = w;
    if (status === 'planned') { ctx.setLineDash([r * 0.22, r * 0.36]); ctx.strokeStyle = rgba(P['ink-2']); ctx.stroke(); ctx.setLineDash([]); return; }
    ctx.strokeStyle = rgba(P.ink); ctx.stroke();
    if (status === 'ready') disc(ctx, x, y, r * 0.36, rgba(P.ink));
    else if (status === 'building') { ctx.beginPath(); ctx.moveTo(x, y - (r - w / 2)); ctx.arc(x, y, r - w / 2, -Math.PI / 2, Math.PI / 2, true); ctx.closePath(); ctx.fillStyle = rgba(P.ink); ctx.fill(); }
  }
  function gBand(ctx, band, x, y, r) {
    const w = swOf(r);
    ctx.setLineDash([]);
    if (band === 'good') { disc(ctx, x, y, r, rgba(P.good)); return; }
    if (band === 'fair' || band === 'poor') {
      ctx.beginPath(); ctx.arc(x, y, r - 0.5, 0, 2 * Math.PI); ctx.fillStyle = rgba(P['paper-hi']); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = rgba(P.rule); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * (band === 'fair' ? 0.75 : 0.5)); ctx.closePath(); ctx.fillStyle = rgba(P[band]); ctx.fill();
      return;
    }
    if (band === 'critical') {
      ctx.beginPath(); ctx.arc(x, y, r - w / 2, 0, 2 * Math.PI); ctx.fillStyle = rgba(P['paper-hi']); ctx.fill(); ctx.fillStyle = rgba(P['critical-soft']); ctx.fill();
      ctx.lineWidth = w; ctx.strokeStyle = rgba(P.critical); ctx.stroke();
      const k = r * 0.36;
      ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
      return;
    }
    ctx.beginPath(); ctx.arc(x, y, r - w / 2, 0, 2 * Math.PI); ctx.lineWidth = w; ctx.setLineDash([r * 0.42, r * 0.32]); ctx.strokeStyle = rgba(P.na); ctx.stroke(); ctx.setLineDash([]);
  }
  function gGate(ctx, kind, x, y, r, halo) {
    const w = swOf(r);
    const col = kind === 'changes' ? P.alarm : P.gate;
    if (halo) { ctx.beginPath(); ctx.arc(x, y, r + 1, 0, 2 * Math.PI); ctx.fillStyle = rgba(halo); ctx.fill(); }
    ctx.beginPath(); ctx.arc(x, y, r - w / 2, 0, 2 * Math.PI); ctx.lineWidth = w; ctx.strokeStyle = rgba(col);
    ctx.setLineDash(kind === 'triage' ? [r * 0.42, r * 0.3] : []); ctx.stroke(); ctx.setLineDash([]);
    disc(ctx, x, y, r * 0.34, rgba(col));
  }
  function gAttn(ctx, x, y, r, halo) {
    const lw = clamp(r * 0.26, 1.3, 2.4);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * 60 * DEG, s = Math.sin(a), c = Math.cos(a); ctx.moveTo(x + r * 0.18 * s, y - r * 0.18 * c); ctx.lineTo(x + r * 0.98 * s, y - r * 0.98 * c); }
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    if (halo) { ctx.lineWidth = lw + 2.6; ctx.strokeStyle = rgba(halo, 0.9); ctx.stroke(); }
    ctx.lineWidth = lw; ctx.strokeStyle = rgba(P.alarm); ctx.stroke();
    ctx.lineCap = 'butt';
  }
  function gKind(ctx, kind, x, y, r) {
    const s = r - 0.6, k = r * 0.46, isNew = kind === 'new';
    ctx.setLineDash([]);
    ctx.beginPath(); roundRect(ctx, x - s, y - s, 2 * s, 2 * s, r * 0.28);
    ctx.fillStyle = rgba(isNew ? P.ink : P['paper-hi']); ctx.fill(); ctx.lineWidth = 1.1; ctx.strokeStyle = rgba(isNew ? P.ink : P['ink-2']); ctx.stroke();
    ctx.beginPath();
    if (isNew) { ctx.moveTo(x - k, y); ctx.lineTo(x + k, y); ctx.moveTo(x, y - k); ctx.lineTo(x, y + k); }
    else if (kind === 'improved') { ctx.moveTo(x - k, y + k * 0.45); ctx.lineTo(x, y - k * 0.55); ctx.lineTo(x + k, y + k * 0.45); }
    else { ctx.moveTo(x - k, y + k * 0.05); ctx.lineTo(x - k * 0.2, y + k * 0.7); ctx.lineTo(x + k, y - k * 0.6); }
    ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = rgba(isNew ? P['paper-hi'] : P.ink); ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }
  /** OK.svg.corona geometry: 8 segments clockwise from the top in lens order, coloured by band; a tick marks the lens. */
  function gCorona(ctx, f, x, y, r, lens) {
    const w = clamp(r * 0.24, 1.8, 6), gap = 7;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.lineWidth = w; ctx.strokeStyle = rgba(P['rule-2']); ctx.stroke();
    BP.LENSES.forEach((l, i) => {
      const band = BP.rating(f, l.id).band;
      const a0 = (i * 45 + gap / 2 - 90) * DEG, a1 = ((i + 1) * 45 - gap / 2 - 90) * DEG;
      ctx.beginPath(); ctx.arc(x, y, r, a0, a1);
      ctx.lineWidth = band === 'na' ? w * 0.5 : w; ctx.strokeStyle = rgba(band === 'na' ? P['ink-4'] : P[band]); ctx.stroke();
      if (l.id === lens) {
        const am = (i * 45 + 22.5 - 90) * DEG, r0 = r + w * 0.9, r1 = r0 + Math.max(3, r * 0.28);
        ctx.beginPath(); ctx.moveTo(x + r0 * Math.cos(am), y + r0 * Math.sin(am)); ctx.lineTo(x + r1 * Math.cos(am), y + r1 * Math.sin(am));
        ctx.lineWidth = Math.max(1.2, w * 0.45); ctx.lineCap = 'round'; ctx.strokeStyle = rgba(P.ink); ctx.stroke(); ctx.lineCap = 'butt';
      }
    });
  }
  function hexPath(ctx, x, y, r) {
    ctx.moveTo(x + CORNER[0][0] * r, y + CORNER[0][1] * r);
    for (let i = 1; i < 6; i++) ctx.lineTo(x + CORNER[i][0] * r, y + CORNER[i][1] * r);
    ctx.closePath();
  }

  // ══ text ═══════════════════════════════════════════════════════════════════════════════════════
  const HAS_LS = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;
  const MEASURE = new Map();
  let measureCtx = null;
  function setFont(ctx, font, ls) { ctx.font = font; if (HAS_LS) ctx.letterSpacing = (ls || 0) + 'px'; }
  function tw(font, ls, text) {
    const kx = font + '|' + ls + '|' + text;
    let v = MEASURE.get(kx);
    if (v == null) {
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      setFont(measureCtx, font, ls);
      v = measureCtx.measureText(text).width - (HAS_LS ? ls || 0 : 0);
      if (MEASURE.size > 20000) MEASURE.clear();
      MEASURE.set(kx, v);
    }
    return v;
  }
  /** Greedy word wrap into at most maxLines lines; the last line gets an ellipsis when the text does not fit. */
  const WRAP = new Map();
  function wrap(font, ls, text, maxW, maxLines) {
    const kx = font + '|' + ls + '|' + Math.round(maxW / 3) + '|' + maxLines + '|' + text;
    let v = WRAP.get(kx);
    if (v) return v;
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    let cut = false;
    for (let i = 0; i < words.length; i++) {
      const t = cur ? cur + ' ' + words[i] : words[i];
      if (tw(font, ls, t) <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = words[i]; if (lines.length === maxLines) { cut = true; cur = ''; break; } }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; cut = true; }
    // a single word wider than the line, or leftover words: ellipsis on the last line
    const last = lines.length - 1;
    if (cut || tw(font, ls, lines[last]) > maxW) {
      let s = lines[last] + (cut ? '' : '');
      while (s.length > 1 && tw(font, ls, s + '…') > maxW) s = s.slice(0, -1).trimEnd();
      lines[last] = s + '…';
      cut = true;
    }
    let w = 0;
    lines.forEach((l) => { w = Math.max(w, tw(font, ls, l)); });
    v = { lines, w, cut };
    if (WRAP.size > 20000) WRAP.clear();
    WRAP.set(kx, v);
    return v;
  }
  function fillT(ctx, text, x, y, font, ls, col, halo, haloW) {
    setFont(ctx, font, ls);
    if (halo) { ctx.lineWidth = haloW || 3.5; ctx.lineJoin = 'round'; ctx.strokeStyle = halo; ctx.strokeText(text, x, y); ctx.lineJoin = 'miter'; }
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
  }
  const fontL = (w, px) => w + ' ' + px + 'px ' + P.fLabel;
  const fontM = (w, px) => w + ' ' + px + 'px ' + P.fMono;

  /** A one-line label run: parts are text and glyphs; measured once, drawn left to right, vertically centred. */
  function run(parts) {
    let w = 0;
    parts.forEach((p) => {
      if (p.t === 'text') p.w = tw(p.font, p.ls || 0, p.s);
      else if (p.t === 'gap') p.w = p.n;
      else p.w = p.r * 2;
      w += p.w;
    });
    return { parts, w };
  }
  function drawRun(ctx, rn, x, y, alpha, halo) {
    let cx = x;
    rn.parts.forEach((p) => {
      if (p.t === 'text') { ctx.globalAlpha = alpha * (p.a == null ? 1 : p.a); fillT(ctx, p.s, cx, y, p.font, p.ls || 0, p.col, halo, p.haloW); }
      else if (p.t !== 'gap') {
        ctx.globalAlpha = alpha;
        if (halo && p.t !== 'flare') { ctx.beginPath(); ctx.arc(cx + p.r, y, p.r + 1.6, 0, 2 * Math.PI); ctx.fillStyle = halo; ctx.fill(); }
        if (p.t === 'band') gBand(ctx, p.band, cx + p.r, y, p.r);
        else if (p.t === 'flare') gAttn(ctx, cx + p.r, y, p.r, halo ? parseColor(halo) : null);
        else if (p.t === 'gate') gGate(ctx, p.kind, cx + p.r, y, p.r);
        else if (p.t === 'kind') gKind(ctx, p.kind, cx + p.r, y, p.r);
        else if (p.t === 'status') gStatus(ctx, p.status, cx + p.r, y, p.r * 0.8);
      }
      cx += p.w;
    });
    ctx.globalAlpha = 1;
  }

  // ══ the territory view: one canvas, its camera, input, levels of detail and labels ═══════════════
  // mode 'map' shows the lens; mode 'timeline' shows the product as of TL.idx.
  function sizeClassOf(w, h) { const a = w / h; return a >= 1.3 ? 'wide' : a < 0.75 ? 'tall' : 'square'; }

  function createView(shell, host, mode) {
    const S = shell.state;
    const isTL = mode === 'timeline';
    const view = document.createElement('div');
    view.className = 'bt-view';
    host.appendChild(view);
    const cv = document.createElement('canvas');
    cv.className = 'bt-cv';
    cv.tabIndex = 0;
    cv.setAttribute('role', 'application');
    cv.setAttribute('aria-roledescription', isTL ? 'time-lapse map' : 'territory map');
    cv.setAttribute('aria-label', (isTL ? 'Time-lapse of the product territory. ' : 'Territory map: each hex cell is a feature, clusters are modules, outlined regions are domains, continents are areas. ') +
      'Drag to pan, scroll or pinch to zoom, plus and minus keys zoom, 0 fits. Arrow keys move between features, Enter opens the selected feature.');
    view.appendChild(cv);
    const ctx = cv.getContext('2d');
    const loc = document.createElement('div');
    loc.className = 'bt-loc';
    loc.setAttribute('role', 'navigation');
    loc.setAttribute('aria-label', 'Location on the map');
    // a breadcrumb: the reticle opens the product overview, each place name its inspector. (Handled here rather than
    // with the kit's data-ok-inspect markup, which switches to the map view: the time-lapse has this readout too.)
    loc.innerHTML = '<button type="button" class="bt-loc__mark" data-bt-inspect="product" aria-label="' + esc(BP.product.name) + ': the whole product" title="' + esc(BP.product.name) + ': the whole product"><svg width="13" height="13" viewBox="-7 -7 14 14" aria-hidden="true"><circle r="5.6" fill="none" stroke="currentColor" stroke-width="1.1"/><circle r="1.8" fill="currentColor"/><path d="M0-7v2.4M0 4.6V7M-7 0h2.4M4.6 0H7" stroke="currentColor" stroke-width="1.1"/></svg></button><span class="bt-loc__path"></span><span class="bt-loc__lvl" aria-hidden="true"></span>';
    view.appendChild(loc);
    const locPath = loc.querySelector('.bt-loc__path'), locLvl = loc.querySelector('.bt-loc__lvl');
    const zoom = document.createElement('div');
    zoom.className = 'bt-zoom';
    zoom.setAttribute('role', 'group');
    zoom.setAttribute('aria-label', 'Zoom');
    const zi = (d) => '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' + d + '</svg>';
    zoom.innerHTML = '<button type="button" class="bt-zbtn" data-bt-z="in" aria-label="Zoom in" title="Zoom in (+)">' + zi('<path d="M2 7h10M7 2v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>') + '</button>' +
      '<div class="bt-ladder">' + [4, 3, 2, 1, 0].map((l) => '<button type="button" class="bt-rung" data-bt-lvl="' + l + '" aria-label="Zoom to ' + LEVELS[l].toLowerCase() + '"><i></i><span class="bt-rung__t">' + LEVELS[l] + '</span></button>').join('') + '</div>' +
      '<button type="button" class="bt-zbtn" data-bt-z="out" aria-label="Zoom out" title="Zoom out (−)">' + zi('<path d="M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>') + '</button><span class="bt-zsep" aria-hidden="true"></span>' +
      '<button type="button" class="bt-zbtn" data-bt-z="fit" aria-label="Fit the whole product" title="Fit the whole product (0)">' + zi('<path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/>') + '</button>';
    view.appendChild(zoom);
    const rungs = Array.from(zoom.querySelectorAll('.bt-rung'));
    const tip = document.createElement('div');
    tip.className = 'bt-tip';
    tip.hidden = true;
    view.appendChild(tip);

    let vw = 0, vh = 0, dpr = 1;
    let world = null;
    const cam = { x: 0, y: 0, k: 10 };
    let kFit = 10;
    const T = { t1: 20, t2: 34, t3: 62, t4: 150, kMin: 6, kMax: 320 };
    let atFit = true;
    let visible = !isTL;
    let flight = null;
    let lastNow = 0;
    let raf = 0;
    let hover = null;
    let pendingLocate = null;
    let flash = null;
    let links = [];
    let linkFor = null;
    let lastLevel = -1;
    let lastLoc = '', lastLocText = '';
    let hatch = null, hatchKey = null;
    const labState = new Map();
    const nameF = new Float32Array(NF);
    let placedLabels = [];
    let inspOpen = false;
    let animating = false;
    const drawMs = [];

    // ── camera ─────────────────────────────────────────────────────────────────────────────────
    const sx = (x) => (x - cam.x) * cam.k + vw / 2;
    const sy = (y) => (y - cam.y) * cam.k + vh / 2;
    const wx = (px) => (px - vw / 2) / cam.k + cam.x;
    const wy = (py) => (py - vh / 2) / cam.k + cam.y;
    const phone = () => vw < 560;
    const level = (k) => (k < T.t1 * 0.96 ? 0 : k < T.t2 * 0.96 ? 1 : k < T.t3 * 0.96 ? 2 : k < T.t4 * 0.96 ? 3 : 4);
    function fitBox() {
      const [X0, Y0, X1, Y1] = world.bounds;
      return [X0 - 0.4, Y0 - 2.4, X1 + 0.4, Y1 + 2.4];
    }
    function pads() {
      return phone() ? { l: 8, r: 8, t: 12, b: isTL ? 10 : 12 } : { l: 18, r: 60, t: 10, b: 14 };
    }
    function camFor(box, rect, pad, kCap) {
      const bw = box[2] - box[0], bh = box[3] - box[1];
      const k = clamp(Math.min((rect.w - pad.l - pad.r) / bw, (rect.h - pad.t - pad.b) / bh), T.kMin || 1, kCap || T.kMax);
      const cxs = rect.x + pad.l + (rect.w - pad.l - pad.r) / 2, cys = rect.y + pad.t + (rect.h - pad.t - pad.b) / 2;
      return { x: (box[0] + box[2]) / 2 - (cxs - vw / 2) / k, y: (box[1] + box[3]) / 2 - (cys - vh / 2) / k, k };
    }
    function computeFit() {
      // the fit sets the zoom-out limit below, so it must not be clamped by the limit of the previous stage size
      // (after the stage shrinks, e.g. a phone turned upright, the old limit kept the map overzoomed and cut off)
      T.kMin = 0;
      const c = camFor(fitBox(), { x: 0, y: 0, w: vw, h: vh }, pads());
      kFit = c.k;
      T.t1 = Math.max(20, kFit * 1.22);
      T.t2 = Math.max(34, T.t1 * 1.3);
      T.t3 = Math.max(62, T.t2 * 1.65);
      T.t4 = Math.max(150, T.t3 * 2.1);
      T.kMin = kFit * 0.72;
      T.kMax = Math.max(T.t4 * 2, 320);
      return c;
    }
    function clampCam() {
      const [X0, Y0, X1, Y1] = world.bounds;
      cam.k = clamp(cam.k, T.kMin, T.kMax);
      cam.x = clamp(cam.x, X0, X1);
      cam.y = clamp(cam.y, Y0 - 1, Y1 + 1);
    }
    function setCam(c) { cam.x = c.x; cam.y = c.y; cam.k = c.k; clampCam(); }
    function fit(animate) {
      const c = computeFit();
      atFit = true;
      setHover(null); // a camera move the pointer did not make: the tooltip would describe another cell
      if (animate && !reduceMotion()) flyTo(c, 520, true); else { flight = null; setCam(c); }
      invalidate();
    }
    function flyTo(c, dur, keepFit) {
      if (!keepFit) atFit = false;
      setHover(null);
      if (reduceMotion()) { flight = null; setCam(c); invalidate(); return; }
      flight = { t0: 0, dur: dur || 620, from: { x: cam.x, y: cam.y, k: cam.k }, to: c };
      invalidate();
    }
    function zoomAt(px, py, factor) {
      const k1 = clamp(cam.k * factor, T.kMin, T.kMax);
      const x = wx(px), y = wy(py);
      cam.k = k1;
      cam.x = x - (px - vw / 2) / k1;
      cam.y = y - (py - vh / 2) / k1;
      clampCam();
      atFit = false;
      flight = null;
      invalidate();
    }
    function zoomBy(factor) {
      const fr = freeRectGuess();
      const px = fr.x + fr.w / 2, py = fr.y + fr.h / 2;
      const k1 = clamp(cam.k * factor, T.kMin, T.kMax);
      const x = wx(px), y = wy(py);
      flyTo({ x: x - (px - vw / 2) / k1, y: y - (py - vh / 2) / k1, k: k1 }, 300);
    }
    function zoomToLevel(l) {
      const target = [kFit, T.t1 * 1.08, T.t2 * 1.1, T.t3 * 1.12, T.t4 * 1.15][l];
      if (l === 0) { fit(true); return; }
      zoomBy(target / cam.k);
    }
    /** The part of this view not covered by the inspector: the kit's layout-free hint, clipped to the view. */
    let inspW = 0, legendW = 0;
    function freeRectGuess() {
      let r = null;
      try { r = shell.freeRectHint(); } catch (e) { r = null; }
      if (!r || !r.w || !r.h) return { x: 0, y: 0, w: vw, h: vh };
      return { x: 0, y: 0, w: Math.min(vw, r.w), h: Math.min(vh, Math.max(120, r.h)) };
    }
    /** Right edge of the zoom column, as the CSS places it (beside the inspector and the legend panel). */
    function zoomRight() {
      if (phone()) return 10;
      if (legendW) return inspOpen ? inspW + legendW + 36 : legendW + 26;
      return inspOpen ? inspW + 26 : 16;
    }

    // ── locate: fly to a node and keep it in the free part of the stage ─────────────────────────
    function nodeBox(ref) {
      if (ref.type === 'feature') { const c = world.byFid.get(ref.id); return c ? [c.x - 1, c.y - 1, c.x + 1, c.y + 1] : null; }
      const n = world.nodes.get(ref.type + ':' + ref.id);
      return n ? n.bounds : null;
    }
    function locate(ref, rect) {
      if (!ref || !world) return;
      if (!vw) { pendingLocate = ref; return; }
      if (ref.type === 'product') {
        // the whole product, in the part of the stage the inspector leaves free
        const fr0 = rect || freeRectGuess();
        if (fr0.w >= vw - 1 && fr0.h >= vh - 1) fit(true); else flyTo(camFor(fitBox(), fr0, pads()), 620);
        return;
      }
      const fr = rect || freeRectGuess();
      if (ref.type === 'feature') {
        const c = world.byFid.get(ref.id);
        if (!c) return;
        const k = clamp(Math.max(cam.k, T.t3 * 1.12), T.kMin, T.kMax);
        flyTo({ x: c.x - (fr.x + fr.w / 2 - vw / 2) / k, y: c.y - (fr.y + fr.h / 2 - vh / 2) / k, k });
        flash = { fid: ref.id, t0: 0 };
        return;
      }
      const b = nodeBox(ref);
      if (!b) return;
      const cap = ref.type === 'module' ? T.t3 * 1.15 : ref.type === 'domain' ? T.t2 * 1.25 : T.t1 * 1.35;
      // at least the layer that uncovers the node's children, even if the node then overflows a small free area
      const floor = ref.type === 'module' ? T.t2 * 1.1 : ref.type === 'domain' ? T.t1 * 1.08 : kFit;
      const p = phone() ? 14 : 36;
      const c = camFor([b[0] - 0.5, b[1] - 0.5, b[2] + 0.5, b[3] + 0.5], fr, { l: p, r: p, t: p + (phone() ? 30 : 0), b: p }, cap);
      if (c.k < floor) {
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        c.k = floor;
        c.x = cx - (fr.x + fr.w / 2 - vw / 2) / floor;
        c.y = cy - (fr.y + fr.h / 2 - vh / 2) / floor;
      }
      flyTo(c);
    }
    function locateMeasured(ref) {
      // the inspector may have just opened: fly in the next frame, with the kit's layout-free free-rect hint
      requestAnimationFrame(() => {
        if (!vw) { pendingLocate = ref; return; }
        locate(ref);
      });
    }
    function ensureVisible(c) {
      const fr = freeRectGuess();
      const x = sx(c.x), y = sy(c.y), m = Math.min(80, cam.k * 1.4);
      if (x < fr.x + m || x > fr.x + fr.w - m || y < fr.y + m || y > fr.y + fr.h - m) {
        flyTo({ x: c.x - (fr.x + fr.w / 2 - vw / 2) / cam.k, y: c.y - (fr.y + fr.h / 2 - vh / 2) / cam.k, k: cam.k }, 360);
      }
    }

    // ── sizing ─────────────────────────────────────────────────────────────────────────────────
    function resize(w, h) {
      if (!w || !h) return;
      const first = !world;
      const prevW = vw, prevH = vh;
      vw = w; vh = h;
      dpr = Math.min(2, W.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const cls = sizeClassOf(w, h);
      if (!world || world.sizeClass !== cls) {
        world = buildWorld(BP, cls);
        labState.clear();
        linkFor = null;
        atFit = true;
      }
      const c = computeFit();
      if (atFit || first) setCam(c);
      else if (prevW && prevH) clampCam();
      if (pendingLocate) { const r = pendingLocate; pendingLocate = null; locate(r); }
      invalidate();
    }
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      resize(Math.round(r.width), Math.round(r.height));
    });
    ro.observe(view);

    // ── frame loop ─────────────────────────────────────────────────────────────────────────────
    function invalidate() { if (!raf && visible) raf = requestAnimationFrame(frame); }
    function frame(now) {
      raf = 0;
      if (!visible || !vw || !world || !P) return;
      let busy = false;
      const t0 = performance.now();
      try { busy = draw(now); } catch (e) { console.error(e); }
      drawMs.push(performance.now() - t0);
      if (drawMs.length > 120) drawMs.shift();
      if (busy) invalidate();
    }

    // ── drawing ────────────────────────────────────────────────────────────────────────────────
    function loopPath(path, f) {
      path.moveTo(sx(f[0]), sy(f[1]));
      for (let i = 2; i < f.length; i += 2) path.lineTo(sx(f[i]), sy(f[i + 1]));
      path.closePath();
    }
    function ensureHatch() {
      const key = P.key + ':' + dpr;
      if (hatchKey === key) return;
      const s = Math.round(7 * dpr);
      const pc = document.createElement('canvas');
      pc.width = s; pc.height = s;
      const g = pc.getContext('2d');
      g.strokeStyle = P.hatch;
      g.lineWidth = Math.max(1, dpr * 0.9);
      g.beginPath();
      g.moveTo(-1, s + 1); g.lineTo(s + 1, -1);
      g.moveTo(-1, 1); g.lineTo(1, -1);
      g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1);
      g.stroke();
      hatch = ctx.createPattern(pc, 'repeat');
      hatchKey = key;
    }

    function drawSea(now) {
      const k = cam.k;
      const [cx0, cy0] = world.centre;
      const ox = sx(cx0), oy = sy(cy0);
      const far = Math.hypot(Math.max(ox, vw - ox), Math.max(oy, vh - oy));
      const step = 9 * k;
      ctx.save();
      ctx.lineWidth = 1;
      // concentric orbits, dotted
      ctx.strokeStyle = rgba(P.rule, P.dark ? 0.16 : 0.15);
      ctx.setLineDash([1.5, 5]);
      const i0 = Math.max(1, Math.floor((Math.hypot(ox - vw / 2, oy - vh / 2) - Math.hypot(vw, vh)) / step));
      for (let i = i0; i * step < far && i < i0 + 80; i++) { ctx.beginPath(); ctx.arc(ox, oy, i * step, 0, 2 * Math.PI); ctx.stroke(); }
      // every third orbit a fine solid line
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(P.rule, 0.09);
      for (let i = Math.max(3, i0 - (i0 % 3)); i * step < far && i < i0 + 80; i += 3) { ctx.beginPath(); ctx.arc(ox, oy, i * step, 0, 2 * Math.PI); ctx.stroke(); }
      // meridians every 15°
      ctx.strokeStyle = rgba(P.rule, 0.1);
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      for (let a = 0; a < 360; a += 15) { const t = a * DEG; ctx.moveTo(ox + Math.cos(t) * step * 0.5, oy + Math.sin(t) * step * 0.5); ctx.lineTo(ox + Math.cos(t) * far, oy + Math.sin(t) * far); }
      ctx.stroke();
      ctx.setLineDash([]);
      // a small bearing ring at the chart centre (it shows only in the sea between continents)
      ctx.strokeStyle = rgba(P['ink-3'], 0.35);
      ctx.beginPath(); ctx.arc(ox, oy, step * 0.5, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath();
      for (let a = 0; a < 360; a += 10) { const t = a * DEG, l = a % 90 === 0 ? 7 : 3; ctx.moveTo(ox + Math.cos(t) * step * 0.5, oy + Math.sin(t) * step * 0.5); ctx.lineTo(ox + Math.cos(t) * (step * 0.5 + l), oy + Math.sin(t) * (step * 0.5 + l)); }
      ctx.stroke();
      ctx.restore();
    }

    function drawLand() {
      const k = cam.k;
      ctx.save();
      BP.areas.forEach((a) => {
        const n = world.nodes.get('area:' + a.id);
        const r2 = new Path2D(), r1 = new Path2D();
        n.ripple2.forEach((l) => loopPath(r2, l));
        n.ripple1.forEach((l) => loopPath(r1, l));
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(P['ink-3'], P.dark ? 0.16 : 0.13);
        ctx.setLineDash([]);
        ctx.stroke(r2);
        ctx.strokeStyle = rgba(P['ink-3'], P.dark ? 0.28 : 0.22);
        ctx.stroke(r1);
      });
      BP.areas.forEach((a) => {
        const n = world.nodes.get('area:' + a.id);
        const cp = new Path2D();
        n.coast.forEach((l) => loopPath(cp, l));
        if (P.dark) { ctx.shadowColor = rgba(P.glow, 0.5); ctx.shadowBlur = 14; }
        ctx.fillStyle = rgba(P.land);
        ctx.fill(cp);
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        ctx.lineWidth = clamp(k * 0.07, 1, 1.8);
        ctx.strokeStyle = rgba(P['ink-2'], P.dark ? 0.75 : 0.7);
        ctx.stroke(cp);
      });
      ctx.restore();
    }

    // cell style codes: the map uses band (0–4) and dim; the time-lapse uses its own states
    function plates(vis, L, now) {
      const k = cam.k;
      const A4 = L.A4;
      const gap = clamp(k * 0.055, 0.7, 2.6);
      const rr = k - gap / SQ3 * 1.0;
      const modW = clamp(k * 0.15, 1.6, 6);
      // calm at the opening layers, full strength from the features layer on; the hovered or selected node is always full
      const fills = P.fill.map((f, b) => { const c = L.A2 < 1 ? mix(P.fillSoft[b], f, L.A2) : f; return A4 > 0 ? mix(c, P.land, 0.58 * A4) : c; });
      const strongFills = P.fill.map((f) => (A4 > 0 ? mix(f, P.land, 0.58 * A4) : f));
      const lift = liftRefs();
      ensureHatch();
      const dimA = P.dark ? 0.24 : 0.2;
      if (hatch && hatch.setTransform) hatch.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, sx(0) % 7, sy(0) % 7]));
      BP.domains.forEach((d) => {
        const n = world.nodes.get('domain:' + d.id);
        const b = n.bounds;
        if (sx(b[2]) < -4 || sx(b[0]) > vw + 4 || sy(b[3]) < -4 || sy(b[1]) > vh + 4) return;
        const path = new Path2D();
        n.outline.forEach((l) => loopPath(path, l));
        // a raised plate: a hard offset shadow under the region
        ctx.save();
        ctx.translate(0, clamp(k * 0.07, 1, 3));
        ctx.fillStyle = P.plateShadow;
        ctx.fill(path);
        ctx.restore();
        ctx.save();
        ctx.clip(path);
        ctx.fillStyle = rgba(P.land);
        ctx.fill(path);
        const groups = new Map();
        const appearing = [];
        n.cells.forEach((c) => {
          const x = sx(c.x), y = sy(c.y);
          if (x < -k || x > vw + k || y < -k || y > vh + k) return;
          const i = FIDX.get(c.fid);
          let code;
          const strong = lift.n && (c.dom === lift.dom || c.mod === lift.mod || c.area === lift.area || c.fid === lift.fid) ? 100 : 0;
          if (!isTL) code = strong + M.band[i] * 2 + M.dim[i];
          else {
            // shipped cells are solid (calmer outside the chosen package); the rest are outlines, drawn with the marks
            if (TL.st[i] !== 0) return;
            if (TL.appear[i] && now - TL.appear[i] < 650) { appearing.push([x, y, i]); return; }
            code = strong + (TL.kind[i] ? 10 : 20) + M.band[i] * 2 + M.dim[i];
          }
          let p = groups.get(code);
          if (!p) { p = [new Path2D(), A4 > 0.01 ? new Path2D() : null]; groups.set(code, p); }
          hexPath(p[0], x, y, rr);
          if (p[1]) hexPath(p[1], x, y, rr - clamp(k * 0.035, 2, 6) / 2 - 0.5);
        });
        const paint = (p, band, alpha, inset, strong) => {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = rgba((strong ? strongFills : fills)[band]);
          ctx.fill(p);
          if (band === 4 && hatch) { ctx.fillStyle = hatch; ctx.fill(p); }
          if (A4 > 0.01 && band !== 4 && inset) { ctx.globalAlpha = alpha * A4; ctx.lineWidth = clamp(k * 0.035, 2, 6); ctx.strokeStyle = rgba(P[BANDS[band]]); ctx.stroke(inset); }
          ctx.globalAlpha = 1;
        };
        groups.forEach((p, code0) => {
          const strong = code0 >= 100;
          const code = code0 % 100;
          const dim = code % 2;
          const base = code < 10 ? 0 : code < 20 ? 10 : 20;
          paint(p[0], (code - base) >> 1, (dim ? dimA : 1) * (base === 20 && !strong ? 0.62 : 1), p[1], strong);
        });
        appearing.forEach(([x, y, i]) => {
          const p = new Path2D();
          hexPath(p, x, y, rr);
          paint(p, M.band[i], clamp((now - TL.appear[i]) / 650, 0, 1) * (M.dim[i] ? dimA : 1));
        });
        if (appearing.length) animating = true;
        appearing.length = 0;
        // fine module borders: a wider gap of land along the hex edges between two modules
        const me = world.modEdges.get(d.id);
        if (me) {
          const mp = new Path2D();
          for (let j = 0; j < me.length; j += 4) { mp.moveTo(sx(me[j]), sy(me[j + 1])); mp.lineTo(sx(me[j + 2]), sy(me[j + 3])); }
          ctx.lineCap = 'round';
          ctx.lineWidth = modW;
          ctx.strokeStyle = rgba(P.land);
          ctx.stroke(mp);
          if (k > T.t1 * 0.9) { ctx.lineWidth = 1; ctx.strokeStyle = rgba(P['ink-3'], 0.32 * clamp((k - T.t1 * 0.9) / (T.t1 * 0.4), 0, 1)); ctx.setLineDash([1.5, 3]); ctx.stroke(mp); ctx.setLineDash([]); }
          ctx.lineCap = 'butt';
        }
        ctx.restore();
        ctx.lineWidth = clamp(k * 0.085, 1.3, 2.6);
        ctx.strokeStyle = rgba(P.dark ? P['ink-2'] : P.ink, P.dark ? 0.8 : 0.78);
        ctx.stroke(path);
      });
    }

    /** The node under the pointer and the selected node: their cells keep the full band colour at every layer. */
    function liftRefs() {
      const o = { n: 0, dom: null, mod: null, area: null, fid: null };
      [hover, S.selection].forEach((r) => {
        if (!r) return;
        if (r.type === 'domain') o.dom = r.id; else if (r.type === 'module') o.mod = r.id; else if (r.type === 'area') o.area = r.id; else if (r.type === 'feature') o.fid = r.id; else return;
        o.n++;
      });
      return o;
    }
    function hexStroke(x, y, r, col, lw, dash, alpha) {
      ctx.beginPath(); hexPath(ctx, x, y, r);
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    /** Marks on every visible cell: overlays, glyphs, names, scores and the L4 detail. */
    function marks(vis, L, now, dt, labelBoxes) {
      const k = cam.k;
      const { A1, A2, A3, A4 } = L;
      const lens = S.lens;
      const nameFs = Math.round(clamp(k * 0.155, 10, 13.5) * 2) / 2;
      const nameFont = fontL(500, nameFs);
      const nameMaxW = k * 1.45;
      const shortRamp = ramp(k, T.t3 * 0.8);
      const glyR = clamp(k * 0.125, 4, 8.5);
      const badgeR = clamp(k * 0.115, 4.5, 8);
      const land = P.land;
      const ph = phone();
      // small cells (the phone's opening time-lapse): outlines become faint fills and package marks wait for L1
      const tiny = isTL && k < 10;
      const pkgA = tiny ? A1 : 1;
      vis.forEach((c) => {
        const i = FIDX.get(c.fid);
        const f = c.f;
        const x = sx(c.x), y = sy(c.y);
        const dim = M.dim[i];
        const da = dim ? 0.22 : 1;
        const st = isTL ? TL.st[i] : 0;
        const band = M.band[i];
        // time-lapse outlines for cells that are not shipped as of the chosen release
        if (isTL) {
          if (st === 1) {
            if (tiny) { ctx.beginPath(); hexPath(ctx, x, y, k * 0.8); ctx.fillStyle = rgba(P.ink, P.dark ? 0.045 : 0.03); ctx.globalAlpha = da; ctx.fill(); ctx.globalAlpha = 1; }
            else hexStroke(x, y, k * 0.86, rgba(P['ink-3']), 1, [1.2, 3.2], 0.55 * da);
          } else if (st === 2) {
            ctx.beginPath(); hexPath(ctx, x, y, k * 0.84); ctx.fillStyle = rgba(P.ink, (P.dark ? 0.07 : 0.045) * (tiny ? 1.7 : 1)); ctx.globalAlpha = da; ctx.fill(); ctx.globalAlpha = 1;
            if (!tiny) hexStroke(x, y, k * 0.84, rgba(P['ink-2']), clamp(k * 0.05, 1, 1.8), [clamp(k * 0.16, 2.5, 6), clamp(k * 0.12, 2, 5)], 0.8 * da);
          }
          else if (st === 3) { ctx.beginPath(); hexPath(ctx, x, y, k * 0.9); ctx.fillStyle = rgba(P.fill[band]); ctx.globalAlpha = 0.55 * da; ctx.fill(); ctx.globalAlpha = 1; }
          const kd = TL.kind[i];
          if (kd) {
            // the chosen package glows
            ctx.save();
            if (P.dark) { ctx.shadowColor = rgba(P.glow, 0.9); ctx.shadowBlur = tiny ? 5 : 10; }
            hexStroke(x, y, k * 0.93, rgba(land), tiny ? 2.2 : clamp(k * 0.2, 3, 8), null, 0.9 * da);
            hexStroke(x, y, k * 0.93, rgba(P.ink), tiny ? 1.15 : clamp(k * 0.1, 1.6, 4), null, da);
            ctx.restore();
          }
          if (TL.appear[i]) {
            const u = (now - TL.appear[i]) / 900;
            if (u < 1) { animating = true; ctx.beginPath(); ctx.arc(x, y, k * (0.8 + u * 1.3), 0, 2 * Math.PI); ctx.lineWidth = 2; ctx.strokeStyle = rgba(P.ink, (1 - u) * 0.6); ctx.stroke(); }
          }
        }
        // initiative coverage rings
        if (!isTL && M.iniOn && M.ini[i]) {
          const v = M.ini[i];
          hexStroke(x, y, k * 0.78, rgba(P.cov[v]), clamp(k * 0.075, 1.6, 3.4), v === 3 ? [3, 3] : null, da);
        }
        // search matches: a strong ink ring
        if (M.hit[i]) {
          hexStroke(x, y, k * 1.0, rgba(land), clamp(k * 0.14, 3.4, 6));
          hexStroke(x, y, k * 1.0, rgba(P.ink), clamp(k * 0.08, 2, 3.4));
        }
        // human gates: a magenta halo (dashed for triage, red for changes requested)
        const gk = M.gate[i];
        if (gk && !isTL) {
          const ga = (M.gatesOn ? 1 : A2 * (0.5 + 0.5 * A3)) * da;
          if (ga > 0.01) {
            const col = gk === 3 ? P.alarm : P.gate;
            if (M.gatesOn) hexStroke(x, y, k * 0.9, rgba(col), clamp(k * 0.26, 4, 10), null, 0.18 * da);
            hexStroke(x, y, k * 0.9, rgba(col), clamp(k * 0.08, 1.8, 3.2), gk === 1 ? [clamp(k * 0.14, 2.5, 6), clamp(k * 0.1, 2, 4)] : null, ga);
          }
        }
        // names (L3; short names a little earlier), held back where a module label sits
        let nameTarget = 0;
        const showName = A3 > 0 || shortRamp > 0;
        let wr = null;
        if (showName && A4 < 0.99) {
          wr = wrap(nameFont, 0, f.name, nameMaxW, 2);
          const layer = wr.cut ? A3 : Math.max(A3, shortRamp);
          nameTarget = layer;
          if (layer > 0 && labelBoxes.length) {
            const hw = wr.w / 2 + 2, hh = nameFs * 1.2;
            const bx0 = x - hw, bx1 = x + hw, by0 = y - hh * 0.6, by1 = y + hh * 1.4;
            for (const b of labelBoxes) if (bx0 < b.x1 && bx1 > b.x0 && by0 < b.y1 && by1 > b.y0) { nameTarget = 0; break; }
          }
        }
        const step = dt / 160;
        nameF[i] = nameTarget > nameF[i] ? Math.min(nameTarget, nameF[i] + step) : Math.max(nameTarget, nameF[i] - step);
        const nA = nameF[i] * (1 - A4);
        const textCol = isTL && st !== 0 ? rgba(P.ink) : rgba(P.textOn[band]);
        // status glyph: centred at L2, lifted above the name at L3, inside the corona at L4
        const gA = (isTL && st === 3 ? Math.max(A2, 0.9 * pkgA) : A2) * (1 - A4);
        if (gA > 0.01) {
          ctx.globalAlpha = gA * da;
          const gy = y - k * 0.5 * nameF[i];
          const r0 = isTL && st === 3 && A2 < 1 ? Math.max(glyR, k * 0.3) : glyR;
          gStatus(ctx, f.status, x, gy, r0);
          ctx.globalAlpha = 1;
        }
        if (nA > 0.01 && wr) {
          ctx.globalAlpha = nA * da;
          const lh = nameFs * 1.14;
          const y0 = y + (nameF[i] > 0 ? 0.04 * k : 0) - (wr.lines.length - 1) * lh / 2;
          ctx.textBaseline = 'middle';
          wr.lines.forEach((ln, j) => { const w = tw(nameFont, 0, ln); fillT(ctx, ln, x - w / 2, y0 + j * lh, nameFont, 0, textCol); });
          // the current-lens score
          if (A3 > 0.01 && !isTL) {
            const sc = M.score[i];
            const s = Number.isNaN(sc) ? 'n/a' : OK.fmt.score(sc);
            const sf = fontM(400, Math.max(9.5, nameFs - 1.5));
            ctx.globalAlpha = A3 * da * (1 - A4) * 0.88;
            const w = tw(sf, 0, s);
            fillT(ctx, s, x - w / 2, y + k * 0.5, sf, 0, textCol);
          }
          ctx.globalAlpha = 1;
        }
        // release package mark (time-lapse)
        // (top-left corner once glyphs show: the top-right corner belongs to the attention mark)
        if (isTL && TL.kind[i] && pkgA > 0.01) {
          const t = A2;
          const mx = lerp(x, x - k * 0.52, t), my = lerp(y, y - k * 0.34, t);
          const mr = lerp(clamp(k * 0.3, 4, 7), badgeR, t);
          ctx.globalAlpha = da * pkgA;
          if (st !== 3 || A2 > 0.5) gKind(ctx, KIND_ID[TL.kind[i]], mx, my, mr);
          ctx.globalAlpha = 1;
        }
        // gate badge at L3
        if (gk && !isTL && A3 > 0.01 && A4 < 0.99) {
          ctx.globalAlpha = A3 * da * (1 - A4);
          gGate(ctx, GK_ID[gk], x - k * 0.54, y - k * 0.34, badgeR, land);
          ctx.globalAlpha = 1;
        }
        // attention: always visible. A small alarm mark in the cell's corner at the opening layers (calm, haloed so it
        // reads on red land too), growing to the full corner badge with the features layer. The soft flare glow
        // returns only while the attention filter is on.
        if (M.attn[i] && (!isTL || st === 3)) {
          const fx = x + k * 0.54, fy = y - k * 0.35;
          const r0 = ph ? clamp(k * 0.27, 2.4, 3.4) : clamp(k * 0.2, 2.9, 4.2);
          const fr = lerp(r0, Math.max(r0, badgeR * 1.05), A2);
          const fa = da * (1 - A4);
          if (fa > 0.01) {
            if (S.attention) {
              const gR = fr * 2.3;
              const grd = ctx.createRadialGradient(fx, fy, 0, fx, fy, gR);
              grd.addColorStop(0, rgba(P.alarm, (P.dark ? 0.42 : 0.3) * fa));
              grd.addColorStop(1, rgba(P.alarm, 0));
              ctx.fillStyle = grd;
              ctx.beginPath(); ctx.arc(fx, fy, gR, 0, 2 * Math.PI); ctx.fill();
            }
            ctx.globalAlpha = fa;
            gAttn(ctx, fx, fy, fr, land);
            ctx.globalAlpha = 1;
          }
        }
        // L4: the on-canvas mini-detail
        if (A4 > 0.01) detail(c, f, i, x, y, A4 * da, lens);
      });
      ctx.textBaseline = 'alphabetic';
    }

    function detail(c, f, i, x, y, a, lens) {
      const k = cam.k;
      ctx.globalAlpha = a;
      const cr = k * 0.2;
      gCorona(ctx, f, x, y - k * 0.47, cr, lens);
      gStatus(ctx, f.status, x, y - k * 0.47, cr * 0.42);
      const fs = Math.round(clamp(k * 0.085, 12, 16) * 2) / 2;
      const nf = fontL(500, fs);
      const wr = wrap(nf, 0, f.name, k * 1.5, 2);
      ctx.textBaseline = 'middle';
      const lh = fs * 1.15;
      const ny = y - k * 0.1 - (wr.lines.length - 1) * lh / 2;
      wr.lines.forEach((ln, j) => { const w = tw(nf, 0, ln); fillT(ctx, ln, x - w / 2, ny + j * lh, nf, 0, rgba(P.ink)); });
      // rating in the current lens: glyph, score, headline
      const r = isTL ? null : BP.rating(f, lens);
      const sf = fontM(400, fs - 1), hf = fontL(400, Math.max(11, fs - 3));
      let yy = y + k * 0.2;
      if (r) {
        const s = r.band === 'na' ? 'n/a' : OK.fmt.score(r.score);
        const lab = OK.lens(lens).short;
        const lf = fontL(500, Math.max(9.5, fs - 4.5));
        const lw = tw(lf, 1.2, lab.toUpperCase()), sw = tw(sf, 0, s);
        const tot = lw + 8 + 14 + 5 + sw;
        let x0 = x - tot / 2;
        fillT(ctx, lab.toUpperCase(), x0, yy, lf, 1.2, rgba(P['ink-3']));
        x0 += lw + 8;
        gBand(ctx, r.band, x0 + 7, yy, 6);
        x0 += 19;
        fillT(ctx, s, x0, yy, sf, 0, rgba(P.ink));
        yy += fs * 1.15;
        const hw = wrap(hf, 0, r.headline || OK.bandLabel(r.band), k * 1.42, 2);
        hw.lines.forEach((ln, j) => { const w = tw(hf, 0, ln); fillT(ctx, ln, x - w / 2, yy + j * (fs * 1.02), hf, 0, rgba(P['ink-2'])); });
        yy += hw.lines.length * fs * 1.02 + 2;
      } else {
        const fr = BP.featureReleases(f);
        const t = fr.length ? fr.map((x2) => x2.release.label).join(' · ') : 'Not in a release yet';
        const hw = wrap(hf, 0, t, k * 1.3, 2);
        hw.lines.forEach((ln, j) => { const w = tw(hf, 0, ln); fillT(ctx, ln, x - w / 2, yy + j * (fs * 1.05), hf, 0, rgba(P['ink-2'])); });
        yy += hw.lines.length * fs * 1.05 + 2;
      }
      // gates and release
      const gs = BP.gates(f);
      const mf = fontM(400, Math.max(10, fs - 3.5));
      const rel = f.release ? (f.status === 'live' ? 'Shipped in v' + f.release : 'Targets v' + f.release) : 'Unscheduled';
      let line = rel;
      if (gs.length) line = gs.length + ' waiting · ' + rel;
      const lw2 = tw(mf, 0, line) + (gs.length ? 16 : 0);
      let x1 = x - lw2 / 2;
      if (gs.length) { gGate(ctx, gs[0].kind, x1 + 6, yy + fs * 0.35, 5.5); x1 += 16; }
      fillT(ctx, line, x1, yy + fs * 0.35, mf, 0, rgba(P['ink-3']));
      if (M.attn[i]) gAttn(ctx, x + k * 0.6, y - k * 0.47, 7, P.land);
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }

    // ── labels: specs per frame, placed greedily by priority, faded in and out ─────────────────
    function splitTwo(s) {
      const words = s.split(' ');
      if (words.length < 2) return [s];
      let best = null;
      for (let j = 1; j < words.length; j++) {
        const a = words.slice(0, j).join(' '), b = words.slice(j).join(' ');
        const d = Math.abs(a.length - b.length) + (words[j - 1] === '&' ? 4 : 0);
        if (!best || d < best.d) best = { d, l: [a, b] };
      }
      return best.l;
    }
    function statParts(type, id, r, fsM) {
      const parts = [];
      const mono = fontM(400, fsM);
      if (!isTL) {
        const s = M.stat.get(type + ':' + id);
        if (!s) return parts;
        parts.push({ t: 'band', band: s.band, r }, { t: 'gap', n: 4 }, { t: 'text', s: s.band === 'na' ? 'n/a' : OK.fmt.score(s.score), font: mono, col: rgba(P.ink) });
        if (s.attn) parts.push({ t: 'gap', n: 9 }, { t: 'flare', r: r * 1.05 }, { t: 'gap', n: 3 }, { t: 'text', s: String(s.attn), font: mono, col: rgba(P.alarm) });
        if (s.gates) parts.push({ t: 'gap', n: 9 }, { t: 'gate', kind: 'approval', r }, { t: 'gap', n: 3 }, { t: 'text', s: String(s.gates), font: mono, col: rgba(P.gate) });
      } else {
        const s = TL.stat.get(type + ':' + id);
        if (!s) return parts;
        parts.push({ t: 'status', status: 'live', r }, { t: 'gap', n: 4 }, { t: 'text', s: s.live + ' live', font: mono, col: rgba(P.ink) });
        if (s.pkg) parts.push({ t: 'gap', n: 9 }, { t: 'kind', kind: s.pkgKind, r: r * 0.95 }, { t: 'gap', n: 4 }, { t: 'text', s: String(s.pkg), font: mono, col: rgba(P.ink) });
      }
      return parts;
    }
    function hudBoxes() {
      const b = [];
      if (phone()) {
        b.push({ x0: vw - 56, y0: vh - 130, x1: vw, y1: vh });
        if (level(cam.k) > 0) b.push({ x0: 0, y0: 0, x1: Math.min(vw, 64 + lastLocText.length * 6.4), y1: 40 });
      } else {
        const fr = freeRectGuess();
        const zr = vw - zoomRight();
        b.push({ x0: zr - 50, y0: vh - (isTL ? 196 : 214), x1: zr + 4, y1: vh });
        // the legend panel (its height follows its content; treat it as full height)
        if (legendW) { const lx1 = vw - (inspOpen ? inspW + 22 : 12); b.push({ x0: lx1 - legendW - 4, y0: 0, x1: lx1, y1: vh }); }
        if (level(cam.k) > 0) b.push({ x0: 0, y0: vh - 50, x1: Math.min(fr.w - 70, 230 + lastLocText.length * 8.6), y1: vh });
      }
      return b;
    }
    function labelSpecs(L) {
      const { A1, A2, A3 } = L;
      const k = cam.k, ph = phone();
      const out = [];
      // area titles in the sea
      const aA = 1 - A1;
      if (aA > 0.01) {
        BP.areas.forEach((a) => {
          const n = world.nodes.get('area:' + a.id);
          const fs = ph ? 10 : Math.round(clamp(8.4 + k * 0.22, 12, 14) * 2) / 2;
          const sp2 = statParts('area', a.id, ph ? 4.5 : 5, ph ? 10 : fs - 1.5);
          const nameP = { t: 'text', s: a.name.toUpperCase(), font: fontL(500, fs), ls: fs * (ph ? 0.2 : 0.3), col: rgba(P.ink) };
          // variants: the state line, the score alone, the name alone; a title in open sea beats a fuller one on the coast
          const variants = (ph ? [sp2.slice(0, 3), null] : [sp2, sp2.slice(0, 3), null]).map((sp) => {
            const rn = run(sp ? [nameP, { t: 'gap', n: ph ? 8 : 12 }].concat(sp) : [nameP]);
            return { lines: [{ rn, h: fs * 1.5 }], w: rn.w, h: fs * 1.5 };
          });
          const off = 0.55 + (fs * 0.75 + 4) / k;
          const yA = n.bounds[1] - off, yB = n.bounds[3] + off, wq = (n.bounds[2] - n.bounds[0]) * 0.28;
          const ys = n.title.below ? [yB, yA] : [yA, yB];
          const xs = [n.title.x, n.title.x - wq, n.title.x + wq, n.title.x - wq * 1.6, n.title.x + wq * 1.6];
          const cands = [];
          ys.forEach((y) => xs.forEach((x) => cands.push({ x, y, t: 0 })));
          // then across the continent's own coast (the halo keeps it legible), and only then anywhere
          ys.forEach((y) => { const yy = y + (y === yA ? 1 : -1) * 1.9; xs.slice(0, 3).forEach((x) => cands.push({ x, y: yy, own: a.id, t: 1 })); });
          cands.push({ x: n.title.x, y: ys[0] + (ys[0] === yA ? 1 : -1) * 1.1, land: true, t: 2 }, { x: n.centroid.x, y: n.centroid.y, land: true, t: 2 }, { x: n.centroid.x, y: n.centroid.y - 3, land: true, t: 2 }, { x: n.centroid.x, y: n.centroid.y + 3, land: true, t: 2 });
          out.push({ id: 'a:' + a.id, ref: { type: 'area', id: a.id }, layer: aA, variants, candTiers: [0, 1, 2], halo: rgba(P.sea, 0.92), cands, avoidLand: true, clampX: true });
        });
      }
      // region labels: name and state at L0, faint watermarks after
      const rA = 1 - A1;
      const wA = A1 * (1 - A3);
      const doms = BP.domains.map((d) => world.nodes.get('domain:' + d.id)).sort((p, q) => q.cells.length - p.cells.length);
      if (rA > 0.01) {
        // On a quiet plate, sized with the map. Each label has variants, best first: the full state line, then the
        // score alone, then the name alone (each on one or two lines). placeLabels keeps a label inside its own
        // region and culls the state before it would cull the name.
        const nameOnly = isTL && ph; // the phone's time-lapse: names only, the counts live in the area titles
        const fs = nameOnly ? 9 : ph ? 10 : Math.round(clamp(8.6 + k * 0.25, 11.5, 15) * 2) / 2;
        const font = fontL(600, fs), ls = fs * (ph ? 0.07 : 0.1);
        const fsM = Math.max(9.5, fs - 1.5), gr = Math.round(fs * 0.36 * 2) / 2;
        doms.slice().sort((p, q) => p.cells.length - q.cells.length).forEach((n) => {
          const d = BP.domain(n.id);
          const name = d.name.toUpperCase();
          const two = splitTwo(name);
          const regionW = (n.bounds[2] - n.bounds[0]) * k;
          const shapes = two.length < 2 ? [[name]] : tw(font, ls, name) > regionW * 1.05 ? [two, [name]] : [[name], two];
          const full = nameOnly ? [] : statParts('domain', n.id, gr, fsM);
          const stats = full.length > 3 ? [full, full.slice(0, 3), null] : full.length ? [full, null] : [null];
          const variants = [];
          stats.forEach((sp) => shapes.forEach((shape) => {
            const runs = shape.map((s) => ({ rn: run([{ t: 'text', s, font, ls, col: rgba(P.ink) }]), h: fs * 1.16 }));
            if (sp) runs.push({ rn: run(sp), h: Math.max(fsM * 1.55, gr * 2 + 6) });
            variants.push({ lines: runs, w: Math.max(...runs.map((x) => x.rn.w)), h: runs.reduce((s2, x) => s2 + x.h, 0) });
          }));
          out.push({ id: 'd:' + n.id, ref: { type: 'domain', id: n.id }, layer: rA, variants, plate: nameOnly ? PLATE_XS : ph ? PLATE_PH : PLATE, region: n.id, margin: nameOnly ? 1 : ph ? 2 : 5, cands: n.labelCells.map((c) => ({ x: c.x, y: c.y })) });
        });
      }
      // modules: city labels at L1–L2, boundary tabs at L3+
      const mA = A1 * (1 - A3);
      const mods = BP.modules.map((m) => world.nodes.get('module:' + m.id)).sort((p, q) => q.cells.length - p.cells.length);
      if (mA > 0.01) {
        mods.forEach((n) => {
          const m = BP.module(n.id);
          const fs = ph ? 11 : 12;
          const r = ph ? 4 : 4.5;
          const s = isTL ? TL.stat.get('module:' + n.id) : M.stat.get('module:' + n.id);
          const parts = isTL ? [{ t: 'text', s: m.name, font: fontL(500, fs), col: rgba(P.ink) }] : [{ t: 'band', band: s.band, r }, { t: 'gap', n: 5 }, { t: 'text', s: m.name, font: fontL(500, fs), col: rgba(P.ink) }];
          const mono = fontM(400, fs - 1.5);
          if (!isTL && s.attn) parts.push({ t: 'gap', n: 7 }, { t: 'flare', r }, { t: 'gap', n: 2 }, { t: 'text', s: String(s.attn), font: mono, col: rgba(P.alarm) });
          if (!isTL && s.gates) parts.push({ t: 'gap', n: 7 }, { t: 'gate', kind: 'approval', r: r * 0.95 }, { t: 'gap', n: 2 }, { t: 'text', s: String(s.gates), font: mono, col: rgba(P.gate) });
          if (isTL && s && s.pkg) parts.push({ t: 'gap', n: 7 }, { t: 'kind', kind: s.pkgKind, r: r * 0.95 }, { t: 'gap', n: 3 }, { t: 'text', s: String(s.pkg), font: mono, col: rgba(P.ink) });
          const rn = run(parts);
          // city labels on a small quiet plate, so status glyphs and attention marks never show through the name
          out.push({ id: 'm:' + n.id, ref: { type: 'module', id: n.id }, layer: mA, lines: [{ rn, h: fs * 1.3 }], w: rn.w, h: fs * 1.3, plate: PLATE_MOD, margin: 2, cands: n.anchors.slice(0, 6).map((c) => ({ x: c.x, y: c.y })) });
        });
      }
      if (wA > 0.01) {
        doms.forEach((n) => {
          const d = BP.domain(n.id);
          const fs = Math.round(clamp(k * 0.5, 13, 26));
          const font = fontL(600, fs), ls = fs * 0.3;
          const name = d.name.toUpperCase();
          const w = tw(font, ls, name);
          const b = n.bounds;
          const bx0 = Math.max(sx(b[0]), 0), bx1 = Math.min(sx(b[2]), vw), by0 = Math.max(sy(b[1]), 0), by1 = Math.min(sy(b[3]), vh);
          if (bx1 - bx0 < 60 || by1 - by0 < 30) return;
          const cx = sx(n.centroid.x), cy = sy(n.centroid.y);
          const px = bx1 - bx0 > w + 8 ? clamp(cx, bx0 + w / 2 + 4, bx1 - w / 2 - 4) : (bx0 + bx1) / 2;
          const cands = [0, -1, 1, -2, 2, -3, 3].map((j) => ({ sx: px, sy: clamp(cy + j * fs * 1.7, by0 + fs, by1 - fs) }));
          const rn = run([{ t: 'text', s: name, font, ls, col: rgba(P.ink), a: P.dark ? 0.34 : 0.3 }]);
          // kept on its own region where it can be (it is faint, so it may still cross a border rather than vanish)
          out.push({ id: 'w:' + n.id, ref: { type: 'domain', id: n.id }, group: 'wm', layer: wA, lines: [{ rn, h: fs * 1.2 }], w, h: fs * 1.2, cands, passive: true, region: n.id, tiers: [7, 4, 0] });
        });
      }
      if (A3 > 0.01) {
        mods.forEach((n) => {
          const m = BP.module(n.id);
          const fs = 9.5;
          const rn = run([{ t: 'text', s: m.name.toUpperCase(), font: fontL(500, fs), ls: 1.3, col: rgba(P['ink-2']) }]);
          out.push({ id: 't:' + n.id, ref: { type: 'module', id: n.id }, kind: 'tab', layer: A3, lines: [{ rn, h: 17 }], w: rn.w + 14, h: 17, cands: n.edges.map((e) => ({ x: e.x, y: e.y })) });
        });
      }
      return out;
    }
    function landUnder(box, except) {
      const rx = cam.k * 0.8, ry = cam.k * 0.9;
      const cells = world.cells;
      for (let j = 0; j < cells.length; j++) {
        if (except && cells[j].area === except) continue;
        const x = sx(cells[j].x), y = sy(cells[j].y);
        if (x + rx > box.x0 && x - rx < box.x1 && y + ry > box.y0 && y - ry < box.y1) return true;
      }
      return false;
    }
    // a region label's home: keep area titles off it while they have other places to go
    function poleUnder(box) {
      for (const d of BP.domains) {
        const n = world.nodes.get('domain:' + d.id);
        const x = sx(n.pole.x), y = sy(n.pole.y);
        if (x > box.x0 - 30 && x < box.x1 + 30 && y > box.y0 - 14 && y < box.y1 + 14) return true;
      }
      return false;
    }
    const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    const PLATE = { x: 6, y: 3 }, PLATE_PH = { x: 4, y: 2 }, PLATE_XS = { x: 3, y: 1.5 }, PLATE_MOD = { x: 5, y: 2, quiet: true };
    /** How much of a screen box lies on a region's own cells: 9 samples (corners, edge middles, centre); 0 when the centre is outside. */
    function insideCount(box, domId) {
      const xs = [box.x0 + 2, (box.x0 + box.x1) / 2, box.x1 - 2], ys = [box.y0 + 2, (box.y0 + box.y1) / 2, box.y1 - 2];
      let n = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const [q, r] = pixelToHex(wx(xs[a]), wy(ys[b]));
        const c = world.at(q, r);
        const inside = !!c && c.dom === domId;
        if (a === 1 && b === 1 && !inside) return 0;
        if (inside) n++;
      }
      return n;
    }
    // region labels: first well inside their region (at most a corner out), then mostly inside, then centred on it
    const REGION_TIERS = [8, 6, 1];
    function placeLabels(specs, dt) {
      const placed = hudBoxes();
      const reserved = placed.length;
      const wm = [];
      const tabBoxes = [];
      const drawList = [];
      const hits = [];
      let fading = false;
      const seen = new Set();
      specs.forEach((sp) => {
        seen.add(sp.id);
        let st = labState.get(sp.id);
        if (!st) { st = { a: 0, ci: -1, vi: 0 }; labState.set(sp.id, st); }
        let ok = false;
        if (sp.layer >= 0.5) {
          const vars = sp.variants || [sp];
          const tiers = sp.tiers || (sp.region ? REGION_TIERS : sp.candTiers || [null]);
          const n = sp.cands.length;
          const list = sp.group === 'wm' ? wm : placed;
          const also = sp.group === 'wm' ? placed : null;
          const mg = sp.margin || 0;
          search:
          for (const tier of tiers) {
            for (let vi = 0; vi < vars.length; vi++) {
              const v = vars[vi];
              const W2 = v.w + (sp.plate ? 2 * sp.plate.x : 0), H2 = v.h + (sp.plate ? 2 * sp.plate.y : 0);
              // the previous place first (when it is still this variant), so labels hold still while the map moves
              const keep = !sp.avoidLand && st.a > 0.05 && st.ci >= 0 && st.ci < n && st.vi === vi;
              for (let j = keep ? -1 : 0; j < n; j++) {
                const ci = j < 0 ? st.ci : j;
                if (j >= 0 && keep && ci === st.ci) continue;
                const c = sp.cands[ci];
                if (sp.candTiers && (c.t || 0) !== tier) continue;
                let px = c.sx != null ? c.sx : sx(c.x);
                const py = c.sy != null ? c.sy : sy(c.y);
                if (sp.clampX) px = clamp(px, W2 / 2 + 14, vw - W2 / 2 - 14);
                const box = { x0: px - W2 / 2 - 3 - mg, y0: py - H2 / 2 - 1 - mg, x1: px + W2 / 2 + 3 + mg, y1: py + H2 / 2 + 1 + mg };
                if (box.x0 + mg < 2 || box.x1 - mg > vw - 2 || box.y0 + mg < 2 || box.y1 - mg > vh - 2) continue;
                let clash = false;
                for (let jj = 0; jj < list.length; jj++) if (overlap(box, list[jj])) { clash = true; break; }
                if (!clash && also) for (let jj = 0; jj < also.length; jj++) if (overlap(box, also[jj])) { clash = true; break; } // incl. the HUD
                if (clash) continue;
                if (sp.avoidLand && !c.land && (landUnder(box, c.own) || poleUnder(box))) continue;
                if (sp.region && tier && insideCount({ x0: px - W2 / 2, y0: py - H2 / 2, x1: px + W2 / 2, y1: py + H2 / 2 }, sp.region) < tier) continue;
                list.push(box);
                if (sp.kind === 'tab') tabBoxes.push(box);
                if (!sp.passive) hits.push({ box, ref: sp.ref });
                st.ci = ci; st.vi = vi; st.x = c.x + (sp.clampX ? (px - sx(c.x)) / cam.k : 0); st.y = c.y; st.sx = c.sx; st.sy = c.sy;
                ok = true;
                break search;
              }
            }
          }
        }
        const target = ok ? 1 : 0;
        const step = dt / 160;
        const prev = st.a;
        st.a = target > st.a ? Math.min(target, st.a + step) : Math.max(target, st.a - step);
        if (st.a !== target || prev !== st.a) fading = fading || st.a !== target;
        if (st.a > 0.01 && st.ci >= 0) drawList.push({ sp, st, alpha: st.a * Math.min(1, sp.layer * (ok ? 1 : 1.6)) });
        else if (st.a <= 0.01) st.ci = -1;
      });
      // labels whose layer is gone fade out where they were
      labState.forEach((st, id) => { if (!seen.has(id)) { st.a = 0; st.ci = -1; } });
      placedLabels = hits;
      return { drawList, placed: placed.slice(reserved), tabBoxes, fading };
    }
    function drawLabelList(list) {
      ctx.textBaseline = 'middle';
      list.forEach(({ sp, st, alpha }) => {
        const px = st.sx != null ? st.sx : sx(st.x), py = st.sy != null ? st.sy : sy(st.y);
        if (sp.kind === 'tab') {
          ctx.globalAlpha = alpha * 0.94;
          ctx.beginPath(); roundRect(ctx, px - sp.w / 2, py - sp.h / 2, sp.w, sp.h, sp.h / 2);
          ctx.fillStyle = rgba(P.land); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = rgba(P['ink-3'], 0.45); ctx.stroke();
          ctx.globalAlpha = 1;
          const rn = sp.lines[0].rn;
          drawRun(ctx, rn, px - rn.w / 2, py + 0.5, alpha, null);
          return;
        }
        const v = sp.variants ? sp.variants[Math.min(st.vi || 0, sp.variants.length - 1)] : sp;
        if (sp.plate) {
          // a quiet plate: land colour, a hairline edge and a hard 1px drop, like the region plates themselves
          const W2 = v.w + 2 * sp.plate.x, H2 = v.h + 2 * sp.plate.y, x0 = px - W2 / 2, y0 = py - H2 / 2;
          ctx.globalAlpha = alpha;
          const rad = sp.plate.quiet ? 4 : 5;
          if (!sp.plate.quiet) { ctx.beginPath(); roundRect(ctx, x0, y0 + 1, W2, H2, rad); ctx.fillStyle = P.plateShadow; ctx.fill(); }
          ctx.beginPath(); roundRect(ctx, x0, y0, W2, H2, rad); ctx.fillStyle = rgba(P.land, sp.plate.quiet ? 0.9 : 0.93); ctx.fill();
          ctx.lineWidth = 1; ctx.strokeStyle = rgba(P.ink, (P.dark ? 0.2 : 0.16) * (sp.plate.quiet ? 0.7 : 1)); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        let y = py - v.h / 2;
        v.lines.forEach((ln) => {
          y += ln.h / 2;
          drawRun(ctx, ln.rn, px - ln.rn.w / 2, y, alpha, sp.plate ? null : sp.halo || null);
          y += ln.h / 2;
        });
      });
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }

    // ── selection, hover and dependency links ──────────────────────────────────────────────────
    function nodePath(ref) {
      const n = world.nodes.get(ref.type + ':' + ref.id);
      if (!n) return null;
      const p = new Path2D();
      const loops = ref.type === 'domain' ? n.outline : ref.type === 'area' ? n.coast : n.rawLoops.map(flat);
      loops.forEach((l) => loopPath(p, l));
      return p;
    }
    function strokeNode(ref, lw, col, haloW) {
      const p = nodePath(ref);
      if (!p) return;
      ctx.lineJoin = 'round';
      if (haloW) { ctx.lineWidth = lw + haloW; ctx.strokeStyle = rgba(P.land, 0.9); ctx.stroke(p); }
      ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.stroke(p);
      ctx.lineJoin = 'miter';
    }
    function drawHover() {
      if (!hover) return;
      // the hovered node is lifted (full band colour, see liftRefs) and drawn with an ink outline on a land halo
      if (hover.type === 'feature') {
        const c = world.byFid.get(hover.id);
        if (c) {
          const x = sx(c.x), y = sy(c.y), k = cam.k;
          hexStroke(x, y, k * 0.97, rgba(P.land, 0.95), clamp(k * 0.12, 3.5, 6.5));
          hexStroke(x, y, k * 0.97, rgba(P.ink), clamp(k * 0.06, 2, 3));
        }
      } else strokeNode(hover, 2.2, rgba(P.ink, 0.92), 3);
    }
    function drawSelection(now) {
      const sel = S.selection;
      if (sel && sel.type === 'feature') {
        const c = world.byFid.get(sel.id);
        if (c) {
          const x = sx(c.x), y = sy(c.y), k = cam.k;
          hexStroke(x, y, k * 0.99, rgba(P.land), clamp(k * 0.16, 4, 8));
          hexStroke(x, y, k * 0.99, rgba(P.ink), clamp(k * 0.09, 2.2, 4));
          // an orbit reticle: a dotted ring with four ticks
          const R = Math.max(k * 1.42, 16);
          ctx.beginPath(); ctx.arc(x, y, R, 0, 2 * Math.PI); ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(P.ink, 0.75); ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath();
          for (let a = 0; a < 4; a++) { const t = a * Math.PI / 2; ctx.moveTo(x + Math.cos(t) * (R - 4), y + Math.sin(t) * (R - 4)); ctx.lineTo(x + Math.cos(t) * (R + 6), y + Math.sin(t) * (R + 6)); }
          ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(P.ink); ctx.stroke();
        }
      } else if (sel && (sel.type === 'module' || sel.type === 'domain' || sel.type === 'area')) {
        strokeNode(sel, sel.type === 'area' ? 2.4 : 2.6, rgba(P.ink), 4);
      }
      if (flash) {
        const c = world.byFid.get(flash.fid);
        if (!flash.t0) flash.t0 = now;
        const u = (now - flash.t0) / 1300;
        if (!c || u >= 1) flash = null;
        else {
          animating = true;
          const x = sx(c.x), y = sy(c.y);
          ctx.beginPath(); ctx.arc(x, y, cam.k * (1.1 + u * 1.6), 0, 2 * Math.PI);
          ctx.lineWidth = 2.5 * (1 - u) + 0.5; ctx.strokeStyle = rgba(P.ink, 0.7 * (1 - u)); ctx.stroke();
        }
      }
    }
    function drawLinks(placed) {
      const sel = S.selection;
      if (!sel || sel.type !== 'feature') return;
      const c0 = world.byFid.get(sel.id);
      if (!c0) return;
      const keyNow = sel.id + '|' + world.sizeClass;
      if (linkFor !== keyNow) {
        links = BP.dependencies(sel.id).map((f) => ({ c: world.byFid.get(f.id), dep: true }))
          .concat(BP.dependents(sel.id).map((f) => ({ c: world.byFid.get(f.id), dep: false }))).filter((l) => l.c);
        linkFor = keyNow;
      }
      const k = cam.k;
      const x0 = sx(c0.x), y0 = sy(c0.y);
      links.forEach((l) => {
        const x1 = sx(l.c.x), y1 = sy(l.c.y);
        const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
        if (d < 2) return;
        const nx = -dy / d, ny = dx / d;
        const bend = Math.max(k * 0.9, d * 0.2);
        let best = null, bestHits = Infinity;
        [1, -1].forEach((s) => {
          const cx = (x0 + x1) / 2 + nx * bend * s, cy = (y0 + y1) / 2 + ny * bend * s;
          let hitsN = 0;
          for (let t = 0.1; t < 0.95; t += 0.08) {
            const px = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1, py = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
            for (const b of placed) if (px > b.x0 && px < b.x1 && py > b.y0 && py < b.y1) hitsN++;
          }
          if (hitsN < bestHits) { bestHits = hitsN; best = { cx, cy }; }
        });
        const { cx, cy } = best;
        // start and end just outside the cells
        const tS = Math.min(0.45, (k * 0.62) / d), tE = 1 - tS;
        const P0 = qpt(x0, y0, cx, cy, x1, y1, tS), P1 = qpt(x0, y0, cx, cy, x1, y1, tE);
        const ccx = (cx - (x0 + x1) / 2) * (tE - tS) + (P0[0] + P1[0]) / 2, ccy = (cy - (y0 + y1) / 2) * (tE - tS) + (P0[1] + P1[1]) / 2;
        const dimmed = M.dim[FIDX.get(l.c.fid)];
        ctx.globalAlpha = dimmed ? 0.45 : 1;
        ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.quadraticCurveTo(ccx, ccy, P1[0], P1[1]);
        ctx.lineCap = 'round';
        ctx.lineWidth = 5; ctx.strokeStyle = rgba(P.land, 0.85); ctx.stroke();
        ctx.lineWidth = 1.7; ctx.strokeStyle = rgba(l.dep ? P.ink : P['ink-2']); ctx.setLineDash(l.dep ? [] : [5, 4]); ctx.stroke(); ctx.setLineDash([]);
        ctx.lineCap = 'butt';
        // arrowhead: towards the dependency, or from a dependent into the selection
        const [ax, ay, bx, by] = l.dep ? [ccx, ccy, P1[0], P1[1]] : [ccx, ccy, P0[0], P0[1]];
        const ang = Math.atan2(by - ay, bx - ax), al = 8;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - al * Math.cos(ang - 0.42), by - al * Math.sin(ang - 0.42)); ctx.lineTo(bx - al * Math.cos(ang + 0.42), by - al * Math.sin(ang + 0.42)); ctx.closePath();
        ctx.fillStyle = rgba(l.dep ? P.ink : P['ink-2']); ctx.fill();
        hexStroke(x1, y1, k * 0.97, rgba(l.dep ? P.ink : P['ink-2']), clamp(k * 0.06, 1.5, 2.6), l.dep ? null : [4, 3]);
        ctx.globalAlpha = 1;
      });
    }
    function qpt(x0, y0, cx, cy, x1, y1, t) { return [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1]; }

    // ── readout and zoom ladder ────────────────────────────────────────────────────────────────
    function nearestCell(x, y) {
      const [q, r] = pixelToHex(x, y);
      const c = world.at(q, r);
      if (c) return c;
      let best = null, bd = Infinity;
      world.cells.forEach((cc) => { const d = (cc.x - x) * (cc.x - x) + (cc.y - y) * (cc.y - y); if (d < bd) { bd = d; best = cc; } });
      return best;
    }
    function updateReadout() {
      const lv = level(cam.k);
      let txt;
      if (lv === 0) {
        txt = isTL ? '<b>' + esc(BP.product.name) + '</b> as of ' + esc(RELS[TL.idx].label) : '<b>' + esc(BP.product.name) + '</b><span class="bt-loc__sep">·</span>' + BP.areas.length + ' areas<span class="bt-loc__sep">·</span>' + BP.domains.length + ' domains<span class="bt-loc__sep">·</span>' + NF + ' features';
      } else {
        const fr = freeRectGuess();
        const c = nearestCell(wx(fr.x + fr.w / 2), wy(fr.y + fr.h / 2));
        const parts = [['area', c.area, BP.area(c.area).name], ['domain', c.dom, BP.domain(c.dom).name]];
        if (lv >= 1) parts.push(['module', c.mod, BP.module(c.mod).name]);
        txt = parts.map(([t, id, name], j) => '<button type="button" class="bt-crumb' + (j === parts.length - 1 ? ' is-here' : '') + '" data-bt-inspect="' + t + ':' + esc(id) + '">' + esc(name) + '</button>').join('<span class="bt-loc__sep" aria-hidden="true">›</span>');
        lastLocText = parts.map((p) => p[2]).join(' › ');
      }
      if (txt !== lastLoc) { locPath.innerHTML = txt; lastLoc = txt; }
      if (lv !== lastLevel) {
        lastLevel = lv;
        locLvl.textContent = LEVELS[lv];
        rungs.forEach((b) => { const l = +b.getAttribute('data-bt-lvl'); b.classList.toggle('is-on', l === lv); b.classList.toggle('is-past', l < lv); b.setAttribute('aria-current', l === lv ? 'true' : 'false'); });
        view.classList.toggle('is-l0', lv === 0);
      }
    }

    // ── the frame ──────────────────────────────────────────────────────────────────────────────
    function draw(now) {
      const dt = lastNow ? clamp(now - lastNow, 0, 80) : 16;
      lastNow = now;
      animating = false;
      if (flight) {
        if (!flight.t0) flight.t0 = now;
        const u = clamp((now - flight.t0) / flight.dur, 0, 1);
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const f0 = flight.from, f1 = flight.to;
        cam.k = Math.exp(lerp(Math.log(f0.k), Math.log(f1.k), e));
        cam.x = lerp(f0.x, f1.x, e);
        cam.y = lerp(f0.y, f1.y, e);
        if (u >= 1) { flight = null; clampCam(); } else animating = true;
      }
      const k = cam.k;
      const L = { A1: ramp(k, T.t1), A2: ramp(k, T.t2), A3: ramp(k, T.t3), A4: ramp(k, T.t4) };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);
      const m = 1.5;
      const X0 = wx(0) - m, X1 = wx(vw) + m, Y0 = wy(0) - m, Y1 = wy(vh) + m;
      const vis = world.cells.filter((c) => c.x > X0 && c.x < X1 && c.y > Y0 && c.y < Y1);
      drawSea(now);
      drawLand();
      plates(vis, L, now);
      const pl = placeLabels(labelSpecs(L), dt);
      drawLinks(pl.placed);
      marks(vis, L, now, dt, pl.placed);
      drawHover();
      drawSelection(now);
      drawLabelList(pl.drawList);
      updateReadout();
      return animating || pl.fading || nameBusy(vis, L);
    }
    function nameBusy(vis) {
      // a name still fading in or out keeps the frame loop going
      for (const c of vis) { const v = nameF[FIDX.get(c.fid)]; if (v > 0.001 && v < 0.999) return true; }
      return false;
    }

    // ── input ──────────────────────────────────────────────────────────────────────────────────
    let origin = { left: 0, top: 0 };
    const roOrigin = new ResizeObserver(() => { origin = view.getBoundingClientRect(); });
    roOrigin.observe(view);
    W.addEventListener('resize', () => { requestAnimationFrame(() => { origin = view.getBoundingClientRect(); }); });
    const pt = (e) => [e.clientX - origin.left, e.clientY - origin.top];
    function hitTest(px, py) {
      for (let j = placedLabels.length - 1; j >= 0; j--) {
        const h = placedLabels[j];
        if (px >= h.box.x0 && px <= h.box.x1 && py >= h.box.y0 && py <= h.box.y1) return h.ref;
      }
      const [q, r] = pixelToHex(wx(px), wy(py));
      const c = world.at(q, r);
      if (!c) return null;
      const lv = level(cam.k);
      if (lv === 0) return { type: 'domain', id: c.dom };
      if (lv === 1) return { type: 'module', id: c.mod };
      return { type: 'feature', id: c.fid };
    }
    function tipHTML(ref) {
      const lens = S.lens;
      if (ref.type === 'feature') {
        const f = BP.feature(ref.id);
        const m = BP.module(f.moduleId);
        let line;
        if (isTL) {
          const i = FIDX.get(f.id);
          const kd = TL.kind[i] ? KIND_ID[TL.kind[i]] : null;
          const st = TL.st[i];
          line = st === 0 ? 'Shipped in v' + f.release : st === 1 ? 'Ships later, in v' + f.release : f.release ? 'Targets v' + f.release : 'Not scheduled yet';
          if (kd) line += ' · ' + (kd === 'new' ? 'new' : kd) + ' in ' + RELS[TL.idx].label;
          return '<span class="bt-tip__k">' + esc(m.name) + '</span><span class="bt-tip__n">' + esc(f.name) + '</span><span class="bt-tip__r">' + OK.html.status(f.status, 12) + '<span>' + esc(OK.statusLabel(f.status)) + ' · ' + esc(line) + '</span></span>';
        }
        const r = BP.rating(f, lens);
        return '<span class="bt-tip__k">' + esc(m.name) + '</span><span class="bt-tip__n">' + esc(f.name) + '</span><span class="bt-tip__r">' + OK.html.status(f.status, 12) + '<span>' + esc(OK.statusLabel(f.status)) + '</span>' + OK.html.band(r.band, 12) + '<span class="ok-mono">' + (r.band === 'na' ? 'n/a' : OK.fmt.score(r.score)) + '</span></span>' +
          (r.headline ? '<span class="bt-tip__r"><span class="bt-tip__h">' + esc(OK.lens(lens).short + ': ' + r.headline) + '</span></span>' : '');
      }
      const s = M.stat.get(ref.type + ':' + ref.id);
      const name = ref.type === 'module' ? BP.module(ref.id).name : ref.type === 'domain' ? BP.domain(ref.id).name : BP.area(ref.id).name;
      const kind = ref.type === 'module' ? 'Module · ' + BP.domain(BP.module(ref.id).domainId).name : ref.type === 'domain' ? 'Domain' : 'Area';
      let r2 = '';
      if (isTL) { const t = TL.stat.get(ref.type + ':' + ref.id); r2 = '<span class="bt-tip__r"><span class="ok-mono">' + t.live + '</span> live of <span class="ok-mono">' + s.n + '</span>' + (t.pkg ? ' · <span class="ok-mono">' + t.pkg + '</span> in ' + esc(RELS[TL.idx].label) : '') + '</span>'; }
      else r2 = '<span class="bt-tip__r">' + OK.html.band(s.band, 12) + '<span class="ok-mono">' + (s.band === 'na' ? 'n/a' : OK.fmt.score(s.score)) + '</span><span>' + esc(OK.lens(lens).label) + '</span>' + (s.attn ? OK.html.attention(11) + '<span class="ok-mono">' + s.attn + '</span>' : '') + (s.gates ? OK.html.gate('approval', 11) + '<span class="ok-mono">' + s.gates + '</span>' : '') + '</span>';
      return '<span class="bt-tip__k">' + esc(kind) + '</span><span class="bt-tip__n">' + esc(name) + ' <span class="ok-muted" style="font-weight:400">· ' + plural(s.n, 'feature') + '</span></span>' + r2;
    }
    let tipRef = '';
    function setHover(ref, px, py) {
      const id = ref ? ref.type + ':' + ref.id : '';
      if (id !== tipRef) {
        tipRef = id;
        hover = ref;
        cv.classList.toggle('is-hot', !!ref);
        if (ref) tip.innerHTML = tipHTML(ref);
        tip.hidden = !ref;
        invalidate();
      }
      if (ref) {
        const tx = px + 16 + 250 > vw ? px - 16 - 250 : px + 16;
        const ty = py + 18 + 90 > vh ? py - 18 - 90 : py + 18;
        tip.style.transform = 'translate(' + Math.round(Math.max(4, tx)) + 'px,' + Math.round(Math.max(4, ty)) + 'px)';
      }
    }
    const pointers = new Map();
    let drag = null, pinch = null, lastTap = null;
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
      const [px, py] = pt(e);
      pointers.set(e.pointerId, { x: px, y: py });
      if (pointers.size === 1) drag = { x: px, y: py, cx: cam.x, cy: cam.y, moved: false, type: e.pointerType };
      else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: cam.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        pinch.wx = wx(pinch.mx); pinch.wy = wy(pinch.my);
        if (drag) drag.moved = true;
      }
      flight = null;
    });
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = pt(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: px, y: py });
      if (pinch && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        cam.k = clamp(pinch.k0 * d / pinch.d0, T.kMin, T.kMax);
        cam.x = pinch.wx - (mx - vw / 2) / cam.k;
        cam.y = pinch.wy - (my - vh / 2) / cam.k;
        clampCam(); atFit = false; invalidate();
        return;
      }
      if (drag && pointers.has(e.pointerId)) {
        const dx = px - drag.x, dy = py - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > (drag.type === 'mouse' ? 4 : 8)) { drag.moved = true; cv.classList.add('is-pan'); setHover(null); }
        if (drag.moved) { cam.x = drag.cx - dx / cam.k; cam.y = drag.cy - dy / cam.k; clampCam(); atFit = false; invalidate(); }
        return;
      }
      if (e.pointerType === 'mouse') setHover(hitTest(px, py), px, py);
    });
    function endPointer(e) {
      const [px, py] = pt(e);
      const wasTap = drag && !drag.moved && e.type === 'pointerup' && pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pinch && pointers.size < 2) {
        pinch = null;
        const rest = Array.from(pointers.values())[0];
        if (rest) drag = { x: rest.x, y: rest.y, cx: cam.x, cy: cam.y, moved: true, type: 'touch' };
      }
      if (pointers.size === 0) { cv.classList.remove('is-pan'); if (wasTap) tap(px, py, drag.type); drag = null; }
    }
    cv.addEventListener('pointerup', endPointer);
    cv.addEventListener('pointercancel', endPointer);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) setHover(null); });
    // A tap acts on pointerup and may open the kit's peek or inspector sheet under the finger (phones). Cancel the
    // browser's compatibility click that follows the touch, or it lands on the new sheet (a lens row, a feature row).
    cv.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    function tap(px, py, ptype) {
      const now = performance.now();
      const touch = ptype !== 'mouse';
      const ref = hitTest(px, py);
      if (touch && lastTap && now - lastTap.t < 330 && Math.hypot(px - lastTap.x, py - lastTap.y) < 28) {
        lastTap = null;
        if (ref && ref.type === 'feature') shell.openFeature(ref.id);
        return;
      }
      lastTap = { t: now, x: px, y: py };
      if (!ref) { if (S.selection) shell.select(null); return; }
      if (ref.type === 'feature') { shell.peek(ref.id); if (touch) { const c = world.byFid.get(ref.id); if (c) requestAnimationFrame(() => ensureVisible(c)); } }
      else { shell.inspect(ref); if (touch) locateMeasured(ref); }
    }
    cv.addEventListener('dblclick', (e) => {
      const [px, py] = pt(e);
      const ref = hitTest(px, py);
      if (!ref) { const k1 = clamp(cam.k * 2, T.kMin, T.kMax); const x = wx(px), y = wy(py); flyTo({ x: x - (px - vw / 2) / k1, y: y - (py - vh / 2) / k1, k: k1 }, 360); return; }
      if (ref.type === 'feature') shell.openFeature(ref.id);
      else locateMeasured(ref);
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = pt(e);
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      zoomAt(px, py, Math.exp(-d * (e.ctrlKey ? 0.012 : 0.0022)));
      if (tipRef) setHover(hitTest(px, py), px, py);
    }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      if (!e.key || e.key.indexOf('Arrow') !== 0 || e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      const sel = S.selection;
      let c = sel && sel.type === 'feature' ? world.byFid.get(sel.id) : null;
      if (!c) { const fr = freeRectGuess(); c = nearestCell(wx(fr.x + fr.w / 2), wy(fr.y + fr.h / 2)); }
      else {
        const order = { ArrowRight: [0], ArrowLeft: [3], ArrowUp: [4, 5], ArrowDown: [1, 2] }[e.key] || [];
        for (const d of order) { const n = c.nb[d]; if (n >= 0) { c = world.cells[n]; break; } }
      }
      if (cam.k < T.t2) flyTo({ x: c.x, y: c.y, k: T.t3 * 1.05 }, 420);
      shell.peek(c.fid);
      requestAnimationFrame(() => ensureVisible(c));
    });
    loc.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bt-inspect]');
      if (!b) return;
      const [type, ...rest] = b.getAttribute('data-bt-inspect').split(':');
      const ref = type === 'product' ? { type: 'product', id: BP.product.id } : { type, id: rest.join(':') };
      shell.inspect(ref);
      locateMeasured(ref);
    });
    zoom.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bt-z],[data-bt-lvl]');
      if (!b) return;
      const z = b.getAttribute('data-bt-z');
      if (z === 'in') zoomBy(1.6); else if (z === 'out') zoomBy(1 / 1.6); else if (z === 'fit') fit(true);
      else zoomToLevel(+b.getAttribute('data-bt-lvl'));
    });

    return {
      el: view, cv, invalidate, fit, zoomBy, zoomToLevel,
      locate: locateMeasured,
      setVisible(v) { visible = v; if (v) invalidate(); else setHover(null); },
      setInsp(open, width) { inspOpen = open; if (width) inspW = width; invalidate(); },
      setLegend(width) { legendW = width || 0; invalidate(); },
      clearCaches() { labState.clear(); invalidate(); },
      get world() { return world; }, cam, T,
      level: () => level(cam.k),
      /** Labels on screen now (for QA): ids such as 'd:payments', with the variant drawn (0 = fullest). */
      labels: () => { const o = []; labState.forEach((st, id) => { if (st.a > 0.5 && st.ci >= 0) o.push(id + (st.vi ? '#' + st.vi : '')); }); return o; },
      stats: () => { const a = drawMs.slice().sort((x, y) => x - y); return { n: a.length, median: a[a.length >> 1], max: a[a.length - 1] }; },
      /** Jump (no animation) to a zoom level centred on a node: used by screenshot scenarios. */
      show(ref, lvl) {
        if (!world) return;
        const kk = [kFit, T.t1 * 1.1, T.t2 * 1.15, T.t3 * 1.15, T.t4 * 1.12][lvl == null ? 2 : lvl];
        const b = ref ? nodeBox(ref) : world.bounds;
        flight = null; atFit = lvl === 0 && !ref;
        setHover(null);
        setCam({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, k: kk });
        invalidate();
      },
    };
  }

  // ══ time-lapse ribbon: releases by date, package bars, today, scrubber, play and pause ═════════════
  const DAY = 86400000;
  const dateMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function createRibbon(shell, host, tlView) {
    const asOfMs = dateMs(BP.asOf);
    const d0 = dateMs(RELS[0].date) - 24 * DAY, d1 = dateMs(RELS[RELS.length - 1].date) + 24 * DAY;
    const counts = RELS.map((r) => {
      const c = { new: 0, improved: 0, fixed: 0 };
      BP.releaseItems(r.id).forEach((it) => { c[it.kind] = (c[it.kind] || 0) + 1; });
      c.total = c.new + c.improved + c.fixed;
      return c;
    });
    const maxItems = Math.max(...counts.map((c) => c.total));
    // features live after each release (shipped ones), and the planned total if the rest ships
    const cum = RELS.map((r, i) => FEATS.reduce((n, f, j) => n + (f.status === 'live' && TL.relIdx[j] >= 0 && TL.relIdx[j] <= i ? 1 : 0), 0));
    host.innerHTML = '<div class="bt-rib__top">' +
      '<button type="button" class="bt-play" aria-label="Play the time-lapse" title="Play the time-lapse"></button>' +
      '<div class="bt-rib__rel"><span class="bt-rib__ver ok-mono"></span><span class="bt-rib__name"></span></div>' +
      '<div class="bt-rib__cap" aria-live="polite"><span class="bt-rib__cap1"></span><span class="bt-rib__cap2"></span></div>' +
      '<button type="button" class="ok-btn ok-btn--sm bt-rib__insp">Release details</button></div>' +
      '<div class="bt-axis" tabindex="0" role="slider" aria-label="Release shown on the map" aria-valuemin="0" aria-valuemax="' + (RELS.length - 1) + '"><svg aria-hidden="true"></svg></div>';
    const playBtn = host.querySelector('.bt-play'), ver = host.querySelector('.bt-rib__ver'), nm = host.querySelector('.bt-rib__name');
    const cap1 = host.querySelector('.bt-rib__cap1'), cap2 = host.querySelector('.bt-rib__cap2'), insp = host.querySelector('.bt-rib__insp');
    const axis = host.querySelector('.bt-axis'), svgEl = axis.querySelector('svg');
    let AW = 0, AH = 96;
    let timer = 0;
    const PLAY = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.2v9.6L11.6 7Z" fill="currentColor"/></svg>';
    const PAUSE = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.6 2.4h2.4v9.2H3.6ZM8 2.4h2.4v9.2H8Z" fill="currentColor"/></svg>';
    const xOf = (ms) => { const pad = AW < 500 ? 16 : 30; return pad + (ms - d0) / (d1 - d0) * (AW - 2 * pad); };
    function render() {
      if (!AW) return;
      const ph = AW < 500;
      const yB = AH - 26;
      const barMax = yB - 6 - 21;
      let h = '';
      // the future, from today on
      const xt = xOf(asOfMs);
      h += '<rect class="bt-ax-future" x="' + xt.toFixed(1) + '" y="14" width="' + Math.max(0, xOf(d1) - xt).toFixed(1) + '" height="' + (yB - 8) + '" rx="3"/>';
      // features live over time: a quiet step area behind the bars
      const top = 16, hgt = yB - 6 - top;
      let pth = 'M' + xOf(d0).toFixed(1) + ',' + (yB - 6);
      let prevY = yB - 6;
      RELS.forEach((r, i) => {
        if (r.state !== 'shipped') return;
        const x = xOf(dateMs(r.date));
        const y = yB - 6 - (cum[i] / NF) * hgt;
        pth += 'L' + x.toFixed(1) + ',' + prevY.toFixed(1) + 'L' + x.toFixed(1) + ',' + y.toFixed(1);
        prevY = y;
      });
      pth += 'L' + xt.toFixed(1) + ',' + prevY.toFixed(1) + 'L' + xt.toFixed(1) + ',' + (yB - 6) + 'Z';
      h += '<path class="bt-ax-live" d="' + pth + '"/><path class="bt-ax-livel" d="' + pth.replace(/Z$/, '').replace(/L[\d.]+,[\d.]+$/, '') + '"/>';
      // baseline, months and years
      h += '<line class="bt-ax-line" x1="' + xOf(d0).toFixed(1) + '" x2="' + xOf(d1).toFixed(1) + '" y1="' + yB + '" y2="' + yB + '"/>';
      const dd = new Date(d0);
      let y = dd.getUTCFullYear(), mo = dd.getUTCMonth() + 1;
      if (mo > 11) { mo = 0; y++; }
      for (; Date.UTC(y, mo, 1) < d1; mo++) {
        if (mo > 11) { mo = 0; y++; }
        const ms = Date.UTC(y, mo, 1);
        if (ms >= d1) break;
        const x = xOf(ms);
        const isYear = mo === 0;
        h += '<line class="bt-ax-tick' + (isYear ? ' is-year' : '') + '" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (isYear ? yB - 5 : yB + 2) + '" y2="' + (yB + (isYear ? 9 : 5)) + '"/>';
        const nearToday = Math.abs(x - xt) < (ph ? 58 : 64);
        if (isYear && !nearToday) h += '<text class="bt-ax-yr" x="' + x.toFixed(1) + '" y="' + (yB + 20) + '" text-anchor="middle">' + y + '</text>';
        else if (!ph && mo % 3 === 0 && !nearToday) h += '<text class="bt-ax-mo" x="' + x.toFixed(1) + '" y="' + (yB + 20) + '" text-anchor="middle">' + MONTHS[mo] + '</text>';
      }
      // today
      h += '<line class="bt-ax-today" x1="' + xt.toFixed(1) + '" x2="' + xt.toFixed(1) + '" y1="16" y2="' + (yB + 6) + '"/><text class="bt-ax-todayt" x="' + xt.toFixed(1) + '" y="' + (yB + 20) + '" text-anchor="middle">Today ' + esc(OK.fmt.dateShort(BP.asOf)) + '</text>';
      // releases: package bar, node, label (labels culled where they would collide)
      const sel = TL.idx;
      const lblW = ph ? 26 : 32;
      const order = RELS.map((r, i) => i).sort((a, b) => (b === sel) - (a === sel) || (RELS[b].state === 'next') - (RELS[a].state === 'next') || (b === 0) - (a === 0) || (b === RELS.length - 1) - (a === RELS.length - 1) || a - b);
      const shown = new Set();
      const taken = [];
      order.forEach((i) => { const x = xOf(dateMs(RELS[i].date)); if (taken.every((t) => Math.abs(t - x) > lblW + 4)) { taken.push(x); shown.add(i); } });
      RELS.forEach((r, i) => {
        const x = xOf(dateMs(r.date));
        const c = counts[i];
        const bw = ph ? 5 : 8;
        const tot = 5 + (c.total / maxItems) * (barMax - 5);
        const segs = [['new', c.new, 'is-new'], ['improved', c.improved, ''], ['fixed', c.fixed, 'is-fix']];
        let g = '<g class="bt-ax-rel is-' + r.state + (i === sel ? ' is-sel' : '') + '" data-rel="' + esc(r.id) + '">';
        g += '<title>' + esc(r.label + ' ' + (r.name || '') + ' · ' + OK.fmt.date(r.date) + ' · ' + c.new + ' new, ' + c.improved + ' improved, ' + c.fixed + ' fixed') + '</title>';
        g += '<rect class="bt-ax-hit" x="' + (x - 13).toFixed(1) + '" y="0" width="26" height="' + AH + '"/>';
        let yy = yB - 6;
        if (r.state === 'shipped') {
          segs.forEach(([, n, cls]) => { if (!n) return; const hh = (n / c.total) * tot; g += '<rect class="bt-ax-bar ' + cls + '" x="' + (x - bw / 2).toFixed(1) + '" y="' + (yy - hh).toFixed(1) + '" width="' + bw + '" height="' + hh.toFixed(1) + '"/>'; yy -= hh; });
        } else g += '<rect class="bt-ax-bar" x="' + (x - bw / 2 + 0.5).toFixed(1) + '" y="' + (yy - tot + 0.5).toFixed(1) + '" width="' + (bw - 1) + '" height="' + (tot - 1).toFixed(1) + '"/>';
        if (i === sel) g += '<line class="bt-ax-thumb" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="16" y2="' + (yB + 7) + '"/><circle class="bt-ax-thumbr" cx="' + x.toFixed(1) + '" cy="' + yB + '" r="8.5"/>';
        g += '<circle class="bt-ax-node" cx="' + x.toFixed(1) + '" cy="' + yB + '" r="' + (i === sel ? 5 : 4) + '"/>';
        if (shown.has(i)) g += '<text class="bt-ax-lbl" x="' + x.toFixed(1) + '" y="10">' + esc(r.label) + '</text>';
        h += g + '</g>';
      });
      svgEl.innerHTML = h;
    }
    function caption() {
      const r = RELS[TL.idx];
      const c = counts[TL.idx];
      ver.textContent = r.label;
      nm.textContent = r.name || '';
      const live = TL.live;
      if (r.state === 'shipped') {
        cap1.innerHTML = 'As of <b>' + esc(r.label) + '</b> · <span class="ok-mono">' + esc(OK.fmt.date(r.date)) + '</span> · <span class="ok-mono">' + live + '</span> features live';
        cap2.innerHTML = '<span class="bt-xs-hide">This release: </span><b>' + c.new + '</b> new · <b>' + c.improved + '</b> improved · <b>' + c.fixed + '</b> fixed';
      } else {
        const fs = BP.releaseItems(r.id).filter((it) => it.kind === 'new').map((it) => BP.feature(it.feature));
        const by = { ready: 0, building: 0, blocked: 0, planned: 0 };
        fs.forEach((f) => { by[f.status] = (by[f.status] || 0) + 1; });
        const when = r.state === 'next' ? 'Next release' : 'Future release';
        const days = Math.round((dateMs(r.date) - asOfMs) / DAY);
        cap1.innerHTML = esc(when) + ' · <span class="ok-mono">' + esc(OK.fmt.date(r.date)) + '</span> · in <span class="ok-mono">' + days + '</span> days<span class="bt-xs-hide"> · <span class="ok-mono">' + live + '</span> features live today</span>';
        const bits = [];
        if (by.ready) bits.push('<b>' + by.ready + '</b> ready');
        if (by.building) bits.push('<b>' + by.building + '</b> in build');
        if (by.blocked) bits.push('<b style="color:var(--ok-alarm)">' + by.blocked + '</b> blocked');
        if (by.planned) bits.push('<b>' + by.planned + '</b> planned');
        cap2.innerHTML = '<b>' + c.new + '</b> new: ' + bits.join(' · ') + (c.improved + c.fixed ? '<span class="bt-xs-hide"> · <b>' + (c.improved + c.fixed) + '</b> improved or fixed</span>' : '');
      }
      axis.setAttribute('aria-valuenow', String(TL.idx));
      axis.setAttribute('aria-valuetext', r.label + ', ' + (r.state === 'shipped' ? 'shipped ' : r.state === 'next' ? 'next release, ' : 'future release, ') + OK.fmt.date(r.date));
      insp.setAttribute('aria-label', 'Release details: ' + r.label);
    }
    function setIdx(i, animate) {
      i = clamp(i | 0, 0, RELS.length - 1);
      if (i === TL.idx && animate !== false) { caption(); render(); return; }
      computeTL(i, animate !== false && !reduceMotion());
      caption();
      render();
      tlView.invalidate();
    }
    function stop() {
      if (timer) { clearTimeout(timer); timer = 0; }
      playBtn.innerHTML = PLAY;
      playBtn.setAttribute('aria-label', 'Play the time-lapse');
      playBtn.title = 'Play the time-lapse';
    }
    function step() {
      if (TL.idx >= RELS.length - 1) { stop(); return; }
      setIdx(TL.idx + 1, true);
      timer = setTimeout(step, 1150);
    }
    function play() {
      if (timer) { stop(); return; }
      if (TL.idx >= RELS.length - 1) setIdx(0, true);
      playBtn.innerHTML = PAUSE;
      playBtn.setAttribute('aria-label', 'Pause the time-lapse');
      playBtn.title = 'Pause the time-lapse';
      timer = setTimeout(step, 900);
    }
    playBtn.addEventListener('click', play);
    // (not data-ok-inspect markup: the kit switches to the map view for it)
    insp.addEventListener('click', () => { stop(); shell.inspect({ type: 'release', id: RELS[TL.idx].id }); });
    let scrub = null;
    const noClick = (e) => { if (e.cancelable) e.preventDefault(); };
    const nearest = (px) => { let b = 0, bd = Infinity; RELS.forEach((r, i) => { const d = Math.abs(xOf(dateMs(r.date)) - px); if (d < bd) { bd = d; b = i; } }); return [b, bd]; };
    let axOrigin = { left: 0 };
    axis.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { axis.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
      // A tap opens the release sheet under the finger on phones, and the ribbon re-renders below it, so the touch's
      // own target leaves the DOM: cancel the compatibility click on that node, or it lands on a row of the new sheet.
      if (e.pointerType !== 'mouse' && e.target && e.target.addEventListener) e.target.addEventListener('touchend', noClick, { passive: false, once: true });
      stop();
      const px = e.clientX - axOrigin.left;
      scrub = { x: px, moved: false };
      setIdx(nearest(px)[0], true);
    });
    axis.addEventListener('pointermove', (e) => {
      if (!scrub) return;
      const px = e.clientX - axOrigin.left;
      if (Math.abs(px - scrub.x) > 5) scrub.moved = true;
      if (scrub.moved) setIdx(nearest(px)[0], true);
    });
    const endScrub = (e) => {
      if (!scrub) return;
      const px = e.clientX - axOrigin.left;
      const [i, d] = nearest(px);
      if (!scrub.moved && e.type === 'pointerup' && d < 22) shell.inspect({ type: 'release', id: RELS[i].id });
      scrub = null;
    };
    axis.addEventListener('pointerup', endScrub);
    axis.addEventListener('pointercancel', endScrub);
    axis.addEventListener('keydown', (e) => {
      let i = TL.idx;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i++;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i--;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = RELS.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shell.inspect({ type: 'release', id: RELS[TL.idx].id }); return; }
      else return;
      e.preventDefault();
      stop();
      setIdx(i, true);
    });
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      AW = Math.round(r.width); AH = Math.round(r.height) || 96;
      axOrigin = axis.getBoundingClientRect();
      render();
    });
    ro.observe(axis);
    stop();
    caption();
    return { setIdx, stop, render };
  }

  // ══ legend: this variant's sections ═══════════════════════════════════════════════════════════
  function hexPts(r, cx, cy) { return CORNER.map(([a, b]) => (cx + a * r).toFixed(2) + ',' + (cy + b * r).toFixed(2)).join(' '); }
  const lgSvg = (inner, w) => '<svg width="' + (w || 26) + '" height="22" viewBox="' + (-(w || 26) / 2) + ' -11 ' + (w || 26) + ' 22" aria-hidden="true">' + inner + '</svg>';
  const HATCH_DEF = '<defs><pattern id="bt-lg-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0V4" stroke="var(--ok-na)" stroke-width="1.1"/></pattern></defs>';
  function legendHTML(state) {
    const lensLabel = OK.lens(state.lens).label;
    const sec = (title, rows) => '<section class="ok-lg-sec"><h3>' + esc(title) + '</h3>' + rows + '</section>';
    const row = (glyph, text) => '<div class="ok-lg-row">' + glyph + '<span>' + text + '</span></div>';
    const cell = (fill, op, extra) => lgSvg('<polygon points="' + hexPts(9.5, 0, 0) + '" fill="' + fill + '" fill-opacity="' + op + '"/>' + (extra || ''));
    if (state.view === 'timeline') {
      return sec('Time-lapse', row(cell('var(--ok-good)', 0.55), '<b>Shipped</b> by the chosen release, coloured by its rating now') +
        row(lgSvg('<polygon points="' + hexPts(8.5, 0, 0) + '" fill="none" stroke="var(--ok-ink-3)" stroke-dasharray="1.2 2.6"/>'), '<b>Unexplored</b>: ships in a later release') +
        row(lgSvg('<polygon points="' + hexPts(8.5, 0, 0) + '" fill="none" stroke="var(--ok-ink-2)" stroke-width="1.3" stroke-dasharray="3 2.2"/>'), '<b>Planned</b> for the next or a future release') +
        row(lgSvg('<polygon points="' + hexPts(9.2, 0, 0) + '" fill="var(--ok-good)" fill-opacity="0.55" stroke="var(--ok-ink)" stroke-width="2"/>'), '<b>In the chosen release</b>: its package glows') +
        row(lgSvg(OK.svg.releaseKind('new', 5), 22) + lgSvg(OK.svg.releaseKind('improved', 5), 22) + lgSvg(OK.svg.releaseKind('fixed', 5), 22), 'New, improved, fixed')) +
        sec('Ribbon', '<p class="ok-lg-note">Each bar is a release package, placed by date. The shaded steps show features live over time; the dashed line is today. Drag along the ribbon to scrub, press play to replay the map growing, click a release for its package.</p>');
    }
    const soft = FILL_SOFT[OK.shell && OK.shell.isDark() ? 'dark' : 'light'];
    const bands = ['good', 'fair', 'poor', 'critical'].map((b) => row(cell('var(--ok-' + b + ')', soft[b] + 0.04), esc(OK.bandLabel(b)))).join('');
    const na = row(lgSvg(HATCH_DEF + '<polygon points="' + hexPts(9.5, 0, 0) + '" fill="var(--ok-na)" fill-opacity="0.12"/><polygon points="' + hexPts(9.5, 0, 0) + '" fill="url(#bt-lg-hatch)"/>'), '<b>Hatched</b>: the lens does not apply');
    const cluster = lgSvg([[-4.3, -3.7], [4.3, -3.7], [0, 3.7]].map(([x, y]) => '<polygon points="' + hexPts(4.6, x, y) + '" fill="var(--ok-good)" fill-opacity="0.5"/>').join(''));
    const plate = lgSvg('<path d="M-10 -2 C-10 -9 -2 -9 1 -7 C6 -9 11 -6 10 0 C11 6 4 9 0 8 C-6 9 -10 5 -10 -2Z" fill="var(--ok-fair)" fill-opacity="0.45" stroke="var(--ok-ink)" stroke-width="1.6"/>');
    const coast = lgSvg('<path d="M-9 -1 C-9 -7 -2 -7 1 -6 C6 -7 9 -4 9 0 C9 5 3 7 0 6 C-5 7 -9 4 -9 -1Z" fill="var(--ok-paper-hi)" stroke="var(--ok-ink-2)"/><path d="M-12 -1 C-12 -9 -2 -9.6 1 -8.6 C8 -9.6 12 -5 12 0 C12 7 3 9.4 0 8.6 C-7 9.4 -12 5 -12 -1Z" fill="none" stroke="var(--ok-ink-3)" stroke-opacity="0.5"/>');
    const halo = (kind) => '<polygon points="' + hexPts(8.5, 0, 0) + '" fill="none" stroke="var(' + (kind === 'changes' ? '--ok-alarm' : '--ok-gate') + ')" stroke-width="1.8"' + (kind === 'triage' ? ' stroke-dasharray="2.6 2"' : '') + '/>';
    const reticle = '<circle r="9.6" fill="none" stroke="var(--ok-ink)" stroke-dasharray="1.5 2.5"/><polygon points="' + hexPts(6.5, 0, 0) + '" fill="none" stroke="var(--ok-ink)" stroke-width="2"/>';
    const link = '<path d="M-11 4 Q0 -8 9 2" fill="none" stroke="var(--ok-ink)" stroke-width="1.5"/><path d="M9 2l-4.6-.6 2.4-3.4Z" fill="var(--ok-ink)"/>';
    const linkD = '<path d="M-11 4 Q0 -8 9 2" fill="none" stroke="var(--ok-ink-2)" stroke-width="1.5" stroke-dasharray="3 2.4"/>';
    const ini = (col, dash) => '<polygon points="' + hexPts(7.5, 0, 0) + '" fill="none" stroke="' + col + '" stroke-width="1.8"' + (dash ? ' stroke-dasharray="2.5 2"' : '') + '/>';
    return sec('The territory', row(cell('var(--ok-good)', 0.5), '<b>Cell</b>: one feature') + row(cluster, '<b>Module</b>: a cluster of cells with a fine border') +
        row(plate, '<b>Domain</b>: a region with a heavy outline') + row(coast, '<b>Area</b>: a continent; sea channels part the areas')) +
      sec('Cell colour: ' + lensLabel, '<div class="ok-lg-grid">' + bands + '</div>' + na) +
      sec('Marks', row(lgSvg('<polygon points="' + hexPts(9.5, 0, 0) + '" fill="var(--ok-critical)" fill-opacity="0.6"/><g transform="translate(5 -4)"><circle r="4.6" fill="var(--ok-paper-hi)"/>' + OK.svg.attention(4) + '</g>'), '<b>Alarm mark</b> in a cell’s corner: needs attention') +
        row(lgSvg(halo('triage'), 22) + lgSvg(halo('approval'), 22) + lgSvg(halo('changes'), 22), 'Gate halos: triage, approval, changes requested') +
        row(lgSvg('<polygon points="' + hexPts(8.5, 0, 0) + '" fill="none" stroke="var(--ok-ink)" stroke-width="2.4"/>'), 'Search match') +
        row(lgSvg(reticle), 'Selected feature') +
        row(lgSvg(link) + lgSvg(linkD), 'Depends on (solid arrow) · used by (dashed)') +
        (state.initiative ? row(lgSvg(ini('var(--ok-good)'), 18) + lgSvg(ini('var(--ok-ink-3)'), 18) + lgSvg(ini('var(--ok-ink-4)', true), 18) + lgSvg(ini('var(--ok-alarm)'), 18), 'Initiative: covered, in progress, pending, finding') : '')) +
      sec('Zoom', '<p class="ok-lg-note">The map opens on areas and domains, in calm colours. Zoom in to uncover modules, then every feature with its status in full colour, then names and ratings, then a detail card per cell. Positions never move. The place under the middle of the map shows at the bottom left; click a name there to inspect it.</p>');
  }

  // ══ boot ══════════════════════════════════════════════════════════════════════════════════════
  function boot() {
    const app = document.getElementById('app');
    const shell = OK.mount({
      root: app, variant: 'Orbit Territories', legend: (state) => legendHTML(state),
      // the map's own keys, appended to the kit's key line in the legend (kit 0.2.1)
      keys: [['+ −', 'zoom'], ['0', 'fit the map'], ['← → ↑ ↓', 'move between cells']],
    });
    P = readPalette(shell.root);
    refreshLens(shell.state.lens);
    refreshFilter(shell);
    const map = createView(shell, shell.mapEl, 'map');
    shell.timelineEl.innerHTML = '<div class="bt-tl"><div class="bt-tl__map"></div><div class="bt-rib"></div></div>';
    const tl = createView(shell, shell.timelineEl.querySelector('.bt-tl__map'), 'timeline');
    const rib = createRibbon(shell, shell.timelineEl.querySelector('.bt-rib'), tl);
    const views = [map, tl];
    const active = () => (shell.state.view === 'timeline' ? tl : map);
    const repaint = () => views.forEach((v) => v.invalidate());
    const retheme = () => { const p = readPalette(shell.root); if (!P || p.dark !== P.dark || rgba(p.ink) !== rgba(P.ink)) { P = p; repaint(); } };
    shell.on('lens', (p) => { refreshLens(p.lens); repaint(); });
    shell.on('filter', () => { refreshFilter(shell); repaint(); });
    // a release chosen elsewhere (the inspector, the feature page) moves the scrubber; the ribbon's own picks already did
    shell.on('select', (ref) => { repaint(); if (ref && ref.type === 'release' && ref.source !== 'variant' && RIDX.has(ref.id)) { rib.stop(); rib.setIdx(RIDX.get(ref.id), true); } });
    shell.on('locate', (ref) => { if (ref && ref.type !== 'release') active().locate(ref); });
    shell.on('theme', () => { retheme(); shell.legend.refresh(); }); // also for data-theme set outside the shell (kit 0.2.1)
    shell.on('view', (p) => { map.setVisible(p.view === 'map'); tl.setVisible(p.view === 'timeline'); if (p.view !== 'timeline') rib.stop(); shell.legend.refresh(); });
    shell.on('inspector', (p) => views.forEach((v) => v.setInsp(p.open, p.width)));
    // the legend panel: move the zoom column out from under it (CSS, .ok-has-legend) and keep labels clear of it
    shell.on('legend', (p) => views.forEach((v) => v.setLegend(p.open ? p.width : 0)));
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (shell.state.page) return;
      const v = active();
      if (e.key === '+' || e.key === '=') { v.zoomBy(1.6); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { v.zoomBy(1 / 1.6); e.preventDefault(); }
      else if (e.key === '0') { v.fit(true); e.preventDefault(); }
    });
    const refonts = () => { MEASURE.clear(); WRAP.clear(); views.forEach((v) => v.clearCaches()); };
    if (document.fonts) {
      document.fonts.ready.then(refonts);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refonts);
    }
    W.BT = { shell, map, tl, rib, M, TL };
  }
  boot();
})();
