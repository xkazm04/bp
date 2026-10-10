'use client';
// Bold's feature-sheet panels: one layout per reader. In General (and when collapsed under another lens)
// every panel is the calm default; the panel of the chosen lens becomes its reader's document:
//   design       an artboard: one big fact, the fidelity ladder, generous space
//   development  a terminal: mono, dense key/value pairs, every technical fact
//   business     plain sentences about money and customers
//   operations   live gauges (rollout, SLO, errors) that move with the simulation
//   security     the data class ladder, the review seal, findings
//   quality      the checklist of end-to-end tests and the bug counts
import { DefaultLensPanel, hmark } from '@/components/sheet/LensPanel';
import { useBp } from '@/components/hooks';
import type { SheetPanelProps } from '../types';
import { LENS_NAME } from './palette';
import { CHANNELS } from './channels';
import { bl, hof, isBuiltinLens, type BuiltinLens } from '../base/legacy';

function Head({ p, label }: { p: SheetPanelProps; label: string }) {
  const h = hof(p.f, p.lens), n = LENS_NAME[p.lens as BuiltinLens];
  return <div className="bd-h"><span className="no">{n.no}</span><span className="nm">{label}</span><span className={'hl ' + h}>{hmark(h)}</span></div>;
}
const usd = (n: number) => '$' + n.toLocaleString('en-US');

// ------------------------------------------------------------------------------------------ design
const FID = ['sketch', 'wireframe', 'hi-fi', 'implemented', 'polished'];
const FID_WORD: Record<string, string> = { none: 'No design yet', sketch: 'A sketch', wireframe: 'Wireframed', 'hi-fi': 'Hi-fi design ready', implemented: 'Built to the design', polished: 'Polished', 'n/a': 'No screen to design' };
function DesignBoard({ p }: { p: SheetPanelProps }) {
  const de = bl(p.f).design, lv = FID.indexOf(de.status);
  const fact = de.a11y === 'fail' ? 'Fails accessibility' : de.specDrift ? 'Built differently from the design' : FID_WORD[de.status] ?? de.status;
  const bad = de.a11y === 'fail' || de.specDrift;
  return (
    <div className="bd-panel bd-design">
      <Head p={p} label="Artboard" />
      <div className="bd-board">
        <i className="cm tl" /><i className="cm tr" /><i className="cm bl" /><i className="cm br" />
        <div className={'bd-fact' + (bad ? ' bad' : '')}>{fact}</div>
        {de.status !== 'n/a' && (
          <ol className="bd-ladder" aria-label="Design fidelity">
            {FID.map((s, i) => <li key={s} className={i <= lv ? 'on' : ''} aria-current={i === lv ? 'step' : undefined}><i />{s === 'implemented' ? 'built' : s}</li>)}
          </ol>
        )}
      </div>
      <div className="bd-quiet">Accessibility: {de.a11y === 'unknown' ? 'not checked yet' : de.a11y === 'n/a' ? 'not applicable' : de.a11y === 'pass' ? 'passes' : de.a11y}</div>
    </div>
  );
}

