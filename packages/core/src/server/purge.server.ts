// What removing a product may also delete (DELETE /api/products/[slug]?purge=store,companion), and the order that makes the
// delete safe. The registry line always goes (registry.server.ts removeProduct); the rest only when asked:
//   store      `<root>/.ai/lens-scan/` whole: scan.db*, app-structure.json, events.jsonl, work/ (job logs, the journal), ADOPT.md.
//              Never `<root>/.claude/lens-scan/config.md`, the `.gitignore` line or anything else in the repo.
//   companion  everything the companion keeps about the product. Files that belong to it ALONE are deleted: its brain space
//              (brain/spaces/<slug>.md), every brain memory (episode, fact, procedural) whose space is the slug and its rows in
//              the derivable brain/index.sqlite, and each conversation whose only product is the slug (conversations/<id>.json,
//              with its prompts/<id>.md and mcp/<id>.json). SHARED files are filtered, never deleted: every top-level
//              `*.json` / `*.jsonl` under $BP_HOME/companion (a record is the slug's when its `product` or `slug` is the slug,
//              or a map key is `<slug>:...`), a conversation that spans products (`products` naming others too: the slug is
//              dropped from it), and $BP_HOME/session/focus.json (history entries at the product dropped, a reader's place
//              there forgotten).
// Before anything is deleted the slug's queued and running jobs are cancelled and waited for (a running CLI writes its log
// and the journal under the store, and on Windows an open file cannot be deleted), then every long-lived store connection
// under the root (the product stream) is ended. Jobs that will not end in time refuse the purge (409): nothing is deleted
// and the product stays registered, so the person can try again. Server-only.
import fs from 'node:fs';
import path from 'node:path';
import { isObj } from '@bp/core/scan/guards';
import { cancel, list, unsettled } from './jobs.server.ts';
import { closeStoresUnder } from './store.server.ts';
import { findProduct, warnOnce, writeAtomic } from './products.server.ts';
import { removeProduct, type RegistryResult } from './registry.server.ts';
import { companionHome } from './companion/home.server.ts';
import { focusFile } from './api/session/focus.server.ts';
import { DatabaseSync } from 'node:sqlite';
import { indexPath, spacePath, validSpace } from './companion/brain/paths.server.ts';
import { readAll, recPath } from './companion/brain/files.server.ts';

if (typeof window !== 'undefined') throw new Error('purge.server.ts is server-only');

export const PURGE_TARGETS = ['store', 'companion'] as const;
export type PurgeTarget = (typeof PURGE_TARGETS)[number];
export interface PurgeAnswer { slug: string; purged: PurgeTarget[]; kept: PurgeTarget[] }

