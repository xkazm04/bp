// POST /api/products/[slug]/triage, body `{ ids: string[], decision: 'accept' | 'rework' | 'descope' | 'reopen', note?: string }`
// (1..200 proposal ids): a person's call on built items. It runs lens-scan's own `store.mjs triage` (the single owner of
// the transition rules: which statuses each decision may move, the note a failed item needs to be accepted, leaving a
// draft release, settling packs open -> triaged), `--by user:<gh login>` (packages/core/src/server/release.server.ts triageBy).
// `reopen` is the undo (lens-scan 1.6.0, store v3): each item back to the status it left, refused per item while its
// release is past draft, its rework rebuilt, its pack closed or nothing was recorded (skipped reasons `in-release`,
// `rebuilt`, `pack-closed`, `no-prior-status`); decision `reopened`.
// 200 + store.mjs's JSON `{ decision, by, triaged, skipped, packs_triaged }`; 409 with the same JSON plus `error: 'nothing moved'` when nothing moved, and 409 `{ error, triaged: [], skipped: [] }` when store.mjs refuses (every 409 has `error`, `triaged` and `skipped`);
// 400 for a bad body (or one store.mjs calls bad input); 404 for an unknown product or a missing store; 503 when
// lens-scan is not installed or the store stayed locked. The stream sees the write through the store's data_version.
// Localhost only.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct, hasStore, storeFile } from '@bp/core/server/products.server';
import { localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { MAX_TRIAGE, triage, triageBy } from '@bp/core/server/release.server';
import type { TriageBody } from '@bp/core/scan/types';

const DECISIONS = ['accept', 'rework', 'descope', 'reopen'];

/** `null` = not a valid TriageBody. */
function parse(x: unknown): TriageBody | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>, ids = o.ids;
  if (Object.keys(o).some((k) => k !== 'ids' && k !== 'decision' && k !== 'note')) return null;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_TRIAGE || ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i))) return null;
  if (typeof o.decision !== 'string' || !DECISIONS.includes(o.decision)) return null;
  if (o.note !== undefined && (typeof o.note !== 'string' || o.note.length > 4000)) return null;
  const body: TriageBody = { ids: [...new Set(ids as string[])], decision: o.decision as TriageBody['decision'] };
  if (typeof o.note === 'string') body.note = o.note;
  return body;
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  let raw: unknown;
  try { raw = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const body = parse(raw);
  if (!body) return Response.json({ error: `body must be { ids: string[] (1..${MAX_TRIAGE}), decision: 'accept' | 'rework' | 'descope' | 'reopen', note?: string }` }, { status: 400 });
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  const r = await triage(storeFile(p), body, await triageBy());
  // both 409s carry `error` and the result's lists, so a caller branches on a field, not on which shape arrived:
  // a store refusal has empty lists (it moved and skipped nothing), a nothing-moved answer has its skipped reasons
  if (!r.ok) return Response.json(r.kind === 'refused' ? { error: r.error, triaged: [], skipped: [] } : { error: r.error }, { status: r.kind === 'bad' ? 400 : r.kind === 'refused' ? 409 : 503 });
  return Response.json(r.data.triaged.length ? r.data : { error: 'nothing moved', ...r.data }, { status: r.data.triaged.length ? 200 : 409 });
}
