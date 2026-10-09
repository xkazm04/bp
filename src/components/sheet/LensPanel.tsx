'use client';
// The default lens panel in the feature sheet. Rows carry a tier: 0 = the key fact, 1 = the standard
// reading, 2 = the dense, technical reading. A lone lens shows rows up to its reader's density; in
// General every panel shows the standard reading; when another lens is chosen, panels collapse to the
// key fact. Variants can replace this through `ui.SheetPanel` (and may wrap this one).
import type { Feature, LensId } from '@/lib/data';
import { SHEET } from '@/lib/model';
import type { SheetPanelProps } from '@/variants/types';

export interface Row { k: string; v: string | number; c?: 'bad' | 'watch' | ''; tier: 0 | 1 | 2 }
const DENS = { simple: 0, standard: 1, dense: 2 } as const;

export function lensRows(f: Feature, l: LensId, rollout: number): { rows: Row[]; note?: string } {
  const b = f.business, de = f.design, dv = f.development, op = f.operations, se = f.security, q = f.quality;
  switch (l) {
    case 'business': return {
      rows: [
        { k: 'Value', v: '●●●●●'.slice(0, b.value) + '○○○○○'.slice(0, 5 - b.value), tier: 0 },
        { k: 'Asks · 30 days', v: b.customerRequests30d, tier: 0 },
        { k: 'Revenue', v: b.revenueLink + (b.mrrImpactUsd ? ' · $' + b.mrrImpactUsd.toLocaleString('en-US') : ''), tier: 1 },
        { k: 'Adoption', v: b.adoptionPct != null ? b.adoptionPct + '% of 412' : '—', tier: 1 },
        { k: 'Confidence', v: b.confidence, tier: 2 },
      ], note: b.usageNote,
    };
    case 'design': return {
      rows: [
        { k: 'Design status', v: de.status, c: de.status === 'none' ? 'watch' : '', tier: 0 },
        { k: 'Accessibility', v: de.a11y, c: de.a11y === 'fail' ? 'bad' : de.a11y === 'partial' ? 'watch' : '', tier: 0 },
        { k: 'Built as designed', v: de.specDrift ? 'NO, drift' : 'yes', c: de.specDrift ? 'bad' : '', tier: 1 },
      ],
    };
    case 'development': return {
      rows: [
        { k: 'Progress', v: dv.progressPct + '%', tier: 0 },
        { k: 'Human reviewed', v: dv.humanReviewed === true ? 'yes' : dv.humanReviewed === false ? 'NO' : '—', c: dv.humanReviewed === false ? 'bad' : '', tier: 0 },
        { k: 'Written by agents', v: dv.aiAuthoredPct + '%', tier: 1 },
        { k: 'Status', v: dv.status, tier: 1 },
        { k: 'Unit coverage', v: dv.unitCoveragePct != null ? dv.unitCoveragePct + '%' : '—', c: dv.unitCoveragePct != null && dv.unitCoveragePct < 50 ? 'watch' : '', tier: 1 },
        { k: 'Open PRs', v: dv.openPRs, tier: 2 },
        { k: 'Tech debt', v: (dv.techDebt ?? 0) + ' / 3', tier: 2 },
        { k: 'Lines · last commit', v: (dv.linesOfCode || 0).toLocaleString('en-US') + ' · ' + (dv.lastCommit || '—').slice(5), tier: 2 },
      ],
    };
    case 'operations': return {
      rows: [
        { k: 'Environment', v: op.environment, tier: 0 },
        { k: 'Rollout', v: op.flag ? rollout + '%' : f.stage === 'live' ? '100%' : '—', tier: 0 },
        { k: 'Alerting · runbook', v: (op.alerting ? 'yes' : 'NO') + ' · ' + (op.runbook ? 'yes' : 'no'), c: op.environment === 'production' && !op.alerting ? 'bad' : '', tier: 1 },
        { k: 'Incidents · 30 d', v: op.incidents30d || 0, c: op.incidents30d ? 'bad' : '', tier: 1 },
        { k: 'p95 latency', v: op.p95ms != null ? op.p95ms + ' ms' : '—', tier: 2 },
        { k: 'Error rate', v: op.errorRatePct != null ? op.errorRatePct + '%' : '—', tier: 2 },
        { k: 'SLO actual / target', v: op.sloActual != null ? op.sloActual + ' / ' + op.sloTarget : '—', tier: 2 },
        { k: 'Cost / month', v: op.costUsdMonth != null ? '$' + op.costUsdMonth : '—', tier: 2 },
      ],
    };
    case 'security': return {
      rows: [
        { k: 'Data class', v: se.dataClass, c: se.dataClass === 'payment' ? 'watch' : '', tier: 0 },
        { k: 'Review', v: se.review, c: se.review === 'findings' ? 'bad' : (se.review === 'pending' || se.review === 'not-started') && (se.dataClass === 'payment' || se.dataClass === 'personal') ? 'bad' : '', tier: 0 },
        { k: 'Open findings', v: se.openFindings, c: se.openFindings ? 'bad' : '', tier: 1 },
      ],
    };
    default: return {
      rows: [
        { k: 'Status', v: q.status, c: q.status === 'failing' ? 'bad' : '', tier: 0 },
        { k: 'E2E passing', v: q.e2eTests ? q.e2ePassing + ' / ' + q.e2eTests : '—', c: q.e2eTests && q.e2ePassing < q.e2eTests ? 'watch' : '', tier: 0 },
        { k: 'Bugs P1 · P2 · P3', v: q.openBugs.p1 + ' · ' + q.openBugs.p2 + ' · ' + q.openBugs.p3, c: q.openBugs.p1 ? 'bad' : '', tier: 1 },
      ],
    };
  }
}

const hmark = (h: string) => (h === 'bad' ? 'BAD' : h === 'watch' ? 'WATCH' : h === 'good' ? 'GOOD' : 'N/A');

export function DefaultLensPanel({ lens, f, model, density, expanded, view }: SheetPanelProps) {
  const { rows, note } = lensRows(f, lens, model.sim.rolloutOf(f));
  const maxTier = expanded ? DENS[density] + (density === 'simple' ? 1 : 0) : view === 'general' ? 1 : 0;
  const shown = rows.filter((r) => r.tier <= maxTier), hidden = rows.length - shown.length;
  const h = f[lens].health, sh = SHEET[lens];
  return (
    <>
      <h5><span>{sh.no} · {sh.nm === 'Structure' ? 'Development' : sh.nm === 'Services' ? 'Operations' : sh.nm === 'Fire/Life' ? 'Security' : sh.nm === 'Inspect' ? 'Quality' : sh.nm}</span><span className="h">{hmark(h)}</span></h5>
      {shown.map((r) => <div key={r.k} className="r"><span>{r.k}</span><b className={r.c || ''}>{r.v}</b></div>)}
      {note && maxTier >= 1 && <div className="note">{note}</div>}
      {hidden > 0 && expanded && <div className="more">{hidden} more in the dense reading</div>}
    </>
  );
}
