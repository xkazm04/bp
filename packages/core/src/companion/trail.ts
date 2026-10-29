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

/** The sessions of the rows, newest first; at most `max`. */
export function trailSessions(rows: readonly TrailRow[], now: number, max = 3): TrailSession[] {
  const by = new Map<string, TrailRow[]>();
  for (const r of rows) { const l = by.get(r.conversation); if (l) l.push(r); else by.set(r.conversation, [r]); }
  const out: TrailSession[] = [];
  for (const [conversation, rs] of by) {
    const last = rs[rs.length - 1].at;
    if (now - Date.parse(last) > TRAIL_WINDOW_MS) continue;
    const titles = new Map<string, string>(), heard = new Map<string, string>(), lines: TrailSession['lines'] = [];
    for (const r of rs) if (r.kind === 'brief' && r.id) titles.set(r.id, r.title);
    const featureOf = new Map<string, string>();
    for (const r of rs) if (r.kind === 'brief' && r.id) featureOf.set(r.id, r.feature);
    let reads = 0;
    for (const [i, r] of rs.entries()) {
      if (r.kind === 'brief') {
        reads++;
        if (r.advice !== 'withdraw' || r.id) continue; // a draft that met a standing decline: the moment worth showing
        if (r.quoted && r.declineId) heard.set(r.quoted, r.declineId);
        lines.push({ tone: 'heard', id: r.declineId,
          text: `Was about to propose "${q(r.title, 60)}" on ${r.featureName ?? r.feature}; read your decline${r.declineId ? ' ' + r.declineId : ''}${r.quoted ? `: "${q(r.quoted)}"` : ''}` });
        // pushed on anyway: a later approval recommended on the same feature, or a card on the same product
        const pushed = rs.slice(i + 1).some((x) => (x.kind === 'recommend' && x.verdict === 'approve' && featureOf.get(x.id) === r.feature) || (x.kind === 'card' && x.product === r.product));
        if (!pushed) lines.push({ tone: 'quiet', text: 'Withdrew it: nothing for it came through the door after' });
      } else if (r.kind === 'recommend') {
        // a reason that quotes a decline already shown says so by its id, not by the same words twice
        const t = titles.get(r.id), seen = [...heard].find(([words]) => r.why.includes(words));
        lines.push({ tone: 'act', id: r.id, text: `Then recommended you ${r.verdict} ${r.id}${t ? ` "${q(t, 50)}"` : ''}: ${seen ? 'it repeats your decline ' + seen[1] : q(r.why, 120)}` });
      } else lines.push({ tone: 'act', text: `Then filed a card: ${r.tool}` });
    }
    if (!lines.length) lines.push({ tone: 'quiet', text: `Read ${reads} brief${reads === 1 ? '' : 's'}; none met a standing decline` });
    out.push({ conversation, at: last, reads, lines });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, max);
}
