'use client';
// The Backlog scope of the triage table: one dense, keyboard-first row per finding (lens, feature, title, before →
// expected, risk, size, status), open ones first and best value per effort first within a status. J/K move, Space
// selects, D dispatches, A dispatches the focused one, Enter opens the feature; the goal is an empty Proposed list
// ("inbox zero"). Below ~720 px a row folds into a two-line card, the phone's backlog. Its bar is the dispatch bar
// (below); the In packs scope has train/PackTable.tsx and the decision bar instead.
// Waves (waves/*): a finding that sits in a wave carries a small chip after its title (wave . package; the title attribute
// names the package's model and effort), passed to the memoised Row as four strings; the dispatch bar's "Add to wave" opens
// the composer over the selection. Dispatch stays the direct path, untouched.
import { memo, type ReactNode } from 'react';
import type { Finding, Ledger } from '../useLedger';
import { LensTag, StateMark } from '../train/ui/Marks.tsx';
import { FeatureLink, KindTag, Move, Risk, Size, fromControl } from './bits';
import { OriginChip, TierChip } from '../../Queue';

interface RowProps {
  f: Finding;
  on: boolean;
  focus: boolean;
  /** The ledger's own callbacks (stable: useLedger memoises them), never the Ledger object, which is new on every
   *  render: a J/K step re-renders the two rows whose `focus` changed and no other (scripts/check-train-budget.ts). */
  onFocus(id: string): void;
  onToggle(id: string): void;
  onOpen(f: Finding): void;
  move(p: Finding['p']): string | null;
  /** The wave chip, as strings so the memoised row compares them by value. Absent: no wave holds the finding. */
  wave?: string;
  pkg?: string;
  model?: string;
  effort?: string;
}

const Row = memo(function Row({ f, on, focus, onFocus, onToggle, onOpen, move, wave, pkg, model, effort }: RowProps) {
  return (
    <div role="row" className={'lg-tr' + (on ? ' on' : '') + ' s-' + f.status} data-fid={f.p.id} tabIndex={focus ? 0 : -1}
      onFocus={() => onFocus(f.p.id)}
      onClick={(e) => { onFocus(f.p.id); if (!fromControl(e)) onToggle(f.p.id); }}>
      <span role="cell" className="c-sel"><input type="checkbox" tabIndex={-1} checked={on} onChange={() => onToggle(f.p.id)} aria-label={'Select ' + f.p.title} /></span>
      <span role="cell" className="c-lens"><LensTag id={f.p.lens} /></span>
      <span role="cell" className="c-feat"><FeatureLink f={f} onOpen={onOpen} act={focus} /></span>
      <span role="cell" className="c-title"><TierChip p={f.p} /><span className="lg-t">{f.p.title}</span><KindTag p={f.p} /><OriginChip p={f.p} act={focus} />{wave ? <span className="lg-wv" data-wave={wave} title={'Wave ' + wave + ' · package ' + pkg + ' · ' + model + ', ' + effort + ' effort'}>{wave} · {pkg}</span> : null}</span>
      <span role="cell" className="c-mv"><Move f={f} move={move} /></span>
      <span role="cell" className="c-risk"><Risk p={f.p} /></span>
      <span role="cell" className="c-size"><Size p={f.p} /></span>
      <span role="cell" className="c-st"><StateMark status={f.status} job={f.job} /></span>
    </div>
  );
});

