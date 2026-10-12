'use client';
// Small pieces the feature page's tabs share: a field value that counts, the health word, the
// lifecycle ladder, and the KPIs a lens is bound to on this feature.
import { useMemo } from 'react';
import type { Feature, Scalar } from '@/lib/data';
import type { Health, Kpi, LensField } from '@/lib/standard/types';
import { STAGES } from '@/lib/standard/load';
import { STAGE_WORD, fmtValue, baseId, type Model } from '@/lib/model';
import { NOT_RECORDED, stageView, valueView, type ValueAsOf } from '@/lib/model/timeview';
import type { LensDef } from '@/lib/data';
import type { SwarmSim } from '@/lib/model';
import { useBp, useEngine, useLive } from '../hooks';
import kettleMap from '@/data/kettle.app-structure.json';
import { Count } from './motion';

/**
 * A string read off the simulation, re-evaluated on every store change and compared by value: the component
 * re-renders only when the string changes. `sel` must return everything the component reads from `sim`
 * (so the string changing is exactly "something this component shows changed"), and nothing else.
 */
export function useSimSig(sel: (sim: SwarmSim) => string): string {
  const E = useEngine();
  return useBp(() => sel(E.M.sim));
}

/** The date the page shows: `past` when the plan has been travelled back from the data's now. */
export function useAsOf(): { t: string; now: string; past: boolean } {
  const E = useEngine(), t = useBp((s) => s.t), now = E.M.P.asOf;
  return { t, now, past: t < now };
}

/** A lens's headline on the page's date: what the history records, else "not recorded" (never the now-value). */
export function useHeadlineAt(f: Feature, d: LensDef): ValueAsOf {
  const { t, now } = useAsOf(), scan = useLive()?.product.scan;
  return d.headline ? valueView(scan, baseId(f.id), d.id, d.headline, t, now) : { at: 'none' };
}

/** The marker over a page that shows a past date: what date, what is dated and what is not, and the way back. */
export function AsOfBar() {
  const E = useEngine(), { t, past } = useAsOf();
  if (!past) return null;
  return (
    <div className="pg-asof" role="status">
      <b>As of {t}</b>
      <span>The stage and measured readings are those of that date; what has no history is marked not recorded. Other sections show the current record.</span>
      <button type="button" className="btn" onClick={() => E.setTime(E.M.P.asOf)}>Back to now</button>
    </div>
  );
}

export { NOT_RECORDED };

/** The health word on a tile and a lens tab. Keyed by the Health union, so a new health is a type error here, not an undefined word. */
export const HWORD: Record<Health, string> = { bad: 'Bad', watch: 'Watch', good: 'Good', na: 'Does not apply', unmeasured: 'Not measured' };

/** A lens field's value: numbers count (integers, percents, money, ms...), booleans and enums do not. */
export function Val({ k, field, v, unit = '' }: { k: string; field: LensField; v: Scalar | undefined; unit?: string }) {
  if (typeof v !== 'number') return <>{fmtValue(field, v)}{v !== undefined && v !== null ? unit : ''}</>;
  const whole = Number.isInteger(v);
  return <Count k={k} v={v} fmt={(n) => fmtValue(field, whole ? Math.round(n) : n) + unit} />;
}

/** Where the feature is in its life: the stages in order, the current one marked; build or rollout percent when it has one. */
export function StageLadder({ f, M }: { f: Feature; M: Model }) {
  const { t, now } = useAsOf(), sv = stageView(f, t, now), st = sv.at === 'now' || sv.at === 'then' ? sv.stage : null, sim = M.sim;
  const isNow = sv.at === 'now';
  const pct = !isNow ? null : st === 'in-dev' ? Math.round(sim.progOf(f)) : st === 'flagged' ? sim.rolloutOf(f) : null;
  const steps = STAGES.filter((s) => s !== 'deprecated' || st === 'deprecated'), at = st ? steps.indexOf(st) : -1;
  return (
    <div className="pg-stage" aria-label={(isNow ? 'Stage: ' : 'Stage on ' + t + ': ') + (st ? STAGE_WORD[st] : sv.at === 'before' ? 'not on the drawing yet' : 'unknown')}>
      <ol>{steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'cur' : ''}><i />{STAGE_WORD[s]}</li>)}</ol>
      {pct !== null && (
        <span className="pct" title={st === 'in-dev' ? 'Build progress' : 'Rollout'}>
          <span className="bar"><i style={{ width: pct + '%' }} /></span>
          <b><Count k={f.id + ':stage%'} v={pct} fmt={(n) => Math.round(n) + '%'} /></b>{st === 'in-dev' ? ' built' : ' rolled out'}
        </span>
      )}
      {sv.at === 'then' && (st === 'in-dev' || st === 'flagged') && <span className="pct">{st === 'in-dev' ? 'Progress' : 'Rollout'}: {NOT_RECORDED.toLowerCase()}</span>}
      {sv.at === 'before' && <span className="pct">Not on the drawing yet on {t}</span>}
      {(sv.at === 'unknown' || (isNow && !st)) && <span className="pct">Stage unknown</span>}
    </div>
  );
}

type KpiHealth = 'bad' | 'watch' | 'good' | null;
export interface KpiView { k: Kpi; rank: 0 | 1 | 2 | 3; hint: string; health: KpiHealth }

