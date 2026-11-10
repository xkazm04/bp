// POST /api/onboarding/start, body `{ candidate, shown }`: start reading a project this PC offers (owner, 2026-11-10: "Pick and
// start on the headset ... no PC click"; docs/concepts/vr-light-table/table-link-v2.md section 14; onboard-start.server.ts
// startOnboarding). Who may: bp's own page (the `x-bp-human` token, surface web) or a paired headset whose pairing holds the
// `onboard` scope (the onboard seal apps/server's device auth adds beside x-bp-device, surface vr); anyone else 403. 202
// `{ slug, name, job }`; `{ error }` in words: 400 a body that is not `{ candidate, shown }` (a path in place of the id
// included; `shown` 1..1000 characters is required from a headset), 404 an id the PC does not offer (or a folder gone), 409
// already being read or another headset-started read still running (with `slug`), 429 the daily bound (`retryAfterS`).
// Localhost only, JSON only.
import { jsonOnly, localOnly } from '@bp/core/scan/local-only';
import { isHuman } from '@bp/core/server/api/companion/door.server';
import { deviceOnboarder, type Decider } from '@bp/core/server/decider.server';
import { startOnboarding } from '@bp/core/server/onboard-start.server';

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const who: Decider | null = isHuman(req) ? { surface: 'web' } : deviceOnboarder(req);
  if (!who) return Response.json({ error: "Starting to read a project needs bp's own page, or a paired headset with the Onboard permission." }, { status: 403 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  return startOnboarding(who, body);
}
