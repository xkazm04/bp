// GET /api/companion/decisions: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/decisions/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/companion/decisions/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
