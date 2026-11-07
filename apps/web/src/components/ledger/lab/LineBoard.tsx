'use client';
// Direction C, the Line: one board from intake to shipped, drawn as a production line. A track runs across the top with a
// station per column: Intake, one per wave, then Building, Built, Shipped. A finding is a ticket you carry along it; nothing
// moves to another page, and what is downstream stays in sight while you plan upstream. A placed ticket leaves Intake, so
// the column empties as you work. The most tactile of the three and the widest in scope: the bet is that the Backlog, In
// packs and Release tabs are one line and want to read as one.
import { useMemo, type ReactNode } from 'react';
import type { ProposalStatus } from '@bp/core/scan/types';
import type { Finding } from '../useLedger';
import { Risk, Size } from '../variants/bits';
import { Meter, NewWave, Pin, Slots, WaveCard, useCarry, useDrop, useLab } from './parts';

function Ticket({ f, slots = false }: { f: Finding; slots?: boolean }) {
  const { L, B, focusId, openBrief } = useLab(), carry = useCarry(), on = L.ui.sel.has(f.p.id), at = B.spot.get(f.p.id), mv = L.move(f.p);
  return (
    <article className={'lx-tk' + (on ? ' on' : '') + (focusId === f.p.id ? ' focus' : '')} data-fid={f.p.id} tabIndex={focusId === f.p.id ? 0 : -1} {...(f.can || at?.draft ? carry(f.p.id) : {})}
      onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) L.toggle(f.p.id); else openBrief(f.p.id); }}>
      <header>
        <Pin f={f} px={14} n={at?.draft ? at.n : undefined} mvp={L.mvps.some((m) => m.f.p.id === f.p.id)} />
        <span className="lx-tk-f" title={f.fname}>{f.fname}</span>
        {f.can ? <input type="checkbox" tabIndex={-1} checked={on} onClick={(e) => e.stopPropagation()} onChange={() => L.toggle(f.p.id)} aria-label={'Select ' + f.p.title} /> : null}
      </header>
      <h4>{f.p.title}</h4>
      {mv ? <p className="lx-tk-mv">{mv}</p> : null}
      <footer><Meter f={f} /><Risk p={f.p} /><Size p={f.p} /></footer>
      {slots ? <div className="lx-tk-s"><Slots f={f} /></div> : null}
    </article>
  );
}

function Station({ title, n, kind, children, to }: { title: string; n: number; kind: string; children: ReactNode; to?: ReactNode }) {
  return (
    <div className={'lx-col k-' + kind}>
      <div className="lx-track" aria-hidden="true"><i /></div>
      <header className="lx-col-h"><h3>{title}</h3><b>{n}</b>{to}</header>
      <div className="lx-col-b">{children}</div>
    </div>
  );
}

const DOWN: { title: string; kind: string; st: ProposalStatus[] }[] = [
  { title: 'Building', kind: 'run', st: ['executing'] },
  { title: 'Built', kind: 'built', st: ['done', 'failed', 'rework'] },
  { title: 'Shipped', kind: 'ship', st: ['accepted', 'released'] },
];

export function LineBoard({ brief }: { brief: ReactNode }) {
  const { L, B } = useLab(), drop = useDrop();
  // Intake is what the filters keep and no draft holds; a placed ticket has left it
  const intake = useMemo(() => L.rows.filter((f) => !B.spot.get(f.p.id)?.draft && f.status !== 'executing' && !DOWN.some((d) => d.st.includes(f.status))), [L.rows, B.spot]);
  const down = useMemo(() => DOWN.map((d) => ({ ...d, items: L.all.filter((f) => d.st.includes(f.status)) })), [L.all]);
  return (
    <div className="lx-c">
      <div className="lx-board">
        <div className="lx-col k-in" {...drop({ wave: null })}>
          <div className="lx-track" aria-hidden="true"><i /></div>
          <header className="lx-col-h"><h3>Intake</h3><b>{intake.length}</b></header>
          <div className="lx-col-b">
            {intake.length ? intake.map((f) => <Ticket key={f.p.id} f={f} slots />) : <p className="lx-none">{L.all.length ? 'Intake clear under these filters.' : 'No findings yet.'}</p>}
          </div>
        </div>
        {B.waves.map((w) => (
          <div key={w.id} className="lx-col k-wave">
            <div className="lx-track" aria-hidden="true"><i /></div>
            <WaveCard w={w} n={B.drafts.indexOf(w) + 1} form="column" renderItem={(id) => { const f = L.byId.get(id); return f ? <li key={id}><Ticket f={f} /></li> : <li key={id} className="lx-tk ghost">{id}</li>; }} />
          </div>
        ))}
        <div className="lx-col k-new"><div className="lx-track" aria-hidden="true"><i /></div><NewWave form="column" /></div>
        {down.map((d) => (
          <Station key={d.kind} title={d.title} n={d.items.length} kind={d.kind}>
            {d.items.slice(0, 40).map((f) => <Ticket key={f.p.id} f={f} />)}
            {d.items.length > 40 ? <p className="lx-none">+{d.items.length - 40} more</p> : null}
          </Station>
        ))}
      </div>
      {brief ? <div className="lx-drawer">{brief}</div> : null}
    </div>
  );
}
