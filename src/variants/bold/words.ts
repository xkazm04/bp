// The queue speaks the reader's language too: under a lens, each question card gets one line of that
// lens's facts about its feature (plain words for business and design, terse codes for development).
import type { ViewId } from '@/lib/data';
import type { Model, SimDecision } from '@/lib/model';

export function queueNote(d: SimDecision, view: ViewId, model: Model): string | null {
  if (view === 'general') return null;
  const f = model.P.F[d.f]; if (!f) return null;
  switch (view) {
    case 'business': {
      const b = f.business, asks = b.customerRequests30d || 0;
      return asks + (asks === 1 ? ' customer asked' : ' customers asked') + (b.mrrImpactUsd ? ' · about $' + b.mrrImpactUsd.toLocaleString('en-US') + ' a month at stake' : '');
    }
    case 'design': {
      const de = f.design;
      return de.a11y === 'fail' ? 'Fails accessibility' : de.specDrift ? 'Built differently from the design' : de.status === 'none' ? 'No design yet' : 'Design: ' + de.status;
    }
    case 'development': {
      const dv = f.development;
      return `${f.id} · ${Math.round(model.sim.progOf(f))}% · ai ${dv.aiAuthoredPct}% · cov ${dv.unitCoveragePct ?? '-'} · ${dv.openPRs} pr${dv.humanReviewed === false ? ' · UNREVIEWED' : ''}`;
    }
    case 'operations': {
      const op = f.operations;
      if (op.environment !== 'production') return op.environment === 'none' ? 'Not deployed' : 'On ' + op.environment;
      return `${op.flag ? model.sim.rolloutOf(f) : 100}% out · p95 ${op.p95ms ?? '-'} ms · ${op.alerting ? 'alerting on' : 'NO ALERTING'}`;
    }
    case 'security': {
      const se = f.security;
      const cls: Record<string, string> = { payment: 'Card data', personal: 'Personal data', internal: 'Internal data', public: 'Public data' };
      return (cls[se.dataClass] ?? se.dataClass) + ' · review ' + se.review.replace('-', ' ') + (se.openFindings ? ' · ' + se.openFindings + ' findings' : '');
    }
    case 'quality': {
      const q = f.quality;
      return (q.e2eTests ? q.e2ePassing + '/' + q.e2eTests + ' e2e pass' : 'No e2e tests') + ' · ' + q.openBugs.p1 + ' P1 · ' + q.openBugs.p2 + ' P2';
    }
  }
  return null;
}
