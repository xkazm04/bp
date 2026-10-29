// The owner's standing rules of a product, server half (scan/rules.ts is the pure half): `<root>/.ai/lens-scan/work/
// bp-rules.json` = { version: 1, rules }, beside bp-waves.json and scan.db, so Personas (which opens that directory
// already) reads them with no new IPC (docs/standard/rules-1.md). Read on every call, written through writeAtomic; a
// file that cannot be read is said once and read as no rules, and the next write moves it to bp-rules.corrupt.json
// first, as waves.server.ts does. Also here: the decided record a rule is replayed over (the store's decided findings,
// with the model and effort a wave built each with), and `gateBuild` / `gateScan`, the one call every agent door makes
// before it builds or scans (wave compose and dispatch, /dispatch, a lens's execute, scan.place).
import fs from 'node:fs';
import path from 'node:path';
import type { ProductEntry } from '../scan/types.ts';
import type { ScanScope } from '../scan/jobs.ts';
import { gate, gateWords, type Act, type DecidedRow, type GateAnswer, type OpenRow, type Rule, type RulesFile } from '../scan/rules.ts';
import { hasStore, recovered, storeFile, warnOnce, writeAtomic } from './products.server.ts';
import { snapshotOf } from './store.server.ts';
import { listWaves } from './waves.server.ts';

if (typeof window !== 'undefined') throw new Error('rules.server.ts is server-only');

export const rulesFile = (root: string): string => path.join(root, '.ai', 'lens-scan', 'work', 'bp-rules.json');
const isRule = (x: unknown): x is Rule => {
  const r = x as Partial<Rule> | null;
  return !!r && typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.text === 'string' && typeof r.by === 'string' && typeof r.at === 'string'
    && !!r.scope && typeof r.scope === 'object' && Array.isArray(r.scope.features);
};

/** The product's rules, newest last as written; no file = none; a broken file = none, said once. Never writes. */
export function listRules(root: string): Rule[] {
  const file = rulesFile(root);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnOnce(file, e);
    return [];
  }
  try {
    const xs = (JSON.parse(text) as Partial<RulesFile> | null)?.rules;
    if (!Array.isArray(xs)) throw new Error('no "rules" array');
    recovered(file);
    return xs.filter(isRule);
  } catch (e) { warnOnce(file, e); return []; }
}

function save(root: string, rules: Rule[]): void {
  const file = rulesFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let broken = false;
  try { broken = !Array.isArray((JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RulesFile>)?.rules); } catch (e) { broken = (e as NodeJS.ErrnoException).code !== 'ENOENT'; }
  if (broken) {
    const aside = file.replace(/\.json$/, '.corrupt.json');
    fs.renameSync(file, aside);
    console.warn(`[bp] ${file} could not be read as rules and was moved to ${aside}; a new file was written in its place`);
  }
  const doc: RulesFile = { version: 1, rules };
  writeAtomic(file, JSON.stringify(doc, null, 2) + '\n');
}

export function addRule(root: string, make: (rules: readonly Rule[]) => Rule): Rule {
  const rules = listRules(root), r = make(rules);
  save(root, [...rules, r]);
  return r;
}
/** Revoke a live rule (it stays in the file as the record). 404 unknown, 409 already revoked. */
export function revokeRule(root: string, id: string, by: string, now = Date.now()): { ok: true; rule: Rule } | { ok: false; status: 404 | 409; error: string } {
  const rules = listRules(root), r = rules.find((x) => x.id === id);
  if (!r) return { ok: false, status: 404, error: `no rule ${id}` };
  if (r.revokedAt) return { ok: false, status: 409, error: `rule ${id} was revoked ${r.revokedAt}` };
  const next: Rule = { ...r, revokedAt: new Date(now).toISOString(), revokedBy: by };
  save(root, rules.map((x) => (x.id === id ? next : x)));
  return { ok: true, rule: next };
}

// ------------------------------------------------------------------------------------------------ the record
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
    if (x.status === 'proposed' || !x.decided_at || x.decided_by?.startsWith(RULE_SIGN)) continue;
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

/** Decisions made under a grant are signed `rule:<id>` (door.server.ts): the record a rule is replayed over is the
 *  owner's, so they are left out of it. */
export const RULE_SIGN = 'rule:';

/** The open findings (proposed or approved), what a rule acts on the moment it is set. */
export function openRows(p: ProductEntry): OpenRow[] {
  if (!hasStore(p)) return [];
  return snapshotOf(storeFile(p)).proposals.filter((x) => x.status === 'proposed' || x.status === 'approved')
    .map((x) => ({ id: x.id, title: x.title, feature: x.feature, lens: x.lens, ...(x.tier !== undefined && x.tier !== null ? { tier: x.tier } : {}) }));
}

/** The finding ids as gate items (feature, lens, tier); ids the store lacks are left out (the door refuses them itself). */
export function itemsOf(p: ProductEntry, ids: readonly string[]): { id: string; feature: string; lens: string; tier?: number }[] {
  if (!ids.length || !hasStore(p)) return [];
  const want = new Set(ids);
  return snapshotOf(storeFile(p)).proposals.filter((x) => want.has(x.id))
    .map((x) => ({ id: x.id, feature: x.feature, lens: x.lens, ...(x.tier !== undefined && x.tier !== null ? { tier: x.tier } : {}) }));
}

// ------------------------------------------------------------------------------------------------ the doors' gate
/** The gate's answer for an act on this product, with the words a door answers in. */
export interface Gated extends GateAnswer { words: string }
const answer = (g: GateAnswer): Gated => ({ ...g, words: g.held.length || g.refused ? gateWords(g) : '' });

export function gateBuild(p: ProductEntry, tool: string, ids: readonly string[], model?: string, effort?: string): Gated {
  const rules = listRules(p.root);
  if (!rules.length) return { held: [], words: '' };
  const act: Act = { kind: 'build', tool, items: itemsOf(p, ids), ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  return answer(gate(rules, act));
}
export function gateScan(p: ProductEntry, tool: string, lens: string, scope: ScanScope): Gated {
  const rules = listRules(p.root);
  if (!rules.length) return { held: [], words: '' };
  return answer(gate(rules, { kind: 'scan', tool, lens, scope }));
}
/** The 403 a door answers when an order refuses the whole act: the order's id, author, time and words travel with it. */
export const refusedBy = (g: Gated): Response => Response.json({ error: g.words, order: g.refused, held: g.held }, { status: 403 });
