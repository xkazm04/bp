'use client';
// A · View: a section nav on the left (Window, Modes, Whose desk, Health); every section stacked on the right at a
// reading size. The nav scrolls the detail to a section, and follows the detail's scroll.
import { useCallback, useMemo, useRef, useState } from 'react';
import { GA_MILESTONE, personLens, sheetOf } from '@bp/core/model';
import { Mark } from '../../Symbols';
import { shallowEqual, useBp, useEngine } from '../../hooks';
import { Fig, Row, Sec, swallow, useListRef, useWalk } from './shell';

const WIN = [
  { d: 1 as const, k: '24h', t: 'Last 24 hours', x: 'What moved since yesterday: the morning glance.' },
  { d: 7 as const, k: '7d', t: 'Last 7 days', x: 'The week: what a weekly review should see.' },
  { d: 14 as const, k: '14d', t: 'Last 14 days', x: 'Two weeks: a sprint, or catching up after time away.' },
];

export function View() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ delta: s.delta, ga: s.ga, blast: s.blast, who: s.who, simV: s.simV, t: s.t }), shallowEqual);
  const persons = M.P.people.filter((x) => x.kind === 'human');
  const desk = sim.has && persons.length > 0;
  const secs = useMemo(() => [
    { id: 'win', name: 'Window', sub: 'what changed' },
    { id: 'modes', name: 'Modes', sub: 'overlays on the plan' },
    ...(desk ? [{ id: 'desk', name: 'Whose desk', sub: 'read as a person' }] : []),
    { id: 'health', name: 'Health', sub: 'agents and trouble' },
  ], [desk]);
  const ids = useMemo(() => secs.map((x) => x.id), [secs]);
  const [sel, setSel] = useState('win');
  const listRef = useListRef(), det = useRef<HTMLDivElement>(null), jumping = useRef(0);
  const go = useCallback((id: string | null) => {
    if (!id) return;
    setSel(id);
    const el = det.current?.querySelector<HTMLElement>('#wbv-' + id);
    // reduced motion: the detail jumps to the section instead of travelling (docs/blueprint-ui.md). Read at the
    // moment of the scroll, as the engine does (engine/Engine.ts:153) and as sheet/Screens.tsx does.
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (el && det.current) { jumping.current = performance.now(); det.current.scrollTo({ top: el.offsetTop - 4, behavior: reduce ? 'auto' : 'smooth' }); }
  }, []);
  const onKey = useWalk(ids, sel, go, listRef);
  const whoRef = useRef<HTMLUListElement>(null);
  // the nav follows the reader's own scroll (not the one a nav click started)
  const onScroll = () => {
    const box = det.current; if (!box || performance.now() - jumping.current < 700) return;
    let best = ids[0];
    for (const id of ids) { const el = box.querySelector<HTMLElement>('#wbv-' + id); if (el && el.offsetTop - box.scrollTop < 80) best = id; }
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) best = ids[ids.length - 1];
    if (best !== sel) setSel(best);
  };

  const open = sim.has ? sim.openDecs() : [];
  const c = sim.has ? sim.tallyStatus() : null;
  const now = s.t === M.P.asOf;
  const h = now ? M.agg.healthOf('ALL', M.P.features, 'general') : null;
  const chg = M.agg.countsOf('ALL', M.P.features, s.t, s.delta).chg;
  const rows = [{ id: null as string | null, name: 'Everyone', sub: 'the whole product, all sheets', n: open.length }]
    .concat(persons.map((x) => ({ id: x.id, name: x.name, sub: x.title + ' · ' + sheetOf(M.P, personLens(M.P, x.id)).nm, n: open.filter((d) => d.decider === x.id).length })));
  const ga = M.P.MS[GA_MILESTONE];
  // "Whose desk" is a listbox of its own: one tab stop (roving tabindex, as the workbench's Row has) and its own
  // J/K, arrow and Home/End walk. The walk swallows the key, so it never reaches the section nav's walk above.
  // the roving tab stop never vanishes: a reader the list does not hold (removed from the map) falls back to Everyone
  const whoCur = rows.some((r) => (r.id || '') === (s.who || '')) ? s.who || null : null;
  const onWhoKey = useWalk(rows.map((r) => r.id), whoCur, (id) => E.setWho(id), whoRef);

  return (
    <div className="wb wb-view" onKeyDown={onKey}>
      <div className="wb-panes">
        <div className="wb-list" ref={listRef} role="region" aria-label="View sections">
          <ul role="listbox" aria-label="Sections">
            {secs.map((x) => (
              <Row key={x.id} id={x.id} on={sel === x.id} onPick={() => go(x.id)} cls="nav">
                <span className="rt one">{x.name}</span>
                <span className="rm"><span>{x.sub}</span><span>{x.id === 'win' ? (s.delta === 1 ? '24h' : s.delta + 'd') : x.id === 'modes' ? (s.ga ? 'GA on' : s.blast ? 'blast on' : 'off') : x.id === 'desk' ? (s.who ? persons.find((p) => p.id === s.who)?.name.split(' ')[0] : 'everyone') : h ? h.bad + ' bad' : ''}</span></span>
              </Row>
            ))}
          </ul>
          <p className="wb-tip"><kbd>J</kbd> <kbd>K</kbd> move between sections. <kbd>P</kbd> on the plan cycles whose desk.</p>
        </div>
        <div className="wb-detail" ref={det} onScroll={onScroll} aria-label="View settings" role="region">
          <div className="wb-scroll">
            <Sec id="wbv-win" head="Window · what changed" aside={chg + ' feature' + (chg === 1 ? '' : 's') + ' changed'}>
              <div className="wb-seg" role="group" aria-label="What changed: window">
                {WIN.map((w) => (
                  <button key={w.d} type="button" aria-pressed={s.delta === w.d} onClick={() => E.setDelta(w.d)}>
                    <b>{w.k}</b><span>{w.t}</span><small>{w.x}</small>
                  </button>
                ))}
              </div>
              <p className="wb-help">The window decides which tiles carry the <Mark k="delta" w={18} h={12} /> changed mark, the timeline’s span and the title block’s “changed” count.</p>
            </Sec>
            <Sec id="wbv-modes" head="Modes" aside="keys work on the plan">
              <div className="wb-modes">
                {E.hasGA && ga && (
                  <button type="button" className="wb-mode" aria-pressed={s.ga} onClick={() => E.toggleGA()}>
                    <span className="sw" aria-hidden="true"><i /></span>
                    <b>{ga.name} readiness</b><kbd>G</kbd>
                    <span className="x">Marks every feature {ga.name} needs and how far each is from done{ga.date ? ', against the ' + ga.date + ' date' : ''}. {ga.goal}</span>
                  </button>
                )}
                <button type="button" className="wb-mode" aria-pressed={!!s.blast} onClick={() => E.toggleBlast()}>
                  <span className="sw" aria-hidden="true"><i /></span>
                  <b>Blast radius</b><kbd>B</kbd>
                  <span className="x">Traces what depends on one feature (the open, selected or hovered one) and what it depends on, so a change’s reach is visible before it ships.{s.blast ? ' Showing: ' + (M.P.F[s.blast]?.name ?? s.blast) + '.' : ''}</span>
                </button>
              </div>
            </Sec>
            {desk && (
              <Sec id="wbv-desk" head="Whose desk" aside="open questions">
                <ul className="wb-who" role="listbox" aria-label="View as" ref={whoRef} onKeyDown={onWhoKey}>
                  {rows.map((r) => {
                    const on = (whoCur || '') === (r.id || '');
                    return (
                      <li key={r.id ?? 'all'} role="option" tabIndex={on ? 0 : -1} data-row={r.id ?? ''} aria-selected={on} className={on ? 'on' : ''}
                        onClick={() => E.setWho(r.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { swallow(e); E.setWho(r.id); } }}>
                        <span className="av" aria-hidden="true">{r.name.charAt(0)}</span><span className="nm">{r.name}<small>{r.sub}</small></span><b className="n">{r.n}</b>
                      </li>
                    );
                  })}
                </ul>
              </Sec>
            )}
            <Sec id="wbv-health" head="Health" aside={now ? 'now' : s.t}>
              <div className="wb-figs big">
                {c && <>
                  <Fig n={c.working} label={<><Mark k="work" w={18} h={12} /> working</>} tone="mint" />
                  <Fig n={c.waiting} label={<><Mark k="wait" w={18} h={12} /> waiting for a person</>} tone={c.waiting ? 'amber' : undefined} />
                  <Fig n={c.blocked} label={<><Mark k="block" w={18} h={12} /> blocked</>} tone={c.blocked ? 'red' : undefined} />
                  <Fig n={c.failed} label={<><Mark k="fail" w={18} h={12} /> failed</>} tone={c.failed ? 'red' : undefined} />
                  {c.paused ? <Fig n={c.paused} label={<><Mark k="paused" w={18} h={12} /> paused by you</>} /> : null}
                </>}
                <Fig n={h ? h.bad : '—'} label={<><Mark k="cloud" w={18} h={12} /> features in trouble</>} tone={h?.bad ? 'red' : undefined} title="Features bad under any lens" />
                <Fig n={chg} label={<><Mark k="delta" w={18} h={12} /> changed, {s.delta === 1 ? '24 h' : s.delta + ' days'}</>} />
              </div>
              {!c && <p className="none">No swarm data: agent figures are not available.</p>}
            </Sec>
          </div>
        </div>
      </div>
    </div>
  );
}
