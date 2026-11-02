// Replay a tape recorded by onboard-live.ts as a live build-up feed, at the run's real timing (or --speed N), so any
// variant can be shown any recorded onboarding without paying for a new one. Same endpoints as the live harness:
// /events (SSE, catch-up from begin) and /status ({done, events, t}). The clock starts at the first /events connection.
//
//   node --import @bp/core/register scripts/buildup/replay-tape.ts --tape <run.tape.jsonl>
//        [--port 3301] [--speed 1] [--docs <docs.json>] [--root <repo>] [--dump <events.json>] [--hold-min 10]
//
// A tape that carries `doc` records (onboard-live.ts since the anti-stale events) already holds every event and is
// replayed as recorded. An OLDER tape (no `doc` records) is enriched with the anti-stale events, re-derived from what
// it kept, and the replay says so on stdout:
//   survey    from --docs: {"contextMap", "supplement", "inventory"} rebuilt from the repo at the run's commit
//             (adopt.mjs supplement + seed in a throwaway clone), sent when the run wrote those two files. The real run's
//             supplement had LLM-chosen names; the rebuilt one names areas by folder.
//   outline   at each work/product-tree.d file the tape saw, with names and capabilities read from the later structure.
//   activity  from the agent's recorded tool calls (inputs cut at 300 chars), at most one a second.
//   progress  from the batch and judgement-file counts.
//   health    provisional per judgement file: the FINAL readings split into batches of 8 in plan order (the tape does
//             not keep which feature was in which batch), then the final reading as recorded.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { activityOf, areaOf, outlineFrom, surveyFrom, type AreaIndex } from './derive';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const TAPE = path.resolve(opt('tape') ?? '');
const PORT = Number(opt('port', '3301'));
const SPEED = Number(opt('speed', '1'));
const DOCS = opt('docs');
const DUMP = opt('dump');
const HOLD_MIN = Number(opt('hold-min', '10'));

type Ev = Record<string, unknown> & { type: string; at: number };
interface Rec { t: number; raw?: string; data?: unknown; event?: Ev }
const recs: Rec[] = fs.readFileSync(TAPE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec);
const recorded = recs.filter((r) => r.event).map((r) => r.event as Ev);
const ROOT = opt('root') ?? null;

