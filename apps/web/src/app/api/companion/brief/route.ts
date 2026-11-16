// GET /api/companion/brief: a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/companion/brief/route.ts; apps/server mounts the same function.
export { GET } from '@bp/core/server/api/companion/brief/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
