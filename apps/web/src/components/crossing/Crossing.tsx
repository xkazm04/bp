'use client';
// The crossing of "The Desk Becomes the Table", as a web prototype: a 2.5D (CSS 3D) picture of what the person sees in a
// Quest 3S, from the real page at the real place to that place on the table, and back. One clock (timeline.ts) drives
// every value, so it plays, scrubs and steps. The view of the scene never moves (the comfort doctrine): the camera is
// fixed and only content moves. Beside the scene, for every state: who draws it, what crosses the network, which build
// and which machine, and how sure each claim is (facts.ts).
//
// The real parts: the page captured from the live canvas at the place you were, the place itself (the page's own hash and
// the companion's target kinds), the table's plan drawn from the same layout data, and the page following the table (the
// engine really flies to the next place behind this overlay, and stays there if you close after the headset came off).
// The mock parts: the room, the studio and the lamp are sketches; the baton is simulated in this page.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useEngine } from '../hooks';
import { GENERAL } from '@bp/core/data/types';
import { END, FOCUSED, STATES, designClock, sceneAt, smooth, stateAt, stateIndex, tOf, xOf } from './timeline';
import { arrived, capturePage, nextOf, placeOf, type CrossPlace, type NextPlace } from './place';
import { ART_H, ART_W, drawTable, type Light, type Rise } from './table-art';
import { KEY_LABEL, factsFor, packets, placeWire, type Mark } from './facts';
import { STANDIN, runBaton, type Exchange } from './baton';
import './crossing.css';

interface Prep {
  a: CrossPlace; next: NextPlace | null;
  pageA: string; pageB: string | null;
  tableA: string; tableB: string | null;
  rises: Rise[]; risesB: Rise[]; lights: Light[];
  titleA: string;
  /** The baton's requests as they ran against this server (null: no route, the wire is simulated). */
  real: Exchange[] | null;
  /** Unpaired, the APK opens its bundled Kettle at home: the site plan, whatever the page's place. */
  tableHome: string; risesHome: Rise[]; lightsHome: Light[];
  /** A decision waiting in this room (else the queue's first): the lamp holds it in VR; it is answered on the desk. */
  card: { q: string; feature: string; lens: string; urg: string } | null;
}

const MARK_LABEL: Record<Mark, string> = { real: 'real', measured: 'measured', documented: 'documented', unverified: '[unverified]', new: 'NEW', mock: 'mock' };
const SPEEDS = [0.25, 0.5, 1] as const;