export function Triage({ L }: { L: Ledger }) {
  const open = L.rows.filter((f) => f.status === 'proposed').length;
  const proposedShown = !L.ui.status.size || L.ui.status.has('proposed');
  const first = L.rows[0]?.p.id, foc = L.ui.focus && L.byId.has(L.ui.focus) ? L.ui.focus : first;
  return (
    <div className="lg-tri">
      {proposedShown && !open && L.all.length ? <div className="lg-zero" role="status"><b>Inbox zero</b>Nothing proposed{L.ui.lens.size || L.ui.q ? ' under these filters' : ''}. New findings land here as scans propose them.</div> : null}
      {L.rows.length ? (
        <div role="table" className="lg-tbl" aria-label="Findings">
          <div role="rowgroup" className="lg-th">
            <div role="row" className="lg-tr hd">
              <span role="columnheader" className="c-sel"><span className="vh">Selected</span></span>
              <span role="columnheader" className="c-lens">Lens</span>
              <span role="columnheader" className="c-feat">Feature</span>
              <span role="columnheader" className="c-title">Finding</span>
              <span role="columnheader" className="c-mv">Before → expected</span>
              <span role="columnheader" className="c-risk">Risk</span>
              <span role="columnheader" className="c-size">Size</span>
              <span role="columnheader" className="c-st">Status</span>
            </div>
          </div>
          <div role="rowgroup">
            {L.rows.map((f) => {
              const w = L.waveTag(f.p.id);
              return <Row key={f.p.id} f={f} on={L.ui.sel.has(f.p.id)} focus={f.p.id === foc} onFocus={L.setFocus} onToggle={L.toggle} onOpen={L.openFeature} move={L.move} wave={w?.wave} pkg={w?.pkg} model={w?.model} effort={w?.effort} />;
            })}
          </div>
        </div>
      ) : <div className="lg-empty">{L.all.length ? 'No finding matches these filters.' : 'No findings yet. A lens scan proposes them; they appear here as it does.'}</div>}
    </div>
  );
}

/** The backlog's bar: what is selected, which lenses it spans, its effort, Clear (Esc), Add to wave and Dispatch (D). With
 *  nothing selected it shows the scope's key reminders (`hint`). Add to wave is off when nothing selected can go, or when
 *  every one that can already sits in a draft wave (the title says which). */
export function DispatchBar({ L, hint }: { L: Ledger; hint?: ReactNode }) {
  const n = L.ui.sel.size, m = L.ready.length;
  const spans = L.lenses.filter((l) => L.ready.some((f) => f.p.lens === l.id));
  const wm = L.waveReady.length, taken = L.waveTaken[0]?.wave.name;
  const whyNot = !m ? 'Select proposed or approved findings that no job is building' : !wm ? 'These findings are already in the draft wave ' + taken : null;
  return (
    <div className="lg-bar" role="region" aria-label="Dispatch">
      <span className="lg-bar-n" aria-live="polite">{n ? n + ' selected' : 'Nothing selected'}{n && m !== n ? ' · ' + m + ' can go' : ''}</span>
      {spans.length ? <span className="lg-bar-l" title={spans.map((l) => l.name).join(', ')}>{spans.length === 1 ? '1 lens' : spans.length + ' lenses'}{spans.map((l) => <LensTag key={l.id} id={l.id} />)}</span>
        : !n && hint ? <span className="lg-bar-l">{hint}</span> : null}
      {m ? <span className="lg-bar-e" title="Effort: XS 1, S 2, M 3, L 5, XL 8">effort {L.effort}</span> : null}
      <span className="lg-sp" />
      <button type="button" className="bt" disabled={!n} onClick={L.clear} title="Clear the selection (Esc)">Clear <kbd>Esc</kbd></button>
      <button type="button" className="bt" data-wave="add" disabled={!!whyNot} onClick={() => L.openComposer()}
        title={whyNot ?? 'Group ' + wm + (wm === 1 ? ' finding' : ' findings') + ' into a draft wave of packages, each with its own model and effort'}>
        Add to wave{wm && wm !== m ? ' ' + wm : ''}
      </button>
      <button type="button" className="bt go" disabled={!m || L.busy} onClick={() => void L.dispatchIds()} title="Approve the proposed ones and start one execute run over all of them (D)">
        {L.busy ? 'Dispatching…' : 'Dispatch ' + m}<kbd>D</kbd>
      </button>
    </div>
  );
}
