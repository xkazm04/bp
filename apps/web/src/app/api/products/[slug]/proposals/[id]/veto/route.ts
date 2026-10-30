// POST /api/products/[slug]/proposals/[id]/veto: a thin mount. The handler, its localhost and JSON guards and its contract are in
// packages/core/src/server/api/products/[slug]/proposals/[id]/veto/route.ts; apps/server mounts the same function.
export { POST } from '@bp/core/server/api/products/[slug]/proposals/[id]/veto/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
