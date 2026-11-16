// The outcome watches of a product (train/watch.ts): `<root>/.ai/lens-scan/work/bp-watch.json` = { version: 1, watches },
// read on every call and written through writeAtomic, as bp-waves.json is (waves.server.ts): a file that cannot be read is
// said once and read as no watches; a READ never writes, and the write that follows moves the broken file to
// `bp-watch.corrupt.json` first. Shipping status stays the store's; the sidecar holds only the frozen targets, landing
// receipts and the checkpoint schedule with its job ids.
// Reconciling (on every read of the watches, so a restarted server catches up when the Release tab next asks): a due
// checkpoint queues one selection scan per lens through the journalled job queue (jobs.server.ts enqueueMeasure), each
// labelled `Watch v<version> · day <n>`. The job is journalled inside enqueue before the sidecar records its id, and a
// reconcile first adopts any job already in the registry under that label (the journal restores the registry after a
// restart), so a crash between the two never queues a checkpoint twice.
// Server-only. Not a decision: BP_WRITES=off leaves it on, like the rest of the Release tab (scan/writes.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { ProductEntry } from '../scan/types.ts';
import { evidenceOpts } from '../scan/track.ts';
import { checkpointPlan, newWatch, recordPlan, setWatchIn, watchesOf, type Watch, type WatchRefusal } from '../train/watch.ts';
import { enqueueMeasure, list, reconcileJobs } from './jobs.server.ts';
import { recovered, storeFile, warnOnce, writeAtomic } from './products.server.ts';
import { landings, triageBy } from './release.server.ts';
import { snapshotOf } from './store.server.ts';

if (typeof window !== 'undefined') throw new Error('watch.server.ts is server-only');

export const watchFile = (root: string): string => path.join(root, '.ai', 'lens-scan', 'work', 'bp-watch.json');

/** The product's watches; no file = none; a broken file = none, said once. Never writes. */
export function readWatches(root: string): Watch[] {
  const file = watchFile(root);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnOnce(file, e);
    return [];
  }
  try {
    const ws = watchesOf(JSON.parse(text));
    if (!ws) throw new Error('no "watches" array');
    recovered(file);
    return ws;
  } catch (e) { warnOnce(file, e); return []; }
}
function broken(root: string): boolean {
  try { return !watchesOf(JSON.parse(fs.readFileSync(watchFile(root), 'utf8'))); } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ENOENT'; }
}
function save(root: string, watches: Watch[]): void {
  const file = watchFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (broken(root)) {
    const aside = file.replace(/\.json$/, '.corrupt.json');
    fs.renameSync(file, aside);
    console.warn(`[bp] ${file} could not be read as watches and was moved to ${aside}; a new file was written in its place`);
  }
  writeAtomic(file, JSON.stringify({ version: 1, watches }, null, 2) + '\n');
}

/** The lens manifests of the product's map, for the bounds a target is checked against. */
export function mapLenses(root: string): { id?: string; manifest?: { fields?: { key?: string; min?: number; max?: number }[] } }[] {
  try { return (JSON.parse(fs.readFileSync(path.join(root, '.ai', 'lens-scan', 'app-structure.json'), 'utf8')) as { lenses?: [] }).lenses ?? []; } catch { return []; }
}

/** Turn release `relId`'s watch on (frozen now from the store, git's landings and the map's bounds) or off. */
export async function setWatch(p: ProductEntry, relId: string, on: boolean, now = new Date()): Promise<{ ok: true; watch: Watch } | WatchRefusal> {
  const all = readWatches(p.root);
  let w: Watch | null = null;
  if (on && !all.some((x) => x.release === relId)) {
    const scan = snapshotOf(storeFile(p));
    const made = newWatch(scan, relId, evidenceOpts(await landings(p.root, scan), mapLenses(p.root)), now.toISOString(), await triageBy());
    if (!made.ok) return made;
    w = made.watch;
  }
  const r = setWatchIn(all, w, relId, on, now.toISOString());
  if (!r.ok) return r;
  save(p.root, r.watches);
  return { ok: true, watch: r.watch };
}

/** Queue what is due (see the header) and answer the watches as they stand after it. */
export function reconcileWatches(slug: string, root: string, nowMs = Date.now()): Watch[] {
  const all = readWatches(root);
  if (!all.some((w) => !w.off_at)) return all;
  reconcileJobs(slug, root); // the journal first: after a restart the registry knows the checkpoint jobs only from it
  let moved = false;
  const next = all.map((w) => {
    const plans = checkpointPlan(w, nowMs, list(slug));
    if (!plans.length) return w;
    const queued = new Map<number, string[]>();
    for (const pl of plans) for (const q of pl.queue) {
      const r = enqueueMeasure(slug, root, q.lens, { kind: 'selection', label: q.label, features: q.features });
      if (r.ok) queued.set(pl.day, [...(queued.get(pl.day) ?? []), r.job.id]);
      else warnOnce(`watch ${w.release} day ${pl.day} ${q.lens}`, new Error(r.error));
    }
    moved = true;
    return recordPlan(w, plans, queued);
  });
  if (moved) { try { save(root, next); } catch (e) { warnOnce(watchFile(root), e); } }
  return next;
}
