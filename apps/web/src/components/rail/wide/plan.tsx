'use client';
// A · Plan: the list is the room schedule when the camera is in a room or bay, else the features in trouble (or
// every feature) grouped by wing and room. The detail reads the selected feature (stage, each lens's health and why,
// agents and questions on it) or, with the overview row selected, the legend, trouble by lens, title block and keys.
import { useEffect, useMemo, useState } from 'react';
import type { Stage } from '@bp/core/data';
import { STAGE_WORD, astat, fmtWait, healthUnder, sheetOf, stageAt, type BayNode, type RoomNode } from '@bp/core/model';
import { Legend } from '../../Legend';
import { Mark, PatternDefs, StageSym, agentMark } from '../../Symbols';
import { shallowEqual, useBp, useEngine, useVariant } from '../../hooks';
import { HINT, HINT_LIVE, TitleBlock } from '../panels';
import { Group, Row, Sec, Workbench, swallow, useListRef, useWalk } from './shell';

type Feat = ReturnType<typeof useEngine>['M']['P']['features'][number];
const HW: Record<string, string> = { good: 'Good', watch: 'Watch', bad: 'Bad', unmeasured: 'Not measured', na: 'Does not apply' };

export function Plan() {
  const E = useEngine(), M = E.M;
  const s = useBp((s) => ({ view: s.view, place: s.place, ga: s.ga, blast: s.blast, key: s.key, t: s.t, simV: s.simV }), shallowEqual);
  const [mode, setMode] = useState<'trouble' | 'all'>('trouble');
  const [sel, setSel] = useState<string | null>(null);
  const listRef = useListRef();
  useEffect(() => () => E.setHl(null), [E]);

  const deep = s.place.find((c) => c.t === 'room' || c.t === 'bay');
  const room = deep && !s.ga && !s.blast ? (deep.t === 'bay' ? (E.placeById('bay', deep.id) as BayNode | null)?.room : (E.placeById('room', deep.id) as RoomNode | null)) ?? null : null;

  // the groups the list shows: the room's bays, else wing / room groups of the features in trouble (or all)
  const groups = useMemo(() => {
    if (room) return room.bays.map((b) => ({ id: b.id, head: b.name, fs: b.tiles.map((T) => T.f) }));
    const out: { id: string; head: string; fs: Feat[] }[] = [];
    for (const w of M.L.wings) for (const r of w.rooms) {
      const fs = mode === 'all' ? r.feats : r.feats.filter((f) => (s.key ? f.trouble.some((t) => t.lens === s.key) : f.trouble.length));
      if (fs.length) out.push({ id: r.id, head: (M.P.scale > 1 ? w.bld.b.short + ' · ' : '') + w.def.name + ' · ' + (r.name), fs: mode === 'all' ? fs : fs.slice().sort((a, b) => rank(a) - rank(b)) });
    }
    return out;
  }, [room, M, mode, s.key]);
  const ids = useMemo(() => [null as string | null, ...groups.flatMap((g) => g.fs.map((f) => f.id))], [groups]);
  const cur = sel && ids.includes(sel) ? sel : null;
  const onKey = useWalk(ids, cur, setSel, listRef);
  const n = ids.length - 1, now = s.t === M.P.asOf;

  const list = (
    <>
      <PatternDefs />
      <ul role="listbox" aria-label="Overview" className="wb-solo">
        <Row id={null} on={cur === null} onPick={() => setSel(null)} cls="ov">
          <span className="rt">Legend and keys</span>
          <span className="rm"><span>sheet {sheetOf(M.P, s.view).no} · trouble by lens · title block</span></span>
        </Row>
      </ul>
      {groups.length ? groups.map((g) => (
        <Group key={g.id} head={g.head} n={g.fs.length} label={g.head}>
          {g.fs.map((f) => {
            const st: Stage | null = stageAt(f, s.t, M.P.asOf), hl = healthUnder(f, s.view), ag = M.sim.has ? (M.sim.AGF[f.id] || []).length : 0;
            return (
              <Row key={f.id} id={f.id} on={cur === f.id} onPick={() => setSel(f.id)} cls={'ft' + (now ? ' h-' + hl : '')}
                onEnter={() => E.setHl(f.id)} onLeave={() => E.setHl(null)}>
                <span className="sy"><StageSym st={st} w={22} h={14} /></span>
                <span className="rt one">{f.name}</span>
                <span className="rm"><span>{st ? STAGE_WORD[st] : 'Stage unknown'}{ag ? ' · ' + ag + ' agent' + (ag === 1 ? '' : 's') : ''}</span>
                  {now && f.trouble.length ? <span className="tr">{f.trouble.slice(0, 3).map((t) => <b key={t.lens} className={t.h} title={(M.P.LENS[t.lens]?.name ?? t.lens) + ': ' + t.h}>{M.P.LENS[t.lens]?.short ?? t.lens}</b>)}</span> : null}</span>
              </Row>
            );
          })}
        </Group>
      )) : <div className="wb-empty"><b>Nothing in trouble</b>{s.key ? 'No feature is bad or to watch under this lens.' : 'No feature is bad or to watch under any lens.'}</div>}
    </>
  );
  const strip = (
    <>
      <div className="wb-count"><b>{room ? room.code || room.name : sheetOf(M.P, s.view).no}</b><span>{room ? 'room schedule' : sheetOf(M.P, s.view).nm}</span></div>
      <div className="wb-count"><b>{n}</b><span>{room ? 'features in the room' : mode === 'all' ? 'features' : 'in trouble' + (s.key ? ' · ' + (M.P.LENS[s.key]?.name ?? s.key) : '')}</span></div>
      {!room && (
        <div className="wb-filter" role="group" aria-label="List">
          <button type="button" aria-pressed={mode === 'trouble'} onClick={() => setMode('trouble')}>In trouble</button>
          <button type="button" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>All features</button>
        </div>
      )}
      {!room && s.key && <button type="button" className="bt" onClick={() => E.setKey(null)}>Clear lens key</button>}
      {room && <span className="wb-src">zoom out of the room for the whole plan</span>}
    </>
  );
  return (
    <Workbench cls="wb-plan" strip={strip} list={list} listLabel={room ? 'Room schedule' : 'Features'} listRef={listRef} onKey={onKey}
      detailKey={cur ?? 'legend'} detailLabel={cur ? 'Selected feature' : 'Legend and keys'}
      detail={<div className="wb-scroll">{cur && M.P.F[cur] ? <FeatureDetail f={M.P.F[cur]} /> : <Overview />}</div>} />
  );
}
const rank = (f: Feat) => (f.trouble[0]?.h === 'bad' ? 0 : 1);

