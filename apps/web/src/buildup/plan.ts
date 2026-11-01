// A product's whole build-up plan, read from the app's own routes: the plan route's boxes (core's layout, so the build-up
// ends on the same boxes the canvas draws) joined with the structure route's feature fields. Kettle answers both routes
// as the built-in sample. `created` falls back to the feature's first `feature-added` event: real products keep their
// dates in events.jsonl, not on the feature.
import type { BBox, BuildupPlan, BTile, Health, Stage } from './contract';

interface PlanNode { id: string; name: string; order: number; box: BBox; parentId?: string; letter?: string; general?: string }
interface PlanDoc { wings: PlanNode[]; rooms: PlanNode[]; bays: PlanNode[]; tiles: PlanNode[] }
interface RawFeature { id?: string; slug?: string; name?: string; summary?: string; kind?: string; tier?: string; stage?: string; created?: string }
interface StructureDoc { structure: { project?: { slug?: string; name?: string }; features?: RawFeature[] }; events?: string }

const STAGES: ReadonlySet<string> = new Set(['live', 'flagged', 'in-review', 'in-dev', 'specified', 'idea', 'deprecated']);
const HEALTH: ReadonlySet<string> = new Set(['good', 'watch', 'bad', 'na', 'unmeasured']);

const api = (slug: string) => '/api/products/' + encodeURIComponent(slug);

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', signal });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

/** First `feature-added` date per feature id, from an events log (JSON lines). */
export function firstSeen(eventsText: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of (eventsText ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { type?: string; feature?: string; at?: string };
      if (e.type === 'feature-added' && e.feature && e.at && !out.has(e.feature)) out.set(e.feature, e.at);
    } catch { /* a bad line is skipped, as the loader does */ }
  }
  return out;
}

export async function fetchBuildupPlan(slug: string, signal?: AbortSignal): Promise<BuildupPlan> {
  const [plan, st] = await Promise.all([getJson<PlanDoc>(api(slug) + '/plan', signal), getJson<StructureDoc>(api(slug) + '/structure', signal)]);
  const feats = new Map<string, RawFeature>();
  for (const f of st.structure.features ?? []) { if (f.id) feats.set(f.id, f); if (f.slug) feats.set(f.slug, f); }
  const seen = firstSeen(st.events);
  const tiles: BTile[] = plan.tiles.map((t) => {
    const f = feats.get(t.id) ?? feats.get(t.id.split(':').pop() ?? '') ?? {};
    const key = f.slug ?? f.id ?? t.id;
    return {
      id: t.id, name: t.name, order: t.order, parentId: t.parentId ?? '', box: t.box,
      stage: f.stage && STAGES.has(f.stage) ? (f.stage as Stage) : null,
      kind: f.kind ?? null, tier: f.tier ?? null, summary: f.summary ?? null,
      created: f.created ?? seen.get(key) ?? seen.get(f.id ?? '') ?? null,
      general: t.general && HEALTH.has(t.general) ? (t.general as Health) : null,
    };
  });
  const project = { slug: st.structure.project?.slug ?? slug, name: st.structure.project?.name ?? slug };
  return {
    project,
    counts: { wings: plan.wings.length, rooms: plan.rooms.length, bays: plan.bays.length, tiles: tiles.length },
    wings: plan.wings.map((w) => ({ id: w.id, name: w.name, order: w.order, letter: w.letter ?? '', box: w.box })),
    rooms: plan.rooms.map((r) => ({ id: r.id, name: r.name, order: r.order, parentId: r.parentId ?? '', box: r.box })),
    bays: plan.bays.map((b) => ({ id: b.id, name: b.name, order: b.order, parentId: b.parentId ?? '', box: b.box })),
    tiles,
  };
}

/** The plan's bounding box. */
export function extentOf(p: Pick<BuildupPlan, 'wings'>): BBox {
  if (!p.wings.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { box: b } of p.wings) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
