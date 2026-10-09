// Plain-words lines about one feature under a lens (hover card) and the sheet's opening paragraph.
import type { Feature, LensId } from '@/lib/data';
import { STAGE_PLAIN, isAgentId, pname, type Product, type SwarmSim } from '@/lib/model';

export function lensWords(f: Feature, L: LensId, sim: SwarmSim): string {
  const b = f.business, de = f.design, dv = f.development, op = f.operations, se = f.security, q = f.quality;
  if (L === 'business') return 'Value ' + b.value + '/5 · ' + (b.customerRequests30d || 0) + (b.customerRequests30d === 1 ? ' ask' : ' asks') + ' in 30 days · revenue: ' + b.revenueLink;
  if (L === 'design') return 'Design: ' + de.status + ' · accessibility: ' + de.a11y + (de.specDrift ? ' · built off-spec' : '');
  if (L === 'development') return dv.progressPct + '% done · ' + dv.aiAuthoredPct + '% by agents · ' + (dv.humanReviewed === false ? 'no human review' : dv.humanReviewed ? 'human reviewed' : 'review n/a') + (dv.unitCoveragePct != null ? ' · coverage ' + dv.unitCoveragePct + '%' : '');
  if (L === 'operations') return op.environment === 'production' ? 'Production · ' + sim.rolloutOf(f) + '% rollout · p95 ' + op.p95ms + ' ms · ' + op.errorRatePct + '% errors · ' + (op.alerting ? 'alerting on' : 'no alerting') : 'Environment: ' + op.environment;
  if (L === 'security') return 'Data: ' + se.dataClass + ' · review: ' + se.review + (se.openFindings ? ' · ' + se.openFindings + ' findings' : '');
  return (q.e2eTests ? q.e2ePassing + ' of ' + q.e2eTests + ' end-to-end tests pass' : 'No end-to-end tests') + ' · P1 bugs ' + q.openBugs.p1;
}

export function plainLine(P: Product, f: Feature, sim: SwarmSim): { strong: string; rest: string[]; bad: string | null } {
  let strong = STAGE_PLAIN[f.stage];
  if (f.stage === 'flagged' && f.operations.flag) strong = 'Live for ' + sim.rolloutOf(f) + '% of studios, behind a switch';
  if (f.stage === 'in-dev') strong = 'Being built, about ' + Math.round(sim.progOf(f)) + '% done';
  const rest: string[] = [];
  const ag = f.builtBy.filter((p) => isAgentId(P, p)), hu = f.builtBy.filter((p) => !isAgentId(P, p));
  if (f.builtBy.length) rest.push('Built by ' + (ag.length ? (ag.length > 1 ? 'agents ' : 'agent ') + ag.map((p) => pname(P, p)).join(' & ') : '') + (hu.length ? (ag.length ? ' with ' : '') + hu.map((p) => pname(P, p)).join(' & ') : '') + '.');
  let bad: string | null = null;
  if (f.development.humanReviewed === false) bad = 'No human has reviewed the code.';
  else if (f.development.humanReviewed === true) rest.push('A human reviewed the code.');
  const dc = f.security.dataClass;
  if (dc === 'payment' || dc === 'personal') rest.push('Handles ' + (dc === 'payment' ? 'card / payment' : 'personal') + ' data; security review ' + f.security.review.replace('-', ' ') + '.');
  if (f.business.customerRequests30d) rest.push(f.business.customerRequests30d + ' studios asked for it in the last 30 days.');
  return { strong: strong + '.', rest, bad };
}
