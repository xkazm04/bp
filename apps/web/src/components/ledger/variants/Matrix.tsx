'use client';
// Feature x lens matrix: a row per feature with findings (map order), a column per lens (the registry, then any lens
// the findings name that the map does not enable). A cell counts the findings there by risk (▲ high, ◆ medium,
// ▽ low): a click selects them all (again: deselects). The row header selects the feature's findings across every
// lens, and the row's Dispatch sends its open ones in one click. The row's Table (or Enter) opens the triage table on
// that feature alone: the matrix finds where, the table reads what. J/K move between rows, Space selects the row.
// In the In packs scope the rows are the pack items' features and a cell shows each item's state mark (StateMark, the
// one drawing of a state; A/1's matrix), a click selecting those items; there is no Dispatch (packs are triaged).
// v5: the cell that holds a lens's MVP (useLedger lensMvps, the strip above the views) carries a ★ before its counts; a
// lens's reserve findings stay out of the counts while their group is collapsed (they are not ranked).
// Drawn as the sheet (2026-11-07): rows ruled into sections by domain, each with the wing's lettered head and stage bar; a cell's
// counts as the plan's markers, risk by shape first; a column head selects its lens. Table and Dispatch show on the row in hand, so
// the data outweighs the controls. In the Backlog a cell carries its findings to the wave dock and wears the number of the draft
// that holds them all.
import { memo, useContext, useMemo, useRef } from 'react';
import { matrixRows, riskBand, type Finding, type Ledger, type LensCol, type RiskBand } from '../useLedger';
import { StateMark } from '../train/ui/Marks.tsx';
import { Backlog, StageBar, carry, type CarryApi } from '../backlog/parts';
import { LensGlyph } from './bits';

const BANDS: readonly RiskBand[] = ['high', 'medium', 'low'];
const MARK: Record<RiskBand, string> = { high: '▲', medium: '◆', low: '▽' };

function Cell({ items, lens, feat, L, act, packs, mvp, api, placed }: { items: Finding[]; lens: LensCol; feat: string; L: Ledger; act: boolean; packs: boolean; mvp?: Finding; api: CarryApi | null; placed(ids: readonly string[]): number | undefined }) {
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
  // the lens's MVP sits here: a star before the counts (the MVPs strip names it)
  const star = mvp && items.includes(mvp) ? mvp : undefined, wave = placed(ids), can = ids.filter((id) => L.byId.get(id)?.can);
  return (
    <td className={'lg-mc' + (all ? ' on' : some ? ' part' : '') + (wave ? ' placed' : '')}>
      <button type="button" tabIndex={act ? 0 : -1} aria-pressed={pressed} {...(api && can.length ? carry(api, can[0], can) : {})} aria-label={lens.name + ' on ' + feat + ': ' + said + ' risk' + (star ? ', the lens MVP' : '') + (wave ? ', in draft wave ' + wave : '')} title={(star ? 'MVP of ' + lens.name + ': ' + star.p.title + '\n' : '') + items.map((f) => f.p.id + ' ' + f.p.title + ' (' + f.status + ')').join('\n')}
        onClick={() => L.select(ids)}>
        {star ? <span className="lg-mvpm" aria-hidden="true">★</span> : null}
        {BANDS.map((b) => (n[b] ? <span key={b} className={'r-' + b}><b aria-hidden="true">{MARK[b]}</b>{n[b]}</span> : null))}
        {wave ? <i className="lg-mc-w" aria-hidden="true">{wave}</i> : null}
      </button>
    </td>
  );
}

/** A feature's row. Its status and selection arrive as plain values through `L`'s stable parts. */
function Row({ r, cols, L, packs, act, mvpOf, api, placed }: { r: ReturnType<typeof matrixRows>[number]; cols: readonly LensCol[]; L: Ledger; packs: boolean; act: boolean; mvpOf: ReadonlyMap<string, Finding>; api: CarryApi | null; placed(ids: readonly string[]): number | undefined }) {
  const ids = r.items.map((f) => f.p.id), on = ids.every((id) => L.ui.sel.has(id)), open = r.items.filter((f) => f.can);
  const rowPressed: boolean | 'mixed' = on ? true : ids.some((id) => L.ui.sel.has(id)) ? 'mixed' : false;
  // the row in focus lets Tab into its cells and its Dispatch; J/K jump rows
  const key = 'feat:' + r.slug;
  return (
    <tr className={(on ? 'on' : '') + (act ? ' act' : '')} data-fid={key} tabIndex={act ? 0 : -1} onFocus={() => L.setFocus(key)}>
      <th scope="row" className="lg-mf">
        <button type="button" tabIndex={act ? 0 : -1} aria-pressed={rowPressed} title={'Select every finding on ' + r.name + ' (Space)'} onClick={() => { L.setFocus(key); L.select(ids); }}>
          <b>{r.name}</b><span>{r.items.length} {packs ? (r.items.length === 1 ? 'item' : 'items') : r.items.length === 1 ? 'finding' : 'findings'}</span>
        </button>
      </th>
      {cols.map((l) => {
        const mvp = packs ? undefined : mvpOf.get(l.id);
        return <Cell key={l.id} items={r.items.filter((f) => f.p.lens === l.id)} lens={l} feat={r.name} L={L} act={act} packs={packs} {...(mvp ? { mvp } : {})} api={api} placed={placed} />;
      })}
      <td className="lg-md">
        <button type="button" className="bt lg-drill" tabIndex={act ? 0 : -1} title={'Read the ' + r.items.length + ' findings on ' + r.name + ' in the triage table (Enter)'}
          onClick={() => L.showInTable(r.slug)}>Table</button>
        {packs || !L.writes ? null : <button type="button" className="bt lg-dsp" tabIndex={act ? 0 : -1} disabled={!open.length || L.busy} title={open.length ? 'Dispatch the ' + open.length + ' open findings on ' + r.name : 'Nothing on ' + r.name + ' can go'}
          onClick={() => void L.dispatchIds(open.map((f) => f.p.id))}>Dispatch {open.length || ''}</button>}
      </td>
    </tr>
  );
}

