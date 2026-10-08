#!/usr/bin/env node
// Validates the v0.2 dataset and model against docs/data-model-v2.md.
//
//   node scripts/data-v2/validate.mjs        (npm run validate:v2)
//
// Loads prototypes/shared/v2/blueprint-data.js and blueprint-model.js into a vm context with a window shim,
// checks structure, references, coherence rules, distributions, name and summary lengths, and the BP API
// (including an independent re-implementation of every rating rule), prints a compact summary table and
// exits 1 with the list of failures when any rule is broken.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_REL = 'prototypes/shared/v2/blueprint-data.js';
const MODEL_REL = 'prototypes/shared/v2/blueprint-model.js';
const ASOF = '2026-10-08';
const MAX_BYTES = 1100000; // 1.1 MB

// ── Expected shape (from the spec) ────────────────────────────────────────────────────────────

const EXPECTED = [
  ['shopper', 'Shopper Experience', [
    ['storefront', 'STF', 'Storefront', [['catalog', 'Product Catalog'], ['product-pages', 'Product Pages'], ['content', 'Content & Pages'], ['themes', 'Themes & Branding']]],
    ['discovery', 'DSC', 'Search & Discovery', [['search', 'Search'], ['recommendations', 'Recommendations'], ['merchandising', 'Merchandising']]],
    ['community', 'CMY', 'Community', [['reviews', 'Reviews & Ratings'], ['ugc', 'Q&A and UGC'], ['loyalty', 'Loyalty & Referrals']]],
    ['mobile', 'MOB', 'Mobile App', [['app-shell', 'App Shell'], ['mobile-checkout', 'Mobile Checkout'], ['app-engagement', 'App Engagement']]],
  ]],
  ['commerce', 'Commerce Core', [
    ['checkout', 'CHK', 'Cart & Checkout', [['cart', 'Cart'], ['checkout-flow', 'Checkout Flow'], ['express', 'Express Checkout']]],
    ['payments', 'PAY', 'Payments', [['cards', 'Card Processing'], ['alt-payments', 'Alternative Payments'], ['risk', 'Fraud & Risk'], ['payouts', 'Payouts & Reconciliation']]],
    ['pricing', 'PRC', 'Pricing & Promotions', [['prices', 'Price Management'], ['discounts', 'Discounts'], ['gift-cards', 'Gift Cards']]],
    ['billing', 'BIL', 'Subscriptions & Billing', [['subscriptions', 'Subscriptions'], ['merchant-billing', 'Merchant Billing'], ['invoicing', 'Invoicing & Tax']]],
  ]],
  ['fulfillment', 'Fulfillment & Service', [
    ['orders', 'ORD', 'Order Management', [['order-lifecycle', 'Order Lifecycle'], ['order-editing', 'Order Editing'], ['returns', 'Returns & Exchanges']]],
    ['inventory', 'INV', 'Inventory', [['stock', 'Stock & Locations'], ['purchasing', 'Purchasing'], ['forecasting', 'Forecasting']]],
    ['shipping', 'SHP', 'Shipping & Delivery', [['labels', 'Rates & Labels'], ['tracking', 'Tracking'], ['local-delivery', 'Local Delivery']]],
    ['care', 'CAR', 'Customer Care', [['help', 'Help Center'], ['support', 'Support Inbox'], ['notifications', 'Notifications']]],
  ]],
  ['merchant', 'Merchant Platform', [
    ['admin', 'ADM', 'Admin & Operations', [['console', 'Admin Console'], ['bulk', 'Bulk Tools'], ['staff', 'Staff & Roles']]],
    ['analytics', 'ANL', 'Analytics', [['events', 'Event Pipeline'], ['reports', 'Reports'], ['insights', 'Insights']]],
    ['integrations', 'INT', 'Integrations', [['public-api', 'Public API'], ['webhooks', 'Webhooks'], ['channels', 'Channels & Marketplaces'], ['app-store', 'App Store']]],
  ]],
  ['foundation', 'Foundation', [
    ['identity', 'IAM', 'Identity & Access', [['auth', 'Authentication'], ['accounts', 'Accounts & Privacy'], ['sessions', 'Sessions & Devices']]],
    ['platform', 'PLT', 'Platform & Reliability', [['infrastructure', 'Infrastructure'], ['observability', 'Observability'], ['data-platform', 'Data Platform']]],
  ]],
];
const EXPECTED_INITIATIVES = [
  ['permanent', 'compliance-scan', /compliance scan/i],
  ['permanent', 'a11y-monitoring', /accessibility monitoring/i],
  ['temporary', 'refactor', /payments core refactor/i],
  ['temporary', 'scan', /performance scan october 2026/i],
  ['temporary', 'upgrade', /node 22/i],
  ['temporary', 'cost', /cloud cost reduction sprint/i],
];
const LENS_IDS = ['overall', 'dev', 'ops', 'biz', 'sec', 'comp', 'ux', 'cost'];
const METRIC_LENSES = ['dev', 'ops', 'biz', 'sec', 'comp', 'ux', 'cost'];
const STATUS_ORDER = ['live', 'ready', 'building', 'planned', 'blocked'];
const BAND_IDS = ['good', 'fair', 'poor', 'critical', 'na'];
const SURFACES = ['web', 'admin', 'mobile', 'api', 'worker', 'data'];
const UI = ['web', 'admin', 'mobile'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const BUILDERS = ['agent', 'pair', 'human'];
const ROLES = ['engineering', 'operations', 'product', 'security', 'design', 'compliance', 'executive'];
const REGIMES = ['GDPR', 'PCI DSS', 'SOC 2', 'EAA'];
const WI_SOURCES = ['goal', 'ticket', 'scan'];
const WI_KINDS = ['feature', 'bug', 'perf', 'security', 'compliance', 'ux', 'cost', 'refactor'];
const WI_STATES = ['triage', 'backlog', 'in-progress', 'review', 'done', 'dismissed'];
const OPEN = ['triage', 'backlog', 'in-progress', 'review'];
const ACTIVITIES = ['implement', 'fix', 'refactor', 'perf', 'security', 'test', 'docs'];
const BR_STATES = ['running', 'awaiting-approval', 'changes-requested', 'approved', 'merged', 'abandoned'];
const ACTIVE_BR = ['running', 'awaiting-approval', 'changes-requested', 'approved'];
const PREFIX = { implement: 'feat/', test: 'feat/', docs: 'feat/', fix: 'fix/', perf: 'perf/', security: 'sec/', refactor: 'refactor/' };
const ACTIONS = ['goal', 'ticket', 'scan', 'triage', 'branch', 'commit', 'test', 'demo', 'report', 'approve', 'request-changes', 'merge', 'deploy', 'release', 'monitor', 'incident', 'cost', 'audit'];
const RESULTS = ['pass', 'fail', 'warn', 'info'];
const COVERAGE_STATES = ['covered', 'in-progress', 'pending', 'finding'];
const SYSTEM_KINDS = ['pipeline', 'monitor', 'scanner', 'export', 'sync'];
// The system that writes each automated ledger action (scan and audit depend on the lens).
const SYSTEM_FOR = { test: 'ci', deploy: 'deploy', monitor: 'slo', 'scan:sec': 'sast', 'scan:ops': 'perfscan', 'audit:comp': 'compscan', 'audit:ux': 'a11yscan', cost: 'costs', ticket: 'tickets' };

// Distribution ranges (fractions).
const STATUS_SHARE = { live: [0.52, 0.6], ready: [0.06, 0.1], building: [0.15, 0.2], planned: [0.12, 0.18], blocked: [0.03, 0.06] };
const BUILDER_SHARE = { agent: [0.42, 0.58], pair: [0.22, 0.38], human: [0.12, 0.28] };
const LIVE_BAND_SHARE = { good: [0.4, 0.6], fair: [0.2, 0.35], poor: [0.08, 0.18], critical: [0.03, 0.1] };
const UNMONITORED_SHARE = [0.06, 0.12];
const GATE_RANGE = { triage: [25, 60], approval: [30, 70], changes: [8, 20] };
const LEDGER_RANGE = [2500, 4000];
const ATTENTION_SHARE = [0.08, 0.17]; // needs attention: a signal, not wallpaper
const COMP_FINDING_SHARE = [0.12, 0.35]; // features in compliance scope with open findings

// ── Failure collection ────────────────────────────────────────────────────────────────────────

const failures = [];
function check(ok, message) {
  if (!ok) failures.push(message);
  return Boolean(ok);
}
function finish() {
  if (failures.length) {
    console.error(`\n✗ ${failures.length} check${failures.length === 1 ? '' : 's'} failed:`);
    failures.slice(0, 80).forEach((f) => console.error('  - ' + f));
    if (failures.length > 80) console.error(`  … and ${failures.length - 80} more`);
    process.exit(1);
  }
  console.log('\n✓ All checks passed.');
  process.exit(0);
}
/** Runs a group of checks; an exception becomes one failure instead of aborting the run. */
function section(name, fn) {
  try {
    fn();
  } catch (err) {
    failures.push(`${name}: threw ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const days = (a, b) => Math.round(toDay(b) - toDay(a));
const slugOf = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const pct = (x) => (x * 100).toFixed(1) + '%';
const share = (n, d) => (d ? n / d : 0);
const inRange = (x, [lo, hi]) => x >= lo - 1e-9 && x <= hi + 1e-9;
const keysExactly = (obj, keys) => {
  const k = Object.keys(obj || {});
  return k.length === keys.length && keys.every((x) => k.includes(x));
};
const asArray = (v) => (Array.isArray(v) ? v : []);

// ── Load ──────────────────────────────────────────────────────────────────────────────────────

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
const sources = {};
for (const rel of [DATA_REL, MODEL_REL]) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    failures.push(`${rel} does not exist`);
    finish();
  }
  sources[rel] = fs.readFileSync(file, 'utf8');
  try {
    vm.runInContext(sources[rel], sandbox, { filename: rel });
  } catch (err) {
    failures.push(`${rel} threw while loading: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
    finish();
  }
}
const B = sandbox.BLUEPRINT;
const BP = sandbox.BP;
if (!check(B && typeof B === 'object', 'window.BLUEPRINT is not set by blueprint-data.js')) finish();
if (!check(BP && typeof BP === 'object', 'window.BP is not set by blueprint-model.js')) finish();

const dataSource = sources[DATA_REL];
const fileBytes = Buffer.byteLength(dataSource);
check(fileBytes <= MAX_BYTES, `blueprint-data.js is ${fileBytes} bytes; the budget is ${MAX_BYTES}`);
check(/generated/i.test(dataSource.split('\n')[0]) && /do not edit/i.test(dataSource.split('\n')[0]), 'blueprint-data.js must start with a header comment saying it is generated and must not be edited');
check(/^window\.BLUEPRINT = \{/m.test(dataSource), 'blueprint-data.js must assign window.BLUEPRINT = {...};');
check(!/\bfunction\b|=>/.test(dataSource.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/\/\/.*$/gm, '')), 'blueprint-data.js must be plain data (no functions)');
const modelSource = sources[MODEL_REL];
check(!/\?\.|\?\?/.test(modelSource.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/\/\/.*$/gm, '')), 'blueprint-model.js must stay ES2019 (no optional chaining or nullish coalescing)');
check(/^\(function \(\) \{/m.test(modelSource) && /'use strict'/.test(modelSource), 'blueprint-model.js must be a strict-mode IIFE');
const snapshot = JSON.stringify(B);

const TOP = ['meta', 'product', 'areas', 'domains', 'modules', 'teams', 'people', 'systems', 'releases', 'initiatives', 'features'];
check(keysExactly(B, TOP), `BLUEPRINT must have exactly these keys: ${TOP.join(', ')}; got ${Object.keys(B).join(', ')}`);
for (const k of TOP.slice(2)) if (!check(Array.isArray(B[k]), `BLUEPRINT.${k} must be an array`)) finish();

const F = B.features;
const N = F.length;
const areaById = new Map(B.areas.map((x) => [x.id, x]));
const domainById = new Map(B.domains.map((x) => [x.id, x]));
const moduleById = new Map(B.modules.map((x) => [x.id, x]));
const featureById = new Map(F.map((x) => [x.id, x]));
const teamById = new Map(B.teams.map((x) => [x.id, x]));
const personById = new Map(B.people.map((x) => [x.id, x]));
const systemById = new Map(B.systems.map((x) => [x.id, x]));
const releaseById = new Map(B.releases.map((x) => [x.id, x]));
const initiativeById = new Map(B.initiatives.map((x) => [x.id, x]));
const domainOfFeature = (f) => domainById.get((moduleById.get(f.moduleId) || {}).domainId) || {};
const areaOfFeature = (f) => areaById.get(domainOfFeature(f).areaId) || {};
const hasUi = (f) => asArray(f.surfaces).some((s) => UI.includes(s));
const expectedRegimes = (f) => {
  const d = domainOfFeature(f).id;
  const r = [];
  if (d === 'identity') r.push('GDPR');
  if (d === 'payments') r.push('PCI DSS');
  if (d === 'billing') r.push('SOC 2');
  if (asArray(f.surfaces).includes('web') || asArray(f.surfaces).includes('mobile')) r.push('EAA');
  return r;
};

// ── Meta, product, hierarchy ──────────────────────────────────────────────────────────────────

section('meta and product', () => {
  check(B.meta && B.meta.schemaVersion === '0.2' && B.meta.asOf === ASOF, `meta must be { schemaVersion: '0.2', asOf: '${ASOF}' }`);
  const p = B.product || {};
  check(p.id === 'larkspur' && p.name === 'Larkspur' && p.version === '1.11.3' && p.nextVersion === '1.12.0' && isStr(p.tagline),
    'product must be Larkspur v1.11.3 → 1.12.0 with a tagline');
  check(p.stack && ['web', 'api', 'workers', 'data', 'infra'].every((k) => isStr(p.stack[k])), 'product.stack needs web, api, workers, data and infra strings');
});

section('areas, domains and modules', () => {
  check(B.areas.length === 5, `expected 5 areas, found ${B.areas.length}`);
  check(B.domains.length === 17, `expected 17 domains, found ${B.domains.length}`);
  check(B.modules.length === 54, `expected 54 modules, found ${B.modules.length}`);
  let di = 0;
  let mi = 0;
  EXPECTED.forEach(([aid, aname, doms], ai) => {
    const a = B.areas[ai] || {};
    check(a.id === aid && a.name === aname, `area #${ai + 1} must be ${aid} · ${aname}, got ${a.id} · ${a.name}`);
    check(keysExactly(a, ['id', 'name', 'summary']), `area ${a.id} must have id, name and summary only`);
    doms.forEach(([did, code, dname, mods]) => {
      const d = B.domains[di++] || {};
      check(d.id === did && d.code === code && d.name === dname && d.areaId === aid, `domain #${di} must be ${did} · ${code} · ${dname} in ${aid}, got ${d.id} · ${d.code} · ${d.name} in ${d.areaId}`);
      check(keysExactly(d, ['id', 'areaId', 'code', 'name', 'summary']), `domain ${d.id} must have id, areaId, code, name and summary only`);
      mods.forEach(([mid, mname]) => {
        const m = B.modules[mi++] || {};
        check(m.id === mid && m.name === mname && m.domainId === did, `module #${mi} must be ${did}/${mid} · ${mname}, got ${m.domainId}/${m.id} · ${m.name}`);
      });
    });
  });
  for (const x of [...B.areas, ...B.domains, ...B.modules]) {
    check(isStr(x.summary) && x.summary.length >= 20 && x.summary.length <= 140 && /\.$/.test(x.summary), `${x.id} needs a one-sentence summary (20–140 chars, ending with a period)`);
  }
  for (const m of B.modules) {
    check(keysExactly(m, ['id', 'domainId', 'name', 'summary', 'owner', 'surfaces']), `module ${m.id} must have id, domainId, name, summary, owner and surfaces only`);
    check(teamById.has(m.owner) && teamById.get(m.owner).kind === 'human', `module ${m.id}: owner '${m.owner}' must be a human squad`);
    check(Array.isArray(m.surfaces) && m.surfaces.length > 0 && m.surfaces.every((s) => SURFACES.includes(s)) && new Set(m.surfaces).size === m.surfaces.length,
      `module ${m.id}: surfaces must be a non-empty unique subset of ${SURFACES.join(', ')}`);
    const n = F.filter((f) => f.moduleId === m.id).length;
    check(n >= 5 && n <= 14, `module ${m.id} has ${n} features; expected 5–14`);
  }
});

section('teams and people', () => {
  const humans = B.teams.filter((t) => t.kind === 'human');
  const agents = B.teams.filter((t) => t.kind === 'agent');
  check(humans.length === 6 && agents.length === 5 && B.teams.length === 11, `expected 6 human squads and 5 agent crews, found ${humans.length} and ${agents.length}`);
  check(new Set(B.teams.map((t) => t.id)).size === B.teams.length && new Set(B.teams.map((t) => t.name)).size === B.teams.length, 'team ids and names must be unique');
  B.teams.forEach((t) => check(keysExactly(t, ['id', 'name', 'kind']) && SLUG.test(t.id) && isStr(t.name), `team ${t.id} must be { id, name, kind }`));
  check(B.people.length >= 18 && B.people.length <= 26, `expected about 22 people, found ${B.people.length}`);
  check(new Set(B.people.map((p) => p.id)).size === B.people.length && new Set(B.people.map((p) => p.name)).size === B.people.length, 'people ids and names must be unique');
  B.people.forEach((p) => {
    check(keysExactly(p, ['id', 'name', 'role', 'team']), `person ${p.id} must be { id, name, role, team }`);
    check(isStr(p.name) && p.name.trim().split(/\s+/).length >= 2, `person ${p.id} needs a full name`);
    check(ROLES.includes(p.role), `person ${p.id}: role '${p.role}' is not one of ${ROLES.join(', ')}`);
    check(teamById.has(p.team) && teamById.get(p.team).kind === 'human', `person ${p.id}: team '${p.team}' must be a human squad`);
    check(!teamById.has(p.id), `person id ${p.id} collides with a team id`);
  });
  for (const role of ['engineering', 'product', 'security', 'design', 'compliance', 'operations']) check(B.people.some((p) => p.role === role), `no person has role ${role}`);
  check(new Set(B.systems.map((x) => x.id)).size === B.systems.length, 'system ids must be unique');
  B.systems.forEach((x) => {
    check(keysExactly(x, ['id', 'name', 'kind']) && SLUG.test(x.id) && isStr(x.name) && SYSTEM_KINDS.includes(x.kind), `system ${x.id} must be { id, name, kind: ${SYSTEM_KINDS.join('|')} }`);
    check(!teamById.has(x.id) && !personById.has(x.id), `system id ${x.id} collides with a team or person id`);
  });
  for (const id of new Set(Object.values(SYSTEM_FOR))) check(systemById.has(id), `system '${id}' is missing`);
});

// ── Releases ──────────────────────────────────────────────────────────────────────────────────

const shipped = B.releases.filter((r) => r.state === 'shipped');
const shippedIdx = new Map(shipped.map((r, i) => [r.id, i]));
section('releases', () => {
  const ids = ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '1.10', '1.11', '1.12', '2.0', '2.1'];
  check(B.releases.map((r) => r.id).join() === ids.join(), `releases must be ${ids.join(', ')} in order`);
  const want = { '1.0': '2025-06-10', '1.11': '2026-09-22', '1.12': '2026-11-03', '2.0': '2027-01-26', '2.1': '2027-04-13' };
  for (const [id, date] of Object.entries(want)) check((releaseById.get(id) || {}).date === date, `release ${id} must be dated ${date}`);
  B.releases.forEach((r, i) => {
    check(keysExactly(r, ['id', 'label', 'date', 'state', 'name', 'summary', 'items']), `release ${r.id} must have id, label, date, state, name, summary and items`);
    check(r.label === 'v' + r.id && DATE.test(r.date) && isStr(r.name) && isStr(r.summary) && r.summary.length <= 160, `release ${r.id} needs label v${r.id}, a date, a name and a short summary`);
    const state = i < 12 ? 'shipped' : i === 12 ? 'next' : 'future';
    check(r.state === state, `release ${r.id} must be ${state}`);
    check(state === 'shipped' ? r.date <= ASOF : r.date > ASOF, `release ${r.id} date ${r.date} does not match its state`);
    if (i > 0 && i < 12) {
      const gap = days(B.releases[i - 1].date, r.date);
      check(gap >= 35 && gap <= 56, `release ${r.id} comes ${gap} days after the previous one; expected about six weeks`);
    }
    check(Array.isArray(r.items), `release ${r.id} items must be an array`);
    const seen = new Set();
    asArray(r.items).forEach((it) => {
      check(keysExactly(it, ['feature', 'kind', 'note']) && featureById.has(it.feature) && ['new', 'improved', 'fixed'].includes(it.kind) && (it.note === null || isStr(it.note)),
        `release ${r.id}: bad item ${JSON.stringify(it)}`);
      check(!seen.has(it.feature), `release ${r.id} lists ${it.feature} twice`);
      seen.add(it.feature);
    });
    if (state === 'shipped') check(r.items.length >= 25 && r.items.length <= 70, `shipped release ${r.id} has ${r.items.length} items; expected 25–70`);
  });
  check(new Set(B.releases.map((r) => r.name)).size === B.releases.length, 'release names must be unique');
});

// ── Features ──────────────────────────────────────────────────────────────────────────────────

const FEATURE_KEYS = ['id', 'moduleId', 'name', 'summary', 'status', 'priority', 'release', 'owner', 'builtBy', 'surfaces', 'progress', 'createdAt', 'updatedAt', 'dependsOn', 'metrics', 'workItems', 'branches', 'ledger'];
const OPTIONAL_KEYS = ['blockedReason', 'note'];
section('feature fields', () => {
  check(N >= 480 && N <= 520, `expected 480–520 features, found ${N}`);
  check(featureById.size === N, 'feature ids must be unique');
  const names = new Set();
  for (const f of F) {
    const extra = Object.keys(f).filter((k) => !FEATURE_KEYS.includes(k) && !OPTIONAL_KEYS.includes(k));
    check(FEATURE_KEYS.every((k) => k in f) && !extra.length, `feature ${f.id}: keys must be ${FEATURE_KEYS.join(', ')} plus optional ${OPTIONAL_KEYS.join(', ')}; extra ${extra.join(', ')}`);
    const m = moduleById.get(f.moduleId);
    check(m, `feature ${f.id}: moduleId '${f.moduleId}' does not resolve`);
    check(isStr(f.name) && f.name.length <= 32, `feature ${f.id}: name '${f.name}' must be 1–32 characters`);
    check(!/^[A-Z]{2,5}-\d+|[#@{}<>]/.test(f.name), `feature ${f.id}: name '${f.name}' must be a plain title, without codes or symbols`);
    check(!names.has(f.name.toLowerCase()), `duplicate feature name '${f.name}'`);
    names.add(f.name.toLowerCase());
    check(f.id === `${f.moduleId}.${slugOf(f.name)}` && SLUG.test(f.id.split('.')[1] || ''), `feature ${f.id}: id must be '<moduleId>.<slug of name>'`);
    check(isStr(f.summary) && f.summary.length >= 20 && f.summary.length <= 120 && /\.$/.test(f.summary), `feature ${f.id}: summary must be one sentence of 20–120 characters`);
    check(STATUS_ORDER.includes(f.status), `feature ${f.id}: bad status ${f.status}`);
    check(PRIORITIES.includes(f.priority), `feature ${f.id}: bad priority ${f.priority}`);
    check(BUILDERS.includes(f.builtBy), `feature ${f.id}: bad builtBy ${f.builtBy}`);
    check(teamById.has(f.owner) && teamById.get(f.owner).kind === 'human', `feature ${f.id}: owner '${f.owner}' must be a human squad`);
    check(m && f.owner === m.owner, `feature ${f.id}: owner should be its module's squad`);
    check(Array.isArray(f.surfaces) && f.surfaces.length > 0 && new Set(f.surfaces).size === f.surfaces.length && f.surfaces.every((s) => m && m.surfaces.includes(s)),
      `feature ${f.id}: surfaces must be a non-empty unique subset of the module's surfaces`);
    check(isInt(f.progress) && f.progress >= 0 && f.progress <= 100, `feature ${f.id}: progress must be an integer 0–100`);
    check(DATE.test(f.createdAt) && DATE.test(f.updatedAt) && f.createdAt <= f.updatedAt && f.updatedAt <= ASOF, `feature ${f.id}: dates must satisfy createdAt ≤ updatedAt ≤ ${ASOF}`);
    check(f.release === null || releaseById.has(f.release), `feature ${f.id}: release '${f.release}' does not resolve`);
    check(Array.isArray(f.dependsOn) && Array.isArray(f.workItems) && Array.isArray(f.branches) && Array.isArray(f.ledger), `feature ${f.id}: dependsOn, workItems, branches and ledger must be arrays`);
    if ('note' in f) check(isStr(f.note) && f.note.length <= 140, `feature ${f.id}: note must be a short string`);
  }
});

section('metrics and applicability', () => {
  for (const f of F) {
    const m = f.metrics;
    if (!check(m && keysExactly(m, METRIC_LENSES), `feature ${f.id}: metrics must have exactly ${METRIC_LENSES.join(', ')}`)) continue;
    const planned = f.status === 'planned';
    const live = f.status === 'live';
    const regimes = expectedRegimes(f);
    const want = {
      dev: !planned, sec: !planned, ops: live, biz: live, cost: live,
      comp: regimes.length > 0, ux: hasUi(f) && !planned,
    };
    for (const l of METRIC_LENSES) check((m[l] !== null) === want[l], `feature ${f.id} (${f.status}): metrics.${l} must be ${want[l] ? 'present' : 'null'}`);
    if (m.dev) {
      check(keysExactly(m.dev, ['quality', 'coverage', 'bugs']) && 'ABCDE'.includes(m.dev.quality) && m.dev.quality.length === 1 && isInt(m.dev.coverage) && m.dev.coverage >= 0 && m.dev.coverage <= 100
        && m.dev.bugs && keysExactly(m.dev.bugs, ['critical', 'major', 'minor']) && ['critical', 'major', 'minor'].every((k) => isInt(m.dev.bugs[k]) && m.dev.bugs[k] >= 0), `feature ${f.id}: bad dev metrics ${JSON.stringify(m.dev)}`);
    }
    if (m.ops) {
      const o = m.ops;
      check(keysExactly(o, ['monitored', 'uptime', 'errorRate', 'p95', 'sloP95']) && typeof o.monitored === 'boolean' && isInt(o.sloP95) && o.sloP95 > 0, `feature ${f.id}: bad ops metrics ${JSON.stringify(o)}`);
      if (o.monitored) check(isNum(o.uptime) && o.uptime >= 95 && o.uptime <= 100 && isNum(o.errorRate) && o.errorRate >= 0 && o.errorRate <= 20 && isInt(o.p95) && o.p95 > 0, `feature ${f.id}: monitored ops needs uptime, errorRate and p95`);
      else check(o.uptime === null && o.errorRate === null && o.p95 === null, `feature ${f.id}: unmonitored ops must have null uptime, errorRate and p95`);
    }
    if (m.biz) check(keysExactly(m.biz, ['adoption', 'satisfaction']) && isInt(m.biz.adoption) && m.biz.adoption >= 0 && m.biz.adoption <= 100
      && (m.biz.satisfaction === null || (isNum(m.biz.satisfaction) && m.biz.satisfaction >= 1 && m.biz.satisfaction <= 5)), `feature ${f.id}: bad biz metrics ${JSON.stringify(m.biz)}`);
    if (m.sec) {
      const s = m.sec;
      check(keysExactly(s, ['vulns', 'lastScan', 'secretsClean']) && s.vulns && keysExactly(s.vulns, ['critical', 'high', 'medium']) && ['critical', 'high', 'medium'].every((k) => isInt(s.vulns[k]) && s.vulns[k] >= 0)
        && (s.lastScan === null || (DATE.test(s.lastScan) && s.lastScan <= ASOF && s.lastScan >= f.createdAt)) && typeof s.secretsClean === 'boolean', `feature ${f.id}: bad sec metrics ${JSON.stringify(s)}`);
    }
    if (m.comp) {
      const c = m.comp;
      check(keysExactly(c, ['regimes', 'coverage', 'findings']) && JSON.stringify(c.regimes) === JSON.stringify(regimes) && c.regimes.every((r) => REGIMES.includes(r))
        && isInt(c.coverage) && c.coverage >= 0 && c.coverage <= 100 && isInt(c.findings) && c.findings >= 0, `feature ${f.id}: comp must be { regimes: ${JSON.stringify(regimes)}, coverage, findings }, got ${JSON.stringify(c)}`);
    }
    if (m.ux) check(keysExactly(m.ux, ['a11y', 'usability', 'debt']) && isInt(m.ux.a11y) && m.ux.a11y >= 0 && m.ux.a11y <= 100
      && (m.ux.usability === null || (isNum(m.ux.usability) && m.ux.usability >= 1 && m.ux.usability <= 5)) && isInt(m.ux.debt) && m.ux.debt >= 0, `feature ${f.id}: bad ux metrics ${JSON.stringify(m.ux)}`);
    if (m.cost) check(keysExactly(m.cost, ['monthly', 'budget', 'trend']) && isNum(m.cost.monthly) && m.cost.monthly > 0 && isNum(m.cost.budget) && m.cost.budget > 0 && isNum(m.cost.trend),
      `feature ${f.id}: bad cost metrics ${JSON.stringify(m.cost)}`);
  }
});

// ── Work items and branches ───────────────────────────────────────────────────────────────────

const allItems = [];
const allBranches = [];
section('work items', () => {
  const ids = new Set();
  const refs = new Set();
  for (const f of F) {
    for (const w of f.workItems) {
      allItems.push([f, w]);
      check(keysExactly(w, ['id', 'title', 'source', 'sourceRef', 'kind', 'state', 'priority', 'createdAt', 'triagedBy', 'initiative']), `work item ${w.id} on ${f.id} has the wrong keys`);
      check(/^wi-\d{4}$/.test(w.id) && !ids.has(w.id), `work item id ${w.id} must be unique and look like wi-0001`);
      ids.add(w.id);
      check(isStr(w.title) && w.title.length <= 90, `work item ${w.id}: title must be 1–90 characters`);
      check(WI_SOURCES.includes(w.source) && WI_KINDS.includes(w.kind) && WI_STATES.includes(w.state) && PRIORITIES.includes(w.priority), `work item ${w.id}: bad source, kind, state or priority`);
      const refOk = w.source === 'goal' ? /^GOAL-\d+$/.test(w.sourceRef) : w.source === 'ticket' ? /^LRK-\d{4}$/.test(w.sourceRef) : /^[A-Z0-9]{3,5}-\d{4}$/.test(w.sourceRef);
      check(refOk, `work item ${w.id}: sourceRef '${w.sourceRef}' does not fit source ${w.source}`);
      check(!refs.has(w.sourceRef), `work item ${w.id}: sourceRef ${w.sourceRef} is reused`);
      refs.add(w.sourceRef);
      check(DATE.test(w.createdAt) && w.createdAt >= f.createdAt && w.createdAt <= ASOF, `work item ${w.id}: createdAt ${w.createdAt} must be between the feature's createdAt and ${ASOF}`);
      if (w.state === 'triage') check(w.source === 'scan' && w.triagedBy === null, `work item ${w.id}: only scan findings wait in triage, and they have no triagedBy`);
      else if (w.source === 'scan') check(personById.has(w.triagedBy), `work item ${w.id}: a triaged scan finding needs triagedBy (a person)`);
      else check(w.triagedBy === null, `work item ${w.id}: only scan findings are triaged`);
      if (w.state === 'dismissed') check(w.source === 'scan', `work item ${w.id}: only scan findings are dismissed`);
      check(w.initiative === null || initiativeById.has(w.initiative), `work item ${w.id}: initiative '${w.initiative}' does not resolve`);
      if (w.initiative) check(asArray((initiativeById.get(w.initiative) || {}).coverage).some((c) => c.feature === f.id), `work item ${w.id}: ${f.id} is not in initiative ${w.initiative}'s coverage`);
    }
  }
});

section('branches', () => {
  const ids = new Set();
  for (const f of F) {
    const items = new Map(f.workItems.map((w) => [w.id, w]));
    for (const b of f.branches) {
      allBranches.push([f, b]);
      check(keysExactly(b, ['id', 'workItem', 'crew', 'author', 'activity', 'state', 'openedAt', 'updatedAt', 'checks', 'evidence', 'reviewer', 'note']), `branch ${b.id} on ${f.id} has the wrong keys`);
      check(!ids.has(b.id), `branch id ${b.id} is not unique`);
      ids.add(b.id);
      check(ACTIVITIES.includes(b.activity) && BR_STATES.includes(b.state), `branch ${b.id}: bad activity or state`);
      check(isStr(b.id) && b.id.startsWith(PREFIX[b.activity] || '?') && b.id.slice((PREFIX[b.activity] || '').length).startsWith(slugOf(f.name)), `branch ${b.id}: name must be ${PREFIX[b.activity]}<feature slug>…`);
      const w = items.get(b.workItem);
      check(w, `branch ${b.id}: workItem ${b.workItem} is not on ${f.id}`);
      check(b.crew === null || (teamById.has(b.crew) && teamById.get(b.crew).kind === 'agent'), `branch ${b.id}: crew must be an agent crew or null`);
      check(b.author === null || (personById.has(b.author) && personById.get(b.author).role === 'engineering'), `branch ${b.id}: author must be an engineer or null`);
      check(b.crew !== null || b.author !== null, `branch ${b.id}: needs a crew or an author`);
      const wantCrew = f.builtBy !== 'human';
      const wantAuthor = f.builtBy !== 'agent';
      check((b.crew !== null) === wantCrew && (b.author !== null) === wantAuthor, `branch ${b.id}: crew/author do not match builtBy ${f.builtBy}`);
      check(DATE.test(b.openedAt) && DATE.test(b.updatedAt) && b.openedAt <= b.updatedAt && b.updatedAt <= ASOF && (!w || b.openedAt >= w.createdAt), `branch ${b.id}: dates must satisfy workItem.createdAt ≤ openedAt ≤ updatedAt ≤ ${ASOF}`);
      check(b.checks && keysExactly(b.checks, ['tests', 'coverageDelta']) && ['pass', 'fail', 'running'].includes(b.checks.tests) && isNum(b.checks.coverageDelta), `branch ${b.id}: checks must be { tests, coverageDelta }`);
      if (b.state !== 'running') check(b.checks.tests !== 'running', `branch ${b.id}: only running branches have running tests`);
      if (['awaiting-approval', 'approved', 'merged'].includes(b.state)) check(b.checks.tests === 'pass', `branch ${b.id}: tests must pass to be ${b.state}`);
      if (b.state === 'awaiting-approval') check(b.evidence !== null, `branch ${b.id}: awaiting approval needs evidence`);
      if (b.evidence !== null) check(keysExactly(b.evidence, ['kind', 'title', 'summary', 'ref']) && ['demo', 'report'].includes(b.evidence.kind) && isStr(b.evidence.title) && isStr(b.evidence.summary) && isStr(b.evidence.ref), `branch ${b.id}: evidence must be { kind, title, summary, ref }`);
      if (b.state === 'running') check(b.evidence === null && b.reviewer === null, `branch ${b.id}: a running branch has no evidence or reviewer yet`);
      if (b.state === 'changes-requested') check(personById.has(b.reviewer) && isStr(b.note), `branch ${b.id}: changes requested needs reviewer and note`);
      else check(b.note === null, `branch ${b.id}: only changes-requested branches carry a reviewer note`);
      if (['approved', 'merged'].includes(b.state)) check(personById.has(b.reviewer) && b.evidence !== null, `branch ${b.id}: ${b.state} needs a reviewer and the evidence it was approved on`);
      if (b.reviewer !== null) check(personById.has(b.reviewer) && b.reviewer !== b.author, `branch ${b.id}: reviewer must be a person other than the author`);
      if (b.activity === 'test') check(b.checks.coverageDelta > 0, `branch ${b.id}: a test branch must raise coverage`);
    }
    // Work item ↔ branch states.
    for (const w of f.workItems) {
      const brs = f.branches.filter((b) => b.workItem === w.id);
      const active = brs.filter((b) => ACTIVE_BR.includes(b.state));
      if (w.state === 'done') check(brs.some((b) => b.state === 'merged'), `work item ${w.id} is done without a merged branch`);
      if (w.state === 'in-progress') check(active.length > 0, `work item ${w.id} is in progress without an active branch`);
      if (w.state === 'review') check(active.some((b) => b.state === 'awaiting-approval' || b.state === 'approved'), `work item ${w.id} is in review without a branch awaiting or approved`);
      if (['triage', 'backlog', 'dismissed'].includes(w.state)) check(active.length === 0, `work item ${w.id} is ${w.state} but has an active branch`);
      if (w.state !== 'done') check(!brs.some((b) => b.state === 'merged') || ['in-progress', 'review'].includes(w.state), `work item ${w.id}: merged branch on a ${w.state} item`);
    }
  }
});

// ── Status coherence ──────────────────────────────────────────────────────────────────────────

section('status coherence', () => {
  for (const f of F) {
    const st = f.status;
    const brStates = f.branches.map((b) => b.state);
    if (st === 'planned') {
      check(f.branches.length === 0 || (f.branches.length === 1 && brStates[0] === 'running'), `planned ${f.id}: at most one running spike branch`);
      check(f.progress >= 0 && f.progress <= 10, `planned ${f.id}: progress ${f.progress} must be 0–10`);
      check(f.release === null || ['next', 'future'].includes((releaseById.get(f.release) || {}).state), `planned ${f.id}: release must be null or upcoming`);
    }
    if (st === 'building') {
      check(brStates.some((s) => ['running', 'awaiting-approval', 'changes-requested'].includes(s)), `building ${f.id}: needs a running, awaiting or changes-requested branch`);
      check(f.progress >= 15 && f.progress <= 90, `building ${f.id}: progress ${f.progress} must be 15–90`);
      check(['next', 'future'].includes((releaseById.get(f.release) || {}).state), `building ${f.id}: must target an upcoming release`);
    }
    if (st === 'ready') {
      check(brStates.some((s) => s === 'approved' || s === 'merged'), `ready ${f.id}: needs an approved or merged branch`);
      check(f.progress === 100, `ready ${f.id}: progress must be 100`);
      check(f.release === '1.12', `ready ${f.id}: target release must be 1.12`);
    }
    if (st === 'live') {
      check(f.progress === 100, `live ${f.id}: progress must be 100`);
      check((releaseById.get(f.release) || {}).state === 'shipped', `live ${f.id}: release must be shipped`);
      check(f.ledger.some((e) => e.action === 'deploy') && f.ledger.some((e) => e.action === 'release'), `live ${f.id}: ledger needs deploy and release entries`);
    }
    if (st === 'blocked') {
      check(['next', 'future'].includes((releaseById.get(f.release) || {}).state) || f.release === null, `blocked ${f.id}: release must be upcoming or null`);
    }
    check((st === 'blocked') === isStr(f.blockedReason), `${f.id}: blockedReason must be set exactly when blocked`);
    if (f.blockedReason) check(f.blockedReason.length <= 140, `${f.id}: blockedReason is too long`);
  }
});

section('dependencies', () => {
  for (const f of F) {
    check(new Set(f.dependsOn).size === f.dependsOn.length && !f.dependsOn.includes(f.id), `${f.id}: dependsOn must be unique and not include itself`);
    for (const d of f.dependsOn) {
      const g = featureById.get(d);
      if (!check(g, `${f.id}: dependency ${d} does not resolve`)) continue;
      if (f.status === 'live') check(g.status === 'live' && releaseById.get(g.release).date <= releaseById.get(f.release).date, `live ${f.id} depends on ${d}, which shipped later or is not live`);
    }
  }
  const state = new Map();
  const visit = (id, stack) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      check(false, `dependency cycle: ${[...stack, id].join(' → ')}`);
      return;
    }
    state.set(id, 1);
    for (const d of (featureById.get(id) || { dependsOn: [] }).dependsOn) visit(d, [...stack, id]);
    state.set(id, 2);
  };
  F.forEach((f) => visit(f.id, []));
});

// ── Ledger ────────────────────────────────────────────────────────────────────────────────────

let ledgerTotal = 0;
section('ledger', () => {
  const ids = new Set();
  for (const f of F) {
    const L = f.ledger;
    ledgerTotal += L.length;
    const n = L.length;
    if (f.status === 'live') check(n >= 4 && n <= 10, `live ${f.id}: ${n} ledger entries; expected 4–10`);
    else if (f.status === 'planned') check(n >= 1 && n <= 3, `planned ${f.id}: ${n} ledger entries; expected 1–3`);
    else check(n >= 1, `${f.id}: needs at least one ledger entry`);
    L.forEach((e, i) => {
      check(keysExactly(e, ['id', 'at', 'actor', 'actorKind', 'action', 'lens', 'result', 'summary', 'ref', 'hash']), `ledger ${e.id} on ${f.id} has the wrong keys`);
      check(/^ev-\d{5}$/.test(e.id) && !ids.has(e.id), `ledger id ${e.id} must be unique and look like ev-00001`);
      ids.add(e.id);
      check(STAMP.test(e.at) && e.at.slice(0, 10) <= ASOF && e.at.slice(0, 10) >= f.createdAt, `ledger ${e.id}: at ${e.at} must be YYYY-MM-DDTHH:MM:00Z between the feature's createdAt and ${ASOF}`);
      if (i > 0) check(L[i - 1].at >= e.at, `${f.id}: ledger must be sorted newest first (${L[i - 1].id} before ${e.id})`);
      const actorOk = e.actorKind === 'human' ? personById.has(e.actor)
        : e.actorKind === 'agent' ? teamById.has(e.actor) && teamById.get(e.actor).kind === 'agent'
          : e.actorKind === 'system' ? systemById.has(e.actor) : false;
      check(actorOk, `ledger ${e.id}: actor '${e.actor}' does not fit actorKind '${e.actorKind}'`);
      if (e.actorKind === 'system') {
        const want = SYSTEM_FOR[e.action + ':' + e.lens] || SYSTEM_FOR[e.action];
        check(want === e.actor, `ledger ${e.id}: a system '${e.action}' entry should come from '${want}', not '${e.actor}'`);
      }
      check(ACTIONS.includes(e.action) && RESULTS.includes(e.result), `ledger ${e.id}: bad action or result`);
      check(e.lens === null || (LENS_IDS.includes(e.lens) && e.lens !== 'overall'), `ledger ${e.id}: lens must be a metric lens or null`);
      check(isStr(e.summary) && e.summary.length <= 120 && isStr(e.ref), `ledger ${e.id}: needs a short summary and a ref`);
      check(/^[0-9a-f]{7}$/.test(e.hash), `ledger ${e.id}: hash must be 7 hex characters`);
    });
    check(L.length === 0 || L[0].at.slice(0, 10) === f.updatedAt, `${f.id}: updatedAt ${f.updatedAt} must be the date of the newest ledger entry`);
  }
});

/** Newest ledger entry of a feature for an action and lens. */
const newest = (f, action, lens) => f.ledger.find((e) => e.action === action && e.lens === lens);

section('ledger backs the metrics', () => {
  for (const f of F) {
    const m = f.metrics;
    if (m.dev) {
      const e = newest(f, 'test', 'dev');
      const x = e && /^Quality ([A-E]), (\d+)% coverage, (.+)$/.exec(e.summary);
      if (check(x, `${f.id}: needs a test entry for dev that states quality and coverage`)) {
        check(x[1] === m.dev.quality && +x[2] === m.dev.coverage, `${f.id}: test entry '${e.summary}' does not match dev metrics`);
        const b = m.dev.bugs;
        const want = b.critical ? `${b.critical} critical bug` : b.major ? `${b.major} major bug` : b.minor ? `${b.minor} minor bug` : 'no open bugs';
        check(x[3].startsWith(want), `${f.id}: test entry bugs '${x[3]}' do not match ${JSON.stringify(b)}`);
      }
    } else check(!f.ledger.some((e) => e.action === 'test'), `${f.id}: test entries without dev metrics`);
    if (m.ops) {
      const e = newest(f, 'monitor', 'ops');
      if (check(e, `${f.id}: needs a monitor entry for ops`)) {
        if (m.ops.monitored) {
          const x = /^([\d.]+)% uptime, ([\d.]+)% errors, p95 (\d+) ms \(SLO (\d+)\)$/.exec(e.summary);
          check(x && +x[1] === m.ops.uptime && +x[2] === m.ops.errorRate && +x[3] === m.ops.p95 && +x[4] === m.ops.sloP95, `${f.id}: monitor entry '${e.summary}' does not match ops metrics`);
        } else check(/^No monitors/.test(e.summary) && e.result === 'warn', `${f.id}: an unmonitored feature's monitor entry must say so`);
      }
    }
    if (m.sec && m.sec.lastScan) {
      const e = newest(f, 'scan', 'sec');
      const x = e && /^(\d+) critical, (\d+) high, (\d+) medium, secrets (clean|exposed)$/.exec(e.summary);
      if (check(x, `${f.id}: needs a scan entry for sec`)) {
        const v = m.sec.vulns;
        check(+x[1] === v.critical && +x[2] === v.high && +x[3] === v.medium && (x[4] === 'clean') === m.sec.secretsClean, `${f.id}: scan entry '${e.summary}' does not match sec metrics`);
        check(e.at.slice(0, 10) === m.sec.lastScan, `${f.id}: newest security scan is dated ${e.at.slice(0, 10)}, lastScan says ${m.sec.lastScan}`);
        check(e.result === (v.critical > 0 || !m.sec.secretsClean ? 'fail' : v.high > 0 ? 'warn' : 'pass'), `${f.id}: scan entry result ${e.result} does not match its findings`);
      }
    } else check(!f.ledger.some((e) => e.action === 'scan' && e.lens === 'sec'), `${f.id}: security scan entries but no lastScan`);
    if (m.comp && m.comp.coverage > 0) {
      const e = newest(f, 'audit', 'comp');
      const x = e && /: (\d+)% covered, (\d+) findings?$/.exec(e.summary);
      check(x && +x[1] === m.comp.coverage && +x[2] === m.comp.findings && e.summary.startsWith(m.comp.regimes.join(', ')), `${f.id}: needs a compliance audit entry matching comp metrics`);
    } else check(!f.ledger.some((e) => e.action === 'audit' && e.lens === 'comp'), `${f.id}: compliance audit entries without a compliance scan`);
    if (m.ux) {
      const e = newest(f, 'audit', 'ux');
      const x = e && /^WCAG (\d+), (usability ([\d.]+)\/5|usability untested), (\d+) UX debt items?$/.exec(e.summary);
      check(x && +x[1] === m.ux.a11y && +x[4] === m.ux.debt && (m.ux.usability === null ? !x[3] : +x[3] === m.ux.usability), `${f.id}: needs a UX audit entry matching ux metrics`);
    }
    if (m.cost) {
      const e = newest(f, 'cost', 'cost');
      const x = e && /^\$([\d,]+)\/mo, (\d+)% of budget, ([+-]?\d+)% in 30 days$/.exec(e.summary);
      check(x && +x[1].replace(/,/g, '') === Math.round(m.cost.monthly) && +x[2] === Math.round((m.cost.monthly / m.cost.budget) * 100) && +x[3] === m.cost.trend,
        `${f.id}: needs a cost entry matching cost metrics`);
    }
    for (const b of f.branches) {
      if (b.state === 'awaiting-approval') check(f.ledger.some((e) => (e.action === 'demo' || e.action === 'report') && e.ref === b.evidence.ref), `${f.id}: the evidence for ${b.id}, awaiting approval, must be in the ledger`);
      if (b.state === 'changes-requested') check(f.ledger.some((e) => e.action === 'request-changes' && e.ref === b.id && e.actor === b.reviewer), `${f.id}: the change request on ${b.id} must be in the ledger, by its reviewer`);
    }
    if (f.status === 'live') {
      const rel = f.ledger.find((e) => e.action === 'release');
      const r = rel && releaseById.get(rel.ref.replace(/^v/, ''));
      check(r && r.state === 'shipped' && rel.at.slice(0, 10) === r.date && r.items.some((it) => it.feature === f.id), `${f.id}: release entry must name a shipped release that lists the feature, on its date`);
      const dep = f.ledger.find((e) => e.action === 'deploy');
      check(dep && dep.at.slice(0, 10) >= releaseById.get(f.release).date, `${f.id}: deploy entry must come after the first release`);
    }
  }
});

// ── Release items against features ────────────────────────────────────────────────────────────

section('release items and features', () => {
  const byFeature = new Map();
  B.releases.forEach((r, i) => r.items.forEach((it) => {
    if (!byFeature.has(it.feature)) byFeature.set(it.feature, []);
    byFeature.get(it.feature).push({ r, i, kind: it.kind });
  }));
  for (const f of F) {
    const list = byFeature.get(f.id) || [];
    const news = list.filter((x) => x.kind === 'new');
    if (f.status === 'live') {
      check(news.length === 1 && news[0].r.id === f.release, `live ${f.id}: must be 'new' exactly once, in v${f.release}`);
      const first = B.releases.findIndex((r) => r.id === f.release);
      list.filter((x) => x.kind !== 'new').forEach((x) => check(x.i > first, `live ${f.id}: ${x.kind} in v${x.r.id} before it first shipped`));
    } else {
      check(list.every((x) => x.r.state !== 'shipped'), `${f.status} ${f.id} appears in a shipped release`);
      check(list.every((x) => x.kind === 'new'), `${f.status} ${f.id}: only 'new' items for features that have not shipped`);
      check(f.release ? news.length === 1 && news[0].r.id === f.release : news.length === 0, `${f.status} ${f.id}: must be 'new' in its target release only`);
    }
  }
});

// ── Initiatives ───────────────────────────────────────────────────────────────────────────────

section('initiatives', () => {
  check(B.initiatives.length === 6, `expected 6 initiatives, found ${B.initiatives.length}`);
  EXPECTED_INITIATIVES.forEach(([kind, type, re], i) => {
    const ini = B.initiatives[i] || {};
    check(ini.kind === kind && ini.type === type && re.test(ini.name || ''), `initiative #${i + 1} must be a ${kind} '${type}' initiative matching ${re}, got ${ini.kind} ${ini.type} '${ini.name}'`);
  });
  for (const ini of B.initiatives) {
    check(keysExactly(ini, ['id', 'name', 'kind', 'type', 'summary', 'owner', 'startedAt', 'endsAt', 'coverage']), `initiative ${ini.id} has the wrong keys`);
    check(SLUG.test(ini.id) && isStr(ini.name) && isStr(ini.summary) && ini.summary.length <= 160, `initiative ${ini.id}: needs id, name and a short summary`);
    check(personById.has(ini.owner), `initiative ${ini.id}: owner must be a person`);
    check(DATE.test(ini.startedAt) && ini.startedAt <= ASOF, `initiative ${ini.id}: startedAt must be a date on or before ${ASOF}`);
    if (ini.kind === 'permanent') check(ini.endsAt === null, `permanent initiative ${ini.id}: endsAt must be null`);
    else check(DATE.test(ini.endsAt) && ini.endsAt > ini.startedAt, `temporary initiative ${ini.id}: endsAt must be a date after startedAt`);
    const seen = new Set();
    for (const c of ini.coverage) {
      const keysOk = c && Object.keys(c).every((k) => ['feature', 'state', 'note'].includes(k)) && 'feature' in c && 'state' in c;
      check(keysOk && featureById.has(c.feature) && COVERAGE_STATES.includes(c.state) && (c.note === undefined || isStr(c.note)), `initiative ${ini.id}: bad coverage ${JSON.stringify(c)}`);
      check(!seen.has(c.feature), `initiative ${ini.id}: ${c.feature} is listed twice`);
      seen.add(c.feature);
    }
    check(ini.coverage.length > 0, `initiative ${ini.id}: coverage is empty`);
  }
  const cov = (id) => new Map(asArray((initiativeById.get(id) || {}).coverage).map((c) => [c.feature, c]));
  const openOf = (f, ini) => f.workItems.filter((w) => w.initiative === ini && OPEN.includes(w.state));

  const comp = cov('compliance-scan');
  for (const f of F) {
    const c = f.metrics.comp;
    if (!check(!!c === comp.has(f.id), `compliance-scan must cover exactly the features with compliance metrics (${f.id})`) || !c) continue;
    const want = c.findings > 0 ? 'finding' : c.coverage >= 90 ? 'covered' : c.coverage > 0 ? 'in-progress' : 'pending';
    check(comp.get(f.id).state === want, `compliance-scan: ${f.id} should be ${want}, not ${comp.get(f.id).state}`);
  }
  const a11y = cov('a11y-monitoring');
  for (const f of F) {
    if (f.status === 'live' && f.metrics.ux) check(a11y.has(f.id), `a11y-monitoring must cover live UI feature ${f.id}`);
    if (a11y.has(f.id)) {
      check(!!f.metrics.ux, `a11y-monitoring covers ${f.id}, which has no UX metrics`);
      check((a11y.get(f.id).state === 'finding') === openOf(f, 'a11y-monitoring').length > 0, `a11y-monitoring: ${f.id} is 'finding' exactly when it has an open accessibility item`);
    }
  }
  const refactor = cov('payments-refactor');
  const refactorDomains = new Set();
  for (const [id, c] of refactor) {
    const f = featureById.get(id);
    const d = domainOfFeature(f).id;
    refactorDomains.add(d);
    check(d === 'payments' || d === 'checkout', `payments-refactor covers ${id} outside Payments and Checkout`);
    if (c.state === 'in-progress') check(openOf(f, 'payments-refactor').some((w) => f.branches.some((b) => b.workItem === w.id && ACTIVE_BR.includes(b.state))), `payments-refactor: ${id} is in progress without an active refactor branch`);
    else check(openOf(f, 'payments-refactor').length === 0, `payments-refactor: ${id} is ${c.state} but has open refactor work`);
  }
  check(refactorDomains.has('payments') && refactorDomains.has('checkout'), 'payments-refactor must cover both Payments and Checkout');
  const perf = cov('perf-scan-2026-10');
  const perfDomains = new Set();
  for (const [id, c] of perf) {
    const f = featureById.get(id);
    check(['storefront', 'discovery', 'checkout'].includes(domainOfFeature(f).id) && f.status === 'live', `perf scan covers ${id}, which is not a live Search, Storefront or Checkout feature`);
    check((c.state === 'finding') === (openOf(f, 'perf-scan-2026-10').length > 0), `perf scan: ${id} is 'finding' exactly when it has an open perf finding`);
  }
  for (const [f, w] of allItems) {
    if (w.initiative !== 'perf-scan-2026-10') continue;
    check(w.source === 'scan' && w.kind === 'perf' && w.createdAt >= '2026-10-01', `perf scan item ${w.id} must be a perf scan finding from October`);
    if (w.state === 'triage') perfDomains.add(domainOfFeature(f).id);
  }
  check(['storefront', 'discovery', 'checkout'].every((d) => perfDomains.has(d)), `perf scan must leave triage items in Search, Storefront and Checkout (found ${[...perfDomains].join(', ')})`);
  const node = cov('node-22');
  for (const [id, c] of node) {
    const f = featureById.get(id);
    check(f.surfaces.includes('worker'), `node-22 covers ${id}, which has no worker`);
    check((c.state === 'in-progress') === (openOf(f, 'node-22').length > 0), `node-22: ${id} is in progress exactly when it has open upgrade work`);
  }
  const cost = cov('cost-sprint');
  for (const [id, c] of cost) {
    const f = featureById.get(id);
    check(f.status === 'live' && f.metrics.cost, `cost sprint covers ${id}, which is not live`);
    if (c.state === 'finding' || c.state === 'in-progress') check(openOf(f, 'cost-sprint').length > 0 && f.metrics.cost.monthly > f.metrics.cost.budget, `cost sprint: ${id} is ${c.state} without an open cost item or an overrun`);
  }
});

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────

section('dates', () => {
  const past = [];
  F.forEach((f) => {
    past.push(f.createdAt, f.updatedAt);
    if (f.metrics.sec && f.metrics.sec.lastScan) past.push(f.metrics.sec.lastScan);
    f.workItems.forEach((w) => past.push(w.createdAt));
    f.branches.forEach((b) => past.push(b.openedAt, b.updatedAt));
    f.ledger.forEach((e) => past.push(e.at.slice(0, 10)));
  });
  B.initiatives.forEach((i) => past.push(i.startedAt));
  shipped.forEach((r) => past.push(r.date));
  const late = past.filter((d) => d > ASOF);
  check(late.length === 0, `${late.length} dates fall after ${ASOF} (only upcoming releases and initiative end dates may)`);
});

// ── Reference ratings (independent of the model) ─────────────────────────────────────────────

const QUALITY = { A: 1, B: 0.85, C: 0.65, D: 0.45, E: 0.25 };
const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x) => Math.min(1, Math.max(0, x));
function pw(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return pts[i - 1][1] + ((x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])) * (pts[i][1] - pts[i - 1][1]);
  return pts[pts.length - 1][1];
}
const bandOf = (s) => (s === null ? 'na' : s >= 0.8 ? 'good' : s >= 0.6 ? 'fair' : s >= 0.4 ? 'poor' : 'critical');
function refGates(f) {
  const out = [];
  f.workItems.filter((w) => w.state === 'triage').forEach((w) => out.push({ kind: 'triage', id: w.id, wait: days(w.createdAt, ASOF) }));
  f.branches.filter((b) => b.state === 'awaiting-approval').forEach((b) => out.push({ kind: 'approval', id: b.id, wait: days(b.updatedAt, ASOF) }));
  f.branches.filter((b) => b.state === 'changes-requested').forEach((b) => out.push({ kind: 'changes', id: b.id, wait: days(b.updatedAt, ASOF) }));
  return out;
}
function refScore(f, lens) {
  const m = f.metrics;
  if (lens === 'dev') {
    const d = m.dev;
    if (!d) return null;
    let s = 0.4 * QUALITY[d.quality] + 0.35 * pw(d.coverage, [[0, 0], [40, 0.4], [60, 0.7], [85, 1]]) + 0.25 * clamp(1 - 0.45 * d.bugs.critical - 0.12 * d.bugs.major - 0.02 * d.bugs.minor);
    if (d.bugs.critical > 0) s = Math.min(s, 0.38);
    return r4(s);
  }
  if (lens === 'ops') {
    const o = m.ops;
    if (!o) return null;
    if (!o.monitored) return 0.5;
    const up = pw(o.uptime, [[98, 0.1], [99, 0.4], [99.5, 0.6], [99.9, 0.85], [99.95, 1]]);
    const err = pw(o.errorRate, [[0.1, 1], [0.5, 0.75], [1, 0.55], [2, 0.35], [5, 0.05]]);
    const lat = o.p95 <= o.sloP95 ? 1 : clamp(1 - (o.p95 / o.sloP95 - 1) * 1.2);
    return r4(0.4 * up + 0.35 * err + 0.25 * lat);
  }
  if (lens === 'biz') {
    if (!m.biz) return null;
    const n = f.workItems.filter((w) => OPEN.includes(w.state)).length;
    return n === 0 ? 1 : n === 1 ? 0.85 : n === 2 ? 0.75 : n <= 4 ? 0.6 : n <= 7 ? 0.45 : 0.3;
  }
  if (lens === 'sec') {
    const s = m.sec;
    if (!s) return null;
    let x;
    if (!s.lastScan) x = 0.45;
    else {
      const v = s.vulns;
      x = v.critical > 0 ? 0.2 : v.high > 0 ? Math.max(0.4, 0.55 - 0.05 * (v.high - 1)) : v.medium > 0 ? Math.max(0.65, 0.8 - 0.03 * (v.medium - 1)) : 1;
      const age = days(s.lastScan, ASOF);
      if (age > 90) x = Math.min(x, 0.5);
      else if (age > 30) x = Math.min(x, 0.7);
    }
    if (s.secretsClean === false) x = Math.min(x, 0.3);
    return r4(x);
  }
  if (lens === 'comp') {
    const c = m.comp;
    if (!c) return null;
    return c.coverage === 0 ? 0.2 : r4((c.coverage / 100) * (1 - Math.min(0.6, 0.15 * c.findings)));
  }
  if (lens === 'ux') {
    const u = m.ux;
    if (!u) return null;
    let s = 0.5 * (u.a11y / 100) + 0.3 * (u.usability ? (u.usability - 1) / 4 : 0.7) + 0.2 * (1 - Math.min(1, u.debt / 6));
    if (u.a11y < 60) s = Math.min(s, 0.55);
    return r4(s);
  }
  if (lens === 'cost') {
    const c = m.cost;
    if (!c) return null;
    const r = c.monthly / c.budget;
    let s = r <= 0.8 ? 1 : r <= 1 ? 0.82 : r <= 1.15 ? 0.62 : r <= 1.4 ? 0.45 : 0.25;
    if (c.trend > 25) s = Math.min(s, 0.6);
    return s;
  }
  // overall
  if (f.status === 'planned') return null;
  if (f.status === 'blocked') return 0.2;
  if (f.status === 'building') {
    const g = refGates(f);
    let delivery = 1;
    if (g.some((x) => x.wait > 7)) delivery = 0.6;
    if (f.branches.some((b) => b.state === 'changes-requested')) delivery = Math.min(delivery, 0.45);
    return r4(0.5 * refScore(f, 'dev') + 0.5 * delivery);
  }
  const W = { dev: 0.2, ops: 0.2, biz: 0.15, sec: 0.2, comp: 0.1, ux: 0.1, cost: 0.05 };
  const lenses = f.status === 'live' ? ['dev', 'ops', 'biz', 'sec', 'comp', 'ux', 'cost'] : ['dev', 'sec', 'comp', 'ux'];
  let ws = 0;
  let sum = 0;
  let crit = false;
  for (const l of lenses) {
    const s = refScore(f, l);
    if (s === null) continue;
    ws += W[l];
    sum += W[l] * s;
    if (bandOf(s) === 'critical') crit = true;
  }
  let s = sum / ws;
  if (crit) s = Math.min(s, 0.55);
  return r4(s);
}

