// POST /api/onboarding/start: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/onboarding/start/route.ts; apps/server mounts the same functions.
export { POST } from '@bp/core/server/api/onboarding/start/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
