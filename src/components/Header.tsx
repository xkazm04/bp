'use client';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { latestRun, sheetOf, views, type BayNode, type BldNode, type RoomNode, type WingNode } from '@/lib/model';
import { shallowEqual, useBp, useEngine, useLive, useVariant } from './hooks';
import { ThemeToggle } from './ThemeToggle';
import { ProjectSwitcher } from './ProjectSwitcher';
import type { Crumb } from '@/engine/state';
import type { LiveProduct } from '@/lib/scan/client';
import { useProductName } from '@/lib/scan/projects';
import { Mark } from './Symbols';

function crumbLabel(E: ReturnType<typeof useEngine>, c: Crumb, short: boolean): string {
  const o = E.placeById(c.t, c.id);
  if (!o) return c.id;
  if (c.t === 'bld') return short ? (o as BldNode).b.short : (o as BldNode).name;
  if (c.t === 'wing') { const w = o as WingNode; return short ? w.def.letter : w.def.letter + ' · ' + w.def.name; }
  if (c.t === 'room') { const r = o as RoomNode; return short ? r.d.code || r.d.name : r.d.name; }
  return (o as BayNode).cap.name;
}

/** Clauses the summary drops, in order, when the measured room is short: proposed/retired, being built, the feature count, live. Trouble and waiting questions go last: first as a short icon + count (level 5), then the line is hidden and its text moves to the crumb row's title (level 6). Never cut mid-word. */
const SUM_LAST = 6;

/** The place's summary line (counts, trouble, waiting questions): the only crumb part that follows the sim and the time. */
const CrumbSum = memo(function CrumbSum({ navRef, pk }: { navRef: React.RefObject<HTMLElement | null>; pk: string }) {
  const E = useEngine(), M = E.M;
  const s = useBp((s) => ({ place: s.place, open: s.open, t: s.t, delta: s.delta, simV: s.simV, who: s.who, view: s.view }), shallowEqual);
  const el = useRef<HTMLSpanElement>(null);
  const d = useMemo(() => {
    if (s.open) return null;
    const last = s.place[s.place.length - 1], cur = last ? E.placeById(last.t, last.id) : null, fs = cur ? cur.feats : M.P.features;
    const id = cur ? cur.id : 'ALL';
    const c = M.agg.countsOf(id, fs, s.t, s.delta), now = s.t === M.P.asOf;
    const bad = now ? M.agg.healthOf(id, fs, 'general').bad : 0;
    const asks = M.sim.has && now ? M.sim.stats(fs, s.who, s.view).asks : 0;
    return { n: fs.length, live: c.live + c.flagged, build: c.build, paper: c.paper, dep: c.dep, bad, asks };
    // simV is the sim's version: the asks change with it
  }, [E, M, s.place, s.open, s.t, s.delta, s.simV, s.who, s.view]);
  // measured, not estimated: render everything, and while the line is wider than the room the flex layout leaves it, drop one tier and look again
  const sig = pk + '|' + (d ? [d.n, d.live, d.build, d.paper, d.dep, d.bad, d.asks].join() : '');
  const [st, setSt] = useState({ sig: '', lv: 0 });
  const lv = st.sig === sig ? st.lv : 0;
  useLayoutEffect(() => {
    const n = el.current; if (!n) return;
    if (n.scrollWidth > n.clientWidth + 1 && lv < SUM_LAST) setSt({ sig, lv: lv + 1 === 5 && !d?.bad && !d?.asks ? SUM_LAST : lv + 1 });
    else if (st.sig !== sig) setSt({ sig, lv });
  });
  useEffect(() => {
    const n = navRef.current; if (!n || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSt({ sig: '', lv: 0 }));
    ro.observe(n);
    return () => ro.disconnect();
  }, [navRef]);
  // hidden, the summary stays reachable: its text is the title of the crumb row
  const text = d ? [d.n + ' features', d.live + ' live', d.build + ' being built', d.paper + ' proposed', d.dep ? d.dep + ' being retired' : '', d.bad ? d.bad + ' in trouble' : '', d.asks ? d.asks + (d.asks === 1 ? ' question' : ' questions') + ' waiting' : ''].filter(Boolean).join(' · ') : '';
  useEffect(() => {
    const n = navRef.current; if (!n || lv < SUM_LAST || !text) return;
    n.title = text;
    return () => { n.removeAttribute('title'); };
  }, [navRef, lv, text]);
  if (!d) return null;
  if (lv >= SUM_LAST) return <span className="sum off" ref={el}>{text}</span>;
  if (lv === 5) {
    return (
      <span className="sum" ref={el} title={text}>
        {d.bad > 0 && <span className="cl" role="img" aria-label={d.bad + ' in trouble'}><Mark k="cloud" w={22} h={15} /><em>{d.bad}</em></span>}
        {d.asks > 0 && <span className="cl" role="img" aria-label={d.asks + (d.asks === 1 ? ' question' : ' questions') + ' waiting'}><Mark k="wait" w={22} h={15} /><i>{d.asks}</i></span>}
      </span>
    );
  }
  const parts: React.ReactNode[] = [];
  if (lv < 3) parts.push(<span key="n">{d.n} features</span>);
  if (lv < 4) parts.push(<b key="l">{d.live} live</b>);
  if (lv < 2) parts.push(<span key="b">{d.build} being built</span>);
  if (lv < 1) { parts.push(<span key="p">{d.paper} proposed</span>); if (d.dep) parts.push(<span key="d">{d.dep} being retired</span>); }
  const att: React.ReactNode[] = [];
  if (d.bad) att.push(<em key="t">{d.bad} in trouble</em>);
  if (d.asks) att.push(<i key="q">{d.asks} {d.asks === 1 ? 'question' : 'questions'} waiting</i>);
  const all = parts.concat(att);
  return (
    <span className="sum" ref={el}>
      {all.map((x, i) => <span key={i} className="cl">{i > 0 ? ' · ' : ''}{x}</span>)}
    </span>
  );
});

