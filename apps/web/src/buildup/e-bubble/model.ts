// The drawable model behind the bubble diagram: the plan's entities as they have arrived, each with its schedule
// (`sc`, engine seconds; Infinity = not scheduled yet) and its state at the frame being drawn (`s`).
import type { BBox, Health, Stage } from '../contract';

export const STAGE_WORD: Readonly<Record<Stage, string>> = { live: 'Built', flagged: 'Partly open', 'in-review': 'Inspection', 'in-dev': 'Construction', specified: 'Proposed', idea: 'Future', deprecated: 'Demolish' };
/** The ladder a tile climbs: dotted, dashed, hatched, cross-hatched, solid. */
export const STAGE_RUNG: Readonly<Record<Stage, number>> = { idea: 0, specified: 1, 'in-dev': 2, 'in-review': 3, live: 4, flagged: 4, deprecated: 4 };
export const KIND_WORD: Readonly<Record<string, string>> = { user_flow: 'User flow', capability: 'Capability', ops: 'Operations', integration: 'Integration' };
export const HEALTH_WORD: Readonly<Record<Health, string>> = { good: 'Healthy', watch: 'Watch', bad: 'In trouble', na: 'Not judged', unmeasured: 'Not measured' };
export const stageWord = (s: Stage | null): string => (s ? STAGE_WORD[s] : 'No stage');
export const rungOf = (s: Stage | null): number => (s ? STAGE_RUNG[s] : 0);
export type StageGroup = 'live' | 'build' | 'paper' | 'dep';
export const stageGroup = (s: Stage | null): StageGroup => (s === 'live' || s === 'flagged') ? 'live' : (s === 'in-dev' || s === 'in-review') ? 'build' : (s === 'deprecated') ? 'dep' : 'paper';

export interface Pack { cx: number; cy: number; R: number }
export interface Local { x: number; y: number; R: number }
export interface Wob { a1: number; a2: number; a3: number; p1: number; p2: number; p3: number; a0: number }
export interface Stat { n: number; live: number; build: number; paper: number; dep: number }
export interface WingLab { w: number; h: number; ux: number; uy: number; off: number }
export interface RoomLab { inside: boolean; lines: string[]; w: number; h: number; cx: number; cy: number; ux: number; uy: number; off: number }

export interface WingE {
  type: 'wing'; id: string; name: string; letter: string; order: number; box: BBox; cx: number; cy: number;
  rooms: RoomE[]; tiles: TileE[]; stat: Stat; wob: Wob;
  /** Packing radius in dot units; target pack (world), the pack it tweens from, the pack drawn this frame. */
  pkR: number; pack: Pack; pk0: Pack; pd: Pack; median: number | null; lab: WingLab | null;
  sc: { tIn: number; tPlate: number; tSlide: number; tSq0: number; tInk0: number; tHead: number };
  s: { appear: number; slide: number; sq: number; cx: number; cy: number; hw: number; hh: number; n: number; ink: number; head: number; plate: number; letter: number };
}
export interface RoomE {
  type: 'room'; id: string; name: string; order: number; box: BBox; cx: number; cy: number; wing: WingE;
  bays: BayE[]; tiles: TileE[]; stat: Stat; wob: Wob;
  pkR: number; pkx: number; pky: number; local: Local; lc0: Local; ld: Local; lab: RoomLab | null; plate: boolean;
  sc: { tIn: number; tSq0: number; tInk0: number; tBay0: number; tName: number };
  s: { appear: number; sq: number; cx: number; cy: number; hw: number; hh: number; n: number; ink: number; bay: number; name: number };
}
export interface BayE { type: 'bay'; id: string; name: string; order: number; box: BBox; room: RoomE; tiles: TileE[] }
export interface TileE {
  type: 'tile'; id: string; name: string; order: number; box: BBox; cx: number; cy: number;
  stage: Stage | null; kind: string | null; summary: string; created: string | null; day: number | null; general: Health | null;
  bay: BayE; room: RoomE; wing: WingE; u: { x: number; y: number }; ready: boolean;
  sc: { tDot: number; tSw0: number; tC0: number; rung: number; tH: number };
  s: { appear: number; sw: number; cx: number; cy: number; hw: number; hh: number; rad: number; climb: number; health: number; hflash: number; vis: boolean };
}
export type Ent = WingE | RoomE | BayE | TileE;

export const emptyStat = (): Stat => ({ n: 0, live: 0, build: 0, paper: 0, dep: 0 });
