// The owner's standing rules of a product, server half (scan/rules.ts is the pure half): `<root>/.ai/lens-scan/work/
// bp-rules.json` = { version: 1, rules }, beside bp-waves.json and scan.db, so Personas (which opens that directory
// already) reads them with no new IPC (docs/standard/rules-1.md). Read on every call, written through writeAtomic.
// A file that cannot be parsed is said once; the panel reads it as no rules, but the GATE FAILS CLOSED: no agent work
// starts while the owner's orders cannot be read. The owner's next write moves it to bp-rules.corrupt.json first, as
// waves.server.ts does. A file that cannot be read at all (busy, permissions) refuses writes (503), so a transient
// error never overwrites the rules; entries this version does not know are kept as they are on every write. Also here: the decided record a rule is replayed over (the store's decided findings,
// with the model and effort a wave built each with), and `gateBuild` / `gateScan`, the one call every agent door makes
// before it builds or scans (wave compose and dispatch, /dispatch, a lens's execute, scan.place).
import fs from 'node:fs';
import path from 'node:path';
import type { ProductEntry } from '../scan/types.ts';
import type { ScanScope } from '../scan/jobs.ts';
import { gate, gateWords, lensTrust, type Act, type DecidedRow, type GateAnswer, type HeldEntry, type OpenRow, type Rule, type RuleShape, type RulesFile } from '../scan/rules.ts';
import { hasStore, recovered, storeDir, storeFile, warnOnce, writeAtomic } from './products.server.ts';
import type { Room } from '../scan/rules-suggest.ts';
import { snapshotOf } from './store.server.ts';
import { listWaves } from './waves.server.ts';

if (typeof window !== 'undefined') throw new Error('rules.server.ts is server-only');

export const rulesFile = (root: string): string => path.join(root, '.ai', 'lens-scan', 'work', 'bp-rules.json');
const isRule = (x: unknown): x is Rule => {
  const r = x as Partial<Rule> | null;
  return !!r && typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.text === 'string' && typeof r.by === 'string' && typeof r.at === 'string'
    && !!r.scope && typeof r.scope === 'object' && Array.isArray(r.scope.features);
};

/** What reading the file came to: `raw` keeps every entry (known rules and ones this version does not know); `broken`
 *  = it exists but is not a rules file; `error` = it could not be read at all. A missing file is no rules. */
export type RulesRead = { raw: unknown[]; rules: Rule[]; broken?: string; error?: string };
export function readRules(root: string): RulesRead {
  const file = rulesFile(root);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { raw: [], rules: [] };
    warnOnce(file, e);
    return { raw: [], rules: [], error: (e as Error).message };
  }
  try {
    const xs = (JSON.parse(text) as Partial<RulesFile> | null)?.rules;
    if (!Array.isArray(xs)) throw new Error('no "rules" array');
    recovered(file);
    return { raw: xs, rules: xs.filter(isRule) };
  } catch (e) { warnOnce(file, e); return { raw: [], rules: [], broken: (e as Error).message }; }
}
/** The product's rules, as written (revoked and expired ones included); none when the file is missing or broken. */
export const listRules = (root: string): Rule[] => readRules(root).rules;

/** Thrown when the file cannot be read, so a write never replaces rules it could not see (the routes answer 503). */
export class RulesUnreadable extends Error {}
function save(root: string, read: RulesRead, raw: unknown[]): void {
  const file = rulesFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (read.broken) {
    const aside = file.replace(/\.json$/, '.corrupt.json');
    fs.renameSync(file, aside);
    console.warn(`[bp] ${file} could not be read as rules (${read.broken}) and was moved to ${aside}; a new file was written in its place`);
  }
  writeAtomic(file, JSON.stringify({ version: 1, rules: raw }, null, 2) + '\n');
}
const readForWrite = (root: string): RulesRead => {
  const r = readRules(root);
  if (r.error) throw new RulesUnreadable(`the standing rules cannot be read (${r.error}); nothing was written`);
  return r;
};

export function addRule(root: string, make: (rules: readonly Rule[]) => Rule): Rule {
  const read = readForWrite(root), r = make(read.rules);
  save(root, read, [...read.raw, r]);
  return r;
}
/** Revoke a live rule (it stays in the file as the record). 404 unknown, 409 already revoked. */
export function revokeRule(root: string, id: string, by: string, now = Date.now()): { ok: true; rule: Rule } | { ok: false; status: 404 | 409; error: string } {
  const read = readForWrite(root), r = read.rules.find((x) => x.id === id);
  if (!r) return { ok: false, status: 404, error: `no rule ${id}` };
  if (r.revokedAt) return { ok: false, status: 409, error: `rule ${id} was revoked ${r.revokedAt}` };
  const next: Rule = { ...r, revokedAt: new Date(now).toISOString(), revokedBy: by };
  let done = false; // the first entry with that id only: a duplicate id (two processes writing at once) keeps its own entry
  save(root, read, read.raw.map((x) => (!done && isRule(x) && x.id === id ? ((done = true), next) : x)));
  return { ok: true, rule: next };
}

