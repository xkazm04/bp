// Plain-words lines about one feature under a lens (hover card) and the sheet's opening paragraph.
// The lens line is the manifest's evidence fields, by label and formatted value, then the reason when
// the lens is unwell.
import type { Feature } from '@bp/core/data';
import { reasonOf } from '@bp/core/standard/present';
import { STAGE_PLAIN, evidenceFields, fmtValue, isAgentId, lensOf, pname, type Product, type SwarmSim } from '@bp/core/model';

export function lensWords(P: Product, f: Feature, l: string, sim: SwarmSim): string {
  const d = lensOf(P, l), fl = f.lens[l];
  if (!d || !fl) return '';
  if (fl.h === 'na') return d.name + ': does not apply';
  const parts = evidenceFields(d).map((x) => { const v = sim.liveValue(f, l, x.key); return v === undefined ? '' : x.label + ' ' + fmtValue(x, v); }).filter(Boolean);
  if (fl.h === 'unmeasured' && !parts.length) return d.name + ': not measured';
  const why = fl.h === 'bad' || fl.h === 'watch' ? reasonOf(fl) : null;
  return parts.join(' · ') + (why ? ' · ' + why : '');
}

/** Revision letters: A..Z, then AA, AB... (spreadsheet columns), so a long history never runs past the alphabet. */
export function revLabel(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// the sample (Kettle) talks of studios; a live product is anyone's, so its wording names no audience
const NEUTRAL: Partial<Record<NonNullable<Feature['stage']>, string>> = { live: 'Live for everyone', flagged: 'Live for some users, behind a switch' };

export function plainLine(P: Product, f: Feature, sim: SwarmSim): { strong: string; rest: string[]; bad: string | null } {
  let strong = f.stage ? (sim.live && NEUTRAL[f.stage]) || STAGE_PLAIN[f.stage] : 'Stage unknown';
  const roll = sim.rolloutOf(f);
  if (f.stage === 'flagged' && roll < 100) strong = (sim.live ? 'Live for ' + roll + '% of users' : 'Live for ' + roll + '% of studios') + ', behind a switch';
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