// ── BP API ────────────────────────────────────────────────────────────────────────────────────

const DATA_MEMBERS = ['data', 'product', 'areas', 'domains', 'modules', 'features', 'releases', 'teams', 'people', 'systems', 'initiatives', 'LENSES', 'STATUSES', 'STATUS_ORDER', 'BANDS'];
const MEMBERS = DATA_MEMBERS.concat(['area', 'domain', 'module', 'feature', 'team', 'person', 'system', 'actor', 'release', 'initiative', 'domainsOf', 'modulesOf', 'featuresOf', 'featuresOfDomain', 'featuresOfArea', 'pathOf',
  'rating', 'moduleRating', 'domainRating', 'areaRating', 'productRating', 'rollupRating', 'rollup', 'moduleRollup', 'domainRollup', 'areaRollup', 'productRollup',
  'needsAttention', 'gates', 'openBacklog', 'dependencies', 'dependents', 'initiativesOf', 'initiativeState', 'ledgerOf', 'releasesInOrder', 'releaseItems', 'featureReleases',
  'search', 'matches', 'band']);
const FUNCTIONS = MEMBERS.slice(DATA_MEMBERS.length);
let apiOk = true;
section('BP members', () => {
  for (const k of MEMBERS) apiOk = check(k in BP, `BP.${k} is missing`) && apiOk;
  for (const k of FUNCTIONS) apiOk = check(typeof BP[k] === 'function', `BP.${k} must be a function`) && apiOk;
  for (const k of ['areas', 'domains', 'modules', 'features', 'releases', 'teams', 'people', 'systems', 'initiatives']) check(BP[k] === B[k], `BP.${k} must be the raw data array`);
  check(BP.data === B && BP.product === B.product, 'BP.data and BP.product must be the raw data');
  check(Array.isArray(BP.LENSES) && BP.LENSES.map((l) => l.id).join() === LENS_IDS.join(), `BP.LENSES must be ${LENS_IDS.join(', ')} in order`);
  BP.LENSES.forEach((l, i) => check(isStr(l.label) && isStr(l.short) && isStr(l.question) && l.group === (i < 4 ? 'role' : 'specialist'), `BP.LENSES ${l.id}: needs label, short, question and group ${i < 4 ? 'role' : 'specialist'}`));
  check(asArray(BP.STATUS_ORDER).join() === STATUS_ORDER.join(), `BP.STATUS_ORDER must be ${STATUS_ORDER.join(', ')}`);
  check(asArray(BP.STATUSES).map((s) => s.id).join() === STATUS_ORDER.join() && BP.STATUSES.every((s) => isStr(s.label)), 'BP.STATUSES must define every status with a label');
  check(asArray(BP.BANDS).map((b) => b.id).join() === BAND_IDS.join() && JSON.stringify(BP.BANDS.map((b) => b.min)) === JSON.stringify([0.8, 0.6, 0.4, 0, null]) && BP.BANDS.every((b) => isStr(b.label)),
    'BP.BANDS must be good .8, fair .6, poor .4, critical 0 and na null, each with a label');
});
if (!apiOk) finish();

