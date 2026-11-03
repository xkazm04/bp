// Readiness for whatever the plan has selected: per feature in scope and per enabled lens, one verdict, from the lens
// manifests and readings alone (no authored criteria):
//   - clear: the lens reads good (or does not apply) on evidence no older than `maxAgeDays`;
//   - unproven: the lens reads good but its newest CURRENT reading (the scan's, or the map facet's measured_at) is
//     older than `maxAgeDays`, or nothing is measured at all. A pack's `after` reading was taken on its branch and
//     never counts (metric history and isCurrent leave it out), so it can never make a pair clear;
//   - steps: the lens reads watch or bad and clearPath gives verified steps; each step's coverage comes from coverStep
//     (a proposal that would clear it, falls short, or none);
//   - blocked: no verified list exists (clearPath's reason, or a health held by an override no step can move).
// A cross-lens pass applies all of a feature's steps (every lens's targets at once) and re-reads every lens with the
// same evaluator: a lens that would read worse, or two lenses asking one field for incompatible targets, is a conflict,
// said in words. A feature rolls up as blocked > steps > unproven > clear. A pair whose age cannot be known (no dated
// reading anywhere, e.g. a hand-written map facet) is not called unproven: it counts as clear and is counted apart
// (`undated`), so the summary never turns "no date" into "stale". Pure; the caller computes it on a discrete change.
import type { Feature, Health, LensDef } from '@bp/core/data';
import type { Proposal, ScanSnapshot } from '@bp/core/scan/types';
import type { Scalar } from '@bp/core/standard/types';
import { isCurrent } from '@bp/core/scan/derive';
import { clearPath, type ClearStep } from '@bp/core/standard/clear';
import { coverStep, type Coverage } from '@bp/core/standard/cover';
import { evaluateLens } from '@bp/core/standard/health';
import { baseId } from './product';

export interface ReadyOpts { maxAgeDays: number; now: string }
export interface ReadyStep { lens: string; step: ClearStep; cover: Coverage }
export type LensReady =
  | { lens: string; kind: 'clear'; newest: string | null }
  | { lens: string; kind: 'unproven'; newest: string | null; ageDays: number | null }
  | { lens: string; kind: 'steps'; steps: ReadyStep[] }
  | { lens: string; kind: 'blocked'; why: string };
export type ReadyKind = LensReady['kind'];
export interface FeatureReady { id: string; kind: ReadyKind; lenses: LensReady[]; conflicts: string[] }
export interface Readiness {
  features: FeatureReady[];
  n: number; clear: number; unproven: number; blocked: number; withSteps: number;
  steps: number; covered: number; short: number;
  /** Lens pairs counted clear with no dated reading anywhere (their age is unknown, not old). */
  undated: number;
  conflicts: number;
  maxAgeDays: number;
}

const DAY = 864e5;
const dayOf = (s: string | undefined | null) => (s ? s.slice(0, 10) : '');
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

/** The newest current reading per (base feature, lens) in the scan: one pass over the table. */
function newestByPair(scan: ScanSnapshot | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of scan?.measurements ?? []) {
    if (!isCurrent(m)) continue;
    const k = m.feature + '\u0000' + m.lens, d = dayOf(m.measured_at), p = out.get(k);
    if (!p || d > p) out.set(k, d);
  }
  return out;
}

const RANK: Record<string, number> = { good: 0, na: 0, watch: 1, bad: 2, unmeasured: 1 };
const KIND_RANK: Record<ReadyKind, number> = { clear: 0, unproven: 1, steps: 2, blocked: 3 };

export function readiness(P: { lenses: readonly LensDef[]; F: Readonly<Record<string, Feature>> }, scan: ScanSnapshot | undefined, ids: Iterable<string>, opts: ReadyOpts, proposals: readonly Proposal[] = scan?.proposals ?? []): Readiness {
  const newest = newestByPair(scan);
  const r: Readiness = { features: [], n: 0, clear: 0, unproven: 0, blocked: 0, withSteps: 0, steps: 0, covered: 0, short: 0, undated: 0, conflicts: 0, maxAgeDays: opts.maxAgeDays };
  for (const id of ids) {
    const f = P.F[id]; if (!f) continue;
    const bid = baseId(f.id), lenses: LensReady[] = [];
    for (const d of P.lenses) {
      const fl = f.lens[d.id], h: Health = fl?.h ?? 'unmeasured';
      if (h === 'watch' || h === 'bad') {
        const cp = d.manifest ? clearPath(d.manifest, fl!.v) : null;
        if (!cp) { lenses.push({ lens: d.id, kind: 'blocked', why: d.name + ' has no rules to clear by.' }); continue; }
        if (cp.blocked) { lenses.push({ lens: d.id, kind: 'blocked', why: d.name + ': ' + cp.blocked }); continue; }
        if (!cp.steps.length) { lenses.push({ lens: d.id, kind: 'blocked', why: d.name + ' reads ' + h + (fl!.ov ? ' by an override' : '') + ': no rule to clear matches.' }); continue; }
        const steps = cp.steps.map((s) => ({ lens: d.id, step: s, cover: coverStep(s, proposals, fl!.v, d.manifest, { feature: bid, lens: d.id }) }));
        lenses.push({ lens: d.id, kind: 'steps', steps });
        continue;
      }
      if (h === 'unmeasured') { lenses.push({ lens: d.id, kind: 'unproven', newest: null, ageDays: null }); continue; }
      if (h === 'na') { lenses.push({ lens: d.id, kind: 'clear', newest: null }); continue; }
      // good: fresh enough?
      const a = newest.get(bid + '\u0000' + d.id) ?? '', b = dayOf(fl?.facet?.measured_at as string | undefined), nw = a > b ? a : b;
      if (!nw) { r.undated++; lenses.push({ lens: d.id, kind: 'clear', newest: null }); continue; }
      const age = days(nw, opts.now);
      lenses.push(age > opts.maxAgeDays ? { lens: d.id, kind: 'unproven', newest: nw, ageDays: age } : { lens: d.id, kind: 'clear', newest: nw });
    }
    const conflicts = crossLens(P.lenses, f, lenses);
    let kind: ReadyKind = 'clear';
    for (const l of lenses) if (KIND_RANK[l.kind] > KIND_RANK[kind]) kind = l.kind;
    r.features.push({ id: f.id, kind, lenses, conflicts });
    r.n++;
    if (kind === 'clear') r.clear++; else if (kind === 'unproven') r.unproven++; else if (kind === 'blocked') r.blocked++; else r.withSteps++;
    if (conflicts.length) r.conflicts++;
    for (const l of lenses) if (l.kind === 'steps') for (const s of l.steps) {
      r.steps++;
      if (s.cover.covered && s.cover.best.verdict === 'clears') r.covered++;
      else if (s.cover.covered && s.cover.best.verdict === 'short') r.short++;
    }
  }
  return r;
}

