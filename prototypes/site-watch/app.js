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
  { k: 'general', no: 'G-001', nm: 'General', title: 'General arrangement', sub: 'What is built, what is drawn, where the trouble is', acc: '#dff0ff' },
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
var S = { dtab: 'asks', lens: 'general', open: null, t: AS_OF, blast: null, ga: false, delta: 7, hover: null, key: null, sel: null, hl: null };

/* ================================================================== text measure */
var FONT = '"IBM Plex Sans Condensed","Roboto Condensed","Arial Narrow","Segoe UI",system-ui,sans-serif';
var MONO = '"IBM Plex Mono",Consolas,"Courier New",monospace';
function fnt(sz, wt, fam) { return (wt || 500) + ' ' + (Math.round(sz * U * 10) / 10) + 'px ' + (fam || FONT); }
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
  var cols = SCALE <= 2 ? SCALE : SCALE <= 4 ? 2 : 3, GX = 460, GY = 1040;
  for (var i = 1; i < K.buildings.length; i++) layoutBuilding(K.buildings[i], (i % cols) * (first.w + GX), Math.floor(i / cols) * (first.h + GY));
  var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  BLDS.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  WORLD = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})();
var WALK = ROOMS.slice();
/* ================================================================== canvas + camera (full-bleed; the chrome floats over it) */
var FW = 1280, FH = 800, RES = 1, U = 1, phone = false;
var SAFE = { l: 14, t: 72, r: 930, b: 686 };
var cv = $('#map'), ctx = cv.getContext('2d');
var cam = { x: 0, y: 0, k: 0.3 }, anim = null, wz = null, raf = 0, KMIN = 0.02, KMAX = 2.6;
function sxw(x) { return FW / 2 + (x - cam.x) * cam.k; }
function syw(y) { return FH / 2 + (y - cam.y) * cam.k; }
function wxs(x) { return cam.x + (x - FW / 2) / cam.k; }
function wys(y) { return cam.y + (y - FH / 2) / cam.k; }
var PADS = { site: { t: SCALE > 1 ? 100 : 122, r: 20, b: 70, l: 20 }, bld: { t: 196, r: 26, b: 56, l: 26 }, wing: { t: 124, r: 26, b: 56, l: 26 }, room: { t: 22, r: 22, b: 56, l: 22 }, bay: { t: 30, r: 30, b: 56, l: 30 } };
var OVER = { bld: 1, wing: 1.8, room: 1.3, bay: 1 };
/* fit a world box into the part of the screen the chrome leaves free */
function fitCam(box, pad, over, region) {
  var R = region || SAFE;
  var rx0 = R.l + pad.l * U, rx1 = R.r - pad.r * U, ry0 = R.t + pad.t * U, ry1 = R.b - pad.b * U;
  var rw = Math.max(80, rx1 - rx0), rh = Math.max(80, ry1 - ry0);
  var k = clamp(Math.min(rw / box.w, rh / box.h * (over || 1)), KMIN, KMAX), h = Math.min(box.h, rh / k);
  var sx = (rx0 + rx1) / 2, sy = (ry0 + ry1) / 2;
  return { x: box.x + box.w / 2 - (sx - FW / 2) / k, y: box.y + h / 2 - (sy - FH / 2) / k, k: k };
}
var HOME = { x: 0, y: 0, k: 0.2 }, KB1 = 0.2;
function computeHome() {
  KMIN = 0.02; HOME = fitCam(WORLD, PADS.site); KMIN = HOME.k * 0.8;
  KB1 = SCALE > 1 ? fitCam(BLDS[0], PADS.bld, OVER.bld).k : HOME.k;
}
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
function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
/* level of detail: 0 = the building is drawn as ribbons (calm), 1 = fixtures. Relative to one building filling the view. */
function lodTiles() { return smooth(1.2, 1.5, cam.k / KB1); }

/* ================================================================== THE SWARM: data, clock, events, decisions, orders, steering
   Simulated. Agents, decisions and events come from window.SWARM (sample data); nothing here talks to a real system. */
var SW0 = window.SWARM || null, HAS_SW = !!(SW0 && SW0.agents);
var AGS = [], AG = {}, DECS = [], DEC = {}, ORDS = [], EVS = [], SQS = {}, SQLIST = [], AGF = {}, DOF = {};
var AT0 = SW0 && SW0.asOf ? Date.parse(SW0.asOf) : Date.parse('2026-10-08T09:00:00Z');
var HOUR = 3600;
var PERSONS = K0.people.filter(function (p) { return p.kind === 'human'; });
var PERSON_LENS = { mara: 'business', dev: 'business', tomas: 'development', priya: 'operations', jonas: 'security', lea: 'design', sam: 'business', ines: 'quality' };
var LENS_CREWS = { business: ['scout'], design: ['warden', 'scout'], development: ['forge-1', 'forge-2', 'forge-3', 'forge-4'], operations: ['tender'], security: ['sentinel'], quality: ['warden'] };
var PK = { commit: 'c', 'tests-pass': 'ok', 'tests-fail': 'bad', 'pr-open': 'pr', 'task-done': 'ok', 'review-pass': 'ok', 'review-changes': 'bad', deploy: 'dep', 'flag-change': 'flag', alert: 'warn', 'spec-draft': 'c', note: 'c', finding: 'bad', 'scan-clean': 'ok', move: 'mv', 'decision-asked': 'ask' };
var TICK_CLASS = { 'tests-fail': 'bad', 'review-changes': 'bad', alert: 'bad', finding: 'bad', 'tests-pass': 'ok', deploy: 'ok', 'review-pass': 'ok', 'task-done': 'ok', 'scan-clean': 'ok', 'decision-asked': 'ask' };
var SIM = { t: 0, playing: true, speed: 8, i: 0, log: [], pulses: [], heat: {}, roll: {}, prog: {}, undo: null, over: false, breaches: 0, tally: {}, toastT: 0 };
S.who = null; S.tgt = { ids: {}, n: 0, label: '' }; S.prev = null; S.dec = null; S.ordHi = null; S.crewHi = null;
function hash01(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
function crewCode(id) { var m = /^(forge|warden|tender|scout|sentinel)(?:-(\d))?\.(\d+)/.exec(id); if (!m) return id; return ({ forge: 'F' + m[2], warden: 'WD', tender: 'TD', scout: 'SC', sentinel: 'SN' })[m[1]] + '.' + m[3]; }
function crewName(sq) { return SQS[sq] ? SQS[sq].name.replace(' crew', '') : sq; }
function astat(a) { return a.paused ? 'paused' : a.status; }
function msOf(fid) { return F[fid] ? F[fid].milestone : null; }
function placeName(fid) { var f = F[fid]; return f ? D[f.domain].name + ' › ' + C[f.capability].name : ''; }
function baseId(id) { return id.replace(/-[A-Z]$/, ''); }

function buildSwarm() {
  AGS = []; AG = {}; DECS = []; DEC = {}; ORDS = []; EVS = []; SQS = {}; SQLIST = [];
  if (!HAS_SW) return;
  SW0.squads.forEach(function (q) { SQS[q.id] = q; SQLIST.push(q); });
  for (var b = 0; b < SCALE; b++) {
    var sf = SCALE > 1 ? '-' + LINES[b][1] : '';
    SW0.agents.forEach(function (a) {
      var g = { id: a.id + sf, base: a.id, b: b, sq: a.squad, role: a.role, status: a.status, f: a.feature + sf, task: a.task, pct: a.progressPct, since: Date.parse(a.since), tpm: a.tokensPerMin, cost: a.costUsdToday, done: a.doneToday, wait: a.waitingOn ? a.waitingOn + sf : null, blk: a.blockedBy ? a.blockedBy + sf : null, ph: hash01(a.id + sf) * 6.2832, paused: false, tr: null, flash: 0, synth: false, nextSynth: 0, code: crewCode(a.id) };
      AGS.push(g); AG[g.id] = g;
    });
    SW0.decisions.forEach(function (d) {
      var g = { id: d.id + sf, base: d.id, b: b, f: d.feature + sf, dom: d.domain + sf, lens: d.lens, decider: d.decider, by: d.askedBy + sf, q: d.question, opts: d.options, rec: d.recommended, urg: d.urgency, since: Date.parse(d.waitingSince), blocks: d.blocksAgents, freed: 0, affects: d.affects.map(function (x) { return x + sf; }), arr: d.arrivesAt || 0, open: !d.arrivesAt, ans: null, isNew: false };
      DECS.push(g); DEC[g.id] = g;
    });
    SW0.replay.forEach(function (e) { EVS.push({ t: e.t, agent: e.agent + sf, f: e.feature + sf, type: e.type, text: e.text, from: e.from ? e.from + sf : null, dec: e.decision ? e.decision + sf : null }); });
  }
  EVS.sort(function (a, b) { return a.t - b.t; });
  SW0.orders.forEach(function (o) { ORDS.push({ id: o.id, by: o.by, lens: o.lens, scope: o.scope, text: o.text, since: o.since, n: o.violations, vf: [], user: false }); });
  computeViolations();
  indexAgents(); indexDecisions();
}
function rolloutOf(f) { var r = SIM.roll[f.id]; if (r != null) return r; return f.operations.flag ? f.operations.flag.rolloutPct : (isLiveSt(f.stage) ? 100 : 0); }
/* Violations are derived from the product data, ranked by severity, and cut to the count the order reports. */
function computeViolations() {
  var rules = {
    'O-1': { rank: function (f) { return isLiveSt(f.stage) && f.security.dataClass === 'payment' && f.security.review !== 'passed' && f.security.review !== 'not-required' && rolloutOf(f) > 10 ? rolloutOf(f) : null; }, desc: true },
    'O-2': { rank: function (f) { return (f.stage === 'in-review' || isLiveSt(f.stage)) && f.development.unitCoveragePct != null && f.development.unitCoveragePct < 70 ? f.development.unitCoveragePct : null; }, desc: false },
    'O-3': { rank: function (f) { var m = (!f.operations.alerting ? 1 : 0) + (!f.operations.runbook ? 1 : 0); return isLiveSt(f.stage) && m && rolloutOf(f) >= 50 ? m * 1000 + rolloutOf(f) : null; }, desc: true, asc2: true },
    'O-5': { rank: function (f) { return /kiosk/i.test(f.name + ' ' + f.summary) && f.design.a11y === 'fail' ? 1 : null; }, desc: true }
  };
  ORDS.forEach(function (o) {
    var r = rules[o.id]; if (!r) return;
    var c = [];
    K0.features.forEach(function (f) { var v = r.rank(f); if (v != null) c.push([v, f.id]); });
    c.sort(function (a, b) { return r.desc ? b[0] - a[0] : a[0] - b[0]; });
    var ids = c.slice(0, o.n).map(function (x) { return x[1]; });
    for (var b = 0; b < SCALE; b++) { var sf = SCALE > 1 ? '-' + LINES[b][1] : ''; ids.forEach(function (id) { o.vf.push(id + sf); }); }
  });
}
function indexAgents() { AGF = {}; AGS.forEach(function (a) { (AGF[a.f] = AGF[a.f] || []).push(a); }); }
function indexDecisions() { DOF = {}; DECS.forEach(function (d) { if (d.open) (DOF[d.f] = DOF[d.f] || []).push(d); }); }
function openDecs() { return DECS.filter(function (d) { return d.open; }); }
function blocksNow(d) { return Math.max(0, d.blocks - d.freed); }
function dWaitMin(d) { return Math.max(0, Math.round((AT0 + SIM.t * 1000 - d.since) / 60000)); }
function fmtWait(m) { return m >= 120 ? Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '') : m >= 60 ? '1 h ' + (m % 60) + ' min' : m + ' min'; }
function dScore(d) { return ({ high: 3, medium: 2, low: 1 })[d.urg] * 1e6 + blocksNow(d) * 1e4 + Math.min(9999, dWaitMin(d)); }
function emph(d) { return S.who ? d.decider === S.who : (S.lens === 'general' || d.lens === S.lens); }
function crewRelevant(a) { return S.lens === 'general' || (LENS_CREWS[S.lens] || []).indexOf(a.sq) >= 0; }
function queueFor() {
  var open = openDecs().sort(function (a, b) { return dScore(b) - dScore(a); });
  var mine = S.who ? open.filter(function (d) { return d.decider === S.who; }) : [];
  var rest = open.filter(function (d) { return mine.indexOf(d) < 0; });
  if (!S.who && S.lens !== 'general') rest.sort(function (a, b) { return (b.lens === S.lens) - (a.lens === S.lens) || dScore(b) - dScore(a); });
  return { mine: mine, rest: rest, all: open };
}
function swStats(fs) {
  var s = { n: 0, working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0, asks: 0, high: 0, mine: 0 };
  fs.forEach(function (f) {
    (AGF[f.id] || []).forEach(function (a) { s.n++; s[astat(a)]++; });
    (DOF[f.id] || []).forEach(function (d) { s.asks++; if (d.urg === 'high') s.high++; if (emph(d)) s.mine++; });
  });
  return s;
}
function agentsIn(ids) { var o = []; AGS.forEach(function (a) { if (ids[a.f]) o.push(a); }); return o; }

/* ---------- visual events */
function pulse(f, kind) { if (!TILE[f]) return; SIM.pulses.push({ f: f, k: kind, t0: performance.now() }); if (SIM.pulses.length > 90) SIM.pulses.shift(); SIM.heat[f] = { v: Math.min(6, heatNow(f) + (kind === 'c' ? 1 : 2)), t: performance.now() }; dirty(); }
function heatNow(f) { var h = SIM.heat[f]; return h ? h.v * Math.exp(-(performance.now() - h.t) / 9000) : 0; }
function travelAgent(a, to) {
  if (a.f === to) return;
  a.tr = { from: a.f, to: to, t0: performance.now(), dur: 1700 }; a.f = to; indexAgents(); a.flash = performance.now(); dirty();
}
function applyEvent(e) {
  var A = AG[e.agent], f = e.f;
  if (!F[f]) return;
  SIM.log.unshift(e); if (SIM.log.length > 400) SIM.log.pop();
  SIM.tally[e.type] = (SIM.tally[e.type] || 0) + 1;
  var t = e.type;
  if (t === 'move') { if (A) { travelAgent(A, f); if (A.status === 'working') A.task = 'moved here: ' + F[f].name; } }
  else if (t === 'commit') SIM.prog[f] = (SIM.prog[f] || 0) + 0.7;
  else if (t === 'flag-change') { var m = /(\d+)%/.exec(e.text); if (m) { SIM.roll[f] = +m[1]; breachCheck(f, +m[1]); } }
  else if (t === 'task-done') { if (A) { A.done++; A.pct = 3; } }
  else if (t === 'decision-asked') { var d = DEC[e.dec]; if (d) openDecision(d, A); }
  pulse(f, PK[t] || 'c');
  if (A) A.act = performance.now();
  uiEvent(e);
}
function openDecision(d, A) {
  d.open = true; d.isNew = true; d.since = AT0 + SIM.t * 1000;
  if (A && A.status === 'working') { A.status = 'waiting'; A.wait = d.id; A.task = 'waiting: ' + d.q; }
  indexDecisions(); pulse(d.f, 'ask');
  uiToast('<b>New question</b> from ' + esc(A ? A.base : 'an agent') + ' · ' + esc(F[d.f].name) + ' · for ' + esc(pname(d.decider)), null);
  uiQueue();
}
function breachCheck(f, pct) {
  var ft = F[f]; if (!ft) return;
  var o1 = ORDS.filter(function (o) { return o.id === 'O-1'; })[0], o3 = ORDS.filter(function (o) { return o.id === 'O-3'; })[0];
  function add(o, why) { if (o && o.vf.indexOf(f) < 0) { o.vf.push(f); o.n++; SIM.breaches++; pulse(f, 'bad'); uiToast('<b>Order ' + o.id + ' breached</b> at ' + esc(ft.name) + ' · ' + esc(why), f); uiOrders(); } }
  if (pct > 10 && ft.security.dataClass === 'payment' && ft.security.review !== 'passed' && ft.security.review !== 'not-required') add(o1, 'card data above 10% without a security review');
  if (pct >= 50 && isLiveSt(ft.stage) && (!ft.operations.alerting || !ft.operations.runbook)) add(o3, 'rollout ' + pct + '% without ' + (!ft.operations.alerting ? 'an alert' : 'a runbook'));
}
function advance(dtMs) {
  if (!HAS_SW || !SIM.playing || S.t !== AS_OF) return;
  var dt = Math.min(dtMs, 90) / 1000 * SIM.speed, last = SIM.t;
  SIM.t = Math.min(HOUR, SIM.t + dt);
  while (SIM.i < EVS.length && EVS[SIM.i].t <= SIM.t) applyEvent(EVS[SIM.i++]);
  var step = SIM.t - last;
  AGS.forEach(function (a) {
    if (a.status === 'working' && !a.paused) a.pct = Math.min(99, a.pct + step * 0.012);
    if (a.synth && !a.paused && SIM.t >= a.nextSynth && F[a.f]) {
      a.nextSynth = SIM.t + 12 + hash01(a.id + SIM.t) * 26;
      applyEvent({ t: SIM.t, agent: a.id, f: a.f, type: 'commit', text: ((1 + Math.floor(hash01(a.id + a.f + SIM.t) * 5)) + ' commits on ' + F[a.f].name), syn: true });
    }
  });
  if (SIM.t >= HOUR) { SIM.playing = false; SIM.over = true; uiToast('<b>The hour is over.</b> That was the simulated swarm’s next 60 minutes.', null, 'replay'); }
  uiClock();
}
function simSeek(t) {
  t = clamp(t, 0, HOUR); if (t <= SIM.t) return;
  var was = SIM.playing, sp = SIM.speed;
  while (SIM.i < EVS.length && EVS[SIM.i].t <= t) { applyEvent(EVS[SIM.i++]); }
  AGS.forEach(function (a) { if (a.status === 'working' && !a.paused) a.pct = Math.min(99, a.pct + (t - SIM.t) * 0.012); });
  SIM.t = t; SIM.playing = was; SIM.speed = sp; uiClock(); dirty();
}
function resetSwarm() {
  SIM = { t: 0, playing: true, speed: SIM.speed || 8, i: 0, log: [], pulses: [], heat: {}, roll: {}, prog: {}, undo: null, over: false, breaches: 0, tally: {}, toastT: 0 };
  S.tgt = { ids: {}, n: 0, label: '' }; S.prev = null; S.dec = null;
  buildSwarm(); uiAll(); dirty();
}

/* ---------- deciding */
function decide(id, oi) {
  var d = DEC[id]; if (!d || !d.open) return;
  var freed = AGS.filter(function (a) { return a.wait === id; });
  var snap = freed.map(function (a) { return { a: a, status: a.status, task: a.task, wait: a.wait, pct: a.pct }; });
  d.open = false; d.isNew = false; d.ans = { opt: oi, t: SIM.t, at: performance.now() };
  freed.forEach(function (a) { a.status = 'working'; a.wait = null; a.task = 'resumed after the decision: ' + d.opts[oi].label; a.flash = performance.now(); a.synth = true; a.nextSynth = SIM.t + 3 + hash01(a.id) * 10; });
  d.freed += freed.length;
  d.freedIds = freed.map(function (a) { return a.id; });
  SIM.undo = { d: d, snap: snap, oi: oi };
  indexDecisions(); pulse(d.f, 'ok'); d.affects.forEach(function (x) { if (TILE[x]) pulse(x, 'ok'); });
  S.dec = null;
  var n = freed.length;
  uiToast('<b>Decided</b> · ' + esc(d.opts[oi].label) + (n ? ' · ' + n + ' agent' + (n > 1 ? 's' : '') + ' back to work' : ' · nobody was blocked') + ' · ' + d.affects.length + ' feature' + (d.affects.length > 1 ? 's' : '') + ' touched', null, 'undo');
  uiQueue(); uiVitals(); uiDcard(); uiSel(); dirty();
}
function undoDecision() {
  var u = SIM.undo; if (!u) return;
  u.d.open = true; u.d.ans = null; u.d.freed = Math.max(0, u.d.freed - u.snap.length);
  u.snap.forEach(function (s) { s.a.status = s.status; s.a.task = s.task; s.a.wait = s.wait; s.a.pct = s.pct; s.a.synth = false; });
  SIM.undo = null; indexDecisions(); uiQueue(); uiVitals(); uiToast('Decision taken back · the question is open again', null); dirty();
}

/* ---------- orders: where they bite */
function orderFeats(o) {
  var ids = {}, sc = o.scope || {};
  K.features.forEach(function (f) {
    var hit = false;
    if (sc.all) hit = true;
    else if (sc.domain) hit = f.domain === sc.domain || baseId(f.domain) === sc.domain;
    else if (sc.milestone) hit = f.milestone === sc.milestone;
    else if (sc.surface) hit = new RegExp(sc.surface, 'i').test(f.name + ' ' + f.summary) || f.surfaces.indexOf(sc.surface) >= 0;
    else if (sc.feats) hit = !!sc.feats[f.id];
    if (hit) ids[f.id] = 1;
  });
  return ids;
}
function scopeWords(o) {
  var sc = o.scope || {};
  if (sc.all) return 'Whole product';
  if (sc.domain) { var d = K0.domains.filter(function (x) { return x.id === sc.domain; })[0]; return d ? d.name : sc.domain; }
  if (sc.milestone) return MS[sc.milestone].name + ' (' + sc.milestone + ')';
  if (sc.surface) return 'Everything touching the ' + sc.surface;
  if (sc.feats) return sc.label || 'Targeted places';
  return '';
}
var ORDCACHE = null;
function ordMap() { if (!ORDCACHE) { ORDCACHE = {}; ORDS.forEach(function (o) { ORDCACHE[o.id] = orderFeats(o); }); } return ORDCACHE; }
function ordersOn(fid) { var m = ordMap(), out = []; ORDS.forEach(function (o) { if (m[o.id] && m[o.id][fid]) out.push(o); }); return out; }
function breachesOn(fid) { return ORDS.filter(function (o) { return o.vf.indexOf(fid) >= 0; }); }

