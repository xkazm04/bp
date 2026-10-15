// Kettle's sample release train, the scan sim's half that stands in for lens-scan's v2 store and its release run: three
// sample packs over real Kettle features (k-des-1 with a moved, a flat, a worse, a failed and a reworked item; k-des-2,
// the rework's rebuild; k-perf-1, two probe items with three baseline runs each), their phased readings, screenshots
// (public/sample-shots, scripts/gen-sample-shots.mjs draws them from SAMPLE_ITEMS) and commits, then triage, releases and
// the release job's steps with the answers and refusals of the routes and store.mjs (triage, release-create/-add,
// release-update). Everything it writes says "sample". ScanSim owns the tables it shares (runs, measurements, activity,
// proposals) and the timer; this module owns packs, releases and shots. Pure and free of '@/' value imports, so Node
// can drive it (scripts/check-train-sim.ts).
import type { Activity, ActivityKind, CommitDiff, Measurement, Pack, Proposal, ProposalStatus, Release, ReleaseCreated, Run, Shot, TriageBody, TriageDecision, TriageResult, VersionSuggestion } from '@/lib/scan/types';
import type { ReleaseStep, ScanJob } from '@/lib/scan/jobs';
import type { LensField } from '@/lib/standard/types';
import { SAFE_ID } from '../scan/jobs.ts';
import { RELEASE_ID, bump, bumpOf, isVersion } from '../scan/release.ts';
import { verdictOf, type LensFields } from '../scan/compare.ts';
import { isFlagged } from '../train/rules.ts';

/** Kettle only: what the sample release job runs into. */
export interface TrainToggles { ghOff: boolean; conflict: boolean; gateFails: boolean }

/** What the train needs of the scan sim: its clock, the tables it shares (mutated in place), id counters and notify. */
export interface TrainHost {
  now(): number;
  runs: Run[];
  ms: Measurement[];
  act: Activity[];
  props: Proposal[];
  /** Proposal id -> index in `props`. */
  pAt: Map<string, number>;
  nextMeasurement(): number;
  nextActivity(): number;
  /** A lens field of the bound product (enabled or not), for units and directions. */
  field(lens: string, key: string): LensField | undefined;
  /** Notify once for this turn's changes. */
  changed(): void;
}

// ------------------------------------------------------------------------------------------- the sample
/** A sample screen: panels of 14-16 px text, and what the item's after adds (absent = the pair is identical). */
export interface SampleScreen {
  panels: { title: string; lines: string[]; button?: string }[];
  change?: { kind: 'banner'; at: number; place: 'top' | 'bottom'; text: string; action: string } | { kind: 'reason'; at: number; text: string };
}
export interface SampleItem {
  key: string;
  pack: string;
  feature: string;
  /** The feature's name in the Kettle map (the screen's header). */
  name: string;
  lens: string;
  metric: string;
  title: string;
  summary: string;
  standard: string;
  delta: number;
  size: Proposal['size'];
  risk: number;
  status: 'done' | 'failed' | 'rework';
  /** One value per baseline run (the last is the verdict's), then the after. */
  before: number[];
  after: number;
  evidence: [before: string, after: string];
  files: string[];
  patch: 'state' | 'defer';
  /** What the change shows a person (the patch's text). */
  ui: { text: string; action?: string };
  /** Absent: the harness cannot render this feature, no shots. */
  screen?: SampleScreen;
  /** Context readings at the base (a probe item's other metrics). */
  context?: Record<string, number>;
  /** A failed item: the gate that broke. A rework item: the person's note. A rebuild: the item it rebuilds. */
  gate?: string;
  note?: string;
  attemptOf?: string;
}

const KIOSK_NOTE = 'The banner covers the top of the scanner, so a member cannot see their QR code. Put the offline note under the scanner and keep Retry within reach on the 1080p kiosk.';
const KIOSK: SampleScreen['panels'] = [
  { title: 'Scan your pass', lines: ['Hold the QR code up to the camera', 'Or type your member number'], button: 'Type number' },
  { title: 'Next class', lines: ['Spin 45 · 09:30 · room 1', '12 of 20 checked in'] },
  { title: 'Front desk', lines: ['Ask a coach if your pass will not scan', 'Guest passes are sold at the desk'] },
];

