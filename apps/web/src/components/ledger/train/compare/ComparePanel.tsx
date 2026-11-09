// The compare panel: one pack item's evidence beside the table, a judging sheet. The header names
// the item (lens, id, pack and place in it, feature, title) with prev / next, Wide and close; the body holds the evidence (the metric
// line or, for an item measured in baseline runs, the performance table, the screens: light / dark / both x side by
// side / slider / blink / change map, the commit and its diff) and the reasoning in a rail (what the measurement says: before, after
// and the reading on main now, trackOf with git's landings; the decision brief, BriefDrawer: precedent by what like approvals came
// to on main; the item's own text). Docked they stack; Wide sets them side by side, each scrolling, so the screens get the room; the
// footer carries the state mark over its triage note (or what the state means) and the decision strip (Decide,
// compact). It docks right at clamp(--cmp-min, 52%, --cmp-max) from 1100 px, overlays the table below that, and is a
// full-screen sheet on the phone. Full width takes the keyboard focus when it hides the table's focused row.
// Everything derives from useTrain(); the item's, the next item's and the pack mates' evidence are lookups in the one
// evidence index (compareOf over @bp/core/scan/evidence: one pass per table, so J/K reads no evidence again). The theme / mode (LedgerUi.cmp) and the width are the ledger store's, the rest
// resets when the item changes (the body is keyed by id). The next item's screens are prefetched while the browser idles.
// A rebuild reads the attempt it rebuilds (compare/attempts.ts attemptChain): its line in the measurement, and the
// screens' Against choice (LedgerUi.cmp.against), which the prefetch follows.
// Keys (L, M, W, J/K, Esc) are LedgerPage's handler.
import { memo, useEffect, useMemo, useRef } from 'react';
import { compareOf, type Comparison } from '@bp/core/scan/compare';
import type { Proposal } from '@bp/core/scan/types';
import { shotSrc } from '@bp/core/train/shots';
import type { LensDef } from '@bp/core/standard/load';
import { useEngine } from '../../../hooks';
import { byPackAge, isFlagged } from '@bp/core/train/rules';
import { setLedgerUi, useLedgerUi, type CompareAgainst, type CompareTheme, type CompareView } from '../../useLedger';
import { useTrain, type TrainData } from '../data';
import { Decide } from '../Decide';
import { BriefDrawer } from '../../BriefDrawer';
import { LensTag, SampleTag, StateMark } from '../ui/Marks.tsx';
import { STATE } from '../ui/tables';
import { Btn, Callout } from '../ui/Controls';
import { attemptChain, pairsFor, type Attempt } from './attempts';
import { CommitDiff } from './CommitDiff';
import { ItemText } from './ItemText';
import { Measurement } from './Measurement';
import { trackOf, type Track } from '@bp/core/scan/track';
import { landedOpts, scanOfTrain } from '../onMain';
import { MetricStrip } from './MetricStrip';
import { PerfKey, PerfTable, hasRuns, perfItem, perfReason } from './PerfTable';
import { Screens, shownPairs } from './Screens';
import './ComparePanel.css';

export interface ComparePanelProps {
  /** The pack item shown. */
  id: string;
  view: CompareView;
  wide: boolean;
  /** The phone shows the panel as a full-screen sheet. */
  phone: boolean;
  onView(v: CompareView): void;
  onWide(): void;
  onClose(): void;
}


/** Every pack item in the packs table's order: packs oldest first (rules.ts byPackAge), each pack's items as built (created_at, id). */
export function packOrder(T: Pick<TrainData, 'packs' | 'proposals'>): string[] {
  const by = new Map<string, Proposal[]>();
  for (const p of T.proposals) if (p.pack_id) { let a = by.get(p.pack_id); if (!a) by.set(p.pack_id, (a = [])); a.push(p); }
  const byCreated = (a: Proposal, b: Proposal) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);
  return [...T.packs].sort(byPackAge)
    .flatMap((k) => (by.get(k.id) ?? []).sort(byCreated).map((p) => p.id));
}

/** The second performance table's heading. Only the pack's items measured in two or more baseline runs can appear in
 *  it, so the heading carries that denominator: without it a pack of twelve reads as three items long. */
export const packHeading = (measured: number, total: number): string =>
  `The whole pack · ${measured} of ${total} item${total === 1 ? '' : 's'} measured in runs`;

/** The first sentence of the item's Summary (else its title): the state it designs, for the screens' callout. */
function stateLine(p: Proposal): string {
  const m = /##\s*Summary\s*\n+([\s\S]*?)(?:\n##\s|$)/.exec(p.body ?? '');
  const s = (m?.[1] ?? p.title).trim().split(/(?<=\.)\s/)[0];
  return s.replace(/\.$/, '');
}

