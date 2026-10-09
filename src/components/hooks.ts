'use client';
// React <-> engine glue. Components select slices of the discrete store with useSyncExternalStore, so a
// change to one slice re-renders only the components that read it. Continuous values never pass here.
import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import type { Engine } from '@/engine/Engine';
import type { UIState } from '@/engine/state';
import type { Variant } from '@/variants/types';
import type { Density } from '@/engine/lens/contract';

export const EngineCtx = createContext<Engine | null>(null);
export const VariantCtx = createContext<Variant | null>(null);

export function useEngine(): Engine {
  const e = useContext(EngineCtx);
  if (!e) throw new Error('useEngine outside <EngineCtx>');
  return e;
}
export function useVariant(): Variant {
  const v = useContext(VariantCtx);
  if (!v) throw new Error('useVariant outside <VariantCtx>');
  return v;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** Select a slice of the engine's discrete state. Re-renders only when the slice changes. */
export function useBp<T>(sel: (s: UIState) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const E = useEngine();
  const last = useRef<{ v: T } | null>(null);
  const selRef = useRef(sel), eqRef = useRef(eq);
  selRef.current = sel; eqRef.current = eq;
  const get = useCallback(() => {
    const v = selRef.current(E.store.get());
    if (last.current && eqRef.current(last.current.v, v)) return last.current.v;
    last.current = { v };
    return v;
  }, [E]);
  return useSyncExternalStore(E.store.subscribe, get, get);
}

/** The reader density the UI uses for a lens (variant override, else the channel's, else the manifest's `reader.density`). */
export function useDensity(): (l: string) => Density {
  const V = useVariant(), E = useEngine();
  return (l) => V.ui?.density?.(l) ?? E.channel(l)?.density ?? E.M.P.LENS[l]?.density ?? 'standard';
}