/** The sample items, in build order. scripts/gen-sample-shots.mjs draws `screen` for each (light and dark, before and after). */
export const SAMPLE_ITEMS: readonly SampleItem[] = [
  { key: 'des1-booking', pack: 'k-des-1', feature: 'book-a-class', name: 'Book a class', lens: 'design', metric: 'undesignedStates',
    title: 'Show a refused booking in the class sheet with a retry', summary: 'A refused booking closes the class sheet without a word. Show the reason in the sheet, with a way to try again.',
    standard: 'async-ui-states/failure-states', delta: -1, size: 'S', risk: 2, status: 'done', before: [3], after: 2,
    evidence: ['undesigned states, among them a refused booking that closes the sheet silently and a slow booking with no progress', 'the refused booking keeps the sheet open with its reason and Try again; the slow booking is still open'],
    files: ['src/features/book-a-class/ClassSheet.tsx', 'src/features/book-a-class/useBooking.ts', 'src/features/book-a-class/ClassSheet.test.tsx'], patch: 'state',
    ui: { text: 'We could not book this class. No credit was used.', action: 'Try again' },
    screen: { panels: [{ title: 'Vinyasa Flow · 18:00', lines: ['Riverside studio, room 2', 'Instructor: Mara Lind', '9 of 14 spots left'], button: 'Book this class' },
      { title: 'Your plan', lines: ['Class pack: 6 credits left', 'This class costs 1 credit'] }, { title: 'This week', lines: ['Mon  Yin Yoga 07:00', 'Wed  Pilates Core 12:15', 'Fri  Vinyasa Flow 18:00'] }],
    change: { kind: 'banner', at: 0, place: 'bottom', text: 'We could not book this class. No credit was used.', action: 'Try again' } } },
  { key: 'des1-waitlist', pack: 'k-des-1', feature: 'waitlist-with-auto-promote', name: 'Waitlist with auto-promote', lens: 'design', metric: 'undesignedStates',
    title: 'Say why Join waitlist is unavailable', summary: 'Join waitlist turns grey with no reason once the waitlist is full. Say why next to the button.',
    standard: 'async-ui-states/disabled-reasons', delta: -1, size: 'XS', risk: 1, status: 'done', before: [2], after: 2,
    evidence: ['undesigned states, among them a full waitlist that greys the button with no reason', 'the reason renders only when the waitlist is full, a state the default screen never reaches; the count is unchanged'],
    files: ['src/features/waitlist/WaitlistButton.tsx', 'src/features/waitlist/WaitlistButton.test.tsx'], patch: 'state',
    ui: { text: 'The waitlist is full (10 of 10). Try a later class.' },
    screen: { panels: [{ title: 'Pilates Core · 12:15', lines: ['Riverside studio, room 1', 'Class is full', '3 people on the waitlist'], button: 'Join waitlist' },
      { title: 'How the waitlist works', lines: ['A free spot goes to the first person waiting', 'You are booked and told by email'] }] } },
  { key: 'des1-card', pack: 'k-des-1', feature: 'card-payments', name: 'Card payments', lens: 'design', metric: 'undesignedStates',
    title: 'Show a declined card with a way to fix it', summary: 'A declined card clears the form and starts over. Keep what was typed and say what to fix.',
    standard: 'async-ui-states/failure-states', delta: -1, size: 'M', risk: 3, status: 'done', before: [2], after: 3,
    evidence: ['undesigned states, among them a declined card that clears the form', 'the declined card keeps the form and names the field, but the new disabled Pay adds a slow-authorisation state nobody designed: one more'],
    files: ['src/features/card-payments/PayButton.tsx', 'src/features/card-payments/CardForm.tsx', 'src/features/card-payments/card-errors.ts', 'src/features/card-payments/CardForm.test.tsx'], patch: 'state',
    ui: { text: 'Enter the CVC on the back of the card to pay.' },
    screen: { panels: [{ title: 'Pay for Class pack · 10', lines: ['Card ending 4242', 'Expires 08/28'], button: 'Pay €120.00' },
      { title: 'Order', lines: ['Class pack · 10 credits', 'Valid 6 months · VAT included'] }],
    change: { kind: 'reason', at: 0, text: 'Enter the CVC on the back of the card to pay.' } } },
  { key: 'des1-waiver', pack: 'k-des-1', feature: 'digital-waiver-signing', name: 'Digital waiver signing', lens: 'design', metric: 'undesignedStates',
    title: 'Show a refused waiver signature inline', summary: 'A signature the server refuses clears the pad and says nothing. Keep the stroke and say why, with a way to sign again.',
    standard: 'async-ui-states/failure-states', delta: -1, size: 'S', risk: 2, status: 'failed', before: [2], after: 1,
    evidence: ['undesigned states, among them a refused signature that clears the pad silently', 'the refused signature shows its reason inline; gate failed: vitest SignaturePad.test.tsx (2 of 11 failing: Sign again keeps the old stroke)'],
    files: ['src/features/waiver/SignaturePad.tsx', 'src/features/waiver/SignaturePad.test.tsx', 'src/features/waiver/waiver.css'], patch: 'state',
    ui: { text: 'Your signature did not save. Sign again to finish.', action: 'Sign again' },
    gate: 'vitest src/features/waiver/SignaturePad.test.tsx (2 of 11 failing: Sign again keeps the old stroke)' },
  { key: 'des1-kiosk', pack: 'k-des-1', feature: 'front-desk-check-in-kiosk', name: 'Front-desk check-in kiosk', lens: 'design', metric: 'undesignedStates',
    title: 'Design the kiosk\'s offline state', summary: 'Offline, the kiosk keeps scanning and drops every check-in. Say it is offline and keep the check-ins for later.',
    standard: 'async-ui-states/offline-states', delta: -1, size: 'M', risk: 3, status: 'rework', before: [2], after: 1,
    evidence: ['undesigned states, among them offline dropping check-ins silently', 'offline shows a banner and keeps check-ins; the other-studio pass is still open'],
    files: ['src/features/kiosk/KioskScanner.tsx', 'src/features/kiosk/OfflineNote.tsx', 'src/features/kiosk/KioskScanner.test.tsx'], patch: 'state',
    ui: { text: 'Offline: check-ins are kept and sent when the kiosk reconnects.', action: 'Retry now' },
    screen: { panels: KIOSK, change: { kind: 'banner', at: 0, place: 'top', text: 'Offline: check-ins are kept and sent when the kiosk reconnects.', action: 'Retry now' } },
    note: KIOSK_NOTE },
  { key: 'des2-kiosk', pack: 'k-des-2', feature: 'front-desk-check-in-kiosk', name: 'Front-desk check-in kiosk', lens: 'design', metric: 'undesignedStates',
    title: 'Design the kiosk\'s offline state', summary: 'The rebuild: the offline note sits under the scanner, so the QR code stays in view, and Retry is within reach.',
    standard: 'async-ui-states/offline-states', delta: -1, size: 'M', risk: 3, status: 'done', before: [2], after: 1,
    evidence: ['undesigned states at base, as the first attempt read them', 'offline note under the scanner, check-ins kept, Retry in reach; the other-studio pass is still open'],
    files: ['src/features/kiosk/KioskScanner.tsx', 'src/features/kiosk/OfflineNote.tsx', 'src/features/kiosk/KioskScanner.test.tsx'], patch: 'state',
    ui: { text: 'Offline: check-ins are kept and sent when the kiosk reconnects.', action: 'Retry now' },
    screen: { panels: KIOSK, change: { kind: 'banner', at: 0, place: 'bottom', text: 'Offline: check-ins are kept and sent when the kiosk reconnects.', action: 'Retry now' } },
    attemptOf: 'des1-kiosk' },
  { key: 'perf1-timetable', pack: 'k-perf-1', feature: 'drag-and-drop-timetable-editor', name: 'Drag-and-drop timetable editor', lens: 'performance', metric: 'interactionP95Ms',
    title: 'Read the timetable layout once per drag, not on every pointer move', summary: 'Every pointer move reads the grid\'s layout and writes a slot, forcing a layout per move. Read the grid once when the drag starts.',
    standard: 'rendering/layout-thrash', delta: -20, size: 'S', risk: 2, status: 'done', before: [96, 104, 98], after: 72,
    evidence: ['interaction p95 over 5 drag passes', 'interaction p95 over 5 drag passes, the layout read once per drag'],
    files: ['src/features/timetable/TimetableGrid.tsx', 'src/features/timetable/useDragSlot.ts'], patch: 'defer', ui: { text: 'measureGrid' },
    context: { frameP95Ms: 21.4, blockingMs: 180, jankFrames: 9, idleWakeups: 2 } },
  { key: 'perf1-heatmap', pack: 'k-perf-1', feature: 'attendance-utilisation-heatmap', name: 'Attendance & utilisation heatmap', lens: 'performance', metric: 'interactionP95Ms',
    title: 'Memoise the heatmap\'s week buckets', summary: 'Switching a week rebuilds every bucket of the year. Keep the buckets per week and rebuild only the one shown.',
    standard: 'rendering/memoised-derivations', delta: -10, size: 'XS', risk: 1, status: 'done', before: [80, 88, 80], after: 76,
    evidence: ['interaction p95 over 5 week switches', 'interaction p95 over 5 week switches, the buckets memoised per week'],
    files: ['src/features/heatmap/Heatmap.tsx', 'src/features/heatmap/buckets.ts'], patch: 'defer', ui: { text: 'weekBuckets' },
    context: { frameP95Ms: 16.9, blockingMs: 95, jankFrames: 4, idleWakeups: 3 } },
];

