// The Morning Watch, server half: every registered live product's store and plan, read once per request through the
// companion's own read-only snapshots (views.server.ts), handed to the pure deck (companion/morning.ts); and the owner's
// steering, one row per decision in the product's own steering log (<root>/.ai/lens-scan/work/steering-log.jsonl, beside
// bp-waves.json), with the day's log rendered next to it as steering-log.md - the "Daily Steering Log" a person can read
// or export. Approve is the only verdict that writes the product's store: it is the same `decide` the plan's Approve
// calls (proposed -> approved, signed like every bp decision), refused while BP_WRITES=off. Defer and Hold are the
// owner's word only, kept in the log: a deferred decision leaves the deck until tomorrow morning, a held one stays, marked.
import fs from 'node:fs';
import path from 'node:path';
import { buildDeck, closeLines, decidedElsewhere, type MorningDeck, type ProductFacts, type SteerRow, type Verdict, type Where } from '../../../companion/morning.ts';
import type { ProductEntry } from '../../../scan/types.ts';
import { writesOff } from '../../../scan/writes.ts';
import { findProduct, hasStore, storeDir, storeFile, warnOnce } from '../../products.server.ts';
import { decide, mapRev } from '../../store.server.ts';
import { projectPlan } from '../../plan-projection.ts';
import { triageBy } from '../../release.server.ts';
import { snapshots } from './views.server.ts';

if (typeof window !== 'undefined') throw new Error('morning.server.ts is server-only');

/** The window a morning covers when the caller names none: the last 16 hours (yesterday evening onwards). */
export const WINDOW_MS = 16 * 3600e3;
/** A deferred decision comes back after this long: tomorrow morning. */
export const DEFER_MS = 20 * 3600e3;

const logFile = (p: ProductEntry): string => path.join(storeDir(p), 'work', 'steering-log.jsonl');
const mdFile = (p: ProductEntry): string => path.join(storeDir(p), 'work', 'steering-log.md');

/** feature -> its room and wing on the product's plan, and the lens manifests' metric labels, cached per map rev. */
interface MapFacts { where: Map<string, Where>; labels: Map<string, string> }
const g = globalThis as unknown as { __bpMorningMaps?: Map<string, { rev: string; facts: MapFacts }> };
function whereOf(p: ProductEntry): MapFacts {
  const cache = (g.__bpMorningMaps ??= new Map()), dir = storeDir(p), rev = mapRev(dir), hit = cache.get(p.root);
  if (hit && hit.rev === rev) return hit.facts;
  const where = new Map<string, Where>(), labels = new Map<string, string>();
  try {
    let events = '';
    try { events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'); } catch { /* no events log */ }
    const map = JSON.parse(fs.readFileSync(path.join(dir, 'app-structure.json'), 'utf8')) as { lenses?: { id?: string; manifest?: { fields?: { key?: string; label?: string }[] } }[] };
    for (const l of map.lenses ?? []) for (const f of l.manifest?.fields ?? []) if (l.id && f.key && f.label) labels.set(l.id + '|' + f.key, f.label);
    const plan = projectPlan(map, events, rev);
    const wings = new Map(plan.wings.map((w) => [w.id, w])), rooms = new Map(plan.rooms.map((r) => [r.id, r])), bays = new Map(plan.bays.map((b) => [b.id, b]));
    for (const t of plan.tiles) {
      const room = rooms.get(bays.get(t.parentId)?.parentId ?? ''), wing = room ? wings.get(room.parentId) : undefined;
      if (room && wing) where.set(t.id, { room: room.id, roomName: room.name, wing: wing.id, wingName: wing.name, name: t.name });
    }
  } catch (e) { warnOnce('morning plan ' + p.slug, e); }
  const facts = { where, labels };
  cache.set(p.root, { rev, facts });
  return facts;
}

export function readSteer(p: ProductEntry): SteerRow[] {
  let text = '';
  try { text = fs.readFileSync(logFile(p), 'utf8'); } catch { return []; }
  const out: SteerRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line) as SteerRow; if (r && typeof r.proposal === 'string' && typeof r.verdict === 'string') out.push(r); } catch { /* a torn last line */ }
  }
  return out;
}

