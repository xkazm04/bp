// The brain's index: index.sqlite (node:sqlite, WAL) with one row per memory and an FTS5 table over facts and episodes, so
// recall is a query instead of a directory walk. It is derivable: the files are the truth, and an index that is missing,
// unopenable, failing quick_check or of another schema is set aside (renamed `index.sqlite.aside-<ms>`) and rebuilt from them.
// One writer connection per process (reopened when BP_HOME moves or the file vanishes); every read opens a fresh read-only
// handle. Where this Node's sqlite lacks FTS5 the table is a plain one and search falls back to LIKE (indexInfo().fts5 says).
// persist/patch are the write-through: file first (atomic), then the row; a row that fails to land marks the index for a rebuild.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { brainRoot, indexPath } from './paths.server.ts';
import { readAll, readRec, recPath, sweepTemps, writeRec, type Rec } from './files.server.ts';

if (typeof window !== 'undefined') throw new Error('index.server.ts is server-only');

const VERSION = '1';
let fts5: boolean | null = null;
/** Whether this Node's sqlite has FTS5, probed once in memory. */
export function hasFts5(): boolean {
  if (fts5 === null) {
    const d = new DatabaseSync(':memory:');
    try { d.exec('CREATE VIRTUAL TABLE t USING fts5(a)'); fts5 = true; } catch { fts5 = false; } finally { d.close(); }
  }
  return fts5;
}

const info = { rebuilds: 0, setAside: [] as string[], lastRebuild: '' };
let w: { path: string; db: DatabaseSync; fts: boolean } | null = null;
let dirty = false;

