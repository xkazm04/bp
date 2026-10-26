// The companion's two cross-product reads (spark companion-upgrade, P3): the inbox (open decisions across every registered
// product) and coverage gaps. Each reads every product of bp.products.local.json that has a lens-scan store, through its own
// read-only connection; a product that cannot be read is skipped and named in `skipped` with why, never silently dropped
// (an empty list must mean "nothing open", not "nothing readable"). The orders are rank.ts's.
// Inbox kinds: `proposal` = an open finding (status proposed); `triage` = a built item waiting for a person (done or
// failed, store DDL). `question` has no live source: a live store's swarm questions ARE its open proposals (swarm.ts
// swarmFromScan), and the sim's `ask` orders live in the browser. So no `question` item is produced today.
// Gaps: per enabled lens of the product's map and per feature, `unmeasured` (no current reading) or `stale` (the newest one
// is older than FRESH_MS); per coverage row, `unknown` or `deviation` (its `lens` is the row's standard). A feature's tier is
// the most severe of its open findings' tiers (proposed or approved) and its priority (P0..P3 -> 0..3); none -> untiered.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Gap, InboxItem } from '../../../companion/contract.ts';
import type { ProductEntry, ScanSnapshot } from '../../../scan/types.ts';
import { lastRead } from '../../../scan/derive.ts';
import { FRESH_MS } from '../../../scan/live-plan.ts';
import { PRODUCTS_FILE, hasStore, readRegistry, storeDir, storeFile } from '../../products.server.ts';
import { readSnapshot } from '../../store.server.ts';
import { gapScore, rankGaps, rankInbox, rankValue, type Ranked } from './rank.ts';
import { readRecommendations } from './door.server.ts';

if (typeof window !== 'undefined') throw new Error('views.server.ts is server-only');

export interface Skipped { product: string; why: string }

/** Every registered product's snapshot, or why it was skipped. `only` narrows to one slug. */
function snapshots(only?: string): { read: { p: ProductEntry; scan: ScanSnapshot }[]; skipped: Skipped[] } {
  const { products, problem } = readRegistry(), read: { p: ProductEntry; scan: ScanSnapshot }[] = [], skipped: Skipped[] = [];
  if (problem) skipped.push({ product: PRODUCTS_FILE, why: problem.error });
  for (const p of products) {
    if (only && p.slug !== only) continue;
    if (!hasStore(p)) { skipped.push({ product: p.slug, why: 'no scan store' }); continue; }
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(storeFile(p), { readOnly: true, timeout: 2000 });
      read.push({ p, scan: readSnapshot(db) });
    } catch (e) {
      skipped.push({ product: p.slug, why: `cannot read the scan store: ${(e as Error).message}` });
    } finally { try { db?.close(); } catch { /* closed */ } }
  }
  if (only && !products.some((p) => p.slug === only)) skipped.push({ product: only, why: 'not a registered product' });
  return { read, skipped };
}

const ageOf = (iso: string, now: number): number => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, now - t) : 0; };

export function inbox(limit: number, now = Date.now()): { items: InboxItem[]; skipped: Skipped[] } {
  const { read, skipped } = snapshots(), recs = readRecommendations(), out: Ranked[] = [];
  for (const { p, scan } of read) {
    const ev = rankValue(scan.proposals);
    for (const x of scan.proposals) {
      const kind = x.status === 'proposed' ? 'proposal' : x.status === 'done' || x.status === 'failed' ? 'triage' : null;
      if (!kind) continue;
      const rec = recs[`${p.slug}:${x.id}`];
      out.push({
        product: p.slug, id: x.id, kind, title: x.title, ...(x.tier !== undefined ? { tier: x.tier } : {}),
        ageMs: ageOf(kind === 'proposal' ? x.created_at : x.updated_at, now), value: ev.get(x.id) ?? 0,
        ...(rec ? { recommendation: { verdict: rec.verdict, why: rec.why } } : {}),
      });
    }
  }
  return { items: rankInbox(out).slice(0, limit), skipped };
}

interface MapFacts { features: { slug: string; priority?: string }[]; lenses: string[] }
function mapOf(p: ProductEntry): MapFacts | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(storeDir(p), 'app-structure.json'), 'utf8')) as { features?: unknown; lenses?: unknown };
    const features = (Array.isArray(j.features) ? j.features : []).filter((f): f is { slug: string; priority?: string } => !!f && typeof (f as { slug?: unknown }).slug === 'string');
    const lenses = (Array.isArray(j.lenses) ? j.lenses : []).filter((l) => l && typeof l.id === 'string' && l.enabled !== false).map((l) => l.id as string);
    return { features, lenses };
  } catch { return null; }
}

/** A feature's tier: the most severe of its open findings' tiers and its priority's number; undefined when it has neither. */
export function featureTiers(scan: Pick<ScanSnapshot, 'proposals'>, features: readonly { slug: string; priority?: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  const take = (f: string, t: number) => out.set(f, Math.min(out.get(f) ?? 3, t));
  for (const x of scan.proposals) if (x.tier !== undefined && (x.status === 'proposed' || x.status === 'approved')) take(x.feature, x.tier);
  for (const f of features) { const m = /^P([0-3])$/.exec(f.priority ?? ''); if (m) take(f.slug, Number(m[1])); }
  return out;
}

export function gaps(product: string | undefined, limit: number, now = Date.now()): { gaps: Gap[]; skipped: Skipped[] } {
  const { read, skipped } = snapshots(product), out: Gap[] = [];
  for (const { p, scan } of read) {
    const map = mapOf(p);
    if (!map) skipped.push({ product: p.slug, why: 'no readable app-structure.json: unmeasured and stale not computed' });
    const tiers = featureTiers(scan, map?.features ?? []);
    const add = (feature: string, lens: string, reason: Gap['reason']) => out.push({ product: p.slug, feature, lens, reason, score: gapScore(reason, tiers.get(feature)) });
    if (map) {
      const last = lastRead(scan.measurements);
      for (const lens of map.lenses) for (const f of map.features) {
        const t = last.get(lens)?.get(f.slug);
        if (t === undefined) add(f.slug, lens, 'unmeasured');
        else if (now - t > FRESH_MS) add(f.slug, lens, 'stale');
      }
    }
    const cov = new Map<string, (typeof scan.coverage)[number]>();
    for (const c of scan.coverage) cov.set(c.feature + '\u0000' + c.standard, c); // judged_at order: the last row wins
    for (const c of cov.values()) if (c.state === 'unknown' || c.state === 'deviation') add(c.feature, c.standard, c.state);
  }
  return { gaps: rankGaps(out).slice(0, limit), skipped };
}
