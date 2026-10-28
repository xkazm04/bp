// The crossing of "The Desk Becomes the Table" as one clock. Every state and every scene value is a pure function of the
// demo time t (seconds), so the demo plays, scrubs and steps with the same code. From FOCUSED on, the times are the
// design's own (t 0.0 headset session FOCUSED, +0.8 baton claimed, +1.0..+2.0 the paper lifts, +2.0..+2.8 the room fades,
// +2.7 the lamp names the place); before it, the arm is the person's (any time within the baton's 120 s) and the blackout
// of putting the headset on is the person's too (3-5 s, drawn as 3.2 s here). Nothing here moves the view: only content.

export type StateId = 'desk' | 'armed' | 'blackout' | 'passthrough' | 'claimed' | 'lift' | 'fade' | 'arrived' | 'live' | 'return';

export interface CrossState {
  id: StateId;
  /** Demo seconds at which the state begins. */
  at: number;
  label: string;
  /** The design's own clock for the state. */
  clock: string;
  /** Where a step or a click on the state lands: inside it, once its picture has formed. */
  show: number;
}

/** FOCUSED: the headset session is up, the first frame after the blackout. Design t 0.0. */
export const FOCUSED = 6.6;
export const END = 18.5;

export const STATES: readonly CrossState[] = [
  { id: 'desk', at: 0, label: 'At the desk', clock: 'T-n', show: 0.4 },
  { id: 'armed', at: 1.4, label: 'Baton armed', clock: 'T-n, 120 s TTL', show: 2.0 },
  { id: 'blackout', at: 3.4, label: 'Headset on', clock: '3-5 s blackout', show: 4.6 },
  { id: 'passthrough', at: FOCUSED, label: 'Passthrough', clock: 't 0.0', show: FOCUSED + 0.4 },
  { id: 'claimed', at: FOCUSED + 0.8, label: 'Claimed', clock: 't 0.8', show: FOCUSED + 0.95 },
  { id: 'lift', at: FOCUSED + 1.0, label: 'Paper lifts', clock: 't 1.0', show: FOCUSED + 1.55 },
  { id: 'fade', at: FOCUSED + 2.0, label: 'Room fades', clock: 't 2.0', show: FOCUSED + 2.45 },
  { id: 'arrived', at: FOCUSED + 2.7, label: 'Lamp names it', clock: 't 2.7', show: FOCUSED + 3.6 },
  { id: 'live', at: 11.4, label: 'Table leads', clock: 'while in VR', show: 13.2 },
  { id: 'return', at: 14.6, label: 'Headset off', clock: 'any time', show: 15.8 },
];

export function stateAt(t: number): CrossState {
  let s = STATES[0];
  for (const x of STATES) if (t >= x.at - 1e-6) s = x;
  return s;
}
export function stateIndex(t: number): number { return STATES.indexOf(stateAt(t)); }

/** The design clock shown on the stage: before FOCUSED the person's time, after it t relative to FOCUSED. */
export function designClock(t: number): string {
  if (t < STATES[2].at) return 'T-n · at the desk';
  if (t < FOCUSED) return 'blackout · ' + (t - STATES[2].at).toFixed(1) + ' s';
  if (t < STATES[9].at) return 't ' + (t - FOCUSED).toFixed(2) + ' s';
  return 'headset off';
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** BpSwitch.cpp's ease: smoothstep. */
export const smooth = (a: number, b: number, t: number) => { const x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); };

export interface Scene {
  /** The flat page fills the view (before the headset, and after it comes off). */
  page: number;
  /** The headset's blackout: nothing is drawn. */
  black: number;
  /** Passthrough: the real room through the 3S cameras. */
  pass: number;
  /** The night studio around the table. */
  studio: number;
  /** The paper's pose: 0 on the pinned monitor, 1 on the desk. */
  lift: number;
  /** The paper becomes the table: the page crossfades into the table's plan. */
  table: number;
  /** The rooms rise out of the glass. */
  rise: number;
  /** The lamp and its caption. */
  lamp: number; caption: number;
  /** The wrist peek: a passthrough window cut over the pinned monitor. */
  peek: number;
  /** The table moved to the next place (the table leads, the page follows). */
  moved: number;
  /** The crumb the page keeps for 10 s after the headset comes off. */
  crumb: number;
  /** The baton's state. */
  baton: 'none' | 'armed' | 'claimed' | 'live' | 'returned';
}

export function sceneAt(t: number): Scene {
  const F = FOCUSED, off = STATES[9].at;
  const black = Math.max(smooth(3.4, 3.75, t) * (1 - smooth(F - 0.25, F, t)), smooth(off, off + 0.25, t) * (1 - smooth(off + 0.35, off + 0.7, t)));
  return {
    page: t < 4 ? 1 : t >= off + 0.3 ? 1 : 0,
    black,
    pass: t >= F - 0.3 && t < off + 0.3 ? 1 - smooth(F + 2.0, F + 2.8, t) : 0,
    studio: t < off + 0.3 ? smooth(F + 2.0, F + 2.8, t) : 0,
    lift: smooth(F + 1.0, F + 2.0, t),
    table: smooth(F + 1.9, F + 2.6, t),
    rise: smooth(F + 2.2, F + 3.1, t),
    lamp: smooth(F + 2.1, F + 2.7, t),
    caption: smooth(F + 2.7, F + 2.95, t),
    peek: smooth(12.6, 12.9, t) * (1 - smooth(14.0, 14.3, t)),
    moved: smooth(11.9, 12.5, t),
    crumb: t >= off + 0.3 ? 1 - smooth(END - 0.6, END, t) : 0,
    baton: t < 1.4 ? 'none' : t < F + 0.8 ? 'armed' : t < F + 2.0 ? 'claimed' : t < off ? 'live' : 'returned',
  };
}
