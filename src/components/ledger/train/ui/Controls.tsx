// The release train's controls and callouts: a segmented control and a callout box. One component each (the contest
// winner styled the segmented idea four ways and the callout four ways).
import type { ReactNode } from 'react';
import './ui.css';

export interface SegOption<T extends string> { value: T; label: string; title?: string }

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
