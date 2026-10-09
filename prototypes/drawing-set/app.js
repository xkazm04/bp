(function () {
'use strict';
var K0 = window.KETTLE;
if (!K0) { document.body.innerHTML = '<p style="color:#fff;padding:30px;font:16px sans-serif">Data file ../data/kettle.js did not load.</p>'; return; }

/* ================================================================== data (+ ?scale=N clone) */
var QS = new URLSearchParams(location.search);
var SCALE = Math.max(1, Math.min(8, parseInt(QS.get('scale'), 10) || 1));
var LINES = [['Studios', 'S'], ['Gyms', 'G'], ['Pools', 'P'], ['Clubs', 'C'], ['Dojos', 'D'], ['Climbing', 'K'], ['Dance', 'N'], ['Yoga', 'Y']];
function scaled(K, n) {
  var o = { product: K.product, lenses: K.lenses, stages: K.stages, people: K.people, milestones: K.milestones, domains: [], capabilities: [], features: [], activity: [], buildings: [] };
  for (var i = 0; i < n; i++) {
    var sf = '-' + LINES[i][1];
    var m = function (id) { return id + sf; };
    o.buildings.push({ i: i, name: 'Kettle ' + LINES[i][0], sf: sf });
    K.domains.forEach(function (d) { o.domains.push({ id: m(d.id), base: d.id, bld: i, name: d.name, summary: d.summary, capabilities: d.capabilities.map(m) }); });
    K.capabilities.forEach(function (c) { o.capabilities.push({ id: m(c.id), domain: m(c.domain), name: c.name, features: c.features.map(m) }); });
    K.features.forEach(function (f) {
      var g = JSON.parse(JSON.stringify(f));
      g.id = m(f.id); g.domain = m(f.domain); g.capability = m(f.capability);
      g.dependsOn = f.dependsOn.map(m); g.usedBy = f.usedBy.map(m); g.blockedBy = f.blockedBy.map(m);
      o.features.push(g);
    });
    K.activity.forEach(function (a) { var b = JSON.parse(JSON.stringify(a)); if (b.feature) b.feature = m(b.feature); o.activity.push(b); });
  }
  o.activity.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  o.snapshots = K.snapshots.map(function (s) { var c = {}; Object.keys(s.counts).forEach(function (k) { c[k] = s.counts[k] * n; }); return { week: s.week, counts: c, total: s.total * n }; });
  return o;
}
var K = SCALE > 1 ? scaled(K0, SCALE) : K0;
if (SCALE === 1) { K.buildings = [{ i: 0, name: 'Kettle', sf: '' }]; K.domains.forEach(function (d) { d.base = d.id; d.bld = 0; }); }

var AS_OF = K.product.asOf.slice(0, 10);
var F = {}, D = {}, C = {}, P = {}, MS = {};
K.features.forEach(function (f) { F[f.id] = f; });
K.domains.forEach(function (d) { D[d.id] = d; });
K.capabilities.forEach(function (c) { C[c.id] = c; });
K.people.forEach(function (p) { P[p.id] = p; });
K.milestones.forEach(function (m) { MS[m.id] = m; });
var NF = K.features.length;
var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

var STAGE_WORD = { live: 'Built', flagged: 'Partly open', 'in-review': 'Inspection', 'in-dev': 'Construction', specified: 'Proposed', idea: 'Future', deprecated: 'Demolish' };
var STAGE_PLAIN = { live: 'Live for every studio', flagged: 'Live for some studios, behind a switch', 'in-review': 'Built and waiting for review', 'in-dev': 'Being built', specified: 'Designed, not started', idea: 'An idea, not yet designed', deprecated: 'Being retired' };
var REV_DESC = { idea: 'Idea recorded', specified: 'Specified, drawn up', 'in-dev': 'Construction started', 'in-review': 'Submitted for inspection', flagged: 'Opened behind a flag', live: 'Opened to all studios', deprecated: 'Marked for demolition' };
var FLAGS = [
  ['ai-unreviewed-in-production', 'Built by an agent, live, no human review', 'Agent-built, unreviewed'],
  ['security-gap', 'Sensitive data, security review missing', 'Security gap'],
  ['incident', 'Incident in the last 30 days', 'Incident'],
  ['unmonitored', 'In production without alerting', 'No alerting'],
  ['blocked', 'Blocked by unfinished work', 'Blocked'],
  ['stalled', 'Stalled, no recent progress', 'Stalled'],
  ['priority-not-started', 'Must-have (P0), not started', 'P0 not started'],
  ['demand-waiting', 'Customers asking, not built yet', 'Customers waiting'],
  ['spec-drift', 'Built differently from the design', 'Off-spec']
];
var FLAGNO = {}; FLAGS.forEach(function (x, i) { FLAGNO[x[0]] = i; });
var SHEETS = [
  { k: 'general', no: 'G-001', nm: 'General', title: 'General arrangement', sub: 'What is built, what is drawn, where the trouble is', acc: '#d6ecff' },
  { k: 'business', no: 'B-101', nm: 'Business', title: 'Business · value & demand', sub: 'Value, customer requests, revenue link', acc: '#93f0c6' },
  { k: 'design', no: 'D-201', nm: 'Design', title: 'Design · finish & access', sub: 'How far design got; accessibility failures', acc: '#f2b6ff' },
  { k: 'development', no: 'S-301', nm: 'Structure', title: 'Structure · development', sub: 'Progress, agent authorship, human review', acc: '#8fd0ff' },
  { k: 'operations', no: 'M-401', nm: 'Services', title: 'Services · operations', sub: 'Rollout, alerting, latency and errors', acc: '#7ff0e0' },
  { k: 'security', no: 'F-501', nm: 'Fire/Life', title: 'Fire & life safety · security', sub: 'Data class as fire-rating hatch, review status', acc: '#ffa58a' },
  { k: 'quality', no: 'Q-601', nm: 'Inspect', title: 'Inspection · quality', sub: 'End-to-end tests passing, open P1 bugs', acc: '#cdbbff' }
];
var SHEET = {}; SHEETS.forEach(function (s) { SHEET[s.k] = s; });

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function addDays(d, n) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function dnum(d) { return Date.parse(d + 'T00:00:00Z') / 864e5; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function $(s) { return document.querySelector(s); }
function fmtD(d) { var m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']; return m[+d.slice(5, 7) - 1] + ' ' + d.slice(8, 10); }
function stageAt(f, d) {
  if (d >= AS_OF) return f.stage;
  if (f.created > d) return null;
  var s = null;
  for (var i = 0; i < f.history.length; i++) if (f.history[i].date <= d) s = f.history[i].stage;
  return s || 'idea';
}
var CLO = {};
function closure(id) {
  if (CLO[id]) return CLO[id];
  var seen = {}, q = [id], out = [];
  while (q.length) { var x = q.shift(); F[x].usedBy.forEach(function (u) { if (!seen[u] && u !== id) { seen[u] = 1; out.push(u); q.push(u); } }); }
  return (CLO[id] = out);
}
function pname(id) { return P[id] ? P[id].name : id; }
function isAgent(id) { return P[id] && P[id].kind === 'agent'; }
var WEEKS = K.snapshots.map(function (s) { return s.week; });
function revAt(d) { var r = 0; WEEKS.forEach(function (w, i) { if (w <= d) r = i + 1; }); return r || 1; }
function isLiveSt(s) { return s === 'live' || s === 'flagged'; }

/* ================================================================== state */
var S = { lens: 'general', open: null, t: AS_OF, blast: null, ga: false, delta: 7, hover: null, key: null, sel: null, hl: null };

/* ================================================================== text measure */
var FONT = '"IBM Plex Sans Condensed","Roboto Condensed","Arial Narrow","Segoe UI",system-ui,sans-serif';
var MONO = '"IBM Plex Mono",Consolas,"Courier New",monospace';
function fnt(sz, wt, fam) { return (wt || 500) + ' ' + sz + 'px ' + (fam || FONT); }
var mctx = document.createElement('canvas').getContext('2d');
var TWC = {};
function tw(t, f, ls) { var key = f + '|' + t, v = TWC[key]; if (v == null) { mctx.font = f; v = TWC[key] = mctx.measureText(t).width; } return v + (ls || 0) * t.length; }
var WRC = {};
/* word wrap; returns null if a word does not fit or more than maxL lines are needed (never truncates) */
function wrap(text, maxW, f, maxL, ls) {
  var key = text + '|' + Math.round(maxW) + '|' + f + '|' + maxL + '|' + (ls || 0);
  if (key in WRC) return WRC[key];
  var words = text.split(' '), lines = [], cur = '', ok = true;
  words.forEach(function (w) {
    if (tw(w, f, ls) > maxW) ok = false;
    var t = cur ? cur + ' ' + w : w;
    if (!cur || tw(t, f, ls) <= maxW) cur = t; else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  var r = ok && lines.length <= maxL ? lines : null;
  WRC[key] = r;
  return r;
}

/* ================================================================== wings (L0 sections), ordered left to right by when work started */
var WING_DEF = [
  { k: 'FND', name: 'Foundations', plain: 'What everything else stands on', doms: ['PLT', 'IAM'], art: 'PLT' },
  { k: 'OPS', name: 'Studio operations', plain: 'Running classes, day to day', doms: ['SCH', 'BKG', 'STU', 'INS'], art: 'SCH' },
  { k: 'MNY', name: 'Money', plain: 'Memberships, billing and payouts', doms: ['PAY'], art: 'PAY' },
  { k: 'MBR', name: 'Members & reach', plain: 'The member app, messages and growth', doms: ['MEM', 'COM', 'GRO'], art: 'MEM' },
  { k: 'FRN', name: 'Frontier', plain: 'Insight, integrations and the AI assistant', doms: ['ANA', 'INT', 'AIA'], art: 'AIA' }
];
(function () {
  var known = {}; WING_DEF.forEach(function (w) { w.doms.forEach(function (d) { known[d] = 1; }); });
  K0.domains.forEach(function (d) { if (!known[d.id]) WING_DEF[WING_DEF.length - 1].doms.push(d.id); });
  WING_DEF.forEach(function (w) {
    var fs = K0.features.filter(function (f) { return w.doms.indexOf(f.domain) >= 0; });
    var ds = fs.map(function (f) { return dnum(f.created); }).sort(function (a, b) { return a - b; });
    w.median = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
    w.first = ds.length ? ds[0] : 0;
  });
  WING_DEF.sort(function (a, b) { return a.median - b.median; });
  WING_DEF.forEach(function (w, i) { w.letter = String.fromCharCode(65 + i); });
})();
function dateOf(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }

/* ================================================================== layout (world units) */
var TW = 160, TH = 76, G = 10, BH = 46, RH = 72, PAD = 16, BB = 12;
var BLDS = [], WINGS = [], ROOMS = [], BAYS = [], TILES = [], ROOM = {}, BAY = {}, TILE = {}, WINGOF = {};
function bayH(n, c) { var r = Math.ceil(n / c); return BH + r * TH + (r - 1) * G + BB; }
function wingW(c) { return 2 * PAD + c * TW + (c - 1) * G; }
function roomH(d, c) { return RH + d.capabilities.reduce(function (a, id) { return a + bayH(C[id].features.length, c); }, 0) + PAD; }
function byCreated(a, b) { return a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1; }
function layoutBuilding(b, ox, oy) {
  var doms = K.domains.filter(function (d) { return d.bld === b.i; });
  var wings = WING_DEF.map(function (def) { return { def: def, doms: def.doms.map(function (base) { return doms.filter(function (d) { return d.base === base; })[0]; }).filter(Boolean) }; }).filter(function (w) { return w.doms.length; });
  var best = null;
  for (var Ht = 500; Ht <= 2600; Ht += 20) {
    var cs = [], hs = [], W = 0, Hm = 0;
    wings.forEach(function (w) {
      var bc = null;
      for (var c = 3; c <= 6; c++) { var h = w.doms.reduce(function (a, d) { return a + roomH(d, c); }, 0), sc = Math.abs(h - Ht) + c * 8; if (!bc || sc < bc.sc) bc = { c: c, h: h, sc: sc }; }
      cs.push(bc.c); hs.push(bc.h); W += wingW(bc.c); Hm = Math.max(Hm, bc.h);
    });
    var mean = hs.reduce(function (a, b) { return a + b; }, 0) / hs.length, sd = Math.sqrt(hs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / hs.length);
    var sc = Math.abs(Math.log(W / Hm / 2.05)) + 0.8 * sd / Hm;
    if (!best || sc < best.sc - 1e-9) best = { sc: sc, cs: cs, hs: hs, W: W, Hm: Hm };
  }
  var B = { id: 'B' + b.i, i: b.i, name: b.name, x: ox, y: oy, w: 0, h: best.Hm, wings: [], feats: [] };
  var x = ox;
  wings.forEach(function (w, wi) {
    var c = best.cs[wi], ww = wingW(c), y = oy;
    var Wg = { id: b.i + ':' + w.def.k, def: w.def, bld: B, x: x, y: oy, w: ww, h: best.hs[wi], rooms: [], feats: [], cols: c };
    w.doms.forEach(function (d) {
      var rh = roomH(d, c);
      var R = { id: d.id, d: d, wing: Wg, x: x, y: y, w: ww, h: rh, bays: [], feats: [] };
      var by = y + RH, idx = 0;
      d.capabilities.forEach(function (cid) {
        var cap = C[cid], bh = bayH(cap.features.length, c);
        var Bay = { id: cid, cap: cap, room: R, x: x + PAD, y: by, w: ww - 2 * PAD, h: bh, tiles: [], feats: [] };
        cap.features.map(function (id) { return F[id]; }).sort(byCreated).forEach(function (f, i) {
          var T = { id: f.id, f: f, bay: Bay, room: R, wing: Wg, x: Bay.x + (i % c) * (TW + G), y: by + BH + Math.floor(i / c) * (TH + G), w: TW, h: TH, idx: ++idx };
          Bay.tiles.push(T); TILE[f.id] = T; TILES.push(T);
          Bay.feats.push(f); R.feats.push(f); Wg.feats.push(f); B.feats.push(f);
        });
        R.bays.push(Bay); BAY[cid] = Bay; BAYS.push(Bay); by += bh;
      });
      Wg.rooms.push(R); ROOM[d.id] = R; ROOMS.push(R); WINGOF[d.id] = Wg;
      y += rh;
    });
    B.wings.push(Wg); WINGS.push(Wg); x += ww;
  });
  B.w = x - ox;
  BLDS.push(B);
  return B;
}
var WORLD;
(function layout() {
  var first = layoutBuilding(K.buildings[0], 0, 0);
  var cols = SCALE <= 2 ? SCALE : SCALE <= 4 ? 2 : 3, GX = 360, GY = 620;
  for (var i = 1; i < K.buildings.length; i++) layoutBuilding(K.buildings[i], (i % cols) * (first.w + GX), Math.floor(i / cols) * (first.h + GY));
  var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  BLDS.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  WORLD = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})();
var WALK = ROOMS.slice();

/* ================================================================== canvas + camera */
var FW = 940, FH = 614, SC = 1, RES = 1;
var cv = $('#map'), ctx = cv.getContext('2d');
var cam = { x: 0, y: 0, k: 0.3 }, anim = null, wz = null, raf = 0, KMIN = 0.05, KMAX = 2.4;
function sxw(x) { return FW / 2 + (x - cam.x) * cam.k; }
function syw(y) { return FH / 2 + (y - cam.y) * cam.k; }
function wxs(x) { return cam.x + (x - FW / 2) / cam.k; }
function wys(y) { return cam.y + (y - FH / 2) / cam.k; }
var PADS = { site: { t: SCALE > 1 ? 74 : 100, r: 22, b: 70, l: 22 }, bld: { t: 170, r: 26, b: 50, l: 26 }, wing: { t: 100, r: 26, b: 46, l: 26 }, room: { t: 22, r: 22, b: 46, l: 22 }, bay: { t: 30, r: 30, b: 50, l: 30 } };
function fitCam(box, pad, over) {
  var kx = (FW - pad.l - pad.r) / box.w, ky = (FH - pad.t - pad.b) / box.h;
  var k = clamp(Math.min(kx, ky * (over || 1)), KMIN, KMAX), h = Math.min(box.h, (FH - pad.t - pad.b) / k);
  return { x: box.x + box.w / 2 - (pad.l - pad.r) / 2 / k, y: box.y + h / 2 - (pad.t - pad.b) / 2 / k, k: k };
}
var OVER = { bld: 1, wing: 1.8, room: 1.3, bay: 1 };
var HOME = fitCam(WORLD, PADS.site);
KMIN = HOME.k * 0.8;
function ease(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
function easeOut(u) { return 1 - Math.pow(1 - u, 3); }
function flyTo(t, dur) {
  wz = null;
  t = { x: t.x, y: t.y, k: clamp(t.k, KMIN, KMAX) };
  if (reduced || dur === 0) { cam = t; anim = null; dirty(); return; }
  var a = { x: cam.x, y: cam.y, k: cam.k };
  var dist = Math.hypot(t.x - a.x, t.y - a.y) * Math.min(a.k, t.k) / FW, zr = Math.abs(Math.log(t.k / a.k));
  anim = { a: a, b: t, t0: performance.now(), dur: dur || clamp(520 + dist * 260 + zr * 170, 520, 1150), bump: clamp(dist * 0.45, 0, 0.9) };
  dirty();
}
function stepCam(now) {
  if (anim) {
    var u = Math.min(1, (now - anim.t0) / anim.dur), a = anim.a, b = anim.b;
    var zin = b.k > a.k, ec = zin ? easeOut(u) : ease(u), ez = zin ? ease(u) : easeOut(u);
    var k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * ez) / (1 + anim.bump * Math.sin(Math.PI * u));
    cam = { x: a.x + (b.x - a.x) * ec, y: a.y + (b.y - a.y) * ec, k: k };
    if (u >= 1) { cam = b; anim = null; }
  }
  if (wz) {
    var nk = cam.k + (wz.k - cam.k) * 0.28;
    if (Math.abs(nk - wz.k) / wz.k < 0.003) nk = wz.k;
    cam.k = nk; cam.x = wz.wx - (wz.px - FW / 2) / nk; cam.y = wz.wy - (wz.py - FH / 2) / nk;
    if (nk === wz.k) wz = null;
  }
  // keep something on screen
  var m = 120 / cam.k;
  cam.x = clamp(cam.x, WORLD.x - FW / 2 / cam.k + m, WORLD.x + WORLD.w + FW / 2 / cam.k - m);
  cam.y = clamp(cam.y, WORLD.y - FH / 2 / cam.k + m, WORLD.y + WORLD.h + FH / 2 / cam.k - m);
}
function zoomAt(px, py, f) {
  anim = null;
  var k0 = wz ? wz.k : cam.k;
  wz = { k: clamp(k0 * f, KMIN, KMAX), px: px, py: py, wx: wxs(px), wy: wys(py) };
  if (reduced) { stepCam(0); while (wz) stepCam(0); }
  dirty();
}
function dirty() { if (!raf) raf = requestAnimationFrame(frame); }

/* ================================================================== patterns (screen-space hatches, anchored to the world) */
var PAT = {};
function mkPat(name, s, fn) {
  var c = document.createElement('canvas'), r = RES;
  c.width = Math.max(1, Math.round(s * r)); c.height = c.width;
  var g = c.getContext('2d'); g.scale(c.width / s, c.width / s); fn(g, s);
  var p = ctx.createPattern(c, 'repeat'); PAT[name] = { p: p, s: s, r: c.width / s };
}
function diag(g, s, col, lw, dir) {
  g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
  if (dir < 0) { g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(-1, s - 1); g.lineTo(1, s + 1); g.moveTo(s - 1, -1); g.lineTo(s + 1, 1); }
  else { g.moveTo(0, s); g.lineTo(s, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1); }
  g.stroke();
}
function makePatterns() {
  mkPat('hS', 7, function (g, s) { diag(g, s, 'rgba(214,236,255,.6)', 1, 1); });
  mkPat('hX', 5, function (g, s) { diag(g, s, 'rgba(214,236,255,.55)', 0.8, 1); diag(g, s, 'rgba(214,236,255,.55)', 0.8, -1); });
  mkPat('sPay', 4, function (g, s) { g.fillStyle = 'rgba(255,120,95,.16)'; g.fillRect(0, 0, s, s); diag(g, s, 'rgba(255,143,120,.9)', 0.9, 1); diag(g, s, 'rgba(255,143,120,.9)', 0.9, -1); });
  mkPat('sPer', 6, function (g, s) { diag(g, s, 'rgba(255,194,176,.62)', 1, -1); });
  mkPat('sInt', 6, function (g, s) { g.fillStyle = 'rgba(214,236,255,.55)'; g.beginPath(); g.arc(3, 3, 0.9, 0, 7); g.fill(); });
  mkPat('dSk', 9, function (g, s) { diag(g, s, 'rgba(242,182,255,.45)', 0.8, 1); });
  mkPat('dWf', 5, function (g, s) { diag(g, s, 'rgba(242,182,255,.55)', 0.8, 1); });
  mkPat('dHf', 4.5, function (g, s) { diag(g, s, 'rgba(242,182,255,.6)', 0.75, 1); diag(g, s, 'rgba(242,182,255,.6)', 0.75, -1); });
  mkPat('qF', 4, function (g, s) { g.fillStyle = 'rgba(255,93,79,.18)'; g.fillRect(0, 0, s, s); diag(g, s, '#ff5d4f', 1, 1); });
  mkPat('poche', 5, function (g, s) { g.fillStyle = '#0c2f57'; g.fillRect(0, 0, s, s); diag(g, s, 'rgba(214,236,255,.75)', 1.1, 1); });
}
function anchorPatterns() {
  var ox = sxw(0), oy = syw(0);
  Object.keys(PAT).forEach(function (k) {
    var P_ = PAT[k], s = P_.s;
    if (P_.p && P_.p.setTransform) P_.p.setTransform(new DOMMatrix([1 / P_.r, 0, 0, 1 / P_.r, ((ox % s) + s) % s, ((oy % s) + s) % s]));
  });
}
function pat(n) { return PAT[n].p; }

/* ================================================================== aggregates */
function counts(fs) {
  var c = { n: fs.length, live: 0, flagged: 0, build: 0, paper: 0, dep: 0, none: 0, bad: 0, watch: 0, good: 0, na: 0, chg: 0 };
  var from = addDays(S.t, -S.delta);
  fs.forEach(function (f) {
    var s = stageAt(f, S.t);
    if (!s) c.none++; else if (s === 'live') c.live++; else if (s === 'flagged') c.flagged++; else if (s === 'in-dev' || s === 'in-review') c.build++; else if (s === 'deprecated') c.dep++; else c.paper++;
    if (S.t === AS_OF && s) c[lensHealth(f)]++;
    if (deltaWin(f, from)) c.chg++;
  });
  return c;
}
function lensHealth(f) { return S.lens === 'general' ? f.health : f[S.lens].health; }
function deltaWin(f, from) {
  from = from || addDays(S.t, -S.delta);
  for (var i = f.history.length - 1; i >= 0; i--) { var h = f.history[i]; if (h.date > from && h.date <= S.t) return h; }
  return null;
}
function lensFact(fs) {
  var L = S.lens, n = function (fn) { return fs.filter(fn).length; };
  if (S.t !== AS_OF) return null;
  if (L === 'business') { var rq = fs.reduce(function (a, f) { return a + (f.business.customerRequests30d || 0); }, 0); return [rq + ' customer asks', n(function (f) { return f.business.value >= 4; }) + ' high value']; }
  if (L === 'design') return [n(function (f) { return f.design.a11y === 'fail'; }) + ' fail accessibility', n(function (f) { return f.design.status === 'none' && f.stage !== 'idea'; }) + ' without design'];
  if (L === 'development') return [n(function (f) { return f.development.humanReviewed === false; }) + ' not human-reviewed', Math.round(fs.reduce(function (a, f) { return a + f.development.aiAuthoredPct; }, 0) / Math.max(1, fs.length)) + '% by agents'];
  if (L === 'operations') return [n(function (f) { return f.operations.environment === 'production' && !f.operations.alerting; }) + ' live without alerting', n(function (f) { return f.operations.incidents30d > 0; }) + ' with incidents'];
  if (L === 'security') return [n(function (f) { return f.security.dataClass === 'payment' || f.security.dataClass === 'personal'; }) + ' touch card or personal data', n(function (f) { return f.flags.indexOf('security-gap') >= 0; }) + ' review gaps'];
  if (L === 'quality') return [n(function (f) { return f.quality.status === 'failing'; }) + ' failing tests', fs.reduce(function (a, f) { return a + f.quality.openBugs.p1; }, 0) + ' open P1 bugs'];
  return null;
}
function aggLine(fs, short) {
  var c = counts(fs), parts;
  var lf = lensFact(fs);
  if (lf) parts = [c.n + (short ? '' : ' features')].concat(lf);
  else parts = [c.n + (short ? '' : ' features'), (c.live + c.flagged) + ' live', c.build + ' building', c.paper + ' on paper'];
  return { parts: parts, trouble: S.t === AS_OF ? c.bad : 0, c: c };
}
var GOOD = 'rgba(214,236,255,.62)';
function barSegs(c) {
  if (S.lens === 'general' || S.t !== AS_OF) return [[c.live, 'rgba(214,236,255,.85)'], [c.flagged, 'rgba(214,236,255,.5)'], [c.build, 'hatch'], [c.paper + c.none, 'rgba(214,236,255,.08)'], [c.dep, 'rgba(255,93,79,.4)']];
  return [[c.good, GOOD], [c.watch, '#ffc35a'], [c.bad, '#ff5d4f'], [c.na, 'rgba(214,236,255,.12)']];
}

/* ================================================================== drawing helpers */
function cloud(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x, y);
  function edge(x0, y0, x1, y1) {
    var len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / (r * 2.2))), nx = (y1 - y0) / len, ny = -(x1 - x0) / len;
    for (var i = 1; i <= n; i++) {
      var ax = x0 + (x1 - x0) * (i - 1) / n, ay = y0 + (y1 - y0) * (i - 1) / n, bx = x0 + (x1 - x0) * i / n, by = y0 + (y1 - y0) * i / n;
      ctx.quadraticCurveTo((ax + bx) / 2 + nx * r * 1.5, (ay + by) / 2 + ny * r * 1.5, bx, by);
    }
  }
  edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
  ctx.closePath();
}
function text(t, x, y, f, col, halo, ls) {
  ctx.font = f;
  if ('letterSpacing' in ctx) ctx.letterSpacing = (ls || 0) + 'px';
  if (halo) { ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = halo; ctx.strokeText(t, x, y); }
  ctx.fillStyle = col; ctx.fillText(t, x, y);
  if (ls && 'letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
function drawBar(x, y, w, h, c) {
  var segs = barSegs(c), tot = segs.reduce(function (a, s) { return a + s[0]; }, 0) || 1, xx = x;
  segs.forEach(function (s) {
    var sw = w * s[0] / tot; if (sw <= 0) return;
    if (s[1] === 'hatch') { ctx.fillStyle = 'rgba(214,236,255,.12)'; ctx.fillRect(xx, y, sw, h); ctx.fillStyle = pat('hS'); ctx.fillRect(xx, y, sw, h); }
    else { ctx.fillStyle = s[1]; ctx.fillRect(xx, y, sw, h); }
    xx += sw;
  });
  ctx.strokeStyle = 'rgba(214,236,255,.55)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
function partsFit(parts, maxW, f) {
  var p = parts.slice();
  while (p.length > 1 && tw(p.join(' · '), f) > maxW) p.pop();
  return tw(p.join(' · '), f) <= maxW ? p.join(' · ') : null;
}

/* ================================================================== tile painting */
var dimFn = null;
function tileEvidence(f, st) {
  var L = S.lens;
  if (S.t !== AS_OF || !st) return [STAGE_WORD[st] ? STAGE_WORD[st].toUpperCase() : 'NOT YET DRAWN'];
  if (L === 'general') {
    var w = STAGE_WORD[st].toUpperCase();
    if (st === 'flagged' && f.operations.flag) return [w, f.operations.flag.rolloutPct + '%'];
    if (st === 'in-dev') return [w, f.development.progressPct + '%'];
    return [w];
  }
  if (L === 'business') { var b = f.business; return ['VALUE ' + b.value, b.customerRequests30d ? b.customerRequests30d + ' ASKS' : null, b.revenueLink === 'direct' ? '$' : null].filter(Boolean); }
  if (L === 'design') return [{ none: 'NO DESIGN', sketch: 'SKETCH', wireframe: 'WIREFRAME', 'hi-fi': 'HI-FI', implemented: 'BUILT', polished: 'POLISHED', 'n/a': 'N/A' }[f.design.status], f.design.a11y === 'fail' ? 'A11Y FAIL' : null].filter(Boolean);
  if (L === 'development') { var dv = f.development; return [dv.progressPct < 100 ? dv.progressPct + '%' : null, 'AI ' + dv.aiAuthoredPct + '%', dv.unitCoveragePct != null && dv.progressPct > 0 ? 'COV ' + dv.unitCoveragePct : null].filter(Boolean); }
  if (L === 'operations') { var op = f.operations; if (op.environment !== 'production') return [op.environment === 'none' ? 'NOT DEPLOYED' : op.environment.toUpperCase()]; return [(op.flag ? op.flag.rolloutPct : 100) + '%', op.p95ms != null ? op.p95ms + 'MS' : null, op.errorRatePct != null ? op.errorRatePct + '% ERR' : null].filter(Boolean); }
  if (L === 'security') { var se = f.security; return [se.dataClass.toUpperCase(), { 'not-required': 'NO REVIEW NEEDED', 'not-started': 'NO REVIEW', pending: 'PENDING', passed: 'PASSED', findings: se.openFindings + ' FINDINGS' }[se.review]]; }
  var q = f.quality; return [q.e2eTests ? q.e2ePassing + '/' + q.e2eTests + ' E2E' : (isLiveSt(st) ? 'NO E2E' : 'UNTESTED'), q.openBugs.p1 ? q.openBugs.p1 + ' P1' : null].filter(Boolean);
}
function tileStamp(f, st) {
  if (S.t !== AS_OF || !st) return null;
  var L = S.lens;
  if (L === 'development' && f.development.humanReviewed === false) return 'No human review';
  if (L === 'operations' && f.operations.environment === 'production' && !f.operations.alerting) return 'No alerting';
  if (L === 'security' && (f.security.dataClass === 'payment' || f.security.dataClass === 'personal') && (f.security.review === 'not-started' || f.security.review === 'pending') && isLiveSt(st)) return 'Live, unreviewed';
  if (L === 'design' && f.design.a11y === 'fail') return 'Fails accessibility';
  if (L === 'quality' && f.quality.status === 'failing') return 'Tests failing';
  if (L === 'general' || L === 'development') {
    if (f.flags.length) return FLAGS[FLAGNO[f.flags.slice().sort(function (a, b) { return FLAGNO[a] - FLAGNO[b]; })[0]]][2] + (f.flags.length > 1 ? ' +' + (f.flags.length - 1) : '');
  }
  if (f.flags.length && L !== 'general') return null;
  return null;
}
function lensFill(f, st, x, y, w, h) {
  var L = S.lens;
  if (L === 'general' || S.t !== AS_OF || !st) {
    if (st === 'live') { ctx.fillStyle = 'rgba(214,236,255,.22)'; ctx.fillRect(x, y, w, h); }
    else if (st === 'flagged') {
      var p = f.stage === 'flagged' && f.operations.flag && S.t === AS_OF ? f.operations.flag.rolloutPct : 50;
      ctx.fillStyle = 'rgba(214,236,255,.3)'; ctx.fillRect(x, y, w * p / 100, h);
      ctx.strokeStyle = '#d6ecff'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x + w * p / 100, y); ctx.lineTo(x + w * p / 100, y + h); ctx.stroke(); ctx.setLineDash([]);
    } else if (st === 'in-review') { ctx.fillStyle = pat('hX'); ctx.fillRect(x, y, w, h); }
    else if (st === 'in-dev') {
      ctx.fillStyle = pat('hS'); ctx.fillRect(x, y, w, h);
      if (S.t === AS_OF) { var bh = clamp(h * 0.07, 2, 5); ctx.fillStyle = '#d6ecff'; ctx.fillRect(x, y + h - bh, w * f.development.progressPct / 100, bh); }
    } else if (st === 'deprecated') { ctx.strokeStyle = 'rgba(214,236,255,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke(); }
    return;
  }
  if (L === 'business') {
    var v = f.business.value;
    ctx.fillStyle = 'rgba(147,240,198,' + (0.04 + v * 0.075).toFixed(2) + ')'; ctx.fillRect(x, y, w, h);
    var lw = clamp(v * 0.9 * Math.min(1, w / 60), 0.6, 5); ctx.strokeStyle = 'rgba(147,240,198,.8)'; ctx.lineWidth = lw; ctx.strokeRect(x + lw / 2 + 1, y + lw / 2 + 1, w - lw - 2, h - lw - 2);
  } else if (L === 'design') {
    var fl = { sketch: 'dSk', wireframe: 'dWf', 'hi-fi': 'dHf' }[f.design.status];
    if (fl) { ctx.fillStyle = pat(fl); ctx.fillRect(x, y, w, h); }
    else if (f.design.status === 'implemented' || f.design.status === 'polished') { ctx.fillStyle = f.design.status === 'polished' ? 'rgba(242,182,255,.36)' : 'rgba(242,182,255,.2)'; ctx.fillRect(x, y, w, h); }
  } else if (L === 'development') {
    var dv = f.development, ph = h * dv.progressPct / 100;
    ctx.fillStyle = 'rgba(143,208,255,.3)'; ctx.fillRect(x, y + h - ph, w, ph);
    var aw = clamp(w * 0.04, 2, 5); ctx.fillStyle = '#8fd0ff'; ctx.fillRect(x + w - aw - 2, y + h - h * dv.aiAuthoredPct / 100, aw, h * dv.aiAuthoredPct / 100);
  } else if (L === 'operations') {
    var op = f.operations;
    if (op.environment === 'production') { var rp = op.flag ? op.flag.rolloutPct : 100; ctx.fillStyle = 'rgba(127,240,224,.26)'; ctx.fillRect(x, y, w * rp / 100, h); }
    else if (op.environment === 'staging' || op.environment === 'preview') { ctx.fillStyle = pat('sInt'); ctx.fillRect(x, y, w, h); }
  } else if (L === 'security') {
    var pf = { payment: 'sPay', personal: 'sPer', internal: 'sInt' }[f.security.dataClass];
    if (pf) { ctx.fillStyle = pat(pf); ctx.fillRect(x, y, w, h); }
  } else if (L === 'quality') {
    var q = f.quality;
    if (q.e2eTests > 0) { var pp = q.e2ePassing / q.e2eTests; ctx.fillStyle = 'rgba(205,187,255,.28)'; ctx.fillRect(x, y, w * pp, h); if (pp < 1) { ctx.fillStyle = pat('qF'); ctx.fillRect(x + w * pp, y, w * (1 - pp), h); } }
  }
  if (st === 'deprecated') { ctx.strokeStyle = 'rgba(214,236,255,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke(); }
}
function paintTile(T, alphaMul) {
  var f = T.f, k = cam.k, x = sxw(T.x), y = syw(T.y), w = T.w * k, h = T.h * k;
  if (x > FW + 10 || y > FH + 10 || x + w < -10 || y + h < -10) return;
  var st = stageAt(f, S.t), now = S.t === AS_OF;
  var a = (dimFn && !dimFn(f) ? 0.13 : 1) * (alphaMul == null ? 1 : alphaMul);
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  if (S.blast) {
    var bl = closure(S.blast);
    if (F[S.blast].usedBy.indexOf(f.id) >= 0) { ctx.fillStyle = 'rgba(255,93,79,.5)'; ctx.fillRect(x, y, w, h); }
    else if (bl.indexOf(f.id) >= 0) { ctx.fillStyle = 'rgba(255,93,79,.22)'; ctx.fillRect(x, y, w, h); }
  }
  lensFill(f, st, x, y, w, h);
  // outline encodes stage
  ctx.strokeStyle = '#d6ecff'; ctx.lineWidth = w < 30 ? 1 : 1.4;
  if (!st) { ctx.globalAlpha = a * 0.35; ctx.setLineDash([1, 3]); }
  else if (st === 'specified') ctx.setLineDash([5, 3]);
  else if (st === 'idea') { ctx.setLineDash([1.5, 2.5]); ctx.globalAlpha = a * 0.8; }
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.setLineDash([]); ctx.globalAlpha = a;
  if (S.blast === f.id) { ctx.strokeStyle = '#ff5d4f'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h); }
  if (st && now) {
    var hl = lensHealth(f);
    if (hl === 'bad') { ctx.strokeStyle = '#ff5d4f'; ctx.lineWidth = w < 40 ? 1.3 : 1.7; ctx.lineJoin = 'round'; var r = clamp(w / 14, 2.4, 6); cloud(x - r * 0.8, y - r * 0.8, w + r * 1.6, h + r * 1.6, r); ctx.stroke(); }
    else if (hl === 'watch' && w >= 22) { ctx.strokeStyle = '#ffc35a'; ctx.lineWidth = 2; ctx.lineCap = 'round'; var tx = x + w - 12; ctx.beginPath(); ctx.moveTo(tx, y - 2); ctx.lineTo(tx + 4, y - 7); ctx.moveTo(tx + 5, y - 2); ctx.lineTo(tx + 9, y - 7); ctx.stroke(); ctx.lineCap = 'butt'; }
  }
  var dl = deltaWin(f);
  if (dl && st) { var ds = clamp(w / 9, 4, 8); ctx.fillStyle = '#9fe8ff'; ctx.beginPath(); ctx.moveTo(x + w + 1, y - ds * 1.2); ctx.lineTo(x + w + 1 + ds * 0.7, y + ds * 0.3); ctx.lineTo(x + w + 1 - ds * 0.7, y + ds * 0.3); ctx.closePath(); ctx.fill(); }
  if (st && now && f.development.humanReviewed === false && (S.lens === 'general' || S.lens === 'development') && w < 150 && w >= 26) {
    var dx = x + w - 7, dy = y + h - 7, dd = clamp(w / 28, 2.5, 4.5); ctx.strokeStyle = '#d6ecff'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(dx, dy - dd); ctx.lineTo(dx + dd * 0.8, dy); ctx.lineTo(dx, dy + dd); ctx.lineTo(dx - dd * 0.8, dy); ctx.closePath(); ctx.stroke();
  }
  // text, by level of detail. Never shrunk below 12 px and never cut: if it does not fit, it waits for a closer zoom.
  ctx.textBaseline = 'alphabetic';
  if (w >= 150 && h >= 64) {
    var ns = clamp(13.5 + (w - 150) / 60, 14, 17), lh = ns * 1.16, mono = fnt(12, 500, MONO);
    var ev = tileEvidence(f, st), idw = tw(f.id, mono);
    var evs = partsFit(ev, w - 16 - idw - 10, mono), showId = true;
    if (evs == null) { evs = partsFit(ev, w - 14, mono); showId = false; }
    if (showId) text(f.id, x + 7, y + 16, mono, 'rgba(214,236,255,.7)');
    if (evs) { ctx.textAlign = 'right'; text(evs, x + w - 7, y + 16, mono, S.lens === 'general' ? '#d6ecff' : SHEET[S.lens].acc); ctx.textAlign = 'left'; }
    var stamp = tileStamp(f, st), hasB = !!stamp, room = h - 24 - (hasB ? 20 : 6);
    var nf = fnt(ns, 500), lines = wrap(f.name, w - 14, nf, Math.max(1, Math.floor(room / lh)));
    if (!lines) { ns = 14; nf = fnt(14, 500); lh = 16.2; lines = wrap(f.name, w - 14, nf, Math.max(1, Math.floor(room / lh))); }
    if (lines) lines.forEach(function (l, i) { text(l, x + 7, y + 22 + lh * (i + 0.82), nf, '#ffffff'); });
    if (stamp) { var sf = fnt(12.5, 600), sfit = partsFit([stamp], w - 14, sf); if (sfit) text(sfit, x + 7, y + h - 7, sf, '#ff8c80'); }
  } else if (w >= 100 && h >= 44) {
    var nf2 = fnt(13, 500), lines2 = wrap(f.name, w - 12, nf2, Math.floor((h - 8) / 15));
    if (lines2) { var top = y + (h - lines2.length * 15) / 2; lines2.forEach(function (l, i) { text(l, x + 6, top + 15 * (i + 0.78), nf2, '#ffffff'); }); }
  }
  ctx.globalAlpha = 1;
}

/* ================================================================== illustrations (stylised line art, one per domain) */
function gear(cx, cy, r, n) { var p = ''; for (var i = 0; i < n * 2; i++) { var a = i * Math.PI / n, rr = i % 2 ? r : r + 7, a2 = a + Math.PI / n * 0.5; p += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1) + 'L' + (cx + rr * Math.cos(a2)).toFixed(1) + ' ' + (cy + rr * Math.sin(a2)).toFixed(1); } return '<path d="' + p + 'Z"/><circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.38) + '"/>'; }
var ILLO = {
  IAM: '<circle cx="78" cy="88" r="32"/><circle cx="78" cy="88" r="11"/><path d="M110 82 H206 V94 H110 M176 94 v14 h8 v-8 h8 v12 h8 V94"/><path class="f" d="M60 40 h40 M80 30 v18"/>',
  STU: '<path d="M50 140 V60 H190 V140 Z M40 60 L120 26 L200 60"/><path d="M50 60 q10 12 20 0 q10 12 20 0 q10 12 20 0 q10 12 20 0 q10 12 20 0 q10 12 20 0 q10 12 20 0"/><rect x="104" y="96" width="32" height="44"/><rect x="62" y="88" width="30" height="26"/><rect x="148" y="88" width="30" height="26"/><path class="f" d="M70 46 h100"/>',
  SCH: '<rect x="30" y="40" width="150" height="100"/><path d="M30 60 H180 M67 40 V140 M105 40 V140 M142 40 V140 M30 87 H180 M30 113 H180"/><rect class="s" x="70" y="63" width="32" height="21"/><rect class="s" x="108" y="90" width="31" height="20"/><circle cx="190" cy="48" r="28" fill="#0b2a4d"/><path d="M190 48 V30 M190 48 L203 56"/>',
  BKG: '<path d="M40 50 H200 V78 a12 12 0 0 0 0 24 V130 H40 V102 a12 12 0 0 0 0 -24 Z"/><path class="f" d="M150 52 V128"/><path d="M70 90 l14 14 l28 -30"/><path class="f" d="M165 70 h22 M165 84 h22 M165 98 h16"/>',
  PAY: '<rect x="30" y="44" width="130" height="84" rx="8"/><path d="M30 64 H160"/><rect x="44" y="82" width="22" height="16" rx="2"/><path class="f" d="M44 112 h60"/><ellipse cx="190" cy="120" rx="26" ry="8"/><path d="M164 120 v-10 M216 120 v-10"/><ellipse cx="190" cy="110" rx="26" ry="8"/><path d="M164 110 v-10 M216 110 v-10"/><ellipse cx="190" cy="100" rx="26" ry="8"/>',
  MEM: '<rect x="88" y="16" width="66" height="128" rx="10"/><rect x="95" y="30" width="52" height="96"/><path d="M112 136 h18"/><path class="f" d="M101 44 h40 M101 58 h30 M101 72 h40 M101 86 h24"/><rect class="s" x="101" y="98" width="40" height="16"/><path d="M40 70 q20 -20 40 0 M180 70 q20 -20 40 0" opacity=".6"/>',
  INS: '<circle cx="110" cy="92" r="44"/><circle cx="110" cy="92" r="36"/><path d="M104 40 h12 v8 h-12z M110 92 L110 64 M110 92 L130 102"/><path d="M146 54 l8 -8"/><path class="f" d="M110 50 v6 M110 128 v6 M68 92 h6 M146 92 h6"/><path d="M170 120 q20 -6 34 6 q-6 16 -24 10 z"/>',
  COM: '<rect x="34" y="50" width="140" height="90"/><path d="M34 50 L104 102 L174 50 M34 140 L88 92 M174 140 L120 92"/><path d="M150 30 h66 v40 h-40 l-14 12 v-12 h-12 z"/><path class="f" d="M162 44 h42 M162 56 h30"/>',
  GRO: '<path d="M80 140 H160 L170 104 H70 Z"/><path d="M120 104 V50"/><path d="M120 76 q-34 -2 -40 -30 q34 0 40 30 M120 62 q30 -4 38 -30 q-32 2 -38 30"/><path class="f" d="M180 120 L210 60 M210 60 l-10 4 M210 60 l2 10"/>',
  ANA: '<path d="M36 26 V140 H210"/><rect x="56" y="100" width="20" height="40"/><rect x="88" y="80" width="20" height="60"/><rect x="120" y="90" width="20" height="50"/><rect class="s" x="152" y="56" width="20" height="84"/><path d="M50 96 L90 66 L130 78 L180 36" class="f"/><circle cx="180" cy="36" r="4"/>',
  INT: '<rect x="54" y="62" width="56" height="44" rx="6"/><path d="M110 74 h22 M110 94 h22 M54 84 H40 q-20 0 -20 30 V140"/><rect x="150" y="56" width="50" height="56" rx="6"/><path d="M150 72 h-10 M150 96 h-10"/><path class="f" d="M175 56 V36 M175 112 v20"/>',
  AIA: '<path d="M110 30 Q116 76 156 84 Q116 92 110 138 Q104 92 64 84 Q104 76 110 30 Z"/><path d="M176 40 q3 12 12 14 q-9 2 -12 14 q-3 -12 -12 -14 q9 -2 12 -14z"/><path d="M52 116 q2 8 8 10 q-6 2 -8 10 q-2 -8 -8 -10 q6 -2 8 -10z"/><ellipse class="f" cx="110" cy="84" rx="92" ry="36"/>',
  PLT: gear(96, 70, 30, 10) + gear(158, 92, 18, 8) + '<path d="M28 132 H212 M28 132 v14 h184 v-14"/><path class="f" d="M40 146 l10 -14 M60 146 l10 -14 M80 146 l10 -14 M100 146 l10 -14 M120 146 l10 -14 M140 146 l10 -14 M160 146 l10 -14 M180 146 l10 -14 M200 146 l10 -14"/>'
};
function illoSVG(base, col, sw) {
  var inner = (ILLO[base] || ILLO.PLT).replace(/class="f"/g, 'stroke-width="1" stroke-dasharray="3 3" opacity=".7"').replace(/class="s"/g, 'fill="' + col + '" fill-opacity=".25"');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><g fill="none" stroke="' + col + '" stroke-width="' + (sw || 1.7) + '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</g><path d="M14 150 H226 M14 146 v8 M226 146 v8" stroke="' + col + '" stroke-width=".7" opacity=".5"/></svg>';
}
var ART = {};
Object.keys(ILLO).forEach(function (k) { var im = new Image(); im.onload = dirty; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(illoSVG(k, '#d6ecff', 3)); ART[k] = im; });

/* ================================================================== the plan */
var introOn = false, introT0 = 0, INTRO_MS = 2300, introP = 1;
function drawGrid() {
  var k = cam.k;
  [[40, 0.045], [200, 0.09]].forEach(function (g) {
    var sp = g[0] * k; if (sp < 9) return;
    ctx.strokeStyle = 'rgba(150,200,255,' + (g[1] * clamp((sp - 9) / 12, 0, 1)).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.beginPath();
    var x0 = Math.floor(wxs(0) / g[0]) * g[0], y0 = Math.floor(wys(0) / g[0]) * g[0];
    for (var x = x0; sxw(x) < FW; x += g[0]) { var X = Math.round(sxw(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, FH); }
    for (var y = y0; syw(y) < FH; y += g[0]) { var Y = Math.round(syw(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(FW, Y); }
    ctx.stroke();
  });
}
function rectS(o) { return { x: sxw(o.x), y: syw(o.y), w: o.w * cam.k, h: o.h * cam.k }; }
function onScreen(r, m) { m = m || 0; return !(r.x > FW + m || r.y > FH + m || r.x + r.w < -m || r.y + r.h < -m); }
function drawBuilding(B) {
  var k = cam.k, br = rectS(B);
  if (!onScreen(br, 140)) return;
  var reveal = introOn ? br.x + (br.w + 40) * introP : 1e9;
  ctx.save();
  if (introOn) { ctx.beginPath(); ctx.rect(-10, -400, reveal + 10, FH + 800); ctx.clip(); }
  ctx.fillStyle = 'rgba(214,236,255,.03)'; B.wings.forEach(function (W) { var r = rectS(W); ctx.fillRect(r.x, r.y, r.w, r.h); });
  // hovered room / wing wash
  if (S.hover && S.hover.type !== 'tile') { var hr = rectS(S.hover.o); ctx.fillStyle = 'rgba(127,224,255,.07)'; ctx.fillRect(hr.x, hr.y, hr.w, hr.h); }
  // tiles
  B.wings.forEach(function (W) {
    if (!onScreen(rectS(W), 20)) return;
    W.rooms.forEach(function (R) {
      if (!onScreen(rectS(R), 20)) return;
      R.bays.forEach(function (Bay) {
        Bay.tiles.forEach(function (T) {
          var ia = 1;
          if (introOn) { var tx = sxw(T.x); ia = clamp((reveal - tx) / 90, 0, 1); }
          paintTile(T, ia);
        });
      });
    });
  });
  // bay partitions
  if (k > 0.12) {
    ctx.strokeStyle = 'rgba(214,236,255,.55)'; ctx.lineWidth = 1; ctx.beginPath();
    BAYS.forEach(function (Bay) { if (Bay.room.wing.bld !== B || Bay.y <= Bay.room.y + RH + 1) return; var X0 = sxw(Bay.room.x + 6), X1 = sxw(Bay.room.x + Bay.room.w - 6), Y = Math.round(syw(Bay.y - 2)) + 0.5; if (Y < -5 || Y > FH + 5) return; ctx.moveTo(X0, Y); ctx.lineTo(X1, Y); });
    ctx.stroke();
  }
  // walls: rooms (inner), wings (party walls), building (outer, poché)
  var wi = clamp(6 * k, 1.2, 6), ww = clamp(10 * k, 2, 10), wo = clamp(18 * k, 3.5, 18);
  ctx.strokeStyle = '#d6ecff';
  ctx.lineWidth = wi; B.wings.forEach(function (W) { W.rooms.forEach(function (R) { var r = rectS(R); ctx.strokeRect(r.x, r.y, r.w, r.h); }); });
  ctx.lineWidth = ww; B.wings.forEach(function (W) { var r = rectS(W); ctx.strokeRect(r.x, r.y, r.w, r.h); });
  outlinePath(B); ctx.lineWidth = wo; ctx.lineJoin = 'miter'; ctx.stroke();
  if (wo > 6) { ctx.lineWidth = wo - 4; ctx.strokeStyle = pat('poche'); ctx.stroke(); }
  ctx.restore();
  if (introOn && reveal < br.x + br.w + 30) {
    var g = ctx.createLinearGradient(reveal - 60, 0, reveal + 4, 0); g.addColorStop(0, 'rgba(127,224,255,0)'); g.addColorStop(1, 'rgba(127,224,255,.22)');
    ctx.fillStyle = g; ctx.fillRect(reveal - 60, br.y - 20, 64, br.h + 40);
    ctx.strokeStyle = '#bff3ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(reveal, br.y - 24); ctx.lineTo(reveal, br.y + br.h + 24); ctx.stroke();
  }
}
function outlinePath(B) {
  var ws = B.wings; ctx.beginPath();
  ctx.moveTo(sxw(B.x), syw(B.y)); ctx.lineTo(sxw(B.x + B.w), syw(B.y));
  for (var i = ws.length - 1; i >= 0; i--) { var W = ws[i]; ctx.lineTo(sxw(W.x + W.w), syw(W.y + W.h)); ctx.lineTo(sxw(W.x), syw(W.y + W.h)); }
  ctx.closePath();
}
/* labels: each level appears only when it can be drawn at a readable size; never shrunk below 12 px */
var HALO = 'rgba(7,26,51,.92)';
function labelAlpha() { return introOn ? clamp((introP - 0.75) / 0.25, 0, 1) : 1; }
function drawWingLabels(B) {
  var k = cam.k, minW = Math.min.apply(null, B.wings.map(function (W) { return W.w * k; }));
  var a = clamp((minW - 116) / 6, 0, 1) * labelAlpha();
  if (a <= 0) return 0;
  ctx.globalAlpha = a;
  var FS = 14, ML = 2, ok;
  for (var f1 = 22; f1 >= 14 && ML === 2; f1--) { ok = B.wings.every(function (W) { return wrap(W.def.name.toUpperCase(), W.w * k - 34, fnt(f1, 600), 1, f1 * 0.05); }); if (ok) { FS = f1; ML = 1; } }
  if (ML === 2) for (var f2 = 20; f2 >= 14; f2--) { ok = B.wings.every(function (W) { return wrap(W.def.name.toUpperCase(), W.w * k - 34, fnt(f2, 600), 2, f2 * 0.05); }); if (ok) { FS = f2; break; } }
  B.wings.forEach(function (W) {
    var r = rectS(W); if (r.x > FW || r.x + r.w < 0) return;
    var base = r.y - 10, x = r.x + 2, wdt = r.w - 4;
    if (base < -10 || base > FH + 90) return;
    var c = counts(W.feats);
    drawBar(x, base - 6, wdt, 7, c);
    var agg = aggLine(W.feats, false), af = fnt(13, 500), tr = agg.trouble ? tw(agg.trouble + ' in trouble', fnt(13, 600)) + 10 : 0, ag = partsFit(agg.parts, wdt - tr, af);
    if (ag && ag.indexOf('·') < 0) ag = partsFit(aggLine(W.feats, true).parts, wdt - tr, af) || ag;
    if (ag) text(ag, x, base - 14, af, '#d6ecff', HALO);
    if (agg.trouble) { ctx.textAlign = 'right'; text(agg.trouble + ' in trouble', x + wdt, base - 14, fnt(13, 600), '#ff8c80', HALO); ctx.textAlign = 'left'; }
    // illustration + letter + name
    var nx = x, nm = W.def.name.toUpperCase(), fs = FS, lines = wrap(nm, W.w * k - 34, fnt(fs, 600), ML, fs * 0.05);
    var ly = base - 36;
    ctx.beginPath(); ctx.arc(nx + 11, ly - 7, 11, 0, 7); ctx.fillStyle = '#0b2a4d'; ctx.fill(); ctx.strokeStyle = '#d6ecff'; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.textAlign = 'center'; text(W.def.letter, nx + 11, ly - 2.5, fnt(13, 500, MONO), '#d6ecff'); ctx.textAlign = 'left';
    if (lines) lines.slice().reverse().forEach(function (l, i) { text(l, nx + 28, ly - i * fs * 1.08, fnt(fs, 600), '#ffffff', HALO, fs * 0.05); });
  });
  ctx.globalAlpha = 1;
  return a;
}
function drawBuildingLabel(B, wingA) {
  if (SCALE === 1) return;
  var r = rectS(B); if (r.w < 150 || !onScreen(r, 200)) return;
  var base = r.y - 12 - (wingA > 0 ? 96 * wingA : 0), a = labelAlpha();
  ctx.globalAlpha = a;
  var c = counts(B.feats), wdt = Math.min(r.w, 520);
  drawBar(r.x, base - 6, wdt, 8, c);
  var agg = aggLine(B.feats, false), ag = partsFit(agg.parts, wdt - 90, fnt(14, 500));
  if (ag) text(ag, r.x, base - 15, fnt(14, 500), '#d6ecff', HALO);
  if (agg.trouble) { ctx.textAlign = 'right'; text(agg.trouble + ' in trouble', r.x + wdt, base - 15, fnt(14, 600), '#ff8c80', HALO); ctx.textAlign = 'left'; }
  var nm = B.name.toUpperCase(), fs = clamp(r.w / 14, 18, 30);
  text(nm, r.x, base - 36, fnt(fs, 600), '#ffffff', HALO, fs * 0.06);
  ctx.globalAlpha = 1;
}
function drawRoomLabels(B) {
  var k = cam.k, wingMin = Math.min.apply(null, B.wings.map(function (W) { return W.w * k; }));
  if (wingMin < 116) return;
  B.wings.forEach(function (W) {
    var minW = W.w * k, a = clamp((minW - 124) / 6, 0, 1) * labelAlpha();
    if (a <= 0) return;
    W.rooms.forEach(function (R) {
      var r = rectS(R); if (!onScreen(r)) return;
      ctx.globalAlpha = a;
      var hh = RH * k, fs = clamp(hh * 0.36, 14, 26), nm = R.d.name.toUpperCase(), maxW = r.w - 28;
      var ls = fs * 0.06, lines = wrap(nm, maxW, fnt(fs, 600), 2, ls);
      if (!lines && fs > 14) { fs = 14; ls = 0.8; lines = wrap(nm, maxW, fnt(14, 600), 2, ls); }
      if (!lines) { ctx.globalAlpha = 1; return; }
      var lh = fs * 1.08, blockH = lines.length * lh, inHeader = hh >= blockH + 14;
      var x = r.x + 14, y = Math.max(r.y + 8, Math.min(8, r.y + r.h - blockH - 30));
      if (y > r.y + 8 && !inHeader) y = r.y + 8;
      if (!inHeader || y > r.y + 8) {
        var pw = Math.max.apply(null, lines.map(function (l) { return tw(l, fnt(fs, 600), ls); }));
        ctx.fillStyle = 'rgba(8,30,58,.9)'; ctx.fillRect(x - 6, y - 3, pw + 12, blockH + 8);
      }
      lines.forEach(function (l, i) { text(l, x, y + lh * (i + 0.8), fnt(fs, 600), '#ffffff', null, ls); });
      // aggregate line, only when the header has room for it
      if (inHeader && hh >= blockH + 34 && y === r.y + 8) {
        var agg = aggLine(R.feats, false), af = fnt(13, 500), avail = r.w - 28 - (agg.trouble ? 92 : 0) - (r.w > 420 && hh > 70 ? 110 : 0);
        var ag = partsFit(agg.parts, avail, af);
        if (ag) text(ag, x, y + blockH + 17, af, 'rgba(214,236,255,.78)');
        if (agg.trouble && ag) text(agg.trouble + ' in trouble', x + tw(ag, af) + 12, y + blockH + 17, fnt(13, 600), '#ff8c80');
      }
      // stylised artwork for the room, once the header is large
      var art = ART[R.d.base];
      if (art && art.complete && r.w > 420 && hh > 70) { var ah = hh - 14, aw = ah * 1.5; ctx.globalAlpha = a * 0.5; ctx.drawImage(art, r.x + r.w - aw - 14, r.y + 7, aw, ah); }
      ctx.globalAlpha = 1;
    });
  });
}
function drawBayTags(B) {
  var k = cam.k; if (BH * k < 23) return;
  var a = clamp((BH * k - 23) / 2, 0, 1) * labelAlpha();
  var cf = fnt(12, 500, MONO), nf = fnt(13.5, 600);
  ctx.globalAlpha = a;
  B.wings.forEach(function (W) { W.rooms.forEach(function (R) { R.bays.forEach(function (Bay) {
    var r = rectS(Bay); if (!onScreen(r)) return;
    var code = Bay.cap.id.replace(/-[A-Z]$/, ''), nm = Bay.cap.name.toUpperCase();
    var cw = tw(code, cf) + 12, nw = tw(nm, nf, 0.7) + 12, cnt = Bay.tiles.length + '', kw = tw(cnt, cf) + 12;
    var full = cw + nw + kw, th = 22, x = r.x, y = r.y + Math.max(1, (BH * k - th) / 2 - 3);
    var showCode = full <= r.w, showCnt = showCode;
    if (!showCode && nw <= r.w) { full = nw; } else if (!showCode) return;
    ctx.fillStyle = '#0b2c52'; ctx.fillRect(x, y, full, th);
    ctx.strokeStyle = '#d6ecff'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, full - 1, th - 1);
    var xx = x;
    if (showCode) { text(code, xx + 6, y + 15.5, cf, 'rgba(214,236,255,.72)'); xx += cw; ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th); ctx.stroke(); }
    text(nm, xx + 6, y + 16, nf, '#ffffff', null, 0.7); xx += nw;
    if (showCnt) { ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th); ctx.stroke(); text(cnt, xx + 6, y + 15.5, cf, 'rgba(214,236,255,.72)'); }
  }); }); });
  ctx.globalAlpha = 1;
}
function drawChronology(B) {
  if (SCALE > 1) return;
  var r = rectS(B); if (r.w < 560) return;
  var y = r.y + r.h + 22; if (y > FH - 46) return;
  ctx.globalAlpha = labelAlpha() * 0.95;
  ctx.strokeStyle = 'rgba(214,236,255,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
  ctx.fillStyle = 'rgba(214,236,255,.75)'; ctx.beginPath(); ctx.moveTo(r.x + r.w + 6, y); ctx.lineTo(r.x + r.w - 4, y - 4); ctx.lineTo(r.x + r.w - 4, y + 4); ctx.fill();
  var f = fnt(12, 500, MONO), first = B.wings[0].def, last = B.wings[B.wings.length - 1].def;
  var t1 = 'OLDEST WORK', t2 = 'NEWEST WORK', t3 = 'LEFT TO RIGHT: WINGS IN THE ORDER WORK BEGAN, FEATURES OLDEST FIRST';
  [[t1, r.x, 'left'], [t2, r.x + r.w - 10, 'right'], [t3, r.x + r.w / 2, 'center']].forEach(function (q) {
    ctx.textAlign = q[2]; var w0 = tw(q[0], f), x0 = q[2] === 'left' ? q[1] : q[2] === 'right' ? q[1] - w0 : q[1] - w0 / 2;
    if (q[2] === 'center' && tw(t1, f) + tw(t2, f) + w0 + 60 > r.w) return;
    ctx.fillStyle = 'rgba(8,30,58,1)'; ctx.fillRect(x0 - 6, y - 8, w0 + 12, 16); text(q[0], q[1], y + 4.5, f, 'rgba(214,236,255,.8)');
  });
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;
}
function drawOverlays() {
  var k = cam.k;
  // blast: rooms touched get a dashed zone
  if (S.blast) {
    var rooms = {}; closure(S.blast).forEach(function (id) { rooms[F[id].domain] = 1; });
    ctx.strokeStyle = '#ff5d4f'; ctx.lineWidth = 1.6; ctx.setLineDash([8, 4]);
    Object.keys(rooms).forEach(function (d) { var r = rectS(ROOM[d]); ctx.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10); });
    ctx.setLineDash([]);
  }
  if (S.ga) {
    ctx.strokeStyle = '#ffc35a'; ctx.lineWidth = 1.6;
    K.features.forEach(function (f) { if (f.milestone === 'M2') { var r = rectS(TILE[f.id]); if (onScreen(r)) ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); } });
  }
  if (S.key) {
    ctx.strokeStyle = '#ff8c80'; ctx.lineWidth = 1.6;
    K.features.forEach(function (f) { if (f.flags.indexOf(S.key) >= 0) { var r = rectS(TILE[f.id]); if (onScreen(r)) ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); } });
  }
  // dependency conduits for the feature under attention
  var id = (S.hover && S.hover.type === 'tile' ? S.hover.o.id : null) || S.hl || S.open || S.sel;
  if (id && TILE[id] && k > 0.1) conduits(id);
  [S.open, S.sel].forEach(function (sid) {
    if (!sid || !TILE[sid]) return;
    var r = rectS(TILE[sid]), pad = clamp(r.w * 0.12, 5, 14);
    ctx.strokeStyle = SHEET[S.lens].acc; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -dashT * 0.6;
    ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2); ctx.setLineDash([]); ctx.lineDashOffset = 0;
  });
  if (S.hover) {
    var hr = rectS(S.hover.o);
    ctx.strokeStyle = S.hover.type === 'tile' ? '#ffffff' : '#7fe0ff'; ctx.lineWidth = S.hover.type === 'tile' ? 2.5 : 2;
    ctx.strokeRect(hr.x, hr.y, hr.w, hr.h);
  }
  if (S.hl && TILE[S.hl]) { var q = rectS(TILE[S.hl]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.strokeRect(q.x - 3, q.y - 3, q.w + 6, q.h + 6); }
}
var dashT = 0;
function conduits(id) {
  var f = F[id], A = rectS(TILE[id]), ax = A.x + A.w / 2, ay = A.y + A.h / 2;
  function route(B, col, rev) {
    var bx = B.x + B.w / 2, by = B.y + B.h / 2, sx, sy, ex, ey;
    ctx.beginPath();
    if (Math.abs(bx - ax) > Math.abs(by - ay)) { sx = ax + (bx > ax ? A.w / 2 : -A.w / 2); ex = bx + (bx > ax ? -B.w / 2 : B.w / 2); var mx = (sx + ex) / 2; ctx.moveTo(sx, ay); ctx.lineTo(mx, ay); ctx.lineTo(mx, by); ctx.lineTo(ex, by); sy = by; }
    else { sy = ay + (by > ay ? A.h / 2 : -A.h / 2); ey = by + (by > ay ? -B.h / 2 : B.h / 2); var my = (sy + ey) / 2; ctx.moveTo(ax, sy); ctx.lineTo(ax, my); ctx.lineTo(bx, my); ctx.lineTo(bx, ey); ex = bx; }
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]); ctx.lineDashOffset = (rev ? 1 : -1) * dashT; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(rev ? ax : ex, rev ? ay : (ey != null ? ey : by), 2.6, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 0.95;
  f.dependsOn.forEach(function (d) { if (TILE[d]) route(rectS(TILE[d]), '#7fe0ff', false); });
  f.usedBy.forEach(function (u) { if (TILE[u]) route(rectS(TILE[u]), 'rgba(255,255,255,.75)', true); });
  ctx.globalAlpha = 1; ctx.lineDashOffset = 0;
}
function draw() {
  if (phone || !PAT.hS) return;
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.clearRect(0, 0, FW, FH);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  anchorPatterns();
  dimFn = S.ga ? function (f) { return f.milestone === 'M2'; } : S.key ? function (f) { return f.flags.indexOf(S.key) >= 0; } : null;
  drawGrid();
  BLDS.forEach(drawBuilding);
  drawOverlays();
  BLDS.forEach(function (B) { drawBayTags(B); drawRoomLabels(B); var wa = drawWingLabels(B); drawBuildingLabel(B, wa); drawChronology(B); });
}

/* ================================================================== frame loop + chrome sync */
var lastPlace = '', kpDirty = true;
function frame(now) {
  raf = 0;
  stepCam(now);
  if (introOn) { introP = clamp((now - introT0) / INTRO_MS, 0, 1); if (introP >= 1) endIntro(); }
  dashT = (now / 40) % 1000;
  draw();
  syncPlace();
  drawKeyplan();
  var conduit = (S.hover && S.hover.type === 'tile') || S.open || S.sel || S.hl;
  if (anim || wz || introOn || (conduit && !reduced)) raf = requestAnimationFrame(frame);
}

/* where am I: the deepest container under the view centre that the camera has zoomed into */
function chainAt(wx, wy) {
  var out = [];
  var B = BLDS.filter(function (b) { return inside(b, wx, wy); })[0];
  if (!B) return out;
  if (SCALE > 1) out.push({ t: 'bld', o: B });
  var W = B.wings.filter(function (w) { return inside(w, wx, wy); })[0]; if (!W) return out; out.push({ t: 'wing', o: W });
  var R = W.rooms.filter(function (r) { return inside(r, wx, wy); })[0]; if (!R) return out; out.push({ t: 'room', o: R });
  var Bay = R.bays.filter(function (b) { return inside(b, wx, wy); })[0]; if (Bay) out.push({ t: 'bay', o: Bay });
  return out;
}
function inside(o, x, y) { return x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h; }
function fitOf(c) { return fitCam(c.o, PADS[c.t], OVER[c.t]); }
function entered(c) { return cam.k >= fitOf(c).k * 0.86 && cam.k >= HOME.k * 1.18; }
function place() {
  if (S.open && TILE[S.open]) { var T = TILE[S.open]; return chainAt(T.x + T.w / 2, T.y + T.h / 2); }
  var ch = chainAt(cam.x, cam.y), deepest = -1;
  for (var i = 0; i < ch.length; i++) if (entered(ch[i])) deepest = i;
  return ch.slice(0, deepest + 1);
}
var PLACE = [];
function syncPlace() {
  PLACE = place();
  var key = PLACE.map(function (c) { return c.o.id; }).join('>') + '|' + (S.open || '') + '|' + S.lens + '|' + S.t;
  var sb = $('#scalebar'); var sc = Math.round(100 / cam.k);
  var bw = TW * cam.k; sb.innerHTML = '<span>SCALE 1:' + sc + '</span>' + (bw <= 150 ? '<i class="sb" style="width:' + Math.round(Math.max(bw, 10)) + 'px"></i><span>= one feature</span>' : '');
  if (key === lastPlace) return;
  lastPlace = key;
  renderCrumbs(); renderLadder(); renderPanel(); writeHashSoon();
}

/* ================================================================== hover + click */
function local(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * FW, y: (e.clientY - r.top) / r.height * FH }; }
function hitAt(px, py) {
  var wx = wxs(px), wy = wys(py), k = cam.k;
  for (var i = 0; i < TILES.length; i++) { var T = TILES[i]; if (wx >= T.x - 3 / k && wx <= T.x + T.w + 3 / k && wy >= T.y - 3 / k && wy <= T.y + T.h + 3 / k) return { t: 'tile', o: T, chain: chainAt(wx, wy) }; }
  var ch = chainAt(wx, wy);
  return ch.length ? { t: ch[ch.length - 1].t, o: ch[ch.length - 1].o, chain: ch } : null;
}
function clickAt(px, py) {
  var h = hitAt(px, py);
  if (!h) { if (S.open) closeFeature(); return; }
  if (h.t === 'tile' && h.o.w * cam.k >= 96) { openFeature(h.o.id); return; }
  for (var i = 0; i < h.chain.length; i++) { var c = h.chain[i], fk = fitOf(c); if (fk.k > cam.k * 1.12) { flyTo(fk); return; } }
  if (h.t === 'tile') openFeature(h.o.id);
}
var hov = $('#hov');
function setHover(h, px, py) {
  var cur = S.hover ? S.hover.o.id + S.hover.type : '', nxt = h ? h.o.id + h.t : '';
  var target = null;
  if (h) {
    if (h.t === 'tile' && h.o.w * cam.k < 14 && false) {
      // at a distance a feature is texture; the room it sits in is what you point at
      var ch = h.chain, pick = null;
      for (var i = 0; i < ch.length; i++) { if (!entered(ch[i])) { pick = ch[i]; break; } }
      target = pick ? { type: pick.t, o: pick.o } : { type: 'tile', o: h.o };
    } else if (h.t === 'tile') target = { type: 'tile', o: h.o };
    else { var ch2 = h.chain, pk = null; for (var j = 0; j < ch2.length; j++) { if (!entered(ch2[j])) { pk = ch2[j]; break; } } target = pk ? { type: pk.t, o: pk.o } : null; }
  }
  nxt = target ? target.o.id + target.type : '';
  if (nxt !== cur) { S.hover = target; dirty(); }
  if (!target) { hov.classList.remove('on'); cv.className = ''; return; }
  cv.className = target.type === 'tile' ? 'pt' : 'zin';
  if (nxt !== cur) hov.innerHTML = hoverHTML(target);
  placeHover(target, px, py);
  hov.classList.add('on');
}
function placeHover(target, px, py) {
  var w = 360, hh = hov.offsetHeight || 140, x, y;
  if (target.type === 'tile') {
    var r = rectS(target.o);
    x = r.x + r.w + 14; y = r.y - 6;
    if (x + w > FW - 100) x = r.x - w - 14;
    if (x < 6) { x = clamp(px + 18, 6, FW - w - 6); y = r.y + r.h + 12; }
  } else { x = px + 22; y = py + 20; if (x + w > FW - 100) x = px - w - 22; }
  if (y + hh > FH - 6) y = FH - hh - 6; if (y < 6) y = 6;
  if (x < 6) x = 6;
  hov.style.left = x + 'px'; hov.style.top = y + 'px';
}
function plainStage(f, st) {
  var op = f.operations, s = st ? STAGE_PLAIN[st] : 'Not yet on the drawing at this date';
  if (S.t === AS_OF) {
    if (st === 'flagged' && op.flag) s = 'Live for ' + op.flag.rolloutPct + '% of studios, behind a switch';
    if (st === 'in-dev') s = 'Being built, about ' + f.development.progressPct + '% done';
  }
  return s;
}
function lensWords(f) {
  var L = S.lens, b = f.business, de = f.design, dv = f.development, op = f.operations, se = f.security, q = f.quality;
  if (L === 'business') return 'Value ' + b.value + '/5 · ' + (b.customerRequests30d || 0) + ' asks in 30 days · revenue: ' + b.revenueLink;
  if (L === 'design') return 'Design: ' + de.status + ' · accessibility: ' + de.a11y + (de.specDrift ? ' · built off-spec' : '');
  if (L === 'development') return dv.progressPct + '% done · ' + dv.aiAuthoredPct + '% by agents · ' + (dv.humanReviewed === false ? 'no human review' : dv.humanReviewed ? 'human reviewed' : 'review n/a') + (dv.unitCoveragePct != null ? ' · coverage ' + dv.unitCoveragePct + '%' : '');
  if (L === 'operations') return op.environment === 'production' ? 'Production · ' + (op.flag ? op.flag.rolloutPct : 100) + '% rollout · p95 ' + op.p95ms + ' ms · ' + op.errorRatePct + '% errors · ' + (op.alerting ? 'alerting on' : 'no alerting') : 'Environment: ' + op.environment;
  if (L === 'security') return 'Data: ' + se.dataClass + ' · review: ' + se.review + (se.openFindings ? ' · ' + se.openFindings + ' findings' : '');
  if (L === 'quality') return (q.e2eTests ? q.e2ePassing + ' of ' + q.e2eTests + ' end-to-end tests pass' : 'No end-to-end tests') + ' · P1 bugs ' + q.openBugs.p1;
  return null;
}
function barHTML(c) {
  var segs = barSegs(c), tot = segs.reduce(function (a, s) { return a + s[0]; }, 0) || 1;
  return '<div class="bar">' + segs.map(function (s) { return s[0] ? '<i style="width:' + (100 * s[0] / tot).toFixed(1) + '%;background:' + (s[1] === 'hatch' ? 'repeating-linear-gradient(45deg,rgba(214,236,255,.55) 0 1px,rgba(214,236,255,.1) 1px 5px)' : s[1]) + '"></i>' : ''; }).join('') + '</div>';
}
function hoverHTML(t) {
  if (t.type === 'tile') {
    var f = t.o.f, st = stageAt(f, S.t), o = '';
    o += '<div class="k">' + esc(f.id) + ' · ' + esc(D[f.domain].name) + ' › ' + esc(C[f.capability].name) + '</div><div class="n">' + esc(f.name) + '</div>';
    var s = plainStage(f, st);
    if (S.t === AS_OF) { var ag = f.builtBy.filter(isAgent); if (ag.length) s += '. Built by ' + ag.map(pname).join(' & ') + (f.development.humanReviewed === false ? ', no human review' : ''); }
    o += '<div class="s">' + esc(s) + '.</div>';
    var lw = S.t === AS_OF ? lensWords(f) : null; if (lw) o += '<div class="e">' + esc(lw) + '</div>';
    if (S.t === AS_OF && f.flags.length) o += '<div class="t">' + f.flags.map(function (k) { return '◆ ' + esc(FLAGS[FLAGNO[k]][1]); }).join('<br>') + '</div>';
    o += '<div class="h">Click to open the full sheet</div>';
    return o;
  }
  var obj = t.o, fs, title, kick, sub;
  if (t.type === 'wing') { fs = obj.feats; title = obj.def.name; kick = 'Wing ' + obj.def.letter + (SCALE > 1 ? ' · ' + obj.bld.name : ''); sub = obj.def.plain + '. ' + obj.rooms.length + ' rooms: ' + obj.rooms.map(function (r) { return r.d.name; }).join(', ') + '.'; }
  else if (t.type === 'room') { fs = obj.feats; title = obj.d.name; kick = 'Room · wing ' + obj.wing.def.letter + ' ' + obj.wing.def.name; sub = obj.d.summary; }
  else if (t.type === 'bay') { fs = obj.feats; title = obj.cap.name; kick = 'Bay · ' + obj.room.d.name; sub = obj.tiles.length + ' features: ' + obj.tiles.map(function (T) { return T.f.name; }).join(', ') + '.'; }
  else { fs = obj.feats; title = obj.name; kick = 'Building'; sub = obj.wings.length + ' wings, ' + K.domains.filter(function (d) { return d.bld === obj.i; }).length + ' rooms'; }
  var agg = aggLine(fs, false), artK = t.type === 'wing' ? obj.def.art : t.type === 'room' ? obj.d.base : t.type === 'bay' ? obj.room.d.base : null;
  return (artK ? '<div class="art">' + illoSVG(artK, SHEET[S.lens].acc) + '</div>' : '') + '<div class="k">' + esc(kick) + '</div><div class="n">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div>' + barHTML(agg.c) +
    '<div class="e">' + esc(agg.parts.join(' · ')) + '</div>' + (agg.trouble ? '<div class="t">' + agg.trouble + ' in trouble</div>' : '') + '<div class="h">Click or scroll to go inside</div>';
}

/* pointer: drag pans, wheel and pinch zoom, click descends one level */
var ptrs = {}, drag = null, pinch = null;
cv.addEventListener('pointerdown', function (e) {
  endIntro();
  cv.setPointerCapture(e.pointerId);
  ptrs[e.pointerId] = local(e);
  var ids = Object.keys(ptrs);
  if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k }; drag = null; return; }
  var p = ptrs[e.pointerId];
  drag = { x0: p.x, y0: p.y, cx: cam.x, cy: cam.y, moved: false };
});
cv.addEventListener('pointermove', function (e) {
  var p = local(e);
  if (ptrs[e.pointerId]) ptrs[e.pointerId] = p;
  if (pinch) {
    var ids = Object.keys(ptrs); if (ids.length < 2) return;
    var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var wx = wxs(mx), wy = wys(my); cam.k = clamp(pinch.k * d / pinch.d, KMIN, KMAX); cam.x = wx - (mx - FW / 2) / cam.k; cam.y = wy - (my - FH / 2) / cam.k; anim = null; wz = null; dirty(); return;
  }
  if (drag) {
    var dx = p.x - drag.x0, dy = p.y - drag.y0;
    if (drag.moved || Math.hypot(dx, dy) > 5) {
      if (!drag.moved) { drag.moved = true; cv.classList.add('pan'); setHover(null); }
      anim = null; wz = null; cam.x = drag.cx - dx / cam.k; cam.y = drag.cy - dy / cam.k; dirty();
    }
    return;
  }
  setHover(hitAt(p.x, p.y), p.x, p.y);
});
function endPtr(e) {
  var p = ptrs[e.pointerId]; delete ptrs[e.pointerId];
  if (pinch) { if (Object.keys(ptrs).length < 2) pinch = null; drag = null; return; }
  if (drag && !drag.moved && p && e.type === 'pointerup') clickAt(p.x, p.y);
  drag = null; cv.classList.remove('pan');
}
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('pointerleave', function () { if (!drag) setHover(null); });
cv.addEventListener('wheel', function (e) {
  e.preventDefault(); endIntro(); setHover(null);
  var p = local(e), dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
  if (e.ctrlKey) dy *= 2.5;
  zoomAt(p.x, p.y, Math.exp(-dy * 0.0016));
}, { passive: false });
cv.addEventListener('dblclick', function (e) { e.preventDefault(); });

