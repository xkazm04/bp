// POST /api/products/[slug]/proposals/[id]/decline: a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/products/[slug]/proposals/[id]/decline/route.ts; apps/server mounts the same function.
export { POST } from '@bp/core/server/api/products/[slug]/proposals/[id]/decline/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
