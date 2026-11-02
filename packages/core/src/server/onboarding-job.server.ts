// The adopt job's own parts (jobs.server.ts runs the job; onboarding.server.ts answers the routes): where the adopt-bp
// skill is, the prompt, `adopt.mjs check --json`, the CLI's stream-json read into log lines and tool calls, and the
// build-up FEED - the event deriver of scripts/buildup/onboard-live.ts (the test harness) moved to the server.
//
// The feed watches the files adopt-bp writes under `<root>/.ai/lens-scan/` once a second, from the job's start to its
// settle, and derives BuildupEvents (packages/core/src/scan/onboarding.ts, restating apps/web/src/buildup/contract.ts):
// begin, phases, survey, outline (work/product-tree.d/ and the `domain` lines of work/progress.jsonl), narration (its
// `step` and `batch` lines), structure (projectPlan over the map), history, judge progress and a provisional health per
// judgement file, the final health, then done or failed. Activity comes from the CLI's tool calls.
// Every event is appended to `<root>/.ai/lens-scan/work/bp-jobs/<job>.buildup.jsonl` (`at` = ms since the job started) and
// fanned out to the subscribers of that job, so a reload, a second tab or a late subscriber catches up from the journal.
// A server restart keeps the journal: a job whose process is still there gets its feed back (resumeFeed, seeded from the
// journal); one whose process is gone gets a terminal event appended (closeJournal). Server-only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ScanJob } from '../scan/jobs.ts';
import { isBuildupPhase, type BuildupEvent, type BuildupEventIn, type BuildupPhase, type OnboardCheckItem, type Stage } from '../scan/onboarding.ts';
import { STAGES } from '../standard/schema-vocab.ts';
import { projectPlan } from './plan-projection.ts';
import { activityOf, areaOf, outlineFrom, provisionalHealth, surveyFrom, ProgressTail, type AreaIndex } from './onboarding-derive.ts';
import { warnOnce } from './products.server.ts';

if (typeof window !== 'undefined') throw new Error('onboarding-job.server.ts is server-only');

// ------------------------------------------------------------------------------------ the skill and the prompt
export const NO_ADOPT_SKILL = 'the adopt-bp skill was not found (bp/.claude/skills/adopt-bp, ~/.claude/skills/adopt-bp, or set BP_ADOPT_SKILL)';

/** The adopt-bp skill directory: BP_ADOPT_SKILL, else `.claude/skills/adopt-bp` in bp's root or an ancestor (a linked
 *  worktree sits inside its main checkout), else the user's `<configDir>/skills/adopt-bp`. Counts only with a SKILL.md
 *  and scripts/adopt.mjs. null = none. */
