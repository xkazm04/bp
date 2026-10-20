// GET /api/products/[slug]/structure: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/structure/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/products/[slug]/structure/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
