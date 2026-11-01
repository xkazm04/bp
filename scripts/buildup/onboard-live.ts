// Run a REAL onboarding (the adopt-bp skill, headless `claude -p`) in a repo and serve what it learns, as it learns it,
// as build-up events (apps/web/src/buildup/contract.ts) over Server-Sent Events for the /buildup lab
// (`?source=live&feed=http://127.0.0.1:<port>`). It is the test harness for docs/concepts/onboarding/feasibility.md:
// the pipeline emits no events, so this watches the files each step leaves behind and derives them. Every raw signal
// (file appearances, the agent's own tool calls and messages) goes to the tape beside the derived events, so the
// silences can be measured and designed against.
//
//   node --import @bp/core/register scripts/buildup/onboard-live.ts --root <repo> --slug <s> --name <n>
//        [--port 3300] [--tape <file.jsonl>] [--model <id>] [--hold-min 10]
//
// Stays up after the run (serving the finished tape) for --hold-min minutes, or until killed.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { projectPlan } from '@bp/core/server/plan-projection';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const BP = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
const ROOT = path.resolve(opt('root') ?? '.');
const SLUG = opt('slug') ?? path.basename(ROOT);
const NAME = opt('name') ?? SLUG;
const PORT = Number(opt('port', '3300'));
const TAPE = path.resolve(opt('tape') ?? path.join(BP, '.contest', 'arena', 'blueprint-buildup', 'runs', 'live', `${SLUG}-${Date.now()}.jsonl`));
const MODEL = opt('model');
const HOLD_MIN = Number(opt('hold-min', '10'));
const LS = path.join(ROOT, '.ai', 'lens-scan');
const WORK = path.join(LS, 'work');
const SKILL = path.join(BP, '.claude', 'skills', 'adopt-bp');

fs.mkdirSync(path.dirname(TAPE), { recursive: true });
const t0 = Date.now();
const now = () => Date.now() - t0;
const tape = fs.createWriteStream(TAPE, { flags: 'w' });
const raw = (kind: string, data: unknown) => tape.write(JSON.stringify({ t: now(), raw: kind, data }) + '\n');

// ------------------------------------------------------------------ the feed
type Ev = Record<string, unknown> & { type: string; at: number };
const events: Ev[] = [];
const clients = new Set<http.ServerResponse>();
const emit = (e: Omit<Ev, 'at'>) => {
  const ev = { ...e, at: now() } as Ev;
  events.push(ev);
  tape.write(JSON.stringify({ t: ev.at, event: ev }) + '\n');
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(line);
  console.log(`[${(ev.at / 1000).toFixed(1)}s] ${ev.type}${'phase' in ev ? ' ' + ev.phase + ' ' + ev.state : ''}${ev.detail ? ' - ' + ev.detail : ''}`);
};
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url?.startsWith('/events')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url?.startsWith('/status')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ done: finished, events: events.length, t: now() })); return; }
  res.writeHead(404); res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`feed on http://127.0.0.1:${PORT}/events, tape ${TAPE}`));
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000).unref();

// ------------------------------------------------------------------ deriving events from files
const exists = (p: string) => fs.existsSync(p);
const mtime = (p: string) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const readJson = (p: string): unknown => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const listDir = (d: string) => { try { return fs.readdirSync(d).sort(); } catch { return [] as string[]; } };

type Phase = 'check' | 'context-map' | 'seed' | 'product-tree' | 'events' | 'measure' | 'judge' | 'register';
const phaseState = new Map<Phase, 'start' | 'done'>();
const phase = (p: Phase, state: 'start' | 'done', detail: string | null = null) => {
  if (phaseState.get(p) === state || (state === 'start' && phaseState.get(p) === 'done')) return;
  if (state === 'done' && !phaseState.has(p)) emit({ type: 'phase', phase: p, state: 'start', detail: null });
  phaseState.set(p, state);
  emit({ type: 'phase', phase: p, state, detail });
};

