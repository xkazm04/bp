// The Release tab's history: tagged and failed releases (other than the open one), newest first, each its version,
// tag or failure, date, item count and PR link, then its items (a flagged one marked ⚑: it shipped failed or unmoved).
import { memo, useMemo } from 'react';
import type { Release } from '@bp/core/scan/types';
import { SampleTag } from '../ui/Marks.tsx';
import { evidenceOf, readingsBy, safeUrl, STATUS_WORD, type PkgItem, type ReleaseModel } from './releaseState';

const NONE: readonly PkgItem[] = [];
const when = (iso: string) => iso.slice(0, 10) + ' ' + iso.slice(11, 16);

const Entry = memo(function Entry({ r, items, sample }: { r: Release; items: readonly PkgItem[]; sample: boolean }) {
  // the store's URL only when it is safe to hand to an href (releaseState.ts safeUrl: http(s))
  const url = safeUrl(r.pr_url), pr = /\/pull\/(\d+)/.exec(url ?? '')?.[1];
  return (
    <li>
      <div className="hh">
        <b>v{r.version}</b>
        <span>{STATUS_WORD[r.status]}{r.tag ? ' · ' + r.tag : ''} · {when(r.updated_at)} · {items.length} item{items.length === 1 ? '' : 's'}</span>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer">PR {pr ? '#' + pr : 'link'}</a> : null}
        {sample ? <SampleTag /> : null}
      </div>
      {r.status === 'failed' && r.error ? <p className="err">{r.error}</p> : null}
      {items.length ? (
        <ul>{items.map((x) => (
          <li key={x.p.id}>{x.p.title}
            {x.flagged ? <small className="fl">⚑ shipped flagged{x.p.triage_note ? ': “' + x.p.triage_note + '”' : ''}</small> : null}
          </li>
        ))}</ul>
      ) : null}
    </li>
  );
});

export function History({ m }: { m: ReleaseModel }) {
  const sample = !!m.T.ctx.sim, T = m.T;
  const items = useMemo(() => {
    const by = readingsBy(T.measurements), out = new Map<string, PkgItem[]>();
    for (const p of T.proposals) if (p.release_id && m.history.some((r) => r.id === p.release_id)) {
      let a = out.get(p.release_id); if (!a) out.set(p.release_id, (a = [])); a.push(evidenceOf(p, by, T.lenses));
    }
    return out;
  }, [T, m.history]);
  return (
    <section className="tr-rel-hist" data-role="tr-rel-hist" aria-label="History">
      <h3>History · {m.history.length}</h3>
      {m.history.length ? (
        <ul className="hist">
          {m.history.map((r) => <Entry key={r.id} r={r} items={items.get(r.id) ?? NONE} sample={sample} />)}
        </ul>
      ) : <p className="tr-rel-none">No tagged release yet.</p>}
    </section>
  );
}
