'use client';
// The feature page's General tab: the overview, not everything. What it is and how it is doing in plain
// words, one headline tile per enabled lens (its headline value, health and reason; a tile opens that
// lens's tab), the swarm on it, the Business section when the map has one, what it depends on and
// what depends on it, and the recent activity. The side column keeps the record: the stylised
// drawing, who owns and built it, the revisions (each one a time-travel link), parts and notes.
import type { Feature } from '@/lib/data';
import { REV_DESC, STAGE_WORD, isAgentId, pname, type Model } from '@/lib/model';
import { illoSVG } from '@/engine/render/illo';
import { BusinessSection } from '../sheet/Business';
import { SwarmSection } from '../sheet/SheetBody';
import { StageSym } from '../Symbols';
import { plainLine } from '../sheet/words';
import { useBp, useEngine } from '../hooks';
import { HWORD, Val } from './bits';
import { Sec, Stagger } from './motion';

function StatTiles({ f, M }: { f: Feature; M: Model }) {
  const E = useEngine();
  useBp((s) => s.simV);
  return (
    <Stagger className="pg-tiles" gap={0.04}>
      {M.P.lenses.map((d) => {
        const fl = f.lens[d.id], h = fl?.h ?? 'unmeasured', hf = d.headline, v = hf ? M.sim.liveValue(f, d.id, hf.key) : undefined;
        const why = fl?.ov ? fl.ov.why : fl?.why;
        return (
          <Sec key={d.id} as="div" className={'pg-tile ' + h}>
            <button type="button" onClick={() => E.setView(d.id)} title={'Open the ' + d.name + ' tab'}>
              <span className="top"><span className="sh">{d.short}</span><span className="nm">{d.name}</span><span className="hw">{h === 'na' ? 'N/A' : HWORD[h]}</span></span>
              <span className="lab">{hf ? hf.label : 'No headline field'}</span>
              <b className="big">{hf && h !== 'na' ? <Val k={f.id + ':' + d.id + ':' + hf.key} field={hf} v={v} /> : '—'}</b>
              <span className="why">{h === 'na' ? 'This lens does not apply here.' : why ?? (h === 'unmeasured' ? 'Nothing measured yet.' : 'No rule raised anything.')}</span>
            </button>
          </Sec>
        );
      })}
    </Stagger>
  );
}

