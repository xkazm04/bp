// The release train's two mark tables: every status and every verdict as a shape, a word and a hint. Shape first,
// colour second (the owner's rule: never colour alone). StateMark and VerdictChip read these and nothing else draws a
// status or a verdict, so the six copies of the state mark and three of the verdict in the contest winner are one.
import type { ProposalStatus } from '@bp/core/scan/types';
import type { Verdict } from '@bp/core/scan/compare';

export interface Mark { mark: string; word: string; hint: string }

export const STATE: Readonly<Record<ProposalStatus, Mark>> = {
  proposed: { mark: '○', word: 'proposed', hint: 'found by a scan, waiting for approval' },
  approved: { mark: '◐', word: 'approved', hint: 'approved, waiting to be built' },
  executing: { mark: '◔', word: 'executing', hint: 'being built now' },
  declined: { mark: '–', word: 'declined', hint: 'declined before it was built' },
  done: { mark: '●', word: 'done', hint: 'built and measured, waiting for you' },
  failed: { mark: '✕', word: 'failed', hint: 'did not build, broke a gate or did not move' },
  accepted: { mark: '✓', word: 'accepted', hint: 'in the release package' },
  rework: { mark: '↺', word: 'rework', hint: 'back to the rework queue with a note' },
  descoped: { mark: '⊘', word: 'descoped', hint: 'dropped, with a note' },
  released: { mark: '◆', word: 'released', hint: 'shipped in a tagged release' },
};

export const VERDICT: Readonly<Record<Verdict, Mark>> = {
  moved: { mark: '▼', word: 'moved', hint: 'better in the metric’s direction' },
  flat: { mark: '＝', word: 'flat', hint: 'no change beyond noise' },
  worse: { mark: '▲', word: 'worse', hint: 'moved the wrong way' },
  unmeasured: { mark: '?', word: 'unmeasured', hint: 'a side is missing' },
};

/** A number as the ledger shows it: integers as they are, others to one decimal (tabular figures do the aligning). */
export const num = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
