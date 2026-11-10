// Who made a person's decision, and where (docs/concepts/vr-light-table/table-link-v2.md section 2; registry hitl-approval,
// technique decision-records; device-pairing, techniques pairing-ceremony and verb-allowlists). Two paths decide as a
// person: bp's own page (the `x-bp-human` token, door.server.ts; surface `web`) and a paired headset whose pairing holds
// the `decide` scope (surface `vr`). The second is proven by an in-process seal: apps/server authenticates the headset's
// Bearer against its pairing registry (apps/server/src/device-auth.ts, on the loopback listener and in the LAN door) and,
// only when the pairing holds `decide`, adds DECIDER_SEAL_HEADER with this per-process secret beside the device id. The
// secret never leaves the process: the loopback listener strips a client-sent seal, the LAN door forwards only
// Content-Type and Accept, and Next (apps/web) never sets it, so on :3010 only the page decides.
// Every person's decision on the companion's routes is also one row of $BP_HOME/companion/decisions.jsonl (DecisionRecord).
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { companionHome } from './companion/home.server.ts';
import { isHuman, namedTiers } from './api/companion/door.server.ts';
import { productOf, toolOf } from './api/companion/tool-call.ts';
import { VR_POLICY_BOUND } from './table-bound.server.ts';
import { deviceOf } from './api/session/baton.server.ts';

if (typeof window !== 'undefined') throw new Error('decider.server.ts is server-only');

export type Surface = 'web' | 'vr';
/** Who decided: the page, or a paired headset (its `<device>:<pairing id>`). */
export interface Decider { surface: Surface; device?: string }
/** The marks a decided entity's row carries: who, where, and what the decider was shown. */
export interface DeciderMarks { surface: Surface; device?: string; shown?: string }

import { DECIDER_SEAL_HEADER, ONBOARD_SEAL_HEADER } from './decider-header.ts';
export { DECIDER_SEAL_HEADER, ONBOARD_SEAL_HEADER };
const g = globalThis as unknown as { __bpDeciderSeal?: string; __bpOnboardSeal?: string };
/** Minted once per process (globalThis: Next bundles each route apart). Only apps/server's device auth sets it on a request. */
export const deciderSeal = (): string => (g.__bpDeciderSeal ??= randomBytes(32).toString('hex'));
/** The `onboard` scope's seal: its own per-process secret (table-link-v2.md section 14), set by apps/server's device auth only
 *  for a pairing that holds `onboard`, stripped from every client request by the loopback mount like the decider seal. */
export const onboardSeal = (): string => (g.__bpOnboardSeal ??= randomBytes(32).toString('hex'));

/** The request carries the seal and a device id: a paired headset with `decide`, authenticated by this process. */
export function deviceDecider(req: Request): Decider | null {
  const got = Buffer.from(req.headers.get(DECIDER_SEAL_HEADER) ?? ''), want = Buffer.from(deciderSeal());
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const device = deviceOf(req);
  return device ? { surface: 'vr', device } : null;
}
/** The request carries the `onboard` seal and a device id: a paired headset holding `onboard`, authenticated by this process. */
export function deviceOnboarder(req: Request): Decider | null {
  const got = Buffer.from(req.headers.get(ONBOARD_SEAL_HEADER) ?? ''), want = Buffer.from(onboardSeal());
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const device = deviceOf(req);
  return device ? { surface: 'vr', device } : null;
}
/** The person behind this request, or null: the page's human token first, then a sealed headset. */
export const deciderOf = (req: Request): Decider | null => (isHuman(req) ? { surface: 'web' } : deviceDecider(req));
export const notPerson = (): Response =>
  Response.json({ error: "a person's answer: needs the x-bp-human token from bp's own page, or a paired headset's token with the decide scope" }, { status: 403 });

export const SHOWN_MAX = 1000;
/** What `shown` may not carry: control characters except newline, C1 controls, format characters (\p{Cf}: bidi overrides
 *  and isolates, zero-width joiners, soft hyphen) and the line and paragraph separators, so the text the PC page shows as
 *  "what the table showed" cannot be reordered or hidden (S3 finding 8, 2026-11-10). */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u;
/** The body's `shown` as the record keeps it: required from a headset (what the person read before the pinch), optional
 *  from the page. `{ marks }` or `{ refuse }`. */
