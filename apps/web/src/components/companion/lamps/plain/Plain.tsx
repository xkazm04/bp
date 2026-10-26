'use client';
// The plain lamp: the deliberately unstyled fallback skin, so the companion works before (and without) a designed one. A
// small round button bottom-right whose dot carries the state, a caption bubble above it, a one-line composer, and a
// dashed box at `target` while pointing. It does not render cards (the host's slip does). The composer follows the host's
// conventions (docs/blueprint-ui.md "Companion"): `data-composer` on the field, `data-lamp-toggle` on the button that
// opens it, Esc closes it, and it closes on blur when empty.
import { useEffect, useRef, useState } from 'react';
import type { LampProps } from '../index';
import './plain.css';

/** The tail of a long caption: the bubble shows the newest words, not the first ones. */
const tail = (s: string, n = 240) => (s.length > n ? '…' + s.slice(s.length - n).replace(/^\S*\s/, '') : s);

export function PlainLamp({ state, caption, target, onSubmit }: LampProps) {
  const [open, setOpen] = useState(false), [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);
  return (
    <div className="lp-plain" data-state={state}>
      {state === 'pointing' && target && (
        <div className="lp-target" aria-hidden style={{ transform: `translate(${target.x}px, ${target.y}px)`, width: target.w, height: target.h }} />
      )}
      <div className="lp-dock">
        {caption && <p className="lp-cap" role="status" aria-live="polite">{tail(caption)}</p>}
        {open && (
          <form className="lp-form" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (!t) return; onSubmit(t); setText(''); }}>
            <input ref={field} data-composer value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this plan" aria-label="Ask the lamp"
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
              onBlur={() => { if (!text.trim()) setOpen(false); }} />
          </form>
        )}
        <button type="button" className="lp-btn" data-lamp-toggle aria-label={open ? 'Close the lamp' : "Lamp ( ' )"} aria-expanded={open}
          title="Lamp ( ' )" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}><i /></button>
      </div>
    </div>
  );
}
