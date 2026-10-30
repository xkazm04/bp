// The decision brief: one pure function, read by two audiences. The person sees it on the decision card (web Review,
// VR's BpLink card, Personas through docs/concepts/decision-brief/personas-adoption.md); an agent reads it through the
// plan.brief tool (catalog.ts) before it proposes. Both read the SAME object, so the context cannot drift between them.
// Four facts over data bp already holds, every one with the ids that back it (a number on a card opens its list):
//   blast      - the feature on the plan (room, wing) and the features whose depends_on name it, from the v3 map;
//   precedent  - decided rows under the same lens (and tier, when the subject has one), plus every row that is the same
//                idea (on its attempt_of / parent_id chain, or the same feature + lens with a shared idea word or the same
//                standard - the same place alone is not the same idea), the same standard, or a title with
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
import { BRIEF_MATCHES } from '../standard/schema-vocab.ts';
import type { Structure } from '../standard/load.ts';

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
/** How a decided row matches the subject, strongest first (the schema's order: decision-brief-1 briefDecided.match). */
export type Match = (typeof BRIEF_MATCHES)[number];
export interface BriefDecided {
  id: string; title: string; feature: string; lens: string; verdict: 'approved' | 'declined'; at: string;
  by?: string; note?: string; standard?: string; match: Match;
}
export interface Brief {
  v: typeof BRIEF_VERSION;
  subject: BriefSubject;
  /** `feature`, `room`, `wing` omitted = not on the plan (never null: the wire omits what is absent). */
  blast: { feature?: BriefRef; room?: BriefRef; wing?: BriefRef; stage?: string; dependents: BriefRef[]; rooms: number; openHere: string[] };
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
/**
 * A read of a raw app-structure v3 document for a consumer without bp's loader. bp itself reads every map through the
 * loader (standard/load.ts) and briefMapOfStructure - the browser and the server alike - so this one mirrors the loader's
 * rules that reach the brief: a short code only (domain <= 6, capability <= 8, feature 12 by the loader's pattern), a
 * capability naming an unknown domain dropped and its features (and any without a known capability) in "Unplaced", and
 * depends_on kept to known features other than itself. Lens names fall back to the id (the loader reads built-in
 * manifests; this does not). check:decision-brief pins it equal to the loader's read on Kettle and on a rough map.
 */
export function briefMapOf(raw: unknown): BriefMap {
  const j = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const code = (r: Record<string, unknown>, ok: (id: string) => boolean) => { const id = s(r.id); return id && ok(id) ? { id } : {}; };
  const named = (r: Record<string, unknown>) => ({ slug: s(r.slug)!, name: s(r.name) ?? s(r.slug)! });
  const domains: BriefMap['domains'] = arr(j.domains).filter((r) => s(r.slug)).map((r) => ({ ...named(r), ...code(r, (id) => id.length <= 6) }));
  const D = new Set(domains.map((d) => d.slug));
  const capabilities: BriefMap['capabilities'] = arr(j.capabilities).filter((r) => s(r.slug) && D.has(s(r.domain) ?? ''))
    .map((r) => ({ ...named(r), ...code(r, (id) => id.length <= 8), domain: s(r.domain)! }));
  const C = new Set(capabilities.map((c) => c.slug)), rows = arr(j.features).filter((r) => s(r.slug)), slugs = new Set(rows.map((r) => s(r.slug)!));
  let unplaced = false;
  const features: BriefMap['features'] = rows.map((r) => {
    const cap = s(r.capability) && C.has(s(r.capability)!) ? s(r.capability)! : ((unplaced = true), 'unplaced');
    const deps = Array.isArray(r.depends_on) ? r.depends_on.filter((d): d is string => typeof d === 'string' && d !== r.slug && slugs.has(d)) : [];
    return { ...named(r), ...code(r, (id) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$/.test(id)), capability: cap, ...(s(r.stage) ? { stage: s(r.stage) } : {}), depends_on: deps };
  });
  if (unplaced) { domains.push({ slug: 'unplaced', name: 'Unplaced' }); capabilities.push({ slug: 'unplaced', name: 'Unplaced', domain: 'unplaced' }); }
  return {
    features, capabilities, domains,
    lenses: arr(j.lenses).filter((r) => s(r.id)).map((r) => ({ id: s(r.id)!, name: s(r.name) ?? s((r.manifest as Record<string, unknown> | undefined)?.name) ?? s(r.id)! })),
  };
}

/** The same slice from a loaded map (standard/load.ts): what the app already holds for a live product AND for Kettle, so
 *  the browser needs no second read of the raw document. Ids are base slugs (no product-line suffix). */
export function briefMapOfStructure(S: Pick<Structure, 'features' | 'capabilities' | 'domains' | 'allLenses'>): BriefMap {
  return {
    features: S.features.map((f) => ({ slug: f.slug, name: f.name, ...(f.code ? { id: f.code } : {}), ...(f.capability ? { capability: f.capability } : {}), ...(f.stage ? { stage: f.stage } : {}), depends_on: f.dependsOn })),
    capabilities: S.capabilities.map((c) => ({ slug: c.base, name: c.name, ...(c.code ? { id: c.code } : {}), domain: S.domains.find((d) => d.id === c.domain)?.base ?? c.domain })),
    domains: S.domains.map((d) => ({ slug: d.base, name: d.name, ...(d.code ? { id: d.code } : {}) })),
    lenses: S.allLenses.map((l) => ({ id: l.id, name: l.name })),
  };
}

// ------------------------------------------------------------------------------------------- words
const STOP = new Set('a an and the to of in on for with by from at as is are be it its this that into over under add make use per via not no'.split(' '));
/** A crude stem (retries/retry, limits/limit, retrying/retry). It misses some pairs (caching/cache, process/processes):
 *  a miss only loses a match, the cheap kind of mistake here. */
const stem = (w: string) => w.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '');
const tokens = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Content words, stemmed, so a re-worded idea still shares them. */
export function words(t: string): Set<string> {
  const out = new Set<string>();
  for (const w of tokens(t)) if (w.length >= 3 && !STOP.has(w)) { const s = stem(w); if (s.length >= 3) out.add(s); }
  return out;
}
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };
/** Opposite directions: "Enable caching" and "Disable caching" share every other word and are opposite changes. */
const OPPOSITES: readonly [string, string][] = ([['add', 'remove'], ['add', 'delete'], ['add', 'drop'], ['enable', 'disable'], ['show', 'hide'], ['allow', 'block'],
  ['allow', 'deny'], ['increase', 'decrease'], ['increase', 'reduce'], ['raise', 'lower'], ['start', 'stop'], ['open', 'close'], ['include', 'exclude'],
  ['lock', 'unlock'], ['grant', 'revoke'], ['expand', 'collapse'], ['more', 'fewer'], ['more', 'less'], ['with', 'without'], ['on', 'off'], ['keep', 'remove'],
  ['keep', 'drop']] as const).map(([x, y]) => [stem(x), stem(y)]);
