// Checks onboarding in the app (spark project-onboarding, the server half): the adopt job and its build-up feed.
//   1 wire     core's restated BuildupEvent (packages/core/src/scan/onboarding.ts) and the screen's contract
//              (apps/web/src/buildup/contract.ts) are mutually assignable (compile time, under typecheck) and list the same
//              phases; jobLabel says Onboard / Onboard · resume.
//   2 pure     slugOf / uniqueSlug, the prompt (no test-only wording, the resume line), stream-json read into readable lines
//              and tool calls, lastPhase.
//   3 deriver  the feed driven by hand (poll) over the fixture directory sequence scripts/fixtures/fake-adopt.mjs writes
//              (stages()): begin, check, context-map, survey, seed, outline before structure, history, judge progress with a
//              provisional health, the final health, register at ADOPT.md, done; the journal holds exactly what was emitted;
//              a subscriber that joins mid-run gets every event from begin, then the live ones; a run settled not-ok ends
//              `failed` in the phase it was in; a resumed feed (a restart) does not resend what the journal has.
//   4 routes   over the fake CLI (BP_CLAUDE_BIN = fake-adopt.mjs, a stub adopt-bp skill, a temp registry): check (200 with
//              the proposed slug, -2 against the registry, `registered`; 400 for no folder and no git; 403 off localhost),
//              onboard (202, 409 for a second, 400 bad body, 404 unknown), the job done with a readable log tail and
//              adopt_phase, GET onboarding, the SSE route's catch-up (events since begin) then live, ?job= and its 404;
//              a failing run (failed, adopt_phase judge, the SSE ending `failed`); a cancel; resume wording.
//   5 restart  a journal that saw an adopt job running whose process is gone: the job reads failed, and its SSE replays the
//              build-up journal and ends with `failed`.
// Run: node --import @bp/core/register scripts/check-onboarding.ts   (exit 1 on any failure, ~15 s)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BuildupEvent as WebEvent } from '../apps/web/src/buildup/contract.ts';
import { PHASES } from '../apps/web/src/buildup/contract.ts';
import type { BuildupEvent as CoreEvent } from '../packages/core/src/scan/onboarding.ts';
import { BUILDUP_PHASES } from '../packages/core/src/scan/onboarding.ts';
import { jobLabel, type ScanJob } from '../packages/core/src/scan/jobs.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 15000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await sleep(50); return cond(); };

// ------------------------------------------------------------------------------------------------- 1 wire
// compile time: each union assigns to the other (typecheck fails the moment one gains a member or a field the other lacks)
const toWeb = (e: CoreEvent): WebEvent => e;
const toCore = (e: WebEvent): CoreEvent => e;
void toWeb; void toCore;
check('1 the core and web phase lists are the same', JSON.stringify(BUILDUP_PHASES) === JSON.stringify(PHASES), `${BUILDUP_PHASES} vs ${PHASES}`);
check('1 jobLabel: Onboard', jobLabel({ kind: 'adopt' }) === 'Onboard');
check('1 jobLabel: Onboard · resume', jobLabel({ kind: 'adopt', resume: true }) === 'Onboard · resume');

