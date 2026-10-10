'use client';
// One lens's tab on the feature page: that lens only, laid out for its reader, from the manifest.
// The headline first and big, the health and the matched rule's reason big beside it, then the
// evidence fields, then the rest (how many follows the reader's density: a simple reader gets a few
// and the rest folded away, a dense one gets everything open), then the metric rows with sparklines,
// then what already exists for this lens on this feature: its KPIs, the questions and orders that name
// it, the Screens strip (a lens with harness-measured metrics, when the scan has shots), the Business
// section (a lens whose reader role is business). Blocks are chosen by data, never by lens id. A
// variant's `ui.SheetPanel` replaces the body (headline to the rest) as it replaced the sheet panel.
import type { Feature } from '@/lib/data';
import type { Density } from '@/engine/lens/contract';
import { fmtValue, pname, type Model } from '@/lib/model';
import type { ScanSnapshot } from '@/lib/scan/types';
import { BusinessSection } from '../sheet/Business';
import { ScreensStrip } from '../sheet/Screens';
import { SwarmSection } from '../sheet/SheetBody';
import { MoveArrow, Spark, hotOf, metricMove, metricRows, nfmt } from '../sheet/LensPanel';
import { useBp, useDensity, useEngine, useLive, useVariant } from '../hooks';
import { HWORD, KpiRows, Val } from './bits';
import { Sec, Stagger } from './motion';

const EVID: Record<Density, number> = { simple: 2, standard: 4, dense: Infinity };

