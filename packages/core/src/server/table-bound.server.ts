// What the table (a paired headset) may set in motion, in one leaf module with no imports, so door.server.ts (the cards)
// and decider.server.ts (a person's decisions) and the companion's turn route can all read it without importing each other
// (docs/concepts/vr-light-table/table-link-v2.md 3.4 and section 11; S3 2026-11-10, findings 1, 3 and 6).
//
// - VR_POLICY_BOUND: what a policy grant made from the table may carry; a card answered from the table meets the same test.
// - The device turns: which companion conversations a paired device is driving right now (the turn route registers them),
//   per-device turn admission (one in flight, TURN_RATE per minute), and grantWithinTableBound, the test a standing grant
//   must pass before a card filed by such a turn may run under it at once.

if (typeof window !== 'undefined') throw new Error('table-bound.server.ts is server-only');

/** What a policy grant made from the table may carry (table-link-v2.md 3.4). Anything wider is refused 403 with this. */
export const VR_POLICY_BOUND = {
  tools: ['decision.answer', 'finding.decline', 'scan.directed', 'wave.dispatch'] as readonly string[],
  /** Required; a grant from the table never covers a stop-ship (tier 0) finding. */
  minTier: [1, 2, 3] as readonly number[],
  maxHours: 12,
  /** One product slug; never `*`. */
  product: 'one product slug, never *',
} as const;

/** A standing grant is one the table itself could have made: one product, the bound's tools only, a tier floor of 1..3, at
 *  most VR_POLICY_BOUND.maxHours long. A card filed by a turn a device drove runs at once only under such a grant. */
export function grantWithinTableBound(g: { product: string; tools: readonly string[]; minTier?: number; createdAt: string; expiresAt: string }): boolean {
  const hours = (Date.parse(g.expiresAt) - Date.parse(g.createdAt)) / 3600000;
  return g.product !== '*' && g.tools.length > 0 && g.tools.every((t) => VR_POLICY_BOUND.tools.includes(t))
    && g.minTier !== undefined && VR_POLICY_BOUND.minTier.includes(g.minTier) && hours > 0 && hours <= VR_POLICY_BOUND.maxHours;
}

// ------------------------------------------------------------------------------------------------ device turns
/** At most this many companion turns a paired device may start in a rolling minute. A spoken exchange at the table is one
 *  turn every several seconds at the very most (hold, speak, wait for the answer, listen): 6 a minute is above that pace,
 *  and caps a stolen session's agent spend at 6 turns a minute, one at a time. */
export const TURN_RATE_PER_MINUTE = 6;
interface DeviceTurns { inflight: Map<string, number>; starts: Map<string, number[]>; conversations: Map<string, number> }
const g = globalThis as unknown as { __bpDeviceTurns?: DeviceTurns };
const state = (): DeviceTurns => (g.__bpDeviceTurns ??= { inflight: new Map(), starts: new Map(), conversations: new Map() });

/** Admit one turn from `device`: a release function, or why not (`busy`: one is in flight; `rate`: the minute is full). */
export function admitDeviceTurn(device: string, now = Date.now()): { release: () => void } | { refuse: 'busy' | 'rate'; retryAfterS: number } {
  const s = state();
  if ((s.inflight.get(device) ?? 0) > 0) return { refuse: 'busy', retryAfterS: 1 };
  const starts = (s.starts.get(device) ?? []).filter((t: number) => now - t < 60000);
  if (starts.length >= TURN_RATE_PER_MINUTE) return { refuse: 'rate', retryAfterS: Math.max(1, Math.ceil((60000 - (now - starts[0])) / 1000)) };
  starts.push(now);
  s.starts.set(device, starts);
  s.inflight.set(device, 1);
  let done = false;
  return { release: () => { if (!done) { done = true; s.inflight.delete(device); } } };
}

/** The turn route marks a conversation as driven by a device while its turn runs (counted: two marks, two releases). */
export function markDeviceConversation(conversationId: string): () => void {
  const c = state().conversations;
  c.set(conversationId, (c.get(conversationId) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (c.get(conversationId) ?? 1) - 1;
    if (n > 0) c.set(conversationId, n); else c.delete(conversationId);
  };
}
/** A device is driving this conversation's turn right now. */
export const deviceDriven = (conversationId: string | undefined): boolean => !!conversationId && (state().conversations.get(conversationId) ?? 0) > 0;
/** Tests only: forget every device turn. */
export const resetDeviceTurns = (): void => { g.__bpDeviceTurns = undefined; };