/* ================================================================== navigation */
function goHome(dur) { flyTo(HOME, dur); }
function goUp() {
  if (S.open) { closeFeature(); return; }
  if (S.blast) { setMode({ blast: null }); return; }
  if (S.ga) { setMode({ ga: false }); return; }
  if (S.key) { S.key = null; renderPanel(); dirty(); return; }
  var p = PLACE;
  if (!p.length) { if (Math.abs(cam.k / HOME.k - 1) > 0.02 || Math.hypot(cam.x - HOME.x, cam.y - HOME.y) * cam.k > 4) goHome(); else if (S.t !== AS_OF) setT(AS_OF); return; }
  if (p.length === 1) { goHome(); return; }
  flyTo(fitOf(p[p.length - 2]));
}
function goLevel(depth) {
  if (depth === 0) { goHome(); return; }
  var ch = chainAt(cam.x, cam.y);
  if (!ch.length) { var R0 = WALK[0]; ch = chainAt(R0.x + R0.w / 2, R0.y + RH + 20); }
  var c = ch[Math.min(depth, ch.length) - 1];
  if (c) flyTo(fitOf(c));
}
function levelNames() { return (SCALE > 1 ? ['Campus', 'Building'] : ['Site']).concat(['Wing', 'Room', 'Bay', 'Feature']); }
function walk(dir) {
  var cur = PLACE.filter(function (c) { return c.t === 'room' || c.t === 'bay'; })[0];
  var i = cur ? WALK.indexOf(cur.o.t === 'bay' ? cur.o.room : cur.o) : -1;
  if (cur && cur.t === 'bay') i = WALK.indexOf(cur.o.room);
  if (i < 0) { var ch = chainAt(cam.x, cam.y), w = ch.filter(function (c) { return c.t === 'wing'; })[0]; i = w ? WALK.indexOf(w.o.rooms[0]) - (dir > 0 ? 1 : 0) : (dir > 0 ? -1 : WALK.length); }
  i = (i + dir + WALK.length) % WALK.length;
  flyTo(fitCam(WALK[i], PADS.room, OVER.room));
}
var camBefore = null;
function openFeature(id, opts) {
  opts = opts || {};
  if (!F[id]) return;
  if (!S.open) camBefore = { x: cam.x, y: cam.y, k: cam.k };
  S.open = id; S.sel = null; S.hl = null;
  setHover(null);
  var det = $('#detail');
  $('#dscroll').innerHTML = detailHTML(F[id]); $('#dscroll').scrollTop = 0;
  det.classList.add('open'); det.setAttribute('aria-hidden', 'false');
  if (phone) openPhone(id);
  var T = TILE[id], k = 1.45, cx = 158;
  flyTo({ x: T.x + T.w / 2 - (cx - FW / 2) / k, y: T.y + T.h / 2, k: k }, opts.dur);
  lastPlace = ''; dirty();
  setTimeout(function () { if (S.open === id) $('#dclose').focus({ preventScroll: true }); }, reduced ? 0 : 420);
}
function closeFeature() {
  if (!S.open) return;
  var id = S.open; S.open = null;
  var det = $('#detail'); det.classList.remove('open'); det.setAttribute('aria-hidden', 'true');
  if (camBefore) flyTo(camBefore); else { var T = TILE[id]; flyTo(fitCam(T.room, PADS.room, OVER.room)); }
  camBefore = null; lastPlace = ''; dirty();
  cv.focus({ preventScroll: true });
}
function setMode(m) {
  Object.keys(m).forEach(function (k) { S[k] = m[k]; });
  if (S.open && (m.blast || m.ga)) { var det = $('#detail'); S.open = null; det.classList.remove('open'); det.setAttribute('aria-hidden', 'true'); camBefore = null; }
  renderCallout(); syncTools(); lastPlace = '';
  var ids = S.blast ? closure(S.blast).concat([S.blast]) : S.ga ? K.features.filter(function (f) { return f.milestone === 'M2'; }).map(function (f) { return f.id; }) : null;
  if (ids && (m.blast || m.ga)) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ids.forEach(function (i) { var T = TILE[i]; x0 = Math.min(x0, T.x); y0 = Math.min(y0, T.y); x1 = Math.max(x1, T.x + T.w); y1 = Math.max(y1, T.y + T.h); });
    flyTo(fitCam({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { t: 40, r: 370, b: 40, l: 30 }));
  }
  dirty(); writeHashSoon();
}
function toggleBlast() {
  if (S.blast) { setMode({ blast: null }); return; }
  var id = S.open || S.sel || (S.hover && S.hover.type === 'tile' ? S.hover.o.id : null) || 'PLT-02' + (SCALE > 1 ? '-S' : '');
  setMode({ blast: id, ga: false });
}

