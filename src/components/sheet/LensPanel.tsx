'use client';
// The default lens panel in the feature sheet, rendered from the lens manifest: the headline field
// first, then the evidence fields, then the rest, each formatted by its type and unit. Rows carry a
// tier (0 = headline, 1 = evidence, 2 = the rest); how many show follows the reader's density
// (`reader.density`): a lone lens shows 3 rows (simple), 5 (standard) or all (dense); in General every
// panel shows 3; when another lens is chosen, panels collapse to the headline. Under the rows: the
// matched rule's reason, and an override with who, why and until. Feature-bound fields (stage,
// priority...) are core fields shown elsewhere in the sheet, so they are not repeated here. Variants
// can replace this through `ui.SheetPanel` (and may wrap this one).
//
// Metric fields (v3.1, a field with `metric`) are not rows here: `MetricRows` draws them after the
// panel's evidence, for every variant's panel (the sheet places it), from the manifest alone.
import type { Feature, FeatureLens, LensDef, Scalar } from '@/lib/data';
import type { LensField } from '@/lib/standard/types';
import type { ScanSnapshot } from '@/lib/scan/types';
import { baseId, fmtValue, metricHistory, pname, type Model } from '@/lib/model';
import type { SheetPanelProps } from '@/variants/types';

export interface Row { k: string; v: string; c?: 'bad' | 'watch' | ''; tier: 0 | 1 | 2 }

export function lensRows(d: LensDef, fl: FeatureLens | undefined, value: (key: string) => Scalar | undefined): Row[] {
  const out: Row[] = [], seen = new Set<string>();
  const add = (f: LensField | null, tier: 0 | 1 | 2) => {
    if (!f || seen.has(f.key) || (f.source && 'feature' in f.source)) return;
    if (tier === 2 && f.metric) return; // metric fields have their own rows (MetricRows)
    seen.add(f.key);
    const v = value(f.key);
    if (v === undefined && tier === 2) return;
    const hot = fl && (fl.h === 'bad' || fl.h === 'watch') && fl.whyFields.includes(f.key) ? fl.h : '';
    out.push({ k: f.label + (f.source && 'kpi' in f.source ? ' · KPI' : ''), v: fmtValue(f, v), c: hot, tier });
  };
  add(d.headline, 0);
  for (const f of d.evidence) add(f, 1);
  for (const f of d.fields) add(f, 2);
  return out;
}

// ------------------------------------------------------------------------------------ metric rows
const SW = 64, SH = 16;
const nfmt = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('en-US');

