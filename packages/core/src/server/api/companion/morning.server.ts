// The Morning Watch, server half: every registered live product's store and plan, read once per request through the
// companion's own read-only snapshots (views.server.ts), handed to the pure deck (companion/morning.ts); and the owner's
// steering, one row per decision in the product's own steering log (<root>/.ai/lens-scan/work/steering-log.jsonl, beside
// bp-waves.json), with the day's log rendered next to it as steering-log.md - the "Daily Steering Log" a person can read
// or export; the .md is rendered again on every read of the deck, so rows another writer appends show up there too.
// Approve is the only verdict that writes the product's store: it is the same `decide` the plan's Approve
// calls (proposed -> approved, signed like every bp decision), refused while BP_WRITES=off. Defer and Hold are the
// owner's word only, kept in the log: a deferred decision leaves the deck until tomorrow morning, a held one stays, marked.
import fs from 'node:fs';
import path from 'node:path';
import type { DeciderMarks } from '../../decider.server.ts';
import { buildDeck, cardBrief, closeLines, decidedElsewhere, type MorningDeck, type ProductFacts, type SteerRow, type Verdict, type Where } from '../../../companion/morning.ts';
import { briefMapOf, briefMapOfStructure, type BriefMap } from '../../../scan/brief.ts';
import { evidenceOpts } from '../../../scan/track.ts';
import type { ProductEntry, Proposal } from '../../../scan/types.ts';
import { writesOff } from '../../../scan/writes.ts';
import { loadMap } from '../../../data/index.ts';
import { findProduct, hasStore, storeDir, storeFile, warnOnce } from '../../products.server.ts';
import { decide } from '../../store.server.ts';
import { readProductMap } from '../../map.server.ts';
import { projectPlan } from '../../plan-projection.ts';
import { landings, triageBy } from '../../release.server.ts';
import { readTrail } from '../../brief.server.ts';
import { listRules } from '../../rules.server.ts';
import { gate, isLive } from '../../../scan/rules.ts';
import { snapshots } from './views.server.ts';

if (typeof window !== 'undefined') throw new Error('morning.server.ts is server-only');

/** The window a morning covers when the caller names none: the last 16 hours (yesterday evening onwards). */
export const WINDOW_MS = 16 * 3600e3;
/** A deferred decision comes back after this long: tomorrow morning. */
export const DEFER_MS = 20 * 3600e3;

const logFile = (p: ProductEntry): string => path.join(storeDir(p), 'work', 'steering-log.jsonl');
const mdFile = (p: ProductEntry): string => path.join(storeDir(p), 'work', 'steering-log.md');

/** feature -> its room and wing on the product's plan, the lens manifests' metric labels, and the plan as the decision brief
 *  reads it (through the loader the browser uses, as brief.server.ts does), cached per map rev (the map itself is
 *  map.server.ts's, read once per rev for every route). */
interface MapFacts { where: Map<string, Where>; labels: Map<string, string>; map: BriefMap; lenses: MapLens[] }
type MapLens = { id?: string; manifest?: { fields?: { key?: string; label?: string; min?: number; max?: number }[] } };
const g = globalThis as unknown as { __bpMorningMaps?: Map<string, { rev: string; facts: MapFacts }> };
function whereOf(p: ProductEntry): MapFacts {
  const cache = (g.__bpMorningMaps ??= new Map()), m = readProductMap(p), rev = m.ok ? m.rev : '', hit = cache.get(p.root);
  if (hit && rev && hit.rev === rev) return hit.facts;
  const where = new Map<string, Where>(), labels = new Map<string, string>();
  let brief: BriefMap = briefMapOf({}), lenses: MapLens[] = [];
  try {
    if (!m.ok) throw new Error(m.error);
    const events = m.events, map = m.doc as { lenses?: MapLens[] };
    lenses = map.lenses ?? [];
    for (const l of map.lenses ?? []) for (const f of l.manifest?.fields ?? []) if (l.id && f.key && f.label) labels.set(l.id + '|' + f.key, f.label);
    const plan = projectPlan(map, events, rev);
    const wings = new Map(plan.wings.map((w) => [w.id, w])), rooms = new Map(plan.rooms.map((r) => [r.id, r])), bays = new Map(plan.bays.map((b) => [b.id, b]));
    for (const t of plan.tiles) {
      const room = rooms.get(bays.get(t.parentId)?.parentId ?? ''), wing = room ? wings.get(room.parentId) : undefined;
      if (room && wing) where.set(t.id, { room: room.id, roomName: room.name, wing: wing.id, wingName: wing.name, name: t.name });
    }
    try { brief = briefMapOfStructure(loadMap(map, events)); } catch (e) { warnOnce('morning brief map ' + p.slug, e); }
  } catch (e) { warnOnce('morning plan ' + p.slug, e); }
  const facts = { where, labels, map: brief, lenses };
  cache.set(p.root, { rev, facts });
  return facts;
}