/* ================================================================== callout (blast radius / Payments GA) */
function renderCallout() {
  var call = $('#callout');
  if (S.blast) {
    var bl = closure(S.blast), f0 = F[S.blast], direct = f0.usedBy;
    var prodAll = bl.filter(function (id) { return isLiveSt(F[id].stage); }), prodDir = direct.filter(function (id) { return isLiveSt(F[id].stage); });
    call.className = '';
    call.innerHTML = '<button class="x" data-act="unblast">CLEAR · ESC</button><h4>Blast radius · ' + esc(f0.id) + '</h4>' +
      '<div class="big">If ' + esc(f0.name) + ' breaks</div>' +
      '<div class="row"><span>Depend on it directly</span><b>' + direct.length + '</b></div>' +
      '<div class="row"><span>…of them live for customers</span><b style="color:#ff8c80">' + prodDir.length + '</b></div>' +
      '<div class="row"><span>Reached through the chain</span><b>' + bl.length + '</b></div>' +
      '<div class="row"><span>…of them live for customers</span><b>' + prodAll.length + '</b></div>' +
      '<div class="sub">DIRECT DEPENDENTS</div>' + direct.map(function (id) { return '<button class="lnk" data-open="' + id + '"><i>' + id + '</i>' + esc(F[id].name) + ' <span style="color:#a9c3dc">· ' + STAGE_WORD[F[id].stage].toLowerCase() + '</span></button>'; }).join('');
    call.style.display = 'block';
  } else if (S.ga) {
    var m2 = K.features.filter(function (f) { return f.milestone === 'M2'; });
    var cnt = function (fn) { return m2.filter(fn).length; };
    var blocked = m2.filter(function (f) { return f.flags.indexOf('blocked') >= 0; });
    var unsafe = m2.filter(function (f) { return isLiveSt(f.stage) && (f.flags.indexOf('security-gap') >= 0 || f.flags.indexOf('ai-unreviewed-in-production') >= 0); });
    var days = Math.round(dnum(MS.M2.date) - dnum(AS_OF));
    call.className = 'ga';
    call.innerHTML = '<button class="x" data-act="ungi">CLOSE · G</button><h4>Milestone M2 · ' + MS.M2.date + '</h4><div class="big">Payments GA in ' + days + ' days</div>' +
      '<div class="row"><span>Features in this release</span><b>' + m2.length + '</b></div>' +
      '<div class="row"><span>Done, live for all</span><b>' + cnt(function (f) { return f.stage === 'live'; }) + '</b></div>' +
      '<div class="row"><span>Partly open (flagged)</span><b>' + cnt(function (f) { return f.stage === 'flagged'; }) + '</b></div>' +
      '<div class="row"><span>Still being built or reviewed</span><b>' + cnt(function (f) { return f.stage === 'in-dev' || f.stage === 'in-review'; }) + '</b></div>' +
      '<div class="row"><span>Not started</span><b>' + cnt(function (f) { return f.stage === 'specified' || f.stage === 'idea'; }) + '</b></div>' +
      '<div class="row"><span>Blocked</span><b style="color:#ffc35a">' + blocked.length + '</b></div>' +
      '<div class="row"><span>Done but unsafe</span><b style="color:#ff8c80">' + unsafe.length + '</b></div>' +
      '<div class="sub">DONE BUT UNSAFE</div>' + unsafe.map(function (f) { return '<button class="lnk" data-open="' + f.id + '"><i>' + f.id + '</i>' + esc(f.name) + '</button>'; }).join('') +
      '<div class="sub">BLOCKED</div>' + blocked.map(function (f) { return '<button class="lnk" data-open="' + f.id + '"><i>' + f.id + '</i>' + esc(f.name) + ' <span style="color:#a9c3dc">← ' + f.blockedBy.map(function (b) { return esc(F[b].name); }).join(', ') + '</span></button>'; }).join('');
    call.style.display = 'block';
  } else { call.style.display = 'none'; call.innerHTML = ''; }
}

