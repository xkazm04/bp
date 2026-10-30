#!/usr/bin/env node
// app-structure v3's JSON Schemas (./schema, normative) to the two channels' types:
//   generated/ts/app-structure.ts   TypeScript interfaces: a parity artifact. Code imports the hand-written
//                                   packages/core/src/standard/types.ts; --check fails when the two disagree on a
//                                   field or its optionality (parity.mjs)
//   generated/ue/BpSchema.h         Unreal USTRUCTs with UPROPERTY fields, named as the JSON keys, so the VR client's
//                                   FJsonObjectConverter::JsonObjectToUStruct fills them with no hand-written parsing
//   generated/ue/BpSchemaFixups.h   BpSchema::FixUp and FromJson: fill the <Key>_ fields the converter cannot
//   packages/core/src/standard/schema-vocab.ts
//                                   the vocabularies as consts: every named string enum, the scope kinds, the lens
//                                   manifest's keys, the wave bounds and the proposal id pattern. Unlike the TS types,
//                                   core IMPORTS it: its allow-lists are these values, not a copy (one authority per
//                                   vocabulary; scripts/check-schema-vocab.mjs)
// All come from one model of the schemas (`model()`), so a field added to a schema reaches every output in one run.
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
//                                     cannot nest containers); an object of arrays
//                                     (taxonomy) is one FJsonObjectWrapper
//   a C++ keyword, or a key that is   a renamed UPROPERTY <Key>_ of the mapped type,   the precise type
//   no identifier (short, $schema)    filled by FixUp (see carry())
//   string-or-object, untyped items   FString <Key>_: the value's JSON text, by FixUp  the precise type
// Optional and required fields look the same in C++ (a missing key keeps the default); the TS side marks optional.
//
// Run: node packages/schema/generate.mjs           write the four files
//      node packages/schema/generate.mjs --check   exit 1 when a committed file differs from a fresh generation
//                                                  (stale), when a schema field is neither mapped nor copied by
//                                                  FixUp, or when types.ts disagrees with the generated types; each
//                                                  with a seeded control proving it would (staleness: each committed
//                                                  file with one line mutated, and with one deleted, is reported
//                                                  stale by the same staleVerdict the real comparison calls)
//                                                  The raw carries (cross_refs, both forms of glyph) have no real
//                                                  document, so an in-memory one is read through conform + the
//                                                  fix-up text (rawCarried); its control removes each copy / the key.
//      node packages/schema/generate.mjs --since <ref> [--dry-run]
//                                                  first print what the schema edits since a git ref do to each
//                                                  channel (compat.mjs: added, removed, required, enum, ue-type,
//                                                  ts-type; breaking for whom), then write; --dry-run writes nothing
// npm: `npm run schema:generate`, `npm run check:schema`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(HERE, 'schema');
const OUT_TS = path.join(HERE, 'generated/ts/app-structure.ts');
const OUT_UE = path.join(HERE, 'generated/ue/BpSchema.h');
const OUT_FIX = path.join(HERE, 'generated/ue/BpSchemaFixups.h');
const OUT_VOCAB = path.join(HERE, '../core/src/standard/schema-vocab.ts');
const HAND_TS = 'packages/core/src/standard/types.ts'; // the hand-written types the code uses; parity.mjs compares
const ROOTS = [
  ['app-structure-3.schema.json', 'AppStructure'],
  ['app-structure-event-3.schema.json', 'AppStructureEvent'],
  ['lens-manifest-1.schema.json', 'LensManifest'],
  ['plan-1.schema.json', 'Plan'],
  ['structure-envelope-1.schema.json', 'StructureEnvelope'],
  ['scan-wire-1.schema.json', 'ScanWire'],
  ['decision-brief-1.schema.json', 'DecisionBrief'],
  // A root's third element names the structs under it that a client also reads ON THEIR OWN (each its own payload on the
  // wire): FromJson works for them as for a root, and ue-standin/check.cpp must instantiate it for each.
  ['shared-focus-1.schema.json', 'SharedFocus', ['FocusPlace', 'SharedView', 'SharedPlace', 'FocusAnswer']],
  ['morning-deck-1.schema.json', 'MorningWatch', ['MorningDeck', 'AgentDeck', 'SteerRow']],
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
    const st = { name, file, description: s.description ?? s.title, props: [], open: s.additionalProperties !== false };
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
  // the structs a client reads on their own (ROOTS' third element): each must exist, or the name is a typo
  // (a root read as an empty stub - a schema new since a git ref, see --since - makes none of them yet)
  const readable = ROOTS.flatMap(([file, , reads = []]) => (schemas[file].$defs ? reads : []).filter((n) => { if (!structs.has(n)) throw new Error(`${file}: ROOTS reads ${n}, which the schema does not make`); return true; }));
  return { structs, roots, readable, schemas };
}

// ---------------------------------------------------------------- TypeScript
export function tsType(n) {
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
    '// packages/core/src/standard/types.ts carry their exact shapes.',
    '// A parity artifact: code imports packages/core/src/standard/types.ts (hand-written), never this file, and',
    '// `npm run check:schema` fails when the two disagree on a field or its optionality (packages/schema/parity.mjs).', ''];
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

// ---------------------------------------------------------------- the vocabulary consts core imports
// Every named string enum ($defs.<name>.enum) becomes <NAME>S; the rows below are the other values a refusal path in
// packages/core reads. A pointer that stops resolving throws, so a schema reshaped under a row fails generation.
const VOCAB_ROWS = [
  ['SCAN_SCOPE_KINDS', 'scan-wire-1.schema.json', '/$defs/scanScope/properties/kind/enum', 'list'],
  ['LENS_MANIFEST_KEYS', 'lens-manifest-1.schema.json', '/properties', 'keys'],
  ['WAVE_NAME_MAX_LENGTH', 'scan-wire-1.schema.json', '/$defs/waveName/maxLength', 'number'],
  ['WAVE_PACKAGES_MAX_ITEMS', 'scan-wire-1.schema.json', '/$defs/wave/properties/packages/maxItems', 'number'],
  ['PROPOSAL_ID_PATTERN', 'scan-wire-1.schema.json', '/$defs/proposalId/pattern', 'pattern'],
  ['BRIEF_MATCHES', 'decision-brief-1.schema.json', '/$defs/briefDecided/properties/match/enum', 'list'],
];
const constCase = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
const plural = (s) => (/(S|X|SH|CH)$/.test(s) ? s + 'ES' : /[^AEIOU]Y$/.test(s) ? s.slice(0, -1) + 'IES' : s + 'S');
const quote = (v) => (/['\\\n]/.test(v) ? JSON.stringify(v) : `'${v}'`);
const strings = (vs) => `[${vs.map(quote).join(', ')}] as const`;
/** packages/core/src/standard/schema-vocab.ts: pure, import-free and strip-only safe (check:core-purity). */
export function emitVocab(m) {
  const { schemas } = m, rows = [], seen = new Map();
  for (const [file] of ROOTS) for (const [def, node] of Object.entries(schemas[file].$defs ?? {})) {
    if (!Array.isArray(node.enum) || !node.enum.every((v) => typeof v === 'string')) continue;
    const name = plural(constCase(def));
    if (seen.has(name)) throw new Error(`${file}: $defs.${def} and ${seen.get(name)} both make ${name}`);
    seen.set(name, `${file} $defs.${def}`);
    rows.push({ name, from: `${file.replace('.schema.json', '')} $defs.${def}.enum`, description: node.description, text: strings(node.enum) });
  }
  for (const [name, file, ptr, form] of VOCAB_ROWS) {
    let node = schemas[file];
    for (const k of ptr.split('/').filter(Boolean)) node = node?.[k];
    const ok = form === 'list' ? Array.isArray(node) && node.every((v) => typeof v === 'string') : form === 'keys' ? !!node && typeof node === 'object'
      : form === 'number' ? Number.isInteger(node) : typeof node === 'string';
    if (!ok) throw new Error(`${file}#${ptr}: no ${form} for ${name}`);
    const text = form === 'list' ? strings(node) : form === 'keys' ? strings(Object.keys(node)) : form === 'number' ? String(node) : `new RegExp(${JSON.stringify(node)})`;
    rows.push({ name, from: `${file.replace('.schema.json', '')} ${ptr.slice(1).replaceAll('/', '.')}${form === 'keys' ? ' (its keys)' : ''}`, text });
  }
  const out = ['// GENERATED by packages/schema/generate.mjs from packages/schema/schema/*.schema.json. Do not edit:',
    '// change a schema and run `npm run schema:generate`; `npm run check:schema` fails while this file is stale.',
    "// The schemas' vocabularies, once: the allow-lists packages/core refuses by import these values instead of a",
    '// hand-typed second copy (scripts/check-schema-vocab.mjs). Pure and import-free.', ''];
  for (const r of rows) out.push(`/** ${r.from}${r.description ? ': ' + oneLine(r.description) : ''} */`, `export const ${r.name} = ${r.text};`);
  out.push('');
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
      // an object whose values no UPROPERTY can hold (taxonomy: arrays) still arrives whole as FJsonObjectWrapper
      if (!inner.t) return n.k === 'map' ? { t: 'FJsonObjectWrapper', note: `an object of values no UPROPERTY can hold (${inner.why})` } : inner;
      return { t: n.k === 'array' ? `TArray<${inner.t}>` : `TMap<FString, ${inner.t}>`, note: inner.note };
    }
    default: return { t: null, why: n.why ?? 'untyped' };
  }
}
/**
 * How BpLink holds each field of a struct, one entry per schema property:
 *   mapped    a UPROPERTY named as the JSON key: FJsonObjectConverter fills it
 *   renamed   the key is no C++ name (a keyword, a macro, `$schema`): a UPROPERTY `<Key>_` of the mapped type,
 *             filled by the generated BpSchema::FixUp (BpSchemaFixups.h) with JsonValueToUProperty
 *   raw       no UPROPERTY type holds the value (string-or-object, untyped items): FString `<Key>_`, the value's
 *             condensed JSON text, filled by FixUp
 * The converter matches a key to a property name case-insensitively, so a `<Key>_` name must not fold onto a key.
 */
