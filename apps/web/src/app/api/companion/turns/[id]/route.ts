// DELETE /api/companion/turns/[id]: a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/companion/turns/[id]/route.ts; apps/server mounts the same functions.
export { DELETE } from '@bp/core/server/api/companion/turns/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
