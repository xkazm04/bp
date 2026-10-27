// Parses both generated headers against the stand-ins and instantiates FromJson for every root:
//   clang++ -std=c++20 -fsyntax-only -Wall -Wextra -Ipackages/schema/ue-standin -Ipackages/schema/generated/ue packages/schema/ue-standin/check.cpp
// "every root" is checked by `npm run check:schema`, which fails when a root in generate.mjs's ROOTS is not read
// below; until 2026-10-21 this file read three of the six, so FBpPlan, FBpStructureEnvelope and FBpScanWire - and
// the FixUp bodies generated for them - were never put through a compiler at all.
#include "BpSchemaFixups.h"

bool ReadAll(const TSharedRef<FJsonObject>& Json, FBpAppStructure& Map, FBpAppStructureEvent& Event, FBpLensManifest& Lens,
	FBpPlan& Plan, FBpStructureEnvelope& Envelope, FBpScanWire& Wire)
{
	return BpSchema::FromJson(Json, Map) && BpSchema::FromJson(Json, Event) && BpSchema::FromJson(Json, Lens)
		&& BpSchema::FromJson(Json, Plan) && BpSchema::FromJson(Json, Envelope) && BpSchema::FromJson(Json, Wire);
}
