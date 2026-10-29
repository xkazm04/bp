// GET POST /api/companion/morning: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/morning/route.ts; apps/server mounts the same functions.
export { GET, POST } from '@bp/core/server/api/companion/morning/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
