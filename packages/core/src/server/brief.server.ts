// The decision brief's server half: where its inputs come from, and the trail of agents reading it. The brief itself is
// pure (scan/brief.ts); this reads a product's store and map the way the other routes do and hands them over.
//   Kettle: the hosted ScanSim's snapshot (apps/server) and the sample map, read-only. A process without the sim (apps/web)
//           answers unknownProduct's 405, as Kettle's scan routes do: the browser's own sim computes the brief there.
//   live:   the product's scan.db (read-only connection) and its .ai/lens-scan/app-structure.json.
// The trail: an agent's call that names its conversation (x-bp-conversation, as the MCP door sends it) is appended to
// companionHome()/agent-trail.jsonl - a brief it read (what, and the advice) and what it filed after (a recommendation, a
// card) - so the cards slip can show "an agent read your decline and then did this". A call without a conversation (the
// person's own page) leaves no trail. The newest TRAIL_KEEP rows are read back.
import fs from 'node:fs';
import path from 'node:path';
import { briefMapOf, type Brief, type BriefMap } from '../scan/brief.ts';
import type { TrailRow } from '../companion/trail.ts';
import type { ScanSnapshot } from '../scan/types.ts';
import { companionHome } from './companion/home.server.ts';
import { findProduct, hasStore, kettleRead, kettleSample, storeDir, storeFile, unknownProduct } from './products.server.ts';
import { kettleSim } from './kettle-sim.server.ts';
import { snapshotOf } from './store.server.ts';

if (typeof window !== 'undefined') throw new Error('brief.server.ts is server-only');

export interface BriefSource { scan: ScanSnapshot; map: BriefMap }

/** A product's store and map for the brief, or the Response that refuses it. */
export function briefSource(slug: string): BriefSource | Response {
  const sim = kettleSim(slug), k = kettleSample(slug);
  if (sim && k) {
    try { return { scan: sim.snapshot(), map: briefMapOf(JSON.parse(kettleRead(k).raw)) }; } catch (e) {
      return Response.json({ error: `kettle sample unreadable: ${(e as Error).message}` }, { status: 500 });
    }
  }
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  if (!hasStore(p)) return Response.json({ error: `${slug} has no scan store yet` }, { status: 404 });
  let map: BriefMap;
  try { map = briefMapOf(JSON.parse(fs.readFileSync(path.join(storeDir(p), 'app-structure.json'), 'utf8'))); } catch {
    map = briefMapOf({}); // no map: the brief says 'not on the plan' rather than refusing the precedent it can still give
  }
  try { return { scan: snapshotOf(storeFile(p)), map }; } catch (e) {
    return Response.json({ error: `cannot read the scan store: ${(e as Error).message}` }, { status: 503 });
  }
}

// ------------------------------------------------------------------------------------------------ the trail
export const TRAIL_KEEP = 200;
const CONVERSATION = /^[A-Za-z0-9_.:-]{1,80}$/;
type TrailInput = TrailRow extends infer R ? (R extends TrailRow ? Omit<R, 'at' | 'conversation'> : never) : never;

const trailFile = () => path.join(companionHome(), 'agent-trail.jsonl');
/** The calling agent's conversation, when the request names a well-formed one. */
export const conversationOf = (req: Request): string | null => { const c = req.headers.get('x-bp-conversation'); return c && CONVERSATION.test(c) ? c : null; };

/** Append one row for an agent's call; a call without a conversation is the person's and leaves none. Never throws. */
export function trail(req: Request, row: TrailInput): void {
  const conversation = conversationOf(req);
  if (!conversation) return;
  try {
    fs.mkdirSync(companionHome(), { recursive: true });
    fs.appendFileSync(trailFile(), JSON.stringify({ at: new Date().toISOString(), conversation, ...row }) + '\n');
  } catch { /* the trail is a courtesy: a brief is never refused for it */ }
}

/** The trail row of a brief an agent read: what it asked about and what it heard. `draft` = no proposal id (a draft idea). */
export const briefRow = (product: string, b: Brief): TrailInput => ({
  kind: 'brief', product, feature: b.subject.feature, ...(b.blast.feature ? { featureName: b.blast.feature.name } : {}), title: b.subject.title,
  ...(b.subject.id ? { id: b.subject.id } : {}), advice: b.advice.say,
  ...(b.declines[0] ? { declineId: b.declines[0].id, declinedAt: b.declines[0].at, ...(b.declines[0].note ? { quoted: b.declines[0].note } : {}) } : {}),
});

/** The newest TRAIL_KEEP rows, oldest first. */
export function readTrail(): TrailRow[] {
  let text = '';
  try { text = fs.readFileSync(trailFile(), 'utf8'); } catch { return []; }
  const out: TrailRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line) as TrailRow; if (r && typeof r.conversation === 'string' && typeof r.kind === 'string') out.push(r); } catch { /* a torn last line */ }
  }
  return out.slice(-TRAIL_KEEP);
}
