// GET /api/companion/help: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/help/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/companion/help/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
