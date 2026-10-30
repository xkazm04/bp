// The compare panel's screens: the item's before/after shot pairs (compare.ts compareOf, paired by theme and size) in
// light, dark or both, side by side, as a slider, blinking, as a change map or cropped to the changed area, with the pixel verdict above them in
// words. The theme and the mode live in the ledger store (LedgerUi.cmp, L and M cycle them); everything else is local.
// Only the shown pairs mount images; the change map of each is computed once per session by useChangeMap.
import { memo, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Comparison, ShotPair } from '@bp/core/scan/compare';
import type { Shot } from '@bp/core/scan/types';
import { shotSrc } from '@bp/core/train/shots';
import { focusCrop, pixWords } from '@bp/core/train/pixels';
import type { CompareMode, CompareTheme, CompareView } from '../../useLedger';
import { COMPARE_MODES } from '../keymap';
import { Callout, Seg, type SegOption } from '../ui/Controls';
import { ChangeMap } from './ChangeMap';
import { NoCapture, ShotFigure, ShotImg } from './ShotFigure';
import { useChangeMap, type MapState, type PairRef } from './useChangeMap';
import './Screens.css';

const THEMES: readonly SegOption<CompareTheme>[] = [{ value: 'light', label: 'light' }, { value: 'dark', label: 'dark' }, { value: 'both', label: 'both' }];
const MODES: readonly SegOption<CompareMode>[] = COMPARE_MODES;

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
        <Callout tone="empty"><span><b>No screens:</b> this scan has no shots of {fname}. The metric, the evidence and the diff below are what there is to read.</span></Callout>
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

/** One shown pair's own reading of its change map: what it can say, or why it cannot yet. */
export interface PairReading {
  label: string;
  state: 'lone' | 'error' | 'computing' | 'done';
  /** The pair's words (done), its error message (error), or what it is waiting on. */
  text: string;
  /** done only: the harness found nothing designed to differ. */
  same?: boolean;
}

/** Every shown pair read on its own, in order: a side without a capture, a failed or still-running map, or the pixel
 *  words. One pair's state never decides another's (a failed 404 on the dark shot leaves the light verdict standing). */
export function pairReadings(show: readonly ShotPair[], maps: readonly (MapState | undefined)[]): PairReading[] {
  return show.map((s, i): PairReading => {
    const label = pairLabel(s), m = maps[i];
    if (!s.before || !s.after) return { label, state: 'lone', text: 'A side has no capture. Only a pair with a before and an after can be compared.' };
    if (m?.status === 'error') return { label, state: 'error', text: m.error };
    if (m?.status === 'done') { const w = pixWords(m.grid); return { label, state: 'done', text: w.text, same: w.same }; }
    return { label, state: 'computing', text: 'comparing…' };
  });
}

/** The pixel verdict in words, one reading per shown pair; a pair that is not done says so itself and never holds back
 *  or overrules the pairs that are, and with several pairs each line names its own. */
function PixLine({ show, maps, stateLine }: { show: readonly ShotPair[]; maps: readonly (MapState | undefined)[]; stateLine: string }) {
  const rs = pairReadings(show, maps), many = rs.length > 1;
  const done = rs.filter((r) => r.state === 'done'), same = done.every((r) => r.same), partial = done.length < rs.length;
  return (
    <>
      {rs.filter((r) => r.state !== 'done').map((r) => {
        const who = many ? <b>{r.label}: </b> : null;
        if (r.state === 'lone') return <Callout key={r.label} tone="note"><span aria-hidden="true">?</span><span>{who}<b>A side has no capture.</b> Only a pair with a before and an after can be compared.</span></Callout>;
        if (r.state === 'error') return <Callout key={r.label} tone="error">{who}<b>The change map failed.</b> {r.text}</Callout>;
        return <Callout key={r.label} tone="note"><span aria-hidden="true">…</span><span>{who}comparing…</span></Callout>;
      })}
      {done.length ? (
        <Callout tone={same ? 'note' : 'diff'}>
          <span aria-hidden="true">{same ? '＝' : '≠'}</span>
          <span>
            <b>{partial ? (same ? 'The pairs compared show no designed difference.' : 'The pairs compared differ.') : same ? 'The screens show no designed difference.' : 'The screens differ.'}</b> {done.map((r) => r.label + ': ' + r.text).join(' ')}
            {same ? ` The item designs a state the harness does not reach (${stateLine}): the change is in the metric and the diff.` : null}
          </span>
        </Callout>
      ) : null}
    </>
  );
}

/** The harness's own smallest-text reading for a capture, or nothing at all: a side with no capture has no reading to
 *  report, and "min text – px" beside an empty frame reads as a measured screen that happens to have no text. */
