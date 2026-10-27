#!/usr/bin/env node
// A demo live product, so the live surfaces can be built and shown without running a real /lens-scan.
// Sample data, projected rather than invented: it is the Kettle map with a lens-scan store seeded next to it, and
// every reading in that store is read off the map. The lenses, metric keys, units, methods and better-directions are
// the copied map's lens manifests (lenses[].manifest.fields with a `metric`); the measured (feature, lens) pairs are
// exactly the ones whose map facet carries a numeric value for one of that lens's metrics; the latest run reads the
// facet value itself, so the live overlay (packages/core/src/model/live-health.ts) restates the health the map
// already shows. A manifest edit therefore changes the demo, and scripts/check-scan-demo.mjs fails if this file
// ever re-declares any of it.
//
//   node scripts/scan-demo.mjs [--dir .demo/kettle-live] [--reset] [--live] [--now <iso>] [--no-register]
//
// Writes, under <dir> (default .demo/kettle-live at the repo root, gitignored):
//   .ai/lens-scan/app-structure.json   a copy of packages/core/data/kettle.app-structure.json (as it is when run)
//   .ai/lens-scan/scan.db              created from docs/standard/lens-scan-store.sql and seeded with two
//                                      finished runs a week apart (the later one the map's facet values, the
//                                      earlier one a seeded drift from them, scripts/lib/prng.ts `seeded`),
//                                      7 proposals anchored to the worst readings (one baseline upgrade with 2
//                                      propagation children), coverage rows and two PNG shots per run
//                                      and Kettle's sample release train (packages/core/src/model/train-sim.ts, the
//                                      same packs and numbers Kettle `/` shows): packs k-des-1, k-des-2, k-perf-1 with
//                                      their execute runs, built items (done, failed, a rework and its rebuild), phased
//                                      readings whose baselines end on the map's facet values, two items accepted
//                                      and a draft release of them (`train`)
//   .ai/lens-scan/shots/...            the placeholder PNGs (the train's item shots as PNGs under shots/<run>/)
// and registers slug `kettle-live` in bp.products.local.json (create or merge; idempotent). An existing
// store is kept (a running blueprint stream may hold it open); --reset recreates it.
// --now <iso> is the reference instant the seeded runs hang off (default: the clock), so two seeds with the same
// --now are the same bytes; --no-register leaves bp.products.local.json alone (how a test seeds a temp dir).
// --live then starts a running run and appends an activity row every 1.5 s, a measurement every 3 s and
// a proposal every 20 s until Ctrl-C, when the run is marked done. A write that fails (a busy store, most
// often) marks the run `aborted` and exits 1: the run row never stays `running` after the process is gone.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { seeded } from './lib/prng.ts';
import { SAMPLE_ITEMS, TrainSim } from '../packages/core/src/model/train-sim.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const DIR = opt('--dir') ? path.resolve(opt('--dir')) : path.join(ROOT, '.demo', 'kettle-live');
const LIVE = argv.includes('--live'), RESET = argv.includes('--reset'), REGISTER = !argv.includes('--no-register');
const NOW = opt('--now');
if (NOW !== undefined && !Number.isFinite(Date.parse(NOW))) { console.error(`--now ${NOW} is not an ISO instant`); process.exit(2); }
const SLUG = 'kettle-live', NAME = 'Kettle (live demo)';
const STORE = path.join(DIR, '.ai', 'lens-scan'), DB = path.join(STORE, 'scan.db');
const MAP = path.join(ROOT, 'packages/core/data/kettle.app-structure.json');
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));

