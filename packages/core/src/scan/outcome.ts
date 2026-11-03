// What accepted work came to on main, by who decided it: the one outcome tally the Trust panel and the decision brief
// read (scan-finding/1's autonomy ladder argues from agreement; this argues from what held). Every outcome is a track's
// stage read through track.ts mainOutcome, never re-judged here:
//   held        a reading after the release (or the landing) meets the expected value
//   short       it falls short
//   unmeasured  no reading since, or only an observation from before
//   no-target   no expected value to judge by
// Only items on main count (released, or accepted and landed per TrackOpts.landed). A judged metric is noisy, so the
// outcomes measured by judgement are counted apart from static and probe ones (the reading's method), and a rate is
// given only from RATE_N measured outcomes; below that, counts alone.
// Deciders: `triaged_by` signs the accept at pack judging, the decision the outcome grades; `decided_by` signs the
// backlog approval that sent it to build (machine:lens-scan under auto-triage), kept as a second grouping. The predictor
// line sets predicted_verdict against the final status and the outcome on main.
// Pure and free of '@/' value imports: Node runs it as-is.
import { sliceOf } from './trust.ts';
import { mainOutcome, trackOf, type MainOutcome, type Track, type TrackOpts } from './track.ts';
import type { Proposal, ProposalStatus, ScanSnapshot } from './types.ts';

type Scan = Pick<ScanSnapshot, 'proposals' | 'measurements' | 'packs' | 'releases'>;

/** The fewest measured outcomes (held + short) a rate is given over. */
export const RATE_N = 10;

export interface Tally {
  held: number;
  short: number;
  unmeasured: number;
  noTarget: number;
  /** Of held and short: those whose reading was taken by judgement (a model's read, noisy). */
  byJudgement: { held: number; short: number };
  /** The short items, so a number opens its list. */
  shortIds: string[];
}
export const emptyTally = (): Tally => ({ held: 0, short: 0, unmeasured: 0, noTarget: 0, byJudgement: { held: 0, short: 0 }, shortIds: [] });
/** Count one track's outcome on main into `t`; false when the track is not on main. */
export function addOutcome(t: Tally, tr: Track): boolean {
  const o = mainOutcome(tr);
  if (!o) return false;
  const j = tr.currentMethod === 'judgement';
  if (o === 'held') { t.held++; if (j) t.byJudgement.held++; }
  else if (o === 'short') { t.short++; t.shortIds.push(tr.id); if (j) t.byJudgement.short++; }
  else if (o === 'unmeasured') t.unmeasured++;
  else t.noTarget++;
  return true;
}
export const measured = (t: Pick<Tally, 'held' | 'short'>): number => t.held + t.short;
export const onMain = (t: Tally): number => t.held + t.short + t.unmeasured + t.noTarget;

/** The share held, by method: judgement apart from static and probe, each only from RATE_N measured outcomes. */
export function ratesOf(t: Tally): { judgement?: number; measured?: number } {
  const j = t.byJudgement, m = { held: t.held - j.held, short: t.short - j.short }, out: { judgement?: number; measured?: number } = {};
  if (measured(j) >= RATE_N) out.judgement = j.held / measured(j);
  if (measured(m) >= RATE_N) out.measured = m.held / measured(m);
  return out;
}

/** One cached track per row, per snapshot and landings (the brief asks for every open row's precedent, the Review for
 *  every open row's record); not cached under pending decisions or jobs. The one way the tallies read a track. */
const TRACKS = new WeakMap<Scan, Map<object | undefined, Map<string, Track | null>>>();
export function trackAt(scan: Scan, id: string, opts: TrackOpts = {}): Track | null {
  if (opts.pending?.size || opts.jobs?.length) return trackOf(scan, id, opts);
  let byLanded = TRACKS.get(scan);
  if (!byLanded) TRACKS.set(scan, (byLanded = new Map()));
  let m = byLanded.get(opts.landed);
  if (!m) { if (byLanded.size > 4) byLanded.clear(); byLanded.set(opts.landed, (m = new Map())); }
  let t = m.get(id);
  if (t === undefined) m.set(id, (t = trackOf(scan, id, opts)));
  return t;
}
/** A row's outcome on main, or null when it is not on main (only accepted and released rows can be). */
export function outcomeAt(scan: Scan, p: Pick<Proposal, 'id' | 'status'>, opts: TrackOpts = {}): { track: Track; outcome: MainOutcome } | null {
  if (p.status !== 'accepted' && p.status !== 'released') return null;
  const track = trackAt(scan, p.id, opts), outcome = track && mainOutcome(track);
  return track && outcome ? { track, outcome } : null;
}

export interface DeciderOutcome { by: string; tally: Tally }
export interface Predictor {
  /** Rows carrying a predicted verdict, of all rows. */
  predicted: number;
  rows: number;
  /** Predicted verdicts by value (accept, reject, defer). */
  verdicts: Record<string, number>;
  /** Predicted accepts whose status is settled (no longer proposed, approved, building or built), and of those the ones
   *  not accepted (descoped, failed, rework, declined), by status. */
  acceptSettled: number;
  notAccepted: Partial<Record<ProposalStatus, number>>;
  notAcceptedIds: string[];
  /** Predicted accepts on main, by outcome. */
  onMain: Tally;
}
export interface OutcomeReport {
  /** By triaged_by: who accepted it at pack judging. Most items on main first. */
  accepted: DeciderOutcome[];
  /** By decided_by: who approved it for building. */
  approved: DeciderOutcome[];
  /** By slice (trust.ts sliceOf). */
  slices: Map<string, Tally>;
  all: Tally;
  predictor: Predictor;
}