function enrich(): Ev[] {
  const out: Ev[] = recorded.filter((e) => e.type !== 'health').map((e) => ({ ...e }));
  const push = (e: Ev) => out.push(e);
  const at = (raw: string, pred: (d: unknown) => boolean = () => true) => recs.find((r) => r.raw === raw && pred(r.data))?.t ?? null;

  // survey
  let areas: AreaIndex[] = [];
  if (DOCS) {
    const d = JSON.parse(fs.readFileSync(DOCS, 'utf8')) as { contextMap?: unknown; supplement?: unknown; inventory?: unknown };
    const tSup = at('file', (x) => (x as { path: string }).path === 'work/context-supplement.json');
    const tInv = at('file', (x) => (x as { path: string }).path === 'work/inventory.json');
    if (tSup !== null) push({ type: 'survey', at: tSup, areas: surveyFrom(d.contextMap, d.supplement, null).map((a) => a.area) });
    areas = surveyFrom(d.contextMap, d.supplement, d.inventory);
    if (tInv !== null) push({ type: 'survey', at: tInv, areas: areas.map((a) => a.area) });
  } else console.log('no --docs: survey left out');

  // outline, from the later structure
  const st = recorded.find((e) => e.type === 'structure') as (Ev & { wings: { id: string; name: string }[]; rooms: { id: string; name: string; parentId: string; order: number }[] }) | undefined;
  const seenFiles = new Set<string>();
  for (const r of recs.filter((x) => x.raw === 'tree-domain-files')) {
    (r.data as string[]).forEach((n, i) => {
      if (seenFiles.has(n)) return; seenFiles.add(n);
      const slug = n.replace(/\.json$/, '').replace(/^\d+[-_]?/, '');
      const w = st?.wings.find((x) => x.id === `0:${slug}`);
      const doc = w ? { slug, name: w.name, capabilities: st!.rooms.filter((x) => x.parentId === w.id).sort((a, b) => a.order - b.order).map((x) => ({ slug: x.id, name: x.name })) } : { slug };
      push({ type: 'outline', at: r.t, domains: [outlineFrom(n, doc, i)] });
    });
  }

  // activity, one a second at most, from the root the tools ran in
  const root = ROOT ?? guessRoot();
  let last = -1000;
  for (const r of recs.filter((x) => x.raw === 'tool')) {
    if (r.t - last < 1000) continue;
    const d = r.data as { name: string; input: string };
    let input: unknown; try { input = JSON.parse(d.input); } catch { input = salvage(d.input); }
    const hit = root ? activityOf(d.name, input, root, (p) => fs.existsSync(path.join(root, p)))[0] : undefined;
    if (!hit) continue;
    last = r.t;
    push({ type: 'activity', at: r.t, verb: hit.verb, path: hit.path, area: areaOf(hit.path, areas) });
  }

  // progress and provisional health
  const finalHealth = recorded.filter((e) => e.type === 'health') as (Ev & { tiles: { id: string; general: string }[] })[];
  const tiles = finalHealth.flatMap((e) => e.tiles);
  const nb = (recs.find((x) => x.raw === 'batches')?.data as number | undefined) ?? Math.ceil(tiles.length / 8);
  const tb = at('batches');
  if (tb !== null) push({ type: 'progress', at: tb, phase: 'judge', n: 0, of: nb, detail: null });
  const jf = recs.filter((x) => x.raw === 'judgement-files');
  jf.forEach((r, k) => {
    const n = (r.data as { n: number }).n;
    const batch = tiles.slice(k * 8, k * 8 + 8);
    push({ type: 'progress', at: r.t, phase: 'judge', n, of: nb, detail: `${batch.length} features judged` });
    if (batch.length) push({ type: 'health', at: r.t, provisional: true, tiles: batch });
  });
  if (finalHealth.length) push({ type: 'health', at: finalHealth[0].at, provisional: false, tiles });
  return out.sort((a, b) => a.at - b.at || rank(a) - rank(b));
}
// at equal times: begin first, done/failed last, phases before the data they announce
const rank = (e: Ev) => (e.type === 'begin' ? 0 : e.type === 'done' || e.type === 'failed' ? 9 : e.type === 'phase' ? 1 : 5);
// tool inputs were cut at 300 chars: recover the fields activityOf needs from the cut JSON text
function salvage(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of ['file_path', 'path', 'command']) { const m = new RegExp(`"${k}":"((?:[^"\\\\]|\\\\.)*)`).exec(s); if (m) { try { o[k] = JSON.parse(`"${m[1].replace(/\\$/, '')}"`); } catch { o[k] = m[1]; } } }
  return o;
}
function guessRoot(): string | null {
  for (const r of recs.filter((x) => x.raw === 'tool')) {
    const m = /cd ((?:\/[a-z]|[A-Z]:)\/[^;&|"\\ ]+)/.exec((r.data as { input: string }).input);
    if (m) return m[1].replace(/^\/([a-z])\//, (_, d: string) => `${d.toUpperCase()}:/`).replace(/\/(forge|skill|tools|docs).*$/, '');
  }
  return null;
}

const enriched = recs.some((r) => r.raw === 'doc');
const events = (enriched ? recorded.map((e) => (e.type === 'health' && !('provisional' in e) ? { ...e, provisional: false } : e)) : enrich());
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(events, null, 1));
const count = (t: string) => events.filter((e) => e.type === t).length;
console.log(`${enriched ? 'recorded' : 're-derived'} feed from ${path.basename(TAPE)}: ${events.length} events (survey ${count('survey')}, outline ${count('outline')}, activity ${count('activity')}, progress ${count('progress')}, health ${count('health')}), ${(events.at(-1)!.at / 60000).toFixed(1)} min at 1x, speed ${SPEED}`);

// ------------------------------------------------------------------ the feed
const clients = new Set<http.ServerResponse>();
let t0 = 0, sent = 0, finished = false;
const elapsed = () => (t0 ? (Date.now() - t0) * SPEED : 0);
const line = (e: Ev) => `data: ${JSON.stringify(e)}\n\n`;
function tick() {
  while (sent < events.length && events[sent].at <= elapsed()) { const l = line(events[sent++]); for (const c of clients) c.write(l); }
  if (sent >= events.length && !finished) { finished = true; console.log(`replay finished after ${((Date.now() - t0) / 60000).toFixed(1)} min; holding ${HOLD_MIN} min`); setTimeout(() => process.exit(0), HOLD_MIN * 60000); }
}
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url?.startsWith('/events')) {
    if (!t0) { t0 = Date.now(); setInterval(tick, 100); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for (let i = 0; i < sent; i++) res.write(line(events[i]));
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url?.startsWith('/status')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ done: finished, events: sent, t: Math.round(elapsed()) })); return; }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`replay on http://127.0.0.1:${PORT}/events (clock starts at the first connection)`));
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000).unref();
