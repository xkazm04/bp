// GET /api/products/[slug]/rules: the product's standing rules (`{ rules, record }`: every rule, revoked and expired ones
// included as the record, and the size of the decided record a rule is replayed over). Any client; agents read it as
// rules.list.
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
import { backtest, checkRuleBody, impact, ruleOf } from '@bp/core/scan/rules';
import { readLensesAndFeatures } from '@bp/core/server/lens-write.server';
import { addRule, decidedRows, listRules, openRows } from '@bp/core/server/rules.server';
import { triageBy } from '@bp/core/server/release.server';
import { isHuman, notHuman } from '../../../companion/door.server.ts';
import { isGated, toolOf } from '../../../companion/tool-call.ts';

const rules = door('products/[slug]/rules', {
  GET: {
    live: ({ product: p, read }) => {
      const rows = read(() => decidedRows(p));
      return Response.json({ rules: listRules(p.root), record: { decided: rows.length, synthetic: rows.filter((r) => r.synthetic).length } });
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
      if (preview) return Response.json({ rule: { ...draft, id: null }, backtest: bt, now: impact(draft, read(() => openRows(p)), map.features.size) });
      if (!isHuman(req)) return notHuman();
      const by = await triageBy(), at = new Date().toISOString();
      const rule = addRule(p.root, (all) => ({ ...ruleOf(draft, all, by), evidence: { decided: bt.decided, matched: bt.matched, differed: bt.differed, abstained: bt.abstained, at } }));
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