/* ---------- targeting + steering (every command is previewed before it is committed) */
function setTarget(ids, label) {
  var n = 0; for (var k in ids) n++;
  S.tgt = { ids: ids, n: n, label: label || '' };
  S.prev = null; uiSel(); dirty();
}
function clearTarget() { if (!S.tgt.n && !S.prev) return; S.tgt = { ids: {}, n: 0, label: '' }; S.prev = null; uiSel(); uiSteer(); dirty(); }
function targetOf(o, t) {
  var ids = {};
  (t === 'wing' ? o.feats : t === 'room' ? o.feats : t === 'bay' ? o.feats : t === 'bld' ? o.feats : []).forEach(function (f) { ids[f.id] = 1; });
  return ids;
}
function prioNum(f) { return { P0: 0, P1: 1, P2: 2, P3: 3 }[f.priority] || 2; }
function wingList(agents) {
  var m = {}; agents.forEach(function (a) { var w = TILE[a.f] ? TILE[a.f].wing.def.name : '?'; m[w] = (m[w] || 0) + 1; });
  return Object.keys(m).map(function (k) { return m[k] + ' in ' + k; }).join(', ');
}
function mkPush(title, donors, targets, extra) {
  if (!donors.length || !targets.length) return null;
  var tg = targets.slice().sort(function (a, b) { return (AGF[a.id] || []).length - (AGF[b.id] || []).length || prioNum(a) - prioNum(b); });
  var moves = donors.map(function (a, i) { return { a: a, to: tg[i % tg.length].id }; });
  var waiting = donors.filter(function (a) { return a.status === 'waiting'; });
  var lines = [donors.length + ' agent' + (donors.length > 1 ? 's' : '') + ' leave their work (' + wingList(donors) + ')'];
  if (waiting.length) lines.push(waiting.length + ' of them were waiting on a person; those questions stay open but stop blocking anyone');
  var tf = {}; targets.forEach(function (f) { tf[f.id] = 1; });
  lines.push(targets.length + ' feature' + (targets.length > 1 ? 's' : '') + ' get more hands: ' + tg.slice(0, 3).map(function (f) { return f.name; }).join(', ') + (tg.length > 3 ? ' and ' + (tg.length - 3) + ' more' : ''));
  (extra || []).forEach(function (l) { lines.push(l); });
  return { kind: 'push', title: title, moves: moves, targets: tf, paused: [], lines: lines, n: donors.length };
}
function previewGA() {
  var donors = AGS.filter(function (a) { var m = msOf(a.f); return (m === 'M3' || m === 'M4') && a.status !== 'failed' && !a.paused; });
  var targets = K.features.filter(function (f) { return f.milestone === 'M2' && f.stage !== 'live'; });
  var p = mkPush('Payments GA first', donors, targets, ['Standing order O-4 (Mara) already allows pulling agents from M3 and M4', 'M3 Multi-location and M4 Assistant slow down until you send the agents back']);
  if (p) p.order = 'O-4'; return p;
}
function previewPushHere() {
  var ids = S.tgt.ids; if (!S.tgt.n) return null;
  var targets = K.features.filter(function (f) { return ids[f.id] && f.stage !== 'live' && f.stage !== 'deprecated'; });
  var rank = function (a) { var m = msOf(a.f); return m === 'M3' || m === 'M4' ? 0 : m == null ? 1 : m === 'M1' ? 2 : 3; };
  var donors = AGS.filter(function (a) { return !ids[a.f] && a.status === 'working' && !a.paused && msOf(a.f) !== 'M2'; }).sort(function (a, b) { return rank(a) - rank(b) || (a.pct - b.pct); }).slice(0, 5);
  return mkPush('Put the swarm on ' + (S.tgt.label || 'this selection'), donors, targets, ['Only agents that are working and not on Payments GA are pulled']);
}
function previewPause(resume) {
  var ids = S.tgt.ids; if (!S.tgt.n) return null;
  var ag = agentsIn(ids).filter(function (a) { return resume ? a.paused : (!a.paused && a.status !== 'failed'); });
  if (!ag.length) return null;
  var asks = {}; ag.forEach(function (a) { if (a.wait && DEC[a.wait] && DEC[a.wait].open) asks[a.wait] = 1; });
  var n = Object.keys(asks).length;
  return { kind: resume ? 'resume' : 'pause', title: (resume ? 'Resume ' : 'Pause ') + ag.length + ' agent' + (ag.length > 1 ? 's' : '') + ' on ' + (S.tgt.label || 'the selection'), moves: [], targets: ids, paused: ag, lines: [ag.length + ' agent' + (ag.length > 1 ? 's' : '') + (resume ? ' pick up where they stopped' : ' stop where they are: no work is lost'), n ? n + ' open question' + (n > 1 ? 's' : '') + ' stay' + (n > 1 ? '' : 's') + ' open' : 'No open question is affected'], n: ag.length };
}
function previewOrder(tpl) {
  var ids = S.tgt.ids; if (!S.tgt.n) return null;
  var T = { review: 'Needs a human review before it merges', ask: 'Agents ask me before any rollout above 10%', first: 'Agents here go first, other work waits', hold: 'Hold: no new work starts here until I say' }[tpl];
  var gov = K.features.filter(function (f) { return ids[f.id]; }).length;
  return { kind: 'order', title: 'Standing order: ' + T, moves: [], targets: ids, paused: [], tpl: tpl, text: T, lines: ['Written on ' + gov + ' feature' + (gov > 1 ? 's' : '') + ' (' + (S.tgt.label || 'selection') + ')', 'Shows as a stamp on those places; a breach is marked where it happens', 'Agents read it before their next task'], n: 0 };
}
function previewResearch() {
  var ag = AGS.filter(function (a) { return a.sq === 'scout' && !a.paused; });
  if (!ag.length) return null;
  var ids = {}; ag.forEach(function (a) { ids[a.f] = 1; });
  return { kind: 'pause', title: 'Pause the research crew', moves: [], targets: ids, paused: ag, lines: [ag.length + ' research agents stop (spend cap order O-7 says research goes first)', 'Today’s swarm spend: $' + Math.round(AGS.reduce(function (s, a) { return s + a.cost; }, 0)).toLocaleString('en-US') + ' of the $2,400 cap'], n: ag.length, order: 'O-7' };
}
function setPreview(p) { S.prev = p; uiSteer(); uiSel(); dirty(); }
function commitPreview() {
  var p = S.prev; if (!p) return;
  var snap = [];
  if (p.kind === 'push') {
    p.moves.forEach(function (m) {
      var a = m.a; snap.push({ a: a, f: a.f, status: a.status, task: a.task, wait: a.wait, paused: a.paused, synth: a.synth });
      if (a.wait && DEC[a.wait]) DEC[a.wait].freed++;
      a.status = 'working'; a.wait = null; a.paused = false; a.synth = true; a.nextSynth = SIM.t + 4 + hash01(a.id) * 14; a.task = 'joined the push: ' + F[m.to].name;
      travelAgent(a, m.to);
    });
  } else if (p.kind === 'pause' || p.kind === 'resume') {
    p.paused.forEach(function (a) { snap.push({ a: a, f: a.f, status: a.status, task: a.task, wait: a.wait, paused: a.paused, synth: a.synth }); a.paused = p.kind === 'pause'; a.flash = performance.now(); });
  } else if (p.kind === 'order') {
    var no = 'O-' + (ORDS.length + 1), who = S.who || 'mara';
    ORDS.push({ id: no, by: who, lens: PERSON_LENS[who] || 'business', scope: { feats: p.targets, label: S.tgt.label }, text: p.text, since: AT0 ? new Date(AT0 + SIM.t * 1000).toISOString().slice(0, 10) : AS_OF, n: 0, vf: [], user: true });
    ORDCACHE = null; snap.push({ order: no });
  }
  SIM.undo2 = { snap: snap, kind: p.kind };
  var msg = p.kind === 'push' ? '<b>Addendum issued · ' + p.n + ' agents are moving</b> · ' + esc(p.title) : p.kind === 'order' ? '<b>Order written</b> · ' + esc(p.text) : '<b>' + esc(p.title) + '</b>';
  S.prev = null; indexAgents(); indexDecisions(); uiToast(msg, null, 'undo2'); uiQueue(); uiSteer(); uiOrders(); uiSel(); uiVitals(); dirty();
}
function undoCommand() {
  var u = SIM.undo2; if (!u) return;
  u.snap.forEach(function (s) {
    if (s.order) { ORDS = ORDS.filter(function (o) { return o.id !== s.order; }); ORDCACHE = null; return; }
    var a = s.a; a.status = s.status; a.task = s.task; a.wait = s.wait; a.paused = s.paused; a.synth = s.synth; if (a.f !== s.f) travelAgent(a, s.f);
  });
  SIM.undo2 = null; indexAgents(); uiToast('Command taken back', null); uiQueue(); uiSteer(); uiOrders(); uiVitals(); dirty();
}

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
  mkPat('hS', 7, function (g, s) { diag(g, s, 'rgba(223,240,255,.6)', 1, 1); });
  mkPat('hX', 5, function (g, s) { diag(g, s, 'rgba(223,240,255,.55)', 0.8, 1); diag(g, s, 'rgba(223,240,255,.55)', 0.8, -1); });
  mkPat('sPay', 4, function (g, s) { g.fillStyle = 'rgba(255,120,95,.16)'; g.fillRect(0, 0, s, s); diag(g, s, 'rgba(255,143,120,.9)', 0.9, 1); diag(g, s, 'rgba(255,143,120,.9)', 0.9, -1); });
  mkPat('sPer', 6, function (g, s) { diag(g, s, 'rgba(255,194,176,.62)', 1, -1); });
  mkPat('sInt', 6, function (g, s) { g.fillStyle = 'rgba(223,240,255,.55)'; g.beginPath(); g.arc(3, 3, 0.9, 0, 7); g.fill(); });
  mkPat('dSk', 9, function (g, s) { diag(g, s, 'rgba(242,182,255,.45)', 0.8, 1); });
  mkPat('dWf', 5, function (g, s) { diag(g, s, 'rgba(242,182,255,.55)', 0.8, 1); });
  mkPat('dHf', 4.5, function (g, s) { diag(g, s, 'rgba(242,182,255,.6)', 0.75, 1); diag(g, s, 'rgba(242,182,255,.6)', 0.75, -1); });
  mkPat('qF', 4, function (g, s) { g.fillStyle = 'rgba(255,106,88,.18)'; g.fillRect(0, 0, s, s); diag(g, s, '#ff6a58', 1, 1); });
  mkPat('poche', 5, function (g, s) { g.fillStyle = '#0c2f57'; g.fillRect(0, 0, s, s); diag(g, s, 'rgba(223,240,255,.75)', 1.1, 1); });
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
var GOOD = 'rgba(223,240,255,.62)';
function barSegs(c) {
  if (S.lens === 'general' || S.t !== AS_OF) return [[c.live, 'rgba(223,240,255,.85)'], [c.flagged, 'rgba(223,240,255,.5)'], [c.build, 'hatch'], [c.paper + c.none, 'rgba(223,240,255,.08)'], [c.dep, 'rgba(255,106,88,.4)']];
  return [[c.good, GOOD], [c.watch, '#ffc35a'], [c.bad, '#ff6a58'], [c.na, 'rgba(223,240,255,.12)']];
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
  var mm = /(\d+(?:\.\d+)?)px/.exec(f); if (mm && (window.__minFont == null || +mm[1] < window.__minFont)) window.__minFont = +mm[1];
  if ('letterSpacing' in ctx) ctx.letterSpacing = (ls || 0) + 'px';
  if (halo) { ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = halo; ctx.strokeText(t, x, y); }
  ctx.fillStyle = col; ctx.fillText(t, x, y);
  if (ls && 'letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
function drawBar(x, y, w, h, c) {
  var segs = barSegs(c), tot = segs.reduce(function (a, s) { return a + s[0]; }, 0) || 1, xx = x;
  segs.forEach(function (s) {
    var sw = w * s[0] / tot; if (sw <= 0) return;
    if (s[1] === 'hatch') { ctx.fillStyle = 'rgba(223,240,255,.12)'; ctx.fillRect(xx, y, sw, h); ctx.fillStyle = pat('hS'); ctx.fillRect(xx, y, sw, h); }
    else { ctx.fillStyle = s[1]; ctx.fillRect(xx, y, sw, h); }
    xx += sw;
  });
  ctx.strokeStyle = 'rgba(223,240,255,.55)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
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
    if (st === 'flagged' && f.operations.flag) return [w, rolloutOf(f) + '%'];
    if (st === 'in-dev') return [w, Math.round(progOf(f)) + '%'];
    return [w];
  }
  if (L === 'business') { var b = f.business; return ['VALUE ' + b.value, b.customerRequests30d ? b.customerRequests30d + ' ASKS' : null, b.revenueLink === 'direct' ? '$' : null].filter(Boolean); }
  if (L === 'design') return [{ none: 'NO DESIGN', sketch: 'SKETCH', wireframe: 'WIREFRAME', 'hi-fi': 'HI-FI', implemented: 'BUILT', polished: 'POLISHED', 'n/a': 'N/A' }[f.design.status], f.design.a11y === 'fail' ? 'A11Y FAIL' : null].filter(Boolean);
  if (L === 'development') { var dv = f.development; return [dv.progressPct < 100 ? Math.round(progOf(f)) + '%' : null, 'AI ' + dv.aiAuthoredPct + '%', dv.unitCoveragePct != null && dv.progressPct > 0 ? 'COV ' + dv.unitCoveragePct : null].filter(Boolean); }
  if (L === 'operations') { var op = f.operations; if (op.environment !== 'production') return [op.environment === 'none' ? 'NOT DEPLOYED' : op.environment.toUpperCase()]; return [(op.flag ? rolloutOf(f) : 100) + '%', op.p95ms != null ? op.p95ms + 'MS' : null, op.errorRatePct != null ? op.errorRatePct + '% ERR' : null].filter(Boolean); }
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
    if (st === 'live') { ctx.fillStyle = 'rgba(223,240,255,.22)'; ctx.fillRect(x, y, w, h); }
    else if (st === 'flagged') {
      var p = f.stage === 'flagged' && f.operations.flag && S.t === AS_OF ? rolloutOf(f) : 50;
      ctx.fillStyle = 'rgba(223,240,255,.3)'; ctx.fillRect(x, y, w * p / 100, h);
      ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x + w * p / 100, y); ctx.lineTo(x + w * p / 100, y + h); ctx.stroke(); ctx.setLineDash([]);
    } else if (st === 'in-review') { ctx.fillStyle = pat('hX'); ctx.fillRect(x, y, w, h); }
    else if (st === 'in-dev') {
      ctx.fillStyle = pat('hS'); ctx.fillRect(x, y, w, h);
      if (S.t === AS_OF) { var bh = clamp(h * 0.07, 2, 5); ctx.fillStyle = '#dff0ff'; ctx.fillRect(x, y + h - bh, w * progOf(f) / 100, bh); }
    } else if (st === 'deprecated') { ctx.strokeStyle = 'rgba(223,240,255,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke(); }
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
    if (op.environment === 'production') { var rp = op.flag ? rolloutOf(f) : 100; ctx.fillStyle = 'rgba(127,240,224,.26)'; ctx.fillRect(x, y, w * rp / 100, h); }
    else if (op.environment === 'staging' || op.environment === 'preview') { ctx.fillStyle = pat('sInt'); ctx.fillRect(x, y, w, h); }
  } else if (L === 'security') {
    var pf = { payment: 'sPay', personal: 'sPer', internal: 'sInt' }[f.security.dataClass];
    if (pf) { ctx.fillStyle = pat(pf); ctx.fillRect(x, y, w, h); }
  } else if (L === 'quality') {
    var q = f.quality;
    if (q.e2eTests > 0) { var pp = q.e2ePassing / q.e2eTests; ctx.fillStyle = 'rgba(205,187,255,.28)'; ctx.fillRect(x, y, w * pp, h); if (pp < 1) { ctx.fillStyle = pat('qF'); ctx.fillRect(x + w * pp, y, w * (1 - pp), h); } }
  }
  if (st === 'deprecated') { ctx.strokeStyle = 'rgba(223,240,255,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke(); }
}

/* ================================================================== tiles, ribbons, buildings */
var dimFn = null;
function progOf(f) { return S.t === AS_OF ? Math.min(99, f.development.progressPct + (SIM.prog[f.id] || 0)) : f.development.progressPct; }
function ribOf(Bay) {
  if (!Bay.rib) { var by = Bay.y + BH, bh = Bay.h - BH - BB, rh = Math.min(bh * 0.7, 60); Bay.rib = { x: Bay.x + 4, y: by + (bh - rh) / 2, w: Bay.w - 8, h: rh }; }
  return Bay.rib;
}
function strokeStage(st, x, y, w, h, a, lw) {
  ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = lw;
  if (!st) { ctx.globalAlpha = a * 0.35; ctx.setLineDash([1, 3]); }
  else if (st === 'specified') ctx.setLineDash([5, 3]);
  else if (st === 'idea') { ctx.setLineDash([1.5, 2.5]); ctx.globalAlpha = a * 0.8; }
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.setLineDash([]); ctx.globalAlpha = a;
}
function healthMarks(f, st, x, y, w, h, compact) {
  if (!(st && S.t === AS_OF)) return;
  var hl = lensHealth(f), u = U;
  if (compact) { if (hl === 'bad') { ctx.fillStyle = '#ff6a58'; ctx.fillRect(x, y - 3 * u, w, 3 * u); } else if (hl === 'watch') { ctx.fillStyle = '#ffc35a'; ctx.fillRect(x, y - 3 * u, w, 2 * u); } return; }
  if (hl === 'bad') { ctx.strokeStyle = '#ff6a58'; ctx.lineWidth = w < 40 * u ? 1.3 : 1.8; ctx.lineJoin = 'round'; var r = clamp(w / 14, 2.4 * u, 6 * u); cloud(x - r * 0.8, y - r * 0.8, w + r * 1.6, h + r * 1.6, r); ctx.stroke(); }
  else if (hl === 'watch' && w >= 22 * u) { ctx.strokeStyle = '#ffc35a'; ctx.lineWidth = 2; ctx.lineCap = 'round'; var tx = x + w - 12 * u; ctx.beginPath(); ctx.moveTo(tx, y - 2); ctx.lineTo(tx + 4 * u, y - 7 * u); ctx.moveTo(tx + 5 * u, y - 2); ctx.lineTo(tx + 9 * u, y - 7 * u); ctx.stroke(); ctx.lineCap = 'butt'; }
}
function deltaMark(f, st, x, y, w) {
  var dl = deltaWin(f); if (!(dl && st)) return;
  var ds = clamp(w / 9, 4 * U, 8 * U); ctx.fillStyle = '#9fe8ff'; ctx.beginPath(); ctx.moveTo(x + w + 1, y - ds * 1.2); ctx.lineTo(x + w + 1 + ds * 0.7, y + ds * 0.3); ctx.lineTo(x + w + 1 - ds * 0.7, y + ds * 0.3); ctx.closePath(); ctx.fill();
}
function paintTile(T, alphaMul) {
  var f = T.f, k = cam.k, u = U, x = sxw(T.x), y = syw(T.y), w = T.w * k, h = T.h * k;
  if (x > FW + 10 || y > FH + 10 || x + w < -10 || y + h < -10) return;
  var st = stageAt(f, S.t), now = S.t === AS_OF;
  var a = (dimFn && !dimFn(f) ? 0.13 : 1) * (alphaMul == null ? 1 : alphaMul);
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(3,18,40,.30)'; ctx.fillRect(x, y, w, h);
  if (S.blast) {
    var bl = closure(S.blast);
    if (F[S.blast].usedBy.indexOf(f.id) >= 0) { ctx.fillStyle = 'rgba(255,106,88,.5)'; ctx.fillRect(x, y, w, h); }
    else if (bl.indexOf(f.id) >= 0) { ctx.fillStyle = 'rgba(255,106,88,.22)'; ctx.fillRect(x, y, w, h); }
  }
  lensFill(f, st, x, y, w, h);
  var hv = now && HAS_SW ? heatNow(f.id) : 0;
  if (hv > 0.15 || (now && HAS_SW && AGF[f.id] && AGF[f.id].some(function (q) { return q.status === 'working' && !q.paused; }))) {
    var hh = clamp(0.35 + hv * 0.25, 0.2, 1), g = ctx.createLinearGradient(0, y + h, 0, y + h * 0.15);
    g.addColorStop(0, 'rgba(111,242,200,' + (0.30 * hh).toFixed(3) + ')'); g.addColorStop(1, 'rgba(111,242,200,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  strokeStage(st, x, y, w, h, a, w < 30 * u ? 1 : 1.5);
  if (S.blast === f.id) { ctx.strokeStyle = '#ff6a58'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h); }
  healthMarks(f, st, x, y, w, h, false);
  deltaMark(f, st, x, y, w);
  if (st && now && f.development.humanReviewed === false && (S.lens === 'general' || S.lens === 'development') && w < 150 * u && w >= 26 * u) {
    var dx = x + w - 7 * u, dy = y + h - 7 * u, dd = clamp(w / 28, 2.5 * u, 4.5 * u); ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(dx, dy - dd); ctx.lineTo(dx + dd * 0.8, dy); ctx.lineTo(dx, dy + dd); ctx.lineTo(dx - dd * 0.8, dy); ctx.closePath(); ctx.stroke();
  }
  ctx.textBaseline = 'alphabetic';
  var agentsHere = now && HAS_SW && AGF[f.id] && AGF[f.id].length, chips = agentsHere && w >= 100 * u && h >= 58 * u;
  if (w >= 150 * u && h >= 64 * u) {
    var ns = clamp(13.5 + (w / u - 150) / 60, 14, 17), lh = ns * 1.16 * u, mono = fnt(12, 500, MONO);
    var ev = tileEvidence(f, st), idw = tw(f.id, mono);
    var evs = partsFit(ev, w - 16 * u - idw - 10 * u, mono), showId = true;
    if (evs == null) { evs = partsFit(ev, w - 14 * u, mono); showId = false; }
    if (showId) text(f.id, x + 7 * u, y + 16 * u, mono, 'rgba(223,240,255,.7)');
    if (evs) { ctx.textAlign = 'right'; text(evs, x + w - 7 * u, y + 16 * u, mono, S.lens === 'general' ? '#dff0ff' : SHEET[S.lens].acc); ctx.textAlign = 'left'; }
    var stamp = tileStamp(f, st), room = h - 24 * u - (stamp ? 20 * u : 6 * u) - (chips ? 24 * u : 0);
    var nf = fnt(ns, 500), lines = wrap(f.name, w - 14 * u, nf, Math.max(1, Math.floor(room / lh)));
    if (!lines) { nf = fnt(14, 500); lh = 16.2 * u; lines = wrap(f.name, w - 14 * u, nf, Math.max(1, Math.floor(room / lh))); }
    if (lines) lines.forEach(function (l, i) { text(l, x + 7 * u, y + 22 * u + lh * (i + 0.82), nf, '#ffffff'); });
    if (stamp) { var sf = fnt(12.5, 600), sfit = partsFit([stamp], w - 14 * u, sf); if (sfit) text(sfit, x + 7 * u, y + h - 7 * u - (chips ? 22 * u : 0), sf, '#ff9a8c'); }
  } else if (w >= 100 * u && h >= 44 * u) {
    var nf2 = fnt(13, 500), l2 = 15 * u, lines2 = wrap(f.name, w - 12 * u, nf2, Math.max(1, Math.floor((h - 8 * u - (chips ? 22 * u : 0)) / l2)));
    if (lines2) { var top = y + (h - lines2.length * l2 - (chips ? 20 * u : 0)) / 2; lines2.forEach(function (l, i) { text(l, x + 6 * u, top + l2 * (i + 0.78), nf2, '#ffffff'); }); }
  }
  ctx.globalAlpha = 1;
}
function ribSeg(f, x, y, w, h, a) {
  var st = stageAt(f, S.t);
  var aa = (dimFn && !dimFn(f) ? 0.13 : 1) * a; if (aa <= 0.01) return;
  ctx.globalAlpha = aa;
  ctx.fillStyle = 'rgba(3,18,40,.30)'; ctx.fillRect(x, y, w, h);
  if (S.blast) { var bl = closure(S.blast); if (S.blast === f.id || bl.indexOf(f.id) >= 0) { ctx.fillStyle = 'rgba(255,106,88,.5)'; ctx.fillRect(x, y, w, h); } }
  lensFill(f, st, x, y, w, h);
  var hv = S.t === AS_OF && HAS_SW ? heatNow(f.id) : 0;
  if (hv > 0.2) { ctx.fillStyle = 'rgba(111,242,200,' + clamp(hv * 0.07, 0, 0.3).toFixed(3) + ')'; ctx.fillRect(x, y, w, h); }
  if (!st || st === 'specified' || st === 'idea') strokeStage(st, x, y, w, h, aa, 1);
  healthMarks(f, st, x, y, w, h, true);
  deltaMark(f, st, x, y, w * 0.9);
  ctx.globalAlpha = 1;
}
function drawRibbons(B, alpha) {
  var k = cam.k;
  B.wings.forEach(function (W) {
    if (!onScreen(rectS(W), 20)) return;
    W.rooms.forEach(function (R) {
      if (!onScreen(rectS(R), 20)) return;
      R.bays.forEach(function (Bay) {
        var rb = ribOf(Bay), x = sxw(rb.x), y = syw(rb.y), w = rb.w * k, h = rb.h * k, n = Bay.tiles.length, sw = w / n;
        if (y > FH + 10 || y + h < -10 || x > FW + 10 || x + w < -10) return;
        Bay.tiles.forEach(function (T, i) { ribSeg(T.f, x + i * sw + 1, y, sw - 2, h, alpha); });
        ctx.globalAlpha = alpha * 0.55; ctx.strokeStyle = 'rgba(223,240,255,.7)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.globalAlpha = 1;
      });
    });
  });
}
function drawBuilding(B) {
  var k = cam.k, br = rectS(B);
  if (!onScreen(br, 140)) return;
  var reveal = introOn ? br.x + (br.w + 40) * introP : 1e9;
  ctx.save();
  if (introOn) { ctx.beginPath(); ctx.rect(-10, -400, reveal + 10, FH + 800); ctx.clip(); }
  B.wings.forEach(function (W) { var r = rectS(W), c0 = counts(W.feats), sh = (c0.live + c0.flagged) / Math.max(1, c0.n); ctx.fillStyle = 'rgba(223,240,255,' + (0.02 + 0.075 * sh).toFixed(3) + ')'; ctx.fillRect(r.x, r.y, r.w, r.h); });
  if (S.hover && S.hover.type !== 'tile') { var hr = rectS(S.hover.o); ctx.fillStyle = 'rgba(127,224,255,.08)'; ctx.fillRect(hr.x, hr.y, hr.w, hr.h); }
  var lod = lodTiles();
  if (lod < 0.995) drawRibbons(B, (1 - lod) * (introOn ? clamp((introP - 0.1) / 0.5, 0, 1) : 1));
  if (lod > 0.005) B.wings.forEach(function (W) {
    if (!onScreen(rectS(W), 20)) return;
    W.rooms.forEach(function (R) {
      if (!onScreen(rectS(R), 20)) return;
      R.bays.forEach(function (Bay) { Bay.tiles.forEach(function (T) { var ia = 1; if (introOn) ia = clamp((reveal - sxw(T.x)) / 90, 0, 1); paintTile(T, lod * ia); }); });
    });
  });
  if (k > 0.12) {
    ctx.strokeStyle = 'rgba(223,240,255,.5)'; ctx.lineWidth = 1; ctx.beginPath();
    BAYS.forEach(function (Bay) { if (Bay.room.wing.bld !== B || Bay.y <= Bay.room.y + RH + 1) return; var X0 = sxw(Bay.room.x + 6), X1 = sxw(Bay.room.x + Bay.room.w - 6), Y = Math.round(syw(Bay.y - 2)) + 0.5; if (Y < -5 || Y > FH + 5) return; ctx.moveTo(X0, Y); ctx.lineTo(X1, Y); });
    ctx.stroke();
  }
  var wi = clamp(6 * k, 1.2, 6), ww = clamp(10 * k, 2, 10), wo = clamp(18 * k, 3.5, 18);
  ctx.strokeStyle = '#dff0ff';
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
Object.keys(ILLO).forEach(function (k) { var im = new Image(); im.onload = dirty; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(illoSVG(k, '#dff0ff', 3)); ART[k] = im; });
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
/* ================================================================== labels (each level appears only when it can be drawn at a readable size) + swarm glyphs */
var introOn = false, introT0 = 0, INTRO_MS = 2300, introP = 1;
var HALO = 'rgba(7,26,51,.92)', NAVY = '#04223a', MINT = '#6ff2c8', AMB = '#ffc35a', RED = '#ff6a58';
function labelAlpha() { return introOn ? clamp((introP - 0.75) / 0.25, 0, 1) : 1; }
function glyphAgent(x, y, st, s, alpha, spin) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.lineJoin = 'round';
  if (st === 'working') {
    ctx.fillStyle = MINT; ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, s, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = MINT; ctx.lineWidth = 1.3; var r0 = s + 1.8 * U, r1 = s + 4.2 * U; ctx.beginPath();
    for (var i = 0; i < 4; i++) { var an = (spin || 0) + i * 1.5708; ctx.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0); ctx.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1); }
    ctx.stroke();
  } else if (st === 'waiting') {
    ctx.fillStyle = 'rgba(4,34,58,.85)'; ctx.strokeStyle = AMB; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, s + 0.5, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.fillStyle = AMB; ctx.beginPath(); ctx.arc(x, y, Math.max(1.3, s * 0.32), 0, 6.2832); ctx.fill();
  } else if (st === 'blocked') {
    ctx.fillStyle = RED; ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; ctx.fillRect(x - s, y - s, s * 2, s * 2); ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    ctx.strokeStyle = NAVY; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - s * 0.55, y); ctx.lineTo(x + s * 0.55, y); ctx.stroke();
  } else if (st === 'failed') {
    ctx.fillStyle = 'rgba(60,8,12,.9)'; ctx.strokeStyle = RED; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s + 0.5, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 0.5); ctx.lineTo(x + s * 0.5, y + s * 0.5); ctx.moveTo(x + s * 0.5, y - s * 0.5); ctx.lineTo(x - s * 0.5, y + s * 0.5); ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(4,34,58,.85)'; ctx.strokeStyle = 'rgba(223,240,255,.7)'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, s + 0.5, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(223,240,255,.85)'; ctx.fillRect(x - s * 0.42, y - s * 0.4, s * 0.28, s * 0.8); ctx.fillRect(x + s * 0.14, y - s * 0.4, s * 0.28, s * 0.8);
  }
  ctx.restore();
}
/* a request for information pinned to its place: pole + pennant */
function glyphPin(x, y, urg, emphasised, s, count, ring) {
  var col = urg === 'high' ? RED : AMB, hgt = 19 * s * U, wd = 12 * s * U;
  if (!emphasised) { col = 'rgba(190,215,240,.62)'; hgt *= 0.8; wd *= 0.8; }
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (ring) { var rr = 10 * U + ring * 14 * U; ctx.strokeStyle = col; ctx.globalAlpha *= (1 - ring) * 0.9; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - hgt * 0.55, rr, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1; }
  ctx.strokeStyle = NAVY; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hgt); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - hgt); ctx.lineTo(x + wd, y - hgt * 0.74); ctx.lineTo(x, y - hgt * 0.48); ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hgt); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - hgt); ctx.lineTo(x + wd, y - hgt * 0.74); ctx.lineTo(x, y - hgt * 0.48); ctx.closePath(); ctx.fill();
  if (count > 0) {
    var bx = x - 8 * U, by = y - hgt + 4 * U, br = 8.5 * U;
    ctx.fillStyle = emphasised ? '#fff' : 'rgba(223,240,255,.85)'; ctx.strokeStyle = NAVY; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center'; text(String(count), bx, by + 4.2 * U, fnt(12, 600, MONO), NAVY); ctx.textAlign = 'left';
  }
  ctx.restore();
}
function drawSwarmLine(x, y, st, maxW) {
  if (!HAS_SW || !st.n) return 0;
  var f = fnt(13, 500, MONO), gx = x, items = [['working', st.working, MINT], ['waiting', st.waiting, AMB], ['blocked', st.blocked + st.failed, RED]];
  if (st.paused) items.push(['paused', st.paused, '#dff0ff']);
  var used = 0;
  items.forEach(function (it) {
    if (!it[1]) return; var w = 18 * U + tw(String(it[1]), f) + 8 * U;
    if (used + w > maxW) return;
    glyphAgent(gx + 6 * U, y - 4 * U, it[0] === 'blocked' && !st.blocked ? 'failed' : it[0], 4 * U, 1, 0);
    text(String(it[1]), gx + 15 * U, y, f, it[2], HALO); gx += w; used += w;
  });
  return used;
}
function drawWingLabels(B) {
  var k = cam.k, u = U, a0 = labelAlpha() * (SCALE > 1 ? smooth(KB1 * 0.62, KB1 * 0.8, cam.k) : 1), aMax = 0;
  var vis = B.wings.filter(function (W) { return W.w * k >= 80 * u; });
  if (!vis.length || a0 <= 0) return 0;
  var FS = 14, ML = 2, ok;
  for (var f1 = 22; f1 >= 14 && ML === 2; f1--) { ok = vis.every(function (W) { return wrap(W.def.name.toUpperCase(), W.w * k - 34 * u, fnt(f1, 600), 1, f1 * 0.05); }); if (ok) { FS = f1; ML = 1; } }
  if (ML === 2) for (var f2 = 20; f2 >= 14; f2--) { ok = vis.every(function (W) { return wrap(W.def.name.toUpperCase(), W.w * k - 34 * u, fnt(f2, 600), 2, f2 * 0.05); }); if (ok) { FS = f2; break; } }
  B.wings.forEach(function (W) {
    var a = clamp((W.w * k - 80 * u) / 10, 0, 1) * a0; if (a <= 0) return; aMax = Math.max(aMax, a); ctx.globalAlpha = a;
    var r = rectS(W); if (r.x > FW || r.x + r.w < 0) return;
    var base = r.y - 10 * u, x = r.x + 6 * u, wdt = r.w - 14 * u;
    if (base < -10 || base > FH + 120) return;
    var c = counts(W.feats);
    drawBar(x, base - 6 * u, wdt, 7 * u, c);
    var agg = aggLine(W.feats, false), af = fnt(13, 500), tr = agg.trouble ? tw(agg.trouble + ' in trouble', fnt(13, 600)) + 10 * u : 0, ag = partsFit(agg.parts, wdt - tr, af);
    if (ag && ag.indexOf('·') < 0) ag = partsFit(aggLine(W.feats, true).parts, wdt - tr, af) || ag;
    if (ag) text(ag, x, base - 14 * u, af, '#dff0ff', HALO);
    if (agg.trouble) { ctx.textAlign = 'right'; text(agg.trouble + ' in trouble', x + wdt, base - 14 * u, fnt(13, 600), '#ff9a8c', HALO); ctx.textAlign = 'left'; }
    var sy = base - 32 * u, ss = HAS_SW && S.t === AS_OF ? swStats(W.feats) : null;
    if (ss && ss.n) {
      var focus = S.who || S.lens !== 'general', em = focus ? ss.mine : ss.asks, shown = em > 0 ? em : ss.asks;
      var askW = ss.asks ? tw(String(shown), fnt(13, 600, MONO)) + 26 * u : 0;
      drawSwarmLine(x, sy, ss, wdt - askW);
      if (ss.asks) { glyphPin(x + wdt - askW + 8 * u, sy + 4 * u, ss.high && em > 0 ? 'high' : 'med', em > 0, 0.62, 0); text(String(shown), x + wdt - askW + 22 * u, sy, fnt(13, 600, MONO), em > 0 ? (ss.high ? '#ff9a8c' : AMB) : 'rgba(190,215,240,.75)', HALO); }
    }
    var nx = x, nm = W.def.name.toUpperCase(), fs = FS, lines = wrap(nm, W.w * k - 34 * u, fnt(fs, 600), ML, fs * 0.05), bub = true;
    var ly = base - (ss && ss.n ? 56 : 38) * u;
    if (!lines) { fs = 12.5; lines = wrap(nm, wdt, fnt(fs, 600), 2, 0.5); bub = false; }
    if (bub) {
      ctx.beginPath(); ctx.arc(nx + 11 * u, ly - 7 * u, 11 * u, 0, 7); ctx.fillStyle = '#0b2a4d'; ctx.fill(); ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.textAlign = 'center'; text(W.def.letter, nx + 11 * u, ly - 2.5 * u, fnt(13, 500, MONO), '#dff0ff'); ctx.textAlign = 'left';
    }
    if (lines) lines.slice().reverse().forEach(function (l, i) { text(l, nx + (bub ? 28 : 0) * u, ly - i * fs * 1.1 * u, fnt(fs, 600), '#ffffff', HALO, bub ? fs * 0.05 : 0.5); });
  });
  ctx.globalAlpha = 1;
  return aMax;
}
function drawBuildingLabel(B, wingA) {
  if (SCALE === 1) return;
  var r = rectS(B), u = U; if (r.w < 150 * u || !onScreen(r, 200)) return;
  var base = r.y - 12 * u - (wingA > 0 ? 112 * u * wingA : 0), a = labelAlpha();
  ctx.globalAlpha = a;
  var c = counts(B.feats), wdt = Math.min(r.w, 560 * u);
  drawBar(r.x, base - 6 * u, wdt, 8 * u, c);
  var agg = aggLine(B.feats, false), ag = partsFit(agg.parts, wdt - 90 * u, fnt(14, 500));
  if (ag) text(ag, r.x, base - 15 * u, fnt(14, 500), '#dff0ff', HALO);
  if (agg.trouble) { ctx.textAlign = 'right'; text(agg.trouble + ' in trouble', r.x + wdt, base - 15 * u, fnt(14, 600), '#ff9a8c', HALO); ctx.textAlign = 'left'; }
  var ss = HAS_SW && S.t === AS_OF ? swStats(B.feats) : null, sy = base - 36 * u;
  if (ss && ss.n) { var used = drawSwarmLine(r.x, sy, ss, wdt); if (ss.asks) { glyphPin(r.x + used + 14 * u, sy + 4 * u, ss.high ? 'high' : 'med', true, 0.65, 0); text(ss.asks + ' questions waiting', r.x + used + 30 * u, sy, fnt(13, 500, MONO), AMB, HALO); } }
  var nm = B.name.toUpperCase(), fs = clamp(r.w / 14 / u, 18, 30);
  text(nm, r.x, base - (ss && ss.n ? 58 : 38) * u, fnt(fs, 600), '#ffffff', HALO, fs * 0.06);
  ctx.globalAlpha = 1;
}
function drawRoomLabels(B) {
  var k = cam.k, u = U;
  B.wings.forEach(function (W) {
    var a = clamp((W.w * k - 100 * u) / 8, 0, 1) * labelAlpha() * (SCALE > 1 ? smooth(KB1 * 0.62, KB1 * 0.8, k) : 1);
    if (a <= 0) return;
    W.rooms.forEach(function (R) {
      var r = rectS(R); if (!onScreen(r)) return;
      ctx.globalAlpha = a;
      var hh = RH * k, fs = clamp(hh * 0.36 / u, 14, 26), nm = R.d.name.toUpperCase(), maxW = r.w - 28 * u - (HAS_SW ? 38 * u : 0);
      var ls = fs * 0.06, lines = wrap(nm, maxW, fnt(fs, 600), 2, ls);
      if (!lines && fs > 14) { fs = 14; ls = 0.8; lines = wrap(nm, maxW, fnt(14, 600), 2, ls); }
      if (!lines) { ctx.globalAlpha = 1; return; }
      var lh = fs * 1.08 * u, blockH = lines.length * lh, inHeader = hh >= blockH + 14 * u;
      var x = r.x + 14 * u, y = Math.max(r.y + 8 * u, Math.min(8 * u, r.y + r.h - blockH - 30 * u));
      if (y > r.y + 8 * u && !inHeader) y = r.y + 8 * u;
      if (!inHeader || y > r.y + 8 * u) {
        var pw = Math.max.apply(null, lines.map(function (l) { return tw(l, fnt(fs, 600), ls); }));
        ctx.fillStyle = 'rgba(8,30,58,.92)'; ctx.fillRect(x - 6 * u, y - 3 * u, pw + 12 * u, blockH + 8 * u);
      }
      R._lr = x + Math.max.apply(null, lines.map(function (l) { return tw(l, fnt(fs, 600), ls); })) + 6 * u;
      lines.forEach(function (l, i) { text(l, x, y + lh * (i + 0.8), fnt(fs, 600), '#ffffff', null, ls); });
      if (inHeader && hh >= blockH + 34 * u && y === r.y + 8 * u) {
        var agg = aggLine(R.feats, false), af = fnt(13, 500), avail = r.w - 28 * u - (agg.trouble ? 92 * u : 0) - (r.w > 420 * u && hh > 70 * u ? 110 * u : 0) - (HAS_SW ? 38 * u : 0);
        var ag = partsFit(agg.parts, avail, af);
        if (ag) text(ag, x, y + blockH + 17 * u, af, 'rgba(223,240,255,.8)');
        if (agg.trouble && ag) text(agg.trouble + ' in trouble', x + tw(ag, af) + 12 * u, y + blockH + 17 * u, fnt(13, 600), '#ff9a8c');
      }
      var art = ART[R.d.base];
      if (art && art.complete && r.w > 420 * u && hh > 70 * u) { var ah = hh - 14 * u, aw = ah * 1.5; ctx.globalAlpha = a * 0.5; ctx.drawImage(art, r.x + r.w - aw - 52 * u, r.y + 7 * u, aw, ah); }
      ctx.globalAlpha = 1;
    });
  });
}
function drawBayTags(B) {
  var k = cam.k, u = U; if (BH * k < 23 * u) return;
  var a = clamp((BH * k - 23 * u) / 2, 0, 1) * labelAlpha();
  var cf = fnt(12, 500, MONO), nf = fnt(13.5, 600);
  ctx.globalAlpha = a;
  B.wings.forEach(function (W) { W.rooms.forEach(function (R) { R.bays.forEach(function (Bay) {
    var r = rectS(Bay); if (!onScreen(r)) return;
    var code = Bay.cap.id.replace(/-[A-Z]$/, ''), nm = Bay.cap.name.toUpperCase();
    var cw = tw(code, cf) + 12 * u, nw = tw(nm, nf, 0.7) + 12 * u, cnt = Bay.tiles.length + '', kw = tw(cnt, cf) + 12 * u;
    var full = cw + nw + kw, th = 22 * u, x = r.x, y = r.y + Math.max(1, (BH * k - th) / 2 - 3);
    var showCode = full <= r.w, showCnt = showCode;
    if (!showCode && nw <= r.w) { full = nw; } else if (!showCode) return;
    ctx.fillStyle = '#0b2c52'; ctx.fillRect(x, y, full, th);
    ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, full - 1, th - 1);
    var xx = x;
    if (showCode) { text(code, xx + 6 * u, y + 15.5 * u, cf, 'rgba(223,240,255,.72)'); xx += cw; ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th); ctx.stroke(); }
    text(nm, xx + 6 * u, y + 16 * u, nf, '#ffffff', null, 0.7); xx += nw;
    if (showCnt) { ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th); ctx.stroke(); text(cnt, xx + 6 * u, y + 15.5 * u, cf, 'rgba(223,240,255,.72)'); }
  }); }); });
  ctx.globalAlpha = 1;
}
function drawChronology(B) {
  if (SCALE > 1) return;
  var r = rectS(B), u = U; if (r.w < 560 * u) return;
  var y = r.y + r.h + 22 * u; if (y > SAFE.b - 26 * u) return;
  ctx.globalAlpha = labelAlpha() * 0.95;
  ctx.strokeStyle = 'rgba(223,240,255,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
  ctx.fillStyle = 'rgba(223,240,255,.75)'; ctx.beginPath(); ctx.moveTo(r.x + r.w + 6, y); ctx.lineTo(r.x + r.w - 4, y - 4); ctx.lineTo(r.x + r.w - 4, y + 4); ctx.fill();
  var f = fnt(12, 500, MONO);
  var t1 = 'OLDEST WORK', t2 = 'NEWEST WORK', t3 = 'LEFT TO RIGHT: WINGS IN THE ORDER WORK BEGAN, FEATURES OLDEST FIRST';
  [[t1, r.x, 'left'], [t2, r.x + r.w - 10, 'right'], [t3, r.x + r.w / 2, 'center']].forEach(function (q) {
    ctx.textAlign = q[2]; var w0 = tw(q[0], f), x0 = q[2] === 'left' ? q[1] : q[2] === 'right' ? q[1] - w0 : q[1] - w0 / 2;
    if (q[2] === 'center' && tw(t1, f) + tw(t2, f) + w0 + 60 * u > r.w) return;
    ctx.fillStyle = 'rgba(8,30,58,1)'; ctx.fillRect(x0 - 6, y - 8 * u, w0 + 12, 16 * u); text(q[0], q[1], y + 4.5 * u, f, 'rgba(223,240,255,.8)');
  });
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;
}

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
/* ================================================================== the swarm over the plan (agents move; the plan does not) */
var dashT = 0;
function featRect(fid, lod) {
  var T = TILE[fid]; if (!T) return null;
  if (lod > 0.5) return rectS(T);
  if (T.bi == null) T.bi = T.bay.tiles.indexOf(T);
  var Bay = T.bay, rb = ribOf(Bay), n = Bay.tiles.length, sw = rb.w * cam.k / n;
  return { x: sxw(rb.x) + T.bi * sw, y: syw(rb.y), w: sw, h: rb.h * cam.k };
}
function posAt(fid, i, n, lod) {
  var T = TILE[fid]; if (!T) return null;
  if (T.bi == null) T.bi = T.bay.tiles.indexOf(T);
  var Bay = T.bay, rb = ribOf(Bay), nb = Bay.tiles.length;
  var rx = sxw(rb.x + (T.bi + 0.5) / nb * rb.w), ry = syw(rb.y + rb.h / 2);
  if (n > 1) { var an = i / n * 6.2832 + 0.6; rx += Math.cos(an) * 7 * U; ry += Math.sin(an) * 5.5 * U; }
  if (lod <= 0.001) return { x: rx, y: ry, chip: false };
  var r = rectS(T), chips = r.w >= 100 * U && r.h >= 58 * U, step = (chips ? 62 : 15) * U;
  var tx = r.x + (chips ? 20 : 12) * U + i * step, ty = r.y + r.h - (chips ? 14 : 10) * U;
  return { x: rx + (tx - rx) * lod, y: ry + (ty - ry) * lod, chip: chips && lod > 0.6, r: r };
}
function agentPos(A, lod, now) {
  var list = AGF[A.f] || [A], i = Math.max(0, list.indexOf(A)), p = posAt(A.f, i, list.length, lod);
  if (!p) return null;
  var out = { x: p.x, y: p.y, chip: p.chip, r: p.r, idx: i, n: list.length, trail: null };
  if (A.tr) {
    var u = (now - A.tr.t0) / A.tr.dur, q = posAt(A.tr.from, 0, 1, lod);
    if (q) {
      var mx = (q.x + p.x) / 2, my = (q.y + p.y) / 2 - Math.hypot(p.x - q.x, p.y - q.y) * 0.18 - 10 * U;
      var e = ease(clamp(u, 0, 1));
      if (u < 1) { out.x = (1 - e) * (1 - e) * q.x + 2 * (1 - e) * e * mx + e * e * p.x; out.y = (1 - e) * (1 - e) * q.y + 2 * (1 - e) * e * my + e * e * p.y; out.chip = false; out.moving = true; }
      out.trail = { q: q, p: p, mx: mx, my: my, u: Math.min(1, u), fade: u < 1 ? 1 : 1 - (now - A.tr.t0 - A.tr.dur) / 5000 };
    }
    if (u >= 1 && (now - A.tr.t0 - A.tr.dur) > 5000) A.tr = null;
  }
  return out;
}
function gcol(st) { return st === 'working' ? MINT : st === 'waiting' ? AMB : st === 'paused' ? '#dff0ff' : RED; }
function drawChip(x, y, A, st, alpha, now) {
  var u = U, w = 58 * u, h = 20 * u, x0 = x - 13 * u, y0 = y - h / 2;
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.fillStyle = 'rgba(5,26,50,.95)'; ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = gcol(st); ctx.lineWidth = 1.3; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  glyphAgent(x, y, st, 4 * u, 1, now / 900 + A.ph);
  text(A.code, x + 9 * u, y + 4.2 * u, fnt(12, 500, MONO), '#ffffff');
  ctx.restore();
}
function drawAgents(now) {
  if (!HAS_SW || S.t !== AS_OF) return;
  var lod = lodTiles(), u = U, pos = [];
  AGS.forEach(function (A) {
    var p = agentPos(A, lod, now); if (!p) return;
    if (p.x < -40 || p.x > FW + 40 || p.y < -40 || p.y > FH + 40) return;
    var st = astat(A);
    if (st === 'working' && !p.moving && lod < 0.8) { var orb = 3.2 * u * (1 - lod); p.x += Math.cos(now * 0.0011 + A.ph) * orb; p.y += Math.sin(now * 0.0013 + A.ph) * orb * 0.7; }
    pos.push([A, p, st]);
  });
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  pos.forEach(function (q) {
    var A = q[0], p = q[1], st = q[2]; if (st !== 'working') return;
    var rad = (15 + lod * 10) * u * (crewRelevant(A) ? 1 : 0.6), g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
    g.addColorStop(0, 'rgba(111,242,200,' + (crewRelevant(A) ? 0.26 : 0.1) + ')'); g.addColorStop(1, 'rgba(111,242,200,0)');
    ctx.fillStyle = g; ctx.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
  });
  ctx.restore();
  // trails of recent moves
  pos.forEach(function (q) {
    var A = q[0], p = q[1]; if (!p.trail || p.trail.fade <= 0) return;
    var t = p.trail, uu = t.u; ctx.save(); ctx.globalAlpha = clamp(t.fade, 0, 1) * 0.85; ctx.strokeStyle = MINT; ctx.lineWidth = 1.6; ctx.setLineDash([3, 4]); ctx.lineDashOffset = -dashT;
    ctx.beginPath(); for (var s = 0; s <= 16; s++) { var e = ease(uu * s / 16), x = (1 - e) * (1 - e) * t.q.x + 2 * (1 - e) * e * t.mx + e * e * t.p.x, y = (1 - e) * (1 - e) * t.q.y + 2 * (1 - e) * e * t.my + e * e * t.p.y; if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke(); ctx.restore();
  });
  // marks and chips
  var capBy = {};
  pos.forEach(function (q) {
    var A = q[0], p = q[1], st = q[2], rel = crewRelevant(A), al = rel ? 1 : 0.42;
    if (A.flash && now - A.flash < 1100) { var fu = (now - A.flash) / 1100; ctx.save(); ctx.strokeStyle = '#fff'; ctx.globalAlpha = (1 - fu) * 0.9; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, (6 + fu * 22) * u, 0, 6.2832); ctx.stroke(); ctx.restore(); }
    if (p.chip && !p.moving) {
      var cap = Math.max(1, Math.floor((p.r.w - 14 * u - ((DOF[A.f] || []).length * 18 * u)) / (62 * u)));
      if (p.n > cap && p.idx >= cap - 1) { if (p.idx === cap - 1) { var x0 = p.x - 13 * u, y0 = p.y - 10 * u; ctx.fillStyle = 'rgba(5,26,50,.95)'; ctx.fillRect(x0, y0, 58 * u, 20 * u); ctx.strokeStyle = 'rgba(223,240,255,.6)'; ctx.lineWidth = 1.3; ctx.strokeRect(x0 + 0.5, y0 + 0.5, 58 * u - 1, 20 * u - 1); text('+' + (p.n - cap + 1), x0 + 8 * u, y0 + 14.4 * u, fnt(12, 500, MONO), '#ffffff'); } return; }
      drawChip(p.x, p.y, A, st, al, now);
    } else {
      var s = (p.chip ? 4.6 : 4.4) * u * (rel ? 1 : 0.8) * (p.moving ? 1.15 : 1);
      glyphAgent(p.x, p.y, st, s, al, now / 900 + A.ph);
    }
  });
}
var PCOL = { c: '111,242,200', ok: '160,255,225', bad: '255,106,88', pr: '127,224,255', dep: '255,255,255', flag: '255,195,90', warn: '255,195,90', ask: '255,195,90', mv: '111,242,200' };
function drawPulses(now) {
  if (!HAS_SW || S.t !== AS_OF || !SIM.pulses.length) return;
  var lod = lodTiles(), u = U, keep = [];
  ctx.save(); ctx.lineWidth = 2;
  SIM.pulses.forEach(function (p) {
    var age = (now - p.t0) / (p.k === 'dep' || p.k === 'ask' ? 2200 : 1500);
    if (age >= 1) return; keep.push(p);
    var r = featRect(p.f, lod); if (!r || r.x > FW + 40 || r.y > FH + 40 || r.x + r.w < -40 || r.y + r.h < -40) return;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = (5 + age * (p.k === 'dep' ? 46 : 28)) * u;
    ctx.strokeStyle = 'rgba(' + (PCOL[p.k] || PCOL.c) + ',' + ((1 - age) * 0.85).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.stroke();
    if (p.k === 'dep' || p.k === 'bad') { ctx.beginPath(); ctx.arc(cx, cy, rad * 0.6, 0, 6.2832); ctx.stroke(); }
  });
  ctx.restore(); SIM.pulses = keep;
}
function decPinPos(d, lod, now) {
  /* decisions sit on their feature: clustered on the room at the overview, individual at fixture level */
  return null;
}
function drawPins(now) {
  if (!HAS_SW || S.t !== AS_OF) return;
  var lod = lodTiles(), u = U;
  if (lod < 0.995) {
    ctx.save(); ctx.globalAlpha = 1 - lod;
    ROOMS.forEach(function (R) {
      var ds = []; R.feats.forEach(function (f) { (DOF[f.id] || []).forEach(function (d) { ds.push(d); }); });
      if (!ds.length) return;
      var r = rectS(R); if (!onScreen(r, 30)) return;
      var em = ds.filter(emph), hi = ds.some(function (d) { return d.urg === 'high' && emph(d); }), anyNew = ds.some(function (d) { return d.isNew; });
      var ring = anyNew ? ((now / 1600) % 1) : 0;
      glyphPin(r.x + r.w - 18 * u, r.y + 32 * u, hi ? 'high' : (em.length ? 'med' : 'low'), em.length > 0, 0.9, ds.length, ring);
    });
    ctx.restore();
  }
  if (lod > 0.005) {
    ctx.save(); ctx.globalAlpha = lod;
    TILES.forEach(function (T) {
      var ds = DOF[T.id]; if (!ds || !ds.length) return;
      var r = rectS(T); if (r.x > FW + 20 || r.y > FH + 20 || r.x + r.w < -20 || r.y + r.h < -20) return;
      ds.forEach(function (d, j) {
        var ring = d.isNew ? ((now / 1600) % 1) : (S.dec === d.id ? ((now / 1200) % 1) : 0);
        glyphPin(r.x + r.w - 12 * u - j * 18 * u, r.y + r.h - 5 * u, d.urg, emph(d), 0.85, 0, ring);
      });
    });
    ctx.restore();
  }
}
function drawOrderZones(now) {
  if (!HAS_SW) return;
  var lod = lodTiles(), u = U;
  ORDS.forEach(function (o) {
    var sc = o.scope || {}, hi = S.ordHi === o.id;
    if (sc.domain) {
      ROOMS.forEach(function (R) {
        if (!(R.d.base === sc.domain || R.d.id === sc.domain)) return;
        var r = rectS(R); if (!onScreen(r)) return;
        ctx.save(); ctx.strokeStyle = hi ? '#ffffff' : 'rgba(255,195,90,.8)'; ctx.lineWidth = hi ? 2.5 : 1.5; ctx.setLineDash([9, 5]); ctx.lineDashOffset = -dashT * 0.5;
        ctx.strokeRect(r.x + 5 * u, r.y + 5 * u, r.w - 10 * u, r.h - 10 * u); ctx.restore();
        if (hi) { ctx.fillStyle = 'rgba(255,195,90,.08)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
        if (r.w >= 230 * u && r.h >= 40 * u && (R._lr || 0) < r.x + r.w - 62 * u - 18 * u) { var sx = r.x + r.w - 62 * u, sy = r.y + 17 * u; ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.14); ctx.strokeStyle = '#ffc35a'; ctx.fillStyle = 'rgba(6,30,52,.92)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 13 * u, 0, 6.2832); ctx.fill(); ctx.stroke(); ctx.textAlign = 'center'; text(o.id, 0, 4.2 * u, fnt(12, 600, MONO), '#ffc35a'); ctx.restore(); ctx.textAlign = 'left'; }
      });
    } else if (hi || (o.user && S.t === AS_OF)) {
      var ids = ordMap()[o.id] || {}, any = 0;
      for (var id in ids) { var fr = featRect(id, lod); if (!fr || fr.x > FW || fr.y > FH || fr.x + fr.w < 0 || fr.y + fr.h < 0) continue; any++; ctx.save(); ctx.strokeStyle = hi ? '#ffffff' : 'rgba(255,195,90,.8)'; ctx.lineWidth = hi ? 2.4 : 1.5; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -dashT * 0.5; ctx.strokeRect(fr.x - 2, fr.y - 2, fr.w + 4, fr.h + 4); ctx.restore(); if (o.user && lod > 0.5 && fr.w >= 60 * u) { ctx.fillStyle = 'rgba(6,30,52,.92)'; ctx.strokeStyle = '#ffc35a'; ctx.lineWidth = 1.3; ctx.fillRect(fr.x + 4 * u, fr.y + fr.h - 22 * u, 36 * u, 17 * u); ctx.strokeRect(fr.x + 4.5 * u, fr.y + fr.h - 21.5 * u, 36 * u - 1, 17 * u - 1); text(o.id, fr.x + 9 * u, fr.y + fr.h - 9 * u, fnt(12, 600, MONO), '#ffc35a'); } }
    }
  });
}
/* a breach shows where it happens: a red rivet on the fixture */
function drawBreaches(now) {
  if (!HAS_SW || S.t !== AS_OF) return;
  var lod = lodTiles(), u = U, seen = {};
  ORDS.forEach(function (o) { o.vf.forEach(function (fid) { (seen[fid] = seen[fid] || []).push(o.id); }); });
  Object.keys(seen).forEach(function (fid) {
    var r = featRect(fid, lod); if (!r || r.x > FW + 20 || r.y > FH + 20 || r.x + r.w < -20 || r.y + r.h < -20) return;
    var big = lod > 0.5 && r.w >= 40 * u, rr = (big ? 7.5 : 4) * u, cx = big ? r.x : r.x + r.w / 2, cy = big ? r.y : r.y - 7 * u, pu = (now / 1500 + hash01(fid)) % 1;
    ctx.save(); ctx.strokeStyle = 'rgba(255,106,88,' + ((1 - pu) * 0.7).toFixed(2) + ')'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, rr + pu * 8 * u, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = RED; ctx.strokeStyle = NAVY; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.fill(); ctx.stroke();
    if (big) { ctx.textAlign = 'center'; text('!', cx, cy + 4.4 * u, fnt(12, 600, MONO), '#fff'); ctx.textAlign = 'left'; }
    ctx.restore();
  });
}
function drawTargets(now) {
  if (!S.tgt.n) return;
  var lod = lodTiles(), u = U;
  ctx.save(); ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 2; ctx.setLineDash([7, 4]); ctx.lineDashOffset = -dashT;
  ROOMS.forEach(function (R) {
    var c = 0; R.feats.forEach(function (f) { if (S.tgt.ids[f.id]) c++; }); if (!c) return;
    var r = rectS(R); if (!onScreen(r, 10)) return;
    if (c === R.feats.length) { ctx.fillStyle = 'rgba(127,224,255,.09)'; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x + 4 * u, r.y + 4 * u, r.w - 8 * u, r.h - 8 * u); }
    else R.feats.forEach(function (f) { if (!S.tgt.ids[f.id]) return; var fr = featRect(f.id, lod); if (!fr) return; ctx.fillStyle = 'rgba(127,224,255,.14)'; ctx.fillRect(fr.x, fr.y, fr.w, fr.h); ctx.strokeRect(fr.x - 2, fr.y - 2, fr.w + 4, fr.h + 4); });
  });
  ctx.restore();
}
function curveArrow(x0, y0, x1, y1, col, lw) {
  var mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - Math.hypot(x1 - x0, y1 - y0) * 0.16 - 8 * U;
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
  var ax = x1 - mx, ay = y1 - my, an = Math.atan2(ay, ax), hs = 8 * U;
  ctx.setLineDash([]); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(an - 0.45) * hs, y1 - Math.sin(an - 0.45) * hs); ctx.lineTo(x1 - Math.cos(an + 0.45) * hs, y1 - Math.sin(an + 0.45) * hs); ctx.closePath(); ctx.fill();
}
function drawPreview(now) {
  var p = S.prev; if (!p) return;
  var lod = lodTiles(), u = U;
  ctx.save();
  var col = p.kind === 'pause' ? '#ffc35a' : '#6ff2c8';
  for (var id in p.targets) { var fr = featRect(id, lod); if (!fr || fr.x > FW || fr.y > FH || fr.x + fr.w < 0 || fr.y + fr.h < 0) continue; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -dashT; ctx.fillStyle = p.kind === 'pause' ? 'rgba(255,195,90,.08)' : 'rgba(111,242,200,.12)'; ctx.fillRect(fr.x, fr.y, fr.w, fr.h); ctx.strokeRect(fr.x - 2, fr.y - 2, fr.w + 4, fr.h + 4); }
  p.moves.forEach(function (m) {
    var q = agentPos(m.a, lod, now), tr = featRect(m.to, lod); if (!q || !tr) return;
    ctx.setLineDash([8, 5]); ctx.lineDashOffset = -dashT * 1.4;
    curveArrow(q.x, q.y, tr.x + tr.w / 2, tr.y + tr.h / 2, 'rgba(111,242,200,.95)', 2);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#6ff2c8'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(q.x, q.y, 11 * u, 0, 6.2832); ctx.stroke();
  });
  p.paused.forEach(function (a) { var q = agentPos(a, lod, now); if (!q) return; ctx.setLineDash([3, 3]); ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(q.x, q.y, 11 * u, 0, 6.2832); ctx.stroke(); });
  ctx.restore();
}
/* the decision under the pointer or open in the card: its place, the agents it holds, the features it touches */
function drawFocus(now) {
  var d = S.dec ? DEC[S.dec] : S.hlDec ? DEC[S.hlDec] : null; if (!d || !d.open) return;
  var lod = lodTiles(), u = U, fr = featRect(d.f, lod); if (!fr) return;
  var cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
  ctx.save();
  d.affects.forEach(function (id) { var a = featRect(id, lod); if (!a) return; ctx.strokeStyle = '#ffc35a'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -dashT; ctx.strokeRect(a.x - 2, a.y - 2, a.w + 4, a.h + 4); });
  ctx.setLineDash([]);
  AGS.forEach(function (A) { if (A.wait !== d.id) return; var q = agentPos(A, lod, now); if (!q) return; ctx.strokeStyle = 'rgba(255,195,90,.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 4]); ctx.lineDashOffset = -dashT; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(q.x, q.y, 10 * u, 0, 6.2832); ctx.stroke(); });
  var pu = (now / 1100) % 1; ctx.strokeStyle = 'rgba(255,195,90,' + (1 - pu).toFixed(2) + ')'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, (12 + pu * 26) * u, 0, 6.2832); ctx.stroke();
  ctx.restore();
}
/* after an answer: the agents it frees are connected to the place, then the line fades */
function drawReleases(now) {
  if (!HAS_SW || S.t !== AS_OF) return;
  var lod = lodTiles(), u = U;
  DECS.forEach(function (d) {
    if (!d.ans || !d.ans.at || !d.freedIds || !d.freedIds.length) return;
    var age = (now - d.ans.at) / 3200; if (age >= 1) return;
    var fr = featRect(d.f, lod); if (!fr) return;
    var cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
    ctx.save(); ctx.globalAlpha = 1 - age; ctx.strokeStyle = MINT; ctx.fillStyle = MINT; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -dashT * 1.6;
    d.freedIds.forEach(function (id) { var A = AG[id]; if (!A) return; var q = agentPos(A, lod, now); if (!q) return; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(q.x, q.y, (9 + age * 14) * u, 0, 6.2832); ctx.stroke(); ctx.setLineDash([5, 4]); });
    ctx.setLineDash([]); ctx.textAlign = 'center'; text('+' + d.freedIds.length + ' back to work', cx, cy - (18 + age * 22) * u, fnt(13, 600, MONO), MINT, HALO); ctx.textAlign = 'left';
    ctx.restore();
  });
}
function drawLasso() {
  if (!S.lasso) return; var l = S.lasso, x = Math.min(l.x0, l.x1), y = Math.min(l.y0, l.y1), w = Math.abs(l.x1 - l.x0), h = Math.abs(l.y1 - l.y0);
  ctx.save(); ctx.fillStyle = 'rgba(127,224,255,.1)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -dashT; ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.restore();
}
/* ================================================================== plan overlays (modes, hover, open) */
function drawSheet() {
  ctx.save(); ctx.strokeStyle = 'rgba(223,240,255,.34)'; ctx.lineWidth = 1; ctx.strokeRect(5.5, 5.5, FW - 11, FH - 11);
  ctx.strokeStyle = 'rgba(223,240,255,.14)'; ctx.strokeRect(9.5, 9.5, FW - 19, FH - 19); ctx.restore();
}
function drawOverlays() {
  var k = cam.k, u = U, lod = lodTiles();
  if (S.blast) {
    var rooms = {}; closure(S.blast).forEach(function (id) { rooms[F[id].domain] = 1; });
    ctx.strokeStyle = '#ff6a58'; ctx.lineWidth = 1.6; ctx.setLineDash([8, 4]);
    Object.keys(rooms).forEach(function (d) { var r = rectS(ROOM[d]); ctx.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10); });
    ctx.setLineDash([]);
  }
  if (S.ga) { ctx.strokeStyle = '#ffc35a'; ctx.lineWidth = 1.6; K.features.forEach(function (f) { if (f.milestone === 'M2') { var r = featRect(f.id, lod); if (r && onScreen(r)) ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); } }); }
  if (S.key) { ctx.strokeStyle = '#ff9a8c'; ctx.lineWidth = 1.6; K.features.forEach(function (f) { if (f.flags.indexOf(S.key) >= 0) { var r = featRect(f.id, lod); if (r && onScreen(r)) ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); } }); }
  var id = (S.hover && S.hover.type === 'tile' ? S.hover.o.id : null) || S.hl || S.open || S.sel;
  if (id && TILE[id] && k > 0.1 && lod > 0.3) conduits(id);
  [S.open, S.sel].forEach(function (sid) {
    if (!sid || !TILE[sid]) return;
    var r = featRect(sid, lod), pad = clamp(r.w * 0.12, 5, 14);
    ctx.strokeStyle = SHEET[S.lens].acc; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -dashT * 0.6;
    ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2); ctx.setLineDash([]); ctx.lineDashOffset = 0;
  });
  if (S.hover) {
    var hr = S.hover.type === 'tile' ? featRect(S.hover.o.id, lod) : rectS(S.hover.o);
    ctx.strokeStyle = S.hover.type === 'tile' ? '#ffffff' : '#7fe0ff'; ctx.lineWidth = S.hover.type === 'tile' ? 2.5 : 2;
    ctx.strokeRect(hr.x, hr.y, hr.w, hr.h);
  }
  if (S.hl && TILE[S.hl]) { var q = featRect(S.hl, lod); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.strokeRect(q.x - 3, q.y - 3, q.w + 6, q.h + 6); }
}
function draw(now) {
  if (phone || !PAT.hS) return;
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.clearRect(0, 0, FW, FH);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  anchorPatterns();
  dimFn = S.ga ? function (f) { return f.milestone === 'M2'; } : S.key ? function (f) { return f.flags.indexOf(S.key) >= 0; } : null;
  drawGrid(); drawSheet();
  BLDS.forEach(drawBuilding);
  drawOverlays();
  if (introOn) { ctx.save(); var rx = sxw(WORLD.x) + (WORLD.w * cam.k + 40) * introP; ctx.beginPath(); ctx.rect(-10, -400, rx + 10, FH + 800); ctx.clip(); }
  drawOrderZones(now); drawTargets(now);
  drawAgents(now); drawPulses(now);
  if (introOn) ctx.restore();
  BLDS.forEach(function (B) { drawBayTags(B); drawRoomLabels(B); var wa = drawWingLabels(B); drawBuildingLabel(B, wa); drawChronology(B); });
  if (introOn) { ctx.save(); var rx2 = sxw(WORLD.x) + (WORLD.w * cam.k + 40) * introP; ctx.beginPath(); ctx.rect(-10, -400, rx2 + 10, FH + 800); ctx.clip(); }
  drawPins(now); drawBreaches(now); drawPreview(now); drawFocus(now); drawReleases(now); drawLasso();
  if (introOn) ctx.restore();
}

