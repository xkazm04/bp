// Words and tables shared by the model, the engine and the UI. Ported from A/1 ("The Drawing Set:
// Site Watch"). Nothing here touches the DOM.
import type { ReplayType, Stage, ViewId } from '@/lib/data';

export const STAGE_WORD: Record<Stage, string> = {
  live: 'Built', flagged: 'Partly open', 'in-review': 'Inspection', 'in-dev': 'Construction',
  specified: 'Proposed', idea: 'Future', deprecated: 'Demolish',
};
export const STAGE_PLAIN: Record<Stage, string> = {
  live: 'Live for every studio', flagged: 'Live for some studios, behind a switch',
  'in-review': 'Built and waiting for review', 'in-dev': 'Being built', specified: 'Designed, not started',
  idea: 'An idea, not yet designed', deprecated: 'Being retired',
};
export const REV_DESC: Record<Stage, string> = {
  idea: 'Idea recorded', specified: 'Specified, drawn up', 'in-dev': 'Construction started',
  'in-review': 'Submitted for inspection', flagged: 'Opened behind a flag', live: 'Opened to all studios',
  deprecated: 'Marked for demolition',
};

/** The General sheet. Lens sheets come from the registry (manifests): see lens.ts. */
export interface SheetMeta { k: ViewId; no: string; nm: string; title: string; sub: string }
export const GENERAL_SHEET: SheetMeta = { k: 'general', no: 'G-001', nm: 'General', title: 'General arrangement', sub: 'What is built, what is drawn, where the trouble is' };

/** Product lines used by `?scale=N` (each clone gets a suffix). */
export const LINES: readonly (readonly [string, string])[] = [
  ['Studios', 'S'], ['Gyms', 'G'], ['Pools', 'P'], ['Clubs', 'C'], ['Dojos', 'D'], ['Climbing', 'K'], ['Dance', 'N'], ['Yoga', 'Y'],
];

/** L0 sections (Kettle's wings), by domain slug; unknown domains join the last wing. Ordered left to right
 * by when their work began (computed in layout). */
export interface WingDef { k: string; name: string; plain: string; doms: string[]; art: string; letter: string; median: number }
export const WING_DEFS: readonly Omit<WingDef, 'letter' | 'median'>[] = [
  { k: 'FND', name: 'Foundations', plain: 'What everything else stands on', doms: ['platform', 'identity'], art: 'platform' },
  { k: 'OPS', name: 'Studio operations', plain: 'Running classes, day to day', doms: ['scheduling', 'booking', 'studio-setup', 'instructor-tools'], art: 'scheduling' },
  { k: 'MNY', name: 'Money', plain: 'Memberships, billing and payouts', doms: ['payments'], art: 'payments' },
  { k: 'MBR', name: 'Members & reach', plain: 'The member app, messages and growth', doms: ['member-experience', 'communications', 'growth'], art: 'member-experience' },
  { k: 'FRN', name: 'Frontier', plain: 'Insight, integrations and the AI assistant', doms: ['analytics', 'integrations', 'assistant'], art: 'assistant' },
];

/** Sample-specific places the steering commands name (milestone and feature slugs in the map). */
export const GA_MILESTONE = 'payments-ga';
export const LATER_MILESTONES: readonly string[] = ['multi-location', 'kettle-assistant'];
export const FIRST_MILESTONE = 'public-beta';
/** The blast radius shown when nothing is selected. */
export const BLAST_DEFAULT = 'background-job-queue';

export type PulseKind = 'c' | 'ok' | 'bad' | 'pr' | 'dep' | 'flag' | 'warn' | 'ask' | 'mv';
export const PULSE_OF: Record<ReplayType, PulseKind> = {
  commit: 'c', 'tests-pass': 'ok', 'tests-fail': 'bad', 'pr-open': 'pr', 'task-done': 'ok', 'review-pass': 'ok',
  'review-changes': 'bad', deploy: 'dep', 'flag-change': 'flag', alert: 'warn', 'spec-draft': 'c', note: 'c', finding: 'bad',
  'scan-clean': 'ok', move: 'mv', 'decision-asked': 'ask',
};
export const TICK_CLASS: Partial<Record<ReplayType, 'bad' | 'ok' | 'ask'>> = {
  'tests-fail': 'bad', 'review-changes': 'bad', alert: 'bad', finding: 'bad', 'tests-pass': 'ok', deploy: 'ok',
  'review-pass': 'ok', 'task-done': 'ok', 'scan-clean': 'ok', 'decision-asked': 'ask',
};

export const SPEEDS = [1, 8, 60, 240] as const;
export const HOUR = 3600;
/** "While you were away" starts here. */
export const AWAY_SINCE = '2026-10-07T18:00:00Z';
/** Daily swarm spend cap (order O-7). */
export const SPEND_CAP = 2400;
