'use client';
// The focused finding's decision brief, beside the Backlog table and in pack judging: blast radius, precedent by what
// like approvals came to on main (held, short, not measured since: scan/outcome.ts over git's landings), the owner's
// quoted declines, undo and cost - Brief.tsx's briefOfProposal and BriefFacts, the same brief the plan's card, Review
// and plan.brief read. One briefFor per focus step (the focused row only), so a J/K step still re-renders two rows.
// In the Backlog, a proposed finding takes Y (approve for later: no build is queued; D dispatches it) and N (decline with
// a reason; a decline is final) through proposals/[id] and the intent store (useLedger decideOne). BP_WRITES=off shows
// neither (LedgerPage does not bind them either). The reason editor keeps its own keys: Enter declines, Esc cancels.
import { useMemo, useState } from 'react';
import { briefMapOfStructure } from '@bp/core/scan/brief';
import type { ProposalStatus } from '@bp/core/scan/types';
import { BriefFacts, briefOfProposal } from '../Brief';
import { useEngine } from '../hooks';
import { useTrain } from './train/data';
import { landedOpts } from './train/onMain';
import { useFindings } from './useLedger';

/** The most characters a decline reason carries (the store's note). */
const MAX_REASON = 500;

export interface DrawerDecide {
  /** The finding's status as the ledger shows it (in flight: what it was sent to). */
  status: ProposalStatus;
  declining: boolean;
  approve(): void;
  startDecline(): void;
  decline(reason: string): void;
  cancel(): void;
}

export function BriefDrawer({ id, decide, className = 'lg-brief', full = false }: { id: string; decide?: DrawerDecide; className?: string; /** Maximized: the evidence lists at their full length. */ full?: boolean }) {
  const M = useEngine().M, T = useTrain(), { scan } = useFindings();
  const map = useMemo(() => briefMapOfStructure(M.P.base), [M]);
  const p = T.byId.get(id);
  const b = useMemo(() => (p && scan ? briefOfProposal(p, { ...scan, proposals: [...T.proposals] }, map, landedOpts(T)) : null), [p, scan, T, map]);
  if (!p) return null;
  return (
    <aside className={className} aria-label={'Brief · ' + p.title} data-role="lg-brief">
      <h4>Brief · <span>{p.id}</span></h4>
      {b ? <BriefFacts b={b} compact={!full} /> : <p className="lg-brief-n">The store has not answered yet: no brief to read.</p>}
      {/* keyed by the finding: a reason typed for one finding never opens on the next (React keeps an unkeyed part's state) */}
      {decide && decide.status === 'proposed' ? <Decision key={p.id} d={decide} /> : null}
    </aside>
  );
}

function Decision({ d }: { d: DrawerDecide }) {
  const [reason, setReason] = useState('');
  if (d.declining) {
    const go = () => { if (reason.trim()) d.decline(reason.trim()); };
    return (
      <div className="lg-brief-d" role="group" aria-label="Decline with a reason">
        <label htmlFor="lg-brief-why">Why decline? The brief quotes it back to the next decision on a like idea.</label>
        <textarea id="lg-brief-why" autoFocus rows={2} maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.cancel(); }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); go(); }
          }} />
        <div className="lg-brief-b">
          <button type="button" className="bt warn" disabled={!reason.trim()} onClick={go} title="Decline it (final: no route reopens a declined finding)">Decline · final <kbd>Enter</kbd></button>
          <button type="button" className="bt" onClick={d.cancel}>Cancel <kbd>Esc</kbd></button>
        </div>
      </div>
    );
  }
  return (
    <div className="lg-brief-b" role="group" aria-label="Decide">
      <button type="button" className="bt go" onClick={d.approve} title="Approve it for later: no build is queued (D dispatches it)">Approve for later <kbd>Y</kbd></button>
      <button type="button" className="bt" onClick={d.startDecline} title="Decline it with a reason (final)">Decline… <kbd>N</kbd></button>
      <small>No build is queued. A decline is final.</small>
    </div>
  );
}
