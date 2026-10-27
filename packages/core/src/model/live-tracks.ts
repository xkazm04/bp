// A live product's answer tracks on the plan (packages/core/src/scan/track.ts): the decided proposals the queue no longer
// holds, each kept on its tile until the store has evidence for it. Separate from the sim's questions on purpose: the
// queue, J/K and every count stay proposed-only. Fed by every scan and jobs change (`feed`), and by the decisions made
// here (`saving` while the POST is out, `saved` with the store's answer or the row a 409 found), so the marker takes
// over the moment a question closes and the same marker comes back after a reload (it is read from the snapshot).
// Indexed per feature at every product line, newest first; the room counts and the tile labels are built here, once
// per change, never per frame.
import type { ScanJob } from '@bp/core/scan/jobs';
import { tracksOf, type Pending, type Track } from '@bp/core/scan/track';
import { emptyScan, type DecisionBody, type Proposal, type ScanSnapshot } from '@bp/core/scan/types';
import { lineSuffix, type Product } from './product';

export class LiveTracks {
  /** Bumped on every change: the engine redraws, the cards re-read. */
  v = 0;
  list: Track[] = [];
  /** Feature id (with its line suffix) -> its tracks, newest first. */
  F: Record<string, Track[]> = {};
  /** Proposal id -> its track. */
  T: Record<string, Track> = {};
  /** Feature id (with its line suffix) -> what its tile says: the newest track's label, "+N" when it has more. */
  tileLabel: Record<string, string> = {};
  scan: ScanSnapshot = emptyScan();
  jobs: readonly ScanJob[] = [];
  private pend = new Map<string, Pending>();
  private P: Product;
  private wall: () => number;
  // plain fields, not parameter properties: Node's type stripping cannot load those
  constructor(P: Product, wall: () => number = Date.now) { this.P = P; this.wall = wall; }

  /** A new snapshot and/or job list. */
  feed(scan: ScanSnapshot, jobs: readonly ScanJob[] = this.jobs) { this.scan = scan; this.jobs = jobs; this.rebuild(); }
  /** A decision made here has gone out. */
  saving(id: string, decision: 'approve' | 'decline') { this.pend.set(id, { state: 'saving', decision }); this.rebuild(); }
  /** The store's answer: the row it saved, or (a 409) the row another decision left. */
  saved(id: string, p: Proposal) { this.pend.set(id, { state: 'saved', p }); this.rebuild(); }
  /** The POST failed without a row: the question reopens, so no track. */
  dropped(id: string) { if (this.pend.delete(id)) this.rebuild(); }
  pending(id: string): Pending | undefined { return this.pend.get(id); }
  /** Send a decision made here through `send` (the product's POST), tracking it: `saving` at once, then the row the store
   *  answered, or on a 409 the row the other decision left; any other refusal drops it (the question reopens). Rejects as `send` does. */
  async decide(id: string, body: DecisionBody, send: (id: string, body: DecisionBody) => Promise<Proposal>): Promise<Proposal> {
    this.saving(id, body.decision);
    try { const p = await send(id, body); this.saved(id, p); return p; } catch (e) {
      const x = e as { status?: number; proposal?: Proposal };
      if (x.status === 409 && x.proposal) this.saved(id, x.proposal); else this.dropped(id);
      throw e;
    }
  }

  private rebuild() {
    // a decision made here is dropped once the snapshot's own row has caught up with it
    for (const [id, pd] of this.pend) {
      const row = this.scan.proposals.find((x) => x.id === id);
      if (pd.state === 'saved' && row && row.status !== 'proposed' && row.updated_at >= pd.p.updated_at) this.pend.delete(id);
    }
    const P = this.P, known = new Set(P.base.features.map((f) => f.id));
    this.list = tracksOf(this.scan, this.wall(), { jobs: this.jobs, pending: this.pend }).filter((t) => known.has(t.feature));
    this.F = {}; this.T = {}; this.tileLabel = {};
    for (const t of this.list) {
      this.T[t.id] = t;
      for (let b = 0; b < P.scale; b++) (this.F[t.feature + lineSuffix(P.scale, b)] ||= []).push(t);
    }
    for (const fid in this.F) { const ts = this.F[fid]; this.tileLabel[fid] = ts[0].label + (ts.length > 1 ? ' · +' + (ts.length - 1) : ''); }
    this.v++;
  }
}
