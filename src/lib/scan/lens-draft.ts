// The temporary-lens onboarding chat (POST /api/lens-draft): the contract Claude Code gets on the first
// turn, and the parser that lifts the drafted manifest out of a reply. Pure (no Node imports), so
// scripts/check-scan-jobs.ts tests the parser as-is; the route does the spawning.
import type { LensManifest } from '@/lib/standard/types';
import { checkTempManifest } from './manifest-check.ts';

/** The shared glyph and line names (src/lib/standard/types.ts GlyphName / LineName), said in the contract. */
const GLYPH_NAMES = 'bars, set-square, brackets, pulse, padlock, check';
const LINE_NAMES = 'solid, double, dotted, comb, chain, hatched, dimension';

/** The map a product's chat reads: a live product's store map, or the Kettle sample's in the bp repo. */
export const draftMapPath = (kettle: boolean): string => (kettle ? 'src/data/kettle.app-structure.json' : '.ai/lens-scan/app-structure.json');

/** Prepended to the user's first message. `mapPath` is relative to the working directory the CLI runs in. */
export function onboardingContract(mapPath: string): string {
  return `You are onboarding a TEMPORARY blueprint lens: a lens that lives for one refactor, migration or specific project, then is retired.
Read the product's app-structure map at ${mapPath} so you know its features (features[].slug, name, capability) and the lenses it already has (lenses[]).
Ask the user AT MOST 3 short clarifying questions, one per message, and only when the answer changes the lens. If the request is already clear, ask nothing.
Then reply with a short plain sentence and exactly one fenced block tagged lens-manifest holding JSON:

\`\`\`lens-manifest
{ ...the manifest... }
\`\`\`

The manifest is a lens-manifest/1:
- "$schema": "lens-manifest/1", "id": "tmp.<kebab-case-name>" (lower-case letters, digits, hyphens; 2-41 characters after "tmp."), "version": "1.0.0", "name", "short" (2-4 capital letters or digits), "description" (one sentence).
- "reader": { "role": who reads it, "density": "simple" | "standard" | "dense" }.
- "fields": 1 to 4 fields. Every field the scan fills is numeric ("type": "integer" | "number" | "percent") with a "metric" block { "better": "up" | "down", "method": "judgement" }. Keys are camelCase. Mark the one that sums the lens up with "headline": true.
- "health": { "rules": [ { "when": { "field": "<key>", "gt": 0 }, "health": "bad" | "watch" | "good", "reason": "<short sentence; {key} placeholders allowed>" } ... ] over those fields only (operators: eq, ne, lt, lte, gt, gte, in, nin, missing, present; combine with all / any / not), "default": "good", "rollup": { "method": "worst-of" } (or share { watch, bad } fractions) }.
- "presentation": { "glyph": one of ${GLYPH_NAMES}; "line": one of ${LINE_NAMES}; "measures": the headline field's key; "evidence": the field keys a tile shows, most important first }.
- "scan": { "method": "judgement", "instructions": what to judge for each feature, in plain words, and that a feature the change does not touch is "no impact": its facet is { "applicable": false }, never a zero }.
Do not write any file and do not run the scan: the blueprint saves the lens once the user accepts it. If the user asks for changes after the block, send a whole new block.`;
}

export interface DraftReply {
  /** The reply without the manifest block. */
  reply: string;
  /** The manifest, when the reply carried a valid one. */
  draft?: LensManifest;
  /** Why the block in the reply was refused (the chat goes on). */
  error?: string;
}

const BLOCK = /```lens-manifest[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/g;

/**
 * Splits a reply into its text and the drafted manifest. No block: just the text (a question, most likely).
 * The LAST block wins: a model that corrects itself mid-reply puts the fix last (seen on the first real chat,
 * 2026-10-13: "one value in that block is not valid, here is the corrected block"). Every block leaves the text.
 */
export function parseDraftReply(result: string): DraftReply {
  const all = [...result.matchAll(BLOCK)], m = all[all.length - 1];
  if (!m) return { reply: result.trim() };
  const reply = result.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
  let json: unknown;
  try { json = JSON.parse(m[1]); } catch (e) { return { reply, error: `the lens-manifest block is not valid JSON (${(e as Error).message})` }; }
  const bad = checkTempManifest(json);
  return bad ? { reply, error: bad } : { reply, draft: json as LensManifest };
}