// ------------------------------------------------------------------------------- the projection
/** lens id -> its manifest's metric fields, for every enabled lens that has one. */
const METRICS = {};
for (const l of map.lenses ?? []) {
  if (l.enabled === false) continue;
  const ms = (l.manifest?.fields ?? []).filter((f) => f.metric).map((f) => ({
    key: f.key, unit: f.unit, method: f.metric.method, better: f.metric.better, int: f.type === 'integer',
    min: f.min ?? (f.type === 'percent' ? 0 : undefined), max: f.max ?? (f.type === 'percent' ? 100 : undefined),
  }));
  if (ms.length) METRICS[l.id] = ms;
}
const facet = (f, lens, key) => { const v = map.facets?.[f]?.[lens]?.values?.[key]; return typeof v === 'number' ? v : undefined; };
/** Every (feature, lens) the map has metric values for, in map order, with the metrics it carries. */
const PAIRS = [];
for (const { slug } of map.features) for (const [lens, ms] of Object.entries(METRICS)) {
  const metrics = ms.filter((m) => facet(slug, lens, m.key) !== undefined);
  if (metrics.length) PAIRS.push({ f: slug, lens, metrics });
}
const LENSES = Object.keys(METRICS).filter((l) => PAIRS.some((p) => p.lens === l));
const FEATURES = [...new Set(PAIRS.map((p) => p.f))];

const clamp = (m, v) => { const r = m.int ? Math.round(v) : Math.round(v * 10) / 10; return Math.min(m.max ?? Infinity, Math.max(m.min ?? -Infinity, r)); };
/** A seeded move of up to 15% either way (of the value, or of 1 when it is smaller), clamped to the field's range. */
const drift = (m, v, label) => clamp(m, v + (seeded(label)() - 0.5) * 0.3 * Math.max(Math.abs(v), 1));
const iso = (ms) => new Date(ms).toISOString();


// ------------------------------------------------------------------------------- a tiny valid PNG
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3, band = y < h / 6 ? 0.55 : 1; // a darker "header" band
      raw[o] = r * band; raw[o + 1] = g * band; raw[o + 2] = b * band;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------------------- store helpers
const open = () => new DatabaseSync(DB, { timeout: 2000 });
function insert(db, table, row) {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const vals = keys.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]));
  return db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...vals);
}

// ------------------------------------------------------------------------------- files
fs.mkdirSync(STORE, { recursive: true });
fs.copyFileSync(MAP, path.join(STORE, 'app-structure.json'));

// ------------------------------------------------------------------------------- the stories, chosen from the data
const metricOf = (lens, key) => METRICS[lens]?.find((m) => m.key === key);
/** The feature with the worst reading of lens.key that still has room to improve (ties: map order), or undefined. */
function worst(lens, key) {
  const m = metricOf(lens, key);
  let w;
  if (m) for (const p of PAIRS) {
    if (p.lens !== lens) continue;
    const v = facet(p.f, lens, key);
    if (v === undefined || (m.better === 'down' && v <= (m.min ?? 0))) continue;
    if (!w || (m.better === 'up' ? v < w.v : v > w.v)) w = { f: p.f, v };
  }
  return w;
}
const SPLIT = worst('development', 'bundleKb'), QUERY = worst('security', 'findingsHigh');
const LABELS = worst('design', 'axeViolations'), HELPERS = worst('development', 'dupSites');
// The text floor: the highest minTextPx the map reads is the floor; its first feature is where the baseline upgrade
// was built (one px up from the earlier run), and the two lowest below it are where it propagates next.
const TEXT = PAIRS.filter((p) => p.lens === 'design' && facet(p.f, 'design', 'minTextPx') !== undefined).map((p) => ({ f: p.f, v: facet(p.f, 'design', 'minTextPx') }));
const FLOOR = TEXT.length ? Math.max(...TEXT.map((x) => x.v)) : undefined;
const RAISED = TEXT.find((x) => x.v === FLOOR);
const BELOW = TEXT.filter((x) => x.v < FLOOR).sort((a, b) => a.v - b.v).slice(0, 2);
const SHOT_FEATURES = [...new Set([SPLIT, LABELS, ...PAIRS].filter(Boolean).map((x) => x.f))].slice(0, 2);

if (RESET) for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
const fresh = !fs.existsSync(DB);
if (fresh) seed();
if (REGISTER) register();
console.log(`${fresh ? 'seeded' : 'kept'} ${DB}\n${REGISTER ? `registered ${SLUG} -> ${DIR} in bp.products.local.json` : 'not registered (--no-register)'}`);
if (LIVE) live();

