#!/usr/bin/env node
// app-structure v3's JSON Schemas (./schema, normative) to the two channels' types:
//   generated/ts/app-structure.ts   TypeScript interfaces
//   generated/ue/BpSchema.h         Unreal USTRUCTs with UPROPERTY fields, named as the JSON keys, so the VR client's
//                                   FJsonObjectConverter::JsonObjectToUStruct fills them with no hand-written parsing
// Both come from one model of the schemas (`model()`), so a field added to a schema reaches both in one run.
//
// The mapping, per schema node (UE side; TS is the same shape, closer to the schema):
//   string, enum, string const        FString (the allowed values in a comment)       string | 'a' | 'b'
//   integer / number / boolean        int32 / double / bool                            number / boolean
//   string|number|boolean (a scalar)  FString (the converter reads numbers and bools   string | number | boolean
//                                     as their text)
//   array of T                        TArray<T>                                        T[]
//   object of T (additionalProperties) TMap<FString, T>                               Record<string, T>
//   object with properties            a USTRUCT F<Bp + name>                           an interface
//   free-form or polymorphic object   FJsonObjectWrapper (condition, scan, provenance) Record<string, unknown>
//   an object of objects (nested)     TMap<FString, FJsonObjectWrapper> (UPROPERTY     the nested type
//                                     cannot nest containers); an array inside one is not mapped
//   string-or-object, a C++ keyword,  not mapped: listed in the struct's comment;      the precise type
//   or a key that is no identifier    the client reads it from the raw FJsonObject
// Optional and required fields look the same in C++ (a missing key keeps the default); the TS side marks optional.
//
// Run: node packages/schema/generate.mjs           write both files
//      node packages/schema/generate.mjs --check   exit 1 when either committed file differs from a fresh generation
//                                                  (stale), after proving on a seeded schema change that it would
// npm: `npm run schema:generate`, `npm run check:schema`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(HERE, 'schema');
const OUT_TS = path.join(HERE, 'generated/ts/app-structure.ts');
const OUT_UE = path.join(HERE, 'generated/ue/BpSchema.h');
const ROOTS = [
  ['app-structure-3.schema.json', 'AppStructure'],
  ['app-structure-event-3.schema.json', 'AppStructureEvent'],
  ['lens-manifest-1.schema.json', 'LensManifest'],
];
const CPP_KEYWORDS = new Set(('alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq'
  + ' check verify ensure TEXT').split(' ')); // the last four are Unreal macros

