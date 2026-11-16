// A Morning decision card's brief: the decision brief (scan/brief.ts) as the deck, the phone, a follower's lower third,
// morning.brief for agents and the server's Decline all read it. Split out of morning.ts (roadmap S1's risk: the deck
// module was growing toward 400 lines); morning.ts re-exports both names, so its importers are unchanged. Pure.
import type { Proposal, ScanSnapshot } from '../scan/types.ts';
import { briefFor, briefMapOf, repeatNote, subjectOf, type Brief, type BriefDecided, type BriefFact, type BriefMap } from '../scan/brief.ts';

/** `recommend` is 'decline' only when the same idea was declined before (advice 'withdraw'), and `note` is then what a
 *  Decline writes to the store ("Repeats <id>, declined <day>: ..."). `decline` is the decline the card repeats, or
 *  (advice 'ask') the like one it only quotes. `short` is the one-line form for small surfaces. */
export interface CardBrief {
  facts: BriefFact[];
  lines: string[];
  advice: Brief['advice'];
  decline?: Pick<BriefDecided, 'id' | 'title' | 'feature' | 'at' | 'by' | 'note' | 'match'>;
  recommend?: 'decline';
  note?: string;
  short: string;
}

const EMPTY_MAP = briefMapOf({});
export const clip = (t: string, k: number) => (t.length <= k ? t : t.slice(0, k - 1).trimEnd() + '…');

/** The brief of one decision on the morning's table: THE function every surface's card brief comes from. `p.map` absent:
 *  every brief says 'not on the plan'. */
export function cardBrief(p: { scan: Pick<ScanSnapshot, 'proposals' | 'measurements' | 'packs' | 'releases' | 'runs'>; map?: BriefMap }, x: Proposal): CardBrief {
  const b = briefFor(subjectOf(x), p.scan, p.map ?? EMPTY_MAP), d = b.declines[0];
  const repeat = b.advice.say === 'withdraw' && !!d;
  const who = d?.by ? ' by ' + d.by.replace(/^user:/, '') : '';
  const short = d && repeat ? `Repeats your decline ${d.id} (${d.at}${who})${d.note ? `: "${d.note}"` : ''}`
    : d && b.advice.say === 'ask' ? `Like an idea you declined (${d.id})${d.note ? `: "${d.note}"` : ''}; yours to decide`
      : b.lines[0] ?? '';
  return {
    facts: b.facts, lines: b.lines, advice: b.advice,
    ...(d ? { decline: { id: d.id, title: d.title, feature: d.feature, at: d.at, match: d.match, ...(d.by ? { by: d.by } : {}), ...(d.note ? { note: d.note } : {}) } } : {}),
    ...(d && repeat ? { recommend: 'decline' as const, note: repeatNote(d) } : {}),
    short: clip(short, 160),
  };
}
