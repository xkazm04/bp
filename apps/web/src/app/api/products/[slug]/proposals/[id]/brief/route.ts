// GET /api/products/[slug]/proposals/[id]/brief: a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/products/[slug]/proposals/[id]/brief/route.ts; apps/server mounts the same function.
export { GET } from '@bp/core/server/api/products/[slug]/proposals/[id]/brief/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
