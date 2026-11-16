'use client';
// The Plan-tab legend, bold variant. Under a built-in lens it is the sheet's schedule: the lens's sheet number and
// reader, then each total the title blocks state (schedule.ts clauses over the features on this plan) as a row that,
// pressed (click, Enter, Space), flies to the next feature it counts with the highlight; pressed again, the one
// after, wrapping. A row that counts nothing is aria-disabled. General and any lens outside the six built-ins keep
// the shared Legend.
import type { ViewId } from '@bp/core/data';
import { useRef } from 'react';
import { Legend } from '@/components/Legend';
import { Mark } from '@/components/Symbols';
import { useBp, useEngine } from '@/components/hooks';
import { swallow } from '@/components/rail/wide/shell';
import { lensOf } from '@bp/core/model/lens';
import { isBuiltinLens, type BuiltinLens } from '../base/legacy';
import { LENS_NAME } from './palette';
import { goNext, schedule, type ScheduleRow } from './schedule';

function Row({ r }: { r: ScheduleRow }) {
  const E = useEngine(), cur = useRef<string | null>(null);
  const n = r.ids.length, go = () => { if (n) cur.current = goNext(E, r.ids, cur.current); };
  return (
    <button type="button" className="bd-sch-row" aria-disabled={n ? undefined : true}
      aria-label={`${r.words}: ${n} ${n === 1 ? 'feature' : 'features'} on this plan${n ? ', go to next' : ''}`}
      onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { swallow(e); go(); } }}>
      <span className="bd-sch-w">{r.words}</span><span className="bd-sch-n" aria-hidden="true">{n}</span>
    </button>
  );
}

function Sheet({ lens }: { lens: BuiltinLens }) {
  const E = useEngine(), M = E.M, nm = LENS_NAME[lens];
  useBp((s) => s.t);   // the totals speak of the plan as drawn now: a date change re-reads them
  const rows = schedule(lens, M.P.features.filter((f) => M.L.TILE[f.id]));
  return (
    <div className="lg bd-sch">
      <div className="bd-sch-h"><span className="no">{nm.no}</span><span className="nm">{nm.nm}</span><span className="hl">features</span></div>
      {rows.map((r) => <Row key={r.key} r={r} />)}
      <div><Mark k="cloud" /><span>{lensOf(M.P, lens)?.name ?? lens} trouble</span></div>
      <div><Mark k="tick" /><span>Watch</span></div>
    </div>
  );
}

export function BoldLegend({ view }: { view: ViewId }) {
  if (!isBuiltinLens(view)) return <Legend view={view} />;
  // keyed by the lens, so every row's cursor starts over on a lens switch
  return <Sheet key={view} lens={view} />;
}
