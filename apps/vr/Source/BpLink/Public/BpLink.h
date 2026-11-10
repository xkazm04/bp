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
	/** Read from the build's bundled snapshot (FBpLinkClient::ReadBundle), not from a server; BundleSavedAt says when the
	 *  server's answers were saved (bundle.json's savedAt, empty when the bundle names none). */
	bool bFromBundle = false;
	FString BundleSavedAt;
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
	/** The product's bundled snapshot (Content/BpData/<Slug>/, apps/vr/tools/bundle-data.mjs): what the headset draws when
	 *  no server answers, or when -BpLinkUrl=bundle asks for it. False, with an Error logged, when the build has none. */
	static bool ReadBundle(const FString& Slug, FBpLinkSnapshot& Snapshot);

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
	/** Each proposal's expected_delta by its id, where the raw /scan answer has one (spark vr-room-layers WP2: the screen
	 *  deck's before -> after figure); the generated double reads an absent one as 0, a move nobody proposed. */
	TMap<FString, double> Deltas;
	/** Each proposal's stored score (scan-score/1) by id, where the raw /scan answer has one, and the ids of the rows written
	 *  under scan-finding/1 (any v5 key on the wire): the generated double and int32 read an absent key as 0, and a row's worth
	 *  (scan/score.ts worthOf) turns on presence. */
	TMap<FString, double> Scores;
	TSet<FString> ScoredV5;
	/** Bumped on every read that changed something, so a consumer can skip a state it has seen. */
	int32 Serial = 0;
};

/** Fired on the game thread when a poll brought back something new. */
DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpScanState, const FBpScanState&);

/** What POST /api/companion/turn ended as (companion-link.md section 2), for the lamp to put in words. */
struct BPLINK_API FBpCompanionTurn
{
	/** Ok: the turn ended `done`; Busy: 409 thread_busy; Failed: the turn ended failed or interrupted; Unreached: no answer. */
	enum class EOutcome : uint8 { Ok, Busy, Failed, Unreached };
	EOutcome Outcome = EOutcome::Unreached;
	/** The reply's text (the `text` deltas, joined). */
	FString Text;
	/** The `failure` class of a failed turn, or the error text of a refused one. */
	FString Failure;
	/** A refused turn's sentence for the person (a 429's `words`, else its `error` when that is a sentence); empty otherwise. */
	FString Words;
	/** A pending card's summary (a GATED tool: answered in the web app only, contract section 4); empty when none. */
	FString CardSummary;
	/** The last `focus` command's target, in plan ids; empty when the turn pointed at nothing. */
	FString FocusKind;
	FString FocusId;
};

/** One focus saved on the PC for reuse (packages/core/src/scan/focus.ts SavedFocus): a lens and what it is to look for. */
struct BPLINK_API FBpSavedFocus
{
	FString Id;
	FString Lens;
	FString Note;
	FString CreatedAt;
};

/** GET .../focuses as last read, for the open product. Unlike the scan side it is not polled: it is read when the wrist's
 *  Scan tab opens (a focus is saved on the PC, so nothing here changes while the owner stands at the table). */
struct BPLINK_API FBpFocusList
{
	TArray<FBpSavedFocus> Focuses;
	bool bHasFocuses = false;
	/** Read from the bundle's sample-focuses.json, not from a server: there is nothing to POST them to, and the table's only
	 *  answer to one is its local sample (ABpTable::StartSampleScan). Which plane a focus came from travels with the list. */
	bool bSample = false;
	/** Why the last read failed, in words; empty after one that answered. */
	FString Error;
	int32 Serial = 0;
};

/** Fired on the game thread when a GetFocuses read answered. */
DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpFocuses, const FBpFocusList&);

/** The shared focus ("one place"): the place the owner is looking at, as another surface published it (GET /api/session/focus,
 *  packages/core/src/session/focus.ts SharedView.shared). Ids only, never a selection. */
struct BPLINK_API FBpFollowPlace
{
	/** The product it was published on (place.product). A demo product is a copy of Kettle's map, so its ids are the plan's. */
	FString Product;
	/** place.target: feature, room, wing or site; empty when the place is the product as a whole. */
	FString Kind;
	FString Id;
	/** place.level (L0..L4) and place.say (one plain line), when the publisher sent them. */
	FString Level;
	FString Say;
	/** Who put it there: the reader's id, its surface (web, phone, morning...) and its label ("Web"). */
	FString Reader;
	FString Surface;
	FString Label;
	/** The record's rev that made it the shared place. */
	int32 Rev = 0;
};

/** Fired on the game thread when the shared focus moved to a place another reader published, while BpLink follows. */
DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpFollow, const FBpFollowPlace&);

/** One product the table can show (spark onboarding-vr WP-V1): Kettle (built in), every product GET /api/products lists,
 *  and its latest onboarding as GET /api/onboarding answers it (the adopt job; `job: null` reads as State "none"). */
struct BPLINK_API FBpProductEntry
{
	FString Slug;
	FString Name;
	/** readiness.map from /api/products: the product has a map the table can draw (Kettle always). */
	bool bHasMap = false;
	/** The adopt job's status: queued, running, done, failed, cancelled; "none" when it was never onboarded through the app. */
	FString State = TEXT("none");
	FString JobId;
	/** The build-up phase the job last started, or failed in (adopt_phase: check ... register); empty when none. */
	FString Phase;
	/** The last count the job's journal gave (a `progress` event read from .../onboarding/feed): N of Of in ProgressPhase;
	 *  Of 0 while none is known. */
	int32 N = 0;
	int32 Of = 0;
	FString ProgressPhase;
	FString Error;
	bool IsBuilding() const { return State == TEXT("running") || State == TEXT("queued"); }
	bool IsStopped() const { return State == TEXT("failed") || State == TEXT("cancelled"); }
};