/* ================================================================== frame loop + where am I */
var lastPlace = '', kpDirty = true, lastT = 0, lastDraw = 0, interacting = 0;
function frame(now) {
  raf = 0;
  var dt = lastT ? now - lastT : 16; lastT = now;
  stepCam(now);
  if (introOn) { introP = clamp((now - introT0) / INTRO_MS, 0, 1); if (introP >= 1) endIntro(); }
  advance(dt);
  var busy = anim || wz || introOn || drag || S.lasso || S.prev || S.dec || S.hlDec || S.hover || (HAS_SW && DECS.some(function (d) { return d.ans && d.ans.at && now - d.ans.at < 3300; })) || S.ordHi || S.open;
  var live = HAS_SW && S.t === AS_OF && (SIM.playing || SIM.pulses.length || S.tgt.n);
  if (!busy && live && now - lastDraw < 30) { raf = requestAnimationFrame(frame); return; }
  lastDraw = now;
  dashT = (now / 40) % 1000;
  draw(now);
  syncPlace();
  drawKeyplan();
  renderTicker(now); if (S.dec) placeDcard();
  if (busy || live || (HAS_SW && AGS.some(function (a) { return a.tr || a.flash && now - a.flash < 1200; }))) raf = requestAnimationFrame(frame);
}
/* The place is what fills the view: at each level the container with the largest visible share, once the zoom has entered it.
   (The old rule asked what sits under the view's centre, which named the wrong room while panning.) */