export function adoptSkillDir(bp: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string | null {
  const ok = (d: string) => fs.existsSync(path.join(d, 'SKILL.md')) && fs.existsSync(path.join(d, 'scripts', 'adopt.mjs'));
  const named = (env.BP_ADOPT_SKILL ?? '').trim();
  if (named) return ok(named) ? path.resolve(named) : null;
  for (let d = path.resolve(bp); ; d = path.dirname(d)) {
    const c = path.join(d, '.claude', 'skills', 'adopt-bp');
    if (ok(c)) return c;
    if (path.dirname(d) === d) break;
  }
  const user = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills', 'adopt-bp');
  return ok(user) ? user : null;
}

const oneLine = (s: string) => s.replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim();
const fwd = (p: string) => p.replace(/\\/g, '/');

/** The adopt job's prompt (stdin): the harness's (scripts/buildup/onboard-live.ts) without its test-only wording. The
 *  product is registered before the job starts, so the skill's register step is a confirm. */
export function adoptPrompt(o: { skill: string; bp: string; slug: string; name: string; resume: boolean }): string {
  const S = fwd(o.skill), BP = fwd(o.bp);
  return [
    `Onboard the repository in the current directory into bp (the product blueprint) with the adopt-bp skill.`,
    `The skill is not installed for you: read ${S}/SKILL.md and follow it exactly, with S=${S} and --bp ${BP}.`,
    `Use --slug ${o.slug} --name "${oneLine(o.name)}". Run the whole run (check, supplement if needed, seed, phase A product tree, events, measure, batches, phase B judgement for every batch, judge, validate, register, report).`,
    `The product is already registered in bp as ${o.slug}: the register step confirms it (and adds the ignore line when missing).`,
    ...(o.resume ? [`This resumes an onboarding that stopped part way: keep everything it already produced; check lists only what is missing, so produce only that.`] : []),
    `Narrate as you go (SKILL.md "Narrate as you go"): append one JSON line to .ai/lens-scan/work/progress.jsonl the moment you decide each domain (before you start the next), whenever you start a step (what you do now, what comes next; at least every 2 minutes) and when you dispatch each judgement batch - never save them up for later.`,
    `Do not commit, do not push, do not edit files outside .ai/lens-scan/, .gitignore (or .git/info/exclude), .claude/lens-scan/ and the bp registry. Work without asking questions.`,
  ].join('\n');
}

/** `adopt.mjs check --root <root> --bp <bp> --json`, its items as the wire carries them (`key` -> `id`). Never throws:
 *  a check that cannot run answers `error`. */
export function runAdoptCheck(skill: string, root: string, bp: string): Promise<{ items: OnboardCheckItem[]; error?: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(skill, 'scripts', 'adopt.mjs'), 'check', '--root', root, '--bp', bp, '--json'],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        try {
          const j = JSON.parse(stdout) as { items?: { key?: unknown; id?: unknown; state?: unknown; detail?: unknown }[] };
          const items = (Array.isArray(j.items) ? j.items : []).map((i) => ({
            id: String(i.key ?? i.id ?? ''), state: String(i.state ?? ''), detail: typeof i.detail === 'string' ? i.detail : null,
          })).filter((i) => i.id);
          resolve({ items });
        } catch {
          resolve({ items: [], error: oneLine(String(stderr || err?.message || 'adopt.mjs check printed no JSON')).slice(0, 300) });
        }
      });
  });
}

/** Whether the product's map has features: an adopt job that exited 0 is `done` only then. */
export function mapHasFeatures(root: string): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, '.ai', 'lens-scan', 'app-structure.json'), 'utf8')) as { features?: unknown[] };
    return Array.isArray(m.features) && m.features.length > 0;
  } catch { return false; }
}

/** Whether adopt-bp finished its report (ADOPT.md, its last step) since `sinceMs`: how a job whose process ended out of
 *  sight (a server restart) is judged. */
export function reportedSince(root: string, sinceMs: number): boolean {
  try { return fs.statSync(path.join(root, '.ai', 'lens-scan', 'ADOPT.md')).mtimeMs >= sinceMs - 1000 && mapHasFeatures(root); } catch { return false; }
}

// ------------------------------------------------------------------------------------ the CLI's stream-json
export interface StreamRead { lines: string[]; tools: { name: string; input: unknown }[]; error?: string }

/** One stdout line of `claude -p --output-format stream-json --verbose`, as readable log lines (tool names with their
 *  first input field, assistant text heads, the result) and the tool calls the feed attributes activity to. A line that
 *  is not JSON is kept as it is. */
