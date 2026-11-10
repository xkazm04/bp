// What yesterday's approvals became (roadmap E, owner 2026-11-10: "the morning shows what yesterday's approvals became (built or
// failed, with before and after screens on the table)"). Pure: the server reads the decision logs, the waves, the job journal and
// the failure records (server/outcomes.server.ts) and hands them here; the sample stand-ups (apps/vr/tools/bundle-morning.ts,
// scripts/morning-demo.mjs through the server) call the same join. The deck makes one `outcomes` card of it (morning.ts).
//
// The chain from a person's approval to its outcome: the approve row (an event time, `at`) -> the proposal as the store has it
// now -> a wave package naming it (bp-waves.json) -> an execute job naming it (bp-jobs/journal.jsonl) -> the store's status,
// commit and the failure activity. An approval does not queue a build, so most live approvals read `waiting` until a wave or
// /dispatch takes them.
//   built     the store says it was built: done (the agent finished it), or a person's later triage of a built item
//             (accepted, rework) or a release that carries it (released). A rework is still "built": the build happened
//             and the person sent it back, which the ledger says, not this card.
//   failed    the store says failed; `reason` is the failure activity's stage and reason in one sentence, when one is recorded.
//   building  executing in the store, or approved with a queued or running execute job naming it.
//   waiting   approved, and no job builds it ("approved, not built yet"); `wave` says when a draft or dispatched wave holds it.
// Dropped: a proposal whose latest steering after the approval was not an approve (held, deferred, declined), one the store has
// declined, descoped or reopened (proposed again), one that no longer exists; an approval inside the deck's window (it is this
// morning's, the close card says it) or older than OUTCOMES_DAYS.
import type { Proposal, Shot } from '../scan/types.ts';
import { clip } from './card-brief.ts';

export type OutcomeState = 'built' | 'failed' | 'building' | 'waiting';
export type DecidedBy = 'web' | 'vr';
/** One approval and what it became (morning-deck-1 $defs.outcome). Absent values are omitted, never null or ''. */
export interface Outcome {
  proposal: string;
  title: string;
  room?: string;
  decided_at: string;
  decided_by: DecidedBy;
  outcome: OutcomeState;
  reason?: string;
  commit?: string;
  wave?: string;
  before?: string;
  after?: string;
}
/** A steering row of either log: $BP_HOME/companion/decisions.jsonl (kind morning) or the product's steering-log.jsonl. */
export interface Approval { at: string; product: string; proposal: string; verdict: string; surface?: string }
/** What builds the product's items: its waves, its execute jobs (each at its latest known state), its failure records. */
export interface BuildTrail {
  waves: readonly { id: string; status?: string; created_at?: string; packages: readonly { ids: readonly string[] }[] }[];
  jobs: readonly { id: string; status: string; kind?: string; proposals?: readonly string[]; wave?: string }[];
  /** proposal id -> its failure record (lens-scan's `failure <id>: {stage, reason, evidence}` error activity). */
  failures: ReadonlyMap<string, { stage?: string; reason: string }>;
}
export const NO_TRAIL: BuildTrail = { waves: [], jobs: [], failures: new Map() };

/** How far back an approval is still "yesterday's": a week. */
export const OUTCOMES_DAYS = 7;
/** At most this many outcomes on the card, newest decision first. */
export const OUTCOMES_MAX = 8;
export const REASON_MAX = 160;
const BUILT = new Set(['done', 'accepted', 'rework', 'released']);
const GONE = new Set(['declined', 'descoped', 'proposed']);
const SHOT_EXT = /\.(png|jpe?g|webp)$/i;
const STAGE_WORDS: Record<string, string> = {
  recheck: 'The recheck before building failed',
  before: 'The reading before the change failed',
  build: 'The build failed',
  gate: 'A check failed after the change',
  after: 'The reading after the change failed',
};

/** The failure record in one plain sentence (at most REASON_MAX): "The build failed: <reason>." */
export function reasonWords(f: { stage?: string; reason: string } | undefined): string | undefined {
  const r = f?.reason?.replace(/\s+/g, ' ').trim();
  if (!r || r === 'no failure recorded') return undefined;
  const head = f?.stage ? STAGE_WORDS[f.stage] : undefined, body = head ? `${head}: ${r.charAt(0).toLowerCase()}${r.slice(1)}` : r.charAt(0).toUpperCase() + r.slice(1);
  return clip(/[.!?]$/.test(body) ? body : body + '.', REASON_MAX);
}

/** The shot a card shows for one proposal and phase: png, jpg or webp only (the shots route and the headset read no other),
 *  the light theme first, then the newest. */
export function shotOf(shots: readonly Pick<Shot, 'path' | 'proposal_id' | 'phase' | 'theme' | 'captured_at'>[], id: string, phase: 'before' | 'after'): string | undefined {
  const xs = shots.filter((s) => s.proposal_id === id && s.phase === phase && SHOT_EXT.test(s.path));
  xs.sort((a, b) => (a.theme === 'dark' ? 1 : 0) - (b.theme === 'dark' ? 1 : 0) || (a.captured_at < b.captured_at ? 1 : a.captured_at > b.captured_at ? -1 : 0));
  return xs[0]?.path;
}

