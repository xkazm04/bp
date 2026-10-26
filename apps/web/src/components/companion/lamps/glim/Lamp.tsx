'use client';
// Glim: the lamp contest's winner (lamp-web, 2026-10-26: the "Loop" variant, under the name of another variant).
// The lamp as a pair of hands on a gantry. It hangs on a cable from a rail along the top of the sheet, parked in
// the gutter beside the Dock. What it says hangs from its wire-loop hand as a tag; a decision is a card it holds out
// with both hands; to point, it rides the rail to the place, lowers itself over it and throws its loop around it.
// The whole rig moves by transform only (the trolley translates, the cable scales, the lamp translates); idle is one
// slow composited sway of the hanging assembly.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { LampProps } from '../index';
import './lamp.css';

type Pose = { l: [number, number]; r: [number, number]; head: number };
const POSES: Record<string, Pose> = {
  idle: { l: [8, -4], r: [-14, 6], head: 0 },
  listening: { l: [6, -4], r: [-30, 40], head: -10 },
  thinking: { l: [16, -6], r: [-24, 120], head: 8 },
  speaking: { l: [6, -4], r: [-60, -10], head: -4 },
  pointing: { l: [30, -10], r: [-6, 0], head: 18 },
  working: { l: [24, -40], r: [-24, 40], head: 14 },
  asking: { l: [4, -4], r: [-4, 4], head: -8 },
};
const SAYS: Record<string, string> = { idle: 'parked', listening: 'listening', thinking: 'thinking', speaking: 'speaking', asking: 'holding a decision', pointing: 'showing you', working: 'working' };

