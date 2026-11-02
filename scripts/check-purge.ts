// Removing a product with a purge (DELETE /api/products/[slug]?purge=store,companion, packages/core/src/server/purge.server.ts),
// over a temp product root, a temp registry (BP_PRODUCTS_FILE) and a temp BP_HOME; the CLI is the fake (a `slow` job sleeps
// until killed), never the real one.
//   - off localhost the route refuses (403) and nothing is touched; an unknown purge word is 400; an unknown slug 404;
//   - the slug's running job is cancelled and its process has gone BEFORE any store connection is closed, and a held store
//     connection (the product stream's kind, store.server.ts holdStore) is closed before the store is deleted;
//   - `store` deletes <root>/.ai/lens-scan/ whole and nothing else in the repo (.claude/lens-scan/config.md, .gitignore, code stay);
//   - `companion` DELETES what belongs to the slug alone (its brain space file, its episodes and facts and their index rows,
//     a conversation whose only product is the slug with its prompt and mcp files) and FILTERS shared files without deleting
//     them (a map's `<slug>:` keys, array elements and JSONL lines whose product is the slug, a conversation spanning the slug
//     and another product, the focus history and a reader's place); other products' records and files stay;
//   - no purge words: the registry line goes, the store stays, and the answer says both were kept.
// Run: node scripts/check-purge.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 15000): Promise<boolean> { const t = Date.now() + ms; while (Date.now() < t) { if (pred()) return true; await sleep(50); } return pred(); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-purge-'));
const write = (f: string, text: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const jsonl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

/** A product repo with a store, a map, a work dir, its lens-scan config and some code. */
function repo(name: string): string {
  const r = path.join(dir, name);
  const s = path.join(r, '.ai', 'lens-scan');
  write(path.join(s, 'app-structure.json'), '{}');
  write(path.join(s, 'events.jsonl'), '');
  write(path.join(s, 'ADOPT.md'), '# adopt');
  write(path.join(s, 'work', 'notes.txt'), 'x');
  const db = new DatabaseSync(path.join(s, 'scan.db'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE runs (id TEXT PRIMARY KEY, note TEXT, started_at TEXT); INSERT INTO runs VALUES (\'r1\', NULL, \'2026-11-01\');');
  db.close();
  write(path.join(r, '.claude', 'lens-scan', 'config.md'), '# config');
  write(path.join(r, '.gitignore'), '.ai/lens-scan/\n');
  write(path.join(r, 'src', 'a.ts'), 'export const a = 1;\n');
  return r;
}

const prodRoot = repo('prod'), otherRoot = repo('other');
const pf = path.join(dir, 'bp.products.local.json');
write(pf, JSON.stringify({ products: [{ slug: 'prod', name: 'Prod', root: prodRoot }, { slug: 'other', name: 'Other', root: otherRoot }] }, null, 2));
process.env.BP_PRODUCTS_FILE = pf;
const home = path.join(dir, 'home');
process.env.BP_HOME = home;
const C = path.join(home, 'companion');
write(path.join(C, 'recommendations.json'), JSON.stringify({ 'prod:F-1': { verdict: 'approve' }, 'other:F-1': { verdict: 'decline' }, 'prodx:F-2': { verdict: 'approve' } }));
write(path.join(C, 'policies.json'), JSON.stringify({ policies: [{ id: 'pol_a', product: 'prod' }, { id: 'pol_b', product: 'other' }, { id: 'pol_c', product: '*' }] }));
write(path.join(C, 'cards.jsonl'), [{ id: 'c1', product: 'prod' }, { id: 'c2', product: 'other' }, { id: 'c3' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
write(path.join(C, 'agent-trail.jsonl'), [{ kind: 'brief', product: 'prod' }, { kind: 'brief', product: 'other' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
write(path.join(C, 'conversations', 'c-prod.json'), JSON.stringify({ id: 'c-prod', product: 'prod' }));
write(path.join(C, 'prompts', 'c-prod.md'), '# prompt');
write(path.join(C, 'mcp', 'c-prod.json'), '{}');
write(path.join(C, 'conversations', 'c-other.json'), JSON.stringify({ id: 'c-other', product: 'other' }));
write(path.join(C, 'conversations', 'c-core.json'), JSON.stringify({ id: 'c-core', title: 'no product' }));
write(path.join(C, 'conversations', 'c-both.json'), JSON.stringify({ id: 'c-both', product: 'prod', products: ['prod', 'other'] }));
const placeP = { product: 'prod', level: 'L1' }, placeO = { product: 'other', level: 'L0' };
const focus = path.join(home, 'session', 'focus.json');
write(focus, JSON.stringify({ rev: 4, lead: 'web-1', readers: [{ id: 'web-1', surface: 'web', label: 'Web', seenAt: '2026-11-01T00:00:00Z', place: placeP }, { id: 'vr', surface: 'vr', label: 'VR', seenAt: '2026-11-01T00:00:00Z', place: placeO }],
  history: [{ place: placeO, reader: 'vr', label: 'VR', at: 'a' }, { place: placeP, reader: 'web-1', label: 'Web', at: 'b' }, { place: placeO, reader: 'vr', label: 'VR', at: 'c' }, { place: placeP, reader: 'web-1', label: 'Web', at: 'd' }], historyAt: 2 }));

const B = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/companion/brain/brain.server.ts')).href) as typeof import('../packages/core/src/server/companion/brain/brain.server.ts');
const BP = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/companion/brain/paths.server.ts')).href) as typeof import('../packages/core/src/server/companion/brain/paths.server.ts');
const epP = B.appendEpisode({ space: 'prod', conversationId: 'c-prod', input: 'what is prod', reply: 'prod is a shop', tools: [] });
const epO = B.appendEpisode({ space: 'other', conversationId: 'c-other', input: 'what is other', reply: 'other is a ledger', tools: [] });
const fP = B.writeFact({ space: 'prod', kind: 'project', text: 'prod ships on Fridays', sources: [epP.id] });
const fO = B.writeFact({ space: 'other', kind: 'project', text: 'other ships on Mondays', sources: [epO.id] });
const brainFile = (id: string, kind?: string) => (kind ? BP.factPath(kind, id) : BP.episodePath(id) ?? '');
const indexRows = (space: string) => { const db = new DatabaseSync(BP.indexPath(), { readOnly: true }); try { return (db.prepare('SELECT count(*) AS n FROM mem WHERE space = ?').get(space) as { n: number }).n; } finally { db.close(); } };
const J = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/jobs.server.ts')).href) as typeof import('../packages/core/src/server/jobs.server.ts');
const S = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/store.server.ts')).href) as typeof import('../packages/core/src/server/store.server.ts');
const P = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/purge.server.ts')).href) as typeof import('../packages/core/src/server/purge.server.ts');
const one = await import(pathToFileURL(path.join(ROOT, 'apps/web/src/app/api/products/[slug]/route.ts')).href) as { DELETE: (req: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response> };
const del = async (slug: string, query = '', host = 'localhost:3000') => {
  const res = await one.DELETE(new Request(`http://${host}/api/products/${slug}${query}`, { method: 'DELETE', headers: { host } }), { params: Promise.resolve({ slug }) });
  return { status: res.status, body: await res.json() as { error?: string; slug?: string; purged?: string[]; kept?: string[] } };
};
const slugs = () => (readJson(pf).products as { slug: string }[]).map((p) => p.slug);
const exists = (...p: string[]) => fs.existsSync(path.join(...p));

try {
  // ---------------------------------------------------------------- parsePurge
  const a = P.parsePurge('store, companion'), b = P.parsePurge(null), c = P.parsePurge('store,disk');
  check('parsePurge reads the comma list, none when absent, refuses an unknown word', a.ok && a.value.join() === 'store,companion' && b.ok && b.value.length === 0 && !c.ok && /disk/.test(c.error), JSON.stringify({ a, b, c }));
  const w = P.withoutSlug({ 'prod:x': 1, 'prodx:y': 2, list: [{ product: 'prod' }, { product: 'q' }] }, 'prod');
  check('withoutSlug drops `<slug>:` keys (not a longer slug sharing the prefix) and the slug\'s array elements', JSON.stringify(w) === JSON.stringify({ 'prodx:y': 2, list: [{ product: 'q' }] }), JSON.stringify(w));

  // ---------------------------------------------------------------- refusals touch nothing
  const off = await del('prod', '?purge=store,companion', 'evil.example:3000');
  check('off localhost: 403 and nothing deleted, the product stays registered', off.status === 403 && exists(prodRoot, '.ai', 'lens-scan', 'scan.db') && slugs().includes('prod'), JSON.stringify(off));
  const bad = await del('prod', '?purge=store,disk');
  check('an unknown purge word: 400 and nothing deleted', bad.status === 400 && exists(prodRoot, '.ai', 'lens-scan', 'scan.db') && slugs().includes('prod'), JSON.stringify(bad));
  const unk = await del('nope', '?purge=store');
  check('an unknown slug: 404', unk.status === 404, JSON.stringify(unk));

  // ---------------------------------------------------------------- a running job and a held store connection, then the purge
  const e = J.enqueueMeasure('prod', prodRoot, 'slow', { kind: 'all', label: 'Everything', features: [] });
  check('a slow job is enqueued for prod', e.ok, JSON.stringify(e));
  const id = e.ok ? e.job.id : '';
  check('the job runs', await until(() => J.list('prod').find((j) => j.id === id)?.status === 'running'));
  const held = new DatabaseSync(path.join(prodRoot, '.ai', 'lens-scan', 'scan.db'), { readOnly: true });
  held.prepare('SELECT count(*) AS n FROM runs').get();
  let closedWith: number | null = null, closedAfterJobs = false;
  S.holdStore(path.join(prodRoot, '.ai', 'lens-scan', 'scan.db'), () => {
    closedWith = J.unsettled('prod').length; closedAfterJobs = closedWith === 0;
    held.close();
  });
  let otherClosed = false;
  const releaseOther = S.holdStore(path.join(otherRoot, '.ai', 'lens-scan', 'scan.db'), () => { otherClosed = true; });

  check('before: prod has a brain space, an episode, a fact and 2 index rows', fP.ok && fs.existsSync(BP.spacePath('prod')) && fs.existsSync(brainFile(epP.id)) && indexRows('prod') === 2, String(indexRows('prod')));
  const r = await del('prod', '?purge=store,companion');
  check('DELETE ?purge=store,companion -> 200 { slug, purged: [store, companion], kept: [] }',
    r.status === 200 && r.body.slug === 'prod' && r.body.purged?.join() === 'store,companion' && r.body.kept?.length === 0, JSON.stringify(r));
  const job = J.list('prod').find((j) => j.id === id);
  check('the running job was cancelled and its process has gone', job?.status === 'cancelled' && J.unsettled('prod').length === 0, JSON.stringify(job));
  check('the held store connection was closed, and only after every job had ended', closedWith !== null && closedAfterJobs, String(closedWith));
  check('a connection to another product\'s store was not closed', !otherClosed);
  releaseOther();
  check('store: <root>/.ai/lens-scan/ is gone', !exists(prodRoot, '.ai', 'lens-scan'));
  check('store: the repo keeps .claude/lens-scan/config.md, .gitignore and its code',
    exists(prodRoot, '.claude', 'lens-scan', 'config.md') && exists(prodRoot, '.gitignore') && exists(prodRoot, 'src', 'a.ts') && exists(prodRoot, '.ai'));
  check('the registry line is gone, the other product stays', !slugs().includes('prod') && slugs().includes('other'), JSON.stringify(slugs()));

  const rec = readJson(path.join(C, 'recommendations.json'));
  check('companion: recommendations.json keeps other products\' keys, drops prod:*', !('prod:F-1' in rec) && 'other:F-1' in rec && 'prodx:F-2' in rec, JSON.stringify(rec));
  const pol = readJson(path.join(C, 'policies.json')).policies as { id: string }[];
  check('companion: policies.json drops prod\'s grant, keeps other and *', pol.map((x) => x.id).join() === 'pol_b,pol_c', JSON.stringify(pol));
  const cards = jsonl(path.join(C, 'cards.jsonl')), trail = jsonl(path.join(C, 'agent-trail.jsonl'));
  check('companion: JSONL lines of prod are dropped, the rest kept', cards.map((x) => x.id).join() === 'c2,c3' && trail.length === 1 && trail[0].product === 'other', JSON.stringify({ cards, trail }));
  check('companion: shared files are filtered, never deleted', exists(C, 'recommendations.json') && exists(C, 'policies.json') && exists(C, 'cards.jsonl') && exists(focus));
  check('companion: a conversation of prod alone is deleted, with its prompt and mcp files',
    !exists(C, 'conversations', 'c-prod.json') && !exists(C, 'prompts', 'c-prod.md') && !exists(C, 'mcp', 'c-prod.json'));
  const both = readJson(path.join(C, 'conversations', 'c-both.json'));
  check('companion: a conversation spanning prod and other is kept, prod filtered out of it', both.id === 'c-both' && both.product === undefined && JSON.stringify(both.products) === '["other"]', JSON.stringify(both));
  check("companion: other's and product-less conversations are untouched", readJson(path.join(C, 'conversations', 'c-other.json')).product === 'other' && exists(C, 'conversations', 'c-core.json'));
  check("brain: prod's space file, episode and fact are deleted", fP.ok && !exists(BP.spacePath('prod')) && !exists(brainFile(epP.id)) && !exists(brainFile(fP.ok ? fP.fact.id : '', 'project')));
  check("brain: other's space file, episode and fact stay", fO.ok && exists(BP.spacePath('other')) && exists(brainFile(epO.id)) && exists(brainFile(fO.ok ? fO.fact.id : '', 'project')));
  check("brain: the index holds no prod rows and keeps other's", indexRows('prod') === 0 && indexRows('other') === 2, `${indexRows('prod')} / ${indexRows('other')}`);
  const f = readJson(focus) as { readers: { id: string; place?: { product: string } }[]; history: { place: { product: string }; at: string }[]; historyAt: number; lead: string };
  check('focus: prod history entries dropped, the shared index stays on the same entry',
    f.history.map((h) => h.at).join() === 'a,c' && f.historyAt === 1, JSON.stringify(f.history) + ' at ' + f.historyAt);
  check('focus: a reader at prod forgets its place and stays; a reader elsewhere keeps it',
    f.readers.length === 2 && f.readers[0].place === undefined && f.readers[1].place?.product === 'other' && f.lead === 'web-1', JSON.stringify(f.readers));

  // ---------------------------------------------------------------- no purge: unregister only
  const r2 = await del('other');
  check('DELETE without purge -> 200, purged [] and kept [store, companion]', r2.status === 200 && r2.body.purged?.length === 0 && r2.body.kept?.join() === 'store,companion', JSON.stringify(r2));
  check('without purge the store stays on disk and the companion records stay',
    exists(otherRoot, '.ai', 'lens-scan', 'scan.db') && 'other:F-1' in readJson(path.join(C, 'recommendations.json')) && !slugs().includes('other'));
} finally {
  B.closeIndex();
  for (const slug of ['prod', 'other']) for (const j of J.list(slug)) J.cancel(slug, j.id);
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
}
console.log(failed ? `check-purge: ${failed} failed, ${passed} passed` : `check-purge: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
