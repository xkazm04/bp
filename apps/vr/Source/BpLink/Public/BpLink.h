// BpLink: the VR client's read of the product from apps/server. Not compiled against Unreal yet (apps/vr/WP3.1.md).
// Correction 2026-10-22 (Lynx): it has compiled, in a bpEditor build outside the repo (docs/concepts/vr-light-table/machine.md).
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
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

/** What the scan side of apps/server says about the product, polled (spark vr-fidelity-40 FC1): GET .../scans (the job
 *  list), GET .../scan (the store's tables: runs, proposals, activity...) and GET .../waves. Each part keeps its last good
 *  read; bHas* says whether it has ever been read. */
struct BPLINK_API FBpScanState
{
	TArray<FBpScanJob> Jobs;
	FBpScanSnapshot Scan;
	TArray<FBpWave> Waves;
	bool bHasJobs = false;
	bool bHasScan = false;
	bool bHasWaves = false;
	/** Each triaged proposal's severity tier by its id (store v4 `tier`: 0 stop-ship, 1 before production, 2 soon after, 3
	 *  backlog), read from the raw /scan answer: the generated FBpProposal::tier reads an absent tier (untriaged) as 0, so
	 *  a proposal missing here is untriaged, whatever its tier field says. */
	TMap<FString, int32> Tiers;
	/** Bumped on every read that changed something, so a consumer can skip a state it has seen. */
	int32 Serial = 0;
};

/** Fired on the game thread when a poll brought back something new. */
DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpScanState, const FBpScanState&);

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
	/** A feature's kind (structure.features[].kind: user_flow, capability, integration, ops) by its slug, which is the
	 *  plan tile's id; null when the last structure that parsed has no such feature or names no kind. */
	const FString* FindFeatureKind(const FString& Slug) const { return FeatureKinds.Find(Slug); }

	FOnBpPlan& OnPlan() { return PlanDelegate; }
	FOnBpPlanFailed& OnPlanFailed() { return PlanFailedDelegate; }

	/** BpLink's own fetch calls this with each finished read (bOk as FBpLinkClient::FetchProduct hands it). */
	void ReceiveSnapshot(bool bOk, const FBpLinkSnapshot& Snapshot);

	/** The scan side as last polled; OnScanState fires when a poll changed it. The poll runs every ScanPollBusyS while a
	 *  job is queued or running, else every ScanPollIdleS. */
	const FBpScanState& GetScanState() const { return ScanState; }
	FOnBpScanState& OnScanState() { return ScanStateDelegate; }
	static constexpr float ScanPollBusyS = 0.5f;
	static constexpr float ScanPollIdleS = 4.f;

	/** Whether the product read is Kettle, whose scans and waves apps/server simulates. Any other product is live: its
	 *  scans and dispatches would run real agents on a real repo, so the table only shows what they left (FAD). */
	bool IsKettle() const { return GetProductSlug() == TEXT("kettle"); }

	/** POST .../scans { lens, scope }: the web's way to start a lens scan (blueprint-ui.md, "POST /api/products/<slug>/scans").
	 *  OnDone gets the HTTP status (202 when queued) and the body. Refused for a live product (IsKettle): nothing is sent,
	 *  the refusal is logged and OnDone gets status 0. */
	void PostScan(const FString& Lens, const FString& Kind, const FString& Id, const FString& Label, const TArray<FString>& Features,
		TFunction<void(int32 Status, const FString& Body)> OnDone);

private:
	void PollScan();
	bool TickScanPoll(float DeltaSeconds);
	void ReceiveScanPart(int32 Part, TSharedPtr<struct FBpScanWire> Wire, TMap<FString, int32> Tiers);

	FBpScanState ScanState;
	FOnBpScanState ScanStateDelegate;
	FTSTicker::FDelegateHandle ScanTicker;
	double NextScanPollS = 0.0;
	/** Requests of the current poll still out; a new poll waits for them. */
	int32 ScanPartsOut = 0;
	/** The bodies last read, so an unchanged answer is not parsed again. */
	uint32 ScanBodyHash[3] = { 0, 0, 0 };

	FBpPlan Plan;
	bool bHasPlan = false;
	EBpPlanState PlanState = EBpPlanState::Pending;
	FString ProductName;
	TMap<FString, FString> FeatureKinds;
	FOnBpPlan PlanDelegate;
	FOnBpPlanFailed PlanFailedDelegate;
};
