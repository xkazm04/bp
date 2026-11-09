// GET /api/health: the cheap liveness probe a headset polls to notice that the PC came back (table-link-v2.md section 6).
// 200 `{ ok: true, boot, at }` (Health): `boot` is a random id minted once per server process, so a changed boot says the
// server restarted (its in-memory baton, Kettle sims and job registry are new). No file is read. `cache-control: no-store`.
// Localhost only; the LAN door opens it to any live pairing.
import { randomBytes } from 'node:crypto';
import { localHost } from '../../../scan/local-only.ts';

export interface Health { ok: true; boot: string; at: string }
const g = globalThis as unknown as { __bpBootId?: string };
/** Minted once per process (globalThis: Next bundles each route apart). */
export const bootId = (): string => (g.__bpBootId ??= randomBytes(8).toString('hex'));

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const body: Health = { ok: true, boot: bootId(), at: new Date().toISOString() };
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
