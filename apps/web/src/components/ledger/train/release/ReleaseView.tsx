// The ledger's Release tab: the version (suggested, with its reason), the package of accepted items by lens (flagged
// ones with their notes), the stepper draft -> building -> pr-open -> merged -> tagged driven by the release row and its
// job from the stream, the job log, the notes the release will publish, the failure states, and the history of past
// releases. Build, Tag and Finish start the Claude Code job (a live product: the CLI with the user's gh login; Kettle: the
// scan sim's sample job through the same actions); nothing here simulates a step. On the phone the tab is read-only.
// Also the header's summary strip and the phone's one-line release status. What a status allows is releaseState.ts's
// table; the progress comes only from the stream (the release rows and the jobs list), never from polling. Before Build,
// the pre-flight (preflight.ts) lists what will refuse or fail; the probe behind it is asked when the tab opens on a
// release that offers a build, when its package, jobs or sample switches change - never on a timer. Before a draft the
// tab owns a choice of package items (J/K, X or Space, Esc clears it first): Create draft and the suggestion take it.
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Proposal } from '@bp/core/scan/types';
import type { ScanJob } from '@bp/core/scan/jobs';
import { buildRelease, finishRelease, preflightRelease, refusalText, tagRelease, type ScanCtx } from '@/lib/scan/actions';
import { releaseItems, unreleased, verdictOf } from '@bp/core/scan/compare';
import { isWaiting } from '@bp/core/train/rules';
import { landingOf } from '@bp/core/scan/landed';
import { useEngine } from '../../../hooks';
import { setLedgerUi } from '../../useLedger';
import { KEYMAP } from '../keymap';
import { useTrain } from '../data';
import { Callout } from '../ui/Controls';
import {
  ACTION, RELEASE_STATE, allLanded, chosenOf, evidenceOf, onPath, failedStep, historyOf, isActive, jobsOf, keysOf, landedOutside, openRelease, readingsBy, standLine,
  safeUrl, standOf, STATUS_WORD, STEPS, type ReleaseModel, type RelAction,
} from './releaseState';
import { VersionBox, suggestKey, useSuggestion } from './VersionBox';
import { Btn } from '../ui/Controls';
import { Package } from './Package';
import { Stepper } from './Stepper';
import { JobLog } from './JobLog';
import { NotesPreview } from './NotesPreview';
import { History } from './History';
import { SampleToggles } from './SampleToggles';
import { firstBlock, gated, preflightOf, preflighted, type PreCheck, type Probe } from './preflight';
import './release.css';

export interface ReleaseViewProps {
  phone: boolean;
}

export function useReleaseModel(): ReleaseModel {
  const T = useTrain();
  return useMemo(() => {
    const rel = openRelease(T.releases), jobs = jobsOf(T.jobs, rel?.id), by = readingsBy(T.measurements);
    // the compare.ts helpers only read the array (it is the stream's, never changed in place)
    const scan = { proposals: T.proposals as Proposal[] }, free = unreleased(scan);
    const items = (rel ? releaseItems(scan, rel.id) : free).map((p) => evidenceOf(p, by, T.lenses));
    const m: ReleaseModel = { T, jobs, items, free: free.length, history: historyOf(T.releases, rel), landed: landedOutside(items, rel, T.landed), base: T.landed?.state === 'known' ? T.landed.ref : 'main' };
    if (rel) m.rel = rel;
    if (jobs.length) m.last = jobs[jobs.length - 1];
    return m;
  }, [T]);
}

// ------------------------------------------------------------------------------------------- actions
export interface ReleaseActions {
  /** The actions the row shows (none while a job runs or a request is on its way). */
  shown: readonly RelAction[];
  /** What can be done now: `shown` with Build and Retry gated out while a pre-flight check blocks (the B key reads it). */
  available: readonly RelAction[];
  /** The pre-flight checks, and the first blocker's words (Build's title while it is held). */
  checks: readonly PreCheck[];
  blocked?: string;
  /** The inline confirm that is showing: Finish (from pr-open or merged) or Tag. Both are public and not undone here, so
   *  the first press (button or key) only asks, and the confirm's own button (or the key again) starts the job. */
  asking: 'finish' | 'tag' | null;
  busy: boolean;
  err: { status?: number; text: string } | null;
  run(a: RelAction): void;
  cancelAsk(): void;
}