/* ================================================================== chrome: tabs, crumbs, ladder, panel, title block */
function renderTabs() {
  $('#tabs').innerHTML = SHEETS.map(function (s, i) {
    return '<button role="tab" data-lens="' + s.k + '" aria-selected="' + (S.lens === s.k) + '" title="' + esc(s.title) + ' (' + (i + 1) + ')"><span class="no">' + s.no + '</span><span class="nm">' + s.nm + '</span><span class="kb">' + (i + 1) + '</span></button>';
  }).join('');
  var sh = SHEET[S.lens];
  $('#proj').innerHTML = 'Project Kettle · drawing set · <b>sheet ' + sh.no + ' · ' + esc(sh.title) + '</b>';
}
function crumbLabel(c, short) {
  if (c.t === 'bld') return short ? c.o.name.replace('Kettle ', '') : c.o.name;
  if (c.t === 'wing') return short ? c.o.def.letter : c.o.def.letter + ' · ' + c.o.def.name;
  if (c.t === 'room') return short ? c.o.d.base : c.o.d.name;
  return c.o.cap.name;
}
function renderCrumbs() {
  var items = [{ lab: SCALE > 1 ? 'Kettle campus' : 'Kettle', act: 'home', full: 'Kettle' }];
  PLACE.forEach(function (c, i) { items.push({ c: c, act: 'lvl', i: i + 1 }); });
  var f = fnt(19, 600), avail = S.open ? 300 : 676;
  function width(short) { return items.reduce(function (a, it, i) { var l = it.c ? crumbLabel(it.c, short && i < items.length - 1) : it.lab; return a + tw(l.toUpperCase(), f, 0.95) + 26; }, 0); }
  var short = S.open || width(false) > avail;
  var cur = PLACE.length ? PLACE[PLACE.length - 1].o : null, fs = S.open ? null : cur ? cur.feats : K.features, sumH = '';
  if (fs) {
    var c = counts(fs), used = width(short), sf = fnt(16, 400), segs = [[fs.length + ' features', ''], [(c.live + c.flagged) + ' live', 'b'], [c.build + ' being built', ''], [(c.paper + c.dep) + ' promised', ''], [S.t === AS_OF && c.bad ? c.bad + ' in trouble' : '', 'em']].filter(function (x) { return x[0]; });
    while (segs.length > 1 && used + 14 + tw(segs.map(function (x) { return x[0]; }).join(' · '), sf) > avail + 20) {
      var di = -1; for (var si = segs.length - 1; si >= 1; si--) if (segs[si][1] !== 'em') { di = si; break; }
      if (di < 0) break; segs.splice(di, 1);
    }
    if (used + 14 + tw(segs.map(function (x) { return x[0]; }).join(' · '), sf) <= avail + 20) sumH = '<span class="sum">' + segs.map(function (x) { return x[1] ? '<' + x[1] + '>' + x[0] + '</' + x[1] + '>' : x[0]; }).join(' · ') + '</span>';
  }
  $('#crumbs').innerHTML = items.map(function (it, i) {
    var l = it.c ? crumbLabel(it.c, short && i < items.length - 1) : it.lab, last = i === items.length - 1;
    var full = it.c ? crumbLabel(it.c, false) : it.lab;
    return (i ? '<span class="sep">›</span>' : '') + '<button data-crumb="' + it.act + '"' + (it.i ? ' data-depth="' + it.i + '"' : '') + ' class="' + (last ? 'cur' : '') + '" title="' + esc(full) + '"' + (last ? ' aria-current="location"' : '') + '>' + esc(l) + '</button>';
  }).join('') + sumH;
}
function renderLadder() {
  var names = levelNames(), depth = S.open ? names.length - 1 : PLACE.length;
  $('#ladder').innerHTML = '<button class="zb" data-zoom="-1" aria-label="Zoom out" title="Zoom out (−)">−</button><button class="zb" data-zoom="1" aria-label="Zoom in" title="Zoom in (+)">+</button><span class="lvl">LEVEL</span>' +
    names.map(function (n, i) { return '<button data-level="' + i + '" class="' + (i === depth ? 'cur' : '') + '"' + (i === depth ? ' aria-current="true"' : '') + ' title="Go to level ' + i + '">L' + i + ' ' + n.toUpperCase() + '</button>'; }).join('');
}
function sym(st, w, h) {
  w = w || 22; h = h || 14;
  var o = '<svg width="' + (w + 2) + '" height="' + (h + 2) + '" viewBox="-1 -1 ' + (w + 2) + ' ' + (h + 2) + '" aria-hidden="true">';
  var r = '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="none" stroke="#d6ecff" stroke-width="1.3"';
  if (st === 'live') o += '<rect width="' + w + '" height="' + h + '" fill="rgba(214,236,255,.3)"/>' + r + '/>';
  else if (st === 'flagged') o += '<rect width="' + w * 0.45 + '" height="' + h + '" fill="rgba(214,236,255,.34)"/>' + r + '/>';
  else if (st === 'in-review') o += '<rect width="' + w + '" height="' + h + '" fill="url(#lhX)"/>' + r + '/>';
  else if (st === 'in-dev') o += '<rect width="' + w + '" height="' + h + '" fill="url(#lhS)"/><rect y="' + (h - 3) + '" width="' + w * 0.6 + '" height="3" fill="#d6ecff"/>' + r + '/>';
  else if (st === 'specified') o += r + ' stroke-dasharray="4 2.5"/>';
  else if (st === 'idea') o += r + ' stroke-dasharray="1 2.4" opacity=".75"/>';
  else if (st === 'deprecated') o += r + '/><path d="M0 0L' + w + ' ' + h + 'M' + w + ' 0L0 ' + h + '" stroke="#d6ecff" stroke-width="1.1"/>';
  else o += r + ' stroke-dasharray="1 3" opacity=".4"/>';
  return o + '</svg>';
}
var LEGDEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><pattern id="lhS" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#d6ecff" stroke-width="1" opacity=".7"/></pattern><pattern id="lhX" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4M0 0H4" stroke="#d6ecff" stroke-width=".8" opacity=".7"/></pattern>' +
  '<pattern id="ldSk" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><line x1="0" y1="0" x2="0" y2="6" stroke="#f2b6ff" stroke-width="1" opacity=".7"/></pattern><pattern id="ldHf" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 0V4M0 0H4" stroke="#f2b6ff" stroke-width=".8" opacity=".8"/></pattern>' +
  '<pattern id="lsPay" width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V3.4M0 0H3.4" stroke="#ff8f78" stroke-width=".9"/></pattern><pattern id="lsPer" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#ffc2b0" stroke-width="1" opacity=".8"/></pattern>' +
  '<pattern id="lsInt" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".9" fill="#d6ecff" opacity=".8"/></pattern><pattern id="lqF" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#ff5d4f" stroke-width="1"/></pattern></defs></svg>';
