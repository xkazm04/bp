// POST /api/products/[slug]/proposals/approve (D15, a set of findings): a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/products/[slug]/proposals/approve/route.ts; apps/server mounts the same function.
export { POST } from '@bp/core/server/api/products/[slug]/proposals/approve/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
