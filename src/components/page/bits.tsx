'use client';
// Small pieces the feature page's tabs share: a field value that counts, the health word, the
// lifecycle ladder, and the KPIs a lens is bound to on this feature.
import type { Feature, Scalar } from '@/lib/data';
import type { LensField } from '@/lib/standard/types';
import { STAGES } from '@/lib/standard/load';
import { STAGE_WORD, fmtValue, type Model } from '@/lib/model';
import { Count } from './motion';

export const HWORD: Record<string, string> = { bad: 'Bad', watch: 'Watch', good: 'Good', na: 'Does not apply', unmeasured: 'Not measured' };

/** A lens field's value: numbers count (integers, percents, money, ms...), booleans and enums do not. */
export function Val({ k, field, v, unit = '' }: { k: string; field: LensField; v: Scalar | undefined; unit?: string }) {
  if (typeof v !== 'number') return <>{fmtValue(field, v)}{v !== undefined && v !== null ? unit : ''}</>;
  const whole = Number.isInteger(v);
  return <Count k={k} v={v} fmt={(n) => fmtValue(field, whole ? Math.round(n) : n) + unit} />;
}

/** Where the feature is in its life: the stages in order, the current one marked; build or rollout percent when it has one. */
export function StageLadder({ f, M }: { f: Feature; M: Model }) {
  const st = f.stage, sim = M.sim;
  const pct = st === 'in-dev' ? Math.round(sim.progOf(f)) : st === 'flagged' ? sim.rolloutOf(f) : null;
  const steps = STAGES.filter((s) => s !== 'deprecated' || st === 'deprecated'), at = st ? steps.indexOf(st) : -1;
  return (
    <div className="pg-stage" aria-label={'Stage: ' + (st ? STAGE_WORD[st] : 'unknown')}>
      <ol>{steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'cur' : ''}><i />{STAGE_WORD[s]}</li>)}</ol>
      {pct !== null && (
        <span className="pct" title={st === 'in-dev' ? 'Build progress' : 'Rollout'}>
          <span className="bar"><i style={{ width: pct + '%' }} /></span>
          <b><Count k={f.id + ':stage%'} v={pct} fmt={(n) => Math.round(n) + '%'} /></b>{st === 'in-dev' ? ' built' : ' rolled out'}
        </span>
      )}
      {!st && <span className="pct">Stage unknown</span>}
    </div>
  );
}

/** The KPIs bound to a lens that speak about this feature: scoped to it or its context, or read by one of the lens's fields. */
export function lensKpis(M: Model, f: Feature, lens: string) {
  const d = M.P.LENS[lens], read = new Set<string>();
  for (const x of d?.fields ?? []) if (x.source && 'kpi' in x.source) read.add(x.source.kpi);
  return M.P.base.kpis.filter((k) => {
    if (read.has(k.slug)) return true;
    if (k.lens !== lens) return false;
    const s = k.scope as Record<string, unknown>;
    return s.feature === f.slug || (typeof s.context === 'string' && f.contexts.includes(s.context));
  });
}

export function KpiRows({ M, f, lens }: { M: Model; f: Feature; lens: string }) {
  const ks = lensKpis(M, f, lens);
  if (!ks.length) return null;
  return (
    <div className="pg-kpis">
      <h4>KPI{ks.length > 1 ? 's' : ''} · {ks.length}</h4>
      {ks.map((k) => {
        const v = k.current?.value, u = k.unit ? (k.unit === '%' ? '%' : ' ' + k.unit) : '';
        const fmt = (n: number) => (Number.isInteger(v) ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US') + u;
        return (
          <div key={k.slug} className="kpi">
            <span className="nm">{k.name}{k.status ? <em>{k.status}</em> : null}</span>
            <b>{typeof v === 'number' ? <Count k={f.id + ':kpi:' + k.slug} v={v} fmt={fmt} /> : 'Not measured'}</b>
            <span className="mx">
              {k.baseline !== undefined && <em>from {fmt(k.baseline)}</em>}
              {k.target !== undefined && <em>target {fmt(k.target)}{k.target_date ? ' by ' + k.target_date : ''}</em>}
              {k.direction && <em>{k.direction === 'up' ? 'higher is better' : 'lower is better'}</em>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