function mk(inner) { return '<svg width="28" height="19" viewBox="-1 -1 28 19" aria-hidden="true">' + inner + '</svg>'; }
var M_CLOUD = mk('<path d="M2 2 q3 -3 6 0 q3 -3 6 0 q3 -3 6 0 q3 -3 4 0 q3 3 0 6 q3 3 0 6 q-1 3 -4 2 q-3 3 -6 0 q-3 3 -6 0 q-3 3 -6 -1 q-3 -3 0 -6 q-3 -3 0 -7z" fill="none" stroke="#ff5d4f" stroke-width="1.3"/>');
var M_TICK = mk('<rect x="3" y="5" width="20" height="11" fill="none" stroke="#d6ecff" stroke-width="1" opacity=".5"/><path d="M14 4 l3 -4 M18 4 l3 -4" stroke="#ffc35a" stroke-width="1.8" stroke-linecap="round"/>');
var M_DELTA = mk('<path d="M13 2 l8 13 h-16z" fill="#9fe8ff"/>');
var M_DIA = mk('<path d="M13 2 l5 7 l-5 7 l-5 -7z" fill="none" stroke="#d6ecff" stroke-width="1.2"/>');
function sw(fill, extra) { return mk('<rect x="1" y="1" width="24" height="15" fill="' + fill + '" stroke="#d6ecff" stroke-width="1.2"/>' + (extra || '')); }
function legendFor(lens) {
  var items;
  if (lens === 'general') items = [[sym('live', 24, 15), 'Built · live'], [sym('flagged', 24, 15), 'Partly open'], [sym('in-review', 24, 15), 'Inspection'], [sym('in-dev', 24, 15), 'Construction'], [sym('specified', 24, 15), 'Proposed'], [sym('idea', 24, 15), 'Future idea'], [M_CLOUD, 'Trouble'], [M_TICK, 'Watch'], [M_DELTA, 'Changed'], [M_DIA, 'Unreviewed']];
  else if (lens === 'business') items = [[sw('rgba(147,240,198,.1)'), 'Value 1'], [mk('<rect x="1" y="1" width="24" height="15" fill="rgba(147,240,198,.4)" stroke="#93f0c6" stroke-width="3.4"/>'), 'Value 5'], [M_CLOUD, 'Business bad'], [M_TICK, 'Watch']];
  else if (lens === 'design') items = [[sw('none'), 'No design'], [sw('url(#ldSk)'), 'Sketch'], [sw('url(#ldHf)'), 'Hi-fi'], [sw('rgba(242,182,255,.3)'), 'Implemented'], [M_CLOUD, 'Design bad'], [M_TICK, 'Watch']];
  else if (lens === 'development') items = [[sw('none', '<rect x="1" y="7" width="24" height="9" fill="rgba(143,208,255,.45)"/>'), 'Progress'], [sw('none', '<rect x="20" y="3" width="3" height="13" fill="#8fd0ff"/>'), 'Share by agents'], [M_DIA, 'No human review'], [M_CLOUD, 'Dev bad']];
  else if (lens === 'operations') items = [[sw('none', '<rect x="1" y="1" width="9" height="15" fill="rgba(127,240,224,.45)"/>'), 'Rollout share'], [sw('url(#lsInt)'), 'Staging'], [M_CLOUD, 'Ops bad'], [M_TICK, 'Watch']];
  else if (lens === 'security') items = [[sw('url(#lsPay)'), 'Card data'], [sw('url(#lsPer)'), 'Personal data'], [sw('url(#lsInt)'), 'Internal'], [sw('none'), 'Public'], [M_CLOUD, 'Security bad'], [M_TICK, 'Watch']];
  else items = [[sw('none', '<rect x="1" y="1" width="16" height="15" fill="rgba(205,187,255,.45)"/><rect x="17" y="1" width="8" height="15" fill="url(#lqF)"/>'), 'E2E pass / fail'], [M_CLOUD, 'Quality bad'], [M_TICK, 'Watch'], [M_DELTA, 'Changed']];
  return items.map(function (it) { return '<div>' + it[0] + '<span>' + it[1] + '</span></div>'; }).join('');
}
var HINT = '<div id="hint"><b>Scroll</b> zoom · <b>drag</b> pan · <b>click</b> go in · <b>Esc</b> back<br><b>/</b> find · <b>1–7</b> sheets · <b>←→</b> rooms · <b>G</b> GA · <b>B</b> blast</div>';
function renderPanel() {
  var p = $('#panel'), deep = PLACE.filter(function (c) { return c.t === 'room' || c.t === 'bay'; });
  if (deep.length && !S.ga && !S.blast) {
    var R = deep[0].o, o = '<h3><span>Room schedule · ' + esc(R.d.base) + '</span><span>' + R.feats.length + ' features</span></h3><ul class="sched">';
    R.bays.forEach(function (Bay) {
      o += '<li class="cap">' + esc(Bay.cap.name) + '</li>';
      Bay.tiles.forEach(function (T) {
        var f = T.f, st = stageAt(f, S.t), hl = lensHealth(f), now = S.t === AS_OF;
        o += '<li><button data-open="' + f.id + '" data-hov="' + f.id + '">' + sym(st, 20, 13) + '<span>' + esc(f.name) + '</span><span class="w" style="color:' + (now && hl === 'bad' ? '#ff8c80' : now && hl === 'watch' ? '#ffc35a' : '') + '">' + (st ? STAGE_WORD[st] : 'Not yet') + '</span></button></li>';
      });
    });
    p.innerHTML = LEGDEFS + o + '</ul>' + HINT;
    return;
  }
  var kc = {}; K.features.forEach(function (f) { f.flags.forEach(function (k) { kc[k] = (kc[k] || 0) + 1; }); });
  var o2 = LEGDEFS + '<h3><span>Legend · ' + SHEET[S.lens].no + '</span><span>' + SHEET[S.lens].nm + '</span></h3><div class="lg">' + legendFor(S.lens) + '</div>';
  o2 += '<h3 style="border-top:1px solid rgba(214,236,255,.36)"><span>Tensions · click to find</span><span>features</span></h3><ul class="kn">' +
    FLAGS.map(function (x) { return '<li data-key="' + x[0] + '" tabindex="0" role="button" aria-pressed="' + (S.key === x[0]) + '" class="' + (S.key === x[0] ? 'on' : '') + '"><span class="d"></span><span>' + x[1] + '</span><span class="c">' + (kc[x[0]] || 0) + '</span></li>'; }).join('') + '</ul>' + HINT;
  p.innerHTML = o2;
}
function renderTB(flip) {
  var sh = SHEET[S.lens], c = counts(K.features), rev = revAt(S.t), now = S.t === AS_OF;
  $('#tb').innerHTML =
    '<div class="proj"><div class="v">KETTLE</div><span class="lab">' + (SCALE > 1 ? 'Campus ×' + SCALE : 'Project') + '</span></div>' +
    '<div class="sheet"><span class="lab">Sheet</span><span class="no' + (flip ? ' flip' : '') + '">' + sh.no + '</span><span class="of">' + (SHEETS.indexOf(sh) + 1) + ' of 7</span></div>' +
    '<div class="ttl"><span class="lab">' + S.t + ' · rev ' + rev + '/27</span><div class="v">' + esc(sh.title) + '</div></div>' +
    '<div class="schedT"><span class="lab">Schedule · ' + (NF - c.none) + ' features' + (SCALE > 1 ? ' · ×' + SCALE : '') + '</span><table>' +
    '<tr><td class="sy">' + sym('live', 18, 11) + '</td><td>Built, live for all</td><td class="n">' + c.live + '</td></tr>' +
    '<tr><td class="sy">' + sym('flagged', 18, 11) + '</td><td>Partly open, flagged</td><td class="n">' + c.flagged + '</td></tr>' +
    '<tr><td class="sy">' + sym('in-dev', 18, 11) + '</td><td>Being built or reviewed</td><td class="n">' + c.build + '</td></tr>' +
    '<tr><td class="sy">' + sym('specified', 18, 11) + '</td><td>On paper, promised</td><td class="n">' + (c.paper + c.dep) + '</td></tr>' +
    '<tr class="tr"><td class="sy">' + M_CLOUD.replace('width="28" height="19"', 'width="20" height="14"') + '</td><td>In trouble</td><td class="n">' + (now ? K.features.filter(function (f) { return f.health === 'bad'; }).length : '—') + '</td></tr>' +
    '<tr><td class="sy">' + M_DELTA.replace('width="28" height="19"', 'width="20" height="14"') + '</td><td>Changed, last ' + (S.delta === 1 ? '24 h' : S.delta + ' days') + '</td><td class="n">' + c.chg + '</td></tr>' +
    '</table></div><div class="disc">Sample data · artwork is stylised</div>';
}
function syncTools() {
  Array.prototype.forEach.call(document.querySelectorAll('#tools .seg button'), function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-d') === S.delta)); });
  $('#bga').setAttribute('aria-pressed', String(S.ga));
  $('#bblast').setAttribute('aria-pressed', String(!!S.blast));
}

/* ================================================================== key plan (minimap) */
var kp = $('#kp'), kctx = kp.getContext('2d'), KPW = 158, KPH = 72, kpBase = null;
function kpScale() { var s = Math.min((KPW - 12) / WORLD.w, (KPH - 10) / WORLD.h); return { s: s, ox: (KPW - WORLD.w * s) / 2 - WORLD.x * s, oy: (KPH - WORLD.h * s) / 2 - WORLD.y * s }; }
function drawKeyplan() {
  if (phone) return;
  var r = RES; if (kp.width !== Math.round(KPW * r)) { kp.width = Math.round(KPW * r); kp.height = Math.round(KPH * r); kpDirty = true; }
  var m = kpScale();
  kctx.setTransform(r, 0, 0, r, 0, 0); kctx.clearRect(0, 0, KPW, KPH);
  ROOMS.forEach(function (R) {
    var c = counts(R.feats), share = (c.live + c.flagged) / Math.max(1, c.n);
    kctx.fillStyle = 'rgba(214,236,255,' + (0.06 + share * 0.3).toFixed(2) + ')';
    kctx.fillRect(R.x * m.s + m.ox, R.y * m.s + m.oy, R.w * m.s, R.h * m.s);
    if (c.bad) { kctx.fillStyle = 'rgba(255,93,79,' + Math.min(0.85, 0.35 + c.bad * 0.15) + ')'; kctx.fillRect(R.x * m.s + m.ox + R.w * m.s - 4, R.y * m.s + m.oy + 1, 3, 3); }
    kctx.strokeStyle = 'rgba(214,236,255,.55)'; kctx.lineWidth = 0.6; kctx.strokeRect(R.x * m.s + m.ox, R.y * m.s + m.oy, R.w * m.s, R.h * m.s);
  });
  kctx.strokeStyle = '#d6ecff'; kctx.lineWidth = 1.2; BLDS.forEach(function (B) { kctx.strokeRect(B.x * m.s + m.ox, B.y * m.s + m.oy, B.w * m.s, B.h * m.s); });
  var vx = wxs(0) * m.s + m.ox, vy = wys(0) * m.s + m.oy, vw = FW / cam.k * m.s, vh = FH / cam.k * m.s;
  kctx.fillStyle = 'rgba(255,195,90,.14)'; kctx.fillRect(vx, vy, vw, vh);
  kctx.strokeStyle = '#ffc35a'; kctx.lineWidth = 1.4; kctx.strokeRect(vx, vy, vw, vh);
  $('#kpz').textContent = '×' + (cam.k / HOME.k).toFixed(1);
}
$('#keyplan').addEventListener('click', function (e) {
  var r = kp.getBoundingClientRect(), m = kpScale();
  var x = (e.clientX - r.left) / r.width * KPW, y = (e.clientY - r.top) / r.height * KPH;
  flyTo({ x: (x - m.ox) / m.s, y: (y - m.oy) / m.s, k: Math.max(cam.k, HOME.k * 2.2) });
});

/* ================================================================== revisions strip (time) */
var RX0 = 84, RX1 = 694, RD0 = '2026-04-09', RD1 = '2026-11-05';
function rx(d) { return RX0 + (dnum(d) - dnum(RD0)) / (dnum(RD1) - dnum(RD0)) * (RX1 - RX0); }
function renderRevs() {
  var svg = $('#revsvg'), o = '', top = 26, bot = 66, hx = rx(S.t), now = S.t === AS_OF;
  var max = Math.max.apply(null, K.snapshots.map(function (s) { return s.total; })) * 1.05;
  var order = ['live', 'flagged', 'in-review', 'in-dev', 'specified', 'idea', 'deprecated'];
  var fills = { live: 'rgba(214,236,255,.62)', flagged: 'rgba(214,236,255,.44)', 'in-review': 'rgba(214,236,255,.3)', 'in-dev': 'rgba(214,236,255,.2)', specified: 'rgba(214,236,255,.11)', idea: 'rgba(214,236,255,.06)', deprecated: 'rgba(255,93,79,.5)' };
  o += '<text class="lbl" x="0" y="' + (top + 4) + '">REVISIONS</text><text x="0" y="' + (top + 20) + '">27 weeks</text><text x="0" y="' + (top + 35) + '">[ ] step</text>';
  var cum = K.snapshots.map(function () { return 0; });
  order.forEach(function (st) {
    var up = [], dn = [];
    K.snapshots.forEach(function (s, i) { var x = rx(s.week), y0 = bot - cum[i] / max * (bot - top); cum[i] += s.counts[st] || 0; var y1 = bot - cum[i] / max * (bot - top); dn.push(x.toFixed(1) + ',' + y0.toFixed(1)); up.push(x.toFixed(1) + ',' + y1.toFixed(1)); });
    o += '<polygon points="' + up.join(' ') + ' ' + dn.reverse().join(' ') + '" fill="' + fills[st] + '"/>';
  });
  o += '<line class="ax" x1="' + RX0 + '" y1="' + bot + '" x2="' + RX1 + '" y2="' + bot + '"/>';
  K.snapshots.forEach(function (s, i) {
    var x = rx(s.week);
    o += '<line class="ax" x1="' + x + '" y1="' + bot + '" x2="' + x + '" y2="' + (bot + 4) + '" opacity=".6"/>';
    if (((i % 4 === 0 && i !== 24) || i === 26) && Math.abs(x - hx) > 58) o += '<text x="' + x + '" y="' + (bot + 17) + '" text-anchor="middle">' + fmtD(s.week) + '</text>';
    o += '<rect class="wk" data-w="' + s.week + '" x="' + (x - 11) + '" y="' + (top - 8) + '" width="22" height="' + (bot - top + 36) + '" fill="transparent"/>';
  });
  K.milestones.forEach(function (m) {
    if (m.date > RD1) return;
    var x = rx(m.date), fut = m.date > AS_OF, col = fut ? '#ffc35a' : '#d6ecff';
    o += '<g class="ms"><line x1="' + x + '" y1="' + (top - 12) + '" x2="' + x + '" y2="' + bot + '" stroke="' + col + '" stroke-width="1.2" stroke-dasharray="' + (fut ? '4 3' : '0') + '"/>' +
      '<path d="M' + x + ' ' + (top - 12) + ' h10 l-3 4 l3 4 h-10z" fill="' + col + '"/>' +
      '<text x="' + (fut ? x - 4 : x + 13) + '" y="' + (top - 5) + '" text-anchor="' + (fut ? 'end' : 'start') + '" style="fill:' + col + '">' + m.id + ' ' + esc(m.name.toUpperCase()) + (fut ? ' · ' + fmtD(m.date) : ' · DONE') + '</text></g>';
  });
  o += '<text x="' + (RX1 + 8) + '" y="' + (bot - 14) + '">M3 DEC 03 ▸</text><text x="' + (RX1 + 8) + '" y="' + (bot + 2) + '">M4 JAN 28 ▸</text>';
  o += '<g class="handle"><line x1="' + hx + '" y1="' + (top - 14) + '" x2="' + hx + '" y2="' + (bot + 2) + '"/><rect x="' + (hx - 60) + '" y="' + (bot + 8) + '" width="120" height="20" rx="2"/><text x="' + hx + '" y="' + (bot + 22.5) + '" text-anchor="middle">' + (now ? 'NOW · REV 27' : 'REV ' + revAt(S.t) + ' · ' + fmtD(S.t)) + '</text><path d="M' + (hx - 5) + ' ' + (bot + 8) + ' l5 -6 l5 6z" fill="#ffc35a"/></g>';
  svg.innerHTML = o;
  svg.setAttribute('aria-valuenow', revAt(S.t));
  svg.setAttribute('aria-valuetext', 'Revision ' + revAt(S.t) + ', ' + S.t);
}
function setT(d) {
  if (d > AS_OF) d = AS_OF; if (d < WEEKS[0]) d = WEEKS[0];
  if (d === S.t) return;
  S.t = d; renderRevs(); renderTB(); lastPlace = ''; dirty(); writeHashSoon();
}
function stepWeek(dir) { var i = WEEKS.indexOf(S.t); if (i < 0) i = revAt(S.t) - 1; i = clamp(i + dir, 0, 26); setT(WEEKS[i]); }
var revsvg = $('#revsvg'), rdrag = false;
function revFromEvent(e) {
  var r = revsvg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 768;
  var best = WEEKS[0], bd = 1e9; WEEKS.forEach(function (w) { var dd = Math.abs(rx(w) - x); if (dd < bd) { bd = dd; best = w; } });
  return best;
}
revsvg.addEventListener('pointerdown', function (e) { rdrag = true; revsvg.setPointerCapture(e.pointerId); setT(revFromEvent(e)); });
revsvg.addEventListener('pointermove', function (e) { if (rdrag) setT(revFromEvent(e)); });
revsvg.addEventListener('pointerup', function () { rdrag = false; });
revsvg.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); stepWeek(-1); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); stepWeek(1); }
  else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); setT(WEEKS[0]); }
  else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); setT(AS_OF); }
});

