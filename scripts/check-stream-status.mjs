// Checks the stream status contract (docs/blueprint-ui.md, "SSE semantics"): a scan store that EXISTS but
// cannot be read reaches the client as `event: error` ({ message }), never as an empty snapshot; a store
// that does not exist yet still answers the empty snapshot ('No scan store yet'); a readable store answers
// its snapshot. Runs the real route handler (GET) over three throwaway stores for ~2.5 s each, then pins
// the in-tree consumers of the contract by reading their sources (comments stripped):
//   types.ts   StreamEvent names 'error'
//   client.ts  listens for a named 'error' event and sets status 'error' from it; its onerror ignores that
//              server event (a MessageEvent) so it does not reconnect over it
//   Header.tsx the pill has an 'error' branch (otherwise the text would read 'No scan yet')
// Run: node scripts/check-stream-status.mjs   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooks = `
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = ${JSON.stringify(ROOT)};
const tryFile = (p) => { for (const c of [p, p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return null; };
export async function resolve(spec, ctx, next) {
  let base = null;
  if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2));
  else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:')) base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
  if (base) { const f = tryFile(base); if (f) return { url: pathToFileURL(f).href, shortCircuit: true, format: f.endsWith('.json') || f.endsWith('.jsonl') ? 'module' : undefined }; }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith('.json') || url.endsWith('.jsonl')) {
    const text = fs.readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', source: url.endsWith('.json') ? 'export default ' + text : 'export default ' + JSON.stringify(text), shortCircuit: true };
  }
  return next(url, { ...ctx, importAttributes: {} });
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-stream-status-'));
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const mk = (slug, write) => {
  const repo = path.join(dir, slug);
  fs.mkdirSync(path.join(repo, '.ai/lens-scan'), { recursive: true });
  write?.(path.join(repo, '.ai/lens-scan/scan.db'));
  return { slug, root: repo };
};
const products = [
  mk('corrupt', (f) => fs.writeFileSync(f, 'this is not a sqlite database, just bytes '.repeat(200))),
  mk('absent'),
  mk('good', (f) => { const w = new DatabaseSync(f); w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8')); w.close(); }),
];
fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products }));
process.chdir(dir);
const warns = [];
console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
const { GET } = await import(pathToFileURL(path.join(ROOT, 'src/app/api/products/[slug]/stream/route.ts')).href);

async function events(slug, ms) {
  const ac = new AbortController();
  const res = await GET(new Request('http://x/api/products/' + slug + '/stream', { signal: ac.signal, headers: { host: 'localhost:3000' } }), { params: Promise.resolve({ slug }) });
  const reader = res.body.getReader(), dec = new TextDecoder();
  let text = '';
  const pump = (async () => { for (;;) { const r = await reader.read(); if (r.done) break; text += dec.decode(r.value); } })();
  await new Promise((r) => setTimeout(r, ms));
  ac.abort(); await reader.cancel().catch(() => {}); await pump.catch(() => {});
  return [...text.matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map((m) => ({ ev: m[1], data: m[2] }));
}
const names = (xs) => xs.map((x) => x.ev).join(',');

try {
  const bad = await events('corrupt', 2500);
  check('corrupt store: sends exactly one error event (once per message)', names(bad) === 'error', names(bad));
  check('corrupt store: error carries a message', bad[0] && typeof JSON.parse(bad[0].data).message === 'string' && JSON.parse(bad[0].data).message.length > 0, bad[0]?.data);
  check('corrupt store: no empty snapshot', !bad.some((x) => x.ev === 'snapshot'), names(bad));
  const none = await events('absent', 1500);
  check('absent store: still answers the empty snapshot', names(none) === 'snapshot', names(none));
  const ok = await events('good', 1500);
  check('readable store: answers its snapshot, no error', names(ok) === 'snapshot', names(ok));

  const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const types = code('src/lib/scan/types.ts'), client = code('src/lib/scan/client.ts'), header = code('src/components/Header.tsx');
  check('types.ts: StreamEvent names error', /type StreamEvent\s*=[^;]*'error'/.test(types));
  check("client.ts: addEventListener('error') sets status 'error'", /addEventListener\(\s*'error'[\s\S]{0,400}status:\s*'error'/.test(client));
  check('client.ts: onerror ignores the server error event', /onerror\s*=\s*\(\s*\w+[^)]*\)\s*=>\s*\{[^}]*instanceof MessageEvent/.test(client));
  check("Header.tsx: pill has an 'error' branch", /L\.status === 'error'/.test(header));
} finally {
  process.chdir(os.tmpdir());
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `check-stream-status: ${failed} failed, ${passed} passed` : `check-stream-status: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
