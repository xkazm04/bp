// The release train's data for the ledger: packs, releases, the pack items and their evidence, jobs and lenses, from
// the live store (useLive) or Kettle's sample train (the scan sim), through the same hook the findings use. Each
// array keeps its identity until its source changes, so memoised rows and panels re-render only on a real change.
import { useMemo } from 'react';
import type { Measurement, Pack, Proposal, Release, Shot } from '@bp/core/scan/types';
import type { ScanJob } from '@bp/core/scan/jobs';
import type { ScanCtx } from '@/lib/scan/actions';
import type { LensDef } from '@bp/core/standard/load';
import { useEngine, useLive, useScanCtx } from '../../hooks';
import { useFindings } from '../useLedger';

export interface TrainData {
  /** The live product's slug; null on Kettle (sample). */
  slug: string | null;
  ctx: ScanCtx;
  /** Every finding, pack items included (Kettle: the fixture overlaid by the sim). */
  proposals: readonly Proposal[];
  byId: ReadonlyMap<string, Proposal>;
  packs: readonly Pack[];
  releases: readonly Release[];
  measurements: readonly Measurement[];
  shots: readonly Shot[];
  jobs: readonly ScanJob[];
  /** The product's lenses (each carries its manifest: a metric's `better` direction, units, targets). */
  lenses: readonly LensDef[];
  /** The scan snapshot has arrived. Before it, the empty arrays below mean "not answered yet", NOT "none": a surface
   *  that cannot tell the two apart tells a person who has packs that they have none while the snapshot loads. */
  arrived: boolean;
}

const NONE: readonly never[] = [];

export function useTrain(): TrainData {
  const M = useEngine().M, ctx = useScanCtx(), slug = useLive()?.slug ?? null;
  const { proposals, jobs, scan } = useFindings();
  const lenses = M.P.lenses;
  return useMemo(() => ({
    slug, ctx, proposals, jobs, lenses, arrived: scan !== undefined,
    byId: new Map(proposals.map((p) => [p.id, p])),
    packs: scan?.packs ?? NONE,
    releases: scan?.releases ?? NONE,
    measurements: scan?.measurements ?? NONE,
    shots: scan?.shots ?? NONE,
  }), [slug, ctx, proposals, jobs, scan, lenses]);
}