// ------------------------------------------------------------------------------------- development
function bar(pct: number, n = 20) { const on = Math.round((pct / 100) * n); return '█'.repeat(on) + '░'.repeat(n - on); }
function Terminal({ p }: { p: SheetPanelProps }) {
  const f = p.f, dv = bl(f).development;
  useBp((s) => s.simV);
  const prog = Math.round(p.model.sim.progOf(f));
  const rows: [string, string, string?][] = [
    ['status', dv.status],
    ['progress', prog + '%'],
    ['human_review', dv.humanReviewed === true ? 'yes' : dv.humanReviewed === false ? 'NO' : '-', dv.humanReviewed === false ? 'bad' : ''],
    ['agent_written', dv.aiAuthoredPct + '%'],
    ['unit_coverage', dv.unitCoveragePct != null ? dv.unitCoveragePct + '%' : '-', dv.unitCoveragePct != null && dv.unitCoveragePct < 50 ? 'watch' : ''],
    ['open_prs', String(dv.openPRs)],
    ['tech_debt', (dv.techDebt ?? 0) + '/3', (dv.techDebt ?? 0) >= 2 ? 'watch' : ''],
    ['loc', (dv.linesOfCode || 0).toLocaleString('en-US')],
    ['last_commit', dv.lastCommit || '-'],
    ['built_by', f.builtBy.join(',') || '-'],
    ['stalled', dv.stalled ? 'YES' : 'no', dv.stalled ? 'bad' : ''],
  ];
  return (
    <div className="bd-panel bd-dev">
      <Head p={p} label="Terminal" />
      <div className="bd-term" role="table" aria-label="Development facts">
        <div className="pr" role="caption">$ kettle feature show {f.id} --dev</div>
        {rows.map(([k, v, c]) => <div key={k} className="kv" role="row"><span role="cell">{k}</span><b role="cell" className={c || ''}>{v}{k === 'progress' && <span className="bar"> {bar(prog)}</span>}</b></div>)}
        <div className="pr dim" role="row"><span role="cell">{dv.humanReviewed === false ? '! merge blocked until a human reviews' : '# ok'}</span></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------- business
function Ledger({ p }: { p: SheetPanelProps }) {
  const b = bl(p.f).business, asks = b.customerRequests30d || 0;
  const rev = b.revenueLink === 'direct' ? (b.mrrImpactUsd ? 'It brings in about ' + usd(b.mrrImpactUsd) + ' a month.' : 'It earns money directly.')
    : b.revenueLink === 'retention' ? 'It keeps customers from leaving' + (b.mrrImpactUsd ? ', worth about ' + usd(b.mrrImpactUsd) + ' a month.' : '.')
    : b.revenueLink === 'indirect' ? 'It helps sales indirectly.' : 'It is not tied to revenue.';
  return (
    <div className="bd-panel bd-biz">
      <Head p={p} label="Ledger" />
      <div className="bd-big"><b>{asks}</b><span>{asks === 1 ? 'customer asked for this' : 'customers asked for this'} in the last 30 days</span></div>
      <p>{rev}</p>
      <p>{b.adoptionPct != null ? b.adoptionPct + '% of the 412 studios use it.' : 'Nobody can use it yet.'}</p>
      <div className="bd-pips">{[1, 2, 3, 4, 5].map((i) => <i key={i} aria-hidden="true" className={i <= b.value ? 'on' : ''} />)}<span>value {b.value} of 5 · {b.confidence}</span></div>
      {b.usageNote && <p className="bd-quiet">{b.usageNote}</p>}
    </div>
  );
}

// -------------------------------------------------------------------------------------- operations
function Gauge({ v, max, label, unit, warn }: { v: number | null; max: number; label: string; unit: string; warn?: boolean }) {
  const t = v == null ? 0 : Math.max(0, Math.min(1, v / max)), a = Math.PI * (1 - t);
  const x = 40 + Math.cos(a) * 30, y = 40 - Math.sin(a) * 30;
  return (
    <figure className={'bd-gauge' + (warn ? ' warn' : '')}>
      <svg viewBox="0 0 80 46" width="96" height="55" aria-hidden="true">
        <path d="M10 40 A30 30 0 0 1 70 40" className="tr" />
        {v != null && t > 0 && <path d={`M10 40 A30 30 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} className="val" />}
        {v != null && <line x1="40" y1="40" x2={(40 + Math.cos(a) * 24).toFixed(2)} y2={(40 - Math.sin(a) * 24).toFixed(2)} className="nd" />}
      </svg>
      <figcaption><b>{v == null ? '—' : v + unit}</b><span>{label}</span></figcaption>
    </figure>
  );
}
function Control({ p }: { p: SheetPanelProps }) {
  useBp((s) => s.simV);
  const f = p.f, op = bl(f).operations, prod = op.environment === 'production';
  const roll = prod ? (op.flag ? p.model.sim.rolloutOf(f) : 100) : null;
  return (
    <div className="bd-panel bd-ops">
      <Head p={p} label="Control room" />
      <div className="bd-gauges">
        <Gauge v={roll} max={100} label={prod ? 'rollout' : op.environment === 'none' ? 'not deployed' : 'on ' + op.environment} unit="%" />
        <Gauge v={op.p95ms} max={800} label="p95 latency" unit=" ms" warn={(op.p95ms ?? 0) > 500} />
        <Gauge v={op.errorRatePct} max={2} label="error rate" unit="%" warn={(op.errorRatePct ?? 0) > 1} />
      </div>
      <div className="bd-lights">
        <span className={op.alerting ? 'ok' : prod ? 'bad' : ''}><i />alerting {op.alerting ? 'on' : 'off'}</span>
        <span className={op.runbook ? 'ok' : prod ? 'watch' : ''}><i />runbook {op.runbook ? 'yes' : 'no'}</span>
        <span className={op.incidents30d ? 'bad' : 'ok'}><i />{op.incidents30d || 0} incidents · 30 d</span>
        <span><i />SLO {op.sloActual ?? '—'} / {op.sloTarget ?? '—'}</span>
        <span><i />${op.costUsdMonth ?? 0} a month</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------- security
const CLASSES = ['public', 'internal', 'personal', 'payment'];
const CLASS_WORD: Record<string, string> = { public: 'Public', internal: 'Internal', personal: 'Personal data', payment: 'Card data' };
const REV_WORD: Record<string, string> = { 'not-required': 'No review needed', 'not-started': 'Not reviewed', pending: 'Review pending', passed: 'Review passed', findings: 'Open findings' };
function Perimeter({ p }: { p: SheetPanelProps }) {
  const se = bl(p.f).security, ci = CLASSES.indexOf(se.dataClass);
  const sensitive = ci >= 2, open = se.review === 'pending' || se.review === 'not-started';
  return (
    <div className="bd-panel bd-sec">
      <Head p={p} label="Perimeter" />
      <div className="bd-seal-row">
        <div className={'bd-seal ' + se.review}><span>{se.review === 'findings' ? se.openFindings : se.review === 'passed' ? '✓' : se.review === 'not-required' ? '—' : '?'}</span></div>
        <div><b>{REV_WORD[se.review] ?? se.review}</b><span>{se.openFindings ? se.openFindings + ' open finding' + (se.openFindings === 1 ? '' : 's') : 'no open findings'}{sensitive && open ? ' · handles ' + CLASS_WORD[se.dataClass].toLowerCase() + ' without a review' : ''}</span></div>
      </div>
      <ol className="bd-classes" aria-label="Data class">
        {CLASSES.map((c, i) => <li key={c} className={(i === ci ? 'on' : '') + (i <= ci ? ' in' : '')} aria-current={i === ci ? 'step' : undefined}>{CLASS_WORD[c]}</li>)}
      </ol>
    </div>
  );
}

// ----------------------------------------------------------------------------------------- quality
function Inspection({ p }: { p: SheetPanelProps }) {
  const q = bl(p.f).quality, b = q.openBugs, n = q.e2eTests;
  return (
    <div className="bd-panel bd-qa">
      <Head p={p} label="Inspection" />
      <div className="bd-checks" role="group" aria-label={n ? q.e2ePassing + ' of ' + n + ' end-to-end tests pass' : 'No end-to-end tests'}>
        {n ? Array.from({ length: n }, (_, i) => <i key={i} className={i < q.e2ePassing ? 'ok' : 'bad'} />) : <i className="none" />}
        <span><b>{n ? q.e2ePassing + ' / ' + n : 'No'}</b> end-to-end tests {n ? 'pass' : 'yet'} · {q.status}</span>
      </div>
      <div className="bd-bugs">
        <div className={b.p1 ? 'bad' : ''}><b>{b.p1}</b><span>P1 bugs</span></div>
        <div className={b.p2 ? 'watch' : ''}><b>{b.p2}</b><span>P2 bugs</span></div>
        <div><b>{b.p3}</b><span>P3 bugs</span></div>
      </div>
    </div>
  );
}

/** Collapsed under another lens: the header plus this lens's key fact, in its reader's voice. */
function Mini({ p }: { p: SheetPanelProps & { lens: BuiltinLens } }) {
  const f = p.f, sim = p.model.sim;
  const c = CHANNELS[p.lens].content(f, { rolloutPct: sim.rolloutOf(f), progressPct: bl(f).development.progressPct, value: (l, k) => sim.liveValue(f, l, k) });
  const sans = p.lens === 'business' || p.lens === 'design';
  return (
    <>
      <div className="bd-h"><span className="no">{LENS_NAME[p.lens].no}</span><span className="nm">{LENS_NAME[p.lens].nm}</span><span className={'hl ' + hof(p.f, p.lens)}>{hmark(hof(p.f, p.lens))}</span></div>
      <div className={'bd-mini' + (sans ? ' sans' : '')}>{c.parts.slice(0, 2).join(' · ')}</div>
    </>
  );
}

export function BoldPanel(p: SheetPanelProps) {
  // a lens other than the six built-ins: the default, manifest-driven panel
  const lens = p.lens;
  if (!isBuiltinLens(lens)) return <DefaultLensPanel {...p} />;
  if (!p.expanded) return p.view === 'general' ? <DefaultLensPanel {...p} /> : <Mini p={{ ...p, lens }} />;
  switch (lens) {
    case 'design': return <DesignBoard p={p} />;
    case 'development': return <Terminal p={p} />;
    case 'business': return <Ledger p={p} />;
    case 'operations': return <Control p={p} />;
    case 'security': return <Perimeter p={p} />;
    default: return <Inspection p={p} />;
  }
}

