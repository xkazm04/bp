// POST /api/products/[slug]/scans, body `{ lens, scope: ScanScope }`: queue a lens scan, which runs the Claude Code
// CLI headless in the product repo (`/lens-scan measure`, packages/core/src/server/jobs.server.ts). 202 + the ScanJob; 400
// `{ error: 'unknown-lens' }` (not an enabled lens of the map), `'no-scan-method'` (no built-in method and no manifest
// `scan` block), `'bad-scope'` (kind, label, id or features wrong, or a feature the map lacks); 429 when 16 jobs are
// queued already; 404 for an unknown product or a product without a map. A `selection` scope (the ledger's selected
// features) carries no id and 1..MAX_SELECTION (200) features. Localhost only.
// GET /api/products/[slug]/scans: the product's ScanJob[], oldest first.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim queues and lists the jobs, with the same answers.
// Its scope goes through this route's parseScope first, so a Kettle job keeps no unknown keys and a label of at most 200.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct } from '@bp/core/server/products.server';
import { localHost, localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { MAX_SELECTION, SAFE_ID, scannable, type ScanScope, type ScanScopeKind } from '@bp/core/scan/jobs';
import { enqueueMeasure, list } from '@bp/core/server/jobs.server';
import { readLensesAndFeatures } from '@bp/core/server/lens-write.server';
import { kettleSim, simAnswer } from '@bp/core/server/kettle-sim.server';
import { isObj } from '@bp/core/standard/guards';

const KINDS: readonly ScanScopeKind[] = ['feature', 'bay', 'room', 'wing', 'all', 'selection'];
/** Kettle's features are the sim's to check (against the sample's). */
const ANY_FEATURE = { has: () => true };

/** The scope as the job keeps it (unknown keys dropped), or null. Every feature must be a map feature. */
function parseScope(x: unknown, features: { has(f: string): boolean }): ScanScope | null {
  if (!isObj(x) || !KINDS.includes(x.kind as ScanScopeKind) || typeof x.label !== 'string' || !x.label.trim() || x.label.length > 200) return null;
  const kind = x.kind as ScanScopeKind;
  if (!Array.isArray(x.features) || x.features.length > 2000 || x.features.some((f) => typeof f !== 'string' || !SAFE_ID.test(f) || !features.has(f))) return null;
  const feats = [...new Set(x.features as string[])];
  if (kind === 'all') return x.id === undefined && !feats.length ? { kind, label: x.label.trim(), features: [] } : null;
  if (kind === 'selection') return x.id === undefined && feats.length && feats.length <= MAX_SELECTION ? { kind, label: x.label.trim(), features: feats } : null;
  if (typeof x.id !== 'string' || !SAFE_ID.test(x.id) || !feats.length) return null;
  return { kind, id: x.id, label: x.label.trim(), features: feats };
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const k = kettleSim(slug);
  if (k) return simAnswer(() => k.jobs());
  if (!findProduct(slug)) return unknownProduct(slug);
  return Response.json(list(slug));
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug } = await params;
  const k = kettleSim(slug), p = findProduct(slug);
  if (!p && !k) return unknownProduct(slug);
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  // a bad scope reaches the sim as null, so an unknown lens still answers first, as it does below
  if (k) return isObj(body) ? simAnswer(() => k.startScan(body.lens as string, parseScope(body.scope, ANY_FEATURE) as ScanScope), 202) : Response.json({ error: 'unknown-lens' }, { status: 400 });
  if (!p) return unknownProduct(slug);
  const map = readLensesAndFeatures(p);
  if (!map) return Response.json({ error: `no readable structure for ${slug}` }, { status: 404 });
  if (!isObj(body)) return Response.json({ error: 'unknown-lens' }, { status: 400 });
  const lens = body.lens, entry = typeof lens === 'string' && SAFE_ID.test(lens) ? map.lenses.find((e) => e.id === lens && e.enabled) : undefined;
  if (!entry) return Response.json({ error: 'unknown-lens' }, { status: 400 });
  if (!scannable(entry, false)) return Response.json({ error: 'no-scan-method' }, { status: 400 });
  const scope = parseScope(body.scope, map.features);
  if (!scope) return Response.json({ error: 'bad-scope' }, { status: 400 });
  const r = enqueueMeasure(slug, p.root, entry.id, scope);
  return r.ok ? Response.json(r.job, { status: 202 }) : Response.json({ error: r.error }, { status: r.status });
}