/** Route the page to a hash without a history entry: the engine's restoreHash flies there, as a pasted hash would. */
function route(h: string) {
  try { history.replaceState(history.state, '', location.pathname + location.search + (h === '#' ? '' : h)); } catch { /* ignore */ }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
const sub = (p: CrossPlace) => ['L' + p.level, p.level === 4 ? 'feature sheet' : p.level === 3 ? 'bay' : p.level === 2 ? 'room' : p.level === 1 ? 'wing' : 'site plan', p.lens === GENERAL ? 'General' : p.lens + ' lens'].join(' · ');
const jpeg = (c: HTMLCanvasElement) => c.toDataURL('image/jpeg', 0.9);

export default function Crossing({ onClose }: { onClose: () => void }) {
  const E = useEngine();
  const [prep, setPrep] = useState<Prep | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(0.5);
  const [paired, setPaired] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  tRef.current = t;

  // the place, the captures and the table, once: A where you are, B where the table will lead (the engine flies there
  // behind this overlay, is captured, and flies back; replaceState only, so history is untouched). One run per overlay,
  // shared by a remount (a second run would read the place the first one had routed to).
  const job = useRef<Promise<Prep> | null>(null);
  useEffect(() => {
    let dead = false;
    job.current ??= (async () => {
      await new Promise((r) => setTimeout(r, 60));
      const a = placeOf(E), next = nextOf(E, a);
      const pageA = jpeg(capturePage(a.crumbs, sub(a)));
      const TA = drawTable(E, a, next);
      let pageB: string | null = null, tableB: string | null = null, risesB: Rise[] = TA.rises;
      if (next) {
        route(next.hash); await arrived(E);
        const b = placeOf(E);
        pageB = jpeg(capturePage(b.crumbs, sub(b)));
        const TB = drawTable(E, { ...a, bay: next.bay, tile: null, name: next.name }, null);
        tableB = jpeg(TB.canvas); risesB = TB.rises;
        route(a.hash); await arrived(E);
      }
      const real = await runBaton(a, next);
      const sim = E.M.sim, open = sim.has ? sim.queueFor(null, GENERAL).all : [];
      const d = open.find((x) => a.room?.feats.some((f) => f.id === x.f)) ?? open[0];
      const card = d ? { q: d.q, feature: E.M.P.F[d.f]?.name ?? d.f, lens: E.M.P.LENS[d.lens]?.name ?? d.lens, urg: d.urg } : null;
      const TH = drawTable(E, { ...a, level: 0, wing: null, room: null, bay: null, tile: null, crumbs: [a.crumbs[0]], name: a.crumbs[0] + ' · home' }, null);
      return { a, next, pageA, pageB, tableA: jpeg(TA.canvas), tableB, rises: TA.rises, risesB, lights: TA.lights, titleA: TA.title, real,
        tableHome: jpeg(TH.canvas), risesHome: TH.rises, lightsHome: TH.lights, card };
    })();
    // under reduced motion the crossing waits on its first state: the person steps it
    job.current.then((p) => { if (!dead) { setPrep(p); setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches); } });
    return () => { dead = true; };
  }, [E]);

  // the clock
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const nt = tRef.current + dt * speed;
      if (nt >= END) { setT(END); setPlaying(false); return; }
      setT(nt); raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const close = useCallback(() => {
    // the page followed the table: after the headset came off, it stays where the table left it
    if (prep?.next && tRef.current >= STATES[9].at) route(prep.next.hash);
    onClose();
  }, [prep, onClose]);
  const seek = useCallback((x: number) => { setT(Math.max(0, Math.min(END, x))); }, []);
  const stepTo = useCallback((d: 1 | -1) => {
    setPlaying(false);
    const i = stateIndex(tRef.current), cur = STATES[i];
    // a step back from inside a state goes to its start first
    const j = d < 0 && tRef.current - cur.at > 0.15 ? i : Math.max(0, Math.min(STATES.length - 1, i + d));
    setT(STATES[j].show);
  }, []);
  const replay = useCallback(() => { setT(0); setPlaying(true); }, []);

  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); close(); }
    else if (k === ' ' || k === 'k') { e.preventDefault(); if (t >= END) replay(); else setPlaying((p) => !p); }
    else if (k === 'ArrowRight') { e.preventDefault(); stepTo(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); stepTo(-1); }
    else if (k === 'Home' || k === 'r') { e.preventDefault(); replay(); }
  };

  return (
    <div className="cx" ref={root} role="dialog" aria-modal="true" aria-label="The crossing: from the desk to the table" tabIndex={-1} data-keys="own" onKeyDown={onKey}>
      <header className="cx-top">
        <div className="cx-name"><b>The Desk Becomes the Table</b><span>the crossing, as a web prototype</span></div>
        {prep && <div className="cx-from" title="The place the baton carries: the page's own hash">from <code>{prep.a.hash === '#' ? '#(site)' : prep.a.hash}</code> · {prep.a.crumbs.slice(1).join(' › ') || 'the site'}</div>}
        <button type="button" className="cx-x" onClick={close} title="Close ( Esc )">Close · Esc</button>
      </header>
      {!prep ? <div className="cx-prep"><span className="cx-spin" aria-hidden="true" />Reading your place and drawing the table…</div> : <Body prep={prep} t={t} paired={paired} />}
      {prep && <Transport t={t} playing={playing} speed={speed} setSpeed={setSpeed} seek={seek} stepTo={stepTo} replay={replay}
        toggle={() => (t >= END ? replay() : setPlaying((p) => !p))} setPlaying={setPlaying} prep={prep} paired={paired} setPaired={setPaired} />}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- the stage and the panel
function Body({ prep, t, paired }: { prep: Prep; t: number; paired: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.6);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const fit = () => setK(Math.min(el.clientWidth / 1600, el.clientHeight / 900));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="cx-body">
      <div className="cx-stagewrap" ref={wrap}>
        <div className="cx-box" style={{ width: 1600 * k, height: 900 * k }}>
          <Stage prep={prep} t={t} k={k} paired={paired} />
        </div>
      </div>
      <Panel prep={prep} t={t} paired={paired} />
    </div>
  );
}

