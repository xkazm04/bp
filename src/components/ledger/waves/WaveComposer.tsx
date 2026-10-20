'use client';
// The wave composer: an inline panel under the strip's tabs (not a modal). A wave name and its packages; each package has a
// name, a model (Sonnet | Opus: the CLI's latest of each) and an effort (low | medium | high | xhigh) and holds findings that
// can be moved to another package or removed. A new wave starts with ONE package (Opus, high) holding the dispatchable
// selection that no draft wave holds; the ones a draft wave already holds are left out and named. Two packages on one feature
// get a warning (they build in parallel in one repo and may collide). Create (Save, when editing a draft) goes through
// useWaves; on success the selection clears and the wave's tab is selected, on a refusal the panel stays open with its
// edits (the hook toasted the reason). The names and counts are checked with the contract's own checkWaveBody.
import { useEffect, useMemo, useRef, useState } from 'react';
import { checkWaveBody, MAX_PACKAGES, WAVE_EFFORTS, WAVE_MODELS, type WaveBody, type WaveEffort, type WaveModel } from '@/lib/scan/waves';
import type { ComposerAsk, Ledger } from '../useLedger';
import { Seg } from '../train/ui/Controls';

interface Pk { key: number; name: string; model: WaveModel; effort: WaveEffort; ids: string[] }
const MODEL_LABEL: Record<WaveModel, string> = { sonnet: 'Sonnet', opus: 'Opus' };

