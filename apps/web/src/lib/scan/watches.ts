'use client';
// The outcome watches (train/watch.ts) as a hook: actions.ts readWatches (the route, which queues the checkpoints that
// are due first; or the sample's), asked on open, whenever the store's rows or the jobs move, and after a toggle. An equal
// answer keeps its identity. The Release tab's History reads it.
import { useCallback, useEffect, useState } from 'react';
import type { Watch } from '@bp/core/train/watch';
import { readWatches, refusalText, watchRelease, type ScanCtx } from './actions';

export interface Watches {
  /** null until the first answer (or when the read was refused: the controls then stay off). */
  list: readonly Watch[] | null;
  /** Turn a release's watch on or off; resolves with the refusal's words, or null. */
  set(release: string, on: boolean): Promise<string | null>;
}

export function useWatches(ctx: ScanCtx, scan: unknown, jobs: unknown): Watches {
  const [got, setGot] = useState<{ ctx: ScanCtx; v: Watch[]; key: string } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let on = true;
    readWatches(ctx).then((v) => {
      if (!on) return;
      const key = JSON.stringify(v);
      setGot((g) => (g && g.ctx === ctx && g.key === key ? g : { ctx, v, key }));
    }, () => { /* a refused read keeps the last answer */ });
    return () => { on = false; };
  }, [ctx, n, scan, jobs]);
  const set = useCallback(async (release: string, on: boolean) => {
    try { await watchRelease(ctx, release, on); setN((x) => x + 1); return null; } catch (e) { return refusalText(e); }
  }, [ctx]);
  return { list: got && got.ctx === ctx ? got.v : null, set };
}