function visShare(o) {
  var x0 = Math.max(SAFE.l, sxw(o.x)), x1 = Math.min(SAFE.r, sxw(o.x + o.w)), y0 = Math.max(SAFE.t, syw(o.y)), y1 = Math.min(SAFE.b, syw(o.y + o.h));
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}
function pickShare(list) { var best = null, bs = 0; list.forEach(function (o) { var s = visShare(o); if (s > bs) { bs = s; best = o; } }); return best; }
function chainBest() {
  var out = [], B = pickShare(BLDS); if (!B) return out;
  if (SCALE > 1) out.push({ t: 'bld', o: B });
  var W = pickShare(B.wings); if (!W) return out; out.push({ t: 'wing', o: W });
  var R = pickShare(W.rooms); if (!R) return out; out.push({ t: 'room', o: R });
  var Bay = pickShare(R.bays); if (Bay) out.push({ t: 'bay', o: Bay });
  return out;
}
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
  var ch = chainBest(), deepest = -1;
  for (var i = 0; i < ch.length; i++) if (entered(ch[i])) deepest = i;
  return ch.slice(0, deepest + 1);
}
var PLACE = [];
function syncPlace() {
  PLACE = place();
  var key = PLACE.map(function (c) { return c.o.id; }).join('>') + '|' + (S.open || '') + '|' + S.lens + '|' + S.t + '|' + S.delta;
  var sb = $('#scalebar'), sc = Math.round(100 / cam.k), bw = TW * cam.k / U;
  sb.style.left = 'auto'; sb.style.right = Math.round((FW - SAFE.r) / U + 12) + 'px'; sb.style.whiteSpace = 'nowrap';
  var sbH = '<span>SCALE 1:' + sc + '</span>' + (bw <= 150 ? '<i class="sb" style="width:' + Math.round(Math.max(bw, 10)) + 'px"></i><span>= one feature</span>' : '');
  if (sb._h !== sbH) { sb.innerHTML = sbH; sb._h = sbH; }
  sb.style.visibility = (SAFE.r / U - 12 - sb.offsetWidth < ($('#ladder').offsetWidth || 560) + 28) ? 'hidden' : 'visible';
  if (key === lastPlace) return;
  lastPlace = key;
  renderCrumbs(); renderLadder(); renderDock(); writeHashSoon();
}

/* ================================================================== hover + click + lasso */
function local(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * FW, y: (e.clientY - r.top) / r.height * FH }; }
function hitAt(px, py) {
  var wx = wxs(px), wy = wys(py), k = cam.k, lod = lodTiles();
  if (lod > 0.5) for (var i = 0; i < TILES.length; i++) { var T = TILES[i]; if (wx >= T.x - 3 / k && wx <= T.x + T.w + 3 / k && wy >= T.y - 3 / k && wy <= T.y + T.h + 3 / k) return { t: 'tile', o: T, chain: chainAt(wx, wy) }; }
  else { /* ribbons: the segment under the pointer */
    var ch0 = chainAt(wx, wy), Bay = ch0.filter(function (c) { return c.t === 'bay'; })[0];
    if (Bay) { var rb = ribOf(Bay.o); if (wx >= rb.x && wx <= rb.x + rb.w && wy >= rb.y - 4 && wy <= rb.y + rb.h + 4) { var n = Bay.o.tiles.length, i2 = clamp(Math.floor((wx - rb.x) / rb.w * n), 0, n - 1); return { t: 'tile', o: Bay.o.tiles[i2], chain: ch0 }; } }
  }
  var ch = chainAt(wx, wy);
  return ch.length ? { t: ch[ch.length - 1].t, o: ch[ch.length - 1].o, chain: ch } : null;
}
/* pennants are clickable: a cluster at the overview, single questions at fixture size */
function pinAt(px, py) {
  if (!HAS_SW || S.t !== AS_OF || S.open) return null;
  var lod = lodTiles(), u = U, i, j;
  if (lod < 0.6) {
    for (i = 0; i < ROOMS.length; i++) {
      var R = ROOMS[i], ds = []; R.feats.forEach(function (f) { (DOF[f.id] || []).forEach(function (d) { ds.push(d); }); });
      if (!ds.length) continue;
      var r = rectS(R), bx = r.x + r.w - 18 * u, by = r.y + 32 * u;
      if (px >= bx - 15 * u && px <= bx + 16 * u && py >= by - 27 * u && py <= by + 4 * u) { ds.sort(function (a, b) { return (emph(b) - emph(a)) || dScore(b) - dScore(a); }); return { list: ds, d: ds[0], cluster: true, at: R.d.name }; }
    }
  }
  if (lod > 0.4) for (i = 0; i < TILES.length; i++) {
    var T = TILES[i], dd = DOF[T.id]; if (!dd || !dd.length) continue;
    var rr = rectS(T);
    for (j = 0; j < dd.length; j++) { var qx = rr.x + rr.w - 12 * u - j * 18 * u, qy = rr.y + rr.h - 5 * u; if (px >= qx - 9 * u && px <= qx + 14 * u && py >= qy - 24 * u && py <= qy + 3 * u) return { list: [dd[j]], d: dd[j], cluster: false, at: T.f.name }; }
  }
  return null;
}
function showPinTip(pn, px, py) {
  var d = pn.d, u = U;
  hov.innerHTML = '<div class="k">' + (pn.cluster ? pn.list.length + ' question' + (pn.list.length > 1 ? 's' : '') + ' in ' + esc(pn.at) : 'Question for ' + esc(pname(d.decider)) + ' · ' + esc(d.base)) + '</div><div class="n" style="font-size:19px;line-height:1.2">' + esc(d.q) + '</div>' +
    (pn.cluster ? pn.list.slice(1, 4).map(function (x) { return '<div class="sw q" style="font-size:13px">' + esc(x.base) + ' · ' + esc(x.q.length > 70 ? x.q.slice(0, 68) + '…' : x.q) + '</div>'; }).join('') : '<div class="sw q">waiting ' + fmtWait(dWaitMin(d)) + ' · holds ' + blocksNow(d) + ' agent' + (blocksNow(d) === 1 ? '' : 's') + '</div>') + '<div class="h">Click to answer it here</div>';
  var w = 360 * u, hh = (hov.offsetHeight || 120) * u, x = px + 20 * u, y = py - hh - 10 * u;
  if (x + w > SAFE.r) x = px - w - 20 * u; if (y < SAFE.t) y = py + 24 * u; if (y + hh > SAFE.b) y = SAFE.b - hh;
  hov.style.left = (x / u) + 'px'; hov.style.top = (y / u) + 'px'; hov.classList.add('on'); hov._sig = null;
}
/* an agent is a body on the plan: point at it to see who it is and what it is doing */
function agentAtPx(px, py) {
  if (!HAS_SW || S.t !== AS_OF || S.open) return null;
  var lod = lodTiles(), now = performance.now(), best = null, bd = 1e9, u = U;
  AGS.forEach(function (A) {
    var p = agentPos(A, lod, now); if (!p) return;
    if (p.chip && !p.moving) { if (px >= p.x - 13 * u && px <= p.x + 45 * u && py >= p.y - 10 * u && py <= p.y + 10 * u) { var d0 = Math.abs(px - p.x); if (d0 < bd) { bd = d0; best = A; } } return; }
    var d = Math.hypot(px - p.x, py - p.y); if (d < 10 * u && d < bd) { bd = d; best = A; }
  });
  return best;
}
function showAgentTip(A, px, py) {
  var u = U, f = F[A.f], st = astat(A), dq = A.wait && DEC[A.wait] && DEC[A.wait].open ? DEC[A.wait] : null;
  hov.innerHTML = '<div class="k">' + esc(crewName(A.sq)) + ' crew · ' + esc(A.role) + (SCALE > 1 ? ' · ' + LINES[A.b][0] : '') + '</div><div class="n" style="font-size:21px">' + esc(A.base) + ' <span style="font-size:15px;font-weight:500;color:' + gcol(st) + '">' + ({ working: 'working', waiting: 'waiting for a person', blocked: 'blocked', failed: 'stopped, failed', paused: 'paused by you' }[st]) + '</span></div><div class="s">' + esc(A.task) + '</div><div class="e">' + esc(f.name) + ' · ' + Math.round(A.pct) + '% · $' + A.cost.toFixed(0) + ' today · ' + A.done + ' tasks done</div>' + (dq ? '<div class="sw q">Waiting on ' + esc(pname(dq.decider)) + ' · ' + esc(dq.base) + '</div>' : '') + '<div class="h">' + (dq ? 'Click to answer its question' : 'Click to open the feature') + '</div>';
  var w = 360 * u, hh = (hov.offsetHeight || 120) * u, x = px + 18 * u, y = py - hh - 12 * u;
  if (x + w > SAFE.r) x = px - w - 18 * u; if (y < SAFE.t) y = py + 22 * u; if (y + hh > SAFE.b) y = SAFE.b - hh;
  hov.style.left = (x / u) + 'px'; hov.style.top = (y / u) + 'px'; hov.classList.add('on'); hov._sig = null;
}
function clickAt(px, py) {
  var pn = pinAt(px, py); if (pn) { openDecisionCard(pn.d.id); return; }
  var ag = agentAtPx(px, py); if (ag) { var dq = ag.wait && DEC[ag.wait] && DEC[ag.wait].open ? DEC[ag.wait] : null; if (dq) openDecisionCard(dq.id); else if (lodTiles() > 0.5) openFeature(ag.f); else flyToFeature(ag.f); return; }
  var h = hitAt(px, py);
  if (!h) { if (S.open) closeFeature(); else if (S.dec) closeDcard(); return; }
  if (h.t === 'tile' && (h.o.w * cam.k >= 96 * U) && lodTiles() > 0.5) { openFeature(h.o.id); return; }
  for (var i = 0; i < h.chain.length; i++) { var c = h.chain[i], fk = fitOf(c); if (fk.k > cam.k * 1.12) { flyTo(fk); return; } }
  if (h.t === 'tile') openFeature(h.o.id);
}
function hitTarget(h) {
  if (!h) return null;
  if (h.t === 'tile' && lodTiles() > 0.5) return { type: 'tile', o: h.o };
  var ch2 = h.chain, pk = null; for (var j = 0; j < ch2.length; j++) { if (!entered(ch2[j])) { pk = ch2[j]; break; } }
  if (h.t === 'tile') return pk ? { type: pk.t, o: pk.o } : { type: 'tile', o: h.o };
  return pk ? { type: pk.t, o: pk.o } : null;
}
var hov = $('#hov');
function setHover(h, px, py) {
  var cur = S.hover ? S.hover.o.id + S.hover.type : '';
  var target = hitTarget(h), nxt = target ? target.o.id + target.type : '';
  if (nxt !== cur) { S.hover = target; dirty(); }
  if (!target) { hov.classList.remove('on'); cv.className = S.selMode ? 'sel' : ''; return; }
  cv.className = S.selMode ? 'sel' : target.type === 'tile' ? 'pt' : 'zin';
  if (nxt !== cur || hov._sig !== hoverSig()) { hov.innerHTML = hoverHTML(target); hov._sig = hoverSig(); }
  placeHover(target, px, py);
  hov.classList.add('on');
}
function hoverSig() { return S.lens + '|' + S.t + '|' + (HAS_SW ? Math.floor(SIM.t / 20) : 0); }
function placeHover(target, px, py) {
  var u = U, w = 360 * u, hh = (hov.offsetHeight || 140) * u, x, y;
  var hi = SAFE.t, lo = SAFE.b;
  if (target.type === 'tile') {
    var r = featRect(target.o.id, lodTiles());
    x = r.x + r.w + 14; y = r.y - 6;
    if (x + w > SAFE.r) x = r.x - w - 14;
    if (x < 6) { x = clamp(px + 18, 6, SAFE.r - w - 6); y = r.y + r.h + 12; }
  } else { x = px + 22; y = py + 20; if (x + w > SAFE.r) x = px - w - 22; }
  if (y + hh > lo) y = lo - hh; if (y < hi) y = hi;
  if (x < 6) x = 6;
  hov.style.left = (x / u) + 'px'; hov.style.top = (y / u) + 'px';
}
function plainStage(f, st) {
  var op = f.operations, s = st ? STAGE_PLAIN[st] : 'Not yet on the drawing at this date';
  if (S.t === AS_OF) {
    if (st === 'flagged' && op.flag) s = 'Live for ' + rolloutOf(f) + '% of studios, behind a switch';
    if (st === 'in-dev') s = 'Being built, about ' + Math.round(progOf(f)) + '% done';
  }
  return s;
}
function lensWords(f) {
  var L = S.lens, b = f.business, de = f.design, dv = f.development, op = f.operations, se = f.security, q = f.quality;
  if (L === 'business') return 'Value ' + b.value + '/5 · ' + (b.customerRequests30d || 0) + (b.customerRequests30d === 1 ? ' ask' : ' asks') + ' in 30 days · revenue: ' + b.revenueLink;
  if (L === 'design') return 'Design: ' + de.status + ' · accessibility: ' + de.a11y + (de.specDrift ? ' · built off-spec' : '');
  if (L === 'development') return dv.progressPct + '% done · ' + dv.aiAuthoredPct + '% by agents · ' + (dv.humanReviewed === false ? 'no human review' : dv.humanReviewed ? 'human reviewed' : 'review n/a') + (dv.unitCoveragePct != null ? ' · coverage ' + dv.unitCoveragePct + '%' : '');
  if (L === 'operations') return op.environment === 'production' ? 'Production · ' + rolloutOf(f) + '% rollout · p95 ' + op.p95ms + ' ms · ' + op.errorRatePct + '% errors · ' + (op.alerting ? 'alerting on' : 'no alerting') : 'Environment: ' + op.environment;
  if (L === 'security') return 'Data: ' + se.dataClass + ' · review: ' + se.review + (se.openFindings ? ' · ' + se.openFindings + ' findings' : '');
  if (L === 'quality') return (q.e2eTests ? q.e2ePassing + ' of ' + q.e2eTests + ' end-to-end tests pass' : 'No end-to-end tests') + ' · P1 bugs ' + q.openBugs.p1;
  return null;
}
function barHTML(c) {
  var segs = barSegs(c), tot = segs.reduce(function (a, s) { return a + s[0]; }, 0) || 1;
  return '<div class="bar">' + segs.map(function (s) { return s[0] ? '<i style="width:' + (100 * s[0] / tot).toFixed(1) + '%;background:' + (s[1] === 'hatch' ? 'repeating-linear-gradient(45deg,rgba(223,240,255,.55) 0 1px,rgba(223,240,255,.1) 1px 5px)' : s[1]) + '"></i>' : ''; }).join('') + '</div>';
}
function swarmHover(fs, single) {
  if (!HAS_SW || S.t !== AS_OF) return '';
  var ss = swStats(fs), o = '';
  if (ss.n) o += '<div class="sw">' + ss.n + ' agent' + (ss.n > 1 ? 's' : '') + ': ' + [ss.working && ss.working + ' working', ss.waiting && ss.waiting + ' waiting for a person', ss.blocked && ss.blocked + ' blocked', ss.failed && ss.failed + ' failed', ss.paused && ss.paused + ' paused'].filter(Boolean).join(' · ') + '</div>';
  if (ss.asks) o += '<div class="sw q">' + ss.asks + ' open question' + (ss.asks > 1 ? 's' : '') + (ss.mine ? ', ' + ss.mine + ' for ' + (S.who ? pname(S.who).split(' ')[0] : 'this sheet') : '') + '</div>';
  return o;
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
    if (HAS_SW && S.t === AS_OF) {
      o += swarmHover([f]);
      (AGF[f.id] || []).slice(0, 4).forEach(function (a) { o += '<div class="sw" style="color:var(--ink2);font-size:13px">' + esc(a.base) + ' · ' + esc(a.task.replace(/^(waiting|stopped|blocked by)[: ]+/i, function (m) { return astat(a) === 'waiting' ? 'asks: ' : m; })) + '</div>'; });
      var br = breachesOn(f.id); if (br.length) o += '<div class="t">● Breaches order ' + br.map(function (b) { return b.id; }).join(', ') + '</div>';
    }
    o += '<div class="h">Click to open the full sheet' + (S.selMode ? ' · Shift-click targets it' : '') + '</div>';
    return o;
  }
  var obj = t.o, fs, title, kick, sub;
  if (t.type === 'wing') { fs = obj.feats; title = obj.def.name; kick = 'Wing ' + obj.def.letter + (SCALE > 1 ? ' · ' + obj.bld.name : ''); sub = obj.def.plain + '. ' + obj.rooms.length + ' rooms: ' + obj.rooms.map(function (r) { return r.d.name; }).join(', ') + '.'; }
  else if (t.type === 'room') { fs = obj.feats; title = obj.d.name; kick = 'Room · wing ' + obj.wing.def.letter + ' ' + obj.wing.def.name; sub = obj.d.summary; }
  else if (t.type === 'bay') { fs = obj.feats; title = obj.cap.name; kick = 'Bay · ' + obj.room.d.name; sub = obj.tiles.length + ' features: ' + obj.tiles.map(function (T) { return T.f.name; }).join(', ') + '.'; }
  else { fs = obj.feats; title = obj.name; kick = 'Building'; sub = obj.wings.length + ' wings, ' + K.domains.filter(function (d) { return d.bld === obj.i; }).length + ' rooms'; }
  var agg = aggLine(fs, false), artK = t.type === 'wing' ? obj.def.art : t.type === 'room' ? obj.d.base : t.type === 'bay' ? obj.room.d.base : null;
  return (artK ? '<div class="art">' + illoSVG(artK, SHEET[S.lens].acc) + '</div>' : '') + '<div class="k">' + esc(kick) + '</div><div class="n">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div>' + barHTML(agg.c) +
    '<div class="e">' + esc(agg.parts.join(' · ')) + '</div>' + (agg.trouble ? '<div class="t">' + agg.trouble + ' in trouble</div>' : '') + swarmHover(fs) + '<div class="h">Click or scroll to go inside · Shift-click to target</div>';
}

