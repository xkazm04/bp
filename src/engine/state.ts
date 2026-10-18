// Discrete UI state held in the external store. Only things that change on a click, a key or a
// simulation event live here; continuous values (camera, clock, hover position, mix) stay in the engine.
import type { ViewId } from '@/lib/data';
import type { Preview, SimEvent, SimToast, Target } from '@/lib/model';
import type { LivePlan } from '@/lib/model/live-steer';

/** The right-hand rail's items; each opens its own flyout over the plan. */
export type DockTab = 'asks' | 'swarm' | 'orders' | 'plan' | 'find' | 'view' | 'steer';
export interface Crumb { t: 'bld' | 'wing' | 'room' | 'bay'; id: string }
/** `track`: a live answer's marker on its tile (`id` = the proposal id). */
export interface HoverInfo { type: 'tile' | 'bld' | 'wing' | 'room' | 'bay' | 'agent' | 'pin' | 'track'; id: string; ids?: string[] }
export interface ToastItem extends SimToast { n: number }

export interface UIState {
  ready: boolean;
  scale: number;
  phone: boolean;
  compact: boolean;
  /** The target view (the lens tween follows it). */
  view: ViewId;
  place: Crumb[];
  levelNames: string[];
  level: number;
  open: string | null;
  dec: string | null;
  hover: HoverInfo | null;
  /** Search result being previewed on the plan. */
  sel: string | null;
  /** A list row under the pointer highlights its tile. */
  hl: string | null;
  hlDec: string | null;
  tgt: Target;
  prev: Preview | null;
  /** A live product's steer (measure, build, stop) shown under NOT ISSUED YET; never set together with `prev`. */
  lprev: LivePlan | null;
  /** A live answer's track whose record is open beside the plan (a proposal id). */
  track: string | null;
  /** Viewed date (time travel); equals the as-of date when "now". */
  t: string;
  delta: 1 | 7 | 14;
  who: string | null;
  ga: boolean;
  blast: string | null;
  /** A lens id: highlight the features in trouble under it. */
  key: string | null;
  /** The rail flyout that is open (one at a time); null = none. */
  dtab: DockTab | null;
  selMode: boolean;
  dockHidden: boolean;
  morning: boolean;
  info: boolean;
  ordHi: string | null;
  crew: string | null;
  askAll: boolean;
  ordMenu: boolean;
  whoMenu: boolean;
  /** Bumped when the simulation changes discretely (queue, agents, orders). */
  simV: number;
  playing: boolean;
  speed: number;
  over: boolean;
  toast: ToastItem | null;
  ticker: SimEvent | null;
  intro: boolean;
  /** The timeline panel is expanded over the plan (click on the strip, or T). */
  tl: boolean;
  /** Which page fills the plan area: the drawing set, or the findings ledger. */
  page: AppPage;
  /** The findings ledger view shown: the triage table, the feature x lens matrix, or the release. */
  lv: LedgerVariant;
  /** The plan's right-click scan menu, at canvas CSS px, with what was under the pointer. */
  menu: ScanMenuState | null;
}

export type AppPage = 'plan' | 'ledger';
export type LedgerVariant = 'triage' | 'matrix' | 'release';
export const LEDGER_VARIANTS: readonly LedgerVariant[] = ['triage', 'matrix', 'release'];
export interface ScanMenuState {
  x: number;
  y: number;
  /** Places under the pointer, outermost first (the hit chain). */
  chain: Crumb[];
  /** The feature tile under the pointer, if any. */
  tile: string | null;
}

export function initialState(scale: number, asOf: string): UIState {
  return {
    ready: false, scale, phone: false, compact: false, view: 'general', place: [], levelNames: [], level: 0,
    open: null, dec: null, hover: null, sel: null, hl: null, hlDec: null, tgt: { ids: {}, n: 0, label: '' }, prev: null, lprev: null, track: null,
    t: asOf, delta: 7, who: null, ga: false, blast: null, key: null, dtab: null, selMode: false, dockHidden: false,
    morning: false, info: false, ordHi: null, crew: null, askAll: false, ordMenu: false, whoMenu: false, simV: 0,
    playing: true, speed: 8, over: false, toast: null, ticker: null, intro: false, tl: false,
    page: 'plan', lv: 'triage', menu: null,
  };
}
