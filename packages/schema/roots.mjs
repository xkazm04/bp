// The one table of packages/schema's roots: one row per schema file in ./schema. Every per-root fact lives here once,
// and the rest derive from it:
//   generate.mjs     ROOTS (file, generated root name, the structs a client reads on their own) - what it generates
//   parity.mjs       the pairs it compares and wireSource()'s re-exports, from each row's `pairs`
//   check:schema     the per-root self-proof (a field probed into every paired generated name) and pairingProblems()
//   schemaAjv()      the one ajv 2020 instance every validator uses
// A row's root and each of its `reads` is a struct a client reads; each must be the `gen` of a pair in the row (the
// generated interface and the hand-written type the code uses, `hand: { file, name }`, file repo-relative), or the
// row must say why the root has none (`unpaired: '<reason>'`, the root only). Before this table the same facts were
// typed in four lists (ROOTS, PAIRS/WIRE_PAIRS, wireSource, PARITY_ROOTS) and five ajv constructions; the ten
// bp-Personas contract pairs reached WIRE_PAIRS but not the self-proof, so deleting them read green (52 shapes, not 90).
// Pairs are walked in table order, hand pairs in types.ts first (parity.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(HERE, 'schema');

/** The hand-written types the code uses for the structure, its events and the lens manifest; parity.mjs compares. */
export const HAND_TS = 'packages/core/src/standard/types.ts';
const SCAN = 'packages/core/src/scan/', FOCUS = 'packages/core/src/session/focus.ts', MORNING = 'packages/core/src/companion/morning.ts';

export const ROOTS = [
  { file: 'app-structure-3.schema.json', root: 'AppStructure', pairs: [
    { gen: 'AppStructure', hand: { file: HAND_TS, name: 'AppStructure' } },
  ] },
  { file: 'app-structure-event-3.schema.json', root: 'AppStructureEvent', pairs: [
    { gen: 'AppStructureEvent', hand: { file: HAND_TS, name: 'StructureEvent' } },
  ] },
  { file: 'lens-manifest-1.schema.json', root: 'LensManifest', pairs: [
    { gen: 'LensManifest', hand: { file: HAND_TS, name: 'LensManifest' } },
  ] },
  { file: 'plan-1.schema.json', root: 'Plan', pairs: [
    { gen: 'Plan', hand: { file: 'packages/core/src/server/plan-projection.ts', name: 'Plan' } },
  ] },
  { file: 'structure-envelope-1.schema.json', root: 'StructureEnvelope', pairs: [],
    unpaired: 'the /structure body is { structure, events, rev }: its parts are AppStructure and AppStructureEvent, paired above' },
  { file: 'scan-wire-1.schema.json', root: 'ScanWire', pairs: [
    // ScanDelta is the snapshot's type under another name
    { gen: 'ScanSnapshot', hand: { file: `${SCAN}types.ts`, name: 'ScanSnapshot' } },
    { gen: 'ScanSnapshot', hand: { file: `${SCAN}types.ts`, name: 'ScanDelta' } },
    { gen: 'ScanJob', hand: { file: `${SCAN}jobs.ts`, name: 'ScanJob' } },
    { gen: 'Proposal', hand: { file: `${SCAN}types.ts`, name: 'Proposal' } },
    { gen: 'Wave', hand: { file: `${SCAN}waves.ts`, name: 'Wave' } },
  ], unpaired: 'a holder of one property per stream frame name, no payload of its own: each frame struct is paired' },
  { file: 'decision-brief-1.schema.json', root: 'DecisionBrief', pairs: [
    { gen: 'DecisionBrief', hand: { file: `${SCAN}brief.ts`, name: 'Brief' } },
  ] },
  // `reads` names the structs under a root that a client also reads ON THEIR OWN (each its own payload on the wire):
  // FromJson works for them as for a root, and ue-standin/check.cpp must instantiate it for each.
  { file: 'shared-focus-1.schema.json', root: 'SharedFocus', reads: ['FocusPlace', 'SharedView', 'SharedPlace', 'FocusAnswer'], pairs: [
    { gen: 'FocusPlace', hand: { file: FOCUS, name: 'FocusPlace' } },
    { gen: 'SharedView', hand: { file: FOCUS, name: 'SharedView' } },
    { gen: 'SharedPlace', hand: { file: FOCUS, name: 'SharedPlace' } },
    { gen: 'FocusPost', hand: { file: FOCUS, name: 'FocusPost' } },
    { gen: 'FocusAnswer', hand: { file: FOCUS, name: 'FocusAnswer' } },
  ], unpaired: 'a holder of the shared-focus $defs, never a payload: the structs a client reads are paired' },
  { file: 'morning-deck-1.schema.json', root: 'MorningWatch', reads: ['MorningDeck', 'AgentDeck', 'SteerRow'], pairs: [
    { gen: 'MorningDeck', hand: { file: MORNING, name: 'MorningDeck' } },
    { gen: 'AgentDeck', hand: { file: MORNING, name: 'AgentDeck' } },
    { gen: 'SteerRow', hand: { file: MORNING, name: 'SteerRow' } },
    { gen: 'SteerPost', hand: { file: MORNING, name: 'SteerPost' } },
  ], unpaired: 'a holder of the Morning Watch $defs, never a payload: the structs a client reads are paired' },
];

/** Every row's root and reads that has neither a pair in its row nor (the root only) an unpaired reason. */
export function pairingProblems(table = ROOTS) {
  const problems = [];
  for (const row of table) {
    const paired = new Set((row.pairs ?? []).map((p) => p.gen));
    for (const name of [row.root, ...(row.reads ?? [])]) {
      const reason = name === row.root && typeof row.unpaired === 'string' && row.unpaired.trim();
      if (!paired.has(name) && !reason) problems.push(`${name}: a struct a client reads with no hand-written pair and no unpaired reason (${row.file})`);
    }
  }
  return problems;
}

/** ajv's options, the same for every consumer: strict, except strictRequired (if/then branches require keys declared
 * one level up); allowUnionTypes for the `type: [...]` scalars. */
export const AJV_OPTIONS = Object.freeze({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const Ajv2020 = Ajv2020Module.default?.default ?? Ajv2020Module.default ?? Ajv2020Module;
const readSchema = (f) => JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8'));

let shared = null;
/**
 * The one ajv 2020 instance with every table schema registered once, reachable by file name
 * (`getSchema('plan-1.schema.json#/$defs/tile')`) and by $id, so cross-file $refs resolve. With no argument it is
 * built once and shared, and a schema that does not register throws. `{ schemas, problems }` builds a fresh one from
 * the given texts (file -> parsed schema) and pushes `<file>: <why>` into `problems` instead of throwing
 * (check:schema reports every schema at once).
 */
export function schemaAjv({ schemas = null, problems = null } = {}) {
  if (!schemas && !problems && shared) return shared;
  const ajv = new Ajv2020({ ...AJV_OPTIONS });
  for (const { file } of ROOTS) {
    try { ajv.addSchema(schemas ? schemas[file] : readSchema(file), file); } catch (e) { if (!problems) throw e; problems.push(`${file}: ${e.message}`); }
  }
  if (!schemas && !problems) shared = ajv;
  return ajv;
}
