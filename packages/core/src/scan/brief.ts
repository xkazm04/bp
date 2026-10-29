// The decision brief: one pure function, read by two audiences. The person sees it on the decision card (web Review,
// VR's BpLink card, Personas through docs/concepts/decision-brief/personas-adoption.md); an agent reads it through the
// plan.brief tool (catalog.ts) before it proposes. Both read the SAME object, so the context cannot drift between them.
// Four facts over data bp already holds, every one with the ids that back it (a number on a card opens its list):
//   blast      - the feature on the plan (room, wing) and the features whose depends_on name it, from the v3 map;
//   precedent  - decided rows under the same lens (and tier, when the subject has one), plus every row that is the same
//                idea (same feature + lens, or on its attempt_of / parent_id chain), the same standard, or a title with
//                the same words; counted approved vs declined. Declines that match the idea are quoted, latest first,
//                one per standard, so an agent hears the owner's own words back;
//   reversible - approving builds on a pack branch and ships only through triage and a release; declining is final (no
//                route reopens a decided proposal); after a release the risk_class says whether a revert PR undoes it;
//   cost       - the median minutes per item of the finished execute runs under the lens (else any lens), from runs and
//                packs; none -> no build history.
// Thin evidence is said, never filled in: no map entry -> 'not on the plan'; no decided rows -> 'no precedent yet';
// no risk_class -> 'unknown'. `lines` is the brief in plain words under a fixed budget (BRIEF_LINES x BRIEF_WIDTH), the
// one rendering a small card (VR) and a prompt share. Pure: no I/O, no clock unless `now` is passed.
import type { Pack, Proposal, ProposalSize, RiskClass, Run, ScanSnapshot, Tier } from './types.ts';
import { TIER_SAYS } from './derive.ts';

export const BRIEF_VERSION = 1;
/** The line budget every surface shares (a VR decision card shows exactly this). */
export const BRIEF_LINES = 5;
export const BRIEF_WIDTH = 120;

export interface BriefRef { slug: string; id?: string; name: string }
/** The slice of an app-structure v3 map the brief reads. */
export interface BriefMap {
  features: { slug: string; id?: string; name: string; capability?: string; stage?: string; depends_on?: string[] }[];
  capabilities: { slug: string; id?: string; name: string; domain?: string }[];
  domains: { slug: string; id?: string; name: string }[];
  lenses: { id: string; name: string }[];
}
/** What is being decided: an open proposal, or an agent's draft (feature + words, maybe a lens). */
export interface BriefSubject {
  id?: string; feature: string; title: string; lens?: string; standard?: string; tier?: Tier; risk_class?: RiskClass; size?: ProposalSize;
}
export type Match = 'same idea' | 'same standard' | 'similar words' | 'same lens';
export interface BriefDecided {
  id: string; title: string; feature: string; lens: string; verdict: 'approved' | 'declined'; at: string;
  by?: string; note?: string; standard?: string; match: Match;
}
export interface Brief {
  v: typeof BRIEF_VERSION;
  subject: BriefSubject;
  blast: { feature: BriefRef | null; room: BriefRef | null; wing: BriefRef | null; stage?: string; dependents: BriefRef[]; rooms: number; openHere: string[] };
  precedent: { rows: BriefDecided[]; approved: number; declined: number; basis: string };
  /** Declines that match the idea (not merely the lens), latest first, one per standard. */
  declines: BriefDecided[];
  reversible: { approve: 'until-triage'; decline: 'final'; afterRelease: 'revert' | 'care' | 'unknown'; riskClass?: RiskClass };
  cost: { builds: number; minutes?: number; model?: string; basis: 'lens' | 'any lens' | 'none'; runs: string[] };
  advice: { say: 'withdraw' | 'ask' | 'proceed'; why: string };
  /** The brief in plain words, one fact per line, each with the ids that back it (what a number on the card opens). */
  facts: BriefFact[];
  /** `facts` as text: the one rendering a small card (VR), a prompt and Personas share. */
  lines: string[];
}
export type FactKey = 'blast' | 'declined' | 'precedent' | 'undo' | 'cost';
export interface BriefFact { key: FactKey; text: string; ids: string[] }
type Scan = Pick<ScanSnapshot, 'proposals' | 'runs' | 'packs'>;