function useReleaseActions(m: ReleaseModel, phone: boolean): ReleaseActions {
  const ctx = m.T.ctx, rel = m.rel;
  const [asking, setAsking] = useState<'finish' | 'tag' | null>(null);
  const [sending, setSending] = useState(false);
  // the job a request started, until the jobs list has it (a live jobs event can trail the 202)
  const [sent, setSent] = useState<{ rel: string; job: string } | null>(null);
  const [err, setErr] = useState<{ status?: number; text: string } | null>(null);
  const busy = sending || (!!sent && sent.rel === rel?.id && !m.jobs.some((j) => j.id === sent.job)) || isActive(m.last);
  const st = rel ? RELEASE_STATE[rel.status] : undefined, landedAll = allLanded(m);
  const shown: RelAction[] = phone || !rel || !st || busy ? [] : asking ? [asking]
    : st.actions.filter((a) => onPath(a, landedAll) && (a !== 'sampleMerge' || !!ctx.sim) && (a !== 'pr' || !!safeUrl(rel.pr_url)));
  const probe = useProbe(m, phone || busy, landedAll ? 'tag' : 'build');
  const checks = useMemo(() => (phone ? [] : preflightOf(rel, m.items, probe, m)), [phone, rel, m, probe]);
  const available = gated(shown, checks), blocked = firstBlock(checks);
  const go = async (id: string, start: () => Promise<ScanJob>) => {
    setErr(null); setSending(true);
    try { const j = await start(); setSent({ rel: id, job: j.id }); } catch (e) {
      const s = (e as { status?: number }).status;
      setErr(s === undefined ? { text: refusalText(e) } : { status: s, text: refusalText(e) });
    } finally { setSending(false); setAsking(null); }
  };
  const run = (a: RelAction) => {
    if (!rel || !available.includes(a)) return;
    if (a === 'build' || a === 'retry') void go(rel.id, () => buildRelease(ctx, rel.id));
    // a tag and a finish publish and cannot be undone from this page: the first press asks, the confirm starts the job
    else if ((a === 'tag' || a === 'finish') && asking !== a) { setErr(null); setAsking(a); }
    else if (a === 'tag') void go(rel.id, () => tagRelease(ctx, rel.id));
    else if (a === 'finish') void go(rel.id, () => finishRelease(ctx, rel.id));
    else if (a === 'finishAsk') { setErr(null); setAsking('finish'); }
    else if (a === 'sampleMerge') {
      try { ctx.sim?.sampleMerge(rel.id); setErr(null); } catch (e) { setErr({ text: refusalText(e) }); }
    }
  };
  return { shown, available, checks, ...(blocked ? { blocked } : {}), asking, busy, err, run, cancelAsk: () => setAsking(null) };
}

const noSub = () => () => {};
/** The sample's switches as the sim holds them (null live), so a toggle re-asks the probe. */
const useToggles = (ctx: ScanCtx) => useSyncExternalStore(ctx.sim?.subscribe ?? noSub, () => ctx.sim?.trainToggles ?? null, () => ctx.sim?.trainToggles ?? null);

/** The build's (or tag's) dry run, asked once per change of what it reads (the release, its package, its jobs, the
 *  sample switches, the step its path takes). */
function useProbe(m: ReleaseModel, off: boolean, step: 'build' | 'tag'): Probe {
  const ctx = m.T.ctx, rel = m.rel, relId = rel?.id, toggles = useToggles(ctx);
  const key = off || !rel || !preflighted(rel) ? '' : [rel.id, step, STATUS_WORD[rel.status], m.items.map((x) => x.p.id + ':' + (x.p.commit_sha ?? '')).join(), m.jobs.map((j) => j.id + ':' + j.status).join(), JSON.stringify(toggles)].join('|');
  const [probe, setProbe] = useState<{ key: string; v: Probe }>({ key: '', v: null });
  useEffect(() => {
    if (!key || !relId) return;
    let on = true;
    preflightRelease(ctx, relId, step).then((v) => { if (on) setProbe({ key, v }); }, (e: unknown) => {
      const s = (e as { status?: number }).status;
      if (on) setProbe({ key, v: s === undefined ? { text: refusalText(e) } : { status: s, text: refusalText(e) } });
    });
    return () => { on = false; };
  }, [key, ctx, relId, step]);
  return probe.key === key ? probe.v : null;
}

