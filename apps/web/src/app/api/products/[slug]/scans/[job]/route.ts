// DELETE /api/products/[slug]/scans/[job]: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/scans/[job]/route.ts; apps/server mounts the same functions.
export { DELETE } from '@bp/core/server/api/products/[slug]/scans/[job]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
