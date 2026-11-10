// GET /api/onboarding/requests/[request]: what became of a headset's ask to read a project (owner, 2026-11-10: "the run
// starts only after your click there"; docs/concepts/vr-light-table/table-link-v2.md section 14; onboard-start.server.ts
// askOf). 200 `{ request, name, state: "waiting" | "confirmed" | "declined" | "expired", slug?, job?, reason? }`: `slug` and
// `job` once confirmed (watch the existing feed with them), `reason` once declined. Only the pairing that made the ask may
// read it (its device mark and the onboard seal device-auth.ts adds); anyone else, and an unknown id, 404 (an ask's
// existence is not told to another caller). Localhost only. `cache-control: no-store`.
import { localHost } from '@bp/core/scan/local-only';
import { deviceOnboarder } from '@bp/core/server/decider.server';
import { askOf } from '@bp/core/server/onboard-start.server';

const none = () => Response.json({ error: 'No such ask from this headset.' }, { status: 404, headers: { 'cache-control': 'no-store' } });

export async function GET(req: Request, ctx: { params: Promise<{ request: string }> }): Promise<Response> {
  const bad = localHost(req);
  if (bad) return Response.json({ error: bad }, { status: 403 });
  const who = deviceOnboarder(req);
  if (!who?.device) return none();
  const { request } = await ctx.params;
  const a = askOf(request, who.device);
  return a ? Response.json(a, { headers: { 'cache-control': 'no-store' } }) : none();
}