const pascal = (s) => s.replace(/(^|[-_.\s])([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
const oneLine = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- the model
/** Build the model from the schema files: { structs: Map<name, struct>, roots: [name] }. */
export function model(schemas) {
  const structs = new Map(), byRef = new Map();
  const deref = (file, ref) => {
    const [f, ptr = ''] = ref.split('#');
    const target = f ? f : file;
    let node = schemas[target];
    if (!node) throw new Error(`${file}: $ref to unknown file ${f}`);
    for (const k of ptr.split('/').filter(Boolean)) node = node[k];
    if (node === undefined) throw new Error(`${file}: $ref ${ref} does not resolve`);
    const defName = ptr.startsWith('/$defs/') ? ptr.slice('/$defs/'.length) : null;
    return { file: target, node, key: `${target}#${ptr}`, name: defName ? pascal(defName) : ROOTS.find(([r]) => r === target)[1] };
  };
  const polymorphic = (s) => s.if !== undefined || s.oneOf !== undefined || s.anyOf !== undefined;

  function resolve(s, file, hint) {
    if (s === true || s === undefined) return { k: 'any', why: 'untyped' };
    if (s.$ref) {
      const t = deref(file, s.$ref);
      const isStruct = t.node.type === 'object' && t.node.properties && !(polymorphic(t.node) && !t.node.properties);
      if (isStruct) {
        if (!byRef.has(t.key)) { byRef.set(t.key, t.name); buildStruct(t.node, t.file, t.name); }
        return { k: 'struct', name: byRef.get(t.key), description: s.description };
      }
      return { ...resolve(t.node, t.file, t.name), description: s.description ?? t.node.description };
    }
    const desc = s.description;
    if (polymorphic(s) && !s.properties) {
      const objectish = s.type === 'object' || ['then', 'else'].every((b) => !s[b] || s[b].$ref || s[b].type === 'object' || s[b].if);
      return s.type === 'object' || (objectish && s.type !== 'string' && !s.then?.enum) ? { k: 'json', description: desc, why: 'polymorphic' } : { k: 'any', description: desc, why: 'a string or an object' };
    }
    if (s.enum) return s.enum.every((v) => typeof v === 'string') ? { k: 'string', enum: s.enum, description: desc } : { k: 'any', why: 'mixed enum' };
    if (s.const !== undefined) {
      const t = typeof s.const;
      return t === 'string' ? { k: 'string', enum: [s.const], description: desc } : t === 'boolean' ? { k: 'bool', const: s.const, description: desc } : Number.isInteger(s.const) ? { k: 'int', const: s.const, description: desc } : { k: 'number', description: desc };
    }
    if (Array.isArray(s.type)) {
      const t = [...s.type].sort().join(',');
      if (t === 'boolean,number,string') return { k: 'scalar', description: desc };
      if (t === 'number,string') return { k: 'strnum', description: desc };
      return { k: 'any', why: `type ${t}` };
    }
    switch (s.type) {
      case 'string': return { k: 'string', description: desc, ...(s.pattern ? { pattern: s.pattern } : {}) };
      case 'integer': return { k: 'int', description: desc };
      case 'number': return { k: 'number', description: desc };
      case 'boolean': return { k: 'bool', description: desc };
      case 'array': return { k: 'array', item: s.items ? resolve(s.items, file, hint + 'Item') : { k: 'any', why: 'untyped items' }, description: desc };
      case 'object':
        if (s.properties) { buildStruct(s, file, hint); return { k: 'struct', name: hint, description: desc }; }
        if (s.additionalProperties && typeof s.additionalProperties === 'object') return { k: 'map', value: resolve(s.additionalProperties, file, hint + 'Value'), description: desc };
        return { k: 'json', description: desc, why: 'free-form object' };
      default:
        if (s.properties) { buildStruct(s, file, hint); return { k: 'struct', name: hint, description: desc }; }
        return { k: 'any', description: desc, why: 'untyped' };
    }
  }

  function buildStruct(s, file, name) {
    if (structs.has(name)) return;
    const st = { name, description: s.description ?? s.title, props: [], open: s.additionalProperties !== false };
    structs.set(name, st); // before the fields: a self-reference resolves to the name
    const req = new Set(s.required ?? []);
    for (const [key, sub] of Object.entries(s.properties)) {
      if (sub === false) continue;
      st.props.push({ key, required: req.has(key), node: resolve(sub, file, name + pascal(key)) });
    }
  }

  const roots = [];
  for (const [file, name] of ROOTS) {
    byRef.set(`${file}#`, name);
    buildStruct(schemas[file], file, name);
    roots.push(name);
  }
  return { structs, roots };
}

// ---------------------------------------------------------------- TypeScript
function tsType(n) {
  switch (n.k) {
    case 'string': return n.enum ? n.enum.map((v) => `'${v}'`).join(' | ') : 'string';
    case 'int': case 'number': return n.const !== undefined ? String(n.const) : 'number';
    case 'bool': return n.const !== undefined ? String(n.const) : 'boolean';
    case 'scalar': return 'string | number | boolean';
    case 'strnum': return 'number | string';
    case 'array': { const t = tsType(n.item); return /[|&]/.test(t) ? `(${t})[]` : `${t}[]`; }
    case 'map': return `Record<string, ${tsType(n.value)}>`;
    case 'struct': return n.name;
    case 'json': return 'Record<string, unknown>';
    default: return 'unknown';
  }
}
const tsKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
export function emitTs(m) {
  const out = ['// GENERATED by packages/schema/generate.mjs from packages/schema/schema/*.schema.json. Do not edit:',
    '// change a schema and run `npm run schema:generate`; `npm run check:schema` fails while this file is stale.',
    '// Polymorphic parts (conditions, scan blocks, a glyph) are typed loosely here; the schemas and',
    '// packages/core/src/standard/types.ts carry their exact shapes.', ''];
  for (const st of m.structs.values()) {
    if (st.description) out.push(`/** ${oneLine(st.description)} */`);
    out.push(`export interface ${st.name} {`);
    for (const p of st.props) {
      const d = oneLine(p.node.description);
      if (d) out.push(`  /** ${d} */`);
      out.push(`  ${tsKey(p.key)}${p.required ? '' : '?'}: ${tsType(p.node)};`);
    }
    if (st.open) out.push('  [key: string]: unknown;');
    out.push('}', '');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- Unreal
const ueName = (name) => `FBp${name}`;
/** The C++ type of a node, or null when it cannot be a UPROPERTY (with why). */
function ueType(n, nested = false) {
  switch (n.k) {
    case 'string': case 'scalar': case 'strnum': return { t: 'FString' };
    case 'int': return { t: 'int32', init: '0' };
    case 'number': return { t: 'double', init: '0.0' };
    case 'bool': return { t: 'bool', init: 'false' };
    case 'struct': return { t: ueName(n.name) };
    case 'json': return { t: 'FJsonObjectWrapper' };
    case 'array': case 'map': {
      // a container inside a container: an object of objects can still arrive whole as FJsonObjectWrapper; an array cannot
      if (nested) return n.k === 'map' ? { t: 'FJsonObjectWrapper', note: 'an object of objects' } : { t: null, why: 'an array inside a container' };
      const inner = ueType(n.k === 'array' ? n.item : n.value, true);
      if (!inner.t) return inner;
      return { t: n.k === 'array' ? `TArray<${inner.t}>` : `TMap<FString, ${inner.t}>`, note: inner.note };
    }
    default: return { t: null, why: n.why ?? 'untyped' };
  }
}
function deps(st) {
  const out = new Set();
  const walk = (n) => { if (n.k === 'struct') out.add(n.name); else if (n.k === 'array') walk(n.item); else if (n.k === 'map') walk(n.value); };
  for (const p of st.props) walk(p.node);
  return out;
}
export function emitUe(m) {
  // declaration order: a struct after every struct its fields hold
  const order = [], seen = new Set();
  const visit = (name, stack = []) => {
    if (seen.has(name)) return;
    if (stack.includes(name)) throw new Error(`struct cycle ${[...stack, name].join(' -> ')}: a USTRUCT cannot hold itself`);
    for (const d of deps(m.structs.get(name))) if (d !== name) visit(d, [...stack, name]);
    seen.add(name); order.push(name);
  };
  for (const name of m.structs.keys()) visit(name);

  const out = ['// GENERATED by packages/schema/generate.mjs from packages/schema/schema/*.schema.json. Do not edit:',
    '// change a schema and run `npm run schema:generate`; `npm run check:schema` fails while this file is stale.',
    '//',
    '// app-structure v3 for the VR client (apps/vr, module BpLink). Field names are the JSON keys, so',
    '// FJsonObjectConverter::JsonObjectToUStruct fills these from apps/server\'s answers. A missing key keeps the',
    '// default; enums are FString (their values in the comment); fields a USTRUCT cannot hold are listed per struct',
    '// as "not mapped" and are read from the raw FJsonObject.',
    '#pragma once', '', '#include "CoreMinimal.h"', '#include "JsonObjectWrapper.h"', '#include "BpSchema.generated.h"', ''];
  for (const name of order) {
    const st = m.structs.get(name), fields = [], skipped = [];
    for (const p of st.props) {
      const ok = /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.key) && !CPP_KEYWORDS.has(p.key);
      const t = ueType(p.node);
      if (!ok) { skipped.push(`${p.key} (${/^[A-Za-z_]\w*$/.test(p.key) ? 'a C++ keyword or Unreal macro' : 'not an identifier'})`); continue; }
      if (!t.t) { skipped.push(`${p.key} (${t.why})`); continue; }
      const notes = [oneLine(p.node.description).replace(/\.$/, ''), p.node.enum && p.node.enum.length > 1 ? `one of: ${p.node.enum.join(', ')}` : '', p.node.enum?.length === 1 ? `always "${p.node.enum[0]}"` : '',
        p.node.k === 'scalar' || p.node.k === 'strnum' ? 'a number or boolean arrives as its text' : '', t.note ? `raw JSON: ${t.note}` : '', p.required ? 'required' : ''].filter(Boolean);
      fields.push({ key: p.key, t: t.t, init: t.init, notes });
    }
    if (st.description) out.push(`/** ${oneLine(st.description)} */`);
    if (skipped.length) out.push(`// not mapped (read from the raw JSON): ${skipped.join('; ')}`);
    out.push('USTRUCT(BlueprintType)', `struct BPLINK_API ${ueName(name)}`, '{', '\tGENERATED_BODY()', '');
    for (const f of fields) {
      if (f.notes.length) out.push(`\t/** ${f.notes.join('. ')} */`);
      out.push('\tUPROPERTY(BlueprintReadOnly, Category = "Bp")', `\t${f.t} ${f.key}${f.init ? ` = ${f.init}` : ''};`, '');
    }
    if (!fields.length) out.push('');
    out.pop();
    out.push('};', '');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- the UE mapping against real data
// FJsonObjectConverter fails a whole struct when one field's JSON value cannot convert, so every mapped field is
// checked against real documents the way the converter reads it: FString takes a string, number or boolean; int32 and
// double a number; bool a boolean; a struct, FJsonObjectWrapper or TMap an object; TArray an array.
export function conform(m, structName, value, where = structName, out = []) {
  const st = m.structs.get(structName);
  if (!value || typeof value !== 'object' || Array.isArray(value)) { out.push(`${where}: not an object`); return out; }
  for (const p of st.props) {
    if (!(p.key in value)) continue;
    const ok = /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.key) && !CPP_KEYWORDS.has(p.key);
    const t = ueType(p.node);
    if (ok && t.t) conformNode(m, p.node, t.t, value[p.key], `${where}.${p.key}`, out);
  }
  return out;
}
function conformNode(m, n, cpp, v, where, out) {
  const isObj = v !== null && typeof v === 'object' && !Array.isArray(v);
  if (cpp === 'FString') { if (!['string', 'number', 'boolean'].includes(typeof v)) out.push(`${where}: ${JSON.stringify(v)?.slice(0, 40)} is no string`); return; }
  if (cpp === 'int32') { if (!Number.isInteger(v)) out.push(`${where}: ${v} is no integer`); return; }
  if (cpp === 'double') { if (typeof v !== 'number') out.push(`${where}: ${v} is no number`); return; }
  if (cpp === 'bool') { if (typeof v !== 'boolean') out.push(`${where}: ${v} is no boolean`); return; }
  if (cpp === 'FJsonObjectWrapper') { if (!isObj) out.push(`${where}: FJsonObjectWrapper needs an object`); return; }
  if (cpp.startsWith('TArray<')) {
    if (!Array.isArray(v)) { out.push(`${where}: no array`); return; }
    const inner = cpp.slice(7, -1);
    v.forEach((x, i) => conformNode(m, n.item, inner, x, `${where}[${i}]`, out));
    return;
  }
  if (cpp.startsWith('TMap<FString, ')) {
    if (!isObj) { out.push(`${where}: no object`); return; }
    const inner = cpp.slice('TMap<FString, '.length, -1);
    for (const [k, x] of Object.entries(v)) conformNode(m, n.value, inner, x, `${where}.${k}`, out);
    return;
  }
  if (cpp.startsWith('FBp')) { conform(m, n.name, v, where, out); return; }
  out.push(`${where}: no rule for ${cpp}`);
}

// ---------------------------------------------------------------- run
const readSchemas = () => Object.fromEntries(ROOTS.map(([f]) => [f, JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8'))]));
const generate = (schemas) => { const m = model(schemas); return { ts: emitTs(m), ue: emitUe(m), m }; };
const norm = (s) => s.replace(/\r\n/g, '\n');

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const schemas = readSchemas();
  const fresh = generate(schemas);
  const counts = `${fresh.m.structs.size} structs from ${ROOTS.length} schemas`;
  if (process.argv.includes('--check')) {
    let failed = 0;
    const read = (f) => (fs.existsSync(f) ? norm(fs.readFileSync(f, 'utf8')) : null);
    for (const [f, text] of [[OUT_TS, fresh.ts], [OUT_UE, fresh.ue]]) {
      const have = read(f), rel = path.relative(path.join(HERE, '../..'), f).split(path.sep).join('/');
      if (have === text) { console.log(`ok    ${rel} is current (${counts})`); continue; }
      failed++;
      if (have === null) { console.log(`FAIL  ${rel} is missing: run npm run schema:generate`); continue; }
      const a = have.split('\n'), b = text.split('\n'); let i = 0; while (i < a.length && a[i] === b[i]) i++;
      console.log(`FAIL  ${rel} is stale: run npm run schema:generate (first difference at line ${i + 1}: committed "${(a[i] ?? '').trim()}", fresh "${(b[i] ?? '').trim()}")`);
    }
    // the mapping against real documents: Kettle's map and events, the built-in lens manifests, the valid fixtures
    const ROOT = path.join(HERE, '../..');
    const docs = [['AppStructure', 'packages/core/data/kettle.app-structure.json'], ['AppStructure', 'packages/schema/schema/fixtures/valid-map.json'], ['LensManifest', 'packages/schema/schema/fixtures/valid-steps-lens.json'],
      ...fs.readdirSync(path.join(ROOT, 'docs/standard/lenses')).filter((f) => f.endsWith('.json')).map((f) => ['LensManifest', 'docs/standard/lenses/' + f]),
      ...fs.readdirSync(path.join(ROOT, 'docs/standard/lenses-custom')).filter((f) => f.endsWith('.json')).map((f) => ['LensManifest', 'docs/standard/lenses-custom/' + f])];
    let nDocs = 0, problems = [];
    for (const [name, rel] of docs) { nDocs++; problems.push(...conform(fresh.m, name, JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')), rel)); }
    const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
    events.forEach((l, i) => problems.push(...conform(fresh.m, 'AppStructureEvent', JSON.parse(l), `kettle.events.jsonl:${i + 1}`)));
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  the UE mapping reads ${nDocs} documents and ${events.length} events as FJsonObjectConverter would${problems.length ? ': ' + problems.slice(0, 8).join('; ') : ''}`);
    if (problems.length) failed++;
    const bad = conform(fresh.m, 'AppStructure', { version: '3', features: [{ slug: 'x', parts: [{ done: 'yes' }] }], facets: { x: [1] } });
    const conformCaught = bad.length === 3;
    console.log(`${conformCaught ? 'ok  ' : 'FAIL'}  control: a string version, a string bool and an array facet are refused (${bad.length} of 3)`);
    if (!conformCaught) failed++;
    // control: a field added to a schema must change both outputs (so a stale file cannot pass)
    const seeded = structuredClone(schemas);
    seeded['app-structure-3.schema.json'].$defs.feature.properties.zzParityProbe = { type: 'integer' };
    const red = generate(seeded);
    const caught = red.ts !== fresh.ts && red.ue !== fresh.ue && red.ue.includes('int32 zzParityProbe') && red.ts.includes('zzParityProbe?: number');
    console.log(`${caught ? 'ok  ' : 'FAIL'}  control: a field added to feature changes both outputs`);
    if (!caught) failed++;
    process.exit(failed ? 1 : 0);
  }
  for (const [f, text] of [[OUT_TS, fresh.ts], [OUT_UE, fresh.ue]]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  console.log(`wrote ${path.relative(process.cwd(), OUT_TS)} and ${path.relative(process.cwd(), OUT_UE)} (${counts})`);
}
