// GET POST /api/products/[slug]/focuses: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/focuses/route.ts; apps/server mounts the same functions.
export { GET, POST } from '@bp/core/server/api/products/[slug]/focuses/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