/** `?purge=store,companion` as targets; absent or empty is none. An unknown word is refused, never ignored. */
export function parsePurge(q: string | null): { ok: true; value: PurgeTarget[] } | { ok: false; error: string } {
  const words = (q ?? '').split(',').map((w) => w.trim()).filter(Boolean);
  const bad = words.filter((w) => !(PURGE_TARGETS as readonly string[]).includes(w));
  if (bad.length) return { ok: false, error: `purge takes ${PURGE_TARGETS.join(', ')} (comma list); not ${bad.join(', ')}` };
  return { ok: true, value: PURGE_TARGETS.filter((t) => words.includes(t)) };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Cancels every queued or running job of the slug and waits until each process has gone; the ids still there at `waitMs`. */
export async function endJobsOf(slug: string, waitMs = 15000): Promise<string[]> {
  for (const j of list(slug)) if (j.status === 'queued' || j.status === 'running') cancel(slug, j.id);
  const until = Date.now() + waitMs;
  while (unsettled(slug).length && Date.now() < until) await sleep(100);
  return unsettled(slug);
}

/** Deletes `<root>/.ai/lens-scan/` (retrying a moment for a handle the OS is still letting go of). */
export function deleteStore(root: string): void {
  fs.rmSync(path.join(root, '.ai', 'lens-scan'), { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

/** Whether a record belongs to the slug: its `product` or `slug` is it, or its `place` is in it. */
const isOf = (x: unknown, slug: string): boolean =>
  isObj(x) && (x.product === slug || x.slug === slug || (isObj(x.place) && x.place.product === slug));

/** One JSON value with the slug's records left out: array elements, a map's `<slug>:` keys, and one level of arrays and
 *  maps under an object (policies.json is `{ policies: [...] }`). null = nothing of the slug's was in it. */
export function withoutSlug(v: unknown, slug: string): unknown | null {
  const arr = (a: unknown[]): unknown[] | null => { const k = a.filter((x) => !isOf(x, slug)); return k.length === a.length ? null : k; };
  const map = (o: Record<string, unknown>): Record<string, unknown> | null => {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      if (k.startsWith(slug + ':') || isOf(x, slug)) { changed = true; continue; }
      if (k === 'products' && Array.isArray(x) && x.includes(slug)) { changed = true; out[k] = x.filter((y) => y !== slug); continue; }
      const inner = Array.isArray(x) ? arr(x) : null;
      if (inner) { changed = true; out[k] = inner; } else out[k] = x;
    }
    return changed ? out : null;
  };
  if (Array.isArray(v)) return arr(v);
  return isObj(v) ? map(v) : null;
}

/** Filters one companion file in place; true when it changed. A file that does not parse is left alone. */
function filterFile(file: string, slug: string): boolean {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  if (file.endsWith('.jsonl')) {
    const lines = text.split('\n');
    const kept = lines.filter((l) => { if (!l.trim()) return true; try { return !isOf(JSON.parse(l), slug); } catch { return true; } });
    if (kept.length === lines.length) return false;
    writeAtomic(file, kept.join('\n'));
    return true;
  }
  let v: unknown;
  try { v = JSON.parse(text); } catch { return false; }
  const out = withoutSlug(v, slug);
  if (out === null) return false;
  writeAtomic(file, JSON.stringify(out, null, 2) + '\n');
  return true;
}

/** The focus record without the product: history entries at it dropped (the shared index kept on the same entry, or the
 *  newest), a reader's place in it forgotten (the reader stays). Returns the files changed. */
function filterFocus(slug: string): boolean {
  const file = focusFile();
  let rec: unknown;
  try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  if (!isObj(rec) || !Array.isArray(rec.readers)) return false;
  let changed = false;
  const readers = rec.readers.map((r) => {
    if (!isObj(r) || !isObj(r.place) || r.place.product !== slug) return r;
    changed = true;
    const rest: Record<string, unknown> = { ...r };
    delete rest.place;
    return rest;
  });
  const out: Record<string, unknown> = { ...rec, readers };
  if (Array.isArray(rec.history)) {
    const at = typeof rec.historyAt === 'number' ? rec.historyAt : rec.history.length - 1;
    const history = rec.history.filter((h) => !isOf(h, slug));
    if (history.length !== rec.history.length) {
      changed = true;
      const before = rec.history.slice(0, at + 1).filter((h) => !isOf(h, slug)).length;
      out.history = history;
      if (history.length) out.historyAt = Math.max(0, Math.min(history.length - 1, before - 1)); else { delete out.history; delete out.historyAt; }
    }
  }
  if (!changed) return false;
  writeAtomic(file, JSON.stringify(out, null, 1) + '\n');
  delete (globalThis as { __bpSharedFocus?: unknown }).__bpSharedFocus; // the next read takes the file, not the cache
  return true;
}

const rm = (f: string): boolean => { try { fs.rmSync(f, { maxRetries: 4, retryDelay: 100 }); return true; } catch { return false; } };

/** A conversation file's verdict: `own` = its only product is the slug (delete it), `shared` = it spans the slug and others
 *  (filter it), null = not the slug's. */
function conversationOf(c: unknown, slug: string): 'own' | 'shared' | null {
  if (!isObj(c)) return null;
  const many = Array.isArray(c.products) ? c.products.filter((x): x is string => typeof x === 'string') : null;
  const all = new Set([...(typeof c.product === 'string' ? [c.product] : []), ...(many ?? [])]);
  if (!all.has(slug)) return null;
  return all.size === 1 ? 'own' : 'shared';
}

/** Deletes the slug's own conversations (with their prompt and mcp files) and filters the ones it shares; the paths it touched. */
function purgeConversations(slug: string): { deleted: string[]; filtered: string[] } {
  const home = companionHome(), dir = path.join(home, 'conversations'), deleted: string[] = [], filtered: string[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return { deleted, filtered }; }
  for (const n of names) {
    const f = path.join(dir, n);
    let c: unknown;
    try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const v = conversationOf(c, slug);
    if (v === 'own') {
      const id = n.slice(0, -5);
      if (rm(f)) deleted.push(f);
      for (const extra of [path.join(home, 'prompts', id + '.md'), path.join(home, 'mcp', id + '.json')]) if (fs.existsSync(extra) && rm(extra)) deleted.push(extra);
    } else if (v === 'shared' && isObj(c)) {
      const out: Record<string, unknown> = { ...c };
      if (out.product === slug) delete out.product;
      const rest = withoutSlug(out, slug);
      writeAtomic(f, JSON.stringify(rest ?? out, null, 2) + '\n');
      filtered.push(f);
    }
  }
  return { deleted, filtered };
}

/** Deletes the slug's brain space and every memory in it, and takes its rows out of the derivable index (its own short
 *  connection: the brain's writer may hold the file open in another bundle, and WAL lets both write in turn). */
function purgeBrain(slug: string): string[] {
  if (!validSpace(slug) || slug === 'core') return [];
  const deleted: string[] = [];
  const sp = spacePath(slug);
  if (fs.existsSync(sp) && rm(sp)) deleted.push(sp);
  for (const r of readAll().recs) {
    if (r.space !== slug) continue;
    let f: string;
    try { f = recPath(r); } catch { continue; }
    if (rm(f)) deleted.push(f);
  }
  const ix = indexPath();
  if (fs.existsSync(ix)) {
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(ix, { timeout: 2000 });
      db.exec('BEGIN');
      db.prepare('DELETE FROM mem_fts WHERE id IN (SELECT id FROM mem WHERE space = ?)').run(slug);
      db.prepare('DELETE FROM mem WHERE space = ?').run(slug);
      db.exec('COMMIT');
    } catch (e) {
      try { db?.exec('ROLLBACK'); } catch { /* no transaction */ }
      // the index is derivable: one that cannot be cleaned is set aside so the next open rebuilds it from the files
      try { db?.close(); db = null; fs.renameSync(ix, `${ix}.aside-${Date.now()}`); } catch { warnOnce('purge brain index ' + slug, e); }
    } finally { try { db?.close(); } catch { /* closed */ } }
  }
  return deleted;
}

/** Everything the companion keeps about the slug: own files deleted, shared files filtered (see the head of this file). */
export function filterCompanion(slug: string): { deleted: string[]; filtered: string[] } {
  const conv = purgeConversations(slug), brain = purgeBrain(slug);
  return { deleted: [...conv.deleted, ...brain], filtered: [...conv.filtered, ...filterShared(slug)] };
}

/** Filters the slug out of every shared top-level companion file and the focus record; the paths it changed. */
function filterShared(slug: string): string[] {
  const home = companionHome(), changed: string[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(home); } catch { /* no companion state yet */ }
  for (const n of names) {
    const f = path.join(home, n);
    if (!/\.jsonl?$/.test(n)) continue;
    try { if (!fs.statSync(f).isFile()) continue; } catch { continue; }
    if (filterFile(f, slug)) changed.push(f);
  }
  if (filterFocus(slug)) changed.push(focusFile());
  return changed;
}

/**
 * Remove a product: 404 unknown, 400 a bad purge list, 409 jobs that would not end; else its jobs ended, its store
 * connections closed, what was asked deleted or filtered, and last the registry line dropped.
 */
export async function removeWithPurge(slug: string, purgeQuery: string | null, waitMs?: number): Promise<RegistryResult<PurgeAnswer>> {
  const p = findProduct(slug);
  if (!p) return { ok: false, status: 404, error: `unknown product ${slug}` };
  const asked = parsePurge(purgeQuery);
  if (!asked.ok) return { ok: false, status: 400, error: asked.error };
  const left = await endJobsOf(slug, waitMs);
  if (left.length) return { ok: false, status: 409, error: `${left.length} job${left.length === 1 ? '' : 's'} of ${slug} would not end (${left.join(', ')}); nothing was deleted, try again` };
  closeStoresUnder(p.root);
  if (asked.value.includes('store')) deleteStore(p.root);
  if (asked.value.includes('companion')) filterCompanion(slug);
  const r = removeProduct(slug);
  if (!r.ok) return r;
  return { ok: true, value: { slug, purged: asked.value, kept: PURGE_TARGETS.filter((t) => !asked.value.includes(t)) } };
}
