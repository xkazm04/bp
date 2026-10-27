// GET POST /api/products/[slug]/waves: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/waves/route.ts; apps/server mounts the same functions.
export { GET, POST } from '@bp/core/server/api/products/[slug]/waves/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
