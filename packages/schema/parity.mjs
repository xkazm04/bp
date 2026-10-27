// Parity between the generated TypeScript (generated/ts/app-structure.ts, from the schemas) and the hand-written
// types the code uses (packages/core/src/standard/types.ts). The hand-written file stays the source the code
// imports; this compare keeps it honest: for the structure, event and lens-manifest shapes, and every object type
// they hold, both sides must name the same fields with the same optionality. Field types are not compared (the
// generated side types polymorphic parts loosely on purpose) WITH ONE EXCEPTION: where the schema declares a
// string `enum` (or a string `const`), the generated side is a union of string literals, and the hand-written side
// must be a union of the same literals - no member missing, none extra. Those unions are the schema's vocabularies
// (`proposalStatus`, `waveModel`, `waveEffort`, every `stage`/`status`/`kind`), each of which the code hand-writes
// a second time; before 2026-10-21 nothing compared the two copies and `check:waves` derived its accepted pairs
// from the implementation's own list, so a value added or dropped on one side only read green everywhere.
// An index signature (`[key: string]: unknown`) is not a field.
//
// A hand-written union of object types (Rollup, KpiScope, LensField) reads as one shape: a field is present when
// any member names it, and required only when every member requires it. That is what the schema says too: its
// variants are optional properties of one object.
//
// The scan wire types (snapshot, delta, job, proposal, wave and what they hold) live in packages/core/src/scan/, and
// the plan (Plan, PlanWing, PlanRoom, PlanBay, PlanTile, PlanBox) in packages/core/src/server/plan-projection.ts.
// Both are read from there, not copied: wireSource() re-exports them into the compare. Plan was unpaired until
// 2026-10-21, so the six shapes plan-1.schema.json generates - into these types AND into the VR client's USTRUCTs -
// were never compared with the hand-written projection the plan route actually answers.
//
// Used by `generate.mjs --check` (`npm run check:schema`); compare() takes source texts, so a seeded disagreement
// can be checked without touching a file.
import ts from 'typescript';

/** The pairs compared: [generated interface, hand-written type]. */
export const PAIRS = [['AppStructure', 'AppStructure'], ['AppStructureEvent', 'StructureEvent'], ['LensManifest', 'LensManifest']];
/** The pairs read out of packages/core/src (see wireSource): ScanDelta is the snapshot's type under another name. */
export const WIRE_PAIRS = [['ScanSnapshot', 'ScanSnapshot'], ['ScanSnapshot', 'ScanDelta'], ['ScanJob', 'ScanJob'], ['Proposal', 'Proposal'], ['Wave', 'Wave'], ['Plan', 'Plan']];

/** A module that re-exports the hand-written scan wire types from their files; `root` is the repo root. */
export function wireSource(root) {
  const at = (f) => `${root.replace(/\\/g, '/')}/packages/core/src/scan/${f}`;
  return [`export type { ScanSnapshot, ScanDelta, Proposal } from '${at('types.ts')}';`,
    `export type { ScanJob } from '${at('jobs.ts')}';`, `export type { Wave } from '${at('waves.ts')}';`,
    `export type { Plan } from '${root.replace(/\\/g, '/')}/packages/core/src/server/plan-projection.ts';`, ''].join('\n');
}

/**
 * Compare `gen` (the generated file's text) with `hand` (types.ts's text), and with `wire` (wireSource's text, when
 * given) for the scan wire types. Returns { problems: string[], shapes, enums } where shapes counts the object
 * shapes compared and enums the string-enum fields whose literal members were compared.
 */
