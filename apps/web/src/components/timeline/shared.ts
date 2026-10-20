'use client';
// What the strip (Strip.tsx) and the panel (BaseBar.tsx) share: the sim clock text, the scan status ladder, the size
// observer and the one pointer handler both time sliders use (the x <-> time mapping itself is scrub.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { latestRun } from '@bp/core/model';
import { useEngine, useLive } from '../hooks';
import { ago } from '../Header';
import { runFacts, runProgress } from './run';
import { scrubAt, type ScrubGeom } from './scrub';

/** The simulated wall clock at sim second `t`: HH:MM:SS, or HH:MM with `secs` false. */
export function simClock(at0: number, t: number, secs = true): string { return new Date(at0 + t * 1000).toISOString().slice(11, secs ? 19 : 16); }

/** An element's client size, kept current by a ResizeObserver (`w0`/`h0` until it has one). */
export function useSize(ref: React.RefObject<HTMLElement | null>, w0: number, h0: number): [number, number] {
  const [W, setW] = useState(w0), [H, setH] = useState(h0);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { if (ref.current) { setW(ref.current.clientWidth || w0); setH(ref.current.clientHeight || h0); } });
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref, w0, h0]);
  return [W, H];
}

/** The one status ladder for a live product's scan, shared by the strip and the panel clock. A dropped stream keeps the
 *  last-known run state and adds a reconnecting marker (`base` is the state alone, `label` carries the marker). */
export function scanStatus(run: ReturnType<typeof latestRun>, off: boolean): { label: string; base: string; tone: 'on' | 'warn' | '' } {
  if (!run) return { label: off ? 'OFFLINE' : 'NO RUN', base: off ? 'OFFLINE' : 'NO RUN', tone: off ? 'warn' : '' };
  const base = run.status === 'running' ? '● LIVE' + (run.phase ? ' · ' + run.phase.toUpperCase() : '') : String(run.status || '').toUpperCase();
  return { label: off ? base + ' · RECONNECTING' : base, base, tone: off ? 'warn' : run.status === 'running' ? 'on' : '' };
}

/** Keeps a slider's aria-valuetext in step with the simulated clock (whole minutes only, so a screen reader is not flooded). */
export function useHourText(E: ReturnType<typeof useEngine>, svg: React.RefObject<SVGSVGElement | null>, base: string, hour: boolean) {
  useEffect(() => {
    if (!hour) return undefined;
    let last = '';
    return E.onSimTime((t) => {
      const m = simClock(E.M.sim.at0, t, false);
      if (m !== last) { last = m; svg.current?.setAttribute('aria-valuetext', base + '; simulated ' + m); }
    });
  }, [E, svg, base, hour]);
}

/** The pointer handlers of a time slider, the same for strip and panel: down/move scrub through scrubAt (a drag keeps the
 *  zone it began in), up / cancel / lost capture all end the drag, and a drag left of the sim head flags `data-back` on the
 *  svg (the css shows not-allowed: the sim only replays forward). A slider with nowhere to go (one week, no hour) ignores
 *  the pointer. `stop` keeps the press from reaching the strip's expand click. */
export function useScrub(E: ReturnType<typeof useEngine>, svg: React.RefObject<SVGSVGElement | null>, W: number, g: ScrubGeom, stop: boolean) {
  const lock = useRef<'h' | 'o' | null>(null), gr = useRef(g), wr = useRef(W);
  useLayoutEffect(() => { gr.current = g; wr.current = W; });
  const end = () => { lock.current = null; svg.current?.removeAttribute('data-back'); };
  const apply = (e: React.PointerEvent) => {
    const el = svg.current; if (!el) return;
    const r = el.getBoundingClientRect(), G = gr.current;
    const x = r.width > 0 ? ((e.clientX - r.left) / r.width) * wr.current : 0;
    const s = scrubAt(G, x, lock.current, E.M.sim.t);
    if (!s) return;
    lock.current = s.lock;
    if (s.hourT !== undefined) {
      if (s.back) el.setAttribute('data-back', ''); else el.removeAttribute('data-back');
      if (!(s.back && E.store.get().t === G.asOf)) E.seek(s.hourT);
    } else if (s.date) E.setTime(s.date);
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (stop) e.stopPropagation();
      lock.current = null;
      if (gr.current.weeks.length < 2 && !gr.current.hour) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId); apply(e);
    },
    onPointerMove: (e: React.PointerEvent) => { if (lock.current) apply(e); },
    onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
  };
}

/** A live product's latest run with what the timeline says about it: status ladder, features measured against the scope, and
 *  the time facts worded like the header's "Last scan <age>". Re-reads the clock every 30 s (the header's cadence). null on Kettle. */
export function useRunInfo() {
  const E = useEngine(), live = useLive(), scan = live?.product.scan, run = latestRun(scan), on = !!live;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return undefined; const t = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, [on]);
  const p = useMemo(() => (run && scan ? runProgress(run, scan.measurements, E.M.P.features) : null), [run, scan?.measurements, E]);
  if (!live) return null;
  const off = live.product.status === 'offline';
  return { run, off, ...scanStatus(run, off), p, facts: run && p ? runFacts(run, p, Math.max(now, Date.parse(run.started_at) || 0), ago) : null };
}
