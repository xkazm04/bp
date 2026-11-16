// GET /api/products/[slug]/onboarding/feed: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/products/[slug]/onboarding/feed/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/products/[slug]/onboarding/feed/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
