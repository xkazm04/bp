#!/usr/bin/env node
// Generates prototypes/shared/v2/blueprint-data.js (window.BLUEPRINT, schema v0.2) from catalog.mjs.
//
//   node scripts/data-v2/generate.mjs && node scripts/data-v2/validate.mjs
//
// Deterministic: every random choice comes from mulberry32 streams seeded from SEED and a stream name,
// so changing one part of the generator does not reshuffle the rest. Ratings are computed with the real
// model (prototypes/shared/v2/blueprint-model.js) so each live feature lands in its target overall band.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as C from './catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_REL = 'prototypes/shared/v2/blueprint-data.js';
const MODEL_REL = 'prototypes/shared/v2/blueprint-model.js';
const ASOF = '2026-10-08';
const SEED = 20261008;

// ── PRNG streams ──────────────────────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function stream(name) {
  const next = mulberry32((SEED ^ fnv1a(name)) >>> 0);
  return {
    next,
    between: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    weighted(pairs) {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let x = next() * total;
      for (const [v, w] of pairs) {
        x -= w;
        if (x < 0) return v;
      }
      return pairs[pairs.length - 1][0];
    },
    gauss() {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    shuffle(list) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

const DAY = 86400000;
const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
const fromDay = (n) => new Date(Math.round(n) * DAY).toISOString().slice(0, 10);
const addDays = (s, n) => fromDay(toDay(s) + n);
const diffDays = (a, b) => toDay(b) - toDay(a);
const maxDate = (...d) => d.filter(Boolean).reduce((a, b) => (a > b ? a : b));
const minDate = (...d) => d.filter(Boolean).reduce((a, b) => (a < b ? a : b));
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const slug = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const money = (n) => '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const STOP = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'on', 'in', 'with', 'by', 'and', 'at', 'it', 'is', 'when', 'after', 'under', 'from']);
const shortSlug = (text, words = 3) => slug(text).split('-').filter((w) => !STOP.has(w)).slice(0, words).join('-');

/** Splits n into integer parts proportional to weights (largest remainder). */
function apportion(weights, n) {
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / total) * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]] += 1;
  return out;
}

/** Inverse of a monotonic piecewise-linear map given as [x, y] points (ascending x). */
function invPw(y, pts) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) return y1 === y0 ? x0 : x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  return Math.abs(y - first[1]) < Math.abs(y - last[1]) ? first[0] : last[0];
}

// ── The model, for ratings while generating ──────────────────────────────────────────────────

function loadModel() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.BLUEPRINT = {
    meta: { schemaVersion: '0.2', asOf: ASOF }, product: {}, areas: [], domains: [], modules: [], teams: [], people: [],
    releases: C.releases.map((r) => ({ id: r.id, label: 'v' + r.id, date: r.date, items: [] })), initiatives: [], features: [],
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, MODEL_REL), 'utf8'), sandbox, { filename: MODEL_REL });
  return sandbox.BP;
}
const BP = loadModel();

// ── Catalog → working features ───────────────────────────────────────────────────────────────

const SURF = { w: 'web', a: 'admin', m: 'mobile', p: 'api', k: 'worker', d: 'data' };
const SURF_ORDER = ['web', 'admin', 'mobile', 'api', 'worker', 'data'];
const UI = ['web', 'admin', 'mobile'];
const OPEN = ['triage', 'backlog', 'in-progress', 'review'];

const domainById = new Map(C.domains.map((d) => [d.id, d]));
const REL = C.releases;
const relIdx = new Map(REL.map((r, i) => [r.id, i]));
const SHIPPED = REL.filter((r) => r.date <= ASOF);
const LAST = SHIPPED.length - 1;
const NEXT = REL[LAST + 1];
const PATCHES = [['1.11.1', '2026-09-25'], ['1.11.2', '2026-09-30'], ['1.11.3', '2026-10-06']];

const F = [];
for (const m of C.modules) {
  const d = domainById.get(m.domainId);
  const n = m.features.length;
  m.features.forEach(([name, summary, codes], i) => {
    const surfaces = SURF_ORDER.filter((s) => [...codes].some((c) => SURF[c] === s));
    F.push({
      id: `${m.id}.${slug(name)}`, slug: slug(name), moduleId: m.id, domainId: d.id, areaId: d.areaId, name, summary, surfaces,
      pos: n > 1 ? i / (n - 1) : 0, mi: i, idx: F.length, mod: m, sinceIdx: m.since ? relIdx.get(m.since) : 0,
    });
  });
}
const byName = new Map(F.map((f) => [f.name, f]));
const hasUi = (f) => f.surfaces.some((s) => UI.includes(s));

// ── Statuses ──────────────────────────────────────────────────────────────────────────────────

// [live, ready, building, planned, blocked] per domain: Foundation and Commerce Core mature first,
// Mobile App and Community are roadmap-heavy.
const PROFILE = {
  storefront: [0.59, 0.07, 0.15, 0.15, 0.04], discovery: [0.52, 0.08, 0.18, 0.17, 0.05],
  community: [0.24, 0.1, 0.24, 0.36, 0.06], mobile: [0.2, 0.1, 0.26, 0.38, 0.06],
  checkout: [0.64, 0.08, 0.14, 0.1, 0.04], payments: [0.62, 0.09, 0.15, 0.1, 0.04],
  pricing: [0.59, 0.08, 0.15, 0.14, 0.04], billing: [0.57, 0.08, 0.16, 0.15, 0.04],
  orders: [0.57, 0.08, 0.16, 0.15, 0.04], inventory: [0.52, 0.08, 0.18, 0.18, 0.04],
  shipping: [0.53, 0.08, 0.17, 0.17, 0.05], care: [0.49, 0.08, 0.18, 0.2, 0.05],
  admin: [0.55, 0.08, 0.17, 0.16, 0.04], analytics: [0.47, 0.09, 0.19, 0.2, 0.05],
  integrations: [0.47, 0.08, 0.2, 0.2, 0.05], identity: [0.68, 0.07, 0.13, 0.09, 0.03],
  platform: [0.69, 0.06, 0.13, 0.09, 0.03],
};

const pins = new Map(); // feature → release id from release highlights
for (const r of REL) {
  for (const h of r.highlights) {
    const f = byName.get(h);
    if (!f) throw new Error(`release ${r.id}: highlight '${h}' is not a feature name`);
    pins.set(f, r.id);
  }
}
const pinStatuses = (rid) => (relIdx.get(rid) <= LAST ? ['live'] : rid === NEXT.id ? ['ready', 'building'] : ['planned', 'building']);

