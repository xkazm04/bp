'use client';
// The Backlog's wave strip (above the table; the In packs scope has none): [All | one tab per wave | + New wave]. A tab is
// the wave's state mark, its name and its finding count; choosing one filters the table to that wave's findings
// (LedgerUi.wave) and opens its panel: each package (name, model, effort, findings, job state) with Dispatch (one package)
// and, for the wave, Dispatch wave (a draft), Dispatch remaining (a dispatched wave with findings that can still go), Edit and
// Delete (draft only; Delete asks twice, in place). The composer (WaveComposer.tsx) opens inline under the tabs. Below 720 px
// of table width the tabs fold into one select. Waves load through useWaves.ts; with none, the strip says how to make one.
// Dispatching goes through Ledger.dispatchWave, the optimistic path the direct Dispatch uses.
import { useState } from 'react';
import { dayHhmmUTC } from '@bp/core/model';
import type { Ledger } from '../useLedger';
import type { Wave, WaveState } from '@bp/core/scan/waves';
import { WaveComposer } from './WaveComposer';
import './waves.css';

const MARK: Record<WaveState, string> = { draft: '○', queued: '◌', running: '◔', done: '●', partial: '◐', failed: '✕', cancelled: '–' };
const HINT: Record<WaveState, string> = {
  draft: 'Draft: nothing queued yet, still editable', queued: 'Queued: its jobs wait for a slot', running: 'Running: a job is building',
  done: 'Done: every job finished', partial: 'Partial: some jobs finished, some failed or were cancelled', failed: 'Failed: every job failed', cancelled: 'Cancelled: every job was cancelled',
};

/** A wave state as its mark and, optionally, its word. */
export function WaveMark({ state, word = true }: { state: WaveState; word?: boolean }) {
  return <span className={'wv-st s-' + state} title={HINT[state]} data-wave-state={state}><b aria-hidden="true">{MARK[state]}</b>{word ? state : <span className="vh">{state}</span>}</span>;
}

const size = (w: Wave) => w.packages.reduce((n, p) => n + p.ids.length, 0);
const idsOf = (w: Wave, pk?: string) => w.packages.filter((p) => !pk || p.id === pk).flatMap((p) => p.ids);

export function WavesBar({ L }: { L: Ledger }) {
  const { ui, waves } = L, sel = waves.waves.find((w) => w.id === ui.wave);
  const none = !waves.waves.length;
  const add = L.waveReady.length ? null : L.ready.length ? 'The selected findings are already in a draft wave' : 'Select findings to group into a wave';
  return (
    <section className="lg-waves" aria-label="Waves" data-wave="strip">
      <div className="wv-row">
        {none ? (waves.loaded
          // "none" and "not asked yet" are different states: before the first list comes back the strip must not
          // assert the product has no waves (useWaves.ts `loaded`)
          ? <span className="wv-none">No waves. Select findings, then Add to wave.</span>
          : <span className="wv-none" role="status">Loading waves…</span>) : (
          <>
            <div className="wv-tabs" role="tablist" aria-label="Waves">
              <button type="button" role="tab" aria-selected={!sel} className={!sel ? 'on' : ''} onClick={() => L.showWave(null)} title="Every finding">All</button>
              {waves.waves.map((w) => (
                <button key={w.id} type="button" role="tab" aria-selected={sel?.id === w.id} className={sel?.id === w.id ? 'on' : ''} data-wave={w.id} onClick={() => L.showWave(w.id)}
                  title={w.name + ' · ' + (waves.states.get(w.id) ?? 'draft') + ' · ' + size(w) + ' findings in ' + w.packages.length + (w.packages.length === 1 ? ' package' : ' packages')}>
                  <WaveMark state={waves.states.get(w.id) ?? 'draft'} word={false} />{w.name}<b>{size(w)}</b>
                </button>
              ))}
            </div>
            <select className="wv-sel" aria-label="Wave" value={sel?.id ?? ''} onChange={(e) => L.showWave(e.target.value || null)}>
              <option value="">All findings</option>
              {waves.waves.map((w) => <option key={w.id} value={w.id}>{w.name} · {waves.states.get(w.id) ?? 'draft'} · {size(w)}</option>)}
            </select>
          </>
        )}
        <button type="button" className="bt" data-wave="new" disabled={!!add || !!ui.composer} onClick={() => L.openComposer()} title={add ?? 'A new draft wave over the selection'}>+ New wave</button>
      </div>
      {ui.composer ? <WaveComposer key={ui.composer.edit ?? 'new'} L={L} ask={ui.composer} /> : sel ? <WavePanel key={sel.id} L={L} w={sel} /> : null}
    </section>
  );
}

function WavePanel({ L, w }: { L: Ledger; w: Wave }) {
  const { waves } = L, [ask, setAsk] = useState(false);
  const state = waves.states.get(w.id) ?? 'draft', draft = w.status === 'draft', off = L.busy || waves.busy;
  const can = (ids: readonly string[]) => ids.reduce((n, id) => n + (L.byId.get(id)?.can ? 1 : 0), 0);
  const left = can(idsOf(w));
  return (
    <div className="wv-panel" data-wave-panel={w.id}>
      <div className="wv-head">
        <b className="wv-name">{w.name}</b><WaveMark state={state} />
        <span className="wv-meta">{size(w)} findings · {w.packages.length} {w.packages.length === 1 ? 'package' : 'packages'}{w.dispatched_at ? ' · dispatched ' + dayHhmmUTC(w.dispatched_at) : ''}</span>
        <span className="lg-sp" />
        {draft ? <button type="button" className="bt go" data-wave="dispatch" disabled={off || !left} onClick={() => void L.dispatchWave(w.id)}
          title={left ? 'Approve the proposed findings and queue one execute job per package, each with its own model and effort' : 'No finding of this wave can go: all are built, building or no longer open'}>{L.busy ? 'Dispatching…' : 'Dispatch wave ' + left}</button>
          : left ? <button type="button" className="bt go" data-wave="remaining" disabled={off} onClick={() => void L.dispatchWave(w.id)} title="Queue the findings no job has built yet">Dispatch remaining {left}</button> : null}
        {draft ? <button type="button" className="bt" data-wave="edit" disabled={off} onClick={() => L.openComposer(w.id)}>Edit</button> : null}
        {draft && !ask ? <button type="button" className="bt" data-wave="delete" disabled={off} onClick={() => setAsk(true)}>Delete</button> : null}
        {draft && ask ? (
          <span className="wv-ask" role="group" aria-label={'Delete ' + w.name}>
            <span>Delete this draft?</span>
            <button type="button" className="bt warn" data-wave="delete-yes" disabled={off} onClick={() => void waves.remove(w.id).then((ok) => { if (ok) L.showWave(null); else setAsk(false); })}>Delete</button>
            <button type="button" className="bt" onClick={() => setAsk(false)}>Keep</button>
          </span>
        ) : null}
      </div>
      <ul className="wv-pks">
        {w.packages.map((p) => {
          const ps = waves.packageState(w, p), pcan = can(p.ids);
          return (
            <li key={p.id} data-wave-pkg={p.id}>
              <b className="wv-pn">{p.name}</b>
              <span className="wv-tag">{p.model}</span><span className="wv-tag">{p.effort}</span>
              <span className="wv-meta">{p.ids.length} {p.ids.length === 1 ? 'finding' : 'findings'}</span>
              <WaveMark state={ps} />
              <span className="lg-sp" />
              {pcan ? <button type="button" className="bt" data-wave="dispatch-pkg" disabled={off} onClick={() => void L.dispatchWave(w.id, [p.id])} title="Queue only this package">Dispatch {pcan}</button> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