section('BP lookups', () => {
  const pairs = [['area', B.areas], ['domain', B.domains], ['module', B.modules], ['feature', F], ['team', B.teams], ['person', B.people], ['system', B.systems], ['release', B.releases], ['initiative', B.initiatives]];
  for (const [fn, list] of pairs) {
    for (const x of list) check(BP[fn](x.id) === x && BP[fn](x) === x, `BP.${fn}('${x.id}') must return the object (by id and by object)`);
    check(BP[fn]('no-such-id') == null, `BP.${fn} must return null for an unknown id`);
  }
  for (const x of [...B.people, ...B.teams, ...B.systems]) check(BP.actor(x.id) === x, `BP.actor('${x.id}') must return the person, team or system`);
  check(BP.actor('no-such-id') == null, 'BP.actor must return null for an unknown id');
  for (const a of B.areas) check(BP.domainsOf(a.id).map((d) => d.id).join() === B.domains.filter((d) => d.areaId === a.id).map((d) => d.id).join(), `BP.domainsOf(${a.id}) is wrong`);
  for (const d of B.domains) check(BP.modulesOf(d.id).map((m) => m.id).join() === B.modules.filter((m) => m.domainId === d.id).map((m) => m.id).join(), `BP.modulesOf(${d.id}) is wrong`);
  for (const m of B.modules) check(BP.featuresOf(m.id).map((f) => f.id).join() === F.filter((f) => f.moduleId === m.id).map((f) => f.id).join(), `BP.featuresOf(${m.id}) is wrong`);
  for (const d of B.domains) check(BP.featuresOfDomain(d.id).map((f) => f.id).join() === F.filter((f) => domainOfFeature(f).id === d.id).map((f) => f.id).join(), `BP.featuresOfDomain(${d.id}) is wrong`);
  for (const a of B.areas) check(BP.featuresOfArea(a.id).length === F.filter((f) => areaOfFeature(f).id === a.id).length, `BP.featuresOfArea(${a.id}) is wrong`);
  for (const f of F) {
    const p = BP.pathOf(f.id);
    check(p.module === moduleById.get(f.moduleId) && p.domain === domainOfFeature(f) && p.area === areaOfFeature(f), `BP.pathOf(${f.id}) is wrong`);
  }
});

