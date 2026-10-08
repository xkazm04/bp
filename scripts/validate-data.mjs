#!/usr/bin/env node
// Validates the shared blueprint dataset and model against docs/data-model.md.
//
//   node scripts/validate-data.mjs
//
// Loads prototypes/shared/blueprint-data.js and blueprint-model.js into a vm context with a window
// shim, checks structure, references, facet coherence, distributions and the BP API, prints a
// compact summary table and exits 1 with a list of failures when any rule is broken.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['prototypes/shared/blueprint-data.js', 'prototypes/shared/blueprint-model.js'];

// ── Expected shape (from the spec and the round-1 brief) ───────────────────────────────────────

const EXPECTED_DOMAINS = [
  ['identity', 'IDN', 'Identity & Access', [['auth', 'AUTH', 'Authentication'], ['accounts', 'ACCT', 'Customer Accounts'], ['access', 'RBAC', 'Roles & Permissions']]],
  ['storefront', 'STF', 'Storefront', [['catalog', 'CAT', 'Product Catalog'], ['search', 'SRCH', 'Search & Discovery'], ['content', 'CMS', 'Content & Pages'], ['reviews', 'REV', 'Reviews & UGC']]],
  ['commerce', 'COM', 'Commerce', [['cart', 'CART', 'Cart'], ['checkout', 'CHK', 'Checkout'], ['payments', 'PAY', 'Payments'], ['pricing', 'PRM', 'Pricing & Promotions'], ['subscriptions', 'SUB', 'Subscriptions & Billing']]],
  ['fulfillment', 'FUL', 'Fulfillment', [['orders', 'ORD', 'Order Management'], ['inventory', 'INV', 'Inventory'], ['shipping', 'SHP', 'Shipping & Delivery']]],
  ['engagement', 'ENG', 'Customer Engagement', [['notifications', 'NTF', 'Notifications'], ['support', 'SUP', 'Customer Support']]],
  ['platform', 'PLT', 'Platform & Insights', [['admin', 'ADM', 'Admin Console'], ['analytics', 'ANL', 'Analytics & Reporting'], ['integrations', 'API', 'Integrations & Public API']]],
];
const EXPECTED_DIMENSIONS = {
  dev: ['spec', 'backend', 'frontend', 'tests'],
  ops: ['deploy', 'observe', 'secure', 'runbook'],
  biz: ['value', 'docs', 'package', 'adoption'],
};
const EXPECTED_STATES = { done: 1, partial: 0.5, todo: 0, blocked: 0, na: null };
const STATUS_ORDER = ['live', 'ready', 'building', 'planned', 'blocked'];
const EXPECTED_RELEASES = [
  ['1.0', '2025-11-04', 'shipped'], ['1.1', '2026-01-20', 'shipped'], ['1.2', '2026-03-31', 'shipped'],
  ['1.3', '2026-06-16', 'shipped'], ['1.4', '2026-09-15', 'shipped'], ['1.5', '2026-11-10', 'next'], ['2.0', '2027-02-23', 'future'],
];
const EXPECTED_TEAMS = [
  ['core', 'Core Squad', 'human'], ['growth', 'Growth Squad', 'human'], ['platform', 'Platform Squad', 'human'],
  ['forge', 'Forge crew', 'agent'], ['relay', 'Relay crew', 'agent'], ['ledger', 'Ledger crew', 'agent'],
];
const EXPECTED_PRODUCT = {
  id: 'larkspur', name: 'Larkspur', tagline: 'Commerce platform for independent brands', version: '1.4.2', nextVersion: '1.5.0',
  stack: { web: 'Next.js storefront + admin', api: 'Node · tRPC', workers: 'BullMQ workers', data: 'Postgres · Redis', infra: 'AWS ECS · Terraform' },
};
const SURFACES = ['web', 'admin', 'api', 'worker', 'data'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const BUILDERS = ['agent', 'pair', 'human'];
const REVIEWS = ['approved', 'pending', 'changes', 'none'];
const RELEASES_FOR_STATUS = {
  ready: ['1.5'], building: ['1.5', '2.0'], planned: ['2.0', null], blocked: ['1.5', '2.0'],
};
const DATE_MIN = '2026-06-01';
const DATE_MAX = '2026-10-08';
const RECENT_FROM = '2026-10-05';

// Share ranges (fraction of all features) and absolute count ranges.
const STATUS_SHARE = { live: [0.4, 0.5], ready: [0.08, 0.12], building: [0.18, 0.24], planned: [0.16, 0.22], blocked: [0.04, 0.07] };
const PRIORITY_SHARE = { P0: [0.1, 0.2], P1: [0.28, 0.42], P2: [0.28, 0.42], P3: [0.1, 0.2] }; // about 15 / 35 / 35 / 15
const BUILDER_SHARE = { agent: [0.42, 0.58], pair: [0.22, 0.38], human: [0.12, 0.28] }; // about 50 / 30 / 20

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

// ── Load ──────────────────────────────────────────────────────────────────────────────────────

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    failures.push(`${rel} does not exist`);
    finish();
  }
  const code = fs.readFileSync(file, 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: rel });
  } catch (err) {
    failures.push(`${rel} threw while loading: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
    finish();
  }
}
const B = sandbox.BLUEPRINT;
const BP = sandbox.BP;
if (!check(B && typeof B === 'object', 'window.BLUEPRINT is not set by blueprint-data.js')) finish();
if (!check(BP && typeof BP === 'object', 'window.BP is not set by blueprint-model.js')) finish();

const dataSource = fs.readFileSync(path.join(ROOT, FILES[0]), 'utf8');
check(!/\bfunction\b|=>/.test(dataSource.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/\/\/.*$/gm, '')), 'blueprint-data.js must be plain data (no functions)');
const snapshot = JSON.stringify(B);

// ── Top-level structure ───────────────────────────────────────────────────────────────────────

const arrays = ['releases', 'teams', 'dimensions', 'statuses', 'facetStates', 'domains', 'modules', 'features'];
for (const key of arrays) check(Array.isArray(B[key]), `BLUEPRINT.${key} must be an array`);
if (failures.length) finish();

check(B.meta && B.meta.schemaVersion === '0.1' && B.meta.asOf === '2026-10-08', "meta must be { schemaVersion: '0.1', asOf: '2026-10-08' }");
check(JSON.stringify(B.product) === JSON.stringify(EXPECTED_PRODUCT), `product must equal ${JSON.stringify(EXPECTED_PRODUCT)}`);

check(B.releases.length === EXPECTED_RELEASES.length, `expected ${EXPECTED_RELEASES.length} releases`);
EXPECTED_RELEASES.forEach(([id, date, state], i) => {
  const r = B.releases[i] || {};
  check(r.id === id && r.date === date && r.state === state && r.label === 'v' + id, `release #${i + 1} must be { id: '${id}', label: 'v${id}', date: '${date}', state: '${state}' }, got ${JSON.stringify(r)}`);
});

