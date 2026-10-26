// Checks the companion's brain (packages/core/src/companion/brain, spark companion-upgrade P2) against a temp BP_HOME per case:
//   fts5        this Node's sqlite has FTS5 (else the LIKE fallback is what runs, and the line says so)
//   provenance  writeFact refuses no source, an unknown episode, a fact id as a source and a source from another space
//   atomic      a killed write (a half-written temp beside the file) leaves the file whole, readers ignore the temp, a
//               rebuild sweeps it
//   rebuild     deleting index.sqlite (and, separately, overwriting it with garbage) then recalling rebuilds the same hits
//   recall      the bounds (8 always, 8 keyword, 6 episodes), "(showing N of M)", one quoted line per memory capped at 300
//               chars, the space wall (product A never sees product B; both see core), never throws, uses counted
//   sleep       one full pass on a scripted leg: compress, merge with one supersede, fade, a forget proposal, the cycle
//               file, episodes marked slept, and the due gate (not due again within the hour)
//   halving     a failing leg halves the take (20 -> 10) and the next pass reads 10; failing alone twice quarantines
//   lock        a second pass while one runs is refused
//   route       GET answers stats plus recent facts; POST cites the conversation's newest episode, 409 without one
// Run: node scripts/check-companion-brain.ts  (Node's type stripping). Prints ok/FAIL lines; exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const load = (rel: string): Promise<unknown> => import(pathToFileURL(path.join(ROOT, rel)).href);
const B = 'packages/core/src/companion/brain/';
const brain = await load(B + 'brain.server.ts') as typeof import('../packages/core/src/companion/brain/brain.server.ts');
const paths = await load(B + 'paths.server.ts') as typeof import('../packages/core/src/companion/brain/paths.server.ts');
const files = await load(B + 'files.server.ts') as typeof import('../packages/core/src/companion/brain/files.server.ts');
const index = await load(B + 'index.server.ts') as typeof import('../packages/core/src/companion/brain/index.server.ts');
const recall = await load(B + 'recall.server.ts') as typeof import('../packages/core/src/companion/brain/recall.server.ts');
const sleep = await load(B + 'sleep.server.ts') as typeof import('../packages/core/src/companion/brain/sleep.server.ts');
const route = await load('packages/core/src/server/api/companion/brain/route.ts') as typeof import('../packages/core/src/server/api/companion/brain/route.ts');
type LegRequest = import('../packages/core/src/companion/runtime/turn.server.ts').LegRequest;
type LegResult = import('../packages/core/src/companion/runtime/turn.server.ts').LegResult;

let failed = 0;
const check = (name: string, ok: boolean, detail = ''): void => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

const homes: string[] = [];
let t = Date.parse('2026-06-01T09:00:00Z');
paths.setBrainClock(() => t);
const MIN = 60_000, DAY = 86_400_000;
function fresh(): string {
  index.closeIndex();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-brain-'));
  homes.push(d);
  process.env.BP_HOME = d;
  t = Date.parse('2026-06-01T09:00:00Z');
  return d;
}
const ep = (space: string, input: string, reply = 'noted', conversationId = 'c1') => { t += MIN; return brain.appendEpisode({ space, conversationId, input, reply, tools: [] }); };
const section = (block: string, name: string): string[] => {
  const lines = block.split('\n'), i = lines.findIndex((l) => l.startsWith(`### ${name}`));
  if (i < 0) return [];
  const j = lines.findIndex((l, k) => k > i && l.startsWith('### '));
  return lines.slice(i, j < 0 ? undefined : j);
};
const shown = (head: string): [number, number] => { const m = /\(showing (\d+) of (\d+)\)/.exec(head); return m ? [+m[1], +m[2]] : [-1, -1]; };
const idsIn = (lines: string[]): string[] => lines.flatMap((l) => [...l.matchAll(/\[(f-[^,\]]+)/g)].map((m) => m[1])).sort();

