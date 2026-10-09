#!/usr/bin/env node
// A demo live product, so the live surfaces can be built and shown without running a real /lens-scan.
// Sample data, invented here: it is the Kettle map with a lens-scan store seeded next to it.
//
//   node scripts/scan-demo.mjs [--dir .demo/kettle-live] [--reset] [--live]
//
// Writes, under <dir> (default .demo/kettle-live at the repo root, gitignored):
//   .ai/lens-scan/app-structure.json   a copy of src/data/kettle.app-structure.json (as it is when run)
//   .ai/lens-scan/scan.db              created from docs/standard/lens-scan-store.sql and seeded with two
//                                      finished runs a week apart (development/security/design metrics on
//                                      20 features), 7 proposals (one baseline upgrade with 2 propagation
//                                      children), coverage rows and two PNG shots per run
//   .ai/lens-scan/shots/...            the placeholder PNGs
// and registers slug `kettle-live` in bp.products.local.json (create or merge; idempotent). An existing
// store is kept (a running blueprint stream may hold it open); --reset recreates it.
// --live then starts a running run and appends an activity row every 1.5 s, a measurement every 3 s and
// a proposal every 20 s until Ctrl-C, when the run is marked done.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const DIR = opt('--dir') ? path.resolve(opt('--dir')) : path.join(ROOT, '.demo', 'kettle-live');
const LIVE = argv.includes('--live'), RESET = argv.includes('--reset');
const SLUG = 'kettle-live', NAME = 'Kettle (live demo)';
const STORE = path.join(DIR, '.ai', 'lens-scan'), DB = path.join(STORE, 'scan.db');
const LENSES = ['development', 'security', 'design'];

// ------------------------------------------------------------------------------- the metric catalogue
// [key, unit, method, low, high, integer]: the v1 metric keys of the brief's Data & API.
const METRICS = {
  development: [
    ['loc', 'lines', 'static', 300, 6000, true], ['files', 'files', 'static', 4, 60, true], ['bundleKb', 'kB', 'static', 20, 480, false],
    ['depCount', 'deps', 'static', 2, 40, true], ['p50Ms', 'ms', 'probe', 30, 260, true], ['p95Ms', 'ms', 'probe', 120, 1400, true],
    ['dupSites', 'sites', 'static', 0, 9, true], ['testRatioPct', '%', 'static', 5, 90, true], ['standardsPct', '%', 'judgement', 40, 100, true],
  ],
  security: [
    ['findingsCritical', 'findings', 'static', 0, 1, true], ['findingsHigh', 'findings', 'static', 0, 3, true], ['findingsMedium', 'findings', 'static', 0, 6, true],
    ['findingsLow', 'findings', 'static', 0, 12, true], ['secretHits', 'hits', 'static', 0, 1, true], ['unsafeSinks', 'sinks', 'static', 0, 4, true],
    ['standardsPct', '%', 'judgement', 50, 100, true],
  ],
  design: [
    ['axeViolations', 'violations', 'harness', 0, 14, true], ['undesignedStates', 'states', 'judgement', 0, 5, true], ['rawLiterals', 'literals', 'static', 0, 30, true],
    ['minTextPx', 'px', 'harness', 10, 14, true], ['consoleErrors', 'errors', 'harness', 0, 4, true], ['standardsPct', '%', 'judgement', 45, 100, true],
  ],
};

/** Metrics where a higher value is better (the rest: lower is better). */
const UP = new Set(['testRatioPct', 'standardsPct', 'minTextPx']);
// Deterministic "random": FNV-1a of a label, so the seed is the same bytes on every run.
const h01 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const pick = ([, , , lo, hi, int], label) => { const v = lo + h01(label) * (hi - lo); return int ? Math.round(v) : Math.round(v * 10) / 10; };
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
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/kettle.app-structure.json'), 'utf8'));
fs.copyFileSync(path.join(ROOT, 'src/data/kettle.app-structure.json'), path.join(STORE, 'app-structure.json'));
const FEATURES = map.features.slice(0, 20).map((f) => f.slug);
const SHOT_FEATURES = FEATURES.slice(0, 2);