// ------------------------------------------------------------------------------------------- the map
const arr = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : []);
const s = (x: unknown): string | undefined => (typeof x === 'string' && x ? x : undefined);
/** A tolerant read of an app-structure document: rows without a slug and a name are skipped, never guessed. */
export function briefMapOf(raw: unknown): BriefMap {
  const j = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const node = (r: Record<string, unknown>) => ({ slug: s(r.slug)!, name: s(r.name) ?? s(r.slug)!, ...(s(r.id) ? { id: s(r.id) } : {}) });
  return {
    features: arr(j.features).filter((r) => s(r.slug)).map((r) => ({
      ...node(r), ...(s(r.capability) ? { capability: s(r.capability) } : {}), ...(s(r.stage) ? { stage: s(r.stage) } : {}),
      ...(Array.isArray(r.depends_on) ? { depends_on: r.depends_on.filter((d): d is string => typeof d === 'string') } : {}),
    })),
    capabilities: arr(j.capabilities).filter((r) => s(r.slug)).map((r) => ({ ...node(r), ...(s(r.domain) ? { domain: s(r.domain) } : {}) })),
    domains: arr(j.domains).filter((r) => s(r.slug)).map(node),
    lenses: arr(j.lenses).filter((r) => s(r.id)).map((r) => ({ id: s(r.id)!, name: s(r.name) ?? s((r.manifest as Record<string, unknown> | undefined)?.name) ?? s(r.id)! })),
  };
}

// ------------------------------------------------------------------------------------------- words
const STOP = new Set('a an and the to of in on for with by from at as is are be it its this that into over under add make use per via not no'.split(' '));
/** Content words, crudely stemmed (retries/retry, limits/limit, caching/cache), so a re-worded idea still matches. */
export function words(t: string): Set<string> {
  const out = new Set<string>();
  for (let w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOP.has(w)) continue;
    w = w.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '');
    if (w.length >= 3) out.add(w);
  }
  return out;
}
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

// ------------------------------------------------------------------------------------------- facts
const decidedAt = (p: Proposal) => (p.decided_at ?? p.updated_at).slice(0, 10);
export const subjectOf = (p: Proposal): BriefSubject => ({
  id: p.id, feature: p.feature, title: p.title, lens: p.lens, standard: p.standard,
  ...(p.tier !== undefined ? { tier: p.tier } : {}), ...(p.risk_class ? { risk_class: p.risk_class } : {}), ...(p.size ? { size: p.size } : {}),
});

function blastOf(sub: BriefSubject, map: BriefMap, scan: Scan): Brief['blast'] {
  const F = new Map(map.features.map((f) => [f.slug, f])), C = new Map(map.capabilities.map((c) => [c.slug, c])), D = new Map(map.domains.map((d) => [d.slug, d]));
  const ref = (x: { slug: string; id?: string; name: string } | undefined): BriefRef | null => (x ? { slug: x.slug, name: x.name, ...(x.id ? { id: x.id } : {}) } : null);
  const f = F.get(sub.feature), room = f?.capability ? C.get(f.capability) : undefined, wing = room?.domain ? D.get(room.domain) : undefined;
  const deps = map.features.filter((x) => x.slug !== sub.feature && x.depends_on?.includes(sub.feature));
  const openHere = scan.proposals.filter((p) => p.status === 'proposed' && p.feature === sub.feature && p.id !== sub.id).map((p) => p.id);
  return {
    feature: ref(f), room: ref(room), wing: ref(wing), ...(f?.stage ? { stage: f.stage } : {}),
    dependents: deps.map((x) => ref(x)!), rooms: new Set(deps.map((x) => x.capability ?? '')).size, openHere,
  };
}

