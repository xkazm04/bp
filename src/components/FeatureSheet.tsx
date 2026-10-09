'use client';
// L4: one feature as a full page nested in the plan. The feature's tile grows into the page (the page
// is revealed from the tile's rect outward, a clip-path morph of ~320 ms) while the plan dims and
// blurs behind it, still showing at the edges; closing shrinks the page back into the tile. Under
// reduced motion, a plain fade.
//
// The sticky header carries the breadcrumb (each crumb goes back to that level), the feature's code
// and name, its stage and progress, and the tab strip: General, then every enabled lens from the
// registry in order. The tab is the plan's lens: switching a tab switches the plan behind, and opening
// from a lens view lands on that lens's tab. General is the overview (page/General.tsx); a lens tab is
// that lens alone, laid out for its reader (page/LensTab.tsx). Sections enter in sequence and numbers
// count up on open and on every tab switch (page/motion.tsx). The page scrolls inside; the plan behind
// does not pan or zoom while it is open (the wheel goes to the page).
//
// The phone keeps the single-document view (sheet/SheetBody.tsx), re-exported here.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import type { Feature } from '@/lib/data';
import { views, type BayNode, type BldNode, type RoomNode, type WingNode } from '@/lib/model';
import type { Crumb } from '@/engine/state';
import { PatternDefs } from './Symbols';
import { shallowEqual, useBp, useEngine, useVariant } from './hooks';
import { GeneralTab } from './page/General';
import { LensTab } from './page/LensTab';
import { StageLadder } from './page/bits';
import { CountMemo, EnterDelay } from './page/motion';
import './page.css';

export { SheetBody } from './sheet/SheetBody';

type Rect = { x: number; y: number; w: number; h: number };
const MORPH = 0.32;