/** The lens's metric fields as rows: value (counting), the move against the previous reading, target, method, sparkline. */
function Metrics({ lens, f, M, scan, all }: { lens: string; f: Feature; M: Model; scan: ScanSnapshot | undefined; all: boolean }) {
  const d = M.P.LENS[lens], rows = metricRows(d, f, M, scan), fl = f.lens[lens];
  const shown = all ? rows : rows.filter((r) => r.value !== undefined);
  if (!shown.length) return null;
  return (
    <div className="pg-mrs">
      <h4>Measured · {shown.length} metric{shown.length > 1 ? 's' : ''}{scan ? ' · from the scan' : ''}</h4>
      {shown.map((r) => {
        const m = r.field.metric!, v = r.value, { dir, cls } = metricMove(r), hot = hotOf(fl, r.field.key);
        return (
          <div key={r.field.key} className={'mr ' + hot}>
            <span className="nm">{r.field.label}<em className="mth">{r.method}</em></span>
            <span className="sp">{r.pts.length > 1 ? <Spark pts={r.pts} target={m.target} cls={cls} /> : <span className="one">{r.pts.length ? 'one reading' : 'not measured'}</span>}</span>
            <b className={hot}><MoveArrow dir={dir} cls={cls} /><Val k={f.id + ':' + lens + ':' + r.field.key} field={r.field} v={v} unit={r.unit} /></b>
            <span className="tg">{m.target !== undefined ? 'target ' + nfmt(m.target) : ''}{dir ? (m.target !== undefined ? ' · ' : '') + 'was ' + fmtValue(r.field, r.prev!) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function Body({ lens, f, M, density }: { lens: string; f: Feature; M: Model; density: Density }) {
  const d = M.P.LENS[lens], fl = f.lens[lens], h = fl?.h ?? 'unmeasured', sim = M.sim;
  const val = (k: string) => sim.liveValue(f, lens, k);
  // core feature-bound fields (stage, priority) live in the page header, not here
  const own = (x: (typeof d.fields)[number]) => !(x.source && 'feature' in x.source);
  const hf = d.headline && own(d.headline) ? d.headline : null;
  const ev = d.evidence.filter((x) => own(x) && x !== hf), evShown = ev.slice(0, EVID[density]);
  const seen = new Set([hf?.key, ...evShown.map((x) => x.key)]);
  const rest = d.fields.filter((x) => own(x) && !x.metric && !seen.has(x.key) && val(x.key) !== undefined);
  const hot = (key: string) => hotOf(fl, key);
  const restRows = rest.map((x) => <div key={x.key} className="r"><span>{x.label}{x.source && 'kpi' in x.source ? ' · KPI' : ''}</span><b className={hot(x.key)}><Val k={f.id + ':' + lens + ':' + x.key} field={x} v={val(x.key)} /></b></div>);
  return (
    <>
      <Sec className={'pg-hero ' + h} label="Headline and health">
        <div className="hl">
          <span className="lab">{hf ? hf.label : d.name}</span>
          <b className={'big ' + (hf ? hot(hf.key) : '')}>{hf && h !== 'na' ? <Val k={f.id + ':' + lens + ':' + hf.key} field={hf} v={val(hf.key)} /> : '—'}</b>
          {d.description ? <span className="desc">{d.description}</span> : null}
        </div>
        <div className="hh">
          <span className="hw">{HWORD[h]}</span>
          <p className="why">{h === 'na' ? 'This lens does not apply to this feature.' : h === 'unmeasured' && !fl?.facet ? 'No ' + d.name.toLowerCase() + ' reading for this feature yet.' : fl?.ov ? fl.ov.why : fl?.why ?? 'No rule raised anything: it reads ' + HWORD[h].toLowerCase() + '.'}</p>
          {fl?.ov ? <p className="ov"><b>Held at {fl.ov.health.toUpperCase()}</b> by {pname(M.P, fl.ov.by)} until {fl.ov.until}{fl.why ? '. The rules say: ' + fl.why : ''}</p> : null}
        </div>
      </Sec>
      {evShown.length ? (
        <Sec label="Evidence">
          <div className="pg-ev">
            {evShown.map((x) => (
              <div key={x.key} className={'ev ' + hot(x.key)}>
                <span className="lab">{x.label}</span>
                <b><Val k={f.id + ':' + lens + ':' + x.key} field={x} v={val(x.key)} /></b>
                {x.description ? <span className="desc">{x.description}</span> : null}
              </div>
            ))}
          </div>
        </Sec>
      ) : null}
      {restRows.length ? (
        <Sec className="pg-rest" label="Other fields">
          {density === 'simple'
            ? <details><summary>{restRows.length} more field{restRows.length > 1 ? 's' : ''}</summary><div className="rows">{restRows}</div></details>
            : <><h4>Also on record · {restRows.length}</h4><div className={'rows' + (density === 'dense' ? ' two' : '')}>{restRows}</div></>}
        </Sec>
      ) : null}
    </>
  );
}

export function LensTab({ lens, f }: { lens: string; f: Feature }) {
  const E = useEngine(), M = E.M, V = useVariant(), dens = useDensity(), live = useLive();
  useBp((s) => s.simV);
  const d = M.P.LENS[lens]; if (!d) return null;
  const density = dens(lens), scan = live?.product.scan, fl = f.lens[lens];
  const Panel = V.ui?.SheetPanel;
  // attachments, by data: screens belong to a lens that measures through the harness; Business to a business reader
  const shots = d.fields.some((x) => x.metric?.method === 'harness');
  const biz = d.role === 'business';
  return (
    <Stagger className={'pg-lens d-' + density}>
      {Panel
        ? <Sec className={'evp cur pg-vpanel ' + (fl?.h ?? 'unmeasured')} label={d.name}><Panel lens={lens} def={d} f={f} model={M} density={density} expanded view={lens} /></Sec>
        : <Body lens={lens} f={f} M={M} density={density} />}
      <Sec label="Metrics"><Metrics lens={lens} f={f} M={M} scan={scan} all={density !== 'simple'} /></Sec>
      <Sec label="KPIs"><KpiRows M={M} f={f} lens={lens} /></Sec>
      <Sec label="Questions and orders"><SwarmSection f={f} lens={lens} /></Sec>
      {shots ? <Sec label="Screens"><ScreensStrip f={f} /></Sec> : null}
      {biz ? <Sec label="Business"><BusinessSection f={f} /></Sec> : null}
    </Stagger>
  );
}
