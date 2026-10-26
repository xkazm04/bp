// POST /api/companion/cards/[id]: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/cards/[id]/route.ts; apps/server mounts the same functions.
export { POST } from '@bp/core/server/api/companion/cards/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