function precedentOf(sub: BriefSubject, scan: Scan): { precedent: Brief['precedent']; declines: BriefDecided[] } {
  const byId = new Map(scan.proposals.map((x) => [x.id, x]));
  const chain = new Set<string>(), self = sub.id ? byId.get(sub.id) : undefined, todo = [self?.attempt_of, self?.parent_id];
  while (todo.length) {
    const x = byId.get(todo.pop() ?? '');
    if (!x || x.id === sub.id || chain.has(x.id)) continue;
    chain.add(x.id); todo.push(x.attempt_of, x.parent_id);
  }
  // a feature's own name in a title says where, not what: those words never make two ideas alike
  const minus = (t: string, f: string) => { const w = words(t); for (const x of words(f.replace(/-/g, ' '))) w.delete(x); return w; };
  const mine = minus(sub.title, sub.feature), rows: BriefDecided[] = [];
  for (const x of scan.proposals) {
    if (x.id === sub.id || x.status === 'proposed') continue;
    const shared = overlap(mine, minus(x.title, x.feature));
    const match: Match | null = chain.has(x.id) || (x.feature === sub.feature && (!sub.lens || x.lens === sub.lens) && (!!sub.lens || shared >= 1)) ? 'same idea'
      : sub.standard && sub.standard !== 'none' && x.standard === sub.standard ? 'same standard'
      : shared >= 2 ? 'similar words'
      : sub.lens && x.lens === sub.lens && (sub.tier === undefined || x.tier === sub.tier) ? 'same lens' : null;
    if (!match) continue;
    const note = (x.status === 'declined' ? x.decision_note : x.decision_note ?? x.triage_note)?.trim();
    rows.push({
      id: x.id, title: x.title, feature: x.feature, lens: x.lens, verdict: x.status === 'declined' ? 'declined' : 'approved', at: decidedAt(x),
      ...(x.decided_by ? { by: x.decided_by } : {}), ...(note ? { note } : {}), ...(x.standard && x.standard !== 'none' ? { standard: x.standard } : {}), match,
    });
  }
  const order: Match[] = ['same idea', 'same standard', 'similar words', 'same lens'];
  rows.sort((a, b) => order.indexOf(a.match) - order.indexOf(b.match) || (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
  const seen = new Set<string>(), declines: BriefDecided[] = [];
  for (const r of [...rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1))) {
    if (r.verdict !== 'declined' || r.match === 'same lens') continue;
    const k = r.standard ?? r.id;
    if (seen.has(k)) continue;
    seen.add(k); declines.push(r);
  }
  const basis = sub.lens ? 'the same lens' + (sub.tier !== undefined ? ' and tier' : '') + ', the same idea or the same words' : 'the same idea or the same words';
  return { precedent: { rows, approved: rows.filter((r) => r.verdict === 'approved').length, declined: rows.filter((r) => r.verdict === 'declined').length, basis }, declines };
}

/** A revert PR restores code; it does not take back a leaked secret, a widened grant, money moved or data written. */
const CARE: readonly RiskClass[] = ['secret', 'authz', 'money', 'data'];
const reversibleOf = (sub: BriefSubject): Brief['reversible'] => ({
  approve: 'until-triage', decline: 'final',
  afterRelease: !sub.risk_class ? 'unknown' : CARE.includes(sub.risk_class) ? 'care' : 'revert', ...(sub.risk_class ? { riskClass: sub.risk_class } : {}),
});

const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function costOf(sub: BriefSubject, scan: Scan): Brief['cost'] {
  const items = new Map<string, number>(), packRun = new Map(scan.packs.map((k: Pack) => [k.id, k.run_id]));
  for (const p of scan.proposals) { const r = p.pack_id ? packRun.get(p.pack_id) : undefined; if (r) items.set(r, (items.get(r) ?? 0) + 1); }
  const done = scan.runs.filter((r: Run) => r.phase === 'execute' && r.status === 'done' && r.ended_at && Number.isFinite(Date.parse(r.ended_at)));
  const pick = (rs: Run[], basis: 'lens' | 'any lens'): Brief['cost'] | null => {
    if (!rs.length) return null;
    const per = rs.map((r) => (Date.parse(r.ended_at!) - Date.parse(r.started_at)) / 60000 / Math.max(1, items.get(r.id) ?? 1));
    const models = [...new Set(rs.map((r) => r.model).filter((m): m is string => !!m))];
    return { builds: rs.length, minutes: Math.max(1, Math.round(median(per))), ...(models.length === 1 ? { model: models[0] } : {}), basis, runs: rs.map((r) => r.id) };
  };
  return (sub.lens ? pick(done.filter((r) => r.lenses.includes(sub.lens!)), 'lens') : null) ?? pick(done, 'any lens') ?? { builds: 0, basis: 'none', runs: [] };
}

function adviceOf(declines: BriefDecided[], p: Brief['precedent']): Brief['advice'] {
  const d = declines[0];
  const who = { 'same idea': 'This idea', 'same standard': 'An idea under the same standard', 'similar words': 'A similarly worded idea', 'same lens': 'An idea under this lens' }[d?.match ?? 'same lens'];
  if (d) return { say: 'withdraw', why: `${who} was declined ${d.at}${d.by ? ' by ' + d.by : ''}${d.note ? ': "' + d.note + '"' : ' (no note)'}` };
  if (p.declined >= 3 && p.declined > p.approved) return { say: 'ask', why: `${p.declined} of ${p.declined + p.approved} similar decisions were declines` };
  return { say: 'proceed', why: p.rows.length ? `${p.approved} of ${p.rows.length} similar decisions were approvals` : 'no precedent yet' };
}

// ------------------------------------------------------------------------------------------- words for the card
const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
const fit = (t: string) => (t.length <= BRIEF_WIDTH ? t : t.slice(0, BRIEF_WIDTH - 1).trimEnd() + '…');
export function briefFacts(b: Omit<Brief, 'facts' | 'lines'>, map: Pick<BriefMap, 'lenses'>): BriefFact[] {
  const l = b.subject.lens, lensOnly = l ? map.lenses.find((x) => x.id === l)?.name ?? l : '';
  const lens = lensOnly && b.subject.tier !== undefined ? lensOnly + ', tier ' + b.subject.tier : lensOnly;
  const B = b.blast, P = b.precedent, R = b.reversible, C = b.cost, out: BriefFact[] = [];
  const at = (r: BriefRef) => r.name + (r.id ? ' (' + r.id + ')' : '');
  const fact = (key: FactKey, text: string, ids: string[] = []) => out.push({ key, text: fit(text), ids });
  fact('blast', !B.feature ? `Touches ${b.subject.feature}, which is not on the plan: blast radius unknown`
    : `Touches ${at(B.feature)}${B.room ? ' in ' + B.room.name : ''}` + (B.dependents.length ? ` · ${plural(B.dependents.length, 'feature')} depend${B.dependents.length === 1 ? 's' : ''} on it, in ${plural(B.rooms, 'room')}` : ' · nothing depends on it'),
  B.dependents.map((x) => x.slug));
  const d = b.declines[0];
  if (d) fact('declined', `Declined ${d.at}${d.by ? ' by ' + d.by.replace(/^user:/, '') : ''}: ` + (d.note ? `"${d.note}"` : 'no note given') + (d.match !== 'same idea' ? ` (${d.match}, ${d.id})` : ` (${d.id})`), b.declines.map((x) => x.id));
  fact('precedent', !P.rows.length ? `No precedent yet${lens ? ' under ' + lens : ''}`
    : `You approved ${P.approved} of ${plural(P.rows.length, 'similar decision')}${lens ? ' under ' + lens : ''}` + (P.declined ? ` · declined ${P.declined}` : ''), P.rows.map((x) => x.id));
  const after = R.afterRelease === 'care' ? `${R.riskClass} risk, a revert PR may not undo it` : R.afterRelease === 'revert' ? 'after release, a revert PR' : 'after release unknown (no risk class)';
  fact('undo', `Undo: ships only after you accept it; ${after}. A decline is final`);
  fact('cost', C.builds ? `Cost: about ${C.minutes} min per item, from ${plural(C.builds, 'build')}${C.basis === 'lens' && lensOnly ? ' under ' + lensOnly : ' (any lens)'}${C.model ? ' on ' + C.model : ''}` : 'Cost: no build history yet', C.runs);
  return out.slice(0, BRIEF_LINES);
}

/** The advice alone (no map needed): what the live feed recommends on a card. `decline` is the stand it rests on. */
export function briefAdvice(sub: BriefSubject, scan: Pick<ScanSnapshot, 'proposals'>): Brief['advice'] & { decline?: BriefDecided } {
  const { precedent, declines } = precedentOf(sub, { proposals: scan.proposals, runs: [], packs: [] });
  return { ...adviceOf(declines, precedent), ...(declines[0] ? { decline: declines[0] } : {}) };
}
/** The note a Decline taken on that advice carries, so the new row points at the decision it repeats (<= 500 chars). */
export const repeatNote = (d: BriefDecided): string => (`Repeats ${d.id}, declined ${d.at}` + (d.note ? `: "${d.note}"` : '')).slice(0, 500);

/** The brief of `sub` over a product's store and map. */
export function briefFor(sub: BriefSubject, scan: Scan, map: BriefMap): Brief {
  const { precedent, declines } = precedentOf(sub, scan);
  const base = { v: BRIEF_VERSION, subject: sub, blast: blastOf(sub, map, scan), precedent, declines, reversible: reversibleOf(sub), cost: costOf(sub, scan), advice: adviceOf(declines, precedent) } as const;
  const facts = briefFacts(base, map);
  return { ...base, facts, lines: facts.map((f) => f.text) };
}

/** The tier in words, for a subject line ('tier 1, before production'). */
export const tierWords = (t: Tier | undefined): string | undefined => (t === undefined ? undefined : `tier ${t}, ${TIER_SAYS[t]}`);
