// GET /api/onboarding/requests/[request]: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/onboarding/requests/[request]/route.ts; apps/server mounts the same functions.
export { GET } from '@bp/core/server/api/onboarding/requests/[request]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