/** Room kept for the summary line beside the crumbs (it ellipsises below this). */
const SUM_MIN = 220;

const Crumbs = memo(function Crumbs() {
  const E = useEngine(), M = E.M;
  const place = useBp((s) => s.place);
  const name = useProductName(M.live?.slug ?? null, M.P.name);
  const key = place.map((c) => c.t + c.id).join('/');
  const nav = useRef<HTMLElement>(null), full = useRef(0);
  // parents shorten only when the full chain does not fit the header's real width: measure it once per
  // place with full labels, then compare on every resize (`full` is always the unshortened width)
  const [sh, setSh] = useState({ key: '', short: false });
  const short = sh.key === key && sh.short;
  const fit = () => { const n = nav.current; return !!n && full.current > n.clientWidth - SUM_MIN; };
  useLayoutEffect(() => {
    const n = nav.current; if (!n || sh.key === key) return;
    const bs = n.querySelectorAll<HTMLElement>('button'), a = bs[0], z = bs[bs.length - 1];
    full.current = a && z ? z.offsetLeft + z.offsetWidth - a.offsetLeft : 0;
    setSh({ key, short: fit() });
  });
  useEffect(() => {
    const n = nav.current; if (!n || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const v = fit(); setSh((o) => (o.key === key && o.short !== v && full.current ? { key, short: v } : o)); });
    ro.observe(n);
    return () => ro.disconnect();
  }, [key]);
  const items = [{ key: 'home', label: M.P.scale > 1 ? name + ' campus' : name, depth: 0 }].concat(
    place.map((c, i) => ({ key: c.id, label: crumbLabel(E, c, short && i < place.length - 1), depth: i + 1 })),
  );
  return (
    <nav id="crumbs" aria-label="Where you are" ref={nav}>
      {items.map((it, i) => (
        <span key={it.key} style={{ display: 'contents' }}>
          {i > 0 && <span className="sep">›</span>}
          <button type="button" className={i === items.length - 1 ? 'cur' : ''} aria-current={i === items.length - 1 ? 'location' : undefined} onClick={() => E.crumb(it.depth)} title={it.label}>
            {it.label}
          </button>
        </span>
      ))}
      <CrumbSum navRef={nav} pk={key} />
    </nav>
  );
});

/** One tab per view: General, then every enabled lens in file order (name, short and question count from the data). */
function LensTabs() {
  const E = useEngine(), V = useVariant(), P = E.M.P;
  const s = useBp((s) => ({ view: s.view, simV: s.simV }), shallowEqual);
  const open = E.M.sim.has ? E.M.sim.openDecs() : [];
  const strip = useRef<HTMLDivElement>(null);
  const vs = views(P);
  // roving focus (the rail's pattern): arrows/Home/End move between tabs and select, and never reach the engine's walk
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = Math.max(0, vs.indexOf(s.view)), n = vs.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation(); // React listens on `document` (App Router), where the engine's handler also sits
    E.setView(vs[j]);
    strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus();
  };
  // a narrow window scrolls the strip (blueprint.css #tabs, the offset parent): keep the selected tab in it whatever selected it (a digit key, the page)
  useEffect(() => {
    const el = strip.current, b = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !b || el.scrollWidth <= el.clientWidth) return;
    if (b.offsetLeft < el.scrollLeft) el.scrollLeft = b.offsetLeft;
    else if (b.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = b.offsetLeft + b.offsetWidth - el.clientWidth;
  }, [s.view]);
  return (
    <div id="tabs" role="tablist" aria-label="Sheets (lenses)" ref={strip} onKeyDown={onTabKey}>
      {vs.map((k, i) => {
        const sh = sheetOf(P, k);
        const n = k === 'general' ? 0 : open.filter((d) => d.lens === k).length;
        const on = s.view === k;
        const sub = V.ui?.tabLabel?.(k) ?? sh.nm;
        return (
          <button key={k} type="button" role="tab" data-lens={k} aria-selected={on} tabIndex={on ? 0 : -1} title={sh.title + (sh.sub ? ': ' + sh.sub : '') + (i < 9 ? ' (' + (i + 1) + ')' : '') + (n ? ' · ' + n + ' questions waiting on this sheet' : '')} onClick={() => E.setView(k)}>
            <span className="no">{sh.no}{n ? <b className="ct">{n}</b> : null}</span>
            <span className="nm">{sub}</span>
            {i < 9 ? <span className="kb">{i + 1}</span> : null}
            {on && <motion.span layoutId="lens-uline" className="uline" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
          </button>
        );
      })}
    </div>
  );
}