export function readStreamLine(line: string): StreamRead {
  const out: StreamRead = { lines: [], tools: [] };
  if (!line.trim()) return out;
  let j: Record<string, unknown>;
  try { j = JSON.parse(line) as Record<string, unknown>; } catch { out.lines.push(line.slice(0, 400)); return out; }
  if (!j || typeof j !== 'object') return out;
  if (j.type === 'assistant') {
    const content = ((j.message as { content?: unknown } | undefined)?.content);
    for (const c of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
      if (c?.type === 'tool_use' && typeof c.name === 'string') {
        out.tools.push({ name: c.name, input: c.input });
        const i = (c.input ?? {}) as Record<string, unknown>;
        const first = ['file_path', 'path', 'pattern', 'command', 'description', 'prompt'].map((k) => i[k]).find((v) => typeof v === 'string') as string | undefined;
        out.lines.push(`> ${c.name}${first ? ' ' + oneLine(first).slice(0, 160) : ''}`);
      } else if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
        out.lines.push(...c.text.trim().slice(0, 400).split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(0, 6));
      }
    }
  } else if (j.type === 'result') {
    const cost = typeof j.total_cost_usd === 'number' ? ` · $${j.total_cost_usd.toFixed(2)}` : '';
    const turns = typeof j.num_turns === 'number' ? ` · ${j.num_turns} turns` : '';
    const secs = typeof j.duration_ms === 'number' ? ` · ${Math.round(j.duration_ms / 1000)} s` : '';
    out.lines.push(`# result: ${String(j.subtype ?? 'done')}${turns}${cost}${secs}`);
    if (j.is_error === true) out.error = oneLine(String(j.result ?? j.subtype ?? 'the run ended with an error')).slice(0, 300);
  } else if (j.type === 'system' && j.subtype === 'init') {
    out.lines.push(`# session${typeof j.model === 'string' ? ' · ' + j.model : ''}`);
  }
  return out;
}

// ------------------------------------------------------------------------------------ the journal
export const buildupFile = (root: string, id: string): string => path.join(root, '.ai', 'lens-scan', 'work', 'bp-jobs', id + '.buildup.jsonl');

/** The events of job `id` as its journal holds them (a torn last line is skipped). */
export function readBuildup(root: string, id: string): BuildupEvent[] {
  let text: string;
  try { text = fs.readFileSync(buildupFile(root, id), 'utf8'); } catch { return []; }
  const out: BuildupEvent[] = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { const e = JSON.parse(l) as BuildupEvent; if (e && typeof e.type === 'string' && typeof e.at === 'number') out.push(e); } catch { /* torn */ }
  }
  return out;
}
const terminal = (e: BuildupEvent) => e.type === 'done' || e.type === 'failed';
/** The phase a run was in at its last event: the latest phase started and not done, else the latest seen, else check. */
export function lastPhase(events: readonly BuildupEvent[]): BuildupPhase {
  const st = new Map<BuildupPhase, string>();
  for (const e of events) if (e.type === 'phase') st.set(e.phase, e.state);
  return [...st.entries()].reverse().find(([, s]) => s === 'start')?.[0] ?? [...st.keys()].pop() ?? 'check';
}

type Listener = (e: BuildupEvent) => void;
interface Live { root: string; events: BuildupEvent[]; subs: Set<Listener>; ended: boolean }
const G = globalThis as typeof globalThis & { __bpBuildupFeeds?: Map<string, Live> };
const FEEDS: Map<string, Live> = (G.__bpBuildupFeeds ??= new Map<string, Live>());

/**
 * The events of job `id` so far and every later one, in order: from the live feed when this process runs it, else from
 * the journal (polled once a second for lines another feed appends). `fn` is called synchronously for the catch-up.
 * Returns the unsubscribe.
 */
export function subscribeBuildup(root: string, id: string, fn: Listener): () => void {
  const live = FEEDS.get(id);
  if (live) {
    for (const e of live.events) fn(e);
    live.subs.add(fn);
    return () => { live.subs.delete(fn); };
  }
  let sent = 0, stopped = false;
  const pump = () => {
    if (stopped) return;
    const now = FEEDS.get(id);
    if (now) { // a feed started for it in the meantime (resumeFeed): hand over to it
      stopped = true; clearInterval(t);
      for (const e of now.events.slice(sent)) fn(e);
      now.subs.add(fn); handover = () => now.subs.delete(fn);
      return;
    }
    const evs = readBuildup(root, id);
    for (; sent < evs.length; sent++) fn(evs[sent]);
    if (evs.length && terminal(evs[evs.length - 1])) { stopped = true; clearInterval(t); } // nothing follows a done or failed
  };
  let handover: (() => void) | null = null;
  const t = setInterval(pump, 1000);
  t.unref?.();
  pump();
  return () => { stopped = true; clearInterval(t); handover?.(); };
}

