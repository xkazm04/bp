'use client';
// The feature sheet's Business section (v3.1): the as-is customer experience, the core every
// variation shares (shared tech and core schema), and the variations that extend it, per customer or
// segment. All three come from the feature in the map; the section is hidden when all are absent.
// Lens values stay on the core feature, so a variation has no lens reading of its own.
import type { Feature } from '@/lib/data';
import { STAGE_WORD } from '@/lib/model';
import { StageSym } from '../Symbols';

const Bullets = ({ xs }: { xs: readonly string[] }) => <ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>;

export function BusinessSection({ f }: { f: Feature }) {
  const tech = f.core?.tech ?? [], schema = f.core?.schema ?? [], vs = f.variations;
  if (!f.experience && !tech.length && !schema.length && !vs.length) return null;
  return (
    <div className="dsec biz">
      <h4>Business · as-is, core and variations</h4>
      {f.experience && <><h5>As-is</h5><p className="asis">{f.experience}</p></>}
      {(tech.length || schema.length) ? (
        <>
          <h5>Core · what every variation shares</h5>
          <div className="core2">
            {tech.length ? <div><h6>Shared tech</h6><Bullets xs={tech} /></div> : null}
            {schema.length ? <div><h6>Core schema</h6><Bullets xs={schema} /></div> : null}
          </div>
        </>
      ) : null}
      {vs.length ? (
        <>
          <h5>Variations · {vs.length}</h5>
          <div className="vart-wrap"><table className="vart">
            <thead><tr><th>Variation</th><th>Extends the core</th><th>Parameters</th><th>Stage</th></tr></thead>
            <tbody>
              {vs.map((v) => (
                <tr key={v.slug}>
                  <td><b>{v.name}</b><small>{v.audience}</small></td>
                  <td>{v.extends.length ? <Bullets xs={v.extends} /> : '—'}</td>
                  <td>{v.params.length ? <Bullets xs={v.params} /> : '—'}</td>
                  <td>{v.stage ? <span className="chip"><StageSym st={v.stage} w={18} h={12} />{STAGE_WORD[v.stage]}</span> : <span className="chip">Unknown</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      ) : null}
    </div>
  );
}
