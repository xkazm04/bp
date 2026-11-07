'use client';
// The bench: the one operation the Backlog's wave work goes through, "these findings go there". It replaced the wave composer
// on a wide window (the phone keeps waves/WaveComposer.tsx).
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
import { arrange, type ArrangeBy } from '../waves/arrange';
import { MAX_PACKAGES, type Wave, type WavePackage } from '@bp/core/scan/waves';
import type { Ledger } from '../useLedger';
import { bodyOf, foreignDrafts, newPkg, placeIn, planWrites, sig, undoTo, type Target } from './bench-rules';

export type { Target } from './bench-rules';

const SAVE_MS = 600, RELEASE_MS = 3000;
export type SaveState = 'saved' | 'dirty' | 'saving' | 'failed';
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
  const history = useRef<{ waves: Wave[]; said: string; group?: string; known: ReadonlySet<string> }[]>([]);
  /** Waves this bench created: the only ones an undo may take away by going back to before them. */
  const mine = useRef(new Set<string>());
  const alias = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const again = useRef(false);
  const gone = useRef(new Set<string>());

  // the store's drafts are the truth whenever nothing is held here
  useEffect(() => { if (!local) confirmed.current = serverDrafts; }, [local, serverDrafts]);
  // a draft this copy never knew of (the list answered after the first place, another tab, an agent) joins it: not knowing a wave
  // must never read as having deleted it. The ones deleted here are remembered, so a list still in flight cannot bring them back.
  useEffect(() => {
    const cur = localRef.current;
    if (!cur) return;
    const foreign = foreignDrafts([...cur, ...confirmed.current], serverDrafts, gone.current);
    if (!foreign.length) return;
    confirmed.current = [...confirmed.current, ...foreign];
    setLocal([...cur, ...foreign]);
  }, [serverDrafts, setLocal]);
  // let go of the working copy once the store shows what it holds, and in any case soon after the last save, so a change made
  // elsewhere reads through. An empty package exists only here, so it holds the copy until a finding lands in it.
  useEffect(() => {
    if (!local || save !== 'saved' || !local.every((w) => w.packages.every((p) => p.ids.length))) return;
    if (local.every((w) => serverDrafts.some((x) => x.id === w.id && sig(x) === sig(w)))) { setLocal(null); return; }
    const t = setTimeout(() => setLocal(null), RELEASE_MS);
    return () => clearTimeout(t);
  }, [local, save, serverDrafts, setLocal]);

  /** Write the working copy's difference from what the store last confirmed, in the order bench-rules.ts plans. */
  const sync = useCallback(async (): Promise<boolean> => {
    const W = LRef.current.waves;
    for (const w of planWrites(confirmed.current, localRef.current ?? [])) {
      if (w.kind === 'remove') {
        if (!(await W.remove(w.id))) return false;
        gone.current.add(w.id);
        confirmed.current = confirmed.current.filter((x) => x.id !== w.id);
        continue;
      }
      const t = localRef.current?.find((x) => x.id === w.id), sent = t ? sig(t) : '';
      const r = w.kind === 'patch' ? await W.update(w.id, w.body) : await W.create(w.body);
      if (!r) return false;
      confirmed.current = w.kind === 'patch' ? confirmed.current.map((x) => (x.id === r.id ? r : x)) : [...confirmed.current, r];
      if (w.kind === 'patch' && !w.final) continue;
      if (r.id !== w.id) { alias.current.set(w.id, r.id); mine.current.add(r.id); }
      // adopt the store's answer (its ids, and any finding a standing order held out) unless the person has moved on
      const cur = localRef.current;
      if (cur) setLocal(cur.map((x) => (x.id !== w.id ? x : sig(x) === sent ? r : { ...x, id: r.id })));
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
    if (!group || last?.group !== group) { const was = current(); history.current.push({ waves: was, said: what, group, known: new Set(was.map((w) => w.id)) }); if (history.current.length > 50) history.current.shift(); setDepth(history.current.length); }
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
    const server = LRef.current.waves.waves;
    const placed = placeIn(current(), ids, to, server.map((w) => w.name), server.length, new Date().toISOString());
    if (!placed) return;
    const { next, where, made } = placed;
    if (made) mine.current.add(made);
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
    // a wave created since has a store id now, a deleted one the drain creates again; a draft from elsewhere stays
    setLocal(undoTo(h.waves, h.known, current(), alias.current, mine.current));
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