/** The texts a sample screen draws: the gen script draws exactly these, and a shot's report counts them. */
export function screenTexts(it: Pick<SampleItem, 'name' | 'screen'>, phase: 'before' | 'after'): string[] {
  const s = it.screen;
  if (!s) return [];
  const out = ['Kettle', it.name, 'Riverside studio', ...NAV, 'SAMPLE SCREEN'];
  s.panels.forEach((p, i) => {
    out.push(p.title, ...p.lines);
    if (p.button) out.push(p.button);
    const c = s.change;
    if (phase === 'after' && c && c.at === i) out.push(...(c.kind === 'banner' ? [c.text, c.action] : [c.text]));
  });
  return out;
}
export const NAV: readonly string[] = ['Schedule', 'Members', 'Payments', 'Check-in', 'Reports'];
/** A sample screenshot's file under public/: `sample-shots/<item>-<phase>-<theme>.svg`. */
export const shotFile = (key: string, phase: 'before' | 'after', theme: 'light' | 'dark'): string => `sample-shots/${key}-${phase}-${theme}.svg`;

// ------------------------------------------------------------------------------------------- helpers
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let t = (h + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
/** `n` stable hex digits for a seed. */
const hexOf = (seed: string, n: number): string => { let s = ''; for (let i = 0; s.length < n; i++) s += hash(seed + '#' + i).toString(16).padStart(8, '0'); return s.slice(0, n); };
const sha40 = (seed: string) => hexOf('sha|' + seed, 40);
const refuse = (status: number, error: string, extra?: Record<string, unknown>): Error => Object.assign(new Error(error), { status, body: { error, ...extra } });
const runId = (t: number, seed: string) => 'r-' + new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + hexOf(seed, 4);
const BASE_SHA = sha40('kettle main'), MAIN_REF = 'main', BY = 'user:sample', SKILL = 'skill:lens-scan', MAX_IDS = 200;
const MIN = 60000;
const TO: Record<TriageDecision, TriageResult['decision']> = { accept: 'accepted', rework: 'rework', descope: 'descoped', reopen: 'reopened' };
const FROM: Record<TriageDecision, readonly ProposalStatus[]> = { accept: ['done', 'failed'], rework: ['done', 'failed', 'accepted'], descope: ['done', 'failed', 'accepted', 'rework', 'proposed', 'approved'], reopen: ['accepted', 'rework', 'descoped'] };
const BUSY: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['executing', 'done', 'failed']);
const SETTLED: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['released', 'descoped', 'declined']);
const BAD_TRIAGE = `body must be { ids: string[] (1..${MAX_IDS}), decision: 'accept' | 'rework' | 'descope' | 'reopen', note?: string }`;
const BAD_RELEASE = `body must be { version: semver without the v, ids?: string[] (1..${MAX_IDS}) }`;
const round = (v: number) => Math.round(v * 100) / 100;
const semverDesc = (a: string, b: string) => { const x = a.split(/[.+-]/).map(Number), y = b.split(/[.+-]/).map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

/** A release job's plan, fixed when it starts. */
interface Plan { rel: string; step: ReleaseStep; conflict?: string; gateFails: boolean; error?: string }

export class TrainSim {
  readonly packs: Pack[] = [];
  readonly releases: Release[] = [];
  readonly shots: Shot[] = [];
  private shotId = 0;
  /** Proposal id -> its sample item (commits, notes, conflicts). */
  private spec = new Map<string, SampleItem>();
  private plans = new Map<string, Plan>();

  private h: TrainHost;

  constructor(host: TrainHost) { this.h = host; }

  private iso(t = this.h.now()) { return new Date(t).toISOString(); }
  private prop(id: string): Proposal | undefined { const i = this.h.pAt.get(id); return i === undefined ? undefined : this.h.props[i]; }
  private put(p: Proposal) { const i = this.h.pAt.get(p.id); if (i === undefined) { this.h.pAt.set(p.id, this.h.props.length); this.h.props.push(p); } else this.h.props[i] = p; }
  private rel(id: string | undefined) { return id === undefined ? undefined : this.releases.find((r) => r.id === id); }
  private setRel(id: string, patch: Partial<Release>, drop: (keyof Release)[] = []) {
    const i = this.releases.findIndex((r) => r.id === id);
    if (i < 0) return;
    const next = { ...this.releases[i], ...patch, updated_at: this.iso() } as Release;
    for (const k of drop) delete next[k];
    this.releases[i] = next;
  }
  private log(run: string, kind: ActivityKind, text: string, at = this.iso(), feature?: string, lens?: string) {
    this.h.act.push({ id: this.h.nextActivity(), run_id: run, at, kind, text, ...(feature ? { feature } : {}), ...(lens ? { lens } : {}) });
  }
  private unit(lens: string, key: string) { return this.h.field(lens, key)?.unit; }

  // ----------------------------------------------------------------------------------------- seed
  /** Lay the sample packs over the bound product's features (the named Kettle feature, else the next free one in `order`).
   *  `value` is the map's current value of a feature's lens field: an item's baseline ends on it (its runs, after and
   *  expected impact shift with it), so seeding changes no number the map already shows; with none, the sample's own. */
  seed(order: readonly string[], value?: (feature: string, lens: string, key: string) => number | undefined): void {
    const T = this.h.now() - 5 * 60 * MIN, at = (m: number) => this.iso(T + m * MIN), used = new Set<string>(), feat = new Map<string, string>();
    for (const it of SAMPLE_ITEMS) {
      const f = it.attemptOf ? feat.get(it.attemptOf)! : order.includes(it.feature) && !used.has(it.feature) ? it.feature : order.find((x) => !used.has(x)) ?? it.feature;
      used.add(f); feat.set(it.key, f);
    }
    const lensesOf = (pack: string) => [...new Set(SAMPLE_ITEMS.filter((i) => i.pack === pack).map((i) => i.lens))];
    const propose = runId(T, 'propose');
    this.h.runs.push({ id: propose, started_at: at(0), updated_at: at(4), ended_at: at(4), phase: 'propose', status: 'done', lenses: ['design', 'performance'], scope: { features: [...new Set(feat.values())] }, model: 'sample', note: 'Kettle sample propose run (simulated)' });
    const ids = new Map<string, string>();
    for (const it of SAMPLE_ITEMS) ids.set(it.key, 'p-' + hexOf('kettle sample|' + it.key, 6));
    // pack -> [start minute, the minute a rework was triaged]
    const plan: [string, number][] = [['k-des-1', 20], ['k-des-2', 150], ['k-perf-1', 210]];
    for (const [k, t0] of plan) {
      const items = SAMPLE_ITEMS.filter((i) => i.pack === k), lens = items[0].lens, n = Number(k.split('-').pop()), short = k.split('-')[1];
      const run = runId(T + t0 * MIN, k), end = t0 + 6 + items.length * 6;
      const pack: Pack = { id: k, lens, n, branch: `pack/${short}-${n}`, base_ref: MAIN_REF, base_sha: BASE_SHA, run_id: run, status: 'open', created_at: at(t0), updated_at: at(end) };
      this.packs.push(pack);
      this.h.runs.push({ id: run, started_at: at(t0), updated_at: at(end), ended_at: at(end), phase: 'execute', status: 'done', lenses: lensesOf(k), scope: { proposals: items.map((i) => ids.get(i.key)!) }, model: 'sample', note: `Kettle sample execute run for ${k} (simulated)` });
      this.log(run, 'note', `pack ${k} on ${pack.branch} from ${MAIN_REF} at ${BASE_SHA.slice(0, 7)} (sample)`, at(t0));
      items.forEach((it, j) => {
        const id = ids.get(it.key)!, f = feat.get(it.key)!, sha = sha40('commit|' + it.key), m0 = t0 + 2 + j * 6;
        const cur = value?.(f, it.lens, it.metric), off = cur === undefined ? 0 : cur - it.before[it.before.length - 1];
        const before = it.before.map((x) => round(x + off)), after = round(it.after + off);
        this.spec.set(id, it);
        const method = it.lens === 'performance' ? 'probe' : 'judgement';
        const reading = (metric: string, value: number, phase: 'before' | 'after', m: number, evidence: string, commit: string) =>
          this.h.ms.push({ id: this.h.nextMeasurement(), run_id: run, feature: f, lens: it.lens, metric, value, ...(this.unit(it.lens, metric) ? { unit: this.unit(it.lens, metric)! } : {}), method, evidence, measured_at: at(m), proposal_id: id, phase, commit_sha: commit });
        before.forEach((v, r) => reading(it.metric, v, 'before', m0 + r * 0.5, (before.length > 1 ? `run ${r + 1} of ${before.length}: ` : '') + `${it.evidence[0]} at base ${BASE_SHA.slice(0, 7)} (sample)`, BASE_SHA));
        for (const [key, v] of Object.entries(it.context ?? {})) reading(key, value?.(f, it.lens, key) ?? v, 'before', m0 + 1.6, `context at base ${BASE_SHA.slice(0, 7)}, same passes (sample probe)`, BASE_SHA);
        reading(it.metric, after, 'after', m0 + 5, `${it.evidence[1]} at ${sha.slice(0, 7)} (sample)`, sha);
        const decided = it.attemptOf ? this.prop(ids.get(it.attemptOf)!)! : undefined;
        const p: Proposal = {
          id, run_id: it.attemptOf ? run : propose, feature: f, lens: it.lens, metric: it.metric, title: it.title, body: bodyOf(it, ids.get(it.attemptOf ?? ''), before[before.length - 1]), standard: it.standard,
          expected_delta: it.delta, ...(it.size ? { size: it.size } : {}), risk: it.risk, kind: 'fix', status: it.status === 'rework' ? 'rework' : it.status,
          decided_by: decided?.decided_by ?? BY, decided_at: decided?.decided_at ?? at(t0 - 5), after_value: after, result_sha: sha, created_at: it.attemptOf ? at(t0) : at(1 + SAMPLE_ITEMS.indexOf(it) * 0.1),
          updated_at: at(m0 + 5), pack_id: k, commit_sha: sha, ...(it.attemptOf ? { attempt_of: ids.get(it.attemptOf)! } : {}),
          ...(it.note ? { triaged_from: 'done' as const, triaged_by: BY, triaged_at: at(140), triage_note: it.note, updated_at: at(140) } : {}),
        };
        this.put(p);
        this.log(run, 'executing', 'building ' + it.title, at(m0), f, it.lens);
        this.log(run, 'committed', `${it.title} · ${sha.slice(0, 7)} (sample)`, at(m0 + 4), f, it.lens);
        if (it.gate) this.log(run, 'error', `gate failed on ${it.title}: ${it.gate} (sample)`, at(m0 + 4.5), f, it.lens);
        if (it.screen) for (const theme of ['light', 'dark'] as const) for (const phase of ['before', 'after'] as const) {
          const texts = screenTexts(it, phase);
          this.shots.push({ id: ++this.shotId, run_id: run, feature: f, path: shotFile(it.key, phase, theme), size: '1600x900', theme, harness_module: 'sample', captured_at: at(m0 + (phase === 'before' ? 1 : 5.2)),
            report: { feature: f, size: '1600x900', theme, minTextPx: 14, minTextAt: 'text ' + texts[0], textElements: texts.length, consoleErrors: [] }, proposal_id: id, phase });
        }
      });
    }
    this.settle(this.packs.map((k) => k.id), this.iso());
  }

  // ----------------------------------------------------------------------------------------- triage
  /** Triage built items, as POST triage: 400 bad body; 409 with the result as `body` when none moved. */
  triage(body: TriageBody): TriageResult {
    const b = body as Partial<TriageBody> | null;
    if (!b || !Array.isArray(b.ids) || !b.ids.length || b.ids.length > MAX_IDS || b.ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i))
      || typeof b.decision !== 'string' || !(b.decision in TO) || (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 4000))) throw refuse(400, BAD_TRIAGE);
    const text = b.note?.trim() ? b.note : undefined, at = this.iso(), triaged: string[] = [], skipped: TriageResult['skipped'] = [], touched: string[] = [];
    for (const id of [...new Set(b.ids)]) {
      const p = this.prop(id);
      if (!p) { skipped.push({ id, status: 'not-found' }); continue; }
      const s = this.move(p, b.decision, BY, text, at);
      if (s) { skipped.push(s); continue; }
      triaged.push(id);
      if (p.pack_id) touched.push(p.pack_id);
    }
    const result: TriageResult = { decision: TO[b.decision], by: BY, triaged, skipped, packs_triaged: this.settle(touched, at) };
    if (!triaged.length) throw Object.assign(new Error('nothing moved: ' + skipped.map((s) => s.id + ' ' + (s.reason ?? s.status)).join(', ')), { status: 409, body: result });
    this.h.changed();
    return result;
  }

  /** One item's compare-and-set triage (store.mjs `triage`, plus v3 reopen); a skip row when refused, else null. */
  private move(p: Proposal, d: TriageDecision, by: string, text: string | undefined, at: string): TriageResult['skipped'][number] | null {
    if (!FROM[d].includes(p.status)) return { id: p.id, status: p.status };
    if (d === 'accept' && p.status === 'failed' && !text) return { id: p.id, status: p.status, reason: 'note-required' };
    const rel = this.rel(p.release_id), leaves = d !== 'accept' && p.release_id !== undefined;
    const mayLeave = rel?.status === 'draft' || (rel?.status === 'building' && d === 'rework' && by.startsWith('skill:'));
    if (leaves && !mayLeave) return { id: p.id, status: p.status, reason: 'in-release' };
    if (d === 'reopen' && !p.triaged_from) return { id: p.id, status: p.status, reason: 'no-prior-status' };
    if (d === 'reopen' && p.status === 'rework' && this.h.props.some((x) => x.attempt_of === p.id)) return { id: p.id, status: p.status, reason: 'rebuilt' };
    const next: Proposal = { ...p, status: d === 'reopen' ? p.triaged_from! : (TO[d] as ProposalStatus), triaged_from: p.status, triaged_by: by, triaged_at: at, updated_at: at };
    if (text) next.triage_note = text; else delete next.triage_note;
    if (leaves) delete next.release_id;
    this.put(next);
    return null;
  }

  /** Packs none of whose items is executing, done or failed move open -> triaged (answered); one with such an item again (a reopen) goes back to open. */
  private settle(packIds: readonly string[], at: string): string[] {
    const moved: string[] = [];
    for (const k of new Set(packIds)) {
      const i = this.packs.findIndex((x) => x.id === k), items = this.h.props.filter((p) => p.pack_id === k);
      if (i < 0 || !items.length) continue;
      const busy = items.some((p) => BUSY.has(p.status)), st = this.packs[i].status;
      if (!busy && st === 'open') { this.packs[i] = { ...this.packs[i], status: 'triaged', updated_at: at }; moved.push(k); }
      else if (busy && st === 'triaged') this.packs[i] = { ...this.packs[i], status: 'open', updated_at: at };
    }
    return moved;
  }

  // ----------------------------------------------------------------------------------------- releases
  private free(): Proposal[] { return this.h.props.filter((p) => p.status === 'accepted' && !p.release_id).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1)); }
  private items(rel: string): Proposal[] { return this.h.props.filter((p) => p.release_id === rel).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1)); }

  /** The next version, as GET releases/suggest over the sample's tagged releases (it has no git tags of its own). */
  suggest(): VersionSuggestion {
    const tags = this.releases.filter((r) => r.status === 'tagged').map((r) => r.version).sort(semverDesc), items = this.free();
    let s: VersionSuggestion;
    if (!tags.length) s = { version: '0.1.0', from: 'none', reason: 'no v* tag yet in the sample' };
    else {
      const by = bumpOf(items), n = items.length;
      const why = !n ? 'no accepted items wait for a release yet' : `${n} accepted item${n === 1 ? '' : 's'}, ${by === 'minor' ? 'a baseline upgrade or a new capability among them' : 'no baseline upgrade or new capability'}`;
      s = { version: bump(tags[0], by), from: 'v' + tags[0], reason: `${why}: ${by} bump from v${tags[0]} (sample)` };
    }
    const taken = new Set(this.releases.map((r) => r.version));
    let v = s.version, n = 0;
    while (taken.has(v) && n++ < 100) v = bump(v, 'patch');
    return v === s.version ? s : { ...s, version: v, reason: `${s.reason}; ${s.version} already has a release, so ${v}` };
  }

  /** A draft release, as POST releases (release-create then release-add): 400 bad body, 409 nothing free or the version exists. */
  create(version: string, ids?: string[]): ReleaseCreated {
    if (!isVersion(version) || (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i))))) throw refuse(400, BAD_RELEASE);
    const free = new Set(this.free().map((p) => p.id)), want = ids === undefined ? [...free] : [...new Set(ids)];
    if (!want.some((id) => free.has(id))) throw refuse(409, 'no accepted item without a release to ship' + (ids === undefined ? '' : ' among these ids'));
    const id = 'rel-' + version;
    if (this.releases.some((r) => r.id === id || r.version === version)) throw refuse(409, `release ${version} already exists`);
    const at = this.iso();
    this.releases.push({ id, version, branch: 'release/' + version, status: 'draft', created_by: BY, created_at: at, updated_at: at });
    const added: string[] = [], skipped: ReleaseCreated['skipped'] = [];
    for (const pid of want) {
      const p = this.prop(pid);
      if (!p) skipped.push({ id: pid, status: 'not-found' });
      else if (/^target:\s*registry\b/.test((p.body ?? '').trimStart())) skipped.push({ id: pid, status: p.status, reason: 'registry-target' });
      else if (p.release_id !== undefined) skipped.push({ id: pid, status: p.status, reason: p.release_id === id ? 'already-in' : 'in-release' });
      else if (p.status !== 'accepted') skipped.push({ id: pid, status: p.status });
      else { this.put({ ...p, release_id: id, updated_at: at }); added.push(pid); }
    }
    this.h.changed();
    return { release: { ...this.rel(id)!, items: this.items(id) }, added, skipped };
  }

  /** The release a build or finish may start on: 400 bad id, 404 unknown, 409 not in a state for that step. */
  startable(id: string, step: ReleaseStep): Release {
    if (!RELEASE_ID.test(id)) throw refuse(400, 'bad-release');
    const r = this.rel(id);
    if (!r) throw refuse(404, `no release ${id}`);
    const from = step === 'build' ? ['draft', 'failed'] : ['merged'];
    if (!from.includes(r.status)) throw refuse(409, `${id} is ${r.status}; ${step} starts from ${from.join(' or ')}`, { release: r });
    return r;
  }

  /** Kettle only: the person merging the PR on GitHub (pr-open -> merged). */
  merge(id: string): void {
    const r = this.rel(id);
    if (!r) throw refuse(404, `no release ${id}`);
    if (r.status !== 'pr-open') throw refuse(409, `${id} is ${r.status}; only an open PR merges`);
    this.setRel(id, { status: 'merged' });
    this.h.changed();
  }

  /** A release job starts: the release moves to building (a build adds its run, note `bp-job:<id> · release <rel> at <sha>`).
   *  Answers the job's steps, one per sim step; [] when the release is no longer in a state for it. */
  begin(job: ScanJob, run: string, toggles: TrainToggles): string[] {
    const id = job.release ?? '', step = job.step ?? 'build', r = this.rel(id), plan: Plan = { rel: id, step, gateFails: toggles.gateFails };
    this.plans.set(job.id, plan);
    const ok = step === 'build' ? r && (r.status === 'draft' || r.status === 'failed') : r?.status === 'merged';
    if (!r || !ok) { plan.error = r ? `${id} is ${r.status}; ${step} cannot start` : `no release ${id}`; return []; }
    if (step === 'finish') return ['fetch', 'tag', 'publish'];
    const items = this.items(id), at = this.iso();
    this.setRel(id, { status: 'building', base_sha: BASE_SHA }, ['error']);
    this.h.runs.push({ id: run, started_at: at, updated_at: at, phase: 'measure', status: 'running', lenses: [...new Set(items.map((p) => p.lens))], scope: { release: id }, model: 'sample', note: `bp-job:${job.id} · release ${id} at ${BASE_SHA.slice(0, 7)}` });
    if (toggles.conflict && items.length) plan.conflict = items.reduce((a, b) => (this.files(b).length > this.files(a).length ? b : a)).id;
    return ['cut', ...items.map((p) => 'pick:' + p.id), 'gate', ...(toggles.gateFails ? [] : ['notes', 'pr'])];
  }

  /** One step of a release job; answers its log line. */
  step(job: ScanJob, s: string, run: string): string {
    const plan = this.plans.get(job.id)!, r = this.rel(plan.rel)!, v = r.version, at = this.iso();
    const line = (kind: ActivityKind, text: string, p?: Proposal) => { if (job.step !== 'finish') this.log(run, kind, text, at, p?.feature, p?.lens); return text; };
    if (s === 'cut') return line('note', `cut ${r.branch} from ${MAIN_REF} at ${BASE_SHA.slice(0, 7)} (sample)`);
    if (s.startsWith('pick:')) {
      const p = this.prop(s.slice(5));
      if (!p || p.release_id !== r.id) return line('note', `skipped ${s.slice(5)}: no longer in ${r.id} (sample)`);
      if (p.id !== plan.conflict) return line('committed', `cherry-picked ${p.commit_sha?.slice(0, 7)} ${p.title} (sample)`, p);
      const files = this.files(p).map((f) => f.path).join(', ');
      this.move(p, 'rework', SKILL, `conflict on release/${v}: ${files}`, at);
      return line('error', `conflict cherry-picking ${p.commit_sha?.slice(0, 7)} ${p.title}: ${files}; sent back to rework (sample)`, p);
    }
    if (s === 'gate') {
      if (!plan.gateFails) return line('note', 'gates passed: tsc, vitest (sample)');
      this.setRel(r.id, { status: 'failed', error: 'gate failed: vitest (sample)' });
      return line('error', 'gate failed: vitest (sample)');
    }
    if (s === 'notes') { const items = this.items(r.id); this.setRel(r.id, { notes: this.notes(r, items) }); return line('note', `release notes written: ${items.length} item${items.length === 1 ? '' : 's'} (sample)`); }
    if (s === 'pr') {
      if (!this.items(r.id).length) { this.setRel(r.id, { status: 'failed', error: 'nothing left to ship: every item went back to rework (sample)' }); return line('error', 'nothing left to ship (sample)'); }
      const url = `https://github.com/sample/kettle/pull/${40 + this.releases.indexOf(r)}`;
      this.setRel(r.id, { status: 'pr-open', pr_url: url });
      return line('note', `opened ${url} (sample PR)`);
    }
    if (s === 'fetch') return `fetched ${MAIN_REF}: ${r.branch} merged (sample)`;
    if (s === 'tag') {
      // store.mjs release-update merged -> tagged: the accepted items ship, and packs left with only settled items close
      const items = this.items(r.id).filter((p) => p.status === 'accepted');
      this.setRel(r.id, { status: 'tagged', tag: 'v' + v });
      for (const p of items) this.put({ ...p, status: 'released', updated_at: at });
      const closed = this.closePacks(items.map((p) => p.id), at);
      return `tagged v${v}: ${items.length} item${items.length === 1 ? '' : 's'} released${closed.length ? ', closed ' + closed.join(', ') : ''} (sample)`;
    }
    return `GitHub release v${v} published (sample)`;
  }

  /** Settled for closing its pack (store.mjs 1.6.1): released, descoped or declined, or a `rework` item whose rebuild is settled. */
  private settled(p: Proposal, depth = 0): boolean {
    if (SETTLED.has(p.status)) return true;
    if (p.status !== 'rework' || depth > 32) return false;
    return this.h.props.some((c) => c.attempt_of === p.id && this.settled(c, depth + 1));
  }
  /** Close every open or triaged pack whose items are all settled, among the packs of `ids` and of the items they
   *  rebuild (up the attempt_of chain: a rebuild ships from a later pack, and the reworked item's pack waits on it). */
  private closePacks(ids: readonly string[], at: string): string[] {
    const packs = new Set<string>(), closed: string[] = [];
    for (const id of ids) for (let p = this.prop(id), n = 0; p && n < 32; n++) { if (p.pack_id) packs.add(p.pack_id); p = p.attempt_of ? this.prop(p.attempt_of) : undefined; }
    for (const k of packs) {
      const i = this.packs.findIndex((x) => x.id === k);
      if (i >= 0 && this.packs[i].status !== 'closed' && this.h.props.every((p) => p.pack_id !== k || this.settled(p))) { this.packs[i] = { ...this.packs[i], status: 'closed', updated_at: at }; closed.push(k); }
    }
    return closed;
  }

  /** How a release job ended: an error when its release did not get where the step goes. */
  end(job: ScanJob): { error?: string } {
    const plan = this.plans.get(job.id), r = this.rel(plan?.rel);
    if (plan?.error) return { error: plan.error };
    const ok = !!r && (job.step === 'finish' ? r.status === 'tagged' : ['pr-open', 'merged', 'tagged'].includes(r.status));
    return ok ? {} : { error: r?.error ?? 'the release did not get through (sample)' };
  }

  /** A release job was cancelled while running: its building release fails, so a build may start again. */
  cancelled(job: ScanJob): void {
    const r = this.rel(job.release);
    if (r?.status === 'building') this.setRel(r.id, { status: 'failed', error: 'the release job was cancelled (sample)' });
  }

  // ----------------------------------------------------------------------------------------- notes and commits
  private notes(r: Release, items: Proposal[]): string {
    const lenses = (lens: string): LensFields[] => [{ id: lens, manifest: { fields: [this.h.field(lens, items.find((p) => p.lens === lens)?.metric ?? '')].filter((f): f is LensField => !!f) } }];
    const out = [`## Kettle ${r.version} (sample)`, '', 'Sample release notes: Kettle is the sample product, and nothing here shipped.', ''];
    for (const p of items) {
      const before: Measurement[] = [], after: Measurement[] = [];
      for (const m of this.h.ms) if (m.proposal_id === p.id) (m.phase === 'after' ? after : before).push(m);
      const v = verdictOf(p, before, after, lenses(p.lens)), u = v.from?.unit ? ' ' + v.from.unit : '';
      const move = v.from && v.to ? `${p.metric} ${v.from.value} -> ${v.to.value}${u} (${v.verdict})` : 'unmeasured';
      out.push(`- **${p.title}** · ${p.lens} · ${p.feature}: ${move} · commit ${p.commit_sha?.slice(0, 7) ?? 'none'}`);
      // accepted from failed is still flagged: the build did not pass its gates
      if (isFlagged({ status: p.triaged_from === 'failed' ? 'failed' : p.status }, v.verdict) && p.triage_note) out.push(`  - Shipped flagged: ${p.triage_note}`);
    }
    return out.join('\n') + '\n';
  }

  private files(p: Proposal): CommitDiff['files'] { const it = this.spec.get(p.id); return it ? it.files.map((f, i) => ({ path: f, ...counts(hunk(it, f, i)) })) : []; }

  /** A sample item commit's diff: 400 for a sha that is not hex, 404 for one no sample item has. */
  diff(sha: string): CommitDiff {
    if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha)) throw refuse(400, 'bad-sha');
    const p = this.h.props.find((x) => x.commit_sha && this.spec.has(x.id) && x.commit_sha.startsWith(sha.toLowerCase()));
    if (!p) throw refuse(404, `no item commit ${sha}`);
    const it = this.spec.get(p.id)!, full = p.commit_sha!, files = this.files(p);
    const kind = it.patch === 'defer' ? 'perf' : 'fix';
    const message = [`${kind}(${p.feature}): ${it.title[0].toLowerCase() + it.title.slice(1)}`, '', wrap(it.summary), '',
      'Sample commit: Kettle is the sample product; this change was simulated and', 'never built.', '',
      `Standard: ${it.standard}`, `Gates: ${it.gate ? 'tsc passed; ' + it.gate : 'tsc, vitest'} (sample)`, '', `Lens-Item: ${p.id}`, `Lens-Pack: ${p.pack_id}`].join('\n');
    const patch = it.files.map((f, i) => fileHeader(f, it.key) + hunk(it, f, i).join('\n')).join('\n');
    const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0), w = Math.max(...files.map((f) => f.path.length));
    const stat = [`commit ${full}`, 'Author: lens-scan (sample) <sample@kettle.invalid>', `Date:   ${p.updated_at}`, '', ...message.split('\n').map((l) => (l ? '    ' + l : '')), '',
      ...files.map((f) => ` ${f.path.padEnd(w)} | ${String(f.add + f.del).padStart(3)} ${'+'.repeat(Math.min(f.add, 40))}${'-'.repeat(Math.min(f.del, 20))}`),
      ` ${files.length} file${files.length === 1 ? '' : 's'} changed, ${add} insertion${add === 1 ? '' : 's'}(+), ${del} deletion${del === 1 ? '' : 's'}(-)`].join('\n');
    return { sha: full, message, stat, files, patch, lines: patch.split('\n').length, truncated: false };
  }
}

