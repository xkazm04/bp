// Not compiled against Unreal, not syntax-checked (no clang on the machine it was written on): apps/vr/WP3.1.md.
// Correction 2026-10-22 (Lynx): out of date. UE 5.8.4's MSVC 14.44.35207 has compiled this file end to end and linked
// UnrealEditor-BpLink.dll (bpEditor Win64 Development, exit 0) in a probe project outside the repo; nothing has run it.
// Correction later that night: the editor has run it there (-nullrhi), and reading 14 logged the Kettle wings line.
// Readings: docs/concepts/vr-light-table/machine.md.
#include "BpLink.h"

#include "Schema/BpSchemaFixups.h"
#include "HAL/IConsoleManager.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/PlatformMisc.h"
#include "Containers/Ticker.h"
#include "Async/Async.h"
#include "Serialization/JsonWriter.h"
#include "Policies/CondensedJsonPrintPolicy.h"

DEFINE_LOG_CATEGORY(LogBpLink);

IMPLEMENT_MODULE(FBpLinkModule, BpLink)

namespace
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> MakeGet(const FString& Url, const TCHAR* Accept)
	{
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
		Request->SetVerb(TEXT("GET"));
		Request->SetURL(Url);
		Request->SetHeader(TEXT("Accept"), Accept);
		return Request;
	}

	/**
	 * The events string is JSONL: one object per line. A bad line is skipped, never fatal. The first MaxSampled bad lines
	 * are logged with a prefix, then ONE summary says how many of how many failed, so a wire change that breaks every
	 * line reads "566 of 566" and not 566 near-identical warnings.
	 */
	void ReadEvents(const FString& Jsonl, TArray<FBpAppStructureEvent>& Out)
	{
		constexpr int32 MaxSampled = 3;
		int32 Total = 0;
		int32 Skipped = 0;
		TArray<FString> Lines;
		Jsonl.ParseIntoArrayLines(Lines);
		for (const FString& Line : Lines)
		{
			if (Line.TrimStartAndEnd().IsEmpty()) continue;
			++Total;
			TSharedPtr<FJsonObject> Object;
			FBpAppStructureEvent Event;
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Line), Object) && Object.IsValid() && BpSchema::FromJson(Object.ToSharedRef(), Event))
			{
				Out.Add(MoveTemp(Event));
			}
			else if (++Skipped <= MaxSampled)
			{
				UE_LOG(LogBpLink, Warning, TEXT("BpLink: skipped an events line that did not parse: %.80s"), *Line);
			}
		}
		if (Skipped > 0)
		{
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: skipped %d of %d events lines that did not parse (the first %d are logged above)"), Skipped, Total, FMath::Min(Skipped, MaxSampled));
		}
	}
}

FString FBpLinkClient::DefaultBaseUrl()
{
	FString Url;
	if (!FParse::Value(FCommandLine::Get(), TEXT("BpLinkUrl="), Url) || Url.IsEmpty())
	{
		Url = FPlatformMisc::GetEnvironmentVariable(TEXT("BP_LINK_URL"));
	}
	return Url.IsEmpty() ? FString(TEXT("http://127.0.0.1:3100")) : Url;
}

FBpLinkClient::FBpLinkClient(const FString& InBaseUrl)
{
	SetBaseUrl(InBaseUrl.IsEmpty() ? DefaultBaseUrl() : InBaseUrl);
}

void FBpLinkClient::SetBaseUrl(const FString& InBaseUrl)
{
	BaseUrl = InBaseUrl;
	while (BaseUrl.EndsWith(TEXT("/"))) BaseUrl.LeftChopInline(1);
}

