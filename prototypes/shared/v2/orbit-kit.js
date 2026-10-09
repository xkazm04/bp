// Orbit kit (round 2): window.OK, the shared shell, primitives, inspector, legend and full-page feature detail.
// Classic script. Load after orbit-kit.css, blueprint-data.js and blueprint-model.js. Contract: docs/orbit-kit.md.
// The kit reads window.BP and never mutates the data. It computes on events (lens, filter, open), never per frame.
(function () {
  'use strict';

  const BP = window.BP;
  if (!BP) throw new Error('orbit-kit.js: window.BP is missing. Load blueprint-data.js and blueprint-model.js first.');
  const OK = { version: '0.2.1' };

  // ══ helpers ═══════════════════════════════════════════════════════════════════════════════════
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const fx = (n) => Math.round(n * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const asList = (x) => (Array.isArray(x) ? x : x ? Array.from(x) : []);
  const featureOf = (x) => (x == null ? null : typeof x === 'string' ? BP.feature(x) : x.feature && !x.moduleId ? featureOf(x.feature) : x);
  const releaseOf = (x) => (x == null ? null : typeof x === 'string' ? BP.release(x) : x);
  const initiativeOf = (x) => (x == null ? null : typeof x === 'string' ? BP.initiative(x) : x);
  const personOrTeam = (id) => (id && (typeof BP.actor === 'function' ? BP.actor(id) : BP.person(id) || BP.team(id))) || null;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  /** A collection that behaves like both an Array and a Set, so BP.matches can use either API. */
  function coll(set) {
    const a = Array.from(set);
    a.has = (v) => set.has(v);
    Object.defineProperty(a, 'size', { value: set.size });
    return a;
  }
  OK.esc = esc;

  // ══ vocabulary (plain words) ══════════════════════════════════════════════════════════════════
  const LENS_IDS = ['overall', 'dev', 'ops', 'biz', 'sec', 'comp', 'ux', 'cost'];
  const LENS_FALLBACK = {
    overall: ['Overall', 'Overall', 'role', 'Is it healthy?'],
    dev: ['Development', 'Dev', 'role', 'Is the code healthy?'],
    ops: ['Operations', 'Ops', 'role', 'Is it running well in production?'],
    biz: ['Business', 'Business', 'role', 'Is it delivering without open asks?'],
    sec: ['Security', 'Security', 'specialist', 'Is it safe?'],
    comp: ['Compliance', 'Compliance', 'specialist', 'Is it covered by compliance scans?'],
    ux: ['UX', 'UX', 'specialist', 'Is it usable and accessible?'],
    cost: ['Cost', 'Cost', 'specialist', 'Is it within budget?'],
  };
  // Short labels the lens dial uses when it is tight; plain words, never codes.
  const LENS_SHORT = { overall: 'Overall', dev: 'Dev', ops: 'Ops', biz: 'Biz', sec: 'Sec', comp: 'Comp', ux: 'UX', cost: 'Cost' };
  const LENS_DEFS = (Array.isArray(BP.LENSES) && BP.LENSES.length ? BP.LENSES : LENS_IDS.map((id) => ({ id })))
    .map((l) => {
      const fb = LENS_FALLBACK[l.id] || [l.id, l.id, 'specialist', ''];
      return Object.assign({}, l, {
        label: l.label || fb[0], short: LENS_SHORT[l.id] || l.short || fb[1], group: l.group || fb[2], question: l.question || fb[3],
        hue: 'var(--ok-lens-' + l.id + ')',
      });
    });
  const LENS = {};
  LENS_DEFS.forEach((l) => { LENS[l.id] = l; });
  OK.lens = (id) => LENS[id] || null;
  OK.lenses = () => LENS_DEFS.slice();

  const STATUS_IDS = Array.isArray(BP.STATUS_ORDER) && BP.STATUS_ORDER.length ? BP.STATUS_ORDER.slice() : ['live', 'ready', 'building', 'planned', 'blocked'];
  const STATUS_FB = { live: 'Live', ready: 'Ready', building: 'In build', planned: 'Planned', blocked: 'Blocked' };
  const STATUS = {};
  STATUS_IDS.forEach((id) => {
    const def = asList(BP.STATUSES).find((s) => (typeof s === 'string' ? s : s.id) === id);
    STATUS[id] = { id, label: (def && def.label) || STATUS_FB[id] || id, description: (def && def.description) || '' };
  });
  const BAND_IDS = ['good', 'fair', 'poor', 'critical', 'na'];
  const BAND = {
    good: { label: 'Good', range: '80–100' }, fair: { label: 'Fair', range: '60–79' }, poor: { label: 'Poor', range: '40–59' },
    critical: { label: 'Critical', range: '0–39' }, na: { label: 'Not applicable', range: 'Does not apply' },
  };
  asList(BP.BANDS).forEach((b) => { if (b && BAND[b.id] && b.label) BAND[b.id].label = b.label; });
  const GATE = {
    triage: { label: 'Triage', long: 'Waiting for triage', verb: 'triage' },
    approval: { label: 'Approval', long: 'Awaiting approval', verb: 'approve' },
    changes: { label: 'Changes', long: 'Changes requested', verb: 'update' },
  };
  const BUILDER = { agent: 'Agent crew', pair: 'Agent + human pair', human: 'Human squad' };
  const SOURCE = { goal: 'Goal', ticket: 'Ticket', scan: 'Scan finding' };
  const WI_STATE = { triage: 'Waiting for triage', backlog: 'Backlog', 'in-progress': 'In progress', review: 'In review', done: 'Done', dismissed: 'Dismissed' };
  const WI_ORDER = ['triage', 'review', 'in-progress', 'backlog', 'done', 'dismissed'];
  const WI_KIND = { feature: 'Feature', bug: 'Bug', perf: 'Performance', security: 'Security', compliance: 'Compliance', ux: 'UX', cost: 'Cost', refactor: 'Refactor' };
  const BR_STATE = { running: 'Running', 'awaiting-approval': 'Awaiting approval', 'changes-requested': 'Changes requested', approved: 'Approved', merged: 'Merged', abandoned: 'Abandoned' };
  const BR_ORDER = ['awaiting-approval', 'changes-requested', 'running', 'approved', 'merged', 'abandoned'];
  const ACTIVITY = { implement: 'Implementation', fix: 'Fix', refactor: 'Refactor', perf: 'Performance', security: 'Security', test: 'Tests', docs: 'Docs' };
  const ACTION = {
    goal: 'Goal set', ticket: 'Ticket synced', scan: 'Scan', triage: 'Triaged', branch: 'Branch opened', commit: 'Commit', test: 'Test run',
    demo: 'Demo', report: 'Report', approve: 'Approved', 'request-changes': 'Changes requested', merge: 'Merged', deploy: 'Deployed',
    release: 'Released', monitor: 'Monitoring', incident: 'Incident', cost: 'Cost report', audit: 'Audit',
  };
  const RESULT = { pass: 'Pass', fail: 'Fail', warn: 'Warning', info: 'Info' };
  const ACTOR_KIND = { agent: 'Agent', human: 'Human', system: 'System' };
  const INI_TYPE = { 'compliance-scan': 'Compliance scan', 'a11y-monitoring': 'Accessibility monitoring', refactor: 'Refactor', scan: 'Scan campaign', upgrade: 'Upgrade', cost: 'Cost reduction' };
  const COV = { covered: 'Covered', 'in-progress': 'In progress', pending: 'Pending', finding: 'Finding' };
  const COV_IDS = ['covered', 'in-progress', 'pending', 'finding'];
  const SURFACE = { web: 'Web', admin: 'Admin', mobile: 'Mobile app', api: 'API', worker: 'Worker', data: 'Data' };
  const REL_KIND = { new: 'New', improved: 'Improved', fixed: 'Fixed' };
  OK.labels = { status: STATUS, band: BAND, gate: GATE, builder: BUILDER, source: SOURCE, workItem: WI_STATE, workKind: WI_KIND, branch: BR_STATE, activity: ACTIVITY, action: ACTION, result: RESULT, actorKind: ACTOR_KIND, initiativeType: INI_TYPE, coverage: COV, surface: SURFACE, releaseKind: REL_KIND };
  OK.statusLabel = (s) => (STATUS[s] ? STATUS[s].label : s);
  OK.bandLabel = (b) => (BAND[b] ? BAND[b].label : b);
  OK.bandColor = (b) => (b === 'na' || !BAND[b] ? 'var(--ok-na)' : 'var(--ok-' + b + ')');
  OK.bandSoft = (b) => (BAND[b] ? 'var(--ok-' + b + '-soft)' : 'var(--ok-na-soft)');

  // ══ formatting ════════════════════════════════════════════════════════════════════════════════
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const asOf = () => (BP.data && BP.data.meta && BP.data.meta.asOf) || new Date().toISOString().slice(0, 10);
  const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
  const fmt = {
    num: (n) => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString('en-US')),
    pct: (n, digits) => {
      if (n == null || isNaN(n)) return '–';
      const a = Math.abs(n);
      const d = digits != null ? digits : !(n % 1) ? 0 : a < 1 ? 2 : a < 10 ? 1 : 0;
      return (digits != null ? Number(n).toFixed(d) : String(Number(Number(n).toFixed(d)))) + '%';
    },
    money: (n) => (n == null || isNaN(n) ? '–' : '$' + Math.round(n).toLocaleString('en-US')),
    ms: (n) => (n == null || isNaN(n) ? '–' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + ' s' : Math.round(n) + ' ms'),
    // Rounds down, so a score never shows a number from a better band (0.7963 is "79", fair).
    score: (s) => (s == null || isNaN(s) ? '–' : String(Math.floor(s * 100 + 1e-9))),
    date: (s) => { if (!s) return '–'; const d = String(s); return +d.slice(8, 10) + ' ' + MONTHS[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4); },
    dateShort: (s) => { if (!s) return '–'; const d = String(s); return +d.slice(8, 10) + ' ' + MONTHS[+d.slice(5, 7) - 1]; },
    time: (s) => (s && String(s).length > 15 ? String(s).slice(11, 16) : ''),
    dateTime: (s) => (s ? fmt.date(s) + (fmt.time(s) ? ' · ' + fmt.time(s) : '') : '–'),
    days: (s) => (s ? dayNum(asOf()) - dayNum(String(s)) : null),
    rel: (s) => {
      if (!s) return '–';
      const d = dayNum(asOf()) - dayNum(String(s));
      const a = Math.abs(d);
      if (d === 0) return 'today';
      if (d === 1) return 'yesterday';
      if (d === -1) return 'tomorrow';
      const unit = a < 14 ? plural(a, 'day') : a < 60 ? plural(Math.round(a / 7), 'week') : a < 730 ? plural(Math.round(a / 30.4), 'month') : plural(Math.round(a / 365), 'year');
      return d > 0 ? unit + ' ago' : 'in ' + unit;
    },
  };
  OK.fmt = fmt;

  // ══ SVG primitives (markup strings centred on 0,0) ══════════════════════════════════════════════
  const P = (r, deg) => { const a = deg * Math.PI / 180; return [fx(r * Math.sin(a)), fx(-r * Math.cos(a))]; };
  function arc(r, d0, d1) {
    const p0 = P(r, d0), p1 = P(r, d1);
    return 'M' + p0 + 'A' + fx(r) + ',' + fx(r) + ' 0 ' + (d1 - d0 > 180 ? 1 : 0) + ' 1 ' + p1;
  }
  function pie(r, frac) {
    if (frac >= 1) return 'M0,' + fx(-r) + 'A' + fx(r) + ',' + fx(r) + ' 0 1 1 0,' + fx(r) + 'A' + fx(r) + ',' + fx(r) + ' 0 1 1 0,' + fx(-r) + 'Z';
    const p1 = P(r, 360 * frac);
    return 'M0,0L0,' + fx(-r) + 'A' + fx(r) + ',' + fx(r) + ' 0 ' + (frac > 0.5 ? 1 : 0) + ' 1 ' + p1 + 'Z';
  }
  function astroid(R, r) {
    let d = '';
    for (let i = 0; i < 8; i++) { const p = P(i % 2 ? r : R, i * 45); d += (i ? 'L' : 'M') + p; }
    return d + 'Z';
  }
  const sw = (r) => fx(clamp(r * 0.22, 1.1, 2.2));
  const svg = {};
  svg.status = function (status, r) {
    r = r || 6;
    const w = sw(r);
    switch (status) {
      case 'live': return '<circle class="ok-st-live" r="' + fx(r) + '"/>';
      case 'ready': return '<circle class="ok-st-ring" r="' + fx(r - w / 2) + '" stroke-width="' + w + '"/><circle class="ok-st-fill" r="' + fx(r * 0.36) + '"/>';
      case 'building': return '<circle class="ok-st-ring" r="' + fx(r - w / 2) + '" stroke-width="' + w + '"/><path class="ok-st-fill" d="M0,' + fx(-r + w / 2) + 'A' + fx(r - w / 2) + ',' + fx(r - w / 2) + ' 0 0 0 0,' + fx(r - w / 2) + 'Z"/>';
      case 'planned': return '<circle class="ok-st-plan" r="' + fx(r - w / 2) + '" stroke-width="' + w + '" stroke-dasharray="' + fx(r * 0.22) + ' ' + fx(r * 0.36) + '"/>';
      case 'blocked': return '<path class="ok-st-block" d="' + astroid(r * 1.5, r * 0.42) + '"/>';
      default: return '<circle class="ok-st-plan" r="' + fx(r - 0.6) + '" stroke-width="1"/>';
    }
  };
  svg.band = function (band, r) {
    r = r || 6;
    const w = sw(r);
    switch (band) {
      case 'good': return '<circle class="ok-bd-good" r="' + fx(r) + '" stroke-width="0"/>';
      case 'fair': return '<circle class="ok-bd-track" r="' + fx(r - 0.5) + '" stroke-width="1"/><path class="ok-bd-fair" d="' + pie(r, 0.75) + '" stroke-width="0"/>';
      case 'poor': return '<circle class="ok-bd-track" r="' + fx(r - 0.5) + '" stroke-width="1"/><path class="ok-bd-poor" d="' + pie(r, 0.5) + '" stroke-width="0"/>';
      case 'critical': {
        const k = fx(r * 0.36);
        return '<circle class="ok-bd-crit-ring" r="' + fx(r - w / 2) + '" stroke-width="' + w + '"/><path class="ok-bd-x" stroke-width="' + w + '" d="M' + -k + ',' + -k + 'L' + k + ',' + k + 'M' + k + ',' + -k + 'L' + -k + ',' + k + '"/>';
      }
      default: return '<circle class="ok-bd-na" r="' + fx(r - w / 2) + '" stroke-width="' + w + '" stroke-dasharray="' + fx(r * 0.42) + ' ' + fx(r * 0.32) + '"/>';
    }
  };
  /** Eight-segment ring: one segment per lens, clockwise from the top in lens order, coloured by band. */
  svg.corona = function (feature, r, opts) {
    const f = featureOf(feature);
    const o = opts || {};
    r = r || 10;
    const w = fx(o.width || clamp(r * 0.24, 1.8, 6));
    const gap = o.gap == null ? 7 : o.gap;
    let h = '<g class="ok-corona"><circle class="ok-cr-track" r="' + fx(r) + '" stroke-width="' + w + '"/>';
    LENS_DEFS.forEach((l, i) => {
      const band = f ? BP.rating(f, l.id).band : 'na';
      const d0 = i * 45 + gap / 2, d1 = (i + 1) * 45 - gap / 2;
      h += '<path class="ok-cr-seg ok-cr-' + band + '" stroke-width="' + (band === 'na' ? fx(w * 0.5) : w) + '" d="' + arc(r, d0, d1) + '"/>';
      if (o.lens === l.id) {
        const a = P(r + w * 0.9, i * 45 + 22.5), b = P(r + w * 0.9 + Math.max(3, r * 0.28), i * 45 + 22.5);
        h += '<path class="ok-cr-tick" stroke-width="' + fx(Math.max(1.2, w * 0.45)) + '" d="M' + a + 'L' + b + '"/>';
      }
    });
    if (o.status && f) h += svg.status(f.status, r * 0.42);
    return h + '</g>';
  };
  /** A lens mark: a ring in the lens hue around the band glyph. */
  svg.jewel = function (lensId, band, r) {
    r = r || 8;
    return '<circle class="ok-lens-ring ok-lh-' + lensId + '" r="' + fx(r - 0.8) + '" stroke-width="1.6"/><circle class="ok-jewel-disc" r="' + fx(r - 1.6) + '"/>' + svg.band(band || 'na', r * 0.5);
  };
  svg.gate = function (kind, r) {
    r = r || 6;
    const w = sw(r);
    return '<circle class="ok-gate-ring' + (kind === 'changes' ? ' is-changes' : '') + '" r="' + fx(r - w / 2) + '" stroke-width="' + w + '"' + (kind === 'triage' ? ' stroke-dasharray="' + fx(r * 0.42) + ' ' + fx(r * 0.3) + '"' : '') + '/><circle class="' + (kind === 'changes' ? 'ok-alarm-ink' : 'ok-gate-dot') + '" r="' + fx(r * 0.34) + '"/>';
  };
  svg.attention = function (r) {
    r = r || 6;
    let d = '';
    [0, 60, 120, 180, 240, 300].forEach((a) => { d += 'M' + P(r * 0.18, a) + 'L' + P(r * 0.98, a); });
    return '<path class="ok-alarm-ink" fill="none" stroke-width="' + fx(clamp(r * 0.26, 1.3, 2.4)) + '" stroke-linecap="round" d="' + d + '"/>';
  };
  /** Release package marks are squares (packages), so they never read as status glyphs: new +, improved ↑, fixed ✓. */
  svg.releaseKind = function (kind, r) {
    r = r || 5;
    const s = fx(r - 0.6), k = fx(r * 0.46);
    const box = '<rect class="ok-rk-box' + (kind === 'new' ? ' is-new' : '') + '" x="' + -s + '" y="' + -s + '" width="' + 2 * s + '" height="' + 2 * s + '" rx="' + fx(r * 0.28) + '" stroke-width="1.1"/>';
    const cls = 'ok-rk-sym' + (kind === 'new' ? ' is-new' : '');
    const attrs = '" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="';
    if (kind === 'new') return box + '<path class="' + cls + attrs + 'M' + -k + ',0H' + k + 'M0,' + -k + 'V' + k + '"/>';
    if (kind === 'improved') return box + '<path class="' + cls + attrs + 'M' + -k + ',' + fx(k * 0.45) + 'L0,' + fx(-k * 0.55) + 'L' + k + ',' + fx(k * 0.45) + '"/>';
    return box + '<path class="' + cls + attrs + 'M' + -k + ',' + fx(k * 0.05) + 'L' + fx(-k * 0.2) + ',' + fx(k * 0.7) + 'L' + k + ',' + fx(-k * 0.6) + '"/>';
  };
  svg.actor = function (kind, r) {
    r = r || 6;
    if (kind === 'agent') return '<circle class="ok-actor-agent" r="' + fx(r * 0.72) + '" stroke-width="1.2"/><circle class="ok-actor-agent-dot" cx="' + fx(r * 0.6) + '" cy="' + fx(-r * 0.6) + '" r="' + fx(r * 0.3) + '"/><circle class="ok-actor-agent-dot" r="' + fx(r * 0.26) + '"/>';
    if (kind === 'human') return '<circle class="ok-actor-human" r="' + fx(r * 0.62) + '"/>';
    return '<rect class="ok-actor-system" x="' + fx(-r * 0.6) + '" y="' + fx(-r * 0.6) + '" width="' + fx(r * 1.2) + '" height="' + fx(r * 1.2) + '" stroke-width="1.2" transform="rotate(45)"/>';
  };
  svg.result = function (res, r) {
    r = r || 5;
    if (res === 'pass') return '<circle class="ok-res-pass" r="' + fx(r) + '" stroke-width="0"/><path stroke="var(--ok-paper-hi)" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M' + fx(-r * 0.45) + ',0L' + fx(-r * 0.1) + ',' + fx(r * 0.36) + 'L' + fx(r * 0.48) + ',' + fx(-r * 0.32) + '"/>';
    if (res === 'fail') return svg.band('critical', r);
    if (res === 'warn') return '<path class="ok-res-warn" stroke-width="0" d="M0,' + fx(-r) + 'L' + fx(r * 1.05) + ',' + fx(r * 0.85) + 'L' + fx(-r * 1.05) + ',' + fx(r * 0.85) + 'Z"/>';
    return '<circle class="ok-res-info" r="' + fx(r * 0.42) + '" stroke-width="0"/>';
  };
  /** Wraps glyph markup into a standalone inline SVG of `px` pixels that shows radius `r` (plus margin). */
  svg.wrap = function (inner, r, px, cls, label) {
    const v = fx(r);
    return '<svg class="ok-glyph' + (cls ? ' ' + cls : '') + '" width="' + px + '" height="' + px + '" viewBox="' + -v + ' ' + -v + ' ' + 2 * v + ' ' + 2 * v + '"' + (label ? ' role="img" aria-label="' + esc(label) + '"' : ' aria-hidden="true"') + '>' + inner + '</svg>';
  };
  const ICON_PATHS = {
    search: '<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    legend: '<circle cx="3" cy="4" r="1.6" fill="currentColor"/><circle cx="3" cy="8" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="3" cy="12" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="0.9 1"/><path d="M7 4h7M7 8h7M7 12h7" stroke="currentColor" stroke-width="1.4"/>',
    light: '<circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    dark: '<path d="M10.5 1.8A6.5 6.5 0 1 0 14.3 10.4A5 5 0 0 1 10.5 1.8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
    auto: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2A6 6 0 0 1 8 14Z" fill="currentColor"/>',
    map: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.2 1.4"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.4" cy="3.6" r="1.3" fill="currentColor"/>',
    timeline: '<path d="M1.5 8h13" stroke="currentColor" stroke-width="1.3"/><path d="M4 5v6M8 6.5v3M12 4v8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    filter: '<path d="M2 3.5h12M4.5 8h7M7 12.5h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    chev: '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    locate: '<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    open: '<path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    check: '<path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    demo: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.6 5.3v5.4L10.9 8Z" fill="currentColor"/>',
    report: '<path d="M4 1.8h5.5L12.5 5v9.2H4Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 7.5h4.5M6 10h4.5M6 12.3h3" stroke="currentColor" stroke-width="1.1"/>',
    goal: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/>',
    ticket: '<path d="M2 4.5h12v2.2a1.5 1.5 0 0 0 0 2.6v2.2H2V9.3a1.5 1.5 0 0 0 0-2.6Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 5v6" stroke="currentColor" stroke-width="1" stroke-dasharray="1 1.2"/>',
    scan: '<path d="M8 8L13.4 4.9A6.2 6.2 0 1 0 14.2 8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1 1.1"/><circle cx="8" cy="8" r="1" fill="currentColor"/>',
    branch: '<circle cx="4.5" cy="3.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="4.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="11.5" cy="5.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 5.1v5.8M11.5 7.1c0 3-7 2-7 3.8" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    arrow: '<path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    back: '<path d="M13 8H3M7 4L3 8l4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  svg.icon = (name, px) => '<svg class="ok-glyph ok-icon ok-icon--' + name + '" width="' + (px || 16) + '" height="' + (px || 16) + '" viewBox="0 0 16 16" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
  svg.mark = (px) => '<svg class="ok-glyph ok-brand__mark" width="' + (px || 24) + '" height="' + (px || 24) + '" viewBox="-13 -13 26 26" aria-hidden="true"><circle class="ok-mark-ring" r="11.5"/><circle class="ok-mark-ring" r="6.5" stroke-dasharray="1.5 2"/><circle class="ok-mark-dot" r="2.4"/><circle class="ok-mark-dot" cx="8.1" cy="-8.1" r="1.6"/></svg>';
  OK.svg = svg;

  // ══ HTML primitives ═══════════════════════════════════════════════════════════════════════════
  const html = {};
  html.status = (status, px, label) => svg.wrap(svg.status(status, 6), status === 'blocked' ? 9.4 : 7, px || 14, 'ok-g-status', label);
  html.band = (band, px, label) => svg.wrap(svg.band(band, 6), 7, px || 14, 'ok-g-band', label);
  html.jewel = (lensId, band, px) => svg.wrap(svg.jewel(lensId, band, 9), 9.4, px || 18, 'ok-g-jewel');
  html.corona = (feature, px, opts) => {
    const o = Object.assign({ status: true }, opts || {});
    const r = 10, w = o.width || 2.6, pad = o.lens ? w + 4.6 : w / 2 + 0.6;
    return svg.wrap(svg.corona(feature, r, Object.assign({ width: w }, o)), r + pad, px || 40, 'ok-g-corona', o.label);
  };
  html.gate = (kind, px) => svg.wrap(svg.gate(kind, 6), 7, px || 14, 'ok-g-gate');
  html.attention = (px) => svg.wrap(svg.attention(6), 7, px || 14, 'ok-g-attn');
  html.icon = svg.icon;
  html.rating = function (rating, opts) {
    const o = opts || {};
    const size = o.size || 'md';
    const r = rating || { band: 'na', score: null, headline: '' };
    const band = r.band || 'na';
    const px = size === 'lg' ? 30 : size === 'sm' ? 13 : 18;
    const score = band === 'na' ? 'n/a' : fmt.score(r.score);
    const aria = (o.label ? o.label + ': ' : '') + (band === 'na' ? 'not applicable' : BAND[band].label + ', ' + score) + (r.headline ? '. ' + r.headline : '');
    let h = '<span class="ok-rating ok-rating--' + size + (band === 'na' ? ' ok-rating--na' : '') + '" title="' + esc(aria) + '">' + html.band(band, px);
    if (size === 'sm') return h + '<span class="ok-rating__score">' + esc(score) + '</span><span class="ok-vh">' + esc(aria) + '</span></span>';
    h += '<span class="ok-rating__text">';
    if (size === 'md') {
      h += '<span class="ok-rating__top">' + (o.label ? '<span class="ok-rating__label">' + esc(o.label) + '</span>' : '') + '<span class="ok-rating__score">' + esc(score) + '</span><span class="ok-rating__band">' + esc(BAND[band].label) + '</span></span>';
      if (r.headline) h += '<span class="ok-rating__head">' + esc(r.headline) + '</span>';
    } else {
      return '<span class="ok-rating ok-rating--lg' + (band === 'na' ? ' ok-rating--na' : '') + '" title="' + esc(aria) + '">' + (o.label ? '<span class="ok-rating__label">' + esc(o.label) + '</span>' : '') +
        '<span class="ok-rating__row">' + html.band(band, px) + '<span class="ok-rating__score">' + esc(score) + '</span><span class="ok-rating__band">' + esc(BAND[band].label) + '</span></span>' +
        (r.headline ? '<span class="ok-rating__head">' + esc(r.headline) + '</span>' : '') + '</span>';
    }
    return h + '</span></span>';
  };
  html.lensChip = (lensId) => {
    const l = LENS[lensId];
    return '<span class="ok-chip ok-chip--lens"><span class="ok-swatch ok-lh-' + esc(lensId) + '"></span>' + esc(l ? l.label : lensId) + '</span>';
  };
  html.statusChip = (status) => '<span class="ok-chip ok-chip--status' + (status === 'blocked' ? ' ok-chip--alarm' : '') + '">' + html.status(status, 12) + esc(OK.statusLabel(status)) + '</span>';
  html.gateChip = (gate) => {
    const kind = typeof gate === 'string' ? gate : gate.kind;
    return '<span class="ok-chip ' + (kind === 'changes' ? 'ok-chip--alarm' : 'ok-chip--gate') + (kind === 'triage' ? ' ok-chip--triage' : '') + '">' + html.gate(kind, 12) + esc(GATE[kind] ? GATE[kind].long : kind) + '</span>';
  };
  html.bandChip = (band) => '<span class="ok-chip ok-chip--' + band + '">' + html.band(band, 12) + esc(OK.bandLabel(band)) + '</span>';
  html.priority = (p) => '<span class="ok-chip ok-chip--mono" title="Priority ' + esc(p) + '">' + esc(p) + '</span>';
  html.releaseChip = (f) => {
    const rel = f.release ? BP.release(f.release) : null;
    if (!rel) return '<span class="ok-chip ok-chip--mono ok-muted">Unscheduled</span>';
    const verb = f.status === 'live' ? 'Shipped in ' : 'Targets ';
    return '<span class="ok-chip ok-chip--mono" title="' + esc(verb + rel.label + ' · ' + fmt.date(rel.date)) + '">' + esc(verb + rel.label) + '</span>';
  };
  OK.html = html;

  // ══ blocks (markup strings; clickable items use data-ok-* attributes the shell handles) ═══════════
  let currentLens = 'overall';
  const blocks = {};
  const nodeRating = (ref, lens) => {
    if (ref.type === 'module') return BP.moduleRating(ref.id, lens);
    if (ref.type === 'domain') return BP.domainRating(ref.id, lens);
    if (ref.type === 'area') return BP.areaRating(ref.id, lens);
    return BP.productRating(lens);
  };
  const nodeFeatures = (ref) => (ref.type === 'module' ? BP.featuresOf(ref.id) : ref.type === 'domain' ? BP.featuresOfDomain(ref.id) : ref.type === 'area' ? BP.featuresOfArea(ref.id) : BP.features);
  const nodeRollup = (ref) => (ref.type === 'module' ? BP.moduleRollup(ref.id) : ref.type === 'domain' ? BP.domainRollup(ref.id) : ref.type === 'area' ? BP.areaRollup(ref.id) : BP.productRollup());
  OK.nodeRating = nodeRating;
  OK.nodeFeatures = nodeFeatures;
  OK.nodeRollup = nodeRollup;

  blocks.ratingTable = function (nodeRef, opts) {
    const lens = (opts && opts.lens) || currentLens;
    let h = '<table class="ok-rtable"><thead><tr><th>Lens</th><th>Score</th><th>Spread</th><th style="text-align:right">n/a</th></tr></thead><tbody>';
    LENS_DEFS.forEach((l) => {
      const r = nodeRating(nodeRef, l.id);
      const c = r.counts || {};
      const tot = (c.good || 0) + (c.fair || 0) + (c.poor || 0) + (c.critical || 0);
      let dist = '<span class="ok-dist" role="img" aria-label="' + esc(['good', 'fair', 'poor', 'critical'].map((b) => (c[b] || 0) + ' ' + b).join(', ')) + '">';
      if (tot) ['good', 'fair', 'poor', 'critical'].forEach((b) => { if (c[b]) dist += '<i class="ok-d-' + b + '" style="width:' + fx(100 * c[b] / tot) + '%"></i>'; });
      dist += '</span>';
      h += '<tr' + (l.id === lens ? ' class="is-current"' : '') + '><td><span class="ok-rt-lens"><button type="button" data-ok-setlens="' + l.id + '" title="Switch to the ' + esc(l.label) + ' lens">' + html.jewel(l.id, r.band, 16) + esc(l.label) + '</button></span></td>' +
        '<td class="ok-rt-score">' + html.rating(r, { size: 'sm', label: l.label }) + '</td><td style="width:38%">' + dist + '</td><td class="ok-rt-na">' + (c.na || 0) + '</td></tr>';
    });
    return h + '</tbody></table>';
  };
  blocks.statusBar = function (rollup) {
    const r = rollup || BP.productRollup();
    const total = r.count || 0;
    let bar = '<div class="ok-sbar" role="img" aria-label="' + esc(STATUS_IDS.map((s) => (r.byStatus[s] || 0) + ' ' + OK.statusLabel(s).toLowerCase()).join(', ')) + '">';
    STATUS_IDS.forEach((s) => { const n = r.byStatus[s] || 0; if (n) bar += '<i class="ok-s-' + s + '" style="flex:' + n + '"></i>'; });
    bar += '</div><div class="ok-slegend">' + STATUS_IDS.map((s) => '<span>' + html.status(s, 11) + esc(OK.statusLabel(s)) + ' <b>' + (r.byStatus[s] || 0) + '</b></span>').join('') + '</div>';
    const b = r.byBuilder || {};
    const g = r.gates || {};
    bar += '<div class="ok-statline"><span>' + plural(total, 'feature') + '</span><span>Agent <b>' + (b.agent || 0) + '</b> · Pair <b>' + (b.pair || 0) + '</b> · Human <b>' + (b.human || 0) + '</b></span>' +
      '<span class="is-alarm">Attention <b>' + (r.attention || 0) + '</b></span><span class="is-gate">Gates <b>' + ((g.triage || 0) + (g.approval || 0) + (g.changes || 0)) + '</b></span></div>';
    return bar;
  };
  blocks.featureList = function (features, opts) {
    const o = opts || {};
    const lens = o.lens || currentLens;
    const list = asList(features).map(featureOf).filter(Boolean);
    if (!list.length) return '<p class="ok-empty">' + esc(o.empty || 'No features.') + '</p>';
    const limit = o.limit || 80;
    let h = '<ul class="ok-flist">';
    list.slice(0, limit).forEach((f) => {
      const r = BP.rating(f, lens);
      const attn = BP.needsAttention(f);
      const sub = o.path ? BP.module(f.moduleId).name : o.sub ? o.sub(f) : '';
      h += '<li><button type="button" class="ok-frow' + (attn ? ' is-attn' : '') + '" data-ok-' + (o.action || 'peek') + '="' + esc(f.id) + '">' + html.status(f.status, 13, OK.statusLabel(f.status)) +
        '<span class="ok-frow__name">' + esc(f.name) + (sub ? '<span class="ok-frow__sub">' + esc(sub) + '</span>' : '') + '</span><span class="ok-frow__end">' + (attn ? html.attention(12) : '') + html.rating(r, { size: 'sm', label: LENS[lens].label }) + '</span></button></li>';
    });
    h += '</ul>';
    if (list.length > limit) h += '<p class="ok-empty ok-more">and ' + (list.length - limit) + ' more</p>';
    return h;
  };
  blocks.gates = function (features, opts) {
    const o = opts || {};
    const all = [];
    asList(features).map(featureOf).filter(Boolean).forEach((f) => BP.gates(f).forEach((g) => all.push({ f, g })));
    const c = { triage: 0, approval: 0, changes: 0 };
    all.forEach((x) => { c[x.g.kind] = (c[x.g.kind] || 0) + 1; });
    let h = '<div class="ok-gsum">' + ['triage', 'approval', 'changes'].map((k) => '<div class="ok-gsum__cell is-' + k + '"><b>' + c[k] + '</b><span>' + GATE[k].long + '</span></div>').join('') + '</div>';
    if (!all.length) return h + '<p class="ok-empty">Nothing is waiting for a human.</p>';
    all.sort((a, b) => (b.g.waitingDays || 0) - (a.g.waitingDays || 0));
    const limit = o.limit || 6;
    h += '<ul class="ok-flist ok-glist">' + all.slice(0, limit).map((x) => '<li><button type="button" class="ok-frow" data-ok-open="' + esc(x.f.id) + '" data-ok-tab="work">' + html.gate(x.g.kind, 13) +
      '<span class="ok-frow__name">' + esc(x.f.name) + '<span class="ok-frow__sub">' + esc(GATE[x.g.kind].long + ': ' + x.g.title) + '</span></span><span class="ok-frow__end">' + esc(x.g.waitingDays === 0 ? 'today' : x.g.waitingDays + ' d') + '</span></button></li>').join('') + '</ul>';
    if (all.length > limit) h += '<p class="ok-empty ok-more">' + (all.length - limit) + ' more waiting</p>';
    return h;
  };
  blocks.releasePackage = function (releaseId, opts) {
    const o = opts || {};
    const rel = releaseOf(releaseId);
    if (!rel) return '<p class="ok-empty">Unknown release.</p>';
    const items = asList(BP.releaseItems(rel.id)).map((it) => ({ f: featureOf(it.feature), kind: it.kind, note: it.note })).filter((x) => x.f);
    const counts = { new: 0, improved: 0, fixed: 0 };
    items.forEach((x) => { counts[x.kind] = (counts[x.kind] || 0) + 1; });
    const byDomain = new Map();
    items.forEach((x) => {
      const p = BP.pathOf(x.f);
      const key = p.domain.id;
      if (!byDomain.has(key)) byDomain.set(key, []);
      byDomain.get(key).push(x);
    });
    const stateLabel = rel.state === 'shipped' ? 'Shipped' : rel.state === 'next' ? 'Next release' : 'Future';
    const planned = rel.state !== 'shipped'; // not shipped yet: show how ready each new feature is
    let h = '<div class="ok-rel" data-ok-release="' + esc(rel.id) + '">';
    if (!o.noHead) {
      h += '<div class="ok-rel__head"><span class="ok-rel__label">' + esc(rel.label) + '</span><span class="ok-rel__name">' + esc(rel.name || '') + '</span>' +
        '<span class="ok-statepill ok-statepill--' + esc(rel.state) + '">' + stateLabel + '</span><span class="ok-rel__date">' + esc(fmt.date(rel.date)) + ' · ' + esc(fmt.rel(rel.date)) + '</span></div>';
      if (rel.summary) h += '<p class="ok-rel__sum">' + esc(rel.summary) + '</p>';
    }
    h += '<div class="ok-rel__counts">' + ['new', 'improved', 'fixed'].map((k) => '<span>' + svg.wrap(svg.releaseKind(k, 5), 6, 12) + REL_KIND[k] + ' <b>' + counts[k] + '</b></span>').join('') + '<span>' + plural(items.length, 'item') + '</span></div>';
    if (planned && items.length) {
      const st = {};
      items.forEach((x) => { if (x.kind === 'new') st[x.f.status] = (st[x.f.status] || 0) + 1; });
      h += '<div class="ok-rel__counts ok-rel__ready" title="Status of the new features in this release">' + STATUS_IDS.filter((k) => st[k]).map((k) => '<span>' + html.status(k, 11) + esc(OK.statusLabel(k)) + ' <b>' + st[k] + '</b></span>').join('') + '</div>';
    }
    if (!items.length) return h + '<p class="ok-empty">Nothing is packaged in this release yet.</p></div>';
    BP.domains.forEach((d) => {
      const list = byDomain.get(d.id);
      if (!list) return;
      const order = { new: 0, improved: 1, fixed: 2 };
      list.sort((a, b) => order[a.kind] - order[b.kind]);
      h += '<section class="ok-rel__dom"><h4><span class="ok-mono">' + esc(d.code || '') + '</span>' + esc(d.name) + ' <span class="ok-mono">' + list.length + '</span></h4>' +
        list.map((x) => {
          const st = planned && x.kind === 'new' ? x.f.status : null;
          return '<button type="button" class="ok-ritem' + (st ? ' has-status' : '') + '" data-ok-peek="' + esc(x.f.id) + '" title="' + esc(REL_KIND[x.kind] + ': ' + x.f.name + (st ? ' · ' + OK.statusLabel(st) : '')) + '">' + svg.wrap(svg.releaseKind(x.kind, 5), 6, 13) +
            '<span>' + esc(x.f.name) + (x.note ? '<span class="ok-ritem__note">' + esc(REL_KIND[x.kind] + ' · ' + x.note) + '</span>' : '') + '</span>' + (st ? html.status(st, 12, OK.statusLabel(st)) : '') + '</button>';
        }).join('') + '</section>';
    });
    return h + '</div>';
  };
  OK.blocks = blocks;

  // ══ shell ═════════════════════════════════════════════════════════════════════════════════════
  const THEMES = ['light', 'dark', 'auto'];
  const THEME_KEY = 'orbit-kit.theme';
  const THEME_LABEL = { light: 'Light', dark: 'Dark', auto: 'Auto' };
  const PHONE_MQ = window.matchMedia('(max-width: 760px)');
  const DARK_MQ = window.matchMedia('(prefers-color-scheme: dark)');
  const isPhone = () => PHONE_MQ.matches;

  OK.mount = function (opts) {
    const o = opts || {};
    const root = o.root || document.getElementById('app') || document.body;
    const product = BP.product || (BP.data && BP.data.product) || { name: 'Product' };
    const S = { lens: 'overall', view: 'map', statuses: new Set(), query: '', initiative: null, gates: null, attention: false, selection: null, theme: 'light', page: null };
    const listeners = {};
    const emit = (evt, payload) => (listeners[evt] || []).slice().forEach((fn) => { try { fn(payload, S); } catch (e) { console.error(e); } });
    const local = { branch: new Map(), wi: new Map(), noteOpen: null };
    let dimmed = new Set(), hits = new Set();
    let inspCurrent = null; // { kind: 'peek' | 'node' | 'custom', ref, onClose }
    let legendOpen = false, sheet = null, iniOpen = false, searchOpen = false, srIndex = -1;
    let ledgerFilter = { lens: 'all', actor: 'all' };
    let returnFocus = null;
    let fitReady = false;
    let pageObserver = null;
    let inspTop = 0; // the inspector's scroll offset, tracked from scroll events so it is never read synchronously
    let selSrc = null; // who causes the next select when the kit does: 'inspector' | 'page' | 'search' | 'kit' (else 'variant')
    // Variant keys appended to the legend's key line: [['F', 'Focus branch'], ['[ ]', 'Previous / next gate']].
    const variantKeys = asList(o.keys).filter((k) => Array.isArray(k) && k.length > 1 && k[0] != null && k[1] != null);
    const productRef = () => ({ type: 'product', id: String(product.id || 'product') });
    // Token values and the shell size, cached by the fit pass (mount, font load, the frame after a resize, the phone
    // breakpoint), so the inspector hints and freeRectHint() never read layout.
    const M = { w: 0, h: 0, phone: false, barH: 56, filterH: 46, inspW: 392, legendW: 300, sheet: 0.62 };

    document.documentElement.classList.add('ok-app');
    root.classList.add('ok-root');
    root.innerHTML = shellHTML();
    const shellEl = root.querySelector('.ok-shell');
    shellEl.querySelector('.ok-insp__scroll').addEventListener('scroll', (e) => { inspTop = e.currentTarget.scrollTop; }, { passive: true });
    const $ = (sel) => shellEl.querySelector(sel);
    const el = {
      top: $('.ok-top'), brand: $('.ok-brand'), lenses: $('.ok-lenses'), search: $('.ok-search'), q: $('.ok-search__input'), qClear: $('.ok-search__clear'), sr: $('.ok-search__results'),
      filters: $('.ok-filters'), fFull: $('.ok-filters__full'), fBtn: $('.ok-filters-btn'), fShown: $('.ok-filters-shown'), readout: $('.ok-readout'), stage: $('.ok-stage'),
      map: $('.ok-map'), timeline: $('.ok-timeline'), insp: $('.ok-insp'), inspKicker: $('.ok-insp__kicker'), inspScroll: $('.ok-insp__scroll'), inspFoot: $('.ok-insp__foot'),
      legend: $('.ok-legend'), iniPop: $('.ok-ini-pop'), scrim: $('.ok-scrim'), sheet: $('.ok-sheet'), sheetTitle: $('.ok-sheet__title'), sheetBody: $('.ok-sheet__body'), sheetFoot: $('.ok-sheet__foot'),
      page: $('.ok-page'), live: $('.ok-live'), themeBtn: $('[data-ok-theme-cycle]'), legendBtn: $('[data-ok-legend]'),
    };

    function shellHTML() {
      const lensBtn = (l) => {
        const r = BP.productRating(l.id);
        const keyN = LENS_IDS.indexOf(l.id) + 1;
        return '<button type="button" class="ok-lens" data-ok-setlens="' + l.id + '" aria-pressed="false" aria-keyshortcuts="' + keyN + '" title="' + esc(l.label + ' · ' + l.question + ' (' + keyN + ')') + '" aria-label="' + esc(l.label + ' lens, product ' + (r.band === 'na' ? 'not applicable' : BAND[r.band].label.toLowerCase() + ' ' + fmt.score(r.score))) + '">' +
          html.jewel(l.id, r.band, 18) + '<span class="ok-lens__name"><span class="ok-lens__full">' + esc(l.label) + '</span><span class="ok-lens__short">' + esc(l.short) + '</span></span><span class="ok-lens__score">' + esc(r.band === 'na' ? '–' : fmt.score(r.score)) + '</span></button>';
      };
      const roles = LENS_DEFS.filter((l) => l.group === 'role'), specs = LENS_DEFS.filter((l) => l.group !== 'role');
      return '<div class="ok-shell" data-ok-lens="overall" data-ok-view="map">' +
        '<header class="ok-top">' +
          '<div class="ok-brand">' + svg.mark(26) + '<div class="ok-brand__text"><div class="ok-brand__line"><span class="ok-brand__name">' + esc(product.name) + '</span>' +
            '<span class="ok-brand__ver" title="Live version, then the next release">v' + esc(product.version || '') + (product.nextVersion ? ' → ' + esc(product.nextVersion) : '') + '</span></div>' +
            (o.variant ? '<div class="ok-brand__variant" title="Round 2 variant">' + esc(o.variant) + '</div>' : '') + '</div></div>' +
          '<div class="ok-viewsw" role="group" aria-label="View">' +
            '<button type="button" data-ok-view="map" aria-pressed="true" title="Map (V)">' + svg.icon('map', 14) + '<span class="ok-viewsw__t">Map</span></button>' +
            '<button type="button" data-ok-view="timeline" aria-pressed="false" title="Timeline (V)">' + svg.icon('timeline', 14) + '<span class="ok-viewsw__t">Timeline</span></button></div>' +
          '<nav class="ok-lenses" aria-label="Lens"><div class="ok-lens-group" role="group" aria-label="Role lenses">' + roles.map(lensBtn).join('') + '</div><span class="ok-lens-div" aria-hidden="true"></span>' +
            '<div class="ok-lens-group" role="group" aria-label="Specialist lenses">' + specs.map(lensBtn).join('') + '</div></nav>' +
          '<span class="ok-top__break" aria-hidden="true"></span>' +
          '<div class="ok-tools">' +
            '<div class="ok-search" role="search">' + svg.icon('search', 14) +
              '<input class="ok-search__input" id="ok-search" type="search" placeholder="Search features" aria-label="Search features" autocomplete="off" spellcheck="false" aria-keyshortcuts="/" aria-controls="ok-search-results" aria-expanded="false">' +
              '<button type="button" class="ok-search__clear" aria-label="Clear search" hidden>' + svg.icon('close', 12) + '</button>' +
              '<div class="ok-search__results ok-panel" id="ok-search-results" role="listbox" aria-label="Matching features" hidden></div></div>' +
            '<button type="button" class="ok-ibtn ok-search-btn" data-ok-search-open aria-label="Search features" title="Search (/)">' + svg.icon('search', 17) + '</button>' +
            '<button type="button" class="ok-ibtn ok-not-phone" data-ok-legend aria-pressed="false" aria-label="Show legend" aria-keyshortcuts="L" title="Legend (L)">' + svg.icon('legend', 16) + '</button>' +
            '<button type="button" class="ok-ibtn ok-not-phone" data-ok-theme-cycle aria-label="Theme"></button>' +
            '<button type="button" class="ok-ibtn ok-only-phone" data-ok-menu aria-label="Menu: theme and legend">' + svg.icon('menu', 18) + '</button>' +
          '</div></header>' +
        '<div class="ok-filters" role="toolbar" aria-label="Filters">' +
          '<button type="button" class="ok-btn ok-btn--sm ok-filters-btn" data-ok-filters-open>' + svg.icon('filter', 13) + '<span>Filters</span><span class="ok-mono ok-filters-n"></span></button>' +
          '<span class="ok-filters-shown ok-mono" aria-hidden="true"></span><div class="ok-filters__full"></div><div class="ok-readout" aria-live="off"></div></div>' +
        '<main class="ok-stage" aria-label="Map and timeline"><div class="ok-view ok-map" role="region" aria-label="Map"></div><div class="ok-view ok-timeline" role="region" aria-label="Timeline" hidden></div></main>' +
        '<aside class="ok-insp ok-panel" aria-label="Inspector" hidden><div class="ok-insp__top"><div class="ok-insp__kicker"></div><button type="button" class="ok-closex" data-ok-close="insp" aria-label="Close inspector">' + svg.icon('close', 13) + '</button></div>' +
          '<div class="ok-insp__scroll" tabindex="-1"></div><div class="ok-insp__foot"></div></aside>' +
        '<aside class="ok-legend ok-panel" aria-label="Legend" hidden></aside>' +
        '<div class="ok-ini-pop ok-pop ok-panel" role="dialog" aria-label="Initiatives" hidden></div>' +
        '<section class="ok-page" aria-label="Feature page" hidden></section>' +
        '<div class="ok-scrim" data-ok-close="sheet" hidden></div>' +
        '<div class="ok-sheet ok-panel" role="dialog" aria-modal="true" hidden><div class="ok-sheet__top"><span class="ok-sheet__title"></span><button type="button" class="ok-closex" data-ok-close="sheet" aria-label="Close">' + svg.icon('close', 13) + '</button></div><div class="ok-sheet__body"></div><div class="ok-sheet__foot"></div></div>' +
        '<div class="ok-live ok-vh" aria-live="polite"></div>' +
        '</div>';
    }

    // ── derived filter state (recomputed on filter events only) ─────────────────────────────────
    const filterActive = () => S.statuses.size > 0 || !!S.query.trim() || !!S.initiative || !!S.gates || S.attention;
    const filterCount = () => S.statuses.size + (S.query.trim() ? 1 : 0) + (S.initiative ? 1 : 0) + (S.gates ? 1 : 0) + (S.attention ? 1 : 0);
    function recompute() {
      dimmed = new Set();
      hits = new Set();
      const q = S.query.trim();
      if (filterActive()) {
        const filter = { statuses: coll(S.statuses), query: q, initiative: S.initiative, gates: S.gates, attentionOnly: S.attention };
        BP.features.forEach((f) => { if (!BP.matches(f, filter)) dimmed.add(f.id); });
      }
      if (q) asList(BP.search(q)).forEach((f) => hits.add(typeof f === 'string' ? f : f.id));
      shellEl.classList.toggle('ok-filtering', filterActive());
    }

    // ── renderers ───────────────────────────────────────────────────────────────────────────────
    function syncLensBar() {
      shellEl.setAttribute('data-ok-lens', S.lens);
      el.lenses.querySelectorAll('[data-ok-setlens]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-ok-setlens') === S.lens)));
      if (isPhone()) {
        // Measure in the next frame, after the browser's own layout, so a lens switch never forces one.
        requestAnimationFrame(() => {
          const b = el.lenses.querySelector('[aria-pressed="true"]');
          if (!b) return;
          const left = b.offsetLeft - (el.lenses.clientWidth - b.offsetWidth) / 2;
          el.lenses.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
        });
      }
    }
    function statusChips(big) {
      const roll = BP.productRollup();
      return STATUS_IDS.map((s) => '<button type="button" class="ok-fchip ok-fchip--status" data-ok-status="' + s + '" aria-pressed="' + S.statuses.has(s) + '" title="' + esc(OK.statusLabel(s) + (STATUS[s].description ? ': ' + STATUS[s].description : '')) + '" aria-label="' + esc(OK.statusLabel(s) + ', ' + (roll.byStatus[s] || 0) + ' features') + '">' +
        html.status(s, 12) + '<span class="ok-fchip__t">' + esc(OK.statusLabel(s)) + '</span><span class="ok-fchip__n">' + (roll.byStatus[s] || 0) + '</span></button>').join('');
    }
    function gatesControl() {
      const g = BP.productRollup().gates || {};
      const total = (g.triage || 0) + (g.approval || 0) + (g.changes || 0);
      return '<div class="ok-gates" role="group" aria-label="Human gates">' +
        '<button type="button" class="ok-gates__main" data-ok-gates="any" aria-pressed="' + (S.gates === 'any') + '" aria-keyshortcuts="G" title="Everything waiting for a human (G)" aria-label="Human gates, ' + total + ' waiting">' + html.gate('approval', 13) + '<span class="ok-gates__t">Human gates</span></button>' +
        ['triage', 'approval', 'changes'].map((k) => '<button type="button" data-ok-gates="' + k + '" aria-pressed="' + (S.gates === k) + '" title="' + esc(GATE[k].long) + '" aria-label="' + esc(GATE[k].long + ', ' + (g[k] || 0)) + '"><span class="ok-gates__g">' + html.gate(k, 12) + '</span><span class="ok-gates__t">' + GATE[k].label + '</span><span class="ok-gates__n' + (k === 'changes' ? ' is-alarm' : '') + '">' + (g[k] || 0) + '</span></button>').join('') + '</div>';
    }
    function attentionControl() {
      const n = BP.productRollup().attention || 0;
      return '<button type="button" class="ok-fchip ok-attn" data-ok-attn aria-pressed="' + S.attention + '" aria-keyshortcuts="A" title="Blocked, critical in any lens, or changes requested (A)" aria-label="Needs attention, ' + n + ' features">' + html.attention(13) + '<span class="ok-fchip__t">Attention</span><span class="ok-fchip__n">' + n + '</span></button>';
    }
    function iniButton() {
      const ini = S.initiative ? BP.initiative(S.initiative) : null;
      return '<button type="button" class="ok-fchip ok-fchip--ini" data-ok-ini-toggle aria-haspopup="dialog" aria-expanded="' + iniOpen + '" aria-pressed="' + !!ini + '" title="' + esc(ini ? 'Initiative: ' + ini.name : 'Highlight an initiative') + '">' +
        svg.icon('goal', 13) + '<span class="ok-fchip__t">' + esc(ini ? ini.name : 'Initiatives') + '</span>' + svg.icon('chev', 12).replace('ok-glyph', 'ok-glyph ok-chev') + '</button>';
    }
    function renderFilters() {
      const total = BP.features.length;
      const shown = total - dimmed.size;
      el.fFull.innerHTML =
        '<div class="ok-fgroup" role="group" aria-label="Status"><span class="ok-fgroup__label">Status</span>' + statusChips() + '</div><span class="ok-fsep" aria-hidden="true"></span>' +
        iniButton() + gatesControl() + attentionControl() +
        (filterActive() ? '<button type="button" class="ok-clear" data-ok-clear>' + svg.icon('close', 10) + 'Clear</button><span class="ok-showing" title="Features that match the filters">' + shown + ' of ' + total + '</span>' : '');
      el.fBtn.querySelector('.ok-filters-n').textContent = filterActive() ? String(filterCount()) : '';
      el.fShown.textContent = filterActive() ? shown + ' of ' + total : '';
      el.fBtn.setAttribute('aria-label', 'Filters' + (filterActive() ? ', ' + filterCount() + ' active, ' + shown + ' of ' + total + ' features shown' : ''));
      el.fBtn.classList.toggle('ok-btn--primary', filterActive());
      if (typeof fitFilters === 'function' && fitReady) fitFilters();
      if (sheet === 'filters') renderSheet();
      if (iniOpen) renderIniPop();
    }
    function renderReadout() {
      const l = LENS[S.lens];
      const r = BP.productRating(S.lens);
      const c = r.counts || {};
      el.readout.innerHTML = '<span class="ok-readout__q" title="' + esc(l.label + ': ' + l.question) + '"><b>' + esc(l.label) + '</b><span>' + esc(l.question) + '</span></span>' +
        '<span class="ok-bandcounts" role="img" aria-label="' + esc(l.label + ' lens: ' + BAND_IDS.map((b) => (c[b] || 0) + ' ' + BAND[b].label.toLowerCase()).join(', ')) + '">' +
        BAND_IDS.map((b) => '<span class="ok-bandcount" title="' + esc(BAND[b].label + (b === 'na' ? '' : ' (' + BAND[b].range + ')')) + '">' + html.band(b, 12) + (c[b] || 0) + '</span>').join('') + '</span>';
    }
    function renderSearch() {
      const q = S.query.trim();
      el.qClear.hidden = !S.query;
      if (!searchOpen || !q) { el.sr.hidden = true; el.q.setAttribute('aria-expanded', 'false'); return; }
      const res = asList(BP.search(q)).map(featureOf).filter(Boolean);
      srIndex = clamp(srIndex, -1, Math.min(res.length, 8) - 1);
      let h = '<div class="ok-sr-head"><span>Features</span><span class="ok-mono">' + plural(res.length, 'match', 'matches') + '</span></div>';
      if (!res.length) h += '<div class="ok-sr-empty">No feature matches “' + esc(q) + '”.</div>';
      res.slice(0, 8).forEach((f, i) => {
        const p = BP.pathOf(f);
        h += '<button type="button" class="ok-sr-item' + (i === srIndex ? ' is-active' : '') + '" role="option" aria-selected="' + (i === srIndex) + '" data-ok-sr="' + esc(f.id) + '">' + html.status(f.status, 13) +
          '<span><span class="ok-sr-item__name">' + esc(f.name) + '</span><span class="ok-sr-item__path">' + esc(p.domain.name + ' › ' + p.module.name) + '</span></span>' + html.rating(BP.rating(f, S.lens), { size: 'sm', label: LENS[S.lens].label }) + '</button>';
      });
      if (res.length > 8) h += '<div class="ok-sr-empty">' + (res.length - 8) + ' more are highlighted on the map.</div>';
      el.sr.innerHTML = h;
      el.sr.hidden = false;
      el.q.setAttribute('aria-expanded', 'true');
    }
    function announce(msg) { el.live.textContent = ''; setTimeout(() => { el.live.textContent = msg; }, 30); }

    // ── initiatives picker ──────────────────────────────────────────────────────────────────────
    function coverageCounts(ini) {
      const c = { covered: 0, 'in-progress': 0, pending: 0, finding: 0 };
      asList(ini.coverage).forEach((x) => { c[x.state] = (c[x.state] || 0) + 1; });
      return c;
    }
    function coverageBlock(ini) {
      const c = coverageCounts(ini);
      const tot = COV_IDS.reduce((a, k) => a + c[k], 0) || 1;
      return '<span class="ok-cov"><span class="ok-cov__bar">' + COV_IDS.map((k) => (c[k] ? '<i class="ok-cov__' + k + '" style="width:' + fx(100 * c[k] / tot) + '%"></i>' : '')).join('') + '</span>' +
        '<span class="ok-cov__legend">' + COV_IDS.map((k) => '<span><i class="ok-cov__' + k + '"></i>' + COV[k] + ' <b>' + c[k] + '</b></span>').join('') + '</span></span>';
    }
    function iniList(asRadio) {
      const groups = [['permanent', 'Permanent'], ['temporary', 'Temporary']];
      let h = '';
      groups.forEach(([kind, label]) => {
        const list = asList(BP.initiatives).filter((x) => x.kind === kind);
        if (!list.length) return;
        h += '<div class="ok-ini-sec"><h3>' + label + '</h3>';
        list.forEach((ini) => {
          const on = S.initiative === ini.id;
          const owner = BP.person(ini.owner);
          const when = ini.endsAt ? fmt.dateShort(ini.startedAt) + ' – ' + fmt.date(ini.endsAt) : 'Since ' + fmt.date(ini.startedAt);
          h += '<button type="button" class="ok-ini-item" role="' + (asRadio ? 'radio' : 'menuitemradio') + '" aria-checked="' + on + '" data-ok-ini="' + esc(ini.id) + '">' +
            '<span class="ok-ini-item__radio">' + svg.wrap(on ? '<circle r="6" fill="none" stroke="var(--ok-ink)" stroke-width="1.4"/><circle r="3" fill="var(--ok-ink)"/>' : '<circle r="6" fill="none" stroke="var(--ok-ink-3)" stroke-width="1.2"/>', 7, 16) + '</span>' +
            '<span class="ok-ini-item__name">' + esc(ini.name) + '</span>' +
            '<span class="ok-ini-item__meta">' + esc((INI_TYPE[ini.type] || ini.type) + ' · ' + when + (owner ? ' · ' + owner.name : '')) + '</span>' + coverageBlock(ini) + '</button>';
        });
        h += '</div>';
      });
      return h;
    }
    function renderIniPop() {
      el.iniPop.innerHTML = '<div class="ok-sr-head"><span>Highlight an initiative</span>' + (S.initiative ? '<button type="button" class="ok-clear" data-ok-ini="">Show all</button>' : '<span class="ok-mono">' + asList(BP.initiatives).length + '</span>') + '</div>' + iniList(false);
    }
    function toggleIni(on) {
      const want = typeof on === 'boolean' ? on : !iniOpen;
      if (isPhone()) { iniOpen = false; el.iniPop.hidden = true; if (want) openSheet('filters'); return; }
      iniOpen = want;
      if (iniOpen) {
        renderIniPop();
        el.iniPop.hidden = false;
        const btn = el.fFull.querySelector('[data-ok-ini-toggle]');
        const sr = shellEl.getBoundingClientRect(), br = btn ? btn.getBoundingClientRect() : { left: 16, bottom: 100 };
        const w = el.iniPop.offsetWidth;
        el.iniPop.style.left = clamp(br.left - sr.left, 12, sr.width - w - 12) + 'px';
        el.iniPop.style.top = (br.bottom - sr.top + 8) + 'px';
        const first = el.iniPop.querySelector('[aria-checked="true"]') || el.iniPop.querySelector('.ok-ini-item');
        if (first) first.focus({ preventScroll: true });
      } else el.iniPop.hidden = true;
      const b = el.fFull.querySelector('[data-ok-ini-toggle]');
      if (b) b.setAttribute('aria-expanded', String(iniOpen));
    }

    // ── legend ──────────────────────────────────────────────────────────────────────────────────
    function legendHTML(withHead) {
      const l = LENS[S.lens];
      const row = (g, t) => '<div class="ok-lg-row">' + g + '<span>' + t + '</span></div>';
      let h = withHead ? '<div class="ok-lg-head"><span class="ok-cap">Legend · ' + esc(l.label) + ' lens</span><button type="button" class="ok-closex" data-ok-close="legend" aria-label="Close legend">' + svg.icon('close', 12) + '</button></div>' : '';
      h += '<section class="ok-lg-sec"><h3>Status: glyph shape</h3><div class="ok-lg-grid">' + STATUS_IDS.map((s) => row(html.status(s, 14), esc(OK.statusLabel(s)))).join('') + '</div></section>';
      h += '<section class="ok-lg-sec"><h3>Rating in the ' + esc(l.label) + ' lens</h3>' + BAND_IDS.map((b) => row(html.band(b, 14), '<b>' + esc(BAND[b].label) + '</b> · ' + esc(BAND[b].range))).join('') +
        '<p class="ok-lg-note">' + esc(l.question) + ' The fill grows with the score.</p></section>';
      const sample = BP.features.find((f) => f.status === 'live' && LENS_IDS.every((x) => BP.rating(f, x).band !== 'na')) || BP.features[0];
      h += '<section class="ok-lg-sec"><h3>Corona: every lens at once</h3>' + row(html.corona(sample, 26, { lens: S.lens }), 'Eight segments, clockwise from the top: ' + LENS_DEFS.map((x) => esc(x.label)).join(', ') + '. Faint segments do not apply. The tick marks the current lens.') + '</section>';
      h += '<section class="ok-lg-sec"><h3>Waiting for a human</h3>' + row(html.gate('triage', 14), '<b>Triage</b>: a scan finding or ticket needs a decision before the backlog') +
        row(html.gate('approval', 14), '<b>Approval</b>: a branch shows a demo or report to approve') + row(html.gate('changes', 14), '<b>Changes</b>: a reviewer asked for changes') + '</section>';
      h += '<section class="ok-lg-sec"><h3>Signals</h3>' + row(html.attention(14), '<b>Needs attention</b>: blocked, critical in any lens, or changes requested') +
        row(svg.icon('goal', 15), '<b>Initiatives</b> fade everything outside them. Nothing moves, so the map stays learnable.') + '</section>';
      if (typeof o.legend === 'function') { try { h += o.legend(S) || ''; } catch (e) { console.error(e); } }
      h += '<section class="ok-lg-sec ok-lg-keys"><span class="ok-kbd">1</span>–<span class="ok-kbd">8</span> lens · <span class="ok-kbd">V</span> map or timeline · <span class="ok-kbd">/</span> search · <span class="ok-kbd">G</span> gates · <span class="ok-kbd">A</span> attention · <span class="ok-kbd">L</span> legend · <span class="ok-kbd">Enter</span> feature page · <span class="ok-kbd">Esc</span> close' +
        variantKeys.map((k) => ' · ' + keysHTML(k[0]) + ' ' + esc(keyWords(k[1]))).join('') + '</section>';
      return h;
    }
    /** '[ ]' or ['[', ']'] → one key cap per key, side by side. */
    function keysHTML(keys) {
      return (Array.isArray(keys) ? keys : String(keys).trim().split(/\s+/)).filter((k) => k !== '').map((k) => '<span class="ok-kbd">' + esc(k) + '</span>').join(' ');
    }
    /** The kit's key line is lower case ("map or timeline"): 'Focus branch' reads 'focus branch', 'UX lens' stays. */
    function keyWords(text) {
      const s = String(text);
      return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
    }
    function renderLegend() { if (legendOpen) el.legend.innerHTML = legendHTML(true); }
    function setLegendOpen(on) {
      if (on === legendOpen) return;
      legendOpen = on;
      el.legend.hidden = !on;
      if (on) renderLegend();
      el.legendBtn.setAttribute('aria-pressed', String(on));
      el.legendBtn.setAttribute('aria-label', on ? 'Hide legend' : 'Show legend');
      shellEl.classList.toggle('ok-has-legend', on);
      emit('legend', { open: on, width: on ? M.legendW : 0 });
    }
    function toggleLegend(on) {
      // Phones have no legend panel: the legend lives in the modal "Theme and legend" sheet (no class, no event).
      if (isPhone()) { openSheet('menu'); return; }
      const want = typeof on === 'boolean' ? on : !legendOpen;
      if (want === legendOpen) { if (want) renderLegend(); return; } // toggle(true) on an open legend re-renders it
      setLegendOpen(want);
    }

    // ── phone sheets ────────────────────────────────────────────────────────────────────────────
    function renderSheet() {
      if (sheet === 'filters') {
        const total = BP.features.length, shown = total - dimmed.size;
        el.sheetTitle.textContent = 'Filters';
        el.sheetBody.innerHTML = '<section class="ok-fs-sec"><h3>Status</h3><div class="ok-fs-wrap">' + statusChips() + '</div></section>' +
          '<section class="ok-fs-sec"><h3>Human gates and attention</h3><div class="ok-fs-wrap">' + gatesControl() + attentionControl() + '</div></section>' +
          '<section class="ok-fs-sec"><h3>Initiatives</h3><div role="radiogroup" aria-label="Initiatives">' + iniList(true) + '</div></section>';
        el.sheetFoot.innerHTML = '<button type="button" class="ok-btn" data-ok-clear' + (filterActive() ? '' : ' disabled') + '>Clear</button><button type="button" class="ok-btn ok-btn--primary" data-ok-close="sheet">Show ' + shown + ' of ' + total + '</button>';
        el.sheetFoot.hidden = false;
      } else if (sheet === 'menu') {
        el.sheetTitle.textContent = 'Theme and legend';
        el.sheetBody.innerHTML = '<section class="ok-fs-sec"><h3>Theme</h3><div class="ok-themesw" role="group" aria-label="Theme">' + THEMES.map((t) => '<button type="button" data-ok-theme="' + t + '" aria-pressed="' + (S.theme === t) + '">' + svg.icon(t, 14) + THEME_LABEL[t] + '</button>').join('') + '</div></section>' +
          '<section class="ok-fs-sec">' + legendHTML(false) + '</section>';
        el.sheetFoot.innerHTML = '';
        el.sheetFoot.hidden = true;
      }
    }
    function openSheet(kind) {
      sheet = kind;
      renderSheet();
      el.sheet.hidden = false;
      el.scrim.hidden = false;
      el.sheetBody.scrollTop = 0; // a sheet always opens at its top, whatever the last one scrolled to
      el.sheet.setAttribute('aria-label', kind === 'filters' ? 'Filters' : 'Theme and legend');
      const c = el.sheet.querySelector('.ok-closex');
      if (c) c.focus({ preventScroll: true });
    }
    function closeSheet() {
      if (!sheet) return;
      const was = sheet;
      sheet = null;
      el.sheet.hidden = true;
      el.scrim.hidden = true;
      const b = was === 'filters' ? el.fBtn : $('[data-ok-menu]');
      if (b) b.focus({ preventScroll: true });
    }

    // ── state setters ───────────────────────────────────────────────────────────────────────────
    function setLens(id) {
      if (!LENS[id] || id === S.lens) return;
      S.lens = id;
      currentLens = id;
      syncLensBar();
      renderReadout();
      renderLegend();
      if (sheet === 'menu') renderSheet();
      if (searchOpen) renderSearch();
      if (inspCurrent && inspCurrent.kind !== 'custom') rerenderInspector();
      if (S.page) syncPageLens();
      announce(LENS[id].label + ' lens. ' + LENS[id].question);
      emit('lens', { lens: id });
    }
    function setView(v) {
      if (v !== 'map' && v !== 'timeline') return;
      if (S.page) closeFeature();
      if (iniOpen) toggleIni(false);
      if (searchOpen) closeSearch(true);
      if (v === S.view) return;
      S.view = v;
      shellEl.setAttribute('data-ok-view', v);
      el.map.hidden = v !== 'map';
      el.timeline.hidden = v !== 'timeline';
      shellEl.querySelectorAll('[data-ok-view]').forEach((b) => { if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.getAttribute('data-ok-view') === v)); });
      announce(v === 'map' ? 'Map view' : 'Timeline view');
      emit('view', { view: v });
    }
    function filterChanged(what) {
      recompute();
      renderFilters();
      renderSearch();
      const total = BP.features.length;
      announce(filterActive() ? (total - dimmed.size) + ' of ' + total + ' features match' : 'Filters cleared, all ' + total + ' features shown');
      emit('filter', { what, active: filterActive(), shown: total - dimmed.size });
    }
    function toggleStatus(s) { if (S.statuses.has(s)) S.statuses.delete(s); else S.statuses.add(s); filterChanged('statuses'); }
    function setInitiative(id) { S.initiative = id || null; filterChanged('initiative'); }
    function setGates(k) { S.gates = S.gates === k ? null : k; filterChanged('gates'); }
    function toggleAttention() { S.attention = !S.attention; filterChanged('attention'); }
    function setQuery(q) { S.query = q || ''; if (el.q.value !== S.query) el.q.value = S.query; srIndex = -1; filterChanged('query'); }
    function clearFilters() {
      S.statuses.clear(); S.query = ''; S.initiative = null; S.gates = null; S.attention = false; el.q.value = '';
      filterChanged('clear');
    }
    function select(ref) {
      const source = selSrc || 'variant';
      selSrc = null; // consumed here, so a listener's own select() during the emit reads 'variant'
      if (ref && ref.type === 'product' && !ref.id) ref = productRef();
      const next = ref && ref.type && ref.id ? { type: ref.type, id: ref.id } : null;
      const same = (S.selection && next && S.selection.type === next.type && S.selection.id === next.id) || (!S.selection && !next);
      S.selection = next;
      if (!next && inspCurrent && inspCurrent.kind !== 'custom') closeInspector(true);
      // The payload is a copy of the selection plus who caused it; state.selection stays { type, id }.
      if (!same) emit('select', next ? { type: next.type, id: next.id, source } : null);
    }
    /** Runs fn (a peek or inspect) as a select caused by the kit, labelled `src` in the select payload. */
    function selectBy(src, fn) {
      selSrc = src;
      try { fn(); } finally { selSrc = null; }
    }
    /** Where a clicked data-ok-* element lives decides the select source. Read it before the click closes anything. */
    function srcOf(t) {
      return el.insp.contains(t) ? 'inspector' : el.page.contains(t) ? 'page' : el.stage.contains(t) ? 'variant' : 'kit';
    }

    // ── inspector ───────────────────────────────────────────────────────────────────────────────
    function openInspector(spec, kind) {
      const prevKind = inspCurrent && inspCurrent.kind;
      if (inspCurrent && inspCurrent.onClose && kind === 'custom' && prevKind === 'custom') { try { inspCurrent.onClose(); } catch (e) { console.error(e); } }
      inspCurrent = { kind: kind || 'custom', ref: spec.ref || null, onClose: spec.onClose || null };
      el.inspKicker.innerHTML = spec.kicker || '';
      el.inspScroll.innerHTML = '<h2 class="ok-insp__title">' + (spec.title || '') + '</h2>' + (spec.subtitle ? '<div class="ok-insp__sub">' + spec.subtitle + '</div>' : '') + '<div class="ok-insp__body">' + (spec.body || '') + '</div>';
      el.inspFoot.innerHTML = spec.footer || '';
      const wasHidden = el.insp.hidden;
      el.insp.hidden = false;
      shellEl.classList.add('ok-has-insp');
      // Replacing the content keeps the scroll offset. Reset it in the next frame (before paint), and only when
      // it is not already at the top, so opening a panel never forces a synchronous layout.
      if (!spec.keepScroll && inspTop > 0) { inspTop = 0; requestAnimationFrame(() => { el.inspScroll.scrollTop = 0; }); }
      if (wasHidden) emit('inspector', inspPayload(true));
    }
    function closeInspector(silent) {
      if (el.insp.hidden) return;
      const cur = inspCurrent;
      inspCurrent = null;
      el.insp.hidden = true;
      shellEl.classList.remove('ok-has-insp');
      if (cur && cur.onClose) { try { cur.onClose(); } catch (e) { console.error(e); } }
      if (!silent && cur && cur.kind !== 'custom' && S.selection) { S.selection = null; emit('select', null); }
      emit('inspector', inspPayload(false));
    }
    /**
     * The 'inspector' event payload. `rect` is measured only when a listener reads it (it forces a layout).
     * `width` (side panel px on desktop) and `sheet` (fraction of the shell height the phone sheet covers) come from
     * the cached tokens, never from layout, and are 0 when the panel is closed or in the other layout.
     */
    function inspPayload(open) {
      return { open, width: open && !M.phone ? M.inspW : 0, sheet: open && M.phone ? M.sheet : 0, get rect() { return freeRect(); } };
    }
    function rerenderInspector() {
      // Same panel, new lens: the content is replaced in place and keeps its scroll offset.
      if (!inspCurrent || !inspCurrent.ref) return;
      if (inspCurrent.kind === 'peek') renderPeek(inspCurrent.ref.id, true);
      else if (inspCurrent.kind === 'node') renderNode(inspCurrent.ref, true);
    }
    function crumbHTML(parts) {
      return '<nav class="ok-crumb" aria-label="Breadcrumb">' + parts.map((p, i) => (i ? '<span class="ok-crumb__sep" aria-hidden="true">›</span>' : '') +
        (p.ref ? '<button type="button" data-ok-inspect="' + p.ref.type + ':' + esc(p.ref.id) + '" title="Inspect ' + esc(p.label) + '">' + esc(p.label) + '</button>' : '<span>' + esc(p.label) + '</span>')).join('') + '</nav>';
    }
    function lensGrid(f) {
      return '<div class="ok-lensgrid">' + LENS_DEFS.map((l) => {
        const r = BP.rating(f, l.id);
        return '<button type="button" class="ok-lensrow' + (l.id === S.lens ? ' is-current' : '') + '" data-ok-setlens="' + l.id + '" title="' + esc(l.label + ': ' + (r.headline || BAND[r.band].label)) + '">' + html.band(r.band, 13) +
          '<span class="ok-lensrow__name">' + esc(l.short) + '</span><span class="ok-lensrow__score' + (r.band === 'na' ? ' is-na' : '') + '">' + (r.band === 'na' ? 'n/a' : fmt.score(r.score)) + '</span><span class="ok-swatch ok-lh-' + l.id + '" aria-hidden="true" style="width:6px;height:6px"></span></button>';
      }).join('') + '</div>';
    }
    function teamLabel(id) { const t = BP.team(id); return t ? t.name : id || '–'; }
    function renderPeek(id, keepScroll) {
      const f = BP.feature(id);
      if (!f) return;
      const p = BP.pathOf(f);
      const r = BP.rating(f, S.lens);
      const gates = BP.gates(f);
      const attn = BP.needsAttention(f);
      const deps = asList(BP.dependencies(f)), dents = asList(BP.dependents(f));
      const inis = asList(BP.initiativesOf(f));
      const changes = f.branches.find((b) => b.state === 'changes-requested');
      let body = '<div class="ok-peek-head">' + html.corona(f, 46, { lens: S.lens, label: 'State in every lens' }) + html.rating(r, { size: 'md', label: LENS[S.lens].label }) + '</div>';
      body += '<p class="ok-summary" style="margin-top:14px">' + esc(f.summary) + '</p>';
      if (f.status === 'blocked' && f.blockedReason) body += '<div class="ok-callout ok-callout--alarm"><b>Blocked</b>' + esc(f.blockedReason) + '</div>';
      else if (changes) body += '<div class="ok-callout ok-callout--alarm"><b>Changes requested' + (changes.reviewer && BP.person(changes.reviewer) ? ' by ' + esc(BP.person(changes.reviewer).name) : '') + '</b>' + esc(changes.note || '') + '</div>';
      if (f.note) body += '<div class="ok-callout"><b>Note</b>' + esc(f.note) + '</div>';
      if (gates.length) {
        body += '<section class="ok-sec" style="margin-top:18px"><h3 class="ok-sec__h"><span>Waiting for a human</span><span class="ok-mono">' + gates.length + '</span></h3><ul class="ok-flist">' +
          gates.map((g) => '<li><button type="button" class="ok-frow" data-ok-open="' + esc(f.id) + '" data-ok-tab="work">' + html.gate(g.kind, 13) + '<span class="ok-frow__name">' + esc(g.title) + '<span class="ok-frow__sub">' + esc(GATE[g.kind].long) + '</span></span><span class="ok-frow__end">' + esc(g.waitingDays === 0 ? 'today' : g.waitingDays + ' d') + '</span></button></li>').join('') + '</ul></section>';
      }
      body += '<section class="ok-sec" style="margin-top:18px"><h3 class="ok-sec__h"><span>In every lens</span><span>' + (attn ? html.attention(12) + ' <span style="color:var(--ok-alarm)">Needs attention</span>' : '') + '</span></h3>' + lensGrid(f) + '</section>';
      body += '<section class="ok-sec" style="margin-top:18px"><dl class="ok-facts">' +
        '<dt>Owner</dt><dd>' + esc(teamLabel(f.owner)) + (BP.team(f.owner) ? ' <small>· ' + (BP.team(f.owner).kind === 'agent' ? 'agent crew' : 'human squad') + '</small>' : '') + '</dd>' +
        '<dt>Built by</dt><dd>' + esc(BUILDER[f.builtBy] || f.builtBy) + '</dd>' +
        '<dt>Updated</dt><dd><span class="ok-mono">' + esc(fmt.date(f.updatedAt)) + '</span> <small>· ' + esc(fmt.rel(f.updatedAt)) + '</small></dd>' +
        '<dt>Links</dt><dd>Depends on <span class="ok-mono">' + deps.length + '</span> · used by <span class="ok-mono">' + dents.length + '</span></dd>' +
        (inis.length ? '<dt>Initiatives</dt><dd>' + inis.map((x) => esc(initiativeOf(x.initiative).name) + ' <small>· ' + esc((COV[x.state] || x.state).toLowerCase()) + '</small>').join('<br>') + '</dd>' : '') +
        '</dl></section>';
      openInspector({
        kicker: crumbHTML([{ label: p.domain.name, ref: { type: 'domain', id: p.domain.id } }, { label: p.module.name, ref: { type: 'module', id: p.module.id } }]),
        title: esc(f.name),
        subtitle: html.statusChip(f.status) + html.priority(f.priority) + html.releaseChip(f) + (gates.length ? html.gateChip(gates[0]) : ''),
        body,
        footer: '<button type="button" class="ok-btn ok-btn--primary" data-ok-open="' + esc(f.id) + '">Open feature page' + svg.icon('arrow', 13) + '</button>',
        ref: { type: 'feature', id: f.id }, keepScroll,
      }, 'peek');
    }
    function peek(id) {
      const f = BP.feature(id);
      if (!f) return;
      select({ type: 'feature', id: f.id });
      renderPeek(f.id);
    }
    function nodeInfo(ref) {
      if (ref.type === 'module') { const m = BP.module(ref.id); const d = BP.domain(m.domainId); const a = BP.area(d.areaId); return { node: m, name: m.name, crumb: [{ label: a.name, ref: { type: 'area', id: a.id } }, { label: d.name, ref: { type: 'domain', id: d.id } }], kind: 'Module' }; }
      if (ref.type === 'domain') { const d = BP.domain(ref.id); const a = BP.area(d.areaId); return { node: d, name: d.name, crumb: [{ label: a.name, ref: { type: 'area', id: a.id } }], kind: 'Domain', code: d.code }; }
      if (ref.type === 'area') { const a = BP.area(ref.id); return { node: a, name: a.name, crumb: [{ label: product.name }], kind: 'Area' }; }
      return null;
    }
    function renderNode(ref, keepScroll) {
      if (ref.type === 'release') return renderRelease(ref.id, keepScroll);
      if (ref.type === 'feature') return renderPeek(ref.id, keepScroll);
      if (ref.type === 'product') return renderProduct(keepScroll);
      const info = nodeInfo(ref);
      if (!info || !info.node) return;
      const lens = S.lens;
      const r = nodeRating(ref, lens);
      const feats = asList(nodeFeatures(ref));
      const roll = nodeRollup(ref);
      const worst = asList(r.worst).map(featureOf).filter(Boolean);
      const g = roll.gates || {};
      let body = info.node.summary ? '<p class="ok-summary">' + esc(info.node.summary) + '</p>' : '';
      body += '<section class="ok-sec" style="margin-top:16px"><h3 class="ok-sec__h"><span>' + esc(LENS[lens].label) + ' lens</span><span class="ok-mono">' + r.applicable + ' rated</span></h3>' + html.rating({ band: r.band, score: r.score, headline: LENS[lens].question }, { size: 'lg' }) + '</section>';
      body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Status</span></h3>' + blocks.statusBar(roll) + '</section>';
      if ((g.triage || 0) + (g.approval || 0) + (g.changes || 0)) body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Waiting for a human</span></h3>' + blocks.gates(feats) + '</section>';
      body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Every lens</span></h3>' + blocks.ratingTable(ref, { lens }) + '</section>';
      if (worst.length && r.band !== 'good') body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Weakest in ' + esc(LENS[lens].label) + '</span></h3>' + blocks.featureList(worst, { lens, path: ref.type !== 'module' }) + '</section>';
      body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Features</span><span class="ok-mono">' + feats.length + '</span></h3>' + blocks.featureList(feats, { lens, path: ref.type !== 'module' }) + '</section>';
      openInspector({
        kicker: crumbHTML(info.crumb.concat([{ label: info.kind }])),
        title: (info.code ? '<span class="ok-mono" style="font-size:14px;color:var(--ok-ink-3);margin-right:10px;vertical-align:3px">' + esc(info.code) + '</span>' : '') + esc(info.name),
        subtitle: html.rating(r, { size: 'sm', label: LENS[lens].label }) + '<span class="ok-chip ok-chip--plain">' + plural(feats.length, 'feature') + '</span>' + (roll.attention ? '<span class="ok-chip ok-chip--alarm">' + html.attention(11) + roll.attention + ' need attention</span>' : ''),
        body, ref, keepScroll,
      }, 'node');
    }
    function renderRelease(id, keepScroll) {
      const rel = BP.release(id);
      if (!rel) return;
      openInspector({
        kicker: crumbHTML([{ label: 'Timeline' }, { label: 'Release' }]),
        title: '<span class="ok-mono">' + esc(rel.label) + '</span> ' + esc(rel.name || ''),
        subtitle: '<span class="ok-statepill ok-statepill--' + esc(rel.state) + '">' + (rel.state === 'shipped' ? 'Shipped' : rel.state === 'next' ? 'Next release' : 'Future') + '</span><span class="ok-chip ok-chip--mono">' + esc(fmt.date(rel.date)) + '</span>',
        body: (rel.summary ? '<p class="ok-summary">' + esc(rel.summary) + '</p>' : '') + '<div style="margin-top:12px">' + blocks.releasePackage(rel.id, { noHead: true }) + '</div>',
        ref: { type: 'release', id: rel.id }, keepScroll,
      }, 'node');
    }
    // Features that need attention, most urgent first (blocked, then changes requested, then critical in a lens),
    // otherwise in blueprint order. The data never changes, so it is computed once.
    let attnList = null;
    function attentionFeatures() {
      if (attnList) return attnList;
      const rank = (f) => (f.status === 'blocked' ? 0 : asList(BP.gates(f)).some((g) => g.kind === 'changes') ? 1 : 2);
      attnList = BP.features.filter((f) => BP.needsAttention(f)).map((f, i) => ({ f, i, r: rank(f) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.f);
      return attnList;
    }
    /** The standard product inspector: the root node, composed like the area, domain and module ones. */
    function renderProduct(keepScroll) {
      const ref = productRef();
      const lens = S.lens;
      const r = BP.productRating(lens);
      const roll = BP.productRollup();
      const feats = BP.features;
      const g = roll.gates || {};
      const gateN = (g.triage || 0) + (g.approval || 0) + (g.changes || 0);
      const worst = asList(r.worst).map(featureOf).filter(Boolean);
      const attn = attentionFeatures();
      const tagline = product.tagline ? String(product.tagline) : '';
      let body = tagline ? '<p class="ok-summary">' + esc(tagline + (/[.!?]$/.test(tagline) ? '' : '.')) + '</p>' : '';
      body += '<section class="ok-sec" style="margin-top:16px"><h3 class="ok-sec__h"><span>' + esc(LENS[lens].label) + ' lens</span><span class="ok-mono">' + r.applicable + ' rated</span></h3>' + html.rating({ band: r.band, score: r.score, headline: LENS[lens].question }, { size: 'lg' }) + '</section>';
      body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Status</span></h3>' + blocks.statusBar(roll) + '</section>';
      if (gateN) body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Waiting for a human</span><span class="ok-mono">' + gateN + '</span></h3>' + blocks.gates(feats, { limit: 8 }) + '</section>';
      body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Every lens</span></h3>' + blocks.ratingTable(ref, { lens }) + '</section>';
      body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Areas</span><span class="ok-mono">' + BP.areas.length + '</span></h3><ul class="ok-flist">' + BP.areas.map((a) => {
        const ar = BP.areaRating(a.id, lens);
        const aroll = BP.areaRollup(a.id);
        const doms = BP.domains.filter((d) => d.areaId === a.id).length;
        return '<li><button type="button" class="ok-frow" data-ok-inspect="area:' + esc(a.id) + '" title="' + esc('Inspect ' + a.name) + '">' + html.jewel(lens, ar.band, 16) +
          '<span class="ok-frow__name">' + esc(a.name) + '<span class="ok-frow__sub">' + plural(doms, 'domain') + ' · ' + plural(aroll.count || 0, 'feature') + (aroll.attention ? ' · ' + aroll.attention + ' need attention' : '') + '</span></span>' +
          '<span class="ok-frow__end" title="' + esc(LENS[lens].label + ': ' + (ar.band === 'na' ? 'not applicable' : BAND[ar.band].label + ', ' + fmt.score(ar.score))) + '">' + (ar.band === 'na' ? 'n/a' : fmt.score(ar.score)) + '</span></button></li>';
      }).join('') + '</ul></section>';
      if (worst.length && r.band !== 'good') body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Weakest in ' + esc(LENS[lens].label) + '</span></h3>' + blocks.featureList(worst, { lens, path: true }) + '</section>';
      body += '<section class="ok-sec"><h3 class="ok-sec__h"><span>Needs attention</span><span class="ok-mono">' + attn.length + '</span></h3>' + blocks.featureList(attn, { lens, path: true, limit: attn.length || 1, empty: 'Nothing needs attention.' }) + '</section>';
      openInspector({
        kicker: crumbHTML([{ label: 'Product' }]),
        title: esc(product.name),
        subtitle: html.rating(r, { size: 'sm', label: LENS[lens].label }) + '<span class="ok-chip ok-chip--plain">' + plural(feats.length, 'feature') + '</span>' +
          (product.version ? '<span class="ok-chip ok-chip--mono" title="Live version, then the next release">v' + esc(product.version) + (product.nextVersion ? ' → ' + esc(product.nextVersion) : '') + '</span>' : '') +
          (roll.attention ? '<span class="ok-chip ok-chip--alarm">' + html.attention(11) + roll.attention + ' need attention</span>' : ''),
        body, ref, keepScroll,
      }, 'node');
    }
    function inspect(ref) {
      if (!ref) return;
      if (ref.type === 'feature') return peek(ref.id);
      if (ref.type === 'product') ref = productRef();
      select(ref);
      renderNode(ref);
    }

    // ── full-page feature detail ────────────────────────────────────────────────────────────────
    function branchState(b) { const l = local.branch.get(b.id); return l ? l.state : b.state; }
    function wiState(w) { const l = local.wi.get(w.id); return l || w.state; }
    function openFeature(id, tab) {
      const f = BP.feature(id);
      if (!f) return;
      if (!S.page) returnFocus = document.activeElement;
      closeSheet();
      toggleIni(false);
      S.selection = { type: 'feature', id: f.id };
      S.page = { id: f.id, tab: tab || 'overview' };
      ledgerFilter = { lens: 'all', actor: 'all' };
      local.noteOpen = null;
      renderPage();
      el.page.hidden = false;
      el.page.scrollTop = 0;
      shellEl.classList.add('ok-page-open');
      const h1 = el.page.querySelector('.ok-page__title');
      if (h1) h1.focus({ preventScroll: true });
      announce('Feature page: ' + f.name);
      emit('feature-open', { featureId: f.id, tab: S.page.tab });
    }
    function closeFeature() {
      if (!S.page) return;
      const id = S.page.id;
      S.page = null;
      el.page.hidden = true;
      el.page.innerHTML = '';
      if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
      shellEl.classList.remove('ok-page-open');
      if (returnFocus && document.contains(returnFocus) && !el.page.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
      emit('feature-close', { featureId: id });
    }
    function setTab(tab) {
      if (!S.page) return;
      S.page.tab = tab;
      el.page.querySelectorAll('.ok-tab').forEach((t) => {
        const on = t.getAttribute('data-ok-tab-btn') === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      el.page.querySelectorAll('.ok-panelbody').forEach((p) => { p.hidden = p.getAttribute('data-ok-panel') !== tab; });
      const bar = el.page.querySelector('.ok-tabsbar');
      if (bar && bar.classList.contains('is-stuck')) el.page.scrollTop = Math.min(el.page.scrollTop, bar.offsetTop);
    }
    function syncPageLens() {
      el.page.querySelectorAll('.ok-tile').forEach((t) => t.classList.toggle('is-current', t.getAttribute('data-lens') === S.lens));
      const c = el.page.querySelector('.ok-page__corona');
      if (c && S.page) c.innerHTML = html.corona(S.page.id, 64, { lens: S.lens, label: 'State in every lens' });
    }
    function renderPage() {
      const f = BP.feature(S.page.id);
      const p = BP.pathOf(f);
      const gates = gatesNow(f);
      const openItems = f.workItems.filter((w) => ['triage', 'backlog', 'in-progress', 'review'].includes(wiState(w))).length;
      const ledger = asList(BP.ledgerOf(f));
      const owner = BP.team(f.owner);
      const tabs = [['overview', 'Overview', ''], ['work', 'Work', '<span class="ok-mono">' + openItems + ' open</span>' + (gates.length ? '<span class="ok-tab__gate" title="' + plural(gates.length, 'gate') + ' waiting">' + gates.length + '</span>' : '')], ['ledger', 'Ledger', '<span class="ok-mono">' + ledger.length + '</span>']];
      const tab = S.page.tab;
      el.page.setAttribute('aria-label', 'Feature page: ' + f.name);
      el.page.innerHTML = '<div class="ok-page__inner">' +
        '<header class="ok-page__head">' +
          '<div class="ok-page__crumb">' + crumbHTML([{ label: p.area.name, ref: { type: 'area', id: p.area.id } }, { label: p.domain.name, ref: { type: 'domain', id: p.domain.id } }, { label: p.module.name, ref: { type: 'module', id: p.module.id } }]) + '</div>' +
          '<div class="ok-page__corona">' + html.corona(f, 64, { lens: S.lens, label: 'State in every lens' }) + '</div>' +
          '<h1 class="ok-page__title" tabindex="-1">' + esc(f.name) + '</h1>' +
          '<div class="ok-page__meta">' + html.statusChip(f.status) + html.priority(f.priority) + html.releaseChip(f) + (BP.needsAttention(f) ? '<span class="ok-chip ok-chip--alarm">' + html.attention(11) + 'Needs attention</span>' : '') +
            '<span class="ok-metadiv"></span><span class="ok-metaitem"><small>Owner</small>' + esc(owner ? owner.name : f.owner) + '</span>' +
            '<span class="ok-metaitem"><small>Built by</small>' + esc(BUILDER[f.builtBy] || f.builtBy) + '</span>' +
            '<span class="ok-metaitem"><small>Updated</small><span class="ok-mono">' + esc(fmt.date(f.updatedAt)) + '</span></span>' +
            (f.status !== 'live' && f.status !== 'ready' ? '<span class="ok-metaitem"><small>Progress</small><span class="ok-mono">' + (f.progress || 0) + '%</span></span>' : '') + '</div>' +
          '<div class="ok-page__actions"><button type="button" class="ok-btn" data-ok-locate="' + esc(f.id) + '">' + svg.icon('locate', 14) + 'Show on map</button>' +
            '<button type="button" class="ok-btn" data-ok-close="page" aria-label="Close feature page (Esc)">' + svg.icon('close', 12) + 'Close</button></div>' +
        '</header>' +
        '<div class="ok-tabsbar"><div class="ok-tabsbar__mini">' + html.status(f.status, 13) + '<span>' + esc(f.name) + '</span></div>' +
          '<div class="ok-tabs" role="tablist" aria-label="Feature page sections">' + tabs.map(([id, label, extra]) => '<button type="button" class="ok-tab" role="tab" id="ok-tab-' + id + '" aria-controls="ok-panel-' + id + '" aria-selected="' + (tab === id) + '" tabindex="' + (tab === id ? 0 : -1) + '" data-ok-tab-btn="' + id + '">' + label + extra + '</button>').join('') + '</div>' +
          '<div class="ok-tabsbar__end">As of <span class="ok-mono">' + esc(fmt.date(asOf())) + '</span></div></div>' +
        '<div class="ok-panelbody" role="tabpanel" id="ok-panel-overview" aria-labelledby="ok-tab-overview" data-ok-panel="overview"' + (tab === 'overview' ? '' : ' hidden') + '>' + overviewHTML(f) + '</div>' +
        '<div class="ok-panelbody" role="tabpanel" id="ok-panel-work" aria-labelledby="ok-tab-work" data-ok-panel="work"' + (tab === 'work' ? '' : ' hidden') + '>' + workHTML(f) + '</div>' +
        '<div class="ok-panelbody" role="tabpanel" id="ok-panel-ledger" aria-labelledby="ok-tab-ledger" data-ok-panel="ledger"' + (tab === 'ledger' ? '' : ' hidden') + '>' + ledgerHTML(f) + '</div>' +
        '</div>';
      const head = el.page.querySelector('.ok-page__head'), bar = el.page.querySelector('.ok-tabsbar');
      if (pageObserver) pageObserver.disconnect();
      if ('IntersectionObserver' in window) {
        pageObserver = new IntersectionObserver((ents) => ents.forEach((en) => bar.classList.toggle('is-stuck', !en.isIntersecting)), { root: el.page, threshold: 0 });
        pageObserver.observe(head);
      }
    }
    function rerenderPagePanel(which) {
      if (!S.page) return;
      const f = BP.feature(S.page.id);
      const panel = el.page.querySelector('[data-ok-panel="' + which + '"]');
      if (!panel) return;
      panel.innerHTML = which === 'work' ? workHTML(f) : which === 'ledger' ? ledgerHTML(f) : overviewHTML(f);
      const gates = gatesNow(f);
      const wt = el.page.querySelector('[data-ok-tab-btn="work"]');
      if (wt) {
        const openItems = f.workItems.filter((w) => ['triage', 'backlog', 'in-progress', 'review'].includes(wiState(w))).length;
        wt.innerHTML = 'Work<span class="ok-mono">' + openItems + ' open</span>' + (gates.length ? '<span class="ok-tab__gate">' + gates.length + '</span>' : '');
      }
    }
    function gatesNow(f) {
      return asList(BP.gates(f)).filter((g) => {
        if (g.kind === 'triage') { const w = f.workItems.find((x) => x.id === g.id); return !w || wiState(w) === 'triage'; }
        const b = f.branches.find((x) => x.id === g.id);
        if (!b) return true;
        const st = branchState(b);
        return g.kind === 'approval' ? st === 'awaiting-approval' : st === 'changes-requested';
      });
    }
    function overviewHTML(f) {
      const gates = gatesNow(f);
      const lead = '<div class="ok-ov__text"><p class="ok-summary">' + esc(f.summary) + '</p>' +
        (f.status === 'blocked' && f.blockedReason ? '<div class="ok-callout ok-callout--alarm"><b>Blocked</b>' + esc(f.blockedReason) + '</div>' : '') +
        (f.note ? '<div class="ok-callout"><b>Note</b>' + esc(f.note) + '</div>' : '') + '</div>' +
        (gates.length ? '<aside class="ok-ov__gates" aria-label="Waiting for a human"><h3 class="ok-sec__h"><span>Waiting for a human</span><span class="ok-mono">' + gates.length + '</span></h3><ul class="ok-flist">' +
          gates.slice(0, 4).map((g) => '<li><button type="button" class="ok-frow" data-ok-tab-btn="work">' + html.gate(g.kind, 13) + '<span class="ok-frow__name">' + esc(g.title) + '<span class="ok-frow__sub">' + esc(GATE[g.kind].long) + '</span></span><span class="ok-frow__end">' + esc(g.waitingDays === 0 ? 'today' : g.waitingDays + ' d') + '</span></button></li>').join('') + '</ul>' +
          '<button type="button" class="ok-btn ok-btn--sm" data-ok-tab-btn="work">Decide in Work' + svg.icon('arrow', 12) + '</button></aside>' : '');
      const tiles = LENS_DEFS.map((l) => {
        const r = BP.rating(f, l.id);
        const cur = l.id === S.lens ? ' is-current' : '';
        const head = '<div class="ok-tile__head">' + html.jewel(l.id, r.band, 18) + '<span class="ok-tile__name">' + esc(l.label) + '</span><span class="ok-tile__now">Current lens</span></div><div class="ok-tile__q">' + esc(l.question) + '</div>';
        const btn = '<button type="button" class="ok-tile__btn" data-ok-setlens="' + l.id + '" aria-label="' + esc('Switch to the ' + l.label + ' lens') + '"></button>';
        if (r.band === 'na') {
          return '<article class="ok-tile ok-tile--na' + cur + '" data-lens="' + l.id + '">' + head + '<div class="ok-tile__na"><b>Not applicable</b>' + esc(r.headline || 'Does not apply to this feature') + '</div>' + btn + '</article>';
        }
        const facts = asList(r.facts);
        const reasons = asList(r.reasons);
        return '<article class="ok-tile' + cur + '" data-lens="' + l.id + '">' + head + html.rating(r, { size: 'lg' }) +
          (facts.length ? '<dl class="ok-tile__facts">' + facts.map((x) => '<dt>' + esc(x.label) + '</dt><dd>' + (x.band ? html.band(x.band, 10, BAND[x.band] ? BAND[x.band].label : '') : '') + esc(x.value) + '</dd>').join('') + '</dl>' : '') +
          (reasons.length ? '<ul class="ok-tile__reasons">' + reasons.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + btn + '</article>';
      }).join('');
      const deps = asList(BP.dependencies(f)), dents = asList(BP.dependents(f));
      const inis = asList(BP.initiativesOf(f));
      const rels = asList(BP.featureReleases(f));
      const links =
        '<section class="ok-asec"><h3><span>Depends on</span><span class="ok-mono">' + deps.length + '</span></h3>' + blocks.featureList(deps, { lens: S.lens, action: 'open', path: true, empty: 'Depends on no other feature.' }) + '</section>' +
        '<section class="ok-asec"><h3><span>Used by</span><span class="ok-mono">' + dents.length + '</span></h3>' + blocks.featureList(dents, { lens: S.lens, action: 'open', path: true, empty: 'No feature depends on it yet.' }) + '</section>' +
        '<section class="ok-asec"><h3><span>Initiatives</span><span class="ok-mono">' + inis.length + '</span></h3>' + (inis.length ? inis.map((x) => {
          const ini = initiativeOf(x.initiative);
          return '<div class="ok-inirow"><span>' + esc(ini.name) + '</span><span class="ok-cstate"><i class="ok-cov__' + esc(x.state) + '"></i>' + esc(COV[x.state] || x.state) + '</span><small>' + esc((ini.kind === 'permanent' ? 'Permanent' : 'Temporary, until ' + fmt.date(ini.endsAt)) + (x.note ? ' · ' + x.note : '')) + '</small></div>';
        }).join('') : '<p class="ok-empty">Not part of any initiative.</p>') + '</section>' +
        '<section class="ok-asec"><h3><span>Releases</span><span class="ok-mono">' + rels.length + '</span></h3>' + (rels.length ? rels.map((x) => {
          const rel = releaseOf(x.release);
          return '<div class="ok-relrow"><span class="ok-mono">' + esc(rel.label) + '</span><span>' + svg.wrap(svg.releaseKind(x.kind, 5), 6, 12) + ' ' + esc(REL_KIND[x.kind] || x.kind) + (x.note ? '<small> · ' + esc(x.note) + '</small>' : '') + '</span><small class="ok-mono">' + esc(fmt.date(rel.date)) + '</small></div>';
        }).join('') : '<p class="ok-empty">Not in a release yet.</p>') + '</section>';
      return '<div class="ok-ov"><div class="ok-ov__lead' + (gates.length ? ' has-gates' : '') + '">' + lead + '</div>' +
        '<h2 class="ok-h2">State in every lens <em>Select a tile to switch lens</em></h2><div class="ok-tiles">' + tiles + '</div>' +
        '<h2 class="ok-h2">Connections</h2><div class="ok-ov__links">' + links + '</div></div>';
    }
    function whoName(id) { const x = personOrTeam(id); return x ? x.name : id || '–'; }
    function sourceIcon(src) { return svg.icon(src === 'scan' ? 'scan' : src === 'ticket' ? 'ticket' : 'goal', 16); }
    function workHTML(f) {
      const gates = gatesNow(f);
      let h = '';
      // gates first: decisions with their evidence
      h += '<h2 class="ok-h2">Waiting for a human <span class="ok-mono">' + gates.length + '</span>' + (gates.length ? '' : '<em>Nothing to decide on this feature</em>') + '</h2>';
      const doneCards = [];
      f.branches.forEach((b) => { const l = local.branch.get(b.id); if (l) doneCards.push({ b, l }); });
      f.workItems.forEach((w) => { const l = local.wi.get(w.id); if (l) doneCards.push({ w, l }); });
      if (gates.length || doneCards.length) {
        h += '<div class="ok-gatecards">';
        gates.forEach((g) => { h += gateCard(f, g); });
        doneCards.forEach((x) => { h += decidedCard(f, x); });
        h += '</div>';
      }
      // work items by state
      const groups = {};
      f.workItems.forEach((w) => { const st = wiState(w); (groups[st] = groups[st] || []).push(w); });
      let wi = '<h2 class="ok-h2">Work items <span class="ok-mono">' + f.workItems.length + '</span></h2>';
      if (!f.workItems.length) wi += '<p class="ok-empty">No work items yet.</p>';
      WI_ORDER.forEach((st) => {
        const list = groups[st];
        if (!list) return;
        wi += '<section class="ok-wgroup"><h3 class="ok-wgroup__h">' + (st === 'triage' ? html.gate('triage', 12) : '') + esc(WI_STATE[st]) + ' <span class="ok-mono">' + list.length + '</span></h3>' +
          list.map((w) => {
            const ini = w.initiative ? BP.initiative(w.initiative) : null;
            return '<div class="ok-wi' + (st === 'triage' ? ' is-triage' : '') + (st === 'done' || st === 'dismissed' ? ' is-muted' : '') + '"><span class="ok-wi__src" title="' + esc(SOURCE[w.source] || w.source) + '">' + sourceIcon(w.source) + '</span>' +
              '<span class="ok-wi__title">' + esc(w.title) + '</span><span class="ok-wi__pri">' + esc(w.priority || '') + '</span>' +
              '<span class="ok-wi__meta"><span>' + esc(SOURCE[w.source] || w.source) + ' <span class="ok-mono">' + esc(w.sourceRef || '') + '</span></span><span>' + esc(WI_KIND[w.kind] || w.kind) + '</span><span>Opened ' + esc(fmt.rel(w.createdAt)) + '</span>' +
              (w.triagedBy ? '<span>Triaged by ' + esc(whoName(w.triagedBy)) + '</span>' : '') + (ini ? '<span class="ok-wi__ini">' + svg.icon('goal', 11) + esc(ini.name) + '</span>' : '') + '</span></div>';
          }).join('') + '</section>';
      });
      // branches
      const brs = f.branches.slice().sort((a, b) => BR_ORDER.indexOf(branchState(a)) - BR_ORDER.indexOf(branchState(b)));
      let br = '<h2 class="ok-h2">Branches <span class="ok-mono">' + brs.length + '</span></h2>';
      if (!brs.length) br += '<p class="ok-empty">No branches yet.</p>';
      brs.forEach((b) => { br += branchCard(f, b); });
      return h + '<div class="ok-work"><div>' + wi + '</div><div>' + br + '</div></div>';
    }
    function evidenceHTML(ev) {
      if (!ev) return '';
      return '<div class="ok-evidence"><span class="ok-evidence__icon">' + svg.icon(ev.kind === 'demo' ? 'demo' : 'report', 17) + '</span><span class="ok-evidence__kind">' + (ev.kind === 'demo' ? 'Demo' : 'Report') + '</span>' +
        '<span class="ok-evidence__title">' + esc(ev.title) + '</span><span class="ok-evidence__sum">' + esc(ev.summary || '') + '</span><span class="ok-evidence__ref">' + esc(ev.ref || '') + '</span></div>';
    }
    function checksHTML(b) {
      const t = b.checks || {};
      const res = t.tests === 'pass' ? 'pass' : t.tests === 'fail' ? 'fail' : 'info';
      const cd = t.coverageDelta;
      return '<div class="ok-checks"><span>' + svg.wrap(svg.result(res, 5), 6, 12) + 'Tests <b>' + esc(t.tests === 'running' ? 'running' : t.tests || '–') + '</b></span>' +
        (cd != null ? '<span>Coverage <b>' + (cd > 0 ? '+' : '') + esc(cd) + ' pts</b></span>' : '') + '<span>Opened <b>' + esc(fmt.dateShort(b.openedAt)) + '</b></span><span>Updated <b>' + esc(fmt.rel(b.updatedAt)) + '</b></span></div>';
    }
    function gateCard(f, g) {
      const wait = g.waitingDays == null ? '' : g.waitingDays === 0 ? 'Since today' : 'Waiting ' + plural(g.waitingDays, 'day');
      let h = '<article class="ok-gatecard is-' + g.kind + '"><div class="ok-gatecard__top">' + html.gateChip(g) + '<span class="ok-gatecard__wait' + (g.waitingDays > 7 ? ' is-late' : '') + '">' + esc(wait) + '</span></div>';
      if (g.kind === 'triage') {
        const w = f.workItems.find((x) => x.id === g.id);
        h += '<div class="ok-gatecard__title">' + esc(g.title) + '</div><div class="ok-gatecard__ref">' + esc(w ? (SOURCE[w.source] || w.source) + ' ' : '') + '<span class="ok-mono">' + esc(g.ref || '') + '</span>' + (w && w.initiative && BP.initiative(w.initiative) ? ' · ' + esc(BP.initiative(w.initiative).name) : '') + '</div>' +
          '<div class="ok-actions"><button type="button" class="ok-btn ok-btn--gate ok-btn--sm" data-ok-triage="' + esc(g.id) + ':backlog">' + svg.icon('check', 12) + 'Accept to backlog</button><button type="button" class="ok-btn ok-btn--sm" data-ok-triage="' + esc(g.id) + ':dismissed">Dismiss</button><span class="ok-unsaved">Not saved in this prototype</span></div>';
        return h + '</article>';
      }
      const b = f.branches.find((x) => x.id === g.id) || {};
      const who = b.crew ? whoName(b.crew) : b.author ? whoName(b.author) : '';
      h += '<div class="ok-gatecard__title"><span class="ok-branch__id">' + esc(g.id) + '</span></div><div class="ok-gatecard__ref">' + esc((ACTIVITY[b.activity] || b.activity || '') + (who ? ' by ' + who : '')) + '</div>';
      if (g.kind === 'approval') {
        h += evidenceHTML(b.evidence) + (b.checks ? checksHTML(b) : '');
        if (local.noteOpen === b.id) {
          h += '<div class="ok-notebox"><label for="ok-note-' + esc(b.id) + '">What should change?</label><textarea id="ok-note-' + esc(b.id) + '" placeholder="Tell the crew what to change before you approve."></textarea>' +
            '<div class="ok-actions"><button type="button" class="ok-btn ok-btn--primary ok-btn--sm" data-ok-changes-send="' + esc(b.id) + '">Request changes</button><button type="button" class="ok-btn ok-btn--sm ok-btn--quiet" data-ok-changes-cancel>Cancel</button><span class="ok-unsaved">Not saved in this prototype</span></div></div>';
        } else {
          h += '<div class="ok-actions"><button type="button" class="ok-btn ok-btn--gate ok-btn--sm" data-ok-approve="' + esc(b.id) + '">' + svg.icon('check', 12) + 'Approve</button><button type="button" class="ok-btn ok-btn--sm" data-ok-changes="' + esc(b.id) + '">Request changes</button><span class="ok-unsaved">Not saved in this prototype</span></div>';
        }
      } else {
        const rv = b.reviewer ? whoName(b.reviewer) : 'A reviewer';
        h += '<div class="ok-callout ok-callout--alarm" style="margin-top:2px"><b>' + esc(rv) + ' asked for changes</b>' + esc(b.note || g.title) + '</div>' +
          '<div class="ok-gatecard__ref">Waiting for ' + esc(who || 'the author') + ' to update the branch' + (b.evidence ? ' · evidence: ' + esc(b.evidence.title) : '') + '</div>';
      }
      return h + '</article>';
    }
    function decidedCard(f, x) {
      if (x.w) {
        const st = x.l;
        return '<article class="ok-gatecard is-triage" style="background:transparent"><div class="ok-gatecard__top"><span class="ok-done">' + svg.icon('check', 13) + (st === 'backlog' ? 'Accepted to backlog' : 'Dismissed') + '</span><span class="ok-gatecard__wait">by you, just now</span></div>' +
          '<div class="ok-gatecard__title">' + esc(x.w.title) + '</div><span class="ok-unsaved">Not saved in this prototype</span></article>';
      }
      const st = x.l.state;
      return '<article class="ok-gatecard" style="background:transparent;border-color:var(--ok-rule)"><div class="ok-gatecard__top"><span class="ok-done">' + svg.icon('check', 13) + (st === 'approved' ? 'Approved' : 'Changes requested') + '</span><span class="ok-gatecard__wait">by you, just now</span></div>' +
        '<div class="ok-gatecard__title"><span class="ok-branch__id">' + esc(x.b.id) + '</span></div>' + (x.l.note ? '<div class="ok-callout"><b>Your note</b>' + esc(x.l.note) + '</div>' : '') + '<span class="ok-unsaved">Not saved in this prototype</span></article>';
    }
    function branchCard(f, b) {
      const st = branchState(b);
      const loc = local.branch.get(b.id);
      const cls = st === 'awaiting-approval' ? ' is-approval' : st === 'changes-requested' ? ' is-changes' : st === 'merged' || st === 'abandoned' ? ' is-closed' : '';
      const stChip = st === 'awaiting-approval' ? html.gateChip('approval') : st === 'changes-requested' ? html.gateChip('changes') : '<span class="ok-chip ok-chip--plain' + (st === 'approved' || st === 'merged' ? ' ok-chip--good' : '') + '">' + esc(BR_STATE[st] || st) + '</span>';
      const who = b.crew ? whoName(b.crew) + ' (agent crew)' : b.author ? whoName(b.author) : '–';
      const wi = f.workItems.find((w) => w.id === b.workItem);
      let h = '<article class="ok-branch' + cls + '"><div class="ok-branch__top">' + svg.icon('branch', 14) + '<span class="ok-branch__id">' + esc(b.id) + '</span><span class="ok-branch__state">' + stChip + '</span></div>' +
        '<div class="ok-branch__who"><span>' + esc(ACTIVITY[b.activity] || b.activity) + '</span><span>' + esc(who) + '</span>' + (wi ? '<span>For: ' + esc(wi.title) + '</span>' : '') + (b.reviewer && st !== 'awaiting-approval' ? '<span>Reviewer: ' + esc(whoName(b.reviewer)) + '</span>' : '') + '</div>' +
        checksHTML(b) + evidenceHTML(b.evidence);
      if (st === 'changes-requested' && (loc ? loc.note : b.note)) h += '<div class="ok-callout ok-callout--alarm"><b>' + esc(loc ? 'Your note' : (b.reviewer ? whoName(b.reviewer) : 'Reviewer') + ' asked for changes') + '</b>' + esc(loc ? loc.note : b.note) + '</div>';
      if (st === 'awaiting-approval') h += '<div class="ok-gatecard__ref" style="margin-top:10px">Decide in “Waiting for a human” above.</div>';
      if (loc) h += '<div style="margin-top:8px"><span class="ok-unsaved">Decided by you just now · not saved in this prototype</span></div>';
      return h + '</article>';
    }
    function ledgerHTML(f) {
      const all = asList(BP.ledgerOf(f));
      const lensesPresent = LENS_IDS.filter((l) => all.some((e) => e.lens === l));
      const hasNone = all.some((e) => !e.lens);
      const kinds = ['agent', 'human', 'system'].filter((k) => all.some((e) => e.actorKind === k));
      const lf = ledgerFilter;
      const rows = all.filter((e) => (lf.lens === 'all' || (lf.lens === 'none' ? !e.lens : e.lens === lf.lens)) && (lf.actor === 'all' || e.actorKind === lf.actor));
      const count = (fn) => all.filter(fn).length;
      let h = '<div class="ok-lfilters"><div class="ok-lfilters__grp" role="group" aria-label="Filter by lens"><span>Lens</span>' +
        '<button type="button" class="ok-lchip ok-lchip--plain" data-ok-lf-lens="all" aria-pressed="' + (lf.lens === 'all') + '">All <span class="ok-mono">' + all.length + '</span></button>' +
        lensesPresent.map((l) => '<button type="button" class="ok-lchip" data-ok-lf-lens="' + l + '" aria-pressed="' + (lf.lens === l) + '"><span class="ok-swatch ok-lh-' + l + '"></span>' + esc(LENS[l].short) + ' <span class="ok-mono">' + count((e) => e.lens === l) + '</span></button>').join('') +
        (hasNone ? '<button type="button" class="ok-lchip ok-lchip--plain" data-ok-lf-lens="none" aria-pressed="' + (lf.lens === 'none') + '" title="Entries that are not evidence for one lens">Workflow <span class="ok-mono">' + count((e) => !e.lens) + '</span></button>' : '') + '</div>' +
        '<div class="ok-lfilters__grp" role="group" aria-label="Filter by actor"><span>Actor</span><button type="button" class="ok-lchip ok-lchip--plain" data-ok-lf-actor="all" aria-pressed="' + (lf.actor === 'all') + '">All</button>' +
        kinds.map((k) => '<button type="button" class="ok-lchip" data-ok-lf-actor="' + k + '" aria-pressed="' + (lf.actor === k) + '">' + svg.wrap(svg.actor(k, 6), 7, 12) + ACTOR_KIND[k] + ' <span class="ok-mono">' + count((e) => e.actorKind === k) + '</span></button>').join('') + '</div>' +
        '<span class="ok-lfilters__count">' + plural(rows.length, 'entry', 'entries') + ' · newest first</span></div>';
      if (!rows.length) return h + '<p class="ok-empty">No entries match these filters.</p>';
      h += '<div class="ok-ledger-wrap" tabindex="0" role="region" aria-label="Audited activity"><table class="ok-ledger"><thead><tr><th scope="col" class="ok-l-c-time">Time (UTC)</th><th scope="col" class="ok-l-c-actor">Actor</th><th scope="col" class="ok-l-c-action">Action</th><th scope="col" class="ok-l-c-lens">Lens</th><th scope="col" class="ok-l-c-result">Result</th><th scope="col" class="ok-l-c-sum">Summary</th><th scope="col" class="ok-l-c-ref">Reference</th><th scope="col" class="ok-l-c-hash">Hash</th></tr></thead><tbody>';
      rows.forEach((e) => {
        const actor = whoName(e.actor);
        const lensCell = e.lens && LENS[e.lens] ? '<span class="ok-l-lens"><span class="ok-swatch ok-lh-' + e.lens + '"></span>' + esc(LENS[e.lens].short) + '</span>' : '<span class="ok-l-lens ok-muted">–</span>';
        const resCell = '<span class="ok-l-result">' + svg.wrap(svg.result(e.result, 5), 6.2, 13, 'ok-res-' + e.result) + '<span class="ok-res-word">' + esc(RESULT[e.result] || e.result) + '</span></span>';
        h += '<tr><td class="ok-l-c-time"><span class="ok-l-time">' + esc(fmt.date(e.at)) + '<small>' + esc(fmt.time(e.at)) + '</small></span></td>' +
          '<td class="ok-l-c-actor"><span class="ok-l-actor">' + svg.wrap(svg.actor(e.actorKind, 6), 7, 14) + '<span>' + esc(actor) + '<small>' + esc(ACTOR_KIND[e.actorKind] || e.actorKind) + '</small></span></span></td>' +
          '<td class="ok-l-c-action"><span class="ok-l-action">' + esc(ACTION[e.action] || e.action) + '</span>' + (e.lens && LENS[e.lens] ? '<span class="ok-l-lens-inline">' + lensCell + '</span>' : '') + '</td><td class="ok-l-c-lens">' + lensCell + '</td><td class="ok-l-c-result">' + resCell + '</td>' +
          '<td class="ok-l-c-sum"><div class="ok-l-sum">' + esc(e.summary) + '<div class="ok-l-sum-meta"><span>' + esc(e.ref || '') + '</span><span>#' + esc(e.hash || '') + '</span></div></div></td><td class="ok-l-c-ref"><span class="ok-l-ref">' + esc(e.ref || '–') + '</span></td><td class="ok-l-c-hash"><span class="ok-l-hash" title="Entry ' + esc(e.id) + '">' + esc(e.hash || '') + '</span></td>' +
          '</tr>';
      });
      h += '</tbody></table></div><p class="ok-ledger-note">Each entry is written by the agent, person or system named, and its hash ties it to the evidence store. Newest first.</p>';
      return h;
    }

    // ── layout helpers ──────────────────────────────────────────────────────────────────────────
    function freeRect() {
      const st = el.stage.getBoundingClientRect();
      let w = st.width, h = st.height;
      if (!el.insp.hidden) {
        const ir = el.insp.getBoundingClientRect();
        if (isPhone()) h = Math.min(h, ir.top - st.top);
        else w = Math.min(w, ir.left - st.left - 10);
      }
      return { x: 0, y: 0, w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) };
    }
    // The side inspector sits 12px from the shell's right edge (CSS), and freeRect() keeps 10px clear of it.
    const INSP_EDGE = 12, INSP_GAP = 10;
    /** freeRect() estimated from the cached shell size and tokens: no getBoundingClientRect, no layout read. */
    function freeRectHint() {
      const top = M.barH + M.filterH;
      let w = M.w, h = M.h - top;
      if (!el.insp.hidden) {
        if (M.phone) h = Math.min(h, M.h * (1 - M.sheet) - top);
        else w = Math.min(w, M.w - INSP_EDGE - M.inspW - INSP_GAP);
      }
      return { x: 0, y: 0, w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) };
    }
    /** Caches the metric tokens and the shell size. Runs only inside the fit pass, which measures layout anyway. */
    function readMetrics() {
      const cs = getComputedStyle(shellEl);
      const num = (name, def) => { const v = parseFloat(cs.getPropertyValue(name)); return isFinite(v) ? v : def; };
      M.barH = num('--ok-bar-h', M.barH);
      M.filterH = num('--ok-filter-h', M.filterH);
      M.inspW = num('--ok-insp-w', M.inspW);
      M.legendW = num('--ok-legend-w', M.legendW);
      M.sheet = clamp(num('--ok-insp-sheet', M.sheet), 0, 1);
      M.w = shellEl.clientWidth;
      M.h = shellEl.clientHeight;
      M.phone = isPhone();
    }

    // ── fitting: choose the fewest compactions that make the top bar and the filter rail fit ─────
    const TOP_ALL = ['short', 'narrow', 'compact', 'viewicon', 'searchicon', 'tworow'];
    const TOP_STEPS = [[], ['short'], ['short', 'narrow'], ['short', 'narrow', 'compact'], ['short', 'narrow', 'compact', 'viewicon'], ['short', 'narrow', 'compact', 'viewicon', 'searchicon'],
      ['tworow'], ['tworow', 'short'], ['tworow', 'short', 'narrow'], ['tworow', 'short', 'narrow', 'compact'], ['tworow', 'short', 'narrow', 'compact', 'viewicon'], ['tworow', 'short', 'narrow', 'compact', 'viewicon', 'searchicon']];
    const FF_LEVELS = 12;
    function applyTop(step) { TOP_ALL.forEach((c) => shellEl.classList.toggle('ok-fit-' + c, step.includes(c))); }
    function topFits() {
      if (shellEl.classList.contains('ok-fit-tworow')) return el.lenses.scrollWidth <= el.lenses.clientWidth + 1 && el.brand.scrollWidth <= el.brand.clientWidth + 1;
      return el.top.scrollWidth <= el.top.clientWidth + 1;
    }
    function fitTop() {
      if (isPhone()) { applyTop([]); return; }
      for (let i = 0; i < TOP_STEPS.length; i++) { applyTop(TOP_STEPS[i]); if (topFits()) return; }
    }
    function fitFilters() {
      for (let i = 1; i <= FF_LEVELS; i++) shellEl.classList.remove('ok-ff' + i);
      if (isPhone()) return;
      let lvl = 0;
      while (el.filters.scrollWidth > el.filters.clientWidth + 1 && lvl < FF_LEVELS) shellEl.classList.add('ok-ff' + (++lvl));
    }
    function fitAll() {
      const before = shellEl.classList.contains('ok-fit-tworow');
      fitTop();
      fitFilters();
      readMetrics();
      if (before !== shellEl.classList.contains('ok-fit-tworow')) emit('inspector', inspPayload(!el.insp.hidden));
      syncLensBar();
    }
    let fitRaf = 0;
    const onResize = () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitAll); };
    window.addEventListener('resize', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (shellEl.isConnected) fitAll(); });

    // ── theme ───────────────────────────────────────────────────────────────────────────────────
    const isDark = () => S.theme === 'dark' || (S.theme === 'auto' && DARK_MQ.matches);
    /** external: the page already shows `t` because someone else set <html data-theme>; do not write it back or save it. */
    function applyTheme(t, quiet, external) {
      if (!THEMES.includes(t)) t = 'light';
      S.theme = t; // set before the attribute, so the theme observer below sees its own write as no change
      if (!external) document.documentElement.setAttribute('data-theme', t);
      const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
      el.themeBtn.innerHTML = svg.icon(t, 16);
      el.themeBtn.setAttribute('aria-label', 'Theme: ' + THEME_LABEL[t] + '. Switch to ' + THEME_LABEL[next]);
      el.themeBtn.title = 'Theme: ' + THEME_LABEL[t] + ' (next: ' + THEME_LABEL[next] + ')';
      if (!external) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage unavailable */ } }
      if (sheet === 'menu') renderSheet();
      if (!quiet) emit('theme', { theme: t, dark: isDark() });
    }
    const onSchemeChange = () => { if (S.theme === 'auto') emit('theme', { theme: 'auto', dark: isDark() }); };
    if (DARK_MQ.addEventListener) DARK_MQ.addEventListener('change', onSchemeChange);
    // Someone outside the shell (a screenshot harness, the console) set or removed <html data-theme>: follow it.
    // Removed or unknown values render the light palette, so they read as 'light'. The kit's own writes always
    // match S.theme by the time this runs, so they never emit twice, and this never writes the attribute (no loop).
    function onThemeAttr() {
      const a = document.documentElement.getAttribute('data-theme');
      const t = THEMES.includes(a) ? a : 'light';
      if (t !== S.theme) applyTheme(t, false, true);
    }
    let themeObserver = null;

    // ── events ──────────────────────────────────────────────────────────────────────────────────
    function onClick(e) {
      const t = e.target.closest('[data-ok-setlens],[data-ok-view],[data-ok-status],[data-ok-ini-toggle],[data-ok-ini],[data-ok-gates],[data-ok-attn],[data-ok-clear],[data-ok-theme-cycle],[data-ok-theme],[data-ok-legend],[data-ok-search-open],[data-ok-menu],[data-ok-filters-open],[data-ok-close],[data-ok-peek],[data-ok-open],[data-ok-inspect],[data-ok-locate],[data-ok-tab-btn],[data-ok-approve],[data-ok-changes],[data-ok-changes-send],[data-ok-changes-cancel],[data-ok-triage],[data-ok-lf-lens],[data-ok-lf-actor],[data-ok-sr]');
      if (!t || !shellEl.contains(t)) return;
      const a = (n) => t.getAttribute(n);
      if (t.hasAttribute('data-ok-setlens')) setLens(a('data-ok-setlens'));
      else if (t.hasAttribute('data-ok-view') && t.tagName === 'BUTTON') setView(a('data-ok-view'));
      else if (t.hasAttribute('data-ok-status')) toggleStatus(a('data-ok-status'));
      else if (t.hasAttribute('data-ok-ini-toggle')) toggleIni();
      else if (t.hasAttribute('data-ok-ini')) { const id = a('data-ok-ini'); setInitiative(S.initiative === id ? null : id); if (!isPhone()) { toggleIni(false); const b = el.fFull.querySelector('[data-ok-ini-toggle]'); if (b) b.focus({ preventScroll: true }); } }
      else if (t.hasAttribute('data-ok-gates')) setGates(a('data-ok-gates'));
      else if (t.hasAttribute('data-ok-attn')) toggleAttention();
      else if (t.hasAttribute('data-ok-clear')) clearFilters();
      else if (t.hasAttribute('data-ok-theme-cycle')) applyTheme(THEMES[(THEMES.indexOf(S.theme) + 1) % THEMES.length]);
      else if (t.hasAttribute('data-ok-theme')) applyTheme(a('data-ok-theme'));
      else if (t.hasAttribute('data-ok-legend')) toggleLegend();
      else if (t.hasAttribute('data-ok-search-open')) openSearch();
      else if (t.hasAttribute('data-ok-menu')) openSheet('menu');
      else if (t.hasAttribute('data-ok-filters-open')) openSheet('filters');
      else if (t.hasAttribute('data-ok-close')) {
        const w = a('data-ok-close');
        if (w === 'insp') closeInspector(); else if (w === 'legend') toggleLegend(false); else if (w === 'sheet') closeSheet(); else if (w === 'page') closeFeature();
      } else if (t.hasAttribute('data-ok-sr')) { const id = a('data-ok-sr'); closeSearch(true); selectBy('search', () => peek(id)); emit('locate', { type: 'feature', id, featureId: id }); }
      else if (t.hasAttribute('data-ok-peek')) { const id = a('data-ok-peek'); const src = srcOf(t); if (S.page) closeFeature(); selectBy(src, () => peek(id)); emit('locate', { type: 'feature', id, featureId: id }); }
      else if (t.hasAttribute('data-ok-open')) openFeature(a('data-ok-open'), a('data-ok-tab') || 'overview');
      else if (t.hasAttribute('data-ok-inspect')) {
        const [type, ...rest] = a('data-ok-inspect').split(':');
        const ref = type === 'product' ? productRef() : { type, id: rest.join(':') }; // "product" or "product:"
        const src = srcOf(t);
        if (S.page) closeFeature();
        if (S.view !== 'map') setView('map');
        selectBy(src, () => inspect(ref));
        emit('locate', { type: ref.type, id: ref.id });
      } else if (t.hasAttribute('data-ok-locate')) {
        const id = a('data-ok-locate');
        closeFeature();
        setView('map');
        selectBy('page', () => peek(id));
        emit('locate', { type: 'feature', id, featureId: id });
      } else if (t.hasAttribute('data-ok-tab-btn')) setTab(a('data-ok-tab-btn'));
      else if (t.hasAttribute('data-ok-approve')) { local.branch.set(a('data-ok-approve'), { state: 'approved' }); rerenderPagePanel('work'); announce('Approved. Not saved in this prototype.'); }
      else if (t.hasAttribute('data-ok-changes')) { local.noteOpen = a('data-ok-changes'); rerenderPagePanel('work'); const ta = el.page.querySelector('.ok-notebox textarea'); if (ta) ta.focus(); }
      else if (t.hasAttribute('data-ok-changes-cancel')) { local.noteOpen = null; rerenderPagePanel('work'); }
      else if (t.hasAttribute('data-ok-changes-send')) {
        const id = a('data-ok-changes-send');
        const ta = el.page.querySelector('.ok-notebox textarea');
        const note = ta && ta.value.trim() ? ta.value.trim() : 'Changes requested without a note.';
        local.branch.set(id, { state: 'changes-requested', note });
        local.noteOpen = null;
        rerenderPagePanel('work');
        announce('Changes requested. Not saved in this prototype.');
      } else if (t.hasAttribute('data-ok-triage')) {
        const [id, st] = a('data-ok-triage').split(':');
        local.wi.set(id, st);
        rerenderPagePanel('work');
        announce((st === 'backlog' ? 'Accepted to backlog' : 'Dismissed') + '. Not saved in this prototype.');
      } else if (t.hasAttribute('data-ok-lf-lens')) { ledgerFilter.lens = a('data-ok-lf-lens'); rerenderPagePanel('ledger'); const b = el.page.querySelector('[data-ok-lf-lens="' + ledgerFilter.lens + '"]'); if (b) b.focus({ preventScroll: true }); }
      else if (t.hasAttribute('data-ok-lf-actor')) { ledgerFilter.actor = a('data-ok-lf-actor'); rerenderPagePanel('ledger'); const b = el.page.querySelector('[data-ok-lf-actor="' + ledgerFilter.actor + '"]'); if (b) b.focus({ preventScroll: true }); }
    }
    shellEl.addEventListener('click', onClick);
    shellEl.addEventListener('keydown', (e) => {
      // arrow keys move between feature page tabs (ARIA tabs pattern)
      const tabBtn = e.target.closest && e.target.closest('.ok-tab');
      if (tabBtn && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
        const all = Array.from(el.page.querySelectorAll('.ok-tab'));
        let i = all.indexOf(tabBtn);
        i = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
        all[i].focus();
        setTab(all[i].getAttribute('data-ok-tab-btn'));
        e.preventDefault();
      }
    });

    // search
    function openSearch() {
      searchOpen = true;
      el.search.classList.add('is-open');
      el.q.focus();
      el.q.select();
      renderSearch();
    }
    function closeSearch(keepQuery) {
      searchOpen = false;
      el.search.classList.remove('is-open');
      el.sr.hidden = true;
      el.q.setAttribute('aria-expanded', 'false');
      if (!keepQuery && document.activeElement === el.q) el.q.blur();
    }
    let qTimer = 0;
    el.q.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => setQuery(el.q.value), 90); searchOpen = true; });
    el.q.addEventListener('focus', () => { searchOpen = true; el.search.classList.add('is-open'); renderSearch(); });
    el.q.addEventListener('keydown', (e) => {
      const items = el.sr.querySelectorAll('[data-ok-sr]');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        srIndex = e.key === 'ArrowDown' ? (srIndex + 1) % items.length : (srIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => { it.classList.toggle('is-active', i === srIndex); it.setAttribute('aria-selected', String(i === srIndex)); });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (S.query !== el.q.value) setQuery(el.q.value);
        const list = el.sr.querySelectorAll('[data-ok-sr]');
        const pick = list[srIndex >= 0 ? srIndex : 0];
        if (pick) { const id = pick.getAttribute('data-ok-sr'); closeSearch(true); el.q.blur(); selectBy('search', () => peek(id)); emit('locate', { type: 'feature', id, featureId: id }); }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (el.q.value) { setQuery(''); } else { closeSearch(); }
      }
    });
    el.qClear.addEventListener('click', () => { setQuery(''); el.q.focus(); });
    function onPointerDown(e) {
      if (searchOpen && !el.search.contains(e.target) && !e.target.closest('[data-ok-search-open]')) closeSearch(true);
      if (iniOpen && !el.iniPop.contains(e.target) && !e.target.closest('[data-ok-ini-toggle]')) toggleIni(false);
    }
    document.addEventListener('pointerdown', onPointerDown);

    // keyboard shortcuts
    function onEsc() {
      if (searchOpen) { closeSearch(true); return true; }
      if (iniOpen) { toggleIni(false); const b = el.fFull.querySelector('[data-ok-ini-toggle]'); if (b) b.focus(); return true; }
      if (sheet) { closeSheet(); return true; }
      if (S.page) { closeFeature(); return true; }
      if (legendOpen) { setLegendOpen(false); return true; }
      if (!el.insp.hidden) { closeInspector(); return true; }
      if (S.selection) { select(null); return true; }
      return false;
    }
    function onKey(e) {
      if (e.defaultPrevented) return;
      const t = e.target;
      const typing = t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape') { if (!typing || t === el.q) { if (onEsc()) e.preventDefault(); } else if (typing) t.blur(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (/^[1-8]$/.test(k)) { const id = LENS_IDS[+k - 1]; if (LENS[id]) { setLens(id); e.preventDefault(); } }
      else if (k === 'v' || k === 'V') { setView(S.view === 'map' ? 'timeline' : 'map'); e.preventDefault(); }
      else if (k === '/') { e.preventDefault(); if (S.page) closeFeature(); openSearch(); }
      else if (k === 'g' || k === 'G') { setGates('any'); e.preventDefault(); }
      else if (k === 'a' || k === 'A') { toggleAttention(); e.preventDefault(); }
      else if (k === 'l' || k === 'L') { toggleLegend(); e.preventDefault(); }
      else if (k === 'Enter') {
        const interactive = t && t.closest && t.closest('button, a, [role="button"], [role="tab"], summary');
        if (!interactive && !S.page && S.selection && S.selection.type === 'feature') { openFeature(S.selection.id); e.preventDefault(); }
      }
    }
    document.addEventListener('keydown', onKey);
    function onPhoneChange() {
      fitAll();
      if (!isPhone()) closeSheet();
      if (isPhone() && legendOpen) setLegendOpen(false); // the panel closes on phones (class off, legend {open: false})
      syncLensBar();
      emit('inspector', inspPayload(!el.insp.hidden));
    }
    if (PHONE_MQ.addEventListener) PHONE_MQ.addEventListener('change', onPhoneChange);
    function destroy() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
      if (PHONE_MQ.removeEventListener) PHONE_MQ.removeEventListener('change', onPhoneChange);
      if (DARK_MQ.removeEventListener) DARK_MQ.removeEventListener('change', onSchemeChange);
      if (themeObserver) { themeObserver.disconnect(); themeObserver = null; } // also drops any queued records
      if (pageObserver) pageObserver.disconnect();
      Object.keys(listeners).forEach((k) => { listeners[k] = []; });
      document.documentElement.classList.remove('ok-app');
      root.classList.remove('ok-root');
      root.innerHTML = '';
      if (OK.shell === shell) OK.shell = null;
    }

    // ── init ────────────────────────────────────────────────────────────────────────────────────
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* storage unavailable */ }
    applyTheme(THEMES.includes(saved) ? saved : 'light', true);
    if (typeof MutationObserver === 'function') {
      themeObserver = new MutationObserver(onThemeAttr);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    currentLens = S.lens;
    recompute();
    syncLensBar();
    renderFilters();
    renderReadout();
    fitReady = true;
    fitAll();

    const shell = {
      root: shellEl, mapEl: el.map, timelineEl: el.timeline, stageEl: el.stage, state: S,
      on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => { listeners[evt] = (listeners[evt] || []).filter((x) => x !== fn); }; },
      setLens, setView, select, peek, inspect, openFeature, closeFeature,
      isDimmed: (f) => dimmed.has(typeof f === 'string' ? f : f && f.id),
      isHit: (f) => hits.has(typeof f === 'string' ? f : f && f.id),
      filterActive, shownCount: () => BP.features.length - dimmed.size, dimmedIds: () => dimmed, hitIds: () => hits,
      setStatuses(list) { S.statuses = new Set(asList(list)); filterChanged('statuses'); },
      setQuery, setInitiative, setGates: (k) => { S.gates = k || null; filterChanged('gates'); }, setAttention: (on) => { S.attention = !!on; filterChanged('attention'); }, clearFilters,
      inspector: { open: (spec) => openInspector(spec || {}, 'custom'), close: () => closeInspector(), isOpen: () => !el.insp.hidden },
      legend: { toggle: toggleLegend, refresh: renderLegend, isOpen: () => legendOpen },
      freeRect, freeRectHint, isPhone, isDark, setTheme: (t) => applyTheme(t), announce, destroy,
    };
    OK.shell = shell;
    return shell;
  };

  window.OK = OK;
})();