try {
  // fts5
  fresh();
  const fts = index.hasFts5();
  check(`fts5 available in node:sqlite ${process.versions.sqlite ?? ''} (${fts ? 'BM25 search' : 'LIKE fallback in use'})`, fts);

  // provenance
  fresh();
  const e1 = ep('alpha', 'we deploy alpha on fridays');
  const eb = ep('beta', 'beta ships monthly');
  const refused = (name: string, r: { ok: boolean; error?: string }, why: RegExp) => check(`provenance refuses ${name}`, !r.ok && why.test(r.error ?? ''), JSON.stringify(r));
  refused('no source', brain.writeFact({ space: 'alpha', kind: 'project', text: 'x', sources: [] }), /at least one source/);
  refused('an unknown episode', brain.writeFact({ space: 'alpha', kind: 'project', text: 'x', sources: ['e-20260101T000000-abcdef'] }), /not a live episode/);
  const good = brain.writeFact({ space: 'alpha', kind: 'project', text: 'alpha deploys on fridays', sources: [e1.id] });
  check('provenance accepts a live episode of its space', good.ok);
  refused('a fact id as a source', brain.writeFact({ space: 'alpha', kind: 'project', text: 'x', sources: [good.ok ? good.fact.id : 'f'] }), /not a live episode/);
  refused('a source from another space', brain.writeFact({ space: 'alpha', kind: 'project', text: 'x', sources: [eb.id] }), /in space beta/);
  fs.rmSync(paths.episodePath(e1.id)!);
  refused('an episode whose file is gone', brain.writeFact({ space: 'alpha', kind: 'project', text: 'x', sources: [e1.id] }), /not a live episode/);
  check('a core fact may cite any space', brain.writeFact({ space: 'core', kind: 'user', text: 'the person likes short answers', sources: [eb.id] }).ok);

  // atomic
  fresh();
  const ea = ep('alpha', 'remember the kettle colour is teal');
  const fa = brain.writeFact({ space: 'alpha', kind: 'project', text: 'the kettle colour is teal', sources: [ea.id] });
  const file = fa.ok ? files.recPath({ id: fa.fact.id, type: 'fact', kind: 'project' }) : '';
  const before = fs.readFileSync(file, 'utf8');
  const tmp = `${file}.tmp-99999-deadbeef`;
  fs.writeFileSync(tmp, '---\nid: "' + (fa.ok ? fa.fact.id : '') + '"\ntype: "fact"\nkind: "pro'); // the process died mid-write
  fs.utimesSync(tmp, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
  check('atomic: the target survives a killed temp write', fs.readFileSync(file, 'utf8') === before && files.readRec(file)?.text === 'the kettle colour is teal');
  check('atomic: readers ignore the orphan temp', files.readAll().recs.length === 2 && files.readAll().skipped === 0, JSON.stringify(files.readAll().skipped));
  files.atomicWrite(file, before.replace('teal', 'red'));
  check('atomic: a completed write replaces the whole file', files.readRec(file)?.text === 'the kettle colour is red');
  index.closeIndex();
  fs.rmSync(paths.indexPath(), { force: true });
  check('atomic: a rebuild sweeps the orphan', brain.brainStats().facts === 1 && !fs.existsSync(tmp));
  check('atomic: no temp file is left by completed writes', !fs.readdirSync(path.dirname(file)).some((f) => f.includes('.tmp-')));

  // rebuild
  fresh();
  const er = ep('alpha', 'the release train leaves on tuesday');
  for (const s of ['the release train leaves on tuesday', 'release notes are written by the person', 'the train skips holidays']) brain.writeFact({ space: 'alpha', kind: 'project', text: s, sources: [er.id], importance: 1 });
  brain.recallBlock('alpha', 'release train');
  const a1 = brain.recallBlock('alpha', 'release train');
  index.closeIndex();
  for (const x of ['', '-wal', '-shm']) fs.rmSync(paths.indexPath() + x, { force: true });
  const rebuildsBefore = index.indexInfo().rebuilds;
  const a2 = brain.recallBlock('alpha', 'release train');
  const m1 = section(a1, 'Matching'), m2 = section(a2, 'Matching');
  check('rebuild: deleting index.sqlite rebuilds it from the files', fs.existsSync(paths.indexPath()) && index.indexInfo().rebuilds === rebuildsBefore + 1);
  check('rebuild: recall finds the same hits after the rebuild', m1.length === 4 && JSON.stringify(idsIn(m1)) === JSON.stringify(idsIn(m2)) && m1[0] === m2[0], `${m1.join('|')} vs ${m2.join('|')}`);
  index.closeIndex();
  for (const x of ['-wal', '-shm']) fs.rmSync(paths.indexPath() + x, { force: true });
  fs.writeFileSync(paths.indexPath(), 'this is not a database '.repeat(400));
  const asideBefore = index.indexInfo().setAside.length;
  const a3 = brain.recallBlock('alpha', 'release train');
  check('rebuild: a damaged index is set aside and rebuilt', index.indexInfo().setAside.length === asideBefore + 1 && JSON.stringify(idsIn(section(a3, 'Matching'))) === JSON.stringify(idsIn(m1)), a3);

  // recall
  fresh();
  const ra = ep('prod-a', 'kickoff for product a');
  const rb = ep('prod-b', 'kickoff for product b');
  for (let i = 0; i < 12; i++) brain.writeFact({ space: 'prod-a', kind: 'project', text: `alpha always fact number ${i}`, sources: [ra.id] });
  for (let i = 0; i < 12; i++) brain.writeFact({ space: 'prod-a', kind: 'project', text: `alpha keyword fact ${i} about pipelines`, sources: [ra.id], importance: 1 });
  brain.writeFact({ space: 'prod-a', kind: 'project', text: `pipelines line one\nline two "quoted" ${'x'.repeat(600)}`, sources: [ra.id], importance: 1 });
  for (let i = 0; i < 10; i++) ep('prod-a', `episode ${i} of a`);
  for (let i = 0; i < 4; i++) brain.writeFact({ space: 'prod-b', kind: 'project', text: `SECRET-B pipelines fact ${i}`, sources: [rb.id], importance: i % 2 ? 1 : 4 });
  for (let i = 0; i < 3; i++) ep('prod-b', `SECRET-B episode ${i} pipelines`);
  brain.writeFact({ space: 'core', kind: 'user', text: 'core: the person reads pipelines first', sources: [rb.id], importance: 4 });
  const ba = brain.recallBlock('prod-a', 'pipelines');
  const al = section(ba, 'Always'), kw = section(ba, 'Matching'), rec = section(ba, 'Recent episodes');
  check('recall: the always tier shows 8 of its 13 (12 + core)', JSON.stringify(shown(al[0])) === '[8,13]' && al.length === 9, al[0]);
  check('recall: keyword hits show at most 8, with their total', shown(kw[0])[0] === 8 && shown(kw[0])[1] >= 13 && kw.length === 9, kw[0]);
  check('recall: recent episodes show the last 6 of 11', JSON.stringify(shown(rec[0])) === '[6,11]' && rec.length === 7 && rec[6].includes('episode 9 of a'), rec.join('|'));
  check('recall: the space wall keeps product B out of product A', !ba.includes('SECRET-B'));
  check('recall: core is visible from a product', ba.includes('core: the person reads pipelines first'));
  const memLines = ba.split('\n').filter((l) => l.startsWith('- '));
  const quoted = memLines.map((l) => /("(?:[^"\\]|\\.)*")/.exec(l)?.[1] ?? '');
  check('recall: every memory is one line with a quoted text of at most 300 chars', memLines.length === 22 && quoted.every((q) => q && JSON.parse(q).length <= 300), String(memLines.length));
  const qd = recall.quote('line one\r\nline two "quoted" ' + 'x'.repeat(600));
  check('recall: newlines in a memory are neutralised, quotes escaped, the text capped', !/[\r\n]/.test(qd) &&JSON.parse(qd).startsWith('line one / line two "quoted"') && JSON.parse(qd).length === 300, qd.slice(0, 60));
  const bb = brain.recallBlock('prod-b', 'pipelines');
  check('recall: product B sees its own and core, never product A', bb.includes('SECRET-B') && bb.includes('core: the person') && !bb.includes('alpha') && !bb.includes('of a'));
  const firstAlways = idsIn(al.slice(1, 2))[0];
  const usedRow = firstAlways ? index.getRec(firstAlways) : null;
  const used = usedRow ? files.readRec(files.recPath(usedRow)) : null;
  check('recall: a shown fact is marked used (uses, lastUsed)', !!used && used.uses >= 1 && !!used.lastUsed, JSON.stringify(used));
  check('recall: a bad space is refused, not thrown', brain.recallBlock('../etc', 'x').startsWith('memory could not be read:'));
  index.closeIndex();
  const blocker = path.join(fresh(), 'blocked');
  fs.writeFileSync(blocker, 'a file where the home should be');
  process.env.BP_HOME = blocker;
  let threw = false, out = '';
  try { out = brain.recallBlock('prod-a', 'x'); } catch { threw = true; }
  check('recall: an unreadable brain answers "memory could not be read", never throws', !threw && out.startsWith('memory could not be read:'), out);

  // sleep: one full pass
  fresh();
  t = Date.parse('2026-01-01T09:00:00Z');
  const old = ep('prod-a', 'the deploy target is staging');
  const stale = brain.writeFact({ space: 'prod-a', kind: 'project', text: 'the deploy target is staging', sources: [old.id] });
  const forgotten = brain.writeFact({ space: 'prod-a', kind: 'world', text: 'the coffee machine is on floor two', sources: [old.id], importance: 1 });
  t = Date.parse('2026-06-01T08:50:00Z');
  for (let i = 0; i < 22; i++) ep('prod-a', i === 3 ? 'actually we deploy to production now' : i === 5 ? 'keep reports terse please' : `routine turn ${i}`);
  const calls: LegRequest[] = [];
  const script = async (req: LegRequest): Promise<LegResult> => {
    calls.push(req);
    const data = JSON.parse(req.prompt.split('\n').pop()!) as unknown[];
    if (calls.length === 1) {
      const eps = data as { id: string; person: string }[];
      const prod = eps.find((e) => e.person.includes('production'))!, terse = eps.find((e) => e.person.includes('terse'))!;
      return { ok: true, costUsd: null, text: 'Here:\n' + JSON.stringify({ facts: [
        { space: 'prod-a', kind: 'project', text: 'the deploy target is production', sources: [prod.id], importance: 4, confidence: 0.9 },
        { space: 'core', kind: 'user', text: 'the person wants terse reports', sources: [terse.id], importance: 4, confidence: 0.8 },
        { space: 'prod-a', kind: 'project', text: 'cites outside the take', sources: ['e-20990101T000000-000000'] },
      ] }) };
    }
    const items = data as { i: number; candidate: string; existing: { id: string; text: string }[] }[];
    return { ok: true, costUsd: null, text: JSON.stringify({ verdicts: items.map((x) => {
      const hit = x.existing.find((e) => e.text.includes('staging'));
      return hit ? { i: x.i, verdict: 'supersede', target: hit.id } : { i: x.i, verdict: 'add' };
    }) }) };
  };
  t += 5 * MIN;
  const notIdle = await brain.sleepIfDue({ leg: script });
  check('sleep: not due while a turn ran under 10 minutes ago', !notIdle.ran && calls.length === 0);
  t += 15 * MIN;
  const r = await brain.sleepIfDue({ leg: script });
  check('sleep: due when idle, 20+ un-slept and never slept; it runs', r.ran && !r.error, JSON.stringify(r));
  check('sleep: compress read the 20 oldest episodes and kept the 2 grounded candidates', calls[0]?.kind === 'sleep' && (JSON.parse(calls[0].prompt.split('\n').pop()!) as unknown[]).length === 20 && r.compressed === 2, String(r.compressed));
  const staleRec = stale.ok ? files.readRec(files.recPath({ id: stale.fact.id, type: 'fact', kind: 'project' })) : null;
  check('sleep: merge superseded the staging fact (one supersede) and wrote both', r.merged === 2 && !!staleRec?.supersededBy, JSON.stringify(staleRec));
  const prodFact = staleRec?.supersededBy ? index.getRec(staleRec.supersededBy) : null;
  check('sleep: the superseding fact cites its episode', !!prodFact && prodFact.text === 'the deploy target is production' && prodFact.sources.length === 1);
  const forgotRec = forgotten.ok ? files.readRec(files.recPath({ id: forgotten.fact.id, type: 'fact', kind: 'world' })) : null;
  check('sleep: fade stepped an unused fact down by one', r.faded >= 1 && forgotRec?.importance === 0 && !!forgotRec.fadedAt, JSON.stringify(forgotRec));
  check('sleep: forget proposals are reported, nothing deleted', forgotten.ok && r.forgetProposals.some((p) => p.startsWith(forgotten.fact.id)) && fs.existsSync(files.recPath({ id: forgotten.fact.id, type: 'fact', kind: 'world' })), JSON.stringify(r.forgetProposals));
  const slept = files.readAll().recs.filter((x) => x.type === 'episode' && x.slept).length;
  check('sleep: the take is marked slept (20 of 23)', slept === 20, String(slept));
  const cyc = sleep.lastCycles(1)[0];
  const cycText = cyc ? fs.readFileSync(cyc, 'utf8') : '';
  check('sleep: the pass wrote cycles/<at>.md', /status: "completed"/.test(cycText) && /supersede f-/.test(cycText) && /propose forget/.test(cycText), cyc);
  check('sleep: brainStats reports lastSleep', brain.brainStats().lastSleep === new Date(t).toISOString());
  const again = await brain.sleepIfDue({ leg: script });
  check('sleep: not due again within the hour', !again.ran && calls.length === 2);

  // halving and quarantine
  fresh();
  for (let i = 0; i < 25; i++) ep('prod-a', `turn ${i}`);
  const down: Leg = async () => ({ ok: false, text: '', costUsd: null, failure: 'limit' });
  const f1 = await brain.sleepIfDue({ force: true, leg: down });
  check('halving: a failing leg is reported and halves the take (20 -> 10)', f1.ran && !!f1.error && sleep.readSleepState().take === 10, JSON.stringify([f1, sleep.readSleepState()]));
  check('halving: nothing was consumed', files.readAll().recs.every((x) => !x.slept));
  let seen = 0;
  const count: Leg = async (req) => { seen = (JSON.parse(req.prompt.split('\n').pop()!) as unknown[]).length; return { ok: true, costUsd: null, text: '{"facts":[]}' }; };
  const f2 = await brain.sleepIfDue({ force: true, leg: count });
  check('halving: the next pass reads the halved take, then restores it', f2.ran && !f2.error && seen === 10 && sleep.readSleepState().take === 20, `${seen} ${sleep.readSleepState().take}`);
  for (let i = 0; i < 5; i++) await brain.sleepIfDue({ force: true, leg: down }); // 20 -> 10 -> 5 -> 2 -> 1, then alone once
  const lone = files.readAll().recs.filter((x) => x.type === 'episode' && !x.slept).sort((a, b) => a.at.localeCompare(b.at))[0];
  check('halving: an episode that failed alone once is counted, not yet quarantined', sleep.readSleepState().take === 1 && lone?.sleepFails === 1 && !lone.quarantined, JSON.stringify([sleep.readSleepState(), lone]));
  await brain.sleepIfDue({ force: true, leg: down });
  const q = lone ? files.readRec(paths.episodePath(lone.id)!) : null;
  check('halving: failing alone twice quarantines it', !!q?.quarantined);
  let firstSeen = '';
  await brain.sleepIfDue({ force: true, leg: async (req) => { firstSeen = (JSON.parse(req.prompt.split('\n').pop()!) as { id: string }[])[0]?.id ?? ''; return { ok: true, costUsd: null, text: '{"facts":[]}' }; } });
  check('halving: a quarantined episode is skipped by the next pass', !!firstSeen && firstSeen !== lone?.id);

  // lock
  let release: () => void = () => {};
  const slow: Leg = () => new Promise((res) => { release = () => res({ ok: true, costUsd: null, text: '{"facts":[]}' }); });
  const p1 = brain.sleepIfDue({ force: true, leg: slow });
  await new Promise((res) => setTimeout(res, 20));
  const p2 = await brain.sleepIfDue({ force: true, leg: slow });
  release();
  await p1;
  check('lock: a second pass while one runs is refused', !p2.ran && /already running/.test(p2.error ?? ''), JSON.stringify(p2));

  // route
  fresh();
  const H = { host: 'localhost:3000' }, J = { ...H, 'content-type': 'application/json' };
  const post = (conv: string | null, body: unknown) => route.POST(new Request('http://localhost:3000/api/companion/brain', { method: 'POST', headers: conv ? { ...J, 'x-bp-conversation': conv } : J, body: JSON.stringify(body) }));
  const none = await post('conv-9', { space: 'prod-a', kind: 'user', text: 'likes tea' });
  check('route: POST answers 409 when the conversation has no episode', none.status === 409);
  check('route: POST answers 400 without x-bp-conversation', (await post(null, { space: 'prod-a', kind: 'user', text: 'x' })).status === 400);
  const ce = ep('prod-a', 'please remember I like tea', 'noted', 'conv-9');
  const made = await post('conv-9', { space: 'prod-a', kind: 'user', text: 'likes tea' });
  const mj = await made.json() as { fact?: { sources: string[] } };
  check('route: POST writes a fact citing the newest episode (201)', made.status === 201 && mj.fact?.sources[0] === ce.id, JSON.stringify(mj));
  check('route: POST refuses a space the episode is not in (400)', (await post('conv-9', { space: 'prod-b', kind: 'user', text: 'x' })).status === 400);
  const got = await route.GET(new Request('http://localhost:3000/api/companion/brain', { headers: H }));
  const gj = await got.json() as { episodes: number; facts: number; spaces: string[]; recent: unknown[] };
  check('route: GET answers stats plus recent facts', got.status === 200 && gj.episodes === 1 && gj.facts === 1 && gj.recent.length === 1 && gj.spaces.includes('prod-a'), JSON.stringify(gj));
  check('route: GET refuses a foreign host', (await route.GET(new Request('http://x/api/companion/brain', { headers: { host: 'evil.com' } }))).status === 403);
} catch (e) {
  check('the check ran to the end', false, (e as Error)?.stack ?? String(e));
} finally {
  index.closeIndex();
  for (const d of homes) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows may hold a handle */ } }
}
type Leg = import('../packages/core/src/companion/brain/sleep.server.ts').Leg;

console.log(failed ? `check-companion-brain: ${failed} failed` : 'check-companion-brain: all passed');
process.exit(failed ? 1 : 0);
