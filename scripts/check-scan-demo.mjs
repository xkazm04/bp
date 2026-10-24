// Checks that the demo live product (scripts/scan-demo.mjs) is a projection of the lens manifests and the Kettle map,
// never a second catalogue of its own: seeds it twice into throwaway dirs (--no-register, one fixed --now) and reads
// the stores back.
//   1  every reading's (lens, metric) is a metric field of that lens's manifest in the copied map, and its unit and
//      method are that field's unit and metric.method
//   2  the lenses with readings are exactly the map lenses that have metric fields and a numeric facet value
//   3  per lens, the measured features are exactly those whose facet carries a numeric value for a metric field
//   4  the latest run's reading of every (feature, lens, metric) equals the map's facet value, one for one, so the
//      live overlay (packages/core/src/model/live-health.ts) restates the health the map already shows
//   5  two seeds with the same --now dump runs, measurements, proposals and coverage byte-identically
//   6  GUARD (held before the change): every proposal's metric is a manifest metric of its lens with a latest reading
//      on its feature, and sign(expected_delta) follows metric.better; one baseline upgrade with two propagations
//   7  --no-register leaves <repo>/bp.products.local.json byte-identical (or absent). This check restores the file
//      if a seeder writes it anyway, so a red run never leaves user state behind.
// Run: node scripts/check-scan-demo.mjs   (exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REG = path.join(ROOT, 'bp.products.local.json');
const NOW = '2026-10-08T09:00:00Z';
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const short = (xs) => (xs.length > 6 ? `${xs.slice(0, 6).join('; ')} ... (${xs.length})` : xs.join('; '));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-scan-demo-'));
const regBefore = fs.existsSync(REG) ? fs.readFileSync(REG) : null;
const regRestore = () => {
  const now = fs.existsSync(REG) ? fs.readFileSync(REG) : null;
  const same = regBefore === null ? now === null : now !== null && regBefore.equals(now);
  if (!same) { if (regBefore === null) fs.rmSync(REG, { force: true }); else fs.writeFileSync(REG, regBefore); }
  return same;
};

const seed = (name) => {
  const dir = path.join(tmp, name);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/scan-demo.mjs'), '--dir', dir, '--reset', '--no-register', '--now', NOW], { cwd: ROOT, encoding: 'utf8' });
  const regSame = regRestore();
  return { dir, ok: r.status === 0, err: (r.stderr || '').trim().split('\n').slice(-3).join(' | '), regSame };
};
const dump = (db) => ['runs', 'measurements', 'proposals', 'coverage']
  .map((t) => t + '\n' + db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => JSON.stringify(r)).join('\n')).join('\n');