export function ComparePanel({ id, view, wide, phone, onView, onWide, onClose }: ComparePanelProps) {
  const T = useTrain(), P = useEngine().M.P, pending = useLedgerUi(T.slug ?? 'kettle').pending;
  const c = useMemo(() => compareOf(T, id, T.lenses), [T, id]);
  const now = useMemo(() => trackOf(scanOfTrain(T), id, landedOpts(T)), [T, id]);
  const order = useMemo(() => packOrder(T), [T]);
  const at = order.indexOf(id), nextId = at >= 0 ? order[at + 1] : undefined;
  const next = useMemo(() => (nextId ? compareOf(T, nextId, T.lenses) : null), [T, nextId]);
  const prev = useMemo(() => attemptChain(T, id)[0] ?? null, [T, id]);
  const nextPrev = useMemo(() => (nextId ? attemptChain(T, nextId)[0] ?? null : null), [T, nextId]);
  const nameOf = useMemo(() => { const m = new Map(P.base.features.map((f) => [f.slug, f.name])); return (slug: string) => m.get(slug) ?? slug; }, [P]);
  usePrefetch(T.slug, next, nextPrev, view.theme, view.against);
  const box = useRef<HTMLElement>(null);
  useKeepKeys(box, wide);

  const cls = 'tr-cmp' + (wide ? ' wide' : '') + (phone ? ' phone' : '');
  if (!c) {
    return (
      <aside ref={box} tabIndex={-1} className={cls} data-role="tr-cmp" aria-label="Compare one item">
        <Head title="Item not found" meta={<span>{id}</span>} prev={null} next={null} wide={wide} phone={phone} onWide={onWide} onClose={onClose} />
        <div className="tr-cmp-b"><Callout tone="empty">This item is no longer in the store. Close the panel and pick another.</Callout></div>
      </aside>
    );
  }
  const p = c.p, fname = nameOf(p.feature);
  const pack = T.packs.find((k) => k.id === p.pack_id), mates = order.filter((x) => T.byId.get(x)?.pack_id === p.pack_id);
  const go = (to: string | undefined) => (to ? () => setLedgerUi((u) => ({ ...u, open: to, focus: to })) : null);
  const meta = (
    <>
      <LensTag id={p.lens} />
      <span>{p.id}</span>
      {pack ? <span>{pack.id} · item {mates.indexOf(p.id) + 1} of {mates.length}</span> : null}
      <span>{fname}</span>
      {T.slug === null ? <SampleTag /> : null}
    </>
  );
  return (
    <aside ref={box} tabIndex={-1} className={cls} data-role="tr-cmp" aria-label={'Compare ' + p.title}>
      <Head title={p.title} meta={meta} prev={go(at > 0 ? order[at - 1] : undefined)} next={go(nextId)} wide={wide} phone={phone} onWide={onWide} onClose={onClose} />
      <Body key={p.id} c={c} now={now} prev={prev} T={T} lens={P.LENS[p.lens]} nameOf={nameOf} view={view} onView={onView} wide={wide} />
      <footer className="tr-cmp-d">
        {/* the state mark (deciding while a decision is on its way) over its triage note, or what the state means */}
        <span className="st">
          <StateMark status={p.status} pending={pending.get(p.id) === p.status}
            flagged={p.status === 'accepted' && isFlagged({ status: p.triaged_from ?? p.status }, c.verdict)} />
          <span>{p.triage_note ? '“' + p.triage_note + '”' : STATE[p.status].hint}</span>
        </span>
        <Decide ids={[p.id]} compact />
      </footer>
    </aside>
  );
}

function Head({ title, meta, prev, next, wide, phone, onWide, onClose }: { title: string; meta: React.ReactNode; prev: (() => void) | null; next: (() => void) | null; wide: boolean; phone: boolean; onWide(): void; onClose(): void }) {
  return (
    <header className="tr-cmp-h">
      <div className="tt">
        <small>{meta}</small>
        <h3 data-role="tr-cmp-title">{title}</h3>
      </div>
      <div className="nav">
        <Btn size="nav" disabled={!prev} onClick={prev ?? undefined} title="Previous (K)" label="Previous item">↑</Btn>
        <Btn size="nav" disabled={!next} onClick={next ?? undefined} title="Next (J)" label="Next item">↓</Btn>
        {/* the phone's sheet is already the whole screen */}
        {phone ? null : <Btn size="nav" pressed={wide} onClick={onWide} title="Full width (W)" role="tr-nav-wide">{wide ? 'Narrow' : 'Wide'}</Btn>}
        <Btn size="nav" onClick={onClose} title="Close (Esc)" label="Close the compare panel">✕</Btn>
      </div>
    </header>
  );
}

