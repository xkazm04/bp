// The one place baton this server holds (session/place.ts decides every move; this keeps the record). In memory, on
// globalThis because Next bundles each route apart and they must agree; a restart forgets it, as an expired baton is
// forgotten. The device is named by the `x-bp-device` header: on the design's path the APK reaches this server only
// through the S8 LAN door (:3101), which derives the device from its paired Bearer; that door is not built, so today
// the caller names itself, and only on loopback.
import type { PlaceBaton } from '../../../session/place.ts';

if (typeof window !== 'undefined') throw new Error('baton.server.ts is server-only');

const g = globalThis as unknown as { __bpPlaceBaton?: PlaceBaton | null };
export const readBaton = (): PlaceBaton | null => g.__bpPlaceBaton ?? null;
export const writeBaton = (b: PlaceBaton | null): void => { g.__bpPlaceBaton = b; };

export const DEVICE_HEADER = 'x-bp-device';
/** The calling device's id from its header, or null when absent or not an id. */
export function deviceOf(req: Request): string | null {
  const d = req.headers.get(DEVICE_HEADER);
  return d && /^[\w.:-]{1,80}$/.test(d) ? d : null;
}
export const noDevice = (): Response => Response.json({ error: `a device call: needs the ${DEVICE_HEADER} header` }, { status: 400 });
