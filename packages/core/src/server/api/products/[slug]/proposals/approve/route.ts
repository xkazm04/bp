// POST /api/products/[slug]/proposals/approve, body `{ ids: string[] }` (1..50): a device approves several findings with one
// pinch (owner 2026-10-31, D15: "where an approval relates to several findings at once, one pinch approves all of them").
// Each id goes through the same `steer` approve as the one-finding verb (`../[id]/approve/route.ts`): proposed -> approved,
// signed like every bp decision, note `Morning Watch`, one steering-log row each. It queues no job. An id that cannot be
// approved is skipped, not fatal, and named with why, the way /dispatch reports skips: `unknown` (no such finding), `in-job`
// (a queued or running execute job already builds it), or the status it already holds (approved, declined, ...). Each id once.
// A device call: `x-bp-device` names the caller (400 without it; the LAN door sets it from the paired token, scope `decide`).
// 200 `{ approved: string[], skipped: { id, status }[], device }`; 400 no device, a body that is no object, or ids that are
// not 1..50 strings; 403 while BP_WRITES=off; 404 unknown product; 503 the store failed part-way (what was done stands).
// Localhost only.
import { jsonOnly, localOnly } from '@bp/core/scan/local-only';
import { deviceOf, noDevice } from '@bp/core/server/api/session/baton.server';
import { steer } from '@bp/core/server/api/companion/morning.server';
import { findProduct } from '@bp/core/server/products.server';
import { busyProposals } from '@bp/core/server/jobs.server';

const NO_STORE = { 'cache-control': 'no-store' };
const MAX_IDS = 50;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let b: unknown;
  try { b = await req.json(); } catch { return Response.json({ error: 'body must be a JSON object ({ ids: [...] })' }, { status: 400 }); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return Response.json({ error: 'body must be a JSON object ({ ids: [...] })' }, { status: 400 });
  const raw = (b as { ids?: unknown }).ids;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_IDS || raw.some((x) => typeof x !== 'string' || !x)) {
    return Response.json({ error: `ids must be 1 to ${MAX_IDS} finding ids` }, { status: 400 });
  }
  const device = deviceOf(req);
  if (!device) return noDevice();
  const { slug } = await params;
  if (!findProduct(slug)) return Response.json({ error: `no product ${slug}` }, { status: 404, headers: NO_STORE });
  const busy = busyProposals(slug), approved: string[] = [], skipped: { id: string; status: string }[] = [];
  for (const id of new Set(raw as string[])) {
    if (busy.has(id)) { skipped.push({ id, status: 'in-job' }); continue; }
    const r = await steer(slug, id, 'approve');
    if (!('error' in r)) { approved.push(id); continue; }
    if (r.status === 404) skipped.push({ id, status: 'unknown' });
    else if (r.status === 409) skipped.push({ id, status: /is already (\S+)/.exec(r.error)?.[1] ?? 'decided' });
    else return Response.json({ error: r.error, approved, skipped }, { status: r.status, headers: NO_STORE }); // writes off, store down
  }
  console.log(`approve: ${slug} ${approved.length} of ${new Set(raw).size} approved from ${device}`);
  return Response.json({ approved, skipped, device }, { headers: NO_STORE });
}
