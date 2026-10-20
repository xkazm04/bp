// A product's readiness (src/lib/scan/readiness.ts), computed cheaply enough for `GET /api/products` to
// answer it for every registered product: a few stats, one JSON parse of the map (cached by mtime and
// size, so an unchanged map is not parsed again), and one read-only query on the store. Every step is
// guarded: a broken product reports what it lacks and never breaks the list. Server-only.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { storeDir, storeFile } from './products.server';
import type { ProductEntry } from '../scan/types';
import type { Readiness } from '../scan/readiness';

if (typeof window !== 'undefined') throw new Error('readiness.server.ts is server-only');

interface MapSummary { ok: boolean; version: 2 | 3 | null; features: number; lenses: number; error?: string }
const mapCache = new Map<string, { key: string; s: MapSummary }>();

const statOf = (f: string): fs.Stats | null => { try { return fs.statSync(f); } catch { return null; } };

function summarizeMap(file: string, st: fs.Stats): MapSummary {
  const key = st.mtimeMs + ':' + st.size, hit = mapCache.get(file);
  if (hit && hit.key === key) return hit.s;
  let s: MapSummary;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not a JSON object');
    const v = j.version;
    const version = j.$schema === 'app-structure/3' || v === 3 || v === '3' ? 3 : !j.$schema && (v === 2 || v === '2') ? 2 : null;
    const lenses = Array.isArray(j.lenses) ? (j.lenses as Record<string, unknown>[]).filter((l) => l && l.enabled !== false).length : 0;
    s = { ok: true, version, features: Array.isArray(j.features) ? j.features.length : 0, lenses };
  } catch (e) {
    s = { ok: false, version: null, features: 0, lenses: 0, error: 'map: ' + (e as Error).message };
  }
  mapCache.set(file, { key, s });
  return s;
}

type Row = Record<string, unknown>;
function readStore(file: string): { measuredFacets: number; proposals: number | null; lastRunAt: string | null; error?: string } {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true, timeout: 250 });
    const has = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) => String(r.name)));
    const q = [
      has.has('measurements') ? '(SELECT COUNT(*) FROM (SELECT DISTINCT feature, lens, metric FROM measurements))' : '0',
      has.has('proposals') ? "(SELECT COUNT(*) FROM proposals WHERE status = 'proposed')" : 'NULL',
      has.has('runs') ? '(SELECT COALESCE(ended_at, updated_at) FROM runs ORDER BY started_at DESC, id DESC LIMIT 1)' : 'NULL',
    ];
    const r = db.prepare(`SELECT ${q[0]} AS mf, ${q[1]} AS pr, ${q[2]} AS last`).get() as Row;
    return {
      measuredFacets: Number(r.mf) || 0,
      proposals: r.pr == null ? null : Number(r.pr),
      lastRunAt: typeof r.last === 'string' ? r.last : null,
    };
  } catch (e) {
    return { measuredFacets: 0, proposals: null, lastRunAt: null, error: 'store: ' + (e as Error).message };
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

export function readinessOf(p: ProductEntry): Readiness {
  const r: Readiness = { rootExists: false, map: false, mapVersion: null, events: false, store: false, features: 0, lenses: 0, measuredFacets: 0, proposals: null, lastRunAt: null };
  try {
    r.rootExists = !!statOf(p.root)?.isDirectory();
    if (!r.rootExists) return r;
    const dir = storeDir(p), errs: string[] = [];
    const mf = path.join(dir, 'app-structure.json'), mst = statOf(mf);
    if (mst?.isFile()) {
      const m = summarizeMap(mf, mst);
      r.map = m.ok; r.mapVersion = m.version; r.features = m.features; r.lenses = m.lenses;
      if (m.error) errs.push(m.error);
    }
    r.events = !!statOf(path.join(dir, 'events.jsonl'))?.isFile();
    const sf = storeFile(p);
    r.store = !!statOf(sf)?.isFile();
    if (r.store) {
      const s = readStore(sf);
      r.measuredFacets = s.measuredFacets; r.proposals = s.proposals; r.lastRunAt = s.lastRunAt;
      if (s.error) errs.push(s.error);
    }
    if (errs.length) r.error = errs.join('; ');
  } catch (e) {
    r.error = (e as Error).message;
  }
  return r;
}