// ------------------------------------------------------------------------------------------------- 2 pure
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-onboarding-'));
// a stub adopt-bp skill: SKILL.md and an adopt.mjs whose `check --json` answers like the real one
const SKILL = path.join(tmp, 'skill', 'adopt-bp');
fs.mkdirSync(path.join(SKILL, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(SKILL, 'SKILL.md'), '# adopt-bp (stub for check-onboarding)\n');
fs.writeFileSync(path.join(SKILL, 'scripts', 'adopt.mjs'), "console.log(JSON.stringify({ items: [{ key: 'node', state: 'ok', detail: 'node' }, { key: 'map', state: 'missing', detail: 'none', need: 'seed' }, { key: 'events', state: 'missing', detail: 'none' }] }));\n");
process.env.BP_ADOPT_SKILL = SKILL;
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts', 'fixtures', 'fake-adopt.mjs');
process.env.FAKE_ADOPT_MS = '1500';
process.env.BP_PRODUCTS_FILE = path.join(tmp, 'products.json');
delete process.env.BP_RUNNER;

const OJ = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/onboarding-job.server.ts')).href) as typeof import('../packages/core/src/server/onboarding-job.server.ts');
const OS = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/onboarding.server.ts')).href) as typeof import('../packages/core/src/server/onboarding.server.ts');
const J = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/jobs.server.ts')).href) as typeof import('../packages/core/src/server/jobs.server.ts');
const FAKE = await import(pathToFileURL(path.join(ROOT, 'scripts/fixtures/fake-adopt.mjs')).href) as { stages(): { step: string; files: Record<string, unknown> }[]; writeStage(ls: string, s: { files: Record<string, unknown> }): void };

check('2 slugOf kebabs a folder name', OS.slugOf('My Repo_v2') === 'my-repo-v2' && OS.slugOf('Žluťoučký kůň') === 'zlutoucky-kun' && OS.slugOf('___') === 'project', `${OS.slugOf('My Repo_v2')} ${OS.slugOf('Žluťoučký kůň')} ${OS.slugOf('___')}`);
check('2 uniqueSlug suffixes -2, -3 and skips kettle', OS.uniqueSlug('app', new Set(['app', 'app-2'])) === 'app-3' && OS.uniqueSlug('kettle', new Set()) === 'kettle-2' && OS.uniqueSlug('a'.repeat(63), new Set(['a'.repeat(63)])).length <= 63);
const prompt = OJ.adoptPrompt({ skill: 'C:\\bp\\.claude\\skills\\adopt-bp', bp: 'C:\\bp', slug: 'demo', name: 'Demo "x"\nline', resume: false });
check('2 the prompt names the skill path, --bp, --slug and --name on one line', prompt.includes('S=C:/bp/.claude/skills/adopt-bp and --bp C:/bp.') && prompt.includes('--slug demo --name "Demo x line"'), prompt);
check('2 the prompt keeps no test-only wording and says the product is registered', !/timing test|product-tree\.d/.test(prompt) && /already registered in bp as demo/.test(prompt));
check('2 the prompt fences the run (no commits, no edits outside lens-scan, the ignore files and the registry)', /Do not commit, do not push, do not edit files outside \.ai\/lens-scan\/, \.gitignore \(or \.git\/info\/exclude\), \.claude\/lens-scan\/ and the bp registry/.test(prompt));
check('2 a resume prompt says so', /resumes an onboarding/.test(OJ.adoptPrompt({ skill: 's', bp: 'b', slug: 'd', name: 'D', resume: true })) && !/resumes/.test(prompt));
const sl = OJ.readStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:/r/src/a.ts' } }, { type: 'text', text: 'Reading the map.\nNext the tree.' }] } }));
check('2 stream-json: a tool call is a readable line and a tool', sl.lines[0] === '> Read C:/r/src/a.ts' && sl.tools[0]?.name === 'Read' && sl.lines.includes('Reading the map.') && sl.lines.includes('Next the tree.'), JSON.stringify(sl));
const res = OJ.readStreamLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', num_turns: 3, total_cost_usd: 1.234, duration_ms: 61000 }));
check('2 stream-json: an error result is a summary line and the error', res.lines[0] === '# result: error_during_execution · 3 turns · $1.23 · 61 s' && res.error === 'boom', JSON.stringify(res));
check('2 stream-json: a line that is not JSON is kept, a user line is dropped', OJ.readStreamLine('plain words').lines[0] === 'plain words' && OJ.readStreamLine(JSON.stringify({ type: 'user', message: {} })).lines.length === 0);
check('2 lastPhase: the latest started, else the latest seen, else check', OJ.lastPhase([{ type: 'phase', at: 0, phase: 'seed', state: 'start', detail: null }, { type: 'phase', at: 1, phase: 'seed', state: 'done', detail: null }, { type: 'phase', at: 2, phase: 'judge', state: 'start', detail: null }]) === 'judge'
  && OJ.lastPhase([{ type: 'phase', at: 0, phase: 'seed', state: 'done', detail: null }]) === 'seed' && OJ.lastPhase([]) === 'check');

// ------------------------------------------------------------------------------------------------- 3 deriver
{
  const root = path.join(tmp, 'feed-repo'), LS = path.join(root, '.ai', 'lens-scan');
  fs.mkdirSync(root, { recursive: true });
  const phases: string[] = [];
  const feed = OJ.openFeed({ slug: 'feed', name: 'Feed', root, id: 'j-feed-1', t0: Date.now(), onPhase: (p) => phases.push(p) });
  feed.phase('check', 'done', '2 to produce');
  const stages = FAKE.stages();
  let late: CoreEvent[] | null = null;
  let unsub: (() => void) | null = null;
  for (const s of stages) {
    FAKE.writeStage(LS, s);
    await sleep(15); // a distinct mtime per stage
    feed.poll();
    if (s.step === 'outline' && !late) { late = []; const l = late; unsub = OJ.subscribeBuildup(root, 'j-feed-1', (e) => l.push(e)); }
  }
  const at = feed.settle(true, '');
  const evs = OJ.readBuildup(root, 'j-feed-1');
  const types = evs.map((e) => e.type === 'phase' ? `${e.phase}:${e.state}` : e.type);
  const idx = (t: string) => types.indexOf(t);
  check('3 begin first, done last', types[0] === 'begin' && types.at(-1) === 'done', types.join(' '));
  check('3 begin names the project, extent null', evs[0].type === 'begin' && evs[0].project.slug === 'feed' && evs[0].project.name === 'Feed' && evs[0].extent === null);
  check('3 check starts and ends before anything else', idx('check:start') === 1 && idx('check:done') === 2);
  check('3 phases in run order', ['context-map:start', 'context-map:done', 'seed:done', 'product-tree:start', 'product-tree:done', 'events:start', 'events:done', 'measure:start', 'measure:done', 'judge:start', 'judge:done', 'register:start', 'register:done']
    .every((t, i, a) => idx(t) >= 0 && (i === 0 || idx(a[i - 1]) < idx(t))), types.join(' '));
  check('3 a survey from the supplement, then one with the inventory', types.filter((t) => t === 'survey').length >= 1 && evs.some((e) => e.type === 'survey' && e.areas.some((a) => a.lines !== null)));
  check('3 an outline per domain, before the structure', idx('outline') > 0 && idx('outline') < idx('structure'));
  const st = evs.find((e) => e.type === 'structure');
  check('3 the structure: wings, rooms and tiles with stage', !!st && st.type === 'structure' && st.wings.length === 1 && st.tiles.length === 2 && st.tiles.every((t) => t.stage !== null), JSON.stringify(st).slice(0, 300));
  check('3 the outline ids match the wings they become', evs.some((e) => e.type === 'outline' && st?.type === 'structure' && e.domains[0].id === st.wings[0].id));
  const hist = evs.find((e) => e.type === 'history');
  check('3 history dates each tile from feature-added', !!hist && hist.type === 'history' && hist.tiles.every((t) => !!t.created), JSON.stringify(hist));
  check('3 judge progress 0 of 1, then 1 of 1', evs.some((e) => e.type === 'progress' && e.n === 0 && e.of === 1) && evs.some((e) => e.type === 'progress' && e.n === 1 && e.of === 1));
  const prov = evs.find((e) => e.type === 'health' && e.provisional), fin = evs.find((e) => e.type === 'health' && !e.provisional);
  check('3 a provisional health per judgement file, then the final one', !!prov && !!fin && types.indexOf('health') < types.lastIndexOf('health') && fin.type === 'health' && fin.tiles.map((t) => t.id + ':' + t.general).sort().join() === 'failed-payment-dunning:watch,recurring-billing-engine:good', JSON.stringify(fin));
  check('3 register is done only at the report', idx('register:done') > idx('judge:done'));
  check('3 at counts up from the job start', evs.every((e, i) => typeof e.at === 'number' && e.at >= 0 && (i === 0 || e.at >= evs[i - 1].at)));
  check('3 settle(ok) answers register', at === 'register');
  check('3 adopt_phase followed each phase as it started', phases[0] === 'check' && phases.includes('judge') && phases.at(-1) === 'register', phases.join(' '));
  check('3 a subscriber that joined mid-run got every event from begin, then the live ones', !!late && JSON.stringify(late) === JSON.stringify(evs), `${late?.length} vs ${evs.length}`);
  unsub?.();
  // a late subscriber after the run reads the journal: the same events, and nothing more
  const after: CoreEvent[] = [];
  const u2 = OJ.subscribeBuildup(root, 'j-feed-1', (e) => after.push(e));
  check('3 a subscriber after the end replays the journal', JSON.stringify(after) === JSON.stringify(evs));
  u2();

  // a re-run over a finished onboarding: the old files are drawn, but they are no progress - the judge phase waits for a
  // judgement this job writes, and the final health for a map merged after it
  await sleep(30);
  const fr = OJ.openFeed({ slug: 'feed', name: 'Feed', root, id: 'j-feed-rerun', t0: Date.now() });
  fr.phase('check', 'done');
  fr.poll();
  const r1 = OJ.readBuildup(root, 'j-feed-rerun');
  const has = (es: CoreEvent[], t: string) => es.some((e) => (e.type === 'phase' ? `${e.phase}:${e.state}` : e.type) === t);
  check('3 a re-run draws what the repo already has (structure, history, provisional health)', has(r1, 'structure') && has(r1, 'history') && r1.some((e) => e.type === 'health' && e.provisional), r1.map((e) => e.type).join(' '));
  check('3 ...but old batches and judgements are no progress (no judge start, no final health, no register)', !has(r1, 'judge:start') && !r1.some((e) => e.type === 'health' && !e.provisional) && !has(r1, 'register:start'), r1.map((e) => e.type === 'phase' ? `${e.phase}:${e.state}` : e.type).join(' '));
  const judgementStage = stages.find((s) => s.step === 'judge')!, mergeStage = stages.find((s) => s.step === 'merge')!;
  FAKE.writeStage(LS, judgementStage); await sleep(15); fr.poll();
  const r2 = OJ.readBuildup(root, 'j-feed-rerun');
  check('3 a judgement this job writes starts the judge phase; the older map is no merge', has(r2, 'judge:start') && !r2.some((e) => e.type === 'health' && !e.provisional));
  FAKE.writeStage(LS, mergeStage); await sleep(15); fr.poll();
  const r3 = OJ.readBuildup(root, 'j-feed-rerun');
  check('3 the map merged after it is the final health', r3.some((e) => e.type === 'health' && !e.provisional) && has(r3, 'judge:done'));
  fr.settle(true, '');

  // a run that stops after the tree: failed, in the phase it was in
  const root2 = path.join(tmp, 'feed-repo-2'), LS2 = path.join(root2, '.ai', 'lens-scan');
  fs.mkdirSync(root2, { recursive: true });
  const f2 = OJ.openFeed({ slug: 'feed2', name: 'Feed 2', root: root2, id: 'j-feed-2', t0: Date.now() });
  f2.phase('check', 'done');
  for (const s of stages.slice(0, stages.findIndex((x) => x.step === 'tree') + 1)) { FAKE.writeStage(LS2, s); await sleep(15); f2.poll(); }
  const at2 = f2.settle(false, 'exit 1');
  const e2 = OJ.readBuildup(root2, 'j-feed-2');
  const last = e2.at(-1);
  check('3 a failed run ends `failed` in the phase it was in (events, after the tree)', at2 === 'events' && last?.type === 'failed' && last.phase === 'events' && last.message === 'exit 1', JSON.stringify(last));

  // a resumed feed (a restart, the process still there) does not resend what the journal has
  const root3 = path.join(tmp, 'feed-repo-3'), LS3 = path.join(root3, '.ai', 'lens-scan');
  fs.mkdirSync(root3, { recursive: true });
  const t0 = Date.now();
  const f3 = OJ.openFeed({ slug: 'feed3', name: 'Feed 3', root: root3, id: 'j-feed-3', t0 });
  f3.phase('check', 'done');
  const cut = stages.findIndex((x) => x.step === 'events');
  for (const s of stages.slice(0, cut + 1)) { FAKE.writeStage(LS3, s); await sleep(15); f3.poll(); }
  const before = OJ.readBuildup(root3, 'j-feed-3').length;
  // drop the in-memory feed as a restart would (settle is the only way out: emulate a fresh process by a new id copy)
  fs.copyFileSync(OJ.buildupFile(root3, 'j-feed-3'), OJ.buildupFile(root3, 'j-feed-3b'));
  const f3b = OJ.resumeFeed({ slug: 'feed3', name: 'Feed 3', root: root3, id: 'j-feed-3b', t0 });
  f3b.poll();
  const e3 = OJ.readBuildup(root3, 'j-feed-3b');
  check('3 a resumed feed sends no second begin, structure or history', e3.length >= before && e3.filter((e) => e.type === 'begin').length === 1 && e3.filter((e) => e.type === 'structure').length === 1 && e3.filter((e) => e.type === 'history').length === 1, e3.slice(before).map((e) => e.type).join(' '));
  for (const s of stages.slice(cut + 1)) { FAKE.writeStage(LS3, s); await sleep(15); f3b.poll(); }
  f3b.settle(true, '');
  const e3b = OJ.readBuildup(root3, 'j-feed-3b');
  check('3 the resumed feed carries on to done', e3b.at(-1)?.type === 'done' && e3b.some((e) => e.type === 'health' && !e.provisional));
  f3.settle(false, 'x');
}

// ------------------------------------------------------------------------------------------------- 4 routes (over the fake CLI)
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const mkRepo = (name: string) => {
  const r = path.join(tmp, name);
  fs.mkdirSync(path.join(r, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(r, 'docs', 'billing.md'), '# Billing\n');
  git(r, 'init', '-q'); git(r, 'config', 'user.email', 't@t'); git(r, 'config', 'user.name', 't'); git(r, 'add', '.'); git(r, 'commit', '-qm', 'init');
  return r;
};
const repo = mkRepo('Demo Repo'), repo2 = mkRepo('second');
fs.writeFileSync(process.env.BP_PRODUCTS_FILE!, JSON.stringify({ products: [{ slug: 'demo-repo', name: 'Demo repo', root: repo2 }, { slug: 'second', name: 'Second', root: repo2 }] }));
// "Demo Repo" is not registered yet; its kebab slug is taken (by another root): the check proposes demo-repo-2
const route = async (rel: string) => import(pathToFileURL(path.join(ROOT, 'apps/web/src/app/api', rel, 'route.ts')).href);
const H = { host: 'localhost:3000', 'content-type': 'application/json' };
const call = async (fn: (req: Request, ctx: unknown) => Promise<Response>, url: string, method: string, params: object, body?: unknown, host = 'localhost:3000') => {
  const res = await fn(new Request('http://' + host + url, { method, headers: { ...H, host }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve(params) });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; } // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: json };
};
const checkR = await route('onboarding/check'), onboardR = await route('products/[slug]/onboard'), onboardingR = await route('products/[slug]/onboarding'), eventsR = await route('products/[slug]/onboarding/events'), cancelR = await route('products/[slug]/scans/[job]');

const c1 = await call(checkR.POST, '/api/onboarding/check', 'POST', {}, { root: repo.replace(/\//g, '\\') });
check('4 check: 200 with the root, a free slug and the folder name', c1.status === 200 && c1.body.root === repo.replace(/\\/g, '/') && c1.body.slug === 'demo-repo-2' && c1.body.name === 'Demo Repo' && c1.body.git === true && c1.body.registered === null, JSON.stringify(c1.body));
check('4 check: adopt-bp\'s items as id/state/detail, need = not ok', Array.isArray(c1.body.items) && c1.body.items[1]?.id === 'map' && c1.body.items[1]?.state === 'missing' && c1.body.need === 2, JSON.stringify(c1.body.items));
const c2 = await call(checkR.POST, '/api/onboarding/check', 'POST', {}, { root: repo2 });
check('4 check: a registered root names its slug', c2.status === 200 && c2.body.registered === 'demo-repo', JSON.stringify(c2.body));
const plain = path.join(tmp, 'not-git'); fs.mkdirSync(plain, { recursive: true });
const c3 = await call(checkR.POST, '/api/onboarding/check', 'POST', {}, { root: plain });
const c4 = await call(checkR.POST, '/api/onboarding/check', 'POST', {}, { root: path.join(tmp, 'nope') });
const c5 = await call(checkR.POST, '/api/onboarding/check', 'POST', {}, { path: repo });
check('4 check: 400 for no git, no folder, a bad body', c3.status === 400 && /not a git work tree/.test(c3.body.error) && c4.status === 400 && /does not exist/.test(c4.body.error) && c5.status === 400, `${c3.status} ${c4.status} ${c5.status}`);
const c6 = await call(checkR.POST, '/api/onboarding/check', 'POST', {}, { root: repo }, 'evil.example');
check('4 check: 403 off localhost', c6.status === 403);

// register the repo (as the page does first), then onboard it
fs.writeFileSync(process.env.BP_PRODUCTS_FILE!, JSON.stringify({ products: [{ slug: 'demo-repo', name: 'Demo repo', root: repo }, { slug: 'second', name: 'Second', root: repo2 }] }));
const none = await call(onboardingR.GET, '/api/products/demo-repo/onboarding', 'GET', { slug: 'demo-repo' });
check('4 GET onboarding: null before any job', none.status === 200 && none.body.job === null, JSON.stringify(none.body));
const noEv = await call(eventsR.GET, '/api/products/demo-repo/onboarding/events', 'GET', { slug: 'demo-repo' });
check('4 events: 404 before any adopt job', noEv.status === 404);
const bad = await call(onboardR.POST, '/api/products/demo-repo/onboard', 'POST', { slug: 'demo-repo' }, { resume: 'yes' });
const badM = await call(onboardR.POST, '/api/products/demo-repo/onboard', 'POST', { slug: 'demo-repo' }, { model: 'gpt' });
const unk = await call(onboardR.POST, '/api/products/nope/onboard', 'POST', { slug: 'nope' }, {});
check('4 onboard: 400 bad resume, 400 a model off the list, 404 unknown product', bad.status === 400 && badM.status === 400 && unk.status === 404, `${bad.status} ${badM.status} ${unk.status}`);

// the SSE route, read as a client would: every event as it arrives
async function readSse(url: string, params: object, stopWhen: (evs: CoreEvent[]) => boolean, ms = 15000): Promise<{ status: number; evs: CoreEvent[]; pings: number }> {
  const ac = new AbortController();
  const res: Response = await eventsR.GET(new Request('http://localhost:3000' + url, { headers: { host: 'localhost:3000' }, signal: ac.signal }), { params: Promise.resolve(params) });
  const evs: CoreEvent[] = [];
  if (res.status !== 200 || !res.body) return { status: res.status, evs, pings: 0 };
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', pings = 0;
  const end = Date.now() + ms;
  while (Date.now() < end && !stopWhen(evs)) {
    const r = await Promise.race([reader.read(), sleep(end - Date.now()).then(() => null)]);
    if (!r || r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      if (frame.startsWith(':')) pings++;
      else if (frame.startsWith('data: ')) evs.push(JSON.parse(frame.slice(6)) as CoreEvent);
    }
  }
  ac.abort();
  try { await reader.cancel(); } catch { /* closed */ }
  return { status: 200, evs, pings };
}

const ob = await call(onboardR.POST, '/api/products/demo-repo/onboard', 'POST', { slug: 'demo-repo' }, {});
const job: ScanJob = ob.body.job;
check('4 onboard: 202 { job } kind adopt', ob.status === 202 && job?.kind === 'adopt' && !job.resume, JSON.stringify(ob.body));
const again = await call(onboardR.POST, '/api/products/demo-repo/onboard', 'POST', { slug: 'demo-repo' }, { resume: true });
check('4 onboard: 409 while one is queued or running', again.status === 409, JSON.stringify(again.body));
// a subscriber that connects while the run is under way: catch-up from begin, then live, to done
await until(() => OJ.readBuildup(repo, job.id).some((e) => e.type === 'structure'), 10000);
const sse = await readSse('/api/products/demo-repo/onboarding/events', { slug: 'demo-repo' }, (evs) => evs.some((e) => e.type === 'done' || e.type === 'failed'));
check('4 events: begin first, then every event, ending done', sse.status === 200 && sse.evs[0]?.type === 'begin' && sse.evs.at(-1)?.type === 'done', sse.evs.map((e) => e.type).join(' '));
await until(() => J.list('demo-repo').find((j) => j.id === job.id)?.status !== 'running');
const doneJob = J.list('demo-repo').find((j) => j.id === job.id);
check('4 the job ends done (exit 0, the map has features)', doneJob?.status === 'done' && doneJob.exit_code === 0, JSON.stringify(doneJob));
check('4 adopt_phase is the last phase started', doneJob?.adopt_phase === 'register', String(doneJob?.adopt_phase));
check('4 log_tail is readable lines, not stream-json', !!doneJob?.log_tail && doneJob.log_tail.includes('> Write') && !doneJob.log_tail.includes('{"type"'), doneJob?.log_tail?.slice(0, 300));
const logText = fs.readFileSync(path.join(repo, '.ai', 'lens-scan', 'work', 'bp-jobs', job.id + '.log'), 'utf8');
check('4 the log names the prompt, the check and the result', /# prompt \(stdin\): Onboard the repository/.test(logText) && /# adopt\.mjs check: 2 to produce/.test(logText) && /# result: success/.test(logText), logText.slice(0, 400));
const journalEvs = OJ.readBuildup(repo, job.id);
check('4 the SSE carried exactly the journal', JSON.stringify(journalEvs) === JSON.stringify(sse.evs), `${journalEvs.length} vs ${sse.evs.length}`);
check('4 the live feed had activity from the tool calls', journalEvs.some((e) => e.type === 'activity' && e.path === 'docs/billing.md'), journalEvs.filter((e) => e.type === 'activity').map((e) => e.type === 'activity' ? e.path : '').join(' '));
check('4 check phase detail from adopt.mjs check', journalEvs.some((e) => e.type === 'phase' && e.phase === 'check' && e.state === 'done' && e.detail === '2 to produce'));
const got = await call(onboardingR.GET, '/api/products/demo-repo/onboarding', 'GET', { slug: 'demo-repo' });
check('4 GET onboarding: the latest adopt job', got.status === 200 && got.body.job?.id === job.id && got.body.job.status === 'done');
const byId = await readSse(`/api/products/demo-repo/onboarding/events?job=${job.id}`, { slug: 'demo-repo' }, (evs) => evs.at(-1)?.type === 'done', 4000);
const noJob = await readSse('/api/products/demo-repo/onboarding/events?job=j-nope', { slug: 'demo-repo' }, () => true);
const badJob = await readSse('/api/products/demo-repo/onboarding/events?job=..%2Fx', { slug: 'demo-repo' }, () => true);
check('4 events: ?job= replays that job; 404 an unknown one, 400 a bad id', byId.evs.length === journalEvs.length && noJob.status === 404 && badJob.status === 400, `${byId.evs.length} ${noJob.status} ${badJob.status}`);

// a failing run: failed, in the judge phase, and the SSE ends `failed`
// a fresh repo state each run (the fake's synthetic steps rewrite the map from scratch, which a real resume never does)
const wipe = () => fs.rmSync(path.join(repo, '.ai', 'lens-scan'), { recursive: true, force: true, maxRetries: 3 });
wipe();
process.env.FAKE_ADOPT_FAIL = 'judge';
const ob2 = await call(onboardR.POST, '/api/products/demo-repo/onboard', 'POST', { slug: 'demo-repo' }, { resume: true });
check('4 a resume: 202, the job says resume and its label', ob2.status === 202 && ob2.body.job.resume === true && jobLabel(ob2.body.job) === 'Onboard · resume');
const sse2 = await readSse('/api/products/demo-repo/onboarding/events', { slug: 'demo-repo' }, (evs) => evs.some((e) => e.type === 'done' || e.type === 'failed'));
delete process.env.FAKE_ADOPT_FAIL;
await until(() => J.list('demo-repo').find((j) => j.id === ob2.body.job.id)?.status !== 'running');
const failedJob = J.list('demo-repo').find((j) => j.id === ob2.body.job.id);
const lastEv = sse2.evs.at(-1);
check('4 a failing run: failed, adopt_phase judge, the error line', failedJob?.status === 'failed' && failedJob.adopt_phase === 'judge' && /stopped at judge/.test(failedJob.error ?? ''), JSON.stringify(failedJob));
check('4 a failing run: the SSE ends failed in judge', lastEv?.type === 'failed' && lastEv.phase === 'judge', JSON.stringify(lastEv));
const promptLine = fs.readFileSync(path.join(repo, '.ai', 'lens-scan', 'work', 'bp-jobs', ob2.body.job.id + '.log'), 'utf8');
check('4 a resume job gets the resume wording', /resumes an onboarding/.test(promptLine));

// a cancel mid-run: cancelled, the build-up ends failed `cancelled`
wipe();
process.env.FAKE_ADOPT_MS = '20000';
const ob3 = await call(onboardR.POST, '/api/products/demo-repo/onboard', 'POST', { slug: 'demo-repo' }, {});
await until(() => J.list('demo-repo').find((j) => j.id === ob3.body.job.id)?.log_tail?.includes('> ') ?? false, 8000);
const cc = await call(cancelR.DELETE, `/api/products/demo-repo/scans/${ob3.body.job.id}`, 'DELETE', { slug: 'demo-repo', job: ob3.body.job.id });
check('4 cancel: 200 cancelled', cc.status === 200 && cc.body.status === 'cancelled', JSON.stringify(cc.body).slice(0, 200));
await until(() => OJ.readBuildup(repo, ob3.body.job.id).some((e) => e.type === 'failed'), 10000);
const e4 = OJ.readBuildup(repo, ob3.body.job.id).at(-1);
check('4 cancel: the build-up ends failed `cancelled`', e4?.type === 'failed' && e4.message === 'cancelled', JSON.stringify(e4));
const ob4 = await call(onboardR.POST, '/api/products/demo-repo/onboard', 'POST', { slug: 'demo-repo' }, {});
check('4 a new onboard is accepted once the cancelled one has gone', ob4.status === 202 || ob4.status === 409, String(ob4.status));
if (ob4.status === 202) { await call(cancelR.DELETE, `/api/products/demo-repo/scans/${ob4.body.job.id}`, 'DELETE', { slug: 'demo-repo', job: ob4.body.job.id }); }
await until(() => J.list('demo-repo').every((j) => j.status !== 'running' && j.status !== 'queued'), 10000);

// ------------------------------------------------------------------------------------------------- 5 restart
{
  // a fresh slug and root, so this process reads their job journal once (reconcileJobs): an adopt job it saw running with a
  // dead pid, and a build-up journal that stops at the product tree
  const orphan = mkRepo('orphan');
  const id = 'j-orphan-1';
  const started = new Date(Date.now() - 60_000).toISOString();
  const dir = path.join(orphan, '.ai', 'lens-scan', 'work', 'bp-jobs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), JSON.stringify({ at: started, slug: 'orphan', pid: 2147480000, phase: 'running', job: { id, kind: 'adopt', status: 'running', queued_at: started, started_at: started, adopt_phase: 'product-tree' } }) + '\n');
  fs.writeFileSync(OJ.buildupFile(orphan, id), [
    { type: 'begin', at: 0, project: { slug: 'orphan', name: 'Orphan' }, extent: null },
    { type: 'phase', at: 5, phase: 'check', state: 'start', detail: null },
    { type: 'phase', at: 400, phase: 'check', state: 'done', detail: null },
    { type: 'phase', at: 900, phase: 'product-tree', state: 'start', detail: null },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const reg = JSON.parse(fs.readFileSync(process.env.BP_PRODUCTS_FILE!, 'utf8'));
  reg.products.push({ slug: 'orphan', name: 'Orphan', root: orphan });
  fs.writeFileSync(process.env.BP_PRODUCTS_FILE!, JSON.stringify(reg));
  const g = await call(onboardingR.GET, '/api/products/orphan/onboarding', 'GET', { slug: 'orphan' });
  check('5 a job whose process is gone after a restart reads failed, naming the restart', g.body.job?.status === 'failed' && /restarted/.test(g.body.job.error ?? '') && g.body.job.adopt_phase === 'product-tree', JSON.stringify(g.body));
  const s5 = await readSse('/api/products/orphan/onboarding/events', { slug: 'orphan' }, (evs) => evs.some((e) => e.type === 'failed'), 4000);
  check('5 its SSE replays the journal and ends failed in product-tree', s5.evs[0]?.type === 'begin' && s5.evs.length === 5 && s5.evs.at(-1)?.type === 'failed' && (s5.evs.at(-1) as { phase?: string }).phase === 'product-tree', s5.evs.map((e) => e.type).join(' '));
}

try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a child's handle on Windows: the temp dir is the OS's to clear */ }
console.log(`check-onboarding: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
