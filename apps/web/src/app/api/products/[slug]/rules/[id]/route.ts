// DELETE /api/products/[slug]/rules/[id]: a thin mount. The handler, its localhost guard and its contract are in
// packages/core/src/server/api/products/[slug]/rules/[id]/route.ts; apps/server mounts the same functions.
export { DELETE } from '@bp/core/server/api/products/[slug]/rules/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