/** Desk-local pose of the paper: p = 0 standing on the monitor (its screen), 1 lying on the desk as the table. */
function paperPose(p: number): string {
  // the monitor's screen centre in desk coordinates, relative to the paper's resting centre: 490 px farther, 215 px up;
  // its screen is 0.3 of the paper (480 x 270)
  const dy = -490 * (1 - p), dz = 215 * (1 - p) + Math.sin(Math.PI * p) * 140 + 2, rx = -90 * (1 - p), s = 0.3 + 0.7 * p;
  return `translate3d(0px, ${dy.toFixed(1)}px, ${dz.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) scale(${s.toFixed(4)})`;
}

function Stage({ prep, t, k, paired }: { prep: Prep; t: number; k: number; paired: boolean }) {
  const sc = sceneAt(t, paired), st = stateAt(t), off = STATES[9].at;
  const inVR = t >= FOCUSED - 0.3 && t < off + 0.3;
  const rises = !paired ? prep.risesHome : sc.moved > 0.5 ? prep.risesB : prep.rises, lights = paired ? prep.lights : prep.lightsHome;
  const caption = sc.moved > 0.02 && prep.next ? prep.next.name : prep.a.name;
  const lampSay = sc.moved > 0.02 ? 'the page follows' : 'where you were on the desk';
  return (
    <>
      <div className="cx-view" style={{ transform: `scale(${k})` }}>
        {inVR && <Room o={sc.pass} />}
        {inVR && (
          <div className="cx-persp" style={{ opacity: sc.pass }}>
            <div className="cx-desk">
              <div className="cx-wood" />
              <div className="cx-note" />
              <div className="cx-pen" />
              <div className="cx-kbd" />
              <div className="cx-mouse" />
              <div className="cx-mug" />
              <div className="cx-foot" />
              <div className="cx-stand" />
              <div className="cx-monitor"><div className="cx-screen"><img src={prep.pageA} alt="" /></div></div>
            </div>
          </div>
        )}
        {inVR && <div className="cx-grain" style={{ opacity: sc.pass * 0.55 }} />}
        {inVR && <Studio o={sc.studio} />}
        {inVR && (
          <div className="cx-persp">
            <div className="cx-desk">
              <div className="cx-glass" style={{ opacity: sc.studio }} />
              {paired && t >= FOCUSED - 0.3 && t < FOCUSED + 2.2 && (
                // the anchors the person pinned once (two touches; Meta's spatial anchors persist), found again at FOCUSED,
                // and the claimed place arriving as a label on the pinned monitor: drawn by the APK, over passthrough
                <div className="cx-anchor" style={{ opacity: smooth(FOCUSED, FOCUSED + 0.3, t) * (1 - smooth(FOCUSED + 1.2, FOCUSED + 1.6, t)) }}>
                  <i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" />
                  <span className="cx-claim" style={{ opacity: smooth(FOCUSED + 0.8, FOCUSED + 0.95, t) }}>● {prep.a.hash === '#' ? 'the site' : prep.a.hash}</span>
                </div>
              )}
              {paired && t >= FOCUSED - 0.3 && t < FOCUSED + 1.4 && <div className="cx-tap" style={{ opacity: smooth(FOCUSED, FOCUSED + 0.3, t) * (1 - smooth(FOCUSED + 0.9, FOCUSED + 1.3, t)) }} />}
              <div className="cx-paper" style={{ transform: paperPose(sc.lift), opacity: paired ? smooth(FOCUSED + 0.85, FOCUSED + 1.05, t) : sc.table }}>
                <img className="cx-sheet" src={paired ? prep.tableA : prep.tableHome} alt="" style={{ opacity: 1 - sc.moved }} />
                {prep.tableB && <img className="cx-sheet" src={prep.tableB} alt="" style={{ opacity: sc.moved }} />}
                <div className="cx-edge" style={{ opacity: sc.table }} />
                {sc.rise > 0.001 && <Rises rises={rises} r={sc.rise} />}
                {sc.rise > 0.001 && sc.moved < 0.5 && <Lights lights={lights} r={sc.rise} />}
              </div>
            </div>
          </div>
        )}
        {inVR && sc.lamp > 0.001 && <Lamp o={sc.lamp} />}
        {inVR && sc.peek > 0.001 && prep.pageB && (
          <div className="cx-peek" style={{ opacity: sc.peek, transform: `translate(-50%, 0) scale(${0.92 + 0.08 * sc.peek})` }}>
            <img src={prep.pageB} alt="" />
          </div>
        )}
        {sc.page > 0 && <img className="cx-flat" src={t >= off && prep.pageB ? prep.pageB : prep.pageA} alt="" />}
        <div className="cx-black" style={{ opacity: sc.black }} />
      </div>
      {/* the overlay is unscaled: what the person must read stays at 12 px or more at any stage size */}
      <div className="cx-ovl">
        <div className="cx-hud">
          <span className={'cx-who ' + (t < 3.4 || t >= off + 0.3 ? 'w-web' : t < FOCUSED ? 'w-none' : sc.studio > 0.5 ? 'w-apk' : 'w-pass')}>
            {t < 3.4 || t >= off + 0.3 ? 'Your eyes · the monitor on Lynx' : t < FOCUSED ? 'Headset · blackout' : sc.studio > 0.5 ? 'Headset · the APK draws' : 'Headset · passthrough'}
          </span>
          <span className="cx-clock">{designClock(t)}</span>
          {inVR && <span className="cx-still" title="The comfort doctrine: seated, stationary; a transition moves the content, never the view">view fixed · content moves</span>}
        </div>
        {t >= 0.6 && t < 3.6 && (
          <div className={'cx-arm' + (st.id === 'armed' ? ' on' : '')}>
            <span className="cx-btn">{st.id === 'armed' ? '✓ Baton armed' : 'Take it to the table'}</span>
            <span className="cx-armsay">{st.id === 'armed' ? 'Put the headset on within 120 s. Nothing launches from here.' : 'The page offers the table; it does not launch anything.'}</span>
          </div>
        )}
        {t >= 3.75 && t < FOCUSED - 0.2 && <div className="cx-blacksay">3–5 s of black while the headset wakes: no app can draw here</div>}
        {inVR && sc.pass > 0.3 && t < FOCUSED + 2.2 && (
          <div className="cx-tags">
            <span className="cx-tag pass">YOUR ROOM · the headset’s cameras (sketched here)</span>
            {t >= FOCUSED + 0.85 && <span className="cx-tag apk">VIRTUAL · the APK draws this sheet of {prep.a.room ? prep.a.room.name : 'the site'}</span>}
          </div>
        )}
        {inVR && !paired && t >= FOCUSED && t < off && (
          <div className="cx-tags"><span className="cx-tag apk">BUNDLE · the APK’s own Kettle at home, not your place · no live lamp</span></div>
        )}
        {inVR && t < off && sc.caption > 0.01 && (
          <div className="cx-caption" style={{ opacity: sc.caption }}>
            <b>{caption}</b><span>{lampSay}</span>
          </div>
        )}
        {inVR && sc.peek > 0.3 && <div className="cx-peeksay" style={{ opacity: sc.peek }}>wrist peek · the monitor, through the cameras</div>}
        {paired && inVR && prep.card && t >= STATES[8].at && t < off && (
          <div className="cx-card" style={{ opacity: smooth(STATES[8].at, STATES[8].at + 0.4, t) }}>
            <span className="cx-card-k">Decision · {prep.card.lens} · {prep.card.urg}</span>
            <b>{prep.card.q}</b>
            <span className="cx-card-f">on {prep.card.feature}</span>
            <span className="cx-card-desk">Answer it on your desk: only bp’s page holds the x-bp-human token. Peek, and click it there.</span>
          </div>
        )}
        {sc.crumb > 0.01 && prep.next && (
          <div className="cx-crumb" style={{ opacity: sc.crumb }}>The table left you at <b>{prep.next.name}</b></div>
        )}
      </div>
    </>
  );
}

