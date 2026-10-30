// The agent trail in words (pure): what agents on the MCP door read in the decision brief and what they did next, for the
// cards slip ("agents read your decisions"). The rows are written by brief.server.ts, one per agent call that names its
// conversation (x-bp-conversation): a brief it read, a recommendation it filed, a card it filed. A session is one
// conversation; it is shown while its newest row is younger than TRAIL_WINDOW_MS. Only what passed through bp's door is
// said: "filed nothing for it" means no recommendation or card came through the door for that idea, not that the agent
// did nothing anywhere.
import type { Brief } from '../scan/brief.ts';

export type TrailRow =
  | { at: string; conversation: string; kind: 'brief'; product: string; feature: string; featureName?: string; title: string; id?: string;
      advice: Brief['advice']['say']; quoted?: string; declineId?: string; declinedAt?: string }
  | { at: string; conversation: string; kind: 'recommend'; product: string; id: string; verdict: string; why: string }
  | { at: string; conversation: string; kind: 'card'; product?: string; tool: string; card: string };

export const TRAIL_WINDOW_MS = 6 * 3600000;

export interface TrailSession {
  conversation: string;
  /** The newest row's instant. */
  at: string;
  /** Briefs read in the session. */
  reads: number;
  /** One line per thing worth the person's eye, oldest first: a decline heard, then what was filed after it. */
  lines: { text: string; tone: 'heard' | 'act' | 'quiet'; id?: string }[];
}

const q = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Whether an agent pushed a draft on after hearing a decline: a later approval recommended on the same feature, or a
 *  card on the same product, in the same conversation. */
function pushedAfter(rs: readonly TrailRow[], i: number, r: Extract<TrailRow, { kind: 'brief' }>): boolean {
  const featureOf = new Map<string, string>();
  for (const x of rs) if (x.kind === 'brief' && x.id) featureOf.set(x.id, x.feature);
  return rs.slice(i + 1).some((x) => (x.kind === 'recommend' && x.verdict === 'approve' && featureOf.get(x.id) === r.feature) || (x.kind === 'card' && x.product === r.product));
}
/** A draft that met a decline - of the same idea (withdraw) or a like one, quoted (ask): the moment worth showing. */
const metDecline = (r: TrailRow): r is Extract<TrailRow, { kind: 'brief' }> => r.kind === 'brief' && !r.id && (r.advice === 'withdraw' || (r.advice === 'ask' && !!r.quoted));

/** What agents did with the person's decisions in [since, until], in counts (the Morning Watch's opening card): briefs
 *  read, distinct declines quoted back to them, drafts withdrawn after a decline (nothing for it came through the door
 *  after), and declines recommended. Only what passed through bp's door is counted. */
export interface TrailTally { reads: number; heard: number; withdrew: number; recommended: number; conversations: number }
export function trailTally(rows: readonly TrailRow[], since: string, until: string): TrailTally {
  const by = new Map<string, TrailRow[]>();
  for (const r of rows) if (r.at >= since && r.at <= until) { const l = by.get(r.conversation); if (l) l.push(r); else by.set(r.conversation, [r]); }
  const heard = new Set<string>(), t: TrailTally = { reads: 0, heard: 0, withdrew: 0, recommended: 0, conversations: by.size };
  for (const rs of by.values()) rs.forEach((r, i) => {
    if (r.kind === 'brief') { t.reads++; if (r.declineId && (r.advice === 'withdraw' || r.quoted)) heard.add(r.product + ' ' + r.declineId); }
    if (metDecline(r) && !pushedAfter(rs, i, r)) t.withdrew++;
    if (r.kind === 'recommend' && r.verdict === 'decline') t.recommended++;
  });
  t.heard = heard.size;
  return t;
}

/** The sessions of the rows, newest first; at most `max`; `product` keeps only that product's rows; a session is shown while
 *  its newest row is younger than `windowMs` (the Morning Watch passes its own window instead). */
export function trailSessions(rows: readonly TrailRow[], now: number, max = 3, product?: string, windowMs = TRAIL_WINDOW_MS): TrailSession[] {
  const by = new Map<string, TrailRow[]>();
  for (const r of rows) {
    if (product && r.product !== product) continue;
    const l = by.get(r.conversation); if (l) l.push(r); else by.set(r.conversation, [r]);
  }
  const out: TrailSession[] = [];
  for (const [conversation, rs] of by) {
    const last = rs[rs.length - 1].at;
    if (now - Date.parse(last) > windowMs) continue;
    const titles = new Map<string, string>(), heard = new Map<string, string>(), lines: TrailSession['lines'] = [];
    for (const r of rs) if (r.kind === 'brief' && r.id) titles.set(r.id, r.title);
    let reads = 0;
    for (const [i, r] of rs.entries()) {
      if (r.kind === 'brief') {
        reads++;
        if (!metDecline(r)) continue;
        if (r.quoted && r.declineId) heard.set(r.quoted, r.declineId);
        lines.push({ tone: 'heard', id: r.declineId,
          text: `Was about to propose "${q(r.title, 60)}" on ${r.featureName ?? r.feature}; read your decline${r.declineId ? ' ' + r.declineId : ''}${r.quoted ? `: "${q(r.quoted)}"` : ''}` });
        // pushed on anyway: a later approval recommended on the same feature, or a card on the same product
        if (!pushedAfter(rs, i, r)) lines.push({ tone: 'quiet', text: 'Withdrew it: nothing for it came through the door after' });
      } else if (r.kind === 'recommend') {
        // a reason that quotes a decline already shown says so by its id, not by the same words twice (a quote of a few
        // characters, "no", would match any reason: only one long enough to be a quote counts)
        const t = titles.get(r.id), seen = [...heard].find(([words]) => words.length >= 12 && r.why.includes(words));
        lines.push({ tone: 'act', id: r.id, text: `Then recommended you ${r.verdict} ${r.id}${t ? ` "${q(t, 50)}"` : ''}: ${seen ? 'it repeats your decline ' + seen[1] : q(r.why, 120)}` });
      } else lines.push({ tone: 'act', text: `Then filed a card: ${r.tool}` });
    }
    if (!lines.length) lines.push({ tone: 'quiet', text: `Read ${reads} brief${reads === 1 ? '' : 's'}; none met a standing decline` });
    out.push({ conversation, at: last, reads, lines });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, max);
}
