// BpLink: the VR client's read of the product from apps/server. Not compiled against Unreal yet (apps/vr/WP3.1.md).
#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"
#include "BpSchema.h"

DECLARE_LOG_CATEGORY_EXTERN(LogBpLink, Log, All);

/** What one read of a product brings back: { structure, events, rev } and, when /plan answered and parsed, its plan. */
struct BPLINK_API FBpLinkSnapshot
{
	FBpAppStructure Structure;
	TArray<FBpAppStructureEvent> Events;
	FString Rev;
	/** GET .../plan: wings, rooms, bays and tiles (the web's levels). Empty unless bHasPlan; a failed read is logged and
	 *  does not fail the fetch. */
	FBpPlan Plan;
	bool bHasPlan = false;
	/** The /stream answer: 200 for Kettle (apps/server hosts its sim, wolf-plan L5.2), 405 for a product with no live
	 *  stream. WP3.1 consumes neither, so Rev was read once from the structure payload.
	 *  -1 = never asked (the default, and what a failed structure read hands back); 0 = asked, no connection or no
	 *  response; anything else is the HTTP status the server answered. */
	int32 StreamStatus = -1;
};

/** The requests the BpLink contract pins (apps/vr/README.md, scripts/check-bplink.mjs), against apps/server. */
class BPLINK_API FBpLinkClient
{
public:
	/** Defaults to http://127.0.0.1:3100; overridden by -BpLinkUrl=, then BP_LINK_URL, or by the argument. */
	explicit FBpLinkClient(const FString& InBaseUrl = FString());

	const FString& GetBaseUrl() const { return BaseUrl; }
	void SetBaseUrl(const FString& InBaseUrl);

	/**
	 * GET /api/products/<Slug>/structure, then GET /api/products/<Slug>/plan (a failure is logged and leaves bHasPlan
	 * false), then GET /api/products/<Slug>/stream (200 or 405; either way the rev stays the one read once from the
	 * structure payload).
	 * OnDone runs on the game thread; bOk is false with an error already logged.
	 */
	void FetchProduct(const FString& Slug, TFunction<void(bool bOk, const FBpLinkSnapshot& Snapshot)> OnDone);

	static FString DefaultBaseUrl();

private:
	FString BaseUrl;
};

class FBpLinkModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;
};