function bodyOf(it: SampleItem, attemptOf: string | undefined, base: number): string {
  const brief = it.attemptOf ? `## Brief\nThe rebuild of ${attemptOf}, sent back to rework with this note:\n\n> ${SAMPLE_ITEMS.find((x) => x.key === it.attemptOf)?.note}\n\n` : '';
  const unit = it.lens === 'performance' ? ' ms' : '';
  return `${brief}## Summary\n${it.summary}\n\n## Description\nSample finding: Kettle is the sample product, so this item, its commit and its readings are simulated.\n\n`
    + `## Flow\n${it.files.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n## Expected impact\n${it.metric} on ${it.feature} ${base} -> ${round(base + it.delta)}${unit}.\n\n`
    + `## Evaluation\nRe-measure ${it.metric} (${it.lens === 'performance' ? 'probe, 3 baseline runs' : 'judgement'}) on the pack branch. Standard ${it.standard}.\n`;
}

const wrap = (s: string, w = 72): string => { const out: string[] = []; let l = ''; for (const word of s.split(' ')) { if (l && (l + ' ' + word).length > w) { out.push(l); l = word; } else l = l ? l + ' ' + word : word; } if (l) out.push(l); return out.join('\n'); };
const pascal = (path: string) => path.split('/').pop()!.replace(/\.(test\.)?tsx?$|\.css$/, '');
function fileHeader(f: string, key: string): string { return `diff --git a/${f} b/${f}\nindex ${hexOf('a|' + key + f, 7)}..${hexOf('b|' + key + f, 7)} 100644\n--- a/${f}\n+++ b/${f}\n`; }
function counts(lines: string[]) { let add = 0, del = 0; for (const l of lines) { if (l.startsWith('+')) add++; else if (l.startsWith('-')) del++; } return { add, del }; }

