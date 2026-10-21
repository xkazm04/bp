// The change maps of the compare panel's shot pairs: each pair is computed once per session (a module cache keyed by
// `<before shot id>:<after shot id>`) by changeMap.worker.ts, so switching items back and forth never recomputes and
// the main thread does no pixel work. Where Worker or OffscreenCanvas is missing, or the worker cannot start, the pair
// is computed once on the main thread instead; the panel shows "computing…" either way until the result arrives.
import { useEffect, useSyncExternalStore } from 'react';
import { diffPixels, type PixGrid } from '@bp/core/train/pixels';
import type { MapReply, MapRequest } from './changeMap.worker';

/** A shot pair to compare: its cache key and the two image URLs. */
export interface PairRef { key: string; before: string; after: string }
export type MapState = { status: 'computing' } | { status: 'done'; grid: PixGrid } | { status: 'error'; error: string };

const DEV = process.env.NODE_ENV !== 'production';
/** How long one pair's change map may take before the panel says it did not answer (a slow decode of two 1600 px shots
 *  is seconds; a fetch that never settles has no end of its own). */
export const MAP_WAIT_MS = 45_000;
/** Wider screens are compared at this width (as the worker does). */
const MAX_W = 1600;

/** `p`, or a rejection that says what did not answer and for how long: a request that never returns must end in a
 *  stated state, not in "loading" for as long as the panel is open. The timer is cleared when `p` settles first. */
export function boundedWait<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what} did not answer within ${ms / 1000} s`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e: unknown) => { clearTimeout(t); rej(e); });
  });
}

// ------------------------------------------------------------------------------------------- the cache
const cache = new Map<string, MapState>();
/** Keys whose error is a timeout: those are tried again the next time the item is shown, a 404 or a decode error is not. */
const timedOut = new Set<string>();
const subs = new Set<() => void>();
let version = 0, computed = 0;
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snap = () => version;
function put(key: string, st: MapState) { cache.set(key, st); version++; for (const f of [...subs]) f(); }

// ------------------------------------------------------------------------------------------- the worker
/** undefined: not tried yet; null: unavailable here (the main thread computes). */
let worker: Worker | null | undefined;
const waiting = new Map<number, (r: MapReply | null) => void>();
let seq = 0;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return (worker = null);
  try {
    const w = new Worker(new URL('./changeMap.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<MapReply>) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data); };
    // a worker that cannot load or crashes: every pending pair falls back to the main thread, and so do later ones
    w.onerror = () => { worker = null; w.terminate(); for (const f of waiting.values()) f(null); waiting.clear(); };
    worker = w;
  } catch (e) {
    if (DEV) console.debug('[change-map] no worker, computing on the main thread:', e);
    worker = null;
  }
  return worker;
}

/** One request to the worker; null when the worker died before answering. */
function ask(w: Worker, before: MapRequest['before'], after: MapRequest['after']): Promise<MapReply | null> {
  const id = ++seq, transfer = [before, after].filter((x): x is ImageBitmap => typeof x !== 'string');
  return new Promise((res) => { waiting.set(id, res); w.postMessage({ id, before, after } satisfies MapRequest, transfer); });
}

async function loadImg(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

/** The fallback: both images drawn on a canvas and compared here, once per pair. */
async function onMain(p: PairRef): Promise<PixGrid> {
  const [a, b] = await Promise.all([loadImg(p.before), loadImg(p.after)]);
  const k = Math.min(1, MAX_W / Math.max(1, a.naturalWidth)), w = Math.max(1, Math.round(a.naturalWidth * k)), h = Math.max(1, Math.round(a.naturalHeight * k));
  const read = (img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no 2d canvas context');
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  };
  return diffPixels(read(a), read(b), w, h);
}

async function compute(p: PairRef): Promise<PixGrid> {
  const w = getWorker();
  if (!w) return onMain(p);
  let r = await ask(w, p.before, p.after);
  // an SVG (Kettle's sample screens) cannot be decoded in a worker: the page decodes, the worker still compares
  if (r && 'error' in r && r.decode) {
    const [a, b] = await Promise.all([loadImg(p.before), loadImg(p.after)]);
    r = await ask(w, await createImageBitmap(a), await createImageBitmap(b));
  }
  if (!r) return onMain(p);
  if ('grid' in r) return r.grid;
  throw new Error(r.error);
}

function start(p: PairRef) {
  if (cache.has(p.key) && !timedOut.has(p.key)) return;
  timedOut.delete(p.key);
  put(p.key, { status: 'computing' });
  if (DEV) console.debug(`[change-map] compute #${++computed} ${p.key}`);
  boundedWait(compute(p), MAP_WAIT_MS, 'The comparison').then((grid) => put(p.key, { status: 'done', grid }), (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e), late = /did not answer within/.test(msg);
    if (late) timedOut.add(p.key);
    put(p.key, { status: 'error', error: late ? msg + '. Reopen the item to try again.' : msg });
  });
}

/** The change map of each pair, in order: undefined until its computation starts (the same commit), then computing,
 *  done or error. Each pair is computed at most once per session. Pass a memoised array. */
export function useChangeMap(pairs: readonly PairRef[]): readonly (MapState | undefined)[] {
  useSyncExternalStore(sub, snap, snap);
  // start() is idempotent (a cache lookup), so a caller's new array only costs that lookup per pair
  useEffect(() => { for (const p of pairs) start(p); }, [pairs]);
  return pairs.map((p) => cache.get(p.key));
}
