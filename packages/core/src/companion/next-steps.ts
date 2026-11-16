// What to do next (G3, 2026-11-11): the top next actions across the person's products, ranked from what bp already knows,
// each with its reason, so Glim's "what should I do next" stands on data and never on a priority he made up. Pure: the
// server (server/api/companion/morning.server.ts nextStepsRead) reads the Morning Watch deck, the coverage gaps and the
// shipped items waiting for triage, and hands them here. The `next.steps` tool reads it (GET /api/companion/morning?view=next).
// The order is fixed and said in `ORDER`:
//   1 decide   a stop-ship decision waiting (tier 0): nothing outranks it
//   2 failed   a build that failed: first what the person's own approvals became (the deck's outcomes cards, with the
//              reason), then overnight agent builds (the built cards' failed lines)
//   3 short    a release whose items measured short of what was expected
//   4 decide   a high (tier 1) decision waiting
//   5 decide   any other decision on the deck (medium, backlog, untiered), in the deck's own order
//   6 scan     the most unmeasured or stale feature of a product (gaps; one per product)
//   7 triage   shipped items waiting for the person's accept (one per product)
// Picking: every stop-ship first (up to the limit); then the best of each kind not yet shown, in that order (a stop-ship
// does not use up "decide"); then the rest by rank. So the steps are different kinds of work when the data has them (six
// failures do not fill the list), and nothing is dropped silently: `more` counts what did not fit.
import type { Gap } from './contract.ts';
import type { MorningDeck } from './morning.ts';

