/* Orbit Territories (round 2, variant B): a hex-cell territory map of the product, plus a time-lapse timeline.

   PLAN
   ────
   Layout (computed once per stage size class, then fixed; nothing ever moves on lens, filter, search or selection)
   - One hex cell per feature on a pointy-top axial grid (world unit: hex radius R = 1, width √3, row pitch 1.5).
   - Continents (areas): each grows deterministically from a seed cell by frontier growth. The frontier cell with the
     lowest priority joins next, where priority = distance / ρ(θ) + a little hashed noise, and ρ(θ) is a smooth lobed
     radius (a few low-frequency sines), so coasts get bays and capes instead of speckle. A cell with five land
     neighbours joins at once, so there are no lakes. Size = the area's feature count.
   - Regions (domains) and provinces (modules): recursive bisection of the continent's cells. For a group of children
     (in display order) we try every split point, 12 cut directions (15° steps) and both sides; the cells are sorted
     by their projection on the cut normal and cut by count, and the candidate with the most compact pair
     (perimeter / √cells, plus a large penalty for a disconnected part) wins. Exact sizes, contiguous, compact.
     Domains are bisected inside the continent, then modules inside each domain.
   - Features fill their module's cells in reading order (row by row, left to right), in display order.
   - Continents are arranged per size class (wide ≥ 1.35, square, tall < 0.72 stage aspect) from anchor positions:
     each is placed at the free spot nearest its anchor (spiral search), then a few rounds of gravity pull them
     together, always keeping a sea channel of at least 3 cells between coasts. Regions share land borders; modules
     are separated by fine borders.
   - Coast: the hex boundary loop of each continent, offset outwards, Chaikin-smoothed; two water lines follow it.
     Region labels sit at each region's pole of inaccessibility (the cell farthest from its border, nearest the
     centroid); area titles sit in the sea above each continent.

   Levels of detail (continuous zoom; k = hex width on screen in px; thresholds relative to the opening fit kFit)
   - L0 (fit, k < t1 = max(1.4·kFit, 30)): continents, coasts, the band mosaic (each cell filled by its band, hatched
     when n/a), attention flares; area titles and the 17 region plaques (name, band glyph and score, attention and
     gate counts).
   - L1 (k ≥ t1): province (module) labels appear as city labels (band glyph + name); region names recede to large
     faint watermarks under the content and stick to the visible part of their region.
   - L2 (k ≥ t2 = max(2.2·kFit, 50)): every cell gets its status glyph (form = lifecycle); short names where they fit.
   - L3 (k ≥ t3 = max(1.6·t2, 84)): feature names in every cell, the current-lens score, gate halos and flares;
     province names become watermarks too.
   - L4 (k ≥ 160): a mini-detail per cell: the 8-lens corona (same geometry as OK.svg.corona) with the status glyph,
     the name, the current-lens rating and headline, gates, and the release.
   - Every layer cross-fades over a zoom band; culled labels fade in and out over 160 ms instead of popping.
   - Front labels never overlap: they are placed greedily by priority (area > region > province > feature name) and
     culled. The location readout always shows area › region › province for the middle of the free view.

   Rendering: one Canvas 2D per view (cells, borders, glyphs, labels, links), drawn in screen space at device pixel
   ratio; token colours are read with getComputedStyle and re-read on 'theme'. Lens and filter events only refresh
   per-cell arrays and schedule one frame (no DOM rebuild). HUD, ribbon and tooltip are a few DOM elements.

   Timeline ("Time-lapse"): the same territory in its own canvas, as of a chosen release: shipped cells solid,
   cells that ship later as faint unexplored outlines, the release's package glowing (new, improved, fixed marks),
   next and future targets as dashed outlines. A ribbon (releases placed by date, package bars, today marker,
   scrubber, play/pause) drives it; clicking a release opens the kit's release inspector. */
