// The bench's rules, pure, so scripts/check-wave-bench.ts can hold them against the store's own createIn, patchIn and removeIn. Three
// promises live here. A place is written in an order the store never refuses (a finding sits in one draft only, and a move written
// the wrong way round is a 409). Not knowing a draft never reads as having deleted it (a list that answers late, another tab, an
// agent). And an undo takes back this bench's gestures, never another's draft.
import { MAX_PACKAGES, type Wave, type WaveBody, type WaveEffort, type WaveModel, type WavePackage } from '@bp/core/scan/waves';
import { DEFAULT_EFFORT, DEFAULT_MODEL } from '../waves/arrange';

/** Where a place lands: a wave (or 'new'), and optionally a package of it (or 'new'); `wave: null` takes findings out of every draft. */
export interface Target { wave: string | 'new' | null; pkg?: string | 'new' }

/** What the store would hold of a wave: an empty package exists only on the page. */
export const sig = (w: Pick<Wave, 'name' | 'packages'>): string => JSON.stringify([w.name, w.packages.filter((p) => p.ids.length).map((p) => [p.name, p.model, p.effort, p.ids])]);
export const hasIds = (w: Wave): boolean => w.packages.some((p) => p.ids.length);
export const bodyOf = (w: Wave): WaveBody => ({ name: w.name.trim() || 'Wave', packages: w.packages.filter((p) => p.ids.length).map(({ name, model, effort, ids }) => ({ name: name.trim() || 'Package', model, effort, ids })) });
export const newPkg = (n: number, ids: string[] = []): WavePackage => ({ id: 'new-' + Math.random().toString(36).slice(2, 8), name: 'Package ' + n, model: DEFAULT_MODEL as WaveModel, effort: DEFAULT_EFFORT as WaveEffort, ids });
const idsOf = (w: Pick<Wave, 'packages'>) => new Set(w.packages.flatMap((p) => p.ids));

export type WaveWrite =
  | { kind: 'remove'; id: string }
  /** `final`: the wave as the page holds it (an earlier step of a move only gives findings up). */
  | { kind: 'patch'; id: string; body: WaveBody; final: boolean }
  | { kind: 'create'; id: string; body: WaveBody };

/** The writes that turn `confirmed` into `target` (waves with no finding are not the store's): what goes first, then what gives
 *  findings up, then whatever can take its findings now. A cycle where every wave gives up all it holds (two drafts swapping their
 *  only findings) has nothing to patch to, so one wave is written again as new, which breaks it. */
export function planWrites(confirmed: readonly Wave[], targetIn: readonly Wave[]): WaveWrite[] {
  const target = targetIn.filter(hasIds), out: WaveWrite[] = [];
  const held = new Map(confirmed.map((c) => [c.id, idsOf(c)]));
  for (const c of confirmed) if (!target.some((t) => t.id === c.id)) { out.push({ kind: 'remove', id: c.id }); held.delete(c.id); }
  let pending = target.filter((t) => { const c = confirmed.find((x) => x.id === t.id); return !c || sig(c) !== sig(t); });
  for (const t of pending) {
    const c = confirmed.find((x) => x.id === t.id);
    if (!c) continue;
    const now = idsOf(t), was = idsOf(c);
    if (![...was].some((id) => !now.has(id)) || ![...now].some((id) => !was.has(id))) continue;
    const kept = c.packages.map((p) => ({ ...p, ids: p.ids.filter((id) => now.has(id)) })).filter((p) => p.ids.length);
    if (!kept.length) continue;
    out.push({ kind: 'patch', id: c.id, body: bodyOf({ ...c, packages: kept }), final: false });
    held.set(c.id, idsOf({ packages: kept }));
  }
  const free = (t: Wave) => { for (const id of idsOf(t)) for (const [w, s] of held) if (w !== t.id && s.has(id)) return false; return true; };
  while (pending.length) {
    const t = pending.find(free);
    if (t) {
      out.push(held.has(t.id) ? { kind: 'patch', id: t.id, body: bodyOf(t), final: true } : { kind: 'create', id: t.id, body: bodyOf(t) });
      held.set(t.id, idsOf(t));
      pending = pending.filter((x) => x !== t);
      continue;
    }
    // nothing can move: release the first wave that still holds something, and write it as new when its turn comes
    const stuck = pending.find((x) => held.has(x.id));
    if (!stuck) break;
    out.push({ kind: 'remove', id: stuck.id });
    held.delete(stuck.id);
  }
  return out;
}

