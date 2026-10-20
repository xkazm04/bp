// The release train's controls and callouts: a button, a segmented control and a callout box. One component each (the
// contest winner styled the segmented idea four ways, the callout four ways and drew its `.bt` per surface).
import type { ReactNode } from 'react';
import './ui.css';

export interface SegOption<T extends string> { value: T; label: string; title?: string }

/** A button's tone (A/1's `.bt` modifiers): `go` the filled primary (Create draft, Build, Finish), `acc` / `rw` / `ds`
 *  the decisions (Accept, Rework, Descope), `warn` a destructive or failing act. None: the plain panel button. */
export type BtnTone = 'go' | 'acc' | 'rw' | 'ds' | 'warn';

export interface BtnProps {
  children: ReactNode;
  onClick?(): void;
  tone?: BtnTone;
  /** The key that presses it, shown after the label (hidden on the phone). */
  kbd?: string;
  /** `nav`: the compare header's tighter form (30 px, A/1's `.cm-h .nav .bt`); `row`: a list row's quiet action (28 px,
   *  no fill, the case as written: A/1's `.pl li .x`). */
  size?: 'nav' | 'row';
  disabled?: boolean;
  title?: string;
  /** The accessible name when the label is a glyph (↑, ✕). */
  label?: string;
  /** A toggle's state (`aria-pressed`). */
  pressed?: boolean;
  /** The fidelity contract's hook (`data-role`). */
  role?: string;
}

/** The ledger's one action button (A/1's `.bt`), every surface: the decision bar and strip, the note editor, the
 *  package pill, the compare header and the Release tab. */
export function Btn({ children, onClick, tone, kbd, size, disabled = false, title, label, pressed, role }: BtnProps) {
  return (
    <button type="button" className={'tr-btn' + (tone ? ' ' + tone : '') + (size ? ' ' + size : '')} onClick={onClick} disabled={disabled}
      title={title} aria-label={label} aria-pressed={pressed} data-role={role}>
      {children}{kbd ? <kbd>{kbd}</kbd> : null}
    </button>
  );
}

/** A row of mutually exclusive buttons (`aria-pressed`). */
export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly SegOption<T>[]; value: T; onChange(v: T): void; label: string }) {
  return (
    <span className="tr-seg" role="group" aria-label={label} data-role="tr-seg">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </span>
  );
}

/** A boxed message: `note` (amber bar: a fact to know), `diff` (accent bar: about the screens), `flag` (red: a failed
 *  build or a flagged accept), `error` (red bar: a refusal or a failed job), `empty` (dashed: nothing here yet). */
export type CalloutTone = 'note' | 'diff' | 'flag' | 'error' | 'empty';
export function Callout({ tone, children, role }: { tone: CalloutTone; children: ReactNode; role?: string }) {
  return <div className={'tr-call ' + tone} role={tone === 'error' ? 'alert' : undefined} data-role={role ?? 'tr-callout'}>{children}</div>;
}