(function () {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ══ hex math and deterministic noise ═══════════════════════════════════════════════════════════
  const SQ3 = Math.sqrt(3);
  // neighbour directions by screen angle 0°, 60°, … (y down): east, south-east, south-west, west, north-west, north-east
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const CORNER = [];
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 30); CORNER.push([Math.cos(a), Math.sin(a)]); }
  const hx = (q, r) => SQ3 * (q + r / 2);
  const hy = (q, r) => 1.5 * r;
  const key = (q, r) => q + ',' + r;
  function hexRound(fq, fr) {
    const fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
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

  // ══ continent growth ═══════════════════════════════════════════════════════════════════════════
  function growBlob(n, seed, aspect) {
    const land = new Map();
    const front = new Map();
    const ph = [hash2(seed, 1, 7) * 6.283, hash2(seed, 2, 7) * 6.283, hash2(seed, 3, 7) * 6.283];
    const amp = [0.1 + hash2(seed, 4, 7) * 0.07, 0.06 + hash2(seed, 5, 7) * 0.06, 0.03 + hash2(seed, 6, 7) * 0.03];
    const rho = (t) => 1 + amp[0] * Math.sin(2 * t + ph[0]) + amp[1] * Math.sin(3 * t + ph[1]) + amp[2] * Math.sin(5 * t + ph[2]);
    const prio = (q, r) => {
      const x = hx(q, r) / aspect, y = hy(q, r);
      return Math.hypot(x, y) / rho(Math.atan2(y, x)) + hash2(q, r, seed) * 0.35;
    };
    const landN = (q, r) => DIRS.reduce((s, d) => s + (land.has(key(q + d[0], r + d[1])) ? 1 : 0), 0);
    const add = (q, r) => {
      land.set(key(q, r), { q, r });
      front.delete(key(q, r));
      DIRS.forEach((d) => { const nq = q + d[0], nr = r + d[1], k = key(nq, nr); if (!land.has(k) && !front.has(k)) front.set(k, { q: nq, r: nr, p: prio(nq, nr) }); });
    };
    add(0, 0);
    while (land.size < n) {
      let best = null, bestP = Infinity;
      front.forEach((c) => {
        const p = landN(c.q, c.r) >= 5 ? -1 : c.p;
        if (p < bestP || (p === bestP && (c.r < best.r || (c.r === best.r && c.q < best.q)))) { bestP = p; best = c; }
      });
      add(best.q, best.r);
    }
    return Array.from(land.values());
  }

  // ══ partition by recursive bisection ═══════════════════════════════════════════════════════════
  function perimeterOf(set) {
    let p = 0;
    set.forEach((c) => { DIRS.forEach((d) => { if (!set.has(key(c.q + d[0], c.r + d[1]))) p++; }); });
    return p;
  }
  function connected(cells, set) {
    if (!cells.length) return true;
    const seen = new Set([key(cells[0].q, cells[0].r)]);
    const stack = [cells[0]];
    while (stack.length) {
      const c = stack.pop();
      DIRS.forEach((d) => { const k = key(c.q + d[0], c.r + d[1]); if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(set.get(k)); } });
    }
    return seen.size === cells.length;
  }
  const toSet = (cells) => { const m = new Map(); cells.forEach((c) => m.set(key(c.q, c.r), c)); return m; };
  function partition(cells, items, out) {
    if (items.length === 1) { out.push({ id: items[0].id, cells }); return out; }
    let best = null;
    const total = items.reduce((s, x) => s + x.size, 0);
    for (let s = 1; s < items.length; s++) {
      const sizeA = items.slice(0, s).reduce((t, x) => t + x.size, 0);
      const balance = Math.abs(sizeA / total - 0.5);
      for (let ai = 0; ai < 12; ai++) {
        const a = (Math.PI / 12) * ai;
        const ux = Math.cos(a), uy = Math.sin(a);
        for (const side of [1, -1]) {
          const sorted = cells.slice().sort((c1, c2) => {
            const p1 = side * (hx(c1.q, c1.r) * ux + hy(c1.q, c1.r) * uy), p2 = side * (hx(c2.q, c2.r) * ux + hy(c2.q, c2.r) * uy);
            if (Math.abs(p1 - p2) > 1e-6) return p1 - p2;
            return (hx(c1.q, c1.r) * -uy + hy(c1.q, c1.r) * ux) - (hx(c2.q, c2.r) * -uy + hy(c2.q, c2.r) * ux);
          });
          const A = sorted.slice(0, sizeA), B = sorted.slice(sizeA);
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

  // the cell farthest from the region's border (ties: nearest the centroid)
  function poleOf(cells) {
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
    let best = null, bd = -1, bc = Infinity;
    cells.forEach((c) => {
      const d = dist.get(key(c.q, c.r)), e = Math.hypot(hx(c.q, c.r) - cx, hy(c.q, c.r) - cy);
      // prefer depth, but a cell one step shallower that is much nearer the centroid reads better for a label
      const score = d * 1.2 - e * 0.35;
      if (score > bd + 1e-9 || (Math.abs(score - bd) < 1e-9 && e < bc)) { bd = score; bc = e; best = c; }
    });
    return { q: best.q, r: best.r, cx, cy };
  }

  // ══ continent arrangement per size class ═══════════════════════════════════════════════════════
  const ANCHORS = {
    wide: { shopper: [-1.05, -0.5], commerce: [0, -0.55], fulfillment: [1.05, -0.45], merchant: [-0.52, 0.55], foundation: [0.55, 0.6] },
    square: { shopper: [-0.55, -1], commerce: [0.55, -1], merchant: [-0.55, 0.05], fulfillment: [0.55, 0.05], foundation: [0, 1] },
    tall: { shopper: [-0.32, -2], commerce: [0.32, -1], fulfillment: [-0.32, 0], merchant: [0.32, 1], foundation: [-0.15, 1.95] },
  };
  const SEA = 3; // water cells between two coasts, at least
  function hexDist(dq, dr) { return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; }
  function dilate(cells, d) {
    const out = new Set();
    cells.forEach((c) => {
      for (let dq = -d; dq <= d; dq++) for (let dr = Math.max(-d, -dq - d); dr <= Math.min(d, -dq + d); dr++) out.add(key(c.q + dq, c.r + dr));
    });
    return out;
  }
  function arrange(conts, sizeClass) {
    const anchors = ANCHORS[sizeClass];
    const diam = 2 * Math.sqrt(conts.reduce((s, c) => s + c.cells.length, 0) / conts.length / (Math.PI * 0.9)) * 1.05; // in rows
    const occupied = new Set(); // dilated cells of placed continents (global)
    const placed = [];
    const coastOf = (c) => c.cells.filter((x) => DIRS.some((d) => !c.set.has(key(x.q + d[0], x.r + d[1]))));
    conts.forEach((c) => { c.set = toSet(c.cells); c.coast = coastOf(c); c.halo = Array.from(dilate(c.cells, SEA)).map((k) => k.split(',').map(Number)); });
    const fits = (c, oq, or, skip) => {
      for (let i = 0; i < c.coast.length; i++) { if (occupied.has(key(c.coast[i].q + oq, c.coast[i].r + or)) && !(skip && skip.has(key(c.coast[i].q + oq, c.coast[i].r + or)))) return false; }
      return true;
    };
    const stamp = (c, on) => c.halo.forEach(([q, r]) => { const k = key(q + c.oq, r + c.or); if (on) occupied.add(k); else occupied.delete(k); });
    // order: biggest first, so the small ones tuck in
    const order = conts.slice().sort((a, b) => b.cells.length - a.cells.length);
    order.forEach((c) => {
      const an = anchors[c.id] || [0, 0];
      const tx = an[0] * diam * SQ3 * 1.25, ty = an[1] * diam * 1.5 * 1.1;
      const [q0, r0] = pixelToHex(tx * 0.62, ty * 0.62);
      let found = null;
      for (let rad = 0; rad < 60 && !found; rad++) {
        // ring of radius rad around (q0, r0), nearest to the target first
        const ringCells = [];
        if (rad === 0) ringCells.push([q0, r0]);
        else {
          let q = q0 + DIRS[4][0] * rad, r = r0 + DIRS[4][1] * rad;
          for (let side = 0; side < 6; side++) for (let st = 0; st < rad; st++) { ringCells.push([q, r]); q += DIRS[side][0]; r += DIRS[side][1]; }
        }
        ringCells.sort((a, b) => Math.hypot(hx(a[0], a[1]) - tx * 0.62, hy(a[0], a[1]) - ty * 0.62) - Math.hypot(hx(b[0], b[1]) - tx * 0.62, hy(b[0], b[1]) - ty * 0.62));
        for (const [q, r] of ringCells) { if (fits(c, q, r)) { found = [q, r]; break; } }
      }
      c.oq = found[0]; c.or = found[1];
      stamp(c, true);
      placed.push(c);
    });
    // gravity: pull every continent toward the common centre while the sea channels allow it
    for (let round = 0; round < 40; round++) {
      let moved = false;
      let gx = 0, gy = 0, gn = 0;
      placed.forEach((c) => { gx += hx(c.oq, c.or) * c.cells.length; gy += hy(c.oq, c.or) * c.cells.length; gn += c.cells.length; });
      gx /= gn; gy /= gn;
      placed.forEach((c) => {
        const an = anchors[c.id] || [0, 0];
        // aim at the centre, nudged toward the anchor direction so the arrangement keeps its shape
        const aimX = gx + an[0] * 2.2, aimY = gy + an[1] * 1.6;
        const d0 = Math.hypot(hx(c.oq, c.or) - aimX, hy(c.oq, c.or) - aimY);
        stamp(c, false);
        let best = null, bd = d0 - 0.05;
        DIRS.forEach((d) => {
          const q = c.oq + d[0], r = c.or + d[1];
          const dd = Math.hypot(hx(q, r) - aimX, hy(q, r) - aimY);
          if (dd < bd && fits(c, q, r)) { bd = dd; best = [q, r]; }
        });
        if (best) { c.oq = best[0]; c.or = best[1]; moved = true; }
        stamp(c, true);
      });
      if (!moved) break;
    }
    return conts.map((c) => ({ id: c.id, oq: c.oq, or: c.or }));
  }

  // ══ build the static model (shape is the same for every size class; only the arrangement changes) ═
  let SHAPES = null;
  function buildShapes(BP) {
    if (SHAPES) return SHAPES;
    SHAPES = BP.areas.map((a, ai) => {
      const doms = BP.domainsOf(a.id).map((d) => ({ id: d.id, size: BP.featuresOfDomain(d.id).length }));
      const n = doms.reduce((s, x) => s + x.size, 0);
      const blob = growBlob(n, ai * 7 + 3, 1.12);
      const domParts = partition(blob, doms, []);
      const cells = [];
      domParts.forEach((dp) => {
        const mods = BP.modulesOf(dp.id).map((m) => ({ id: m.id, size: BP.featuresOf(m.id).length }));
        const modParts = partition(dp.cells, mods, []);
        modParts.forEach((mp) => {
          const fs = BP.featuresOf(mp.id);
          const ordered = mp.cells.slice().sort((c1, c2) => (c1.r - c2.r) || (hx(c1.q, c1.r) - hx(c2.q, c2.r)));
          ordered.forEach((c, i) => cells.push({ q: c.q, r: c.r, fid: fs[i].id, mod: mp.id, dom: dp.id, area: a.id }));
        });
      });
      return { id: a.id, cells };
    });
    return SHAPES;
  }

  /** The world for one size class: cells with world positions, edges, coast loops, poles. */
  function buildWorld(BP, sizeClass) {
    const shapes = buildShapes(BP);
    const offs = arrange(shapes.map((s) => ({ id: s.id, cells: s.cells.map((c) => ({ q: c.q, r: c.r })) })), sizeClass);
    const offBy = new Map(offs.map((o) => [o.id, o]));
    const cells = [];
    const byKey = new Map();
    const byFid = new Map();
    shapes.forEach((s) => {
      const o = offBy.get(s.id);
      s.cells.forEach((c) => {
        const q = c.q + o.oq, r = c.r + o.or;
        const cell = { i: cells.length, q, r, x: hx(q, r), y: hy(q, r), fid: c.fid, mod: c.mod, dom: c.dom, area: c.area };
        cells.push(cell);
        byKey.set(key(q, r), cell);
        byFid.set(c.fid, cell);
      });
    });
    // edges: coast (land/sea), region (domain/domain), province (module/module)
    const coast = [], dom = [], mod = [];
    cells.forEach((c) => {
      DIRS.forEach((d, di) => {
        const n = byKey.get(key(c.q + d[0], c.r + d[1]));
        const e = [c.x + CORNER[di][0], c.y + CORNER[di][1], c.x + CORNER[(di + 1) % 6][0], c.y + CORNER[(di + 1) % 6][1], c.i, di];
        if (!n || n.area !== c.area) coast.push(e);
        else if (di < 3) { if (n.dom !== c.dom) dom.push(e); else if (n.mod !== c.mod) mod.push(e); }
      });
    });
    // per node: cells, bounds, pole
    const nodes = new Map();
    const nodeOf = (type, id) => { const k = type + ':' + id; if (!nodes.has(k)) nodes.set(k, { type, id, cells: [] }); return nodes.get(k); };
    cells.forEach((c) => { nodeOf('area', c.area).cells.push(c); nodeOf('domain', c.dom).cells.push(c); nodeOf('module', c.mod).cells.push(c); });
    nodes.forEach((n) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      n.cells.forEach((c) => { x0 = Math.min(x0, c.x - SQ3 / 2); x1 = Math.max(x1, c.x + SQ3 / 2); y0 = Math.min(y0, c.y - 1); y1 = Math.max(y1, c.y + 1); });
      n.bounds = [x0, y0, x1, y1];
      const p = poleOf(n.cells);
      const pc = byKey.get(key(p.q, p.r));
      n.pole = { x: pc.x, y: pc.y, cell: pc };
      n.centroid = { x: p.cx, y: p.cy };
    });
    // coast loops per area: chain directed boundary edges, offset outwards, smooth
    const loops = [];
    BP.areas.forEach((a) => {
      const es = coast.filter((e) => cells[e[4]].area === a.id);
      const startAt = new Map();
      const pk = (x, y) => Math.round(x * 1000) + ':' + Math.round(y * 1000);
      es.forEach((e) => startAt.set(pk(e[0], e[1]), e));
      const used = new Set();
      es.forEach((e0) => {
        if (used.has(e0)) return;
        const pts = [];
        let e = e0;
        while (e && !used.has(e)) { used.add(e); pts.push([e[0], e[1]]); e = startAt.get(pk(e[2], e[3])); }
        if (pts.length > 2) loops.push({ area: a.id, raw: pts });
      });
    });
    loops.forEach((l) => {
      l.area2 = signedArea(l.raw);
      l.coast = chaikin(offsetLoop(l.raw, 0.3, l.area2), 3);
      l.ripple1 = offsetLoop(l.coast, 0.42, l.area2);
      l.ripple2 = offsetLoop(l.coast, 0.95, l.area2);
    });
    let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
    cells.forEach((c) => { X0 = Math.min(X0, c.x - 1.6); X1 = Math.max(X1, c.x + 1.6); Y0 = Math.min(Y0, c.y - 1.6); Y1 = Math.max(Y1, c.y + 1.6); });
    // centre of the graticule: the landmass centre
    return { sizeClass, cells, byKey, byFid, edges: { coast, dom, mod }, nodes, loops, bounds: [X0, Y0, X1, Y1], centre: [(X0 + X1) / 2, (Y0 + Y1) / 2] };
  }
  function signedArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  function offsetLoop(p, d, sgn) {
    const n = p.length, out = [];
    const dir = sgn > 0 ? -1 : 1; // outward side for this orientation
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      let n1x = (b[1] - a[1]), n1y = -(b[0] - a[0]); const l1 = Math.hypot(n1x, n1y) || 1; n1x /= l1; n1y /= l1;
      let n2x = (c[1] - b[1]), n2y = -(c[0] - b[0]); const l2 = Math.hypot(n2x, n2y) || 1; n2x /= l2; n2y /= l2;
      let mx = n1x + n2x, my = n1y + n2y; const lm = Math.hypot(mx, my) || 1; mx /= lm; my /= lm;
      const cos = Math.max(0.5, mx * n1x + my * n1y);
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

  W.BTerr = { buildWorld, buildShapes, growBlob, partition, hx, hy, DIRS, CORNER, SQ3, key, pixelToHex };
  if (typeof document === 'undefined' || !W.OK || !W.BP) return;

  // ══ app ════════════════════════════════════════════════════════════════════════════════════════
  // (continued below)
})();
