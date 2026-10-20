// Parses both generated headers against the stand-ins and instantiates FromJson for every root:
//   clang++ -std=c++20 -fsyntax-only -Wall -Wextra -Ipackages/schema/ue-standin -Ipackages/schema/generated/ue packages/schema/ue-standin/check.cpp
#include "BpSchemaFixups.h"

bool ReadAll(const TSharedRef<FJsonObject>& Json, FBpAppStructure& Map, FBpAppStructureEvent& Event, FBpLensManifest& Lens)
{
	return BpSchema::FromJson(Json, Map) && BpSchema::FromJson(Json, Event) && BpSchema::FromJson(Json, Lens);
}
