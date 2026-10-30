// POST /api/products/[slug]/scans, body `{ lens, scope: ScanScope }`: queue a lens scan, which runs the Claude Code
// CLI headless in the product repo (`/lens-scan measure`, packages/core/src/server/jobs.server.ts). 202 + the ScanJob; 400
// `{ error: 'unknown-lens' }` (not an enabled lens of the map), `'no-scan-method'` (no built-in method and no manifest
// `scan` block), `'bad-scope'` (kind, label, id or features wrong, or a feature the map lacks); 429 when 16 jobs are
// queued already; 404 for an unknown product or a product without a map. A `selection` scope (the ledger's selected
// features) carries no id and 1..MAX_SELECTION (200) features. Localhost only.
// Every lens at once: `{ lens: 'all', scope: { kind: 'all', ... }, phase?: 'measure' | 'propose' }` queues ONE job
// (`/lens-scan measure --lens all` or `/lens-scan propose --lens all`, kind measure or propose, one MAX_RUNNING slot); 400
// `'bad-phase'` for any other phase (or a phase on a single-lens body), `'bad-scope'` for a scope other than all. Kettle's sim
// has no every-lens job: it answers its own unknown-lens refusal (the ledger offers the buttons on a live product only).
// GET /api/products/[slug]/scans: the product's ScanJob[], oldest first.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim queues and lists the jobs, with the same answers.
// Its scope goes through this route's parseScope first, so a Kettle job keeps no unknown keys and a label of at most 200.
// Admission (guards, product, Kettle, JSON body): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { ALL_LENSES, MAX_SELECTION, SAFE_ID, scannable, type ScanScope, type ScanScopeKind } from '@bp/core/scan/jobs';
import { enqueueAllLenses, enqueueMeasure, list } from '@bp/core/server/jobs.server';
import { readLensesAndFeatures } from '@bp/core/server/lens-write.server';
import { isObj } from '@bp/core/scan/guards';
import { SCAN_SCOPE_KINDS } from '@bp/core/standard/schema-vocab';

const KINDS: readonly ScanScopeKind[] = SCAN_SCOPE_KINDS;
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

const scans = door('products/[slug]/scans', {
  GET: { kettle: (k) => k.jobs(), live: (c) => Response.json(list(c.slug)) },
  POST: {
    body: true,
    // a bad scope reaches the sim as null, so an unknown lens still answers first, as it does below
    kettle: (k, { body }) => (isObj(body) ? k.startScan(body.lens as string, parseScope(body.scope, ANY_FEATURE) as ScanScope) : Response.json({ error: 'unknown-lens' }, { status: 400 })),
    kettleStatus: 202,
    live: ({ slug, product: p, body }) => {
      const map = readLensesAndFeatures(p);
      if (!map) return Response.json({ error: `no readable structure for ${slug}` }, { status: 404 });
      if (!isObj(body)) return Response.json({ error: 'unknown-lens' }, { status: 400 });
      // every enabled lens in ONE job (one MAX_RUNNING slot): `lens: 'all'`, scope everything, `phase` measure (default) or propose
      if (body.lens === ALL_LENSES) {
        const phase = body.phase === undefined ? 'measure' : body.phase;
        if (phase !== 'measure' && phase !== 'propose') return Response.json({ error: 'bad-phase' }, { status: 400 });
        const scope = parseScope(body.scope, map.features);
        if (!scope || scope.kind !== 'all') return Response.json({ error: 'bad-scope' }, { status: 400 });
        if (!map.lenses.some((e) => e.enabled && scannable(e, false))) return Response.json({ error: 'no-scan-method' }, { status: 400 });
        const r = enqueueAllLenses(slug, p.root, phase);
        return r.ok ? Response.json(r.job, { status: 202 }) : Response.json({ error: r.error }, { status: r.status });
      }
      if (body.phase !== undefined) return Response.json({ error: 'bad-phase' }, { status: 400 });
      const lens = body.lens, entry = typeof lens === 'string' && SAFE_ID.test(lens) ? map.lenses.find((e) => e.id === lens && e.enabled) : undefined;
      if (!entry) return Response.json({ error: 'unknown-lens' }, { status: 400 });
      if (!scannable(entry, false)) return Response.json({ error: 'no-scan-method' }, { status: 400 });
      const scope = parseScope(body.scope, map.features);
      if (!scope) return Response.json({ error: 'bad-scope' }, { status: 400 });
      const r = enqueueMeasure(slug, p.root, entry.id, scope);
      return r.ok ? Response.json(r.job, { status: 202 }) : Response.json({ error: r.error }, { status: r.status });
    },
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return scans.GET(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return scans.POST(req, ctx);
}