/* ================================================================== detail sheet: one feature as a document */
function hmark(h) { return h === 'bad' ? 'BAD' : h === 'watch' ? 'WATCH' : h === 'good' ? 'GOOD' : 'N/A'; }
function row(k, v, c) { return '<div class="r"><span>' + k + '</span><b class="' + (c || '') + '">' + v + '</b></div>'; }
function plainLine(f) {
  var s = [];
  s.push('<b>' + esc(plainStage(f, f.stage)) + '.</b>');
  var ag = f.builtBy.filter(isAgent), hu = f.builtBy.filter(function (p) { return !isAgent(p); });
  if (f.builtBy.length) s.push('Built by ' + (ag.length ? (ag.length > 1 ? 'agents ' : 'agent ') + ag.map(pname).join(' & ') : '') + (hu.length ? (ag.length ? ' with ' : '') + hu.map(pname).join(' & ') : '') + '.');
  if (f.development.humanReviewed === false) s.push('<span class="bad">No human has reviewed the code.</span>');
  else if (f.development.humanReviewed === true) s.push('A human reviewed the code.');
  var dc = f.security.dataClass;
  if (dc === 'payment' || dc === 'personal') s.push('Handles ' + (dc === 'payment' ? 'card / payment' : 'personal') + ' data; security review ' + f.security.review.replace('-', ' ') + '.');
  if (f.business.customerRequests30d) s.push(f.business.customerRequests30d + ' studios asked for it in the last 30 days.');
  return s.join(' ');
}
function detailHTML(f) {
  var T = TILE[f.id], b = f.business, de = f.design, dv = f.development, op = f.operations, se = f.security, q = f.quality;
  var ag = function (id) { return esc(pname(id)) + (isAgent(id) ? '<span class="ag">AGENT</span>' : ''); };
  var o = '<div class="dh"><div class="bubble" title="Detail callout: detail number over feature id"><span class="a">' + T.idx + '</span><span class="b">' + esc(f.id) + '</span></div><div>' +
    '<div class="k">' + (SCALE > 1 ? esc(T.wing.bld.name) + ' › ' : '') + 'Wing ' + T.wing.def.letter + ' ' + esc(T.wing.def.name) + ' › ' + esc(D[f.domain].name) + ' › ' + esc(C[f.capability].name) + '<br>' + f.priority + ' · ' + f.kind + (f.milestone ? ' · ' + f.milestone + ' ' + esc(MS[f.milestone].name) : '') + '</div>' +
    '<h2>' + esc(f.name) + '</h2><div class="sum">' + esc(f.summary) + '</div><div class="plain">' + plainLine(f) + '</div>' +
    (f.flags.length || f.blockedBy.length ? '<div class="tens">' + f.flags.map(function (k) { return '<span><i></i>' + esc(FLAGS[FLAGNO[k]][1]) + '</span>'; }).join('') + (f.blockedBy.length ? '<span><i></i>Blocked by ' + f.blockedBy.map(function (x) { return '<button class="btn" style="height:24px;margin-left:4px;text-transform:none;font-size:14px" data-open="' + x + '">' + esc(F[x].name) + '</button>'; }).join(' ') + '</span>' : '') + '</div>' : '') +
    '</div></div>';
  o += '<div class="dgrid"><div>';
  o += '<div class="illo">' + illoSVG(D[f.domain].base, '#d6ecff') + '<span class="cap">DETAIL ' + T.idx + ' · ' + esc(D[f.domain].base) + ' · STYLISED</span></div>';
  o += '<div class="mtb"><div><span class="l">Drawn by</span>' + (f.builtBy.length ? f.builtBy.map(ag).join(', ') : '—') + '</div>' +
    '<div><span class="l">Checked by</span>' + (dv.humanReviewed === true ? 'Human review ✓' : dv.humanReviewed === false ? '<span class="nc">NOT CHECKED</span>' : 'n/a yet') + '</div>' +
    '<div><span class="l">Owner</span>' + esc(pname(f.owner)) + '</div><div><span class="l">Stage</span>' + STAGE_WORD[f.stage] + ' · since ' + f.stageSince + '</div>' +
    '<div class="full"><span class="l">Lives in</span>' + f.surfaces.map(function (s) { return '<span class="ag" style="margin:0 4px 0 0">' + esc(s) + '</span>'; }).join('') + '</div></div>';
  o += '<table class="revt"><tr><th>REV</th><th>DATE</th><th>DESCRIPTION</th></tr>' + f.history.map(function (h, i) { return '<tr class="' + (i === f.history.length - 1 ? 'now' : '') + '"><td class="m">' + String.fromCharCode(65 + i) + '</td><td class="m">' + h.date + '</td><td>' + REV_DESC[h.stage] + '</td></tr>'; }).join('') + '</table>';
  if (f.parts) o += '<div class="dsec"><h4>Parts · ' + f.parts.filter(function (p) { return p.done; }).length + ' of ' + f.parts.length + ' done</h4><div class="parts">' + f.parts.map(function (p) { return '<span class="' + (p.done ? 'd' : '') + '">' + (p.done ? '✓ ' : '○ ') + esc(p.name) + '</span>'; }).join('') + '</div></div>';
  o += '</div><div>';
  function pnl(k, title, h, rows, note, lens) { return '<div class="evp ' + h + (S.lens === lens ? ' cur' : '') + '"><h5><span>' + k + ' · ' + title + '</span><span class="h">' + hmark(h) + '</span></h5>' + rows + (note ? '<div class="note">' + esc(note) + '</div>' : '') + '</div>'; }
  var rp = op.flag ? op.flag.rolloutPct + '%' : (f.stage === 'live' ? '100%' : '—');
  o += '<div class="ev6">' +
    pnl('B-101', 'Business', b.health, row('Value', '●●●●●'.slice(0, b.value) + '○○○○○'.slice(0, 5 - b.value)) + row('Confidence', b.confidence) + row('Asks · 30 days', b.customerRequests30d) + row('Adoption', b.adoptionPct != null ? b.adoptionPct + '% of 412' : '—') + row('Revenue', b.revenueLink + (b.mrrImpactUsd ? ' · $' + b.mrrImpactUsd.toLocaleString('en-US') : '')), b.usageNote, 'business') +
    pnl('D-201', 'Design', de.health, row('Design status', de.status, de.status === 'none' ? 'watch' : '') + row('Accessibility', de.a11y, de.a11y === 'fail' ? 'bad' : de.a11y === 'partial' ? 'watch' : '') + row('Built as designed', de.specDrift ? 'NO, drift' : 'yes', de.specDrift ? 'bad' : ''), null, 'design') +
    pnl('S-301', 'Development', dv.health, row('Status', dv.status) + row('Progress', dv.progressPct + '%') + row('Written by agents', dv.aiAuthoredPct + '%') + row('Human reviewed', dv.humanReviewed === true ? 'yes' : dv.humanReviewed === false ? 'NO' : '—', dv.humanReviewed === false ? 'bad' : '') + row('Open PRs', dv.openPRs) + row('Unit coverage', dv.unitCoveragePct != null ? dv.unitCoveragePct + '%' : '—', dv.unitCoveragePct != null && dv.unitCoveragePct < 50 ? 'watch' : '') + row('Tech debt', dv.techDebt + ' / 3') + row('Lines · last commit', (dv.linesOfCode || 0).toLocaleString('en-US') + ' · ' + (dv.lastCommit || '—').slice(5)), null, 'development') +
    pnl('M-401', 'Operations', op.health, row('Environment', op.environment) + row('Rollout', rp) + row('SLO actual / target', op.sloActual != null ? op.sloActual + ' / ' + op.sloTarget : '—') + row('p95 latency', op.p95ms != null ? op.p95ms + ' ms' : '—') + row('Error rate', op.errorRatePct != null ? op.errorRatePct + '%' : '—') + row('Incidents · 30 d', op.incidents30d || 0, op.incidents30d ? 'bad' : '') + row('Alerting · runbook', (op.alerting ? 'yes' : 'NO') + ' · ' + (op.runbook ? 'yes' : 'no'), op.environment === 'production' && !op.alerting ? 'bad' : '') + row('Cost / month', op.costUsdMonth != null ? '$' + op.costUsdMonth : '—'), null, 'operations') +
    pnl('F-501', 'Security', se.health, row('Data class', se.dataClass, se.dataClass === 'payment' ? 'watch' : '') + row('Review', se.review, se.review === 'findings' ? 'bad' : (se.review === 'pending' || se.review === 'not-started') && (se.dataClass === 'payment' || se.dataClass === 'personal') ? 'bad' : '') + row('Open findings', se.openFindings, se.openFindings ? 'bad' : ''), null, 'security') +
    pnl('Q-601', 'Quality', q.health, row('Status', q.status, q.status === 'failing' ? 'bad' : '') + row('E2E passing', q.e2eTests ? q.e2ePassing + ' / ' + q.e2eTests : '—', q.e2eTests && q.e2ePassing < q.e2eTests ? 'watch' : '') + row('Bugs P1 · P2 · P3', q.openBugs.p1 + ' · ' + q.openBugs.p2 + ' · ' + q.openBugs.p3, q.openBugs.p1 ? 'bad' : ''), null, 'quality') +
    '</div>';
  function dl(ids, empty) { return ids.length ? ids.map(function (id) { var g = F[id]; return '<button data-open="' + id + '">' + sym(g.stage, 20, 13) + '<span>' + esc(g.name) + '</span><span class="w">' + STAGE_WORD[g.stage] + '</span></button>'; }).join('') : '<div class="none">' + empty + '</div>'; }
  o += '<div class="dsec deps"><div class="dl"><h4>Depends on · ' + f.dependsOn.length + '</h4>' + dl(f.dependsOn, 'Nothing, it stands on its own') + '</div><div class="dl"><h4>Used by · ' + f.usedBy.length + ' · blast radius ' + closure(f.id).length + '</h4>' + dl(f.usedBy, 'Nothing depends on it') + '</div></div>';
  if (f.notes.length) o += '<div class="dsec"><h4>Red-pencil notes</h4><div class="notes">' + f.notes.map(function (n) { return '<div class="pn">“' + esc(n.text) + '”<small>— ' + esc(pname(n.by)) + ', ' + n.date + '</small></div>'; }).join('') + '</div></div>';
  var acts = K.activity.filter(function (a) { return a.feature === f.id; }).slice(0, 8);
  o += '<div class="dsec"><h4>Recent activity · 14 days</h4>' + (acts.length ? '<ul class="acts">' + acts.map(function (a) { return '<li class="' + (a.type === 'incident' ? 'inc' : '') + '"><span class="m">' + a.at.slice(5, 10) + ' ' + a.at.slice(11, 16) + '</span><span class="a">' + esc(pname(a.actor)) + (isAgent(a.actor) ? ' ◇' : '') + '</span><span>' + esc(a.text) + (a.severity ? ' · ' + esc(a.severity) : '') + '</span></li>'; }).join('') + '</ul>' : '<div class="dl"><div class="none">Quiet, no events in the last 14 days</div></div>') + '</div>';
  o += '<div class="foot">Illustrative sample data · drawings are stylised, not screenshots</div>';
  o += '</div></div>';
  return o;
}