if (RESET) for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
const fresh = !fs.existsSync(DB);
if (fresh) seed();
register();
console.log(`${fresh ? 'seeded' : 'kept'} ${DB}\nregistered ${SLUG} -> ${DIR} in bp.products.local.json`);
if (LIVE) live();

function seed() {
  const db = open();
  db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
  const now = Date.now(), B = now - 3600e3, A = B - 7 * 86400e3;
  const runs = [{ id: 'run-demo-a', t: A }, { id: 'run-demo-b', t: B }];
  db.exec('BEGIN');
  for (const [i, r] of runs.entries()) {
    insert(db, 'runs', {
      id: r.id, started_at: iso(r.t), updated_at: iso(r.t + 40 * 60e3), ended_at: iso(r.t + 40 * 60e3), phase: 'propose', status: 'done',
      lenses: LENSES, scope: { features: FEATURES.length, sample: 'kettle' }, skill_version: '0.1.0', model: 'demo', note: i ? 'Second pass, a week on' : 'Baseline pass',
    });
    let k = 0;
    for (const f of FEATURES) for (const lens of LENSES) {
      const at = r.t + (++k) * 30e3;
      insert(db, 'activity', { run_id: r.id, at: iso(at - 15e3), feature: f, lens, kind: 'reading', text: `reading ${f} for ${lens}` });
      for (const m of METRICS[lens]) {
        // The second run drifts each value a little from the first (both ways), so sparklines have a slope.
        let v = pick(m, `${f}|${lens}|${m[0]}`);
        if (i) { const d = (h01(`${f}|${lens}|${m[0]}|drift`) - 0.5) * 0.3 * (m[4] - m[3]); v = Math.min(m[4], Math.max(m[3], m[5] ? Math.round(v + d) : Math.round((v + d) * 10) / 10)); }
        insert(db, 'measurements', { run_id: r.id, feature: f, lens, metric: m[0], value: v, unit: m[1], method: m[2], evidence: m[2] === 'judgement' ? 'demo judgement' : `demo ${m[2]} reading`, measured_at: iso(at) });
      }
      insert(db, 'activity', { run_id: r.id, at: iso(at), feature: f, lens, kind: 'measured', text: `measured ${METRICS[lens].length} ${lens} metrics on ${f}` });
    }
    for (const [j, f] of SHOT_FEATURES.entries()) {
      for (const theme of ['light', 'dark']) {
        const rel = `shots/${f}/${r.id}-1280x800-${theme}.png`;
        fs.mkdirSync(path.join(STORE, 'shots', f), { recursive: true });
        const base = theme === 'light' ? [226, 232, 240] : [30, 41, 59];
        fs.writeFileSync(path.join(STORE, rel), png(64, 40, base.map((c, n) => (n === (i + j) % 3 ? Math.min(255, c + 25) : c))));
        insert(db, 'shots', {
          run_id: r.id, feature: f, path: rel, size: '1280x800', theme, harness_module: 'demo', captured_at: iso(r.t + 20 * 60e3),
          report: { consoleErrors: i ? 0 : 1, unknownIpc: [], textChecks: { minTextPx: i ? 12 : 11 } },
        });
      }
    }
  }
  const P = (id, o) => insert(db, 'proposals', { id, run_id: 'run-demo-b', standard: 'none', kind: 'fix', status: 'proposed', created_at: iso(B + 30 * 60e3), updated_at: iso(B + 30 * 60e3), ...o });
  const [f0, f1, f2, f3, f4, f5] = FEATURES;
  // The readings the proposals' stories rest on: [feature, lens, metric, run A value, run B value].
  for (const [f, lens, metric, a, b] of [
    [f0, 'development', 'bundleKb', 398.4, 412.6], [f1, 'security', 'findingsHigh', 3, 2], [f2, 'design', 'axeViolations', 7, 6],
    [f3, 'development', 'dupSites', 4, 4], [f4, 'design', 'minTextPx', 11, 12], [f5, 'design', 'minTextPx', 11, 11], [f1, 'design', 'minTextPx', 10, 10],
  ]) for (const [run, v] of [['run-demo-a', a], ['run-demo-b', b]]) db.prepare('UPDATE measurements SET value = ? WHERE run_id = ? AND feature = ? AND lens = ? AND metric = ?').run(v, run, f, lens, metric);
  const body =(s) => `## Summary\n${s}\n\n## Expected impact\nSee the metric and expected delta.\n\n## Evaluation\nRe-measure after the change.`;
  P('prop-demo-1', { feature: f0, lens: 'development', metric: 'bundleKb', title: `Split the ${f0} bundle by route`, body: body('Lazy-load the settings pane.'), standard: 'performance/code-splitting', expected_delta: -40, size: 'S', risk: 3 });
  P('prop-demo-2', { feature: f1, lens: 'security', metric: 'findingsHigh', title: `Parameterise the ${f1} lookup query`, body: body('Two string-built queries.'), standard: 'security/parameterised-queries', expected_delta: -2, size: 'XS', risk: 8 });
  P('prop-demo-3', { feature: f2, lens: 'design', metric: 'axeViolations', title: `Label the ${f2} form controls`, body: body('Inputs without labels.'), standard: 'accessibility/form-labels', expected_delta: -5, size: 'S', risk: 2, status: 'approved', decided_by: 'blueprint', decided_at: iso(B + 35 * 60e3), updated_at: iso(B + 35 * 60e3) });
  P('prop-demo-4', { feature: f3, lens: 'development', metric: 'dupSites', title: `Fold the duplicated date helpers in ${f3}`, standard: 'house:code/one-helper', expected_delta: -3, size: 'M', risk: 4, status: 'declined', decided_by: 'blueprint', decided_at: iso(B + 36 * 60e3), decision_note: 'Not before the release', updated_at: iso(B + 36 * 60e3) });
  P('prop-demo-5', { feature: f4, lens: 'design', metric: 'minTextPx', title: 'Raise the text floor to 12 px', body: body('House rule: no text below 12 px.'), standard: 'house:design/text-floor', expected_delta: 1, size: 'M', risk: 5, kind: 'baseline-upgrade', status: 'done', decided_by: 'blueprint', decided_at: iso(B + 32 * 60e3), after_value: 12, result_sha: 'demo0001', updated_at: iso(B + 38 * 60e3) });
  P('prop-demo-6', { feature: f5, lens: 'design', metric: 'minTextPx', title: `Apply the 12 px text floor to ${f5}`, standard: 'house:design/text-floor', expected_delta: 1, size: 'XS', risk: 2, kind: 'propagation', parent_id: 'prop-demo-5' });
  P('prop-demo-7', { feature: f1, lens: 'design', metric: 'minTextPx', title: `Apply the 12 px text floor to ${f1}`, standard: 'house:design/text-floor', expected_delta: 2, size: 'XS', risk: 2, kind: 'propagation', parent_id: 'prop-demo-5' });
  for (const [f, standard, state, evidence] of [
    [f0, 'performance/code-splitting', 'deviation', 'one bundle for every route'], [f1, 'security/parameterised-queries', 'deviation', '2 string-built queries'],
    [f2, 'accessibility/form-labels', 'conformant', 'all inputs labelled'], [f4, 'house:design/text-floor', 'conformant', 'min 12 px after prop-demo-5'],
    [f5, 'house:design/text-floor', 'deviation', 'captions at 11 px'], [f3, 'house:code/one-helper', 'not-applicable', undefined],
  ]) insert(db, 'coverage', { feature: f, standard, state, evidence, judged_at: iso(B + 25 * 60e3), run_id: 'run-demo-b' });
  db.exec('COMMIT');
  db.close();
}

