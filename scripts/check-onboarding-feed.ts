// Checks the pollable onboarding feed and the all-products list (spark onboarding-vr, the server half; the VR table polls
// both because UE's HTTP cannot read SSE):
//   1 list     GET /api/onboarding: every registered product with its latest adopt job, a running one first, then by the
//              most recent start, never-onboarded ones last in registry order; 403 off localhost.
//   2 paging   GET /api/products/<slug>/onboarding/feed over a journaled job of 1203 events: pages of at most 500, `next`
//              chains them, `done` only on the page that drains an ended job; an `after` past the end answers the end.
//   3 answers  404 an unknown product, 404 an unknown `job`, 400 a bad job id or `after`; a product with no adopt job
//              answers `{ job: null, events: [], next: 0, done: true }`.
//   4 islands  a `structure` event journaled from Kettle's map (domain rooms, ROOM_GAP) and from a live map (capability
//              rooms, LIVE_ROOM_GAP): with `layout=islands` every wing/room/bay/tile box equals `/plan?layout=islands`'s for
//              the same map; without it the boxes are as journaled (the plan route's plain boxes). A map whose wings
//              changed order after the structure was journaled (wing order is chronological, and events.jsonl lands after
//              the product tree) answers the map's islands boxes, the table at done; a map that lost a node of the event
//              falls back to the journaled boxes pulled apart (islandsOf).
//   5 live     a real adopt job over the fake CLI (fake-adopt.mjs): polled with after=next while it runs, `done` stays false
//              until it has ended and its `done` event has been answered; the pages put together are exactly the journal.
// Run: node --import @bp/core/register scripts/check-onboarding-feed.ts   (exit 1 on any failure, ~15 s)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BuildupEvent } from '../packages/core/src/scan/onboarding.ts';
import type { ScanJob } from '../packages/core/src/scan/jobs.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-onboarding-feed-'));
const SKILL = path.join(tmp, 'skill', 'adopt-bp');
fs.mkdirSync(path.join(SKILL, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(SKILL, 'SKILL.md'), '# adopt-bp (stub for check-onboarding-feed)\n');
fs.writeFileSync(path.join(SKILL, 'scripts', 'adopt.mjs'), "console.log(JSON.stringify({ items: [{ key: 'map', state: 'missing', detail: 'none' }] }));\n");
process.env.BP_ADOPT_SKILL = SKILL;
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts', 'fixtures', 'fake-adopt.mjs');
process.env.FAKE_ADOPT_MS = '4000';
process.env.BP_PRODUCTS_FILE = path.join(tmp, 'products.json');
delete process.env.BP_RUNNER; delete process.env.FAKE_ADOPT_REAL; delete process.env.FAKE_ADOPT_FAIL;

const PP = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/plan-projection.ts')).href) as typeof import('../packages/core/src/server/plan-projection.ts');
const OJ = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/onboarding-job.server.ts')).href) as typeof import('../packages/core/src/server/onboarding-job.server.ts');
const J = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/jobs.server.ts')).href) as typeof import('../packages/core/src/server/jobs.server.ts');
const FAKE = await import(pathToFileURL(path.join(ROOT, 'scripts/fixtures/fake-adopt.mjs')).href) as { stages(): { step: string; files: Record<string, unknown> }[] };

const route = async (rel: string) => import(pathToFileURL(path.join(ROOT, 'apps/web/src/app/api', rel, 'route.ts')).href);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (fn: (req: Request, ctx: unknown) => Response | Promise<Response>, url: string, params: object = {}, host = 'localhost:3000'): Promise<{ status: number; body: any }> => {
  const res = await fn(new Request('http://' + host + url, { headers: { host } }), { params: Promise.resolve(params) });
  const text = await res.text();
  let body: unknown; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};
const listR = await route('onboarding'), feedR = await route('products/[slug]/onboarding/feed'), planR = await route('products/[slug]/plan'), onboardR = await route('products/[slug]/onboard');
const feed = (slug: string, q = '') => call(feedR.GET, `/api/products/${slug}/onboarding/feed${q}`, { slug });

// ------------------------------------------------------------------------------------------------- fixtures
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const mkRepo = (name: string) => {
  const r = path.join(tmp, name);
  fs.mkdirSync(path.join(r, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(r, 'docs', 'billing.md'), '# Billing\n');
  git(r, 'init', '-q'); git(r, 'config', 'user.email', 't@t'); git(r, 'config', 'user.name', 't'); git(r, 'add', '.'); git(r, 'commit', '-qm', 'init');
  return r;
};
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
/** An adopt job that ended, as the job journal holds it, and its build-up journal. */
function journaled(root: string, slug: string, id: string, startedAgo: number, events: BuildupEvent[]): void {
  const dir = path.join(root, '.ai', 'lens-scan', 'work', 'bp-jobs');
  fs.mkdirSync(dir, { recursive: true });
  const job = { id, kind: 'adopt', status: 'done', queued_at: iso(startedAgo + 1000), started_at: iso(startedAgo), ended_at: iso(startedAgo - 60_000), adopt_phase: 'register' };
  fs.appendFileSync(J.journalFile(root), JSON.stringify({ at: job.ended_at, slug, phase: 'ended', job }) + '\n');
  fs.writeFileSync(OJ.buildupFile(root, id), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}
/** A map and its events as the product's store holds them, and the `structure` event the live feed would derive from it. */
function withMap(root: string, raw: unknown, events: string): BuildupEvent {
  const ls = path.join(root, '.ai', 'lens-scan');
  fs.mkdirSync(ls, { recursive: true });
  fs.writeFileSync(path.join(ls, 'app-structure.json'), JSON.stringify(raw));
  fs.writeFileSync(path.join(ls, 'events.jsonl'), events);
  const p = PP.projectPlan(raw, events, 'live');
  return { type: 'structure', at: 900, wings: p.wings, rooms: p.rooms, bays: p.bays, tiles: p.tiles.map((t) => ({ id: t.id, name: t.name, order: t.order, parentId: t.parentId, box: t.box, stage: null, kind: null, tier: null, summary: null })) } as BuildupEvent;
}
const begin = (slug: string): BuildupEvent => ({ type: 'begin', at: 0, project: { slug, name: slug }, extent: null });

const big = mkRepo('big'), kettleish = mkRepo('kettleish'), livemap = mkRepo('livemap'), never = mkRepo('never'), runner = mkRepo('runner');
// big: 1203 events (begin, 1201 activity, done), started an hour ago
journaled(big, 'big', 'j-big-1', 3600_000, [begin('big'), ...Array.from({ length: 1201 }, (_, i) => ({ type: 'activity', at: 10 + i, verb: 'read', path: `src/f${i}.ts`, area: null }) as BuildupEvent), { type: 'done', at: 5000 }]);
// kettleish: Kettle's own map (domain rooms), started 10 minutes ago
const kRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
let kEv = ''; try { kEv = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8'); } catch { /* none */ }
journaled(kettleish, 'kettleish', 'j-kettle-1', 600_000, [begin('kettleish'), withMap(kettleish, kRaw, kEv), { type: 'done', at: 2000 }]);
// livemap: a live product's map (capability rooms): fake-adopt's synthetic map with its one domain's capability split in
// three and a second domain, so wings, rooms and bays all move. Started 20 minutes ago.
const st = FAKE.stages();
const merged = st.filter((s) => s.files['app-structure.json']).at(-1)!.files['app-structure.json'] as { domains: { slug: string; name: string }[]; capabilities: { slug: string; domain: string; name: string }[]; features: { slug: string; capability?: string }[] } & Record<string, unknown>;
const lRaw = JSON.parse(JSON.stringify(merged));
{
  const d0 = lRaw.domains[0], c0 = lRaw.capabilities[0];
  lRaw.domains.push({ ...d0, slug: 'ledger', name: 'Ledger', id: undefined });
  lRaw.capabilities.push({ ...c0, slug: 'refunds', name: 'Refunds', domain: d0.slug, id: undefined }, { ...c0, slug: 'journal', name: 'Journal', domain: 'ledger', id: undefined });
  const f0 = lRaw.features[0], f1 = lRaw.features[lRaw.features.length - 1];
  lRaw.features.push({ ...f0, slug: f0.slug + '-r', name: f0.name + ' R', capability: 'refunds', id: undefined }, { ...f1, slug: f1.slug + '-j', name: f1.name + ' J', capability: 'journal', id: undefined });
}
const lStructure = (() => { try { return withMap(livemap, lRaw, ''); } catch (e) { check('4 the live fixture map loads', false, (e as Error).message); return null; } })();
journaled(livemap, 'livemap', 'j-live-1', 1200_000, [begin('livemap'), ...(lStructure ? [lStructure] : []), { type: 'done', at: 2000 }]);

// reorder: the live map's structure journaled before any dates, then the map dated so the second wing is the oldest
const reorder = mkRepo('reorder'), shrunk = mkRepo('shrunk');
const rStructure = withMap(reorder, lRaw, '');
const dated = JSON.parse(JSON.stringify(lRaw));
for (const f of dated.features) f.created = f.capability === 'journal' ? '2020-01-01' : '2026-06-01';
fs.writeFileSync(path.join(reorder, '.ai', 'lens-scan', 'app-structure.json'), JSON.stringify(dated));
journaled(reorder, 'reorder', 'j-reorder-1', 2400_000, [begin('reorder'), rStructure, { type: 'done', at: 2000 }]);
// shrunk: the live map's structure journaled, then a capability (a room and its tiles) gone from the map
const sStructure = withMap(shrunk, lRaw, '');
const less = JSON.parse(JSON.stringify(lRaw));
less.capabilities = less.capabilities.filter((c: { slug: string }) => c.slug !== 'refunds');
less.features = less.features.filter((f: { capability?: string }) => f.capability !== 'refunds');
fs.writeFileSync(path.join(shrunk, '.ai', 'lens-scan', 'app-structure.json'), JSON.stringify(less));
journaled(shrunk, 'shrunk', 'j-shrunk-1', 3000_000, [begin('shrunk'), sStructure, { type: 'done', at: 2000 }]);

fs.writeFileSync(process.env.BP_PRODUCTS_FILE!, JSON.stringify({ products: [
  { slug: 'reorder', name: 'Reorder', root: reorder },
  { slug: 'shrunk', name: 'Shrunk', root: shrunk },
  { slug: 'never', name: 'Never', root: never },
  { slug: 'livemap', name: 'Live map', root: livemap },
  { slug: 'big', name: 'Big', root: big },
  { slug: 'kettleish', name: 'Kettle-ish', root: kettleish },
  { slug: 'runner', name: 'Runner', root: runner },
] }));

// ------------------------------------------------------------------------------------------------- 3 answers
{
  const unk = await feed('nope');
  const nj = await feed('never');
  const noJob = await feed('big', '?job=j-nope');
  const badJob = await feed('big', '?job=..%2Fx');
  const badAfter = await feed('big', '?after=-1'), badAfter2 = await feed('big', '?after=x');
  const off = await call(feedR.GET, '/api/products/big/onboarding/feed', { slug: 'big' }, 'evil.example');
  check('3 an unknown product: 404', unk.status === 404, String(unk.status));
  check('3 no adopt job: { job: null, events: [], next: 0, done: true }', nj.status === 200 && JSON.stringify(nj.body) === JSON.stringify({ job: null, events: [], next: 0, done: true }), JSON.stringify(nj.body));
  check('3 an unknown job: 404; a bad job id or after: 400; off localhost: 403', noJob.status === 404 && badJob.status === 400 && badAfter.status === 400 && badAfter2.status === 400 && off.status === 403, `${noJob.status} ${badJob.status} ${badAfter.status} ${badAfter2.status} ${off.status}`);
}

// ------------------------------------------------------------------------------------------------- 2 paging
{
  const all = OJ.readBuildup(big, 'j-big-1');
  const pages: { n: number; next: number; done: boolean }[] = [];
  const got: BuildupEvent[] = [];
  for (let after = 0, guard = 0; guard < 10; guard++) {
    const r = await feed('big', `?after=${after}`);
    if (r.status !== 200) { check('2 a page answers 200', false, String(r.status)); break; }
    pages.push({ n: r.body.events.length, next: r.body.next, done: r.body.done });
    got.push(...r.body.events);
    after = r.body.next;
    if (r.body.done) break;
  }
  check('2 pages of at most 500, next chains them: 500, 500, 203', JSON.stringify(pages.map((p) => p.n)) === '[500,500,203]' && JSON.stringify(pages.map((p) => p.next)) === '[500,1000,1203]', JSON.stringify(pages));
  check('2 done only on the page that drains the ended job', JSON.stringify(pages.map((p) => p.done)) === '[false,false,true]', JSON.stringify(pages));
  check('2 the pages put together are the journal', all.length === 1203 && JSON.stringify(got) === JSON.stringify(all), `${got.length} of ${all.length}`);
  const mid = await feed('big', '?after=700');
  check('2 after=700 starts at index 700', mid.body.events[0]?.path === 'src/f699.ts' && mid.body.next === 1200 && mid.body.done === false, JSON.stringify(mid.body.events[0]));
  const past = await feed('big', '?after=5000');
  check('2 an after past the end answers the end, done', past.status === 200 && past.body.events.length === 0 && past.body.next === 1203 && past.body.done === true, JSON.stringify({ ...past.body, job: undefined }));
  const byId = await feed('big', '?job=j-big-1&after=1200');
  check('2 ?job= pages that job', byId.body.job?.id === 'j-big-1' && byId.body.events.length === 3 && byId.body.events.at(-1)?.type === 'done', JSON.stringify(byId.body.events.map((e: BuildupEvent) => e.type)));
}

// ------------------------------------------------------------------------------------------------- 4 islands
const boxesOf = (x: { wings: { id: string; box: unknown }[]; rooms: { id: string; box: unknown }[]; bays: { id: string; box: unknown }[]; tiles: { id: string; box: unknown }[] }) =>
  JSON.stringify(['wings', 'rooms', 'bays', 'tiles'].map((k) => (x as unknown as Record<string, { id: string; box: unknown }[]>)[k].map((n) => [n.id, n.box])));
for (const [slug, gap] of [['kettleish', PP.ROOM_GAP], ['livemap', PP.LIVE_ROOM_GAP]] as const) {
  const plain = await call(planR.GET, `/api/products/${slug}/plan`, { slug });
  const isl = await call(planR.GET, `/api/products/${slug}/plan?layout=islands`, { slug });
  const fPlain = await feed(slug, '?after=0');
  const fIsl = await feed(slug, '?after=0&layout=islands');
  const sPlain = fPlain.body.events?.find((e: BuildupEvent) => e.type === 'structure');
  const sIsl = fIsl.body.events?.find((e: BuildupEvent) => e.type === 'structure');
  if (!sPlain || !sIsl || plain.status !== 200 || isl.status !== 200) { check(`4 ${slug}: a structure event and both plans`, false, `${plain.status} ${isl.status} ${!!sPlain} ${!!sIsl}`); continue; }
  check(`4 ${slug}: the room gap is ${gap}`, PP.islandsRoomGap(slug === 'kettleish' ? kRaw : lRaw, slug === 'kettleish' ? kEv : '') === gap);
  check(`4 ${slug}: without layout the boxes are as journaled (= /plan)`, boxesOf(sPlain) === boxesOf(plain.body));
  check(`4 ${slug}: layout=islands boxes = /plan?layout=islands boxes`, boxesOf(sIsl) === boxesOf(isl.body), `${boxesOf(sIsl).slice(0, 300)}\n vs ${boxesOf(isl.body).slice(0, 300)}`);
  check(`4 ${slug}: islands moved something (${isl.body.wings.length} wings, ${isl.body.rooms.length} rooms)`, boxesOf(sIsl) !== boxesOf(sPlain) && isl.body.rooms.length > 1);
  check(`4 ${slug}: the other events and fields ride along`, fIsl.body.events.length === fPlain.body.events.length && sIsl.at === sPlain.at && JSON.stringify(sIsl.tiles.map((t: { name: string }) => t.name)) === JSON.stringify(sPlain.tiles.map((t: { name: string }) => t.name)));
}

{
  const isl = await call(planR.GET, '/api/products/reorder/plan?layout=islands', { slug: 'reorder' });
  const f = await feed('reorder', '?layout=islands');
  const s = f.body.events?.find((e: BuildupEvent) => e.type === 'structure');
  const wingIds = (x: { wings: { id: string; order: number }[] }) => [...x.wings].sort((a, b) => a.order - b.order).map((w) => w.id).join(',');
  check('4 reorder: the precondition, the wing order of the map is no longer the journaled one', isl.status === 200 && rStructure.type === 'structure' && wingIds(isl.body) !== wingIds(rStructure as never), `${wingIds(isl.body)} vs ${wingIds(rStructure as never)}`);
  check('4 reorder: layout=islands answers the islands boxes of the map (the table at done)', !!s && boxesOf(s) === boxesOf(isl.body), s ? boxesOf(s).slice(0, 200) : 'no structure');
  const sh = await feed('shrunk', '?layout=islands');
  const ss = sh.body.events?.find((e: BuildupEvent) => e.type === 'structure');
  const pulled = sStructure.type === 'structure' ? PP.islandsOf(sStructure, PP.LIVE_ROOM_GAP) : null;
  check('4 shrunk: a node gone from the map falls back to the journaled boxes pulled apart', !!ss && !!pulled && boxesOf(ss) === boxesOf(pulled) && ss.rooms.length === 3, ss ? String(ss.rooms.length) : 'no structure');
}

// ------------------------------------------------------------------------------------------------- 5 live (and 1 list)
{
  const ob = await call((req, ctx) => onboardR.POST(new Request(req.url, { method: 'POST', headers: { host: 'localhost:3000', 'content-type': 'application/json' }, body: '{}' }), ctx), '/api/products/runner/onboard', { slug: 'runner' });
  const job: ScanJob = ob.body.job;
  check('5 onboard: 202', ob.status === 202 && job?.kind === 'adopt', JSON.stringify(ob.body));
  // 1 list, while it runs
  const l1 = await call(listR.GET, '/api/onboarding');
  const order = (l1.body.items ?? []).map((i: { slug: string }) => i.slug).join(' ');
  check('1 the list: running first, then by most recent start, never last', l1.status === 200 && order === 'runner kettleish livemap reorder shrunk big never', order);
  const it = (l1.body.items ?? []).find((i: { slug: string }) => i.slug === 'big');
  check('1 an item is { slug, name, job } with the latest adopt job', it?.name === 'Big' && it.job?.id === 'j-big-1' && it.job.status === 'done' && l1.body.items.at(-1).job === null, JSON.stringify(it));
  const l403 = await call(listR.GET, '/api/onboarding', {}, 'evil.example');
  check('1 the list: 403 off localhost', l403.status === 403);

  const got: BuildupEvent[] = [];
  const answers: { n: number; done: boolean; status: string }[] = [];
  let after = 0, doneEarly = false;
  for (const end = Date.now() + 30_000; Date.now() < end;) {
    const r = await feed('runner', `?after=${after}&layout=islands`);
    got.push(...r.body.events);
    answers.push({ n: r.body.events.length, done: r.body.done, status: r.body.job?.status });
    if (r.body.done && (r.body.job?.status === 'running' || got.at(-1)?.type !== 'done')) doneEarly = true;
    after = r.body.next;
    if (r.body.done) break;
    await sleep(250);
  }
  const journal = OJ.readBuildup(runner, job.id);
  check('5 done never while running or before the done event', !doneEarly && answers.at(-1)?.done === true, JSON.stringify(answers.slice(-3)));
  check('5 several polls carried events while it ran', answers.filter((a) => a.n > 0 && a.status === 'running').length >= 2, String(answers.filter((a) => a.n > 0).length));
  const strip = (e: BuildupEvent) => (e.type === 'structure' ? { ...e, wings: [], rooms: [], bays: [], tiles: [] } : e);
  check('5 the pages put together are the journal (structure boxes aside)', got.length === journal.length && JSON.stringify(got.map(strip)) === JSON.stringify(journal.map(strip)), `${got.length} vs ${journal.length}`);
  const s = got.find((e) => e.type === 'structure');
  const isl = await call(planR.GET, '/api/products/runner/plan?layout=islands', { slug: 'runner' });
  check('5 the live run\'s structure, islands, lines up with /plan?layout=islands at done', !!s && isl.status === 200 && s.type === 'structure' && boxesOf(s) === boxesOf(isl.body), s ? boxesOf(s).slice(0, 200) : 'no structure');
  const l2 = await call(listR.GET, '/api/onboarding');
  check('1 once it has ended, the list orders it by start (the newest)', (l2.body.items ?? [])[0]?.slug === 'runner' && l2.body.items[0].job.status === 'done', JSON.stringify(l2.body.items?.map((i: { slug: string }) => i.slug)));
}

await sleep(200);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a child's handle on Windows */ }
console.log(`check-onboarding-feed: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