function FeatureDetail({ f }: { f: Feat }) {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ t: s.t, view: s.view, simV: s.simV }), shallowEqual);
  const st = stageAt(f, s.t, M.P.asOf), now = s.t === M.P.asOf;
  const T = M.L.TILE[f.id];
  const ag = sim.has ? sim.AGF[f.id] || [] : [], ds = sim.has ? (sim.DOF[f.id] || []).filter((d) => d.open) : [];
  const why = new Map(f.trouble.map((t) => [t.lens, t.why]));
  return (
    <>
      <div className="wb-kick">{f.code && <span>{f.code}</span>}<span>{T ? T.wing.def.name + ' · ' + T.room.name : M.P.D[f.domain]?.name}</span>{T && <span>{T.bay.name}</span>}</div>
      <h3 className="wb-title wb-glyph"><StageSym st={st} w={30} h={19} />{f.name}</h3>
      {f.summary && <p className="wb-lede">{f.summary}</p>}
      <div className="wb-figs">
        <div className="wb-fig"><b className="wd">{st ? STAGE_WORD[st] : 'Unknown'}</b><span>stage{now && f.stageSince ? ' since ' + f.stageSince : ''}</span></div>
        <div className={'wb-fig' + (now && f.health === 'bad' ? ' t-red' : now && f.health === 'watch' ? ' t-amber' : '')}><b className="wd">{now ? HW[f.health] ?? f.health : '—'}</b><span>general health{now ? '' : ' (now only)'}</span></div>
        <div className={'wb-fig' + (ag.length ? ' t-mint' : '')}><b>{ag.length}</b><span>agent{ag.length === 1 ? '' : 's'} on it</span></div>
        <div className={'wb-fig' + (ds.length ? ' t-amber' : '')}><b>{ds.length}</b><span>open question{ds.length === 1 ? '' : 's'}</span></div>
      </div>
      <div className="wb-inline">
        <button type="button" className="bt go" onClick={() => E.openFeature(f.id)}>Open feature</button>
        <button type="button" className="bt" onClick={() => E.flyToFeature(f.id)}>Show on plan</button>
        {f.priority && <span className="wb-meta">priority {f.priority}</span>}
      </div>
      <Sec head="Health by lens" aside={now ? 'now' : 'only shown for now'}>
        <table className="wb-lt">
          <tbody>
            {M.P.lenses.map((d) => {
              const h = f.lens[d.id]?.h ?? 'unmeasured';
              return (
                <tr key={d.id} className={'h-' + h} style={{ '--lens': E.lensAccent(d.id) } as React.CSSProperties}>
                  <th scope="row"><i aria-hidden="true" /><b>{d.short}</b>{d.name}</th>
                  <td className="hw">{now ? HW[h] ?? h : '—'}</td>
                  <td className="why">{now ? why.get(d.id) ?? f.lens[d.id]?.why ?? '' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Sec>
      {ag.length > 0 && (
        <Sec head="Agents on it">
          <ul className="wb-agents-l">
            {ag.map((a) => (
              <li key={a.id}><div className="ro">
                <span className="mk"><Mark k={agentMark(astat(a))} w={22} h={16} /></span>
                <span className="tx"><small>{a.base} · {sim.SQ[a.sq]?.name ?? a.sq} · {astat(a)}</small>{a.task}</span>
                <span className="pc"><b>{Math.round(a.pct)}%</b><span className="bar"><i style={{ width: Math.round(a.pct) + '%' }} /></span></span>
              </div></li>
            ))}
          </ul>
        </Sec>
      )}
      {ds.length > 0 && (
        <Sec head="Questions on it">
          <div className="wb-links">{ds.map((d) => <button key={d.id} type="button" onClick={() => E.openDecision(d.id)}>{d.q} <small>{fmtWait(sim.waitMin(d))}</small></button>)}</div>
        </Sec>
      )}
    </>
  );
}

function Overview() {
  const E = useEngine(), M = E.M, V = useVariant();
  const s = useBp((s) => ({ view: s.view, key: s.key }), shallowEqual);
  const kc = useMemo(() => {
    const kc: Record<string, { bad: number; watch: number }> = {};
    for (const f of M.P.features) for (const t of f.trouble) { const c = (kc[t.lens] ??= { bad: 0, watch: 0 }); c[t.h]++; }
    return kc;
  }, [M.P]);
  const L = V.ui?.Legend ?? Legend, sh = sheetOf(M.P, s.view);
  return (
    <>
      <Sec head={'Legend · ' + sh.no} aside={sh.nm}><div className="wb-legend"><L view={s.view} /></div></Sec>
      <div className="wb-cols">
        <Sec head="Trouble by lens" aside="click to mark">
          <ul className="wb-kn" aria-label="Trouble by lens">
            {M.P.lenses.map(({ id, name, short }) => {
              const c = kc[id] ?? { bad: 0, watch: 0 }, on = s.key === id;
              return (
                <li key={id}>
                  <button type="button" aria-pressed={on} style={{ '--lens': E.lensAccent(id) } as React.CSSProperties} onClick={() => E.setKey(on ? null : id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { swallow(e); E.setKey(on ? null : id); } }}>
                    <i aria-hidden="true" /><b>{short}</b><span>{name}</span><span className="c"><b className="bad">{c.bad}</b> bad · <b className="watch">{c.watch}</b> watch</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Sec>
        <Sec head="Title block"><div className="wb-tbk"><TitleBlock /></div></Sec>
      </div>
      <Sec head="Keys"><div className="wb-hint">{M.live ? HINT_LIVE : HINT}</div></Sec>
    </>
  );
}