export function compare(gen, hand, wire = null) {
  const files = { '/gen.ts': gen, '/hand.ts': hand, ...(wire ? { '/wire.ts': wire } : {}) };
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, lib: ['lib.es2022.d.ts'], types: [] };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host; // the lib files come from TypeScript itself
  host.getSourceFile = (name, lang, ...rest) => (name in files ? ts.createSourceFile(name, files[name], lang, true) : getSourceFile(name, lang, ...rest));
  host.fileExists = (name) => name in files || fileExists(name);
  host.readFile = (name) => (name in files ? files[name] : readFile(name));
  const program = ts.createProgram(Object.keys(files), options, host);
  const checker = program.getTypeChecker();
  const exported = (file, name) => {
    const sym = checker.getSymbolAtLocation(program.getSourceFile(file)).exports.get(name);
    if (!sym) throw new Error(`${file === '/gen.ts' ? 'generated' : 'types.ts'}: no export ${name}`);
    return checker.getDeclaredTypeOfSymbol(sym);
  };

  // a shape is a list of object types (a union's members, flattened); its fields: Map<name, required>
  const objectsOf = (types) => types.flatMap((t) => (t.isUnion() ? t.types : [t]))
    .filter((m) => m.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection) && !checker.isArrayType(m));
  const fieldsOf = (members) => {
    const fields = new Map();
    for (const m of members) for (const p of checker.getPropertiesOfType(m)) fields.set(p.name, true);
    for (const name of fields.keys()) fields.set(name, members.every((m) => { const p = m.getProperty(name); return p && !(p.flags & ts.SymbolFlags.Optional); }));
    return fields;
  };
  // what a field holds, as the shape to compare next: an array's element, a Record's value, the type itself
  const inner = (t) => {
    t = checker.getNonNullableType(t);
    if (checker.isArrayType(t)) return inner(checker.getTypeArguments(t)[0]);
    const members = objectsOf([t]);
    if (members.length === 1 && !checker.getPropertiesOfType(members[0]).length) {
      const index = checker.getIndexInfoOfType(members[0], ts.IndexKind.String);
      if (index) return inner(index.type);
    }
    return t;
  };
  // a field's types across the members that name it
  const fieldTypes = (members, name) => members.map((m) => m.getProperty(name)).filter(Boolean).map((p) => inner(checker.getTypeOfSymbol(p)));

  // the string-literal members of a field's type, or null when it is not a union of string literals (so `string`,
  // a number literal, a struct or a Record all read as null: nothing to compare). `undefined` is dropped first, so
  // an optional field compares its values, not its optionality - that is the check above.
  const literals = (types) => {
    const out = new Set();
    for (const t of types) for (const part of (t.isUnion() ? t.types : [t])) {
      if (part.flags & ts.TypeFlags.Undefined) continue;
      if (!part.isStringLiteral()) return null;
      out.add(part.value);
    }
    return out.size ? out : null;
  };

  const problems = [], seen = new Set();
  let shapes = 0, enums = 0;
  const walk = (gTypes, hTypes, where) => {
    const g = objectsOf(gTypes), h = objectsOf(hTypes);
    const key = [...g, '|', ...h].map((t) => (typeof t === 'string' ? t : checker.typeToString(t))).join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    const gs = fieldsOf(g), hs = fieldsOf(h);
    // the generated side types a polymorphic part as Record<string, unknown> (no fields): nothing to compare
    if (!gs.size) return;
    if (!h.length) { problems.push(`${where}: an object in the schema, no object type in types.ts`); return; }
    shapes++;
    for (const [name, req] of gs) {
      if (!hs.has(name)) { problems.push(`${where}.${name}: in the schema, not in types.ts`); continue; }
      if (hs.get(name) !== req) problems.push(`${where}.${name}: ${req ? 'required' : 'optional'} in the schema, ${hs.get(name) ? 'required' : 'optional'} in types.ts`);
    }
    for (const name of hs.keys()) if (!gs.has(name)) problems.push(`${where}.${name}: in types.ts, not in the schema`);
    for (const name of gs.keys()) {
      if (!hs.has(name)) continue;
      const gt = fieldTypes(g, name), ht = fieldTypes(h, name), gl = literals(gt);
      if (gl) {
        enums++;
        const hl = literals(ht);
        const show = (s) => [...s].join(' | ');
        if (!hl) problems.push(`${where}.${name}: an enum in the schema (${show(gl)}), ${ht.map((t) => checker.typeToString(t)).join(' / ')} in types.ts`);
        else {
          const missing = [...gl].filter((v) => !hl.has(v)), extra = [...hl].filter((v) => !gl.has(v));
          if (missing.length || extra.length) problems.push(`${where}.${name}: the enum disagrees - ${[missing.length ? `in the schema, not in types.ts: ${missing.join(', ')}` : '', extra.length ? `in types.ts, not in the schema: ${extra.join(', ')}` : ''].filter(Boolean).join('; ')}`);
        }
      }
      walk(gt, ht, `${where}.${name}`);
    }
  };
  for (const [g, h] of PAIRS) walk([exported('/gen.ts', g)], [exported('/hand.ts', h)], h);
  if (wire) for (const [g, h] of WIRE_PAIRS) walk([exported('/gen.ts', g)], [exported('/wire.ts', h)], h);
  return { problems, shapes, enums };
}