/* pointer: drag pans, wheel and pinch zoom, click descends one level, shift-drag lassos, shift-click targets */
var ptrs = {}, drag = null, pinch = null;
function targetFromHit(h) {
  var t = hitTarget(h); if (!t) return null;
  var ids = {}, label = '';
  if (t.type === 'tile') { ids[t.o.id] = 1; label = t.o.f.name; }
  else { t.o.feats.forEach(function (f) { ids[f.id] = 1; }); label = t.type === 'wing' ? t.o.def.name + ' wing' : t.type === 'room' ? t.o.d.name : t.type === 'bay' ? t.o.cap.name : t.o.name; }
  return { ids: ids, label: label };
}
cv.addEventListener('pointerdown', function (e) {
  endIntro();
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  ptrs[e.pointerId] = local(e);
  var ids = Object.keys(ptrs);
  if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k }; drag = null; return; }
  var p = ptrs[e.pointerId];
  drag = { x0: p.x, y0: p.y, cx: cam.x, cy: cam.y, moved: false, lasso: e.shiftKey || S.selMode, shift: e.shiftKey };
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
      if (!drag.moved) { drag.moved = true; if (!drag.lasso) cv.classList.add('pan'); setHover(null); }
      if (drag.lasso) { S.lasso = { x0: drag.x0, y0: drag.y0, x1: p.x, y1: p.y }; dirty(); }
      else { anim = null; wz = null; cam.x = drag.cx - dx / cam.k; cam.y = drag.cy - dy / cam.k; dirty(); }
    }
    return;
  }
  var pn = pinAt(p.x, p.y);
  if (pn) { if (S.hover) { S.hover = null; dirty(); } showPinTip(pn, p.x, p.y); cv.className = 'pt'; return; }
  var ag = agentAtPx(p.x, p.y);
  if (ag) { if (S.hover) { S.hover = null; dirty(); } showAgentTip(ag, p.x, p.y); cv.className = 'pt'; return; }
  setHover(hitAt(p.x, p.y), p.x, p.y);
});
function lassoSelect(l) {
  var x0 = Math.min(l.x0, l.x1), x1 = Math.max(l.x0, l.x1), y0 = Math.min(l.y0, l.y1), y1 = Math.max(l.y0, l.y1), lod = lodTiles(), ids = {}, n = 0;
  TILES.forEach(function (T) { var r = featRect(T.id, lod); if (!r) return; var ox = Math.min(x1, r.x + r.w) - Math.max(x0, r.x), oy = Math.min(y1, r.y + r.h) - Math.max(y0, r.y); if (ox > 0 && oy > 0 && ox * oy >= 0.4 * r.w * r.h) { ids[T.id] = 1; n++; } });
  return { ids: ids, n: n };
}
function endPtr(e) {
  var p = ptrs[e.pointerId]; delete ptrs[e.pointerId];
  if (pinch) { if (Object.keys(ptrs).length < 2) pinch = null; drag = null; return; }
  if (drag && e.type === 'pointerup' && p) {
    if (drag.moved && drag.lasso && S.lasso) { var r = lassoSelect(S.lasso); S.lasso = null; if (r.n) setTarget(r.ids, r.n + ' features in the box'); else dirty(); }
    else if (!drag.moved) { if (drag.shift || S.selMode) { var tg = targetFromHit(hitAt(p.x, p.y)); if (tg) { if (drag.shift && S.tgt.n) { for (var k in tg.ids) S.tgt.ids[k] = 1; S.tgt.n = Object.keys(S.tgt.ids).length; S.tgt.label = S.tgt.n + ' places'; setTarget(S.tgt.ids, S.tgt.label); } else setTarget(tg.ids, tg.label); } } else clickAt(p.x, p.y); }
  }
  S.lasso = null; drag = null; cv.classList.remove('pan'); dirty();
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
  if (S.dec) { closeDcard(); return; }
  if (S.prev) { S.prev = null; uiSteer(); dirty(); return; }
  if (S.tgt.n) { clearTarget(); return; }
  if (S.blast) { setMode({ blast: null }); return; }
  if (S.ga) { setMode({ ga: false }); return; }
  if (S.key) { S.key = null; renderDock(); dirty(); return; }
  var p = PLACE;
  if (!p.length) { if (Math.abs(cam.k / HOME.k - 1) > 0.02 || Math.hypot(cam.x - HOME.x, cam.y - HOME.y) * cam.k > 4) goHome(); else if (S.t !== AS_OF) setT(AS_OF); return; }
  if (p.length === 1) { goHome(); return; }
  flyTo(fitOf(p[p.length - 2]));
}
function goLevel(depth) {
  if (depth === 0) { goHome(); return; }
  var ch = chainBest();
  if (!ch.length) { var R0 = WALK[0]; ch = chainAt(R0.x + R0.w / 2, R0.y + RH + 20); }
  var c = ch[Math.min(depth, ch.length) - 1];
  if (c) flyTo(fitOf(c));
}
function levelNames() { return (SCALE > 1 ? ['Campus', 'Building'] : ['Site']).concat(['Wing', 'Room', 'Bay', 'Feature']); }
function walk(dir) {
  var cur = PLACE.filter(function (c) { return c.t === 'room' || c.t === 'bay'; })[0];
  var i = cur ? WALK.indexOf(cur.t === 'bay' ? cur.o.room : cur.o) : -1;
  if (i < 0) { var ch = chainBest(), w = ch.filter(function (c) { return c.t === 'wing'; })[0]; i = w ? WALK.indexOf(w.o.rooms[0]) - (dir > 0 ? 1 : 0) : (dir > 0 ? -1 : WALK.length); }
  i = (i + dir + WALK.length) % WALK.length;
  flyTo(fitCam(WALK[i], PADS.room, OVER.room));
}
function flyToFeature(id) { var T = TILE[id]; if (!T) return; var k = Math.max(cam.k, 0.95); flyTo(fitCam({ x: T.x - 120, y: T.y - 90, w: T.w + 240, h: T.h + 180 }, { t: 40, r: 30, b: 60, l: 30 }, 1)); }
var camBefore = null;
function detailRegion() { var w = Math.min(950, FW / U - 300) * U; return { l: SAFE.l, t: SAFE.t, r: Math.min(SAFE.r, FW - w - 20 * U), b: SAFE.b }; }
function openFeature(id, opts) {
  opts = opts || {};
  if (!F[id]) return;
  if (!S.open) camBefore = { x: cam.x, y: cam.y, k: cam.k };
  S.open = id; S.sel = null; S.hl = null; S.dec = null;
  setHover(null); uiDcard();
  var det = $('#detail');
  $('#dscroll').innerHTML = detailHTML(F[id]); $('#dscroll').scrollTop = 0;
  det.classList.add('open'); det.setAttribute('aria-hidden', 'false');
  if (phone) openPhone(id);
  var T = TILE[id], R = detailRegion();
  var c = fitCam({ x: T.x - 20, y: T.y - 20, w: T.w + 40, h: T.h + 40 }, { t: 40, r: 20, b: 60, l: 20 }, 1, R);
  c.k = clamp(Math.min(c.k, 1.5), KMIN, KMAX); var cx = (R.l + R.r) / 2, cy = (R.t + R.b) / 2;
  flyTo({ x: T.x + T.w / 2 - (cx - FW / 2) / c.k, y: T.y + T.h / 2 - (cy - FH / 2) / c.k, k: c.k }, opts.dur);
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
    flyTo(fitCam({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { t: 40, r: 370, b: 56, l: 30 }));
  }
  dirty(); writeHashSoon();
}
function toggleBlast() {
  if (S.blast) { setMode({ blast: null }); return; }
  var id = S.open || S.sel || (S.hover && S.hover.type === 'tile' ? S.hover.o.id : null) || 'PLT-02' + (SCALE > 1 ? '-S' : '');
  setMode({ blast: id, ga: false });
}

/* ================================================================== chrome: sheets (lenses), crumbs, ladder, dock */
function fntD(sz, wt, fam) { return (wt || 500) + ' ' + sz + 'px ' + (fam || FONT); }
function renderTabs() {
  $('#tabs').innerHTML = SHEETS.map(function (s, i) {
    var n = HAS_SW ? DECS.filter(function (d) { return d.open && (s.k === 'general' ? false : d.lens === s.k); }).length : 0;
    return '<button role="tab" data-lens="' + s.k + '" aria-selected="' + (S.lens === s.k) + '" title="' + esc(s.title) + ' (' + (i + 1) + ')' + (n ? ' · ' + n + ' questions waiting on this sheet' : '') + '"><span class="no">' + s.no + (n ? '<b class="ct">' + n + '</b>' : '') + '</span><span class="nm">' + s.nm + '</span><span class="kb">' + (i + 1) + '</span></button>';
  }).join('');
  var sh = SHEET[S.lens];
  $('#proj').innerHTML = 'Project Kettle · drawing set · <b>sheet ' + sh.no + ' · ' + esc(sh.title) + '</b> · simulated swarm';
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
  var f = fntD(19, 600), avail = ($('#brand').clientWidth || 600) - 14;
  function width(short) { return items.reduce(function (a, it, i) { var l = it.c ? crumbLabel(it.c, short && i < items.length - 1) : it.lab; return a + tw(l.toUpperCase(), f, 0.95) + 26; }, 0); }
  var short = S.open || width(false) > avail;
  var cur = PLACE.length ? PLACE[PLACE.length - 1].o : null, fs = S.open ? null : cur ? cur.feats : K.features, sumH = '';
  if (fs) {
    var c = counts(fs), used = width(short), sf = fntD(15, 400), segs = [[fs.length + ' features', ''], [(c.live + c.flagged) + ' live', 'b'], [c.build + ' being built', ''], [(c.paper + c.dep) + ' promised', ''], [S.t === AS_OF && c.bad ? c.bad + ' in trouble' : '', 'em'], [HAS_SW && S.t === AS_OF ? (function () { var a = swStats(fs).asks; return a ? a + (a === 1 ? ' question' : ' questions') + ' waiting' : ''; })() : '', 'i']].filter(function (x) { return x[0]; });
    while (segs.length > 1 && used + 14 + tw(segs.map(function (x) { return x[0]; }).join(' · '), sf) > avail + 10) {
      var di = -1; for (var si = segs.length - 1; si >= 1; si--) if (segs[si][1] !== 'em' && segs[si][1] !== 'i') { di = si; break; }
      if (di < 0) break; segs.splice(di, 1);
    }
    if (used + 14 + tw(segs.map(function (x) { return x[0]; }).join(' · '), sf) <= avail + 10) sumH = '<span class="sum">' + segs.map(function (x) { return x[1] ? '<' + x[1] + '>' + x[0] + '</' + x[1] + '>' : x[0]; }).join(' · ') + '</span>';
  }
  var html = items.map(function (it, i) {
    var l = it.c ? crumbLabel(it.c, short && i < items.length - 1) : it.lab, last = i === items.length - 1;
    var full = it.c ? crumbLabel(it.c, false) : it.lab;
    return (i ? '<span class="sep">›</span>' : '') + '<button data-crumb="' + it.act + '"' + (it.i ? ' data-depth="' + it.i + '"' : '') + ' class="' + (last ? 'cur' : '') + '" title="' + esc(full) + '"' + (last ? ' aria-current="location"' : '') + '>' + esc(l) + '</button>';
  }).join('') + sumH;
  var cr = $('#crumbs'); if (cr._h !== html) { cr.innerHTML = html; cr._h = html; }
}
function renderLadder() {
  var names = levelNames(), depth = S.open ? names.length - 1 : PLACE.length;
  $('#ladder').innerHTML = '<button class="zb" data-zoom="-1" aria-label="Zoom out" title="Zoom out (−)">−</button><button class="zb" data-zoom="1" aria-label="Zoom in" title="Zoom in (+)">+</button><span class="lvl">LEVEL</span>' +
    '<button data-act="selmode" aria-pressed="' + !!S.selMode + '" title="Target mode: click or drag to select places (S). Shift-click and shift-drag work anytime." style="' + (S.selMode ? 'background:var(--cy);color:#061b38' : '') + '">⌖ TARGET</button>' + names.map(function (n, i) { return '<button data-level="' + i + '" class="' + (i === depth ? 'cur' : '') + '"' + (i === depth ? ' aria-current="true"' : '') + ' title="Go to level ' + i + '">L' + i + ' ' + n.toUpperCase() + '</button>'; }).join('');
}
function sym(st, w, h) {
  w = w || 22; h = h || 14;
  var o = '<svg width="' + (w + 2) + '" height="' + (h + 2) + '" viewBox="-1 -1 ' + (w + 2) + ' ' + (h + 2) + '" aria-hidden="true">';
  var r = '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="none" stroke="#dff0ff" stroke-width="1.3"';
  if (st === 'live') o += '<rect width="' + w + '" height="' + h + '" fill="rgba(223,240,255,.3)"/>' + r + '/>';
  else if (st === 'flagged') o += '<rect width="' + w * 0.45 + '" height="' + h + '" fill="rgba(223,240,255,.34)"/>' + r + '/>';
  else if (st === 'in-review') o += '<rect width="' + w + '" height="' + h + '" fill="url(#lhX)"/>' + r + '/>';
  else if (st === 'in-dev') o += '<rect width="' + w + '" height="' + h + '" fill="url(#lhS)"/><rect y="' + (h - 3) + '" width="' + w * 0.6 + '" height="3" fill="#dff0ff"/>' + r + '/>';
  else if (st === 'specified') o += r + ' stroke-dasharray="4 2.5"/>';
  else if (st === 'idea') o += r + ' stroke-dasharray="1 2.4" opacity=".75"/>';
  else if (st === 'deprecated') o += r + '/><path d="M0 0L' + w + ' ' + h + 'M' + w + ' 0L0 ' + h + '" stroke="#dff0ff" stroke-width="1.1"/>';
  else o += r + ' stroke-dasharray="1 3" opacity=".4"/>';
  return o + '</svg>';
}
var LEGDEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><pattern id="lhS" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#dff0ff" stroke-width="1" opacity=".7"/></pattern><pattern id="lhX" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4M0 0H4" stroke="#dff0ff" stroke-width=".8" opacity=".7"/></pattern>' +
  '<pattern id="ldSk" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><line x1="0" y1="0" x2="0" y2="6" stroke="#f2b6ff" stroke-width="1" opacity=".7"/></pattern><pattern id="ldHf" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 0V4M0 0H4" stroke="#f2b6ff" stroke-width=".8" opacity=".8"/></pattern>' +
  '<pattern id="lsPay" width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V3.4M0 0H3.4" stroke="#ff8f78" stroke-width=".9"/></pattern><pattern id="lsPer" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#ffc2b0" stroke-width="1" opacity=".8"/></pattern>' +
  '<pattern id="lsInt" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".9" fill="#dff0ff" opacity=".8"/></pattern><pattern id="lqF" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#ff6a58" stroke-width="1"/></pattern></defs></svg>';
function mk(inner) { return '<svg width="28" height="19" viewBox="-1 -1 28 19" aria-hidden="true">' + inner + '</svg>'; }
var M_CLOUD = mk('<path d="M2 2 q3 -3 6 0 q3 -3 6 0 q3 -3 6 0 q3 -3 4 0 q3 3 0 6 q3 3 0 6 q-1 3 -4 2 q-3 3 -6 0 q-3 3 -6 0 q-3 3 -6 -1 q-3 -3 0 -6 q-3 -3 0 -7z" fill="none" stroke="#ff6a58" stroke-width="1.3"/>');
var M_TICK = mk('<rect x="3" y="5" width="20" height="11" fill="none" stroke="#dff0ff" stroke-width="1" opacity=".5"/><path d="M14 4 l3 -4 M18 4 l3 -4" stroke="#ffc35a" stroke-width="1.8" stroke-linecap="round"/>');
var M_DELTA = mk('<path d="M13 2 l8 13 h-16z" fill="#9fe8ff"/>');
var M_DIA = mk('<path d="M13 2 l5 7 l-5 7 l-5 -7z" fill="none" stroke="#dff0ff" stroke-width="1.2"/>');
function sw(fill, extra) { return mk('<rect x="1" y="1" width="24" height="15" fill="' + fill + '" stroke="#dff0ff" stroke-width="1.2"/>' + (extra || '')); }
var M_WORK = mk('<circle cx="13" cy="9" r="4.5" fill="#6ff2c8" stroke="#04223a" stroke-width="1.2"/><path d="M13 1.5v2.2M13 14.3v2.2M5.5 9h2.2M18.3 9h2.2" stroke="#6ff2c8" stroke-width="1.3"/>');
var M_WAIT = mk('<circle cx="13" cy="9" r="5" fill="rgba(4,34,58,.8)" stroke="#ffc35a" stroke-width="2"/><circle cx="13" cy="9" r="1.6" fill="#ffc35a"/>');
var M_BLOCK = mk('<rect x="8" y="4" width="10" height="10" fill="#ff6a58" stroke="#04223a" stroke-width="1.2"/><path d="M10.5 9h5" stroke="#04223a" stroke-width="1.6"/>');
var M_FAIL = mk('<circle cx="13" cy="9" r="5" fill="rgba(60,8,12,.9)" stroke="#ff6a58" stroke-width="2"/><path d="M10.5 6.5l5 5M15.5 6.5l-5 5" stroke="#ff6a58" stroke-width="1.8"/>');
var M_PIN = mk('<path d="M9 16V2" stroke="#ffc35a" stroke-width="2"/><path d="M9 2l9 3-9 3z" fill="#ffc35a"/>');
var M_ORD = mk('<circle cx="13" cy="9" r="7" fill="none" stroke="#ffc35a" stroke-width="1.6" stroke-dasharray="3 2"/><text x="13" y="12.4" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="9" fill="#ffc35a">O</text>');
function legendFor(lens) {
  var items;
  if (lens === 'general') items = [[sym('live', 24, 15), 'Built · live'], [sym('flagged', 24, 15), 'Partly open'], [sym('in-review', 24, 15), 'Inspection'], [sym('in-dev', 24, 15), 'Construction'], [sym('specified', 24, 15), 'Proposed'], [sym('idea', 24, 15), 'Future idea'], [M_CLOUD, 'Trouble'], [M_TICK, 'Watch'], [M_DELTA, 'Changed'], [M_DIA, 'Unreviewed']];
  else if (lens === 'business') items = [[sw('rgba(147,240,198,.1)'), 'Value 1'], [mk('<rect x="1" y="1" width="24" height="15" fill="rgba(147,240,198,.4)" stroke="#93f0c6" stroke-width="3.4"/>'), 'Value 5'], [M_CLOUD, 'Business bad'], [M_TICK, 'Watch']];
  else if (lens === 'design') items = [[sw('none'), 'No design'], [sw('url(#ldSk)'), 'Sketch'], [sw('url(#ldHf)'), 'Hi-fi'], [sw('rgba(242,182,255,.3)'), 'Implemented'], [M_CLOUD, 'Design bad'], [M_TICK, 'Watch']];
  else if (lens === 'development') items = [[sw('none', '<rect x="1" y="7" width="24" height="9" fill="rgba(143,208,255,.45)"/>'), 'Progress'], [sw('none', '<rect x="20" y="3" width="3" height="13" fill="#8fd0ff"/>'), 'Share by agents'], [M_DIA, 'No human review'], [M_CLOUD, 'Dev bad']];
  else if (lens === 'operations') items = [[sw('none', '<rect x="1" y="1" width="9" height="15" fill="rgba(127,240,224,.45)"/>'), 'Rollout share'], [sw('url(#lsInt)'), 'Staging'], [M_CLOUD, 'Ops bad'], [M_TICK, 'Watch']];
  else if (lens === 'security') items = [[sw('url(#lsPay)'), 'Card data'], [sw('url(#lsPer)'), 'Personal data'], [sw('url(#lsInt)'), 'Internal'], [sw('none'), 'Public'], [M_CLOUD, 'Security bad'], [M_TICK, 'Watch']];
  else items = [[sw('none', '<rect x="1" y="1" width="16" height="15" fill="rgba(205,187,255,.45)"/><rect x="17" y="1" width="8" height="15" fill="url(#lqF)"/>'), 'E2E pass / fail'], [M_CLOUD, 'Quality bad'], [M_TICK, 'Watch'], [M_DELTA, 'Changed']];
  if (HAS_SW) items = items.concat([[M_WORK, 'Agent working'], [M_WAIT, 'Waiting for a person'], [M_BLOCK, 'Blocked'], [M_FAIL, 'Failed'], [M_PIN, 'A question (RFI)'], [M_ORD, 'Standing order']]);
  return items.map(function (it) { return '<div>' + it[0] + '<span>' + it[1] + '</span></div>'; }).join('');
}
var HINT = '<div id="hint"><b>Scroll</b> zoom · <b>drag</b> pan · <b>click</b> go in · <b>Esc</b> back<br><b>Shift-drag</b> box-select · <b>Shift-click</b> target · <b>S</b> target mode<br><b>/</b> find · <b>1–7</b> sheets · <b>J K</b> questions · <b>1–3</b> answer · <b>Space</b> pause swarm<br><b>M</b> morning watch · <b>P</b> person · <b>G</b> GA · <b>B</b> blast · <b>\\</b> panel</div>';

