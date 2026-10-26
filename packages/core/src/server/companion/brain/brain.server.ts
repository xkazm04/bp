// The companion's brain (spark companion-upgrade, P2): markdown files under companionHome()/brain - episodes/<yyyy-mm>,
// facts/{user,project,world}, procedurals, spaces/<slug>.md, cycles - plus index.sqlite, an FTS index derived from them and
// rebuilt when missing or damaged. This file is the door P1 (runtime) and P3 (memory.note) call: appendEpisode every turn,
// writeFact with provenance (every source a live episode file, of the fact's own space unless the fact is core), recallBlock
// for the prompt (never throws), sleepIfDue for the consolidation pass, brainStats. The layers: paths (where), files (truth,
// atomic), index (derived), value (rank), recall (the block), sleep (the cycle).
import fs from 'node:fs';
import { CORE, FACT_KINDS, device, episodePath, nowIso, spacePath, spacesDir, validSpace } from './paths.server.ts';
import { atomicWrite, mintId, readRec, render, type Rec } from './files.server.ts';
import { getRec, patch, persist, recsOf, withReader } from './index.server.ts';
import { buildRecall } from './recall.server.ts';
import { readSleepState, sleepPass, type FactWrite, type Leg, type SleepReport } from './sleep.server.ts';

if (typeof window !== 'undefined') throw new Error('brain.server.ts is server-only');

export { setBrainClock } from './paths.server.ts';
export { closeIndex, indexInfo } from './index.server.ts';
export type { SleepReport, Leg } from './sleep.server.ts';

/** A space is a product slug, or 'core' (global). */
export type Space = string;
export type FactKind = 'user' | 'project' | 'world';

export interface Episode { id: string; space: Space; conversationId: string; at: string; input: string; reply: string; tools: string[] }
export interface Fact { id: string; space: Space; kind: FactKind; text: string; sources: string[]; importance: number; at: string }

export const TEXT_MAX = 2000, DEFAULT_IMPORTANCE = 3;

const toEpisode = (r: Rec): Episode => ({ id: r.id, space: r.space, conversationId: r.conversationId ?? '', at: r.at, input: r.input ?? '', reply: r.text, tools: r.tools ?? [] });
const toFact = (r: Rec): Fact => ({ id: r.id, space: r.space, kind: r.kind as FactKind, text: r.text, sources: r.sources, importance: r.importance, at: r.at });

function ensureSpace(slug: string): void {
  const p = spacePath(slug);
  if (fs.existsSync(p)) return;
  atomicWrite(p, render({ id: slug, space: slug, at: nowIso(), device: device() }, `# ${slug}\n\n${slug === CORE ? 'What holds everywhere.' : `What the companion remembers about ${slug}.`}`));
}

/** Appends one episode (every turn); returns it with its id. Throws on a bad space (a programming error, not a memory). */
export function appendEpisode(e: Omit<Episode, 'id' | 'at'>): Episode {
  if (!validSpace(e.space)) throw new Error(`appendEpisode: bad space ${JSON.stringify(e.space)}`);
  const r: Rec = {
    id: mintId('e'), type: 'episode', kind: 'episode', space: e.space, at: nowIso(), text: String(e.reply ?? ''), input: String(e.input ?? ''),
    conversationId: e.conversationId, tools: Array.isArray(e.tools) ? e.tools.map(String) : [], sources: [], importance: 0, confidence: 1, uses: 0, device: device(),
  };
  ensureSpace(e.space);
  persist(r);
  return toEpisode(r);
}

/** Provenance: why `sources` cannot ground a fact in `space`, or null. Checked against the files, not the index. */
function provenance(space: string, sources: unknown): string | null {
  if (!Array.isArray(sources) || !sources.length) return 'a fact needs at least one source episode';
  for (const s of sources) {
    const p = typeof s === 'string' ? episodePath(s) : null;
    const ep = p ? readRec(p) : null;
    if (!ep || ep.type !== 'episode') return `source ${JSON.stringify(s)} is not a live episode`;
    if (space !== CORE && ep.space !== space) return `source ${ep.id} is in space ${ep.space}, not ${space}`;
  }
  return null;
}

