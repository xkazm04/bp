// Words and tables shared by the model, the engine and the UI. Ported from A/1 ("The Drawing Set:
// Site Watch"). Nothing here touches the DOM.
import type { FeatureFlag, LensId, ReplayType, Stage, ViewId } from '@/lib/data';

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

/** Tensions, in severity order: [flag, long description, short stamp]. */
export const FLAGS: readonly (readonly [FeatureFlag, string, string])[] = [
  ['ai-unreviewed-in-production', 'Built by an agent, live, no human review', 'Agent-built, unreviewed'],
  ['security-gap', 'Sensitive data, security review missing', 'Security gap'],
  ['incident', 'Incident in the last 30 days', 'Incident'],
  ['unmonitored', 'In production without alerting', 'No alerting'],
  ['blocked', 'Blocked by unfinished work', 'Blocked'],
  ['stalled', 'Stalled, no recent progress', 'Stalled'],
  ['priority-not-started', 'Must-have (P0), not started', 'P0 not started'],
  ['demand-waiting', 'Customers asking, not built yet', 'Customers waiting'],
  ['spec-drift', 'Built differently from the design', 'Off-spec'],
];
export const FLAGNO: Record<string, number> = Object.fromEntries(FLAGS.map((x, i) => [x[0], i]));

/** The drawing-set sheets: General plus one per lens. Accent colours belong to variants, not here. */
export interface SheetMeta { k: ViewId; no: string; nm: string; title: string; sub: string }
export const SHEETS: readonly SheetMeta[] = [
  { k: 'general', no: 'G-001', nm: 'General', title: 'General arrangement', sub: 'What is built, what is drawn, where the trouble is' },
  { k: 'business', no: 'B-101', nm: 'Business', title: 'Business · value & demand', sub: 'Value, customer requests, revenue link' },
  { k: 'design', no: 'D-201', nm: 'Design', title: 'Design · finish & access', sub: 'How far design got; accessibility failures' },
  { k: 'development', no: 'S-301', nm: 'Structure', title: 'Structure · development', sub: 'Progress, agent authorship, human review' },
  { k: 'operations', no: 'M-401', nm: 'Services', title: 'Services · operations', sub: 'Rollout, alerting, latency and errors' },
  { k: 'security', no: 'F-501', nm: 'Fire/Life', title: 'Fire & life safety · security', sub: 'Data class, review status' },
  { k: 'quality', no: 'Q-601', nm: 'Inspect', title: 'Inspection · quality', sub: 'End-to-end tests passing, open P1 bugs' },
];
export const SHEET = Object.fromEntries(SHEETS.map((s) => [s.k, s])) as Record<ViewId, SheetMeta>;
export const VIEWS: readonly ViewId[] = SHEETS.map((s) => s.k);

/** Product lines used by `?scale=N` (each clone gets a suffix). */
export const LINES: readonly (readonly [string, string])[] = [
  ['Studios', 'S'], ['Gyms', 'G'], ['Pools', 'P'], ['Clubs', 'C'], ['Dojos', 'D'], ['Climbing', 'K'], ['Dance', 'N'], ['Yoga', 'Y'],
];

/** L0 sections. Ordered left to right by when their work began (computed in layout). */
export interface WingDef { k: string; name: string; plain: string; doms: string[]; art: string; letter: string; median: number }
export const WING_DEFS: readonly Omit<WingDef, 'letter' | 'median'>[] = [
  { k: 'FND', name: 'Foundations', plain: 'What everything else stands on', doms: ['PLT', 'IAM'], art: 'PLT' },
  { k: 'OPS', name: 'Studio operations', plain: 'Running classes, day to day', doms: ['SCH', 'BKG', 'STU', 'INS'], art: 'SCH' },
  { k: 'MNY', name: 'Money', plain: 'Memberships, billing and payouts', doms: ['PAY'], art: 'PAY' },
  { k: 'MBR', name: 'Members & reach', plain: 'The member app, messages and growth', doms: ['MEM', 'COM', 'GRO'], art: 'MEM' },
  { k: 'FRN', name: 'Frontier', plain: 'Insight, integrations and the AI assistant', doms: ['ANA', 'INT', 'AIA'], art: 'AIA' },
];

export const PERSON_LENS: Record<string, LensId> = {
  mara: 'business', dev: 'business', tomas: 'development', priya: 'operations', jonas: 'security', lea: 'design', sam: 'business', ines: 'quality',
};
export const LENS_CREWS: Record<LensId, string[]> = {
  business: ['scout'], design: ['warden', 'scout'], development: ['forge-1', 'forge-2', 'forge-3', 'forge-4'],
  operations: ['tender'], security: ['sentinel'], quality: ['warden'],
};

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
