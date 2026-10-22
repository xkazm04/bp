// POST /api/lens-draft, body `{ product: <slug> | 'kettle', message (1..4000 chars), session?, kind?: 'project' |
// 'temporary' }`: one turn of the lens onboarding chat (kind 'project' by default: a permanent reverse-DNS lens).
// Runs `claude -p --output-format json --dangerously-skip-permissions [--resume <session>]` in the product repo
// (Kettle: the blueprint repo, whose sample map Claude reads), the prompt on stdin. The first turn (no session) is
// `/lens-scan onboard --draft-only [--temporary]` followed by the user's message: the onboarding contract lives in
// the lens-scan skill (references/lens-onboarding.md), which prints one fenced `lens-manifest` block when it has a
// draft, else a question; later turns resume the session with the message alone. The block is checked with
// checkLensManifest in the kind's mode (with a live product's taken looks). 200 `{ session, reply, done: false }`
// (a question), `{ session, reply, draft, done: true }` (a valid manifest in a ```lens-manifest block), `{ session,
// reply, done: false, error }` (a block that failed the check: the chat goes on). 400 for a bad body; 404 for an unknown product; 502 when the CLI failed; 503 when it is not
// installed; 504 after 3 minutes (the process tree is killed). Kettle runs the real CLI too. Localhost only.
import path from 'node:path';
import { findProduct } from '@bp/core/server/products.server';
import { localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { killTree, spawnCli } from '@bp/core/server/jobs.server';
import { onboardPrompt, parseDraftReply, type DraftKind } from '@bp/core/scan/lens-draft';
import { readLensesAndFeatures } from '@bp/core/server/lens-write.server';
import { takenLooks } from '@bp/core/scan/jobs';

const TIMEOUT_MS = 180_000, MAX_MESSAGE = 4000, OUT_CAP = 4 << 20;
const SESSION = /^[0-9a-f-]{8,64}$/i;

type Outcome = { kind: 'exit'; code: number | null; out: string; err: string; truncated: boolean } | { kind: 'timeout' } | { kind: 'error'; missing: boolean; message: string };

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
  const b = (body ?? {}) as { product?: unknown; message?: unknown; session?: unknown; kind?: unknown };
  if (typeof b.product !== 'string' || !b.product) return Response.json({ error: 'product must be a product slug or "kettle"' }, { status: 400 });
  if (typeof b.message !== 'string' || !b.message.trim() || b.message.length > MAX_MESSAGE) return Response.json({ error: `message must be 1..${MAX_MESSAGE} characters` }, { status: 400 });
  if (b.session !== undefined && (typeof b.session !== 'string' || !SESSION.test(b.session))) return Response.json({ error: 'session must be the id a previous turn answered' }, { status: 400 });
  if (b.kind !== undefined && b.kind !== 'project' && b.kind !== 'temporary') return Response.json({ error: "kind must be 'project' or 'temporary'" }, { status: 400 });
  const kind: DraftKind = b.kind ?? 'project';
  const kettle = b.product === 'kettle', p = kettle ? null : findProduct(b.product);
  if (!kettle && !p) return Response.json({ error: `unknown product ${b.product}` }, { status: 404 });
  const cwd = p ? p.root : path.resolve(/* turbopackIgnore: true */ process.cwd());
  const session = b.session as string | undefined;
  const args = ['-p', '--output-format', 'json', '--dangerously-skip-permissions', ...(session ? ['--resume', session] : [])];
  const prompt = session ? b.message : onboardPrompt(b.message, kind, kettle);

  const s = spawnCli(args, cwd);
  if (!s.ok) return Response.json({ error: s.error }, { status: s.missing ? 503 : 500 });
  const child = s.child;
  const outcome = await new Promise<Outcome>((resolve) => {
    let out = '', err = '', settled = false, truncated = false;
    const end = (o: Outcome) => { if (settled) return; settled = true; clearTimeout(timer); req.signal.removeEventListener('abort', onAbort); resolve(o); };
    const timer = setTimeout(() => { killTree(child); end({ kind: 'timeout' }); }, TIMEOUT_MS);
    const onAbort = () => { killTree(child); end({ kind: 'error', missing: false, message: 'the request was cancelled' }); };
    req.signal.addEventListener('abort', onAbort);
    child.stdout?.on('data', (d: Buffer) => {
      if (out.length >= OUT_CAP) { truncated = true; return; }
      out += d.toString('utf8');
      if (out.length > OUT_CAP) { out = out.slice(0, OUT_CAP); truncated = true; }
    });
    child.stderr?.on('data', (d: Buffer) => { err = (err + d.toString('utf8')).slice(-8192); });
    child.on('error', (e: NodeJS.ErrnoException) => end({ kind: 'error', missing: e.code === 'ENOENT', message: e.message }));
    child.on('close', (code) => end({ kind: 'exit', code, out, err, truncated }));
    child.stdin?.end(prompt);
  });

  if (outcome.kind === 'timeout') return Response.json({ error: 'Claude took longer than 3 minutes' }, { status: 504 });
  if (outcome.kind === 'error') return Response.json({ error: outcome.missing ? 'Claude Code CLI not found (set BP_CLAUDE_BIN)' : outcome.message }, { status: outcome.missing ? 503 : 502 });
  const res = readResult(outcome.out);
  if (outcome.code !== 0 || !res || res.isError) {
    const why = (res?.isError && res.result) || outcome.err.trim().split(/\r?\n/).pop() || (res ? '' : outcome.truncated ? `Claude's reply was longer than ${OUT_CAP >> 20} MiB and was cut off; ask for a shorter answer` : 'Claude answered no JSON') || `exit ${outcome.code}`;
    return Response.json({ error: `Claude Code failed: ${why}` }, { status: 502 });
  }
  const sess = res.session ?? session;
  // a live map's looks are read here; Kettle's are checked when the draft is accepted (the browser keeps its lenses)
  const map = p ? readLensesAndFeatures(p) : null;
  const d = parseDraftReply(res.result, { mode: kind, taken: map ? takenLooks(map.lenses, '') : [] });
  if (d.draft) return Response.json({ session: sess, reply: d.reply, draft: d.draft, done: true });
  return Response.json(d.error ? { session: sess, reply: d.reply, done: false, error: d.error } : { session: sess, reply: d.reply, done: false });
}
