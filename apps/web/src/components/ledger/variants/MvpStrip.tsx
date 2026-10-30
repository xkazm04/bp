'use client';
// The lens MVPs strip (scan-finding/1 "mvp"): above the Backlog's table and matrix, one card per lens with an open finding,
// in the lens column order. A card is that lens's MVP (useLedger lensMvps): its latest run's `mvp` finding while it is still
// open, else its top open finding by worth (a pre-v5 lens's top estimate, shown est.). It shows the lens glyph and name, the
// title, the score (the stored one; est. / unscored never 0), impact / effort / risk, and the scan's `mvp_why` when the MVP
// is an override of the top score. A click focuses and selects the finding in the table (Enter on it opens its feature);
// the matrix marks the same finding's cell with a star. Reserve and ranked counts per lens sit on the card: reserve is
// never counted as ranked.
import { memo } from 'react';
import { worthText } from '@bp/core/scan/score';
import type { Ledger, LensMvp } from '../useLedger';
import { LensGlyph } from './bits';

const Card = memo(function Card({ m, glyph, name, ranked, reserve, on, onPick }: {
  m: LensMvp; glyph: Parameters<typeof LensGlyph>[0]['g']; name: string; ranked: number; reserve: number; on: boolean; onPick(id: string): void;
}) {
  const p = m.f.p, why = p.mvp_rule === 'override' ? p.mvp_why : undefined;
  const facts = [p.impact !== undefined ? 'impact ' + p.impact : '', p.effort !== undefined ? 'effort ' + p.effort : '', p.risk !== undefined ? 'risk ' + p.risk : ''].filter(Boolean).join(' · ');
  return (
    <li className={'lg-mvp' + (on ? ' on' : '')} data-mvp={m.lens}>
      <button type="button" onClick={() => onPick(p.id)} aria-pressed={on}
        title={(m.from === 'mvp' ? 'The scan\'s MVP for ' + name + (p.mvp_rule ? ' (' + p.mvp_rule + ')' : '') : 'No open MVP from the latest run: the top open finding of ' + name) + ' · ' + p.id}>
        <span className="lg-mvp-h"><LensGlyph g={glyph} />{name}<small>{ranked} ranked{reserve ? ' · ' + reserve + ' in reserve' : ''}</small></span>
        <span className="lg-mvp-t">{p.title}</span>
        <span className="lg-mvp-f"><b className={'k-' + m.f.w.kind}>{worthText(m.f.w)}</b>{facts}</span>
        {why ? <span className="lg-mvp-w">{why}</span> : null}
      </button>
    </li>
  );
});

export function MvpStrip({ L }: { L: Ledger }) {
  if (!L.mvps.length) return null;
  const counts = new Map<string, { ranked: number; reserve: number }>();
  for (const f of L.all) {
    const c = counts.get(f.p.lens) ?? { ranked: 0, reserve: 0 };
    if (f.w.band === 'reserve') c.reserve++; else c.ranked++;
    counts.set(f.p.lens, c);
  }
  const meta = new Map(L.lenses.map((l) => [l.id, l]));
  const pick = (id: string) => { L.setFocus(id); if (!L.ui.sel.has(id)) L.toggle(id); };
  return (
    <section className="lg-mvps" aria-label="Lens MVPs">
      <ul>
        {L.mvps.map((m) => {
          const l = meta.get(m.lens), c = counts.get(m.lens) ?? { ranked: 0, reserve: 0 };
          return <Card key={m.lens} m={m} glyph={l?.glyph ?? null} name={l?.name ?? m.lens} ranked={c.ranked} reserve={c.reserve} on={L.ui.focus === m.f.p.id} onPick={pick} />;
        })}
      </ul>
    </section>
  );
}
