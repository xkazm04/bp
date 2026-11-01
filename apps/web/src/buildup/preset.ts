// The preset source: a finished plan replayed as the events an onboarding run would send. Two schedules:
//   demo - about 45 s at 1x, the product tree arriving wing by wing (the pipeline we would like: an incremental tree);
//   real - about 2.5 min at 1x, in today's pipeline shape: a long silent product-tree step, then the WHOLE structure in
//          one chunk (adopt-bp writes work/product-tree.json at once), history at once, then health in uneven batches
//          of 8 (one per judgement batch file). The extent is not announced (null), as a live run could not know it.
// Gaps are seeded by the product slug, so a replay is the same run. Timings are modelled, not measured: the feasibility
// check replaces them with a tape recorded from a real adopt run (docs/concepts/onboarding/feasibility.md).
import { extentOf } from './plan';
import type { BuildupEvent, BuildupListener, BuildupPlan, BuildupSource, Phase, StructureTile } from './contract';

export type PresetMode = 'demo' | 'real';

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

const structureTile = (t: BuildupPlan['tiles'][number]): StructureTile =>
  ({ id: t.id, name: t.name, order: t.order, parentId: t.parentId, box: t.box, stage: t.stage, kind: t.kind, tier: t.tier, summary: t.summary });

/** The event schedule, `at` in ms at 1x. Pure: the same plan and mode give the same list. */
export function presetSchedule(plan: BuildupPlan, mode: PresetMode): BuildupEvent[] {
  const r = rng(plan.project.slug + ':' + mode);
  const out: BuildupEvent[] = [];
  let t = 0;
  const phase = (p: Phase, state: 'start' | 'done', detail: string | null = null) => out.push({ type: 'phase', at: Math.round(t), phase: p, state, detail });
  const wait = (lo: number, hi: number) => { t += lo + (hi - lo) * r(); };
  const { wings, rooms, bays, tiles } = plan;

  out.push({ type: 'begin', at: 0, project: plan.project, extent: mode === 'demo' ? extentOf(plan) : null });
  const quick: [Phase, number, number, string | null][] = mode === 'demo'
    ? [['check', 200, 300, 'nothing adopted yet'], ['context-map', 400, 600, null], ['seed', 300, 400, `${tiles.length} features to place`]]
    : [['check', 400, 900, 'nothing adopted yet'], ['context-map', 4000, 9000, null], ['seed', 1500, 3500, null]];
  for (const [p, lo, hi, d] of quick) { phase(p, 'start'); wait(lo, hi); phase(p, 'done', d); }

  phase('product-tree', 'start');
  const sorted = [...wings].sort((a, b) => a.order - b.order);
  if (mode === 'demo') {
    const per = 20000 / Math.max(1, sorted.length);
    for (const w of sorted) {
      wait(per * 0.8, per * 1.2);
      const rs = rooms.filter((x) => x.parentId === w.id);
      const rid = new Set(rs.map((x) => x.id));
      const bs = bays.filter((x) => rid.has(x.parentId));
      const bid = new Set(bs.map((x) => x.id));
      out.push({ type: 'structure', at: Math.round(t), wings: [w], rooms: rs, bays: bs, tiles: tiles.filter((x) => bid.has(x.parentId)).map(structureTile) });
    }
  } else {
    wait(45000, 65000);
    out.push({ type: 'structure', at: Math.round(t), wings: sorted, rooms, bays, tiles: tiles.map(structureTile) });
  }
  phase('product-tree', 'done', `${wings.length} wings, ${rooms.length} rooms, ${tiles.length} features`);

  phase('events', 'start'); wait(mode === 'demo' ? 1200 : 2000, mode === 'demo' ? 1800 : 5000);
  out.push({ type: 'history', at: Math.round(t), tiles: tiles.map((x) => ({ id: x.id, created: x.created })) });
  phase('events', 'done', `${tiles.filter((x) => x.created).length} of ${tiles.length} dated`);

  phase('measure', 'start'); wait(mode === 'demo' ? 800 : 5000, mode === 'demo' ? 1200 : 12000); phase('measure', 'done');

  phase('judge', 'start');
  const batches: (typeof tiles)[] = [];
  for (let i = 0; i < tiles.length; i += 8) batches.push(tiles.slice(i, i + 8));
  const budget = mode === 'demo' ? 10000 : 60000;
  for (const b of batches) {
    const mean = budget / Math.max(1, batches.length);
    wait(mean * (mode === 'demo' ? 0.7 : 0.2), mean * (mode === 'demo' ? 1.3 : 1.8));
    out.push({ type: 'health', at: Math.round(t), tiles: b.map((x) => ({ id: x.id, general: x.general ?? 'unmeasured' })) });
  }
  phase('judge', 'done', `${tiles.filter((x) => x.general === 'bad').length} in trouble`);

  phase('register', 'start'); wait(300, 600); phase('register', 'done', plan.project.slug);
  out.push({ type: 'done', at: Math.round(t) });
  return out;
}

/** A source that plays the schedule on timers; `speed` 2 halves every gap. */
export function presetSource(plan: BuildupPlan, mode: PresetMode, speed = 1): BuildupSource {
  const events = presetSchedule(plan, mode);
  const listeners = new Set<BuildupListener>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  /** Events emitted since the last `begin`: a late subscriber (a lazily loaded variant, a screen opened mid-run) gets them first. */
  let played: BuildupEvent[] = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; played = []; };
  const emit = (e: BuildupEvent) => { played.push(e); listeners.forEach((fn) => fn(e)); };
  const start = () => {
    clear();
    for (const e of events) timers.push(setTimeout(() => emit(e), e.at / speed));
  };
  return {
    kind: mode === 'demo' ? 'preset-demo' : 'preset-real',
    subscribe(fn) { for (const e of played) fn(e); listeners.add(fn); return () => { listeners.delete(fn); }; },
    start,
    replay: start,
    dispose() { clear(); listeners.clear(); },
  };
}