// The lamp box: 110 x 138 px over a 120 x 150 drawing. The cable meets the hood at y 15; the hands' loops hang at y 127.
const LW = 110, LH = 138, K = LW / 120;
const HOOD_TOP = 15, LOOP_Y = 139 * K, LOOP_L = 44 * K, LOOP_R = 76 * K;
const RAIL_Y = 78;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The viewport and the chrome around the plan, in viewport px. The lamp draws in the host's unscaled layer, so the chrome's
 *  own sizes (--rw the Dock, --bb the bottom bars, in the chrome's units) are multiplied by the chrome's scale. */
function useUi(ref: React.RefObject<HTMLElement | null>) {
  const [ui, setUi] = useState({ w: 1600, h: 900, rw: 70, bb: 116 });
  useLayoutEffect(() => {
    const read = () => {
      const host = (ref.current?.ownerDocument ?? document).querySelector('.bp-ui') as HTMLElement | null;
      const u = host && host.offsetWidth ? host.getBoundingClientRect().width / host.offsetWidth : 1;
      const cs = host ? getComputedStyle(host) : null;
      const rw = (parseFloat(cs?.getPropertyValue('--rw') || '') || 70) * u;
      const bb = (parseFloat(cs?.getPropertyValue('--bb') || '') || 116) * u;
      setUi({ w: window.innerWidth, h: window.innerHeight, rw, bb });
    };
    read();
    window.addEventListener('resize', read);
    const t = window.setTimeout(read, 600); // the engine sets --rw / --bb after its first fit
    return () => { window.removeEventListener('resize', read); window.clearTimeout(t); };
  }, [ref]);
  return ui;
}

/** The lamp in flat enamel: white shell, ink outline, amber lens. viewBox 120 x 150. */
function EnamelLamp({ pose, work }: { pose: Pose; work: boolean }) {
  const arm = (side: 'l' | 'r') => {
    const sx = side === 'l' ? 44 : 76;
    const [up, fore] = pose[side];
    return (
      <g className="lp-j" style={{ transformOrigin: `${sx}px 80px`, transform: `rotate(${up}deg)` }}>
        <rect x={sx - 3.2} y={82} width={6.4} height={26} rx={3.2} className="lp-limb" />
        <g className="lp-j" style={{ transformOrigin: `${sx}px 108px`, transform: `rotate(${fore}deg)` }}>
          <g className={work ? (side === 'r' ? 'lp-knit' : 'lp-knit lp-knit-b') : undefined} style={{ transformOrigin: `${sx}px 108px` }}>
            <rect x={sx - 2.6} y={110} width={5.2} height={22} rx={2.6} className="lp-limb" />
            <ellipse cx={sx} cy={139} rx={3.8} ry={7} className="lp-loop" />
          </g>
          <circle cx={sx} cy={108} r={3.2} className="lp-joint" />
        </g>
        <circle cx={sx} cy={80} r={4} className="lp-joint" />
      </g>
    );
  };
  return (
    <svg className="lp-svg" viewBox="0 0 120 150" aria-hidden="true">
      <path d="M44 76 L76 76 Q75 88 72 98 L64 122 Q60 127 56 122 L48 98 Q45 88 44 76 Z" className="lp-shell" />
      <path d="M66 78 Q66 90 62 110 L60 122 Q64 116 70 98 Q74 88 74 78 Z" className="lp-shade" />
      <rect x={58.8} y={92} width={2.4} height={12} rx={1.2} className="lp-amber" />
      <line x1={60} y1={126} x2={60} y2={136} className="lp-pin" />
      <rect x={47} y={72} width={26} height={6} rx={3} className="lp-collar" />
      {arm('l')}
      {arm('r')}
      <g className="lp-j" style={{ transformOrigin: '60px 74px', transform: `rotate(${pose.head}deg)` }}>
        <circle cx={59} cy={44} r={28} className="lp-shell" />
        <path d="M36 32 Q46 18 62 17" className="lp-gloss" />
        <ellipse cx={64} cy={51} rx={22} ry={19} transform="rotate(-16 64 51)" className="lp-cav" />
        <circle cx={65} cy={52} r={12} className="lp-lens" />
        <circle cx={61} cy={48} r={3.4} fill="#fffdf6" />
      </g>
    </svg>
  );
}

export function GlimLamp(p: LampProps) {
  const root = useRef<HTMLDivElement>(null);
  const ui = useUi(root);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [held, setHeld] = useState<Record<string, 'approve' | 'decline'>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // the target, clipped to the plan the person can see (below the rail, left of the Dock, above the bottom bars): a room
  // at room zoom is larger than the screen, and a ring round its whole box would sit off-screen. A target that fills most
  // of the view is framed instead (the ring inset inside the view, the tag in its top-left corner); one wholly off the
  // plan is not pointed at - the host already moved the view, and the caption says where.
  const view = { l: 16, t: RAIL_Y + 34, r: ui.w - ui.rw - 16, b: ui.h - ui.bb - 8 };
  const clip = p.target && (() => {
    const l = Math.max(view.l, p.target.x), t = Math.max(view.t, p.target.y);
    const r = Math.min(view.r, p.target.x + p.target.w), b = Math.min(view.b, p.target.y + p.target.h);
    return r - l > 24 && b - t > 24 ? { l, t, r, b } : null;
  })();
  const frame = !!clip && (clip.r - clip.l) * (clip.b - clip.t) > 0.55 * (view.r - view.l) * (view.b - view.t);
  const inset = frame ? 14 : -10;
  const tx = clip ? Math.round(clip.l + inset) : 0, ty = clip ? Math.round(clip.t + inset) : 0;
  const tw = clip ? Math.round(clip.r - clip.l - 2 * inset) : 0, th = clip ? Math.round(clip.b - clip.t - 2 * inset) : 0;
  const pointing = p.state === 'pointing' && !!clip;

  // where the rig is: parked in the gutter left of the Dock, or over the target
  const homeX = ui.w - ui.rw - 86;
  const homeDrop = 62;
  const drop = pointing
    ? clamp(ty - 18 - (LOOP_Y - HOOD_TOP) - RAIL_Y, 24, ui.h - 300)
    : p.state === 'asking' ? homeDrop + 30 : p.state === 'listening' || p.state === 'working' ? homeDrop + 16 : homeDrop;
  // over the target the reaching (right) hand sits above the ring's centre
  const x = pointing ? clamp(tx + tw / 2 - (LOOP_R - LW / 2), 220, homeX) : homeX;

  // a swing on arrival: re-keyed whenever the rig's resting place changes
  const place = `${Math.round(x)}:${Math.round(drop)}`;
  const [swing, setSwing] = useState(0);
  const lastPlace = useRef(place);
  useEffect(() => { if (lastPlace.current !== place) { lastPlace.current = place; setSwing((n) => n + 1); } }, [place]);

  const pose = POSES[p.state] ?? POSES.idle;
  const card = p.state === 'asking' ? p.cards.find((c) => c.state === 'pending' && !held[c.id]) : undefined;
  const done = p.state === 'asking' ? p.cards.find((c) => held[c.id]) : undefined;
  const showInput = open || p.state === 'listening';
  const tagText = !pointing && !card && !showInput && p.caption && p.state !== 'idle' ? p.caption : null;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    p.onSubmit(t);
    setText('');
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') { setOpen(false); setText(''); }
  };
  const decide = (id: string, d: 'approve' | 'decline') => { setHeld((m) => ({ ...m, [id]: d })); p.onCard(id, d); };

  // the rail shows only the run between home and the rig, so it never draws across the header's ticker at rest
  const railLen = Math.max(60, homeX + 40);
  const railScale = clamp((homeX - x + 70) / railLen, 0, 1);

  return (
    <div className="glim" ref={root} data-state={p.state}>
      <div className="lp-rail" style={{ top: RAIL_Y, left: homeX + 40 - railLen, width: railLen, transform: `scaleX(${railScale})` }} />

      <AnimatePresence>
        {pointing && (
          <motion.div key="ring" className={'lp-ring' + (frame ? ' lp-ring-frame' : '')} style={{ left: tx, top: ty, width: tw, height: th }}
            initial={{ opacity: 0, scale: 0.15 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ delay: 1.0, type: 'spring', stiffness: 170, damping: 15 }}>
            <i />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {pointing && p.caption && (
          <motion.div key="ptag" className="lp-tag lp-ptag" role="status"
            style={frame ? { left: Math.max(tx + 18, tx + tw - 330 - 18), top: ty + 18 }
              : { left: tx + tw + 30 + 330 < view.r ? tx + tw + 30 : Math.max(16, tx - 360), top: clamp(ty - 4, view.t, ui.h - ui.bb - 120) }}
            initial={{ opacity: 0, rotate: -8, y: -10 }} animate={{ opacity: 1, rotate: -1.5, y: 0 }} exit={{ opacity: 0 }}
            transition={{ delay: 1.3, type: 'spring', stiffness: 140, damping: 11 }}>
            <span className="lp-eyelet" />
            <span className="lp-who">GLIM · showing you</span>
            {p.caption}
          </motion.div>
        )}
      </AnimatePresence>

      {/* the rig: the trolley rides the rail; the hanging assembly (cable, lamp, what it holds) swings below it */}
      <div className="lp-rig" style={{ top: RAIL_Y, transform: `translateX(${x}px)` }}>
        <div className="lp-trolley" />
        <div className={'lp-hang' + (swing ? (swing % 2 ? ' lp-arrive-a' : ' lp-arrive-b') : '')}>
          <div className="lp-sway">
            <div className="lp-cable" style={{ transform: `scaleY(${drop - HOOD_TOP + 4})` }} />
            <div className="lp-body" style={{ transform: `translateY(${drop - HOOD_TOP}px)` }}>
              <button type="button" className="lp-lamp" data-lamp-toggle onClick={() => setOpen((o) => !o)} aria-label={`Glim, the companion lamp: ${SAYS[p.state]}. Click to write it a note.`}>
                <div className="lp-turn"><EnamelLamp pose={pose} work={p.state === 'working'} /></div>
                <span className="lp-glow" />
              </button>
              {/* the reaching hand's wire runs down to the ring */}
              {pointing && <div className="lp-wire" style={{ left: LOOP_R, top: LOOP_Y + 6, height: 14 }} />}

              {/* resting: the name tag on the left hand */}
              <AnimatePresence>
                {p.state === 'idle' && !open && (
                  <motion.div key="name" className="lp-name" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ left: LOOP_L - 30, top: LOOP_Y + 14 }}>
                    <span className="lp-string" />GLIM
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="popLayout">
                {tagText && (
                  <motion.div key="tag" className="lp-tag" role="status" aria-live="polite" style={{ right: LW - LOOP_L - 18, top: LOOP_Y + 22 }}
                    initial={{ opacity: 0, rotate: 6, y: -12 }} animate={{ opacity: 1, rotate: 1.5, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={{ type: 'spring', stiffness: 160, damping: 12 }}>
                    <span className="lp-string lp-string-tag" />
                    <span className="lp-eyelet" />
                    <span className="lp-who">GLIM · {SAYS[p.state]}</span>
                    {tagText}
                    {p.state === 'working' && <span className="lp-work"><i /><i /><i /><i /><i /></span>}
                  </motion.div>
                )}
                {!tagText && p.state === 'thinking' && (
                  <motion.div key="think" className="lp-tag lp-tag-s" style={{ right: LW - LOOP_L - 18, top: LOOP_Y + 22 }}
                    initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <span className="lp-string lp-string-tag" />
                    <span className="lp-who">GLIM · thinking</span>
                    <span className="lp-dots"><i /><i /><i /></span>
                  </motion.div>
                )}
                {showInput && !card && (
                  <motion.div key="in" className="lp-tag lp-tag-in" style={{ right: LW - LOOP_L - 18, top: LOOP_Y + 22 }}
                    initial={{ opacity: 0, rotate: 5, y: -12 }} animate={{ opacity: 1, rotate: 0.5, y: 0 }} exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 160, damping: 13 }}>
                    <span className="lp-string lp-string-tag" />
                    <span className="lp-who">{p.state === 'listening' && p.caption ? 'HEARD' : 'WRITE ON MY TAG'}</span>
                    {p.state === 'listening' && p.caption && <p className="lp-heard">{p.caption}</p>}
                    <input ref={inputRef} data-composer value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Ask Glim, or name a place…" aria-label="Write to Glim" />
                  </motion.div>
                )}
                {(card || done) && (
                  <motion.div key="card" className="lp-card" role="group" aria-label="A decision Glim is holding out" style={{ left: LOOP_L - 296, top: LOOP_Y + 24 }}
                    initial={{ opacity: 0, y: -24, rotate: -3 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, y: 12 }}
                    transition={{ type: 'spring', stiffness: 150, damping: 13 }}>
                    <span className="lp-hold" style={{ left: 296 - 1 }} />
                    <span className="lp-hold" style={{ left: 296 + (LOOP_R - LOOP_L) - 1 }} />
                    {card ? (
                      <>
                        {p.caption && p.caption !== card.summary && <h3>{p.caption}</h3>}
                        <div className="lp-card-k">DECISION{card.product ? ` · ${card.product}` : ''} · <code>{card.tool}</code></div>
                        <p>{card.summary}</p>
                        <div className="lp-card-b">
                          <button type="button" className="lp-yes" onClick={() => decide(card.id, 'approve')}>Approve</button>
                          <button type="button" className="lp-no" onClick={() => decide(card.id, 'decline')}>Decline</button>
                        </div>
                      </>
                    ) : done ? (
                      <div className="lp-done">{held[done.id] === 'approve' ? 'Approved. Glim carries it to the builders.' : 'Declined. Glim puts it down.'}</div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