const UNSIGNED = 'unsigned';
const OPEN: ReadonlySet<ProposalStatus> = new Set(['proposed', 'approved', 'executing', 'done']);
const ACCEPTED: ReadonlySet<ProposalStatus> = new Set(['accepted', 'released']);

/** The outcome report over a product's store: every item on main, tallied by decider, by slice and in all, and the
 *  predictor's calls against what happened. */
export function outcomeOf(scan: Scan, opts: TrackOpts = {}): OutcomeReport {
  const acc = new Map<string, Tally>(), appr = new Map<string, Tally>(), slices = new Map<string, Tally>(), all = emptyTally();
  const at = <K>(m: Map<K, Tally>, k: K) => { let t = m.get(k); if (!t) m.set(k, (t = emptyTally())); return t; };
  const pr: Predictor = { predicted: 0, rows: scan.proposals.length, verdicts: {}, acceptSettled: 0, notAccepted: {}, notAcceptedIds: [], onMain: emptyTally() };
  for (const p of scan.proposals) {
    const o = outcomeAt(scan, p, opts);
    if (o) {
      for (const t of [all, at(acc, p.triaged_by ?? UNSIGNED), at(appr, p.decided_by ?? UNSIGNED), at(slices, sliceOf(p))]) addOutcome(t, o.track);
      if (p.predicted_verdict === 'accept') addOutcome(pr.onMain, o.track);
    }
    if (!p.predicted_verdict) continue;
    pr.predicted++;
    pr.verdicts[p.predicted_verdict] = (pr.verdicts[p.predicted_verdict] ?? 0) + 1;
    if (p.predicted_verdict !== 'accept' || OPEN.has(p.status)) continue;
    pr.acceptSettled++;
    if (!ACCEPTED.has(p.status)) { pr.notAccepted[p.status] = (pr.notAccepted[p.status] ?? 0) + 1; pr.notAcceptedIds.push(p.id); }
  }
  const list = (m: Map<string, Tally>) => [...m].map(([by, tally]) => ({ by, tally })).sort((a, b) => onMain(b.tally) - onMain(a.tally) || (a.by < b.by ? -1 : 1));
  return { accepted: list(acc), approved: list(appr), slices, all, predictor: pr };
}

const pct = (x: number) => Math.round(x * 100) + '%';
/** A tally in words: "14 held · 6 short (5 by judgement) · 7 not measured since", zero terms left out; a rate per method
 *  only from RATE_N measured ("judgement 74% held"). Nothing on main: "nothing on main yet". `sep` joins the terms;
 *  `terse` (the brief's 120-character line) says "unmeasured" and "judged" for "by judgement". */
export function tallyWords(t: Tally, sep = ' · ', terse = false): string {
  if (!onMain(t)) return 'nothing on main yet';
  const j = measured(t.byJudgement), r = ratesOf(t), out: string[] = [];
  if (t.held) out.push(t.held + ' held');
  if (t.short) out.push(t.short + ' short');
  const by = terse ? 'judged' : 'by judgement';
  const m = out.join(sep) + (j && measured(t) ? (j === measured(t) ? (terse ? ' (judged)' : ' (all by judgement)') : ` (${j} ${by})`) : '');
  const parts = m ? [m] : [];
  if (t.unmeasured) parts.push(t.unmeasured + (terse ? ' unmeasured' : ' not measured since'));
  if (t.noTarget) parts.push(t.noTarget + ' no expected value');
  const rate = [r.measured !== undefined ? 'static/probe ' + pct(r.measured) + ' held' : '', r.judgement !== undefined ? 'judgement ' + pct(r.judgement) + ' held' : ''].filter(Boolean).join(', ');
  return parts.join(sep) + (rate ? sep + rate : '');
}

/** The predictor line: "Predicted accept on 49 of 49 predicted rows; 6 of those were not accepted (3 descoped, 2 failed,
 *  1 rework); on main 20 held · 7 short". Null when no row carries a prediction. */
export function predictorWords(p: Predictor): string | null {
  if (!p.predicted) return null;
  const a = p.verdicts.accept ?? 0, not = p.notAcceptedIds.length;
  const why = Object.entries(p.notAccepted).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0)).map(([s, n]) => n + ' ' + s).join(', ');
  const others = Object.entries(p.verdicts).filter(([v]) => v !== 'accept').map(([v, n]) => n + ' ' + v).join(', ');
  return `Predicted accept on ${a} of ${p.predicted} predicted rows${others ? ' (' + others + ')' : ''}` + (a ? `; ${not} of the ${p.acceptSettled} settled were not accepted${why ? ' (' + why + ')' : ''}` : '')
    + (onMain(p.onMain) ? '; on main: ' + tallyWords(p.onMain) : '');
}
