# packages/schema: app-structure v3 for every channel

- `schema/`: the JSON Schemas (draft 2020-12), normative for structure: `app-structure-3`,
  `app-structure-event-3` and `lens-manifest-1`, with their fixtures. The spec is
  `docs/standard/app-structure-v3.md`; `scripts/validate-structure.mjs` validates against these files.
- `generate.mjs`: one model of the schemas, two outputs.
  - `generated/ts/app-structure.ts`: TypeScript interfaces. `packages/core/src/standard/types.ts`
    stays the hand-written types the code uses; these are generated alongside them.
  - `generated/ue/BpSchema.h`: Unreal `USTRUCT`s for the VR client's `BpLink` module, field names as
    the JSON keys so `FJsonObjectConverter::JsonObjectToUStruct` fills them. Enums are `FString`;
    polymorphic parts (conditions, scan blocks) are `FJsonObjectWrapper`; the few fields a USTRUCT
    cannot hold (`short`, `default`, `$schema`, the string-or-object glyph, `taxonomy`) are listed per
    struct as "not mapped" and are read from the raw JSON.

```sh
npm run schema:generate   # rewrite both generated files after a schema change
npm run check:schema      # fails while either is stale; also reads Kettle's map, its events and every lens
                          # manifest the way FJsonObjectConverter would, so a mapped field never fails a parse
```

The header has been checked with clang against stand-in Unreal macros, not compiled by UHT: Unreal is
installed in phase P0, and WP3.1 builds it inside `apps/vr`.