function schema(db: DatabaseSync): boolean {
  db.exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS mem(id TEXT PRIMARY KEY, type TEXT NOT NULL, kind TEXT NOT NULL, space TEXT NOT NULL, at TEXT NOT NULL,
      conv TEXT, importance REAL, supersededBy TEXT, slept TEXT, quarantined INTEGER, lastUsed TEXT, rec TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mem_space ON mem(space, type, at);
    CREATE INDEX IF NOT EXISTS mem_conv ON mem(conv, at);`);
  const fts = hasFts5();
  db.exec(fts ? 'CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(id UNINDEXED, body)' : 'CREATE TABLE IF NOT EXISTS mem_fts(id TEXT, body TEXT)');
  return fts;
}

const body = (r: Rec): string => (r.type === 'episode' ? `${r.input ?? ''}\n${r.text}` : r.text);
function upsert(db: DatabaseSync, r: Rec): void {
  db.prepare('INSERT OR REPLACE INTO mem(id,type,kind,space,at,conv,importance,supersededBy,slept,quarantined,lastUsed,rec) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(r.id, r.type, r.kind, r.space, r.at, r.conversationId ?? null, r.importance, r.supersededBy ?? null, r.slept ?? null, r.quarantined ? 1 : 0, r.lastUsed ?? null, JSON.stringify(r));
  db.prepare('DELETE FROM mem_fts WHERE id = ?').run(r.id);
  db.prepare('INSERT INTO mem_fts(id, body) VALUES (?, ?)').run(r.id, body(r));
}

function rebuild(db: DatabaseSync, why: string): void {
  sweepTemps(brainRoot());
  const { recs } = readAll();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM mem; DELETE FROM mem_fts;');
    for (const r of recs) upsert(db, r);
    db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)').run('version', VERSION);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  info.rebuilds++; info.lastRebuild = why; dirty = false;
}

function setAside(p: string): void {
  const to = `${p}.aside-${Date.now()}`;
  try { fs.renameSync(p, to); info.setAside.push(to); } catch { fs.rmSync(p, { force: true }); }
  for (const x of ['-wal', '-shm']) fs.rmSync(p + x, { force: true });
}

function openWriter(p: string): { db: DatabaseSync; fts: boolean } {
  fs.mkdirSync(brainRoot(), { recursive: true });
  const fresh = !fs.existsSync(p);
  try {
    const db = new DatabaseSync(p);
    try {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;');
      const ok = (db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined)?.quick_check === 'ok';
      if (!ok) throw new Error('quick_check failed');
      const fts = schema(db);
      const v = (db.prepare("SELECT v FROM meta WHERE k = 'version'").get() as { v?: string } | undefined)?.v;
      if (fresh || v !== VERSION) {
        if (!fresh && v !== undefined) throw new Error(`schema ${v} is not ${VERSION}`);
        rebuild(db, fresh ? 'missing' : 'unversioned');
      }
      return { db, fts };
    } catch (e) { db.close(); throw e; }
  } catch (e) {
    if (fresh) throw e;
    setAside(p);
    const db = new DatabaseSync(p);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;');
    const fts = schema(db);
    rebuild(db, `damaged: ${(e as Error).message}`);
    return { db, fts };
  }
}

/** The one writer connection, opened (and the index rebuilt) on demand. */
export function writer(): { db: DatabaseSync; fts: boolean } {
  const p = indexPath();
  if (w && (w.path !== p || !fs.existsSync(p))) closeIndex();
  if (!w) w = { path: p, ...openWriter(p) };
  if (dirty) rebuild(w.db, 'a write did not reach the index');
  return w;
}

/** Closes the writer (tests delete index.sqlite after this; Windows will not delete an open file). */
export function closeIndex(): void {
  if (w) { try { w.db.close(); } catch { /* already closed */ } w = null; }
}

/** A fresh read-only handle for one read; the writer is opened first so a missing index is rebuilt before anyone reads. */
export function withReader<T>(fn: (db: DatabaseSync, fts: boolean) => T): T {
  const { fts } = writer();
  const db = new DatabaseSync(indexPath(), { readOnly: true });
  try { return fn(db, fts); } finally { db.close(); }
}

export function indexInfo(): { fts5: boolean; path: string; rebuilds: number; setAside: string[]; lastRebuild: string } {
  return { fts5: hasFts5(), path: indexPath(), ...info, setAside: [...info.setAside] };
}

/** File first, then the row. A row that fails leaves the file as the truth and the index due for a rebuild. */
export function persist(r: Rec): void {
  writeRec(r);
  try { upsert(writer().db, r); } catch { dirty = true; }
}

export function getRec(id: string): Rec | null {
  const row = withReader((db) => db.prepare('SELECT rec FROM mem WHERE id = ?').get(id) as { rec: string } | undefined);
  return row ? (JSON.parse(row.rec) as Rec) : null;
}

/** Re-read a memory's file, change it, write it back through persist. The file wins over the row it was found by. */
export function patch(id: string, fn: (r: Rec) => void): Rec | null {
  const hit = getRec(id);
  if (!hit) return null;
  const r = readRec(recPath(hit));
  if (!r) return null;
  fn(r);
  persist(r);
  return r;
}

export const recsOf = (rows: unknown[]): Rec[] => (rows as { rec: string }[]).map((x) => JSON.parse(x.rec) as Rec);

/** Query words, quoted for FTS5 (so no operator in a person's text is ever syntax). */
export const terms = (q: string): string[] => [...new Set((q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((t) => t.length > 1))].slice(0, 24);

/** Keyword hits among live facts and episodes of `spaces`: [rec, score] with score lower-is-better (BM25, or minus the
 *  matched-term count on the LIKE fallback), at most `limit`, plus the total that matched; `exclude` ids never count. */
export function search(q: string, spaces: string[], limit: number, o: { types?: Rec['type'][]; exclude?: string[] } = {}): { hits: { rec: Rec; score: number }[]; total: number } {
  const ts = terms(q), types = o.types ?? ['fact', 'episode'], ex = o.exclude ?? [];
  if (!ts.length) return { hits: [], total: 0 };
  return withReader((db, fts) => {
    const marks = (xs: unknown[]): string => xs.map(() => '?').join(',');
    const live = `m.space IN (${marks(spaces)}) AND m.type IN (${marks(types)}) AND m.supersededBy IS NULL${ex.length ? ` AND m.id NOT IN (${marks(ex)})` : ''}`;
    const args = [...spaces, ...types, ...ex];
    if (fts) {
      const match = ts.map((t) => `"${t}"`).join(' OR ');
      const from = `FROM mem_fts JOIN mem m ON m.id = mem_fts.id WHERE mem_fts MATCH ? AND ${live}`;
      const total = (db.prepare(`SELECT COUNT(*) n ${from}`).get(match, ...args) as { n: number }).n;
      const rows = db.prepare(`SELECT m.rec, bm25(mem_fts) s ${from} ORDER BY s LIMIT ?`).all(match, ...args, limit) as { rec: string; s: number }[];
      return { hits: rows.map((x) => ({ rec: JSON.parse(x.rec) as Rec, score: x.s })), total };
    }
    const score = ts.map(() => '(instr(lower(f.body), ?) > 0)').join(' + ');
    const from = `FROM mem_fts f JOIN mem m ON m.id = f.id WHERE (${score}) > 0 AND ${live}`;
    const total = (db.prepare(`SELECT COUNT(*) n ${from}`).get(...ts, ...args) as { n: number }).n;
    const rows = db.prepare(`SELECT m.rec, -(${score}) s ${from} ORDER BY s LIMIT ?`).all(...ts, ...ts, ...args, limit) as { rec: string; s: number }[];
    return { hits: rows.map((x) => ({ rec: JSON.parse(x.rec) as Rec, score: x.s })), total };
  });
}
