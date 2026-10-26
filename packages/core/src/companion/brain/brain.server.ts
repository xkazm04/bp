// STUB (P0, spark companion-upgrade): P2 replaces the bodies; the signatures are the contract P1 (runtime) and P3 (the
// memory.note route) build against. The brain is markdown files under $BP_HOME/companion/brain plus a derivable FTS index.
if (typeof window !== 'undefined') throw new Error('brain.server.ts is server-only');

/** A space is a product slug, or 'core' (global). */
export type Space = string;
export type FactKind = 'user' | 'project' | 'world';

export interface Episode { id: string; space: Space; conversationId: string; at: string; input: string; reply: string; tools: string[] }
export interface Fact { id: string; space: Space; kind: FactKind; text: string; sources: string[]; importance: number; at: string }

/** Appends one episode (every turn); returns it with its id. */
export function appendEpisode(e: Omit<Episode, 'id' | 'at'>): Episode { void e; throw new Error('appendEpisode: not built yet (P2)'); }

/** Writes a fact; refused (ok:false) unless every source is a live episode id. */
export function writeFact(f: Omit<Fact, 'id' | 'at' | 'importance'> & { importance?: number }): { ok: true; fact: Fact } | { ok: false; error: string } {
  void f; return { ok: false, error: 'writeFact: not built yet (P2)' };
}

/** The memory block for a prompt: core + the space, always-tier facts, keyword hits on `query`, recent episodes, each
 *  section saying "(showing N of M)". Never throws: an unreadable brain renders "memory could not be read: <why>". */
export function recallBlock(space: Space, query: string): string { void space; void query; return ''; }

export interface SleepReport { ran: boolean; compressed: number; merged: number; faded: number; forgetProposals: string[]; error?: string }
/** One sleep pass if it is due (idle and enough new episodes) or `force`; legs go through runtime's runLeg('sleep'). */
export async function sleepIfDue(opts?: { force?: boolean }): Promise<SleepReport> { void opts; return { ran: false, compressed: 0, merged: 0, faded: 0, forgetProposals: [] }; }

export interface BrainStats { episodes: number; facts: number; spaces: string[]; lastSleep?: string }
export function brainStats(): BrainStats { return { episodes: 0, facts: 0, spaces: [] }; }