try {
  const one = seed('one'), two = seed('two');
  check('scan-demo seeds a throwaway dir (exit 0)', one.ok && two.ok, one.err || two.err);
  check('case 7: --no-register leaves bp.products.local.json byte-identical (or absent)', one.regSame && two.regSame);
  if (!one.ok || !two.ok) throw new Error('seeder failed; the store cases cannot run');

  const STORE = path.join(one.dir, '.ai', 'lens-scan');
  const map = JSON.parse(fs.readFileSync(path.join(STORE, 'app-structure.json'), 'utf8'));
  const fields = new Map(); // lens -> Map(key -> field), metric fields only
  for (const l of map.lenses) if (l.enabled !== false) fields.set(l.id, new Map((l.manifest?.fields ?? []).filter((f) => f.metric).map((f) => [f.key, f])));
  // The expectation, from the map: (feature, lens, metric) -> facet value, for every numeric metric value.
  const want = new Map();
  for (const f of map.features) for (const [lens, fs_] of fields) {
    const v = map.facets?.[f.slug]?.[lens]?.values;
    if (v) for (const key of fs_.keys()) if (typeof v[key] === 'number') want.set(`${f.slug}|${lens}|${key}`, v[key]);
  }
  const wantLenses = [...new Set([...want.keys()].map((k) => k.split('|')[1]))].sort();
  const featuresOf = (keys, lens) => [...new Set(keys.filter((k) => k.split('|')[1] === lens).map((k) => k.split('|')[0]))].sort();

  const db = new DatabaseSync(path.join(STORE, 'scan.db'), { readOnly: true });
  const rows = db.prepare('SELECT * FROM measurements').all();
  const latestRun = db.prepare("SELECT id FROM runs WHERE status = 'done' ORDER BY started_at DESC, rowid DESC LIMIT 1").get()?.id;

  // case 1
  const bad = [];
  for (const r of rows) {
    const f = fields.get(r.lens)?.get(r.metric);
    if (!f) { bad.push(`${r.lens}.${r.metric} is not a manifest metric field`); continue; }
    if ((r.unit ?? null) !== (f.unit ?? null)) bad.push(`${r.lens}.${r.metric} unit ${r.unit} vs ${f.unit}`);
    if (r.method !== f.metric.method) bad.push(`${r.lens}.${r.metric} method ${r.method} vs ${f.metric.method}`);
  }
  const badKeys = [...new Set(bad)];
  check('case 1: every reading is a manifest metric field with its unit and method (0 mismatches)', rows.length > 0 && badKeys.length === 0, rows.length ? short(badKeys) : 'no readings');

  // cases 2-3 read the scan's readings: a phased row is a release-train item's evidence, not the feature's state
  const scan = rows.filter((r) => r.phase === null);
  // case 2
  const gotLenses = [...new Set(scan.map((r) => r.lens))].sort();
  check('case 2: the lenses with readings are the map lenses with metric facet values', gotLenses.join() === wantLenses.join(), `got ${gotLenses} want ${wantLenses}`);

  // case 3
  const gotKeys = scan.map((r) => `${r.feature}|${r.lens}|${r.metric}`);
  const miss3 = wantLenses.filter((l) => featuresOf(gotKeys, l).join() !== featuresOf([...want.keys()], l).join())
    .map((l) => `${l}: got ${featuresOf(gotKeys, l).length} want ${featuresOf([...want.keys()], l).length}`);
  check('case 3: per lens, the measured features are those whose facet carries a metric value', miss3.length === 0, short(miss3));

  // case 4
  const latest = new Map(rows.filter((r) => r.run_id === latestRun).map((r) => [`${r.feature}|${r.lens}|${r.metric}`, r.value]));
  const miss4 = [];
  for (const [k, v] of want) if (latest.get(k) !== v) miss4.push(`${k} reads ${latest.get(k)} vs facet ${v}`);
  for (const k of latest.keys()) if (!want.has(k)) miss4.push(`${k} read but the map has no value`);
  check('case 4: the latest run reads exactly the facet value of every (feature, lens, metric)', !!latestRun && miss4.length === 0, short(miss4));

  // case 5
  const db2 = new DatabaseSync(path.join(two.dir, '.ai', 'lens-scan', 'scan.db'), { readOnly: true });
  const d1 = dump(db), d2 = dump(db2);
  db2.close();
  check('case 5: two seeds with the same --now dump byte-identical', d1 === d2, `${d1.length} vs ${d2.length} chars`);

  // case 6 (GUARD)
  const props = db.prepare('SELECT * FROM proposals WHERE pack_id IS NULL').all(); // the scan's; the train's are check-scan-demo-train's
  const last = db.prepare('SELECT value FROM measurements WHERE feature = ? AND lens = ? AND metric = ? ORDER BY measured_at DESC, id DESC LIMIT 1');
  const bad6 = [];
  for (const p of props) {
    const f = fields.get(p.lens)?.get(p.metric);
    if (!f) { bad6.push(`${p.id}: ${p.lens}.${p.metric} is not a manifest metric`); continue; }
    if (!last.get(p.feature, p.lens, p.metric)) bad6.push(`${p.id}: no reading of ${p.metric} on ${p.feature}`);
    if (Math.sign(p.expected_delta) !== (f.metric.better === 'up' ? 1 : -1)) bad6.push(`${p.id}: delta ${p.expected_delta} against better ${f.metric.better}`);
  }
  const base = props.filter((p) => p.kind === 'baseline-upgrade');
  const kids = props.filter((p) => p.kind === 'propagation' && base[0] && p.parent_id === base[0].id);
  check('case 6 (guard): every proposal rests on a manifest metric reading and moves it the better way', props.length === 7 && bad6.length === 0, `${props.length} proposals; ${short(bad6)}`);
  check('case 6 (guard): one baseline upgrade with two propagation children', base.length === 1 && kids.length === 2, `${base.length} / ${kids.length}`);
  db.close();
} catch (e) {
  check('scan-demo check ran to the end', false, e.message);
} finally {
  regRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`check-scan-demo: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
