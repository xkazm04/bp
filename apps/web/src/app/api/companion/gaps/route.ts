// GET /api/companion/gaps: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/gaps/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/companion/gaps/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
