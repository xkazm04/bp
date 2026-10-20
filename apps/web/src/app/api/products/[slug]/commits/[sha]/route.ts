// GET /api/products/[slug]/commits/[sha]: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/commits/[sha]/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/products/[slug]/commits/[sha]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