/** A 64x16 sparkline of a metric's readings, with the target as a dashed tick when the manifest sets one. */
export function Spark({ pts, target, cls }: { pts: readonly number[]; target?: number; cls: string }) {
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (target !== undefined) { lo = Math.min(lo, target); hi = Math.max(hi, target); }
  const span = hi - lo || 1, x = (i: number) => 1 + (i / (pts.length - 1)) * (SW - 4), y = (v: number) => SH - 2 - ((v - lo) / span) * (SH - 4);
  const d = pts.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  return (
    <svg className={'spk ' + cls} width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`} aria-hidden="true">
      {target !== undefined && <line className="tg" x1={0} x2={SW} y1={y(target)} y2={y(target)} />}
      <path d={d} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={1.8} />
    </svg>
  );
}

export interface MetricRow { field: LensField; value: number | undefined; prev: number | undefined; pts: number[]; unit: string; method: string }

/**
 * A lens's metric fields for one feature. History is the scan's readings of that feature, lens and
 * metric, oldest first (a live product); without one, the facet value is the single point. The value
 * is the latest reading, else the facet's.
 */
export function metricRows(d: LensDef, f: Feature, model: Model, scan: ScanSnapshot | undefined): MetricRow[] {
  const out: MetricRow[] = [], id = baseId(f.id);
  for (const fd of d.fields) {
    const m = fd.metric; if (!m) continue;
    const h = metricHistory(scan, id, d.id, fd.key), fv = model.sim.liveValue(f, d.id, fd.key);
    const pts = h.length ? h.map((x) => x.value) : typeof fv === 'number' ? [fv] : [];
    const last = h[h.length - 1];
    // the manifest's unit when it has one (fmtValue adds it), else the reading's
    const unit = fd.unit || fd.type === 'percent' || !last?.unit || last.unit === '%' ? '' : ' ' + last.unit;
    out.push({ field: fd, value: pts[pts.length - 1], prev: pts.length > 1 ? pts[pts.length - 2] : undefined, pts, unit, method: last?.method ?? m.method });
  }
  return out;
}

/**
 * The metric rows under a lens panel: value and unit, an arrow against the previous reading coloured
 * by the manifest's `better` (good or bad), the target, the method, and the sparkline (two readings or
 * more; one shows the value only). `all` (the lens stands alone): every metric field, unmeasured ones
 * as '—'; otherwise (General) the measured ones, at most three.
 */
export function MetricRows({ def, f, model, scan, all, fl }: { def: LensDef; f: Feature; model: Model; scan: ScanSnapshot | undefined; all: boolean; fl: FeatureLens | undefined }) {
  const rows = metricRows(def, f, model, scan);
  if (!rows.length) return null;
  const measured = rows.filter((r) => r.value !== undefined), shown = all ? rows : measured.slice(0, 3), more = (all ? 0 : measured.length - shown.length);
  if (!shown.length) return null;
  return (
    <div className="mrs">
      {shown.map((r) => {
        const m = r.field.metric!, v = r.value, moved = v !== undefined && r.prev !== undefined && v !== r.prev;
        const dir = moved ? (v! > r.prev! ? 'up' : 'down') : null, cls = dir ? (dir === m.better ? 'good' : 'bad') : '';
        const hot = fl && (fl.h === 'bad' || fl.h === 'watch') && fl.whyFields.includes(r.field.key) ? fl.h : '';
        const tip = v === undefined ? 'Not measured' : (r.pts.length > 1 ? r.pts.length + ' readings, the latest ' : 'One reading: ') + fmtValue(r.field, v) + r.unit + (dir ? ', ' + dir + ' from ' + fmtValue(r.field, r.prev!) + ' (' + (cls === 'good' ? 'better' : 'worse') + ')' : '');
        return (
          <div key={r.field.key} className="r mr" title={tip}>
            <span>{r.field.label}</span>
            <b className={hot}>{dir && <i className={'ar ' + cls} aria-label={cls === 'good' ? 'better' : 'worse'}>{dir === 'up' ? '▲' : '▼'}</i>}{fmtValue(r.field, v)}{v !== undefined ? r.unit : ''}</b>
            <span className="mx">
              {r.pts.length > 1 ? <Spark pts={r.pts} target={m.target} cls={cls} /> : null}
              {m.target !== undefined && <em className="tgt">target {nfmt(m.target)}</em>}
              <em className="mth">{r.method}</em>
            </span>
          </div>
        );
      })}
      {more > 0 && <div className="more">{more} more metric{more > 1 ? 's' : ''} in the lens reading</div>}
    </div>
  );
}

export const hmark = (h: string) => (h === 'bad' ? 'BAD' : h === 'watch' ? 'WATCH' : h === 'good' ? 'GOOD' : h === 'na' ? 'N/A' : 'NOT MEASURED');
const LIMIT = { simple: 3, standard: 5, dense: Infinity } as const;

export function DefaultLensPanel({ lens, def, f, model, density, expanded, view }: SheetPanelProps) {
  const fl = f.lens[lens];
  const rows = lensRows(def, fl, (k) => model.sim.liveValue(f, lens, k));
  const limit = expanded ? LIMIT[density] : view === 'general' ? 3 : 1;
  const shown = rows.slice(0, limit), hidden = rows.length - shown.length;
  const h = fl?.h ?? 'unmeasured';
  return (
    <>
      <h5><span>{def.short} · {def.name}</span><span className="h">{hmark(h)}</span></h5>
      {h === 'unmeasured' && !fl?.facet ? <div className="note">No {def.name.toLowerCase()} facet for this feature yet.</div>
        : h === 'na' ? <div className="note">This lens does not apply to this feature.</div> : null}
      {shown.map((r) => <div key={r.k} className={r.tier === 0 ? 'r key' : 'r'}><span>{r.k}</span><b className={r.c || ''}>{r.v}</b></div>)}
      {limit > 1 && fl?.ov ? <div className="note ov"><b>Held at {fl.ov.health.toUpperCase()}</b> by {pname(model.P, fl.ov.by)} until {fl.ov.until}: {fl.ov.why}</div> : null}
      {limit > 1 && fl?.why ? <div className="note">{fl.ov ? 'The rules say: ' : 'Why: '}{fl.why}</div> : null}
      {hidden > 0 && expanded && <div className="more">{hidden} more in the dense reading</div>}
    </>
  );
}