check(B.teams.length === EXPECTED_TEAMS.length, `expected ${EXPECTED_TEAMS.length} teams`);
EXPECTED_TEAMS.forEach(([id, name, kind], i) => {
  const t = B.teams[i] || {};
  check(t.id === id && t.name === name && t.kind === kind, `team #${i + 1} must be { id: '${id}', name: '${name}', kind: '${kind}' }, got ${JSON.stringify(t)}`);
});

check(B.dimensions.map((d) => d.id).join() === 'dev,ops,biz', 'dimensions must be dev, ops, biz in that order');
B.dimensions.forEach((d) => {
  const exp = EXPECTED_DIMENSIONS[d.id] || [];
  check(Array.isArray(d.facets) && d.facets.map((f) => f.id).join() === exp.join(), `dimension ${d.id} facets must be ${exp.join(', ')}`);
  check(d.label && d.short && d.question, `dimension ${d.id} needs label, short and question`);
  (d.facets || []).forEach((f) => check(typeof f.label === 'string' && f.label, `facet ${d.id}.${f.id} needs a label`));
});
check(B.statuses.map((s) => s.id).join() === STATUS_ORDER.join(), `statuses must be ${STATUS_ORDER.join(', ')}`);
B.statuses.forEach((s) => check(s.label && s.description, `status ${s.id} needs label and description`));
check(B.facetStates.map((s) => s.id).join() === Object.keys(EXPECTED_STATES).join(), `facetStates must be ${Object.keys(EXPECTED_STATES).join(', ')}`);
B.facetStates.forEach((s) => check(s.value === EXPECTED_STATES[s.id] && s.label, `facet state ${s.id} must have value ${EXPECTED_STATES[s.id]} and a label`));

// ── Ids and uniqueness ────────────────────────────────────────────────────────────────────────

function uniqueIds(list, what, key = 'id') {
  const seen = new Set();
  list.forEach((x) => {
    check(typeof x[key] === 'string' && x[key], `${what} without ${key}: ${JSON.stringify(x).slice(0, 80)}`);
    check(!seen.has(x[key]), `duplicate ${what} ${key} '${x[key]}'`);
    seen.add(x[key]);
  });
}
uniqueIds(B.domains, 'domain');
uniqueIds(B.domains, 'domain', 'code');
uniqueIds(B.modules, 'module');
uniqueIds(B.modules, 'module', 'code');
uniqueIds(B.features, 'feature');
uniqueIds(B.teams, 'team');
uniqueIds(B.releases, 'release');

const teamById = new Map(B.teams.map((t) => [t.id, t]));
const releaseById = new Map(B.releases.map((r) => [r.id, r]));
const domainById = new Map(B.domains.map((d) => [d.id, d]));
const moduleById = new Map(B.modules.map((m) => [m.id, m]));
const featureById = new Map(B.features.map((f) => [f.id, f]));

// ── Domains and modules ───────────────────────────────────────────────────────────────────────

