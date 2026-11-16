'use client';
// The ledger's waves (lib/scan/waves.ts): named packages of findings, each built by its own execute job with its own model
// and effort. This hook loads the product's waves (listWaves: a live product's /waves routes, or Kettle's browser store),
// refreshes them after every mutation and whenever a wave job changes status, and wraps the four mutations so a refusal
// becomes a toast and the caller (the composer, the strip) gets a result to react to: null means nothing changed.
// A list the product cannot have (501 before the routes land, 404 for a product with no store) reads as "no waves"; any
// other failure (a 5xx, the network, a malformed answer) is `error`, so the strip says the list was not read and offers a
// retry instead of asserting the product has none. Either way the ledger never breaks on it.
// Derived here, once per change, for the views: each wave's state (waveState over the product's jobs), the finding ->
// wave/package map (waveOfId) and the ids held by a DRAFT wave (a finding may sit in one draft wave only).
// useForecast: a dry dispatch's answer for the Dispatch buttons (build-forecast.ts words it), asked once the key settles.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScanCtx } from '@/lib/scan/actions';
import { refusalOf, type ForecastLike, type ForecastState } from './build-forecast';
import { createWave, deleteWave, dispatchWave, listWaves, refusalText, updateWave } from '@/lib/scan/actions';
import type { ScanJob } from '@bp/core/scan/jobs';
import { waveOfId, waveState, type Wave, type WaveBody, type WaveDispatchResult, type WavePackage, type WaveState } from '@bp/core/scan/waves';
import { useEngine } from '../hooks';

const NO_WAVES: readonly Wave[] = [];

/** The forecast for `key` (null = nothing to ask): `ask` (actions.ts forecastDispatch / forecastWave) runs FORECAST_MS after
 *  the key last changed; an answer for an older key is dropped, so the button never shows another selection's words. */
const FORECAST_MS = 250;
export function useForecast<T extends ForecastLike>(key: string | null, ask: () => Promise<T>): { state: ForecastState; value: T | null } {
  const [got, setGot] = useState<{ key: string; state: ForecastState; value: T | null } | null>(null);
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    if (key === null) return;
    const live = { on: true };
    const t = setTimeout(() => {
      askRef.current().then((v) => { if (live.on) setGot({ key, state: { forecast: v }, value: v }); }, (e) => { if (live.on) setGot({ key, state: refusalOf(e), value: null }); });
    }, FORECAST_MS);
    return () => { live.on = false; clearTimeout(t); };
  }, [key]);
  return got && got.key === key ? got : { state: null, value: null };
}

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
  /** The last list failed for a reason other than "this product has no waves" (a 5xx, the network): its words. Null
   *  when the last list answered. `waves` keeps what was read before, so a failed reload never empties the strip. */
  error: string | null;
  /** Ask for the list again (the strip's Try again). */
  reload(): void;
  /** What one package reads as: the wave's state over that package's jobs alone ('draft' = not dispatched). */
  packageState(w: Wave, p: WavePackage): WaveState;
  create(body: WaveBody): Promise<Wave | null>;
  update(id: string, patch: Partial<WaveBody>): Promise<Wave | null>;
  remove(id: string): Promise<boolean>;
  /** Dispatch the wave (default: every package) or the named packages. A 429 midway still answers with what was queued. */
  dispatch(id: string, packages?: string[]): Promise<WaveDispatchResult | null>;
}

/** The answers that mean "this product has no waves" rather than "the list could not be read". */
const NONE_STATUS = new Set([404, 501]);

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
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const key = ctx.slug ?? 'kettle';
  // a wave job changing status is what flips a wave's state and its "Dispatch remaining": reload on that, not on every jobs update
  const sig = useMemo(() => jobs.filter((j) => j.wave).map((j) => j.id + ':' + j.status).join(' '), [jobs]);

  const load = useCallback(async (live: { on: boolean }) => {
    try {
      const w = await listWaves(ctxRef.current);
      if (live.on) { setWaves(Array.isArray(w) && w.length ? w : NO_WAVES); setError(null); }
    } catch (e) {
      if (!live.on) return;
      const st = refusal(e).status;
      if (st !== undefined && NONE_STATUS.has(st)) { setWaves(NO_WAVES); setError(null); } // 501 / no store: no waves
      else setError(refusalText(e)); // 5xx / offline: not read, and not "none"
    } finally {
      if (live.on) setLoaded(true); // asked and answered, however it answered
    }
  }, []);
  useEffect(() => { setWaves(NO_WAVES); setLoaded(false); setError(null); }, [key]);
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

  const reload = useCallback(() => { void load({ on: true }); }, [load]);
  // the owner's standing orders (Rules) leave held findings out of a wave and skip them at dispatch (`held:O-n`): say so
  const create = useCallback(async (body: WaveBody) => {
    const w = await run('Wave not created', () => createWave(ctxRef.current, body));
    const kept = new Set(w?.packages.flatMap((p) => p.ids) ?? []), out = w ? body.packages.flatMap((p) => p.ids).filter((id) => !kept.has(id)) : [];
    if (out.length) E.toast('Held by a standing order', out.length + (out.length === 1 ? ' finding was' : ' findings were') + ' left out of ' + w!.name + ': an order holds ' + (out.length === 1 ? 'its place' : 'their places') + ' (Rules)', undefined, undefined, 'warn');
    return w;
  }, [run, E]);
  const update = useCallback((id: string, patch: Partial<WaveBody>) => run('Wave not saved', () => updateWave(ctxRef.current, id, patch)), [run]);
  const remove = useCallback(async (id: string) => (await run('Wave not deleted', () => deleteWave(ctxRef.current, id))) !== null, [run]);
  const dispatch = useCallback((id: string, packages?: string[]) => run<WaveDispatchResult>('Wave not dispatched', () => dispatchWave(ctxRef.current, id, packages).then((r) => {
    const held = r.skipped.filter((x) => x.status.startsWith('held:')), by = [...new Set(held.map((x) => x.status.slice(5)))];
    if (held.length) E.toast('Held by ' + by.join(', '), held.length + (held.length === 1 ? ' finding was' : ' findings were') + ' skipped: a standing order holds ' + (held.length === 1 ? 'its place' : 'their places') + '; lift it in Rules to build ' + (held.length === 1 ? 'it' : 'them'), undefined, undefined, 'warn');
    return r;
  }), (e) => {
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

  return useMemo(() => ({ waves, states, waveOf, draftOf, busy, loaded, error, reload, packageState, create, update, remove, dispatch }),
    [waves, states, waveOf, draftOf, busy, loaded, error, reload, packageState, create, update, remove, dispatch]);
}
