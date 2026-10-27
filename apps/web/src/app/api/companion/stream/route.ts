// GET /api/companion/stream: a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/companion/stream/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/companion/stream/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