const ratingOf = new Map(); // featureId → lens → rating
section('BP.rating', () => {
  let mismatches = 0;
  for (const f of F) {
    const row = {};
    for (const lens of LENS_IDS) {
      const r = BP.rating(f, lens);
      row[lens] = r;
      check(r === BP.rating(f.id, lens), `BP.rating(${f.id}, ${lens}) must be memoised and accept an id`);
      if (!check(r && r.lens === lens && BAND_IDS.includes(r.band) && isStr(r.headline) && Array.isArray(r.facts) && Array.isArray(r.reasons), `BP.rating(${f.id}, ${lens}) has the wrong shape`)) continue;
      check(r.reasons.every(isStr), `BP.rating(${f.id}, ${lens}): reasons must be strings`);
      if (r.band === 'na') {
        check(r.score === null, `BP.rating(${f.id}, ${lens}): na must have a null score`);
      } else {
        check(isNum(r.score) && r.score >= 0 && r.score <= 1 && r.band === BP.band(r.score), `BP.rating(${f.id}, ${lens}): score ${r.score} must be in [0,1] with band ${BP.band(r.score)}`);
        check(r.facts.length >= 2 && r.facts.length <= 4 && r.facts.every((x) => isStr(x.label) && isStr(String(x.value)) && (x.band === undefined || BAND_IDS.includes(x.band))), `BP.rating(${f.id}, ${lens}): needs 2–4 facts { label, value, band? }`);
      }
      const want = refScore(f, lens);
      if (want === null) check(r.band === 'na', `BP.rating(${f.id}, ${lens}) should be na`);
      else if (!check(r.score !== null && Math.abs(r.score - want) <= 1e-4, `BP.rating(${f.id}, ${lens}) = ${r.score}; the rule gives ${want}`)) mismatches += 1;
      else check(r.band === bandOf(want), `BP.rating(${f.id}, ${lens}): band ${r.band}, expected ${bandOf(want)}`);
    }
    // na exactly where the spec says.
    const planned = f.status === 'planned';
    const naWant = {
      overall: planned, dev: planned, sec: planned, ops: f.status !== 'live', biz: f.status !== 'live', cost: f.status !== 'live',
      comp: expectedRegimes(f).length === 0, ux: planned || !hasUi(f),
    };
    for (const lens of LENS_IDS) check((row[lens].band === 'na') === naWant[lens], `BP.rating(${f.id}, ${lens}) is ${row[lens].band}; na should be ${naWant[lens]}`);
    if (!hasUi(f) && row.ux.band === 'na') check(/UI/.test(row.ux.headline), `BP.rating(${f.id}, ux): a feature without UI should say why`);
    if (f.status === 'blocked') check(row.overall.headline === f.blockedReason, `BP.rating(${f.id}, overall): the blocked reason is the headline`);
    if (planned) check(/^Not started/.test(row.overall.headline), `BP.rating(${f.id}, overall): planned features say "Not started…"`);
    ratingOf.set(f.id, row);
  }
  check(mismatches === 0, `${mismatches} ratings differ from the rules`);
  check(BP.rating('no-such-feature', 'dev').band === 'na', 'BP.rating of an unknown feature must be na');
  const thresholds = [[0.8, 'good'], [0.7999, 'fair'], [0.6, 'fair'], [0.5999, 'poor'], [0.4, 'poor'], [0.3999, 'critical'], [0, 'critical'], [null, 'na'], [undefined, 'na']];
  for (const [s, b] of thresholds) check(BP.band(s) === b, `BP.band(${s}) must be ${b}`);
});