void FBpLinkClient::FetchProduct(const FString& Slug, TFunction<void(bool, const FBpLinkSnapshot&)> OnDone)
{
	const FString Root = BaseUrl + TEXT("/api/products/") + Slug;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Structure = MakeGet(Root + TEXT("/structure"), TEXT("application/json"));

	Structure->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkSnapshot Snapshot;
		if (!bConnected || !Response.IsValid() || Response->GetResponseCode() != 200)
		{
			UE_LOG(LogBpLink, Error, TEXT("BpLink: GET %s/structure failed (connected=%d, status=%d). Is `npm run server` running?"),
				*Root, bConnected, Response.IsValid() ? Response->GetResponseCode() : 0);
			OnDone(false, Snapshot);
			return;
		}

		// { structure, events, rev }: structure goes through the generated structs, events is JSONL, rev is a string.
		// Each of the three steps that can refuse the answer says which one it was, and the answer's size and head follow,
		// so one run tells them apart (docs/concepts/vr-light-table/machine.md, reading 12).
		const FString Body = Response->GetContentAsString();
		TSharedPtr<FJsonObject> Payload;
		const TSharedPtr<FJsonObject>* StructureJson = nullptr;
		FString Refused;
		if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Payload) || !Payload.IsValid())
		{
			Refused = TEXT("FJsonSerializer::Deserialize found no JSON object in it");
		}
		else if (!Payload->TryGetObjectField(TEXT("structure"), StructureJson))
		{
			Refused = TEXT("it has no `structure` object field");
		}
		else if (!BpSchema::FromJson(StructureJson->ToSharedRef(), Snapshot.Structure))
		{
			const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
			Refused = FString::Printf(TEXT("BpSchema::FromJson failed in %s at structure.%s (%d failed steps)"),
				*Failure.Call, Failure.Path.IsEmpty() ? TEXT("(the converter's LogJson line names the property)") : *Failure.Path, Failure.Count);
		}
		if (!Refused.IsEmpty())
		{
			UE_LOG(LogBpLink, Error, TEXT("BpLink: the %s/structure answer did not parse into FBpAppStructure: %s"), *Root, *Refused);
			UE_LOG(LogBpLink, Error, TEXT("BpLink: that answer is %d bytes, %d characters, and begins: %s"),
				Response->GetContent().Num(), Body.Len(), *Body.Left(200));
			OnDone(false, Snapshot);
			return;
		}
		FString EventsJsonl;
		Payload->TryGetStringField(TEXT("events"), EventsJsonl);
		ReadEvents(EventsJsonl, Snapshot.Events);
		Payload->TryGetStringField(TEXT("rev"), Snapshot.Rev);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: the %s/structure answer parsed: domains=%d lenses=%d events=%d rev=%s; asking /plan"),
			*Root, Snapshot.Structure.domains.Num(), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);

		// /plan is the product at the web's levels (wing, room, bay, tile), parsed into FBpPlan the way /structure is parsed
		// into FBpAppStructure. A failed or unparseable answer logs its own Error and the fetch goes on: structure, events
		// and rev still stand, and bHasPlan stays false. Snapshot is MOVED into this continuation as into the /stream one.
		// The islands view: the server spaces wings and rooms apart for the table (VR computes no layout of its own).
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Plan = MakeGet(Root + TEXT("/plan?layout=islands"), TEXT("application/json"));
		Plan->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone, Snapshot = MoveTemp(Snapshot)](FHttpRequestPtr, FHttpResponsePtr PlanResponse, bool bPlanConnected) mutable
		{
			const int32 PlanCode = (bPlanConnected && PlanResponse.IsValid()) ? PlanResponse->GetResponseCode() : 0;
			if (PlanCode != 200)
			{
				UE_LOG(LogBpLink, Error, TEXT("BpLink: GET %s/plan failed (connected=%d, status=%d); structure, events and rev still stand"),
					*Root, bPlanConnected, PlanCode);
			}
			else
			{
				TSharedPtr<FJsonObject> PlanJson;
				const bool bPlanJson = FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(PlanResponse->GetContentAsString()), PlanJson) && PlanJson.IsValid();
				Snapshot.bHasPlan = bPlanJson && BpSchema::FromJson(PlanJson.ToSharedRef(), Snapshot.Plan);
				if (!Snapshot.bHasPlan)
				{
					Snapshot.Plan = FBpPlan();
					const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
					const FString Refused = bPlanJson ? FString::Printf(TEXT("BpSchema::FromJson failed in %s at plan.%s"), *Failure.Call, *Failure.Path)
						: FString(TEXT("FJsonSerializer::Deserialize found no JSON object in it"));
					UE_LOG(LogBpLink, Error, TEXT("BpLink: the %s/plan answer did not parse into FBpPlan: %s; structure, events and rev still stand"), *Root, *Refused);
				}
				else
				{
					UE_LOG(LogBpLink, Log, TEXT("BpLink: the %s/plan answer parsed into FBpPlan; asking /stream"), *Root);
				}
			}

			// /stream has two answers BpLink lives with: 200 text/event-stream, which Kettle gives since wolf-plan L5.2
			// (apps/server hosts its scan sim), and 405 for a product with no live stream. WP3.1 consumes neither: the rev
			// read above is the one read BpLink keeps either way. Both are pinned by scripts/check-bplink.mjs.
			// A live SSE body never ends, so a 200 never completes by itself (machine.md, reading 13): the status is kept
			// when it arrives, a 200 is cancelled on the next tick, and the completion below reads the kept status.
			// Snapshot holds the whole parsed events array, so it is MOVED into the continuation (nothing below reads it here).
			TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Stream = MakeGet(Root + TEXT("/stream"), TEXT("text/event-stream"));
			TSharedRef<int32, ESPMode::ThreadSafe> StreamCode = MakeShared<int32, ESPMode::ThreadSafe>(0);
			Stream->OnStatusCodeReceived().BindLambda([Root, StreamCode](FHttpRequestPtr Request, int32 Code)
			{
				*StreamCode = Code;
				UE_LOG(LogBpLink, Log, TEXT("BpLink: GET %s/stream sent status %d"), *Root, Code);
				if (Code == 200 && Request.IsValid())
				{
					FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Request](float) { Request->CancelRequest(); return false; }));
				}
			});
			Stream->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone, StreamCode, Snapshot = MoveTemp(Snapshot)](FHttpRequestPtr, FHttpResponsePtr StreamResponse, bool bStreamConnected) mutable
			{
				Snapshot.StreamStatus = *StreamCode > 0 ? *StreamCode : (bStreamConnected && StreamResponse.IsValid()) ? StreamResponse->GetResponseCode() : 0;
				if (Snapshot.StreamStatus == 200)
				{
					UE_LOG(LogBpLink, Log, TEXT("BpLink: %s streams (200); WP3.1 does not consume SSE, so rev %s read once from structure stands"), *Slug, *Snapshot.Rev);
				}
				else if (Snapshot.StreamStatus == 405)
				{
					UE_LOG(LogBpLink, Log, TEXT("BpLink: %s has no live stream (405); using rev %s read once from structure"), *Slug, *Snapshot.Rev);
				}
				else if (Snapshot.StreamStatus == 0)
				{
					// Asked, and nothing answered (-1 would be "never asked", which cannot reach this callback).
					UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s/stream did not connect; SSE is not read in WP3.1 and the one-time rev stands"), *Root);
				}
				else
				{
					// Neither pinned answer. Logged as a warning, and the one-time rev still stands.
					UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s/stream answered %d, neither the pinned 200 nor 405; SSE is not read in WP3.1"), *Root, Snapshot.StreamStatus);
				}
				OnDone(true, Snapshot);
			});
			Stream->ProcessRequest();
		});
		Plan->ProcessRequest();
	});
	Structure->ProcessRequest();
}

