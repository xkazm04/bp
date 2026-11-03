// GET / POST /api/products/[slug]/releases/watch: a thin mount. The handlers, their localhost guards and their contract are
// in packages/core/src/server/api/products/[slug]/releases/watch/route.ts; apps/server mounts the same functions.
export { GET, POST } from '@bp/core/server/api/products/[slug]/releases/watch/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
