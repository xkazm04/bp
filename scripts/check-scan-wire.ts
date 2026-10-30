// Checks the lens-scan store's wire convention (docs/blueprint-ui.md, "Wire convention" and "SSE
// semantics") against src/lib/scan/store.server.ts on a throwaway store built from the real DDL:
//   - JSON columns arrive parsed and in their declared shape: `runs.lenses` a string[], `runs.scope` and
//     `shots.report` an object or absent, whatever text the writer left in them;
//   - the JSON never contains `null`;
//   - a run row in any of those states does not break the swarm feed (`swarmFromScan`);
//   - swarm progress is measured against the run's scope, and an unscoped run derives what a brute-force pass does;
//   - the stream cursor resends nothing after `advance`, and a row that ties on the cursor's timestamp
//     is sent exactly once;
//   - v2: packs and releases reach the snapshot and the delta (by updated_at, like proposals), measurements carry their
//     proposal/phase/commit, and a v1 store (no v2 tables or columns) reads them empty without an error;
//   - v4: a ranked, imported row carries tier, risk_class, origin, external_ref/url, ranked_by/at; a scan row omits
//     origin ('scan' is the absent value) and every NULL v4 column; a v3 store (no v4 columns) reads the same way;
//     the train's wire door takes the v4 keys and refuses a bad one; the review queue orders by tier first;
//   - v5 (scan-finding/1): the finding keys (score stored, never recomputed; score_parts/proof parsed; band 'ranked' and mvp 0
//     omitted), trust_events in the snapshot and the delta, trust levels (latest to_level, else the start, capped), the veto
//     CAS (store.server.ts veto) and its refusals, the wire door's v5 keys, one score (stored, est., unscored; never 0) and a
//     v4 store (no v5 columns, no trust_events) reading with none of it.
// Run: node scripts/check-scan-wire.ts  (Node's type stripping; no build step). Exit 1 on any failure.
// The store lives in the OS temp dir and is removed on exit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { advance, close, newCursor, openRead, parseDecision, parseVeto, readDelta, readSnapshot, snapshotOf, veto } from '../packages/core/src/server/store.server.ts';
import { byWorth, estValue, worthOf, worthText } from '../packages/core/src/scan/score.ts';
import { ceilingOf, startOf, trustSlices, vetoable } from '../packages/core/src/scan/trust.ts';
import { swarmFromScan } from '../apps/web/src/lib/scan/client.ts';
import { latestReading } from '../packages/core/src/scan/derive.ts';
import { scopeFeatures } from '../packages/core/src/scan/scope.ts';
import { blankComments } from './lib/source.ts';
import { parseReleaseCreated } from '../packages/core/src/train/wire.ts';
import { PRODUCTS_FILE, listProducts } from '../packages/core/src/server/products.server.ts';
import type { Measurement, Proposal, Run, ScanSnapshot } from '../packages/core/src/scan/types.ts';

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

  // ---- swarm derivation: scoped progress, and the indexed pass equals a brute-force one on an unscoped run
  {
    const feats = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, domain: i < 2 ? 'Pay' : 'Ops', capability: 'cap-' + id }));
    const mk = (i: number, feature: string, value: number, at: string, run = 'rs'): Measurement => ({ id: i, run_id: run, feature, lens: 'dev', metric: 'cov', value, unit: '%', measured_at: at });
    const run = (scope?: Record<string, unknown>): Run => ({ id: 'rs', started_at: '2026-10-11T00:00:00Z', updated_at: T, phase: 'measure', status: 'running', lenses: ['dev'], ...(scope ? { scope } : {}) });
    const prop = (id: string, feature: string): Proposal => ({ id, run_id: 'rs', feature, lens: 'dev', metric: 'cov', title: id, standard: 'none', expected_delta: 5, kind: 'fix', status: 'proposed', created_at: T, updated_at: T });
    const base: ScanSnapshot = { ...s, runs: [], activity: [], shots: [], coverage: [],
      measurements: [mk(1, 'a', 10, '2026-10-11T01:00:00Z'), mk(2, 'a', 20, '2026-10-11T02:00:00Z'), mk(3, 'b', 30, '2026-10-11T01:00:00Z'), mk(4, 'b', 31, '2026-10-11T01:00:00Z'), mk(5, 'c', 5, '2026-10-11T01:00:00Z')],
      proposals: [prop('pa', 'a'), prop('pb', 'b'), prop('pd', 'd')] };
    const pct = (sc?: ScanSnapshot) => swarmFromScan(sc!, feats).agents[0].progressPct;
    check('unscoped progress is against every feature (3 of 4 measured)', pct({ ...base, runs: [run()] }) === 75, String(pct({ ...base, runs: [run()] })));
    check('scoped progress is against the scope (1 of 2: group Pay measures a, b)', pct({ ...base, runs: [run({ group: 'pay' })], measurements: base.measurements.filter((m) => m.feature === 'a') }) === 50);
    check('a scope that names nothing falls back to every feature', pct({ ...base, runs: [run({ group: 'nope' })] }) === 75);
    // brute force: the pre-index derivation, copied - with the tie on measured_at broken by id, the rule
    // track.ts's `latest` and compare.ts's byMeasure both use, so this cross-check cannot mirror a weaker one.
    const brute = (p: Proposal) => { let last: Measurement | undefined; for (const m of base.measurements) if (m.feature === p.feature && m.lens === p.lens && m.metric === p.metric && (!last || m.measured_at > last.measured_at || (m.measured_at === last.measured_at && m.id > last.id))) last = m; return last; };
    const sw = swarmFromScan({ ...base, runs: [run()] }, feats);
    const f = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
    for (const p of base.proposals) {
      const l = brute(p), want = l ? `cov: ${f(l.value)} → ${f(l.value + 5)} % (+5 %)` : 'cov +5';
      check(`proposal ${p.id}: the indexed consequence equals the brute-force one`, sw.decisions.find((d) => d.id === p.id)?.options[0].consequence === want, want);
    }
    check('the agent counts the distinct features it measured', sw.agents[0].doneToday === new Set(base.measurements.filter((m) => m.run_id === 'rs' && m.lens === 'dev').map((m) => m.feature)).size);
    // A tie on measured_at goes to the highest id - the rule track.ts's `latest` and compare.ts's byMeasure
    // apply - so the answer does not depend on the order the caller happened to hold the rows in. Measured
    // 2026-10-21 before this pair landed: the same three tied rows read 30 ascending and 10 reversed.
    const tied: Measurement[] = [mk(11, 'a', 10, '2026-10-12T00:00:00Z'), mk(12, 'a', 20, '2026-10-12T00:00:00Z'), mk(13, 'a', 30, '2026-10-12T00:00:00Z')];
    const readId = (ms: Measurement[]) => latestReading({ measurements: ms }, 'a', 'dev', 'cov')?.id;
    check('latestReading breaks a tie on measured_at by id', readId(tied) === 13, String(readId(tied)));
    check('latestReading answers the same on the same rows reversed', readId([...tied].reverse()) === 13, String(readId([...tied].reverse())));
    // `runs.lenses` is a store JSON column filtered to strings, so it can repeat one: one squad and one agent
    // per DISTINCT lens, or the canvas gets two rows keyed `scan-dev` and two agents keyed `scan-dev.1`.
    const dup = swarmFromScan({ ...base, runs: [{ ...run(), lenses: ['dev', 'dev', 'sec'] }] }, feats);
    check('a run naming one lens twice draws it once', dup.squads.length === 2 && dup.agents.length === 2
      && new Set(dup.agents.map((a) => a.id)).size === 2 && new Set(dup.squads.map((sq) => sq.id)).size === 2,
      JSON.stringify({ squads: dup.squads.map((sq) => sq.id), agents: dup.agents.map((a) => a.id) }));
  }

  // ---- scope.features is a list of ids: the reader drops anything else, so the demo writer must write a list
  {
    const ids = ['a', 'b', 'c', 'd'].map((id) => ({ id, domain: 'D', capability: 'c-' + id }));
    check('scope.features as a list of ids names those features', scopeFeatures({ scope: { features: ['a', 'c'] } }, ids).map((f) => f.id).join() === 'a,c');
    check('scope.features as a count is dropped: every feature (the shape scan-demo used to write)', scopeFeatures({ scope: { features: 2, sample: 'kettle' } }, ids).length === 4);
    // every `scope: { ... }` literal scan-demo.mjs writes, enumerated from its source (comments blanked): none may carry a count
    const demo = blankComments(fs.readFileSync(path.join(ROOT, 'scripts/scan-demo.mjs'), 'utf8'));
    const scopes = [...demo.matchAll(/scope:\s*\{([^}]*)\}/g)].map((m) => m[1]);
    check('scan-demo.mjs writes run scopes (the matcher still bites)', scopes.length >= 2, String(scopes.length));
    for (const sc of scopes) check('scan-demo.mjs writes scope.features as the list of ids, not a count', /(^|\W)features:\s*FEATURES\s*(,|$)/.test(sc), sc.trim());
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

  // ---- v2: packs and releases reach the snapshot and the stream with the same change detection; a v1 store reads them empty
  {
    const db2 = openRead(file);
    if (!db2) throw new Error('openRead returned null for an existing store');
    try {
      const cur = newCursor();
      advance(cur, readSnapshot(db2));
      w.prepare("INSERT INTO packs (id, lens, n, branch, base_ref, base_sha, status, created_at, updated_at) VALUES ('k-dev-1', 'dev', 1, 'pack/dev-1', 'main', 'abc', 'open', ?, ?)").run(T, T);
      w.prepare("INSERT INTO releases (id, version, branch, status, created_at, updated_at) VALUES ('rel-1.0.0', '1.0.0', 'release/1.0.0', 'draft', ?, ?)").run(T, T);
      const d1 = readDelta(db2, cur);
      check('v2: a new pack and a new release arrive in a delta', d1.packs.length === 1 && d1.packs[0].id === 'k-dev-1' && d1.releases.length === 1 && d1.releases[0].status === 'draft', JSON.stringify({ k: d1.packs, r: d1.releases }));
      check('v2: absent release columns are omitted, never null', !('pr_url' in d1.releases[0]) && !('run_id' in d1.packs[0]) && !JSON.stringify(d1).includes('null'));
      advance(cur, d1);
      check('v2: and not again', readDelta(db2, cur).packs.length === 0 && readDelta(db2, cur).releases.length === 0);
      const T2 = '2026-10-10T11:00:00Z';
      w.prepare("UPDATE packs SET status = 'triaged', updated_at = ? WHERE id = 'k-dev-1'").run(T2);
      w.prepare("UPDATE releases SET status = 'building', updated_at = ? WHERE id = 'rel-1.0.0'").run(T2);
      const d2 = readDelta(db2, cur);
      check('v2: a pack or release moving on is resent by its updated_at', d2.packs[0]?.status === 'triaged' && d2.releases[0]?.status === 'building', JSON.stringify({ k: d2.packs, r: d2.releases }));
      w.prepare("INSERT INTO measurements (run_id, feature, lens, metric, value, measured_at, proposal_id, phase, commit_sha) VALUES ('r-ok', 'f1', 'dev', 'cov', 70, ?, 'p1', 'after', 'deadbeef')").run(T2);
      const after = readDelta(db2, cur).measurements.find((m) => m.phase === 'after');
      check('v2: a measurement carries proposal_id, phase and commit_sha', after?.proposal_id === 'p1' && after.commit_sha === 'deadbeef', JSON.stringify(after));
      const snap = snapshotOf(file);
      check('v2: the snapshot holds packs and releases', snap.packs.length === 1 && snap.releases.length === 1);
    } finally { close(db2); }

    // a v1 store: no packs or releases tables, no v2 columns
    const v1 = path.join(dir, 'v1.db'), w1 = new DatabaseSync(v1);
    w1.exec(`PRAGMA user_version = 1;
      CREATE TABLE runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT, phase TEXT NOT NULL, status TEXT NOT NULL, lenses TEXT NOT NULL, scope TEXT, skill_version TEXT, model TEXT, note TEXT);
      CREATE TABLE measurements (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, feature TEXT NOT NULL, lens TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT, method TEXT, evidence TEXT, measured_at TEXT NOT NULL);
      CREATE TABLE proposals (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, feature TEXT NOT NULL, lens TEXT NOT NULL, metric TEXT, title TEXT NOT NULL, body TEXT, standard TEXT NOT NULL DEFAULT 'none', expected_delta REAL, size TEXT, risk INTEGER, kind TEXT NOT NULL, parent_id TEXT, status TEXT NOT NULL, decided_by TEXT, decided_at TEXT, decision_note TEXT, after_value REAL, result_sha TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE activity (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, at TEXT NOT NULL, feature TEXT, lens TEXT, kind TEXT NOT NULL, text TEXT NOT NULL);
      CREATE TABLE shots (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, feature TEXT NOT NULL, path TEXT NOT NULL, size TEXT, theme TEXT, harness_module TEXT, captured_at TEXT NOT NULL, report TEXT);
      CREATE TABLE coverage (feature TEXT NOT NULL, standard TEXT NOT NULL, state TEXT NOT NULL, evidence TEXT, judged_at TEXT NOT NULL, run_id TEXT, PRIMARY KEY (feature, standard));`);
    w1.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r1', ?, ?, 'measure', 'done', '[]')").run(T, T);
    w1.prepare("INSERT INTO measurements (run_id, feature, lens, metric, value, measured_at) VALUES ('r1', 'f1', 'dev', 'cov', 5, ?)").run(T);
    w1.close();
    let s1: ScanSnapshot | undefined, err = '';
    try { s1 = snapshotOf(v1); } catch (e) { err = (e as Error).message; }
    check('v1 store: a snapshot, packs and releases empty, never an error', !err && s1?.packs.length === 0 && s1.releases.length === 0 && s1.runs.length === 1 && s1.measurements.length === 1, err);
    const r1 = openRead(v1);
    try {
      const c1 = newCursor();
      advance(c1, readSnapshot(r1!));
      const d = readDelta(r1!, c1);
      check('v1 store: a delta reads with the v2 tables absent', d.packs.length === 0 && d.releases.length === 0);
    } finally { close(r1); }
  }

  // ---- v4: tier, risk class, origin and the external ref on the wire; omitted when absent; a v3 store reads
  {
    const T4 = '2026-10-12T10:00:00Z';
    w.prepare(`INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at, origin, external_ref, external_url, tier, risk_class, ranked_by, ranked_at)
      VALUES ('w1', 'r-ok', 'f1', 'quality', 'Login 500s', 'work-item', 'proposed', ?, ?, 'ado', 'ado:1234', 'https://dev.azure.com/o/p/_workitems/edit/1234', 0, 'authz', 'user:triager', ?)`).run(T4, T4, T4);
    w.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at, tier) VALUES ('w2', 'r-ok', 'f1', 'dev', 'Ranked scan item', 'fix', 'proposed', ?, ?, 3)").run(T4, T4);
    const s4 = snapshotOf(file), w1 = s4.proposals.find((p) => p.id === 'w1'), w2 = s4.proposals.find((p) => p.id === 'w2'), p1 = s4.proposals.find((p) => p.id === 'p1');
    check('v4: an imported, ranked row carries its v4 keys', w1?.origin === 'ado' && w1.external_ref === 'ado:1234' && w1.external_url?.endsWith('/1234') === true && w1.tier === 0 && w1.risk_class === 'authz'
      && w1.ranked_by === 'user:triager' && w1.ranked_at === T4 && w1.kind === 'work-item', JSON.stringify(w1));
    check('v4: a scan row omits origin and its NULL v4 columns', !!p1 && !['origin', 'external_ref', 'external_url', 'tier', 'risk_class', 'ranked_by', 'ranked_at'].some((k) => k in p1), JSON.stringify(p1));
    check('v4: tier 3 without a risk class keeps tier, omits the rest', w2?.tier === 3 && !('risk_class' in w2) && !('origin' in w2), JSON.stringify(w2));
    check('v4: still no null anywhere', s4.proposals.every((p) => Object.values(p).every((v) => v !== null)));
    // the train's door (wire.ts): the v4 keys pass, 'scan' stays out, a bad tier or class is refused
    const rel = (items: unknown[]) => parseReleaseCreated({ release: { id: 'rel', version: '1', branch: 'b', status: 'draft', created_at: T4, updated_at: T4, items }, added: [], skipped: [] });
    const ok = rel([w1, { ...p1, origin: 'scan' }]), sorted = (o: object) => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
    check('v4: the wire door keeps the v4 keys and drops origin scan', ok.ok && sorted(ok.value.release.items[0]) === sorted(w1!) && !('origin' in ok.value.release.items[1]), JSON.stringify(ok));
    for (const [k, v] of [['tier', 4], ['tier', 1.5], ['tier', '1'], ['risk_class', 'security'], ['origin', 'jira']] as const) {
      const bad = rel([{ ...w1, [k]: v }]);
      check(`v4: the wire door refuses ${k} ${JSON.stringify(v)}`, !bad.ok && bad.error.includes(k), JSON.stringify(bad));
    }
    // the review queue: tier first (untriaged after 3), then oldest first
    const q = (ps: Proposal[]) => swarmFromScan({ ...s4, proposals: ps }, ['f1']).decisions.map((d) => d.id).join(',');
    const pp = (id: string, at: string, tier?: 0 | 1 | 2 | 3): Proposal => ({ id, run_id: 'r-ok', feature: 'f1', lens: 'dev', title: id, standard: 'none', kind: 'fix', status: 'proposed', created_at: at, updated_at: at, ...(tier !== undefined ? { tier } : {}) });
    const untriaged = [pp('a', '2026-01-03'), pp('b', '2026-01-01'), pp('c', '2026-01-02')];
    check('queue: all untriaged keeps the oldest-first order', q(untriaged) === 'b,c,a', q(untriaged));
    const mixed = [pp('a', '2026-01-01'), pp('b', '2026-01-02', 3), pp('c', '2026-01-03', 0), pp('d', '2026-01-04', 0), pp('e', '2026-01-05', 1)];
    check('queue: tier ascending, untriaged last, oldest first within a tier', q(mixed) === 'c,d,e,b,a', q(mixed));
    check('queue: a decision carries its tier', swarmFromScan({ ...s4, proposals: mixed }, ['f1']).decisions[0].tier === 0);

    // a v3 store: the real DDL with proposals rebuilt without the v4 columns (and their indexes), user_version 3
    const v3 = path.join(dir, 'v3.db'), w3 = new DatabaseSync(v3);
    w3.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
    const V4 = new Set(['origin', 'external_ref', 'external_url', 'tier', 'risk_class', 'ranked_by', 'ranked_at']);
    const cols = (w3.prepare('PRAGMA table_info(proposals)').all() as { name: string }[]).map((c) => c.name).filter((c) => !V4.has(c));
    w3.exec(`DROP INDEX proposals_external_ref; DROP INDEX proposals_tier; ALTER TABLE proposals RENAME TO p4;
      CREATE TABLE proposals AS SELECT ${cols.join(', ')} FROM p4; DROP TABLE p4; PRAGMA user_version = 3;`);
    w3.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r3', ?, ?, 'measure', 'done', '[]')").run(T4, T4);
    w3.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, standard, kind, status, created_at, updated_at, triaged_from) VALUES ('q3', 'r3', 'f1', 'dev', 'Old', 'none', 'fix', 'accepted', ?, ?, 'done')").run(T4, T4);
    w3.close();
    let s3: ScanSnapshot | undefined, err3 = '';
    try { s3 = snapshotOf(v3); } catch (e) { err3 = (e as Error).message; }
    const q3 = s3?.proposals[0];
    check('v3 store: reads without an error, no v4 key on its rows', !err3 && q3?.id === 'q3' && q3.triaged_from === 'done' && ![...V4].some((k) => k in q3), err3 || JSON.stringify(q3));
    const r3 = openRead(v3);
    try {
      const c3 = newCursor(); advance(c3, readSnapshot(r3!));
      check('v3 store: a delta reads too', readDelta(r3!, c3).proposals.length === 0);
    } finally { close(r3); }
  }

  // ---- v5 (scan-finding/1): the finding fields, the trust ledger, the veto CAS; a v4 store reads with none of it
  {
    const T5 = '2026-10-29T10:00:00Z', FUTURE = '2999-01-01T00:00:00Z', PAST = '2000-01-01T00:00:00Z';
    const V5 = ['impact', 'impact_why', 'confidence', 'effort', 'score', 'score_parts', 'band', 'mvp', 'mvp_rule', 'mvp_why', 'category',
      'predicted_verdict', 'predicted_why', 'predicted_by', 'predicted_at', 'veto_until', 'proof'];
    const ins = w.prepare(`INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at, decided_by, impact, impact_why, confidence, effort, score,
      score_parts, band, mvp, mvp_rule, mvp_why, category, predicted_verdict, predicted_why, predicted_by, predicted_at, veto_until, proof, triaged_from)
      VALUES (?, 'r-ok', 'f1', 'dev', ?, 'fix', ?, ?, ?, ?, 8, 'a crash on the main path', 'medium', 4, 40.5, ?, ?, ?, ?, ?, 'technical', 'accept', 'like p-7', 'lens-scan@3.0:opus', ?, ?, ?, ?)`);
    const parts = JSON.stringify({ impact: 8, confidence_w: 0.75, effort_div: 1.333, risk_factor: 0.9, formula: 'scan-score/1' });
    const proofJ = JSON.stringify({ metric: 'bundleKb', method: 'static', unit: 'KB', before: 412, after: 300, verdict: 'better', control: 'red', base_sha: 'a1', head_sha: 'b2' });
    ins.run('v5a', 'Scored MVP', 'proposed', T5, T5, null, parts, 'reserve', 1, 'override', 'the cheaper fix first', T5, null, proofJ, null);
    ins.run('v5b', 'Machine approved', 'approved', T5, T5, 'machine:lens-scan', 'not json', 'ranked', 0, null, null, T5, FUTURE, '[1,2]', 'done');
    ins.run('v5c', 'Machine, window passed', 'approved', T5, T5, 'machine:lens-scan', null, 'ranked', 0, null, null, T5, PAST, null, null);
    ins.run('v5d', 'A person decided', 'approved', T5, T5, 'user:octocat', null, 'ranked', 0, null, null, T5, FUTURE, null, null);
    const s5 = snapshotOf(file), a = s5.proposals.find((p) => p.id === 'v5a'), b = s5.proposals.find((p) => p.id === 'v5b'), p1 = s5.proposals.find((p) => p.id === 'p1');
    check('v5: a scored row carries its finding keys (score stored, never recomputed)', a?.score === 40.5 && a.impact === 8 && a.confidence === 'medium' && a.effort === 4 && a.category === 'technical'
      && a.predicted_verdict === 'accept' && a.predicted_by === 'lens-scan@3.0:opus' && a.mvp === true && a.mvp_rule === 'override' && a.mvp_why === 'the cheaper fix first', JSON.stringify(a));
    check('v5: score_parts and proof arrive parsed objects', a?.score_parts?.formula === 'scan-score/1' && a.score_parts.effort_div === 1.333 && a.proof?.verdict === 'better' && a.proof.control === 'red' && a.proof.before === 412, JSON.stringify(a));
    check('v5: band reserve is sent; ranked (the default) and mvp 0 are omitted', a?.band === 'reserve' && !!b && !('band' in b) && !('mvp' in b), JSON.stringify(b));
    check('v5: malformed or non-object JSON columns are omitted, never raw text', !!b && !('score_parts' in b) && !('proof' in b), JSON.stringify(b));
    check('v5: a pre-v5-shaped row (all v5 columns NULL or default) carries no v5 key', !!p1 && !V5.some((k) => k in p1), JSON.stringify(p1));
    check('v5: still no null anywhere', s5.proposals.every((p) => Object.values(p).every((v) => v !== null)));

    // the trust ledger: snapshot, then the delta by id
    const te = w.prepare('INSERT INTO trust_events (at, slice, from_level, to_level, reason, agreement, n, item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    te.run(T5, 'technical|dev|perf|S', 2, 3, 'promote: agreement', 0.95, 20, null);
    te.run(T5, 'product|design|ux|M', 1, 0, 'demote: reversal v5a', null, null, 'v5a');
    const rt = openRead(file);
    try {
      const st = readSnapshot(rt!), ct = newCursor();
      check('v5: trust_events reach the snapshot, oldest first, absent values omitted', st.trust_events?.length === 2 && st.trust_events[0].to_level === 3 && st.trust_events[0].agreement === 0.95
        && st.trust_events[1].item_id === 'v5a' && !('agreement' in st.trust_events[1]), JSON.stringify(st.trust_events));
      advance(ct, st);
      check('v5: after advance the delta resends no trust event', (readDelta(rt!, ct).trust_events ?? []).length === 0);
      te.run(T5, 'technical|dev|perf|S', 3, 2, 'demote: not-better v5a', null, null, 'v5a');
      const dt = readDelta(rt!, ct);
      check('v5: a new trust event arrives in the delta, once', dt.trust_events?.length === 1 && dt.trust_events[0].from_level === 3);
    } finally { close(rt); }
    const ts = trustSlices(snapshotOf(file).trust_events ?? [], [...s5.proposals, { ...a!, id: 'z', category: 'technical', lens: 'sec', risk_class: 'secret', size: 'XS' }]);
    const lv = (k: string) => ts.find((x) => x.slice === k);
    check('v5 trust: a slice\'s level is its latest event\'s to_level', lv('technical|dev|perf|S')?.level === 2 && lv('technical|dev|perf|S')?.from === 'event');
    check('v5 trust: a slice with no event sits at its start (technical 2), capped at 1 for secret/authz/money', lv('technical|sec|secret|XS')?.level === 1 && lv('technical|sec|secret|XS')?.from === 'start' && lv('technical|sec|secret|XS')?.ceiling === 1, JSON.stringify(ts));
    check('v5 trust: product starts at 0', startOf('product|design|-|-') === 0 && startOf('technical|dev|-|-') === 2 && startOf('technical|x|authz|S') === 1);
    check('v5 trust: a product slice (or no category) is capped at L1; only technical reaches L3', ceilingOf('product|design|ux|S') === 1 && ceilingOf('-|dev|-|-') === 1 && ceilingOf('technical|dev|perf|S') === 3);
    check('decide: a person\'s note may never open with `veto:` (that prefix is the veto\'s alone)', parseDecision({ decision: 'decline', note: 'veto: no' }) === null && parseDecision({ decision: 'approve', note: ' VETO:x' }) === null
      && parseDecision({ decision: 'decline', note: 'not a veto: fine' })?.note === 'not a veto: fine');

    // the veto: the CAS beside decide (status back to proposed, triaged_from kept, decision_note 'veto: <reason>')
    const v = veto(file, 'v5b', { reason: 'wrong fix' }, 'user:octocat', T5);
    check('veto: a machine decision inside its window goes back to proposed, signed by the person', v.ok && v.proposal.status === 'proposed' && v.proposal.decision_note === 'veto: wrong fix'
      && v.proposal.decided_by === 'user:octocat' && v.proposal.triaged_from === 'done' && !('veto_until' in v.proposal) && v.proposal.predicted_verdict === 'accept', JSON.stringify(v));
    const again = veto(file, 'v5b', { reason: 'twice' }, 'user:octocat', T5), late = veto(file, 'v5c', { reason: 'late' }, 'user:octocat', T5), human = veto(file, 'v5d', { reason: 'x' }, 'user:octocat', T5);
    check('veto: refused 409 when vetoed already, the window passed, or a person decided', !again.ok && again.status === 409 && !late.ok && late.status === 409 && !human.ok && human.status === 409);
    const none = veto(file, 'nope', { reason: 'x' }, 'user:octocat', T5);
    check('veto: an unknown proposal is 404', !none.ok && none.status === 404);
    check('veto: the body is { reason } (1..500 chars) and nothing else', parseVeto({ reason: ' ok ' })?.reason === 'ok' && parseVeto({}) === null && parseVeto({ reason: '' }) === null
      && parseVeto({ reason: 'x'.repeat(501) }) === null && parseVeto({ reason: 'x', more: 1 }) === null);
    check('veto: vetoable() is the CAS rule', vetoable({ status: 'approved', decided_by: 'machine:lens-scan', veto_until: FUTURE }, T5) && !vetoable({ status: 'approved', decided_by: 'machine:lens-scan', veto_until: PAST }, T5)
      && !vetoable({ status: 'executing', decided_by: 'machine:lens-scan', veto_until: FUTURE }, T5) && !vetoable({ status: 'declined', decided_by: 'user:x', veto_until: FUTURE }, T5));

    // the train's wire door: the v5 keys pass; store.mjs's raw mvp 0/1 and band ranked read as the stream's; a bad value is refused
    const rel = (items: unknown[]) => parseReleaseCreated({ release: { id: 'rel', version: '1', branch: 'b', status: 'draft', created_at: T5, updated_at: T5, items }, added: [], skipped: [] });
    const canon = (x: unknown): unknown => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([k], [l]) => (k < l ? -1 : 1)).map(([k, y]) => [k, canon(y)])) : x);
    const sorted = (o: object) => JSON.stringify(canon(o));
    const okv = rel([a, { ...p1, mvp: 0, band: 'ranked' }, { ...p1, mvp: 1 }]);
    check('v5: the wire door keeps the v5 keys; mvp 0 and band ranked stay out, mvp 1 reads true', okv.ok && sorted(okv.value.release.items[0]) === sorted(a!) && !('mvp' in okv.value.release.items[1])
      && !('band' in okv.value.release.items[1]) && okv.value.release.items[2].mvp === true, JSON.stringify(okv));
    for (const [k, val] of [['confidence', 'sure'], ['band', 'top'], ['predicted_verdict', 'maybe'], ['mvp', 2], ['score', 'high'], ['proof', 'better']] as const) {
      const bad = rel([{ ...a, [k]: val }]);
      check(`v5: the wire door refuses ${k} ${JSON.stringify(val)}`, !bad.ok && bad.error.includes(k), JSON.stringify(bad));
    }

    // one score: the stored score first, the pre-v5 estimate only for rows without one ("est."), a v5 row without one "unscored"
    const est = estValue(s5.proposals), wa = worthOf(a!, est), wp = worthOf(p1!, est), wn = worthOf({ ...a!, score: undefined, band: undefined }, est);
    check('score: stored -> "40.5"; a pre-v5 row -> "est. ..."; a v5 row without a score -> "unscored" (never 0)', worthText(wa) === '40.5' && worthText(wp).startsWith('est. ') && worthText(wn) === 'unscored', [worthText(wa), worthText(wp), worthText(wn)].join(' | '));
    // v5a is a reserve row; the same worth in the ranked band leads, the reserve copy trails every ranked row
    check('score: a reserve row\'s worth carries its band', wa.band === 'reserve' && wp.band === 'ranked');
    const order = [wn, wp, wa, { ...wa, band: 'ranked' as const, value: 28.5 }].sort(byWorth).map(worthText).join(',');
    check('score: ranked before reserve, then scored, estimated, unscored', order === '28.5,' + worthText(wp) + ',unscored,40.5', order);

    // a v4 store: the real DDL with proposals rebuilt without the v5 columns and no trust_events, user_version 4
    const v4 = path.join(dir, 'v4.db'), w4 = new DatabaseSync(v4);
    w4.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
    const keep = (w4.prepare('PRAGMA table_info(proposals)').all() as { name: string }[]).map((c) => c.name).filter((c) => !V5.includes(c));
    w4.exec(`DROP INDEX proposals_score; DROP TABLE trust_events; ALTER TABLE proposals RENAME TO p5;
      CREATE TABLE proposals AS SELECT ${keep.join(', ')} FROM p5; DROP TABLE p5; PRAGMA user_version = 4;`);
    w4.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r4', ?, ?, 'measure', 'done', '[]')").run(T5, T5);
    w4.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, standard, kind, status, created_at, updated_at, decided_by) VALUES ('q4', 'r4', 'f1', 'dev', 'Old', 'none', 'fix', 'approved', ?, ?, 'machine:lens-scan')").run(T5, T5);
    w4.close();
    let s4: ScanSnapshot | undefined, err4 = '';
    try { s4 = snapshotOf(v4); } catch (e) { err4 = (e as Error).message; }
    const q4 = s4?.proposals[0];
    check('v4 store: reads without an error, no v5 key, trust_events empty', !err4 && q4?.id === 'q4' && !V5.some((k) => k in q4) && s4!.trust_events?.length === 0, err4 || JSON.stringify(q4));
    check('v4 store: its row is worth its estimate ("est."), never 0', worthText(worthOf(q4!, estValue(s4!.proposals))).startsWith('est. '));
    const v4veto = veto(v4, 'q4', { reason: 'x' }, 'user:octocat', T5);
    check('v4 store: nothing to veto (no veto window): 409, no error', !v4veto.ok && v4veto.status === 409);
  }

  w.close();

  // ---- product list: a missing file is quiet, a broken one is said once (not on every request)
  const warns: string[] = [], warn = console.warn, cwd = process.cwd();
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
  try {
    process.chdir(dir);
    const pf = path.join(dir, PRODUCTS_FILE);
    check('no product file: no products, no warning', listProducts().length === 0 && warns.length === 0, warns.join(' | '));
    fs.writeFileSync(pf, '{ "products": [ ');
    listProducts(); listProducts(); listProducts();
    check('a broken product file warns once over 3 reads', warns.length === 1, String(warns.length));
    fs.writeFileSync(pf, JSON.stringify({ products: [{ slug: 'a', root: dir }] }));
    check('a fixed product file lists its product', listProducts().length === 1 && warns.length === 1);
    fs.writeFileSync(pf, '{"products": 7}');
    listProducts(); listProducts();
    check('a product file without a products array warns once', warns.length === 2, String(warns.length));
  } finally { console.warn = warn; process.chdir(cwd); }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`scan wire: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