{
  const S = stream('status');
  for (const d of C.domains) {
    const list = F.filter((f) => f.domainId === d.id);
    const [nLive, nReady, nBuild, , nBlocked] = apportion(PROFILE[d.id], list.length);
    const keyed = list
      .map((f) => ({ f, k: f.pos + S.between(0, 0.5) + (f.sinceIdx > LAST ? 10 : 0) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.f);
    keyed.forEach((f, i) => { f.status = i < nLive ? 'live' : i < nLive + nReady ? 'ready' : 'rest'; });
    const rest = keyed.filter((f) => f.status === 'rest');
    const blocked = new Set(S.shuffle(rest).slice(0, nBlocked));
    let b = 0;
    rest.forEach((f) => {
      if (blocked.has(f)) f.status = 'blocked';
      else f.status = b++ < nBuild ? 'building' : 'planned';
    });
  }
  for (const [f, rid] of pins) {
    const allowed = pinStatuses(rid);
    if (allowed[0] === 'live' && f.sinceIdx > relIdx.get(rid)) throw new Error(`${f.name} is pinned to ${rid} before its module ships`);
    if (allowed.includes(f.status)) continue;
    const want = allowed[0];
    const cands = F.filter((g) => g.domainId === f.domainId && !pins.has(g) && g.status === want && (f.status !== 'live' || g.sinceIdx <= LAST))
      .sort((a, b) => Math.abs(a.pos - f.pos) - Math.abs(b.pos - f.pos) || a.idx - b.idx);
    if (!cands.length) throw new Error(`cannot pin ${f.name} to ${want}`);
    cands[0].status = f.status;
    f.status = want;
  }
}

// ── Builder, priority, owner ──────────────────────────────────────────────────────────────────

{
  const S = stream('meta');
  const W = { shopper: [0.56, 0.27, 0.17], commerce: [0.42, 0.34, 0.24], fulfillment: [0.52, 0.3, 0.18], merchant: [0.55, 0.28, 0.17], foundation: [0.42, 0.33, 0.25] };
  for (const f of F) {
    const w = W[f.areaId];
    f.builtBy = S.weighted([['agent', w[0]], ['pair', w[1]], ['human', w[2]]]);
    f.priority = S.weighted([['P0', f.status === 'live' ? 0.14 : 0.1], ['P1', 0.34], ['P2', 0.37], ['P3', 0.15]]);
    f.owner = f.mod.owner;
    f.note = S.chance(0.05) ? S.pick(C.featureNotes) : null;
  }
}

// ── Releases and dates ────────────────────────────────────────────────────────────────────────

const MATURITY = {
  identity: 0, platform: 0, checkout: 0.4, payments: 0.5, storefront: 0.7, orders: 1, pricing: 1.1, billing: 1.5, inventory: 1.5,
  shipping: 1.5, admin: 1.3, discovery: 2, care: 2.2, analytics: 2.4, integrations: 2.5, community: 3, mobile: 3,
};
{
  const S = stream('release');
  const live = F.filter((f) => f.status === 'live');
  const cap = apportion(SHIPPED.map((r, i) => (i === 0 ? 1.45 : 1)), live.length);
  const assign = (f, i) => { f.relIdx = i; cap[i] -= 1; };
  live.filter((f) => pins.has(f)).forEach((f) => assign(f, relIdx.get(pins.get(f))));
  live.filter((f) => f.relIdx == null && f.sinceIdx > 0).sort((a, b) => b.sinceIdx - a.sinceIdx || a.idx - b.idx).forEach((f) => {
    const options = [];
    for (let i = f.sinceIdx; i <= LAST; i++) if (cap[i] > 0) options.push(i);
    if (!options.length) assign(f, S.int(f.sinceIdx, LAST));
    else assign(f, options[Math.min(options.length - 1, Math.floor(S.next() * S.next() * Math.min(5, options.length)))]);
  });
  let i = 0;
  live.filter((f) => f.relIdx == null)
    .map((f) => ({ f, k: MATURITY[f.domainId] * 0.16 + f.pos * 0.55 + S.between(0, 0.6) }))
    .sort((a, b) => a.k - b.k)
    .forEach(({ f }) => {
      while (i < LAST && cap[i] <= 0) i++;
      assign(f, i);
    });
  for (const f of F) {
    if (f.status === 'live') f.release = SHIPPED[f.relIdx].id;
    else if (pins.has(f)) f.release = pins.get(f);
    else if (f.status === 'ready') f.release = NEXT.id;
    else if (f.status === 'building') f.release = S.chance(['community', 'mobile'].includes(f.domainId) ? 0.35 : 0.6) ? NEXT.id : '2.0';
    else if (f.status === 'blocked') f.release = S.chance(0.4) ? NEXT.id : '2.0';
    else f.release = S.weighted([['2.0', 0.4], ['2.1', 0.3], [null, 0.3]]);
    if (f.status === 'live') f.createdAt = addDays(SHIPPED[f.relIdx].date, -S.int(25, 95));
    else if (f.status === 'ready') f.createdAt = addDays(ASOF, -S.int(45, 130));
    else if (f.status === 'building') f.createdAt = addDays(ASOF, -S.int(16, 150));
    else if (f.status === 'blocked') f.createdAt = addDays(ASOF, -S.int(35, 170));
    else f.createdAt = addDays(ASOF, -S.int(2, 210));
  }
}

// ── Dependencies (acyclic: only on features earlier in a status-then-release order) ───────────

{
  const S = stream('deps');
  const GROUP = { live: 0, ready: 1, building: 2, blocked: 3, planned: 4 };
  const ordered = F.slice().sort((a, b) => GROUP[a.status] - GROUP[b.status] || (a.relIdx ?? 0) - (b.relIdx ?? 0) || a.idx - b.idx);
  ordered.forEach((f, p) => {
    f.dependsOn = [];
    if (p === 0) return;
    const count = S.weighted([[0, 0.58], [1, 0.29], [2, 0.11], [3, 0.02]]);
    const allowed = C.domainDependencies[f.domainId];
    const pool = ordered.slice(0, p)
      .map((g) => [g, (g.moduleId === f.moduleId ? 5 : g.domainId === f.domainId ? 2.5 : allowed.includes(g.domainId) && g.mi <= 1 ? 0.7 : 0) * (1.3 - g.pos)])
      .filter((x) => x[1] > 0);
    for (let k = 0; k < count && pool.length; k++) {
      const g = S.weighted(pool);
      f.dependsOn.push(g.id);
      pool.splice(pool.findIndex((x) => x[0] === g), 1);
    }
    f.dependsOn.sort((a, b) => F.findIndex((x) => x.id === a) - F.findIndex((x) => x.id === b));
  });
}
const byId = new Map(F.map((f) => [f.id, f]));

// ── Compliance regimes ────────────────────────────────────────────────────────────────────────

for (const f of F) {
  f.regimes = [];
  if (f.domainId === 'identity') f.regimes.push('GDPR');
  if (f.domainId === 'payments') f.regimes.push('PCI DSS');
  if (f.domainId === 'billing') f.regimes.push('SOC 2');
  if (f.surfaces.includes('web') || f.surfaces.includes('mobile')) f.regimes.push('EAA');
}

// ── Initiative scopes decided before metrics ──────────────────────────────────────────────────

const INI = { comp: 'compliance-scan', a11y: 'a11y-monitoring', refactor: 'payments-refactor', perf: 'perf-scan-2026-10', node: 'node-22', cost: 'cost-sprint' };
const PERF_DOMAINS = ['storefront', 'discovery', 'checkout'];
{
  const S = stream('scopes');
  for (const f of F) {
    if (['payments', 'checkout'].includes(f.domainId)) {
      if (f.status === 'live') f._refactor = S.weighted([['covered', 0.45], ['in-progress', 0.25], ['pending', 0.3]]);
      else if (f.status === 'ready') f._refactor = S.chance(0.7) ? 'covered' : 'pending';
      else if (f.status === 'building') f._refactor = 'covered';
    }
    if (f.status === 'live' && PERF_DOMAINS.includes(f.domainId)) f._perfScanned = S.chance(0.8);
    if (f.status === 'live' && f.surfaces.includes('worker') && ['foundation', 'fulfillment', 'merchant'].includes(f.areaId)) {
      f._node = S.weighted([['covered', 0.55], ['in-progress', 0.2], ['pending', 0.25]]);
    }
  }
}

// ── Target overall bands for live features, and monitoring ────────────────────────────────────

{
  const S = stream('bands');
  const BIAS = {
    identity: 0.25, platform: 0.25, checkout: 0.15, payments: 0.15, pricing: 0.1, billing: 0.1, orders: 0.08, inventory: 0.05, shipping: 0.05,
    care: 0, admin: 0.05, analytics: 0, integrations: 0, storefront: 0.05, discovery: 0, community: -0.15, mobile: -0.2,
  };
  const live = F.filter((f) => f.status === 'live');
  const sorted = live.map((f) => ({ f, k: BIAS[f.domainId] + (pins.has(f) ? 0.3 : 0) + S.next() })).sort((a, b) => a.k - b.k).map((x) => x.f);
  const [nCrit, nPoor, nFair] = [Math.round(0.065 * live.length), Math.round(0.14 * live.length), Math.round(0.285 * live.length)];
  sorted.forEach((f, i) => { f._target = i < nCrit ? 'critical' : i < nCrit + nPoor ? 'poor' : i < nCrit + nPoor + nFair ? 'fair' : 'good'; });
  const nUnmon = Math.round(0.09 * live.length);
  const pool = live.map((f) => [f, (f._target === 'good' ? 0.25 : 1) * (f.sinceIdx >= 9 ? 2 : 1)]);
  live.forEach((f) => { f._monitored = true; });
  for (let k = 0; k < nUnmon; k++) {
    const f = S.weighted(pool);
    f._monitored = false;
    pool.splice(pool.findIndex((x) => x[0] === f), 1);
  }
  // A few live features have never had a security scan.
  S.shuffle(live.filter((f) => f._target === 'fair' || f._target === 'poor')).slice(0, 3).forEach((f) => { f._neverScanned = true; });
}

// ── People ────────────────────────────────────────────────────────────────────────────────────

const PEOPLE = C.people;
const inSquad = (squad, roles) => PEOPLE.filter((p) => p.team === squad && roles.includes(p.role));
const anyRole = (roles) => PEOPLE.filter((p) => roles.includes(p.role));
function choosePerson(S, squad, roles) {
  const local = inSquad(squad, roles);
  return S.pick(local.length ? local : anyRole(roles)).id;
}
const TRIAGE_ROLES = { perf: ['engineering', 'operations'], security: ['security'], compliance: ['compliance'], ux: ['design'], cost: ['operations'] };
const triager = (S, f, kind) => choosePerson(S, f.owner, TRIAGE_ROLES[kind] || ['engineering']);
function reviewer(S, f, activity, notThis) {
  if (activity === 'security') return choosePerson(S, 'platform', ['security']);
  const roles = S.weighted([[['engineering'], 0.5], [['product'], 0.3], [hasUi(f) ? ['design'] : ['engineering'], 0.2]]);
  // Nobody approves their own branch: pick again from the squad (or anyone with the role) without the author.
  const local = inSquad(f.owner, roles).filter((p) => p.id !== notThis);
  const pool = local.length ? local : anyRole(roles).filter((p) => p.id !== notThis);
  return S.pick(pool).id;
}
const author = (S, f) => choosePerson(S, f.owner, ['engineering']);
const goalAuthor = (S, f) => choosePerson(S, f.owner, ['product']);

// ── Metrics ───────────────────────────────────────────────────────────────────────────────────

const qOf = (S, h, sd = 0.1) => clamp(h + S.gauss() * sd, 0.03, 0.99);
/** A metric's own jitter around its lens quality q; noise never drags a non-critical q (≥ 0.4) into critical. */
const noisy = (S, q, sd) => {
  const x = clamp(q + S.gauss() * sd);
  return q >= 0.4 ? Math.max(0.4, x) : x;
};
const SURF_CODE = { web: 'w', admin: 'a', mobile: 'm', api: 'p', worker: 'k', data: 'd' };
/** Picks a finding title whose surfaces match the feature's (pool entries are [title, codes]). */
function pickFinding(S, f, pool, skipFirst) {
  const codes = f.surfaces.map((x) => SURF_CODE[x]);
  const fits = pool.slice(skipFirst ? 1 : 0).filter(([, on]) => on === '*' || [...on].some((c) => codes.includes(c)));
  return S.pick(fits.length ? fits : pool)[0];
}

/** Picks a bug title that fits the feature's surfaces and domain (pool entries are [title, codes, domains|null]). */
function pickBug(S, f, used) {
  const codes = f.surfaces.map((x) => SURF_CODE[x]);
  const fits = (b) => (b[1] === '*' || [...b[1]].some((c) => codes.includes(c))) && (!b[2] || b[2].split(' ').includes(f.domainId)) && !used.has(b[0]);
  const own = C.bugs.filter((b) => fits(b) && b[2]);
  const any = C.bugs.filter(fits);
  const pool = own.length && S.chance(0.6) ? own : any.length ? any : C.bugs.filter((b) => !used.has(b[0]));
  return S.pick(pool)[0];
}

const MONEY_DOMAINS = ['checkout', 'payments', 'pricing', 'billing'];
/** Reviewer notes that fit a branch: by the work item's kind, else by the feature's main surface and domain. */
function reviewNotePool(f, item) {
  const N = C.reviewerNotes;
  const byKind = { bug: N.fix, perf: N.perf, security: N.security, ux: N.a11y, compliance: N.a11y, cost: N.cost, refactor: N.refactor };
  if (byKind[item.kind]) return byKind[item.kind];
  const surface = primarySurface(f);
  return (N[surface] || N.web).concat(MONEY_DOMAINS.includes(f.domainId) ? N.money : []);
}

function genDev(S, q) {
  const gq = noisy(S, q, 0.07);
  let quality = 'E';
  let best = 9;
  for (const [g, v] of [['A', 1], ['B', 0.85], ['C', 0.65], ['D', 0.45], ['E', 0.25]]) {
    if (Math.abs(v - gq) < best) { best = Math.abs(v - gq); quality = g; }
  }
  const cq = noisy(S, q, 0.07);
  let coverage = cq > 0.97 ? S.int(86, 96) : invPw(cq, [[0, 0], [40, 0.4], [60, 0.7], [85, 1]]);
  coverage = Math.round(clamp(coverage, 8, 97));
  const critical = q < 0.28 ? (S.chance(0.8) ? 1 : 2) : q < 0.36 && S.chance(0.25) ? 1 : 0;
  const major = q < 0.5 ? S.int(1, 4) : q < 0.7 ? S.int(0, 2) : q < 0.85 ? (S.chance(0.35) ? 1 : 0) : 0;
  const minor = S.int(0, Math.round((1 - q) * 9));
  return { quality, coverage, bugs: { critical, major, minor } };
}

function sloFor(S, f) {
  const s = f.surfaces;
  if (s.includes('web') || s.includes('mobile')) return S.pick([300, 400, 500, 800]);
  if (s.includes('api')) return S.pick([150, 200, 250, 300]);
  if (s.includes('admin')) return S.pick([400, 600, 800]);
  if (s.includes('worker')) return S.pick([1000, 2000, 5000]);
  return S.pick([2000, 5000, 10000]);
}

function genOps(S, q, f, monitored) {
  const sloP95 = sloFor(S, f);
  if (!monitored) return { monitored: false, uptime: null, errorRate: null, p95: null, sloP95 };
  const qu = noisy(S, q, 0.07);
  let uptime = qu >= 0.995 ? S.pick([99.95, 99.97, 99.98, 99.99]) : invPw(qu, [[98, 0.1], [99, 0.4], [99.5, 0.6], [99.9, 0.85], [99.95, 1]]);
  uptime = round2(clamp(uptime, 97.6, 99.99));
  const qe = noisy(S, q, 0.07);
  let errorRate = qe >= 0.99 ? S.pick([0.02, 0.04, 0.05, 0.08]) : invPw(qe, [[0.1, 1], [0.5, 0.75], [1, 0.55], [2, 0.35], [5, 0.05]]);
  errorRate = round2(clamp(errorRate, 0.01, 6));
  const ql = noisy(S, q, 0.08);
  const ratio = ql >= 0.75 ? S.between(0.35, 0.9) : ql >= 0.6 ? S.between(0.8, 1.02) : ql >= 0.45 ? S.between(0.98, 1.25) : ql >= 0.3 ? S.between(1.15, 1.45) : S.between(1.35, 1.9);
  return { monitored: true, uptime, errorRate, p95: Math.round(sloP95 * ratio), sloP95 };
}

function genBiz(S, q) {
  return {
    adoption: Math.round(clamp(12 + q * 66 + S.gauss() * 14, 2, 96)),
    satisfaction: S.chance(0.27) ? null : round1(clamp(2.3 + q * 2.4 + S.gauss() * 0.3, 1.6, 4.9)),
  };
}

function bizTarget(S, q) {
  if (q >= 0.74) return S.chance(0.95) ? 0 : 1;
  if (q >= 0.6) return S.chance(0.45) ? 1 : 0;
  if (q >= 0.45) return S.int(1, 2);
  if (q >= 0.3) return S.int(2, 3);
  return S.int(3, 5);
}

function genSec(S, q, f, maxAge) {
  const qs = noisy(S, q, 0.08);
  let critical = 0;
  let high = 0;
  let medium = 0;
  if (qs < 0.3) { critical = S.chance(0.8) ? 1 : 2; high = S.int(0, 2); medium = S.int(1, 5); }
  else if (qs < 0.42) { high = S.int(2, 4); medium = S.int(1, 6); }
  else if (qs < 0.52) { high = S.chance(0.7) ? 1 : 2; medium = S.int(0, 5); }
  else if (qs < 0.68) medium = S.int(4, 7);
  else if (qs < 0.84) medium = S.int(1, 4);
  else medium = S.chance(0.3) ? 1 : 0;
  let age;
  if (qs >= 0.7 && S.chance(0.025)) age = S.int(92, 130); // clean but stale: the 90-day cap applies
  else if (qs < 0.4 && S.chance(0.12)) age = S.int(91, 140);
  else if ((qs < 0.55 && S.chance(0.3)) || S.chance(0.07)) age = S.int(31, 85);
  else age = S.weighted([[0, 0.12], [1, 0.12], [2, 0.1], [3, 0.08], [5, 0.12], [7, 0.12], [10, 0.12], [14, 0.1], [21, 0.12]]);
  age = Math.min(age, maxAge);
  const never = !!f._neverScanned;
  return {
    vulns: { critical, high, medium },
    lastScan: never ? null : addDays(ASOF, -age),
    secretsClean: !(qs < 0.35 && S.chance(0.08)),
  };
}

function genComp(S, q, regimes, planned) {
  if (planned) {
    if (S.chance(0.04)) return { regimes: regimes.slice(), coverage: 0, findings: 0 };
    return { regimes: regimes.slice(), coverage: S.int(45, 92), findings: S.chance(0.15) ? 1 : 0 };
  }
  const qc = noisy(S, q, 0.08);
  if (qc < 0.25 && S.chance(0.45)) return { regimes: regimes.slice(), coverage: 0, findings: 0 };
  // Most features scan clean; open findings concentrate where compliance health is weak.
  const findings = qc >= 0.74 ? 0 : qc >= 0.6 ? (S.chance(0.15) ? 1 : 0) : qc >= 0.5 ? (S.chance(0.6) ? 1 : 2) : qc >= 0.4 ? 2 : S.int(3, 4);
  const coverage = Math.round(clamp(qc >= 0.85 ? S.between(90, 100) : 52 + qc * 46 + S.gauss() * 5, 30, 100));
  return { regimes: regimes.slice(), coverage, findings };
}

function genUx(S, q) {
  const qa = noisy(S, q, 0.08);
  return {
    a11y: Math.round(clamp(46 + qa * 54 + S.gauss() * 4, 35, 100)),
    usability: S.chance(0.33) ? null : round1(clamp(1.8 + q * 3 + S.gauss() * 0.3, 1.5, 4.9)),
    debt: Math.round(clamp((1 - q) * 8 + S.gauss() * 1.2, 0, 10)),
  };
}

function genCost(S, q, f) {
  const qc = noisy(S, q, 0.08);
  const r = qc >= 0.88 ? S.between(0.35, 0.8) : qc >= 0.72 ? S.between(0.81, 0.99) : qc >= 0.55 ? S.between(1.01, 1.14) : qc >= 0.4 ? S.between(1.16, 1.39) : S.between(1.42, 1.9);
  const heavy = f.surfaces.includes('worker') || f.surfaces.includes('data');
  const budget = Math.round((heavy ? S.between(900, 9000) : S.between(80, 2400)) / 50) * 50;
  const trend = qc < 0.45 && S.chance(0.4) ? S.int(26, 48) : S.int(-18, 22);
  return { monthly: Math.max(10, Math.round(budget * r)), budget, trend };
}

// ── Work items and branches (ids are assigned later, in display order) ───────────────────────

const ACTIVITY = { feature: 'implement', bug: 'fix', perf: 'perf', security: 'security', compliance: 'fix', ux: 'fix', cost: 'refactor', refactor: 'refactor' };
const APPROVAL_WAIT = [[0, 10], [1, 15], [2, 13], [3, 11], [4, 9], [5, 8], [6, 6], [7, 6], [8, 5], [9, 4], [10, 3], [12, 3], [15, 2], [19, 1]];

function makeItem(props) {
  return Object.assign({
    id: null, title: '', source: 'goal', sourceRef: null, kind: 'feature', state: 'backlog', priority: 'P2',
    createdAt: ASOF, triagedBy: null, initiative: null,
  }, props);
}

function makeEvidence(S, f, activity, metrics, coverageDelta) {
  const ui = hasUi(f);
  const kind = (activity === 'implement' || activity === 'fix') && ui && S.chance(0.75) ? 'demo' : 'report';
  const t = kind === 'demo' ? S.pick(C.evidence.demo) : C.evidence.report[activity] || C.evidence.report.implement;
  const ops = metrics && metrics.ops && metrics.ops.monitored ? metrics.ops : null;
  const before = ops ? Math.max(ops.p95, Math.round(ops.sloP95 * 1.1)) : S.int(380, 900);
  const vars = { name: f.name, n: S.int(4, 28), pct: activity === 'test' ? Math.max(1, Math.round(coverageDelta)) : S.int(2, 9), p95: before, slo: Math.round(before * S.between(0.45, 0.8)) };
  return { kind, title: fill(t.title, vars), summary: fill(t.summary, vars), ref: null };
}

/**
 * Creates a branch for a work item in a given state, walking dates backwards from asOf so that
 * item.createdAt ≤ openedAt ≤ updatedAt ≤ asOf and the branch never starts before `floor`.
 */
function makeBranch(S, f, item, activity, state, metrics, opts = {}) {
  const floor = maxDate(f.createdAt, item.createdAt);
  const room = Math.max(0, diffDays(floor, ASOF));
  let updated;
  if (opts.updatedAt) updated = opts.updatedAt;
  else if (state === 'awaiting-approval') updated = addDays(ASOF, -Math.min(room, S.weighted(APPROVAL_WAIT)));
  else if (state === 'changes-requested') updated = addDays(ASOF, -Math.min(room, S.int(1, 9)));
  else if (state === 'approved') updated = addDays(ASOF, -Math.min(room, S.int(0, 6)));
  else if (state === 'abandoned') updated = addDays(ASOF, -Math.min(room, S.int(12, 60)));
  else updated = addDays(ASOF, -Math.min(room, S.weighted([[0, 3], [1, 3], [2, 2], [3, 2], [5, 1], [8, 1]])));
  updated = maxDate(updated, floor);
  const opened = maxDate(floor, addDays(updated, -S.int(1, 14)));
  const crewFor = activity === 'security' ? 'sentry' : C.areaCrew[f.areaId];
  const crew = f.builtBy === 'human' ? null : crewFor;
  const auth = f.builtBy === 'agent' ? null : author(S, f);
  const tests = state === 'running' ? S.weighted([['running', 0.5], ['pass', 0.35], ['fail', 0.15]])
    : state === 'changes-requested' ? S.weighted([['pass', 0.6], ['fail', 0.4]])
    : state === 'abandoned' ? S.weighted([['fail', 0.6], ['pass', 0.4]]) : 'pass';
  const hasEvidence = ['awaiting-approval', 'approved', 'merged', 'changes-requested'].includes(state);
  const reviewed = ['approved', 'merged', 'changes-requested'].includes(state);
  // A test branch exists to raise coverage, and its report quotes the same gain the checks show.
  const coverageDelta = activity === 'test' ? round1(S.between(1.5, 6)) : round1(S.between(-2.5, 4.5));
  return {
    id: null, _hint: opts.hint || null, workItem: item, crew, author: auth, activity, state,
    openedAt: opened, updatedAt: updated,
    checks: { tests, coverageDelta },
    evidence: hasEvidence ? makeEvidence(S, f, item.kind === 'cost' ? 'cost' : activity, metrics, coverageDelta) : null,
    reviewer: reviewed ? reviewer(S, f, activity, auth) : null,
    note: state === 'changes-requested' ? S.pick(reviewNotePool(f, item)) : null,
  };
}

/** Adds a branch matching an open item's state (in progress or review). */
function branchForItem(S, f, item, metrics, branches, hint) {
  const activity = ACTIVITY[item.kind];
  let state;
  if (item.state === 'in-progress') state = S.chance(0.86) ? 'running' : 'changes-requested';
  else if (item.state === 'review') state = S.chance(0.88) ? 'awaiting-approval' : 'approved';
  else return;
  branches.push(makeBranch(S, f, item, activity, state, metrics, { hint }));
}

/** Picks an open state for a scan finding: triage only while the finding is fresh. */
function scanState(S, ageDays, weights) {
  const w = weights.filter(([st]) => st !== 'triage' || ageDays <= 14);
  return S.weighted(w);
}

function primarySurface(f) {
  return f.surfaces.includes('web') ? 'web' : f.surfaces.includes('mobile') ? 'mobile' : f.surfaces.includes('admin') ? 'admin'
    : f.surfaces.includes('api') ? 'api' : f.surfaces.includes('worker') ? 'worker' : 'data';
}

// ── Feature content per status ────────────────────────────────────────────────────────────────

const H = { good: [0.82, 0.97], fair: [0.62, 0.8], poor: [0.42, 0.62], critical: [0.16, 0.38] };

function buildLive(S, f, h) {
  const q = {};
  // Outside critical targets a lens never drifts into critical by noise alone: critical lenses come from the
  // forced lows below, so "needs attention" stays a meaningful signal.
  const floorQ = f._target === 'critical' ? 0.03 : 0.42;
  ['dev', 'ops', 'biz', 'sec', 'comp', 'ux', 'cost'].forEach((l) => { q[l] = Math.max(floorQ, qOf(S, h)); });
  const lowable = ['dev', 'sec', 'ops', 'cost'].concat(f.regimes.length ? ['comp'] : [], hasUi(f) ? ['ux'] : []);
  const forceLow = f._target === 'poor' ? (S.chance(0.35) ? 1 : 0) : f._target === 'critical' ? 2 : 0;
  for (let i = 0; i < forceLow; i++) q[S.pick(lowable)] = S.between(0.05, 0.25);
  const firstRel = SHIPPED[f.relIdx].date;
  const floor = maxDate(f.createdAt, firstRel);
  const maxAge = diffDays(floor, ASOF);
  const metrics = {
    dev: genDev(S, q.dev),
    ops: genOps(S, q.ops, f, f._monitored),
    biz: genBiz(S, q.biz),
    sec: genSec(S, q.sec, f, maxAge),
    comp: f.regimes.length ? genComp(S, q.comp, f.regimes, false) : null,
    ux: hasUi(f) ? genUx(S, q.ux) : null,
    cost: genCost(S, q.cost, f),
  };
  const compAudit = addDays(ASOF, -Math.min(maxAge, S.int(3, 45)));
  const uxAudit = addDays(ASOF, -Math.min(maxAge, S.int(2, 40)));
  const items = [];
  const branches = [];
  const pickPri = () => S.weighted([['P1', 0.3], ['P2', 0.5], ['P3', 0.2]]);

  // Performance scan findings (October 2026), waiting for developer triage.
  if (f._perfScanned) {
    const over = metrics.ops.monitored && metrics.ops.p95 > metrics.ops.sloP95;
    if (over || S.chance(0.14)) {
      const tpl = over ? C.findings.perf[0][0] : pickFinding(S, f, C.findings.perf, true);
      const title = fill(tpl, { name: f.name, p95: metrics.ops.p95, slo: metrics.ops.sloP95, n: S.int(80, 420), pct: S.int(31, 62) });
      const state = S.weighted([['triage', 0.74], ['backlog', 0.16], ['dismissed', 0.1]]);
      items.push(makeItem({
        title, source: 'scan', kind: 'perf', state, priority: over ? 'P1' : 'P2', createdAt: addDays('2026-10-01', S.int(0, 7)),
        triagedBy: state === 'triage' ? null : triager(S, f, 'perf'), initiative: INI.perf,
      }));
    }
  }
  // Security scan findings.
  const v = metrics.sec.vulns;
  if (metrics.sec.lastScan && (v.critical > 0 || v.high > 1 || (v.high === 1 && S.chance(0.2)))) {
    const age = diffDays(metrics.sec.lastScan, ASOF);
    const state = scanState(S, age, [['triage', 0.45], ['backlog', 0.4], ['in-progress', v.critical > 0 ? 0.4 : 0.1]]);
    const item = makeItem({
      title: pickFinding(S, f, C.findings.security), source: 'scan', kind: 'security', state, priority: v.critical ? 'P0' : 'P1',
      createdAt: metrics.sec.lastScan, triagedBy: state === 'triage' ? null : triager(S, f, 'security'),
    });
    items.push(item);
    branchForItem(S, f, item, metrics, branches);
  }
  // Compliance scan findings.
  if (metrics.comp && (metrics.comp.findings >= 3 || (metrics.comp.findings === 2 && S.chance(0.4)))) {
    const age = diffDays(compAudit, ASOF);
    for (let k = 0; k < 1; k++) {
      const regime = S.pick(metrics.comp.regimes);
      const state = scanState(S, age, [['triage', 0.35], ['backlog', 0.55], ['in-progress', 0.1]]);
      const item = makeItem({
        title: S.pick(C.findings.compliance[regime]), source: 'scan', kind: 'compliance', state, priority: S.chance(0.4) ? 'P1' : 'P2',
        createdAt: compAudit, triagedBy: state === 'triage' ? null : triager(S, f, 'compliance'), initiative: INI.comp,
      });
      if (!items.some((x) => x.title === item.title)) {
        items.push(item);
        branchForItem(S, f, item, metrics, branches);
      }
    }
  }
  // Accessibility monitoring findings.
  if (metrics.ux && (metrics.ux.a11y < 66 || metrics.ux.debt >= 7)) {
    const state = scanState(S, diffDays(uxAudit, ASOF), [['triage', 0.4], ['backlog', 0.5], ['in-progress', 0.1]]);
    const item = makeItem({
      title: S.pick(C.findings.a11y), source: 'scan', kind: 'ux', state, priority: metrics.ux.a11y < 60 ? 'P1' : 'P2',
      createdAt: uxAudit, triagedBy: state === 'triage' ? null : triager(S, f, 'ux'), initiative: INI.a11y,
    });
    items.push(item);
    branchForItem(S, f, item, metrics, branches);
  }
  // Cloud cost reduction sprint.
  if (metrics.cost.monthly > 1.15 * metrics.cost.budget && S.chance(0.75)) {
    const state = S.weighted([['triage', 0.3], ['backlog', 0.4], ['in-progress', 0.15], ['review', 0.15]]);
    const item = makeItem({
      title: pickFinding(S, f, C.findings.cost), source: 'scan', kind: 'cost', state, priority: 'P2',
      createdAt: addDays('2026-09-28', S.int(0, 5)), triagedBy: state === 'triage' ? null : triager(S, f, 'cost'), initiative: INI.cost,
    });
    items.push(item);
    branchForItem(S, f, item, metrics, branches, 'cost');
  }
  // Open bugs from the ticketing system.
  const bugs = metrics.dev.bugs;
  const bugCount = Math.min(1, bugs.critical) + (bugs.major > 1 && S.chance(0.2) ? 1 : 0);
  const usedBugs = new Set();
  for (let k = 0; k < bugCount; k++) {
    const bug = pickBug(S, f, usedBugs);
    usedBugs.add(bug);
    const critical = k < bugs.critical;
    const state = critical ? (S.chance(0.5) ? 'in-progress' : 'backlog') : 'backlog';
    const item = makeItem({
      title: cap(bug), source: 'ticket', kind: 'bug', state, priority: critical ? 'P0' : 'P1',
      createdAt: addDays(ASOF, -Math.min(maxAge, S.int(2, 40))),
    });
    items.push(item);
    branchForItem(S, f, item, metrics, branches, shortSlug(bug, 3));
  }
  // Payments core refactor and the Node 22 upgrade.
  if (f._refactor === 'in-progress') {
    const state = S.chance(0.65) ? 'in-progress' : 'review';
    const item = makeItem({
      title: 'Move onto the payments core', source: 'goal', kind: 'refactor', state, priority: 'P1',
      createdAt: addDays('2026-08-17', S.int(0, 25)), initiative: INI.refactor, _goalBy: 'lucia-fernandez',
    });
    items.push(item);
    branchForItem(S, f, item, metrics, branches, 'payments-core');
  }
  if (f._node === 'in-progress') {
    const state = S.chance(0.65) ? 'in-progress' : 'review';
    const item = makeItem({
      title: 'Upgrade workers to Node 22', source: 'goal', kind: 'refactor', state, priority: 'P2',
      createdAt: addDays('2026-09-07', S.int(0, 12)), initiative: INI.node, _goalBy: 'tomasz-nowak',
    });
    items.push(item);
    branchForItem(S, f, item, metrics, branches, 'node22');
  }
  // Feature asks until the open backlog matches the business health (a few critical features pile up asks).
  const target = f._target === 'critical' && S.chance(0.12) ? S.int(8, 9) : bizTarget(S, q.biz);
  const asks = S.shuffle(C.asks[primarySurface(f)].concat(C.asks.api, C.asks.worker).filter((x, i, a) => a.indexOf(x) === i));
  let open = items.filter((x) => OPEN.includes(x.state)).length;
  for (let k = 0; open < target && k < asks.length; k++, open++) {
    const state = S.weighted([['backlog', 0.88], ['in-progress', 0.06], ['review', 0.06]]);
    const item = makeItem({
      title: cap(asks[k]), source: S.chance(0.4) ? 'goal' : 'ticket', kind: 'feature', state, priority: pickPri(),
      createdAt: addDays(ASOF, -Math.min(maxAge, S.int(3, 160))),
    });
    items.push(item);
    branchForItem(S, f, item, metrics, branches, shortSlug(asks[k], 2));
  }
  // Recent history: a finished change with its merged branch.
  if (S.chance(0.025) && maxAge > 30) {
    const isBug = S.chance(0.4);
    const text = isBug ? pickBug(S, f, new Set()) : S.pick(C.asks[primarySurface(f)]);
    const created = addDays(ASOF, -S.int(25, Math.min(maxAge, 280)));
    const item = makeItem({ title: cap(text), source: isBug ? 'ticket' : 'goal', kind: isBug ? 'bug' : 'feature', state: 'done', priority: pickPri(), createdAt: created });
    const merged = minDate(addDays(ASOF, -1), addDays(created, S.int(4, 20)));
    items.push(item);
    branches.push(makeBranch(S, f, item, isBug ? 'fix' : 'implement', 'merged', metrics, { updatedAt: merged, hint: shortSlug(text, 2) }));
  }
  return { metrics, workItems: items, branches, progress: 100, _compAudit: compAudit, _uxAudit: uxAudit };
}

function buildNonLive(S, f) {
  const st = f.status;
  const h = st === 'ready' ? S.between(0.68, 0.95) : st === 'building' ? S.between(0.5, 0.92) : st === 'blocked' ? S.between(0.4, 0.8) : S.between(0.5, 0.9);
  const maxAge = diffDays(f.createdAt, ASOF);
  const metrics = { dev: null, ops: null, biz: null, sec: null, comp: null, ux: null, cost: null };
  if (st !== 'planned') {
    metrics.dev = genDev(S, Math.max(0.42, qOf(S, h)));
    metrics.sec = genSec(S, Math.max(0.42, qOf(S, h)), f, Math.max(0, maxAge - 3));
    if (hasUi(f)) metrics.ux = genUx(S, qOf(S, h));
  }
  if (f.regimes.length) metrics.comp = genComp(S, qOf(S, h), f.regimes, st === 'planned');
  const compAudit = addDays(ASOF, -Math.min(Math.max(0, maxAge - 1), S.int(2, 40)));
  const uxAudit = addDays(ASOF, -Math.min(Math.max(0, maxAge - 1), S.int(1, 30)));
  const items = [];
  const branches = [];
  const goal = S.chance(0.58);
  const main = makeItem({
    title: goal ? `Build ${lowerFirst(f.name)}` : `${f.name}: ${S.pick(['first release', 'pilot for ten stores', 'general availability', 'launch in all markets'])}`,
    source: goal ? 'goal' : 'ticket', kind: 'feature', state: 'backlog', priority: f.priority,
    createdAt: addDays(f.createdAt, S.int(0, Math.min(3, maxAge))),
  });
  items.push(main);
  let progress = 0;
  if (st === 'building') {
    const mode = S.weighted([['running', 0.5], ['changes', 0.13], ['awaiting', 0.37]]);
    const state = mode === 'running' ? 'running' : mode === 'changes' ? 'changes-requested' : 'awaiting-approval';
    main.state = mode === 'awaiting' ? 'review' : 'in-progress';
    branches.push(makeBranch(S, f, main, 'implement', state, metrics));
    progress = mode === 'running' ? S.int(15, 70) : mode === 'changes' ? S.int(40, 85) : S.int(55, 90);
    if (S.chance(0.1)) branches.push(makeBranch(S, f, main, 'test', S.chance(0.5) ? 'running' : 'awaiting-approval', metrics, { hint: 'e2e-tests' }));
  } else if (st === 'ready') {
    main.state = 'done';
    const merged = addDays(ASOF, -S.int(2, 15));
    branches.push(makeBranch(S, f, main, 'implement', 'merged', metrics, { updatedAt: merged }));
    progress = 100;
    if (S.chance(0.22)) {
      const docs = S.chance(0.5);
      const follow = makeItem({
        title: docs ? 'Merchant help article' : 'End-to-end tests', source: 'goal', kind: 'feature', state: 'review', priority: 'P2',
        createdAt: addDays(merged, -S.int(0, 6)),
      });
      items.push(follow);
      branches.push(makeBranch(S, f, follow, docs ? 'docs' : 'test', S.chance(0.55) ? 'approved' : 'awaiting-approval', metrics, { hint: docs ? 'docs' : 'e2e-tests' }));
    }
  } else if (st === 'blocked') {
    progress = S.int(10, 70);
    if (S.chance(0.55)) {
      main.state = 'in-progress';
      branches.push(makeBranch(S, f, main, 'implement', 'running', metrics, { updatedAt: addDays(ASOF, -Math.min(maxAge, S.int(10, 40))) }));
    }
  } else if (S.chance(0.08)) {
    main.state = 'in-progress';
    branches.push(makeBranch(S, f, main, 'implement', 'running', metrics, { hint: 'spike' }));
    progress = S.int(5, 10);
  } else {
    progress = S.int(0, 5);
  }
  // Scan findings on work in progress.
  if (st !== 'planned' && metrics.sec.lastScan && (metrics.sec.vulns.critical > 0 || metrics.sec.vulns.high > 1)) {
    const state = scanState(S, diffDays(metrics.sec.lastScan, ASOF), [['triage', 0.5], ['backlog', 0.5]]);
    items.push(makeItem({
      title: pickFinding(S, f, C.findings.security), source: 'scan', kind: 'security', state, priority: 'P1',
      createdAt: metrics.sec.lastScan, triagedBy: state === 'triage' ? null : triager(S, f, 'security'),
    }));
  }
  if (metrics.ux && metrics.ux.a11y < 60) {
    const state = scanState(S, diffDays(uxAudit, ASOF), [['triage', 0.5], ['backlog', 0.5]]);
    items.push(makeItem({
      title: S.pick(C.findings.a11y), source: 'scan', kind: 'ux', state, priority: 'P2',
      createdAt: uxAudit, triagedBy: state === 'triage' ? null : triager(S, f, 'ux'), initiative: INI.a11y,
    }));
  }
  if (st === 'blocked') {
    const building = f.dependsOn.map((id) => byId.get(id)).filter((g) => g.status === 'building');
    const own = C.blockedReasons.byDomain[f.domainId] || [];
    f.blockedReason = building.length && S.chance(0.6) ? fill(C.dependencyBlockedReason, { dep: building[0].name })
      : own.length && S.chance(0.75) ? S.pick(own) : S.pick(C.blockedReasons.any);
  }
  return { metrics, workItems: items, branches, progress, _compAudit: compAudit, _uxAudit: uxAudit };
}

/** Distance from a score to a band's interval (0 inside). */
function bandDistance(score, target) {
  const [lo, hi] = { good: [0.8, 1.01], fair: [0.6, 0.8], poor: [0.4, 0.6], critical: [-1, 0.4] }[target];
  return score < lo ? lo - score : score >= hi ? score - hi + 1e-6 : 0;
}

for (const f of F) {
  const S = stream('feature:' + f.id);
  let built;
  if (f.status === 'live') {
    let best = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const [lo, hi] = H[f._target];
      const shift = attempt < 30 ? 0 : (attempt - 30) * 0.004 * (f._target === 'good' ? 1 : -1);
      const cand = buildLive(S, f, clamp(S.between(lo, hi) + shift, 0.05, 0.99));
      const obj = Object.assign({ status: 'live', release: f.release, progress: 100, surfaces: f.surfaces }, cand);
      const r = BP.rating(obj, 'overall');
      const d = bandDistance(r.score, f._target);
      if (!best || d < best.d) best = { d, cand };
      if (d === 0) break;
    }
    built = best.cand;
  } else {
    built = buildNonLive(S, f);
  }
  Object.assign(f, built);
}

// ── Ids and references ────────────────────────────────────────────────────────────────────────

{
  const S = stream('refs');
  let wiN = 0;
  let goalN = 1200;
  const scanPrefix = { perf: 'PERF', security: 'SAST', compliance: 'CMPL', ux: 'A11Y', cost: 'COST' };
  const scanN = { PERF: 400, SAST: 7100, CMPL: 2200, A11Y: 900, COST: 150 };
  const tickets = new Set();
  const branchIds = new Set();
  let evidenceN = 3000;
  const PREFIX = { implement: 'feat/', fix: 'fix/', perf: 'perf/', security: 'sec/', refactor: 'refactor/', test: 'feat/', docs: 'feat/' };
  for (const f of F) {
    for (const w of f.workItems) {
      w.id = 'wi-' + String(++wiN).padStart(4, '0');
      if (w.source === 'goal') {
        w.sourceRef = 'GOAL-' + ++goalN;
        w._goalBy = w._goalBy || goalAuthor(S, f);
      } else if (w.source === 'ticket') {
        let t;
        do t = 'LRK-' + S.int(1000, 4999); while (tickets.has(t));
        tickets.add(t);
        w.sourceRef = t;
      } else {
        const p = scanPrefix[w.kind] || 'SCAN';
        scanN[p] = (scanN[p] || 100) + S.int(1, 4);
        w.sourceRef = `${p}-${String(scanN[p]).padStart(4, '0')}`;
      }
      if (w.createdAt < f.createdAt) w.createdAt = f.createdAt;
    }
    for (const b of f.branches) {
      const hint = b._hint ? '-' + b._hint : b.activity === 'test' ? '-e2e-tests' : b.activity === 'docs' ? '-docs' : '';
      let id = PREFIX[b.activity] + f.slug + hint;
      for (let k = 2; branchIds.has(id); k++) id = PREFIX[b.activity] + f.slug + hint + '-' + k;
      branchIds.add(id);
      b.id = id;
      if (b.evidence) b.evidence.ref = `${b.evidence.kind}/${++evidenceN}`;
      if (b.openedAt < b.workItem.createdAt) b.openedAt = b.workItem.createdAt;
      if (b.updatedAt < b.openedAt) b.updatedAt = b.openedAt;
    }
  }
}

// ── Release packages ──────────────────────────────────────────────────────────────────────────

/** Release note for work on a live feature that ships next: what changes for merchants, not the finding. */
function nextNote(w) {
  if (w.initiative === INI.refactor) return 'Moved onto the payments core.';
  if (w.initiative === INI.node) return 'Workers upgraded to Node 22.';
  const byKind = { cost: 'Lower cloud cost.', perf: 'Faster under load.', security: 'Security fix.', ux: 'Accessibility fixes.', compliance: 'Compliance fix.' };
  if (byKind[w.kind]) return byKind[w.kind];
  if (w.kind === 'bug') return 'Fixed: ' + lowerFirst(w.title) + '.';
  return w.title + '.';
}

const releaseItems = new Map(REL.map((r) => [r.id, []]));
{
  const S = stream('release-items');
  const has = (rid, f) => releaseItems.get(rid).some((it) => it.feature === f.id);
  for (const f of F) {
    if (f.status === 'live') releaseItems.get(f.release).push({ feature: f.id, kind: 'new', note: S.chance(0.3) ? S.pick(C.releaseNotes.new) : null });
    else if (f.release) releaseItems.get(f.release).push({ feature: f.id, kind: 'new', note: null });
  }
  // Merged changes on live features ship in the first release on or after the merge.
  for (const f of F) {
    if (f.status !== 'live') continue;
    for (const b of f.branches) {
      if (b.state !== 'merged') continue;
      const r = REL.find((x) => x.date >= b.updatedAt);
      if (!r || relIdx.get(r.id) <= f.relIdx || has(r.id, f)) continue;
      const kind = b.activity === 'fix' ? 'fixed' : 'improved';
      releaseItems.get(r.id).push({ feature: f.id, kind, note: S.pick(C.releaseNotes[kind]) });
    }
  }
  // Approved work, or work waiting for approval, on live features ships in the next release as an improvement or a fix.
  for (const f of F) {
    if (f.status !== 'live' || has(NEXT.id, f)) continue;
    const b = f.branches.find((x) => x.state === 'approved' || x.state === 'awaiting-approval');
    if (b) releaseItems.get(NEXT.id).push({ feature: f.id, kind: b.activity === 'fix' ? 'fixed' : 'improved', note: nextNote(b.workItem) });
  }
  // Earlier improvements and fixes fill each shipped package.
  SHIPPED.forEach((r, i) => {
    if (i === 0) return;
    const items = releaseItems.get(r.id);
    const target = S.int(25, 30);
    const pool = S.shuffle(F.filter((f) => f.status === 'live' && f.relIdx < i && !has(r.id, f)));
    while (items.length < target && pool.length) {
      const f = pool.pop();
      const kind = S.chance(0.6) ? 'improved' : 'fixed';
      items.push({ feature: f.id, kind, note: S.pick(C.releaseNotes[kind]) });
    }
  });
  const KIND = { new: 0, improved: 1, fixed: 2 };
  for (const items of releaseItems.values()) items.sort((a, b) => KIND[a.kind] - KIND[b.kind] || byId.get(a.feature).idx - byId.get(b.feature).idx);
}
const latestShipped = (f) => {
  let out = null;
  for (const r of SHIPPED) for (const it of releaseItems.get(r.id)) if (it.feature === f.id) out = { r, kind: it.kind };
  return out;
};

// ── Ledger ────────────────────────────────────────────────────────────────────────────────────

const OPS_PEOPLE = PEOPLE.filter((p) => p.role === 'operations').map((p) => p.id);
const REPORT_DAY = { shopper: '2026-10-05', checkout: '2026-10-06', payments: '2026-10-06', fulfillment: '2026-10-07', merchant: '2026-10-02', platform: '2026-10-05' };
const LENS_OF_KIND = { perf: 'ops', security: 'sec', compliance: 'comp', ux: 'ux', cost: 'cost', bug: 'dev', refactor: 'dev', feature: null };
const LENS_OF_ACTIVITY = { perf: 'ops', security: 'sec', refactor: 'dev', test: 'dev', fix: null, implement: null, docs: null };

function testResult(d) {
  if (d.bugs.critical > 0) return 'fail';
  return d.coverage < 60 || d.quality === 'D' || d.quality === 'E' ? 'warn' : 'pass';
}
function monitorResult(o) {
  if (!o.monitored) return 'warn';
  if (o.uptime < 99 || o.errorRate >= 2) return 'fail';
  return o.uptime < 99.9 || o.errorRate >= 1 || o.p95 > o.sloP95 ? 'warn' : 'pass';
}
function scanResult(s) {
  if (s.vulns.critical > 0 || s.secretsClean === false) return 'fail';
  return s.vulns.high > 0 ? 'warn' : 'pass';
}
function compResult(c) {
  if (c.findings >= 3) return 'fail';
  return c.findings > 0 || c.coverage < 80 ? 'warn' : 'pass';
}
function uxResult(u) {
  if (u.a11y < 60) return 'fail';
  return u.a11y < 80 || u.debt >= 4 ? 'warn' : 'pass';
}
function costResult(c) {
  const r = c.monthly / c.budget;
  if (r > 1.15) return 'fail';
  return r > 1 || c.trend > 25 ? 'warn' : 'pass';
}

const devSummary = (d) => {
  const b = d.bugs;
  const bugs = b.critical ? plural(b.critical, 'critical bug') : b.major ? plural(b.major, 'major bug') : b.minor ? plural(b.minor, 'minor bug') : 'no open bugs';
  return `Quality ${d.quality}, ${d.coverage}% coverage, ${bugs}`;
};
const opsSummary = (o) => (o.monitored ? `${round2(o.uptime)}% uptime, ${round2(o.errorRate)}% errors, p95 ${o.p95} ms (SLO ${o.sloP95})` : 'No monitors: uptime and errors unknown');
const secSummary = (s) => `${s.vulns.critical} critical, ${s.vulns.high} high, ${s.vulns.medium} medium, secrets ${s.secretsClean ? 'clean' : 'exposed'}`;
const compSummary = (c, planned) => `${c.regimes.join(', ')}${planned ? ' design review' : ''}: ${c.coverage}% covered, ${plural(c.findings, 'finding')}`;
const uxSummary = (u) => `WCAG ${u.a11y}, ${u.usability ? `usability ${u.usability}/5` : 'usability untested'}, ${plural(u.debt, 'UX debt item')}`;
const costSummary = (c) => `${money(c.monthly)}/mo, ${Math.round((c.monthly / c.budget) * 100)}% of budget, ${c.trend > 0 ? '+' : ''}${c.trend}% in 30 days`;

const allEntries = [];
const LEDGER_TARGET = 2530;
{
  const plans = [];
  for (const f of F) {
    const S = stream('ledger:' + f.id);
    const at = (date, kind) => {
      const hh = kind === 'human' ? S.int(8, 18) : kind === 'night' ? S.int(1, 4) : S.int(6, 21);
      return `${date}T${pad2(hh)}:${pad2(S.int(0, 59))}:00Z`;
    };
    const must = [];
    const opt = [];
    const E = (list, date, timeKind, actor, actorKind, action, lens, result, summary, ref) => {
      list.push({ id: null, at: at(maxDate(date, f.createdAt), timeKind), actor, actorKind, action, lens, result, summary, ref, hash: null });
    };
    const builderActor = (b) => (b.crew ? [b.crew, 'agent'] : [b.author, 'human']);
    const m = f.metrics;
    const live = f.status === 'live';
    const testDate = addDays(ASOF, -Math.min(diffDays(f.createdAt, ASOF), live ? S.int(1, 18) : S.int(0, 8)));

    if (live) {
      const lr = latestShipped(f);
      E(must, lr.r.date, 'human', OPS_PEOPLE[relIdx.get(lr.r.id) % OPS_PEOPLE.length], 'human', 'release', null, 'pass',
        `Shipped in v${lr.r.id}${lr.kind === 'new' ? '' : ` (${lr.kind})`}`, `v${lr.r.id}`);
      const hotfix = lr.r.id === SHIPPED[LAST].id && S.chance(0.3) ? S.pick(PATCHES) : null;
      if (hotfix) E(must, hotfix[1], 'system', 'deploy', 'system', 'deploy', null, 'pass', `Hotfix ${hotfix[0]} to production`, `dep/${S.int(4100, 4999)}`);
      else must.push({ id: null, at: `${lr.r.date}T${pad2(S.int(6, 7))}:${pad2(S.int(0, 59))}:00Z`, actor: 'deploy', actorKind: 'system', action: 'deploy', lens: null, result: 'pass', summary: `v${lr.r.id} to production`, ref: `dep/${S.int(1000, 4099)}`, hash: null });
    }
    if (m.dev) E(must, testDate, 'system', 'ci', 'system', 'test', 'dev', testResult(m.dev), devSummary(m.dev), `ci/${S.int(40000, 69999)}`);
    if (m.ops) E(must, REPORT_DAY[f.owner], 'system', 'slo', 'system', 'monitor', 'ops', monitorResult(m.ops), opsSummary(m.ops), 'slo/w40');
    if (m.sec && m.sec.lastScan) E(must, m.sec.lastScan, 'night', 'sast', 'system', 'scan', 'sec', scanResult(m.sec), secSummary(m.sec), `sast/${S.int(70000, 89999)}`);
    if (m.comp && m.comp.coverage > 0) E(must, f._compAudit, 'night', 'compscan', 'system', 'audit', 'comp', compResult(m.comp), compSummary(m.comp, f.status === 'planned'), `aud/${S.int(2000, 2999)}`);
    if (m.ux) {
      const human = !!m.ux.usability && S.chance(0.3);
      E(must, f._uxAudit, human ? 'human' : 'night', human ? choosePerson(S, f.owner, ['design']) : 'a11yscan', human ? 'human' : 'system', 'audit', 'ux', uxResult(m.ux), uxSummary(m.ux), `a11y/${S.int(500, 999)}`);
    }
    if (m.cost) E(must, '2026-10-01', 'system', 'costs', 'system', 'cost', 'cost', costResult(m.cost), costSummary(m.cost), 'bill/2026-09');

    // Optional entries, tagged by how useful they are as evidence.
    const tagged = (t) => { opt[opt.length - 1]._t = t; };
    for (const w of f.workItems) {
      if (w.kind === 'perf' && w.source === 'scan' && w.state === 'triage') { E(opt, w.createdAt, 'night', 'perfscan', 'system', 'scan', 'ops', 'warn', w.title, w.sourceRef); tagged('triage'); }
    }
    for (const b of f.branches) {
      const [actor, kind] = builderActor(b);
      const lens = LENS_OF_ACTIVITY[b.activity] || LENS_OF_KIND[b.workItem.kind] || null;
      if (b.state === 'awaiting-approval' || b.state === 'changes-requested') {
        E(opt, b.state === 'changes-requested' ? addDays(b.updatedAt, -S.int(0, 1)) : b.updatedAt, kind === 'human' ? 'human' : 'system', actor, kind, b.evidence.kind, lens, 'info', b.evidence.title, b.evidence.ref);
        tagged(b.state === 'awaiting-approval' ? 'gate' : 'evidence');
      }
      if (b.state === 'changes-requested') { E(opt, b.updatedAt, 'human', b.reviewer, 'human', 'request-changes', lens, 'warn', b.note, b.id); tagged('gate'); }
    }
    if (m.ops && m.ops.monitored && (m.ops.uptime < 99.2 || m.ops.errorRate >= 2)) {
      E(opt, addDays(ASOF, -S.int(3, 28)), 'human', S.pick(OPS_PEOPLE), 'human', 'incident', 'ops', 'fail', S.pick(C.incidents), `inc/${S.int(300, 499)}`);
      tagged('evidence');
    }
    for (const b of f.branches) {
      if (b.state !== 'merged' && b.state !== 'approved') continue;
      const lens = LENS_OF_ACTIVITY[b.activity] || LENS_OF_KIND[b.workItem.kind] || null;
      const [actor, kind] = builderActor(b);
      E(opt, addDays(b.updatedAt, b.state === 'merged' ? -S.int(0, 2) : 0), 'human', b.reviewer, 'human', 'approve', lens, 'pass', `Approved after ${b.evidence.kind}`, b.id);
      tagged('approve');
      if (b.state === 'merged') { E(opt, b.updatedAt, kind === 'human' ? 'human' : 'system', actor, kind, 'merge', lens, 'pass', 'Merged to main', b.id); tagged('history'); }
      E(opt, addDays(b.updatedAt, -S.int(0, 2)), kind === 'human' ? 'human' : 'system', actor, kind, b.evidence.kind, lens, 'info', b.evidence.title, b.evidence.ref);
      tagged('evidence');
    }
    for (const w of f.workItems) {
      if (w.source === 'scan' && w.triagedBy) {
        E(opt, minDate(ASOF, addDays(w.createdAt, S.int(0, 2))), 'human', w.triagedBy, 'human', 'triage', LENS_OF_KIND[w.kind], 'info',
          `${w.state === 'dismissed' ? 'Dismissed' : 'Queued'}: ${w.title}`, w.id);
        tagged('triage');
      }
    }
    for (const b of f.branches) {
      if (b.state === 'abandoned') continue;
      const [actor, kind] = builderActor(b);
      E(opt, b.openedAt, kind === 'human' ? 'human' : 'system', actor, kind, 'branch', null, 'info', 'Opened branch', b.id);
      tagged('branch');
      if (b.state === 'running') {
        E(opt, b.updatedAt, kind === 'human' ? 'human' : 'system', actor, kind, 'commit', null, b.checks.tests === 'fail' ? 'fail' : 'info', `Pushed ${plural(S.int(1, 9), 'commit')}`, b.id);
        tagged('commit');
      }
    }
    for (const w of f.workItems) {
      if (w.source === 'goal') E(opt, w.createdAt, 'human', w._goalBy, 'human', 'goal', null, 'info', `Goal: ${w.title}`, w.sourceRef);
      else if (w.source === 'ticket') E(opt, w.createdAt, 'system', 'tickets', 'system', 'ticket', null, 'info', `Synced: ${w.title}`, w.sourceRef);
      else continue;
      tagged('intake');
    }

    // Base ledger: the evidence behind every metric (planned features: their intake). Extras are added below.
    const RANK = ['gate', 'approve', 'evidence', 'triage', 'intake', 'history', 'branch', 'commit'];
    const sorted = opt.map((e, i) => [e, i]).sort((a, b) => RANK.indexOf(a[0]._t) - RANK.indexOf(b[0]._t) || a[1] - b[1]).map((x) => x[0]);
    let base;
    let cap;
    if (f.status === 'planned') {
      const intake = sorted.filter((e) => e._t === 'intake').slice(0, 1);
      const spike = sorted.filter((e) => e._t === 'branch').slice(0, 1);
      base = intake.concat(must, spike).slice(0, 3);
      cap = base.length;
    } else {
      cap = live ? 10 : f.status === 'blocked' ? 5 : 8;
      // Every open gate's demo or report and every change request is required evidence, like the metrics.
      const gates = sorted.filter((e) => e._t === 'gate');
      base = must.concat(gates).slice(0, Math.max(cap, must.length + gates.length));
      if (!base.length) base = sorted.slice(0, 1);
    }
    plans.push({ f, list: base, extras: sorted.filter((e) => !base.includes(e)), cap });
  }
  // Add extras tier by tier (gate evidence first) until the product ledger reaches its target size.
  const fillS = stream('ledger-fill');
  let total = plans.reduce((n, p) => n + p.list.length, 0);
  const order = fillS.shuffle(plans);
  for (const tier of ['gate', 'approve', 'evidence', 'triage', 'intake', 'history', 'branch', 'commit']) {
    for (const p of order) {
      if (total >= LEDGER_TARGET) break;
      for (const e of p.extras.filter((x) => x._t === tier)) {
        if (total >= LEDGER_TARGET || p.list.length >= p.cap) break;
        p.list.push(e);
        p.extras.splice(p.extras.indexOf(e), 1);
        total += 1;
      }
    }
  }
  for (const p of plans) {
    p.list.forEach((e, i) => { e._f = p.f; e._i = i; });
    p.f.ledger = p.list;
    allEntries.push(...p.list);
  }
  // Ids run in time order across the product; each feature's ledger is newest first.
  allEntries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a._f.idx - b._f.idx || a._i - b._i));
  allEntries.forEach((e, i) => {
    e.id = 'ev-' + String(i + 1).padStart(5, '0');
    e.hash = fnv1a(`${e.id}|${e.at}|${e.actor}|${e.action}|${e.summary}`).toString(16).padStart(8, '0').slice(0, 7);
  });
  for (const f of F) {
    f.ledger.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : a.id > b.id ? -1 : 1));
    f.updatedAt = f.ledger.length ? f.ledger[0].at.slice(0, 10) : f.createdAt;
  }
}

