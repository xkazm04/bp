// GET /api/health: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/health/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/health/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
