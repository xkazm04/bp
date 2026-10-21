'use client';
// The ledger's waves (lib/scan/waves.ts): named packages of findings, each built by its own execute job with its own model
// and effort. This hook loads the product's waves (listWaves: a live product's /waves routes, or Kettle's browser store),
// refreshes them after every mutation and whenever a wave job changes status, and wraps the four mutations so a refusal
// becomes a toast and the caller (the composer, the strip) gets a result to react to: null means nothing changed.
// A failing list (501 before the routes land, a product with no store) reads as "no waves": the ledger never breaks on it.
// Derived here, once per change, for the views: each wave's state (waveState over the product's jobs), the finding ->
// wave/package map (waveOfId) and the ids held by a DRAFT wave (a finding may sit in one draft wave only).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScanCtx } from '@/lib/scan/actions';
import { createWave, deleteWave, dispatchWave, listWaves, refusalText, updateWave } from '@/lib/scan/actions';
import type { ScanJob } from '@bp/core/scan/jobs';
import { waveOfId, waveState, type Wave, type WaveBody, type WaveDispatchResult, type WavePackage, type WaveState } from '@bp/core/scan/waves';
import { useEngine } from '../hooks';

const NO_WAVES: readonly Wave[] = [];

export interface WavesModel {
  waves: readonly Wave[];
  /** Wave id -> its state, from the product's jobs. */
  states: ReadonlyMap<string, WaveState>;
  /** Proposal id -> the newest wave and package holding it. */
  waveOf: ReadonlyMap<string, { wave: string; package: string }>;
  /** Proposal id -> the DRAFT wave holding it (the one that refuses it from another draft). */
  draftOf: ReadonlyMap<string, Wave>;
  /** A mutation is in flight (one at a time). */
  busy: boolean;
  /** The first list has come back (either way). Before it, an empty `waves` means "not asked yet", NOT "none": a
   *  surface that cannot tell the two apart asserts a product has no waves while the request is still open. */
  loaded: boolean;
  /** What one package reads as: the wave's state over that package's jobs alone ('draft' = not dispatched). */
  packageState(w: Wave, p: WavePackage): WaveState;
  create(body: WaveBody): Promise<Wave | null>;
  update(id: string, patch: Partial<WaveBody>): Promise<Wave | null>;
  remove(id: string): Promise<boolean>;
  /** Dispatch the wave (default: every package) or the named packages. A 429 midway still answers with what was queued. */
  dispatch(id: string, packages?: string[]): Promise<WaveDispatchResult | null>;
}

interface Refusal { status?: number; body?: { taken?: string[]; wave?: Wave; jobs?: ScanJob[] } }
const refusal = (e: unknown) => e as Refusal;

/** The refusal in words: a 409 'taken' names the findings that sit in another draft wave. */
function why(e: unknown): string {
  const taken = refusal(e).body?.taken;
  if (refusal(e).status === 409 && taken?.length) return taken.length + (taken.length === 1 ? ' finding is' : ' findings are') + ' already in another draft wave: ' + taken.slice(0, 4).join(', ') + (taken.length > 4 ? ', …' : '');
  return refusalText(e);
}

export function useWaves(ctx: ScanCtx, jobs: readonly ScanJob[]): WavesModel {
  const E = useEngine();
  const [waves, setWaves] = useState<readonly Wave[]>(NO_WAVES);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const key = ctx.slug ?? 'kettle';
  // a wave job changing status is what flips a wave's state and its "Dispatch remaining": reload on that, not on every jobs update
  const sig = useMemo(() => jobs.filter((j) => j.wave).map((j) => j.id + ':' + j.status).join(' '), [jobs]);

  const load = useCallback(async (live: { on: boolean }) => {
    try {
      const w = await listWaves(ctxRef.current);
      if (live.on) setWaves(Array.isArray(w) && w.length ? w : NO_WAVES);
    } catch {
      if (live.on) setWaves(NO_WAVES); // 501 / no store / offline: no waves, the ledger carries on
    } finally {
      if (live.on) setLoaded(true); // asked and answered, however it answered
    }
  }, []);
  useEffect(() => { setWaves(NO_WAVES); setLoaded(false); }, [key]);
  useEffect(() => {
    const live = { on: true };
    void load(live);
    return () => { live.on = false; };
  }, [key, sig, load]);

  /** Run one mutation: busy while it runs, a refusal toasted (`what` is its title), the list reloaded after. */
  const run = useCallback(async <T,>(what: string, f: () => Promise<T>, recover?: (e: unknown) => T | undefined): Promise<T | null> => {
    setBusy(true);
    try {
      return await f();
    } catch (e) {
      const r = recover?.(e);
      if (r !== undefined) return r;
      E.toast(what, why(e));
      return null;
    } finally {
      setBusy(false);
      void load({ on: true });
    }
  }, [E, load]);

  const create = useCallback((body: WaveBody) => run('Wave not created', () => createWave(ctxRef.current, body)), [run]);
  const update = useCallback((id: string, patch: Partial<WaveBody>) => run('Wave not saved', () => updateWave(ctxRef.current, id, patch)), [run]);
  const remove = useCallback(async (id: string) => (await run('Wave not deleted', () => deleteWave(ctxRef.current, id))) !== null, [run]);
  const dispatch = useCallback((id: string, packages?: string[]) => run<WaveDispatchResult>('Wave not dispatched', () => dispatchWave(ctxRef.current, id, packages), (e) => {
    // queue full midway: the jobs already queued stand (their approvals too), so this is a partial success
    const b = refusal(e).body;
    if (refusal(e).status !== 429 || !b?.wave) return undefined;
    E.toast('Queue full', (b.jobs?.length ?? 0) + ' of the wave\'s jobs were queued; dispatch the rest when the queue drains');
    return { wave: b.wave, jobs: b.jobs ?? [], approved: [], skipped: [] };
  }), [run, E]);

  const states = useMemo(() => new Map(waves.map((w) => [w.id, waveState(w, jobs)])), [waves, jobs]);
  const waveOf = useMemo(() => waveOfId(waves), [waves]);
  const draftOf = useMemo(() => {
    const m = new Map<string, Wave>();
    for (const w of waves) if (w.status === 'draft') for (const p of w.packages) for (const id of p.ids) m.set(id, w);
    return m;
  }, [waves]);
  const packageState = useCallback((w: Wave, p: WavePackage): WaveState => waveState({ ...w, jobs: (w.jobs ?? []).filter((j) => j.package === p.id) }, jobs), [jobs]);

  return useMemo(() => ({ waves, states, waveOf, draftOf, busy, loaded, packageState, create, update, remove, dispatch }),
    [waves, states, waveOf, draftOf, busy, loaded, packageState, create, update, remove, dispatch]);
}