check(B.domains.length === 6, `expected 6 domains, found ${B.domains.length}`);
check(B.modules.length === 20, `expected 20 modules, found ${B.modules.length}`);
EXPECTED_DOMAINS.forEach(([id, code, name], i) => {
  const d = B.domains[i] || {};
  check(d.id === id && d.code === code && d.name === name, `domain #${i + 1} must be ${id} / ${code} / ${name}, got ${d.id} / ${d.code} / ${d.name}`);
  check(typeof d.summary === 'string' && d.summary.length > 10 && d.summary.length <= 140, `domain ${d.id} needs a one-sentence summary (≤ 140 chars)`);
});
const expectedModules = EXPECTED_DOMAINS.flatMap(([domainId, , , mods]) => mods.map(([id, code, name]) => ({ id, code, name, domainId })));
expectedModules.forEach((exp, i) => {
  const m = B.modules[i] || {};
  check(m.id === exp.id && m.code === exp.code && m.name === exp.name && m.domainId === exp.domainId,
    `module #${i + 1} must be ${exp.domainId}/${exp.id} / ${exp.code} / ${exp.name}, got ${m.domainId}/${m.id} / ${m.code} / ${m.name}`);
});
B.modules.forEach((m) => {
  check(domainById.has(m.domainId), `module ${m.id}: domainId '${m.domainId}' does not resolve`);
  check(teamById.has(m.owner), `module ${m.id}: owner '${m.owner}' does not resolve`);
  check(teamById.has(m.owner) && teamById.get(m.owner).kind === 'human', `module ${m.id}: owner should be a human squad`);
  check(typeof m.summary === 'string' && m.summary.length > 10 && m.summary.length <= 140, `module ${m.id} needs a one-sentence summary (≤ 140 chars)`);
  check(Array.isArray(m.surfaces) && m.surfaces.length > 0 && m.surfaces.every((s) => SURFACES.includes(s)) && new Set(m.surfaces).size === m.surfaces.length,
    `module ${m.id}: surfaces must be a non-empty unique subset of ${SURFACES.join(', ')}`);
});

// ── Features: fields and references ──────────────────────────────────────────────────────────

const F = B.features;
const N = F.length;
check(N >= 116 && N <= 124, `expected 116–124 features, found ${N}`);