namespace
{
	TUniquePtr<FBpLinkClient> GClient;

	/**
	 * One line, WP3.1.md's acceptance: the wing, room, bay and tile counts are the plan's own arrays (a WING is a
	 * WING_DEFS group of domains, 5 for Kettle, and exists only on GET .../plan), the names are the wing names, and
	 * lenses, events and rev come from the structure payload. With no plan read (its Error is already logged), the line
	 * says so and counts `structure.domains`, which are ROOMS (13 for Kettle), never wings.
	 * The labels and their sources are pinned against the live plan route by scripts/check-bplink.mjs.
	 * The line leads with the product's slug, capitalised, so Kettle's line reads as it always has ("BpLink: Kettle wings=").
	 */
	void LogProduct(const FString& Slug, const FBpLinkSnapshot& Snapshot)
	{
		const FString Label = Slug.Left(1).ToUpper() + Slug.Mid(1);
		if (!Snapshot.bHasPlan)
		{
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: %s domains=%d lenses=%d events=%d rev=%s (no plan read, so no wings)"),
				*Label, Snapshot.Structure.domains.Num(), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);
			return;
		}
		TArray<FString> Names;
		for (const FBpPlanWing& Wing : Snapshot.Plan.wings) Names.Add(Wing.name);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: %s wings=%d [%s] rooms=%d bays=%d tiles=%d lenses=%d events=%d rev=%s"),
			*Label, Snapshot.Plan.wings.Num(), *FString::Join(Names, TEXT(", ")), Snapshot.Plan.rooms.Num(), Snapshot.Plan.bays.Num(),
			Snapshot.Plan.tiles.Num(), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);
	}

	/** The product WP3.1 and L3.2 read when nothing names another. */
	const TCHAR* const KettleSlug = TEXT("kettle");

	/**
	 * The product the table reads, settled once per process: -BpLinkProduct=<slug> on the command line, else the
	 * environment variable BP_LINK_PRODUCT, else Kettle. The same precedence as -BpLinkUrl / BP_LINK_URL. A slug other
	 * than kettle exists only on a server started where bp.products.local.json lists it (products.server.ts reads it
	 * from the server's cwd); otherwise /structure answers 404 and the existing "GET ... failed" Error says so.
	 */
	const FString& ProductSlug()
	{
		static const FString Slug = []
		{
			FString Value;
			if (!FParse::Value(FCommandLine::Get(), TEXT("BpLinkProduct="), Value) || Value.IsEmpty())
			{
				Value = FPlatformMisc::GetEnvironmentVariable(TEXT("BP_LINK_PRODUCT"));
			}
			Value.TrimStartAndEndInline();
			return Value.IsEmpty() ? FString(KettleSlug) : Value.ToLower();
		}();
		return Slug;
	}

	void FetchProduct()
	{
		if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
		UE_LOG(LogBpLink, Log, TEXT("BpLink: reading %s from %s"), *ProductSlug(), *GClient->GetBaseUrl());
		GClient->FetchProduct(ProductSlug(), [](bool bOk, const FBpLinkSnapshot& Snapshot)
		{
			if (bOk) LogProduct(ProductSlug(), Snapshot);
			// The module keeps what was read, so the table (ABpTable) never asks a second time.
			if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->ReceiveSnapshot(bOk, Snapshot);
		});
	}

	FAutoConsoleCommand GFetchCommand(TEXT("BpLink.Fetch"), TEXT("Read the product (-BpLinkProduct=, BP_LINK_PRODUCT, else Kettle) from apps/server and log its wings."),
		FConsoleCommandDelegate::CreateStatic(&FetchProduct));
}

