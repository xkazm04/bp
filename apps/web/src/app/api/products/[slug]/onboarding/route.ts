// GET /api/products/[slug]/onboarding: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/products/[slug]/onboarding/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/products/[slug]/onboarding/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
