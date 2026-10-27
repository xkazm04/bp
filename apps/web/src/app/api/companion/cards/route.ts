// GET POST /api/companion/cards: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/cards/route.ts; apps/server mounts the same functions.
export { GET, POST } from '@bp/core/server/api/companion/cards/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
