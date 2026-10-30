#!/usr/bin/env node
// A throwaway portfolio for the Morning Watch: three demo products, each a copy of the Kettle sample map with its own
// lens-scan store (scripts/scan-demo.mjs, seeded a day back), plus a SYNTHETIC NIGHT written on top, so a morning has
// something to say: what agents built overnight (built and failed items on a night pack), a release merged yesterday
// evening with readings taken after it (one product's confirm its expected values, one's fall short), and findings
// raised overnight with tiers. Every night row is labelled: its run's note says "morning-demo: synthetic overnight
// activity", and its model is "demo". Nothing calls a model, nothing touches bp.products.local.json: the registry is
// .demo/morning/products.json, which the server reads when started with BP_PRODUCTS_FILE pointing at it.
//
//   node scripts/morning-demo.mjs [--root .demo/morning] [--now <iso>]
//
// Re-running it resets the three stores (their files are deleted and seeded again), so the morning starts fresh.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const BASE = path.resolve(opt('--root') ?? path.join(ROOT, '.demo', 'morning'));
const NOW = opt('--now') ? Date.parse(opt('--now')) : Date.now();
if (!Number.isFinite(NOW)) { console.error('--now is not an ISO instant'); process.exit(2); }
const H = 3600e3, iso = (ms) => new Date(ms).toISOString();
const NOTE = 'morning-demo: synthetic overnight activity';

// Three products, three different nights. `pick` offsets choose different features from the same map, so the rooms differ.
const PRODUCTS = [
  { slug: 'kettle-web', name: 'Kettle Web', pick: 0, built: 4, failed: 1, release: { version: '1.4.0', confirm: true }, findings: [{ tier: 0, risk_class: 'secret' }, { tier: 2, risk_class: 'ux' }] },
  { slug: 'kettle-phone', name: 'Kettle Phone', pick: 7, built: 2, failed: 0, release: { version: '2.1.0', confirm: false }, findings: [{ tier: 1, risk_class: 'perf' }] },
  { slug: 'kettle-desk', name: 'Kettle Front Desk', pick: 13, built: 0, failed: 0, release: null, findings: [{ tier: 2, risk_class: 'debt' }] },
];

const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
const NAMES = new Map(map.features.map((f) => [f.slug, f.name]));
/** lens|metric -> 'up' | 'down' from the copied map's lens manifests. */
const BETTER = new Map();
for (const l of map.lenses ?? []) for (const f of l.manifest?.fields ?? []) if (f.metric) BETTER.set(`${l.id}|${f.key}`, f.metric.better);

const TITLES = {
  bundleKb: (n) => `Split the ${n} bundle by route`,
  findingsHigh: (n) => `Close the high-severity finding in ${n}`,
  findingsMedium: (n) => `Close the medium findings in ${n}`,
  axeViolations: (n) => `Fix the accessibility violations in ${n}`,
  minTextPx: (n) => `Raise the smallest text in ${n} to 12 px`,
  undesignedStates: (n) => `Design the empty and error states of ${n}`,
  dupSites: (n) => `Fold the duplicated helpers in ${n}`,
  p95Ms: (n) => `Bring ${n} p95 under 300 ms`,
  interactionP95Ms: (n) => `Make ${n} respond faster`,
  startupMs: (n) => `Start ${n} faster`,
  testRatioPct: (n) => `Cover ${n} with tests`,
  rawLiterals: (n) => `Move ${n} copy into tokens`,
  unsafeSinks: (n) => `Remove the unsafe HTML sinks in ${n}`,
};
const FINDING_TITLES = {
  secret: (n) => `An API key is committed in ${n}: rotate it and move it to the vault`,
  ux: (n) => `${n} loses the form on a failed save`,
  perf: (n) => `${n} takes 2.4 s to open on a mid-range phone`,
  debt: (n) => `${n} still runs on the retired date library`,
};
// each overnight finding reads the metric its words are about, at a value the night's measure run records
const FINDING_METRIC = {
  secret: { lens: 'security', metric: 'secretHits', value: 1, delta: -1, unit: 'hits' },
  ux: { lens: 'design', metric: 'undesignedStates', value: 3, delta: -2, unit: 'states' },
  perf: { lens: 'performance', metric: 'startupMs', value: 2400, delta: -1100, unit: 'ms' },
  debt: { lens: 'development', metric: 'depCount', value: 17, delta: -2, unit: 'packages' },
};
const titleOf = (metric, f) => (TITLES[metric] ?? ((n) => `Improve ${metric} on ${n}`))(NAMES.get(f) ?? f);

function insert(db, table, row) {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const vals = keys.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]));
  return db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...vals);
}

