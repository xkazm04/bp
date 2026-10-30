// The Morning Watch: one standup across every live product, as a deck of cards read in order. Pure: the server reads the
// stores and the plans (server/api/companion/morning.server.ts) and hands each product's facts here; this decides what the
// morning says and where each card takes the owner. Every card that is about a place carries it (a FocusPlace), so as a
// card is read the deck publishes it to the shared focus and every following surface flies there.
//   open      the portfolio in one line: built, failed, releases that moved their lens or fell short, decisions waiting
//   built     per product: what agents built overnight (and what failed), at the room where most of it landed
//   release   per product: a release merged in the window, and whether readings taken after it confirm its items
//   quiet     per product with nothing in the window: said once, calmly, so silence is never mistaken for "not read"
//   agents    what agents did with the owner's decisions overnight (the agent trail, companion/trail.ts): the briefs they
//             read before proposing, the declines they heard back, what they withdrew and what they recommended
//   decision  the top blockers across products (tier first: stop-ship, then high...), each Approve / Defer / Hold, and each
//             carrying its decision brief (scan/brief.ts: what it touches, the owner's declines quoted, undo, cost). Only
//             when the brief says the same idea was declined before (advice 'withdraw') does Decline join the keys, as
//             the recommendation, with the "Repeats <id> ..." note; a likeness only shows the quote (never flips)
//   close     what was decided this morning (repeats declined counted), and where the steering log is
// Headlines are one plain line. Honesty: a release item counts as confirmed only on a reading taken after the release
// that meets its expected value (scan/track.ts); anything else is "not measured since", never good.
import type { FocusPlace } from '../session/focus.ts';
import type { Proposal, ScanSnapshot } from '../scan/types.ts';
import { tracksOf, type Track } from '../scan/track.ts';
import { briefFor, briefMapOf, repeatNote, subjectOf, type Brief, type BriefDecided, type BriefFact, type BriefMap } from '../scan/brief.ts';
import { trailSessions, trailTally, type TrailRow, type TrailTally } from './trail.ts';
import { STEER_VERDICTS } from '../standard/schema-vocab.ts';
// The wire is packages/schema/schema/morning-deck-1.schema.json (MorningDeck, AgentDeck, SteerRow, SteerPost);
// check:schema holds these hand-written types to it field by field.

export type CardKind = 'open' | 'agents' | 'built' | 'release' | 'quiet' | 'decision' | 'close';
export type Tone = 'good' | 'warn' | 'bad' | 'calm';
/** `decline` is offered on a repeat only (the card's brief recommends it); the server refuses it on any other card. */
export type Verdict = (typeof STEER_VERDICTS)[number];
export const VERDICTS: readonly Verdict[] = STEER_VERDICTS;

export interface Where { room: string; roomName: string; wing: string; wingName: string; name: string }
export interface ProductFacts {
  slug: string;
  name: string;
  scan: Pick<ScanSnapshot, 'proposals' | 'measurements' | 'packs' | 'releases' | 'runs'>;
  /** feature slug -> where it sits on the product's plan. */
  where: ReadonlyMap<string, Where>;
  /** `lens|metric` -> the manifest's label ('Secrets in code'), when the map has one. */
  labels?: ReadonlyMap<string, string>;
  /** The plan as the decision brief reads it (briefMapOfStructure); absent -> every brief says 'not on the plan'. */
  map?: BriefMap;
}
/** One row of a product's steering log (work/steering-log.jsonl). `note`: what a Decline wrote to the store. */
export interface SteerRow { at: string; product: string; proposal: string; verdict: Verdict; title: string; by: string; until?: string; warning?: string; note?: string }
/** The body of POST /api/companion/morning (the human path). */
export interface SteerPost { product: string; proposal: string; verdict: Verdict }

/** A decision card's brief: the decision brief (scan/brief.ts) as the deck, the phone, a follower's lower third and an agent
 *  on morning.brief all read it. `recommend` is 'decline' only when the same idea was declined before (advice 'withdraw'),
 *  and `note` is then what a Decline writes to the store ("Repeats <id>, declined <day>: ..."). `decline` is the decline the
 *  card repeats, or (advice 'ask') the like one it only quotes. `short` is the one-line form for small surfaces. */
export interface CardBrief {
  facts: BriefFact[];
  lines: string[];
  advice: Brief['advice'];
  decline?: Pick<BriefDecided, 'id' | 'title' | 'feature' | 'at' | 'by' | 'note' | 'match'>;
  recommend?: 'decline';
  note?: string;
  short: string;
}

