// The ledger's Release tab: the version (suggested, with its reason), the package of accepted items by lens (flagged
// ones with their notes), the stepper draft -> building -> pr-open -> merged -> tagged driven by the release row and its
// job from the stream, the job log, the notes the release will publish, the failure states, and the history of past
// releases. Build and Finish start the Claude Code job (a live product: the CLI with the user's gh login; Kettle: the
// scan sim's sample job through the same actions); nothing here simulates a step. On the phone the tab is read-only.
// Also the header's summary strip and the phone's one-line release status. What a status allows is releaseState.ts's
// table; the progress comes only from the stream (the release rows and the jobs list), never from polling.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Proposal } from '@bp/core/scan/types';
import type { ScanJob } from '@bp/core/scan/jobs';
import { buildRelease, finishRelease, refusalText } from '@/lib/scan/actions';
import { releaseItems, unreleased, verdictOf } from '@bp/core/scan/compare';
import { isWaiting } from '@bp/core/train/rules';
import { useEngine } from '../../../hooks';
import { setLedgerUi } from '../../useLedger';
import { KEYMAP } from '../keymap';
import { useTrain } from '../data';
import { Callout } from '../ui/Controls';
import {
  ACTION, RELEASE_STATE, evidenceOf, failedStep, historyOf, isActive, jobsOf, keysOf, openRelease, readingsBy, standLine,
  standOf, STEPS, type ReleaseModel, type RelAction,
} from './releaseState';
import { VersionBox, suggestKey, useSuggestion } from './VersionBox';
import { Btn } from '../ui/Controls';
import { Package } from './Package';
import { Stepper } from './Stepper';
import { JobLog } from './JobLog';
import { NotesPreview } from './NotesPreview';
import { History } from './History';
import { SampleToggles } from './SampleToggles';
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
    const m: ReleaseModel = { T, jobs, items, free: free.length, history: historyOf(T.releases, rel) };
    if (rel) m.rel = rel;
    if (jobs.length) m.last = jobs[jobs.length - 1];
    return m;
  }, [T]);
}

// ------------------------------------------------------------------------------------------- actions
export interface ReleaseActions {
  /** What can be done now (none while a job runs or a request is on its way). */
  available: readonly RelAction[];
  /** The Finish confirm from pr-open is showing. */
  asking: boolean;
  busy: boolean;
  err: { status?: number; text: string } | null;
  run(a: RelAction): void;
  cancelAsk(): void;
}

function useReleaseActions(m: ReleaseModel, phone: boolean): ReleaseActions {
  const ctx = m.T.ctx, rel = m.rel;
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  // the job a request started, until the jobs list has it (a live jobs event can trail the 202)
  const [sent, setSent] = useState<{ rel: string; job: string } | null>(null);
  const [err, setErr] = useState<{ status?: number; text: string } | null>(null);
  const busy = sending || (!!sent && sent.rel === rel?.id && !m.jobs.some((j) => j.id === sent.job)) || isActive(m.last);
  const st = rel ? RELEASE_STATE[rel.status] : undefined;
  const available: RelAction[] = phone || !rel || !st || busy ? [] : asking ? ['finish']
    : st.actions.filter((a) => (a !== 'sampleMerge' || !!ctx.sim) && (a !== 'pr' || !!rel.pr_url));
  const go = async (id: string, start: () => Promise<ScanJob>) => {
    setErr(null); setSending(true);
    try { const j = await start(); setSent({ rel: id, job: j.id }); } catch (e) {
      const s = (e as { status?: number }).status;
      setErr(s === undefined ? { text: refusalText(e) } : { status: s, text: refusalText(e) });
    } finally { setSending(false); setAsking(false); }
  };
  const run = (a: RelAction) => {
    if (!rel || !available.includes(a)) return;
    if (a === 'build' || a === 'retry') void go(rel.id, () => buildRelease(ctx, rel.id));
    else if (a === 'finish') void go(rel.id, () => finishRelease(ctx, rel.id));
    else if (a === 'finishAsk') { setErr(null); setAsking(true); }
    else if (a === 'sampleMerge') {
      try { ctx.sim?.sampleMerge(rel.id); setErr(null); } catch (e) { setErr({ text: refusalText(e) }); }
    }
  };
  return { available, asking, busy, err, run, cancelAsk: () => setAsking(false) };
}