/** The pre-flight list above the actions: every check in words, its verdict as a word too (never colour alone). */
const VERDICT_WORD: Readonly<Record<PreCheck['verdict'], string>> = { block: 'Blocks', warn: 'Note', ok: 'Ready' };
function Preflight({ checks }: { checks: readonly PreCheck[] }) {
  if (!checks.length) return null;
  return (
    <ul className="tr-rel-pre" data-role="tr-rel-pre" aria-label="Before you build">
      {checks.map((c) => <li key={c.id} className={c.verdict}><b>{VERDICT_WORD[c.verdict]} · </b>{c.words}</li>)}
    </ul>
  );
}

const ActionsRow = memo(function ActionsRow({ m, a }: { m: ReleaseModel; a: ReleaseActions }) {
  const rel = m.rel;
  if (!rel) return null;
  const v = rel.version;
  return (
    <>
      <div className="tr-rel-acts">
        {a.asking ? (
          <span className="tr-rel-ask" role="group" aria-label={a.asking === 'tag' ? 'Tag the release' : 'Finish the release'}>
            <span>{askWords(a.asking, rel.status === 'pr-open', v, m.items.length)}</span>
            <Btn tone="go" kbd={keysOf(a.asking)} onClick={() => a.run(a.asking!)} disabled={!a.available.includes(a.asking)}>{a.asking === 'tag' ? 'Tag v' + v : 'Finish'}</Btn>
            <Btn onClick={a.cancelAsk}>Not yet</Btn>
          </span>
        ) : a.shown.map((x) => x === 'pr'
          ? <a key={x} className="tr-rel-pr" href={safeUrl(rel.pr_url) ?? undefined} target="_blank" rel="noopener noreferrer">⇱ {prName(rel.pr_url)}{m.T.ctx.sim ? ' · sample' : ''}</a>
          : <Btn key={x} tone={ACTION[x].go ? 'go' : undefined} kbd={keysOf(ACTION[x].key)} onClick={() => a.run(x)} reason={a.available.includes(x) ? undefined : a.blocked}>{ACTION[x].label(v, m.items.length)}</Btn>)}
      </div>
      <p className="tr-rel-hint">{a.busy && !isActive(m.last) ? 'Starting the release job…' : standLine(standOf(rel, m.last), rel, m.last, m.items.length, m.landed.size)}</p>
    </>
  );
});

/** The confirm's question: what the job publishes, its version and item count, and that it is not undone here. */
const askWords = (a: 'finish' | 'tag', fromPr: boolean, v: string, n: number) => {
  const items = n + ' item' + (n === 1 ? '' : 's');
  return a === 'tag' ? `Tag v${v} on the base branch and release its ${items}? A tag is public and is not undone here.`
    : (fromPr ? 'Merged on GitHub? ' : '') + `Finish tags v${v} and publishes the release of ${items}. A tag is public and is not undone here.`;
};

const prName = (url: string | undefined) => { const n = /\/pull\/(\d+)/.exec(url ?? '')?.[1]; return n ? 'PR #' + n : 'Pull request'; };

/** What went wrong, in words: a refused request (412: the fix), the release's failure at its step, a failed job, and a
 *  build that stopped with the row still `building` (standOf's `stalled`: nothing is running and nothing here moves it). */
function Failures({ m, a }: { m: ReleaseModel; a: ReleaseActions }) {
  const rel = m.rel, last = m.last;
  const failed = rel?.status === 'failed', stalled = standOf(rel, last) === 'stalled';
  return (
    <>
      {a.err?.status === 412 ? (
        <Callout tone="error" role="tr-rel-gh"><b>Refused · gh not authenticated. </b>Run <code>gh auth login</code> in a terminal, then Build again. Nothing was started.</Callout>
      ) : a.err ? <Callout tone="error"><b>Refused · </b>{a.err.text}</Callout> : null}
      {failed ? <Callout tone="error" role="tr-rel-failed"><b>Failed at {STEPS[failedStep(last)]} · </b>{rel.error ?? last?.error ?? 'the release job did not get through'}</Callout>
        : stalled ? <Callout tone="note" role="tr-rel-stalled"><b>Build stopped · </b>{last?.error ?? (last ? 'the release job is ' + last.status : 'no release job is left for this release')}</Callout>
          : last?.status === 'failed' && last.error ? <Callout tone="error"><b>The {last.step ?? 'release'} job failed · </b>{last.error}</Callout> : null}
    </>
  );
}