function Room({ o }: { o: number }) {
  return (
    <div className="cx-room" style={{ opacity: o }} aria-hidden="true">
      <div className="cx-wall" />
      <div className="cx-window" />
      <div className="cx-shelf"><i /><i /><i /><i /><i /></div>
      <div className="cx-plant" />
    </div>
  );
}

function Studio({ o }: { o: number }) {
  // the night studio of the VR captures: a city window, shelves, a warm lamp pool
  const lights = useMemo(() => Array.from({ length: 90 }, (_, i) => ({ x: (i * 37.7) % 100, y: 20 + ((i * 53.3) % 60), s: 2 + (i % 3), a: 0.35 + ((i * 7) % 10) / 16 })), []);
  return (
    <div className="cx-studio" style={{ opacity: o }} aria-hidden="true">
      <div className="cx-city">{lights.map((l, i) => <i key={i} style={{ left: l.x + '%', top: l.y + '%', width: l.s, height: l.s, opacity: l.a }} />)}</div>
      <div className="cx-mullion" />
      <div className="cx-books"><i /><i /><i /><i /><i /><i /></div>
      <div className="cx-pool" />
    </div>
  );
}

function Lamp({ o }: { o: number }) {
  return (
    <div className="cx-lamp" style={{ opacity: o, transform: `translate(-50%, ${(1 - o) * -40}px)` }} aria-hidden="true">
      <svg viewBox="0 0 160 200" width="160" height="200">
        <defs>
          <radialGradient id="cxg" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#fff6dc" /><stop offset="0.55" stopColor="#ffc35a" /><stop offset="1" stopColor="#ffb040" stopOpacity="0" /></radialGradient>
        </defs>
        <line x1="80" y1="0" x2="80" y2="38" stroke="#cfd8e3" strokeWidth="3" />
        <circle cx="80" cy="96" r="70" fill="url(#cxg)" opacity="0.35" />
        <path d="M48 66 Q80 30 112 66 L104 150 Q80 176 56 150 Z" fill="#eef2f7" stroke="#b9c4d2" strokeWidth="2" />
        <circle cx="80" cy="84" r="22" fill="url(#cxg)" />
        <circle cx="80" cy="84" r="13" fill="#fff8e6" />
        <path d="M50 100 L20 128 M110 100 L140 128" stroke="#e6ebf2" strokeWidth="7" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Rises({ rises, r }: { rises: Rise[]; r: number }) {
  return (
    <div className="cx-rises">
      {rises.map((b, i) => {
        const z = Math.max(0.5, b.z * r), cls = 'cx-rise' + (b.hot ? ' hot' : '') + (b.next ? ' nx' : '') + (b.walls ? ' walls' : ' slab');
        const st = (x: number, y: number, w: number, h: number, tr: string, origin: string): CSSProperties => ({ left: x, top: y, width: w, height: h, transform: tr, transformOrigin: origin });
        return (
          <div key={i} className={cls}>
            <i className="f" style={st(b.x, b.y + b.h - z, b.w, z, 'rotateX(-90deg)', '50% 100%')} />
            <i className="f" style={st(b.x, b.y - z, b.w, z, 'rotateX(-90deg)', '50% 100%')} />
            <i className="s" style={st(b.x - z, b.y, z, b.h, 'rotateY(90deg)', '100% 50%')} />
            <i className="s" style={st(b.x + b.w - z, b.y, z, b.h, 'rotateY(90deg)', '100% 50%')} />
            {!b.walls && <i className="lid" style={{ left: b.x, top: b.y, width: b.w, height: b.h, transform: `translateZ(${z}px)` }} />}
          </div>
        );
      })}
    </div>
  );
}

function Lights({ lights, r }: { lights: Light[]; r: number }) {
  return (
    <div className="cx-lights" style={{ opacity: r }}>
      {lights.map((l, i) => <i key={i} className={l.bad ? 'bad' : ''} style={{ left: l.x - 22, top: l.y - 22, transform: `translateZ(${26 * r}px) rotateX(calc(-1 * var(--pitch)))` }} />)}
    </div>
  );
}

function Panel({ prep, t, paired }: { prep: Prep; t: number; paired: boolean }) {
  const st = stateAt(t), sc = sceneAt(t, paired), F = factsFor(st.id, prep.a, prep.next, paired);
  const pk = useMemo(() => packets(prep.a, prep.next, FOCUSED, STATES[8].at, STATES[9].at, prep.real, paired), [prep, paired]);
  const sent = pk.filter((p) => p.at <= t), total = sent.reduce((n, p) => n + (p.status ? (p.up ?? 0) + (p.down ?? 0) : p.size), 0);
  const ranHere = !!prep.real?.length && prep.real.every((x) => x.status < 300);
  // the newest place, whoever wrote it: the page's until the lift is done, the table's after (and the table's last on return)
  const tableMoved = prep.next && ((sc.baton === 'live' && sc.moved > 0.5) || sc.baton === 'returned');
  const wire = tableMoved ? placeWire(prep.a, 'vr', prep.next!.hash, prep.next!.level) : placeWire(prep.a, sc.baton === 'live' ? 'vr' : 'web');
  // what the server holds at this state, as it answered when the requests ran (else the Place the design would send)
  const step = sc.baton === 'armed' ? 'arm' : sc.baton === 'claimed' ? 'claim' : sc.baton === 'live' ? (sc.moved > 0.5 ? 'lead' : 'live') : sc.baton === 'returned' ? 'return' : null;
  const held = ranHere && step ? prep.real!.find((x) => x.step === step)?.body : null;
  return (
    <aside className="cx-panel" aria-live="polite">
      <div className="cx-st"><span className="cx-n">{stateIndex(t) + 1}/{STATES.length}</span><span className="cx-clk">{st.clock}</span></div>
      <h2>{F.title}</h2>
      <dl className="cx-facts">
        {F.facts.map((f, i) => (
          <div key={i}><dt>{KEY_LABEL[f.k]}</dt><dd>{f.text}{f.marks.map((m) => <em key={m} className={'mk mk-' + m}>{MARK_LABEL[m]}</em>)}</dd></div>
        ))}
      </dl>
      {paired && prep.a.product === 'kettle' && (st.id === 'fade' || st.id === 'arrived' || st.id === 'live') && (
        <figure className="cx-real">
          <img src={prep.a.room ? '/crossing/real-room-kettle.jpg' : '/crossing/real-site-kettle.jpg'} alt={'The VR table in Unreal today: ' + (prep.a.room ? 'room mode, Booking & Attendance' : 'the site plan, level 0') + ', Kettle'} />
          <figcaption><em className="mk mk-real">REAL</em> The table today in Unreal: {prep.a.room ? 'room mode (Booking & Attendance)' : 'the site plan, level 0'}, a flat capture from the target eye with the PC renderer ({prep.a.room ? 'fag-room-kettle' : 'fid-final-target'}.jpg, docs/concepts/vr-light-table/captures). The APK draws a mobile tier of this: expect less. The stage beside it is a web mock.</figcaption>
        </figure>
      )}
      <h3>Place baton <em className="mk mk-new">NEW</em></h3>
      <ol className="cx-baton">
        {(['none', 'armed', 'claimed', 'live', 'returned'] as const).map((b) => <li key={b} className={sc.baton === b ? 'on' : ''}>{b}</li>)}
      </ol>
      <p className="cx-ran">{sc.baton === 'none' ? 'No baton yet: the place lives only in the page’s hash.' : held ? 'What the server holds now (its answer to the request):' : 'The Place the baton carries:'}</p>
      {sc.baton !== 'none' && <pre className="cx-wire">{JSON.stringify(held ?? wire, null, 1)}</pre>}
      <h3>On the network <span className="cx-bytes">{total} B so far · 0 video frames · 0 audio</span></h3>
      <p className="cx-ran">{ranHere
        ? <>The baton requests ran for real against this server when the crossing opened (<em className="mk mk-real">real</em>): the page armed it with its human token, and this page stood in for the APK on loopback as <code>{STANDIN}</code>. From a Quest they would come through the S8 LAN door (:3101), which is not built.</>
        : <>The baton route did not answer here, so the wire below is the design&apos;s, simulated (<em className="mk mk-mock">mock</em>).</>}</p>
      <ul className="cx-net">
        {pk.map((p, i) => (
          <li key={i} className={p.at <= t ? 'sent' : ''}>
            <span className="d">{p.dir}</span><code>{p.verb}</code>
            <span className="nt">{p.note} · {p.status ? <><b className={p.status < 300 ? 'ok' : 'bad'}>{p.status}</b> · ↑ {p.up} B ↓ {p.down} B</> : <>≈ {p.size} B</>}<em className={'mk mk-' + p.mark}>{MARK_LABEL[p.mark]}</em></span>
          </li>
        ))}
      </ul>
      <p className="cx-honest"><em className="mk mk-mock">mock</em> This page draws the room, the studio and the lamp as sketches; the table is a web mock of what the APK draws. Real: your page and place, the plan data the table is drawn from, the baton's requests, and the page following the table (it flew there behind this overlay).</p>
    </aside>
  );
}

// ----------------------------------------------------------------------------------------------- transport and lanes
const LANES = ['Person', 'Web page · Lynx', 'apps/server + door · Lynx', 'APK · Quest 3S'] as const;
const EVENTS: { at: number; lane: number; label: string }[] = [
  { at: 1.4, lane: 0, label: 'Take it to the table' }, { at: 1.4, lane: 1, label: 'POST arm' }, { at: 1.45, lane: 2, label: 'armed · 120 s' },
  { at: 3.4, lane: 0, label: 'headset on' },
  { at: FOCUSED, lane: 3, label: 'FOCUSED · passthrough' }, { at: FOCUSED + 0.8, lane: 3, label: 'claim' }, { at: FOCUSED + 0.8, lane: 2, label: 'claimed' },
  { at: FOCUSED + 1.0, lane: 3, label: 'lift' }, { at: FOCUSED + 2.0, lane: 3, label: 'fade' }, { at: FOCUSED + 2.0, lane: 2, label: 'live' }, { at: FOCUSED + 2.7, lane: 3, label: 'lamp' },
  { at: 11.9, lane: 3, label: 'dive' }, { at: 12.0, lane: 2, label: 'place' }, { at: 12.1, lane: 1, label: 'page flies' },
  { at: 14.6, lane: 0, label: 'headset off' }, { at: 14.8, lane: 2, label: 'returned' }, { at: 14.9, lane: 1, label: 'web leads' },
];

/** Unpaired: the page arms a baton nobody claims, and the APK opens its bundle. */
const UNPAIRED_EVENTS = [...EVENTS.filter((e) => e.at < FOCUSED || (e.lane === 0 && e.at > 14)), { at: FOCUSED, lane: 3, label: 'FOCUSED · the bundle at home' }, { at: FOCUSED + 0.8, lane: 2, label: 'still armed · nobody claims it' }];

function Transport({ t, playing, speed, setSpeed, seek, stepTo, replay, toggle, setPlaying, prep, paired, setPaired }: {
  t: number; playing: boolean; speed: number; setSpeed: (s: (typeof SPEEDS)[number]) => void; seek: (t: number) => void;
  stepTo: (d: 1 | -1) => void; replay: () => void; toggle: () => void; setPlaying: (p: boolean) => void; prep: Prep;
  paired: boolean; setPaired: (p: boolean) => void;
}) {
  const events = paired ? EVENTS : UNPAIRED_EVENTS;
  const cur = stateAt(t);
  const pct = (x: number) => 100 * xOf(x) + '%';
  void prep;
  return (
    <footer className="cx-bot">
      <div className="cx-ctl">
        <button type="button" onClick={replay} title="Replay from the desk ( Home )">⟲ Replay</button>
        <button type="button" onClick={() => stepTo(-1)} title="Previous state ( ← )" aria-label="Previous state">◀</button>
        <button type="button" className="cx-play" onClick={toggle} title="Play / pause ( Space )">{playing ? '❚❚ Pause' : t >= END ? '⟲ Again' : '▶ Play'}</button>
        <button type="button" onClick={() => stepTo(1)} title="Next state ( → )" aria-label="Next state">▶</button>
        <span className="cx-speed" role="group" aria-label="Speed">
          {SPEEDS.map((s) => <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} title={s === 1 ? 'Real time from FOCUSED on' : 'Slower than real time'}>{s === 1 ? '1×' : s === 0.5 ? '½×' : '¼×'}</button>)}
        </span>
        <span className="cx-speed cx-pair" role="group" aria-label="The headset's door">
          <button type="button" aria-pressed={paired} onClick={() => setPaired(true)} title="The Quest is paired with Lynx's LAN door: the crossing">Paired</button>
          <button type="button" aria-pressed={!paired} onClick={() => setPaired(false)} title="No paired door: the APK opens its bundled Kettle at home, as the judged build does">Unpaired</button>
        </span>
        <span className="cx-now">{cur.label} <i>{cur.clock}</i></span>
      </div>
      <div className="cx-track">
        <div className="cx-chips">
          {STATES.map((s) => (
            <button key={s.id} type="button" className={'cx-chip' + (s === cur ? ' on' : '') + (t >= s.at ? ' past' : '') + (s.id === 'claimed' || s.id === 'armed' ? ' r2' : '')} style={{ left: pct(s.at) }}
              onClick={() => { setPlaying(false); seek(s.show); }} title={s.clock}>{s.label}</button>
          ))}
        </div>
        <svg className="cx-lanes" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
          {LANES.map((_, i) => <line key={i} x1="0" x2="1000" y1={10 + i * 20} y2={10 + i * 20} />)}
          <rect className="blk" x={1000 * xOf(3.4)} width={1000 * (xOf(FOCUSED) - xOf(3.4))} y="0" height="80" />
          {events.map((e, i) => <circle key={i} cx={1000 * xOf(e.at)} cy={10 + e.lane * 20} r="4" className={t >= e.at ? 'on' : ''} />)}
        </svg>
        <div className="cx-lanenames">{LANES.map((l) => <span key={l}>{l}</span>)}</div>
        <div className="cx-evs">
          {events.filter((e) => e.at <= t + 0.02 && t - e.at < 3 && !events.some((o) => o.lane === e.lane && o.at > e.at && o.at <= t + 0.02)).map((e, i) => (
            <span key={i} style={{ left: pct(e.at), top: e.lane * 20 }} className={t >= e.at ? 'on' : ''}>{e.label}</span>
          ))}
        </div>
        <input className="cx-range" type="range" min={0} max={1000} step={1} value={Math.round(1000 * xOf(t))} aria-label="Crossing time" aria-valuetext={cur.label + ', ' + designClock(t)}
          onChange={(e) => { setPlaying(false); seek(tOf(+e.target.value / 1000)); }} />
        <div className="cx-head" style={{ left: pct(t) }} />
      </div>
    </footer>
  );
}
