'use client';
// The bench: the one operation every lab direction calls, "these findings go there". It is what makes wave work seamless, and
// it is deliberately the same under all three looks, so the experiment compares layouts and not save behaviour.
//   No composer, no Create, no Save. A place is shown at once and written shortly after (draft-editing/debounced-save-groups):
//   the draft waves are held locally, edits coalesce for SAVE_MS, and one drain writes the difference. Its state is always
//   on screen; a failure is loud and sticky, keeps the edits and offers a retry.
//   Undo is a snapshot per gesture (undo-history/gesture-coalescing: typing a name is one step). A draft wave is harmless and
//   reversible, so it needs no commit window and no confirmation; Delete included. Dispatch is the one real act: it saves
//   first, and closes the undo history behind it.
//   The store allows a finding in one draft only, and refuses a move written in the wrong order (409 taken), so the drain
//   writes losses first. It rejects an empty package, so an empty one lives here alone until a finding lands in it.
//   Leaving flushes (batch-undo/flush-on-teardown): closing the page never drops a place.
// The gesture and the operation are apart (drag-drop/keyboard-alternatives): a drag, a 1-9 key and a slot button all call place().
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EFFORT, DEFAULT_MODEL, arrange, type ArrangeBy } from '../waves/arrange';
import { MAX_PACKAGES, type Wave, type WaveBody, type WaveEffort, type WaveModel, type WavePackage } from '@bp/core/scan/waves';
import type { Ledger } from '../useLedger';

const SAVE_MS = 600;
export type SaveState = 'saved' | 'dirty' | 'saving' | 'failed';
/** Where a place lands: a wave (or 'new'), and optionally a package of it (or 'new'); `wave: null` takes findings out of every draft. */
export interface Target { wave: string | 'new' | null; pkg?: string | 'new' }
export interface Spot { wave: Wave; pkg: WavePackage; n: number; draft: boolean }

export interface Bench {
  /** Every wave: the store's dispatched ones and the working copy of the drafts, oldest first. */
  waves: readonly Wave[];
  drafts: readonly Wave[];
  spot: ReadonlyMap<string, Spot>;
  save: SaveState;
  canUndo: boolean;
  /** What the last gesture did, in words (the live region, the undo chip). */
  said: string;
  readOnly: boolean;
  place(ids: readonly string[], to: Target): void;
  placeAt(ids: readonly string[], n: number): void;
  renameWave(id: string, name: string): void;
  patchPkg(id: string, pkg: string, c: Partial<Pick<WavePackage, 'name' | 'model' | 'effort'>>): void;
  addPkg(id: string): void;
  removePkg(id: string, pkg: string): void;
  arrangeWave(id: string, by: ArrangeBy): void;
  deleteWave(id: string): void;
  undo(): void;
  retry(): void;
  dispatch(id: string, pkgs?: string[]): Promise<void>;
  /** The findings being carried, for the drop zones' hints. */
  drag: readonly string[] | null;
  setDrag(ids: readonly string[] | null): void;
}

const sig = (w: Pick<Wave, 'name' | 'packages'>) => JSON.stringify([w.name, w.packages.filter((p) => p.ids.length).map((p) => [p.name, p.model, p.effort, p.ids])]);
const sigAll = (ws: readonly Wave[]) => ws.filter(hasIds).map((w) => w.id + sig(w)).sort().join('\n');
const hasIds = (w: Wave) => w.packages.some((p) => p.ids.length);
const body = (w: Wave): WaveBody => ({ name: w.name.trim() || 'Wave', packages: w.packages.filter((p) => p.ids.length).map(({ name, model, effort, ids }) => ({ name: name.trim() || 'Package', model, effort, ids })) });
const newPkg = (n: number, ids: string[] = []): WavePackage => ({ id: 'new-' + Math.random().toString(36).slice(2, 8), name: 'Package ' + n, model: DEFAULT_MODEL as WaveModel, effort: DEFAULT_EFFORT as WaveEffort, ids });
const n1 = (n: number, one: string) => n + ' ' + one + (n === 1 ? '' : 's');

