// The sample stand-up for the headset with no PC (night two W2b, "Morning at the desk"; called by bundle-data.mjs for Kettle).
// The competition's judges run the standalone APK, so the whole morning ritual must also run from the bundle, on sample data,
// saying plainly that it is a sample. This writes <bundle>/morning.json: GET /api/companion/morning's answer (morning-deck-1),
// built by core's own buildDeck (packages/core/src/companion/morning.ts, the function the server's route calls) over a SCRATCH
// copy of the bundled Kettle scan with a labelled synthetic night on top, the way scripts/morning-demo.mjs seeds its stores:
//   - three open findings that have a bundled "before" screen (scan.json's Shot rows, shots/finding-<id>.png) are raised
//     overnight with tiers (stop-ship, then two before production), so they are the morning's three decisions;
//   - three findings that were being built finish overnight and one fails, so the deck opens with what agents built.
// Nothing reads or writes a real store: the copy lives in memory, and the night's rows are only in morning.json. The deck's
// briefs are cardBrief's over the bundled structure (the same lines the web's Morning Watch shows). Brand words are reworded
// like every bundled file (bundle-words.mjs).
//
//   node --import @bp/core/register apps/vr/tools/bundle-morning.ts --dir apps/vr/Content/BpData/kettle [--now <iso>]
// Exit 0 written, 1 refused (a part of the bundle is missing, or a picked finding is not open or has no screen).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeck, type ProductFacts, type Where } from '../../../packages/core/src/companion/morning.ts';
import { briefMapOfStructure } from '../../../packages/core/src/scan/brief.ts';
import { loadMap } from '../../../packages/core/src/data/index.ts';
import type { Proposal, ScanSnapshot } from '../../../packages/core/src/scan/types.ts';
// @ts-expect-error: a plain .mjs module (bundle-words.mjs) with no declarations
import { neutralize } from './bundle-words.mjs';

/** The night, by id: the three decisions (tier, risk class, hours before `now` it was raised) and the builds. */
export const SAMPLE_NIGHT = {
  decisions: [
    { id: 'kf-053', tier: 0 as const, risk_class: 'security', raisedH: 6 },
    { id: 'kf-024', tier: 1 as const, risk_class: 'reliability', raisedH: 4 },
    { id: 'kf-020', tier: 1 as const, risk_class: 'ux', raisedH: 3 },
  ],
  built: [{ id: 'kf-005', hoursAgo: 7 }, { id: 'kf-013', hoursAgo: 5 }, { id: 'kf-036', hoursAgo: 2 }],
  failed: [{ id: 'kf-057', hoursAgo: 3 }],
};
const NOTE = 'sample: a synthetic night on the bundled Kettle sample (bundle-morning.ts)';
/** The window the sample covers: the server's own default (morning.server.ts WINDOW_MS), the last 16 hours. */
const WINDOW_MS = 16 * 3600e3;

