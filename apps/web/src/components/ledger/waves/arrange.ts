// The wave composer's Arrange: re-partition the findings a wave holds into packages in one press. React-free (a node
// check imports it). `one` = every finding in one package; `feature` = one package per feature, so no two packages build
// the same feature in parallel (by construction); `lens` = one package per lens, named by its short name (lenses are
// data: the name comes from the caller's lens list, never from a lens id literal). Over MAX_PACKAGES the heaviest groups
// (size weight) keep their own package and each remaining group, heaviest first, joins the lightest package so far;
// a group is never split. Arrange only re-partitions: a package keeps the model and effort of the package that held its
// first finding before (`was`), else the composer's default (Opus, high). Deterministic: the findings are taken in map
// order (Finding.fi, then id), so the same findings in any order give the same packages.
import { MAX_NAME, MAX_PACKAGES, type WaveEffort, type WaveModel } from '@bp/core/scan/waves';
import type { Finding } from '../useLedger';

export type ArrangeBy = 'one' | 'feature' | 'lens';
export interface Arranged { name: string; model: WaveModel; effort: WaveEffort; ids: string[] }
export interface ArrangeOpts {
  /** The lens's short name (L.lenses); the lens id when absent. */
  lensName?(lens: string): string;
  /** The model and effort of the package that held this finding before the arrange. */
  was?(id: string): { model: WaveModel; effort: WaveEffort } | undefined;
  max?: number;
}
type Item = Pick<Finding, 'fi' | 'fname'> & { p: Pick<Finding['p'], 'id' | 'feature' | 'lens' | 'size'> };

/** The composer's default for a package nobody chose a model for (WaveComposer's new wave and + Package). */
export const DEFAULT_MODEL: WaveModel = 'opus', DEFAULT_EFFORT: WaveEffort = 'high';
/** The ledger's size weights (useLedger.ts SIZE_W; check:wave-arrange weighs its cases with that one). */
const W: Record<string, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
const weight = (f: Item) => W[f.p.size ?? 'M'] ?? W.M;

const cut = (s: string, room: number) => (s.length <= room ? s : s.slice(0, Math.max(1, room - 1)).trimEnd() + '…');

export function arrange(findings: readonly Item[], by: ArrangeBy, o: ArrangeOpts = {}): Arranged[] {
  const max = Math.max(1, o.max ?? MAX_PACKAGES);
  const sorted = [...findings].sort((a, b) => a.fi - b.fi || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0));
  if (!sorted.length) return [];
  const groups = new Map<string, { label: string; order: number; w: number; items: Item[] }>();
  for (const f of sorted) {
    const key = by === 'one' ? '' : by === 'feature' ? f.p.feature : f.p.lens;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { label: by === 'one' ? 'Package 1' : by === 'feature' ? f.fname || f.p.feature : o.lensName?.(f.p.lens) || f.p.lens, order: groups.size, w: 0, items: [] }));
    g.w += weight(f); g.items.push(f);
  }
  const heavy = [...groups.values()].sort((a, b) => b.w - a.w || a.order - b.order);
  const bins = heavy.slice(0, max).map((g) => ({ head: g, w: g.w, n: 0, items: [...g.items] }));
  for (const g of heavy.slice(max)) {
    const to = bins.reduce((m, b) => (b.w < m.w || (b.w === m.w && b.head.order < m.head.order) ? b : m));
    to.w += g.w; to.n++; to.items.push(...g.items);
  }
  return bins.sort((a, b) => a.head.order - b.head.order).map((b) => {
    const items = b.items.sort((x, y) => x.fi - y.fi || (x.p.id < y.p.id ? -1 : 1)), ids = items.map((f) => f.p.id);
    const tail = b.n ? ' + ' + b.n + ' more' : '', kept = o.was?.(ids[0]);
    return { name: cut(b.head.label, MAX_NAME - tail.length) + tail, model: kept?.model ?? DEFAULT_MODEL, effort: kept?.effort ?? DEFAULT_EFFORT, ids };
  });
}

/** Features held by more than one package (they build in parallel in one repo and may collide): the feature's name and
 *  the indexes of the packages that hold it, in first-seen order. */
export function sharedFeatures(pks: readonly { ids: readonly string[] }[], byId: ReadonlyMap<string, Pick<Item, 'fname' | 'p'>>): { feature: string; name: string; pk: Set<number> }[] {
  const by = new Map<string, { feature: string; name: string; pk: Set<number> }>();
  pks.forEach((p, k) => {
    for (const id of p.ids) {
      const f = byId.get(id); if (!f) continue;
      let e = by.get(f.p.feature); if (!e) by.set(f.p.feature, (e = { feature: f.p.feature, name: f.fname, pk: new Set() }));
      e.pk.add(k);
    }
  });
  return [...by.values()].filter((e) => e.pk.size > 1);
}