section('BP rollups', () => {
  const sumCounts = (list) => list.reduce((acc, r) => { BAND_IDS.forEach((b) => { acc[b] += r.counts[b]; }); return acc; }, { good: 0, fair: 0, poor: 0, critical: 0, na: 0 });
  for (const lens of LENS_IDS) {
    for (const m of B.modules) {
      const r = BP.moduleRating(m.id, lens);
      const fs2 = F.filter((f) => f.moduleId === m.id);
      const scores = fs2.map((f) => ratingOf.get(f.id)[lens]).filter((x) => x.band !== 'na');
      const counts = { good: 0, fair: 0, poor: 0, critical: 0, na: 0 };
      fs2.forEach((f) => { counts[ratingOf.get(f.id)[lens].band] += 1; });
      const mean = scores.length ? r4(scores.reduce((a, x) => a + x.score, 0) / scores.length) : null;
      check(r && JSON.stringify(r.counts) === JSON.stringify(counts) && r.applicable === scores.length && (mean === null ? r.score === null && r.band === 'na' : Math.abs(r.score - mean) <= 1e-4 && r.band === BP.band(r.score)),
        `BP.moduleRating(${m.id}, ${lens}) does not match its features`);
      const worst = fs2.filter((f) => ratingOf.get(f.id)[lens].band !== 'na').map((f, i) => [ratingOf.get(f.id)[lens].score, i, f.id]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 3).map((x) => x[2]);
      check(JSON.stringify(r.worst) === JSON.stringify(worst), `BP.moduleRating(${m.id}, ${lens}).worst should be ${worst.join(', ')}`);
      check(r === BP.moduleRating(m.id, lens), `BP.moduleRating(${m.id}, ${lens}) must be memoised`);
    }
    for (const d of B.domains) {
      const r = BP.domainRating(d.id, lens);
      check(JSON.stringify(r.counts) === JSON.stringify(sumCounts(B.modules.filter((m) => m.domainId === d.id).map((m) => BP.moduleRating(m.id, lens)))), `BP.domainRating(${d.id}, ${lens}) counts must be the sum of its modules`);
    }
    for (const a of B.areas) {
      const r = BP.areaRating(a.id, lens);
      check(JSON.stringify(r.counts) === JSON.stringify(sumCounts(B.domains.filter((d) => d.areaId === a.id).map((d) => BP.domainRating(d.id, lens)))), `BP.areaRating(${a.id}, ${lens}) counts must be the sum of its domains`);
    }
    const p = BP.productRating(lens);
    check(JSON.stringify(p.counts) === JSON.stringify(sumCounts(B.areas.map((a) => BP.areaRating(a.id, lens)))), `BP.productRating(${lens}) counts must be the sum of its areas`);
    const scores = F.map((f) => ratingOf.get(f.id)[lens]).filter((x) => x.band !== 'na');
    check(Math.abs(p.score - r4(scores.reduce((a, x) => a + x.score, 0) / scores.length)) <= 1e-4, `BP.productRating(${lens}).score must be the mean of applicable features`);
    const sub = F.slice(0, 40);
    const rr = BP.rollupRating(sub.map((f) => f.id), lens);
    check(rr.applicable === sub.filter((f) => ratingOf.get(f.id)[lens].band !== 'na').length, `BP.rollupRating(ids, ${lens}) must accept ids`);
  }
  const attention = (f) => f.status === 'blocked' || LENS_IDS.some((l) => ratingOf.get(f.id)[l].band === 'critical') || f.branches.some((b) => b.state === 'changes-requested');
  for (const f of F) check(BP.needsAttention(f) === attention(f) && BP.needsAttention(f.id) === attention(f), `BP.needsAttention(${f.id}) should be ${attention(f)}`);
  const direct = (list) => {
    const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
    const byBuilder = Object.fromEntries(BUILDERS.map((b) => [b, 0]));
    const g = { triage: 0, approval: 0, changes: 0 };
    let att = 0;
    list.forEach((f) => {
      byStatus[f.status] += 1;
      byBuilder[f.builtBy] += 1;
      if (attention(f)) att += 1;
      refGates(f).forEach((x) => { g[x.kind] += 1; });
    });
    return { count: list.length, byStatus, byBuilder, attention: att, gates: g };
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const m of B.modules) check(same(BP.moduleRollup(m.id), direct(F.filter((f) => f.moduleId === m.id))), `BP.moduleRollup(${m.id}) does not match its features`);
  for (const d of B.domains) check(same(BP.domainRollup(d.id), direct(F.filter((f) => domainOfFeature(f).id === d.id))), `BP.domainRollup(${d.id}) does not match its features`);
  for (const a of B.areas) check(same(BP.areaRollup(a.id), direct(F.filter((f) => areaOfFeature(f).id === a.id))), `BP.areaRollup(${a.id}) does not match its features`);
  check(same(BP.productRollup(), direct(F)), 'BP.productRollup() does not match the features');
  check(same(BP.rollup(F.slice(0, 25).map((f) => f.id)), direct(F.slice(0, 25))), 'BP.rollup(ids) must accept ids');
});

