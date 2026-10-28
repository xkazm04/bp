'use client';
// "Take it to the table": the design's whole web UI, for real. The page does not launch anything - it arms a place baton
// (POST /api/session/place with the human token) and says so: armed for 120 s, put the headset on. While the card is open it
// reads the baton back each second, so a headset (or anything holding a device id) claiming it, the table leading and the
// hand-back all show here as they happen; the page itself follows the table on the companion stream (follow.ts). Next to it,
// the prototype: play the crossing from this place.
import { useCallback, useEffect, useState } from 'react';
import type { PlaceBaton } from '@bp/core/session/place';
import type { Engine } from '@/engine/Engine';
import { placeName, postHuman } from './follow';
import { placeOf, placeWire } from './place';

type Held = PlaceBaton | { state: 'none' };

const left = (b: PlaceBaton) => Math.max(0, Math.ceil((Date.parse(b.armedAt) + b.ttlMs - Date.now()) / 1000));

export function TableCard({ E, onPlay, onClose }: { E: Engine; onPlay: () => void; onClose: () => void }) {
  const [held, setHeld] = useState<Held | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  const read = useCallback(async () => {
    try { const r = await fetch('/api/session/place', { cache: 'no-store' }); if (r.ok) setHeld((await r.json()) as Held); } catch { /* offline: keep the last */ }
  }, []);
  useEffect(() => {
    void read();
    const t = window.setInterval(() => { void read(); tick((n) => n + 1); }, 1000);
    return () => clearInterval(t);
  }, [read]);
  const arm = async (takeBack = false) => {
    setErr(null);
    try {
      const r = await postHuman('/api/session/place', { place: placeWire(placeOf(E), 'web'), ...(takeBack ? { takeBack: true } : {}) });
      const j = (await r.json().catch(() => null)) as (Held & { error?: string }) | null;
      if (!r.ok || !j) setErr(j?.error ?? 'the server answered ' + r.status); else setHeld(j);
    } catch (e) { setErr(e instanceof Error ? e.message : 'could not reach the server'); }
  };
  const b = held && held.state !== 'none' ? (held as PlaceBaton) : null;
  const where = placeName(E, location.hash);
  const line = !b ? 'Nothing armed. The place lives only in this page’s address.'
    : b.state === 'armed' ? `Armed for ${left(b)} s: put the headset on. Nothing launches from here.`
    : b.state === 'claimed' ? `Claimed by ${b.device}: the headset has your place.`
    : b.state === 'live' ? `The table leads (${b.device}). This page follows it.`
    : b.state === 'returned' ? 'Handed back: this page leads again.'
    : 'Expired: nobody claimed it within 120 s. No harm done.';
  return (
    <section className="tcard" role="dialog" aria-label="Take it to the table" data-keys="own" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
      <header><b>Take it to the table</b><button type="button" className="x" onClick={onClose} title="Close ( Esc )">Esc</button></header>
      <p className="tc-where">Here: <b>{where}</b> <code>{location.hash || '#'}</code></p>
      {b && (b.state === 'claimed' || b.state === 'live')
        // a device that never hands back (a crash, a missed STOPPING) must not lock the page out: the person takes the lead
        ? <button type="button" className="tc-arm back" onClick={() => void arm(true)} autoFocus>Take the lead back on this page</button>
        : <button type="button" className="tc-arm" onClick={() => void arm()} autoFocus>{b?.state === 'armed' ? 'Arm again from here' : 'Arm the place baton'}</button>}
      <p className={'tc-state s-' + (b?.state ?? 'none')} role="status">{line}</p>
      {err && <p className="tc-err">{err}</p>}
      <p className="tc-how">The headset (the standalone APK, paired through the LAN door) claims it when you put it on, lifts this place off your monitor onto the desk, and this page follows the table while you are in it. The door and the APK’s side are not built; the baton and the page’s side are.</p>
      <button type="button" className="tc-play" onClick={onPlay}>▶ Play the crossing from here (prototype)</button>
    </section>
  );
}