/** One file's hunk of a sample commit (a design state, or a perf deferral), by file kind. */
function hunk(it: SampleItem, f: string, i: number): string[] {
  const C = pascal(f), at = 18 + i * 11, q = it.ui.text.replace(/'/g, "\\'");
  if (f.endsWith('.css')) return [`@@ -${at},4 +${at},14 @@ .${C} {`, '   display: grid;', '   gap: 8px;', ' }', '+', `+.${C}-problem {`, '+  display: flex;', '+  align-items: center;', '+  gap: 12px;', '+  padding: 10px 14px;', '+  border-radius: 8px;', '+  background: var(--amber);', '+  font-size: 14px;', '+}'];
  if (/\.test\.tsx?$/.test(f)) {
    const comp = pascal(it.files[0]);
    return [`@@ -${at},6 +${at},18 @@ describe('${comp}', () => {`, `     render(<${comp} />);`, `     expect(screen.getByRole('main')).toBeVisible();`, '   });', '+',
      `+  it('${it.patch === 'defer' ? 'reads the layout once per gesture' : 'shows the failure and its way out'}', async () => {`,
      ...(it.patch === 'defer' ? ['+    const reads = spyOnLayout();', `+    render(<${comp} />);`, '+    await drag(screen.getByText(\'Spin 45\'), { steps: 30 });', '+    expect(reads.count).toBe(1);']
        : ['+    server.refuseOnce();', `+    render(<${comp} />);`, `+    expect(await screen.findByText('${q}')).toBeVisible();`, ...(it.ui.action ? [`+    await user.click(screen.getByRole('button', { name: '${it.ui.action}' }));`, `+    expect(screen.queryByText('${q}')).toBeNull();`] : [])]),
      '+  });', ' });'];
  }
  if (it.patch === 'defer') {
    return i === 0
      ? [`@@ -${at},9 +${at},11 @@ export function ${C}({ week }: Props) {`, `   const grid = useRef<HTMLDivElement>(null);`, '-  const onMove = (e: PointerEvent) => {', `-    const box = grid.current!.getBoundingClientRect();`, '-    setSlot(slotAt(box, e.clientX, e.clientY));',
        '-  };', `+  const box = useRef<DOMRect>();`, `+  const onStart = () => { box.current = grid.current!.getBoundingClientRect(); };`, '+  const onMove = (e: PointerEvent) => {', '+    if (box.current) setSlot(slotAt(box.current, e.clientX, e.clientY));', '+  };',
        `+  // ${it.ui.text}: one read per gesture (sample)`, '   return (', `     <div ref={grid} onPointerDown={onStart} onPointerMove={onMove}>`]
      : [`@@ -${at},6 +${at},10 @@ export function ${C}(rows: Row[]) {`, '-  const all = rows.map(toCell);', '-  return groupByWeek(all);', '+  const cache = new Map<string, Cell[]>();', '+  return (week: string) => {',
        '+    let hit = cache.get(week);', '+    if (!hit) cache.set(week, (hit = rows.filter((r) => r.week === week).map(toCell)));', '+    return hit;', '+  };', ' }'];
  }
  if (f.endsWith('.ts')) return [`@@ -${at},8 +${at},15 @@ export function ${C}(id: string) {`, '   const [error, setError] = useState<string>();', '   const run = useCallback(async () => {', '-    await api.post(id);', '+    setError(undefined);', '+    try {',
    '+      await api.post(id);', '+    } catch (e) {', `+      setError(messageOf(e) ?? '${q}');`, '+    }', '   }, [id]);', '-  return { run };', '+  return { run, error, retry: run };', ' }'];
  return [`@@ -${at},7 +${at},${it.ui.action ? 16 : 11} @@ export function ${C}(props: ${C}Props) {`, `   const state = use${C}(props.id);`, '   if (state.loading) return <Spinner label="Loading" />;', '-  if (state.error) return null;',
    ...(it.ui.action ? ['+  if (state.error) {', '+    return (', `+      <ProblemNote action={{ label: '${it.ui.action}', onClick: state.retry }}>`, `+        ${it.ui.text}`, '+      </ProblemNote>', '+    );', '+  }']
      : ['+  if (state.error) return <Reason>{state.error}</Reason>;', `+  const why = state.blocked ? '${q}' : undefined;`]),
    '   return (', `     <section className="${C}">`, ...(it.ui.action ? [] : ['-      <Button disabled={state.blocked}>{props.label}</Button>', '+      <Button disabled={!!why} aria-describedby="why">{props.label}</Button>', '+      {why && <p id="why">{why}</p>}'])];
}
