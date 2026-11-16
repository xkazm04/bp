// The compare panel's screens: the item's before/after shot pairs (compare.ts compareOf, paired by theme and size) in
// light, dark or both, side by side, as a slider, blinking, as a change map or cropped to the changed area, with the pixel verdict above them in
// words. The theme and the mode live in the ledger store (LedgerUi.cmp, L and M cycle them); everything else is local.
// A rebuild (attempt_of) also offers Against: base · attempt n-1 (LedgerUi.cmp.against, compare/attempts.ts pairsFor):
// every mode then sets the previous attempt's after beside this one's, the captions naming the two attempts.
// Only the shown pairs mount images; the change map of each is computed once per session by useChangeMap.
import { memo, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Comparison, ShotPair } from '@bp/core/scan/compare';
import type { Shot } from '@bp/core/scan/types';
import { shotSrc } from '@bp/core/train/shots';
import { focusCrop, pixWords } from '@bp/core/train/pixels';
import type { CompareAgainst, CompareMode, CompareTheme, CompareView } from '../../useLedger';
import { COMPARE_MODES } from '../keymap';
import { Callout, Seg, type SegOption } from '../ui/Controls';
import { hasPrevShots, pairsFor, type Attempt } from './attempts';
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

/** What the two sides of a pair are called: `b` / `a` in captions and alt text, `tb` / `ta` as the short tags. */
export interface Sides { b: string; a: string; tb: string; ta: string }
export const BASE_SIDES: Sides = { b: 'Before', a: 'After', tb: 'Before', ta: 'After' };
/** The sides of an attempt-vs-attempt pair: attempt n's after and attempt n+1's. */
export const attemptSides = (n: number): Sides => ({ b: `Attempt ${n} · after`, a: `Attempt ${n + 1} · after`, tb: `Attempt ${n}`, ta: `Attempt ${n + 1}` });

export interface ScreensProps {
  c: Comparison;
  slug: string | null;
  view: CompareView;
  onView(v: CompareView): void;
  /** The feature's name (the no-screens callout names it). */
  fname: string;
  /** The item's designed state in one sentence (its Summary's first). */
  stateLine: string;
  /** The attempt this item rebuilds (compare/attempts.ts attemptChain's newest), or none for a first build. */
  prev?: Attempt | null;
}

