// POST /api/session/place/return: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/session/place/return/route.ts; apps/server mounts the same functions.
export { POST } from '@bp/core/server/api/session/place/return/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