function seed() {
  const db = open();
  db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
  const now = NOW ? Date.parse(NOW) : Date.now(), B = now - 3600e3, A = B - 7 * 86400e3;
  const runs = [{ id: 'run-demo-a', t: A }, { id: 'run-demo-b', t: B }];
  /** The reading of run i: the later run is the map's facet value, the earlier one a seeded drift from it. */
  const reading = (i, f, lens, m) => {
    const v = facet(f, lens, m.key);
    if (i) return v;
    if (RAISED && f === RAISED.f && lens === 'design' && m.key === 'minTextPx') return clamp(m, v - 1);
    return drift(m, v, `${f}|${lens}|${m.key}|drift`);
  };
  db.exec('BEGIN');
  for (const [i, r] of runs.entries()) {
    insert(db, 'runs', {
      id: r.id, started_at: iso(r.t), updated_at: iso(r.t + 40 * 60e3), ended_at: iso(r.t + 40 * 60e3), phase: 'propose', status: 'done',
      lenses: LENSES, scope: { features: FEATURES, sample: 'kettle' }, skill_version: '0.1.0', model: 'demo', note: i ? 'Second pass, a week on' : 'Baseline pass',
    });
    let k = 0;
    for (const { f, lens, metrics } of PAIRS) {
      const at = r.t + (++k) * 30e3;
      insert(db, 'activity', { run_id: r.id, at: iso(at - 15e3), feature: f, lens, kind: 'reading', text: `reading ${f} for ${lens}` });
      for (const m of metrics) {
        insert(db, 'measurements', { run_id: r.id, feature: f, lens, metric: m.key, value: reading(i, f, lens, m), unit: m.unit, method: m.method, evidence: m.method === 'judgement' ? 'demo judgement' : `demo ${m.method} reading`, measured_at: iso(at) });
      }
      insert(db, 'activity', { run_id: r.id, at: iso(at), feature: f, lens, kind: 'measured', text: `measured ${metrics.length} ${lens} metrics on ${f}` });
    }
    for (const [j, f] of SHOT_FEATURES.entries()) {
      const design = (key, dflt) => { const m = metricOf('design', key); return m && facet(f, 'design', key) !== undefined ? reading(i, f, 'design', m) : dflt; };
      for (const theme of ['light', 'dark']) {
        const rel = `shots/${f}/${r.id}-1280x800-${theme}.png`;
        fs.mkdirSync(path.join(STORE, 'shots', f), { recursive: true });
        const base = theme === 'light' ? [226, 232, 240] : [30, 41, 59];
        fs.writeFileSync(path.join(STORE, rel), png(64, 40, base.map((c, n) => (n === (i + j) % 3 ? Math.min(255, c + 25) : c))));
        insert(db, 'shots', {
          run_id: r.id, feature: f, path: rel, size: '1280x800', theme, harness_module: 'demo', captured_at: iso(r.t + 20 * 60e3),
          report: { consoleErrors: design('consoleErrors', 0), unknownIpc: [], textChecks: { minTextPx: design('minTextPx', 12) } },
        });
      }
    }
  }
  const P = (id, o) => insert(db, 'proposals', { id, run_id: 'run-demo-b', standard: 'none', kind: 'fix', status: 'proposed', created_at: iso(B + 30 * 60e3), updated_at: iso(B + 30 * 60e3), ...o });
  const body = (s) => `## Summary\n${s}\n\n## Expected impact\nSee the metric and expected delta.\n\n## Evaluation\nRe-measure after the change.`;
  const cover = (f, standard, state, evidence) => insert(db, 'coverage', { feature: f, standard, state, evidence, judged_at: iso(B + 25 * 60e3), run_id: 'run-demo-b' });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (SPLIT) {
    P('prop-demo-1', { feature: SPLIT.f, lens: 'development', metric: 'bundleKb', title: `Split the ${SPLIT.f} bundle by route`, body: body(`${SPLIT.v} KB, the largest bundle share the map reads.`), standard: 'performance/code-splitting', expected_delta: -Math.max(1, Math.round(SPLIT.v * 0.3)), size: 'S', risk: 3 });
    cover(SPLIT.f, 'performance/code-splitting', 'deviation', 'one bundle for every route');
  }
  if (QUERY) {
    P('prop-demo-2', { feature: QUERY.f, lens: 'security', metric: 'findingsHigh', title: `Parameterise the ${QUERY.f} lookup query`, body: body(`${plural(QUERY.v, 'high finding', 'high findings')}: string-built queries.`), standard: 'security/parameterised-queries', expected_delta: -QUERY.v, size: 'XS', risk: 8 });
    cover(QUERY.f, 'security/parameterised-queries', 'deviation', plural(QUERY.v, 'string-built query', 'string-built queries'));
  }
  if (LABELS) {
    P('prop-demo-3', { feature: LABELS.f, lens: 'design', metric: 'axeViolations', title: `Label the ${LABELS.f} form controls`, body: body('Inputs without labels.'), standard: 'accessibility/form-labels', expected_delta: -LABELS.v, size: 'S', risk: 2, status: 'approved', decided_by: 'blueprint', decided_at: iso(B + 35 * 60e3), updated_at: iso(B + 35 * 60e3) });
    cover(LABELS.f, 'accessibility/form-labels', 'deviation', plural(LABELS.v, 'unlabelled input', 'unlabelled inputs'));
  }
  if (HELPERS) {
    P('prop-demo-4', { feature: HELPERS.f, lens: 'development', metric: 'dupSites', title: `Fold the duplicated date helpers in ${HELPERS.f}`, standard: 'house:code/one-helper', expected_delta: -Math.ceil(HELPERS.v / 2), size: 'M', risk: 4, status: 'declined', decided_by: 'blueprint', decided_at: iso(B + 36 * 60e3), decision_note: 'Not before the release', updated_at: iso(B + 36 * 60e3) });
    cover(HELPERS.f, 'house:code/one-helper', 'not-applicable', undefined);
  }
  if (RAISED) {
    P('prop-demo-5', { feature: RAISED.f, lens: 'design', metric: 'minTextPx', title: `Raise the text floor to ${FLOOR} px`, body: body(`House rule: no text below ${FLOOR} px.`), standard: 'house:design/text-floor', expected_delta: 1, size: 'M', risk: 5, kind: 'baseline-upgrade', status: 'done', decided_by: 'blueprint', decided_at: iso(B + 32 * 60e3), after_value: FLOOR, result_sha: 'demo0001', updated_at: iso(B + 38 * 60e3) });
    cover(RAISED.f, 'house:design/text-floor', 'conformant', `min ${FLOOR} px after prop-demo-5`);
    for (const [n, x] of BELOW.entries()) {
      P(`prop-demo-${6 + n}`, { feature: x.f, lens: 'design', metric: 'minTextPx', title: `Apply the ${FLOOR} px text floor to ${x.f}`, standard: 'house:design/text-floor', expected_delta: FLOOR - x.v, size: 'XS', risk: 2, kind: 'propagation', parent_id: 'prop-demo-5' });
      cover(x.f, 'house:design/text-floor', 'deviation', `captions at ${x.v} px`);
    }
  }
  train(db, now);
  db.exec('COMMIT');
  db.close();
}

