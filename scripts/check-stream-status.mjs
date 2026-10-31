// Checks the stream status contract (docs/blueprint-ui.md, "SSE semantics"): a scan store that EXISTS but
// cannot be read reaches the client as `event: error` ({ message }), never as an empty snapshot; a store
// that does not exist yet still answers the empty snapshot ('No scan store yet'); a readable store answers
// its snapshot; a product with a map answers `map` { rev } after the snapshot and again when the map file changes
// (and the structure route answers the same rev). Runs the real route handler (GET) over three throwaway stores for ~2.5 s each, then pins
// the in-tree consumers of the contract by reading their sources (comments stripped):
//   types.ts   StreamEvent names 'error'
//   client.ts  listens for a named 'error' event and sets status 'error' from it; its onerror ignores that
//              server event (a MessageEvent) so it does not reconnect over it
//   liveness.ts the one scan verdict has an 'error' branch (otherwise the pill would read 'No scan yet'), and
//              Header.tsx's pill words that verdict
// Run: node scripts/check-stream-status.mjs   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerSrcHooks } from './lib/src-hooks.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerSrcHooks(ROOT);

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
  mk('mapped', (f) => { const w = new DatabaseSync(f); w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8')); w.close(); }),
  mk('good', (f) => { const w = new DatabaseSync(f); w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8')); w.close(); }),
];
fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products }));
process.chdir(dir);
const warns = [];
console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
const { GET } = await import(pathToFileURL(path.join(ROOT, 'apps/web/src/app/api/products/[slug]/stream/route.ts')).href);

async function events(slug, ms, during) {
  const ac = new AbortController();
  const res = await GET(new Request('http://x/api/products/' + slug + '/stream', { signal: ac.signal, headers: { host: 'localhost:3000' } }), { params: Promise.resolve({ slug }) });
  const reader = res.body.getReader(), dec = new TextDecoder();
  let text = '';
  if (during) setTimeout(during, 1300);
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

  // a product with a map: the snapshot, then the map's rev; rewriting the map sends the new rev (once)
  const mapFile = path.join(products.find((p) => p.slug === 'mapped').root, '.ai/lens-scan/app-structure.json');
  fs.writeFileSync(mapFile, '{"a":1}');
  const mapped = await events('mapped', 3400, () => fs.writeFileSync(mapFile, '{"a":1,"bb":2}'));
  check('mapped product: snapshot, map, then map again after the file changed', names(mapped) === 'snapshot,map,map', names(mapped));
  const revs = mapped.filter((x) => x.ev === 'map').map((x) => JSON.parse(x.data).rev);
  check('mapped product: the two revs differ', revs.length === 2 && revs[0] !== revs[1] && revs.every((r) => typeof r === 'string' && r), revs.join(' | '));
  const { GET: STRUCT } = await import(pathToFileURL(path.join(ROOT, 'apps/web/src/app/api/products/[slug]/structure/route.ts')).href);
  const sj = await (await STRUCT(new Request('http://x/api/products/mapped/structure', { headers: { host: 'localhost:3000' } }), { params: Promise.resolve({ slug: 'mapped' }) })).json();
  check('structure route answers the current rev of the stream', sj.rev === revs[1], sj.rev + ' vs ' + revs[1]);

  // a runaway client (a reload loop, a leaked EventSource): MAX_STREAMS open streams for one product, the next answers 429
  // with one line instead of another read connection and interval; closing one frees its slot
  const { MAX_STREAMS } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/api/products/[slug]/stream/route.ts')).href);
  const openOne = async () => { const ac = new AbortController(); return { ac, res: await GET(new Request('http://x/api/products/good/stream', { signal: ac.signal, headers: { host: 'localhost:3000' } }), { params: Promise.resolve({ slug: 'good' }) }) }; };
  const shut = async (h) => { h.ac.abort(); await h.res.body?.cancel().catch(() => {}); };
  const held = [];
  try {
    for (let i = 0; i < MAX_STREAMS; i++) held.push(await openOne());
    const over = await openOne(), overBody = over.res.status === 429 ? await over.res.json() : null;
    if (over.res.status !== 429) held.push(over); // served past the cap: it holds the store open, close it with the rest
    check(`stream cap: ${MAX_STREAMS} open streams for one product are served, the next answers 429 with one line`,
      MAX_STREAMS > 0 && held.every((h) => h.res.status === 200) && over.res.status === 429 && typeof overBody?.error === 'string' && overBody.error.includes(`at most ${MAX_STREAMS}`) && !overBody.error.includes('\n'),
      `${held.map((h) => h.res.status).join(',')} then ${over.res.status} ${JSON.stringify(overBody)}`);
    await shut(held.shift());
    const again = await openOne(); held.push(again);
    check('stream cap: closing one stream frees its slot (200 again)', again.res.status === 200, String(again.res.status));
  } finally { for (const h of held) await shut(h); }

  const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const types = code('packages/core/src/scan/types.ts'), client = code('apps/web/src/lib/scan/client.ts'), header = code('apps/web/src/components/Header.tsx');
  check('types.ts: StreamEvent names map', /type StreamEvent\s*=[^;]*'map'/.test(types));
  check("client.ts: addEventListener('map') refetches the structure", /addEventListener\(\s*'map'[\s\S]{0,400}refresh\(\)/.test(client));
  check('types.ts: StreamEvent names error', /type StreamEvent\s*=[^;]*'error'/.test(types));
  check("client.ts: addEventListener('error') sets status 'error'", /addEventListener\(\s*'error'[\s\S]{0,400}status:\s*'error'/.test(client));
  check('client.ts: onerror ignores the server error event', /onerror\s*=\s*\(\s*\w+[^)]*\)\s*=>\s*\{[^}]*instanceof MessageEvent/.test(client));
  const liveness = code('packages/core/src/scan/liveness.ts');
  check("liveness.ts: the scan verdict has an 'error' branch", /=== 'error'[^\n]{0,80}'store-error'/.test(liveness));
  check('Header.tsx: the pill words the scan verdict', /livenessWords\(\s*scanLiveness\(/.test(header));
} finally {
  process.chdir(os.tmpdir());
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `check-stream-status: ${failed} failed, ${passed} passed` : `check-stream-status: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
