'use client';
// The default lens panel in the feature sheet, rendered from the lens manifest: the headline field
// first, then the evidence fields, then the rest, each formatted by its type and unit. Rows carry a
// tier (0 = headline, 1 = evidence, 2 = the rest); how many show follows the reader's density
// (`reader.density`): a lone lens shows 3 rows (simple), 5 (standard) or all (dense); in General every
// panel shows 3; when another lens is chosen, panels collapse to the headline. Under the rows: the
// matched rule's reason, and an override with who, why and until. Feature-bound fields (stage,
// priority...) are core fields shown elsewhere in the sheet, so they are not repeated here. Variants
// can replace this through `ui.SheetPanel` (and may wrap this one).
import type { FeatureLens, LensDef, Scalar } from '@/lib/data';
import type { LensField } from '@/lib/standard/types';
import { fmtValue, pname } from '@/lib/model';
import type { SheetPanelProps } from '@/variants/types';

export interface Row { k: string; v: string; c?: 'bad' | 'watch' | ''; tier: 0 | 1 | 2 }

export function lensRows(d: LensDef, fl: FeatureLens | undefined, value: (key: string) => Scalar | undefined): Row[] {
  const out: Row[] = [], seen = new Set<string>();
  const add = (f: LensField | null, tier: 0 | 1 | 2) => {
    if (!f || seen.has(f.key) || (f.source && 'feature' in f.source)) return;
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

const hmark = (h: string) => (h === 'bad' ? 'BAD' : h === 'watch' ? 'WATCH' : h === 'good' ? 'GOOD' : h === 'na' ? 'N/A' : 'NOT MEASURED');
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
