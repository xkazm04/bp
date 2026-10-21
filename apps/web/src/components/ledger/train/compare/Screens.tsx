// The compare panel's screens: the item's before/after shot pairs (compare.ts compareOf, paired by theme and size) in
// light, dark or both, side by side, as a slider, blinking or as a change map, with the pixel verdict above them in
// words. The theme and the mode live in the ledger store (LedgerUi.cmp, L and M cycle them); everything else is local.
// Only the shown pairs mount images; the change map of each is computed once per session by useChangeMap.
import { memo, useMemo, useRef, useState } from 'react';
import type { Comparison, ShotPair } from '@bp/core/scan/compare';
import type { Shot } from '@bp/core/scan/types';
import { shotSrc } from '@bp/core/train/shots';
import { pixWords } from '@bp/core/train/pixels';
import type { CompareMode, CompareTheme, CompareView } from '../../useLedger';
import { Callout, Seg, type SegOption } from '../ui/Controls';
import { ChangeMap } from './ChangeMap';
import { NoCapture, ShotFigure, ShotImg } from './ShotFigure';
import { useChangeMap, type MapState, type PairRef } from './useChangeMap';
import './Screens.css';

const THEMES: readonly SegOption<CompareTheme>[] = [{ value: 'light', label: 'light' }, { value: 'dark', label: 'dark' }, { value: 'both', label: 'both' }];
const MODES: readonly SegOption<CompareMode>[] = [
  { value: 'side', label: 'Side by side' }, { value: 'slider', label: 'Slider' }, { value: 'blink', label: 'Blink' }, { value: 'map', label: 'Change map' },
];

/** The pairs a theme choice shows: that theme's, every pair for `both`, and every pair when none has the theme. */
export function shownPairs(pairs: readonly ShotPair[], theme: CompareTheme): ShotPair[] {
  const pick = pairs.filter((s) => theme === 'both' || s.theme === theme);
  return pick.length ? pick : [...pairs];
}

/** What the panel calls a pair: its theme and its size. An item captured at two sizes in one theme is two pairs, and
 *  without the size every caption, alt text and pixel line of the two reads identically. */
export const pairLabel = (s: Pick<ShotPair, 'theme' | 'size'>): string => (s.theme ?? 'screen') + (s.size ? ' · ' + s.size : '');

/** The change-map cache key of a pair (the product, then the two shot ids), or null when a side is missing. */
export const pairKey = (slug: string | null, s: ShotPair): string | null => (s.before && s.after ? `${slug ?? 'kettle'}:${s.before.id}:${s.after.id}` : null);

export interface ScreensProps {
  c: Comparison;
  slug: string | null;
  view: CompareView;
  onView(v: CompareView): void;
  /** The feature's name (the no-screens callout names it). */
  fname: string;
  /** The item's designed state in one sentence (its Summary's first). */
  stateLine: string;
}

export const Screens = memo(function Screens({ c, slug, view, onView, fname, stateLine }: ScreensProps) {
  const show = useMemo(() => shownPairs(c.shots, view.theme), [c.shots, view.theme]);
  const refs = useMemo(() => show.flatMap((s): PairRef[] => {
    const key = pairKey(slug, s);
    return key && s.before && s.after ? [{ key, before: shotSrc(slug, s.before), after: shotSrc(slug, s.after) }] : [];
  }), [show, slug]);
  const maps = useChangeMap(refs);
  const mapOf = (s: ShotPair): MapState | undefined => { const k = pairKey(slug, s), i = refs.findIndex((r) => r.key === k); return i < 0 ? undefined : maps[i]; };

  return (
    <section className="tr-sec" data-role="tr-cmp-screens">
      <h4>Screens
        <span className="r">
          <Seg label="Theme" options={THEMES} value={view.theme} onChange={(theme) => onView({ ...view, theme })} />
          <Seg label="Compare mode" options={MODES} value={view.mode} onChange={(mode) => onView({ ...view, mode })} />
        </span>
      </h4>
      {!c.shots.length ? (
        <Callout tone="empty"><span><b>No screens:</b> the harness cannot render this feature ({fname}). Judge it by the metric, the evidence and the diff below.</span></Callout>
      ) : (
        <>
          <PixLine show={show} maps={show.map(mapOf)} stateLine={stateLine} />
          <div className="tr-pairs">
            {show.map((s) => <PairView key={(s.theme ?? '') + '|' + (s.size ?? '')} s={s} slug={slug} mode={view.mode} map={mapOf(s)} />)}
          </div>
        </>
      )}
    </section>
  );
});