interface PlanDoc { wings: { id: string; name: string; order: number; letter: string; box: unknown }[]; rooms: { id: string; parentId: string }[]; bays: { id: string; parentId: string }[]; tiles: { id: string; name: string; order: number; parentId: string; box: unknown; general: string }[] }
interface Feature { id?: string; slug?: string; stage?: string; kind?: string; tier?: string; summary?: string; created?: string }
const planNow = (): { plan: PlanDoc; feats: Map<string, Feature>; events: string } | null => {
  const map = readJson(path.join(LS, 'app-structure.json')) as { features?: Feature[] } | null;
  if (!map?.features?.length) return null;
  const evText = readText(path.join(LS, 'events.jsonl'));
  try {
    const plan = projectPlan(map, evText, 'live') as unknown as PlanDoc;
    const feats = new Map<string, Feature>();
    for (const f of map.features) { if (f.id) feats.set(f.id, f); if (f.slug) feats.set(f.slug, f); }
    return { plan, feats, events: evText };
  } catch (e) { raw('plan-error', String(e)); return null; }
};
const firstSeen = (text: string) => {
  const m = new Map<string, string>();
  for (const l of text.split('\n')) { try { const e = JSON.parse(l); if (e.type === 'feature-added' && e.feature && !m.has(e.feature)) m.set(e.feature, e.at); } catch { /* skip */ } }
  return m;
};

let sentStructure = false, sentHistory = false, sentHealth = false, finished = false;
let mapM = 0, evM = 0, judgeFiles = 0, treeDFiles = 0, batchFiles = 0, mapMAtJudgeFiles = 0;
const seen = new Set<string>();

function poll() {
  // raw: every new file under .ai/lens-scan (work/ included), with its size
  const walk = (d: string, rel = ''): void => {
    for (const n of listDir(d)) {
      const p = path.join(d, n), r = rel ? rel + '/' + n : n;
      let st: fs.Stats; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (n !== 'bp-jobs') walk(p, r); continue; }
      if (!seen.has(r)) { seen.add(r); raw('file', { path: r, bytes: st.size }); }
    }
  };
  walk(LS);
  if (exists(path.join(WORK, 'context-supplement.json')) || exists(path.join(LS, 'app-structure.json'))) phase('context-map', 'start');

  // seed: the skeleton map appears (code tree, no features yet)
  const m = mtime(path.join(LS, 'app-structure.json'));
  if (m && !phaseState.has('seed')) {
    phase('context-map', 'done');
    const map = readJson(path.join(LS, 'app-structure.json')) as { contexts?: unknown[]; code?: { contexts?: unknown[] } } | null;
    const n = map?.contexts?.length ?? map?.code?.contexts?.length;
    phase('seed', 'done', n ? `${n} code contexts` : null);
    phase('product-tree', 'start');
  }
  const td = listDir(path.join(WORK, 'product-tree.d'));
  if (td.length > treeDFiles) { treeDFiles = td.length; raw('tree-domain-files', td); }

  // product tree merged into the map: the whole structure, at once
  if (m && m !== mapM) {
    mapM = m;
    const p = !sentStructure ? planNow() : null;
    if (p) {
      sentStructure = true;
      const { plan, feats } = p;
      const fOf = (id: string) => feats.get(id) ?? feats.get(id.split(':').pop() ?? '') ?? {};
      emit({
        type: 'structure', wings: plan.wings, rooms: plan.rooms, bays: plan.bays,
        tiles: plan.tiles.map((t) => { const f = fOf(t.id); return { id: t.id, name: t.name, order: t.order, parentId: t.parentId, box: t.box, stage: f.stage ?? null, kind: f.kind ?? null, tier: f.tier ?? null, summary: f.summary ?? null }; }),
      });
      phase('product-tree', 'done', `${plan.wings.length} wings, ${plan.rooms.length} rooms, ${plan.tiles.length} features`);
      phase('events', 'start');
    }
  }
  // history: events.jsonl written after the tree
  const e = mtime(path.join(LS, 'events.jsonl'));
  if (sentStructure && !sentHistory && e && e !== evM) {
    evM = e;
    const p = planNow();
    if (p) {
      const seenAt = firstSeen(p.events);
      sentHistory = true;
      emit({ type: 'history', tiles: p.plan.tiles.map((t) => { const f = p.feats.get(t.id) ?? {}; return { id: t.id, created: f.created ?? seenAt.get(f.slug ?? f.id ?? t.id) ?? seenAt.get(t.id) ?? null }; }) });
      phase('events', 'done', `${seenAt.size} of ${p.plan.tiles.length} dated`);
      phase('measure', 'start');
    }
  }
  // judge: batches appear, then one judgement file per batch; health lands in the map after the final merge
  const batches = listDir(path.join(WORK, 'batches')).filter((n) => n.endsWith('.json'));
  if (batches.length && batches.length !== batchFiles) { batchFiles = batches.length; raw('batches', batches.length); }
  if (batches.length && sentHistory) { phase('measure', 'done'); phase('judge', 'start'); }
  const judged = listDir(path.join(WORK, 'judgement')).filter((n) => n.endsWith('.json'));
  if (judged.length !== judgeFiles) {
    judgeFiles = judged.length;
    mapMAtJudgeFiles = mtime(path.join(LS, 'app-structure.json'));
    raw('judgement-files', { n: judged.length, of: batches.length });
  }
  if (!sentHealth && batches.length && judged.length >= batches.length && mtime(path.join(LS, 'app-structure.json')) > mapMAtJudgeFiles) {
    const p = planNow();
    if (p) {
      sentHealth = true;
      const tiles = p.plan.tiles.map((t) => ({ id: t.id, general: t.general }));
      for (let i = 0; i < tiles.length; i += 8) emit({ type: 'health', tiles: tiles.slice(i, i + 8) });
      phase('judge', 'done', `${tiles.filter((x) => x.general === 'bad').length} in trouble`);
      phase('register', 'start');
    }
  }
  const reg = readJson(path.join(BP, 'bp.products.local.json')) as { products?: { slug: string }[] } | null;
  if (reg?.products?.some((x) => x.slug === SLUG)) phase('register', 'done', SLUG);
}

