// PATCH DELETE /api/products/[slug]/lenses/[id]: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/lenses/[id]/route.ts; apps/server mounts the same functions.
export { PATCH, DELETE } from '@bp/core/server/api/products/[slug]/lenses/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
