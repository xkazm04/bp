// The compare panel: one pack item's evidence beside the table (the contest winner A/1's side sheet). The header names
// the item (lens, id, pack and place in it, feature, title) with prev / next, Wide and close; the body holds the metric
// line or, for an item measured in baseline runs, the performance table, the screens (light / dark / both x side by
// side / slider / blink / change map), what the measurement says, the commit and its diff, and the item's own text; the
// footer carries what the item's state means (or its triage note) and the decision strip (Decide, compact: its mark). It docks right at
// clamp(--cmp-min, 52%, --cmp-max) from 1100 px, overlays the table below that, and is a full-screen sheet on the phone.
// Everything derives from useTrain(); the theme / mode (LedgerUi.cmp) and the width are the ledger store's, the rest
// resets when the item changes (the body is keyed by id). The next item's screens are prefetched while the browser idles.
// Keys (L, M, W, J/K, Esc) are LedgerPage's handler; `nextView` is the L / M step it applies.
import { memo, useEffect, useMemo } from 'react';
import { compareOf, type Comparison } from '@/lib/scan/compare';
import type { Proposal } from '@/lib/scan/types';
import { shotSrc } from '@/lib/train/shots';
import type { LensDef } from '@/lib/standard/load';
import { useEngine } from '../../../hooks';
import { setLedgerUi, type CompareMode, type CompareTheme, type CompareView } from '../../useLedger';
import { useTrain, type TrainData } from '../data';
import { Decide } from '../Decide';
import { LensTag, SampleTag } from '../ui/Marks.tsx';
import { STATE } from '../ui/tables';
import { Callout } from '../ui/Controls';
import { CommitDiff } from './CommitDiff';
import { ItemText } from './ItemText';
import { Measurement } from './Measurement';
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

const THEME_ORDER: readonly CompareTheme[] = ['light', 'dark', 'both'];
const MODE_ORDER: readonly CompareMode[] = ['side', 'slider', 'blink', 'map'];
/** The view after one press of L (theme) or M (mode): the next in the cycle. */
export function nextView(v: CompareView, what: 'theme' | 'mode'): CompareView {
  if (what === 'theme') return { ...v, theme: THEME_ORDER[(THEME_ORDER.indexOf(v.theme) + 1) % THEME_ORDER.length] };
  return { ...v, mode: MODE_ORDER[(MODE_ORDER.indexOf(v.mode) + 1) % MODE_ORDER.length] };
}

/** Every pack item in the packs table's order: packs newest first, each pack's items as built (created_at, id). */
export function packOrder(T: Pick<TrainData, 'packs' | 'proposals'>): string[] {
  const by = new Map<string, Proposal[]>();
  for (const p of T.proposals) if (p.pack_id) { let a = by.get(p.pack_id); if (!a) by.set(p.pack_id, (a = [])); a.push(p); }
  const byCreated = (a: Proposal, b: Proposal) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);
  return [...T.packs].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .flatMap((k) => (by.get(k.id) ?? []).sort(byCreated).map((p) => p.id));
}

type Scan = Parameters<typeof compareOf>[0];
/** The scan tables compareOf reads, from the train's data (copied once per change: compareOf takes mutable arrays). */
function useScan(T: TrainData): Scan {
  return useMemo(() => ({ proposals: [...T.proposals], measurements: [...T.measurements], shots: [...T.shots] }), [T.proposals, T.measurements, T.shots]);
}

/** The first sentence of the item's Summary (else its title): the state it designs, for the screens' callout. */
function stateLine(p: Proposal): string {
  const m = /##\s*Summary\s*\n+([\s\S]*?)(?:\n##\s|$)/.exec(p.body ?? '');
  const s = (m?.[1] ?? p.title).trim().split(/(?<=\.)\s/)[0];
  return s.replace(/\.$/, '');
}