function register() {
  const file = path.join(ROOT, 'bp.products.local.json');
  let doc = { products: [] };
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(doc.products)) doc.products = []; } catch { /* new file */ }
  const entry = { slug: SLUG, name: NAME, root: DIR };
  const i = doc.products.findIndex((p) => p && p.slug === SLUG);
  if (i >= 0) doc.products[i] = { ...doc.products[i], ...entry }; else doc.products.push(entry);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

function live() {
  const db = open();
  const id = 'run-live-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const t = () => iso(Date.now());
  // A live run killed without Ctrl-C (a hard kill, a closed terminal) stays `running`: close it as aborted.
  db.prepare("UPDATE runs SET status = 'aborted', ended_at = ?, updated_at = ? WHERE status = 'running'").run(t(), t());
  insert(db, 'runs', { id, started_at: t(), updated_at: t(), phase: 'measure', status: 'running', lenses: LENSES, scope: { features: FEATURES.length, sample: 'kettle' }, skill_version: '0.1.0', model: 'demo', note: 'scan-demo --live' });
  const touch = () => db.prepare('UPDATE runs SET updated_at = ? WHERE id = ?').run(t(), id);
  let n = 0, m = 0, p = 0;
  const at = (k) => ({ f: FEATURES[Math.floor(k / LENSES.length) % FEATURES.length], lens: LENSES[k % LENSES.length] });
  const tick1 = setInterval(() => {
    const { f, lens } = at(n++);
    const r = insert(db, 'activity', { run_id: id, at: t(), feature: f, lens, kind: n % 17 === 0 ? 'note' : 'reading', text: `reading ${f} for ${lens}` });
    console.log(`${t()} activity #${r.lastInsertRowid} ${lens} ${f}`);
  }, 1500);
  const tick2 = setInterval(() => {
    const { f, lens } = at(m++), spec = METRICS[lens][m % METRICS[lens].length];
    const v = pick(spec, `${f}|${lens}|${spec[0]}|live|${m}`);
    const r = insert(db, 'measurements', { run_id: id, feature: f, lens, metric: spec[0], value: v, unit: spec[1], method: spec[2], evidence: 'demo live reading', measured_at: t() });
    insert(db, 'activity', { run_id: id, at: t(), feature: f, lens, kind: 'measured', text: `measured ${spec[0]} = ${v} ${spec[1]} on ${f}` });
    console.log(`${t()} measurement #${r.lastInsertRowid} ${lens}.${spec[0]}=${v} ${f}`);
  }, 3000);
  const tick3 = setInterval(() => {
    // The first metric of this feature/lens with room to improve, moved about 30% of the way to its best end.
    const { f, lens } = at(p * 7 + 1), pid = `${id}-p${++p}`;
    let spec, delta;
    for (let k = 0; k < METRICS[lens].length && delta === undefined; k++) {
      spec = METRICS[lens][(p + k) % METRICS[lens].length];
      const last = db.prepare('SELECT value FROM measurements WHERE feature = ? AND lens = ? AND metric = ? ORDER BY measured_at DESC, id DESC LIMIT 1').get(f, lens, spec[0]);
      if (!last) continue;
      const room = UP.has(spec[0]) ? spec[4] - last.value : last.value - spec[3], step = Math.max(1, Math.round(room * 0.3));
      if (room >= 1) delta = (UP.has(spec[0]) ? 1 : -1) * Math.min(room, step);
    }
    if (delta === undefined) return;
    db.prepare("UPDATE runs SET phase = 'propose', updated_at = ? WHERE id = ?").run(t(), id);
    insert(db, 'proposals', { id: pid, run_id: id, feature: f, lens, metric: spec[0], title: `Improve ${spec[0]} on ${f}`, body: '## Summary\nA demo proposal from scan-demo --live.', standard: 'none', expected_delta: delta, size: 'S', risk: 1 + (p * 3) % 10, kind: 'fix', status: 'proposed', created_at: t(), updated_at: t() });
    insert(db, 'activity', { run_id: id, at: t(), feature: f, lens, kind: 'proposed', text: `proposed: improve ${spec[0]} on ${f}` });
    console.log(`${t()} proposal ${pid}`);
  }, 20000);
  const tick4 = setInterval(touch, 10000);
  const stop = () => {
    for (const x of [tick1, tick2, tick3, tick4]) clearInterval(x);
    db.prepare("UPDATE runs SET status = 'done', ended_at = ?, updated_at = ? WHERE id = ?").run(t(), t(), id);
    db.close();
    console.log(`${t()} run ${id} marked done`);
    process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(`live run ${id}: Ctrl-C to stop`);
}