FBpLinkModule& FBpLinkModule::Get()
{
	return FModuleManager::LoadModuleChecked<FBpLinkModule>(TEXT("BpLink"));
}

FString FBpLinkModule::GetProductSlug() const
{
	return ProductSlug();
}

void FBpLinkModule::ReceiveSnapshot(bool bOk, const FBpLinkSnapshot& Snapshot)
{
	if (bOk && !Snapshot.Structure.project.name.IsEmpty()) ProductName = Snapshot.Structure.project.name;
	if (bOk)
	{
		// Kept before the plan is announced, so a listener drawing the plan finds each tile's kind.
		FeatureKinds.Reset();
		FeatureSummaries.Reset();
		for (const FBpFeature& Feature : Snapshot.Structure.features)
		{
			if (!Feature.slug.IsEmpty() && !Feature.kind.IsEmpty()) FeatureKinds.Add(Feature.slug, Feature.kind);
			if (!Feature.slug.IsEmpty() && !Feature.summary.IsEmpty()) FeatureSummaries.Add(Feature.slug, Feature.summary);
		}
		// The lenses' words as their manifests say them (the web reads the same manifests from the same answer).
		LensNames.Reset();
		FieldLabels.Reset();
		FieldUnits.Reset();
		for (const FBpLensEntry& Lens : Snapshot.Structure.lenses)
		{
			const FString& Id = Lens.manifest.id.IsEmpty() ? Lens.id : Lens.manifest.id;
			if (!Lens.manifest.name.IsEmpty()) LensNames.Add(Id, Lens.manifest.name);
			for (const FBpField& Field : Lens.manifest.fields)
			{
				if (!Field.label.IsEmpty()) FieldLabels.Add(Id + TEXT("/") + Field.key, Field.label);
				if (!Field.unit.IsEmpty()) FieldUnits.Add(Id + TEXT("/") + Field.key, Field.unit);
			}
		}
	}
	if (bOk && Snapshot.bHasPlan)
	{
		Plan = Snapshot.Plan;
		bHasPlan = true;
		PlanState = EBpPlanState::Ready;
		PlanDelegate.Broadcast(Plan);
	}
	else
	{
		// No plan from this read: the structure or the /plan request failed, and its Error is already logged above.
		PlanState = EBpPlanState::Failed;
		PlanFailedDelegate.Broadcast();
	}
}