export interface CardLine { text: string; tone?: Tone }
export interface MorningCard {
  id: string;
  kind: CardKind;
  product?: string;
  productName?: string;
  headline: string;
  lines: CardLine[];
  tone: Tone;
  place?: FocusPlace;
  decision?: { proposal: string; tier?: number; steered?: SteerRow; brief?: CardBrief };
}
export interface ProductSummary { slug: string; name: string; built: number; failed: number; releases: number; confirmed: number; short: number; waiting: number }
/** `skipped`: products the server could not read (morning.server.ts), named, never dropped silently. */
export interface MorningDeck { since: string; until: string; products: ProductSummary[]; cards: MorningCard[]; agents?: TrailTally; skipped?: { product: string; why: string }[] }

export const TOP_DECISIONS = 3;
export const HELD_SHOWN = 2;
const TIER_WORDS = ['stop-ship', 'high', 'medium', 'backlog'];
const n = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
const hoursAgo = (iso: string, now: number) => { const h = Math.max(0, Math.round((now - Date.parse(iso)) / 3600e3)); return h < 1 ? 'just now' : h + ' h ago'; };

const EMPTY_MAP = briefMapOf({});
const clip = (t: string, k: number) => (t.length <= k ? t : t.slice(0, k - 1).trimEnd() + '…');

/** The brief of one decision on the morning's table: THE function every surface's card brief comes from (the deck, the
 *  phone, a follower's lower third through the place's `say`, morning.brief for agents, the server's Decline). */
export function cardBrief(p: Pick<ProductFacts, 'scan' | 'map'>, x: Proposal): CardBrief {
  const b = briefFor(subjectOf(x), p.scan, p.map ?? EMPTY_MAP), d = b.declines[0];
  const repeat = b.advice.say === 'withdraw' && !!d;
  const who = d?.by ? ' by ' + d.by.replace(/^user:/, '') : '';
  const short = d && repeat ? `Repeats your decline ${d.id} (${d.at}${who})${d.note ? `: "${d.note}"` : ''}`
    : d && b.advice.say === 'ask' ? `Like an idea you declined (${d.id})${d.note ? `: "${d.note}"` : ''}; yours to decide`
      : b.lines[0] ?? '';
  return {
    facts: b.facts, lines: b.lines, advice: b.advice,
    ...(d ? { decline: { id: d.id, title: d.title, feature: d.feature, at: d.at, match: d.match, ...(d.by ? { by: d.by } : {}), ...(d.note ? { note: d.note } : {}) } } : {}),
    ...(d && repeat ? { recommend: 'decline' as const, note: repeatNote(d) } : {}),
    short: clip(short, 160),
  };
}

/** The room most of these features sit in (ties: the first met), or undefined. */
function busiestRoom(fs: readonly string[], where: ReadonlyMap<string, Where>): Where | undefined {
  const count = new Map<string, { w: Where; k: number }>();
  for (const f of fs) { const w = where.get(f); if (w) { const c = count.get(w.room); if (c) c.k++; else count.set(w.room, { w, k: 1 }); } }
  let best: { w: Where; k: number } | undefined;
  for (const c of count.values()) if (!best || c.k > best.k) best = c;
  return best?.w;
}
const roomPlace = (product: string, w: Where | undefined, say: string): FocusPlace | undefined => (w ? { product, target: { kind: 'room', id: w.room }, level: 'L2', say } : undefined);
const featurePlace = (product: string, feature: string, say: string): FocusPlace => ({ product, target: { kind: 'feature', id: feature }, level: 'L4', say });
const inWindow = (iso: string | undefined, since: string, until: string) => !!iso && iso >= since && iso <= until;

/** A decision on the morning's table. `today`: steered in this window, so it keeps its slot (marked) and the deck does not
 *  reshuffle as the owner decides; `held`: held on an earlier morning, still waiting. */
interface Choice { x: Proposal; s?: SteerRow; today: boolean; held: boolean }

/** Decisions for the morning: every open finding not deferred (a defer from an earlier morning hides it until its
 *  `until`), plus every one steered this morning whatever its status now (approved ones included). */
