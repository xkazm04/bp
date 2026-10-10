// Checks the lens-scan store's wire convention (docs/blueprint-ui.md, "Wire convention" and "SSE
// semantics") against src/lib/scan/store.server.ts on a throwaway store built from the real DDL:
//   - JSON columns arrive parsed and in their declared shape: `runs.lenses` a string[], `runs.scope` and
//     `shots.report` an object or absent, whatever text the writer left in them;
//   - the JSON never contains `null`;
//   - a run row in any of those states does not break the swarm feed (`swarmFromScan`);
//   - the stream cursor resends nothing after `advance`, and a row that ties on the cursor's timestamp
//     is sent exactly once.
// Run: node scripts/check-scan-wire.ts  (Node's type stripping; no build step). Exit 1 on any failure.
// The store lives in the OS temp dir and is removed on exit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { advance, close, newCursor, openRead, readDelta, readSnapshot, snapshotOf } from '../src/lib/scan/store.server.ts';
import { swarmFromScan } from '../src/lib/scan/client.ts';
import type { ScanSnapshot } from '../src/lib/scan/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-scan-wire-'));
const file = path.join(dir, 'scan.db');
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); }
};

try {
  const w = new DatabaseSync(file);
  w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
  const T = '2026-10-10T10:00:00Z';
  // [id, lenses text, scope text] - what a writer can leave in the JSON columns.
  const runs: [string, string, string | null][] = [
    ['r-ok', '["dev","sec"]', '{"group":"Core"}'],
    ['r-text', 'not json', 'not json'],
    ['r-object', '{"dev":1}', '[1,2]'],
    ['r-null', 'null', 'null'],
    ['r-mixed', '["dev",2,null]', null],
  ];
  const ins = w.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses, scope) VALUES (?, ?, ?, 'measure', 'running', ?, ?)");
  runs.forEach(([id, lenses, scope], i) => ins.run(id, `2026-10-10T0${i}:00:00Z`, T, lenses, scope));
  const shot = w.prepare("INSERT INTO shots (run_id, feature, path, captured_at, report) VALUES ('r-ok', 'f1', ?, ?, ?)");
  shot.run('shots/f1/a.png', T, '{"consoleErrors":2}');
  shot.run('shots/f1/b.png', T, 'not json');
  shot.run('shots/f1/c.png', T, 'null');
  w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES ('p1', 'r-ok', 'f1', 'dev', 'Fix it', 'fix', 'proposed', ?, ?)").run(T, T);
  w.prepare("INSERT INTO measurements (run_id, feature, lens, metric, value, measured_at) VALUES ('r-ok', 'f1', 'dev', 'cov', 50, ?)").run(T);

  // ---- wire shape
  const s: ScanSnapshot = snapshotOf(file);
  const byId = new Map(s.runs.map((r) => [r.id, r]));
  const nulls: string[] = [];
  for (const [t, rows] of Object.entries(s)) for (const r of rows as Record<string, unknown>[]) for (const [k, v] of Object.entries(r)) if (v === null) nulls.push(`${t}.${k}`);
  check('the JSON never contains null', nulls.length === 0, nulls.join(', '));
  for (const [id] of runs) {
    const l = byId.get(id)?.lenses as unknown;
    check(`runs.lenses is a string[] (${id})`, Array.isArray(l) && l.every((x) => typeof x === 'string'), JSON.stringify(l));
    const sc = byId.get(id)?.scope as unknown;
    check(`runs.scope is an object or absent (${id})`, sc === undefined || (typeof sc === 'object' && sc !== null && !Array.isArray(sc)), JSON.stringify(sc));
  }
  check('a well-formed lenses column is unchanged', JSON.stringify(byId.get('r-ok')?.lenses) === '["dev","sec"]');
  check('a mixed lenses column keeps its strings', JSON.stringify(byId.get('r-mixed')?.lenses) === '["dev"]', JSON.stringify(byId.get('r-mixed')?.lenses));
  for (const sh of s.shots) {
    const rep = sh.report as unknown;
    check(`shots.report is an object or absent (${sh.path})`, rep === undefined || (typeof rep === 'object' && rep !== null && !Array.isArray(rep)), JSON.stringify(rep));
  }
  // ---- consumers: every malformed run as the latest run
  for (const [id] of runs) {
    const only: ScanSnapshot = { ...s, runs: s.runs.filter((r) => r.id === id) };
    let err = '';
    try { swarmFromScan(only, ['f1']); } catch (e) { err = (e as Error).message; }
    check(`swarmFromScan survives run ${id}`, !err, err);
  }

  // ---- stream cursor
  const db = openRead(file);
  if (!db) throw new Error('openRead returned null for an existing store');
  try {
    const cur = newCursor();
    advance(cur, readSnapshot(db));
    const d0 = readDelta(db, cur);
    check('nothing is resent after advance', Object.values(d0).every((xs) => xs.length === 0), JSON.stringify(d0).slice(0, 200));
    w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) VALUES ('p2', 'r-ok', 'f1', 'dev', 'Tie', 'fix', 'proposed', ?, ?)").run(T, T);
    w.prepare("INSERT INTO measurements (run_id, feature, lens, metric, value, measured_at) VALUES ('r-ok', 'f1', 'dev', 'cov', 60, ?)").run(T);
    const d1 = readDelta(db, cur);
    check('a row tying on the cursor timestamp is sent once', d1.proposals.length === 1 && d1.proposals[0].id === 'p2', JSON.stringify(d1.proposals.map((p) => p.id)));
    check('a new append-only row is sent', d1.measurements.length === 1 && d1.measurements[0].value === 60);
    advance(cur, d1);
    const d2 = readDelta(db, cur);
    check('and not again', Object.values(d2).every((xs) => xs.length === 0));
  } finally { close(db); }
  w.close();
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`scan wire: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