const FEATURE_KEYS = ['id', 'moduleId', 'name', 'summary', 'status', 'priority', 'release', 'owner', 'builtBy', 'review', 'updatedAt', 'dependsOn', 'dims', 'metrics'];
const OPTIONAL_KEYS = ['blockedReason', 'note'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isSet = (v) => typeof v === 'string' && v.trim().length > 0;
const featureNames = new Map();
const facetState = (f, dim, facet) => f.dims && f.dims[dim] && f.dims[dim][facet];

for (const f of F) {
  const where = `feature ${f.id}`;
  for (const k of FEATURE_KEYS) check(k in f, `${where}: missing field '${k}'`);
  for (const k of Object.keys(f)) check(FEATURE_KEYS.includes(k) || OPTIONAL_KEYS.includes(k), `${where}: unexpected field '${k}'`);

  // id, module, owner, release
  check(moduleById.has(f.moduleId), `${where}: moduleId '${f.moduleId}' does not resolve`);
  check(typeof f.id === 'string' && f.id.startsWith(f.moduleId + '.') && SLUG.test(f.id.slice(f.moduleId.length + 1)), `${where}: id must be '<moduleId>.<kebab-slug>'`);
  check(teamById.has(f.owner), `${where}: owner '${f.owner}' does not resolve`);
  if (teamById.has(f.owner)) {
    const kind = teamById.get(f.owner).kind;
    if (f.builtBy === 'agent') check(kind === 'agent', `${where}: agent-built features are owned by an agent crew`);
    if (f.builtBy === 'human') check(kind === 'human', `${where}: human-built features are owned by a human squad`);
  }
  check(f.release === null || releaseById.has(f.release), `${where}: release '${f.release}' does not resolve`);

  // enums
  check(STATUS_ORDER.includes(f.status), `${where}: invalid status '${f.status}'`);
  check(PRIORITIES.includes(f.priority), `${where}: invalid priority '${f.priority}'`);
  check(BUILDERS.includes(f.builtBy), `${where}: invalid builtBy '${f.builtBy}'`);
  check(REVIEWS.includes(f.review), `${where}: invalid review '${f.review}'`);
  check(typeof f.updatedAt === 'string' && DATE.test(f.updatedAt) && !isNaN(Date.parse(f.updatedAt)), `${where}: updatedAt must be YYYY-MM-DD`);
  check(f.updatedAt >= DATE_MIN && f.updatedAt <= DATE_MAX, `${where}: updatedAt ${f.updatedAt} outside ${DATE_MIN}..${DATE_MAX}`);

  // name and summary
  const words = String(f.name).trim().split(/\s+/);
  check(typeof f.name === 'string' && f.name.length <= 28, `${where}: name '${f.name}' longer than 28 chars`);
  check(words.length >= 2 && words.length <= 4, `${where}: name '${f.name}' must be 2–4 words`);
  const lower = String(f.name).toLowerCase();
  check(!featureNames.has(lower), `${where}: name '${f.name}' duplicates ${featureNames.get(lower)}`);
  featureNames.set(lower, f.id);
  check(typeof f.summary === 'string' && f.summary.length > 0 && f.summary.length <= 110, `${where}: summary must be 1–110 chars (has ${String(f.summary).length})`);
  check(/[.]$/.test(f.summary) && !/[.!?]\s+[A-Z]/.test(f.summary), `${where}: summary must be one plain sentence ending with a period`);

  // dims: exact keys and valid states
  check(f.dims && typeof f.dims === 'object' && Object.keys(f.dims).join() === 'dev,ops,biz', `${where}: dims keys must be exactly dev, ops, biz`);
  for (const [dim, facets] of Object.entries(EXPECTED_DIMENSIONS)) {
    const got = f.dims && f.dims[dim];
    if (!check(got && typeof got === 'object', `${where}: dims.${dim} missing`)) continue;
    check(Object.keys(got).join() === facets.join(), `${where}: dims.${dim} keys must be exactly ${facets.join(', ')} (got ${Object.keys(got).join(', ')})`);
    for (const facet of facets) check(got[facet] in EXPECTED_STATES, `${where}: dims.${dim}.${facet} has invalid state '${got[facet]}'`);
  }

  // optional strings
  check(f.blockedReason === undefined || f.blockedReason === null || isSet(f.blockedReason), `${where}: blockedReason must be a non-empty string when present`);
  check(f.note === undefined || f.note === null || (isSet(f.note) && f.note.length <= 120), `${where}: note must be a short non-empty string (≤ 120 chars)`);
}

// ── Status coherence (spec table) ────────────────────────────────────────────────────────────

const devOf = (f) => EXPECTED_DIMENSIONS.dev.map((k) => facetState(f, 'dev', k));
const anyBlockedFacet = (f) => Object.keys(EXPECTED_DIMENSIONS).some((d) => EXPECTED_DIMENSIONS[d].some((k) => facetState(f, d, k) === 'blocked'));
const one = (v, allowed) => allowed.includes(v);

for (const f of F) {
  const where = `feature ${f.id} (${f.status})`;
  const dev = f.dims.dev || {};
  const ops = f.dims.ops || {};
  const biz = f.dims.biz || {};
  switch (f.status) {
    case 'live':
      check(devOf(f).every((s) => one(s, ['done', 'na'])), `${where}: every dev facet must be done or na`);
      check(ops.deploy === 'done', `${where}: ops.deploy must be done`);
      check(one(biz.adoption, ['done', 'partial']), `${where}: biz.adoption must be done or partial`);
      break;
    case 'ready':
      check(['spec', 'backend', 'frontend'].every((k) => one(dev[k], ['done', 'na'])), `${where}: dev spec/backend/frontend must be done or na`);
      check(one(dev.tests, ['done', 'na', 'partial']), `${where}: dev.tests must be done, na or partial`);
      check(ops.deploy === 'partial', `${where}: ops.deploy must be partial (staging)`);
      break;
    case 'building':
      check(dev.spec === 'done', `${where}: dev.spec must be done`);
      check(devOf(f).some((s) => one(s, ['partial', 'todo'])), `${where}: at least one dev facet must be partial or todo`);
      check(one(ops.deploy, ['todo', 'partial']), `${where}: ops.deploy must be todo or partial`);
      break;
    case 'planned':
      check(one(dev.spec, ['todo', 'partial']), `${where}: dev.spec must be todo or partial`);
      check(['backend', 'frontend', 'tests'].every((k) => dev[k] === 'todo'), `${where}: dev backend/frontend/tests must be todo`);
      check(EXPECTED_DIMENSIONS.ops.every((k) => ops[k] === 'todo'), `${where}: every ops facet must be todo`);
      check(biz.adoption === 'todo', `${where}: biz.adoption must be todo`);
      break;
    case 'blocked':
      check(anyBlockedFacet(f), `${where}: at least one facet must be blocked`);
      break;
    default:
      break;
  }
  check((f.status === 'blocked') === isSet(f.blockedReason), `feature ${f.id}: blockedReason must be set if and only if status is blocked`);
  // Dataset conventions that keep the mock legible.
  check(f.status === 'blocked' || !anyBlockedFacet(f), `feature ${f.id}: blocked facets only appear on blocked features`);
  if (f.status === 'live') {
    const shouldBeDone = typeof f.metrics.adoption === 'number' && f.metrics.adoption >= 50;
    check(biz.adoption === (shouldBeDone ? 'done' : 'partial'), `feature ${f.id}: biz.adoption should be ${shouldBeDone ? 'done' : 'partial'} for ${f.metrics.adoption}% merchant adoption (≥ 50% → done)`);
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────────────────────────

const inRange = (v, lo, hi) => typeof v === 'number' && !isNaN(v) && v >= lo && v <= hi;
for (const f of F) {
  const where = `feature ${f.id}`;
  const m = f.metrics;
  if (!check(m && typeof m === 'object' && Object.keys(m).join() === 'coverage,uptime,adoption', `${where}: metrics keys must be exactly coverage, uptime, adoption`)) continue;
  if (f.dims.dev.tests === 'todo') check(m.coverage === null, `${where}: coverage must be null while dev.tests is todo`);
  else check(inRange(m.coverage, 0, 100), `${where}: coverage must be 0–100 when dev.tests is ${f.dims.dev.tests}`);
  if (f.dims.ops.deploy === 'done') check(inRange(m.uptime, 99, 99.99), `${where}: uptime must be 99.00–99.99 when ops.deploy is done`);
  else check(m.uptime === null, `${where}: uptime must be null unless ops.deploy is done`);
  if (f.status === 'live') check(inRange(m.adoption, 0, 100), `${where}: adoption must be 0–100 for live features`);
  else check(m.adoption === null, `${where}: adoption must be null unless live`);
}

// ── Releases ──────────────────────────────────────────────────────────────────────────────────

const shipped = B.releases.filter((r) => r.state === 'shipped').map((r) => r.id);
for (const f of F) {
  const where = `feature ${f.id} (${f.status})`;
  if (f.status === 'live') {
    check(shipped.includes(f.release), `${where}: release must be a shipped release, got ${f.release}`);
    const r = releaseById.get(f.release);
    check(!r || f.updatedAt >= r.date, `${where}: updatedAt ${f.updatedAt} is before its release date ${r && r.date}`);
  } else {
    check(RELEASES_FOR_STATUS[f.status].includes(f.release), `${where}: release must be one of ${RELEASES_FOR_STATUS[f.status].map(String).join(', ')}, got ${f.release}`);
  }
}
for (const id of shipped) {
  const n = F.filter((f) => f.status === 'live' && f.release === id).length;
  check(n >= 3, `live features should be spread across shipped releases: only ${n} in ${id}`);
}

// ── Dependencies ──────────────────────────────────────────────────────────────────────────────

for (const f of F) {
  const where = `feature ${f.id}`;
  if (!check(Array.isArray(f.dependsOn), `${where}: dependsOn must be an array`)) continue;
  check(f.dependsOn.length <= 3, `${where}: at most 3 dependencies (has ${f.dependsOn.length})`);
  check(new Set(f.dependsOn).size === f.dependsOn.length, `${where}: duplicate dependency`);
  check(!f.dependsOn.includes(f.id), `${where}: depends on itself`);
  for (const dep of f.dependsOn) {
    if (!check(featureById.has(dep), `${where}: dependency '${dep}' does not resolve`)) continue;
    const d = featureById.get(dep);
    if (f.status === 'live') {
      check(d.status === 'live', `${where}: live feature depends on ${dep}, which is ${d.status}`);
      check(d.status !== 'live' || d.release <= f.release, `${where}: shipped in ${f.release} but depends on ${dep} from ${d.release}`);
    }
    if (f.status === 'ready') check(['live', 'ready'].includes(d.status), `${where}: ready feature depends on ${dep}, which is ${d.status}`);
  }
}
// Cycle detection (iterative DFS with colors).
{
  const color = new Map();
  const cycles = [];
  for (const start of F) {
    if (color.get(start.id)) continue;
    const stack = [[start.id, 0]];
    const pathIds = [];
    color.set(start.id, 1);
    pathIds.push(start.id);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const deps = (featureById.get(top[0]) || {}).dependsOn || [];
      if (top[1] < deps.length) {
        const next = deps[top[1]++];
        if (!featureById.has(next)) continue;
        const c = color.get(next);
        if (c === 1) cycles.push(pathIds.slice(pathIds.indexOf(next)).concat(next).join(' → '));
        else if (!c) {
          color.set(next, 1);
          pathIds.push(next);
          stack.push([next, 0]);
        }
      } else {
        color.set(top[0], 2);
        pathIds.pop();
        stack.pop();
      }
    }
  }
  cycles.forEach((c) => check(false, `dependency cycle: ${c}`));
}
const withDeps = F.filter((f) => f.dependsOn.length > 0).length;
const edges = F.flatMap((f) => f.dependsOn.filter((d) => featureById.has(d)).map((d) => [f, featureById.get(d)]));
const crossModule = edges.filter(([a, b]) => a.moduleId !== b.moduleId).length;
const crossDomain = edges.filter(([a, b]) => moduleById.get(a.moduleId).domainId !== moduleById.get(b.moduleId).domainId).length;
check(withDeps / N >= 0.5 && withDeps / N <= 0.7, `about 60% of features should have dependencies: ${withDeps}/${N} (${pct(withDeps / N)})`);
check(crossModule >= 15, `expected at least 15 cross-module dependency links, found ${crossModule}`);
check(crossDomain >= 10, `expected at least 10 cross-domain dependency links, found ${crossDomain}`);

// ── Distributions ─────────────────────────────────────────────────────────────────────────────

function pct(x) {
  return (x * 100).toFixed(1) + '%';
}
function countBy(list, fn) {
  const out = {};
  list.forEach((x) => {
    const k = fn(x);
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}
function checkShares(label, counts, ranges) {
  for (const [k, [lo, hi]] of Object.entries(ranges)) {
    const share = (counts[k] || 0) / N;
    check(share >= lo - 1e-9 && share <= hi + 1e-9, `${label} ${k}: ${counts[k] || 0} (${pct(share)}) outside ${pct(lo)}–${pct(hi)}`);
  }
}
const byStatus = countBy(F, (f) => f.status);
const byPriority = countBy(F, (f) => f.priority);
const byBuilder = countBy(F, (f) => f.builtBy);
const byReview = countBy(F, (f) => f.review);
checkShares('status', byStatus, STATUS_SHARE);
check((byStatus.blocked || 0) >= 5 && (byStatus.blocked || 0) <= 8, `expected 5–8 blocked features, found ${byStatus.blocked || 0}`);
checkShares('priority', byPriority, PRIORITY_SHARE);
checkShares('builtBy', byBuilder, BUILDER_SHARE);

// Review
const changes = F.filter((f) => f.review === 'changes');
const pending = F.filter((f) => f.review === 'pending');
check(changes.length >= 5 && changes.length <= 8, `expected 5–8 features with review 'changes', found ${changes.length}`);
changes.forEach((f) => check(isSet(f.note), `feature ${f.id}: review 'changes' needs a specific note`));
check(pending.length >= 11 && pending.length <= 19, `expected about 15 features with review 'pending', found ${pending.length}`);
pending.forEach((f) => check(f.builtBy !== 'human', `feature ${f.id}: pending reviews are for agent or pair changes`));
F.filter((f) => f.status === 'planned').forEach((f) => check(f.review === 'none', `feature ${f.id}: planned features have review 'none'`));
F.filter((f) => f.review === 'none').forEach((f) => check(['planned', 'blocked'].includes(f.status), `feature ${f.id}: review 'none' is only for planned or not-yet-built blocked features`));
const live = F.filter((f) => f.status === 'live');
const liveApproved = live.filter((f) => f.review === 'approved').length;
check(liveApproved / live.length >= 0.8, `most live features should be approved: ${liveApproved}/${live.length}`);

// Dates
const recent = F.filter((f) => f.updatedAt >= RECENT_FROM).length;
check(recent >= 7 && recent <= 13, `about 10 features should be updated ${RECENT_FROM}..${DATE_MAX}, found ${recent}`);
const median = (xs) => xs.slice().sort()[Math.floor(xs.length / 2)];
const activeMedian = median(F.filter((f) => ['building', 'ready'].includes(f.status)).map((f) => f.updatedAt));
const liveMedian = median(live.map((f) => f.updatedAt));
check(activeMedian > liveMedian, `building and ready features should skew recent (median ${activeMedian} vs live ${liveMedian})`);

// Notes
const notes = F.filter((f) => isSet(f.note)).length;
check(notes >= 18 && notes <= 32, `about 25 features should carry a note, found ${notes}`);

// Per-module and per-domain character
for (const m of B.modules) {
  const fs_ = F.filter((f) => f.moduleId === m.id);
  check(fs_.length >= 5 && fs_.length <= 8, `module ${m.id}: expected 5–8 features, found ${fs_.length}`);
  check(fs_.some((f) => f.status !== 'live'), `module ${m.id}: needs at least one feature that is not live`);
}
const liveShare = (list) => list.filter((f) => f.status === 'live').length / (list.length || 1);
const ofDomain = (id) => F.filter((f) => moduleById.get(f.moduleId).domainId === id);
const ofModule = (id) => F.filter((f) => f.moduleId === id);
check(liveShare(ofDomain('identity')) > 0.5, `identity should be mostly live (${pct(liveShare(ofDomain('identity')))})`);
check(liveShare(ofModule('catalog')) > 0.5, `catalog should be mostly live (${pct(liveShare(ofModule('catalog')))})`);
const comShare = liveShare(ofDomain('commerce'));
check(comShare >= 0.3 && comShare <= 0.7, `commerce should be mixed (${pct(comShare)} live)`);
for (const id of ['subscriptions', 'support', 'integrations', 'analytics']) {
  check(liveShare(ofModule(id)) < 0.5, `${id} should be roadmap-heavy (${pct(liveShare(ofModule(id)))} live)`);
}
// "na" used where it makes sense
check(F.some((f) => f.dims.dev.frontend === 'na'), 'expected some API-only features with dev.frontend na');
check(F.some((f) => f.dims.biz.package === 'na'), 'expected some internal features with biz.package na');
// Realistic ops debt among live features
check(live.some((f) => f.dims.ops.runbook !== 'done'), 'expected some live features with missing runbooks');
check(live.some((f) => f.dims.ops.observe !== 'done'), 'expected some live features with observability gaps');
check(live.some((f) => f.dims.biz.docs !== 'done'), 'expected some live features with partial docs');

// ── BP smoke tests ────────────────────────────────────────────────────────────────────────────

const API_VALUES = ['data', 'product', 'domains', 'modules', 'features', 'releases', 'teams', 'DIMENSIONS', 'STATUSES', 'FACET_STATES', 'STATUS_ORDER'];
const API_FUNCS = ['domain', 'module', 'feature', 'team', 'release', 'modulesOf', 'featuresOf', 'featuresOfDomain', 'facetValue', 'dimScore', 'featureScore',
  'rollup', 'moduleRollup', 'domainRollup', 'productRollup', 'dependencies', 'dependents', 'needsAttention', 'search', 'matches', 'lensValue', 'facetCounts'];
API_VALUES.forEach((k) => check(BP[k] !== undefined && BP[k] !== null, `BP.${k} is missing`));
API_FUNCS.forEach((k) => check(typeof BP[k] === 'function', `BP.${k} must be a function`));

const smoke = (label, fn) => {
  try {
    fn();
  } catch (err) {
    check(false, `BP smoke test '${label}' threw: ${err && err.message}`);
  }
};
const isScore = (v) => typeof v === 'number' && !isNaN(v) && v >= 0 && v <= 1;
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

smoke('values', () => {
  check(BP.data === B, 'BP.data must be the BLUEPRINT object');
  check(BP.product === B.product, 'BP.product must be BLUEPRINT.product');
  for (const k of ['domains', 'modules', 'features', 'releases', 'teams']) check(Array.isArray(BP[k]) && BP[k].length === B[k].length, `BP.${k} must list every ${k.slice(0, -1)}`);
  check(BP.DIMENSIONS.length === 3 && BP.STATUSES.length === 5 && BP.FACET_STATES.length === 5, 'BP.DIMENSIONS / STATUSES / FACET_STATES must come from the data');
  check(JSON.stringify(Array.from(BP.STATUS_ORDER)) === JSON.stringify(STATUS_ORDER), `BP.STATUS_ORDER must be ${STATUS_ORDER.join(', ')}`);
});
smoke('lookups', () => {
  B.domains.forEach((d) => check(BP.domain(d.id) === d, `BP.domain('${d.id}') failed`));
  B.modules.forEach((m) => check(BP.module(m.id) === m, `BP.module('${m.id}') failed`));
  B.features.forEach((f) => check(BP.feature(f.id) === f, `BP.feature('${f.id}') failed`));
  B.teams.forEach((t) => check(BP.team(t.id) === t, `BP.team('${t.id}') failed`));
  B.releases.forEach((r) => check(BP.release(r.id) === r, `BP.release('${r.id}') failed`));
  check(!BP.feature('nope.nothing') && !BP.module('nope'), 'lookups of unknown ids must return a falsy value');
});
smoke('children', () => {
  const mods = B.domains.reduce((n, d) => n + BP.modulesOf(d.id).length, 0);
  check(mods === B.modules.length, `modulesOf over all domains returns ${mods}, expected ${B.modules.length}`);
  const viaModules = B.modules.reduce((n, m) => n + BP.featuresOf(m.id).length, 0);
  const viaDomains = B.domains.reduce((n, d) => n + BP.featuresOfDomain(d.id).length, 0);
  check(viaModules === N && viaDomains === N, `featuresOf / featuresOfDomain must cover all ${N} features (got ${viaModules} / ${viaDomains})`);
  check(BP.featuresOf('auth').every((f) => f.moduleId === 'auth'), 'featuresOf returns foreign features');
});
smoke('facetValue', () => {
  const got = Object.keys(EXPECTED_STATES).map((s) => BP.facetValue(s));
  check(JSON.stringify(got) === JSON.stringify(Object.values(EXPECTED_STATES)), `facetValue must map done/partial/todo/blocked/na to 1/0.5/0/0/null, got ${JSON.stringify(got)}`);
});
smoke('scores and lenses', () => {
  for (const f of F) {
    for (const d of ['dev', 'ops', 'biz']) check(isScore(BP.dimScore(f, d)), `dimScore(${f.id}, ${d}) not in [0,1]: ${BP.dimScore(f, d)}`);
    check(isScore(BP.featureScore(f)), `featureScore(${f.id}) not in [0,1]`);
    for (const lens of ['overall', 'dev', 'ops', 'biz']) check(isScore(BP.lensValue(f, lens)), `lensValue(${f.id}, '${lens}') not in [0,1]`);
    check(BP.lensValue(f, 'overall') === BP.featureScore(f) && BP.lensValue(f, 'ops') === BP.dimScore(f, 'ops'), `lensValue(${f.id}) disagrees with dimScore/featureScore`);
  }
  const allDone = F.find((f) => ['dev', 'ops', 'biz'].every((d) => Object.values(f.dims[d]).every((s) => s === 'done' || s === 'na')));
  if (allDone) check(BP.featureScore(allDone) === 1, `featureScore of fully done ${allDone.id} must be 1`);
});
smoke('rollups', () => {
  const p = BP.productRollup();
  check(p.count === N, `productRollup().count ${p.count} !== ${N}`);
  check(sum(p.byStatus) === N && sum(p.byReview) === N && sum(p.byBuilder) === N, 'productRollup byStatus / byReview / byBuilder must sum to the feature total');
  STATUS_ORDER.forEach((s) => check(p.byStatus[s] === (byStatus[s] || 0), `productRollup().byStatus.${s} ${p.byStatus[s]} !== ${byStatus[s] || 0}`));
  check(['dev', 'ops', 'biz'].every((d) => isScore(p.dims[d])) && isScore(p.overall), 'productRollup scores must be in [0,1]');
  const attention = F.filter((f) => BP.needsAttention(f)).length;
  check(p.attention === attention, `productRollup().attention ${p.attention} !== ${attention}`);
  const expectedAttention = F.filter((f) => f.status === 'blocked' || f.review === 'changes' || anyBlockedFacet(f)).length;
  check(attention === expectedAttention, `needsAttention flags ${attention} features, expected ${expectedAttention}`);
  const dSum = B.domains.reduce((n, d) => n + BP.domainRollup(d.id).count, 0);
  const mSum = B.modules.reduce((n, m) => n + BP.moduleRollup(m.id).count, 0);
  check(dSum === N && mSum === N, `domain / module rollup counts must sum to ${N} (got ${dSum} / ${mSum})`);
  B.modules.forEach((m) => {
    const r = BP.moduleRollup(m.id);
    check(sum(r.byStatus) === r.count && isScore(r.overall) && ['dev', 'ops', 'biz'].every((d) => isScore(r.dims[d])), `moduleRollup('${m.id}') is inconsistent`);
  });
  check(BP.moduleRollup('cart') === BP.moduleRollup('cart') && BP.domainRollup('commerce') === BP.domainRollup('commerce') && BP.productRollup() === BP.productRollup(), 'module / domain / product rollups must be memoized');
  const adhoc = BP.rollup(BP.featuresOf('checkout'));
  check(adhoc.count === BP.moduleRollup('checkout').count && Math.abs(adhoc.overall - BP.moduleRollup('checkout').overall) < 1e-12, 'rollup(featuresOf(x)) must equal moduleRollup(x)');
  const empty = BP.rollup([]);
  check(empty.count === 0 && isScore(empty.overall), 'rollup([]) must return count 0 and a numeric score');
});
smoke('dependencies', () => {
  for (const f of F) {
    const deps = BP.dependencies(f.id);
    check(deps.length === f.dependsOn.length, `dependencies('${f.id}') returns ${deps.length}, expected ${f.dependsOn.length}`);
    deps.forEach((d) => check(BP.dependents(d.id).includes(f), `dependents('${d.id}') is missing ${f.id}`));
  }
  const totalDependents = F.reduce((n, f) => n + BP.dependents(f.id).length, 0);
  check(totalDependents === edges.length, `dependents total ${totalDependents} !== dependency edges ${edges.length}`);
});
smoke('search', () => {
  const r = BP.search('checkout');
  check(Array.isArray(r) && r.length > 0, 'search("checkout") must return results');
  check(BP.search('  CHECKOUT  ').length === r.length, 'search must be case-insensitive and trim the query');
  check(BP.search('express-pay').some((f) => f.id === 'checkout.express-pay'), 'search must match feature ids');
  check(BP.search('roles and permissions').length === BP.featuresOf('access').length, 'search must match module names (with & read as and)');
  check(BP.search('Identity & Access').length >= BP.featuresOfDomain('identity').length, 'search must match domain names');
  check(BP.search('zzqx-no-such-thing').length === 0, 'search must return nothing for a nonsense query');
});
smoke('matches', () => {
  check(F.every((f) => BP.matches(f, {})), 'matches(f, {}) must be true for every feature');
  const liveSet = vm.runInContext("new Set(['live'])", sandbox);
  check(F.filter((f) => BP.matches(f, { statuses: liveSet })).length === byStatus.live, 'matches with statuses Set (same realm) must filter by status');
  check(F.filter((f) => BP.matches(f, { statuses: new Set(['blocked', 'ready']) })).length === byStatus.blocked + byStatus.ready, 'matches with statuses Set (other realm) must filter by status');
  check(F.filter((f) => BP.matches(f, { statuses: new Set() })).length === N, 'an empty Set must mean "any"');
  check(F.filter((f) => BP.matches(f, { review: new Set(['changes']) })).length === changes.length, 'matches with review Set must filter by review');
  check(F.filter((f) => BP.matches(f, { builtBy: new Set(['agent']) })).length === byBuilder.agent, 'matches with builtBy Set must filter by builder');
  check(F.filter((f) => BP.matches(f, { attentionOnly: true })).length === BP.productRollup().attention, 'matches attentionOnly must agree with rollup attention');
  check(F.filter((f) => BP.matches(f, { query: ' Checkout ' })).length === BP.search('checkout').length, 'matches query must agree with search');
  const combo = F.filter((f) => BP.matches(f, { statuses: new Set(['building']), builtBy: new Set(['agent']), query: '' })).length;
  check(combo === F.filter((f) => f.status === 'building' && f.builtBy === 'agent').length, 'matches must AND its filters together');
});
smoke('facetCounts', () => {
  const all = BP.facetCounts(F);
  const total = Object.keys(EXPECTED_STATES).reduce((n, s) => n + (all[s] || 0), 0);
  check(total === N * 12, `facetCounts(features) must count ${N * 12} facets, got ${total}`);
  for (const d of ['dev', 'ops', 'biz']) {
    const c = BP.facetCounts(F, d);
    const t = Object.keys(EXPECTED_STATES).reduce((n, s) => n + (c[s] || 0), 0);
    check(t === N * 4, `facetCounts(features, '${d}') must count ${N * 4} facets, got ${t}`);
  }
});
check(JSON.stringify(B) === snapshot, 'BP must never mutate BLUEPRINT');

// ── Summary table ─────────────────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const sc = (v) => (typeof v === 'number' ? v.toFixed(2) : ' -- ');
function row(label, r) {
  const st = STATUS_ORDER.map((s) => lpad(r.byStatus[s] || 0, 6)).join('');
  return `${pad(label, 34)}${lpad(r.count, 4)}${st}   ${sc(r.dims.dev)} ${sc(r.dims.ops)} ${sc(r.dims.biz)}  ${sc(r.overall)}${lpad(r.attention, 6)}`;
}
try {
  const P = BP.productRollup();
  console.log(`${B.product.name} v${B.product.version} → ${B.product.nextVersion}  ·  ${B.domains.length} domains · ${B.modules.length} modules · ${N} features\n`);
  console.log(`${pad('Domain / module', 34)}${lpad('n', 4)}${['live', 'ready', 'build', 'plan', 'block'].map((h) => lpad(h, 6)).join('')}   ${['dev ', 'ops ', 'biz '].join(' ')}  all   attn`);
  console.log('─'.repeat(103));
  for (const d of B.domains) {
    console.log(row(`${d.code}  ${d.name}`, BP.domainRollup(d.id)));
    for (const m of BP.modulesOf(d.id)) console.log(row(`  ${pad(m.code, 5)} ${m.name}`, BP.moduleRollup(m.id)));
  }
  console.log('─'.repeat(103));
  console.log(row('Product', P));
  const line = (label, order, counts) => console.log(`${pad(label, 10)}${order.map((k) => `${k} ${counts[k] || 0} (${pct((counts[k] || 0) / N)})`).join(' · ')}`);
  console.log('');
  line('Status', STATUS_ORDER, P.byStatus);
  line('Review', REVIEWS, P.byReview);
  line('Builder', BUILDERS, P.byBuilder);
  line('Priority', PRIORITIES, byPriority);
  console.log(`${pad('Scores', 10)}dev ${sc(P.dims.dev)} · ops ${sc(P.dims.ops)} · biz ${sc(P.dims.biz)} · overall ${sc(P.overall)}`);
  console.log(`${pad('Attention', 10)}${P.attention} features (blocked ${byStatus.blocked || 0}, changes requested ${changes.length})`);
  console.log(`${pad('Graph', 10)}${withDeps}/${N} features with dependencies (${pct(withDeps / N)}), ${edges.length} links, ${crossModule} cross-module, ${crossDomain} cross-domain`);
  console.log(`${pad('Activity', 10)}${recent} updated since ${RECENT_FROM} · ${pending.length} pending review · ${notes} notes`);
} catch (err) {
  check(false, `summary table failed: ${err && err.message}`);
}

finish();
