'use client';
// The decision bar under the In packs table (contest A/1's renderBar, the dispatch bar upgraded): what the decision
// acts on (the selection, else the open item, else the focused one), its lenses, how many need a note to accept and
// how many are locked in a release past draft, Clear, the decision buttons (Decide), and the release package pill:
// "Package v<draft or suggested version> · <n accepted>" with Release -> (the Release tab). With nothing to act on it
// shows the scope's key reminders instead. The note editor takes the bar's line while a decision asks for a note.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Proposal } from '@/lib/scan/types';
import { suggestRelease } from '@/lib/scan/actions';
import { isFlagged, isWaiting } from '@/lib/train/rules';
import type { Ledger } from '../useLedger';
import { useTrain } from './data';
import { Decide, releaseIn, verdictIn } from './Decide';
import { LensTag } from './ui/Marks.tsx';
import './DecisionBar.css';

export interface DecisionBarProps {
  L: Ledger;
  /** The items a decision acts on now. */
  targets: readonly string[];
  /** Open the Release tab. */
  onRelease(): void;
  /** The scope's key reminders, shown while nothing is targeted. */
  hint?: ReactNode;
  phone?: boolean;
}

/** The release a package goes into: the newest one not yet tagged or failed. */
const OPEN_REL = new Set(['draft', 'building', 'pr-open', 'merged']);

export function DecisionBar({ L, targets, onRelease, hint, phone = false }: DecisionBarProps) {
  const T = useTrain(), n = L.ui.sel.size;
  const ps = useMemo(() => targets.map((id) => T.byId.get(id)).filter((p): p is Proposal => !!p), [targets, T]);
  const lenses = useMemo(() => [...new Set(ps.map((p) => p.lens))], [ps]);
  const flagged = useMemo(() => ps.filter((p) => isWaiting(p) && isFlagged(p, verdictIn(T, p))).length, [ps, T]);
  const locked = ps.filter((p) => { const r = releaseIn(T, p); return !!r && r.status !== 'draft'; }).length;

  // the package: accepted items no release holds, plus those of the open release
  const rel = useMemo(() => [...T.releases].reverse().find((r) => OPEN_REL.has(r.status)), [T.releases]);
  const pkg = useMemo(() => T.proposals.filter((p) => p.status === 'accepted' && (!p.release_id || p.release_id === rel?.id)).length, [T.proposals, rel]);
  const [suggested, setSuggested] = useState<string | null>(null);
  useEffect(() => {
    if (rel) return;
    let live = true;
    suggestRelease(T.ctx).then((s) => { if (live) setSuggested(s.version); }, () => { if (live) setSuggested(null); });
    return () => { live = false; };
  }, [T.ctx, rel, pkg]);
  const ver = rel?.version ?? suggested;

  const label = n ? n + ' selected' : targets.length ? '1 ' + (L.ui.open === targets[0] ? 'open' : 'focused') + ' · ' + targets[0] : 'Nothing selected';
  return (
    <div className="lg-bar tr-bar" role="region" aria-label="Decide" data-role="tr-bar">
      {L.ui.note?.at === 'bar' ? <Decide ids={L.ui.note.ids} /> : (
        <>
          <span className="lg-bar-n" aria-live="polite">{label}</span>
          {lenses.length ? (
            <span className="lg-bar-l">
              {lenses.map((id) => <LensTag key={id} id={id} />)}
              {flagged ? <span className="tr-warn">⚑ {flagged} need{flagged === 1 ? 's' : ''} a note to accept</span> : null}
              {locked ? <span>{locked} locked</span> : null}
            </span>
          ) : hint ? <span className="lg-bar-l">{hint}</span> : null}
          <span className="lg-sp" />
          {!phone ? <button type="button" className="tr-btn" disabled={!n} onClick={L.clear} title="Clear the selection (Esc)">Clear<kbd>Esc</kbd></button> : null}
          <Decide ids={targets} />
          <span className="tr-pkg" title="The release package: accepted items waiting for a release">
            <span>Package</span><b>{ver ? 'v' + ver + ' · ' : ''}{pkg}</b>
            <button type="button" className="tr-btn" onClick={onRelease} title="Open the release (3)">{rel && rel.status !== 'draft' ? rel.status : 'Release'} →</button>
          </span>
        </>
      )}
    </div>
  );
}
