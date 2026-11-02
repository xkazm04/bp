// GET /api/onboarding: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/onboarding/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/onboarding/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