// ── Initiatives ───────────────────────────────────────────────────────────────────────────────

const coverage = new Map(C.initiatives.map((i) => [i.id, []]));
{
  const S = stream('coverage');
  const add = (id, f, state, note) => coverage.get(id).push(note ? { feature: f.id, state, note } : { feature: f.id, state });
  const openOf = (f, ini) => f.workItems.filter((w) => w.initiative === ini && OPEN.includes(w.state));
  for (const f of F) {
    const c = f.metrics.comp;
    if (c) {
      if (c.findings > 0) add(INI.comp, f, 'finding');
      else if (c.coverage >= 90) add(INI.comp, f, 'covered');
      else if (c.coverage > 0) add(INI.comp, f, 'in-progress');
      else add(INI.comp, f, 'pending', f.status === 'planned' ? 'Design review not started' : 'Not scanned yet');
    }
    if (f.metrics.ux && (f.status === 'live' || f.status === 'ready' || openOf(f, INI.a11y).length)) {
      const open = openOf(f, INI.a11y);
      if (open.length) add(INI.a11y, f, 'finding', open[0].title);
      else add(INI.a11y, f, f.status === 'live' ? 'covered' : 'in-progress');
    }
    if (f._refactor) {
      if (f.status === 'building') add(INI.refactor, f, 'covered', 'Built on the new payments core');
      else if (f._refactor === 'covered') add(INI.refactor, f, 'covered');
      else if (f._refactor === 'pending') add(INI.refactor, f, 'pending');
      else add(INI.refactor, f, 'in-progress');
    }
    if (f._perfScanned != null) {
      const items = f.workItems.filter((w) => w.initiative === INI.perf);
      if (items.some((w) => OPEN.includes(w.state))) add(INI.perf, f, 'finding', items.find((w) => OPEN.includes(w.state)).title);
      else if (items.length) add(INI.perf, f, 'covered', 'Finding dismissed at triage');
      else if (f._perfScanned) add(INI.perf, f, 'covered');
      else add(INI.perf, f, 'pending');
    }
    if (f._node) add(INI.node, f, f._node);
    if (f.metrics.cost) {
      const items = f.workItems.filter((w) => w.initiative === INI.cost && OPEN.includes(w.state));
      if (items.length) add(INI.cost, f, ['in-progress', 'review'].includes(items[0].state) ? 'in-progress' : 'finding', items[0].title);
    }
  }
}