/** A job that ended without its feed saying so (a restart, a never-started journal): append `done` or `failed` once. */
export function closeJournal(root: string, job: Pick<ScanJob, 'id' | 'status' | 'error' | 'started_at' | 'ended_at' | 'adopt_phase'>): void {
  if (FEEDS.has(job.id)) return; // a live feed settles itself
  const evs = readBuildup(root, job.id);
  if (!evs.length || evs.some(terminal)) return;
  const t0 = Date.parse(job.started_at ?? '') || Date.now();
  const at = Math.max(evs[evs.length - 1].at, (Date.parse(job.ended_at ?? '') || Date.now()) - t0);
  const e: BuildupEvent = job.status === 'done' ? { type: 'done', at }
    : { type: 'failed', at, phase: isBuildupPhase(job.adopt_phase) ? job.adopt_phase : lastPhase(evs), message: job.status === 'cancelled' ? 'cancelled' : job.error ?? 'the run stopped' };
  try { fs.appendFileSync(buildupFile(root, job.id), JSON.stringify(e) + '\n'); } catch (err) { warnOnce('buildup journal ' + buildupFile(root, job.id), err); }
}

// ------------------------------------------------------------------------------------ the feed
export interface Feed {
  /** A phase the job itself knows (check, from adopt.mjs check before the CLI starts). */
  phase(p: BuildupPhase, state: 'start' | 'done', detail?: string | null): void;
  /** A tool call of the CLI: one activity event, at most one a second. */
  tool(name: string, input: unknown): void;
  /** Start watching the files (once a second). */
  watch(): void;
  /** One look at the files now (what each tick of watch does). */
  poll(): void;
  /** The job ended: a last look at the files, then `done` (ok) or `failed` in the phase the run was in. Returns that phase. */
  settle(ok: boolean, message: string): BuildupPhase;
}

export interface FeedOpts {
  slug: string; name: string; root: string; id: string;
  /** The job's start (ms epoch): `at` counts from here. */
  t0: number;
  /** A phase started: the job carries it as `adopt_phase`. */
  onPhase?: (p: BuildupPhase) => void;
}

const POLL_MS = 1000;

/** A new job's feed: a fresh journal, `begin` and `phase check start`. */
export function openFeed(o: FeedOpts): Feed {
  try { fs.mkdirSync(path.dirname(buildupFile(o.root, o.id)), { recursive: true }); fs.writeFileSync(buildupFile(o.root, o.id), ''); } catch (e) { warnOnce('buildup journal ' + buildupFile(o.root, o.id), e); }
  const f = makeFeed(o, []);
  f.emit({ type: 'begin', project: { slug: o.slug, name: o.name }, extent: null });
  f.feed.phase('check', 'start');
  return f.feed;
}

/** The feed of a job adopted after a restart whose process is still running: its state seeded from the journal. */
export function resumeFeed(o: FeedOpts): Feed {
  return makeFeed(o, readBuildup(o.root, o.id)).feed;
}

