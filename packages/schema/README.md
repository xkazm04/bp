# packages/schema: app-structure v3 for every channel

- `schema/`: the JSON Schemas (draft 2020-12), normative for structure: `app-structure-3`,
  `app-structure-event-3`, `lens-manifest-1`, `plan-1`, `structure-envelope-1` (`{ structure, events, rev }`) and
  `scan-wire-1` (the six SSE payloads `snapshot | delta | map | ping | error | jobs`, plus `waves`: ScanSnapshot, ScanJob,
  Proposal, Wave and what they hold), with their fixtures. The spec is
  `docs/standard/app-structure-v3.md`; `scripts/validate-structure.mjs` validates against these files.
- `generate.mjs`: one model of the schemas, four outputs.
  - `generated/ts/app-structure.ts`: TypeScript interfaces, a parity artifact (see the decision below).
  - `generated/ue/BpSchema.h`: Unreal `USTRUCT`s for the VR client's `BpLink` module, field names as
    the JSON keys so `FJsonObjectConverter::JsonObjectToUStruct` fills them. Enums are `FString`;
    polymorphic parts (conditions, scan blocks) and objects of containers (`taxonomy`) are `FJsonObjectWrapper`.
  - `generated/ue/BpSchemaFixups.h`: `BpSchema::FixUp` per struct and `BpSchema::FromJson`, which runs the
    converter and then `FixUp`. BpLink reads every document through `FromJson`. A field whose key or value
    cannot be a UPROPERTY named as its key is a `<Key>_` UPROPERTY (the converter never fills it), and
    `FixUp` copies the raw key into it after the converter has run:

    | field | why | carried as |
    |---|---|---|
    | `short` (lens, rule), `default` (health) | a C++ keyword | `Short_`, `Default_`: the mapped type, via `JsonValueToUProperty` |
    | `$schema` (map, lens) | not an identifier | `Schema_` (`FString`), via `JsonValueToUProperty` |
    | `glyph` (presentation) | a string or an object | `Glyph_`: the value as condensed JSON text (`"bars"` keeps its quotes) |
    | `cross_refs` (context) | untyped array items | `CrossRefs_`: the value as condensed JSON text |
  - `packages/core/src/standard/schema-vocab.ts`: the vocabularies as `as const` consts - every named string enum,
    the scope kinds, the lens manifest's root keys, the wave bounds (`maxLength`, `maxItems`) and `proposalId`'s
    pattern as a `RegExp`. Pure and import-free. Unlike the TS types, core imports it (see the amendment below).


```sh
npm run schema:generate   # rewrite all four generated files after a schema change
npm run check:schema      # fails while a generated file is stale, when a schema field is neither a UPROPERTY named
                          # as its key nor copied by FixUp, or when types.ts and the generated types disagree on a
                          # field, its optionality or its string enum; also:
                          #   every *.schema.json in schema/ is one of generate.mjs's ROOTS, and every root is on disk
                          #   the package's exports map offers nothing under generated/ (the decision below)
                          #   all six schemas compile under ajv strict mode (three of them have no other ajv anywhere)
                          #   ue-standin/check.cpp instantiates FromJson for all six roots
                          #   lens-manifest-1's builtinLensId enum is the set of manifests catalog.ts imports
                          #   Kettle's map, its events, the fixtures and every lens manifest read the way FromJson
                          #     would, so a held field never fails a parse
                          # Every one of those has a seeded control beside it, so a matcher that stopped biting
                          # fails rather than reporting a clean tree. The three main rules (stale, coverage,
                          # parity) also carry `self-proof:` lines, added 2026-10-22 after 8 of 11 checker
                          # mutations survived every control (the table is in docs/concepts/vr-light-table/plan.md,
                          # 'check:schema's controls mutation-tested').
```

### Decision (2026-10-20): hand-written TS types, generated TS as a parity artifact

`packages/core/src/standard/types.ts` stays the source the code imports. `generated/ts/app-structure.ts`
is a parity artifact: nothing imports it (`grep -r "@bp/schema"` outside this package and
`package-lock.json` returns nothing). It exists so `check:schema` (`parity.mjs`) can compare the two.
The structure, event and lens-manifest shapes, the scan wire shapes read from `packages/core/src/scan/`,
the plan shapes read from `packages/core/src/server/plan-projection.ts`, and every object type any of them
holds (49 shapes today), must name the same fields with the same optionality on both sides. When they
disagree, the check fails. Field types are not compared, with one exception: where the schema declares a
string `enum` or `const`, both sides must be a union of exactly the same string literals (48 such fields
today), because those vocabularies - `proposalStatus`, `waveModel`, `waveEffort`, every `stage`, `status`
and `kind` - are hand-written a second time in the code. Two divergences are allowed by name
(`Plan.tiles.health` and `.general`, typed `string` in `plan-projection.ts`), and a second assertion fails
when an allowed divergence has been fixed, so the list cannot outlive it.
Why the hand-written file stays the source: the schema cannot express what the
code relies on. That includes the condition grammar as a recursive union, discriminated unions
(`Rollup`, `LensField`, `KpiScope`, `LensScan`), the `never` bounds on non-numeric fields and the open
`StructureEventType`. The generator types all of these loosely. Generating them would mean either a
much richer generator or code that loses those types. Parity on presence and optionality catches what
actually drifts (a field added, removed, or made required on one side only). On the day this was set
up, the two agreed on every shape.

The two headers have only been checked with `clang++ -fsyntax-only` against the stand-in Unreal
declarations in `ue-standin/` (the command is at the top of `ue-standin/check.cpp`). That proves they
parse. It does not prove UHT accepts them or that Unreal compiles them. No gate runs that command - what
`check:schema` asserts is the smoke's COVERAGE, that `check.cpp` instantiates `FromJson` for all six
roots; it read three of them until 2026-10-21, so `FBpPlan`, `FBpStructureEnvelope` and `FBpScanWire`
have never been through a C++ front end at all. Unreal is installed in phase P0,
and WP3.1 builds them inside `apps/vr`.

### Amendment (2026-10-24): the vocabularies are imported, not copied

The types stay as decided above. The VALUES are different: the allow-lists core refuses by (`WAVE_MODELS`,
`WAVE_EFFORTS`, `MAX_NAME`, `MAX_PACKAGES` in `scan/waves.ts`, `SAFE_ID` in `scan/jobs.ts`, `BUILTIN_IDS` and `TOP`
in `scan/manifest-check.ts`, the scope kinds in `model/scan-sim.ts` and the scans route) were a second hand-typed
copy that `check:schema` regex-scraped out of source text to compare back, and the untyped ones were seen by
neither the typecheck nor the parity. They now import `schema-vocab.ts`, so a value added to a schema reaches every
refusal path in one `npm run schema:generate` (one authority per vocabulary). `check:schema-vocab` asserts the
identity and refuses any array or Set literal in `packages/core/src` whose members are a schema string enum; two
known copies (`standard/types.ts` `FEATURE_BOUND_FIELDS`, `standard/present.ts` `NUMERIC`, three hits) are allowed by
name until they import the generated value.
