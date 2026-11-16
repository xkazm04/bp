// POST /api/onboarding/check, body `{ root }`: what bp would onboard at that folder, before anything is registered
// (server/onboarding.server.ts checkFolder). 200 + OnboardCheck (packages/core/src/scan/onboarding.ts): the normalized root,
// the proposed slug and name, the slug it is already registered under (or null), and adopt-bp's check items with how many
// are not ok. 400 `{ error }` for a body without a root, a path that is no directory, or a folder outside a git work tree;
// 403 off localhost; 415 for a non-JSON body. Nothing is written.
import { checkFolder } from '@bp/core/server/onboarding.server';
import { isObj } from '@bp/core/scan/guards';
import { jsonOnly, localOnly } from '@bp/core/scan/local-only';

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (!isObj(body) || Object.keys(body).some((k) => k !== 'root')) return Response.json({ error: 'body must be { root }' }, { status: 400 });
  const r = await checkFolder(body.root);
  return r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status });
}