export const minText = (s: Shot | undefined): string | undefined => {
  if (!s) return undefined;
  const v = s.report?.minTextPx;
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
  if (mode === 'focus') return <FocusPair label={label} before={b} after={a} map={map} />;
  const moved = map?.status === 'done' ? map.grid.moved.toFixed(2) + '% moved' : map?.status === 'error' ? 'failed' : 'computing…';
  return (
    <div className="tr-pair one">
      <ShotFigure cap={'Change map · ' + label + ' · after, with changed pixels marked'} aside={moved}>
        <ShotImg src={a} alt={'After, ' + label} className="dim" />
        {/* the frame reads the same three-way status as its caption: a failed map is never "computing…" (the callout says why) */}
        {map?.status === 'done' ? <ChangeMap grid={map.grid} /> : map?.status === 'error' ? <span className="tr-map-none">no change map</span> : <span className="tr-computing">computing…</span>}
      </ShotFigure>
    </div>
  );
});

/** A box in image pixels as the pixel words print it. */
const boxText = (b: readonly number[]): string => `x ${b[0]}–${b[2]}, y ${b[1]}–${b[3]}`;

/** Changed area: before and after side by side, both cropped to focusCrop's rect of the map's box (the frame places
 *  each image through --fx/--fy/--fw/--fh, ShotFigure.css .tr-scr.focus), the heat cells registered over the after.
 *  Nothing moved, a map still computing or a failed one: the two whole frames and what the map says. No animation:
 *  the crop is a still layout, so reduced motion has nothing to stop. */
export function FocusPair({ label, before, after, map }: { label: string; before: string; after: string; map: MapState | undefined }) {
  const grid = map?.status === 'done' ? map.grid : undefined, crop = grid ? focusCrop(grid) : null;
  if (!grid || !crop || !grid.bbox) {
    return (
      <div className="tr-focus-wrap">
        <div className="tr-pair">
          <ShotFigure cap={'Before · ' + label}><ShotImg src={before} alt={'Before, ' + label} /></ShotFigure>
          <ShotFigure cap={'After · ' + label} aside={map?.status === 'error' ? 'failed' : grid ? 'whole screen' : 'computing…'}>
            <ShotImg src={after} alt={'After, ' + label} />
            {!map || map.status === 'computing' ? <span className="tr-computing">computing…</span> : null}
          </ShotFigure>
        </div>
        {map?.status === 'error' ? <Callout tone="error"><b>No changed area: the change map failed.</b> {map.error}</Callout>
          : grid ? <Callout tone="note"><span aria-hidden="true">＝</span><span><b>Nothing moved</b> in {label}: both frames show the whole capture.</span></Callout> : null}
      </div>
    );
  }
  const whole = crop.w === 1 && crop.h === 1, box = boxText(grid.bbox);
  const zoom = whole ? 'whole screen' : `${+crop.zoom.toFixed(1)}× zoom`;
  const style = { '--fx': crop.x, '--fy': crop.y, '--fw': crop.w, '--fh': crop.h } as CSSProperties;
  const img = (src: string, alt: string) => <img src={src} alt={alt} className="crop" style={style} decoding="async" draggable={false} />;
  return (
    <div className="tr-focus-wrap">
      <div className="tr-pair focus">
        <ShotFigure cap={'Before · ' + label + ' · ' + box} aside={zoom} frame="focus">{img(before, 'Before, ' + label + ', the changed area')}</ShotFigure>
        <ShotFigure cap={'After · ' + label + ' · changed pixels marked'} aside={zoom} frame="focus">
          {img(after, 'After, ' + label + ', the changed area')}
          <ChangeMap grid={grid} crop={crop} />
        </ShotFigure>
      </div>
      {whole ? <Callout tone="diff"><span aria-hidden="true">≠</span><span>In {label} the change spans the whole screen ({box}): the frames show all of it.</span></Callout> : null}
    </div>
  );
}

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

/** Before and after swapping every 0.7 s (CSS); with reduced motion, a toggle shows one or the other instead — so the
 *  rate is claimed only inside .tr-blink-a, the one element that media query hides, and never in the caption. */
function Blink({ label, before, after }: { label: string; before: string; after: string }) {
  const [on, setOn] = useState(false);
  const aside = (
    <>
      <span className="tr-blink-a">before ⇄ after every 0.7 s: anything that jumps changed</span>
      <button type="button" className="tr-blink-t" aria-pressed={on} onClick={() => setOn(!on)}>{on ? 'showing after · show before' : 'showing before · show after'}</button>
    </>
  );
  return (
    <ShotFigure cap={'Blink · ' + label} aside={aside} frame={'blink' + (on ? ' after-on' : '')}>
      <ShotImg src={before} alt={'Before, ' + label} />
      <ShotImg src={after} alt={'After, ' + label} className="aft" />
    </ShotFigure>
  );
}