export function carry(st) {
  const out = st.props.map((p) => {
    const t = ueType(p.node);
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.key) && !CPP_KEYWORDS.has(p.key);
    if (ident && t.t) return { p, how: 'mapped', field: p.key, t };
    const field = pascal(p.key.replace(/^[^A-Za-z]+/, '')) + '_';
    if (t.t) return { p, how: 'renamed', field, t, why: /^[A-Za-z_]\w*$/.test(p.key) ? 'a C++ keyword or Unreal macro' : 'not an identifier' };
    return { p, how: 'raw', field, t: { t: 'FString' }, why: p.node.why ?? 'untyped' };
  });
  const names = new Map();
  for (const c of out) {
    for (const n of new Set([c.p.key.toLowerCase(), c.field.toLowerCase()])) {
      if (names.has(n) && names.get(n) !== c) throw new Error(`${st.name}: field ${c.field} (key ${c.p.key}) collides with ${names.get(n).field}`);
      names.set(n, c);
    }
  }
  return out;
}
/** Structs whose FixUp has work: a carried field of their own, or one in a struct they hold. */
function fixupStructs(m) {
  const need = new Set();
  // the struct a UPROPERTY holds directly, in a TArray or in a TMap ({ name, as: 'one' | 'array' | 'map' }), or null
  const holds = (n) => {
    const t = ueType(n).t ?? '', h = /^(TArray<|TMap<FString, )?FBp(\w+)>?$/.exec(t);
    return h ? { name: h[2], as: !h[1] ? 'one' : h[1] === 'TArray<' ? 'array' : 'map' } : null;
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const st of m.structs.values()) {
      if (need.has(st.name)) continue;
      const own = carry(st).some((c) => c.how !== 'mapped');
      const inner = st.props.some((p) => need.has(holds(p.node)?.name));
      if (own || inner) { need.add(st.name); grew = true; }
    }
  }
  return { need, holds };
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
    '// default; enums are FString (their values in the comment). A key that is no C++ name, or a value no UPROPERTY',
    '// type holds, is a `<Key>_` field the converter skips; read a document with BpSchema::FromJson',
    '// (BpSchemaFixups.h), which runs the converter and then BpSchema::FixUp to fill those fields.',
    '#pragma once', '', '#include "CoreMinimal.h"', '#include "JsonObjectWrapper.h"', '#include "BpSchema.generated.h"', ''];
  for (const name of order) {
    const st = m.structs.get(name), fields = [], carried = [];
    for (const c of carry(st)) {
      const { p, t } = c;
      const via = c.how === 'renamed' ? `JSON key "${p.key}" (${c.why}): filled by BpSchema::FixUp, not by FJsonObjectConverter`
        : c.how === 'raw' ? `JSON key "${p.key}" as its condensed JSON text (${c.why}): filled by BpSchema::FixUp, not by FJsonObjectConverter` : '';
      const notes = [via, oneLine(p.node.description).replace(/\.$/, ''), p.node.enum && p.node.enum.length > 1 ? `one of: ${p.node.enum.join(', ')}` : '', p.node.enum?.length === 1 ? `always "${p.node.enum[0]}"` : '',
        c.how !== 'raw' && (p.node.k === 'scalar' || p.node.k === 'strnum') ? 'a number or boolean arrives as its text' : '', t.note ? `raw JSON: ${t.note}` : '', p.required ? 'required' : ''].filter(Boolean);
      fields.push({ key: c.field, t: t.t, init: t.init, notes });
      if (c.how !== 'mapped') carried.push(`${p.key} -> ${c.field}`);
    }
    if (st.description) out.push(`/** ${oneLine(st.description)} */`);
    if (carried.length) out.push(`// carried by BpSchema::FixUp (BpSchemaFixups.h): ${carried.join('; ')}`);
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

// ---------------------------------------------------------------- Unreal: the fix-up for carried fields
/** BpSchemaFixups.h: BpSchema::FixUp per struct with a carried field (its own or a held struct's), and FromJson. */
export function emitFixups(m) {
  const { need: work, holds } = fixupStructs(m);
  const need = new Set([...work, ...m.roots, ...(m.readable ?? [])]); // FromJson works for every root and every struct read on its own
  const order = [...m.structs.keys()].filter((n) => need.has(n));
  const out = ['// GENERATED by packages/schema/generate.mjs from packages/schema/schema/*.schema.json. Do not edit:',
    '// change a schema and run `npm run schema:generate`; `npm run check:schema` fails while this file is stale, and',
    '// fails when a schema field is neither a UPROPERTY named as its key nor copied here.',
    '//',
    '// BpSchema.h names a field as its JSON key wherever C++ allows, so FJsonObjectConverter fills it. The rest are',
    '// `<Key>_` fields the converter skips (it matches property names to keys, case-insensitively); FixUp copies the',
    '// raw key into each one after the converter ran:',
    '//   a key that is no C++ name (short, default, $schema)   JsonValueToUProperty into the renamed UPROPERTY',
    '//   a value no UPROPERTY type holds (glyph, cross_refs)    its condensed JSON text into an FString',
    '// Read every document with BpSchema::FromJson, never with JsonObjectToUStruct alone.',
    '#pragma once', '', '#include "CoreMinimal.h"', '#include "Dom/JsonObject.h"', '#include "JsonObjectConverter.h"',
    '#include "Policies/CondensedJsonPrintPolicy.h"', '#include "Serialization/JsonSerializer.h"', '#include "Serialization/JsonWriter.h"', '#include "BpSchema.h"', '',
    'namespace BpSchema', '{'];
  for (const n of order) out.push(`\tinline bool FixUp(const FJsonObject& Json, ${ueName(n)}& Out);`);
  out.push('',
    '\t/**',
    '\t * Why the last FromJson on this thread returned false, for a log line: the call that failed first, the path of its',
    '\t * key from the document root (`lenses[0].manifest.presentation.glyph`; empty for JsonObjectToUStruct, which logs its',
    '\t * own LogJson line naming the property) and how many steps failed (FixUpArray stops at its first failing item).',
    '\t * FromJson empties it before it reads.',
    '\t */',
    '\tstruct FFromJsonFailure',
    '\t{',
    '\t\tFString Call;',
    '\t\tFString Path;',
    '\t\tint32 Count = 0;',
    '\t};',
    '\tinline FFromJsonFailure& LastFailure()',
    '\t{',
    '\t\tthread_local FFromJsonFailure Failure;',
    '\t\treturn Failure;',
    '\t}',
    '',
    '\t/** Records a failed step; the first one keeps its call and key. Returns false. */',
    '\tinline bool Failed(const TCHAR* Call, const FString& Key)',
    '\t{',
    '\t\tFFromJsonFailure& Failure = LastFailure();',
    '\t\tif (Failure.Count++ == 0)',
    '\t\t{',
    '\t\t\tFailure.Call = Call;',
    '\t\t\tFailure.Path = Key;',
    '\t\t}',
    '\t\treturn false;',
    '\t}',
    '',
    '\t/** After the struct held at Key failed: prefixes the path with Key when the first failure was inside it. Returns false. */',
    '\tinline bool Within(const int32 CountBefore, const FString& Key)',
    '\t{',
    '\t\tFFromJsonFailure& Failure = LastFailure();',
    '\t\tif (CountBefore == 0 && Failure.Count > 0) Failure.Path = Failure.Path.IsEmpty() ? Key : Key + TEXT(".") + Failure.Path;',
    '\t\treturn false;',
    '\t}',
    '',
    '\t/** Json[Key] into the UPROPERTY Field of Out, as the converter would have read it. A missing key keeps the default. */',
    '\ttemplate <typename T>',
    '\tbool CopyKey(const FJsonObject& Json, const TCHAR* Key, const FName Field, T& Out)',
    '\t{',
    '\t\tconst TSharedPtr<FJsonValue> Value = Json.TryGetField(Key);',
    '\t\tif (!Value.IsValid()) return true;',
    '\t\tFProperty* Property = T::StaticStruct()->FindPropertyByName(Field);',
    '\t\treturn (Property && FJsonObjectConverter::JsonValueToUProperty(Value, Property, Property->ContainerPtrToValuePtr<void>(&Out), 0, 0)) || Failed(TEXT("CopyKey"), Key);',
    '\t}',
    '',
    '\t/**',
    '\t * Json[Key] as condensed JSON text into Out (a bare string keeps its quotes). A missing key leaves Out empty.',
    '\t * The writer copies its text into Out in Close(), and UE\'s TJsonWriter::Close() is true only after a closing } or ]',
    '\t * (Serialization/JsonWriter.h), so it is false after a bare scalar such as the glyph "pulse" although the text is',
    '\t * written: a scalar is graded by the text it left in Out, an object or array by Close() (reading 12, machine.md).',
    '\t */',
    '\tinline bool CopyRaw(const FJsonObject& Json, const TCHAR* Key, FString& Out)',
    '\t{',
    '\t\tconst TSharedPtr<FJsonValue> Value = Json.TryGetField(Key);',
    '\t\tif (!Value.IsValid()) return true;',
    '\t\tOut.Reset();',
    '\t\tconst TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);',
    '\t\tconst bool bWritten = FJsonSerializer::Serialize(Value, FString(), Writer, false);',
    '\t\tconst bool bClosed = Writer->Close();',
    '\t\tconst bool bScalar = Value->Type != EJson::Object && Value->Type != EJson::Array;',
    '\t\treturn (bWritten && (bScalar ? !Out.IsEmpty() : bClosed)) || Failed(TEXT("CopyRaw"), Key);',
    '\t}',
    '',
    '\t/** FixUp on the struct held at Json[Key]. */',
    '\ttemplate <typename T>',
    '\tbool FixUpOne(const FJsonObject& Json, const TCHAR* Key, T& Out)',
    '\t{',
    '\t\tconst TSharedPtr<FJsonObject>* Object = nullptr;',
    '\t\tif (!Json.TryGetObjectField(Key, Object)) return true;',
    '\t\tconst int32 Before = LastFailure().Count;',
    '\t\treturn FixUp(**Object, Out) || Within(Before, Key);',
    '\t}',
    '',
    '\t/** FixUp on each struct of the array at Json[Key]; the converter filled Out in the same order. */',
    '\ttemplate <typename T>',
    '\tbool FixUpArray(const FJsonObject& Json, const TCHAR* Key, TArray<T>& Out)',
    '\t{',
    '\t\tconst TArray<TSharedPtr<FJsonValue>>* Items = nullptr;',
    '\t\tif (!Json.TryGetArrayField(Key, Items)) return true;',
    '\t\tif (Items->Num() != Out.Num()) return Failed(TEXT("FixUpArray (length)"), Key);',
    '\t\tfor (int32 I = 0; I < Items->Num(); ++I)',
    '\t\t{',
    '\t\t\tconst TSharedPtr<FJsonObject>* Object = nullptr;',
    '\t\t\tconst FString Item = FString::Printf(TEXT("%s[%d]"), Key, I);',
    '\t\t\tif (!(*Items)[I]->TryGetObject(Object)) return Failed(TEXT("FixUpArray (not an object)"), Item);',
    '\t\t\tconst int32 Before = LastFailure().Count;',
    '\t\t\tif (!FixUp(**Object, Out[I])) return Within(Before, Item);',
    '\t\t}',
    '\t\treturn true;',
    '\t}',
    '',
    '\t/** FixUp on each struct of the object at Json[Key], by key. */',
    '\ttemplate <typename T>',
    '\tbool FixUpMap(const FJsonObject& Json, const TCHAR* Key, TMap<FString, T>& Out)',
    '\t{',
    '\t\tconst TSharedPtr<FJsonObject>* Object = nullptr;',
    '\t\tif (!Json.TryGetObjectField(Key, Object)) return true;',
    '\t\tfor (TPair<FString, T>& Entry : Out)',
    '\t\t{',
    '\t\t\tconst TSharedPtr<FJsonObject>* Value = nullptr;',
    '\t\t\tconst FString Item = FString(Key) + TEXT(".") + Entry.Key;',
    '\t\t\tif (!(*Object)->TryGetObjectField(Entry.Key, Value)) return Failed(TEXT("FixUpMap (not an object)"), Item);',
    '\t\t\tconst int32 Before = LastFailure().Count;',
    '\t\t\tif (!FixUp(**Value, Entry.Value)) return Within(Before, Item);',
    '\t\t}',
    '\t\treturn true;',
    '\t}',
    '');
  for (const n of order) {
    const st = m.structs.get(n), body = [];
    for (const c of carry(st)) {
      const key = `TEXT("${c.p.key}")`;
      if (c.how === 'renamed') body.push(`\t\tbOk &= CopyKey(Json, ${key}, GET_MEMBER_NAME_CHECKED(${ueName(n)}, ${c.field}), Out);`);
      if (c.how === 'raw') body.push(`\t\tbOk &= CopyRaw(Json, ${key}, Out.${c.field});`);
      if (c.how === 'raw') continue;
      const h = holds(c.p.node);
      if (h && work.has(h.name)) body.push(`\t\tbOk &= FixUp${{ one: 'One', array: 'Array', map: 'Map' }[h.as]}(Json, ${key}, Out.${c.field});`);
    }
    out.push(`\tinline bool FixUp(const FJsonObject& Json, ${ueName(n)}& Out)`, '\t{');
    if (body.length) out.push('\t\tbool bOk = true;', ...body, '\t\treturn bOk;');
    else out.push('\t\t(void)Json; (void)Out;', '\t\treturn true; // nothing carried');
    out.push('\t}', '');
  }
  out.push('\t/** The one way BpLink reads a document: FJsonObjectConverter for the mapped fields, then FixUp for the carried ones. On false, LastFailure() says where. */',
    '\ttemplate <typename T>',
    '\tbool FromJson(const TSharedRef<FJsonObject>& Json, T& Out)',
    '\t{',
    '\t\tLastFailure() = FFromJsonFailure();',
    '\t\tif (!FJsonObjectConverter::JsonObjectToUStruct(Json, &Out, 0, 0)) return Failed(TEXT("JsonObjectToUStruct"), FString());',
    '\t\treturn FixUp(*Json, Out);',
    '\t}',
    '}', '');
  return out.join('\n');
}

/**
 * Every schema field must be held: a UPROPERTY named as its key in BpSchema.h, or a `<Key>_` UPROPERTY there that
 * BpSchemaFixups.h copies the key into (CopyKey / CopyRaw inside that struct's FixUp), with each struct that holds
 * a fixed-up struct recursing into it. Reads the two header texts, so a fix-up line deleted by hand is caught.
 */
export function coverage(m, ue, fix) {
  const problems = [], counts = { mapped: 0, renamed: 0, raw: 0 };
  const block = (text, start, end) => { const i = text.indexOf(start); return i < 0 ? null : text.slice(i, text.indexOf(end, i)); };
  const esc = (s) => s.replace(/[$()[\]{}.*+?^|\\]/g, '\\$&');
  const { need, holds } = fixupStructs(m);
  for (const st of m.structs.values()) {
    const decl = block(ue, `struct BPLINK_API ${ueName(st.name)}\n`, '\n};');
    const fn = block(fix, `inline bool FixUp(const FJsonObject& Json, ${ueName(st.name)}& Out)\n\t{`, '\n\t}\n');
    if (!decl) { problems.push(`${ueName(st.name)} is not declared in BpSchema.h`); continue; }
    for (const c of carry(st)) {
      counts[c.how]++;
      const where = `${st.name}.${c.p.key}`;
      if (!new RegExp(`\\n\\t${esc(c.t.t)} ${c.field}( = [^;]+)?;`).test(decl)) { problems.push(`${where}: no UPROPERTY ${c.t.t} ${c.field}`); continue; }
      if (c.how === 'renamed' && !(fn && fn.includes(`CopyKey(Json, TEXT("${c.p.key}"), GET_MEMBER_NAME_CHECKED(${ueName(st.name)}, ${c.field}), Out)`))) problems.push(`${where}: neither mapped nor copied by FixUp`);
      if (c.how === 'raw' && !(fn && fn.includes(`CopyRaw(Json, TEXT("${c.p.key}"), Out.${c.field})`))) problems.push(`${where}: neither mapped nor copied by FixUp`);
      const h = c.how !== 'raw' && holds(c.p.node);
      if (h && need.has(h.name) && !(fn && fn.includes(`(Json, TEXT("${c.p.key}"), Out.${c.field})`))) problems.push(`${where}: FixUp does not recurse into ${ueName(h.name)}`);
    }
  }
  return { problems, counts };
}

// ---------------------------------------------------------------- the UE mapping against real data
// FJsonObjectConverter fails a whole struct when one field's JSON value cannot convert, so every mapped field is
// checked against real documents the way the converter reads it: FString takes a string, number or boolean; int32 and
// double a number; bool a boolean; a struct, FJsonObjectWrapper or TMap an object; TArray an array.
export function conform(m, structName, value, where = structName, out = []) {
  const st = m.structs.get(structName);
  if (!value || typeof value !== 'object' || Array.isArray(value)) { out.push(`${where}: not an object`); return out; }
  for (const c of carry(st)) {
    if (!(c.p.key in value)) continue;
    if (c.how !== 'mapped') { const k = `${structName}.${c.field}`; (out.carried ??= {})[k] = (out.carried[k] ?? 0) + 1; }
    // a raw field takes any JSON; a renamed one goes through JsonValueToUProperty, the converter's own rules
    if (c.how === 'raw') (out.raw ??= []).push({ struct: structName, key: c.p.key, field: c.field, value: value[c.p.key] });
    if (c.how !== 'raw') conformNode(m, c.p.node, c.t.t, value[c.p.key], `${where}.${c.p.key}`, out);
  }
  return out;
}
/**
 * What BpSchema::FixUp leaves in the raw-carried fields of `value`: conform walks the document the way the real
 * corpus is walked, and each raw carry it meets counts only when the fix-up text holds its CopyRaw line. The text is
 * the condensed JSON of the original value (a bare string keeps its quotes), as CopyRaw writes it.
 */
export function rawCarried(m, fix, structName, value) {
  const out = [];
  conform(m, structName, value, structName, out);
  const block = (text, start, end) => { const i = text.indexOf(start); return i < 0 ? '' : text.slice(i, text.indexOf(end, i)); };
  const held = (r) => block(fix, `inline bool FixUp(const FJsonObject& Json, ${ueName(r.struct)}& Out)\n\t{`, '\n\t}\n').includes(`CopyRaw(Json, TEXT("${r.key}"), Out.${r.field})`);
  const carried = {};
  for (const r of (out.raw ?? []).filter(held)) (carried[`${r.struct}.${r.field}`] ??= []).push(JSON.stringify(r.value));
  return { problems: [...out], carried };
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
// JSON.parse names no file, so a malformed schema used to report only "Expected ':' ... at position 9" under
// "<anonymous_script>" - with six schemas, and three of them read by nothing but this generator, that is a guess.
export const readSchemas = () => Object.fromEntries(ROOTS.map(([f]) => {
  const at = path.join(SCHEMA_DIR, f);
  try { return [f, JSON.parse(fs.readFileSync(at, 'utf8'))]; }
  catch (e) { throw new Error(`packages/schema/schema/${f} is not readable as JSON: ${e.message}`, { cause: e }); }
}));
export const generate = (schemas) => { const m = model(schemas); return { ts: emitTs(m), ue: emitUe(m), fix: emitFixups(m), vocab: emitVocab(m), m }; };
/** [path, fresh text] per output, in the order they are written and checked. */
export const outputsOf = (fresh) => [[OUT_TS, fresh.ts], [OUT_UE, fresh.ue], [OUT_FIX, fresh.fix], [OUT_VOCAB, fresh.vocab]];
const norm = (s) => s.replace(/\r\n/g, '\n');

// The committed-vs-fresh comparison, one function: the --check path and its control both call it, so the control
// cannot drift from what it guards. `line` is the 1-based first differing line.
const staleVerdict = (have, text) => {
  if (have === text) return { stale: false };
  const a = have.split('\n'), b = text.split('\n'); let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return { stale: true, line: i + 1, committed: (a[i] ?? '').trim(), fresh: (b[i] ?? '').trim() };
};
// The stale loop takes what it reads as a parameter, so the self-proof below can hand it a stale committed text: a
// loop that compared the fresh text with itself printed 'is current' for all three files and every control stayed
// green (mutation A1 in plan.md, 2026-10-22), because the controls called staleVerdict, never this loop.
// Exported for scripts/check-schema-vocab.mjs, which hands it schema-vocab.ts missing.
export const staleReport = (outputs, read, counts) => outputs.map(([f, text]) => {
  const have = read(f), rel = path.relative(path.join(HERE, '../..'), f).split(path.sep).join('/');
  const v = have === null ? null : staleVerdict(have, text);
  if (v && !v.stale) return { ok: true, line: `ok    ${rel} is current (${counts})` };
  if (have === null) return { ok: false, line: `FAIL  ${rel} is missing: run npm run schema:generate` };
  return { ok: false, line: `FAIL  ${rel} is stale: run npm run schema:generate (first difference at line ${v.line}: committed "${v.committed}", fresh "${v.fresh}")` };
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const schemas = readSchemas();
  const fresh = generate(schemas);
  const counts = `${fresh.m.structs.size} structs from ${ROOTS.length} schemas`;
  const outputs = outputsOf(fresh);
  if (process.argv.includes('--check')) {
    let failed = 0;
    // ROOTS is hand-written; the directory is the ground truth. A schema file added to schema/ and not listed there
    // is generated into nothing and validated by nobody, and every other check still reads green - so the list is
    // reconciled with the directory rather than trusted.
    const onDisk = fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).sort();
    const listed = ROOTS.map(([f]) => f).sort();
    const unlisted = onDisk.filter((f) => !listed.includes(f)), absent = listed.filter((f) => !onDisk.includes(f));
    console.log(`${unlisted.length || absent.length ? 'FAIL' : 'ok  '}  every schema in packages/schema/schema is a generator root (${onDisk.length} files, ${listed.length} roots)${unlisted.length ? ': not in ROOTS: ' + unlisted.join(', ') : ''}${absent.length ? ': in ROOTS, not on disk: ' + absent.join(', ') : ''}`);
    if (unlisted.length || absent.length) failed++;
    // The README's decision: generated/ts/app-structure.ts is a parity artifact nothing imports. The package's
    // exports map must not offer it (or anything under generated/), or the import the decision forbids typechecks.
    const exportsOffering = (pkgText) => {
      const ex = JSON.parse(pkgText).exports ?? {};
      return Object.entries(ex).flatMap(([k, v]) => [k, ...(typeof v === 'string' ? [v] : Object.values(v ?? {}))]).filter((x) => typeof x === 'string' && /(^|\/)generated(\/|$)/.test(x));
    };
    const pkgRaw = fs.readFileSync(path.join(HERE, 'package.json'), 'utf8');
    const offered = exportsOffering(pkgRaw);
    console.log(`${offered.length ? 'FAIL' : 'ok  '}  @bp/schema's exports map offers nothing under generated/ (the generated TS is a parity artifact)${offered.length ? ': ' + offered.join(', ') : ''}`);
    if (offered.length) failed++;
    const reoffered = exportsOffering(pkgRaw.replace('"exports": {', '"exports": {\n    "./generated/ts": "./generated/ts/app-structure.ts",'));
    console.log(`${reoffered.length ? 'ok  ' : 'FAIL'}  control: an exports entry pointing into generated/ is reported`);
    if (!reoffered.length) failed++;
    // Every schema is a valid 2020-12 schema under ajv's strict mode, with its $refs resolving. scripts/validate-
    // structure.mjs compiles three of the six (app-structure-3, app-structure-event-3, lens-manifest-1) because it
    // validates documents against them; plan-1, structure-envelope-1 and scan-wire-1 had no ajv anywhere, so a
    // misspelled keyword or a $ref to a $def that does not exist in them was only ever read by this generator,
    // which ignores what it does not understand.
    const ajvProblems = [];
    {
      const Ajv2020Module = await import('ajv/dist/2020.js');
      const Ajv2020 = Ajv2020Module.default?.default ?? Ajv2020Module.default ?? Ajv2020Module;
      // strictRequired off for the same reason the validator turns it off: if/then branches require keys declared one level up
      const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
      for (const [f] of ROOTS) try { ajv.addSchema(schemas[f], f); } catch (e) { ajvProblems.push(`${f}: ${e.message}`); }
      for (const [f] of ROOTS) if (!ajvProblems.some((p) => p.startsWith(`${f}:`))) try { if (!ajv.getSchema(f)) ajvProblems.push(`${f}: ajv did not compile it`); } catch (e) { ajvProblems.push(`${f}: ${e.message}`); }
    }
    console.log(`${ajvProblems.length ? 'FAIL' : 'ok  '}  all ${ROOTS.length} schemas compile under ajv strict mode, every $ref resolving${ajvProblems.length ? ': ' + ajvProblems.slice(0, 4).join('; ') : ''}`);
    if (ajvProblems.length) failed++;
    const read = (f) => (fs.existsSync(f) ? norm(fs.readFileSync(f, 'utf8')) : null);
    for (const r of staleReport(outputs, read, counts)) { console.log(r.line); if (!r.ok) failed++; }
    // self-proof: handed a BpSchemaFixups.h that differs at one line and a missing BpSchema.h and schema-vocab.ts, the
    // same loop reports the first stale at that line and the other two missing, and the TS file (handed its fresh text) current
    {
      const fixLines = fresh.fix.split('\n'), at = fixLines.findIndex((l) => l.includes('CopyRaw(Json, TEXT("glyph")'));
      const handed = (f) => (f === OUT_FIX ? fixLines.map((l, i) => (i === at ? l + ' zzStaleProbe' : l)).join('\n') : f === OUT_UE || f === OUT_VOCAB ? null : fresh.ts);
      const got = staleReport(outputs, handed, counts).map((r) => r.line);
      const proved = at >= 0 && got.length === 4 && got[0].startsWith('ok  ') && got[1].startsWith('FAIL') && got[1].includes(' is missing')
        && got[2].startsWith('FAIL') && got[2].includes(` is stale: run npm run schema:generate (first difference at line ${at + 1}:`)
        && got[3] === 'FAIL  packages/core/src/standard/schema-vocab.ts is missing: run npm run schema:generate';
      console.log(`${proved ? 'ok  ' : 'FAIL'}  self-proof: the stale loop reads what it is handed (BpSchemaFixups.h differing at line ${at + 1} is stale there, BpSchema.h and schema-vocab.ts absent are missing, the TS current)${proved ? '' : ': got ' + got.map((l) => l.slice(0, 120)).join(' / ')}`);
      if (!proved) failed++;
    }
    // every schema field is held by the committed headers: mapped under its key, or a <Key>_ field FixUp fills
    const cov = coverage(fresh.m, read(OUT_UE) ?? '', read(OUT_FIX) ?? '');
    const { mapped, renamed, raw } = cov.counts;
    console.log(`${cov.problems.length ? 'FAIL' : 'ok  '}  every schema field is held in UE: ${mapped} mapped, ${renamed} renamed and ${raw} raw carried by FixUp${cov.problems.length ? ': ' + cov.problems.slice(0, 8).join('; ') : ''}`);
    if (cov.problems.length) failed++;
    // control: one field's fix-up deleted from a fresh header must fail the coverage
    const holed = fresh.fix.replace(/\n\t\tbOk &= CopyKey\(Json, TEXT\("short"\), GET_MEMBER_NAME_CHECKED\(FBpRule, Short_\), Out\);/, '');
    const holeCaught = holed !== fresh.fix && coverage(fresh.m, fresh.ue, holed).problems.some((p) => p === 'Rule.short: neither mapped nor copied by FixUp');
    console.log(`${holeCaught ? 'ok  ' : 'FAIL'}  control: deleting Rule.short's fix-up fails the coverage`);
    if (!holeCaught) failed++;
    // The control above deletes a renamed carry's CopyKey and nothing else, so it stayed green with the raw arm, the
    // UPROPERTY scope and the recursion arm of coverage() each gutted (mutations B1 to B3 in plan.md, 2026-10-22). One
    // self-proof per arm, each a single edit to the fresh headers that must come back as exactly its own problem:
    const covProbes = [
      // B1: the raw arm. Each CopyRaw removed must be reported under its own field.
      ['a CopyRaw removed (cross_refs)', fresh.ue, fresh.fix.replace('\n\t\tbOk &= CopyRaw(Json, TEXT("cross_refs"), Out.CrossRefs_);', ''), 'Context.cross_refs: neither mapped nor copied by FixUp'],
      ['a CopyRaw removed (glyph)', fresh.ue, fresh.fix.replace('\n\t\tbOk &= CopyRaw(Json, TEXT("glyph"), Out.Glyph_);', ''), 'Presentation.glyph: neither mapped nor copied by FixUp'],
      // B2: the UPROPERTY is looked for in its own struct. FBpLensManifest declares `FString Short_;` too, so a
      // search of the whole header would find it and pass FBpRule's missing field.
      ['FBpRule.Short_ removed while FBpLensManifest.Short_ stays', (() => {
        const s = fresh.ue.indexOf('struct BPLINK_API FBpRule\n'), i = fresh.ue.indexOf('\n\tFString Short_;', s);
        return s < 0 || i < 0 ? fresh.ue : fresh.ue.slice(0, i) + fresh.ue.slice(i + '\n\tFString Short_;'.length);
      })(), fresh.fix, 'Rule.short: no UPROPERTY FString Short_'],
      // B3: the recursion arm. FBpHealth holds FBpRule, whose Short_ needs FixUp, so its FixUpArray is required.
      ['FBpHealth\'s recursion into rules removed', fresh.ue, fresh.fix.replace('\n\t\tbOk &= FixUpArray(Json, TEXT("rules"), Out.rules);', ''), 'Health.rules: FixUp does not recurse into FBpRule'],
    ];
    for (const [what, ue, fix, want] of covProbes) {
      const edited = ue !== fresh.ue || fix !== fresh.fix, got = coverage(fresh.m, ue, fix).problems;
      const proved = edited && got.length === 1 && got[0] === want;
      console.log(`${proved ? 'ok  ' : 'FAIL'}  self-proof: coverage reports ${what} as "${want}"${proved ? '' : `: ${edited ? `got ${got.length ? got.join('; ') : 'no problem'}` : 'the edit matched nothing in the fresh header'}`}`);
      if (!proved) failed++;
    }
    // TS parity: the hand-written types the code uses name the generated fields, with the same optionality
    const ROOT = path.join(HERE, '../..');
    const { compare, wireSource } = await import('./parity.mjs');
    const wireTs = wireSource(ROOT);
    const handTs = norm(fs.readFileSync(path.join(ROOT, HAND_TS), 'utf8'));
    const parity = compare(fresh.ts, handTs, wireTs);
    // Allowed divergences: none. (plan-projection.ts now types a tile's health as Health, so the plan's two enum
    // fields agree.) An entry listed here that stops being a divergence fails below, so the list cannot outlive its fix.
    const KNOWN = [];
    const unexpected = parity.problems.filter((p) => !KNOWN.includes(p));
    console.log(`${unexpected.length ? 'FAIL' : 'ok  '}  ${HAND_TS} agrees with the generated types on every field, its optionality and its string enum, and packages/core/src/scan/ on the scan wire types and the plan (${parity.shapes} shapes and ${parity.enums} enum fields from the structure, event, lens manifest, snapshot, job, proposal, wave and plan; ${KNOWN.length} known divergences allowed)${unexpected.length ? ': ' + unexpected.slice(0, 8).join('; ') : ''}`);
    if (unexpected.length) failed++;
    const stale = KNOWN.filter((p) => !parity.problems.includes(p));
    console.log(`${stale.length ? 'FAIL' : 'ok  '}  every allowed divergence is still one (plan-projection.ts types a tile's health as string)${stale.length ? ': fixed, now delete from KNOWN: ' + stale.join('; ') : ''}`);
    if (stale.length) failed++;
    // the enum comparison has a floor: a walk that stopped finding enum fields would report agreement on nothing
    const enumFloor = parity.enums >= 40;
    console.log(`${enumFloor ? 'ok  ' : 'FAIL'}  the parity walk still reaches the schema's enum fields (${parity.enums} >= 40)`);
    if (!enumFloor) failed++;
    // control: Rule.reason made optional on the generated side must fail the parity
    const loose = fresh.ts.replace(/(\nexport interface Rule \{\n(?:  .*\n)*?)  reason: string;/, '$1  reason?: string;');
    const looseCaught = loose !== fresh.ts && compare(loose, handTs).problems.some((p) => p.endsWith('rules.reason: optional in the schema, required in types.ts'));
    console.log(`${looseCaught ? 'ok  ' : 'FAIL'}  control: Rule.reason made optional in the generated types fails the parity`);
    if (!looseCaught) failed++;
    // controls on the scan wire: Proposal.title made optional, and ScanJob.exit_code dropped, on the generated side
    const wireLoose = fresh.ts.replace(/(\nexport interface Proposal \{\n(?:  .*\n)*?)  title: string;/, '$1  title?: string;');
    const wireLooseCaught = wireLoose !== fresh.ts && compare(wireLoose, handTs, wireTs).problems.some((p) => p === 'ScanSnapshot.proposals.title: optional in the schema, required in types.ts');
    console.log(`${wireLooseCaught ? 'ok  ' : 'FAIL'}  control: Proposal.title made optional in the generated types fails the parity`);
    if (!wireLooseCaught) failed++;
    const wireDrop = fresh.ts.replace(/(\nexport interface ScanJob \{\n(?:  .*\n)*?)(?:  [/][*][*].*[*][/]\n)?  exit_code\?: number;\n/, '$1');
    const wireDropCaught = wireDrop !== fresh.ts && compare(wireDrop, handTs, wireTs).problems.some((p) => p === 'ScanJob.exit_code: in types.ts, not in the schema');
    console.log(`${wireDropCaught ? 'ok  ' : 'FAIL'}  control: ScanJob.exit_code dropped from the generated types fails the parity`);
    if (!wireDropCaught) failed++;
    // controls on the enum comparison: a value dropped from one of the schema's vocabularies, and one added to it.
    // `xhigh` is waveEffort's, hand-written a second time as WAVE_EFFORTS in packages/core/src/scan/waves.ts.
    const enumShort = fresh.ts.replaceAll(`'low' | 'medium' | 'high' | 'xhigh'`, `'low' | 'medium' | 'high'`);
    const enumShortCaught = enumShort !== fresh.ts && compare(enumShort, handTs, wireTs).problems.some((p) => p === 'Wave.packages.effort: the enum disagrees - in types.ts, not in the schema: xhigh');
    console.log(`${enumShortCaught ? 'ok  ' : 'FAIL'}  control: waveEffort losing "xhigh" in the generated types fails the parity`);
    if (!enumShortCaught) failed++;
    const enumWide = fresh.ts.replaceAll(`'draft' | 'dispatched'`, `'draft' | 'dispatched' | 'zzParityProbe'`);
    const enumWideCaught = enumWide !== fresh.ts && compare(enumWide, handTs, wireTs).problems.some((p) => p === 'Wave.status: the enum disagrees - in the schema, not in types.ts: zzParityProbe');
    console.log(`${enumWideCaught ? 'ok  ' : 'FAIL'}  control: a value added to the wave status enum fails the parity`);
    if (!enumWideCaught) failed++;
    // The controls above loosen a field or drop one from the generated side, so they stayed green with three parts of
    // compare() gutted (mutations C2 to C4 in plan.md, 2026-10-22): a field only the schema names, a field the schema
    // requires and types.ts makes optional, and a root pair (Plan) never walked. The roots are named HERE, not read from
    // parity.mjs's PAIRS, so a pair dropped there cannot also drop its probe. One field per root, added on the generated
    // side, must come back as "in the schema, not in types.ts" under that root (a root reached only nested, like
    // Proposal under ScanSnapshot.proposals, counts: the property is that every root's fields are compared).
    const PARITY_ROOTS = ['AppStructure', 'AppStructureEvent', 'LensManifest', 'ScanSnapshot', 'ScanJob', 'Proposal', 'Wave', 'Plan'];
    const extraGen = PARITY_ROOTS.reduce((t, g) => t.replace(`\nexport interface ${g} {\n`, `\nexport interface ${g} {\n  zzPairProbe_${g}: string;\n`), fresh.ts);
    const extraGot = compare(extraGen, handTs, wireTs).problems;
    const unreached = PARITY_ROOTS.filter((g) => !extraGot.some((p) => p.endsWith(`.zzPairProbe_${g}: in the schema, not in types.ts`)));
    console.log(`${unreached.length ? 'FAIL' : 'ok  '}  self-proof: a field added to each of the ${PARITY_ROOTS.length} generated roots is reported as in the schema, not in types.ts${unreached.length ? ': not reported for ' + unreached.join(', ') : ''}`);
    if (unreached.length) failed++;
    const strict = fresh.ts.replace(/(\nexport interface ScanJob \{\n(?:  .*\n)*?)  exit_code\?: number;/, '$1  exit_code: number;');
    const strictGot = strict !== fresh.ts ? compare(strict, handTs, wireTs).problems : [];
    const strictCaught = strictGot.length === 1 && strictGot[0] === 'ScanJob.exit_code: required in the schema, optional in types.ts';
    console.log(`${strictCaught ? 'ok  ' : 'FAIL'}  self-proof: ScanJob.exit_code made required in the generated types (optional in jobs.ts) fails the parity${strictCaught ? '' : `: got ${strictGot.length ? strictGot.join('; ') : 'no problem'}`}`);
    if (!strictCaught) failed++;
    // scan-wire-1's wave bounds (waveName.maxLength, wave.packages.maxItems), proposalId.pattern and lens-manifest-1's
    // builtinLensId and root keys are no longer compared with copies read out of source text: waves.ts, jobs.ts and
    // manifest-check.ts import them from schema-vocab.ts, the fourth output above, whose staleness this check owns.
    // scripts/check-schema-vocab.mjs asserts the identity and refuses a literal copy of a schema enum in packages/core.
    // The stand-in smoke (ue-standin/check.cpp) reads every root through BpSchema::FromJson. No gate here can run a
    // C++ compiler, so what is asserted is its COVERAGE: a root added to ROOTS whose FromJson nobody instantiates
    // is a FixUp body no compiler ever sees. Comments are stripped first, so the clang command line in its header -
    // and any prose naming a root - cannot satisfy the match (a file that TALKS about the rule must not pass).
    const smokeRel = 'packages/schema/ue-standin/check.cpp';
    const smokeText = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const smokeMisses = (text) => {
      const body = smokeText(text);
      const vars = new Map([...body.matchAll(/FBp(\w+)&\s+(\w+)/g)].map((m) => [m[1], m[2]]));
      return [...ROOTS.map(([, name]) => name), ...ROOTS.flatMap(([, , reads = []]) => reads)].filter((name) => {
        const v = vars.get(name);
        return !v || !body.includes(`FromJson(Json, ${v})`);
      });
    };
    const smokeRaw = fs.readFileSync(path.join(ROOT, smokeRel), 'utf8');
    const missed = smokeMisses(smokeRaw);
    console.log(`${missed.length ? 'FAIL' : 'ok  '}  ${smokeRel} instantiates FromJson for all ${ROOTS.length} roots and the ${fresh.m.readable.length} structs read on their own${missed.length ? ': not read: ' + missed.map(ueName).join(', ') : ''}`);
    if (missed.length) failed++;
    // control: a root dropped from the smoke is reported, and a root named only in a comment does not count
    const dropped = smokeMisses(smokeRaw.replace(/&& BpSchema::FromJson\(Json, Wire\)/, ''));
    const commented = smokeMisses(`// FromJson(Json, Wire) with FBpScanWire& Wire\n${smokeRaw.replace(/&& BpSchema::FromJson\(Json, Wire\)/, '')}`);
    const smokeControl = dropped.join() === 'ScanWire' && commented.join() === 'ScanWire';
    console.log(`${smokeControl ? 'ok  ' : 'FAIL'}  control: a root dropped from the smoke is reported, and one named only in a comment is not read`);
    if (!smokeControl) failed++;
    // lens-manifest-1's builtinLensId enum against standard/catalog.ts, which loads the built-in manifests as seven
    // JSON imports, one per docs/standard/lenses/<id>.json (those are the manifests, not a copy of the list, so they
    // stay imports and are compared here). scan/manifest-check.ts's BUILTIN_IDS is the generated BUILTIN_LENS_IDS.
    // The matcher that finds nothing fails here: an empty set must never read as agreement (that is how a gate
    // reports a clean tree in the voice of success).
    const lensIds = (text, re) => { const out = new Set(); for (const m of text.matchAll(re)) out.add(m[1]); return out; };
    const CATALOG_RE = /docs\/standard\/lenses\/([a-z0-9-]+)\.json/g;
    const wantIds = new Set(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'lens-manifest-1.schema.json'), 'utf8')).$defs.builtinLensId.enum);
    const copies = [['packages/core/src/standard/catalog.ts', lensIds(fs.readFileSync(path.join(ROOT, 'packages/core/src/standard/catalog.ts'), 'utf8'), CATALOG_RE)]];
    const idProblems = [];
    for (const [rel, have] of copies) {
      if (!have.size) { idProblems.push(`${rel}: the matcher found no built-in lens ids - it no longer reads this file`); continue; }
      const missing = [...wantIds].filter((v) => !have.has(v)), extra = [...have].filter((v) => !wantIds.has(v));
      if (missing.length) idProblems.push(`${rel}: in the schema's builtinLensId, not here: ${missing.join(', ')}`);
      if (extra.length) idProblems.push(`${rel}: here, not in the schema's builtinLensId: ${extra.join(', ')}`);
    }
    console.log(`${idProblems.length ? 'FAIL' : 'ok  '}  lens-manifest-1's builtinLensId enum (${wantIds.size} ids) is the set of built-in manifests standard/catalog.ts imports${idProblems.length ? ': ' + idProblems.join('; ') : ''}`);
    if (idProblems.length) failed++;
    // control: an id dropped from the catalog's text must be reported, and a text with no lens import reads as empty
    const holedCatalog = lensIds(`import x from '../../../../docs/standard/lenses/business.json';`, CATALOG_RE);
    const idControl = [...wantIds].filter((v) => !holedCatalog.has(v)).length === wantIds.size - 1 && lensIds('import x from "./other.json";', CATALOG_RE).size === 0;
    console.log(`${idControl ? 'ok  ' : 'FAIL'}  control: a built-in id missing from the catalog is reported, and a text with no lens import reads as empty, not as agreement`);
    if (!idControl) failed++;
    // The mapping against real documents: Kettle's map and events, the built-in lens manifests, and every fixture
    // the validator accepts. The fixture list is DERIVED, not named: the two fixtures the hand-written list used to
    // name were valid-map.json and valid-steps-lens.json, which silently left valid-applies-when.json and
    // warn-validator-gaps.json (both exit 0 under scripts/validate-structure.mjs, both maps) out of the UE mapping,
    // and left valid-map.events.jsonl out of the event mapping. The root each document belongs to is derived too,
    // from its `$schema` against the `const` the schemas declare for that key - no hand-written mapping either.
    const byDollarSchema = new Map(ROOTS.map(([f, name]) => [schemas[f].properties?.$schema?.const, name]).filter(([c]) => c));
    const FIXTURES = 'packages/schema/schema/fixtures';
    const accepted = (f) => f.startsWith('valid-') || f.startsWith('warn-'); // the validator exits 0 on these (spec 12)
    const fixtureFiles = fs.readdirSync(path.join(ROOT, FIXTURES)).filter(accepted).sort();
    const docProblems = [];
    const docs = [['AppStructure', 'packages/core/data/kettle.app-structure.json'],
      ...fixtureFiles.filter((f) => f.endsWith('.json')).map((f) => {
        const rel = `${FIXTURES}/${f}`, declared = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')).$schema;
        const name = byDollarSchema.get(declared);
        if (!name) docProblems.push(`${rel}: $schema ${JSON.stringify(declared)} matches no root's $schema const`);
        return name ? [name, rel] : null;
      }).filter(Boolean),
      ...fs.readdirSync(path.join(ROOT, 'docs/standard/lenses')).filter((f) => f.endsWith('.json')).map((f) => ['LensManifest', 'docs/standard/lenses/' + f]),
      ...fs.readdirSync(path.join(ROOT, 'docs/standard/lenses-custom')).filter((f) => f.endsWith('.json')).map((f) => ['LensManifest', 'docs/standard/lenses-custom/' + f])];
    const problems = docProblems;
    for (const [name, rel] of docs) conform(fresh.m, name, JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')), rel, problems);
    const eventFiles = ['packages/core/data/kettle.events.jsonl', ...fixtureFiles.filter((f) => f.endsWith('.events.jsonl')).map((f) => `${FIXTURES}/${f}`)];
    const events = eventFiles.flatMap((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).filter(Boolean).map((l, i) => [rel, i + 1, l]));
    for (const [rel, line, l] of events) conform(fresh.m, 'AppStructureEvent', JSON.parse(l), `${rel}:${line}`, problems);
    const carried = Object.entries(problems.carried ?? {}).map(([f, n]) => `${f} ${n}`).join(', ');
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  the UE mapping reads ${docs.length} documents and ${events.length} events as FJsonObjectConverter + FixUp would (FixUp carries ${carried || 'nothing'})${problems.length ? ': ' + problems.slice(0, 8).join('; ') : ''}`);
    if (problems.length) failed++;
    // the derivation has a floor: every accepted fixture is in one of the two lists, so a readdir that stopped
    // matching (a renamed directory, a changed prefix) fails rather than reading a shorter list in silence
    const wantJson = fixtureFiles.filter((f) => f.endsWith('.json')).length, wantEvents = fixtureFiles.filter((f) => f.endsWith('.events.jsonl')).length;
    const haveJson = docs.filter(([, rel]) => rel.startsWith(FIXTURES) && rel.endsWith('.json')).length;
    const covered = wantJson >= 4 && wantEvents >= 2 && haveJson === wantJson && eventFiles.length === wantEvents + 1;
    console.log(`${covered ? 'ok  ' : 'FAIL'}  every fixture the validator accepts is in the mapping (${haveJson} of ${wantJson} documents, ${wantEvents} event logs)`);
    if (!covered) failed++;
    const bad = conform(fresh.m, 'AppStructure', { version: '3', features: [{ slug: 'x', parts: [{ done: 'yes' }] }], facets: { x: [1] } });
    const conformCaught = bad.length === 3;
    console.log(`${conformCaught ? 'ok  ' : 'FAIL'}  control: a string version, a string bool and an array facet are refused (${bad.length} of 3)`);
    if (!conformCaught) failed++;
    // The raw carries (cross_refs, glyph) reach FixUp as condensed JSON text. The corpus above has no cross_refs and
    // no document with both forms of glyph, so one in-memory set goes through the SAME conform: an app structure whose
    // context carries cross_refs (an object item and a string item), and two lens manifests, glyph a string and an object.
    const rawDocs = [['AppStructure', { contexts: [{ cross_refs: [{ to: 'x', kind: 'uses' }, 'y'] }] }],
      ['LensManifest', { presentation: { glyph: 'pulse' } }], ['LensManifest', { presentation: { glyph: { path: 'M2 3h12v10H2z' } } }]];
    const rawWant = { 'Context.CrossRefs_': ['[{"to":"x","kind":"uses"},"y"]'], 'Presentation.Glyph_': ['"pulse"', '{"path":"M2 3h12v10H2z"}'] };
    const rawRun = (fix, docs = rawDocs) => {
      const got = { problems: [], carried: {} };
      for (const [name, doc] of docs) {
        const r = rawCarried(fresh.m, fix, name, doc);
        got.problems.push(...r.problems);
        for (const [k, t] of Object.entries(r.carried)) (got.carried[k] ??= []).push(...t);
      }
      return got;
    };
    const rawSame = (got) => got.problems.length === 0 && JSON.stringify(got.carried) === JSON.stringify(rawWant);
    const rawRead = rawRun(fresh.fix);
    console.log(`${rawSame(rawRead) ? 'ok  ' : 'FAIL'}  the UE mapping carries cross_refs and both forms of glyph as FixUp would (${Object.entries(rawRead.carried).map(([f, t]) => `${f} ${t.join(' | ')}`).join('; ') || 'nothing'}${rawRead.problems.length ? '; ' + rawRead.problems.join('; ') : ''})`);
    if (!rawSame(rawRead)) failed++;
    // control: with either copy removed from the fix-up text, or the raw key dropped from the document, the same read-through differs
    const noCopy = rawRun(fresh.fix.replace('CopyRaw(Json, TEXT("cross_refs"), Out.CrossRefs_)', 'true'));
    const noGlyph = rawRun(fresh.fix.replace('CopyRaw(Json, TEXT("glyph"), Out.Glyph_)', 'true'));
    const noKey = rawRun(fresh.fix, [['AppStructure', { contexts: [{}] }], ...rawDocs.slice(1)]);
    const rawControl = !rawSame(noCopy) && !rawSame(noGlyph) && !rawSame(noKey);
    console.log(`${rawControl ? 'ok  ' : 'FAIL'}  control: with the cross_refs copy or the glyph copy removed from FixUp, or cross_refs dropped from the document, the raw read-through fails (3 of 3)`);
    if (!rawControl) failed++;
    // control: a field added to a schema must change every output (so a stale file cannot pass)
    const seeded = structuredClone(schemas);
    seeded['app-structure-3.schema.json'].$defs.feature.properties.zzParityProbe = { type: 'integer' };
    const red = generate(seeded);
    const caught = red.ts !== fresh.ts && red.ue !== fresh.ue && red.ue.includes('int32 zzParityProbe') && red.ts.includes('zzParityProbe?: number');
    console.log(`${caught ? 'ok  ' : 'FAIL'}  control: a field added to feature changes both outputs`);
    if (!caught) failed++;
    // control: a committed file that differs from the fresh generation - one line mutated, one line deleted - is
    // reported stale by the same staleVerdict the loop above calls, at the line the edit was made
    for (const [f, text] of outputs) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/'), lines = text.split('\n');
      const at = lines.findIndex((l, i) => i >= lines.length >> 1 && /[A-Za-z]/.test(l) && l !== lines[i + 1] && i + 1 < lines.length); // a meaningful line from the body, not repeated by the next
      const mutated = lines.map((l, i) => (i === at ? l + ' zzStaleProbe' : l)).join('\n');
      const deleted = lines.filter((_, i) => i !== at).join('\n');
      // the tail cut after line `at` (the committed file a prefix of the fresh one, as when a struct is appended):
      // a verdict that only looked for a differing line among the committed lines read this as current (mutation A2)
      const truncated = lines.slice(0, at).join('\n');
      for (const [what, committed] of [['one line mutated', mutated], ['one line deleted', deleted], ['its tail cut from line ' + (at + 1), truncated]]) {
        const v = at >= 0 ? staleVerdict(committed, text) : { stale: false };
        const ok = v.stale && v.line === at + 1;
        console.log(`${ok ? 'ok  ' : 'FAIL'}  control: ${rel} with ${what} is reported stale at line ${at + 1}${ok ? '' : ` (got ${v.stale ? 'line ' + v.line : 'current'})`}`);
        if (!ok) failed++;
      }
    }
    process.exit(failed ? 1 : 0);
  }
  const write = () => {
    if (process.argv.includes('--dry-run')) { console.log(`dry run: wrote nothing (${counts})`); return; }
    for (const [f, text] of outputs) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
    console.log(`wrote ${outputs.map(([f]) => path.relative(process.cwd(), f)).join(', ')} (${counts})`);
  };
  // --since <ref>: what this edit does to each channel, against the schemas as of a git ref (compat.mjs), printed
  // before the write. compat.mjs imports this module, so it is loaded once this body has finished evaluating (an
  // awaited import here would wait on itself).
  const sinceAt = process.argv.indexOf('--since');
  if (sinceAt < 0) write();
  else {
    const ref = process.argv[sinceAt + 1];
    if (!ref || ref.startsWith('-')) { console.error('--since needs a git ref, e.g. --since HEAD or --since origin/master'); process.exit(2); }
    const before = Object.fromEntries(ROOTS.map(([f]) => {
      const r = spawnSync('git', ['show', `${ref}:packages/schema/schema/${f}`], { cwd: path.join(HERE, '../..'), encoding: 'utf8' });
      // a schema new since the ref is compared with an empty root, so every struct it brings reads as added (additive)
      if (r.status !== 0 && /does not exist in|exists on disk, but not in/.test(r.stderr || '')) return [f, { type: 'object', properties: {} }];
      if (r.status !== 0) throw new Error(`packages/schema/schema/${f} is not readable at ${ref}: ${(r.stderr || '').trim()}`);
      try { return [f, JSON.parse(r.stdout)]; } catch (e) { throw new Error(`packages/schema/schema/${f} at ${ref} is not readable as JSON: ${e.message}`, { cause: e }); }
    }));
    import('./compat.mjs').then(({ diff, report }) => {
      for (const l of report(diff(model(before), fresh.m), { since: ref })) console.log(l);
      write();
    });
  }
}
