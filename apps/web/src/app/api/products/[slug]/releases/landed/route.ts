// GET /api/products/[slug]/releases/landed: a thin mount. The handler, its localhost guard and its contract are in
// packages/core/src/server/api/products/[slug]/releases/landed/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/products/[slug]/releases/landed/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
