// GET /api/products/[slug]/shots/[...path]: a thin mount. The handler, its localhost guard and its contract are in
// packages/core/src/server/api/products/[slug]/shots/[...path]/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/products/[slug]/shots/[...path]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