/** The products and their onboarding as last polled. bHas* says whether that route has answered 200 yet. */
struct BPLINK_API FBpOnboardingState
{
	TArray<FBpProductEntry> Products;
	bool bHasProducts = false;
	bool bHasOnboarding = false;
	/** Bumped on every poll that changed something. */
	int32 Serial = 0;
};

/** A running onboarding's milestones, said once each (the lamp's lines): the plan is drawn (its phase passed
 *  product-tree), it is in bp (done), it stopped (failed or cancelled). */
enum class EBpOnboardingMilestone : uint8
{
	PlanDrawn,
	Done,
	Stopped,
};

DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpOnboarding, const FBpOnboardingState&);
DECLARE_MULTICAST_DELEGATE_ThreeParams(FOnBpMilestone, const FBpProductEntry& /*Entry*/, EBpOnboardingMilestone, const FString& /*Line*/);
/** Fired on the game thread when the table's product changed (SetProduct), after BpLink dropped the old product's state
 *  and before the new product's read is answered. */
DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpProduct, const FString& /*Slug*/);

/** One event of the open product's onboarding feed (spark onboarding-vr WP-V2), as apps/web/src/buildup/contract.ts
 *  BuildupEvent says it, flattened: Type names which fields carry it. Read off the game thread from
 *  GET .../onboarding/feed?layout=islands, so a `structure` event's boxes are the table's islands layout. */
struct BPLINK_API FBpBuildupArea
{
	FString Id;
	FString Name;
	FString Group;
	int32 Files = 0;
	/** -1 until the inventory sends them. */
	int32 Lines = -1;
};
struct BPLINK_API FBpBuildupDomain
{
	FString Id;
	FString Name;
	int32 Order = 0;
	TArray<FString> CapIds;
	TArray<FString> CapNames;
};
struct BPLINK_API FBpBuildupEvent
{
	/** begin, phase, survey, outline, structure, history, health, activity, progress, narration, done, failed. */
	FString Type;
	/** ms since the run started. */
	double At = 0.0;
	/** phase: Phase and State (start, done, failed) and Detail; progress: Phase, N of Of, Detail; narration: Phase, Text,
	 *  Next, Features; failed: Phase and Text (its message); begin: Text (the project's name); activity: Verb, Path, Area. */
	FString Phase;
	FString State;
	FString Detail;
	FString Text;
	FString Next;
	FString Verb;
	FString Path;
	FString Area;
	int32 N = 0;
	int32 Of = 0;
	TArray<FString> Features;
	TArray<FBpBuildupArea> Areas;
	TArray<FBpBuildupDomain> Domains;
	/** structure: the chunk's wings, rooms, bays and tiles (tiles carry no health; rev and lenses empty). */
	FBpPlan Structure;
	/** history: (tile id, created); health: (tile id, general), with bProvisional; structure: (tile id, kind). */
	TArray<TPair<FString, FString>> Tiles;
	bool bProvisional = false;
};
/** One answer of the feed: its events, the job as the answer saw it, and whether it is history being caught up (the first
 *  answer after the table started reading this job: a join mid-run, or a switch back) or news. */
struct BPLINK_API FBpBuildupBatch
{
	FString Slug;
	FString JobId;
	FString JobStatus;
	FString JobPhase;
	TArray<FBpBuildupEvent> Events;
	bool bPast = false;
	/** The job has ended and every event has been read. */
	bool bDone = false;
};
DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpBuildup, const FBpBuildupBatch&);

/** Which way BpLink reaches the PC (table link v2, night two W2a): none (the build's bundled sample), the cable (adb reverse to
 *  loopback :3100, or an explicit loopback -BpLinkUrl), or Wi-Fi (the LAN door learned from GET /lan/where, or an explicit
 *  non-loopback -BpLinkUrl). */
enum class EBpLinkRoute : uint8
{
	None,
	Cable,
	Wifi,
};

/** The pairing ceremony as this headset sees it (table-link-v2.md section 4). */
enum class EBpPairState : uint8
{
	/** No token kept. */
	Unpaired,
	/** GET /lan/where and POST /pair are out. */
	Asking,
	/** A code is shown; POST /pair/claim every 2 s until the owner approves it on the PC. */
	Waiting,
	/** A token is kept and sent as Authorization: Bearer on every request. */
	Paired,
};

/** The link as the console and the wrist show it. Never carries the token: TokenTail is its last 4 characters. */
struct BPLINK_API FBpLinkStatus
{
	EBpLinkRoute Route = EBpLinkRoute::None;
	/** -BpLinkUrl named the server (or `bundle`): the chooser does not look anywhere else. */
	bool bExplicit = false;
	bool bBundleOnly = false;
	/** Whether the first route decision has been made (until then nothing is polled). */
	bool bDecided = false;
	/** Where the requests go now (empty on the bundle), the cable's URL, and the Wi-Fi door learned from the PC. */
	FString BaseUrl;
	FString CableUrl;
	FString WifiUrl;
	/** /api/health's boot id: a new one is a restarted PC, and everything is read again. */
	FString Boot;
	EBpPairState Pair = EBpPairState::Unpaired;
	/** While Waiting: the 6-character code to type on the PC, and when the request lapses (ISO). */
	FString Code;
	FString CodeExpiresAt;
	/** The pairing (from the claim, then GET /pair/me): `<device>:<pairing id>`, its scopes and its end. */
	FString Device;
	TArray<FString> Scopes;
	FString ExpiresAt;
	FString TokenTail;
	/** The last thing worth saying about the link, in words; bMessageBad: a refusal or a lost pairing (red). */
	FString Message;
	bool bMessageBad = false;
	/** Bumped on every change. */
	int32 Serial = 0;
};
DECLARE_MULTICAST_DELEGATE_OneParam(FOnBpLinkStatus, const FBpLinkStatus&);

