// A live product's model and swarm feed. Kept out of the `@/lib/model` barrel: it imports the scan
// client (`swarmFromScan` lives next to the React hook), and the barrel is also read by server
// components (the variants index), so only the client app (BlueprintApp) imports this module.
import { loadMap, type Swarm } from '@/lib/data';
import { swarmFromScan } from '@/lib/scan/client';
import type { Feature } from '@/lib/data';
import type { ScanSnapshot } from '@/lib/scan/types';
import { AggCache, Closure } from './aggregates';
import type { Model } from './index';
import { layoutProduct } from './layout';
import type { LiveRef } from './live';
import { LiveFacets, lineCopies, restate } from './live-health';
import { LiveTracks } from './live-tracks';
import { buildProduct, lineSuffix, type Product } from './product';
import { LIVE_DECIDER, SwarmSim } from './sim';

/**
 * The feed for the sim. A scan names no decider and no domain: the decider is the person the map names
 * for it (`liveDecider`) and the domain is the feature's own. A question on a feature the map does not
 * have is dropped (it has no place to stand).
 */
export function liveSwarm(P: Product, scan: ScanSnapshot): Swarm {
  const F = P.base.features, dom = new Map(F.map((f) => [f.id, f.domain]));
  const S = swarmFromScan(scan, F), who = deciders(P);
  return {
    ...S,
    decisions: S.decisions.filter((d) => dom.has(d.feature)).map((d) => ({ ...d, domain: d.domain || dom.get(d.feature)!, decider: d.decider || who(d.lens, d.feature) })),
  };
}

/**
 * Who decides a live question on `feature` under `lens`, from the map's people: the human whose field is the
 * lens (the feature's owner when several are), else the feature's owner when that is a human, else nobody named
 * (LIVE_DECIDER, "whoever reviews"). Kettle's map routes a security proposal to jonas; a map without people
 * routes by owner, or to nobody.
 */
export function liveDecider(P: Product, lens: string, feature: string): string { return deciders(P)(lens, feature); }
function deciders(P: Product): (lens: string, feature: string) => string {
  const human = new Map<string, string>(), byField = new Map<string, string>();
  for (const p of P.people) if (p.kind === 'human') { human.set(p.id, p.field); if (p.field && !byField.has(p.field)) byField.set(p.field, p.id); }
  const owner = new Map(P.base.features.map((f) => [f.id, f.owner]));
  return (lens, feature) => {
    const o = owner.get(feature), of = o !== undefined ? human.get(o) : undefined;
    if (o && of === lens) return o;
    return byField.get(lens) ?? (o && of !== undefined ? o : LIVE_DECIDER);
  };
}

/**
 * A live product's model: its map and events log (from its route) read the way Kettle's are, and the
 * swarm built from its scan (`liveSwarm`) in live mode. Later scans reach the sim through
 * `engine.feed(liveSwarm(M.P, scan))` and the facets through `M.liveFacets.apply(scan)`, which rebuild
 * neither the layout nor the engine; a newer map goes through `refreshLiveModel`, also in place.
 * The model owns its features' lens records (copied from the loader's cached ones), because readings
 * and refreshes update them in place.
 */
export function buildLiveModel(structure: unknown, events: string, scan: ScanSnapshot, live: LiveRef, scale: number, now: () => number, lenses?: string | null): Model {
  const S = loadMap(structure, events, lenses);
  const P = buildProduct({ ...S, features: S.features.map((f) => ({ ...f, lens: { ...f.lens } })) }, scale);
  const agg = new AggCache(P), liveFacets = new LiveFacets(P, agg);
  liveFacets.apply(scan); // the store may be ahead of the map the page loaded
  const L = layoutProduct(P);
  const tracks = new LiveTracks(P);
  tracks.feed(scan); // the jobs arrive with the stream (Engine.feedTracks)
  return { P, L, sim: new SwarmSim(P, liveSwarm(P, scan), now, { live: true }), agg, closure: new Closure(P), live, liveFacets, tracks };
}

/** What a scan delta did to the facets: base ids of the features whose lens health or values moved. */
export function applyScan(M: Model, scan: ScanSnapshot): string[] {
  const ids = M.liveFacets?.apply(scan) ?? [];
  if (ids.length) M.sim.healthV++; // the engine's feed() bumps the sim version right after
  return ids;
}

const FIXED = ['id', 'code', 'domain', 'capability', 'dependsOn', 'usedBy', 'blockedBy', 'lens'] as const;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * A newer map for the model that is on screen, in place: every feature the model has takes the new map's
 * fields, lens records, health and trouble (the same Feature objects, so the layout, the engine's caches and
 * the sheet keep their references); the scan's readings are laid over again. Nothing moves. A map whose
 * features, places, links or lenses differ in shape (a feature added or removed, moved to another capability)
 * cannot be placed without a new layout: the features both maps have are still updated and `structural` is
 * true, so the caller can say that a reload places the rest. `why` says what differs: when it is only the lens
 * set, the layout is the same and the caller rebuilds the model in place instead.
 */
export function refreshLiveModel(M: Model, structure: unknown, events: string, scan: ScanSnapshot, lenses?: string | null): { structural: boolean; features: number; why: ShapeChange[] } {
  const P = M.P, S = loadMap(structure, events, lenses), next = new Map(S.features.map((f) => [f.id, f]));
  const old = P.base.features, why = new Set<ShapeChange>();
  if (S.features.length !== old.length) why.add('features');
  if (!sameSet(S.lenses.map((l) => l.id), P.lenses.map((l) => l.id))) why.add('lenses');
  for (const f0 of old) {
    const f1 = next.get(f0.id);
    if (!f1) { why.add('features'); continue; }
    if (f1.domain !== f0.domain || f1.capability !== f0.capability) why.add('places');
    if (!sameSet(f1.dependsOn, f0.dependsOn) || !sameSet(f1.blockedBy, f0.blockedBy)) why.add('links');
    const rest: Record<string, unknown> = {};
    for (const k of Object.keys(f1)) if (!(FIXED as readonly string[]).includes(k)) rest[k] = (f1 as unknown as Record<string, unknown>)[k];
    const rec = f0.lens as Record<string, Feature['lens'][string]>;
    for (const l of Object.keys(f1.lens)) rec[l] = f1.lens[l];
    for (const c of lineCopies(P, f0.id)) { Object.assign(c, rest); c.lens = rec; }
  }
  Object.assign(P.base, { kpis: S.kpis, activity: S.activity, events: S.events, warnings: S.warnings });
  P.activity = P.scale === 1 ? S.activity : S.activity.flatMap((a) => Array.from({ length: P.scale }, (_, b) => ({ ...a, feature: a.feature ? a.feature + lineSuffix(P.scale, b) : a.feature })))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  M.liveFacets?.reset();
  M.liveFacets?.apply(scan);
  for (const f0 of old) for (const c of lineCopies(P, f0.id)) restate(P, c);
  M.agg.clear();
  M.sim.restamp();
  return { structural: why.size > 0, features: old.length, why: [...why] };
}

/** Why a newer map cannot be placed in place: features added or removed, moved to another place, other links, another lens set. */
export type ShapeChange = 'features' | 'places' | 'links' | 'lenses';
/** Only the lens set changed (a temporary lens added, retired or deleted): the caller rebuilds the model and engine in place. */
export const lensesOnly = (why: readonly ShapeChange[]): boolean => why.length === 1 && why[0] === 'lenses';