/** A negation in a title ("Do not retry", "Never cache", "Stop retrying") turns it against the same words without one. */
const NEGATIONS = new Set(['not', 'no', 'never', 'without', 'don', 'dont', 'stop']);
const negated = (s: Set<string>) => { for (const w of NEGATIONS) if (s.has(w)) return true; return false; };
/** Every word of a title, stemmed, stop words kept (the direction words are short and common). */
export const allWords = (t: string): Set<string> => new Set(tokens(t).map(stem));
/** Whether two titles point opposite ways: one negated and the other not, or one names a direction and the other its
 *  opposite (and neither names both). */
export function opposite(a: Set<string>, b: Set<string>): boolean {
  if (negated(a) !== negated(b)) return true;
  return OPPOSITES.some(([x, y]) => (a.has(x) && b.has(y) && !a.has(y) && !b.has(x)) || (a.has(y) && b.has(x) && !a.has(x) && !b.has(y)));
}
/** Words that open an imperative title without naming its action ("Add retries ..." acts by retrying). */
const LEAD = new Set(['add', 'make', 'use', 'apply', 'introduce', 'implement', 'the', 'a', 'an', 'do', 'please', 'new', 'also', 'not', 'no', 'never', 'don', 'dont']);
/** A title's action: its first word that is not a lead word, stemmed ("Add retries to checkout" and "Retry failed
 *  checkout calls" both act by `retry`; "Compress product images" and "Cache product images" do not share one). */