/** The morning deck as last read (night two W2b): from the PC (GET /api/companion/morning) or the build's sample (morning.json). */
struct BPLINK_API FBpMorningRead
{
	bool bOk = false;
	/** Read from the bundle: a sample, and nothing the person decides on it is sent. */
	bool bSample = false;
	int32 Status = 0;
	/** Why it failed, in words. */
	FString Error;
	FBpMorningDeck Deck;
};

/** One companion card (packages/core/src/companion/contract.ts Card): a GATED tool call waiting for a person. */
struct BPLINK_API FBpCompanionCard
{
	FString Id;
	FString Tool;
	FString Summary;
	FString Product;
	/** pending, approved, declined, expired, done, failed. */
	FString State;
	FString CreatedAt;
};

/** One policy grant (contract.ts PolicyGrant & { grantedBy? }), as the server answered it. MinTier -1: none named. */
struct BPLINK_API FBpPolicy
{
	FString Id;
	FString Product;
	TArray<FString> Tools;
	int32 MinTier = -1;
	FString ExpiresAt;
	FString CreatedAt;
	/** grantedBy.surface (vr, web) and grantedBy.device, when the server recorded them. */
	FString GrantedSurface;
	FString GrantedDevice;
	/** Not expired now (expiresAt is later than the clock). */
	bool IsLive() const;
};

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
	/** The product BpLink reads ("kettle" at launch, unless -BpLinkProduct= or BP_LINK_PRODUCT names another; SetProduct
	 *  changes it at runtime). */
	FString GetProductSlug() const;

	/** Retargets the table at runtime (spark onboarding-vr WP-V1; console `BpLink.Product <slug>`): every request still out
	 *  for the old product is cancelled and its answer dropped, the old product's plan, structure, scan side, waves,
	 *  briefs and draft are cleared, OnProduct fires, and the new product is read the way the startup read reads it (its
	 *  plan arrives through OnPlan, or OnPlanFailed when it has no map yet). The same slug reads it again. Game thread. */
	void SetProduct(const FString& Slug);
	FOnBpProduct& OnProduct() { return ProductDelegate; }

	/** The products and their onboarding (GET /api/products every ProductsPollS; GET /api/onboarding every OnboardingPollS,
	 *  OnboardingBusyS while any job is queued or running; and, for each running job, its .../onboarding/feed from the last
	 *  event read, for the progress count the job record lacks). Off while BpLink reads the bundle. */
	const FBpOnboardingState& GetOnboarding() const { return Onboarding; }
	const FBpProductEntry* FindProduct(const FString& Slug) const { return Onboarding.Products.FindByPredicate([&Slug](const FBpProductEntry& E) { return E.Slug == Slug; }); }
	FOnBpOnboarding& OnOnboarding() { return OnboardingDelegate; }
	FOnBpMilestone& OnMilestone() { return MilestoneDelegate; }
	static constexpr float ProductsPollS = 30.f;
	static constexpr float OnboardingPollS = 4.f;
	static constexpr float OnboardingBusyS = 1.f;
	/** contract.ts PHASE_LABEL: "judge" -> "Judge"; an unknown phase is returned as it is. */
	static FString PhaseLabel(const FString& Phase);
	/** The product's name as the products list or its structure gives it, else its slug. */
	FString NameOf(const FString& Slug) const;

	/** The open product's build-up (spark onboarding-vr WP-V2): while the open product's adopt job runs (or it stopped and
	 *  the product has no map), BpLink reads its .../onboarding/feed?after=<n>&job=<id>&layout=islands every BuildupPollS
	 *  and hands each answer that brought events (and the last one) to OnBuildup, parsed off the game thread. The first
	 *  answer after a (re)start is marked past. Another product (SetProduct) stops it. */
	FOnBpBuildup& OnBuildup() { return BuildupDelegate; }
	static constexpr float BuildupPollS = 0.5f;
	/** The job the build-up feed reads, empty when none. */
	const FString& GetBuildupJob() const { return BuildupJob; }
	/** GET .../plan?layout=islands of the open product, once, outside the startup read (the build-up's history step: the
	 *  final boxes). OnDone on the game thread; dropped when the product changed meanwhile. */
	void FetchIslandsPlan(TFunction<void(bool bOk, const FBpPlan& Plan)> OnDone);
	/** structure.project.name from the last structure that parsed; empty while none has. */
	const FString& GetProductName() const { return ProductName; }
	/** A feature's kind (structure.features[].kind: user_flow, capability, integration, ops) by its slug, which is the
	 *  plan tile's id; null when the last structure that parsed has no such feature or names no kind. */
	const FString* FindFeatureKind(const FString& Slug) const { return FeatureKinds.Find(Slug); }
	/** A feature's kind as the build-up's structure names it (WP-V2), until the product's own structure read replaces them. */
	void NoteFeatureKind(const FString& Slug, const FString& Kind) { if (!Slug.IsEmpty() && !Kind.IsEmpty() && !FeatureKinds.Contains(Slug)) FeatureKinds.Add(Slug, Kind); }
	/** A feature's one line (structure.features[].summary) by its slug; null when the structure names none. */
	const FString* FindFeatureSummary(const FString& Slug) const { return FeatureSummaries.Find(Slug); }
	/** A lens's name (structure.lenses[].manifest.name, what the web's P.LENS shows) by its id; null when the last structure
	 *  that parsed names no such lens (spark vr-room-layers WP3: the manifest is the one source of the table's lens words). */
	const FString* FindLensName(const FString& Lens) const { return LensNames.Find(Lens); }
	/** A lens's accent as its manifest gives it for a dark surface (presentation.accent.dark, "#rrggbb"), the colour the web marks
	 *  its scans in; null when the manifest gives none. */
	const FString* FindLensAccent(const FString& Lens) const { return LensAccents.Find(Lens); }
	/** The lens's short code as the web's chips say it (manifest `short`: BIZ, DES, ...), or null. */
	const FString* FindLensShort(const FString& Lens) const { return LensShorts.Find(Lens); }
	/** A lens field's label and unit (manifest.fields[]: the web's metric name and unit, rail/wide/review.tsx) by the lens and
	 *  the field's key; null when the manifest has no such field or it names none. */
	const FString* FindFieldLabel(const FString& Lens, const FString& Key) const { return FieldLabels.Find(Lens + TEXT("/") + Key); }
	const FString* FindFieldUnit(const FString& Lens, const FString& Key) const { return FieldUnits.Find(Lens + TEXT("/") + Key); }

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
	/** Whether the session reads the build's bundled snapshot (no server: -BpLinkUrl=bundle, or the fallback when the server
	 *  did not answer). Every write is refused then. */
	bool IsFromBundle() const;

	/** POST .../scans { lens, scope[, focus] }: the web's way to start a lens scan (blueprint-ui.md, "POST /api/products/<slug>/scans").
	 *  OnDone gets the HTTP status (202 when queued) and the body. Lens `all` with Kind `all` is the every-lens scan. Refused from
	 *  the bundle (no server keeps a scan). A plain, a directed and an every-lens scan may start on a live product (owner,
	 *  2026-11-09; the table asks for a second press first). A refusal sends nothing, is logged, and hands OnDone status 0 with
	 *  the reason as Body. */
	void PostScan(const FString& Lens, const FString& Kind, const FString& Id, const FString& Label, const TArray<FString>& Features,
		TFunction<void(int32 Status, const FString& Body)> OnDone, const FString& Focus = FString());
	/** DELETE .../scans/<job> (table-link-v2.md section 5, scope `scan`): cancels a queued or running job. OnDone gets the status
	 *  (200 with the cancelled ScanJob; 404 unknown; 0 refused or no answer) and words for the console. */
	void CancelScan(const FString& JobId, TFunction<void(int32 Status, const FString& Words)> OnDone);

	// ---- The PC link (table link v2, night two W2a) --------------------------------------------------------------------
	/** The route, the pairing and the last word about them. */
	const FBpLinkStatus& GetLinkStatus() const { return LinkStatus; }
	FOnBpLinkStatus& OnLinkStatus() { return LinkStatusDelegate; }
	/** One word for the wrist: CABLE, WI-FI, OFFLINE, or PAIRING while a code is shown. */
	static FString RouteWord(const FBpLinkStatus& Status);
	/** The state in plain words ("On the cable", "On Wi-Fi", "Not connected: showing the sample"). */
	static FString RouteWords(const FBpLinkStatus& Status);
	/** A scope in words ("scan" -> "start and cancel scans"). */
	static FString ScopeWords(const FString& Scope);
	/** The scopes this headset asks for (the owner's approve command names the same list). */
	static const TCHAR* const PairScopes;
	/** BpLink.Pair: GET /lan/where over the cable (keeps the Wi-Fi door), POST /pair, then POST /pair/claim every 2 s until the
	 *  owner approves the code on the PC or it lapses. Needs a route. */
	void Pair();
	/** Stops waiting for a code (the request lapses on the PC by itself). */
	void CancelPair();
	/** BpLink.Unpair: forgets the token here (the PC keeps the pairing until `npm run server -- pair revoke <id>`). */
	void Unpair();
	/** BpLink.Where: GET /lan/where over the cable, logged, the door kept. */
	void Where();
	/** The console's SHOW ON PC: POST /api/session/place (the place baton, scope `place`) with the table's place; when no baton is
	 *  claimed (409/404) the place goes out as the shared focus instead, which the web follows. OnDone gets words. */
	void ShowOnPc(const FBpFollowPlace& Place, TFunction<void(bool bOk, const FString& Words)> OnDone);
	/** Health every LinkProbeLinkedS while linked, LinkProbeAwayS while on the bundle; a request lasts LinkProbeTimeoutS. */
	static constexpr float LinkProbeLinkedS = 15.f;
	static constexpr float LinkProbeAwayS = 5.f;
	static constexpr float LinkProbeTimeoutS = 2.f;
	static constexpr float PairClaimS = 2.f;
	static constexpr float PairMeS = 60.f;
	/** What a PostScan answer that was not 202 means, in words the table can show: the refusal Body at status 0, no answer at
	 *  all, a LAN door 403 (bare, for a pairing without the `scan` scope), a standing order, a full queue, a route's refusal. */
	static FString ScanAnswerWords(int32 Status, const FString& Body);

	/** GET .../focuses: the open product's saved focuses, into GetFocusList(). OnFocuses fires and OnDone runs when it
	 *  answers (with Error set when it failed); an answer for a product the table has left is dropped. From the bundle nothing
	 *  is sent: the list is the bundle's sample focuses (bSample) when it has them, else Error says so. Game thread. */
	void GetFocuses(TFunction<void(const FBpFocusList&)> OnDone = nullptr);
	const FBpFocusList& GetFocusList() const { return FocusList; }
	FOnBpFocuses& OnFocuses() { return FocusesDelegate; }
	/** Whether a server is answering this session: not the bundle, and the job list has been read. The wrist's Scan tab
	 *  stands only then. */
	bool HasPcLink() const;
	/** Whether the session reads the bundle and the bundle lists sample focuses: the Scan tab then stands with a local sample
	 *  behind it. Never true with a server: HasPcLink and this exclude each other. */
	bool HasSampleFocuses() const;

	/** POST /api/companion/turn { conversationId?, product, text } (companion-link.md section 2; the lamp's fixed asks). The
	 *  whole Server-Sent-Event body is read when the turn ends (the lamp shows the reply, not deltas; incremental reading is
	 *  a later change). Refused without a PC link: nothing is sent, OnDone gets Unreached. One conversation per session, kept
	 *  here. A 409 reads Busy (wait and retry, never queue). OnDone runs on the game thread. Never approves a card. */
	void PostCompanionTurn(const FString& Text, TFunction<void(const FBpCompanionTurn&)> OnDone);
	/** The turn still out is called off (the talk's B or pinch, the stand-up's cancel): its request is cancelled, the companion
	 *  is free for the next turn at once, and the old turn's end writes nothing into the module (its OnDone gets Failed,
	 *  "cancelled", which its asker's own serial drops). True when a turn was out. */
	bool CancelCompanionTurn(const TCHAR* Why);
	bool IsCompanionTurnOut() const { return bCompanionTurnOut; }

	/** Adds an open finding to the product's draft wave the way the web's ledger does (spark vr-room-layers WP2, the screen
	 *  deck's Approve): with no draft wave, POST .../waves a new one (the composer's defaults: "Wave <n>", one package
	 *  "Package 1", opus, high); else PATCH .../waves/<id> the newest draft (or the one this process last wrote to) with
	 *  the id appended to its first package (WaveComposer's "Add selected"). A finding a draft already holds is not sent.
	 *  Allowed on every product: a draft queues nothing. OnDone gets whether it is in a draft now, that wave's id and a
	 *  note for the log. Nothing here dispatches (SendWave refuses any other route). */
	void AddToDraft(const FString& ProposalId, TFunction<void(bool bOk, const FString& WaveId, const FString& Note)> OnDone)
	{
		AddToDraft(TArray<FString>{ ProposalId }, MoveTemp(OnDone));
	}
	/** The same for several findings in one write (WP3's lasso): the ones no draft holds yet go in together, so a second write
	 *  never patches packages the waves have not read back. */
	void AddToDraft(const TArray<FString>& ProposalIds, TFunction<void(bool bOk, const FString& WaveId, const FString& Note)> OnDone);
	/** GET .../proposals/<id>/brief: the decision brief of one finding (packages/core/src/scan/brief.ts, the decision-brief-1
	 *  wire), read with BpSchema::FromJson into the generated FBpDecisionBrief - the same lines the web's decision card, the
	 *  Morning Watch and an agent's plan.brief read. OnDone(false) offline (the bundle has no briefs) or on any failure. A
	 *  read only (the table's decisions are DeclineRepeat and ApproveDecision). Game thread. */
	void FetchBrief(const FString& ProposalId, TFunction<void(bool bOk, const FBpDecisionBrief& Brief)> OnDone);
	/** A brief already read (a fetch, or the bundle's briefs.json), or null. The room deck lays its decision screens out
	 *  from it. */
	const FBpDecisionBrief* FindBrief(const FString& ProposalId) const { return Briefs.Find(ProposalId); }
	/** Whether a brief says the same idea was declined before (advice withdraw, with the decline it repeats): the one case
	 *  where the table recommends, and may write, Decline. */
	static bool IsRepeat(const FBpDecisionBrief& Brief) { return Brief.advice.say == TEXT("withdraw") && Brief.declines.Num() > 0; }
	/** The device id BpLink names itself with on a write (`x-bp-device`; through the LAN door the door sets it instead). */
	static const TCHAR* const DeviceId;
	/** POST .../proposals/<id>/decline {} (ROADMAP F8, owner 2026-10-30: "pinching decline should decline"): the server
	 *  declines the finding only when its card brief says the same idea was declined before, through bp's decide with the
	 *  brief's note ("Repeats <id>, declined <day>: ..."), as the web deck's Decline on a repeat does; any other card is 409.
	 *  Refused (status 0, nothing sent) while BpLink reads the bundle. OnDone gets the HTTP status and body; on 200 the
	 *  scan side is read again at once. Game thread. */
	void DeclineRepeat(const FString& ProposalId, TFunction<void(int32 Status, const FString& Body)> OnDone)
	{
		SendDecision(TEXT("decline"), ProposalId, MoveTemp(OnDone));
	}
	/** POST .../proposals/<id>/approve {} (ROADMAP D12, owner 2026-10-31: "Pinching approve in VR should approve the target
	 *  decisions"): the server approves the finding through bp's decide, as the web Morning Watch's Approve does
	 *  (proposed -> approved, signed, one steering-log row); it queues no build. 409 once it is not open (decided
	 *  elsewhere first). Refused (status 0, nothing sent) while BpLink reads the bundle. OnDone as DeclineRepeat's. */
	void ApproveDecision(const FString& ProposalId, TFunction<void(int32 Status, const FString& Body)> OnDone)
	{
		SendDecision(TEXT("approve"), ProposalId, MoveTemp(OnDone));
	}

	/** POST .../proposals/approve { ids } (ROADMAP D15, owner 2026-10-31: where an approval relates to several findings, one
	 *  pinch approves all of them): the server approves each id as ApproveDecision does (one steering-log row each, no build
	 *  queued) and skips the ones it cannot, naming why (`unknown`, `in-job`, or the status they hold). 1..50 ids, each once.
	 *  OnDone gets the HTTP status (0: refused or offline, nothing sent) and, on 200, the ids approved and the skipped ones as
	 *  (id, status) pairs. Refused (status 0) while BpLink reads the bundle or while a write for any of the ids is out. */
	void ApproveDecisions(const TArray<FString>& ProposalIds, TFunction<void(int32 Status, const TArray<FString>& Approved, const TArray<TPair<FString, FString>>& Skipped)> OnDone);

	/** The draft the table last wrote to (AddToDraft); the wrist shows it first. Empty until one was written. */
	const FString& GetFocusWaveId() const { return FocusWaveId; }

	/** The shared focus, followed (packages/core/src/session/focus.ts): BpLink is the reader FollowReader on surface `vr`,
	 *  says `follow *` once (and again whenever the record no longer shows it following), `hello` every FollowHelloS,
	 *  and reads GET /api/session/focus every FollowPollS. A new rev whose place another reader published fires OnFollow;
	 *  a rev the table published itself never does (and the server makes no rev for a place that is already the shared
	 *  one). Off with no server to ask (the bundle). */
	static constexpr float FollowPollS = 1.f;
	static constexpr float FollowHelloS = 15.f;
	static const TCHAR* const FollowReader;
	FOnBpFollow& OnFollow() { return FollowDelegate; }
	/** The last place followed, or null while none has been: a table that begins play later goes there at once. */
	const FBpFollowPlace* GetFollowPlace() const { return bHasFollowPlace ? &FollowPlace : nullptr; }
	bool IsFollowing() const { return bFollowing; }
	/** BpLink.Follow on|off: off says `unfollow` and stops applying; on says `follow *` and applies the shared place as it
	 *  stands, if another reader published it. */
	void SetFollowing(bool bOn);

	/** The table's own place, published (the other half of "one place": the owner moves on the table, the web flies
	 *  there). POST /api/session/focus { op: publish, reader FollowReader, surface vr, label, place: { product, target?,
	 *  level, say? } } with Place's Product (empty: GetProductSlug()), Kind and Id (empty or `site`: no target), Level and
	 *  Say. The caller (the table) settles first and never calls it for a place it is following. Skipped, and false, when
	 *  publishing is off, BpLink reads the bundle, or the place is the shared focus already (the last rev read, or our own
	 *  publish in flight): so a followed place never goes back as news. True when the place is sent (or queued behind a
	 *  publish still out: the newest wins). */
	bool PublishPlace(const FBpFollowPlace& Place);
	bool IsPublishing() const { return bPublishing; }
	/** BpLink.Publish on|off: whether the table's own moves become the shared focus. */
	void SetPublishing(bool bOn);

	// ---- The stand-up (night two W2b, table-link-v2.md section 3; the web's Morning Watch) -----------------------------
	/** GET /api/companion/morning[?since=<iso>] (scope standup), or, from the bundle, the build's sample deck (morning.json,
	 *  apps/vr/tools/bundle-morning.ts): bSample says which. OnDone on the game thread. */
	void GetMorning(const FString& Since, TFunction<void(const FBpMorningRead&)> OnDone);
	/** POST /api/companion/morning { product, proposal, verdict, shown } (scope decide; contract 3.1): approve, defer, hold, or
	 *  decline on a repeat. `shown` is what the card displayed (1..1000 characters). Refused here (status 0, nothing sent) from
	 *  the bundle, with an empty `shown`, or for any other verdict. OnDone gets the status and the body (the SteerRow, or the
	 *  server's { error }). */
	void PostMorningVerdict(const FString& Product, const FString& Proposal, const FString& Verdict, const FString& Shown, TFunction<void(int32 Status, const FString& Body)> OnDone);
	/** GET /api/companion/cards (scope standup): the companion's cards, newest first. */
	void GetCompanionCards(TFunction<void(bool bOk, const TArray<FBpCompanionCard>& Cards)> OnDone);
	/** POST /api/companion/cards/<id> { decision, shown } (scope decide; contract 3.2). Refused here from the bundle or with no
	 *  `shown`. */
	void AnswerCompanionCard(const FString& Id, bool bApprove, const FString& Shown, TFunction<void(int32 Status, const FString& Body)> OnDone);
	// ---- The voice link (night two W3, docs/concepts/vr-light-table/voice-link.md; scope standup) ------------------------
	/** POST /api/companion/listen: one mono 16-bit WAV (16 kHz) in, its words out. bConsented is the wearer's ALLOW on the
	 *  consent sheet: without it nothing is sent (status 0) and no `x-bp-speech-consent` header ever goes out. Refused here
	 *  from the bundle or with no route, or over the caps (30 s, 3,000,000 bytes). OnDone gets the status, the text, `heard`
	 *  (speech, no-speech, silence), the server's ms and the body (an error's { error }). The body is never logged. */
	void PostListen(const TArray<uint8>& Wav, bool bConsented, TFunction<void(int32 Status, const FString& Text, const FString& Heard, int32 Ms, const FString& Body)> OnDone);
	/** POST /api/companion/say { text }: the lamp's voice for a line, a mono 16-bit 24 kHz WAV at the tour clips' level.
	 *  OnDone gets the status, the WAV (empty on a refusal), and the body of a refusal. */
	void PostSay(const FString& Text, TFunction<void(int32 Status, const TArray<uint8>& Wav, const FString& Body)> OnDone);
	static constexpr int32 ListenMaxBytes = 3000000;
	static constexpr float ListenMaxS = 30.f;
	/** GET /api/companion/policies (scope standup): every grant, newest first, expired ones too. */
	void GetPolicies(TFunction<void(bool bOk, const TArray<FBpPolicy>& Policies)> OnDone);
	/** POST /api/companion/policies (scope decide; contract 3.4), never wider than VR_POLICY_BOUND: one product (never "*"), a
	 *  subset of PolicyTools, MinTier 1..3, 0 < Hours <= PolicyMaxHours. A wider request is refused here and nothing is sent
	 *  (status 0); the server refuses it too (403). OnDone gets the status, the grant as the SERVER answered it (its product,
	 *  tools, minTier and expiresAt are the truth the headset shows), and the raw body. */
	void GrantPolicy(const FString& Product, const TArray<FString>& Tools, int32 MinTier, int32 Hours, const FString& Shown,
		TFunction<void(int32 Status, const FBpPolicy& Grant, const FString& Body)> OnDone);
	/** DELETE /api/companion/policies/<id> (scope decide; contract 3.5). */
	void RevokePolicy(const FString& Id, TFunction<void(int32 Status, const FString& Body)> OnDone);
	/** VR_POLICY_BOUND (packages/core/src/server/decider.server.ts): the tools a grant from the table may name, and its hours. */
	static const TArray<FString>& PolicyTools();
	static constexpr int32 PolicyMaxHours = 12;
	/** A person's decision may go from here: a PC answers (not the bundle) and this headset's pairing holds `decide`. */
	bool CanDecide() const;
	/** A finding's "before" screen (FBpShot path) as PNG bytes: from the bundle's shots/ folder, or GET
	 *  /api/products/<product>/shots/<path> (scope read) cached on disk under Saved/BpShots/<product>/. bSample: read from the
	 *  bundle. OnDone(false) when there is none. */
	void FetchShot(const FString& Product, const FString& Path, TFunction<void(bool bOk, const TArray<uint8>& Png, bool bSample)> OnDone);
	/** A refusal's body in plain words: its { words } when present, else its { error }, else what the status means for a decision. */
	static FString AnswerWords(int32 Status, const FString& Body);
	/** A refusal's sentence for the person, or empty: its non-empty `words` (the voice routes' 429 budget), else its `error`
	 *  when that is a sentence (the turn's 429) rather than a code. */
	static FString RefusalWords(const FString& Body);

