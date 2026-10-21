'use client';
// Feature x lens matrix: a row per feature with findings (map order), a column per lens (the registry, then any lens
// the findings name that the map does not enable). A cell counts the findings there by risk (▲ high, ◆ medium,
// ▽ low): a click selects them all (again: deselects). The row header selects the feature's findings across every
// lens, and the row's Dispatch sends its open ones in one click. The row's Table (or Enter) opens the triage table on
// that feature alone: the matrix finds where, the table reads what. J/K move between rows, Space selects the row.
// In the In packs scope the rows are the pack items' features and a cell shows each item's state mark (StateMark, the
// one drawing of a state; A/1's matrix), a click selecting those items; there is no Dispatch (packs are triaged).
import { matrixRows, riskBand, type Finding, type Ledger, type LensCol, type RiskBand } from '../useLedger';
import { StateMark } from '../train/ui/Marks.tsx';
import { LensGlyph } from './bits';

const BANDS: readonly RiskBand[] = ['high', 'medium', 'low'];
const MARK: Record<RiskBand, string> = { high: '▲', medium: '◆', low: '▽' };

function Cell({ items, lens, feat, L, act, packs }: { items: Finding[]; lens: LensCol; feat: string; L: Ledger; act: boolean; packs: boolean }) {
  if (!items.length) return <td className="lg-mc none"><span aria-hidden="true">·</span></td>;
  const ids = items.map((f) => f.p.id), all = ids.every((id) => L.ui.sel.has(id)), some = !all && ids.some((id) => L.ui.sel.has(id));
  // the cell is a three-state toggle (the `.part` ring is the third): 'mixed' is what says so, not a false pressed
  const pressed: boolean | 'mixed' = all ? true : some ? 'mixed' : false;
  if (packs) return (
    <td className={'lg-mc' + (all ? ' on' : some ? ' part' : '')}>
      <button type="button" tabIndex={act ? 0 : -1} aria-pressed={pressed} aria-label={lens.name + ' on ' + feat + ': ' + items.map((f) => f.p.id + ' ' + f.status).join(', ')}
        title={items.map((f) => f.p.id + ' ' + f.p.title + ' (' + f.status + ')').join('\n')} onClick={() => L.select(ids)}>
        <span className="lg-pkm">{items.map((f) => <StateMark key={f.p.id} status={f.status} form="glyph" />)}</span>
      </button>
    </td>
  );
  const n = Object.fromEntries(BANDS.map((b) => [b, items.filter((f) => riskBand(f.p.risk) === b).length])) as Record<RiskBand, number>;
  const said = BANDS.filter((b) => n[b]).map((b) => n[b] + ' ' + b).join(', ');
  return (
    <td className={'lg-mc' + (all ? ' on' : some ? ' part' : '')}>
      <button type="button" tabIndex={act ? 0 : -1} aria-pressed={pressed} aria-label={lens.name + ' on ' + feat + ': ' + said + ' risk'} title={items.map((f) => f.p.id + ' ' + f.p.title + ' (' + f.status + ')').join('\n')}
        onClick={() => L.select(ids)}>
        {BANDS.map((b) => (n[b] ? <span key={b} className={'r-' + b}><b aria-hidden="true">{MARK[b]}</b>{n[b]}</span> : null))}
      </button>
    </td>
  );
}

export function Matrix({ L }: { L: Ledger }) {
  const packs = L.ui.scope === 'packs', rows = matrixRows(L.scoped);
  const cols = L.lenses.filter((l) => l.enabled || l.n);
  const first = rows[0] ? 'feat:' + rows[0].slug : null, foc = L.ui.focus?.startsWith('feat:') && rows.some((r) => 'feat:' + r.slug === L.ui.focus) ? L.ui.focus : first;
  if (!rows.length) return <div className="lg-empty">{packs ? (L.items.length ? 'No pack item matches these filters.' : 'No packs yet: a lens execute builds them.') : L.all.length ? 'No finding matches these filters.' : 'No findings yet.'}</div>;
  return (
    <div className="lg-mx-wrap">
      <table className="lg-mx">
        <caption className="vh">{packs ? 'Pack items by feature and lens, by state' : 'Findings by feature and lens, counted by risk'}</caption>
        <thead>
          <tr>
            <th scope="col" className="lg-mf">Feature</th>
            {cols.map((l) => <th key={l.id} scope="col" title={l.name}><LensGlyph g={l.glyph} /><span>{l.short}</span></th>)}
            <th scope="col" className="lg-md"><span className="vh">Dispatch</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ids = r.items.map((f) => f.p.id), on = ids.every((id) => L.ui.sel.has(id)), open = r.items.filter((f) => f.can);
            const rowPressed: boolean | 'mixed' = on ? true : ids.some((id) => L.ui.sel.has(id)) ? 'mixed' : false;
            // the row in focus lets Tab into its cells and its Dispatch; J/K jump rows
            const key = 'feat:' + r.slug, act = foc === key;
            return (
              <tr key={r.slug} className={on ? 'on' : ''} data-fid={key} tabIndex={act ? 0 : -1} onFocus={() => L.setFocus(key)}>
                <th scope="row" className="lg-mf">
                  <button type="button" tabIndex={act ? 0 : -1} aria-pressed={rowPressed} title={'Select every finding on ' + r.name + ' (Space)'} onClick={() => { L.setFocus(key); L.select(ids); }}>
                    <b>{r.name}</b>{r.domain ? <span>{r.domain}</span> : null}
                  </button>
                </th>
                {cols.map((l) => <Cell key={l.id} items={r.items.filter((f) => f.p.lens === l.id)} lens={l} feat={r.name} L={L} act={act} packs={packs} />)}
                <td className="lg-md">
                  <button type="button" className="bt lg-drill" tabIndex={act ? 0 : -1} title={'Read the ' + r.items.length + ' findings on ' + r.name + ' in the triage table (Enter)'}
                    onClick={() => L.showInTable(r.slug)}>Table</button>
                  {packs ? null : <button type="button" className="bt lg-dsp" tabIndex={act ? 0 : -1} disabled={!open.length || L.busy} title={open.length ? 'Dispatch the ' + open.length + ' open findings on ' + r.name + ' across ' + new Set(open.map((f) => f.p.lens)).size + ' lenses' : 'Nothing open on this feature'}
                    onClick={() => void L.dispatchIds(open.map((f) => f.p.id))}>Dispatch {open.length || ''}</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
