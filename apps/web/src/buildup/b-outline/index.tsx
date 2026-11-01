'use client';
// Build-up variant B: The outline becomes the building (contest blueprint-buildup, o3 variant-1), ported to the build-up
// contract. React renders the prototype's static chrome; the canvas engine (engine.ts) draws the outline and the plan and
// fills the chrome imperatively, driven only by the source's events.
import { useEffect, useRef } from 'react';
import type { BuildupVariantProps } from '../contract';
import { createOutlineEngine, type OutlineEngine } from './engine';
import styles from './outline.module.css';

export default function Variant({ source, reducedMotion, theme }: BuildupVariantProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engRef = useRef<OutlineEngine | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const eng = createOutlineEngine(root, styles);
    engRef.current = eng;
    const off = source.subscribe((e) => eng.onEvent(e));
    return () => { off(); eng.destroy(); engRef.current = null; };
  }, [source]);
  // declared after the engine's effect, so on mount they run after it and hand it the current values
  useEffect(() => { engRef.current?.setReduced(reducedMotion); }, [reducedMotion, source]);
  useEffect(() => { engRef.current?.setTheme(); }, [theme, source]);

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={styles.bar} role="toolbar" aria-label="Plan tools">
        <div className={styles.brand}><b>bp</b> · onboarding · sheet G-001 · general arrangement</div>
        <div className={styles.spacer} />
        <div className={styles.findWrap}>
          <input data-r="find" className={styles.find} type="search" placeholder="Find a feature, room or wing" aria-label="Find" autoComplete="off" />
          <span className={styles.findKey}>/</span>
          <div data-r="results" className={styles.results} role="listbox" />
        </div>
      </div>
      <canvas data-r="cv" className={styles.cv} aria-label="Blueprint plan" role="img" />
      <div data-r="head" className={styles.head} aria-live="polite" />
      <button type="button" data-r="rail" className={styles.rail} title="Open the outline index (O)"><span>OUTLINE ▸</span></button>
      <nav data-r="index" className={styles.index} aria-label="Outline index">
        <header>
          <h2>Outline · the words that built it</h2>
          <button type="button" data-r="idxClose" className={styles.btn} title="Close (O)">✕</button>
        </header>
        <ol data-r="idxList" />
      </nav>
      <div data-r="crumbs" className={styles.crumbs} aria-label="Where you are" />
      <div data-r="zoom" className={styles.zoom}>
        <button type="button" data-r="zOut" className={styles.btn} title="Zoom out (-)">−</button>
        <button type="button" data-r="zFit" className={styles.btn} title="Whole site (0)">Site</button>
        <button type="button" data-r="zIn" className={styles.btn} title="Zoom in (+)">+</button>
      </div>
      <aside data-r="card" className={styles.card} aria-live="polite" />
      <div data-r="tip" className={styles.tip} />
      <div data-r="toast" className={styles.toast} />
      <div className={styles.scrub}>
        <div data-r="track" className={styles.track} role="group" aria-label="Pipeline steps" />
        <div data-r="clock" className={styles.clock} />
      </div>
      <p data-r="live" className={styles.sr} aria-live="polite" />
    </div>
  );
}
