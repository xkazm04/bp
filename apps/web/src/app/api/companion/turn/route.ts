// POST /api/companion/turn: a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/companion/turn/route.ts; apps/server mounts the same functions.
export { POST } from '@bp/core/server/api/companion/turn/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
