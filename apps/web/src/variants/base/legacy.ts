// The six built-in lenses as the base, shaped and bold prototypes were written against them: one nested
// object per lens. They are rebuilt here from the facets (the loader's per-feature lens values) once per
// feature and cached, so those variants keep working for the built-in ids while every other lens falls
// back to the manifest-driven subtle channel. Nothing outside src/variants/{base,shaped,bold} reads this.
import type { Feature, Health, Scalar } from '@bp/core/data';
import { hotHealth } from '@bp/core/standard/present';

type V = Readonly<Record<string, Scalar>>;
const n = (v: V, k: string, d = 0): number => (typeof v[k] === 'number' ? (v[k] as number) : d);
const nn = (v: V, k: string): number | null => (typeof v[k] === 'number' ? (v[k] as number) : null);
const s = (v: V, k: string, d = ''): string => (typeof v[k] === 'string' ? (v[k] as string) : d);
const b = (v: V, k: string): boolean | null => (typeof v[k] === 'boolean' ? (v[k] as boolean) : null);

export interface BusinessLens { value: number; confidence: string; customerRequests30d: number; adoptionPct: number | null; revenueLink: string; mrrImpactUsd: number; usageNote?: string; health: Health }
export interface DesignLens { status: string; a11y: string; specDrift: boolean; health: Health }
export interface DevelopmentLens {
  status: string; progressPct: number; aiAuthoredPct: number; humanReviewed: boolean | null; openPRs: number; unitCoveragePct: number | null;
  techDebt: number | null; linesOfCode: number; lastCommit: string | null; stalled?: boolean; health: Health;
}
export interface OperationsLens {
  environment: string; flag: { key: string; rolloutPct: number } | null; sloTarget: number | null; sloActual: number | null; p95ms: number | null;
  errorRatePct: number | null; incidents30d: number; alerting: boolean; runbook: boolean; costUsdMonth: number; health: Health;
}
export interface SecurityLens { dataClass: string; review: string; openFindings: number; health: Health }
export interface QualityLens { status: string; e2eTests: number; e2ePassing: number; openBugs: { p1: number; p2: number; p3: number }; health: Health }
export interface Legacy { business: BusinessLens; design: DesignLens; development: DevelopmentLens; operations: OperationsLens; security: SecurityLens; quality: QualityLens }

/** The six built-in lens ids these prototypes know (their channel maps are keyed by them). */
export type BuiltinLens = keyof Legacy;
const KNOWN: Record<BuiltinLens, true> = { business: true, design: true, development: true, operations: true, security: true, quality: true };
export const isBuiltinLens = (l: string): l is BuiltinLens => Object.prototype.hasOwnProperty.call(KNOWN, l);

const EMPTY: V = {};
const CACHE = new WeakMap<object, Legacy>();

/**
 * bl = "built-in lenses": the built-in lens objects of a feature (clones share them: the cache is keyed by the shared lens record).
 * A field the facet does not carry stays unknown: '' (or the vocabulary's own 'unknown') for text, 0 for `business.value` (outside its 1..5 scale) and for counts.
 * The old defaults ('public', 'none', 'not-started', value 1) read as measurements on a feature nobody measured.
 */
export function bl(f: Feature): Legacy {
  let L = CACHE.get(f.lens);
  if (L) return L;
  const v = (id: string) => f.lens[id]?.v ?? EMPTY, h = (id: string): Health => f.lens[id]?.h ?? 'unmeasured';
  const bu = v('business'), de = v('design'), dv = v('development'), op = v('operations'), se = v('security'), q = v('quality');
  const flagKey = s(op, 'flagKey');
  L = {
    business: {
      value: n(bu, 'value'), confidence: s(bu, 'confidence'), customerRequests30d: n(bu, 'customerRequests30d'), adoptionPct: nn(bu, 'adoptionPct'),
      revenueLink: s(bu, 'revenueLink'), mrrImpactUsd: n(bu, 'mrrImpactUsd'), usageNote: s(bu, 'usageNote') || undefined, health: h('business'),
    },
    // a design facet marked not applicable is the old "n/a" (a feature with no screen)
    design: { status: s(de, 'status', h('design') === 'na' ? 'n/a' : ''), a11y: s(de, 'a11y', 'unknown'), specDrift: b(de, 'specDrift') === true, health: h('design') },
    development: {
      status: s(dv, 'status'), progressPct: n(dv, 'progressPct'), aiAuthoredPct: n(dv, 'aiAuthoredPct'), humanReviewed: b(dv, 'humanReviewed'),
      openPRs: n(dv, 'openPRs'), unitCoveragePct: nn(dv, 'unitCoveragePct'), techDebt: nn(dv, 'techDebt'), linesOfCode: n(dv, 'linesOfCode'),
      lastCommit: s(dv, 'lastCommit') || null, stalled: b(dv, 'stalled') ?? undefined, health: h('development'),
    },
    operations: {
      environment: s(op, 'environment'), flag: flagKey ? { key: flagKey, rolloutPct: n(op, 'rolloutPct') } : null, sloTarget: nn(op, 'sloTarget'),
      sloActual: nn(op, 'sloActual'), p95ms: nn(op, 'p95ms'), errorRatePct: nn(op, 'errorRatePct'), incidents30d: n(op, 'incidents30d'),
      alerting: b(op, 'alerting') === true, runbook: b(op, 'runbook') === true, costUsdMonth: n(op, 'costUsdMonth'), health: h('operations'),
    },
    security: { dataClass: s(se, 'dataClass'), review: s(se, 'review'), openFindings: n(se, 'openFindings'), health: h('security') },
    quality: {
      status: s(q, 'status'), e2eTests: n(q, 'e2eTests'), e2ePassing: n(q, 'e2ePassing'),
      openBugs: { p1: n(q, 'openBugsP1'), p2: n(q, 'openBugsP2'), p3: n(q, 'openBugsP3') }, health: h('quality'),
    },
  };
  CACHE.set(f.lens, L);
  return L;
}

