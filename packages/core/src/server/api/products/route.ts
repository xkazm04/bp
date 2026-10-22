// GET /api/products: the live products of bp.products.local.json (Kettle is built in and not listed), each
// with `live` (= the repo has a lens-scan store) and `readiness` (packages/core/src/server/readiness.server.ts).
// A registry file that cannot be parsed answers like POST does (409 with the reason, 500 when unreadable), never 200 [].
// POST /api/products: register one, body `{ slug, name, root }` (localhost only). 201 + the entry; 400 for a
// bad body, a root that is not a directory or a reserved slug; 409 for a slug in use (or a registry file
// that cannot be parsed, which is never overwritten); 403 off localhost; 415 for a non-JSON body.
import { hasStore, readRegistry } from '@bp/core/server/products.server';
import { readinessOf } from '@bp/core/server/readiness.server';
import { addProduct, localOnly } from '@bp/core/server/registry.server';
import { jsonOnly, localHost } from '@bp/core/scan/local-only';
import type { ProductInfo } from '@bp/core/scan/types';

export function GET(req: Request): Response {
  const bad = localHost(req);
  if (bad) return Response.json({ error: bad }, { status: 403 });
  const { products, problem } = readRegistry();
  if (problem) return Response.json({ error: problem.error }, { status: problem.status }); // the writer's answer for the same file
  const out: ProductInfo[] = products.map((p) => ({ slug: p.slug, name: p.name, root: p.root, live: hasStore(p), readiness: readinessOf(p) }));
  return Response.json(out);
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  try {
    const r = addProduct(body);
    return r.ok ? Response.json(r.value, { status: 201 }) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) {
    return Response.json({ error: `could not write the registry: ${(e as Error).message}` }, { status: 500 });
  }
}
