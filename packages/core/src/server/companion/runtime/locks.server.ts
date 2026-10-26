// One turn per conversation (registry companion-runtime/headless-turn-stream): a lock keyed on the conversation id, never
// on a request or a socket. A second arrival is rejected (thread_busy, the route's 409), not queued and not superseded: the
// person cancels the running turn first. The holder releases in a `finally`, so completion, cancel, failure and an abandoned
// consumer all free it; a process restart frees everything because the table lives in memory (on globalThis, so a dev-server
// module reload keeps the locks of the turns still running).
if (typeof window !== 'undefined') throw new Error('locks.server.ts is server-only');

const g = globalThis as unknown as { __bpCompanionLocks?: Set<string> };
const held = (g.__bpCompanionLocks ??= new Set());

/** The release function, or null when the key is held. Release is idempotent. */
export function tryAcquire(key: string): (() => void) | null {
  if (held.has(key)) return null;
  held.add(key);
  let done = false;
  return () => { if (!done) { done = true; held.delete(key); } };
}

export const isHeld = (key: string): boolean => held.has(key);
export const heldKeys = (): string[] => [...held];
