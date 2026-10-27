// GET / POST /api/companion/voice: a thin mount. The handler, its guard and its contract are in
// packages/core/src/server/api/companion/voice/route.ts; apps/server mounts the same functions.
export { GET, POST } from '@bp/core/server/api/companion/voice/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