/** "3 min ago", "2 h ago", "4 d ago". */
export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}

/** A run still `running` with no sign of life this long shows as stalled. Scans bump the run row per phase and write activity rows per feature; one LLM batch can stay quiet for a couple of minutes, so 5 min of silence from both means the scanner is gone (a hard kill leaves `running` forever). */
export const STALL_MS = 5 * 60000;
/** Last sign of life of a run: its row's updated_at or its newest activity row. */
export function lastSeen(L: LiveProduct, run: { id: string; updated_at: string }): number {
  let t = Date.parse(run.updated_at) || 0;
  const a = L.scan?.activity;
  if (a) for (let i = a.length - 1; i >= 0; i--) if (a[i].run_id === run.id) { t = Math.max(t, Date.parse(a[i].at) || 0); break; }
  return t;
}

/**
 * A live product's scan status: `Live · <phase>` while its latest run is running, `Stalled · last update
 * <age>` when it is `running` but silent past STALL_MS, `Last scan failed/aborted <age>` for a bad end,
 * `Last scan <age>` otherwise, `Offline` while the stream reconnects, `No scan store` before the skill
 * wrote one. Kettle (no live product) shows nothing.
 */
const LivePill = memo(function LivePill() {
  const live = useLive();
  return live ? <LivePillOn L={live.product} /> : null;
});
function LivePillOn({ L }: { L: LiveProduct }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  const run = latestRun(L.scan);
  let cls = '', text: string, title: string;
  if (L.status === 'error' && L.structure) { cls = 'off'; text = 'Scan store error'; title = L.error ?? 'The scan store cannot be read'; }
  else if (L.status === 'offline') { cls = 'off'; text = 'Offline'; title = 'The scan stream dropped; reconnecting (backoff up to 10 s)'; }
  else if (L.status === 'missing' || !run) { cls = 'idle'; text = L.status === 'missing' ? 'No scan store' : 'No scan yet'; title = 'Every feature reads unmeasured until /lens-scan writes a run'; }
  else if (run.status === 'running') {
    const age = Date.now() - lastSeen(L, run);
    if (age > STALL_MS) { cls = 'off'; text = 'Stalled · last update ' + ago(age); title = 'Run ' + run.id + ' still says running (phase ' + run.phase + ') but nothing was written for ' + ago(age).replace(' ago', '') + ': the scan was probably stopped'; }
    else { cls = 'on'; text = 'Live · ' + run.phase; title = 'Run ' + run.id + ' is running: phase ' + run.phase + ', lenses ' + run.lenses.join(', '); }
  } else {
    const bad = run.status === 'failed' || run.status === 'aborted';
    if (bad) cls = 'off';
    text = 'Last scan ' + (bad ? run.status + ' ' : '') + ago(Date.now() - Date.parse(run.ended_at ?? run.updated_at));
    title = 'Run ' + run.id + ' ' + run.status + (run.note ? ': ' + run.note : '');
  }
  return <span className={'livepill ' + cls} role="status" title={title}><i />{text}</span>;
}

const Switcher = memo(ProjectSwitcher);
const Theme = memo(function Theme() { return <ThemeToggle compact />; });
/** The title line: the only header part that follows the sheet. */
function ProjLine() {
  const E = useEngine(), P = E.M.P;
  const view = useBp((s) => s.view);
  const name = useProductName(E.M.live?.slug ?? null, P.name);
  const sh = sheetOf(P, view);
  return <div className="proj">Project {name} · drawing set · <b>sheet {sh.no} · {sh.title}</b> · {E.M.live ? 'live lens scan' : 'simulated swarm'}</div>;
}

export const Header = memo(function Header() {
  const E = useEngine();
  return (
    <header id="hdr">
      <div id="brand">
        <ProjLine />
        <Crumbs />
      </div>
      <div className="hdr-right">
        <Switcher current={E.M.live?.slug ?? null} fallbackName={E.M.P.name} />
        <LivePill />
        <LensTabs />
        <Theme />
      </div>
    </header>
  );
});
