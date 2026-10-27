// The one time-slider contract of the strip's hairline (timeline/Strip.tsx) and the panel's revisions chart (BaseBar.tsx):
// the scrub geometry from each slider's zones, the inert rule, the slider ARIA and the still title, the sim transport's
// status and play button, and each slider's Escape. Both render from this (through shared.ts useTimeSlider), so a slider
// rule is one edit here. Pure and React-free (no '@/' imports, no parameter properties) so Node runs check-slider.ts on it.
import { dnum, revAt } from '@bp/core/model/aggregates';
import { canTravel, valueText, type ScrubGeom } from './scrub.ts';

/** A slider's zones in its own svg units: the history axis h0..h1 and the hour ahead o0..o1. */
export interface SliderZones { h0: number; h1: number; o0: number; o1: number }

/** The scrub geometry for a slider's zones: the one builder both sliders use. */
export function sliderGeom(weeks: readonly string[], asOf: string, hour: boolean, z: SliderZones): ScrubGeom {
  const dn = weeks.map(dnum);
  return { h0: z.h0, h1: z.h1, o0: z.o0, o1: z.o1, hour, d0: dn[0] ?? dnum(asOf), d1: dnum(asOf), weeks, dn, asOf };
}

/** The inert rule: a slider with one week of history and no hour ahead has nowhere to go. */
export const sliderStill = (weeks: readonly string[], hour: boolean) => !canTravel(weeks) && !hour;
export const STILL_TITLE = 'One week of history: nothing earlier to travel to yet';

export interface SliderAria {
  role: 'slider'; tabIndex: 0; 'aria-valuemin': 1; 'aria-valuemax': number; 'aria-valuenow': number; 'aria-valuetext': string;
  'data-still'?: ''; 'aria-disabled'?: true;
}
export interface SliderModel { now: boolean; rev: number; still: boolean; valueText: string; aria: SliderAria; stillTitle?: string }

/** Where a slider stands at time `t`, and what it announces. */
export function sliderModel(s: { weeks: readonly string[]; asOf: string; t: string; hour: boolean; summary?: string }): SliderModel {
  const now = s.t === s.asOf, rev = revAt(s.weeks as string[], s.t), still = sliderStill(s.weeks, s.hour);
  const vt = valueText(now, rev, s.t, s.weeks.length, s.hour, s.summary);
  const aria: SliderAria = { role: 'slider', tabIndex: 0, 'aria-valuemin': 1, 'aria-valuemax': s.weeks.length, 'aria-valuenow': rev, 'aria-valuetext': vt };
  if (still) { aria['data-still'] = ''; aria['aria-disabled'] = true; }
  return still ? { now, rev, still, valueText: vt, aria, stillTitle: STILL_TITLE } : { now, rev, still, valueText: vt, aria };
}

/** The sim transport (idle -> playing <-> paused -> ended; travelled = history) as both clocks word it: `short` on the
 *  strip, `long` in the panel, and the play button's glyph and label naming what Space / the button actually does
 *  (Engine.togglePlay returns to now when travelled; the sim replays the hour when it is over). */
export type TransportState = 'idle' | 'history' | 'ended' | 'playing' | 'paused';
export interface Transport { state: TransportState; short: string; long: string; tone: '' | 'on' | 'warn'; play: { glyph: string; label: string } }
export function transport(s: { has: boolean; live: boolean; now: boolean; playing: boolean; over: boolean; speed: number }): Transport {
  if (!s.has || s.live) return { state: 'idle', short: '', long: '', tone: '', play: { glyph: '▶', label: 'Play the swarm (Space)' } };
  if (!s.now) return { state: 'history', short: 'HISTORY', long: 'HISTORY · PAUSED', tone: 'warn', play: { glyph: '▶', label: 'Back to now (Space)' } };
  if (s.over) return { state: 'ended', short: 'ENDED', long: 'ENDED', tone: '', play: { glyph: '▶', label: 'Replay the hour (Space)' } };
  if (s.playing) return { state: 'playing', short: '● ×' + s.speed, long: '● LIVE · ×' + s.speed, tone: 'on', play: { glyph: '❚❚', label: 'Pause the swarm (Space)' } };
  return { state: 'paused', short: 'PAUSED', long: 'PAUSED', tone: '', play: { glyph: '▶', label: 'Play the swarm (Space)' } };
}

/** The two sliders, as data: whether a press stops at the slider (the strip sits in a click-to-expand bar) and the
 *  Escape ladder, first matching step wins. */
export type SliderKind = 'strip' | 'panel';
export type EscapeAction = 'collapse' | 'back-to-now' | 'blur';
type EscState = { tl: boolean; now: boolean };
export const SLIDERS: Record<SliderKind, { stop: boolean; escape: readonly (readonly [EscapeAction, (s: EscState) => boolean])[] }> = {
  strip: { stop: true, escape: [['collapse', (s) => s.tl], ['back-to-now', (s) => !s.now], ['blur', () => true]] },
  panel: { stop: false, escape: [['collapse', () => true]] },
};
export function escapeAction(kind: SliderKind, s: Partial<EscState>): EscapeAction {
  const st = { tl: !!s.tl, now: s.now ?? true };
  return SLIDERS[kind].escape.find(([, when]) => when(st))?.[0] ?? 'blur';
}