/** writeFact plus what the sleep cycle needs: a confidence and the live fact it supersedes (same wall). */
export function writeFactFull(f: FactWrite): { ok: true; fact: Fact } | { ok: false; error: string } {
  try {
    if (!validSpace(f.space)) return { ok: false, error: `bad space ${JSON.stringify(f.space)}` };
    if (!(FACT_KINDS as readonly string[]).includes(f.kind)) return { ok: false, error: `kind must be one of ${FACT_KINDS.join(', ')}` };
    const text = typeof f.text === 'string' ? f.text.trim() : '';
    if (!text || text.length > TEXT_MAX) return { ok: false, error: `text must be 1..${TEXT_MAX} characters` };
    const why = provenance(f.space, f.sources);
    if (why) return { ok: false, error: `provenance: ${why}` };
    if (f.supersedes !== undefined) {
      const t = getRec(f.supersedes);
      if (!t || t.type !== 'fact' || t.supersededBy || (t.space !== CORE && t.space !== f.space)) return { ok: false, error: `supersedes ${f.supersedes}: no live fact it may replace` };
    }
    const r: Rec = {
      id: mintId('f'), type: 'fact', kind: f.kind, space: f.space, at: nowIso(), text, sources: [...new Set(f.sources)],
      importance: Math.round(Math.min(5, Math.max(0, f.importance ?? DEFAULT_IMPORTANCE))), confidence: Math.min(1, Math.max(0, f.confidence ?? 0.7)), uses: 0, device: device(),
    };
    ensureSpace(f.space);
    persist(r);
    if (f.supersedes) patch(f.supersedes, (old) => { old.supersededBy = r.id; });
    return { ok: true, fact: toFact(r) };
  } catch (e) { return { ok: false, error: `writeFact: ${(e as Error)?.message ?? String(e)}` }; }
}

/** Writes a fact; refused (ok:false) unless every source is a live episode id. */
export function writeFact(f: Omit<Fact, 'id' | 'at' | 'importance'> & { importance?: number }): { ok: true; fact: Fact } | { ok: false; error: string } {
  return writeFactFull({ space: f.space, kind: f.kind, text: f.text, sources: f.sources, importance: f.importance });
}

/** The memory block for a prompt: core + the space, always-tier facts, keyword hits on `query`, recent episodes, each
 *  section saying "(showing N of M)". Never throws: an unreadable brain renders "memory could not be read: <why>". */
export function recallBlock(space: Space, query: string): string {
  let out: { text: string; used: string[] };
  try {
    if (!validSpace(space)) return `memory could not be read: bad space ${JSON.stringify(space)}`;
    out = buildRecall(space, String(query ?? ''));
  } catch (e) { return `memory could not be read: ${(e as Error)?.message ?? String(e)}`; }
  const at = nowIso();
  for (const id of out.used) { try { patch(id, (r) => { r.uses += 1; r.lastUsed = at; }); } catch { /* a use not counted is not a recall lost */ } }
  return out.text;
}

/** One sleep pass if it is due (idle and enough new episodes) or `force`; legs go through runtime's runLeg('sleep'),
 *  or through `leg` when a test scripts it. */
export async function sleepIfDue(opts?: { force?: boolean; leg?: Leg }): Promise<SleepReport> {
  return sleepPass(opts ?? {}, writeFactFull);
}

export interface BrainStats { episodes: number; facts: number; spaces: string[]; lastSleep?: string }
export function brainStats(): BrainStats {
  const { episodes, facts } = withReader((db) => ({
    episodes: (db.prepare("SELECT COUNT(*) n FROM mem WHERE type = 'episode'").get() as { n: number }).n,
    facts: (db.prepare("SELECT COUNT(*) n FROM mem WHERE type = 'fact' AND supersededBy IS NULL").get() as { n: number }).n,
  }));
  let spaces: string[] = [];
  try { spaces = fs.readdirSync(spacesDir()).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort(); } catch { /* none yet */ }
  const lastSleep = readSleepState().lastSleep;
  return lastSleep ? { episodes, facts, spaces, lastSleep } : { episodes, facts, spaces };
}

/** The newest live facts, any space (the brain route's list). */
export function recentFacts(n = 20): Fact[] {
  return withReader((db) => recsOf(db.prepare("SELECT rec FROM mem WHERE type = 'fact' AND supersededBy IS NULL ORDER BY at DESC, id DESC LIMIT ?").all(n))).map(toFact);
}

/** The newest episode of a conversation (memory.note cites it), or null. */
export function latestEpisodeOf(conversationId: string): Episode | null {
  const r = withReader((db) => recsOf(db.prepare("SELECT rec FROM mem WHERE type = 'episode' AND conv = ? ORDER BY at DESC, id DESC LIMIT 1").all(conversationId)))[0];
  return r ? toEpisode(r) : null;
}
