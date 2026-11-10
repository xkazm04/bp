// GET /api/onboarding/candidates: the projects this PC offers to be read from the headset (owner, 2026-11-10;
// docs/concepts/vr-light-table/table-link-v2.md section 14; onboard-start.server.ts candidates): 200
// `{ candidates: [{ id, name, hint, state: "new" | "registered" | "onboarding" }], roots }`, at most 24, by name. `id` is
// opaque (never a path), `hint` at most 60 characters with no path and no user name. Localhost only (403). A request that
// a paired headset made (its device mark) needs that pairing's `onboard` scope (the seal device-auth.ts adds), else 403;
// through the Wi-Fi door the verb itself is under `onboard`. `cache-control: no-store`.
import { localHost } from '@bp/core/scan/local-only';
import { deviceOf } from '@bp/core/server/api/session/baton.server';
import { deviceOnboarder } from '@bp/core/server/decider.server';
import { candidates } from '@bp/core/server/onboard-start.server';

export async function GET(req: Request): Promise<Response> {
  const bad = localHost(req);
  if (bad) return Response.json({ error: bad }, { status: 403 });
  if (deviceOf(req) && !deviceOnboarder(req)) return Response.json({ error: 'This headset may not start reading projects: pair it again with Onboard ticked on the PC.' }, { status: 403 });
  return Response.json(await candidates(), { headers: { 'cache-control': 'no-store' } });
}
