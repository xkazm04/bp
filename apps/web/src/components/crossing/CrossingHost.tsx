'use client';
// The crossing's host in the chrome. The main chunk carries only this shell and the rail's button; the overlay (Crossing,
// its timeline, the table art and its CSS) is a chunk of its own, loaded the first time the person asks for the table.
// Opened by the rail's Table button, by `?cross=1` on any blueprint URL, and by the /crossing route (both start at the
// hash's place once the plan has arrived there).
import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const Crossing = lazy(() => import('./Crossing'));
const OPEN = 'bp:crossing';

export const openCrossing = () => window.dispatchEvent(new Event(OPEN));

export function CrossingHost() {
  const [open, setOpen] = useState(false);
  // after a return, the page keeps "the table left you at ..." for 10 s, so the hand-back reads as a hand-back, not a jump
  const [left, setLeft] = useState<string | null>(null);
  useEffect(() => {
    if (!left) return;
    const t = window.setTimeout(() => setLeft(null), 10_000);
    return () => clearTimeout(t);
  }, [left]);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN, on);
    let t = 0;
    if (new URLSearchParams(location.search).get('cross') === '1' || location.pathname.replace(/\/$/, '').endsWith('/crossing')) t = window.setTimeout(on, 1200);
    return () => { window.removeEventListener(OPEN, on); clearTimeout(t); };
  }, []);
  if (!open) return left ? <div className="bp-left" role="status">The table left you at <b>{left}</b></div> : null;
  const host = document.querySelector('.bp') ?? document.body;
  const close = (at?: string) => { setOpen(false); setLeft(at ?? null); document.querySelector<HTMLElement>('.bp-map')?.focus({ preventScroll: true }); };
  return createPortal(<Suspense fallback={null}><Crossing onClose={close} /></Suspense>, host);
}