/**
 * Kettle's sample release train, projected into the store: TrainSim drives arrays over the copied map's manifests and
 * facet values (seed's value hook), two done items are triaged accepted and the suggested release is created; the rows
 * then go in FK order. Its SVG shot paths (public/sample-shots) are not files the store's shots route serves, so each
 * becomes a PNG under shots/<run>/, the after tinted where the item's screen changes.
 */
function train(db, now) {
  const host = { runs: [], ms: [], act: [], props: [], pAt: new Map(), now: () => now, nextMeasurement: () => 0, nextActivity: () => 0, changed: () => {},
    field: (lens, key) => map.lenses.find((l) => l.id === lens)?.manifest?.fields?.find((f) => f.key === key) };
  const sim = new TrainSim(host);
  sim.seed(map.features.map((f) => f.slug), facet);
  const idOf = (key) => host.props[SAMPLE_ITEMS.findIndex((i) => i.key === key)].id;
  // two done items accepted (SAMPLE_ITEMS keys; check-scan-demo-train.mjs pins the same two), so the release has items
  sim.triage({ ids: ['des1-booking', 'perf1-timetable'].map(idOf), decision: 'accept' });
  sim.create(sim.suggest().version);
  const noId = ({ id, ...row }) => row;
  for (const r of host.runs) insert(db, 'runs', r);
  for (const k of sim.packs) insert(db, 'packs', k);
  for (const r of sim.releases) insert(db, 'releases', r);
  for (const p of host.props) insert(db, 'proposals', p);
  for (const m of host.ms) insert(db, 'measurements', noId(m));
  for (const a of host.act) insert(db, 'activity', noId(a));
  for (const s of sim.shots) {
    const it = SAMPLE_ITEMS[host.props.findIndex((p) => p.id === s.proposal_id)];
    const rel = `shots/${s.run_id}/${it.key}-${s.phase}-${s.theme}.png`;
    const base = s.theme === 'light' ? [226, 232, 240] : [30, 41, 59];
    fs.mkdirSync(path.join(STORE, 'shots', s.run_id), { recursive: true });
    fs.writeFileSync(path.join(STORE, rel), png(64, 36, s.phase === 'after' && it.screen?.change ? base.map((c, n) => (n === 1 ? Math.min(255, c + 25) : c)) : base));
    insert(db, 'shots', { ...noId(s), path: rel });
  }
}