export function GeneralTab({ f }: { f: Feature }) {
  const E = useEngine(), M = E.M, P = M.P, T = M.L.TILE[f.id];
  const acts = P.activity.filter((a) => a.feature === f.id).slice(0, 8);
  const blast = M.closure.of(f.id).length;
  const who = (id: string) => <>{pname(P, id)}{isAgentId(P, id) && <span className="ag">AGENT</span>}</>;
  const dl = (ids: string[], empty: string) => ids.length ? ids.map((id) => { const g = P.F[id]; return <button key={id} type="button" onClick={() => E.openFeature(id)}><StageSym st={g.stage} w={20} h={13} /><span>{g.name}</span><span className="w">{g.stage ? STAGE_WORD[g.stage] : 'Unknown'}</span></button>; }) : <div className="none">{empty}</div>;
  const pl = plainLine(P, f, M.sim);
  return (
    <>
    <div className="pg-lede">
      <p className="sum">{f.summary}</p>
      <p className="plain"><b>{pl.strong}</b> {pl.rest.join(' ')} {pl.bad && <span className="bad">{pl.bad}</span>}</p>
      {f.blockedBy.length ? <p className="blk">Blocked by {f.blockedBy.map((x) => <button key={x} type="button" className="btn" onClick={() => E.openFeature(x)}>{P.F[x].name}</button>)}</p> : null}
    </div>
    <div className="pg-cols">
      <Stagger className="pg-main">
        <Sec label="Lens headlines"><h4 className="pg-h">Every lens at a glance · {P.lenses.length}</h4><StatTiles f={f} M={M} /></Sec>
        <Sec label="Swarm"><SwarmSection f={f} /></Sec>
        <Sec label="Business"><BusinessSection f={f} /></Sec>
        <Sec className="dsec deps" label="Dependencies">
          <div className="dl"><h4>Depends on · {f.dependsOn.length}</h4>{dl(f.dependsOn, 'Nothing, it stands on its own')}</div>
          <div className="dl"><h4>Used by · {f.usedBy.length} · blast radius {blast}</h4>{dl(f.usedBy, 'Nothing depends on it')}
            {blast ? <button type="button" className="btn pg-blast" onClick={() => E.toggleBlast(f.id)}>Show the blast radius on the plan · B</button> : null}
          </div>
        </Sec>
        <Sec className="dsec" label="Recent activity"><h4>Recent activity · 14 days</h4>
          {acts.length ? <ul className="acts">{acts.map((a, i) => <li key={i} className={a.type === 'incident' ? 'inc' : ''}><span className="m">{a.at.slice(5, 10)} {a.at.slice(11, 16)}</span><span className="a">{pname(P, a.actor)}{isAgentId(P, a.actor) ? ' ◇' : ''}</span><span>{a.text}{a.severity ? ' · ' + a.severity : ''}</span></li>)}</ul> : <div className="dl"><div className="none">Quiet, no events in the last 14 days</div></div>}
        </Sec>
      </Stagger>
      <Stagger className="pg-side">
        <Sec className="illo" label="Drawing"><div dangerouslySetInnerHTML={{ __html: illoSVG(P.D[f.domain].base, 'currentColor') }} style={{ color: 'var(--ink)' }} /><span className="cap">DETAIL {T.idx} · {(P.D[f.domain].code || P.D[f.domain].name).toUpperCase()} · STYLISED</span></Sec>
        <Sec className="mtb" label="Record">
          <div><span className="l">Owner</span>{pname(P, f.owner)}</div>
          <div><span className="l">Built by</span>{f.builtBy.length ? f.builtBy.map((id, i) => <span key={id}>{i ? ', ' : ''}{who(id)}</span>) : '—'}</div>
          <div><span className="l">Flagged by</span>{(() => {
            const bad = f.trouble.filter((t) => t.h === 'bad').map((t) => P.LENS[t.lens]?.name ?? t.lens), watch = f.trouble.length - bad.length;
            return bad.length ? <span className="nc">{bad.join(', ')}</span> : watch ? watch + ' lens' + (watch > 1 ? 'es' : '') + ' to watch' : f.health === 'good' ? 'No lens ✓' : 'Not measured yet';
          })()}</div>
          <div><span className="l">Stage</span>{f.stage ? STAGE_WORD[f.stage] + ' · since ' + f.stageSince : 'Unknown'}</div>
          <div className="full"><span className="l">Lives in</span>{f.surfaces.length ? f.surfaces.map((s) => <span key={s} className="ag" style={{ margin: '0 4px 0 0' }}>{s}</span>) : '—'}</div>
        </Sec>
        <Sec label="Revisions">
          <table className="revt"><thead><tr><th>REV</th><th>DATE</th><th>DESCRIPTION</th></tr></thead><tbody>
            {f.revs.map((h, i) => <tr key={i} className={i === f.revs.length - 1 ? 'now' : ''}><td className="m">{String.fromCharCode(65 + i)}</td><td className="m"><button type="button" className="pg-tt" title="Travel the plan back to this date" onClick={() => E.setTime(h.date)}>{h.date}</button></td><td>{REV_DESC[h.stage]}</td></tr>)}
          </tbody></table>
        </Sec>
        {f.parts ? <Sec className="dsec" label="Parts"><h4>Parts · {f.parts.filter((p) => p.done).length} of {f.parts.length} done</h4><div className="parts">{f.parts.map((p) => <span key={p.name} className={p.done ? 'd' : ''}>{p.done ? '✓ ' : '○ '}{p.name}</span>)}</div></Sec> : null}
        {f.notes.length ? <Sec className="dsec" label="Notes"><h4>Red-pencil notes</h4><div className="notes">{f.notes.map((n, i) => <div key={i} className="pn">“{n.text}”<small>— {pname(P, n.by)}, {n.date}</small></div>)}</div></Sec> : null}
      </Stagger>
    </div>
    </>
  );
}