/* ---------- dock */
var DTABS = [['asks', 'Asks'], ['swarm', 'Swarm'], ['orders', 'Orders'], ['plan', 'Plan']];
S.dtab = 'asks'; S.askAll = false; S.crew = null; S.agf = 'all';
function renderDock() {
  var tabs = DTABS.map(function (t) {
    var n = t[0] === 'asks' ? (HAS_SW ? openDecs().length : 0) : t[0] === 'orders' ? (HAS_SW ? ORDS.filter(function (o) { return o.vf.length; }).length : 0) : 0;
    return '<button role="tab" data-dtab="' + t[0] + '" aria-selected="' + (S.dtab === t[0]) + '">' + t[1] + (n ? '<b>' + n + '</b>' : '') + '</button>';
  }).join('');
  var dt = $('#dtabs'); if (dt._h !== tabs) { dt.innerHTML = tabs; dt._h = tabs; }
  var body = $('#dbody'), st = body.scrollTop, html = S.dtab === 'asks' ? asksHTML() : S.dtab === 'swarm' ? swarmHTML() : S.dtab === 'orders' ? ordersHTML() : planHTML();
  if (body._h !== html) { body.innerHTML = html; body._h = html; body.scrollTop = st; }
  uiVitals();
}
function uiAll() { renderTabs(); renderDock(); uiVitals(); uiSel(); uiSteer(); uiClock(true); uiDcard(); renderRevs(); }
function uiQueue() { renderTabs(); if (S.dtab === 'asks') renderDock(); else { renderDock(); } uiVitals(); renderMorningIf(); }
function uiOrders() { if (S.dtab === 'orders') renderDock(); renderDockTabsOnly(); }
function renderDockTabsOnly() { renderDock(); }
function uiSteer() { if (S.dtab === 'swarm') renderDock(); }
function uiVitals() {
  var v = $('#vitals'), w = $('#who');
  if (!HAS_SW) { v.innerHTML = ''; w.style.display = 'none'; return; }
  var c = { working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0 }; AGS.forEach(function (a) { c[astat(a)]++; });
  var html = '<span title="Agents working">' + M_WORK.replace('width="28" height="19"', 'width="20" height="14"') + c.working + '</span><span title="Agents waiting for a person">' + M_WAIT.replace('width="28" height="19"', 'width="20" height="14"') + c.waiting + '</span><span title="Agents blocked">' + M_BLOCK.replace('width="28" height="19"', 'width="20" height="14"') + c.blocked + '</span><span title="Agents failed">' + M_FAIL.replace('width="28" height="19"', 'width="20" height="14"') + (c.failed) + '</span>' + (c.paused ? '<span title="Agents paused by you">' + c.paused + ' paused</span>' : '');
  if (v._h !== html) { v.innerHTML = html; v._h = html; }
  var p = S.who ? K0.people.filter(function (x) { return x.id === S.who; })[0] : null;
  var wh = '<span class="av">' + (p ? esc(p.name.charAt(0)) : '·') + '</span><span class="nm">' + (p ? esc(p.name.split(' ')[0]) : 'Everyone') + '</span><span class="cv">▾</span>';
  if (w._h !== wh) { w.innerHTML = wh; w._h = wh; }
}
function renderWhoMenu() {
  var rows = [{ id: null, name: 'Everyone', sub: 'the whole product, all sheets', n: openDecs().length }].concat(PERSONS.map(function (p) { return { id: p.id, name: p.name, sub: p.title + ' · ' + SHEET[PERSON_LENS[p.id]].nm, n: openDecs().filter(function (d) { return d.decider === p.id; }).length }; }));
  $('#whoMenu').innerHTML = rows.map(function (r) { return '<li role="option" tabindex="0" data-who="' + (r.id || '') + '" class="' + ((S.who || '') === (r.id || '') ? 'on' : '') + '" aria-selected="' + ((S.who || '') === (r.id || '')) + '"><span class="av">' + esc(r.name.charAt(0)) + '</span><span>' + esc(r.name) + '<small>' + esc(r.sub) + '</small></span><span class="n">' + r.n + '</span></li>'; }).join('');
}
function toggleWho(on) {
  var m = $('#whoMenu'), b = $('#who'); if (on == null) on = !m.classList.contains('on');
  if (on) renderWhoMenu(); m.classList.toggle('on', on); b.setAttribute('aria-expanded', String(on));
  if (on) { var s = m.querySelector('li.on') || m.querySelector('li'); if (s) s.focus(); }
}
function setWho(id) {
  S.who = id || null; toggleWho(false);
  if (S.who) setLens(PERSON_LENS[S.who], true);
  S.dtab = 'asks'; renderDock(); renderTabs(); dirty();
  var q = queueFor(); if (S.who) uiToast('Viewing as <b>' + esc(pname(S.who)) + '</b> · ' + q.mine.length + ' question' + (q.mine.length === 1 ? '' : 's') + ' wait for them', null);
}
function asksHTML() {
  if (!HAS_SW) return '<div class="qempty"><b>No swarm data</b>The swarm file did not load.</div>';
  var q = queueFor(), o = '', ms = morningStats();
  o += '<button class="bt" style="margin:10px 12px 2px;width:calc(100% - 24px);justify-content:space-between;height:34px;letter-spacing:.03em" data-act="morning"><span>While you were away</span><span style="color:var(--amber)">' + ms.changes + ' changes · ' + ms.asked + ' asked</span></button>';
  function item(d) {
    var f = F[d.f], on = S.dec === d.id, urgW = d.urg === 'high' ? 'Urgent' : d.urg === 'medium' ? 'Soon' : 'When you can', A = AG[d.by];
    return '<li class="qi u-' + d.urg + (on ? ' on' : '') + (emph(d) ? '' : ' dim') + '" data-dec="' + d.id + '" tabindex="0" aria-current="' + on + '"><div class="k"><span>' + urgW + ' · <span class="lz">' + SHEET[d.lens].no + '</span></span><span>' + esc(d.base) + (SCALE > 1 ? ' · ' + LINES[d.b][0] : '') + (d.isNew ? ' · NEW' : '') + '</span></div>' +
      '<h4>' + esc(d.q) + '</h4><div class="mt">' + esc(f.name) + ' · ' + esc(D[f.domain].name) + '<br>' + esc(pname(d.decider)) + ' decides · waiting <b>' + fmtWait(dWaitMin(d)) + '</b> · holds <b>' + blocksNow(d) + '</b> agent' + (blocksNow(d) === 1 ? '' : 's') + '</div>' +
      '<div class="row" style="margin-top:7px"><button class="bt go" style="height:auto;min-height:28px;padding:4px 10px;white-space:normal;text-align:left;text-transform:none;letter-spacing:0;font-size:14px" data-decide="' + d.id + '" data-opt="' + d.rec + '" title="Accept the agent’s recommendation (Enter)">✓ ' + esc(d.opts[d.rec].label) + '</button></div></li>';
  }
  if (S.who) {
    var p = pname(S.who);
    o += '<h3 class="dsec-h"><span>Waiting for ' + esc(p.split(' ')[0]) + '</span><span>' + q.mine.length + '</span></h3>';
    o += q.mine.length ? '<ul class="qlist">' + q.mine.map(item).join('') + '</ul>' : '<div class="qempty"><b>Nothing waits for you</b>Every agent that needs ' + esc(p.split(' ')[0]) + ' has what it needs. The swarm is working.</div>';
    o += '<h3 class="dsec-h"><span>Everyone else</span><span>' + q.rest.length + '</span></h3>';
    var rest = S.askAll ? q.rest : q.rest.slice(0, 4);
    o += '<ul class="qlist">' + rest.map(item).join('') + '</ul>';
    if (q.rest.length > 4) o += '<button class="qmore" style="width:100%;text-align:left;border-left:0;border-right:0;border-top:0;color:var(--ink)" data-act="askall">' + (S.askAll ? 'Show fewer' : 'Show all ' + q.rest.length) + '</button>';
  } else {
    o += '<h3 class="dsec-h"><span>' + (S.lens === 'general' ? 'Waiting for a person' : 'Sheet ' + SHEET[S.lens].no + ' first') + '</span><span>' + q.all.length + '</span></h3>';
    var all = S.lens === 'general' ? q.all : q.rest; if (!S.askAll && all.length > 8) all = all.slice(0, 8);
    o += '<ul class="qlist">' + all.map(item).join('') + '</ul>';
    if (q.all.length > 8) o += '<button class="qmore" style="width:100%;text-align:left;border-left:0;border-right:0;border-top:0;color:var(--ink)" data-act="askall">' + (S.askAll ? 'Show fewer' : 'Show all ' + q.all.length) + '</button>';
  }
  return o;
}
function swarmHTML() {
  if (!HAS_SW) return '<div class="qempty">No swarm data.</div>';
  var c = { working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0 }; AGS.forEach(function (a) { c[astat(a)]++; });
  var tot = AGS.length || 1, o = '';
  o += '<h3 class="dsec-h"><span>Steer the swarm</span><span>' + AGS.length + ' agents</span></h3>';
  o += '<div class="steer"><h5>Payments GA first</h5><p>Pull the agents working on M3 and M4 onto the unfinished Payments GA features. Order O-4 allows it.</p>' +
    (S.prev && S.prev.order === 'O-4' ? prevHTML() : '<button class="bt" data-act="pv-ga">Preview what it moves</button>') + '</div>';
  o += '<div class="steer"><h5>Pause the research crew</h5><p>The daily spend cap order (O-7) says research stops first. Spend today: $' + Math.round(AGS.reduce(function (s, a) { return s + a.cost; }, 0)).toLocaleString('en-US') + ' of $2,400.</p>' +
    (S.prev && S.prev.order === 'O-7' ? prevHTML() : '<button class="bt" data-act="pv-res">Preview</button>') + '</div>';
  if (S.tgt.n) {
    o += '<div class="steer"><h5>On your selection</h5><p>' + esc(S.tgt.label) + ' · ' + S.tgt.n + ' features</p>' + (S.prev && !S.prev.order ? prevHTML() : '<div class="row" style="display:flex;gap:6px;flex-wrap:wrap"><button class="bt" data-act="pv-push">Put the swarm here</button><button class="bt" data-act="pv-pause">Pause</button><button class="bt" data-act="pv-resume">Resume</button></div>') + '</div>';
  } else o += '<div class="steer"><h5>Point at a place</h5><p>Shift-click a wing, room or fixture, or shift-drag a box, then pull agents, pause them or write an order for exactly that place.</p></div>';
  o += '<h3 class="dsec-h"><span>Latest from the swarm</span><span>simulated</span></h3><div class="lat">' + (TK.length ? TK.slice(0, 7).map(function (e) { var a = AG[e.agent], tm = new Date(AT0 + e.t * 1000).toISOString().slice(11, 16); return '<button data-flyf="' + e.f + '" class="' + (TICK_CLASS[e.type] || '') + '"><i>' + tm + '</i><span>' + esc((a ? a.base + ' ' : '') + (e.type === 'move' ? e.text.replace(/^S+ /, '') : e.text)) + '</span></button>'; }).join('') : '<div style="padding:6px 12px;color:var(--ink2)">Nothing yet this hour.</div>') + '</div>';
  o += '<h3 class="dsec-h"><span>Crews</span><span>working · waiting · blocked</span></h3>';
  SQLIST.forEach(function (q) {
    var ag = AGS.filter(function (a) { return a.sq === q.id; }), cc = { working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0 }; ag.forEach(function (a) { cc[astat(a)]++; });
    var on = S.crew === q.id;
    o += '<button class="crew' + (on ? ' on' : '') + '" data-crew="' + q.id + '"><span class="n">' + esc(q.name.replace(' crew', '')) + '<i>' + esc(q.role) + '</i></span><span class="c"><span style="color:' + MINT + '">' + cc.working + '</span><span style="color:' + AMB + '">' + cc.waiting + '</span><span style="color:' + RED + '">' + (cc.blocked + cc.failed) + '</span></span><span class="f">' + esc(q.focus) + '</span>' +
      '<span class="stk">' + ['working', MINT, 'waiting', AMB, 'blocked', RED, 'failed', '#ff3d7a', 'paused', '#9fb4c8'].reduce(function (a, x, i, arr) { if (i % 2) return a; return a + (cc[x] ? '<i style="width:' + (100 * cc[x] / ag.length).toFixed(1) + '%;background:' + arr[i + 1] + '"></i>' : ''); }, '') + '</span></button>';
    if (on) ag.forEach(function (a) {
      o += '<button class="agrow" data-agent="' + a.id + '"><span>' + ({ working: M_WORK, waiting: M_WAIT, blocked: M_BLOCK, failed: M_FAIL, paused: M_WAIT }[astat(a)] || '').replace('width="28" height="19"', 'width="16" height="12"') + '</span><span class="t"><small>' + esc(a.base) + ' · ' + esc(F[a.f].name) + '</small>' + esc(a.task) + '</span><span class="p">' + Math.round(a.pct) + '%</span></button>';
    });
  });
  return o;
}
function prevHTML() {
  var p = S.prev; if (!p) return '';
  return '<div class="prev"><div class="big">' + esc(p.title) + '</div><ul>' + p.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul><div class="row"><button class="bt go" data-act="pv-commit">Commit · Enter</button><button class="bt" data-act="pv-cancel">Cancel · Esc</button></div></div>';
}
function ordersHTML() {
  if (!HAS_SW) return '<div class="qempty">No swarm data.</div>';
  var o = '<h3 class="dsec-h"><span>Standing orders</span><span>' + ORDS.length + ' · ' + ORDS.reduce(function (s, x) { return s + x.vf.length; }, 0) + ' breached</span></h3>';
  ORDS.forEach(function (ord) {
    var by = K0.people.filter(function (p) { return p.id === ord.by; })[0], n = ord.vf.length;
    o += '<div class="ord' + (n ? ' v' : '') + (S.ordHi === ord.id ? ' on' : '') + '" data-ord="' + ord.id + '" tabindex="0" role="button"><span class="st">' + ord.id + '</span><span class="tx">' + esc(ord.text) + '</span><span class="sc">' + esc(scopeWords(ord)) + ' · ' + esc(by ? by.name.split(' ')[0] : ord.by) + (ord.user ? ' · new' : ' · since ' + ord.since.slice(5)) + '</span>' +
      '<span class="vi">' + (n ? n + ' breach' + (n > 1 ? 'es' : '') + ': ' + ord.vf.slice(0, 4).map(function (id) { return '<button data-flyf="' + id + '">' + esc(id.replace(/-[A-Z]$/, '')) + '</button>'; }).join('') + (n > 4 ? '+' + (n - 4) : '') : 'No breach') + '</span></div>';
  });
  o += '<div class="qempty" style="font-size:13px">Hover an order to see the places it governs. Select places on the plan, then write an order from the selection bar.</div>';
  return o;
}
function planHTML() {
  var deep = PLACE.filter(function (c) { return c.t === 'room' || c.t === 'bay'; }), o = LEGDEFS;
  if (deep.length && !S.ga && !S.blast) {
    var R = deep[0].o; o += '<h3 class="dsec-h"><span>Room schedule · ' + esc(R.d.base) + '</span><span>' + R.feats.length + ' features</span></h3><ul class="sched">';
    R.bays.forEach(function (Bay) {
      o += '<li class="cap">' + esc(Bay.cap.name) + '</li>';
      Bay.tiles.forEach(function (T) {
        var f = T.f, st = stageAt(f, S.t), hl = lensHealth(f), now = S.t === AS_OF, ag = HAS_SW ? (AGF[f.id] || []).length : 0;
        o += '<li><button data-open="' + f.id + '" data-hov="' + f.id + '">' + sym(st, 20, 13) + '<span>' + esc(f.name) + (ag ? ' <span style="color:' + MINT + ';font:500 12px var(--mono)">◉' + ag + '</span>' : '') + '</span><span class="w" style="color:' + (now && hl === 'bad' ? '#ff9a8c' : now && hl === 'watch' ? '#ffc35a' : '') + '">' + (st ? STAGE_WORD[st] : 'Not yet') + '</span></button></li>';
      });
    });
    return o + '</ul>' + HINT;
  }
  var kc = {}; K.features.forEach(function (f) { f.flags.forEach(function (k) { kc[k] = (kc[k] || 0) + 1; }); });
  o += '<h3 class="dsec-h"><span>Legend · ' + SHEET[S.lens].no + '</span><span>' + SHEET[S.lens].nm + '</span></h3><div class="lg">' + legendFor(S.lens) + '</div>';
  o += '<h3 class="dsec-h"><span>Tensions · click to find</span><span>features</span></h3><ul class="kn">' +
    FLAGS.map(function (x) { return '<li data-key="' + x[0] + '" tabindex="0" role="button" aria-pressed="' + (S.key === x[0]) + '" class="' + (S.key === x[0] ? 'on' : '') + '"><span class="d"></span><span>' + x[1] + '</span><span class="c">' + (kc[x[0]] || 0) + '</span></li>'; }).join('') + '</ul>' + tbHTML() + HINT;
  return o;
}
function tbHTML() {
  var sh = SHEET[S.lens], c = counts(K.features), rev = revAt(S.t), now = S.t === AS_OF;
  return '<div class="tbk"><div class="proj"><div class="v">KETTLE</div><span class="lab">' + (SCALE > 1 ? 'Campus ×' + SCALE : 'Project') + '</span></div>' +
    '<div class="sheet"><span class="lab">Sheet</span><span class="no">' + sh.no + '</span><span class="of">' + (SHEETS.indexOf(sh) + 1) + ' of 7</span></div>' +
    '<div class="ttl"><span class="lab">' + S.t + ' · rev ' + rev + '/27</span><div class="v">' + esc(sh.title) + '</div></div>' +
    '<div class="schedT"><span class="lab">Schedule · ' + (NF - c.none) + ' features' + (SCALE > 1 ? ' · ×' + SCALE : '') + '</span><table>' +
    '<tr><td class="sy">' + sym('live', 18, 11) + '</td><td>Built, live for all</td><td class="n">' + c.live + '</td></tr>' +
    '<tr><td class="sy">' + sym('flagged', 18, 11) + '</td><td>Partly open, flagged</td><td class="n">' + c.flagged + '</td></tr>' +
    '<tr><td class="sy">' + sym('in-dev', 18, 11) + '</td><td>Being built or reviewed</td><td class="n">' + c.build + '</td></tr>' +
    '<tr><td class="sy">' + sym('specified', 18, 11) + '</td><td>On paper, promised</td><td class="n">' + (c.paper + c.dep) + '</td></tr>' +
    '<tr class="tr"><td class="sy">' + M_CLOUD.replace('width="28" height="19"', 'width="20" height="14"') + '</td><td>In trouble</td><td class="n">' + (now ? K.features.filter(function (f) { return f.health === 'bad'; }).length : '—') + '</td></tr>' +
    '<tr><td class="sy">' + M_DELTA.replace('width="28" height="19"', 'width="20" height="14"') + '</td><td>Changed, last ' + (S.delta === 1 ? '24 h' : S.delta + ' days') + '</td><td class="n">' + c.chg + '</td></tr>' +
    '</table></div><div class="disc" style="grid-column:1/3;padding:2px 8px;font:400 12px var(--mono);color:var(--ink2)">Sample data · simulated swarm · artwork stylised</div></div>';
}
function syncTools() {
  Array.prototype.forEach.call(document.querySelectorAll('#tools [data-delta]'), function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-delta') === S.delta)); });
  var ga = $('#bga'), bl = $('#bblast'); if (ga) ga.setAttribute('aria-pressed', String(!!S.ga)); if (bl) bl.setAttribute('aria-pressed', String(!!S.blast));
  renderCallout();
}

/* ---------- callout: blast radius / Payments GA */
function renderCallout() {
  var call = $('#callout');
  call.style.left = Math.max(10, SAFE.r / U - 340) + 'px'; call.style.top = (SAFE.t / U + 4) + 'px';
  if (S.blast) {
    var bl = closure(S.blast), f0 = F[S.blast], direct = f0.usedBy;
    var prodAll = bl.filter(function (id) { return isLiveSt(F[id].stage); }), prodDir = direct.filter(function (id) { return isLiveSt(F[id].stage); });
    call.className = '';
    call.innerHTML = '<button class="x" data-act="unblast">CLEAR · ESC</button><h4>Blast radius · ' + esc(f0.id) + '</h4>' +
      '<div class="big">If ' + esc(f0.name) + ' breaks</div>' +
      '<div class="row"><span>Depend on it directly</span><b>' + direct.length + '</b></div>' +
      '<div class="row"><span>…of them live for customers</span><b style="color:#ff9a8c">' + prodDir.length + '</b></div>' +
      '<div class="row"><span>Reached through the chain</span><b>' + bl.length + '</b></div>' +
      '<div class="row"><span>…of them live for customers</span><b>' + prodAll.length + '</b></div>' +
      (HAS_SW ? '<div class="row"><span>Agents working inside that radius</span><b style="color:' + MINT + '">' + AGS.filter(function (a) { return a.f === S.blast || bl.indexOf(a.f) >= 0; }).length + '</b></div>' : '') +
      '<div class="sub">DIRECT DEPENDENTS</div>' + direct.map(function (id) { return '<button class="lnk" data-open="' + id + '"><i>' + id + '</i>' + esc(F[id].name) + ' <span style="color:#a9c3dc">· ' + STAGE_WORD[F[id].stage].toLowerCase() + '</span></button>'; }).join('');
    call.style.display = 'block';
  } else if (S.ga) {
    var m2 = K.features.filter(function (f) { return f.milestone === 'M2'; });
    var cnt = function (fn) { return m2.filter(fn).length; };
    var blocked = m2.filter(function (f) { return f.flags.indexOf('blocked') >= 0; });
    var unsafe = m2.filter(function (f) { return isLiveSt(f.stage) && (f.flags.indexOf('security-gap') >= 0 || f.flags.indexOf('ai-unreviewed-in-production') >= 0); });
    var days = Math.round(dnum(MS.M2.date) - dnum(AS_OF));
    var onM2 = HAS_SW ? AGS.filter(function (a) { return msOf(a.f) === 'M2'; }).length : 0;
    call.className = 'ga';
    call.innerHTML = '<button class="x" data-act="ungi">CLOSE · G</button><h4>Milestone M2 · ' + MS.M2.date + '</h4><div class="big">Payments GA in ' + days + ' days</div>' +
      '<div class="row"><span>Features in this release</span><b>' + m2.length + '</b></div>' +
      '<div class="row"><span>Done, live for all</span><b>' + cnt(function (f) { return f.stage === 'live'; }) + '</b></div>' +
      '<div class="row"><span>Partly open (flagged)</span><b>' + cnt(function (f) { return f.stage === 'flagged'; }) + '</b></div>' +
      '<div class="row"><span>Still being built or reviewed</span><b>' + cnt(function (f) { return f.stage === 'in-dev' || f.stage === 'in-review'; }) + '</b></div>' +
      '<div class="row"><span>Not started</span><b>' + cnt(function (f) { return f.stage === 'specified' || f.stage === 'idea'; }) + '</b></div>' +
      '<div class="row"><span>Blocked</span><b style="color:#ffc35a">' + blocked.length + '</b></div>' +
      '<div class="row"><span>Done but unsafe</span><b style="color:#ff9a8c">' + unsafe.length + '</b></div>' +
      (HAS_SW ? '<div class="row"><span>Agents on it right now</span><b style="color:' + MINT + '">' + onM2 + ' of ' + AGS.length + '</b></div><div style="margin-top:8px"><button class="bt go" data-act="pv-ga" style="width:100%;justify-content:center">Put the swarm on it…</button></div>' : '') +
      '<div class="sub">DONE BUT UNSAFE</div>' + unsafe.map(function (f) { return '<button class="lnk" data-open="' + f.id + '"><i>' + f.id + '</i>' + esc(f.name) + '</button>'; }).join('') +
      '<div class="sub">BLOCKED</div>' + blocked.map(function (f) { return '<button class="lnk" data-open="' + f.id + '"><i>' + f.id + '</i>' + esc(f.name) + ' <span style="color:#a9c3dc">← ' + f.blockedBy.map(function (b) { return esc(F[b].name); }).join(', ') + '</span></button>'; }).join('');
    call.style.display = 'block';
  } else { call.style.display = 'none'; call.innerHTML = ''; }
}

/* ================================================================== toast, ticker, selection bar, decision card */
var toastTimer = 0;
function uiToast(html, fid, action) {
  var t = $('#toast');
  t.innerHTML = '<span>' + html + '</span>' + (action === 'undo' ? '<button data-act="undo">UNDO</button>' : action === 'undo2' ? '<button data-act="undo2">UNDO</button>' : action === 'replay' ? '<button data-act="restart">↺ REPLAY</button>' : '') + (fid ? '<button data-flyf="' + fid + '">SHOW</button>' : '');
  t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, action ? 9000 : 5200);
}
var TK = [], tkDirty = false, tkLast = 0;
function uiEvent(e) {
  if (SIM.speed > 60 && e.syn) return;
  if (e.type === 'commit' && SIM.speed > 60) return;
  TK.unshift(e); if (TK.length > 12) TK.pop(); tkDirty = true;
  if (S.dtab === 'swarm' && !S.crew && performance.now() - (uiEvent.t || 0) > 1500) { uiEvent.t = performance.now(); setTimeout(renderDock, 0); }
}
function renderTicker(now) {
  if (!tkDirty || now - tkLast < 200) return; tkDirty = false; tkLast = now;
  var el = $('#ticker');
  el.innerHTML = TK.slice(0, 1).map(function (e) {
    var tm = new Date(AT0 + e.t * 1000).toISOString().slice(11, 16), a = AG[e.agent], tx = e.type === 'move' ? e.text.replace(/^[a-z]+(?:-\d)?\.\d+(?:-[A-Z])?/, a ? a.base : e.agent) : (a ? a.base : e.agent) + ' ' + e.text;
    return '<div class="' + (TICK_CLASS[e.type] || '') + '"><i>' + tm + '</i><span>' + esc(tx) + '</span></div>';
  }).reverse().join('');
}
function uiSel() {
  var el = $('#selbar'), p = S.prev;
  if (p) {
    el.className = 'on prev';
    el.innerHTML = '<div style="font:500 12px var(--mono);letter-spacing:.1em;color:var(--mint)">ADDENDUM · NOT ISSUED YET</div><div class="big" style="font-size:18px;font-weight:600;color:#fff">' + esc(p.title) + '</div><ul style="margin:2px 0 4px;padding-left:18px;font-size:14px;line-height:1.4">' + p.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul><div style="display:flex;gap:8px"><button class="bt go" data-act="pv-commit">Commit · Enter</button><button class="bt" data-act="pv-cancel">Cancel · Esc</button><span style="align-self:center;font-size:13px;color:var(--ink2)">Nothing has moved yet. The plan shows what would.</span></div>';
    return;
  }
  if (!S.tgt.n) { el.className = ''; el.innerHTML = ''; return; }
  var ag = agentsIn(S.tgt.ids), ds = []; for (var id in S.tgt.ids) (DOF[id] || []).forEach(function (d) { ds.push(d); });
  var wk = ag.filter(function (a) { return a.status === 'working' && !a.paused; }).length;
  el.className = 'on';
  el.innerHTML = '<span class="sm"><b>' + esc(S.tgt.label) + '</b> · ' + S.tgt.n + ' feature' + (S.tgt.n > 1 ? 's' : '') + ' · ' + ag.length + ' agent' + (ag.length === 1 ? '' : 's') + (ag.length ? ' (' + wk + ' working)' : '') + ' · ' + ds.length + ' question' + (ds.length === 1 ? '' : 's') + '</span>' +
    '<button class="btn" data-act="sel-look">Look closer</button><button class="btn" data-act="sel-info">What is going on?</button>' +
    '<button class="btn" data-act="pv-push">Put the swarm here…</button><button class="btn" data-act="pv-pause">Pause…</button><button class="btn" data-act="pv-resume">Resume…</button>' +
    (S.ordMenu ? ['review:Human review first', 'ask:Ask me before rollout', 'first:Agents here go first', 'hold:Hold here'].map(function (x) { var a = x.split(':'); return '<button class="btn" data-act="sel-order" data-tpl="' + a[0] + '" style="border-color:var(--amber);color:var(--amber)">' + a[1] + '</button>'; }).join('') : '<button class="btn" data-act="sel-ordmenu">Write an order…</button>') +
    '<button class="btn" data-act="sel-clear" title="Clear (Esc)">✕</button>';
}
function selInfo() {
  var ids = S.tgt.ids, ag = agentsIn(ids), ds = []; for (var id in ids) (DOF[id] || []).forEach(function (d) { ds.push(d); });
  var ev = SIM.log.filter(function (e) { return ids[e.f]; }).slice(0, 6), call = $('#callout');
  call.className = ''; call.style.left = Math.max(10, SAFE.r / U - 340) + 'px'; call.style.top = (SAFE.t / U + 4) + 'px';
  call.innerHTML = '<button class="x" data-act="info-close">CLOSE</button><h4>What is going on here</h4><div class="big">' + esc(S.tgt.label) + '</div>' +
    '<div class="row"><span>Features</span><b>' + S.tgt.n + '</b></div><div class="row"><span>Agents on them</span><b style="color:' + MINT + '">' + ag.length + '</b></div><div class="row"><span>Questions open</span><b style="color:' + AMB + '">' + ds.length + '</b></div>' +
    '<div class="sub">AGENTS</div>' + (ag.length ? ag.slice(0, 8).map(function (a) { return '<button class="lnk" data-flyf="' + a.f + '"><i>' + esc(a.base) + '</i>' + esc(astat(a)) + ' · ' + esc(a.task.length > 60 ? a.task.slice(0, 58) + '…' : a.task) + '</button>'; }).join('') : '<div style="color:var(--ink2)">No agent is working here right now.</div>') +
    '<div class="sub">QUESTIONS</div>' + (ds.length ? ds.slice(0, 5).map(function (d) { return '<button class="lnk" data-dec="' + d.id + '"><i>' + d.base + '</i>' + esc(d.q) + '</button>'; }).join('') : '<div style="color:var(--ink2)">None open.</div>') +
    '<div class="sub">LATEST</div>' + (ev.length ? ev.map(function (e) { return '<div style="color:var(--ink2);font-size:13px;padding:1px 0">' + new Date(AT0 + e.t * 1000).toISOString().slice(11, 16) + ' · ' + esc(e.text) + '</div>'; }).join('') : '<div style="color:var(--ink2)">Quiet so far this hour.</div>');
  call.style.display = 'block';
}
function dcOrder() { var q = queueFor(); return (S.who ? q.mine.concat(q.rest) : S.lens === 'general' ? q.all : q.rest.length ? q.rest.filter(function (d) { return d.lens === S.lens; }).concat(q.rest.filter(function (d) { return d.lens !== S.lens; })) : q.all); }
function openDecisionCard(id, noFly) {
  var d = DEC[id]; if (!d || !d.open) return;
  if (S.open) closeFeature();
  S.dec = id; d.isNew = false; S.hl = null; setHover(null);
  if (!noFly) {
    var T = TILE[d.f], R = { l: SAFE.l, t: SAFE.t, r: SAFE.r - 400 * U, b: SAFE.b };
    var c = fitCam({ x: T.x - 30, y: T.y - 30, w: T.w + 60, h: T.h + 60 }, { t: 60, r: 40, b: 60, l: 40 }, 1, R);
    c.k = clamp(Math.min(c.k, 1.25), KMIN, KMAX); var cx = (R.l + R.r) / 2, cy = (R.t + R.b) / 2;
    flyTo({ x: T.x + T.w / 2 - (cx - FW / 2) / c.k, y: T.y + T.h / 2 - (cy - FH / 2) / c.k, k: Math.max(c.k, Math.min(1.0, 160 * U / T.w)) });
  }
  uiDcard(); renderDock(); dirty();
}
function closeDcard() { S.dec = null; uiDcard(); renderDock(); dirty(); }
function stepDecision(dir) {
  var list = dcOrder(); if (!list.length) return;
  var i = list.indexOf(DEC[S.dec]); i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
  openDecisionCard(list[i].id);
}
function uiDcard() {
  var el = $('#dcard'), d = S.dec ? DEC[S.dec] : null;
  if (!d || !d.open) { el.classList.remove('on'); el.innerHTML = ''; if (S.dec && (!d || !d.open)) S.dec = null; return; }
  var f = F[d.f], A = AG[d.by], list = dcOrder(), pos = list.indexOf(d) + 1, wa = AGS.filter(function (a) { return a.wait === d.id; });
  el.className = 'on u-' + d.urg;
  el.innerHTML = '<div class="k"><span>RFI · ' + esc(d.base) + ' · ' + (d.urg === 'high' ? 'urgent' : d.urg === 'medium' ? 'soon' : 'when you can') + ' · sheet ' + SHEET[d.lens].no + '</span><button class="x" data-act="dclose" aria-label="Close">Esc</button></div>' +
    '<h3>' + esc(d.q) + '</h3><div class="by"><b>' + esc(A ? A.base : d.by) + '</b> (' + esc(A ? crewName(A.sq) : '') + ') stopped at <b>' + esc(f.name) + '</b> and asks <b>' + esc(pname(d.decider)) + '</b>.</div>' +
    '<div class="meta"><span>waiting ' + fmtWait(dWaitMin(d)) + '</span><span>holds ' + blocksNow(d) + ' agent' + (blocksNow(d) === 1 ? '' : 's') + '</span><span>touches ' + d.affects.length + '</span></div>' +
    d.opts.map(function (o, i) { return '<button class="op' + (i === d.rec ? ' rec' : '') + '" data-decide="' + d.id + '" data-opt="' + i + '"><i class="no">' + (i + 1) + '</i><b>' + esc(o.label) + (i === d.rec ? '<em>agent suggests</em>' : '') + '</b><span>' + esc(o.consequence) + '</span></button>'; }).join('') +
    '<div class="fx">' + (wa.length ? 'Answering frees ' + wa.map(function (a) { return esc(a.base); }).join(', ') + '. ' : 'Nobody is blocked on it. ') + 'The amber outlines on the plan are the ' + d.affects.length + ' feature' + (d.affects.length > 1 ? 's' : '') + ' it touches.</div>' +
    '<div class="nav"><button data-act="dprev" aria-label="Previous question">‹ K</button><span>' + (pos || '–') + ' of ' + list.length + '</span><button data-act="dnext" aria-label="Next question">J ›</button></div>';
  placeDcard();
}
function placeDcard() {
  var el = $('#dcard'), d = S.dec ? DEC[S.dec] : null; if (!d || !el.classList.contains('on')) return;
  var r = featRect(d.f, lodTiles()); if (!r) return;
  var u = U, w = 372 * u, h = (el.offsetHeight || 380) * u, x = r.x + r.w + 16 * u, y = r.y + r.h / 2 - h / 2;
  if (x + w > SAFE.r) x = r.x - w - 16 * u;
  if (x < SAFE.l) x = clamp(SAFE.r - w - 8 * u, SAFE.l, SAFE.r);
  y = clamp(y, SAFE.t, Math.max(SAFE.t, SAFE.b - h));
  el.style.left = (x / u) + 'px'; el.style.top = (y / u) + 'px';
}

