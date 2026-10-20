# packages/schema: app-structure v3 for every channel

- `schema/`: the JSON Schemas (draft 2020-12), normative for structure: `app-structure-3`,
  `app-structure-event-3` and `lens-manifest-1`, with their fixtures. The spec is
  `docs/standard/app-structure-v3.md`; `scripts/validate-structure.mjs` validates against these files.
- `generate.mjs`: one model of the schemas, two outputs.
  - `generated/ts/app-structure.ts`: TypeScript interfaces. `packages/core/src/standard/types.ts`
    stays the hand-written types the code uses; these are generated alongside them.
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


```sh
npm run schema:generate   # rewrite both generated files after a schema change
npm run check:schema      # fails while a generated file is stale, or when a schema field is neither a UPROPERTY
                          # named as its key nor copied by FixUp; also reads Kettle's map, its events and every
                          # lens manifest the way FromJson would, so a held field never fails a parse
```

The two headers have only been checked with `clang++ -fsyntax-only` against the stand-in Unreal
declarations in `ue-standin/` (the command is at the top of `ue-standin/check.cpp`). That proves they
parse. It does not prove UHT accepts them or that Unreal compiles them. Unreal is installed in phase P0,
and WP3.1 builds them inside `apps/vr`.