/** The deck for the window [since, now]; products that cannot be read are named in `skipped`, never dropped silently. */
export function morningDeck(since: string | undefined, now = Date.now()): MorningDeck & { skipped: { product: string; why: string }[] } {
  const from = since && Number.isFinite(Date.parse(since)) ? new Date(Date.parse(since)).toISOString() : new Date(now - WINDOW_MS).toISOString();
  const { read, skipped } = snapshots();
  const facts: ProductFacts[] = [], steer: SteerRow[] = [];
  for (const { p, scan } of read) {
    facts.push({ slug: p.slug, name: p.name, scan, ...whereOf(p) });
    steer.push(...readSteer(p));
  }
  const deck = buildDeck(facts, steer, from, now);
  const close = deck.cards.find((c) => c.kind === 'close');
  const logs = read.map(({ p }) => path.relative(p.root, mdFile(p)).split(path.sep).join('/'));
  if (close) close.lines = closeLines(steer.sort((a, b) => (a.at < b.at ? -1 : 1)), from, logs.length ? `${logs[0]} in each product` : 'none', decidedElsewhere(facts, steer, from, deck.until));
  return { ...deck, skipped };
}

export type SteerResult = { status: 200; row: SteerRow } | { status: 400 | 403 | 404 | 409 | 503; error: string };

/** One verdict on one open decision. */
export async function steer(product: string, proposal: string, verdict: Verdict, now = Date.now()): Promise<SteerResult> {
  const p = findProduct(product);
  if (!p || !hasStore(p)) return { status: 404, error: `no live product ${product}` };
  const { read } = snapshots(product), x = read[0]?.scan.proposals.find((r) => r.id === proposal);
  if (!x) return { status: 404, error: `no proposal ${proposal} in ${product}` };
  if (x.status !== 'proposed') return { status: 409, error: `${proposal} is already ${x.status}` };
  const by = await triageBy();
  // asked gh the first time: someone may have decided while we waited
  const again = snapshots(product).read[0]?.scan.proposals.find((r) => r.id === proposal);
  if (again && again.status !== 'proposed') return { status: 409, error: `${proposal} is already ${again.status}` };
  if (verdict === 'approve') {
    const off = writesOff();
    if (off) return { status: 403, error: off };
    try {
      const r = decide(storeFile(p), proposal, { decision: 'approve', note: 'Morning Watch' }, by);
      if (!r.ok) return { status: r.status === 404 ? 404 : 409, error: r.status === 404 ? `no proposal ${proposal}` : `${proposal} was decided first` };
    } catch (e) { return { status: 503, error: `decision failed: ${(e as Error).message}` }; }
  }
  const row: SteerRow = { at: new Date(now).toISOString(), product, proposal, verdict, title: x.title, by, ...(verdict === 'defer' ? { until: new Date(now + DEFER_MS).toISOString() } : {}) };
  try {
    fs.mkdirSync(path.dirname(logFile(p)), { recursive: true });
    fs.appendFileSync(logFile(p), JSON.stringify(row) + '\n');
  } catch (e) {
    // an approve is already in the store: say it happened and that the log missed it (never a 503 that invites a retry)
    if (verdict === 'approve') return { status: 200, row: { ...row, warning: `approved, but the steering log could not be written: ${(e as Error).message}` } };
    return { status: 503, error: `the steering log could not be written: ${(e as Error).message}` };
  }
  try { fs.writeFileSync(mdFile(p), renderLog(p, readSteer(p), now)); } catch { /* the .md renders the jsonl; the next verdict writes it again */ }
  return { status: 200, row };
}

/** The day's steering log as Markdown: what was decided this morning, newest last. */
export function renderLog(p: ProductEntry, rows: readonly SteerRow[], now: number): string {
  // "today" is the morning's own window (the last 20 h), not a UTC calendar day that can split one morning in two
  const day = new Date(now).toISOString().slice(0, 10), from = new Date(now - DEFER_MS).toISOString(), today = rows.filter((r) => r.at >= from);
  const word = (v: Verdict) => (v === 'approve' ? 'Approved' : v === 'defer' ? 'Deferred to tomorrow' : 'Held');
  return [`# Daily steering log - ${p.name}, ${day}`, '', 'Written by bp\'s Morning Watch; one line per decision. Approve also moved the finding to approved in this store.', '',
    ...(today.length ? today.map((r) => `- ${r.at.slice(11, 16)} UTC - ${word(r.verdict)}: ${r.title} (\`${r.proposal}\`, ${r.by})`) : ['- Nothing decided yet today.']), ''].join('\n');
}
