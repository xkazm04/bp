// The lens-scan store, read side (and the one write the blueprint makes: a proposal decision). The DDL is
// docs/standard/lens-scan-store.sql; the /lens-scan skill writes the file concurrently in WAL mode, so
// reads go through a read-only connection and a decision opens its own short read-write connection with a
// busy timeout. Rows become wire objects (src/lib/scan/types.ts) here: JSON columns are parsed and NULL
// columns are omitted (absent-value convention, never null in JSON). Server-only, imported by the route
// handlers under src/app/api/products and nothing else; node:sqlite is a Node builtin (experimental on 24).
import { DatabaseSync } from 'node:sqlite';
import type { Activity, Coverage, DecisionBody, Measurement, Proposal, Run, ScanDelta, ScanSnapshot, Shot } from './types';

if (typeof window !== 'undefined') throw new Error('store.server.ts is server-only');

type Row = Record<string, unknown>;
type Table = keyof ScanSnapshot;
const TABLES: readonly Table[] = ['runs', 'measurements', 'proposals', 'activity', 'shots', 'coverage'];
/** Columns that hold JSON text, per table. */
const JSON_COLS: Partial<Record<Table, readonly string[]>> = { runs: ['lenses', 'scope'], shots: ['report'] };
const ACTIVITY_LIMIT = 200;
const BUSY_MS = 2000;

export const emptyScan = (): ScanSnapshot => ({ runs: [], measurements: [], proposals: [], activity: [], shots: [], coverage: [] });
export const isEmptyScan = (s: ScanSnapshot): boolean => TABLES.every((t) => s[t].length === 0);

function wire<T>(table: Table, r: Row): T {
  const o: Row = {}, js = JSON_COLS[table];
  for (const k in r) {
    let v = r[k];
    if (v === null || v === undefined) continue;
    if (js?.includes(k) && typeof v === 'string') { try { v = JSON.parse(v); } catch { /* malformed JSON: keep the text */ } }
    o[k] = v;
  }
  return o as T;
}
const wireAll = <T>(table: Table, rows: Row[]): T[] => rows.map((r) => wire<T>(table, r));

/** The read connection. null when the file does not exist yet (the skill has not run). */
export function openRead(file: string): DatabaseSync | null {
  try { return new DatabaseSync(file, { readOnly: true, timeout: BUSY_MS }); } catch { return null; }
}
export function close(db: DatabaseSync | null): void { try { db?.close(); } catch { /* already closed */ } }

/** Changes only when another connection commits (the skill, or a decision's write connection). */
export function dataVersion(db: DatabaseSync): number {
  return Number((db.prepare('PRAGMA data_version').get() as Row).data_version);
}

/** The store's tables that exist (a store being created by the skill may not have all of them yet). */
function present(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[];
  return new Set(rows.map((r) => String(r.name)));
}
const all = (db: DatabaseSync, sql: string, ...args: (string | number)[]): Row[] => db.prepare(sql).all(...args) as Row[];

export function readSnapshot(db: DatabaseSync): ScanSnapshot {
  const s = emptyScan(), has = present(db);
  if (has.has('runs')) s.runs = wireAll<Run>('runs', all(db, 'SELECT * FROM runs ORDER BY started_at, id'));
  if (has.has('measurements')) s.measurements = wireAll<Measurement>('measurements', all(db, 'SELECT * FROM measurements ORDER BY id'));
  if (has.has('proposals')) s.proposals = wireAll<Proposal>('proposals', all(db, 'SELECT * FROM proposals ORDER BY created_at, id'));
  if (has.has('activity')) s.activity = wireAll<Activity>('activity', all(db, 'SELECT * FROM (SELECT * FROM activity ORDER BY id DESC LIMIT ?) ORDER BY id', ACTIVITY_LIMIT));
  if (has.has('shots')) s.shots = wireAll<Shot>('shots', all(db, 'SELECT * FROM shots ORDER BY id'));
  if (has.has('coverage')) s.coverage = wireAll<Coverage>('coverage', all(db, 'SELECT * FROM coverage ORDER BY judged_at, feature, standard'));
  return s;
}

/**
 * Where a stream has got to. Append-only tables move by id; runs/proposals by updated_at and coverage by
 * judged_at, which can tie: the keys already sent at the max timestamp are kept so `>=` resends nothing.
 */
