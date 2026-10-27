// GET /api/companion/inbox: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/inbox/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/companion/inbox/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
