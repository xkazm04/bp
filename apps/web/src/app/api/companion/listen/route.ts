// POST /api/companion/listen: a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/companion/listen/route.ts; apps/server mounts the same function.
export { POST } from '@bp/core/server/api/companion/listen/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
