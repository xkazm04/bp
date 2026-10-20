'use client';
// One lens's tab on the feature page: that lens only, laid out for its reader, from the manifest.
// The headline first and big, the health and the matched rule's reason big beside it, then the
// evidence fields, then the rest (how many follows the reader's density: a simple reader gets a few
// and the rest folded away, a dense one gets everything open), then the metric rows with sparklines,
// each with the latest reading's evidence text under it (the bottleneck behind a capacity estimate,
// the cases behind a count; two lines, "more" opens the rest), then what already exists for this lens
// on this feature: its KPIs, the questions and orders that name it, the Screens strip (a lens with
// harness-measured metrics, when the scan has shots; a feature the harness could not render says why,
// from the scan's "unscreenable: <why>" note), the Business
// section (a lens whose reader role is business). Blocks are chosen by data, never by lens id. A
// variant's `ui.SheetPanel` replaces the body (headline to the rest) as it replaced the sheet panel.
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Feature } from '@bp/core/data';
import type { Density } from '@/engine/lens/contract';
import { DENSITY_COUNT, hotHealth, reasonOf } from '@bp/core/standard/present';
import { baseId, fmtValue, metricHistory, pname, shotsByRun, type Model } from '@bp/core/model';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { BusinessSection } from '../sheet/Business';
import { ScreensStrip } from '../sheet/Screens';
import { SwarmSection } from '../sheet/SheetBody';
import { MoveArrow, Spark, metricMove, metricRows, nfmt } from '../sheet/LensPanel';
import { useDensity, useEngine, useLive, useVariant } from '../hooks';
import { NOT_RECORDED } from '@bp/core/model/timeview';
import { HWORD, KpiRows, Val, useAsOf, useHeadlineAt, useSimSig } from './bits';
import { Sec, Stagger } from './motion';

/** A reading's evidence text: two lines, and "more" when it runs longer (the toggle shows only then). */
function EvidenceText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false), [long, setLong] = useState(false);
  useLayoutEffect(() => { const el = ref.current; if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1); }, [text, open]);
  return (
    <div className={'evd' + (open ? ' open' : '')}>
      <p ref={ref}>{text}</p>
      {long || open ? <button type="button" className="more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'less' : 'more'}</button> : null}
    </div>
  );
}

/** The latest reading's evidence for a metric (on a past date: the latest by then); undefined when it has none. */
function evidenceOf(scan: ScanSnapshot | undefined, f: Feature, lens: string, key: string, t: string, past: boolean): string | undefined {
  const h = metricHistory(scan, baseId(f.id), lens, key);
  for (let i = h.length - 1; i >= 0; i--) if (!past || h[i].measured_at.slice(0, 10) <= t) return h[i].evidence?.trim() || undefined;
  return undefined;
}

/** The lens's metric fields as rows: value (counting), the move against the previous reading, target, method, sparkline,
 *  and the latest reading's evidence text. */
const Metrics = memo(function Metrics({ lens, f, M, scan, all, sig }: { lens: string; f: Feature; M: Model; scan: ScanSnapshot | undefined; all: boolean; sig: string }) {
  // rows depend on the scan, the feature and the sim's live values (sig): nothing else moves them
  const d = M.P.LENS[lens], { t, now } = useAsOf(), rows = useMemo(() => metricRows(d, f, M, scan, { t, now }), [d, f, M, scan, sig, t, now]), fl = f.lens[lens];  // eslint-disable-line react-hooks/exhaustive-deps
  const shown = all || t < now ? rows : rows.filter((r) => r.value !== undefined);
  if (!shown.length) return null;
  const measured = shown.filter((r) => r.value !== undefined).length;
  return (
    <div className="pg-mrs">
      <h4>Measured · {measured === shown.length ? shown.length + ' metric' + (shown.length > 1 ? 's' : '') : measured + ' of ' + shown.length + ' metrics'}{scan ? ' · from the scan' : ''}</h4>
      {shown.map((r) => {
        const m = r.field.metric!, v = r.value, { dir, cls } = metricMove(r), hot = hotHealth(fl, r.field.key);
        const ev = evidenceOf(scan, f, lens, r.field.key, t, t < now);
        return (
          <div key={r.field.key} className={'mr ' + hot}>
            <span className="nm">{r.field.label}<em className="mth">{r.method}</em></span>
            <span className="sp">{r.pts.length > 1 ? <Spark pts={r.pts} target={m.target} cls={cls} /> : <span className="one">{r.pts.length ? 'one reading' : 'not measured'}</span>}</span>
            <b className={hot}><MoveArrow dir={dir} cls={cls} /><Val k={f.id + ':' + lens + ':' + r.field.key} field={r.field} v={v} unit={r.unit} /></b>
            <span className="tg">{m.target !== undefined ? 'target ' + nfmt(m.target) : ''}{dir ? (m.target !== undefined ? ' · ' : '') + 'was ' + fmtValue(r.field, r.prev!) : ''}</span>
            {ev ? <EvidenceText text={ev} /> : null}
          </div>
        );
      })}
    </div>
  );
});