/** The pixel verdict in words, over every shown pair; "comparing…" until each is computed, never a guess. */
function PixLine({ show, maps, stateLine }: { show: readonly ShotPair[]; maps: readonly (MapState | undefined)[]; stateLine: string }) {
  const lone = show.some((s) => !s.before || !s.after);
  if (lone) return <Callout tone="note"><span aria-hidden="true">?</span><span><b>A side has no capture.</b> Only a pair with a before and an after can be compared.</span></Callout>;
  const err = maps.find((m) => m?.status === 'error');
  if (err && err.status === 'error') return <Callout tone="error"><b>The change map failed.</b> {err.error}</Callout>;
  const done = maps.every((m) => m?.status === 'done');
  if (!done) return <Callout tone="note"><span aria-hidden="true">…</span><span>comparing…</span></Callout>;
  const words = show.map((s, i) => { const m = maps[i]; return m?.status === 'done' ? { label: pairLabel(s), ...pixWords(m.grid) } : null; }).filter((w) => w !== null);
  const same = words.every((w) => w.same), text = words.map((w) => w.label + ': ' + w.text).join(' ');
  return (
    <Callout tone={same ? 'note' : 'diff'}>
      <span aria-hidden="true">{same ? '＝' : '≠'}</span>
      <span>
        <b>{same ? 'The screens show no designed difference.' : 'The screens differ.'}</b> {text}
        {same ? ` The item designs a state the harness does not reach (${stateLine}): the change is in the metric and the diff.` : null}
      </span>
    </Callout>
  );
}

const minText = (s: Shot | undefined): string => {
  const v = s?.report?.minTextPx;
  return 'min text ' + (typeof v === 'number' ? v : '–') + ' px';
};

const PairView = memo(function PairView({ s, slug, mode, map }: { s: ShotPair; slug: string | null; mode: CompareMode; map: MapState | undefined }) {
  const label = pairLabel(s), b = s.before ? shotSrc(slug, s.before) : null, a = s.after ? shotSrc(slug, s.after) : null;
  if (mode === 'side' || !a || !b) {
    return (
      <div className="tr-pair">
        <ShotFigure cap={'Before · ' + label} aside={minText(s.before)} asideTitle="the harness’s own text check">
          {b ? <ShotImg src={b} alt={'Before, ' + label} /> : <NoCapture what="before" />}
        </ShotFigure>
        <ShotFigure cap={'After · ' + label} aside={minText(s.after)} asideTitle="the harness’s own text check">
          {a ? <ShotImg src={a} alt={'After, ' + label} /> : <NoCapture what="after" />}
        </ShotFigure>
      </div>
    );
  }
  if (mode === 'slider') return <div className="tr-pair one"><Slider label={label} before={b} after={a} /></div>;
  if (mode === 'blink') return <div className="tr-pair one"><Blink label={label} before={b} after={a} /></div>;
  const moved = map?.status === 'done' ? map.grid.moved.toFixed(2) + '% moved' : map?.status === 'error' ? 'failed' : 'computing…';
  return (
    <div className="tr-pair one">
      <ShotFigure cap={'Change map · ' + label + ' · after, with changed pixels marked'} aside={moved}>
        <ShotImg src={a} alt={'After, ' + label} className="dim" />
        {map?.status === 'done' ? <ChangeMap grid={map.grid} /> : <span className="tr-computing">computing…</span>}
      </ShotFigure>
    </div>
  );
});

/** The after clipped over the before at --cut; the range input sets the variable on the frame, React never re-renders. */
function Slider({ label, before, after }: { label: string; before: string; after: string }) {
  const frame = useRef<HTMLDivElement>(null);
  return (
    <ShotFigure cap={'Before ◀ ' + label + ' ▶ after'} aside="drag, or ← → on the slider" frameRef={frame}>
      <ShotImg src={before} alt={'Before, ' + label} />
      <ShotImg src={after} alt={'After, ' + label} className="top" />
      <span className="tr-tagb">Before</span><span className="tr-taga">After</span>
      <input type="range" min="0" max="100" defaultValue="50" aria-label="Slider: before on the left, after on the right"
        onInput={(e) => frame.current?.style.setProperty('--cut', e.currentTarget.value + '%')} />
      <span className="tr-knob" />
    </ShotFigure>
  );
}

/** Before and after swapping every 0.7 s (CSS); with reduced motion, a toggle shows one or the other instead. */
function Blink({ label, before, after }: { label: string; before: string; after: string }) {
  const [on, setOn] = useState(false);
  const aside = (
    <>
      <span className="tr-blink-a">anything that jumps changed</span>
      <button type="button" className="tr-blink-t" aria-pressed={on} onClick={() => setOn(!on)}>{on ? 'showing after · show before' : 'showing before · show after'}</button>
    </>
  );
  return (
    <ShotFigure cap={'Blink · ' + label + ' · before ⇄ after every 0.7 s'} aside={aside} frame={'blink' + (on ? ' after-on' : '')}>
      <ShotImg src={before} alt={'Before, ' + label} />
      <ShotImg src={after} alt={'After, ' + label} className="aft" />
    </ShotFigure>
  );
}
