// A paired headset's token, read the same way on both of this server's listeners (docs/concepts/vr-light-table/table-link-v2.md
// section 2; registry device-pairing, techniques token-binding-and-transport and revocation-and-expiry). The LAN door
// (lan-door.ts) authenticates every request with it; the loopback listener (mount.ts, through main.ts) authenticates a
// request that carries `Authorization: Bearer <token>`, which is how a headset on the USB tether proves it is the paired
// device. Either way the result is the same in-process overlay: `x-bp-device` set to the pairing's id (whatever the client
// sent is replaced) and, only when the pairing holds the `decide` scope, the decider seal (decider.server.ts) that lets
// the companion's human-only routes take a person's decision from the table. The registry is re-read from disk on every
// call (a revoke reaches the next request; an unreadable file authenticates nobody) and every row's fingerprint is
// compared in constant time over its full length.
import { timingSafeEqual } from 'node:crypto';
import { DEVICE_HEADER } from '@bp/core/server/api/session/baton.server';
import { DECIDER_SEAL_HEADER, deciderSeal } from '@bp/core/server/decider.server';
import { deviceId, fingerprintOf, lanHome, readRegistry, type Pairing } from './lan-door.ts';

export const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

/** The live pairing a token names, or null (unknown, expired, or an unreadable registry). */
export function pairingOf(token: string, now = Date.now(), home = lanHome(), warn: (s: string) => void = console.error): Pairing | null {
  const presented = fingerprintOf(token);
  let hit: Pairing | undefined;
  for (const r of readRegistry(home, warn)) if (timingSafeEqual(Buffer.from(r.fingerprint, 'hex'), presented) && !hit) hit = r;
  return hit && Date.parse(hit.expiresAt) > now ? hit : null;
}

/** When this process last authenticated each pairing (`<device>:<pairing id>`), on either listener: the Headsets page's
 *  "last seen". In memory: a restart forgets it, and the page says "not since the server started". */
const seen = new Map<string, number>();
export const lastSeen = (id: string): string | undefined => { const t = seen.get(id); return t === undefined ? undefined : new Date(t).toISOString(); };

/** The headers a request from this pairing carries into the handlers: its device id, and the seal when it may decide. */
export function deviceOverlay(p: Pairing): Record<string, string> {
  seen.set(deviceId(p), Date.now());
  return { [DEVICE_HEADER]: deviceId(p), ...(p.scopes.includes('decide') ? { [DECIDER_SEAL_HEADER]: deciderSeal() } : {}) };
}

/** The loopback listener's hook: no Authorization (or another scheme) is a plain loopback call (null); a Bearer that names a
 *  live pairing gives that pairing's overlay; any other Bearer is refused (the headset learns to pair again). */
export function loopbackDevice(authorization: string | undefined, home?: string): Record<string, string> | 'refused' | null {
  if (!authorization || !/^Bearer\b/i.test(authorization)) return null;
  const m = BEARER.exec(authorization);
  const p = m ? pairingOf(m[1], Date.now(), home) : null;
  return p ? deviceOverlay(p) : 'refused';
}