export function sampleMorning(dir: string, now: number): { deck: unknown; problems: string[] } {
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const problems: string[] = [];
  const env = read('structure.json'), plan = read('plan.json'), scan = structuredClone(read('scan.json')) as ScanSnapshot & { shots?: { proposal_id?: string; phase?: string; path?: string }[] };
  const iso = (ms: number) => new Date(ms).toISOString(), H = 3600e3;
  const byId = new Map(scan.proposals.map((p) => [p.id, p] as const));
  for (const d of SAMPLE_NIGHT.decisions) {
    const p = byId.get(d.id) as (Proposal & { tier?: number; risk_class?: string }) | undefined;
    if (!p || p.status !== 'proposed') { problems.push(`${d.id} is not an open finding in scan.json`); continue; }
    if (!(scan.shots ?? []).some((s) => s.proposal_id === d.id && s.phase === 'before' && /^[\w.-]+\.png$/.test(s.path ?? '') && fs.existsSync(path.join(dir, 'shots', s.path!)))) problems.push(`${d.id} has no bundled before screen`);
    Object.assign(p, { tier: d.tier, risk_class: d.risk_class, created_at: iso(now - d.raisedH * H), updated_at: iso(now - d.raisedH * H) });
  }
  for (const [list, status] of [[SAMPLE_NIGHT.built, 'done'], [SAMPLE_NIGHT.failed, 'failed']] as const) {
    for (const b of list) {
      const p = byId.get(b.id);
      if (!p) { problems.push(`${b.id} is not in scan.json`); continue; }
      Object.assign(p, { status, updated_at: iso(now - b.hoursAgo * H) });
    }
  }
  // Every other open finding keeps its age (raised weeks ago) and no tier, so it ranks after the night's three.
  const where = new Map<string, Where>();
  const wings = new Map(plan.wings.map((w: { id: string }) => [w.id, w])), rooms = new Map(plan.rooms.map((r: { id: string }) => [r.id, r])), bays = new Map(plan.bays.map((b: { id: string }) => [b.id, b]));
  for (const t of plan.tiles as { id: string; name: string; parentId: string }[]) {
    const room = rooms.get((bays.get(t.parentId) as { parentId?: string } | undefined)?.parentId ?? '') as { id: string; name: string; parentId: string } | undefined;
    const wing = room ? wings.get(room.parentId) as { id: string; name: string } | undefined : undefined;
    if (room && wing) where.set(t.id, { room: room.id, roomName: room.name, wing: wing.id, wingName: wing.name, name: t.name });
  }
  const labels = new Map<string, string>();
  for (const l of env.structure.lenses ?? []) for (const f of l.manifest?.fields ?? []) if (l.id && f.key && f.label) labels.set(`${l.id}|${f.key}`, f.label);
  const facts: ProductFacts = { slug: 'kettle', name: env.structure.project?.name ?? 'Kettle', scan, where, labels, map: briefMapOfStructure(loadMap(env.structure, env.events ?? null)) };
  const deck = buildDeck([facts], [], iso(now - WINDOW_MS), now);
  const decisions = deck.cards.filter((c) => c.kind === 'decision').map((c) => c.decision?.proposal);
  const want = SAMPLE_NIGHT.decisions.map((d) => d.id);
  if (decisions.join() !== want.join()) problems.push(`the deck's decisions are ${decisions.join(', ')}, not ${want.join(', ')}`);
  // The close card's lines are the headset's own (what was decided on it, kept for the day): the sample sends nothing.
  const close = deck.cards.find((c) => c.kind === 'close');
  if (close) close.lines = [{ text: 'Sample: nothing was sent. What you decide here is kept on this headset for the day.' }];
  return { deck: { ...deck, sample: NOTE }, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const dir = path.resolve(opt('--dir') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Content', 'BpData', 'kettle'));
  const now = opt('--now') ? Date.parse(opt('--now')!) : Date.now();
  if (!Number.isFinite(now)) { console.log('REFUSED: --now is not an ISO instant'); process.exit(1); }
  for (const f of ['structure.json', 'plan.json', 'scan.json']) if (!fs.existsSync(path.join(dir, f))) { console.log(`REFUSED: no ${f} in ${dir}`); process.exit(1); }
  const { deck, problems } = sampleMorning(dir, now);
  if (problems.length) { console.log(`REFUSED: ${problems.join('; ')}`); process.exit(1); }
  const text = neutralize(JSON.stringify(deck));
  fs.writeFileSync(path.join(dir, 'morning.json'), text);
  const d = deck as { cards: { kind: string; headline: string }[] };
  console.log(`ok    the sample morning -> ${path.relative(process.cwd(), path.join(dir, 'morning.json')).replace(/\\/g, '/')} (${(text.length / 1024).toFixed(1)} KB, ${d.cards.length} cards: ${d.cards.map((c) => c.kind).join(', ')})`);
}