// ------------------------------------------------------------------ the run
emit({ type: 'begin', project: { slug: SLUG, name: NAME }, extent: null });
phase('check', 'start');
const chk = spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'adopt.mjs'), 'check', '--root', ROOT, '--bp', BP, '--json'], { encoding: 'utf8' });
raw('check', chk.stdout.slice(0, 20000));
let need = 0; try { need = (JSON.parse(chk.stdout).items as { state: string }[]).filter((i) => i.state !== 'ok').length; } catch { /* keep 0 */ }
phase('check', 'done', `${need} to produce`);

const prompt = [
  `Onboard the repository in the current directory into bp (the product blueprint) with the adopt-bp skill.`,
  `The skill is NOT installed for you: read ${SKILL}/SKILL.md and follow it exactly, with S=${SKILL} and --bp ${BP}.`,
  `Use --slug ${SLUG} --name "${NAME}". Run the whole run (check, supplement if needed, seed, phase A product tree, events, measure, batches, phase B judgement for every batch, judge, validate, register, report).`,
  `One addition for a timing test: while you write the product tree, ALSO write each domain to work/product-tree.d/<NN>-<domain-slug>.json as soon as you have decided it (the same shape as one entry of the tree), before you write work/product-tree.json.`,
  `Do not commit, do not push, do not edit files outside .ai/lens-scan/, .gitignore (or .git/info/exclude), .claude/lens-scan/ and the bp registry. Work without asking questions.`,
].join('\n');
const args = ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
if (MODEL) args.push('--model', MODEL);
const child = spawn('claude', args, { cwd: ROOT, shell: process.platform === 'win32', env: { ...process.env, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' } });
child.stdin.end(prompt);
let buf = '';
child.stdout.on('data', (d: Buffer) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      // keep the agent's activity small: tool name + its first input field, assistant text heads
      if (j.type === 'assistant') for (const c of j.message?.content ?? []) {
        if (c.type === 'tool_use') raw('tool', { name: c.name, input: JSON.stringify(c.input ?? {}).slice(0, 300) });
        else if (c.type === 'text') raw('say', String(c.text).slice(0, 400));
      }
      else if (j.type === 'result') raw('result', { cost: j.total_cost_usd, turns: j.num_turns, ms: j.duration_ms, subtype: j.subtype });
    } catch { raw('stdout', line.slice(0, 300)); }
  }
});
child.stderr.on('data', (d: Buffer) => raw('stderr', d.toString().slice(0, 500)));
const timer = setInterval(poll, 1000);
child.on('close', (code) => {
  poll();
  clearInterval(timer);
  if (code === 0 && sentStructure) {
    if (!sentHealth) { const p = planNow(); if (p) { const tiles = p.plan.tiles.map((t) => ({ id: t.id, general: t.general })); for (let i = 0; i < tiles.length; i += 8) emit({ type: 'health', tiles: tiles.slice(i, i + 8) }); phase('judge', 'done'); } }
    phase('register', 'done', SLUG);
    emit({ type: 'done' });
  } else {
    const last = ([...phaseState.entries()].reverse().find(([, s]) => s === 'start')?.[0] ?? 'check') as Phase;
    emit({ type: 'failed', phase: last, message: `claude exited ${code}` });
  }
  finished = true;
  raw('exit', { code, ms: now() });
  console.log(`run finished (${code}) after ${(now() / 60000).toFixed(1)} min; holding the feed ${HOLD_MIN} min`);
  setTimeout(() => { tape.end(); server.close(); process.exit(0); }, HOLD_MIN * 60000);
});
process.on('SIGINT', () => { child.kill(); tape.end(); process.exit(130); });
