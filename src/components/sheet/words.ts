// Plain-words lines about one feature under a lens (hover card) and the sheet's opening paragraph.
// The lens line is the manifest's evidence fields, by label and formatted value, then the reason when
// the lens is unwell.
import type { Feature } from '@/lib/data';
import { STAGE_PLAIN, evidenceFields, fmtValue, isAgentId, lensOf, pname, type Product, type SwarmSim } from '@/lib/model';

export function lensWords(P: Product, f: Feature, l: string, sim: SwarmSim): string {
  const d = lensOf(P, l), fl = f.lens[l];
  if (!d || !fl) return '';
  if (fl.h === 'na') return d.name + ': does not apply';
  const parts = evidenceFields(d).map((x) => { const v = sim.liveValue(f, l, x.key); return v === undefined ? '' : x.label + ' ' + fmtValue(x, v); }).filter(Boolean);
  if (fl.h === 'unmeasured' && !parts.length) return d.name + ': not measured';
  const why = fl.h === 'bad' || fl.h === 'watch' ? (fl.ov ? fl.ov.why : fl.why) : null;
  return parts.join(' · ') + (why ? ' · ' + why : '');
}

export function plainLine(P: Product, f: Feature, sim: SwarmSim): { strong: string; rest: string[]; bad: string | null } {
  let strong = f.stage ? STAGE_PLAIN[f.stage] : 'Stage unknown';
  const roll = sim.rolloutOf(f);
  if (f.stage === 'flagged' && roll < 100) strong = 'Live for ' + roll + '% of studios, behind a switch';
  if (f.stage === 'in-dev') strong = 'Being built, about ' + Math.round(sim.progOf(f)) + '% done';
  const rest: string[] = [];
  const ag = f.builtBy.filter((p) => isAgentId(P, p)), hu = f.builtBy.filter((p) => !isAgentId(P, p));
  if (f.builtBy.length) rest.push('Built by ' + (ag.length ? (ag.length > 1 ? 'agents ' : 'agent ') + ag.map((p) => pname(P, p)).join(' & ') : '') + (hu.length ? (ag.length ? ' with ' : '') + hu.map((p) => pname(P, p)).join(' & ') : '') + '.');
  // the lenses in trouble, worst first: the first bad one is the red line, the rest are listed
  const bad = f.trouble.find((t) => t.h === 'bad') ?? null;
  const watch = f.trouble.filter((t) => t.h === 'watch').map((t) => lensOf(P, t.lens)?.name.toLowerCase()).filter(Boolean);
  if (watch.length) rest.push('To watch: ' + watch.join(', ') + '.');
  return { strong: strong + '.', rest, bad: bad ? (lensOf(P, bad.lens)?.name ?? bad.lens) + ': ' + bad.why.replace(/\.$/, '') + '.' : null };
}
