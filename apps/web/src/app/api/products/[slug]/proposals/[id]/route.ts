// POST /api/products/[slug]/proposals/[id]: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/proposals/[id]/route.ts; apps/server mounts the same functions.
export { POST } from '@bp/core/server/api/products/[slug]/proposals/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