section('BP gates, backlog and relations', () => {
  const totals = { triage: 0, approval: 0, changes: 0 };
  for (const f of F) {
    const g = BP.gates(f);
    const want = refGates(f);
    check(g.length === want.length, `BP.gates(${f.id}) returns ${g.length} gates; expected ${want.length}`);
    for (const x of g) {
      check(GATE_KINDS_OK(x) && want.some((w) => w.kind === x.kind && w.id === x.id && w.wait === x.waitingDays), `BP.gates(${f.id}): unexpected gate ${JSON.stringify(x)}`);
      check(isStr(x.title) && DATE.test(x.since) && days(x.since, ASOF) === x.waitingDays && isStr(x.ref), `BP.gates(${f.id}): gate ${x.id} needs title, since, waitingDays and ref`);
      totals[x.kind] += 1;
    }
    for (let i = 1; i < g.length; i++) check(g[i - 1].waitingDays >= g[i].waitingDays, `BP.gates(${f.id}) must list the longest wait first`);
    check(JSON.stringify(BP.openBacklog(f).map((w) => w.id)) === JSON.stringify(f.workItems.filter((w) => OPEN.includes(w.state)).map((w) => w.id)), `BP.openBacklog(${f.id}) is wrong`);
    check(JSON.stringify(BP.dependencies(f).map((x) => x.id)) === JSON.stringify(f.dependsOn), `BP.dependencies(${f.id}) is wrong`);
    check(JSON.stringify(BP.dependents(f.id).map((x) => x.id)) === JSON.stringify(F.filter((x) => x.dependsOn.includes(f.id)).map((x) => x.id)), `BP.dependents(${f.id}) is wrong`);
    const inis = B.initiatives.filter((i) => i.coverage.some((c) => c.feature === f.id));
    const got = BP.initiativesOf(f);
    check(got.length === inis.length && got.every((x, i) => x.initiative === inis[i] && x.state === inis[i].coverage.find((c) => c.feature === f.id).state), `BP.initiativesOf(${f.id}) is wrong`);
    for (const ini of B.initiatives) {
      const c = ini.coverage.find((x) => x.feature === f.id);
      check(BP.initiativeState(f, ini.id) === (c ? c.state : null), `BP.initiativeState(${f.id}, ${ini.id}) is wrong`);
    }
    const all = BP.ledgerOf(f);
    check(all.length === f.ledger.length && all.every((e, i) => e === f.ledger[i]), `BP.ledgerOf(${f.id}) must return the ledger newest first`);
    for (const lens of ['dev', 'sec']) check(JSON.stringify(BP.ledgerOf(f, { lens }).map((e) => e.id)) === JSON.stringify(f.ledger.filter((e) => e.lens === lens).map((e) => e.id)), `BP.ledgerOf(${f.id}, { lens: '${lens}' }) is wrong`);
    check(JSON.stringify(BP.ledgerOf(f, { action: 'audit' }).map((e) => e.id)) === JSON.stringify(f.ledger.filter((e) => e.action === 'audit').map((e) => e.id)), `BP.ledgerOf(${f.id}, { action: 'audit' }) is wrong`);
  }
  const P = BP.productRollup().gates;
  check(P.triage === totals.triage && P.approval === totals.approval && P.changes === totals.changes, 'product gate counts must equal the sum of feature gates');
  const direct = {
    triage: allItems.filter(([, w]) => w.state === 'triage').length,
    approval: allBranches.filter(([, b]) => b.state === 'awaiting-approval').length,
    changes: allBranches.filter(([, b]) => b.state === 'changes-requested').length,
  };
  check(JSON.stringify(direct) === JSON.stringify(totals), `gate counts ${JSON.stringify(totals)} must match the data ${JSON.stringify(direct)}`);
});
function GATE_KINDS_OK(x) {
  return ['triage', 'approval', 'changes'].includes(x.kind);
}

