'use client';
// The decision bar under the In packs table (contest A/1's renderBar, the dispatch bar upgraded): what the decision
// acts on (the selection, else the open item, else the focused one), its lenses, how many need a note to accept and
// how many are locked in a release past draft, Clear, the decision buttons (Decide), and the release package pill:
// "Package v<draft or suggested version> · <n accepted>" with Release -> (the Release tab). With nothing to act on it
// shows the scope's key reminders instead. The note editor takes the bar's line while a decision asks for a note.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Proposal } from '@bp/core/scan/types';
import { suggestRelease } from '@/lib/scan/actions';
import { isFlagged, isWaiting } from '@bp/core/train/rules';
import type { Ledger } from '../useLedger';
import { useTrain } from './data';
import { Decide, releaseIn, verdictIn } from './Decide';
import { LensTag } from './ui/Marks.tsx';
import { Btn } from './ui/Controls';
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
  // the version the package would take. A refused suggestion is NOT the same state as "not asked yet": it reads `v?`
  // and says so, because the version is part of the decision this bar is for.
  const [suggested, setSuggested] = useState<{ ver: string } | 'failed' | null>(null);
  useEffect(() => {
    if (rel) return;
    let live = true;
    suggestRelease(T.ctx).then((s) => { if (live) setSuggested({ ver: s.version }); }, () => { if (live) setSuggested('failed'); });
    return () => { live = false; };
  }, [T.ctx, rel, pkg]);
  const ver = rel?.version ?? (suggested && suggested !== 'failed' ? suggested.ver : null);
  const noVer = !ver && suggested === 'failed';

  // A/1's words: the focused item reads "focused" (open in compare or not); only an open item the focus left reads "open"
  const label = n ? n + ' selected' : targets.length ? '1 ' + (L.ui.focus === targets[0] || L.ui.open !== targets[0] ? 'focused' : 'open') + ' · ' + targets[0] : 'Nothing selected';
  return (
    <div className="lg-bar tr-bar" role="region" aria-label="Decide" data-role="tr-bar">
      {L.ui.note?.at === 'bar' ? <Decide ids={L.ui.note.ids} /> : (
        <>
          <span className="lg-bar-n" aria-live="polite">{label}</span>
          {lenses.length ? (
            <span className="lg-bar-l">
              {lenses.map((id) => <LensTag key={id} id={id} />)}
              {flagged ? <span className="tr-warn">⚑ {flagged} need{flagged === 1 ? 's' : ''} a note to accept</span> : null}
              {locked ? <span title="Their release has left draft: they cannot be reworked, descoped or undone">{locked} locked in a release</span> : null}
            </span>
          ) : hint ? <span className="lg-bar-l">{hint}</span> : null}
          <span className="lg-sp" />
          {!phone ? <Btn kbd="Esc" disabled={!n} onClick={L.clear} title="Clear the selection (Esc)">Clear</Btn> : null}
          <Decide ids={targets} />
          <span className="tr-pkg" title={rel ? 'The release package: every accepted item of ' + rel.id + ', plus the accepted items no release holds yet'
            : noVer ? 'The release package: accepted items waiting for a release. The next version could not be read from the store, so none is shown.'
              : 'The release package: accepted items waiting for a release'}>
            <span>Package</span><b>{ver ? 'v' + ver + ' · ' : noVer ? 'v? · ' : ''}{pkg}</b>
            <Btn onClick={onRelease} title="Open the release (3)">{rel && rel.status !== 'draft' ? rel.status : 'Release'} →</Btn>
          </span>
        </>
      )}
    </div>
  );
}
