// POST /api/products/[slug]/lenses/[id]/execute: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/lenses/[id]/execute/route.ts; apps/server mounts the same functions.
export { POST } from '@bp/core/server/api/products/[slug]/lenses/[id]/execute/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
