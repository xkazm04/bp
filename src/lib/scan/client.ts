// Client side of a live product: fetch its structure, follow its scan store over SSE, decide proposals,
// and turn a scan into the swarm feed the canvas already draws. Browser-only; the server half is
// store.server.ts and the routes under src/app/api/products.
import type { AppStructure } from '@/lib/standard/types';
import type { Swarm } from '@/lib/data/types';
import type { DecisionBody, Proposal, ScanSnapshot } from './types';

/** `loading` until the structure arrives; `missing` = no store or structure file; `offline` = reconnecting. */
export type LiveStatus = 'loading' | 'live' | 'offline' | 'missing' | 'error';

export interface LiveProduct {
  status: LiveStatus;
  structure?: AppStructure;
  /** The product's events log text, '' when it has none. */
  events: string;
  scan?: ScanSnapshot;
  error?: string;
}

/** Follows one live product. `slug` null = no live product (Kettle): returns `{ status: 'missing' }` at once. */
export function useLiveProduct(slug: string | null): LiveProduct {
  void slug;
  throw new Error('useLiveProduct: not implemented (WP2)');
}

/** Approve or decline a proposal; resolves to the updated row, rejects on any non-2xx (409 = already decided). */
export async function decideProposal(slug: string, id: string, body: DecisionBody): Promise<Proposal> {
  void slug; void id; void body;
  throw new Error('decideProposal: not implemented (WP2)');
}

/**
 * The scan as a swarm: one squad and one agent per lens in the latest run, each on the feature of its
 * latest activity row (`error` -> failed); open proposals (`proposed`) become decisions whose options
 * are Approve / Decline; activity rows become the replay.
 */
export function swarmFromScan(scan: ScanSnapshot, featureSlugs: readonly string[]): Swarm {
  void scan; void featureSlugs;
  throw new Error('swarmFromScan: not implemented (WP2)');
}
