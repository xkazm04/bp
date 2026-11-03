// Whether a "what clears it" step is covered by a proposal, and whether that proposal is big enough. A step
// (clear.ts) is one field that must move from `now` to `target`; a proposal names a feature, a lens, a metric and an
// expected delta in that metric's units (scan/types.ts Proposal). coverStep matches the step's field to the proposals
// on the same feature and lens, applies `now + expected_delta` (the arithmetic the review queue shows) and re-runs
// the step's rule with the same evaluator clearPath verifies with: every OTHER field of the path at its target, this
// field at the projected value, the step's rule must stop matching and no rule that does not match now may wake. So
// the verdict is about this step only (a watch step on the same field is its own step) and never over-claims.
// A built item with `after_value` is judged on that value instead ("measured 390 after"). An after value was read on
// the pack's branch: it is evidence about the proposal, never the feature's current reading (derive.ts isCurrent), so
// nothing here feeds it back into `values`. Pure and dependency-free (type imports and the evaluator only), like
// clear.ts, so Node's type stripping runs it. Nothing names a lens.
import type { ComputedHealth, LensManifest, Scalar } from './types.ts';
import type { Proposal, ProposalStatus } from '../scan/types.ts';
import { conditionFields, evaluateCondition, matchRule } from './health.ts';
import { clearPath, type ClearStep } from './clear.ts';

type Values = Readonly<Record<string, Scalar | null | undefined>>;

/** Still on its way: a proposal that targets the step and has not been built yet. */
export const COVER_OPEN: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['proposed', 'approved', 'executing']);
/** Built: its `after_value` (when measured) is what it delivered. `rework` is left out (the rebuild is its own row,
 *  `attempt_of`), and so are declined, failed and descoped items: nobody is fixing anything through them. */
export const COVER_BUILT: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['done', 'accepted', 'released']);

/** One proposal against one step. `phase`: judged on now + expected delta (`expected`), on the after reading
 *  (`delivered`), or not judgeable (`unsized`: no expected delta, or a non-numeric step). */
export interface StepCover {
  id: string;
  title: string;
  status: ProposalStatus;
  phase: 'expected' | 'delivered' | 'unsized';
  /** The value judged: now + expected delta, or the after value; null when unsized. */
  value: number | null;
  /** clears: the rule stops matching; short: it moves the right way but not far enough (by `short`); worse: it moves
   *  the wrong way or the lens reads worse; null when unsized. */
  verdict: 'clears' | 'short' | 'worse' | null;
  /** How far the value stays from the target (in the field's units), for `short`; else 0. */
  short: number;
}
export type Coverage = { covered: false } | { covered: true; best: StepCover; all: StepCover[] };

const RANK: Record<ComputedHealth, number> = { good: 0, watch: 1, bad: 2 };
const round = (x: number) => Math.round(x * 1e6) / 1e6;
/** delivered-and-clears first, then clears, short (nearest first), unsized, worse. */
const order = (c: StepCover): number => (c.verdict === 'clears' ? (c.phase === 'delivered' ? 0 : 1) : c.verdict === 'short' ? 2 : c.verdict === null ? 3 : 4);

/**
 * The proposals that target `step` on one feature and lens (`at.feature` is the base id the scan stores) and what
 * each would do to it. `values` are the bound values the step was solved from (FeatureLens.v).
 */
export function coverStep(step: ClearStep, proposals: readonly Proposal[], values: Values, manifest: LensManifest, at: { feature: string; lens: string }): Coverage {
  const hits = proposals.filter((p) => p.feature === at.feature && p.lens === at.lens && p.metric === step.field && (COVER_OPEN.has(p.status) || COVER_BUILT.has(p.status)));
  if (!hits.length) return { covered: false };
  // the rest of the path, taken: the verdict asks about this step alone
  const others: Record<string, Scalar | null | undefined> = { ...values };
  for (const s of clearPath(manifest, values).steps) if (s.field !== step.field) others[s.field] = s.target;
  const known = new Set(manifest.fields.map((f) => f.key)), d = RANK[manifest.health.default];
  const unwell = manifest.health.rules.filter((r) => RANK[r.health] > d && conditionFields(r.when).every((k) => known.has(k)));
  // the step's own rules: those matching now, of the step's health, that read its field (two rules on one field are two steps)
  const own = unwell.filter((r) => r.health === step.rule && evaluateCondition(r.when, values) && conditionFields(r.when).includes(step.field));
  const asleep = unwell.filter((r) => !evaluateCondition(r.when, values));
  const rankOf = (v: Values): number => { const r = matchRule(manifest, v); return RANK[r?.health ?? manifest.health.default]; };
  const nowRank = rankOf(values);
  const judge = (x: number): Pick<StepCover, 'verdict' | 'short'> => {
    const v = { ...others, [step.field]: x };
    // the step's rule stops matching and no rule that does not match now wakes (clearPath's own test for a target)
    const clears = !own.some((r) => evaluateCondition(r.when, v)) && !asleep.some((r) => evaluateCondition(r.when, v));
    if (clears) return { verdict: 'clears', short: 0 };
    const now = step.now as number, target = step.target as number;
    const wrongWay = step.op === 'at most' ? x > now : x < now;
    if (wrongWay || rankOf({ ...values, [step.field]: x }) > nowRank) return { verdict: 'worse', short: 0 };
    return { verdict: 'short', short: round(Math.abs(x - target)) };
  };
  const numeric = typeof step.now === 'number' && typeof step.target === 'number' && step.op !== 'set to';
  const all = hits.map((p): StepCover => {
    const base = { id: p.id, title: p.title, status: p.status };
    if (numeric && COVER_BUILT.has(p.status) && typeof p.after_value === 'number') return { ...base, phase: 'delivered', value: p.after_value, ...judge(p.after_value) };
    if (numeric && typeof p.expected_delta === 'number') { const x = round((step.now as number) + p.expected_delta); return { ...base, phase: 'expected', value: x, ...judge(x) }; }
    return { ...base, phase: 'unsized', value: null, verdict: null, short: 0 };
  });
  all.sort((a, b) => order(a) - order(b) || a.short - b.short || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { covered: true, best: all[0], all };
}