/** The pre-draft choice: the chosen ids and the focused row, kept to the package's items (an item that left is dropped). */
function useChoice(m: ReleaseModel) {
  const [st, setSt] = useState<{ sel: ReadonlySet<string>; focus: string | null }>({ sel: new Set(), focus: null });
  const ids = useMemo(() => (m.rel ? [] : m.items.map((x) => x.p.id)), [m.rel, m.items]);
  const here = useMemo(() => new Set(ids), [ids]);
  const sel = useMemo(() => new Set([...st.sel].filter((id) => here.has(id))), [st.sel, here]);
  const focus = st.focus && here.has(st.focus) ? st.focus : null;
  const toggle = (id: string) => setSt((s) => { const n = new Set(s.sel); if (!n.delete(id)) n.add(id); return { ...s, sel: n, focus: id }; });
  const move = (d: number) => {
    if (!ids.length) return;
    const i = focus ? ids.indexOf(focus) : -1, j = i < 0 ? (d > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + d));
    setSt((s) => ({ ...s, focus: ids[j] }));
  };
  const chosen = sel.size ? chosenOf(m.items, sel).map((x) => x.p.id) : undefined;
  return { sel, focus, chosen, ids, toggle, move, clear: () => setSt({ sel: new Set(), focus: null }) };
}