/* ================================================================== search */
var results = [], rsel = 0;
function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  var out = [];
  K.features.forEach(function (f) {
    var n = f.name.toLowerCase(), sc = 0;
    if (f.id.toLowerCase() === q) sc = 100;
    else if (n.indexOf(q) === 0) sc = 80;
    else if (n.split(/[\s&\-/]+/).some(function (w) { return w.indexOf(q) === 0; })) sc = 60;
    else if (n.indexOf(q) >= 0) sc = 50;
    else if (f.id.toLowerCase().indexOf(q) >= 0) sc = 45;
    else if (f.summary.toLowerCase().indexOf(q) >= 0) sc = 30;
    else if (D[f.domain].name.toLowerCase().indexOf(q) >= 0 || C[f.capability].name.toLowerCase().indexOf(q) >= 0) sc = 20;
    else { var ws = q.split(/\s+/); if (ws.length > 1 && ws.every(function (w) { return (n + ' ' + f.summary.toLowerCase()).indexOf(w) >= 0; })) sc = 25; }
    if (sc) out.push([sc, f]);
  });
  out.sort(function (a, b) { return b[0] - a[0] || (a[1].id < b[1].id ? -1 : 1); });
  return out.slice(0, 8).map(function (x) { return x[1]; });
}
function showResults() {
  var ul = $('#results'), q = $('#q').value;
  results = search(q); rsel = 0;
  if (!q.trim()) { closeResults(); return; }
  ul.style.display = 'block';
  if (!results.length) { ul.innerHTML = '<li class="none">No feature matches “' + esc(q) + '”. Try “gift”, “waitlist” or “tax”.</li>'; return; }
  ul.innerHTML = results.map(function (f, i) { return '<li role="option" data-open="' + f.id + '" class="' + (i === rsel ? 'on' : '') + '">' + sym(f.stage, 18, 12) + '<span class="t">' + esc(f.name) + '</span><span class="r">' + (SCALE > 1 ? esc(TILE[f.id].wing.bld.name.replace('Kettle ', '')) + ' · ' : '') + esc(D[f.domain].name) + ' · ' + STAGE_WORD[f.stage] + '</span></li>'; }).join('');
  previewResult();
}
function previewResult() {
  Array.prototype.forEach.call($('#results').children, function (li, i) { li.classList.toggle('on', i === rsel); });
  var f = results[rsel]; S.sel = f ? f.id : null; dirty();
}
function closeResults() { $('#results').style.display = 'none'; $('#results').innerHTML = ''; results = []; }
var q = $('#q');
q.addEventListener('input', showResults);
q.addEventListener('focus', function () { if (q.value) showResults(); });
q.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) { rsel = (rsel + 1) % results.length; previewResult(); } }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) { rsel = (rsel - 1 + results.length) % results.length; previewResult(); } }
  else if (e.key === 'Enter') { e.preventDefault(); var f = results[rsel]; if (f) { closeResults(); q.value = ''; q.blur(); S.sel = null; openFeature(f.id); } }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); q.value = ''; closeResults(); S.sel = null; dirty(); q.blur(); }
});

