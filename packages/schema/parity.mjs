// Parity between the generated TypeScript (generated/ts/app-structure.ts, from the schemas) and the hand-written
// types the code uses (packages/core/src/standard/types.ts). The hand-written file stays the source the code
// imports; this compare keeps it honest: for the structure, event and lens-manifest shapes, and every object type
// they hold, both sides must name the same fields with the same optionality. Field types are not compared (the
// generated side types polymorphic parts loosely on purpose); an index signature (`[key: string]: unknown`) is
// not a field.
//
// A hand-written union of object types (Rollup, KpiScope, LensField) reads as one shape: a field is present when
// any member names it, and required only when every member requires it. That is what the schema says too: its
// variants are optional properties of one object.
//
// Used by `generate.mjs --check` (`npm run check:schema`); compare() takes source texts, so a seeded disagreement
// can be checked without touching a file.
import ts from 'typescript';

/** The pairs compared: [generated interface, hand-written type]. */
export const PAIRS = [['AppStructure', 'AppStructure'], ['AppStructureEvent', 'StructureEvent'], ['LensManifest', 'LensManifest']];

/**
 * Compare `gen` (the generated file's text) with `hand` (types.ts's text). Returns { problems: string[], shapes }
 * where shapes counts the object shapes compared.
 */
export function compare(gen, hand) {
  const files = { '/gen.ts': gen, '/hand.ts': hand };
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts'], types: [] };
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

  const problems = [], seen = new Set();
  let shapes = 0;
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
    for (const name of gs.keys()) if (hs.has(name)) walk(fieldTypes(g, name), fieldTypes(h, name), `${where}.${name}`);
  };
  for (const [g, h] of PAIRS) walk([exported('/gen.ts', g)], [exported('/hand.ts', h)], h);
  return { problems, shapes };
}
