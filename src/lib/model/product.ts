// The product as the app sees it: the staged data, optionally cloned into N product lines
// (`?scale=4` = four lines, 528 features), plus id indexes. Pure; no DOM.
import type { ActivityEvent, Capability, Domain, Feature, Kettle, Milestone, Person, Snapshot } from '@/lib/data';
import { LINES } from './constants';

export interface Building { i: number; name: string; short: string; sf: string }
export interface PDomain extends Domain { base: string; bld: number }

export interface Product {
  scale: number;
  base: Kettle;
  asOf: string; // YYYY-MM-DD
  buildings: Building[];
  domains: PDomain[];
  capabilities: Capability[];
  features: Feature[];
  activity: ActivityEvent[];
  snapshots: Snapshot[];
  weeks: string[];
  people: Person[];
  milestones: Milestone[];
  F: Record<string, Feature>;
  D: Record<string, PDomain>;
  C: Record<string, Capability>;
  P: Record<string, Person>;
  MS: Record<string, Milestone>;
  /** Feature index in `features` (stable), for typed-array aggregates. */
  FI: Record<string, number>;
}

export function clampScale(raw: string | null | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return Math.max(1, Math.min(8, Number.isFinite(n) ? n : 1));
}

export function lineSuffix(scale: number, b: number): string {
  return scale > 1 ? '-' + LINES[b][1] : '';
}
/** `PAY-09-S` → `PAY-09`. */
export function baseId(id: string): string {
  return id.replace(/-[A-Z]$/, '');
}

export function buildProduct(K: Kettle, scale: number): Product {
  const buildings: Building[] = [];
  const domains: PDomain[] = [];
  const capabilities: Capability[] = [];
  const features: Feature[] = [];
  let activity: ActivityEvent[] = [];
  for (let i = 0; i < scale; i++) {
    const sf = lineSuffix(scale, i);
    const m = (id: string) => id + sf;
    buildings.push({ i, name: scale > 1 ? 'Kettle ' + LINES[i][0] : 'Kettle', short: LINES[i][0], sf });
    for (const d of K.domains) domains.push({ ...d, id: m(d.id), base: d.id, bld: i, capabilities: d.capabilities.map(m) });
    for (const c of K.capabilities) capabilities.push({ ...c, id: m(c.id), domain: m(c.domain), features: c.features.map(m) });
    for (const f of K.features) {
      const g: Feature = scale > 1 ? (structuredClone(f) as Feature) : f;
      if (scale > 1) {
        g.id = m(f.id); g.domain = m(f.domain); g.capability = m(f.capability);
        g.dependsOn = f.dependsOn.map(m); g.usedBy = f.usedBy.map(m); g.blockedBy = f.blockedBy.map(m);
      }
      features.push(g);
    }
    for (const a of K.activity) activity.push(scale > 1 ? { ...a, feature: a.feature ? m(a.feature) : a.feature } : a);
  }
  if (scale > 1) activity = activity.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const snapshots = K.snapshots.map((s) => {
    const counts = { ...s.counts };
    for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] = counts[k] * scale;
    return { week: s.week, counts, total: s.total * scale };
  });
  const F: Record<string, Feature> = {}, D: Record<string, PDomain> = {}, C: Record<string, Capability> = {};
  const P: Record<string, Person> = {}, MS: Record<string, Milestone> = {}, FI: Record<string, number> = {};
  features.forEach((f, i) => { F[f.id] = f; FI[f.id] = i; });
  for (const d of domains) D[d.id] = d;
  for (const c of capabilities) C[c.id] = c;
  for (const p of K.people) P[p.id] = p;
  for (const m of K.milestones) MS[m.id] = m;
  return {
    scale, base: K, asOf: K.product.asOf.slice(0, 10), buildings, domains, capabilities, features, activity, snapshots,
    weeks: K.snapshots.map((s) => s.week), people: K.people, milestones: K.milestones, F, D, C, P, MS, FI,
  };
}

export function pname(p: Product, id: string): string {
  return p.P[id] ? p.P[id].name : id;
}
export function isAgentId(p: Product, id: string): boolean {
  return !!p.P[id] && p.P[id].kind === 'agent';
}