/** Drafts the store shows that this copy never knew of: they join it. One deleted here (`gone`) stays deleted, however late the list. */
export const foreignDrafts = (known: readonly Wave[], server: readonly Wave[], gone: ReadonlySet<string>): Wave[] => {
  const ids = new Set(known.map((w) => w.id));
  return server.filter((w) => w.status === 'draft' && !ids.has(w.id) && !gone.has(w.id));
};

/** The drafts an undo goes back to: the snapshot under today's ids, plus every draft since that this bench did not make. */
export function undoTo(snapshot: readonly Wave[], known: ReadonlySet<string>, current: readonly Wave[], alias: ReadonlyMap<string, string>, mine: ReadonlySet<string>): Wave[] {
  const now = (id: string) => alias.get(id) ?? id;
  const back = snapshot.map((w) => ({ ...w, id: now(w.id) })), ids = new Set(back.map((w) => w.id)), knew = new Set([...known].map(now));
  return [...back, ...current.filter((w) => !ids.has(w.id) && !knew.has(w.id) && !mine.has(w.id))];
}

export interface Placed { next: Wave[]; where: string; made?: string }
/** Findings to `to`: out of wherever they were (a package or wave a move empties goes with it; one left empty on purpose stays).
 *  A target this very move emptied comes back. `names` are the names in use; `count` numbers a new wave. Null: no such wave. */
export function placeIn(current: readonly Wave[], ids: readonly string[], to: Target, names: readonly string[], count: number, now: string): Placed | null {
  const moving = new Set(ids);
  let next: Wave[] = current.map((w) => ({
    ...w,
    packages: w.packages.filter((p) => !p.ids.some((i) => moving.has(i)) || p.ids.some((i) => !moving.has(i))).map((p) => ({ ...p, ids: p.ids.filter((i) => !moving.has(i)) })),
  })).filter((w) => w.packages.length);
  if (to.wave === null) return { next, where: 'out of its wave' };
  if (to.wave === 'new') {
    const taken = new Set([...names, ...next.map((w) => w.name)]);
    let k = count + 1; while (taken.has('Wave ' + k)) k++;
    const w: Wave = { id: 'tmp-' + Math.random().toString(36).slice(2, 10), name: 'Wave ' + k, status: 'draft', created_at: now, packages: [newPkg(1, [...ids])] };
    return { next: [...next, w], where: w.name, made: w.id };
  }
  let t = next.find((x) => x.id === to.wave);
  if (!t) { const was = current.find((x) => x.id === to.wave); if (!was) return null; t = { ...was, packages: [] }; next = [...next, t]; }
  let pks = t.packages.length ? t.packages : [newPkg(1)];
  let pk = to.pkg === 'new' ? undefined : pks.find((p) => p.id === to.pkg) ?? pks[0];
  if (!pk) {
    if (pks.length >= MAX_PACKAGES) pk = pks[0];
    else { pk = newPkg(pks.length + 1); pks = [...pks, pk]; }
  }
  const into = pk.id, tid = t.id;
  next = next.map((x) => (x.id === tid ? { ...x, packages: pks.map((p) => (p.id === into ? { ...p, ids: [...p.ids, ...ids] } : p)) } : x));
  return { next, where: t.name + (pks.length > 1 ? ' · ' + pk.name : '') };
}
