// The Release tab's history: tagged and failed releases (other than the open one), newest first, each its version,
// tag or failure, date, item count and PR link, then its items (a flagged one marked ⚑: it shipped failed or unmoved).
// A merged or tagged release offers the owner's outcome watch (train/watch.ts: checkpoints 1, 7 and 30 days on, each a
// scoped scan per lens): Watch outcomes / Stop watching, and while it watches, each item's standing in words - pending,
// target met, shortfall, regression or unresolved - judged by watchState through the ledger's own tracking rules
// (onMain.ts landedOpts). Like every Release control it stays on under BP_WRITES=off (scan/writes.ts).
import { memo, useMemo, useState } from 'react';
import type { Release } from '@bp/core/scan/types';
import { watchState, type Watch, type WatchView } from '@bp/core/train/watch';
import { useWatches } from '@/lib/scan/watches';
import { SampleTag } from '../ui/Marks.tsx';
import { landedOpts, scanOfTrain } from '../onMain.ts';
import { evidenceOf, readingsBy, safeUrl, STATUS_WORD, type PkgItem, type ReleaseModel } from './releaseState';

const NONE: readonly PkgItem[] = [];
const when = (iso: string) => iso.slice(0, 10) + ' ' + iso.slice(11, 16);
const STATE_WORD = { pending: 'pending', met: 'target met', shortfall: 'shortfall', regression: 'regression', unresolved: 'unresolved' } as const;

/** The watch's one line: "Watching · met 2 · shortfall 1 · pending 1 · next checkpoint 2026-11-10". */
export function watchLine(v: WatchView): string {
  const parts = (Object.keys(STATE_WORD) as (keyof typeof STATE_WORD)[]).filter((k) => v.counts[k]).map((k) => STATE_WORD[k] + ' ' + v.counts[k]);
  return (v.on ? 'Watching' : 'Watch off') + (parts.length ? ' · ' + parts.join(' · ') : '') + (v.next ? ' · next checkpoint ' + v.next.slice(0, 10) : v.on ? ' · no checkpoint left' : '');
}

interface EntryProps { r: Release; items: readonly PkgItem[]; sample: boolean; view?: WatchView; canWatch: boolean; toggle(on: boolean): void; err?: string }
const Entry = memo(function Entry({ r, items, sample, view, canWatch, toggle, err }: EntryProps) {
  // the store's URL only when it is safe to hand to an href (releaseState.ts safeUrl: http(s))
  const url = safeUrl(r.pr_url), pr = /\/pull\/(\d+)/.exec(url ?? '')?.[1];
  const byItem = new Map(view?.on ? view.items.map((x) => [x.id, x]) : []);
  return (
    <li>
      <div className="hh">
        <b>v{r.version}</b>
        <span>{STATUS_WORD[r.status]}{r.tag ? ' · ' + r.tag : ''} · {when(r.updated_at)} · {items.length} item{items.length === 1 ? '' : 's'}</span>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer">PR {pr ? '#' + pr : 'link'}</a> : null}
        {sample ? <SampleTag /> : null}
        {canWatch ? (
          <button type="button" className="tr-btn tr-rel-watch" data-role="tr-rel-watch" aria-pressed={!!view?.on} onClick={() => toggle(!view?.on)}
            title={view?.on ? 'Stop the checkpoints (the record stays)' : 'Check each item against its target 1, 7 and 30 days on, with a scoped scan per lens'}>
            {view?.on ? 'Stop watching' : 'Watch outcomes'}
          </button>
        ) : null}
      </div>
      {r.status === 'failed' && r.error ? <p className="err">{r.error}</p> : null}
      {view ? <p className="tr-rel-watchline" data-role="tr-rel-watchline">{watchLine(view)}</p> : null}
      {err ? <p className="err">{err}</p> : null}
      {items.length ? (
        <ul>{items.map((x) => {
          const w = byItem.get(x.p.id);
          return (
            <li key={x.p.id}>{x.p.title}
              {x.flagged ? <small className="fl">⚑ shipped flagged{x.p.triage_note ? ': “' + x.p.triage_note + '”' : ''}</small> : null}
              {w ? <small className={'w ' + w.state} data-role="tr-rel-watch-item">{w.words}</small> : null}
            </li>
          );
        })}</ul>
      ) : null}
    </li>
  );
});

export function History({ m }: { m: ReleaseModel }) {
  const sample = !!m.T.ctx.sim, T = m.T;
  const W = useWatches(T.ctx, T.proposals, T.jobs);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const items = useMemo(() => {
    const by = readingsBy(T.measurements), out = new Map<string, PkgItem[]>();
    for (const p of T.proposals) if (p.release_id && m.history.some((r) => r.id === p.release_id)) {
      let a = out.get(p.release_id); if (!a) out.set(p.release_id, (a = [])); a.push(evidenceOf(p, by, T.lenses));
    }
    return out;
  }, [T, m.history]);
  // each watch judged once per change of the train's data (or the watches): the ledger's tracking rules, git's landings
  const views = useMemo(() => {
    const out = new Map<string, WatchView>();
    if (!W.list) return out;
    const scan = scanOfTrain(T), opts = landedOpts(T), now = Date.now();
    for (const w of W.list as readonly Watch[]) out.set(w.release, watchState(w, scan, opts, now, T.jobs));
    return out;
  }, [W.list, T]);
  const toggle = (id: string, on: boolean) => { void W.set(id, on).then((e) => setErrs((x) => { const n = { ...x }; if (e) n[id] = e; else delete n[id]; return n; })); };
  return (
    <section className="tr-rel-hist" data-role="tr-rel-hist" aria-label="History">
      <h3>History · {m.history.length}</h3>
      {m.history.length ? (
        <ul className="hist">
          {m.history.map((r) => <Entry key={r.id} r={r} items={items.get(r.id) ?? NONE} sample={sample} view={views.get(r.id)} err={errs[r.id]}
            canWatch={!!W.list && (r.status === 'tagged' || r.status === 'merged')} toggle={(on) => toggle(r.id, on)} />)}
        </ul>
      ) : <p className="tr-rel-none">No tagged release yet.</p>}
    </section>
  );
}
