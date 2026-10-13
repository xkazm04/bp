// POST /api/lens-draft, body `{ product: <slug> | 'kettle', message (1..4000 chars), session? }`: one turn of the
// temporary-lens onboarding chat. Runs `claude -p --output-format json --dangerously-skip-permissions [--resume
// <session>]` in the product repo (Kettle: the blueprint repo, whose sample map Claude reads), the message on
// stdin; the first turn (no session) carries the onboarding contract (src/lib/scan/lens-draft.ts) before it.
// 200 `{ session, reply, done: false }` (a question), `{ session, reply, draft, done: true }` (a valid manifest
// in a ```lens-manifest block), `{ session, reply, done: false, error }` (a block that failed the check: the chat
// goes on). 400 for a bad body; 404 for an unknown product; 502 when the CLI failed; 503 when it is not
// installed; 504 after 3 minutes (the process tree is killed). Kettle runs the real CLI too. Localhost only.
import path from 'node:path';
import { findProduct } from '@/lib/scan/products.server';
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { killTree, spawnCli } from '@/lib/scan/jobs.server';
import { draftMapPath, onboardingContract, parseDraftReply } from '@/lib/scan/lens-draft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 180_000, MAX_MESSAGE = 4000, OUT_CAP = 4 << 20;
const SESSION = /^[0-9a-f-]{8,64}$/i;

type Outcome = { kind: 'exit'; code: number | null; out: string; err: string } | { kind: 'timeout' } | { kind: 'error'; missing: boolean; message: string };

/** The CLI's `--output-format json` answer: `{ result, session_id, is_error }` (the last result object if it printed several). */
function readResult(out: string): { result: string; session?: string; isError: boolean } | null {
  let j: unknown;
  try { j = JSON.parse(out.trim()); } catch {
    const last = out.trim().split(/\r?\n/).pop() ?? '';
    try { j = JSON.parse(last); } catch { return null; }
  }
  if (Array.isArray(j)) j = [...j].reverse().find((x) => x && typeof x === 'object' && (x as { type?: unknown }).type === 'result') ?? j[j.length - 1];
  if (!j || typeof j !== 'object') return null;
  const o = j as { result?: unknown; session_id?: unknown; is_error?: unknown };
  return { result: typeof o.result === 'string' ? o.result : '', session: typeof o.session_id === 'string' ? o.session_id : undefined, isError: o.is_error === true };
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const b = (body ?? {}) as { product?: unknown; message?: unknown; session?: unknown };
  if (typeof b.product !== 'string' || !b.product) return Response.json({ error: 'product must be a product slug or "kettle"' }, { status: 400 });
  if (typeof b.message !== 'string' || !b.message.trim() || b.message.length > MAX_MESSAGE) return Response.json({ error: `message must be 1..${MAX_MESSAGE} characters` }, { status: 400 });
  if (b.session !== undefined && (typeof b.session !== 'string' || !SESSION.test(b.session))) return Response.json({ error: 'session must be the id a previous turn answered' }, { status: 400 });
  const kettle = b.product === 'kettle', p = kettle ? null : findProduct(b.product);
  if (!kettle && !p) return Response.json({ error: `unknown product ${b.product}` }, { status: 404 });
  const cwd = p ? p.root : path.resolve(/* turbopackIgnore: true */ process.cwd());
  const session = b.session as string | undefined;
  const args = ['-p', '--output-format', 'json', '--dangerously-skip-permissions', ...(session ? ['--resume', session] : [])];
  const prompt = session ? b.message : `${onboardingContract(draftMapPath(kettle))}\n\n---\n\nThe user's request:\n${b.message}`;

  const s = spawnCli(args, cwd);
  if (!s.ok) return Response.json({ error: s.error }, { status: s.missing ? 503 : 500 });
  const child = s.child;
  const outcome = await new Promise<Outcome>((resolve) => {
    let out = '', err = '', settled = false;
    const end = (o: Outcome) => { if (settled) return; settled = true; clearTimeout(timer); req.signal.removeEventListener('abort', onAbort); resolve(o); };
    const timer = setTimeout(() => { killTree(child); end({ kind: 'timeout' }); }, TIMEOUT_MS);
    const onAbort = () => { killTree(child); end({ kind: 'error', missing: false, message: 'the request was cancelled' }); };
    req.signal.addEventListener('abort', onAbort);
    child.stdout?.on('data', (d: Buffer) => { if (out.length < OUT_CAP) out += d.toString('utf8'); });
    child.stderr?.on('data', (d: Buffer) => { err = (err + d.toString('utf8')).slice(-8192); });
    child.on('error', (e: NodeJS.ErrnoException) => end({ kind: 'error', missing: e.code === 'ENOENT', message: e.message }));
    child.on('close', (code) => end({ kind: 'exit', code, out, err }));
    child.stdin?.end(prompt);
  });

  if (outcome.kind === 'timeout') return Response.json({ error: 'Claude took longer than 3 minutes' }, { status: 504 });
  if (outcome.kind === 'error') return Response.json({ error: outcome.missing ? 'Claude Code CLI not found (set BP_CLAUDE_BIN)' : outcome.message }, { status: outcome.missing ? 503 : 502 });
  const res = readResult(outcome.out);
  if (outcome.code !== 0 || !res || res.isError) {
    const why = (res?.isError && res.result) || outcome.err.trim().split(/\r?\n/).pop() || (res ? '' : 'Claude answered no JSON') || `exit ${outcome.code}`;
    return Response.json({ error: `Claude Code failed: ${why}` }, { status: 502 });
  }
  const sess = res.session ?? session;
  const d = parseDraftReply(res.result);
  if (d.draft) return Response.json({ session: sess, reply: d.reply, draft: d.draft, done: true });
  return Response.json(d.error ? { session: sess, reply: d.reply, done: false, error: d.error } : { session: sess, reply: d.reply, done: false });
}
