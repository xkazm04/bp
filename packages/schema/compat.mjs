// What a schema edit does to each channel, before anything is written: `diff(oldModel, newModel)` walks two models
// (generate.mjs's model(), one per schema text: a git ref's and the tree's) struct by struct and field by field,
// reading each field the way the emitters do (carry() for the UE side, tsType() for the TS side), and classifies:
//   added / removed                 a field (or a whole struct) appeared or went
//   required-added / required-dropped
//   enum-widened / enum-narrowed    a string vocabulary gained / lost values (followed through $ref: one change per
//                                   field that holds it)
//   ue-type / ts-type               the C++ or TypeScript type of a field changed
// Each change says `breaking`, for whom (`breakingFor`: 'ue' the VR client's USTRUCTs, 'ts' the TS readers and
// check:schema's parity with types.ts, 'documents' a committed document that no longer validates), and one line per
// channel on the consequence. The UE consequences come from FJsonObjectConverter: a missing key keeps the default (a
// silent value, never an error), while a value that cannot convert fails the whole struct.
// `report(changes, { since })` is the text `generate.mjs --since <ref>` prints, grouped by schema file. A report
// only: nothing here gates a write.
import { carry, tsType } from './generate.mjs';

const ue = (name) => `FBp${name}`;
const silent = (t) => (t === 'FString' ? 'empty' : t === 'int32' ? '0' : t === 'double' ? '0.0' : t === 'bool' ? 'false'
  : t.startsWith('TArray<') ? 'empty array' : t.startsWith('TMap<') ? 'empty map' : t === 'FJsonObjectWrapper' ? 'empty object' : 'default struct');
/** The string enum a field holds, directly or as the items / values of a container; null when it holds none. */
const enumOf = (n) => (n.enum ?? (n.k === 'array' ? enumOf(n.item) : n.k === 'map' ? enumOf(n.value) : null));
const fields = (st) => new Map(carry(st).map((c) => [c.p.key, c]));
const change = (st, key, kind, breakingFor, what, notes) => ({ file: st.file, struct: st.name, key, kind, breaking: breakingFor.length > 0, breakingFor, what, ue: notes.ue ?? '', ts: notes.ts ?? '' });