/** The join: each proposal the person approved before `since` and at most OUTCOMES_DAYS ago, at its latest approve, with what
 *  became of it; newest decision first, at most OUTCOMES_MAX. `where`: feature -> its room on the plan (as decision cards
 *  resolve it). */
export function joinOutcomes(product: string, proposals: readonly Proposal[], shots: readonly Pick<Shot, 'path' | 'proposal_id' | 'phase' | 'theme' | 'captured_at'>[],
  steering: readonly Approval[], trail: BuildTrail, since: string, now: number, where?: ReadonlyMap<string, { room: string }>): Outcome[] {
  const oldest = new Date(now - OUTCOMES_DAYS * 86400e3).toISOString();
  // the latest steering row per proposal (any verdict, any time: a hold this morning drops yesterday's approve), and the
  // latest approve before the window (a second approve this morning, from another surface, keeps yesterday's)
  const last = new Map<string, Approval>(), approve = new Map<string, Approval>();
  for (const r of [...steering].filter((x) => x.product === product && typeof x.at === 'string' && typeof x.proposal === 'string').sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    last.set(r.proposal, r);
    if (r.verdict === 'approve' && r.at < since) approve.set(r.proposal, r);
  }
  const byId = new Map(proposals.map((x) => [x.id, x]));
  const out: Outcome[] = [];
  for (const [id, a] of approve) {
    if (last.get(id)?.verdict !== 'approve') continue; // held, deferred or declined since
    if (a.at < oldest) continue;
    const x = byId.get(id);
    if (!x || GONE.has(x.status)) continue;
    const job = trail.jobs.find((j) => (j.status === 'queued' || j.status === 'running') && (j.kind === undefined || j.kind === 'execute') && j.proposals?.includes(id));
    const state: OutcomeState = x.status === 'failed' ? 'failed' : BUILT.has(x.status) ? 'built' : x.status === 'executing' || job ? 'building' : 'waiting';
    // the wave: the one whose job builds it, else the newest wave whose package names it
    const waves = trail.waves.filter((w) => w.packages.some((p) => p.ids.includes(id))).sort((p, q) => ((p.created_at ?? '') < (q.created_at ?? '') ? 1 : -1));
    const wave = job?.wave ?? waves[0]?.id;
    const reason = state === 'failed' ? reasonWords(trail.failures.get(id)) : undefined;
    const commit = state === 'built' && x.commit_sha ? x.commit_sha.slice(0, 7) : undefined;
    const room = where?.get(x.feature)?.room, before = shotOf(shots, id, 'before'), after = shotOf(shots, id, 'after');
    out.push({
      proposal: id, title: x.title, ...(room ? { room } : {}), decided_at: a.at, decided_by: a.surface === 'vr' ? 'vr' : 'web', outcome: state,
      ...(reason ? { reason } : {}), ...(commit ? { commit } : {}), ...(wave ? { wave } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}),
    });
  }
  out.sort((p, q) => (p.decided_at < q.decided_at ? 1 : p.decided_at > q.decided_at ? -1 : 0));
  return out.slice(0, OUTCOMES_MAX);
}

/** The card's headline, a count in words: "3 approved yesterday: 2 built, 1 failed"; "2 approved, not built yet". `now`
 *  decides "yesterday" (every decision in the last 48 h) or "this week". */
export function outcomesHeadline(xs: readonly Outcome[], now: number, product?: string): string {
  const k = (s: OutcomeState) => xs.filter((x) => x.outcome === s).length;
  const when = (xs.every((x) => Date.parse(x.decided_at) >= now - 48 * 3600e3) ? 'yesterday' : 'this week') + (product ? ' on ' + product : '');
  if (k('waiting') === xs.length) return `${xs.length} approved ${when}, not built yet`;
  const parts = [k('built') ? `${k('built')} built` : '', k('failed') ? `${k('failed')} failed` : '', k('building') ? `${k('building')} building` : '', k('waiting') ? `${k('waiting')} not built yet` : ''].filter(Boolean);
  return `${xs.length} approved ${when}: ${parts.join(', ')}`;
}
/** The tone follows the worst outcome: a failure is bad, an approval still waiting is a warning, one building is calm. */
export const outcomesTone = (xs: readonly Outcome[]): 'good' | 'warn' | 'bad' | 'calm' =>
  xs.some((x) => x.outcome === 'failed') ? 'bad' : xs.some((x) => x.outcome === 'waiting') ? 'warn' : xs.some((x) => x.outcome === 'building') ? 'calm' : 'good';
/** One plain line per outcome (the card's `lines`, for a reader that shows text only). */
export function outcomeLine(x: Outcome): string {
  const what = x.outcome === 'built' ? `built${x.commit ? ' (' + x.commit + ')' : ''}` : x.outcome === 'failed' ? 'failed' : x.outcome === 'building' ? 'building now' : 'approved, not built yet';
  return `${x.title}: ${what}${x.outcome === 'failed' && x.reason ? ' - ' + x.reason : ''}`;
}
