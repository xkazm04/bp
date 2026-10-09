// The six built-in lenses as the base, shaped and bold prototypes were written against them: one nested
// object per lens. They are rebuilt here from the facets (the loader's per-feature lens values) once per
// feature and cached, so those variants keep working for the built-in ids while every other lens falls
// back to the manifest-driven subtle channel. Nothing outside src/variants/{base,shaped,bold} reads this.
import type { Feature, Health, Scalar } from '@/lib/data';

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

/** bl = "built-in lenses": the built-in lens objects of a feature (clones share them: the cache is keyed by the shared lens record). */
export function bl(f: Feature): Legacy {
  let L = CACHE.get(f.lens);
  if (L) return L;
  const v = (id: string) => f.lens[id]?.v ?? EMPTY, h = (id: string): Health => f.lens[id]?.h ?? 'unmeasured';
  const bu = v('business'), de = v('design'), dv = v('development'), op = v('operations'), se = v('security'), q = v('quality');
  const flagKey = s(op, 'flagKey');
  L = {
    business: {
      value: n(bu, 'value', 1), confidence: s(bu, 'confidence'), customerRequests30d: n(bu, 'customerRequests30d'), adoptionPct: nn(bu, 'adoptionPct'),
      revenueLink: s(bu, 'revenueLink', 'none'), mrrImpactUsd: n(bu, 'mrrImpactUsd'), usageNote: s(bu, 'usageNote') || undefined, health: h('business'),
    },
    // a design facet marked not applicable is the old "n/a" (a feature with no screen)
    design: { status: s(de, 'status', h('design') === 'na' ? 'n/a' : 'none'), a11y: s(de, 'a11y', 'unknown'), specDrift: b(de, 'specDrift') === true, health: h('design') },
    development: {
      status: s(dv, 'status', 'not-started'), progressPct: n(dv, 'progressPct'), aiAuthoredPct: n(dv, 'aiAuthoredPct'), humanReviewed: b(dv, 'humanReviewed'),
      openPRs: n(dv, 'openPRs'), unitCoveragePct: nn(dv, 'unitCoveragePct'), techDebt: nn(dv, 'techDebt'), linesOfCode: n(dv, 'linesOfCode'),
      lastCommit: s(dv, 'lastCommit') || null, stalled: b(dv, 'stalled') ?? undefined, health: h('development'),
    },
    operations: {
      environment: s(op, 'environment', 'none'), flag: flagKey ? { key: flagKey, rolloutPct: n(op, 'rolloutPct') } : null, sloTarget: nn(op, 'sloTarget'),
      sloActual: nn(op, 'sloActual'), p95ms: nn(op, 'p95ms'), errorRatePct: nn(op, 'errorRatePct'), incidents30d: n(op, 'incidents30d'),
      alerting: b(op, 'alerting') === true, runbook: b(op, 'runbook') === true, costUsdMonth: n(op, 'costUsdMonth'), health: h('operations'),
    },
    security: { dataClass: s(se, 'dataClass', 'public'), review: s(se, 'review', 'not-started'), openFindings: n(se, 'openFindings'), health: h('security') },
    quality: {
      status: s(q, 'status', 'n/a'), e2eTests: n(q, 'e2eTests'), e2ePassing: n(q, 'e2ePassing'),
      openBugs: { p1: n(q, 'openBugsP1'), p2: n(q, 'openBugsP2'), p3: n(q, 'openBugsP3') }, health: h('quality'),
    },
  };
  CACHE.set(f.lens, L);
  return L;
}

/** A feature's health under a lens (any id). */
export function hof(f: Feature, l: string): Health { return f.lens[l]?.h ?? 'unmeasured'; }

/** True when the rule that decided this lens's health names the field (the evidence behind a tension). */
export function ruled(f: Feature, l: string, field: string): boolean {
  const fl = f.lens[l];
  return !!fl && (fl.h === 'bad' || fl.h === 'watch') && fl.whyFields.includes(field);
}
