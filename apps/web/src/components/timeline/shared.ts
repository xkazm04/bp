'use client';
// What the strip (Strip.tsx) and the panel (BaseBar.tsx) share: the sim clock text, the scan status ladder, the size
// observer, the one pointer handler and the one time-slider hook both render from (the x <-> time mapping is scrub.ts,
// the slider's rules - geometry, inert rule, ARIA, transport, Escape - are slider.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { latestRun } from '@bp/core/model';
import { useEngine, useLive } from '../hooks';
import { ago, scanLiveness, scanStatus } from '@bp/core/scan/liveness';
import { runFacts, runProgress } from './run';
import { hourX, scrubAt, type ScrubGeom } from './scrub';
import { timeSliderKey } from './keys';
import { SLIDERS, escapeAction, sliderModel, sliderStill, type SliderKind } from './slider';

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

/** The one status ladder for a live product's scan, shared by the strip and the panel clock: the liveness verdict's
 *  timeline form (@bp/core/scan/liveness). A dropped stream keeps the last-known run state and adds a reconnecting marker. */
export { scanStatus };

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
      if (sliderStill(gr.current.weeks, gr.current.hour)) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId); apply(e);
    },
    onPointerMove: (e: React.PointerEvent) => { if (lock.current) apply(e); },
    onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
  };
}

/** The one time slider, composed once for the strip's hairline and the panel's revisions chart: the model (slider.ts),
 *  the pointer scrub, the hour's aria-valuetext, the sim-head painter and the key map with the kind's Escape. The head
 *  (line `head`, elapsed rect `el`, optional marker `tri` drawn by `triD`) is a DOM write from the sim clock, never a
 *  React render per sim second. `W`/`H` are the svg's size (each component keeps its own useSize fallback). */
export function useTimeSlider(E: ReturnType<typeof useEngine>, o: { kind: SliderKind; g: ScrubGeom; W: number; H: number; t: string; ariaLabel: string; triD?: (x: number) => string }) {
  const { kind, g, W, H } = o, spec = SLIDERS[kind];
  const svg = useRef<SVGSVGElement>(null), head = useRef<SVGLineElement>(null), el = useRef<SVGRectElement>(null), tri = useRef<SVGPathElement>(null);
  const model = sliderModel({ weeks: g.weeks, asOf: g.asOf, t: o.t, hour: g.hour });
  const scrub = useScrub(E, svg, W, g, spec.stop);
  useHourText(E, svg, model.valueText, g.hour);
  useEffect(() => (g.hour ? E.onSimTime((s) => {
    const x = hourX(g, s);
    head.current?.setAttribute('x1', String(x)); head.current?.setAttribute('x2', String(x));
    el.current?.setAttribute('width', String(Math.max(0, x - g.o0)));
    if (o.triD) tri.current?.setAttribute('d', o.triD(x));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }) : undefined), [E, W, H, g.hour]);
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const cur = e.currentTarget, st = E.store.get();
    const esc = () => {
      const a = escapeAction(kind, { tl: !!st.tl, now: st.t === g.asOf });
      if (a === 'collapse') E.setTimeline(false); else if (a === 'back-to-now') E.setTime(g.asOf); else cur.blur();
    };
    if (timeSliderKey(e, E, g.hour, esc)) { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); }
  };
  const svgProps = { ref: svg, ...model.aria, 'aria-label': o.ariaLabel, ...scrub, onKeyDown, ...(spec.stop ? { onClick: (e: React.MouseEvent) => e.stopPropagation() } : {}) };
  return { svgProps, refs: { head, el, tri }, model };
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
  return { run, off, ...scanStatus(scanLiveness(live.product, now)), p, facts: run && p ? runFacts(run, p, Math.max(now, Date.parse(run.started_at) || 0), ago) : null };
}