void FBpLinkModule::StartupModule()
{
	// A commandlet (the cook in BuildCookRun) has no use for Kettle and no server to ask (machine.md, reading 19's side
	// finding: libcurl error 7 in the cook log). BpLink.Fetch still asks on demand.
	if (!IsRunningCommandlet())
	{
		FetchProduct();
		ScanTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FBpLinkModule::TickScanPoll), 0.1f);
	}
}

void FBpLinkModule::ShutdownModule()
{
	FTSTicker::GetCoreTicker().RemoveTicker(ScanTicker);
	GClient.Reset();
	PlanDelegate.Clear();
	PlanFailedDelegate.Clear();
	ScanStateDelegate.Clear();
}

// ---- The scan side (spark vr-fidelity-40 FC1): the jobs, the store's tables and the waves, polled ----------------------
// What the table's pins, scan line, decision card and the wrist panel show. Read the way the web's Kettle reads it (the
// same routes); SSE is not consumed (machine.md, reading 13: a live body never completes in UE's HTTP), so the job list
// is polled fast while a job runs and slowly otherwise. An answer whose body did not change is not parsed again, and the
// parse runs off the game thread (the /scan body is about 80 KB).

namespace
{
	/** The three parts of a poll, in the order they are asked. */
	const TCHAR* const ScanParts[3] = { TEXT("/scans"), TEXT("/scan"), TEXT("/waves") };
}

bool FBpLinkModule::TickScanPoll(float)
{
	const double Now = FPlatformTime::Seconds();
	if (ScanPartsOut == 0 && Now >= NextScanPollS)
	{
		const bool bBusy = ScanState.Jobs.ContainsByPredicate([](const FBpScanJob& Job) { return Job.status == TEXT("running") || Job.status == TEXT("queued"); });
		NextScanPollS = Now + (bBusy ? ScanPollBusyS : ScanPollIdleS);
		PollScan();
	}
	return true;
}

