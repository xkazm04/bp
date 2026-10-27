// PATCH DELETE /api/products/[slug]/waves/[wave]: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/waves/[wave]/route.ts; apps/server mounts the same functions.
export { PATCH, DELETE } from '@bp/core/server/api/products/[slug]/waves/[wave]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