export const actionOf = (t: string): string => { for (const w of tokens(t)) if (!LEAD.has(w)) return stem(w); return ''; };

// ------------------------------------------------------------------------------------------- facts
/** A title's idea words: a feature's own name in a title says where, not what, so those words never make two ideas alike. */
const ideaWords = (t: string, f: string) => { const w = words(t); for (const x of words(f.replace(/-/g, ' '))) w.delete(x); return w; };
/** Per row object (a snapshot's rows survive its deltas), so the live feed's advice per open card does not re-read every
 *  title on every tick: 300 open x 3000 rows took 1.4 s uncached. */
const ROW_WORDS = new WeakMap<Proposal, { idea: Set<string>; all: Set<string>; act: string }>();
const rowWords = (x: Proposal) => {
  let w = ROW_WORDS.get(x);
  if (!w) ROW_WORDS.set(x, (w = { idea: ideaWords(x.title, x.feature), all: allWords(x.title), act: actionOf(x.title) }));
  return w;
};

const decidedAt = (p: Proposal) => (p.decided_at ?? p.updated_at).slice(0, 10);
export const subjectOf = (p: Proposal): BriefSubject => ({
  id: p.id, feature: p.feature, title: p.title, lens: p.lens, standard: p.standard,
  ...(p.tier !== undefined ? { tier: p.tier } : {}), ...(p.risk_class ? { risk_class: p.risk_class } : {}), ...(p.size ? { size: p.size } : {}),
});

function blastOf(sub: BriefSubject, map: BriefMap, scan: Scan): Brief['blast'] {
  const F = new Map(map.features.map((f) => [f.slug, f])), C = new Map(map.capabilities.map((c) => [c.slug, c])), D = new Map(map.domains.map((d) => [d.slug, d]));
  const ref = (x: { slug: string; id?: string; name: string }): BriefRef => ({ slug: x.slug, name: x.name, ...(x.id ? { id: x.id } : {}) });
  const f = F.get(sub.feature), room = f?.capability ? C.get(f.capability) : undefined, wing = room?.domain ? D.get(room.domain) : undefined;
  const deps = map.features.filter((x) => x.slug !== sub.feature && x.depends_on?.includes(sub.feature));
  const openHere = scan.proposals.filter((p) => p.status === 'proposed' && p.feature === sub.feature && p.id !== sub.id).map((p) => p.id);
  return {
    ...(f ? { feature: ref(f) } : {}), ...(room ? { room: ref(room) } : {}), ...(wing ? { wing: ref(wing) } : {}), ...(f?.stage ? { stage: f.stage } : {}),
    dependents: deps.map(ref), rooms: new Set(deps.map((x) => x.capability ?? '')).size, openHere,
  };
}

/** The rows by id, once per snapshot's proposals array (every open card of one feed reads the same one). */
const BY_ID = new WeakMap<readonly Proposal[], Map<string, Proposal>>();
const byIdOf = (ps: readonly Proposal[]) => { let m = BY_ID.get(ps); if (!m) BY_ID.set(ps, (m = new Map(ps.map((x) => [x.id, x])))); return m; };
const newestFirst = (a: BriefDecided, b: BriefDecided) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1);