function makeFeed(o: FeedOpts, prior: BuildupEvent[]): { feed: Feed; emit: (e: BuildupEventIn) => void } {
  const LS = path.join(o.root, '.ai', 'lens-scan'), WORK = path.join(LS, 'work');
  const file = buildupFile(o.root, o.id);
  const live: Live = { root: o.root, events: [...prior], subs: new Set(), ended: false };
  FEEDS.set(o.id, live);
  const now = () => Math.max(0, Date.now() - o.t0);
  const emit = (e: BuildupEventIn) => {
    if (live.ended) return;
    const ev = { ...e, at: now() } as BuildupEvent;
    live.events.push(ev);
    try { fs.appendFileSync(file, JSON.stringify(ev) + '\n'); } catch (err) { warnOnce('buildup journal ' + file, err); }
    for (const fn of live.subs) try { fn(ev); } catch { /* a closed stream unsubscribes itself */ }
  };

  // ---- state (seeded from the journal on a resume)
  const phaseState = new Map<BuildupPhase, 'start' | 'done'>();
  let sentStructure = false, sentHistory = false, sentHealth = false;
  const outlined = new Set<string>(), judgedDocs = new Set<string>();
  let batchFiles = 0;
  // the narration channel: only what this job appends (an earlier run's lines are skipped; a resume after a restart starts
  // at the file's end, so lines written while no server watched are not drawn)
  const progressFile = path.join(WORK, 'progress.jsonl');
  const fileSize = (p: string) => { try { return fs.statSync(p).size; } catch { return 0; } };
  const progress = new ProgressTail(fileSize(progressFile));
  for (const e of prior) {
    if (e.type === 'phase' && e.state !== 'failed') phaseState.set(e.phase, e.state);
    else if (e.type === 'structure') sentStructure = true;
    else if (e.type === 'history') sentHistory = true;
    else if (e.type === 'health' && !e.provisional) sentHealth = true;
    else if (e.type === 'outline') for (const d of e.domains) outlined.add(d.id);
    else if (e.type === 'progress' && e.phase === 'judge') { if (e.n === 0) batchFiles = e.of; const b = /^batch (\S+):/.exec(e.detail ?? ''); if (b) judgedDocs.add(b[1] + '.json'); }
  }

  const phase = (p: BuildupPhase, state: 'start' | 'done', detail: string | null = null) => {
    if (phaseState.get(p) === state || (state === 'start' && phaseState.get(p) === 'done')) return;
    if (state === 'done' && !phaseState.has(p)) { phaseState.set(p, 'start'); emit({ type: 'phase', phase: p, state: 'start', detail: null }); o.onPhase?.(p); }
    phaseState.set(p, state);
    emit({ type: 'phase', phase: p, state, detail });
    if (state === 'start') o.onPhase?.(p);
  };

  // ---- files
  const mtime = (p: string) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  const readJson = (p: string): unknown => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const readText = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const listDir = (d: string) => { try { return fs.readdirSync(d).sort(); } catch { return [] as string[]; } };
  const readBytes = (p: string) => (from: number, to: number): Uint8Array => {
    const b = Buffer.alloc(Math.max(0, to - from));
    let fd: number | null = null;
    try { fd = fs.openSync(p, 'r'); const n = fs.readSync(fd, b, 0, b.length, from); return b.subarray(0, n); } catch { return new Uint8Array(0); } finally { if (fd !== null) fs.closeSync(fd); }
  };

  interface PlanDoc { wings: { id: string; name: string; order: number; letter: string; box: { x: number; y: number; w: number; h: number } }[]; rooms: { id: string; name: string; order: number; parentId: string; box: { x: number; y: number; w: number; h: number } }[]; bays: { id: string; name: string; order: number; parentId: string; box: { x: number; y: number; w: number; h: number } }[]; tiles: { id: string; name: string; order: number; parentId: string; box: { x: number; y: number; w: number; h: number }; general: 'good' | 'watch' | 'bad' | 'na' | 'unmeasured' }[] }
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
    } catch { return null; } // a map mid-write, or one the loader refuses: next tick
  };
  const firstSeen = (text: string) => {
    const m = new Map<string, string>();
    for (const l of text.split('\n')) { try { const e = JSON.parse(l) as { type?: string; feature?: string; at?: string }; if (e.type === 'feature-added' && e.feature && e.at && !m.has(e.feature)) m.set(e.feature, e.at); } catch { /* skip */ } }
    return m;
  };
  const stageOf = (s: string | undefined): Stage | null => (s && (STAGES as readonly string[]).includes(s) ? (s as Stage) : null);

  // ---- anti-stale: survey, outline, activity
  const repoMap = readJson(path.join(o.root, 'context-map.json'));
  let areas: AreaIndex[] = [];
  let supM = 0, invM = 0;
  let pendingAct: { verb: 'read' | 'write' | 'run'; path: string } | null = null, lastAct = -1000;
  const flushActivity = () => {
    if (!pendingAct || now() - lastAct < 1000) return;
    lastAct = now();
    emit({ type: 'activity', verb: pendingAct.verb, path: pendingAct.path, area: areaOf(pendingAct.path, areas) });
    pendingAct = null;
  };
  const survey = () => {
    const sp = path.join(WORK, 'context-supplement.json'), ip = path.join(WORK, 'inventory.json');
    const sm = mtime(sp), im = mtime(ip);
    if (sm === supM && im === invM) return;
    const sup = sm ? readJson(sp) : null, inv = im ? readJson(ip) : null;
    if ((sm && !sup) || (im && !inv)) return; // half-written: next tick
    supM = sm; invM = im;
    areas = surveyFrom(repoMap, sup, inv);
    if (areas.length) emit({ type: 'survey', areas: areas.map((a) => a.area) });
  };

  let mapM = 0, evM = 0;
  function poll(): void {
    flushActivity();
    const mapFile = path.join(LS, 'app-structure.json');
    if (fs.existsSync(path.join(WORK, 'context-supplement.json')) || fs.existsSync(mapFile)) phase('context-map', 'start');
    // seed: the skeleton map appears (code tree, no features yet)
    const m = mtime(mapFile);
    if (m && phaseState.get('seed') !== 'done') {
      phase('context-map', 'done');
      const map = readJson(mapFile) as { contexts?: unknown[]; code?: { contexts?: unknown[] } } | null;
      const n = map?.contexts?.length ?? map?.code?.contexts?.length;
      phase('seed', 'done', n ? `${n} code contexts` : null);
      phase('product-tree', 'start');
    }
    survey();
    // narration: the lines the agent appended since the last look; a `domain` line is an outline (once per domain)
    for (const it of progress.next(fileSize(progressFile), readBytes(progressFile), lastPhase(live.events))) {
      if (it.kind === 'narration') { emit({ type: 'narration', phase: it.phase, text: it.text, next: it.next, features: it.features }); continue; }
      if (sentStructure || outlined.has(it.domain.id)) continue;
      outlined.add(it.domain.id);
      emit({ type: 'outline', domains: [it.domain] });
    }
    // outline: one domain per work/product-tree.d file, until the whole structure has arrived
    const td = listDir(path.join(WORK, 'product-tree.d')).filter((n) => n.endsWith('.json'));
    if (!sentStructure) td.forEach((n, i) => {
      const j = readJson(path.join(WORK, 'product-tree.d', n));
      if (!j) return; // half-written: next tick
      const d = outlineFrom(n, j, i);
      if (outlined.has(d.id)) return;
      outlined.add(d.id);
      emit({ type: 'outline', domains: [d] });
    });
    // the product tree merged into the map: the whole structure, at once
    if (m && m !== mapM && !sentStructure) {
      const p = planNow();
      if (p) {
        mapM = m;
        sentStructure = true;
        const { plan, feats } = p;
        const fOf = (id: string) => feats.get(id) ?? feats.get(id.split(':').pop() ?? '') ?? {};
        emit({
          type: 'structure', wings: plan.wings, rooms: plan.rooms, bays: plan.bays,
          tiles: plan.tiles.map((t) => { const f = fOf(t.id); return { id: t.id, name: t.name, order: t.order, parentId: t.parentId, box: t.box, stage: stageOf(f.stage), kind: f.kind ?? null, tier: f.tier ?? null, summary: f.summary ?? null }; }),
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
    // A file older than the job (a resume, a re-run over a finished onboarding) is content - drawn as it is - but never
    // progress: the judge phase starts on batches or a judgement THIS job wrote, and the final health needs one too.
    const fresh = (dir: string, names: string[]) => names.some((n) => mtime(path.join(dir, n)) >= o.t0);
    const batches = listDir(path.join(WORK, 'batches')).filter((n) => n.endsWith('.json'));
    const judged = listDir(path.join(WORK, 'judgement')).filter((n) => n.endsWith('.json'));
    const judgedNow = fresh(path.join(WORK, 'judgement'), judged);
    // the judge merge is the map written after the newest judgement file
    const lastJudged = Math.max(0, ...judged.map((n) => mtime(path.join(WORK, 'judgement', n))));
    if (batches.length && batches.length !== batchFiles) { batchFiles = batches.length; emit({ type: 'progress', phase: 'judge', n: 0, of: batches.length, detail: null }); }
    if (batches.length && sentHistory && (judgedNow || fresh(path.join(WORK, 'batches'), batches))) { phase('measure', 'done'); phase('judge', 'start'); }
    for (const n of judged) {
      if (judgedDocs.has(n) || sentHealth) continue;
      const j = readJson(path.join(WORK, 'judgement', n));
      if (!j) continue; // half-written: next tick
      judgedDocs.add(n);
      const tiles = provisionalHealth(j);
      emit({ type: 'progress', phase: 'judge', n: judgedDocs.size, of: Math.max(batches.length, judgedDocs.size), detail: `batch ${n.replace(/\.json$/, '')}: ${tiles.length} features` });
      if (tiles.length) emit({ type: 'health', provisional: true, tiles });
    }
    if (!sentHealth && batches.length && judged.length >= batches.length && judgedNow && mtime(mapFile) > lastJudged) finalHealth();
    // register: the product was registered before the job, so the run's last file says it is through (ADOPT.md, the report)
    if (sentHealth && mtime(path.join(LS, 'ADOPT.md')) >= o.t0) phase('register', 'done', o.slug);
  }
  const finalHealth = (): boolean => {
    const p = planNow();
    if (!p) return false;
    sentHealth = true;
    const tiles = p.plan.tiles.map((t) => ({ id: t.id, general: t.general }));
    emit({ type: 'health', provisional: false, tiles });
    phase('judge', 'done', `${tiles.filter((x) => x.general === 'bad').length} in trouble`);
    phase('register', 'start');
    return true;
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  const safePoll = () => { try { poll(); } catch (err) { warnOnce('buildup feed ' + o.id, err); } };
  const feed: Feed = {
    phase,
    tool(name, input) {
      const hits = activityOf(name, input, o.root, (p) => fs.existsSync(path.join(o.root, p)));
      if (hits.length) pendingAct = hits[0];
      flushActivity();
    },
    watch() { if (!timer && !live.ended) { timer = setInterval(safePoll, POLL_MS); timer.unref?.(); safePoll(); } },
    poll() { if (!live.ended) safePoll(); },
    settle(ok, message) {
      if (timer) { clearInterval(timer); timer = null; }
      if (live.ended) return lastPhase(live.events);
      safePoll();
      let at: BuildupPhase;
      if (ok) {
        if (!sentHealth && sentStructure) finalHealth();
        phase('register', 'done', o.slug);
        at = 'register';
        emit({ type: 'done' });
      } else {
        at = lastPhase(live.events);
        emit({ type: 'failed', phase: at, message });
      }
      live.ended = true;
      // late subscribers read the journal from here on; the ones attached keep their stream (pings only)
      FEEDS.delete(o.id);
      return at;
    },
  };
  return { feed, emit };
}