/** The open findings a live order holds, as the inbox reads them (views.server.ts). A cap is left out: a wave that names its
 *  effort still builds there, so "no agent door" would be untrue of it. */
function ordersOf(p: ProductEntry, proposals: readonly Proposal[], now: number): Map<string, string> {
  const rules = listRules(p.root).filter((r) => r.kind !== 'cap' && isLive(r, now)), items = proposals.filter((x) => x.status === 'proposed').map((x) => ({ id: x.id, feature: x.feature, lens: x.lens }));
  return new Map(rules.length ? gate(rules, { kind: 'build', tool: 'morning.brief', items }, now).held.map((h) => [h.id, h.order.id]) : []);
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

/** The deck for the window [since, now]; products that cannot be read are named in `skipped`, never dropped silently.
 *  `opened`: when the reader first read this morning's deck; what landed after it comes as news, at the end. Each
 *  product's landings are read from git (release.server.ts landings); one git cannot read lands nothing there. */
export async function morningDeck(since: string | undefined, now = Date.now(), opened?: string): Promise<MorningDeck & { skipped: { product: string; why: string }[] }> {
  const from = since && Number.isFinite(Date.parse(since)) ? new Date(Date.parse(since)).toISOString() : new Date(now - WINDOW_MS).toISOString();
  const cut = opened && Number.isFinite(Date.parse(opened)) ? new Date(Date.parse(opened)).toISOString() : undefined;
  const { read, skipped } = snapshots();
  const facts: ProductFacts[] = [], steer: SteerRow[] = [];
  const landed = await Promise.all(read.map(({ p, scan }) => landings(p.root, scan).catch(() => null)));
  for (const [i, { p, scan }] of read.entries()) {
    const l = landed[i];
    const { lenses, ...mf } = whereOf(p), { contains, bounds } = evidenceOpts(l, lenses);
    facts.push({ slug: p.slug, name: p.name, scan, ...mf, orders: ordersOf(p, scan.proposals, now), evidence: { ...(contains ? { contains } : {}), ...(bounds ? { bounds } : {}) }, ...(l?.state === 'known' ? { landed: { ref: l.ref, items: l.items } } : {}) });
    const rows = readSteer(p);
    // the deck carries the SteerRow shape (morning-deck schema); who decided and where stays in the log's own row
    steer.push(...rows.map(({ surface: _s, device: _d, shown: _w, ...r }: SteerRow & Partial<DeciderMarks>) => r));
    renderOnRead(p, rows, now);
  }
  const deck = buildDeck(facts, steer, from, now, readTrail(), cut);
  const close = deck.cards.find((c) => c.kind === 'close');
  const logs = read.map(({ p }) => path.relative(p.root, mdFile(p)).split(path.sep).join('/'));
  if (close) close.lines = closeLines(steer.sort((a, b) => (a.at < b.at ? -1 : 1)), from, logs.length ? `${logs[0]} in each product` : 'none', decidedElsewhere(facts, steer, from, deck.until));
  return { ...deck, skipped };
}

export type SteerResult = { status: 200; row: SteerRow } | { status: 400 | 403 | 404 | 409 | 503; error: string };

/** One verdict on one open decision. */
/** `marks`: who decided and where (decider.server.ts). A table's row carries them (surface vr, device, shown) and its approve
 *  says so in the store note; the page's row keeps the plain SteerRow shape (morning-deck-1), so a row without `surface` is
 *  the page's, and decisions.jsonl records both. */
export async function steer(product: string, proposal: string, verdict: Verdict, now = Date.now(), marks?: DeciderMarks): Promise<SteerResult> {
  const p = findProduct(product);
  if (!p || !hasStore(p)) return { status: 404, error: `no live product ${product}` };
  const { read } = snapshots(product), x = read[0]?.scan.proposals.find((r) => r.id === proposal);
  if (!x) return { status: 404, error: `no proposal ${proposal} in ${product}` };
  if (x.status !== 'proposed') return { status: 409, error: `${proposal} is already ${x.status}` };
  const by = await triageBy();
  // asked gh the first time: someone may have decided while we waited
  const now2 = snapshots(product).read[0]?.scan ?? read[0]!.scan, again = now2.proposals.find((r) => r.id === proposal);
  if (again && again.status !== 'proposed') return { status: 409, error: `${proposal} is already ${again.status}` };
  // Decline is the card brief's recommendation, never a free verdict here: only the same idea declined before (advice
  // 'withdraw') takes it, and the note is the brief's own "Repeats <id> ..." - the plan's Decline writes the same (live-feed.ts)
  let note: string | undefined;
  if (verdict === 'decline') {
    const b = cardBrief({ scan: now2, map: whereOf(p).map }, again ?? x);
    if (b.recommend !== 'decline' || !b.note) return { status: 409, error: `${proposal} does not repeat a declined idea: decline it on the plan, with your own note` };
    note = b.note;
  }
  if (verdict === 'approve' || verdict === 'decline') {
    const off = writesOff();
    if (off) return { status: 403, error: off };
    try {
      const r = decide(storeFile(p), proposal, verdict === 'approve' ? { decision: 'approve', note: marks?.surface === 'vr' ? `Morning Watch, from the table (${marks.device ?? 'a headset'})` : 'Morning Watch' } : { decision: 'decline', note: note! }, by);
      if (!r.ok) return { status: r.status === 404 ? 404 : 409, error: r.status === 404 ? `no proposal ${proposal}` : `${proposal} was decided first` };
    } catch (e) { return { status: 503, error: `decision failed: ${(e as Error).message}` }; }
  }
  const row: SteerRow = { at: new Date(now).toISOString(), product, proposal, verdict, title: x.title, by, ...(verdict === 'defer' ? { until: new Date(now + DEFER_MS).toISOString() } : {}), ...(note ? { note } : {}), ...(marks?.surface === 'vr' ? marks : {}) };
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

/** The .md is a rendering of the .jsonl, so it is rendered on every read of the deck too: a row another writer appended
 *  (Personas, a script, a second bp) reaches the readable log without a bp steer (roadmap C3). Written only when it
 *  differs; a log nobody steered into stays absent. */
function renderOnRead(p: ProductEntry, rows: readonly SteerRow[], now: number): void {
  if (!rows.length) return;
  const md = renderLog(p, rows, now);
  try { if (fs.readFileSync(mdFile(p), 'utf8') === md) return; } catch { /* not rendered yet */ }
  try { fs.writeFileSync(mdFile(p), md); } catch (e) { warnOnce('steering log ' + p.slug, e); }
}

/** The day's steering log as Markdown: what was decided this morning, newest last. */
export function renderLog(p: ProductEntry, rows: readonly SteerRow[], now: number): string {
  // "today" is the morning's own window (the last 20 h), not a UTC calendar day that can split one morning in two
  const day = new Date(now).toISOString().slice(0, 10), from = new Date(now - DEFER_MS).toISOString(), today = rows.filter((r) => r.at >= from);
  const word = (v: Verdict) => (v === 'approve' ? 'Approved' : v === 'defer' ? 'Deferred to tomorrow' : v === 'decline' ? 'Declined as a repeat' : 'Held');
  return [`# Daily steering log - ${p.name}, ${day}`, '', 'Written by bp\'s Morning Watch; one line per decision. Approve and Decline also moved the finding in this store.', '',
    ...(today.length ? today.map((r) => `- ${r.at.slice(11, 16)} UTC - ${word(r.verdict)}: ${r.title} (\`${r.proposal}\`, ${r.by})${r.note ? ' - ' + r.note : ''}`) : ['- Nothing decided yet today.']), ''].join('\n');
}