void FBpLinkModule::PollScan()
{
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	const FString Root = GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug();
	for (int32 Part = 0; Part < 3; ++Part)
	{
		++ScanPartsOut;
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(Root + ScanParts[Part], TEXT("application/json"));
		Request->OnProcessRequestComplete().BindLambda([Part](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
		{
			FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
			if (!Module) return;
			if (!bConnected || !Response.IsValid() || Response->GetResponseCode() != 200)
			{
				--Module->ScanPartsOut;
				return;
			}
			FString Body = Response->GetContentAsString();
			const uint32 Hash = GetTypeHash(Body);
			if (Hash == Module->ScanBodyHash[Part])
			{
				--Module->ScanPartsOut;
				return;
			}
			Module->ScanBodyHash[Part] = Hash;
			// /scans is a bare array and /scan a bare snapshot: both are wrapped as FBpScanWire's own keys (jobs,
			// snapshot) so one generated reader takes all three; /waves already answers { waves }.
			if (Part == 0) Body = TEXT("{\"jobs\":") + Body + TEXT("}");
			else if (Part == 1) Body = TEXT("{\"snapshot\":") + Body + TEXT("}");
			Async(EAsyncExecution::ThreadPool, [Part, Body = MoveTemp(Body)]()
			{
				TSharedPtr<FBpScanWire> Wire = MakeShared<FBpScanWire>();
				TSharedPtr<FJsonObject> Json;
				const bool bOk = FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid() && BpSchema::FromJson(Json.ToSharedRef(), *Wire);
				FString Failed;
				if (!bOk)
				{
					const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
					Failed = FString::Printf(TEXT("%s at %s"), *Failure.Call, *Failure.Path);
				}
				// The proposals that carry a tier: an absent key is untriaged, which the generated int32 cannot tell from 0.
				TMap<FString, int32> Tiers;
				TMap<FString, double> Deltas;
				const TSharedPtr<FJsonObject>* Snapshot = nullptr;
				const TArray<TSharedPtr<FJsonValue>>* Proposals = nullptr;
				if (bOk && Part == 1 && Json->TryGetObjectField(TEXT("snapshot"), Snapshot) && (*Snapshot)->TryGetArrayField(TEXT("proposals"), Proposals))
				{
					for (const TSharedPtr<FJsonValue>& Value : *Proposals)
					{
						const TSharedPtr<FJsonObject>* Row = nullptr;
						FString Id;
						int32 Tier = 0;
						if (!Value.IsValid() || !Value->TryGetObject(Row) || !(*Row)->TryGetStringField(TEXT("id"), Id)) continue;
						if ((*Row)->TryGetNumberField(TEXT("tier"), Tier)) Tiers.Add(Id, Tier);
						double Delta = 0.0;
						if ((*Row)->TryGetNumberField(TEXT("expected_delta"), Delta)) Deltas.Add(Id, Delta);
					}
				}
				AsyncTask(ENamedThreads::GameThread, [Part, Wire, bOk, Failed, Tiers = MoveTemp(Tiers), Deltas = MoveTemp(Deltas)]() mutable
				{
					FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
					if (!Module) return;
					--Module->ScanPartsOut;
					if (!bOk)
					{
						UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s did not parse into FBpScanWire (%s)"), ScanParts[Part], *Failed);
						Module->ScanBodyHash[Part] = 0;
						return;
					}
					Module->ReceiveScanPart(Part, Wire, MoveTemp(Tiers), MoveTemp(Deltas));
				});
			});
		});
		Request->ProcessRequest();
	}
}

void FBpLinkModule::ReceiveScanPart(int32 Part, TSharedPtr<FBpScanWire> Wire, TMap<FString, int32> Tiers, TMap<FString, double> Deltas)
{
	const bool bFirst = Part == 0 ? !ScanState.bHasJobs : Part == 1 ? !ScanState.bHasScan : !ScanState.bHasWaves;
	if (Part == 0) { ScanState.Jobs = MoveTemp(Wire->jobs); ScanState.bHasJobs = true; }
	else if (Part == 1) { ScanState.Scan = MoveTemp(Wire->snapshot); ScanState.Tiers = MoveTemp(Tiers); ScanState.Deltas = MoveTemp(Deltas); ScanState.bHasScan = true; }
	else { ScanState.Waves = MoveTemp(Wire->waves); ScanState.bHasWaves = true; }
	++ScanState.Serial;
	if (bFirst)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: %s %s read: jobs=%d proposals=%d tiered=%d activity=%d waves=%d"), *GetProductSlug(), ScanParts[Part],
			ScanState.Jobs.Num(), ScanState.Scan.proposals.Num(), ScanState.Tiers.Num(), ScanState.Scan.activity.Num(), ScanState.Waves.Num());
	}
	ScanStateDelegate.Broadcast(ScanState);
}