const fmt = (v: Scalar) => String(v);
/**
 * Apply every lens's steps at once and re-read every lens: a lens that reads worse than now, a lens whose steps leave it
 * unwell, or one field asked for incompatible targets by two lenses, each said in words.
 */
function crossLens(lenses: readonly LensDef[], f: Feature, verdicts: readonly LensReady[]): string[] {
  const all = verdicts.flatMap((v) => (v.kind === 'steps' ? v.steps : []));
  if (!all.length) return [];
  const out: string[] = [], name = (id: string) => lenses.find((d) => d.id === id)?.name ?? id;
  // one field, two lenses: an "at most" below another's "at least" (or two different "set to") cannot both hold
  const byField = new Map<string, ReadyStep[]>();
  for (const s of all) { let a = byField.get(s.step.field); if (!a) byField.set(s.step.field, (a = [])); a.push(s); }
  const targets: Record<string, Scalar> = {};
  for (const [k, ss] of byField) {
    let lo = -Infinity, hi = Infinity, set: Scalar | null = null, clash: string | null = null;
    for (const s of ss) {
      const t = s.step.target;
      if (s.step.op === 'at most' && typeof t === 'number') hi = Math.min(hi, t);
      else if (s.step.op === 'at least' && typeof t === 'number') lo = Math.max(lo, t);
      else if (s.step.op === 'set to') { if (set !== null && set !== t) clash = 'set to ' + fmt(set) + ' and to ' + fmt(t); set = t; }
    }
    if (lo > hi) clash = 'at least ' + lo + ' and at most ' + hi;
    if (clash) { out.push(k + ': ' + [...new Set(ss.map((s) => name(s.lens)))].join(' and ') + ' ask for ' + clash + ': both cannot hold'); continue; }
    targets[k] = set ?? (hi !== Infinity ? hi : lo);
  }
  for (const d of lenses) {
    const fl = f.lens[d.id]; if (!fl || !d.manifest?.fields) continue;
    const touched = d.manifest.fields.filter((x) => x.key in targets && !x.source);
    if (!touched.length) continue;
    const values = { ...fl.v } as Record<string, Scalar>;
    for (const x of touched) values[x.key] = targets[x.key];
    const before = fl.h, after = evaluateLens(d.manifest, { values }, '9999-12-31', { feature: f.stage ? { stage: f.stage } : {} }).health;
    const own = verdicts.find((v) => v.lens === d.id)?.kind === 'steps';
    if (RANK[after] > RANK[before]) out.push('Clearing ' + [...new Set(all.filter((s) => s.lens !== d.id && touched.some((x) => x.key === s.step.field)).map((s) => name(s.lens)))].join(' and ') + ' makes ' + d.name + ' ' + after);
    else if (own && after !== 'good' && after !== 'na') out.push('With every step applied ' + d.name + ' still reads ' + after);
  }
  return out;
}

/** The summary line: "1 of 5 clear · 1 unproven · 3 steps, 1 covered, 1 short · 1 blocked" (`long`: the callout's). */
export function readinessLine(r: Readiness, long = false): string {
  const parts = [long ? r.n + ' feature' + (r.n === 1 ? '' : 's') + ': ' + r.clear + ' clear every lens' : r.clear + ' of ' + r.n + ' clear'];
  if (r.unproven) parts.push(r.unproven + ' unproven' + (long ? ' (readings older than ' + r.maxAgeDays + ' d, or none)' : ''));
  if (r.steps) parts.push(r.steps + ' step' + (r.steps === 1 ? '' : 's') + ', ' + r.covered + ' covered, ' + r.short + ' short');
  if (r.blocked) parts.push(r.blocked + ' blocked');
  if (long && r.conflicts) parts.push(r.conflicts + ' with a cross-lens conflict');
  return parts.join(' · ');
}
