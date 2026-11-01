'use client';
// Build-up variant A: Axonometric Raise (contest blueprint-buildup shortlist A1), ported from its prototype. The scene is
// one canvas drawn by an imperative engine (./engine.ts); this component renders the prototype's chrome (sheet header,
// pipeline strip, key plan, legend, detail card, find) and feeds the engine the source's events. Nothing here loads the
// plan: the engine draws only what has arrived.
import { useEffect, useRef } from 'react';
import type { BuildupVariantProps } from '../contract';
import { createEngine, type Engine } from './engine';
import css from './axo.module.css';

export default function AxonometricRaise({ source, reducedMotion, theme }: BuildupVariantProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const engine = createEngine(root, { reducedMotion: reducedRef.current, kind: source.kind });
    engineRef.current = engine;
    // subscribe replays every event since the last `begin` first, so a late mount catches up
    const off = source.subscribe((e) => engine.feed(e));
    return () => { off(); engine.destroy(); engineRef.current = null; };
  }, [source]);

  useEffect(() => { engineRef.current?.setReduced(reducedMotion); }, [reducedMotion]);
  useEffect(() => { engineRef.current?.retheme(); }, [theme]);

  return (
    <div ref={rootRef} className={css.root}>
      <canvas data-r="cv" className={css.cv} aria-label="Product blueprint" role="img" />
      <div className={css.scrimTop} />
      <header className={css.hd}>
        <div data-r="sheetline" className={`${css.sheetline} ${css.mono}`} />
        <div className={css.titlerow}><h1 data-r="pname" className={css.pname} /><div data-r="psum" className={css.psum} /></div>
        <div data-r="crumbs" className={css.crumbs} />
      </header>
      <div data-r="legend" className={css.legend} aria-label="Legend" />
      <canvas data-r="keyplan" className={css.keyplan} aria-label="Key plan: click to move there" />
      <div data-r="kpcap" className={`${css.kpcap} ${css.mono}`}>KEY PLAN</div>
      <aside data-r="detail" className={css.detail} hidden />
      <div data-r="tip" className={css.tip} hidden />
      <div data-r="hint" className={`${css.hint} ${css.mono}`}>Drag to look around · results land in pipeline order</div>
      <div data-r="find" className={css.find} hidden>
        <input data-r="q" className={css.q} type="text" placeholder="Find a feature, room or wing" autoComplete="off" aria-label="Find" />
        <ol data-r="res" className={css.res} />
      </div>
      <footer data-r="strip" className={css.strip}>
        <div data-r="steps" className={css.steps} />
        <div data-r="levels" className={css.levels}>
          <div className={css.seg}><button type="button" data-r="zOut" aria-label="Zoom out">−</button><button type="button" data-r="zIn" aria-label="Zoom in">+</button></div>
          <span className={css.lab}>LEVEL</span>
          <div className={css.seg}>
            <button type="button" data-l="0">L0 Site</button><button type="button" data-l="1">L1 Wing</button><button type="button" data-l="2">L2 Room</button>
            <button type="button" data-l="3">L3 Bay</button><button type="button" data-l="4">L4 Feature</button>
          </div>
          <div className={css.seg}>
            <button type="button" data-r="bFind">Find<kbd>/</kbd></button><button type="button" data-r="bRaise">Raise 3D<kbd>3</kbd></button>
          </div>
          <div className={`${css.scalebar} ${css.mono}`}><i data-r="sbar" /><span>= one feature</span></div>
        </div>
        <div className={css.runline}><span data-r="log" className={css.log} /><span data-r="clock" className={`${css.clock} ${css.mono}`} /></div>
      </footer>
    </div>
  );
}
