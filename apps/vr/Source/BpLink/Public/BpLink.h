// BpLink: the VR client's read of the product from apps/server. Not compiled against Unreal yet (apps/vr/WP3.1.md).
// Correction 2026-10-22 (Lynx): it has compiled, in a bpEditor build outside the repo (docs/concepts/vr-light-table/machine.md).
#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"
#include "Schema/BpSchema.h"

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

/** Fired on the game thread each time a fetch brings back a plan that parsed (lynx-plan L3.2). */
DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpPlan, const FBpPlan&);
/** Fired on the game thread when a fetch ends with no plan: the structure or the /plan read failed (its Error is logged). */
DECLARE_MULTICAST_DELEGATE(FOnBpPlanFailed);

/** Where the last fetch stands: Pending until the first one finishes, then Ready (a plan parsed) or Failed (none did). */
enum class EBpPlanState : uint8
{
	Pending,
	Ready,
	Failed,
};

/**
 * The module holds the product BpLink read, so a consumer (the table, ABpTable) never fetches a second time. The startup
 * fetch (and every `BpLink.Fetch`) hands its snapshot here. A listener that subscribes after the plan arrived checks
 * GetPlan() (or GetPlanState()) on subscribe; the delegates fire only for fetches that finish after it subscribed.
 */
class BPLINK_API FBpLinkModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

	/** The loaded module (loads it if a caller runs before its PostEngineInit phase). Game thread. */
	static FBpLinkModule& Get();

	/** The last plan that parsed, or null while none has. A later failed fetch keeps it and sets GetPlanState() Failed. */
	const FBpPlan* GetPlan() const { return bHasPlan ? &Plan : nullptr; }
	EBpPlanState GetPlanState() const { return PlanState; }
	/** The product BpLink reads ("kettle"). */
	FString GetProductSlug() const;
	/** structure.project.name from the last structure that parsed; empty while none has. */
	const FString& GetProductName() const { return ProductName; }

	FOnBpPlan& OnPlan() { return PlanDelegate; }
	FOnBpPlanFailed& OnPlanFailed() { return PlanFailedDelegate; }

	/** BpLink's own fetch calls this with each finished read (bOk as FBpLinkClient::FetchProduct hands it). */
	void ReceiveSnapshot(bool bOk, const FBpLinkSnapshot& Snapshot);

private:
	FBpPlan Plan;
	bool bHasPlan = false;
	EBpPlanState PlanState = EBpPlanState::Pending;
	FString ProductName;
	FOnBpPlan PlanDelegate;
	FOnBpPlanFailed PlanFailedDelegate;
};
