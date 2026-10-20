// Writes to `bp.products.local.json` (the read side is products.server.ts): add, rename or re-root, and
// unregister a product. Unregistering only drops the line; nothing on disk is ever deleted. The file is
// rewritten atomically (a temp file in the same directory, then a rename), created when absent, and keeps
// unknown keys and the order of entries. A file that exists but cannot be parsed is never overwritten.
// Server-only: the route handlers under src/app/api/products import it.
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCTS_FILE } from './products.server';
import { RESERVED_SLUGS, SLUG_RE } from '../scan/readiness';

if (typeof window !== 'undefined') throw new Error('registry.server.ts is server-only');

export type RegistryResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string };
type Entry = Record<string, unknown> & { slug?: unknown; name?: unknown; root?: unknown };
type Doc = Record<string, unknown> & { products: Entry[] };

const fail = (status: 400 | 403 | 404 | 409 | 500, error: string): { ok: false; status: typeof status; error: string } => ({ ok: false, status, error });
const file = (): string => path.join(/* turbopackIgnore: true */ process.cwd(), PRODUCTS_FILE);

function readDoc(): RegistryResult<Doc> {
  let text: string;
  try { text = fs.readFileSync(file(), 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, value: { products: [] } };
    return fail(500, `${PRODUCTS_FILE} cannot be read: ${(e as Error).message}`);
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return fail(409, `${PRODUCTS_FILE} is not valid JSON (${(e as Error).message}); fix it by hand first`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(409, `${PRODUCTS_FILE} is not a JSON object; fix it by hand first`);
  const doc = raw as Record<string, unknown>;
  if (doc.products === undefined) doc.products = [];
  if (!Array.isArray(doc.products)) return fail(409, `${PRODUCTS_FILE}: "products" is not an array; fix it by hand first`);
  return { ok: true, value: doc as Doc };
}

function writeDoc(doc: Doc): void {
  const f = file(), tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  // Windows refuses a rename over a file another process holds for a moment (an editor, a virus scan): retry briefly.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, f); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 5 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1)); // a short synchronous sleep
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function checkName(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? null : 'name must be a non-empty string';
}
function checkRoot(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return 'root must be a non-empty path';
  const abs = path.resolve(v.trim());
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { return `root ${abs} does not exist`; }
  return st.isDirectory() ? null : `root ${abs} is not a directory`;
}

export interface AddBody { slug: string; name: string; root: string }
export interface PatchBody { name?: string; root?: string }

export function addProduct(body: unknown): RegistryResult<AddBody> {
  if (!isObj(body)) return fail(400, 'body must be { slug, name, root }');
  const extra = Object.keys(body).filter((k) => !['slug', 'name', 'root'].includes(k));
  if (extra.length) return fail(400, `unknown keys: ${extra.join(', ')}`);
  const { slug, name, root } = body;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return fail(400, 'slug must match ^[a-z0-9][a-z0-9-]{0,62}$ (lower-case letters, digits, hyphens)');
  if (RESERVED_SLUGS.includes(slug)) return fail(400, `slug "${slug}" is the built-in sample`);
  const bad = checkName(name) ?? checkRoot(root);
  if (bad) return fail(400, bad);
  const d = readDoc();
  if (!d.ok) return d;
  if (d.value.products.some((p) => isObj(p) && p.slug === slug)) return fail(409, `slug "${slug}" is already registered`);
  const entry: AddBody = { slug, name: (name as string).trim(), root: (root as string).trim() };
  d.value.products.push({ ...entry });
  writeDoc(d.value);
  return { ok: true, value: entry };
}

export function patchProduct(slug: string, body: unknown): RegistryResult<AddBody> {
  if (!isObj(body)) return fail(400, 'body must be { name?, root? }');
  const extra = Object.keys(body).filter((k) => k !== 'name' && k !== 'root');
  if (extra.length) return fail(400, `unknown keys: ${extra.join(', ')} (the slug cannot change: remove and add instead)`);
  if (body.name === undefined && body.root === undefined) return fail(400, 'body must set name or root');
  const bad = (body.name !== undefined ? checkName(body.name) : null) ?? (body.root !== undefined ? checkRoot(body.root) : null);
  if (bad) return fail(400, bad);
  const d = readDoc();
  if (!d.ok) return d;
  const e = d.value.products.find((p) => isObj(p) && p.slug === slug);
  if (!e) return fail(404, `unknown product ${slug}`);
  if (body.name !== undefined) e.name = (body.name as string).trim();
  if (body.root !== undefined) e.root = (body.root as string).trim();
  writeDoc(d.value);
  return { ok: true, value: { slug, name: String(e.name ?? slug), root: String(e.root ?? '') } };
}

/** Drops every line with this slug (the reader keeps the first of duplicates, so leaving one would resurrect it). Nothing on disk is touched. */
export function removeProduct(slug: string): RegistryResult<{ slug: string }> {
  const d = readDoc();
  if (!d.ok) return d;
  const n = d.value.products.length;
  d.value.products = d.value.products.filter((p) => !(isObj(p) && p.slug === slug));
  if (d.value.products.length === n) return fail(404, `unknown product ${slug}`);
  writeDoc(d.value);
  return { ok: true, value: { slug } };
}

export { localHost, localOnly, jsonOnly } from '../scan/local-only';