const ActionsRow = memo(function ActionsRow({ m, a }: { m: ReleaseModel; a: ReleaseActions }) {
  const rel = m.rel;
  if (!rel) return null;
  const v = rel.version;
  return (
    <>
      <div className="tr-rel-acts">
        {a.asking ? (
          <span className="tr-rel-ask" role="group" aria-label="Finish the release">
            <span>Merged on GitHub? Finish tags v{v} and publishes the release.</span>
            <Btn tone="go" kbd={keysOf('finish')} onClick={() => a.run('finish')} disabled={!a.available.includes('finish')}>Finish</Btn>
            <Btn onClick={a.cancelAsk}>Not yet</Btn>
          </span>
        ) : a.available.map((x) => x === 'pr'
          ? <a key={x} className="tr-rel-pr" href={rel.pr_url} target="_blank" rel="noreferrer">⇱ {prName(rel.pr_url)}{m.T.ctx.sim ? ' · sample' : ''}</a>
          : <Btn key={x} tone={ACTION[x].go ? 'go' : undefined} kbd={keysOf(ACTION[x].key)} onClick={() => a.run(x)} disabled={x === 'build' && !m.items.length}>{ACTION[x].label(v)}</Btn>)}
      </div>
      <p className="tr-rel-hint">{a.busy && !isActive(m.last) ? 'Starting the release job…' : standLine(standOf(rel, m.last), rel, m.last, m.items.length)}</p>
    </>
  );
});

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

export function ReleaseView({ phone }: ReleaseViewProps) {
  const m = useReleaseModel(), a = useReleaseActions(m, phone);
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
    const b = KEYMAP.release.find((k) => k.keys.some((x) => x.toLowerCase() === e.key.toLowerCase()));
    if (!b || (b.action !== 'build' && b.action !== 'finish')) return;
    e.preventDefault(); e.stopPropagation();
    const x = a.available.find((y) => y !== 'pr' && ACTION[y].key === b.action);
    if (x) a.run(x);
  };
  const n = m.items.length, sug = useSuggestion(m.T.ctx, suggestKey(m)), ver = m.rel?.version ?? sug.s?.version;
  return (
    <div ref={root} className={'tr-rel' + (phone ? ' phone' : '')} data-role="tr-rel" tabIndex={-1} onKeyDown={onKey}>
      <section aria-label="Package">
        <h3>Package · {n} {m.rel ? 'in v' + m.rel.version : 'accepted'}</h3>
        <VersionBox m={m} phone={phone} />
        <Package m={m} phone={phone} />
      </section>
      <section aria-label="Build">
        <h3>Build · Claude Code on your machine, your gh login</h3>
        <Stepper rel={m.rel} last={m.last} />
        {m.T.ctx.sim && !phone ? <SampleToggles sim={m.T.ctx.sim} /> : null}
        <Failures m={m} a={a} />
        <ActionsRow m={m} a={a} />
        <JobLog jobs={m.jobs} version={ver} n={n} status={m.rel?.status} />
        <NotesPreview m={m} version={ver} />
        <History m={m} />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- the header strip
/** The header band's three counters: Changed (items built), Waiting for you (done + failed), Will ship (the draft). */
export function SummaryStrip() {
  const E = useEngine(), m = useReleaseModel(), T = m.T;
  const sug = useSuggestion(T.ctx, suggestKey(m));
  const c = useMemo(() => {
    const by = readingsBy(T.measurements);
    let built = 0, moved = 0, waiting = 0, failed = 0, rework = 0;
    for (const p of T.proposals) {
      if (!p.pack_id) continue;
      if (p.status === 'failed') failed++;
      if (p.status === 'rework') rework++;
      if (isWaiting(p)) waiting++;
      if (p.status === 'released' || p.status === 'executing') continue;
      built++;
      const e = by.get(p.id);
      if (e && verdictOf(p, e.before, e.after, T.lenses).verdict === 'moved') moved++;
    }
    return { built, moved, waiting, failed, rework };
  }, [T]);
  const v = m.rel?.version ?? sug.s?.version, n = m.items.length;
  const toPacks = () => { setLedgerUi((u) => (u.scope === 'packs' ? u : { ...u, scope: 'packs' })); E.setPage('ledger', 'triage'); };
  return (
    <div className="tr-sum" data-role="tr-sum" role="group" aria-label="Release summary">
      <button type="button" onClick={toPacks} title="Every built item, by its metric">
        <small>Changed</small><strong>{c.built}<em>items · {c.moved} moved</em></strong>
      </button>
      <button type="button" className="w" onClick={toPacks} title="Show what waits for a decision">
        <small>Waiting for you</small><strong>{c.waiting}<em>{c.failed} failed · {c.rework} in rework</em></strong>
      </button>
      <button type="button" className="s" onClick={() => E.setPage('ledger', 'release')} title="Open the release (3)">
        <small>Will ship</small><strong>{v ? 'v' + v : '–'}<em>{n} item{n === 1 ? '' : 's'} · {m.rel?.status ?? 'no draft'}</em></strong>
      </button>
    </div>
  );
}

/** The phone ledger's one read-only line about the open release ("Release v0.1.0 · building"), else nothing. */
export function ReleaseStatusLine() {
  const rel = openRelease(useTrain().releases);
  if (!rel) return null;
  return <p className="tr-rel-line" data-role="tr-rel-line">Release v{rel.version} · {rel.status}</p>;
}