// The second writer of bp.products.local.json; the first is packages/core/src/server/registry.server.ts, and
// docs/blueprint-ui.md:401 states the contract both must keep: created when absent, unknown keys and entry order
// kept, written atomically (temp file in the same directory, then a rename with the Windows retry), and "a file
// that does not parse is never overwritten (409)". This function used to catch every read and parse failure as
// `/* new file */` and then write the whole file from scratch: a truncated or half-written registry - the exact
// state an interrupted write leaves - lost every product in it, silently, under a message saying "registered".
// Measured 2026-10-21 with a seeded truncated file holding two live products and a defaultSlug: 2 of 2 products
// and the defaultSlug gone, exit 0. The file is git-ignored machine state, so there is nothing to restore from.
function register() {
  const file = path.join(ROOT, 'bp.products.local.json');
  const refuse = (why) => { console.error(`bp.products.local.json ${why}; fix it by hand first - ${SLUG} was NOT registered`); process.exit(1); };
  let doc = { products: [] };
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') refuse(`cannot be read: ${e.message}`); }
  if (text !== null) {
    try { doc = JSON.parse(text); } catch (e) { refuse(`is not valid JSON (${e.message})`); }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) refuse('is not a JSON object');
    if (doc.products === undefined) doc.products = [];
    if (!Array.isArray(doc.products)) refuse(': "products" is not an array');
  }
  const entry = { slug: SLUG, name: NAME, root: DIR };
  const i = doc.products.findIndex((p) => p && p.slug === SLUG);
  if (i >= 0) doc.products[i] = { ...doc.products[i], ...entry }; else doc.products.push(entry);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  for (let k = 1; ; k++) {
    try { fs.renameSync(tmp, file); break; } // Windows can answer EPERM/EBUSY while a reader holds the old file
    catch (e) { if (k >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; } }
  }
}