/** `lean` (the live feed's advice on every open card, every tick): 'same lens' rows are counted, never built or sorted. */
function precedentOf(sub: BriefSubject, scan: Pick<Scan, 'proposals'>, lean = false): { precedent: Brief['precedent']; declines: BriefDecided[] } {
  const byId = byIdOf(scan.proposals);
  const chain = new Set<string>(), self = sub.id ? byId.get(sub.id) : undefined, todo = [self?.attempt_of, self?.parent_id];
  while (todo.length) {
    const x = byId.get(todo.pop() ?? '');
    if (!x || x.id === sub.id || chain.has(x.id)) continue;
    chain.add(x.id); todo.push(x.attempt_of, x.parent_id);
  }
  const mine = ideaWords(sub.title, sub.feature), mineAll = allWords(sub.title), mineAct = actionOf(sub.title), rows: BriefDecided[] = [];
  let approved = 0, declined = 0;
  for (const x of scan.proposals) {
    if (x.id === sub.id || x.status === 'proposed') continue;
    const rw = rowWords(x), theirs = rw.idea, shared = overlap(mine, theirs);
    // "the same idea" is what flips a card to Decline, and a decline is final, so it is held to the strictest reading that
    // still hears a re-worded repeat: the attempt chain, or the same feature (and lens), the same ACTION (the title's first
    // real verb: "Add retries to checkout" and "Retry the payment webhook" both retry; "Compress product images" and
    // "Cache product images" do not), never opposite (a negation, or enable/disable and the like), AND either the same
    // standard or the same words (2+ shared idea words, two thirds of the shorter title's). Words or a standard shared on
    // another feature, or without the same action, are shown and asked about, never a stand; the same place alone is
    // lens precedent.
    // on the same feature, two thirds of the shorter title's idea words; elsewhere (an "ask", which is noise when loose),
    // the same action and half of all the words of both
    const stdHit = !!sub.standard && sub.standard !== 'none' && x.standard === sub.standard;
    const sameAction = !!mineAct && mineAct === rw.act, here = x.feature === sub.feature;
    const close = shared >= 2 && (here ? shared * 3 >= 2 * Math.min(mine.size, theirs.size) : sameAction && shared * 2 >= mine.size + theirs.size - shared);
    const flipped = (stdHit || close || here) && opposite(mineAll, rw.all);
    const samePlace = here && (!sub.lens || x.lens === sub.lens);
    const sameStd = stdHit && !flipped, alike = close && !flipped;
    const match: Match | null = chain.has(x.id) || (samePlace && sameAction && !flipped && (sameStd || alike)) ? 'same idea'
      : sameStd ? 'same standard'
      : alike ? 'similar words'
      : sub.lens && x.lens === sub.lens && (x.feature === sub.feature || sub.tier === undefined || x.tier === sub.tier) ? 'same lens' : null;
    if (!match) continue;
    if (x.status === 'declined') declined++; else approved++;
    if (lean && match === 'same lens') continue;
    const note = (x.status === 'declined' ? x.decision_note : x.decision_note ?? x.triage_note)?.trim();
    rows.push({
      id: x.id, title: x.title, feature: x.feature, lens: x.lens, verdict: x.status === 'declined' ? 'declined' : 'approved', at: decidedAt(x),
      ...(x.decided_by ? { by: x.decided_by } : {}), ...(note ? { note } : {}), ...(x.standard && x.standard !== 'none' ? { standard: x.standard } : {}), match,
    });
  }
  if (!lean) rows.sort((a, b) => BRIEF_MATCHES.indexOf(a.match) - BRIEF_MATCHES.indexOf(b.match) || newestFirst(a, b));
  // the stands (same idea) first, then the declines of like ideas elsewhere; newest first within each
  const seen = new Set<string>(), declines: BriefDecided[] = [], stand = (r: BriefDecided) => (r.match === 'same idea' ? 0 : 1);
  for (const r of rows.filter((x) => x.verdict === 'declined' && x.match !== 'same lens').sort((a, b) => stand(a) - stand(b) || newestFirst(a, b))) {
    const k = r.standard ?? r.id;
    if (seen.has(k)) continue;
    seen.add(k); declines.push(r);
  }
  const basis = sub.lens ? 'the same lens' + (sub.tier !== undefined ? ' and tier' : '') + ', the same idea or the same words' : 'the same idea or the same words';
  return { precedent: { rows, approved, declined, basis }, declines };
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
  // a run whose times do not read (or end before they start) says nothing about duration: left out, never NaN on the wire
  const span = (r: Run) => (r.ended_at ? Date.parse(r.ended_at) - Date.parse(r.started_at) : NaN);
  const done = scan.runs.filter((r: Run) => r.phase === 'execute' && r.status === 'done' && Number.isFinite(span(r)) && span(r) >= 0);
  const pick = (rs: Run[], basis: 'lens' | 'any lens'): Brief['cost'] | null => {
    if (!rs.length) return null;
    const per = rs.map((r) => span(r) / 60000 / Math.max(1, items.get(r.id) ?? 1));
    const models = [...new Set(rs.map((r) => r.model).filter((m): m is string => !!m))];
    return { builds: rs.length, minutes: Math.max(1, Math.round(median(per))), ...(models.length === 1 ? { model: models[0] } : {}), basis, runs: rs.map((r) => r.id) };
  };
  return (sub.lens ? pick(done.filter((r) => r.lenses.includes(sub.lens!)), 'lens') : null) ?? pick(done, 'any lens') ?? { builds: 0, basis: 'none', runs: [] };
}