/** The night on one product's store. */
function night(db, spec) {
  const lensesOf = db.prepare('SELECT lenses FROM runs ORDER BY started_at LIMIT 1').get();
  // the latest current reading per (feature, lens, metric) with room to improve, in a stable order
  const rows = db.prepare(`SELECT feature, lens, metric, value, unit, method FROM measurements m WHERE proposal_id IS NULL AND phase IS NULL
    AND measured_at = (SELECT MAX(measured_at) FROM measurements x WHERE x.feature = m.feature AND x.lens = m.lens AND x.metric = m.metric AND x.proposal_id IS NULL)
    ORDER BY feature, lens, metric`).all().filter((r) => TITLES[r.metric] && BETTER.has(`${r.lens}|${r.metric}`) && (BETTER.get(`${r.lens}|${r.metric}`) === 'up' || r.value > 0));
  const used = new Set(), take = (n) => {
    const out = [];
    for (let i = 0; out.length < n && i < rows.length; i++) {
      const r = rows[(spec.pick * 11 + i * 7) % rows.length];
      if (used.has(r.feature)) continue;
      used.add(r.feature); out.push(r);
    }
    return out;
  };
  const delta = (r) => { const up = BETTER.get(`${r.lens}|${r.metric}`) === 'up'; const raw = Math.abs(r.value) * 0.25, d = Number.isInteger(r.value) ? Math.max(1, Math.round(raw)) : Math.max(0.1, Math.round(raw * 10) / 10); return up ? d : -Math.min(d, r.value); };
  const evening = NOW - 14 * H, measure = 'run-night-measure', exec = 'run-night-build';
  db.exec('BEGIN');
  insert(db, 'runs', { id: exec, started_at: iso(NOW - 8.5 * H), updated_at: iso(NOW - 2 * H), ended_at: iso(NOW - 2 * H), phase: 'execute', status: 'done', lenses: lensesOf.lenses, scope: { night: true }, skill_version: '0.1.0', model: 'demo', note: NOTE });
  insert(db, 'runs', { id: measure, started_at: iso(NOW - 3 * H), updated_at: iso(NOW - 1.5 * H), ended_at: iso(NOW - 1.5 * H), phase: 'measure', status: 'done', lenses: lensesOf.lenses, scope: { night: true }, skill_version: '0.1.0', model: 'demo', note: NOTE });
  // what agents built overnight: approved yesterday evening, built on a night pack, the after reading on its branch
  if (spec.built + spec.failed) {
    const items = take(spec.built + spec.failed), lens = items[0].lens, pack = `k-night-${spec.slug}`;
    insert(db, 'packs', { id: pack, lens, n: 90, branch: `pack/night-${spec.slug}`, base_ref: 'main', base_sha: 'demo0000', run_id: exec, status: 'open', created_at: iso(NOW - 8.5 * H), updated_at: iso(NOW - 2 * H) });
    items.forEach((r, i) => {
      const id = `night-${spec.slug}-${i + 1}`, ok = i < spec.built, at = NOW - (8 - i * 1.3) * H, d = delta(r);
      insert(db, 'proposals', { id, run_id: exec, feature: r.feature, lens: r.lens, metric: r.metric, title: titleOf(r.metric, r.feature), body: `## Summary\n${NOTE}.`, expected_delta: d, size: 'S', risk: 3, kind: 'fix',
        status: ok ? 'done' : 'failed', decided_by: 'user:owner', decided_at: iso(evening + i * 60e3), pack_id: pack, commit_sha: ok ? `demo${String(i + 1).padStart(4, '0')}` : undefined,
        created_at: iso(evening - 2 * H), updated_at: iso(at) });
      insert(db, 'measurements', { run_id: exec, feature: r.feature, lens: r.lens, metric: r.metric, value: r.value, unit: r.unit, method: r.method, evidence: NOTE, measured_at: iso(at - 20 * 60e3), proposal_id: id, phase: 'before' });
      if (ok) insert(db, 'measurements', { run_id: exec, feature: r.feature, lens: r.lens, metric: r.metric, value: Math.round((r.value + d) * 10) / 10, unit: r.unit, method: r.method, evidence: NOTE, measured_at: iso(at), proposal_id: id, phase: 'after', commit_sha: `demo${String(i + 1).padStart(4, '0')}` });
      insert(db, 'activity', { run_id: exec, at: iso(at), feature: r.feature, lens: r.lens, kind: ok ? 'committed' : 'error', text: ok ? `built: ${titleOf(r.metric, r.feature)}` : `build failed twice: ${titleOf(r.metric, r.feature)}` });
    });
  }
  // a release merged yesterday evening, and readings of its items taken overnight, after it
  if (spec.release) {
    const relId = `rel-${spec.release.version}`, merged = NOW - 13 * H;
    insert(db, 'releases', { id: relId, version: spec.release.version, branch: `release/${spec.release.version}`, base_sha: 'demo1000', status: 'merged', pr_url: null, notes: NOTE, created_by: 'user:owner', created_at: iso(merged - 2 * H), updated_at: iso(merged) });
    take(2).forEach((r, i) => {
      const id = `rel-${spec.slug}-${i + 1}`, d = delta(r), hit = spec.release.confirm || i === 1;
      insert(db, 'proposals', { id, run_id: exec, feature: r.feature, lens: r.lens, metric: r.metric, title: titleOf(r.metric, r.feature), body: `## Summary\n${NOTE}.`, expected_delta: d, size: 'S', risk: 2, kind: 'fix',
        status: 'released', decided_by: 'user:owner', decided_at: iso(merged - 30 * H), release_id: relId, commit_sha: `demo2${i}00`, created_at: iso(merged - 40 * H), updated_at: iso(merged) });
      insert(db, 'measurements', { run_id: exec, feature: r.feature, lens: r.lens, metric: r.metric, value: r.value, unit: r.unit, method: r.method, evidence: NOTE, measured_at: iso(merged - 31 * H), proposal_id: id, phase: 'before' });
      const v = Math.round((r.value + (hit ? d : d * 0.3)) * 10) / 10;
      insert(db, 'measurements', { run_id: measure, feature: r.feature, lens: r.lens, metric: r.metric, value: v, unit: r.unit, method: r.method, evidence: NOTE, measured_at: iso(NOW - 2.5 * H + i * 60e3) });
      insert(db, 'activity', { run_id: measure, at: iso(NOW - 2.5 * H + i * 60e3), feature: r.feature, lens: r.lens, kind: 'measured', text: `measured ${r.metric} on ${r.feature} after release ${spec.release.version}` });
    });
  }
  // findings raised overnight, waiting for a person
  spec.findings.forEach((f, i) => {
    const [r] = take(1), id = `find-${spec.slug}-${i + 1}`, at = NOW - (2.2 - i * 0.3) * H, fm = FINDING_METRIC[f.risk_class];
    insert(db, 'measurements', { run_id: measure, feature: r.feature, lens: fm.lens, metric: fm.metric, value: fm.value, unit: fm.unit, method: 'static', evidence: NOTE, measured_at: iso(at - 60e3) });
    insert(db, 'proposals', { id, run_id: measure, feature: r.feature, lens: fm.lens, metric: fm.metric, title: FINDING_TITLES[f.risk_class](NAMES.get(r.feature) ?? r.feature), body: `## Summary\n${NOTE}.`, expected_delta: fm.delta, size: 'S', risk: f.tier === 0 ? 8 : 4, kind: 'fix',
      status: 'proposed', tier: f.tier, risk_class: f.risk_class, ranked_by: 'agent:night', ranked_at: iso(at), created_at: iso(at), updated_at: iso(at) });
    insert(db, 'activity', { run_id: measure, at: iso(at), feature: r.feature, lens: fm.lens, kind: 'proposed', text: `raised: ${FINDING_TITLES[f.risk_class](NAMES.get(r.feature) ?? r.feature)}` });
  });
  db.exec('COMMIT');
}