export function ComparePanel({ id, view, wide, phone, onView, onWide, onClose }: ComparePanelProps) {
  const T = useTrain(), P = useEngine().M.P, scan = useScan(T);
  const c = useMemo(() => compareOf(scan, id, T.lenses), [scan, id, T.lenses]);
  const order = useMemo(() => packOrder(T), [T]);
  const at = order.indexOf(id), nextId = at >= 0 ? order[at + 1] : undefined;
  const next = useMemo(() => (nextId ? compareOf(scan, nextId, T.lenses) : null), [scan, nextId, T.lenses]);
  const nameOf = useMemo(() => { const m = new Map(P.base.features.map((f) => [f.slug, f.name])); return (slug: string) => m.get(slug) ?? slug; }, [P]);
  usePrefetch(T.slug, next, view.theme);

  const cls = 'tr-cmp' + (wide ? ' wide' : '') + (phone ? ' phone' : '');
  if (!c) {
    return (
      <aside className={cls} data-role="tr-cmp" aria-label="Compare one item">
        <Head title="Item not found" meta={<span>{id}</span>} prev={null} next={null} wide={wide} onWide={onWide} onClose={onClose} />
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
    <aside className={cls} data-role="tr-cmp" aria-label={'Compare ' + p.title}>
      <Head title={p.title} meta={meta} prev={go(at > 0 ? order[at - 1] : undefined)} next={go(nextId)} wide={wide} onWide={onWide} onClose={onClose} />
      <Body key={p.id} c={c} T={T} scan={scan} lens={P.LENS[p.lens]} nameOf={nameOf} view={view} onView={onView} wide={wide} />
      <footer className="tr-cmp-d">
        {/* Decide's compact strip carries the state mark (with its pending state); the line says what it means */}
        <span className="st">{p.triage_note ? '“' + p.triage_note + '”' : STATE[p.status].hint}</span>
        <Decide ids={[p.id]} compact />
      </footer>
    </aside>
  );
}

function Head({ title, meta, prev, next, wide, onWide, onClose }: { title: string; meta: React.ReactNode; prev: (() => void) | null; next: (() => void) | null; wide: boolean; onWide(): void; onClose(): void }) {
  return (
    <header className="tr-cmp-h">
      <div className="tt">
        <small>{meta}</small>
        <h3 data-role="tr-cmp-title">{title}</h3>
      </div>
      <div className="nav">
        <button type="button" className="tr-nb" disabled={!prev} onClick={prev ?? undefined} title="Previous (K)" aria-label="Previous item">↑</button>
        <button type="button" className="tr-nb" disabled={!next} onClick={next ?? undefined} title="Next (J)" aria-label="Next item">↓</button>
        <button type="button" className="tr-nb wd" aria-pressed={wide} onClick={onWide} title="Full width (W)">{wide ? 'Narrow' : 'Wide'}</button>
        <button type="button" className="tr-nb" onClick={onClose} title="Close (Esc)" aria-label="Close the compare panel">✕</button>
      </div>
    </header>
  );
}

interface BodyProps { c: Comparison; T: TrainData; scan: Scan; lens: LensDef | undefined; nameOf(slug: string): string; view: CompareView; onView(v: CompareView): void; wide: boolean }
const Body = memo(function Body({ c, T, scan, lens, nameOf, view, onView, wide }: BodyProps) {
  const p = c.p, runs = hasRuns(c), fname = nameOf(p.feature);
  const perf = useMemo(() => {
    if (!runs) return null;
    const me = perfItem(c, fname, lens);
    // the pack's other items measured in runs, below it, as the winner's "the whole pack"
    const all = p.pack_id ? T.proposals.filter((x) => x.pack_id === p.pack_id) : [];
    const mates = all.map((x) => (x.id === p.id ? c : compareOf(scan, x.id, T.lenses))).filter((x): x is Comparison => !!x && hasRuns(x));
    return { me, all: mates.length > 1 ? mates.map((x) => (x === c ? me : perfItem(x, nameOf(x.p.feature), lens))) : [] };
  }, [runs, c, fname, lens, p.pack_id, p.id, T.proposals, T.lenses, scan, nameOf]);

  return (
    <div className="tr-cmp-b">
      {perf ? (
        <section className="tr-sec" data-role="tr-cmp-perf">
          <h4>Performance · {p.metric}{T.slug === null ? <SampleTag>sample pack</SampleTag> : null}</h4>
          <PerfTable items={[perf.me]} />
          <PerfKey />
          <p className="tr-pt-why">{perfReason(perf.me)}</p>
        </section>
      ) : <MetricStrip c={c} field={p.metric ? lens?.F[p.metric] : undefined} />}
      {perf && perf.all.length ? <section className="tr-sec"><h4>The whole pack</h4><PerfTable items={perf.all} /></section> : null}
      {p.status === 'failed' ? (
        <div className="tr-sec"><Callout tone="flag"><b>✕ Build failed.</b><span>This item did not build, broke a gate or did not move its metric. Accepting it is allowed only with a note, and it ships flagged.</span></Callout></div>
      ) : null}
      {!perf || c.shots.length ? <Screens c={c} slug={T.slug} view={view} onView={onView} fname={fname} stateLine={stateLine(p)} /> : null}
      <Measurement c={c} />
      {p.commit_sha ? <CommitDiff ctx={T.ctx} product={T.slug ?? 'kettle'} sha={p.commit_sha} initiallyOpen={wide} /> : (
        <section className="tr-sec"><h4>Commit</h4><p className="tr-dim">{p.status === 'failed' ? 'No commit: the build did not get that far.' : 'No commit recorded for this item.'}</p></section>
      )}
      <section className="tr-sec"><h4>The item · {p.standard}</h4><ItemText body={p.body ?? p.title} /></section>
    </div>
  );
});

/** While the browser idles, fetch the next item's shown screens (one Image per source), so J lands on decoded pixels;
 *  cancelled (callback and requests) when the open item or the theme changes. */
function usePrefetch(slug: string | null, next: Comparison | null, theme: CompareTheme) {
  const srcs = useMemo(() => (next ? shownPairs(next.shots, theme).flatMap((s) => [s.before, s.after]).filter((s) => s !== undefined).map((s) => shotSrc(slug, s)) : []), [next, theme, slug]);
  useEffect(() => {
    if (!srcs.length || typeof requestIdleCallback === 'undefined') return;
    const imgs: HTMLImageElement[] = [];
    const h = requestIdleCallback(() => { for (const s of srcs) { const i = new Image(); i.decoding = 'async'; i.src = s; imgs.push(i); } });
    return () => { cancelIdleCallback(h); for (const i of imgs) i.src = ''; };
  }, [srcs]);
}