export function WaveComposer({ L, ask }: { L: Ledger; ask: ComposerAsk }) {
  const { waves } = L, edit = ask.edit ? waves.waves.find((w) => w.id === ask.edit) : undefined;
  const next = useRef(0);
  const [name, setName] = useState(() => edit?.name ?? 'Wave ' + (waves.waves.length + 1));
  const [pks, setPks] = useState<Pk[]>(() => edit
    ? edit.packages.map((p) => ({ key: next.current++, name: p.name, model: p.model, effort: p.effort, ids: [...p.ids] }))
    : [{ key: next.current++, name: 'Package 1', model: 'opus', effort: 'high', ids: [...ask.ids] }]);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus({ preventScroll: true }); field.current?.select(); }, []);

  const held = useMemo(() => new Set(pks.flatMap((p) => p.ids)), [pks]);
  // selected findings a draft wave already holds (this wave's own do not count), and ones that could still join
  const left = L.waveTaken.filter((t) => t.wave.id !== edit?.id);
  const extra = L.waveReady.filter((f) => !held.has(f.p.id));
  const body: WaveBody = { name, packages: pks.map((p) => ({ name: p.name, model: p.model, effort: p.effort, ids: p.ids })) };
  const chk = checkWaveBody(body);
  const empty = pks.find((p) => !p.ids.length);
  const problem = empty ? 'Package "' + (empty.name || 'unnamed') + '" is empty: move findings into it or remove it' : !chk.ok ? chk.error : null;

  // packages that share a feature: the warning names the feature and the packages
  const clash = useMemo(() => {
    const by = new Map<string, { name: string; pk: Set<number> }>();
    for (const p of pks) for (const id of p.ids) {
      const f = L.byId.get(id); if (!f) continue;
      let e = by.get(f.p.feature); if (!e) by.set(f.p.feature, (e = { name: f.fname, pk: new Set() }));
      e.pk.add(p.key);
    }
    return [...by.values()].filter((e) => e.pk.size > 1);
  }, [pks, L.byId]);

  const patch = (key: number, c: Partial<Pk>) => setPks((a) => a.map((p) => (p.key === key ? { ...p, ...c } : p)));
  const move = (id: string, to: number) => setPks((a) => a.map((p) => ({ ...p, ids: p.key === to ? [...p.ids, id] : p.ids.filter((x) => x !== id) })));
  const drop = (id: string) => setPks((a) => a.map((p) => ({ ...p, ids: p.ids.filter((x) => x !== id) })));
  const addPk = () => setPks((a) => [...a, { key: next.current++, name: 'Package ' + (a.length + 1), model: 'opus', effort: 'high', ids: [] }]);
  const rmPk = (key: number) => setPks((a) => {
    if (a.length < 2) return a;
    const gone = a.find((p) => p.key === key), rest = a.filter((p) => p.key !== key);
    return gone ? rest.map((p, i) => (i === 0 ? { ...p, ids: [...p.ids, ...gone.ids] } : p)) : a; // its findings go to the first package left
  });
  const take = () => setPks((a) => a.map((p, i) => (i === 0 ? { ...p, ids: [...p.ids, ...extra.map((f) => f.p.id)] } : p)));

  const save = async () => {
    if (problem) return;
    const w = edit ? await waves.update(edit.id, body) : await waves.create(body);
    if (!w) return; // refused: the panel stays, the toast says why
    L.set((u) => ({ ...u, composer: null, wave: w.id, focus: null, sel: edit ? u.sel : new Set() }));
  };

  return (
    <div className="wv-comp" role="group" aria-label={edit ? 'Edit wave' : 'New wave'} data-wave="composer"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); L.closeComposer(); } }}>
      <div className="wv-head">
        <label className="wv-lab">Wave<input ref={field} className="wv-in" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Wave name" /></label>
        <span className="wv-meta">{held.size} {held.size === 1 ? 'finding' : 'findings'} in {pks.length} {pks.length === 1 ? 'package' : 'packages'}</span>
        <span className="lg-sp" />
        {extra.length ? <button type="button" className="bt" onClick={take} title="Add the selected findings that are in no draft wave to the first package">Add {extra.length} selected</button> : null}
      </div>
      {left.length ? (
        <p className="wv-warn" data-wave="excluded">
          {left.length} selected {left.length === 1 ? 'finding is' : 'findings are'} left out, already in a draft wave: {left.slice(0, 3).map((t) => t.f.p.title + ' (' + t.wave.name + ')').join('; ')}{left.length > 3 ? '; …' : ''}
        </p>
      ) : null}
      <ul className="wv-cp">
        {pks.map((p) => (
          <li key={p.key} data-wave-pkg={p.name}>
            <div className="wv-ph">
              <input className="wv-in" value={p.name} maxLength={60} aria-label="Package name" onChange={(e) => patch(p.key, { name: e.target.value })} />
              <Seg label="Model" value={p.model} onChange={(model) => patch(p.key, { model })} options={WAVE_MODELS.map((m) => ({ value: m, label: MODEL_LABEL[m], title: 'The latest ' + MODEL_LABEL[m] + ' (the CLI alias ' + m + ')' }))} />
              <Seg label="Effort" value={p.effort} onChange={(effort) => patch(p.key, { effort })} options={WAVE_EFFORTS.map((x) => ({ value: x, label: x, title: 'Reasoning effort ' + x }))} />
              <span className="wv-meta">{p.ids.length} {p.ids.length === 1 ? 'finding' : 'findings'}</span>
              <span className="lg-sp" />
              <button type="button" className="bt" disabled={pks.length < 2} onClick={() => rmPk(p.key)} title={pks.length < 2 ? 'A wave needs a package' : 'Remove the package; its findings join the first one'}>Remove package</button>
            </div>
            <ul className="wv-fl">
              {p.ids.map((id) => {
                const f = L.byId.get(id);
                return (
                  <li key={id}>
                    <span className="wv-ft" title={f?.p.title ?? id}>{f?.p.title ?? id}</span>
                    <span className="wv-meta">{f?.fname ?? ''}</span>
                    {pks.length > 1 ? (
                      <select className="wv-mv" aria-label={'Move ' + (f?.p.title ?? id) + ' to another package'} value="" onChange={(e) => { if (e.target.value) move(id, +e.target.value); }}>
                        <option value="">Move to…</option>
                        {pks.filter((q) => q.key !== p.key).map((q) => <option key={q.key} value={q.key}>{q.name || 'unnamed'}</option>)}
                      </select>
                    ) : null}
                    <button type="button" className="wv-x" aria-label={'Remove ' + (f?.p.title ?? id) + ' from the wave'} title="Remove from the wave" onClick={() => drop(id)}>×</button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {clash.length ? (
        <p className="wv-warn" data-wave="clash">
          Packages share {clash.length === 1 ? 'a feature' : clash.length + ' features'} ({clash.slice(0, 3).map((c) => c.name).join(', ')}{clash.length > 3 ? ', …' : ''}). They build in parallel in one repo and may collide; moving them into one package avoids it.
        </p>
      ) : null}
      <div className="wv-act">
        <button type="button" className="bt" disabled={pks.length >= MAX_PACKAGES} onClick={addPk} title={pks.length >= MAX_PACKAGES ? 'At most ' + MAX_PACKAGES + ' packages' : 'Add an empty package'}>+ Package</button>
        <span className="lg-sp" />
        {problem ? <span className="wv-why" role="status">{problem}</span> : null}
        <button type="button" className="bt" onClick={L.closeComposer}>Cancel <kbd>Esc</kbd></button>
        <button type="button" className="bt go" data-wave="create" disabled={!!problem || waves.busy} onClick={() => void save()}>{edit ? 'Save' : 'Create wave'}</button>
      </div>
    </div>
  );
}