export function useWaveBench(L: Ledger): Bench {
  const LRef = useRef(L); LRef.current = L;
  const server = L.waves.waves;
  const serverDrafts = useMemo(() => server.filter((w) => w.status === 'draft'), [server]);
  const [local, setLocalState] = useState<Wave[] | null>(null);
  const [save, setSave] = useState<SaveState>('saved');
  const [said, setSaid] = useState('');
  const [depth, setDepth] = useState(0);
  const [drag, setDrag] = useState<readonly string[] | null>(null);

  const localRef = useRef<Wave[] | null>(null);
  const setLocal = useCallback((w: Wave[] | null) => { localRef.current = w; setLocalState(w); }, []);
  const confirmed = useRef<Wave[]>(serverDrafts);
  const history = useRef<{ waves: Wave[]; said: string; group?: string }[]>([]);
  const alias = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const again = useRef(false);

  // the store's drafts are the truth whenever nothing is held here
  useEffect(() => { if (!local) confirmed.current = serverDrafts; }, [local, serverDrafts]);
  // let go of the working copy once the store shows exactly what it holds: from there on the store's refreshes read through
  useEffect(() => {
    if (local && save === 'saved' && local.every((w) => w.packages.every((p) => p.ids.length)) && sigAll(serverDrafts) === sigAll(local)) setLocal(null);
  }, [local, save, serverDrafts, setLocal]);

  /** Write the working copy's difference from what the store last confirmed. Losses first; a package or wave left empty is local. */
  const sync = useCallback(async (): Promise<boolean> => {
    const W = LRef.current.waves, target = (localRef.current ?? []).filter(hasIds);
    const held = (w: Wave) => new Set(w.packages.flatMap((p) => p.ids));
    for (const c of [...confirmed.current]) {
      if (target.some((t) => t.id === c.id)) continue;
      if (!(await W.remove(c.id))) return false;
      confirmed.current = confirmed.current.filter((x) => x.id !== c.id);
    }
    // a wave that both gives and takes first gives, so a swap between two drafts is never refused as taken
    for (const t of target) {
      const c = confirmed.current.find((x) => x.id === t.id);
      if (!c || sig(c) === sig(t)) continue;
      const now = held(t), was = held(c), lost = [...was].some((id) => !now.has(id)), gained = [...now].some((id) => !was.has(id));
      if (!lost || !gained) continue;
      const kept = c.packages.map((p) => ({ ...p, ids: p.ids.filter((id) => now.has(id)) })).filter((p) => p.ids.length);
      if (!kept.length) continue;
      const r = await W.update(c.id, { packages: kept.map(({ name, model, effort, ids }) => ({ name, model, effort, ids })) });
      if (!r) return false;
      confirmed.current = confirmed.current.map((x) => (x.id === r.id ? r : x));
    }
    for (const t of target) {
      const c = confirmed.current.find((x) => x.id === t.id);
      if (c && sig(c) === sig(t)) continue;
      const sent = sig(t);
      const r = c ? await W.update(c.id, body(t)) : await W.create(body(t));
      if (!r) return false;
      confirmed.current = c ? confirmed.current.map((x) => (x.id === r.id ? r : x)) : [...confirmed.current, r];
      if (r.id !== t.id) alias.current.set(t.id, r.id);
      // adopt the store's answer (its ids, and any finding a standing order held out) unless the person has moved on
      const cur = localRef.current;
      if (cur) setLocal(cur.map((x) => (x.id !== t.id ? x : sig(x) === sent ? r : { ...x, id: r.id })));
    }
    return true;
  }, [setLocal]);

  const drain = useCallback((): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inflight.current) { again.current = true; return inflight.current; }
    setSave('saving');
    const go = (async () => {
      let ok = true;
      do { again.current = false; ok = await sync(); } while (ok && again.current);
      inflight.current = null;
      setSave(ok ? (timer.current ? 'dirty' : 'saved') : 'failed');
      return ok;
    })();
    inflight.current = go;
    return go;
  }, [sync]);

  const schedule = useCallback(() => {
    setSave('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void drain(); }, SAVE_MS);
  }, [drain]);

  // leaving never drops a place: the page closing or the host unmounting writes what is pending
  useEffect(() => {
    const flush = () => { if (timer.current) void drain(); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [drain]);

  const current = useCallback((): Wave[] => localRef.current ?? LRef.current.waves.waves.filter((w) => w.status === 'draft'), []);
  /** One gesture: remember the state before it (`group` merges with the gesture before, as typing one name), then apply. */
  const commit = useCallback((next: Wave[], what: string, group?: string) => {
    const last = history.current[history.current.length - 1];
    if (!group || last?.group !== group) { history.current.push({ waves: current(), said: what, group }); if (history.current.length > 50) history.current.shift(); setDepth(history.current.length); }
    setLocal(next);
    setSaid(what);
    schedule();
  }, [current, schedule, setLocal]);

  const placeable = useCallback((ids: readonly string[]) => {
    const inDraft = new Set(current().flatMap((w) => w.packages.flatMap((p) => p.ids)));
    return ids.filter((id) => LRef.current.byId.get(id)?.can || inDraft.has(id));
  }, [current]);

  const place = useCallback((idsIn: readonly string[], to: Target) => {
    if (!LRef.current.writes) return;
    const ids = placeable(idsIn);
    if (!ids.length) { setSaid('Nothing to place: those findings are built, building or no longer open'); return; }
    const moving = new Set(ids);
    // out of wherever they were; a package or wave a move empties goes with it, an empty one made on purpose stays
    let next = current().map((w) => {
      const pks = w.packages.map((p) => (p.ids.some((i) => moving.has(i)) ? { ...p, ids: p.ids.filter((i) => !moving.has(i)), lost: true } : p));
      const kept = pks.filter((p) => !('lost' in p) || p.ids.length).map(({ id, name, model, effort, ids: x }) => ({ id, name, model, effort, ids: x }));
      return { ...w, packages: kept };
    }).filter((w) => w.packages.length);
    let where = 'out of its wave';
    if (to.wave === 'new') {
      const taken = new Set(LRef.current.waves.waves.map((w) => w.name).concat(next.map((w) => w.name)));
      let k = LRef.current.waves.waves.length + 1; while (taken.has('Wave ' + k)) k++;
      const w: Wave = { id: 'tmp-' + Math.random().toString(36).slice(2, 10), name: 'Wave ' + k, status: 'draft', created_at: new Date().toISOString(), packages: [newPkg(1, [...ids])] };
      next = [...next, w];
      where = w.name;
    } else if (to.wave) {
      // the target may have been emptied by this very move: it comes back
      let w = next.find((x) => x.id === to.wave);
      if (!w) { const was = current().find((x) => x.id === to.wave); if (!was) return; w = { ...was, packages: [] }; next = [...next, w]; }
      const t = w;
      let pks = t.packages;
      if (!pks.length) pks = [newPkg(1)];
      let pk = to.pkg === 'new' ? null : pks.find((p) => p.id === to.pkg) ?? pks[0];
      if (!pk) {
        if (pks.length >= MAX_PACKAGES) pk = pks[0];
        else { pk = newPkg(pks.length + 1); pks = [...pks, pk]; }
      }
      const into = pk.id;
      next = next.map((x) => (x.id === t.id ? { ...x, packages: pks.map((p) => (p.id === into ? { ...p, ids: [...p.ids, ...ids] } : p)) } : x));
      where = t.name + (pks.length > 1 ? ' · ' + pk.name : '');
    }
    commit(next, n1(ids.length, 'finding') + ' → ' + where);
    LRef.current.set((u) => { const s = new Set(u.sel); for (const id of ids) s.delete(id); return { ...u, sel: s }; });
  }, [commit, current, placeable]);

  const placeAt = useCallback((ids: readonly string[], n: number) => {
    const w = current()[n];
    place(ids, w ? { wave: w.id } : { wave: 'new' });
  }, [current, place]);

  const edit = useCallback((id: string, f: (w: Wave) => Wave, what: string, group?: string) => commit(current().map((w) => (w.id === id ? f(w) : w)), what, group), [commit, current]);
  const renameWave = useCallback((id: string, name: string) => edit(id, (w) => ({ ...w, name }), 'Renamed the wave', 'name:' + id), [edit]);
  const patchPkg = useCallback((id: string, pkg: string, c: Partial<Pick<WavePackage, 'name' | 'model' | 'effort'>>) =>
    edit(id, (w) => ({ ...w, packages: w.packages.map((p) => (p.id === pkg ? { ...p, ...c } : p)) }), c.name !== undefined ? 'Renamed the package' : c.model ? 'Package model: ' + c.model : 'Package effort: ' + c.effort, c.name !== undefined ? 'pkg:' + id + pkg : undefined), [edit]);
  const addPkg = useCallback((id: string) => edit(id, (w) => (w.packages.length >= MAX_PACKAGES ? w : { ...w, packages: [...w.packages, newPkg(w.packages.length + 1)] }), 'Added a package'), [edit]);
  const removePkg = useCallback((id: string, pkg: string) => edit(id, (w) => {
    const gone = w.packages.find((p) => p.id === pkg), rest = w.packages.filter((p) => p.id !== pkg);
    return !gone || !rest.length ? w : { ...w, packages: rest.map((p, i) => (i ? p : { ...p, ids: [...p.ids, ...gone.ids] })) };
  }, 'Removed a package; its findings joined the first'), [edit]);
  const arrangeWave = useCallback((id: string, by: ArrangeBy) => edit(id, (w) => {
    const l = LRef.current, was = new Map(w.packages.flatMap((p) => p.ids.map((i) => [i, p] as const)));
    const out = arrange(w.packages.flatMap((p) => p.ids).flatMap((i) => l.byId.get(i) ?? []), by, { lensName: (x) => l.lenses.find((c) => c.id === x)?.short ?? x, was: (i) => was.get(i) });
    return out.length ? { ...w, packages: out.map((p) => ({ ...p, id: 'new-' + Math.random().toString(36).slice(2, 8) })) } : w;
  }, by === 'one' ? 'One package' : by === 'feature' ? 'One package per feature' : 'One package per lens'), [edit]);
  const deleteWave = useCallback((id: string) => { const w = current().find((x) => x.id === id); commit(current().filter((x) => x.id !== id), 'Deleted ' + (w?.name ?? 'the wave')); }, [commit, current]);

  const undo = useCallback(() => {
    const h = history.current.pop();
    if (!h) return;
    setDepth(history.current.length);
    // a wave created since the snapshot was taken has a store id now; a deleted one is created again by the drain
    setLocal(h.waves.map((w) => ({ ...w, id: alias.current.get(w.id) ?? w.id })));
    setSaid('Undid: ' + h.said);
    schedule();
  }, [schedule, setLocal]);

  const retry = useCallback(() => { void drain(); }, [drain]);

  const dispatch = useCallback(async (id: string, pkgs?: string[]) => {
    if (timer.current || inflight.current || save === 'failed') { if (!(await drain())) return; }
    const real = alias.current.get(id) ?? id;
    // the save's reload has to land before the ledger can see a wave just created: ask, then wait for it
    LRef.current.waves.reload();
    for (let i = 0; i < 40 && !LRef.current.waves.waves.some((w) => w.id === real); i++) await new Promise((r) => setTimeout(r, 50));
    const r = await LRef.current.dispatchWave(real, pkgs);
    if (!r) return;
    history.current = []; setDepth(0);
    if (localRef.current) { const next = localRef.current.filter((w) => w.id !== real); confirmed.current = confirmed.current.filter((w) => w.id !== real); setLocal(next.length ? next : null); }
    setSaid('Dispatched ' + r.wave.name);
  }, [drain, save, setLocal]);

  const drafts = local ?? serverDrafts;
  const waves = useMemo(() => {
    const out = server.filter((w) => w.status !== 'draft');
    const gone = new Set(out.map((w) => w.id));
    return [...out, ...drafts.filter((w) => !gone.has(w.id))].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  }, [server, drafts]);
  const draftList = useMemo(() => waves.filter((w) => w.status === 'draft'), [waves]);
  const spot = useMemo(() => {
    const m = new Map<string, Spot>();
    let k = 0;
    for (const w of waves) {
      const draft = w.status === 'draft';
      if (draft) k++;
      for (const p of w.packages) for (const id of p.ids) if (draft || !m.has(id)) m.set(id, { wave: w, pkg: p, n: draft ? k : 0, draft });
    }
    return m;
  }, [waves]);

  return { waves, drafts: draftList, spot, save, canUndo: depth > 0, said, readOnly: !L.writes, place, placeAt, renameWave, patchPkg, addPkg, removePkg, arrangeWave, deleteWave, undo, retry, dispatch, drag, setDrag };
}
