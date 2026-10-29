// DELETE /api/products/[slug]/rules/[id]: revoke a standing rule (an order lifts, a grant ends). The HUMAN path (the
// `x-bp-human` token, 403 without it). The rule stays in bp-rules.json with `revokedAt` and `revokedBy` as the record.
// 200 `{ rule }`; 404 unknown product or rule; 409 already revoked. Localhost only.
import { door } from '@bp/core/server/route-door.server';
import { revokeRule } from '@bp/core/server/rules.server';
import { triageBy } from '@bp/core/server/release.server';
import { isHuman, notHuman } from '../../../../companion/door.server.ts';

const RULE_ID = /^[OG]-\d{1,6}$/;

const rule = door('products/[slug]/rules/[id]', {
  DELETE: {
    params: ({ id }) => (RULE_ID.test(id ?? '') ? null : Response.json({ error: 'bad rule id' }, { status: 400 })),
    live: async ({ req, product: p, params }) => {
      if (!isHuman(req)) return notHuman();
      const r = revokeRule(p.root, params.id, await triageBy());
      return r.ok ? Response.json({ rule: r.rule }) : Response.json({ error: r.error }, { status: r.status });
    },
  },
});

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return rule.DELETE(req, ctx);
}
