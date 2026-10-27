// DELETE /api/companion/policies/[id]: a thin mount. The handler, its guards and its contract are in
// packages/core/src/server/api/companion/policies/[id]/route.ts; apps/server mounts the same functions.
export { DELETE } from '@bp/core/server/api/companion/policies/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