/* ================================================================== morning watch */
function morningStats() {
  var since = '2026-10-07T18:00:00Z', ev = K0.activity.filter(function (a) { return a.at >= since; }), by = {}, feats = {};
  ev.forEach(function (a) { by[a.type] = (by[a.type] || 0) + 1; if (a.feature) feats[a.feature + (SCALE > 1 ? '' : '')] = (feats[a.feature] || 0) + 1; });
  var asked = HAS_SW ? DECS.filter(function (d) { return d.open && d.since >= Date.parse(since); }).length : 0;
  return { changes: ev.length, asked: asked, ev: ev, by: by, feats: feats, spend: HAS_SW ? Math.round(AGS.reduce(function (s, a) { return s + a.cost; }, 0)) : 0, done: HAS_SW ? AGS.reduce(function (s, a) { return s + a.done; }, 0) : 0 };
}
function renderMorning() {
  var el = $('#morning'), ms = morningStats(), q = queueFor(), mine = S.who ? q.mine : q.all.slice(0, 6), who = S.who ? pname(S.who).split(' ')[0] : null;
  var failed = AGS.filter(function (a) { return a.status === 'failed'; }), blocked = AGS.filter(function (a) { return a.status === 'blocked'; }).length;
  var by = Object.keys(ms.by).map(function (k) { return ms.by[k] + ' ' + ({ commit: 'commits', 'pr-opened': 'pull requests', deploy: 'deploy', flag: 'flag change', stage: 'stage moves', review: 'reviews', incident: 'incidents', comment: 'comments' }[k] || k); }).join(' · ');
  el.innerHTML = '<div class="kk">While you were away · since 18:00 · simulated sample</div><h2>' + (who ? 'Good morning, ' + esc(who) + '.' : 'Good morning.') + '</h2>' +
    '<div class="lead">The swarm shipped ' + ms.changes + ' changes overnight (' + esc(by) + '). ' + (failed.length ? failed.length + ' agent stopped after repeated failures. ' : '') + blocked + ' are blocked. <b style="color:#fff">' + (who ? mine.length + ' question' + (mine.length === 1 ? '' : 's') + ' wait for you' : q.all.length + ' questions wait for a person') + '.</b></div>' +
    '<div class="big4"><div><b>' + ms.changes + '</b>changes since 18:00</div><div class="am"><b>' + ms.asked + '</b>questions asked while you slept</div><div class="am"><b>' + (who ? mine.length : q.all.filter(function (d) { return d.urg === 'high'; }).length) + '</b>' + (who ? 'waiting for you' : 'urgent now') + '</div><div><b>$' + ms.spend.toLocaleString('en-US') + '</b>spent today, cap $2,400</div></div>' +
    '<div class="cols"><div><h4>What moved</h4><ul>' + ms.ev.slice(0, 7).map(function (a) { return '<li><button data-flyf="' + a.feature + '"><i>' + a.at.slice(11, 16) + '</i><span>' + esc(a.text) + '</span></button></li>'; }).join('') + '</ul></div>' +
    '<div><h4>' + (who ? 'Waiting for you' : 'Most urgent') + '</h4><ul>' + mine.slice(0, 6).map(function (d) { return '<li><button data-dec="' + d.id + '" data-closemorning="1"><i>' + d.base + '</i><span>' + esc(d.q) + '</span></button></li>'; }).join('') + (mine.length ? '' : '<li style="color:var(--ink2);padding:6px 0">Nothing is waiting. The swarm is working.</li>') + '</ul></div></div>' +
    '<div class="act"><button class="bt" data-act="morning-show">Show the changes on the plan</button><button class="bt" data-act="morning-close">Close</button><button class="bt go" data-act="morning-go">' + (mine.length ? 'Go through the questions ▸' : 'Watch the swarm ▸') + '</button></div>';
}
function renderMorningIf() { if ($('#morning').classList.contains('on')) renderMorning(); }
function toggleMorning(on) {
  var el = $('#morning'); if (on == null) on = !el.classList.contains('on');
  if (on) { renderMorning(); el.classList.add('on'); el.setAttribute('aria-hidden', 'false'); SIM._wasPlaying = SIM.playing; }
  else { el.classList.remove('on'); el.setAttribute('aria-hidden', 'true'); }
}

/* ================================================================== time: the history strip and the simulated hour */
var RD0 = '2026-04-09', RD1 = '2026-11-05';
function TL() {
  var svg = $('#revsvg'), W = svg.clientWidth || 640, H = svg.clientHeight || 92, L = 76, R = W - 6, avail = R - L;
  var hist = Math.round(avail * 0.46), hourW = Math.round(avail * 0.38), g1 = 26;
  return { W: W, H: H, L: L, h0: L, h1: L + hist, o0: L + hist + g1, o1: L + hist + g1 + hourW, fut: L + hist + g1 + hourW + 18, R: R, top: H < 80 ? 21 : 34, bot: H < 80 ? H - 28 : Math.min(H - 28, 66) };
}
var tl = null, COMPACT = false;
function hx(d) { return tl.h0 + (dnum(d) - dnum(RD0)) / (dnum(AS_OF) - dnum(RD0)) * (tl.h1 - tl.h0); }
function ox(t) { return tl.o0 + clamp(t, 0, HOUR) / HOUR * (tl.o1 - tl.o0); }
function renderRevs() {
  var svg = $('#revsvg'); tl = TL();
  var o = '', top = tl.top, bot = tl.bot, hxn = hx(S.t), now = S.t === AS_OF;
  var max = Math.max.apply(null, K.snapshots.map(function (s) { return s.total; })) * 1.05;
  var order = ['live', 'flagged', 'in-review', 'in-dev', 'specified', 'idea', 'deprecated'];
  var fills = { live: 'rgba(223,240,255,.62)', flagged: 'rgba(223,240,255,.44)', 'in-review': 'rgba(223,240,255,.3)', 'in-dev': 'rgba(223,240,255,.2)', specified: 'rgba(223,240,255,.11)', idea: 'rgba(223,240,255,.06)', deprecated: 'rgba(255,106,88,.5)' };
  o += '<text class="lbl" x="2" y="' + (top + 2) + '">REVISIONS</text><text x="2" y="' + (top + 18) + '">27 weeks</text>' + (COMPACT ? '' : '<text x="2" y="' + (top + 33) + '">[ ] step</text>');
  var cum = K.snapshots.map(function () { return 0; });
  order.forEach(function (st) {
    var up = [], dn = [];
    K.snapshots.forEach(function (s, i) { var x = hx(s.week), y0 = bot - cum[i] / max * (bot - top); cum[i] += s.counts[st] || 0; var y1 = bot - cum[i] / max * (bot - top); dn.push(x.toFixed(1) + ',' + y0.toFixed(1)); up.push(x.toFixed(1) + ',' + y1.toFixed(1)); });
    o += '<polygon points="' + up.join(' ') + ' ' + dn.reverse().join(' ') + '" fill="' + fills[st] + '"/>';
  });
  o += '<line class="ax" x1="' + tl.h0 + '" y1="' + bot + '" x2="' + tl.h1 + '" y2="' + bot + '"/>';
  K.snapshots.forEach(function (s, i) {
    var x = hx(s.week);
    o += '<line class="ax" x1="' + x + '" y1="' + bot + '" x2="' + x + '" y2="' + (bot + 4) + '" opacity=".6"/>';
    if (((i % 5 === 0 && i < 25) || i === 26) && Math.abs(x - hxn) > 60 && x < tl.h1 - 40) o += '<text x="' + x + '" y="' + (bot + 17) + '" text-anchor="middle">' + fmtD(s.week) + '</text>';
    o += '<rect class="wk" data-w="' + s.week + '" x="' + (x - 7) + '" y="' + (top - 8) + '" width="14" height="' + (bot - top + 30) + '" fill="transparent"/>';
  });
  var m1 = K.milestones[0]; if (m1) { var x1 = hx(m1.date); o += '<g class="ms"><line x1="' + x1 + '" y1="' + (top - 16) + '" x2="' + x1 + '" y2="' + bot + '" stroke="#dff0ff" stroke-width="1.2"/><path d="M' + x1 + ' ' + (top - 16) + ' h10 l-3 4 l3 4 h-10z" fill="#dff0ff"/><text x="' + (x1 + 13) + '" y="' + (top - 9) + '" style="fill:#dff0ff">M1 BETA · DONE</text></g>'; }
  /* the hour */
  if (HAS_SW) {
    o += '<rect x="' + tl.o0 + '" y="' + (top - 6) + '" width="' + (tl.o1 - tl.o0) + '" height="' + (bot - top + 6) + '" fill="rgba(111,242,200,.05)" stroke="rgba(111,242,200,.35)" stroke-dasharray="3 3"/>';
    o += '<text class="lbl" x="' + tl.o0 + '" y="' + (top - 12) + '" style="fill:#6ff2c8">THE NEXT HOUR · SIMULATED</text>';
    var bins = []; for (var b = 0; b < 60; b++) bins.push(0); var base0 = EVS.filter(function (e) { return e.b == null || true; });
    SW0.replay.forEach(function (e) { bins[Math.min(59, Math.floor(e.t / 60))]++; });
    var bw = (tl.o1 - tl.o0) / 60; bins.forEach(function (c, i) { if (c) o += '<rect x="' + (tl.o0 + i * bw + 0.5) + '" y="' + (bot - Math.min(22, c * 3)) + '" width="' + Math.max(1, bw - 1) + '" height="' + Math.min(22, c * 3) + '" fill="rgba(111,242,200,.5)"/>'; });
    o += '<line class="ax" x1="' + tl.o0 + '" y1="' + bot + '" x2="' + tl.o1 + '" y2="' + bot + '"/>';
    for (var m = 0; m <= 60; m += 15) { var xx = tl.o0 + m / 60 * (tl.o1 - tl.o0); o += '<line class="ax" x1="' + xx + '" y1="' + bot + '" x2="' + xx + '" y2="' + (bot + 4) + '"/>' + (m === 0 && now ? '' : '<text x="' + xx + '" y="' + (bot + 17) + '" text-anchor="' + (m === 0 ? 'start' : m === 60 ? 'end' : 'middle') + '">' + (m === 60 ? '10:00' : '09:' + (m < 10 ? '0' : '') + m) + '</text>'); }
    SW0.decisions.forEach(function (d) { if (d.arrivesAt) { var xa = ox(d.arrivesAt); o += '<path d="M' + xa + ' ' + (bot) + ' v-14" stroke="#ffc35a" stroke-width="1.6"/><path d="M' + xa + ' ' + (bot - 14) + ' l8 3 l-8 3z" fill="#ffc35a"><title>A new question arrives: ' + d.id + '</title></path>'; } });
    o += '<g id="hourhead"><rect id="hh-el" x="' + tl.o0 + '" y="' + (top - 6) + '" width="0" height="' + (bot - top + 6) + '" fill="rgba(111,242,200,.14)"/><line id="hh-l" x1="' + tl.o0 + '" x2="' + tl.o0 + '" y1="' + (top - 10) + '" y2="' + (bot + 3) + '" stroke="#6ff2c8" stroke-width="2"/><path id="hh-t" d="M' + tl.o0 + ' ' + (bot + 3) + ' l-5 7 h10z" fill="#6ff2c8"/></g>';
  }
  /* now + the future */
  o += '<line x1="' + tl.o1 + '" y1="' + bot + '" x2="' + tl.R + '" y2="' + bot + '" stroke="rgba(223,240,255,.4)" stroke-dasharray="2 4"/>';
  var m2 = MS.M2; if (m2) { var xm = tl.R - 14; o += '<g class="ms"><line x1="' + xm + '" y1="' + (top - 14) + '" x2="' + xm + '" y2="' + bot + '" stroke="#ffc35a" stroke-width="1.2" stroke-dasharray="4 3"/><path d="M' + xm + ' ' + (top - 14) + ' h-10 l3 4 l-3 4 h10z" fill="#ffc35a"/><text x="' + (xm - 13) + '" y="' + (top - 7) + '" text-anchor="end" style="fill:#ffc35a">M2 · ' + fmtD(m2.date) + '</text></g>' + (COMPACT ? '' : '<text x="' + (xm - 4) + '" y="' + (bot - 20) + '" text-anchor="end" style="fill:#ffc35a">14 days</text><text x="' + (xm - 4) + '" y="' + (bot - 5) + '" text-anchor="end">M3, M4 ▸</text>'); }
  /* history handle */
  var hl = Math.min(hxn, tl.h1), lab = now ? 'NOW · REV 27' : 'REV ' + revAt(S.t) + ' · ' + fmtD(S.t), pw = 108, px0 = clamp(hl - pw / 2, tl.h0 - 6, tl.h1 - pw + 12);
  o += '<g class="handle"><line x1="' + hl + '" y1="' + (top - 16) + '" x2="' + hl + '" y2="' + (bot + 2) + '"/><rect x="' + px0 + '" y="' + (bot + 8) + '" width="' + pw + '" height="20" rx="2"/><text x="' + (px0 + pw / 2) + '" y="' + (bot + 22.5) + '" text-anchor="middle">' + lab + '</text><path d="M' + (hl - 5) + ' ' + (bot + 8) + ' l5 -6 l5 6z" fill="#ffc35a"/></g>';
  svg.innerHTML = o; svg.setAttribute('aria-valuenow', revAt(S.t)); svg.setAttribute('aria-valuetext', 'Revision ' + revAt(S.t) + ', ' + S.t);
  uiClock(true);
}
var ckBuilt = false, ckSig = '';
function uiClock(force) {
  var c = $('#clock'); if (!c) return;
  if (!HAS_SW) { c.style.display = 'none'; return; }
  if (!ckBuilt || force === true && !c.firstChild) {
    c.innerHTML = '<div class="t"><span>Sim hour</span><span id="ck-s"></span></div><div class="hm"><span id="ck-t">09:00:00</span><small>UTC</small></div><div class="ctl"><button class="pp" data-act="play" aria-label="Play or pause the swarm (Space)" id="ck-pp">❚❚</button>' + [1, 8, 60, 240].map(function (s) { return '<button data-speed="' + s + '" aria-pressed="false" title="Run at ' + s + '× speed">' + s + '×</button>'; }).join('') + '<button data-act="restart" title="Replay the hour from the start" aria-label="Replay the hour">↺</button></div>';
    ckBuilt = true; ckSig = '';
  }
  var tt = new Date(AT0 + SIM.t * 1000).toISOString().slice(11, 19), hist = S.t !== AS_OF, sig = tt + '|' + SIM.playing + '|' + SIM.speed + '|' + hist + '|' + SIM.over;
  if (sig !== ckSig) {
    ckSig = sig; $('#ck-t').textContent = tt; $('#ck-s').textContent = hist ? 'HISTORY · PAUSED' : SIM.over ? 'ENDED' : SIM.playing ? '● LIVE · ×' + SIM.speed : 'PAUSED'; $('#ck-s').style.color = hist ? '#ffc35a' : SIM.playing && !SIM.over ? MINT : '#dff0ff';
    $('#ck-pp').textContent = SIM.playing ? '❚❚' : '▶';
    Array.prototype.forEach.call(c.querySelectorAll('[data-speed]'), function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-speed') === SIM.speed)); });
  }
  if (tl && $('#hh-l')) { var x = ox(SIM.t); $('#hh-l').setAttribute('x1', x); $('#hh-l').setAttribute('x2', x); $('#hh-t').setAttribute('d', 'M' + x + ' ' + (tl.bot + 3) + ' l-5 7 h10z'); $('#hh-el').setAttribute('width', Math.max(0, x - tl.o0)); }
}
function setT(d) {
  if (d > AS_OF) d = AS_OF; if (d < WEEKS[0]) d = WEEKS[0];
  if (d === S.t) return;
  S.t = d; renderRevs(); renderDock(); lastPlace = ''; dirty(); writeHashSoon();
}
function stepWeek(dir) { var i = WEEKS.indexOf(S.t); if (i < 0) i = revAt(S.t) - 1; i = clamp(i + dir, 0, 26); setT(WEEKS[i]); }
var revsvg = $('#revsvg'), rdrag = null;
function revPoint(e) { var r = revsvg.getBoundingClientRect(); return (e.clientX - r.left) / r.width * tl.W; }
function revApply(x) {
  if (HAS_SW && x >= tl.o0 - 10 && x <= tl.o1 + 6 && rdrag !== 'h') { rdrag = 'o'; var t = (x - tl.o0) / (tl.o1 - tl.o0) * HOUR; if (S.t !== AS_OF) S.t = AS_OF, renderRevs(), renderDock(); simSeek(t); return; }
  if (rdrag === 'o') return;
  rdrag = 'h'; var best = WEEKS[0], bd = 1e9; WEEKS.forEach(function (w) { var dd = Math.abs(hx(w) - x); if (dd < bd) { bd = dd; best = w; } });
  if (x > tl.h1 + 2 && x < tl.o0) best = AS_OF;
  setT(best);
}
revsvg.addEventListener('pointerdown', function (e) { rdrag = null; try { revsvg.setPointerCapture(e.pointerId); } catch (err) {} revApply(revPoint(e)); });
revsvg.addEventListener('pointermove', function (e) { if (rdrag) revApply(revPoint(e)); });
revsvg.addEventListener('pointerup', function () { rdrag = null; });
revsvg.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); stepWeek(-1); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); stepWeek(1); }
  else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); setT(WEEKS[0]); }
  else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); setT(AS_OF); }
});
function setSpeed(n) { SIM.speed = n; if (!SIM.over) SIM.playing = true; uiClock(true); dirty(); }
function togglePlay() { if (S.t !== AS_OF) { setT(AS_OF); return; } if (SIM.over) { resetSwarm(); return; } SIM.playing = !SIM.playing; uiClock(true); dirty(); }

/* ================================================================== key plan */
var kp = $('#kp'), kctx = kp.getContext('2d'), KPW = 162, KPH = 72;
function kpScale() { var s = Math.min((KPW - 12) / WORLD.w, (KPH - 10) / WORLD.h); return { s: s, ox: (KPW - WORLD.w * s) / 2 - WORLD.x * s, oy: (KPH - WORLD.h * s) / 2 - WORLD.y * s }; }
function drawKeyplan() {
  if (phone) return;
  var r = RES; if (kp.width !== Math.round(KPW * r)) { kp.width = Math.round(KPW * r); kp.height = Math.round(KPH * r); }
  var m = kpScale();
  kctx.setTransform(r, 0, 0, r, 0, 0); kctx.clearRect(0, 0, KPW, KPH);
  ROOMS.forEach(function (R) {
    var c = counts(R.feats), share = (c.live + c.flagged) / Math.max(1, c.n);
    kctx.fillStyle = 'rgba(223,240,255,' + (0.06 + share * 0.3).toFixed(2) + ')';
    kctx.fillRect(R.x * m.s + m.ox, R.y * m.s + m.oy, R.w * m.s, R.h * m.s);
    if (c.bad) { kctx.fillStyle = 'rgba(255,106,88,' + Math.min(0.85, 0.35 + c.bad * 0.15) + ')'; kctx.fillRect(R.x * m.s + m.ox + R.w * m.s - 4, R.y * m.s + m.oy + 1, 3, 3); }
    kctx.strokeStyle = 'rgba(223,240,255,.55)'; kctx.lineWidth = 0.6; kctx.strokeRect(R.x * m.s + m.ox, R.y * m.s + m.oy, R.w * m.s, R.h * m.s);
  });
  kctx.strokeStyle = '#dff0ff'; kctx.lineWidth = 1.2; BLDS.forEach(function (B) { kctx.strokeRect(B.x * m.s + m.ox, B.y * m.s + m.oy, B.w * m.s, B.h * m.s); });
  if (HAS_SW && S.t === AS_OF) {
    AGS.forEach(function (a) { var T = TILE[a.f]; if (!T) return; kctx.fillStyle = a.status === 'working' && !a.paused ? MINT : a.status === 'waiting' ? AMB : RED; kctx.fillRect((T.x + T.w / 2) * m.s + m.ox - 1, (T.y + T.h / 2) * m.s + m.oy - 1, 2.4, 2.4); });
    kctx.fillStyle = AMB; DECS.forEach(function (d) { if (!d.open || !TILE[d.f]) return; var T = TILE[d.f]; kctx.beginPath(); kctx.moveTo((T.x + T.w) * m.s + m.ox, T.y * m.s + m.oy - 4); kctx.lineTo((T.x + T.w) * m.s + m.ox + 4, T.y * m.s + m.oy - 2); kctx.lineTo((T.x + T.w) * m.s + m.ox, T.y * m.s + m.oy); kctx.fill(); });
  }
  var vx = wxs(SAFE.l) * m.s + m.ox, vy = wys(SAFE.t) * m.s + m.oy, vw = (SAFE.r - SAFE.l) / cam.k * m.s, vh = (SAFE.b - SAFE.t) / cam.k * m.s;
  kctx.fillStyle = 'rgba(255,195,90,.14)'; kctx.fillRect(vx, vy, vw, vh);
  kctx.strokeStyle = '#ffc35a'; kctx.lineWidth = 1.4; kctx.strokeRect(vx, vy, vw, vh);
  var z = '×' + (cam.k / HOME.k).toFixed(1); if ($('#kpz').textContent !== z) $('#kpz').textContent = z;
}
$('#keyplan').addEventListener('click', function (e) {
  var r = kp.getBoundingClientRect(), m = kpScale();
  var x = (e.clientX - r.left) / r.width * KPW, y = (e.clientY - r.top) / r.height * KPH;
  flyTo({ x: (x - m.ox) / m.s, y: (y - m.oy) / m.s, k: Math.max(cam.k, HOME.k * 2.2) });
});

