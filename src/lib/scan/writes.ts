// BP_WRITES=off: a read-only blueprint (spark one-control, when Personas is the one point of control over a product).
// It turns off the person's DECISIONS only: approve / decline, dispatch and lens execute (which approve), and triage
// (accept / rework / descope / reopen). Their controls are hidden and their routes answer 403 with WRITES_OFF. Scans,
// lens edits and the whole Release tab (bp composes releases) stay live. Nothing is deleted. Default: writes on.
// Pure (process.env only), so the checks import it.

export const WRITES_OFF = 'decisions are read-only on this blueprint (BP_WRITES=off): approve, decline, dispatch and triage are turned off; the Release tab stays live';

/** Whether this server takes decisions (anything but BP_WRITES=off, in any case). */
export function writesOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BP_WRITES ?? '').trim().toLowerCase() !== 'off';
}

/** The 403 reason a decision route answers while writes are off, else null. */
export function writesOff(env?: Record<string, string | undefined>): string | null {
  return writesOn(env) ? null : WRITES_OFF;
}