void FBpLinkModule::PostScan(const FString& Lens, const FString& Kind, const FString& Id, const FString& Label, const TArray<FString>& Features,
	TFunction<void(int32, const FString&)> OnDone)
{
	// Only Kettle's scans are simulated; a live product's would run a real lens scan on a real repo (FAD, the owner's
	// rule: nothing new starts from the table).
	if (!IsKettle())
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused POST %s/scans: %s is a live product, and the table starts no scan on it"), *GetProductSlug(), *GetProductSlug());
		if (OnDone) OnDone(0, FString());
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	TSharedRef<FJsonObject> Scope = MakeShared<FJsonObject>();
	Scope->SetStringField(TEXT("kind"), Kind);
	if (!Id.IsEmpty()) Scope->SetStringField(TEXT("id"), Id);
	Scope->SetStringField(TEXT("label"), Label);
	TArray<TSharedPtr<FJsonValue>> List;
	for (const FString& Feature : Features) List.Add(MakeShared<FJsonValueString>(Feature));
	Scope->SetArrayField(TEXT("features"), List);
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("lens"), Lens);
	Body->SetObjectField(TEXT("scope"), Scope);
	FString Text;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<>::Create(&Text));

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug() + TEXT("/scans"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Text);
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->NextScanPollS = 0.0;
		if (OnDone) OnDone(Status, Response.IsValid() ? Response->GetContentAsString() : FString());
	});
	Request->ProcessRequest();
}

// ---- The draft wave (spark vr-room-layers WP2): the screen deck's Approve -----------------------------------------------
// The only write the table makes. A draft queues nothing (blueprint-ui.md, Ledger waves: "prepared as a draft and
// dispatched as a whole later"), so it is allowed on a live product too; a dispatch never leaves VR (the owner's ruling,
// 2026-10-25: "No dispatch from VR on any product"). SendWave is the door that holds that rule.

void FBpLinkModule::SendWave(const FString& Verb, const FString& Path, const FString& Body, TFunction<void(int32, const FString&)> OnDone)
{
	const bool bCompose = Verb == TEXT("POST") && Path == TEXT("/waves");
	const bool bPatch = Verb == TEXT("PATCH") && Path.StartsWith(TEXT("/waves/")) && !Path.Mid(7).Contains(TEXT("/"));
	if ((!bCompose && !bPatch) || Path.Contains(TEXT("dispatch")))
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused %s %s/%s: the table only composes draft waves and never dispatches one, on any product"), *Verb, *GetProductSlug(), *Path);
		if (OnDone) OnDone(0, FString());
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(Verb);
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug() + Path);
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Body);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: %s %s%s (a draft, never dispatched) %.300s"), *Verb, *GetProductSlug(), *Path, *Body);
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		// The waves are read again at the next tick, so the wrist shows what was written.
		if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->NextScanPollS = 0.0;
		if (OnDone) OnDone(Status, Response.IsValid() ? Response->GetContentAsString() : FString());
	});
	Request->ProcessRequest();
}