export function ReleaseView({ phone }: ReleaseViewProps) {
  const m = useReleaseModel(), a = useReleaseActions(m, phone), ch = useChoice(m);
  const root = useRef<HTMLDivElement>(null);
  // the tab holds the focus so B and F reach it (the rest bubble to the page: 1-3, ? and Esc): on opening, and after a
  // render that dropped it (a button that went away) to the body or the page itself; focus anywhere else is left alone
  useEffect(() => { if (!phone) root.current?.focus({ preventScroll: true }); }, [phone]);
  useEffect(() => {
    const el = root.current, at = document.activeElement;
    if (!phone && el && (!at || at === document.body || at === el.closest('.lg-page'))) el.focus({ preventScroll: true });
  });
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (phone || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if ((t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') || t.closest('textarea, select')) return;
    const b = KEYMAP.release.find((k) => k.keys.some((x) => (x.length === 1 ? x.toLowerCase() : x) === (e.key.length === 1 ? e.key.toLowerCase() : e.key)));
    if (!b) return;
    // the choice keys stay here (the page would move its own table's focus); Esc clears a choice before it leaves the tab
    if (b.action === 'next' || b.action === 'prev' || b.action === 'select' || (b.action === 'escape' && ch.sel.size)) {
      if (b.action === 'select' && e.key === ' ' && t.closest('button, a, input')) return;
      e.preventDefault(); e.stopPropagation();
      if (b.action === 'escape') ch.clear();
      else if (!m.rel) { if (b.action === 'select') { const id = ch.focus ?? ch.ids[0]; if (id) ch.toggle(id); } else ch.move(b.action === 'next' ? 1 : -1); }
      return;
    }
    if (b.action !== 'build' && b.action !== 'finish' && b.action !== 'tag') return;
    e.preventDefault(); e.stopPropagation();
    const x = a.available.find((y) => y !== 'pr' && ACTION[y].key === b.action);
    if (x) a.run(x);
  };
  const n = m.items.length, sug = useSuggestion(m.T.ctx, suggestKey(m)), ver = m.rel?.version ?? sug.s?.version;
  return (
    <div ref={root} className={'tr-rel' + (phone ? ' phone' : '')} data-role="tr-rel" tabIndex={-1} onKeyDown={onKey}>
      <section aria-label="Package">
        <h3>Package · {m.landed.size ? `${n - m.landed.size} to cut · ${m.landed.size} landed outside a release${m.rel ? ' · v' + m.rel.version : ''}` : `${n} ${m.rel ? 'in v' + m.rel.version : 'accepted'}`}</h3>
        <VersionBox m={m} phone={phone} {...(ch.chosen ? { chosen: ch.chosen } : {})} onMade={ch.clear} />
        <Package m={m} phone={phone} pick={{ sel: ch.sel, focus: ch.focus, toggle: ch.toggle }} />
      </section>
      <section aria-label="Build">
        <h3>Build · Claude Code on your machine, your gh login</h3>
        <Stepper rel={m.rel} last={m.last} />
        {m.T.ctx.sim && !phone ? <SampleToggles sim={m.T.ctx.sim} /> : null}
        <Failures m={m} a={a} />
        <Preflight checks={a.checks} />
        <ActionsRow m={m} a={a} />
        <JobLog jobs={m.jobs} version={ver} n={n} status={m.rel?.status} />
        <NotesPreview m={m} version={ver} />
        <History m={m} />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- the header strip
/** The waiting items git says are already on the base branch, in words: "1 failed item already on master: 86fb968". */
export function onBaseWords(xs: readonly { status: string; sha: string }[], base: string): string {
  if (!xs.length) return '';
  const kind = xs.every((x) => x.status === 'failed') ? 'failed ' : xs.every((x) => x.status === 'done') ? 'built ' : '';
  const shas = xs.slice(0, 3).map((x) => x.sha.slice(0, 7)).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '');
  return `${xs.length} ${kind}item${xs.length === 1 ? '' : 's'} already on ${base}: ${shas}`;
}

/** The header band's three counters: Changed (items built), Waiting for you (done + failed, less what already landed on
 *  the base branch: named instead), Will ship (the draft). */
export function SummaryStrip() {
  const E = useEngine(), m = useReleaseModel(), T = m.T;
  const sug = useSuggestion(T.ctx, suggestKey(m));
  const c = useMemo(() => {
    const by = readingsBy(T.measurements);
    let built = 0, moved = 0, waiting = 0, failed = 0, rework = 0;
    const onBase: { status: string; sha: string }[] = [];
    for (const p of T.proposals) {
      if (!p.pack_id) continue;
      const on = isWaiting(p) ? landingOf(T.landed, p.id) : undefined;
      if (on) onBase.push({ status: p.status, sha: on.sha });
      else if (isWaiting(p)) { waiting++; if (p.status === 'failed') failed++; }
      if (p.status === 'rework') rework++;
      if (p.status === 'released' || p.status === 'executing') continue;
      built++;
      const e = by.get(p.id);
      if (e && verdictOf(p, e.before, e.after, T.lenses).verdict === 'moved') moved++;
    }
    return { built, moved, waiting, failed, rework, onBase: onBaseWords(onBase, T.landed?.state === 'known' ? T.landed.ref : 'main') };
  }, [T]);
  const v = m.rel?.version ?? sug.s?.version, n = m.items.length;
  const toPacks = () => { setLedgerUi((u) => (u.scope === 'packs' ? u : { ...u, scope: 'packs' })); E.setPage('ledger', 'triage'); };
  return (
    <div className="tr-sum" data-role="tr-sum" role="group" aria-label="Release summary">
      <button type="button" onClick={toPacks} title="Every built item, by its metric">
        <small>Changed</small><strong>{c.built}<em>items · {c.moved} moved</em></strong>
      </button>
      <button type="button" className="w" onClick={toPacks} title="Show what waits for a decision">
        <small>Waiting for you</small><strong>{c.waiting}<em>{c.failed} failed · {c.rework} in rework{c.onBase ? ' · ' + c.onBase : ''}</em></strong>
      </button>
      <button type="button" className="s" onClick={() => E.setPage('ledger', 'release')} title="Open the release (3)">
        <small>Will ship</small><strong>{v ? 'v' + v : '–'}<em>{n} item{n === 1 ? '' : 's'} · {m.rel ? STATUS_WORD[m.rel.status] : 'no draft'}</em></strong>
      </button>
    </div>
  );
}

/** The phone ledger's one read-only line about the open release ("Release v0.1.0 · building"), else nothing. */
export function ReleaseStatusLine() {
  const rel = openRelease(useTrain().releases);
  if (!rel) return null;
  return <p className="tr-rel-line" data-role="tr-rel-line">Release v{rel.version} · {STATUS_WORD[rel.status]}</p>;
}