section('BP timeline', () => {
  const ordered = BP.releasesInOrder();
  check(ordered.map((r) => r.id).join() === B.releases.map((r) => r.id).join(), 'BP.releasesInOrder() must follow release dates');
  for (let i = 1; i < ordered.length; i++) check(ordered[i - 1].date < ordered[i].date, 'BP.releasesInOrder() must be sorted by date');
  for (const r of B.releases) check(JSON.stringify(BP.releaseItems(r.id)) === JSON.stringify(r.items), `BP.releaseItems(${r.id}) must return the release items`);
  check(BP.releaseItems('9.9').length === 0, 'BP.releaseItems of an unknown release must be []');
  for (const f of F) {
    const want = [];
    B.releases.forEach((r) => r.items.forEach((it) => { if (it.feature === f.id) want.push([r.id, it.kind]); }));
    const got = BP.featureReleases(f);
    check(JSON.stringify(got.map((x) => [x.release.id, x.kind])) === JSON.stringify(want), `BP.featureReleases(${f.id}) does not match the release items`);
    if (f.status === 'live') check(got.length > 0 && got[0].release.id === f.release && got[0].kind === 'new', `BP.featureReleases(${f.id}) must start with its first release`);
  }
});

section('BP search and matches', () => {
  check(BP.search('').length === 0 && BP.search('   ').length === 0, 'BP.search of an empty query must return []');
  const hit = BP.search('passkeys');
  check(hit.length > 0 && hit[0].id === 'auth.passkeys', `BP.search('passkeys') should find auth.passkeys first, got ${hit.map((f) => f.id).slice(0, 3).join(', ')}`);
  const multi = BP.search('gift card');
  check(multi.length >= 5 && multi.every((f) => /gift/i.test(f.name + f.summary + f.id) && /card/i.test(f.name + f.summary + f.id + (moduleById.get(f.moduleId) || {}).name)), "BP.search('gift card') must match every word");
  const sets = [
    { statuses: new Set(['live']) },
    { statuses: ['building', 'blocked'] },
    { query: 'checkout' },
    { initiative: 'payments-refactor' },
    { initiative: 'perf-scan-2026-10', gates: 'triage' },
    { gates: 'any' },
    { gates: 'approval' },
    { gates: 'changes' },
    { attentionOnly: true },
    { lens: 'sec', bands: ['critical', 'poor'] },
    { lens: 'ux', bands: new Set(['na']) },
    { bands: ['good'] },
    { statuses: ['live'], lens: 'ops', bands: ['poor'] },
    { statuses: ['live'], query: 'order' },
    {},
  ];
  const queryHits = (q) => new Set(BP.search(q).map((f) => f.id));
  for (const flt of sets) {
    const qh = flt.query ? queryHits(flt.query) : null;
    let n = 0;
    for (const f of F) {
      const statuses = flt.statuses ? [...flt.statuses] : [];
      const bands = flt.bands ? [...flt.bands] : [];
      const g = refGates(f);
      const want = (!statuses.length || statuses.includes(f.status))
        && (!qh || qh.has(f.id))
        && (!flt.initiative || B.initiatives.find((i) => i.id === flt.initiative).coverage.some((c) => c.feature === f.id))
        && (!flt.gates || (flt.gates === 'any' ? g.length > 0 : g.some((x) => x.kind === flt.gates)))
        && (!flt.attentionOnly || BP.needsAttention(f))
        && (!bands.length || bands.includes(ratingOf.get(f.id)[flt.lens || 'overall'].band));
      check(BP.matches(f, flt) === want && BP.matches(f.id, flt) === want, `BP.matches(${f.id}, ${JSON.stringify(flt)}) should be ${want}`);
      if (want) n += 1;
    }
    if (Object.keys(flt).length) check(n > 0 && n < N, `filter ${JSON.stringify(flt)} should match some but not all features (matched ${n})`);
  }
  check(BP.matches(F[0], null) === true && BP.matches(F[0]) === true, 'BP.matches without a filter must match');
});

