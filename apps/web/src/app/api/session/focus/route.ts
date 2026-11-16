// GET POST /api/session/focus: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/session/focus/route.ts; apps/server mounts the same functions.
export { GET, POST } from '@bp/core/server/api/session/focus/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
