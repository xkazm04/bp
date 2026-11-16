// Rules the owner's own record suggests (scan/rules.ts): where their decisions already follow a rule, bp offers to write
// it down. Pure. Per room (a capability of the map), over the owner's decided findings:
//   grant   they approved the backlog (tier 3) findings there at least SUGGEST_GRANT of the time, over at least
//           SUGGEST_MIN of them: "Agents may approve backlog findings here on their own"
//   hold    they declined the work there at least SUGGEST_HOLD of the time, over at least SUGGEST_MIN decisions:
//           "Hold: no builds or scans start here until I lift it"
// A room a live rule of the same kind already covers whole is not suggested again. The person still replays and sets
// it: a suggestion is a draft, never a rule.
import type { ScanScope } from './jobs.ts';
import { isLive, type DecidedRow, type Rule, type RuleKind } from './rules.ts';

/** A grant asks more of the record than a hold: letting agents act alone is the riskier rule. */
export const SUGGEST_GRANT = 0.9, SUGGEST_HOLD = 0.75, SUGGEST_MIN = 5, SUGGEST_MAX = 4;
export interface Room { id: string; label: string; features: string[] }
export interface Suggestion {
  kind: RuleKind; scope: ScanScope; minTier?: number; hours?: number;
  /** Why, in the owner's record: "you approved 9 of 9 backlog findings in Booking". */
  why: string;
  /** How many of the owner's decisions it rests on, and how many follow it. */
  n: number; follow: number;
}

export function suggestRules(decided: readonly DecidedRow[], rooms: readonly Room[], rules: readonly Rule[], now: number = Date.now()): Suggestion[] {
  const roomOf = new Map<string, Room>();
  for (const r of rooms) for (const f of r.features) roomOf.set(f, r);
  const tally = new Map<string, { room: Room; back: number; backOk: number; all: number; declined: number }>();
  for (const row of decided) {
    if (row.synthetic) continue; // seeded history is nobody's decision: a suggestion says "you approved"
    const room = roomOf.get(row.feature);
    if (!room) continue;
    const t = tally.get(room.id) ?? { room, back: 0, backOk: 0, all: 0, declined: 0 };
    t.all++; if (row.owner === 'decline') t.declined++;
    if (row.tier === 3) { t.back++; if (row.owner === 'approve') t.backOk++; }
    tally.set(room.id, t);
  }
  const live = rules.filter((r) => isLive(r, now));
  const taken = (kind: RuleKind, room: Room) => live.some((r) => r.kind === kind && (r.scope.kind === 'all' || room.features.every((f) => r.scope.features.includes(f))));
  const out: Suggestion[] = [];
  for (const { room, back, backOk, all, declined } of tally.values()) {
    const scope: ScanScope = { kind: 'room', id: room.id, label: room.label, features: room.features };
    if (all >= SUGGEST_MIN && declined >= SUGGEST_HOLD * all && !taken('hold', room)) {
      out.push({ kind: 'hold', scope, why: `you declined ${declined} of ${all} findings in ${room.label}`, n: all, follow: declined });
    } else if (back >= SUGGEST_MIN && backOk >= SUGGEST_GRANT * back && !taken('grant', room)) {
      out.push({ kind: 'grant', scope, minTier: 3, hours: 72, why: `you approved ${backOk} of ${back} backlog findings in ${room.label}`, n: back, follow: backOk });
    }
  }
  return out.sort((a, b) => b.follow / b.n - a.follow / a.n || b.n - a.n).slice(0, SUGGEST_MAX);
}
