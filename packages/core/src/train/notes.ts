// The release notes, written once. The Release tab's preview (releaseState.ts notesPreview, mode "preview") and
// Kettle's sample release run (model/train-sim.ts, mode "sample") both call releaseNotes(), so the collapsible that swaps
// from the preview to the stored notes after Build (NotesPreview.tsx) shows the same lines. The format follows
// lens-scan's release run (ai-registry skills/lens-scan/references/release.md, step 4): per item its title, lens,
// feature, the metric's before -> after with unit and verdict, the commit and the pack it came from, and a flagged
// item's triage note; then the items a cherry-pick conflict sent back to rework with their files; then the gates, one
// line each (a preview, before any run, says where they will go). Only the header block differs between the modes.
// Pure: value imports ./rules.ts and ../scan/compare.ts only, so Node checks import it (scripts/check-release-notes.ts).
import type { Measurement, Proposal } from '../scan/types.ts';
import { verdictOf, type LensFields, type Verdict } from '../scan/compare.ts';
import { isFlagged } from './rules.ts';

/** One release item with its evidence: the verdict and the readings it compares, and whether it ships flagged. */
export interface NoteItem {
  p: Proposal;
  verdict: Verdict;
  from?: Measurement;
  to?: Measurement;
  flagged: boolean;
}

/** An item's evidence from its before and after readings. Accepted from failed is still flagged: its build did not
 *  pass its gates. */
export function noteItem(p: Proposal, before: readonly Measurement[], after: readonly Measurement[], lenses: readonly LensFields[]): NoteItem {
  const v = verdictOf(p, before, after, lenses);
  const out: NoteItem = { p, verdict: v.verdict, flagged: isFlagged({ status: p.triaged_from === 'failed' ? 'failed' : p.status }, v.verdict) };
  if (v.from) out.from = v.from;
  if (v.to) out.to = v.to;
  return out;
}

/** A rework item sent back by a release's cherry-pick conflict (its note says so). */
export const isConflict = (p: Pick<Proposal, 'triage_note'>): boolean => /^conflict on release\//.test(p.triage_note ?? '');

/** The rework items a cherry-pick conflict on `branch` sent back (every branch's when it is undefined). */
export const conflictsIn = (props: readonly Proposal[], branch?: string): Proposal[] =>
  props.filter((p) => p.status === 'rework' && isConflict(p) && (branch === undefined || (p.triage_note ?? '').startsWith('conflict on ' + branch)));

/** A reading as the notes and the package print it: an integer as is, else one decimal. */
export const fmtValue = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : 'none');

/** A gate the run logged, and whether it passed. */
export interface NoteGate { name: string; passed: boolean }

export interface NotesInput {
  product: string;
  version: string;
  /** "preview": the Release tab before the run; "sample": Kettle's sample run (always titled Kettle, with a disclaimer). */
  mode: 'preview' | 'sample';
  items: readonly NoteItem[];
  /** The items a cherry-pick conflict sent back to rework; their triage note names the files. */
  conflicts: readonly Pick<Proposal, 'title' | 'triage_note'>[];
  /** The gates the run logged; absent before a run. */
  gates?: readonly NoteGate[];
}

export function releaseNotes({ product, version, mode, items, conflicts, gates }: NotesInput): string {
  const out = mode === 'sample'
    ? [`## Kettle ${version} (sample)`, '', 'Sample release notes: Kettle is the sample product, and nothing here shipped.', '']
    : [`## ${product} ${version} (preview)`, ''];
  out.push(`${items.length} change${items.length === 1 ? '' : 's'} from the lens release train, each measured before and after.`, '');
  for (const x of items) {
    const p = x.p, u = x.from?.unit ? ' ' + x.from.unit : '';
    const move = x.from && x.to ? `${p.metric} ${fmtValue(x.from.value)} -> ${fmtValue(x.to.value)}${u} (${x.verdict})` : 'unmeasured';
    out.push(`- **${p.title}** · ${p.lens} · ${p.feature}: ${move} · commit ${short(p.commit_sha)} from pack ${p.pack_id ?? 'none'}`);
    if (x.flagged && p.triage_note) out.push(`  - Shipped flagged: ${p.triage_note}`);
  }
  if (conflicts.length) {
    out.push('', '### Back to rework (cherry-pick conflict)');
    for (const p of conflicts) out.push(`- ${p.title}: ${p.triage_note ?? ''}`);
  }
  out.push('', '### Gates');
  if (gates?.length) for (const g of gates) out.push(`- ${g.name}: ${g.passed ? 'passed' : 'failed'}`);
  else out.push(`The release job runs the product's gates on release/${version} and lists them here.`);
  return out.join('\n') + '\n';
}
