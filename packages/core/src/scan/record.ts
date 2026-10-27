// What earlier decisions came to, for the reviewer of an open proposal ("Before you decide", docs/blueprint-ui.md):
//   same - the decided rows on the same feature + lens, and every row on its attempt_of / parent_id chain, with their
//          stage, date, decider and note (the decline note or the triage note), newest first;
//   lens - how the lens's decided rows stand: released ones confirmed / not confirmed / unknown, and failed, rework,
//          declined, over the WHOLE history (tracksOf keeps 14 days for the tiles; a record needs them all).
// Stages are read through trackOf, never re-derived, so its honesty rules hold here too: `unknown` is never good, a
// branch reading is not the product, and only `confirmed` + `not confirmed` are judged. The lens is a key into the
// rows, never a branch on its id. Pure and free of '@/' value imports: Node runs it as-is.
import { trackOf, type Track, type TrackOpts, type TrackStage } from './track.ts';
import type { Proposal, ScanSnapshot } from './types.ts';

type Scan = Pick<ScanSnapshot, 'proposals' | 'measurements' | 'packs' | 'releases'>;

export interface PriorEntry {
  id: string;
  stage: TrackStage;
  /** The day it was decided (a triaged row: the day of its triage). */
  at: string;
  by?: string;
  note?: string;
}
export interface LensRecord {
  /** Decided rows under the lens (this proposal excluded). */
  n: number;
  released: number;
  /** confirmed + notConfirmed: the released rows a reading after the release has judged. */
  judged: number;
  confirmed: number;
  notConfirmed: number;
  unknown: number;
  failed: number;
  rework: number;
  declined: number;
  /** The oldest decision counted. */
  since?: string;
}
export interface PriorRecord { same: PriorEntry[]; lens: LensRecord }

const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');
const decided = (p: Proposal) => p.status !== 'proposed';
const when = (p: Proposal) => p.triaged_at ?? p.decided_at ?? p.updated_at;

/** trackOf once per row per snapshot (the Review list asks for every open row's record); not cached under pending decisions or jobs. */
const TRACKS = new WeakMap<Scan, Map<string, Track | null>>();
function track(scan: Scan, id: string, opts: TrackOpts): Track | null {
  if (opts.pending?.size || opts.jobs?.length) return trackOf(scan, id, opts);
  let m = TRACKS.get(scan);
  if (!m) TRACKS.set(scan, (m = new Map()));
  let t = m.get(id);
  if (t === undefined) m.set(id, (t = trackOf(scan, id, opts)));
  return t;
}

function entry(scan: Scan, p: Proposal, opts: TrackOpts): PriorEntry | null {
  const t = track(scan, p.id, opts);
  if (!t) return null;
  const e: PriorEntry = { id: p.id, stage: t.stage, at: day(when(p)) };
  if (p.decided_by) e.by = p.decided_by;
  const note = (p.status === 'declined' ? p.decision_note : p.triage_note ?? p.decision_note)?.trim();
  if (note) e.note = note;
  return e;
}

/** The record before deciding `p`: earlier decisions on the same idea, and the lens's realised outcomes. */
export function priorRecord(scan: Scan, p: Proposal, opts: TrackOpts = {}): PriorRecord {
  const byId = new Map(scan.proposals.map((x) => [x.id, x]));
  // the chain this row follows: its earlier attempts (attempt_of) and the upgrade that spawned it (parent_id), transitively
  const chain = new Set<string>(), todo = [p.attempt_of, p.parent_id];
  while (todo.length) {
    const x = byId.get(todo.pop() ?? '');
    if (!x || x.id === p.id || chain.has(x.id)) continue;
    chain.add(x.id); todo.push(x.attempt_of, x.parent_id);
  }
  const rows = scan.proposals.filter((x) => x.id !== p.id && decided(x) && ((x.feature === p.feature && x.lens === p.lens) || chain.has(x.id)));
  const same = rows.map((x) => entry(scan, x, opts)).filter((e): e is PriorEntry => !!e)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));

  const lens: LensRecord = { n: 0, released: 0, judged: 0, confirmed: 0, notConfirmed: 0, unknown: 0, failed: 0, rework: 0, declined: 0 };
  for (const x of scan.proposals) {
    if (x.id === p.id || x.lens !== p.lens || !decided(x)) continue;
    const t = track(scan, x.id, opts);
    if (!t) continue;
    lens.n++;
    const d = day(x.decided_at ?? x.updated_at);
    if (!lens.since || d < lens.since) lens.since = d;
    if (x.status === 'released') lens.released++;
    switch (t.stage) {
      case 'confirmed': lens.confirmed++; lens.judged++; break;
      case 'not-confirmed': lens.notConfirmed++; lens.judged++; break;
      case 'unknown': if (x.status === 'released') lens.unknown++; break;
      case 'failed': lens.failed++; break;
      case 'rework': lens.rework++; break;
      case 'declined': lens.declined++; break;
    }
  }
  return { same, lens };
}

/** A stage in words when the caller has none of its own (the web passes TrackRecord's STAGE_WORDS). */
const plain = (s: TrackStage) => s.replace('-', ' ');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The record in sentences: one per earlier row ("Declined 2026-10-01 by blueprint: touches checkout"), and the lens line
 *  ("Performance: 3 confirmed, 1 not confirmed, 2 unknown of 6 released since 2026-08-12"). Zero terms are left out, so
 *  an unknown outcome is never worded as confirmed. */
export function recordWords(r: PriorRecord, lensName: string, words: (s: TrackStage) => string = plain): { same: string[]; lens: string } {
  const same = r.same.map((e) => cap(words(e.stage)) + ' ' + e.at + (e.by ? ' by ' + e.by : '') + (e.note ? ': ' + e.note : ''));
  const L = r.lens;
  if (!L.n) return { same, lens: 'No earlier decision under this lens' };
  const terms = (xs: [number, string][]) => xs.filter(([n]) => n > 0).map(([n, w]) => n + ' ' + w).join(', ');
  const out = terms([[L.confirmed, 'confirmed'], [L.notConfirmed, 'not confirmed'], [L.unknown, 'unknown']]);
  const rest = terms([[L.declined, 'declined'], [L.failed, 'failed to build'], [L.rework, 'sent back for rework']]);
  const head = L.released ? out + ' of ' + L.released + ' released' : 'none of ' + L.n + ' decided released yet';
  return { same, lens: lensName + ': ' + head + (L.since ? ' since ' + L.since : '') + (rest ? '; ' + rest : '') };
}