fs.mkdirSync(BASE, { recursive: true });
const registry = { products: [] };
for (const spec of PRODUCTS) {
  const dir = path.join(BASE, spec.slug);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/scan-demo.mjs'), '--dir', dir, '--no-register', '--reset', '--now', iso(NOW - 16 * H)], { stdio: ['ignore', 'pipe', 'inherit'] });
  if (r.status !== 0) { console.error(`scan-demo failed for ${spec.slug}`); process.exit(1); }
  const db = new DatabaseSync(path.join(dir, '.ai', 'lens-scan', 'scan.db'));
  try { night(db, spec); } finally { db.close(); }
  for (const f of ['steering-log.jsonl', 'steering-log.md']) fs.rmSync(path.join(dir, '.ai', 'lens-scan', 'work', f), { force: true });
  registry.products.push({ slug: spec.slug, name: spec.name, root: dir });
  console.log(`seeded ${spec.slug}: ${spec.built} built, ${spec.failed} failed, ${spec.release ? 'release ' + spec.release.version + (spec.release.confirm ? ' (confirms)' : ' (falls short)') : 'no release'}, ${spec.findings.length} new finding(s)`);
}
const file = path.join(BASE, 'products.json');
fs.writeFileSync(file, JSON.stringify(registry, null, 2) + '\n');
console.log(`registry ${file}\nstart the web with BP_PRODUCTS_FILE=${path.relative(ROOT, file)} (never bp.products.local.json)`);