interface BodyProps { c: Comparison; now: Track | null; prev: Attempt | null; T: TrainData; lens: LensDef | undefined; nameOf(slug: string): string; view: CompareView; onView(v: CompareView): void; wide: boolean }
const Body = memo(function Body({ c, now, prev, T, lens, nameOf, view, onView, wide }: BodyProps) {
  const p = c.p, runs = hasRuns(c), fname = nameOf(p.feature);
  const perf = useMemo(() => {
    if (!runs) return null;
    const me = perfItem(c, fname, lens);
    // the pack's other items measured in runs, below it, as the winner's "the whole pack"
    const all = p.pack_id ? T.proposals.filter((x) => x.pack_id === p.pack_id) : [];
    const mates = all.map((x) => (x.id === p.id ? c : compareOf(T, x.id, T.lenses))).filter((x): x is Comparison => !!x && hasRuns(x));
    return { me, total: all.length, all: mates.length > 1 ? mates.map((x) => (x === c ? me : perfItem(x, nameOf(x.p.feature), lens))) : [] };
  }, [runs, c, fname, lens, p.pack_id, p.id, T, nameOf]);

  return (
    <div className="tr-cmp-b">
      <div className="tr-cmp-ev" data-role="tr-cmp-ev">
      {perf ? (
        <section className="tr-sec" data-role="tr-cmp-perf">
          <h4>Performance · {p.metric}{T.slug === null ? <SampleTag>sample pack</SampleTag> : null}</h4>
          <PerfTable items={[perf.me]} />
          <PerfKey />
          <p className="tr-pt-why">{perfReason(perf.me)}</p>
        </section>
      ) : <MetricStrip c={c} field={p.metric ? lens?.F[p.metric] : undefined} />}
      {perf && perf.all.length ? <section className="tr-sec"><h4>{packHeading(perf.all.length, perf.total)}</h4><PerfTable items={perf.all} /></section> : null}
      {p.status === 'failed' ? (
        <div className="tr-sec"><Callout tone="flag"><b>✕ Build failed.</b><span>This item did not build, broke a gate or did not move its metric. Accepting it is allowed only with a note, and it ships flagged.</span></Callout></div>
      ) : null}
      {!perf || c.shots.length ? <Screens c={c} slug={T.slug} view={view} onView={onView} fname={fname} stateLine={stateLine(p)} prev={prev} /> : null}
      {p.commit_sha ? <CommitDiff ctx={T.ctx} product={T.slug ?? 'kettle'} sha={p.commit_sha} wide={wide} /> : (
        <section className="tr-sec"><h4>Commit</h4><p className="tr-dim">{p.status === 'failed' ? 'No commit: the build did not get that far.' : 'No commit recorded for this item.'}</p></section>
      )}
      </div>
      <div className="tr-cmp-rail" data-role="tr-cmp-rail">
      <Measurement c={c} now={now} prev={prev} />
      {/* the brief beside the judgement: how like approvals fared on main, the owner's declines, undo, cost */}
      <BriefDrawer id={p.id} className="tr-sec tr-brief" screen={false} />
      <section className="tr-sec"><h4>The item · {p.standard}</h4><ItemText body={p.body ?? p.title} /></section>
      </div>
    </div>
  );
});

/** Full width hides the table, and with it the focused row: the browser drops the focus to the body, where the page's
 *  keys (Esc, J/K, A R S U, L M W) no longer arrive. The panel takes it instead, inside the page that owns the keys. */
function useKeepKeys(box: React.RefObject<HTMLElement | null>, wide: boolean) {
  useEffect(() => {
    const at = document.activeElement;
    if (wide && box.current && (!at || at === document.body || !!at.closest('.lg-body'))) box.current.focus({ preventScroll: true });
  }, [box, wide]);
}

/** The sources the next item's screens will show: its pairs against what the view asks for (pairsFor: a rebuild
 *  against its previous attempt fetches that attempt's afters, never the base befores), in the view's theme. */
export function prefetchSrcs(slug: string | null, next: Comparison | null, prev: Attempt | null, view: Pick<CompareView, 'theme' | 'against'>): string[] {
  if (!next) return [];
  return shownPairs(pairsFor(next, prev, view.against).pairs, view.theme).flatMap((s) => [s.before, s.after]).filter((s) => s !== undefined).map((s) => shotSrc(slug, s));
}

/** While the browser idles, fetch the next item's shown screens (one Image per source), so J lands on decoded pixels;
 *  cancelled (callback and requests) when the open item, the theme or the Against choice changes. */
function usePrefetch(slug: string | null, next: Comparison | null, prev: Attempt | null, theme: CompareTheme, against: CompareAgainst | undefined) {
  const srcs = useMemo(() => prefetchSrcs(slug, next, prev, { theme, against }), [next, prev, theme, against, slug]);
  useEffect(() => {
    if (!srcs.length || typeof requestIdleCallback === 'undefined') return;
    const imgs: HTMLImageElement[] = [];
    const h = requestIdleCallback(() => { for (const s of srcs) { const i = new Image(); i.decoding = 'async'; i.src = s; imgs.push(i); } });
    return () => { cancelIdleCallback(h); for (const i of imgs) i.src = ''; };
  }, [srcs]);
}
