'use client';
// What already landed on the product's base branch, as a hook: actions.ts readLandings (the route, or the sim's merges),
// asked on open and again when the store moves; an equal answer keeps its identity. The ledger's train data and
// Review's "Before you decide" read it.
import { useEffect, useState } from 'react';
import type { Landings } from '@bp/core/scan/landed';
import { readLandings, type ScanCtx } from './actions';

/** The landings for this product, asked on open and whenever the store's rows move (the snapshot, or the proposals:
 *  the sample's change in place behind one snapshot). Review's "Before you decide" reads them too. */
export function useLandings(ctx: ScanCtx, scan: unknown, proposals: unknown): Landings | null {
  const [got, setGot] = useState<{ ctx: ScanCtx; v: Landings; key: string } | null>(null);
  useEffect(() => {
    let on = true;
    readLandings(ctx).then((v) => {
      if (!on) return;
      const key = JSON.stringify(v);
      setGot((g) => (g && g.ctx === ctx && g.key === key ? g : { ctx, v, key }));
    }, () => { /* a refused read keeps the last answer */ });
    return () => { on = false; };
  }, [ctx, scan, proposals]);
  return got && got.ctx === ctx ? got.v : null;
}
