// Model-proposed quick replies (G1, 2026-11-11; registry conversation-orchestration/model-proposed-quick-replies). The model
// may end a reply with up to QUICK_REPLY_MAX lines `[[reply: <label> | <what the person would say>]]`; the turn engine lifts
// them out of the text (so they are never spoken or shown as prose), validates them here and hands them on the `end` event as
// `replies`. A press sends `say` as the next turn through POST /turn: a reply is a message, never an action. Bounds: label
// <= 32 characters, say <= 120, no duplicates; anything else is dropped (never repaired, never padded). Pure.

import { QUICK_REPLY_MAX, type QuickReply } from './contract.ts';

export const LABEL_MAX = 32, SAY_MAX = 120;
const LINE = /^[ \t]*\[\[\s*reply\s*:\s*([^|\]\n]{1,200}?)\s*\|\s*([^\]\n]{1,400}?)\s*\]\][ \t]*$/gim;

/** Strips every reply line from `text`; returns the rest and the replies found (unvalidated, in order). */
export function liftReplies(text: string): { text: string; found: QuickReply[] } {
  const found: QuickReply[] = [];
  const rest = text.replace(LINE, (_, label: string, say: string) => { found.push({ label: label.trim(), say: say.trim() }); return ''; });
  return { text: found.length ? rest.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') : text, found };
}

/** The replies a surface may show: within bounds, distinct by label and by say (case-insensitive), at most QUICK_REPLY_MAX. */
export function validReplies(found: readonly QuickReply[]): QuickReply[] {
  const out: QuickReply[] = [], seen = new Set<string>();
  for (const r of found) {
    const label = r.label.replace(/\s+/g, ' ').trim(), say = r.say.replace(/\s+/g, ' ').trim();
    if (!label || !say || label.length > LABEL_MAX || say.length > SAY_MAX || /[<>]/.test(label + say)) continue;
    const kl = 'l:' + label.toLowerCase(), ks = 's:' + say.toLowerCase();
    if (seen.has(kl) || seen.has(ks)) continue;
    seen.add(kl); seen.add(ks);
    out.push({ label, say });
    if (out.length === QUICK_REPLY_MAX) break;
  }
  return out;
}
