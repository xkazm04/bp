// GET/POST /api/companion/brain: a thin mount. The handlers, their localhost and JSON guards and their contract are in
// packages/core/src/server/api/companion/brain/route.ts; apps/server mounts the same functions.
export { GET, POST } from '@bp/core/server/api/companion/brain/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
