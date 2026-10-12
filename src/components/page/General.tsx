'use client';
// The feature page's General tab: the overview, not everything. What it is and how it is doing in plain
// words, one headline tile per enabled lens (its headline value, health and reason; a tile opens that
// lens's tab), the swarm on it, the Business section when the map has one, what it depends on and
// what depends on it, and the recent activity. The side column keeps the record: the stylised
// drawing, who owns and built it, the revisions (each one a time-travel link), parts and notes.
import type { Feature, LensDef } from '@/lib/data';
import { NOT_RECORDED, stageView } from '@/lib/model/timeview';
import { reasonOf } from '@/lib/standard/present';
import { REV_DESC, STAGE_WORD, pname, type Model } from '@/lib/model';
import { BusinessSection } from '../sheet/Business';
import { Activity, BuiltBy, Drawing, FeatureLinks, FlaggedBy, Notes, Parts, SwarmSection, stageSince } from '../sheet/SheetBody';
import { plainLine, revLabel } from '../sheet/words';
import { useEngine } from '../hooks';
import { HWORD, Val, useAsOf, useHeadlineAt, useSimSig } from './bits';
import { CodeTree } from './CodeTree';
import { Sec, Stagger } from './motion';

function Tile({ f, M, d }: { f: Feature; M: Model; d: LensDef }) {
  const E = useEngine(), at = useHeadlineAt(f, d), past = at.at !== 'now';
  const fl = f.lens[d.id], hf = d.headline, v = hf ? M.sim.liveValue(f, d.id, hf.key) : undefined;
  // on a past date health has no history: the tile says so and shows only a reading the scan recorded then
  const h = past ? 'unmeasured' : fl?.h ?? 'unmeasured', why = fl && reasonOf(fl);
  const then = at.at === 'then' ? at : null;
  return (
    <Sec as="div" className={'pg-tile ' + h}>
      <button type="button" onClick={() => E.setView(d.id)} title={'Open the ' + d.name + ' tab'}>
        <span className="top"><span className="sh">{d.short}</span><span className="nm">{d.name}</span><span className="hw">{past ? 'Not recorded' : h === 'na' ? 'N/A' : HWORD[h]}</span></span>
        <span className="lab">{hf ? hf.label : 'No headline field'}</span>
        <b className="big">{hf && (past ? then : h !== 'na') ? <Val k={f.id + ':' + d.id + ':' + hf.key} field={hf} v={then ? then.value : v} /> : '—'}</b>
        <span className="why">{past ? (then ? 'Read on ' + then.measured + '. Health is not recorded for that date.' : NOT_RECORDED + '.') : h === 'na' ? 'This lens does not apply here.' : why ?? (h === 'unmeasured' ? 'Nothing measured yet.' : 'No rule raised anything.')}</span>
      </button>
    </Sec>
  );
}

function StatTiles({ f, M }: { f: Feature; M: Model }) {
  // the tiles read only each lens's headline value from the sim: re-render when one of those changes
  useSimSig((sm) => M.P.lenses.map((d) => (d.headline ? String(sm.liveValue(f, d.id, d.headline.key)) : '')).join('|'));
  return <Stagger className="pg-tiles" gap={0.04}>{M.P.lenses.map((d) => <Tile key={d.id} f={f} M={M} d={d} />)}</Stagger>;
}

export function GeneralTab({ f }: { f: Feature }) {
  const E = useEngine(), M = E.M, P = M.P;
  const blast = M.closure.of(f.id).length;
  const pl = plainLine(P, f, M.sim), { t, now, past } = useAsOf(), sv = stageView(f, t, now);
  return (
    <>
    <div className="pg-lede">
      <p className="sum">{f.summary}</p>
      {past
        ? <p className="plain"><b>{sv.at === 'then' ? STAGE_WORD[sv.stage] : sv.at === 'before' ? 'Not on the drawing yet' : 'Stage unknown'}</b> on {t}. How it was doing then is not recorded.</p>
        : <p className="plain"><b>{pl.strong}</b> {pl.rest.join(' ')} {pl.bad && <span className="bad">{pl.bad}</span>}</p>}
      {f.blockedBy.length ? <p className="blk">Blocked by {f.blockedBy.map((x) => <button key={x} type="button" className="btn" onClick={() => E.openFeature(x)}>{P.F[x].name}</button>)}</p> : null}
    </div>
    <div className="pg-cols">
      <Stagger className="pg-main">
        <Sec label="Lens headlines"><h4 className="pg-h">Every lens at a glance · {P.lenses.length}</h4><StatTiles f={f} M={M} /></Sec>
        <Sec label="Swarm"><SwarmSection f={f} /></Sec>
        <Sec label="Business"><BusinessSection f={f} /></Sec>
        <Sec className="dsec deps" label="Dependencies">
          <div className="dl"><h4>Depends on · {f.dependsOn.length}</h4><FeatureLinks ids={f.dependsOn} empty="Nothing, it stands on its own" /></div>
          <div className="dl"><h4>Used by · {f.usedBy.length} · blast radius {blast}</h4><FeatureLinks ids={f.usedBy} empty="Nothing depends on it" />
            {blast ? <button type="button" className="btn pg-blast" onClick={() => E.toggleBlast(f.id)}>Show the blast radius on the plan · B</button> : null}
          </div>
        </Sec>
        {f.contexts.length ? <Sec className="dsec" label="Lives in code"><CodeTree f={f} /></Sec> : null}
        <Sec className="dsec" label="Recent activity"><Activity f={f} /></Sec>
      </Stagger>
      <Stagger className="pg-side">
        <Sec className="illo" label="Drawing"><Drawing f={f} /></Sec>
        <Sec className="mtb" label="Record">
          <div><span className="l">Owner</span>{pname(P, f.owner)}</div>
          <div><span className="l">Built by</span><BuiltBy f={f} /></div>
          <div><span className="l">Flagged by</span><FlaggedBy f={f} /></div>
          <div><span className="l">Stage</span>{stageSince(f)}</div>
          <div className="full"><span className="l">Lives in</span>{f.surfaces.length ? f.surfaces.map((s) => <span key={s} className="ag" style={{ margin: '0 4px 0 0' }}>{s}</span>) : '—'}</div>
        </Sec>
        <Sec label="Revisions">
          <table className="revt"><thead><tr><th>REV</th><th>DATE</th><th>DESCRIPTION</th></tr></thead><tbody>
            {f.revs.map((h, i) => <tr key={i} className={i === f.revs.length - 1 ? 'now' : ''}><td className="m">{revLabel(i)}</td><td className="m"><button type="button" className="pg-tt" title="Travel the plan back to this date" onClick={() => E.setTime(h.date)}>{h.date}</button></td><td>{REV_DESC[h.stage]}</td></tr>)}
          </tbody></table>
        </Sec>
        {f.parts ? <Sec className="dsec" label="Parts"><Parts parts={f.parts} /></Sec> : null}
        {f.notes.length ? <Sec className="dsec" label="Notes"><Notes f={f} /></Sec> : null}
      </Stagger>
    </div>
    </>
  );
}
