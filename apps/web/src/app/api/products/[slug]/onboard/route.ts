// POST /api/products/[slug]/onboard: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/products/[slug]/onboard/route.ts; apps/server mounts the same functions.
export { POST } from '@bp/core/server/api/products/[slug]/onboard/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