export type StepKind = 'decide' | 'failed' | 'short' | 'scan' | 'triage';
export interface StepTarget { kind: 'feature' | 'room' | 'decision'; id: string }
export interface NextStep {
  rank: number;
  kind: StepKind;
  product: string;
  productName: string;
  /** What to do, one line, in plain words. */
  title: string;
  /** Why it is here, from the data (a tier, a failure's reason, a reading, a count). */
  why: string;
  /** What I can do about it with my tools, in words (the person still decides). */
  can: string;
  /** Where focus.show takes the person, when the step is about one place or decision. */
  show?: StepTarget;
  /** The finding or item it is about, when there is one. */
  ref?: string;
}
export interface NextSteps { since: string; until: string; steps: NextStep[]; more: number; basis: string[]; skipped?: { product: string; why: string }[] }
export interface StepFacts {
  deck: MorningDeck;
  gaps: readonly Gap[];
  triage: readonly { product: string; id: string; title: string }[];
  /** product -> feature slug -> its name on the plan (gaps carry slugs only). */
  names?: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export const NEXT_STEPS_DEFAULT = 3, NEXT_STEPS_MAX = 10;
export const ORDER: readonly string[] = ['a stop-ship decision', 'a failed build (your approvals first)', 'a release that fell short', 'a high decision', 'another decision on the deck', 'an unmeasured or stale feature', 'shipped items waiting for your accept'];
/** The built card's failed lines start with this (morning.ts builtLines). */
export const FAILED_LINE = 'Failed: ';
const TIER_WORDS = ['stop-ship', 'high', 'medium', 'backlog'];
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const plural = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`;

interface Cand extends Omit<NextStep, 'rank'> { band: number; order: number }

export function nextSteps(f: StepFacts, opts: { product?: string; limit?: number } = {}): NextSteps {
  const limit = Math.min(NEXT_STEPS_MAX, Math.max(1, Math.floor(opts.limit ?? NEXT_STEPS_DEFAULT)));
  const nameOf = new Map(f.deck.products.map((p) => [p.slug, p.name]));
  const pn = (slug: string) => nameOf.get(slug) ?? slug;
  const out: Cand[] = [];
  let order = 0;
  const add = (c: Omit<Cand, 'order' | 'productName'>) => out.push({ ...c, productName: pn(c.product), order: order++ });

  // decisions, as the deck ranked them (tier, then risk, then age); a steered one (decided this morning) is done
  for (const c of f.deck.cards) {
    if (c.kind !== 'decision' || !c.decision || !c.product || c.decision.steered) continue;
    const t = c.decision.tier, tier = t !== undefined ? TIER_WORDS[t] : undefined;
    const stakes = c.lines.slice(2).map((l) => l.text).find((x) => !/^Your order|^Held since/.test(x));
    const where = c.lines[0]?.text.split(' · ').slice(2).join(' · ');
    add({
      band: t === 0 ? 0 : t === 1 ? 3 : 4, kind: 'decide', product: c.product,
      title: `Decide: ${clip(c.headline, 110)}`,
      why: [tier ? `${tier.charAt(0).toUpperCase() + tier.slice(1)} on ${pn(c.product)}${where ? ', in ' + where : ''}` : `Waiting on ${pn(c.product)}`, stakes].filter(Boolean).join('; '),
      can: 'I can show it and read its brief; your approve or decline goes on a card you confirm.',
      show: { kind: 'decision', id: c.decision.proposal }, ref: c.decision.proposal,
    });
  }
  // failures: what the person's approvals became first, then the night's builds (one per product and title)
  const seen = new Set<string>();
  for (const c of f.deck.cards) {
    if (c.kind !== 'outcomes' || !c.product) continue;
    // one with a recorded reason first: there is something to look at
    for (const x of [...(c.outcomes ?? [])].sort((a, b) => (a.reason ? 0 : 1) - (b.reason ? 0 : 1))) {
      if (x.outcome !== 'failed' || seen.has(c.product + '\u0000' + x.title)) continue;
      seen.add(c.product + '\u0000' + x.title);
      add({
        band: 1, kind: 'failed', product: c.product, title: `Look at why "${clip(x.title, 90)}" failed`,
        why: `You approved it ${x.decided_at.slice(0, 10)} and its build failed${x.reason ? ': ' + clip(x.reason, 140) : '; no reason was recorded'}.`,
        can: 'I can show you where it sits; sending it back for rework is a triage you choose.',
        ...(x.room ? { show: { kind: 'room' as const, id: x.room } } : {}), ref: x.proposal,
      });
    }
  }
  for (const c of f.deck.cards) {
    if (c.kind !== 'built' || !c.product) continue;
    for (const l of c.lines) {
      if (!l.text.startsWith(FAILED_LINE)) continue;
      const title = l.text.slice(FAILED_LINE.length);
      if (seen.has(c.product + '\u0000' + title)) continue;
      seen.add(c.product + '\u0000' + title);
      add({
        band: 1, kind: 'failed', product: c.product, title: `Look at why "${clip(title, 90)}" failed`,
        why: `An agent built it overnight on ${pn(c.product)} and the build failed.`,
        can: 'I can show you the room it landed in; the stand-up has the failure.',
        ...(c.place?.target && (c.place.target.kind === 'room' || c.place.target.kind === 'feature') ? { show: { kind: c.place.target.kind, id: c.place.target.id } } : {}),
      });
    }
  }
  // releases that fell short of what was expected
  for (const c of f.deck.cards) {
    if (c.kind !== 'release' || c.tone !== 'bad' || !c.product) continue;
    const bad = c.lines.find((l) => l.tone === 'bad')?.text, m = /^(.+?) fell short/.exec(c.headline);
    add({
      band: 2, kind: 'short', product: c.product, title: m ? `Look into ${clip(m[1], 90)}, which fell short` : `Look into what fell short: ${clip(c.headline, 100)}`,
      why: bad ? clip(bad, 160) : c.headline,
      can: 'I can show you the feature and start a fresh measurement of it.',
      ...(c.place?.target && (c.place.target.kind === 'room' || c.place.target.kind === 'feature') ? { show: { kind: c.place.target.kind, id: c.place.target.id } } : {}),
    });
  }
  // the most unmeasured or stale feature per product (gaps arrive ranked)
  const byFeature = new Map<string, { product: string; feature: string; lenses: string[]; stale: number; first: number }>();
  f.gaps.forEach((g, i) => {
    if (g.reason !== 'unmeasured' && g.reason !== 'stale') return;
    const k = g.product + '\u0000' + g.feature, e = byFeature.get(k) ?? { product: g.product, feature: g.feature, lenses: [], stale: 0, first: i };
    e.lenses.push(g.lens);
    if (g.reason === 'stale') e.stale++;
    byFeature.set(k, e);
  });
  const topGap = new Map<string, { product: string; feature: string; lenses: string[]; stale: number; first: number }>();
  for (const e of [...byFeature.values()].sort((a, b) => a.first - b.first)) if (!topGap.has(e.product)) topGap.set(e.product, e);
  for (const e of topGap.values()) {
    const name = f.names?.get(e.product)?.get(e.feature) ?? e.feature;
    const lenses = e.lenses.map((l) => l.replace(/^.*\./, ''));
    add({
      band: 5, kind: 'scan', product: e.product, title: `Measure ${name} on ${pn(e.product)}`,
      why: e.stale === e.lenses.length ? `Its readings under ${lenses.join(', ')} are stale.` : `It has no reading under ${plural(e.lenses.length, 'lens', 'lenses')} (${clip(lenses.join(', '), 80)}), so nothing there is known.`,
      can: 'I can start a scan of it; a directed one, with your note, goes on a card.',
      show: { kind: 'feature', id: e.feature },
    });
  }
  // shipped items waiting for the person's accept, per product
  const tri = new Map<string, { title: string }[]>();
  for (const t of f.triage) tri.set(t.product, [...(tri.get(t.product) ?? []), { title: t.title }]);
  for (const [product, xs] of tri) {
    add({
      band: 6, kind: 'triage', product, title: `Accept or send back ${plural(xs.length, 'shipped item')} on ${pn(product)}`,
      why: `Built and waiting for your word, e.g. "${clip(xs[0].title, 80)}".`,
      can: 'I can mark them accepted, for rework, descoped or reopened when you say which.',
    });
  }

  const pool = out.filter((c) => !opts.product || c.product === opts.product).sort((a, b) => a.band - b.band || a.order - b.order);
  const picked: Cand[] = [], kinds = new Set<StepKind>();
  // a stop-ship does not use up "decide": the next pass may still bring the best other decision
  for (const c of pool) if (c.band === 0 && picked.length < limit) picked.push(c);
  for (const c of pool) if (picked.length < limit && !picked.includes(c) && !kinds.has(c.kind)) { picked.push(c); kinds.add(c.kind); }
  for (const c of pool) if (picked.length < limit && !picked.includes(c)) picked.push(c);
  picked.sort((a, b) => a.band - b.band || a.order - b.order);
  const steps = picked.map(({ band: _b, order: _o, ...s }, i) => ({ rank: i + 1, ...s }));
  const basis = [`the morning since ${f.deck.since.slice(0, 16).replace('T', ' ')} UTC (decisions, what your approvals became, overnight builds, releases)`, `${plural(f.gaps.length, 'coverage gap')}`, `${plural(f.triage.length, 'shipped item')} waiting for triage`, `ranked: ${ORDER.join(' > ')}`];
  return { since: f.deck.since, until: f.deck.until, steps, more: pool.length - steps.length, basis, ...(f.deck.skipped?.length ? { skipped: f.deck.skipped } : {}) };
}