/* ================================================================== the feature sheet: the swarm section */
function swarmSheetHTML(f) {
  if (!HAS_SW) return '';
  var ag = AGF[f.id] || [], ds = DOF[f.id] || [], ords = ordersOn(f.id), br = breachesOn(f.id), ev = SIM.log.filter(function (e) { return e.f === f.id; }).slice(0, 4);
  var o = '<div class="swm"><h4>The swarm on this feature · simulated</h4>';
  if (!ag.length && !ds.length && !ev.length) o += '<div style="color:var(--ink2);font-size:14px;padding:4px 0">No agent is working here right now.' + (f.stage === 'live' ? ' It is live and quiet.' : '') + '</div>';
  ag.forEach(function (a) {
    o += '<div class="arow"><span>' + ({ working: M_WORK, waiting: M_WAIT, blocked: M_BLOCK, failed: M_FAIL, paused: M_WAIT }[astat(a)] || '').replace('width="28" height="19"', 'width="18" height="13"') + '</span><span><b style="color:#fff;font-weight:500">' + esc(a.base) + '</b> <span style="color:var(--ink2)">· ' + esc(crewName(a.sq)) + ' · ' + esc(astat(a)) + '</span><br><span style="color:var(--ink2);font-size:13px">' + esc(a.task) + '</span></span><span class="pb"><i style="width:' + Math.round(a.pct) + '%"></i></span><span style="font:500 12px var(--mono);color:var(--ink2)">' + Math.round(a.pct) + '% · $' + a.cost.toFixed(0) + '</span></div>';
  });
  ds.forEach(function (d) {
    o += '<div class="dq"><b>' + esc(d.base) + ' · ' + esc(d.q) + '</b><div style="font-size:13px;color:var(--ink2);margin:2px 0 4px">' + esc(pname(d.decider)) + ' decides · waiting ' + fmtWait(dWaitMin(d)) + ' · holds ' + blocksNow(d) + ' agent' + (blocksNow(d) === 1 ? '' : 's') + '</div>' +
      d.opts.map(function (op, i) { return '<button class="op' + (i === d.rec ? ' rec' : '') + '" data-decide="' + d.id + '" data-opt="' + i + '"><i class="no">' + (i + 1) + '</i><b>' + esc(op.label) + (i === d.rec ? '<em>agent suggests</em>' : '') + '</b><span>' + esc(op.consequence) + '</span></button>'; }).join('') + '</div>';
  });
  if (ords.length) o += '<div style="margin-top:8px;font-size:14px">' + ords.map(function (x) { return '<span class="ag" style="margin:0 6px 0 0;color:' + (x.vf.indexOf(f.id) >= 0 ? '#ff9a8c' : '#ffc35a') + ';border-color:currentColor">' + x.id + (x.vf.indexOf(f.id) >= 0 ? ' BREACHED' : '') + '</span>' + esc(x.text); }).join('<br>') + '</div>';
  if (ev.length) o += '<div style="margin-top:8px;font-size:13px;color:var(--ink2)">' + ev.map(function (e) { return new Date(AT0 + e.t * 1000).toISOString().slice(11, 16) + ' · ' + esc(e.text); }).join('<br>') + '</div>';
  o += '<div class="btns"><button class="btn" data-act="sheet-pause" data-f="' + f.id + '">' + (ag.some(function (a) { return a.paused; }) ? 'Resume agents here' : 'Pause agents here') + '</button><button class="btn" data-act="sheet-push" data-f="' + f.id + '">Put the swarm on this…</button><button class="btn" data-act="sheet-order" data-f="' + f.id + '">Write an order here…</button></div></div>';
  return o;
}
function refreshSheet() { if (S.open) { var st = $('#dscroll').scrollTop; $('#dscroll').innerHTML = detailHTML(F[S.open]); $('#dscroll').scrollTop = st; } }
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
  o += swarmSheetHTML(f); o += '<div class="dgrid"><div>';
  o += '<div class="illo">' + illoSVG(D[f.domain].base, '#dff0ff') + '<span class="cap">DETAIL ' + T.idx + ' · ' + esc(D[f.domain].base) + ' · STYLISED</span></div>';
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
function setLens(k, quiet) {
  if (!SHEET[k] || k === S.lens) return;
  var v = $('#vellum');
  S.lens = k;
  document.documentElement.style.setProperty('--accent', SHEET[k].acc);
  renderTabs();
  var apply = function () { lastPlace = ''; dirty(); if (S.hover) hov.innerHTML = hoverHTML(S.hover); refreshSheet(); renderDock(); renderMorningIf(); uiDcard(); };
  if (reduced || quiet) apply(); else { v.classList.remove('go'); void v.offsetWidth; v.classList.add('go'); setTimeout(apply, 330); }
  writeHashSoon();
}
/* ================================================================== acts + global events */
function targetBox() {
  var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (var id in S.tgt.ids) { var T = TILE[id]; if (!T) continue; x0 = Math.min(x0, T.x); y0 = Math.min(y0, T.y); x1 = Math.max(x1, T.x + T.w); y1 = Math.max(y1, T.y + T.h); }
  return x1 < 0 ? null : { x: x0 - 40, y: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 };
}
function needTarget() { uiToast('Point at a place first: <b>shift-click</b> a wing, room or fixture, or <b>shift-drag</b> a box.', null); }
function handleAct(act, el) {
  switch (act) {
    case 'unblast': setMode({ blast: null }); break;
    case 'ungi': setMode({ ga: false }); break;
    case 'dclose': closeDcard(); break;
    case 'dprev': stepDecision(-1); break;
    case 'dnext': stepDecision(1); break;
    case 'morning': toggleMorning(true); break;
    case 'morning-close': toggleMorning(false); break;
    case 'morning-go': toggleMorning(false); { var l = dcOrder(); if (l.length) openDecisionCard(l[0].id); } break;
    case 'morning-show': { toggleMorning(false); var ids = {}; K0.activity.filter(function (a) { return a.at >= '2026-10-07T18:00:00Z' && a.feature; }).forEach(function (a) { for (var b = 0; b < SCALE; b++) ids[a.feature + (SCALE > 1 ? '-' + LINES[b][1] : '')] = 1; }); setTarget(ids, 'changed since 18:00'); var bx = targetBox(); if (bx) flyTo(fitCam(bx, { t: 40, r: 30, b: 60, l: 30 }, 1)); break; }
    case 'askall': S.askAll = !S.askAll; renderDock(); break;
    case 'pv-ga': S.dtab = 'swarm'; { var p = previewGA(); if (p) setPreview(p); else uiToast('Nothing to pull: no agent is on M3 or M4 work.', null); } break;
    case 'pv-res': { var p2 = previewResearch(); if (p2) setPreview(p2); else uiToast('The research crew is already paused.', null); } break;
    case 'pv-push': { if (!S.tgt.n) { needTarget(); break; } var p3 = previewPushHere(); if (p3) setPreview(p3); else uiToast('Nothing to move: no free working agent, or the selection is already live.', null); break; }
    case 'pv-pause': { if (!S.tgt.n) { needTarget(); break; } var p4 = previewPause(false); if (p4) setPreview(p4); else uiToast('No agent is working inside the selection.', null); break; }
    case 'pv-resume': { if (!S.tgt.n) { needTarget(); break; } var p5 = previewPause(true); if (p5) setPreview(p5); else uiToast('No paused agent inside the selection.', null); break; }
    case 'pv-commit': commitPreview(); break;
    case 'pv-cancel': S.prev = null; uiSteer(); uiSel(); dirty(); break;
    case 'undo': undoDecision(); $('#toast').classList.remove('on'); break;
    case 'undo2': undoCommand(); $('#toast').classList.remove('on'); break;
    case 'restart': resetSwarm(); $('#toast').classList.remove('on'); break;
    case 'play': togglePlay(); break;
    case 'sel-look': { var bx2 = targetBox(); if (bx2) flyTo(fitCam(bx2, { t: 40, r: 30, b: 60, l: 30 }, 1)); break; }
    case 'sel-info': selInfo(); break;
    case 'sel-ordmenu': S.ordMenu = true; uiSel(); break;
    case 'sel-order': { var po = previewOrder(el.getAttribute('data-tpl')); S.ordMenu = false; if (po) setPreview(po); break; }
    case 'sel-clear': clearTarget(); break;
    case 'info-close': renderCallout(); break;
    case 'sheet-pause': { var fid = el.getAttribute('data-f'), ids2 = {}; ids2[fid] = 1; S.tgt = { ids: ids2, n: 1, label: F[fid].name }; var ap = (AGF[fid] || []).some(function (a) { return a.paused; }); var pp = previewPause(ap); if (pp) { setPreview(pp); } else uiToast('No agent is working on this feature.', null); break; }
    case 'sheet-push': { var fid2 = el.getAttribute('data-f'), ids3 = {}; ids3[fid2] = 1; S.tgt = { ids: ids3, n: 1, label: F[fid2].name }; var pq = previewPushHere(); if (pq) setPreview(pq); else uiToast('Nothing to move onto this feature right now.', null); break; }
    case 'sheet-order': { var fid3 = el.getAttribute('data-f'), ids4 = {}; ids4[fid3] = 1; S.tgt = { ids: ids4, n: 1, label: F[fid3].name }; S.ordMenu = true; uiSel(); dirty(); break; }
    case 'dockhide': toggleDock(); break;
    case 'ga': setMode({ ga: !S.ga, blast: null }); break;
    case 'blast': toggleBlast(); break;
    case 'selmode': toggleSelMode(); break;
  }
}
function toggleSelMode() { S.selMode = !S.selMode; cv.className = S.selMode ? 'sel' : ''; renderLadder(); uiToast(S.selMode ? '<b>Target mode.</b> Click or drag to select places. Press S again to leave.' : 'Target mode off.', null); }
function toggleDock(on) {
  var d = $('#dock'); var hide = on == null ? !d.classList.contains('hide') : !on; d.classList.toggle('hide', hide);
  layoutChrome(); var atHome = Math.abs(cam.k / HOME.k - 1) < 0.02; computeHome(); if (atHome && !S.open) flyTo(HOME, 400); lastPlace = ''; dirty();
}
function layoutChrome() {
  var w = window.innerWidth, h = window.innerHeight, hide = $('#dock').classList.contains('hide');
  var bb = COMPACT ? 84 : 116; document.documentElement.style.setProperty('--bb', bb + 'px'); SAFE.l = 12 * U; SAFE.t = 74 * U; SAFE.b = h - (bb - 2) * U; SAFE.r = hide ? w - 12 * U : w - 352 * U;
  var r = document.documentElement.style; r.setProperty('--cx', ((SAFE.l + SAFE.r) / 2 / U) + 'px'); r.setProperty('--sw', Math.max(300, (SAFE.r - SAFE.l) / U - 20) + 'px');
  $('#dshow').classList.toggle('on', hide);
}
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t.closest) return;
  var dd = t.closest('[data-decide]');
  if (dd) { e.preventDefault(); var did = dd.getAttribute('data-decide'); decide(did, +dd.getAttribute('data-opt')); refreshSheet(); if (phone) renderPhone(); return; }
  var ac = t.closest('[data-act]'); if (ac) { e.preventDefault(); handleAct(ac.getAttribute('data-act'), ac); return; }
  var dl = t.closest('[data-delta]'); if (dl) { S.delta = +dl.getAttribute('data-delta'); syncTools(); lastPlace = ''; renderDock(); dirty(); writeHashSoon(); return; }
  var sp = t.closest('[data-speed]'); if (sp) { setSpeed(+sp.getAttribute('data-speed')); return; }
  var ff = t.closest('[data-flyf]'); if (ff) { e.preventDefault(); toggleMorning(false); var fid = ff.getAttribute('data-flyf'); if (F[fid]) { if (S.open) closeFeature(); flyToFeature(fid); S.hl = fid; setTimeout(function () { if (S.hl === fid) { S.hl = null; dirty(); } }, 2600); dirty(); } return; }
  var ds = t.closest('[data-dec]'); if (ds && !t.closest('#dcard')) { e.preventDefault(); if (ds.getAttribute('data-closemorning')) toggleMorning(false); openDecisionCard(ds.getAttribute('data-dec')); return; }
  var op = t.closest('[data-open]');
  if (op && !op.closest('#map')) { e.preventDefault(); var id = op.getAttribute('data-open'); if (phone) { openPhone(id); return; } closeResults(); q.value = ''; if (op.closest('#callout') && S.blast) { S.blast = null; renderCallout(); } openFeature(id); return; }
  var cr = t.closest('[data-crumb]');
  if (cr) { var k = cr.getAttribute('data-crumb'); if (k === 'home') { if (S.open) closeFeature(); goHome(); } else if (k === 'lvl') { if (S.open) { S.open = null; $('#detail').classList.remove('open'); camBefore = null; } var d = +cr.getAttribute('data-depth'); flyTo(fitOf(PLACE[d - 1] || PLACE[PLACE.length - 1])); } return; }
  var l = t.closest('[data-lens]'); if (l) { setLens(l.getAttribute('data-lens')); return; }
  var z = t.closest('[data-zoom]'); if (z) { zoomAt((SAFE.l + SAFE.r) / 2, (SAFE.t + SAFE.b) / 2, +z.getAttribute('data-zoom') > 0 ? 1.6 : 1 / 1.6); return; }
  var lv = t.closest('[data-level]'); if (lv) { var n = +lv.getAttribute('data-level'); if (n === levelNames().length - 1) { var T = nearestTile(); if (T) openFeature(T.id); } else { if (S.open) closeFeature(); goLevel(n); } return; }
  var dt = t.closest('[data-dtab]'); if (dt) { S.dtab = dt.getAttribute('data-dtab'); renderDock(); return; }
  var wh = t.closest('[data-who]'); if (wh) { setWho(wh.getAttribute('data-who')); return; }
  if (t.closest('#who')) { toggleWho(); return; }
  var cw = t.closest('[data-crew]'); if (cw) { var cid = cw.getAttribute('data-crew'); S.crew = S.crew === cid ? null : cid; renderDock(); return; }
  var ag = t.closest('[data-agent]'); if (ag) { var A = AG[ag.getAttribute('data-agent')]; if (A) flyToFeature(A.f); return; }
  var od = t.closest('[data-ord]'); if (od) { var oid = od.getAttribute('data-ord'); S.ordHi = S.ordHi === oid ? null : oid; renderDock(); dirty(); return; }
  var kn = t.closest('.kn li'); if (kn) { var key = kn.getAttribute('data-key'); S.key = S.key === key ? null : key; renderDock(); dirty(); return; }
  if (t.closest('#dhide')) { toggleDock(false); return; }
  if (t.closest('#dshow')) { toggleDock(true); return; }
  if (!t.closest('#searchbox')) closeResults();
  if (!t.closest('#whoRow') && !t.closest('#whoMenu')) toggleWho(false);
  if (!t.closest('#morning') && $('#morning').classList.contains('on')) toggleMorning(false);
}, false);
function nearestTile() { var best = null, bd = 1e18; TILES.forEach(function (T) { var d = Math.hypot(T.x + T.w / 2 - cam.x, T.y + T.h / 2 - cam.y); if (d < bd) { bd = d; best = T; } }); return best; }
document.addEventListener('pointerover', function (e) {
  var kn = e.target.closest && e.target.closest('.kn li');
  if (kn && !S.ga && !S.key) { S.key = kn.getAttribute('data-key'); S._kh = true; dirty(); return; }
  var hv = e.target.closest && e.target.closest('[data-hov]');
  if (hv) { S.hl = hv.getAttribute('data-hov'); dirty(); }
  var od = e.target.closest && e.target.closest('[data-ord]'); if (od && S.ordHi !== od.getAttribute('data-ord')) { S.ordHi = od.getAttribute('data-ord'); S._oh = true; dirty(); }
  var qi = e.target.closest && e.target.closest('.qi'); if (qi && !S.dec) { var dq = DEC[qi.getAttribute('data-dec')]; if (dq) { S._dh = dq.id; S.hlDec = dq.id; dirty(); } }
});
document.addEventListener('pointerout', function (e) {
  var kn = e.target.closest && e.target.closest('.kn li');
  if (kn && S._kh && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.kn li'))) { S.key = null; S._kh = false; dirty(); }
  var hv = e.target.closest && e.target.closest('[data-hov]');
  if (hv && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-hov]'))) { S.hl = null; dirty(); }
  var od = e.target.closest && e.target.closest('[data-ord]'); if (od && S._oh && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-ord]'))) { S.ordHi = null; S._oh = false; dirty(); }
  var qi = e.target.closest && e.target.closest('.qi'); if (qi && S.hlDec && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.qi'))) { S.hlDec = null; dirty(); }
});
$('#skip').addEventListener('click', function () { endIntro(); });
$('#dclose').addEventListener('click', closeFeature);
$('#dblast').addEventListener('click', toggleBlast);
var SPEEDS = [1, 8, 60, 240];
document.addEventListener('keydown', function (e) {
  if (introOn) { endIntro(); if (e.key !== '/' && e.key !== 'Escape') return; }
  if (phone) { if (e.key === 'Escape') closePhone(); return; }
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('#whoMenu')) {
    var items = Array.prototype.slice.call($('#whoMenu').querySelectorAll('li')), ci = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(ci + 1) % items.length].focus(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(ci - 1 + items.length) % items.length].focus(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWho(document.activeElement.getAttribute('data-who')); return; }
    if (e.key === 'Escape') { e.preventDefault(); toggleWho(false); $('#who').focus(); return; }
    return;
  }
  var kn2 = e.target.closest && e.target.closest('.kn li, .ord, .qi');
  if (kn2 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); kn2.click(); return; }
  if (e.key === '/') { e.preventDefault(); q.focus(); q.select(); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    if ($('#morning').classList.contains('on')) { toggleMorning(false); return; }
    if ($('#whoMenu').classList.contains('on')) { toggleWho(false); return; }
    if ($('#callout').style.display === 'block' && !S.blast && !S.ga) { renderCallout(); return; }
    goUp(); return;
  }
  if ($('#morning').classList.contains('on')) { if (e.key === 'Enter') { e.preventDefault(); handleAct('morning-go'); } return; }
  if (S.prev && e.key === 'Enter') { e.preventDefault(); commitPreview(); return; }
  if (S.dec && DEC[S.dec] && DEC[S.dec].open) {
    var dc = DEC[S.dec];
    if (/^[1-9]$/.test(e.key) && +e.key <= dc.opts.length) { e.preventDefault(); decide(dc.id, +e.key - 1); refreshSheet(); return; }
    if (e.key === 'Enter' && tag !== 'button') { e.preventDefault(); decide(dc.id, dc.rec); refreshSheet(); return; }
  }
  if (/^[1-7]$/.test(e.key)) { setLens(SHEETS[+e.key - 1].k); return; }
  if (e.key === 'j' || e.key === 'J') { stepDecision(1); return; }
  if (e.key === 'k' || e.key === 'K') { stepDecision(-1); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMorning(); return; }
  if (e.key === 'p' || e.key === 'P') { toggleWho(); return; }
  if (e.key === 's' || e.key === 'S') { toggleSelMode(); return; }
  if (e.key === '\\') { toggleDock(); return; }
  if (e.key === ' ' && tag !== 'button') { e.preventDefault(); togglePlay(); return; }
  if (e.key === ',') { var si = Math.max(0, SPEEDS.indexOf(SIM.speed) - 1); setSpeed(SPEEDS[si]); return; }
  if (e.key === '.') { var sj = Math.min(SPEEDS.length - 1, SPEEDS.indexOf(SIM.speed) + 1); setSpeed(SPEEDS[sj]); return; }
  if (S.open && tag !== 'canvas') { if (e.key === 'b' || e.key === 'B') toggleBlast(); return; }
  var cx = (SAFE.l + SAFE.r) / 2, cy = (SAFE.t + SAFE.b) / 2;
  if (e.key === 'ArrowRight') { e.preventDefault(); walk(1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); walk(-1); return; }
  if (e.key === '+' || e.key === '=') { zoomAt(cx, cy, 1.6); return; }
  if (e.key === '-' || e.key === '_') { zoomAt(cx, cy, 1 / 1.6); return; }
  if (e.key === '0' || e.key === 'Home') { goHome(); return; }
  if (e.key === 'Enter' && e.target === cv) { var T = nearestTile(); if (T && T.w * cam.k >= 96 * U && lodTiles() > 0.5) openFeature(T.id); else clickAt(cx, cy); return; }
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
  if (S.who) p.push('who=' + S.who);
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
  if (h.who && PERSON_LENS[h.who]) S.who = h.who;
  S.ga = h.ga === '1'; S.blast = h.blast && F[h.blast] ? h.blast : null; S.key = h.key && FLAGNO[h.key] != null ? h.key : null;
  renderTabs(); renderRevs(); renderCallout(); syncTools();
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
/* ================================================================== phone: the person's queue first, then the reading list */
function renderPhone() {
  var c = counts(K.features), q = queueFor(), list = S.who ? q.mine.concat(q.rest) : q.all;
  var o = LEGDEFS + '<div class="ph-h"><div class="k">PROJECT KETTLE · SHEET G-001 · ' + AS_OF + ' · SIMULATED SWARM</div><h1>KETTLE</h1><p>' + esc(K.product.tagline) + '</p></div>' +
    '<div class="ph-sum"><div><b>' + NF + '</b>features</div><div><b>' + c.live + '</b>built · live</div><div><b>' + c.build + '</b>being built</div><div class="am"><b>' + (HAS_SW ? q.all.length : 0) + '</b>questions waiting</div><div><b>' + (HAS_SW ? AGS.filter(function (a) { return a.status === 'working'; }).length : 0) + '</b>agents working</div><div class="tr"><b>' + K.features.filter(function (f) { return f.health === 'bad'; }).length + '</b>in trouble</div></div>';
  if (HAS_SW) {
    o += '<div class="ph-sec"><span>Whose desk</span></div><div class="ph-who"><button data-who="" aria-pressed="' + !S.who + '">Everyone</button>' + PERSONS.map(function (p) { return '<button data-who="' + p.id + '" aria-pressed="' + (S.who === p.id) + '">' + esc(p.name.split(' ')[0]) + ' · ' + openDecs().filter(function (d) { return d.decider === p.id; }).length + '</button>'; }).join('') + '</div>';
    o += '<div class="ph-sec"><span>' + (S.who ? 'Waiting for ' + esc(pname(S.who).split(' ')[0]) : 'Waiting for a person') + '</span><span>' + (S.who ? q.mine.length : q.all.length) + '</span></div>';
    (S.who ? q.mine : q.all).slice(0, 12).forEach(function (d) {
      o += '<div class="ph-q u-' + d.urg + '"><div class="k">' + esc(d.base) + ' · ' + d.urg + ' · ' + esc(pname(d.decider)) + '</div><h4>' + esc(d.q) + '</h4><div class="mt">' + esc(F[d.f].name) + ' · waiting ' + fmtWait(dWaitMin(d)) + ' · holds ' + blocksNow(d) + ' agent' + (blocksNow(d) === 1 ? '' : 's') + '</div>' +
        d.opts.map(function (op, i) { return '<button class="op' + (i === d.rec ? ' rec' : '') + '" data-decide="' + d.id + '" data-opt="' + i + '"><i class="no">' + (i + 1) + '</i><b>' + esc(op.label) + (i === d.rec ? '<em>suggested</em>' : '') + '</b><span>' + esc(op.consequence) + '</span></button>'; }).join('') + '</div>';
    });
    if (S.who && !q.mine.length) o += '<div class="qempty"><b>Nothing waits for you.</b>The swarm has what it needs.</div>';
  }
  o += '<div class="ph-sec"><span>Find a feature</span></div><input id="pq" type="search" placeholder="Find a feature…" aria-label="Search features">';
  BLDS.forEach(function (B) {
    if (SCALE > 1) o += '<div class="ph-wing" style="font-size:14px;color:#fff">' + esc(B.name) + '</div>';
    B.wings.forEach(function (W) {
      o += '<div class="ph-wing">Wing ' + W.def.letter + ' · ' + esc(W.def.name) + '</div>';
      W.rooms.forEach(function (R) {
        var a = aggLine(R.feats, false);
        o += '<details class="ph-dom"><summary>' + esc(R.d.name) + '<span>' + a.c.n + ' · ' + (a.c.live + a.c.flagged) + ' live' + (a.trouble ? ' · ' + a.trouble + ' trouble' : '') + '</span></summary>';
        R.bays.forEach(function (Bay) {
          o += '<h3>' + esc(Bay.cap.name) + '</h3>';
          Bay.tiles.forEach(function (T) { var f = T.f; o += '<button data-open="' + f.id + '" data-q="' + esc((f.id + ' ' + f.name + ' ' + f.summary).toLowerCase()) + '">' + sym(f.stage, 22, 14) + '<span>' + esc(f.name) + '</span><span style="color:' + (f.health === 'bad' ? '#ff6a58' : f.health === 'watch' ? '#ffc35a' : 'transparent') + '">●</span></button>'; });
        });
        o += '</details>';
      });
    });
  });
  o += '<div class="foot">Illustrative sample data · simulated swarm · open on a wider screen for the zoomable plan.</div>';
  var ph = $('#phone'), scrollY = window.scrollY; ph.innerHTML = o; window.scrollTo(0, scrollY);
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
  pd.innerHTML = '<button class="btn back">‹ Back</button>' + detailHTML(F[id]);
  pd.classList.add('open'); pd.scrollTop = 0;
  pd.querySelector('.back').addEventListener('click', closePhone);
}
function closePhone() { $('#pdetail').classList.remove('open'); }
/* ================================================================== fit to window, intro, boot */
function fit() {
  var w = window.innerWidth, h = window.innerHeight, wasPhone = phone;
  phone = w < 760;
  document.body.classList.toggle('phone', phone); document.documentElement.classList.toggle('phone', phone);
  if (phone) { if (!wasPhone || !$('#phone').innerHTML) renderPhone(); return; }
  U = 1 + 0.5 * (clamp(Math.min(w / 1280, h / 800), 1, 2) - 1);
  var ui = $('#ui'); ui.style.width = (w / U) + 'px'; ui.style.height = (h / U) + 'px'; ui.style.transform = U === 1 ? 'none' : 'scale(' + U + ')';
  FW = w; FH = h; COMPACT = h < 740; $('#ui').classList.toggle('compact', COMPACT); KPW = COMPACT ? 132 : 162; KPH = COMPACT ? 44 : 72; kp.style.width = KPW + 'px'; kp.style.height = KPH + 'px';
  var r = Math.min(window.devicePixelRatio || 1, 2); if (w * h * r * r > 6.5e6) r = Math.sqrt(6.5e6 / (w * h));
  if (Math.abs(r - RES) > 1e-3 || cv.width !== Math.round(FW * r)) { RES = r; cv.width = Math.round(FW * RES); cv.height = Math.round(FH * RES); cv.style.width = FW + 'px'; cv.style.height = FH + 'px'; makePatterns(); }
  var atHome = (Math.abs(cam.k / HOME.k - 1) < 0.03 && Math.hypot(cam.x - HOME.x, cam.y - HOME.y) * cam.k < 8) || !fit.done;
  layoutChrome(); computeHome(); TWC = {}; WRC = {};
  if (atHome && !S.open) cam = { x: HOME.x, y: HOME.y, k: HOME.k };
  fit.done = true;
  renderRevs(); renderCrumbs(); lastPlace = ''; dirty();
}
window.addEventListener('resize', function () { clearTimeout(fit.t); fit.t = setTimeout(fit, 60); });
function endIntro() { if (!introOn) return; introOn = false; introP = 1; document.body.classList.remove('intro'); dirty(); }
function startIntro(play) {
  if (!play || reduced) { document.body.classList.remove('intro'); return; }
  introOn = true; introT0 = performance.now(); introP = 0; dirty();
}
/* ================================================================== boot */
buildSwarm();
renderTabs(); renderDock(); renderLadder(); uiVitals(); syncTools();
fit();
var h0 = readHash();
applyHash(h0);
renderDock(); uiVitals(); uiSel();
startIntro(h0.intro !== '0' && QS.get('intro') !== '0' && !phone && !h0.open && !h0.at);
window.addEventListener('hashchange', function () { if (!hashLock) applyHash(readHash()); });
if (document.fonts && document.fonts.load) Promise.all(['500 15px "IBM Plex Sans Condensed"', '600 21px "IBM Plex Sans Condensed"', '400 15px "IBM Plex Sans Condensed"', '500 12px "IBM Plex Mono"', '600 12px "IBM Plex Mono"'].map(function (x) { return document.fonts.load(x); })).catch(function () {}).then(function () { TWC = {}; WRC = {}; lastPlace = ''; if (cv.width) { renderCrumbs(); renderRevs(); } dirty(); });
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { TWC = {}; WRC = {}; lastPlace = ''; if (cv.width) { renderCrumbs(); renderRevs(); } dirty(); });
window.__bp = { draw: draw, cam: function () { return cam; }, flyTo: flyTo, place: function () { return PLACE.map(function (c) { return c.t + ':' + c.o.id; }); }, fitOf: fitOf, ROOM: ROOM, BAY: BAY, WINGS: WINGS, HOME: HOME, open: openFeature, setLens: setLens, TILES: TILES, S: S, SIM: SIM, decide: decide, DEC: DEC, AGS: AGS, openDecisionCard: openDecisionCard, setWho: setWho, setTarget: setTarget, previewGA: previewGA, setPreview: setPreview, commitPreview: commitPreview, simSeek: simSeek, setSpeed: setSpeed, toggleMorning: toggleMorning, toggleDock: toggleDock, handleAct: handleAct, SAFE: SAFE, goHome: goHome, zoomAt: zoomAt, U: function () { return U; } };
})();
