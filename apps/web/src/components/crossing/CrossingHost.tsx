'use client';
// The crossing's host in the chrome. The main chunk carries this shell, the rail's button, the "Take it to the table" card
// (TableCard: arms the place baton for real) and the follow (the page follows the table on the companion stream); the
// overlay (Crossing, its timeline, the table art and its CSS) is a chunk of its own, loaded the first time the person plays
// the crossing - from the card, by `?cross=1` on any blueprint URL, or by the /crossing route (both start at the hash's
// place once the plan has arrived there).
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlaceBaton } from '@bp/core/session/place';
import { useEngine } from '../hooks';
import { PLACE_EVENT, followHash, placeName } from './follow';
import { TableCard } from './TableCard';

const Crossing = lazy(() => import('./Crossing'));
const OPEN = 'bp:crossing', CARD = 'bp:table-card';

export const openCrossing = () => window.dispatchEvent(new Event(OPEN));
/** The rail's VR · Table button: open (or close) the "Take it to the table" card. */
export const toggleTableCard = () => window.dispatchEvent(new Event(CARD));

export function CrossingHost() {
  const E = useEngine();
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  // after a return, the page keeps "the table left you at ..." for 10 s, so the hand-back reads as a hand-back, not a jump
  const [left, setLeft] = useState<string | null>(null);
  useEffect(() => {
    if (!left) return;
    const t = window.setTimeout(() => setLeft(null), 10_000);
    return () => clearTimeout(t);
  }, [left]);
  // the page follows the table: a live place flies the plan there (as a focus command's hash route does); a return hands the
  // lead back, and the crumb says where the table left you (the crossing's overlay shows its own until it closes)
  useEffect(() => {
    const on = (ev: Event) => {
      const b = (ev as CustomEvent<PlaceBaton>).detail, h = b && followHash(b, E.M.live?.slug ?? 'kettle');
      if (!h) return;
      if (h !== (location.hash || '#')) location.hash = h === '#' ? '' : h; // hashchange -> restoreHash flies there
      if (b.state === 'returned' && !openRef.current) setLeft(placeName(E, h));
    };
    window.addEventListener(PLACE_EVENT, on);
    return () => window.removeEventListener(PLACE_EVENT, on);
  }, [E]);
  useEffect(() => {
    const on = () => { setCard(false); setOpen(true); }, flip = () => setCard((c) => !c);
    window.addEventListener(OPEN, on); window.addEventListener(CARD, flip);
    let t = 0;
    if (new URLSearchParams(location.search).get('cross') === '1' || location.pathname.replace(/\/$/, '').endsWith('/crossing')) t = window.setTimeout(on, 1200);
    return () => { window.removeEventListener(OPEN, on); window.removeEventListener(CARD, flip); clearTimeout(t); };
  }, []);
  if (!open) return (
    <>
      {left && <div className="bp-left" role="status">The table left you at <b>{left}</b></div>}
      {card && <TableCard E={E} onPlay={() => { setCard(false); setOpen(true); }} onClose={() => { setCard(false); document.querySelector<HTMLElement>('.ri-table')?.focus({ preventScroll: true }); }} />}
    </>
  );
  const host = document.querySelector('.bp') ?? document.body;
  const close = (at?: string) => { setOpen(false); setLeft(at ?? null); document.querySelector<HTMLElement>('.bp-map')?.focus({ preventScroll: true }); };
  return createPortal(<Suspense fallback={null}><Crossing onClose={close} /></Suspense>, host);
}