const Body = memo(function Body({ lens, f, M, density }: { lens: string; f: Feature; M: Model; density: Density; sig: string }) {
  const d = M.P.LENS[lens], fl = f.lens[lens], sim = M.sim, { t, past } = useAsOf(), at = useHeadlineAt(f, d);
  // on a past date health has no history; the headline is the scan's reading by then, else nothing
  const h = past ? 'unmeasured' : fl?.h ?? 'unmeasured', then = at.at === 'then' ? at : null;
  const val = (k: string) => sim.liveValue(f, lens, k);
  // core feature-bound fields (stage, priority) live in the page header, not here
  const own = (x: (typeof d.fields)[number]) => !(x.source && 'feature' in x.source);
  const hf = d.headline && own(d.headline) ? d.headline : null;
  const ev = past ? [] : d.evidence.filter((x) => own(x) && x !== hf), evShown = ev.slice(0, DENSITY_COUNT.page[density]);
  const seen = new Set([hf?.key, ...evShown.map((x) => x.key)]);
  const rest = past ? [] : d.fields.filter((x) => own(x) && !x.metric && !seen.has(x.key) && val(x.key) !== undefined);
  const hot = (key: string) => hotHealth(fl, key);
  const restRows = rest.map((x) => <div key={x.key} className="r"><span>{x.label}{x.source && 'kpi' in x.source ? ' · KPI' : ''}</span><b className={hot(x.key)}><Val k={f.id + ':' + lens + ':' + x.key} field={x} v={val(x.key)} /></b></div>);
  return (
    <>
      <Sec className={'pg-hero ' + h} label="Headline and health">
        <div className="hl">
          <span className="lab">{hf ? hf.label : d.name}</span>
          <b className={'big ' + (hf && !past ? hot(hf.key) : '')}>{hf && (past ? then : fl?.h !== 'na') ? <Val k={f.id + ':' + lens + ':' + hf.key} field={hf} v={then ? then.value : val(hf.key)} /> : '—'}</b>
          {d.description ? <span className="desc">{d.description}</span> : null}
        </div>
        <div className="hh">
          <span className="hw">{past ? 'Not recorded' : HWORD[h]}</span>
          <p className="why">{past ? (then ? 'Read on ' + then.measured + '. Health is not recorded for that date.' : NOT_RECORDED + ' (' + t + ').') : h === 'na' ? 'This lens does not apply to this feature.' : h === 'unmeasured' && !fl?.facet ? 'No ' + d.name.toLowerCase() + ' reading for this feature yet.' : (fl && reasonOf(fl)) ?? 'No rule raised anything: it reads ' + HWORD[h].toLowerCase() + '.'}</p>
          {!past && fl?.ov ? <p className="ov"><b>Held at {fl.ov.health.toUpperCase()}</b> by {pname(M.P, fl.ov.by)} until {fl.ov.until}{fl.why ? '. The rules say: ' + fl.why : ''}</p> : null}
        </div>
      </Sec>
      {past ? <Sec label="Not recorded"><p className="pg-nr">Evidence and the other fields are not kept by date. Measured metrics below show their readings up to {t}.</p></Sec> : null}
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
});

const UNSCREENABLE = /^unscreenable:\s*/i;
/** "Not screenable in a browser: <why>" when the scan noted the harness could not render this feature (an activity
 *  `note` "unscreenable: <why>" on this lens, or on no lens) and it has no shots. Newest note wins. */
function Unscreenable({ f, lens, scan }: { f: Feature; lens: string; scan: ScanSnapshot | undefined }) {
  const why = useMemo(() => {
    if (!scan) return null;
    const id = baseId(f.id);
    if (shotsByRun(scan, id).length) return null;
    let best: { at: string; text: string } | null = null;
    for (const a of scan.activity) {
      if (a.kind !== 'note' || a.feature !== id || (a.lens && a.lens !== lens) || !UNSCREENABLE.test(a.text)) continue;
      if (!best || a.at > best.at) best = { at: a.at, text: a.text.replace(UNSCREENABLE, '').trim() };
    }
    return best;
  }, [scan, f.id, lens]);
  if (!why) return null;
  return <p className="pg-unscr">Not screenable in a browser: {why.text || 'the harness gave no reason'}</p>;
}

export function LensTab({ lens, f }: { lens: string; f: Feature }) {
  const E = useEngine(), M = E.M, V = useVariant(), dens = useDensity(), live = useLive(), { past } = useAsOf();
  // what this tab reads from the sim is the lens's field values for this feature (the swarm section has its own
  // signature): the string changes exactly when one of them does, so a sim tick elsewhere re-renders nothing here
  const d = M.P.LENS[lens];
  const sig = useSimSig((sm) => (d ? d.fields.map((x) => String(sm.liveValue(f, lens, x.key))).join('|') : ''));
  if (!d) return null;
  const density = dens(lens), scan = live?.product.scan, fl = f.lens[lens];
  const Panel = V.ui?.SheetPanel;
  // attachments, by data: screens belong to a lens that measures through the harness; Business to a business reader
  const shots = d.fields.some((x) => x.metric?.method === 'harness');
  const biz = d.role === 'business';
  return (
    <Stagger className={'pg-lens d-' + density}>
      {Panel
        ? <Sec className={'evp cur pg-vpanel ' + (fl?.h ?? 'unmeasured')} label={d.name}><Panel lens={lens} def={d} f={f} model={M} density={density} expanded view={lens} /></Sec>
        : <Body lens={lens} f={f} M={M} density={density} sig={sig} />}
      <Sec label="Metrics"><Metrics lens={lens} f={f} M={M} scan={scan} all={density !== 'simple'} sig={sig} /></Sec>
      {past ? null : <Sec label="KPIs"><KpiRows M={M} f={f} lens={lens} /></Sec>}
      <Sec label="Questions and orders"><SwarmSection f={f} lens={lens} /></Sec>
      {shots ? <Sec label="Screens"><ScreensStrip f={f} /><Unscreenable f={f} lens={lens} scan={scan} /></Sec> : null}
      {biz ? <Sec label="Business"><BusinessSection f={f} /></Sec> : null}
    </Stagger>
  );
}