function openDecisions(p: ProductFacts, steer: readonly SteerRow[], since: string, until: string): Choice[] {
  const last = new Map<string, SteerRow>();
  for (const r of steer) if (r.product === p.slug) last.set(r.proposal, r);
  const out: Choice[] = [];
  for (const x of p.scan.proposals) {
    const s = last.get(x.id), today = !!s && s.at >= since;
    if (!today && x.status !== 'proposed') continue;
    if (!today && s?.verdict === 'defer' && s.until && s.until > until) continue;
    out.push({ x, ...(s && (today || s.verdict === 'hold') ? { s } : {}), today, held: !today && s?.verdict === 'hold' });
  }
  return out;
}

/** `trail`: the agent trail's rows (brief.server.ts readTrail); the ones in the window make the agents card. */
export function buildDeck(products: readonly ProductFacts[], steer: readonly SteerRow[], since: string, now: number, trail: readonly TrailRow[] = []): MorningDeck {
  const until = new Date(now).toISOString(), cards: MorningCard[] = [], sums: ProductSummary[] = [];
  const decisions: (Choice & { p: ProductFacts })[] = [];
  const perProduct: MorningCard[][] = [];
  for (const p of products) {
    const mine: MorningCard[] = [];
    const built = p.scan.proposals.filter((x) => (x.status === 'done' || x.status === 'failed') && inWindow(x.updated_at, since, until));
    const ok = built.filter((x) => x.status === 'done'), bad = built.filter((x) => x.status === 'failed');
    if (built.length) {
      const w = busiestRoom(ok.length ? ok.map((x) => x.feature) : bad.map((x) => x.feature), p.where);
      const headline = ok.length
        ? `${p.name}: agents built ${n(ok.length, 'item')} overnight${bad.length ? `; ${n(bad.length, 'build')} failed` : ''}.`
        : `${p.name}: ${n(bad.length, 'build')} failed overnight; nothing landed.`;
      mine.push({
        id: `built:${p.slug}`, kind: 'built', product: p.slug, productName: p.name, headline, tone: bad.length ? 'warn' : 'good',
        lines: [...ok.map((x) => ({ text: `${x.title}${p.where.get(x.feature) ? ' · ' + p.where.get(x.feature)!.roomName : ''}`, tone: 'good' as Tone })), ...bad.map((x) => ({ text: `Failed: ${x.title}`, tone: 'bad' as Tone }))].slice(0, 6),
        ...(roomPlace(p.slug, w, headline) ? { place: roomPlace(p.slug, w, headline) } : {}),
      });
    }
    // releases merged in the window, read through the answer tracks
    const rels = p.scan.releases.filter((r) => (r.status === 'merged' || r.status === 'tagged') && inWindow(r.updated_at, since, until));
    const tracks = tracksOf(p.scan, now);
    // a tile on the plan says its NEWEST track (live-tracks.ts; tracksOf is newest first): the card flies to an item whose
    // tile shows this release's reading, and names it first, so the card and the tile agree (the demo pass found the card
    // on Card payments, whose tile showed a later build, while the "confirmed · measured 190" sat on Class packs)
    const tileTop = new Map<string, string>();
    for (const t of tracks) if (!tileTop.has(t.feature)) tileTop.set(t.feature, t.id);
    const onTile = (t: Track) => tileTop.get(t.feature) === t.id;
    let confirmed = 0, short = 0;
    for (const r of rels) {
      const ts = tracks.filter((t) => t.release === r.id);
      const good = ts.filter((t) => t.stage === 'confirmed'), fell = ts.filter((t) => t.stage === 'not-confirmed'), unk = ts.filter((t) => t.stage !== 'confirmed' && t.stage !== 'not-confirmed');
      confirmed += good.length; short += fell.length;
      const lenses = [...new Set(ts.map((t) => t.lens))];
      const headline = !ts.length ? `${p.name} ${r.version} merged; it carried nothing to measure.`
        : fell.length ? `${p.name} ${r.version} fell short: ${fell.length} of ${ts.length} items below what was expected.`
          : unk.length ? `${p.name} ${r.version} merged; ${n(unk.length, 'item')} not measured since.`
            : `${p.name} ${r.version} moved ${list(lenses)}: ${ts.length === 1 ? 'its item' : ts.length === 2 ? 'both items' : 'all ' + ts.length + ' items'} confirmed.`;
      const focus: Track | undefined = fell.find(onTile) ?? good.find(onTile) ?? fell[0] ?? good[0] ?? ts[0];
      mine.push({
        id: `release:${p.slug}:${r.id}`, kind: 'release', product: p.slug, productName: p.name, headline, tone: fell.length ? 'bad' : unk.length ? 'warn' : 'good',
        lines: (focus ? [focus, ...ts.filter((t) => t !== focus)] : ts).map((t) => ({ text: trackWords(t, p.where), tone: t.stage === 'confirmed' ? 'good' as Tone : t.stage === 'not-confirmed' ? 'bad' as Tone : 'warn' as Tone })).slice(0, 5),
        ...(focus ? { place: featurePlace(p.slug, focus.feature, headline) } : {}),
      });
    }
    const picks = openDecisions(p, steer, since, until), open = picks.filter((d) => d.x.status === 'proposed');
    for (const d of picks) decisions.push({ p, ...d });
    if (!mine.length) {
      const headline = `${p.name} had a quiet night: nothing built, nothing released.`;
      mine.push({ id: `quiet:${p.slug}`, kind: 'quiet', product: p.slug, productName: p.name, headline, tone: 'calm', lines: [{ text: open.length ? `${n(open.length, 'decision')} still ${open.length === 1 ? 'waits' : 'wait'} for you.` : 'Nothing waits for you here.' }], place: { product: p.slug, level: 'L0', say: headline } });
    }
    perProduct.push(mine);
    sums.push({ slug: p.slug, name: p.name, built: ok.length, failed: bad.length, releases: rels.length, confirmed, short, waiting: open.length });
  }
  // the blockers, by tier (stop-ship first; untiered last), then the riskiest, then the oldest. This morning's pool (open and
  // steered today) keeps its order as the owner decides; held ones from earlier mornings follow, marked (at most HELD_SHOWN)
  const rank = (d: Choice) => [d.x.tier ?? 4, -(d.x.risk ?? 0), d.x.created_at] as const;
  decisions.sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < 2; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number); return x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0; });
  const top = [...decisions.filter((d) => !d.held).slice(0, TOP_DECISIONS), ...decisions.filter((d) => d.held).slice(0, HELD_SHOWN)];
  const S = sums.reduce((a, s) => ({ built: a.built + s.built, failed: a.failed + s.failed, confirmed: a.confirmed + s.confirmed, short: a.short + s.short, waiting: a.waiting + s.waiting }), { built: 0, failed: 0, confirmed: 0, short: 0, waiting: 0 });
  const moved = sums.filter((s) => s.built || s.failed || s.releases).length;
  const openLine = products.length
    ? `Overnight, ${moved ? n(moved, 'product') + ' of ' + products.length + ' moved' : 'none of your ' + n(products.length, 'product') + ' moved'}${S.built ? `: ${n(S.built, 'item')} built` : ''}${S.failed ? `, ${S.failed} failed` : ''}.`
    : 'No live products are registered, so there is nothing to brief.';
  cards.push({
    id: 'open', kind: 'open', headline: 'Good morning.', tone: 'calm',
    lines: [{ text: openLine }, ...(S.confirmed || S.short ? [{ text: `Releases: ${S.confirmed} item${S.confirmed === 1 ? '' : 's'} confirmed${S.short ? `, ${S.short} fell short` : ''}.`, tone: (S.short ? 'warn' : 'good') as Tone }] : []),
      { text: S.waiting ? `${n(S.waiting, 'decision')} ${S.waiting === 1 ? 'waits' : 'wait'}; the top ${Math.min(TOP_DECISIONS, S.waiting)} ${Math.min(TOP_DECISIONS, S.waiting) === 1 ? 'is' : 'are'} at the end.` : 'Nothing waits for a decision.', ...(S.waiting ? { tone: 'warn' as Tone } : {}) }],
  });
  // the agent trail of the window: one line on the opening card, and a card of its own with what they heard and did
  const inWin = trail.filter((r) => r.at >= since && r.at <= until), agents = inWin.length ? trailTally(inWin, since, until) : undefined;
  if (agents?.reads) {
    cards[0].lines.push({
      text: `Overnight, agents checked your decisions ${n(agents.reads, 'time')} before proposing: they heard ${n(agents.heard, 'decline')} of yours and withdrew ${n(agents.withdrew, 'proposal')}${agents.recommended ? `, and recommend you decline ${n(agents.recommended, 'repeat')}` : ''}.`,
      ...(agents.heard ? { tone: 'warn' as Tone } : {}),
    });
    const lines = trailSessions(inWin, now, 3, undefined, Infinity).flatMap((x) => x.lines).slice(0, 6);
    const met = inWin.find((r): r is Extract<TrailRow, { kind: 'brief' }> => r.kind === 'brief' && !r.id && (r.advice === 'withdraw' || !!r.quoted));
    const at = met ? products.find((p) => p.slug === met.product) : undefined;
    const headline = agents.heard ? `Agents heard your declines and stood down ${n(agents.withdrew, 'time')}.` : `Agents checked your decisions ${n(agents.reads, 'time')}; none met a decline.`;
    cards.push({
      id: 'agents', kind: 'agents', headline, tone: agents.heard ? 'warn' : 'calm',
      lines: lines.map((l) => ({ text: l.text, ...(l.tone === 'heard' ? { tone: 'warn' as Tone } : l.tone === 'act' ? { tone: 'good' as Tone } : {}) })),
      ...(met && at ? { product: at.slug, productName: at.name, place: featurePlace(at.slug, met.feature, headline) } : {}),
    });
  }
  for (const m of perProduct) cards.push(...m);
  top.forEach(({ p, x, s, held }, i) => {
    const w = p.where.get(x.feature), tier = x.tier !== undefined ? TIER_WORDS[x.tier] : undefined, brief = cardBrief(p, x);
    cards.push({
      id: `decision:${p.slug}:${x.id}`, kind: 'decision', product: p.slug, productName: p.name, headline: x.title, tone: x.tier === 0 ? 'bad' : 'warn',
      lines: [
        { text: `${i + 1} of ${top.length} · ${p.name}${w ? ' · ' + w.roomName : ''}` },
        { text: [tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Untiered', x.risk_class ? x.risk_class : null, 'raised ' + hoursAgo(x.created_at, now)].filter(Boolean).join(' · '), ...(x.tier === 0 ? { tone: 'bad' as Tone } : {}) },
        ...(stakes(p, x) ? [{ text: stakes(p, x)! }] : []),
        ...(held && s ? [{ text: `Held since ${s.at.slice(0, 10)}: still yours to decide.`, tone: 'warn' as Tone }] : []),
      ],
      // a follower's lower third reads the place's words: the title, then the brief's short line (<= 280 on the wire)
      place: featurePlace(p.slug, x.feature, clip(x.title, 118) + (brief.short ? '\n' + brief.short : '')),
      decision: { proposal: x.id, ...(x.tier !== undefined ? { tier: x.tier } : {}), ...(s ? { steered: s } : {}), brief },
    });
  });
  cards.push({ id: 'close', kind: 'close', headline: 'That is the morning.', tone: 'calm', lines: [] });
  return { since, until, products: sums, cards, ...(agents ? { agents } : {}) };
}

/** What deciding buys, in one line: "Now 9.3 literals, expected 7 · size S · change risk 3 of 10" (the number only when the
 *  product has a current reading of the finding's metric). */
function stakes(p: ProductFacts, x: Proposal): string | null {
  let cur: { value: number; unit?: string; at: string } | undefined;
  if (x.metric) for (const m of p.scan.measurements) {
    if (m.feature !== x.feature || m.lens !== x.lens || m.metric !== x.metric || m.phase === 'after' || m.proposal_id) continue;
    if (!cur || m.measured_at > cur.at) cur = { value: m.value, ...(m.unit ? { unit: m.unit } : {}), at: m.measured_at };
  }
  const u = cur?.unit ? ' ' + cur.unit : '';
  const parts = [
    cur && x.metric ? `${p.labels?.get(x.lens + '|' + x.metric) ?? x.metric} now ${fmt(cur.value)}${u}${x.expected_delta ? `, expected ${fmt(cur.value + x.expected_delta)}${u}` : ''}` : null,
    x.size ? 'size ' + x.size : null,
    x.risk !== undefined ? `change risk ${x.risk} of 10` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The deck as an agent reads it on the door (morning.brief: GET /api/companion/morning?view=agent): the same cards and the
 *  same brief lines, without the page's styling and evidence, so a whole morning fits the door's result cap (tool-call.ts
 *  RESULT_CAP; the full deck with every card's brief did not). */
export interface AgentCard {
  id: string; kind: CardKind; product?: string; headline: string; lines: string[];
  place?: { product: string; target?: FocusPlace['target'] };
  decision?: { proposal: string; tier?: number; steered?: { verdict: Verdict; at: string }; brief?: { lines: string[]; advice: Brief['advice']['say']; recommend?: 'decline'; note?: string } };
}
export interface AgentDeck { since: string; until: string; products: ProductSummary[]; agents?: TrailTally; cards: AgentCard[] }
export function agentDeck(d: MorningDeck): AgentDeck {
  return {
    since: d.since, until: d.until, products: d.products, ...(d.agents ? { agents: d.agents } : {}),
    cards: d.cards.map((c) => {
      const x = c.decision, b = x?.brief;
      return {
        id: c.id, kind: c.kind, ...(c.product ? { product: c.product } : {}), headline: c.headline, lines: c.lines.map((l) => l.text),
        ...(c.place ? { place: { product: c.place.product, ...(c.place.target ? { target: c.place.target } : {}) } } : {}),
        ...(x ? { decision: {
          proposal: x.proposal, ...(x.tier !== undefined ? { tier: x.tier } : {}), ...(x.steered ? { steered: { verdict: x.steered.verdict, at: x.steered.at } } : {}),
          ...(b ? { brief: { lines: b.lines, advice: b.advice.say, ...(b.recommend ? { recommend: b.recommend, note: b.note } : {}) } } : {}),
        } } : {}),
      };
    }),
  };
}

/** One release item in words: "Split the X bundle · Checkout: expected 41 KB, measured 44 KB after the release". */
export function trackWords(t: Track, where: ReadonlyMap<string, Where>): string {
  const room = where.get(t.feature)?.roomName, u = t.unit ? ' ' + t.unit : '';
  const head = t.title + (room ? ' · ' + room : '');
  if (t.stage === 'confirmed' && t.current !== undefined) return `${head}: measured ${fmt(t.current)}${u} after the release, as expected`;
  if (t.stage === 'not-confirmed' && t.current !== undefined && t.expected !== undefined) return `${head}: expected ${fmt(t.expected)}${u}, measured ${fmt(t.current)}${u}`;
  return `${head}: not measured since the release`;
}

/** A decision taken this morning somewhere other than the deck: on the plan, in the ledger, or in Personas (which writes the
 *  same store through its own path). The deck counts them so the morning reads as one place. */
export interface Elsewhere { product: string; title: string; status: string; by?: string }

/** Proposals decided in [since, until] with no steering row: what other surfaces decided this morning. */
export function decidedElsewhere(products: readonly ProductFacts[], steer: readonly SteerRow[], since: string, until: string): Elsewhere[] {
  const mine = new Set(steer.filter((r) => r.at >= since).map((r) => r.product + ' ' + r.proposal)), out: Elsewhere[] = [];
  for (const p of products) for (const x of p.scan.proposals) {
    if (!x.decided_at || x.decided_at < since || x.decided_at > until || mine.has(p.slug + ' ' + x.id)) continue;
    if (x.status !== 'approved' && x.status !== 'declined') continue;
    out.push({ product: p.name, title: x.title, status: x.status, ...(x.decided_by ? { by: x.decided_by } : {}) });
  }
  return out;
}

const VERDICT_WORD: Record<Verdict, string> = { approve: 'Approved', defer: 'Deferred', hold: 'Held', decline: 'Declined as a repeat' };

/** The close card's lines for what was steered this morning (rows at or after `since`) and what was decided elsewhere. */
export function closeLines(steer: readonly SteerRow[], since: string, logWhere: string, elsewhere: readonly Elsewhere[] = []): CardLine[] {
  const today = steer.filter((r) => r.at >= since);
  const k = (v: Verdict) => today.filter((r) => r.verdict === v).length;
  const other: CardLine[] = elsewhere.length
    ? [{ text: `Also decided this morning elsewhere (the plan, the ledger or Personas): ${elsewhere.length}.` }, ...elsewhere.slice(0, 3).map((e) => ({ text: `${e.status === 'approved' ? 'Approved' : 'Declined'} in ${e.product}${e.by ? ' by ' + e.by : ''}: ${e.title}` }))]
    : [];
  if (!today.length) return [{ text: 'Nothing was decided on this deck this morning. The decisions will be here tomorrow.' }, ...other];
  return [
    { text: `${k('approve')} approved, ${k('defer')} deferred to tomorrow, ${k('hold')} held, ${k('decline')} declined as ${k('decline') === 1 ? 'a repeat' : 'repeats'}.`, tone: 'good' },
    ...today.slice(-5).map((r) => ({ text: `${VERDICT_WORD[r.verdict]}: ${r.title}` })),
    ...other,
    { text: `Steering log: ${logWhere}` },
  ];
}