// ------------------------------------------------------------------------------------------------ the record
/** Decisions an agent made under the owner's standing permission are signed `rule:G-n` (a rule grant) or `policy:pol_..`
 *  (a companion policy) by the routes (door.server.ts agentSigner): never the person's. The record a rule is replayed over,
 *  earns trust on and finds breaches in is the OWNER's, so those rows are left out of it. */
export const AGENT_SIGNS = ['rule:', 'policy:'] as const;
const byAgent = (by: string | undefined): boolean => !!by && AGENT_SIGNS.some((p) => by.startsWith(p));

/** Seeded history (scripts/seed-rules-history.mjs) runs under this run-id prefix, so it is labelled wherever it shows. */
export const SYNTHETIC_RUN = 'syn-';

/** Every finding the owner decided, newest first: approve = any status a decision to build leads to, decline = declined.
 *  The model and effort come from the wave package that holds it, when one does. */
export function decidedRows(p: ProductEntry): DecidedRow[] {
  if (!hasStore(p)) return [];
  const built = new Map<string, { model: string; effort: string }>();
  for (const w of listWaves(p.root)) for (const k of w.packages) for (const id of k.ids) built.set(id, { model: k.model, effort: k.effort });
  const out: DecidedRow[] = [];
  for (const x of snapshotOf(storeFile(p)).proposals) {
    if (x.status === 'proposed' || !x.decided_at || byAgent(x.decided_by)) continue;
    const b = built.get(x.id);
    out.push({
      id: x.id, title: x.title, feature: x.feature, lens: x.lens,
      ...(x.tier !== undefined && x.tier !== null ? { tier: x.tier } : {}), ...(x.risk_class ? { risk_class: x.risk_class } : {}),
      owner: x.status === 'declined' ? 'decline' : 'approve', by: x.decided_by ?? 'unknown', at: x.decided_at,
      ...(b ? { model: b.model, effort: b.effort } : {}), ...(x.run_id.startsWith(SYNTHETIC_RUN) ? { synthetic: true } : {}),
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The open findings (proposed or approved), what a rule acts on the moment it is set. */
export function openRows(p: ProductEntry): OpenRow[] {
  if (!hasStore(p)) return [];
  return snapshotOf(storeFile(p)).proposals.filter((x) => x.status === 'proposed' || x.status === 'approved')
    .map((x) => ({ id: x.id, title: x.title, feature: x.feature, lens: x.lens, ...(x.tier !== undefined && x.tier !== null ? { tier: x.tier } : {}) }));
}

/** The map's rooms (capabilities) with their features, for suggestions; [] when the map cannot be read. */
export function roomsOf(p: ProductEntry): Room[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(storeDir(p), 'app-structure.json'), 'utf8')) as { capabilities?: { slug?: unknown; name?: unknown }[]; features?: { slug?: unknown; capability?: unknown }[] };
    const by = new Map<string, string[]>();
    for (const f of j.features ?? []) if (typeof f?.slug === 'string' && typeof f.capability === 'string') by.set(f.capability, [...(by.get(f.capability) ?? []), f.slug]);
    return (j.capabilities ?? []).filter((c) => typeof c?.slug === 'string' && by.has(c.slug as string))
      .map((c) => ({ id: c.slug as string, label: typeof c.name === 'string' ? c.name : (c.slug as string), features: by.get(c.slug as string)! }));
  } catch { return []; }
}

/** The lenses a cautious grant has earned (scan/rules.ts lensTrust): where it may act alone. Earned on the owner's REAL
 *  decisions only: seeded synthetic history shows in the replay, labelled, but never lets an agent act at a door. */
export const trustedLenses = (r: RuleShape, decided: readonly DecidedRow[]): Set<string> =>
  new Set(lensTrust(r, decided.filter((x) => !x.synthetic)).filter((t) => t.trusted).map((t) => t.lens));

/** The finding ids as gate items (feature, lens, tier); ids the store lacks are left out (the door refuses them itself). */
export function itemsOf(p: ProductEntry, ids: readonly string[]): { id: string; feature: string; lens: string; tier?: number }[] {
  if (!ids.length || !hasStore(p)) return [];
  const want = new Set(ids);
  return snapshotOf(storeFile(p)).proposals.filter((x) => want.has(x.id))
    .map((x) => ({ id: x.id, feature: x.feature, lens: x.lens, ...(x.tier !== undefined && x.tier !== null ? { tier: x.tier } : {}) }));
}

// ------------------------------------------------------------------------------------------------ the log
const logFile = (root: string): string => path.join(root, '.ai', 'lens-scan', 'work', 'bp-rules-log.jsonl');
export const LOG_MAX = 2000;
/** Append what a door held or refused (one line per rule per act); a log that cannot be written is said once, never fatal. */
function logHeld(root: string, g: GateAnswer, tool: string): void {
  const at = new Date().toISOString(), by = new Map<string, string[]>();
  for (const h of g.held) by.set(h.order.id, [...(by.get(h.order.id) ?? []), h.id]);
  if (g.refused && !by.size) by.set(g.refused.id, []);
  const lines = [...by].map(([rule, ids]) => JSON.stringify({ at, rule, tool, ids, refused: !!g.refused } satisfies HeldEntry)).join('\n');
  if (!lines) return;
  try { fs.mkdirSync(path.dirname(logFile(root)), { recursive: true }); fs.appendFileSync(logFile(root), lines + '\n'); } catch (e) { warnOnce(logFile(root), e); }
}
/** The newest LOG_MAX lines of the log; torn or foreign lines are skipped. */
export function readHeld(root: string): HeldEntry[] {
  let text = '';
  try { text = fs.readFileSync(logFile(root), 'utf8'); } catch { return []; }
  const out: HeldEntry[] = [];
  for (const line of text.split('\n').slice(-LOG_MAX - 1)) {
    try { const e = JSON.parse(line) as HeldEntry; if (e && typeof e.rule === 'string' && typeof e.at === 'string' && Array.isArray(e.ids)) out.push(e); } catch { /* torn */ }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the doors' gate
/** The gate's answer for an act on this product, with the words a door answers in. */
export interface Gated extends GateAnswer { words: string }
const answer = (g: GateAnswer): Gated => ({ ...g, words: g.held.length || g.refused ? gateWords(g) : '' });
/** The gate FAILS CLOSED: while bp-rules.json exists but cannot be read, no agent work starts (the owner's next write, or
 *  fixing the file, lifts it). The refusal cites the file, as an order would. */
function unreadable(read: RulesRead, items: readonly { id: string; feature: string }[]): Gated | null {
  const why = read.broken ?? read.error;
  if (!why) return null;
  const cite = { id: 'bp-rules.json', kind: 'hold' as const, by: 'bp', at: new Date().toISOString(), text: `bp-rules.json (the owner's standing rules) cannot be read (${why}): no agent work starts until it can`, place: 'everything' };
  return { held: items.map((it) => ({ id: it.id, feature: it.feature, order: cite })), refused: cite, words: `refused: ${cite.text}` };
}

/** The gate over a build. `opts.log: false` (a dry forecast, POST dispatch `{ dry: true }`) answers the same and appends
 *  nothing to the held log, so a preview never counts in the Rules tally; the default logs, as before. */
export function gateBuild(p: ProductEntry, tool: string, ids: readonly string[], model?: string, effort?: string, opts: { log?: boolean } = {}): Gated {
  const read = readRules(p.root), rules = read.rules;
  const bad = unreadable(read, ids.map((id) => ({ id, feature: '' })));
  if (bad) return bad;
  if (!rules.length) return { held: [], words: '' };
  const act: Act = { kind: 'build', tool, items: itemsOf(p, ids), ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  const g = gate(rules, act);
  if (g.held.length && opts.log !== false) logHeld(p.root, g, tool);
  return answer(g);
}
export function gateScan(p: ProductEntry, tool: string, lens: string, scope: ScanScope): Gated {
  const read = readRules(p.root), rules = read.rules, bad = unreadable(read, []);
  if (bad) return bad;
  if (!rules.length) return { held: [], words: '' };
  const g = gate(rules, { kind: 'scan', tool, lens, scope });
  if (g.refused) logHeld(p.root, g, tool);
  return answer(g);
}
/** The 403 a door answers when an order refuses the whole act: the order's id, author, time and words travel with it. */
export const refusedBy = (g: Gated): Response => Response.json({ error: g.words, order: g.refused, held: g.held }, { status: 403 });
