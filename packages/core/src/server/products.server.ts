// The live products this blueprint can open: `bp.products.local.json` at the repo root (gitignored;
// bp.products.example.json shows the shape). A missing or unreadable file means no live products; Kettle
// is built in and never listed. Server-only: route handlers import this, client components never do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { ProductEntry } from '../scan/types';

if (typeof window !== 'undefined') throw new Error('products.server.ts is server-only');

export const PRODUCTS_FILE = 'bp.products.local.json';
/** The registry's path: PRODUCTS_FILE at the repo root, or BP_PRODUCTS_FILE when set (a demo or a test points the server at a
 *  throwaway registry, so the operator's own products are never read or written). */
export const productsPath = (): string => (process.env.BP_PRODUCTS_FILE ? path.resolve(process.env.BP_PRODUCTS_FILE) : path.join(/* turbopackIgnore: true */ process.cwd(), PRODUCTS_FILE));

/** Each lens-scan product keeps its store and its structure here, under its repo root. */
export const storeDir = (p: ProductEntry): string => path.join(p.root, '.ai', 'lens-scan');
export const storeFile = (p: ProductEntry): string => path.join(storeDir(p), 'scan.db');

const warned = new Map<string, string>();
/**
 * Log a server-side failure that the answer itself hides (an empty list, an empty snapshot), once per
 * `key` until its message changes: a file read per request or a stream tick per second must not flood
 * the log. `recovered(key)` re-arms it, so the next failure is said again.
 */
export function warnOnce(key: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  if (warned.get(key) === msg) return;
  warned.set(key, msg);
  console.warn(`[bp] ${key}: ${msg}`);
}
export const recovered = (key: string): void => { warned.delete(key); };

/**
 * Write `text` over `file` atomically: a temp file in the SAME directory (so the rename cannot cross a volume),
 * then a rename. Windows refuses a rename over a file another process holds for a moment (an editor, a virus scan,
 * the lens-scan skill, a scan), so an EPERM/EACCES/EBUSY is retried briefly -- six tries, 20 ms longer each time --
 * and any other error, or the last try, removes the temp file and throws. Every hand-edited file the server owns
 * (the product registry, a product's map, a product's waves) is written through here, so none of them can be left
 * half-written and all three get the same retry.
 */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 5 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1)); // a short synchronous sleep
    }
  }
}

/** What reading the registry gave: the products it lists, and `problem` when the file is there but cannot be used (the
 *  writer's own refusal, registry.server.ts, in the same words: 409 for a file that is not a registry, 500 for one that
 *  cannot be read). A missing file is no problem: no live products. */
export interface RegistryRead { products: ProductEntry[]; problem?: { status: 409 | 500; error: string } }

/** Read on every call (the file is tiny and edited by hand or by scripts/scan-demo.mjs while the server runs). */
export function readRegistry(): RegistryRead {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(productsPath(), 'utf8')); } catch (e) {
    // No file = no live products (quiet); a file that cannot be read or parsed is said, on the log and in the answer.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { products: [] };
    warnOnce(PRODUCTS_FILE, e);
    return { products: [], problem: e instanceof SyntaxError
      ? { status: 409, error: `${PRODUCTS_FILE} is not valid JSON (${e.message}); fix it by hand first` }
      : { status: 500, error: `${PRODUCTS_FILE} cannot be read: ${(e as Error).message}` } };
  }
  const xs = (raw as { products?: unknown })?.products;
  if (!Array.isArray(xs)) {
    warnOnce(PRODUCTS_FILE, 'no "products" array');
    const object = !!raw && typeof raw === 'object' && !Array.isArray(raw);
    return { products: [], ...(!object ? { problem: { status: 409 as const, error: `${PRODUCTS_FILE} is not a JSON object; fix it by hand first` } }
      : xs !== undefined ? { problem: { status: 409 as const, error: `${PRODUCTS_FILE}: "products" is not an array; fix it by hand first` } } : {}) };
  }
  recovered(PRODUCTS_FILE);
  const out: ProductEntry[] = [], seen = new Set<string>();
  for (const x of xs as Record<string, unknown>[]) {
    if (!x || typeof x.slug !== 'string' || typeof x.root !== 'string' || !x.slug || seen.has(x.slug)) continue;
    seen.add(x.slug);
    out.push({ slug: x.slug, name: typeof x.name === 'string' && x.name ? x.name : x.slug, root: path.resolve(x.root) });
  }
  return { products: out };
}

/** The registered products; total by design (an unusable registry lists none), so the lookups below never throw.
 *  The list route asks `readRegistry` instead, to tell an empty registry from a broken one. */
export function listProducts(): ProductEntry[] {
  return readRegistry().products;
}

export function findProduct(slug: string): ProductEntry | null {
  return listProducts().find((p) => p.slug === slug) ?? null;
}

export const hasStore = (p: ProductEntry): boolean => fs.existsSync(storeFile(p));

/** The built-in Kettle sample, served only while no registered product is named `kettle`. Its map is read-only; its scans,
 *  waves and stream answer from the sims a process hosts in memory (kettle-sim.server.ts: apps/server does, apps/web does not). */
export const KETTLE_SLUG = 'kettle';
const KETTLE_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

/** Kettle's map and events from packages/core/data, or null when `slug` is not the built-in sample (or a product shadows it). */
export function kettleSample(slug: string): { structureFile: string; eventsFile: string } | null {
  if (slug !== KETTLE_SLUG || findProduct(slug)) return null;
  return { structureFile: path.join(KETTLE_DATA, 'kettle.app-structure.json'), eventsFile: path.join(KETTLE_DATA, 'kettle.events.jsonl') };
}

/** The sample's map and events as one read, with the `rev` both the structure and plan routes answer: sha1 of the map, a
 *  NUL, then the events (none read as ''), 16 hex characters. The one site that fingerprints the sample. Throws when the
 *  map cannot be read. */
export function kettleRead(k: { structureFile: string; eventsFile: string }): { raw: string; events: string; rev: string } {
  const raw = fs.readFileSync(k.structureFile, 'utf8');
  let events = '';
  try { events = fs.readFileSync(k.eventsFile, 'utf8'); } catch { /* no events log */ }
  const rev = createHash('sha1').update(raw).update('\0').update(events).digest('hex').slice(0, 16);
  return { raw, events, rev };
}

/** The 4xx for a product the route cannot resolve: Kettle, on a route or in a process without its sim, is the read-only
 *  sample (405), anything else is unknown (404). */
export function unknownProduct(slug: string): Response {
  return slug === KETTLE_SLUG
    ? Response.json({ error: 'kettle is the built-in sample: here only its structure and plan answer, and its scan, scans, waves, dispatch and stream where the process hosts its sim (apps/server)' }, { status: 405 })
    : Response.json({ error: `unknown product ${slug}` }, { status: 404 });
}