export const Screens = memo(function Screens({ c, slug, view, onView, fname, stateLine, prev }: ScreensProps) {
  const eff = useMemo(() => pairsFor(c, prev, view.against), [c, prev, view.against]);
  const show = useMemo(() => shownPairs(eff.pairs, view.theme), [eff.pairs, view.theme]);
  const sides = eff.against === 'prev' && prev ? attemptSides(prev.n) : BASE_SIDES;
  // the choice exists only on a rebuild whose earlier attempt has screens; a first build never shows it
  const against = useMemo((): readonly SegOption<CompareAgainst>[] | null => (hasPrevShots(prev) && c.shots.length
    ? [{ value: 'base', label: 'base', title: 'this item’s before and after' }, { value: 'prev', label: 'attempt ' + prev.n, title: 'attempt ' + prev.n + '’s after beside this one’s' }] : null), [prev, c.shots.length]);
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
          {against ? <Seg label="Against" options={against} value={eff.against} onChange={(v) => onView({ ...view, against: v })} /> : null}
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
            {show.map((s) => <PairView key={(s.theme ?? '') + '|' + (s.size ?? '')} s={s} slug={slug} mode={view.mode} map={mapOf(s)} sides={sides} />)}
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

const PairView = memo(function PairView({ s, slug, mode, map, sides }: { s: ShotPair; slug: string | null; mode: CompareMode; map: MapState | undefined; sides: Sides }) {
  const label = pairLabel(s), b = s.before ? shotSrc(slug, s.before) : null, a = s.after ? shotSrc(slug, s.after) : null;
  if (mode === 'side' || !a || !b) {
    return (
      <div className="tr-pair">
        <ShotFigure cap={sides.b + ' · ' + label} aside={minText(s.before)} asideTitle="the harness’s own text check">
          {b ? <ShotImg src={b} alt={sides.b + ', ' + label} /> : <NoCapture what={sides.tb.toLowerCase()} />}
        </ShotFigure>
        <ShotFigure cap={sides.a + ' · ' + label} aside={minText(s.after)} asideTitle="the harness’s own text check">
          {a ? <ShotImg src={a} alt={sides.a + ', ' + label} /> : <NoCapture what={sides.ta.toLowerCase()} />}
        </ShotFigure>
      </div>
    );
  }
  if (mode === 'slider') return <div className="tr-pair one"><Slider label={label} before={b} after={a} sides={sides} /></div>;
  if (mode === 'blink') return <div className="tr-pair one"><Blink label={label} before={b} after={a} sides={sides} /></div>;
  if (mode === 'focus') return <FocusPair label={label} before={b} after={a} map={map} sides={sides} />;
  const moved = map?.status === 'done' ? map.grid.moved.toFixed(2) + '% moved' : map?.status === 'error' ? 'failed' : 'computing…';
  return (
    <div className="tr-pair one">
      <ShotFigure cap={'Change map · ' + label + ' · ' + (sides === BASE_SIDES ? 'after' : sides.a + ' against ' + sides.tb.toLowerCase()) + ', with changed pixels marked'} aside={moved}>
        <ShotImg src={a} alt={sides.a + ', ' + label} className="dim" />
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
export function FocusPair({ label, before, after, map, sides = BASE_SIDES }: { label: string; before: string; after: string; map: MapState | undefined; sides?: Sides }) {
  const grid = map?.status === 'done' ? map.grid : undefined, crop = grid ? focusCrop(grid) : null;
  if (!grid || !crop || !grid.bbox) {
    return (
      <div className="tr-focus-wrap">
        <div className="tr-pair">
          <ShotFigure cap={sides.b + ' · ' + label}><ShotImg src={before} alt={sides.b + ', ' + label} /></ShotFigure>
          <ShotFigure cap={sides.a + ' · ' + label} aside={map?.status === 'error' ? 'failed' : grid ? 'whole screen' : 'computing…'}>
            <ShotImg src={after} alt={sides.a + ', ' + label} />
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
        <ShotFigure cap={sides.b + ' · ' + label + ' · ' + box} aside={zoom} frame="focus">{img(before, sides.b + ', ' + label + ', the changed area')}</ShotFigure>
        <ShotFigure cap={sides.a + ' · ' + label + ' · changed pixels marked'} aside={zoom} frame="focus">
          {img(after, sides.a + ', ' + label + ', the changed area')}
          <ChangeMap grid={grid} crop={crop} />
        </ShotFigure>
      </div>
      {whole ? <Callout tone="diff"><span aria-hidden="true">≠</span><span>In {label} the change spans the whole screen ({box}): the frames show all of it.</span></Callout> : null}
    </div>
  );
}

/** The after clipped over the before at --cut; the range input sets the variable on the frame, React never re-renders. */
function Slider({ label, before, after, sides }: { label: string; before: string; after: string; sides: Sides }) {
  const frame = useRef<HTMLDivElement>(null);
  return (
    <ShotFigure cap={sides.tb + ' ◀ ' + label + ' ▶ ' + sides.ta.toLowerCase()} aside="drag, or ← → on the slider" frameRef={frame}>
      <ShotImg src={before} alt={sides.b + ', ' + label} />
      <ShotImg src={after} alt={sides.a + ', ' + label} className="top" />
      <span className="tr-tagb">{sides.tb}</span><span className="tr-taga">{sides.ta}</span>
      <input type="range" min="0" max="100" defaultValue="50" aria-label={'Slider: ' + sides.tb.toLowerCase() + ' on the left, ' + sides.ta.toLowerCase() + ' on the right'}
        onInput={(e) => frame.current?.style.setProperty('--cut', e.currentTarget.value + '%')} />
      <span className="tr-knob" />
    </ShotFigure>
  );
}

/** Before and after swapping every 0.7 s (CSS); with reduced motion, a toggle shows one or the other instead — so the
 *  rate is claimed only inside .tr-blink-a, the one element that media query hides, and never in the caption. */
function Blink({ label, before, after, sides }: { label: string; before: string; after: string; sides: Sides }) {
  const [on, setOn] = useState(false);
  const b = sides.tb.toLowerCase(), a = sides.ta.toLowerCase();
  const aside = (
    <>
      <span className="tr-blink-a">{b} ⇄ {a} every 0.7 s: anything that jumps changed</span>
      <button type="button" className="tr-blink-t" aria-pressed={on} onClick={() => setOn(!on)}>{on ? `showing ${a} · show ${b}` : `showing ${b} · show ${a}`}</button>
    </>
  );
  return (
    <ShotFigure cap={'Blink · ' + label + (sides === BASE_SIDES ? '' : ' · ' + sides.tb + ' ⇄ ' + a)} aside={aside} frame={'blink' + (on ? ' after-on' : '')}>
      <ShotImg src={before} alt={sides.b + ', ' + label} />
      <ShotImg src={after} alt={sides.a + ', ' + label} className="aft" />
    </ShotFigure>
  );
}