/** The words a channel's evidence line says for a lens nobody measured (the same wording as the manifest-driven channel). */
export const NOT_MEASURED = 'NOT MEASURED';

/**
 * A built-in channel that says NOT MEASURED, and nothing else, for a feature whose facet for this lens is absent
 * (health 'unmeasured'): no stamp, no default-driven words. Marks are the channel's own.
 */
export function measuredContent<C extends { content(f: Feature, live: never): { parts: string[]; stamp?: string } }>(lens: BuiltinLens, ch: C): C {
  const own = ch.content.bind(ch) as (f: Feature, live: never) => { parts: string[]; stamp?: string };
  return { ...ch, content: (f: Feature, live: never) => (hof(f, lens) === 'unmeasured' ? { parts: [NOT_MEASURED] } : own(f, live)) };
}

/** A place's features split by whether this lens's facet was measured (health not 'unmeasured'): the one filter
 *  the aggregates and bold's bay rails share, as the manifest path's lensAggregate skips a facet-less feature. */
export function measuredOf(fs: readonly Feature[], lens: string): { measured: Feature[]; missing: number } {
  const measured = fs.filter((f) => hof(f, lens) !== 'unmeasured');
  return { measured, missing: fs.length - measured.length };
}

/**
 * The aggregate's sibling of measuredContent: the channel's own aggregate sees only the measured features, an
 * all-unmeasured place says NOT MEASURED, and a mixed one ends with 'N not measured' (the lowest-priority part:
 * parts drop from the end to fit). Without that last part a mixed place reads exactly as its measured features do.
 */
export function measuredAggregate<C extends { aggregate(fs: readonly Feature[]): { parts: string[]; trouble?: number } }>(lens: BuiltinLens, ch: C): C {
  const own = ch.aggregate.bind(ch) as C['aggregate'];
  return {
    ...ch,
    aggregate: (fs: readonly Feature[]) => {
      const { measured, missing } = measuredOf(fs, lens);
      if (!measured.length) return { parts: [NOT_MEASURED] };
      const a = own(measured);
      return missing ? { ...a, parts: [...a.parts, missing + ' not measured'] } : a;
    },
  };
}

/** Both: the form CHANNELS exports every built-in channel in. */
export const measured = <C extends { content(f: Feature, live: never): { parts: string[]; stamp?: string }; aggregate(fs: readonly Feature[]): { parts: string[]; trouble?: number } }>(lens: BuiltinLens, ch: C): C =>
  measuredAggregate(lens, measuredContent(lens, ch));

/** Data-class sensitivity, 0 (public, or not measured) to 3 (card data): one ordinal for shields, fences and pips. */
export const DATA_CLASS_STEP: Readonly<Record<string, number>> = { public: 0, internal: 1, personal: 2, payment: 3 };
export const sensitivity = (f: Feature): number => DATA_CLASS_STEP[bl(f).security.dataClass] ?? 0;
/** The design fidelity ladder, 0 (none) to 5 (polished); null off the ladder ('n/a', or not measured). */
export const DESIGN_STEP: Readonly<Record<string, number>> = { none: 0, sketch: 1, wireframe: 2, 'hi-fi': 3, implemented: 4, polished: 5 };
export const designStep = (f: Feature): number | null => DESIGN_STEP[bl(f).design.status] ?? null;
/** A review that has not happened yet (as opposed to passed, findings or not required). */
export const reviewOpen = (f: Feature): boolean => { const r = bl(f).security.review; return r === 'pending' || r === 'not-started'; };
/** Card or personal data that nobody has reviewed: the one predicate behind every stamp, count, rail and panel that says so. */
export const sensitiveUnreviewed = (f: Feature): boolean => sensitivity(f) >= 2 && reviewOpen(f);

/** A feature's health under a lens (any id). */
export function hof(f: Feature, l: string): Health { return f.lens[l]?.h ?? 'unmeasured'; }

/** True when the rule that decided this lens's health names the field (the evidence behind a tension). */
export function ruled(f: Feature, l: string, field: string): boolean {
  return hotHealth(f.lens[l], field) !== '';
}