const Section = memo(function Section({ letter, name, items, span }: { letter: string; name: string; items: readonly Finding[]; span: number }) {
  return (
    <tr className="lg-mx-sec">
      <th colSpan={span} scope="rowgroup">
        <div><span className="sc-letter">{letter}</span><h3>{name || 'Not on the map'}</h3><em>{items.length}</em><StageBar items={items} /></div>
      </th>
    </tr>
  );
});

export function Matrix({ L }: { L: Ledger }) {
  const packs = L.ui.scope === 'packs', rows = useMemo(() => matrixRows(L.scoped), [L.scoped]);
  const cols = L.lenses.filter((l) => l.enabled || l.n);
  const mvpOf = useMemo(() => new Map(L.mvps.map((m) => [m.lens, m.f])), [L.mvps]);
  const B = useContext(Backlog)?.B ?? null;
  // sections in map order: a domain's first feature places it
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) { const a = m.get(r.domain); if (a) a.push(r); else m.set(r.domain, [r]); }
    return [...m].map(([name, rs]) => ({ name, rs, items: rs.flatMap((x) => x.items) }));
  }, [rows]);
  const selRef = useRef(L.ui.sel); selRef.current = L.ui.sel;
  const byRef = useRef(L.byId); byRef.current = L.byId;
  const api = useMemo<CarryApi | null>(() => (!B || packs ? null : { selected: () => selRef.current, titleOf: (id) => byRef.current.get(id)?.p.title ?? id, setDrag: B.setDrag, place: B.place, readOnly: B.readOnly }), [B, packs]);
  /** The draft holding every one of `ids`, by its place number. */
  const placed = (ids: readonly string[]): number | undefined => {
    if (!B || packs) return undefined;
    const at = ids.map((id) => B.spot.get(id));
    const first = at[0];
    return first?.draft && at.every((x) => x?.draft && x.wave.id === first.wave.id) ? first.n : undefined;
  };
  const first = rows[0] ? 'feat:' + rows[0].slug : null, foc = L.ui.focus?.startsWith('feat:') && rows.some((r) => 'feat:' + r.slug === L.ui.focus) ? L.ui.focus : first;
  if (!rows.length) return <div className="lg-empty">{packs ? (L.items.length ? 'No pack item matches these filters.' : 'No packs yet: a lens execute builds them.') : L.all.length ? 'No finding matches these filters.' : 'No findings yet. A lens scan proposes them; they appear here as it does.'}</div>;
  return (
    <div className="lg-mx-wrap">
      <table className="lg-mx">
        <caption className="vh">{packs ? 'Pack items by feature and lens, by state' : 'Findings by feature and lens, counted by risk'}</caption>
        <thead>
          <tr>
            <th scope="col" className="lg-mf">Feature</th>
            {cols.map((l) => {
              const ids = L.scoped.filter((f) => f.p.lens === l.id).map((f) => f.p.id), all = ids.length > 0 && ids.every((id) => L.ui.sel.has(id));
              return (
                <th key={l.id} scope="col" title={l.name}>
                  <button type="button" className="lg-mx-col" tabIndex={-1} disabled={!ids.length} aria-pressed={all} title={'Select every shown finding of ' + l.name} onClick={() => L.select(ids)}>
                    <i className="lg-mx-pin"><LensGlyph g={l.glyph} px={15} /></i><span>{l.short}</span><b>{ids.length}</b>
                  </button>
                </th>
              );
            })}
            <th scope="col" className="lg-md"><span className="vh">Dispatch</span></th>
          </tr>
        </thead>
        {groups.map((g, i) => (
          <tbody key={g.name} aria-label={g.name || 'Not on the map'}>
            <Section letter={String.fromCharCode(65 + (i % 26))} name={g.name} items={g.items} span={cols.length + 2} />
            {g.rs.map((r) => <Row key={r.slug} r={r} cols={cols} L={L} packs={packs} act={foc === 'feat:' + r.slug} mvpOf={mvpOf} api={api} placed={placed} />)}
          </tbody>
        ))}
      </table>
    </div>
  );
}
