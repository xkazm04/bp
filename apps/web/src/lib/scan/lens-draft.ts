// The lens onboarding chat (POST /api/lens-draft): the prompt Claude Code gets on the first turn, and the parser
// that lifts the drafted manifest out of a reply. The onboarding contract itself lives in the lens-scan skill
// (`references/lens-onboarding.md`, `/lens-scan onboard --draft-only`); bp only names the mode. Pure (no Node
// imports), so scripts/check-scan-jobs.ts tests the parser as-is; the route does the spawning.
import type { LensManifest } from '@/lib/standard/types';
import { checkLensManifest, type CheckLensOptions } from './manifest-check.ts';

/** What the chat onboards: a permanent project lens (reverse-DNS id) or a throwaway `tmp.*` one. */
export type DraftKind = 'project' | 'temporary';

/** The map a product's chat reads: a live product's store map, or the Kettle sample's in the bp repo. */
export const draftMapPath = (kettle: boolean): string => (kettle ? 'src/data/kettle.app-structure.json' : '.ai/lens-scan/app-structure.json');

/**
 * The first turn's prompt: `/lens-scan onboard --draft-only [--temporary]`, then the user's message. The skill prints
 * one fenced `lens-manifest` block when it has a draft, else a question, and writes nothing. Kettle runs in the bp
 * repo, whose sample map is not where the skill looks for one, so its prompt names the map.
 */
export function onboardPrompt(message: string, kind: DraftKind, kettle: boolean): string {
  const head = '/lens-scan onboard --draft-only' + (kind === 'temporary' ? ' --temporary' : '');
  const where = kettle ? `\n\nThe product is the Kettle sample; its app-structure map is ${draftMapPath(true)}.` : '';
  return `${head}${where}\n\nThe user's request:\n${message}`;
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
 * Splits a reply into its text and the drafted manifest, checked in `opts.mode` (with the product's taken looks).
 * No block: just the text (a question, most likely).
 * The LAST block wins: a model that corrects itself mid-reply puts the fix last (seen on the first real chat,
 * 2026-10-13: "one value in that block is not valid, here is the corrected block"). Every block leaves the text.
 */
export function parseDraftReply(result: string, opts: CheckLensOptions): DraftReply {
  const all = [...result.matchAll(BLOCK)], m = all[all.length - 1];
  if (!m) return { reply: result.trim() };
  const reply = result.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
  let json: unknown;
  try { json = JSON.parse(m[1]); } catch (e) { return { reply, error: `the lens-manifest block is not valid JSON (${(e as Error).message})` }; }
  const bad = checkLensManifest(json, opts);
  return bad ? { reply, error: bad } : { reply, draft: json as LensManifest };
}