void FBpLinkModule::AddToDraft(const TArray<FString>& ProposalIds, TFunction<void(bool, const FString&, const FString&)> OnDone)
{
	const auto Done = [OnDone](bool bOk, const FString& WaveId, const FString& Note)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: draft %s: %s"), bOk ? *WaveId : TEXT("not written"), *Note);
		if (OnDone) OnDone(bOk, WaveId, Note);
	};
	if (bWaveWriteOut)
	{
		Done(false, FString(), TEXT("another draft write is still out"));
		return;
	}
	if (ProposalIds.Num() == 0)
	{
		Done(false, FString(), TEXT("no finding to add"));
		return;
	}
	// The draft to add to: the one this process last wrote to while it is still a draft, else the newest draft. A finding
	// a draft already holds is not sent again.
	const FBpWave* Draft = nullptr;
	const FBpWave* Holder = nullptr;
	TArray<FString> Fresh;
	for (const FString& Id : ProposalIds) Fresh.AddUnique(Id);
	for (const FBpWave& Wave : ScanState.Waves)
	{
		if (Wave.status != TEXT("draft")) continue;
		for (const FBpWavePackage& Package : Wave.packages)
		{
			for (const FString& Id : Package.ids)
			{
				if (Fresh.Remove(Id) > 0) Holder = &Wave;
			}
		}
		if (Wave.id == FocusWaveId) { Draft = &Wave; continue; }
		if (!Draft || (Draft->id != FocusWaveId && Wave.created_at > Draft->created_at)) Draft = &Wave;
	}
	const FString Joined = FString::Join(ProposalIds, TEXT(", "));
	if (Fresh.Num() == 0)
	{
		Done(true, Holder ? Holder->id : FString(), FString::Printf(TEXT("%s already in draft %s (\"%s\"), nothing sent"), *Joined, Holder ? *Holder->id : TEXT("?"), Holder ? *Holder->name : TEXT("?")));
		return;
	}
	const FString Adding = FString::Join(Fresh, TEXT(", "));
	const auto Package = [](const FString& Name, const FString& Model, const FString& Effort, const TArray<FString>& Ids)
	{
		TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
		Out->SetStringField(TEXT("name"), Name);
		Out->SetStringField(TEXT("model"), Model);
		Out->SetStringField(TEXT("effort"), Effort);
		TArray<TSharedPtr<FJsonValue>> List;
		for (const FString& Id : Ids) List.Add(MakeShared<FJsonValueString>(Id));
		Out->SetArrayField(TEXT("ids"), List);
		return MakeShared<FJsonValueObject>(Out);
	};
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> Packages;
	FString Verb, Path, Note;
	if (!Draft)
	{
		// WaveComposer's new wave: "Wave <n>", one package (Opus, high) holding the findings.
		Body->SetStringField(TEXT("name"), FString::Printf(TEXT("Wave %d"), ScanState.Waves.Num() + 1));
		Packages.Add(Package(TEXT("Package 1"), TEXT("opus"), TEXT("high"), Fresh));
		Verb = TEXT("POST");
		Path = TEXT("/waves");
		Note = FString::Printf(TEXT("%s compose%s a new draft"), *Adding, Fresh.Num() == 1 ? TEXT("s") : TEXT(""));
	}
	else
	{
		// WaveComposer's "Add selected": into the first package; the packages are sent whole (PATCH replaces them).
		for (int32 Index = 0; Index < Draft->packages.Num(); ++Index)
		{
			const FBpWavePackage& Each = Draft->packages[Index];
			TArray<FString> Ids = Each.ids;
			if (Index == 0) Ids.Append(Fresh);
			Packages.Add(Package(Each.name, Each.model, Each.effort, Ids));
		}
		Verb = TEXT("PATCH");
		Path = TEXT("/waves/") + Draft->id;
		Note = FString::Printf(TEXT("%s added to draft %s (\"%s\") package %s"), *Adding, *Draft->id, *Draft->name, Draft->packages.Num() > 0 ? *Draft->packages[0].name : TEXT("?"));
	}
	Body->SetArrayField(TEXT("packages"), Packages);
	FString Text;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text));
	bWaveWriteOut = true;
	SendWave(Verb, Path, Text, [Done, Note](int32 Status, const FString& Answer)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (Module) Module->bWaveWriteOut = false;
		// 201 { wave } for a new one, 200 { wave } for a patch.
		TSharedPtr<FJsonObject> Json;
		const TSharedPtr<FJsonObject>* Wave = nullptr;
		FString WaveId;
		if ((Status == 200 || Status == 201) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Answer), Json) && Json.IsValid()
			&& Json->TryGetObjectField(TEXT("wave"), Wave) && (*Wave)->TryGetStringField(TEXT("id"), WaveId))
		{
			if (Module) Module->FocusWaveId = WaveId;
			Done(true, WaveId, FString::Printf(TEXT("%s (%d)"), *Note, Status));
			return;
		}
		Done(false, FString(), FString::Printf(TEXT("%s refused %d %.200s"), *Note, Status, *Answer));
	});
}
