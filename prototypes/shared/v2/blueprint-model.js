// App Blueprint model v0.2: ratings, rollups, gates, filters and timeline helpers that every round 2 page shares.
// Classic script (ES2019, no dependencies). Load it after blueprint-data.js. It reads window.BLUEPRINT,
// never mutates it, and assigns window.BP. Spec: docs/data-model-v2.md ("window.BP (v0.2)").
// Every function that takes a feature (or area, domain, module, release, initiative) accepts the object or its id.
// Derived values are memoised; treat everything returned as read-only.
(function () {
  'use strict';

  const data = window.BLUEPRINT;
  if (!data || !Array.isArray(data.features)) {
    throw new Error('blueprint-model.js: window.BLUEPRINT is missing. Load blueprint-data.js first.');
  }

  const ASOF = (data.meta && data.meta.asOf) || '2026-10-08';

  // ── Definitions ────────────────────────────────────────────────────────────────────────────

  const LENSES = [
    { id: 'overall', label: 'Overall', short: 'Overall', group: 'role', question: 'Is it healthy?' },
    { id: 'dev', label: 'Development', short: 'Dev', group: 'role', question: 'Is the code healthy?' },
    { id: 'ops', label: 'Operations', short: 'Ops', group: 'role', question: 'Is it running well in production?' },
    { id: 'biz', label: 'Business', short: 'Biz', group: 'role', question: 'Is it delivering without open asks?' },
    { id: 'sec', label: 'Security', short: 'Sec', group: 'specialist', question: 'Is it safe?' },
    { id: 'comp', label: 'Compliance', short: 'Comp', group: 'specialist', question: 'Is it covered by compliance scans?' },
    { id: 'ux', label: 'UX', short: 'UX', group: 'specialist', question: 'Is it usable and accessible?' },
    { id: 'cost', label: 'Cost', short: 'Cost', group: 'specialist', question: 'Is it within budget?' },
  ];
  const LENS_IDS = LENSES.map((l) => l.id);
  const LENS_LABEL = new Map(LENSES.map((l) => [l.id, l.label]));

  const STATUSES = [
    { id: 'live', label: 'Live', description: 'In production and in use.' },
    { id: 'ready', label: 'Ready', description: 'Built and approved, waiting for the next release.' },
    { id: 'building', label: 'In build', description: 'Being built in one or more branches.' },
    { id: 'planned', label: 'Planned', description: 'Scoped but not started.' },
    { id: 'blocked', label: 'Blocked', description: 'Cannot progress until something outside the team changes.' },
  ];
  const STATUS_ORDER = STATUSES.map((s) => s.id);

  const BANDS = [
    { id: 'good', label: 'Good', min: 0.8 },
    { id: 'fair', label: 'Fair', min: 0.6 },
    { id: 'poor', label: 'Poor', min: 0.4 },
    { id: 'critical', label: 'Critical', min: 0 },
    { id: 'na', label: 'Not applicable', min: null },
  ];
  const BAND_IDS = BANDS.map((b) => b.id);

  const BUILDERS = ['agent', 'pair', 'human'];
  const GATE_KINDS = ['triage', 'approval', 'changes'];
  const OPEN_STATES = ['triage', 'backlog', 'in-progress', 'review'];
  const UI_SURFACES = ['web', 'admin', 'mobile'];
  const WEIGHTS = { dev: 0.2, ops: 0.2, biz: 0.15, sec: 0.2, comp: 0.1, ux: 0.1, cost: 0.05 };
  const LIVE_LENSES = ['dev', 'ops', 'biz', 'sec', 'comp', 'ux', 'cost'];
  const READY_LENSES = ['dev', 'sec', 'comp', 'ux'];
  const QUALITY = { A: 1, B: 0.85, C: 0.65, D: 0.45, E: 0.25 };

  // ── Small helpers ──────────────────────────────────────────────────────────────────────────

  /** Returns the value as an array (null and undefined become []). */
  function arr(x) {
    return Array.isArray(x) ? x : [];
  }

  /** Clamps x to [lo, hi] (default [0, 1]). */
  function clamp(x, lo, hi) {
    const a = lo == null ? 0 : lo;
    const b = hi == null ? 1 : hi;
    return Math.min(b, Math.max(a, x));
  }

  /** Piecewise-linear interpolation through [x, y] points (ascending x), clamped at both ends. */
  function pw(x, points) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      if (x <= p1[0]) return p0[1] + ((x - p0[0]) / (p1[0] - p0[0])) * (p1[1] - p0[1]);
    }
    return points[points.length - 1][1];
  }

  /** Rounds a score to 4 decimals; every lens score and rollup score is rounded this way. */
  function round4(x) {
    return Math.round(x * 10000) / 10000;
  }

  /** Days from date a to date b ('YYYY-MM-DD' or ISO timestamps; time of day is ignored). */
  function daysBetween(a, b) {
    const p = (s) => {
      const m = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(m[0], m[1] - 1, m[2]) / 86400000;
    };
    return Math.round(p(b) - p(a));
  }

  /** Days from a date to the dataset's asOf date, never negative. */
  function daysSince(date) {
    return Math.max(0, daysBetween(date, ASOF));
  }

  /** "today", "1 day ago", "12 days ago". */
  function ago(days) {
    if (days <= 0) return 'today';
    return days === 1 ? '1 day ago' : days + ' days ago';
  }

  /** "1 major bug", "3 major bugs". */
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many || one + 's');
  }

  /** Formats a number with at most two decimals and no trailing zeros. */
  function num2(x) {
    return String(Number(Number(x).toFixed(2)));
  }

  /**
   * A 0–1 score as the 0–100 points every page shows ("79" for 0.7963). It rounds down, so the
   * number never crosses into a better band than the score has (0.7999 shows 79, which is fair).
   */
  function pts(x) {
    return String(Math.floor(x * 100 + 1e-9));
  }

  /** "180 ms", "1.2 s", "10 s": latencies of a second or more read in seconds. */
  function msText(n) {
    if (n >= 10000) return Math.round(n / 1000) + ' s';
    if (n >= 1000) return Math.round(n / 100) / 10 + ' s';
    return n + ' ms';
  }

  /** "$12,400" for whole US dollars. */
  function money(n) {
    const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-$' : '$') + s;
  }

  /** True for Set-like values (duck-typed, so Sets from another frame work too). */
  function isSetLike(v) {
    return v != null && typeof v === 'object' && typeof v.has === 'function' && typeof v.size === 'number';
  }

  /** True when a filter value (array, Set or single value) is non-empty. */
  function hasValues(v) {
    if (v == null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (isSetLike(v)) return v.size > 0;
    return true;
  }

  /** True when a filter value (array, Set or single value) contains x. */
  function includes(v, x) {
    if (Array.isArray(v)) return v.indexOf(x) !== -1;
    if (isSetLike(v)) return v.has(x);
    return v === x;
  }

  // ── Indexes ────────────────────────────────────────────────────────────────────────────────

  /** Builds an id → item Map for a list. */
  function indexById(list) {
    const map = new Map();
    arr(list).forEach((item) => map.set(item.id, item));
    return map;
  }

  /** Groups a list into key → items, keeping display order inside each group. */
  function groupBy(list, key) {
    const map = new Map();
    arr(list).forEach((item) => {
      const k = item[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return map;
  }

  const areaById = indexById(data.areas);
  const domainById = indexById(data.domains);
  const moduleById = indexById(data.modules);
  const featureById = indexById(data.features);
  const teamById = indexById(data.teams);
  const personById = indexById(data.people);
  const releaseById = indexById(data.releases);
  const initiativeById = indexById(data.initiatives);
  const systemById = indexById(data.systems);

  const domainsByArea = groupBy(data.domains, 'areaId');
  const modulesByDomain = groupBy(data.modules, 'domainId');
  const featuresByModule = groupBy(data.features, 'moduleId');
  const featuresByDomain = new Map();
  const featuresByArea = new Map();
  arr(data.areas).forEach((a) => featuresByArea.set(a.id, []));
  arr(data.domains).forEach((d) => {
    const list = [];
    arr(modulesByDomain.get(d.id)).forEach((m) => list.push.apply(list, arr(featuresByModule.get(m.id))));
    featuresByDomain.set(d.id, list);
    if (!featuresByArea.has(d.areaId)) featuresByArea.set(d.areaId, []);
    featuresByArea.get(d.areaId).push.apply(featuresByArea.get(d.areaId), list);
  });

  const dependentsById = new Map();
  data.features.forEach((f) => {
    arr(f.dependsOn).forEach((depId) => {
      if (!dependentsById.has(depId)) dependentsById.set(depId, []);
      dependentsById.get(depId).push(f);
    });
  });

  const RELEASES_IN_ORDER = arr(data.releases)
    .map((r, i) => [r, i])
    .sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]))
    .map((x) => x[0]);
  const featureReleaseIndex = new Map();
  RELEASES_IN_ORDER.forEach((r) => {
    arr(r.items).forEach((it) => {
      if (!featureReleaseIndex.has(it.feature)) featureReleaseIndex.set(it.feature, []);
      featureReleaseIndex.get(it.feature).push({ release: r, kind: it.kind, note: it.note == null ? null : it.note });
    });
  });

  const initiativeIndex = new Map(); // featureId → [{ initiative, state, note }]
  const initiativeStateIndex = new Map(); // initiativeId → Map(featureId → state)
  arr(data.initiatives).forEach((ini) => {
    const states = new Map();
    initiativeStateIndex.set(ini.id, states);
    arr(ini.coverage).forEach((c) => {
      states.set(c.feature, c.state);
      if (!initiativeIndex.has(c.feature)) initiativeIndex.set(c.feature, []);
      initiativeIndex.get(c.feature).push({ initiative: ini, state: c.state, note: c.note == null ? null : c.note });
    });
  });

  // ── Lookups ────────────────────────────────────────────────────────────────────────────────

  /** Resolves an object or id against an index; unknown ids give null, objects pass through. */
  function lookup(map, x) {
    if (x == null) return null;
    if (typeof x === 'object') return map.get(x.id) || x;
    return map.get(x) || null;
  }

  /** Returns the id of an object, or the value itself when it is already an id. */
  function idOf(x) {
    return x != null && typeof x === 'object' ? x.id : x;
  }

  /** Resolves a feature object or feature id to the feature object (null when unknown). */
  function asFeature(x) {
    if (x == null) return null;
    if (typeof x === 'object') return x;
    return featureById.get(x) || null;
  }

  /** Resolves a list of features or ids to feature objects, dropping unknown ids. */
  function asFeatures(list) {
    const out = [];
    arr(list).forEach((x) => {
      const f = asFeature(x);
      if (f) out.push(f);
    });
    return out;
  }

  /** Area by id. */
  function area(id) { return lookup(areaById, id); }
  /** Domain by id. */
  function domain(id) { return lookup(domainById, id); }
  /** Module by id. */
  function module(id) { return lookup(moduleById, id); }
  /** Feature by id (or the feature object itself). */
  function feature(id) { return asFeature(id); }
  /** Team (human squad or agent crew) by id. */
  function team(id) { return lookup(teamById, id); }
  /** Person by id. */
  function person(id) { return lookup(personById, id); }
  /** Release by id ('1.11'). */
  function release(id) { return lookup(releaseById, id); }
  /** Initiative by id. */
  function initiative(id) { return lookup(initiativeById, id); }
  /** Automated system (CI, scanners, monitors) by id. */
  function system(id) { return lookup(systemById, id); }
  /** Whoever a ledger entry names: a person, a team (squad or agent crew) or a system; null when unknown. */
  function actor(id) { return person(id) || team(id) || system(id); }

  /** Domains of an area, in display order. */
  function domainsOf(areaId) { return arr(domainsByArea.get(idOf(areaId))).slice(); }
  /** Modules of a domain, in display order. */
  function modulesOf(domainId) { return arr(modulesByDomain.get(idOf(domainId))).slice(); }
  /** Features of a module, in display order. */
  function featuresOf(moduleId) { return arr(featuresByModule.get(idOf(moduleId))).slice(); }
  /** Features of a domain, in display order. */
  function featuresOfDomain(domainId) { return arr(featuresByDomain.get(idOf(domainId))).slice(); }
  /** Features of an area, in display order. */
  function featuresOfArea(areaId) { return arr(featuresByArea.get(idOf(areaId))).slice(); }

  /** { area, domain, module } objects for a feature (null members when unknown). */
  function pathOf(featureOrId) {
    const f = asFeature(featureOrId);
    const m = f ? moduleById.get(f.moduleId) || null : null;
    const d = m ? domainById.get(m.domainId) || null : null;
    const a = d ? areaById.get(d.areaId) || null : null;
    return { area: a, domain: d, module: m };
  }

  /** Release label for an id ("v1.12"), falling back to "v" + id. */
  function releaseLabel(id) {
    const r = releaseById.get(id);
    return r ? r.label : 'v' + id;
  }

  // ── Gates and backlog ──────────────────────────────────────────────────────────────────────

  const gateMemo = new WeakMap();

  /**
   * Human gates waiting on a feature: work items in triage, branches awaiting approval and branches
   * with changes requested. Each is { kind, id, title, since, waitingDays, ref, feature, workItem, branch },
   * longest wait first.
   */
  function gates(featureOrId) {
    const f = asFeature(featureOrId);
    if (!f) return [];
    if (gateMemo.has(f)) return gateMemo.get(f).slice();
    const items = new Map(arr(f.workItems).map((w) => [w.id, w]));
    const out = [];
    arr(f.workItems).forEach((w) => {
      if (w.state !== 'triage') return;
      out.push({ kind: 'triage', id: w.id, title: w.title, since: w.createdAt, waitingDays: daysSince(w.createdAt), ref: w.sourceRef, feature: f.id, workItem: w.id, branch: null });
    });
    arr(f.branches).forEach((b) => {
      const w = items.get(b.workItem);
      if (b.state === 'awaiting-approval') {
        out.push({
          kind: 'approval', id: b.id, title: (b.evidence && b.evidence.title) || (w && w.title) || b.id,
          since: b.updatedAt, waitingDays: daysSince(b.updatedAt), ref: b.id, feature: f.id, workItem: b.workItem, branch: b.id,
        });
      } else if (b.state === 'changes-requested') {
        out.push({
          kind: 'changes', id: b.id, title: (w && w.title) || b.id,
          since: b.updatedAt, waitingDays: daysSince(b.updatedAt), ref: b.id, feature: f.id, workItem: b.workItem, branch: b.id,
        });
      }
    });
    out.sort((a, b) => b.waitingDays - a.waitingDays || GATE_KINDS.indexOf(a.kind) - GATE_KINDS.indexOf(b.kind) || (a.id < b.id ? -1 : 1));
    gateMemo.set(f, out);
    return out.slice();
  }

  const backlogMemo = new WeakMap();

  /** Open work items (triage, backlog, in progress or in review), in data order. */
  function openBacklog(featureOrId) {
    const f = asFeature(featureOrId);
    if (!f) return [];
    if (!backlogMemo.has(f)) backlogMemo.set(f, arr(f.workItems).filter((w) => OPEN_STATES.indexOf(w.state) !== -1));
    return backlogMemo.get(f).slice();
  }

  // ── Ratings ────────────────────────────────────────────────────────────────────────────────

  /** Band id for a score: good ≥ .8, fair ≥ .6, poor ≥ .4, critical below, na when there is no score. */
  function band(score) {
    if (typeof score !== 'number' || !isFinite(score)) return 'na';
    if (score >= 0.8) return 'good';
    if (score >= 0.6) return 'fair';
    if (score >= 0.4) return 'poor';
    return 'critical';
  }

  /** Builds a rating object; the score is rounded to 4 decimals before banding. */
  function make(lens, raw, headline, facts, reasons) {
    const score = round4(raw);
    return { lens, score, band: band(score), headline, facts: facts || [], reasons: reasons || [] };
  }

  /** A not-applicable rating with its reason as the headline. */
  function naRating(lens, why) {
    return { lens, score: null, band: 'na', headline: why, facts: [], reasons: [why] };
  }

  /** True when the feature has a web, admin or mobile surface. */
  function hasUi(f) {
    return arr(f.surfaces).some((s) => UI_SURFACES.indexOf(s) !== -1);
  }

  /** Why a lens does not apply to a feature, in plain words. */
  function naReason(f, lens) {
    if (lens === 'overall') return 'Not started · ' + (f.release ? 'planned for ' + releaseLabel(f.release) : 'unscheduled');
    if (lens === 'comp') return 'No regulated data';
    if (lens === 'ux' && !hasUi(f)) return 'No UI surface';
    if (f.status === 'planned') return 'Not started';
    if (lens === 'ops' || lens === 'biz' || lens === 'cost') {
      if (f.status === 'ready') return 'Not live yet: ships in ' + releaseLabel(f.release);
      if (f.status === 'building') return 'Not live yet: in build';
      if (f.status === 'blocked') return 'Not live yet: blocked';
    }
    return 'No data';
  }

  /** Development: code quality grade, test coverage and open bugs. */
  function rateDev(f, d) {
    const q = QUALITY[d.quality] != null ? QUALITY[d.quality] : 0.25;
    const cov = pw(d.coverage, [[0, 0], [40, 0.4], [60, 0.7], [85, 1]]);
    const b = d.bugs || {};
    const crit = b.critical || 0;
    const major = b.major || 0;
    const minor = b.minor || 0;
    const bug = clamp(1 - 0.45 * crit - 0.12 * major - 0.02 * minor);
    let s = 0.4 * q + 0.35 * cov + 0.25 * bug;
    const reasons = [];
    if (crit > 0) {
      s = Math.min(s, 0.38);
      reasons.push('Capped at 38: ' + plural(crit, 'critical bug') + ' open');
    }
    if (d.coverage < 60) reasons.push('Test coverage of ' + d.coverage + '% is below 60%');
    if (major > 0) reasons.push(plural(major, 'major bug') + ' open');
    const bugText = crit > 0 ? plural(crit, 'critical bug') : major > 0 ? plural(major, 'major bug') : minor > 0 ? plural(minor, 'minor bug') : 'no open bugs';
    return make('dev', s, 'Quality ' + d.quality + ' · ' + d.coverage + '% coverage · ' + bugText, [
      { label: 'Code quality', value: d.quality, band: band(q) },
      { label: 'Test coverage', value: d.coverage + '%', band: band(cov) },
      { label: 'Open bugs', value: crit + major + minor === 0 ? 'None' : [[crit, 'critical'], [major, 'major'], [minor, 'minor']].filter((x) => x[0] > 0).map((x) => x[0] + ' ' + x[1]).join(' · '), band: band(bug) },
    ], reasons);
  }

  /** Operations: monitoring, uptime, error rate and p95 latency against the SLO. */
  function rateOps(f, o) {
    if (!o.monitored) {
      const why = 'Not monitored: uptime and errors unknown';
      return make('ops', 0.5, why, [
        { label: 'Monitoring', value: 'None', band: 'poor' },
        { label: 'p95 SLO', value: msText(o.sloP95) },
      ], [why]);
    }
    const up = pw(o.uptime, [[98, 0.1], [99, 0.4], [99.5, 0.6], [99.9, 0.85], [99.95, 1]]);
    const err = pw(o.errorRate, [[0.1, 1], [0.5, 0.75], [1, 0.55], [2, 0.35], [5, 0.05]]);
    const lat = o.p95 <= o.sloP95 ? 1 : clamp(1 - (o.p95 / o.sloP95 - 1) * 1.2);
    const s = 0.4 * up + 0.35 * err + 0.25 * lat;
    const reasons = [];
    if (o.p95 > o.sloP95) reasons.push('p95 is ' + Math.round((o.p95 / o.sloP95 - 1) * 100) + '% over the ' + msText(o.sloP95) + ' SLO');
    if (o.uptime < 99.5) reasons.push('Uptime of ' + num2(o.uptime) + '% is below 99.5%');
    if (o.errorRate >= 1) reasons.push('Error rate of ' + num2(o.errorRate) + '% is at or above 1%');
    return make('ops', s, num2(o.uptime) + '% uptime · ' + num2(o.errorRate) + '% errors · p95 ' + msText(o.p95) + ' (SLO ' + msText(o.sloP95) + ')', [
      { label: 'Uptime', value: num2(o.uptime) + '%', band: band(up) },
      { label: 'Error rate', value: num2(o.errorRate) + '%', band: band(err) },
      { label: 'p95 latency', value: msText(o.p95) + ' of ' + msText(o.sloP95), band: band(lat) },
    ], reasons);
  }

  /** Business: open backlog against the live feature (adoption is shown but does not score). */
  function rateBiz(f, b) {
    const open = openBacklog(f);
    const n = open.length;
    const s = n === 0 ? 1 : n === 1 ? 0.85 : n === 2 ? 0.75 : n <= 4 ? 0.6 : n <= 7 ? 0.45 : 0.3;
    const triage = open.filter((w) => w.state === 'triage').length;
    const reasons = [];
    if (n > 0) reasons.push(plural(n, 'open backlog item') + (n === 1 ? ' lowers' : ' lower') + ' the score');
    if (triage > 0) reasons.push(triage + ' waiting for human triage');
    return make('biz', s, n === 0 ? 'No open backlog' : plural(n, 'open backlog item') + ' · ' + b.adoption + '% adoption', [
      { label: 'Open backlog', value: String(n), band: band(s) },
      { label: 'Adoption', value: b.adoption + '%' },
      { label: 'Satisfaction', value: b.satisfaction == null ? 'No survey' : num2(b.satisfaction) + '/5' },
    ], reasons);
  }

  /** Security: vulnerabilities, scan age and secrets hygiene. */
  function rateSec(f, s) {
    const v = s.vulns || {};
    const crit = v.critical || 0;
    const high = v.high || 0;
    const medium = v.medium || 0;
    const reasons = [];
    let score;
    let headline;
    let age = null;
    if (!s.lastScan) {
      score = 0.45;
      headline = 'Never scanned';
      reasons.push('Never scanned');
    } else {
      score = crit > 0 ? 0.2 : high > 0 ? Math.max(0.4, 0.55 - 0.05 * (high - 1)) : medium > 0 ? Math.max(0.65, 0.8 - 0.03 * (medium - 1)) : 1;
      age = daysSince(s.lastScan);
      if (age > 90) {
        if (score > 0.5) reasons.push('Capped at 50: last scan was ' + age + ' days ago');
        score = Math.min(score, 0.5);
      } else if (age > 30) {
        if (score > 0.7) reasons.push('Capped at 70: last scan was ' + age + ' days ago');
        score = Math.min(score, 0.7);
      }
      if (crit > 0) reasons.push(plural(crit, 'critical vulnerability', 'critical vulnerabilities') + ' open');
      else if (high > 0) reasons.push(plural(high, 'high vulnerability', 'high vulnerabilities') + ' open');
      headline = crit + ' critical · ' + high + ' high · scanned ' + ago(age);
    }
    if (s.secretsClean === false) {
      score = Math.min(score, 0.3);
      reasons.push('Capped at 30: secrets found in code or config');
    }
    return make('sec', score, headline, [
      { label: 'Critical', value: String(crit), band: crit > 0 ? 'critical' : 'good' },
      { label: 'High', value: String(high), band: high > 0 ? 'poor' : 'good' },
      { label: 'Medium', value: String(medium), band: medium > 0 ? 'fair' : 'good' },
      { label: 'Last scan', value: s.lastScan ? ago(age) : 'Never', band: !s.lastScan ? 'poor' : age > 90 ? 'poor' : age > 30 ? 'fair' : 'good' },
    ], reasons);
  }

  /** Compliance: scan coverage of the applicable regimes, discounted by open findings. */
  function rateComp(f, c) {
    const regimes = arr(c.regimes).join(' · ');
    if (!c.coverage) {
      return make('comp', 0.2, regimes + ' · not scanned', [
        { label: 'Regimes', value: regimes },
        { label: 'Scan coverage', value: '0%', band: 'critical' },
      ], ['Not scanned']);
    }
    const s = (c.coverage / 100) * (1 - Math.min(0.6, 0.15 * c.findings));
    const reasons = [];
    if (c.findings > 0) reasons.push(plural(c.findings, 'open finding') + (c.findings === 1 ? ' reduces' : ' reduce') + ' the score by ' + Math.round(Math.min(0.6, 0.15 * c.findings) * 100) + '%');
    if (c.coverage < 90) reasons.push(c.coverage + '% of controls scanned');
    return make('comp', s, regimes + ' · ' + c.coverage + '% scanned · ' + (c.findings ? plural(c.findings, 'finding') : 'no findings'), [
      { label: 'Regimes', value: regimes },
      { label: 'Scan coverage', value: c.coverage + '%', band: band(c.coverage / 100) },
      { label: 'Findings', value: String(c.findings), band: c.findings === 0 ? 'good' : c.findings === 1 ? 'fair' : 'poor' },
    ], reasons);
  }

  /** UX: accessibility score, usability study result and UX debt. */
  function rateUx(f, u) {
    const a = u.a11y / 100;
    const us = u.usability ? (u.usability - 1) / 4 : 0.7;
    const d = 1 - Math.min(1, u.debt / 6);
    let s = 0.5 * a + 0.3 * us + 0.2 * d;
    const reasons = [];
    if (u.a11y < 60) {
      s = Math.min(s, 0.55);
      reasons.push('Capped at 55: accessibility score ' + u.a11y + ' is below 60');
    }
    if (!u.usability) reasons.push('No usability study yet: counted as 70');
    if (u.debt > 0) reasons.push(plural(u.debt, 'UX debt item') + ' open');
    return make('ux', s, 'WCAG ' + u.a11y + ' · ' + (u.usability ? 'usability ' + num2(u.usability) + '/5' : 'usability untested') + ' · ' + (u.debt ? plural(u.debt, 'UX debt item') : 'no UX debt'), [
      { label: 'Accessibility', value: String(u.a11y), band: band(a) },
      { label: 'Usability', value: u.usability ? num2(u.usability) + '/5' : 'Untested', band: u.usability ? band(us) : undefined },
      { label: 'UX debt', value: String(u.debt), band: band(d) },
    ], reasons);
  }

  /** Cost: monthly spend against budget, with a cap for fast growth. */
  function rateCost(f, c) {
    const r = c.monthly / c.budget;
    let s = r <= 0.8 ? 1 : r <= 1 ? 0.82 : r <= 1.15 ? 0.62 : r <= 1.4 ? 0.45 : 0.25;
    const reasons = [];
    if (r > 1) reasons.push(Math.round((r - 1) * 100) + '% over budget');
    if (c.trend > 25) {
      s = Math.min(s, 0.6);
      reasons.push('Capped at 60: spend grew ' + c.trend + '% in 30 days');
    }
    const trend = (c.trend > 0 ? '+' : '') + c.trend + '%';
    return make('cost', s, money(c.monthly) + '/mo · ' + Math.round(r * 100) + '% of budget · ' + trend + ' in 30 days', [
      { label: 'Monthly', value: money(c.monthly) },
      { label: 'Budget', value: money(c.budget), band: band(s) },
      { label: '30-day trend', value: trend, band: c.trend > 25 ? 'poor' : c.trend > 10 ? 'fair' : 'good' },
    ], reasons);
  }

  /** Overall (exec health): a composite whose recipe depends on the feature's status. */
  function rateOverall(f) {
    if (f.status === 'planned') return naRating('overall', naReason(f, 'overall'));
    if (f.status === 'blocked') {
      return make('overall', 0.2, f.blockedReason || 'Blocked', [
        { label: 'Progress', value: (f.progress || 0) + '%' },
        { label: 'Target', value: f.release ? releaseLabel(f.release) : 'Unscheduled' },
      ], ['Blocked: health is held at 20 until the block is cleared']);
    }
    if (f.status === 'building') {
      const dev = rating(f, 'dev');
      const devScore = dev.band === 'na' ? 0.5 : dev.score;
      const g = gates(f);
      const changes = arr(f.branches).some((b) => b.state === 'changes-requested');
      const stale = g.filter((x) => x.waitingDays > 7);
      let delivery = 1;
      let deliveryText = 'on track';
      const reasons = [];
      if (stale.length) {
        delivery = 0.6;
        const kind = stale[0].kind === 'triage' ? 'triage' : stale[0].kind === 'approval' ? 'approval' : 'changes';
        deliveryText = kind + ' waiting ' + stale[0].waitingDays + ' days';
        reasons.push('A human gate has waited more than 7 days: delivery counts 60');
      }
      if (changes) {
        delivery = Math.min(delivery, 0.45);
        deliveryText = 'changes requested';
        reasons.push('A branch has changes requested: delivery counts 45');
      }
      return make('overall', 0.5 * devScore + 0.5 * delivery, 'In build · ' + (f.progress || 0) + '% · ' + deliveryText, [
        { label: 'Progress', value: (f.progress || 0) + '%' },
        { label: 'Development', value: dev.band === 'na' ? 'No data' : pts(devScore), band: band(devScore) },
        { label: 'Delivery', value: deliveryText, band: band(delivery) },
      ], reasons);
    }
    const lenses = f.status === 'live' ? LIVE_LENSES : READY_LENSES;
    const parts = [];
    lenses.forEach((l) => {
      const r = rating(f, l);
      if (r.band !== 'na') parts.push(r);
    });
    if (!parts.length) return naRating('overall', 'No data');
    let wsum = 0;
    let sum = 0;
    parts.forEach((r) => {
      wsum += WEIGHTS[r.lens];
      sum += WEIGHTS[r.lens] * r.score;
    });
    let s = sum / wsum;
    const reasons = [];
    const critical = parts.filter((r) => r.band === 'critical');
    if (critical.length) {
      s = Math.min(s, 0.55);
      reasons.push('Capped at 55: ' + critical.map((r) => LENS_LABEL.get(r.lens)).join(', ') + (critical.length === 1 ? ' is' : ' are') + ' critical');
    }
    const sorted = parts.slice().sort((a, b) => a.score - b.score || LENS_IDS.indexOf(a.lens) - LENS_IDS.indexOf(b.lens));
    const good = parts.filter((r) => r.band === 'good').length;
    const weakest = sorted[0];
    const lead = f.status === 'ready' ? 'Ready for ' + releaseLabel(f.release) + ' · ' : '';
    // Exec headline: what is wrong first. Critical lenses by name; otherwise how many are good and the weakest.
    const critNames = critical.map((r) => LENS_LABEL.get(r.lens));
    const headline = critical.length
      ? lead + 'Critical in ' + (critNames.length <= 2 ? critNames.join(' and ') : plural(critNames.length, 'lens', 'lenses') + ': ' + critNames.slice(0, -1).join(', ') + ' and ' + critNames[critNames.length - 1])
      : good === parts.length
        ? lead + 'Good in all ' + parts.length + ' lenses'
        : lead + (good ? 'Good in ' + good + ' of ' + parts.length + ' lenses · weakest ' : 'Weakest: ') + LENS_LABEL.get(weakest.lens) + ' (' + weakest.band + ')';
    const facts = sorted.slice(0, 4).map((r) => ({ label: LENS_LABEL.get(r.lens), value: pts(r.score), band: r.band }));
    return make('overall', s, headline, facts, reasons);
  }

  const ratingMemo = new WeakMap();

  /**
   * Rating of one feature in one lens: { lens, score, band, headline, facts: [{ label, value, band? }], reasons }.
   * Scores are rounded to 4 decimals; composites use the rounded lens scores. Memoised per feature and lens.
   */
  function rating(featureOrId, lens) {
    const f = asFeature(featureOrId);
    const l = lens || 'overall';
    if (!f) return naRating(l, 'Unknown feature');
    if (LENS_IDS.indexOf(l) === -1) return naRating(l, 'Unknown lens');
    let memo = ratingMemo.get(f);
    if (!memo) {
      memo = new Map();
      ratingMemo.set(f, memo);
    }
    if (memo.has(l)) return memo.get(l);
    let r;
    if (l === 'overall') {
      r = rateOverall(f);
    } else {
      const m = f.metrics ? f.metrics[l] : null;
      if (!m) r = naRating(l, naReason(f, l));
      else if (l === 'dev') r = rateDev(f, m);
      else if (l === 'ops') r = rateOps(f, m);
      else if (l === 'biz') r = rateBiz(f, m);
      else if (l === 'sec') r = rateSec(f, m);
      else if (l === 'comp') r = rateComp(f, m);
      else if (l === 'ux') r = rateUx(f, m);
      else r = rateCost(f, m);
    }
    memo.set(l, r);
    return r;
  }

  /** True when the feature is blocked, has any lens in the critical band, or a branch with changes requested. */
  function needsAttention(featureOrId) {
    const f = asFeature(featureOrId);
    if (!f) return false;
    if (f.status === 'blocked') return true;
    if (arr(f.branches).some((b) => b.state === 'changes-requested')) return true;
    return LENS_IDS.some((l) => rating(f, l).band === 'critical');
  }

  // ── Rollups ────────────────────────────────────────────────────────────────────────────────

  const rollupRatingMemo = new WeakMap();

  /**
   * Rating of a set of features in one lens: { lens, score, band, counts: { good, fair, poor, critical, na },
   * applicable, worst: [featureId ×3] }. The score is the mean of applicable feature scores.
   */
  function rollupRating(features, lens) {
    const l = lens || 'overall';
    const key = Array.isArray(features) ? features : null;
    if (key) {
      const memo = rollupRatingMemo.get(key);
      if (memo && memo.has(l)) return memo.get(l);
    }
    const list = asFeatures(features);
    const counts = { good: 0, fair: 0, poor: 0, critical: 0, na: 0 };
    const scored = [];
    let sum = 0;
    list.forEach((f, i) => {
      const r = rating(f, l);
      counts[r.band] += 1;
      if (r.band !== 'na') {
        sum += r.score;
        scored.push([r.score, i, f.id]);
      }
    });
    const score = scored.length ? round4(sum / scored.length) : null;
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = { lens: l, score, band: band(score), counts, applicable: scored.length, worst: scored.slice(0, 3).map((x) => x[2]) };
    if (key) {
      if (!rollupRatingMemo.has(key)) rollupRatingMemo.set(key, new Map());
      rollupRatingMemo.get(key).set(l, out);
    }
    return out;
  }

  /** Lens rating of a module. */
  function moduleRating(id, lens) { return rollupRating(featuresByModule.get(idOf(id)) || [], lens); }
  /** Lens rating of a domain. */
  function domainRating(id, lens) { return rollupRating(featuresByDomain.get(idOf(id)) || [], lens); }
  /** Lens rating of an area. */
  function areaRating(id, lens) { return rollupRating(featuresByArea.get(idOf(id)) || [], lens); }
  /** Lens rating of the whole product. */
  function productRating(lens) { return rollupRating(data.features, lens); }

  const rollupMemo = new WeakMap();

  /** Counts for a set of features: { count, byStatus, byBuilder, attention, gates: { triage, approval, changes } }. */
  function rollup(features) {
    const key = Array.isArray(features) ? features : null;
    if (key && rollupMemo.has(key)) return rollupMemo.get(key);
    const list = asFeatures(features);
    const byStatus = {};
    STATUS_ORDER.forEach((s) => { byStatus[s] = 0; });
    const byBuilder = {};
    BUILDERS.forEach((b) => { byBuilder[b] = 0; });
    const g = { triage: 0, approval: 0, changes: 0 };
    let attention = 0;
    list.forEach((f) => {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      byBuilder[f.builtBy] = (byBuilder[f.builtBy] || 0) + 1;
      if (needsAttention(f)) attention += 1;
      gates(f).forEach((x) => { g[x.kind] += 1; });
    });
    const out = { count: list.length, byStatus, byBuilder, attention, gates: g };
    if (key) rollupMemo.set(key, out);
    return out;
  }

  /** Rollup of a module. */
  function moduleRollup(id) { return rollup(featuresByModule.get(idOf(id)) || []); }
  /** Rollup of a domain. */
  function domainRollup(id) { return rollup(featuresByDomain.get(idOf(id)) || []); }
  /** Rollup of an area. */
  function areaRollup(id) { return rollup(featuresByArea.get(idOf(id)) || []); }
  /** Rollup of the whole product. */
  function productRollup() { return rollup(data.features); }

  // ── Relations ──────────────────────────────────────────────────────────────────────────────

  const dependencyMemo = new WeakMap();

  /** Features this feature depends on. */
  function dependencies(featureOrId) {
    const f = asFeature(featureOrId);
    if (!f) return [];
    if (!dependencyMemo.has(f)) dependencyMemo.set(f, arr(f.dependsOn).map((id) => featureById.get(id)).filter(Boolean));
    return dependencyMemo.get(f).slice();
  }

  /** Features that depend on this feature. */
  function dependents(featureOrId) {
    const f = asFeature(featureOrId);
    return f ? arr(dependentsById.get(f.id)).slice() : [];
  }

  /** Initiatives covering a feature: [{ initiative (object), state, note }], in initiative order. */
  function initiativesOf(featureOrId) {
    const f = asFeature(featureOrId);
    return f ? arr(initiativeIndex.get(f.id)).slice() : [];
  }

  /** The feature's coverage state in an initiative ('covered', 'in-progress', 'pending', 'finding'), or null. */
  function initiativeState(featureOrId, initiativeId) {
    const f = asFeature(featureOrId);
    const states = initiativeStateIndex.get(idOf(initiativeId));
    if (!f || !states) return null;
    return states.has(f.id) ? states.get(f.id) : null;
  }

  const ledgerMemo = new WeakMap();

  /** A stable memo key for a filter value (single value, array or Set). */
  function filterKey(v) {
    if (!hasValues(v)) return '';
    const list = Array.isArray(v) ? v.slice() : isSetLike(v) ? Array.from(v) : [v];
    return list.map(String).sort().join(',');
  }

  /**
   * Ledger entries of a feature, newest first. `lens` and `action` filter by a value, an array or a Set;
   * a missing lens or 'overall' means every entry.
   */
  function ledgerOf(featureOrId, opts) {
    const f = asFeature(featureOrId);
    if (!f) return [];
    const o = opts || {};
    const lens = o.lens === 'overall' ? null : o.lens;
    const key = filterKey(lens) + '|' + filterKey(o.action);
    if (!ledgerMemo.has(f)) ledgerMemo.set(f, new Map());
    const memo = ledgerMemo.get(f);
    if (!memo.has(key)) {
      let list = arr(f.ledger).map((e, i) => [e, i]);
      if (hasValues(lens)) list = list.filter((x) => includes(lens, x[0].lens));
      if (hasValues(o.action)) list = list.filter((x) => includes(o.action, x[0].action));
      list.sort((a, b) => (a[0].at > b[0].at ? -1 : a[0].at < b[0].at ? 1 : a[1] - b[1]));
      memo.set(key, list.map((x) => x[0]));
    }
    return memo.get(key).slice();
  }

  // ── Timeline ───────────────────────────────────────────────────────────────────────────────

  /** Releases sorted by date, oldest first. */
  function releasesInOrder() {
    return RELEASES_IN_ORDER.slice();
  }

  /** Items of a release ({ feature (id), kind, note }), in data order. */
  function releaseItems(id) {
    const r = release(id);
    return r ? arr(r.items).slice() : [];
  }

  /** Releases a feature appears in: [{ release (object), kind, note }], oldest first. */
  function featureReleases(featureOrId) {
    const f = asFeature(featureOrId);
    return f ? arr(featureReleaseIndex.get(f.id)).slice() : [];
  }

  // ── Search and filters ─────────────────────────────────────────────────────────────────────

  const haystackMemo = new WeakMap();

  /** Lower-case text a feature is searched by: name, summary, id, module, domain and area names. */
  function haystack(f) {
    if (haystackMemo.has(f)) return haystackMemo.get(f);
    const p = pathOf(f);
    const text = [f.name, f.summary, f.id, p.module && p.module.name, p.domain && p.domain.name, p.domain && p.domain.code, p.area && p.area.name]
      .filter(Boolean).join(' ').toLowerCase();
    haystackMemo.set(f, text);
    return text;
  }

  const searchMemo = new Map();

  /** Normalised search text: trimmed, lower case, single spaces. */
  function normQuery(query) {
    return String(query == null ? '' : query).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /** The memoised { list, ids } result for a normalised query (shared by search and matches; not copied). */
  function searchEntry(q) {
    if (!searchMemo.has(q)) search(q);
    return searchMemo.get(q);
  }

  /** Features matching every word of the query, best name matches first; [] for an empty query. */
  function search(query) {
    const q = normQuery(query);
    if (!q) return [];
    if (searchMemo.has(q)) return searchMemo.get(q).list.slice();
    const tokens = q.split(' ');
    const hits = [];
    data.features.forEach((f, i) => {
      const hay = haystack(f);
      if (!tokens.every((t) => hay.indexOf(t) !== -1)) return;
      const name = f.name.toLowerCase();
      const rank = name === q ? 0 : name.indexOf(q) === 0 ? 1 : name.indexOf(q) !== -1 ? 2 : tokens.every((t) => name.indexOf(t) !== -1) ? 3 : 4;
      hits.push([rank, i, f]);
    });
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const list = hits.map((h) => h[2]);
    searchMemo.set(q, { list, ids: new Set(list.map((f) => f.id)) });
    return list.slice();
  }

  /**
   * True when a feature passes a filter { statuses, query, initiative, gates: 'any'|'triage'|'approval'|'changes',
   * attentionOnly, lens, bands }. Statuses and bands take an array or a Set; empty or missing parts match everything.
   */
  function matches(featureOrId, filter) {
    const f = asFeature(featureOrId);
    if (!f) return false;
    const o = filter || {};
    if (hasValues(o.statuses) && !includes(o.statuses, f.status)) return false;
    if (o.query) {
      const q = normQuery(o.query);
      if (q && !searchEntry(q).ids.has(f.id)) return false;
    }
    if (o.initiative && initiativeState(f, o.initiative) == null) return false;
    if (o.gates) {
      const g = gates(f);
      if (o.gates === 'any' ? g.length === 0 : !g.some((x) => x.kind === o.gates)) return false;
    }
    if (o.attentionOnly && !needsAttention(f)) return false;
    if (hasValues(o.bands) && !includes(o.bands, rating(f, o.lens || 'overall').band)) return false;
    return true;
  }

  window.BP = {
    version: '0.2',
    asOf: ASOF,
    data,
    product: data.product,
    areas: arr(data.areas),
    domains: arr(data.domains),
    modules: arr(data.modules),
    features: data.features,
    releases: arr(data.releases),
    teams: arr(data.teams),
    people: arr(data.people),
    initiatives: arr(data.initiatives),
    systems: arr(data.systems),
    LENSES,
    STATUSES,
    STATUS_ORDER,
    BANDS,
    BAND_IDS,
    BUILDERS,
    GATE_KINDS,
    area,
    domain,
    module,
    feature,
    team,
    person,
    release,
    initiative,
    system,
    actor,
    domainsOf,
    modulesOf,
    featuresOf,
    featuresOfDomain,
    featuresOfArea,
    pathOf,
    rating,
    moduleRating,
    domainRating,
    areaRating,
    productRating,
    rollupRating,
    rollup,
    moduleRollup,
    domainRollup,
    areaRollup,
    productRollup,
    needsAttention,
    gates,
    openBacklog,
    dependencies,
    dependents,
    initiativesOf,
    initiativeState,
    ledgerOf,
    releasesInOrder,
    releaseItems,
    featureReleases,
    search,
    matches,
    band,
    daysSince,
  };
})();