/** A context's group by name. The loaded model keeps feature -> context names only, so the groups come from the map itself (the live product's, else Kettle's). */
type GroupOf = (context: string) => string | undefined;
const GROUPS = new WeakMap<object, Map<string, string>>();
export function groupOfIn(contexts: readonly { name: string; group?: string }[] | undefined): GroupOf {
  let m = contexts && GROUPS.get(contexts);
  if (!m) { m = new Map(); for (const c of contexts ?? []) if (c.group) m.set(c.name, c.group); if (contexts) GROUPS.set(contexts, m); }
  const g = m;
  return (c) => g.get(c);
}
const KETTLE_GROUPS = groupOfIn((kettleMap as { contexts?: { name: string; group?: string }[] }).contexts);

/** Where a KPI's scope meets this feature, per the spec's precedence (feature, context, group, project); null when it does not apply. */
function scopeHit(groupOf: GroupOf, f: Feature, k: Kpi): { rank: 0 | 1 | 2 | 3; hint: string } | null {
  const s = k.scope as Record<string, unknown>;
  if (s.feature !== undefined) return s.feature === f.slug ? { rank: 0, hint: 'this feature' } : null;
  if (typeof s.context === 'string') return f.contexts.includes(s.context) ? { rank: 1, hint: 'context ' + s.context } : null;
  if (typeof s.group === 'string') {
    return f.contexts.some((c) => groupOf(c) === s.group) ? { rank: 2, hint: 'group ' + s.group } : null;
  }
  return s.project === true ? { rank: 3, hint: 'whole project' } : null;
}

/**
 * Health of a KPI from its thresholds: `direction` says which way is better (up: at or below warn_at is watch,
 * at or below crit_at is bad; down: the mirror). Without a direction it is read off the thresholds (crit below
 * warn = up); with one threshold and no direction, or none, there is no health. Nothing measured: no health.
 */
export function kpiHealth(k: Kpi): KpiHealth {
  const v = k.current?.value, w = k.warn_at, c = k.crit_at;
  if (typeof v !== 'number' || (w === undefined && c === undefined)) return null;
  const dir = k.direction ?? (w !== undefined && c !== undefined && w !== c ? (c < w ? 'up' : 'down') : null);
  if (!dir) return null;
  const sign = dir === 'up' ? 1 : -1;   // sign * (x - v) >= 0  =  v has reached x on the worse side
  if (c !== undefined && sign * (c - v) >= 0) return 'bad';
  if (w !== undefined && sign * (w - v) >= 0) return 'watch';
  return 'good';
}

/** "4 d ago" for an ISO instant measured before `nowMs`; the day when it is older than a month. */
function ageOf(at: string | undefined, nowMs: number): string | null {
  const t = at ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return null;
  const m = Math.round((nowMs - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : m < 43200 ? Math.round(m / 1440) + ' d ago' : at!.slice(0, 10);
}

/**
 * The KPIs that speak about this feature under a lens: those the lens's fields read, and those tagged with the
 * lens whose scope applies (feature, context, group or project, spec section 7). Narrowest scope first, then name;
 * each carries a scope hint and a health from its thresholds.
 */
export function lensKpis(M: Model, f: Feature, lens: string, groupOf: GroupOf = KETTLE_GROUPS): KpiView[] {
  const d = M.P.LENS[lens], read = new Set<string>(), out: KpiView[] = [];
  for (const x of d?.fields ?? []) if (x.source && 'kpi' in x.source) read.add(x.source.kpi);
  for (const k of M.P.base.kpis) {
    const hit = scopeHit(groupOf, f, k), isRead = read.has(k.slug);
    if (!isRead && !(k.lens === lens && hit)) continue;
    // a KPI read by a field applies whatever its scope; its hint is its own
    const rank = hit?.rank ?? 3, hint = hit?.hint ?? 'read by this lens';
    out.push({ k, rank, hint, health: kpiHealth(k) });
  }
  return out.sort((a, b) => a.rank - b.rank || a.k.name.localeCompare(b.k.name));
}

export function KpiRows({ M, f, lens }: { M: Model; f: Feature; lens: string }) {
  const ctxs = useLive()?.product.structure?.contexts;
  const ks = useMemo(() => lensKpis(M, f, lens, M.live ? groupOfIn(ctxs) : KETTLE_GROUPS), [M, f, lens, ctxs]);
  if (!ks.length) return null;
  const now = M.sim.clockMs();
  return (
    <div className="pg-kpis">
      <h4>KPI{ks.length > 1 ? 's' : ''} · {ks.length}</h4>
      {ks.map(({ k, hint, health }) => {
        const v = k.current?.value, u = k.unit ? (k.unit === '%' ? '%' : ' ' + k.unit) : '';
        const fmt = (n: number) => (Number.isInteger(n) ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US') + u;
        const age = ageOf(k.current?.measured_at, now);
        return (
          <div key={k.slug} className={'kpi ' + (health ?? '')}>
            <span className="nm">{k.name}<em className="sc">{hint}</em>{health === 'bad' || health === 'watch' || health === 'good' ? <em className={'hl ' + health}>{HWORD[health]}</em> : null}{k.status ? <em>{k.status}</em> : null}</span>
            <b className={health === 'bad' || health === 'watch' ? health : ''}>{typeof v === 'number' ? <Count k={f.id + ':kpi:' + k.slug} v={v} fmt={fmt} /> : 'Not measured'}</b>
            <span className="mx">
              {age && <em title={k.current?.measured_at}>measured {age}</em>}
              {k.baseline !== undefined && <em>from {fmt(k.baseline)}</em>}
              {k.target !== undefined && <em>target {fmt(k.target)}{k.target_date ? ' by ' + k.target_date : ''}</em>}
              {k.warn_at !== undefined && <em>watch at {fmt(k.warn_at)}</em>}
              {k.crit_at !== undefined && <em>bad at {fmt(k.crit_at)}</em>}
              {k.direction && <em>{k.direction === 'up' ? 'higher is better' : 'lower is better'}</em>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
