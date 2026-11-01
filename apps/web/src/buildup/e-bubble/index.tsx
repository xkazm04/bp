'use client';
// Build-up variant E: Pencil first, the bubble diagram. A port of the contest prototype (blueprint-buildup, entry
// claude-sonnet-5-5_max-s2 variant-1) driven by the build-up event stream. The canvas engine lives in ./engine; this
// component owns its DOM (canvas + in-scene chrome) and hands it the source's events. The lab provides product, source,
// speed and replay, so the prototype's own pickers, speed and replay buttons are not here.
import { useEffect, useRef } from 'react';
import type { BuildupVariantProps } from '../contract';
import { createEngine, type Engine } from './engine';
import s from './bubble.module.css';

const LEVELS = ['Site', 'Wing', 'Room', 'Bay', 'Feature'];

export default function BubbleVariant({ source, reducedMotion, theme }: BuildupVariantProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engRef = useRef<Engine | null>(null);
  const latest = useRef({ reduced: reducedMotion, theme });
  useEffect(() => { latest.current = { reduced: reducedMotion, theme }; });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const eng = createEngine(root, latest.current);
    engRef.current = eng;
    // subscribe replays every event since the last `begin` first, so a late mount (or StrictMode's second mount) catches up
    const unsub = source.subscribe((e) => eng.push(e));
    return () => { unsub(); eng.dispose(); engRef.current = null; };
  }, [source]);
  useEffect(() => { engRef.current?.setTheme(theme); }, [theme]);
  useEffect(() => { engRef.current?.setReduced(reducedMotion); }, [reducedMotion]);

  return (
    <div ref={rootRef} className={s.root} data-reduced={reducedMotion ? '1' : '0'}>
      <canvas data-el="canvas" className={s.canvas} role="img" aria-label="The product blueprint being drafted: pencil bubbles, then walls, then tiles" />
      <div className={s.hud}>
        <div className={s.title}>
          <div className={s.sheetline}>
            <span>PROJECT <b data-el="tProj">…</b></span><i>·</i><span>DRAWING SET</span><i>·</i><span>SHEET <b data-el="tCode">A-001</b></span><i>·</i><span data-el="tName">BUBBLE DIAGRAM</span>
          </div>
          <div className={s.bigline}><h1 data-el="pname" className={s.pname}>…</h1><div data-el="stats" className={s.stats} aria-live="off" /></div>
          <nav data-el="crumb" className={s.crumb} aria-label="Where you are" hidden />
        </div>
        <div className={s.side}>
          <aside className={`${s.panel} ${s.runbox}`} aria-label="Onboarding run">
            <h2>Onboarding run</h2>
            <ol data-el="steps" className={s.steps} />
          </aside>
          <aside className={`${s.panel} ${s.viewbox}`} aria-label="View">
            <h2>View</h2>
            <div data-el="segLevel" className={s.segLevel} role="group" aria-label="Zoom level">
              {LEVELS.map((l, i) => <button key={l} type="button" data-l={i} aria-pressed={i === 0}><b>L{i}</b> {l}</button>)}
            </div>
            <div className={s.vrow}>
              <button type="button" data-el="zOut" aria-label="Zoom out" className={s.sq}>−</button>
              <button type="button" data-el="zIn" aria-label="Zoom in" className={s.sq}>+</button>
              <button type="button" data-el="btnFindOpen" aria-label="Find a feature">⌕ Find <kbd>/</kbd></button>
              <button type="button" data-el="btnFollow" className={s.follow} aria-pressed="true" title="Let the sheet's own camera lead (F)">Follow</button>
            </div>
            <div data-el="scale" className={s.scale}><i /><span>= one feature</span></div>
            <p className={s.hint}>Drag to pan, scroll to zoom, click a tile, double-click to dive in. <kbd>Space</kbd> pauses the draft.</p>
          </aside>
        </div>
        <div data-el="findbox" className={`${s.panel} ${s.findbox}`} hidden>
          <input data-el="find" className={s.find} type="text" placeholder="Find a feature, room or wing" autoComplete="off" spellCheck={false} aria-label="Find a feature, room or wing" />
          <ul data-el="results" className={s.results} role="listbox" />
        </div>
        <footer className={`${s.panel} ${s.strip}`}>
          <button type="button" data-el="btnPlay" className={s.ico} aria-label="Pause" title="Pause / play the draft (Space)">❚❚</button>
          <div data-el="time" className={s.time}>0:00</div>
          <div data-el="track" className={s.track} aria-label="Sheets drawn so far" />
          <button type="button" data-el="btnSkip" className={s.ico} aria-label="Skip to everything that has arrived" title="Skip to everything that has arrived">▸▸<span>Latest</span></button>
        </footer>
        <div data-el="tip" className={s.tip} role="tooltip" />
        <aside data-el="card" className={`${s.panel} ${s.card}`} hidden aria-live="polite" />
        <div data-el="toast" className={s.toast} role="status" />
      </div>
    </div>
  );
}