export interface Cursor {
  measurements: number; activity: number; shots: number;
  runs: { at: string; keys: Set<string> }; proposals: { at: string; keys: Set<string> }; coverage: { at: string; keys: Set<string> };
}
export function newCursor(): Cursor {
  return { measurements: 0, activity: 0, shots: 0, runs: { at: '', keys: new Set() }, proposals: { at: '', keys: new Set() }, coverage: { at: '', keys: new Set() } };
}
function advanceId(rows: { id: number }[], last: number): number { for (const r of rows) if (r.id > last) last = r.id; return last; }
function advanceAt<T>(rows: T[], c: { at: string; keys: Set<string> }, at: (r: T) => string, key: (r: T) => string) {
  for (const r of rows) {
    const t = at(r);
    if (t > c.at) { c.at = t; c.keys = new Set([key(r)]); } else if (t === c.at) c.keys.add(key(r));
  }
}
const covKey = (r: Coverage) => r.feature + '\u0000' + r.standard;
/** Move the cursor past every row in `s` (a snapshot or a delta). */
export function advance(c: Cursor, s: ScanSnapshot): void {
  c.measurements = advanceId(s.measurements, c.measurements);
  c.activity = advanceId(s.activity, c.activity);
  c.shots = advanceId(s.shots, c.shots);
  advanceAt(s.runs, c.runs, (r) => r.updated_at, (r) => r.id);
  advanceAt(s.proposals, c.proposals, (r) => r.updated_at, (r) => r.id);
  advanceAt(s.coverage, c.coverage, (r) => r.judged_at, covKey);
}

/** Rows new or changed since `c` (the cursor is not moved; call advance() after sending). */
export function readDelta(db: DatabaseSync, c: Cursor): ScanDelta {
  const d = emptyScan(), has = present(db);
  if (has.has('measurements')) d.measurements = wireAll<Measurement>('measurements', all(db, 'SELECT * FROM measurements WHERE id > ? ORDER BY id', c.measurements));
  if (has.has('activity')) d.activity = wireAll<Activity>('activity', all(db, 'SELECT * FROM activity WHERE id > ? ORDER BY id', c.activity));
  if (has.has('shots')) d.shots = wireAll<Shot>('shots', all(db, 'SELECT * FROM shots WHERE id > ? ORDER BY id', c.shots));
  if (has.has('runs')) d.runs = wireAll<Run>('runs', all(db, 'SELECT * FROM runs WHERE updated_at >= ? ORDER BY updated_at, id', c.runs.at))
    .filter((r) => !(r.updated_at === c.runs.at && c.runs.keys.has(r.id)));
  if (has.has('proposals')) d.proposals = wireAll<Proposal>('proposals', all(db, 'SELECT * FROM proposals WHERE updated_at >= ? ORDER BY updated_at, id', c.proposals.at))
    .filter((r) => !(r.updated_at === c.proposals.at && c.proposals.keys.has(r.id)));
  if (has.has('coverage')) d.coverage = wireAll<Coverage>('coverage', all(db, 'SELECT * FROM coverage WHERE judged_at >= ? ORDER BY judged_at, feature, standard', c.coverage.at))
    .filter((r) => !(r.judged_at === c.coverage.at && c.coverage.keys.has(covKey(r))));
  return d;
}

/** Snapshot of a store file, or the empty scan when it does not exist. */
export function snapshotOf(file: string): ScanSnapshot {
  const db = openRead(file);
  if (!db) return emptyScan();
  try { return readSnapshot(db); } finally { close(db); }
}

/** `null` = not a valid DecisionBody. */
export function parseDecision(x: unknown): DecisionBody | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Row;
  if (o.decision !== 'approve' && o.decision !== 'decline') return null;
  if (o.note !== undefined && typeof o.note !== 'string') return null;
  if (Object.keys(o).some((k) => k !== 'decision' && k !== 'note')) return null;
  return o.note === undefined ? { decision: o.decision } : { decision: o.decision, note: o.note };
}

export type DecideResult = { ok: true; proposal: Proposal } | { ok: false; status: 404 } | { ok: false; status: 409; proposal: Proposal };

/** Approve or decline a `proposed` row, on a short-lived read-write connection. */
export function decide(file: string, id: string, body: DecisionBody): DecideResult {
  const db = new DatabaseSync(file, { timeout: BUSY_MS });
  try {
    const now = new Date().toISOString();
    const row = db.prepare(
      "UPDATE proposals SET status = ?, decided_by = 'blueprint', decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ? AND status = 'proposed' RETURNING *",
    ).get(body.decision === 'approve' ? 'approved' : 'declined', now, body.note ?? null, now, id) as Row | undefined;
    if (row) return { ok: true, proposal: wire<Proposal>('proposals', row) };
    const cur = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Row | undefined;
    return cur ? { ok: false, status: 409, proposal: wire<Proposal>('proposals', cur) } : { ok: false, status: 404 };
  } finally { close(db); }
}