function live() {
  const db = open();
  const id = 'run-live-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const t = () => iso(Date.now());
  // A live run killed without Ctrl-C (a hard kill, a closed terminal) stays `running`: close it as aborted.
  db.prepare("UPDATE runs SET status = 'aborted', ended_at = ?, updated_at = ? WHERE status = 'running'").run(t(), t());
  insert(db, 'runs', { id, started_at: t(), updated_at: t(), phase: 'measure', status: 'running', lenses: LENSES, scope: { features: FEATURES, sample: 'kettle' }, skill_version: '0.1.0', model: 'demo', note: 'scan-demo --live' });
  const touch = () => db.prepare('UPDATE runs SET updated_at = ? WHERE id = ?').run(t(), id);
  const lastOf = db.prepare('SELECT value FROM measurements WHERE feature = ? AND lens = ? AND metric = ? ORDER BY measured_at DESC, id DESC LIMIT 1');
  let n = 0, m = 0, p = 0;
  const at = (k) => PAIRS[k % PAIRS.length];
  const tick1 = setInterval(() => {
    const { f, lens } = at(n++);
    const r = insert(db, 'activity', { run_id: id, at: t(), feature: f, lens, kind: n % 17 === 0 ? 'note' : 'reading', text: `reading ${f} for ${lens}` });
    console.log(`${t()} activity #${r.lastInsertRowid} ${lens} ${f}`);
  }, 1500);
  const tick2 = setInterval(() => {
    // A seeded drift from the latest reading of one metric the map measures on this feature.
    const { f, lens, metrics } = at(m++), spec = metrics[m % metrics.length];
    const v = drift(spec, lastOf.get(f, lens, spec.key)?.value ?? facet(f, lens, spec.key), `${f}|${lens}|${spec.key}|live|${m}`);
    const r = insert(db, 'measurements', { run_id: id, feature: f, lens, metric: spec.key, value: v, unit: spec.unit, method: spec.method, evidence: 'demo live reading', measured_at: t() });
    insert(db, 'activity', { run_id: id, at: t(), feature: f, lens, kind: 'measured', text: `measured ${spec.key} = ${v}${spec.unit ? ' ' + spec.unit : ''} on ${f}` });
    console.log(`${t()} measurement #${r.lastInsertRowid} ${lens}.${spec.key}=${v} ${f}`);
  }, 3000);
  const tick3 = setInterval(() => {
    // The first metric of this feature/lens with room to improve, moved about 30% of the way to its best end (a
    // better-up metric with no max: 30% of the way to 1.3 times its value).
    const { f, lens, metrics } = at(p * 7 + 1), pid = `${id}-p${++p}`;
    let spec, delta;
    for (let k = 0; k < metrics.length && delta === undefined; k++) {
      spec = metrics[(p + k) % metrics.length];
      const last = lastOf.get(f, lens, spec.key);
      if (!last) continue;
      const up = spec.better === 'up';
      const room = up ? (spec.max ?? last.value * 1.3) - last.value : last.value - (spec.min ?? 0), step = Math.max(1, Math.round(room * 0.3));
      if (room >= 1) delta = (up ? 1 : -1) * Math.min(room, step);
    }
    if (delta === undefined) return;
    db.prepare("UPDATE runs SET phase = 'propose', updated_at = ? WHERE id = ?").run(t(), id);
    insert(db, 'proposals', { id: pid, run_id: id, feature: f, lens, metric: spec.key, title: `Improve ${spec.key} on ${f}`, body: '## Summary\nA demo proposal from scan-demo --live.', standard: 'none', expected_delta: delta, size: 'S', risk: 1 + (p * 3) % 10, kind: 'fix', status: 'proposed', created_at: t(), updated_at: t() });
    insert(db, 'activity', { run_id: id, at: t(), feature: f, lens, kind: 'proposed', text: `proposed: improve ${spec.key} on ${f}` });
    console.log(`${t()} proposal ${pid}`);
  }, 20000);
  const tick4 = setInterval(touch, 10000);
  const ticks = [tick1, tick2, tick3, tick4];
  /**
   * Stop ticking and mark the run `status`. A run row left `running` is read by every reader of the store as a scan
   * still measuring (packages/core/src/scan/swarm.ts treats `running` as live agents), so the terminal record is
   * retried against a busy store and, when it still cannot be written, said out loud rather than left to be guessed.
   */
  const close = (status, code) => {
    for (const x of ticks) clearInterval(x);
    let ok = false;
    for (let k = 1; k <= 5 && !ok; k++) {
      try { db.prepare('UPDATE runs SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?').run(status, t(), t(), id); ok = true; }
      catch (e) { console.error(`${t()} could not mark run ${id} ${status} (attempt ${k}/5): ${e.message}`); }
    }
    if (ok) console.log(`${t()} run ${id} marked ${status}`);
    else console.error(`${t()} run ${id} is STILL marked running in ${DB}; close it by hand:\n  UPDATE runs SET status = 'aborted', ended_at = '${t()}', updated_at = '${t()}' WHERE id = '${id}';`);
    try { db.close(); } catch { /* the handle may already be gone */ }
    process.exit(ok ? code : 1);
  };
  const stop = () => close('done', 0);
  // A throw inside a tick (a busy store, most often) used to kill the process outright with the run still `running`.
  process.on('uncaughtException', (e) => { console.error(`${t()} run ${id} hit ${e?.code ?? 'an error'}: ${e?.message ?? e}`); close('aborted', 1); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(`live run ${id}: Ctrl-C to stop`);
}