// ── Output ────────────────────────────────────────────────────────────────────────────────────

const out = {
  meta: { schemaVersion: '0.2', asOf: ASOF },
  product: C.product,
  areas: C.areas.map(({ id, name, summary }) => ({ id, name, summary })),
  domains: C.domains.map(({ id, areaId, code, name, summary }) => ({ id, areaId, code, name, summary })),
  modules: C.modules.map((m) => ({
    id: m.id, domainId: m.domainId, name: m.name, summary: m.summary, owner: m.owner,
    surfaces: SURF_ORDER.filter((s) => F.some((f) => f.moduleId === m.id && f.surfaces.includes(s))),
  })),
  teams: C.teams,
  people: C.people,
  systems: C.systems,
  releases: REL.map((r, i) => ({
    id: r.id, label: 'v' + r.id, date: r.date, state: i <= LAST ? 'shipped' : i === LAST + 1 ? 'next' : 'future',
    name: r.name, summary: r.summary, items: releaseItems.get(r.id),
  })),
  initiatives: C.initiatives.map((i) => ({ ...i, coverage: coverage.get(i.id) })),
  features: F.map((f) => {
    const o = {
      id: f.id, moduleId: f.moduleId, name: f.name, summary: f.summary, status: f.status, priority: f.priority, release: f.release ?? null,
      owner: f.owner, builtBy: f.builtBy, surfaces: f.surfaces, progress: f.progress, createdAt: f.createdAt, updatedAt: f.updatedAt,
      dependsOn: f.dependsOn, metrics: f.metrics,
    };
    if (f.blockedReason) o.blockedReason = f.blockedReason;
    if (f.note) o.note = f.note;
    o.workItems = f.workItems.map((w) => ({
      id: w.id, title: w.title, source: w.source, sourceRef: w.sourceRef, kind: w.kind, state: w.state, priority: w.priority,
      createdAt: w.createdAt, triagedBy: w.triagedBy, initiative: w.initiative,
    }));
    o.branches = f.branches.map((b) => ({
      id: b.id, workItem: b.workItem.id, crew: b.crew, author: b.author, activity: b.activity, state: b.state,
      openedAt: b.openedAt, updatedAt: b.updatedAt, checks: b.checks, evidence: b.evidence, reviewer: b.reviewer, note: b.note,
    }));
    o.ledger = f.ledger.map((e) => ({
      id: e.id, at: e.at, actor: e.actor, actorKind: e.actorKind, action: e.action, lens: e.lens, result: e.result,
      summary: e.summary, ref: e.ref, hash: e.hash,
    }));
    return o;
  }),
};