/** withdraw: a decline of this same idea stands (the card flips to Decline). ask: a like idea was declined elsewhere, or
 *  similar decisions were mostly declines (shown, never flipped). proceed: neither. */
function adviceOf(declines: BriefDecided[], p: Brief['precedent']): Brief['advice'] {
  const d = declines[0], said = (x: BriefDecided) => `${x.at}${x.by ? ' by ' + x.by : ''}${x.note ? ': "' + x.note + '"' : ' (no note)'}`;
  if (d?.match === 'same idea') return { say: 'withdraw', why: `This idea was declined ${said(d)}` };
  if (d) return { say: 'ask', why: `${d.match === 'same standard' ? 'An idea under the same standard' : 'A similarly worded idea'} was declined on ${d.feature} ${said(d)}` };
  if (p.declined >= 3 && p.declined > p.approved) return { say: 'ask', why: `${p.declined} of ${p.declined + p.approved} similar decisions were declines` };
  const n = p.approved + p.declined;
  return { say: 'proceed', why: !n ? 'no precedent yet' : p.approved >= p.declined ? `${p.approved} of ${n} similar decisions were approvals`
    : `${p.declined} of ${n} similar decisions were declines, none of this idea` };
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
  fact('precedent', !(P.approved + P.declined) ? `No precedent yet${lens ? ' under ' + lens : ''}`
    : `You approved ${P.approved} of ${plural(P.approved + P.declined, 'similar decision')}${lens ? ' under ' + lens : ''}` + (P.declined ? ` · declined ${P.declined}` : ''), P.rows.map((x) => x.id));
  const after = R.afterRelease === 'care' ? `${R.riskClass} risk, a revert PR may not undo it` : R.afterRelease === 'revert' ? 'after release, a revert PR' : 'after release unknown (no risk class)';
  fact('undo', `Undo: ships only after you accept it; ${after}. A decline is final`);
  fact('cost', C.builds ? `Cost: about ${C.minutes} min per item, from ${plural(C.builds, 'build')}${C.basis === 'lens' && lensOnly ? ' under ' + lensOnly : ' (any lens)'}${C.model ? ' on ' + C.model : ''}` : 'Cost: no build history yet', C.runs);
  return out.slice(0, BRIEF_LINES);
}

/** The advice alone (no map needed): what the live feed recommends on a card. `decline` is the stand it rests on. */
export function briefAdvice(sub: BriefSubject, scan: Pick<ScanSnapshot, 'proposals'>): Brief['advice'] & { decline?: BriefDecided } {
  const { precedent, declines } = precedentOf(sub, scan, true);
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