/* ================================================================== lens */
function setLens(k) {
  if (!SHEET[k] || k === S.lens) return;
  var v = $('#vellum');
  S.lens = k;
  document.documentElement.style.setProperty('--accent', SHEET[k].acc);
  renderTabs();
  var apply = function () { lastPlace = ''; dirty(); if (S.hover) hov.innerHTML = hoverHTML(S.hover); if (S.open) { var st = $('#dscroll').scrollTop; $('#dscroll').innerHTML = detailHTML(F[S.open]); $('#dscroll').scrollTop = st; } };
  if (reduced) apply(); else { v.classList.remove('go'); void v.offsetWidth; v.classList.add('go'); setTimeout(apply, 330); }
  renderTB(true); writeHashSoon();
}

/* ================================================================== global events */
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-open]');
  if (t && !t.closest('#map')) { e.preventDefault(); var id = t.getAttribute('data-open'); if (phone) { openPhone(id); return; } closeResults(); q.value = ''; if (t.closest('#callout') && S.blast) { S.blast = null; renderCallout(); syncTools(); } openFeature(id); return; }
  var c = e.target.closest('[data-crumb]');
  if (c) { var k = c.getAttribute('data-crumb'); if (k === 'home') { if (S.open) closeFeature(); goHome(); } else if (k === 'lvl') { if (S.open) { S.open = null; $('#detail').classList.remove('open'); camBefore = null; } var d = +c.getAttribute('data-depth'); flyTo(fitOf(PLACE[d - 1] || PLACE[PLACE.length - 1])); } return; }
  var l = e.target.closest('[data-lens]'); if (l) { setLens(l.getAttribute('data-lens')); return; }
  var z = e.target.closest('[data-zoom]'); if (z) { zoomAt(FW / 2, FH / 2, +z.getAttribute('data-zoom') > 0 ? 1.6 : 1 / 1.6); return; }
  var lv = e.target.closest('[data-level]'); if (lv) { var n = +lv.getAttribute('data-level'); if (n === levelNames().length - 1) { var T = nearestTile(); if (T) openFeature(T.id); } else { if (S.open) closeFeature(); goLevel(n); } return; }
  var a = e.target.closest('[data-act]');
  if (a) { var act = a.getAttribute('data-act'); if (act === 'unblast') setMode({ blast: null }); if (act === 'ungi') setMode({ ga: false }); return; }
  var kn = e.target.closest('.kn li'); if (kn) { var key = kn.getAttribute('data-key'); S.key = S.key === key ? null : key; renderPanel(); dirty(); return; }
  var d2 = e.target.closest('#tools .seg button'); if (d2) { S.delta = +d2.getAttribute('data-d'); renderTB(); syncTools(); lastPlace = ''; dirty(); writeHashSoon(); return; }
  if (!e.target.closest('#searchbox')) closeResults();
});
function nearestTile() { var best = null, bd = 1e18; TILES.forEach(function (T) { var d = Math.hypot(T.x + T.w / 2 - cam.x, T.y + T.h / 2 - cam.y); if (d < bd) { bd = d; best = T; } }); return best; }
document.addEventListener('pointerover', function (e) {
  var kn = e.target.closest && e.target.closest('.kn li');
  if (kn && !S.ga && !S.key) { var key = kn.getAttribute('data-key'); dimFnHover = key; S.key = key; S._kh = true; dirty(); return; }
  var hv = e.target.closest && e.target.closest('[data-hov]');
  if (hv) { S.hl = hv.getAttribute('data-hov'); dirty(); }
});
var dimFnHover = null;
document.addEventListener('pointerout', function (e) {
  var kn = e.target.closest && e.target.closest('.kn li');
  if (kn && S._kh && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.kn li'))) { S.key = null; S._kh = false; dirty(); }
  var hv = e.target.closest && e.target.closest('[data-hov]');
  if (hv && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-hov]'))) { S.hl = null; dirty(); }
});
document.addEventListener('click', function (e) { var kn = e.target.closest && e.target.closest('.kn li'); if (kn) S._kh = false; }, true);
$('#bga').addEventListener('click', function () { setMode({ ga: !S.ga, blast: null }); });
$('#bblast').addEventListener('click', toggleBlast);
$('#dclose').addEventListener('click', closeFeature);
$('#dblast').addEventListener('click', toggleBlast);
$('#skip').addEventListener('click', function () { endIntro(); });
document.addEventListener('keydown', function (e) {
  if (introOn) { endIntro(); if (e.key !== '/' && e.key !== 'Escape') return; }
  if (phone) { if (e.key === 'Escape') closePhone(); return; }
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  var kn = e.target.closest && e.target.closest('.kn li');
  if (kn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); kn.click(); return; }
  if (e.key === '/') { e.preventDefault(); q.focus(); q.select(); return; }
  if (e.key === 'Escape') { e.preventDefault(); goUp(); return; }
  if (/^[1-7]$/.test(e.key)) { setLens(SHEETS[+e.key - 1].k); return; }
  if (S.open && tag !== 'canvas') { if (e.key === 'b' || e.key === 'B') toggleBlast(); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); walk(1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); walk(-1); return; }
  if (e.key === '+' || e.key === '=') { zoomAt(FW / 2, FH / 2, 1.6); return; }
  if (e.key === '-' || e.key === '_') { zoomAt(FW / 2, FH / 2, 1 / 1.6); return; }
  if (e.key === '0' || e.key === 'Home') { goHome(); return; }
  if (e.key === 'Enter' && e.target === cv) { var T = nearestTile(); if (T && T.w * cam.k >= 96) openFeature(T.id); else clickAt(FW / 2, FH / 2); return; }
  if (e.key === 'b' || e.key === 'B') { toggleBlast(); return; }
  if (e.key === 'g' || e.key === 'G') { setMode({ ga: !S.ga, blast: null }); return; }
  if (e.key === '[') { stepWeek(-1); return; }
  if (e.key === ']') { stepWeek(1); return; }
});

/* ================================================================== hash (shareable state) */
var hashLock = false, hashTimer = 0;
function writeHashSoon() { clearTimeout(hashTimer); hashTimer = setTimeout(writeHash, 250); }
function writeHash() {
  if (hashLock) return;
  var p = [];
  if (S.lens !== 'general') p.push('lens=' + S.lens);
  if (S.open) p.push('open=' + S.open);
  else if (PLACE.length) p.push('at=' + encodeURIComponent(PLACE[PLACE.length - 1].o.id));
  if (S.t !== AS_OF) p.push('t=' + S.t);
  if (S.blast) p.push('blast=' + S.blast);
  if (S.ga) p.push('ga=1');
  if (S.key) p.push('key=' + S.key);
  if (S.delta !== 7) p.push('d=' + S.delta);
  var h = p.length ? '#' + p.join('&') : '';
  try { history.replaceState(null, '', location.pathname + location.search + h); } catch (err) { /* file:// may refuse */ }
}
function readHash() {
  var h = {}; location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) h[a[0]] = decodeURIComponent(a[1] || ''); });
  return h;
}
function applyHash(h) {
  hashLock = true;
  if (h.lens && SHEET[h.lens]) { S.lens = h.lens; document.documentElement.style.setProperty('--accent', SHEET[h.lens].acc); }
  if (h.d && [1, 7, 14].indexOf(+h.d) >= 0) S.delta = +h.d;
  if (h.t && /^\d{4}-\d\d-\d\d$/.test(h.t)) S.t = h.t > AS_OF ? AS_OF : h.t < WEEKS[0] ? WEEKS[0] : h.t;
  S.ga = h.ga === '1'; S.blast = h.blast && F[h.blast] ? h.blast : null; S.key = h.key && FLAGNO[h.key] != null ? h.key : null;
  renderTabs(); renderRevs(); renderTB(); renderCallout(); syncTools();
  cam = { x: HOME.x, y: HOME.y, k: HOME.k };
  if (h.at) {
    var target = null;
    BLDS.forEach(function (b) { if (b.id === h.at) target = { t: 'bld', o: b }; });
    WINGS.forEach(function (w) { if (w.id === h.at) target = { t: 'wing', o: w }; });
    if (ROOM[h.at]) target = { t: 'room', o: ROOM[h.at] };
    if (BAY[h.at]) target = { t: 'bay', o: BAY[h.at] };
    if (target) cam = fitOf(target);
  }
  if (S.blast || S.ga) setMode({ blast: S.blast, ga: S.ga });
  if (h.open && F[h.open]) { camBefore = null; openFeature(h.open, { dur: 0 }); camBefore = h.at ? null : { x: HOME.x, y: HOME.y, k: HOME.k }; }
  hashLock = false;
  lastPlace = ''; dirty();
}

/* ================================================================== phone reading view */
var phone = false;
function renderPhone() {
  var c = counts(K.features);
  var o = LEGDEFS + '<div class="ph-h"><div class="k">PROJECT KETTLE · SHEET G-001 · REV 27 · ' + AS_OF + '</div><h1>KETTLE</h1><p>' + esc(K.product.tagline) + '</p></div>' +
    '<div class="ph-sum"><div><b>' + NF + '</b>features</div><div><b>' + c.live + '</b>built · live</div><div><b>' + c.flagged + '</b>partly open</div><div><b>' + c.build + '</b>being built</div><div><b>' + c.paper + '</b>on paper</div><div class="tr"><b>' + K.features.filter(function (f) { return f.health === 'bad'; }).length + '</b>in trouble</div></div>' +
    '<input id="pq" type="search" placeholder="Find a feature…" aria-label="Search features">';
  BLDS.forEach(function (B) {
    if (SCALE > 1) o += '<div class="ph-wing" style="font-size:14px;color:#fff">' + esc(B.name) + '</div>';
    B.wings.forEach(function (W) {
      o += '<div class="ph-wing">Wing ' + W.def.letter + ' · ' + esc(W.def.name) + '</div>';
      W.rooms.forEach(function (R) {
        var a = aggLine(R.feats, false);
        o += '<details class="ph-dom"' + (SCALE === 1 ? ' open' : '') + '><summary>' + esc(R.d.name) + '<span>' + a.c.n + ' · ' + (a.c.live + a.c.flagged) + ' live' + (a.trouble ? ' · ' + a.trouble + ' trouble' : '') + '</span></summary>';
        R.bays.forEach(function (Bay) {
          o += '<h3>' + esc(Bay.cap.name) + '</h3>';
          Bay.tiles.forEach(function (T) { var f = T.f; o += '<button data-open="' + f.id + '" data-q="' + esc((f.id + ' ' + f.name + ' ' + f.summary).toLowerCase()) + '">' + sym(f.stage, 22, 14) + '<span>' + esc(f.name) + '</span><span style="color:' + (f.health === 'bad' ? '#ff5d4f' : f.health === 'watch' ? '#ffc35a' : 'transparent') + '">●</span></button>'; });
        });
        o += '</details>';
      });
    });
  });
  o += '<div class="foot">Illustrative sample data · drawings are stylised. Open on a wider screen for the zoomable plan.</div>';
  $('#phone').innerHTML = o;
  $('#pq').addEventListener('input', function () {
    var v = this.value.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll('#phone .ph-dom'), function (d) {
      var any = false;
      Array.prototype.forEach.call(d.querySelectorAll('button'), function (b) { var hit = !v || b.getAttribute('data-q').indexOf(v) >= 0; b.style.display = hit ? '' : 'none'; any = any || hit; });
      d.style.display = any ? '' : 'none'; if (v && any) d.open = true;
    });
  });
}
function openPhone(id) {
  var pd = $('#pdetail');
  pd.innerHTML = '<button class="btn back">‹ Back to the plan</button>' + detailHTML(F[id]);
  pd.classList.add('open'); pd.scrollTop = 0;
  pd.querySelector('.back').addEventListener('click', closePhone);
}
function closePhone() { $('#pdetail').classList.remove('open'); }

/* ================================================================== fit to window (fixed proportions, scaled as one) */
function fit() {
  var w = window.innerWidth, h = window.innerHeight, wasPhone = phone;
  phone = w < 760;
  document.body.classList.toggle('phone', phone); document.documentElement.classList.toggle('phone', phone);
  if (phone) { if (!wasPhone || !$('#phone').innerHTML) renderPhone(); return; }
  SC = Math.min(w / 1280, h / 800);
  var ox = (w - 1280 * SC) / 2, oy = (h - 800 * SC) / 2;
  $('#stage').style.transform = 'translate(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px) scale(' + SC.toFixed(5) + ')';
  var r = SC * (window.devicePixelRatio || 1);
  if (Math.abs(r - RES) > 1e-3 || cv.width !== Math.round(FW * r)) { RES = r; cv.width = Math.round(FW * RES); cv.height = Math.round(FH * RES); makePatterns(); }
  dirty();
}
window.addEventListener('resize', fit);

/* ================================================================== intro: the building is drawn left to right, in the order work began */
function endIntro() { if (!introOn) return; introOn = false; introP = 1; document.body.classList.remove('intro'); dirty(); }
function startIntro(play) {
  if (!play || reduced) { document.body.classList.remove('intro'); return; }
  introOn = true; introT0 = performance.now(); introP = 0; dirty();
}

/* ================================================================== boot */
fit();
var h0 = readHash();
applyHash(h0);
startIntro(h0.intro !== '0' && !phone && !h0.open && !h0.at);
window.addEventListener('hashchange', function () { if (!hashLock) applyHash(readHash()); });
if (document.fonts && document.fonts.load) Promise.all(['500 15px "IBM Plex Sans Condensed"', '600 21px "IBM Plex Sans Condensed"', '400 15px "IBM Plex Sans Condensed"', '500 12px "IBM Plex Mono"'].map(function (x) { return document.fonts.load(x); })).catch(function () {}).then(function () { TWC = {}; WRC = {}; lastPlace = ''; dirty(); });
window.__bp = { cam: function () { return cam; }, flyTo: flyTo, place: function () { return PLACE.map(function (c) { return c.t + ':' + c.o.id; }); }, fitOf: fitOf, ROOM: ROOM, BAY: BAY, WINGS: WINGS, HOME: HOME, open: openFeature, setLens: setLens, TILES: TILES };
})();
