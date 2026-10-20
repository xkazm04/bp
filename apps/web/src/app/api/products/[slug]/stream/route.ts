// GET /api/products/[slug]/stream: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/stream/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/products/[slug]/stream/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