/** The changes from oldModel to newModel, in the new model's struct order (removed structs last). */
export function diff(a, b) {
  const out = [];
  for (const st of b.structs.values()) {
    const was = a.structs.get(st.name);
    if (!was) {
      out.push(change(st, null, 'added', [], `struct ${st.name} added`, { ue: `${ue(st.name)} is a new USTRUCT`, ts: `interface ${st.name} is new` }));
      continue;
    }
    const before = fields(was), now = fields(st);
    for (const [key, c] of before) {
      if (now.has(key)) continue;
      out.push(change(st, key, 'removed', ['ue', 'ts'], `${st.name}.${key} removed`, {
        ue: `an old BpLink build: ${ue(st.name)}.${c.field} keeps its default (BpLink reads a silent ${silent(c.t.t)}); a rebuild drops the UPROPERTY, so VR code naming it stops compiling`,
        ts: `where types.ts holds ${st.name}, it still names ${key}: check:schema's parity fails until it goes`,
      }));
    }
    for (const [key, c] of now) {
      const o = before.get(key);
      if (!o) {
        const req = c.p.required;
        out.push(change(st, key, 'added', req ? ['ts', 'documents'] : [], `${st.name}.${key} added${req ? ', required' : ''}`, {
          ue: `${ue(st.name)}.${c.field} (${c.t.t}) is new; an old BpLink build ignores the key`,
          ts: req ? `required: a document without ${key} no longer validates, and types.ts must name it required (parity)` : `optional: types.ts gains ${key}? (parity)`,
        }));
        continue;
      }
      if (o.p.required !== c.p.required) {
        const added = c.p.required;
        out.push(change(st, key, added ? 'required-added' : 'required-dropped', added ? ['ts', 'documents'] : ['ts'], `${st.name}.${key} made ${added ? 'required' : 'optional'}`, {
          ue: `no change in C++: ${ue(st.name)}.${o.field} is filled when the key is there and keeps its default when it is not`,
          ts: added ? `a document without ${key} no longer validates; types.ts must drop the ? (parity)`
            : `a TS reader that relied on ${key} being there now meets undefined; types.ts must mark it ${key}? (parity)`,
        }));
      }
      const ea = enumOf(o.p.node), eb = enumOf(c.p.node);
      const enumChanged = (ea || eb) && JSON.stringify(ea) !== JSON.stringify(eb);
      if (enumChanged) {
        const lost = ea ? (eb ? ea.filter((v) => !eb.includes(v)) : []) : null, gained = eb ? (ea ? eb.filter((v) => !ea.includes(v)) : []) : null;
        // a vocabulary imposed on a free string narrows it; a vocabulary lifted widens it
        const narrowed = ea && eb ? lost.length > 0 : !ea;
        const what = !ea ? `now one of ${eb.join(', ')}` : !eb ? 'any string now' : [lost.length ? `lost ${lost.join(', ')}` : '', gained.length ? `gained ${gained.join(', ')}` : ''].filter(Boolean).join(', ') || 'reordered';
        out.push(change(st, key, narrowed ? 'enum-narrowed' : 'enum-widened', narrowed ? ['ts', 'documents'] : [], `${st.name}.${key} ${what}`, {
          ue: `FString either way: ${ue(st.name)}.${o.field} reads any value; BpLink code that compares against ${narrowed && lost?.length ? lost.join(', ') : 'it'} sees ${narrowed ? 'it no more' : 'new values'}`,
          ts: narrowed ? `a document holding ${lost?.length ? lost.join(', ') : 'another value'} no longer validates; types.ts's union must ${lost?.length ? 'drop ' + lost.join(', ') : 'narrow'} (parity)`
            : `types.ts's union must ${gained?.length ? 'gain ' + gained.join(', ') : 'widen'} (parity); an old TS reader meets a value it does not name`,
        }));
      }
      if (o.t.t !== c.t.t || o.field !== c.field) {
        const eg = c.t.t === 'int32' ? ' (a document written for double holding 0.5 fails int32)' : '';
        out.push(change(st, key, 'ue-type', ['ue'], `${st.name}.${key} ${o.t.t} -> ${c.t.t}`, {
          ue: `${ue(st.name)}.${o.field} ${o.t.t} -> ${c.t.t}${o.field !== c.field ? ` (now ${c.field})` : ''}: FJsonObjectConverter fails the whole ${ue(st.name)} when one value does not convert${eg}`,
        }));
      }
      const ta = tsType(o.p.node), tb = tsType(c.p.node);
      if (ta !== tb && !enumChanged) out.push(change(st, key, 'ts-type', ['ts'], `${st.name}.${key} ${ta} -> ${tb}`, { ts: `${st.name}.${key}: ${ta} -> ${tb}; a TS reader typed for the old shape misreads it` }));
    }
  }
  for (const st of a.structs.values()) {
    if (b.structs.has(st.name)) continue;
    out.push(change(st, null, 'removed', ['ue', 'ts'], `struct ${st.name} removed`, { ue: `${ue(st.name)} is gone: VR code naming it stops compiling`, ts: `interface ${st.name} is gone from the generated types` }));
  }
  return out;
}

/** The report lines for `changes`, grouped by schema file; a breaking file whose version suffix stays is called out. */
export function report(changes, { since = 'the ref' } = {}) {
  if (!changes.length) return [`no schema change since ${since}`];
  const lines = [], files = [...new Set(changes.map((c) => c.file))];
  for (const f of files) {
    const cs = changes.filter((c) => c.file === f), broke = cs.filter((c) => c.breaking);
    lines.push(`${f}  ${cs.length} change${cs.length === 1 ? '' : 's'} since ${since}${broke.length ? `, ${broke.length} BREAKING` : ''}`);
    const v = /-(\d+)\.schema\.json$/.exec(f);
    if (broke.length && v) lines.push(`  version suffix -${v[1]} unchanged: bump it to -${Number(v[1]) + 1} for a breaking edit, or restore the field`);
    for (const c of cs) {
      lines.push(`  ${c.breaking ? `BREAKING (${c.breakingFor.join(', ')})` : 'ok'}  ${c.kind}  ${c.what}`);
      if (c.ue) lines.push(`      ue: ${c.ue}`);
      if (c.ts) lines.push(`      ts: ${c.ts}`);
    }
  }
  const n = changes.filter((c) => c.breaking).length;
  lines.push(`${changes.length} schema change${changes.length === 1 ? '' : 's'} since ${since}, ${n} breaking`);
  return lines;
}