private:
	// ---- The PC link (night two W2a) ----
	FBpLinkStatus LinkStatus;
	FOnBpLinkStatus LinkStatusDelegate;
	FTSTicker::FDelegateHandle LinkTicker;
	bool TickLink(float DeltaSeconds);
	/** Asks /api/health on the route in use (linked) or on each candidate in turn (away). */
	void ProbeLink();
	void ProbeCandidate(int32 Index);
	/** The candidates in order: the explicit URL, else the cable, then the saved Wi-Fi door (only with a token). */
	TArray<TPair<FString, EBpLinkRoute>> LinkCandidates() const;
	void LinkUp(const FString& Url, EBpLinkRoute Route, const FString& Boot);
	void LinkLost(const FString& Why);
	/** Every request of the old route dropped and the product, scans, products and follow read again. */
	void RefetchAll(const TCHAR* Why);
	/** The build's sample, read in place of the PC (its snapshot when it has the open product, and its scan answers). */
	void ReadBundleNow();
	void ChangedLink();
	void SaveLink() const;
	void LoadLink();
	void ForgetToken(const FString& Why);
	void SendClaim();
	void AskPairMe();
	void PostPair();
	void ReceiveWhere(int32 Status, const FString& Body, bool bThenPair);
	bool bProbeOut = false;
	double NextProbeS = 0.0;
	int32 ProbeMisses = 0;
	/** The Wi-Fi door's backoff while it does not answer (5 s doubling to 60 s). */
	double WifiRetryS = 0.0;
	float WifiBackoffS = 5.f;
	bool bClaimOut = false;
	double NextClaimS = 0.0;
	double NextPairMeS = 0.0;
	FString PairNonce;
	/** The answer to the first decision that went to the bundle was said once (a loss is said once until the next link). */
	bool bLossSaid = false;
	FOnBpProduct ProductDelegate;
	// ---- Products and onboarding (spark onboarding-vr WP-V1) ----
	FBpOnboardingState Onboarding;
	FOnBpOnboarding OnboardingDelegate;
	FOnBpMilestone MilestoneDelegate;
	FTSTicker::FDelegateHandle OnboardingTicker;
	double NextProductsPollS = 0.0;
	double NextOnboardingPollS = 0.0;
	bool bProductsOut = false;
	bool bOnboardingOut = false;
	/** A route that answered other than 200 is logged once per outage. */
	bool bProductsMissLogged = false;
	bool bOnboardingMissLogged = false;
	/** Each running job's feed: the index to ask from next (the answer's `next`), and whether a read is out. */
	TMap<FString, int32> FeedNext;
	TSet<FString> FeedsOut;
	/** Each job seen, by id: the status and phase it had when first seen (the milestone baseline) and the milestones said. */
	struct FJobSeen
	{
		bool bPlanSaid = false;
		bool bEndSaid = false;
	};
	TMap<FString, FJobSeen> JobsSeen;
	bool TickOnboarding(float DeltaSeconds);
	void PollProducts();
	void PollOnboarding();
	void ReceiveProducts(const FString& Body);
	void ReceiveOnboarding(const FString& Body);
	void PollFeed(const FBpProductEntry& Entry);
	void ReceiveFeed(const FString& Slug, const FString& JobId, int32 Next, int32 N, int32 Of, const FString& ProgressPhase, const FString& Phase);
	/** Says each milestone a job just passed (once), and reads the open product again when its own job is done. */
	void JudgeMilestones(const FBpProductEntry& Entry, const FString& WasState, const FString& WasPhase, bool bFirstSight);
	void LogOnboardingEntry(const FBpProductEntry& Entry) const;
	// ---- The open product's build-up feed (WP-V2) ----
	FOnBpBuildup BuildupDelegate;
	FString BuildupJob;
	int32 BuildupNext = 0;
	bool bBuildupOut = false;
	bool bBuildupDone = false;
	bool bBuildupPast = true;
	double NextBuildupPollS = 0.0;
	void TickBuildup(double Now);
	void PollBuildup(const FBpProductEntry& Entry);
	void ResetBuildup();

	void SendPublish(const FBpFollowPlace& Place);
	/** The shared focus as last read or published (product, kind, id): the echo rule's "already the shared one". */
	FBpFollowPlace SharedSpot;
	bool bHasSharedSpot = false;
	bool bPublishing = true;
	bool bPublishOut = false;
	/** A publish that came while one was out: sent when it answers. */
	FBpFollowPlace NextPublish;
	bool bHasNextPublish = false;

	bool TickFollow(float DeltaSeconds);
	/** POST /api/session/focus { op, reader, surface, label[, of] } as FollowReader. */
	void SendFollowOp(const TCHAR* Op);
	void ReceiveFollowView(const FString& Body);

	FOnBpFollow FollowDelegate;
	FTSTicker::FDelegateHandle FollowTicker;
	FBpFollowPlace FollowPlace;
	bool bHasFollowPlace = false;
	bool bFollowing = true;
	/** The server has our `follow *` (it answered 200), so the poll only reads. */
	bool bFollowSaid = false;
	bool bFollowPollOut = false;
	bool bFollowOpOut = false;
	/** The rev last read; -1 before the first read, so the place standing when VR starts is followed too. */
	int32 FollowRev = -1;
	double NextFollowPollS = 0.0;
	double NextFollowHelloS = 0.0;
	/** The poll's "no server" is logged once per outage, not every second. */
	bool bFollowUnreachableLogged = false;

	/** The one door for wave writes: POST .../waves or PATCH .../waves/<id>, nothing else. A dispatch, a DELETE or any other
	 *  route is refused and logged, on every product (the owner's ruling: no dispatch from VR). */
	void SendWave(const FString& Verb, const FString& Path, const FString& Body, TFunction<void(int32 Status, const FString& Body)> OnDone);
	/** The one door for the table's decision writes: POST .../proposals/<id>/<Verb> {} with x-bp-device, Verb `decline` or
	 *  `approve` only (the device routes; never the plan's free decide). The server judges, not the table. */
	void SendDecision(const TCHAR* Verb, const FString& ProposalId, TFunction<void(int32 Status, const FString& Body)> OnDone);
	void PollScan();
	bool TickScanPoll(float DeltaSeconds);
	void TakeScanBody(int32 Part, FString Body);
	void ReceiveScanPart(int32 Part, TSharedPtr<struct FBpScanWire> Wire, TMap<FString, int32> Tiers, TMap<FString, double> Deltas, TMap<FString, double> Scores, TSet<FString> ScoredV5);
	/** The lamp's companion conversation (one per session, companion-lamp-plan.md U4) and whether a turn is out. */
	FString CompanionConversation;
	bool bCompanionTurnOut = false;

	FBpScanState ScanState;
	FOnBpScanState ScanStateDelegate;
	FTSTicker::FDelegateHandle ScanTicker;
	double NextScanPollS = 0.0;
	/** Requests of the current poll still out; a new poll waits for them. */
	int32 ScanPartsOut = 0;
	/** The bodies last read, so an unchanged answer is not parsed again. */
	uint32 ScanBodyHash[3] = { 0, 0, 0 };
	/** The bundle's scan answers were read (they are read once: no server changes them). */
	bool bScanBundled = false;

	FBpPlan Plan;
	bool bHasPlan = false;
	EBpPlanState PlanState = EBpPlanState::Pending;
	FString ProductName;
	TMap<FString, FString> FeatureKinds;
	TMap<FString, FString> FeatureSummaries;
	TMap<FString, FString> LensNames;
	TMap<FString, FString> LensAccents;
	TMap<FString, FString> LensShorts;
	FBpFocusList FocusList;
	FOnBpFocuses FocusesDelegate;
	/** By "<lens>/<key>". */
	TMap<FString, FString> FieldLabels;
	TMap<FString, FString> FieldUnits;
	FString FocusWaveId;
	/** Briefs by proposal id: fetched ones, and the bundle's briefs.json (read once, offline). */
	TMap<FString, FBpDecisionBrief> Briefs;
	bool bBriefsBundled = false;
	/** Decision writes out (a decline or an approve), by proposal: a second pinch on the same card waits for the first. */
	TSet<FString> DecisionsOut;
	/** A draft write is out: a second waits for it, so two Approves never compose two waves. */
	bool bWaveWriteOut = false;
	FOnBpPlan PlanDelegate;
	FOnBpPlanFailed PlanFailedDelegate;
};
