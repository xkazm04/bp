// GET /api/products/[slug]/rules: the product's standing rules (`{ rules, record, held, breaches }`: every rule, revoked
// and expired ones included as the record; the size of the decided record a rule is replayed over; per rule, what the
// doors held or refused under it (work/bp-rules-log.jsonl, scan/rules.ts tallyHeld) and the findings approved in its
// place against it since it was set (breachesOf: a person's own approval, or something that went around bp); per grant, how the owner's own later
// decisions in its place compare with it (`since`, sinceSet: drifting when they overrule it); and the rules the owner's own record
// suggests (scan/rules-suggest.ts: rooms where their decisions already follow a grant or a hold). Any client; agents read
// it as rules.list.
// POST /api/products/[slug]/rules, body a rule draft `{ kind: hold|only|cap|grant, scope: { kind, id?, label, features },
// lenses?, maxEffort?, model?, minTier?, tools?, hours?, text?, preview? }` (scan/rules.ts checkRuleBody):
//   preview: true   the backtest of the draft over the owner's decided findings, and what it would do to the open
//                   findings now (`now`: scan/rules.ts impact), nothing written (any client: an agent may show the owner
//                   the evidence before it proposes the rule). 200 `{ rule, backtest, now }`.
//   otherwise       the HUMAN path (the `x-bp-human` token, 403 without it): the rule is written to bp-rules.json with
//                   its author (`user:<gh login>`) and the evidence it was set on. 201 `{ rule, backtest }`.
// 400 for a bad draft; 404 for an unknown product or one with no map. Localhost only. Kettle has no rules (its orders
// are the sim's): 405.
import { door } from '@bp/core/server/route-door.server';
import { backtest, breachesOf, checkRuleBody, impact, ruleOf, sinceSet, tallyHeld } from '@bp/core/scan/rules';
import { readLensesAndFeatures } from '@bp/core/server/lens-write.server';
import { RulesUnreadable, addRule, decidedRows, listRules, openRows, readHeld, roomsOf, trustedLenses } from '@bp/core/server/rules.server';
import { suggestRules } from '@bp/core/scan/rules-suggest';
import { triageBy } from '@bp/core/server/release.server';
import { isHuman, notHuman } from '../../../companion/door.server.ts';
import { isGated, toolOf } from '../../../companion/tool-call.ts';

const rules = door('products/[slug]/rules', {
  GET: {
    live: ({ product: p, read }) => {
      const rows = read(() => decidedRows(p)), rules = listRules(p.root);
      const breaches = Object.fromEntries(rules.map((r) => [r.id, breachesOf(r, rows)]).filter(([, b]) => b.length));
      const since = Object.fromEntries(rules.map((r) => [r.id, sinceSet(r, rows)]).filter(([, x]) => x));
      return Response.json({ rules, record: { decided: rows.length, synthetic: rows.filter((r) => r.synthetic).length }, held: tallyHeld(readHeld(p.root)), breaches, since, suggestions: suggestRules(rows, roomsOf(p), rules) });
    },
  },
  POST: {
    body: true,
    live: async ({ req, slug, product: p, body, read }) => {
      const map = readLensesAndFeatures(p);
      if (!map) return Response.json({ error: `no readable structure for ${slug}` }, { status: 404 });
      const lenses = new Set(map.lenses.map((l) => l.id));
      const draft = checkRuleBody(body, {
        feature: (f) => map.features.has(f), lens: (l) => lenses.has(l),
        tool: (t) => { const x = toolOf(t); return !!x && isGated(x) && x.name !== 'policy.propose'; },
      });
      if (typeof draft === 'string') return Response.json({ error: draft }, { status: 400 });
      if (draft.tools) draft.tools = draft.tools.map((t) => toolOf(t)!.name);
      const rows = read(() => decidedRows(p)), bt = backtest(draft, rows);
      const preview = (body as { preview?: unknown }).preview === true;
      if (preview) return Response.json({ rule: { ...draft, id: null }, backtest: bt, now: impact(draft, read(() => openRows(p)), map.features.size, draft.cautious ? trustedLenses(draft, rows) : undefined) });
      if (!isHuman(req)) return notHuman();
      const by = await triageBy(), at = new Date().toISOString();
      let rule;
      try { rule = addRule(p.root, (all) => ({ ...ruleOf(draft, all, by), evidence: { decided: bt.decided, matched: bt.matched, differed: bt.differed, abstained: bt.abstained, at } })); } catch (e) {
        if (e instanceof RulesUnreadable) return Response.json({ error: e.message }, { status: 503 });
        throw e;
      }
      return Response.json({ rule, backtest: bt }, { status: 201 });
    },
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return rules.GET(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return rules.POST(req, ctx);
}
