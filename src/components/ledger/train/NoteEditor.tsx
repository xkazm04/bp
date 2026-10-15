'use client';
// The note a decision asks for (contest A/1's `.note-ed`): rework (the note is the next attempt's brief), descope (why
// it is dropped) and accepting a flagged item (why it ships anyway, src/lib/train/rules.ts). A text field with three
// quick notes per decision, Enter confirms, Esc cancels; an empty note is refused in place. It shows where it was asked:
// in the decision bar, or in the compare footer (`compact`).
import { useEffect, useRef, useState } from 'react';
import { setLedgerUi, type NoteAsk } from '../useLedger';

const VERB: Record<NoteAsk['decision'], string> = { accept: 'Accept', rework: 'Send to rework', descope: 'Descope' };
const CLS: Record<NoteAsk['decision'], string> = { accept: 'acc', rework: 'rw', descope: 'ds' };
const QUICK: Record<NoteAsk['decision'], readonly string[]> = {
  rework: ['Shoot the designed state, not the default', 'Scope is wider than the finding', 'Re-measure: three runs, not one'],
  descope: ['Not worth the risk now', 'Superseded by another item', 'Within noise: nothing to ship'],
  accept: ['Reviewed the diff; the metric gap is the harness, not the code', 'Accepting flat: the code change stands on its own'],
};

export interface NoteEditorProps {
  ask: NoteAsk;
  /** How many of the items are flagged (failed, flat or unmeasured): accepting them is why the note is asked. */
  flagged: number;
  /** Send the decision with this note (Decide's `decide`). */
  onSend(note: string): void;
  compact?: boolean;
}

export function NoteEditor({ ask, flagged, onSend, compact = false }: NoteEditorProps) {
  const [text, setText] = useState(''), [empty, setEmpty] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [ask]);

  const n = ask.ids.length, d = ask.decision, verb = VERB[d];
  const why = d === 'accept'
    ? flagged + ' of ' + n + ' ' + (flagged === 1 ? 'is' : 'are') + ' failed, flat or unmeasured: a note is required, and ' + (flagged === 1 ? 'it ships' : 'they ship') + ' flagged ⚑.'
    : d === 'rework' ? 'The note is what the next execute builds the new attempt from.' : 'The note says why it is dropped.';

  const cancel = () => {
    setLedgerUi((u) => (u.note ? { ...u, note: null } : u));
    (input.current?.closest('.lg-page') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  const confirm = () => {
    const v = text.trim();
    if (!v) { setEmpty(true); input.current?.focus(); return; }
    onSend(v);
    (input.current?.closest('.lg-page') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirm(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  };
  const id = 'tr-note-' + ask.at;
  return (
    <div className={'tr-note' + (compact ? ' compact' : '')} role="group" aria-label={verb + ' · note'}>
      <label htmlFor={id}>{verb} {n} item{n === 1 ? '' : 's'} · note</label>
      <input ref={input} id={id} autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setEmpty(false); }} onKeyDown={onKey}
        placeholder={empty ? 'A note is required' : 'Required. Enter to confirm, Esc to cancel'} aria-invalid={empty || undefined} />
      <span className="qk">
        {QUICK[d].map((q) => <button key={q} type="button" onClick={() => { setText(q); setEmpty(false); input.current?.focus(); }}>{q}</button>)}
      </span>
      <button type="button" className={'tr-btn ' + CLS[d]} onClick={confirm}>{verb}<kbd>↵</kbd></button>
      <button type="button" className="tr-btn" onClick={cancel}>Cancel<kbd>Esc</kbd></button>
      <span className="why">{why}</span>
    </div>
  );
}
