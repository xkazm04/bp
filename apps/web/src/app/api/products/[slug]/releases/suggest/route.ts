// GET /api/products/[slug]/releases/suggest: a thin mount. The handler, its localhost guard and its contract are in
// packages/core/src/server/api/products/[slug]/releases/suggest/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/products/[slug]/releases/suggest/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
