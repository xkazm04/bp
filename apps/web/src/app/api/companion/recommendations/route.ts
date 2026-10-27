// POST /api/companion/recommendations: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/recommendations/route.ts; apps/server mounts the same functions.
export { POST } from '@bp/core/server/api/companion/recommendations/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
