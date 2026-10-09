// The app's data: the Kettle sample as an app-structure v3 map plus its events log (the only product
// source), and the simulated swarm (swarm.json, the runtime feed). The map is read by the standard's
// loader (src/lib/standard/load.ts); `loadProduct()` is cached per lens toggle.
import mapJson from '@/data/kettle.app-structure.json';
import eventsText from '@/data/kettle.events.jsonl' with { type: 'text' };
import swarmJson from '@/data/swarm.json';
import { BUILTIN_LENSES } from '@/lib/standard/catalog';
import { loadStructure } from '@/lib/standard/load';
import type { Structure, Swarm } from './types';

export * from './types';

const MAP: unknown = mapJson;
const EVENTS: string = eventsText;

/**
 * The product, read from the map and its events log. `lenses` is the session toggle
 * (`-security,+com.kettle.cost`), applied on top of each lens entry's `enabled`.
 */
export function loadProduct(lenses?: string | null): Structure {
  return loadStructure(MAP, EVENTS, { catalog: BUILTIN_LENSES, lenses: lenses ?? null });
}

/** Which lenses each crew of the sample swarm works for (a runtime feed would carry this per squad). */
const SQUAD_LENSES: Record<string, string[]> = {
  scout: ['business', 'design'], warden: ['design', 'quality'], tender: ['operations'], sentinel: ['security'],
  'forge-1': ['development'], 'forge-2': ['development'], 'forge-3': ['development'], 'forge-4': ['development'],
};

/**
 * The swarm sample was written against the old sample's short ids (`PAY-09`, domain `PAY`, milestone
 * `M2`). The map passes those through as `id`, so the feed is re-keyed to slugs once, here; ids the map
 * does not know are left as they are.
 */
function adaptSwarm(raw: unknown, map: unknown): Swarm {
  const S = raw as Swarm, m = map as { features?: { slug: string; id?: string }[]; domains?: { slug: string; id?: string }[]; milestones?: { slug: string; id?: string }[] };
  const idx = (xs: { slug: string; id?: string }[] | undefined) => new Map((xs ?? []).filter((x) => x.id).map((x) => [x.id as string, x.slug]));
  const F = idx(m.features), D = idx(m.domains), MS = idx(m.milestones);
  const f = (id: string) => F.get(id) ?? id, d = (id: string) => D.get(id) ?? id;
  return {
    ...S,
    squads: S.squads.map((q) => ({ ...q, lenses: q.lenses ?? SQUAD_LENSES[q.id] ?? [] })),
    agents: S.agents.map((a) => ({ ...a, feature: f(a.feature) })),
    decisions: S.decisions.map((x) => ({ ...x, feature: f(x.feature), domain: d(x.domain), affects: x.affects.map(f) })),
    orders: S.orders.map((o) => ({ ...o, scope: { ...o.scope, ...(o.scope.domain ? { domain: d(o.scope.domain) } : {}), ...(o.scope.milestone ? { milestone: MS.get(o.scope.milestone) ?? o.scope.milestone } : {}) } })),
    replay: S.replay.map((e) => ({ ...e, feature: f(e.feature) })),
  };
}

/** The simulated swarm over the product: 42 agents, 28 decisions, 8 orders, one replayable hour. */
export const SWARM: Swarm = adaptSwarm(swarmJson, mapJson);
