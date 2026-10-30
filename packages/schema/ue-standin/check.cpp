// Parses both generated headers against the stand-ins and instantiates FromJson for every root, and for every struct a
// client reads on its own (generate.mjs ROOTS' third element: the shared focus's place, view, shared place and POST answer;
// the morning's deck, agent deck and steering row):
//   clang++ -std=c++20 -fsyntax-only -Wall -Wextra -Ipackages/schema/ue-standin -Ipackages/schema/generated/ue packages/schema/ue-standin/check.cpp
// "every root" is checked by `npm run check:schema`, which fails when a root in generate.mjs's ROOTS is not read
// below; until 2026-10-21 this file read three of the six, so FBpPlan, FBpStructureEnvelope and FBpScanWire - and
// the FixUp bodies generated for them - were never put through a compiler at all.
#include "BpSchemaFixups.h"

bool ReadAll(const TSharedRef<FJsonObject>& Json, FBpAppStructure& Map, FBpAppStructureEvent& Event, FBpLensManifest& Lens,
	FBpPlan& Plan, FBpStructureEnvelope& Envelope, FBpScanWire& Wire, FBpDecisionBrief& Brief)
{
	return BpSchema::FromJson(Json, Map) && BpSchema::FromJson(Json, Event) && BpSchema::FromJson(Json, Lens)
		&& BpSchema::FromJson(Json, Plan) && BpSchema::FromJson(Json, Envelope) && BpSchema::FromJson(Json, Wire)
		&& BpSchema::FromJson(Json, Brief);
}

bool ReadFocus(const TSharedRef<FJsonObject>& Json, FBpSharedFocus& Focus, FBpFocusPlace& Place, FBpSharedView& View,
	FBpSharedPlace& Shared, FBpFocusAnswer& Answer)
{
	return BpSchema::FromJson(Json, Focus) && BpSchema::FromJson(Json, Place) && BpSchema::FromJson(Json, View)
		&& BpSchema::FromJson(Json, Shared) && BpSchema::FromJson(Json, Answer);
}

bool ReadMorning(const TSharedRef<FJsonObject>& Json, FBpMorningWatch& Watch, FBpMorningDeck& Deck, FBpAgentDeck& Agent,
	FBpSteerRow& Row)
{
	return BpSchema::FromJson(Json, Watch) && BpSchema::FromJson(Json, Deck) && BpSchema::FromJson(Json, Agent)
		&& BpSchema::FromJson(Json, Row);
}