section('no mutation', () => {
  check(JSON.stringify(B) === snapshot, 'calling BP must not mutate window.BLUEPRINT');
});

// ── Distributions ─────────────────────────────────────────────────────────────────────────────

const live = F.filter((f) => f.status === 'live');
const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, F.filter((f) => f.status === s).length]));
const byBuilder = Object.fromEntries(BUILDERS.map((b) => [b, F.filter((f) => f.builtBy === b).length]));
const liveBands = Object.fromEntries(BAND_IDS.map((b) => [b, live.filter((f) => (ratingOf.get(f.id) || {}).overall && ratingOf.get(f.id).overall.band === b).length]));
const unmonitored = live.filter((f) => f.metrics.ops && !f.metrics.ops.monitored).length;
const gateTotals = {
  triage: allItems.filter(([, w]) => w.state === 'triage').length,
  approval: allBranches.filter(([, b]) => b.state === 'awaiting-approval').length,
  changes: allBranches.filter(([, b]) => b.state === 'changes-requested').length,
};
section('distributions', () => {
  for (const [s, r] of Object.entries(STATUS_SHARE)) check(inRange(share(byStatus[s], N), r), `status ${s}: ${pct(share(byStatus[s], N))}, expected ${pct(r[0])}–${pct(r[1])}`);
  for (const [b, r] of Object.entries(BUILDER_SHARE)) check(inRange(share(byBuilder[b], N), r), `builder ${b}: ${pct(share(byBuilder[b], N))}, expected ${pct(r[0])}–${pct(r[1])}`);
  for (const [b, r] of Object.entries(LIVE_BAND_SHARE)) check(inRange(share(liveBands[b], live.length), r), `live overall ${b}: ${pct(share(liveBands[b], live.length))}, expected ${pct(r[0])}–${pct(r[1])}`);
  check(inRange(share(unmonitored, live.length), UNMONITORED_SHARE), `unmonitored live features: ${pct(share(unmonitored, live.length))}, expected 6–12%`);
  for (const [k, r] of Object.entries(GATE_RANGE)) check(inRange(gateTotals[k], r), `gates ${k}: ${gateTotals[k]}, expected ${r[0]}–${r[1]}`);
  check(inRange(ledgerTotal, LEDGER_RANGE), `ledger entries: ${ledgerTotal}, expected ${LEDGER_RANGE[0]}–${LEDGER_RANGE[1]}`);
  const attn = F.filter((f) => BP.needsAttention(f)).length;
  check(inRange(share(attn, N), ATTENTION_SHARE), `needs attention: ${attn} features (${pct(share(attn, N))}), expected ${pct(ATTENTION_SHARE[0])}–${pct(ATTENTION_SHARE[1])}`);
  const inComp = F.filter((f) => f.metrics.comp);
  const withFindings = inComp.filter((f) => f.metrics.comp.findings > 0).length;
  check(inRange(share(withFindings, inComp.length), COMP_FINDING_SHARE), `compliance findings on ${pct(share(withFindings, inComp.length))} of features in scope, expected ${pct(COMP_FINDING_SHARE[0])}–${pct(COMP_FINDING_SHARE[1])}`);
  const next = B.releases.find((r) => r.state === 'next');
  check(next && next.items.some((it) => it.kind !== 'new' && featureById.get(it.feature).status === 'live'), 'the next release should also ship improvements or fixes to live features');
  // Realism: maturity by area, the refactor's reach, and realistic waits.
  const liveShare = (pred) => share(F.filter((f) => pred(f) && f.status === 'live').length, F.filter(pred).length);
  const overall = share(byStatus.live, N);
  for (const a of ['foundation', 'commerce']) check(liveShare((f) => areaOfFeature(f).id === a) > overall + 0.05, `${a} should be more mature than average (${pct(liveShare((f) => areaOfFeature(f).id === a))} live)`);
  for (const d of ['mobile', 'community']) {
    check(liveShare((f) => domainOfFeature(f).id === d) < overall - 0.2, `${d} should be roadmap-heavy (${pct(liveShare((f) => domainOfFeature(f).id === d))} live)`);
    check(share(F.filter((f) => domainOfFeature(f).id === d && f.status === 'planned').length, F.filter((f) => domainOfFeature(f).id === d).length) > 0.25, `${d} should have many planned features`);
  }
  const waits = { triage: [], approval: [], changes: [] };
  F.forEach((f) => refGates(f).forEach((g) => waits[g.kind].push(g.wait)));
  check(Math.max(...waits.triage) <= 30 && Math.max(...waits.approval) <= 21 && Math.max(...waits.changes) <= 14, 'gate waits must be realistic (triage ≤ 30, approval ≤ 21, changes ≤ 14 days)');
  check(waits.approval.some((w) => w > 7) && waits.approval.filter((w) => w > 7).length < waits.approval.length / 3, 'some, but not most, approvals should wait more than a week');
  check(F.every((f) => f.status === 'live' || f.workItems.length > 0), 'every feature that is not live needs at least one work item (its intake)');
  // The data exercises every rating rule, so each branch shows up somewhere on the map.
  const age = (d) => days(d, ASOF);
  const cases = {
    'a critical bug capping dev': (f) => f.metrics.dev && f.metrics.dev.bugs.critical > 0,
    'an unmonitored live feature': (f) => f.metrics.ops && !f.metrics.ops.monitored,
    'p95 over its SLO': (f) => f.metrics.ops && f.metrics.ops.monitored && f.metrics.ops.p95 > f.metrics.ops.sloP95,
    'a never-scanned feature': (f) => f.metrics.sec && !f.metrics.sec.lastScan,
    'a clean scan older than 30 days': (f) => f.metrics.sec && f.metrics.sec.lastScan && age(f.metrics.sec.lastScan) > 30 && age(f.metrics.sec.lastScan) <= 90 && ratingOf.get(f.id).sec.score === 0.7,
    'a clean scan older than 90 days': (f) => f.metrics.sec && f.metrics.sec.lastScan && age(f.metrics.sec.lastScan) > 90 && ratingOf.get(f.id).sec.score === 0.5,
    'exposed secrets': (f) => f.metrics.sec && f.metrics.sec.secretsClean === false,
    'a compliance scope never scanned': (f) => f.metrics.comp && f.metrics.comp.coverage === 0,
    'an accessibility score below 60': (f) => f.metrics.ux && f.metrics.ux.a11y < 60,
    'no usability study': (f) => f.metrics.ux && f.metrics.ux.usability === null,
    'cost growing over 25% a month': (f) => f.metrics.cost && f.metrics.cost.trend > 25,
    'a business backlog of 8 or more': (f) => f.metrics.biz && f.workItems.filter((w) => OPEN.includes(w.state)).length >= 8,
    'a build slowed by a gate older than 7 days': (f) => f.status === 'building' && refGates(f).some((g) => g.wait > 7) && !f.branches.some((b) => b.state === 'changes-requested'),
    'a build with changes requested': (f) => f.status === 'building' && f.branches.some((b) => b.state === 'changes-requested'),
    'a live feature capped by a critical lens': (f) => f.status === 'live' && METRIC_LENSES.some((l) => ratingOf.get(f.id)[l].band === 'critical'),
    'a planned feature with a spike branch': (f) => f.status === 'planned' && f.branches.length > 0,
  };
  for (const [what, pred] of Object.entries(cases)) check(F.some(pred), `the data should include ${what}`);
  for (const lens of METRIC_LENSES) for (const b of ['good', 'fair', 'poor', 'critical']) check(F.some((f) => ratingOf.get(f.id)[lens].band === b), `no feature is ${b} in ${lens}`);
  const sources = new Set(allItems.map(([, w]) => w.source));
  check(['goal', 'ticket', 'scan'].every((s) => sources.has(s)), 'work comes in as goals, tickets and scan findings');
});

// ── Summary table ─────────────────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const sc = (v) => (typeof v === 'number' ? v.toFixed(2) : ' -- ');
try {
  const head = `${pad('Area / domain', 30)}${lpad('n', 4)}${['live', 'ready', 'build', 'plan', 'block'].map((h) => lpad(h, 6)).join('')}  overall  attn  gates T/A/C`;
  console.log(`${B.product.name} v${B.product.version} → ${B.product.nextVersion} · ${B.areas.length} areas · ${B.domains.length} domains · ${B.modules.length} modules · ${N} features\n`);
  console.log(head);
  console.log('─'.repeat(head.length));
  const row = (label, r, rating) => `${pad(label, 30)}${lpad(r.count, 4)}${STATUS_ORDER.map((s) => lpad(r.byStatus[s] || 0, 6)).join('')}  ${sc(rating.score)} ${pad(rating.band, 4).slice(0, 4)}${lpad(r.attention, 5)}  ${lpad(`${r.gates.triage}/${r.gates.approval}/${r.gates.changes}`, 11)}`;
  for (const a of B.areas) {
    console.log(row(a.name, BP.areaRollup(a.id), BP.areaRating(a.id, 'overall')));
    for (const d of BP.domainsOf(a.id)) console.log(row(`  ${d.code} ${d.name}`, BP.domainRollup(d.id), BP.domainRating(d.id, 'overall')));
  }
  console.log('─'.repeat(head.length));
  console.log(row('Product', BP.productRollup(), BP.productRating('overall')));
  console.log('');
  const line = (label, order, counts, total) => console.log(`${pad(label, 14)}${order.map((k) => `${k} ${counts[k] || 0} (${pct(share(counts[k] || 0, total))})`).join(' · ')}`);
  line('Status', STATUS_ORDER, byStatus, N);
  line('Builder', BUILDERS, byBuilder, N);
  line('Live overall', ['good', 'fair', 'poor', 'critical'], liveBands, live.length);
  console.log(`${pad('Unmonitored', 14)}${unmonitored} of ${live.length} live features (${pct(share(unmonitored, live.length))})`);
  console.log('');
  console.log(`${pad('Lens', 14)}${['good', 'fair', 'poor', 'crit', 'na'].map((b) => lpad(b, 6)).join('')}   score`);
  for (const l of BP.LENSES) {
    const r = BP.productRating(l.id);
    console.log(`${pad(l.label, 14)}${BAND_IDS.map((b) => lpad(r.counts[b], 6)).join('')}   ${sc(r.score)}`);
  }
  console.log('');
  const waits = { triage: [], approval: [], changes: [] };
  F.forEach((f) => refGates(f).forEach((g) => waits[g.kind].push(g.wait)));
  const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
  console.log(`${pad('Gates', 14)}${['triage', 'approval', 'changes'].map((k) => `${k} ${gateTotals[k]} (median wait ${med(waits[k])} d)`).join(' · ')}`);
  console.log(`${pad('Work', 14)}${allItems.length} work items (${allItems.filter(([, w]) => OPEN.includes(w.state)).length} open) · ${allBranches.length} branches · attention ${BP.productRollup().attention} features`);
  const perStatus = STATUS_ORDER.map((s) => {
    const list = F.filter((f) => f.status === s);
    return `${s} ${(list.reduce((a, f) => a + f.ledger.length, 0) / (list.length || 1)).toFixed(1)}`;
  }).join(' · ');
  console.log(`${pad('Ledger', 14)}${ledgerTotal} entries · per feature ${perStatus}`);
  console.log(`${pad('Releases', 14)}${B.releases.map((r) => `${r.id}:${r.items.length}`).join(' ')}`);
  console.log(`${pad('Initiatives', 14)}${B.initiatives.map((i) => `${i.id} ${i.coverage.length}`).join(' · ')}`);
  console.log(`${pad('File', 14)}${DATA_REL} ${fileBytes.toLocaleString('en-US')} bytes (${(fileBytes / 1e6).toFixed(2)} MB of ${(MAX_BYTES / 1e6).toFixed(1)} MB)`);
} catch (err) {
  check(false, `summary table failed: ${err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err}`);
}

finish();
