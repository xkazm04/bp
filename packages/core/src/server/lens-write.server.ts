// Project-lens writes to a live product's map (`<root>/.ai/lens-scan/app-structure.json`, spec 8.1): add a
// temporary or permanent project lens, retire or restore it (`enabled`), delete its entry. Only `source:
// 'project'` entries are ever changed (built-ins never); facets are never touched (a deleted lens's facets
// stay, orphaned, as the spec asks). The file is read, changed and rewritten atomically (products.server.ts's
// writeAtomic: a temp file in the same directory, then a rename with the Windows retry), keeping key order, unknown keys, its indentation and line endings; a file
// that does not parse is never overwritten. The stream's `map` event then tells every client (the rename
// moves the rev). Server-only: the lens routes import it.
import fs from 'node:fs';
import path from 'node:path';
import type { LensEntry, LensManifest } from '@bp/core/standard/types';
import { storeDir, writeAtomic } from './products.server';
import { takenLooks, type LensLook } from '../scan/jobs';
import type { ProductEntry } from '../scan/types';

if (typeof window !== 'undefined') throw new Error('lens-write.server.ts is server-only');

export type LensWrite<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string };
type Doc = Record<string, unknown> & { lenses?: unknown };
interface Read { doc: Doc; indent: string; eol: string }

const fail = (status: 400 | 403 | 404 | 409 | 500, error: string): { ok: false; status: typeof status; error: string } => ({ ok: false, status, error });
const mapFile = (p: ProductEntry): string => path.join(storeDir(p), 'app-structure.json');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function readMap(file: string): LensWrite<Read> {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? fail(404, `no structure at ${file}`) : fail(500, `cannot read ${file}: ${(e as Error).message}`);
  }
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (e) { return fail(409, `${file} is not valid JSON (${(e as Error).message}); it was left as it is`); }
  if (!isObj(doc)) return fail(409, `${file} is not a JSON object; it was left as it is`);
  if (doc.lenses !== undefined && !Array.isArray(doc.lenses)) return fail(409, `${file}: "lenses" is not an array; it was left as it is`);
  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? (/^\{\r?\n"/.test(text) ? '' : '  ');
  return { ok: true, value: { doc, indent, eol: text.includes('\r\n') ? '\r\n' : '\n' } };
}

function writeMap(file: string, r: Read): void {
  let out = JSON.stringify(r.doc, null, r.indent) + '\n';
  if (r.eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  writeAtomic(file, out);
}

/** Read, change, write. `change` answers the result, or a failure that leaves the file untouched. */
function edit<T>(p: ProductEntry, change: (lenses: Record<string, unknown>[], doc: Doc) => LensWrite<T>): LensWrite<T> {
  const file = mapFile(p), r = readMap(file);
  if (!r.ok) return r;
  const lenses = (r.value.doc.lenses ??= []) as Record<string, unknown>[];
  const res = change(lenses, r.value.doc);
  if (!res.ok) return res;
  try { writeMap(file, r.value); } catch (e) { return fail(500, `could not write ${file}: ${(e as Error).message}`); }
  return res;
}

/** The project entry `id`, or why it cannot be changed (404 unknown, 403 built-in). */
function projectEntry(lenses: Record<string, unknown>[], id: string): LensWrite<number> {
  const i = lenses.findIndex((e) => isObj(e) && e.id === id);
  if (i < 0) return fail(404, `no lens ${id}`);
  if (lenses[i].source !== 'project') return fail(403, `lens ${id} is built in; the blueprint changes project lenses only`);
  return { ok: true, value: i };
}

/**
 * Append a lens: a temporary one (`temporary: true`, a tmp.* id) or a permanent project lens (reverse-DNS id).
 * `check` sees the manifest and the looks of the map's other enabled lenses, read in the same edit, and answers
 * null or why the manifest is refused (400). 409 when the id exists, whatever its source.
 */
export function addLens(p: ProductEntry, manifest: LensManifest, temporary: boolean, check: (taken: LensLook[]) => string | null): LensWrite<LensEntry> {
  return edit(p, (lenses) => {
    const entries = lenses.filter((e): e is Record<string, unknown> & LensEntry => isObj(e) && typeof e.id === 'string' && isObj(e.manifest));
    const bad = check(takenLooks(entries, manifest.id));
    if (bad) return fail(400, bad);
    if (lenses.some((e) => isObj(e) && e.id === manifest.id)) return fail(409, `lens ${manifest.id} already exists`);
    const entry: LensEntry = temporary
      ? { id: manifest.id, version: manifest.version, source: 'project', enabled: true, temporary: true, created_at: new Date().toISOString(), manifest }
      : { id: manifest.id, version: manifest.version, source: 'project', enabled: true, created_at: new Date().toISOString(), manifest };
    lenses.push(entry as unknown as Record<string, unknown>);
    return { ok: true, value: entry };
  });
}

/** Retire (false) or restore (true) a project lens, temporary or permanent. */
export function setLensEnabled(p: ProductEntry, id: string, enabled: boolean): LensWrite<LensEntry> {
  return edit(p, (lenses) => {
    const t = projectEntry(lenses, id);
    if (!t.ok) return t;
    lenses[t.value].enabled = enabled;
    return { ok: true, value: lenses[t.value] as unknown as LensEntry };
  });
}

/** Remove a project lens's entry, temporary or permanent; its facets stay (spec 8.1). */
export function deleteLens(p: ProductEntry, id: string): LensWrite<{ id: string }> {
  return edit(p, (lenses) => {
    const t = projectEntry(lenses, id);
    if (!t.ok) return t;
    lenses.splice(t.value, 1);
    return { ok: true, value: { id } };
  });
}

/** The map's lens entries and feature slugs, for the scan routes' checks. null = no readable map. */
export function readLensesAndFeatures(p: ProductEntry): { lenses: LensEntry[]; features: Set<string> } | null {
  const r = readMap(mapFile(p));
  if (!r.ok) return null;
  const lenses = (Array.isArray(r.value.doc.lenses) ? r.value.doc.lenses : []).filter((e): e is LensEntry => isObj(e) && typeof e.id === 'string' && isObj(e.manifest));
  const feats = Array.isArray(r.value.doc.features) ? r.value.doc.features : [];
  return { lenses, features: new Set(feats.filter(isObj).map((f) => f.slug).filter((s): s is string => typeof s === 'string')) };
}
