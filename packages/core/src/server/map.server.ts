// The product map reader: a live product's `<root>/.ai/lens-scan/app-structure.json` (and its optional `events.jsonl`), read
// once per map rev (store.server.ts mapRev, the stat fingerprint the stream's `map` event carries) and handed to every route
// that needs the map: the route door's `map: 'required'` stage (route-door.server.ts), structure, plan, the morning deck and
// the companion's gaps. One classifier answers every map state the same way everywhere (docs/blueprint-ui.md, "API"):
//   404 `no structure at <file>`         no app-structure.json
//   500 `cannot read <file>: ...`        it exists but cannot be read
//   409 `<file> is not valid JSON (...)` it does not parse (also: not a JSON object, or `lenses` not an array)
// A lens is enabled when its entry says `enabled: true` (lensOn), the rule the browser's loader reads (standard/load.ts):
// an entry without the key is off everywhere, never on in one reader and off in another. The cached document is frozen:
// readers share it, and the one writer (lens-write.server.ts) reads the file itself through readMapFile before it edits.
// Server-only.
import fs from 'node:fs';
import path from 'node:path';
import type { LensEntry } from '../standard/types.ts';
import type { ProductEntry } from '../scan/types.ts';
import { isObj } from '../scan/guards.ts';
import { storeDir } from './products.server.ts';
import { mapRev } from './store.server.ts';

if (typeof window !== 'undefined') throw new Error('map.server.ts is server-only');

export type MapFail = { ok: false; status: 404 | 409 | 500; error: string };
/** A parsed app-structure.json: its text (the writer keeps its indentation and line endings) and its object. */
export type MapFile = { ok: true; text: string; doc: Record<string, unknown> } | MapFail;

/** The product's map, as every reader gets it. `lenses` are the entries with an id and a manifest, enabled or not. */
export interface ProductMap {
  ok: true;
  file: string;
  /** mapRev of the store directory, taken before the read (a write in between shows up as a newer rev). */
  rev: string;
  doc: Readonly<Record<string, unknown>>;
  /** events.jsonl, '' when there is none. */
  events: string;
  lenses: readonly LensEntry[];
  /** The map's feature slugs. */
  features: ReadonlySet<string>;
}
export type MapRead = ProductMap | MapFail;

/** The one enabled rule: `enabled: true`. */
export const lensOn = (e: { enabled?: unknown }): boolean => e.enabled === true;

const g = globalThis as unknown as { __bpProductMaps?: Map<string, ProductMap>; __bpMapReads?: number };
/** How many times app-structure.json was read from disk in this process (scripts/check-route-door.ts counts the cache). */
export const mapReads = (): number => g.__bpMapReads ?? 0;

/** Read and classify one app-structure.json. */
export function readMapFile(file: string): MapFile {
  let text: string;
  g.__bpMapReads = mapReads() + 1;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT'
      ? { ok: false, status: 404, error: `no structure at ${file}` }
      : { ok: false, status: 500, error: `cannot read ${file}: ${(e as Error).message}` };
  }
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, status: 409, error: `${file} is not valid JSON (${(e as Error).message})` }; }
  if (!isObj(doc)) return { ok: false, status: 409, error: `${file} is not a JSON object` };
  if (doc.lenses !== undefined && !Array.isArray(doc.lenses)) return { ok: false, status: 409, error: `${file}: "lenses" is not an array` };
  return { ok: true, text, doc };
}

function freeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) freeze((v as Record<string, unknown>)[k]); }
  return v;
}

/** The product's map, cached per store directory while its rev holds; a refusal is never cached. */
export function readProductMap(p: ProductEntry): MapRead {
  const cache = (g.__bpProductMaps ??= new Map()), dir = storeDir(p), rev = mapRev(dir), hit = cache.get(dir);
  if (hit && rev && hit.rev === rev) return hit;
  const file = path.join(dir, 'app-structure.json'), r = readMapFile(file);
  if (!r.ok) { cache.delete(dir); return r; }
  let events = '';
  try { events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'); } catch { /* no events log */ }
  const doc = freeze(r.doc);
  const lenses = (Array.isArray(doc.lenses) ? doc.lenses : []).filter((e): e is LensEntry => isObj(e) && typeof e.id === 'string' && isObj(e.manifest));
  const feats = Array.isArray(doc.features) ? doc.features : [];
  const m: ProductMap = { ok: true, file, rev, doc, events, lenses, features: new Set(feats.filter(isObj).map((f) => f.slug).filter((s): s is string => typeof s === 'string')) };
  if (rev) cache.set(dir, m);
  return m;
}