export function marksOf(who: Decider, body: Record<string, unknown>): { marks: DeciderMarks } | { refuse: Response } {
  const s = body.shown;
  const ok = typeof s === 'string' && s.trim().length > 0 && s.length <= SHOWN_MAX && !CONTROL.test(s);
  if (who.surface === 'vr' && !ok) return { refuse: Response.json({ error: `a decision from the table must say what it showed: shown, 1..${SHOWN_MAX} characters` }, { status: 400 }) };
  if (s !== undefined && !ok) return { refuse: Response.json({ error: `shown must be 1..${SHOWN_MAX} characters` }, { status: 400 }) };
  return { marks: { surface: who.surface, ...(who.device ? { device: who.device } : {}), ...(ok ? { shown: s as string } : {}) } };
}

// ------------------------------------------------------------------------------------------------ the record
/** `onboard`: a project read started (table-link-v2.md section 14): target and product the slug, verdict `start`, `job` the adopt job. */
export type DecisionKind = 'morning' | 'card' | 'policy-grant' | 'policy-revoke' | 'onboard';
export interface DecisionRecord { at: string; kind: DecisionKind; surface: Surface; device?: string; shown?: string; product?: string; target: string; verdict: string; job?: string }
export const decisionsFile = (): string => path.join(companionHome(), 'decisions.jsonl');
/** Append one row. The entity's own row already carries the marks (atomic with its state); this cross-cutting log is an
 *  index, so a failed append is logged and never undoes the decision. */
export function recordDecision(r: Omit<DecisionRecord, 'at'>): DecisionRecord {
  const row: DecisionRecord = { at: new Date().toISOString(), ...r };
  try {
    fs.mkdirSync(companionHome(), { recursive: true });
    fs.appendFileSync(decisionsFile(), JSON.stringify(row) + '\n');
  } catch (e) { console.error(`decisions.jsonl: ${(e as Error).message}`); }
  return row;
}
export function readDecisions(): DecisionRecord[] {
  return readDecisionLog().rows;
}
/** The log as written, oldest first, with the count of lines that did not parse (a torn last line) and whether the file
 *  exists at all, so a reader can tell "nothing recorded yet" from "nothing matched" (audit-logging, audit-querying). */
export function readDecisionLog(): { rows: DecisionRecord[]; unreadable: number; exists: boolean } {
  let text = '';
  try { text = fs.readFileSync(decisionsFile(), 'utf8'); } catch { return { rows: [], unreadable: 0, exists: false }; }
  let unreadable = 0;
  const rows = text.split('\n').filter((l) => l.trim()).flatMap((l) => {
    try { const r = JSON.parse(l) as DecisionRecord; if (r && typeof r === 'object' && typeof r.at === 'string') return [r]; } catch { /* counted below */ }
    unreadable++;
    return [];
  });
  return { rows, unreadable, exists: true };
}

// ------------------------------------------------------------------------------------------------ the VR grant's bound
/** What a policy grant made from the table may carry (table-link-v2.md 3.4): table-bound.server.ts, a leaf the cards share. */
export { VR_POLICY_BOUND };
/** Tools whose card sets the owner's standing permissions: answered on bp's page only. */
export const PAGE_ONLY_CARD_TOOLS: readonly string[] = ['rule.propose', 'policy.propose'];

/** Why a card's APPROVE from the table is outside what the table may approve, or null when it is inside: the same test a
 *  grant from the table meets (VR_POLICY_BOUND), applied to the one call the card would run (S3 finding 1, 2026-11-10).
 *  Its tool is one of the bound's tools; it names exactly one product (never `*`, never two that disagree); every finding
 *  or wave package it names is tier 1 or milder, an untiered or unknown finding counting as 0 (namedTiers). A decline is
 *  never tested: declining runs nothing. */
export function outsideTableBound(tool: string, args: Record<string, unknown>): string | null {
  const t = toolOf(tool);
  if (!t || !VR_POLICY_BOUND.tools.includes(t.name)) return `${tool} is not one of ${VR_POLICY_BOUND.tools.join(', ')}`;
  const named = [args.slug, args.product].filter((x) => x !== undefined);
  const slug = productOf(args);
  if (!slug || slug === '*' || named.some((x) => x !== slug)) return 'it does not name exactly one product';
  const tiers = namedTiers(t, args, slug);
  if (!tiers) return 'its findings cannot be read';
  if (tiers.some((x) => !VR_POLICY_BOUND.minTier.includes(x))) return 'it touches a stop-ship or untiered finding';
  return null;
}
/** The 403 a card approve from the table meets when outsideTableBound says why. The card stays pending for bp's page. */
export const outsideTableWords = (why: string): string => `Answer this one at your PC: it is outside what the table may approve (${why})`;