/** Compact JS literal: unquoted keys where possible, JSON strings. */
function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(lit).join(',') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).map((k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ':' + lit(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

const lines = [
  '// GENERATED FILE: do not edit by hand. Mock product data for App Blueprint round 2 (schema v0.2).',
  '// Source: scripts/data-v2/catalog.mjs, generated by scripts/data-v2/generate.mjs (seed ' + SEED + ').',
  '// Regenerate and check: node scripts/data-v2/generate.mjs && node scripts/data-v2/validate.mjs',
  'window.BLUEPRINT = {',
];
for (const key of ['meta', 'product']) lines.push(`${key}:${lit(out[key])},`);
for (const key of ['areas', 'domains', 'modules', 'teams', 'people', 'systems']) {
  lines.push(`${key}:[`);
  out[key].forEach((x) => lines.push(lit(x) + ','));
  lines.push('],');
}
lines.push('releases:[');
for (const r of out.releases) {
  const { items, ...head } = r;
  lines.push(lit(head).slice(0, -1) + ',items:[');
  items.forEach((it) => lines.push(lit(it) + ','));
  lines.push(']},');
}
lines.push('],');
lines.push('initiatives:[');
for (const ini of out.initiatives) {
  const { coverage: cov, ...head } = ini;
  lines.push(lit(head).slice(0, -1) + ',coverage:[');
  cov.forEach((c) => lines.push(lit(c) + ','));
  lines.push(']},');
}
lines.push('],');
lines.push('features:[');
for (const f of out.features) {
  const { workItems, branches, ledger, ...head } = f;
  let cur = lit(head).slice(0, -1);
  for (const [key, list] of [['workItems', workItems], ['branches', branches], ['ledger', ledger]]) {
    if (!list.length) { cur += `,${key}:[]`; continue; }
    lines.push(cur + `,${key}:[`);
    list.forEach((x) => lines.push(lit(x) + ','));
    cur = ']';
  }
  lines.push(cur + '},');
}
lines.push('],');
lines.push('};');
const text = lines.join('\n') + '\n';
const file = path.join(ROOT, OUT_REL);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, text);

const count = (pred) => F.filter(pred).length;
console.log(`Wrote ${OUT_REL}: ${F.length} features (${['live', 'ready', 'building', 'planned', 'blocked'].map((s) => `${s} ${count((f) => f.status === s)}`).join(', ')}), ` +
  `${F.reduce((n, f) => n + f.workItems.length, 0)} work items, ${F.reduce((n, f) => n + f.branches.length, 0)} branches, ${allEntries.length} ledger entries, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB.`);