/** The page's box in the UI layer's px: inset from the screen so the plan shows around it. */
function pageBox(U: number): Rect {
  const W = window.innerWidth / U, H = window.innerHeight / U;
  const x = Math.max(28, (W - 1360) / 2), y = 18;
  return { x, y, w: W - 2 * x, h: H - 2 * y };
}
/** The transform that lays the page box over the tile's rect (origin top left): where the morph starts and ends. */
function overTile(t: Rect, b: Rect): string {
  const sx = Math.max(0.02, t.w / b.w), sy = Math.max(0.02, t.h / b.h);
  return `translate(${(t.x - b.x).toFixed(1)}px, ${(t.y - b.y).toFixed(1)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

function crumbLabel(E: ReturnType<typeof useEngine>, c: Crumb): string {
  const o = E.placeById(c.t, c.id);
  if (!o) return c.id;
  if (c.t === 'bld') return (o as BldNode).name;
  if (c.t === 'wing') { const w = o as WingNode; return 'Wing ' + w.def.letter + ' · ' + w.def.name; }
  if (c.t === 'room') return (o as RoomNode).d.name;
  return (o as BayNode).cap.name;
}

function Tabs({ f }: { f: Feature }) {
  const E = useEngine(), V = useVariant(), P = E.M.P;
  const view = useBp((s) => s.view);
  return (
    <div className="pg-tabs" role="tablist" aria-label="Feature page tabs (the plan's lens follows)">
      {views(P).map((k, i) => {
        const d = P.LENS[k], on = view === k, h = d ? f.lens[k]?.h ?? 'unmeasured' : '';
        const sub = d ? V.ui?.tabLabel?.(k) ?? d.name : 'Overview';
        return (
          <button key={k} type="button" role="tab" aria-selected={on} className={on ? 'on' : ''} onClick={() => E.setView(k)}
            title={(d ? d.name + ': ' + (h === 'na' ? 'does not apply' : h) : 'General: the overview') + (i < 9 ? ' (' + (i + 1) + ')' : '')}>
            <span className="sh">{d ? d.short : 'GEN'}{d ? <i className={'hd ' + h} aria-hidden="true" /> : null}</span>
            <span className="nm">{sub}</span>
            {on && <motion.span layoutId="pg-tab-uline" className="uline" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
          </button>
        );
      })}
    </div>
  );
}

function Head({ f, back, closeRef }: { f: Feature; back: (depth: number) => void; closeRef: React.RefObject<HTMLButtonElement | null> }) {
  const E = useEngine(), M = E.M, P = M.P, T = M.L.TILE[f.id];
  const place = useBp((s) => s.place, shallowEqual);
  const ms = f.milestone ? P.MS[f.milestone] : null;
  return (
    <header className="pg-head">
      <div className="pg-bar">
        <nav className="pg-crumbs" aria-label="Where this feature is">
          <button type="button" onClick={() => back(0)}>{P.scale > 1 ? 'Campus' : 'Site'}</button>
          {place.map((c, i) => <span key={c.id}><i aria-hidden="true">›</i><button type="button" onClick={() => back(i + 1)}>{crumbLabel(E, c)}</button></span>)}
          <span><i aria-hidden="true">›</i><b aria-current="page">{f.name}</b></span>
        </nav>
        <div className="pg-acts">
          <button type="button" className="btn" onClick={() => E.toggleBlast(f.id)}>Blast radius · B</button>
          <button type="button" className="btn" ref={closeRef} onClick={() => E.closeFeature()}>Back to plan · Esc</button>
        </div>
      </div>
      <div className="pg-title">
        <div className="bubble" title="Detail callout: detail number over feature code"><span className="a">{T.idx}</span><span className="b">{f.code || '—'}</span></div>
        <div className="tt">
          <div className="k">{[f.priority, f.kind, ms ? (ms.code ? ms.code + ' ' : '') + ms.name : null].filter(Boolean).join(' · ') || 'Feature'}</div>
          <h2>{f.name}</h2>
        </div>
        <StageLadder f={f} M={M} />
      </div>
      <Tabs f={f} />
    </header>
  );
}

function Page({ f, enter, onCrumb }: { f: Feature; enter: number; onCrumb: (depth: number) => void }) {
  const E = useEngine();
  const view = useBp((s) => s.view);
  const memo = useMemo(() => new Map<string, number>(), []);
  const closeRef = useRef<HTMLButtonElement>(null), scroll = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  // the first tab waits for the morph; later tab switches enter at once
  const delay = first.current ? enter : 0;
  useEffect(() => { first.current = false; }, []);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [view]);
  useEffect(() => { const t = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), enter * 1000 + 40); return () => clearTimeout(t); }, [enter]);
  const isLens = !!E.M.P.LENS[view];
  return (
    <CountMemo.Provider value={memo}>
      <PatternDefs />
      <Head f={f} back={onCrumb} closeRef={closeRef} />
      <div className="pg-scroll" ref={scroll} tabIndex={-1}>
        <EnterDelay.Provider value={delay}>
          <div className="pg-body" key={view} role="tabpanel" aria-label={isLens ? E.M.P.LENS[view].name : 'General'}>
            {isLens ? <LensTab lens={view} f={f} /> : <GeneralTab f={f} />}
          </div>
        </EnterDelay.Provider>
        <div className="foot">{E.M.live ? 'Read from the live scan' : 'Illustrative sample data · drawings are stylised, not screenshots'}</div>
      </div>
    </CountMemo.Provider>
  );
}

/** Mount the page's content one frame after the shell, so the morph is already running (on the compositor) while it renders. */
function Deferred({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  return on ? <>{children}</> : null;
}

export function FeatureSheet() {
  const E = useEngine();
  const s = useBp((s) => ({ open: s.open, phone: s.phone }), shallowEqual);
  const reduce = useReducedMotion() ?? false;
  const f = s.open ? E.M.P.F[s.open] ?? null : null;
  // geometry: the page box and the tile rect, read when the page opens and again when it closes
  const [box, setBox] = useState<Rect | null>(null);
  const tile = useRef<Rect | null>(null), lastId = useRef<string | null>(null), crumbed = useRef(false);
  // every opening is a new page instance: one that opens while the last is still shrinking away runs its own morph
  const nth = useRef(0), wasOpen = useRef(false);
  if (!!f !== wasOpen.current) { wasOpen.current = !!f; if (f) nth.current++; }
  useLayoutEffect(() => {
    if (!f) return;
    crumbed.current = false; lastId.current = f.id;
    setBox(pageBox(E.U || 1));
    const r = () => setBox(pageBox(E.U || 1));
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, [f, E]);
  // the tile's rect at render time: on open (the camera has settled, see Engine.openFeature) and on close (the plan has not moved)
  if (f) tile.current = E.tileRect(f.id);
  else if (lastId.current && !crumbed.current) tile.current = E.tileRect(lastId.current);
  const onCrumb = (depth: number) => { crumbed.current = true; tile.current = null; E.crumb(depth); };

  const b = box ?? (typeof window !== 'undefined' ? pageBox(E.U || 1) : { x: 0, y: 0, w: 0, h: 0 });
  // transform and opacity only, so the morph runs on the compositor while the page's content mounts
  const FULL = 'translate(0px, 0px) scale(1, 1)';
  const vPage: Variants = reduce
    ? { from: { opacity: 0, transition: { duration: 0.15 } }, full: { opacity: 1, transition: { duration: 0.15 } } }
    : {
        from: (t: Rect | null) => (t ? { transform: overTile(t, b), opacity: 1, transition: { duration: MORPH * 0.85, ease: [0.4, 0, 0.2, 1] } } : { transform: FULL, opacity: 0, transition: { duration: 0.18 } }),
        full: { transform: FULL, opacity: 1, transition: { duration: MORPH, ease: [0.2, 0.7, 0.2, 1] } },
      };
  const vInner: Variants = reduce
    ? { from: { opacity: 1 }, full: { opacity: 1 } }
    : { from: { opacity: 0, transition: { duration: 0.08 } }, full: { opacity: 1, transition: { duration: 0.2, delay: MORPH * 0.55 } } };
  return (
    <AnimatePresence custom={tile.current}>
      {f && !s.phone && [
        <motion.div key={"dim" + nth.current} className="pg-dim" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0.15 : MORPH }}
          onClick={() => E.closeFeature()} onWheel={(e) => document.getElementById('detail')?.querySelector('.pg-scroll')?.scrollBy({ top: e.deltaY })} />,
        <motion.section key={"page" + nth.current} id="detail" className="pg" aria-label={'Feature page: ' + f.name} role="dialog" aria-modal="false"
          style={{ left: b.x, top: b.y, width: b.w, height: b.h, transformOrigin: '0 0' }}
          custom={tile.current} variants={vPage} initial="from" animate="full" exit="from">
          <motion.div className="pg-in" variants={vInner}>
            <Deferred key={f.id}><Page f={f} enter={reduce ? 0 : MORPH * 0.55} onCrumb={onCrumb} /></Deferred>
          </motion.div>
          <div className="pg-frame" aria-hidden="true" />
        </motion.section>,
      ]}
    </AnimatePresence>
  );
}
